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
    .filter(e => !EXCL.test(e.QualifiedApiName));
  const byDurable = {};
  for (const e of ents) byDurable[e.DurableId] = e.QualifiedApiName;
  console.log('objects:', ents.length);

  // ---- custom field provenance: who created / last changed each field, and when ----
  const cfRows = await qAll(tq('SELECT DeveloperName, NamespacePrefix, Description, InlineHelpText, CreatedDate, ' +
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

  // ---- fill rates: record count per object, then COUNT(field) in batches ----
  // COUNT(field) counts non-null values. Checkboxes are never null and formulas are
  // computed, so neither is measured; long text areas don't support COUNT at all.
  const measurable = f => f.aggregatable && f.type !== 'boolean' && f.type !== 'id' && !f.calculated && !f.autoNumber;
  const wantsFill = d => d.custom || KEY_OBJECTS.includes(d.name);
  let fillQueries = 0, fillErrors = 0;
  async function countBatch(obj, names) {
    const q = 'SELECT ' + names.map((n, i) => 'COUNT(' + n + ') c' + i).join(', ') + ' FROM ' + obj;
    try {
      fillQueries++;
      const r = (await rest(soql(q))).records[0];
      const out = {}; names.forEach((n, i) => { out[n] = r['c' + i]; }); return out;
    } catch (e) {
      if (names.length > 1) {   // one bad field poisons the batch: split and retry
        const h = Math.ceil(names.length / 2);
        return Object.assign(await countBatch(obj, names.slice(0, h)), await countBatch(obj, names.slice(h)));
      }
      fillErrors++; return {};
    }
  }
  const fills = {};
  await pool(described.filter(wantsFill), 4, async d => {
    let n;
    try { n = (await rest(soql('SELECT COUNT() FROM ' + d.name))).totalSize; fillQueries++; }
    catch { return; }   // some objects can't be counted without a filter
    const f = { records: n, fields: {} };
    if (n > 0) {
      const names = d.fields.filter(measurable).map(x => x.name);
      for (let i = 0; i < names.length; i += 50) Object.assign(f.fields, await countBatch(d.name, names.slice(i, i + 50)));
    }
    fills[d.name] = f;
  });
  console.log('fill rates for', Object.keys(fills).length, 'objects |', fillQueries, 'queries,', fillErrors, 'fields unmeasurable');

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
      desc: co ? co.desc : '', created: co ? co.created : '', createdBy: co ? co.createdBy : '',
      records: fl ? fl.records : null, limits: LIM[d.name] || {},
      fields: d.fields.map(f => {
        const cf = CF[d.name + '.' + f.name] || {};
        return {
          name: f.name, label: f.label, type: f.type, kind: kindOf(f), custom: !!f.custom,
          len: f.length || f.precision || 0, req: !f.nillable && f.type !== 'boolean' && !f.defaultedOnCreate,
          uniq: !!f.unique, extId: !!f.externalId,
          formula: f.calculatedFormula || '', desc: cf.desc || '', help: f.inlineHelpText || cf.help || '',
          ref: f.referenceTo || [], picks: (f.picklistValues || []).filter(v => v.active).length,
          created: cf.created || '', createdBy: cf.createdBy || '', modified: cf.modified || '', modifiedBy: cf.modifiedBy || '',
          filled: fl && fl.fields[f.name] != null ? fl.fields[f.name] : (fl && fl.records === 0 ? 0 : null),
          measurable: !!(fl && measurable(f)),
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
