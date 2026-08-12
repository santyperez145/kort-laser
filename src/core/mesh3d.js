/**
 * KORT - Generador de modelo 3D
 *
 * La pieza se representa como una lista de CARAS PLANAS (cada una con su
 * contorno 3D y sus agujeros). Como toda pieza de chapa está formada por caras
 * planas, el modelo es exacto y el visor puede rellenarlas directamente con
 * regla par-impar: no hace falta triangular ni cargar ninguna librería 3D.
 *
 *   Face = { pts: [[x,y,z]...], holes: [[[x,y,z]...]], tipo: 'cara'|'canto' }
 */

import { flattenPath, rad, TAU, partesDe } from './geometry.js';

const P3 = (x, y, z) => [x, y, z];

/* ------------------------------------------------------------------ */
/* Chapa plana extruida                                                */
/* ------------------------------------------------------------------ */

export function meshPlano(shape, t) {
  const faces = [];

  const pared = (pts, invertir) => {
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-6) continue;
      const q = [P3(a[0], a[1], 0), P3(b[0], b[1], 0), P3(b[0], b[1], t), P3(a[0], a[1], t)];
      faces.push({ pts: invertir ? q.reverse() : q, holes: [], tipo: 'canto' });
    }
  };

  // Cada parte se extruye por separado: un cartel de letras sueltas tiene que
  // verse como letras sueltas, no como una sola chapa.
  for (const parte of partesDe(shape)) {
    const outer = flattenPath(parte.outer, 0.4);
    const holes = (parte.holes || []).map((h) => flattenPath(h, 0.4));

    faces.push({
      pts: outer.map(([x, y]) => P3(x, y, t)),
      holes: holes.map((h) => h.map(([x, y]) => P3(x, y, t))),
      tipo: 'cara',
    });
    faces.push({
      pts: outer.map(([x, y]) => P3(x, y, 0)).reverse(),
      holes: holes.map((h) => h.map(([x, y]) => P3(x, y, 0)).reverse()),
      tipo: 'cara',
    });

    pared(outer, false);
    for (const h of holes) pared(h, true);
  }
  return { faces, bbox: bboxDe(faces) };
}

/* ------------------------------------------------------------------ */
/* Perfil plegado (sección transversal extruida)                       */
/* ------------------------------------------------------------------ */

/**
 * Construye la línea media de la sección transversal a partir de los tramos
 * rectos y los ángulos de plegado, con los radios reales de doblado.
 * @param {number[]} tramos   cotas exteriores
 * @param {number[]} angulos  grados; positivo = giro antihorario
 * @param {number} t          espesor
 * @param {number} Ri         radio interno
 */
export function seccionPlegada(tramos, angulos, t, Ri) {
  const Rm = Ri + t / 2; // radio de la fibra media
  const pts = [[0, 0]];
  let x = 0;
  let y = 0;
  let dir = 0; // dirección actual en radianes

  for (let i = 0; i < tramos.length; i++) {
    const ang = angulos[i];
    // Longitud recta: se descuenta la parte que consume el radio en cada extremo
    let L = tramos[i];
    if (i > 0) L -= Math.tan(Math.abs(rad(angulos[i - 1])) / 2) * (Ri + t);
    if (i < tramos.length - 1 && ang != null) L -= Math.tan(Math.abs(rad(ang)) / 2) * (Ri + t);
    L = Math.max(L, 0.1);

    x += L * Math.cos(dir);
    y += L * Math.sin(dir);
    pts.push([x, y]);

    if (ang == null || i >= angulos.length) break;
    // Arco de doblado
    const a = rad(ang);
    const signo = Math.sign(a) || 1;
    const cx = x - Rm * signo * Math.sin(dir) * -1;
    const cy = y + Rm * signo * Math.cos(dir) * -1;
    const centro = [x - signo * Rm * Math.sin(dir), y + signo * Rm * Math.cos(dir)];
    const N = Math.max(4, Math.ceil(Math.abs(ang) / 12));
    const a0 = Math.atan2(y - centro[1], x - centro[0]);
    for (let k = 1; k <= N; k++) {
      const aa = a0 + (a * k) / N;
      pts.push([centro[0] + Rm * Math.cos(aa), centro[1] + Rm * Math.sin(aa)]);
    }
    x = pts[pts.length - 1][0];
    y = pts[pts.length - 1][1];
    dir += a;
  }
  return pts;
}

/** Desplaza una polilínea abierta una distancia d hacia su normal izquierda. */
function offsetPolilinea(pts, d) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    const L = Math.hypot(dx, dy) || 1;
    dx /= L;
    dy /= L;
    out.push([p[0] - dy * d, p[1] + dx * d]);
  }
  return out;
}

export function meshPerfil({ tramos, angulos, ancho }, t, Ri) {
  const media = seccionPlegada(tramos, angulos, t, Ri ?? t);
  const a = offsetPolilinea(media, t / 2);
  const b = offsetPolilinea(media, -t / 2);
  const perfil = [...a, ...b.slice().reverse()]; // sección cerrada

  const faces = [];
  // Tapas de los extremos
  faces.push({ pts: perfil.map(([x, y]) => P3(x, y, 0)), holes: [], tipo: 'canto' });
  faces.push({ pts: perfil.map(([x, y]) => P3(x, y, ancho)).reverse(), holes: [], tipo: 'canto' });
  // Superficies laterales
  for (let i = 0; i < perfil.length; i++) {
    const p1 = perfil[i];
    const p2 = perfil[(i + 1) % perfil.length];
    if (Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) < 1e-9) continue;
    faces.push({
      pts: [P3(p1[0], p1[1], 0), P3(p2[0], p2[1], 0), P3(p2[0], p2[1], ancho), P3(p1[0], p1[1], ancho)],
      holes: [],
      tipo: 'cara',
    });
  }
  return { faces, bbox: bboxDe(faces) };
}

/* ------------------------------------------------------------------ */
/* Bandeja / caja                                                      */
/* ------------------------------------------------------------------ */

function caja(x0, y0, z0, dx, dy, dz) {
  const p = (x, y, z) => P3(x0 + x, y0 + y, z0 + z);
  const f = [];
  f.push({ pts: [p(0, 0, dz), p(dx, 0, dz), p(dx, dy, dz), p(0, dy, dz)], holes: [], tipo: 'cara' });
  f.push({ pts: [p(0, dy, 0), p(dx, dy, 0), p(dx, 0, 0), p(0, 0, 0)], holes: [], tipo: 'cara' });
  f.push({ pts: [p(0, 0, 0), p(dx, 0, 0), p(dx, 0, dz), p(0, 0, dz)], holes: [], tipo: 'cara' });
  f.push({ pts: [p(dx, dy, 0), p(0, dy, 0), p(0, dy, dz), p(dx, dy, dz)], holes: [], tipo: 'cara' });
  f.push({ pts: [p(0, dy, 0), p(0, 0, 0), p(0, 0, dz), p(0, dy, dz)], holes: [], tipo: 'cara' });
  f.push({ pts: [p(dx, 0, 0), p(dx, dy, 0), p(dx, dy, dz), p(dx, 0, dz)], holes: [], tipo: 'cara' });
  return f;
}

export function meshBandeja({ L, A, H, t }) {
  const faces = [];
  faces.push(...caja(0, 0, 0, L, A, t)); // fondo
  faces.push(...caja(0, -t, 0, L, t, H)); // pared frontal
  faces.push(...caja(0, A, 0, L, t, H)); // pared trasera
  faces.push(...caja(-t, -t, 0, t, A + 2 * t, H)); // pared izquierda
  faces.push(...caja(L, -t, 0, t, A + 2 * t, H)); // pared derecha
  return { faces, bbox: bboxDe(faces) };
}

/* ------------------------------------------------------------------ */
/* Revolución (cono / cilindro)                                        */
/* ------------------------------------------------------------------ */

export function meshRevolucion({ d1, d2, h }, segmentos = 48) {
  const faces = [];
  const r1 = d1 / 2;
  const r2 = d2 / 2;
  for (let i = 0; i < segmentos; i++) {
    const a1 = (i * TAU) / segmentos;
    const a2 = ((i + 1) * TAU) / segmentos;
    faces.push({
      pts: [
        P3(r1 * Math.cos(a1), r1 * Math.sin(a1), 0),
        P3(r1 * Math.cos(a2), r1 * Math.sin(a2), 0),
        P3(r2 * Math.cos(a2), r2 * Math.sin(a2), h),
        P3(r2 * Math.cos(a1), r2 * Math.sin(a1), h),
      ],
      holes: [],
      tipo: 'cara',
    });
  }
  return { faces, bbox: bboxDe(faces) };
}

/* ------------------------------------------------------------------ */
/* Codo segmentado                                                     */
/* ------------------------------------------------------------------ */

export function meshCodo({ dia, radio, angulo, gajos }, segmentos = 32) {
  const faces = [];
  const r = dia / 2;
  const n = gajos + 2;
  const paso = rad(angulo) / (n - 1);
  const centros = [];
  for (let i = 0; i < n; i++) {
    const a = -rad(angulo) / 2 + paso * i;
    centros.push({ a, x: radio * Math.sin(a), z: radio * (1 - Math.cos(a)) });
  }
  for (let i = 0; i < n - 1; i++) {
    const c1 = centros[i];
    const c2 = centros[i + 1];
    for (let k = 0; k < segmentos; k++) {
      const t1 = (k * TAU) / segmentos;
      const t2 = ((k + 1) * TAU) / segmentos;
      const pt = (c, t) => {
        const ny = r * Math.sin(t);
        const nr = r * Math.cos(t);
        return P3(c.x + nr * Math.cos(c.a), ny, c.z + nr * Math.sin(c.a));
      };
      faces.push({ pts: [pt(c1, t1), pt(c1, t2), pt(c2, t2), pt(c2, t1)], holes: [], tipo: 'cara' });
    }
  }
  return { faces, bbox: bboxDe(faces) };
}

/* ------------------------------------------------------------------ */

function bboxDe(faces) {
  let min = [Infinity, Infinity, Infinity];
  let max = [-Infinity, -Infinity, -Infinity];
  for (const f of faces)
    for (const p of f.pts)
      for (let i = 0; i < 3; i++) {
        if (p[i] < min[i]) min[i] = p[i];
        if (p[i] > max[i]) max[i] = p[i];
      }
  return { min, max, centro: min.map((v, i) => (v + max[i]) / 2), tam: max.map((v, i) => v - min[i]) };
}

/** Punto de entrada: arma el modelo según lo que describa la pieza. */
export function construirMesh(pieza, t, Ri) {
  const m = pieza.modelo3D || { tipo: 'plano' };
  try {
    switch (m.tipo) {
      case 'perfil':
        return meshPerfil(m, t, Ri);
      case 'bandeja':
        return meshBandeja({ ...m, t });
      case 'revolucion':
        return meshRevolucion(m);
      case 'codo':
        return meshCodo(m);
      default:
        return meshPlano(pieza.shape, t);
    }
  } catch (e) {
    return meshPlano(pieza.shape, t);
  }
}
