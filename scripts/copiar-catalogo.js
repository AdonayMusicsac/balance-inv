// Descarga el nodo público del catálogo desde Firebase y escribe catalogo.json (copia estática para GitHub Pages).
// Lo ejecuta .github/workflows/catalogo.yml cada 30 min; también sirve a mano: node scripts/copiar-catalogo.js
const fs = require('fs'), path = require('path');
const { copiaEstatica } = require('../www/catalogo-copia.js');
const raiz = path.join(__dirname, '..', 'www');
const cfg = fs.readFileSync(path.join(raiz, 'firebase-config.js'), 'utf8');
const base = (process.env.FIREBASE_DB_URL || (cfg.match(/databaseURL:\s*"([^"]+)"/) || [])[1] || '').replace(/\/+$/, '');
if (!/^https:\/\/.+/.test(base)) { console.error('Falta databaseURL en firebase-config.js'); process.exit(1); }
(async () => {
  let nodo = null;
  const r = await fetch(`${base}/catalogoPublico.json`);
  if (r.ok) nodo = await r.json();
  else if (r.status !== 401 && r.status !== 403) { console.error('Firebase respondió', r.status); process.exit(1); }   // 401/403 = catálogo desactivado
  const nuevo = copiaEstatica(nodo), destino = path.join(raiz, 'catalogo.json');
  let previo = null; try { previo = JSON.parse(fs.readFileSync(destino, 'utf8')); } catch (e) { /* primera vez */ }
  const igual = previo && JSON.stringify({ ...previo, actualizadoEn: 0 }) === JSON.stringify({ ...nuevo, actualizadoEn: 0 });
  if (igual) return console.log('Sin cambios.');
  fs.writeFileSync(destino, JSON.stringify(nuevo, null, 1) + '\n');
  console.log(`catalogo.json actualizado: ${Object.keys(nuevo.productos).length} producto(s), activo=${nuevo.activo}`);
})().catch(e => { console.error(e); process.exit(1); });
