/**
 * KORT - Perfil plegado
 *
 * Una pieza plegada es, casi siempre, una sección transversal repetida a lo
 * largo. Este módulo la modela como lo que es: una cadena de tramos rectos
 * unidos por pliegues, con su ángulo y su sentido.
 *
 *     tramos:  [50, 200, 50]        cotas exteriores, mm
 *     angulos: [{ grados: 90, sentido: 'arriba' }, { grados: 90, sentido: 'arriba' }]
 *
 * De ahí salen, todos juntos y coherentes entre sí:
 *   · el desarrollo plano que hay que cortar,
 *   · dónde va cada línea de plegado en ese desarrollo,
 *   · la sección 2D dibujada con los radios reales,
 *   · la validación de que la plegadora puede hacerlo,
 *   · el orden en que hay que plegar para que la pieza no choque.
 *
 * Es el módulo que alimenta al diseñador gráfico de plegado.
 */

import { rect, makeShape, rad, deg } from './geometry.js';
import {
  calcularPliegue, matrizRecomendada, radioInterno, kFactorEfectivo,
  alaMinima, validarPlegado,
} from './bending.js';

/** Un perfil vacío: una chapa lisa de 200 × 500. */
export function perfilNuevo() {
  return {
    tramos: [100, 100],
    angulos: [{ grados: 90, sentido: 'arriba' }],
    ancho: 500,
    espesor: 2,
    materialId: 'acero-sae1010',
    matrizV: 0, // 0 = automática
  };
}

const SENTIDO = { arriba: 1, abajo: -1 };

/**
 * Calcula todo lo que se puede saber de un perfil.
 *
 * @param {Object} perfil  { tramos, angulos, ancho, espesor, matrizV }
 * @param {Object} material
 * @param {Object} plegadora
 */
export function calcularPerfil(perfil, material, plegadora) {
  const t = Math.max(0.1, perfil.espesor || 1);
  const ancho = Math.max(1, perfil.ancho || 1);
  const tramos = (perfil.tramos || []).map((v) => Math.max(0.1, Number(v) || 0));
  const angulos = (perfil.angulos || []).slice(0, Math.max(0, tramos.length - 1));

  const V = perfil.matrizV > 0 ? perfil.matrizV : matrizRecomendada(t);
  const Ri = radioInterno(V, material);
  const K = kFactorEfectivo(Ri, t, material?.kFactor ?? 0.42);

  /* --- Pliegues, uno por unión --------------------------------------- */
  const pliegues = angulos.map((a, i) => {
    const grados = Math.abs(Number(a?.grados) || 0);
    const p = calcularPliegue(t, grados, material, V, ancho);
    return {
      indice: i + 1,
      grados,
      sentido: a?.sentido === 'abajo' ? 'abajo' : 'arriba',
      ...p,
    };
  });

  const sumaCotas = tramos.reduce((s, v) => s + v, 0);
  const sumaBD = pliegues.reduce((s, p) => s + p.BD, 0);
  const desarrollo = sumaCotas - sumaBD;

  /* --- Dónde cae cada línea de plegado en el desarrollo --------------- */
  // Se avanza por el desarrollo descontando media deducción a cada lado de
  // cada pliegue: es la posición real donde el operario apoya la chapa.
  const lineas = [];
  let x = 0;
  for (let i = 0; i < pliegues.length; i++) {
    x += tramos[i] - (i === 0 ? 0 : pliegues[i - 1].BD / 2) - pliegues[i].BD / 2;
    lineas.push({
      x,
      y1: 0,
      y2: ancho,
      indice: i + 1,
      grados: pliegues[i].grados,
      sentido: pliegues[i].sentido,
      label: `P${i + 1} ${pliegues[i].grados}° ${pliegues[i].sentido === 'arriba' ? '↑' : '↓'}`,
    });
  }

  /* --- El desarrollo como pieza cortable ------------------------------ */
  const shape = {
    ...makeShape(rect(0, 0, Math.max(0.1, desarrollo), ancho), []),
    pliegues: lineas.map((l) => ({ x1: l.x, y1: l.y1, x2: l.x, y2: l.y2, label: l.label })),
  };

  /* --- Sección transversal con los radios reales ---------------------- */
  const seccion = trazarSeccion(tramos, pliegues, t, Ri);

  /* --- Validaciones --------------------------------------------------- */
  const alas = alasLibres(tramos);
  const avisos = validarPlegado(
    { t, material, pliegues, largoMM: ancho, alas },
    plegadora
  );

  const aMin = alaMinima(V, t);
  if (desarrollo <= 0) {
    avisos.unshift({ nivel: 'error', msg: 'Las deducciones se comen todo el desarrollo. Revisá las cotas: son más chicas que los radios de plegado.' });
  }
  if (pliegues.length && ancho > (plegadora?.largoUtil ?? Infinity)) {
    // validarPlegado ya lo avisa, pero repetirlo acá no molesta
  }
  if (seccion.colisiones.length) {
    for (const c of seccion.colisiones) {
      avisos.push({
        nivel: 'aviso',
        msg: `Los tramos ${c.a} y ${c.b} quedan muy cerca o se cruzan al plegar (${c.distancia.toFixed(1)} mm). Puede que el punzón no entre.`,
      });
    }
  }

  return {
    tramos,
    angulos,
    ancho,
    espesor: t,
    matrizV: V,
    radioInterno: Ri,
    kFactor: K,
    alaMinima: aMin,
    pliegues,
    lineas,
    desarrollo,
    sumaCotas,
    sumaBD,
    shape,
    seccion,
    alas,
    avisos,
    // Para el cotizador
    plegado: {
      pliegues: pliegues.length,
      largoPliegue: ancho,
      angulo: pliegues[0]?.grados ?? 90,
      matrizV: perfil.matrizV || 0,
      herramentales: herramentalesNecesarios(pliegues),
    },
    modelo3D: {
      tipo: 'perfil',
      tramos,
      angulos: pliegues.map((p) => p.grados * SENTIDO[p.sentido]),
      ancho,
    },
    secuencia: secuenciaSugerida(tramos, pliegues),
  };
}

/** Las alas libres son el primer y el último tramo: son las que limita la matriz. */
function alasLibres(tramos) {
  if (tramos.length < 2) return [];
  return [tramos[0], tramos[tramos.length - 1]];
}

/**
 * Cuántos cambios de herramental hacen falta.
 *
 * Si todos los pliegues son del mismo ángulo, se hacen todos con el mismo
 * herramental. Cada ángulo distinto suele obligar a un cambio, que son ~7
 * minutos de máquina parada.
 */
function herramentalesNecesarios(pliegues) {
  const distintos = new Set(pliegues.map((p) => `${p.grados}|${p.matrizV}`));
  return Math.max(1, distintos.size);
}

/**
 * Traza la sección transversal siguiendo la fibra media, con los arcos reales
 * de cada pliegue. Devuelve la polilínea y detecta si dos tramos se cruzan.
 */
export function trazarSeccion(tramos, pliegues, t, Ri) {
  const Rm = Ri + t / 2;
  const pts = [[0, 0]];
  const tramosXY = [];
  let x = 0;
  let y = 0;
  let dir = 0;

  for (let i = 0; i < tramos.length; i++) {
    const antes = pliegues[i - 1];
    const ahora = pliegues[i];
    // El arco de cada pliegue consume parte de los tramos que une
    let L = tramos[i];
    if (antes) L -= Math.tan(rad(antes.grados) / 2) * (Ri + t);
    if (ahora) L -= Math.tan(rad(ahora.grados) / 2) * (Ri + t);
    L = Math.max(L, 0.5);

    const desde = [x, y];
    x += L * Math.cos(dir);
    y += L * Math.sin(dir);
    pts.push([x, y]);
    tramosXY.push({ indice: i + 1, desde, hasta: [x, y], largo: L });

    if (!ahora) break;

    const signo = SENTIDO[ahora.sentido];
    const a = rad(ahora.grados) * signo;
    const centro = [x - signo * Rm * Math.sin(dir), y + signo * Rm * Math.cos(dir)];
    const n = Math.max(4, Math.ceil(ahora.grados / 10));
    const a0 = Math.atan2(y - centro[1], x - centro[0]);
    for (let k = 1; k <= n; k++) {
      const aa = a0 + (a * k) / n;
      pts.push([centro[0] + Rm * Math.cos(aa), centro[1] + Rm * Math.sin(aa)]);
    }
    x = pts[pts.length - 1][0];
    y = pts[pts.length - 1][1];
    dir += a;
  }

  // ¿Se cruzan tramos no vecinos? Es lo que hace que una pieza no se pueda plegar.
  const colisiones = [];
  for (let i = 0; i < tramosXY.length; i++) {
    for (let j = i + 2; j < tramosXY.length; j++) {
      const d = distanciaSegmentos(tramosXY[i], tramosXY[j]);
      if (d < t * 1.5) colisiones.push({ a: i + 1, b: j + 1, distancia: d });
    }
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [px, py] of pts) {
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }

  return {
    pts,
    tramos: tramosXY,
    colisiones,
    bbox: { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY },
  };
}

function distanciaSegmentos(s1, s2) {
  const d = (p, a, b) => {
    const vx = b[0] - a[0];
    const vy = b[1] - a[1];
    const L2 = vx * vx + vy * vy;
    if (L2 < 1e-9) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    let s = ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy) / L2;
    s = Math.max(0, Math.min(1, s));
    return Math.hypot(p[0] - (a[0] + s * vx), p[1] - (a[1] + s * vy));
  };
  return Math.min(
    d(s1.desde, s2.desde, s2.hasta),
    d(s1.hasta, s2.desde, s2.hasta),
    d(s2.desde, s1.desde, s1.hasta),
    d(s2.hasta, s1.desde, s1.hasta)
  );
}

/**
 * Orden sugerido de plegado.
 *
 * Regla de taller: se pliegan primero las alas cortas y desde afuera hacia
 * adentro, para que la parte ya plegada no choque contra el puente de la
 * máquina. Cada paso dice qué queda en la mano del operario.
 */
export function secuenciaSugerida(tramos, pliegues) {
  if (!pliegues.length) return [];
  const items = pliegues.map((p, i) => ({
    pliegue: p.indice,
    grados: p.grados,
    sentido: p.sentido,
    // "Longitud que sobresale" al plegar este: la suma de los tramos del lado
    // más corto. Cuanto más corta, antes conviene hacerla.
    voladizo: Math.min(
      tramos.slice(0, i + 1).reduce((s, v) => s + v, 0),
      tramos.slice(i + 1).reduce((s, v) => s + v, 0)
    ),
  }));
  items.sort((a, b) => a.voladizo - b.voladizo);
  return items.map((it, n) => ({
    paso: n + 1,
    pliegue: it.pliegue,
    grados: it.grados,
    sentido: it.sentido,
    voladizo: it.voladizo,
    nota: n === 0 ? 'Empezar por acá: es el ala más corta' : null,
  }));
}

/* ------------------------------------------------------------------ */
/* Plantillas listas                                                   */
/* ------------------------------------------------------------------ */

/**
 * Perfiles habituales, para no empezar de cero. Son los que más se piden.
 */
export const PLANTILLAS = [
  {
    id: 'l', nombre: 'Ángulo (L)', descripcion: 'Un pliegue. Marcos, refuerzos, remates.',
    perfil: { tramos: [50, 50], angulos: [{ grados: 90, sentido: 'arriba' }] },
  },
  {
    id: 'u', nombre: 'Canal (U)', descripcion: 'Dos pliegues al mismo lado. Bases, guías.',
    perfil: { tramos: [40, 100, 40], angulos: [{ grados: 90, sentido: 'arriba' }, { grados: 90, sentido: 'arriba' }] },
  },
  {
    id: 'z', nombre: 'Perfil Z', descripcion: 'Dos pliegues opuestos. Desniveles, clips.',
    perfil: { tramos: [40, 80, 40], angulos: [{ grados: 90, sentido: 'arriba' }, { grados: 90, sentido: 'abajo' }] },
  },
  {
    id: 'omega', nombre: 'Omega / sombrero', descripcion: 'Cuatro pliegues con pestañas de fijación.',
    perfil: {
      tramos: [25, 40, 60, 40, 25],
      angulos: [
        { grados: 90, sentido: 'arriba' }, { grados: 90, sentido: 'abajo' },
        { grados: 90, sentido: 'abajo' }, { grados: 90, sentido: 'arriba' },
      ],
    },
  },
  {
    id: 'cajon', nombre: 'Cajón abierto', descripcion: 'U con pestañas hacia adentro. Bandejas, tapas.',
    perfil: {
      tramos: [15, 50, 200, 50, 15],
      angulos: [
        { grados: 90, sentido: 'abajo' }, { grados: 90, sentido: 'arriba' },
        { grados: 90, sentido: 'arriba' }, { grados: 90, sentido: 'abajo' },
      ],
    },
  },
  {
    // Las cotas están puestas para que sean plegables de verdad con matriz
    // estándar en 1,5-2 mm: el ala final de 12 mm no llegaba al ala mínima
    // (12,4 mm con V16) y la plantilla salía con error.
    id: 'goterron', nombre: 'Goterón', descripcion: 'Remate de chapa con vuelta antigoteo.',
    perfil: {
      tramos: [30, 120, 25, 20],
      angulos: [
        { grados: 90, sentido: 'arriba' }, { grados: 90, sentido: 'abajo' },
        { grados: 135, sentido: 'abajo' },
      ],
    },
  },
  {
    id: 'cierre', nombre: 'Canto rebatido', descripcion: 'Borde doblado 135° para no dejar filo. Sin herramienta especial.',
    perfil: {
      tramos: [20, 150, 20],
      angulos: [{ grados: 135, sentido: 'arriba' }, { grados: 135, sentido: 'abajo' }],
    },
    // Un canto cerrado de verdad (180°, "hem") no se hace al aire: necesita
    // herramienta de aplastado y va en dos pasadas. Si algún día se agrega
    // como proceso, va acá con su propia validación.
  },
];

export function desdePlantilla(id, base = {}) {
  const p = PLANTILLAS.find((x) => x.id === id);
  const nuevo = perfilNuevo();
  if (!p) return { ...nuevo, ...base };
  return {
    ...nuevo,
    ...base,
    tramos: [...p.perfil.tramos],
    angulos: p.perfil.angulos.map((a) => ({ ...a })),
  };
}

/* ------------------------------------------------------------------ */
/* Edición                                                             */
/* ------------------------------------------------------------------ */

/** Agrega un tramo al final, con su pliegue. */
export function agregarTramo(perfil, largo = 50, grados = 90, sentido = 'arriba') {
  return {
    ...perfil,
    tramos: [...perfil.tramos, largo],
    angulos: [...perfil.angulos, { grados, sentido }],
  };
}

/** Quita el tramo `i` y el pliegue que lo unía. */
export function quitarTramo(perfil, i) {
  if (perfil.tramos.length <= 2) return perfil; // menos de dos tramos no es un perfil
  const tramos = perfil.tramos.filter((_, k) => k !== i);
  const angulos = perfil.angulos.filter((_, k) => k !== Math.min(i, perfil.angulos.length - 1));
  return { ...perfil, tramos, angulos };
}

/** Invierte el sentido de un pliegue. */
export function invertirPliegue(perfil, i) {
  const angulos = perfil.angulos.map((a, k) =>
    k === i ? { ...a, sentido: a.sentido === 'arriba' ? 'abajo' : 'arriba' } : a
  );
  return { ...perfil, angulos };
}

export { deg, rad };
