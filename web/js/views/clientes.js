/** KORT - Clientes. */

import { h, vaciar, toast, confirmar, modal, cerrarModal, money, fecha } from '../ui.js';
import { api, estado as G, simbolo, recargarClientes } from '../api.js';

export async function render(cont) {
  let clientes = await recargarClientes();
  const presupuestos = await api.get('presupuestos');
  const sim = simbolo();

  const cuerpo = h('tbody');
  const buscador = h('input', {
    type: 'search', placeholder: 'Buscar cliente…', style: { maxWidth: '320px' },
    oninput: (e) => pintar(e.target.value.toLowerCase()),
  });

  cont.appendChild(
    h('div.cabecera-vista',
      h('div', h('h1', 'Clientes'), h('p.sub', 'Base de contactos y su historial de compras')),
      h('div.acciones', h('button.btn-primario', { onclick: () => editar(null) }, '＋ Nuevo cliente'))
    )
  );

  cont.appendChild(
    h('div.panel',
      h('div.panel-cab', buscador, h('span.chico.tenue', `${clientes.length} clientes`)),
      h('div.panel-cuerpo.sin-pad',
        h('table',
          h('thead', h('tr',
            h('th', 'Cliente'), h('th', 'CUIT'), h('th', 'Contacto'),
            h('th.num', 'Presupuestos'), h('th.num', 'Facturado'), h('th', 'Último'), h('th', '')
          )),
          cuerpo
        )
      )
    )
  );

  function pintar(q = '') {
    vaciar(cuerpo);
    const lista = clientes.filter((c) => !q || JSON.stringify(c).toLowerCase().includes(q));
    if (!lista.length) {
      cuerpo.appendChild(h('tr', h('td', { colspan: 7 }, h('div.vacio', h('div.icono', '👤'), 'Sin clientes cargados'))));
      return;
    }
    for (const c of lista) {
      const suyos = presupuestos.filter((p) => p.clienteId === c.id || p.cliente?.nombre === c.nombre);
      const facturado = suyos
        .filter((p) => p.estado === 'aprobado' || p.estado === 'facturado')
        .reduce((a, p) => a + (p.resumen?.total || 0), 0);
      const ultimo = suyos.map((p) => p.fecha || p.creado).sort().pop();
      cuerpo.appendChild(
        h('tr',
          h('td', h('strong', c.nombre), c.notas ? h('div.chico.tenue', c.notas) : null),
          h('td.mono.chico', c.cuit || '—'),
          h('td.chico', [c.telefono, c.email].filter(Boolean).join(' · ') || '—'),
          h('td.num', String(suyos.length)),
          h('td.num', money(facturado, sim, 0)),
          h('td.chico', fecha(ultimo)),
          h('td', h('div.fila',
            h('button.btn-sm', { onclick: () => editar(c) }, '✎'),
            h('button.btn-sm', { title: 'Cotizar para este cliente', onclick: () => (location.hash = '#/cotizador') }, '＋'),
            h('button.btn-sm.btn-peligro', { onclick: () => borrar(c) }, '✕')
          ))
        )
      );
    }
  }

  function editar(c) {
    const campos = [
      ['nombre', 'Nombre / Razón social', 'text'],
      ['cuit', 'CUIT', 'text'],
      ['telefono', 'Teléfono', 'text'],
      ['email', 'Email', 'email'],
      ['direccion', 'Dirección', 'text'],
      ['contacto', 'Persona de contacto', 'text'],
    ];
    const inputs = {};
    const form = h('div');
    for (const [k, label, tipo] of campos) {
      inputs[k] = h('input', { type: tipo, value: c?.[k] || '' });
      form.appendChild(h('div.campo', h('label', label), inputs[k]));
    }
    inputs.descuento = h('input', { type: 'number', min: 0, max: 90, step: 1, value: c?.descuento ?? 0 });
    form.appendChild(h('div.campo', h('label', 'Descuento habitual (%)'), inputs.descuento));
    inputs.notas = h('textarea', { rows: 3 });
    inputs.notas.value = c?.notas || '';
    form.appendChild(h('div.campo', h('label', 'Notas'), inputs.notas));

    modal({
      titulo: c ? 'Editar cliente' : 'Nuevo cliente',
      ancho: '520px',
      cuerpo: form,
      pie: [
        h('button', { onclick: cerrarModal }, 'Cancelar'),
        h('button.btn-primario', {
          onclick: async () => {
            const datos = {};
            for (const k of Object.keys(inputs)) datos[k] = inputs[k].value;
            datos.descuento = +datos.descuento || 0;
            if (!datos.nombre.trim()) return toast('El nombre es obligatorio', 'error');
            if (c) await api.put('clientes/' + c.id, datos);
            else await api.post('clientes', datos);
            clientes = await recargarClientes();
            cerrarModal();
            pintar(buscador.value.toLowerCase());
            toast('Cliente guardado', 'ok');
          },
        }, 'Guardar'),
      ],
    });
  }

  function borrar(c) {
    confirmar('Eliminar cliente', `Se va a borrar "${c.nombre}". Los presupuestos ya emitidos no se tocan.`, async () => {
      await api.del('clientes/' + c.id);
      clientes = await recargarClientes();
      pintar();
      toast('Cliente eliminado', 'ok');
    }, 'Eliminar');
  }

  pintar();
  return {};
}
