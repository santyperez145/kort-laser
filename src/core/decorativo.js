/**
 * Paneles decorativos: un motivo repartido sobre una medida dada.
 *
 * El cliente trae una idea —un rombo, una hoja, un hexágono— y una medida:
 * "hacéme una celosía de 1200 × 2400". Lo que hay que resolver no es dibujar
 * el motivo, es **repartirlo bien**: que quede centrado, con márgenes iguales,
 * sin motivos cortados por la mitad en el borde, y sobre todo que la chapa
 * salga entera de la máquina.
 *
 * ## Lo que hace que un panel se arruine
 *
 * **El ligamento**: el ancho de material que queda entre dos calados. Si es
 * muy chico, el calor de dos cortes vecinos se suma, el ligamento se pone
 * blando y la chapa se deforma o se corta sola. En chapa fina un panel muy
 * calado sale ondulado y no hay forma de enderezarlo.
 *
 * La regla que usa este módulo: **ligamento ≥ 2 × espesor, y nunca menos de
 * 1,5 mm.** Si la distribución pedida no lo cumple, se dice — no se corrige en
 * silencio, porque el que decide si prefiere menos motivos o un panel más
 * grande es quien lo va a vender.
 *
 * Y el **porcentaje de calado**: arriba del 40 % la chapa pierde rigidez de
 * verdad. Para una celosía de fachada eso puede estar bien; para una tapa que
 * tiene que sostener algo, no.
 *
 * Sin dependencias, como todo `src/core/`.
 */

import {
  rect, circle, slot, polyline, regularPolygon, arc, line,
  makeShape, normalizeShape, transformPath, pathArea, TAU, rad,
} from './geometry.js';

/* ── Motivos ────────────────────────────────────────────────────────────── */

/**
 * Cada motivo se dibuja centrado en (0,0) dentro de una caja de 1 × 1, y
 * después se escala al tamaño pedido. Así todos los motivos son
 * intercambiables y la distribución no tiene que saber cuál es cuál.
 */
export const MOTIVOS = [
  {
    id: 'circulo',
    nombre: 'Círculo',
    // Un círculo es lo más rápido de cortar y lo que menos calienta la chapa:
    // no tiene esquinas donde la máquina frene.
    build: () => [circle(0, 0, 0.5)],
  },
  {
    id: 'rombo',
    nombre: 'Rombo',
    build: () => [polyline([[0, -0.5], [0.5, 0], [0, 0.5], [-0.5, 0]], true)],
  },
  {
    id: 'hexagono',
    nombre: 'Hexágono',
    build: () => [regularPolygon(0, 0, 0.5, 6, Math.PI / 6)],
  },
  {
    id: 'cuadrado',
    nombre: 'Cuadrado con radio',
    build: () => [rect(-0.5, -0.5, 1, 1, 0.18)],
  },
  {
    id: 'ranura',
    nombre: 'Ranura',
    build: () => [slot(0, 0, 1, 0.34, 0)],
  },
  {
    id: 'gota',
    nombre: 'Gota',
    build: () => {
      // Media circunferencia arriba y dos rectas que cierran en punta abajo
      const segs = [
        arc(0, 0.12, 0.38, 0, Math.PI, true),
        line(-0.38, 0.12, 0, -0.5),
        line(0, -0.5, 0.38, 0.12),
      ];
      return [{ segs, closed: true }];
    },
  },
  {
    id: 'triangulo',
    nombre: 'Triángulo',
    build: () => [regularPolygon(0, 0, 0.5, 3, Math.PI / 2)],
  },
  {
    id: 'estrella',
    nombre: 'Estrella de 6',
    build: () => {
      const pts = [];
      for (let i = 0; i < 12; i++) {
        const r = i % 2 === 0 ? 0.5 : 0.24;
        const a = (i * Math.PI) / 6 - Math.PI / 2;
        pts.push([r * Math.cos(a), r * Math.sin(a)]);
      }
      return [polyline(pts, true)];
    },
  },
  {
    id: 'flor',
    nombre: 'Flor de 6 pétalos',
    build: () => {
      // Seis círculos chicos alrededor de uno central: se corta rápido y
      // desde lejos lee como una flor
      const out = [circle(0, 0, 0.16)];
      for (let i = 0; i < 6; i++) {
        const a = (i * TAU) / 6;
        out.push(circle(0.3 * Math.cos(a), 0.3 * Math.sin(a), 0.16));
      }
      return out;
    },
  },
  {
    id: 'hoja',
    nombre: 'Hoja',
    build: () => {
      // Dos arcos opuestos: la forma clásica de ojiva
      const R = 0.62;
      const d = Math.sqrt(R * R - 0.25);
      const segs = [
        arc(-d, 0, R, rad(-24), rad(24), true),
        arc(d, 0, R, rad(156), rad(204), true),
      ];
      return [{ segs, closed: true }];
    },
  },
  {
    id: 'cruz',
    nombre: 'Cruz',
    build: () => {
      const a = 0.18;
      return [
        polyline(
          [
            [-a, -0.5], [a, -0.5], [a, -a], [0.5, -a], [0.5, a], [a, a],
            [a, 0.5], [-a, 0.5], [-a, a], [-0.5, a], [-0.5, -a], [-a, -a],
          ],
          true
        ),
      ];
    },
  },
  {
    id: 'onda',
    nombre: 'Onda',
    build: () => {
      // Ranura curva: da un panel con movimiento sin aumentar el calado
      const segs = [
        arc(0, -0.35, 0.55, rad(55), rad(125), true),
        arc(0, -0.18, 0.38, rad(125), rad(55), false),
      ];
      return [{ segs, closed: true }];
    },
  },
];

export const getMotivo = (id) => MOTIVOS.find((m) => m.id === id) || MOTIVOS[0];

/* ── Distribución ───────────────────────────────────────────────────────── */

export const PATRONES = [
  { id: 'grilla', nombre: 'Grilla', detalle: 'filas y columnas alineadas' },
  { id: 'tresbolillo', nombre: 'Tresbolillo', detalle: 'filas corridas media posición' },
  { id: 'rombo', nombre: 'Rombo', detalle: 'girado 45°, más movimiento' },
];

/** Ligamento mínimo: 2 × espesor y nunca menos de 1,5 mm. */
export function ligamentoMinimo(espesor) {
  return Math.max(1.5, 2 * (espesor || 1));
}

/**
 * Reparte `n` motivos de tamaño `tam` a lo largo de `largo`, con márgenes
 * iguales en las dos puntas.
 *
 * Márgenes iguales es lo que hace que un panel se vea hecho a propósito y no
 * cortado donde llegó. La cuenta es directa: lo que sobra después de poner los
 * motivos y sus separaciones se reparte en dos.
 */
function repartir(largo, n, tam, sepMin, margenMin) {
  if (n < 1) return null;
  const usado = n * tam + (n - 1) * sepMin;
  const sobra = largo - 2 * margenMin - usado;
  if (sobra < 0) return null;
  // Lo que sobra se reparte entre las separaciones interiores, no en los
  // márgenes: así el motivo llena el panel y no queda un marco desparejo.
  const sep = n > 1 ? sepMin + sobra / (n - 1) : sepMin;
  const margen = margenMin;
  return { n, sep, margen, paso: tam + sep };
}

/**
 * Panel decorativo.
 *
 * @param {Object} p
 *   ancho, alto      medida del panel terminado, en mm
 *   motivo           id de `MOTIVOS`, o `{ paths }` propio normalizado a 1×1
 *   tamMotivo        lado del motivo en mm
 *   separacion       ligamento mínimo pedido (0 = el mínimo calculado)
 *   margen           borde liso alrededor
 *   patron           'grilla' | 'tresbolillo' | 'rombo'
 *   giroMotivo       grados
 *   radioPanel       radio de las esquinas del panel
 *   fijaciones       { dia, margen } agujeros en las cuatro esquinas
 * @param {Object} ctx { espesor, material }
 */
export function panelDecorativo(p, ctx = {}) {
  const t = ctx.espesor ?? 1.5;
  const ancho = Math.max(50, p.ancho ?? 600);
  const alto = Math.max(50, p.alto ?? 1200);
  const tam = Math.max(3, p.tamMotivo ?? 40);
  const ligMin = ligamentoMinimo(t);
  const sepPedida = p.separacion > 0 ? p.separacion : ligMin;
  const sep = Math.max(sepPedida, ligMin);
  const margen = Math.max(p.margen ?? Math.max(tam * 0.6, ligMin * 2), ligMin);
  const patron = p.patron || 'grilla';

  const def = p.motivo?.paths ? p.motivo : getMotivo(p.motivo || p.motivoId);
  const basePaths = def.paths || def.build();

  /* Cuántos entran. Se calcula el máximo que cumple el ligamento y después se
     reparte el sobrante: nunca se fuerza un motivo de más. */
  const utilX = ancho - 2 * margen;
  const utilY = alto - 2 * margen;
  const cabenX = Math.floor((utilX + sep) / (tam + sep));
  const cabenY = Math.floor((utilY + sep) / (tam + sep));

  const cols = Math.max(0, Math.min(p.columnas || Infinity, cabenX));
  const filas = Math.max(0, Math.min(p.filas || Infinity, cabenY));

  const avisos = [];
  if (cols < 1 || filas < 1) {
    return {
      shape: normalizeShape(makeShape(rect(0, 0, ancho, alto, p.radioPanel ?? 0)), 0),
      info: { motivos: 0, caladoPct: 0, ligamento: sep, cols: 0, filas: 0 },
      avisos: [
        {
          nivel: 'error',
          msg:
            `No entra ningún motivo de ${tam} mm en un panel de ${ancho} × ${alto} mm con ` +
            `${margen.toFixed(1)} mm de margen y ${sep.toFixed(1)} mm de ligamento. ` +
            'Achicá el motivo, bajá el margen o agrandá el panel.',
        },
      ],
    };
  }

  const rx = repartir(ancho, cols, tam, sep, margen);
  const ry = repartir(alto, filas, tam, sep, margen);

  /* Tresbolillo: las filas impares se corren media posición. Se pierde media
     columna en esas filas, y hay que restarla o el motivo se sale del panel. */
  const corrido = patron === 'tresbolillo';
  const giro = patron === 'rombo' ? 45 : (p.giroMotivo ?? 0);

  const holes = [];
  const escala = tam;
  for (let j = 0; j < filas; j++) {
    const impar = corrido && j % 2 === 1;
    const nEnFila = impar ? cols - 1 : cols;
    if (nEnFila < 1) continue;
    for (let i = 0; i < nEnFila; i++) {
      const cx = rx.margen + tam / 2 + i * rx.paso + (impar ? rx.paso / 2 : 0);
      const cy = ry.margen + tam / 2 + j * ry.paso;
      for (const path of basePaths) {
        holes.push(transformPath(path, { sx: escala, sy: escala, rot: rad(giro), dx: cx, dy: cy }));
      }
    }
  }

  /* Fijaciones. Van en el borde liso, no entre los motivos: si el agujero de
     fijación cae contra un calado, el ligamento que queda es el que se rompe
     cuando se atornilla. */
  const fij = p.fijaciones;
  if (fij?.dia > 0) {
    const m = Math.max(fij.margen ?? margen / 2, fij.dia);
    for (const [x, y] of [[m, m], [ancho - m, m], [ancho - m, alto - m], [m, alto - m]]) {
      holes.push(circle(x, y, fij.dia / 2));
    }
  }

  const outer = rect(0, 0, ancho, alto, p.radioPanel ?? 0);
  const shape = normalizeShape(makeShape(outer, holes), 0);

  /* Cuánto se caló. Es el número que decide si el panel sirve para lo que se
     va a usar: arriba del 40 % pierde rigidez de verdad. */
  const areaPanel = ancho * alto;
  /* Área EXACTA de cada calado, no la de su rectángulo envolvente. Con el
     envolvente una ranura o una hoja —que llenan menos de la mitad de su
     caja— salían con el doble de calado del real, y de este número depende
     si el panel se puede usar donde el cliente lo quiere poner. */
  let areaCalada = 0;
  for (const h of holes) areaCalada += Math.abs(pathArea(h));
  const caladoPct = (areaCalada / areaPanel) * 100;
  const motivos = holes.length - (fij?.dia > 0 ? 4 : 0);

  if (sepPedida < ligMin) {
    avisos.push({
      nivel: 'aviso',
      msg:
        `Pediste ${sepPedida.toFixed(1)} mm de ligamento y en ${t} mm de chapa el mínimo es ` +
        `${ligMin.toFixed(1)} mm: se usó ese. Con menos, el calor de dos cortes vecinos se suma, ` +
        'el ligamento se ablanda y el panel sale ondulado.',
    });
  }
  if (caladoPct > 40) {
    avisos.push({
      nivel: 'aviso',
      msg:
        `El panel queda calado al ${caladoPct.toFixed(0)} %. Para una celosía o un frente ` +
        'decorativo está bien; si tiene que sostener algo o va a la intemperie con viento, ' +
        'conviene bajar el tamaño del motivo o subir el espesor.',
    });
  }
  if (motivos > 900) {
    avisos.push({
      nivel: 'aviso',
      msg:
        `${motivos} calados en un panel. Son ${motivos} perforaciones y otros tantos contornos: ` +
        'mirá el tiempo de máquina antes de cerrar el precio, porque acá el corte pesa más que la chapa.',
    });
  }
  avisos.push({
    nivel: 'info',
    msg:
      `${cols} × ${filas} en ${PATRONES.find((x) => x.id === patron)?.nombre.toLowerCase() || patron}, ` +
      `motivo de ${tam} mm, ligamento ${rx.sep.toFixed(1)} mm horizontal y ${ry.sep.toFixed(1)} mm vertical. ` +
      `Márgenes iguales de ${margen.toFixed(1)} mm en los cuatro lados.`,
  });

  return {
    shape,
    modelo3D: { tipo: 'plano' },
    info: {
      motivos,
      cols,
      filas,
      caladoPct,
      ligamento: Math.min(rx.sep, ry.sep),
      ligamentoMinimo: ligMin,
      tamMotivo: tam,
      margen,
    },
    avisos,
  };
}

/**
 * Ajusta el tamaño del motivo para llegar a una cantidad de columnas y filas
 * pedida, en un panel de medida fija.
 *
 * Es la otra forma de pedirlo, y la más común en el mostrador: "quiero seis
 * columnas a lo ancho". Se despeja el tamaño que hace que entren justas.
 */
export function tamanioParaGrilla({ ancho, alto, cols, filas, margen = 30, separacion = 6 }) {
  const porX = cols > 0 ? (ancho - 2 * margen - (cols - 1) * separacion) / cols : Infinity;
  const porY = filas > 0 ? (alto - 2 * margen - (filas - 1) * separacion) / filas : Infinity;
  const tam = Math.min(porX, porY);
  return tam > 0 ? tam : null;
}
