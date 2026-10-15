// tests/adversarial-balance.test.js — QA adversarial sobre compras / ventas / anulaciones / documentación.
//
// Convención: `test(...)` = comportamiento que el código cumple hoy (red de seguridad).
//             `bug(...)`  = test.todo: la prueba describe el comportamiento CORRECTO y hoy FALLA
//                           (bug real confirmado en www/). Node la ejecuta pero no rompe `npm test`.
//                           Para activarla como prueba normal, cambiar `bug(` por `test(` al corregir el bug.
//
// Firebase simulado en modo ESTRICTO: además del stub en memoria, rechaza lo que el SDK real rechaza
// (claves con . # $ [ ] / o caracteres de control, valores undefined/NaN/Infinity) y permite inyectar fallos.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, readSrc } = require('./helpers/load-app');


// ───────────────────────── infraestructura ─────────────────────────
const BAD_SEG = /[.#$\[\]\/]/, CTRL = /[\x00-\x1f\x7f]/;
function strictify(firebase, hooks) {
  const db = firebase.database(), raw = db.ref;
  const seg = k => { if (!k || BAD_SEG.test(k) || CTRL.test(k) || Buffer.byteLength(k) > 768) throw new Error(`Firebase (estricto): clave inválida "${k}"`); };
  const data = (v, where, top) => {
    if (v === undefined) throw new Error(`Firebase (estricto): valor undefined en ${where}`);
    if (typeof v === 'number' && !Number.isFinite(v)) throw new Error(`Firebase (estricto): valor ${v} en ${where}`);
    if (v && typeof v === 'object') {
      if (v['.sv']) return;
      Object.entries(v).forEach(([k, x]) => { (top ? k.split('/').filter(Boolean) : [k]).forEach(seg); data(x, where + '/' + k, false); });
    }
  };
  const wrap = (ref, path) => {
    const w = Object.create(ref);
    w.child = k => { const s = String(k).split('/').filter(Boolean); if (!s.length) throw new Error('Firebase (estricto): ruta vacía'); s.forEach(seg); return wrap(ref.child(s.join('/')), path + '/' + s.join('/')); };
    w.set = v => { hooks.onWrite && hooks.onWrite('set', path, v); data(v, path); return ref.set(v); };
    w.update = v => { hooks.onWrite && hooks.onWrite('update', path, v); data(v, path, true); return ref.update(v); };
    w.remove = () => { hooks.onWrite && hooks.onWrite('remove', path); return ref.remove(); };
    w.push = v => { if (v === undefined) { const r = ref.push(); return wrap(r, path + '/' + r.key); } hooks.onWrite && hooks.onWrite('push', path, v); data(v, path); return ref.push(v); };
    w.get = () => { hooks.onGet && hooks.onGet(path); return ref.get(); };
    w.once = e => { hooks.onGet && hooks.onGet(path); return ref.once(e); };
    w.transaction = fn => { hooks.onWrite && hooks.onWrite('transaction', path); return ref.transaction(cur => { const r = fn(cur); if (r !== undefined) data(r, path); return r; }); };
    return w;
  };
  db.ref = p => wrap(raw(p), String(p));
}

function boot(productos, hooks) {
  const { window, firebase } = loadApp([]);
  if (hooks !== false) strictify(firebase, hooks || {});
  for (const f of ['firebase.js', 'balance-logic.js']) {
    const s = window.document.createElement('script'); s.textContent = readSrc(f); window.document.body.appendChild(s);
  }
  firebase._store.products = productos || {};
  const st = firebase._store;
  const api = {
    window, firebase, st,
    movs: () => Object.values(st.movimientos || {}),
    compras: () => Object.entries(st.compras || {}),
    stock: code => st.products[code] && st.products[code].stock,
    netMov: code => api.movs().filter(m => m.code === code).reduce((s, m) => s + (m.cantidad || 0), 0),
    activas: () => api.compras().filter(([, c]) => !c.anulada),
    setTs: (id, ts) => { st.compras[id].timestamp = ts; },
    compra: (o = {}) => window.registrarCompra({ code: 'M1', nombre: 'Melódica', proveedor: 'Clevan SAC', ruc: '20123456789', qty: 10, precio: 118, fecha: '2026-09-28',
      tipo: 'importado', docTipo: 'Factura', docNum: 'F001-' + Math.random().toString(36).slice(2, 8), docQty: o.qty == null ? 10 : o.qty, ...o }),
    venta: async (items, orderId, numero = 'NP-1') => {
      const res = await window.decrementStock(items.map(i => ({ code: i.code, qty: i.qty })));
      await window.registrarSalidaVenta(items, orderId, res, numero);
    },
    sinDoc: code => api.movs().filter(m => m.code === code).reduce((s, m) => s + (m.sinDocumento || 0), 0),
  };
  return api;
}
const imp = (extra = {}) => ({ name: 'Melódica', stock: 0, tipo: 'importado', price: 60, ...extra });
const nac = (extra = {}) => ({ name: 'Nacional', stock: 50, tipo: 'nacional', price: 45, ...extra });
const hdr = (o = {}) => ({ proveedor: 'Clevan SAC', ruc: '20123456789', fecha: '2026-10-01', compTipo: 'Factura', compSerie: 'F001', compNum: '123', ...o });
const L = (code, qty, precio, tipo = 'importado') => ({ code, nombre: code, tipo, qty, precio });

// ───────────────────────── 1. REDONDEO / IGV ─────────────────────────
test('IGV: 140 000 combinaciones precio(centavos) x cantidad entera coinciden con aritmética entera exacta (ROUND medio hacia arriba)', () => {
  const { window } = boot({}, false);
  const malos = [];
  for (let pc = 1; pc <= 20000; pc++) for (const q of [1, 3, 7, 12]) {
    const tot = q * pc, base = Math.floor((tot * 100 + 59) / 118), i = window.calcularImportes(q, pc / 100);
    if (Math.round(i.total * 100) !== tot || Math.round(i.base * 100) !== base || Math.round(i.igv * 100) !== tot - base) malos.push([q, pc / 100, { ...i }]);
  }
  assert.deepEqual(malos.slice(0, 5), []);
});

test('IGV: base + igv == total exacto en céntimos aun con montos enormes y centavos raros', () => {
  const { window } = boot({}, false);
  for (const [q, p] of [[1, 0.01], [1, 0.02], [3, 0.07], [999999, 99999.99], [7, 1234.56], [13, 0.99]]) {
    const i = window.calcularImportes(q, p);
    assert.equal(Math.round(i.base * 100) + Math.round(i.igv * 100), Math.round(i.total * 100), `q=${q} p=${p}`);
  }
});

test('redondeo de cantidades fraccionarias: 0.5 x 0.29 debe dar 0.15 (ROUND de Excel), da 0.14 por usar Math.round sin EPSILON (balance-logic.js:30)', () => {
  const { window } = boot({}, false);
  const malos = [];
  for (const qm of [500, 1500, 2250, 125, 2500]) for (let pc = 1; pc <= 3000; pc++) {
    const exacto = Math.floor((qm * pc + 500) / 1000);
    const i = window.calcularImportes(qm / 1000, pc / 100);
    if (Math.round(i.total * 100) !== exacto) malos.push([qm / 1000, pc / 100, i.total, exacto / 100]);
  }
  assert.deepEqual(malos.slice(0, 3), []);
});

test('monto de "facturar como" con descuento por línea debe coincidir con el subtotal de la nota (nueva-nota-logic round2 con EPSILON); difiere 1 céntimo (balance-logic.js:30,168)', async () => {
  const { window, st, venta } = boot({ M1: imp({ stock: 10 }), N1: nac() });
  await window.registrarFactura(hdr(), [L('M1', 6, 50)]);
  const round2 = n => Math.round((n + Number.EPSILON) * 100) / 100;   // idéntica a nueva-nota-logic.js:358
  const it = { code: 'N1', name: 'Nacional', qty: 3, price: 1.3, itemDiscountPct: 5, facturarComo: 'M1' };
  const subtotalNota = round2(it.qty * it.price * (1 - it.itemDiscountPct / 100));   // computeItemSubtotal()
  await venta([it], 'o1');
  const cr = await window.calcularCruces();
  assert.equal(cr[0].monto, subtotalNota);
});

test('registrarFactura: totales = suma de líneas y base+igv=total, con centavos', async () => {
  const { window } = boot({ M1: imp(), C1: nac({ stock: 0 }) });
  const r = await window.registrarFactura(hdr(), [L('M1', 3, 59.9), L('C1', 7, 0.99, 'nacional'), L('M1', 1, 0.01)]);
  assert.equal(r.total, 186.64);   // 179.70 + 6.93 + 0.01
});

// ───────────────────────── 2. VALIDACIÓN DE CANTIDAD / PRECIO ─────────────────────────
for (const [nombre, qty] of [['0', 0], ['negativa', -3], ['NaN', NaN], ['texto', '3'], ['texto no numérico', 'abc'], ['fraccionaria', 1.5], ['Infinity', Infinity], ['null', null], ['undefined', undefined]]) {
  test(`factura/compra: cantidad ${nombre} se rechaza sin tocar stock, compras ni movimientos`, async () => {
    const t = boot({ M1: imp() });
    await assert.rejects(t.window.registrarFactura(hdr(), [L('M1', 2, 118), L('M1', qty, 118)]));
    await assert.rejects(t.compra({ qty }));
    assert.equal(t.stock('M1'), 0);
    assert.equal(t.compras().length, 0);
    assert.equal(t.movs().length, 0);
  });
}

test('precio inválido (NaN, negativo, texto no numérico) se rechaza; precio 0 se acepta sin NaN ni divisiones raras', async () => {
  const t = boot({ M1: imp() });
  for (const precio of [NaN, -1, 'abc', undefined]) await assert.rejects(t.window.registrarFactura(hdr(), [L('M1', 1, precio)]), undefined, String(precio));
  assert.equal(t.stock('M1'), 0);
  const r = await t.window.registrarFactura(hdr({ compNum: '2' }), [L('M1', 5, 0)]);
  assert.deepEqual([r.total, r.base, r.igv], [0, 0, 0]);
  const k = Object.values(t.st.costos)[0];
  assert.equal(k.costoUnit, 0);
  const [b] = await t.window.calcularBalanceFacturable();
  assert.ok(Number.isFinite(b.costoProm) && b.costoProm === 0);
  assert.equal(b.margenPct, 100);
});

test('precio null o numérico-como-texto no debe aceptarse tal cual: `null >= 0` es true y se guarda precio como string (balance-logic.js:37)', async () => {
  const t = boot({ M1: imp() });
  await assert.rejects(t.compra({ precio: null }));
  const id = await t.compra({ precio: '12', docNum: 'F001-9' });
  assert.equal(typeof t.st.compras[id].precio, 'number');
});

// ───────────────────────── 3. CÓDIGOS / CLAVES FIREBASE ─────────────────────────
for (const code of ['A.B', 'A#B', 'A$B', 'A[1]', 'A]', '[X', 'A\nB', 'A\tB', '']) {
  test(`producto nuevo con código ${JSON.stringify(code)} en claves Firebase: se rechaza y no deja residuos`, async () => {
    const t = boot({ M1: imp() });
    const antes = JSON.stringify(t.st.products);
    await assert.rejects(t.window.registrarFactura(hdr(), [L('M1', 2, 118), { nuevo: { code, nombre: 'Raro', tipo: 'importado' }, qty: 1, precio: 5 }]));
    assert.equal(JSON.stringify(t.st.products), antes);
    assert.equal(t.movs().reduce((s, m) => s + m.cantidad, 0), 0);
    assert.ok(t.activas().length === 0);
  });
}

test('producto nuevo con "/" en el código: se guarda con ⁄ (no crea ruta anidada) y el stock sube', async () => {
  const t = boot({});
  const r = await t.window.registrarFactura(hdr(), [{ nuevo: { code: 'ab/12', nombre: 'Con barra', tipo: 'importado' }, qty: 2, precio: 118 }]);
  assert.deepEqual([...r.creados], ['AB⁄12']);
  assert.equal(t.stock('AB⁄12'), 2);
  assert.equal(t.st.products.AB, undefined);
});

for (const code of ['A.B', 'A#', 'A$', 'A[1]', 'A\nB']) {
  test(`línea existente con código ${JSON.stringify(code)}: error limpio, nada se escribe`, async () => {
    const t = boot({ M1: imp() });
    await assert.rejects(t.window.registrarFactura(hdr(), [L('M1', 1, 118), L(code, 1, 118)]));
    assert.equal(t.netMov('M1'), 0); assert.equal(t.stock('M1'), 0);
  });
}

test('código de línea con "/" no puede apuntar a sub-rutas del producto: "M1/name" pasa la comprobación de existencia y pisa el nombre (balance-logic.js:19, sin validar code)', async () => {
  const t = boot({ M1: imp({ name: 'Melódica 37' }) });
  await assert.rejects(t.compra({ code: 'M1/name', docTipo: '', sinConfirmar: true }));
  assert.equal(t.st.products.M1.name, 'Melódica 37');
});

test('proveedor con caracteres prohibidos (. # $ [ ] /) se sanea en la clave y no explota', async () => {
  const t = boot({ M1: imp() });
  await t.window.registrarFactura(hdr({ proveedor: 'A.B/C#[1]$ SAC', ruc: '' , compTipo: 'Boleta', compSerie: 'B001', compNum: '1' }), [L('M1', 1, 118)]);
  assert.ok(Object.keys(t.st.proveedores).every(k => !/[.#$\[\]\/]/.test(k)));
});

test('producto sin "name" no debe impedir la compra: nombre undefined llega a Firebase (set con undefined lanza en el SDK real) (balance-logic.js:56,60)', async () => {
  const t = boot({ M1: { stock: 0, tipo: 'importado' } });
  await t.window.registrarFactura(hdr(), [{ code: 'M1', nombre: undefined, tipo: 'importado', qty: 1, precio: 118 }]);
  assert.equal(t.stock('M1'), 1);
});

test('proveedor vacío o sin fecha: se rechaza y los productos nuevos creados a mitad de camino se eliminan', async () => {
  const t = boot({});
  const l = () => [{ nuevo: { code: 'Z1', nombre: 'Nuevo', tipo: 'importado' }, qty: 1, precio: 118 }];
  await assert.rejects(t.window.registrarFactura(hdr({ proveedor: '' }), l()), /proveedor/);
  await assert.rejects(t.window.registrarFactura(hdr({ fecha: 'basura' }), l()), /Fecha/);
  await assert.rejects(t.window.registrarFactura(hdr({ fecha: '' }), l()), /Fecha/);
  assert.equal(t.st.products.Z1, undefined);
});

test('proveedor formado solo por espacios debe rechazarse (balance-logic.js:39,88: `!c.proveedor` deja pasar "   ")', async () => {
  const t = boot({ M1: imp() });
  await assert.rejects(t.window.registrarFactura(hdr({ proveedor: '   ', ruc: '' , compTipo: 'Boleta', compNum: '5' }), [L('M1', 1, 118)]));
});

// ───────────────────────── 4. COMPROBANTES DUPLICADOS ─────────────────────────
test('duplicado exacto se rechaza; tras anular la compra el mismo comprobante se puede volver a registrar', async () => {
  const t = boot({ M1: imp() });
  const r = await t.window.registrarFactura(hdr(), [L('M1', 2, 118)]);
  await assert.rejects(t.window.registrarFactura(hdr(), [L('M1', 2, 118)]), /ya fue registrado/);
  await t.window.anularCompra(r.ids[0]);
  await t.window.registrarFactura(hdr(), [L('M1', 2, 118)]);
  assert.equal(t.stock('M1'), 2);
});

test('tras un rollback por línea inválida el comprobante NO queda bloqueado como duplicado', async () => {
  const t = boot({ M1: imp() });
  await assert.rejects(t.window.registrarFactura(hdr(), [L('M1', 2, 118), L('NOEXISTE', 1, 5, 'nacional')]), /no existe/);
  await t.window.registrarFactura(hdr(), [L('M1', 2, 118)]);
  assert.equal(t.stock('M1'), 2);
});

for (const [nombre, b] of [
  ['serie en minúscula (f001 vs F001)', { compSerie: 'f001' }],
  ['número con espacios (" 123 ")', { compNum: ' 123 ' }],
  ['número con ceros a la izquierda ("00123" vs "123", como lo entrega el XML)', { compNum: '00123' }],
  ['serie con espacios ("F001 ")', { compSerie: 'F001 ' }],
]) {
  test(`duplicado con ${nombre} debe detectarse (facturaKey sin normalizar, balance-logic.js:103-107)`, async () => {
    const t = boot({ M1: imp() });
    await t.window.registrarFactura(hdr(), [L('M1', 1, 118)]);
    await assert.rejects(t.window.registrarFactura(hdr(b), [L('M1', 1, 118)]), /ya fue registrado/);
    assert.equal(t.stock('M1'), 1);
  });
}

test('boleta sin RUC: mismo proveedor con distinta mayúscula/espacios ("Clevan SAC" vs "CLEVAN SAC ") debe contar como duplicado (provKey sin normalizar, balance-logic.js:104)', async () => {
  const t = boot({ M1: imp() });
  const h = o => hdr({ ruc: '', compTipo: 'Boleta', compSerie: 'B001', compNum: '7', ...o });
  await t.window.registrarFactura(h({ proveedor: 'Clevan SAC' }), [L('M1', 1, 118)]);
  await assert.rejects(t.window.registrarFactura(h({ proveedor: 'CLEVAN SAC ' }), [L('M1', 1, 118)]), /ya fue registrado/);
});

test('dos registrarFactura simultáneos con el mismo comprobante: solo uno debe prosperar (check-then-act sin transacción, balance-logic.js:105-108)', async () => {
  const t = boot({ M1: imp() });
  const r = await Promise.allSettled([t.window.registrarFactura(hdr(), [L('M1', 3, 118)]), t.window.registrarFactura(hdr(), [L('M1', 3, 118)])]);
  assert.equal(r.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(t.stock('M1'), 3);
});

// ───────────────────────── 5. LÍNEAS REPETIDAS / ROLLBACK ─────────────────────────
test('factura con 3 líneas del mismo código: suma stock, una compra documentada por línea, documentación total correcta', async () => {
  const t = boot({ M1: imp() });
  await t.window.registrarFactura(hdr(), [L('M1', 2, 118), L('M1', 3, 118), L('M1', 5, 100)]);
  assert.equal(t.stock('M1'), 10);
  assert.equal(t.compras().length, 3);
  const [b] = await t.window.calcularBalanceFacturable();
  assert.deepEqual([b.docTotal, b.docSaldo, b.facturable], [10, 10, 10]);
});

test('líneas repetidas + fallo en la última: stock y documentación vuelven exactamente a 0', async () => {
  const t = boot({ M1: imp() });
  await assert.rejects(t.window.registrarFactura(hdr(), [L('M1', 2, 118), L('M1', 3, 118), L('NOEXISTE', 1, 1, 'nacional')]), /no existe/);
  assert.equal(t.stock('M1'), 0);
  const [b] = await t.window.calcularBalanceFacturable();
  assert.deepEqual([b.docTotal, b.docSaldo, b.facturable, b.costoProm], [0, 0, 0, null]);
});

test('rollback: falla la línea 3 de 5 → líneas 1-2 revertidas, producto nuevo eliminado, movimientos netos 0, comprobante reutilizable', async () => {
  const t = boot({ M1: imp(), M2: imp({ name: 'M2' }), C1: nac({ stock: 0 }) });
  const lineas = () => [L('M1', 4, 118), { nuevo: { code: 'Z9', nombre: 'Nuevo', tipo: 'importado' }, qty: 2, precio: 118 }, L('NOEXISTE', 1, 5, 'nacional'), L('M2', 1, 118), L('C1', 3, 10, 'nacional')];
  await assert.rejects(t.window.registrarFactura(hdr(), lineas()), /no existe/);
  assert.equal(t.stock('M1'), 0); assert.equal(t.stock('M2'), 0); assert.equal(t.stock('C1'), 0);
  assert.equal(t.st.products.Z9, undefined);
  assert.equal(t.st.products.NOEXISTE, undefined);
  for (const c of ['M1', 'M2', 'C1', 'Z9']) assert.equal(t.netMov(c), 0, c);
  assert.ok(t.compras().every(([, c]) => c.anulada === true));
  const b = await t.window.calcularBalanceFacturable();
  assert.ok(b.every(x => x.docSaldo === 0 && x.costoProm === null));
  const ok = await t.window.registrarFactura(hdr(), lineas().filter(l => l.code !== 'NOEXISTE'));
  assert.equal(ok.ids.length, 4);
});

test('rollback: fallo de escritura inyectado en la línea 3 (costos) deja stock neto 0 y sin compras vigentes', async () => {
  let n = 0;
  const t = boot({ M1: imp(), M2: imp({ name: 'M2' }), C1: nac({ stock: 0 }) }, { onWrite: (m, p) => { if (m === 'set' && p.startsWith('costos/') && ++n === 3) throw new Error('boom costos'); } });
  await assert.rejects(t.window.registrarFactura(hdr(), [L('M1', 4, 118), L('M2', 2, 118), L('C1', 3, 10, 'nacional'), L('M1', 1, 118), L('M2', 1, 118)]), /boom/);
  for (const c of ['M1', 'M2', 'C1']) { assert.equal(t.stock(c), 0, c); assert.equal(t.netMov(c), 0, c); }
  assert.equal(t.activas().length, 0);
  assert.equal(t.compras().length, 2);   // la compra de la línea que falló se borra; las 2 previas quedan anuladas
});

test('rollback: fallo al escribir el movimiento de la línea 3 → compra y costo de esa línea eliminados, stock revertido', async () => {
  let n = 0;
  const t = boot({ M1: imp(), M2: imp({ name: 'M2' }), C1: nac({ stock: 0 }) }, { onWrite: (m, p) => { if (m === 'push' && p === 'movimientos' && ++n === 3) throw new Error('boom mov'); } });
  await assert.rejects(t.window.registrarFactura(hdr(), [L('M1', 4, 118), L('M2', 2, 118), L('C1', 3, 10, 'nacional')]), /boom/);
  for (const c of ['M1', 'M2', 'C1']) assert.equal(t.stock(c), 0, c);
  assert.equal(Object.keys(t.st.costos || {}).filter(id => !t.st.compras[id]).length, 0, 'costos huérfanos');
  assert.equal(t.activas().length, 0);
});

test('si el rollback no puede revertir una línea (parte ya vendida en paralelo) el error se traga: queda media factura vigente y el reintento choca con "ya fue registrado" (balance-logic.js:126)', async () => {
  const t = boot({ M1: imp(), BOOM: imp({ name: 'BOOM' }) }, { onGet: p => { if (p === 'products/BOOM') { t.st.products.M1.stock = 0; delete t.st.products.BOOM; } } });
  let msg = '';
  await t.window.registrarFactura(hdr(), [L('M1', 4, 118), L('BOOM', 1, 118)]).catch(e => { msg = e.message; });
  const vigentes = t.activas().length;
  assert.ok(vigentes === 0 || /revert|manual|parcial/i.test(msg), `quedaron ${vigentes} compras vigentes y el mensaje fue "${msg}"`);
});

// ───────────────────────── 6. PRODUCTOS NACIONALES SIN CÓDIGO ─────────────────────────
test('nacionales sin código: 5 líneas autogeneradas, sin colisión con NAC-xxxx existentes (incluye minúsculas y borrados)', async () => {
  const t = boot({ 'NAC-0003': nac({ stock: 1 }), 'nac-0010': nac({ stock: 1 }), 'NAC-0011': { name: 'borrado', deleted: true, stock: 0 }, 'NAC-ABC': nac(), 'NAC-99999': nac() });
  const r = await t.window.registrarFactura(hdr({ compTipo: '', compNum: '', ruc: '' }), Array.from({ length: 5 }, (_, i) => ({ nuevo: { code: '', nombre: 'N' + i, tipo: 'nacional' }, qty: 1, precio: 1 })));
  assert.equal(new Set(r.creados).size, 5);
  assert.ok(r.creados.every(c => /^NAC-\d{4,}$/.test(c) && !['NAC-0003', 'NAC-0010', 'NAC-0011', 'NAC-99999'].includes(c)));
  assert.equal(r.creados[0], 'NAC-100000');   // máximo existente = 99999
});

test('nacional con código manual NAC-0001 y otro sin código en la misma factura: el autogenerado no tiene en cuenta el manual y la factura se rechaza por "mismo código" (balance-logic.js:74-77,111-114)', async () => {
  const t = boot({});
  const r = await t.window.registrarFactura(hdr({ compTipo: '', compNum: '', ruc: '' }), [
    { nuevo: { code: 'NAC-0001', nombre: 'Manual', tipo: 'nacional' }, qty: 1, precio: 1 },
    { nuevo: { code: '', nombre: 'Auto', tipo: 'nacional' }, qty: 1, precio: 1 }]);
  assert.equal(new Set(r.creados).size, 2);
});

test('dos facturas simultáneas con nacionales sin código deben terminar ambas, con códigos distintos; hoy la segunda falla con "Ya existe un producto" (balance-logic.js:111)', async () => {
  const t = boot({});
  const f = (n) => t.window.registrarFactura(hdr({ compTipo: '', compNum: '', ruc: '' }), [{ nuevo: { code: '', nombre: 'X' + n, tipo: 'nacional' }, qty: 1, precio: 1 }]);
  const r = await Promise.allSettled([f(1), f(2)]);
  assert.deepEqual(r.map(x => x.status), ['fulfilled', 'fulfilled']);
});

test('dos productos nuevos con el mismo código (distinta mayúscula/espacios) en la misma factura se rechazan sin dejar residuos', async () => {
  const t = boot({});
  await assert.rejects(t.window.registrarFactura(hdr(), [{ nuevo: { code: 'abc', nombre: 'A', tipo: 'importado' }, qty: 1, precio: 1 }, { nuevo: { code: ' ABC ', nombre: 'B', tipo: 'importado' }, qty: 1, precio: 1 }]), /mismo código/);
  assert.deepEqual(Object.keys(t.st.products), []);
});

// ───────────────────────── 7. VENTAS: CANTIDAD / STOCK / DOCUMENTACIÓN ─────────────────────────
test('venta mayor al stock: decrementStock rechaza, stock intacto, y (si no se llama a registrarSalidaVenta) la documentación queda intacta', async () => {
  const t = boot({ M1: imp({ stock: 0 }) });
  const id = await t.compra({ qty: 5, docQty: 5 });
  await assert.rejects(t.window.decrementStock([{ code: 'M1', qty: 6 }]), /insuficiente/);
  assert.equal(t.stock('M1'), 5);
  assert.equal(t.st.compras[id].documento.cantUtilizada, 0);
});

test('venta de varios productos donde el último no tiene stock: nada se descuenta (todo o nada)', async () => {
  const t = boot({ M1: imp({ stock: 5 }), N1: nac({ stock: 1 }) });
  await assert.rejects(t.window.decrementStock([{ code: 'M1', qty: 2 }, { code: 'N1', qty: 2 }]), /insuficiente/);
  assert.deepEqual([t.stock('M1'), t.stock('N1')], [5, 1]);
});

for (const [nombre, qty] of [['negativa', -4], ['NaN', NaN], ['texto', 'dos']]) {
  test(`decrementStock con cantidad ${nombre} debe rechazarse (hoy ${qty < 0 ? 'SUBE el stock' : 'deja stock NaN'}) (firebase.js:624-628)`, async () => {
    const t = boot({ M1: imp({ stock: 5 }) });
    await t.window.decrementStock([{ code: 'M1', qty }]).catch(() => {});
    assert.equal(t.stock('M1'), 5);
  });
}

test('registrarSalidaVenta con cantidad NaN/negativa: no debe escribir movimientos con sinDocumento NaN ni cantidad positiva de "venta" (balance-logic.js:176-183)', async () => {
  const t = boot({ M1: imp({ stock: 5 }) });
  await t.compra({ qty: 5, docQty: 5 });
  for (const qty of [NaN, -3, 0]) await t.window.registrarSalidaVenta([{ code: 'M1', name: 'M', qty }], 'o' + qty, [{ code: 'M1', newStock: 5 }], 'NP').catch(() => {});
  assert.ok(t.movs().filter(m => m.tipo === 'venta').every(m => m.cantidad < 0 && Number.isFinite(m.sinDocumento)));
});

test('consumo de documentación: más antiguo primero por timestamp aunque la clave Firebase diga otra cosa; devolución en orden inverso', async () => {
  const t = boot({ M1: imp({ stock: 0 }) });
  const a = await t.compra({ qty: 3, docQty: 3 }), b = await t.compra({ qty: 3, docQty: 3 }), c = await t.compra({ qty: 3, docQty: 3 });
  t.setTs(a, 3000); t.setTs(b, 1000); t.setTs(c, 2000);   // orden cronológico real: b, c, a
  await t.venta([{ code: 'M1', name: 'M', qty: 4 }], 'o1');
  const u = id => t.st.compras[id].documento.cantUtilizada;
  assert.deepEqual([u(b), u(c), u(a)], [3, 1, 0]);
  await t.window.registrarAnulacionVenta('o1', [{ code: 'M1', name: 'M', qty: 4 }]);
  assert.deepEqual([u(a), u(b), u(c)], [0, 0, 0]);
});

test('compras anuladas y compras sin comprobante no aportan documentación', async () => {
  const t = boot({ M1: imp({ stock: 0 }) });
  const a = await t.compra({ qty: 5, docQty: 5 });
  await t.compra({ qty: 5, docTipo: '', sinConfirmar: true });
  const c = await t.compra({ qty: 5, docQty: 2 });
  await t.window.anularCompra(a);
  await t.venta([{ code: 'M1', name: 'M', qty: 4 }], 'o1');
  assert.equal(t.st.compras[a].documento.cantUtilizada, 0);
  assert.equal(t.st.compras[c].documento.cantUtilizada, 2);
  assert.equal(t.movs().find(m => m.tipo === 'venta').sinDocumento, 2);
});

test('balance facturable: facturable = min(docSaldo, stock) también cuando la documentación excede al stock físico', async () => {
  const t = boot({ M1: imp({ stock: 0, price: 10 }) });
  await t.compra({ qty: 10, docQty: 10 });
  t.st.products.M1.stock = 3;   // salieron 7 sin pasar por el sistema
  const [b] = await t.window.calcularBalanceFacturable();
  assert.deepEqual([b.docSaldo, b.stock, b.facturable, b.sinDoc, b.montoFact, b.montoSin], [10, 3, 3, 0, 30, 0]);
});

test('balance facturable no debe devolver negativos si el stock es negativo (Math.min sin Math.max(0,…), balance-logic.js:293)', async () => {
  const t = boot({ M1: imp({ stock: 0, price: 10 }) });
  await t.compra({ qty: 4, docQty: 4 });
  t.st.products.M1.stock = -2;
  const [b] = await t.window.calcularBalanceFacturable();
  assert.ok(b.facturable >= 0 && b.montoFact >= 0);
});

test('cantidades fraccionarias en venta: la documentación se consume sin NaN y respeta 0 ≤ usada ≤ documentada', async () => {
  const t = boot({ M1: imp({ stock: 0 }) });
  const id = await t.compra({ qty: 10, docQty: 1 });
  for (let i = 0; i < 10; i++) await t.window.registrarSalidaVenta([{ code: 'M1', name: 'M', qty: 0.1 }], 'o' + i, [{ code: 'M1', newStock: 10 }], 'NP');
  const u = t.st.compras[id].documento.cantUtilizada;
  assert.ok(Math.abs(u - 1) < 1e-9 && u <= 1 + 1e-9);
  assert.ok(t.movs().filter(m => m.tipo === 'venta').every(m => Math.abs(m.sinDocumento) < 1e-9));
});

test('precio 0 en la nota (regalo) no rompe el cruce: monto 0', async () => {
  const t = boot({ M1: imp({ stock: 10 }), N1: nac() });
  await t.window.registrarFactura(hdr(), [L('M1', 6, 50)]);
  await t.venta([{ code: 'N1', name: 'N', qty: 2, price: 0, facturarComo: 'M1' }], 'o1');
  const cr = await t.window.calcularCruces();
  assert.deepEqual([cr[0].qty, cr[0].monto], [2, 0]);
});

// ───────────────────────── 8. ANULACIONES ─────────────────────────
test('anulación de venta repetida: la 2.ª llamada debe ser no-op; hoy devuelve de nuevo documentación que pertenece a OTRA venta y duplica el movimiento (balance-logic.js:192-203; deleteOrder firebase.js:819 sin guarda)', async () => {
  const t = boot({ M1: imp({ stock: 0 }) });
  const id = await t.compra({ qty: 10, docQty: 10 });
  await t.venta([{ code: 'M1', name: 'M', qty: 4 }], 'o1');
  await t.venta([{ code: 'M1', name: 'M', qty: 4 }], 'o2');
  const it = [{ code: 'M1', name: 'M', qty: 4 }];
  await t.window.registrarAnulacionVenta('o1', it);
  await t.window.registrarAnulacionVenta('o1', it).catch(() => {});
  assert.equal(t.st.compras[id].documento.cantUtilizada, 4, 'o2 sigue vigente y debe conservar sus 4 documentos');
  assert.equal(t.movs().filter(m => m.tipo === 'anulacion_venta').length, 1);
});

test('anular una venta DESPUÉS de otra que consumió documentos: solo devuelve lo suyo y conserva el "sin documento" de la otra', async () => {
  const t = boot({ M1: imp({ stock: 0 }) });
  const id = await t.compra({ qty: 10, docQty: 5 });
  const A = [{ code: 'M1', name: 'M', qty: 3 }], B = [{ code: 'M1', name: 'M', qty: 4 }];
  await t.venta(A, 'oA'); await t.venta(B, 'oB');   // A usa 3; B usa 2 y 2 quedan sin documento
  await t.window.registrarAnulacionVenta('oA', A);
  assert.equal(t.st.compras[id].documento.cantUtilizada, 2);
  assert.equal(t.sinDoc('M1'), 2);
  await t.window.registrarAnulacionVenta('oB', B);
  assert.equal(t.st.compras[id].documento.cantUtilizada, 0);
  assert.equal(t.sinDoc('M1'), 0);
});

test('anular en orden inverso (B primero, luego A) también revierte exactamente', async () => {
  const t = boot({ M1: imp({ stock: 0 }) });
  const id = await t.compra({ qty: 10, docQty: 5 });
  const A = [{ code: 'M1', name: 'M', qty: 3 }], B = [{ code: 'M1', name: 'M', qty: 4 }];
  await t.venta(A, 'oA'); await t.venta(B, 'oB');
  await t.window.registrarAnulacionVenta('oB', B);
  assert.equal(t.st.compras[id].documento.cantUtilizada, 3);
  await t.window.registrarAnulacionVenta('oA', A);
  assert.equal(t.st.compras[id].documento.cantUtilizada, 0);
  assert.equal(t.sinDoc('M1'), 0);
});

test('doble anulación de COMPRA: la segunda se rechaza y el stock no se descuenta dos veces', async () => {
  const t = boot({ M1: imp({ stock: 0 }) });
  const a = await t.compra({ qty: 5 }); await t.compra({ qty: 5 });
  await t.window.anularCompra(a);
  await assert.rejects(t.window.anularCompra(a), /ya está anulada/);
  assert.equal(t.stock('M1'), 5);
});

test('anulaciones simultáneas de la misma compra: solo una descuenta stock', async () => {
  const t = boot({ M1: imp({ stock: 0 }) });
  const a = await t.compra({ qty: 5 }); await t.compra({ qty: 5 });
  const r = await Promise.allSettled([t.window.anularCompra(a), t.window.anularCompra(a)]);
  assert.equal(r.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(t.stock('M1'), 5);
});

test('anularCompra de una compra inexistente o con stock insuficiente falla limpio y no deja la bandera anulada', async () => {
  const t = boot({ M1: imp({ stock: 0 }) });
  await assert.rejects(t.window.anularCompra('-noexiste'), /no existe/);
  const a = await t.compra({ qty: 5 });
  t.st.products.M1.stock = 2;
  await assert.rejects(t.window.anularCompra(a), /ya se vendió/);
  assert.notEqual(t.st.compras[a].anulada, true);
  assert.equal(t.stock('M1'), 2);
});

// ───────────────────────── 9. "FACTURAR COMO" ─────────────────────────
async function cruce(extraProds = {}) {
  const t = boot({ M1: imp({ stock: 10 }), M2: imp({ name: 'M2', stock: 10 }), N1: nac(), ...extraProds });
  await t.window.registrarFactura(hdr(), [L('M1', 6, 50)]);
  t.st.products.M1.stock = 10;
  return t;
}
const itN = (o = {}) => ({ code: 'N1', name: 'Nacional', qty: 3, price: 60, itemDiscountPct: 0, facturarComo: 'M1', ...o });
const usada = t => Object.values(t.st.compras).reduce((s, c) => s + ((c.documento || {}).cantUtilizada || 0), 0);

test('facturar como: edición con distinta cantidad recalcula documentación, cruce y monto', async () => {
  const t = await cruce();
  await t.venta([itN({ qty: 4 })], 'o1');
  const antes = [itN({ qty: 4 })], despues = [itN({ qty: 2 })];
  t.st.products.N1.stock += 4; const res = await t.window.decrementStock([{ code: 'N1', qty: 2 }]);
  await t.window.registrarEdicionVenta('o1', antes, despues, res, 'NP-1');
  assert.equal(usada(t), 2);
  const cr = await t.window.calcularCruces();
  assert.deepEqual([cr[0].qty, cr[0].monto], [2, 120]);
});

test('facturar como: la edición que QUITA el "facturar como" libera toda la documentación y borra el cruce', async () => {
  const t = await cruce();
  await t.venta([itN()], 'o1');
  t.st.products.N1.stock += 3; const res = await t.window.decrementStock([{ code: 'N1', qty: 3 }]);
  await t.window.registrarEdicionVenta('o1', [itN()], [itN({ facturarComo: undefined })], res, 'NP-1');
  assert.equal(usada(t), 0);
  assert.equal((await t.window.calcularCruces()).length, 0);
});

test('facturar como: la edición que CAMBIA M1 → M2 mueve la documentación de producto', async () => {
  const t = await cruce();
  await t.window.registrarFactura(hdr({ compNum: '124' }), [L('M2', 5, 50)]);
  await t.venta([itN()], 'o1');
  t.st.products.N1.stock += 3; const res = await t.window.decrementStock([{ code: 'N1', qty: 3 }]);
  await t.window.registrarEdicionVenta('o1', [itN()], [itN({ facturarComo: 'M2' })], res, 'NP-1');
  const bal = await t.window.calcularBalanceFacturable();
  const g = c => bal.find(x => x.code === c);
  assert.deepEqual([g('M1').docSaldo, g('M1').usadoOtros, g('M2').docSaldo, g('M2').usadoOtros], [6, 0, 2, 3]);
});

test('facturar como: dos líneas del mismo nacional → anular deja cantidad, monto y documentación en 0 exactos', async () => {
  const t = await cruce();
  const its = [itN({ qty: 2, price: 33.33 }), itN({ qty: 3, price: 33.33 })];
  await t.venta(its, 'o1');
  assert.equal(usada(t), 5);
  await t.window.registrarAnulacionVenta('o1', its);
  assert.equal(usada(t), 0);
  const cz = t.movs().filter(m => m.cruzadaDe);
  assert.equal(Math.round(cz.reduce((s, m) => s + (m.monto || 0), 0) * 100) + 0, 0);   // (+0: evita -0)
  assert.equal(cz.reduce((s, m) => s + (m.cantDoc || 0), 0), 0);
});

test('facturar como: producto destino SIN documentación → se registra el cruce como "sin documento" y la anulación lo compensa', async () => {
  const t = await cruce();
  await t.venta([itN({ facturarComo: 'M2', qty: 3 })], 'o1');
  const cz = t.movs().find(m => m.tipo === 'facturacion_cruzada');
  assert.deepEqual([cz.code, cz.cantDoc, cz.sinDocumento], ['M2', 3, 3]);
  await t.window.registrarAnulacionVenta('o1', [itN({ facturarComo: 'M2', qty: 3 })]);
  assert.equal(t.sinDoc('M2'), 0);
});

test('facturar como: destino inexistente, borrado o el propio producto se ignoran (sin cruce, sin error, sin consumir documentos)', async () => {
  const t = await cruce({ D1: imp({ name: 'Borrado', deleted: true }) });
  for (const [i, fc] of ['NOEXISTE', 'D1', 'N1', '', undefined, null].entries())
    await t.venta([itN({ qty: 1, facturarComo: fc })], 'o' + i);
  assert.equal(t.movs().filter(m => m.cruzadaDe).length, 0);
  assert.equal(usada(t), 0);
  assert.equal(t.movs().filter(m => m.tipo === 'venta').length, 6);
});

test('facturar como: un importado vendido "como otro" ignora facturarComo y gasta su propia documentación', async () => {
  const t = await cruce();
  await t.venta([{ code: 'M1', name: 'M1', qty: 2, price: 60, facturarComo: 'M2' }], 'o1');
  assert.equal(usada(t), 2);
  assert.equal(t.movs().filter(m => m.cruzadaDe).length, 0);
});

test('facturar como a un producto NACIONAL no debe generar cruce ni entrar en la tabla de "nacionales facturados como importado" (balance-logic.js:177-179 no comprueba tipo === importado)', async () => {
  const t = await cruce({ N2: nac({ name: 'Otro nacional' }) });
  await t.venta([itN({ facturarComo: 'N2', qty: 2 })], 'o1');
  assert.equal((await t.window.calcularCruces()).length, 0);
});

test('avisoSinDocumento: avisa (y respeta la respuesta) con importados y con "facturar como", sumando líneas repetidas', async () => {
  const t = await cruce();
  let msg = null; t.window.confirm = m => { msg = m; return false; };
  assert.equal(await t.window.avisoSinDocumento([{ code: 'N1', qty: 4, facturarComo: 'M1' }, { code: 'N1', qty: 3, facturarComo: 'M1' }]), false);
  assert.match(msg, /facturas 7, con documento hay 6/);
  msg = null; t.window.confirm = m => { msg = m; return true; };
  assert.equal(await t.window.avisoSinDocumento([{ code: 'N1', qty: 4, facturarComo: 'M1' }]), true);
  assert.equal(msg, null);
  assert.equal(await t.window.avisoSinDocumento([{ code: 'N1', qty: 1, facturarComo: 'NOEXISTE' }]), true);
});

// ───────────────────────── 10. EDICIÓN / KARDEX ─────────────────────────
test('venta con el mismo código en dos líneas: el saldo del 2.º movimiento usa results.find() y repite el newStock del 1.º (balance-logic.js:174,181) → falsa alerta "Diferencia detectada"', async () => {
  const t = boot({ M1: imp({ stock: 10 }) });
  await t.window.registrarSalidaVenta([{ code: 'M1', name: 'M', qty: 2 }, { code: 'M1', name: 'M', qty: 3 }], 'o1', [{ code: 'M1', newStock: 8 }, { code: 'M1', newStock: 5 }], 'NP');
  const v = t.movs().filter(m => m.tipo === 'venta');
  assert.equal(v.at(-1).saldoResultante, 5);
});

test('kardex: la cadena de saldos cuadra (saldo = saldo previo + cantidad) tras compra, venta, edición y anulación', async () => {
  const t = boot({ M1: imp({ stock: 0 }) });
  await t.compra({ qty: 10, docQty: 4 });
  await t.venta([{ code: 'M1', name: 'M', qty: 6 }], 'o1');
  t.st.products.M1.stock += 6; const res = await t.window.decrementStock([{ code: 'M1', qty: 3 }]);
  await t.window.registrarEdicionVenta('o1', [{ code: 'M1', name: 'M', qty: 6 }], [{ code: 'M1', name: 'M', qty: 3 }], res, 'NP-1');
  t.st.products.M1.stock += 3;
  await t.window.registrarAnulacionVenta('o1', [{ code: 'M1', name: 'M', qty: 3 }]);
  let prev = 0;
  for (const m of t.movs()) { assert.equal(m.saldoResultante, prev + m.cantidad, m.tipo); prev = m.saldoResultante; }
  assert.equal(prev, t.stock('M1'));
});

// ───────────────────────── 11. COSTOS ─────────────────────────
test('costo: factura = precio/1.18; boleta y sin comprobante = precio completo; promedio ponderado entre compras', async () => {
  const t = boot({ M1: imp({ stock: 0 }) });
  await t.window.registrarFactura(hdr({ compNum: '1' }), [L('M1', 4, 118)]);
  await t.window.registrarFactura(hdr({ compNum: '2', compTipo: 'Boleta', ruc: '', compSerie: 'B001' }), [L('M1', 6, 60)]);
  await t.window.registrarFactura(hdr({ compNum: '', compTipo: '', ruc: '' }), [L('M1', 10, 40)]);
  const k = Object.values(t.st.costos).map(x => x.costoUnit);
  assert.deepEqual(k, [100, 60, 40]);
  const [b] = await t.window.calcularBalanceFacturable();
  assert.equal(b.costoProm, (400 + 360 + 400) / 20);
});

test('costo unitario redondeado a 2 decimales pierde dinero en lotes grandes: 1000 u. a S/59.90 con factura → costo total 50 760 en vez de 50 762.71 (balance-logic.js:49; guardar costo total o 4 decimales)', async () => {
  const t = boot({ M1: imp({ stock: 0 }) });
  await t.window.registrarFactura(hdr(), [L('M1', 1000, 59.9)]);
  const k = Object.values(t.st.costos)[0];
  assert.ok(Math.abs(k.costoUnit * k.cantidad - 59.9 * 1000 / 1.18) < 0.5);
});

// ───────────────────────── 12. ALERTAS / AJUSTES / ALMACENES ─────────────────────────
test('producto sin campo stock nunca dispara "Stock bajo": Number(undefined) <= min es false (balance-logic.js:265)', async () => {
  const t = boot({ X: { name: 'Sin stock', tipo: 'nacional', stockMin: 3 } });
  assert.ok((await t.window.calcularAlertas()).some(a => a.tipo === 'Stock bajo'));
});

test('ajustarStock: ajusta por almacén manteniendo stock == suma de almacenes y rechaza dejar Almacén 1 en negativo', async () => {
  const t = boot({ M1: { name: 'M', tipo: 'importado', stock: 10, almacenes: { alm1: 6, alm2: 4, alm3: 0 } } });
  await assert.rejects(t.window.ajustarStock('M1', 3, 'Merma', ''), /Almacén 1/);
  await t.window.ajustarStock('M1', 8, 'Merma', '');
  const p = t.st.products.M1;
  assert.equal(p.stock, p.almacenes.alm1 + p.almacenes.alm2 + p.almacenes.alm3);
});

for (const [nombre, v] of [['NaN', NaN], ['texto', '5'], ['fraccionario', 2.5], ['negativo', -1], ['Infinity', Infinity]]) {
  test(`ajustarStock/aplicarConteo con conteo ${nombre}: se rechaza y no cambia el stock`, async () => {
    const t = boot({ M1: imp({ stock: 7 }) });
    await assert.rejects(t.window.ajustarStock('M1', v, 'Merma', ''), /entero/);
    const r = await t.window.aplicarConteo([{ code: 'M1', contado: v }], 'x');
    assert.deepEqual([r.ajustados, r.errores.length, t.stock('M1')], [0, 1, 7]);
  });
}

test('INVARIANTE stock == suma de almacenes (documentado en firebase.js:673,1062) se rompe con compras, anulaciones y ventas: moverStock/decrementStock solo tocan /stock (balance-logic.js:20; firebase.js:624)', async () => {
  const t = boot({ M1: { name: 'M', tipo: 'importado', stock: 10, almacenes: { alm1: 6, alm2: 4, alm3: 0 } } });
  await t.compra({ qty: 5, docQty: 5 });
  await t.window.decrementStock([{ code: 'M1', qty: 2 }]);
  const p = t.st.products.M1;
  assert.equal(p.stock, p.almacenes.alm1 + p.almacenes.alm2 + p.almacenes.alm3);
});

// ───────────────────────── 13. FUZZ DE INVARIANTES ─────────────────────────
function rng(seed) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

async function fuzz(seed, pasos, { anularCompras }) {
  const R = rng(seed), pick = a => a[Math.floor(R() * a.length)], int = (a, b) => a + Math.floor(R() * (b - a + 1));
  const t = boot({ M1: imp({ name: 'M1' }), M2: imp({ name: 'M2' }), N1: nac({ stock: 0, name: 'N1' }), N2: nac({ stock: 0, name: 'N2' }) });
  const CODES = ['M1', 'M2', 'N1', 'N2'], orders = {};
  let seq = 0;
  const mkItems = (extraStock = {}) => {
    const n = int(1, 2), usados = new Set(), items = [];
    for (let i = 0; i < n; i++) {
      const code = pick(CODES); if (usados.has(code)) continue; usados.add(code);
      const disp = (t.stock(code) || 0) + (extraStock[code] || 0); if (disp < 1) continue;
      const it = { code, name: code, qty: int(1, Math.min(disp, 6)), price: 60, itemDiscountPct: 0 };
      if (code[0] === 'N' && R() < 0.6) it.facturarComo = pick(['M1', 'M2']);
      items.push(it);
    }
    return items;
  };
  const invariantes = async paso => {
    for (const [id, c] of t.compras()) if (c.documento) assert.ok(c.documento.cantUtilizada >= 0 && c.documento.cantUtilizada <= c.documento.cantDocumentada, `paso ${paso}: compra ${id} usada=${c.documento.cantUtilizada}/${c.documento.cantDocumentada}`);
    for (const code of CODES) assert.equal(t.stock(code), t.netMov(code), `paso ${paso}: stock ${code} != suma de movimientos`);
    if (anularCompras) return;
    const bal = await t.window.calcularBalanceFacturable();
    for (const m of ['M1', 'M2']) {
      let facturado = 0, cruzado = 0;
      Object.values(orders).filter(o => o.activa).forEach(o => o.items.forEach(i => { if (i.code === m) facturado += i.qty; else if (i.facturarComo === m) { facturado += i.qty; cruzado += i.qty; } }));
      const usadas = t.activas().filter(([, c]) => c.code === m).reduce((s, [, c]) => s + ((c.documento || {}).cantUtilizada || 0), 0);
      assert.equal(usadas + t.sinDoc(m), facturado, `paso ${paso}: documentación de ${m}: usada ${usadas} + sinDoc ${t.sinDoc(m)} != facturado ${facturado}`);
      const b = bal.find(x => x.code === m);
      assert.equal(b.usadoOtros, cruzado, `paso ${paso}: usadoOtros ${m}`);
      assert.equal(b.facturable, Math.min(b.docSaldo, b.stock));
      assert.ok(b.sinDoc >= 0 && b.docSaldo >= 0);
    }
  };
  for (let paso = 1; paso <= pasos; paso++) {
    const op = R();
    const activos = Object.entries(orders).filter(([, o]) => o.activa);
    if (op < 0.30) {
      const code = pick(['M1', 'M2', 'N1', 'N2']), qty = int(1, 10), esImp = code[0] === 'M';
      await t.compra({ code, nombre: code, tipo: esImp ? 'importado' : 'nacional', qty, docTipo: esImp && R() < 0.8 ? 'Factura' : '', docQty: int(0, qty), docNum: 'F001-' + (++seq), sinConfirmar: true });
    } else if (op < 0.60) {
      const items = mkItems(); if (!items.length) continue;
      const id = 'o' + (++seq); await t.venta(items, id); orders[id] = { items, activa: true };
    } else if (op < 0.75 && activos.length) {
      const [id, o] = pick(activos);
      for (const i of o.items) await t.window.addStock(i.code, i.qty);
      await t.window.registrarAnulacionVenta(id, o.items); o.activa = false;
    } else if (op < 0.90 && activos.length) {
      const [id, o] = pick(activos);
      for (const i of o.items) await t.window.addStock(i.code, i.qty);
      const nuevos = mkItems(); if (!nuevos.length) { for (const i of o.items) await t.window.decrementStock([{ code: i.code, qty: i.qty }]); continue; }
      const res = await t.window.decrementStock(nuevos.map(i => ({ code: i.code, qty: i.qty })));
      await t.window.registrarEdicionVenta(id, o.items, nuevos, res, 'NP'); o.items = nuevos;
    } else if (anularCompras) {
      const [id] = pick(t.activas().length ? t.activas() : [[null]]); if (!id) continue;
      await t.window.anularCompra(id).catch(() => {});
    }
    await invariantes(paso);
  }
  if (!anularCompras) {   // anular todo: debe volver exactamente al punto de partida documental
    for (const [id, o] of Object.entries(orders).filter(([, o]) => o.activa)) { for (const i of o.items) await t.window.addStock(i.code, i.qty); await t.window.registrarAnulacionVenta(id, o.items); o.activa = false; }
    for (const [id, c] of t.compras()) if (c.documento) assert.equal(c.documento.cantUtilizada, 0, `compra ${id} no volvió a 0`);
    for (const m of ['M1', 'M2', 'N1', 'N2']) assert.equal(t.sinDoc(m), 0, `sinDocumento ${m}`);
    assert.equal((await t.window.calcularCruces()).length, 0);
    const compradas = c => t.activas().filter(([, x]) => x.code === c).reduce((s, [, x]) => s + x.cantidad, 0);
    for (const c of CODES) assert.equal(t.stock(c), compradas(c), `stock final ${c}`);
  }
}

for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
  test(`fuzz invariantes (semilla ${seed}): compras/ventas/ediciones/anulaciones con "facturar como"`, { timeout: 120000 }, () => fuzz(seed, 70, { anularCompras: false }));
}
for (const seed of [11, 12, 13]) {
  test(`fuzz invariantes con anulación de compras (semilla ${seed}): stock == suma de movimientos y 0 ≤ usada ≤ documentada`, { timeout: 120000 }, () => fuzz(seed, 70, { anularCompras: true }));
}
