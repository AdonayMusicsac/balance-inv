// =========================================================
// Configuración — preferencias guardadas en ESTE dispositivo
// =========================================================
// Nada de esto se guarda en Firebase: son ajustes de localStorage,
// por lo que cada persona los configura una sola vez por
// dispositivo/navegador. La sección de Administración (reiniciar
// datos de la maqueta, acceso a Registros) sí toca datos reales,
// pero solo se pinta y solo funciona para admin.

const CFG_KEY_DENSITY = 'balanceinv_pref_density';   // 'comoda' | 'compacta'
const CFG_KEY_TEMA    = 'balanceinv_pref_tema';      // 'claro' | 'oscuro'
const CFG_KEY_HOME    = 'balanceinv_pref_home';      // 'dashboard' | 'stock' | 'pedidos' | 'historial'

// ── Tema: index.html ya aplica la clase "theme-dark" al <html> ANTES
// de pintar nada (script bloqueante en el <head>), para evitar el
// destello de tema claro al cargar. Acá solo se necesita poder
// cambiarla en caliente, sin recargar la página.
function setTema(mode) {
  localStorage.setItem(CFG_KEY_TEMA, mode);
  document.documentElement.classList.toggle('theme-dark', mode === 'oscuro');
  renderTemaPills(mode);
}

function renderTemaPills(mode) {
  document.querySelectorAll('#temaPillGroup .cfg-pill').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tema === mode);
  });
}


// ── Densidad de listas: se aplica agregando/quitando una hoja de
// estilos chica en <head>. Se llama una vez al cargar CUALQUIER
// página (no solo Configuración) para que la preferencia se vea
// desde el primer momento, sin tener que visitar esta pantalla.
function applyDensidadPref() {
  const mode = localStorage.getItem(CFG_KEY_DENSITY) || 'comoda';
  let tag = document.getElementById('densityStyleTag');
  if (mode === 'compacta') {
    if (!tag) {
      tag = document.createElement('style');
      tag.id = 'densityStyleTag';
      tag.textContent = `
        .product-table td, .table-wrap td { padding-top: 6px !important; padding-bottom: 6px !important; }
        .stat-card, .hstat { padding: 10px 12px !important; }
        .product-list .product-card { padding: 10px 12px !important; }
      `;
      document.head.appendChild(tag);
    }
  } else if (tag) {
    tag.remove();
  }
  return mode;
}
applyDensidadPref();

function setDensidad(mode) {
  localStorage.setItem(CFG_KEY_DENSITY, mode);
  applyDensidadPref();
  renderDensidadPills(mode);
}

function renderDensidadPills(mode) {
  document.querySelectorAll('#densityPillGroup .cfg-pill').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.density === mode);
  });
}

function setPaginaInicio(page) {
  localStorage.setItem(CFG_KEY_HOME, page);
  const fb = document.getElementById('cfgNavFeedback');
  if (!fb) return;
  fb.style.display = 'block';
  clearTimeout(fb._hideTimer);
  fb._hideTimer = setTimeout(() => { fb.style.display = 'none'; }, 3000);
}

// Leído por Router.start() para decidir la primera pantalla —
// devuelve 'dashboard' si no hay preferencia guardada todavía.
function getPaginaInicioPref() {
  return localStorage.getItem(CFG_KEY_HOME) || 'dashboard';
}

async function reiniciarDatosMaqueta() {
  const ok = confirm(
    'Esto borra productos, clientes, notas de pedido y las cuentas de ' +
    'vendedores registradas en este navegador, y vuelve a crear los ' +
    'datos de ejemplo desde cero. Tu propia sesión de admin se ' +
    'recrea automáticamente. Esta acción no se puede deshacer.\n\n' +
    '¿Reiniciar los datos de la maqueta?'
  );
  if (!ok) return;

  localStorage.removeItem('balanceinv_mock_db_v1');
  window.location.reload();
}

function renderConfiguracion() {
  renderDensidadPills(localStorage.getItem(CFG_KEY_DENSITY) || 'comoda');
  renderTemaPills(localStorage.getItem(CFG_KEY_TEMA) || 'claro');

  const homeSelect = document.getElementById('cfgHomePage');
  if (homeSelect) homeSelect.value = getPaginaInicioPref();

  const modoDatos = document.getElementById('cfgModoDatos');
  if (modoDatos) {
    const esDemo = typeof firebaseConfig !== 'undefined' && firebaseConfig.apiKey === 'PENDIENTE-CONFIGURAR';
    modoDatos.innerHTML = esDemo
      ? 'Demo local <span class="cfg-badge-demo" style="margin-left:5px">Sin servidor</span>'
      : 'Conectado a Firebase';
  }

  const sesionComo = document.getElementById('cfgSesionComo');
  if (sesionComo && typeof currentUserName === 'string') {
    sesionComo.textContent = currentUserName + (typeof isAdmin === 'function' && isAdmin() ? ' (Admin)' : ' (Vendedor)');
  }
}

window.Configuracion = {
  init: function () {
    renderConfiguracion();
    if (typeof initConfigCatalogo === 'function') initConfigCatalogo();
  }
};
