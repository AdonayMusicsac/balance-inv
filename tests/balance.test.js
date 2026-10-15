// tests/balance.test.js — compras, anulaciones, documentación, ajustes y alertas de BALANCE-INV.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load-app');

function setup(productos) {
  const { window, firebase } = loadApp(['firebase.js', 'balance-logic.js']);
  firebase._store.products = productos || { G1: { name: 'Guitarra Clevan', stock: 0, tipo: 'importado' } };
  const movs = () => Object.values(firebase._store.movimientos || {});
  const compra = (o = {}) => window.registrarCompra({ code: 'G1', nombre: 'Guitarra Clevan', proveedor: 'Clevan SAC', ruc: '20123456789',
    qty: 10, precio: 380, fecha: '2026-09-28', tipo: 'importado', stockMin: 3, docTipo: 'Factura', docNum: 'F001-1', docQty: 10, ...o });
  return { window, firebase, movs, compra };
}

test('compra: sube el stock y deja movimiento con saldo', async () => {
  const { firebase, movs, compra } = setup();
  await compra();
  assert.equal(firebase._store.products.G1.stock, 10);
  assert.equal(movs().length, 1);
  assert.equal(movs()[0].saldoResultante, 10);
  assert.equal(movs()[0].origenTipo, 'compra');
});

test('compra inválida (documentada > comprada, cantidad decimal): rechaza y NO toca el stock', async () => {
  const { firebase, movs, compra } = setup();
  await assert.rejects(compra({ docQty: 11 }), /documentada/);
  await assert.rejects(compra({ qty: 2.5 }), /entero/);
  assert.equal(firebase._store.products.G1.stock, 0);
  assert.equal(movs().length, 0);
});

test('compra de un producto que ya no existe: rechaza y no crea un producto fantasma', async () => {
  const { firebase, compra } = setup({});
  await assert.rejects(compra(), /no existe/);
  assert.equal(firebase._store.products.G1, undefined);
});

test('anularCompra: descuenta con movimiento inverso; no se puede anular dos veces', async () => {
  const { window, firebase, movs, compra } = setup();
  const id = await compra();
  await window.anularCompra(id);
  assert.equal(firebase._store.products.G1.stock, 0);
  assert.equal(movs().at(-1).tipo, 'anulacion_compra');
  await assert.rejects(window.anularCompra(id), /ya está anulada/);
  assert.equal(firebase._store.products.G1.stock, 0);
});

test('anularCompra: si parte ya se vendió, rechaza y deja la compra vigente', async () => {
  const { window, firebase, compra } = setup();
  const id = await compra();
  firebase._store.products.G1.stock = 4;   // se vendieron 6
  await assert.rejects(window.anularCompra(id), /ya se vendió/);
  assert.equal(firebase._store.products.G1.stock, 4);
  assert.notEqual(firebase._store.compras[id].anulada, true);
});

test('venta de importado: consume documentación; lo que excede queda registrado como "sin documento"', async () => {
  const { window, firebase, movs, compra } = setup();
  const id = await compra({ docQty: 4 });
  await window.registrarSalidaVenta([{ code: 'G1', name: 'Guitarra', qty: 6 }], 'ORD1', [{ code: 'G1', newStock: 4 }], 'NP-1');
  assert.equal(firebase._store.compras[id].documento.cantUtilizada, 4);
  const v = movs().find(m => m.tipo === 'venta');
  assert.equal(v.cantidad, -6);
  assert.equal(v.sinDocumento, 2);
  assert.equal(v.saldoResultante, 4);
});

test('anular una venta devuelve la documentación consumida y compensa el "sin documento"', async () => {
  const { window, firebase, movs, compra } = setup();
  const id = await compra({ docQty: 4 });
  await window.registrarSalidaVenta([{ code: 'G1', name: 'Guitarra', qty: 6 }], 'ORD1', [{ code: 'G1', newStock: 4 }], 'NP-1');
  await window.registrarAnulacionVenta('ORD1', [{ code: 'G1', name: 'Guitarra', qty: 6 }]);
  assert.equal(firebase._store.compras[id].documento.cantUtilizada, 0);
  assert.equal(movs().reduce((s, m) => s + (m.sinDocumento || 0), 0), 0);
});

test('ajustarStock: registra motivo y diferencia; valida motivo, nota y cantidad', async () => {
  const { window, firebase, movs } = setup({ G1: { name: 'Guitarra', stock: 10, tipo: 'importado' } });
  await assert.rejects(window.ajustarStock('G1', 8, '', ''), /motivo/);
  await assert.rejects(window.ajustarStock('G1', 8, 'Otro', ' '), /nota/);
  await assert.rejects(window.ajustarStock('G1', -1, 'Merma', ''), /entero/);
  assert.equal(firebase._store.products.G1.stock, 10);
  assert.equal(await window.ajustarStock('G1', 8, 'Merma', 'rotura en bodega'), -2);
  assert.equal(firebase._store.products.G1.stock, 8);
  const m = movs()[0];
  assert.deepEqual([m.tipo, m.cantidad, m.saldoResultante, m.motivo], ['ajuste', -2, 8, 'Merma']);
});

test('alertas: stock bajo, documentación pendiente y diferencia detectada (con tolerancia a operaciones recientes)', async () => {
  const { window, firebase, compra } = setup({ G1: { name: 'Guitarra', stock: 0, tipo: 'importado' } });
  await compra({ qty: 10, docQty: 6, stockMin: 3 });
  firebase._store.products.G1.stock = 2;   // alguien lo cambió sin registrar
  let tipos = (await window.calcularAlertas()).map(a => a.tipo);
  assert.ok(tipos.includes('Stock bajo'));
  assert.ok(tipos.includes('Documentación pendiente'));
  assert.ok(!tipos.includes('Diferencia detectada'), 'no debe alertar por una operación de hace segundos');
  Object.values(firebase._store.movimientos).forEach(m => { m.timestamp -= 10 * 60 * 1000; });
  tipos = (await window.calcularAlertas()).map(a => a.tipo);
  assert.ok(tipos.includes('Diferencia detectada'));
});

test('balance facturable: separa lo que tiene documento de lo que no y valora ambos en soles', async () => {
  const { window, firebase, compra } = setup({ G1: { name: 'Guitarra', stock: 0, tipo: 'importado', price: 500 } });
  await compra({ qty: 10, docQty: 6, stockMin: 3 });
  await window.registrarSalidaVenta([{ code: 'G1', name: 'Guitarra', qty: 2 }], 'O1', [{ code: 'G1', newStock: 8 }], 'NP-1');
  firebase._store.products.G1.stock = 8;
  const [g] = await window.calcularBalanceFacturable();
  assert.deepEqual([g.stock, g.facturable, g.sinDoc, g.montoFact, g.montoSin], [8, 4, 4, 2000, 2000]);
  assert.equal(g.accion, 'Regularizar documentos');
});

test('balance facturable: pide comprar o documentar más cuando lo facturable llega al mínimo, y ignora nacionales', async () => {
  const { window, firebase, compra } = setup({ G1: { name: 'Guitarra', stock: 0, tipo: 'importado', price: 500 }, N1: { name: 'Nacional', stock: 9, tipo: 'nacional', price: 50 } });
  await compra({ qty: 4, docQty: 4, stockMin: 3 });
  await window.registrarSalidaVenta([{ code: 'G1', name: 'Guitarra', qty: 2 }], 'O1', [{ code: 'G1', newStock: 2 }], 'NP-1');
  firebase._store.products.G1.stock = 2;
  const r = await window.calcularBalanceFacturable();
  assert.equal(r.length, 1);
  assert.equal(r[0].accion, 'Comprar o documentar más');
});

test('costo real: convierte dólares a soles con tipo de cambio y reparte flete y aduana; calcula margen', async () => {
  const { window, compra } = setup({ G1: { name: 'Guitarra', stock: 0, tipo: 'importado', price: 500 } });
  await assert.rejects(compra({ moneda: 'USD', tc: 0 }), /tipo de cambio/);
  await compra({ qty: 10, precio: 100, moneda: 'USD', tc: 3.7, gastos: 200, docQty: 10 });
  const [g] = await window.calcularBalanceFacturable();
  assert.equal(g.costoProm, 390);            // (100 x 3.7 x 10 + 200) / 10
  assert.equal(Math.round(g.margenPct), 22); // (500 - 390) / 500
});

test('editar una nota: anula lo anterior y registra lo nuevo, devolviendo y reconsumiendo documentación', async () => {
  const { window, firebase, movs, compra } = setup();
  const id = await compra({ docQty: 4 });
  await window.registrarSalidaVenta([{ code: 'G1', name: 'Guitarra', qty: 6 }], 'ORD1', [{ code: 'G1', newStock: 4 }], 'NP-1');
  firebase._store.products.G1.stock = 7;   // la edición dejó la venta en 3
  await window.registrarEdicionVenta('ORD1', [{ code: 'G1', name: 'Guitarra', qty: 6 }], [{ code: 'G1', name: 'Guitarra', qty: 3 }], [{ code: 'G1', newStock: 7 }], 'NP-1');
  assert.equal(firebase._store.compras[id].documento.cantUtilizada, 3);
  assert.equal(movs().reduce((s, m) => s + (m.sinDocumento || 0), 0), 0);
  const tipos = movs().map(m => m.tipo);
  assert.deepEqual(tipos.slice(-2), ['anulacion_venta', 'venta']);
  assert.equal(movs().at(-1).saldoResultante, 7);
});

test('conteo masivo: ajusta los que difieren, ignora los iguales y reporta los que fallan', async () => {
  const { window, firebase } = setup({ A: { name: 'A', stock: 5 }, B: { name: 'B', stock: 3 } });
  const r = await window.aplicarConteo([{ code: 'A', contado: 4 }, { code: 'B', contado: 3 }, { code: 'X', contado: 1 }, { code: 'A2', contado: -5 }], 'inventario anual');
  assert.equal(r.ajustados, 1); assert.equal(r.iguales, 1); assert.equal(r.errores.length, 2);
  assert.equal(firebase._store.products.A.stock, 4);
});

test('reportes: detecta dinero parado y los más vendidos de los últimos 30 días', async () => {
  const { window, firebase } = setup({ A: { name: 'A', stock: 5, price: 10 }, B: { name: 'B', stock: 8, price: 20 } });
  const dia = 864e5, ahora = Date.now();
  firebase._store.movimientos = {
    m1: { code: 'A', tipo: 'venta', cantidad: -3, timestamp: ahora - 2 * dia },
    m2: { code: 'B', tipo: 'compra', cantidad: 8, timestamp: ahora - 120 * dia },
  };
  const r = await window.calcularReportes();
  assert.deepEqual([...r.parados.map(x => x.code)], ['B']);
  assert.equal(r.parados[0].valor, 160);
  assert.deepEqual(JSON.parse(JSON.stringify(r.top.map(x => [x.code, x.vendido]))), [['A', 3]]);
});

// ── Factura con varias líneas (modelo del Excel: precios con IGV 18 % incluido) ──
const prodsFact = () => ({ G1: { name: 'Guitarra', stock: 0, tipo: 'importado' }, C1: { name: 'Cuerdas', stock: 0, tipo: 'nacional' } });
const hdr = (o = {}) => ({ proveedor: 'Clevan SAC', ruc: '20123456789', fecha: '2026-10-01', compTipo: 'Factura', compSerie: 'F001', compNum: '123', ...o });

test('IGV incluido: base = ROUND(total/1.18,2) e IGV = total − base', () => {
  const { window } = setup();
  const i = window.calcularImportes(3, 59.9);
  assert.deepEqual({ ...i }, { total: 179.7, base: 152.29, igv: 27.41 });
});

test('factura con 2 productos: suma stock, documenta cada línea y devuelve totales', async () => {
  const { window, firebase, movs } = setup(prodsFact());
  const r = await window.registrarFactura(hdr(), [
    { code: 'G1', nombre: 'Guitarra', tipo: 'importado', qty: 4, precio: 118 },
    { code: 'C1', nombre: 'Cuerdas', tipo: 'nacional', qty: 10, precio: 11.8 }]);
  assert.equal(firebase._store.products.G1.stock, 4);
  assert.equal(firebase._store.products.C1.stock, 10);
  assert.equal(movs().length, 2);
  assert.equal(r.total, 590); assert.equal(r.base, 500); assert.equal(r.igv, 90);
  const cs = Object.values(firebase._store.compras);
  assert.ok(cs.every(c => c.documento.numero === 'F001-123' && c.documento.cantDocumentada === c.cantidad));
  const k = Object.values(firebase._store.costos).find(x => x.code === 'G1');
  assert.equal(k.costoUnit, 100);   // factura: costo sin IGV
});

test('factura: si una línea falla se revierte todo (stock y movimientos netos en cero)', async () => {
  const { window, firebase } = setup(prodsFact());
  await assert.rejects(window.registrarFactura(hdr(), [
    { code: 'G1', nombre: 'Guitarra', tipo: 'importado', qty: 4, precio: 118 },
    { code: 'NOEXISTE', nombre: 'X', tipo: 'nacional', qty: 1, precio: 5 }]), /no existe/);
  assert.equal(firebase._store.products.G1.stock, 0);
  assert.equal(firebase._store.products.NOEXISTE, undefined);
});

test('factura: rechaza comprobante duplicado, factura sin RUC y número vacío', async () => {
  const { window, firebase } = setup(prodsFact());
  const l = [{ code: 'G1', nombre: 'Guitarra', tipo: 'importado', qty: 1, precio: 118 }];
  await window.registrarFactura(hdr(), l);
  await assert.rejects(window.registrarFactura(hdr(), l), /ya fue registrado/);
  await assert.rejects(window.registrarFactura(hdr({ compNum: '124', ruc: '' }), l), /RUC/);
  await assert.rejects(window.registrarFactura(hdr({ compNum: '' }), l), /número/);
  assert.equal(firebase._store.products.G1.stock, 1);
});

test('compra nacional sin comprobante: sube stock, no crea documentación', async () => {
  const { window, firebase } = setup(prodsFact());
  await window.registrarFactura(hdr({ compTipo: '', compNum: '', compSerie: '', ruc: '' }), [{ code: 'C1', nombre: 'Cuerdas', tipo: 'nacional', qty: 6, precio: 10 }]);
  assert.equal(firebase._store.products.C1.stock, 6);
  assert.equal(Object.values(firebase._store.compras)[0].documento, null);
});

test('pantalla Compras: llena una factura de 2 líneas y guarda desde el formulario', async () => {
  const fs = require('fs'), path = require('path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'views', 'compras-view.html'), 'utf8');
  const { window, firebase } = loadApp(['firebase.js', 'balance-logic.js'], html);
  firebase._store.products = prodsFact();
  const d = window.document, $ = id => d.getElementById(id), fire = (el, t) => el.dispatchEvent(new window.Event(t, { bubbles: true }));
  await window.Compras.init();
  const set = (id, v) => { $(id).value = v; fire($(id), 'change'); };
  set('cpProv', 'Clevan SAC'); set('cpRuc', '20123456789'); set('cpCompTipo', 'Factura'); set('cpSerie', 'f001'); set('cpNumero', '77');
  $('cpAddLinea').click();
  const rows = d.querySelectorAll('#cpLineas tr');
  assert.equal(rows.length, 2);
  [['G1', 2, 118], ['C1', 5, 11.8]].forEach(([c, q, p], i) => {
    rows[i].querySelector('.ln-prod').value = c; rows[i].querySelector('.ln-qty').value = q; rows[i].querySelector('.ln-price').value = p;
    fire(rows[i].querySelector('.ln-qty'), 'input');
  });
  assert.match($('cpTotales').textContent, /Total S\/ 295\.00/);
  $('cpSave').click();
  await new Promise(r => setTimeout(r, 50));
  assert.equal(firebase._store.products.G1.stock, 2);
  assert.equal(firebase._store.products.C1.stock, 5);
  assert.ok(Object.values(firebase._store.compras).every(c => c.documento.numero === 'F001-77'));
});

// ── Lectura de comprobantes (XML / texto) y previsualización ──
const XML = `<?xml version="1.0"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
<cbc:ID>F001-00123</cbc:ID><cbc:IssueDate>2026-10-02</cbc:IssueDate><cbc:InvoiceTypeCode>01</cbc:InvoiceTypeCode>
<cac:AccountingSupplierParty><cac:Party><cac:PartyIdentification><cbc:ID>20123456789</cbc:ID></cac:PartyIdentification><cac:PartyLegalEntity><cbc:RegistrationName>CLEVAN SAC</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingSupplierParty>
<cac:InvoiceLine><cbc:ID>1</cbc:ID><cbc:InvoicedQuantity unitCode="NIU">4</cbc:InvoicedQuantity><cac:PricingReference><cac:AlternativeConditionPrice><cbc:PriceAmount>118.00</cbc:PriceAmount><cbc:PriceTypeCode>01</cbc:PriceTypeCode></cac:AlternativeConditionPrice></cac:PricingReference><cac:Item><cbc:Description>Guitarra Clevan</cbc:Description><cac:SellersItemIdentification><cbc:ID>G1</cbc:ID></cac:SellersItemIdentification></cac:Item><cac:Price><cbc:PriceAmount>100.00</cbc:PriceAmount></cac:Price></cac:InvoiceLine>
</Invoice>`;

test('lector XML SUNAT: proveedor, RUC, serie/número, fecha y líneas con precio con IGV', () => {
  const { window } = loadApp(['compras-import.js']);
  const r = window.ComprasImport.parseXml(XML);
  assert.equal(r.proveedor, 'CLEVAN SAC'); assert.equal(r.ruc, '20123456789');
  assert.equal(r.serie, 'F001'); assert.equal(r.numero, '00123'); assert.equal(r.fecha, '2026-10-02'); assert.equal(r.tipo, 'Factura');
  assert.deepEqual(JSON.parse(JSON.stringify(r.lineas)), [{ codigo: 'G1', desc: 'Guitarra Clevan', qty: 4, precio: 118 }]);
  assert.throws(() => window.ComprasImport.parseXml('<a>no</a>'), /no es una factura/);
});

test('lector de texto (PDF/OCR): RUC, serie, fecha y líneas cuya cuenta cuadra', () => {
  const { window } = loadApp(['compras-import.js']);
  const r = window.ComprasImport.parseTexto('CLEVAN SAC\nRUC 20123456789\nFACTURA ELECTRONICA F001-123\nFecha: 02/10/2026\nG1  Guitarra Clevan  4  UND  118.00  472.00\nTotal 472.00', 'PDF');
  assert.equal(r.ruc, '20123456789'); assert.equal(r.serie, 'F001'); assert.equal(r.numero, '123'); assert.equal(r.fecha, '2026-10-02');
  assert.equal(r.lineas.length, 1); assert.equal(r.lineas[0].qty, 4); assert.equal(r.lineas[0].precio, 118);
});

test('previsualización: sugiere el producto, no guarda nada y solo rellena al aprobar', () => {
  const { window, firebase } = loadApp(['compras-import.js']);
  const prods = { G1: { name: 'Guitarra Clevan' }, C1: { name: 'Cuerdas nylon' } };
  let recibido = null;
  window.ComprasImport.abrirPrevisualizacion(window.ComprasImport.parseXml(XML), prods, b => { recibido = b; });
  const d = window.document;
  assert.equal(d.querySelector('.ci-prod').value, 'G1');
  assert.equal(firebase._store.compras, undefined);
  d.getElementById('ciNum').value = '124';
  d.getElementById('ciOk').click();
  assert.equal(recibido.numero, '124'); assert.equal(recibido.lineas[0].code, 'G1'); assert.equal(d.getElementById('ciModal'), null);
  window.ComprasImport.abrirPrevisualizacion(window.ComprasImport.parseXml(XML), prods, () => { throw new Error('no debe aprobar'); });
  d.getElementById('ciCancel').click();
  assert.equal(d.getElementById('ciModal'), null);
});

test('previsualización: «Aprobar y guardar compra» avisa que debe guardar; «Pasar al formulario» no', () => {
  const { window } = loadApp(['compras-import.js']);
  const prods = { G1: { name: 'Guitarra Clevan' } }, flags = [];
  const abrir = () => window.ComprasImport.abrirPrevisualizacion(window.ComprasImport.parseXml(XML), prods, (b, guardar) => flags.push(guardar));
  const d = window.document;
  abrir(); d.getElementById('ciOk').click();
  abrir(); d.getElementById('ciGuardar').click();
  assert.deepEqual(flags, [false, true]);
  abrir(); d.querySelector('.ci-prod').value = ''; d.getElementById('ciGuardar').click();   // sin producto elegido: no guarda
  assert.deepEqual(flags, [false, true]);
});

// ── Productos nuevos desde la compra ──
test('importado nuevo: se crea con el código y descripción de la factura, costo guardado, precio 0 y stock suma', async () => {
  const { window, firebase } = setup({});
  const r = await window.registrarFactura(hdr(), [{ nuevo: { code: 'j101044m', nombre: 'JUEGO DE CUERDAS CELLO', tipo: 'importado' }, qty: 3, precio: 118 }]);
  const p = firebase._store.products.J101044M;
  assert.equal(p.name, 'JUEGO DE CUERDAS CELLO'); assert.equal(p.stock, 3); assert.equal(p.tipo, 'importado'); assert.equal(p.price, 0);
  assert.deepEqual([...r.creados], ['J101044M']);
  assert.equal(Object.values(firebase._store.costos)[0].costoUnit, 100);
  assert.equal(Object.values(firebase._store.compras)[0].documento.cantDocumentada, 3);
});

test('nacional nuevo sin código: el sistema asigna NAC-0001, NAC-0002… sin repetir', async () => {
  const { window, firebase } = setup({ 'NAC-0007': { name: 'Viejo', stock: 1, tipo: 'nacional' } });
  const r = await window.registrarFactura(hdr({ compTipo: '', compNum: '', ruc: '' }), [
    { nuevo: { code: '', nombre: 'Afinador', tipo: 'nacional' }, qty: 2, precio: 20 },
    { nuevo: { code: '', nombre: 'Correa', tipo: 'nacional' }, qty: 1, precio: 15 }]);
  assert.deepEqual([...r.creados], ['NAC-0008', 'NAC-0009']);
  assert.equal(firebase._store.products['NAC-0008'].stock, 2);
  assert.equal(Object.values(firebase._store.compras)[0].documento, null);
});

test('producto nuevo: rechaza código repetido, importado sin código, y si falla no deja productos creados', async () => {
  const { window, firebase } = setup({ G1: { name: 'Guitarra', stock: 1, tipo: 'importado' } });
  await assert.rejects(window.registrarFactura(hdr(), [{ nuevo: { code: 'g1', nombre: 'X', tipo: 'importado' }, qty: 1, precio: 5 }]), /Ya existe/);
  await assert.rejects(window.registrarFactura(hdr({ compNum: '9' }), [{ nuevo: { code: '', nombre: 'X', tipo: 'importado' }, qty: 1, precio: 5 }]), /código que trae la factura/);
  await assert.rejects(window.registrarFactura(hdr({ compNum: '10' }), [
    { nuevo: { code: 'Z9', nombre: 'Nuevo', tipo: 'importado' }, qty: 1, precio: 5 }, { code: 'NOEXISTE', nombre: 'X', tipo: 'nacional', qty: 1, precio: 5 }]), /no existe/);
  assert.equal(firebase._store.products.Z9, undefined);
  assert.equal(firebase._store.products.G1.stock, 1);
});

test('pantalla Compras: «Producto nuevo» muestra código/descripción y crea el producto al guardar', async () => {
  const fs = require('fs'), path = require('path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'views', 'compras-view.html'), 'utf8');
  const { window, firebase } = loadApp(['firebase.js', 'balance-logic.js'], html);
  firebase._store.products = {};
  const d = window.document, $ = id => d.getElementById(id), fire = (el, t) => el.dispatchEvent(new window.Event(t, { bubbles: true }));
  await window.Compras.init();
  $('cpProv').value = 'Feria local';
  const tr = d.querySelector('#cpLineas tr');
  tr.querySelector('.ln-prod').value = '__nuevo__'; fire(tr.querySelector('.ln-prod'), 'change');
  assert.notEqual(tr.querySelector('.ln-nuevo').style.display, 'none');
  tr.querySelector('.nv-tipo').value = 'nacional'; tr.querySelector('.nv-name').value = 'Afinador clip';
  tr.querySelector('.ln-qty').value = 3; tr.querySelector('.ln-price').value = 20;
  $('cpSave').click();
  await new Promise(r => setTimeout(r, 50));
  assert.equal(firebase._store.products['NAC-0001'].name, 'Afinador clip');
  assert.equal(firebase._store.products['NAC-0001'].stock, 3);
});

// ── "Facturar como": se entrega un nacional pero el comprobante sale con el nombre/valor de un importado ──
const prodsCruce = () => ({ M1: { name: 'Melódica 37 notas', stock: 10, tipo: 'importado', price: 60 }, N1: { name: 'Melódica nacional', stock: 20, tipo: 'nacional', price: 45 } });
async function setupCruce() {
  const s = setup(prodsCruce());
  await s.window.registrarFactura(hdr(), [{ code: 'M1', nombre: 'Melódica 37 notas', tipo: 'importado', qty: 6, precio: 50 }]);   // sube a 16, 6 documentadas
  s.firebase._store.products.M1.stock = 10;   // dejamos el stock físico en 10 para el ejemplo
  return s;
}

test('facturar como: baja el stock del nacional, NO el del importado, y gasta la documentación del importado', async () => {
  const { window, firebase } = await setupCruce();
  firebase._store.products.N1.stock = 17;   // se vendieron 3
  await window.registrarSalidaVenta([{ code: 'N1', name: 'Melódica nacional', qty: 3, price: 60, itemDiscountPct: 0, facturarComo: 'M1' }], 'ord1', [{ code: 'N1', newStock: 17 }], 'NP-1');
  const compra = Object.values(firebase._store.compras)[0];
  assert.equal(compra.documento.cantUtilizada, 3);
  assert.equal(firebase._store.products.M1.stock, 10);
  const bal = (await window.calcularBalanceFacturable()).find(x => x.code === 'M1');
  assert.equal(bal.docSaldo, 3); assert.equal(bal.usadoOtros, 3); assert.equal(bal.facturable, 3);
  const cr = await window.calcularCruces();
  assert.equal(cr.length, 1); assert.equal(cr[0].entregadoCode, 'N1'); assert.equal(cr[0].comoCode, 'M1'); assert.equal(cr[0].qty, 3); assert.equal(cr[0].monto, 180);
});

test('facturar como: anular la venta devuelve la documentación y limpia el cruce', async () => {
  const { window, firebase } = await setupCruce();
  const it = { code: 'N1', name: 'Melódica nacional', qty: 4, price: 60, itemDiscountPct: 0, facturarComo: 'M1' };
  firebase._store.products.N1.stock = 16;
  await window.registrarSalidaVenta([it], 'ord2', [{ code: 'N1', newStock: 16 }], 'NP-2');
  await window.registrarAnulacionVenta('ord2', [it]);
  assert.equal(Object.values(firebase._store.compras)[0].documento.cantUtilizada, 0);
  assert.equal((await window.calcularCruces()).length, 0);
  const bal = (await window.calcularBalanceFacturable()).find(x => x.code === 'M1');
  assert.equal(bal.docSaldo, 6); assert.equal(bal.usadoOtros, 0);
});

test('facturar como: sin documentación suficiente se avisa; un importado vendido como sí mismo no usa "facturar como"', async () => {
  const { window, firebase } = await setupCruce();
  let aviso = '';
  window.confirm = m => { aviso = m; return true; };
  await window.avisoSinDocumento([{ code: 'N1', qty: 8, facturarComo: 'M1' }]);
  assert.match(aviso, /Melódica 37 notas: facturas 8, con documento hay 6/);
  aviso = '';
  await window.avisoSinDocumento([{ code: 'N1', qty: 5, facturarComo: 'M1' }]);
  assert.equal(aviso, '');
  firebase._store.products.M1.stock = 9;
  await window.registrarSalidaVenta([{ code: 'M1', name: 'Melódica 37 notas', qty: 1, price: 60, facturarComo: 'N1' }], 'ord3', [{ code: 'M1', newStock: 9 }], 'NP-3');
  assert.equal((await window.calcularCruces()).length, 0);
});

test('pantalla Balance: muestra cuánto se puede facturar y la tabla de nacionales facturados como importado', async () => {
  const fs = require('fs'), path = require('path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'views', 'movimientos-view.html'), 'utf8');
  const { window, firebase } = loadApp(['firebase.js', 'balance-logic.js'], html);
  firebase._store.products = prodsCruce();
  await window.registrarFactura(hdr(), [{ code: 'M1', nombre: 'Melódica 37 notas', tipo: 'importado', qty: 6, precio: 50 }]);
  await window.registrarSalidaVenta([{ code: 'N1', name: 'Melódica nacional', qty: 2, price: 60, facturarComo: 'M1' }], 'o9', [{ code: 'N1', newStock: 18 }], 'NP-9');
  await window.Movimientos.init();
  const d = window.document;
  assert.match(d.getElementById('fbResumen').textContent, /Hoy puedes facturar \d+ unidades de 1 de 1 productos importados/);
  assert.match(d.getElementById('crRows').textContent, /Melódica nacional/);
  assert.match(d.getElementById('crTotal').textContent, /2 u\. · S\/ 120\.00/);
});


test('Compras: subir el XML y pulsar «Aprobar y registrar en stock» registra la compra y SUBE el stock sin tocar el formulario', async () => {
  const fs = require('fs'), path = require('path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'views', 'compras-view.html'), 'utf8');
  const { window, firebase } = loadApp(['firebase.js', 'balance-logic.js', 'compras-import.js'], html);
  firebase._store.products = { G1: { name: 'Guitarra Clevan', stock: 1, tipo: 'importado', price: 0 } };
  const d = window.document, $ = id => d.getElementById(id);
  await window.Compras.init();
  const archivo = { name: 'F001-123.xml', type: 'text/xml', text: async () => XML };   // jsdom no trae Blob.text()
  Object.defineProperty($('cpArchivo'), 'files', { value: [archivo], configurable: true });
  $('cpArchivo').dispatchEvent(new window.Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 100));
  assert.ok(d.getElementById('ciModal'), 'abre la previsualización');
  assert.equal(firebase._store.products.G1.stock, 1, 'aún no se registra nada');
  d.getElementById('ciGuardar').click();
  await new Promise(r => setTimeout(r, 150));
  assert.equal(firebase._store.products.G1.stock, 5);                       // 1 + 4 del comprobante
  const c = Object.values(firebase._store.compras);
  assert.equal(c.length, 1); assert.equal(c[0].documento.numero, 'F001-123'); assert.equal(c[0].documento.cantDocumentada, 4);
});

// ── Almacén de destino en Compras ──
test('compra: se añade al almacén elegido y stock == suma de almacenes', async () => {
  const { window, firebase } = setup({ G1: { name: 'Guitarra Clevan', stock: 5, tipo: 'importado', almacenes: { alm1: 3, alm2: 2, alm3: 0 } } });
  await window.registrarCompra({ code: 'G1', nombre: 'Guitarra Clevan', proveedor: 'Clevan SAC', ruc: '20123456789', qty: 4, precio: 118, fecha: '2026-10-01', tipo: 'importado', docTipo: 'Factura', docNum: 'F001-9', docQty: 4, almacen: 'alm3' });
  const p = firebase._store.products.G1;
  assert.deepEqual({ ...p.almacenes }, { alm1: 3, alm2: 2, alm3: 4 });
  assert.equal(p.stock, 9);
  assert.equal(Object.values(firebase._store.compras)[0].almacen, 'alm3');
});

test('compra: producto sin reparto por almacén → lo que había queda en Almacén 1 y lo nuevo va al elegido', async () => {
  const { window, firebase } = setup({ G1: { name: 'Guitarra Clevan', stock: 5, tipo: 'importado' } });
  await window.registrarCompra({ code: 'G1', nombre: 'Guitarra Clevan', proveedor: 'Clevan SAC', ruc: '20123456789', qty: 4, precio: 118, fecha: '2026-10-01', tipo: 'importado', docTipo: 'Factura', docNum: 'F001-9', docQty: 4, almacen: 'alm2' });
  const p = firebase._store.products.G1;
  assert.deepEqual({ ...p.almacenes }, { alm1: 5, alm2: 4, alm3: 0 });
  assert.equal(p.stock, 9);
});

test('anular compra: descuenta del mismo almacén donde se añadió', async () => {
  const { window, firebase } = setup({ G1: { name: 'Guitarra Clevan', stock: 5, tipo: 'importado', almacenes: { alm1: 5, alm2: 0, alm3: 0 } } });
  const id = await window.registrarCompra({ code: 'G1', nombre: 'Guitarra Clevan', proveedor: 'Clevan SAC', ruc: '20123456789', qty: 4, precio: 118, fecha: '2026-10-01', tipo: 'importado', docTipo: 'Factura', docNum: 'F001-9', docQty: 4, almacen: 'alm2' });
  await window.anularCompra(id);
  const p = firebase._store.products.G1;
  assert.deepEqual({ ...p.almacenes }, { alm1: 5, alm2: 0, alm3: 0 });
  assert.equal(p.stock, 5);
});

test('factura con almacén en la cabecera: todas las líneas entran al almacén elegido', async () => {
  const { window, firebase } = setup(prodsFact());
  await window.registrarFactura(hdr({ almacen: 'alm2' }), [
    { code: 'G1', nombre: 'Guitarra', tipo: 'importado', qty: 4, precio: 118 },
    { code: 'C1', nombre: 'Cuerdas', tipo: 'nacional', qty: 10, precio: 11.8 }]);
  assert.equal(firebase._store.products.G1.almacenes.alm2, 4);
  assert.equal(firebase._store.products.C1.almacenes.alm2, 10);
  assert.ok(Object.values(firebase._store.compras).every(c => c.almacen === 'alm2'));
});

test('Compras: el modal del comprobante deja elegir el almacén y «Aprobar y registrar en stock» lo respeta', async () => {
  const fs = require('fs'), path = require('path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'views', 'compras-view.html'), 'utf8');
  const { window, firebase } = loadApp(['firebase.js', 'balance-logic.js', 'compras-import.js'], html);
  firebase._store.products = { G1: { name: 'Guitarra Clevan', stock: 1, tipo: 'importado', price: 0, almacenes: { alm1: 1, alm2: 0, alm3: 0 } } };
  const d = window.document, $ = id => d.getElementById(id);
  await window.Compras.init();
  Object.defineProperty($('cpArchivo'), 'files', { value: [{ name: 'F001-123.xml', type: 'text/xml', text: async () => XML }], configurable: true });
  $('cpArchivo').dispatchEvent(new window.Event('change', { bubbles: true }));
  await new Promise(r => setTimeout(r, 100));
  d.getElementById('ciAlm').value = 'alm3';
  d.getElementById('ciGuardar').click();
  await new Promise(r => setTimeout(r, 150));
  const p = firebase._store.products.G1;
  assert.equal(p.stock, 5); assert.deepEqual({ ...p.almacenes }, { alm1: 1, alm2: 0, alm3: 4 });
});
