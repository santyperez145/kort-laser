/**
 * KORT - Núcleo geométrico
 *
 * Modelo de datos:
 *   Path      = { closed: bool, segs: Seg[] }
 *   Seg       = { t:'L', x1,y1,x2,y2 }                  (línea)
 *             | { t:'A', cx,cy,r,a1,a2,ccw }            (arco, ángulos en radianes)
 *   Shape     = { outer: Path, holes: Path[], meta:{} }
 *
 * Todas las unidades en milímetros. Ángulos internos en radianes.
 */

export const TAU = Math.PI * 2;

export const deg = (r) => (r * 180) / Math.PI;
export const rad = (d) => (d * Math.PI) / 180;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const round = (v, n = 3) => {
  const f = 10 ** n;
  return Math.round(v * f) / f;
};

/* ------------------------------------------------------------------ */
/* Constructores de segmentos                                          */
/* ------------------------------------------------------------------ */

export function line(x1, y1, x2, y2) {
  return { t: 'L', x1, y1, x2, y2 };
}

export function arc(cx, cy, r, a1, a2, ccw = true) {
  return { t: 'A', cx, cy, r, a1, a2, ccw };
}

/** Círculo completo como path cerrado de un solo arco. */
export function circle(cx, cy, r) {
  return { closed: true, segs: [arc(cx, cy, r, 0, TAU, true)] };
}

/** Polilínea desde lista de puntos [[x,y],...]. */
export function polyline(pts, closed = true) {
  const segs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    segs.push(line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]));
  }
  if (closed && pts.length > 2) {
    const a = pts[pts.length - 1];
    const b = pts[0];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) > 1e-6) segs.push(line(a[0], a[1], b[0], b[1]));
  }
  return { closed, segs };
}

/** Rectángulo con esquinas opcionalmente redondeadas. */
export function rect(x, y, w, h, r = 0) {
  if (!r || r <= 0) {
    return polyline([
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ]);
  }
  r = Math.min(r, w / 2, h / 2);
  const segs = [
    line(x + r, y, x + w - r, y),
    arc(x + w - r, y + r, r, -Math.PI / 2, 0, true),
    line(x + w, y + r, x + w, y + h - r),
    arc(x + w - r, y + h - r, r, 0, Math.PI / 2, true),
    line(x + w - r, y + h, x + r, y + h),
    arc(x + r, y + h - r, r, Math.PI / 2, Math.PI, true),
    line(x, y + h - r, x, y + r),
    arc(x + r, y + r, r, Math.PI, (3 * Math.PI) / 2, true),
  ];
  return { closed: true, segs };
}

/** Ranura / oblongo horizontal o vertical (agujero alargado). */
export function slot(cx, cy, length, width, angleDeg = 0) {
  const r = width / 2;
  const L = Math.max(0, length - width) / 2;
  const segs = [
    line(-L, -r, L, -r),
    arc(L, 0, r, -Math.PI / 2, Math.PI / 2, true),
    line(L, r, -L, r),
    arc(-L, 0, r, Math.PI / 2, (3 * Math.PI) / 2, true),
  ];
  return transformPath({ closed: true, segs }, { rot: rad(angleDeg), dx: cx, dy: cy });
}

/** Polígono regular de n lados inscripto en radio r. */
export function regularPolygon(cx, cy, r, n, rot = 0) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i * TAU) / n;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return polyline(pts);
}

/* ------------------------------------------------------------------ */
/* Discretización y métricas                                           */
/* ------------------------------------------------------------------ */

/** Punto sobre un arco en el parámetro t∈[0,1]. */
function arcPoint(s, t) {
  let { a1, a2 } = s;
  let sweep = a2 - a1;
  if (s.ccw) {
    while (sweep <= 0) sweep += TAU;
  } else {
    while (sweep >= 0) sweep -= TAU;
  }
  if (Math.abs(Math.abs(sweep) - TAU) < 1e-9 || Math.abs(a2 - a1) >= TAU - 1e-9) {
    sweep = s.ccw ? TAU : -TAU;
  }
  const a = a1 + sweep * t;
  return [s.cx + s.r * Math.cos(a), s.cy + s.r * Math.sin(a)];
}

/** Barrido angular efectivo de un arco (con signo). */
export function arcSweep(s) {
  let sweep = s.a2 - s.a1;
  if (Math.abs(sweep) >= TAU - 1e-9) return s.ccw ? TAU : -TAU;
  if (s.ccw) {
    while (sweep <= 0) sweep += TAU;
  } else {
    while (sweep >= 0) sweep -= TAU;
  }
  return sweep;
}

export function segStart(s) {
  return s.t === 'L' ? [s.x1, s.y1] : arcPoint(s, 0);
}
export function segEnd(s) {
  return s.t === 'L' ? [s.x2, s.y2] : arcPoint(s, 1);
}

export function segLength(s) {
  if (s.t === 'L') return Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
  return Math.abs(arcSweep(s)) * s.r;
}

/** Convierte un path a lista de puntos con tolerancia de cuerda. */
export function flattenPath(p, tol = 0.05) {
  const pts = [];
  for (const s of p.segs) {
    if (s.t === 'L') {
      if (!pts.length) pts.push([s.x1, s.y1]);
      pts.push([s.x2, s.y2]);
    } else {
      const sweep = Math.abs(arcSweep(s));
      // n a partir del error de cuerda: e = r(1-cos(Δ/2))
      const dmax = 2 * Math.acos(clamp(1 - tol / Math.max(s.r, 1e-6), -1, 1));
      const n = Math.max(6, Math.ceil(sweep / Math.max(dmax, 1e-3)));
      for (let i = 0; i <= n; i++) {
        const pt = arcPoint(s, i / n);
        if (i === 0 && pts.length) continue;
        pts.push(pt);
      }
    }
  }
  return pts;
}

export function pathLength(p) {
  return p.segs.reduce((a, s) => a + segLength(s), 0);
}

/**
 * Área con signo (positiva = antihorario). EXACTA, no aproximada: al polígono
 * de los extremos se le suma el área del segmento circular de cada arco,
 * (r²/2)·(θ − sen θ) con θ con signo. Aproximar el arco por un polígono
 * inscripto subestimaría el peso del material y, con él, el precio.
 */
export function pathArea(p) {
  const pts = p.segs.map((s) => segStart(s));
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  a /= 2;
  for (const s of p.segs) {
    if (s.t !== 'A') continue;
    const th = arcSweep(s);
    a += (s.r * s.r * (th - Math.sin(th))) / 2;
  }
  return a;
}

/** Bounding box exacto: incluye los puntos extremos de cada arco. */
export function pathBBox(p) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const track = (x, y) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  for (const s of p.segs) {
    if (s.t === 'L') {
      track(s.x1, s.y1);
      track(s.x2, s.y2);
      continue;
    }
    const [sx, sy] = segStart(s);
    const [ex, ey] = segEnd(s);
    track(sx, sy);
    track(ex, ey);
    // Los extremos de un arco caen en 0°, 90°, 180° y 270°
    const sweep = arcSweep(s);
    for (let k = 0; k < 4; k++) {
      const ang = (k * Math.PI) / 2;
      let d = ang - s.a1;
      if (sweep > 0) {
        d = ((d % TAU) + TAU) % TAU;
        if (d > sweep) continue;
      } else {
        d = -((((-d) % TAU) + TAU) % TAU);
        if (d < sweep) continue;
      }
      track(s.cx + s.r * Math.cos(ang), s.cy + s.r * Math.sin(ang));
    }
  }
  if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0, w: 0, h: 0 };
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

export function pathCentroid(p) {
  const b = pathBBox(p);
  return [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
}

/* ------------------------------------------------------------------ */
/* Transformaciones                                                    */
/* ------------------------------------------------------------------ */

export function transformPath(p, { dx = 0, dy = 0, rot = 0, sx = 1, sy = 1, mirrorX = false } = {}) {
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const mx = mirrorX ? -1 : 1;
  const tp = ([x, y]) => {
    x *= sx * mx;
    y *= sy;
    return [x * cos - y * sin + dx, x * sin + y * cos + dy];
  };
  const segs = p.segs.map((s) => {
    if (s.t === 'L') {
      const [x1, y1] = tp([s.x1, s.y1]);
      const [x2, y2] = tp([s.x2, s.y2]);
      return { t: 'L', x1, y1, x2, y2 };
    }
    const [cx, cy] = tp([s.cx, s.cy]);
    const scale = Math.abs(sx);
    let a1 = s.a1,
      a2 = s.a2,
      ccw = s.ccw;
    if (mirrorX) {
      a1 = Math.PI - s.a1;
      a2 = Math.PI - s.a2;
      ccw = !ccw;
    }
    return { t: 'A', cx, cy, r: s.r * scale, a1: a1 + rot, a2: a2 + rot, ccw };
  });
  return { closed: p.closed, segs };
}

export function transformShape(sh, tr) {
  return {
    ...sh,
    outer: transformPath(sh.outer, tr),
    holes: (sh.holes || []).map((h) => transformPath(h, tr)),
  };
}

/* ------------------------------------------------------------------ */
/* Shape (pieza)                                                       */
/* ------------------------------------------------------------------ */

export function makeShape(outer, holes = [], meta = {}) {
  return { outer, holes, meta };
}

export function shapeBBox(sh) {
  return pathBBox(sh.outer);
}

/** Área neta de material (exterior menos agujeros), en mm². */
export function shapeArea(sh) {
  const a = Math.abs(pathArea(sh.outer));
  const h = (sh.holes || []).reduce((s, p) => s + Math.abs(pathArea(p)), 0);
  return Math.max(0, a - h);
}

/** Longitud total de corte: contorno + todos los interiores, en mm. */
export function shapeCutLength(sh) {
  return pathLength(sh.outer) + (sh.holes || []).reduce((s, p) => s + pathLength(p), 0);
}

/** Cantidad de perforaciones (piercings) necesarias = contornos cerrados. */
export function shapePiercings(sh) {
  return 1 + (sh.holes || []).length;
}

/** Normaliza la pieza al primer cuadrante con margen opcional. */
export function normalizeShape(sh, margin = 0) {
  const b = shapeBBox(sh);
  return transformShape(sh, { dx: -b.minX + margin, dy: -b.minY + margin });
}

/** Lista plana de todos los paths de la pieza. */
export function allPaths(sh) {
  return [sh.outer, ...(sh.holes || [])];
}

/* ------------------------------------------------------------------ */
/* Utilidades de análisis para el motor de corte                       */
/* ------------------------------------------------------------------ */

/**
 * Descompone un path en "tramos cinemáticos" para el modelo de tiempo:
 * cada tramo tiene longitud y radio de curvatura (Infinity para rectas).
 */
export function kinematicSegments(p) {
  const out = [];
  for (const s of p.segs) {
    if (s.t === 'L') {
      out.push({ len: segLength(s), radius: Infinity });
    } else {
      const total = segLength(s);
      // Un arco largo se parte para que el modelo capture entradas/salidas.
      const n = Math.max(1, Math.ceil(total / 40));
      for (let i = 0; i < n; i++) out.push({ len: total / n, radius: s.r });
    }
  }
  return out;
}

/** Cuenta esquinas vivas (cambio de dirección > umbral) en un path. */
export function countCorners(p, thresholdDeg = 20) {
  const segs = p.segs;
  if (segs.length < 2) return 0;
  let n = 0;
  const dirAt = (s, end) => {
    if (s.t === 'L') return Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
    const sweep = arcSweep(s);
    const a = s.a1 + sweep * (end ? 1 : 0);
    return a + (sweep > 0 ? Math.PI / 2 : -Math.PI / 2);
  };
  const lim = p.closed ? segs.length : segs.length - 1;
  for (let i = 0; i < lim; i++) {
    const a = dirAt(segs[i], true);
    const b = dirAt(segs[(i + 1) % segs.length], false);
    let d = Math.abs(deg(b - a)) % 360;
    if (d > 180) d = 360 - d;
    if (d > thresholdDeg) n++;
  }
  return n;
}

/** Diámetro equivalente de un contorno interior (para reglas de fabricabilidad). */
export function equivalentDiameter(p) {
  const a = Math.abs(pathArea(p));
  return 2 * Math.sqrt(a / Math.PI);
}

/** Distancia mínima entre los bounding boxes de dos paths. */
export function bboxGap(p1, p2) {
  const a = pathBBox(p1);
  const b = pathBBox(p2);
  const dx = Math.max(0, Math.max(a.minX - b.maxX, b.minX - a.maxX));
  const dy = Math.max(0, Math.max(a.minY - b.maxY, b.minY - a.maxY));
  return Math.hypot(dx, dy);
}

/** ¿El punto está dentro del path? (ray casting sobre la versión aplanada) */
export function pointInPath(p, x, y) {
  const pts = flattenPath(p, 0.2);
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
