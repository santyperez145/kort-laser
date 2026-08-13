/**
 * KORT - Lector DXF
 *
 * El cliente manda un DXF por WhatsApp y en 3 segundos tenés el precio.
 * Esto es, en la práctica, la función que más tiempo ahorra del sistema.
 *
 * Soporta: LINE, CIRCLE, ARC, LWPOLYLINE (con bulge), POLYLINE/VERTEX,
 * ELLIPSE, SPLINE (evaluación B-spline real) y BLOCKS/INSERT anidados.
 *
 * Después de leer las entidades:
 *   1. las encadena por proximidad en contornos cerrados,
 *   2. detecta qué contorno está adentro de cuál (agujero vs. pieza),
 *   3. separa piezas independientes que vengan en el mismo archivo,
 *   4. avisa de problemas típicos: contornos abiertos, líneas duplicadas,
 *      dibujo en pulgadas, agujeros más chicos que el espesor.
 */

import {
  line, arc, rad, deg, pathArea, pathBBox, pointInPath, flattenPath, TAU,
  makeShapeMulti, shapeBBox,
} from './geometry.js';

const TOL = 0.05; // mm de tolerancia para unir extremos

/* ------------------------------------------------------------------ */
/* Parseo de pares código/valor                                        */
/* ------------------------------------------------------------------ */

function parsePairs(text) {
  const lines = text.split(/\r\n|\r|\n/);
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (Number.isNaN(code)) {
      i--; // línea desalineada: reintenta el sincronismo
      continue;
    }
    pairs.push([code, lines[i + 1]]);
  }
  return pairs;
}

function num(v) {
  const n = parseFloat(String(v).trim());
  return Number.isNaN(n) ? 0 : n;
}

/** Agrupa los pares en entidades (cada código 0 abre una nueva). */
function agruparEntidades(pairs, desde, hasta) {
  const ents = [];
  let cur = null;
  for (let i = desde; i < hasta; i++) {
    const [code, value] = pairs[i];
    if (code === 0) {
      if (cur) ents.push(cur);
      cur = { tipo: String(value).trim().toUpperCase(), pares: [] };
    } else if (cur) {
      cur.pares.push([code, value]);
    }
  }
  if (cur) ents.push(cur);
  return ents;
}

function get(ent, code, def = 0) {
  for (const [c, v] of ent.pares) if (c === code) return num(v);
  return def;
}
function getStr(ent, code, def = '') {
  for (const [c, v] of ent.pares) if (c === code) return String(v).trim();
  return def;
}
function getAll(ent, code) {
  const out = [];
  for (const [c, v] of ent.pares) if (c === code) out.push(num(v));
  return out;
}

/* ------------------------------------------------------------------ */
/* Conversión de entidades a segmentos                                 */
/* ------------------------------------------------------------------ */

/** Arco desde dos puntos y bulge (tan(θ/4)) de LWPOLYLINE. */
function bulgeToArc(p1, p2, bulge) {
  const theta = 4 * Math.atan(bulge);
  const chord = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
  if (chord < 1e-9 || Math.abs(theta) < 1e-9) return line(p1[0], p1[1], p2[0], p2[1]);
  const r = Math.abs(chord / (2 * Math.sin(theta / 2)));
  const mid = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
  const h = Math.sqrt(Math.max(0, r * r - (chord / 2) ** 2));
  const dx = (p2[0] - p1[0]) / chord;
  const dy = (p2[1] - p1[1]) / chord;
  const sign = bulge > 0 ? 1 : -1;
  const cx = mid[0] - sign * h * dy * (Math.abs(theta) > Math.PI ? -1 : 1);
  const cy = mid[1] + sign * h * dx * (Math.abs(theta) > Math.PI ? -1 : 1);
  const a1 = Math.atan2(p1[1] - cy, p1[0] - cx);
  const a2 = Math.atan2(p2[1] - cy, p2[0] - cx);
  return arc(cx, cy, r, a1, a2, bulge > 0);
}

/** Evaluación de B-spline (de Boor) para SPLINE. */
function evalBSpline(ctrl, knots, degree, t) {
  const n = ctrl.length - 1;
  let k = degree;
  while (k < n && knots[k + 1] <= t) k++;
  const d = [];
  for (let j = 0; j <= degree; j++) {
    const idx = Math.min(Math.max(k - degree + j, 0), n);
    d[j] = [ctrl[idx][0], ctrl[idx][1]];
  }
  for (let r = 1; r <= degree; r++) {
    for (let j = degree; j >= r; j--) {
      const i = k - degree + j;
      const den = knots[i + degree - r + 1] - knots[i];
      const a = den === 0 ? 0 : (t - knots[i]) / den;
      d[j] = [(1 - a) * d[j - 1][0] + a * d[j][0], (1 - a) * d[j - 1][1] + a * d[j][1]];
    }
  }
  return d[degree];
}

function splineToSegs(ent) {
  const xs = [];
  const pares = ent.pares;
  const ctrl = [];
  const fit = [];
  let curX = null;
  for (const [c, v] of pares) {
    if (c === 10) curX = num(v);
    else if (c === 20 && curX != null) {
      ctrl.push([curX, num(v)]);
      curX = null;
    } else if (c === 11) curX = num(v);
    else if (c === 21 && curX != null) {
      fit.push([curX, num(v)]);
      curX = null;
    }
  }
  const knots = getAll(ent, 40);
  const degree = get(ent, 71, 3);
  const flags = get(ent, 70, 0);
  const cerrada = (flags & 1) === 1;

  let pts = [];
  if (ctrl.length > degree && knots.length >= ctrl.length + degree + 1) {
    const t0 = knots[degree];
    const t1 = knots[ctrl.length];
    const n = Math.max(16, Math.min(400, ctrl.length * 12));
    for (let i = 0; i <= n; i++) {
      const t = t0 + ((t1 - t0) * i) / n;
      pts.push(evalBSpline(ctrl, knots, degree, Math.min(t, t1 - 1e-9)));
    }
  } else {
    pts = fit.length ? fit : ctrl;
  }
  const segs = [];
  for (let i = 0; i < pts.length - 1; i++) segs.push(line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]));
  if (cerrada && pts.length > 2) {
    const a = pts[pts.length - 1];
    const b = pts[0];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) > TOL) segs.push(line(a[0], a[1], b[0], b[1]));
  }
  return { segs, aprox: true };
}

function ellipseToSegs(ent) {
  const cx = get(ent, 10);
  const cy = get(ent, 20);
  const mx = get(ent, 11);
  const my = get(ent, 21);
  const ratio = get(ent, 40, 1);
  let p1 = get(ent, 41, 0);
  let p2 = get(ent, 42, TAU);
  const a = Math.hypot(mx, my);
  const b = a * ratio;
  const rot = Math.atan2(my, mx);
  if (Math.abs(p2 - p1) < 1e-9) p2 = p1 + TAU;
  const n = Math.max(24, Math.ceil((Math.abs(p2 - p1) / TAU) * 96));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = p1 + ((p2 - p1) * i) / n;
    const x = a * Math.cos(t);
    const y = b * Math.sin(t);
    pts.push([cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]);
  }
  const segs = [];
  for (let i = 0; i < pts.length - 1; i++) segs.push(line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]));
  return { segs, aprox: true };
}

function lwpolyToSegs(ent) {
  const verts = [];
  let cur = {};
  for (const [c, v] of ent.pares) {
    if (c === 10) {
      if (cur.x != null) verts.push(cur);
      cur = { x: num(v), bulge: 0 };
    } else if (c === 20) cur.y = num(v);
    else if (c === 42) cur.bulge = num(v);
  }
  if (cur.x != null) verts.push(cur);
  const cerrada = (get(ent, 70, 0) & 1) === 1;
  const segs = [];
  const n = verts.length;
  const lim = cerrada ? n : n - 1;
  for (let i = 0; i < lim; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % n];
    if (a.y == null || b.y == null) continue;
    if (Math.abs(a.bulge) > 1e-9) segs.push(bulgeToArc([a.x, a.y], [b.x, b.y], a.bulge));
    else segs.push(line(a.x, a.y, b.x, b.y));
  }
  return { segs, cerrada };
}

/** Convierte una entidad a segmentos, aplicando una transformación. */
function entToSegs(ent, vertices = []) {
  switch (ent.tipo) {
    case 'LINE':
      return { segs: [line(get(ent, 10), get(ent, 20), get(ent, 11), get(ent, 21))] };
    case 'CIRCLE':
      return { segs: [arc(get(ent, 10), get(ent, 20), get(ent, 40), 0, TAU, true)], cerrada: true };
    case 'ARC': {
      const a1 = rad(get(ent, 50));
      const a2 = rad(get(ent, 51));
      return { segs: [arc(get(ent, 10), get(ent, 20), get(ent, 40), a1, a2, true)] };
    }
    case 'LWPOLYLINE':
      return lwpolyToSegs(ent);
    case 'POLYLINE': {
      const cerrada = (get(ent, 70, 0) & 1) === 1;
      const segs = [];
      const n = vertices.length;
      const lim = cerrada ? n : n - 1;
      for (let i = 0; i < lim; i++) {
        const a = vertices[i];
        const b = vertices[(i + 1) % n];
        if (Math.abs(a.bulge) > 1e-9) segs.push(bulgeToArc([a.x, a.y], [b.x, b.y], a.bulge));
        else segs.push(line(a.x, a.y, b.x, b.y));
      }
      return { segs, cerrada };
    }
    case 'ELLIPSE':
      return ellipseToSegs(ent);
    case 'SPLINE':
      return splineToSegs(ent);
    default:
      return null;
  }
}

function transformSegs(segs, { dx = 0, dy = 0, rot = 0, sx = 1, sy = 1 }) {
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const tp = (x, y) => {
    const X = x * sx;
    const Y = y * sy;
    return [X * cos - Y * sin + dx, X * sin + Y * cos + dy];
  };
  return segs.map((s) => {
    if (s.t === 'L') {
      const [x1, y1] = tp(s.x1, s.y1);
      const [x2, y2] = tp(s.x2, s.y2);
      return line(x1, y1, x2, y2);
    }
    const [cx, cy] = tp(s.cx, s.cy);
    return arc(cx, cy, s.r * Math.abs(sx), s.a1 + rot, s.a2 + rot, s.ccw);
  });
}

/* ------------------------------------------------------------------ */
/* Encadenado de segmentos en contornos                                */
/* ------------------------------------------------------------------ */

function segEnds(s) {
  if (s.t === 'L') return [[s.x1, s.y1], [s.x2, s.y2]];
  const p1 = [s.cx + s.r * Math.cos(s.a1), s.cy + s.r * Math.sin(s.a1)];
  const p2 = [s.cx + s.r * Math.cos(s.a2), s.cy + s.r * Math.sin(s.a2)];
  return [p1, p2];
}

function reverseSeg(s) {
  if (s.t === 'L') return line(s.x2, s.y2, s.x1, s.y1);
  return arc(s.cx, s.cy, s.r, s.a2, s.a1, !s.ccw);
}

function cerca(a, b, tol = TOL) {
  return Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol;
}

/** Une segmentos sueltos en cadenas; marca cuáles quedaron abiertas. */
export function encadenar(segs, tol = TOL) {
  const pend = segs.map((s) => ({ s, usado: false }));
  const cadenas = [];

  // Los círculos completos ya son contornos cerrados
  for (const p of pend) {
    if (p.s.t === 'A' && Math.abs(p.s.a2 - p.s.a1) >= TAU - 1e-6) {
      p.usado = true;
      cadenas.push({ closed: true, segs: [p.s] });
    }
  }

  for (let i = 0; i < pend.length; i++) {
    if (pend[i].usado) continue;
    pend[i].usado = true;
    const chain = [pend[i].s];
    let [ini, fin] = segEnds(pend[i].s);

    let creció = true;
    while (creció) {
      creció = false;
      for (let j = 0; j < pend.length; j++) {
        if (pend[j].usado) continue;
        const [a, b] = segEnds(pend[j].s);
        if (cerca(fin, a, tol)) {
          chain.push(pend[j].s);
          fin = b;
        } else if (cerca(fin, b, tol)) {
          chain.push(reverseSeg(pend[j].s));
          fin = a;
        } else if (cerca(ini, b, tol)) {
          chain.unshift(pend[j].s);
          ini = a;
        } else if (cerca(ini, a, tol)) {
          chain.unshift(reverseSeg(pend[j].s));
          ini = b;
        } else continue;
        pend[j].usado = true;
        creció = true;
      }
    }
    cadenas.push({ closed: cerca(ini, fin, tol * 4), segs: chain });
  }
  return cadenas;
}

/* ------------------------------------------------------------------ */
/* Clasificación exterior / agujeros                                   */
/* ------------------------------------------------------------------ */

function puntoInterior(p) {
  const pts = flattenPath(p, 0.3);
  return pts[Math.floor(pts.length / 3)] || [0, 0];
}

export function clasificarContornos(cerrados) {
  const info = cerrados.map((p) => ({
    path: p,
    area: Math.abs(pathArea(p)),
    bbox: pathBBox(p),
    pt: puntoInterior(p),
    padres: [],
  }));
  info.sort((a, b) => b.area - a.area);

  for (let i = 0; i < info.length; i++) {
    for (let j = 0; j < info.length; j++) {
      if (i === j) continue;
      if (info[j].area <= info[i].area) continue;
      const b = info[j].bbox;
      const [x, y] = info[i].pt;
      if (x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) continue;
      if (pointInPath(info[j].path, x, y)) info[i].padres.push(j);
    }
  }

  const piezas = [];
  for (let i = 0; i < info.length; i++) {
    if (info[i].padres.length % 2 === 0) {
      piezas.push({ idx: i, outer: info[i].path, holes: [], area: info[i].area });
    }
  }
  for (let i = 0; i < info.length; i++) {
    if (info[i].padres.length % 2 === 1) {
      // El agujero pertenece al padre más chico (el más inmediato)
      let mejor = null;
      for (const pi of info[i].padres) {
        if (info[pi].padres.length % 2 !== 0) continue;
        if (!mejor || info[pi].area < info[mejor].area) mejor = pi;
      }
      const dest = piezas.find((p) => p.idx === mejor);
      if (dest) dest.holes.push(info[i].path);
      else piezas.push({ idx: i, outer: info[i].path, holes: [], area: info[i].area });
    }
  }
  return piezas.map((p) => ({ outer: p.outer, holes: p.holes, meta: {} }));
}

/* ------------------------------------------------------------------ */
/* API principal                                                       */
/* ------------------------------------------------------------------ */

/**
 * Lee un DXF completo.
 * @returns { piezas, abiertos, avisos, stats, unidades }
 */
export function leerDXF(texto, opts = {}) {
  const pairs = parsePairs(texto);
  const avisos = [];

  // --- Unidades del header
  let insunits = 4; // mm por defecto
  for (let i = 0; i < pairs.length - 1; i++) {
    if (pairs[i][0] === 9 && String(pairs[i][1]).trim() === '$INSUNITS') {
      for (let j = i + 1; j < Math.min(i + 4, pairs.length); j++) {
        if (pairs[j][0] === 70) {
          insunits = num(pairs[j][1]);
          break;
        }
      }
      break;
    }
  }
  const escalaUnidad = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000, 0: 1 }[insunits] ?? 1;
  const unidades = { 1: 'pulgadas', 2: 'pies', 4: 'mm', 5: 'cm', 6: 'm', 0: 'sin definir' }[insunits] || 'mm';

  // --- Localizar secciones
  const secciones = {};
  for (let i = 0; i < pairs.length - 1; i++) {
    if (pairs[i][0] === 0 && String(pairs[i][1]).trim() === 'SECTION' && pairs[i + 1][0] === 2) {
      const nombre = String(pairs[i + 1][1]).trim().toUpperCase();
      let fin = pairs.length;
      for (let j = i + 2; j < pairs.length; j++) {
        if (pairs[j][0] === 0 && String(pairs[j][1]).trim() === 'ENDSEC') {
          fin = j;
          break;
        }
      }
      secciones[nombre] = [i + 2, fin];
    }
  }

  // --- BLOQUES
  const bloques = {};
  if (secciones.BLOCKS) {
    const ents = agruparEntidades(pairs, secciones.BLOCKS[0], secciones.BLOCKS[1]);
    let actual = null;
    for (const e of ents) {
      if (e.tipo === 'BLOCK') {
        actual = { nombre: getStr(e, 2), bx: get(e, 10), by: get(e, 20), ents: [] };
        bloques[actual.nombre] = actual;
      } else if (e.tipo === 'ENDBLK') actual = null;
      else if (actual) actual.ents.push(e);
    }
  }

  // --- ENTIDADES
  const rango = secciones.ENTITIES || [0, pairs.length];
  const ents = agruparEntidades(pairs, rango[0], rango[1]);

  const capasIgnoradas = new Set((opts.ignorarCapas || ['COTAS', 'DIM', 'DIMENSIONS', 'DEFPOINTS', 'TEXTO', 'TEXT']).map((c) => c.toUpperCase()));
  const capasPlegado = new Set((opts.capasPlegado || ['PLEGADO', 'BEND', 'FOLD', 'DOBLEZ']).map((c) => c.toUpperCase()));
  const capasGrabado = new Set((opts.capasGrabado || ['GRABADO', 'ENGRAVE', 'MARCA', 'MARK']).map((c) => c.toUpperCase()));

  const segsCorte = [];
  const segsPlegado = [];
  const segsGrabado = [];
  let aproximaciones = 0;
  const tipos = {};
  const capas = {};

  function procesar(lista, tr, profundidad = 0) {
    if (profundidad > 6) return;
    for (let i = 0; i < lista.length; i++) {
      const e = lista[i];
      tipos[e.tipo] = (tipos[e.tipo] || 0) + 1;
      const capa = getStr(e, 8, '0').toUpperCase();
      capas[capa] = (capas[capa] || 0) + 1;

      if (e.tipo === 'INSERT') {
        const nombre = getStr(e, 2);
        const blk = bloques[nombre];
        if (!blk) continue;
        const t2 = {
          dx: tr.dx + (get(e, 10) * (tr.sx ?? 1)),
          dy: tr.dy + (get(e, 20) * (tr.sy ?? 1)),
          rot: (tr.rot || 0) + rad(get(e, 50, 0)),
          sx: (tr.sx ?? 1) * (get(e, 41, 1) || 1),
          sy: (tr.sy ?? 1) * (get(e, 42, 1) || 1),
        };
        const inner = blk.ents.map((be) => be);
        procesar(inner, { ...t2, dx: t2.dx - blk.bx * t2.sx, dy: t2.dy - blk.by * t2.sy }, profundidad + 1);
        continue;
      }

      if (capasIgnoradas.has(capa)) continue;
      if (['DIMENSION', 'TEXT', 'MTEXT', 'ATTDEF', 'ATTRIB', 'POINT', 'SOLID', 'HATCH', 'LEADER'].includes(e.tipo)) continue;

      let vertices = [];
      if (e.tipo === 'POLYLINE') {
        for (let j = i + 1; j < lista.length; j++) {
          if (lista[j].tipo === 'VERTEX') {
            vertices.push({ x: get(lista[j], 10), y: get(lista[j], 20), bulge: get(lista[j], 42, 0) });
          } else if (lista[j].tipo === 'SEQEND') {
            i = j;
            break;
          } else break;
        }
      }

      const r = entToSegs(e, vertices);
      if (!r || !r.segs.length) continue;
      if (r.aprox) aproximaciones++;
      const segs = transformSegs(r.segs, tr);
      if (capasPlegado.has(capa)) segsPlegado.push(...segs);
      else if (capasGrabado.has(capa)) segsGrabado.push(...segs);
      else segsCorte.push(...segs);
    }
  }

  procesar(ents, { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1 });

  // --- Escala de unidades
  const escalar = (segs) =>
    escalaUnidad === 1
      ? segs
      : segs.map((s) =>
          s.t === 'L'
            ? line(s.x1 * escalaUnidad, s.y1 * escalaUnidad, s.x2 * escalaUnidad, s.y2 * escalaUnidad)
            : arc(s.cx * escalaUnidad, s.cy * escalaUnidad, s.r * escalaUnidad, s.a1, s.a2, s.ccw)
        );

  const corte = escalar(segsCorte);
  if (escalaUnidad !== 1) avisos.push({ nivel: 'aviso', msg: `El archivo estaba en ${unidades}; se convirtió a mm (×${escalaUnidad}).` });

  if (!corte.length) {
    return { piezas: [], abiertos: [], avisos: [{ nivel: 'error', msg: 'No se encontraron entidades de corte en el DXF.' }], stats: { tipos, capas }, unidades };
  }

  // --- Encadenar y clasificar
  const cadenas = encadenar(corte, opts.tolerancia ?? TOL);
  const cerrados = cadenas.filter((c) => c.closed && c.segs.length);
  const abiertos = cadenas.filter((c) => !c.closed);

  if (abiertos.length) {
    avisos.push({
      nivel: 'aviso',
      msg: `${abiertos.length} contorno(s) abierto(s). El láser no los puede cortar como pieza: revisá extremos sin unir o aumentá la tolerancia.`,
    });
  }

  const piezas = clasificarContornos(cerrados);

  // --- Chequeos de fabricabilidad
  const espesor = opts.espesor || 0;
  if (espesor > 0) {
    let chicos = 0;
    for (const p of piezas) {
      for (const h of p.holes) {
        const b = pathBBox(h);
        const d = Math.min(b.w, b.h);
        if (d < espesor) chicos++;
      }
    }
    if (chicos) {
      avisos.push({
        nivel: 'aviso',
        msg: `${chicos} agujero(s) con diámetro menor al espesor (${espesor} mm). El láser puede no perforarlos limpio; conviene ≥ 1,2 × espesor.`,
      });
    }
  }

  if (aproximaciones) {
    avisos.push({
      nivel: 'info',
      msg: `${aproximaciones} curva(s) tipo spline/elipse fueron discretizadas. La longitud de corte tiene un error < 0,1 %.`,
    });
  }

  /**
   * El dibujo COMPLETO como una sola pieza, con las posiciones relativas tal
   * cual las dibujó el cliente.
   *
   * Es lo que hay que ofrecer primero. Un DXF con varios contornos sueltos no
   * es necesariamente un lote de piezas independientes: puede ser el diseño de
   * un cartel, un juego que se entrega armado, o piezas cuya separación en la
   * chapa es parte del pedido. Separarlas de oficio destruye el diseño y
   * además cotiza mal —cada una pasaría a anidarse por su cuenta, en otra
   * posición— sin que nadie se entere.
   *
   * Separar sigue estando, pero como decisión explícita de quien cotiza.
   */
  const conjunto = makeShapeMulti(piezas, { origen: 'dxf', partes: piezas.length });

  if (piezas.length > 1) {
    avisos.push({
      nivel: 'info',
      msg:
        `El dibujo tiene ${piezas.length} contornos exteriores. Se importa como UNA pieza, ` +
        'respetando el diseño y las posiciones. Si en realidad son piezas sueltas, podés separarlas.',
    });
  }

  const bbox = conjunto ? shapeBBox(conjunto) : null;
  if (bbox && Math.max(bbox.w, bbox.h) < 5) {
    avisos.push({ nivel: 'aviso', msg: 'La pieza mide menos de 5 mm. ¿El archivo estaba en metros o pulgadas?' });
  }

  return {
    piezas,
    conjunto,
    // Qué parece el dibujo: un diseño de varias partes o un lote de piezas
    // sueltas. Es una sugerencia con su motivo, no una decisión tomada.
    agrupamiento: analizarAgrupamiento(piezas),
    abiertos,
    plegado: escalar(segsPlegado),
    grabado: escalar(segsGrabado),
    avisos,
    unidades,
    stats: {
      tipos,
      capas,
      entidades: corte.length,
      contornosCerrados: cerrados.length,
      contornosAbiertos: abiertos.length,
    },
  };
}

/* ------------------------------------------------------------------ */
/* ¿Cartel o piezas sueltas?                                           */
/* ------------------------------------------------------------------ */

/**
 * Decide qué parece un dibujo con varios contornos exteriores.
 *
 * Es una de esas cosas que el sistema no puede saber con certeza —sólo el
 * cliente sabe si eso es un cartel o veinte piezas— pero sí puede mirar el
 * dibujo y proponer lo más probable, con el motivo a la vista para que el que
 * cotiza confirme o cambie en un clic.
 *
 * Las señales, por orden de peso:
 *
 *  · **Partes todas iguales** → casi seguro son piezas sueltas. Nadie diseña
 *    un cartel con veinte copias exactas de la misma forma; eso es un lote que
 *    alguien ya acomodó en el archivo.
 *  · **Partes muy juntas o encastradas** → es un diseño. Las letras de un
 *    cartel, un juego que se entrega armado o piezas cuya separación es parte
 *    del pedido están a milímetros unas de otras.
 *  · **Partes distintas y separadas** → ambiguo. Se respeta el archivo, que es
 *    lo seguro: separar de oficio rompe un diseño y además cotiza mal, porque
 *    cada parte pasaría a anidarse por su cuenta en otra posición.
 *
 * @returns {{sugerencia:'conjunto'|'sueltas', motivo:string, confianza:number, señales:object}}
 */
export function analizarAgrupamiento(piezas) {
  if (!piezas || piezas.length < 2) {
    return { sugerencia: 'conjunto', motivo: 'El dibujo tiene una sola pieza.', confianza: 1, señales: {} };
  }

  const cajas = piezas.map((p) => pathBBox(p.outer));
  const areas = piezas.map((p) => Math.abs(pathArea(p.outer)));

  // ¿Son todas del mismo tamaño? Se comparan área y proporciones.
  const areaMed = areas.reduce((a, b) => a + b, 0) / areas.length;
  const dispersionArea = Math.max(...areas.map((a) => Math.abs(a - areaMed))) / Math.max(areaMed, 1);
  const propor = cajas.map((b) => b.w / Math.max(b.h, 1e-6));
  const propMed = propor.reduce((a, b) => a + b, 0) / propor.length;
  const dispersionProp = Math.max(...propor.map((p) => Math.abs(p - propMed))) / Math.max(propMed, 1e-6);
  const todasIguales = dispersionArea < 0.02 && dispersionProp < 0.02;

  // ¿Qué tan juntas están? Se mide la separación mínima de cada parte con su
  // vecina más cercana, relativa al tamaño típico de las partes.
  const tamTipico = Math.sqrt(areaMed);
  let sumaGaps = 0;
  for (let i = 0; i < cajas.length; i++) {
    let mejor = Infinity;
    for (let j = 0; j < cajas.length; j++) {
      if (i === j) continue;
      const a = cajas[i];
      const b = cajas[j];
      const dx = Math.max(0, Math.max(a.minX - b.maxX, b.minX - a.maxX));
      const dy = Math.max(0, Math.max(a.minY - b.maxY, b.minY - a.maxY));
      const d = Math.hypot(dx, dy);
      if (d < mejor) mejor = d;
    }
    sumaGaps += mejor;
  }
  const gapMedio = sumaGaps / cajas.length;
  const gapRelativo = gapMedio / Math.max(tamTipico, 1e-6);
  const muyJuntas = gapRelativo < 0.25;

  const señales = {
    partes: piezas.length,
    todasIguales,
    gapMedioMM: gapMedio,
    gapRelativo,
    dispersionArea,
  };

  if (todasIguales) {
    return {
      sugerencia: 'sueltas',
      confianza: 0.85,
      motivo:
        `Las ${piezas.length} partes son idénticas entre sí. Eso suele ser un lote de la misma pieza ` +
        'que alguien ya acomodó en el archivo, no un diseño de varias partes.',
      señales,
    };
  }
  if (muyJuntas) {
    return {
      sugerencia: 'conjunto',
      confianza: 0.9,
      motivo:
        `Las partes están a ${gapMedio.toFixed(0)} mm entre sí, muy poco para su tamaño. ` +
        'Parece un solo diseño: un cartel, un juego que se entrega armado, o piezas cuya separación es parte del pedido.',
      señales,
    };
  }
  return {
    sugerencia: 'conjunto',
    confianza: 0.5,
    motivo:
      `Hay ${piezas.length} partes distintas y separadas: no se puede saber si es un diseño o un lote. ` +
      'Se respeta el archivo tal como vino, que es lo seguro. Si en realidad son piezas sueltas, cambialo acá.',
    señales,
  };
}

export { deg, rad };
