// Arnés visual de BALANCE-INV (herramienta de desarrollo; NO entra en `npm test`).
//   node tests/visual/run.js [--out DIR] [--sizes 360x740,412x915] [--only dashboard,stock] [--modals]
// Sirve www/ en local, falsea Firebase con tests/helpers/fake-firebase.js, captura cada vista y mide.
const fs = require('fs'), path = require('path');
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { start } = require('./server');
const { buildSeed } = require('./seed');

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const OUT = opt('out', '/tmp/claude-0/-home-claude/0b5684fd-b31c-5f39-b886-c1948f5be3f0/scratchpad/shots');
const SIZES = opt('sizes', '360x740,412x915,768x1024,1280x800').split(',').map(s => s.split('x').map(Number));
const ONLY = opt('only', '') ? opt('only', '').split(',') : null;
const PROBE = opt('probe', '');   // expresión JS a evaluar en cada página (depuración)
const WITH_MODALS = args.includes('--modals');
const VIEWS = ['dashboard', 'nueva-nota', 'pedidos', 'stock', 'historial', 'compras', 'movimientos', 'catalogo', 'configuracion', 'registros', 'soporte', 'perfil'];

function stubJs(seed, logged) {
  let fake = fs.readFileSync(path.join(__dirname, '..', 'helpers', 'fake-firebase.js'), 'utf8');
  // El fake de las pruebas no implementa endAt(); se agrega aquí (solo para el arnés, sin tocar el helper).
  fake = fake.replace('endBefore(v) {', 'endAt(v) { return makeQuery(parts, field, startAtVal, v + 1, limitToLastN); },\n      endBefore(v) {');
  return `(function(){var module={exports:{}};${fake}
var fb=module.exports.createFakeFirebase();Object.assign(fb._store,${JSON.stringify(seed)});
var user=${logged ? `{uid:'u-admin',email:'admin@demo.pe'}` : 'null'};
var auth={currentUser:user,onAuthStateChanged:function(cb){setTimeout(function(){cb(user)},0);return function(){}},signOut:function(){return Promise.resolve()},
 setPersistence:function(){return Promise.resolve()},signInWithEmailAndPassword:function(){return Promise.reject(Object.assign(new Error('x'),{code:'auth/invalid-credential'}))},
 sendPasswordResetEmail:function(){return Promise.resolve()},updatePassword:function(){return Promise.resolve()}};
var f=function(){return auth};f.Auth={Persistence:{LOCAL:'local',SESSION:'session'}};fb.auth=f;window.firebase=fb;})();`;
}

// Medición ejecutada dentro de la página.
function measure(touch) {
  const vw = window.innerWidth;
  const vis = el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity !== 0; };
  const sel = el => { let s = el.tagName.toLowerCase(); if (el.id) s += '#' + el.id; else if (el.className && typeof el.className === 'string') s += '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.'); return s; };
  const inHiddenOverlay = el => { const o = el.closest('.modal-overlay'); return o && !o.classList.contains('open'); };
  const inScroller = el => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const ox = getComputedStyle(p).overflowX; if ((ox === 'auto' || ox === 'scroll') && !p.matches('.page-content,main,.main') && p.getBoundingClientRect().right <= vw + 1) return true; } return false; };
  const all = [...document.querySelectorAll('body *')].filter(el => vis(el) && !inHiddenOverlay(el) && !el.closest('script,style,svg'));
  const res = { vw, scrollW: document.documentElement.scrollWidth, bodyW: document.body.scrollWidth };
  const conts = [...document.querySelectorAll('.app,#viewRoot,main.main,.page-content,.main')].filter(vis);
  res.contOverflow = conts.filter(c => c.scrollWidth > c.clientWidth + 1).map(sel);
  res.offenders = all.filter(el => { const r = el.getBoundingClientRect(); return (r.right > vw + 1 || r.left < -1) && !inScroller(el) && getComputedStyle(el).position !== 'fixed' && !el.closest('.sidebar,.bg-carousel'); }).slice(0, 6).map(el => sel(el) + ' r=' + Math.round(el.getBoundingClientRect().right));
  res.hOverflow = res.scrollW > vw || res.bodyW > vw || res.contOverflow.length > 0 || res.offenders.length > 0;
  res.clipped = all.filter(el => el.scrollWidth > el.clientWidth + 2 && ['hidden', 'clip'].includes(getComputedStyle(el).overflowX) && getComputedStyle(el).textOverflow !== 'ellipsis' && el.clientWidth > 0 && el.children.length === 0 && el.textContent.trim()).slice(0, 6).map(sel);
  const tapSel = 'button,a.btn,a[href],input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]),select,textarea,[role=button],.btn,.nav-item,.chip,.tab';
  res.smallTap = touch ? all.filter(el => el.matches(tapSel) && el.getBoundingClientRect().height < 43.5 && !el.closest('.sidebar') ).slice(0, 40).map(el => sel(el) + ' h=' + Math.round(el.getBoundingClientRect().height)) : [];
  res.smallTapCount = touch ? all.filter(el => el.matches(tapSel) && el.getBoundingClientRect().height < 43.5 && !el.closest('.sidebar')).length : 0;
  res.smallText = all.filter(el => { const t = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()); return t && parseFloat(getComputedStyle(el).fontSize) < 14; }).map(el => sel(el) + ' ' + getComputedStyle(el).fontSize);
  res.smallTextCount = res.smallText.length; res.smallText = [...new Set(res.smallText)].slice(0, 60);
  res.wideTables = [...document.querySelectorAll('table')].filter(t => vis(t) && !inHiddenOverlay(t)).filter(t => { const w = t.getBoundingClientRect().width; let p = t.parentElement; while (p && p !== document.body && getComputedStyle(p).overflowX === 'visible') p = p.parentElement; return (p && p !== document.body && p.scrollWidth > p.clientWidth + 2) || w > vw; }).map(sel);
  return res;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const seed = buildSeed();
  const srv = await start(0, { '/catalogo.json': JSON.stringify(seed.catalogoPublico) });
  const base = 'http://127.0.0.1:' + srv.address().port;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] }).catch(() => chromium.launch({ args: ['--no-sandbox'] }));
  const report = [];
  const targets = [...VIEWS.map(v => ({ name: v, url: '/index.html#' + v, logged: true })), { name: 'login', url: '/login.html', logged: false }, { name: 'catalogo-publico', url: '/catalogo-publico.html', logged: false }]
    .filter(t => !ONLY || ONLY.includes(t.name));
  for (const [w, h] of SIZES) {
    const touch = w <= 768;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: w <= 480, deviceScaleFactor: 1, locale: 'es-PE' });
    for (const t of targets) {
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(m.text().slice(0, 300)); });
      await page.route('**/*', route => {
        const u = route.request().url();
        if (u.startsWith(base)) return route.continue();
        if (/firebase-app-compat/.test(u)) return route.fulfill({ contentType: 'text/javascript', body: stubJs(seed, t.logged) });
        if (/firebasejs/.test(u)) return route.fulfill({ contentType: 'text/javascript', body: '' });
        if (/chart\.js|chart\.umd/.test(u)) return route.fulfill({ contentType: 'text/javascript', body: 'window.Chart=function(){this.destroy=function(){};this.update=function(){}};' });
        if (/img\.test/.test(u)) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#cbd5e1"/></svg>' });
        if (/fonts\.googleapis/.test(u)) return route.fulfill({ contentType: 'text/css', body: '' });
        return route.abort();
      });
      await page.addInitScript(() => { try { localStorage.setItem('balanceinv_pref_tema', 'claro'); } catch (e) {} });
      await page.goto(base + t.url, { waitUntil: 'load' });
      await page.waitForTimeout(t.logged ? 1500 : 800);
      const shot = async (name) => {
        const full = await page.evaluate(() => { const c = [document.querySelector('.page-content'), document.querySelector('main.main'), document.scrollingElement].filter(Boolean); const sc = c.map(e => e.scrollHeight - e.clientHeight); const extra = Math.max(0, ...sc); return innerHeight + extra; });
        const hh = Math.min(full, 5000);
        if (hh > h) { await page.setViewportSize({ width: w, height: hh }); await page.waitForTimeout(250); }
        await page.screenshot({ path: path.join(OUT, `${name}-${w}.png`), fullPage: true });
        if (hh > h) await page.setViewportSize({ width: w, height: h });
      };
      const m = await page.evaluate(measure, touch); m.view = t.name; m.size = `${w}x${h}`; m.errors = errors.slice(0, 3);
      if (PROBE) console.log('PROBE', w, t.name, JSON.stringify(await page.evaluate(PROBE)));
      await shot(t.name); report.push(m);
      if (WITH_MODALS && t.logged) {
        const ids = await page.evaluate(() => [...document.querySelectorAll('#viewRoot .modal-overlay[id]')].map(e => e.id));
        for (const id of ids) {
          await page.evaluate(i => document.getElementById(i).classList.add('open'), id); await page.waitForTimeout(350);
          const mm = await page.evaluate(({ i, touch }) => {
            const o = document.getElementById(i), md = o.querySelector('.modal') || o.firstElementChild, r = md.getBoundingClientRect();
            const btns = [...o.querySelectorAll('.modal-footer .btn, .modal-footer button')].filter(b => b.getBoundingClientRect().height > 0);
            const fb = btns.length ? Math.max(...btns.map(b => b.getBoundingClientRect().bottom)) : 0;
            return { modalW: Math.round(r.width), modalH: Math.round(r.height), bottom: Math.round(r.bottom), top: Math.round(r.top), vh: innerHeight, footerBtnBottom: Math.round(fb), footerVisible: !btns.length || fb <= innerHeight + 1, minBtnH: btns.length ? Math.min(...btns.map(b => Math.round(b.getBoundingClientRect().height))) : null, hOverflow: document.documentElement.scrollWidth > innerWidth, modalOverflowX: md.scrollWidth > md.clientWidth + 2 };
          }, { i: id, touch });
          await page.screenshot({ path: path.join(OUT, `${t.name}__${id}-${w}.png`) });
          report.push({ view: `${t.name}:${id}`, size: `${w}x${h}`, ...mm });
          await page.evaluate(i => document.getElementById(i).classList.remove('open'), id);
        }
      }
      await page.close();
    }
    await ctx.close();
  }
  await browser.close(); srv.close();
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  const pad = (s, n) => String(s).padEnd(n);
  for (const r of report) {
    if (r.modalW !== undefined) { console.log(pad(r.size, 9), pad(r.view, 34), `modal ${r.modalW}x${r.modalH} top=${r.top} bottom=${r.bottom}/${r.vh} footerVisible=${r.footerVisible} minBtnH=${r.minBtnH} hOv=${r.hOverflow} mOvX=${r.modalOverflowX}`); continue; }
    console.log(pad(r.size, 9), pad(r.view, 18), 'HOVERFLOW=' + (r.hOverflow ? 'SI(' + r.scrollW + ',cont=' + r.contOverflow.length + ',off=' + r.offenders.length + ')' : 'no'), `tap<44:${r.smallTapCount} txt<14:${r.smallTextCount} tablas:${r.wideTables.length} cortados:${r.clipped.length}`, r.errors.length ? 'ERR ' + r.errors[0] : '');
  }
  const bad = report.filter(r => r.hOverflow && r.modalW === undefined && r.size.startsWith('360'));
  console.log('\nVistas con desbordamiento a 360px:', bad.length, bad.map(r => r.view).join(', '));
})();
