/**
 * KORT - Motor de plegado CNC
 *
 * Calcula el desarrollo (flat pattern), la matriz V adecuada, el radio interno
 * resultante, el tonelaje requerido, el ala mínima plegable y valida que la
 * pieza entre en la plegadora antes de que salga cortada de la láser.
 *
 * Referencias del modelo:
 *   BA  (bend allowance)  = (π/180) · Aº · (Ri + K·T)
 *   OSSB (outside setback)= tan(Aº/2) · (Ri + T)
 *   BD  (bend deduction)  = 2·OSSB − BA
 *   Desarrollo            = Σ cotas exteriores − Σ BD
 *   Fuerza al aire        = C · Rm · T² / V   [kN por metro de pliegue]
 */

import { rad, deg } from './geometry.js';
import { C_AIRE, revisarPlegadoMetalurgico } from './metalurgia.js';

/** Matrices V disponibles en el taller (editable en Configuración). */
export const MATRICES_V = [4, 6, 8, 10, 12, 16, 20, 25, 30, 35, 40, 50, 60, 80, 100];

/**
 * Constante de plegado al aire.
 *
 * ⚠️ Era 1,33 y pasó a 1,42 el 2026-08-28. 1,33 está en el extremo bajo del
 * rango que se usa en la industria (1,33–1,42) y por lo tanto **subestimaba el
 * tonelaje alrededor de un 7 %**, que es la dirección peligrosa: el sistema
 * decía que el pliegue entraba en la plegadora y en la máquina no entra.
 * La justificación y la verificación están en `metalurgia.js`.
 */
export const C_PLEGADO = C_AIRE;

/**
 * Selecciona la matriz V recomendada para un espesor.
 * Regla de taller: V ≈ 8·T hasta 3 mm, 10·T de 3 a 8, 12·T por encima.
 */
export function matrizRecomendada(t, matrices = MATRICES_V) {
  const objetivo = t <= 3 ? 8 * t : t <= 8 ? 10 * t : 12 * t;
  let best = matrices[0];
  let bd = Infinity;
  for (const v of matrices) {
    const d = Math.abs(v - objetivo);
    if (d < bd) {
      bd = d;
      best = v;
    }
  }
  return best;
}

/** Radio interno que produce el plegado al aire con una matriz V dada. */
export function radioInterno(V, material) {
  // 0.16·V para acero; los materiales más dúctiles recuperan menos.
  const f = (material?.familia || '').toLowerCase().includes('alumin') ? 0.17 : 0.16;
  return f * V;
}

/** Ala mínima plegable (desde el borde hasta la línea de plegado). */
export function alaMinima(V, t) {
  return 0.65 * V + t;
}

/** K-factor efectivo: crece con la relación radio/espesor. */
export function kFactorEfectivo(Ri, t, kBase = 0.42) {
  const ratio = Ri / Math.max(t, 1e-6);
  // Aproximación de tabla: K≈0.33 para R/T<1, tiende a 0.5 para R/T grande.
  if (ratio < 0.5) return Math.min(kBase, 0.33);
  if (ratio >= 5) return Math.min(0.5, kBase + 0.08);
  const k = 0.33 + ((ratio - 0.5) / 4.5) * (0.5 - 0.33);
  return (k + kBase) / 2;
}

/**
 * Cálculo completo de un pliegue.
 * @param {number} t        espesor mm
 * @param {number} anguloDoblado  grados de doblado (90 = escuadra)
 * @param {Object} material
 * @param {number} [V]      matriz forzada; si no se pasa, se recomienda
 * @param {number} largoMM  largo del pliegue (para tonelaje)
 */
export function calcularPliegue(t, anguloDoblado, material, V = null, largoMM = 1000) {
  const matriz = V || matrizRecomendada(t);
  const Ri = radioInterno(matriz, material);
  const K = kFactorEfectivo(Ri, t, material?.kFactor ?? 0.42);
  const A = Math.abs(anguloDoblado);
  const BA = rad(A) * (Ri + K * t);
  const OSSB = Math.tan(rad(A) / 2) * (Ri + t);
  const BD = 2 * OSSB - BA;
  const Rm = material?.Rm ?? 400;
  const kNporMetro = (C_PLEGADO * Rm * t * t) / matriz;
  const toneladasPorMetro = kNporMetro / 9.80665;
  const toneladas = (toneladasPorMetro * largoMM) / 1000;
  return {
    matrizV: matriz,
    radioInterno: Ri,
    kFactor: K,
    BA,
    OSSB,
    BD,
    anguloDoblado: A,
    alaMinima: alaMinima(matriz, t),
    toneladasPorMetro,
    toneladas,
    largoMM,
  };
}

/**
 * Desarrollo de una pieza plegada.
 * @param {number[]} cotasExteriores  ej: [50, 200, 50] para una U
 * @param {number[]} angulos          ej: [90, 90] (uno menos que las cotas)
 */
export function calcularDesarrollo(cotasExteriores, angulos, t, material, V = null, largoMM = 1000) {
  const pliegues = [];
  let sumaBD = 0;
  for (let i = 0; i < angulos.length; i++) {
    const p = calcularPliegue(t, angulos[i], material, V, largoMM);
    pliegues.push(p);
    sumaBD += p.BD;
  }
  const sumaCotas = cotasExteriores.reduce((a, b) => a + b, 0);
  return {
    desarrollo: sumaCotas - sumaBD,
    sumaCotas,
    sumaBD,
    pliegues,
    cantidadPliegues: angulos.length,
  };
}

/**
 * Verificaciones de fabricabilidad. Devuelve avisos que la interfaz muestra
 * ANTES de cotizar, para no prometer algo que la plegadora no puede hacer.
 */
export function validarPlegado({ t, material, pliegues = [], largoMM = 0, alas = [] }, plegadora) {
  const avisos = [];
  if (!pliegues.length) return avisos;

  const maxTon = Math.max(...pliegues.map((p) => p.toneladas));
  if (plegadora && maxTon > plegadora.toneladas) {
    avisos.push({
      nivel: 'error',
      msg: `Requiere ${maxTon.toFixed(1)} t y la plegadora tiene ${plegadora.toneladas} t. Reducí el largo del pliegue, usá una matriz V mayor o plegá en pasadas.`,
    });
  } else if (plegadora && maxTon > plegadora.toneladas * 0.85) {
    avisos.push({
      nivel: 'aviso',
      msg: `Trabajando al ${((maxTon / plegadora.toneladas) * 100).toFixed(0)} % del tonelaje disponible (${maxTon.toFixed(1)} t).`,
    });
  }

  if (plegadora && largoMM > plegadora.largoUtil) {
    avisos.push({
      nivel: 'error',
      msg: `Pliegue de ${largoMM} mm supera el largo útil de la plegadora (${plegadora.largoUtil} mm).`,
    });
  }

  const alaMin = pliegues[0]?.alaMinima ?? 0;
  for (const a of alas) {
    if (a > 0 && a < alaMin) {
      avisos.push({
        nivel: 'error',
        msg: `Ala de ${a} mm menor al mínimo plegable de ${alaMin.toFixed(1)} mm (matriz V${pliegues[0].matrizV}). Usá una matriz más chica o rediseñá la pieza.`,
      });
    }
  }

  /* Radio mínimo contra la tabla metalúrgica por aleación y temple, en vez de
     las tres reglas por familia que había acá.

     La diferencia no es cosmética: "aluminio con Ri < 2·t" trataba igual al
     5052-H32 —que dobla a 1·t sin problema— y al 6061-T6, que necesita 3 a
     6·t y se FISURA por debajo. Dos aleaciones con el mismo aviso cuando una
     está bien y la otra se rompe. Y era aviso, no error, así que la pieza
     salía a producción igual. */
  const Ri = pliegues[0]?.radioInterno ?? 0;
  avisos.push(...revisarPlegadoMetalurgico({ material, espesor: t, radioInterno: Ri }));

  if (material?.id === 'galvanizado' && Ri < 1.5 * t) {
    // El acero de abajo aguanta; lo que se descascara es el zinc. Es un
    // problema de terminación y no de rotura, así que sigue siendo aviso.
    avisos.push({ nivel: 'aviso', msg: 'Galvanizado con radio chico: el zinc puede descascararse en el pliegue.' });
  }
  if ((material?.familia || '').toLowerCase().includes('inox') && Ri < 1.2 * t) {
    avisos.push({ nivel: 'aviso', msg: 'Inoxidable con radio ajustado: mayor recuperación elástica, prever sobredoblado.' });
  }
  return avisos;
}

/**
 * Secuencia de plegado sugerida.
 * Heurística de taller: se pliegan primero las alas cortas y desde el centro
 * hacia afuera, para que la pieza no choque contra la máquina.
 */
export function secuenciaPlegado(alas) {
  const idx = alas.map((a, i) => ({ i, a }));
  idx.sort((x, y) => x.a - y.a);
  return idx.map((o, n) => ({ paso: n + 1, pliegue: o.i + 1, ala: o.a }));
}

/**
 * Tiempo de plegado de un lote.
 * @param {number} cantidad
 * @param {number} pliegues  pliegues por pieza
 * @param {number} largoPliegue mm
 * @param {number} pesoPieza kg
 * @param {number} herramentales cantidad de cambios de herramienta
 */
export function tiempoPlegado(cantidad, pliegues, largoPliegue, pesoPieza, plegadora, herramentales = 1) {
  const tSetup = (plegadora.tiempoSetupHerramienta || 0) * Math.max(1, herramentales);
  const porPliegue =
    (plegadora.tiempoPorPliegue || 6) +
    (plegadora.factorLargo || 0) * largoPliegue +
    (plegadora.factorPeso || 0) * Math.max(0, pesoPieza);
  // Curva de aprendizaje: las primeras piezas salen más lentas.
  const factorAprendizaje = cantidad > 1 ? 1 + 0.35 / Math.sqrt(cantidad) : 1.35;
  const tPieza = porPliegue * pliegues * factorAprendizaje;
  return {
    tSetup,
    tPieza,
    tProduccion: tPieza * cantidad,
    tTotal: tSetup + tPieza * cantidad,
    porPliegue,
  };
}

/**
 * Genera la línea de plegado para el DXF (capa PLEGADO, no se corta).
 * Devuelve segmentos punteados con la cota y el ángulo anotados.
 */
export function lineasPlegado(desarrolloX, largo, y0 = 0) {
  return desarrolloX.map((x, i) => ({
    x,
    y1: y0,
    y2: y0 + largo,
    label: `PLIEGUE ${i + 1}`,
  }));
}

export { deg, rad };
