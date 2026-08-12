/** KORT - Listado y seguimiento de presupuestos. */

import { h, vaciar, toast, confirmar, money, num, fecha, badge, ESTADOS_PRESUPUESTO, modal, cerrarModal } from '../ui.js';
import { api, simbolo } from '../api.js';

let todos = [];
let filtro = { q: '', estado: '' };

export async function render(cont) {
  todos = await api.get('presupuestos');
  todos.sort((a, b) => (b.creado || '').localeCompare(a.creado || ''));

  const buscador = h('input', {
    type: 'search', placeholder: 'Buscar por número, cliente o pieza…', value: filtro.q,
    style: { maxWidth: '340px' },
    oninput: (e) => { filtro.q = e.target.value.toLowerCase(); pintarTabla(); },
  });
  const selEstado = h('select', { style: { maxWidth: '190px' } },
    h('option', { value: '' }, 'Todos los estados'),
    ...Object.entries(ESTADOS_PRESUPUESTO).map(([k, v]) => h('option', { value: k }, v.txt))
  );
  selEstado.onchange = () => { filtro.estado = selEstado.value; pintarTabla(); };

  const cuerpoTabla = h('tbody');

  cont.appendChild(
    h('div.cabecera-vista',
      h('div', h('h1', 'Presupuestos'), h('p.sub', 'Historial completo, estados y seguimiento comercial')),
      h('div.acciones', h('a.btn.btn-primario', { href: '#/cotizador' }, '＋ Nuevo presupuesto'))
    )
  );

  cont.appendChild(
    h('div.panel',
      h('div.panel-cab', h('div.fila.crecer', buscador, selEstado), h('span.chico.tenue', { id: 'contador' })),
      h('div.panel-cuerpo.sin-pad',
        h('table',
          h('thead', h('tr',
            h('th', 'N°'), h('th', 'Cliente'), h('th', 'Fecha'), h('th.num', 'Ítems'),
            h('th.num', 'Piezas'), h('th.num', 'Peso'), h('th.num', 'Total'), h('th', 'Estado'), h('th', '')
          )),
          cuerpoTabla
        )
      )
    )
  );

  function pintarTabla() {
    const sim = simbolo();
    const lista = todos.filter((p) => {
      if (filtro.estado && (p.estado || 'borrador') !== filtro.estado) return false;
      if (!filtro.q) return true;
      return JSON.stringify(p).toLowerCase().includes(filtro.q);
    });
    vaciar(cuerpoTabla);
    const cnt = document.getElementById('contador');
    if (cnt) cnt.textContent = `${lista.length} de ${todos.length}`;

    if (!lista.length) {
      cuerpoTabla.appendChild(h('tr', h('td', { colspan: 9 }, h('div.vacio', h('div.icono', '▤'), 'Sin resultados'))));
      return;
    }

    for (const p of lista) {
      const r = p.resumen || {};
      cuerpoTabla.appendChild(
        h('tr',
          h('td.mono.clic', { onclick: () => abrir(p) }, p.numero || '—'),
          h('td.clic', { onclick: () => abrir(p) }, p.cliente?.nombre || '—'),
          h('td.chico', fecha(p.fecha || p.creado)),
          h('td.num', String(p.items?.length || 0)),
          h('td.num', String(r.piezasTotales ?? '—')),
          h('td.num', r.pesoTotal != null ? num(r.pesoTotal, 1) + ' kg' : '—'),
          h('td.num.negrita', money(r.total, sim, 0)),
          h('td', selectorEstado(p)),
          h('td', h('div.fila',
            h('button.btn-sm', { title: 'Abrir en el cotizador', onclick: () => abrir(p) }, '✎'),
            h('button.btn-sm', { title: 'Pasar a producción', onclick: () => aProduccion(p) }, '⚙'),
            h('button.btn-sm.btn-peligro', { title: 'Eliminar', onclick: () => borrar(p) }, '✕')
          ))
        )
      );
    }
  }

  function selectorEstado(p) {
    const s = h('select', { style: { width: 'auto', padding: '3px 6px', fontSize: '12px' } },
      ...Object.entries(ESTADOS_PRESUPUESTO).map(([k, v]) =>
        h('option', { value: k, selected: (p.estado || 'borrador') === k }, v.txt))
    );
    s.onchange = async () => {
      await api.put('presupuestos/' + p.id, { estado: s.value });
      p.estado = s.value;
      toast('Estado actualizado', 'ok');
      pintarTabla();
    };
    return s;
  }

  function abrir(p) {
    location.hash = '#/cotizador?id=' + p.id;
  }

  async function aProduccion(p) {
    const existentes = await api.get('ordenes');
    if (existentes.some((o) => o.presupuestoId === p.id)) {
      return toast('Ese presupuesto ya tiene una orden de trabajo');
    }
    const ot = await api.post('ordenes', {
      presupuestoId: p.id,
      cliente: p.cliente,
      items: (p.items || []).map((i) => ({ nombre: i.nombre, cantidad: i.cantidad, materialId: i.materialId, espesor: i.espesor })),
      resumen: p.resumen,
      estado: 'pendiente',
      fechaEntrega: '',
      prioridad: 'normal',
    });
    await api.put('presupuestos/' + p.id, { estado: 'aprobado' });
    p.estado = 'aprobado';
    toast(`Orden ${ot.numero} creada`, 'ok');
    pintarTabla();
  }

  function borrar(p) {
    confirmar('Eliminar presupuesto', `Se va a borrar el presupuesto ${p.numero || ''} de ${p.cliente?.nombre || 'sin cliente'}. No se puede deshacer.`, async () => {
      await api.del('presupuestos/' + p.id);
      todos = todos.filter((x) => x.id !== p.id);
      pintarTabla();
      toast('Presupuesto eliminado', 'ok');
    }, 'Eliminar');
  }

  pintarTabla();
  return {};
}
