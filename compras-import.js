// BALANCE-INV: leer una factura/boleta de compra desde XML (SUNAT), PDF o foto y mostrar
// una PREVISUALIZACIÓN editable. Nada se guarda aquí: al aprobar, solo se llena el formulario
// de Compras, que se revisa y se guarda como siempre.
(function () {
  const IGV = 1.18, r2 = n => Math.round(n * 100) / 100;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = s => { s = String(s == null ? '' : s).trim().replace(/[^\d.,-]/g, ''); if (/,\d{1,2}$/.test(s) && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.'); else if (/,\d{1,2}$/.test(s)) s = s.replace(',', '.'); else s = s.replace(/,/g, ''); const n = parseFloat(s); return isNaN(n) ? 0 : n; };

  // ── XML (UBL 2.1 de SUNAT) ──
  function parseXml(text) {
    const doc = new DOMParser().parseFromString(text, 'text/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('El XML no se pudo leer.');
    const all = (n, t) => [...n.getElementsByTagNameNS('*', t)];
    const first = (n, t) => all(n, t)[0] || null;
    const txt = (n, t) => { const e = n && first(n, t); return e ? e.textContent.trim() : ''; };
    const root = doc.documentElement, kind = root.localName;
    if (!['Invoice', 'CreditNote', 'DebitNote'].includes(kind)) throw new Error('Este XML no es una factura o boleta electrónica.');
    if (kind !== 'Invoice') throw new Error('Este XML es una nota de ' + (kind === 'CreditNote' ? 'crédito' : 'débito') + ', no una factura ni boleta de compra: no se puede cargar como compra.');
    const idFull = [...root.children].find(e => e.localName === 'ID'); const id = idFull ? idFull.textContent.trim() : '';
    const [serie, numero] = id.split('-');
    const code = txt(root, 'InvoiceTypeCode');
    const sup = first(root, 'AccountingSupplierParty');
    const ruc = sup ? txt(first(sup, 'PartyIdentification') || sup, 'ID') : '';
    const proveedor = sup ? (txt(sup, 'RegistrationName') || txt(first(sup, 'PartyName') || sup, 'Name')) : '';
    const lineas = all(root, kind === 'Invoice' ? 'InvoiceLine' : kind === 'CreditNote' ? 'CreditNoteLine' : 'DebitNoteLine').map(l => {
      const qty = num(txt(l, 'InvoicedQuantity') || txt(l, 'CreditedQuantity') || txt(l, 'DebitedQuantity'));
      const alt = first(l, 'AlternativeConditionPrice'), pr = first(l, 'Price');
      const gratis = all(l, 'AlternativeConditionPrice').some(a => txt(a, 'PriceTypeCode') === '02');   // 02 = valor referencial (línea gratuita)
      const precio = gratis ? 0 : alt ? num(txt(alt, 'PriceAmount')) : pr ? r2(num(txt(pr, 'PriceAmount')) * IGV) : 0;
      const item = first(l, 'Item'), sid = item && first(item, 'SellersItemIdentification');
      return { codigo: sid ? txt(sid, 'ID') : '', desc: item ? txt(item, 'Description') : '', qty, precio };
    });
    return { origen: 'XML', tipo: code === '03' ? 'Boleta' : 'Factura', serie: serie || '', numero: numero || '', fecha: txt(root, 'IssueDate'), moneda: (txt(root, 'DocumentCurrencyCode') || 'PEN').toUpperCase(), proveedor, ruc, lineas };
  }

  // ── Texto (PDF u OCR): se buscan los datos típicos; las líneas se detectan sin importar el orden de las columnas ──
  const UNIDAD = /^(UND|UNID|UNIDAD|UNIDADES|NIU|ZZ|SET|PZA|PZ|PAR|CJA|CAJA|KG|MTR|LT|DOC)\.?$/i;
  const MONEDA_TOK = /^(S\/\.?|PEN|USD|US\$|%|\$)$/i;
  const esNum = s => /^(?:US\$|USD|S\/\.?|\$)?\s*\d[\d.,]*$/i.test(s);
  const DSC = /^\d{1,3}(?:\s?[-–+\/]\s?\d{1,3})+%?$|^\d{1,3}(?:[.,]\d+)?\s?%$/;   // columna de descuento: «10-6», «10+5», «5%»
  const STOP = /total|son:|igv|subtotal|importe|valor|observ|gracias|forma de pago|monto|hash|representaci|sunat|ruc|fecha|banco|cuenta|descuento|cantidad|descripci|gravada|inafecta|exonerad|gratuita|letras|s\/\s*\d/i;

  // Convierte una fila de texto en una lista de piezas (número, código, descuento, unidad o texto), separando lo que el PDF dejó pegado.
  function tokenizar(raw) {
    let toks = raw.split(/\s{2,}/).map(x => x.trim()).filter(Boolean);
    if (toks.length < 4) toks = raw.split(/\s+/).filter(Boolean);
    const seq = [];
    const push = (txt, pegado) => {
      const tipo = /^0\d{2,}$/.test(txt) || /^\d{5,}$/.test(txt) ? 'cod' : esNum(txt) ? 'num' : DSC.test(txt) ? 'dsc' : UNIDAD.test(txt) || MONEDA_TOK.test(txt) ? 'uni' : 'txt';
      seq.push({ txt, tipo, pegado: !!pegado, val: tipo === 'num' ? num(txt) : 0 });
    };
    toks.forEach((t, i) => {
      const ws = t.split(/\s+/);
      if (ws.length > 1 && ws.every(w => esNum(w) || DSC.test(w) || /^\d{5,}$/.test(w))) { ws.forEach(w => push(w)); return; }   // «10-6 965.81»
      const mu = t.match(/^(\d[\d.,]*)\s+([A-Za-z]{1,8}\.?)$/);                                                                  // «10.00 NIU»: cantidad y unidad en una misma celda
      if (mu && UNIDAD.test(mu[2])) { push(mu[1]); push(mu[2]); return; }
      const m0 = i === 0 ? t.match(/^(\d+(?:[.,]\d+)?)\s+(\S.*)$/) : null;                                                    // «1 VB117Y1/4»: cantidad pegada al modelo
      if (m0) { push(m0[1]); t = m0[2]; }
      const mt = t.match(/^(.*[A-Za-zÁÉÍÓÚÑ].*?)\s+(\d[\d,]*\.\d{2}(?:\s+\d[\d,]*\.\d{2})*)$/);                                // «DESCRIPCION 42.37»: precio pegado al texto
      if (mt && !esNum(t)) { push(mt[1]); mt[2].split(/\s+/).forEach(w => push(w, true)); return; }
      push(t);
    });
    return seq;
  }
  // Arma código y descripción con las piezas que no se usaron como cantidad o precio.
  // Un número que queda DENTRO de la descripción («CABLE 3 M», «TECLADO 61 TECLAS») vuelve a ella; las columnas de descuento (número · «10-6» · número) no.
  function armarTexto(seq, usados) {
    const iTxt = seq.map((e, i) => e.tipo === 'txt' && !usados.has(i) ? i : -1).filter(i => i >= 0);
    const ini = iTxt.length ? iTxt[0] : -1, fin = iTxt.length ? iTxt[iTxt.length - 1] : -1;
    const textos = [], extras = [];
    seq.forEach((e, i) => {
      if (usados.has(i)) return;
      if (e.tipo === 'txt') { textos.push(e.txt); return; }
      const dentro = i > ini && i < fin;
      const esColumnaDsc = e.tipo === 'dsc' && seq[i - 1] && seq[i - 1].tipo === 'num' && seq[i + 1] && seq[i + 1].tipo === 'num';
      if (e.tipo === 'dsc' && seq[i - 1] && seq[i - 1].tipo === 'txt') textos.push(e.txt);   // «… SM-58 10-6»: pegado al texto, es parte del nombre
      else if (e.tipo === 'cod' && !dentro) extras.push(e.txt);
      else if (e.tipo === 'cod' || e.tipo === 'num' || e.tipo === 'dsc') { if (dentro && !esColumnaDsc) textos.push(e.txt); else if (e.tipo === 'num' && e.pegado) textos.push(e.txt); }
    });
    let codigo = '', desc = textos;
    if (textos.length >= 2 && /[\d-]/.test(textos[0]) && textos[0].length <= 25 && !/\s/.test(textos[0])) { codigo = textos[0]; desc = textos.slice(1); }
    if (!codigo) codigo = extras[0] || '';
    return { codigo, desc: desc.join(' ').replace(/\s{2,}/g, ' ').trim() };
  }

  // Busca cantidad × precio = importe entre los números de una línea, sin importar el orden de las columnas.
  // También entiende: precio sin IGV junto a su importe con IGV, y columnas de descuento (% o precio con descuento).
  function lineaProducto(raw, precioPrimero) {
    const seq = tokenizar(raw);
    if (seq.length < 3 || seq.length > 60) return null;
    const idx = seq.map((e, i) => e.tipo === 'num' ? i : -1).filter(i => i >= 0), nums = idx.map(i => seq[i].val);
    if (nums.length < 3 || nums.length > 12) return null;
    const tolDe = t => Math.max(0.05, 0.005 * t);
    const iTx = seq.map((e, i) => e.tipo === 'txt' ? i : -1).filter(i => i >= 0), t0 = iTx.length ? iTx[0] : -1, t1 = iTx.length ? iTx[iTx.length - 1] : -1;
    const dentro = k => idx[k] > t0 && idx[k] < t1;   // un número metido en medio del texto suele ser parte de la descripción
    const cands = [];
    const nuevo = (c, clase, precio, errAbs) => cands.push({ ...c, clase, precio, errAbs, err: errAbs / c.t, penal: c.usa.filter(dentro).length, pdec: /[.,]\d/.test(seq[idx[c.b]].txt) ? 0 : 1, orden: c.usa.every((k, i) => !i || c.usa[i - 1] < k) });
    for (let a = 0; a < nums.length; a++) for (let b = 0; b < nums.length; b++) for (let c = 0; c < nums.length; c++) {
      if (a === b || b === c || a === c) continue;
      const q = nums[a], p = nums[b], t = nums[c];
      if (!(q > 0) || !(t > 0) || q > 100000) continue;
      const base = { a, b, c, q, t, usa: [a, b, c] };
      const e1 = Math.abs(q * p - t), e2 = Math.abs(q * p * IGV - t);
      if (e1 <= tolDe(t)) nuevo(base, 0, p, e1); else if (e2 <= tolDe(t)) nuevo(base, 2, r2(p * IGV), e2);
    }
    for (let a = 0; a < nums.length; a++) for (let b = 0; b < nums.length; b++) for (let d = 0; d < nums.length; d++) for (let c = 0; c < nums.length; c++) {   // cantidad × precio × (1 − descuento %) = importe
      if (new Set([a, b, c, d]).size < 4) continue;
      const q = nums[a], p = nums[b], dc = nums[d], t = nums[c];
      if (!(q > 0) || !(t > 0) || q > 100000 || !(dc > 0 && dc <= 100) || !(p > 0)) continue;
      const e = Math.abs(q * p * (1 - dc / 100) - t);
      if (e <= tolDe(t)) nuevo({ a, b, c, q, t, usa: [a, b, c, d] }, 1, r2(t / q), e);
    }
    if (!cands.length) return null;
    const buenas = cands.filter(c => c.errAbs <= 0.02 || c.err <= 0.002);   // una coincidencia casual rara vez es tan exacta
    const pool = buenas.length ? buenas : cands;
    const mejor = pool.reduce((m, c) => {
      if (!m) return c;
      if (c.clase !== m.clase) return c.clase < m.clase ? c : m;
      if (c.penal !== m.penal) return c.penal < m.penal ? c : m;
      if (c.pdec !== m.pdec) return c.pdec < m.pdec ? c : m;   // un precio suele traer decimales; una cantidad o el n.º de ítem, no
      const ord = x => (precioPrimero ? x.b < x.a && x.a < x.c : x.a < x.b && x.b < x.c) ? 0 : 1;   // orden de columnas esperado (según la cabecera de la tabla)
      if (ord(c) !== ord(m)) return ord(c) < ord(m) ? c : m;
      const qi = x => Number.isInteger(x.q) ? 0 : 1;   // la cantidad suele ser entera; el precio, no
      if (qi(c) !== qi(m)) return qi(c) < qi(m) ? c : m;
      if (c.t !== m.t) return c.t > m.t ? c : m;
      if (Math.abs(c.err - m.err) > 1e-9) return c.err < m.err ? c : m;
      return c.orden && !m.orden ? c : m;
    }, null);
    if (mejor.clase === 0) {   // ¿hay además un importe con IGV (≈ total × 1,18) a su derecha? Entonces el precio leído iba sin IGV.
      const j = nums.findIndex((x, k) => k > mejor.b && k > mejor.c && !mejor.usa.includes(k) && Math.abs(x - mejor.t * IGV) <= tolDe(x));
      if (j >= 0) { mejor.precio = r2(nums[j] / mejor.q); mejor.usa.push(j); }
    }
    const usados = new Set(mejor.usa.map(k => idx[k]));
    const { codigo, desc } = armarTexto(seq, usados);
    if (!desc && !codigo) return null;
    if (NO_PRODUCTO.test(desc)) return null;
    return { codigo, desc, qty: mejor.q, precio: mejor.precio };
  }

  // Nombre corto para Stock: lo que va antes de «CON …», «EN …» o una comilla; la descripción completa queda aparte.
  function nombreCorto(desc) {
    const d = String(desc || '').replace(/\s+/g, ' ').trim();
    if (d.length <= 40) return d;
    const corte = d.search(/\s(?:CON|CONTIENE|EN|INCLUYE)\s|\s["“(]/i);
    if (corte >= 12) return d.slice(0, corte).trim();
    return d.split(' ').slice(0, 5).join(' ');
  }
  // Líneas que NO pueden ser el nombre del proveedor (direcciones, teléfonos, datos del cliente, forma de pago, bancos, columnas…).
  const RUIDO_NOMBRE = /factura|boleta|cliente|se[ñn]or|adquirente|direcci|^dir\b|dir\.|local|\bjr\b|jr\.|\bav\b|av\.|\bpj\b|pj\.|\bpsj\b|\bmz\b|\blote\b|calle|\bcal\b|cal\.|urb\.|whatsapp|mensaje|precio|unitario|\bunit\b|dscto|desct|\bcant\b|\bitem\b|subtotal|\bigv\b|distrito|telf|tel[eé]f|tel:|@|www\.|\.com|\.pe\b|correo|e-mail|ruc|fecha|gu[ií]a|forma\s*(?:de\s*)?pago|cr[eé]dito|contado|condici|vendedor|moneda|o\/c|orden de|vencim|observ|banco|cuenta|bcp|bbva|interbank|total|monto|importe|valor|igv|descuento|cantidad|descripci|c[oó]digo|unidad|\bnro\b|n[°º]|p[aá]gina|representaci|sunat|electr[oó]nica/i;
  // Para nombres ya guardados solo se descartan los que claramente son una dirección o un dato suelto.
  const parecedireccion = x => /dir\.|direcci|local:|\bjr\b|jr\.|\bav\.|\bcalle\b|urb\.|telf|@|www\.|\.com|forma\s*pago|cr[eé]dito\s*\d/i.test(String(x || ''));
  // Filas con solo cantidad y precio unitario (sin columna de importe): se usan únicamente si no se pudo leer ninguna fila completa.
  function lineaSimple(raw) {
    const seq = tokenizar(raw);
    const idx = seq.map((e, i) => e.tipo === 'num' ? i : -1).filter(i => i >= 0);
    const iTx = seq.map((e, i) => e.tipo === 'txt' ? i : -1).filter(i => i >= 0);
    if (idx.length < 2 || !iTx.length) return null;
    // cantidad = primer número, precio = último; los de en medio solo valen si están dentro de la descripción («… 0.73 X12»)
    const medios = idx.slice(1, -1);
    if (medios.some(i => !(i > iTx[0] && i < iTx[iTx.length - 1]))) return null;
    const q = seq[idx[0]].val, p = seq[idx[idx.length - 1]].val;
    if (!(q > 0) || q > 100000 || !(p > 0)) return null;
    const { codigo, desc } = armarTexto(seq, new Set([idx[0], idx[idx.length - 1]]));
    return (desc || codigo) && !NO_PRODUCTO.test(desc) ? { codigo, desc, qty: q, precio: p } : null;
  }
  // Dígito verificador del RUC (módulo 11): detecta cifras mal leídas por el OCR.
  function rucValido(r) {
    if (!/^\d{11}$/.test(String(r || ''))) return false;
    const w = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]; let sum = 0;
    for (let i = 0; i < 10; i++) sum += Number(r[i]) * w[i];
    let d = 11 - (sum % 11); if (d === 10) d = 0; else if (d === 11) d = 1;
    return d === Number(r[10]);
  }
  const CONFUSAS = { 0: '869', 1: '7', 2: '7', 3: '85', 4: '9', 5: '683', 6: '580', 7: '12', 8: '03659', 9: '480' };
  // Si el OCR cambió UNA cifra, se busca la única corrección parecida (6↔8, 5↔6…) que da un RUC válido.
  function repararRuc(r) {
    if (rucValido(r)) return r;
    const out = [];
    for (let i = 2; i < 11; i++) for (const d of CONFUSAS[r[i]] || '') { const c = r.slice(0, i) + d + r.slice(i + 1); if (rucValido(c)) out.push(c); }
    return out.length === 1 ? out[0] : r;
  }
  // Filas de totales, cuotas o pie de página que casualmente cumplen «1 × 118,00 = 118,00»: no son productos.
  const NO_PRODUCTO = /^(?:sub\s*total|total|importe|igv|op\.?\s|gravad|inafect|exonerad|gratuit|descuento|cuota|nro\.?\s*cuota|gracias|p[aá]gina|pag\.|forma\s+de\s+pago|condici|vencim|son:|observ|icbper|otros\s+cargos|saldo|monto|precio\s+de\s+venta|valor\s+(?:de\s+)?venta)/i;
  const MESES = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, setiembre: 9, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
  function parseTexto(texto, origen) {
    const t = String(texto || '').replace(/\r/g, '');
    const filas0 = t.split('\n').map(x => x.trim().replace(/\s{2,}/g, ' ')).filter(Boolean);
    // El RUC del proveedor es el del emisor, no el del cliente. Las filas junto a «SEÑOR(ES)», «CLIENTE», «DATOS DEL CLIENTE»… son la zona del cliente.
    const reRuc = /\b(20\d{9}|10\d{9})\b/g;
    const zonaCli = new Set();
    const CAMPO_CLI = /^\s*(?:ruc|dni|denominaci|nombre|direcci|domicilio|tel[eé]f)/i;
    filas0.forEach((x, i) => {
      if (!/se[ñn]or(?:es)?\b|cliente|adquirente/i.test(x)) return;
      for (let k = i - 1; k <= i + 1; k++) zonaCli.add(k);
      for (let k = i + 2; k <= i + 5 && CAMPO_CLI.test(filas0[k - 1] || '') || (k === i + 2 && CAMPO_CLI.test(filas0[k] || '')); k++) zonaCli.add(k);   // las filas de datos del cliente que siguen (RUC, denominación, dirección…)
    });
    const rucsCli = new Set(); zonaCli.forEach(k => (filas0[k] || '').match(reRuc) && filas0[k].match(reRuc).forEach(r => rucsCli.add(r)));
    let ruc = (t.match(reRuc) || []).find(r => !rucsCli.has(r)) || '';
    if (ruc && /OCR/i.test(origen || '')) ruc = repararRuc(ruc);   // texto leído por OCR: se corrige una cifra mal leída
    // Serie y número: «F001-123», «F001 - 000123», «F001 Nº 000123», «E001 20-», o la serie en una fila y el número en la siguiente.
    let m = null;
    {
      const iTabla = filas0.findIndex(x => /cant/i.test(x) && /descripci|detalle|producto|c[oó]digo/i.test(x));
      const hasta = iTabla > 0 ? iTabla : filas0.length;
      const numeroTras = (resto, siguiente) =>
        (resto.match(/^\s*[-–]\s*(?:N(?:ro)?[°ºo*.:]*\s*)?(\d{1,10})\b/) || resto.match(/^\s+N(?:ro)?[°ºo*.:]*\s*(\d{1,10})\b/) || resto.match(/^\s*(\d{1,10})(?![\d\/.]|-\d)/)
          || (!resto.trim() && siguiente && siguiente.length < 30 ? siguiente.match(/^\s*(?:N(?:ro)?[°ºo*.:]*\s*)?(\d{1,10})\b/) : null) || [])[1];
      const buscar = pasada => {
        for (let i = 0; i < hasta && !m; i++) {
          const cerca = [filas0[i - 1], filas0[i], filas0[i + 1]].join(' ');
          if (pasada === 1 && !/factura|boleta|electr[oó]nic|comprobante/i.test(cerca)) continue;
          for (const sm of filas0[i].matchAll(/\b([FEB][A-Z0-9]{3})\b/g)) {
            if (!/\d/.test(sm[1])) continue;
            const num = numeroTras(filas0[i].slice(sm.index + sm[1].length), filas0[i + 1]);
            if (num) { m = [null, sm[1], num]; break; }
          }
        }
      };
      buscar(1); if (!m) buscar(2);
    }
    const pad2 = n => String(n).padStart(2, '0');
    const l1 = t.match(/emisi[oó]n\s*:?\s*(\d{4})-(\d{1,2})-(\d{1,2})/i), l2 = t.match(/emisi[oó]n\s*:?\s*(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/i);
    let fecha = l1 ? `${l1[1]}-${pad2(l1[2])}-${pad2(l1[3])}` : l2 ? `${l2[3]}-${pad2(l2[2])}-${pad2(l2[1])}` : '';
    if (!fecha) {   // sin rótulo «Emisión»: la primera fecha del documento que no sea de vencimiento ni de leyendas
      const tf = t.split('\n').filter(x => !/venc|autorizad|desde el/i.test(x)).join('\n');
      const f1 = tf.match(/\b(\d{4})-(\d{2})-(\d{2})\b/), f2 = tf.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})\b/), f3 = tf.match(/\b(\d{1,2})\s+de\s+([A-Za-záéíóú]+)\s+(?:del?\s+)?(\d{4})\b/i);
      fecha = f1 ? f1[0] : f2 ? `${f2[3]}-${pad2(f2[2])}-${pad2(f2[1])}` : '';
      if (!fecha && f3 && MESES[f3[2].toLowerCase()]) fecha = `${f3[3]}-${pad2(MESES[f3[2].toLowerCase()])}-${pad2(f3[1])}`;
    }
    const lineas = []; let ultima = null, cont = 0;
    const todas = t.split('\n').map(x => x.trim());
    const iHead0 = todas.findIndex(x => /\b(?:cant|cantidad|qty)\b/i.test(x) && /descripci|detalle|producto|description|c[oó]digo|code|item/i.test(x));
    const cab = iHead0 >= 0 ? todas[iHead0] + ' ' + (todas[iHead0 + 1] || '') : '';
    const posCant = cab.search(/\b(?:cant|cantidad|qty)\b/i), posPrecio = cab.search(/\bp\.?\s?u(?:nit)?\b|precio|valor\s+unit|\bunit/i);
    const precioPrimero = posCant >= 0 && posPrecio >= 0 ? posPrecio < posCant : null;   // ¿la columna de precio va antes que la de cantidad?
    const iFin0 = iHead0 >= 0 ? todas.findIndex((x, i) => i > iHead0 && /^(?:sub\s*total|total\b|op\.?\s*gravada|valor\s+(?:de\s+)?venta|importe\s+total|son:|gravada\b)/i.test(x)) : -1;
    t.split('\n').forEach((raw, ri) => {
      const l = raw.trim();
      const enTabla = iHead0 < 0 || (ri > iHead0 && (iFin0 < 0 || ri < iFin0));   // con cabecera de tabla, solo cuentan las filas entre ella y los totales
      const it = l && enTabla ? lineaProducto(l, precioPrimero) : null;
      if (it) { lineas.push(it); ultima = it; cont = 0; return; }
      // Descripción larga que continúa en la fila de abajo (sin números de cantidad/precio).
      if (enTabla && ultima && cont < 2 && l.length >= 3 && l.length <= 90 && /[A-Za-zÁÉÍÓÚ]{3}/.test(l) && !STOP.test(l) && !/\d+[.,]\d{2}\b/.test(l) && !/\b[FEBfeb][A-Za-z0-9]{3}\s*-\s*\d/.test(l)) { ultima.desc = (ultima.desc + ' ' + l.replace(/\s{2,}/g, ' ')).trim(); cont++; }
      else ultima = null;
    });
    // Segunda pasada: facturas que traen solo cantidad y precio unitario (sin importe). Se leen entre la cabecera de la tabla y los totales.
    if (!lineas.length) {
      const rows = t.split('\n').map(x => x.trim()).filter(Boolean);
      const iHead = rows.findIndex(x => /cant/i.test(x) && /descripci|detalle|producto/i.test(x));
      if (iHead >= 0) {
        for (let k = iHead + 1; k < rows.length; k++) {
          if (/sub\s*total|valor\s+(?:de\s+)?venta|gravada|^son:|importe\s+total|^total/i.test(rows[k])) break;
          const it = lineaSimple(rows[k]); if (it) lineas.push(it);
        }
        // ¿Los precios vienen sin IGV? Se compara la suma cantidad × precio con «Valor de venta» (sin IGV) y con el total (con IGV).
        const valNum = re => { const mm = t.match(re); return mm ? num(mm[1]) : 0; };
        const vVenta = valNum(/(?:sub\s*total\s+ventas|valor\s+(?:de\s+)?venta|gravada)[^\d\n]*([\d.,]+)/i), vTotal = valNum(/^(?:importe\s+total|precio\s+de\s+venta|total(?:\s+general)?)\b[^\d\n]*([\d.,]+)/im);
        const suma = lineas.reduce((a, l) => a + l.qty * l.precio, 0), cerca = (x, y) => y > 0 && Math.abs(x - y) <= Math.max(0.5, 0.005 * y);
        if (lineas.length && cerca(suma, vVenta) && !cerca(suma, vTotal)) lineas.forEach(l => { l.precio = r2(l.precio * IGV); });
      }
    }
    const filas = filas0;
    const crudas = t.split('\n').map(x => x.trim()).filter(Boolean);   // con los espacios dobles que separan columnas
    const SUFIJO = /\b(S\.?A\.?C|S\.?R\.?L|E\.?I\.?R\.?L|S\.?A\.?A|S\.?A)\b\.?/i;
    const limpiar = x => x.replace(/^(?:raz[oó]n social|proveedor|emisor|empresa|nombre|denominaci[oó]n)\s*:?\s*/i, '').replace(/R\.?\s?U\.?\s?C\.?\s*(?:N[°ºo.]*)?\s*:?/gi, ' ').replace(new RegExp(ruc || '#####', 'g'), ' ').replace(/[:|]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
    const FECHA_TXT = /\b\d{1,2}\s+de\s+[a-záéíóú]+|\b\d{1,4}[\/-]\d{1,2}[\/-]\d{1,4}\b/i;
    const valido = x => x.length >= 4 && /[A-Za-zÁÉÍÓÚÑ]{4}/.test(x) && !RUIDO_NOMBRE.test(x) && !/\d{5,}/.test(x) && !esNum(x) && !FECHA_TXT.test(x);
    const celdas = k => {   // una fila puede traer el nombre del emisor y, al lado, el recuadro de la factura; se descartan los valores de rótulos («Fecha : 2 de julio…»)
      if (zonaCli.has(k)) return [];
      const cs = (crudas[k] || '').split(/\s{2,}/), out = [];
      cs.forEach((c, i) => { if (/^\s*:/.test(c) || (i > 0 && /:\s*$/.test(cs[i - 1]))) return; const l = limpiar(c); if (l) out.push(l); });
      return out;
    };
    const iRuc = ruc ? filas.findIndex(x => x.includes(ruc)) : -1;
    const iTabla2 = filas.findIndex(x => /cant/i.test(x) && /descripci|detalle|producto|c[oó]digo/i.test(x));
    const hasta2 = iTabla2 > 0 ? iTabla2 : Math.min(filas.length, 30);
    let prov = '';
    for (let k = 0; k < hasta2 && !prov; k++) { if (zonaCli.has(k)) continue; const mm = filas[k].match(/^(?:raz[oó]n social|proveedor|emisor|empresa)\s*:\s*(.+)$/i); if (mm && valido(limpiar(mm[1]))) prov = limpiar(mm[1]); }
    if (!prov) {
      // ¿Cuál fila parece un nombre de empresa? Mayúsculas, sufijo S.A.C./E.I.R.L., cerca del RUC y sin aspecto de frase (los lemas llevan «de», «y», «para»…).
      let mejor = null;
      for (let k = 0; k < hasta2; k++) for (const c of celdas(k)) {
        if (!valido(c)) continue;
        const letras = c.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, ''), mayus = letras.replace(/[^A-ZÁÉÍÓÚÑ]/g, '');
        let sc = (SUFIJO.test(c) ? 3 : 0) + (letras.length && mayus.length / letras.length >= 0.7 ? 2 : 0);
        if (/^[a-záéíóúñ]/.test(c)) sc -= 3;
        sc -= 2 * Math.min((c.match(/\b(?:de|del|y|para|con|las|los|la|el|en|por|todo|tipo)\b/g) || []).length, 2);
        const nw = c.split(/\s+/).length; if (nw > 8) sc -= 2; if (nw < 2 && !SUFIJO.test(c)) sc -= 1.5;
        if (/\d/.test(c)) sc -= 2;
        sc -= iRuc >= 0 ? 0.1 * Math.abs(k - iRuc) : 0.05 * k;
        if (sc >= -0.6 && (!mejor || sc > mejor.sc)) mejor = { sc, c };
      }
      if (mejor) prov = mejor.c;
    }
    // Nunca el nombre del cliente (la empresa que compra), aunque aparezca fuera de su bloque.
    const nombresCli = new Set(); zonaCli.forEach(k => (crudas[k] || '').split(/\s{2,}/).forEach(c => { const l = limpiar(c).toUpperCase(); if (l) nombresCli.add(l); }));
    if (prov && nombresCli.has(prov.toUpperCase())) prov = '';
    const monLinea = (t.match(/MONEDA\s*:?\s*([A-Za-zÁÉÓÚ\/\.$]+)/i) || [])[1] || '';
    const usd = monLinea ? /d[óo]lar|usd|us\$/i.test(monLinea) : /d[óo]lares americanos|\bUSD\b|US\s?\$/i.test(t) && !/son:[^\n]*soles/i.test(t);
    // Tipo: primero el título («BOLETA DE VENTA ELECTRÓNICA» / «FACTURA ELECTRÓNICA»), luego la serie (B… = boleta, F… = factura), luego las palabras sueltas.
    const titulo = (t.match(/(factura|boleta)\s+(?:de\s+venta\s+)?electr[oó]nica/i) || [])[1];
    const serieDoc = m ? m[1].toUpperCase() : '';
    const esBoleta = titulo ? /boleta/i.test(titulo) : /^B/.test(serieDoc) ? true : /^F/.test(serieDoc) ? false : /boleta/i.test(t) && !/factura/i.test(t);
    return { origen, tipo: esBoleta ? 'Boleta' : 'Factura', serie: m ? (/OCR/i.test(origen || '') ? m[1].toUpperCase().replace(/O/g, '0') : m[1].toUpperCase()) : '', numero: m ? m[2] : '', fecha, moneda: usd ? 'USD' : 'PEN', proveedor: prov, ruc, rucDudoso: !!ruc && !rucValido(ruc), lineas };
  }

  const cargarScript = src => new Promise((ok, no) => { if (document.querySelector(`script[src="${src}"]`)) return ok(); const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => no(new Error('No se pudo cargar el lector (¿hay internet?).')); document.head.appendChild(s); });
  // Agrupa los textos por fila (misma altura) y los ordena de izquierda a derecha: cada producto queda en UNA línea.
  function filasDesdeItems(items) {
    const arr = items.filter(it => it.s && it.s.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
    const filas = [];
    arr.forEach(it => { const f = filas.find(r => Math.abs(r.y - it.y) <= 3); if (f) f.items.push(it); else filas.push({ y: it.y, items: [it] }); });
    return filas.sort((a, b) => b.y - a.y).map(f => {
      f.items.sort((a, b) => a.x - b.x);
      let linea = '', fin = null;
      f.items.forEach(it => { if (fin !== null) { const gap = it.x - fin; linea += gap > 8 ? '  ' : gap > 1 ? ' ' : ''; } linea += it.s.trim(); fin = it.x + (it.w || 0); });
      return linea;
    }).join('\n') + '\n';
  }
  // Nombre de empresa a partir del texto que el OCR lee en el logo (descarta direcciones, teléfonos y líneas con números).
  function nombreDeLogo(texto) {
    const ls = String(texto || '').split('\n').map(x => x.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ0-9 .&\-]/g, ' ').replace(/\s{2,}/g, ' ').trim()).filter(Boolean);
    return ls.find(x => x.length >= 6 && x.split(' ').length >= 2 && /[A-Za-zÁÉÍÓÚÑ]{3}/.test(x) && !/\d{3,}/.test(x) && !RUIDO_NOMBRE.test(x)) || '';
  }

  async function pdfATexto(file) {
    await cargarScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    let out = '', lienzo = null, pg1 = null;
    for (let i = 1; i <= Math.min(pdf.numPages, 8); i++) {
      const pg = await pdf.getPage(i), c = await pg.getTextContent();
      if (i === 1) pg1 = pg;
      out += filasDesdeItems(c.items.map(it => ({ s: it.str, x: it.transform[4], y: it.transform[5], w: it.width || 0 })));
      if (i === 1 && out.trim().length < 30) { const vp = pg.getViewport({ scale: 2 }); lienzo = document.createElement('canvas'); lienzo.width = vp.width; lienzo.height = vp.height; await pg.render({ canvasContext: lienzo.getContext('2d'), viewport: vp }).promise; }
    }
    if (lienzo) return { texto: await ocr(lienzo), ocr: true };   // PDF escaneado: sin texto, se lee como foto
    // Muchas facturas llevan el nombre del emisor solo como imagen (logo): se lee la parte de arriba con OCR cuando haga falta.
    const imagenACanvas = im => {   // imagen de pdf.js (RGB, RGBA o 1 bit) → canvas con fondo blanco
      const c = document.createElement('canvas'); c.width = im.width; c.height = im.height;
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      if (im.bitmap) { ctx.drawImage(im.bitmap, 0, 0); return c; }
      const n = im.width * im.height, d = ctx.createImageData(im.width, im.height), px = im.data;
      if (px.length === n * 4) d.data.set(px);
      else if (px.length === n * 3) for (let i = 0; i < n; i++) { d.data[i * 4] = px[i * 3]; d.data[i * 4 + 1] = px[i * 3 + 1]; d.data[i * 4 + 2] = px[i * 3 + 2]; d.data[i * 4 + 3] = 255; }
      else { const fila = (im.width + 7) >> 3; if (px.length < fila * im.height) return null; for (let y = 0; y < im.height; y++) for (let x = 0; x < im.width; x++) { const v = (px[y * fila + (x >> 3)] >> (7 - (x & 7))) & 1 ? 255 : 0, k = (y * im.width + x) * 4; d.data[k] = d.data[k + 1] = d.data[k + 2] = v; d.data[k + 3] = 255; } }
      const tmp = document.createElement('canvas'); tmp.width = im.width; tmp.height = im.height; tmp.getContext('2d').putImageData(d, 0, 0);
      ctx.drawImage(tmp, 0, 0); return c;
    };
    const leerLogo = async () => {
      // 1) Las imágenes incrustadas de la primera página (el logo del emisor), leídas a su tamaño real; los QR (cuadrados) van al final.
      const OPS = window.pdfjsLib.OPS, ops = await pg1.getOperatorList(), nombres = [];
      ops.fnArray.forEach((f, i) => { if (f === OPS.paintImageXObject || f === OPS.paintJpegXObject) nombres.push(ops.argsArray[i][0]); });
      const imgs = [];
      for (const n of nombres) { const im = await new Promise(res => { try { pg1.objs.get(n, res); } catch (e) { res(null); } }); if (im && im.width >= 80 && im.height >= 40) imgs.push(im); }
      const cuadrada = im => Math.abs(im.width / im.height - 1) < 0.15;
      imgs.sort((a, b) => (cuadrada(a) - cuadrada(b)) || (b.width * b.height - a.width * a.height));
      for (const im of imgs.slice(0, 3)) {
        const c = imagenACanvas(im); if (!c) continue;
        const nm = nombreDeLogo(await ocr(c)); if (nm) return nm;
      }
      // 2) Plan B: la franja de arriba de la página con más resolución.
      const vp = pg1.getViewport({ scale: 3 }), full = document.createElement('canvas'); full.width = vp.width; full.height = vp.height;
      await pg1.render({ canvasContext: full.getContext('2d'), viewport: vp }).promise;
      const crop = document.createElement('canvas'); crop.width = Math.round(full.width * 0.7); crop.height = Math.round(full.height * 0.22);
      crop.getContext('2d').drawImage(full, 0, 0, crop.width, crop.height, 0, 0, crop.width, crop.height);
      return nombreDeLogo(await ocr(crop));
    };
    return { texto: out, ocr: false, leerLogo };
  }
  async function ocr(fuente) {
    await cargarScript('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js');
    const r = await window.Tesseract.recognize(fuente, 'spa');
    return r.data.text;
  }

  // Razón social por RUC con una API de consulta (SUNAT). El token y la URL los guarda el administrador en la base de datos (meta/rucApi), no en el código.
  function nombreDeRespuesta(j) {
    const d = (j && (j.data || j.result || j)) || {};
    return String(d.razonSocial || d.razon_social || d.nombre_o_razon_social || d.nombreORazonSocial || d.nombre || d.name || '').trim();
  }
  async function consultarRuc(ruc, cfg) {
    if (!cfg || !cfg.token || !/^\d{11}$/.test(String(ruc || ''))) return '';
    const plantilla = cfg.url || 'https://api.apis.net.pe/v2/sunat/ruc?numero={ruc}';
    const url = plantilla.replace('{ruc}', ruc).replace('{token}', encodeURIComponent(cfg.token));
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null, to = ctl ? setTimeout(() => ctl.abort(), 8000) : null;
    try {
      const headers = { Accept: 'application/json' }; if (!plantilla.includes('{token}')) headers.Authorization = 'Bearer ' + cfg.token;
      const r = await fetch(url, { headers, signal: ctl ? ctl.signal : undefined });
      if (!r.ok) return '';
      return nombreDeRespuesta(await r.json());
    } catch (e) { return ''; } finally { if (to) clearTimeout(to); }
  }

  async function leerArchivo(file, onEstado, resolver) {
    const completarPorRuc = async res => {   // el nombre del proveedor (razón social) se busca por su RUC
      if ((!res.proveedor || (res.ocr && rucValido(res.ruc))) && res.ruc && resolver) {
        if (onEstado) onEstado('Buscando el proveedor por su RUC…');
        try { const nm = await resolver(res.ruc); if (nm) { res.proveedor = nm; res.proveedorPorRuc = true; } } catch (e) { /* sigue con las otras opciones */ }
      }
      return res;
    };
    const n = (file.name || '').toLowerCase(), t = file.type || '';
    if (n.endsWith('.xml') || t.includes('xml')) return parseXml(await file.text());
    if (n.endsWith('.pdf') || t === 'application/pdf') {
      const r = await pdfATexto(file), res = await completarPorRuc(Object.assign(parseTexto(r.texto, r.ocr ? 'PDF escaneado (OCR)' : 'PDF'), { ocr: r.ocr, texto: r.texto }));
      if (!res.proveedor && r.leerLogo) {
        if (onEstado) onEstado('Buscando el nombre del proveedor en el logo… (la primera vez puede tardar)');
        try {
          const tx = await Promise.race([r.leerLogo(), new Promise((_, rej) => setTimeout(() => rej(new Error('tiempo')), 60000))]);
          const nm = nombreDeLogo(tx);
          if (nm) { res.proveedor = nm; res.proveedorOcr = true; }
        } catch (e) { /* sin logo legible: el proveedor se escribe a mano */ }
      }
      return res;
    }
    if (t.startsWith('image/')) { const tx = await ocr(file); return completarPorRuc(Object.assign(parseTexto(tx, 'Foto (OCR)'), { ocr: true, texto: tx })); }
    throw new Error('Formato no soportado. Usa XML, PDF o una foto.');
  }

  // Sugiere el producto del sistema por código exacto o por palabras en común.
  function sugerirProducto(l, prods) {
    const ents = Object.entries(prods).filter(([, p]) => !p.deleted);
    const cod = String(l.codigo || '').toUpperCase();
    const porCod = ents.find(([c]) => c.toUpperCase() === cod);
    if (cod && porCod) return porCod[0];
    const tok = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter(w => w.length > 2);
    const a = new Set(tok(l.desc)); if (!a.size) return '';
    let mejor = '', pts = 0;
    ents.forEach(([c, p]) => { const b = tok(p.name); const k = b.filter(w => a.has(w)).length / Math.max(a.size, b.length || 1); if (k > pts) { pts = k; mejor = c; } });
    return pts >= 0.5 ? mejor : '';
  }

  // ── Modal de previsualización: todo lo leído (descripción, código, cantidad, precio) se ve y se puede corregir ──
  function abrirPrevisualizacion(borrador, prods, alAprobar, buscarPorRuc) {
    document.getElementById('ciModal')?.remove();
    const activos = Object.entries(prods).filter(([, p]) => !p.deleted);
    const opts = sel => '<option value="">— Elegir producto —</option><option value="__nuevo__"' + (sel === '__nuevo__' ? ' selected' : '') + '>Producto nuevo</option>' + activos.map(([c, p]) => `<option value="${esc(c)}"${c === sel ? ' selected' : ''}>${esc(c)} — ${esc(p.name || '')}</option>`).join('');
    const fila = l => `<tr><td class="ci-cell">
      <div class="ci-top"><input class="ci-desc" placeholder="Descripción leída" value="${esc(l.desc || '')}"><button type="button" class="btn ci-del">Quitar</button></div>
      <div class="ci-grid">
        <label class="ci-f ci-f-prod"><span>Producto</span><select class="ci-prod">${opts(sugerirProducto(l, prods) || (l.desc || l.codigo ? '__nuevo__' : ''))}</select></label>
        <label class="ci-f ci-nuevo"><span>Código</span><input class="ci-cod" placeholder="Automático si va vacío" value="${esc(l.codigo || '')}"></label>
        <label class="ci-f ci-nuevo"><span>Origen</span><select class="ci-tipo"><option value="importado"${l.codigo ? ' selected' : ''}>Importado</option><option value="nacional"${l.codigo ? '' : ' selected'}>Nacional</option></select></label>
        <label class="ci-f"><span>Cantidad</span><input class="ci-qty" type="number" min="1" value="${l.qty || 1}"></label>
        <label class="ci-f"><span>Precio c/IGV</span><input class="ci-price" type="number" min="0" step="0.01" value="${l.precio || 0}"></label>
        <div class="ci-f"><span>Importe</span><b class="ci-imp">S/ 0.00</b></div>
      </div></td></tr>`;
    const filas = (borrador.lineas.length ? borrador.lineas : [{ codigo: '', desc: '', qty: 1, precio: 0 }]).map(fila).join('');
    const crudo = borrador.texto ? `<details class="bal-hint"><summary>Ver el texto que se leyó del archivo</summary><pre style="white-space:pre-wrap;max-height:160px;overflow:auto">${esc(borrador.texto)}</pre></details>` : '';
    const ov = document.createElement('div'); ov.id = 'ciModal'; ov.className = 'modal-overlay open';
    ov.innerHTML = `<div class="modal ci-modal" role="dialog" aria-modal="true">
      <div class="modal-header"><div><h2>Revisa lo leído del comprobante</h2><p>Origen: ${esc(borrador.origen)}</p></div></div>
      <div class="modal-body">
        <div class="ci-warn">${borrador.ocr ? '⚠ Leído por OCR: revisa cada dato.' : 'Compara con el documento y corrige lo que haga falta.'}${borrador.proveedorOcr ? ' El nombre del proveedor se leyó del logo: verifícalo.' : ''}${borrador.proveedorPorRuc ? ' Proveedor obtenido por su RUC.' : ''}${borrador.rucDudoso ? ' ⚠ El RUC no tiene un dígito verificador válido: revísalo.' : ''}${borrador.moneda === 'USD' ? ' Esta factura está en dólares: los precios se registran tal cual, sin convertir. Edítalos si los quieres en soles.' : ''}</div>
        <div class="bal-form">
          <label class="bal-field"><span>Proveedor <a href="#" id="ciProvBuscar" style="font-weight:500;font-size:12px;margin-left:6px">Buscar por RUC</a></span><input id="ciProv" placeholder="${borrador.proveedor ? '' : 'Escribe el proveedor (no se pudo leer)'}" value="${esc(borrador.proveedor)}"></label>
          <label class="bal-field"><span>RUC</span><input id="ciRuc" inputmode="numeric" maxlength="11" value="${esc(borrador.ruc)}"></label>
          <label class="bal-field"><span>Comprobante</span><select id="ciTipo"><option${borrador.tipo === 'Factura' ? ' selected' : ''}>Factura</option><option${borrador.tipo === 'Boleta' ? ' selected' : ''}>Boleta</option></select></label>
          <label class="bal-field"><span>Fecha</span><input id="ciFecha" type="date" value="${esc(borrador.fecha)}"></label>
          <label class="bal-field"><span>Serie</span><input id="ciSerie" value="${esc(borrador.serie)}"></label>
          <label class="bal-field"><span>Número</span><input id="ciNum" value="${esc(borrador.numero)}"></label>
          <label class="bal-field"><span>Almacén donde se añade</span><select id="ciAlm"><option value="alm1">Almacén 1</option><option value="alm2">Almacén 2</option><option value="alm3">Almacén 3</option></select></label>
        </div>
        <h3 style="margin:14px 0 6px">Productos</h3>
        <p class="bal-hint">Elige el producto de cada línea, o deja «Producto nuevo» para crearlo con la descripción y el código que ves. Sin elegir = se descarta.${borrador.lineas.length ? '' : ' No se detectaron líneas: escríbelas aquí.'}</p>
        ${crudo}
        <div class="bal-scroll"><table class="bal-table"><tbody id="ciLineas">${filas}</tbody></table></div>
        <button type="button" class="btn" id="ciAdd">+ Agregar línea</button>
        <p id="ciTotal" class="bal-hint"></p>
      </div>
      <div class="ci-actions"><button type="button" class="btn" id="ciCancel">Cancelar</button><button type="button" class="btn" id="ciOk">Solo rellenar el formulario</button><button type="button" class="btn btn-primary" id="ciGuardar">✓ Aprobar y registrar en stock</button></div>
    </div>`;
    document.body.appendChild(ov);
    const q = id => ov.querySelector('#' + id), cerrar = () => ov.remove();
    const almForm = document.getElementById('cpAlm'); if (almForm) q('ciAlm').value = almForm.value;   // parte del que ya elegiste en el formulario
    const refrescar = () => {
      let total = 0;
      q('ciLineas').querySelectorAll('tr').forEach(tr => {
        tr.querySelector('.ci-nuevo').style.display = tr.querySelector('.ci-prod').value === '__nuevo__' ? '' : 'none';
        const imp = r2((Number(tr.querySelector('.ci-qty').value) || 0) * (Number(tr.querySelector('.ci-price').value) || 0)); total += imp;
        tr.querySelector('.ci-imp').textContent = 'S/ ' + imp.toFixed(2);
      });
      q('ciTotal').textContent = 'Total leído: S/ ' + r2(total).toFixed(2);
    };
    ov.onclick = e => { if (e.target === ov) cerrar(); };
    q('ciCancel').onclick = cerrar;
    q('ciProvBuscar').onclick = async e => { e.preventDefault(); if (!buscarPorRuc) return; const nm = await buscarPorRuc(q('ciRuc').value, true); if (nm) q('ciProv').value = nm; };
    q('ciLineas').oninput = q('ciLineas').onchange = refrescar;
    q('ciLineas').onclick = e => { if (e.target.classList.contains('ci-del')) { e.target.closest('tr').remove(); refrescar(); } };
    q('ciAdd').onclick = () => { q('ciLineas').insertAdjacentHTML('beforeend', fila({ qty: 1, precio: 0 })); refrescar(); };
    refrescar();
    const aprobar = guardar => {
      const lineas = [...q('ciLineas').querySelectorAll('tr')].map(tr => ({ code: tr.querySelector('.ci-prod').value, qty: Number(tr.querySelector('.ci-qty').value), precio: Number(tr.querySelector('.ci-price').value), codigoNuevo: tr.querySelector('.ci-cod').value.trim(), desc: tr.querySelector('.ci-desc').value.trim(), tipoNuevo: tr.querySelector('.ci-tipo').value })).filter(l => l.code);
      if (guardar && !lineas.length) return alert('Elige al menos un producto antes de registrar la compra.');
      if (lineas.some(l => l.code === '__nuevo__' && !l.desc)) return alert('Escribe la descripción de los productos nuevos.');
      alAprobar({ proveedor: q('ciProv').value.trim(), ruc: q('ciRuc').value.trim(), tipo: q('ciTipo').value, fecha: q('ciFecha').value, serie: q('ciSerie').value.trim(), numero: q('ciNum').value.trim(), almacen: q('ciAlm').value, lineas }, guardar === true);
      cerrar();
    };
    q('ciOk').onclick = () => aprobar(false);          // solo rellena el formulario
    q('ciGuardar').onclick = () => aprobar(true);      // rellena y guarda la compra
  }

  window.ComprasImport = { rucValido, repararRuc, consultarRuc, nombreDeRespuesta, filasDesdeItems, nombreDeLogo, parecedireccion, nombreCorto, parseXml, parseTexto, leerArchivo, sugerirProducto, abrirPrevisualizacion };
})();
