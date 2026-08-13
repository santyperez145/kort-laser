/**
 * Estado global: lo que se carga una vez al arrancar y no cambia mientras se
 * cotiza (config del taller, materiales, máquinas, clientes).
 *
 * Va en zustand y no en React Query porque el cotizador lo lee en cada tecla
 * para recalcular el precio: tiene que ser una lectura síncrona de memoria,
 * no una consulta con estados de carga.
 *
 * Los datos que sí son "del servidor y pueden cambiar solos" —estadísticas,
 * presupuestos, historial— van por React Query. La división es esa.
 */

import { create } from 'zustand';
import { api } from './api';

export const usarEstado = create((set, get) => ({
  config: null,
  materiales: [],
  maquinas: [],
  clientes: [],
  listo: false,
  errorConexion: null,

  async cargar() {
    try {
      const [config, materiales, maquinas, clientes] = await Promise.all([
        api.get('config'),
        api.get('materiales'),
        api.get('maquinas'),
        api.get('clientes'),
      ]);
      set({ config, materiales, maquinas, clientes, listo: true, errorConexion: null });
    } catch (e) {
      set({ listo: false, errorConexion: e.message });
      throw e;
    }
  },

  async recargarClientes() {
    const clientes = await api.get('clientes');
    set({ clientes });
    return clientes;
  },

  /**
   * Guarda la lista completa de máquinas.
   *
   * Va la lista entera y no la máquina suelta porque el endpoint es un
   * documento único: mandar una sola borraría las demás. El servidor además
   * rechaza cualquier cuerpo que no sea una lista con ids — se ganó ese
   * chequeo a los golpes.
   */
  async guardarMaquinas(maquinas) {
    const guardadas = await api.put('maquinas', maquinas);
    set({ maquinas: Array.isArray(guardadas) ? guardadas : maquinas });
    return guardadas;
  },

  /** Contexto que espera `cotizarPresupuesto()` del motor de cálculo. */
  ctx() {
    const { materiales, maquinas, config } = get();
    return { materiales, maquinas, config };
  },

  laser() {
    const { maquinas } = get();
    return maquinas.find((m) => m.tipo === 'laser') || maquinas[0];
  },

  plegadora() {
    return get().maquinas.find((m) => m.tipo === 'plegadora');
  },

  simbolo() {
    return get().config?.comercial?.simbolo || '$';
  },
}));

/* ------------------------------------------------------------------ */
/* Tema                                                                */
/*                                                                     */
/* Se escriben las dos marcas a la vez: `html.dark` para Tailwind y     */
/* `body.oscuro` para las vistas que todavía usan la hoja de estilos    */
/* vieja. Mientras convivan las dos, el interruptor tiene que mover     */
/* las dos o media aplicación queda en el tema contrario.               */
/* ------------------------------------------------------------------ */

function aplicar(oscuro) {
  document.documentElement.classList.toggle('dark', oscuro);
  document.body.classList.toggle('oscuro', oscuro);
  localStorage.setItem('kort-tema', oscuro ? 'oscuro' : 'claro');
  // Los visores de canvas no son CSS: se enteran del cambio por este evento.
  window.dispatchEvent(new Event('kort-tema'));
}

export const usarTema = create((set, get) => ({
  oscuro: (localStorage.getItem('kort-tema') || 'oscuro') === 'oscuro',

  alternar() {
    const oscuro = !get().oscuro;
    aplicar(oscuro);
    set({ oscuro });
  },

  iniciar() {
    aplicar(get().oscuro);
  },
}));
