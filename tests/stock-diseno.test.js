// Pruebas del nuevo diseño de Stock (tarjeta con estado y menú ⋯, ícono de la barra) y del editor «Ajustar foto».
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp } = require('./helpers/load-app');

const leer = f => fs.readFileSync(path.join(__dirname, '..', 'www', f), 'utf8').replace(/\r/g, '');

function cargarStock() {
  const { window, firebase } = loadApp(['tests/helpers/stub-auth.js', 'firebase.js', 'selection.js', 'balance-logic.js', 'compras-import.js', 'stock.js'], '<div id="productList"></div>');
  return { window, firebase };
}
const tarjeta = (window, p) => { const d = window.document.createElement('div'); d.innerHTML = window.productCardHtml(p); return d; };

test('Stock: la tarjeta muestra código en etiqueta, estado, nombre y la fila Stock · Venta · Costo (sin «Prdto:» ni «Cantidad:»)', () => {
  const { window } = cargarStock();
  const d = tarjeta(window, { code: 'A-501', name: 'SOPORTE LAPTOP 1.20M', desc: 'Base plegable', stock: 5, price: 80, tipo: 'importado', cost: 45.76 });
  assert.equal(d.querySelector('.pc-code').textContent, 'A-501');
  assert.equal(d.querySelector('.pc-name').textContent, 'SOPORTE LAPTOP 1.20M');
  assert.equal(d.querySelector('.pc-desc').textContent, 'Base plegable');
  const etiquetas = [...d.querySelectorAll('.pc-lbl')].map(e => e.textContent);
  assert.deepEqual(etiquetas.slice(0, 2), ['Stock', 'Venta']);
  assert.ok(!/Prdto:|Cantidad:/.test(d.textContent));
  assert.ok(d.querySelector('.pc-qty').classList.contains('stock-low'), 'se conserva la clase stock-low');
});

test('Stock: el estado de la tarjeta distingue Disponible, Stock bajo (≤ 6) y Sin stock', () => {
  const { window } = cargarStock();
  const estado = n => { const e = tarjeta(window, { code: 'X', name: 'X', stock: n, price: 1 }).querySelector('.pc-estado'); return [e.className.replace('pc-estado ', ''), e.textContent]; };
  assert.deepEqual(estado(24), ['ok', 'Disponible']);
  assert.deepEqual(estado(6), ['low', 'Stock bajo']);
  assert.deepEqual(estado(0), ['out', 'Sin stock']);
});

test('Stock: el menú ⋯ abre y cierra, y tiene Editar (y Eliminar cuando el rol ve costos)', () => {
  const { window } = cargarStock();
  const d = tarjeta(window, { code: 'A-501', name: 'SOPORTE', stock: 5, price: 80 });
  window.document.body.appendChild(d);
  const btn = d.querySelector('.pc-mas'), menu = d.querySelector('.pc-menu');
  assert.equal(menu.hidden, true);
  assert.ok(btn.classList.contains('btn-icon-edit'), 'conserva btn-icon-edit para que los roles de solo lectura no lo vean');
  btn.click();
  assert.equal(menu.hidden, false); assert.equal(btn.getAttribute('aria-expanded'), 'true');
  assert.ok([...menu.querySelectorAll('button')].some(b => b.textContent === 'Editar'));
  window.document.body.click();                                                      // tocar fuera lo cierra
  assert.equal(menu.hidden, true); assert.equal(btn.getAttribute('aria-expanded'), 'false');
});

test('Barra inferior: Stock usa el ícono de caja (package) y no la lupa', () => {
  const js = leer('nav-movil.js');
  assert.match(js, /id: 'tab_2', icon: 'package', label: 'Stock'/);
  assert.match(js, /"package":/);
});

test('Stock (CSS): resumen con tarjeta oscura, almacenes segmentados y buscador + filtro en la misma fila', () => {
  const css = leer('stock-card.css');
  assert.match(css, /\.stock-stats \.stat-card:nth-child\(3\) \{[^}]*background: #12201C/);
  assert.match(css, /\.warehouse-tab\.active \{ background: #fff;/);
  assert.match(css, /\.search-wrap \{ flex: 1 1 calc\(100% - 60px\)/);
});

test('Editor de foto: nueva estructura (esquinas, giro sobre la foto, pestañas de formato, escalas) con los mismos controles', async () => {
  const { window } = loadApp(['firebase.js', 'cloudinary-config.js', 'cloudinary.js', 'balance-logic.js', 'qrcode-generator.js', 'catalogo-logic.js']);
  const d = window.document;
  const ctx = new Proxy({}, { get: (t, k) => (k === 'filter' ? 'none' : () => {}), set: () => true, has: (t, k) => k === 'filter' });
  window.HTMLCanvasElement.prototype.getContext = () => ctx;
  window.HTMLCanvasElement.prototype.toBlob = function (cb) { cb({ w: this.width, h: this.height }); };
  window.HTMLCanvasElement.prototype.setPointerCapture = () => {};
  window.URL.createObjectURL = () => 'blob:x'; window.URL.revokeObjectURL = () => {};
  window.Image = class { set src(v) { this.naturalWidth = 3000; this.naturalHeight = 2000; setTimeout(() => this.onload && this.onload(), 0); } };
  const tick = () => new Promise(r => setTimeout(r, 10));
  const p = window.abrirEditorFoto({ type: 'image/jpeg', size: 1000 }); await tick();

  assert.ok(d.querySelector('.foto-ed-ov.foto-ed-ov-ed .foto-ed-v2'), 'se abre como hoja inferior en teléfono');
  assert.equal(d.querySelectorAll('.foto-ed-frame .fe-c').length, 4, 'cuatro esquinas del encuadre');
  assert.ok(d.querySelector('.foto-ed-frame .fe-grid'));
  assert.equal(d.querySelectorAll('.foto-ed-rot [data-rot]').length, 2, 'giro a izquierda y derecha sobre la foto');
  assert.deepEqual([...d.querySelectorAll('.foto-ed-a')].map(b => b.textContent), ['Cuadrada', 'Vertical', 'Horizontal', 'Original']);
  assert.ok(d.querySelector('.foto-ed-a.on[data-asp="1:1"]'));
  d.querySelector('[data-asp="4:5"]').click();
  assert.ok(d.querySelector('.foto-ed-a.on[data-asp="4:5"]') && !d.querySelector('.foto-ed-a.on[data-asp="1:1"]'));

  const zoom = d.querySelector('.foto-ed-zoom');
  zoom.value = '2.5'; zoom.dispatchEvent(new window.Event('input'));
  assert.equal(zoom.style.getPropertyValue('--v'), '50%', 'la escala se rellena hasta el selector');
  d.querySelector('[data-z="+"]').click();
  assert.ok(Math.abs(parseFloat(d.querySelector('.foto-ed-zoom').style.getPropertyValue('--v')) - 58.33) < 0.01);   // +0.25 de zoom → 2.75 de 4
  d.querySelector('[data-x="ok"]').click();
  const blob = await p;
  assert.ok(blob && blob.w > 0);
  assert.equal(d.querySelector('.foto-ed-ov'), null);
});

test('Editor de foto (CSS): hoja inferior en teléfono, marco con esquinas y escala con marcas', () => {
  const css = leer('balance.css');
  assert.match(css, /\.foto-ed-ov-ed \{ align-items: flex-end;/);
  assert.match(css, /\.fe-c \{ position: absolute;/);
  assert.match(css, /\.foto-ed-v2 svg \{ pointer-events: none; \}/);          // tocar el ícono cuenta como tocar el botón
  assert.match(css, /repeating-linear-gradient\(to right, #C9C1A8 0 1px/);
});