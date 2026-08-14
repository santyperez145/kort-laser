/**
 * Guillotina: cortar la chapa sin encender el láser.
 *
 * Un desarrollo plegado es, la mayoría de las veces, **un rectángulo pelado**.
 * Un ángulo, una U, una bandeja portacables, un peldaño: el plano es un
 * rectángulo y todo lo demás lo hace la plegadora. Cortar eso con el láser es
 * pagar amortización de fuente, gas y perforaciones para hacer cuatro líneas
 * rectas que la guillotina hace de un golpe.
 *
 * La diferencia es grande: un rectángulo de 400×250 en 2 mm son ~55 segundos
 * de láser, y en guillotina son cuatro golpes de unos 10 segundos que además
 * salen a una hora de máquina mucho más barata — sin fuente que amortizar, sin
 * gas y con una fracción del consumo eléctrico.
 *
 * ## Lo que la guillotina NO puede hacer
 *
 * Corta **de lado a lado**, siempre recto y siempre pasante. Entonces:
 *
 * - Nada de agujeros. Ninguno.
 * - Nada de radios en las esquinas.
 * - Nada de escotaduras, entrantes ni contornos que no sean un rectángulo.
 * - Nada de piezas con varias partes.
 *
 * Si algo de eso está, va al láser. La decisión no se negocia por precio: una
 * pieza que la guillotina no puede hacer no la hace, y prometerlo es parar la
 * producción con la chapa ya comprada.
 *
 * Sin dependencias, como todo `src/core/`.
 */

import { partesDe, flattenPath, pathBBox } from './geometry.js';

/**
 * Guillotina mecánica de taller.
 *
 * 🔴 **Los números son de referencia y hay que confirmarlos con la máquina que
 * haya en el taller.** La capacidad de corte depende del modelo y del material:
 * una guillotina de 6 mm en acero dulce corta 4 mm en inoxidable y menos en
 * aluminio duro, porque lo que manda es la resistencia al corte.
 */
export const DEFAULT_GUILLOTINA = {
  id: 'guillotina-1',
  nombre: 'Guillotina 3050 × 6 mm',
  tipo: 'guillotina',
  largoUtil: 3050,
  /** Espesor máximo en acero dulce (Rm ≈ 370). Otros materiales se escalan. */
  espesorMaximo: 6,
  /** Segundos por golpe: posicionar contra la escuadra, sujetar y cortar. */
  tiempoPorCorte: 11,
  /** Segundos de preparación del programa y la escuadra móvil. */
  tiempoSetup: 180,
  /** Segundos extra por cada mm de largo de corte (manipular chapa grande). */
  factorLargo: 0.004,
  participacionEstructura: 25,

  costo: {
    valorEquipo: 28000000, // ≈ USD 18.500
    vidaUtilHoras: 30000,
    consumoKW: 5.5,
    costoKWh: 106.4609,
    mantenimientoHora: 450,
    consumiblesHora: 260, // afilado de cuchillas
    operarioHora: 12750,
    dedicacionOperario: 100,
  },
};

/* ── ¿Es un rectángulo pelado? ──────────────────────────────────────────── */

const TOL_MM = 0.6;

/**
 * Decide si una forma es un rectángulo que la guillotina puede cortar.
 *
 * Se mide contra la geometría real y no contra el nombre de la pieza ni
 * contra un `esRectangulo: true` que alguien haya puesto a mano: si la pieza
 * cambió y la bandera quedó vieja, se manda a la guillotina algo que no puede
 * cortar. La geometría no miente.
 *
 * @returns {{apta: boolean, motivo: string|null, ancho: number, alto: number}}
 */
export function esRectangularPelada(shape, tol = TOL_MM) {
  const partes = partesDe(shape);
  if (!partes.length) return { apta: false, motivo: 'La pieza no tiene geometría', ancho: 0, alto: 0 };
  if (partes.length > 1) {
    return { apta: false, motivo: 'Son varias partes: la guillotina corta de lado a lado', ancho: 0, alto: 0 };
  }

  const { outer, holes } = partes[0];
  const bb = pathBBox(outer);
  if ((holes || []).length) {
    return {
      apta: false,
      motivo: `Tiene ${holes.length} agujero${holes.length === 1 ? '' : 's'}: la guillotina no perfora`,
      ancho: bb.w, alto: bb.h,
    };
  }

  /* Se aplana con tolerancia fina: un radio de esquina de 3 mm tiene que
     notarse. Aplanando grueso, una esquina redondeada pasa por recta y la
     pieza sale con las puntas vivas. */
  const pts = flattenPath(outer, 0.05);
  // Se sacan los puntos repetidos y los colineales
  const limpio = [];
  for (const p of pts) {
    const u = limpio[limpio.length - 1];
    if (!u || Math.hypot(p[0] - u[0], p[1] - u[1]) > 1e-6) limpio.push(p);
  }
  if (limpio.length > 1) {
    const a = limpio[0];
    const b = limpio[limpio.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6) limpio.pop();
  }

  const esquinas = [];
  for (let i = 0; i < limpio.length; i++) {
    const a = limpio[(i - 1 + limpio.length) % limpio.length];
    const b = limpio[i];
    const c = limpio[(i + 1) % limpio.length];
    const cruz = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    const punto = (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1]);
    // Sólo cuenta como vértice si el quiebre es real
    if (Math.abs(Math.atan2(cruz, punto)) > 0.12) esquinas.push(b);
  }

  if (esquinas.length !== 4) {
    return {
      apta: false,
      motivo:
        esquinas.length > 4
          ? `El contorno tiene ${esquinas.length} vértices: no es un rectángulo`
          : 'El contorno tiene esquinas redondeadas o no cierra en cuatro vértices',
      ancho: bb.w, alto: bb.h,
    };
  }

  // Y el área tiene que ser la del rectángulo envolvente: si sobra o falta,
  // hay una escotadura aunque los vértices den cuatro.
  let area = 0;
  for (let i = 0; i < esquinas.length; i++) {
    const [x1, y1] = esquinas[i];
    const [x2, y2] = esquinas[(i + 1) % esquinas.length];
    area += x1 * y2 - x2 * y1;
  }
  area = Math.abs(area / 2);
  const areaBB = bb.w * bb.h;
  if (areaBB <= 0 || Math.abs(area - areaBB) > Math.max(areaBB * 0.005, tol * (bb.w + bb.h))) {
    return { apta: false, motivo: 'El contorno no llena su rectángulo: hay una escotadura', ancho: bb.w, alto: bb.h };
  }

  return { apta: true, motivo: null, ancho: bb.w, alto: bb.h };
}

/* ── ¿La máquina puede con este material y espesor? ─────────────────────── */

/**
 * Espesor máximo para ESTE material.
 *
 * La capacidad de una guillotina se publica en acero dulce. Lo que la limita
 * es la fuerza, y la fuerza va con la resistencia al corte del material — que
 * es del orden del 80 % de la resistencia a la tracción. Un inoxidable de
 * Rm 620 se corta hasta ~0,6 veces el espesor que el acero de Rm 370.
 */
export function espesorMaximoGuillotina(material, guillotina = DEFAULT_GUILLOTINA) {
  const rmBase = 370; // acero dulce, que es como se publica la capacidad
  const rm = material?.Rm ?? rmBase;
  return (guillotina.espesorMaximo ?? 6) * (rmBase / Math.max(rm, 1));
}

/**
 * ¿Conviene y se puede cortar esta pieza en la guillotina?
 *
 * @returns {{apta, motivo, ancho, alto, espesorMax}}
 */
export function puedeGuillotinarse(shape, espesor, material, guillotina = DEFAULT_GUILLOTINA) {
  const g = esRectangularPelada(shape);
  const espesorMax = espesorMaximoGuillotina(material, guillotina);
  if (!g.apta) return { ...g, espesorMax };

  if (espesor > espesorMax + 1e-9) {
    return {
      apta: false,
      motivo:
        `${espesor} mm de ${material?.nombre || 'este material'} supera los ${espesorMax.toFixed(1)} mm ` +
        'que la guillotina corta con este material',
      ancho: g.ancho, alto: g.alto, espesorMax,
    };
  }
  const largoUtil = guillotina.largoUtil ?? 3050;
  if (Math.min(g.ancho, g.alto) > largoUtil) {
    return {
      apta: false,
      motivo: `La pieza no entra: la guillotina corta hasta ${largoUtil} mm de largo`,
      ancho: g.ancho, alto: g.alto, espesorMax,
    };
  }
  return { apta: true, motivo: null, ancho: g.ancho, alto: g.alto, espesorMax };
}

/* ── Tiempo ─────────────────────────────────────────────────────────────── */

/**
 * Tiempo de guillotina para un lote de rectángulos.
 *
 * El corte se hace en dos pasos, que es como se trabaja: primero se corta la
 * chapa en TIRAS del ancho de la pieza (un golpe por tira), y después cada
 * tira se va cortando al largo (un golpe por pieza). El último golpe de cada
 * tira no hace falta porque la tira ya termina ahí.
 *
 * Esto es lo que hace que la guillotina sea barata en serie: cuarenta piezas
 * de una tira son cuarenta golpes, no ciento sesenta.
 */
export function tiempoGuillotina(ancho, alto, cantidad, chapa, guillotina = DEFAULT_GUILLOTINA, conSetup = true) {
  const n = Math.max(1, Math.round(cantidad));
  const tGolpe = guillotina.tiempoPorCorte ?? 11;
  const factor = guillotina.factorLargo ?? 0.004;

  // Se orienta la pieza para hacer la menor cantidad de tiras
  const opciones = [
    { anchoTira: ancho, largoPieza: alto },
    { anchoTira: alto, largoPieza: ancho },
  ];
  let mejor = null;
  for (const o of opciones) {
    const porTira = Math.max(1, Math.floor((chapa?.h ?? 1500) / o.largoPieza));
    const tiras = Math.ceil(n / porTira);
    // Un golpe por tira + un golpe por pieza (el último de cada tira es gratis)
    const golpes = tiras + Math.max(0, n - tiras);
    const largoTotal = tiras * (chapa?.w ?? 3000) + n * o.largoPieza;
    const t = golpes * tGolpe + largoTotal * factor;
    if (!mejor || t < mejor.t) mejor = { ...o, tiras, golpes, t };
  }

  const tSetup = conSetup ? (guillotina.tiempoSetup ?? 180) : 0;
  return {
    golpes: mejor.golpes,
    tiras: mejor.tiras,
    tProduccion: mejor.t,
    tSetup,
    tTotal: mejor.t + tSetup,
    anchoTira: mejor.anchoTira,
  };
}

/**
 * Compara cortar con láser contra cortar con guillotina.
 *
 * Devuelve los dos costos para que la decisión se pueda mostrar con el número
 * al lado, no como una caja negra que "eligió". Si la pieza no es apta, lo
 * dice y no compara nada.
 *
 * @param {Object} p { shape, espesor, material, cantidad, chapa }
 * @param {Object} costos { horaLaser, horaGuillotina, tiempoLaser, costoLaser }
 */
export function compararConLaser(p, costos, guillotina = DEFAULT_GUILLOTINA) {
  const apto = puedeGuillotinarse(p.shape, p.espesor, p.material, guillotina);
  if (!apto.apta) return { apta: false, motivo: apto.motivo };

  const t = tiempoGuillotina(apto.ancho, apto.alto, p.cantidad, p.chapa, guillotina);
  const costoGuillotina = (t.tTotal / 3600) * (costos.horaGuillotina || 0);
  const costoLaser = costos.costoLaser || 0;

  return {
    apta: true,
    ancho: apto.ancho,
    alto: apto.alto,
    golpes: t.golpes,
    tiras: t.tiras,
    tiempoGuillotina: t.tTotal,
    tiempoLaser: costos.tiempoLaser || 0,
    costoGuillotina,
    costoLaser,
    ahorro: costoLaser - costoGuillotina,
    ahorroPct: costoLaser > 0 ? ((costoLaser - costoGuillotina) / costoLaser) * 100 : 0,
    /* El gas no se consume, y ése suele ser el argumento decisivo en
       inoxidable: el nitrógeno de un lote puede costar más que la hora de
       máquina. Acá directamente no existe. */
    sinGas: true,
  };
}
