// Pre-publish checks for salesforce-health-dictionary.html.
const fs = require('fs');
const zlib = require('zlib');
const OUT = __dirname.split(String.fromCharCode(92)).join('/');
const PAGE = OUT + '/salesforce-health-dictionary.html';
let bad = 0;
const fail = m => { console.log('  FAIL  ' + m); bad++; };
const ok = m => console.log('  ok    ' + m);

if (!fs.existsSync(PAGE)) { console.error('no page — run build_health_html.js first'); process.exit(1); }
const pg = fs.readFileSync(PAGE, 'utf8');
const mb = Buffer.byteLength(pg) / 1048576;
mb < 15 ? ok('page is ' + mb.toFixed(2) + ' MB (under 15 MB)') : fail('page is ' + mb.toFixed(2) + ' MB');

const m = pg.match(/<script id="payload" type="text\/plain">([\s\S]*?)<\/script>/);
let P = null;
try { P = JSON.parse(zlib.gunzipSync(Buffer.from(m[1].trim(), 'base64')).toString('utf8')); ok('payload decodes'); }
catch (e) { fail('payload does not decode: ' + e.message.slice(0, 80)); }
if (P) {
  P.orgs.length === 2 ? ok('both orgs present') : fail('expected 2 orgs, got ' + P.orgs.length);
  for (const o of P.orgs) {
    const nf = o.objs.reduce((a, x) => a + x.f.length, 0);
    const measured = o.objs.filter(x => x.r != null).length;
    nf > 10000 ? ok(o.id + ': ' + o.objs.length + ' objects, ' + nf + ' fields') : fail(o.id + ': only ' + nf + ' fields — scan truncated?');
    measured > 100 ? ok(o.id + ': record counts for ' + measured + ' objects') : fail(o.id + ': record counts for only ' + measured + ' objects');
  }
  P.findings.every(f => P.checks[f[0]]) ? ok(P.findings.length + ' findings, all tied to a check') : fail('a finding points at an unknown check');
}
const ids = ['healthView', 'appView', 'toDict', 'toHealth', 'hOrg', 'hCat', 'hSev', 'hObj', 'hQ', 'hClear', 'hBody',
  'q', 'fBu', 'fObj', 'fOrigin', 'popIss', 'btnIss', 'cbIssAll', 'fLabel', 'clearAll', 'objlist', 'main', 'stats', 'orgsub'];
const dup = ids.filter(id => (pg.match(new RegExp('id="' + id + '"', 'g')) || []).length !== 1);
dup.length ? fail('ids missing or duplicated: ' + dup.join(', ')) : ok('all ' + ids.length + ' element ids present once');
const root = pg.slice(pg.indexOf(':root{'), pg.indexOf('@media (prefers-color-scheme:dark)'));
const defined = new Set([...root.matchAll(/--([a-z0-9-]+)\s*:/g)].map(x => x[1]));
const missing = [...new Set([...pg.matchAll(/var\(--([a-z0-9-]+)\)/g)].map(x => x[1]))].filter(t => !defined.has(t));
missing.length ? fail('CSS tokens undefined on :root: ' + missing.join(', ')) : ok('all CSS tokens defined');
try { new Function(pg.match(/<script id="app" type="text\/plain">([\s\S]*?)<\/script>/)[1]); ok('app script parses'); }
catch (e) { fail('app script does not parse: ' + e.message); }

console.log(bad ? '\n' + bad + ' CHECK(S) FAILED' : '\nall checks passed');
process.exit(bad ? 1 : 0);
