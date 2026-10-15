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
    const idFull = [...root.children].find(e => e.localName === 'ID'); const id = idFull ? idFull.textContent.trim() : '';
    const [serie, numero] = id.split('-');
    const code = txt(root, 'InvoiceTypeCode');
    const sup = first(root, 'AccountingSupplierParty');
    const ruc = sup ? txt(first(sup, 'PartyIdentification') || sup, 'ID') : '';
    const proveedor = sup ? (txt(sup, 'RegistrationName') || txt(first(sup, 'PartyName') || sup, 'Name')) : '';
    const lineas = all(root, kind === 'Invoice' ? 'InvoiceLine' : kind === 'CreditNote' ? 'CreditNoteLine' : 'DebitNoteLine').map(l => {
      const qty = num(txt(l, 'InvoicedQuantity') || txt(l, 'CreditedQuantity') || txt(l, 'DebitedQuantity'));
      const alt = first(l, 'AlternativeConditionPrice'), pr = first(l, 'Price');
      const precio = alt ? num(txt(alt, 'PriceAmount')) : pr ? r2(num(txt(pr, 'PriceAmount')) * IGV) : 0;
      const item = first(l, 'Item'), sid = item && first(item, 'SellersItemIdentification');
      return { codigo: sid ? txt(sid, 'ID') : '', desc: item ? txt(item, 'Description') : '', qty, precio };
    });
    return { origen: 'XML', tipo: code === '03' ? 'Boleta' : 'Factura', serie: serie || '', numero: numero || '', fecha: txt(root, 'IssueDate'), proveedor, ruc, lineas };
  }

  // ── Texto (PDF u OCR): se buscan los datos típicos; las líneas son "mejor esfuerzo" ──
  function parseTexto(texto, origen) {
    const t = String(texto || '').replace(/\r/g, '');
    const ruc = (t.match(/\b(20\d{9}|10\d{9})\b/) || [])[1] || '';
    const m = t.match(/\b([FEBfeb][A-Za-z0-9]{3})\s*[-–]\s*0*(\d{1,8})\b/);
    const f1 = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/), f2 = t.match(/\b(\d{2})[\/-](\d{2})[\/-](\d{4})\b/);
    const fecha = f1 ? f1[0] : f2 ? `${f2[3]}-${f2[2]}-${f2[1]}` : '';
    const lineas = [];
    t.split('\n').forEach(raw => {
      const l = raw.trim().replace(/\s{2,}/g, '  ');
      const x = l.match(/^(?:(\S+)\s+)?(.{3,}?)\s+(\d+(?:[.,]\d+)?)\s+(?:UND|UNID|UNIDAD|NIU|ZZ|SET|PZA)?\s*([\d.,]+)\s+([\d.,]+)$/i);
      if (!x) return;
      const qty = num(x[3]), a = num(x[4]), b = num(x[5]);
      if (!(qty > 0)) return;
      if (Math.abs(qty * a - b) <= 0.05 * Math.max(1, b)) lineas.push({ codigo: x[1] || '', desc: x[2].trim(), qty, precio: a });          // precio unitario con IGV
      else if (Math.abs(qty * a * IGV - b) <= 0.05 * Math.max(1, b)) lineas.push({ codigo: x[1] || '', desc: x[2].trim(), qty, precio: r2(a * IGV) });   // precio sin IGV
    });
    const prov = (t.split('\n').map(s => s.trim()).find(s => s.length > 4 && !/\d{8,}/.test(s) && /[A-Za-zÁÉÍÓÚ]{4}/.test(s)) || '');
    return { origen, tipo: /boleta/i.test(t) && !/factura/i.test(t) ? 'Boleta' : 'Factura', serie: m ? m[1].toUpperCase() : '', numero: m ? m[2] : '', fecha, proveedor: prov, ruc, lineas };
  }

  const cargarScript = src => new Promise((ok, no) => { if (document.querySelector(`script[src="${src}"]`)) return ok(); const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => no(new Error('No se pudo cargar el lector (¿hay internet?).')); document.head.appendChild(s); });
  async function pdfATexto(file) {
    await cargarScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    let out = '', lienzo = null;
    for (let i = 1; i <= Math.min(pdf.numPages, 5); i++) {
      const pg = await pdf.getPage(i), c = await pg.getTextContent(); let y = null, linea = '';
      c.items.forEach(it => { const yy = Math.round(it.transform[5]); if (y !== null && Math.abs(yy - y) > 3) { out += linea + '\n'; linea = ''; } y = yy; linea += it.str + '  '; });
      out += linea + '\n';
      if (i === 1 && out.trim().length < 30) { const vp = pg.getViewport({ scale: 2 }); lienzo = document.createElement('canvas'); lienzo.width = vp.width; lienzo.height = vp.height; await pg.render({ canvasContext: lienzo.getContext('2d'), viewport: vp }).promise; }
    }
    if (lienzo) return { texto: await ocr(lienzo), ocr: true };   // PDF escaneado: sin texto, se lee como foto
    return { texto: out, ocr: false };
  }
  async function ocr(fuente) {
    await cargarScript('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js');
    const r = await window.Tesseract.recognize(fuente, 'spa');
    return r.data.text;
  }

  async function leerArchivo(file) {
    const n = (file.name || '').toLowerCase(), t = file.type || '';
    if (n.endsWith('.xml') || t.includes('xml')) return parseXml(await file.text());
    if (n.endsWith('.pdf') || t === 'application/pdf') { const r = await pdfATexto(file); return Object.assign(parseTexto(r.texto, r.ocr ? 'PDF escaneado (OCR)' : 'PDF'), { ocr: r.ocr }); }
    if (t.startsWith('image/')) return Object.assign(parseTexto(await ocr(file), 'Foto (OCR)'), { ocr: true });
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

  // ── Modal de previsualización ──
  function abrirPrevisualizacion(borrador, prods, alAprobar) {
    document.getElementById('ciModal')?.remove();
    const activos = Object.entries(prods).filter(([, p]) => !p.deleted);
    const opts = sel => '<option value="">— Elegir producto —</option><option value="__nuevo__"' + (sel === '__nuevo__' ? ' selected' : '') + '>＋ Crear como producto nuevo (con código y descripción de la factura)</option>' + activos.map(([c, p]) => `<option value="${esc(c)}"${c === sel ? ' selected' : ''}>${esc(c)} — ${esc(p.name || '')}</option>`).join('');
    const filas = (borrador.lineas.length ? borrador.lineas : [{ codigo: '', desc: '', qty: 1, precio: 0 }]).map(l => `<tr data-cod="${esc(l.codigo || '')}" data-desc="${esc(l.desc || '')}">
      <td data-label="Leído">${esc(l.desc || l.codigo || '—')}</td>
      <td data-label="Producto"><select class="ci-prod">${opts(sugerirProducto(l, prods) || (l.desc ? '__nuevo__' : ''))}</select></td>
      <td data-label="Cant."><input class="ci-qty" type="number" min="1" value="${l.qty || 1}"></td>
      <td data-label="Precio c/IGV"><input class="ci-price" type="number" min="0" step="0.01" value="${l.precio || 0}"></td>
      <td><button type="button" class="btn ci-del">Quitar</button></td></tr>`).join('');
    const ov = document.createElement('div'); ov.id = 'ciModal'; ov.className = 'modal-overlay open';
    ov.innerHTML = `<div class="modal ci-modal" role="dialog" aria-modal="true">
      <div class="modal-header"><div><h2>Revisa lo leído del comprobante</h2><p>Origen: ${esc(borrador.origen)} · Nada se guarda hasta que apruebes y pulses «Guardar compra».</p></div></div>
      <div class="modal-body">
        <div class="ci-warn">${borrador.ocr ? '⚠ Leído con reconocimiento de texto: puede haber errores. Revisa cada dato contra el documento.' : 'Compara con el documento antes de aprobar.'}</div>
        <div class="bal-form">
          <label class="bal-field"><span>Proveedor</span><input id="ciProv" value="${esc(borrador.proveedor)}"></label>
          <label class="bal-field"><span>RUC</span><input id="ciRuc" inputmode="numeric" maxlength="11" value="${esc(borrador.ruc)}"></label>
          <label class="bal-field"><span>Comprobante</span><select id="ciTipo"><option${borrador.tipo === 'Factura' ? ' selected' : ''}>Factura</option><option${borrador.tipo === 'Boleta' ? ' selected' : ''}>Boleta</option></select></label>
          <label class="bal-field"><span>Fecha</span><input id="ciFecha" type="date" value="${esc(borrador.fecha)}"></label>
          <label class="bal-field"><span>Serie</span><input id="ciSerie" value="${esc(borrador.serie)}"></label>
          <label class="bal-field"><span>Número</span><input id="ciNum" value="${esc(borrador.numero)}"></label>
        </div>
        <h3 style="margin:14px 0 6px">Productos</h3>
        <p class="bal-hint">Elige a qué producto de tu Stock corresponde cada línea. Si no está en tu Stock, déjalo como «producto nuevo»: se creará con el código y la descripción de la factura. Las líneas sin elegir se descartan.${borrador.lineas.length ? '' : ' No se detectaron líneas: agrégalas a mano en el formulario.'}</p>
        <div class="bal-scroll"><table class="bal-table"><thead><tr><th>Leído</th><th>Producto</th><th>Cant.</th><th>Precio c/IGV</th><th></th></tr></thead><tbody id="ciLineas">${filas}</tbody></table></div>
      </div>
      <div class="ci-actions"><button type="button" class="btn" id="ciCancel">Cancelar</button><button type="button" class="btn btn-primary" id="ciOk">Aprobar y pasar al formulario</button></div>
    </div>`;
    document.body.appendChild(ov);
    const q = id => ov.querySelector('#' + id), cerrar = () => ov.remove();
    ov.onclick = e => { if (e.target === ov) cerrar(); };
    q('ciCancel').onclick = cerrar;
    q('ciLineas').onclick = e => { if (e.target.classList.contains('ci-del')) e.target.closest('tr').remove(); };
    q('ciOk').onclick = () => {
      const lineas = [...q('ciLineas').querySelectorAll('tr')].map(tr => ({ code: tr.querySelector('.ci-prod').value, qty: Number(tr.querySelector('.ci-qty').value), precio: Number(tr.querySelector('.ci-price').value), codigoNuevo: tr.dataset.cod, desc: tr.dataset.desc })).filter(l => l.code);
      alAprobar({ proveedor: q('ciProv').value.trim(), ruc: q('ciRuc').value.trim(), tipo: q('ciTipo').value, fecha: q('ciFecha').value, serie: q('ciSerie').value.trim(), numero: q('ciNum').value.trim(), lineas });
      cerrar();
    };
  }

  window.ComprasImport = { parseXml, parseTexto, leerArchivo, sugerirProducto, abrirPrevisualizacion };
})();
