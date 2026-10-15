// =========================================================
// Soporte — FAQ + reportar un problema/sugerencia + reportes
// =========================================================
// La vista misma ya oculta con "dash-admin-only" el bloque de FAQ
// exclusivo de admin y el panel "Reportes del equipo" — acá solo se
// evita además la LECTURA de todos los tickets si quien mira no es
// admin (no tiene sentido pedir esos datos si ni se van a mostrar).

function sopFormatFecha(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' }) +
      ' · ' + new Date(ts).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
  } catch (e) { return ''; }
}

const SOP_TIPO_LABEL = { error: 'Error', sugerencia: 'Sugerencia', consulta: 'Consulta' };

function sopShowFeedback(msg, ok) {
  const el = document.getElementById('sopFormFeedback');
  if (!el) return;
  el.textContent = msg;
  el.className = 'sop-feedback ' + (ok ? 'ok' : 'err');
  el.style.display = 'block';
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => { el.style.display = 'none'; }, 4500);
}

function sopRenderTicketRow(t, { withReplyForm } = {}) {
  const badge = `<span class="sop-badge ${t.estado === 'resuelto' ? 'resuelto' : 'abierto'}">${t.estado === 'resuelto' ? 'Resuelto' : 'Abierto'}</span>`;
  const autor = (t.creadoPor && t.creadoPor.nombre) ? ` — ${escapeHtml(t.creadoPor.nombre)}` : '';
  const reply = t.respuesta
    ? `<div class="sop-ticket-reply"><b>Respuesta:</b> ${escapeHtml(t.respuesta)}</div>`
    : '';
  const replyForm = (withReplyForm && t.estado !== 'resuelto')
    ? `<div class="sop-reply-form">
         <input type="text" id="sopReplyInput_${t.id}" placeholder="Responder y marcar como resuelto…">
         <button class="btn btn-ghost" style="height:30px;padding:0 10px" onclick="responderReporteSoporte('${t.id}')">Responder</button>
       </div>`
    : '';

  return `
    <div class="sop-ticket">
      <div class="sop-ticket-top">
        <div>
          <div class="sop-tipo-tag">${escapeHtml(SOP_TIPO_LABEL[t.tipo] || t.tipo || '')}</div>
          <div class="sop-ticket-asunto">${escapeHtml(t.asunto || '(sin asunto)')}</div>
        </div>
        ${badge}
      </div>
      <div class="sop-ticket-meta">${sopFormatFecha(t.timestamp)}${autor}</div>
      <div class="sop-ticket-msg">${escapeHtml(t.mensaje || '')}</div>
      ${reply}
      ${replyForm}
    </div>
  `;
}

function loadMisReportesSoporte() {
  const list = document.getElementById('sopMisReportes');
  if (!list || !currentUserUid) return;
  fetchMySupportTickets(currentUserUid)
    .then(tickets => {
      list.innerHTML = tickets.length
        ? tickets.map(t => sopRenderTicketRow(t)).join('')
        : '<p class="dash-empty">Todavía no has enviado ningún reporte.</p>';
    })
    .catch(() => { list.innerHTML = '<p class="dash-empty">No se pudieron cargar tus reportes.</p>'; });
}

function loadTodosReportesSoporte() {
  const list = document.getElementById('sopTodosReportes');
  if (!list || typeof isAdmin !== 'function' || !isAdmin()) return;
  fetchAllSupportTickets()
    .then(tickets => {
      list.innerHTML = tickets.length
        ? tickets.map(t => sopRenderTicketRow(t, { withReplyForm: true })).join('')
        : '<p class="dash-empty">Todavía no hay reportes del equipo.</p>';
    })
    .catch(() => { list.innerHTML = '<p class="dash-empty">No se pudieron cargar los reportes.</p>'; });
}

async function enviarReporteSoporte() {
  const tipo = document.getElementById('sopTipo').value;
  const asunto = document.getElementById('sopAsunto').value.trim();
  const mensaje = document.getElementById('sopMensaje').value.trim();
  const btn = document.getElementById('btnEnviarReporte');

  if (!asunto || !mensaje) {
    sopShowFeedback('Completa el asunto y el mensaje antes de enviar.', false);
    return;
  }

  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = 'Enviando…';
  try {
    await saveSupportTicket({ tipo, asunto, mensaje });
    document.getElementById('sopAsunto').value = '';
    document.getElementById('sopMensaje').value = '';
    sopShowFeedback('Reporte enviado. Gracias — el administrador lo va a revisar.', true);
    loadMisReportesSoporte();
    loadTodosReportesSoporte();
  } catch (err) {
    sopShowFeedback('No se pudo enviar: ' + (err.message || err), false);
  } finally {
    btn.disabled = false;
    btn.textContent = original;
  }
}

async function responderReporteSoporte(id) {
  const input = document.getElementById('sopReplyInput_' + id);
  if (!input) return;
  const respuesta = input.value.trim();
  if (!respuesta) return;
  try {
    await respondSupportTicket(id, respuesta);
    loadTodosReportesSoporte();
    loadMisReportesSoporte();
  } catch (err) {
    alert('No se pudo responder: ' + (err.message || err));
  }
}

window.Soporte = {
  init: function () {
    loadMisReportesSoporte();
    loadTodosReportesSoporte();
  }
};
