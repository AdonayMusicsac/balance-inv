// =========================================================
// Perfil — cuenta del usuario que tiene la sesión abierta
// =========================================================
// A diferencia de Registros (que administra a TODOS los usuarios y
// es solo para admin), esta pantalla es de cada quien sobre sí
// mismo — la ve tanto el admin como cualquier vendedor. Lee y
// escribe únicamente /users/{currentUserUid}, nunca otro nodo.

let perfilCache = null;

// Paleta corta de colores para el avatar — se elige uno fijo por
// persona (según su nombre) para que cada quien tenga siempre el
// mismo color entre sesiones, sin guardar nada nuevo en la base.
const PERFIL_AVATAR_COLORS = ['#0F6E5C', '#C46A32', '#1C1A17', '#2563EB', '#7C3AED', '#B4571F'];

function perfilAvatarColor(nombre) {
  const str = String(nombre || '?');
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  return PERFIL_AVATAR_COLORS[hash % PERFIL_AVATAR_COLORS.length];
}

function perfilFormatFecha(ts) {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleDateString('es-PE', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch (e) { return '—'; }
}

function perfilShowFeedback(elId, msg, ok) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = msg;
  el.className = 'perfil-feedback ' + (ok ? 'ok' : 'err');
  el.style.display = 'block';
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => { el.style.display = 'none'; }, 4500);
}

async function loadPerfil() {
  if (!currentUserUid) return;
  try {
    perfilCache = await getUserProfile(currentUserUid);
  } catch (err) {
    console.error(err);
    return;
  }
  if (!perfilCache) return;
  renderPerfil();
}

function renderPerfil() {
  const p = perfilCache;
  const esAdmin = p.rol === 'admin';
  const nombre = p.nombre || (esAdmin ? 'Admin' : p.usuario || 'Usuario');
  const iniciales = nombre.trim().slice(0, 2).toUpperCase();

  const avatar = document.getElementById('perfilAvatar');
  avatar.textContent = iniciales;
  avatar.style.background = perfilAvatarColor(nombre);

  document.getElementById('perfilHeaderNombre').textContent = nombre;
  const badge = document.getElementById('perfilHeaderBadge');
  badge.textContent = esAdmin ? 'Admin' : 'Vendedor';
  badge.className = 'reg-role-badge' + (esAdmin ? ' admin' : '');

  document.getElementById('perfilHeaderContacto').textContent =
    esAdmin ? (p.correo || '—') : (p.correo || ('usuario: ' + (p.usuario || '—')));
  document.getElementById('perfilHeaderDesde').textContent = perfilFormatFecha(p.creadoEn);

  document.getElementById('perfilNombre').value = p.nombre || '';

  const correoInput = document.getElementById('perfilCorreo');
  correoInput.value = p.correo || '';
  // El correo del admin ES su correo real de acceso (Firebase Auth) —
  // cambiarlo aquí no actualizaría la cuenta de acceso, así que se
  // deja de solo lectura para no crear una desincronización.
  // El correo del vendedor es solo informativo, nunca se usa para
  // iniciar sesión — ese sí es libre de editar.
  correoInput.readOnly = esAdmin;
  correoInput.title = esAdmin ? 'Este es tu correo de acceso — no se puede editar desde aquí.' : '';

  document.getElementById('perfilAccesoVal').textContent = esAdmin ? (p.correo || '—') : (p.usuario || '—');
  document.getElementById('perfilRolVal').textContent = esAdmin ? 'Admin' : 'Vendedor';

  const isNative = window.Capacitor && Capacitor.isNativePlatform && Capacitor.isNativePlatform();
  document.getElementById('perfilDispositivo').textContent = isNative ? 'app instalada (Android)' : 'navegador';
}

async function guardarPerfil() {
  if (!perfilCache) return;
  const nombre = document.getElementById('perfilNombre').value.trim();
  const correoInput = document.getElementById('perfilCorreo');
  const correo = correoInput.value.trim();
  const btn = document.getElementById('btnGuardarPerfil');

  if (!nombre) {
    perfilShowFeedback('perfilInfoFeedback', 'El nombre no puede estar vacío.', false);
    return;
  }

  const updates = { nombre };
  if (!correoInput.readOnly) updates.correo = correo;

  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = 'Guardando…';
  try {
    await refUsers.child(currentUserUid).update(updates);
    Object.assign(perfilCache, updates);
    currentUserName = nombre; // así el resto de la app (tarjeta del sidebar) queda al día sin recargar
    const nameEl = document.querySelector('.user-card .user-name');
    const avatarEl = document.querySelector('.user-card .avatar');
    if (nameEl) nameEl.textContent = nombre;
    if (avatarEl) avatarEl.textContent = nombre.slice(0, 2).toUpperCase();
    renderPerfil();
    perfilShowFeedback('perfilInfoFeedback', 'Cambios guardados.', true);
  } catch (err) {
    perfilShowFeedback('perfilInfoFeedback', 'No se pudo guardar: ' + (err.message || err), false);
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

async function cambiarPasswordPerfil() {
  const pass1 = document.getElementById('perfilPass1').value;
  const pass2 = document.getElementById('perfilPass2').value;
  const btn = document.getElementById('btnCambiarPass');

  if (pass1.length < 6) {
    perfilShowFeedback('perfilPassFeedback', 'La contraseña debe tener al menos 6 caracteres.', false);
    return;
  }
  if (pass1 !== pass2) {
    perfilShowFeedback('perfilPassFeedback', 'Las dos contraseñas no coinciden.', false);
    return;
  }

  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = 'Actualizando…';
  try {
    await updateOwnPassword(pass1);
    document.getElementById('perfilPass1').value = '';
    document.getElementById('perfilPass2').value = '';
    perfilShowFeedback('perfilPassFeedback', 'Contraseña actualizada.', true);
  } catch (err) {
    perfilShowFeedback('perfilPassFeedback', 'No se pudo actualizar: ' + (err.message || err), false);
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

window.Perfil = {
  init: function () {
    loadPerfil();
  }
};
