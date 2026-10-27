// Technical scan of one org: field metadata, who built what and when, how full each
// field actually is, per-object limits and automation. Strictly read-only — describes,
// Tooling SELECTs and aggregate COUNT() queries; nothing is written to the org.
// usage: node scan_tech.js <sfAlias> <prefix>     -> <prefix>_tech.json
const { execFileSync } = require('child_process');
const fs = require('fs');
const OUT = __dirname.split(String.fromCharCode(92)).join('/');
const API = 'v62.0';
const [ALIAS, PREFIX] = process.argv.slice(2);
if (!ALIAS || !PREFIX) { console.error('usage: node scan_tech.js <alias> <prefix>'); process.exit(1); }

// Objects whose records are counted field-by-field, besides every custom object.
const KEY_OBJECTS = ['Account', 'Contact', 'Lead', 'Opportunity', 'Case', 'Quote', 'Task', 'Event',
  'Contract', 'Order', 'Product2', 'Campaign', 'User'];

const sf = (...a) => execFileSync(process.execPath, ['C:/Program Files/sf/client/bin/run.js', ...a],
  { encoding: 'utf8', maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'ignore'] });
const org = JSON.parse(sf('org', 'display', '--json', '-o', ALIAS)).result;
const I = org.instanceUrl;
let T;
try {
  const j = JSON.parse(sf('org', 'auth', 'show-access-token', '--json', '-o', ALIAS));
  T = typeof j.result === 'string' ? j.result : j.result && j.result.accessToken;
} catch { T = org.accessToken; }
if (!T || !/^00D/.test(T)) { console.error('FATAL ' + ALIAS + ': no usable access token'); process.exit(1); }
const H = { Authorization: 'Bearer ' + T };

async function rest(p) {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(I + p, { headers: H });
    if (r.ok) return r.json();
    const body = await r.text();
    // transient server-side trouble gets two retries; anything else is the caller's problem
    if (attempt < 2 && (r.status >= 500 || /REQUEST_LIMIT|QUERY_TIMEOUT/.test(body))) continue;
    const e = new Error(r.status + ' ' + body.slice(0, 300)); e.status = r.status; throw e;
  }
}
async function qAll(p0) {
  let p = p0, o = [];
  for (;;) {
    const j = await rest(p);
    o = o.concat(j.records || []);
    if (j.done || !j.nextRecordsUrl) break;
    p = j.nextRecordsUrl;
  }
  return o;
}
const soql = q => '/services/data/' + API + '/query/?q=' + encodeURIComponent(q);
const tq = q => '/services/data/' + API + '/tooling/query/?q=' + encodeURIComponent(q);
async function pool(items, limit, fn) {
  const res = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    for (;;) { const k = i++; if (k >= items.length) return; res[k] = await fn(items[k], k); }
  }));
  return res;
}
const day = d => (d ? String(d).slice(0, 10) : '');
const { redact } = require('./redact');
const nsKey = (ns, dev) => (ns ? ns + '__' : '') + dev;

// Same object rule as the data dictionary, so the two always cover the same objects.
const EXCL = /(Share|History|Feed|ChangeEvent|Tag|Rule|RuleShare)$|__e$/;

(async () => {
  const t0 = Date.now();
  console.log('org:', org.username, org.id);
  const orgRow = (await rest(soql('SELECT OrganizationType, Name FROM Organization'))).records[0];

  // ---- objects ----
  const ents = (await qAll(soql('SELECT QualifiedApiName, Label, DurableId FROM EntityDefinition ' +
    'WHERE IsCustomizable = true AND IsQueryable = true ORDER BY QualifiedApiName')))
    .filter(e => !EXCL.test(e.QualifiedApiName))
    // ONLY=Account,Case limits a test run to those objects (write it to a test prefix)
    .filter(e => !process.env.ONLY || process.env.ONLY.split(',').includes(e.QualifiedApiName));
  const byDurable = {};
  for (const e of ents) byDurable[e.DurableId] = e.QualifiedApiName;
  console.log('objects:', ents.length);

  // ---- custom field provenance: who created / last changed each field, and when ----
  const cfRows = await qAll(tq('SELECT Id, DeveloperName, NamespacePrefix, Description, InlineHelpText, CreatedDate, ' +
    'CreatedBy.Name, LastModifiedDate, LastModifiedBy.Name, EntityDefinition.QualifiedApiName FROM CustomField'));
  const CF = {};
  for (const c of cfRows) {
    const obj = c.EntityDefinition && c.EntityDefinition.QualifiedApiName;
    if (!obj) continue;
    CF[obj + '.' + nsKey(c.NamespacePrefix, c.DeveloperName) + '__c'] = {
      desc: c.Description || '', help: c.InlineHelpText || '',
      created: day(c.CreatedDate), createdBy: (c.CreatedBy && c.CreatedBy.Name) || '',
      modified: day(c.LastModifiedDate), modifiedBy: (c.LastModifiedBy && c.LastModifiedBy.Name) || '' };
  }
  console.log('custom fields (tooling):', cfRows.length);

  // ---- custom object descriptions; Tooling has no API name, so match on the name minus its suffix ----
  const coRows = await qAll(tq('SELECT DeveloperName, NamespacePrefix, Description, CreatedDate, CreatedBy.Name FROM CustomObject'));
  const CO = {};
  for (const c of coRows) CO[nsKey(c.NamespacePrefix, c.DeveloperName)] =
    { desc: c.Description || '', created: day(c.CreatedDate), createdBy: (c.CreatedBy && c.CreatedBy.Name) || '' };
  const coFor = api => CO[api.replace(/__(c|mdt|b|x|kav)$/, '')] || null;

  // ---- installed packages ----
  const pk = await qAll(tq('SELECT SubscriberPackage.NamespacePrefix, SubscriberPackage.Name, ' +
    'SubscriberPackageVersion.Name, SubscriberPackageVersion.MajorVersion, SubscriberPackageVersion.MinorVersion FROM InstalledSubscriberPackage'));
  const packages = pk.map(p => ({
    ns: (p.SubscriberPackage && p.SubscriberPackage.NamespacePrefix) || '',
    name: (p.SubscriberPackage && p.SubscriberPackage.Name) || '',
    version: p.SubscriberPackageVersion
      ? (p.SubscriberPackageVersion.Name || '') + ' ' + p.SubscriberPackageVersion.MajorVersion + '.' + p.SubscriberPackageVersion.MinorVersion
      : '' }));
  console.log('installed packages:', packages.length);

  // ---- automation ----
  const flows = await qAll(soql('SELECT ApiName, Label, ProcessType, TriggerType, TriggerObjectOrEventId, IsActive, ' +
    'LastModifiedDate, LastModifiedBy FROM FlowDefinitionView'));
  const trig = await qAll(tq('SELECT Name, TableEnumOrId, Status, LastModifiedDate FROM ApexTrigger'));
  const vrs = await qAll(tq('SELECT ValidationName, Active, EntityDefinition.QualifiedApiName, LastModifiedDate FROM ValidationRule'));
  // workflow rule "active" lives only in Metadata, which Tooling returns one record at a time
  const wfIds = await qAll(tq('SELECT Id, Name, TableEnumOrId FROM WorkflowRule'));
  const wf = (await pool(wfIds, 6, async w => {
    const m = (await rest(tq("SELECT Metadata FROM WorkflowRule WHERE Id = '" + w.Id + "'"))).records[0];
    return { name: w.Name, obj: byDurable[w.TableEnumOrId] || w.TableEnumOrId, active: !!(m && m.Metadata && m.Metadata.active) };
  }));
  const objOf = id => byDurable[id] || id;
  const automation = {
    flows: flows.map(f => ({ api: f.ApiName, label: f.Label, process: f.ProcessType, trigger: f.TriggerType || '',
      obj: f.TriggerObjectOrEventId ? objOf(f.TriggerObjectOrEventId) : '', active: !!f.IsActive,
      modified: day(f.LastModifiedDate), modifiedBy: f.LastModifiedBy || '' })),
    triggers: trig.map(t => ({ name: t.Name, obj: objOf(t.TableEnumOrId), active: t.Status === 'Active', modified: day(t.LastModifiedDate) })),
    validationRules: vrs.map(v => ({ name: v.ValidationName, obj: v.EntityDefinition ? v.EntityDefinition.QualifiedApiName : '',
      active: !!v.Active, modified: day(v.LastModifiedDate) })),
    workflowRules: wf,
  };
  console.log('flows', flows.length, '| triggers', trig.length, '| validation rules', vrs.length, '| workflow rules', wf.length);

  // ---- per-object limits (custom fields, roll-ups, relationships, …) ----
  const LIM = {};
  const durables = ents.map(e => e.DurableId);
  for (let i = 0; i < durables.length; i += 100) {
    const ids = durables.slice(i, i + 100).map(d => "'" + d + "'").join(',');
    for (const r of await qAll(tq('SELECT EntityDefinitionId, Type, Max, Remaining FROM EntityLimit WHERE EntityDefinitionId IN (' + ids + ')'))) {
      const api = byDurable[r.EntityDefinitionId] || r.EntityDefinitionId;
      (LIM[api] = LIM[api] || {})[r.Type] = { max: r.Max, used: r.Max - r.Remaining };
    }
  }

  // ---- describes ----
  const described = (await pool(ents, 8, async e => {
    try { return await rest('/services/data/' + API + '/sobjects/' + e.QualifiedApiName + '/describe'); }
    catch (err) { console.log('  describe failed', e.QualifiedApiName, String(err.message).slice(0, 60)); return null; }
  })).filter(Boolean);

  // ---- population by month ----
  // The Field Health measures (population since creation, last 90/365 days, first and
  // last populated month, adoption onset) all come from one shape of data: per field, how
  // many records created in each month carry a value. COUNT(field) grouped by created month
  // gives it for 50 fields a query; checkboxes are never null, so they are counted on
  // `= true` instead. Long text areas can't be counted at all and are left unscored.
  const measurable = f => f.aggregatable && f.type !== 'boolean' && f.type !== 'id' && !f.calculated && !f.autoNumber;
  const countable = f => f.aggregatable && f.type !== 'boolean' && f.type !== 'id';
  const wantsFill = d => d.custom || KEY_OBJECTS.includes(d.name);
  const ym = r => r.y + '-' + String(r.m).padStart(2, '0');
  const BY_MONTH = ' GROUP BY CALENDAR_YEAR(CreatedDate), CALENDAR_MONTH(CreatedDate)';
  let fillQueries = 0, fillErrors = 0;
  async function monthBatch(obj, names) {
    try {
      fillQueries++;
      const rows = (await rest(soql('SELECT CALENDAR_YEAR(CreatedDate) y, CALENDAR_MONTH(CreatedDate) m, ' +
        names.map((n, i) => 'COUNT(' + n + ') c' + i).join(', ') + ' FROM ' + obj + BY_MONTH))).records;
      const out = {}; names.forEach((n, i) => { out[n] = {}; for (const r of rows) if (r['c' + i]) out[n][ym(r)] = r['c' + i]; });
      return out;
    } catch (e) {
      if (names.length > 1) {   // one bad field poisons the batch: split and retry
        const h = Math.ceil(names.length / 2);
        return Object.assign(await monthBatch(obj, names.slice(0, h)), await monthBatch(obj, names.slice(h)));
      }
      fillErrors++; return {};
    }
  }
  async function distinctBatch(obj, names) {
    try {
      fillQueries++;
      const r = (await rest(soql('SELECT ' + names.map((n, i) => 'COUNT_DISTINCT(' + n + ') d' + i).join(', ') + ' FROM ' + obj))).records[0];
      const out = {}; names.forEach((n, i) => { out[n] = r['d' + i]; }); return out;
    } catch (e) {
      if (names.length > 1) {
        const h = Math.ceil(names.length / 2);
        return Object.assign(await distinctBatch(obj, names.slice(0, h)), await distinctBatch(obj, names.slice(h)));
      }
      return {};
    }
  }
  async function countBatch(obj, names) {
    try {
      fillQueries++;
      const r = (await rest(soql('SELECT ' + names.map((n, i) => 'COUNT(' + n + ') c' + i).join(', ') + ' FROM ' + obj))).records[0];
      const out = {}; names.forEach((n, i) => { out[n] = r['c' + i]; }); return out;
    } catch (e) {
      if (names.length > 1) {
        const h = Math.ceil(names.length / 2);
        return Object.assign(await countBatch(obj, names.slice(0, h)), await countBatch(obj, names.slice(h)));
      }
      fillErrors++; return {};
    }
  }
  // -> { field: true } where every non-null value is the same
  async function minMaxBatch(obj, names) {
    try {
      fillQueries++;
      const r = (await rest(soql('SELECT ' + names.map((n, i) => 'MIN(' + n + ') a' + i + ', MAX(' + n + ') b' + i).join(', ') + ' FROM ' + obj))).records[0];
      // true: one value only; false: MIN ≠ MAX, so at least two
      const out = {}; names.forEach((n, i) => { if (r['a' + i] != null) out[n] = r['a' + i] === r['b' + i]; }); return out;
    } catch (e) {
      if (names.length > 1) {
        const h = Math.ceil(names.length / 2);
        return Object.assign(await minMaxBatch(obj, names.slice(0, h)), await minMaxBatch(obj, names.slice(h)));
      }
      return {};
    }
  }
  const fills = {};
  await pool(described.filter(wantsFill), 4, async d => {
    let rec;
    try { rec = (await rest(soql('SELECT CALENDAR_YEAR(CreatedDate) y, CALENDAR_MONTH(CreatedDate) m, COUNT(Id) n FROM ' + d.name + BY_MONTH))).records; fillQueries++; }
    catch {
      // some objects can't be grouped by created month (no CreatedDate, or Salesforce refuses);
      // keep plain record and field counts for them, without the monthly measures or a score
      let n;
      try { n = (await rest(soql('SELECT COUNT() FROM ' + d.name))).totalSize; fillQueries++; } catch { return; }
      const f = { records: n, months: {}, fields: {}, byMonth: {}, distinct: {}, single: {}, sampled: {} };
      const names = d.fields.filter(measurable).map(x => x.name);
      for (let i = 0; n > 0 && i < names.length; i += 50) Object.assign(f.fields, await countBatch(d.name, names.slice(i, i + 50)));
      fills[d.name] = f;
      return;
    }
    const f = { records: 0, months: {}, fields: {}, byMonth: {}, distinct: {}, single: {}, sampled: {} };
    for (const r of rec) { f.months[ym(r)] = r.n; f.records += r.n; }
    if (f.records > 0) {
      const names = d.fields.filter(countable).map(x => x.name);
      for (let i = 0; i < names.length; i += 50) Object.assign(f.byMonth, await monthBatch(d.name, names.slice(i, i + 50)));
      // one query per field for what COUNT() can't do: checkboxes (= true) and fields that can be
      // filtered but not counted, such as multi-select picklists (!= null)
      const filterOnly = d.fields.filter(x => x.type === 'boolean' || (!x.aggregatable && x.filterable && !['id', 'address', 'location'].includes(x.type)));
      await pool(filterOnly, 3, async b => {
        try {
          fillQueries++;
          const rows = (await rest(soql('SELECT CALENDAR_YEAR(CreatedDate) y, CALENDAR_MONTH(CreatedDate) m, COUNT(Id) n FROM ' +
            d.name + ' WHERE ' + b.name + (b.type === 'boolean' ? ' = true' : ' != null') + BY_MONTH))).records;
          f.byMonth[b.name] = {}; for (const r of rows) f.byMonth[b.name][ym(r)] = r.n;
        } catch { fillErrors++; }
      });
      const groupable = d.fields.filter(x => x.groupable && x.type !== 'boolean' && x.type !== 'id').map(x => x.name);
      for (let i = 0; i < groupable.length; i += 50) Object.assign(f.distinct, await distinctBatch(d.name, groupable.slice(i, i + 50)));
      // numbers, currency and date/times can't be COUNT_DISTINCT-ed; MIN = MAX still proves a single value
      const ungroupable = d.fields.filter(x => x.aggregatable && !x.groupable && x.type !== 'boolean' && x.type !== 'id').map(x => x.name);
      for (let i = 0; i < ungroupable.length; i += 50) Object.assign(f.single, await minMaxBatch(d.name, ungroupable.slice(i, i + 50)));
      // …and information credit tops out at 5 distinct values, so for the rest the newest
      // 2,000 records are enough: 5+ values there settles it without an exact count
      const unknown = d.fields.filter(x => x.type !== 'boolean' && x.type !== 'id' && !['address', 'location', 'base64'].includes(x.type) &&
        f.distinct[x.name] == null && f.single[x.name] !== true).map(x => x.name);
      for (let i = 0; i < unknown.length; i += 50) {
        const names = unknown.slice(i, i + 50);
        try {
          fillQueries++;
          const rows = (await rest(soql('SELECT ' + names.join(', ') + ' FROM ' + d.name + ' ORDER BY CreatedDate DESC LIMIT 2000'))).records;
          for (const n of names) {
            const vals = new Set(rows.map(r => r[n]).filter(v => v != null && v !== '').map(v => JSON.stringify(v)));
            // only 5+ is conclusive; a lower count in the sample would understate the field
            if (vals.size >= 5) f.sampled[n] = 5;
          }
        } catch { /* fields that can't be selected together simply stay unknown */ }
      }
      for (const [n, m] of Object.entries(f.byMonth)) f.fields[n] = Object.values(m).reduce((a, b) => a + b, 0);
    }
    fills[d.name] = f;
  });
  console.log('fill rates for', Object.keys(fills).length, 'objects |', fillQueries, 'queries,', fillErrors, 'fields unmeasurable');

  // ---- references: page layouts (every field) and the dependency graph (custom fields) ----
  // Layout counts come from the layouts themselves, because the dependency graph doesn't
  // track standard fields; everything else (flows, formulas, Apex, reports, …) comes from
  // MetadataComponentDependency, keyed by the CustomField Id.
  const layoutRows = await qAll(tq('SELECT Id, TableEnumOrId FROM Layout'));
  const LAYOUTS = {};   // obj.field -> number of layouts it appears on
  await pool(layoutRows, 6, async l => {
    try {
      const m = (await rest(tq("SELECT Metadata FROM Layout WHERE Id = '" + l.Id + "'"))).records[0].Metadata;
      const obj = byDurable[l.TableEnumOrId] || l.TableEnumOrId, seen = new Set();
      for (const s of m.layoutSections || []) for (const c of s.layoutColumns || []) for (const it of c.layoutItems || [])
        if (it.field) seen.add(it.field);
      for (const fld of seen) LAYOUTS[obj + '.' + fld] = (LAYOUTS[obj + '.' + fld] || 0) + 1;
    } catch { /* a layout that can't be read just contributes nothing */ }
  });
  const cfIds = cfRows.filter(c => c.EntityDefinition).map(c => ({ id: c.Id,
    key: c.EntityDefinition.QualifiedApiName + '.' + nsKey(c.NamespacePrefix, c.DeveloperName) + '__c' }));
  const REFS = {};      // obj.field -> { flows, formulas, other, reports }
  const keyOfId = Object.fromEntries(cfIds.map(c => [c.id.slice(0, 15), c.key]));
  async function depBatch(ids) {
    const rows = await qAll(tq("SELECT MetadataComponentType, MetadataComponentName, RefMetadataComponentId FROM MetadataComponentDependency " +
      "WHERE RefMetadataComponentType = 'CustomField' AND RefMetadataComponentId IN (" + ids.map(i => "'" + i + "'").join(',') + ')'));
    if (rows.length >= 2000 && ids.length > 1) {   // the dependency API stops at 2,000 rows: split and ask again
      const h = Math.ceil(ids.length / 2); await depBatch(ids.slice(0, h)); await depBatch(ids.slice(h)); return;
    }
    for (const r of rows) {
      const k = keyOfId[String(r.RefMetadataComponentId).slice(0, 15)]; if (!k) continue;
      const e = REFS[k] = REFS[k] || { flows: 0, formulas: 0, other: 0, reports: 0, seen: new Set() };
      const t = r.MetadataComponentType;
      if (t === 'Layout') continue;   // counted from the layouts themselves
      // every flow *version* is its own row; a flow counts once, as in the workbooks
      if (e.seen.has(t + '|' + r.MetadataComponentName)) continue;
      e.seen.add(t + '|' + r.MetadataComponentName);
      if (t === 'Flow') e.flows++; else if (t === 'CustomField') e.formulas++; else { e.other++; if (t === 'Report') e.reports++; }
    }
  }
  const idBatches = [];
  for (let i = 0; i < cfIds.length; i += 100) idBatches.push(cfIds.slice(i, i + 100).map(c => c.id));
  await pool(idBatches, 4, async b => { try { await depBatch(b); } catch (e) { console.log('  dependency batch failed', String(e.message).slice(0, 80)); } });
  console.log('layouts read', layoutRows.length, '| fields with dependency references', Object.keys(REFS).length);

  // ---- last populated ----
  // Salesforce keeps no "last set" date per field. Two signals instead, for the org's own
  // custom fields that have data: the newest record holding a value (by CreatedDate), and,
  // where Field History Tracking is on, the newest tracked change to the field.
  const own = f => f.custom && f.name.split('__').length < 3;
  const sobjects = new Set((await rest('/services/data/' + API + '/sobjects')).sobjects.map(s => s.name));
  // OpportunityHistory is stage history with no Field column, so FieldHistory is tried
  // first and each candidate in turn until one answers
  const historyOf = api => [api.replace(/__c$/, '__History'), api + 'FieldHistory', api + 'History']
    .filter(n => n !== api && sobjects.has(n));
  const LAST = {}, NEWEST = {}, HIST = {};
  let lastQueries = 0, lastErrors = 0;
  const withData = described.filter(d => fills[d.name] && fills[d.name].records > 0 &&
    d.fields.some(f => own(f) && measurable(f) && fills[d.name].fields[f.name] > 0));
  await pool(withData, 4, async d => {
    const newest = q => rest(soql(q)).then(r => (r.records[0] ? day(r.records[0].CreatedDate) : '')).catch(() => null);
    NEWEST[d.name] = await newest('SELECT CreatedDate FROM ' + d.name + ' ORDER BY CreatedDate DESC LIMIT 1');
    for (const h of historyOf(d.name)) {
      try {
        for (const r of (await rest(soql('SELECT Field, MAX(CreatedDate) d FROM ' + h + ' GROUP BY Field'))).records)
          HIST[d.name + '.' + r.Field] = day(r.d);
        break;
      } catch { /* wrong table, or too large to aggregate; the record date still stands */ }
    }
    const names = d.fields.filter(f => own(f) && measurable(f) && fills[d.name].fields[f.name] > 0).map(f => f.name);
    await pool(names, 3, async n => {
      lastQueries++;
      const v = await newest('SELECT CreatedDate FROM ' + d.name + ' WHERE ' + n + ' != null ORDER BY CreatedDate DESC LIMIT 1');
      if (v == null) lastErrors++; else LAST[d.name + '.' + n] = v;
    });
  });
  console.log('last populated for', Object.keys(LAST).length, 'fields |', lastQueries, 'queries,', lastErrors, 'failed |',
    Object.keys(HIST).length, 'field-history entries');

  // ---- Field Health measures (same definitions as the "Field Health Analysis" workbooks) ----
  // Windows use whole months: "last 90d" is the three most recent complete months and
  // "last 365d" the twelve, so records from the current, partial month are left out of both.
  const now = new Date(), addM = (y, m, k) => { const d = new Date(Date.UTC(y, m - 1 + k, 1)); return d.toISOString().slice(0, 7); };
  const lastComplete = addM(now.getUTCFullYear(), now.getUTCMonth() + 1, -1);
  const [lcY, lcM] = lastComplete.split('-').map(Number);
  const win3 = new Set([0, 1, 2].map(k => addM(lcY, lcM, -k)));
  const win12 = new Set([...Array(12).keys()].map(k => addM(lcY, lcM, -k)));
  const monthsBetween = (a, b) => { const [ay, am] = a.split('-').map(Number), [by, bm] = b.split('-').map(Number); return (by - ay) * 12 + (bm - am); };
  function fhFor(d, f, fl, created) {
    if (!fl || !fl.records || !fl.byMonth[f.name]) return null;
    const pop = fl.byMonth[f.name], cm = created ? created.slice(0, 7) : '';
    const months = Object.keys(fl.months).sort();
    let O = 0, P = 0, r3n = 0, r3d = 0, s12n = 0, s12d = 0, T = '', U = '', W = '';
    for (const k of months) {
      const rec = fl.months[k], p = pop[k] || 0;
      // first/last populated and adoption onset run to the last complete month, as the
      // workbooks' as-of date did, so a mid-month scan judges recency the same way
      if (k <= lastComplete) {
        if (p && !T) T = k;
        if (p) U = k;
        if (!W && p && p / rec >= 0.01) W = k;
      }
      if (cm && k < cm) continue;   // "since creation": records created in or after the field's creation month
      O += rec; P += p;
      if (win3.has(k)) { r3d += rec; r3n += p; }
      if (win12.has(k)) { s12d += rec; s12n += p; }
    }
    let X = null;   // adoption lag: field creation to the end of its first month of real use
    if (W && created) X = Math.max(0, Math.round((Date.UTC(+W.slice(0, 4), +W.slice(5, 7), 1) - Date.parse(created)) / 864e5) - 1);
    const refs = REFS[d.name + '.' + f.name] || { flows: 0, formulas: 0, other: 0, reports: 0 };
    // address sub-fields take the layout count of their parent Address field
    const layouts = LAYOUTS[d.name + '.' + f.name] || (f.compoundFieldName ? LAYOUTS[d.name + '.' + f.compoundFieldName] || 0 : 0);
    const M = fl.fields[f.name] || 0;
    return {
      M, O, P, Q: O ? 100 * P / O : 0, R: r3d ? 100 * r3n / r3d : 0, S: s12d ? 100 * s12n / s12d : 0,
      T, U, V: U ? Math.max(0, monthsBetween(U, lastComplete)) : 999, W, X,
      // distinct values: exact where COUNT_DISTINCT works; otherwise 0 / 1 when provable, else unknown
      Y: f.type === 'boolean' ? (M > 0 ? 1 : 0) : fl.distinct[f.name] != null ? fl.distinct[f.name]
        : M === 0 ? 0 : fl.single[f.name] === true ? 1 : fl.sampled[f.name] || null,
      yAtLeast: fl.distinct[f.name] == null && !!fl.sampled[f.name],   // "5+" from the sample, not an exact count
      flows: refs.flows, formulas: refs.formulas, layouts, other: refs.other, reports: refs.reports,
      formula: !!f.calculated, checkbox: f.type === 'boolean', required: !f.nillable,
    };
  }

  // ---- assemble ----
  const kindOf = f => {
    if (f.autoNumber) return 'autonumber';
    if (f.custom && f.calculated && !f.calculatedFormula) return 'rollup';
    if (f.type === 'reference' && f.relationshipOrder != null) return 'masterdetail';
    if (f.type === 'reference' && f.extraTypeInfo === 'externallookup') return 'externallookup';
    if (f.extraTypeInfo === 'richtextarea') return 'richtext';
    return '';
  };
  const objects = described.map(d => {
    const co = d.custom ? coFor(d.name) : null, fl = fills[d.name];
    return {
      api: d.name, label: d.label, custom: !!d.custom,
      desc: co ? redact(co.desc).text : '', created: co ? co.created : '', createdBy: co ? co.createdBy : '',
      records: fl ? fl.records : null, newestRecord: NEWEST[d.name] || '', limits: LIM[d.name] || {},
      fields: d.fields.map(f => {
        const cf = CF[d.name + '.' + f.name] || {};
        // credentials never reach the snapshot; what kind was found is kept for the SEC check
        const fm = redact(f.calculatedFormula), ds = redact(cf.desc), hp = redact(f.inlineHelpText || cf.help);
        const secrets = [...new Set([...fm.kinds, ...ds.kinds, ...hp.kinds])];
        return {
          name: f.name, label: f.label, type: f.type, kind: kindOf(f), custom: !!f.custom,
          len: f.length || f.precision || 0, req: !f.nillable && f.type !== 'boolean' && !f.defaultedOnCreate,
          uniq: !!f.unique, extId: !!f.externalId,
          formula: fm.text, desc: ds.text, help: hp.text, secrets,
          ref: f.referenceTo || [], picks: (f.picklistValues || []).filter(v => v.active).length,
          created: cf.created || '', createdBy: cf.createdBy || '', modified: cf.modified || '', modifiedBy: cf.modifiedBy || '',
          filled: fl && fl.fields[f.name] != null ? fl.fields[f.name] : (fl && fl.records === 0 ? 0 : null),
          measurable: !!(fl && measurable(f)),
          lastRecord: LAST[d.name + '.' + f.name] || '', lastChange: HIST[d.name + '.' + f.name] || '',
          fh: fhFor(d, f, fl, cf.created),
        };
      }),
    };
  });

  const out = { org: { id: PREFIX, alias: ALIAS, name: orgRow.Name, edition: orgRow.OrganizationType, scanned: new Date().toISOString() },
    packages, automation, objects };
  fs.writeFileSync(OUT + '/' + PREFIX + '_tech.json', JSON.stringify(out));
  console.log(PREFIX + ': ' + objects.length + ' objects, ' + objects.reduce((a, o) => a + o.fields.length, 0) +
    ' fields in ' + Math.round((Date.now() - t0) / 1000) + 's -> ' + PREFIX + '_tech.json');
})().catch(e => { console.error('FATAL', e); process.exit(1); });
