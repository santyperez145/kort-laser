/**
 * Leer la geometría de un plano en PDF.
 *
 * Cuando el cliente manda un PDF exportado del CAD —que es lo más común— ese
 * archivo **ya tiene la geometría vectorial adentro** y en unidades reales. No
 * hace falta vectorizar una imagen ni calibrar la escala a ojo: se leen las
 * curvas tal cual y se convierten a milímetros. Es exacto.
 *
 * Un PDF escaneado no tiene nada de esto: son píxeles adentro de una hoja. En
 * ese caso hay que ir por `vectorizar.js`, y este módulo lo dice claro en vez
 * de devolver una pieza vacía.
 *
 * Sin dependencias: el único descompresor que hace falta es `DecompressionStream`,
 * que es una API estándar del navegador y de Node desde la 18. Meter una
 * librería de PDF sólo para esto rompería la regla del núcleo y sumaría 400 kB
 * a una máquina que puede estar sin internet.
 */

import { polyline, circle, makeShape, normalizeShape, pathBBox } from './geometry.js';

/** Un punto PostScript son 1/72 de pulgada. */
export const MM_POR_PUNTO = 25.4 / 72;

/* ── Lectura del archivo ────────────────────────────────────────────────── */

const texto = (bytes) => {
  let s = '';
  // De a pedazos: un PDF de varios MB revienta el String.fromCharCode de una
  for (let i = 0; i < bytes.length; i += 8192) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  }
  return s;
};

/** Descomprime un flujo FlateDecode con la API nativa. */
async function inflar(bytes) {
  const ds = new DecompressionStream('deflate');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * Saca los flujos de contenido de todas las páginas.
 *
 * Se buscan los objetos con `stream`/`endstream` en vez de recorrer el árbol
 * de páginas: es mucho menos código y para leer geometría da lo mismo de qué
 * página venga cada curva. Lo que NO da lo mismo es el `MediaBox`, que se lee
 * aparte para saber el tamaño de la hoja.
 */
async function flujosDeContenido(bytes) {
  const s = texto(bytes);
  const flujos = [];
  const re = /stream\r?\n?/g;
  let m;
  while ((m = re.exec(s))) {
    const ini = m.index + m[0].length;
    const fin = s.indexOf('endstream', ini);
    if (fin < 0) continue;
    // El diccionario del objeto está justo antes del `stream`
    const dicIni = s.lastIndexOf('<<', m.index);
    const dic = dicIni >= 0 ? s.slice(dicIni, m.index) : '';
    if (/\/Subtype\s*\/(Image|Form)/.test(dic) && !/\/Subtype\s*\/Form/.test(dic)) continue;

    let crudo = bytes.subarray(ini, fin);
    if (/\/Filter[^>]*\/FlateDecode/.test(dic)) {
      try {
        crudo = await inflar(crudo);
      } catch {
        continue; // flujo roto o con un filtro que no manejamos
      }
    } else if (/\/Filter/.test(dic)) {
      continue; // LZW, RunLength, DCT… no se manejan
    }
    flujos.push(texto(crudo));
    re.lastIndex = fin;
  }
  return flujos;
}

/** Tamaño de la hoja, en puntos. */
function mediaBox(bytes) {
  const s = texto(bytes.subarray(0, Math.min(bytes.length, 200000)));
  const m = s.match(/\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/);
  if (!m) return null;
  return { x0: +m[1], y0: +m[2], x1: +m[3], y1: +m[4] };
}

/* ── Intérprete de los operadores de dibujo ─────────────────────────────── */

/** Multiplica dos matrices [a b c d e f] del modelo de PDF. */
const mul = (m, n) => [
  m[0] * n[0] + m[1] * n[2],
  m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2],
  m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4],
  m[4] * n[1] + m[5] * n[3] + n[5],
];

const aplicar = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** Bézier cúbica a segmentos. 16 tramos alcanzan para un arco de plano. */
function bezier(p0, p1, p2, p3, n = 16) {
  const out = [];
  for (let i = 1; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
  return out;
}

/**
 * Recorre un flujo de contenido y devuelve los subtrazos dibujados.
 *
 * Se leen los operadores de camino (`m l c v y re h`) y los de estado
 * (`cm q Q`). Se ignora todo lo demás — texto, colores, sombreados — porque
 * para cortar sólo importa por dónde pasan las líneas.
 */
function caminosDelFlujo(contenido) {
  const tokens = contenido.match(/\[[^\]]*\]|<[^>]*>|\/[^\s/\[\]<>()]+|\((?:\\.|[^\\)])*\)|[^\s\[\]<>/]+/g) || [];
  const caminos = [];
  let pila = [];
  let ctm = [1, 0, 0, 1, 0, 0];
  let sub = null;
  let actual = null;
  let inicio = null;
  const nums = [];

  const cerrarSub = (cerrado) => {
    if (sub && sub.length >= 2) caminos.push({ puntos: sub, cerrado });
    sub = null;
  };

  for (const t of tokens) {
    const n = parseFloat(t);
    if (!Number.isNaN(n) && /^[-+.\d]/.test(t)) {
      nums.push(n);
      if (nums.length > 8) nums.shift();
      continue;
    }

    switch (t) {
      case 'q':
        pila.push(ctm.slice());
        break;
      case 'Q':
        ctm = pila.pop() || [1, 0, 0, 1, 0, 0];
        break;
      case 'cm':
        if (nums.length >= 6) ctm = mul(nums.slice(-6), ctm);
        break;

      case 'm': {
        cerrarSub(false);
        if (nums.length >= 2) {
          actual = aplicar(ctm, nums[nums.length - 2], nums[nums.length - 1]);
          inicio = actual;
          sub = [actual];
        }
        break;
      }
      case 'l':
        if (sub && nums.length >= 2) {
          actual = aplicar(ctm, nums[nums.length - 2], nums[nums.length - 1]);
          sub.push(actual);
        }
        break;
      case 'c':
        if (sub && nums.length >= 6) {
          const [x1, y1, x2, y2, x3, y3] = nums.slice(-6);
          const p1 = aplicar(ctm, x1, y1), p2 = aplicar(ctm, x2, y2), p3 = aplicar(ctm, x3, y3);
          sub.push(...bezier(actual, p1, p2, p3));
          actual = p3;
        }
        break;
      case 'v':
        if (sub && nums.length >= 4) {
          const [x2, y2, x3, y3] = nums.slice(-4);
          const p2 = aplicar(ctm, x2, y2), p3 = aplicar(ctm, x3, y3);
          sub.push(...bezier(actual, actual, p2, p3));
          actual = p3;
        }
        break;
      case 'y':
        if (sub && nums.length >= 4) {
          const [x1, y1, x3, y3] = nums.slice(-4);
          const p1 = aplicar(ctm, x1, y1), p3 = aplicar(ctm, x3, y3);
          sub.push(...bezier(actual, p1, p3, p3));
          actual = p3;
        }
        break;
      case 're':
        if (nums.length >= 4) {
          cerrarSub(false);
          const [x, y, w, hh] = nums.slice(-4);
          caminos.push({
            puntos: [
              aplicar(ctm, x, y), aplicar(ctm, x + w, y),
              aplicar(ctm, x + w, y + hh), aplicar(ctm, x, y + hh),
            ],
            cerrado: true,
          });
          actual = aplicar(ctm, x, y);
          inicio = actual;
        }
        break;
      case 'h':
        if (sub && inicio) {
          sub.push(inicio);
          cerrarSub(true);
        }
        break;

      // Pintar o descartar: en todos los casos el camino se termina
      case 'S': case 's': case 'f': case 'F': case 'f*':
      case 'B': case 'B*': case 'b': case 'b*': case 'n':
        cerrarSub(t === 's' || t === 'b' || t === 'b*');
        break;
      default:
        break;
    }
    if (t !== 'cm') nums.length = 0;
    else nums.length = 0;
  }
  cerrarSub(false);
  return caminos;
}

/* ── API ────────────────────────────────────────────────────────────────── */

/**
 * Lee un plano en PDF.
 *
 * @param {Uint8Array|ArrayBuffer} archivo
 * @param {Object} [opts] { toleranciaCierre } en puntos
 * @returns {Promise<{contornos, hoja, avisos, vectorial:boolean}>}
 *   contornos ya en MILÍMETROS, con Y hacia arriba (el PDF ya usa ese sentido).
 */
export async function leerPlanoPDF(archivo, opts = {}) {
  const bytes = archivo instanceof Uint8Array ? archivo : new Uint8Array(archivo);
  const cabecera = texto(bytes.subarray(0, 8));
  if (!cabecera.startsWith('%PDF')) throw new Error('El archivo no es un PDF');

  const caja = mediaBox(bytes);
  const flujos = await flujosDeContenido(bytes);

  const crudos = [];
  for (const f of flujos) crudos.push(...caminosDelFlujo(f));

  const tolCierre = opts.toleranciaCierre ?? 0.6; // puntos ≈ 0,2 mm
  const contornos = [];
  for (const c of crudos) {
    const p = c.puntos;
    if (p.length < 3) continue;
    const cerrado =
      c.cerrado ||
      Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]) <= tolCierre;
    if (!cerrado) continue; // una línea abierta no es un contorno cortable

    const pts = p.map(([x, y]) => [x * MM_POR_PUNTO, y * MM_POR_PUNTO]);
    // Se saca el punto repetido del cierre
    const ult = pts[pts.length - 1];
    if (Math.hypot(pts[0][0] - ult[0], pts[0][1] - ult[1]) < 1e-6) pts.pop();
    if (pts.length < 3) continue;

    const area = Math.abs(areaPoligono(pts));
    if (area < 1) continue; // menos de 1 mm²: es un adorno o un punto
    contornos.push({ puntos: pts, area, bbox: bboxDe(pts), circulo: null });
  }

  contornos.sort((a, b) => b.area - a.area);

  const avisos = [];
  const vectorial = contornos.length > 0;
  if (!vectorial) {
    avisos.push({
      nivel: 'error',
      msg:
        'Este PDF no tiene geometría vectorial: lo más probable es que sea un escaneo o una foto ' +
        'metida adentro de un PDF. Exportá la página como imagen (PNG o JPG) e importala por ahí, ' +
        'que ahí sí se puede vectorizar indicando una medida de referencia.',
    });
  } else {
    avisos.push({
      nivel: 'info',
      msg:
        `Geometría leída del PDF en unidades reales: ${contornos.length} contornos cerrados. ` +
        'No hace falta calibrar la escala — sale exacta del archivo. Igual conviene verificar una ' +
        'cota conocida, porque algunos CAD exportan la hoja a una escala distinta de 1:1.',
    });
  }

  return {
    contornos,
    vectorial,
    hoja: caja
      ? { ancho: (caja.x1 - caja.x0) * MM_POR_PUNTO, alto: (caja.y1 - caja.y0) * MM_POR_PUNTO }
      : null,
    avisos,
  };
}

function areaPoligono(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

function bboxDe(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x; if (x > x1) x1 = x;
    if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** ¿Está `a` adentro de `b`? */
function contenido(a, b) {
  const [px, py] = a.puntos[0];
  let dentro = false;
  const p = b.puntos;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i];
    const [xj, yj] = p[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi) {
      dentro = !dentro;
    }
  }
  return dentro;
}

/**
 * Arma la pieza con los contornos que ya vienen en milímetros.
 *
 * Mismo criterio de anidado que en la vectorización de imágenes: profundidad
 * par es material, impar es agujero. Y varios exteriores son UNA pieza de
 * varias partes, no un lote — el PDF del cliente puede ser un cartel.
 */
export function planoAPieza(contornos, opts = {}) {
  if (!contornos?.length) throw new Error('El PDF no tiene contornos cerrados');
  const elegidos = opts.indices?.length
    ? opts.indices.map((i) => contornos[i]).filter(Boolean)
    : contornos;
  if (!elegidos.length) throw new Error('No quedó ningún contorno seleccionado');

  const escala = opts.escala ?? 1; // por si el CAD exportó a 1:2, por ejemplo
  const esc = (c) => ({ ...c, puntos: c.puntos.map(([x, y]) => [x * escala, y * escala]) });
  const cs = elegidos.map(esc);

  const prof = cs.map((c) => cs.filter((o) => o !== c && contenido(c, o)).length);
  const exteriores = cs.filter((_, i) => prof[i] % 2 === 0);
  const interiores = cs.filter((_, i) => prof[i] % 2 === 1);

  const partes = exteriores.map((ext) => ({
    outer: polyline(ext.puntos, true),
    holes: interiores.filter((hh) => contenido(hh, ext)).map((hh) => polyline(hh.puntos, true)),
  }));

  const shape = normalizeShape(
    partes.length === 1
      ? makeShape(partes[0].outer, partes[0].holes)
      : { ...makeShape(partes[0].outer, partes[0].holes), partes },
    0
  );

  const avisos = [];
  const bb = pathBBox(shape.outer);
  if (bb.w > 3000 || bb.h > 3000) {
    avisos.push({
      nivel: 'error',
      msg: `La pieza mide ${bb.w.toFixed(0)} × ${bb.h.toFixed(0)} mm y no entra en ninguna chapa. Revisá si el CAD exportó a escala.`,
    });
  }
  if (partes.length > 1) {
    avisos.push({
      nivel: 'info',
      msg:
        `El plano tiene ${partes.length} contornos exteriores. Se importa como UNA pieza de ` +
        `${partes.length} partes, respetando el dibujo. Si son piezas sueltas, separalas antes de cotizar.`,
    });
  }

  return { shape, partes: partes.length, agujeros: interiores.length, avisos };
}
