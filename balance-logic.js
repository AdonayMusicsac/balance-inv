// BALANCE-INV: compras, proveedores, documentos, movimientos, ajustes, kardex y alertas.
// Reutiliza db / refProducts / refOrders de firebase.js. Modelo: ver diagrama sin ciclos
// (MOVIMIENTOS referencia su origen con origenTipo + origenId, sin FK).
const refMov = db.ref('movimientos'), refCompras = db.ref('compras'), refProveedores = db.ref('proveedores'), refCostos = db.ref('costos'), refRucApi = db.ref('meta/rucApi');
const STOCK_MIN_DEFECTO = 5, SALDO_DOC_MIN = 2, TOLERANCIA_MS = 120000;
const _esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const _fmt = t => new Date(t).toLocaleString('es-PE');
const _tr = (labels, cells, attrs = '') => `<tr${attrs}>` + cells.map((c, i) => `<td data-label="${labels[i]}">${c}</td>`).join('') + '</tr>';
const _val = snap => snap.val() || {};
const _user = () => { const u = firebase.auth().currentUser || {}; return u.email || u.uid || 'desconocido'; };
const _soloAdmin = () => { if (typeof isAdmin === 'function' && !isAdmin()) throw new Error('Solo el administrador puede hacer esta operación.'); };
const _touch = code => refProducts.child(code).update({ updatedAt: firebase.database.ServerValue.TIMESTAMP }).catch(() => {});
// Cache corto de TODOS los movimientos (la vista Movimientos los pedía 5 veces seguidas: ~14 MB c/u con 50.000).
// Se invalida al registrar un movimiento propio; los de otros usuarios se ven en <=15 s.
let _movsCache = null;
const _todosMov = fresh => {
  if (fresh || !_movsCache || Date.now() - _movsCache.t > 15000) _movsCache = { t: Date.now(), p: refMov.get().then(_val).catch(e => { _movsCache = null; throw e; }) };
  return _movsCache.p;
};
const pushMov = m => { _movsCache = null; return refMov.push({ ...m, usuario: _user(), timestamp: Date.now() }); };
const stockActual = async code => Number((await refProducts.child(code).child('stock').get()).val()) || 0;

// Suma/resta stock de forma atómica. Nunca deja negativo ni crea productos fantasma.
// Mantiene stock == suma de almacenes (solo si el producto ya tiene `almacenes`): suma en Almacén 1; resta de Almacén 1 en adelante.
const _ALMS = ['alm1', 'alm2', 'alm3'];
const _almValido = a => _ALMS.includes(a) ? a : 'alm1';
// `alm` = almacén elegido: la entrada se suma ahí; la salida se resta primero de ese almacén y luego de los demás.
async function _ajustarAlmacenes(code, delta, p, alm) {
  if (!delta) return;
  const destino = _almValido(alm);
  if (!p || !p.almacenes) {
    // Producto sin reparto por almacén: se crea el reparto cuando el usuario elige un almacén de destino
    // (lo que ya había queda en Almacén 1, para que stock == suma de almacenes).
    if (!(alm && delta > 0)) return;
    const previo = Math.max(0, (Number((p || {}).stock) || 0));
    await refProducts.child(code).child('almacenes').transaction(cur => cur || { alm1: previo, alm2: 0, alm3: 0 });
  }
  const al = refProducts.child(code).child('almacenes');
  if (delta > 0) { await al.child(destino).transaction(cur => (Number(cur) || 0) + delta); return; }
  let resto = -delta;
  for (const id of [destino, ..._ALMS.filter(x => x !== destino)]) {
    if (resto <= 0) break;
    let tomado = 0;
    await al.child(id).transaction(cur => { cur = Number(cur) || 0; tomado = Math.min(cur, resto); return cur - tomado; });
    resto -= tomado;
  }
}
async function moverStock(code, delta, alm) {
  const p = _val(await refProducts.child(code).get());
  if (!Object.keys(p).length || p.deleted) throw new Error('El producto ya no existe.');
  const r = await refProducts.child(code).child('stock').transaction(cur => {
    const n = (Number(cur) || 0) + delta;
    return n < 0 ? undefined : n;
  });
  if (!r.committed) throw new Error('Stock insuficiente para esta operación.');
  await _ajustarAlmacenes(code, delta, p, alm);
  _touch(code);
  return Number(r.snapshot.val());
}

const IGV = 1.18;   // Los precios de ADONAY incluyen IGV 18 % (igual que su Control_Contable).
const _r2 = n => Math.round(+((n + Number.EPSILON) * 100).toPrecision(15)) / 100;   // ROUND de Excel: absorbe el error binario (2.135 -> 2.14)
const _CODE_OK = /^[^.#$\[\]\/]+$/;
const _precioNum = p => (p == null || p === '' || typeof p === 'boolean') ? NaN : Number(p);
// Clave de proveedor: RUC (trim) o nombre normalizado (trim, espacios simples, mayúsculas).
const _provKey = (ruc, nombre) => (String(ruc || '').trim() || String(nombre || '').trim().replace(/\s+/g, ' ').toUpperCase()).replace(/[.#$\[\]\/]/g, '_');
// Comprobante normalizado: serie en mayúsculas sin espacios; número sin espacios ni ceros a la izquierda.
const _numComprobante = (serie, numero) => [String(serie || '').trim().toUpperCase(), String(numero || '').trim().replace(/^0+(?=\d)/, '')].filter(Boolean).join('-');
// Igual que el Excel: Total = cant × precio; Base = ROUND(total / 1.18, 2); IGV = Total − Base.
const calcularImportes = window.calcularImportes = (qty, precio) => { const total = _r2(qty * precio), base = _r2(total / IGV); return { total, base, igv: _r2(total - base) }; };

async function registrarCompra(c) {
  if (!c.code) throw new Error('Elige un producto.');
  if (!_CODE_OK.test(String(c.code))) throw new Error('Código de producto inválido.');
  if (!Number.isInteger(c.qty) || c.qty < 1) throw new Error('La cantidad debe ser un entero mayor a 0.');
  const precio = _precioNum(c.precio);
  if (!Number.isFinite(precio) || precio < 0) throw new Error('Precio de compra inválido.');
  if (!String(c.proveedor || '').trim()) throw new Error('Indica el proveedor.');
  c = { ...c, proveedor: String(c.proveedor).trim(), nombre: c.nombre || c.code, precio };
  if (!c.fecha || isNaN(new Date(c.fecha))) throw new Error('Fecha inválida.');
  if (c.docTipo && !(c.docQty >= 0 && c.docQty <= c.qty)) throw new Error('La cantidad documentada debe estar entre 0 y la cantidad comprada.');
  if (c.tipo === 'importado' && !c.docTipo && !c.sinConfirmar && !confirm('Es un producto importado sin documento. ¿Guardar igual? Quedará como "documentación pendiente".')) throw new Error('Compra no guardada.');
  const provKey = _provKey(c.ruc, c.proveedor);
  const doc = c.docTipo ? { tipo: c.docTipo, numero: c.docNum || '', cantDocumentada: c.docQty || 0, cantUtilizada: 0 } : null;
  if (c.moneda === 'USD' && !(c.tc > 0)) throw new Error('Indica el tipo de cambio (soles por dólar).');
  const tc = c.moneda === 'USD' ? c.tc : 1, gastos = c.gastos > 0 ? c.gastos : 0;
  const imp = calcularImportes(c.qty, c.precio * tc);
  // Costo real en soles. Con factura el IGV es crédito fiscal, así que el costo es el precio sin IGV.
  const baseUnit = c.igvIncluido && c.docTipo === 'Factura' ? c.precio / IGV : c.precio;
  const costoTotal = _r2(baseUnit * tc * c.qty + gastos), costoUnit = Math.round((costoTotal / c.qty + Number.EPSILON) * 10000) / 10000;   // 4 decimales + total: sin perder céntimos en lotes grandes
  const facturaKey = c.docTipo && c.docNum ? `${provKey}|${c.docTipo}|${c.docNum}` : '';
  const almacen = _almValido(c.almacen);
  const saldo = await moverStock(c.code, c.qty, almacen);
  const ref = refCompras.push();
  try {   // si algo falla después de mover el stock, se revierte todo
    await refProducts.child(c.code).update({ tipo: c.tipo || 'nacional', ...(c.stockMin >= 0 ? { stockMin: c.stockMin } : {}) });
    await refProveedores.child(provKey).update({ nombre: c.proveedor, ruc: c.ruc || '' });
    await ref.set({ code: c.code, nombre: c.nombre, proveedorId: provKey, proveedor: c.proveedor, ruc: c.ruc || '', cantidad: c.qty, precio: c.precio || 0, moneda: c.moneda || 'PEN',
      unidad: c.unidad || '', base: imp.base, igv: imp.igv, total: imp.total, pago: c.pago || '', nOperacion: c.nOperacion || '', estadoPago: c.estadoPago || '', observ: c.observ || '',
      facturaId: c.facturaId || '', facturaKey, fecha: c.fecha, documento: doc, almacen, timestamp: Date.now() });
    await refCostos.child(ref.key).set({ code: c.code, costoUnit, costoTotal, moneda: c.moneda || 'PEN', tc, gastos, cantidad: c.qty, timestamp: Date.now() });
    await pushMov({ code: c.code, nombre: c.nombre, tipo: 'compra', cantidad: c.qty, saldoResultante: saldo, origenTipo: 'compra', origenId: ref.key, almacen });
  } catch (e) {
    await moverStock(c.code, -c.qty, almacen).catch(() => {});
    await ref.remove().catch(() => {});
    await refCostos.child(ref.key).remove().catch(() => {});
    throw e;
  }
  return ref.key;
}

// Productos que nacen en la compra. Importado: código y descripción de la factura del proveedor.
// Nacional: no trae código, el sistema le pone NAC-0001, NAC-0002… (se puede escribir otro).
// El precio público y el de tienda NO se piden aquí: se ponen aparte en Stock.
const _claveCodigo = c => String(c || '').trim().toUpperCase().replace(/\//g, '⁄');
async function _codigosNacionales(cantidad, extra = []) {
  const usados = new Set(Object.keys(_val(await refProducts.get())).map(k => k.toUpperCase()));
  extra.forEach(k => usados.add(String(k).toUpperCase()));
  let n = 0; usados.forEach(k => { const m = k.match(/^NAC-(\d+)$/); if (m) n = Math.max(n, Number(m[1])); });
  const out = []; while (out.length < cantidad) { n++; const c = 'NAC-' + String(n).padStart(4, '0'); if (!usados.has(c)) out.push(c); }
  return out;
}
async function _crearProducto(n) {
  const r = await refProducts.child(n.code).transaction(cur => (cur !== null && !cur.deleted) ? undefined : { name: n.nombre, desc: n.desc || '', price: 0, stock: 0, category: 'general', tipo: n.tipo, creadoDesdeCompra: true, updatedAt: Date.now() });
  if (!r.committed) { const e = new Error(`Ya existe un producto con el código ${n.code}. Elígelo de la lista en vez de crearlo.`); e.yaExiste = true; throw e; }
}

// Una factura/boleta con varios productos (como una fila-grupo del Excel). Todo o nada:
// si una línea falla, se revierten las anteriores con movimientos inversos y se quitan los productos creados.
async function registrarFactura(h, lineas) {
  if (!Array.isArray(lineas) || !lineas.length) throw new Error('Agrega al menos un producto.');
  if (!String(h.proveedor || '').trim()) throw new Error('Indica el proveedor.');
  lineas.forEach((l, i) => {
    if (l.nuevo) {
      if (!String(l.nuevo.nombre || '').trim()) throw new Error(`Línea ${i + 1}: escribe la descripción del producto nuevo.`);
      if (!['nacional', 'importado'].includes(l.nuevo.tipo)) throw new Error(`Línea ${i + 1}: elige si el producto nuevo es Nacional o Importado.`);
      if (l.nuevo.tipo === 'importado' && !String(l.nuevo.code || '').trim()) throw new Error(`Línea ${i + 1}: el producto importado necesita el código que trae la factura.`);
      if (/[.#$\[\]]/.test(l.nuevo.code || '')) throw new Error(`Línea ${i + 1}: el código no puede llevar . # $ [ ]`);
    } else if (!l.code) throw new Error(`Línea ${i + 1}: elige un producto.`);
    else if (!_CODE_OK.test(String(l.code))) throw new Error(`Línea ${i + 1}: código de producto inválido.`);
    if (!Number.isInteger(l.qty) || l.qty < 1) throw new Error(`Línea ${i + 1}: la cantidad debe ser un entero mayor a 0.`);
    if (!(_precioNum(l.precio) >= 0) || !Number.isFinite(_precioNum(l.precio))) throw new Error(`Línea ${i + 1}: precio inválido.`);
  });
  const conComp = !!h.compTipo;
  if (conComp && !h.compNum) throw new Error('Indica el número del comprobante.');
  if (h.compTipo === 'Factura' && !(h.ruc || '').match(/^\d{11}$/)) throw new Error('Una factura necesita el RUC del proveedor (11 dígitos).');
  const num = conComp ? _numComprobante(h.compSerie, h.compNum) : '';
  const provKey = _provKey(h.ruc, h.proveedor);
  // Reserva del comprobante (transacción) antes de mover stock: dos registros simultáneos no pasan ambos.
  let liberar = async () => {};
  if (conComp) {
    const lockRef = refProveedores.child(provKey).child('comprobantes').child(`${h.compTipo}|${num}`.replace(/[.#$\[\]\/]/g, '_'));
    const r = await lockRef.transaction(cur => (cur && Date.now() - (Number(cur.t) || 0) < 120000) ? undefined : { t: Date.now() });
    if (!r.committed) throw new Error(`El comprobante ${num} de ${h.proveedor} se está registrando en este momento. Espera unos segundos.`);
    liberar = () => lockRef.remove().catch(() => {});
  }
  try {
  if (conComp) {
    const dup = Object.values(_val(await refCompras.orderByChild('facturaKey').equalTo(`${provKey}|${h.compTipo}|${num}`).get())).find(c => !c.anulada);
    if (dup) throw new Error(`El comprobante ${num} de ${h.proveedor} ya fue registrado el ${dup.fecha}.`);
  }
  const nuevos = lineas.filter(l => l.nuevo);
  const sinCodigo = nuevos.filter(l => !String(l.nuevo.code || '').trim());
  const manuales = nuevos.filter(l => String(l.nuevo.code || '').trim()).map(l => _claveCodigo(l.nuevo.code));
  const gen = sinCodigo.length ? await _codigosNacionales(sinCodigo.length, manuales) : [];
  sinCodigo.forEach((l, i) => { l.nuevo.code = gen[i]; });
  const autogen = new Set(sinCodigo);
  const codigos = nuevos.map(l => _claveCodigo(l.nuevo.code));
  if (new Set(codigos).size !== codigos.length) throw new Error('Hay dos productos nuevos con el mismo código en esta compra.');
  if (lineas.some(l => l.tipo === 'importado' || (l.nuevo && l.nuevo.tipo === 'importado')) && !conComp && !h.sinConfirmar && !confirm('Hay productos importados sin comprobante. ¿Guardar igual? Quedarán como "documentación pendiente".')) throw new Error('Compra no guardada.');
  const facturaId = 'F' + Date.now().toString(36), hechas = [], creados = [], fallos = [];
  try {
    for (const l of nuevos) {
      for (let intento = 0; ; intento++) {
        const code = _claveCodigo(l.nuevo.code);
        try { await _crearProducto({ code, nombre: l.nuevo.nombre.trim(), desc: String(l.nuevo.desc || '').trim(), tipo: l.nuevo.tipo }); creados.push(code); break; }
        catch (e) {   // código autogenerado ocupado por una operación simultánea: se genera otro
          if (!(e.yaExiste && autogen.has(l) && intento < 5)) throw e;
          l.nuevo.code = (await _codigosNacionales(1, nuevos.map(x => _claveCodigo(x.nuevo.code))))[0];
        }
      }
    }
    for (const l of lineas) {
      const c0 = l.nuevo ? { code: _claveCodigo(l.nuevo.code), nombre: l.nuevo.nombre.trim(), tipo: l.nuevo.tipo } : {};
      const id = await registrarCompra({ proveedor: h.proveedor, ruc: h.ruc, fecha: h.fecha, pago: h.pago, nOperacion: h.nOperacion, estadoPago: h.estadoPago, observ: h.observ, almacen: l.almacen || h.almacen, moneda: h.moneda === 'USD' ? 'USD' : 'PEN', tc: h.tc, ...l, ...c0,
        docTipo: conComp ? h.compTipo : '', docNum: num, docQty: conComp ? l.qty : 0, igvIncluido: true, facturaId, sinConfirmar: true });
      hechas.push(id);
    }
  } catch (e) {
    for (const id of hechas.reverse()) await _revertirCompra(id).catch(x => { fallos.push(`compra ${id}: ${x.message}`); });
    for (const code of creados) await refProducts.child(code).remove().catch(x => { fallos.push(`producto ${code}: ${x.message}`); });
    if (fallos.length) throw new Error(`${e.message} | Rollback parcial: no se pudo revertir todo (${fallos.join('; ')}). Revisa manualmente la factura ${facturaId} en Compras y Kardex.`);
    throw e;
  }
  return { facturaId, ids: hechas, creados, ...lineas.reduce((a, l) => { const i = calcularImportes(l.qty, Number(l.precio)); return { total: _r2(a.total + i.total), base: _r2(a.base + i.base), igv: _r2(a.igv + i.igv) }; }, { total: 0, base: 0, igv: 0 }) };
  } finally { await liberar(); }
}

// Corrige una compra con un movimiento inverso (nunca borra historial).
async function _revertirCompra(id) {
  const c = _val(await refCompras.child(id).get());
  if (!c.code) throw new Error('La compra no existe.');
  const flag = await refCompras.child(id).child('anulada').transaction(cur => cur ? undefined : true);
  if (!flag.committed) throw new Error('Esta compra ya está anulada.');
  try {
    const saldo = await moverStock(c.code, -c.cantidad, c.almacen);
    await pushMov({ code: c.code, nombre: c.nombre, tipo: 'anulacion_compra', cantidad: -c.cantidad, saldoResultante: saldo, origenTipo: 'compra', origenId: id, ...(c.almacen ? { almacen: c.almacen } : {}) });
  } catch (e) {
    await refCompras.child(id).child('anulada').remove().catch(() => {});
    throw new Error(/insuficiente/.test(e.message) ? 'No se puede anular: parte de esa mercadería ya se vendió.' : e.message);
  }
}
async function anularCompra(id) { _soloAdmin(); return _revertirCompra(id); }
// Quita del historial una compra YA anulada (su stock ya fue revertido). El kardex conserva los movimientos.
async function eliminarCompraAnulada(id) {
  _soloAdmin();
  const c = _val(await refCompras.child(id).get());
  if (!c.code) throw new Error('La compra no existe.');
  if (!c.anulada) throw new Error('Solo se pueden eliminar compras anuladas. Anúlala primero.');
  await refCostos.child(id).remove().catch(() => {});
  await refCompras.child(id).remove();
  await _quitarProductoHuerfano(c.code);
}
// Un producto que nació de una compra y quedó sin uso (stock 0, sin precio de venta, sin otras compras ni ventas/ajustes) se quita de Stock.
async function _quitarProductoHuerfano(code) {
  try {
    const p = _val(await refProducts.child(code).get());
    if (!p.name || p.deleted || (Number(p.stock) || 0) !== 0 || (Number(p.price) || 0) !== 0) return false;
    const otras = Object.values(_val(await refCompras.orderByChild('code').equalTo(code).get())).filter(x => !x.anulada);
    if (otras.length) return false;
    const movs = Object.values(_val(await refMov.orderByChild('code').equalTo(code).get()));
    if (movs.some(m => m.tipo !== 'compra' && m.tipo !== 'anulacion_compra')) return false;
    await refProducts.child(code).remove();
    return true;
  } catch (e) { return false; }
}
// Anular de verdad: devuelve el stock, quita la compra de la lista y elimina el producto si solo existía por esa compra. El kardex conserva el movimiento.
async function anularYQuitarCompra(id) { await anularCompra(id); await eliminarCompraAnulada(id); }
async function limpiarComprasAnuladas() {
  _soloAdmin();
  const ids = Object.entries(await refCompras.get().then(_val)).filter(([, c]) => c.anulada).map(([id]) => id);
  for (const id of ids) await eliminarCompraAnulada(id);
  return ids.length;
}

// Documentación: se consume la más antigua primero; devuelve lo que quedó sin respaldo.
async function _recorrerDocs(code, orden, resto, fn) {
  const compras = _val(await refCompras.orderByChild('code').equalTo(code).get());
  for (const [id, c] of Object.entries(compras).sort((a, b) => orden * (a[1].timestamp - b[1].timestamp))) {
    if (resto <= 0) break;
    if (c.anulada || !c.documento) continue;
    let mov = 0;
    const r = await refCompras.child(id).child('documento/cantUtilizada').transaction(cur => {
      cur = Number(cur) || 0; mov = fn(c.documento, cur, resto);
      return mov > 0 ? cur + (orden > 0 ? mov : -mov) : undefined;
    });
    if (r.committed) resto -= mov;
  }
  return resto;
}
const consumirDocumentacion = (code, qty) => _recorrerDocs(code, 1, qty, (d, cur, rest) => Math.min((d.cantDocumentada || 0) - cur, rest));
const devolverDocumentacion = (code, qty) => _recorrerDocs(code, -1, qty, (d, cur, rest) => Math.min(cur, rest));

// Se llama DESPUÉS de guardar la nota, para no registrar ventas que no ocurrieron.
const _montoItem = it => _r2((Number(it.price) || 0) * (Number(it.qty) || 0) * (1 - (Number(it.itemDiscountPct) || 0) / 100));
// "Facturar como": a veces se vende un producto (nacional) pero el comprobante sale con el nombre y valor
// de un importado que tiene documentación. El stock físico baja en lo que de verdad se entregó y
// la documentación se gasta en el importado con el que se facturó.
const _validarItemsVenta = items => (items || []).forEach(it => { if (!(typeof it.qty === 'number' && Number.isFinite(it.qty) && it.qty > 0)) throw new Error(`Cantidad inválida para ${it.code}.`); });
async function registrarSalidaVenta(items, orderId, results, numero) {
  _validarItemsVenta(items);
  const pend = [...(results || [])];   // un resultado por línea, en orden (mismo código en varias líneas)
  for (const it of items) {
    const ri = pend.findIndex(r => r.code === it.code), res = ri >= 0 ? pend.splice(ri, 1)[0] : undefined;
    const p = _val(await refProducts.child(it.code).get());
    const sinDoc = p.tipo === 'importado' ? await consumirDocumentacion(it.code, it.qty) : 0;
    const comoCode = p.tipo !== 'importado' && it.facturarComo && it.facturarComo !== it.code ? it.facturarComo : '';
    const como = comoCode ? _val(await refProducts.child(comoCode).get()) : {};
    const cruza = !!(comoCode && Object.keys(como).length && !como.deleted && como.tipo === 'importado');
    await pushMov({ code: it.code, nombre: it.name || p.name || it.code, tipo: 'venta', cantidad: -it.qty,
      saldoResultante: res && res.newStock != null ? res.newStock : await stockActual(it.code),
      origenTipo: 'venta', origenId: orderId, referencia: numero || '', sinDocumento: sinDoc,
      ...(cruza ? { facturadoComo: comoCode, facturadoComoNombre: como.name || comoCode } : {}) });
    if (cruza) {
      const sd = await consumirDocumentacion(comoCode, it.qty);
      await pushMov({ code: comoCode, nombre: como.name || comoCode, tipo: 'facturacion_cruzada', cantidad: 0, cantDoc: it.qty, monto: _montoItem(it),
        saldoResultante: Number(como.stock) || 0, origenTipo: 'venta', origenId: orderId, referencia: numero || '',
        cruzadaDe: it.code, cruzadaNombre: it.name || p.name || it.code, sinDocumento: sd });
    }
  }
}
async function registrarAnulacionVenta(orderId, items, ajusteSaldo = {}) {
  const movsO = Object.values(_val(await refMov.orderByChild('origenId').equalTo(orderId).get()));
  const vend = {}, anul = {};   // ya anulada: si lo anulado cubre lo vendido de ese código, no se repite (la edición vuelve a vender y reabre)
  movsO.forEach(m => { if (m.tipo === 'venta') vend[m.code] = (vend[m.code] || 0) - m.cantidad; else if (m.tipo === 'anulacion_venta') anul[m.code] = (anul[m.code] || 0) + m.cantidad; });
  const neto = {}, cruz = {};   // neto: sinDocumento por producto · cruz: unidades de documentación gastadas con otro producto
  movsO.forEach(m => {
    if (m.cruzadaDe) { const k = `${m.code}|${m.cruzadaDe}`; cruz[k] = cruz[k] || { cant: 0, sd: 0, monto: 0 }; cruz[k].cant += m.cantDoc || 0; cruz[k].sd += m.sinDocumento || 0; cruz[k].monto += m.monto || 0; }
    else neto[m.code] = (neto[m.code] || 0) + (m.sinDocumento || 0);
  });
  for (const it of items || []) {
    if (anul[it.code] > 0 && anul[it.code] >= (vend[it.code] || 0)) continue;   // ya anulada: no-op
    anul[it.code] = (anul[it.code] || 0) + it.qty;
    const sinDoc = Math.min(Math.max(0, neto[it.code] || 0), it.qty);
    if (it.qty - sinDoc > 0) await devolverDocumentacion(it.code, it.qty - sinDoc);
    neto[it.code] = (neto[it.code] || 0) - sinDoc;
    await pushMov({ code: it.code, nombre: it.name || it.code, tipo: 'anulacion_venta', cantidad: it.qty, saldoResultante: (await stockActual(it.code)) + (ajusteSaldo[it.code] || 0), origenTipo: 'venta', origenId: orderId, sinDocumento: -sinDoc });
    const k = it.facturarComo ? `${it.facturarComo}|${it.code}` : '', x = k && cruz[k];
    if (x && x.cant > 0) {
      const q = Math.min(it.qty, x.cant), sd = Math.min(Math.max(0, x.sd), q), nombre = _val(await refProducts.child(it.facturarComo).get());
      if (q - sd > 0) await devolverDocumentacion(it.facturarComo, q - sd);
      await pushMov({ code: it.facturarComo, nombre: nombre.name || it.facturarComo, tipo: 'anulacion_facturacion_cruzada', cantidad: 0, cantDoc: -q, monto: -_r2(x.monto * q / x.cant),
        saldoResultante: Number(nombre.stock) || 0, origenTipo: 'venta', origenId: orderId, cruzadaDe: it.code, cruzadaNombre: it.name || it.code, sinDocumento: -sd });
      x.cant -= q; x.sd -= sd; x.monto -= _r2(x.monto * q / (x.cant + q));
    }
  }
}
// Editar una nota = anular lo anterior + registrar lo nuevo (el Kardex muestra ambos pasos).
async function registrarEdicionVenta(orderId, itemsAntes, itemsNuevos, results, numero) {
  _validarItemsVenta(itemsNuevos);
  const nuevo = {}; itemsNuevos.forEach(i => { nuevo[i.code] = (nuevo[i.code] || 0) + i.qty; });
  await registrarAnulacionVenta(orderId, itemsAntes, nuevo);
  await registrarSalidaVenta(itemsNuevos, orderId, results, numero);
}
// Antes de vender: avisa (sin bloquear) si un importado no tiene documentación suficiente.
async function avisoSinDocumento(items) {
  const codes = [];
  items.forEach(i => { codes.push(i.code); if (i.facturarComo) codes.push(i.facturarComo); });
  const bal = await calcularBalanceFacturable({ soloCodes: codes }), pide = {}, prods = {};
  await Promise.all([...new Set(codes.filter(Boolean))].map(async c => { prods[c] = _val(await refProducts.child(c).get()); }));
  items.forEach(i => { const esImp = (prods[i.code] || {}).tipo === 'importado', k = esImp ? i.code : (i.facturarComo || ''); if (k) { pide[k] = pide[k] || { qty: 0, cruzado: !esImp }; pide[k].qty += i.qty; if (!esImp) pide[k].cruzado = true; } });
  const falta = Object.entries(pide).map(([code, d]) => { const x = bal.find(y => y.code === code); const disp = x ? (d.cruzado ? x.docSaldo : x.facturable) : 0; return x && d.qty > disp ? `• ${x.nombre}: facturas ${d.qty}, con documento hay ${disp}` : null; }).filter(Boolean);
  return falta.length ? confirm('Estos importados NO tienen documentación suficiente para boleta o factura:\n\n' + falta.join('\n') + '\n\n¿Vender de todas formas?') : true;
}

// Ajuste con motivo (conteo físico, merma, robo...). Reemplaza la edición "a ciegas".
async function ajustarStock(code, contado, motivo, nota) {
  _soloAdmin();
  if (!Number.isInteger(contado) || contado < 0) throw new Error('La cantidad contada debe ser un entero de 0 o más.');
  if (!motivo) throw new Error('Elige el motivo del ajuste.');
  if (motivo === 'Otro' && !(nota || '').trim()) throw new Error('Explica el motivo en la nota.');
  const p = _val(await refProducts.child(code).get());
  if (!Object.keys(p).length || p.deleted) throw new Error('El producto ya no existe.');
  if (p.almacenes && (Number(p.almacenes.alm1) || 0) + (contado - (Number(p.stock) || 0)) < 0) throw new Error('El ajuste dejaría el Almacén 1 en negativo. Ajusta por almacén desde Stock.');
  let antes = 0;
  const r = await refProducts.child(code).child('stock').transaction(cur => { antes = Number(cur) || 0; return contado; });
  if (!r.committed) throw new Error('No se pudo ajustar. Intenta de nuevo.');
  const delta = contado - antes;
  if (delta === 0) return 0;
  if (p.almacenes) await refProducts.child(code).child('almacenes/alm1').transaction(cur => (Number(cur) || 0) + delta);
  _touch(code);
  await pushMov({ code, nombre: p.name || code, tipo: 'ajuste', cantidad: delta, saldoResultante: contado, motivo, nota: (nota || '').trim() });
  return delta;
}
// Lo llama saveProduct cuando alguien cambia el stock a mano desde la pantalla Stock.
const registrarAjusteManual = async (code, antes, despues) =>
  pushMov({ code, nombre: _val(await refProducts.child(code).get()).name || code, tipo: 'ajuste', cantidad: despues - antes, saldoResultante: despues, motivo: 'Edición manual en Stock' });

async function calcularAlertas() {
  const [prods, compras, movs] = await Promise.all([refProducts.get().then(_val), refCompras.get().then(_val), _todosMov(true)]);
  const out = [], agg = {}, ultimo = {}, sinDoc = {}, ahora = Date.now();
  Object.values(compras).filter(c => !c.anulada).forEach(c => {
    const a = agg[c.code] = agg[c.code] || { cant: 0, doc: 0, usada: 0 };
    a.cant += c.cantidad || 0;
    if (c.documento) { a.doc += c.documento.cantDocumentada || 0; a.usada += c.documento.cantUtilizada || 0; }
  });
  Object.values(movs).forEach(m => {
    if (!ultimo[m.code] || m.timestamp > ultimo[m.code].timestamp) ultimo[m.code] = m;
    sinDoc[m.code] = (sinDoc[m.code] || 0) + (m.sinDocumento || 0);
  });
  for (const [code, p] of Object.entries(prods)) {
    if (p.deleted) continue;
    const nom = p.name || code, min = p.stockMin != null ? Number(p.stockMin) : STOCK_MIN_DEFECTO;
    if ((Number(p.stock) || 0) <= min) out.push({ tipo: 'Stock bajo', msg: `${nom}: quedan ${p.stock || 0} (mín. ${min})` });
    if (p.tipo === 'importado') {
      const a = agg[code] || { cant: 0, doc: 0, usada: 0 }, saldo = a.doc - a.usada;
      if (a.cant > a.doc) out.push({ tipo: 'Documentación pendiente', msg: `${nom}: ${a.cant - a.doc} sin documento` });
      else if (a.doc > 0 && saldo <= SALDO_DOC_MIN) out.push({ tipo: 'Saldo próximo a agotarse', msg: `${nom}: saldo documentado ${saldo}.` });
      if (sinDoc[code] > 0) out.push({ tipo: 'Vendido sin documentación', msg: `${nom}: ${sinDoc[code]} unidades vendidas sin respaldo documental.` });
    }
    const u = ultimo[code];   // tolerancia: una operación en curso aún puede no haber dejado su movimiento
    if (u && ahora - u.timestamp > TOLERANCIA_MS && Number(u.saldoResultante) !== (Number(p.stock) || 0)) out.push({ tipo: 'Diferencia detectada', msg: `${nom}: stock ${p.stock}, el Kardex dice ${u.saldoResultante}` });
  }
  return out;
}

// Balance de importados: lo que se puede facturar/boletear (tiene documento) vs lo que no.
// facturable = min(saldo documentado, stock físico); sinDocumento = stock - facturable.
async function calcularBalanceFacturable(opts) {
  const admin = typeof isAdmin !== 'function' || isAdmin();
  // opts.soloCodes: solo esos productos (rápido: ~20 KB en vez de bajar compras, costos y movimientos enteros).
  const solo = opts && opts.soloCodes ? [...new Set(opts.soloCodes.filter(Boolean))] : null;
  let prods, compras, costos;
  if (solo) {
    prods = {}; compras = {}; costos = {};
    await Promise.all(solo.map(async code => {
      const [pv, cv] = await Promise.all([refProducts.child(code).get(), refCompras.orderByChild('code').equalTo(code).get()]);
      const p = pv.val(); if (p) prods[code] = p;
      Object.assign(compras, cv.val() || {});
    }));
  } else {
    [prods, compras, costos] = await Promise.all([refProducts.get().then(_val), refCompras.get().then(_val), admin ? refCostos.get().then(_val).catch(() => ({})) : {}]);
  }
  const acum = {};   // costo promedio ponderado por producto (solo compras vigentes)
  Object.entries(costos).forEach(([id, k]) => { if (compras[id] && !compras[id].anulada) { const a = acum[k.code] = acum[k.code] || { t: 0, q: 0 }; a.t += k.costoTotal != null ? k.costoTotal : k.costoUnit * k.cantidad; a.q += k.cantidad; } });
  const saldoDoc = {}, docTotal = {}, cruzadoPor = {};
  if (!solo && typeof refMov !== 'undefined') Object.values(await _todosMov().catch(() => ({}))).forEach(m => { if (m.cruzadaDe) cruzadoPor[m.code] = (cruzadoPor[m.code] || 0) + (m.cantDoc || 0); });
  Object.values(compras).filter(c => !c.anulada && c.documento).forEach(c => {
    docTotal[c.code] = (docTotal[c.code] || 0) + (c.documento.cantDocumentada || 0);
    saldoDoc[c.code] = (saldoDoc[c.code] || 0) + Math.max(0, (c.documento.cantDocumentada || 0) - (c.documento.cantUtilizada || 0));
  });
  return Object.entries(prods).filter(([, p]) => !p.deleted && p.tipo === 'importado').map(([code, p]) => {
    const stock = Number(p.stock) || 0, min = p.stockMin != null ? Number(p.stockMin) : STOCK_MIN_DEFECTO;
    const facturable = Math.max(0, Math.min(saldoDoc[code] || 0, stock)), sinDoc = Math.max(0, stock - facturable), precio = Number(p.price) || 0;
    const accion = facturable <= min ? 'Comprar o documentar más' : sinDoc > 0 ? 'Regularizar documentos' : 'Suficiente';
    const costoProm = acum[code] && acum[code].q ? acum[code].t / acum[code].q : null;
    return { code, nombre: p.name || code, stock, docSaldo: saldoDoc[code] || 0, docTotal: docTotal[code] || 0, usadoOtros: cruzadoPor[code] || 0, facturable, sinDoc, precio, costoProm, margenPct: costoProm != null && precio > 0 ? (precio - costoProm) / precio * 100 : null, montoFact: facturable * precio, montoSin: sinDoc * precio, accion };
  }).sort((a, b) => (a.accion === 'Suficiente') - (b.accion === 'Suficiente') || a.facturable - b.facturable);
}


// Costo de compra por producto (solo admin lo puede leer): promedio ponderado y último costo, ignorando compras anuladas.
async function costosPorProducto() {
  const [costos, compras] = await Promise.all([refCostos.get().then(_val), refCompras.get().then(_val)]);
  const out = {};
  Object.entries(costos).filter(([id]) => compras[id] && !compras[id].anulada).sort((a, b) => (a[1].timestamp || 0) - (b[1].timestamp || 0)).forEach(([id, k]) => {
    const o = out[k.code] = out[k.code] || { t: 0, q: 0, ultimo: 0, fecha: '' };
    o.t += k.costoTotal != null ? k.costoTotal : k.costoUnit * k.cantidad; o.q += k.cantidad; o.ultimo = k.costoUnit; o.fecha = compras[id].fecha || '';
  });
  Object.values(out).forEach(o => { o.prom = o.q ? o.t / o.q : 0; });
  return out;
}

// Ventas donde el comprobante salió con el nombre de un importado pero se entregó otro producto.
async function calcularCruces() {
  const movs = Object.values(await _todosMov()), out = {};
  movs.filter(m => m.cruzadaDe).forEach(m => {
    const k = `${m.cruzadaDe}|${m.code}`, x = out[k] = out[k] || { entregadoCode: m.cruzadaDe, entregado: m.cruzadaNombre, comoCode: m.code, como: m.nombre, qty: 0, monto: 0 };
    x.qty += m.cantDoc || 0; x.monto = _r2(x.monto + (m.monto || 0));
  });
  return Object.values(out).filter(x => x.qty > 0).sort((a, b) => b.monto - a.monto);
}

// Conteo físico masivo: aplica varios ajustes seguidos y devuelve el resumen.
async function aplicarConteo(lista, nota) {
  const res = { ajustados: 0, iguales: 0, errores: [] };
  for (const { code, contado } of lista) {
    try { (await ajustarStock(code, contado, 'Conteo físico', nota)) ? res.ajustados++ : res.iguales++; }
    catch (e) { res.errores.push(`${code}: ${e.message}`); }
  }
  return res;
}
// Reportes de gestión: dinero parado, rotación y compras por proveedor.
async function calcularReportes(dias = { parado: 90, rotacion: 30 }) {
  const [prods, movs, compras] = await Promise.all([refProducts.get().then(_val), _todosMov(), refCompras.get().then(_val)]);
  const ahora = Date.now(), ultimo = {}, vendido = {}, prov = {};
  Object.values(movs).forEach(m => {
    if (!ultimo[m.code] || m.timestamp > ultimo[m.code]) ultimo[m.code] = m.timestamp;
    if (ahora - m.timestamp <= dias.rotacion * 864e5) {
      if (m.tipo === 'venta') vendido[m.code] = (vendido[m.code] || 0) - m.cantidad;
      if (m.tipo === 'anulacion_venta') vendido[m.code] = (vendido[m.code] || 0) - m.cantidad;   // cantidad positiva: resta lo vendido
    }
  });
  Object.values(compras).filter(c => !c.anulada).forEach(c => { const p = prov[c.proveedor] = prov[c.proveedor] || { compras: 0, unidades: 0 }; p.compras++; p.unidades += c.cantidad; });
  const activos = Object.entries(prods).filter(([, p]) => !p.deleted);
  return {
    parados: activos.filter(([c, p]) => (Number(p.stock) || 0) > 0 && (!ultimo[c] || ahora - ultimo[c] > dias.parado * 864e5)).map(([c, p]) => ({ code: c, nombre: p.name || c, stock: p.stock, valor: (Number(p.stock) || 0) * (Number(p.price) || 0) })),
    top: activos.map(([c, p]) => ({ code: c, nombre: p.name || c, vendido: Math.max(0, vendido[c] || 0) })).filter(x => x.vendido > 0).sort((a, b) => b.vendido - a.vendido).slice(0, 5),
    proveedores: Object.entries(prov).map(([n, v]) => ({ nombre: n, ...v })).sort((a, b) => b.unidades - a.unidades)
  };
}

const cargarKardex = async code => Object.values(_val(await refMov.orderByChild('code').equalTo(code).get())).sort((a, b) => a.timestamp - b.timestamp);
async function exportarKardex(code, movs) {
  const s = typeof sanitizeForExcel === 'function' ? sanitizeForExcel : x => x;
  const rows = [['Fecha', 'Tipo', 'Detalle', 'Entrada', 'Salida', 'Saldo', 'Usuario']].concat(movs.map(m =>
    [_fmt(m.timestamp), m.tipo, s([m.motivo, m.nota, m.referencia, m.facturadoComoNombre ? 'Facturado como: ' + m.facturadoComoNombre : '', m.cruzadaNombre ? 'Se entregó: ' + m.cruzadaNombre + ' (' + Math.abs(m.cantDoc || 0) + ' u., documentación gastada)' : ''].filter(Boolean).join(' · ')), m.cantidad > 0 ? m.cantidad : '', m.cantidad < 0 ? -m.cantidad : '', m.saldoResultante, s(m.usuario)]));
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Kardex');
  await saveWorkbook(wb, `kardex-${code}.xlsx`);
}

// Franja de indicadores BALANCE-INV sobre el dashboard.
async function inyectarKpisBalance() {
  const root = document.getElementById('viewRoot') || document.body;
  if (document.getElementById('bkpi')) return;
  const inicio = new Date(); inicio.setHours(0, 0, 0, 0);
  const [prods, ords, al] = await Promise.all([refProducts.get().then(_val), refOrders.orderByChild('timestamp').startAt(inicio.getTime()).get().then(_val), calcularAlertas()]);
  const ps = Object.values(prods).filter(p => !p.deleted), imp = ps.filter(p => p.tipo === 'importado').length;
  const ventas = Object.values(ords).reduce((s, o) => s + (Number(o.total) || 0), 0);
  const k = (t, v, alerta) => `<div class="bal-kpi${alerta ? ' bal-kpi-alerta' : ''}"><small>${t}</small><strong>${v}</strong></div>`;
  const d = document.createElement('div'); d.id = 'bkpi'; d.className = 'bal-kpis';
  d.innerHTML = k('Importados', imp) + k('Nacionales', ps.length - imp) + k('Ventas de hoy', 'S/ ' + ventas.toFixed(2)) + k('Alertas pendientes', al.length, al.length > 0);
  const anchor = root.querySelector('.page-content') || root.querySelector('main');
  if (anchor) anchor.insertBefore(d, anchor.firstChild);
}

// Tipo y número de comprobante en la nota de venta.
function inyectarComprobante() {
  const n = document.getElementById('notaNumber');
  if (!n || document.getElementById('nnCompTipo')) return;
  const d = document.createElement('div'); d.className = 'bal-bar bal-comp';
  d.innerHTML = '<select id="nnCompTipo"><option value="">Comprobante…</option><option>Boleta</option><option>Factura</option><option>Sin comprobante</option></select><input id="nnCompNum" placeholder="N.º comprobante (ej. B001-123)">';
  n.parentElement.insertAdjacentElement('afterend', d);
}

window.Compras = {
  async init() {
    const $ = id => document.getElementById(id);
    const hoy = new Date(); hoy.setMinutes(hoy.getMinutes() - hoy.getTimezoneOffset());   // fecha local (en Lima, UTC daría "mañana" desde las 7 pm)
    $('cpDate').value = hoy.toISOString().slice(0, 10);
    let prods = await refProducts.get().then(_val);
    const NUEVO = '__nuevo__';
    const optProd = () => '<option value="">Producto…</option><option value="' + NUEVO + '">＋ Producto nuevo (aún no está en Stock)</option>' + Object.entries(prods).filter(([, p]) => !p.deleted)
      .map(([c, p]) => `<option value="${_esc(c)}">${_esc(c)} — ${_esc(p.name || '')} (${p.tipo === 'importado' ? 'Importado' : p.tipo === 'nacional' ? 'Nacional' : 'Sin clasificar'})</option>`).join('');
    const cargarProvList = async () => { $('cpProvList').innerHTML = Object.values(await refProveedores.get().then(_val)).filter(p => p.nombre && !(window.ComprasImport && ComprasImport.parecedireccion(p.nombre))).map(p => `<option value="${_esc(p.nombre)}">`).join(''); };
    await cargarProvList();
    const sol = n => 'S/ ' + Number(n || 0).toFixed(2);

    // ── líneas de producto (una factura puede traer varios) ──
    const nuevaLinea = () => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td data-label="Producto"><select class="ln-prod">${optProd()}</select>
          <div class="ln-nuevo" style="display:none">
            <input class="nv-code" placeholder="Código (importado: el de la factura · nacional: vacío = automático)">
            <input class="nv-name" placeholder="Nombre del producto">
            <input class="nv-desc" placeholder="Descripción (opcional)">
            <select class="nv-tipo"><option value="importado">Importado</option><option value="nacional">Nacional</option></select>
            <small class="bal-hint">Se crea con este código y descripción. Precios en Stock.</small>
          </div></td>
        <td data-label="Cantidad"><input class="ln-qty" type="number" min="1" inputmode="numeric" placeholder="Cant."></td>
        <td data-label="Costo c/IGV"><input class="ln-price" type="number" min="0" step="0.01" inputmode="decimal" placeholder="Costo unit. con IGV"></td>
        <td data-label="Total" class="ln-total">S/ 0.00</td>
        <td data-label=""><button type="button" class="btn ln-del">Quitar</button></td>`;
      $('cpLineas').appendChild(tr); return tr;
    };
    const lineas = () => [...$('cpLineas').querySelectorAll('tr')].map(tr => {
      const code = tr.querySelector('.ln-prod').value, esNuevo = code === NUEVO;
      return { code, esNuevo, tr, qty: Number(tr.querySelector('.ln-qty').value), precio: Number(tr.querySelector('.ln-price').value),
        nuevo: esNuevo ? { code: tr.querySelector('.nv-code').value.trim(), nombre: tr.querySelector('.nv-name').value.trim(), desc: tr.querySelector('.nv-desc').value.trim(), tipo: tr.querySelector('.nv-tipo').value } : null };
    });
    const tipoDe = l => l.esNuevo ? l.nuevo.tipo : (prods[l.code] || {}).tipo;
    const recalcular = () => {
      let t = { total: 0, base: 0, igv: 0 };
      lineas().forEach(l => { l.tr.querySelector('.ln-nuevo').style.display = l.esNuevo ? '' : 'none'; const i = calcularImportes(l.qty || 0, l.precio || 0); l.tr.querySelector('.ln-total').textContent = sol(i.total); t = { total: _r2(t.total + i.total), base: _r2(t.base + i.base), igv: _r2(t.igv + i.igv) }; });
      $('cpTotales').textContent = `Base ${sol(t.base)} · IGV 18 % ${sol(t.igv)} · Total ${sol(t.total)}`;
      const ls = lineas(), imp = ls.some(l => tipoDe(l) === 'importado'), sinTipo = ls.some(l => l.code && !l.esNuevo && !(prods[l.code] || {}).tipo);
      $('cpAviso').textContent = sinTipo ? 'Sin clasificar: se tomarán como Nacional.' : imp && !$('cpCompTipo').value ? 'Importados: registra su factura o boleta.' : '';
    };
    const tipoComp = () => { const c = $('cpCompTipo').value; document.querySelectorAll('.cp-comp').forEach(e => e.style.display = c ? '' : 'none'); recalcular(); };
    $('cpLineas').oninput = $('cpLineas').onchange = recalcular;
    $('cpLineas').onclick = e => { if (e.target.classList.contains('ln-del')) { if ($('cpLineas').children.length > 1) e.target.closest('tr').remove(); recalcular(); } };
    $('cpAddLinea').onclick = nuevaLinea;
    $('cpCompTipo').onchange = tipoComp;
    nuevaLinea(); tipoComp();

    // ── leer comprobante (XML / PDF / foto) → previsualización → rellena el formulario ──
    const aplicarBorrador = (b, guardar) => {
      if (b.almacen && $('cpAlm')) $('cpAlm').value = b.almacen;
      $('cpProv').value = b.proveedor; $('cpRuc').value = b.ruc; $('cpCompTipo').value = b.tipo;
      if (b.fecha) $('cpDate').value = b.fecha; $('cpSerie').value = (b.serie || '').toUpperCase(); $('cpNumero').value = b.numero;
      $('cpLineas').innerHTML = '';
      (b.lineas.length ? b.lineas : [{}]).forEach(l => {
        const tr = nuevaLinea(); if (!l.code) return;
        tr.querySelector('.ln-prod').value = l.code; tr.querySelector('.ln-qty').value = l.qty; tr.querySelector('.ln-price').value = l.precio;
        if (l.code === NUEVO) { tr.querySelector('.nv-code').value = l.codigoNuevo || ''; { const nom = (window.ComprasImport && ComprasImport.nombreCorto ? ComprasImport.nombreCorto(l.desc) : l.desc) || ''; tr.querySelector('.nv-name').value = nom; tr.querySelector('.nv-desc').value = nom !== (l.desc || '') ? (l.desc || '') : ''; } tr.querySelector('.nv-tipo').value = l.tipoNuevo || (l.codigoNuevo ? 'importado' : 'nacional'); }
      });
      tipoComp();
      if (guardar === true) $('cpSave').click();   // «Aprobar y guardar compra» desde el modal
    };
    if ($('cpLeer')) {
      $('cpLeer').onclick = () => $('cpArchivo').click();
      $('cpArchivo').onchange = async () => {
        const f = $('cpArchivo').files[0]; $('cpArchivo').value = ''; if (!f) return;
        if (!window.ComprasImport) return alert('El lector de comprobantes no está disponible.');
        $('cpLeer').disabled = true; $('cpLeerEstado').textContent = 'Leyendo el archivo… (una foto puede tardar unos segundos)';
        try {
          const bor = await window.ComprasImport.leerArchivo(f, t => { $('cpLeerEstado').textContent = t; }, resolverProveedor);
          window.ComprasImport.abrirPrevisualizacion(bor, prods, aplicarBorrador, nombrePorRuc); }
        catch (e) { alert(e.message); } finally { $('cpLeer').disabled = false; $('cpLeerEstado').textContent = ''; }
      };
    }

    const pintar = async () => {
      const todas = await refCompras.get().then(_val);
      const cs = Object.entries(todas).sort((a, b) => b[1].timestamp - a[1].timestamp).slice(0, 40);
      const hayAnuladas = Object.values(todas).some(c => c.anulada);
      if ($('cpLimpiar')) $('cpLimpiar').style.display = hayAnuladas ? '' : 'none';
      $('cpRows').innerHTML = cs.map(([id, c]) => _tr(['Fecha', 'Código', 'Producto', 'Proveedor', 'Cant.', 'Costo unit.', 'Total', 'Comprobante', 'Saldo doc.', ''], [_esc(c.fecha), _esc(c.code), _esc(c.nombre), _esc(c.proveedor), c.cantidad, (c.moneda === 'USD' ? 'US$ ' + Number(c.precio || 0).toFixed(2) : sol(c.precio)), c.total != null ? sol(c.total) : '—', c.documento ? _esc(c.documento.tipo + ' ' + c.documento.numero) : 'Sin comprobante', c.documento ? c.documento.cantDocumentada - c.documento.cantUtilizada : '—', c.anulada ? `Anulada <button class="btn" data-borrar="${_esc(id)}">Eliminar</button>` : `<button class="btn" data-anular="${_esc(id)}">Anular</button>`], c.anulada ? ' class="bal-anulada"' : '')).join('') || '<tr><td colspan="10">Sin compras.</td></tr>';
    };
    $('cpRows').onclick = async e => {
      const borrar = e.target.dataset && e.target.dataset.borrar;
      if (borrar) { if (!confirm('¿Quitar esta compra anulada del historial?')) return; try { await eliminarCompraAnulada(borrar); prods = await refProducts.get().then(_val); if (typeof refreshProductsNow === 'function') refreshProductsNow().catch(() => {}); await pintar(); } catch (err) { alert(err.message); } return; }
      const id = e.target.dataset && e.target.dataset.anular;
      if (!id || !confirm('¿Anular esta compra? Se descontará del stock, saldrá de la lista y, si creó productos que no se usan en nada más, también se quitan de Stock.')) return;
      try { await anularYQuitarCompra(id); prods = await refProducts.get().then(_val); if (typeof refreshProductsNow === 'function') refreshProductsNow().catch(() => {}); await pintar(); } catch (err) { alert(err.message); }
    };
    if ($('cpLimpiar')) $('cpLimpiar').onclick = async () => {
      if (!confirm('¿Quitar del historial TODAS las compras anuladas? El stock no cambia (ya se revirtió al anular).')) return;
      try { const n = await limpiarComprasAnuladas(); prods = await refProducts.get().then(_val); if (typeof refreshProductsNow === 'function') refreshProductsNow().catch(() => {}); await pintar(); alert(`Listo: ${n} compra(s) anulada(s) quitadas del historial.`); } catch (err) { alert(err.message); }
    };
    // Deja el formulario como nuevo: sin proveedor, RUC, comprobante, serie, número, forma de pago, observaciones ni productos (el almacén elegido se conserva).
    const limpiarFormulario = () => {
      const hoy2 = new Date(); hoy2.setMinutes(hoy2.getMinutes() - hoy2.getTimezoneOffset()); $('cpDate').value = hoy2.toISOString().slice(0, 10);
      ['cpProv', 'cpRuc', 'cpSerie', 'cpNumero', 'cpOp', 'cpObs'].forEach(i => { if ($(i)) $(i).value = ''; });
      ['cpCompTipo', 'cpPago', 'cpEstado'].forEach(i => { if ($(i)) $(i).selectedIndex = 0; });
      if ($('cpArchivo')) $('cpArchivo').value = '';
      if ($('cpLeerEstado')) $('cpLeerEstado').textContent = '';
      $('cpLineas').innerHTML = ''; nuevaLinea(); tipoComp(); recalcular();
    };
    if ($('cpReset')) $('cpReset').onclick = () => {
      const hayDatos = ['cpProv', 'cpRuc', 'cpSerie', 'cpNumero', 'cpObs'].some(i => $(i) && $(i).value) || $('cpLineas').querySelector('.ln-prod') && [...$('cpLineas').querySelectorAll('.ln-prod')].some(s => s.value);
      if (hayDatos && !confirm('¿Limpiar todo el formulario? Se borrará lo que has escrito (no afecta compras ya registradas).')) return;
      limpiarFormulario(); if ($('cpMsg')) $('cpMsg').style.display = 'none';
    };
    // Nombre del proveedor por su RUC: 1) el que ya se guardó en compras anteriores, 2) la API de consulta RUC (si el admin puso su token).
    const resolverProveedor = async ruc => {
      if (!/^\d{11}$/.test(String(ruc || ''))) return '';
      const pv = await refProveedores.child(ruc).get().then(sn => sn.val()).catch(() => null);
      if (pv && pv.nombre && !ComprasImport.parecedireccion(pv.nombre)) return pv.nombre;
      const cfg = await refRucApi.get().then(sn => sn.val()).catch(() => null);
      return ComprasImport.consultarRuc(ruc, cfg);
    };
    const configurarRucApi = async () => {
      if (typeof isAdmin === 'function' && !isAdmin()) return alert('Pide al administrador que configure la búsqueda por RUC.');
      const tok = prompt('Pega el token de tu servicio de consulta RUC (por ejemplo apis.net.pe o apiperu.dev).\nSe guarda en tu base de datos, no en el código. Déjalo vacío para quitarlo.');
      if (tok === null) return;
      const cfg = await refRucApi.get().then(sn => sn.val()).catch(() => null);
      const url = tok.trim() ? prompt('URL de consulta (usa {ruc} donde va el número; si tu servicio pide el token en la URL usa también {token}).', (cfg && cfg.url) || 'https://api.apis.net.pe/v2/sunat/ruc?numero={ruc}') : null;
      if (tok.trim() && url === null) return;
      await (tok.trim() ? refRucApi.set({ token: tok.trim(), url: url.trim() }) : refRucApi.remove());
      alert(tok.trim() ? 'Listo: el nombre del proveedor se buscará por su RUC.' : 'Búsqueda por RUC desactivada.');
    };
    // Devuelve el nombre del proveedor para ese RUC. Si no hay servicio configurado y es una búsqueda pedida por el usuario, ofrece configurarlo.
    const nombrePorRuc = async (ruc, interactivo) => {
      ruc = String(ruc || '').trim();
      if (!/^\d{11}$/.test(ruc)) { if (interactivo) alert('Escribe primero los 11 dígitos del RUC.'); return ''; }
      const nm = await resolverProveedor(ruc);
      if (nm || !interactivo) return nm;
      const cfg = await refRucApi.get().then(sn => sn.val()).catch(() => null);
      if (!(cfg && cfg.token)) { if (confirm('Aún no está configurada la búsqueda por RUC. ¿Configurarla ahora?')) { await configurarRucApi(); return resolverProveedor(ruc); } }
      else alert('No se encontró ese RUC. Escribe el nombre a mano.');
      return '';
    };
    const buscarProveedor = async silencioso => { const nm = await nombrePorRuc($('cpRuc').value, !silencioso); if (nm) $('cpProv').value = nm; };
    if ($('cpRucBuscar')) $('cpRucBuscar').onclick = e => { e.preventDefault(); buscarProveedor(false); };
    if ($('cpRuc')) $('cpRuc').onchange = () => { if (!$('cpProv').value.trim()) buscarProveedor(true); };
    let ocupado = false;
    const mostrarMsg = (texto, ok) => {
      const b = $('cpMsg'); if (!b) return;
      b.style.display = ''; b.textContent = texto;
      const col = ok === 'info' ? ['#1565c0', '#0d47a1', '#e3f2fd'] : ok ? ['#2e7d32', '#1b5e20', '#e8f5e9'] : ['#c62828', '#b71c1c', '#ffebee'];
      b.style.cssText = 'display:block;padding:10px 12px;border-radius:8px;margin:10px 0;font-weight:600;border:1px solid ' + col[0] + ';color:' + col[1] + ';background:' + col[2];
      if (b.scrollIntoView) b.scrollIntoView({ block: 'center' });
    };
    $('cpSave').onclick = async () => {
      if (ocupado) return; ocupado = true; $('cpSave').disabled = true;   // evita doble clic = doble compra
      const textoBtn = $('cpSave').textContent; $('cpSave').textContent = 'Registrando…';
      mostrarMsg('⏳ Registrando la compra… puede tardar unos segundos. No hace falta volver a presionar.', 'info');
      try {
        const r = await registrarFactura({ proveedor: $('cpProv').value.trim(), ruc: $('cpRuc').value.trim(), fecha: $('cpDate').value, compTipo: $('cpCompTipo').value,
          compSerie: $('cpSerie').value.trim().toUpperCase(), compNum: $('cpNumero').value.trim(), pago: $('cpPago').value, nOperacion: $('cpOp') ? $('cpOp').value.trim() : '', estadoPago: $('cpEstado').value, almacen: $('cpAlm') ? $('cpAlm').value : 'alm1', observ: $('cpObs').value.trim() },
          lineas().map(l => l.esNuevo ? { nuevo: l.nuevo, tipo: l.nuevo.tipo, nombre: l.nuevo.nombre, qty: l.qty, precio: l.precio }
            : { code: l.code, nombre: (prods[l.code] || {}).name, tipo: (prods[l.code] || {}).tipo || 'nacional', qty: l.qty, precio: l.precio }));
        // Se comprueba en Firebase que lo guardado de verdad exista y se muestra el stock resultante.
        const hechas = await Promise.all(r.ids.map(id => refCompras.child(id).get().then(sn => sn.val())));
        if (hechas.some(x => !x)) throw new Error('La compra no quedó guardada en el servidor. Revisa tu conexión e inténtalo de nuevo.');
        mostrarMsg(`✓ Compra registrada · ${r.ids.length} producto${r.ids.length > 1 ? 's' : ''} · ${sol(r.total)}` + (r.creados.length ? ' · Pon el precio de venta en Stock' : ''), true);
        prods = await refProducts.get().then(_val);
        if (typeof refreshProductsNow === 'function') refreshProductsNow().catch(() => {});   // Stock se actualiza ya, sin esperar al listener
        limpiarFormulario(); pintar(); cargarProvList().catch(() => {});   // queda en blanco para la siguiente compra
      } catch (e) {
        console.error('[Compras] No se pudo registrar:', e);
        const m = /permission_denied/i.test(e.message || '') ? 'Firebase rechazó el guardado (permisos): verifica que tu usuario esté activo y con rol correcto en /users.' : (e.message || 'No se pudo registrar la compra.');
        mostrarMsg('✕ No se registró la compra: ' + m, false); alert(m);
      } finally { ocupado = false; $('cpSave').disabled = false; $('cpSave').textContent = textoBtn; }
    };
    pintar();
  }
};

window.Movimientos = {
  async init() {
    const $ = id => document.getElementById(id);
    const prods = Object.entries(await refProducts.get().then(_val)).filter(([, p]) => !p.deleted);
    const opts = '<option value="">Producto…</option>' + prods.map(([c, p]) => `<option value="${_esc(c)}">${_esc(c)} — ${_esc(p.name || '')}</option>`).join('');
    $('mvProd').innerHTML = opts; $('kxProd').innerHTML = opts;
    const pintar = async () => {
      const al = await calcularAlertas();
      $('mvAlertCount').textContent = `(${al.length})`;
      $('mvAlerts').innerHTML = al.map(a => `<div class="bal-alert"><strong>${_esc(a.tipo)}</strong> — ${_esc(a.msg)}</div>`).join('') || '<p>Sin alertas pendientes.</p>';
      const movs = Object.values(_val(await refMov.orderByChild('timestamp').limitToLast(100).get())).sort((a, b) => b.timestamp - a.timestamp);
      $('mvRows').innerHTML = movs.map(m => _tr(['Fecha y hora', 'Producto', 'Tipo', 'Cant.', 'Saldo', 'Usuario'], [_fmt(m.timestamp), _esc(m.nombre), _esc(m.tipo) + (m.motivo ? ' · ' + _esc(m.motivo) : ''), (m.cantidad > 0 ? '+' : '') + m.cantidad, m.saldoResultante, _esc(m.usuario)])).join('') || '<tr><td colspan="6">Sin movimientos.</td></tr>';
    };
    const pintarFact = async () => {
      const f = await calcularBalanceFacturable(), sum = k => f.reduce((t, x) => t + x[k], 0), S = n => 'S/ ' + n.toFixed(2);
      $('fbRows').innerHTML = f.map(x => _tr(['Producto', 'Stock', 'Docs. disponibles', 'Usado con otros productos', 'Se puede facturar', 'Monto', 'Sin documento', 'Monto sin doc.', 'Costo prom.', 'Margen', 'Decisión'], [_esc(x.nombre), x.stock, x.docSaldo, x.usadoOtros, x.facturable, S(x.montoFact), x.sinDoc, S(x.montoSin), x.costoProm != null ? S(x.costoProm) : '—', x.margenPct != null ? x.margenPct.toFixed(0) + '%' : '—', `<strong>${_esc(x.accion)}</strong>`])).join('') || '<tr><td colspan="11">Sin productos importados.</td></tr>';
      const con = f.filter(x => x.facturable > 0);
      $('fbResumen').innerHTML = f.length
        ? `Hoy puedes facturar <strong>${sum('facturable')} unidades</strong> de <strong>${con.length} de ${f.length}</strong> productos importados, por <strong>${S(sum('montoFact'))}</strong>.` + (con.length ? '<br>' + con.slice(0, 5).map(x => `${_esc(x.nombre)}: ${x.facturable} u.`).join(' · ') + (con.length > 5 ? ' …' : '') : '')
        : 'Aún no hay productos importados registrados.';
      $('fbTotal').innerHTML = f.length ? `<strong>Total:</strong> se puede facturar ${sum('facturable')} u. (${S(sum('montoFact'))}) · sin documento ${sum('sinDoc')} u. (${S(sum('montoSin'))}) · documentación usada con otros productos ${sum('usadoOtros')} u.` : '';
      const cr = await calcularCruces();
      $('crRows').innerHTML = cr.map(x => _tr(['Se entregó (nacional)', 'Comprobante a nombre de', 'Unidades', 'Monto'], [_esc(x.entregado), _esc(x.como), x.qty, S(x.monto)])).join('') || '<tr><td colspan="4">Ninguna venta se facturó con nombre de otro producto.</td></tr>';
      $('crTotal').innerHTML = cr.length ? `<strong>Total:</strong> ${cr.reduce((t, x) => t + x.qty, 0)} u. · ${S(cr.reduce((t, x) => t + x.monto, 0))}` : '';
    };
    await pintarFact();
    const admin = typeof isAdmin !== 'function' || isAdmin();
    if (!admin) { ['cfCard', 'rpCard'].forEach(i => $(i).style.display = 'none'); }
    else {
      const rp = await calcularReportes(), S = n => 'S/ ' + Number(n).toFixed(2);
      $('rpParados').innerHTML = rp.parados.map(x => `<li>${_esc(x.nombre)} — ${x.stock} u. (${S(x.valor)})</li>`).join('') || '<li>Ninguno</li>';
      $('rpTop').innerHTML = rp.top.map(x => `<li>${_esc(x.nombre)} — ${x.vendido} u.</li>`).join('') || '<li>Sin ventas en 30 días</li>';
      $('rpProv').innerHTML = rp.proveedores.map(x => `<li>${_esc(x.nombre)} — ${x.compras} compra(s), ${x.unidades} u.</li>`).join('') || '<li>Sin compras</li>';
      $('cfCargar').onclick = () => { $('cfRows').innerHTML = prods.map(([c, p]) => _tr(['Producto', 'Sistema', 'Contado'], [_esc(p.name || c), Number(p.stock) || 0, `<input type="number" min="0" inputmode="numeric" data-cf="${_esc(c)}">`])).join(''); };
      $('cfAplicar').onclick = async () => {
        const lista = [...document.querySelectorAll('[data-cf]')].filter(i => i.value !== '').map(i => ({ code: i.dataset.cf, contado: Number(i.value) }));
        if (!lista.length) return alert('Carga los productos y escribe al menos una cantidad contada.');
        if (!confirm(`Se ajustarán hasta ${lista.length} productos según tu conteo. ¿Continuar?`)) return;
        const r = await aplicarConteo(lista, $('cfNota').value);
        alert(`Ajustados: ${r.ajustados} · Sin diferencia: ${r.iguales}` + (r.errores.length ? `\n\nNo se pudieron ajustar:\n${r.errores.join('\n')}` : ''));
        $('cfRows').innerHTML = ''; pintar(); pintarFact();
      };
    }
    $('mvAjustar').onclick = async () => {
      const code = $('mvProd').value;
      if (!code) return alert('Elige un producto.');
      const sistema = await stockActual(code), contado = Number($('mvContado').value);
      if (!confirm(`Sistema: ${sistema}. Contado: ${contado}. ¿Ajustar el stock?`)) return;
      try { const d = await ajustarStock(code, contado, $('mvMotivo').value, $('mvNota').value); alert(d ? `✓ Ajuste de ${d > 0 ? '+' : ''}${d} registrado.` : 'El conteo coincide con el sistema.'); $('mvContado').value = ''; $('mvNota').value = ''; pintar(); pintarFact(); }
      catch (e) { alert(e.message); }
    };
    let kardex = [];
    $('kxVer').onclick = async () => {
      if (!$('kxProd').value) return alert('Elige un producto.');
      kardex = await cargarKardex($('kxProd').value);
      $('kxRows').innerHTML = kardex.map(m => _tr(['Fecha y hora', 'Tipo', 'Detalle', 'Entrada', 'Salida', 'Saldo'], [_fmt(m.timestamp), _esc(m.tipo), _esc([m.motivo, m.nota, m.referencia].filter(Boolean).join(' · ')), m.cantidad > 0 ? m.cantidad : '', m.cantidad < 0 ? -m.cantidad : '', m.saldoResultante])).join('') || '<tr><td colspan="6">Sin movimientos.</td></tr>';
    };
    $('kxXls').onclick = () => kardex.length ? exportarKardex($('kxProd').value, kardex) : alert('Primero pulsa "Ver kardex".');
    pintar();
  }
};

// En teléfono la barra inferior se desliza: centra el acceso activo al cambiar de pantalla.
window.addEventListener('hashchange', () => setTimeout(() => { const a = document.querySelector('.nav-item.active'); if (a && a.scrollIntoView) a.scrollIntoView({ inline: 'center', block: 'nearest' }); }, 60));
