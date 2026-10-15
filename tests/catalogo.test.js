// tests/catalogo.test.js — catálogo público (espejo sin datos sensibles) y Cloudinary.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadApp } = require('./helpers/load-app');

function setup(productos, cfg) {
  const { window, firebase } = loadApp(['firebase.js', 'cloudinary-config.js', 'cloudinary.js', 'balance-logic.js', 'qrcode-generator.js', 'catalogo-logic.js']);
  firebase._store.products = productos;
  if (cfg) firebase._store.catalogoPublico = cfg;
  return { window, firebase, pub: () => (firebase._store.catalogoPublico || {}).productos || {} };
}
const P = () => ({
  G1: { name: 'Guitarra Clevan', category: 'Cuerdas', stock: 7, price: 500, tipo: 'importado', stockMin: 3, image: 'https://res.cloudinary.com/x/g1.jpg', updatedAt: 111 },
  T1: { name: 'Teclado', category: 'general', stock: 0, price: 900, tipo: 'importado' },
  H1: { name: 'Oculto', stock: 5, publicar: false },
  D1: { name: 'Borrado', stock: 5, deleted: true },
});

test('espejo público: solo nombre, categoría, foto y disponible (nunca precio, stock, tipo ni costos)', () => {
  const { window } = setup(P());
  const g = JSON.parse(JSON.stringify(window.productoPublico(P().G1)));
  assert.deepEqual(Object.keys(g).sort(), ['actualizadoEn', 'categoria', 'disponible', 'imagen', 'nombre']);
  assert.equal(g.disponible, true);
  assert.equal(window.productoPublico(P().T1).disponible, false);
  assert.equal(window.productoPublico(P().T1).categoria, '');   // "general" no se muestra
  assert.equal(window.productoPublico({ name: 'X', image: 'javascript:alert(1)' }).imagen, '');   // solo fotos https
});

test('sincronizar: con el catálogo inactivo no escribe nada', async () => {
  const { window, pub } = setup(P(), { activo: false });
  assert.equal((await window.sincronizarCatalogoPublico()).omitido, true);
  assert.deepEqual(Object.keys(pub()), []);
});

test('sincronizar: publica los visibles, omite ocultos y borrados, es idempotente y sigue el stock', async () => {
  const { window, firebase, pub } = setup(P(), { activo: true, nombre: 'Mi Empresa' });
  assert.equal((await window.sincronizarCatalogoPublico()).escritos, 2);
  assert.deepEqual(Object.keys(pub()).sort(), ['G1', 'T1']);
  assert.equal((await window.sincronizarCatalogoPublico()).escritos, 0);   // sin cambios, sin escrituras
  firebase._store.products.T1.stock = 4; firebase._store.products.G1.publicar = false;
  assert.equal((await window.sincronizarCatalogoPublico()).escritos, 2);
  assert.deepEqual(Object.keys(pub()), ['T1']);
  assert.equal(pub().T1.disponible, true);
  const texto = JSON.stringify(firebase._store.catalogoPublico);
  for (const prohibido of ['price', 'stock', 'tipo', 'costo', '900', '500']) assert.ok(!texto.includes('"' + prohibido + '"'), 'filtró ' + prohibido);
});

test('guardar configuración: valida WhatsApp, https y nombre; al activar sincroniza', async () => {
  const { window, firebase, pub } = setup(P());
  await assert.rejects(window.guardarConfigCatalogo({ activo: true, nombre: 'E', whatsapp: '123', urlBase: '' }), /WhatsApp/);
  await assert.rejects(window.guardarConfigCatalogo({ activo: true, nombre: 'E', whatsapp: '', urlBase: 'http://x.com' }), /https/);
  await assert.rejects(window.guardarConfigCatalogo({ activo: true, nombre: ' ', whatsapp: '', urlBase: '' }), /nombre/);
  const r = await window.guardarConfigCatalogo({ activo: true, nombre: 'Mi Empresa', whatsapp: '+51 987 654 321', urlBase: 'https://miempresa.com/app/' });
  assert.equal(firebase._store.catalogoPublico.whatsapp, '51987654321');
  assert.equal(firebase._store.catalogoPublico.urlBase, 'https://miempresa.com/app');
  assert.equal(r.escritos, 2);
  assert.equal(window.linkCatalogo('https://miempresa.com/app', 'G 1'), 'https://miempresa.com/app/catalogo-publico.html?producto=G%201');
});

test('Cloudinary: sin configurar mientras tenga los valores de ejemplo', () => {
  const { window } = setup({});
  window.CLOUDINARY_CONFIG = { cloudName: 'TU_CLOUD_NAME', uploadPreset: 'TU_UPLOAD_PRESET' };
  assert.equal(window.cloudinaryConfigured(), false);
  window.CLOUDINARY_CONFIG = { cloudName: 'mi-cuenta', uploadPreset: 'mi-preset' };
  assert.equal(window.cloudinaryConfigured(), true);
});

test('reglas: el catálogo solo se lee si está activo y solo admite campos públicos', () => {
  const r = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'firebase-database.rules.json'), 'utf8')).rules.catalogoPublico;
  assert.match(r['.read'], /child\('activo'\)\.val\(\) === true/);
  assert.match(r['.write'], /'admin'/);
  const campos = Object.keys(r.productos.$code).filter(k => !k.startsWith('.') && k !== '$other').sort();
  assert.deepEqual(campos, ['actualizadoEn', 'categoria', 'disponible', 'imagen', 'nombre']);
  assert.equal(r.productos.$code.$other['.validate'], false);
});

test('la página pública y el código no arrastran llaves ni nombres de VAERON', () => {
  const dir = path.join(__dirname, '..', 'www');
  for (const f of ['catalogo-publico.html', 'catalogo-logic.js', 'cloudinary.js', 'cloudinary-config.js']) {
    const t = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.ok(!/vaeron|AIza[0-9A-Za-z_-]{20,}|tiendas\/|paramTienda/i.test(t), f);
  }
  // firebase-config.js SÍ lleva la llave web de BALANCE-INV (no es secreta), pero nunca la de otro proyecto.
  const cfg = fs.readFileSync(path.join(dir, 'firebase-config.js'), 'utf8');
  assert.ok(/projectId: "balance-inv-b114a"/.test(cfg) && !/vaeron/i.test(cfg));
});

test('QR: la imagen generada se decodifica y devuelve exactamente el link del catálogo', () => {
  const jsQR = require('jsqr');
  const { window } = setup({});
  for (const link of ['https://miempresa.com/app/catalogo-publico.html', 'https://miempresa.com/app/catalogo-publico.html?producto=G%201']) {
    const m = window.matrizQr(link), margen = 4, celda = 6, n = m.length + margen * 2, px = n * celda;
    const datos = new Uint8ClampedArray(px * px * 4).fill(255);
    m.forEach((fila, r) => fila.forEach((oscuro, k) => {
      if (!oscuro) return;
      for (let y = 0; y < celda; y++) for (let x = 0; x < celda; x++) { const i = (((r + margen) * celda + y) * px + (k + margen) * celda + x) * 4; datos[i] = datos[i + 1] = datos[i + 2] = 0; }
    }));
    const leido = jsQR(datos, px, px);
    assert.ok(leido, 'no se pudo leer el QR');
    assert.equal(leido.data, link);
  }
});

test('Configuración: copiar link y modal con QR (con catálogo activo)', async () => {
  const { window } = setup({}, { activo: true, nombre: 'Mi Empresa', urlBase: 'https://miempresa.com/app' });
  const avisos = []; let copiado = null;
  window.alert = m => avisos.push(m);
  Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: async t => { copiado = t; } }, configurable: true });
  await window.copiarLinkCatalogo();
  assert.equal(copiado, 'https://miempresa.com/app/catalogo-publico.html');
  assert.deepEqual([...avisos], ['Link copiado.']);
  await window.abrirModalQrCatalogo();
  const d = window.document, modal = d.getElementById('qrModal');
  assert.ok(modal.classList.contains('open'));
  assert.equal(d.getElementById('qrModalMsg').textContent, 'https://miempresa.com/app/catalogo-publico.html');
  assert.equal(d.getElementById('qrModalSub').textContent, 'Mi Empresa');
  d.getElementById('qrModalX').click();
  assert.ok(!modal.classList.contains('open'));
});

test('Configuración: sin catálogo activo explica qué falta en vez de mostrar un QR vacío', async () => {
  const { window } = setup({}, { activo: false });
  const avisos = []; window.alert = m => avisos.push(m);
  await window.copiarLinkCatalogo();
  assert.match(avisos[0], /inactivo/);
  await window.abrirModalQrCatalogo();
  const d = window.document;
  assert.match(d.getElementById('qrModalMsg').textContent, /inactivo/);
  assert.equal(d.getElementById('qrModalBox').style.display, 'none');
  assert.equal(d.getElementById('qrModalBajar').style.display, 'none');
});

test('link automático desde GitHub Pages: la dirección de la página se guarda sola y el APK la reutiliza', async () => {
  const gh = 'https://yair.github.io/balance-inv';
  const a = setup({}, { activo: true, nombre: 'Mi Empresa' });
  a.window._origenPagina = () => gh;                    // el admin abre la app desde GitHub Pages
  assert.equal(await a.window.recordarDireccionPublica(), true);
  assert.equal(a.firebase._store.catalogoPublico.urlBase, gh);
  assert.equal(await a.window.recordarDireccionPublica(), false, 'no vuelve a escribir');
  a.window._origenPagina = () => '';                    // ahora el APK: localhost
  assert.equal((await a.window.datosCatalogo()).link, gh + '/catalogo-publico.html');
  assert.equal(a.window.linkCatalogo(gh, 'G 1'), gh + '/catalogo-publico.html?producto=G%201');
});

test('link: sin dirección guardada ni página pública no hay link y explica qué hacer; Firebase ya no se usa', async () => {
  const { window } = setup({}, { activo: true, nombre: 'Mi Empresa' });
  window._origenPagina = () => '';
  window.FIREBASE_CONFIG = { projectId: 'adonay-music' };
  const d = await window.datosCatalogo();
  assert.equal(d.link, ''); assert.match(d.motivo, /página publicada/);
  assert.equal(window.linkCatalogo('https://www.miempresa.com/'), 'https://www.miempresa.com/catalogo-publico.html');
});

test('guardar con la dirección vacía NO borra la guardada', async () => {
  const { window, firebase } = setup({}, { activo: false, urlBase: 'https://yair.github.io/balance-inv' });
  window._origenPagina = () => '';
  await window.guardarConfigCatalogo({ activo: true, nombre: 'Mi Empresa', whatsapp: '', urlBase: '' });
  assert.equal(firebase._store.catalogoPublico.urlBase, 'https://yair.github.io/balance-inv');
});

// ── Copia estática (catalogo.json): los clientes no consultan Firebase ──
test('copia estática: deja solo campos públicos y vacía todo si el catálogo está desactivado', () => {
  const { copiaEstatica } = require('../www/catalogo-copia.js');
  const nodo = { activo: true, nombre: 'Mi Empresa', whatsapp: '+51 987 654 321', urlBase: 'https://x', productos: {
    G1: { nombre: 'Guitarra', categoria: 'Cuerdas', imagen: 'https://res.cloudinary.com/x.jpg', disponible: true, actualizadoEn: 5, precio: 500, stock: 7, tipo: 'importado' },
    X1: { nombre: '  ' }, M1: { nombre: 'Malo', imagen: 'javascript:alert(1)', disponible: false } } };
  const c = copiaEstatica(nodo);
  assert.equal(c.whatsapp, '51987654321'); assert.deepEqual(Object.keys(c.productos), ['G1', 'M1']);
  assert.deepEqual(Object.keys(c.productos.G1).sort(), ['actualizadoEn', 'categoria', 'disponible', 'imagen', 'nombre']);
  assert.equal(c.productos.M1.imagen, ''); assert.equal(c.productos.M1.disponible, false);
  assert.ok(!JSON.stringify(c).match(/precio|stock|tipo|urlBase|costo/));
  const off = copiaEstatica({ activo: false, nombre: 'N', whatsapp: '51', productos: { G1: { nombre: 'G' } } });
  assert.deepEqual([off.activo, off.nombre, off.whatsapp, Object.keys(off.productos).length], [false, '', '', 0]);
});

test('página pública: se pinta desde catalogo.json y NO descarga ni usa Firebase', async () => {
  const fs = require('fs'), path = require('path'), { JSDOM } = require('jsdom');
  const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'catalogo-publico.html'), 'utf8');
  assert.ok(!/firebase-app-compat\.js"><\/script>/.test(html), 'el SDK ya no se carga de entrada');
  const pedidos = [];
  const dom = new JSDOM(html, { url: 'https://yair.github.io/balance-inv/catalogo-publico.html', runScripts: 'dangerously', pretendToBeVisual: true, beforeParse(w) {
    w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
    w.fetch = async u => { pedidos.push(String(u)); return { ok: true, json: async () => ({ activo: true, nombre: 'Mi Empresa', whatsapp: '51987654321', productos: { G1: { nombre: 'Guitarra Clevan', categoria: 'Cuerdas', imagen: '', disponible: true } } }) }; };
  } });
  await new Promise(r => setTimeout(r, 100));
  assert.match(pedidos[0], /^catalogo\.json\?v=\d+/);
  assert.equal(pedidos.length, 1);
  assert.match(dom.window.document.getElementById('cpContenido').textContent, /Guitarra Clevan/);
  assert.equal(dom.window.document.getElementById('cpNombre').textContent, 'Mi Empresa');
  assert.equal(dom.window.firebase, undefined);
});

test('página pública: catálogo desactivado en la copia muestra "no disponible" sin ir a Firebase', async () => {
  const fs = require('fs'), path = require('path'), { JSDOM } = require('jsdom');
  const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'catalogo-publico.html'), 'utf8');
  const dom = new JSDOM(html, { url: 'https://yair.github.io/balance-inv/catalogo-publico.html', runScripts: 'dangerously', pretendToBeVisual: true, beforeParse(w) {
    w.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
    w.fetch = async () => ({ ok: true, json: async () => ({ activo: false, productos: {} }) });
  } });
  await new Promise(r => setTimeout(r, 100));
  assert.match(dom.window.document.getElementById('cpContenido').textContent, /no está disponible/);
  assert.equal(dom.window.firebase, undefined);
});
