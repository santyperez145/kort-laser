/** Cliente de la API. Un error del servidor se propaga: nunca se traga. */

import { bytesABase64 } from './formato';

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
    } catch {
      /* el servidor devolvió algo que no es JSON: queda el código */
    }
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
