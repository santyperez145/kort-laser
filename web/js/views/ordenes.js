/** KORT - Tablero de producción: en qué anda cada trabajo. */

import { h, vaciar, toast, confirmar, modal, cerrarModal, money, num, fecha, badge, ESTADOS_OT } from '../ui.js';
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
      tiempoReal(o),
      h('div.fila.mt-sm', { style: { gap: '4px' } },
        idx > 0 ? h('button.btn-sm', { onclick: () => mover(o, -1) }, '←') : null,
        idx < COLUMNAS.length - 1 ? h('button.btn-sm.crecer', { onclick: () => mover(o, 1) }, 'Avanzar →') : null,
        h('button.btn-sm.btn-peligro', { onclick: () => borrar(o) }, '✕')
      )
    );
  }

  /**
   * Lo que tardó contra lo que se había estimado.
   *
   * Se muestra en la tarjeta y no escondido en un detalle: es el dato que
   * hace que el operario entienda para qué se lo están pidiendo.
   */
  function tiempoReal(o) {
    const terminada = ['terminado', 'entregado'].includes(o.estado);
    const est = o.resumen?.tiempoProduccion || 0;

    if (o.real?.segundos) {
      const dif = est ? Math.round((o.real.segundos / est - 1) * 100) : null;
      const color = dif === null || Math.abs(dif) < 10 ? 'var(--verde)'
        : Math.abs(dif) < 30 ? 'var(--amarillo)' : 'var(--naranja)';
      return h('div.chico', { style: { marginTop: '5px', color } },
        `⏱ ${fmtMin(o.real.segundos)} real`,
        dif !== null ? ` · ${dif > 0 ? '+' : ''}${dif} % vs estimado` : '',
        h('button.btn-sm', {
          style: { padding: '1px 6px', marginLeft: '6px', fontSize: '10.5px' },
          onclick: () => pedirTiempoReal(o),
        }, 'corregir')
      );
    }

    if (!terminada) return null;
    return h('button.btn-sm', {
      style: { marginTop: '5px', width: '100%', fontSize: '11px' },
      onclick: () => pedirTiempoReal(o),
    }, '⏱ ¿Cuánto tardó?');
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
    // Al terminar es el único momento en que el dato existe y alguien se
    // acuerda. Después nadie vuelve a cargarlo.
    if (nuevo === 'terminado' && !o.real?.segundos) pedirTiempoReal(o);
  }

  /**
   * Cuánto tardó de verdad.
   *
   * Es el dato que convierte al cotizador de estimador en calibrado: con
   * suficientes trabajos medidos, el sistema saca su propio factor de
   * corrección contra ESTA máquina y ESTE operario. Sin esto, todo el tiempo
   * que cotiza el sistema es simulado y nadie sabe si se queda corto.
   *
   * Se pide en minutos porque es como lo dice un operario ("tardé una hora y
   * media"), no en segundos.
   */
  function pedirTiempoReal(o) {
    const estimado = o.resumen?.tiempoProduccion || 0;
    const estimadoMin = Math.round(estimado / 60);
    const input = h('input', {
      type: 'number', min: 1, step: 1, placeholder: String(estimadoMin || 30),
      style: { fontSize: '16px' },
    });
    const nota = h('textarea', { rows: 2, placeholder: 'Algo que explique el tiempo (opcional): chapa fea, se cortó dos veces…' });

    modal({
      titulo: `¿Cuánto tardó la ${o.numero}?`,
      ancho: '460px',
      cuerpo: h('div',
        h('p.chico.suave', { style: { marginTop: 0, lineHeight: '1.6' } },
          'De máquina, desde que empezaste a preparar hasta que terminaste. ',
          estimado ? h('span', 'El sistema había estimado ', h('strong', fmtMin(estimado)), '.') : null),
        h('div.campo', h('label', 'Minutos'), input),
        h('div.campo', h('label', 'Observación'), nota),
        h('div.aviso.aviso-info', h('span', 'ⓘ'),
          h('div', 'Con esto el cotizador aprende. Si la estimación se queda corta, ' +
            'los próximos presupuestos salen corregidos solos.'))
      ),
      pie: [
        h('button', { onclick: cerrarModal }, 'Ahora no'),
        h('button.btn-primario', {
          onclick: async () => {
            const min = parseFloat(input.value);
            if (!(min > 0)) return toast('Poné los minutos que tardó', 'error');
            o.real = { segundos: Math.round(min * 60), fecha: new Date().toISOString(), nota: nota.value || '' };
            cerrarModal();
            try {
              await api.put('ordenes/' + o.id, { real: o.real });
              const dif = estimado ? Math.round((o.real.segundos / estimado - 1) * 100) : null;
              toast(
                dif === null ? 'Tiempo anotado'
                  : Math.abs(dif) < 5 ? 'Tiempo anotado: la estimación dio bien'
                  : `Tiempo anotado: ${Math.abs(dif)} % ${dif > 0 ? 'más' : 'menos'} que lo estimado`,
                'ok', 5000
              );
              pintar();
            } catch (e) {
              toast('No se pudo guardar: ' + e.message, 'error');
            }
          },
        }, 'Guardar'),
      ],
    });
  }

  const fmtMin = (s) => {
    const m = Math.round(s / 60);
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
  };

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
