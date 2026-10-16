const fs = require('fs');
const { createWorker } = require('tesseract.js');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<body></body>', { runScripts: 'outside-only' });
dom.window.eval(fs.readFileSync(require('path').join(__dirname, '../../www/compras-import.js'), 'utf8'));
const CI = dom.window.ComprasImport;
const truth = JSON.parse(fs.readFileSync('/tmp/corpus/b/truth.json', 'utf8'));
const norm = s => String(s || '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
(async () => {
  const w = await createWorker('spa', 1, { langPath: 'node_modules/@tesseract.js-data/spa/4.0.0_best_int', gzip: true, cachePath: '/tmp/pdft/cache' });
  let tot = { n: 0, ruc: 0, serie: 0, num: 0, fecha: 0, prov: 0, lin: 0, exp: 0, extra: 0 };
  for (const f of fs.readdirSync('/tmp/ocr').filter(x => x.endsWith('.png')).sort()) {
    const key = f.replace(/-1\.png$/, '.pdf'), t = truth[key];
    const r = await w.recognize('/tmp/ocr/' + f);
    const res = CI.parseTexto(r.data.text, 'OCR');
    tot.n++; const bad = [];
    if (res.ruc === t.ruc) tot.ruc++; else bad.push('ruc ' + res.ruc + ' vs ' + t.ruc);
    if (res.serie === t.serie) tot.serie++; else bad.push('serie ' + res.serie + ' vs ' + t.serie);
    if (res.numero === t.numero) tot.num++; else bad.push('num ' + res.numero + ' vs ' + t.numero);
    if (res.fecha === t.fecha) tot.fecha++; else bad.push('fecha ' + res.fecha + ' vs ' + t.fecha);
    if (norm(res.proveedor) === norm(t.proveedor)) tot.prov++; else bad.push('prov "' + res.proveedor + '" vs "' + t.proveedor + '"');
    let ok = 0; const used = new Set();
    for (const e of t.lineas) { tot.exp++; const i = res.lineas.findIndex((l, k) => !used.has(k) && Math.abs(l.qty - e.qty) < 1e-6 && Math.abs(l.precio - e.precio) <= (e.approx ? 0.02 : 0.011)); if (i >= 0) { used.add(i); ok++; tot.lin++; } else bad.push('linea qty' + e.qty + ' p' + e.precio); }
    tot.extra += Math.max(0, res.lineas.length - ok);
    console.log(f.padEnd(16), bad.length ? bad.slice(0, 4).join(' | ') : 'OK');
  }
  console.log(JSON.stringify(tot)); await w.terminate();
})();
