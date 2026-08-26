/**
 * KORT - Micro-uniones
 *
 * Una pieza chica se cae entre los dientes de la parrilla, se marca con la
 * escoria o se pierde. En la máquina se resuelve dejando pequeños tramos sin
 * cortar (tabs / micro-joints) y quebrándolos después. Esto NO cambia el
 * diseño de la pieza: cambia el DXF de producción.
 */

import { partesDe, pathBBox, shapeArea, shapeBBox, shapeCutLength, shapePiercings } from './geometry.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const n = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);

export const MICRO_UNIONES_DEFAULT = {
  modo: 'auto',
  anchoMM: 0,
  segundosPorUnion: 5,
  maxPesoKg: 0.08,
  maxDimensionMM: 120,
  maxAreaMM2: 10000,
  minRectaMM: 18,
};

export function anchoMicroUnion(espesor, ancho = 0) {
  if (ancho > 0) return clamp(ancho, 0.25, 1.2);
  // Regla de taller para fibra fina: lo bastante chico para quebrar a mano,
  // lo bastante grande para que no se suelte con la vibración.
  return clamp(n(espesor, 1.5) * 0.25, 0.35, 0.8);
}

function pesoKg(areaMM2, espesor, densidad) {
  return (areaMM2 * n(espesor) * n(densidad, 7.85)) / 1e6;
}

export function necesitaMicroUniones(shape, { espesor = 1.5, material = null, cantidad = 1, opts = {} } = {}) {
  const cfg = { ...MICRO_UNIONES_DEFAULT, ...opts };
  const b = shapeBBox(shape);
  const area = shapeArea(shape);
  const peso = pesoKg(area, espesor, material?.densidad);
  const maxDim = Math.max(b.w, b.h);

  if (cantidad <= 0) return { necesita: false, motivo: 'sin cantidad' };
  if (peso <= cfg.maxPesoKg) return { necesita: true, motivo: `peso ${peso.toFixed(3)} kg` };
  if (maxDim <= cfg.maxDimensionMM) return { necesita: true, motivo: `pieza chica (${maxDim.toFixed(0)} mm)` };
  if (area <= cfg.maxAreaMM2) return { necesita: true, motivo: `área ${(area / 100).toFixed(0)} cm²` };
  return { necesita: false, motivo: 'pieza suficientemente grande' };
}

function largoLinea(s) {
  return s.t === 'L' ? Math.hypot(s.x2 - s.x1, s.y2 - s.y1) : 0;
}

function tabsPorParte(parte, ancho, minRecta) {
  const candidatos = [];
  const b = pathBBox(parte.outer);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;

  parte.outer.segs.forEach((s, segIndex) => {
    const L = largoLinea(s);
    if (L < Math.max(minRecta, ancho * 6)) return;
    const mx = (s.x1 + s.x2) / 2;
    const my = (s.y1 + s.y2) / 2;
    // Los tabs en lados opuestos sostienen mejor que dos pegados. Por eso se
    // favorecen los puntos lejos del centro.
    const distanciaCentro = Math.hypot(mx - cx, my - cy);
    candidatos.push({ segIndex, largo: L, offset: L / 2, score: L + distanciaCentro * 0.35 });
  });

  candidatos.sort((a, b) => b.score - a.score);
  return candidatos.slice(0, 2).map((c) => ({ ...c, ancho }));
}

export function planificarMicroUniones(shape, { espesor = 1.5, material = null, cantidad = 1, modo = 'auto', anchoMM = 0 } = {}) {
  const cfg = MICRO_UNIONES_DEFAULT;
  if (modo === 'no' || modo === false) return { activa: false, motivo: 'desactivadas', uniones: [] };

  const necesidad =
    modo === 'si' || modo === true
      ? { necesita: true, motivo: 'forzado' }
      : necesitaMicroUniones(shape, { espesor, material, cantidad, opts: cfg });

  if (!necesidad.necesita) return { activa: false, motivo: necesidad.motivo, uniones: [] };

  const ancho = anchoMicroUnion(espesor, anchoMM);
  const uniones = [];
  for (const [parteIndex, parte] of partesDe(shape).entries()) {
    for (const u of tabsPorParte(parte, ancho, cfg.minRectaMM)) uniones.push({ parteIndex, ...u });
  }

  if (!uniones.length) {
    return { activa: false, motivo: 'no hay rectas suficientes para poner puentes', uniones: [] };
  }

  const largoAhorrado = uniones.reduce((a, u) => a + u.ancho, 0);
  const segundosDesbarbado = uniones.length * cfg.segundosPorUnion * Math.max(1, Math.round(cantidad));
  return {
    activa: true,
    motivo: necesidad.motivo,
    ancho,
    uniones,
    cantidadUniones: uniones.length,
    largoAhorrado,
    segundosDesbarbado,
  };
}

function cortarLinea(s, tab) {
  const L = largoLinea(s);
  if (L <= 0) return [s];
  const mitad = tab.ancho / 2;
  const a = clamp((tab.offset - mitad) / L, 0, 1);
  const b = clamp((tab.offset + mitad) / L, 0, 1);
  if (b <= 0 || a >= 1 || b - a <= 1e-6) return [s];

  const p = (t) => [s.x1 + (s.x2 - s.x1) * t, s.y1 + (s.y2 - s.y1) * t];
  const out = [];
  if (a > 1e-6) {
    const [x2, y2] = p(a);
    out.push({ ...s, x2, y2 });
  }
  if (b < 1 - 1e-6) {
    const [x1, y1] = p(b);
    out.push({ ...s, x1, y1 });
  }
  return out;
}

function aplicarAPath(path, tabs = []) {
  if (!tabs.length) return path;
  const porSeg = new Map();
  for (const t of tabs) {
    if (!porSeg.has(t.segIndex)) porSeg.set(t.segIndex, []);
    porSeg.get(t.segIndex).push(t);
  }
  const segs = [];
  path.segs.forEach((s, segIndex) => {
    const tabsSeg = (porSeg.get(segIndex) || []).sort((a, b) => a.offset - b.offset);
    if (s.t !== 'L' || !tabsSeg.length) {
      segs.push(s);
      return;
    }
    // Hoy se pone como máximo un puente por recta. Si se amplía, este bloque
    // tiene que partir por intervalos no solapados.
    segs.push(...cortarLinea(s, tabsSeg[0]));
  });
  return { ...path, segs };
}

export function aplicarMicroUniones(shape, plan) {
  if (!plan?.activa || !plan.uniones?.length) return shape;
  const partes = partesDe(shape).map((parte, parteIndex) => ({
    outer: aplicarAPath(parte.outer, plan.uniones.filter((u) => u.parteIndex === parteIndex)),
    holes: parte.holes || [],
  }));
  return {
    ...shape,
    partes,
    outer: partes[0]?.outer || shape.outer,
    holes: partes[0]?.holes || shape.holes || [],
    microUnionesAplicadas: plan,
  };
}

export function explicarMicroUniones(plan) {
  if (!plan?.activa) return '';
  return `${plan.cantidadUniones} ${plan.cantidadUniones === 1 ? 'micro-unión' : 'micro-uniones'} de ${plan.ancho.toFixed(2)} mm`;
}

