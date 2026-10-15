/* ══════════════════════════════════════
   dashboard-logic.js — Resumen general
   ══════════════════════════════════════ */

window.Dashboard = (function () {

  let dashPeriodDays = 30; // 7 | 30 | 90 — cambia con los pills del topbar
  let salesChart = null;
  let topProductsChart = null;
  let vendorChart = null;
  let warehouseChart = null;
  let lastProducts = []; // para volver a pintar el gráfico de almacenes sin refetch cuando cambia solo el período

  function renderStockStats(products) {
    lastProducts = products;
    const total = products.length;
    const low = products.filter(p => Number(p.stock) <= (p.stockMin != null ? Number(p.stockMin) : 5)).length;
    const value = products.reduce((sum, p) => sum + (Number(p.stock) || 0) * (Number(p.price) || 0), 0);

    const elValue = document.getElementById('dashStockValue');
    const elTotal = document.getElementById('dashProductCount');
    const elLow = document.getElementById('dashLowStock');
    if (!elValue) return; // la vista ya no está montada (se navegó a otra pantalla)

    elValue.textContent = `S/ ${value.toLocaleString('es-PE', { maximumFractionDigits: 0 })}`;
    elTotal.textContent = total.toLocaleString('es-PE');
    elLow.textContent = low.toLocaleString('es-PE');

    const list = document.getElementById('dashLowStockList');
    if (list) {
      const lowItems = products
        .filter(p => Number(p.stock) <= (p.stockMin != null ? Number(p.stockMin) : 5))
        .sort((a, b) => (Number(a.stock) || 0) - (Number(b.stock) || 0))
        .slice(0, 6);

      list.innerHTML = lowItems.length === 0
        ? '<p class="dash-empty">No hay productos con stock bajo.</p>'
        : lowItems.map(p => `
            <div class="dash-row">
              <div class="dash-row-main">
                <div class="dash-row-title">${escapeHtml(p.name || p.code || '')}</div>
                <div class="dash-row-meta">${escapeHtml(displayProductCode ? displayProductCode(p.code || '') : (p.code || ''))}</div>
              </div>
              <div class="dash-row-value low">${Number(p.stock) || 0} u.</div>
            </div>
          `).join('');
    }

    renderWarehouseChart(products);
  }

  function renderClientStats(clients) {
    const elClients = document.getElementById('dashClientCount');
    if (elClients) elClients.textContent = clients.length.toLocaleString('es-PE');
  }

  function renderRecentOrders(orders) {
    const list = document.getElementById('dashRecentOrders');
    if (!list) return;

    const sorted = orders.slice().sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    const recent = sorted.slice(0, 6);

    if (recent.length === 0) {
      list.innerHTML = '<p class="dash-empty">Todavía no hay notas de pedido registradas.</p>';
      return;
    }
    list.innerHTML = recent.map(o => {
      const fecha = o.timestamp ? new Date(o.timestamp).toLocaleDateString('es-PE', { day: '2-digit', month: 'short' }) : (o.fecha || '');
      const cliente = o.cliente || o.ruc || 'Cliente sin nombre';
      return `
        <div class="dash-row">
          <div class="dash-row-main">
            <div class="dash-row-title">${escapeHtml(String(o.numero || o.id || ''))} — ${escapeHtml(cliente)}</div>
            <div class="dash-row-meta">${fecha}</div>
          </div>
          <div class="dash-row-value">S/ ${fmtPrice(Number(o.total) || 0)}</div>
        </div>
      `;
    }).join('');
  }

  // Lee un color ya calculado del tema actual (claro u oscuro) para
  // que los gráficos combinen con el resto de la pantalla en vez de
  // traer sus propios colores fijos.
  function cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function destroyCharts() {
    [salesChart, topProductsChart, vendorChart, warehouseChart].forEach(c => c && c.destroy());
    salesChart = topProductsChart = vendorChart = warehouseChart = null;
  }

  // ── Comparación contra el período anterior de igual duración ────
  // El "hack" clásico de cualquier dashboard de ventas: no basta con
  // mostrar el número del período, ayuda mucho más saber si va para
  // arriba o para abajo contra el tramo comparable inmediatamente
  // anterior (ej. estos 30 días vs los 30 días de antes).
  function pctDelta(current, previous) {
    if (!previous) return null; // sin base de comparación (período anterior en cero) — no se puede calcular %
    return ((current - previous) / previous) * 100;
  }

  function renderDeltaBadge(elId, delta) {
    const el = document.getElementById(elId);
    if (!el) return;
    if (delta === null || !isFinite(delta)) { el.innerHTML = ''; return; }
    const flat = Math.abs(delta) < 0.5;
    const cls = flat ? 'flat' : (delta > 0 ? 'up' : 'down');
    const arrow = flat ? '·' : (delta > 0 ? '▲' : '▼');
    el.innerHTML = `<span class="dash-stat-delta ${cls}">${arrow} ${Math.abs(delta).toFixed(0)}% vs. anterior</span>`;
  }

  function renderSalesWindowStats(current, previous) {
    const sumCur = current.reduce((s, o) => s + (Number(o.total) || 0), 0);
    const sumPrev = previous.reduce((s, o) => s + (Number(o.total) || 0), 0);
    const avgCur = current.length ? sumCur / current.length : 0;
    const avgPrev = previous.length ? sumPrev / previous.length : 0;

    const elTotal = document.getElementById('dashSalesTotal');
    const elAvg = document.getElementById('dashAvgTicket');
    if (elTotal) elTotal.textContent = `S/ ${sumCur.toLocaleString('es-PE', { maximumFractionDigits: 0 })}`;
    if (elAvg) elAvg.textContent = `S/ ${avgCur.toLocaleString('es-PE', { maximumFractionDigits: 0 })}`;

    renderDeltaBadge('dashSalesDelta', pctDelta(sumCur, sumPrev));
    renderDeltaBadge('dashAvgDelta', pctDelta(avgCur, avgPrev));
  }

  // ── Gráfico 1: ventas por día (7/30) o por semana (90) ───────────
  function renderSalesChart(orders, days) {
    const canvas = document.getElementById('dashSalesChart');
    const emptyMsg = document.getElementById('dashSalesChartEmpty');
    const title = document.getElementById('dashSalesChartTitle');
    if (!canvas || typeof Chart === 'undefined') return;

    const now = new Date();
    let labels, totals;

    if (days <= 30) {
      if (title) title.textContent = 'Ventas por día';
      const buckets = [];
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now); d.setDate(d.getDate() - i); d.setHours(0, 0, 0, 0);
        buckets.push(d.getTime());
      }
      labels = buckets.map(t => new Date(t).toLocaleDateString('es-PE', { day: '2-digit', month: 'short' }));
      totals = buckets.map(start => {
        const end = start + 24 * 60 * 60 * 1000;
        return orders.filter(o => (o.timestamp || 0) >= start && (o.timestamp || 0) < end)
          .reduce((s, o) => s + (Number(o.total) || 0), 0);
      });
    } else {
      // 90 días: agrupado por semana (13 barras) — a diario se vuelve ilegible.
      if (title) title.textContent = 'Ventas por semana';
      const weeks = Math.ceil(days / 7);
      const buckets = [];
      for (let i = weeks - 1; i >= 0; i--) {
        const d = new Date(now); d.setDate(d.getDate() - i * 7 - 6); d.setHours(0, 0, 0, 0);
        buckets.push(d.getTime());
      }
      labels = buckets.map(t => 'Sem. ' + new Date(t).toLocaleDateString('es-PE', { day: '2-digit', month: 'short' }));
      totals = buckets.map(start => {
        const end = start + 7 * 24 * 60 * 60 * 1000;
        return orders.filter(o => (o.timestamp || 0) >= start && (o.timestamp || 0) < end)
          .reduce((s, o) => s + (Number(o.total) || 0), 0);
      });
    }

    const hasSales = totals.some(v => v > 0);
    canvas.style.display = hasSales ? '' : 'none';
    if (emptyMsg) emptyMsg.style.display = hasSales ? 'none' : '';
    if (salesChart) { salesChart.destroy(); salesChart = null; }
    if (!hasSales) return;

    const accent = cssVar('--accent') || '#0F6E5C';
    const gridColor = cssVar('--border') || '#E4E7EC';
    const textColor = cssVar('--text-3') || '#6B7280';

    salesChart = new Chart(canvas, {
      type: 'bar',
      data: { labels, datasets: [{ label: 'Ventas', data: totals, backgroundColor: accent, borderRadius: 4, maxBarThickness: 28 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => 'S/ ' + Number(ctx.parsed.y || 0).toLocaleString('es-PE', { maximumFractionDigits: 0 }) } }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: textColor, font: { size: 10.5 }, maxRotation: 0, autoSkip: true } },
          y: { beginAtZero: true, grid: { color: gridColor }, ticks: { color: textColor, font: { size: 10.5 }, callback: (v) => 'S/ ' + v.toLocaleString('es-PE') } }
        }
      }
    });
  }

  // ── Gráfico 2: top 5 productos más vendidos (por cantidad) ──────
  function renderTopProductsChart(orders) {
    const canvas = document.getElementById('dashTopProductsChart');
    const emptyMsg = document.getElementById('dashTopProductsChartEmpty');
    if (!canvas || typeof Chart === 'undefined') return;

    const qtyByProduct = {};
    orders.forEach(o => {
      (o.items || []).forEach(it => {
        const key = it.code || it.name || '—';
        if (!qtyByProduct[key]) qtyByProduct[key] = { name: it.name || key, qty: 0 };
        qtyByProduct[key].qty += Number(it.qty) || 0;
      });
    });
    const top = Object.values(qtyByProduct).sort((a, b) => b.qty - a.qty).slice(0, 5);

    canvas.style.display = top.length ? '' : 'none';
    if (emptyMsg) emptyMsg.style.display = top.length ? 'none' : '';
    if (topProductsChart) { topProductsChart.destroy(); topProductsChart = null; }
    if (!top.length) return;

    const copper = cssVar('--copper') || '#C46A32';
    const gridColor = cssVar('--border') || '#E4E7EC';
    const textColor = cssVar('--text-3') || '#6B7280';
    const textStrong = cssVar('--text-1') || '#1C1A17';

    topProductsChart = new Chart(canvas, {
      type: 'bar',
      data: { labels: top.map(p => p.name), datasets: [{ label: 'Unidades vendidas', data: top.map(p => p.qty), backgroundColor: copper, borderRadius: 4, maxBarThickness: 22 }] },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => Number(ctx.parsed.x || 0).toLocaleString('es-PE') + ' u.' } }
        },
        scales: {
          x: { beginAtZero: true, grid: { color: gridColor }, ticks: { color: textColor, font: { size: 10.5 } } },
          y: { grid: { display: false }, ticks: { color: textStrong, font: { size: 11.5, weight: '600' } } }
        }
      }
    });
  }

  // ── Gráfico 3 (solo admin): ranking de vendedores por monto ─────
  function renderVendorChart(orders) {
    const canvas = document.getElementById('dashVendorChart');
    const emptyMsg = document.getElementById('dashVendorChartEmpty');
    if (!canvas || typeof Chart === 'undefined' || !isAdmin()) return;

    const byVendor = {};
    orders.forEach(o => {
      const nombre = (o.creadoPor && o.creadoPor.nombre) || 'Sin asignar';
      byVendor[nombre] = (byVendor[nombre] || 0) + (Number(o.total) || 0);
    });
    const top = Object.entries(byVendor)
      .map(([nombre, total]) => ({ nombre, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 6);

    canvas.style.display = top.length ? '' : 'none';
    if (emptyMsg) emptyMsg.style.display = top.length ? 'none' : '';
    if (vendorChart) { vendorChart.destroy(); vendorChart = null; }
    if (!top.length) return;

    const ink = cssVar('--ink') || '#1C1A17';
    const gridColor = cssVar('--border') || '#E4E7EC';
    const textColor = cssVar('--text-3') || '#6B7280';
    const textStrong = cssVar('--text-1') || '#1C1A17';

    vendorChart = new Chart(canvas, {
      type: 'bar',
      data: { labels: top.map(v => v.nombre), datasets: [{ label: 'Vendido', data: top.map(v => v.total), backgroundColor: ink, borderRadius: 4, maxBarThickness: 22 }] },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => 'S/ ' + Number(ctx.parsed.x || 0).toLocaleString('es-PE', { maximumFractionDigits: 0 }) } }
        },
        scales: {
          x: { beginAtZero: true, grid: { color: gridColor }, ticks: { color: textColor, font: { size: 10.5 }, callback: (v) => 'S/ ' + v.toLocaleString('es-PE') } },
          y: { grid: { display: false }, ticks: { color: textStrong, font: { size: 11.5, weight: '600' } } }
        }
      }
    });
  }

  // ── Gráfico 4: valor de inventario por almacén (dona) ───────────
  function renderWarehouseChart(products) {
    const canvas = document.getElementById('dashWarehouseChart');
    const emptyMsg = document.getElementById('dashWarehouseChartEmpty');
    if (!canvas || typeof Chart === 'undefined') return;

    const labelsMap = (typeof WAREHOUSE_LABELS !== 'undefined') ? WAREHOUSE_LABELS : { alm1: 'Almacén 1', alm2: 'Almacén 2', alm3: 'Almacén 3' };
    const ids = Object.keys(labelsMap);
    const totals = ids.map(id => products.reduce((s, p) => s + ((p.almacenes && Number(p.almacenes[id])) || 0) * (Number(p.price) || 0), 0));

    const hasValue = totals.some(v => v > 0);
    canvas.style.display = hasValue ? '' : 'none';
    if (emptyMsg) emptyMsg.style.display = hasValue ? 'none' : '';
    if (warehouseChart) { warehouseChart.destroy(); warehouseChart = null; }
    if (!hasValue) return;

    const palette = [cssVar('--accent') || '#0F6E5C', cssVar('--copper') || '#C46A32', cssVar('--ink') || '#1C1A17'];
    const surface = cssVar('--surface') || '#fff';
    const textStrong = cssVar('--text-1') || '#1C1A17';

    warehouseChart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: ids.map(id => labelsMap[id]),
        datasets: [{ data: totals, backgroundColor: palette, borderColor: surface, borderWidth: 2 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { color: textStrong, font: { size: 11.5 }, boxWidth: 11, padding: 14 } },
          tooltip: { callbacks: { label: (ctx) => `${ctx.label}: S/ ${Number(ctx.parsed || 0).toLocaleString('es-PE', { maximumFractionDigits: 0 })}` } }
        }
      }
    });
  }

  function loadSalesWindow() {
    if (typeof fetchOrdersPage !== 'function') return;
    const now = Date.now();
    const spanMs = dashPeriodDays * 24 * 60 * 60 * 1000;
    const curStart = now - spanMs;
    const prevStart = curStart - spanMs;

    const label = document.getElementById('dashSalesLabel');
    const topSub = document.getElementById('dashTopProductsSub');
    if (label) label.textContent = `Ventas — ${dashPeriodDays} días`;
    if (topSub) topSub.textContent = `últimos ${dashPeriodDays} días`;

    Promise.all([
      fetchOrdersPage(curStart, now),
      fetchOrdersPage(prevStart, curStart - 1)
    ]).then(([current, previous]) => {
      current = current || []; previous = previous || [];
      renderSalesWindowStats(current, previous);
      renderSalesChart(current, dashPeriodDays);
      renderTopProductsChart(current);
      renderVendorChart(current);
    }).catch(() => {});
  }

  function setDashPeriod(days) {
    dashPeriodDays = days;
    document.querySelectorAll('#dashPeriodGroup .dash-period-pill').forEach(btn => {
      btn.classList.toggle('active', Number(btn.dataset.days) === days);
    });
    loadSalesWindow();
  }
  window.setDashPeriod = setDashPeriod;

  function init() {
    // Productos y clientes: reutiliza los mismos listeners en tiempo
    // real que usan Stock y Registros/Nueva Nota (watchProducts /
    // watchClients ya cachean internamente, así que llamarlos de
    // nuevo acá no duplica lecturas).
    watchProducts(products => renderStockStats(products || []));
    watchClients(clients => renderClientStats(clients || []));

    // Últimas notas (lista corta): una lectura puntual, misma página
    // que usa Historial para su primera carga.
    fetchOrdersFirstPage()
      .then(orders => renderRecentOrders(orders || []))
      .catch(() => {
        const list = document.getElementById('dashRecentOrders');
        if (list) list.innerHTML = '<p class="dash-empty">No se pudieron cargar las notas recientes.</p>';
      });

    destroyCharts();
    document.querySelectorAll('#dashPeriodGroup .dash-period-pill').forEach(btn => {
      btn.classList.toggle('active', Number(btn.dataset.days) === dashPeriodDays);
    });
    loadSalesWindow();
  }

  return { init };
})();
