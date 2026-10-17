// Flujo completo: Compras (pantalla real) → Stock (pantalla real) → almacenes, costos, anulación.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { loadApp } = require('./helpers/load-app');
const view = n => fs.readFileSync(path.join(__dirname, '..', 'views', n + '-view.html'), 'utf8');
const wait = ms => new Promise(r => setTimeout(r, ms));
const suma = p => ['alm1', 'alm2', 'alm3'].reduce((t, k) => t + ((p.almacenes || {})[k] || 0), 0);

test('E2E: compra desde el comprobante → aparece en Stock (solo en su almacén) → costo → anular', async () => {
  const html = '<div id="viewRoot"></div>';
  const { window, firebase, errors } = loadApp(['tests/helpers/stub-auth.js', 'firebase.js', 'selection.js', 'balance-logic.js', 'compras-import.js', 'stock.js'], html);
  const d = window.document, $ = id => d.getElementById(id);
  firebase._store.products = { G1: { name: 'Guitarra Clevan', stock: 4, tipo: 'importado', price: 300 } };   // viejo, sin reparto
  await wait(150);

  // 1) Pantalla Compras: se lee un comprobante con un producto existente y uno nuevo
  d.getElementById('viewRoot').innerHTML = view('compras');
  await window.Compras.init();
  const borrador = window.ComprasImport.parseTexto(['CLEVAN SAC', 'RUC 20123456789', 'FACTURA ELECTRONICA F001-500', 'Fecha: 02/10/2026',
    '2  NIU  G1  Guitarra Clevan  100.00  118.00  236.00', '6  NIU  J-77  CUERDAS NYLON  10.00  11.80  70.80'].join('\n'), 'PDF');
  assert.equal(borrador.lineas.length, 2);
  window.ComprasImport.abrirPrevisualizacion(borrador, firebase._store.products, () => {});
  assert.equal(d.querySelectorAll('#ciLineas tr').length, 2);
  assert.equal(d.querySelector('.ci-desc').value, 'Guitarra Clevan');
  d.getElementById('ciModal').remove();
  // se aprueba con el flujo real del formulario
  window.ComprasImport.abrirPrevisualizacion(borrador, firebase._store.products, (b, g) => { window.__b = b; });
  d.getElementById('ciAlm').value = 'alm2';
  d.getElementById('ciGuardar').click();
  assert.equal(window.__b.lineas.length, 2);
  // aplicar al formulario y guardar (misma ruta que usa la pantalla)
  $('cpProv').value = window.__b.proveedor; $('cpRuc').value = window.__b.ruc; $('cpCompTipo').value = 'Factura'; $('cpSerie').value = 'F001'; $('cpNumero').value = '500'; $('cpAlm').value = 'alm2';
  $('cpLineas').innerHTML = '';
  for (const l of window.__b.lineas) {
    $('cpAddLinea').click(); const tr = $('cpLineas').lastElementChild;
    tr.querySelector('.ln-prod').value = l.code; tr.querySelector('.ln-qty').value = l.qty; tr.querySelector('.ln-price').value = l.precio;
    if (l.code === '__nuevo__') { tr.querySelector('.nv-code').value = l.codigoNuevo; tr.querySelector('.nv-name').value = l.desc; tr.querySelector('.nv-tipo').value = l.tipoNuevo; }
  }
  $('cpSave').click(); await wait(400);
  assert.match($('cpMsg').textContent, /^✓ Compra registrada · 2 productos · S\/ 306\.80 · Pon el precio de venta en Stock$/);
  assert.equal(d.querySelector('.bal-card h3').textContent, 'Registrar compra');
  // el formulario queda en blanco tras registrar
  assert.deepEqual(['cpProv', 'cpRuc', 'cpSerie', 'cpNumero', 'cpObs'].map(i => $(i).value), ['', '', '', '', '']);
  assert.equal($('cpLineas').querySelectorAll('tr').length, 1); assert.equal($('cpLineas').querySelector('.ln-prod').value, '');
  assert.equal($('cpSave').textContent, 'Registrar compra'); assert.equal($('cpSave').disabled, false);
  // «Limpiar formulario» borra lo escrito
  $('cpProv').value = 'X'; $('cpSerie').value = 'F9'; window.confirm = () => true; $('cpReset').click();
  assert.deepEqual([$('cpProv').value, $('cpSerie').value, $('cpMsg').style.display], ['', '', 'none']);
  const P = firebase._store.products;
  assert.equal(P.G1.stock, 6); assert.equal(P.G1.stock, suma(P.G1));
  assert.deepEqual({ ...P.G1.almacenes }, { alm1: 4, alm2: 2, alm3: 0 });
  assert.equal(P['J-77'].stock, 6); assert.deepEqual({ ...P['J-77'].almacenes }, { alm1: 0, alm2: 6, alm3: 0 });
  assert.equal(P['J-77'].name, 'CUERDAS NYLON');

  // 2) Pantalla Stock: Todos, y cada almacén solo con lo que tiene
  d.getElementById('viewRoot').innerHTML = view('stock');
  await window.refreshProductsNow(); await wait(150);
  window.Stock.init(); await wait(150);
  const filas = () => [...d.querySelectorAll('#productTableBody tr[data-code]')].map(tr => tr.dataset.code + ':' + tr.querySelector('.pt-qty').textContent.trim());
  assert.deepEqual(filas().sort(), ['G1:6', 'J-77:6']);
  window.switchWarehouse('alm1'); assert.deepEqual(filas(), ['G1:4']);
  window.switchWarehouse('alm2'); assert.deepEqual(filas().sort(), ['G1:2', 'J-77:6']);
  window.switchWarehouse('alm3'); assert.deepEqual(filas(), []);
  window.switchWarehouse('');

  // 3) Costo de compra visible = lo pagado CON IGV (G1: 2 × 118 → 118 por unidad; J-77: 6 × 11.80)
  const c = await window.costosPorProducto();
  assert.equal(c.G1.prom, 118); assert.equal(Math.round(c['J-77'].prom * 100) / 100, 11.8);

  window.cargarCostosStock(); await wait(200);
  assert.match(d.getElementById('statValue').textContent.replace(/\s/g, ''), /^S\/778\.8/);   // 6×118 + 6×11.80 (a costo con IGV, no a precio de venta)
  assert.ok(d.querySelector('#productTableBody .stock-edit-btn') && d.querySelector('#productTableBody .stock-del-btn'));

  // 4) Anular la compra revierte stock y almacén
  const ids = Object.keys(firebase._store.compras);
  for (const id of ids) await window.anularCompra(id);
  assert.equal(P.G1.stock, 4); assert.deepEqual({ ...P.G1.almacenes }, { alm1: 4, alm2: 0, alm3: 0 });
  assert.equal(P['J-77'].stock, 0);
  assert.equal((await window.costosPorProducto()).G1, undefined);
  // 5) Limpiar anuladas: salen del historial, el stock no cambia y el producto que solo existía por la compra se quita
  assert.equal(await window.limpiarComprasAnuladas(), 2);
  assert.deepEqual(Object.keys(firebase._store.compras || {}), []);
  assert.equal(P.G1.stock, 4); assert.ok(P.G1);
  assert.equal(firebase._store.products['J-77'], undefined);
  // 6) Anular y quitar de una vez: vuelve todo al estado anterior
  const r2 = await window.registrarFactura({ proveedor: 'Clevan SAC', ruc: '20123456789', fecha: '2026-10-03', compTipo: 'Factura', compSerie: 'F001', compNum: '900', almacen: 'alm1' },
    [{ nuevo: { code: 'Z-1', nombre: 'NUEVO', tipo: 'importado' }, tipo: 'importado', qty: 2, precio: 118 }, { code: 'G1', nombre: 'Guitarra', tipo: 'importado', qty: 1, precio: 118 }]);
  assert.equal(firebase._store.products['Z-1'].stock, 2); assert.equal(P.G1.stock, 5);
  for (const id of r2.ids) await window.anularYQuitarCompra(id);
  assert.equal(firebase._store.products['Z-1'], undefined);
  assert.equal(P.G1.stock, 4); assert.equal(P.G1.stock, suma(P.G1));
  assert.deepEqual(Object.keys(firebase._store.compras || {}), []);
  assert.deepEqual(errors, []);
});
