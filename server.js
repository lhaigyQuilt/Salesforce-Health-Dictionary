// Minimal static server for hosting the health dictionary (Railway, Render, any PaaS
// that sets PORT). Node built-ins only. Routes are an explicit allowlist, so nothing is
// resolved from the request path.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const PAGE = 'salesforce-health-dictionary.html';
const ROUTES = {
  '/': [PAGE, 'text/html; charset=utf-8'],
  '/index.html': [PAGE, 'text/html; charset=utf-8'],
  ['/' + PAGE]: [PAGE, 'text/html; charset=utf-8'],
  '/health.json': ['health.json', 'application/json; charset=utf-8'],
  '/history.json': ['history.json', 'application/json; charset=utf-8'],
};

http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); return res.end(); }
  if (url === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok\n'); }
  const route = ROUTES[url];
  if (!route) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Not found. The health dictionary is at /\n'); }
  const full = path.join(__dirname, route[0]);
  let stat;
  try { stat = fs.statSync(full); } catch { res.writeHead(500); return res.end('Missing ' + route[0] + '\n'); }
  res.writeHead(200, { 'Content-Type': route[1], 'Content-Length': stat.size, 'Last-Modified': stat.mtime.toUTCString(),
    'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(full).pipe(res);
}).listen(PORT, '0.0.0.0', () => console.log('Salesforce health dictionary listening on 0.0.0.0:' + PORT));
