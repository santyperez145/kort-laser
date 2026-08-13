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
import { calibrar } from '@core/calibracion.js';

export const usarEstado = create((set, get) => ({
  config: null,
  materiales: [],
  maquinas: [],
  clientes: [],
  calibracion: null,
  listo: false,
  errorConexion: null,

  async cargar() {
    try {
      const [config, materiales, maquinas, clientes, ordenes] = await Promise.all([
        api.get('config'),
        api.get('materiales'),
        api.get('maquinas'),
        api.get('clientes'),
        // Las órdenes se traen sólo para calibrar. Si fallan, el cotizador
        // tiene que seguir andando: se cotiza con el modelo sin corregir,
        // que es exactamente lo que hacía antes.
        api.get('ordenes').catch(() => []),
      ]);
      set({
        config, materiales, maquinas, clientes,
        calibracion: calibrar(ordenes),
        listo: true, errorConexion: null,
      });
    } catch (e) {
      set({ listo: false, errorConexion: e.message });
      throw e;
    }
  },

  /** Se llama al anotar el tiempo real de una orden. */
  async recargarCalibracion() {
    const ordenes = await api.get('ordenes').catch(() => []);
    const calibracion = calibrar(ordenes);
    set({ calibracion });
    return calibracion;
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

  /**
   * Guarda la lista completa de materiales.
   *
   * Misma regla que las máquinas: va la lista entera porque el endpoint es un
   * documento único. Y hay una razón extra para tocarlos por acá y no contra
   * la API a mano — el servidor registra en el historial cada cambio de
   * precio comparando contra lo que había, así que mandar una lista parcial
   * ensucia el historial además de borrar materiales.
   */
  async guardarMateriales(materiales) {
    const guardados = await api.put('materiales', materiales);
    set({ materiales: Array.isArray(guardados) ? guardados : materiales });
    return guardados;
  },

  /** Contexto que espera `cotizarPresupuesto()` del motor de cálculo. */
  ctx() {
    const { materiales, maquinas, config, calibracion } = get();
    return { materiales, maquinas, config, calibracion };
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
