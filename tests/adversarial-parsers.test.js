// tests/adversarial-parsers.test.js — QA adversarial sobre compras-import.js (parseXml / parseTexto).
// `bug(...)` = test.todo: describe el comportamiento CORRECTO y hoy FALLA (bug real en www/).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./helpers/load-app');
const CI = () => loadApp(['compras-import.js']).window.ComprasImport;
const plain = o => JSON.parse(JSON.stringify(o));

const NS = 'xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2" xmlns:ext="urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2" xmlns:ds="http://www.w3.org/2000/09/xmldsig#"';
const linea = (i, { qty = '4.000', alt = '<cac:AlternativeConditionPrice><cbc:PriceAmount currencyID="PEN">118.00</cbc:PriceAmount><cbc:PriceTypeCode>01</cbc:PriceTypeCode></cac:AlternativeConditionPrice>', price = '100.00', code = 'G1', desc = 'Guitarra' } = {}) =>
  `<cac:InvoiceLine><cbc:ID>${i}</cbc:ID><cbc:InvoicedQuantity unitCode="NIU">${qty}</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="PEN">400.00</cbc:LineExtensionAmount><cac:PricingReference>${alt}</cac:PricingReference><cac:TaxTotal><cbc:TaxAmount>72.00</cbc:TaxAmount></cac:TaxTotal><cac:Item><cbc:Description><![CDATA[${desc}]]></cbc:Description><cac:SellersItemIdentification><cbc:ID>${code}</cbc:ID></cac:SellersItemIdentification></cac:Item><cac:Price><cbc:PriceAmount currencyID="PEN">${price}</cbc:PriceAmount></cac:Price></cac:InvoiceLine>`;
const xml = (lineas, { root = 'Invoice', id = 'F001-00000123', tipo = '01', extra = '' } = {}) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="no"?><${root} ${NS}><ext:UBLExtensions><ext:UBLExtension><ext:ExtensionContent><ds:Signature><ds:SignedInfo/><ds:SignatureValue>abc</ds:SignatureValue></ds:Signature></ext:ExtensionContent></ext:UBLExtension></ext:UBLExtensions><cbc:UBLVersionID>2.1</cbc:UBLVersionID><cbc:ID>${id}</cbc:ID><cbc:IssueDate>2026-10-02</cbc:IssueDate><cbc:InvoiceTypeCode listID="0101">${tipo}</cbc:InvoiceTypeCode>${extra}<cac:Signature><cbc:ID>IDSignST</cbc:ID></cac:Signature><cac:AccountingSupplierParty><cbc:CustomerAssignedAccountID>20123456789</cbc:CustomerAssignedAccountID><cac:Party><cac:PartyIdentification><cbc:ID schemeID="6">20123456789</cbc:ID></cac:PartyIdentification><cac:PartyName><cbc:Name>CLEVAN</cbc:Name></cac:PartyName><cac:PartyLegalEntity><cbc:RegistrationName>CLEVAN SAC</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingSupplierParty><cac:AccountingCustomerParty><cac:Party><cac:PartyIdentification><cbc:ID schemeID="6">20999999999</cbc:ID></cac:PartyIdentification><cac:PartyLegalEntity><cbc:RegistrationName>ADONAY SAC</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingCustomerParty>${lineas.join('')}</${root}>`;

// ───────────── parseXml ─────────────
test('parseXml UBL real (firma, nombre comercial, cliente, CDATA, varias líneas): toma proveedor (no cliente), ID raíz y precios c/IGV', () => {
  const r = CI().parseXml(xml([linea(1), linea(2, { qty: '12.000', code: 'C-2', desc: 'Cuerdas', alt: '<cac:AlternativeConditionPrice><cbc:PriceAmount>11.80</cbc:PriceAmount><cbc:PriceTypeCode>01</cbc:PriceTypeCode></cac:AlternativeConditionPrice>' }), linea(3, { alt: '', price: '84.745763', code: '', desc: 'Sin código' })]));
  assert.deepEqual([r.proveedor, r.ruc, r.serie, r.numero, r.fecha, r.tipo], ['CLEVAN SAC', '20123456789', 'F001', '00000123', '2026-10-02', 'Factura']);
  assert.deepEqual(plain(r.lineas), [{ codigo: 'G1', desc: 'Guitarra', qty: 4, precio: 118 }, { codigo: 'C-2', desc: 'Cuerdas', qty: 12, precio: 11.8 }, { codigo: '', desc: 'Sin código', qty: 4, precio: 100 }]);
});

test('parseXml boleta (03) y factura sin líneas', () => {
  assert.equal(CI().parseXml(xml([linea(1)], { tipo: '03', id: 'B001-5' })).tipo, 'Boleta');
  assert.deepEqual(plain(CI().parseXml(xml([])).lineas), []);
});

for (const [nombre, texto] of [['vacío', ''], ['texto plano', 'hola'], ['etiqueta sin cerrar', '<Invoice><cbc:ID>'], ['etiquetas cruzadas', '<a><b></a></b>'], ['prefijo sin namespace', '<Invoice><cbc:ID>F1-1</cbc:ID></Invoice>'], ['HTML', '<html><body><p>x</p></body></html>'], ['undefined', undefined], ['null', null]]) {
  test(`parseXml mal formado (${nombre}): lanza Error entendible, nunca devuelve datos`, () => {
    assert.throws(() => CI().parseXml(texto), /XML|factura/);
  });
}

test('parseXml con BOM al inicio y con valores sin ID guion: no revienta', () => {
  const r = CI().parseXml('﻿' + xml([linea(1)], { id: 'SINGUION' }));
  assert.deepEqual([r.serie, r.numero], ['SINGUION', '']);
});

test('parseXml: cantidades/precios con coma decimal o miles se leen bien', () => {
  const r = CI().parseXml(xml([linea(1, { qty: '1,000.00', alt: '<cac:AlternativeConditionPrice><cbc:PriceAmount>1,180.50</cbc:PriceAmount></cac:AlternativeConditionPrice>' })]));
  assert.deepEqual([r.lineas[0].qty, r.lineas[0].precio], [1000, 1180.5]);
});

test('parseXml: una Nota de Crédito/Débito no debe poder cargarse como compra "Factura" (sumaría stock); hoy devuelve tipo "Factura" con cantidades positivas (compras-import.js:17,31)', () => {
  const nc = xml([linea(1)], { root: 'CreditNote', id: 'FC01-1' }).replace(/InvoiceLine/g, 'CreditNoteLine').replace(/InvoicedQuantity/g, 'CreditedQuantity').replace(/Invoice-2/g, 'CreditNote-2');
  let r; try { r = CI().parseXml(nc); } catch { return; }   // rechazarla es válido
  assert.notEqual(r.tipo, 'Factura');
});

test('parseXml: línea gratuita (AlternativeConditionPrice con PriceTypeCode 02 = valor referencial) debe tener precio 0, no el valor referencial (compras-import.js:26-27)', () => {
  const gratis = '<cac:AlternativeConditionPrice><cbc:PriceAmount>118.00</cbc:PriceAmount><cbc:PriceTypeCode>02</cbc:PriceTypeCode></cac:AlternativeConditionPrice>';
  assert.equal(CI().parseXml(xml([linea(1, { alt: gratis, price: '0.00' })])).lineas[0].precio, 0);
});

test('parseXml: ignora la moneda; una factura en USD se importa con precios en dólares como si fueran soles. Debe exponer `moneda` (DocumentCurrencyCode) para avisar/convertir (compras-import.js:31)', () => {
  const r = CI().parseXml(xml([linea(1)], { extra: '<cbc:DocumentCurrencyCode>USD</cbc:DocumentCurrencyCode>' }));
  assert.equal(r.moneda, 'USD');
});

// ───────────── parseTexto ─────────────
const T = l => plain(CI().parseTexto('CLEVAN SAC\nRUC 20123456789\nFACTURA ELECTRONICA F001-123\nFecha: 02/10/2026\n' + l, 'PDF').lineas);
test('parseTexto números peruanos (1,234.50) con miles y decimales', () => {
  assert.deepEqual(T('G1  Piano digital  4  UND  1,234.50  4,938.00'), [{ codigo: 'G1', desc: 'Piano digital', qty: 4, precio: 1234.5 }]);
  assert.equal(T('G1  Piano  2  UND  1,500  3,000')[0].precio, 1500);
  assert.equal(T('G1  Piano  1  UND  1,234,567.80  1,234,567.80')[0].precio, 1234567.8);
});
test('parseTexto números europeos (1.234,50) y coma decimal simple (11,80)', () => {
  assert.equal(T('G1  Piano digital  4  UND  1.234,50  4.938,00')[0].precio, 1234.5);
  assert.equal(T('G1  Cuerdas  10  UND  11,80  118,00')[0].precio, 11.8);
  assert.equal(T('G1  Cuerdas  2,5  UND  10,00  25,00')[0].qty, 2.5);
});
test('parseTexto precio sin IGV se convierte (x1.18); líneas que no cuadran o con basura se descartan', () => {
  assert.deepEqual(T('G1  Guitarra  4  UND  100.00  472.00').map(l => l.precio), [118]);
  assert.deepEqual(T('G1  Guitarra  4  UND  118.00  999.00\nTotal 472.00\nGracias por su compra'), []);
  assert.deepEqual(T('G1  Guitarra  0  UND  118.00  0.00'), []);
});
test('parseTexto entradas degeneradas no lanzan', () => {
  for (const x of ['', null, undefined, '\n\n', '\u0000\u0001', 'F001-', '99/99/9999', 'RUC 2012345678']) assert.doesNotThrow(() => CI().parseTexto(x, 'PDF'));
  const r = CI().parseTexto('', 'PDF'); assert.deepEqual([r.ruc, r.serie, r.numero, r.fecha, r.lineas.length], ['', '', '', '', 0]);
});
test('parseTexto: línea de 8 000 caracteres de números no congela la pantalla (<1 s)', () => {
  const t0 = Date.now(); CI().parseTexto('a '.repeat(10) + '1 '.repeat(4000), 'OCR');
  assert.ok(Date.now() - t0 < 1000, `tardó ${Date.now() - t0} ms`);
});
test('parseTexto: el número con ceros a la izquierda se recorta ("F001-00123" → "123") mientras parseXml conserva "00123"; la misma factura leída por XML y por PDF genera claves distintas y no se detecta duplicado (compras-import.js:38 vs 18-19)', () => {
  const c = CI(), x = c.parseXml(xml([linea(1)], { id: 'F001-00123' })), p = c.parseTexto('F001-00123', 'PDF');
  assert.equal(p.numero, x.numero);
});
test('parseTexto: tolerancia del 5 % acepta líneas cuya cuenta NO cuadra (OCR 20 u. leído como 21): debe exigir diferencia ≤ unos céntimos (compras-import.js:48-49)', () => {
  assert.deepEqual(T('G1  Cuerdas  21  UND  10.00  200.00'), []);
});
