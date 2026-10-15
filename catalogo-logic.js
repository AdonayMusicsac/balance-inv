// =========================================================
// BALANCE-INV — Catálogo público + fotos de producto
// =========================================================
// El catálogo público es una COPIA reducida de los productos en catalogoPublico/productos:
// solo nombre, categoría, foto y "disponible" (sí/no). Nunca precios, costos, cantidades
// ni el tipo importado/nacional. catalogo-publico.html lee únicamente ese nodo.
const refCatalogoPublico = db.ref('catalogoPublico');
const CAT_PAGINA = 24;
const _urlHttps = u => (/^https:\/\/\S+$/i.test(u || '') ? u : '');
const _esAdminCat = () => typeof isAdmin !== 'function' || isAdmin();
const _firma = o => JSON.stringify(Object.keys(o || {}).sort().map(k => [k, o[k]]));

function productoPublico(p) {
  const o = {
    nombre: p.name || '',
    categoria: String(p.category || '').toLowerCase() === 'general' ? '' : (p.category || ''),
    imagen: _urlHttps(p.image),
    disponible: (Number(p.stock) || 0) > 0
  };
  if (p.updatedAt) o.actualizadoEn = Number(p.updatedAt);
  return o;
}

// Deja catalogoPublico/productos igual a lo que debe verse: escribe solo lo que cambió.
async function sincronizarCatalogoPublico() {
  let cfg;
  try { cfg = (await refCatalogoPublico.get()).val() || {}; } catch (e) { return { omitido: true }; }
  if (cfg.activo !== true) return { omitido: true };
  const prods = (await refProducts.get()).val() || {}, deseado = {}, cambios = {};
  Object.entries(prods).forEach(([code, p]) => { if (!p.deleted && p.publicar !== false && p.name) deseado[code] = productoPublico(p); });
  const actual = cfg.productos || {};
  Object.keys(deseado).forEach(c => { if (_firma(actual[c]) !== _firma(deseado[c])) cambios[c] = deseado[c]; });
  Object.keys(actual).forEach(c => { if (!deseado[c]) cambios[c] = null; });
  const n = Object.keys(cambios).length;
  if (n) await refCatalogoPublico.child('productos').update(cambios);
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
  return { cfg, link, motivo: link ? '' : (cfg.activo === true ? 'Abre la app una vez, como administrador, desde tu página publicada (por ejemplo la de GitHub Pages) y el link se guarda solo.' : 'El catálogo aún no está activo. Actívalo en Catálogo → Publicación y guarda.') };
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

async function subirFotoProducto(code, file) {
  const blob = await comprimirImagen(file);
  const url = await uploadImageToCloudinary(blob, code + '.jpg');
  await refProducts.child(code).update({ image: url, updatedAt: firebase.database.ServerValue.TIMESTAMP });
  return url;
}

window.Catalogo = {
  async init() {
    const $ = id => document.getElementById(id), admin = _esAdminCat();
    let cfg = {}, prods = [], filtro = 'todos', limite = CAT_PAGINA, codigoFoto = null;
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
      let l = prods.filter(p => !q || `${p.code} ${p.name} ${p.category || ''}`.toLowerCase().includes(q));
      if (filtro === 'sinfoto') l = l.filter(p => !_urlHttps(p.image));
      if (filtro === 'oculto') l = l.filter(p => p.publicar === false);
      const conFoto = prods.filter(p => _urlHttps(p.image)).length;
      $('catStats').textContent = `${conFoto} de ${prods.length} con foto · ${prods.filter(p => p.publicar !== false).length} publicados`;
      $('catGrid').innerHTML = l.slice(0, limite).map(p => {
        const img = _urlHttps(p.image);
        return `<div class="cat-item${p.publicar === false ? ' cat-oculto' : ''}"><div class="cat-thumb">${img ? `<img src="${_esc(img)}" alt="" loading="lazy">` : '<span>Sin foto</span>'}</div><div class="cat-body"><div class="cat-name">${_esc(p.name)}</div><div class="cat-sub">${_esc(p.code)}${p.category && p.category.toLowerCase() !== 'general' ? ' · ' + _esc(p.category) : ''}</div><div class="cat-actions"><button class="btn" data-foto="${_esc(p.code)}">${img ? 'Cambiar foto' : 'Subir foto'}</button>${admin ? `<label class="cat-switch"><input type="checkbox" data-pub="${_esc(p.code)}"${p.publicar === false ? '' : ' checked'}> Publicar</label>` : ''}</div></div></div>`;
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
    $('catGrid').onclick = e => { const c = e.target.dataset && e.target.dataset.foto; if (c) { codigoFoto = c; $('catFile').value = ''; $('catFile').click(); } };
    $('catGrid').onchange = async e => {
      const c = e.target.dataset && e.target.dataset.pub;
      if (!c) return;
      try { await refProducts.child(c).update({ publicar: e.target.checked }); (prods.find(p => p.code === c) || {}).publicar = e.target.checked; programarSyncCatalogo(); pintar(); }
      catch (err) { e.target.checked = !e.target.checked; alert('No se pudo cambiar: ' + err.message); }
    };
    $('catFile').onchange = async () => {
      const file = $('catFile').files[0];
      if (!file || !codigoFoto) return;
      $('catStats').textContent = 'Subiendo foto…';
      try {
        if (cloudinaryConfigured()) await subirFotoProducto(codigoFoto, file);
        else {   // sin Cloudinary (demo): se puede pegar la dirección de una foto ya publicada
          const url = prompt('Cloudinary aún no está configurado. Pega la dirección (https://…) de la foto:');
          if (!_urlHttps(url)) throw new Error('La dirección debe empezar con https://');
          await refProducts.child(codigoFoto).update({ image: url.trim(), updatedAt: firebase.database.ServerValue.TIMESTAMP });
        }
        await cargar();
      } catch (err) { alert(err.message); pintar(); }
    };
    await cargar();
  }
};
