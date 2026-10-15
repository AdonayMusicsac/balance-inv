// Servidor estático mínimo de www/ para el arnés visual.
const http = require('http'), fs = require('fs'), path = require('path');
const WWW = path.join(__dirname, '..', '..', 'www');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
function start(port = 0, extra = {}) {
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    if (extra[u]) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(extra[u]); }
    const f = path.join(WWW, u === '/' ? 'index.html' : u);
    if (!f.startsWith(WWW) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise(ok => srv.listen(port, '127.0.0.1', () => ok(srv)));
}
module.exports = { start };
