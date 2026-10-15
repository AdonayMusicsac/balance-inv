// tests/rules.test.js — evalúa firebase-database.rules.json con un mini-intérprete (sin emulador).
// Cubre las reglas de acceso (.read/.write) y el arranque del primer administrador.
const test = require('node:test');
const assert = require('node:assert/strict');
const rules = require('../firebase-database.rules.json').rules;

const get = (obj, parts) => parts.reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), obj);
function node(root, parts) {
  const v = get(root, parts);
  return {
    child: k => node(root, parts.concat(String(k).split('/'))),
    val: () => (v === undefined ? null : v),
    exists: () => v !== undefined && v !== null,
    isString: () => typeof v === 'string', isBoolean: () => typeof v === 'boolean', isNumber: () => typeof v === 'number',
  };
}
function setIn(root, parts, value) {
  const out = JSON.parse(JSON.stringify(root || {}));
  if (!parts.length) return value;
  let o = out;
  parts.slice(0, -1).forEach(k => { if (typeof o[k] !== 'object' || o[k] === null) o[k] = {}; o = o[k]; });
  if (value === null) delete o[parts[parts.length - 1]]; else o[parts[parts.length - 1]] = value;
  return out;
}
function expr(src, ctx) {
  const js = src.replace(/\$(\w+)/g, (_, n) => `vars.${n}`);
  return new Function('root', 'data', 'newData', 'auth', 'vars', 'now', `return (${js});`)(ctx.root, ctx.data, ctx.newData, ctx.auth, ctx.vars, Date.now());
}
// Recorre la ruta aplicando comodines ($x). Devuelve los nodos de regla en orden desde la raíz.
function chain(path) {
  const out = []; let cur = rules; const vars = {};
  out.push({ rule: cur, vars: { ...vars } });
  for (const seg of path) {
    let next = cur[seg];
    if (next === undefined || typeof next !== 'object') { const w = Object.keys(cur).find(k => k.startsWith('$')); if (!w) break; vars[w.slice(1)] = seg; next = cur[w]; }
    cur = next; out.push({ rule: cur, vars: { ...vars } });
  }
  return out;
}
function can(op, { path, db = {}, auth = null, value }) {
  const parts = path.split('/').filter(Boolean);
  const newRoot = op === 'write' ? setIn(db, parts, value === undefined ? null : value) : db;
  return chain(parts).some(({ rule, vars }) => {
    const r = rule['.' + op]; if (r === undefined) return false; if (typeof r === 'boolean') return r;
    return !!expr(r, { root: node(db, []), data: node(db, parts), newData: node(newRoot, parts), auth, vars });
  });
}
const ADMIN = { uid: 'A', token: { email: 'adonay@gmail.com' } }, VEND = { uid: 'V', token: { email: 'v1@balanceinv.local' } }, OFF = { uid: 'X', token: { email: 'x@balanceinv.local' } };
const DB = { users: { A: { rol: 'admin', activo: true }, V: { rol: 'vendedor', activo: true }, X: { rol: 'vendedor', activo: false } },
  products: { G1: { name: 'G', stock: 5 } }, costos: { c1: { costoUnit: 10 } }, movimientos: { m1: { code: 'G1' } }, catalogoPublico: { activo: false } };

test('primer ingreso del admin: puede crear SU ficha de administrador (y nada más)', () => {
  const vacio = {};
  assert.ok(can('write', { path: 'users/A', db: vacio, auth: ADMIN, value: { rol: 'admin', activo: true, nombre: 'Admin' } }));
  assert.ok(!can('write', { path: 'users/B', db: vacio, auth: ADMIN, value: { rol: 'admin', activo: true } }), 'otra ficha');
  assert.ok(!can('write', { path: 'users/V', db: vacio, auth: VEND, value: { rol: 'admin', activo: true } }), 'otro correo no se hace admin');
  assert.ok(!can('write', { path: 'users/A', db: vacio, auth: ADMIN, value: { rol: 'vendedor' } }), 'solo como admin');
  assert.ok(!can('write', { path: 'users/A', db: { users: { A: { rol: 'vendedor' } } }, auth: ADMIN, value: { rol: 'admin' } }), 'si ya hay ficha no se reescribe');
});

test('usuarios: el admin ve y crea vendedores; el vendedor solo ve lo suyo y no cambia su rol', () => {
  assert.ok(can('read', { path: 'users', db: DB, auth: ADMIN }));
  assert.ok(!can('read', { path: 'users', db: DB, auth: VEND }));
  assert.ok(can('read', { path: 'users/V', db: DB, auth: VEND }));
  assert.ok(!can('read', { path: 'users/A', db: DB, auth: VEND }));
  assert.ok(can('write', { path: 'users/N', db: DB, auth: ADMIN, value: { rol: 'vendedor', activo: true } }));
  assert.ok(!can('write', { path: 'users/N', db: DB, auth: VEND, value: { rol: 'vendedor', activo: true } }));
  assert.ok(can('write', { path: 'users/V/nombre', db: DB, auth: VEND, value: 'Pedro' }), 'cambia su nombre');
  assert.ok(!can('write', { path: 'users/V/rol', db: DB, auth: VEND, value: 'admin' }), 'no se hace admin');
  assert.ok(!can('write', { path: 'users/V/activo', db: DB, auth: VEND, value: true }));
});

test('vendedor activo: lee y vende; no borra productos, no lee costos, no edita movimientos', () => {
  assert.ok(can('read', { path: 'products', db: DB, auth: VEND }));
  assert.ok(can('write', { path: 'products/G1/stock', db: DB, auth: VEND, value: 4 }));
  assert.ok(!can('write', { path: 'products/G1', db: DB, auth: VEND }), 'borrar producto');
  assert.ok(can('write', { path: 'products/G1', db: DB, auth: ADMIN }), 'el admin sí');
  assert.ok(!can('read', { path: 'costos', db: DB, auth: VEND }));
  assert.ok(can('read', { path: 'costos', db: DB, auth: ADMIN }));
  assert.ok(can('write', { path: 'costos/c2', db: DB, auth: VEND, value: { costoUnit: 9 } }), 'compra nueva');
  assert.ok(!can('write', { path: 'costos/c1', db: DB, auth: VEND, value: { costoUnit: 1 } }), 'no cambia un costo existente');
  assert.ok(can('write', { path: 'movimientos/m2', db: DB, auth: VEND, value: { code: 'G1' } }));
  assert.ok(!can('write', { path: 'movimientos/m1', db: DB, auth: VEND, value: { code: 'otro' } }), 'movimientos no se editan');
  assert.ok(!can('write', { path: 'movimientos/m1', db: DB, auth: ADMIN }), 'ni el admin los borra');
});

test('vendedor desactivado y visitante sin sesión: sin acceso a datos', () => {
  for (const p of ['products', 'orders', 'compras', 'clients', 'movimientos']) {
    assert.ok(!can('read', { path: p, db: DB, auth: OFF }), p + ' (desactivado)');
    assert.ok(!can('read', { path: p, db: DB, auth: null }), p + ' (sin sesión)');
  }
  assert.ok(!can('write', { path: 'products/G1/stock', db: DB, auth: OFF, value: 1 }));
  assert.ok(!can('write', { path: 'products/G1/stock', db: DB, auth: null, value: 1 }));
});

test('catálogo público: el visitante lo lee solo si está activo; solo el admin lo configura', () => {
  assert.ok(!can('read', { path: 'catalogoPublico', db: DB, auth: null }));
  const act = { ...DB, catalogoPublico: { activo: true } };
  assert.ok(can('read', { path: 'catalogoPublico', db: act, auth: null }));
  assert.ok(!can('read', { path: 'products', db: act, auth: null }), 'el catálogo no abre el resto');
  assert.ok(can('write', { path: 'catalogoPublico/activo', db: DB, auth: ADMIN, value: true }));
  assert.ok(!can('write', { path: 'catalogoPublico/activo', db: DB, auth: VEND, value: true }));
  assert.ok(can('write', { path: 'catalogoPublico/productos/G1', db: DB, auth: VEND, value: { nombre: 'G', disponible: true } }), 'el espejo lo mantiene cualquier usuario activo');
  assert.ok(!can('write', { path: 'catalogoPublico/productos/G1', db: DB, auth: null, value: { nombre: 'G' } }));
});

test('las consultas de la app tienen índice (sin avisos de rendimiento)', () => {
  assert.ok(rules.products['.indexOn'].includes('updatedAt'));
  assert.ok(rules.clients['.indexOn'].includes('updatedAt'));
  assert.ok(rules.orders['.indexOn'].includes('timestamp'));
  assert.ok(rules.compras['.indexOn'].includes('code') && rules.compras['.indexOn'].includes('facturaKey'));
  assert.ok(rules.movimientos['.indexOn'].includes('origenId') && rules.movimientos['.indexOn'].includes('code'));
});
