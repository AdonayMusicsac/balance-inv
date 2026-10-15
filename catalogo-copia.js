// BALANCE-INV: copia ESTÁTICA del catálogo (catalogo.json). La publica GitHub Pages, así los clientes
// no consultan Firebase: miles de visitas leen un archivo, no la base de datos.
// Solo deja pasar los campos públicos (nunca precio, stock, costos ni tipo). Se usa en la app (botón
// "Descargar catalogo.json") y en la automatización de GitHub (scripts/copiar-catalogo.js).
function copiaEstatica(nodo) {
  const n = nodo || {}, https = u => (typeof u === 'string' && /^https:\/\/[^\s"'<>\\]+$/.test(u) ? u : '');
  const out = { activo: n.activo === true, nombre: String(n.nombre || '').slice(0, 80), whatsapp: String(n.whatsapp || '').replace(/\D/g, ''), actualizadoEn: Date.now(), productos: {} };
  if (!out.activo) { out.nombre = ''; out.whatsapp = ''; return out; }
  Object.entries(n.productos || {}).forEach(([code, p]) => {
    if (!p || !String(p.nombre || '').trim()) return;
    out.productos[code] = { nombre: String(p.nombre).slice(0, 200), categoria: String(p.categoria || '').slice(0, 100), imagen: https(p.imagen), disponible: p.disponible !== false, actualizadoEn: Number(p.actualizadoEn) || 0 };
  });
  return out;
}
if (typeof module !== 'undefined' && module.exports) module.exports = { copiaEstatica };
else if (typeof window !== 'undefined') window.copiaEstatica = copiaEstatica;
