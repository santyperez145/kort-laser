/**
 * Estado del cotizador.
 *
 * El documento vive en un solo `useState` y se actualiza de forma inmutable.
 * El cálculo NO se guarda en estado: se deriva con `useMemo` del documento,
 * así no hay forma de que el precio en pantalla quede desincronizado de los
 * parámetros que lo produjeron — que es exactamente el bug que uno no ve
 * hasta que el cliente compara dos presupuestos.
 */

import { createContext, useContext } from 'react';
import { paramsPorDefecto } from '@core/library.js';

export const CtxCotizador = createContext(null);

export function usarCotizador() {
  const c = useContext(CtxCotizador);
  if (!c) throw new Error('usarCotizador() fuera del cotizador');
  return c;
}

export function docVacio() {
  return {
    numero: null,
    fecha: new Date().toISOString().slice(0, 10),
    estado: 'borrador',
    cliente: { nombre: '', cuit: '', telefono: '', email: '', direccion: '' },
    items: [],
    notas: '',
    entregaDias: 7,
    condicionPago: '50 % anticipo, saldo contra entrega',
    descuentoGlobal: 0,
  };
}

export function itemNuevo(materiales, base = {}) {
  const mat = materiales[0];
  return {
    nombre: 'Pieza',
    origen: 'libreria',
    piezaId: 'placa',
    params: paramsPorDefecto('placa'),
    materialId: mat?.id,
    espesor: mat?.espesores[Math.min(3, mat.espesores.length - 1)] ?? 2,
    gas: null, // null = el gas recomendado para ese material y espesor
    cantidad: 1,
    plegado: { pliegues: 0, largoPliegue: 0, angulo: 90, matrizV: 0, herramentales: 1 },
    acabadoId: 'ninguno',
    procesos: [],
    ingenieriaHoras: 0,
    urgencia: 'normal',
    ...base,
  };
}
