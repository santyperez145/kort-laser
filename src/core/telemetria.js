/**
 * Modelo canónico de telemetría de máquina.
 *
 * Los controladores hablan dialectos distintos. Los adaptadores traducen a
 * este contrato y el resto de KORT queda independiente de la marca del CNC.
 */

export const ESTADOS_MAQUINA = ['apagada', 'inactiva', 'preparando', 'produciendo', 'pausada', 'alarma'];
const ESTADOS_VALIDOS = new Set(ESTADOS_MAQUINA);
const n = (v, d = 0) => Number.isFinite(Number(v)) ? Number(v) : d;
const acotar = (v, min, max) => Math.max(min, Math.min(max, n(v)));

export function normalizarMuestra(muestra = {}, ahora = new Date()) {
  const estado = ESTADOS_VALIDOS.has(muestra.estado) ? muestra.estado : 'inactiva';
  const fecha = new Date(muestra.fecha || ahora);
  return {
    maquinaId: String(muestra.maquinaId || muestra.maquina_id || 'laser-3kw').trim().slice(0, 80),
    fecha: Number.isNaN(fecha.getTime()) ? ahora.toISOString() : fecha.toISOString(),
    estado,
    modo: String(muestra.modo || '').trim().slice(0, 60),
    programa: String(muestra.programa || '').trim().slice(0, 180),
    ordenId: String(muestra.ordenId || muestra.orden_id || '').trim().slice(0, 80),
    progreso: acotar(muestra.progreso, 0, 100),
    potenciaPct: acotar(muestra.potenciaPct ?? muestra.potencia_pct, 0, 100),
    velocidadMMMin: Math.max(0, n(muestra.velocidadMMMin ?? muestra.velocidad_mm_min)),
    gas: String(muestra.gas || '').trim().toUpperCase().slice(0, 16),
    alarma: String(muestra.alarma || '').trim().slice(0, 500),
    piezasBuenas: Math.max(0, Math.round(n(muestra.piezasBuenas ?? muestra.piezas_buenas))),
    piezasRechazadas: Math.max(0, Math.round(n(muestra.piezasRechazadas ?? muestra.piezas_rechazadas))),
    fuente: String(muestra.fuente || 'adaptador').trim().slice(0, 60),
  };
}

/**
 * Resume muestras ponderando por tiempo. Se limita cada intervalo para que
 * una PC apagada durante horas no convierta la última lectura en producción.
 */
export function resumirTelemetria(muestras = [], ahora = new Date(), opciones = {}) {
  const silencioSeg = Math.max(3, n(opciones.silencioSeg, 15));
  const intervaloMaxSeg = Math.max(silencioSeg, n(opciones.intervaloMaxSeg, 30));
  const ordenadas = (muestras || []).map((m) => normalizarMuestra(m)).sort((a, b) => a.fecha.localeCompare(b.fecha));
  const segundosPorEstado = Object.fromEntries(ESTADOS_MAQUINA.map((e) => [e, 0]));

  for (let i = 0; i < ordenadas.length; i++) {
    const desde = new Date(ordenadas[i].fecha).getTime();
    const hasta = i + 1 < ordenadas.length ? new Date(ordenadas[i + 1].fecha).getTime() : Math.min(ahora.getTime(), desde + silencioSeg * 1000);
    const segundos = Math.max(0, Math.min(intervaloMaxSeg, (hasta - desde) / 1000));
    segundosPorEstado[ordenadas[i].estado] += segundos;
  }

  const ultima = ordenadas.at(-1) || null;
  const edadSeg = ultima ? Math.max(0, (ahora.getTime() - new Date(ultima.fecha).getTime()) / 1000) : Infinity;
  const conectada = edadSeg <= silencioSeg;
  const tiempoConectado = ESTADOS_MAQUINA.reduce((s, e) => s + segundosPorEstado[e], 0);
  const tiempoPlanificado = tiempoConectado - segundosPorEstado.apagada;
  const disponibilidad = tiempoPlanificado > 0 ? segundosPorEstado.produciendo / tiempoPlanificado : null;
  const buenas = ultima?.piezasBuenas || 0;
  const rechazadas = ultima?.piezasRechazadas || 0;
  const calidad = buenas + rechazadas > 0 ? buenas / (buenas + rechazadas) : null;

  return {
    conectada, edadSeg, ultima, segundosPorEstado, tiempoConectado,
    disponibilidad, calidad,
    // OEE exige también rendimiento contra ciclo ideal. Sin ese dato se deja
    // nulo: poner disponibilidad con otro nombre sería un indicador engañoso.
    oee: null,
    alarmas: ordenadas.filter((m) => m.estado === 'alarma' || m.alarma).slice(-20).reverse(),
  };
}

export function serieTelemetria(muestras = [], maxPuntos = 240) {
  const lista = (muestras || []).map((m) => normalizarMuestra(m));
  if (lista.length <= maxPuntos) return lista;
  const paso = Math.ceil(lista.length / maxPuntos);
  const salida = [];
  for (let i = 0; i < lista.length; i += paso) {
    const lote = lista.slice(i, i + paso);
    const ultima = lote.at(-1);
    salida.push({
      ...ultima,
      potenciaPct: lote.reduce((s, x) => s + x.potenciaPct, 0) / lote.length,
      velocidadMMMin: lote.reduce((s, x) => s + x.velocidadMMMin, 0) / lote.length,
    });
  }
  return salida;
}
