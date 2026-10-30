/* ══════════════════════════════════════
   stock.js — Lógica de inventario
   ══════════════════════════════════════ */

let productsCache = [];
let costosCache = null;   // {code: {prom, ultimo}} — solo admin
const _verCosto = () => typeof isAdmin === 'function' && isAdmin();
const costoDe = p => Number(p.costoCompra) > 0 ? Number(p.costoCompra) : (costosCache && costosCache[p.code] && costosCache[p.code].q ? costosCache[p.code].prom : 0);
function cargarCostosStock() {   // solo admin: completa el costo de productos viejos (compras anteriores a que el costo se guardara en el producto)
  if (!_verCosto() || typeof costosPorProducto !== 'function') return;
  if (!productsCache.some(p => !(Number(p.costoCompra) > 0) && (Number(p.stock) || 0) > 0)) return;   // todos ya tienen costo: no hace falta leer todas las compras
  costosPorProducto().then(c => {
    costosCache = c;
    productsCache.forEach(p => { if (!(Number(p.costoCompra) > 0) && c[p.code] && c[p.code].q) refProducts.child(p.code).update({ costoCompra: Math.round(c[p.code].prom * 10000) / 10000, costoUltimo: Math.round(c[p.code].ultimo * 10000) / 10000, updatedAt: firebase.database.ServerValue.TIMESTAMP }).catch(() => {}); });
    renderStockPage(); updateStats();
  }).catch(() => {});
}
function costoHtml(p) {
  const cu = costoDe(p);
  if (!cu) return '<span class="pt-desc-empty">—</span>';
  const pr = Number(p.price) || 0, mg = pr > 0 ? `margen ${Math.round((pr - cu) / pr * 100)}%` : '';
  const ult = Number(p.costoUltimo) > 0 ? `Último: S/ ${Number(p.costoUltimo).toFixed(2)}` : '';
  const alza = typeof alzaCosto === 'function' ? alzaCosto(p.costoAnterior, p.costoUltimo) : null;   // la última compra costó más que la anterior
  const sube = alza ? `<small style="display:block;color:#c62828;font-weight:600" title="Antes S/ ${alza.antes.toFixed(2)}">▲ subió ${alza.pct}%</small>` : '';
  return `<span title="${ult}">S/ ${cu.toFixed(2)}</span>${sube}<small style="display:block;color:${pr > 0 && cu > pr ? '#c62828' : 'var(--text-3)'}">${mg}</small>`;
}


/* ── Almacenes (Stock por almacén) ──────────────────────
   currentWarehouse: '' = "Todos los almacenes" (comportamiento de
   siempre, usa el stock TOTAL). 'alm1'/'alm2'/'alm3' = solo la
   cantidad de ese almacén (ver WAREHOUSES/updateWarehouseStock/
   addWarehouseStock en firebase.js). */
let currentWarehouse = '';
const WAREHOUSE_LABELS = { alm1: 'Almacén 1', alm2: 'Almacén 2', alm3: 'Almacén 3' };

function getDisplayStock(p) {
  if (!currentWarehouse) return p.stock !== undefined ? p.stock : 0;
  return normalizarAlmacenes(p)[currentWarehouse] || 0;
}

// Productos que "existen" en la vista actual: en un almacén solo se listan los que tienen cantidad ahí.
function productosEnVista() {
  return currentWarehouse ? productsCache.filter(p => getDisplayStock(p) > 0) : productsCache;
}

function switchWarehouse(whId) {
  currentWarehouse = whId || '';
  document.querySelectorAll('.warehouse-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.wh === currentWarehouse);
  });
  const header = document.getElementById('colStockHeader');
  if (header) header.textContent = currentWarehouse ? `Stock — ${WAREHOUSE_LABELS[currentWarehouse]}` : 'Stock';

  const importDefault = document.getElementById('importMenuWrap');
  const exportDefault = document.getElementById('btnExportStock');
  const importWh = document.getElementById('btnImportWarehouse');
  const exportWh = document.getElementById('btnExportWarehouse');
  const showDefault = !currentWarehouse;
  const isVendedor = typeof currentUserRole !== 'undefined' && currentUserRole === 'vendedor';
  if (importDefault) importDefault.style.display = (showDefault && !isVendedor) ? '' : 'none';
  if (exportDefault) exportDefault.style.display = (showDefault && !isVendedor) ? '' : 'none';
  if (importWh) importWh.style.display = (!showDefault && !isVendedor) ? '' : 'none';
  if (exportWh) exportWh.style.display = (!showDefault && !isVendedor) ? '' : 'none';

  const addAlm = document.getElementById('addAlm');
  if (addAlm) addAlm.value = currentWarehouse || 'alm1';
  stockRenderLimit = STOCK_PAGE_SIZE;
  renderProducts();
}

// Normaliza un código de producto para que sea siempre una clave
// de Firebase válida y consistente, venga de "Agregar producto",
// de editar, o de una importación masiva. Sin esto, "101 -4L" y
// "101-4L" quedaban como dos productos distintos (dos claves
// distintas) aunque a simple vista parezcan el mismo código.
function normalizeProductCode(raw) {
  var code = String(raw || '').trim().toUpperCase().replace(/\s+/g, '-').replace(/-+/g, '-');
  // sanitizeFirebaseKey vive en import-stock.js (quita/reemplaza
  // caracteres inválidos para una clave de Firebase: . # $ [ ] /).
  // Se llama así, en vez de duplicar la lógica, porque ambos
  // archivos se cargan en el mismo scope global de la SPA.
  if (typeof sanitizeFirebaseKey === 'function') code = sanitizeFirebaseKey(code);
  // Códigos que vienen de un Excel con columnas de ancho fijo
  // (ej. "B-3K-" con 50 espacios de relleno después) terminan, tras
  // el trim de arriba, en un guion colgando que no forma parte del
  // código real — nadie escribe a propósito un código que TERMINE en
  // guion. Se recorta cualquier racha de guiones/caracteres no
  // alfanuméricos que quede pegada al FINAL. El resto del código
  // (incluido el inicio) queda intacto: solo se toca la punta final.
  // Se exceptúan la comilla doble " (marca de pulgadas, ej. tambor
  // "14"") y la barra de fracción ⁄ (ej. violín "4⁄4"): ambas SÍ son
  // válidas como clave de Firebase y son parte real del código —
  // igual que la barra "/" ya se preserva (como ⁄) en vez de
  // recortarse, la comilla no debe perderse solo por caer al final.
  // El guion "-" también se preserva ahora si queda UNO solo al
  // final (ej. "FV-BOW-1/2-"): antes se recortaba pensando que
  // siempre era un artefacto de Excel con columnas de ancho fijo,
  // pero un guion colgando también puede ser parte real de un
  // código escrito a mano — y ya no hay forma de distinguir ambos
  // casos una vez reducidos a un solo guion. Lo que SÍ se sigue
  // recortando del final es cualquier otro símbolo (espacios ya
  // convertidos en guion, etc.) que no sea uno de estos tres.
  var trimmedEnd = code.replace(/[^A-Z0-9"⁄-]+$/, '');
  if (trimmedEnd) code = trimmedEnd; // si quedara vacío (código de puros símbolos), se deja como estaba
  // Si al final quedan 2 (o más) del mismo símbolo pegados —típico
  // de escribir sin querer 14"" en vez de 14", o "--" en vez de "-"—
  // se deja solo uno. Un código nunca necesita el mismo símbolo
  // repetido al final para tener sentido.
  code = code.replace(/(["⁄-])\1+$/, '$1');
  return code;
}

// Convierte la clave interna de vuelta a lo que el usuario realmente
// escribió, para CUALQUIER lugar donde el código se muestre en
// pantalla (tarjetas, tabla, modal de editar, notas, Excel...).
// Internamente el código se guarda con "⁄" (U+2044) en vez de "/"
// porque Firebase no admite "/" dentro de una clave, pero mostrar
// ese caracter tal cual en vez de convertirlo de vuelta a "/" hace
// que a simple vista se vea casi idéntico a un guion normal — el
// usuario edita, vuelve a escribir "/", y el resultado se ve
// exactamente igual que antes, como si el cambio nunca se hubiera
// guardado. Esta función es la única responsable de esa conversión
// de vuelta, así que todo lo que el usuario VE siempre muestra "/"
// tal cual lo tecleó, sin importar qué caracter se use por debajo
// para guardarlo.
function displayProductCode(code) {
  return String(code || '').replace(/⁄/g, '/');
}

function fmtPrice(n) {
  const num = Number(n);
  if (isNaN(num)) return "0";
  return num.toLocaleString('es-PE', { minimumFractionDigits: num % 1 === 0 ? 0 : 2 });
}

/* ── Paginación por scroll infinito ──────────────────────
   Antes se armaban las 500+ filas de golpe (tarjetas Y tabla) y
   la búsqueda solo las ocultaba con CSS — igual quedaban todas en
   el DOM. Ahora solo se pintan de a PAGE_SIZE, y se agregan más
   automáticamente cuando el usuario llega cerca del final. La
   búsqueda sigue operando sobre TODO productsCache (ya está en
   memoria, no hace falta volver a pedirle nada a Firebase), pero
   el renderizado de los resultados también se pagina igual. */
const STOCK_PAGE_SIZE = 20;
let stockRenderLimit = STOCK_PAGE_SIZE;
let stockScrollObserver = null;

// Minúsculas, sin tildes ni signos raros: «Cajón» y «cajon» son lo mismo.
function normalizarBusqueda(t) {
  return String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9\/.\-\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
function getFilteredProducts() { return ordenarProductos(filtrarProductos()); }
function filtrarProductos() {
  const q = (document.getElementById('searchInput')?.value || '').trim();
  const origen = document.getElementById('origenFilter')?.value || '';
  const porOrigen = p => !origen || (origen === 'sin' ? !p.tipo : p.tipo === origen);
  const base = productosEnVista();
  if (!q) return origen ? base.filter(porOrigen) : base;
  const palabras = normalizarBusqueda(q).split(' ').filter(Boolean);
  return base.filter(p => {
    if (!porOrigen(p)) return false;
    // displayProductCode() vuelve a convertir "⁄" en "/" antes de comparar: si no, buscar "1/2" nunca
    // encontraría un producto guardado internamente como "1⁄2" (el usuario solo ve y escribe "/").
    // Se busca en código, nombre, descripción y categoría; las palabras pueden ir en cualquier orden.
    const texto = normalizarBusqueda(`${displayProductCode(p.code || '')} ${p.name || ''} ${p.desc || ''} ${p.category || ''}`);
    return palabras.every(w => texto.includes(w));
  });
}


// ---------------------------------------------------------
// Filtrar y ordenar (un solo botón en el teléfono): origen + orden de la lista. El selector de origen del escritorio sigue siendo el mismo.
// ---------------------------------------------------------
let stockOrden = 'codigo';
const STOCK_ORDENES = [['codigo', 'Código'], ['nombre', 'Nombre A–Z'], ['stock-asc', 'Stock: menos primero'], ['stock-desc', 'Stock: más primero'], ['reciente', 'Más recientes']];
const STOCK_ORIGENES = [['', 'Todos'], ['nacional', 'Nacional'], ['importado', 'Importado'], ['sin', 'Sin clasificar']];

function ordenarProductos(lista) {
  if (stockOrden === 'codigo') return lista;
  const nom = p => String(p.name || ''), porNombre = (a, b) => nom(a).localeCompare(nom(b), 'es', { sensitivity: 'base' }), c = lista.slice();
  if (stockOrden === 'nombre') return c.sort(porNombre);
  if (stockOrden === 'stock-asc') return c.sort((a, b) => getDisplayStock(a) - getDisplayStock(b) || porNombre(a, b));
  if (stockOrden === 'stock-desc') return c.sort((a, b) => getDisplayStock(b) - getDisplayStock(a) || porNombre(a, b));
  if (stockOrden === 'reciente') return c.sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
  return lista;
}
function marcarFiltroStock() {   // punto rojo en el botón cuando hay un filtro u orden distinto del normal
  const b = document.getElementById('btnFiltrosStock'); if (!b) return;
  b.classList.toggle('activo', !!(document.getElementById('origenFilter')?.value) || stockOrden !== 'codigo');
}
function abrirFiltrosStock() {
  document.getElementById('filtrosStockOv')?.remove();
  const ov = document.createElement('div'); ov.id = 'filtrosStockOv'; ov.className = 'nm-hoja fs-hoja';
  const origenActual = () => document.getElementById('origenFilter')?.value || '';
  const chips = (grupo, lista, actual) => lista.map(([v, t]) => `<button type="button" class="fs-chip${v === actual ? ' on' : ''}" data-grupo="${grupo}" data-v="${v}" aria-pressed="${v === actual}">${t}</button>`).join('');
  const pintar = () => {
    ov.innerHTML = `<div class="nm-hoja-fondo" data-x="listo"></div><div class="nm-hoja-caja" role="dialog" aria-modal="true" aria-label="Filtrar y ordenar">
      <div class="nm-hoja-asa" aria-hidden="true"></div>
      <div class="fs-cab"><strong>Filtrar y ordenar</strong><button type="button" class="nm-link" data-x="limpiar">Limpiar</button></div>
      <p class="fs-tit">Origen</p><div class="fs-chips">${chips('origen', STOCK_ORIGENES, origenActual())}</div>
      <p class="fs-tit">Ordenar por</p><div class="fs-chips">${chips('orden', STOCK_ORDENES, stockOrden)}</div>
      ${_verCosto() ? `<p class="fs-tit">Herramientas</p><button type="button" class="nm-hoja-item" data-x="nombres"><span>Ordenar nombres y descripciones</span></button>` : ''}
      <button type="button" class="btn btn-primary fs-ok" data-x="listo">Ver ${getFilteredProducts().length} producto(s)</button></div>`;
  };
  const cerrar = () => { document.removeEventListener('keydown', tecla); ov.remove(); };
  const tecla = e => { if (e.key === 'Escape') cerrar(); };
  ov.onclick = e => {
    const chip = e.target.closest('.fs-chip'), x = e.target.dataset && e.target.dataset.x;
    if (chip) {
      if (chip.dataset.grupo === 'origen') { const sel = document.getElementById('origenFilter'); if (sel) sel.value = chip.dataset.v; } else stockOrden = chip.dataset.v;
      filterStock(); marcarFiltroStock(); pintar();
    } else if (x === 'limpiar') { const sel = document.getElementById('origenFilter'); if (sel) sel.value = ''; stockOrden = 'codigo'; filterStock(); marcarFiltroStock(); pintar(); }
    else if (x === 'nombres') { cerrar(); abrirOrdenarNombres(); }
    else if (x === 'listo') cerrar();
  };
  document.addEventListener('keydown', tecla);
  pintar(); document.body.appendChild(ov); ov.hidden = false;
  requestAnimationFrame ? requestAnimationFrame(() => ov.classList.add('abierta')) : ov.classList.add('abierta');
}

// ---------------------------------------------------------
// Ordenar nombres: deja el NOMBRE como marca (ATEMPO, DADDARIO…) y el detalle en la DESCRIPCIÓN, en los productos que ya estaban guardados.
// Solo toca los que se pueden arreglar con seguridad; los que ya tienen otra descripción se dejan para revisarlos a mano.
// ---------------------------------------------------------
function proponerOrdenNombres(lista) {
  const CI = window.ComprasImport, cambios = [];
  let aRevisar = 0;
  if (!CI || !CI.separarMarca) return { cambios, aRevisar };
  const prods = {}; (lista || []).forEach(p => { prods[p.code] = p; });
  const marcas = CI.marcasConocidas(prods), U = x => String(x || '').trim().replace(/\s+/g, ' ').toUpperCase();
  (lista || []).forEach(p => {
    if (!p || p.deleted || !p.name) return;
    const desc = String(p.desc || '').trim();
    const sepNombre = CI.separarMarca(p.name, marcas);
    if (sepNombre && sepNombre.desc && U(sepNombre.nombre) !== U(p.name)) {             // «CAJON MIXTO ENLADRILLADO ATEMPO» como nombre
      if (desc && U(desc) !== U(p.name)) { aRevisar++; return; }                         // ya tiene otra descripción: a mano
      cambios.push({ code: p.code, nombre: p.name, desc, nuevoNombre: sepNombre.nombre, nuevaDesc: sepNombre.desc });
      return;
    }
    const sepDesc = desc ? CI.separarMarca(desc, marcas) : null;                         // nombre = detalle y la marca solo está en la descripción
    if (sepDesc && sepDesc.desc && U(sepDesc.desc) && U(desc).includes(U(p.name)) && U(p.name) !== U(sepDesc.nombre)) {
      cambios.push({ code: p.code, nombre: p.name, desc, nuevoNombre: sepDesc.nombre, nuevaDesc: sepDesc.desc });
    }
  });
  return { cambios, aRevisar };
}

function abrirOrdenarNombres() {
  const { cambios, aRevisar } = proponerOrdenNombres(productsCache);
  document.getElementById('ordenarNombresOv')?.remove();
  const ov = document.createElement('div'); ov.id = 'ordenarNombresOv'; ov.className = 'foto-ed-ov';
  const nota = aRevisar ? `<p class="bal-note">${aRevisar} producto(s) ya tienen otra descripción y no se tocan: revisalos a mano.</p>` : '';
  ov.innerHTML = `<div class="foto-ed" role="dialog" aria-modal="true" style="width:min(720px,100%)">
    <div class="foto-ed-top"><strong>Ordenar nombres y descripciones</strong><span>El nombre queda como la marca y el detalle pasa a la descripción. Desmarcá lo que no quieras cambiar.</span></div>
    ${cambios.length ? `<div class="on-lista" style="display:flex;flex-direction:column;gap:8px;max-height:50vh;overflow:auto">${cambios.map((c, i) => `<label class="on-item" style="display:flex;gap:10px;align-items:flex-start;border:1px solid var(--border);border-radius:10px;padding:8px 10px">
        <input type="checkbox" data-i="${i}" checked style="margin-top:4px"><span style="font-size:12.5px;line-height:1.4"><b>${escapeHtml(c.code)}</b><br><span style="color:var(--text-3)">Antes:</span> ${escapeHtml(c.nombre)}${c.desc ? ' · ' + escapeHtml(c.desc) : ''}<br><span style="color:#14403a;font-weight:600">Después:</span> <b>${escapeHtml(c.nuevoNombre)}</b> · ${escapeHtml(c.nuevaDesc)}</span></label>`).join('')}</div>` : '<p class="bal-note">No hay productos para ordenar: todos tienen ya la marca como nombre, o no se reconoció ninguna marca repetida.</p>'}
    ${nota}<div class="on-msg fg-msg"></div>
    <div class="foto-ed-acc"><button type="button" class="btn" data-x="cerrar">Cerrar</button>${cambios.length ? `<button type="button" class="btn btn-primary" data-x="aplicar">Aplicar cambios</button>` : ''}</div></div>`;
  document.body.appendChild(ov);
  ov.onclick = async e => {
    const x = e.target.dataset && e.target.dataset.x;
    if (x === 'cerrar' || e.target === ov) return ov.remove();
    if (x !== 'aplicar') return;
    const marcados = [...ov.querySelectorAll('input[type=checkbox]:checked')].map(i => cambios[Number(i.dataset.i)]);
    if (!marcados.length) return;
    ov.querySelector('.on-msg').textContent = 'Guardando…';
    try {
      for (const c of marcados) await refProducts.child(c.code).update({ name: c.nuevoNombre, desc: c.nuevaDesc, updatedAt: firebase.database.ServerValue.TIMESTAMP });
      if (typeof refreshProductsNow === 'function') await refreshProductsNow();
      ov.remove(); alert(`Listo: ${marcados.length} producto(s) ordenados.`);
    } catch (err) { ov.querySelector('.on-msg').textContent = ''; alert('No se pudo guardar: ' + err.message); }
  };
}

function origenTagHtml(p) {
  const t = p.tipo === 'importado' ? ['Importado', 'origen-imp'] : p.tipo === 'nacional' ? ['Nacional', 'origen-nac'] : ['Sin clasificar', 'origen-sin'];
  return `<span class="origen-mini ${t[1]}"><i></i>${t[0]}</span>`;
}
function precioHtml(price) { return Number(price) > 0 ? `S/ ${fmtPrice(price)}` : '<span class="pt-noprice">Sin precio</span>'; }

const ICON_EDIT = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
const ICON_DEL = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>';

function deleteProductRow(code) {
  if (!confirm(`¿Eliminar el producto ${displayProductCode(code)}? Esta acción no se puede deshacer.`)) return;
  deleteProduct(code).catch(err => alert('No se pudo eliminar el producto: ' + err.message));
}

function productCardHtml(p) {
  const code = p.code || '';
  const name = p.name || '';
  const category = p.category || '';
  const stock = getDisplayStock(p);
  const price = p.price !== undefined ? p.price : 0;
  const desc = p.desc || '';
  const stockClass = stock <= 6 ? 'stock-low' : 'stock-ok';
  const escapedName = escapeJsAttr(name);
  const escapedCode = escapeJsAttr(code);
  const escapedCat  = escapeJsAttr(category);
  const isChecked = (typeof selectedStockCodes !== 'undefined' && selectedStockCodes.has(code)) ? 'checked' : '';
  const editOnclick = currentWarehouse
    ? `openEditWarehouseQty('${escapedCode}','${escapedName}',${stock})`
    : `openEditStock('${escapedCode}','${escapedName}','${stock}','${price}','${escapedCat}','${escapeJsAttr(desc)}')`;
  const estado = stock <= 0 ? ['out', 'Sin stock'] : stock <= 6 ? ['low', 'Stock bajo'] : ['ok', 'Disponible'];
  return `
    <div class="product-card${isChecked ? ' selected' : ''}" data-code="${escapeHtml(code)}">
      <div class="pc-top">
        <div class="pc-check-wrap">
          <input type="checkbox" class="row-checkbox stock-check-card" data-code="${escapeHtml(code)}" ${isChecked}
            onchange="onStockCheckToggle(this)" onclick="event.stopPropagation()">
        </div>
        <div class="pc-code-wrap">
          <span class="pc-code">${escapeHtml(displayProductCode(code))}</span>
          ${origenTagHtml(p)}
        </div>
        <span class="pc-estado ${estado[0]}"><i></i>${estado[1]}</span>
        <div class="pc-mas-wrap">
          <button class="btn-icon-edit pc-mas" type="button" title="Más acciones" aria-label="Más acciones" aria-haspopup="menu" aria-expanded="false" onclick="togglePcMenu(event, this)">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>
          </button>
          <div class="pc-menu" role="menu" hidden>
            <button type="button" role="menuitem" onclick="closePcMenus(); ${editOnclick}">Editar</button>
            ${_verCosto() ? `<button type="button" role="menuitem" class="pc-menu-del" onclick="closePcMenus(); deleteProductRow('${escapedCode}')">Eliminar</button>` : ''}
          </div>
        </div>
      </div>
      <div class="pc-mid">
        <div class="pc-name-wrap">
          <span class="pc-name">${escapeHtml(name)}</span>${desc ? `<span class="pc-desc">${escapeHtml(desc)}</span>` : ''}
        </div>
      </div>
      <div class="pc-bot">
        <div class="pc-bot-item">
          <span class="pc-lbl">Stock</span>
          <span class="pc-qty ${stockClass}${stock <= 0 ? ' stock-out' : ''}">${stock}</span>
        </div>
        <div class="pc-bot-item">
          <span class="pc-lbl">Venta</span>
          <span class="pc-price">${precioHtml(price)}</span>
        </div>
        ${costoDe(p) ? `<div class="pc-bot-item"><span class="pc-lbl">Costo</span><span class="pc-price">S/ ${costoDe(p).toFixed(2)}</span></div>` : ''}
      </div>
    </div>
  `;
}

// Menú «⋯» de la tarjeta (Editar / Eliminar): se cierra al tocar fuera o al elegir una opción.
function closePcMenus() {
  document.querySelectorAll('.pc-menu:not([hidden])').forEach(m => { m.hidden = true; const b = m.previousElementSibling; if (b) b.setAttribute('aria-expanded', 'false'); });
}
function togglePcMenu(e, btn) {
  e.stopPropagation();
  const menu = btn.nextElementSibling, abrir = menu.hidden;
  closePcMenus();
  if (abrir) { menu.hidden = false; btn.setAttribute('aria-expanded', 'true'); }
}
if (!window._pcMenuListo) { window._pcMenuListo = true; document.addEventListener('click', e => { if (!e.target.closest('.pc-mas-wrap')) closePcMenus(); }); }

function productRowHtml(p) {
  const code = p.code || '';
  const name = p.name || '';
  const category = p.category || '';
  const stock = getDisplayStock(p);
  const price = p.price !== undefined ? p.price : 0;
  const desc = p.desc || '';
  const stockClass = stock <= 6 ? 'stock-low' : 'stock-ok';
  const escapedName = escapeJsAttr(name);
  const escapedCode = escapeJsAttr(code);
  const escapedCat  = escapeJsAttr(category);
  const isChecked = (typeof selectedStockCodes !== 'undefined' && selectedStockCodes.has(code)) ? 'checked' : '';
  const showCheckbox = typeof currentUserRole !== 'undefined' && currentUserRole !== 'vendedor';
  const editOnclick = currentWarehouse
    ? `openEditWarehouseQty('${escapedCode}','${escapedName}',${stock})`
    : `openEditStock('${escapedCode}','${escapedName}','${stock}','${price}','${escapedCat}','${escapeJsAttr(desc)}')`;
  return `
    <tr data-code="${escapeHtml(code)}" class="${isChecked ? 'row-selected' : ''}">
      ${showCheckbox ? `<td class="col-check"><input type="checkbox" class="row-checkbox stock-check" data-code="${escapeHtml(code)}" ${isChecked} onchange="onStockCheckToggle(this)"></td>` : ''}
      <td class="pt-code">${escapeHtml(displayProductCode(code))}${origenTagHtml(p)}</td>
      <td class="pt-name">${escapeHtml(name)}</td>
      <td class="pt-desc">${desc ? escapeHtml(desc) : '<span class="pt-desc-empty">—</span>'}</td>
      <td class="pt-qty ${stockClass}">${stock}</td>
      <td class="pt-price">${precioHtml(price)}</td>
      <td class="pt-cost">${costoHtml(p)}</td>
      <td class="pt-actions">
        <button class="btn btn-ghost btn-sm stock-edit-btn" title="Editar" aria-label="Editar"
          onclick="${editOnclick}">${ICON_EDIT}</button>
        ${_verCosto() ? `<button class="btn btn-ghost btn-sm stock-del-btn" title="Eliminar" aria-label="Eliminar"
          onclick="deleteProductRow('${escapedCode}')">${ICON_DEL}</button>` : ''}
      </td>
    </tr>
  `;
}

/* Vuelve a armar la página visible (0..stockRenderLimit) a partir
   del catálogo ya filtrado. Se usa tanto al cargar/cambiar datos
   como al tipear en el buscador y al llegar al final del scroll. */
function renderStockPage() {
  const list  = document.getElementById('productList');
  const tbody = document.getElementById('productTableBody');
  if (!list && !tbody) return; // la vista de Stock no está montada ahora mismo

  const filtered = getFilteredProducts();
  const page = filtered.slice(0, stockRenderLimit);

  if (list) {
    list.innerHTML = page.map(productCardHtml).join('');
    if (currentUserRole !== 'vendedor') {
      list.querySelectorAll('.product-card').forEach(card => wireSelectableRow(card, stockSelection, onStockCheckToggle));
    }
  }
  if (tbody) {
    tbody.innerHTML = page.map(productRowHtml).join('');
    if (currentUserRole !== 'vendedor') {
      tbody.querySelectorAll('tr[data-code]').forEach(row => wireSelectableRow(row, stockSelection, onStockCheckToggle));
    }
  }

  const emptyState = document.getElementById('emptyState');
  if (emptyState) emptyState.style.display = filtered.length === 0 ? 'block' : 'none';

  const footerInfo = document.getElementById('footerInfo');
  if (footerInfo) {
    footerInfo.textContent = filtered.length > page.length
      ? `Mostrando ${page.length} de ${filtered.length} productos — bajá para ver más`
      : `${filtered.length} producto${filtered.length !== 1 ? 's' : ''}`;
  }

  setupStockInfiniteScroll(filtered.length);
  if (typeof updateBulkStock === 'function') updateBulkStock();
}

/* Observa un "centinela" al final de la lista/tabla; cuando entra
   en pantalla, se cargan 20 productos más (sin volver a pedirle
   nada a Firebase — ya están todos en productsCache). */
function setupStockInfiniteScroll(totalFiltered) {
  if (stockScrollObserver) { stockScrollObserver.disconnect(); stockScrollObserver = null; }
  if (stockRenderLimit >= totalFiltered) return; // ya está todo cargado

  // Ambas vistas (cards para mobile, tabla para desktop) están
  // siempre en el DOM — CSS solo oculta la que no corresponde según
  // el ancho de pantalla. Si se elegía la tabla sin fijarse si está
  // oculta, el centinela quedaba dentro de un elemento display:none
  // y el IntersectionObserver nunca disparaba en modo teléfono, por
  // lo que el scroll infinito se quedaba trabado en los primeros 20.
  const tbody = document.getElementById('productTableBody');
  const list  = document.getElementById('productList');
  const isVisible = (el) => !!el && el.offsetParent !== null;
  const anchor = isVisible(tbody) ? tbody : (isVisible(list) ? list : (tbody || list));
  if (!anchor) return;

  const sentinel = document.createElement('div');
  sentinel.id = 'stockScrollSentinel';
  sentinel.style.height = '1px';
  if (anchor.tagName === 'TBODY') {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 8;
    td.appendChild(sentinel);
    tr.appendChild(td);
    anchor.appendChild(tr);
  } else {
    anchor.appendChild(sentinel);
  }

  stockScrollObserver = new IntersectionObserver(entries => {
    if (entries[0].isIntersecting) {
      stockRenderLimit += STOCK_PAGE_SIZE;
      renderStockPage();
    }
  }, { root: anchor.closest('.page-content'), rootMargin: '400px' });
  stockScrollObserver.observe(sentinel);
}

/* ── Render: lista de cards ── */
function renderProducts() {
  stockRenderLimit = STOCK_PAGE_SIZE; // el catálogo cambió (Firebase) — se vuelve a empezar desde la primera página
  renderStockPage();
  updateStats();
}

/* ── Stats ── */
function updateStats() {
  const statTotal = document.getElementById('statTotal');
  if (!statTotal) return; // la vista de Stock no está montada ahora mismo
  const base  = productosEnVista();
  const total = base.length;
  const low   = base.filter(p => getDisplayStock(p) <= 6).length;
  // Valor del inventario = lo que costó (costo de compra promedio × cantidad). Solo el admin conoce los costos.
  const conCosto = p => costoDe(p) > 0;
  const value = base.reduce((sum, p) => sum + costoDe(p) * getDisplayStock(p), 0);
  const sinCosto = base.filter(p => getDisplayStock(p) > 0 && !conCosto(p)).length;
  document.getElementById('statTotal').textContent = total;
  document.getElementById('statLow').textContent   = low;
  const sv = document.getElementById('statValue');
  sv.textContent = `S/ ${value.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  sv.title = sinCosto ? `${sinCosto} producto(s) con stock no tienen costo de compra registrado y no suman.` : '';
}

/* ── Firebase listener ── */
// Espera a que auth-guard.js confirme la sesión antes de conectarse
// a Firebase — evita una condición de carrera con las Reglas que
// exigen auth != null.
authReady.then(() => {
  watchProducts(list => {
    productsCache = list.sort((a, b) => (a.code || '').localeCompare(b.code || ''));
    renderProducts();
    // Una vez por sesión (solo admin): deja el reparto por almacén cuadrando con el total, sin tocar el stock total.
    if (!window._almRepararHecho && typeof isAdmin === 'function' && isAdmin() && typeof repararAlmacenes === 'function') {
      window._almRepararHecho = true;
      repararAlmacenes(productsCache).then(n => { if (n) console.info('[Almacenes] Reparto corregido en', n, 'producto(s).'); });
    }
    // Aviso a otras vistas abiertas (ej. Nueva Nota) de que el stock
    // real acaba de cambiar, para que puedan refrescar sus propios
    // límites en vivo en vez de quedarse con el stock que había al
    // momento de agregar el producto al carrito.
    if (typeof window.onProductsCacheUpdated === 'function') window.onProductsCacheUpdated();
  });
});

/* ── Modales ── */
function openModal(id) {
  document.getElementById(id).classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  document.body.style.overflow = '';
}
function outsideClose(e, id) {
  if (e.target === document.getElementById(id)) closeModal(id);
}

/* ── Editar ── */
let editingCode = '';
let editingCostoOriginal = 0;

function openEditStock(code, name, stock, price, cat, desc) {
  editingCode = code; // clave real de Firebase (con "⁄" si el código lleva "/")
  document.getElementById('editModalTitle').textContent = name;
  // Se muestra siempre con "/" real, nunca con "⁄": si no se
  // convierte aquí, el campo editable queda con el mismo caracter
  // que el usuario ya considera "roto", y al volver a escribir "/"
  // el resultado normalizado se ve idéntico a lo que había antes.
  document.getElementById('editModalCode').textContent  = displayProductCode(code);
  document.getElementById('editCode').value  = displayProductCode(code);
  document.getElementById('editName').value  = name;
  document.getElementById('editStock').value = stock;
  document.getElementById('editPrice').value = price;
  const descEl = document.getElementById('editDesc');
  if (descEl) descEl.value = desc || '';
  const prod = productsCache.find(p => p.code === code) || {};
  const tipoEl = document.getElementById('editTipo');
  if (tipoEl) tipoEl.value = prod.tipo || '';
  // Almacén donde está el producto (el que tenga más cantidad)
  const almEl = document.getElementById('editAlm');
  if (almEl) {
    const n = normalizarAlmacenes(prod);
    almEl.value = ['alm1', 'alm2', 'alm3'].reduce((a, b) => n[b] > n[a] ? b : a, 'alm1');
    almEl.dataset.orig = almEl.value;
  }
  editingCostoOriginal = Math.round((costoDe(prod) || 0) * 100) / 100;
  const costEl = document.getElementById('editCost');
  if (costEl) costEl.value = editingCostoOriginal || '';
  openModal('editModal');
}

function saveStock() {
  const name  = document.getElementById('editName').value.trim();
  const stock = parseInt(document.getElementById('editStock').value)   || 0;
  const price = parseFloat(document.getElementById('editPrice').value) || 0;
  const descEl = document.getElementById('editDesc');
  const desc  = descEl ? descEl.value.trim() : '';
  // El campo Código pasa por el mismo normalizeProductCode que "Agregar",
  // así que también acepta "/" (se guarda como ⁄, la clave de Firebase
  // real no admite "/" literal, pero se ve igual en pantalla).
  const newCode = normalizeProductCode(document.getElementById('editCode').value);
  const tipoSel = (document.getElementById('editTipo') || {}).value || '';

  const costEl = document.getElementById('editCost');
  const costo = costEl ? parseFloat(costEl.value) : NaN;
  const costoCambio = costEl && costEl.value !== '' && !isNaN(costo) && costo >= 0 && Math.round(costo * 100) / 100 !== editingCostoOriginal;

  if (!name) return alert('El nombre no puede estar vacío.');
  if (!newCode) return alert('El código no puede estar vacío.');
  if (!tipoSel) return alert('Elige el origen: Nacional o Importado.');

  const codeChanged = newCode !== editingCode;
  if (codeChanged && productsCache.some(p => p.code === newCode)) {
    return alert(`Ya existe un producto con el código ${newCode}.`);
  }

  const existing = productsCache.find(p => p.code === editingCode) || {};
  const finalCode = codeChanged ? newCode : editingCode;

  const doSave = () => saveProduct(finalCode, {
    name,
    desc,
    price,
    stock,
    category: existing.category || 'general',
    tipo: tipoSel,
    ...(costoCambio ? { costoCompra: Math.round(costo * 10000) / 10000 } : {})
  }, existing.stock);

  const almEl = document.getElementById('editAlm');
  const almNuevo = almEl ? almEl.value : '';
  const almCambio = !!almEl && almNuevo !== almEl.dataset.orig;

  let chain = codeChanged
    ? renameProductCode(editingCode, newCode).then(doSave)
    : doSave();

  // Si cambió el almacén, todo el stock del producto pasa al almacén elegido
  if (almCambio) {
    chain = chain.then(() => refProducts.child(finalCode).update({
      almacenes: repartoInicial(stock, almNuevo),
      updatedAt: firebase.database.ServerValue.TIMESTAMP
    }));
  }

  chain
    .then(() => {
      editingCode = finalCode;
      closeModal('editModal');
    })
    .catch(err => alert('Error al guardar: ' + err.message));
}

function deleteCurrentProduct() {
  if (!editingCode) return;
  if (!confirm(`¿Eliminar el producto ${editingCode}? Esta acción no se puede deshacer.`)) return;
  deleteProduct(editingCode)
    .then(() => closeModal('editModal'))
    .catch(err => alert('No se pudo eliminar el producto: ' + err.message));
}

/* ── Editar cantidad de UN almacén ── */
let editingWarehouseCode = '';
let editingWarehouseQtyBefore = 0;

function openEditWarehouseQty(code, name, qty) {
  editingWarehouseCode = code;
  editingWarehouseQtyBefore = qty;
  document.getElementById('whQtyModalTitle').textContent = name;
  document.getElementById('whQtyModalWarehouse').textContent = WAREHOUSE_LABELS[currentWarehouse] || '';
  document.getElementById('whQtyInput').value = qty;
  openModal('warehouseQtyModal');
}

function saveWarehouseQty() {
  const newQty = parseInt(document.getElementById('whQtyInput').value) || 0;
  updateWarehouseStock(editingWarehouseCode, currentWarehouse, newQty, editingWarehouseQtyBefore)
    .then(() => closeModal('warehouseQtyModal'))
    .catch(err => alert('Error al guardar: ' + err.message));
}

/* ── Importar / exportar cantidad de UN almacén ── */
async function loadXlsxLib() {
  await new Promise((resolve, reject) => {
    if (window.XLSX) { resolve(); return; }
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

function openWarehouseImport() {
  if (!currentWarehouse) return;
  const title = document.getElementById('whImportModalTitle');
  if (title) title.textContent = `Importar cantidad — ${WAREHOUSE_LABELS[currentWarehouse]}`;
  const fi = document.getElementById('warehouseImportFile');
  if (fi) fi.value = '';
  const progress = document.getElementById('warehouseImportProgress');
  if (progress) progress.style.display = 'none';
  openModal('warehouseImportModal');
}

async function downloadWarehouseTemplate() {
  await loadXlsxLib();
  const data = [['Codigo', 'Cantidad'], ['PRD-001', 10]];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{ wch: 12 }, { wch: 10 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Datos');
  XLSX.writeFile(wb, `plantilla-cantidad-${currentWarehouse || 'almacen'}.xlsx`);
}

async function onWarehouseImportFile(input) {
  const whId = currentWarehouse;
  const file = input.files[0];
  if (!file || !whId) return;
  await loadXlsxLib();

  const progress = document.getElementById('warehouseImportProgress');
  if (progress) { progress.style.display = ''; progress.textContent = 'Leyendo archivo…'; }

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const wb = XLSX.read(e.target.result, { type: 'binary' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
      const dataRows = rows.filter((r, i) => i > 0 && String(r[0] || '').trim().length > 0);

      if (dataRows.length === 0) {
        if (progress) progress.textContent = 'El archivo no tiene registros válidos.';
        input.value = '';
        return;
      }

      let ok = 0, notFound = 0, failed = 0;
      const notFoundCodes = [];
      for (let i = 0; i < dataRows.length; i++) {
        const r = dataRows[i];
        if (progress) progress.textContent = `Procesando ${i + 1} de ${dataRows.length}…`;
        const code = normalizeProductCode(String(r[0] || ''));
        const qty = parseInt(r[1]) || 0;
        const exists = productsCache.some(p => p.code === code);
        if (!exists) { notFound++; notFoundCodes.push(code); continue; }
        try {
          await addWarehouseStock(code, whId, qty);
          ok++;
        } catch (err) {
          failed++;
        }
      }

      let msg = `${ok} producto(s) actualizado(s) en ${WAREHOUSE_LABELS[whId]}.`;
      if (notFound > 0) msg += ` ${notFound} código(s) no encontrado(s) (${notFoundCodes.slice(0, 5).join(', ')}${notFoundCodes.length > 5 ? '…' : ''}) — este modo solo actualiza productos que ya existen.`;
      if (failed > 0) msg += ` ${failed} con error.`;

      if (progress) progress.textContent = msg;
      input.value = '';
      if (typeof refreshProductsNow === 'function') {
        refreshProductsNow().catch(err => console.error('[Importar almacén] No se pudo refrescar el stock:', err));
      }
    } catch (err) {
      if (progress) progress.textContent = 'No se pudo leer el archivo: ' + err.message;
      input.value = '';
    }
  };
  reader.readAsBinaryString(file);
}

async function exportWarehouseStock() {
  const whId = currentWarehouse;
  if (!whId) return;
  const label = WAREHOUSE_LABELS[whId] || whId;
  const rows = getFilteredProducts();

  await loadXlsxLib();

  const data = [
    ['Código', 'Nombre', 'Cantidad'],
    ...rows.map(p => [displayProductCode(p.code), sanitizeForExcel(p.name), getDisplayStock(p)])
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{ wch: 12 }, { wch: 34 }, { wch: 10 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, label);
  const today = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `stock-${whId}-${today}.xlsx`);
}

/* ── Agregar ── */
function addProduct() {
  const name  = document.getElementById('addName').value.trim();
  const code  = normalizeProductCode(document.getElementById('addCode').value);
  const stock = parseInt(document.getElementById('addStock').value)   || 0;
  const price = parseFloat(document.getElementById('addPrice').value) || 0;
  const descEl = document.getElementById('addDesc');
  const desc  = descEl ? descEl.value.trim() : '';

  const tipoAdd = (document.getElementById('addTipo') || {}).value || '';
  if (!name || !code) return alert('Completa nombre y código.');
  if (!tipoAdd) return alert('Elige si el producto es Nacional o Importado.');
  if (productsCache.some(p => p.code === code))
    return alert(`Ya existe un producto con el código ${code}.`);

  const almAdd = (document.getElementById('addAlm') || {}).value || currentWarehouse || 'alm1';
  saveProduct(code, { name, desc, price, stock, category: 'general', tipo: tipoAdd, almacenes: repartoInicial(stock, almAdd) }, undefined, true)
    .then(() => {
      closeModal('addModal');
      ['addName','addCode','addDesc','addStock','addPrice'].forEach(id => {
        document.getElementById(id).value = '';
      });
      if (document.getElementById('addTipo')) document.getElementById('addTipo').value = '';
    })
    .catch(err => alert('Error al registrar: ' + err.message));
}

/* ── Filtro búsqueda ── */
function filterStock() {
  stockRenderLimit = STOCK_PAGE_SIZE; // nueva búsqueda: se vuelve a la primera página de resultados
  renderStockPage();
  marcarFiltroStock();
}

/* ── Teclado ── */
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.open')
      .forEach(m => closeModal(m.id));
  }
  // Enter en un campo de texto del modal de Editar o Agregar guarda
  // igual que si se hiciera clic en el botón — antes no pasaba nada
  // porque estos formularios no son un <form> real, así que Enter no
  // tenía ninguna acción por defecto. Se excluyen los <textarea> para
  // no interceptar el Enter que ahí sirve para bajar de línea.
  if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
    const editModal = document.getElementById('editModal');
    const addModal  = document.getElementById('addModal');
    if (editModal && editModal.classList.contains('open') && editModal.contains(e.target)) {
      e.preventDefault();
      saveStock();
    } else if (addModal && addModal.classList.contains('open') && addModal.contains(e.target)) {
      e.preventDefault();
      addProduct();
    }
  }
});

/* ══════════════════════════════════════
   MODO SELECCIÓN, EXPORTAR Y ELIMINAR MASIVO
  ══════════════════════════════════════
   Los checkboxes están ocultos por defecto (ver stock-card.css /
   import.css) y solo aparecen en modo selección, activado desde
   el botón "Seleccionar" o con pulsación larga sobre una fila o
   tarjeta (lógica compartida en selection.js). */

let selectedStockCodes = new Set();

const stockSelection = createSelectionMode({
  containers: ['.product-table', '#productList', '.topbar-actions'],
  buttonId: 'btnSelectMode',
  labelId: 'selectModeLabel',
  onExit: () => {
    selectedStockCodes.clear();
    document.querySelectorAll('.row-checkbox').forEach(cb => { cb.checked = false; });
    const master = document.getElementById('checkAllStock');
    if (master) master.checked = false;
    updateBulkStock();
  }
});

function setSelectionMode(on) { stockSelection.set(on); }
function toggleSelectionMode() { stockSelection.toggle(); }

// Un mismo producto puede tener checkbox en la tabla (desktop) y en la
// tarjeta (mobile) a la vez; al marcar uno se sincroniza el otro.
function onStockCheckToggle(cb) {
  const code = cb.dataset.code;
  const checked = cb.checked;
  if (checked) selectedStockCodes.add(code); else selectedStockCodes.delete(code);
  document.querySelectorAll(`.row-checkbox[data-code="${CSS.escape(code)}"]`).forEach(other => {
    other.checked = checked;
  });
  updateBulkStock();
}

function toggleAllStock(master) {
  const filtered = getFilteredProducts();
  if (master.checked) {
    filtered.forEach(p => selectedStockCodes.add(p.code));
  } else {
    filtered.forEach(p => selectedStockCodes.delete(p.code));
  }
  renderStockPage();
}

// Botón "Seleccionar todo" del bulk-bar (modo selección ya activo).
function selectAllStock() {
  getFilteredProducts().forEach(p => selectedStockCodes.add(p.code));
  const master = document.getElementById('checkAllStock');
  if (master) master.checked = true;
  renderStockPage();
}

function updateBulkStock() {
  document.querySelectorAll('#productTableBody tr[data-code]').forEach(row => {
    row.classList.toggle('row-selected', selectedStockCodes.has(row.dataset.code));
  });
  document.querySelectorAll('.product-card[data-code]').forEach(card => {
    card.classList.toggle('selected', selectedStockCodes.has(card.dataset.code));
  });

  const count = selectedStockCodes.size;
  const bar   = document.getElementById('bulkBarStock');
  if (bar) bar.classList.toggle('visible', count > 0);
  const countEl = document.getElementById('bulkCountStock');
  if (countEl) countEl.textContent = `${count} producto${count !== 1 ? 's' : ''} seleccionado${count !== 1 ? 's' : ''}`;

  // Actualizar label exportar
  const total    = productosEnVista().length;
  const filtered = getFilteredProducts().length;
  const lbl = document.getElementById('exportStockLabel');
  if (lbl) {
    if (count > 0)             lbl.textContent = `Exportar (${count} sel.)`;
    else if (filtered < total) lbl.textContent = `Exportar filtrado (${filtered})`;
    else                       lbl.textContent = `Exportar todo (${total})`;
  }
}

/* ── Eliminar seleccionados / todo ── */
function deleteSelectedStock() {
  const count = selectedStockCodes.size;
  if (count === 0) return;
  if (!confirm(`¿Eliminar ${count} producto${count !== 1 ? 's' : ''}? Esta acción no se puede deshacer.`)) return;
  // allSettled en vez de all: si un código tiene un caracter que
  // Firebase rechaza (dato viejo corrupto), ese producto falla pero
  // NO bloquea el borrado del resto de la selección.
  Promise.allSettled([...selectedStockCodes].map(code => deleteProduct(code).then(() => ({ code }))))
    .then(results => {
      setSelectionMode(false);
      const failed = results.filter(r => r.status === 'rejected');
      if (failed.length > 0) {
        alert(`${count - failed.length} producto(s) eliminado(s). ${failed.length} no se pudo(pudieron) eliminar (código con caracteres inválidos). Edítalo(s) desde el modal para corregir el código y volver a intentar.`);
      }
    });
}

function deleteAllStock() {
  const total = productsCache.length;
  if (total === 0) return;
  if (!confirm(`¿Eliminar TODOS los ${total} productos? Esta acción no se puede deshacer.`)) return;
  if (!confirm('Segunda confirmación: ¿estás seguro? Se borrarán todos los productos del inventario.')) return;
  Promise.allSettled(productsCache.map(p => deleteProduct(p.code)))
    .then(results => {
      setSelectionMode(false);
      const failed = results.filter(r => r.status === 'rejected').length;
      if (failed > 0) {
        alert(`${total - failed} producto(s) eliminado(s). ${failed} no se pudo(pudieron) eliminar (código con caracteres inválidos).`);
      }
    });
}

/* ── Exportar flexible ── */
async function exportStock() {
  let rows; let filename;
  const today = new Date().toISOString().slice(0, 10);

  if (selectedStockCodes.size > 0) {
    rows = productsCache.filter(p => selectedStockCodes.has(p.code));
    filename = `stock-seleccionado-${today}.xlsx`;
  } else {
    const filteredProducts = getFilteredProducts();
    const allVisible = filteredProducts.length === productsCache.length;
    // Solo se pregunta cuando el botón exporta TODO el inventario
    // (sin filtro ni selección activa) — exportar una selección o
    // un filtro ya es una acción intencional y puntual, así que no
    // hace falta confirmarla también.
    if (allVisible && !confirm(`¿Exportar los ${filteredProducts.length} productos a Excel?`)) return;
    rows = filteredProducts;
    filename = allVisible
      ? `stock-completo-${today}.xlsx`
      : `stock-filtrado-${today}.xlsx`;
  }

  // Lazy load SheetJS
  await new Promise((resolve, reject) => {
    if (window.XLSX) { resolve(); return; }
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });

  const data = [
    ['Código', 'Nombre', 'Descripción', 'Cantidad', 'Precio'],
    ...rows.map(p => [displayProductCode(p.code), sanitizeForExcel(p.name), sanitizeForExcel(p.desc || ''), p.stock, p.price])
  ];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = [{ wch: 12 }, { wch: 34 }, { wch: 28 }, { wch: 10 }, { wch: 10 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Stock');
  XLSX.writeFile(wb, filename);
}


// ── Restricciones de rol "vendedor" ─────────────────────
// Antes vivía en un <script> aparte dentro de stock.html. En la
// SPA se movió aquí para poder llamarla desde Stock.init() cada
// vez que se muestra esta vista.
function applyStockRoleRestrictions() {
  if (currentUserRole !== 'vendedor') return;

  const statsRow = document.getElementById('stockStatsRow');
  if (statsRow) statsRow.style.display = 'none';

  const btnImport = document.querySelector('.btn-import');
  if (btnImport) btnImport.style.display = 'none';

  const btnExport = document.getElementById('btnExportStock');
  if (btnExport) btnExport.style.display = 'none';

  const btnSelect = document.getElementById('btnSelectMode');
  if (btnSelect) btnSelect.style.display = 'none';

  const btnAdd = document.querySelector('.btn-new-item');
  if (btnAdd) btnAdd.style.display = 'none';

  // Este estilo se agregaba una sola vez por página en el modelo
  // viejo. En la SPA, si ya existe (de una visita anterior a esta
  // vista), no hace falta agregarlo de nuevo.
  if (!document.getElementById('stockRoleStyle')) {
    const style = document.createElement('style');
    style.id = 'stockRoleStyle';
    // Para vendedor, productRowHtml() nunca agrega la celda de
    // checkbox en el <tbody>. Si dejamos visible el <th class="col-check">
    // del encabezado, la tabla queda con una columna de más y todo el
    // contenido se desplaza una posición (bug reportado). Se oculta
    // también el encabezado para que headers y celdas vuelvan a alinear.
    style.textContent = '.btn-icon-edit, .stock-edit-btn, .product-table .col-check { display: none !important; }';
    document.head.appendChild(style);
  }
}

// ── Punto de entrada que llama el Router cada vez que se
//    muestra esta vista (instantáneo: usa productsCache ya cargado) ──
window.Stock = {
  init() {
    // Al reabrir la vista (o abrirla por primera vez) siempre arranca
    // en "Todos los almacenes" — evita quedar en un almacén filtrado
    // sin que se note al volver de otra pantalla. switchWarehouse ya
    // llama a renderProducts() internamente.
    switchWarehouse('');
    applyStockRoleRestrictions();
    { const bo = document.getElementById('btnOrdenarNombres'); if (bo) bo.style.display = _verCosto() ? '' : 'none'; }
    marcarFiltroStock();
    if (!document.getElementById('stockCostStyle')) { const st = document.createElement('style'); st.id = 'stockCostStyle'; document.head.appendChild(st); }
    document.getElementById('stockCostStyle').textContent = '';   // el costo de compra lo ven todos los usuarios
    cargarCostosStock();
  }
};