// Datos de ejemplo para el arnés visual (NO es una prueba; no entra en `npm test`).
const DAY = 86400000;
function buildSeed(now = Date.now()) {
  const nombres = ['Taladro percutor 650W', 'Amoladora angular 4 1/2"', 'Juego de brocas HSS 19 piezas', 'Cinta métrica 8 m', 'Nivel de burbuja 60 cm',
    'Disco de corte metal 7"', 'Llave inglesa ajustable 12"', 'Alicate universal aislado', 'Destornillador punta plana 6 mm', 'Martillo de carpintero 16 oz',
    'Caja de herramientas 19" con bandeja', 'Sierra circular 7 1/4" 1500 W', 'Pistola de calor 2000 W', 'Lijadora orbital 250 W', 'Compresor de aire 24 L',
    'Cable eléctrico THW 14 AWG rollo 100 m', 'Interruptor termomagnético 2x32A', 'Tubo PVC 2" x 3 m', 'Pegamento para PVC 1/4 gal', 'Pintura látex blanco 4 L',
    'Rodillo de lana 9"', 'Brocha de cerda 3"', 'Candado de acero 50 mm', 'Guantes de cuero reforzado', 'Casco de seguridad con barbiquejo',
    'Lentes de seguridad antiempañantes', 'Escalera telescópica aluminio 3.8 m', 'Carretilla reforzada 90 L', 'Manguera de jardín 30 m', 'Extensión eléctrica 10 m tripolar',
    'Linterna recargable LED 1000 lm', 'Soldadora inverter 200 A', 'Electrodo 6011 1/8" caja 5 kg', 'Taco expansivo 1/4" bolsa 100', 'Tornillo drywall 6x1" caja 1000',
    'Cemento Portland tipo I 42.5 kg', 'Plancha de triplay 4 mm', 'Silicona transparente cartucho', 'Cinta aislante 3M 18 m', 'Medidor láser de distancia 40 m'];
  const products = {};
  nombres.forEach((n, i) => {
    const imp = i % 2 === 0;
    const code = imp ? 'IMP-' + (1001 + i) : 'NAC-' + String(i).padStart(4, '0');
    const a1 = (i * 7) % 23, a2 = (i * 5) % 13, a3 = i % 6 === 0 ? 0 : (i * 3) % 9;
    products[code] = {
      name: n, desc: (imp ? 'Importado · Marca Norte · ' : 'Nacional · Línea Andes · ') + 'Pres. ' + (1 + i % 4),
      price: Math.round((18 + (i * 37) % 480) * 100) / 100, precioTienda: Math.round((15 + (i * 31) % 420) * 100) / 100,
      stock: a1 + a2 + a3, almacenes: { alm1: a1, alm2: a2, alm3: a3 }, stockMin: 5,
      category: ['herramientas', 'electricidad', 'gasfitería', 'pintura', 'seguridad'][i % 5], tipo: imp ? 'importado' : 'nacional',
      updatedAt: now - i * 3600000,
      ...(i % 3 === 0 ? { image: 'https://img.test/p' + i + '.svg' } : {}),
    };
  });
  const codes = Object.keys(products);

  const clients = {
    '20601234567': { nombre: 'Constructora Los Andes S.A.C.', ciudad: 'Lima', telefono: '987654321', updatedAt: now },
    '20512986754': { nombre: 'Ferretería El Maestro E.I.R.L.', ciudad: 'Arequipa', telefono: '954123456', updatedAt: now },
    '20489001234': { nombre: 'Inversiones Cusco Norte S.A.', ciudad: 'Cusco', telefono: '984000111', updatedAt: now },
    '20345678901': { nombre: 'Corporación Industrial del Sur S.A.C. Sucursal Tacna', ciudad: 'Tacna', telefono: '952333444', updatedAt: now },
    '10456789012': { nombre: 'Juan Carlos Quispe Huamaní', ciudad: 'Huancayo', telefono: '964555666', updatedAt: now },
  };
  const rucs = Object.keys(clients);

  const orders = {}, movimientos = {}, compras = {}, costos = {}, proveedores = {};
  for (let i = 0; i < 24; i++) {
    const ts = now - (i * 0.8 + 0.1) * DAY;
    const d = new Date(ts);
    const ruc = rucs[i % rucs.length];
    const items = [0, 1, 2].slice(0, 1 + i % 3).map(k => {
      const code = codes[(i * 3 + k * 5) % codes.length], p = products[code];
      return { code, name: p.name, desc: p.desc, price: p.price, qty: 1 + (i + k) % 4, itemDiscountPct: 0 };
    });
    const subtotal = Math.round(items.reduce((s, it) => s + it.price * it.qty, 0) * 100) / 100;
    const dp = i % 4 === 0 ? 5 : 0;
    const id = '-ord' + String(i).padStart(4, '0');
    orders[id] = { numero: 'NP-2026-' + String(100 - i).padStart(3, '0'), ruc, cliente: clients[ruc].nombre,
      fecha: d.toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: '2-digit' }), hora: d.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }),
      items, subtotal, descuentoPct: dp, total: Math.round(subtotal * (1 - dp / 100) * 100) / 100, editCount: i % 7 === 0 ? 1 : 0, timestamp: ts,
      creadoPor: { uid: i % 2 ? 'u-vend' : 'u-admin', nombre: i % 2 ? 'Rosa Vendedora' : 'Admin Demo' },
      ...(i % 3 === 0 ? { comprobanteTipo: 'Factura', comprobanteNumero: 'F001-' + (100 + i) } : {}) };
    items.forEach((it, k) => {
      movimientos['-mv' + i + '_' + k] = { code: it.code, nombre: it.name, tipo: 'venta', cantidad: -it.qty, saldoResultante: 10, origenTipo: 'venta', origenId: id, usuario: 'Admin Demo', timestamp: ts };
    });
  }
  ['Importadora Dragón Rojo S.A.C.', 'Distribuidora Nacional Perú S.R.L.', 'Aceros y Herramientas del Centro E.I.R.L.'].forEach((prov, j) => {
    proveedores['2060000000' + j] = { nombre: prov, ruc: '2060000000' + j };
  });
  for (let i = 0; i < 14; i++) {
    const code = codes[i * 2 % codes.length], p = products[code], ts = now - i * 1.3 * DAY, id = '-cmp' + String(i).padStart(4, '0');
    const prov = Object.values(proveedores)[i % 3], qty = 10 + i * 3, total = Math.round(qty * p.price * 0.55 * 100) / 100, base = Math.round(total / 1.18 * 100) / 100;
    compras[id] = { code, nombre: p.name, proveedorId: prov.ruc, proveedor: prov.nombre, ruc: prov.ruc, cantidad: qty, precio: Math.round(p.price * 0.55 * 100) / 100, moneda: 'PEN', unidad: 'UND',
      base, igv: Math.round((total - base) * 100) / 100, total, pago: 'Transferencia', nOperacion: '00' + i, estadoPago: i % 4 ? 'Pagado' : 'Pendiente', observ: '', facturaId: 'F001-' + (500 + i),
      facturaKey: prov.ruc + '|Factura|F001-' + (500 + i), fecha: new Date(ts).toISOString().slice(0, 10), almacen: 'alm' + (1 + i % 3), timestamp: ts,
      documento: p.tipo === 'importado' ? { tipo: 'Factura', numero: 'F001-' + (500 + i), cantDocumentada: qty - (i % 3 ? 0 : 4), cantUtilizada: Math.floor(qty / 3) } : null };
    costos[id] = { code, costoUnit: Math.round(p.price * 0.47 * 10000) / 10000, costoTotal: Math.round(total / 1.18 * 100) / 100, moneda: 'PEN', tc: 1, gastos: 0, cantidad: qty, timestamp: ts };
    movimientos['-mc' + i] = { code, nombre: p.name, tipo: 'compra', cantidad: qty, saldoResultante: p.stock, origenTipo: 'compra', origenId: id, almacen: compras[id].almacen, usuario: 'Admin Demo', timestamp: ts };
  }
  movimientos['-ajuste1'] = { code: codes[3], nombre: products[codes[3]].name, tipo: 'ajuste', cantidad: -2, saldoResultante: 4, motivo: 'Merma', nota: 'Producto dañado en almacén', usuario: 'Admin Demo', timestamp: now - 3600000 };

  const users = {
    'u-admin': { nombre: 'Admin Demo', email: 'admin@demo.pe', correo: 'admin@demo.pe', rol: 'admin', activo: true, creadoEn: now - 90 * DAY },
    'u-vend': { nombre: 'Rosa Vendedora', email: 'rosa@balanceinv.local', correo: 'rosa@demo.pe', rol: 'vendedor', activo: true, creadoEn: now - 40 * DAY },
    'u-vend2': { nombre: 'Luis Almacenero Largo Nombre Apellido', email: 'luis@balanceinv.local', rol: 'vendedor', activo: false, creadoEn: now - 20 * DAY },
  };
  const support = {
    '-tk1': { uid: 'u-vend', nombre: 'Rosa Vendedora', tipo: 'problema', asunto: 'No me carga el stock de un producto con nombre muy largo', mensaje: 'Al abrir Stock veo la tabla cortada en el celular y no puedo editar.', estado: 'abierto', timestamp: now - 2 * DAY },
    '-tk2': { uid: 'u-admin', nombre: 'Admin Demo', tipo: 'sugerencia', asunto: 'Exportar a Excel', mensaje: 'Sería bueno exportar el balance.', estado: 'resuelto', respuesta: 'Ya está disponible.', timestamp: now - 9 * DAY },
  };
  const catalogoPublico = { activo: true, nombre: 'Ferretería Demo — Catálogo', whatsapp: '51987654321', productos: {} };
  codes.forEach((c, i) => { catalogoPublico.productos[c] = { nombre: products[c].name, categoria: products[c].category, imagen: i % 3 === 0 ? 'https://img.test/p' + i + '.svg' : '', disponible: products[c].stock > 0, actualizadoEn: now - i * 1000 }; });

  return { products, clients, orders, movimientos, compras, costos, proveedores, users, support, catalogoPublico, meta: { seeded: true } };
}
module.exports = { buildSeed };
