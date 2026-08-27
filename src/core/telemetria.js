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

/**
 * Un número que puede faltar. Devuelve null y NO 0.
 *
 * La diferencia importa en todo lo que sigue: 0 W de potencia óptica es una
 * lectura válida (el láser está apagado) y 0 mm es una posición válida (el
 * cabezal está en el cero de máquina). Convertir "no lo sé" en 0 haría que
 * una pasarela mal conectada dibuje el cabezal en la esquina y muestre la
 * fuente apagada, que es indistinguible de que lo esté de verdad.
 */
function opcional(v) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

/**
 * Posición del cabezal, en mm y en coordenadas de máquina.
 *
 * No se acota contra el área de trabajo acá: este módulo no conoce la
 * máquina, y recortar una lectura fuera de rango escondería justamente el
 * síntoma de un adaptador que está leyendo el registro equivocado. Se
 * transporta tal cual y quien la dibuje decide qué hacer con un valor
 * imposible.
 */
function normalizarPosicion(p) {
  if (!p || typeof p !== 'object') return null;
  const x = opcional(p.x);
  const y = opcional(p.y);
  const z = opcional(p.z);
  if (x == null && y == null && z == null) return null;
  return { x, y, z };
}

/**
 * Lo que informa la fuente, que es un equipo distinto del control numérico.
 *
 * El CNC sabe dónde está el cabezal y qué programa corre; la fuente sabe
 * cuánta potencia óptica está entregando, a qué temperatura y cuántas horas
 * lleva emitiendo. Son dos buses distintos y pueden estar uno sí y otro no,
 * así que van en bloques separados: tener posición no implica tener fuente.
 *
 * `horasEmitiendo` es el contador más valioso de todos — es el tiempo real de
 * arco, contra el que se puede contrastar lo que el motor estima.
 */
function normalizarLaser(l) {
  if (!l || typeof l !== 'object') return null;
  const out = {
    potenciaW: opcional(l.potenciaW ?? l.potencia_w),
    tempC: opcional(l.tempC ?? l.temp_c),
    horasEncendida: opcional(l.horasEncendida ?? l.horas_encendida),
    horasEmitiendo: opcional(l.horasEmitiendo ?? l.horas_emitiendo),
    alarma: l.alarma ? String(l.alarma).trim().slice(0, 200) : null,
  };
  return Object.values(out).some((v) => v != null) ? out : null;
}

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
    posicion: normalizarPosicion(muestra.posicion),
    laser: normalizarLaser(muestra.laser),
  };
}

/**
 * El recorrido del cabezal, para dibujarlo.
 *
 * Se corta el trazo cuando hay un hueco de tiempo mayor al esperado: si la
 * pasarela estuvo caída diez minutos, unir el último punto con el siguiente
 * dibujaría una línea recta que la máquina nunca hizo. Un trazo inventado en
 * una pantalla de taller es peor que un hueco.
 *
 * Cada punto lleva `emitiendo` para poder distinguir corte de posicionamiento:
 * son las dos cosas que la pantalla tiene que mostrar distinto, porque una es
 * la que consume chapa y la otra no.
 */
export function recorridoCabezal(muestras = [], opciones = {}) {
  const cortePorHuecoSeg = Math.max(1, n(opciones.cortePorHuecoSeg, 5));
  const tramos = [];
  let actual = null;
  let anterior = null;

  for (const cruda of muestras || []) {
    const m = normalizarMuestra(cruda);
    if (!m.posicion || m.posicion.x == null || m.posicion.y == null) {
      // Sin coordenadas no hay punto; y se corta, porque el próximo punto
      // válido no es continuación de nada.
      actual = null;
      anterior = m;
      continue;
    }
    const t = new Date(m.fecha).getTime();
    const hueco = anterior ? (t - new Date(anterior.fecha).getTime()) / 1000 : Infinity;
    if (!actual || hueco > cortePorHuecoSeg) {
      actual = [];
      tramos.push(actual);
    }
    actual.push({
      x: m.posicion.x,
      y: m.posicion.y,
      z: m.posicion.z,
      fecha: m.fecha,
      // Emitiendo = el haz está encendido. Se toma de la potencia de la fuente
      // si la hay; si no, del estado, que es lo único que sabe el CNC.
      emitiendo: m.laser?.potenciaW != null ? m.laser.potenciaW > 0 : m.estado === 'produciendo',
      velocidadMMMin: m.velocidadMMMin,
    });
    anterior = m;
  }

  return tramos.filter((t) => t.length > 1);
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

/**
 * Reduce la serie para graficar. ⚠️ Promedia potencia y velocidad, así que
 * **no sirve para el recorrido**: promediar dos posiciones da un punto por el
 * que el cabezal nunca pasó. `recorridoCabezal` trabaja sobre las muestras
 * crudas por eso mismo.
 */
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
