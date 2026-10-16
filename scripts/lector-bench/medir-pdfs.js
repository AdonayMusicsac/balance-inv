const fs = require('fs');
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<body></body>', { runScripts: 'outside-only' });
dom.window.eval(fs.readFileSync(require('path').join(__dirname, '../../www/compras-import.js'), 'utf8'));
const CI = dom.window.ComprasImport;
const dir = process.argv[2], verbose = process.argv[3] === '-v';
const truth = JSON.parse(fs.readFileSync(dir + '/truth.json', 'utf8'));
const norm = s => String(s || '').toUpperCase().replace(/\s+/g, ' ').replace(/[^A-Z0-9 ]/g, '').trim();
(async () => {
  const stats = {}; const fails = [];
  for (const [name, t] of Object.entries(truth)) {
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(`${dir}/${name}`)), useSystemFonts: true }).promise;
    let texto = '';
    for (let i = 1; i <= pdf.numPages; i++) { const c = await (await pdf.getPage(i)).getTextContent(); texto += CI.filasDesdeItems(c.items.map(it => ({ s: it.str, x: it.transform[4], y: it.transform[5], w: it.width || 0 }))); }
    const r = JSON.parse(JSON.stringify(CI.parseTexto(texto, 'PDF')));
    const S = (stats[t.tpl] = stats[t.tpl] || { n: 0, prov: 0, ruc: 0, serie: 0, numero: 0, fecha: 0, tipo: 0, moneda: 0, lineasOK: 0, lineasExp: 0, lineasExtra: 0, full: 0 });
    S.n++;
    const bad = [];
    const ok = (k, cond, got, exp) => { if (cond) S[k]++; else bad.push(`${k}: got "${got}" exp "${exp}"`); };
    ok('prov', norm(r.proveedor) === norm(t.proveedor) || (t.proveedor === '' && r.proveedor === ''), r.proveedor, t.proveedor);
    ok('ruc', r.ruc === t.ruc, r.ruc, t.ruc);
    ok('serie', r.serie === t.serie.toUpperCase(), r.serie, t.serie);
    ok('numero', r.numero === t.numero, r.numero, t.numero);
    ok('fecha', r.fecha === t.fecha, r.fecha, t.fecha);
    ok('tipo', r.tipo === t.tipo, r.tipo, t.tipo);
    ok('moneda', r.moneda === t.moneda, r.moneda, t.moneda);
    let lineOK = 0; const usados = new Set();
    for (const e of t.lineas) {
      S.lineasExp++;
      const i = r.lineas.findIndex((l, k) => !usados.has(k) && Math.abs(l.qty - e.qty) < 1e-6 && Math.abs(l.precio - e.precio) <= (e.approx ? 0.02 : 0.011)
        && (norm(l.desc).includes(norm(e.desc)) || norm(e.desc).includes(norm(l.desc)) && l.desc.length > 3) && (!e.codigo || norm(l.codigo) === norm(e.codigo)));
      if (i >= 0) { usados.add(i); lineOK++; S.lineasOK++; } else bad.push(`linea: exp ${JSON.stringify(e)} | got ${JSON.stringify(r.lineas)}`);
    }
    S.lineasExtra += Math.max(0, r.lineas.length - lineOK);
    if (bad.length) fails.push([name, bad]); else S.full++;
  }
  console.log('tpl  n  prov ruc serie num fecha tipo mon  lineas(ok/exp)  extra  PERFECTAS');
  let tot = 0, full = 0;
  for (const [k, s] of Object.entries(stats)) { tot += s.n; full += s.full; console.log(String(k).padStart(2), String(s.n).padStart(3), ...['prov', 'ruc', 'serie', 'numero', 'fecha', 'tipo', 'moneda'].map(x => String(s[x]).padStart(4)), `  ${s.lineasOK}/${s.lineasExp}`.padEnd(14), String(s.lineasExtra).padStart(4), `  ${s.full}/${s.n}`); }
  console.log(`TOTAL perfectas ${full}/${tot}`);
  if (verbose) for (const [n, b] of fails.slice(0, +process.argv[4] || 12)) { console.log('--', n); b.slice(0, 4).forEach(x => console.log('   ', x.slice(0, 400))); }
})();
