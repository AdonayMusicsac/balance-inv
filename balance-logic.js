// BALANCE-INV: compras, proveedores, documentos, movimientos, ajustes, kardex y alertas.
// Reutiliza db / refProducts / refOrders de firebase.js. Modelo: ver diagrama sin ciclos
// (MOVIMIENTOS referencia su origen con origenTipo + origenId, sin FK).
const refMov = db.ref('movimientos'), refCompras = db.ref('compras'), refProveedores = db.ref('proveedores'), refCostos = db.ref('costos');
const STOCK_MIN_DEFECTO = 5, SALDO_DOC_MIN = 2, TOLERANCIA_MS = 120000;
const _esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const _fmt = t => new Date(t).toLocaleString('es-PE');
const _tr = (labels, cells, attrs = '') => `<tr${attrs}>` + cells.map((c, i) => `<td data-label="${labels[i]}">${c}</td>`).join('') + '</tr>';
const _val = snap => snap.val() || {};
const _user = () => { const u = firebase.auth().currentUser || {}; return u.email || u.uid || 'desconocido'; };
const _soloAdmin = () => { if (typeof isAdmin === 'function' && !isAdmin()) throw new Error('Solo el administrador puede hacer esta operación.'); };
const _touch = code => refProducts.child(code).update({ updatedAt: firebase.database.ServerValue.TIMESTAMP }).catch(() => {});
const pushMov = m => refMov.push({ ...m, usuario: _user(), timestamp: Date.now() });
const stockActual = async code => Number((await refProducts.child(code).child('stock').get()).val()) || 0;

// Suma/resta stock de forma atómica. Nunca deja negativo ni crea productos fantasma.
async function moverStock(code, delta) {
  const p = _val(await refProducts.child(code).get());
  if (!Object.keys(p).length || p.deleted) throw new Error('El producto ya no existe.');
  const r = await refProducts.child(code).child('stock').transaction(cur => {
    const n = (Number(cur) || 0) + delta;
    return n < 0 ? undefined : n;
  });
  if (!r.committed) throw new Error('Stock insuficiente para esta operación.');
  _touch(code);
  return Number(r.snapshot.val());
}

const IGV = 1.18;   // Los precios de ADONAY incluyen IGV 18 % (igual que su Control_Contable).
const _r2 = n => Math.round(n * 100) / 100;
// Igual que el Excel: Total = cant × precio; Base = ROUND(total / 1.18, 2); IGV = Total − Base.
const calcularImportes = window.calcularImportes = (qty, precio) => { const total = _r2(qty * precio), base = _r2(total / IGV); return { total, base, igv: _r2(total - base) }; };

async function registrarCompra(c) {
  if (!c.code) throw new Error('Elige un producto.');
  if (!Number.isInteger(c.qty) || c.qty < 1) throw new Error('La cantidad debe ser un entero mayor a 0.');
  if (!(c.precio >= 0)) throw new Error('Precio de compra inválido.');
  if (!c.proveedor) throw new Error('Indica el proveedor.');
  if (!c.fecha || isNaN(new Date(c.fecha))) throw new Error('Fecha inválida.');
  if (c.docTipo && !(c.docQty >= 0 && c.docQty <= c.qty)) throw new Error('La cantidad documentada debe estar entre 0 y la cantidad comprada.');
  if (c.tipo === 'importado' && !c.docTipo && !c.sinConfirmar && !confirm('Es un producto importado sin documento. ¿Guardar igual? Quedará como "documentación pendiente".')) throw new Error('Compra no guardada.');
  const provKey = (c.ruc || c.proveedor).replace(/[.#$\[\]\/]/g, '_');
  const doc = c.docTipo ? { tipo: c.docTipo, numero: c.docNum || '', cantDocumentada: c.docQty || 0, cantUtilizada: 0 } : null;
  if (c.moneda === 'USD' && !(c.tc > 0)) throw new Error('Indica el tipo de cambio (soles por dólar).');
  const tc = c.moneda === 'USD' ? c.tc : 1, gastos = c.gastos > 0 ? c.gastos : 0;
  const imp = calcularImportes(c.qty, c.precio * tc);
  // Costo real en soles. Con factura el IGV es crédito fiscal, así que el costo es el precio sin IGV.
  const baseUnit = c.igvIncluido && c.docTipo === 'Factura' ? c.precio / IGV : c.precio;
  const costoUnit = _r2((baseUnit * tc * c.qty + gastos) / c.qty);
  const facturaKey = c.docTipo && c.docNum ? `${provKey}|${c.docTipo}|${c.docNum}` : '';
  const saldo = await moverStock(c.code, c.qty);
  const ref = refCompras.push();
  try {   // si algo falla después de mover el stock, se revierte todo
    await refProducts.child(c.code).update({ tipo: c.tipo || 'nacional', ...(c.stockMin >= 0 ? { stockMin: c.stockMin } : {}) });
    await refProveedores.child(provKey).update({ nombre: c.proveedor, ruc: c.ruc || '' });
    await ref.set({ code: c.code, nombre: c.nombre, proveedorId: provKey, proveedor: c.proveedor, ruc: c.ruc || '', cantidad: c.qty, precio: c.precio || 0, moneda: c.moneda || 'PEN',
      unidad: c.unidad || '', base: imp.base, igv: imp.igv, total: imp.total, pago: c.pago || '', nOperacion: c.nOperacion || '', estadoPago: c.estadoPago || '', observ: c.observ || '',
      facturaId: c.facturaId || '', facturaKey, fecha: c.fecha, documento: doc, timestamp: Date.now() });
    await refCostos.child(ref.key).set({ code: c.code, costoUnit, moneda: c.moneda || 'PEN', tc, gastos, cantidad: c.qty, timestamp: Date.now() });
    await pushMov({ code: c.code, nombre: c.nombre, tipo: 'compra', cantidad: c.qty, saldoResultante: saldo, origenTipo: 'compra', origenId: ref.key });
  } catch (e) {
    await moverStock(c.code, -c.qty).catch(() => {});
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
async function _codigosNacionales(cantidad) {
  const usados = new Set(Object.keys(_val(await refProducts.get())).map(k => k.toUpperCase()));
  let n = 0; usados.forEach(k => { const m = k.match(/^NAC-(\d+)$/); if (m) n = Math.max(n, Number(m[1])); });
  const out = []; while (out.length < cantidad) { n++; const c = 'NAC-' + String(n).padStart(4, '0'); if (!usados.has(c)) out.push(c); }
  return out;
}
async function _crearProducto(n) {
  const r = await refProducts.child(n.code).transaction(cur => (cur !== null && !cur.deleted) ? undefined : { name: n.nombre, desc: '', price: 0, stock: 0, category: 'general', tipo: n.tipo, creadoDesdeCompra: true, updatedAt: Date.now() });
  if (!r.committed) throw new Error(`Ya existe un producto con el código ${n.code}. Elígelo de la lista en vez de crearlo.`);
}

// Una factura/boleta con varios productos (como una fila-grupo del Excel). Todo o nada:
// si una línea falla, se revierten las anteriores con movimientos inversos y se quitan los productos creados.
async function registrarFactura(h, lineas) {
  if (!Array.isArray(lineas) || !lineas.length) throw new Error('Agrega al menos un producto.');
  if (!h.proveedor) throw new Error('Indica el proveedor.');
  lineas.forEach((l, i) => {
    if (l.nuevo) {
      if (!String(l.nuevo.nombre || '').trim()) throw new Error(`Línea ${i + 1}: escribe la descripción del producto nuevo.`);
      if (!['nacional', 'importado'].includes(l.nuevo.tipo)) throw new Error(`Línea ${i + 1}: elige si el producto nuevo es Nacional o Importado.`);
      if (l.nuevo.tipo === 'importado' && !String(l.nuevo.code || '').trim()) throw new Error(`Línea ${i + 1}: el producto importado necesita el código que trae la factura.`);
      if (/[.#$\[\]]/.test(l.nuevo.code || '')) throw new Error(`Línea ${i + 1}: el código no puede llevar . # $ [ ]`);
    } else if (!l.code) throw new Error(`Línea ${i + 1}: elige un producto.`);
    if (!Number.isInteger(l.qty) || l.qty < 1) throw new Error(`Línea ${i + 1}: la cantidad debe ser un entero mayor a 0.`);
    if (!(l.precio >= 0)) throw new Error(`Línea ${i + 1}: precio inválido.`);
  });
  const conComp = !!h.compTipo;
  if (conComp && !h.compNum) throw new Error('Indica el número del comprobante.');
  if (h.compTipo === 'Factura' && !(h.ruc || '').match(/^\d{11}$/)) throw new Error('Una factura necesita el RUC del proveedor (11 dígitos).');
  const num = conComp ? [h.compSerie, h.compNum].filter(Boolean).join('-') : '';
  const provKey = (h.ruc || h.proveedor).replace(/[.#$\[\]\/]/g, '_');
  if (conComp) {
    const dup = Object.values(_val(await refCompras.orderByChild('facturaKey').equalTo(`${provKey}|${h.compTipo}|${num}`).get())).find(c => !c.anulada);
    if (dup) throw new Error(`El comprobante ${num} de ${h.proveedor} ya fue registrado el ${dup.fecha}.`);
  }
  const nuevos = lineas.filter(l => l.nuevo);
  const sinCodigo = nuevos.filter(l => !String(l.nuevo.code || '').trim());
  const gen = sinCodigo.length ? await _codigosNacionales(sinCodigo.length) : [];
  sinCodigo.forEach((l, i) => { l.nuevo.code = gen[i]; });
  const codigos = nuevos.map(l => _claveCodigo(l.nuevo.code));
  if (new Set(codigos).size !== codigos.length) throw new Error('Hay dos productos nuevos con el mismo código en esta compra.');
  if (lineas.some(l => l.tipo === 'importado' || (l.nuevo && l.nuevo.tipo === 'importado')) && !conComp && !h.sinConfirmar && !confirm('Hay productos importados sin comprobante. ¿Guardar igual? Quedarán como "documentación pendiente".')) throw new Error('Compra no guardada.');
  const facturaId = 'F' + Date.now().toString(36), hechas = [], creados = [];
  try {
    for (const l of nuevos) { const code = _claveCodigo(l.nuevo.code); await _crearProducto({ code, nombre: l.nuevo.nombre.trim(), tipo: l.nuevo.tipo }); creados.push(code); }
    for (const l of lineas) {
      const c0 = l.nuevo ? { code: _claveCodigo(l.nuevo.code), nombre: l.nuevo.nombre.trim(), tipo: l.nuevo.tipo } : {};
      const id = await registrarCompra({ proveedor: h.proveedor, ruc: h.ruc, fecha: h.fecha, pago: h.pago, nOperacion: h.nOperacion, estadoPago: h.estadoPago, observ: h.observ, ...l, ...c0,
        docTipo: conComp ? h.compTipo : '', docNum: num, docQty: conComp ? l.qty : 0, igvIncluido: true, facturaId, sinConfirmar: true });
      hechas.push(id);
    }
  } catch (e) {
    for (const id of hechas.reverse()) await _revertirCompra(id).catch(() => {});
    for (const code of creados) await refProducts.child(code).remove().catch(() => {});
    throw e;
  }
  return { facturaId, ids: hechas, creados, ...lineas.reduce((a, l) => { const i = calcularImportes(l.qty, l.precio); return { total: _r2(a.total + i.total), base: _r2(a.base + i.base), igv: _r2(a.igv + i.igv) }; }, { total: 0, base: 0, igv: 0 }) };
}

// Corrige una compra con un movimiento inverso (nunca borra historial).
async function _revertirCompra(id) {
  const c = _val(await refCompras.child(id).get());
  if (!c.code) throw new Error('La compra no existe.');
  const flag = await refCompras.child(id).child('anulada').transaction(cur => cur ? undefined : true);
  if (!flag.committed) throw new Error('Esta compra ya está anulada.');
  try {
    const saldo = await moverStock(c.code, -c.cantidad);
    await pushMov({ code: c.code, nombre: c.nombre, tipo: 'anulacion_compra', cantidad: -c.cantidad, saldoResultante: saldo, origenTipo: 'compra', origenId: id });
  } catch (e) {
    await refCompras.child(id).child('anulada').remove().catch(() => {});
    throw new Error(/insuficiente/.test(e.message) ? 'No se puede anular: parte de esa mercadería ya se vendió.' : e.message);
  }
}
async function anularCompra(id) { _soloAdmin(); return _revertirCompra(id); }

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
async function registrarSalidaVenta(items, orderId, results, numero) {
  for (const it of items) {
    const res = (results || []).find(r => r.code === it.code);
    const p = _val(await refProducts.child(it.code).get());
    const sinDoc = p.tipo === 'importado' ? await consumirDocumentacion(it.code, it.qty) : 0;
    const comoCode = p.tipo !== 'importado' && it.facturarComo && it.facturarComo !== it.code ? it.facturarComo : '';
    const como = comoCode ? _val(await refProducts.child(comoCode).get()) : {};
    const cruza = !!(comoCode && Object.keys(como).length && !como.deleted);
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
  const neto = {}, cruz = {};   // neto: sinDocumento por producto · cruz: unidades de documentación gastadas con otro producto
  Object.values(_val(await refMov.orderByChild('origenId').equalTo(orderId).get())).forEach(m => {
    if (m.cruzadaDe) { const k = `${m.code}|${m.cruzadaDe}`; cruz[k] = cruz[k] || { cant: 0, sd: 0, monto: 0 }; cruz[k].cant += m.cantDoc || 0; cruz[k].sd += m.sinDocumento || 0; cruz[k].monto += m.monto || 0; }
    else neto[m.code] = (neto[m.code] || 0) + (m.sinDocumento || 0);
  });
  for (const it of items || []) {
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
  const nuevo = {}; itemsNuevos.forEach(i => { nuevo[i.code] = (nuevo[i.code] || 0) + i.qty; });
  await registrarAnulacionVenta(orderId, itemsAntes, nuevo);
  await registrarSalidaVenta(itemsNuevos, orderId, results, numero);
}
// Antes de vender: avisa (sin bloquear) si un importado no tiene documentación suficiente.
async function avisoSinDocumento(items) {
  const bal = await calcularBalanceFacturable(), prods = _val(await refProducts.get()), pide = {};
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
  const [prods, compras, movs] = await Promise.all([refProducts.get().then(_val), refCompras.get().then(_val), refMov.get().then(_val)]);
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
    if (Number(p.stock) <= min) out.push({ tipo: 'Stock bajo', msg: `${nom}: quedan ${p.stock || 0} (mínimo ${min}).` });
    if (p.tipo === 'importado') {
      const a = agg[code] || { cant: 0, doc: 0, usada: 0 }, saldo = a.doc - a.usada;
      if (a.cant > a.doc) out.push({ tipo: 'Documentación pendiente', msg: `${nom}: ${a.cant - a.doc} unidades importadas sin documento.` });
      else if (a.doc > 0 && saldo <= SALDO_DOC_MIN) out.push({ tipo: 'Saldo próximo a agotarse', msg: `${nom}: saldo documentado ${saldo}.` });
      if (sinDoc[code] > 0) out.push({ tipo: 'Vendido sin documentación', msg: `${nom}: ${sinDoc[code]} unidades vendidas sin respaldo documental.` });
    }
    const u = ultimo[code];   // tolerancia: una operación en curso aún puede no haber dejado su movimiento
    if (u && ahora - u.timestamp > TOLERANCIA_MS && Number(u.saldoResultante) !== Number(p.stock)) out.push({ tipo: 'Diferencia detectada', msg: `${nom}: el stock es ${p.stock} pero el último movimiento dejó ${u.saldoResultante}. Revisa el Kardex.` });
  }
  return out;
}

// Balance de importados: lo que se puede facturar/boletear (tiene documento) vs lo que no.
// facturable = min(saldo documentado, stock físico); sinDocumento = stock - facturable.
async function calcularBalanceFacturable() {
  const admin = typeof isAdmin !== 'function' || isAdmin();
  const [prods, compras, costos] = await Promise.all([refProducts.get().then(_val), refCompras.get().then(_val), admin ? refCostos.get().then(_val).catch(() => ({})) : {}]);
  const acum = {};   // costo promedio ponderado por producto (solo compras vigentes)
  Object.entries(costos).forEach(([id, k]) => { if (compras[id] && !compras[id].anulada) { const a = acum[k.code] = acum[k.code] || { t: 0, q: 0 }; a.t += k.costoUnit * k.cantidad; a.q += k.cantidad; } });
  const saldoDoc = {}, docTotal = {}, cruzadoPor = {};
  if (typeof refMov !== 'undefined') Object.values(await refMov.get().then(_val).catch(() => ({}))).forEach(m => { if (m.cruzadaDe) cruzadoPor[m.code] = (cruzadoPor[m.code] || 0) + (m.cantDoc || 0); });
  Object.values(compras).filter(c => !c.anulada && c.documento).forEach(c => {
    docTotal[c.code] = (docTotal[c.code] || 0) + (c.documento.cantDocumentada || 0);
    saldoDoc[c.code] = (saldoDoc[c.code] || 0) + Math.max(0, (c.documento.cantDocumentada || 0) - (c.documento.cantUtilizada || 0));
  });
  return Object.entries(prods).filter(([, p]) => !p.deleted && p.tipo === 'importado').map(([code, p]) => {
    const stock = Number(p.stock) || 0, min = p.stockMin != null ? Number(p.stockMin) : STOCK_MIN_DEFECTO;
    const facturable = Math.min(saldoDoc[code] || 0, stock), sinDoc = stock - facturable, precio = Number(p.price) || 0;
    const accion = facturable <= min ? 'Comprar o documentar más' : sinDoc > 0 ? 'Regularizar documentos' : 'Suficiente';
    const costoProm = acum[code] && acum[code].q ? acum[code].t / acum[code].q : null;
    return { code, nombre: p.name || code, stock, docSaldo: saldoDoc[code] || 0, docTotal: docTotal[code] || 0, usadoOtros: cruzadoPor[code] || 0, facturable, sinDoc, precio, costoProm, margenPct: costoProm != null && precio > 0 ? (precio - costoProm) / precio * 100 : null, montoFact: facturable * precio, montoSin: sinDoc * precio, accion };
  }).sort((a, b) => (a.accion === 'Suficiente') - (b.accion === 'Suficiente') || a.facturable - b.facturable);
}

// Ventas donde el comprobante salió con el nombre de un importado pero se entregó otro producto.
async function calcularCruces() {
  const movs = Object.values(await refMov.get().then(_val)), out = {};
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
  const [prods, movs, compras] = await Promise.all([refProducts.get().then(_val), refMov.get().then(_val), refCompras.get().then(_val)]);
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
    $('cpProvList').innerHTML = Object.values(await refProveedores.get().then(_val)).map(p => `<option value="${_esc(p.nombre)}">`).join('');
    const sol = n => 'S/ ' + Number(n || 0).toFixed(2);

    // ── líneas de producto (una factura puede traer varios) ──
    const nuevaLinea = () => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td data-label="Producto"><select class="ln-prod">${optProd()}</select>
          <div class="ln-nuevo" style="display:none">
            <input class="nv-code" placeholder="Código (importado: el de la factura · nacional: vacío = automático)">
            <input class="nv-desc" placeholder="Descripción del producto">
            <select class="nv-tipo"><option value="importado">Importado</option><option value="nacional">Nacional</option></select>
            <small class="bal-hint">Se crea en Stock con este código y descripción. Los precios público y de tienda se ponen aparte en Stock.</small>
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
        nuevo: esNuevo ? { code: tr.querySelector('.nv-code').value.trim(), nombre: tr.querySelector('.nv-desc').value.trim(), tipo: tr.querySelector('.nv-tipo').value } : null };
    });
    const tipoDe = l => l.esNuevo ? l.nuevo.tipo : (prods[l.code] || {}).tipo;
    const recalcular = () => {
      let t = { total: 0, base: 0, igv: 0 };
      lineas().forEach(l => { l.tr.querySelector('.ln-nuevo').style.display = l.esNuevo ? '' : 'none'; const i = calcularImportes(l.qty || 0, l.precio || 0); l.tr.querySelector('.ln-total').textContent = sol(i.total); t = { total: _r2(t.total + i.total), base: _r2(t.base + i.base), igv: _r2(t.igv + i.igv) }; });
      $('cpTotales').textContent = `Base ${sol(t.base)} · IGV 18 % ${sol(t.igv)} · Total ${sol(t.total)}`;
      const ls = lineas(), imp = ls.some(l => tipoDe(l) === 'importado'), sinTipo = ls.some(l => l.code && !l.esNuevo && !(prods[l.code] || {}).tipo);
      $('cpAviso').textContent = sinTipo ? 'Hay productos sin clasificar: se tratarán como Nacional. Clasifícalos en Stock.' : imp && !$('cpCompTipo').value ? 'Hay productos importados: registra su factura o boleta para que cuenten como facturables.' : '';
    };
    const tipoComp = () => { const c = $('cpCompTipo').value; document.querySelectorAll('.cp-comp').forEach(e => e.style.display = c ? '' : 'none'); recalcular(); };
    $('cpLineas').oninput = $('cpLineas').onchange = recalcular;
    $('cpLineas').onclick = e => { if (e.target.classList.contains('ln-del')) { if ($('cpLineas').children.length > 1) e.target.closest('tr').remove(); recalcular(); } };
    $('cpAddLinea').onclick = nuevaLinea;
    $('cpCompTipo').onchange = tipoComp;
    nuevaLinea(); tipoComp();

    // ── leer comprobante (XML / PDF / foto) → previsualización → rellena el formulario ──
    const aplicarBorrador = b => {
      $('cpProv').value = b.proveedor; $('cpRuc').value = b.ruc; $('cpCompTipo').value = b.tipo;
      if (b.fecha) $('cpDate').value = b.fecha; $('cpSerie').value = (b.serie || '').toUpperCase(); $('cpNumero').value = b.numero;
      $('cpLineas').innerHTML = '';
      (b.lineas.length ? b.lineas : [{}]).forEach(l => {
        const tr = nuevaLinea(); if (!l.code) return;
        tr.querySelector('.ln-prod').value = l.code; tr.querySelector('.ln-qty').value = l.qty; tr.querySelector('.ln-price').value = l.precio;
        if (l.code === NUEVO) { tr.querySelector('.nv-code').value = l.codigoNuevo || ''; tr.querySelector('.nv-desc').value = l.desc || ''; tr.querySelector('.nv-tipo').value = b.tipo ? 'importado' : 'nacional'; }
      });
      tipoComp();
    };
    if ($('cpLeer')) {
      $('cpLeer').onclick = () => $('cpArchivo').click();
      $('cpArchivo').onchange = async () => {
        const f = $('cpArchivo').files[0]; $('cpArchivo').value = ''; if (!f) return;
        if (!window.ComprasImport) return alert('El lector de comprobantes no está disponible.');
        $('cpLeer').disabled = true; $('cpLeerEstado').textContent = 'Leyendo el archivo… (una foto puede tardar unos segundos)';
        try { window.ComprasImport.abrirPrevisualizacion(await window.ComprasImport.leerArchivo(f), prods, aplicarBorrador); }
        catch (e) { alert(e.message); } finally { $('cpLeer').disabled = false; $('cpLeerEstado').textContent = ''; }
      };
    }

    const pintar = async () => {
      const cs = Object.entries(await refCompras.get().then(_val)).sort((a, b) => b[1].timestamp - a[1].timestamp).slice(0, 40);
      $('cpRows').innerHTML = cs.map(([id, c]) => _tr(['Fecha', 'Código', 'Producto', 'Proveedor', 'Cant.', 'Costo unit.', 'Total', 'Comprobante', 'Saldo doc.', ''], [_esc(c.fecha), _esc(c.code), _esc(c.nombre), _esc(c.proveedor), c.cantidad, sol(c.precio), c.total != null ? sol(c.total) : '—', c.documento ? _esc(c.documento.tipo + ' ' + c.documento.numero) : 'Sin comprobante', c.documento ? c.documento.cantDocumentada - c.documento.cantUtilizada : '—', c.anulada ? 'Anulada' : `<button class="btn" data-anular="${_esc(id)}">Anular</button>`], c.anulada ? ' class="bal-anulada"' : '')).join('') || '<tr><td colspan="10">Sin compras.</td></tr>';
    };
    $('cpRows').onclick = async e => {
      const id = e.target.dataset && e.target.dataset.anular;
      if (!id || !confirm('¿Anular esta compra? Se descontará del stock.')) return;
      try { await anularCompra(id); await pintar(); } catch (err) { alert(err.message); }
    };
    let ocupado = false;
    $('cpSave').onclick = async () => {
      if (ocupado) return; ocupado = true; $('cpSave').disabled = true;   // evita doble clic = doble compra
      try {
        const r = await registrarFactura({ proveedor: $('cpProv').value.trim(), ruc: $('cpRuc').value.trim(), fecha: $('cpDate').value, compTipo: $('cpCompTipo').value,
          compSerie: $('cpSerie').value.trim().toUpperCase(), compNum: $('cpNumero').value.trim(), pago: $('cpPago').value, nOperacion: $('cpOp') ? $('cpOp').value.trim() : '', estadoPago: $('cpEstado').value, observ: $('cpObs').value.trim() },
          lineas().map(l => l.esNuevo ? { nuevo: l.nuevo, tipo: l.nuevo.tipo, nombre: l.nuevo.nombre, qty: l.qty, precio: l.precio }
            : { code: l.code, nombre: (prods[l.code] || {}).name, tipo: (prods[l.code] || {}).tipo || 'nacional', qty: l.qty, precio: l.precio }));
        alert(`✓ Compra registrada (${r.ids.length} producto${r.ids.length > 1 ? 's' : ''}) · Total ${sol(r.total)}. El stock ya se actualizó.` + (r.creados.length ? `\\n\\nProductos nuevos creados: ${r.creados.join(', ')}.\\nPon su precio público y de tienda en Stock.` : ''));
        prods = await refProducts.get().then(_val);
        $('cpLineas').innerHTML = ''; nuevaLinea(); ['cpNumero', 'cpObs'].forEach(i => $(i).value = ''); if ($('cpOp')) $('cpOp').value = ''; recalcular(); pintar();
      } catch (e) { alert(e.message); } finally { ocupado = false; $('cpSave').disabled = false; }
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
      const movs = Object.values(await refMov.get().then(_val)).sort((a, b) => b.timestamp - a.timestamp).slice(0, 100);
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
