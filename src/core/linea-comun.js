/**
 * KORT - Corte en línea común
 *
 * Dos piezas rectangulares pegadas comparten el corte del medio: en vez de
 * cortar dos veces por el mismo lugar, se corta una sola. En un nesting de
 * piezas rectangulares eso baja entre 15 % y 30 % la longitud de corte, y con
 * ella el tiempo, el gas y el desgaste de consumibles.
 *
 * ⚠️ **NO es un descuento que se aplique solo, y esa es la decisión central
 * de este módulo.**
 *
 * Con la separación habitual del nesting (5 mm) NO hay línea común: hay dos
 * cortes distintos separados 5 mm. La línea común exige anidar borde contra
 * borde, dejando sólo el ancho de la sangría. Cotizar el ahorro sin que el
 * taller efectivamente anide así sería cotizar por debajo del costo — el
 * error más caro que puede cometer este sistema, porque no se nota.
 *
 * Por eso acá se DETECTA la oportunidad y se mide, pero aplicarla es una
 * decisión explícita de quien cotiza, que además tiene que aceptar dos cosas:
 *
 * 1. **La tolerancia empeora.** Las dos piezas se reparten una sangría: cada
 *    una queda media sangría más chica salvo que el CAM la compense. En una
 *    pieza con cotas ajustadas eso importa.
 * 2. **No se pueden separar en el desarme.** Salen pegadas por el punto donde
 *    el corte no llegó a cerrar y hay que separarlas a mano.
 *
 * Se limita a piezas RECTANGULARES a propósito. En contornos irregulares dos
 * bordes rara vez son colineales en toda su longitud, y aproximarlo daría un
 * ahorro que no existe.
 */

/** Dos bordes se consideran el mismo si están más cerca que esto, en mm. */
export const TOLERANCIA_COLINEAL = 0.6;

/** Por debajo de esto no vale la pena: el CAM no lo resuelve como línea única. */
export const LARGO_MINIMO_COMPARTIDO = 20;

const nz = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);

/**
 * Rectángulo efectivo de una pieza del layout, ya considerando la rotación.
 *
 * Devuelve null si la pieza no es un rectángulo: cuando el nesting anida por
 * forma real, `poly` trae el contorno y sólo se acepta si ese contorno ES un
 * rectángulo alineado a los ejes. Un contorno irregular no tiene bordes
 * colineales que compartir.
 */
export function rectanguloDePieza(p) {
  if (!p) return null;

  if (p.poly?.length) {
    const xs = p.poly.map((q) => q[0]);
    const ys = p.poly.map((q) => q[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    // Un rectángulo alineado tiene todos sus vértices en el borde de su caja
    const esRect = p.poly.every(
      ([x, y]) =>
        (Math.abs(x - minX) < 0.01 || Math.abs(x - maxX) < 0.01) &&
        (Math.abs(y - minY) < 0.01 || Math.abs(y - maxY) < 0.01)
    );
    if (!esRect) return null;
    return { id: p.id, x1: minX, y1: minY, x2: maxX, y2: maxY };
  }

  const rot90 = p.rot === 90 || p.rot === 270 || p.rot === true;
  const w = nz(rot90 ? p.h : p.w);
  const h = nz(rot90 ? p.w : p.h);
  if (!(w > 0) || !(h > 0)) return null;
  return { id: p.id, x1: nz(p.x), y1: nz(p.y), x2: nz(p.x) + w, y2: nz(p.y) + h };
}

const solape = (a1, a2, b1, b2) => Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));

/**
 * Bordes que dos piezas podrían cortar de una sola pasada.
 *
 * @param {Object} chapa  un elemento de `nesting.layout`
 * @param {Object} opts   { separacion, tolerancia, largoMinimo }
 * @returns {{ compartidos: Array, largoCompartido: number, rectangulares: number, total: number }}
 */
export function detectarLineasComunes(chapa, opts = {}) {
  const tol = nz(opts.tolerancia, TOLERANCIA_COLINEAL);
  const minLargo = nz(opts.largoMinimo, LARGO_MINIMO_COMPARTIDO);
  /* La separación con la que se anidó define si los bordes están pegados. Se
     suma a la tolerancia porque un nesting hecho "a línea común" deja
     exactamente esa luz y no cero. */
  const luz = nz(opts.separacion, 0);

  const piezas = chapa?.piezas || [];
  const rects = piezas.map(rectanguloDePieza).filter(Boolean);

  const compartidos = [];
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i];
      const b = rects[j];

      // Vertical: el borde derecho de una contra el izquierdo de la otra
      for (const [ax, bx] of [[a.x2, b.x1], [b.x2, a.x1]]) {
        if (Math.abs(ax - bx) > luz + tol) continue;
        const largo = solape(a.y1, a.y2, b.y1, b.y2);
        if (largo >= minLargo) compartidos.push({ tipo: 'vertical', largo, a: a.id, b: b.id });
      }

      // Horizontal: el borde superior de una contra el inferior de la otra
      for (const [ay, by] of [[a.y2, b.y1], [b.y2, a.y1]]) {
        if (Math.abs(ay - by) > luz + tol) continue;
        const largo = solape(a.x1, a.x2, b.x1, b.x2);
        if (largo >= minLargo) compartidos.push({ tipo: 'horizontal', largo, a: a.id, b: b.id });
      }
    }
  }

  return {
    compartidos,
    largoCompartido: compartidos.reduce((s, c) => s + c.largo, 0),
    rectangulares: rects.length,
    total: piezas.length,
  };
}

/**
 * Cuánto se ahorraría anidando en línea común todo el nesting de un ítem.
 *
 * @param {Object} nesting  el `nesting` que devuelve `cotizarItem()`
 * @param {number} largoCorteTotalMM  longitud de corte del lote, sin compartir
 * @param {Object} opts { separacion }
 */
export function ahorroLineaComun(nesting, largoCorteTotalMM, opts = {}) {
  const layout = nesting?.layout || [];
  if (!layout.length || !(largoCorteTotalMM > 0)) return null;

  let largoCompartido = 0;
  let rectangulares = 0;
  let total = 0;
  for (const chapa of layout) {
    const r = detectarLineasComunes(chapa, opts);
    largoCompartido += r.largoCompartido;
    rectangulares += r.rectangulares;
    total += r.total;
  }
  if (!(largoCompartido > 0)) return null;

  /* El ahorro es la longitud compartida UNA vez: ese tramo se iba a cortar
     dos veces y pasa a cortarse una. No se descuenta el doble. */
  const ahorroMM = Math.min(largoCompartido, largoCorteTotalMM * 0.5);

  return {
    ahorroMM,
    pct: (ahorroMM / largoCorteTotalMM) * 100,
    largoCompartido,
    piezasRectangulares: rectangulares,
    piezasTotales: total,
    // Sin esto la cifra no se puede juzgar: si sólo 2 de 40 piezas son
    // rectangulares, el ahorro es marginal por más que el porcentaje ilusione.
    aplicable: rectangulares === total,
  };
}

/**
 * Texto para mostrarle a quien cotiza.
 *
 * Dice el ahorro Y lo que se resigna. Un ahorro sin su contrapartida es una
 * recomendación a medias, y ésta se paga en piezas fuera de tolerancia.
 */
export function explicarLineaComun(a) {
  if (!a) return null;
  const metros = (a.ahorroMM / 1000).toFixed(2);
  const base =
    `Anidando en línea común se ahorrarían ${metros} m de corte ` +
    `(${a.pct.toFixed(0)} % del total de este ítem): las piezas van pegadas y el corte del ` +
    'medio se hace una sola vez.';
  const contra =
    ' A cambio, las piezas salen pegadas y hay que separarlas a mano, y cada una queda media ' +
    'sangría más chica si el CAM no lo compensa.';
  const parcial = a.aplicable
    ? ''
    : ` Ojo: sólo ${a.piezasRectangulares} de ${a.piezasTotales} piezas son rectangulares, ` +
      'así que el resto se corta igual que siempre.';
  return base + contra + parcial;
}

/* ------------------------------------------------------------------ */
/* Evaluación de la oportunidad                                        */
/* ------------------------------------------------------------------ */

/**
 * ¿Cuánto se ganaría anidando este lote en línea común?
 *
 * Con la separación normal del nesting la detección no encuentra nada —y está
 * bien, porque no hay nada que compartir—. Para que el dato sirva hay que
 * anidar el MISMO lote pegado y comparar. Eso es un anidado extra completo, así
 * que se llama a pedido y nunca dentro del cálculo del precio.
 *
 * @param {Function} nest   se inyecta para no acoplar este módulo al motor
 * @param {Array} items     los mismos que recibe `nest()`
 * @param {Object} chapa    { w, h }
 * @param {Object} opts     { separacion, margen, formaReal, sangria }
 */
export function evaluarLineaComun(nest, items, chapa, opts = {}) {
  const sangria = nz(opts.sangria, 0.2);

  /* Los dos anidados van por el motor RECTANGULAR, y no es una simplificación
     cómoda: el de forma real rasteriza a una grilla de ~2,7 mm para poder
     encastrar contornos irregulares, así que no puede pegar dos piezas borde
     contra borde por más que se le pida 0,2 mm de separación. Pedírselo daría
     cero siempre.
     Y no se pierde nada: la línea común es una técnica de piezas
     rectangulares, que es justo lo que el motor rectangular coloca exacto.
     Usar el mismo motor en los dos lados hace además que la comparación de
     chapas sea legítima — se mide el efecto de la separación y nada más. */
  const base = { margen: opts.margen, formaReal: false };

  let normal;
  let pegado;
  try {
    normal = nest(items, chapa, { ...base, separacion: nz(opts.separacion, 5) });
    pegado = nest(items, chapa, { ...base, separacion: sangria });
  } catch {
    return null;
  }
  if (!normal?.cantidadChapas || !pegado?.cantidadChapas) return null;
  if (pegado.noEntran?.length) return null;

  let largoCompartido = 0;
  let rectangulares = 0;
  let total = 0;
  for (const c of pegado.chapas) {
    const r = detectarLineasComunes(c, { ...opts, separacion: sangria });
    largoCompartido += r.largoCompartido;
    rectangulares += r.rectangulares;
    total += r.total;
  }
  if (!(largoCompartido > 0)) return null;

  return {
    largoCompartido,
    piezasRectangulares: rectangulares,
    piezasTotales: total,
    aplicable: rectangulares === total,
    // Anidar pegado también puede ahorrar chapa: son dos ventajas distintas
    // y conviene no mezclarlas, porque la de chapa se cobra igual y la de
    // corte sólo si el taller efectivamente lo hace.
    chapasNormal: normal.cantidadChapas,
    chapasPegado: pegado.cantidadChapas,
    chapasAhorradas: normal.cantidadChapas - pegado.cantidadChapas,
    sangria,
  };
}
