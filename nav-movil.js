// =========================================================
// Navegación responsive: barra inferior de 5 pestañas, botón flotante (+) con menú y campana de avisos.
// Móvil y tablet (hasta 1280 px): la barra inferior reemplaza al menú lateral. Escritorio: el menú lateral sigue y se mantienen el botón (+) y la campana.
// Todo sale de CONFIG (la misma estructura de la especificación): cambiar pestañas, acciones o íconos es editar este objeto.
// Íconos: Lucide (ISC), incrustados para no depender de ningún servidor.
// =========================================================
(function () {
  'use strict';
  const ICONOS = {
      "house": "<path d=\"M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8\" /> <path d=\"M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z\" />",
      "search": "<path d=\"m21 21-4.34-4.34\" /> <circle cx=\"11\" cy=\"11\" r=\"8\" />",
      "package": "<path d=\"M11 21.73a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73z\" /> <path d=\"M12 22V12\" /> <path d=\"m3.3 7 7.703 4.734a2 2 0 0 0 1.994 0L20.7 7\" /> <path d=\"m7.5 4.27 9 5.15\" />",
      "calendar": "<path d=\"M8 2v3\" /> <path d=\"M16 2v3\" /> <rect x=\"3\" y=\"3\" width=\"18\" height=\"18\" rx=\"2\" /> <path d=\"M3 9h18\" />",
      "message-circle": "<path d=\"M2.992 16.342a2 2 0 0 1 .094 1.167l-1.065 3.29a1 1 0 0 0 1.236 1.168l3.413-.998a2 2 0 0 1 1.099.092 10 10 0 1 0-4.777-4.719\" />",
      "user-round": "<circle cx=\"12\" cy=\"8\" r=\"5\" /> <path d=\"M20 21a8 8 0 0 0-16 0\" />",
      "plus": "<path d=\"M5 12h14\" /> <path d=\"M12 5v14\" />",
      "x": "<path d=\"M18 6 6 18\" /> <path d=\"m6 6 12 12\" />",
      "bell": "<path d=\"M10.268 21a2 2 0 0 0 3.464 0\" /> <path d=\"M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326\" />",
      "circle-plus": "<circle cx=\"12\" cy=\"12\" r=\"10\" /> <path d=\"M8 12h8\" /> <path d=\"M12 8v8\" />",
      "heart": "<path d=\"M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5\" />",
      "bookmark": "<path d=\"M17 3a2 2 0 0 1 2 2v15a1 1 0 0 1-1.496.868l-4.512-2.578a2 2 0 0 0-1.984 0l-4.512 2.578A1 1 0 0 1 5 20V5a2 2 0 0 1 2-2z\" />",
      "settings": "<path d=\"M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915\" /> <circle cx=\"12\" cy=\"12\" r=\"3\" />"
  };

  const CONFIG = {
    tabbar: { items: [
      { id: 'tab_1', icon: 'house', label: 'Inicio', page: 'dashboard' },
      { id: 'tab_2', icon: 'package', label: 'Stock', page: 'stock' },
      { id: 'tab_3', icon: 'calendar', label: 'Historial', page: 'historial' },
      { id: 'tab_4', icon: 'message-circle', label: 'Soporte', page: 'soporte' },
      { id: 'tab_5', icon: 'user-round', label: 'Perfil', page: 'perfil' }
    ] },
    fab: { icon: 'plus', openIcon: 'x', items: [
      { id: 'action_1', icon: 'circle-plus', label: 'Nueva nota', page: 'nueva-nota' },
      { id: 'action_2', icon: 'heart', label: 'Catálogo', page: 'catalogo' },
      { id: 'action_3', icon: 'bookmark', label: 'Registrar compra', page: 'compras' },
      { id: 'action_4', icon: 'settings', label: 'Más secciones', accion: 'mas' }
    ] },
    // «Más secciones»: lo que no cabe en la barra. `soloAdmin` se oculta a los vendedores; el ícono se toma del menú lateral.
    mas: [
      { label: 'Agregar producto', accion: 'nuevo-producto', icono: 'circle-plus' },
      { label: 'Notas de Pedido', page: 'pedidos' },
      { label: 'Balance y alertas', page: 'movimientos' },
      { label: 'Registros', page: 'registros', soloAdmin: true },
      { label: 'Configuración', page: 'configuracion' },
      { label: 'Cambiar de cuenta', accion: 'cambiar-cuenta', separador: true, icono: 'user-round' },
      { label: 'Cerrar sesión', accion: 'cerrar-sesion', icono: 'x' }
    ],
    notificaciones: { icon: 'bell', stockMinimo: 6, maximo: 40, clave: 'balanceinv_notif_leidas' }
  };

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const svg = (n, cls) => `<svg class="nm-ico${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONOS[n] || ''}</svg>`;
  // El foco inicial solo se muestra con teclado; con el dedo no aparece un aro sobre el primer ícono.
  let porTeclado = false;
  document.addEventListener('keydown', () => { porTeclado = true; }, true);
  document.addEventListener('pointerdown', () => { porTeclado = false; }, true);
  const esVendedor = () => !!document.querySelector('.role-vendedor');
  const paginaActual = () => (window.Router && window.Router.currentPage) || ($('.nav-item.active[data-page]') || {}).dataset?.page || (location.hash || '').replace('#', '') || 'dashboard';

  function ir(page) {
    cerrarTodo();
    if (window.Router && typeof window.Router.go === 'function') window.Router.go(page);
    else location.hash = '#' + page;
  }

  // ---------------------------------------------------------
  // Avisos (campana): stock bajo, sin stock y subidas de costo. «Leído» se guarda en este dispositivo.
  // ---------------------------------------------------------
  function calcularNotificaciones(productos, opciones) {
    const o = Object.assign({ stockMinimo: CONFIG.notificaciones.stockMinimo }, opciones || {}), out = [];
    (productos || []).forEach(p => {
      if (!p || p.deleted || !p.code) return;
      const nombre = p.name || p.code, stock = Number(p.stock) || 0, minimo = Number(p.stockMin) >= 0 && p.stockMin !== undefined && p.stockMin !== null ? Number(p.stockMin) : o.stockMinimo;
      if (stock <= 0) out.push({ id: `sin:${p.code}`, tipo: 'sin-stock', orden: 0, code: p.code, titulo: `Sin stock: ${nombre}`, detalle: p.desc || p.code });
      else if (stock <= minimo) out.push({ id: `bajo:${p.code}:${stock}`, tipo: 'bajo', orden: 2, code: p.code, titulo: `Stock bajo: ${nombre}`, detalle: `Quedan ${stock} (mínimo ${minimo})` });
      const al = typeof window.alzaCosto === 'function' ? window.alzaCosto(p.costoAnterior, p.costoUltimo) : null;
      if (al) out.push({ id: `alza:${p.code}:${p.costoUltimo}`, tipo: 'alza', orden: 1, code: p.code, titulo: `Subió el costo: ${nombre}`, detalle: `S/ ${al.antes.toFixed(2)} → S/ ${al.ahora.toFixed(2)} (+${al.pct}%)` });
    });
    return out.sort((a, b) => a.orden - b.orden || a.titulo.localeCompare(b.titulo, 'es'));
  }
  const leer = () => { try { return new Set(JSON.parse(localStorage.getItem(CONFIG.notificaciones.clave) || '[]')); } catch (e) { return new Set(); } };
  const guardarLeidas = set => { try { localStorage.setItem(CONFIG.notificaciones.clave, JSON.stringify([...set].slice(-600))); } catch (e) { /* sin almacenamiento: se muestran siempre */ } };
  const fuente = () => (NavMovil.fuente ? NavMovil.fuente() : (typeof productsCache !== 'undefined' ? productsCache : []));
  const listaAvisos = () => calcularNotificaciones(fuente());
  const noLeidas = () => { const l = leer(); return listaAvisos().filter(n => !l.has(n.id)).length; };

  // ---------------------------------------------------------
  // Construcción
  // ---------------------------------------------------------
  let tabbar, fab, fabBtn, fabMenu, fondo, hoja, panel;

  function montarTabbar() {
    if (tabbar) return;
    tabbar = document.createElement('nav'); tabbar.className = 'nm-tabbar'; tabbar.setAttribute('aria-label', 'Navegación principal');
    tabbar.innerHTML = CONFIG.tabbar.items.map(t => `<a class="nm-tab" id="nm_${t.id}" href="#${t.page}" data-page="${t.page}">${svg(t.icon)}<span class="nm-tab-txt">${esc(t.label)}</span></a>`).join('');
    tabbar.addEventListener('click', e => { const a = e.target.closest('.nm-tab'); if (!a) return; e.preventDefault(); ir(a.dataset.page); });
    document.body.appendChild(tabbar);
  }

  function montarFab() {
    if (fab) return;
    fab = document.createElement('div'); fab.className = 'nm-fab'; fab.dataset.abierto = 'false';
    fondo = document.createElement('div'); fondo.className = 'nm-fab-fondo'; fondo.hidden = true;
    fab.innerHTML = `<div class="nm-fab-menu" id="nm_fab_menu" role="menu" aria-label="Acciones rápidas">${CONFIG.fab.items.map(a => `<button type="button" class="nm-fab-item" role="menuitem" data-id="${a.id}" aria-label="${esc(a.label)}" title="${esc(a.label)}">${svg(a.icon)}</button>`).join('')}</div>
      <button type="button" class="nm-fab-btn" aria-haspopup="menu" aria-expanded="false" aria-controls="nm_fab_menu" aria-label="Acciones rápidas"><span class="nm-fab-i nm-fab-mas">${svg(CONFIG.fab.icon)}</span><span class="nm-fab-i nm-fab-x">${svg(CONFIG.fab.openIcon)}</span></button>`;
    fabBtn = $('.nm-fab-btn', fab); fabMenu = $('.nm-fab-menu', fab);
    fabBtn.addEventListener('click', () => alternarFab());
    fabMenu.addEventListener('click', e => {
      const b = e.target.closest('.nm-fab-item'); if (!b) return;
      const a = CONFIG.fab.items.find(x => x.id === b.dataset.id); if (!a) return;
      cerrarFab(); ejecutar(a);
    });
    fondo.addEventListener('click', () => cerrarFab());
    document.body.appendChild(fondo); document.body.appendChild(fab);
  }

  function ejecutar(a) {
    if (a.page) return ir(a.page);
    if (a.accion === 'mas') return abrirHoja();
    if (a.accion === 'nuevo-producto') { ir('stock'); setTimeout(() => { if (typeof window.openModal === 'function' && document.getElementById('addModal')) window.openModal('addModal'); }, 80); return; }
    if (a.accion === 'cambiar-cuenta') { const b = document.getElementById('switchAccountBtn') || $('[data-action="switch-account"]'); if (b) b.click(); return; }
    if (a.accion === 'cerrar-sesion') { const b = document.getElementById('logoutBtn'); if (b) b.click(); }
  }

  function alternarFab(forzar) {
    const abrir = forzar === undefined ? fab.dataset.abierto !== 'true' : forzar;
    if (abrir) { cerrarHoja(); cerrarPanel(); }
    fab.dataset.abierto = abrir ? 'true' : 'false'; fabBtn.setAttribute('aria-expanded', abrir ? 'true' : 'false'); fondo.hidden = !abrir;
    if (abrir && porTeclado) { const p = $('.nm-fab-item', fab); if (p) p.focus({ preventScroll: true }); }
  }
  const cerrarFab = () => { if (fab && fab.dataset.abierto === 'true') alternarFab(false); };

  function montarHoja() {
    if (hoja) return;
    hoja = document.createElement('div'); hoja.className = 'nm-hoja'; hoja.hidden = true;
    hoja.innerHTML = '<div class="nm-hoja-fondo" data-cerrar="1"></div><div class="nm-hoja-caja" role="dialog" aria-modal="true" aria-label="Más secciones"><div class="nm-hoja-asa" aria-hidden="true"></div><div class="nm-hoja-lista"></div></div>';
    hoja.addEventListener('click', e => {
      if (e.target.dataset && e.target.dataset.cerrar) return cerrarHoja();
      const b = e.target.closest('.nm-hoja-item'); if (!b) return;
      const it = CONFIG.mas[Number(b.dataset.i)]; cerrarHoja(); if (it) ejecutar(it);
    });
    document.body.appendChild(hoja);
  }
  function abrirHoja() {
    montarHoja(); cerrarFab(); cerrarPanel();
    const iconoDe = it => { const s = it.page ? $(`.nav-item[data-page="${it.page}"] svg`) : null; return s ? s.outerHTML.replace('<svg', '<svg class="nm-ico"') : svg(it.icono || 'settings'); };
    $('.nm-hoja-lista', hoja).innerHTML = CONFIG.mas.map((it, i) => (it.soloAdmin && esVendedor()) ? '' : `${it.separador ? '<hr class="nm-sep">' : ''}<button type="button" class="nm-hoja-item" data-i="${i}">${iconoDe(it)}<span>${esc(it.label)}</span></button>`).join('');
    hoja.hidden = false; siguienteCuadro(() => hoja.classList.add('abierta'));
    if (porTeclado) { const p = $('.nm-hoja-item', hoja); if (p) p.focus({ preventScroll: true }); }
  }
  function cerrarHoja() { if (!hoja || hoja.hidden) return; hoja.classList.remove('abierta'); hoja.hidden = true; }

  // ---------------------------------------------------------
  // Campana (esquina superior derecha del encabezado; se desplaza con la página)
  // ---------------------------------------------------------
  function montarCampanas() {
    $$('.main .topbar').forEach(tb => {
      if ($('.nm-bell', tb)) return;
      const b = document.createElement('button'); b.type = 'button'; b.className = 'nm-bell'; b.setAttribute('aria-haspopup', 'dialog');
      b.innerHTML = `${svg(CONFIG.notificaciones.icon)}<span class="nm-badge" hidden></span>`;
      b.addEventListener('click', e => { e.stopPropagation(); alternarPanel(b); });
      tb.appendChild(b);
    });
    actualizarCampana();
  }
  function actualizarCampana() {
    const n = noLeidas();
    $$('.nm-bell').forEach(b => {
      const badge = $('.nm-badge', b); badge.hidden = n === 0; badge.textContent = n > 99 ? '99+' : String(n);
      b.setAttribute('aria-label', n ? `Notificaciones: ${n} sin leer` : 'Notificaciones: no hay nada nuevo');
    });
    if (panel && !panel.hidden) pintarPanel();
  }
  function alternarPanel(ancla) {
    if (panel && !panel.hidden) return cerrarPanel();
    cerrarFab(); cerrarHoja();
    if (!panel) {
      panel = document.createElement('div'); panel.className = 'nm-panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Notificaciones'); panel.hidden = true;
      panel.addEventListener('click', e => {
        e.stopPropagation();
        if (e.target.closest('[data-todo]')) { const l = leer(); listaAvisos().forEach(n => l.add(n.id)); guardarLeidas(l); actualizarCampana(); return; }
        const it = e.target.closest('.nm-aviso'); if (!it) return;
        const l = leer(); l.add(it.dataset.id); guardarLeidas(l); cerrarPanel(); actualizarCampana();
        ir('stock'); setTimeout(() => { const s = document.getElementById('searchInput'); if (s) { s.value = it.dataset.code; s.dispatchEvent(new Event('input', { bubbles: true })); } }, 80);
      });
      document.body.appendChild(panel);
    }
    pintarPanel(); panel.hidden = false; panel.classList.add('abierta');
    document.addEventListener('click', fueraPanel, true);
  }
  const fueraPanel = e => { if (panel && !panel.contains(e.target) && !e.target.closest('.nm-bell')) cerrarPanel(); };
  function cerrarPanel() { if (!panel || panel.hidden) return; panel.hidden = true; panel.classList.remove('abierta'); document.removeEventListener('click', fueraPanel, true); }
  function pintarPanel() {
    const l = leer(), todos = listaAvisos(), vistos = todos.slice(0, CONFIG.notificaciones.maximo), sin = todos.filter(n => !l.has(n.id)).length;
    panel.innerHTML = `<div class="nm-panel-top"><strong>Notificaciones</strong>${sin ? '<button type="button" class="nm-link" data-todo="1">Marcar todo como leído</button>' : ''}</div>
      <div class="nm-panel-lista">${vistos.length ? vistos.map(n => `<button type="button" class="nm-aviso nm-${n.tipo}${l.has(n.id) ? ' leido' : ''}" data-id="${esc(n.id)}" data-code="${esc(n.code)}"><span class="nm-punto" aria-hidden="true"></span><span><b>${esc(n.titulo)}</b><small>${esc(n.detalle)}</small></span></button>`).join('') + (todos.length > vistos.length ? `<p class="nm-mas">… y ${todos.length - vistos.length} más en Stock</p>` : '') : '<p class="nm-vacio">No hay avisos: todo el stock está al día.</p>'}</div>`;
  }

  // ---------------------------------------------------------
  // Estado: pestaña activa, ocultar el (+) bajo ventanas abiertas o en la pantalla de notas
  // ---------------------------------------------------------
  function actualizarEstado() {
    const pag = paginaActual();
    $$('.nm-tab').forEach(t => { const on = t.dataset.page === pag; t.classList.toggle('activa', on); if (on) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current'); });
    const modal = !!document.querySelector('.modal-overlay.open, .foto-ed-ov, #ordenarNombresOv, #filtrosStockOv, .ci-modal, #ciModal');
    document.body.classList.toggle('nm-modal', modal);
    document.body.classList.toggle('nm-sin-fab', pag === 'nueva-nota');       // esa pantalla ya tiene su propia barra de acciones abajo
  }
  function cerrarTodo() { cerrarFab(); cerrarHoja(); cerrarPanel(); }

  let pendiente = 0, observador = null, reloj = null;
  const siguienteCuadro = f => (window.requestAnimationFrame ? window.requestAnimationFrame(f) : setTimeout(f, 16));
  function refrescar() { if (pendiente) return; pendiente = siguienteCuadro(() => { pendiente = 0; montarCampanas(); actualizarEstado(); }); }

  function init() {
    if (NavMovil.listo) return;
    NavMovil.listo = true;
    montarTabbar(); montarFab(); montarHoja(); montarCampanas(); actualizarEstado();
    document.addEventListener('keydown', e => { if (e.key === 'Escape') { cerrarTodo(); } });
    window.addEventListener('hashchange', () => { cerrarTodo(); refrescar(); });
    observador = new MutationObserver(refrescar); observador.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    reloj = setInterval(() => { if (document.visibilityState !== 'hidden') actualizarCampana(); }, 4000);
  }
  function detener() { if (observador) observador.disconnect(); if (reloj) clearInterval(reloj); observador = reloj = null; NavMovil.listo = false; }

  const NavMovil = window.NavMovil = { CONFIG, calcularNotificaciones, init, alternarFab, abrirHoja, cerrarTodo, actualizarCampana, actualizarEstado, noLeidas, detener, listo: false, fuente: null };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();