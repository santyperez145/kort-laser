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
import { panelDecorativo, MOTIVOS, PATRONES } from './decorativo.js';

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

/* Largo útil de la plegadora del taller (100 t × 3200). `construir()` sólo
   recibe { espesor, material }, así que las piezas largas lo chequean contra
   esta constante: es preferible avisar con el número del taller a no avisar. */
const LARGO_PLEGADORA = 3200;

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
    id: 'brida-cuadrada',
    nombre: 'Brida cuadrada',
    categoria: 'Chapa plana',
    descripcion: 'Brida de caño con agujero central y cuatro pernos. La que más se pide en conductos y bombas.',
    params: [
      P('lado', 'Lado exterior', 150, { min: 20, unidad: 'mm' }),
      P('diaInt', 'Ø del caño', 80, { min: 0, unidad: 'mm' }),
      P('r', 'Radio de esquina', 12, { min: 0, unidad: 'mm' }),
      P('diaAgujero', 'Ø de los pernos', 12, { min: 0.5, unidad: 'mm' }),
      P('margen', 'Perno al borde', 20, { min: 1, unidad: 'mm' }),
      B('ochoPernos', 'Ocho pernos en vez de cuatro', false),
    ],
    build(p) {
      const outer = rect(0, 0, p.lado, p.lado, p.r);
      const holes = [];
      if (p.diaInt > 0) holes.push(circle(p.lado / 2, p.lado / 2, p.diaInt / 2));
      const m = Math.min(p.margen, p.lado / 2 - p.diaAgujero);
      holes.push(...agujerosEsquinas(p.lado, p.lado, m, p.diaAgujero));
      if (p.ochoPernos) {
        // Los cuatro del medio de cada lado
        const c = p.lado / 2;
        for (const [x, y] of [[c, m], [c, p.lado - m], [m, c], [p.lado - m, c]]) {
          holes.push(circle(x, y, p.diaAgujero / 2));
        }
      }
      return { shape: makeShape(outer, holes), modelo3D: { tipo: 'plano' } };
    },
  },

  /* ---------------------------------------------------------------- */
  {
    id: 'cartela',
    nombre: 'Cartela de refuerzo',
    categoria: 'Chapa plana',
    descripcion: 'Triángulo de refuerzo para soldar entre dos chapas a 90°. Se pide de a cientos en estructuras.',
    params: [
      P('a', 'Cateto A', 150, { min: 10, unidad: 'mm' }),
      P('b', 'Cateto B', 150, { min: 10, unidad: 'mm' }),
      P('recorteA', 'Recorte del vértice A', 15, { min: 0, unidad: 'mm' }),
      P('recorteB', 'Recorte del vértice B', 15, { min: 0, unidad: 'mm' }),
      P('rHipotenusa', 'Radio en la hipotenusa (0 = recta)', 0, { min: 0, unidad: 'mm' }),
    ],
    build(p) {
      // El vértice recto se recorta para que la cartela no choque con el
      // cordón de soldadura de las chapas que une: si no, no apoya.
      const ra = Math.min(p.recorteA, p.a * 0.6);
      const rb = Math.min(p.recorteB, p.b * 0.6);
      let pts;
      if (p.rHipotenusa > 0) {
        // Hipotenusa cóncava: ahorra material y queda más prolija
        const n = 20;
        const arcoPts = [];
        const cx = p.a + p.rHipotenusa * 0.7;
        const cy = p.b + p.rHipotenusa * 0.7;
        const R = Math.hypot(cx - ra, cy - 0) * 0.0 + Math.hypot(cx, cy);
        for (let i = 0; i <= n; i++) {
          const t = i / n;
          // Interpolación circular simple entre los dos extremos
          const x = p.a * (1 - t);
          const y = p.b * t;
          const f = Math.sin(Math.PI * t) * p.rHipotenusa;
          arcoPts.push([Math.max(0, x - f * 0.7), Math.max(0, y - f * 0.7)]);
        }
        pts = [[ra, 0], [p.a, 0], ...arcoPts.slice(1, -1), [0, p.b], [0, rb]];
      } else {
        pts = [[ra, 0], [p.a, 0], [0, p.b], [0, rb]];
      }
      return { shape: makeShape(polyline(pts, true)), modelo3D: { tipo: 'plano' } };
    },
  },

  /* ---------------------------------------------------------------- */
  {
    id: 'placa-base',
    nombre: 'Placa base de columna',
    categoria: 'Chapa plana',
    descripcion: 'Placa de anclaje con agujeros para brocas químicas y recorte central opcional.',
    params: [
      P('w', 'Ancho', 300, { min: 20, unidad: 'mm' }),
      P('h', 'Alto', 300, { min: 20, unidad: 'mm' }),
      P('diaAnclaje', 'Ø de los anclajes', 18, { min: 1, unidad: 'mm' }),
      P('margen', 'Anclaje al borde', 40, { min: 1, unidad: 'mm' }),
      S('patronAnclaje', 'Anclajes', '4', [
        { v: '4', t: '4, en las esquinas' },
        { v: '6', t: '6, dos filas de tres' },
        { v: '8', t: '8, perimetrales' },
      ]),
      B('oblongos', 'Oblongos para regular', true),
      P('largoOblongo', 'Largo del oblongo', 30, { min: 1, unidad: 'mm' }),
      P('recorteCentral', 'Ø del recorte central (0 = sin)', 0, { min: 0, unidad: 'mm' }),
      P('r', 'Radio de esquina', 10, { min: 0, unidad: 'mm' }),
    ],
    build(p) {
      const outer = rect(0, 0, p.w, p.h, p.r);
      const holes = [];
      if (p.recorteCentral > 0) holes.push(circle(p.w / 2, p.h / 2, p.recorteCentral / 2));

      const m = p.margen;
      const posiciones = [];
      if (p.patronAnclaje === '4') {
        posiciones.push([m, m], [p.w - m, m], [p.w - m, p.h - m], [m, p.h - m]);
      } else if (p.patronAnclaje === '6') {
        for (const y of [m, p.h - m]) for (const x of [m, p.w / 2, p.w - m]) posiciones.push([x, y]);
      } else {
        posiciones.push([m, m], [p.w / 2, m], [p.w - m, m], [p.w - m, p.h / 2],
          [p.w - m, p.h - m], [p.w / 2, p.h - m], [m, p.h - m], [m, p.h / 2]);
      }
      for (const [x, y] of posiciones) {
        if (!p.oblongos) {
          holes.push(circle(x, y, p.diaAnclaje / 2));
          continue;
        }
        // El oblongo apunta al centro: así se puede correr la columna para
        // compensar el error de las brocas ya empotradas.
        const ang = deg(Math.atan2(p.h / 2 - y, p.w / 2 - x));
        holes.push(slot(x, y, p.largoOblongo, p.diaAnclaje, ang));
      }
      return { shape: makeShape(outer, holes), modelo3D: { tipo: 'plano' } };
    },
  },

  /* ---------------------------------------------------------------- */
  {
    id: 'anillo',
    nombre: 'Anillo / arandela grande',
    categoria: 'Chapa plana',
    descripcion: 'Aro plano. Refuerzos de agujero, separadores, arandelas que no existen en comercio.',
    params: [
      P('diaExt', 'Ø exterior', 200, { min: 5, unidad: 'mm' }),
      P('diaInt', 'Ø interior', 120, { min: 1, unidad: 'mm' }),
      P('nAgujeros', 'Agujeros de fijación', 0, { min: 0, entero: true }),
      P('diaAgujero', 'Ø de fijación', 8, { min: 0.5, unidad: 'mm' }),
      B('partido', 'Partido (para montar sin desarmar)', false),
      P('luzCorte', 'Luz del corte', 3, { min: 0.5, unidad: 'mm' }),
    ],
    build(p) {
      const R = p.diaExt / 2;
      const ri = Math.min(p.diaInt / 2, R - 1);
      if (!p.partido) {
        const holes = [circle(R, R, ri)];
        if (p.nAgujeros > 0) {
          holes.push(...circuloAgujeros(R, R, (R + ri), p.nAgujeros, p.diaAgujero));
        }
        return { shape: makeShape(circle(R, R, R), holes), modelo3D: { tipo: 'plano' } };
      }
      // Anillo abierto: un solo contorno en C, sin agujero interior
      const luz = Math.max(0.5, p.luzCorte);
      const a0 = Math.asin(Math.min(0.99, luz / 2 / R));
      const ai = Math.asin(Math.min(0.99, luz / 2 / ri));
      const pts = [];
      const n = 96;
      for (let i = 0; i <= n; i++) {
        const a = a0 + ((TAU - 2 * a0) * i) / n;
        pts.push([R + R * Math.cos(a), R + R * Math.sin(a)]);
      }
      for (let i = n; i >= 0; i--) {
        const a = ai + ((TAU - 2 * ai) * i) / n;
        pts.push([R + ri * Math.cos(a), R + ri * Math.sin(a)]);
      }
      return { shape: makeShape(polyline(pts, true)), modelo3D: { tipo: 'plano' } };
    },
  },

  /* ---------------------------------------------------------------- */
  {
    id: 'transicion',
    nombre: 'Transición cuadrado-redondo',
    categoria: 'Calderería',
    descripcion:
      'El desarrollo de una tolva de boca cuadrada a caño redondo. Dibujarlo a mano lleva media hora y sale mal; acá es exacto.',
    params: [
      P('lado', 'Lado del cuadrado', 400, { min: 20, unidad: 'mm' }),
      P('ladoB', 'Lado B (0 = cuadrado)', 0, { min: 0, unidad: 'mm' }),
      P('dia', 'Ø del redondo', 250, { min: 10, unidad: 'mm' }),
      P('h', 'Altura', 300, { min: 10, unidad: 'mm' }),
      P('costura', 'Pestaña de costura', 15, { min: 0, unidad: 'mm' }),
      P('divisiones', 'Divisiones por cuadrante', 8, { min: 3, max: 24, entero: true }),
      B('enDosPartes', 'Cortar en dos mitades', false),
    ],
    build(p, ctx) {
      const t = ctx.espesor || 1;
      const A = p.lado - t;               // por la fibra neutra
      const Bl = (p.ladoB > 0 ? p.ladoB : p.lado) - t;
      const R = (p.dia - t) / 2;
      const H = p.h;
      const n = Math.round(p.divisiones);

      /* La superficie son 4 sectores cónicos (uno por esquina del cuadrado) y
         4 triángulos planos (uno por lado). Se desarrolla por TRIANGULACIÓN,
         que es como se traza en el taller con compás: cada triángulo se rebate
         al plano conservando sus tres longitudes verdaderas, apoyado en el
         anterior. */
      const esq = [
        [-A / 2, -Bl / 2, 0], [A / 2, -Bl / 2, 0], [A / 2, Bl / 2, 0], [-A / 2, Bl / 2, 0],
      ];
      const total = n * 4;
      const arco = [];
      for (let i = 0; i < total; i++) {
        // Se arranca en la diagonal para que cada cuadrante del círculo caiga
        // sobre una esquina del cuadrado.
        const a = Math.PI / 4 + (i * TAU) / total;
        arco.push([R * Math.cos(a), R * Math.sin(a), H]);
      }
      /* Los puntos de la COSTURA se repiten con clave propia: en el espacio
         son el mismo punto, pero en el desarrollo son los dos bordes del
         corte y van en lugares distintos. Sin esto la tira daba la vuelta
         entera y se superponía sobre sí misma. */
      const P3 = (k) =>
        k === 'e0b' ? esq[0] : k[0] === 'e' ? esq[+k.slice(1)] : arco[+k.slice(1) % total];
      const d3 = (u, v) => Math.hypot(u[0] - v[0], u[1] - v[1], u[2] - v[2]);

      /* Cadena de triángulos alrededor de la pieza. Se corta por la mitad de
         un triángulo plano, que es donde va la costura. */
      const tri = [];
      for (let q = 0; q < 4; q++) {
        for (let i = 0; i < n; i++) {
          tri.push(['e' + q, 'a' + (q * n + i), 'a' + (q * n + i + 1)]);
        }
        // La última esquina cierra contra la copia de costura, no contra e0
        tri.push(['e' + q, 'a' + ((q + 1) * n), q === 3 ? 'e0b' : 'e' + (q + 1)]);
      }

      /* Desplegado. Dos triángulos consecutivos comparten exactamente una
         arista. El vértice nuevo tiene que quedar del LADO OPUESTO de esa
         arista respecto del vértice libre del triángulo anterior: es lo que
         hace que la tira se abra en abanico en vez de plegarse sobre sí misma.
         Elegir "el que quede más lejos" no alcanza y la tira se dobla. */
      const plano = new Map();
      const t0 = tri[0];
      plano.set(t0[0], [0, 0]);
      plano.set(t0[1], [d3(P3(t0[0]), P3(t0[1])), 0]);
      let triAnterior = null;

      const ladoDe = (p1, p2, q) =>
        Math.sign((p2[0] - p1[0]) * (q[1] - p1[1]) - (p2[1] - p1[1]) * (q[0] - p1[0]));

      for (const t of tri) {
        const kNuevo = t.find((k) => !plano.has(k));
        if (!kNuevo) {
          triAnterior = t;
          continue;
        }
        const [k1, k2] = t.filter((k) => k !== kNuevo);
        // El vértice LIBRE del triángulo anterior: el que no está en la arista
        // que ambos comparten. Es la referencia contra la que hay que ir.
        const kLibre = triAnterior ? triAnterior.find((k) => k !== k1 && k !== k2) : null;
        const libreAnterior = kLibre ? plano.get(kLibre) : null;
        const p1 = plano.get(k1);
        const p2 = plano.get(k2);
        const l1 = d3(P3(k1), P3(kNuevo));
        const l2 = d3(P3(k2), P3(kNuevo));

        const dx = p2[0] - p1[0];
        const dy = p2[1] - p1[1];
        const d = Math.hypot(dx, dy) || 1e-9;
        const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
        const alt = Math.sqrt(Math.max(0, l1 * l1 - a * a));
        const mx = p1[0] + (a * dx) / d;
        const my = p1[1] + (a * dy) / d;
        const opcA = [mx + (alt * dy) / d, my - (alt * dx) / d];
        const opcB = [mx - (alt * dy) / d, my + (alt * dx) / d];

        let nuevo;
        if (!libreAnterior) {
          nuevo = opcA;
        } else {
          const ladoViejo = ladoDe(p1, p2, libreAnterior);
          nuevo = ladoDe(p1, p2, opcA) !== ladoViejo ? opcA : opcB;
        }
        plano.set(kNuevo, nuevo);
        triAnterior = t;
      }

      /* Contorno: el borde de abajo (las esquinas del cuadrado y los puntos
         que las unen) y el de arriba (el arco), recorridos en orden. */
      const bordeArriba = [];
      const bordeAbajo = [];
      for (let i = 0; i <= total; i++) {
        const pt = plano.get('a' + i);
        if (pt) bordeArriba.push(pt);
      }
      for (const k of ['e0', 'e1', 'e2', 'e3', 'e0b']) {
        const pt = plano.get(k);
        if (pt) bordeAbajo.push(pt);
      }
      const borde = [...bordeAbajo, ...bordeArriba.slice().reverse()];

      let sh = normalizeShape(makeShape(polyline(borde, true)), 0);
      const b = pathBBox(sh.outer);

      const perimetroRedondo = Math.PI * (p.dia - t);
      const perimetroCuadrado = 2 * (A + Bl);
      // Control de sanidad: el desarrollo no puede ser más grande que el
      // perímetro mayor estirado. Si lo es, el desplegado se dio vuelta.
      const cotaAncho = Math.max(perimetroCuadrado, perimetroRedondo) * 1.15;
      const generatriz = Math.sqrt(H * H + ((A - 2 * R) / 2) ** 2 + ((Bl - 2 * R) / 2) ** 2);

      return {
        shape: sh,
        modelo3D: { tipo: 'revolucion', d1: Math.max(p.lado, p.ladoB || p.lado), d2: p.dia, h: p.h },
        info: {
          perimetroCuadrado,
          perimetroRedondo,
          generatriz,
          triangulos: tri.length,
          desarrolloAncho: b.w,
          desarrolloAlto: b.h,
        },
        avisos: [
          {
            nivel: 'info',
            msg:
              `Desarrollo por triangulación: ${tri.length} triángulos (${n} divisiones por esquina). ` +
              `Boca cuadrada ${perimetroCuadrado.toFixed(0)} mm de perímetro, boca redonda ${perimetroRedondo.toFixed(0)} mm. ` +
              'Rolar las cuatro esquinas, quebrar los cuatro planos y soldar la costura.',
          },
          p.divisiones < 6
            ? { nivel: 'aviso', msg: 'Con menos de 6 divisiones por esquina la curva queda facetada. Subilo si la pieza se ve.' }
            : null,
          b.w > cotaAncho
            ? { nivel: 'error', msg: `El desarrollo dio ${b.w.toFixed(0)} mm de ancho, más de lo posible para estas bocas. No lo cortes: revisá las medidas.` }
            : null,
        ].filter(Boolean),
      };
    },
  },

  /* ---------------------------------------------------------------- */
  {
    id: 'tolva-piramidal',
    nombre: 'Tolva piramidal',
    categoria: 'Calderería',
    descripcion: 'Los cuatro faldones de una tolva de boca rectangular a boca rectangular. Se cortan planos y se pliegan.',
    params: [
      P('supA', 'Boca superior, lado A', 600, { min: 20, unidad: 'mm' }),
      P('supB', 'Boca superior, lado B', 600, { min: 20, unidad: 'mm' }),
      P('infA', 'Boca inferior, lado A', 200, { min: 10, unidad: 'mm' }),
      P('infB', 'Boca inferior, lado B', 200, { min: 10, unidad: 'mm' }),
      P('h', 'Altura', 400, { min: 10, unidad: 'mm' }),
      P('pestana', 'Pestaña de soldadura', 20, { min: 0, unidad: 'mm' }),
      S('cual', 'Qué faldón generar', 'A', [
        { v: 'A', t: 'Faldón del lado A (van 2)' },
        { v: 'B', t: 'Faldón del lado B (van 2)' },
      ]),
    ],
    build(p) {
      // Cada faldón es un trapecio isósceles. Su altura NO es la de la tolva:
      // es la altura inclinada real, que sale del retiro lateral.
      const esA = p.cual === 'A';
      const anchoSup = esA ? p.supA : p.supB;
      const anchoInf = esA ? p.infA : p.infB;
      const retiro = esA ? (p.supB - p.infB) / 2 : (p.supA - p.infA) / 2;
      const alturaInclinada = Math.sqrt(p.h * p.h + retiro * retiro);

      const pes = p.pestana;
      const x0 = (anchoSup - anchoInf) / 2;
      const pts = [
        [0, 0],
        [anchoSup, 0],
        [anchoSup - x0 + pes * 0, alturaInclinada],
        [x0, alturaInclinada],
      ];
      // Con pestaña, se ensancha el trapecio a los costados
      const conPestana = pes > 0
        ? [[-pes, 0], [anchoSup + pes, 0], [anchoSup - x0 + pes, alturaInclinada], [x0 - pes, alturaInclinada]]
        : pts;

      const sh = normalizeShape(makeShape(polyline(conPestana, true)), 0);
      return {
        shape: sh,
        modelo3D: { tipo: 'plano' },
        info: { alturaInclinada, retiro, anchoSup, anchoInf },
        avisos: [{
          nivel: 'info',
          msg:
            `Altura inclinada ${alturaInclinada.toFixed(1)} mm (la vertical es ${p.h} mm; el retiro lateral de ` +
            `${retiro.toFixed(1)} mm la alarga). Hacen falta 2 de este faldón y 2 del otro lado.`,
        }],
        cantidadPorPieza: 2,
      };
    },
  },

  /* ---------------------------------------------------------------- */
  {
    id: 'bandeja-portacables',
    nombre: 'Bandeja portacables',
    categoria: 'Plegado',
    descripcion: 'Tramo de bandeja perforada con alas plegadas. Obra eléctrica, se pide por metros.',
    params: [
      P('ancho', 'Ancho útil', 200, { min: 30, unidad: 'mm' }),
      P('altura', 'Altura del ala', 60, { min: 10, unidad: 'mm' }),
      P('largo', 'Largo del tramo', 2000, { min: 100, unidad: 'mm' }),
      B('perforada', 'Fondo perforado', true),
      P('diaVent', 'Ø de las perforaciones', 20, { min: 2, unidad: 'mm' }),
      P('pasoVent', 'Paso entre perforaciones', 60, { min: 5, unidad: 'mm' }),
      P('diaUnion', 'Ø agujeros de unión en las alas', 8, { min: 0, unidad: 'mm' }),
    ],
    build(p, ctx) {
      const t = ctx.espesor;
      const dev = calcularDesarrollo([p.altura, p.ancho, p.altura], [90, 90], t, ctx.material, null, p.largo);
      const W = dev.desarrollo;
      const bd = dev.pliegues[0].BD;
      const x1 = p.altura - bd / 2;
      const x2 = x1 + p.ancho - bd;

      const holes = [];
      if (p.perforada) {
        // Sólo en el fondo: perforar el ala la debilita justo donde trabaja
        const margen = 25;
        for (let x = x1 + margen; x <= x2 - margen; x += p.pasoVent) {
          for (let y = margen; y <= p.largo - margen; y += p.pasoVent) {
            holes.push(slot(x, y, p.diaVent * 2.2, p.diaVent, 90));
          }
        }
      }
      if (p.diaUnion > 0) {
        // Agujeros de empalme en los extremos de las dos alas
        for (const xa of [x1 / 2, (x2 + W) / 2]) {
          for (const y of [30, 60, p.largo - 60, p.largo - 30]) {
            holes.push(circle(xa, y, p.diaUnion / 2));
          }
        }
      }

      return {
        shape: makeShape(rect(0, 0, W, p.largo, 0), holes),
        pliegues: [
          { x1, y1: 0, x2: x1, y2: p.largo, label: 'P1 90°' },
          { x1: x2, y1: 0, x2, y2: p.largo, label: 'P2 90°' },
        ],
        plegado: { pliegues: 2, largoPliegue: p.largo, angulo: 90, herramentales: 1 },
        desarrollo: dev,
        modelo3D: { tipo: 'perfil', tramos: [p.altura, p.ancho, p.altura], angulos: [-90, -90], ancho: p.largo },
        alas: [p.altura, p.altura],
        avisos: holes.length > 400
          ? [{ nivel: 'aviso', msg: `${holes.length} perforaciones en el tramo: el tiempo de máquina va a ser alto. Evaluá bandeja comercial.` }]
          : [],
      };
    },
  },

  /* ---------------------------------------------------------------- */
  {
    id: 'pinon',
    nombre: 'Piñón para cadena',
    categoria: 'Mecánica',
    descripcion: 'Rueda dentada para cadena de rodillos ASA/DIN. Transportadores y transmisiones lentas.',
    params: [
      P('z', 'Cantidad de dientes', 19, { min: 8, max: 120, entero: true }),
      S('paso', 'Cadena', '12.7', [
        { v: '6.35', t: '04B / #25 — paso 6,35' },
        { v: '9.525', t: '06B / #35 — paso 9,525' },
        { v: '12.7', t: '08B / #40 — paso 12,7' },
        { v: '15.875', t: '10B / #50 — paso 15,875' },
        { v: '19.05', t: '12B / #60 — paso 19,05' },
        { v: '25.4', t: '16B / #80 — paso 25,4' },
      ]),
      P('diaRodillo', 'Ø del rodillo (0 = de tabla)', 0, { min: 0, unidad: 'mm' }),
      P('diaEje', 'Ø del eje', 25, { min: 0, unidad: 'mm' }),
      P('chaveta', 'Ancho de chavetero (0 = sin)', 8, { min: 0, unidad: 'mm' }),
      P('nAligeramiento', 'Agujeros de aligeramiento', 4, { min: 0, entero: true }),
      P('diaAligeramiento', 'Ø aligeramiento', 25, { min: 0, unidad: 'mm' }),
    ],
    build(p) {
      const paso = Number(p.paso);
      const z = Math.round(p.z);
      // Rodillo estándar según norma: ≈ 0,6 del paso si no lo especifican
      const dRod = p.diaRodillo > 0 ? p.diaRodillo : paso * 0.6;
      // Diámetro primitivo: Dp = paso / sen(180/z)
      const Dp = paso / Math.sin(Math.PI / z);
      const Rp = Dp / 2;
      // Exterior aproximado de norma
      const Re = (Dp + 0.8 * (paso - dRod)) / 2 + paso * 0.15;

      const pts = [];
      const N = 14; // puntos por diente
      for (let i = 0; i < z; i++) {
        const base = (i * TAU) / z;
        // Alojamiento del rodillo: un arco de radio dRod/2 centrado en el primitivo
        const cx = Rp * Math.cos(base);
        const cy = Rp * Math.sin(base);
        const rRod = dRod / 2 * 1.05; // holgura de norma
        for (let k = 0; k <= N; k++) {
          // Se recorre el alojamiento del lado que mira hacia afuera
          const a = base + Math.PI + (-Math.PI / 2 + (Math.PI * k) / N);
          pts.push([cx + rRod * Math.cos(a), cy + rRod * Math.sin(a)]);
        }
        // Punta del diente, entre este alojamiento y el siguiente
        const medio = base + Math.PI / z;
        pts.push([Re * Math.cos(medio), Re * Math.sin(medio)]);
      }

      const outer = transformPath(polyline(pts, true), { dx: Re, dy: Re });
      const holes = [];
      if (p.diaEje > 0) {
        if (p.chaveta > 0) {
          const re = p.diaEje / 2;
          const prof = re + p.chaveta * 0.45;
          const cpts = [];
          const a0 = Math.asin(Math.min(0.95, p.chaveta / 2 / re));
          for (let k = 0; k <= 64; k++) {
            const ang = a0 + ((TAU - 2 * a0) * k) / 64;
            cpts.push([Re + re * Math.cos(ang), Re + re * Math.sin(ang)]);
          }
          cpts.push([Re + re * Math.cos(-a0), Re - p.chaveta / 2]);
          cpts.push([Re + prof, Re - p.chaveta / 2]);
          cpts.push([Re + prof, Re + p.chaveta / 2]);
          holes.push(polyline(cpts, true));
        } else holes.push(circle(Re, Re, p.diaEje / 2));
      }
      if (p.nAligeramiento > 0 && p.diaAligeramiento > 0) {
        const bcd = (Rp - dRod) * 0.62 + Math.max(p.diaEje / 2, 12);
        holes.push(...circuloAgujeros(Re, Re, bcd * 2 * 0.62, p.nAligeramiento, p.diaAligeramiento));
      }

      return {
        shape: makeShape(outer, holes),
        modelo3D: { tipo: 'plano' },
        info: { primitivo: Dp, exterior: Re * 2, paso, rodillo: dRod },
        avisos: [{
          nivel: 'info',
          msg:
            `Ø primitivo ${Dp.toFixed(1)} mm · Ø exterior ${(Re * 2).toFixed(1)} mm · paso ${paso} mm. ` +
            'El perfil sale para corte láser: si el piñón va a trabajar cargado, conviene templarlo o rectificar los alojamientos.',
        }],
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

  /* ---------------------------------------------------------------- */
  {
    id: 'panel-decorativo',
    nombre: 'Panel decorativo / celosía',
    categoria: 'Decoración',
    descripcion:
      'Un motivo repartido parejo sobre la medida que pidas. Celosías, frentes, ' +
      'separadores de ambiente, tapas ventiladas. El sistema calcula cuántos entran ' +
      'y respeta el ligamento mínimo para que la chapa no salga ondulada.',
    params: [
      P('ancho', 'Ancho del panel', 900, { min: 50, unidad: 'mm' }),
      P('alto', 'Alto del panel', 1800, { min: 50, unidad: 'mm' }),
      S('motivo', 'Motivo', 'rombo', MOTIVOS.map((m) => ({ v: m.id, t: m.nombre }))),
      P('tamMotivo', 'Tamaño del motivo', 60, { min: 3, unidad: 'mm' }),
      S('patron', 'Distribución', 'grilla', PATRONES.map((x) => ({ v: x.id, t: x.nombre }))),
      P('separacion', 'Ligamento entre calados', 0, { min: 0, unidad: 'mm' }),
      P('margen', 'Borde liso', 50, { min: 0, unidad: 'mm' }),
      P('giroMotivo', 'Giro del motivo', 0, { unidad: '°' }),
      P('radioPanel', 'Radio de esquina del panel', 0, { min: 0, unidad: 'mm' }),
      P('diaFijacion', 'Ø agujeros de fijación', 0, { min: 0, unidad: 'mm' }),
    ],
    build(p, ctx) {
      return panelDecorativo(
        { ...p, fijaciones: p.diaFijacion > 0 ? { dia: p.diaFijacion } : null },
        ctx
      );
    },
  },

  /* ================================================================== */
  /* Estanterías y racks                                                 */
  /*                                                                     */
  /* Es el trabajo que más se repite en un taller de La Rioja: depósitos,*/
  /* despensas, talleres mecánicos. Todo el sistema va sobre un PASO de  */
  /* ranuras: si el parante y la ménsula no comparten paso, no encastran.*/
  /* Por eso el paso es un parámetro y no un número escondido adentro.   */
  /* ================================================================== */

  {
    id: 'parante-rack',
    nombre: 'Parante de estantería ranurado',
    categoria: 'Estanterías y racks',
    descripcion:
      'Ángulo o perfil C ranurado para armar estanterías regulables. Las ranuras van cada paso fijo para que el estante se pueda subir o bajar.',
    params: [
      P('altura', 'Altura del parante', 2000, { min: 200, unidad: 'mm' }),
      S('perfil', 'Perfil', 'L', [
        { v: 'L', t: 'Ángulo (2 alas)' },
        { v: 'C', t: 'Perfil C (3 alas)' },
      ]),
      P('ala', 'Ancho de cada ala', 40, { min: 15, unidad: 'mm' }),
      P('alma', 'Alma (sólo perfil C)', 40, { min: 15, unidad: 'mm' }),
      P('paso', 'Paso entre ranuras', 50, { min: 15, unidad: 'mm' }),
      P('ranuraLargo', 'Largo de la ranura', 18, { min: 4, unidad: 'mm' }),
      P('ranuraAncho', 'Ancho de la ranura', 9, { min: 2, unidad: 'mm' }),
      P('extremos', 'Zona lisa en los extremos', 60, { min: 0, unidad: 'mm' }),
      P('diaBase', 'Ø agujeros de anclaje al piso', 12, { min: 0, unidad: 'mm' }),
    ],
    build(p, ctx) {
      const t = ctx.espesor;
      const esC = p.perfil === 'C';
      const cotas = esC ? [p.ala, p.alma, p.ala] : [p.ala, p.ala];
      const angulos = esC ? [90, 90] : [90];
      const dev = calcularDesarrollo(cotas, angulos, t, ctx.material, null, p.altura);
      const W = dev.desarrollo;

      /* Posición de cada línea de plegado sobre el desarrollo. Se acumulan
         las cotas y se descuenta la mitad del BD de cada pliegue, que es la
         convención del resto de la biblioteca. */
      const xPliegues = [];
      let acum = 0;
      for (let i = 0; i < angulos.length; i++) {
        acum += cotas[i] - dev.pliegues[i].BD / 2;
        xPliegues.push(acum);
        acum -= dev.pliegues[i].BD / 2;
      }

      /* Centro de cada ala en el desarrollo: ahí van las ranuras. */
      const bordes = [0, ...xPliegues, W];
      const centros = [];
      for (let i = 0; i < bordes.length - 1; i++) centros.push((bordes[i] + bordes[i + 1]) / 2);

      const holes = [];
      const y0 = p.extremos;
      const y1 = p.altura - p.extremos;
      let nRanuras = 0;
      for (const cx of centros) {
        for (let y = y0; y <= y1 + 0.01; y += p.paso) {
          holes.push(slot(cx, y, p.ranuraLargo, p.ranuraAncho, 90));
          nRanuras++;
        }
      }
      if (p.diaBase > 0) {
        // Anclaje al piso y al techo, en las dos alas exteriores
        for (const cx of [centros[0], centros[centros.length - 1]]) {
          holes.push(circle(cx, p.extremos / 2, p.diaBase / 2));
          holes.push(circle(cx, p.altura - p.extremos / 2, p.diaBase / 2));
        }
      }

      return {
        shape: makeShape(rect(0, 0, W, p.altura, 0), holes),
        pliegues: xPliegues.map((x, i) => ({ x1: x, y1: 0, x2: x, y2: p.altura, label: `P${i + 1} 90°` })),
        plegado: { pliegues: angulos.length, largoPliegue: p.altura, angulo: 90, herramentales: 1 },
        desarrollo: dev,
        modelo3D: { tipo: 'perfil', tramos: cotas, angulos: angulos.map((a) => -a), ancho: p.altura },
        alas: cotas,
        info: { ranuras: nRanuras, desarrollo: W, ranurasPorAla: nRanuras / centros.length },
        avisos: [
          {
            nivel: 'info',
            msg:
              `${nRanuras} ranuras cada ${p.paso} mm. El estante y la ménsula tienen que usar el MISMO paso ` +
              `de ${p.paso} mm o no encastran: es el error más común al mezclar tandas de distinta fecha.`,
          },
          p.altura > (LARGO_PLEGADORA)
            ? { nivel: 'error', msg: `El parante mide ${p.altura} mm y no entra en la plegadora. Partilo en tramos empalmables.` }
            : null,
          nRanuras > 250
            ? { nivel: 'aviso', msg: `${nRanuras} ranuras son muchas perforaciones: mirá el tiempo de máquina antes de cerrar el precio.` }
            : null,
        ].filter(Boolean),
      };
    },
  },

  /* ---------------------------------------------------------------- */
  {
    id: 'estante-rack',
    nombre: 'Estante de estantería',
    categoria: 'Estanterías y racks',
    descripcion:
      'Bandeja de estante con las cuatro alas plegadas hacia abajo. Las alas son el refuerzo: sin ellas la chapa panda con la carga.',
    params: [
      P('ancho', 'Ancho del estante', 900, { min: 100, unidad: 'mm' }),
      P('fondo', 'Fondo del estante', 400, { min: 80, unidad: 'mm' }),
      P('ala', 'Altura del ala', 30, { min: 8, unidad: 'mm' }),
      B('pestana', 'Pestaña de retorno en el ala', true),
      P('pestanaAlto', 'Alto de la pestaña', 12, { min: 5, unidad: 'mm' }),
      B('perforado', 'Fondo perforado', false),
      P('diaVent', 'Ø de las perforaciones', 25, { min: 3, unidad: 'mm' }),
      P('pasoVent', 'Paso entre perforaciones', 70, { min: 8, unidad: 'mm' }),
      P('diaUnion', 'Ø agujeros de fijación al parante', 9, { min: 0, unidad: 'mm' }),
    ],
    build(p, ctx) {
      const t = ctx.espesor;
      const alaTotal = p.ala + (p.pestana ? p.pestanaAlto : 0);
      /* Un ala con retorno son dos pliegues seguidos, pero el desarrollo se
         calcula por dirección: acá interesa cuánto crece el plano por lado. */
      const devAncho = calcularDesarrollo(
        p.pestana ? [alaTotal, p.ancho, alaTotal] : [p.ala, p.ancho, p.ala],
        p.pestana ? [90, 90] : [90, 90],
        t, ctx.material, null, p.fondo
      );
      const W = devAncho.desarrollo;
      const bdW = devAncho.pliegues[0].BD;
      const devFondo = calcularDesarrollo(
        p.pestana ? [alaTotal, p.fondo, alaTotal] : [p.ala, p.fondo, p.ala],
        [90, 90], t, ctx.material, null, p.ancho
      );
      const H = devFondo.desarrollo;
      const bdH = devFondo.pliegues[0].BD;

      const ox = alaTotal - bdW / 2; // cuánto sobresale el ala en X
      const oy = alaTotal - bdH / 2;
      const outer = cruzConAlivios(W, H, ox, oy, Math.max(t, 2));

      const holes = [];
      if (p.perforado) {
        const m = 30;
        for (let x = ox + m; x <= W - ox - m; x += p.pasoVent)
          for (let y = oy + m; y <= H - oy - m; y += p.pasoVent) holes.push(circle(x, y, p.diaVent / 2));
      }
      if (p.diaUnion > 0) {
        // Dos por ala corta: es donde se atornilla contra el parante
        for (const y of [oy + 25, H - oy - 25]) {
          holes.push(circle(ox / 2, y, p.diaUnion / 2));
          holes.push(circle(W - ox / 2, y, p.diaUnion / 2));
        }
      }

      /* Carga admisible aproximada por flexión de las dos alas trabajando
         como vigas. Es una cota de orden de magnitud para no prometer un
         estante que se dobla, no un cálculo estructural.

         La tensión admisible se toma como Rm/3: los materiales de la base
         traen resistencia a la tracción (Rm), no límite elástico, y un
         tercio de Rm es el coeficiente conservador de uso corriente en
         estanterías. */
      const admisible = (ctx.material?.Rm ?? 370) / 3; // MPa = N/mm²
      const Wsec = 2 * ((t * p.ala * p.ala) / 6); // módulo resistente, mm³
      // Viga simplemente apoyada con carga repartida: M = qL²/8 → q = 8·σ·W/L²
      const qNmm = (8 * admisible * Wsec) / (p.ancho * p.ancho);
      const cargaKg = (qNmm * p.ancho) / 9.81;

      return {
        shape: makeShape(outer, holes),
        pliegues: [
          { x1: ox, y1: 0, x2: ox, y2: H, label: 'P1 90°' },
          { x1: W - ox, y1: 0, x2: W - ox, y2: H, label: 'P2 90°' },
          { x1: 0, y1: oy, x2: W, y2: oy, label: 'P3 90°' },
          { x1: 0, y1: H - oy, x2: W, y2: H - oy, label: 'P4 90°' },
        ],
        plegado: {
          pliegues: p.pestana ? 8 : 4,
          largoPliegue: Math.max(p.ancho, p.fondo),
          angulo: 90,
          herramentales: 1,
        },
        desarrollo: devAncho,
        modelo3D: { tipo: 'caja', w: p.ancho, d: p.fondo, h: alaTotal, t },
        info: { desarrollo: [W, H], cargaAdmisibleKg: cargaKg },
        avisos: [
          {
            nivel: 'info',
            msg:
              `Carga repartida orientativa: ~${cargaKg.toFixed(0)} kg con las alas hacia abajo. ` +
              'Es una cota de cálculo, no un ensayo: si el estante lleva carga puntual o gente encima, verificalo aparte.',
          },
          p.ancho > 1000 && p.ala < 30
            ? { nivel: 'aviso', msg: `Con ${p.ancho} mm de luz y sólo ${p.ala} mm de ala el estante va a pandear. Subí el ala o agregá un travesaño al medio.` }
            : null,
          p.pestana
            ? { nivel: 'info', msg: 'La pestaña de retorno duplica los pliegues (8 en total) pero saca el filo del canto: en un estante que se manipula, vale la pena.' }
            : null,
        ].filter(Boolean),
      };
    },
  },

  /* ---------------------------------------------------------------- */
  {
    id: 'mensula-pared',
    nombre: 'Ménsula de pared',
    categoria: 'Estanterías y racks',
    descripcion:
      'Soporte triangular para estante. Sale de una sola pieza plana: el corte diagonal es lo que la hace barata frente a la soldada.',
    params: [
      P('brazo', 'Largo del brazo', 300, { min: 50, unidad: 'mm' }),
      P('altura', 'Altura contra la pared', 300, { min: 50, unidad: 'mm' }),
      P('lomo', 'Ancho del lomo', 45, { min: 15, unidad: 'mm' }),
      P('diaPared', 'Ø agujeros a la pared', 10, { min: 0, unidad: 'mm' }),
      P('nPared', 'Cantidad de agujeros a la pared', 2, { min: 1, max: 6, entero: true }),
      P('diaEstante', 'Ø agujeros al estante', 7, { min: 0, unidad: 'mm' }),
      P('nEstante', 'Cantidad de agujeros al estante', 2, { min: 1, max: 6, entero: true }),
      B('aligerada', 'Calar el triángulo interior', true),
    ],
    build(p) {
      const L = p.brazo;
      const Hh = p.altura;
      const a = p.lomo;

      /* Contorno: escuadra con la hipotenusa cortada. El vértice exterior se
         redondea implícitamente por el propio corte; no hace falta radio. */
      const outer = polyline(
        [
          [0, 0],
          [L, 0],
          [L, a],   // la diagonal arranca acá y sube hasta el lomo
          [a, Hh],
          [0, Hh],
        ],
        true
      );

      const holes = [];
      if (p.diaPared > 0) {
        const paso = (Hh - 2 * a) / Math.max(1, p.nPared - 1);
        for (let i = 0; i < p.nPared; i++) holes.push(circle(a / 2, a + i * (p.nPared > 1 ? paso : 0), p.diaPared / 2));
      }
      if (p.diaEstante > 0) {
        const paso = (L - 2 * a) / Math.max(1, p.nEstante - 1);
        for (let i = 0; i < p.nEstante; i++) holes.push(circle(a + i * (p.nEstante > 1 ? paso : 0), a / 2, p.diaEstante / 2));
      }
      /* El calado interior saca peso sin tocar el camino de la carga, que va
         por el borde: la ménsula trabaja como un triángulo articulado. */
      if (p.aligerada && L > 150 && Hh > 150) {
        const m = a + 18;
        const tri = polyline(
          [
            [m, m],
            [L - a - 25, m],
            [m, Hh - a - 25],
          ],
          true
        );
        holes.push(tri);
      }

      return {
        shape: makeShape(outer, holes),
        modelo3D: { tipo: 'plano' },
        info: { diagonal: Math.hypot(L - a, Hh - a) },
        avisos: [
          {
            nivel: 'info',
            msg:
              'La ménsula trabaja a compresión sobre la diagonal. Va de canto, no de plano: ' +
              'apoyada de plano no sostiene nada.',
          },
          p.brazo > p.altura * 1.3
            ? { nivel: 'aviso', msg: `Con el brazo (${p.brazo} mm) mucho más largo que la altura (${p.altura} mm), el tornillo de arriba trabaja a arrancamiento. Subí la altura o poné bulón pasante.` }
            : null,
        ].filter(Boolean),
      };
    },
  },

  /* ---------------------------------------------------------------- */
  {
    id: 'larguero-rack',
    nombre: 'Larguero de rack (perfil C)',
    categoria: 'Estanterías y racks',
    descripcion:
      'Travesaño en perfil C con retornos. Los retornos son los que le dan rigidez torsional: sin ellos el larguero se retuerce con la carga descentrada.',
    params: [
      P('largo', 'Largo del larguero', 1800, { min: 200, unidad: 'mm' }),
      P('alma', 'Altura del alma', 80, { min: 25, unidad: 'mm' }),
      P('ala', 'Ancho del ala', 45, { min: 15, unidad: 'mm' }),
      P('retorno', 'Retorno del ala', 15, { min: 0, unidad: 'mm' }),
      P('diaUnion', 'Ø agujeros de unión en las puntas', 11, { min: 0, unidad: 'mm' }),
      P('nUnion', 'Agujeros por punta', 2, { min: 1, max: 4, entero: true }),
    ],
    build(p, ctx) {
      const t = ctx.espesor;
      const conRet = p.retorno > 0;
      const cotas = conRet
        ? [p.retorno, p.ala, p.alma, p.ala, p.retorno]
        : [p.ala, p.alma, p.ala];
      const angulos = cotas.map(() => 90).slice(1);
      const dev = calcularDesarrollo(cotas, angulos, t, ctx.material, null, p.largo);
      const W = dev.desarrollo;

      const xPliegues = [];
      let acum = 0;
      for (let i = 0; i < angulos.length; i++) {
        acum += cotas[i] - dev.pliegues[i].BD / 2;
        xPliegues.push(acum);
        acum -= dev.pliegues[i].BD / 2;
      }

      // El alma es el tramo del medio: ahí van los agujeros de unión
      const iAlma = conRet ? 2 : 1;
      const bordes = [0, ...xPliegues, W];
      const cxAlma = (bordes[iAlma] + bordes[iAlma + 1]) / 2;
      const holes = [];
      if (p.diaUnion > 0) {
        const sep = p.alma / (p.nUnion + 1);
        for (const yBase of [25, p.largo - 25]) {
          for (let i = 0; i < p.nUnion; i++) {
            holes.push(circle(cxAlma - p.alma / 2 + sep * (i + 1), yBase, p.diaUnion / 2));
          }
        }
      }

      const flecha = (5 / 384) * ((p.largo / 1000) ** 3);
      return {
        shape: makeShape(rect(0, 0, W, p.largo, 0), holes),
        pliegues: xPliegues.map((x, i) => ({ x1: x, y1: 0, x2: x, y2: p.largo, label: `P${i + 1} 90°` })),
        plegado: { pliegues: angulos.length, largoPliegue: p.largo, angulo: 90, herramentales: 1 },
        desarrollo: dev,
        modelo3D: { tipo: 'perfil', tramos: cotas, angulos: angulos.map(() => -90), ancho: p.largo },
        alas: cotas,
        info: { desarrollo: W, tramos: cotas.length },
        avisos: [
          conRet
            ? null
            : { nivel: 'aviso', msg: 'Sin retorno el perfil C se retuerce con la carga descentrada. Poné al menos 12 mm.' },
          angulos.length >= 4
            ? { nivel: 'info', msg: `${angulos.length} pliegues por pieza: en una serie larga el plegado pesa más que el corte. Verificá el tiempo antes de cerrar el precio.` }
            : null,
          p.largo > (LARGO_PLEGADORA)
            ? { nivel: 'error', msg: `${p.largo} mm no entra en la plegadora de 3200.` }
            : null,
          flecha > 0.5
            ? { nivel: 'aviso', msg: `Con ${p.largo} mm de luz conviene apoyo intermedio: la flecha crece con el cubo del largo.` }
            : null,
        ].filter(Boolean),
      };
    },
  },

  /* ---------------------------------------------------------------- */
  {
    id: 'peldano-escalera',
    nombre: 'Peldaño de escalera antideslizante',
    categoria: 'Plegado',
    descripcion:
      'Escalón plegado en U invertida con perforación antideslizante. Escaleras de servicio, plataformas, entrepisos.',
    params: [
      P('largo', 'Largo del peldaño', 800, { min: 150, unidad: 'mm' }),
      P('huella', 'Huella (profundidad)', 240, { min: 80, unidad: 'mm' }),
      P('ala', 'Altura del ala', 45, { min: 15, unidad: 'mm' }),
      P('diaAntid', 'Ø de la perforación antideslizante', 12, { min: 0, unidad: 'mm' }),
      P('pasoAntid', 'Paso de la perforación', 35, { min: 8, unidad: 'mm' }),
      P('diaUnion', 'Ø agujeros de fijación', 9, { min: 0, unidad: 'mm' }),
    ],
    build(p, ctx) {
      const t = ctx.espesor;
      const dev = calcularDesarrollo([p.ala, p.huella, p.ala], [90, 90], t, ctx.material, null, p.largo);
      const W = dev.desarrollo;
      const bd = dev.pliegues[0].BD;
      const x1 = p.ala - bd / 2;
      const x2 = x1 + p.huella - bd;

      const holes = [];
      if (p.diaAntid > 0) {
        /* Tresbolillo: el agujero al tresbolillo agarra el pie en cualquier
           posición. En grilla recta quedan corredores lisos entre columnas. */
        const m = 25;
        let fila = 0;
        for (let y = m; y <= p.largo - m; y += p.pasoAntid * 0.87) {
          const off = fila % 2 ? p.pasoAntid / 2 : 0;
          for (let x = x1 + m + off; x <= x2 - m; x += p.pasoAntid) {
            holes.push(circle(x, y, p.diaAntid / 2));
          }
          fila++;
        }
      }
      if (p.diaUnion > 0) {
        for (const y of [30, p.largo - 30]) {
          holes.push(circle(x1 / 2, y, p.diaUnion / 2));
          holes.push(circle((x2 + W) / 2, y, p.diaUnion / 2));
        }
      }

      return {
        shape: makeShape(rect(0, 0, W, p.largo, 0), holes),
        pliegues: [
          { x1, y1: 0, x2: x1, y2: p.largo, label: 'P1 90°' },
          { x1: x2, y1: 0, x2, y2: p.largo, label: 'P2 90°' },
        ],
        plegado: { pliegues: 2, largoPliegue: p.largo, angulo: 90, herramentales: 1 },
        desarrollo: dev,
        modelo3D: { tipo: 'perfil', tramos: [p.ala, p.huella, p.ala], angulos: [-90, -90], ancho: p.largo },
        alas: [p.ala, p.ala],
        info: { perforaciones: holes.length, desarrollo: W },
        avisos: [
          {
            nivel: 'info',
            msg:
              `${holes.length} perforaciones al tresbolillo. Es lo que más tiempo de máquina consume de esta pieza: ` +
              'si el peldaño va pintado y no a la intemperie, evaluá estampado antideslizante en vez de calado.',
          },
          p.huella < 200
            ? { nivel: 'aviso', msg: `Huella de ${p.huella} mm: por debajo de 200 mm no se pisa cómodo en una escalera de uso frecuente.` }
            : null,
        ].filter(Boolean),
      };
    },
  },

  /* ---------------------------------------------------------------- */
  {
    id: 'abrazadera-cano',
    nombre: 'Abrazadera para caño',
    categoria: 'Plegado',
    descripcion:
      'Grampa tipo omega para sujetar caño o conducto. Sale de a pares y es de los trabajos más repetidos que entran al taller.',
    params: [
      P('diaCano', 'Ø exterior del caño', 60, { min: 6, unidad: 'mm' }),
      P('ancho', 'Ancho de la abrazadera', 30, { min: 8, unidad: 'mm' }),
      P('pata', 'Largo de la pata', 35, { min: 10, unidad: 'mm' }),
      P('diaBulon', 'Ø agujero del bulón', 9, { min: 0, unidad: 'mm' }),
      S('vuelta', 'Abrazadera', 'media', [
        { v: 'media', t: 'Media caña (de a pares)' },
        { v: 'entera', t: 'Vuelta entera con pata doble' },
      ]),
    ],
    build(p, ctx) {
      const t = ctx.espesor;
      /* El desarrollo del arco va por la FIBRA NEUTRA, no por el diámetro
         exterior: si se toma el exterior la abrazadera queda larga y no
         aprieta. Con radio de curvado igual al del caño, el K vale ~0,44 y
         acá se usa el mismo del material. */
      const k = kFactorEfectivo(p.diaCano / 2, t, ctx.material?.kFactor ?? 0.42);
      const rNeutro = p.diaCano / 2 + k * t;
      const barrido = p.vuelta === 'entera' ? Math.PI * 2 * 0.75 : Math.PI;
      const arcoDes = rNeutro * barrido;
      const nPatas = p.vuelta === 'entera' ? 2 : 2;
      const W = arcoDes + nPatas * p.pata;

      const holes = [];
      if (p.diaBulon > 0) {
        holes.push(circle(p.pata / 2, p.ancho / 2, p.diaBulon / 2));
        holes.push(circle(W - p.pata / 2, p.ancho / 2, p.diaBulon / 2));
      }

      return {
        shape: makeShape(rect(0, 0, W, p.ancho, 0), holes),
        // El arco se rola o se pliega en varios golpes; las dos líneas que
        // marca el DXF son donde arranca y termina la curva.
        pliegues: [
          { x1: p.pata, y1: 0, x2: p.pata, y2: p.ancho, label: 'inicio del arco' },
          { x1: W - p.pata, y1: 0, x2: W - p.pata, y2: p.ancho, label: 'fin del arco' },
        ],
        plegado: { pliegues: 2, largoPliegue: p.ancho, angulo: 90, herramentales: 1 },
        modelo3D: { tipo: 'revolucion', d1: p.diaCano, d2: p.diaCano, h: p.ancho },
        info: { desarrollo: W, arcoDesarrollado: arcoDes, radioNeutro: rNeutro, kFactor: k },
        avisos: [
          {
            nivel: 'info',
            msg:
              `Desarrollo ${W.toFixed(1)} mm: ${arcoDes.toFixed(1)} mm de arco (fibra neutra a R ${rNeutro.toFixed(1)} mm, ` +
              `K=${k.toFixed(2)}) más ${nPatas} patas de ${p.pata} mm. Tomar el diámetro exterior deja la abrazadera larga y no aprieta.`,
          },
          p.diaCano < t * 6
            ? { nivel: 'aviso', msg: `Caño de ${p.diaCano} mm con chapa de ${t} mm: el radio es muy cerrado para este espesor, la fibra exterior puede fisurar. Usá chapa más fina.` }
            : null,
        ].filter(Boolean),
      };
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
