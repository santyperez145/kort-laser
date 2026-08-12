/**
 * KORT - Biblioteca de piezas paramétricas
 *
 * Cada pieza se define una sola vez con sus parámetros y el sistema genera
 * automáticamente: la interfaz del formulario, la geometría 2D, el desarrollo
 * plegado, el modelo 3D, el DXF y la cotización. Agregar una pieza nueva es
 * agregar un objeto a este archivo.
 *
 * Incluye desarrollos de calderería (cono, virola, codo segmentado) que son
 * los trabajos que más se cobran y los que más tiempo llevan dibujar a mano.
 */

import {
  rect, circle, slot, polyline, regularPolygon, line, arc, makeShape,
  transformPath, normalizeShape, rad, deg, TAU, pathBBox,
} from './geometry.js';
import { calcularDesarrollo, matrizRecomendada, radioInterno, kFactorEfectivo } from './bending.js';

/* ------------------------------------------------------------------ */
/* Helpers de patrones de agujeros                                     */
/* ------------------------------------------------------------------ */

/** Grilla de agujeros centrada en (cx,cy). */
export function grillaAgujeros(cx, cy, cols, filas, pasoX, pasoY, dia) {
  const out = [];
  const x0 = cx - ((cols - 1) * pasoX) / 2;
  const y0 = cy - ((filas - 1) * pasoY) / 2;
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < filas; j++) out.push(circle(x0 + i * pasoX, y0 + j * pasoY, dia / 2));
  return out;
}

/** Agujeros en círculo de pernos (BCD). */
export function circuloAgujeros(cx, cy, bcd, cantidad, dia, faseDeg = 0) {
  const out = [];
  for (let i = 0; i < cantidad; i++) {
    const a = rad(faseDeg) + (i * TAU) / cantidad;
    out.push(circle(cx + (bcd / 2) * Math.cos(a), cy + (bcd / 2) * Math.sin(a), dia / 2));
  }
  return out;
}

/** Cuatro agujeros en las esquinas, a distancia `margen` de cada borde. */
export function agujerosEsquinas(w, h, margen, dia) {
  return [
    circle(margen, margen, dia / 2),
    circle(w - margen, margen, dia / 2),
    circle(w - margen, h - margen, dia / 2),
    circle(margen, h - margen, dia / 2),
  ];
}

const P = (key, label, def, extra = {}) => ({ key, label, def, tipo: 'num', ...extra });
const S = (key, label, def, opciones) => ({ key, label, def, tipo: 'sel', opciones });
const B = (key, label, def) => ({ key, label, def, tipo: 'bool' });

/* ------------------------------------------------------------------ */
/* Definiciones                                                        */
/* ------------------------------------------------------------------ */

export const PIEZAS = [
  /* ---------------------------------------------------------------- */
  {
    id: 'placa',
    nombre: 'Placa rectangular',
    categoria: 'Chapa plana',
    descripcion: 'Placa con esquinas rectas o redondeadas y patrón de agujeros configurable.',
    params: [
      P('w', 'Ancho', 200, { min: 5, unidad: 'mm' }),
      P('h', 'Alto', 150, { min: 5, unidad: 'mm' }),
      P('r', 'Radio de esquina', 10, { min: 0, unidad: 'mm' }),
      S('patron', 'Patrón de agujeros', 'esquinas', [
        { v: 'ninguno', t: 'Sin agujeros' },
        { v: 'esquinas', t: '4 en esquinas' },
        { v: 'grilla', t: 'Grilla' },
        { v: 'circulo', t: 'Círculo de pernos' },
      ]),
      P('dia', 'Diámetro de agujero', 8, { min: 0.5, unidad: 'mm' }),
      P('margen', 'Margen al borde', 15, { min: 0, unidad: 'mm' }),
      P('cols', 'Columnas (grilla)', 3, { min: 1, entero: true }),
      P('filas', 'Filas (grilla)', 2, { min: 1, entero: true }),
      P('bcd', 'Ø círculo de pernos', 100, { min: 1, unidad: 'mm' }),
      P('nBcd', 'Cantidad en círculo', 6, { min: 1, entero: true }),
      P('diaCentral', 'Ø agujero central', 0, { min: 0, unidad: 'mm' }),
    ],
    build(p) {
      const outer = rect(0, 0, p.w, p.h, p.r);
      const holes = [];
      const cx = p.w / 2;
      const cy = p.h / 2;
      if (p.patron === 'esquinas') holes.push(...agujerosEsquinas(p.w, p.h, p.margen, p.dia));
      else if (p.patron === 'grilla')
        holes.push(
          ...grillaAgujeros(cx, cy, p.cols, p.filas, (p.w - 2 * p.margen) / Math.max(1, p.cols - 1) || 0,
            (p.h - 2 * p.margen) / Math.max(1, p.filas - 1) || 0, p.dia)
        );
      else if (p.patron === 'circulo') holes.push(...circuloAgujeros(cx, cy, p.bcd, p.nBcd, p.dia));
      if (p.diaCentral > 0) holes.push(circle(cx, cy, p.diaCentral / 2));
      return { shape: makeShape(outer, holes), modelo3D: { tipo: 'plano' } };
    },
  },

  /* ---------------------------------------------------------------- */
  {
    id: 'disco',
    nombre: 'Disco / brida circular',
    categoria: 'Chapa plana',
    descripcion: 'Disco con agujero central y círculo de pernos. Bridas, tapas, arandelas grandes.',
    params: [
      P('dia', 'Ø exterior', 200, { min: 5, unidad: 'mm' }),
      P('diaInt', 'Ø interior', 80, { min: 0, unidad: 'mm' }),
      P('bcd', 'Ø círculo de pernos', 150, { min: 0, unidad: 'mm' }),
      P('nAgujeros', 'Cantidad de agujeros', 8, { min: 0, entero: true }),
      P('diaAgujero', 'Ø de cada agujero', 12, { min: 0.5, unidad: 'mm' }),
      P('fase', 'Giro del patrón', 22.5, { unidad: '°' }),
      B('oblongos', 'Agujeros oblongos (regulables)', false),
      P('largoOblongo', 'Largo del oblongo', 20, { min: 1, unidad: 'mm' }),
    ],
    build(p) {
      const R = p.dia / 2;
      const outer = circle(R, R, R);
      const holes = [];
      if (p.diaInt > 0) holes.push(circle(R, R, p.diaInt / 2));
      if (p.nAgujeros > 0 && p.bcd > 0) {
        if (p.oblongos) {
          for (let i = 0; i < p.nAgujeros; i++) {
            const a = rad(p.fase) + (i * TAU) / p.nAgujeros;
            const cx = R + (p.bcd / 2) * Math.cos(a);
            const cy = R + (p.bcd / 2) * Math.sin(a);
            holes.push(slot(cx, cy, p.largoOblongo, p.diaAgujero, deg(a)));
          }
        } else holes.push(...circuloAgujeros(R, R, p.bcd, p.nAgujeros, p.diaAgujero, p.fase));
      }
      return { shape: makeShape(outer, holes), modelo3D: { tipo: 'plano' } };
    },
  },

  /* ---------------------------------------------------------------- */
  {
    id: 'pletina',
    nombre: 'Pletina con agujeros',
    categoria: 'Chapa plana',
    descripcion: 'Planchuela con extremos redondeados y agujeros alineados, redondos u oblongos.',
    params: [
      P('largo', 'Largo', 300, { min: 10, unidad: 'mm' }),
      P('ancho', 'Ancho', 40, { min: 5, unidad: 'mm' }),
      B('extremosRedondos', 'Extremos redondeados', true),
      P('n', 'Cantidad de agujeros', 4, { min: 0, entero: true }),
      P('dia', 'Ø agujero', 10, { min: 0.5, unidad: 'mm' }),
      P('margen', 'Distancia al extremo', 20, { min: 0, unidad: 'mm' }),
      B('oblongos', 'Oblongos', false),
      P('largoOblongo', 'Largo del oblongo', 25, { min: 1, unidad: 'mm' }),
    ],
    build(p) {
      const outer = p.extremosRedondos ? rect(0, 0, p.largo, p.ancho, p.ancho / 2) : rect(0, 0, p.largo, p.ancho, 0);
      const holes = [];
      const cy = p.ancho / 2;
      if (p.n === 1) holes.push(circle(p.largo / 2, cy, p.dia / 2));
      else if (p.n > 1) {
        const x0 = p.margen;
        const paso = (p.largo - 2 * p.margen) / (p.n - 1);
        for (let i = 0; i < p.n; i++) {
          const x = x0 + i * paso;
          holes.push(p.oblongos ? slot(x, cy, p.largoOblongo, p.dia, 0) : circle(x, cy, p.dia / 2));
        }
      }
      return { shape: makeShape(outer, holes), modelo3D: { tipo: 'plano' } };
    },
  },

  /* ---------------------------------------------------------------- */
  {
    id: 'angulo-l',
    nombre: 'Ángulo / perfil L',
    categoria: 'Plegado',
    descripcion: 'Perfil L de un pliegue. Se entrega el desarrollo plano listo para cortar.',
    params: [
      P('a', 'Ala A (exterior)', 50, { min: 3, unidad: 'mm' }),
      P('b', 'Ala B (exterior)', 40, { min: 3, unidad: 'mm' }),
      P('largo', 'Largo del perfil', 500, { min: 10, unidad: 'mm' }),
      P('angulo', 'Ángulo de plegado', 90, { min: 1, max: 170, unidad: '°' }),
      P('nAgujeros', 'Agujeros por ala', 3, { min: 0, entero: true }),
      P('dia', 'Ø agujero', 9, { min: 0.5, unidad: 'mm' }),
      P('margenAgujero', 'Agujero al borde del ala', 20, { min: 0, unidad: 'mm' }),
    ],
    build(p, ctx) {
      const t = ctx.espesor;
      const mat = ctx.material;
      const dev = calcularDesarrollo([p.a, p.b], [p.angulo], t, mat, null, p.largo);
      const W = dev.desarrollo;
      const outer = rect(0, 0, W, p.largo, 0);
      const xPliegue = p.a - dev.pliegues[0].BD / 2;
      const holes = [];
      if (p.nAgujeros > 0) {
        const paso = p.largo / (p.nAgujeros + 1);
        for (let i = 1; i <= p.nAgujeros; i++) {
          holes.push(circle(Math.min(p.margenAgujero, xPliegue * 0.6), i * paso, p.dia / 2));
          holes.push(circle(W - Math.min(p.margenAgujero, (W - xPliegue) * 0.6), i * paso, p.dia / 2));
        }
      }
      return {
        shape: makeShape(outer, holes),
        pliegues: [{ x1: xPliegue, y1: 0, x2: xPliegue, y2: p.largo, label: `P1 ${p.angulo}°` }],
        plegado: { pliegues: 1, largoPliegue: p.largo, angulo: p.angulo, herramentales: 1 },
        desarrollo: dev,
        modelo3D: { tipo: 'perfil', tramos: [p.a, p.b], angulos: [p.angulo], ancho: p.largo },
        alas: [p.a, p.b],
      };
    },
  },

  /* ---------------------------------------------------------------- */
  {
    id: 'canal-u',
    nombre: 'Canal U / perfil C',
    categoria: 'Plegado',
    descripcion: 'Perfil U de dos pliegues. Bases, marcos, guías, refuerzos.',
    params: [
      P('alma', 'Alma (fondo)', 100, { min: 5, unidad: 'mm' }),
      P('ala', 'Alas', 40, { min: 3, unidad: 'mm' }),
      P('largo', 'Largo', 600, { min: 10, unidad: 'mm' }),
      P('angulo', 'Ángulo de plegado', 90, { min: 1, max: 170, unidad: '°' }),
      P('nAgujeros', 'Agujeros en el alma', 4, { min: 0, entero: true }),
      P('dia', 'Ø agujero', 9, { min: 0.5, unidad: 'mm' }),
      B('agujerosAlas', 'Agujeros también en las alas', false),
    ],
    build(p, ctx) {
      const t = ctx.espesor;
      const dev = calcularDesarrollo([p.ala, p.alma, p.ala], [p.angulo, p.angulo], t, ctx.material, null, p.largo);
      const W = dev.desarrollo;
      const outer = rect(0, 0, W, p.largo, 0);
      const bd = dev.pliegues[0].BD;
      const x1 = p.ala - bd / 2;
      const x2 = x1 + p.alma - bd;
      const holes = [];
      if (p.nAgujeros > 0) {
        const paso = p.largo / (p.nAgujeros + 1);
        const cxAlma = (x1 + x2) / 2;
        for (let i = 1; i <= p.nAgujeros; i++) {
          holes.push(circle(cxAlma, i * paso, p.dia / 2));
          if (p.agujerosAlas) {
            holes.push(circle(x1 / 2, i * paso, p.dia / 2));
            holes.push(circle((x2 + W) / 2, i * paso, p.dia / 2));
          }
        }
      }
      return {
        shape: makeShape(outer, holes),
        pliegues: [
          { x1, y1: 0, x2: x1, y2: p.largo, label: `P1 ${p.angulo}°` },
          { x1: x2, y1: 0, x2, y2: p.largo, label: `P2 ${p.angulo}°` },
        ],
        plegado: { pliegues: 2, largoPliegue: p.largo, angulo: p.angulo, herramentales: 1 },
        desarrollo: dev,
        modelo3D: { tipo: 'perfil', tramos: [p.ala, p.alma, p.ala], angulos: [-p.angulo, -p.angulo], ancho: p.largo },
        alas: [p.ala, p.ala],
      };
    },
  },

  /* ---------------------------------------------------------------- */
  {
    id: 'perfil-z',
    nombre: 'Perfil Z',
    categoria: 'Plegado',
    descripcion: 'Dos pliegues opuestos. Correas, soportes de desnivel, clips de montaje.',
    params: [
      P('a', 'Ala superior', 40, { min: 3, unidad: 'mm' }),
      P('alma', 'Alma', 80, { min: 5, unidad: 'mm' }),
      P('b', 'Ala inferior', 40, { min: 3, unidad: 'mm' }),
      P('largo', 'Largo', 500, { min: 10, unidad: 'mm' }),
      P('angulo', 'Ángulo', 90, { min: 1, max: 170, unidad: '°' }),
    ],
    build(p, ctx) {
      const dev = calcularDesarrollo([p.a, p.alma, p.b], [p.angulo, p.angulo], ctx.espesor, ctx.material, null, p.largo);
      const W = dev.desarrollo;
      const bd = dev.pliegues[0].BD;
      const x1 = p.a - bd / 2;
      const x2 = x1 + p.alma - bd;
      return {
        shape: makeShape(rect(0, 0, W, p.largo, 0), []),
        pliegues: [
          { x1, y1: 0, x2: x1, y2: p.largo, label: `P1 ${p.angulo}°` },
          { x1: x2, y1: 0, x2, y2: p.largo, label: `P2 -${p.angulo}°` },
        ],
        plegado: { pliegues: 2, largoPliegue: p.largo, angulo: p.angulo, herramentales: 1 },
        desarrollo: dev,
        modelo3D: { tipo: 'perfil', tramos: [p.a, p.alma, p.b], angulos: [-p.angulo, p.angulo], ancho: p.largo },
        alas: [p.a, p.b],
      };
    },
  },

  /* ---------------------------------------------------------------- */
  {
    id: 'sombrero',
    nombre: 'Perfil omega / sombrero',
    categoria: 'Plegado',
    descripcion: 'Cuatro pliegues con pestañas de fijación. Muy usado en estructuras livianas.',
    params: [
      P('pestana', 'Pestaña', 25, { min: 3, unidad: 'mm' }),
      P('alma', 'Altura del alma', 40, { min: 3, unidad: 'mm' }),
      P('techo', 'Ancho superior', 60, { min: 5, unidad: 'mm' }),
      P('largo', 'Largo', 600, { min: 10, unidad: 'mm' }),
      P('angulo', 'Ángulo', 90, { min: 1, max: 170, unidad: '°' }),
    ],
    build(p, ctx) {
      const tramos = [p.pestana, p.alma, p.techo, p.alma, p.pestana];
      const ang = [p.angulo, p.angulo, p.angulo, p.angulo];
      const dev = calcularDesarrollo(tramos, ang, ctx.espesor, ctx.material, null, p.largo);
      const W = dev.desarrollo;
      const bd = dev.pliegues[0].BD;
      let x = 0;
      const pliegues = [];
      for (let i = 0; i < tramos.length - 1; i++) {
        x += tramos[i] - bd / (i === 0 ? 2 : 1) - (i === 0 ? 0 : bd / 2 - bd / 2);
        pliegues.push({ x1: x, y1: 0, x2: x, y2: p.largo, label: `P${i + 1}` });
      }
      return {
        shape: makeShape(rect(0, 0, W, p.largo, 0), []),
        pliegues,
        plegado: { pliegues: 4, largoPliegue: p.largo, angulo: p.angulo, herramentales: 1 },
        desarrollo: dev,
        modelo3D: { tipo: 'perfil', tramos, angulos: [p.angulo, -p.angulo, -p.angulo, p.angulo], ancho: p.largo },
        alas: [p.pestana, p.pestana],
      };
    },
  },

  /* ---------------------------------------------------------------- */
  {
    id: 'bandeja',
    nombre: 'Bandeja / caja abierta',
    categoria: 'Cajas',
    descripcion:
      'Bandeja de 4 lados con alivios en esquina. Es la pieza plegada más pedida: gabinetes, tapas, bateas, contenedores.',
    params: [
      P('L', 'Largo interior', 300, { min: 10, unidad: 'mm' }),
      P('A', 'Ancho interior', 200, { min: 10, unidad: 'mm' }),
      P('H', 'Altura de pared', 60, { min: 3, unidad: 'mm' }),
      S('esquina', 'Alivio de esquina', 'redondo', [
        { v: 'redondo', t: 'Redondo (recomendado)' },
        { v: 'recto', t: 'Recto' },
        { v: 'ninguno', t: 'Sin alivio (para soldar)' },
      ]),
      P('pestana', 'Pestaña de cierre (0 = sin)', 0, { min: 0, unidad: 'mm' }),
      P('diaFijacion', 'Ø agujeros de fijación en el fondo', 0, { min: 0, unidad: 'mm' }),
      P('margenFijacion', 'Margen de fijación', 20, { min: 0, unidad: 'mm' }),
    ],
    build(p, ctx) {
      const t = ctx.espesor;
      const mat = ctx.material;
      const V = matrizRecomendada(t);
      const Ri = radioInterno(V, mat);
      const K = kFactorEfectivo(Ri, t, mat.kFactor);
      const BA = rad(90) * (Ri + K * t);
      const OSSB = Math.tan(rad(45)) * (Ri + t);
      const BD = 2 * OSSB - BA;

      // Desarrollo: fondo + dos paredes por eje, menos la deducción de cada pliegue
      const W = p.L + 2 * p.H - 2 * BD;
      const Hh = p.A + 2 * p.H - 2 * BD;
      const ox = p.H - BD / 2; // línea de plegado desde el borde
      const oy = p.H - BD / 2;

      const alivio = p.esquina === 'ninguno' ? 0 : Math.max(t * 1.5, Ri + t);
      const pts = [];
      const push = (x, y) => pts.push([x, y]);

      // Contorno en cruz con alivios de esquina
      push(ox, 0);
      push(W - ox, 0);
      push(W - ox, oy - alivio);
      push(W, oy - alivio);
      push(W, Hh - oy + alivio);
      push(W - ox, Hh - oy + alivio);
      push(W - ox, Hh);
      push(ox, Hh);
      push(ox, Hh - oy + alivio);
      push(0, Hh - oy + alivio);
      push(0, oy - alivio);
      push(ox, oy - alivio);

      let outer;
      if (p.esquina === 'redondo' && alivio > 0) {
        // Reemplaza las 8 esquinas internas por arcos de radio `alivio`
        outer = cruzConAlivios(W, Hh, ox, oy, alivio);
      } else {
        outer = polyline(pts, true);
      }

      const holes = [];
      if (p.diaFijacion > 0) {
        const m = p.margenFijacion;
        const x0 = ox + m;
        const y0 = oy + m;
        const x1 = W - ox - m;
        const y1 = Hh - oy - m;
        for (const [x, y] of [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]) holes.push(circle(x, y, p.diaFijacion / 2));
      }

      const pliegues = [
        { x1: ox, y1: oy - alivio, x2: ox, y2: Hh - oy + alivio, label: 'P1 90°' },
        { x1: W - ox, y1: oy - alivio, x2: W - ox, y2: Hh - oy + alivio, label: 'P2 90°' },
        { x1: ox, y1: oy, x2: W - ox, y2: oy, label: 'P3 90°' },
        { x1: ox, y1: Hh - oy, x2: W - ox, y2: Hh - oy, label: 'P4 90°' },
      ];

      return {
        shape: makeShape(outer, holes),
        pliegues,
        plegado: { pliegues: 4, largoPliegue: Math.max(p.L, p.A), angulo: 90, herramentales: 1 },
        desarrollo: { desarrollo: W, sumaBD: 2 * BD, cantidadPliegues: 4, pliegues: [{ matrizV: V, radioInterno: Ri, BD, kFactor: K, alaMinima: 0.65 * V + t, toneladas: 0 }] },
        modelo3D: { tipo: 'bandeja', L: p.L, A: p.A, H: p.H, t },
        alas: [p.H, p.H],
        avisos:
          p.H < 0.65 * V + t
            ? [{ nivel: 'error', msg: `Pared de ${p.H} mm menor al ala mínima plegable (${(0.65 * V + t).toFixed(1)} mm con matriz V${V}).` }]
            : [],
      };
    },
  },

  /* ---------------------------------------------------------------- */
  {
    id: 'escuadra',
    nombre: 'Escuadra de refuerzo',
    categoria: 'Plegado',
    descripcion: 'Ángulo con nervio triangular. Soportes de estante, ménsulas, refuerzos estructurales.',
    params: [
      P('a', 'Ala A', 120, { min: 10, unidad: 'mm' }),
      P('b', 'Ala B', 120, { min: 10, unidad: 'mm' }),
      P('ancho', 'Ancho de la escuadra', 60, { min: 10, unidad: 'mm' }),
      P('dia', 'Ø agujeros', 9, { min: 0, unidad: 'mm' }),
      P('nPorAla', 'Agujeros por ala', 2, { min: 0, entero: true }),
      P('recorte', 'Recorte diagonal del ala (0 = recto)', 0, { min: 0, unidad: 'mm' }),
    ],
    build(p, ctx) {
      const dev = calcularDesarrollo([p.a, p.b], [90], ctx.espesor, ctx.material, null, p.ancho);
      const W = dev.desarrollo;
      const xP = p.a - dev.pliegues[0].BD / 2;
      let outer;
      if (p.recorte > 0) {
        outer = polyline(
          [
            [0, 0], [W, 0], [W, p.ancho - p.recorte], [W - p.recorte, p.ancho],
            [p.recorte, p.ancho], [0, p.ancho - p.recorte],
          ],
          true
        );
      } else outer = rect(0, 0, W, p.ancho, 0);
      const holes = [];
      if (p.dia > 0 && p.nPorAla > 0) {
        const put = (xc) => {
          const paso = p.ancho / (p.nPorAla + 1);
          for (let i = 1; i <= p.nPorAla; i++) holes.push(circle(xc, i * paso, p.dia / 2));
        };
        put(xP * 0.55);
        put(xP + (W - xP) * 0.45);
      }
      return {
        shape: makeShape(outer, holes),
        pliegues: [{ x1: xP, y1: 0, x2: xP, y2: p.ancho, label: 'P1 90°' }],
        plegado: { pliegues: 1, largoPliegue: p.ancho, angulo: 90, herramentales: 1 },
        desarrollo: dev,
        modelo3D: { tipo: 'perfil', tramos: [p.a, p.b], angulos: [90], ancho: p.ancho },
        alas: [p.a, p.b],
      };
    },
  },

  /* ---------------------------------------------------------------- */
  {
    id: 'panel-rack',
    nombre: 'Panel de rack 19"',
    categoria: 'Chapa plana',
    descripcion: 'Frente de rack estándar 19" con agujeros oblongos normalizados. Se pide todo el tiempo.',
    params: [
      P('u', 'Altura en U', 2, { min: 1, max: 12, entero: true }),
      B('conVentilacion', 'Con rejilla de ventilación', true),
      P('diaVent', 'Ø agujeros de ventilación', 6, { min: 1, unidad: 'mm' }),
      P('pasoVent', 'Paso de la rejilla', 12, { min: 2, unidad: 'mm' }),
    ],
    build(p) {
      const W = 482.6;
      const H = p.u * 44.45;
      const outer = rect(0, 0, W, H, 3);
      const holes = [];
      // Agujeros de montaje normalizados EIA-310: pares a 15.875 mm del centro de cada U
      const xIzq = 7.94;
      const xDer = W - 7.94;
      for (let u = 0; u < p.u; u++) {
        const base = u * 44.45;
        for (const dy of [6.35, 22.23, 38.1]) {
          holes.push(slot(xIzq, base + dy, 10, 6.6, 0));
          holes.push(slot(xDer, base + dy, 10, 6.6, 0));
        }
      }
      if (p.conVentilacion) {
        const x0 = 40;
        const x1 = W - 40;
        const y0 = 12;
        const y1 = H - 12;
        for (let y = y0; y <= y1; y += p.pasoVent) {
          const offset = (Math.round((y - y0) / p.pasoVent) % 2) * (p.pasoVent / 2);
          for (let x = x0 + offset; x <= x1; x += p.pasoVent) holes.push(circle(x, y, p.diaVent / 2));
        }
      }
      return { shape: makeShape(outer, holes), modelo3D: { tipo: 'plano' } };
    },
  },

  /* ---------------------------------------------------------------- */
  {
    id: 'rejilla',
    nombre: 'Rejilla / chapa perforada',
    categoria: 'Chapa plana',
    descripcion: 'Perforado al tresbolillo o en línea. Ojo: son muchas perforaciones, el tiempo de corte manda.',
    params: [
      P('w', 'Ancho', 300, { min: 10, unidad: 'mm' }),
      P('h', 'Alto', 200, { min: 10, unidad: 'mm' }),
      P('margen', 'Margen sin perforar', 20, { min: 0, unidad: 'mm' }),
      S('forma', 'Forma del agujero', 'circulo', [
        { v: 'circulo', t: 'Círculo' },
        { v: 'cuadrado', t: 'Cuadrado' },
        { v: 'hexagono', t: 'Hexágono' },
        { v: 'oblongo', t: 'Oblongo' },
      ]),
      P('dia', 'Tamaño del agujero', 8, { min: 0.5, unidad: 'mm' }),
      P('paso', 'Paso entre centros', 14, { min: 1, unidad: 'mm' }),
      B('tresbolillo', 'Al tresbolillo (60°)', true),
      P('r', 'Radio de esquina', 5, { min: 0, unidad: 'mm' }),
    ],
    build(p) {
      const outer = rect(0, 0, p.w, p.h, p.r);
      const holes = [];
      const x0 = p.margen;
      const x1 = p.w - p.margen;
      const y0 = p.margen;
      const y1 = p.h - p.margen;
      const pasoY = p.tresbolillo ? p.paso * Math.sin(rad(60)) : p.paso;
      let fila = 0;
      for (let y = y0; y <= y1 + 1e-6; y += pasoY) {
        const off = p.tresbolillo && fila % 2 ? p.paso / 2 : 0;
        for (let x = x0 + off; x <= x1 + 1e-6; x += p.paso) {
          if (p.forma === 'circulo') holes.push(circle(x, y, p.dia / 2));
          else if (p.forma === 'cuadrado') holes.push(rect(x - p.dia / 2, y - p.dia / 2, p.dia, p.dia, p.dia * 0.12));
          else if (p.forma === 'hexagono') holes.push(regularPolygon(x, y, p.dia / 2, 6, rad(30)));
          else holes.push(slot(x, y, p.dia * 2.5, p.dia, 0));
        }
        fila++;
      }
      return {
        shape: makeShape(outer, holes),
        modelo3D: { tipo: 'plano' },
        avisos:
          holes.length > 800
            ? [{ nivel: 'aviso', msg: `${holes.length} perforaciones: el tiempo de máquina va a ser alto. Evaluá comprar chapa perforada comercial.` }]
            : [],
      };
    },
  },

  /* ---------------------------------------------------------------- */
  {
    id: 'engranaje',
    nombre: 'Engranaje recto',
    categoria: 'Mecánica',
    descripcion: 'Perfil de involuta real. Para transmisiones lentas cortadas en chapa.',
    params: [
      P('z', 'Cantidad de dientes', 24, { min: 6, max: 200, entero: true }),
      P('modulo', 'Módulo', 3, { min: 0.5, unidad: 'mm' }),
      P('anguloPresion', 'Ángulo de presión', 20, { min: 14, max: 30, unidad: '°' }),
      P('diaEje', 'Ø del eje', 12, { min: 0, unidad: 'mm' }),
      P('chaveta', 'Ancho de chavetero (0 = sin)', 0, { min: 0, unidad: 'mm' }),
      P('nAligeramiento', 'Agujeros de aligeramiento', 0, { min: 0, entero: true }),
      P('diaAligeramiento', 'Ø aligeramiento', 20, { min: 0, unidad: 'mm' }),
    ],
    build(p) {
      const m = p.modulo;
      const z = Math.round(p.z);
      const a = rad(p.anguloPresion);
      const rp = (m * z) / 2; // primitivo
      const rb = rp * Math.cos(a); // base
      const ra = rp + m; // exterior
      const rf = rp - 1.25 * m; // raíz
      const pts = [];
      const involuta = (r) => {
        const t = Math.sqrt(Math.max(0, (r / rb) ** 2 - 1));
        return t - Math.atan(t); // ángulo de involuta
      };
      const espesorAngular = Math.PI / (2 * z) + involuta(rp) - 0; // medio diente en el primitivo
      const N = 10;
      for (let i = 0; i < z; i++) {
        const base = (i * TAU) / z;
        // Flanco ascendente
        for (let k = 0; k <= N; k++) {
          const r = Math.max(rb, rf) + ((ra - Math.max(rb, rf)) * k) / N;
          const ang = base - espesorAngular + involuta(r);
          pts.push([r * Math.cos(ang), r * Math.sin(ang)]);
        }
        // Flanco descendente (espejo)
        for (let k = N; k >= 0; k--) {
          const r = Math.max(rb, rf) + ((ra - Math.max(rb, rf)) * k) / N;
          const ang = base + espesorAngular - involuta(r);
          pts.push([r * Math.cos(ang), r * Math.sin(ang)]);
        }
        // Fondo del diente
        const next = base + TAU / z;
        for (let k = 0; k <= 4; k++) {
          const ang = base + espesorAngular + ((next - espesorAngular - (base + espesorAngular)) * k) / 4;
          pts.push([rf * Math.cos(ang), rf * Math.sin(ang)]);
        }
      }
      const outer = transformPath(polyline(pts, true), { dx: ra, dy: ra });
      const holes = [];
      if (p.diaEje > 0) {
        if (p.chaveta > 0) {
          const re = p.diaEje / 2;
          const prof = re + p.chaveta * 0.45;
          const cpts = [];
          const a0 = Math.asin(Math.min(1, p.chaveta / 2 / re));
          for (let k = 0; k <= 64; k++) {
            const ang = a0 + ((TAU - 2 * a0) * k) / 64;
            cpts.push([ra + re * Math.cos(ang), ra + re * Math.sin(ang)]);
          }
          cpts.push([ra + re * Math.cos(-a0), ra - p.chaveta / 2]);
          cpts.push([ra + prof, ra - p.chaveta / 2]);
          cpts.push([ra + prof, ra + p.chaveta / 2]);
          holes.push(polyline(cpts, true));
        } else holes.push(circle(ra, ra, p.diaEje / 2));
      }
      if (p.nAligeramiento > 0 && p.diaAligeramiento > 0) {
        const bcd = (rf + Math.max(p.diaEje / 2, 10)) * 0.95;
        holes.push(...circuloAgujeros(ra, ra, bcd, p.nAligeramiento, p.diaAligeramiento));
      }
      return {
        shape: makeShape(outer, holes),
        modelo3D: { tipo: 'plano' },
        info: { primitivo: 2 * rp, exterior: 2 * ra, raiz: 2 * rf, distanciaEntreEjes: `con z2 dientes: m·(z1+z2)/2` },
      };
    },
  },

  /* ---------------------------------------------------------------- */
  {
    id: 'cono',
    nombre: 'Desarrollo de cono truncado',
    categoria: 'Calderería',
    descripcion:
      'Tolvas, embudos, reducciones. Genera el sector anular exacto con la pestaña de costura: dibujarlo a mano lleva media hora.',
    params: [
      P('d1', 'Ø mayor', 400, { min: 10, unidad: 'mm' }),
      P('d2', 'Ø menor', 150, { min: 1, unidad: 'mm' }),
      P('h', 'Altura', 300, { min: 5, unidad: 'mm' }),
      P('costura', 'Pestaña de costura', 15, { min: 0, unidad: 'mm' }),
      P('partes', 'Dividir en N partes', 1, { min: 1, max: 8, entero: true }),
    ],
    build(p, ctx) {
      const t = ctx.espesor || 1;
      // Desarrollo por la fibra neutra (mitad del espesor)
      const d1 = p.d1 - t;
      const d2 = p.d2 - t;
      if (Math.abs(d1 - d2) < 1e-6) {
        return {
          shape: makeShape(rect(0, 0, Math.PI * d1 + 2 * p.costura, p.h, 0), []),
          avisos: [{ nivel: 'info', msg: 'Diámetros iguales: es una virola cilíndrica, no un cono.' }],
          modelo3D: { tipo: 'revolucion', d1: p.d1, d2: p.d2, h: p.h },
        };
      }
      const L = Math.sqrt(p.h ** 2 + ((d1 - d2) / 2) ** 2); // generatriz
      const R1 = (L * d1) / (d1 - d2);
      const R2 = R1 - L;
      const anguloTotal = (Math.PI * d1) / R1; // radianes
      const ang = anguloTotal / p.partes;

      const a0 = -ang / 2;
      const a1 = ang / 2;
      const segs = [
        arc(0, 0, R1, a0, a1, true),
        line(R2 * Math.cos(a1), R2 * Math.sin(a1), R1 * Math.cos(a1), R1 * Math.sin(a1)),
      ];
      // Construye el sector: arco exterior, lado, arco interior invertido, lado
      const pts = [];
      const N = Math.max(24, Math.ceil((ang / TAU) * 180));
      for (let i = 0; i <= N; i++) {
        const a = a0 + ((a1 - a0) * i) / N;
        pts.push([R1 * Math.cos(a), R1 * Math.sin(a)]);
      }
      for (let i = N; i >= 0; i--) {
        const a = a0 + ((a1 - a0) * i) / N;
        pts.push([R2 * Math.cos(a), R2 * Math.sin(a)]);
      }
      let outer = polyline(pts, true);
      if (p.costura > 0) {
        // Se agrega la pestaña extendiendo angularmente el sector
        const extra = p.costura / R1;
        const pts2 = [];
        const b0 = a0 - extra;
        const b1 = a1 + extra;
        const M = Math.max(24, Math.ceil(((b1 - b0) / TAU) * 180));
        for (let i = 0; i <= M; i++) {
          const a = b0 + ((b1 - b0) * i) / M;
          pts2.push([R1 * Math.cos(a), R1 * Math.sin(a)]);
        }
        for (let i = M; i >= 0; i--) {
          const a = b0 + ((b1 - b0) * i) / M;
          pts2.push([R2 * Math.cos(a), R2 * Math.sin(a)]);
        }
        outer = polyline(pts2, true);
      }
      const sh = normalizeShape(makeShape(outer, []), 0);
      const b = pathBBox(sh.outer);
      return {
        shape: sh,
        modelo3D: { tipo: 'revolucion', d1: p.d1, d2: p.d2, h: p.h },
        info: {
          generatriz: L,
          radioMayor: R1,
          radioMenor: R2,
          anguloDesarrollo: deg(anguloTotal),
          partes: p.partes,
          desarrolloAncho: b.w,
          desarrolloAlto: b.h,
        },
        avisos: [
          { nivel: 'info', msg: `Sector de ${deg(anguloTotal).toFixed(1)}° · generatriz ${L.toFixed(1)} mm · R exterior ${R1.toFixed(1)} mm. Rolar y soldar la costura.` },
        ],
        cantidadPorPieza: p.partes,
      };
    },
  },

  /* ---------------------------------------------------------------- */
  {
    id: 'virola',
    nombre: 'Virola cilíndrica',
    categoria: 'Calderería',
    descripcion: 'Desarrollo de un caño/cilindro rolado, con pestaña de costura y agujeros opcionales.',
    params: [
      P('dia', 'Ø exterior', 300, { min: 10, unidad: 'mm' }),
      P('alto', 'Altura', 500, { min: 5, unidad: 'mm' }),
      S('referencia', 'Diámetro de referencia', 'medio', [
        { v: 'medio', t: 'Fibra neutra (correcto)' },
        { v: 'exterior', t: 'Exterior' },
        { v: 'interior', t: 'Interior' },
      ]),
      P('costura', 'Pestaña de costura', 0, { min: 0, unidad: 'mm' }),
      P('nAgujeros', 'Agujeros en línea', 0, { min: 0, entero: true }),
      P('diaAgujero', 'Ø agujero', 10, { min: 0, unidad: 'mm' }),
    ],
    build(p, ctx) {
      const t = ctx.espesor || 1;
      const d = p.referencia === 'medio' ? p.dia - t : p.referencia === 'interior' ? p.dia - 2 * t : p.dia;
      const W = Math.PI * d + p.costura;
      const outer = rect(0, 0, W, p.alto, 0);
      const holes = [];
      if (p.nAgujeros > 0 && p.diaAgujero > 0) {
        const paso = W / (p.nAgujeros + 1);
        for (let i = 1; i <= p.nAgujeros; i++) holes.push(circle(i * paso, p.alto / 2, p.diaAgujero / 2));
      }
      return {
        shape: makeShape(outer, holes),
        modelo3D: { tipo: 'revolucion', d1: p.dia, d2: p.dia, h: p.alto },
        info: { desarrollo: W, diametroUsado: d },
        avisos: [{ nivel: 'info', msg: `Desarrollo = π × ${d.toFixed(1)} = ${W.toFixed(1)} mm. Rolar y soldar.` }],
      };
    },
  },

  /* ---------------------------------------------------------------- */
  {
    id: 'codo',
    nombre: 'Codo segmentado (gajos)',
    categoria: 'Calderería',
    descripcion:
      'Desarrollo de cada gajo de un codo a inglete. Conductos, extracción, tolvas. El clásico trabajo de calderería bien pago.',
    params: [
      P('dia', 'Ø del caño', 200, { min: 20, unidad: 'mm' }),
      P('anguloTotal', 'Ángulo del codo', 90, { min: 5, max: 180, unidad: '°' }),
      P('gajos', 'Cantidad de gajos intermedios', 2, { min: 0, max: 8, entero: true }),
      P('radio', 'Radio de curvatura (al eje)', 300, { min: 10, unidad: 'mm' }),
      P('costura', 'Pestaña de costura', 10, { min: 0, unidad: 'mm' }),
    ],
    build(p, ctx) {
      const t = ctx.espesor || 1;
      const d = p.dia - t;
      const nSecciones = p.gajos + 2; // dos extremos + intermedios
      // Cada extremo corta a la mitad del ángulo de un gajo intermedio
      const anguloGajo = p.anguloTotal / (nSecciones - 1);
      const theta = rad(anguloGajo / 2);
      const W = Math.PI * d;
      const N = 120;

      // Gajo intermedio: sinusoide arriba y abajo
      const alturaMedia = 2 * (p.radio * Math.tan(theta));
      const amplitud = (d / 2) * Math.tan(theta);
      const ptsSup = [];
      const ptsInf = [];
      for (let i = 0; i <= N; i++) {
        const x = (W * i) / N;
        const ang = (x / W) * TAU;
        ptsSup.push([x, alturaMedia / 2 + amplitud * Math.cos(ang)]);
        ptsInf.push([x, -alturaMedia / 2 - amplitud * Math.cos(ang)]);
      }
      const pts = [...ptsInf, ...ptsSup.slice().reverse()];
      let outer = polyline(pts, true);
      const sh = normalizeShape(makeShape(outer, []), 0);
      const b = pathBBox(sh.outer);
      return {
        shape: sh,
        modelo3D: { tipo: 'codo', dia: p.dia, radio: p.radio, angulo: p.anguloTotal, gajos: p.gajos },
        info: {
          secciones: nSecciones,
          anguloPorGajo: anguloGajo,
          desarrolloAncho: b.w,
          desarrolloAlto: b.h,
          gajosExtremos: 2,
        },
        avisos: [
          {
            nivel: 'info',
            msg: `${nSecciones} secciones (${p.gajos} gajos completos + 2 medios extremos) a ${anguloGajo.toFixed(1)}° cada uno. Los extremos son este mismo desarrollo cortado a la mitad.`,
          },
        ],
        cantidadPorPieza: p.gajos + 2,
      };
    },
  },

  /* ---------------------------------------------------------------- */
  {
    id: 'tapa-pestanas',
    nombre: 'Tapa con pestañas',
    categoria: 'Cajas',
    descripcion: 'Tapa plana con 4 pestañas plegadas hacia abajo, para encastrar sobre una bandeja.',
    params: [
      P('L', 'Largo exterior', 310, { min: 10, unidad: 'mm' }),
      P('A', 'Ancho exterior', 210, { min: 10, unidad: 'mm' }),
      P('pestana', 'Alto de la pestaña', 20, { min: 3, unidad: 'mm' }),
      P('diaAgujero', 'Ø agujeros en pestañas (0 = sin)', 0, { min: 0, unidad: 'mm' }),
    ],
    build(p, ctx) {
      const t = ctx.espesor;
      const V = matrizRecomendada(t);
      const Ri = radioInterno(V, ctx.material);
      const K = kFactorEfectivo(Ri, t, ctx.material.kFactor);
      const BD = 2 * Math.tan(rad(45)) * (Ri + t) - rad(90) * (Ri + K * t);
      const W = p.L + 2 * p.pestana - 2 * BD;
      const H = p.A + 2 * p.pestana - 2 * BD;
      const ox = p.pestana - BD / 2;
      const oy = p.pestana - BD / 2;
      const alivio = Math.max(t * 1.5, Ri + t);
      const outer = cruzConAlivios(W, H, ox, oy, alivio);
      const holes = [];
      if (p.diaAgujero > 0) {
        holes.push(circle(W / 2, oy / 2, p.diaAgujero / 2));
        holes.push(circle(W / 2, H - oy / 2, p.diaAgujero / 2));
        holes.push(circle(ox / 2, H / 2, p.diaAgujero / 2));
        holes.push(circle(W - ox / 2, H / 2, p.diaAgujero / 2));
      }
      return {
        shape: makeShape(outer, holes),
        pliegues: [
          { x1: ox, y1: oy - alivio, x2: ox, y2: H - oy + alivio, label: 'P1 90°' },
          { x1: W - ox, y1: oy - alivio, x2: W - ox, y2: H - oy + alivio, label: 'P2 90°' },
          { x1: ox, y1: oy, x2: W - ox, y2: oy, label: 'P3 90°' },
          { x1: ox, y1: H - oy, x2: W - ox, y2: H - oy, label: 'P4 90°' },
        ],
        plegado: { pliegues: 4, largoPliegue: Math.max(p.L, p.A), angulo: 90, herramentales: 1 },
        modelo3D: { tipo: 'bandeja', L: p.L - 2 * t, A: p.A - 2 * t, H: p.pestana, t },
        alas: [p.pestana, p.pestana],
      };
    },
  },

  /* ---------------------------------------------------------------- */
  {
    id: 'poligono',
    nombre: 'Polígono / estrella',
    categoria: 'Chapa plana',
    descripcion: 'Polígono regular o estrella. Decoración, cartelería, bases, tapas hexagonales.',
    params: [
      P('lados', 'Cantidad de lados/puntas', 6, { min: 3, max: 60, entero: true }),
      P('radio', 'Radio exterior', 100, { min: 3, unidad: 'mm' }),
      B('estrella', 'Estrella', false),
      P('radioInterior', 'Radio interior (estrella)', 45, { min: 1, unidad: 'mm' }),
      P('giro', 'Giro', 0, { unidad: '°' }),
      P('diaCentral', 'Ø agujero central', 0, { min: 0, unidad: 'mm' }),
    ],
    build(p) {
      const R = p.radio;
      let path;
      if (p.estrella) {
        const pts = [];
        for (let i = 0; i < p.lados * 2; i++) {
          const r = i % 2 === 0 ? R : p.radioInterior;
          const a = rad(p.giro) + (i * Math.PI) / p.lados;
          pts.push([R + r * Math.cos(a), R + r * Math.sin(a)]);
        }
        path = polyline(pts, true);
      } else path = regularPolygon(R, R, R, p.lados, rad(p.giro));
      const holes = p.diaCentral > 0 ? [circle(R, R, p.diaCentral / 2)] : [];
      return { shape: makeShape(path, holes), modelo3D: { tipo: 'plano' } };
    },
  },
];

/** Contorno en cruz con alivios de esquina redondeados (bandejas y tapas). */
function cruzConAlivios(W, H, ox, oy, r) {
  const segs = [];
  const add = (s) => segs.push(s);
  const A = ox;
  const B = oy;
  // Recorrido antihorario partiendo del borde inferior izquierdo del fondo
  add(line(A, 0, W - A, 0));
  add(line(W - A, 0, W - A, B - r));
  add(arc(W - A + r, B - r, r, Math.PI, Math.PI / 2, false));
  add(line(W - A + r, B, W, B));
  add(line(W, B, W, H - B));
  add(line(W, H - B, W - A + r, H - B));
  add(arc(W - A + r, H - B + r, r, -Math.PI / 2, Math.PI, false));
  add(line(W - A, H - B + r, W - A, H));
  add(line(W - A, H, A, H));
  add(line(A, H, A, H - B + r));
  add(arc(A - r, H - B + r, r, 0, -Math.PI / 2, false));
  add(line(A - r, H - B, 0, H - B));
  add(line(0, H - B, 0, B));
  add(line(0, B, A - r, B));
  add(arc(A - r, B - r, r, Math.PI / 2, 0, false));
  add(line(A, B - r, A, 0));
  return { closed: true, segs };
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

export function getPieza(id) {
  return PIEZAS.find((p) => p.id === id);
}

export function paramsPorDefecto(id) {
  const def = getPieza(id);
  if (!def) return {};
  const o = {};
  for (const p of def.params) o[p.key] = p.def;
  return o;
}

export function categorias() {
  const m = new Map();
  for (const p of PIEZAS) {
    if (!m.has(p.categoria)) m.set(p.categoria, []);
    m.get(p.categoria).push({ id: p.id, nombre: p.nombre, descripcion: p.descripcion });
  }
  return [...m.entries()].map(([nombre, piezas]) => ({ nombre, piezas }));
}

/**
 * Construye una pieza de la biblioteca.
 * @param {string} id
 * @param {Object} params
 * @param {Object} ctx { espesor, material }
 */
export function construir(id, params, ctx) {
  const def = getPieza(id);
  if (!def) throw new Error(`Pieza desconocida: ${id}`);
  const p = { ...paramsPorDefecto(id), ...params };
  // Saneo de enteros y mínimos
  for (const d of def.params) {
    if (d.tipo === 'num') {
      let v = Number(p[d.key]);
      if (!isFinite(v)) v = d.def;
      if (d.min != null) v = Math.max(d.min, v);
      if (d.max != null) v = Math.min(d.max, v);
      if (d.entero) v = Math.round(v);
      p[d.key] = v;
    }
  }
  const r = def.build(p, ctx);
  const shape = normalizeShape(r.shape, 0);
  const dx = shape.outer.segs[0] ? 0 : 0;
  return {
    ...r,
    id,
    nombre: def.nombre,
    params: p,
    shape: { ...shape, pliegues: r.pliegues || [] },
    avisos: r.avisos || [],
  };
}
