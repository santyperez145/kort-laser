/** KORT - Tablero de producción: en qué anda cada trabajo. */

import { h, vaciar, toast, confirmar, money, num, fecha, badge, ESTADOS_OT } from '../ui.js';
import { api, simbolo } from '../api.js';

const COLUMNAS = ['pendiente', 'material', 'corte', 'plegado', 'terminado', 'entregado'];

export async function render(cont) {
  let ordenes = await api.get('ordenes');
  const sim = simbolo();

  cont.appendChild(
    h('div.cabecera-vista',
      h('div', h('h1', 'Producción'), h('p.sub', 'Cada trabajo, en qué etapa está y cuándo hay que entregarlo')),
      h('div.acciones', h('a.btn', { href: '#/presupuestos' }, 'Pasar un presupuesto a producción'))
    )
  );

  const tablero = h('div', {
    style: { display: 'grid', gridTemplateColumns: `repeat(${COLUMNAS.length}, minmax(190px, 1fr))`, gap: '12px', overflowX: 'auto', paddingBottom: '10px' },
  });
  cont.appendChild(tablero);

  function pintar() {
    vaciar(tablero);
    for (const col of COLUMNAS) {
      const dela = ordenes.filter((o) => (o.estado || 'pendiente') === col);
      const info = ESTADOS_OT[col];
      const columna = h('div.panel', { style: { minHeight: '160px' } },
        h('div.panel-cab',
          h('h3', info.txt),
          h('span.badge.' + info.clase, String(dela.length))
        ),
        h('div.panel-cuerpo', { style: { display: 'flex', flexDirection: 'column', gap: '9px', padding: '10px' } },
          ...dela.map(tarjeta),
          dela.length ? null : h('div.chico.tenue.centro', { style: { padding: '18px 0' } }, '—')
        )
      );
      tablero.appendChild(columna);
    }
  }

  function tarjeta(o) {
    const vencida = o.fechaEntrega && new Date(o.fechaEntrega) < new Date() && o.estado !== 'entregado';
    const idx = COLUMNAS.indexOf(o.estado || 'pendiente');
    return h('div', {
      style: {
        border: '1px solid var(--borde)', borderRadius: '8px', padding: '10px',
        background: 'var(--panel-2)', borderLeft: `3px solid ${vencida ? 'var(--rojo)' : o.prioridad === 'urgente' ? 'var(--naranja)' : 'var(--borde)'}`,
      },
    },
      h('div.fila.entre',
        h('strong.chico.mono', o.numero),
        o.prioridad === 'urgente' ? h('span.badge.b-naranja', 'Urgente') : null
      ),
      h('div', { style: { fontSize: '13px', fontWeight: 600, margin: '3px 0' } }, o.cliente?.nombre || 'Sin cliente'),
      h('div.chico.suave', (o.items || []).map((i) => `${i.cantidad}× ${i.nombre}`).join(', ') || '—'),
      o.resumen?.total ? h('div.chico.mono', { style: { marginTop: '4px' } }, money(o.resumen.total, sim, 0)) : null,
      h('div.fila.mt-sm', { style: { gap: '5px' } },
        h('input', {
          type: 'date', value: o.fechaEntrega || '',
          style: { fontSize: '11px', padding: '3px 5px' },
          onchange: async (e) => {
            o.fechaEntrega = e.target.value;
            await api.put('ordenes/' + o.id, { fechaEntrega: o.fechaEntrega });
            pintar();
          },
        })
      ),
      vencida ? h('div.chico.rojo.negrita', { style: { marginTop: '4px' } }, '⚠ Fecha vencida') : null,
      h('div.fila.mt-sm', { style: { gap: '4px' } },
        idx > 0 ? h('button.btn-sm', { onclick: () => mover(o, -1) }, '←') : null,
        idx < COLUMNAS.length - 1 ? h('button.btn-sm.crecer', { onclick: () => mover(o, 1) }, 'Avanzar →') : null,
        h('button.btn-sm.btn-peligro', { onclick: () => borrar(o) }, '✕')
      )
    );
  }

  async function mover(o, delta) {
    const i = COLUMNAS.indexOf(o.estado || 'pendiente');
    const nuevo = COLUMNAS[Math.max(0, Math.min(COLUMNAS.length - 1, i + delta))];
    o.estado = nuevo;
    await api.put('ordenes/' + o.id, { estado: nuevo });
    if (nuevo === 'entregado' && o.presupuestoId) {
      await api.put('presupuestos/' + o.presupuestoId, { estado: 'facturado' }).catch(() => {});
    }
    pintar();
  }

  function borrar(o) {
    confirmar('Eliminar orden', `Se va a borrar la orden ${o.numero}.`, async () => {
      await api.del('ordenes/' + o.id);
      ordenes = ordenes.filter((x) => x.id !== o.id);
      pintar();
      toast('Orden eliminada', 'ok');
    }, 'Eliminar');
  }

  pintar();

  if (!ordenes.length) {
    cont.appendChild(h('div.panel.mt', h('div.vacio',
      h('div.icono', '⚙'),
      h('div', 'Todavía no hay órdenes de trabajo.'),
      h('div.chico', { style: { marginTop: '6px' } }, 'Aprobá un presupuesto desde la sección Presupuestos y pasalo a producción.')
    )));
  }

  return {};
}
