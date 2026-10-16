import random, json, os, sys
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from PIL import Image, ImageDraw, ImageFont

W, H = A4
CLIENT = ('ADONAY MUSIC S.A.C.', '20616269659')
SUPPLIERS = ['UNION MUSICAL E.I.R.L.', 'MUSIC V&B PERU S.A.C.', 'HUAMAN MERCADOS MUSICALES S.A.C', 'CORPORACION ARTEMIS S.R.L.', 'DISTRIBUIDORA LOS ANDES S.A.',
 'INSTRUMENTOS Y SONIDO DEL PERU S.A.C.', 'COMERCIAL KARINA E.I.R.L.', 'MUNDO SONORO S.R.L.', 'GRUPO AUDIO PRO PERU SAC', 'LUTHIERS DEL SUR S.A.C.', 'CASA MUSICAL LIMA',
 'IMPORTADORA SANTA CECILIA S.A.C.', 'PERCUSION Y RITMO E.I.R.L.', 'ELECTRO SONIC IMPORT S.A.C.', 'TIENDAS ORFEO S.A.', 'ACUSTICA ANDINA S.R.L.', 'PIANOS Y TECLADOS DEL PERU S.A.C.']
PERSONAS = ['QUISPE MAMANI JUAN CARLOS', 'ARIAS MACHACA WILBER', 'FLORES HUAMAN MARIA ELENA', 'CONDORI CCAMA PEDRO']
PROD = ['CUERDAS PARA GUITARRA ELECTRICA 009-042', 'AFINADOR CLIP CROMATICO', 'PARCHE REMO 14" COATED BLANCO', 'ATRIL PARA MICROFONO DE GIRO RAPIDO CON BOOM 3 EN 1',
 'CABLE INSTRUMENTO 6M 1/4 RECTO', 'UKULELE SOPRANO 21" CAOBA', 'PLUMILLAS DUNLOP 0.73 X12', 'CAJON PERUANO FLAMENCO', 'TECLADO CASIO CT-S300 61 TECLAS', 'BAQUETAS 5A NOGAL',
 'PEDAL DE EFECTO DISTORSION', 'CAPODASTRO PARA GUITARRA ACUSTICA', 'CORREA PARA GUITARRA CUERO', 'SOPORTE PARA SMARTPHONE HERCULES', 'FUNDA ACOLCHADA PARA VIOLIN 4/4',
 'RESINA PARA VIOLIN', 'MICROFONO DINAMICO CABLEADO SM-58', 'PARLANTE ACTIVO 12" 500W', 'ESTUCHE GUITARRA CLASICA', 'ARMONICA DIATONICA DO', 'ECUALIZADOR LC-5', 'AFINADOR FLANGER']
def money(x, sep=','):
    s = f'{x:,.2f}'
    return s if sep == ',' else s.replace(',', 'X').replace('.', ',').replace('X', '.')
def ruc_gen(persona=False):
    base = ('10' if persona else '20') + ''.join(random.choice('0123456789') for _ in range(8))
    w = [5,4,3,2,7,6,5,4,3,2]; s = sum(int(base[i])*w[i] for i in range(10)); d = 11 - (s % 11)
    d = 0 if d == 10 else 1 if d == 11 else d
    return base + str(d)
def fecha_fmt(d, kind):
    y, m, dd = d
    meses = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','setiembre','octubre','noviembre','diciembre']
    return [f'{dd:02d}/{m:02d}/{y}', f'{y}-{m:02d}-{dd:02d}', f'{dd}/{m}/{y}', f'{dd:02d}-{m:02d}-{y}', f'{dd:02d} de {meses[m-1]} del {y}'][kind % 5]
def serie_num(boleta):
    pre = random.choice(['B001','BB01','EB01','BBB1','B002'] if boleta else ['F001','FT01','FFF1','E001','F002','FA01','F100'])
    n = random.choice([random.randint(1, 99), random.randint(100, 99999), random.randint(1000, 99999999)])
    ln = random.choice([None, 6, 8, 10])
    ns = str(n) if ln is None else str(n).zfill(ln)
    return pre, ns

def make_items(n, sin_igv_price=False):
    items = []
    for i in range(n):
        desc = random.choice(PROD)
        code = random.choice([None, ''.join(random.choice('ABCDEFGHJKLMNPRSTUVWXYZ') for _ in range(2)) + str(random.randint(100, 99999)), str(random.randint(1, 99999)).zfill(5), 'MS' + str(random.randint(100,999)) + 'B'])
        qty = random.choice([1, 1, 2, 3, 4, 6, 10, 12, 24, 50, 100])
        pc = round(random.choice([random.uniform(5, 60), random.uniform(60, 400), random.uniform(400, 2500)]), 2)
        items.append(dict(desc=desc, code=code, qty=qty, pc=pc))
    # evita descripciones repetidas
    seen = set(); out = []
    for it in items:
        if it['desc'] in seen: continue
        seen.add(it['desc']); out.append(it)
    return out

def txt(c, x, y, s, size=8, bold=False, right=False, center=False):
    c.setFont('Helvetica-Bold' if bold else 'Helvetica', size)
    (c.drawRightString if right else c.drawCentredString if center else c.drawString)(x, y, s)

def box(c, x, y, w, h): c.rect(x, y, w, h)

def logo_image(name, path):
    im = Image.new('RGB', (520, 150), 'white'); d = ImageDraw.Draw(im)
    try: f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 44); f2 = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 30)
    except Exception: f = f2 = ImageFont.load_default()
    d.text((10, 10), name.split()[0][:3].upper(), fill=(20, 60, 120), font=f)
    d.text((10, 90), name, fill=(40, 40, 40), font=f2)
    im.save(path)

def header_client(c, y, fecha, moneda, kind, cli_first=True, x=30):
    txt(c, x, y, f'Fecha Emisión : {fecha}', 8, True)
    txt(c, x, y-12, f'Señor(es) : {CLIENT[0]}', 8)
    txt(c, x, y-24, f'RUC : {CLIENT[1]}', 8)
    txt(c, x, y-36, 'Dirección : PJ. ENRIQUE MONTES NRO. 150 INT. 147 LIMA - LIMA - LIMA', 8)
    txt(c, 330, y, f'Moneda: {moneda}', 8)
    txt(c, 330, y-12, 'Condiciones: CONTADO CONTRA ENTREGA', 8)

def render(idx, tpl, truth_dir, out_dir):
    random.seed(idx * 7919 + tpl)
    persona = random.random() < 0.12
    supplier = random.choice(PERSONAS) if persona else random.choice(SUPPLIERS)
    ruc = ruc_gen(persona)
    boleta = tpl in (5, 14) and random.random() < 0.7
    pre, ns = serie_num(boleta)
    d = (2026, random.randint(1, 12), random.randint(1, 28)); fk = random.randint(0, 4)
    usd = random.random() < 0.15 and tpl != 13
    moneda = 'DÓLARES' if usd else 'SOLES'
    n = random.randint(1, 9) if tpl != 9 else random.randint(28, 40)
    items = make_items(n)
    path = f'{out_dir}/t{tpl:02d}_{idx:03d}.pdf'
    c = canvas.Canvas(path, pagesize=A4)
    tipo_txt = 'BOLETA DE VENTA ELECTRÓNICA' if boleta else 'FACTURA ELECTRÓNICA'
    exp_lines = []
    logo_only = tpl == 3
    total = round(sum(it['qty'] * it['pc'] for it in items), 2)

    def cabecera(y0=800, left=True):
        if logo_only:
            p = f'{out_dir}/logo_{idx}.png'; logo_image(supplier, p); c.drawImage(p, 30, y0-60, width=200, height=58)
        else:
            txt(c, 30 if left else W/2, y0-12, supplier, 14, True, center=not left)
            txt(c, 30 if left else W/2, y0-26, 'Av. Los Olivos 123 - Lima - Lima', 7, center=not left)
            txt(c, 30 if left else W/2, y0-36, 'Telf: (01) 555-1234  ventas@empresa.com', 7, center=not left)
        box(c, 380, y0-62, 185, 66)
        txt(c, 472, y0-18, f'RUC {ruc}' if tpl % 2 else f'R.U.C. {ruc}', 10, True, center=True)
        txt(c, 472, y0-34, tipo_txt, 9, True, center=True)
        sep = random.choice(['-', ' - ', ' N° '])
        txt(c, 472, y0-50, f'{pre}{sep}{ns}', 10, True, center=True)

    # ---- plantillas de tabla ----
    cols = None
    rows = []
    if tpl in (1, 5, 14):          # CANT | MODELO | DESCRIPCION | P.UNIT | P.TOTAL  (precios con IGV)
        cabecera(); header_client(c, 700, fecha_fmt(d, fk), moneda, 1)
        head = ['CANT.', 'MODELO', 'DESCRIPCION', 'P. UNIT.', 'P. TOTAL']; xs = [45, 70, 140, 480, 560]
        txt(c, 30, 650, head[0], 8, True); txt(c, 70, 650, head[1], 8, True); txt(c, 200, 650, head[2], 8, True); txt(c, 480, 650, head[3], 8, True, right=True); txt(c, 560, 650, head[4], 8, True, right=True)
        y = 636
        for it in items:
            txt(c, 45, y, str(it['qty']), 8, right=True); txt(c, 70, y, it['code'] or '', 8); txt(c, 140, y, it['desc'], 8)
            txt(c, 480, y, f"{it['pc']:.2f}", 8, right=True); txt(c, 560, y, f"{it['qty']*it['pc']:.2f}", 8, right=True)
            exp_lines.append(dict(codigo=it['code'] or '', desc=it['desc'], qty=it['qty'], precio=it['pc'])); y -= 13
        base = round(total / 1.18, 2)
        txt(c, 520, y-10, f'Valor de Venta  {base:.2f}', 8, True, right=True); txt(c, 520, y-22, f'IGV 18%  {total-base:.2f}', 8, True, right=True); txt(c, 520, y-34, f'Precio de Venta  {total:.2f}', 8, True, right=True)
        txt(c, 30, y-52, f'SON: {int(total)} Y {int(round((total-int(total))*100)):02d}/100 {"DOLARES AMERICANOS" if usd else "SOLES"}', 8, True)
    elif tpl == 2:                  # Nubefact: CANT | UM | CÓDIGO | DESCRIPCIÓN (2 filas) | P/U | IMPORTE
        txt(c, 30, 800, supplier, 12, True, center=False); txt(c, 30, 788, 'JR. ANGARAES 713, LIMA', 7); txt(c, 30, 778, 'LIMA - LIMA - LIMA', 7)
        box(c, 380, 745, 185, 62); txt(c, 472, 790, f'RUC: {ruc}', 11, True, center=True); txt(c, 472, 774, 'FACTURA', 11, True, center=True); txt(c, 472, 760, 'ELECTRÓNICA', 11, True, center=True); txt(c, 472, 748, f'{pre}-{ns}', 11, True, center=True)
        txt(c, 30, 720, 'DATOS DEL CLIENTE', 8, True); txt(c, 30, 708, 'RUC', 8, True); txt(c, 120, 708, CLIENT[1], 8); txt(c, 30, 696, 'DENOMINACIÓN', 8, True); txt(c, 120, 696, CLIENT[0], 8)
        txt(c, 330, 720, 'FECHA EMISIÓN:', 8, True); txt(c, 420, 720, fecha_fmt(d, fk), 8); txt(c, 330, 708, 'MONEDA', 8, True); txt(c, 420, 708, moneda, 8)
        for x, s in [(30, 'CANT'), (75, 'UM'), (110, 'CÓDIGO'), (190, 'DESCRIPCIÓN')]: txt(c, x, 670, s, 8, True)
        txt(c, 490, 670, 'P/U', 8, True, right=True); txt(c, 560, 670, 'IMPORTE', 8, True, right=True)
        y = 656
        for it in items:
            txt(c, 40, y, str(it['qty']), 8, right=True); txt(c, 75, y, 'NIU', 8); txt(c, 110, y, it['code'] or '', 8)
            words = it['desc'].split(); mid = len(words) // 2
            if len(it['desc']) > 28:
                txt(c, 190, y, ' '.join(words[:mid]), 8); txt(c, 190, y-10, ' '.join(words[mid:]), 8)
                txt(c, 490, y, f"{it['pc']:.2f}", 8, right=True); txt(c, 560, y, f"{it['qty']*it['pc']:.2f}", 8, right=True); y -= 24
            else:
                txt(c, 190, y, it['desc'], 8); txt(c, 490, y, f"{it['pc']:.2f}", 8, right=True); txt(c, 560, y, f"{it['qty']*it['pc']:.2f}", 8, right=True); y -= 13
            exp_lines.append(dict(codigo=it['code'] or '', desc=it['desc'], qty=it['qty'], precio=it['pc']))
        base = round(total / 1.18, 2)
        txt(c, 480, y-10, 'GRAVADA S/', 8, True); txt(c, 560, y-10, f'{base:.2f}', 8, True, right=True); txt(c, 480, y-22, 'IGV S/', 8, True); txt(c, 560, y-22, f'{total-base:.2f}', 8, True, right=True); txt(c, 480, y-34, 'TOTAL S/', 8, True); txt(c, 560, y-34, f'{total:.2f}', 8, True, right=True)
        txt(c, 30, y-52, 'IMPORTE EN LETRAS: SON SOLES.', 7); txt(c, 30, y-64, 'FORMA DE PAGO: [CONTADO]', 7)
    elif tpl == 3:                  # TAG: CODIGO | CANT | DESCRIPCIÓN | VALOR UNIT | DESCTS | VAL.UNI C/DESC | PRECIO TOTAL (logo = imagen)
        cabecera(); txt(c, 30, 700, f'RUC : {CLIENT[1]}', 8); txt(c, 30, 688, f'SEÑOR(ES) : {CLIENT[0]}', 8); txt(c, 30, 676, 'DIRECCIÓN : PJ. ENRIQUE MONTES NRO. 150 INT. 147', 8)
        txt(c, 400, 700, f'FECHA EMISION : {fecha_fmt(d, fk)}', 8); txt(c, 400, 688, f'MONEDA : {moneda}', 8); txt(c, 30, 664, 'FORMA PAGO : CREDITO 5 DIAS', 8)
        for x, s in [(30, 'CODIGO'), (135, 'CANT'), (165, 'DESCRIPCIÓN')]: txt(c, x, 640, s, 7, True)
        txt(c, 430, 640, 'VALOR UNIT', 7, True, right=True); txt(c, 455, 640, 'DESCTS', 7, True, center=True); txt(c, 515, 640, 'VAL.UNI.C/DESC', 7, True, right=True); txt(c, 585, 640, 'PRECIO TOTAL', 7, True, right=True)
        y = 626
        for it in items:
            vu = round(it['pc'] / 0.85, 2)
            txt(c, 30, y, it['code'] or '', 7); txt(c, 150, y, str(it['qty']), 7, right=True); txt(c, 165, y, it['desc'], 7)
            txt(c, 430, y, f'{vu:.2f}', 7, right=True); txt(c, 455, y, '10-6', 7, center=True); txt(c, 515, y, f"{it['pc']:.2f}", 7, right=True); txt(c, 585, y, f"{it['qty']*it['pc']:.2f}", 7, right=True)
            exp_lines.append(dict(codigo=it['code'] or '', desc=it['desc'], qty=it['qty'], precio=it['pc'])); y -= 13
        txt(c, 30, y-20, f'SON: TOTAL {total:.2f} DOLARES AMERICANOS' if usd else f'SON: TOTAL {total:.2f} SOLES', 8, True)
        txt(c, 30, y-40, 'BCP DOLARES: 1939862950165, BCP SOLES: 1939871357074', 7)
    elif tpl == 4:                  # Machaca: Cantidad | Unidad | Código | Descripción | Valor Unitario (sin IGV, sin total)
        txt(c, 30, 800, supplier, 12, True); txt(c, 30, 788, 'FACTURA ELECTRÓNICA', 9, True); txt(c, 30, 776, f'RUC:{ruc}', 9); txt(c, 30, 764, f'{pre} {ns}-', 9)
        txt(c, 30, 740, f'Fecha de Emisión  : {fecha_fmt(d, fk)}', 8); txt(c, 30, 728, 'Señor (es)  :', 8); txt(c, 100, 728, CLIENT[0], 8); txt(c, 30, 716, f'RUC  : {CLIENT[1]}', 8); txt(c, 330, 716, f'Tipo de Moneda  : {moneda}', 8)
        for x, s in [(30, 'Cantidad'), (80, 'Unidad Medida'), (150, 'Código'), (210, 'Descripción')]: txt(c, x, 690, s, 8, True)
        txt(c, 560, 690, 'Valor Unitario', 8, True, right=True)
        y = 676
        for it in items:
            vu = round(it['pc'] / 1.18, 2)
            txt(c, 30, y, f"{it['qty']:.2f}", 8); txt(c, 80, y, 'UNIDAD', 8); txt(c, 150, y, (it['code'] or str(random.randint(10000, 99999))), 8); txt(c, 210, y, it['desc'], 8); txt(c, 560, y, f'{vu:.2f}', 8, right=True)
            exp_lines.append(dict(codigo='', desc=it['desc'], qty=it['qty'], precio=round(vu * 1.18, 2), approx=True, vu=vu, qtyv=it['qty'])); y -= 13
        sub = round(sum(it['qty'] * round(it['pc'] / 1.18, 2) for it in items), 2); igv = round(sub * 0.18, 2)
        txt(c, 400, y-10, f'Sub Total Ventas :  {sub:.2f}', 8); txt(c, 400, y-22, 'Descuentos :  0.00', 8); txt(c, 400, y-34, f'Valor Venta :  {sub:.2f}', 8); txt(c, 400, y-46, f'IGV :  {igv:.2f}', 8); txt(c, 400, y-58, f'Importe Total :  {sub+igv:.2f}', 8)
        total = round(sub + igv, 2)
    elif tpl in (6, 10):            # Código | Descripción | Unidad | Cantidad | P.Unit(sin IGV) | V.Venta | IGV | Importe
        cabecera(left=False); header_client(c, 700, fecha_fmt(d, fk), moneda, 1)
        hs = [(30, 'Item'), (55, 'Código'), (115, 'Descripción'), (355, 'Unidad'), (385, 'Cantidad')]
        for x, s in hs: txt(c, x, 650, s, 7, True)
        for x, s in [(455, 'P.Unit'), (505, 'V.Venta'), (550, 'IGV'), (592, 'Importe')]: txt(c, x, 650, s, 7, True, right=True)
        y = 636
        for k, it in enumerate(items, 1):
            vu = round(it['pc'] / 1.18, 4); vv = round(vu * it['qty'], 2); imp = round(it['qty'] * it['pc'], 2)
            txt(c, 30, y, str(k), 8); txt(c, 55, y, it['code'] or '', 8); txt(c, 115, y, it['desc'], 8); txt(c, 355, y, 'UND', 8); txt(c, 405, y, str(it['qty']), 8, right=True)
            txt(c, 455, y, f'{vu:.2f}', 7, right=True); txt(c, 505, y, f'{vv:.2f}', 7, right=True); txt(c, 550, y, f'{imp-vv:.2f}', 7, right=True); txt(c, 592, y, f'{imp:.2f}', 7, right=True)
            exp_lines.append(dict(codigo=it['code'] or '', desc=it['desc'], qty=it['qty'], precio=it['pc'])); y -= 13
        txt(c, 585, y-14, f'TOTAL S/ {total:.2f}', 9, True, right=True)
    elif tpl == 7:                  # CANT | DESCRIPCIÓN | P.U. | DSCTO % | TOTAL
        cabecera(); header_client(c, 700, fecha_fmt(d, fk), moneda, 1)
        for x, s in [(30, 'CANT'), (80, 'DESCRIPCIÓN')]: txt(c, x, 650, s, 8, True)
        txt(c, 470, 650, 'P.U.', 8, True, right=True); txt(c, 510, 650, 'DSCTO %', 8, True, right=True); txt(c, 570, 650, 'TOTAL', 8, True, right=True)
        y = 636
        for it in items:
            dsc = random.choice([0, 5, 10]); pu = round(it['pc'] / (1 - dsc / 100), 2) if dsc else it['pc']
            tot = round(it['qty'] * it['pc'], 2)
            txt(c, 30, y, str(it['qty']), 8); txt(c, 80, y, it['desc'], 8); txt(c, 470, y, f'{pu:.2f}', 8, right=True); txt(c, 510, y, f'{dsc:.2f}', 8, right=True); txt(c, 570, y, f'{tot:.2f}', 8, right=True)
            exp_lines.append(dict(codigo='', desc=it['desc'], qty=it['qty'], precio=it['pc'], dsc=dsc)); y -= 13
        txt(c, 570, y-14, f'TOTAL: S/ {total:.2f}', 9, True, right=True)
    elif tpl == 8:                  # miles con coma / enteros grandes
        cabecera(); header_client(c, 700, fecha_fmt(d, fk), moneda, 1)
        for x, s in [(30, 'CANT.'), (80, 'CÓD.'), (140, 'DESCRIPCIÓN')]: txt(c, x, 650, s, 8, True)
        txt(c, 480, 650, 'PRECIO UNIT.', 8, True, right=True); txt(c, 570, 650, 'IMPORTE', 8, True, right=True)
        y = 636
        for it in items:
            it['pc'] = round(it['pc'] * random.choice([1, 3, 8]), 2); it['qty'] = random.choice([1, 5, 20, 1000, 1500])
            txt(c, 45, y, f"{it['qty']:,}", 8, right=True); txt(c, 80, y, it['code'] or '', 8); txt(c, 140, y, it['desc'], 8)
            txt(c, 480, y, money(it['pc']), 8, right=True); txt(c, 570, y, money(it['qty'] * it['pc']), 8, right=True)
            exp_lines.append(dict(codigo=it['code'] or '', desc=it['desc'], qty=it['qty'], precio=it['pc'])); y -= 13
        total = round(sum(it['qty'] * it['pc'] for it in items), 2)
        txt(c, 570, y-14, f'TOTAL S/ {money(total)}', 9, True, right=True)
    elif tpl == 9:                  # varias páginas
        def pagina_head(y0):
            cabecera(y0); header_client(c, y0-100, fecha_fmt(d, fk), moneda, 1) if y0 == 800 else None
        cabecera(); header_client(c, 700, fecha_fmt(d, fk), moneda, 1)
        y = 636; first = True
        def thead(y):
            txt(c, 30, y, 'CANT.', 8, True); txt(c, 70, y, 'CODIGO', 8, True); txt(c, 140, y, 'DESCRIPCION', 8, True); txt(c, 480, y, 'P. UNIT.', 8, True, right=True); txt(c, 570, y, 'P. TOTAL', 8, True, right=True)
        thead(650)
        for it in items:
            if y < 80:
                c.showPage(); thead(780); y = 764
            txt(c, 45, y, str(it['qty']), 8, right=True); txt(c, 70, y, it['code'] or '', 8); txt(c, 140, y, it['desc'], 8)
            txt(c, 480, y, f"{it['pc']:.2f}", 8, right=True); txt(c, 570, y, f"{it['qty']*it['pc']:.2f}", 8, right=True)
            exp_lines.append(dict(codigo=it['code'] or '', desc=it['desc'], qty=it['qty'], precio=it['pc'])); y -= 13
        txt(c, 570, y-14, f'TOTAL S/ {total:.2f}', 9, True, right=True)
    elif tpl == 11:                 # Razón social rotulada, sin caja de RUC, cliente primero
        txt(c, 30, 800, 'DATOS DEL CLIENTE', 8, True); txt(c, 30, 788, f'Señor(es): {CLIENT[0]}', 8); txt(c, 30, 776, f'RUC: {CLIENT[1]}', 8)
        txt(c, 330, 800, tipo_txt, 10, True); txt(c, 330, 786, f'{pre}-{ns}', 10, True); txt(c, 330, 772, f'Fecha de emisión: {fecha_fmt(d, fk)}', 8)
        txt(c, 30, 740, f'Razón Social: {supplier}', 9, True); txt(c, 30, 728, f'RUC: {ruc}', 9); txt(c, 30, 716, 'Moneda: ' + moneda, 8)
        for x, s in [(30, 'Cant'), (70, 'Descripción')]: txt(c, x, 690, s, 8, True)
        txt(c, 470, 690, 'P. Unitario', 8, True, right=True); txt(c, 570, 690, 'Importe', 8, True, right=True)
        y = 676
        for it in items:
            txt(c, 30, y, str(it['qty']), 8); txt(c, 70, y, (it['code'] + ' ' if it['code'] else '') + it['desc'], 8); txt(c, 470, y, f"{it['pc']:.2f}", 8, right=True); txt(c, 570, y, f"{it['qty']*it['pc']:.2f}", 8, right=True)
            exp_lines.append(dict(codigo='', desc=it['desc'], qty=it['qty'], precio=it['pc'], codeInDesc=it['code'] or '')); y -= 13
        txt(c, 570, y-14, f'TOTAL S/ {total:.2f}', 9, True, right=True)
        # en esta plantilla el nombre del cliente va ANTES que el del proveedor
    elif tpl == 12:                 # moneda USD con US$ en precios
        usd = True; moneda = 'USD'
        cabecera(); header_client(c, 700, fecha_fmt(d, fk), 'USD', 1)
        for x, s in [(30, 'QTY'), (70, 'CODE'), (140, 'DESCRIPTION')]: txt(c, x, 650, s, 8, True)
        txt(c, 470, 650, 'UNIT PRICE', 8, True, right=True); txt(c, 570, 650, 'AMOUNT', 8, True, right=True)
        y = 636
        for it in items:
            txt(c, 30, y, str(it['qty']), 8); txt(c, 70, y, it['code'] or '', 8); txt(c, 140, y, it['desc'], 8); txt(c, 470, y, f"US$ {it['pc']:.2f}", 8, right=True); txt(c, 570, y, f"US$ {it['qty']*it['pc']:.2f}", 8, right=True)
            exp_lines.append(dict(codigo=it['code'] or '', desc=it['desc'], qty=it['qty'], precio=it['pc'])); y -= 13
        txt(c, 570, y-14, f'TOTAL US$ {total:.2f}', 9, True, right=True)
    elif tpl == 13:                 # ticket angosto: "2 x DESCRIPCION  precio  total"
        txt(c, 160, 800, supplier, 10, True, center=True); txt(c, 160, 788, f'RUC {ruc}', 8, center=True); txt(c, 160, 776, tipo_txt, 8, True, center=True); txt(c, 160, 764, f'{pre}-{ns}', 8, True, center=True)
        txt(c, 30, 746, f'FECHA: {fecha_fmt(d, fk)}', 7); txt(c, 30, 736, f'CLIENTE: {CLIENT[0]}', 7); txt(c, 30, 726, f'RUC: {CLIENT[1]}', 7)
        txt(c, 30, 710, 'CANT  DESCRIPCION', 7, True); txt(c, 240, 710, 'P.UNIT', 7, True, right=True); txt(c, 290, 710, 'IMPORTE', 7, True, right=True)
        y = 698
        for it in items:
            txt(c, 30, y, str(it['qty']), 7); txt(c, 50, y, it['desc'][:34], 7); txt(c, 240, y, f"{it['pc']:.2f}", 7, right=True); txt(c, 290, y, f"{it['qty']*it['pc']:.2f}", 7, right=True)
            exp_lines.append(dict(codigo='', desc=it['desc'][:34], qty=it['qty'], precio=it['pc'])); y -= 11
        txt(c, 290, y-12, f'TOTAL S/ {total:.2f}', 8, True, right=True)
    c.save()
    for f in os.listdir(out_dir):
        if f.startswith('logo_'): os.remove(f'{out_dir}/{f}')
    fecha_iso = f'{d[0]}-{d[1]:02d}-{d[2]:02d}'
    return os.path.basename(path), dict(proveedor='' if logo_only else supplier, logo=supplier if logo_only else '', ruc=ruc, serie=pre, numero=ns, fecha=fecha_iso, tipo='Boleta' if boleta else 'Factura',
        moneda='USD' if usd else 'PEN', lineas=exp_lines, tpl=tpl)

if __name__ == '__main__':
    out = sys.argv[1]; os.makedirs(out, exist_ok=True)
    per = int(sys.argv[2]); truth = {}
    for tpl in range(1, 15):
        for i in range(per):
            try:
                name, t = render(i, tpl, out, out); truth[name] = t
            except Exception as e:
                print('ERR', tpl, i, e)
    json.dump(truth, open(f'{out}/truth.json', 'w'), ensure_ascii=False)
    print(len(truth), 'pdfs')
