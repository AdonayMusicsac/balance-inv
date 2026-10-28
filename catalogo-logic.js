// =========================================================
// BALANCE-INV — Catálogo público + fotos de producto
// =========================================================
// El catálogo público es una COPIA reducida de los productos en catalogoPublico/productos:
// solo nombre, descripción, categoría, foto y "disponible" (sí/no). Nunca precios, costos, cantidades
// ni el tipo importado/nacional. catalogo-publico.html lee únicamente ese nodo.
const refCatalogoPublico = db.ref('catalogoPublico');
const CAT_PAGINA = 24;
const _urlHttps = u => (/^https:\/\/[^\s"'<>\\]+$/i.test(u || '') ? u : '');
const _esAdminCat = () => typeof isAdmin !== 'function' || isAdmin();
const _firma = o => JSON.stringify(Object.keys(o || {}).sort().map(k => [k, o[k]]));

const MAX_FOTOS = 6;
// Fotos de un producto: la lista `images` (o, en productos viejos, la única `image`). La primera es la principal.
function fotosDe(p) {
  p = p || {};
  const lista = Array.isArray(p.images) ? p.images : (p.images && typeof p.images === 'object' ? Object.values(p.images) : []);
  const urls = lista.map(_urlHttps).filter((u, i, a) => u && a.indexOf(u) === i);
  const principal = _urlHttps(p.image);
  if (principal) { const i = urls.indexOf(principal); if (i !== 0) { if (i > 0) urls.splice(i, 1); urls.unshift(principal); } }   // la principal siempre va primero
  return urls.slice(0, MAX_FOTOS);
}

function productoPublico(p) {
  const fotos = fotosDe(p);
  const o = {
    nombre: p.name || '',
    categoria: String(p.category || '').toLowerCase() === 'general' ? '' : (p.category || ''),
    imagen: fotos[0] || '',
    disponible: (Number(p.stock) || 0) > 0
  };
  const d = String(p.desc || '').replace(/\s+/g, ' ').trim().slice(0, 300);   // la descripción es pública; precios y costos, nunca
  if (d) o.descripcion = d;
  if (fotos.length > 1) o.imagenes = fotos;   // con varias fotos, la página pública las muestra en carrusel
  if (p.updatedAt) o.actualizadoEn = Number(p.updatedAt);
  return o;
}

// Deja catalogoPublico/productos igual a lo que debe verse: escribe solo lo que cambió.
let _catActual = null, _catActualTs = 0;   // espejo en memoria: evita bajar todo el catálogo en cada venta
async function sincronizarCatalogoPublico() {
  let cfg;
  try {
    const act = (await refCatalogoPublico.child('activo').get()).val();   // lectura mínima
    if (act !== true) { _catActual = null; return { omitido: true }; }
    cfg = { activo: true };
    if (!_catActual || Date.now() - _catActualTs > 10 * 60 * 1000) {
      _catActual = (await refCatalogoPublico.child('productos').get()).val() || {};
      _catActualTs = Date.now();
    }
  } catch (e) { return { omitido: true }; }
  const prods = (await refProducts.get()).val() || {}, deseado = {}, cambios = {};
  Object.entries(prods).forEach(([code, p]) => { if (!p.deleted && p.publicar !== false && p.name) deseado[code] = productoPublico(p); });
  const actual = _catActual || {};
  Object.keys(deseado).forEach(c => { if (_firma(actual[c]) !== _firma(deseado[c])) cambios[c] = deseado[c]; });
  Object.keys(actual).forEach(c => { if (!deseado[c]) cambios[c] = null; });
  const n = Object.keys(cambios).length;
  if (n) {
    await refCatalogoPublico.child('productos').update(cambios);
    Object.keys(cambios).forEach(c => { if (cambios[c] === null) delete _catActual[c]; else _catActual[c] = cambios[c]; });
  }
  return { escritos: n };
}

let _catTimer = null, _catEscuchando = false;
function programarSyncCatalogo() { clearTimeout(_catTimer); _catTimer = setTimeout(() => sincronizarCatalogoPublico().catch(() => {}), 3000); }
try {   // cualquier sesión abierta mantiene el espejo al día (ventas, ajustes, importaciones...)
  firebase.auth().onAuthStateChanged(u => { if (u && !_catEscuchando) { _catEscuchando = true; refProducts.on('value', programarSyncCatalogo); (typeof authReady !== 'undefined' ? authReady : Promise.resolve()).then(recordarDireccionPublica).catch(() => {}); } });
} catch (e) { /* sin auth (pruebas) */ }

async function guardarConfigCatalogo({ activo, nombre, whatsapp, urlBase }) {
  if (!_esAdminCat()) throw new Error('Solo el administrador puede cambiar el catálogo público.');
  const wa = String(whatsapp || '').replace(/\D/g, '');
  if (wa && !/^\d{8,15}$/.test(wa)) throw new Error('El WhatsApp debe tener entre 8 y 15 dígitos (con código de país, ej. 51987654321).');
  const url = String(urlBase || '').trim().replace(/\/+$/, '');
  if (url && !_urlHttps(url)) throw new Error('La dirección web debe empezar con https://');
  if (activo && !String(nombre || '').trim()) throw new Error('Escribe el nombre que verá el cliente.');
  const base = url || _origenPagina();   // vacío = automática: la de la página desde la que se abre la app (p. ej. GitHub Pages)
  await refCatalogoPublico.update({ activo: !!activo, nombre: String(nombre || '').trim().slice(0, 80), whatsapp: wa, ...(base ? { urlBase: base } : {}) });
  return activo ? sincronizarCatalogoPublico() : { omitido: true };
}

// De dónde sale la dirección del catálogo, sin que nadie la escriba:
// 1) la dirección guardada (la app la guarda sola la primera vez que el administrador la abre desde su página
//    publicada, p. ej. https://usuario.github.io/balance-inv, o una escrita a mano en "Avanzado"),
// 2) si no, la dirección desde la que se abrió esta misma sesión (https real, no localhost).
function _origenPagina() {
  return /^https?:$/.test(location.protocol) && !/^(localhost|127\.|\[::1\])/.test(location.hostname) ? location.origin + location.pathname.replace(/\/[^/]*$/, '') : '';
}
function linkCatalogo(urlBase, code) {
  const base = String(urlBase || '').trim().replace(/\/+$/, '') || _origenPagina();
  return base ? `${base}/catalogo-publico.html${code ? '?producto=' + encodeURIComponent(code) : ''}` : '';
}
// Si el administrador abre la app desde su página publicada y aún no hay dirección guardada, la guarda.
// Así el APK (que corre en localhost) y los demás celulares usan siempre esa misma dirección.
async function recordarDireccionPublica() {
  try {
    const o = _origenPagina();
    if (!o || !_esAdminCat()) return false;
    const actual = (await refCatalogoPublico.child('urlBase').get()).val();
    if (actual) return false;
    await refCatalogoPublico.child('urlBase').set(o);
    return true;
  } catch (e) { return false; }
}

// Matriz de módulos del QR (true = cuadro oscuro). Usa qrcode-generator.js (MIT, Kazuhiko Arase).
function matrizQr(texto) {
  const qr = qrcode(0, 'M');   // tamaño automático, corrección de errores media
  qr.addData(String(texto)); qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, k) => qr.isDark(r, k)));
}
// Dibuja el QR con zona blanca alrededor (4 módulos, lo mínimo para que lo lea cualquier cámara).
function dibujarQr(canvas, texto, lado = 512) {
  const m = matrizQr(texto), margen = 4, celda = Math.max(2, Math.floor(lado / (m.length + margen * 2))), px = (m.length + margen * 2) * celda;
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext && canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = '#000';
  m.forEach((fila, r) => fila.forEach((oscuro, k) => { if (oscuro) ctx.fillRect((k + margen) * celda, (r + margen) * celda, celda, celda); }));
}
async function compartirQr(canvas, nombre) {
  const blob = await new Promise(ok => canvas.toBlob(ok, 'image/png'));
  const archivo = new File([blob], 'catalogo-qr.png', { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [archivo] })) return navigator.share({ files: [archivo], title: nombre || 'Catálogo' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'catalogo-qr.png'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ── Copiar link y modal con QR (se usan desde Configuración y desde Catálogo) ──
async function datosCatalogo() {
  let cfg = {};
  try { cfg = (await refCatalogoPublico.get()).val() || {}; } catch (e) { /* sin permiso: catálogo inactivo */ }
  const link = cfg.activo === true ? linkCatalogo(cfg.urlBase) : '';
  return { cfg, link, motivo: link ? '' : (cfg.activo === true ? 'Abre la app como admin desde tu página publicada una vez.' : 'Catálogo inactivo: actívalo en Publicación.') };
}
async function copiarLinkCatalogo() {
  const { link, motivo } = await datosCatalogo();
  if (!link) return alert(motivo);
  try { await navigator.clipboard.writeText(link); alert('Link copiado.'); } catch (e) { prompt('Copia el link:', link); }
}
async function abrirModalQrCatalogo() {
  let m = document.getElementById('qrModal');
  if (!m) {
    m = document.createElement('div'); m.id = 'qrModal'; m.className = 'modal-overlay';
    m.innerHTML = '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="qrModalTitulo" style="max-width:380px"><div class="modal-header"><div><h2 id="qrModalTitulo">Código QR del catálogo</h2><p id="qrModalSub"></p></div><button type="button" class="modal-close" id="qrModalX" aria-label="Cerrar"><svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div><div class="modal-body"><div class="cat-qr" id="qrModalBox"><canvas id="qrModalCanvas" width="256" height="256"></canvas></div><p class="bal-note" id="qrModalMsg" style="word-break:break-all;text-align:center;margin:10px 0 0"></p></div><div class="modal-footer"><button type="button" class="btn" id="qrModalCopiar">Copiar link</button><button type="button" class="btn btn-primary" id="qrModalBajar">Compartir o descargar</button></div></div>';
    document.body.appendChild(m);
    const cerrar = () => m.classList.remove('open');
    m.addEventListener('click', e => { if (e.target === m) cerrar(); });
    document.getElementById('qrModalX').onclick = cerrar;
    document.addEventListener('keydown', e => { if (e.key === 'Escape') cerrar(); });
  }
  const { link, cfg, motivo } = await datosCatalogo();
  const lienzo = document.getElementById('qrModalCanvas');
  document.getElementById('qrModalSub').textContent = cfg.nombre || '';
  document.getElementById('qrModalBox').style.display = link ? '' : 'none';
  document.getElementById('qrModalCopiar').style.display = document.getElementById('qrModalBajar').style.display = link ? '' : 'none';
  document.getElementById('qrModalMsg').textContent = link || motivo;
  if (link) {
    dibujarQr(lienzo, link);
    document.getElementById('qrModalCopiar').onclick = copiarLinkCatalogo;
    document.getElementById('qrModalBajar').onclick = () => compartirQr(lienzo, cfg.nombre).catch(e => { if (e.name !== 'AbortError') alert('No se pudo compartir el QR: ' + e.message); });
  }
  m.classList.add('open');
}
// Tarjeta "Catálogo público" de la pantalla Configuración.
async function initConfigCatalogo() {
  const b1 = document.getElementById('cfgCatCopiar'), b2 = document.getElementById('cfgCatQr');
  if (!b1 || !b2) return;
  b1.onclick = copiarLinkCatalogo; b2.onclick = abrirModalQrCatalogo;
  await recordarDireccionPublica();
  const { link, motivo } = await datosCatalogo();
  const t = document.getElementById('cfgCatLink');
  if (t) t.textContent = link || motivo;
}

// Descarga catalogo.json (copia estática). Súbelo a GitHub si no usas la actualización automática.
async function descargarCopiaCatalogo() {
  const nodo = (await refCatalogoPublico.get()).val() || {};
  const blob = new Blob([JSON.stringify(window.copiaEstatica(nodo), null, 1)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'catalogo.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------------------------------------------------------
// Editor de foto: recortar, mover, hacer zoom, girar y ajustar brillo ANTES de guardar. Nada se sube hasta pulsar «Aceptar».
// La geometría es pura (se prueba sin navegador); el dibujo usa un canvas.
// ---------------------------------------------------------
function escalaCubrir(w, h, vw, vh) { return Math.max(vw / w, vh / h); }                 // escala mínima para que la foto llene el marco
function limitarDesplazamiento(w, h, s, vw, vh, ox, oy) {                                 // la foto nunca deja huecos dentro del marco
  const mx = Math.max(0, (w * s - vw) / 2), my = Math.max(0, (h * s - vh) / 2);
  return { ox: Math.min(mx, Math.max(-mx, ox)), oy: Math.min(my, Math.max(-my, oy)) };
}
function marcoFoto(aspecto, maxW, maxH) {                                                 // tamaño del marco de recorte para una proporción ancho/alto
  let vw = maxW, vh = vw / aspecto;
  if (vh > maxH) { vh = maxH; vw = vh * aspecto; }
  return { vw: Math.max(40, Math.round(vw)), vh: Math.max(40, Math.round(vh)) };
}
const ASPECTOS_FOTO = [['1:1', 'Cuadrada', 1], ['4:5', 'Vertical', 4 / 5], ['4:3', 'Horizontal', 4 / 3], ['orig', 'Original', null]];

function abrirEditorFoto(file) {
  return new Promise(resolve => {
    if (!file || !/^image\//.test(file.type)) { alert('Elige un archivo de imagen.'); return resolve(null); }
    if (file.size > 25 * 1024 * 1024) { alert('La imagen pesa más de 25 MB.'); return resolve(null); }
    const url = URL.createObjectURL(file), img = new Image();
    img.onerror = () => { URL.revokeObjectURL(url); alert('No se pudo leer la imagen.'); resolve(null); };
    img.onload = () => iniciar();
    img.src = url;

    function iniciar() {
      let rot = 0, zoom = 1, ox = 0, oy = 0, aspKey = '1:1', brillo = 100, vw = 300, vh = 300;
      const dims = () => (rot % 2 ? { w: img.naturalHeight, h: img.naturalWidth } : { w: img.naturalWidth, h: img.naturalHeight });
      const aspecto = () => { const a = ASPECTOS_FOTO.find(x => x[0] === aspKey)[2]; const d = dims(); return a || Math.min(3, Math.max(0.4, d.w / d.h)); };
      const ov = document.createElement('div'); ov.className = 'foto-ed-ov';
      ov.innerHTML = `<div class="foto-ed" role="dialog" aria-modal="true" aria-label="Ajustar foto">
        <div class="foto-ed-top"><strong>Ajustar foto</strong><span>Arrastra para mover · pellizca o usa el zoom</span></div>
        <div class="foto-ed-stage"><canvas class="foto-ed-canvas"></canvas></div>
        <div class="foto-ed-asp">${ASPECTOS_FOTO.map(x => `<button type="button" class="btn foto-ed-a${x[0] === aspKey ? ' on' : ''}" data-asp="${x[0]}">${x[1]}</button>`).join('')}</div>
        <div class="foto-ed-row"><button type="button" class="btn" data-z="-">−</button><input type="range" class="foto-ed-zoom" min="1" max="4" step="0.01" value="1" aria-label="Zoom"><button type="button" class="btn" data-z="+">+</button>
          <button type="button" class="btn" data-rot="-1" title="Girar a la izquierda">⟲</button><button type="button" class="btn" data-rot="1" title="Girar a la derecha">⟳</button></div>
        <div class="foto-ed-row foto-ed-br"><label>Brillo <input type="range" class="foto-ed-brillo" min="70" max="130" step="1" value="100"></label></div>
        <div class="foto-ed-acc"><button type="button" class="btn" data-x="cancel">Cancelar</button><button type="button" class="btn btn-primary" data-x="ok">✓ Aceptar y guardar</button></div></div>`;
      document.body.appendChild(ov);
      const q = s2 => ov.querySelector(s2), canvas = q('.foto-ed-canvas'), zoomEl = q('.foto-ed-zoom'), brEl = q('.foto-ed-brillo');
      const ctx0 = canvas.getContext && canvas.getContext('2d');
      const filtroOk = !!ctx0 && 'filter' in ctx0;
      if (!filtroOk) q('.foto-ed-br').style.display = 'none';

      function marco() {
        const f = marcoFoto(aspecto(), Math.min(520, window.innerWidth - 40), Math.min(window.innerHeight * 0.5, 520));
        vw = f.vw; vh = f.vh;
        const dpr = window.devicePixelRatio || 1;
        canvas.style.width = vw + 'px'; canvas.style.height = vh + 'px'; canvas.width = Math.round(vw * dpr); canvas.height = Math.round(vh * dpr);
      }
      function dibujar(ctx, k) {
        const d = dims(), s = escalaCubrir(d.w, d.h, vw, vh) * zoom, l = limitarDesplazamiento(d.w, d.h, s, vw, vh, ox, oy);
        ox = l.ox; oy = l.oy;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, vw * k, vh * k);
        if (filtroOk) ctx.filter = `brightness(${brillo}%)`;
        ctx.translate(vw * k / 2 + ox * k, vh * k / 2 + oy * k); ctx.rotate(rot * Math.PI / 2); ctx.scale(s * k, s * k);
        ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2);
        if (filtroOk) ctx.filter = 'none';
      }
      const pintar = () => { if (ctx0) dibujar(ctx0, canvas.width / vw); };
      const poner = z => { zoom = Math.min(4, Math.max(1, z)); zoomEl.value = zoom; pintar(); };
      const cerrar = r => { document.removeEventListener('keydown', tecla); ov.remove(); URL.revokeObjectURL(url); resolve(r); };
      const tecla = e => { if (e.key === 'Escape') cerrar(null); };
      document.addEventListener('keydown', tecla);
      marco(); pintar();

      // arrastrar (un dedo) y pellizcar (dos dedos)
      const dedos = new Map(); let dist0 = 0, zoom0 = 1;
      canvas.onpointerdown = e => { canvas.setPointerCapture(e.pointerId); dedos.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (dedos.size === 2) { const [a, b] = [...dedos.values()]; dist0 = Math.hypot(a.x - b.x, a.y - b.y); zoom0 = zoom; } };
      canvas.onpointermove = e => {
        const p = dedos.get(e.pointerId); if (!p) return;
        if (dedos.size === 1) { ox += e.clientX - p.x; oy += e.clientY - p.y; p.x = e.clientX; p.y = e.clientY; pintar(); }
        else { p.x = e.clientX; p.y = e.clientY; const [a, b] = [...dedos.values()]; if (dist0) poner(zoom0 * Math.hypot(a.x - b.x, a.y - b.y) / dist0); }
      };
      canvas.onpointerup = canvas.onpointercancel = e => { dedos.delete(e.pointerId); dist0 = 0; };
      canvas.onwheel = e => { e.preventDefault(); poner(zoom - e.deltaY * 0.002); };

      ov.onclick = e => {
        const t = e.target, bz = t.dataset && t.dataset.z, br = t.dataset && t.dataset.rot, as = t.dataset && t.dataset.asp, x = t.dataset && t.dataset.x;
        if (bz) poner(zoom + (bz === '+' ? 0.25 : -0.25));
        else if (br) { rot = (rot + Number(br) + 4) % 4; ox = oy = 0; marco(); pintar(); }
        else if (as) { aspKey = as; ox = oy = 0; ov.querySelectorAll('.foto-ed-a').forEach(b => b.classList.toggle('on', b.dataset.asp === as)); marco(); pintar(); }
        else if (x === 'cancel' || t === ov) cerrar(null);
        else if (x === 'ok') {
          const k = Math.min(4, 1200 / Math.max(vw, vh)), out = document.createElement('canvas');
          out.width = Math.round(vw * k); out.height = Math.round(vh * k);
          dibujar(out.getContext('2d'), k);
          out.toBlob(b => { if (b) cerrar(b); else alert('No se pudo procesar la foto.'); }, 'image/jpeg', 0.86);
        }
      };
      zoomEl.oninput = () => poner(Number(zoomEl.value));
      brEl.oninput = () => { brillo = Number(brEl.value); pintar(); };
    }
  });
}

// Guarda la lista de fotos del producto; la primera es la principal (y la que usan el Stock y los catálogos viejos).
async function guardarFotos(code, urls) {
  const lista = (urls || []).map(_urlHttps).filter(Boolean).slice(0, MAX_FOTOS);
  await refProducts.child(code).update({ images: lista.length ? lista : null, image: lista[0] || null, updatedAt: firebase.database.ServerValue.TIMESTAMP });
  if (typeof programarSyncCatalogo === 'function') programarSyncCatalogo();
  return lista;
}

// Foto nueva: editor → (al aceptar) subir a Cloudinary → devuelve la URL.
async function subirFotoEditada(code, file) {
  const blob = await abrirEditorFoto(file);
  if (!blob) return '';                                   // canceló: no se guarda nada
  if (cloudinaryConfigured()) return uploadImageToCloudinary(blob, `${code}-${Date.now().toString(36)}.jpg`);
  const url = prompt('Cloudinary aún no está configurado. Pega la dirección (https://…) de la foto:');   // modo demo
  if (!_urlHttps(url)) throw new Error('La dirección debe empezar con https://');
  return url.trim();
}

// Ventana con todas las fotos del producto: agregar (con editor), elegir la principal, ordenar y eliminar.
function gestionarFotos(code, producto, alCambiar) {
  let lista = fotosDe(producto);
  const ov = document.createElement('div'); ov.className = 'foto-ed-ov foto-ed-ov-sheet';
  ov.innerHTML = `<div class="foto-ed foto-gest" role="dialog" aria-modal="true"><div class="foto-ed-top"><strong>Fotos de ${_esc(producto.name || code)}</strong><span>La primera es la principal. Máximo ${MAX_FOTOS}.</span></div>
    <div class="fg-grid"></div><div class="fg-msg"></div>
    <input type="file" class="fg-file" accept="image/*" style="display:none">
    <input type="file" class="fg-file-cam" accept="image/*" capture="environment" style="display:none">
    <div class="fg-foot"><div class="fg-add"><button type="button" class="btn fg-src fg-cam"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.2l1.1-1.6A1.5 1.5 0 0 1 10.05 4.7h3.9a1.5 1.5 0 0 1 1.25.7L16.3 7h2.2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"/><circle cx="12" cy="12.8" r="3.3"/></svg><span>Tomar foto</span></button><button type="button" class="btn fg-src fg-gal"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="M4 17l4.6-4.4a1.5 1.5 0 0 1 2.1 0L15 16.8l1.6-1.5a1.5 1.5 0 0 1 2 0L20.5 17"/></svg><span>Galería</span></button><span class="fg-cuenta"></span></div>
    <button type="button" class="btn btn-primary fg-ok">Listo</button></div></div>`;
  document.body.appendChild(ov);
  const q = s2 => ov.querySelector(s2), msg = t => { q('.fg-msg').textContent = t || ''; };
  const pintar = () => {
    q('.fg-grid').innerHTML = lista.map((u, i) => `<div class="fg-item"><img src="${_esc(u)}" alt="" loading="lazy">${i === 0 ? '<span class="fg-badge">Principal</span>' : ''}
      <div class="fg-acc">${i > 0 ? `<button type="button" class="btn" data-a="principal" data-i="${i}" title="Poner como principal">★</button>` : ''}${i > 0 ? `<button type="button" class="btn" data-a="izq" data-i="${i}" title="Mover antes">‹</button>` : ''}${i < lista.length - 1 ? `<button type="button" class="btn" data-a="der" data-i="${i}" title="Mover después">›</button>` : ''}<button type="button" class="btn fg-del" data-a="borrar" data-i="${i}" title="Eliminar">🗑</button></div></div>`).join('') || '<div class="fg-vacio"><span class="fg-vacio-ic"><svg viewBox=\"0 0 24 24\" width=\"26\" height=\"26\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.8\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><path d=\"M4 8.5A1.5 1.5 0 0 1 5.5 7h2.2l1.1-1.6A1.5 1.5 0 0 1 10.05 4.7h3.9a1.5 1.5 0 0 1 1.25.7L16.3 7h2.2A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z\"/><circle cx=\"12\" cy=\"12.8\" r=\"3.3\"/></svg></span><strong>Aún no hay fotos</strong><span>Toma una foto con la cámara o elige una de tu galería.</span></div>';
    const lleno = lista.length >= MAX_FOTOS;
    q('.fg-cam').disabled = q('.fg-gal').disabled = lleno;
    q('.fg-cuenta').textContent = `${lista.length}/${MAX_FOTOS} fotos`;
  };
  const aplicar = async nueva => { try { msg('Guardando…'); lista = await guardarFotos(code, nueva); Object.assign(producto, { images: lista.length ? lista : undefined, image: lista[0] || undefined }); msg(''); if (alCambiar) alCambiar(lista); } catch (e) { msg(''); alert('No se pudo guardar: ' + e.message); } pintar(); };
  const alElegir = async inp => {
    const f = inp.files[0]; if (!f) return;
    try { const url = await subirFotoEditada(code, f); if (url) { msg('Subiendo…'); await aplicar([...lista, url]); } }
    catch (e) { msg(''); alert(e.message); }
  };
  q('.fg-gal').onclick = () => { q('.fg-file').value = ''; q('.fg-file').click(); };
  q('.fg-cam').onclick = () => { q('.fg-file-cam').value = ''; q('.fg-file-cam').click(); };   // en el teléfono abre la cámara trasera; en PC abre el selector de archivos
  q('.fg-file').onchange = () => alElegir(q('.fg-file'));
  q('.fg-file-cam').onchange = () => alElegir(q('.fg-file-cam'));
  q('.fg-grid').onclick = e => {
    const a = e.target.dataset && e.target.dataset.a, i = Number(e.target.dataset && e.target.dataset.i);
    if (!a) return;
    const n = lista.slice();
    if (a === 'borrar') { if (!confirm('¿Eliminar esta foto?')) return; n.splice(i, 1); }
    else if (a === 'principal') n.unshift(n.splice(i, 1)[0]);
    else if (a === 'izq') [n[i - 1], n[i]] = [n[i], n[i - 1]];
    else if (a === 'der') [n[i + 1], n[i]] = [n[i], n[i + 1]];
    aplicar(n);
  };
  q('.fg-ok').onclick = () => ov.remove();
  ov.onclick = e => { if (e.target === ov) ov.remove(); };
  pintar();
}

window.Catalogo = {
  async init() {
    const $ = id => document.getElementById(id), admin = _esAdminCat();
    let cfg = {}, prods = [], filtro = 'todos', limite = CAT_PAGINA;
    await recordarDireccionPublica();
    try { cfg = (await refCatalogoPublico.get()).val() || {}; } catch (e) { /* inactivo y sin permiso de lectura */ }
    $('catActivo').checked = cfg.activo === true; $('catNombre').value = cfg.nombre || '';
    $('catWa').value = cfg.whatsapp || ''; $('catUrl').value = cfg.urlBase || '';
    if (!admin) { $('catConfigCard').style.display = 'none'; }
    const pintarLink = () => {
      const l = linkCatalogo($('catUrl').value || cfg.urlBase);
      $('catLink').textContent = l || 'El link aparece solo cuando abras la app, como administrador, desde tu página publicada (GitHub Pages).';
      $('catCopiar').disabled = $('catCompartir').disabled = $('catVerQr').disabled = !l;
    };
    const cargar = async () => {
      const data = (await refProducts.get()).val() || {};
      prods = Object.entries(data).filter(([, p]) => !p.deleted && p.name).map(([code, p]) => ({ code, ...p }));
      pintar();
    };
    const pintar = () => {
      const q = $('catBuscar').value.trim().toLowerCase();
      const palabras = q.normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/\s+/).filter(Boolean);
      let l = prods.filter(p => { const t = `${p.code} ${p.name} ${p.desc || ''} ${p.category || ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); return palabras.every(w => t.includes(w)); });
      if (filtro === 'sinfoto') l = l.filter(p => !fotosDe(p).length);
      if (filtro === 'oculto') l = l.filter(p => p.publicar === false);
      const conFoto = prods.filter(p => fotosDe(p).length).length;
      $('catStats').textContent = `${conFoto} de ${prods.length} con foto · ${prods.filter(p => p.publicar !== false).length} publicados`;
      $('catGrid').innerHTML = l.slice(0, limite).map(p => {
        const fotos = fotosDe(p), img = fotos[0] || '';
        return `<div class="cat-item${p.publicar === false ? ' cat-oculto' : ''}"><div class="cat-thumb">${img ? `<img src="${_esc(img)}" alt="" loading="lazy">` : '<span>Sin foto</span>'}${fotos.length > 1 ? `<span class="cat-nfotos">${fotos.length} fotos</span>` : ''}</div><div class="cat-body"><div class="cat-name">${_esc(p.name)}</div>${p.desc ? `<div class="cat-desc">${_esc(p.desc)}</div>` : '<div class="cat-desc cat-sindesc">Sin descripción</div>'}<div class="cat-sub">${_esc(p.code)}${p.category && p.category.toLowerCase() !== 'general' ? ' · ' + _esc(p.category) : ''}</div><div class="cat-actions"><button class="btn" data-foto="${_esc(p.code)}">${fotos.length ? 'Fotos (' + fotos.length + ')' : 'Subir foto'}</button>${admin ? `<label class="cat-switch"><input type="checkbox" data-pub="${_esc(p.code)}"${p.publicar === false ? '' : ' checked'}> Publicar</label>` : ''}</div></div></div>`;
      }).join('') || '<p class="bal-note">No hay productos que coincidan.</p>';
      $('catMas').style.display = l.length > limite ? '' : 'none';
    };
    $('catUrl').oninput = pintarLink; pintarLink();
    $('catBuscar').oninput = () => { limite = CAT_PAGINA; pintar(); };
    $('catFiltro').onchange = e => { filtro = e.target.value; limite = CAT_PAGINA; pintar(); };
    $('catMas').onclick = () => { limite += CAT_PAGINA; pintar(); };
    $('catGuardar').onclick = async () => {
      try {
        const r = await guardarConfigCatalogo({ activo: $('catActivo').checked, nombre: $('catNombre').value, whatsapp: $('catWa').value, urlBase: $('catUrl').value });
        alert($('catActivo').checked ? `✓ Catálogo activo. ${r.escritos != null ? r.escritos + ' producto(s) actualizados.' : ''}` : '✓ Catálogo desactivado: el link ya no muestra productos.');
        cfg = { ...cfg, activo: $('catActivo').checked, urlBase: $('catUrl').value.trim().replace(/\/+$/, '') };
        pintarLink();
      } catch (e) { alert(e.message); }
    };
    $('catSync').onclick = async () => {
      try { const r = await sincronizarCatalogoPublico(); alert(r.omitido ? 'Activa el catálogo primero.' : `✓ Sincronizado (${r.escritos} cambio(s)).`); } catch (e) { alert(e.message); }
    };
    $('catCopiar').onclick = async () => {
      const l = linkCatalogo($('catUrl').value || cfg.urlBase);
      try { await navigator.clipboard.writeText(l); alert('Link copiado.'); } catch (e) { prompt('Copia el link:', l); }
    };
    $('catCompartir').onclick = async () => {
      try { await navigator.share({ title: $('catNombre').value || 'Catálogo', url: linkCatalogo($('catUrl').value || cfg.urlBase) }); }
      catch (e) { if (e.name !== 'AbortError') $('catCopiar').click(); }   // sin menú de compartir: copia el link
    };
    $('catVerQr').onclick = abrirModalQrCatalogo;
    if ($('catJson')) $('catJson').onclick = () => descargarCopiaCatalogo().catch(e => alert(e.message));
    $('catGrid').onclick = e => { const c = e.target.dataset && e.target.dataset.foto; const pr = c && prods.find(x => x.code === c); if (pr) gestionarFotos(c, pr, () => pintar()); };
    $('catGrid').onchange = async e => {
      const c = e.target.dataset && e.target.dataset.pub;
      if (!c) return;
      try { await refProducts.child(c).update({ publicar: e.target.checked }); (prods.find(p => p.code === c) || {}).publicar = e.target.checked; programarSyncCatalogo(); pintar(); }
      catch (err) { e.target.checked = !e.target.checked; alert('No se pudo cambiar: ' + err.message); }
    };
    await cargar();
  }
};