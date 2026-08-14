/** KORT - Tablero de producción: en qué anda cada trabajo. */

import { h, vaciar, toast, confirmar, modal, cerrarModal, money, num, fecha, badge, ESTADOS_OT } from '../ui.js';
import { api, simbolo } from '../api.js';

const COLUMNAS = ['pendiente', 'material', 'corte', 'plegado', 'terminado', 'entregado', 'cancelado'];

export async function render(cont) {
  let [ordenes, agenda] = await Promise.all([api.get('ordenes'), api.get('agenda').catch(() => null)]);
  const sim = simbolo();
  const agendaPorId = () => new Map((agenda?.ordenes || []).map((o) => [o.id, o]));

  cont.appendChild(
    h('div.cabecera-vista',
      h('div', h('h1', 'Producción'), h('p.sub', 'Cada trabajo, en qué etapa está y cuándo hay que entregarlo')),
      h('div.acciones', h('a.btn', { href: '#/presupuestos' }, 'Pasar un presupuesto a producción'))
    )
  );

  const bandaAgenda = h('div.panel.mt-sm');
  cont.appendChild(bandaAgenda);

  const tablero = h('div', {
    style: { display: 'grid', gridTemplateColumns: `repeat(${COLUMNAS.length}, minmax(190px, 1fr))`, gap: '12px', overflowX: 'auto', paddingBottom: '10px' },
  });
  cont.appendChild(tablero);

  function pintarAgenda() {
    vaciar(bandaAgenda);
    if (!agenda) {
      bandaAgenda.appendChild(h('div.panel-cuerpo', h('div.chico.suave', 'No se pudo calcular la carga de máquina.')));
      return;
    }
    bandaAgenda.appendChild(h('div.panel-cuerpo',
      h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(130px, 1fr))', gap: '10px' } },
        kpiAgenda('Carga abierta', `${num(agenda.horasComprometidas, 1)} h`, `${agenda.abiertas} OT pendientes`),
        kpiAgenda('Capacidad real', `${num(agenda.capacidadDiariaHoras, 1)} h/día`, 'según estructura'),
        kpiAgenda('Fecha libre', fecha(agenda.fechaDisponible), `${num(agenda.diasComprometidos, 1)} días de cola`),
        kpiAgenda('Riesgo', agenda.atrasadas ? `${agenda.atrasadas} OT` : 'Sin atrasos', agenda.sinFecha ? `${agenda.sinFecha} sin fecha` : 'fechas cargadas',
          agenda.atrasadas ? 'var(--naranja)' : 'var(--verde)')
      )
    ));
  }

  function kpiAgenda(titulo, valor, nota, color = 'var(--tinta)') {
    return h('div', { style: { border: '1px solid var(--borde)', borderRadius: '8px', padding: '10px', background: 'var(--panel-2)' } },
      h('div.chico.tenue', titulo),
      h('div', { style: { fontSize: '20px', fontWeight: 800, color, marginTop: '2px' } }, valor),
      h('div.chico.suave', nota)
    );
  }

  function pintar() {
    pintarAgenda();
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
    const plan = agendaPorId().get(o.id);
    const vencida = o.fechaEntrega && new Date(o.fechaEntrega) < new Date() && o.estado !== 'entregado';
    const enRiesgo = plan?.atrasada || plan?.vencida;
    const idx = COLUMNAS.indexOf(o.estado || 'pendiente');
    return h('div', {
      style: {
        border: '1px solid var(--borde)', borderRadius: '8px', padding: '10px',
        background: 'var(--panel-2)', borderLeft: `3px solid ${enRiesgo ? 'var(--rojo)' : o.prioridad === 'urgente' ? 'var(--naranja)' : 'var(--borde)'}`,
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
            agenda = await api.get('agenda').catch(() => agenda);
            pintar();
          },
        })
      ),
      vencida ? h('div.chico.rojo.negrita', { style: { marginTop: '4px' } }, '⚠ Fecha vencida') : null,
      plan ? h('div.chico', {
        style: {
          marginTop: '5px',
          color: enRiesgo ? 'var(--rojo)' : 'var(--suave)',
          fontWeight: enRiesgo ? 700 : 500,
        },
      }, `Prometible: ${fecha(plan.fechaPrometible)} · faltan ${fmtMin(plan.segundosRestantes)}`) : null,
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

  async function moverAnterior(o, delta) {
    const i = COLUMNAS.indexOf(o.estado || 'pendiente');
    const nuevo = COLUMNAS[Math.max(0, Math.min(COLUMNAS.length - 1, i + delta))];
    o.estado = nuevo;
    await api.put('ordenes/' + o.id, { estado: nuevo });
    if (nuevo === 'entregado' && o.presupuestoId) {
      await api.put('presupuestos/' + o.presupuestoId, { estado: 'facturado' }).catch(() => {});
    }
    agenda = await api.get('agenda').catch(() => agenda);
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

  async function mover(o, delta) {
    const i = COLUMNAS.indexOf(o.estado || 'pendiente');
    const nuevo = COLUMNAS[Math.max(0, Math.min(COLUMNAS.length - 2, i + delta))];
    try {
      const actualizado = await api.put('ordenes/' + o.id, { estado: nuevo });
      Object.assign(o, actualizado);
      if (nuevo === 'entregado' && o.presupuestoId) {
        await api.put('presupuestos/' + o.presupuestoId, { estado: 'facturado' }).catch(() => {});
      }
      agenda = await api.get('agenda').catch(() => agenda);
      pintar();
      if (nuevo === 'corte' && (o.retazos || []).some((x) => x.estado === 'consumido')) {
        toast('Retazo consumido y sobrante actualizado', 'ok');
      }
      if (nuevo === 'terminado' && !o.real?.segundos) pedirTiempoReal(o);
    } catch (e) {
      toast('No se pudo mover la orden: ' + e.message, 'error');
    }
  }

  function cancelar(o) {
    confirmar('Cancelar orden', `Se va a cancelar la orden ${o.numero}. La reserva de retazos pendiente se libera.`, async () => {
      try {
        const actualizado = await api.put('ordenes/' + o.id, { estado: 'cancelado' });
        Object.assign(o, actualizado);
        agenda = await api.get('agenda').catch(() => agenda);
        pintar();
        toast('Orden cancelada y stock liberado', 'ok');
      } catch (e) {
        toast('No se pudo cancelar: ' + e.message, 'error');
      }
    }, 'Cancelar orden');
  }

  const fmtMin = (s) => {
    const m = Math.round(s / 60);
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
  };

  function borrar(o) {
    if (!['entregado', 'cancelado'].includes(o.estado)) return cancelar(o);
    confirmar('Eliminar orden', `Se va a borrar la orden ${o.numero}.`, async () => {
      await api.del('ordenes/' + o.id);
      ordenes = ordenes.filter((x) => x.id !== o.id);
      agenda = await api.get('agenda').catch(() => agenda);
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
