// Navegación responsive: barra inferior de 5 pestañas, botón flotante (+) con menú, «Más secciones» y campana de avisos.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { loadApp } = require('./helpers/load-app');
const WWW = path.join(__dirname, '..', 'www');
const plain = o => JSON.parse(JSON.stringify(o));

const HTML = `<body><aside class="sidebar"><nav class="sidebar-nav">
  <a class="nav-item" data-page="stock"><svg id="svgStock"></svg></a><a class="nav-item" data-page="pedidos"><svg id="svgPed"></svg></a>
  <a class="nav-item nav-admin-only" data-page="registros"><svg></svg></a></nav>
  <button id="logoutBtn"></button><button id="switchAccountBtn"></button></aside>
  <main class="main"><div class="topbar"><div class="topbar-title"><h1>Stock</h1></div></div><input id="searchInput"></main></body>`;

const abiertas = [];
test.after(() => abiertas.forEach(w => { w.NavMovil.detener(); w.close(); }));   // la barra revisa los avisos cada pocos segundos: se cierra cada ventana para que el proceso termine
function app(extra = '') {
  const a = loadApp(['nav-movil.js'], HTML.replace('<body>', '<body ' + extra + '>'));
  const w = a.window; abiertas.push(w);
  const calls = []; w.Router = { go: p => calls.push(p), currentPage: 'stock' };
  w.localStorage.clear(); w.NavMovil.init();   // jsdom aún no disparó DOMContentLoaded: se inicia a mano (init es idempotente)
  return { ...a, w, calls, d: w.document, NM: w.NavMovil, click: el => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true, cancelable: true })) };
}

test('barra inferior: 5 pestañas con su ruta, la activa marcada y un toque navega', () => {
  const { d, NM, calls, click } = app();
  const tabs = [...d.querySelectorAll('.nm-tabbar .nm-tab')];
  assert.deepEqual(tabs.map(t => [t.dataset.page, t.textContent.trim()]), [['dashboard', 'Inicio'], ['stock', 'Stock'], ['historial', 'Historial'], ['soporte', 'Soporte'], ['perfil', 'Perfil']]);
  assert.ok(tabs.every(t => t.querySelector('svg.nm-ico path')), 'cada pestaña lleva su ícono');
  assert.equal(d.querySelector('.nm-tabbar').getAttribute('aria-label'), 'Navegación principal');
  NM.actualizarEstado();
  assert.deepEqual(tabs.map(t => t.classList.contains('activa')), [false, true, false, false, false]);
  assert.equal(tabs[1].getAttribute('aria-current'), 'page'); assert.equal(tabs[0].getAttribute('aria-current'), null);
  click(tabs[0]); assert.deepEqual(calls, ['dashboard']);
});

test('botón (+): se abre y cierra, pasa a (X), cierra al tocar fuera, con Escape o al elegir una acción', () => {
  const { w, d, NM, calls, click } = app();
  const fab = d.querySelector('.nm-fab'), btn = fab.querySelector('.nm-fab-btn'), fondo = d.querySelector('.nm-fab-fondo');
  const abierto = () => [fab.dataset.abierto, btn.getAttribute('aria-expanded'), fondo.hidden];
  assert.deepEqual(plain(abierto()), ['false', 'false', true]);
  assert.equal(fab.querySelectorAll('.nm-fab-item').length, 4);
  assert.ok(btn.querySelector('.nm-fab-mas svg') && btn.querySelector('.nm-fab-x svg'), 'ícono (+) y ícono (X)');
  assert.ok([...fab.querySelectorAll('.nm-fab-item')].every(b => b.getAttribute('aria-label') && b.getAttribute('title')), 'sin texto visible pero accesibles');
  click(btn); assert.deepEqual(plain(abierto()), ['true', 'true', false]);
  click(btn); assert.deepEqual(plain(abierto()), ['false', 'false', true]);               // (X) vuelve a cerrar
  click(btn); click(fondo); assert.deepEqual(plain(abierto()), ['false', 'false', true]);  // tocar fuera
  click(btn); d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); assert.equal(fab.dataset.abierto, 'false');
  click(btn); click(fab.querySelector('[data-id="action_1"]'));                           // elegir una acción: navega y cierra
  assert.deepEqual(calls, ['nueva-nota']); assert.equal(fab.dataset.abierto, 'false');
  click(btn); click(fab.querySelector('[data-id="action_2"]')); click(btn); click(fab.querySelector('[data-id="action_3"]'));
  assert.deepEqual(calls, ['nueva-nota', 'catalogo', 'compras']);
});

test('«Más secciones»: lista lo que no cabe en la barra, oculta lo de administrador a vendedores y ejecuta cuenta/sesión', () => {
  const { d, calls, click } = app();
  const abrir = () => { click(d.querySelector('.nm-fab-btn')); click(d.querySelector('[data-id="action_4"]')); };
  abrir();
  const hoja = d.querySelector('.nm-hoja'), items = () => [...hoja.querySelectorAll('.nm-hoja-item')].map(b => b.textContent.trim());
  assert.equal(hoja.hidden, false);
  assert.deepEqual(items(), ['Agregar producto', 'Notas de Pedido', 'Balance y alertas', 'Registros', 'Configuración', 'Cambiar de cuenta', 'Cerrar sesión']);
  assert.ok(hoja.querySelector('.nm-hoja-item:nth-child(2) svg.nm-ico'), 'toma el ícono del menú lateral');
  click([...hoja.querySelectorAll('.nm-hoja-item')].find(b => /Notas de Pedido/.test(b.textContent)));
  assert.deepEqual(calls, ['pedidos']); assert.equal(hoja.hidden, true);
  let sesion = 0; d.getElementById('logoutBtn').addEventListener('click', () => sesion++);
  abrir(); click([...hoja.querySelectorAll('.nm-hoja-item')].find(b => /Cerrar sesión/.test(b.textContent)));
  assert.equal(sesion, 1);
  // vendedor: sin «Registros»
  const v = app('class="role-vendedor"');
  v.click(v.d.querySelector('.nm-fab-btn')); v.click(v.d.querySelector('[data-id="action_4"]'));
  assert.ok(![...v.d.querySelectorAll('.nm-hoja-item')].some(b => /Registros/.test(b.textContent)));
});

test('avisos: sin stock, stock bajo y subida de costo; el número de la campana baja al marcar como leído (y se recuerda)', () => {
  const { w, d, NM, calls, click } = app();
  w.alzaCosto = (a, b) => (a > 0 && b > a * 1.01 ? { antes: a, ahora: b, pct: Math.round((b / a - 1) * 100) } : null);
  const prods = [
    { code: 'A1', name: 'CAJON', stock: 0 }, { code: 'A2', name: 'PEDAL', stock: 3 }, { code: 'A3', name: 'UKULELE', stock: 40 },
    { code: 'A4', name: 'CAMPANA', stock: 20, costoAnterior: 100, costoUltimo: 120 }, { code: 'A5', name: 'FUNDA', stock: 4, stockMin: 3 }, { code: 'A6', name: 'BORRADO', stock: 0, deleted: true }];
  const av = plain(NM.calcularNotificaciones(prods));
  assert.deepEqual(av.map(n => [n.tipo, n.code]), [['sin-stock', 'A1'], ['alza', 'A4'], ['bajo', 'A2']]);     // A5 (4 > mínimo 3) y A3 no avisan; el borrado tampoco
  assert.equal(av[1].detalle, 'S/ 100.00 → S/ 120.00 (+20%)');
  NM.fuente = () => prods; NM.actualizarCampana();
  const bell = d.querySelector('.main .topbar .nm-bell'), badge = bell.querySelector('.nm-badge');
  assert.ok(bell, 'la campana va en el encabezado'); assert.equal(badge.hidden, false); assert.equal(badge.textContent, '3');
  assert.match(bell.getAttribute('aria-label'), /3 sin leer/);
  click(bell);                                                                          // abre el panel
  const panel = d.querySelector('.nm-panel'); assert.equal(panel.hidden, false);
  assert.equal(panel.querySelectorAll('.nm-aviso').length, 3);
  click(panel.querySelector('.nm-aviso[data-code="A1"]'));                                 // tocar un aviso: lo marca leído y abre Stock con ese código
  assert.equal(badge.textContent, '2'); assert.equal(calls.at(-1), 'stock'); assert.equal(panel.hidden, true);
  click(bell); click(panel.querySelector('[data-todo]'));                                  // marcar todo
  assert.equal(badge.hidden, true); assert.match(bell.getAttribute('aria-label'), /nada nuevo/);
  assert.equal(JSON.parse(w.localStorage.getItem('balanceinv_notif_leidas')).length, 3);   // queda guardado en el dispositivo
  prods[1].stock = 2; NM.actualizarCampana();                                              // el stock cambió: es un aviso nuevo
  assert.equal(badge.textContent, '1');
});

test('estado: el (+) se oculta con ventanas abiertas y en la pantalla de nueva nota', () => {
  const { w, d, NM } = app();
  NM.actualizarEstado(); assert.ok(!d.body.classList.contains('nm-modal') && !d.body.classList.contains('nm-sin-fab'));
  const m = d.createElement('div'); m.className = 'modal-overlay open'; d.body.appendChild(m); NM.actualizarEstado();
  assert.ok(d.body.classList.contains('nm-modal')); m.remove(); NM.actualizarEstado(); assert.ok(!d.body.classList.contains('nm-modal'));
  w.Router.currentPage = 'nueva-nota'; NM.actualizarEstado(); assert.ok(d.body.classList.contains('nm-sin-fab'));
});

test('CSS e index: la barra reemplaza al menú lateral hasta 1280 px, el (+) va sobre la barra, zonas seguras y movimiento reducido', () => {
  const css = fs.readFileSync(path.join(WWW, 'responsive.css'), 'utf8').replace(/\r/g, '');
  const bloque = css.slice(css.indexOf('Navegación responsive (nav-movil.js)'));
  assert.match(bloque, /@media \(max-width: 1280px\) \{[^@]*body aside\.sidebar \{ display: none !important; \}/);
  assert.match(bloque, /\.nm-tabbar \{\s*position: fixed;[^}]*bottom: 0;[^}]*display: flex;[^}]*justify-content: space-around;/);
  assert.match(bloque, /\.nm-fab \{ bottom: calc\(var\(--nm-tab-h\) \+ 16px \+ env\(safe-area-inset-bottom/);        // encima de la barra
  assert.match(bloque, /\.nm-fab \{\s*position: fixed;[^}]*right: calc\(20px \+ env\(safe-area-inset-right[^}]*z-index: 1001;/);
  assert.match(bloque, /\.nm-fab-menu \{ display: flex; flex-direction: column; align-items: flex-end; gap: 16px;/);   // menú vertical a la derecha, separación 16
  assert.match(bloque, /\.nm-fab-item \{[^}]*width: 48px; height: 48px;/);                                           // áreas táctiles ≥ 44 px
  assert.match(bloque, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(bloque, /body\.keyboard-open \.nm-tabbar/);
  const html = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');
  assert.ok(html.indexOf('nav-movil.js') > html.indexOf('nav.js"'), 'se carga después de nav.js');
});
