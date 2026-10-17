// Regresiones del flujo Compras → Stock → Almacenes.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load-app');
const plain = o => JSON.parse(JSON.stringify(o));
const CI = () => loadApp(['compras-import.js']).window.ComprasImport;
const app = productos => { const a = loadApp(['firebase.js', 'balance-logic.js']); a.firebase._store.products = productos || {}; return a; };
const suma = p => ['alm1', 'alm2', 'alm3'].reduce((t, k) => t + ((p.almacenes || {})[k] || 0), 0);

test('PDF: lee productos aunque las columnas vengan en otro orden y con descripción en 2 filas', () => {
  const r = CI().parseTexto([
    'CLEVAN SAC', 'RUC 20123456789', 'FACTURA ELECTRONICA F001-123', 'Emisión: 02 de octubre del 2026',
    'Cantidad  Unidad  Código  Descripción  Valor Unit.  Precio Unit.  Importe',
    '4  NIU  J101044M  JUEGO DE CUERDAS CELLO  100.00  118.00  472.00',
    'NYLON NEGRO',
    '10  UND  Guitarra criolla  59.00  590.00',
    'Total 1,062.00'].join('\n'), 'PDF');
  assert.equal(r.fecha, '2026-10-02');
  assert.deepEqual(plain(r.lineas), [
    { codigo: 'J101044M', desc: 'JUEGO DE CUERDAS CELLO NYLON NEGRO', qty: 4, precio: 118 },
    { codigo: '', desc: 'Guitarra criolla', qty: 10, precio: 59 }]);
});

test('Stock: producto nuevo creado a mano en un almacén NO aparece en los otros y total == suma', async () => {
  const { window, firebase } = app();
  await window.saveProduct('P1', { name: 'P', price: 5, stock: 7, category: 'general', tipo: 'nacional', almacenes: window.repartoInicial(7, 'alm2') }, undefined, true);
  const p = firebase._store.products.P1;
  assert.deepEqual({ ...p.almacenes }, { alm1: 0, alm2: 7, alm3: 0 });
  assert.equal(p.stock, suma(p));
});

test('Stock: producto sin reparto (viejo/importado) se ve entero en Almacén 1 y la reparación no cambia el total', async () => {
  const { window, firebase } = app({ A: { name: 'A', stock: 9 }, B: { name: 'B', stock: 10, almacenes: { alm1: 2, alm2: 3, alm3: 0 } } });
  assert.deepEqual(plain(window.normalizarAlmacenes(firebase._store.products.A)), { alm1: 9, alm2: 0, alm3: 0 });
  const lista = Object.entries(firebase._store.products).map(([code, p]) => ({ code, ...p }));
  assert.equal(await window.repararAlmacenes(lista), 2);
  for (const p of Object.values(firebase._store.products)) assert.equal(p.stock, suma(p));
  assert.deepEqual([firebase._store.products.A.stock, firebase._store.products.B.stock], [9, 10]);
});

test('Stock: editar el total, importar cantidad y editar un almacén mantienen total == suma', async () => {
  const { window, firebase } = app({ A: { name: 'A', stock: 5 } });
  await window.saveProduct('A', { name: 'A', price: 1, stock: 8, category: 'general' }, 5);
  await window.addStockConAlmacen('A', 4);
  await window.updateWarehouseStock('A', 'alm3', 2, 0);
  const p = firebase._store.products.A;
  assert.equal(p.stock, 14); assert.equal(p.stock, suma(p));
});

test('Compra de producto nuevo: aparece en el almacén elegido y el total coincide', async () => {
  const { window, firebase } = app();
  await window.registrarFactura({ proveedor: 'Clevan SAC', ruc: '20123456789', fecha: '2026-10-02', compTipo: 'Factura', compSerie: 'F001', compNum: '123', almacen: 'alm3' },
    [{ nuevo: { code: 'J1', nombre: 'CUERDAS', tipo: 'importado' }, tipo: 'importado', qty: 3, precio: 118 }]);
  const p = firebase._store.products.J1;
  assert.deepEqual({ ...p.almacenes }, { alm1: 0, alm2: 0, alm3: 3 });
  assert.equal(p.stock, 3);
});

test('PDF: serie/número en filas separadas o con «Nº», y el proveedor no es la dirección', () => {
  const r = CI().parseTexto(['DIR.LOCAL: JR. SANTA ROSA 123 S.A.', 'HERCULES PERU S.A.C.', 'RUC: 20608364502', 'FACTURA ELECTRÓNICA', 'F001', 'Nº 000456', 'Fecha de emisión: 02/10/2026',
    '4  MS434B  ATRIL PARA MICRÓFONO DE GIRO RÁPIDO CON BOOM 3  21.54  86.16'].join('\n'), 'PDF');
  assert.deepEqual([r.proveedor, r.ruc, r.serie, r.numero, r.fecha], ['HERCULES PERU S.A.C.', '20608364502', 'F001', '000456', '2026-10-02']);
  assert.equal(r.lineas.length, 1);
});

test('nombreCorto separa nombre y descripción larga', () => {
  const c = CI();
  assert.equal(c.nombreCorto('SOPORTE PARA SMARTPHONE HERCULES 10-6'), 'SOPORTE PARA SMARTPHONE HERCULES 10-6');
  assert.equal(c.nombreCorto('ATRIL PARA MICRÓFONO DE GIRO RÁPIDO CON BOOM 3 EN 1 "HERCULE 10-6'), 'ATRIL PARA MICRÓFONO DE GIRO RÁPIDO');
});

test('PDF: el proveedor se toma de la línea del RUC o de la que está justo encima', () => {
  const A = CI().parseTexto(['HERCULES STANDS PERU S.A.C.  R.U.C. 20608364502', 'FACTURA ELECTRÓNICA', 'F001-00042692'].join('\n'), 'PDF');
  assert.equal(A.proveedor, 'HERCULES STANDS PERU S.A.C.');
  const B = CI().parseTexto(['COMERCIAL LOS ANDES', 'AV. LIMA 123 - LIMA', 'RUC: 20608364502', 'F001-00042692'].join('\n'), 'PDF');
  assert.equal(B.proveedor, 'COMERCIAL LOS ANDES');
});

// Texto real extraído con pdf.js de la factura de Technical Audio Group (el nombre del emisor solo está en el logo).
const FACTURA_TAG = [
  'R.U.C. 20608364502', 'FACTURA ELECTRÓNICA',
  'CAL.MONTE ROSA NRO. 233 URB. CHACARILLA DEL ESTANQUE LIMA - LIMA - SANTIAGO DE SURCO  F001 N°00042692',
  'DIR.LOCAL: JR. SANTA ROSA NRO. 1293 BARRIOS ALTOS LIMA - LIMA - LIMA', 'TELF.: 4784342', 'E-MAIL: info@tecaudiogrp.com',
  'RUC  : 20616269659  FECHA EMISION : 2026-10-02', 'SEÑOR(ES)  : ADONAY MUSIC S.A.C.  CLIENTE  : 23371',
  'DIRECCIÓN  : PJ. ENRIQUE MONTES NRO. 150 INT. 147 LIMA - LIMA - LIMA  MONEDA  : DÓLARES', 'VENDEDOR  : 04 LILIANA COYA SOLIS  GUIA REMISIÓN : T001-00051477',
  'FORMA PAGO : CREDITO 5 DIAS  O/C  : -', 'VALOR  VAL.UNI.  PRECIO', 'CODIGO  CANT  DESCRIPCIÓN  DESCTS', 'UNIT  C/DESC  TOTAL',
  'MS434B  4  ATRIL PARA MICRÓFONO DE GIRO RÁPIDO CON BOOM 3 EN 1 "HERCULE  25.46  10-6  21.54  86.16',
  'DG207B  6  SOPORTE PARA SMARTPHONE HERCULES  23.13  10-6  19.57  117.41',
  'SON: DOSCIENTOS TRES CON 57/100 DOLARES AMERICANOS', 'OP.  OP.  OP.  VALOR  PRECIO', 'DESCTO  IGV (18.00%)  ICBPER', '203.92  31.40  172.52  31.05  203.57',
  'Información del Crédito  :  BCP DOLARES: 1939862950165, BCP SOLES: 1939871357074', 'Monto pendiente de Pago  : US$ 203.57'].join('\n');

test('Factura real (TAG): RUC del emisor (no del cliente), serie/número, dólares, líneas limpias y sin proveedor inventado', () => {
  const r = CI().parseTexto(FACTURA_TAG, 'PDF');
  assert.deepEqual([r.ruc, r.serie, r.numero, r.fecha, r.moneda, r.proveedor], ['20608364502', 'F001', '00042692', '2026-10-02', 'USD', '']);
  assert.deepEqual(plain(r.lineas), [
    { codigo: 'MS434B', desc: 'ATRIL PARA MICRÓFONO DE GIRO RÁPIDO CON BOOM 3 EN 1 "HERCULE', qty: 4, precio: 21.54 },
    { codigo: 'DG207B', desc: 'SOPORTE PARA SMARTPHONE HERCULES', qty: 6, precio: 19.57 }]);
});

test('Proveedor: nunca la forma de pago ni la dirección; el nombre del logo se arma con el OCR', () => {
  const c = CI();
  assert.equal(c.parecedireccion('FORMA PAGO : CREDITO 5 DIAS'), true);
  assert.equal(c.parecedireccion('DIR.LOCAL: JR. SANTA ROSA NRO. 1293'), true);
  assert.equal(c.parecedireccion('Technical Audio Group'), false);
  assert.equal(c.nombreDeLogo('TAG\nTechnical Audio Group\nCAL.MONTE ROSA NRO. 233 URB. CHACARILLA\nTELF.: 4784342'), 'Technical Audio Group');
});

test('Compra en dólares: el costo queda en soles con el tipo de cambio (sin IGV por ser factura)', async () => {
  const { window, firebase } = app();
  await window.registrarFactura({ proveedor: 'Technical Audio Group', ruc: '20608364502', fecha: '2026-10-02', compTipo: 'Factura', compSerie: 'F001', compNum: '42692', almacen: 'alm1', moneda: 'USD', tc: 3.75 },
    [{ nuevo: { code: 'MS434B', nombre: 'ATRIL', tipo: 'importado' }, tipo: 'importado', qty: 4, precio: 21.54 }]);
  const costo = Object.values(firebase._store.costos)[0];
  assert.equal(costo.moneda, 'USD'); assert.equal(costo.tc, 3.75); assert.equal(costo.costoUnit, 68.4525);
  await assert.rejects(window.registrarFactura({ proveedor: 'X', ruc: '20608364502', fecha: '2026-10-02', compTipo: 'Factura', compSerie: 'F001', compNum: '1', almacen: 'alm1', moneda: 'USD' },
    [{ nuevo: { code: 'Q1', nombre: 'Q', tipo: 'importado' }, tipo: 'importado', qty: 1, precio: 1 }]), /tipo de cambio/);
});

test('Proveedor por RUC: usa el guardado, si no la API de consulta con el token del admin, y nunca una dirección', async () => {
  const { window, firebase } = loadApp(['compras-import.js']);
  const CIm = window.ComprasImport;
  assert.equal(CIm.nombreDeRespuesta({ razonSocial: 'TECHNICAL AUDIO GROUP S.A.C.' }), 'TECHNICAL AUDIO GROUP S.A.C.');
  assert.equal(CIm.nombreDeRespuesta({ data: { razon_social: 'X SAC' } }), 'X SAC');
  assert.equal(await CIm.consultarRuc('20608364502', null), '');
  assert.equal(await CIm.consultarRuc('123', { token: 't' }), '');
  const llamadas = [];
  window.fetch = async (url, o) => { llamadas.push([url, o.headers.Authorization]); return { ok: true, json: async () => ({ razonSocial: 'TECHNICAL AUDIO GROUP S.A.C.' }) }; };
  assert.equal(await CIm.consultarRuc('20608364502', { token: 'abc' }), 'TECHNICAL AUDIO GROUP S.A.C.');
  assert.deepEqual(llamadas[0], ['https://api.apis.net.pe/v2/sunat/ruc?numero=20608364502', 'Bearer abc']);
  // leerArchivo completa el proveedor por RUC (XML sin nombre no aplica; se prueba con foto simulada vía parseTexto + resolver)
  const bor = CIm.parseTexto(FACTURA_TAG, 'PDF'); assert.equal(bor.proveedor, '');
});

// Facturas reales de proveedores de la empresa (texto extraído con pdf.js): cada una con un formato distinto.
const FAC_UNION = ['UNION MUSICAL E.I.R.L.  FACTURA ELECTRONICA', 'RUC 20557457578', 'Avenida Nicolás de Piérola N° 208  FT01-0000004780', 'Teléfono: (511) 597-4049  de instrumentos musicales de las diferentes marcas',
  'union-musical@hotmail.com  nacionales e importados', 'Fecha Emisión  : 30/09/2026  Guía de Remisión:', 'Fecha Vencimiento : 30/09/2026  Condiciones: CONTADO CONTRA ENTREGA', 'Señor(es)  : ADONAY MUSIC S.A.C.',
  'RUC  : 20616269659  Moneda: SOLES', 'CANT.  MODELO  DESCRIPCION  P. UNIT.  P. TOTAL', '10  UKULELE STRINBERG UK-06C  90.00  900.00', 'Valor de Venta  762.71', 'IGV 18%  137.29', 'Precio de Venta  900.00',
  'SON: NOVECIENTOS Y 00/100 SOLES', 'Autorizados por la Superintendencia Nacional de Administración Tributaria a emitir Comprobantes Electrónicos desde el 28/10/2019.'].join('\n');
const FAC_MACHACA = ['IMPORTACIONES MACHACA', 'FACTURA ELECTRÓNICA', 'ARIAS MACHACA WILBER', 'RUC:10457574415', 'E001 20-', 'Formato de Pago  : Al Contado', 'Fecha de Emisión  : 30/09/2026', 'Señor (es)  :', 'ADONAY MUSIC S.A.C.',
  'RUC  : 20616269659  Tipo de Moneda  : SOLES', 'Cantidad  Unidad Medida  Código  Descripción  Valor Unitario', '10.00  UNIDAD  00019  ECUALIZADOR LC-5  42.37', '10.00  UNIDAD  00023  AFINADOR FLANGER  21.19',
  'Sub Total Ventas :  635.60', 'Descuentos :  0.00', 'Valor Venta :  635.60', 'IGV :  114.41', 'Importe Total :  750.01', 'SON: SETECIENTOS CINCUENTA Y 01/100 SOLES'].join('\n');
const FAC_VYB = ['FACTURA ELECTRONICA', 'MUSIC V&B PERU S.A.C.', 'RUC 20604154091', 'Jirón Angaraes N° 738 Lima - Lima', '* ventas@musicvybperu.com  FT02-0000003801', 'Fecha Emisión  : 3/10/2026  Guía de Remisión:',
  'Fecha Vencimiento : 3/10/2026  Condiciones: CONTADO CONTRA ENTREGA', 'Señor(es)  : ADONAY MUSIC S.A.C.', 'RUC  : 20616269659  Moneda: SOLES', 'CANT.  MODELO  DESCRIPCION  P. UNIT.  P. TOTAL',
  '1 VB117Y1/4  VIOLIN SYMPHONY VB117Y1/4  180.00  180.00', 'Valor de Venta  152.54', 'IGV 18%  27.46', 'Precio de Venta  180.00', 'SON: CIENTO OCHENTA Y 00/100 SOLES',
  'Autorizados por la Superintendencia Nacional de Administración Tributaria a emitir Comprobantes Electrónicos desde el 15/02/2019.'].join('\n');
const FAC_HUAMAN = ['JR. ANGARAES 713, LIMA  RUC: 20614729067', 'LIMA - LIMA - LIMA', 'FACTURA', 'Jr. Angaraes 713, Lima', 'ELECTRÓNICA', '01 4246822  51 938586391', 'FFF1-0003036', 'HUAMAN MERCADOS MUSICALES S.A.C', 'www.huamanmusic.pe',
  'DATOS DEL CLIENTE  FECHA EMISIÓN:  5/10/2026', 'RUC  : 20616269659  FECHA DE VENC:  5/10/2026', 'DENOMINACIÓN  : ADONAY MUSIC S.A.C.  MONEDA  : SOLES', 'DIRECCIÓN  : PJ. ENRIQUE MONTES NRO. 150 INT. 147  IGV  : 18.00 %',
  'CANT  UM  CÓDIGO  DESCRIPCIÓN  P/U  IMPORTE', '1  NIU  062033039  PARCHES **EVANS** B14UV1 | B14UV1-PARCHE DE TAROLA/TIMBAL DE  75.00  75.00', '14" - UV1 - CTD - BLANCO - UNA CAPA', 'GRAVADA  S/  63.56', 'IGV  S/  11.44', 'TOTAL  S/  75.00',
  'IMPORTE EN LETRAS: SETENTA Y CINCO CON 00/100 SOLES.'].join('\n');

test('Facturas reales de 4 proveedores: proveedor, RUC, serie/número, fecha y productos salen completos', () => {
  const c = CI(), p = x => plain(c.parseTexto(x, 'PDF'));
  const U = p(FAC_UNION), M = p(FAC_MACHACA), V = p(FAC_VYB), H = p(FAC_HUAMAN);
  assert.deepEqual([U.proveedor, U.ruc, U.serie, U.numero, U.fecha, U.moneda], ['UNION MUSICAL E.I.R.L.', '20557457578', 'FT01', '0000004780', '2026-09-30', 'PEN']);
  assert.deepEqual(U.lineas, [{ codigo: '', desc: 'UKULELE STRINBERG UK-06C', qty: 10, precio: 90 }]);
  // Machaca: precios unitarios SIN IGV y sin columna de importe → se llevan a precio con IGV (42.37 → 50, 21.19 → 25)
  assert.deepEqual([M.proveedor, M.ruc, M.serie, M.numero, M.fecha], ['ARIAS MACHACA WILBER', '10457574415', 'E001', '20', '2026-09-30']);
  assert.deepEqual(M.lineas, [{ codigo: '00019', desc: 'ECUALIZADOR LC-5', qty: 10, precio: 50 }, { codigo: '00023', desc: 'AFINADOR FLANGER', qty: 10, precio: 25 }]);
  // V&B: cantidad y modelo pegados, fecha de un solo dígito y no la de las leyendas
  assert.deepEqual([V.proveedor, V.serie, V.numero, V.fecha], ['MUSIC V&B PERU S.A.C.', 'FT02', '0000003801', '2026-10-03']);
  assert.deepEqual(V.lineas, [{ codigo: 'VB117Y1/4', desc: 'VIOLIN SYMPHONY VB117Y1/4', qty: 1, precio: 180 }]);
  // Huaman: descripción en dos filas y sin arrastrar los totales
  assert.deepEqual([H.proveedor, H.ruc, H.serie, H.fecha], ['HUAMAN MERCADOS MUSICALES S.A.C', '20614729067', 'FFF1', '2026-10-05']);
  assert.deepEqual(H.lineas, [{ codigo: '062033039', desc: 'PARCHES **EVANS** B14UV1 | B14UV1-PARCHE DE TAROLA/TIMBAL DE 14" - UV1 - CTD - BLANCO - UNA CAPA', qty: 1, precio: 75 }]);
});

test('Stock: el costo de compra es lo pagado CON IGV (2 unidades por 100 → 50 c/u), no el costo sin IGV', async () => {
  const { window, firebase } = app();
  await window.registrarFactura({ proveedor: 'Clevan SAC', ruc: '20123456789', fecha: '2026-10-02', compTipo: 'Factura', compSerie: 'F001', compNum: '77', almacen: 'alm1' },
    [{ nuevo: { code: 'X1', nombre: 'X', tipo: 'nacional' }, tipo: 'nacional', qty: 2, precio: 50 }]);
  const k = Object.values(firebase._store.costos)[0];
  assert.equal(k.costoUnit, 42.375);                         // contable: sin IGV (50 ÷ 1,18)
  const c = await window.costosPorProducto();
  assert.equal(c.X1.prom, 50); assert.equal(c.X1.ultimo, 50);  // lo que se ve en Stock: lo pagado
  await window.registrarFactura({ proveedor: 'Clevan SAC', ruc: '20123456789', fecha: '2026-10-03', compTipo: 'Factura', compSerie: 'F001', compNum: '78', almacen: 'alm1' },
    [{ code: 'X1', nombre: 'X', tipo: 'nacional', qty: 2, precio: 60 }]);
  assert.equal((await window.costosPorProducto()).X1.prom, 55);   // promedio ponderado: (100 + 120) ÷ 4
});

test('Costo guardado en el producto (lo ven todos): lo pagado c/IGV, promedio con el stock que había, y se recalcula al anular', async () => {
  const { window, firebase } = app({ Y1: { name: 'Y', stock: 2, tipo: 'nacional', costoCompra: 10 } });   // ya había 2 unidades a S/ 10
  const h = n => ({ proveedor: 'Clevan SAC', ruc: '20123456789', fecha: '2026-10-02', compTipo: 'Factura', compSerie: 'F001', compNum: String(n), almacen: 'alm1' });
  const r = await window.registrarFactura(h(1), [{ code: 'Y1', nombre: 'Y', tipo: 'nacional', qty: 2, precio: 30 }]);   // 2 más a S/ 30 con IGV
  assert.equal(firebase._store.products.Y1.costoCompra, 20);                       // (2×10 + 2×30) ÷ 4
  assert.equal(firebase._store.products.Y1.costoUltimo, 30);
  await window.anularCompra(r.ids[0]);
  assert.equal(firebase._store.products.Y1.stock, 2);
  // sin compras vigentes el costo queda como estaba; con otras compras se recalcula
  const r1 = await window.registrarFactura(h(2), [{ code: 'Y1', nombre: 'Y', tipo: 'nacional', qty: 1, precio: 50 }]);
  const r2 = await window.registrarFactura(h(3), [{ code: 'Y1', nombre: 'Y', tipo: 'nacional', qty: 3, precio: 70 }]);
  await window.anularCompra(r1.ids[0]);
  assert.equal(firebase._store.products.Y1.costoCompra, 70);                       // queda solo la de 3 × 70
});

test('Editar producto: costo de compra y precio de venta se guardan; el origen es obligatorio (Nacional o Importado)', async () => {
  const { window, firebase } = loadApp(['tests/helpers/stub-auth.js', 'firebase.js', 'selection.js', 'balance-logic.js', 'compras-import.js', 'stock.js'], '<div id="viewRoot"></div>');
  const fs = require('fs'), path = require('path'), d = window.document;
  firebase._store.products = { E1: { name: 'DADDARIO', stock: 5, price: 0, tipo: 'importado', costoCompra: 19.07 }, E2: { name: 'SIN ORIGEN', stock: 1, price: 0 } };
  await new Promise(r => setTimeout(r, 150));
  d.getElementById('viewRoot').innerHTML = fs.readFileSync(path.join(__dirname, '..', 'views', 'stock-view.html'), 'utf8');
  await window.refreshProductsNow(); window.Stock.init(); await new Promise(r => setTimeout(r, 150));
  // el selector de origen solo ofrece Nacional e Importado
  assert.deepEqual([...d.getElementById('editTipo').options].filter(o => !o.disabled).map(o => o.value), ['nacional', 'importado']);
  // el costo y el precio se editan
  window.openEditStock('E1', 'DADDARIO', 5, 0, 'general', '');
  assert.equal(d.getElementById('editCost').value, '19.07');
  d.getElementById('editCost').value = '22.5'; d.getElementById('editPrice').value = '40';
  window.saveStock(); await new Promise(r => setTimeout(r, 150));
  assert.deepEqual([firebase._store.products.E1.costoCompra, firebase._store.products.E1.price, firebase._store.products.E1.tipo], [22.5, 40, 'importado']);
  // sin tocar el costo, no se pisa (aunque el promedio tenga más decimales)
  firebase._store.products.E1.costoCompra = 22.4983;
  await window.refreshProductsNow(); await new Promise(r => setTimeout(r, 100));
  window.openEditStock('E1', 'DADDARIO', 5, 40, 'general', ''); window.saveStock(); await new Promise(r => setTimeout(r, 150));
  assert.equal(firebase._store.products.E1.costoCompra, 22.4983);
  // un producto sin origen obliga a elegirlo
  let aviso = ''; window.alert = m => { aviso = m; };
  window.openEditStock('E2', 'SIN ORIGEN', 1, 0, 'general', ''); window.saveStock(); await new Promise(r => setTimeout(r, 100));
  assert.match(aviso, /origen/i); assert.equal(firebase._store.products.E2.tipo, undefined);
});
