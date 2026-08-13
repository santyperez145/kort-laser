/**
 * De una imagen de un plano a una pieza cortable.
 *
 * El cliente manda una foto del plano, un escaneo o una captura. Hasta ahora
 * eso se dibujaba a mano en el CAD antes de poder cotizar: media hora por
 * pieza, y la mitad de las veces el trabajo se pierde antes de llegar a
 * cotizarlo.
 *
 * Acá entra una imagen (píxeles RGBA) y sale un contorno con sus agujeros,
 * listo para el mismo camino que cualquier otra pieza: 2D, 3D, nesting y DXF.
 *
 * **Esto NO adivina la escala.** Una imagen no tiene milímetros: tiene
 * píxeles. La escala la pone una persona diciendo cuánto mide algo del
 * dibujo. Inventarla sería cotizar una pieza que no es la que el cliente
 * pidió — y eso se descubre con la chapa ya cortada.
 *
 * Sin dependencias, como todo `src/core/`. Corre igual en Node (con un buffer
 * de píxeles) que en el navegador (con un `ImageData` de canvas).
 */

import { polyline, circle, makeShape, normalizeShape, pathBBox } from './geometry.js';

/* ── Umbral: separar tinta de papel ─────────────────────────────────────── */

/** Gris perceptual. Los planos suelen ser negro sobre blanco, pero un sello
 *  azul o una cuadrícula celeste tienen que pesar distinto que la línea. */
function aGris(img) {
  const { width: w, height: h, data } = img;
  const g = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) {
    g[i] = (data[p] * 299 + data[p + 1] * 587 + data[p + 2] * 114) / 1000;
  }
  return g;
}

/**
 * Umbral adaptativo de Bradley, con imagen integral.
 *
 * Un umbral global no sirve con una FOTO de un plano: la hoja tiene sombra de
 * un lado y brillo del otro, y cualquier corte fijo come la mitad del dibujo o
 * convierte la sombra en pieza. Este compara cada píxel contra el promedio de
 * su vecindario, así que la iluminación despareja deja de importar.
 *
 * @param {number} ventana lado del vecindario en píxeles
 * @param {number} tolerancia cuánto por debajo del promedio local es tinta
 */
function umbralAdaptativo(g, w, h, ventana, tolerancia = 0.14) {
  // Imagen integral: suma acumulada, para promediar cualquier rectángulo en O(1)
  const S = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let fila = 0;
    for (let x = 0; x < w; x++) {
      fila += g[y * w + x];
      S[(y + 1) * (w + 1) + (x + 1)] = S[y * (w + 1) + (x + 1)] + fila;
    }
  }
  const r = Math.max(1, Math.floor(ventana / 2));
  const tinta = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w - 1, x + r);
      const n = (x1 - x0 + 1) * (y1 - y0 + 1);
      const suma =
        S[(y1 + 1) * (w + 1) + (x1 + 1)] - S[y0 * (w + 1) + (x1 + 1)] -
        S[(y1 + 1) * (w + 1) + x0] + S[y0 * (w + 1) + x0];
      tinta[y * w + x] = g[y * w + x] * n < suma * (1 - tolerancia) ? 1 : 0;
    }
  }
  return tinta;
}

/** Umbral de Otsu: el corte que mejor separa los dos picos del histograma. */
function umbralOtsu(g) {
  const hist = new Float64Array(256);
  for (let i = 0; i < g.length; i++) hist[g[i]]++;
  const total = g.length;
  let suma = 0;
  for (let i = 0; i < 256; i++) suma += i * hist[i];
  let sumaB = 0, pesoB = 0, mejor = 0, umbral = 128;
  for (let t = 0; t < 256; t++) {
    pesoB += hist[t];
    if (!pesoB) continue;
    const pesoF = total - pesoB;
    if (!pesoF) break;
    sumaB += t * hist[t];
    const varEntre = pesoB * pesoF * ((sumaB / pesoB - (suma - sumaB) / pesoF) ** 2);
    if (varEntre > mejor) {
      mejor = varEntre;
      umbral = t;
    }
  }
  return umbral;
}

/* ── Limpieza morfológica ───────────────────────────────────────────────── */

/** Cierra huecos de 1 px (líneas punteadas del escaneo) y saca motas. */
function limpiar(m, w, h, pasos = 1) {
  let a = m;
  const vecinos = (src, x, y) => {
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const X = x + dx, Y = y + dy;
        if (X >= 0 && Y >= 0 && X < w && Y < h && src[Y * w + X]) n++;
      }
    }
    return n;
  };
  for (let p = 0; p < pasos; p++) {
    // Dilatar: un píxel apagado con 5+ vecinos encendidos se enciende
    const b = new Uint8Array(a);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (!a[y * w + x] && vecinos(a, x, y) >= 5) b[y * w + x] = 1;
    // Erosionar: un píxel encendido con 1 o menos vecinos es una mota
    const c = new Uint8Array(b);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (b[y * w + x] && vecinos(b, x, y) <= 1) c[y * w + x] = 0;
    a = c;
  }
  return a;
}

/* ── Trazado de contornos ───────────────────────────────────────────────── */

const VECINDAD = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
];

/**
 * Border following de Moore: se camina el borde de cada región pegado a ella,
 * girando siempre en el mismo sentido.
 *
 * Devuelve los contornos en píxeles, cada uno con su profundidad de anidado:
 * profundidad par = contorno exterior, impar = agujero. Es lo que permite que
 * un agujero adentro de una pieza salga como agujero y no como otra pieza.
 */
function trazarContornos(m, w, h, minPixeles) {
  const dentro = (x, y) => x >= 0 && y >= 0 && x < w && y < h && m[y * w + x] === 1;
  const visto = new Uint8Array(w * h);
  const contornos = [];

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!dentro(x, y) || visto[y * w + x]) continue;
      // Sólo arranca en un píxel de borde: el de arriba tiene que estar apagado
      if (dentro(x, y - 1)) continue;

      const puntos = [];
      let px = x, py = y;
      let dir = 6; // se viene "desde arriba"
      const inicioX = x, inicioY = y;
      let pasos = 0;
      const tope = w * h * 4; // red de seguridad ante una máscara patológica

      do {
        puntos.push([px, py]);
        visto[py * w + px] = 1;
        let encontrado = false;
        // Se busca el siguiente vecino encendido girando desde donde se venía
        for (let k = 0; k < 8; k++) {
          const d = (dir + 6 + k) % 8;
          const nx = px + VECINDAD[d][0];
          const ny = py + VECINDAD[d][1];
          if (dentro(nx, ny)) {
            px = nx; py = ny; dir = d;
            encontrado = true;
            break;
          }
        }
        if (!encontrado) break; // píxel suelto
        pasos++;
      } while ((px !== inicioX || py !== inicioY) && pasos < tope);

      if (puntos.length >= minPixeles) contornos.push(puntos);
    }
  }
  return contornos;
}

/* ── Simplificación ─────────────────────────────────────────────────────── */

/**
 * Douglas-Peucker sobre un contorno CERRADO.
 *
 * No se puede aplicar el algoritmo tal cual a un lazo: fija el primer y el
 * último punto como extremos, y en un contorno cerrado esos dos son vecinos.
 * La recta de referencia mide un píxel, todo queda "cerca" de ella y el
 * contorno colapsa — un rectángulo de 800×500 salía con 5 puntos y área CERO,
 * y de ahí para abajo fallaba todo: no se juntaba con su par de trazo, no se
 * detectaba como pieza y el largo de corte se iba al doble.
 *
 * El arreglo estándar: cortar el lazo en el punto más lejano del primero y
 * simplificar las dos mitades por separado.
 */
function simplificarCerrado(pts, tol) {
  if (pts.length < 4) return pts.slice();
  let lejos = 0, d2 = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2;
    if (d > d2) { d2 = d; lejos = i; }
  }
  const a = simplificar(pts.slice(0, lejos + 1), tol);
  const b = simplificar(pts.slice(lejos), tol);
  // Se descarta el punto repetido en cada empalme
  return a.slice(0, -1).concat(b.slice(0, -1));
}

/** Douglas-Peucker sobre una polilínea abierta. */
function simplificar(pts, tol) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const pila = [[0, pts.length - 1]];
  while (pila.length) {
    const [i, j] = pila.pop();
    if (j <= i + 1) continue;
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[j];
    const dx = x2 - x1, dy = y2 - y1;
    const largo = Math.hypot(dx, dy) || 1e-9;
    let peor = -1, idx = -1;
    for (let k = i + 1; k < j; k++) {
      const d = Math.abs(dy * (pts[k][0] - x1) - dx * (pts[k][1] - y1)) / largo;
      if (d > peor) { peor = d; idx = k; }
    }
    if (peor > tol) {
      keep[idx] = 1;
      pila.push([i, idx], [idx, j]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/**
 * Endereza segmentos casi horizontales o casi verticales.
 *
 * Un plano dibujado a mano o escaneado torcido deja lados a 89,4°. Cortados
 * así, la pieza no encuadra y las cotas no cierran. Se enderezan sólo los que
 * ya estaban a menos de `tolGrados`: nada que sea una diagonal de verdad.
 */
function enderezar(pts, tolGrados = 3) {
  const out = pts.map((p) => p.slice());
  const tol = (tolGrados * Math.PI) / 180;
  for (let i = 0; i < out.length; i++) {
    const a = out[i];
    const b = out[(i + 1) % out.length];
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);

    /* Hay que saber a CUÁL múltiplo de 90° se está acercando, no sólo que
       está cerca de alguno.

       ⚠️ Acá hubo un error que aplanaba las piezas: se medía `ang % 90°` y se
       igualaba la Y cuando el resto era chico. Un lado VERTICAL tiene ángulo
       90°, y 90 % 90 = 0 — o sea que el resto también era chico, y el lado
       vertical se convertía en horizontal. Un rectángulo terminaba con área
       CERO y la pieza desaparecía. */
    const cuartos = Math.round(ang / (Math.PI / 2)); // -2..2
    const objetivo = cuartos * (Math.PI / 2);
    if (Math.abs(ang - objetivo) > tol) continue;

    // Múltiplo par de 90° = horizontal; impar = vertical
    if (Math.abs(cuartos) % 2 === 0) b[1] = a[1];
    else b[0] = a[0];
  }
  return out;
}

/* ── El grosor del trazo ────────────────────────────────────────────────── */

/**
 * Grosor típico de la línea, en píxeles: la mediana de las corridas de tinta.
 *
 * Hace falta porque una línea DIBUJADA tiene ancho, y entonces el trazado
 * devuelve DOS contornos por trazo — el borde de afuera y el de adentro. Sin
 * darse cuenta de eso, una placa con dos agujeros da seis contornos en vez de
 * tres, el largo de corte sale al doble y los agujeros se convierten en
 * piezas.
 *
 * Mediana y no promedio: un plano tiene líneas de cota finas y contornos
 * gruesos, y el promedio queda en un ancho que no existe.
 */
function grosorLinea(tinta, w, h) {
  const corridas = [];
  for (let y = 0; y < h; y += 2) {
    let n = 0;
    for (let x = 0; x < w; x++) {
      if (tinta[y * w + x]) n++;
      else if (n) { corridas.push(n); n = 0; }
    }
    if (n) corridas.push(n);
  }
  if (!corridas.length) return 1;
  corridas.sort((a, b) => a - b);
  return Math.max(1, corridas[corridas.length >> 1]);
}

/** Punto más cercano de un polígono. */
function masCercano(p, poly) {
  let mejor = poly[0], d2 = Infinity;
  for (const q of poly) {
    const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2;
    if (d < d2) { d2 = d; mejor = q; }
  }
  return mejor;
}

/**
 * Junta los dos bordes de un mismo trazo en su LÍNEA MEDIA.
 *
 * Dos contornos son el mismo trazo cuando uno está adentro del otro y el
 * anillo que queda entre ambos es apenas más ancho que la línea. La línea
 * media es la que hay que cortar: quedarse con el borde de afuera hace la
 * pieza un ancho de línea más grande, y con el de adentro, más chica. Con un
 * trazo de 1,5 mm eso es 3 mm de diferencia en la cota — un agujero Ø40 que
 * sale Ø43 no entra.
 */
function unirTrazos(contornos, grosor) {
  const usados = new Set();
  const salida = [];

  for (let i = 0; i < contornos.length; i++) {
    if (usados.has(i)) continue;
    const A = contornos[i];
    let pareja = -1;

    for (let j = 0; j < contornos.length; j++) {
      if (i === j || usados.has(j)) continue;
      const B = contornos[j];
      if (B.area >= A.area) continue;
      if (!contenido(B, A)) continue;
      /* El anillo entre los dos tiene área ≈ perímetro × grosor. Se acepta
         hasta el triple para tolerar líneas desparejas, pero no más: si el
         anillo es mucho más gordo, son dos contornos distintos de verdad
         (una pieza con una ventana, por ejemplo). */
      const perim = perimetro(A.puntos);
      const anillo = A.area - B.area;
      if (anillo <= perim * grosor * 3) { pareja = j; break; }
    }

    usados.add(i);
    if (pareja < 0) {
      salida.push(A);
      continue;
    }
    usados.add(pareja);
    const B = contornos[pareja];

    // Línea media: cada punto del borde externo con su más cercano del interno
    const medio = A.puntos.map((p) => {
      const q = masCercano(p, B.puntos);
      return [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    });
    salida.push({
      puntos: medio,
      area: Math.abs(areaPoligono(medio)),
      // El círculo se recalcula sobre la línea media, no sobre el borde
      circulo: A.circulo && B.circulo
        ? {
            cx: (A.circulo.cx + B.circulo.cx) / 2,
            cy: (A.circulo.cy + B.circulo.cy) / 2,
            r: (A.circulo.r + B.circulo.r) / 2,
          }
        : null,
      bbox: bboxDe(medio),
      trazo: true,
    });
  }
  return salida;
}

function perimetro(pts) {
  let p = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    p += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return p;
}

/* ── Reconocer círculos ─────────────────────────────────────────────────── */

/**
 * Ajuste algebraico de círculo (Kåsa) y control del error.
 *
 * Importa más de lo que parece: los agujeros de una pieza son círculos, y un
 * círculo aproximado por polígono se corta con cientos de micro-segmentos —
 * la máquina frena en cada esquina, el tiempo estimado se dispara y el
 * agujero queda facetado. Reconocerlo como círculo lo corta como círculo.
 */
function ajustarCirculo(pts) {
  const n = pts.length;
  if (n < 8) return null;
  let sx = 0, sy = 0;
  for (const [x, y] of pts) { sx += x; sy += y; }
  const mx = sx / n, my = sy / n;

  let Suu = 0, Svv = 0, Suv = 0, Suuu = 0, Svvv = 0, Suvv = 0, Svuu = 0;
  for (const [x, y] of pts) {
    const u = x - mx, v = y - my;
    Suu += u * u; Svv += v * v; Suv += u * v;
    Suuu += u * u * u; Svvv += v * v * v;
    Suvv += u * v * v; Svuu += v * u * u;
  }
  const det = 2 * (Suu * Svv - Suv * Suv);
  if (Math.abs(det) < 1e-9) return null;
  const uc = (Svv * (Suuu + Suvv) - Suv * (Svvv + Svuu)) / det;
  const vc = (Suu * (Svvv + Svuu) - Suv * (Suuu + Suvv)) / det;
  const cx = mx + uc, cy = my + vc;

  let sr = 0;
  for (const [x, y] of pts) sr += Math.hypot(x - cx, y - cy);
  const r = sr / n;
  if (!(r > 0)) return null;

  // Error relativo: qué tan lejos del círculo ideal quedó cada punto
  let peor = 0;
  for (const [x, y] of pts) peor = Math.max(peor, Math.abs(Math.hypot(x - cx, y - cy) - r));
  return { cx, cy, r, error: peor / r };
}

/* ── API ────────────────────────────────────────────────────────────────── */

export const OPCIONES_POR_DEFECTO = {
  /** 'auto' usa umbral adaptativo; 'global' usa Otsu. */
  umbral: 'auto',
  /** Cuánto por debajo del promedio local cuenta como tinta (0-1). */
  sensibilidad: 0.14,
  /** Se descartan contornos con menos de estos píxeles: son ruido. */
  minPixeles: 40,
  /** Tolerancia de simplificación, en píxeles. */
  toleranciaPx: 1.5,
  /** Error relativo máximo para aceptar un contorno como círculo. */
  toleranciaCirculo: 0.06,
  /** Enderezar segmentos casi rectos, en grados. 0 lo desactiva. */
  enderezarGrados: 3,
  /** Pasos de limpieza morfológica. */
  limpieza: 1,
  /** La imagen viene con la tinta clara sobre fondo oscuro. */
  invertido: false,
};

/**
 * Vectoriza una imagen.
 *
 * @param {{width:number, height:number, data:Uint8ClampedArray}} img
 * @param {Object} [opts] ver `OPCIONES_POR_DEFECTO`
 * @returns {{contornos: Array, ancho: number, alto: number, avisos: Array}}
 *   contornos en PÍXELES; la escala se aplica después con `aPieza()`.
 */
export function vectorizar(img, opts = {}) {
  const o = { ...OPCIONES_POR_DEFECTO, ...opts };
  const { width: w, height: h } = img;
  if (!w || !h) throw new Error('La imagen no tiene tamaño');

  const g = aGris(img);
  if (o.invertido) for (let i = 0; i < g.length; i++) g[i] = 255 - g[i];

  let tinta;
  if (o.umbral === 'global') {
    const u = umbralOtsu(g);
    tinta = new Uint8Array(g.length);
    for (let i = 0; i < g.length; i++) tinta[i] = g[i] < u ? 1 : 0;
  } else {
    // Ventana proporcional a la imagen: en una foto de 4000 px una ventana de
    // 15 px mira el grosor de la línea en vez del papel que la rodea.
    const ventana = Math.max(15, Math.round(Math.min(w, h) / 16) | 1);
    tinta = umbralAdaptativo(g, w, h, ventana, o.sensibilidad);
  }
  if (o.limpieza > 0) tinta = limpiar(tinta, w, h, o.limpieza);

  const crudos = trazarContornos(tinta, w, h, o.minPixeles);

  const contornos = [];
  for (const pts of crudos) {
    let simple = simplificarCerrado(pts, o.toleranciaPx);
    if (simple.length < 3) continue;

    const circ = ajustarCirculo(pts);
    const esCirculo = circ && circ.error <= o.toleranciaCirculo && circ.r > 2;
    if (!esCirculo && o.enderezarGrados > 0) simple = enderezar(simple, o.enderezarGrados);

    contornos.push({
      puntos: simple,
      area: Math.abs(areaPoligono(simple)),
      circulo: esCirculo ? { cx: circ.cx, cy: circ.cy, r: circ.r } : null,
      bbox: bboxDe(simple),
    });
  }

  /* Los dos bordes de cada trazo se juntan en su línea media. Se hace ACÁ y
     no al final porque todo lo que sigue —anidado, agujeros, área— cuenta
     contornos, y con los trazos duplicados cuenta el doble. */
  const grosor = grosorLinea(tinta, w, h);
  const unidos = unirTrazos(contornos, grosor);
  unidos.sort((a, b) => b.area - a.area);

  const avisos = [];
  if (!unidos.length) {
    avisos.push({
      nivel: 'error',
      msg:
        'No se encontró ningún contorno cerrado. Puede ser que el dibujo esté muy claro, ' +
        'que la línea esté cortada, o que la imagen tenga poca resolución. Probá subir la ' +
        'sensibilidad o mandar una foto más nítida y derecha.',
    });
  } else if (unidos.length > 60) {
    avisos.push({
      nivel: 'aviso',
      msg:
        `Se detectaron ${unidos.length} contornos. Si el plano tiene cotas, textos o membrete, ` +
        'están entrando como piezas. Recortá la imagen dejando sólo el dibujo, o subí el mínimo de ' +
        'tamaño para que el texto se descarte.',
    });
  }

  return { contornos: unidos, ancho: w, alto: h, avisos, tinta, grosorLineaPx: grosor };
}

/* ── De contornos en píxeles a una pieza en milímetros ─────────────────── */

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

/** ¿Está `a` adentro de `b`? Punto en polígono por cruce de rayos. */
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
 * Arma la pieza cortable a partir de los contornos vectorizados.
 *
 * La escala es OBLIGATORIA y viene de afuera: se mide algo conocido del
 * dibujo en píxeles y se dice cuánto mide en milímetros. Sin eso no hay
 * pieza, hay un dibujo.
 *
 * @param {Array} contornos los de `vectorizar()`
 * @param {number} mmPorPixel
 * @param {Object} [opts] { altoImagen, indices }
 * @returns {{shape, partes:number, agujeros:number, avisos:Array}}
 */
export function aPieza(contornos, mmPorPixel, opts = {}) {
  if (!contornos?.length) throw new Error('No hay contornos que convertir');
  if (!(mmPorPixel > 0)) throw new Error('Falta la escala: decí cuánto mide algo del dibujo');

  const elegidos = opts.indices?.length
    ? opts.indices.map((i) => contornos[i]).filter(Boolean)
    : contornos;
  if (!elegidos.length) throw new Error('No quedó ningún contorno seleccionado');

  /* Anidado: cada contorno cuenta cuántos otros lo contienen. Profundidad par
     es material, impar es agujero. Un agujero adentro de un agujero vuelve a
     ser material — pasa con una arandela dibujada dentro de una ventana. */
  const prof = elegidos.map((c) => elegidos.filter((o) => o !== c && contenido(c, o)).length);

  /* El eje Y de una imagen crece hacia abajo y el de un plano hacia arriba.
     Sin espejar, la pieza sale invertida y una pieza asimétrica se corta al
     revés — que no se nota hasta que no encastra. */
  const H = opts.altoImagen ?? Math.max(...elegidos.flatMap((c) => c.puntos.map((p) => p[1])));
  const aMM = ([x, y]) => [x * mmPorPixel, (H - y) * mmPorPixel];

  const aPath = (c) =>
    c.circulo
      ? circle(c.circulo.cx * mmPorPixel, (H - c.circulo.cy) * mmPorPixel, c.circulo.r * mmPorPixel)
      : polyline(c.puntos.map(aMM), true);

  const exteriores = elegidos.filter((_, i) => prof[i] % 2 === 0);
  const interiores = elegidos.filter((_, i) => prof[i] % 2 === 1);

  /* Cada exterior se queda con los agujeros que caen adentro de él. Si hay
     varios exteriores es una pieza de varias partes: NO se separan solas —
     puede ser un cartel o un juego que se entrega armado. */
  const partes = exteriores.map((ext) => ({
    outer: aPath(ext),
    holes: interiores.filter((hh) => contenido(hh, ext)).map(aPath),
  }));

  const shape = normalizeShape(
    partes.length === 1
      ? makeShape(partes[0].outer, partes[0].holes)
      : { ...makeShape(partes[0].outer, partes[0].holes), partes },
    0
  );

  const avisos = [];
  const bb = pathBBox(shape.outer);
  if (bb.w < 5 || bb.h < 5) {
    avisos.push({
      nivel: 'aviso',
      msg: `La pieza quedó de ${bb.w.toFixed(1)} × ${bb.h.toFixed(1)} mm. Revisá la escala: parece muy chica.`,
    });
  }
  if (bb.w > 3000 || bb.h > 3000) {
    avisos.push({
      nivel: 'error',
      msg: `La pieza quedó de ${bb.w.toFixed(0)} × ${bb.h.toFixed(0)} mm y no entra en ninguna chapa. Revisá la escala.`,
    });
  }
  if (partes.length > 1) {
    avisos.push({
      nivel: 'info',
      msg:
        `El dibujo tiene ${partes.length} contornos exteriores. Se importa como UNA pieza de ` +
        `${partes.length} partes, respetando las posiciones del plano. Si en realidad son piezas ` +
        'sueltas, separalas antes de cotizar: cada una se anida por su cuenta.',
    });
  }
  avisos.push({
    nivel: 'aviso',
    msg:
      'Geometría reconstruida de una imagen: las medidas dependen de la escala que cargaste y de ' +
      'la nitidez del plano. Verificá las cotas críticas contra el plano del cliente antes de cortar.',
  });

  return { shape, partes: partes.length, agujeros: interiores.length, avisos, mmPorPixel };
}

/**
 * Escala a partir de una medida conocida.
 *
 * @param {number} pixeles largo medido sobre la imagen
 * @param {number} milimetros cuánto mide eso en la realidad
 */
export function escalaDesdeReferencia(pixeles, milimetros) {
  if (!(pixeles > 0) || !(milimetros > 0)) return null;
  return milimetros / pixeles;
}
