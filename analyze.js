// Run the health checks over both org scans and write health.json, plus one line per
// run to history.json so the page can show movement since the previous scan.
// Every check is defined once, in CHECKS; a finding is { check, org, obj, field?, detail }.
const fs = require('fs');
const { MODEL, score: fieldScore } = require('./fieldscore');
const OUT = __dirname.split(String.fromCharCode(92)).join('/');

const CHECKS = [
  // security
  { code: 'SEC_SECRET', cat: 'Security', sev: 'high', title: 'Credential written into a formula, description or help text',
    why: 'Anyone with Setup access, and any tool that reads metadata, can copy it. The value is blanked out in this dictionary.',
    fix: 'Move it to a Named Credential or protected custom metadata, then have the key rotated. For a managed package, raise it with the vendor.' },
  // documentation
  { code: 'DOC_FIELD_DESC', cat: 'Documentation', sev: 'medium', title: 'Custom field has no description',
    why: 'Nobody can tell what the field is for or whether it is safe to change or delete.',
    fix: 'Add a description in Setup: what it holds, who fills it in, and which process uses it.' },
  { code: 'DOC_FIELD_HELP', cat: 'Documentation', sev: 'low', title: 'Input field has no help text',
    why: 'Users filling in the record get no guidance on the hover icon.',
    fix: 'Add help text where the field is on a page layout users fill in.' },
  { code: 'DOC_OBJ_DESC', cat: 'Documentation', sev: 'medium', title: 'Custom object has no description',
    why: 'The purpose of the object is undocumented.', fix: 'Add a description to the object in Object Manager.' },
  // naming
  { code: 'NAME_MISMATCH', cat: 'Naming', sev: 'medium', title: 'Field label does not match its API name',
    why: 'The label was usually changed after creation, so reports, flows and code refer to a name users no longer see.',
    fix: 'Confirm the field still means what the API name says; correct the label, or note the history in the description.' },
  { code: 'NAME_PARTIAL', cat: 'Naming', sev: 'low', title: 'Field label only partly matches its API name',
    why: 'Abbreviations or extra words make the field harder to find by API name.', fix: 'Usually fine; align them when convenient.' },
  { code: 'NAME_DUP_LABEL', cat: 'Naming', sev: 'medium', title: 'Two or more fields share the same label',
    why: 'Users and report builders cannot tell the fields apart, and data ends up split between them.',
    fix: 'Rename one, or retire the one that is not used.' },
  { code: 'NAME_CLEANUP', cat: 'Naming', sev: 'medium', title: 'Field is marked old, test or do-not-use',
    why: 'The name or description says it should not be used, but it still exists.',
    fix: 'Check where it is used; if nothing depends on it, delete it.' },
  { code: 'NAME_VERSIONED', cat: 'Naming', sev: 'low', title: 'API name looks like a copy or second version',
    why: 'Names like _2, _v2, _New or _Copy usually mean an older field was replaced but not removed.',
    fix: 'Check whether the original is still needed.' },
  // field health — the Action column of the Field Health Analysis workbooks (fieldscore.js),
  // for fields the org built itself
  { code: 'FH_RETIRE', cat: 'Field health', sev: 'high', title: 'Retire candidate',
    why: 'Past the grace period with no measurable current value: never adopted, dormant 12+ months, or a single value only.',
    fix: 'Verify against reports, dashboards and integrations, then remove it from layouts and delete it. Required fields need the requirement resolved first.' },
  { code: 'FH_STOPPED', cat: 'Field health', sev: 'medium', title: 'Recently stopped being populated',
    why: 'Used since it was created, but no record from the last three complete months has a value.',
    fix: 'Investigate — did a process, flow or integration break?' },
  { code: 'FH_RARE', cat: 'Field health', sev: 'medium', title: 'Rarely used (under 1% of records since creation)',
    why: 'Still populated now and then, but on very few records.', fix: 'Review — consolidate with a similar field or retire.' },
  { code: 'FH_FORMULA', cat: 'Field health', sev: 'low', title: 'Formula with no usage signal',
    why: 'A formula is filled on every record by definition, so only references and its values show use: this one has no references, or always returns the same value.',
    fix: 'Verify it is used in reports or list views before deleting.' },
  { code: 'FH_REQ_EMPTY', cat: 'Field health', sev: 'medium', title: 'Required field that is never populated',
    why: 'Salesforce requires a value, yet no record has one.', fix: 'Check how records are saved without it; resolve the requirement or the field.' },
  { code: 'FH_LATE', cat: 'Field health', sev: 'low', title: 'Adopted more than a year after it was created',
    why: 'The field sat unused for over a year before real use began (1% of a month’s records).', fix: 'Informational: check it was rolled out as intended.' },
  { code: 'USE_EMPTY_OBJECT', cat: 'Usage', sev: 'medium', title: 'Custom object has no records',
    why: 'An object nobody stores data in is usually unfinished or abandoned, or belongs to an unused app.',
    fix: 'Confirm it is not new or awaiting a launch, then delete it or uninstall its package.' },
  // limits
  { code: 'LIM_NEAR', cat: 'Limits', sev: 'high', title: 'Object is close to a Salesforce limit',
    why: 'Once a limit is reached, new fields or roll-ups cannot be added to the object.',
    fix: 'Retire unused fields on this object before the next build needs one.' },
  { code: 'LIM_FORMULA_LONG', cat: 'Limits', sev: 'medium', title: 'Formula is close to the 3,900-character limit',
    why: 'Long formulas are hard to maintain and can no longer be extended.', fix: 'Split it into helper formula fields or move the logic to a flow.' },
  { code: 'LIM_PICKLIST_BIG', cat: 'Limits', sev: 'low', title: 'Picklist has more than 200 active values',
    why: 'Very long picklists are hard to use and report on.', fix: 'Consider a lookup to a reference object, or deactivate stale values.' },
  // automation
  { code: 'AUTO_WFR_ACTIVE', cat: 'Automation', sev: 'high', title: 'Active workflow rule',
    why: 'Salesforce has retired Workflow Rules; they no longer get fixes and should move to Flow.',
    fix: 'Use Setup > Migrate to Flow, test, then deactivate the rule.' },
  { code: 'AUTO_PB_ACTIVE', cat: 'Automation', sev: 'high', title: 'Active Process Builder',
    why: 'Process Builder is retired and is slower than a record-triggered flow.', fix: 'Migrate to Flow, then deactivate.' },
  { code: 'AUTO_MANY_FLOWS', cat: 'Automation', sev: 'medium', title: 'Object runs many record-triggered flows',
    why: 'More than five flows on the same save makes the run order and failures hard to follow.',
    fix: 'Consolidate where possible, and set Trigger Order on the ones that remain.' },
  { code: 'AUTO_MIXED', cat: 'Automation', sev: 'low', title: 'Object has both Apex triggers and record-triggered flows',
    why: 'Logic split between code and flows is harder to debug.', fix: 'Document which handles what; keep new logic in one place.' },
  { code: 'AUTO_INACTIVE', cat: 'Automation', sev: 'low', title: 'Inactive automation left behind',
    why: 'Inactive flows, Process Builders, workflow rules and validation rules clutter Setup and get reactivated by mistake.',
    fix: 'Delete the ones nobody plans to bring back.' },
  // packages
  { code: 'PKG_UNUSED', cat: 'Packages', sev: 'medium', title: 'Installed package stores no data',
    why: 'Every object the package adds is empty, so the app may not be in use.',
    fix: 'Confirm with its owner, then uninstall it (removes its fields from layouts and reports).' },
];
const CHECK = Object.fromEntries(CHECKS.map(c => [c.code, c]));

const STOP = new Set(['of', 'the', 'a', 'an', 'to', 'for', 'and', 'is', 'in', 'on', 'at', 'by', 'or', 'with']);
const labelTokens = s => String(s || '').replace(/&/g, ' and ').replace(/%/g, ' percent ').toLowerCase()
  .split(/[^a-z0-9]+/).filter(Boolean);
const apiTokens = s => String(s || '').replace(/__c$/i, '')
  .replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
// 'match' | 'partial' | 'mismatch' — word order and filler words are ignored
function nameMatch(label, api) {
  const L = labelTokens(label), A = apiTokens(api);
  if (L.join('') === A.join('')) return 'match';
  const l = new Set(L.filter(t => !STOP.has(t))), a = new Set(A.filter(t => !STOP.has(t)));
  if (!l.size || !a.size) return 'match';
  const same = [...l].filter(t => a.has(t)).length;
  if (same === l.size && same === a.size) return 'match';
  const lj = [...l].join(''), aj = [...a].join('');
  if (same / Math.max(l.size, a.size) >= 0.5 || lj.includes(aj) || aj.includes(lj)) return 'partial';
  return 'mismatch';
}
// label/API name: words that mark a field as superseded. Descriptions talk about "the old system" and
// "testing" all the time, so they only count when they say so outright (CLEANUP_DESC).
const CLEANUP = /\b(do not use|dont use|don't use|deprecated|obsolete|legacy|unused|old|retired|delete|del|temp|test|zz+)\b|^zz|^x_/i;
const CLEANUP_DESC = /\b(do not use|don't use|dont use|deprecated|obsolete|no longer used|not used|to be deleted|retired)\b/i;
const VERSIONED = /(_v?\d+|\d+|_new|_old|_copy|_backup|_bak|_temp)__c$/i;

const pkgOf = name => { const p = name.split('__'); return p.length >= 3 ? p[0] : ''; };
const isManagedField = f => f.custom && !!pkgOf(f.name);
const isInputField = f => !f.formula && !['rollup', 'autonumber'].includes(f.kind);
const daysBefore = (d, ref) => (Date.parse(ref) - Date.parse(d)) / 864e5;

const findings = [], summary = {}, scores = { sbu: {}, xbu: {} };
for (const id of ['sbu', 'xbu']) {
  const S = JSON.parse(fs.readFileSync(`${OUT}/${id}_tech.json`, 'utf8'));
  const scanned = S.org.scanned;
  const add = (check, obj, field, detail, extra) => findings.push(Object.assign({ check, org: id, obj, field: field || '', detail: detail || '' }, extra || {}));
  const st = { org: S.org, customFields: 0, documented: 0, nameChecked: 0, nameOk: 0,
    scored: 0, bands: {}, ownScored: 0, ownBands: {}, retire: 0,
    objects: S.objects.length, fields: S.objects.reduce((a, o) => a + o.fields.length, 0) };

  for (const o of S.objects) {
    // object-level
    if (o.custom && !pkgOf(o.api) && !o.desc && !/__mdt$/.test(o.api)) add('DOC_OBJ_DESC', o.api);
    // package objects are often empty by design (settings, queues); PKG_UNUSED covers a whole unused package
    if (o.custom && !pkgOf(o.api) && o.records === 0 && !/__mdt$/.test(o.api) && (!o.created || daysBefore(o.created, scanned) > 90))
      add('USE_EMPTY_OBJECT', o.api, '', 'created ' + (o.created || 'unknown') + (o.createdBy ? ' by ' + o.createdBy : ''));
    for (const [type, l] of Object.entries(o.limits || {})) {
      if (!['CustomFields', 'RollupSummary', 'CustomRelationship'].includes(type) || !l.max) continue;
      const pct = l.used / l.max;
      if (pct >= 0.8) add('LIM_NEAR', o.api, '', ({ CustomFields: 'Custom fields', RollupSummary: 'Roll-up summary fields',
        CustomRelationship: 'Relationship fields' })[type] + ': ' + l.used + ' of ' + l.max + ' used', { pct: Math.round(pct * 100) });
    }
    // duplicate labels (case-insensitive) among all fields
    const byLabel = {};
    for (const f of o.fields) (byLabel[f.label.trim().toLowerCase()] = byLabel[f.label.trim().toLowerCase()] || []).push(f);
    // only worth flagging when the org built at least one of the clashing fields itself
    for (const group of Object.values(byLabel)) if (group.length > 1 && group.some(f => f.custom && !isManagedField(f)))
      for (const f of group) add('NAME_DUP_LABEL', o.api, f.name, 'Same label as ' + group.filter(g => g !== f).map(g => g.name).join(', '));

    for (const f of o.fields) {
      // checked on every field, managed ones included: a leaked key matters whoever wrote it
      if (f.secrets && f.secrets.length) add('SEC_SECRET', o.api, f.name, f.secrets.join(', ') + (pkgOf(f.name) ? ' · ' + pkgOf(f.name) + ' package' : ''));
      if (f.formula && f.formula.length > 3000) add('LIM_FORMULA_LONG', o.api, f.name, f.formula.length.toLocaleString('en-US') + ' characters');
      if (f.picks > 200) add('LIM_PICKLIST_BIG', o.api, f.name, f.picks + ' active values');
      if (!f.custom || isManagedField(f)) continue;
      // everything below is about fields this org built itself
      st.customFields++;
      if (f.desc) st.documented++; else add('DOC_FIELD_DESC', o.api, f.name);
      if (isInputField(f) && !f.help) add('DOC_FIELD_HELP', o.api, f.name);
      const m = nameMatch(f.label, f.name);
      st.nameChecked++; if (m === 'match') st.nameOk++;
      if (m === 'mismatch') add('NAME_MISMATCH', o.api, f.name, '“' + f.label + '” vs ' + f.name);
      if (m === 'partial') add('NAME_PARTIAL', o.api, f.name, '“' + f.label + '” vs ' + f.name);
      const hint = (f.label + ' ' + f.name.replace(/__c$/, '').replace(/_/g, ' ')).match(CLEANUP) || f.desc.match(CLEANUP_DESC);
      if (hint) add('NAME_CLEANUP', o.api, f.name, 'mentions “' + hint[0].trim() + '”');
      if (VERSIONED.test(f.name)) add('NAME_VERSIONED', o.api, f.name);
    }

    // Field Health score for every measured field (standard and managed too, as in the workbooks);
    // findings only for the org's own custom fields, which are the ones it can act on
    for (const f of o.fields) {
      if (!f.fh) continue;
      const origin = !f.custom ? 'Standard' : isManagedField(f) ? 'Managed Package' : 'Custom';
      const age = f.created ? Math.round(daysBefore(f.created, scanned)) : null;
      const s = fieldScore(f.fh, f, age, origin);
      scores[id][o.api + '.' + f.name] = s;
      st.scored++; st.bands[s.band] = (st.bands[s.band] || 0) + 1;
      if (origin !== 'Custom') continue;
      st.ownScored++; st.ownBands[s.band] = (st.ownBands[s.band] || 0) + 1;
      const fh = f.fh, pctS = v => (v < 1 && v > 0 ? v.toFixed(2) : String(Math.round(v))) + '%';
      const last = fh.U ? 'last populated ' + fh.U + (fh.V ? ' (' + fh.V + ' mo ago)' : '') : 'never populated';
      const tag = 'score ' + s.score + ' · ' + s.cls;
      if (s.action === 'Retire candidate' || s.action === 'Required field — resolve requirement first') {
        st.retire++;
        add('FH_RETIRE', o.api, f.name, tag + ' · ' + last + (s.action !== 'Retire candidate' ? ' · required' : ''));
      } else if (s.cls === 'Recently Stopped') add('FH_STOPPED', o.api, f.name, tag + ' · ' + pctS(fh.Q) + ' since creation, 0% last 3 months · ' + last);
      else if (s.cls === 'Rarely Used') add('FH_RARE', o.api, f.name, tag + ' · ' + pctS(fh.Q) + ' since creation');
      else if (s.action === 'Verify formula usage') add('FH_FORMULA', o.api, f.name, tag + ' · ' + s.refs + ' reference' + (s.refs === 1 ? '' : 's'));
      if (fh.required && fh.M === 0 && !fh.formula) add('FH_REQ_EMPTY', o.api, f.name);
      if (fh.X != null && fh.X > 365) add('FH_LATE', o.api, f.name, fh.X.toLocaleString('en-US') + ' days from creation to first real use (' + fh.W + ')');
    }
  }

  // automation
  const A = S.automation;
  for (const w of A.workflowRules) w.active ? add('AUTO_WFR_ACTIVE', w.obj, '', w.name) : add('AUTO_INACTIVE', w.obj, '', 'Workflow rule: ' + w.name);
  for (const f of A.flows) {
    if (f.process === 'Workflow') f.active ? add('AUTO_PB_ACTIVE', f.obj, '', f.label) : add('AUTO_INACTIVE', f.obj, '', 'Process Builder: ' + f.label);
    else if (!f.active && !pkgOf(f.api)) add('AUTO_INACTIVE', f.obj, '', 'Flow: ' + f.label);
  }
  for (const v of A.validationRules) if (!v.active) add('AUTO_INACTIVE', v.obj, '', 'Validation rule: ' + v.name);
  const rtf = {}, trg = {};
  for (const f of A.flows) if (f.active && /^Record/.test(f.trigger)) (rtf[f.obj + '|' + f.trigger] = rtf[f.obj + '|' + f.trigger] || []).push(f.label);
  for (const t of A.triggers) if (t.active) (trg[t.obj] = trg[t.obj] || []).push(t.name);
  const TIMING = { RecordBeforeSave: 'before save', RecordAfterSave: 'after save', RecordBeforeDelete: 'before delete' };
  for (const [k, list] of Object.entries(rtf)) if (list.length > 5) {
    const [obj, t] = k.split('|'); add('AUTO_MANY_FLOWS', obj, '', list.length + ' flows run ' + (TIMING[t] || t));
  }
  const flowObjs = new Set(Object.keys(rtf).map(k => k.split('|')[0]));
  for (const [obj, names] of Object.entries(trg)) if (flowObjs.has(obj))
    add('AUTO_MIXED', obj, '', names.length + ' trigger' + (names.length > 1 ? 's' : '') + ' (' + names.join(', ') + ') + record-triggered flows');

  // packages: every object it adds has zero records
  for (const p of S.packages) {
    if (!p.ns) continue;
    const objs = S.objects.filter(o => pkgOf(o.api) === p.ns && o.records != null && !/__mdt$/.test(o.api));
    if (objs.length && objs.every(o => o.records === 0))
      add('PKG_UNUSED', '', '', p.name + ' (' + p.ns + ', ' + objs.length + ' object' + (objs.length > 1 ? 's' : '') + ' all empty)', { pkg: p.ns });
  }
  st.packages = S.packages.length;
  summary[id] = st;
}

// counts per org per check, and the trend line
const counts = {};
for (const f of findings) { const k = f.org + '|' + f.check; counts[k] = (counts[k] || 0) + 1; }
const today = new Date().toISOString().slice(0, 10);
const histPath = `${OUT}/history.json`;
const history = fs.existsSync(histPath) ? JSON.parse(fs.readFileSync(histPath, 'utf8')) : [];
const entry = { date: today, counts, stats: Object.fromEntries(Object.entries(summary).map(([k, s]) =>
  [k, { customFields: s.customFields, documented: s.documented, nameChecked: s.nameChecked, nameOk: s.nameOk,
    ownScored: s.ownScored, retire: s.retire, ownBands: s.ownBands }])) };
// a re-run on the same day replaces that day's line instead of adding another
if (history.length && history[history.length - 1].date === today) history[history.length - 1] = entry; else history.push(entry);
fs.writeFileSync(histPath, JSON.stringify(history, null, 1));

// scores, compactly: band / classification / action as indexes into lists stored once
const lists = { band: [], cls: [], action: [] };
const idx = (k, v) => { let i = lists[k].indexOf(v); if (i < 0) { i = lists[k].length; lists[k].push(v); } return i; };
const packed = {};
for (const [id, m] of Object.entries(scores)) {
  packed[id] = {};
  for (const [k, s] of Object.entries(m)) packed[id][k] = [s.score, idx('band', s.band), idx('cls', s.cls), idx('action', s.action),
    ...['population', 'recency', 'trend', 'info', 'integration', 'documentation'].map(p => s.parts[p])];
}
fs.writeFileSync(`${OUT}/health.json`, JSON.stringify({ generated: today, checks: CHECKS, model: MODEL, summary, findings,
  scores: { lists, byOrg: packed } }));

for (const id of ['sbu', 'xbu']) {
  const s = summary[id];
  console.log('\n== ' + id.toUpperCase() + ' ' + s.org.name + ' — ' + s.customFields + ' own custom fields, ' +
    Math.round(100 * s.documented / s.customFields) + '% documented, ' + Math.round(100 * s.nameOk / s.nameChecked) + '% names match | ' +
    s.scored + ' fields scored, ' + s.retire + ' own retire candidates | own bands ' + JSON.stringify(s.ownBands));
  for (const c of CHECKS) if (counts[id + '|' + c.code]) console.log('  ' + c.sev.padEnd(6) + ' ' + c.code.padEnd(17) + ' ' + counts[id + '|' + c.code]);
}
console.log('\nwrote health.json (' + findings.length + ' findings) and history.json (' + history.length + ' runs)');
