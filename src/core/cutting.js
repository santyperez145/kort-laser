/**
 * KORT - Motor de tiempo de corte láser
 * Configurado para una fuente de fibra de 3 kW sobre mesa 3015.
 *
 * No estima el tiempo dividiendo perímetro por velocidad (eso subestima
 * cualquier pieza con detalle). Simula el planificador de movimiento real
 * de la máquina:
 *
 *   1. Cada contorno se descompone en tramos con longitud y curvatura.
 *   2. Se calcula la velocidad máxima admisible en cada unión entre tramos
 *      (modelo de desviación de unión, igual que un control CNC real).
 *   3. Pasada hacia atrás + pasada hacia adelante ("look-ahead") para que
 *      ninguna velocidad sea inalcanzable con la aceleración disponible.
 *   4. Perfil trapezoidal por tramo -> tiempo exacto.
 *   5. Se suman perforaciones, entradas, movimientos rápidos entre contornos,
 *      y tiempos fijos de carga/descarga y setup.
 *
 * Y ahora, además, todo depende del GAS elegido: velocidad, perforación y
 * consumo. Ver materials.js.
 */

import {
  segStart,
  pathCentroid,
  arcSweep,
} from './geometry.js';
import { cuttingSpeed, pierceTime, gasFlow, gasRecomendado, presionGas, boquilla, GASES } from './materials.js';
import { calcularEstructura, calcularCostoHoraMaquina, costoHoraOperario, UOM_RAMA17, DEFAULT_ESTRUCTURA } from './costos.js';

/**
 * Perfil de la máquina. Valores típicos de una 3015 de fibra 3 kW de gama
 * media (Bodor / HSG / Han's y similares), que es lo que se instala en
 * Argentina en este rango.
 */
export const DEFAULT_MACHINE = {
  id: 'laser-1',
  nombre: 'Láser fibra 3 kW · 3015',
  tipo: 'laser',
  potenciaKW: 3,
  areaTrabajo: { w: 3000, h: 1500 },
  aceleracion: 1.2, // G · gantry con servos y piñón-cremallera
  velocidadRapida: 80000, // mm/min
  desviacionUnion: 0.08, // mm · tolerancia de esquina del look-ahead
  entradaMM: 4, // lead-in por contorno
  factorEntrada: 0.6, // la entrada se hace a velocidad reducida
  tiempoCargaChapa: 90, // s por chapa (carga + descarga, sin cambiador de palet)
  tiempoSetupPrograma: 180, // s por programa nuevo
  tiempoDescarga: 1.5, // s por pieza (sacar y apilar)
  eficiencia: 0.92, // micro-paradas, limpieza de boquilla, verificación
  participacionEstructura: 60, // % de la estructura del taller que absorbe

  costo: {
    // Láser de fibra 3 kW 3015 con intercambiador, puesto en planta.
    // ≈ USD 83.000 a $1.500 (agosto 2026).
    valorEquipo: 125000000,
    vidaUtilHoras: 20000, // ~10 años a 2.000 h/año
    // Fuente 3 kW al 35 % de rendimiento (~9 kW) + chiller (~4) +
    // aspiración (~3) + control y servos (~2). Promedio real cortando: 14 kW.
    consumoKW: 14,
    costoKWh: 106.4609, // EDELAR T2-BT1, banda "resto" (8-18 h)
    mantenimientoHora: 4000, // service anual, guías, correas, filtros de aspiración
    consumiblesHora: 2800, // lente protectora, boquillas, cerámica, filtros
    operarioHora: 12750, // costo real de un Operador CNC (UOM rama 17, cargas incluidas)
    dedicacionOperario: 80, // % · en nests largos el operario adelanta otro trabajo
  },
};

export const DEFAULT_PLEGADORA = {
  id: 'plegadora-1',
  nombre: 'Plegadora CNC 100 t × 3200',
  tipo: 'plegadora',
  toneladas: 100,
  largoUtil: 3200,
  ejes: 6,
  tiempoSetupHerramienta: 420, // s por cambio de herramental
  tiempoPorPliegue: 6, // s base por pliegue
  factorLargo: 0.0025, // s adicionales por mm de largo de pliegue
  factorPeso: 0.35, // s adicionales por kg de pieza (manipulación)
  participacionEstructura: 40,

  costo: {
    valorEquipo: 75000000, // ≈ USD 50.000
    vidaUtilHoras: 25000,
    consumoKW: 7.5, // central hidráulica
    costoKWh: 106.4609,
    mantenimientoHora: 1200,
    consumiblesHora: 500, // desgaste de punzones y matrices
    operarioHora: 12750,
    dedicacionOperario: 100, // la plegadora no trabaja sola
  },
};

const G = 9806.65; // mm/s²

/**
 * Costo horario de una máquina. Si no se pasa la estructura del taller, usa
 * la de referencia. Ver costos.js para el desglose y el porqué.
 */
export function calcularCostoHora(machine, estructura) {
  return calcularCostoHoraMaquina(machine, estructura || calcularEstructura(DEFAULT_ESTRUCTURA));
}

export { calcularEstructura, costoHoraOperario, UOM_RAMA17 };

/* ------------------------------------------------------------------ */
/* Planificador de movimiento                                          */
/* ------------------------------------------------------------------ */

function tangent(s, end) {
  if (s.t === 'L') return Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
  const sweep = arcSweep(s);
  const ang = s.a1 + sweep * (end ? 1 : 0);
  return ang + (sweep > 0 ? Math.PI / 2 : -Math.PI / 2);
}

/**
 * Velocidad máxima en una esquina, según el modelo de desviación de unión:
 *   v = sqrt(a · δ · sen(θ/2) / (1 − sen(θ/2)))
 * Una esquina de 90° obliga a bajar muchísimo; una unión casi recta casi no
 * penaliza.
 */
function junctionSpeed(angleChange, accel, delta, vmax) {
  const theta = Math.PI - Math.abs(angleChange);
  if (theta >= Math.PI - 1e-6) return vmax;
  const s = Math.sin(theta / 2);
  if (s >= 1 - 1e-9) return vmax;
  const v = Math.sqrt((accel * delta * s) / (1 - s));
  return Math.min(vmax, Math.max(v, 1));
}

function normAngle(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/** Tiempo de un tramo con perfil trapezoidal (mm, mm/s, mm/s²). */
function segmentTime(L, vIn, vOut, vMax, a) {
  if (L <= 1e-9) return 0;
  const dAcc = Math.max(0, (vMax * vMax - vIn * vIn) / (2 * a));
  const dDec = Math.max(0, (vMax * vMax - vOut * vOut) / (2 * a));
  if (dAcc + dDec <= L) {
    const dCruise = L - dAcc - dDec;
    return Math.max(0, (vMax - vIn) / a) + Math.max(0, (vMax - vOut) / a) + dCruise / vMax;
  }
  const vPeak = Math.sqrt(Math.max((2 * a * L + vIn * vIn + vOut * vOut) / 2, Math.max(vIn, vOut) ** 2));
  return Math.max(0, (vPeak - vIn) / a) + Math.max(0, (vPeak - vOut) / a);
}

function pathLengthOfSeg(s) {
  if (s.t === 'L') return Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
  return Math.abs(arcSweep(s)) * s.r;
}

/** Simula el recorrido de un contorno y devuelve tiempo (s) y longitud (mm). */
export function simularContorno(path, { vMax, accel, delta }) {
  const segs = [];
  for (const s of path.segs) {
    const total = pathLengthOfSeg(s);
    if (total < 1e-9) continue;
    if (s.t === 'L') {
      segs.push({ len: total, vLimit: vMax, dirIn: tangent(s, false), dirOut: tangent(s, true) });
    } else {
      // Velocidad limitada por aceleración centrípeta en el arco: v = sqrt(a·R)
      const vArc = Math.min(vMax, Math.sqrt(accel * s.r));
      const n = Math.max(1, Math.ceil(total / 25));
      const sweep = arcSweep(s);
      for (let i = 0; i < n; i++) {
        const a1 = s.a1 + (sweep * i) / n;
        const a2 = s.a1 + (sweep * (i + 1)) / n;
        const off = sweep > 0 ? Math.PI / 2 : -Math.PI / 2;
        segs.push({ len: total / n, vLimit: vArc, dirIn: a1 + off, dirOut: a2 + off });
      }
    }
  }
  if (!segs.length) return { tiempo: 0, longitud: 0 };

  const n = segs.length;
  const closed = path.closed !== false;
  const vJunc = new Array(n + 1).fill(0);

  for (let i = 1; i < n; i++) {
    const ang = normAngle(segs[i].dirIn - segs[i - 1].dirOut);
    vJunc[i] = junctionSpeed(ang, accel, delta, Math.min(segs[i - 1].vLimit, segs[i].vLimit));
  }
  if (closed && n > 1) {
    const ang = normAngle(segs[0].dirIn - segs[n - 1].dirOut);
    const v = junctionSpeed(ang, accel, delta, Math.min(segs[n - 1].vLimit, segs[0].vLimit));
    vJunc[0] = v;
    vJunc[n] = v;
  }

  for (let i = n - 1; i >= 0; i--) {
    vJunc[i] = Math.min(vJunc[i], Math.sqrt(vJunc[i + 1] ** 2 + 2 * accel * segs[i].len), segs[i].vLimit);
  }
  for (let i = 0; i < n; i++) {
    vJunc[i + 1] = Math.min(vJunc[i + 1], Math.sqrt(vJunc[i] ** 2 + 2 * accel * segs[i].len), segs[i].vLimit);
  }

  let tiempo = 0;
  let longitud = 0;
  for (let i = 0; i < n; i++) {
    tiempo += segmentTime(segs[i].len, vJunc[i], vJunc[i + 1], segs[i].vLimit, accel);
    longitud += segs[i].len;
  }
  return { tiempo, longitud };
}

/* ------------------------------------------------------------------ */
/* Orden de corte y movimientos rápidos                                */
/* ------------------------------------------------------------------ */

/**
 * Ordena los contornos como lo haría el CAM: primero los agujeros y después
 * el contorno exterior, minimizando el recorrido con vecino más cercano.
 */
export function recorridoRapido(shape, origen = [0, 0]) {
  const holes = (shape.holes || []).map((p) => ({ p, c: pathCentroid(p) }));
  let cur = origen;
  let dist = 0;
  const orden = [];
  const pend = [...holes];
  while (pend.length) {
    let bi = 0;
    let bd = Infinity;
    for (let i = 0; i < pend.length; i++) {
      const d = Math.hypot(pend[i].c[0] - cur[0], pend[i].c[1] - cur[1]);
      if (d < bd) {
        bd = d;
        bi = i;
      }
    }
    dist += bd;
    cur = pend[bi].c;
    orden.push(pend[bi].p);
    pend.splice(bi, 1);
  }
  const [ox, oy] = segStart(shape.outer.segs[0]);
  dist += Math.hypot(ox - cur[0], oy - cur[1]);
  orden.push(shape.outer);
  return { distancia: dist, orden };
}

/* ------------------------------------------------------------------ */
/* Cálculo principal                                                   */
/* ------------------------------------------------------------------ */

/**
 * Tiempo de corte de UNA pieza.
 * @param {string} gas  'O2' | 'N2' | 'AIRE' | null (usa el recomendado)
 */
export function tiempoCortePieza(shape, material, espesor, machine = DEFAULT_MACHINE, gas = null) {
  const gasId = gas || gasRecomendado(material, espesor);
  const vMaxMin = cuttingSpeed(material, espesor, machine.potenciaKW, gasId);
  if (!vMaxMin || vMaxMin <= 0) {
    const proc = material.procesos?.[gasId];
    const motivo = !proc
      ? `${material.nombre} no tiene datos para corte con ${gasId}`
      : `${material.nombre} de ${espesor} mm supera el máximo de ${proc.maxEspesor} mm con ${gasId} a ${machine.potenciaKW} kW`;
    return { error: motivo };
  }

  const vMax = vMaxMin / 60; // mm/s
  const accel = (machine.aceleracion || 1) * G;
  const delta = machine.desviacionUnion || 0.08;

  const { distancia, orden } = recorridoRapido(shape);

  let tCorte = 0;
  let longitud = 0;
  const contornos = [];
  for (const p of orden) {
    const r = simularContorno(p, { vMax, accel, delta });
    tCorte += r.tiempo;
    longitud += r.longitud;
    contornos.push({ longitud: r.longitud, tiempo: r.tiempo, vMedia: r.longitud / Math.max(r.tiempo, 1e-6) });
  }

  const nPiercings = 1 + (shape.holes || []).length;
  const largoEntrada = (machine.entradaMM || 4) * nPiercings;
  const tEntradas = largoEntrada / Math.max(vMax * (machine.factorEntrada || 0.6), 1);

  const tPierceUnit = pierceTime(material, espesor, machine.potenciaKW, gasId);
  const tPierce = tPierceUnit * nPiercings;

  const vRap = (machine.velocidadRapida || 80000) / 60;
  const tRapid = distancia > 0 ? distancia / vRap + nPiercings * (vRap / accel) : 0;

  const tMaquina = (tCorte + tEntradas + tPierce + tRapid) / (machine.eficiencia || 1);

  // El gas sólo corre mientras el haz está encendido (corte + entrada +
  // perforación); en los rápidos el obturador está cerrado.
  const flujo = gasFlow(material, espesor, gasId); // m³/h
  const gasM3 = (flujo * (tCorte + tEntradas + tPierce)) / 3600;
  const vMediaEfectiva = longitud / Math.max(tCorte, 1e-6);

  return {
    longitudCorte: longitud + largoEntrada,
    piercings: nPiercings,
    tCorte,
    tEntradas,
    tPierce,
    tRapid,
    tPieza: tMaquina,
    tDescarga: machine.tiempoDescarga || 0,
    vNominal: vMaxMin,
    vMediaEfectiva: vMediaEfectiva * 60, // mm/min
    penalizacion: 1 - vMediaEfectiva / vMax,
    gasTipo: gasId,
    gasNombre: GASES[gasId]?.nombre || gasId,
    gasM3,
    gasCaudal: flujo,
    gasPresion: presionGas(material, espesor, gasId),
    boquilla: boquilla(material, espesor, gasId),
    contornos,
  };
}

/**
 * Tiempo total de un lote, incluyendo tiempos de chapa y setup.
 *
 * `incluirSetup` acepta un booleano o un número entre 0 y 1. La fracción
 * existe para el anidado por presupuesto: cuando varios ítems comparten una
 * misma chapa, el operario prepara UN programa, no uno por ítem, y ese setup
 * se reparte entre ellos según el área que ocupa cada uno. Contarlo entero en
 * cada ítem era cobrar tres puestas a punto que nunca pasaron.
 *
 * `chapas` también puede venir fraccionario por el mismo motivo.
 */
export function tiempoCorteLote(shape, material, espesor, machine, cantidad, chapas = 1, incluirSetup = true, gas = null) {
  const uni = tiempoCortePieza(shape, material, espesor, machine, gas);
  if (uni.error) return uni;
  const factorSetup =
    incluirSetup === true ? 1 : incluirSetup === false || incluirSetup == null ? 0
      : Math.max(0, Math.min(1, Number(incluirSetup) || 0));
  const tProduccion = (uni.tPieza + uni.tDescarga) * cantidad;
  const tChapas = (machine.tiempoCargaChapa || 0) * chapas;
  const tSetup = factorSetup * (machine.tiempoSetupPrograma || 0);
  return {
    ...uni,
    cantidad,
    chapas,
    tProduccion,
    tChapas,
    tSetup,
    tTotal: tProduccion + tChapas + tSetup,
    gasM3Total: uni.gasM3 * cantidad,
    longitudTotal: uni.longitudCorte * cantidad,
    piercingsTotal: uni.piercings * cantidad,
  };
}

/** Formatea segundos como "1h 23m 45s". */
export function fmtTiempo(s) {
  if (!isFinite(s) || s < 0) return '-';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.round(s % 60);
  if (h) return `${h}h ${m}m ${sec}s`;
  if (m) return `${m}m ${sec}s`;
  return `${sec}s`;
}
