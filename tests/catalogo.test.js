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
  assert.deepEqual(campos, ['actualizadoEn', 'categoria', 'descripcion', 'disponible', 'imagen', 'imagenes', 'nombre']);
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

test('catálogo: la descripción del producto es pública (máx. 300 caracteres) y los precios y costos siguen fuera', () => {
  const { window } = setup({});
  const o = JSON.parse(JSON.stringify(window.productoPublico({ name: 'CAJON', desc: 'CAJON MIXTO ENLADRILLADO ATEMPO', stock: 2, price: 400, costoCompra: 280 })));
  assert.equal(o.descripcion, 'CAJON MIXTO ENLADRILLADO ATEMPO');
  assert.ok(!('price' in o) && !('costoCompra' in o) && !JSON.stringify(o).includes('280'));
  assert.equal(window.productoPublico({ name: 'X', desc: 'a'.repeat(500) }).descripcion.length, 300);
  assert.equal('descripcion' in window.productoPublico({ name: 'X' }), false);   // sin descripción no se escribe el campo
});

// ---------- Fotos: varias por producto, editor y carrusel público ----------
test('fotos: la principal más las demás (máx. 6, solo https, sin repetir) y el espejo público las lleva solo si hay más de una', () => {
  const { window } = setup({});
  const A = 'https://res.cloudinary.com/x/a.jpg', B = 'https://res.cloudinary.com/x/b.jpg';
  assert.deepEqual(JSON.parse(JSON.stringify(window.fotosDe({ image: A }))), [A]);                              // producto viejo: una sola foto
  assert.deepEqual(JSON.parse(JSON.stringify(window.fotosDe({ image: A, images: [B, A, 'javascript:x'] }))), [A, B]);
  assert.equal(window.fotosDe({ images: Array.from({ length: 9 }, (_, i) => `https://x.com/${i}.jpg`) }).length, 6);
  assert.equal('imagenes' in window.productoPublico({ name: 'X', image: A }), false);                          // una foto: solo `imagen`
  const g = JSON.parse(JSON.stringify(window.productoPublico({ name: 'X', images: [A, B] })));
  assert.deepEqual([g.imagen, g.imagenes], [A, [A, B]]);
});

test('fotos: guardar la lista actualiza la principal y borrar la última las quita', async () => {
  const { window, firebase } = setup({ G1: { name: 'G', stock: 1 } });
  const A = 'https://res.cloudinary.com/x/a.jpg', B = 'https://res.cloudinary.com/x/b.jpg';
  assert.deepEqual(JSON.parse(JSON.stringify(await window.guardarFotos('G1', [A, B, 'javascript:1']))), [A, B]);
  assert.deepEqual([firebase._store.products.G1.image, JSON.parse(JSON.stringify(firebase._store.products.G1.images))], [A, [A, B]]);
  await window.guardarFotos('G1', [B]);                         // la principal pasa a ser B
  assert.equal(firebase._store.products.G1.image, B);
  await window.guardarFotos('G1', []);
  assert.deepEqual([firebase._store.products.G1.image, firebase._store.products.G1.images], [undefined, undefined]);
});

test('editor de foto: el recorte llena siempre el marco y la foto no se puede arrastrar fuera', () => {
  const { window } = setup({});
  assert.equal(window.escalaCubrir(2000, 1000, 400, 400), 0.4);                      // foto horizontal en marco cuadrado: manda la altura
  assert.equal(window.escalaCubrir(1000, 2000, 400, 400), 0.4);
  const s = window.escalaCubrir(2000, 1000, 400, 400) * 2;                          // zoom 2×
  const l = JSON.parse(JSON.stringify(window.limitarDesplazamiento(2000, 1000, s, 400, 400, 9999, -9999)));
  assert.deepEqual(l, { ox: (2000 * s - 400) / 2, oy: -(1000 * s - 400) / 2 });     // tope en cada lado
  assert.deepEqual(JSON.parse(JSON.stringify(window.limitarDesplazamiento(2000, 1000, 0.4, 400, 400, 50, 50))), { ox: 50, oy: 0 });   // sin zoom no hay margen vertical
  assert.deepEqual(JSON.parse(JSON.stringify(window.marcoFoto(1, 520, 300))), { vw: 300, vh: 300 });
  assert.deepEqual(JSON.parse(JSON.stringify(window.marcoFoto(4 / 3, 520, 520))), { vw: 520, vh: 390 });
});

test('página pública: la foto única va sola; con varias hay carrusel con puntos, la descripción se ve y el visor pasa de una a otra', async () => {
  const { JSDOM } = require('jsdom');
  const html = fs.readFileSync(path.join(__dirname, '..', 'www', 'catalogo-publico.html'), 'utf8').replace(/<script[^>]*src[^>]*><\/script>/g, '');
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://x.github.io/app/catalogo-publico.html', pretendToBeVisual: true, beforeParse(w) {
    w.firebase = { initializeApp() {}, database() { return { ref() { return { on() {}, once() { return Promise.resolve({ val() { return null; }, exists() { return false; } }); }, off() {} }; } }; } };
  } });
  await new Promise(r => setTimeout(r, 300));
  const w = dom.window, A = 'https://res.cloudinary.com/x/upload/a.jpg', B = 'https://res.cloudinary.com/x/upload/b.jpg';
  const h = w.itemHtmlPublico({ code: 'A1', nombre: 'ATEMPO', descripcion: 'CAJON MIXTO ENLADRILLADO', categoria: 'x', imagen: A, imagenes: [A, B, 'javascript:alert(1)'], disponible: true }, '51999');
  assert.ok(/cp-car-track/.test(h) && (h.match(/cp-car-slide/g) || []).length === 2 && /cp-dots/.test(h) && /CAJON MIXTO ENLADRILLADO/.test(h) && !/javascript:/.test(h));
  assert.ok(!/cp-car-track/.test(w.itemHtmlPublico({ code: 'A2', nombre: 'X', categoria: 'x', imagen: A, disponible: true }, '51999')));
  w.eval("cpProductos = [{ code: 'A1', nombre: 'ATEMPO', imagen: '" + A + "', imagenes: ['" + A + "', '" + B + "'] }]");
  w.abrirLightboxProducto('A1', 0);
  const img = () => w.document.getElementById('cpLightboxImg').getAttribute('src'), cont = () => w.document.getElementById('cpLbCount').textContent;
  assert.deepEqual([img(), cont()], [A, '1 / 2']);
  w.lbMover(1); assert.deepEqual([img(), cont()], [B, '2 / 2']);
  w.lbMover(1); assert.equal(img(), A);                                              // da la vuelta
  assert.ok(w.document.getElementById('cpLightbox').classList.contains('galeria'));
});

test('editor de foto (con lienzo simulado): mueve, hace zoom, gira, cambia de proporción; cancelar no devuelve nada y aceptar entrega una imagen del tamaño del marco', async () => {
  const { window } = setup({});
  const d = window.document, llamadas = [];
  const ctx = new Proxy({}, { get: (t, k) => (k === 'filter' ? 'none' : (...a) => { llamadas.push([k, a]); }), set: () => true, has: (t, k) => k === 'filter' });
  window.HTMLCanvasElement.prototype.getContext = () => ctx;
  window.HTMLCanvasElement.prototype.toBlob = function (cb, tipo, cal) { cb({ tipo, cal, w: this.width, h: this.height }); };
  window.HTMLCanvasElement.prototype.setPointerCapture = () => {};
  window.URL.createObjectURL = () => 'blob:x'; window.URL.revokeObjectURL = () => {};
  window.Image = class { set src(v) { this.naturalWidth = 3000; this.naturalHeight = 2000; setTimeout(() => this.onload && this.onload(), 0); } };
  const foto = { type: 'image/jpeg', size: 1000 };
  const tick = () => new Promise(r => setTimeout(r, 10));
  const pulsa = sel => d.querySelector(sel).click();

  // cancelar: no devuelve nada
  let p = window.abrirEditorFoto(foto); await tick();
  assert.ok(d.querySelector('.foto-ed-canvas'), 'se abre el editor');
  pulsa('[data-x="cancel"]'); assert.equal(await p, null); assert.equal(d.querySelector('.foto-ed-ov'), null);

  // editar y aceptar
  p = window.abrirEditorFoto(foto); await tick();
  pulsa('[data-z="+"]'); pulsa('[data-rot="1"]'); pulsa('[data-asp="4:3"]');
  d.querySelector('.foto-ed-zoom').value = '2.5'; d.querySelector('.foto-ed-zoom').dispatchEvent(new window.Event('input'));
  d.querySelector('.foto-ed-brillo').value = '110'; d.querySelector('.foto-ed-brillo').dispatchEvent(new window.Event('input'));
  assert.ok(llamadas.some(([k]) => k === 'drawImage') && llamadas.some(([k]) => k === 'rotate'), 'dibuja la foto girada');
  pulsa('[data-x="ok"]');
  const blob = await p;
  assert.equal(blob.tipo, 'image/jpeg');
  assert.ok(Math.max(blob.w, blob.h) <= 1200 && Math.abs(blob.w / blob.h - 4 / 3) < 0.02, `salida ${blob.w}×${blob.h} con proporción 4:3`);
  assert.equal(d.querySelector('.foto-ed-ov'), null);

  // archivo que no es imagen
  let aviso = ''; window.alert = m => { aviso = m; };
  assert.equal(await window.abrirEditorFoto({ type: 'application/pdf', size: 10 }), null); assert.match(aviso, /imagen/i);
});

test('gestor de fotos: agregar con editor, principal, mover y eliminar guardan en el producto', async () => {
  const A = 'https://res.cloudinary.com/x/a.jpg', B = 'https://res.cloudinary.com/x/b.jpg', C = 'https://res.cloudinary.com/x/c.jpg';
  const { window, firebase } = setup({ G1: { name: 'ATEMPO', stock: 1, image: A, images: [A, B] } });
  const d = window.document, prod = { name: 'ATEMPO', image: A, images: [A, B] }, tick = () => new Promise(r => setTimeout(r, 20));
  window.confirm = () => true;
  window.gestionarFotos('G1', prod, () => {}); await tick();
  assert.equal(d.querySelectorAll('.fg-item').length, 2);
  d.querySelector('[data-a="principal"][data-i="1"]').click(); await tick();                       // B pasa a principal
  assert.deepEqual([firebase._store.products.G1.image, JSON.parse(JSON.stringify(firebase._store.products.G1.images))], [B, [B, A]]);
  d.querySelector('[data-a="der"][data-i="0"]').click(); await tick();                              // la mueve después
  assert.equal(firebase._store.products.G1.image, A);
  d.querySelector('[data-a="borrar"][data-i="0"]').click(); await tick();                           // elimina la principal
  assert.deepEqual([firebase._store.products.G1.image, JSON.parse(JSON.stringify(firebase._store.products.G1.images))], [B, [B]]);
  assert.match(d.querySelector('.fg-add').textContent, /1\/6/);
  d.querySelector('.fg-ok').click(); assert.equal(d.querySelector('.foto-ed-ov'), null);
});
