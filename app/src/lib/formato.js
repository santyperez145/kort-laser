/**
 * Formato de números y fechas, en castellano rioplatense.
 *
 * Es un puerto literal de `web/js/ui.js`: mismo separador de miles (punto),
 * misma coma decimal y el mismo "—" para lo que no es finito. Si se toca acá,
 * el PDF y la pantalla dejan de coincidir y el cliente lo nota.
 */

export function money(v, sim = '$', dec = 2) {
  if (!isFinite(v)) return '—';
  const n = Math.abs(v).toFixed(dec);
  const [e, d] = n.split('.');
  return `${v < 0 ? '-' : ''}${sim} ${e.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${d ? ',' + d : ''}`;
}

export function num(v, d = 1) {
  if (!isFinite(v)) return '—';
  return v.toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function pct(v, d = 1) {
  return num(v, d) + ' %';
}

export function fecha(iso) {
  if (!iso) return '—';
  // `YYYY-MM-DD` es una fecha civil, no un instante UTC. Construirla con
  // `new Date(texto)` la corre al día anterior en Argentina (UTC−3), justo
  // lo contrario de lo que tiene que pasar con una fecha de entrega.
  const soloDia = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso));
  const valor = soloDia
    ? new Date(Number(soloDia[1]), Number(soloDia[2]) - 1, Number(soloDia[3]))
    : new Date(iso);
  return valor.toLocaleDateString('es-AR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

export function fechaHora(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-AR', {
    day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

/** Descarga bytes o texto como archivo. */
export function descargar(nombre, datos, mime = 'application/octet-stream') {
  const blob = datos instanceof Blob ? datos : new Blob([datos], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 1500);
}

/** Bytes a base64 por bloques: `apply` revienta la pila con arrays grandes. */
export function bytesABase64(bytes) {
  let bin = '';
  const bloque = 0x8000;
  for (let i = 0; i < bytes.length; i += bloque) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + bloque));
  }
  return btoa(bin);
}

export const ESTADOS_PRESUPUESTO = {
  borrador: { txt: 'Borrador', tono: 'gris' },
  enviado: { txt: 'Enviado', tono: 'azul' },
  aprobado: { txt: 'Aprobado', tono: 'verde' },
  rechazado: { txt: 'Rechazado', tono: 'rojo' },
  vencido: { txt: 'Vencido', tono: 'amarillo' },
  facturado: { txt: 'Facturado', tono: 'verde' },
};

export const ESTADOS_OT = {
  pendiente: { txt: 'Pendiente', tono: 'gris' },
  material: { txt: 'Esperando material', tono: 'amarillo' },
  corte: { txt: 'En corte', tono: 'naranja' },
  plegado: { txt: 'En plegado', tono: 'naranja' },
  terminado: { txt: 'Terminado', tono: 'azul' },
  entregado: { txt: 'Entregado', tono: 'verde' },
  cancelado: { txt: 'Cancelado', tono: 'rojo' },
};
