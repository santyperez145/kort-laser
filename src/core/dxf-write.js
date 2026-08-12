/**
 * KORT - Escritor DXF
 *
 * Genera DXF R12 ASCII: el formato que TODOS los CAM de láser leen sin chistar
 * (Cypcut, FSCut, Lantek, RDWorks, LightBurn, AutoCAD, SolidWorks...).
 *
 * Emite entidades LINE y ARC sueltas en vez de polilíneas: cualquier CAM las
 * une por proximidad y evita los problemas de compatibilidad de LWPOLYLINE en
 * versiones viejas. Las líneas de plegado van en su propia capa para que no se
 * corten.
 */

import { TAU, deg, partesDe } from './geometry.js';

export const CAPAS = {
  CORTE: { nombre: 'CORTE', color: 7 },
  INTERIOR: { nombre: 'CORTE_INTERIOR', color: 5 },
  PLEGADO: { nombre: 'PLEGADO', color: 1 },
  GRABADO: { nombre: 'GRABADO', color: 4 },
  COTAS: { nombre: 'COTAS', color: 3 },
  TEXTO: { nombre: 'TEXTO', color: 2 },
  AUXILIAR: { nombre: 'AUXILIAR', color: 8 },
};

class DxfBuilder {
  constructor() {
    this.out = [];
  }
  p(code, value) {
    this.out.push(String(code));
    this.out.push(String(value));
    return this;
  }
  toString() {
    return this.out.join('\r\n') + '\r\n';
  }
}

const f = (n) => (Math.abs(n) < 1e-10 ? '0.0' : n.toFixed(6));

function header(b, bbox) {
  b.p(0, 'SECTION').p(2, 'HEADER');
  b.p(9, '$ACADVER').p(1, 'AC1009');
  b.p(9, '$INSUNITS').p(70, 4); // 4 = milímetros
  b.p(9, '$MEASUREMENT').p(70, 1); // métrico
  b.p(9, '$EXTMIN').p(10, f(bbox.minX)).p(20, f(bbox.minY)).p(30, '0.0');
  b.p(9, '$EXTMAX').p(10, f(bbox.maxX)).p(20, f(bbox.maxY)).p(30, '0.0');
  b.p(0, 'ENDSEC');
}

function tables(b, capas) {
  b.p(0, 'SECTION').p(2, 'TABLES');

  b.p(0, 'TABLE').p(2, 'LTYPE').p(70, 2);
  b.p(0, 'LTYPE').p(2, 'CONTINUOUS').p(70, 0).p(3, 'Solid line').p(72, 65).p(73, 0).p(40, '0.0');
  b.p(0, 'LTYPE').p(2, 'DASHED').p(70, 0).p(3, '__ __ __').p(72, 65).p(73, 2).p(40, '15.0').p(49, '10.0').p(49, '-5.0');
  b.p(0, 'ENDTAB');

  b.p(0, 'TABLE').p(2, 'LAYER').p(70, capas.length + 1);
  b.p(0, 'LAYER').p(2, '0').p(70, 0).p(62, 7).p(6, 'CONTINUOUS');
  for (const c of capas) {
    b.p(0, 'LAYER').p(2, c.nombre).p(70, 0).p(62, c.color).p(6, c.nombre === 'PLEGADO' ? 'DASHED' : 'CONTINUOUS');
  }
  b.p(0, 'ENDTAB');

  b.p(0, 'TABLE').p(2, 'STYLE').p(70, 1);
  b.p(0, 'STYLE').p(2, 'STANDARD').p(70, 0).p(40, '0.0').p(41, '1.0').p(50, '0.0').p(71, 0).p(42, '2.5').p(3, 'txt').p(4, '');
  b.p(0, 'ENDTAB');

  b.p(0, 'ENDSEC');
}

function entLine(b, layer, x1, y1, x2, y2) {
  b.p(0, 'LINE').p(8, layer).p(10, f(x1)).p(20, f(y1)).p(30, '0.0').p(11, f(x2)).p(21, f(y2)).p(31, '0.0');
}

function entCircle(b, layer, cx, cy, r) {
  b.p(0, 'CIRCLE').p(8, layer).p(10, f(cx)).p(20, f(cy)).p(30, '0.0').p(40, f(r));
}

/** DXF define los arcos SIEMPRE antihorario desde a1 hasta a2. */
function entArc(b, layer, cx, cy, r, a1deg, a2deg) {
  let s = ((a1deg % 360) + 360) % 360;
  let e = ((a2deg % 360) + 360) % 360;
  b.p(0, 'ARC').p(8, layer).p(10, f(cx)).p(20, f(cy)).p(30, '0.0').p(40, f(r)).p(50, f(s)).p(51, f(e));
}

function entText(b, layer, x, y, h, txt, rot = 0, align = 0) {
  b.p(0, 'TEXT').p(8, layer).p(10, f(x)).p(20, f(y)).p(30, '0.0').p(40, f(h)).p(1, String(txt));
  if (rot) b.p(50, f(rot));
  if (align) b.p(72, align).p(11, f(x)).p(21, f(y)).p(31, '0.0');
}

/** Escribe un segmento del modelo interno como entidad DXF. */
function writeSeg(b, layer, s) {
  if (s.t === 'L') {
    entLine(b, layer, s.x1, s.y1, s.x2, s.y2);
    return;
  }
  const sweep = Math.abs(s.a2 - s.a1);
  if (sweep >= TAU - 1e-6) {
    entCircle(b, layer, s.cx, s.cy, s.r);
    return;
  }
  // El modelo interno guarda sentido; DXF sólo acepta CCW, así que se invierte.
  if (s.ccw) entArc(b, layer, s.cx, s.cy, s.r, deg(s.a1), deg(s.a2));
  else entArc(b, layer, s.cx, s.cy, s.r, deg(s.a2), deg(s.a1));
}

function writePath(b, layer, p) {
  for (const s of p.segs) writeSeg(b, layer, s);
}

/**
 * Genera el DXF de una o varias piezas.
 *
 * @param {Array} shapes  [{ shape, dx, dy, nombre }] o [Shape]
 * @param {Object} opts
 *   lineasPlegado : [{x1,y1,x2,y2,label}]  en capa PLEGADO
 *   grabados      : [Path]                 en capa GRABADO
 *   textos        : [{x,y,h,txt}]
 *   marco         : {w,h} dibuja el contorno de la chapa en AUXILIAR
 *   titulo        : string, cartela informativa
 */
export function generarDXF(shapes, opts = {}) {
  const b = new DxfBuilder();
  const lista = shapes.map((s) => (s.shape ? s : { shape: s, dx: 0, dy: 0 }));

  // BBox global
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
  for (const { shape, dx = 0, dy = 0 } of lista) {
    for (const p of partesDe(shape).flatMap((x) => [x.outer, ...(x.holes || [])])) {
      for (const s of p.segs) {
        if (s.t === 'L') {
          track(s.x1 + dx, s.y1 + dy);
          track(s.x2 + dx, s.y2 + dy);
        } else {
          track(s.cx + dx - s.r, s.cy + dy - s.r);
          track(s.cx + dx + s.r, s.cy + dy + s.r);
        }
      }
    }
  }
  if (!isFinite(minX)) {
    minX = minY = 0;
    maxX = maxY = 100;
  }
  if (opts.marco) {
    track(0, 0);
    track(opts.marco.w, opts.marco.h);
  }

  header(b, { minX, minY, maxX, maxY });
  tables(b, Object.values(CAPAS));

  b.p(0, 'SECTION').p(2, 'ENTITIES');

  if (opts.marco) {
    const { w, h } = opts.marco;
    entLine(b, CAPAS.AUXILIAR.nombre, 0, 0, w, 0);
    entLine(b, CAPAS.AUXILIAR.nombre, w, 0, w, h);
    entLine(b, CAPAS.AUXILIAR.nombre, w, h, 0, h);
    entLine(b, CAPAS.AUXILIAR.nombre, 0, h, 0, 0);
  }

  for (const { shape, dx = 0, dy = 0 } of lista) {
    const mv = (p) => ({
      closed: p.closed,
      segs: p.segs.map((s) =>
        s.t === 'L'
          ? { ...s, x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy }
          : { ...s, cx: s.cx + dx, cy: s.cy + dy }
      ),
    });
    // Cada parte lleva su exterior a la capa de CORTE y sus interiores a la
    // de INTERIOR: el CAM distingue por capa qué cae y qué queda.
    for (const parte of partesDe(shape)) {
      writePath(b, CAPAS.CORTE.nombre, mv(parte.outer));
      for (const h of parte.holes || []) writePath(b, CAPAS.INTERIOR.nombre, mv(h));
    }
    for (const g of shape.grabados || []) writePath(b, CAPAS.GRABADO.nombre, mv(g));
    for (const lp of shape.pliegues || []) {
      entLine(b, CAPAS.PLEGADO.nombre, lp.x1 + dx, lp.y1 + dy, lp.x2 + dx, lp.y2 + dy);
      if (lp.label) {
        entText(b, CAPAS.PLEGADO.nombre, lp.x1 + dx + 2, (lp.y1 + lp.y2) / 2 + dy, 3, lp.label, 90);
      }
    }
  }

  for (const lp of opts.lineasPlegado || []) {
    entLine(b, CAPAS.PLEGADO.nombre, lp.x1, lp.y1, lp.x2, lp.y2);
    if (lp.label) entText(b, CAPAS.PLEGADO.nombre, lp.x1 + 2, lp.y1 + 2, 3, lp.label);
  }
  for (const g of opts.grabados || []) writePath(b, CAPAS.GRABADO.nombre, g);
  for (const t of opts.textos || []) entText(b, CAPAS.TEXTO.nombre, t.x, t.y, t.h || 5, t.txt, t.rot || 0);

  if (opts.titulo) {
    const y = minY - 18;
    entText(b, CAPAS.TEXTO.nombre, minX, y, 6, opts.titulo);
    if (opts.subtitulo) entText(b, CAPAS.TEXTO.nombre, minX, y - 9, 3.5, opts.subtitulo);
  }

  b.p(0, 'ENDSEC');
  b.p(0, 'EOF');
  return b.toString();
}

/** DXF del layout completo de nesting (una chapa por archivo). */
export function generarDXFNesting(chapaLayout, shapesById, opts = {}) {
  const items = [];
  for (const p of chapaLayout.piezas) {
    const base = shapesById[p.id];
    if (!base) continue;
    const shape = p.rot ? rotar90(base) : base;
    items.push({ shape, dx: p.x, dy: p.y });
  }
  return generarDXF(items, {
    ...opts,
    marco: { w: chapaLayout.w, h: chapaLayout.h },
    titulo: opts.titulo || `KORT - Chapa ${chapaLayout.indice} - ${chapaLayout.w}x${chapaLayout.h} mm`,
    subtitulo: `Aprovechamiento ${(chapaLayout.aprovechamiento * 100).toFixed(1)} % - ${chapaLayout.piezas.length} piezas`,
  });
}

function rotar90(shape) {
  const rp = (p) => ({
    closed: p.closed,
    segs: p.segs.map((s) =>
      s.t === 'L'
        ? { t: 'L', x1: -s.y1, y1: s.x1, x2: -s.y2, y2: s.x2 }
        : { ...s, cx: -s.cy, cy: s.cx, a1: s.a1 + Math.PI / 2, a2: s.a2 + Math.PI / 2 }
    ),
  });
  const out = { ...shape, outer: rp(shape.outer), holes: (shape.holes || []).map(rp) };
  // Reubicar al primer cuadrante
  let minX = Infinity,
    minY = Infinity;
  for (const p of [out.outer, ...out.holes]) {
    for (const s of p.segs) {
      if (s.t === 'L') {
        minX = Math.min(minX, s.x1, s.x2);
        minY = Math.min(minY, s.y1, s.y2);
      } else {
        minX = Math.min(minX, s.cx - s.r);
        minY = Math.min(minY, s.cy - s.r);
      }
    }
  }
  const mv = (p) => ({
    closed: p.closed,
    segs: p.segs.map((s) =>
      s.t === 'L'
        ? { ...s, x1: s.x1 - minX, y1: s.y1 - minY, x2: s.x2 - minX, y2: s.y2 - minY }
        : { ...s, cx: s.cx - minX, cy: s.cy - minY }
    ),
  });
  return { ...out, outer: mv(out.outer), holes: out.holes.map(mv) };
}

export { rotar90 };
