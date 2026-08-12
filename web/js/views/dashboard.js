/** KORT - Panel principal: cómo viene el mes de un vistazo. */

import { h, vaciar, money, num, pct, fecha, badge, ESTADOS_PRESUPUESTO } from '../ui.js';
import { api, estado as G, simbolo } from '../api.js';
import { calcularEstructura, calcularCostoHoraMaquina, puntoEquilibrio } from '/src/core/costos.js';

let Chart = null;
const graficos = [];

async function cargarChart() {
  if (Chart) return Chart;
  await import('/lib/chart.umd.js');
  Chart = window.Chart;
  Chart.defaults.font.family = '"Segoe UI", system-ui, sans-serif';
  Chart.defaults.font.size = 11;
  return Chart;
}

const PALETA = ['#e4572e', '#1b3a5c', '#1f7a4d', '#b7791f', '#1b6fc2', '#8e44ad', '#16a085', '#c0392b'];

function colores() {
  const oscuro = document.body.classList.contains('oscuro');
  return {
    texto: oscuro ? '#9aa8b8' : '#5b6672',
    grilla: oscuro ? '#2a3543' : '#e3e9ef',
  };
}

export async function render(cont) {
  const [st, estructuraApi] = await Promise.all([api.get('estadisticas'), api.get('estructura').catch(() => null)]);
  const sim = simbolo();
  const est = estructuraApi || calcularEstructura(G.config.estructura);
  const eq = est.equilibrio || puntoEquilibrio(est, G.config.comercial?.margen ?? 45);
  await cargarChart();

  const kpi = (etiqueta, valor, nota, color) =>
    h('div.panel.kpi',
      h('div.etiqueta', etiqueta),
      h('div.valor', { style: color ? { color } : null }, valor),
      nota ? h('div.nota', nota) : null
    );

  cont.appendChild(
    h('div.cabecera-vista',
      h('div',
        h('h1', `Hola, ${G.config.empresa.nombre || 'KORT'}`),
        h('p.sub', 'Resumen de la actividad comercial y de producción')
      ),
      h('div.acciones',
        h('a.btn.btn-primario', { href: '#/cotizador' }, '＋ Nuevo presupuesto'),
        h('a.btn', { href: '#/presupuestos' }, 'Ver presupuestos')
      )
    )
  );

  /* ---------------- KPIs ---------------- */
  const faltaParaEquilibrio = eq.facturacionNecesaria - st.montoMes;
  cont.appendChild(
    h('div.grid.g4.mb',
      kpi('Presupuestos del mes', String(st.presupuestosMes), money(st.montoMes, sim, 0) + ' cotizados'),
      kpi('Aprobados', String(st.aprobados), money(st.montoAprobado, sim, 0) + ' en cartera', 'var(--verde)'),
      kpi('Tasa de conversión', pct(st.tasaConversion, 0), `${st.presupuestos} presupuestos históricos`),
      faltaParaEquilibrio > 0
        ? kpi('Falta para el equilibrio', money(faltaParaEquilibrio, sim, 0),
            `de ${money(eq.facturacionNecesaria, sim, 0)} que necesitás por mes`, 'var(--naranja)')
        : kpi('Equilibrio cubierto', money(-faltaParaEquilibrio, sim, 0) + ' arriba',
            `necesitabas ${money(eq.facturacionNecesaria, sim, 0)}`, 'var(--verde)')
    )
  );

  /* ---------------- Gráficos ---------------- */
  const lienzoMeses = h('canvas', { height: 230 });
  const lienzoMateriales = h('canvas', { height: 230 });
  const lienzoClientes = h('canvas', { height: 230 });
  const lienzoCostos = h('canvas', { height: 230 });

  cont.appendChild(
    h('div.grid.g2.mb',
      h('div.panel',
        h('div.panel-cab', h('h3', 'Facturación por mes'),
          h('span.chico.tenue', 'cotizado vs aprobado')),
        h('div.panel-cuerpo',
          st.porMes?.length ? lienzoMeses : h('div.vacio', h('div.icono', '▤'), 'Todavía no hay presupuestos cargados'))
      ),
      h('div.panel',
        h('div.panel-cab', h('h3', 'De qué está hecho el costo por hora'),
          h('a.btn.btn-sm', { href: '#/costos' }, 'Ajustar')),
        h('div.panel-cuerpo', lienzoCostos)
      )
    )
  );

  cont.appendChild(
    h('div.grid.g2.mb',
      h('div.panel',
        h('div.panel-cab', h('h3', 'Facturación por material'), h('a.btn.btn-sm', { href: '#/materiales' }, 'Precios')),
        h('div.panel-cuerpo',
          st.porMaterial?.length ? lienzoMateriales
            : h('div.vacio', h('div.icono', '▦'), 'Se llena cuando apruebes presupuestos'))
      ),
      h('div.panel',
        h('div.panel-cab', h('h3', 'Clientes que más facturan')),
        h('div.panel-cuerpo',
          st.porCliente?.filter((c) => c.facturado > 0).length ? lienzoClientes
            : h('div.vacio', h('div.icono', '👥'), 'Se llena cuando apruebes presupuestos'))
      )
    )
  );

  /* ---------------- Últimos presupuestos ---------------- */
  cont.appendChild(
    h('div.panel',
      h('div.panel-cab', h('h3', 'Últimos presupuestos'), h('a.btn.btn-sm', { href: '#/presupuestos' }, 'Ver todos')),
      h('div.panel-cuerpo.sin-pad',
        (st.ultimos || []).length
          ? h('table',
              h('thead', h('tr', h('th', 'N°'), h('th', 'Cliente'), h('th', 'Fecha'), h('th', 'Estado'), h('th.num', 'Total'))),
              h('tbody', ...st.ultimos.map((p) =>
                h('tr.clic', { onclick: () => (location.hash = '#/cotizador?id=' + p.id) },
                  h('td.mono', p.numero || '—'),
                  h('td', p.cliente || '—'),
                  h('td.chico', fecha(p.fecha)),
                  h('td', badge(ESTADOS_PRESUPUESTO, p.estado)),
                  h('td.num', money(p.total, sim, 0))))))
          : h('div.vacio', 'Sin movimientos'))
    )
  );

  /* ---------------- Dibujado ---------------- */
  const c = colores();
  const ejes = (moneda = true) => ({
    x: { grid: { display: false }, ticks: { color: c.texto } },
    y: {
      grid: { color: c.grilla },
      ticks: {
        color: c.texto,
        callback: (v) => (moneda ? money(v, sim, 0).replace(sim + ' ', '') : v),
      },
    },
  });

  if (st.porMes?.length) {
    graficos.push(new Chart(lienzoMeses, {
      type: 'bar',
      data: {
        labels: st.porMes.map((m) => m.mes.slice(5) + '/' + m.mes.slice(2, 4)),
        datasets: [
          { label: 'Cotizado', data: st.porMes.map((m) => m.monto), backgroundColor: 'rgba(228,87,46,.35)', borderRadius: 4 },
          { label: 'Aprobado', data: st.porMes.map((m) => m.aprobado), backgroundColor: '#1f7a4d', borderRadius: 4 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: c.texto, boxWidth: 12 } },
          tooltip: { callbacks: { label: (x) => `${x.dataset.label}: ${money(x.raw, sim, 0)}` } },
        },
        scales: ejes(),
      },
    }));
  }

  // Composición del costo horario del láser
  const laser = G.maquinas.find((m) => m.tipo === 'laser') || G.maquinas[0];
  if (laser) {
    const ch = calcularCostoHoraMaquina(laser, est);
    const partes = [
      ['Amortización', ch.amortizacion], ['Energía', ch.energia], ['Mantenimiento', ch.mantenimiento],
      ['Consumibles', ch.consumibles], ['Operario', ch.operario], ['Estructura', ch.estructura],
    ].filter(([, v]) => v > 0);
    graficos.push(new Chart(lienzoCostos, {
      type: 'doughnut',
      data: {
        labels: partes.map((p) => p[0]),
        datasets: [{ data: partes.map((p) => p[1]), backgroundColor: PALETA, borderWidth: 0 }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '58%',
        plugins: {
          legend: { position: 'right', labels: { color: c.texto, boxWidth: 11, padding: 8 } },
          tooltip: {
            callbacks: {
              label: (x) => `${x.label}: ${money(x.raw, sim, 0)}/h (${((x.raw / ch.total) * 100).toFixed(0)} %)`,
            },
          },
          title: {
            display: true, color: c.texto,
            text: `${laser.nombre} · ${money(ch.total, sim, 0)}/hora`,
          },
        },
      },
    }));
  }

  if (st.porMaterial?.length) {
    const nombreMat = (id) => G.materiales.find((m) => m.id === id)?.nombre || id;
    graficos.push(new Chart(lienzoMateriales, {
      type: 'bar',
      data: {
        labels: st.porMaterial.map((m) => nombreMat(m.material_id)),
        datasets: [{ label: 'Facturado', data: st.porMaterial.map((m) => m.facturado), backgroundColor: PALETA, borderRadius: 4 }],
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (x) => {
                const m = st.porMaterial[x.dataIndex];
                return [`${money(x.raw, sim, 0)}`, `${num(m.kg, 1)} kg · ${m.piezas} piezas`];
              },
            },
          },
        },
        scales: {
          x: { grid: { color: c.grilla }, ticks: { color: c.texto, callback: (v) => money(v, sim, 0).replace(sim + ' ', '') } },
          y: { grid: { display: false }, ticks: { color: c.texto } },
        },
      },
    }));
  }

  const clientes = (st.porCliente || []).filter((x) => x.facturado > 0);
  if (clientes.length) {
    graficos.push(new Chart(lienzoClientes, {
      type: 'bar',
      data: {
        labels: clientes.map((x) => x.cliente),
        datasets: [
          { label: 'Facturado', data: clientes.map((x) => x.facturado), backgroundColor: '#1b3a5c', borderRadius: 4 },
          { label: 'Utilidad', data: clientes.map((x) => x.utilidad), backgroundColor: '#1f7a4d', borderRadius: 4 },
        ],
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: c.texto, boxWidth: 12 } },
          tooltip: { callbacks: { label: (x) => `${x.dataset.label}: ${money(x.raw, sim, 0)}` } },
        },
        scales: {
          x: { grid: { color: c.grilla }, ticks: { color: c.texto, callback: (v) => money(v, sim, 0).replace(sim + ' ', '') } },
          y: { grid: { display: false }, ticks: { color: c.texto } },
        },
      },
    }));
  }

  return {
    destruir() {
      while (graficos.length) graficos.pop().destroy();
    },
  };
}
