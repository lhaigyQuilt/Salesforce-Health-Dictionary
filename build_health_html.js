// Build salesforce-health-dictionary.html: one self-contained page. The scan data ships
// gzipped + base64'd and is inflated in the browser, then app.js runs against window.P.
const fs = require('fs');
const zlib = require('zlib');
const OUT = __dirname.split(String.fromCharCode(92)).join('/');
const read = f => fs.readFileSync(`${OUT}/${f}`, 'utf8');

const HEALTH = JSON.parse(read('health.json'));
const HISTORY = fs.existsSync(`${OUT}/history.json`) ? JSON.parse(read('history.json')) : [];
const CODE_IDX = Object.fromEntries(HEALTH.checks.map((c, i) => [c.code, i]));

function packOrg(id) {
  const S = JSON.parse(read(`${id}_tech.json`));
  // automation counts per object, active only
  const auto = {};
  const bump = (obj, k) => { if (!obj) return; (auto[obj] = auto[obj] || {})[k] = (auto[obj][k] || 0) + 1; };
  for (const f of S.automation.flows) if (f.active) {
    if (f.process === 'Workflow') bump(f.obj, 'pb');
    else if (f.trigger === 'RecordBeforeSave') bump(f.obj, 'bs');
    else if (f.trigger === 'RecordAfterSave' || f.trigger === 'RecordBeforeDelete') bump(f.obj, 'as');
  }
  for (const t of S.automation.triggers) if (t.active) bump(t.obj, 'tr');
  for (const v of S.automation.validationRules) if (v.active) bump(v.obj, 'vr');
  for (const w of S.automation.workflowRules) if (w.active) bump(w.obj, 'wf');

  const objs = S.objects.map(o => {
    const lim = {};
    for (const [k, v] of Object.entries(o.limits || {})) if (v.max) lim[k] = [v.used, v.max];
    const t = { a: o.api, l: o.label, c: o.custom ? 1 : 0, f: o.fields.map(f => {
      const flags = (f.req ? 1 : 0) | (f.uniq ? 2 : 0) | (f.extId ? 4 : 0) | (f.custom ? 8 : 0) | (f.measurable ? 16 : 0);
      const x = [f.name, f.label, f.type, f.kind || '', f.len || 0, flags, f.filled == null ? -1 : f.filled, f.desc || '', f.help || '',
        f.created || '', f.createdBy || '', f.modified || '', f.modifiedBy || '', (f.formula || '').length, f.picks || 0, f.ref && f.ref.length ? f.ref : 0];
      let n = x.length; while (n > 6 && !x[n - 1]) n--;
      return x.slice(0, n);
    }) };
    if (o.desc) t.d = o.desc;
    if (o.records != null) t.r = o.records;
    if (Object.keys(lim).length) t.lim = lim;
    if (o.created) { t.cr = o.created; t.cb = o.createdBy; }
    if (auto[o.api]) t.au = auto[o.api];
    return t;
  });
  return { id, name: S.org.name, edition: S.org.edition, scanned: S.org.scanned, objs };
}

const prev = HISTORY.length > 1 ? HISTORY[HISTORY.length - 2] : null;
const payload = {
  generated: HEALTH.generated, checks: HEALTH.checks, summary: HEALTH.summary,
  prev: prev ? { date: prev.date, counts: prev.counts, stats: prev.stats } : null,
  findings: HEALTH.findings.map(f => [CODE_IDX[f.check], f.org, f.obj, f.field, f.detail]),
  orgs: ['sbu', 'xbu'].map(packOrg),
};
const b64 = zlib.gzipSync(Buffer.from(JSON.stringify(payload)), { level: 9 }).toString('base64');
const since = prev ? 'compared with the scan on ' + prev.date : 'first scan — trends appear from the next monthly run';

const EXTRA_CSS = `
/* ---- health dictionary ---- */
#healthView[hidden]{display:none}
#healthView{height:100vh;overflow-y:auto;background:var(--bg)}
.tiles{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
.tile{background:var(--surface2);border:1px solid var(--line2);border-radius:8px;padding:10px 12px;display:flex;flex-direction:column}
.tile b{font-size:26px;font-weight:700;line-height:1.1;font-variant-numeric:tabular-nums}
.tile span{font-size:12px;color:var(--muted)}
.tile.warn b{color:var(--diff)} .tile.bad b{color:var(--reqhl)}
.tile .tr{font-size:11px;margin-top:3px}
.tr.good{color:var(--uniq)} .tr.bad{color:var(--reqhl)} .tr.flat{color:var(--faint)}
.cfilt{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;align-items:end;margin-top:18px;
  background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:14px 18px;box-shadow:var(--shadow)}
.cfilt .clearall{align-self:center}
.sev{font-size:9.5px;letter-spacing:.04em;text-transform:uppercase;font-weight:800;border-radius:5px;padding:2px 7px;border:1px solid;white-space:nowrap;flex-shrink:0}
.sev.high{color:var(--surface);background:var(--reqhl);border-color:var(--reqhl)}
.sev.medium{color:var(--surface);background:var(--diff);border-color:var(--diff)}
.sev.low{color:var(--muted);border-color:var(--line);background:var(--surface)}
.sev.ok{color:var(--uniq);border-color:var(--uniq);background:var(--surface)}
details.chk{border-top:1px solid var(--line2)}
details.chk:first-of-type{border-top:0}
details.chk>summary{display:flex;align-items:center;gap:10px;padding:11px 2px;cursor:pointer;list-style:none}
details.chk>summary::-webkit-details-marker{display:none}
details.chk>summary::before{content:'▸';color:var(--faint);width:10px}
details.chk[open]>summary::before{content:'▾'}
.chk-t{font-weight:650;font-size:14px;color:var(--ink)}
.chk-n{margin-left:auto;font-size:12.5px;color:var(--muted);white-space:nowrap}
.chk-b{padding:0 0 14px 20px}
.why{font-size:13px;color:var(--ink2);margin:4px 0;max-width:90ch}
.dorg{font-size:9.5px;font-weight:800;letter-spacing:.04em}
.dorg.sbu{color:var(--org-sbu)} .dorg.xbu{color:var(--org-xbu)}
.btn.more{margin-top:10px}
.isschip{font-size:9.5px;font-weight:800;color:var(--surface);background:var(--diff);border-radius:5px;padding:2px 6px;flex-shrink:0;font-variant-numeric:tabular-nums}
.ometa{background:var(--surface);border:1px solid var(--line);border-radius:var(--radius);padding:12px 14px;margin:6px 0 14px;display:flex;flex-direction:column;gap:7px;box-shadow:var(--shadow)}
.missing{color:var(--reqhl);font-weight:650;font-size:12px}
.faint{color:var(--faint)}
.sep{display:inline-block;width:14px}
.limhot{color:var(--reqhl);font-weight:700}
.ilist{display:flex;flex-direction:column;gap:4px}
.iline{display:flex;align-items:center;gap:7px;flex-wrap:wrap;font-size:12.5px}
.field.sev-high{border-left:3px solid var(--reqhl)} .field.sev-medium{border-left:3px solid var(--diff)}
.frail .sev{display:block;text-align:center;font-size:10px;padding:4px 0;border-radius:6px}
.robj{font-size:12px;color:var(--muted);margin:12px 0 4px}
.robj code{font-family:var(--mono);color:var(--faint)}
.type{border-color:var(--line);color:var(--ink2)}
.kv .v .sep+b{margin-left:0}
@media (max-width:640px){.tiles{grid-template-columns:1fr}.chk-n{display:none}}
`;

const HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Salesforce Health Dictionary</title>
<style>
${read('style.css')}
${EXTRA_CSS}
</style></head>
<body>
<div id="healthView">
  <div class="cwrap">
    <div class="chead">
      <div>
        <h1>Salesforce org health</h1>
        <div class="csince">SBU &amp; XBU production · scanned ${HEALTH.generated} · ${since}</div>
      </div>
      <div class="cgo">
        <button class="btn themeBtn" type="button">Theme</button>
        <button class="btn primary" id="toDict" type="button">Open the health dictionary &rarr;</button>
      </div>
    </div>
    <p class="cintro">Monthly technical checks on both production orgs: undocumented and misnamed fields, fields nobody fills in,
    objects close to Salesforce limits, retired automation still running, and installed apps that store no data.
    Open any check to see the fields, why it matters and what to do. <b>Open</b> jumps to that field in the dictionary.</p>
    <div class="csums"></div>
    <div class="cfilt" role="group" aria-label="Filter findings">
      <div class="fld"><label for="hOrg">Org</label><select class="ctl" id="hOrg">
        <option value="all">Both orgs</option><option value="sbu">SBU only — POS Nation</option><option value="xbu">XBU only — Rain POS</option></select></div>
      <div class="fld"><label for="hCat">Category</label><select class="ctl" id="hCat"></select></div>
      <div class="fld"><label for="hSev">Priority</label><select class="ctl" id="hSev">
        <option value="all">All priorities</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></div>
      <div class="fld"><label for="hObj">Object</label><select class="ctl" id="hObj"></select></div>
      <div class="fld"><label for="hQ">Field or object contains</label><input class="ctl" id="hQ" type="search" placeholder="e.g. status" autocomplete="off"></div>
      <button class="clearall" type="button" id="hClear" hidden>Clear filters</button>
    </div>
    <div id="hBody"></div>
  </div>
</div>

<div class="app" id="appView" hidden>
  <header>
    <div class="brand"><h1>Salesforce Health Dictionary</h1><span class="sub" id="orgsub"></span></div>
    <div class="stats" id="stats"></div>
    <button class="theme-btn" id="toHealth" type="button">&larr; Org health</button>
    <button class="theme-btn themeBtn" type="button">Theme</button>
  </header>
  <aside>
    <div class="search">
      <input id="q" type="search" placeholder="Search label, API name, description, creator…" autocomplete="off" spellcheck="false" aria-label="Search fields">
      <div class="fld"><label for="fBu">Org</label><select class="ctl" id="fBu">
        <option value="both">Both orgs (SBU + XBU)</option><option value="sbu">SBU only — POS Nation</option><option value="xbu">XBU only — Rain POS</option></select></div>
      <div class="fld"><label for="fObj">Object</label><select class="ctl" id="fObj"></select></div>
      <div class="fld"><label for="fOrigin">Fields</label><select class="ctl" id="fOrigin">
        <option value="all">All fields</option><option value="custom">Custom fields only (built in-house)</option>
        <option value="managed">Managed package fields only</option><option value="standard">Standard fields only</option></select></div>
      <div class="fld sub"><span class="lbl" id="lblIss">Findings</span>
        <div class="multi" id="mIss" data-open="false">
          <button class="ctl" type="button" id="btnIss" aria-haspopup="true" aria-expanded="false" aria-labelledby="lblIss btnIss">
            <span id="issSummary">All fields</span><span class="caret" aria-hidden="true">▾</span></button>
          <div class="pop" id="popIss" hidden role="group" aria-label="Findings" style="max-height:min(68vh,560px);overflow-y:auto">
            <label class="opt"><input type="checkbox" id="cbIssAll" value="__all" checked> <span class="optl">All fields</span></label>
          </div>
        </div>
      </div>
      <div class="fld"><label for="fLabel">Field label contains</label><input class="ctl" id="fLabel" type="search" placeholder="e.g. status" autocomplete="off"></div>
      <button class="clearall" type="button" id="clearAll" hidden>Clear filters</button>
    </div>
    <div class="objlist" id="objlist"></div>
  </aside>
  <main id="main"></main>
</div>

<script id="payload" type="text/plain">${b64}</script>
<script id="app" type="text/plain">${read('app.js').replace(/<\/script/gi, '<\\/script')}</script>
<script>
(function(){
  var b=document.getElementById('payload').textContent.trim();
  var bin=Uint8Array.from(atob(b),function(c){return c.charCodeAt(0);});
  new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'))).text().then(function(t){
    window.P=JSON.parse(t);
    var s=document.createElement('script');s.textContent=document.getElementById('app').textContent;document.body.appendChild(s);
  }).catch(function(e){document.getElementById('hBody').innerHTML='<p class="cnone">Could not load the data: '+e.message+'</p>';});
})();
</script>
</body></html>
`;
fs.writeFileSync(`${OUT}/salesforce-health-dictionary.html`, HTML);
console.log('wrote salesforce-health-dictionary.html', (Buffer.byteLength(HTML) / 1048576).toFixed(2), 'MB |',
  payload.findings.length, 'findings |', payload.orgs.map(o => o.id + ' ' + o.objs.length + ' objects').join(', '));
