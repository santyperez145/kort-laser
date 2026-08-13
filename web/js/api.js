/** KORT - Cliente de la API y estado global compartido. */

import { bytesABase64 } from './ui.js';

async function pedir(url, opciones = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opciones,
    body: opciones.body ? JSON.stringify(opciones.body) : undefined,
  });
  if (!res.ok) {
    let msg = `Error ${res.status}`;
    try {
      msg = (await res.json()).error || msg;
    } catch {}
    throw new Error(msg);
  }
  return res.json();
}

export const api = {
  get: (r, q = '') => pedir(`/api/${r}${q}`),
  post: (r, body) => pedir(`/api/${r}`, { method: 'POST', body }),
  put: (r, body) => pedir(`/api/${r}`, { method: 'PUT', body }),
  del: (r) => pedir(`/api/${r}`, { method: 'DELETE' }),

  /** Guarda un archivo generado en la carpeta `salidas/` del proyecto. */
  guardarArchivo(nombre, datos, carpeta = '') {
    const cuerpo = { nombre, carpeta };
    if (typeof datos === 'string') cuerpo.texto = datos;
    else cuerpo.base64 = bytesABase64(datos);
    return pedir('/api/archivos', { method: 'POST', body: cuerpo });
  },
};

/** Estado compartido: se carga una vez al arrancar. */
export const estado = {
  config: null,
  materiales: [],
  maquinas: [],
  clientes: [],
  listo: false,
};

export async function cargarEstado() {
  const [config, materiales, maquinas, clientes] = await Promise.all([
    api.get('config'),
    api.get('materiales'),
    api.get('maquinas'),
    api.get('clientes'),
  ]);
  estado.config = config;
  estado.materiales = materiales;
  estado.maquinas = maquinas;
  estado.clientes = clientes;
  estado.listo = true;
  return estado;
}

export function ctx() {
  return { materiales: estado.materiales, maquinas: estado.maquinas, config: estado.config };
}

export function laser() {
  return estado.maquinas.find((m) => m.tipo === 'laser') || estado.maquinas[0];
}
export function plegadora() {
  return estado.maquinas.find((m) => m.tipo === 'plegadora');
}
export function simbolo() {
  return estado.config?.comercial?.simbolo || '$';
}

/**
 * Le avisa a la interfaz nueva que algo cambió.
 *
 * Estas vistas viven adentro de un iframe y la aplicación React tiene su
 * propia copia de config, materiales y máquinas: la carga una sola vez al
 * arrancar porque el cotizador la lee en cada tecla. Sin este aviso, guardar
 * un precio acá dejaba al cotizador calculando con el valor viejo hasta que
 * alguien recargara la página — y parecía que el cambio no se había guardado.
 */
function avisarCambio(que) {
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ tipo: 'kort-datos-cambiados', que }, window.location.origin);
    }
  } catch {
    /* si el navegador bloquea el postMessage, se pierde el refresco
       automático pero el dato ya quedó guardado en el servidor */
  }
}

export async function guardarConfig(config) {
  estado.config = await api.put('config', config);
  avisarCambio('config');
  return estado.config;
}
export async function guardarMateriales(m) {
  estado.materiales = await api.put('materiales', m);
  avisarCambio('materiales');
  return estado.materiales;
}
export async function guardarMaquinas(m) {
  estado.maquinas = await api.put('maquinas', m);
  avisarCambio('maquinas');
  return estado.maquinas;
}
export async function recargarClientes() {
  estado.clientes = await api.get('clientes');
  return estado.clientes;
}
