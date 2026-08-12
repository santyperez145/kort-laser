/** KORT - Arranque, navegación y ruteo. */

import { h, $, vaciar, toast, estado as chipEstado } from './ui.js';
import { cargarEstado } from './api.js';

const RUTAS = [
  { id: '', txt: 'Panel', vista: () => import('./views/dashboard.js') },
  { id: 'cotizador', txt: 'Cotizador', vista: () => import('./views/cotizador.js') },
  { id: 'presupuestos', txt: 'Presupuestos', vista: () => import('./views/presupuestos.js') },
  { id: 'ordenes', txt: 'Producción', vista: () => import('./views/ordenes.js') },
  { id: 'clientes', txt: 'Clientes', vista: () => import('./views/clientes.js') },
  { id: 'materiales', txt: 'Materiales', vista: () => import('./views/materiales.js') },
  { id: 'maquinas', txt: 'Máquinas', vista: () => import('./views/maquinas.js') },
  { id: 'costos', txt: 'Costos', vista: () => import('./views/costos.js') },
  { id: 'config', txt: 'Configuración', vista: () => import('./views/config.js') },
];

let vistaActual = null;

function pintarNav(activa) {
  const nav = vaciar($('#nav'));
  for (const r of RUTAS) {
    nav.appendChild(
      h('a', { href: '#/' + r.id, class: r.id === activa ? 'activo' : '' }, r.txt)
    );
  }
}

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [ruta, query] = raw.split('?');
  const params = new URLSearchParams(query || '');
  return { ruta: ruta || '', params };
}

async function navegar() {
  const { ruta, params } = parseHash();
  const def = RUTAS.find((r) => r.id === ruta) || RUTAS[0];
  pintarNav(def.id);

  const cont = vaciar($('#vista'));
  cont.appendChild(h('div.vacio', h('div.icono', '◌'), 'Cargando…'));

  try {
    if (vistaActual?.destruir) vistaActual.destruir();
    const mod = await def.vista();
    vaciar(cont);
    vistaActual = await mod.render(cont, params);
    window.scrollTo(0, 0);
  } catch (e) {
    console.error(e);
    vaciar(cont).appendChild(
      h('div.panel', h('div.panel-cuerpo',
        h('div.aviso.aviso-error', h('div', h('strong', 'No se pudo abrir la vista'), h('div.chico', e.message))),
        h('pre.chico.mono', { style: { whiteSpace: 'pre-wrap', color: 'var(--suave)' } }, e.stack || '')
      ))
    );
  }
}

function tema() {
  const guardado = localStorage.getItem('kort-tema');
  if (guardado === 'oscuro') document.body.classList.add('oscuro');
  $('#btn-tema').addEventListener('click', () => {
    document.body.classList.toggle('oscuro');
    localStorage.setItem('kort-tema', document.body.classList.contains('oscuro') ? 'oscuro' : 'claro');
    window.dispatchEvent(new Event('kort-tema'));
  });
}

async function arrancar() {
  tema();
  try {
    await cargarEstado();
    chipEstado('Conectado');
  } catch (e) {
    chipEstado('Sin conexión');
    toast('No se pudo conectar con el servidor: ' + e.message, 'error', 8000);
  }
  window.addEventListener('hashchange', navegar);
  await navegar();
}

arrancar();
