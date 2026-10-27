// Salesforce Health Dictionary — runs once window.P (the inflated payload) exists.
// Two views: the org-health landing page and the field explorer. Plain DOM, no framework.
(function () {
'use strict';
const P = window.P, ORDER = ['sbu', 'xbu'];
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nf = n => Number(n).toLocaleString('en-US');
const pct = (a, b) => (b ? Math.round(100 * a / b) : 0);
const SEV_RANK = { high: 0, medium: 1, low: 2 };
const SEV_LABEL = { high: 'High', medium: 'Medium', low: 'Low' };
const CHECKS = P.checks, CHK = {};
CHECKS.forEach((c, i) => { CHK[c.code] = c; c.i = i; });
const CATS = [...new Set(CHECKS.map(c => c.cat))];

// ---------------------------------------------------------------- data
const F_REQ = 1, F_UNIQ = 2, F_EXT = 4, F_CUSTOM = 8, F_MEAS = 16;
function decodeField(x) {
  return { name: x[0], label: x[1], type: x[2], kind: x[3] || '', len: x[4] || 0, flags: x[5] || 0,
    filled: x[6] == null || x[6] < 0 ? null : x[6], desc: x[7] || '', help: x[8] || '',
    created: x[9] || '', createdBy: x[10] || '', modified: x[11] || '', modifiedBy: x[12] || '',
    formulaLen: x[13] || 0, picks: x[14] || 0, ref: x[15] || [], lastRecord: x[16] || '', lastChange: x[17] || '',
    fh: decodeFh(x[18]), sc: decodeScore(x[19]) };
}
// Field Health measures and score, in the order build_health_html.js packs them
function decodeFh(a) {
  if (!a) return null;
  const k = ['M', 'O', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'yAtLeast', 'flows', 'formulas', 'layouts', 'other', 'reports', 'formula', 'checkbox', 'required'];
  const o = {}; k.forEach((n, i) => { o[n] = a[i]; }); return o;
}
function decodeScore(a) {
  if (!a) return null;
  const L = P.scoreLists;
  return { score: a[0], band: L.band[a[1]], cls: L.cls[a[2]], action: L.action[a[3]],
    parts: { Population: a[4], Recency: a[5], Trend: a[6], Information: a[7], Integration: a[8], Documentation: a[9] } };
}
const ORGS = {};
for (const o of P.orgs) ORGS[o.id] = { meta: o, objs: o.objs.map(t => ({ api: t.a, label: t.l, custom: !!t.c, desc: t.d || '',
  records: t.r == null ? null : t.r, newest: t.nr || '', lim: t.lim || {}, created: t.cr || '', createdBy: t.cb || '', auto: t.au || {},
  fields: t.f.map(decodeField) })) };

// findings: [checkIndex, org, obj, field, detail]
const FIND = {};   // org|obj|field -> [finding]
const FINDINGS = P.findings.map(x => ({ check: CHECKS[x[0]], org: x[1], obj: x[2], field: x[3], detail: x[4] }));
for (const f of FINDINGS) (FIND[f.org + '|' + f.obj + '|' + f.field] = FIND[f.org + '|' + f.obj + '|' + f.field] || []).push(f);
const findFor = (org, obj, field) => FIND[org + '|' + obj + '|' + (field || '')] || [];

// merged view: one object per API name, fields unioned, each field keeping its per-org versions
const COMBINED = (() => {
  const by = new Map();
  for (const id of ORDER) for (const o of ORGS[id].objs) {
    let e = by.get(o.api);
    if (!e) { e = { api: o.api, label: o.label, custom: o.custom, orgs: [], v: {}, fmap: new Map() }; by.set(o.api, e); }
    e.orgs.push(id); e.v[id] = o;
    for (const f of o.fields) {
      let m = e.fmap.get(f.name);
      if (!m) { m = { name: f.name, label: f.label, type: f.type, kind: f.kind, flags: f.flags, orgs: [], v: {} }; e.fmap.set(f.name, m); }
      m.orgs.push(id); m.v[id] = f;
      if (!m.desc && f.desc) m.desc = f.desc;
    }
  }
  return [...by.values()].map(e => ({ api: e.api, label: e.label, custom: e.custom, orgs: e.orgs, v: e.v,
    fields: [...e.fmap.values()] }));
})();
// single-org rows reuse the merged shape so every renderer handles one form
function orgView(id) {
  return ORGS[id].objs.map(o => ({ api: o.api, label: o.label, custom: o.custom, orgs: [id], v: { [id]: o },
    fields: o.fields.map(f => ({ name: f.name, label: f.label, type: f.type, kind: f.kind, flags: f.flags, desc: f.desc, orgs: [id], v: { [id]: f } })) }));
}

const pkgOf = n => { const p = String(n).split('__'); return p.length >= 3 ? p[0] : ''; };
const originOf = f => pkgOf(f.name) && (f.flags & F_CUSTOM) ? 'managed' : (f.flags & F_CUSTOM) ? 'custom' : 'standard';
const TYPE_NAME = { string: 'Text', textarea: 'Text Area', reference: 'Lookup', boolean: 'Checkbox', picklist: 'Picklist',
  multipicklist: 'Multi-Select Picklist', combobox: 'Picklist (editable)', double: 'Number', int: 'Number', long: 'Number',
  currency: 'Currency', percent: 'Percent', datetime: 'Date/Time', date: 'Date', time: 'Time', id: 'Record ID', url: 'URL',
  phone: 'Phone', email: 'Email', address: 'Address', location: 'Geolocation', encryptedstring: 'Text (Encrypted)', base64: 'File' };
const KIND_NAME = { autonumber: 'Auto Number', masterdetail: 'Master-Detail', externallookup: 'External Lookup', richtext: 'Rich Text Area' };
function friendlyType(f) {
  const t = (f.type || '').toLowerCase();
  if (KIND_NAME[f.kind]) return KIND_NAME[f.kind];
  let n = TYPE_NAME[t] || f.type || '—';
  if (t === 'textarea' && f.len > 255) n = 'Long Text Area';
  if (f.kind === 'rollup') return 'Roll-Up Summary (' + n + ')';
  if (f.formulaLen) return 'Formula (' + n + ')';
  if ((t === 'string' || t === 'textarea') && f.len) n += ' (' + nf(f.len) + ')';
  return n;
}
const orgBadge = orgs => orgs.length > 1 ? '<span class="orgtag both" title="In both SBU and XBU">Both</span>'
  : '<span class="orgtag ' + orgs[0] + '">' + orgs[0].toUpperCase() + '</span>';
const sevChip = s => '<span class="sev ' + s + '">' + SEV_LABEL[s] + '</span>';
const objLabel = api => { for (const id of ORDER) { const o = ORGS[id].objs.find(x => x.api === api); if (o) return o.label; } return api; };
const LABELS = {};   // obj.field -> label, for the landing page rows
for (const id of ORDER) for (const o of ORGS[id].objs) for (const f of o.fields) LABELS[o.api + '.' + f.name] = f.label;

// ---------------------------------------------------------------- landing: org health
function trend(now, before, goodUp, unit) {
  if (before == null) return '';   // first scan: nothing to compare with yet
  if (now === before) return '<span class="tr flat">no change since last scan</span>';
  const up = now > before, good = up === goodUp;
  return '<span class="tr ' + (good ? 'good' : 'bad') + '">' + (up ? '▲ ' : '▼ ') + nf(Math.abs(now - before)) + (unit || '') + ' since last scan</span>';
}
function scoreCard(id) {
  const s = P.summary[id], prev = P.prev && P.prev.stats && P.prev.stats[id], pc = P.prev && P.prev.counts;
  const high = FINDINGS.filter(f => f.org === id && f.check.sev === 'high').length;
  const highPrev = pc ? CHECKS.filter(c => c.sev === 'high').reduce((a, c) => a + (pc[id + '|' + c.code] || 0), 0) : null;
  const tile = (n, label, sub, cls) => '<div class="tile ' + (cls || '') + '"><b>' + n + '</b><span>' + label + '</span>' + (sub || '') + '</div>';
  const doc = pct(s.documented, s.customFields), name = pct(s.nameOk, s.nameChecked);
  return '<div class="csum" data-org="' + id + '"><div class="csum-h">' + orgBadge([id]) + '<b>' + esc(s.org.name) + '</b><span>' +
    esc(s.org.edition) + '</span></div><div class="tiles">' +
    tile(doc + '%', 'custom fields documented', trend(doc, prev ? pct(prev.documented, prev.customFields) : null, true, ' pts'), doc < 50 ? 'warn' : '') +
    tile(name + '%', 'labels match API names', trend(name, prev ? pct(prev.nameOk, prev.nameChecked) : null, true, ' pts')) +
    tile(nf(s.retire || 0), 'retire candidates (Field Health)', trend(s.retire || 0, prev && prev.retire != null ? prev.retire : null, false), s.retire ? 'warn' : '') +
    tile(nf(high), 'high-priority findings', trend(high, highPrev, false), high ? 'bad' : '') +
    '</div><div class="csum-t">' + nf(s.objects) + ' objects · ' + nf(s.fields) + ' fields · ' + nf(s.customFields) +
    ' custom fields built in-house · ' + nf(s.packages) + ' installed packages · scanned ' + esc(String(s.org.scanned).slice(0, 10)) + '</div></div>';
}

// one row per obj.field per check, remembering each org's detail
function groupRows(list) {
  const m = new Map();
  for (const f of list) {
    const k = f.obj + '|' + f.field;
    if (!m.has(k)) m.set(k, { obj: f.obj, field: f.field, orgs: [], detail: {} });
    const r = m.get(k); if (!r.orgs.includes(f.org)) r.orgs.push(f.org);
    (r.detail[f.org] = r.detail[f.org] || []).push(f.detail);
  }
  return [...m.values()];
}
const ROW_CAP = 300;
function rowHtml(r) {
  const label = r.field ? (LABELS[r.obj + '.' + r.field] || r.field) : '';
  const ds = r.orgs.map(id => r.detail[id].filter(Boolean).join('; '));
  const same = ds.every(d => d === ds[0]);
  const detail = same ? (ds[0] ? '<span class="cwhen">' + esc(ds[0]) + '</span>' : '')
    : r.orgs.map((id, i) => ds[i] ? '<span class="cwhen"><b class="dorg ' + id + '">' + id.toUpperCase() + '</b> ' + esc(ds[i]) + '</span>' : '').join('');
  return '<li>' + orgBadge(r.orgs) + (r.field ? '<span class="cfl">' + esc(label) + '</span><code class="capi">' + esc(r.field) + '</code>' : '') +
    detail + (r.obj ? '<button class="cview" type="button" data-obj="' + esc(r.obj) + '" data-field="' + esc(r.field) + '">Open</button>' : '') + '</li>';
}
function rowsHtml(rows, limit) {
  const byObj = new Map();
  for (const r of rows.slice(0, limit)) { if (!byObj.has(r.obj)) byObj.set(r.obj, []); byObj.get(r.obj).push(r); }
  return [...byObj.keys()].sort((a, b) => objLabel(a).localeCompare(objLabel(b))).map(obj => {
    const list = byObj.get(obj).sort((a, b) => (LABELS[a.obj + '.' + a.field] || a.field).localeCompare(LABELS[b.obj + '.' + b.field] || b.field));
    const head = obj ? '<div class="cobj-h"><b>' + esc(objLabel(obj)) + '</b>' + (objLabel(obj) !== obj ? '<code>' + esc(obj) + '</code>' : '') +
      '<span class="cn">' + nf(list.length) + '</span></div>' : '';
    return '<div class="cobj">' + head + '<ul class="clist">' + list.map(rowHtml).join('') + '</ul></div>';
  }).join('') + (rows.length > limit ? '<button class="btn more" type="button" data-more="' + (limit + ROW_CAP) + '">Show ' +
    nf(Math.min(ROW_CAP, rows.length - limit)) + ' more of ' + nf(rows.length - limit) + '</button>' : '');
}

const hf = { org: 'all', cat: 'all', sev: 'all', obj: 'all', q: '' };
function healthMatches(f, skipObj) {
  if (hf.org !== 'all' && f.org !== hf.org) return false;
  if (hf.cat !== 'all' && f.check.cat !== hf.cat) return false;
  if (hf.sev !== 'all' && f.check.sev !== hf.sev) return false;
  if (!skipObj && hf.obj !== 'all' && f.obj !== hf.obj) return false;
  if (hf.q) {
    const hay = (f.obj + ' ' + objLabel(f.obj) + ' ' + f.field + ' ' + (LABELS[f.obj + '.' + f.field] || '') + ' ' + f.detail).toLowerCase();
    if (!hay.includes(hf.q)) return false;
  }
  return true;
}
const open = new Set(), shown = {};
function renderHealth() {
  const list = FINDINGS.filter(f => healthMatches(f));
  // object filter: only objects that have findings under the other filters
  const objCount = {};
  for (const f of FINDINGS) if (f.obj && healthMatches(f, true)) objCount[f.obj] = (objCount[f.obj] || 0) + 1;
  const sel = $('hObj'), objs = Object.keys(objCount).sort((a, b) => objLabel(a).localeCompare(objLabel(b)));
  if (hf.obj !== 'all' && !objCount[hf.obj]) hf.obj = 'all';
  sel.innerHTML = '<option value="all">All objects (' + objs.length + ')</option>' + objs.map(a => '<option value="' + esc(a) + '">' +
    esc(objLabel(a)) + (objLabel(a) !== a ? ' (' + esc(a) + ')' : '') + ' — ' + nf(objCount[a]) + '</option>').join('');
  sel.value = hf.obj;
  document.querySelectorAll('.csum[data-org], .fhorg[data-org]').forEach(c => { c.hidden = hf.org !== 'all' && c.dataset.org !== hf.org; });
  $('hClear').hidden = hf.org === 'all' && hf.cat === 'all' && hf.sev === 'all' && hf.obj === 'all' && !hf.q;

  let html = '';
  for (const cat of CATS) {
    const checks = CHECKS.filter(c => c.cat === cat).sort((a, b) => SEV_RANK[a.sev] - SEV_RANK[b.sev]);
    const inCat = list.filter(f => f.check.cat === cat);
    if (!inCat.length) continue;
    html += '<section class="csec"><h2>' + esc(cat) + ' <span class="cnt">' + nf(inCat.length) + '</span></h2>';
    for (const c of checks) {
      const fs = inCat.filter(f => f.check === c);
      if (!fs.length) continue;
      const per = ORDER.map(id => { const n = fs.filter(f => f.org === id).length; return n ? '<b class="dorg ' + id + '">' + id.toUpperCase() + '</b> ' + nf(n) : ''; }).filter(Boolean).join(' · ');
      const rows = groupRows(fs), isOpen = open.has(c.code);
      html += '<details class="chk" data-code="' + c.code + '"' + (isOpen ? ' open' : '') + '><summary>' + sevChip(c.sev) +
        '<span class="chk-t">' + esc(c.title) + '</span><span class="chk-n">' + per + '</span></summary>' +
        '<div class="chk-b"><p class="why"><b>Why it matters:</b> ' + esc(c.why) + '</p><p class="why"><b>What to do:</b> ' + esc(c.fix) + '</p>' +
        (isOpen ? rowsHtml(rows, shown[c.code] || ROW_CAP) : '') + '</div></details>';
    }
    html += '</section>';
  }
  $('hBody').innerHTML = html || '<section class="csec"><p class="cnone">Nothing matches the filters.</p></section>';
}

// ---------------------------------------------------------------- explorer
const PINNED = ['Account', 'Contact', 'Lead', 'Opportunity', 'Case', 'Merchant_ID__c', 'Residual_Payment__c', 'POS_Software__c', 'Quote'];
const PIN_RANK = {}; PINNED.forEach((a, i) => { PIN_RANK[a] = i; });
const st = { bu: 'both', obj: null, q: '', issues: new Set(), origin: 'all', labelQ: '', band: 'all',
  pctMin: null, pctMax: null, pctBasis: 'all' };
let VIEW = [];
function buildView() {
  const rows = st.bu === 'both' ? COMBINED : orgView(st.bu);
  VIEW = rows.slice().sort((a, b) => {
    const ra = PIN_RANK[a.api], rb = PIN_RANK[b.api];
    if (ra !== undefined || rb !== undefined) return ra === undefined ? 1 : rb === undefined ? -1 : ra - rb;
    return (a.label || a.api).localeCompare(b.label || b.api);
  });
}
const orgsIn = () => (st.bu === 'both' ? ORDER : [st.bu]);
function fieldFindings(o, f) { const out = []; for (const id of f.orgs) if (orgsIn().includes(id)) out.push(...findFor(id, o.api, f.name)); return out; }
function objFindings(o) { const out = []; for (const id of o.orgs) if (orgsIn().includes(id)) out.push(...findFor(id, o.api, '')); return out; }
function fieldPasses(o, f, ql) {
  if (st.origin !== 'all' && originOf(f) !== st.origin) return false;
  if (st.labelQ && !(f.label || '').toLowerCase().includes(st.labelQ)) return false;
  if (st.pctMin != null || st.pctMax != null) {
    // % of all records (the "Filled in" row), or % since creation (Field Health); unmeasured fields drop out
    const pcts = f.orgs.filter(id => orgsIn().includes(id)).map(id => {
      const v = f.v[id], recs = o.v[id] && o.v[id].records;
      if (st.pctBasis === 'since') return v.fh ? v.fh.Q : null;
      return v.filled != null && recs ? 100 * v.filled / recs : null;
    }).filter(p => p != null);
    if (!pcts.some(p => (st.pctMin == null || p >= st.pctMin) && (st.pctMax == null || p <= st.pctMax))) return false;
  }
  if (st.band !== 'all') {   // either org's score can match in the merged view
    const bands = f.orgs.filter(id => orgsIn().includes(id)).map(id => (f.v[id].sc ? f.v[id].sc.band : 'none'));
    if (!bands.includes(st.band)) return false;
  }
  if (st.issues.size) {
    const codes = fieldFindings(o, f).map(x => x.check.code);
    if (![...st.issues].some(c => (c === '__any' ? codes.length : codes.includes(c)))) return false;
  }
  if (ql) {
    const v = f.v[f.orgs[0]];
    if (!(f.name + ' ' + f.label + ' ' + friendlyType(v) + ' ' + (f.desc || '') + ' ' + (v.help || '') + ' ' + (v.createdBy || '')).toLowerCase().includes(ql)) return false;
  }
  return true;
}
const anyFieldFilter = () => st.issues.size > 0 || st.origin !== 'all' || !!st.labelQ || st.band !== 'all' ||
  st.pctMin != null || st.pctMax != null;
function visibleObjects() {
  const ql = st.q.toLowerCase(), filt = anyFieldFilter(), out = [];
  for (const o of VIEW) {
    const n = (ql || filt) ? o.fields.filter(f => fieldPasses(o, f, ql)).length : o.fields.length;
    if ((filt && !n) || (ql && !n && !(o.api + ' ' + o.label).toLowerCase().includes(ql))) continue;
    out.push({ o, n });
  }
  return out;
}
function issueCount(o) { let n = objFindings(o).length; for (const f of o.fields) n += fieldFindings(o, f).length; return n; }
function renderList(vis) {
  const ql = st.q.toLowerCase(), filt = !!ql || anyFieldFilter();
  const row = ({ o, n }) => {
    const iss = issueCount(o);
    return '<button class="obj" type="button" aria-current="' + (st.obj === o.api) + '" data-api="' + esc(o.api) + '">' +
      (st.bu === 'both' ? orgBadge(o.orgs) : '') + '<span class="otext"><span class="olabel">' + esc(o.label || o.api) + '</span><span class="osub">' +
      (o.custom ? '<span class="tag custom">Custom</span>' : '<span class="tag std">Standard</span>') +
      (o.label !== o.api ? '<span class="oapi">' + esc(o.api) + '</span>' : '') + '</span></span>' +
      (iss ? '<span class="isschip" title="' + iss + ' findings">' + nf(iss) + '</span>' : '') +
      '<span class="count' + (filt ? ' match' : '') + '">' + n + '</span></button>';
  };
  const pin = vis.filter(r => PIN_RANK[r.o.api] !== undefined), rest = vis.filter(r => PIN_RANK[r.o.api] === undefined);
  $('objlist').innerHTML = (pin.length ? '<div class="grouphead">Key objects</div>' + pin.map(row).join('') : '') +
    (rest.length ? '<div class="grouphead">All objects</div>' + rest.map(row).join('') : '') || '<div class="empty">No objects match.</div>';
}
function fillValue(o, id, f) {
  const oo = o.v[id], v = f.v[id];
  if (!oo || !v) return '';
  if (oo.records == null) return 'not measured';
  if (v.filled == null) return v.formulaLen || v.kind === 'rollup' || v.kind === 'autonumber' ? 'calculated' : v.type === 'boolean' ? 'checkbox (always set)' : 'not measurable';
  if (!oo.records) return 'no records';
  // whole percent hides rare-but-used fields as "0%", so show two decimals under 1%
  const p = 100 * v.filled / oo.records, shownPct = p > 0 && p < 1 ? p.toFixed(2) : String(Math.round(p));
  return shownPct + '% <span class="faint">(' + nf(v.filled) + ' of ' + nf(oo.records) + ')</span>';
}
// Salesforce keeps no per-field "last set" date: the scan records the newest record holding a
// value, plus the newest Field History change when the field is tracked.
function lastPopulated(v) {
  if (!v || (!v.lastRecord && !v.lastChange)) return '—';
  const parts = [];
  if (v.lastRecord) parts.push(esc(v.lastRecord) + ' <span class="faint">(newest record with a value)</span>');
  if (v.lastChange) parts.push(esc(v.lastChange) + ' <span class="faint">(last change, field history)</span>');
  return parts.join(' · ');
}
function perOrg(o, f, fn) {
  const ids = f.orgs.filter(id => orgsIn().includes(id));
  const vals = ids.map(id => fn(id));
  if (ids.length > 1 && vals[0] === vals[1]) return vals[0];
  return ids.map((id, i) => (ids.length > 1 ? '<b class="dorg ' + id + '">' + id.toUpperCase() + '</b> ' : '') + vals[i]).join('<span class="sep"></span>');
}
const kv = (k, v) => v ? '<div class="kv"><span class="k">' + k + '</span><span class="v">' + v + '</span></div>' : '';
function fieldCard(o, f) {
  const finds = fieldFindings(o, f).sort((a, b) => SEV_RANK[a.check.sev] - SEV_RANK[b.check.sev]);
  const worst = finds.length ? finds[0].check.sev : '';
  const og = originOf(f), v0 = f.v[f.orgs[0]];
  const rail = '<div class="frail">' + orgBadge(f.orgs.filter(id => orgsIn().includes(id))) +
    (og === 'managed' ? '<span class="mgdchip" title="From the ' + esc(pkgOf(f.name)) + ' package">Managed</span>'
      : og === 'custom' ? '<span class="srcchip custom">Custom Field</span>' : '<span class="srcchip std">Standard Field</span>') +
    (worst ? sevChip(worst) : '<span class="sev ok">No issues</span>') + '</div>';
  const who = (d, by) => d ? esc(d) + (by ? ' · ' + esc(by) : '') : '';
  const issues = finds.length ? '<div class="kv"><span class="k">Findings</span><span class="v ilist">' + finds.map(x =>
    '<span class="iline">' + sevChip(x.check.sev) + (f.orgs.length > 1 && st.bu === 'both' ? '<b class="dorg ' + x.org + '">' + x.org.toUpperCase() + '</b>' : '') +
    esc(x.check.title) + (x.detail ? ' <span class="faint">— ' + esc(x.detail) + '</span>' : '') + '</span>').join('') + '</span></div>' : '';
  return '<div class="field' + (worst ? ' sev-' + worst : '') + '">' + rail + '<div class="fdetail">' +
    kv('Field Label', '<span class="flabel">' + esc(f.label) + '</span>') +
    kv('API Name', '<span class="fapi">' + esc(f.name) + '</span>') +
    kv('Type', '<span class="type">' + esc(friendlyType(v0)) + '</span>' + (v0.ref.length ? ' <span class="faint">→ ' + esc(v0.ref.join(', ')) + '</span>' : '') +
      (v0.picks ? ' <span class="faint">· ' + v0.picks + ' active values</span>' : '') + (v0.formulaLen ? ' <span class="faint">· formula ' + nf(v0.formulaLen) + ' chars</span>' : '')) +
    kv('Filled in', perOrg(o, f, id => fillValue(o, id, f))) +
    (f.orgs.some(id => f.v[id].lastRecord || f.v[id].lastChange) ? kv('Last populated', perOrg(o, f, id => lastPopulated(f.v[id]))) : '') +
    (og !== 'standard' ? kv('Created', perOrg(o, f, id => who(f.v[id].created, f.v[id].createdBy) || '—')) +
      kv('Setup changed', perOrg(o, f, id => who(f.v[id].modified, f.v[id].modifiedBy) || '—')) : '') +
    (f.orgs.some(id => f.v[id].sc) ? kv('Health score', perOrg(o, f, id => healthLine(f.v[id]))) + fhDetails(o, f) : '') +
    issues +
    kv('Description', f.desc ? '<span class="desc">' + esc(f.desc) + '</span>' : (og === 'custom' ? '<span class="missing">Missing</span>' : '')) +
    kv('Help Text', v0.help ? '<span class="help">' + esc(v0.help) + '</span>' : '') +
    '</div></div>';
}
// ---- Field Health (scoring model of the "Field Health Analysis" workbooks; see fieldscore.js) ----
const BAND_ORDER = ['Healthy', 'Monitor', 'Review', 'Likely Debt', 'Retire', 'Too New - Provisional', 'Insufficient Data'];
const BAND_CLASS = { Healthy: 'b-healthy', Monitor: 'b-monitor', Review: 'b-review', 'Likely Debt': 'b-debt', Retire: 'b-retire',
  'Too New - Provisional': 'b-new', 'Insufficient Data': 'b-insufficient' };
const BAND_COLOR = { Healthy: 'var(--uniq)', Monitor: 'var(--accent)', Review: '#d9a441', 'Likely Debt': 'var(--diff)', Retire: 'var(--reqhl)',
  'Too New - Provisional': 'var(--line)', 'Insufficient Data': 'var(--line2)' };
const bandChip = b => '<span class="band ' + (BAND_CLASS[b] || '') + '">' + esc(b) + '</span>';
function healthLine(v) {
  if (!v || !v.sc) return '<span class="faint">not scored</span>';
  const s = v.sc;
  return '<span class="fhrow"><span class="fhscore">' + s.score + '</span>' + bandChip(s.band) + '<span>' + esc(s.cls) +
    '</span><span class="faint">· ' + esc(s.action) + '</span></span>';
}
let fhN = 0;
function fhDetails(o, f) {
  const ids = f.orgs.filter(id => orgsIn().includes(id) && f.v[id].fh);
  if (!ids.length) return '';
  const pc = v => (v == null ? '—' : (v > 0 && v < 1 ? v.toFixed(2) : String(Math.round(v))) + '%');
  const part = v => (v == null ? 'n/a' : (Math.round(v * 100) / 100).toFixed(2));
  const grid = id => {
    const h = f.v[id].fh, s = f.v[id].sc, cell = (k, v) => '<div><b>' + k + '</b>' + v + '</div>';
    const pop = h.checkbox ? '% TRUE' : '% populated';
    return '<div class="fhgrid">' +
      cell(pop + ' since creation', pc(h.Q) + ' <span class="faint">(' + nf(h.M) + ' records)</span>') +
      cell(pop + ' last 90 days', pc(h.R)) + cell(pop + ' last 365 days', pc(h.S)) +
      cell('First / last populated', (h.T || '—') + ' → ' + (h.U || '—')) +
      cell('Months since populated', h.V >= 999 ? 'never' : nf(h.V)) +
      cell('Adoption onset', (h.W || '—') + (h.X != null ? ' <span class="faint">(' + nf(h.X) + ' days after creation)</span>' : '')) +
      cell('Distinct values', h.Y == null ? 'unknown' : (h.yAtLeast ? '5+' : nf(h.Y))) +
      cell('Eligible records', nf(h.O)) +
      cell('References', nf(h.flows) + ' flows · ' + nf(h.formulas) + ' formulas · ' + nf(h.layouts) + ' layouts · ' + nf(h.other) + ' other' +
        (h.reports ? ' <span class="faint">(' + nf(h.reports) + ' reports)</span>' : '')) +
      (s ? Object.entries(s.parts).map(([k, v]) => cell(k + ' score', part(v))).join('') : '') + '</div>';
  };
  const id = 'fh' + (++fhN);
  return '<div class="kv"><span class="k"></span><span class="v" style="flex:1;min-width:0"><button class="toggle" type="button" onclick="var e=document.getElementById(\'' + id +
    '\');e.hidden=!e.hidden">score details</button><div id="' + id + '" hidden>' +
    ids.map(o2 => (ids.length > 1 ? '<div style="margin-top:8px"><b class="dorg ' + o2 + '">' + o2.toUpperCase() + '</b></div>' : '') + grid(o2)).join('') +
    '</div></span></div>';
}
function bandCounts(o, id) {
  const c = {}; let n = 0;
  for (const f of o.fields) { const v = f.v[id]; if (v && v.sc) { c[v.sc.band] = (c[v.sc.band] || 0) + 1; n++; } }
  return n ? BAND_ORDER.filter(b => c[b]).map(b => bandChip(b) + ' ' + nf(c[b])).join(' ') : '';
}
function renderFhSummary() {
  const el = $('fhSummary'), M = P.model;
  if (!M) { el.hidden = true; return; }
  const bar = (bands, total) => '<div class="fhbar">' + BAND_ORDER.filter(b => bands[b]).map(b =>
    '<span style="width:' + (100 * bands[b] / total) + '%;background:' + BAND_COLOR[b] + '" title="' + esc(b) + ': ' + nf(bands[b]) + '"></span>').join('') + '</div>';
  const orgs = ORDER.map(id => {
    const s = P.summary[id], b = s.ownBands || {}, n = s.ownScored || 0;
    return '<div class="fhorg" data-org="' + id + '"><div class="fhorg-h">' + orgBadge([id]) + nf(n) + ' custom fields built in-house, scored</div>' +
      bar(b, n || 1) + '<div class="fhlegend">' + BAND_ORDER.filter(x => b[x]).map(x => '<span><i style="background:' + BAND_COLOR[x] + '"></i>' +
      esc(x) + ' ' + nf(b[x]) + ' <span class="faint">(' + pct(b[x], n) + '%)</span></span>').join('') + '</div></div>';
  }).join('');
  const w = M.weights;
  el.innerHTML = '<h2>Field health scores</h2><p class="sub">Every measured field gets a 0–100 score from the same model as the Field Health Analysis ' +
    'workbooks. Bars show the fields each org built itself; standard and managed-package fields are scored too, in the dictionary.</p>' + orgs +
    '<details class="legend model"><summary>How the score works</summary><table><tr><th>Component</th><th>Weight</th><th>Measures</th></tr>' +
    '<tr><td>Population</td><td>' + w.population + '</td><td>% of records since the field was created that carry a value (% TRUE for checkboxes), log-scaled to ' + M.populationFullCredit + '%</td></tr>' +
    '<tr><td>Recency</td><td>' + w.recency + '</td><td>Months since last populated; zero credit at ' + M.recencyZeroMonths + ' months</td></tr>' +
    '<tr><td>Trend</td><td>' + w.trend + '</td><td>Last-90-day rate vs. rate since creation (n/a under ' + M.trendWindowDays + ' days old)</td></tr>' +
    '<tr><td>Information</td><td>' + w.info + '</td><td>Distinct values; full credit at ' + M.infoFullDistinct + '</td></tr>' +
    '<tr><td>Integration</td><td>' + w.integration + '</td><td>References from flows, formulas, page layouts, Apex, reports…; full credit at ' + M.integrationFullRefs + '</td></tr>' +
    '<tr><td>Documentation</td><td>' + w.documentation + '</td><td>Help text and description present</td></tr></table>' +
    '<p>Formulas and roll-ups skip Population, Recency and Trend (always populated) and the score renormalises over the rest. ' +
    'Bands: Healthy ≥ ' + M.bands.Healthy + ', Monitor ≥ ' + M.bands.Monitor + ', Review ≥ ' + M.bands.Review + ', Likely Debt ≥ ' + M.bands['Likely Debt'] +
    ', else Retire. Fields under ' + M.graceDays + ' days old are “Too New - Provisional”; under ' + M.minEligible + ' eligible records, “Insufficient Data”. ' +
    'Dormant after ' + M.dormantMonths + ' months unpopulated; Active at ' + M.activePct + '%+ since creation; Growing when the last-90-day rate is ' + M.growingMultiple + '× that.</p></details>';
}

function autoSummary(o, id) {
  const a = o.v[id].auto || {}, parts = [];
  const p = (n, w) => { if (n) parts.push(nf(n) + ' ' + w + (n === 1 ? '' : 's')); };
  p(a.bs, 'before-save flow'); p(a.as, 'after-save flow'); p(a.tr, 'Apex trigger'); p(a.vr, 'active validation rule');
  p(a.wf, 'active workflow rule'); p(a.pb, 'active Process Builder');
  return parts.join(' · ') || 'none';
}
function limitSummary(o, id) {
  const l = o.v[id].lim || {}, out = [];
  const NAMES = { CustomFields: 'custom fields', RollupSummary: 'roll-ups', CustomRelationship: 'relationships' };
  for (const k of Object.keys(NAMES)) if (l[k]) out.push('<span class="' + (l[k][0] / l[k][1] >= 0.8 ? 'limhot' : '') + '">' + nf(l[k][0]) + ' / ' + nf(l[k][1]) + ' ' + NAMES[k] + '</span>');
  return out.join(' · ');
}
function renderMain(vis) {
  const ql = st.q.toLowerCase(), main = $('main');
  if (st.obj) {
    const o = VIEW.find(x => x.api === st.obj);
    if (!o) { main.innerHTML = '<div class="empty">That object isn’t in this org.</div>'; return; }
    const fields = o.fields.filter(f => fieldPasses(o, f, ql)).sort((a, b) => (a.label || a.name).localeCompare(b.label || b.name));
    const ids = o.orgs.filter(id => orgsIn().includes(id));
    const line = (k, fn) => { const vs = ids.map(id => fn(id)).filter(x => x != null && x !== ''); if (!vs.length) return '';
      return kv(k, ids.map(id => (ids.length > 1 ? '<b class="dorg ' + id + '">' + id.toUpperCase() + '</b> ' : '') + fn(id)).join('<span class="sep"></span>')); };
    const od = ids.map(id => o.v[id].desc).find(Boolean);
    const ofind = objFindings(o);
    main.innerHTML = '<div class="mhead">' + (st.bu === 'both' ? orgBadge(o.orgs) : '') + '<h2>' + esc(o.label) + '</h2>' +
      (o.label !== o.api ? '<span class="mapi">' + esc(o.api) + '</span>' : '') + '<span class="tag ' + (o.custom ? 'custom' : 'std') + '">' + (o.custom ? 'Custom' : 'Standard') + '</span></div>' +
      '<div class="ometa">' +
      line('Records', id => (o.v[id].records == null ? 'not measured' : nf(o.v[id].records) +
        (o.v[id].newest ? ' <span class="faint">· newest created ' + esc(o.v[id].newest) + '</span>' : ''))) +
      line('Limits', id => limitSummary(o, id)) +
      line('Automation', id => autoSummary(o, id)) +
      line('Field health', id => bandCounts(o, id)) +
      (o.custom ? line('Created', id => (o.v[id].created ? esc(o.v[id].created) + (o.v[id].createdBy ? ' · ' + esc(o.v[id].createdBy) : '') : '')) : '') +
      kv('Description', od ? '<span class="desc">' + esc(od) + '</span>' : (o.custom && !pkgOf(o.api) ? '<span class="missing">Missing</span>' : '')) +
      (ofind.length ? '<div class="kv"><span class="k">Findings</span><span class="v ilist">' + ofind.sort((a, b) => SEV_RANK[a.check.sev] - SEV_RANK[b.check.sev]).map(x =>
        '<span class="iline">' + sevChip(x.check.sev) + (st.bu === 'both' ? '<b class="dorg ' + x.org + '">' + x.org.toUpperCase() + '</b>' : '') +
        esc(x.check.title) + (x.detail ? ' <span class="faint">— ' + esc(x.detail) + '</span>' : '') + '</span>').join('') + '</span></div>' : '') +
      '</div><div class="mmeta">' + fields.length + ' of ' + o.fields.length + ' fields' + (ql ? ' matching “' + esc(st.q) + '”' : '') + '</div>' +
      (fields.length ? fields.map(f => fieldCard(o, f)).join('') : '<div class="empty">No fields match the current filters.</div>');
    main.scrollTop = 0; return;
  }
  if (!ql && !anyFieldFilter()) {
    main.innerHTML = '<div class="empty">Select an object on the left, or search or filter across every field.</div>'; return;
  }
  const rows = [];
  outer: for (const { o } of vis) for (const f of o.fields) if (fieldPasses(o, f, ql)) { rows.push([o, f]); if (rows.length >= 400) break outer; }
  main.innerHTML = '<div class="mhead"><h2>Field results</h2></div><div class="mmeta">' + rows.length + (rows.length >= 400 ? '+' : '') +
    ' fields' + (rows.length >= 400 ? ' — showing the first 400; open an object or narrow the filters' : '') + '</div>' +
    rows.map(([o, f]) => '<div class="robj">' + esc(o.label) + ' <code>' + esc(o.api) + '</code></div>' + fieldCard(o, f)).join('');
  main.scrollTop = 0;
}
function renderStats(vis) {
  let fields = 0, iss = 0;
  // n is the matching-field count when a search or filter is on, otherwise every field
  for (const { o, n } of vis) { fields += n; iss += issueCount(o); }
  $('stats').innerHTML = '<div class="stat"><b>' + nf(vis.length) + '</b><span>Objects</span></div><div class="stat"><b>' + nf(fields) +
    '</b><span>Fields</span></div><div class="stat"><b>' + nf(iss) + '</b><span>Findings</span></div>';
  $('orgsub').textContent = (st.bu === 'both' ? 'SBU + XBU Production' : ORGS[st.bu].meta.name) + ' · scanned ' + P.generated;
  $('clearAll').hidden = !(st.bu !== 'both' || st.q || anyFieldFilter() || st.obj);
}
function fillObjPicker() {
  const s = $('fObj');
  s.innerHTML = '<option value="">All objects</option>' + VIEW.map(o => '<option value="' + esc(o.api) + '">' + esc(o.label) +
    (o.label !== o.api ? ' (' + esc(o.api) + ')' : '') + '</option>').join('');
  s.value = st.obj || '';
}
function syncIssueSummary() {
  const n = st.issues.size;
  $('issSummary').textContent = !n ? 'All fields' : st.issues.has('__any') && n === 1 ? 'Fields with any finding'
    : n === 1 ? CHK[[...st.issues][0]].title : n + ' checks selected';
  $('cbIssAll').checked = !n;
}
function renderDict() {
  buildView(); fillObjPicker();
  if (st.obj && !VIEW.some(o => o.api === st.obj)) st.obj = null;
  const vis = visibleObjects();
  renderStats(vis); renderList(vis); renderMain(vis);
}

// ---------------------------------------------------------------- wiring
function show(view) {
  $('healthView').hidden = view !== 'health'; $('appView').hidden = view !== 'dict';
  if (view === 'dict') renderDict(); else $('healthView').scrollTop = 0;
}
$('toDict').addEventListener('click', () => show('dict'));
$('toHealth').addEventListener('click', () => show('health'));
for (const [id, key] of [['hOrg', 'org'], ['hCat', 'cat'], ['hSev', 'sev'], ['hObj', 'obj']])
  $(id).addEventListener('change', e => { hf[key] = e.target.value; renderHealth(); });
$('hQ').addEventListener('input', e => { hf.q = e.target.value.trim().toLowerCase(); renderHealth(); });
$('hClear').addEventListener('click', () => {
  Object.assign(hf, { org: 'all', cat: 'all', sev: 'all', obj: 'all', q: '' });
  $('hOrg').value = 'all'; $('hCat').value = 'all'; $('hSev').value = 'all'; $('hQ').value = ''; renderHealth();
});
$('hBody').addEventListener('toggle', e => {
  const d = e.target; if (!d.matches || !d.matches('details.chk')) return;
  // re-rendered <details open> fire toggle too, so only react to a real change of state
  if (d.open && !open.has(d.dataset.code)) { open.add(d.dataset.code); renderHealth(); }
  else if (!d.open) open.delete(d.dataset.code);
}, true);
$('hBody').addEventListener('click', e => {
  const more = e.target.closest('[data-more]');
  if (more) { const code = more.closest('details').dataset.code; shown[code] = Number(more.dataset.more); renderHealth(); return; }
  const b = e.target.closest('.cview'); if (!b) return;
  st.obj = b.dataset.obj; st.q = b.dataset.field ? b.dataset.field : ''; $('q').value = st.q;
  if (hf.org !== 'all') { st.bu = hf.org; $('fBu').value = hf.org; }
  show('dict');
});
$('q').addEventListener('input', e => { st.q = e.target.value.trim(); renderDict(); });
$('fBu').addEventListener('change', e => { st.bu = e.target.value; renderDict(); });
$('fObj').addEventListener('change', e => { st.obj = e.target.value || null; renderDict(); });
$('fOrigin').addEventListener('change', e => { st.origin = e.target.value; renderDict(); });
$('fLabel').addEventListener('input', e => { st.labelQ = e.target.value.trim().toLowerCase(); renderDict(); });
$('fBand').addEventListener('change', e => { st.band = e.target.value; renderDict(); });
const pctVal = el => (el.value.trim() === '' || isNaN(Number(el.value)) ? null : Number(el.value));
$('fPctMin').addEventListener('input', e => { st.pctMin = pctVal(e.target); renderDict(); });
$('fPctMax').addEventListener('input', e => { st.pctMax = pctVal(e.target); renderDict(); });
$('fPctBasis').addEventListener('change', e => { st.pctBasis = e.target.value; renderDict(); });
$('objlist').addEventListener('click', e => { const b = e.target.closest('.obj'); if (!b) return; st.obj = b.dataset.api; renderDict(); });
$('clearAll').addEventListener('click', () => {
  Object.assign(st, { bu: 'both', obj: null, q: '', origin: 'all', labelQ: '', band: 'all', pctMin: null, pctMax: null, pctBasis: 'all' }); st.issues.clear();
  $('q').value = ''; $('fBu').value = 'both'; $('fOrigin').value = 'all'; $('fLabel').value = ''; $('fBand').value = 'all';
  $('fPctMin').value = ''; $('fPctMax').value = ''; $('fPctBasis').value = 'all';
  $('popIss').querySelectorAll('input').forEach(c => { c.checked = c.id === 'cbIssAll'; });
  syncIssueSummary(); renderDict();
});
// findings multi-select, built from CHECKS so every check is filterable
$('popIss').insertAdjacentHTML('beforeend', '<label class="opt"><input type="checkbox" value="__any"> <span class="optl">Any finding</span></label>' +
  CATS.map(cat => '<div class="popsep"></div><div class="opthead">' + esc(cat) + '</div>' + CHECKS.filter(c => c.cat === cat && !/^(AUTO_|PKG_|LIM_NEAR|DOC_OBJ|USE_EMPTY_OBJECT)/.test(c.code))
    .map(c => '<label class="opt"><input type="checkbox" value="' + c.code + '"> <span class="optl">' + esc(c.title) + '</span>' + sevChip(c.sev) + '</label>').join('')).join(''));
$('popIss').querySelectorAll('.popsep+.opthead').forEach(h => { if (!h.nextElementSibling || !h.nextElementSibling.matches('.opt')) { h.previousElementSibling.remove(); h.remove(); } });
$('popIss').addEventListener('change', e => {
  const cb = e.target;
  if (cb.id === 'cbIssAll') { st.issues.clear(); $('popIss').querySelectorAll('input').forEach(c => { c.checked = c === cb; }); }
  else cb.checked ? st.issues.add(cb.value) : st.issues.delete(cb.value);
  syncIssueSummary(); renderDict();
});
const setPop = o => { $('mIss').dataset.open = o; $('popIss').hidden = !o; $('btnIss').setAttribute('aria-expanded', o); };
$('btnIss').addEventListener('click', e => { e.stopPropagation(); setPop($('popIss').hidden); });
$('popIss').addEventListener('click', e => e.stopPropagation());
document.addEventListener('click', () => setPop(false));
document.addEventListener('keydown', e => { if (e.key === 'Escape') setPop(false); });
const root = document.documentElement;
document.querySelectorAll('.themeBtn').forEach(b => b.addEventListener('click', () => {
  const cur = root.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme:dark)').matches ? 'dark' : 'light');
  root.setAttribute('data-theme', cur === 'dark' ? 'light' : 'dark');
}));

document.querySelector('.csums').innerHTML = ORDER.map(scoreCard).join('');
renderFhSummary();
$('hCat').innerHTML = '<option value="all">All categories</option>' + CATS.map(c => '<option>' + esc(c) + '</option>').join('');
renderHealth();
syncIssueSummary();
if (location.hash === '#dictionary') show('dict');
})();
