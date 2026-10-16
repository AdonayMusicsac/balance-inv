// Pruebas de azar (con semilla fija) del lector de comprobantes: filas de productos con muchos órdenes de columnas y
// encabezados con proveedor, RUC, serie/número y fecha en distintas posiciones. Aseguran que mejoras futuras no rompan formatos ya resueltos.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load-app');
const CI = loadApp(['compras-import.js']).window.ComprasImport;

function fuzzFilas(SEED, NN) {
let seed = SEED; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const pick = a => a[Math.floor(rnd() * a.length)], ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const PROD = ['CUERDAS PARA GUITARRA ELECTRICA 009-042', 'AFINADOR CLIP CROMATICO', 'PARCHE REMO 14" COATED BLANCO', 'CABLE INSTRUMENTO 6M 1/4 RECTO', 'UKULELE SOPRANO 21" CAOBA', 'PLUMILLAS DUNLOP 0.73 X12', 'CAJON PERUANO FLAMENCO', 'TECLADO CASIO CT-S300 61 TECLAS', 'BAQUETAS 5A NOGAL', 'PEDAL DE EFECTO DISTORSION', 'CABLE UTP CAT6 3 M', 'ARMONICA DIATONICA DO', 'MICROFONO SM-58 10-6', 'RESINA PARA VIOLIN', 'ESTUCHE 4/4 REFORZADO', 'AMPLIFICADOR 20W', 'AFINADOR FLANGER', 'ECUALIZADOR LC-5'];
const fmt = (x, dec = 2, mil = ',') => { let s = x.toFixed(dec); if (mil === ',') { const [i, d] = s.split('.'); s = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (d !== undefined ? '.' + d : ''); } return s; };
const r2 = n => Math.round(n * 100) / 100;
function genRow() {
  const desc = pick(PROD), qty = pick([1, 1, 2, 3, 4, 5, 6, 10, 12, 20, 24, 50, 100, 1000]);
  const pc = r2(pick([rnd() * 50 + 3, rnd() * 400 + 50, rnd() * 3000 + 400])), vu = r2(pc / 1.18);
  const total = r2(qty * pc), vv = r2(total / 1.18), igv = r2(total - vv);
  const code = pick(['', '', 'MS' + ri(100, 999) + 'B', String(ri(1, 99999)).padStart(5, '0'), 'AB-' + ri(10, 9999)]);
  const cur = pick(['', '', '', 'S/ ', 'US$ ', '$ ']);
  const unit = pick(['UND', 'NIU', 'UNIDAD', 'ZZ', 'CJA', '']);
  const qf = pick([() => String(qty), () => qty.toFixed(2), () => qty.toFixed(3), () => fmt(qty, 2), () => fmt(qty, 0)]);
  const sep = pick(['  ', '  ', '  ', ' ']);
  let code2 = null;
  const layout = pick(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']);
  const P = x => cur + fmt(x), Pn = x => fmt(x);
  let cols, expPrecio = pc;
  switch (layout) {
    case 'A': cols = [qf(), code, desc, P(pc), P(total)]; break;                                  // cant | cod | desc | p.unit | total
    case 'B': cols = [code, desc, qf(), unit, P(pc), P(total)]; break;                            // cod | desc | cant | um | pu | total
    case 'C': cols = [String(ri(1, 30)), code, desc, unit, qf(), Pn(vu), Pn(vv), Pn(igv), Pn(total)]; break;   // item | cod | desc | um | cant | vu | vv | igv | importe
    case 'D': cols = [qf(), unit, code, desc, Pn(pc), '5.00', Pn(r2(total))]; qty && (cols[6] = Pn(total)); break;
    case 'E': cols = [code, desc, unit, qf(), Pn(vu), Pn(r2(qty * vu))]; expPrecio = null; break;   // solo sin IGV (no inferible por fila)
    case 'F': cols = [desc, qf() + ' ' + unit, P(pc), P(total)]; break;                           // cantidad y unidad pegadas
    case 'G': cols = [qf(), code, desc, Pn(vu), '10-6', Pn(pc), Pn(total)]; break;                // con descuento tipo «10-6»
    case 'H': cols = [qf(), desc, Pn(pc), '18%', Pn(total)]; break;                               // porcentaje de IGV
    case 'I': cols = [qf(), code, desc + ' ' + Pn(pc), Pn(total)]; expPrecio = pc; break;         // precio pegado al texto
    case 'J': cols = [qf(), code, desc, Pn(r2(pc / 0.9)), '10.00', Pn(total)]; break;             // precio de lista + % descuento (el efectivo es total/cant)
  }
  if (layout === 'J') expPrecio = r2(total / qty);
  if (layout === 'H' || layout === 'F') code2 = '';
  if (layout === 'D') cols = [qf(), unit, code, desc, Pn(pc), Pn(total)];
  const row = cols.filter(x => x !== '').join(sep);
  return { row, desc, code: code2 === '' ? '' : code, qty, precio: expPrecio, layout, total };
}
const N = NN; const fails = {}; let ok = 0, noInf = 0;
for (let i = 0; i < N; i++) {
  const r = genRow();
  const text = ['CANT  DESCRIPCION  P.UNIT  TOTAL', r.row, 'Sub Total 100.00', 'TOTAL 118.00'].join('\n');
  const out = CI.parseTexto(text, 'PDF').lineas;
  if (r.precio === null) { noInf++; continue; }
  const l = out[0];
  const bien = l && out.length === 1 && Math.abs(l.qty - r.qty) < 1e-6 && Math.abs(l.precio - r.precio) <= 0.011 && l.desc.replace(/\s+/g, ' ').includes(r.desc.replace(/\s+/g, ' ')) && (!r.code || l.codigo === r.code);
  if (bien) ok++; else { (fails[r.layout] = fails[r.layout] || []).push({ row: r.row, got: JSON.stringify(out), exp: JSON.stringify({ q: r.qty, p: r.precio, d: r.desc, c: r.code }) }); }
}
return { ok, total: N - noInf, fails };
}
function fuzzEncabezados(SEED, NN) {
let seed = SEED; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const pick = a => a[Math.floor(rnd() * a.length)], ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const SUP = ['UNION MUSICAL E.I.R.L.', 'MUSIC V&B PERU S.A.C.', 'HUAMAN MERCADOS MUSICALES S.A.C', 'CORPORACION ARTEMIS S.R.L.', 'DISTRIBUIDORA LOS ANDES S.A.', 'INSTRUMENTOS Y SONIDO DEL PERU S.A.C.', 'COMERCIAL KARINA E.I.R.L.', 'MUNDO SONORO SRL', 'GRUPO AUDIO PRO PERU SAC', 'CASA MUSICAL LIMA', 'TIENDAS ORFEO S.A.', 'QUISPE MAMANI JUAN CARLOS', 'IMPORTACIONES MACHACA'];
const CLI = 'ADONAY MUSIC S.A.C.', CRUC = '20616269659';
const rucGen = () => { const b = '20' + String(ri(0, 99999999)).padStart(8, '0'); const w = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]; let s = 0; for (let i = 0; i < 10; i++) s += +b[i] * w[i]; let d = 11 - s % 11; d = d === 10 ? 0 : d === 11 ? 1 : d; return b + d; };
const NOISE = ['Av. Los Olivos 123 - Lima - Lima', 'Telf: (01) 555-1234', 'ventas@empresa.com', 'www.empresa.pe', 'Fabricación de cajones criollos y venta de todo tipo', 'de instrumentos musicales de las diferentes marcas', 'DIR.LOCAL: JR. SANTA ROSA NRO. 1293 BARRIOS ALTOS', 'CAL.MONTE ROSA NRO. 233 URB. CHACARILLA', 'WhatsApp 977 410 924', 'Sucursal: Jr. Angaraes 713'];
const mes = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre'];
let ok = 0, N = NN; const fails = {};
for (let i = 0; i < N; i++) {
  const sup = pick(SUP), ruc = rucGen(), conNombre = rnd() > 0.15, pre = pick(['F001', 'FT01', 'FFF1', 'E001', 'B001', 'FA01']), n = String(ri(1, 99999999)).padStart(pick([1, 6, 8, 10]), '0').replace(/^0+(?=\d{9,})/, '');
  const d = [2026, ri(1, 12), ri(1, 28)], fmt = pick([0, 1, 2, 3, 4]);
  const fecha = [`${String(d[2]).padStart(2, '0')}/${String(d[1]).padStart(2, '0')}/2026`, `2026-${String(d[1]).padStart(2, '0')}-${String(d[2]).padStart(2, '0')}`, `${d[2]}/${d[1]}/2026`, `${String(d[2]).padStart(2, '0')}-${String(d[1]).padStart(2, '0')}-2026`, `${d[2]} de ${mes[d[1] - 1]} del 2026`][fmt];
  const fiso = `2026-${String(d[1]).padStart(2, '0')}-${String(d[2]).padStart(2, '0')}`;
  const sepDoc = pick(['-', ' - ', ' N° ', ' Nº ', ' N°', '-N°']), docId = pre + sepDoc + n;
  const rlabel = pick(['RUC ', 'R.U.C. ', 'RUC: ', 'R.U.C.: ', 'RUC N° ']);
  const tipo = pick(['FACTURA ELECTRÓNICA', 'FACTURA ELECTRONICA']);
  const nz = [pick(NOISE), pick(NOISE), pick(NOISE)].filter((x, k, a) => a.indexOf(x) === k);
  const layout = pick(['H1', 'H2', 'H3', 'H4']);
  const cli = [`Señor(es)  : ${CLI}`, `RUC  : ${CRUC}`, 'Dirección  : PJ. ENRIQUE MONTES NRO. 150 INT. 147'];
  const cliT = pick([cli, ['DATOS DEL CLIENTE', `RUC  : ${CRUC}`, `DENOMINACIÓN  : ${CLI}`, 'DIRECCIÓN  : PJ. ENRIQUE MONTES']]);
  const fechaL = `Fecha Emisión  : ${fecha}` + pick(['', '  Moneda: SOLES']);
  let rows = [];
  const nameCell = conNombre ? sup : '';
  if (layout === 'H1') rows = [`${nameCell}  ${rlabel}${ruc}`.trim(), `${nz[0]}  ${tipo}`, `${nz[1] || ''}  ${docId}`, fechaL, ...cliT];
  else if (layout === 'H2') rows = [`${rlabel}${ruc}`, tipo, docId, nameCell, ...nz, fechaL, ...cliT];
  else if (layout === 'H3') rows = [nameCell, nz[0], nz[1] || 'Telf: (01) 555-1234', `${rlabel}${ruc}`, `${tipo}  ${docId}`, fechaL, ...cliT];
  else rows = [...cliT, fechaL, `${tipo}  ${docId}`, nameCell ? `Razón Social: ${nameCell}` : '', `RUC: ${ruc}`, 'Moneda: SOLES'];
  rows = rows.filter(Boolean);
  const text = [...rows, 'CANT  DESCRIPCION  P.UNIT  P.TOTAL', '1  ARTICULO  10.00  10.00'].join('\n');
  const r = CI.parseTexto(text, 'PDF');
  const bad = [];
  if (r.ruc !== ruc) bad.push(`ruc ${r.ruc}`);
  if (r.serie !== pre) bad.push(`serie ${r.serie}`);
  if (r.numero !== n) bad.push(`num ${r.numero} vs ${n}`);
  if (r.fecha !== fiso) bad.push(`fecha ${r.fecha} vs ${fiso}`);
  const normN = s => s.replace(/[^A-Z0-9 ]/g, '').trim();
  if (normN(r.proveedor) !== normN(conNombre ? sup : '')) bad.push(`prov "${r.proveedor}" vs "${conNombre ? sup : ''}"`);
  if (!bad.length) ok++; else (fails[layout] = fails[layout] || []).push({ rows, bad });
}
return { ok, total: N, fails };
}

test('Lector: 3000 filas al azar (10 formatos de tabla, separadores simples o dobles, monedas, descuentos) ≥ 99,5 % exactas', () => {
  const r = fuzzFilas(7, 3000);
  assert.ok(r.ok / r.total >= 0.995, `solo ${r.ok}/${r.total}: ` + JSON.stringify(Object.fromEntries(Object.entries(r.fails).map(([k, v]) => [k, v.slice(0, 2)]))).slice(0, 1500));
});

test('Lector: 2000 encabezados al azar (proveedor, RUC, serie, número y fecha; cliente antes o después) 100 % exactos', () => {
  const r = fuzzEncabezados(5, 2000);
  assert.equal(r.ok, r.total, JSON.stringify(Object.fromEntries(Object.entries(r.fails).map(([k, v]) => [k, v.slice(0, 2)]))).slice(0, 1500));
});

test('RUC: el dígito verificador detecta cifras mal leídas y repara una sola cifra confusa', () => {
  assert.equal(CI.rucValido('20608364502'), true);
  assert.equal(CI.rucValido('20616269659'), true);
  assert.equal(CI.rucValido('20608364503'), false);
  assert.equal(CI.repararRuc('20608364502'), '20608364502');
  const malo = '20616269659'.replace('6', '8');   // el OCR leyó 6 como 8
  assert.equal(CI.rucValido(malo), false);
  assert.equal(CI.parseTexto('FACTURA ELECTRÓNICA\nRUC ' + malo + '\nF001-1', 'PDF').rucDudoso, true);
});
