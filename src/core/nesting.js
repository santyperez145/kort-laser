/**
 * KORT - Anidado (nesting) de piezas en chapa
 *
 * Dos motores:
 *
 *  1. RECTANGULAR (MaxRects + rotación). Rápido, seguro, y lo correcto
 *     cuando las piezas SON rectángulos.
 *
 *  2. FORMA REAL (perfil + skyline). Rasteriza el contorno de cada pieza en
 *     perfiles de altura por columna y las baja hasta donde tocan, como si
 *     las apoyaras contra las que ya están. Dos triángulos se encastran, los
 *     discos se meten en los huecos y una L abraza a la siguiente.
 *
 * Por qué importa tanto: en las cotizaciones reales el material es el 60 al
 * 90 % del costo. Ganar 8 puntos de aprovechamiento es ganar más plata que
 * cortar 8 % más rápido, y no cuesta nada.
 *
 * El resultado siempre queda del lado seguro: el perfil por columna trata a
 * la pieza como si estuviera llena entre su punto más bajo y el más alto de
 * cada columna, así que nunca promete un encastre que no entra.
 */

import { flattenPath, pathBBox } from './geometry.js';

/* ================================================================== */
/* Motor 1 · Rectangular (MaxRects, Best-Short-Side-Fit)              */
/* ================================================================== */

const R = (x, y, w, h) => ({ x, y, w, h });

function contiene(a, b) {
  return b.x >= a.x && b.y >= a.y && b.x + b.w <= a.x + a.w && b.y + b.h <= a.y + a.h;
}

class ChapaRect {
  constructor(w, h, margen) {
    this.w = w;
    this.h = h;
    this.margen = margen;
    this.libres = [R(margen, margen, w - 2 * margen, h - 2 * margen)];
    this.piezas = [];
    this.areaUsada = 0;
  }

  buscarPosicion(w, h, rotable) {
    let best = null;
    for (const f of this.libres) {
      if (f.w >= w && f.h >= h) {
        const l = [f.w - w, f.h - h];
        const shortFit = Math.min(...l);
        const longFit = Math.max(...l);
        if (!best || shortFit < best.shortFit || (shortFit === best.shortFit && longFit < best.longFit)) {
          best = { x: f.x, y: f.y, w, h, rot: false, shortFit, longFit };
        }
      }
      if (rotable && f.w >= h && f.h >= w) {
        const l = [f.w - h, f.h - w];
        const shortFit = Math.min(...l);
        const longFit = Math.max(...l);
        if (!best || shortFit < best.shortFit || (shortFit === best.shortFit && longFit < best.longFit)) {
          best = { x: f.x, y: f.y, w: h, h: w, rot: true, shortFit, longFit };
        }
      }
    }
    return best;
  }

  colocar(p) {
    const nuevos = [];
    for (const f of this.libres) if (!this.dividir(f, p, nuevos)) nuevos.push(f);
    this.libres = nuevos.filter((a, i) => !nuevos.some((b, j) => i !== j && contiene(b, a)));
    this.piezas.push(p);
    this.areaUsada += p.w * p.h;
  }

  dividir(f, p, out) {
    if (p.x >= f.x + f.w || p.x + p.w <= f.x || p.y >= f.y + f.h || p.y + p.h <= f.y) return false;
    if (p.x > f.x) out.push(R(f.x, f.y, p.x - f.x, f.h));
    if (p.x + p.w < f.x + f.w) out.push(R(p.x + p.w, f.y, f.x + f.w - (p.x + p.w), f.h));
    if (p.y > f.y) out.push(R(f.x, f.y, f.w, p.y - f.y));
    if (p.y + p.h < f.y + f.h) out.push(R(f.x, p.y + p.h, f.w, f.y + f.h - (p.y + p.h)));
    return true;
  }
}

function nestRectangular(items, chapa, opts) {
  const margen = opts.margen ?? 10;
  const sep = opts.separacion ?? 5;
  const maxChapas = opts.maxChapas ?? 200;

  const cola = [];
  for (const it of items) {
    for (let i = 0; i < (it.cantidad || 1); i++) {
      cola.push({
        id: it.id,
        nombre: it.nombre || it.id,
        wReal: it.w,
        hReal: it.h,
        w: it.w + sep,
        h: it.h + sep,
        rotable: it.rotable !== false,
      });
    }
  }
  cola.sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h) || b.w * b.h - a.w * a.h);

  const chapas = [];
  const noEntran = [];

  for (const pieza of cola) {
    let colocada = false;
    for (const ch of chapas) {
      const pos = ch.buscarPosicion(pieza.w, pieza.h, pieza.rotable);
      if (pos) {
        ch.colocar({ ...pos, id: pieza.id, nombre: pieza.nombre, wReal: pieza.wReal, hReal: pieza.hReal });
        colocada = true;
        break;
      }
    }
    if (colocada) continue;
    if (chapas.length >= maxChapas) {
      noEntran.push(pieza);
      continue;
    }
    const ch = new ChapaRect(chapa.w, chapa.h, margen);
    const pos = ch.buscarPosicion(pieza.w, pieza.h, pieza.rotable);
    if (!pos) {
      noEntran.push(pieza);
      continue;
    }
    ch.colocar({ ...pos, id: pieza.id, nombre: pieza.nombre, wReal: pieza.wReal, hReal: pieza.hReal });
    chapas.push(ch);
  }

  return {
    metodo: 'rectangular',
    chapas: chapas.map((ch, i) => ({
      indice: i + 1,
      w: chapa.w,
      h: chapa.h,
      margen,
      piezas: ch.piezas.map((p) => ({
        id: p.id, nombre: p.nombre, x: p.x, y: p.y, w: p.wReal, h: p.hReal, rot: p.rot ? 90 : 0,
      })),
      areaUsada: ch.areaUsada,
    })),
    noEntran,
  };
}

/* ================================================================== */
/* Motor 2 · Forma real (perfiles + skyline)                          */
/* ================================================================== */

/** Rota una polilínea y la reubica en el origen. */
function rotarPoly(pts, gradosCCW) {
  const a = (gradosCCW * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const rot = pts.map(([x, y]) => [x * c - y * s, x * s + y * c]);
  let minX = Infinity;
  let minY = Infinity;
  for (const [x, y] of rot) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
  }
  return rot.map(([x, y]) => [x - minX, y - minY]);
}

/**
 * Perfil de una pieza: para cada columna de `res` mm, el punto más bajo y el
 * más alto que ocupa. Es la representación que permite "apoyar" una pieza
 * sobre las que ya están colocadas.
 */
function perfilar(pts, res, gapPx) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const cols = Math.max(1, Math.ceil((maxX - minX) / res));
  const bottom = new Float64Array(cols).fill(Infinity);
  const top = new Float64Array(cols).fill(-Infinity);

  // Se recorre cada arista y se registra su altura en las columnas que cruza.
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    const n = Math.max(2, Math.ceil(Math.abs(x2 - x1) / (res / 2)) + 2);
    for (let k = 0; k <= n; k++) {
      const f = k / n;
      const x = x1 + (x2 - x1) * f - minX;
      const y = y1 + (y2 - y1) * f - minY;
      const c = Math.min(cols - 1, Math.max(0, Math.floor(x / res)));
      if (y < bottom[c]) bottom[c] = y;
      if (y > top[c]) top[c] = y;
    }
  }
  // Columnas que ninguna arista tocó (piezas muy finas): se rellenan
  for (let c = 0; c < cols; c++) {
    if (bottom[c] === Infinity) {
      let izq = c - 1;
      let der = c + 1;
      while (izq >= 0 && bottom[izq] === Infinity) izq--;
      while (der < cols && bottom[der] === Infinity) der++;
      const ref = izq >= 0 ? izq : der < cols ? der : -1;
      if (ref < 0) {
        bottom[c] = 0;
        top[c] = maxY - minY;
      } else {
        bottom[c] = bottom[ref];
        top[c] = top[ref];
      }
    }
  }

  // Dilatación por la separación entre piezas: se ensancha el perfil gapPx
  // columnas a cada lado tomando el mínimo del piso y el máximo del techo.
  let bot = bottom;
  let tp = top;
  let colsFinal = cols;
  if (gapPx > 0) {
    colsFinal = cols + 2 * gapPx;
    bot = new Float64Array(colsFinal).fill(Infinity);
    tp = new Float64Array(colsFinal).fill(-Infinity);
    for (let c = 0; c < colsFinal; c++) {
      for (let d = -gapPx; d <= gapPx; d++) {
        const src = c - gapPx + d;
        if (src < 0 || src >= cols) continue;
        if (bottom[src] < bot[c]) bot[c] = bottom[src];
        if (top[src] > tp[c]) tp[c] = top[src];
      }
      if (bot[c] === Infinity) {
        bot[c] = 0;
        tp[c] = 0;
      }
    }
  }

  return {
    cols: colsFinal,
    bottom: bot,
    top: tp,
    w: maxX - minX,
    h: maxY - minY,
    offsetX: gapPx * res, // dónde queda el origen real de la pieza dentro del perfil
    pts,
  };
}

class ChapaForma {
  constructor(w, h, margen, res) {
    this.w = w;
    this.h = h;
    this.margen = margen;
    this.res = res;
    this.cols = Math.floor((w - 2 * margen) / res);
    this.skyline = new Float64Array(this.cols).fill(0); // altura ocupada por columna
    this.piezas = [];
    this.areaUsada = 0;
    this.altoUtil = h - 2 * margen;
  }

  /** Busca la posición más baja (y luego más a la izquierda) donde entra. */
  buscar(perfil) {
    if (perfil.cols > this.cols) return null;
    let mejor = null;
    for (let x = 0; x + perfil.cols <= this.cols; x++) {
      let y = 0;
      for (let i = 0; i < perfil.cols; i++) {
        const necesita = this.skyline[x + i] - perfil.bottom[i];
        if (necesita > y) y = necesita;
      }
      // ¿Entra a lo alto?
      let cabe = true;
      for (let i = 0; i < perfil.cols; i++) {
        if (y + perfil.top[i] > this.altoUtil) {
          cabe = false;
          break;
        }
      }
      if (!cabe) continue;
      if (!mejor || y < mejor.y - 1e-9) mejor = { x, y };
      if (mejor && mejor.y <= 0) break; // no se puede hacer mejor que el piso
    }
    return mejor;
  }

  colocar(perfil, pos, meta) {
    for (let i = 0; i < perfil.cols; i++) {
      const nueva = pos.y + perfil.top[i];
      if (nueva > this.skyline[pos.x + i]) this.skyline[pos.x + i] = nueva;
    }
    const px = this.margen + pos.x * this.res + perfil.offsetX;
    const py = this.margen + pos.y;
    this.piezas.push({
      ...meta,
      x: px,
      y: py,
      w: perfil.w,
      h: perfil.h,
      poly: perfil.pts.map(([x, y]) => [x + px, y + py]),
    });
    this.areaUsada += meta.areaReal ?? perfil.w * perfil.h;
  }
}

function nestFormaReal(items, chapa, opts) {
  const margen = opts.margen ?? 10;
  const sep = opts.separacion ?? 5;
  const maxChapas = opts.maxChapas ?? 200;
  // Resolución del perfil: fina para piezas chicas, gruesa para chapas
  // grandes. 2 mm da buen encastre sin que el cálculo se note.
  const res = opts.resolucion ?? Math.max(1.5, Math.min(4, chapa.w / 900));
  const gapPx = Math.max(1, Math.round(sep / 2 / res));
  const rotaciones = opts.rotaciones ?? [0, 90, 180, 270];

  // Perfiles por pieza y rotación (se calculan una sola vez)
  const catalogo = new Map();
  for (const it of items) {
    const base = it.poly || (it.shape ? flattenPath(it.shape.outer, Math.min(0.4, res / 4)) : null);
    if (!base) return null; // sin geometría no hay forma real
    const rots = (it.rotable === false ? [0] : rotaciones).map((g) => ({
      grados: g,
      perfil: perfilar(rotarPoly(base, g), res, gapPx),
    }));
    catalogo.set(it.id, { rots, areaReal: it.areaReal });
  }

  const cola = [];
  for (const it of items) {
    for (let i = 0; i < (it.cantidad || 1); i++) {
      cola.push({ id: it.id, nombre: it.nombre || it.id, w: it.w, h: it.h });
    }
  }
  cola.sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h) || b.w * b.h - a.w * a.h);

  const chapas = [];
  const noEntran = [];

  for (const pieza of cola) {
    const cat = catalogo.get(pieza.id);
    let colocada = false;

    for (const ch of chapas) {
      let mejor = null;
      for (const r of cat.rots) {
        const pos = ch.buscar(r.perfil);
        if (!pos) continue;
        if (!mejor || pos.y < mejor.pos.y - 1e-9) mejor = { pos, r };
      }
      if (mejor) {
        ch.colocar(mejor.r.perfil, mejor.pos, {
          id: pieza.id, nombre: pieza.nombre, rot: mejor.r.grados, areaReal: cat.areaReal,
        });
        colocada = true;
        break;
      }
    }
    if (colocada) continue;
    if (chapas.length >= maxChapas) {
      noEntran.push(pieza);
      continue;
    }

    const ch = new ChapaForma(chapa.w, chapa.h, margen, res);
    let mejor = null;
    for (const r of cat.rots) {
      const pos = ch.buscar(r.perfil);
      if (!pos) continue;
      if (!mejor || pos.y < mejor.pos.y - 1e-9) mejor = { pos, r };
    }
    if (!mejor) {
      noEntran.push(pieza);
      continue;
    }
    ch.colocar(mejor.r.perfil, mejor.pos, {
      id: pieza.id, nombre: pieza.nombre, rot: mejor.r.grados, areaReal: cat.areaReal,
    });
    chapas.push(ch);
  }

  return {
    metodo: 'forma real',
    resolucion: res,
    chapas: chapas.map((ch, i) => ({
      indice: i + 1,
      w: chapa.w,
      h: chapa.h,
      margen,
      piezas: ch.piezas,
      areaUsada: ch.areaUsada,
      // Altura realmente ocupada: sirve para saber cuánto retazo útil queda
      alturaOcupada: Math.max(0, ...ch.skyline) + margen,
    })),
    noEntran,
  };
}

/* ================================================================== */
/* API                                                                 */
/* ================================================================== */

/**
 * @param {Array}  items  [{ id, nombre, w, h, cantidad, rotable, shape?, areaReal? }]
 * @param {Object} chapa  { w, h }
 * @param {Object} opts   { margen, separacion, maxChapas, formaReal, resolucion }
 */
export function nest(items, chapa, opts = {}) {
  const usarForma = opts.formaReal !== false && items.some((i) => i.shape || i.poly);

  let r = null;
  if (usarForma) {
    try {
      r = nestFormaReal(items, chapa, opts);
    } catch (e) {
      r = null; // ante cualquier problema, se cae al motor rectangular
    }
  }
  if (!r) r = nestRectangular(items, chapa, opts);

  const areaChapa = chapa.w * chapa.h;
  const totalPedidas = items.reduce((a, i) => a + (i.cantidad || 1), 0);
  const colocadas = r.chapas.reduce((a, c) => a + c.piezas.length, 0);
  const areaUsadaTotal = r.chapas.reduce((a, c) => a + c.areaUsada, 0);

  return {
    metodo: r.metodo,
    resolucion: r.resolucion,
    chapas: r.chapas.map((c) => ({ ...c, aprovechamiento: c.areaUsada / areaChapa })),
    cantidadChapas: r.chapas.length,
    piezasColocadas: colocadas,
    noEntran: (r.noEntran || []).map((p) => ({ id: p.id, nombre: p.nombre, w: p.wReal ?? p.w, h: p.hReal ?? p.h })),
    aprovechamientoGlobal: r.chapas.length ? areaUsadaTotal / (r.chapas.length * areaChapa) : 0,
    // Aprovechamiento de la última chapa: sirve para avisar "agregá 12 piezas
    // más y no te cuesta una chapa extra".
    aprovechamientoUltima: r.chapas.length ? r.chapas[r.chapas.length - 1].areaUsada / areaChapa : 0,
    areaChapa,
    areaConsumidaTotal: areaUsadaTotal,
    piezasPedidas: totalPedidas,
  };
}

/**
 * Cuántas piezas más entran en la última chapa antes de tener que comprar
 * otra. Es la sugerencia comercial más rentable que puede dar el sistema.
 */
export function piezasExtraSinCosto(items, chapa, opts = {}) {
  if (items.length !== 1) return null;
  const base = items[0];
  const n = base.cantidad || 1;
  const chapasBase = nest([{ ...base, cantidad: n }], chapa, opts).cantidadChapas;
  for (let extra = 1; extra < 300; extra++) {
    const r = nest([{ ...base, cantidad: n + extra }], chapa, opts);
    if (r.cantidadChapas > chapasBase || r.noEntran.length) return extra - 1;
  }
  return 300;
}

/**
 * Lo mismo pero para un lote de varias piezas distintas: cuántas unidades más
 * de CADA una entran sin que haya que comprar otra chapa.
 *
 * Es el número que más plata deja: el material de esa chapa ya está pagado, así
 * que esas piezas extra sólo cuestan tiempo de máquina y gas. Sirve para
 * ofrecerle repuestos al cliente en la misma entrega, o para hacer stock.
 *
 * ⚠️ **No va en el camino del cálculo del precio.** Cada tanteo es un nesting
 * completo, y el cotizador recalcula con cada tecla: metido ahí abajo dejaría
 * la pantalla pegajosa. Se llama a pedido, desde el visor de nesting.
 *
 * La búsqueda es por duplicación y después binaria (≈2·log n tanteos por ítem
 * en vez de n): probar de a uno hasta encontrar el tope costaba cientos de
 * nestings en lotes de piezas chicas.
 */
export function rellenoSinCosto(items, chapa, opts = {}) {
  const tope = opts.maxExtra ?? 500;
  const base = nest(items, chapa, opts);
  if (!base.cantidadChapas || base.noEntran?.length) return [];

  const entra = (k, extra) => {
    const prueba = items.map((it, i) =>
      i === k ? { ...it, cantidad: (it.cantidad || 1) + extra } : it
    );
    const r = nest(prueba, chapa, opts);
    return r.cantidadChapas <= base.cantidadChapas && !r.noEntran?.length;
  };

  const out = [];
  for (let k = 0; k < items.length; k++) {
    if (!entra(k, 1)) continue;

    // Duplicar hasta pasarse, para acotar el rango
    let bajo = 1;
    let alto = 2;
    while (alto <= tope && entra(k, alto)) {
      bajo = alto;
      alto *= 2;
    }
    if (alto > tope) {
      out.push({ id: items[k].id, nombre: items[k].nombre, extra: bajo, tope: true });
      continue;
    }
    // Binaria entre el último que entró y el primero que no
    while (alto - bajo > 1) {
      const medio = Math.floor((bajo + alto) / 2);
      if (entra(k, medio)) bajo = medio;
      else alto = medio;
    }
    out.push({ id: items[k].id, nombre: items[k].nombre, extra: bajo, tope: false });
  }
  return out.sort((a, b) => b.extra - a.extra);
}

/** Cantidad máxima de piezas por chapa. */
export function piezasPorChapa(w, h, chapa, opts = {}) {
  const r = nest([{ id: 'x', w, h, cantidad: 400, ...opts.item }], chapa, { ...opts, maxChapas: 1 });
  return r.chapas[0]?.piezas.length || 0;
}

/**
 * Compara los dos motores sobre el mismo lote. Se usa en la interfaz para
 * mostrar cuánto material ahorra el anidado por forma real.
 */
export function compararMetodos(items, chapa, opts = {}) {
  const rect = nest(items, chapa, { ...opts, formaReal: false });
  const forma = nest(items, chapa, { ...opts, formaReal: true });
  return {
    rectangular: { chapas: rect.cantidadChapas, aprovechamiento: rect.aprovechamientoGlobal },
    formaReal: { chapas: forma.cantidadChapas, aprovechamiento: forma.aprovechamientoGlobal },
    chapasAhorradas: rect.cantidadChapas - forma.cantidadChapas,
    mejoraPct: rect.aprovechamientoGlobal > 0
      ? ((forma.aprovechamientoGlobal - rect.aprovechamientoGlobal) / rect.aprovechamientoGlobal) * 100
      : 0,
  };
}
