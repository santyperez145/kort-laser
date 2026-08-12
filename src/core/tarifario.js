/**
 * KORT - Tarifario
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE
 *
 * En el mostrador no siempre se puede cotizar pieza por pieza. Cuando el
 * cliente pregunta "¿a cuánto?", hace falta un número. El problema es que
 * **cualquier tarifa plana se rompe**, y cada base se rompe por un lado
 * distinto:
 *
 *   · Cobrar por m²  falla con el ESPESOR. El material escala con el espesor
 *     y el precio plano no: a $90.000/m² el trabajo de 1,2 mm deja 52 % y el
 *     de 4 mm se hace a pérdida.
 *
 *   · Cobrar por kg  falla al REVÉS, con la chapa FINA. Un kilo de 0,9 mm es
 *     0,142 m² y un kilo de 10 mm es 0,013 m²: once veces más superficie que
 *     cortar por el mismo kilo cobrado. Y además el recorte lo pagás vos:
 *     con 78 % de aprovechamiento, el kilo que entregás te costó el kilo de
 *     chapa dividido 0,78.
 *
 *   · Cobrar por metro de corte  falla con el ESPESOR al revés que el m²: no
 *     cobra el material, así que sirve sólo cuando la chapa la trae el cliente.
 *
 * Este módulo calcula, para cada espesor y cada nivel de detalle:
 *   · el COSTO real,
 *   · el PRECIO MÍNIMO por debajo del cual se trabaja a pérdida,
 *   · el PRECIO SUGERIDO con el margen que se quiera,
 * en las tres bases, y evalúa la tarifa que se está cobrando hoy.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { makeShape, rect, circle } from './geometry.js';
import { pesoKg, findMaterial, gasRecomendado } from './materials.js';
import { redondear } from './pricing.js';

/** Bases de cobro posibles. */
export const BASES = [
  { id: 'm2', nombre: 'Por m²', unidad: '$/m²', ayuda: 'Lo más común en corte láser. Falla con el espesor.' },
  { id: 'kg', nombre: 'Por kilo', unidad: '$/kg', ayuda: 'Lo habitual cuando se vende chapa cortada. Falla con la chapa fina.' },
  { id: 'metro', nombre: 'Por metro de corte', unidad: '$/m', ayuda: 'Sólo el proceso. Para cuando la chapa la trae el cliente.' },
];

/**
 * Niveles de detalle, en metros de corte por m² de chapa.
 *
 * Es la variable que el cliente entiende sin saber de láser: "¿es una placa
 * lisa o tiene muchos agujeros?".
 */
export const BANDAS = [
  {
    id: 'simple',
    nombre: 'Simple',
    descripcion: 'Chapa lisa cortada a medida, placas, bridas, tapas.',
    ejemplo: 'Una placa de 400×300 sin agujeros',
    mPorM2: 14,
  },
  {
    id: 'media',
    nombre: 'Media',
    descripcion: 'Piezas con recortes, varias perforaciones, contorno con detalle.',
    ejemplo: 'Un frente de gabinete con pasacables y fijaciones',
    mPorM2: 35,
  },
  {
    id: 'compleja',
    nombre: 'Compleja',
    descripcion: 'Muchas piezas chicas o muchos agujeros por pieza.',
    ejemplo: 'Piezas de 100×80 anidadas, o una placa con 100 perforaciones',
    mPorM2: 75,
  },
  {
    id: 'perforada',
    nombre: 'Perforada / decorativa',
    descripcion: 'Rejillas, cartelería calada, chapa perforada.',
    ejemplo: 'Rejilla de ventilación con 400 agujeros',
    mPorM2: 160,
  },
];

/** Umbrales de utilidad, en % sobre el precio. */
export const UMBRALES = {
  perdida: 0, // por debajo de esto se pierde plata
  ajustado: 25, // entre 0 y 25 se trabaja sin colchón
  sano: 25,
};

/**
 * Probeta: una pieza sintética con la densidad de corte pedida.
 *
 * No es una pieza real, es una muestra para medir el costo del proceso a esa
 * densidad. Se parte de 400×300 —una medida de chapa cortada típica— y se le
 * agregan los agujeros que hagan falta.
 */
function probeta(mPorM2, ladoMM = 400, altoMM = 300) {
  const areaM2 = (ladoMM * altoMM) / 1e6;
  const perimetroM = (2 * (ladoMM + altoMM)) / 1000;
  const objetivoM = mPorM2 * areaM2;
  const faltanM = Math.max(0, objetivoM - perimetroM);

  const diaAgujero = 8;
  const n = Math.round(faltanM / ((Math.PI * diaAgujero) / 1000));

  const holes = [];
  if (n > 0) {
    const cols = Math.max(1, Math.ceil(Math.sqrt(n * (ladoMM / altoMM))));
    const filas = Math.max(1, Math.ceil(n / cols));
    let puestos = 0;
    for (let i = 0; i < cols && puestos < n; i++) {
      for (let j = 0; j < filas && puestos < n; j++) {
        holes.push(circle(((i + 0.5) * ladoMM) / cols, ((j + 0.5) * altoMM) / filas, diaAgujero / 2));
        puestos++;
      }
    }
  }
  return { shape: makeShape(rect(0, 0, ladoMM, altoMM), holes), ladoMM, altoMM, agujeros: n };
}

/**
 * Genera el tarifario completo, en las tres bases a la vez.
 *
 * @param {Object} ctx  { materiales, maquinas, config }
 * @param {Object} opts
 *   materialId, espesores, margen, conMaterial, cotizarItem
 */
export function generarTarifario(ctx, opts = {}) {
  const cfg = ctx.config;
  const com = cfg.comercial;
  const material = opts.materialId
    ? findMaterial(ctx.materiales, opts.materialId)
    : ctx.materiales.find((m) => m.activo !== false);
  const espesores = opts.espesores?.length ? opts.espesores : material.espesores;
  const margen = opts.margen ?? com.margen;
  const conMaterial = opts.conMaterial !== false;
  const cotizar = opts.cotizarItem;
  if (typeof cotizar !== 'function') throw new Error('generarTarifario necesita que le pasen cotizarItem');

  const laser = (ctx.maquinas || []).find((m) => m.tipo === 'laser');
  const chapa = material.chapaStd;
  const areaChapaM2 = (chapa.w * chapa.h) / 1e6;
  const iibb = com.aplicarIIBB ? (com.ingresosBrutos || 0) / 100 : 0;

  /** Lleva un costo a precio: margen + ingresos brutos + redondeo. */
  const aPrecio = (costo, m = margen) => redondear(costo * (1 + m / 100) * (1 + iibb), com.redondeo);

  const filas = [];
  for (const espesor of espesores) {
    const gas = gasRecomendado(material, espesor);
    const kgPorM2 = pesoKg(1e6, espesor, material.densidad);

    const porBanda = {};
    let hayError = null;

    for (const banda of BANDAS) {
      const p = probeta(banda.mPorM2);
      const areaPiezaM2 = (p.ladoMM * p.altoMM) / 1e6;
      // Cantidad que llena una chapa, para que el setup se reparta como en un
      // trabajo real y no distorsione el precio unitario.
      const cantidad = Math.max(1, Math.floor((chapa.w * chapa.h * 0.78) / (p.ladoMM * p.altoMM)));

      const r = cotizar(
        {
          nombre: `Tarifario ${espesor} ${banda.id}`,
          shape: p.shape, materialId: material.id, espesor, cantidad, gas, margen,
        },
        ctx
      );
      if (r.error) {
        hayError = r.error;
        break;
      }

      const m2Entregados = areaPiezaM2 * cantidad;
      const kgEntregados = r.geometria.pesoTotal;
      const metrosCorte = (r.geometria.largoCorteMM / 1000) * cantidad;

      const costoTotal = r.costos.total;
      const costoMaterial = r.costos.material;
      const costoProceso = costoTotal - costoMaterial;
      const base = conMaterial ? costoTotal : costoProceso;

      // El aprovechamiento es lo que explica por qué el kilo entregado cuesta
      // más que el kilo comprado: el recorte lo paga el taller.
      const aprovechamiento = r.nesting?.aprovechamiento ?? null;
      const costoMaterialPorKg = kgEntregados > 0 ? costoMaterial / kgEntregados : 0;

      porBanda[banda.id] = {
        // Costos, en las tres bases
        costoM2: base / m2Entregados,
        costoKg: base / kgEntregados,
        costoMetro: base / metrosCorte,
        // Desglose, para poder explicar el número
        materialM2: costoMaterial / m2Entregados,
        materialKg: costoMaterialPorKg,
        procesoM2: costoProceso / m2Entregados,
        procesoKg: costoProceso / kgEntregados,
        // Precios
        minimoM2: redondear((base / m2Entregados) * (1 + iibb), com.redondeo),
        minimoKg: redondear((base / kgEntregados) * (1 + iibb), com.redondeo),
        minimoMetro: redondear((base / metrosCorte) * (1 + iibb), com.redondeo),
        precioM2: aPrecio(base / m2Entregados),
        precioKg: aPrecio(base / kgEntregados),
        precioMetro: aPrecio(base / metrosCorte),
        // Datos físicos
        metrosCorteM2: banda.mPorM2,
        metrosCorteKg: metrosCorte / kgEntregados,
        minutosPorM2: r.corte.tTotal / 60 / m2Entregados,
        aprovechamiento,
        gas,
      };
    }

    filas.push({
      espesor,
      gas,
      kgPorM2,
      m2PorKg: kgPorM2 > 0 ? 1 / kgPorM2 : 0,
      error: hayError,
      bandas: porBanda,
    });
  }

  return {
    material: { id: material.id, nombre: material.nombre, precioKg: material.precioKg, densidad: material.densidad },
    chapa,
    areaChapaM2,
    potenciaKW: laser?.potenciaKW,
    margen,
    conMaterial,
    ivaPct: com.iva,
    iibbPct: com.aplicarIIBB ? com.ingresosBrutos : 0,
    simbolo: com.simbolo,
    bandas: BANDAS,
    bases: BASES,
    filas,
  };
}

/** Nombre del campo de costo y de precio según la base. */
const CAMPO = {
  m2: { costo: 'costoM2', minimo: 'minimoM2', precio: 'precioM2' },
  kg: { costo: 'costoKg', minimo: 'minimoKg', precio: 'precioKg' },
  metro: { costo: 'costoMetro', minimo: 'minimoMetro', precio: 'precioMetro' },
};

export function estadoDe(utilidadPct) {
  if (utilidadPct < UMBRALES.perdida) return 'perdida';
  if (utilidadPct < UMBRALES.ajustado) return 'ajustado';
  return 'sano';
}

/**
 * Evalúa una tarifa plana contra el costo real, en la base que sea.
 *
 * Contesta la pregunta del mostrador: "¿me sirve seguir cobrando esto?".
 */
export function evaluarTarifaPlana(tarifario, tarifaPlana, base = 'm2') {
  const campo = CAMPO[base] || CAMPO.m2;
  const filas = [];
  let primerRojo = null;
  let primerAmarillo = null;
  let peor = null;
  let mejor = null;

  for (const fila of tarifario.filas) {
    if (fila.error) {
      filas.push({ espesor: fila.espesor, error: fila.error });
      continue;
    }
    const porBanda = {};
    for (const b of tarifario.bandas) {
      const d = fila.bandas[b.id];
      if (!d) continue;
      const costo = d[campo.costo];
      const utilidad = tarifaPlana - costo;
      const utilidadPct = tarifaPlana > 0 ? (utilidad / tarifaPlana) * 100 : -100;
      const estado = estadoDe(utilidadPct);
      porBanda[b.id] = {
        costo, utilidad, utilidadPct, estado,
        precioSugerido: d[campo.precio],
        precioMinimo: d[campo.minimo],
      };
      if (estado === 'perdida' && !primerRojo) primerRojo = { espesor: fila.espesor, banda: b.id, utilidadPct };
      if (estado === 'ajustado' && !primerAmarillo) primerAmarillo = { espesor: fila.espesor, banda: b.id, utilidadPct };
      if (!peor || utilidadPct < peor.utilidadPct) peor = { espesor: fila.espesor, banda: b.id, utilidadPct };
      if (!mejor || utilidadPct > mejor.utilidadPct) mejor = { espesor: fila.espesor, banda: b.id, utilidadPct };
    }
    filas.push({ espesor: fila.espesor, bandas: porBanda });
  }

  const todas = filas.flatMap((f) => Object.values(f.bandas || {}));
  const enPerdida = todas.filter((d) => d.estado === 'perdida').length;

  return {
    base,
    tarifaPlana,
    filas,
    primerEspesorAjustado: primerAmarillo,
    primerEspesorAPerdida: primerRojo,
    peor,
    mejor,
    casos: todas.length,
    casosEnPerdida: enPerdida,
    // Veredicto de una línea, que es lo que se lee primero
    veredicto:
      enPerdida === todas.length ? 'todo-perdida'
        : enPerdida > todas.length / 2 ? 'mayoria-perdida'
          : enPerdida > 0 ? 'parcial'
            : 'sana',
  };
}

/**
 * Espesor máximo al que una tarifa plana sigue siendo rentable.
 * Es el número que conviene tener escrito en el mostrador.
 */
export function techoDeTarifa(tarifario, tarifaPlana, bandaId = 'media', utilidadMinimaPct = 30, base = 'm2') {
  const campo = CAMPO[base] || CAMPO.m2;
  let ultimo = null;
  for (const fila of tarifario.filas) {
    const d = fila.bandas?.[bandaId];
    if (!d) continue;
    const pct = ((tarifaPlana - d[campo.costo]) / tarifaPlana) * 100;
    if (pct >= utilidadMinimaPct) ultimo = fila.espesor;
    else break;
  }
  return ultimo;
}

/**
 * Rango de precio recomendado para una base: el piso por debajo del cual se
 * pierde plata, y el precio con el margen objetivo.
 *
 * Es lo que contesta "no cobrar ni barato ni caro": el piso es cuánto NO se
 * puede bajar, y el sugerido es dónde apuntar.
 */
export function rangoRecomendado(tarifario, base = 'm2', bandaId = 'simple') {
  const campo = CAMPO[base] || CAMPO.m2;
  const puntos = [];
  for (const fila of tarifario.filas) {
    const d = fila.bandas?.[bandaId];
    if (!d) continue;
    puntos.push({
      espesor: fila.espesor,
      costo: d[campo.costo],
      minimo: d[campo.minimo],
      sugerido: d[campo.precio],
    });
  }
  if (!puntos.length) return null;
  return {
    base, bandaId,
    minimo: Math.min(...puntos.map((p) => p.minimo)),
    maximo: Math.max(...puntos.map((p) => p.sugerido)),
    puntos,
    // En $/kg el precio casi no cambia con el espesor, así que un valor único
    // tiene sentido; en $/m² varía de 1 a 20 y una tarifa única no sirve.
    dispersion: Math.max(...puntos.map((p) => p.sugerido)) / Math.min(...puntos.map((p) => p.sugerido)),
  };
}

/**
 * ¿A qué precio de chapa cierra la tarifa que se está cobrando?
 *
 * Cuando el número no da, la pregunta siguiente siempre es la misma: "¿estoy
 * cobrando poco o estoy comprando caro?". Esta función contesta la segunda
 * mitad: cuánto tendría que costar el kilo de chapa para que la tarifa actual
 * deje el margen que se quiere.
 */
export function precioChapaNecesario(tarifario, tarifaPlana, base = 'm2', bandaId = 'simple', margenObjetivo = 30, espesorRef = null) {
  const campo = CAMPO[base] || CAMPO.m2;
  const fila = espesorRef
    ? tarifario.filas.find((f) => f.espesor === espesorRef && !f.error)
    : tarifario.filas.find((f) => !f.error);
  const d = fila?.bandas?.[bandaId];
  if (!d) return null;

  const costoActual = d[campo.costo];
  const materialActual = base === 'kg' ? d.materialKg : d.materialM2;
  const proceso = costoActual - materialActual;

  // Costo que hace falta para que la tarifa deje el margen objetivo
  const costoObjetivo = tarifaPlana / (1 + margenObjetivo / 100);
  const materialObjetivo = costoObjetivo - proceso;
  if (materialObjetivo <= 0) {
    return { imposible: true, espesor: fila.espesor, costoActual, proceso, materialActual };
  }
  // El material por unidad entregada incluye el recorte; se vuelve al $/kg de compra
  const factorRecorte = materialActual / (tarifario.material.precioKg * (base === 'kg' ? 1 : d.materialM2 / (d.materialKg || 1)));
  const precioChapa = tarifario.material.precioKg * (materialObjetivo / materialActual);

  return {
    espesor: fila.espesor,
    costoActual,
    materialActual,
    proceso,
    precioChapaActual: tarifario.material.precioKg,
    precioChapaNecesario: precioChapa,
    diferenciaPct: ((precioChapa - tarifario.material.precioKg) / tarifario.material.precioKg) * 100,
    alcanzable: precioChapa >= tarifario.material.precioKg * 0.75,
    factorRecorte,
  };
}

/**
 * Sensibilidad al APROVECHAMIENTO.
 *
 * Cuando se cobra por kilo, el recorte lo paga el taller: con 77 % de
 * aprovechamiento, la chapa de $2.950 el kilo se convierte en $3.831 por kilo
 * entregado **antes de encender la máquina**. Subir el aprovechamiento es,
 * en esa base de cobro, exactamente lo mismo que comprar más barato.
 *
 * Es la palanca que sí depende del taller: anidar mejor, agrupar pedidos del
 * mismo espesor, usar los retazos.
 */
export function sensibilidadAprovechamiento(tarifario, tarifaPlana, base = 'kg', bandaId = 'simple', niveles = null) {
  const campo = CAMPO[base] || CAMPO.kg;
  const fila = tarifario.filas.find((f) => !f.error);
  const d = fila?.bandas?.[bandaId];
  if (!d) return [];

  const actual = d.aprovechamiento ?? 0.78;
  const lista = niveles || [0.6, 0.7, 0.78, 0.85, 0.9, 0.95];
  const materialActual = base === 'kg' ? d.materialKg : d.materialM2;
  const proceso = d[campo.costo] - materialActual;

  return lista.map((aprov) => {
    // El material por unidad entregada es inversamente proporcional al
    // aprovechamiento: la chapa que se tira igual se pagó.
    const material = materialActual * (actual / aprov);
    const costo = material + proceso;
    const utilidadPct = tarifaPlana > 0 ? ((tarifaPlana - costo) / tarifaPlana) * 100 : -100;
    return {
      aprovechamiento: aprov,
      esActual: Math.abs(aprov - actual) < 0.02,
      material,
      costo,
      utilidadPct,
      estado: estadoDe(utilidadPct),
    };
  });
}

/**
 * Sensibilidad: cómo cambia la utilidad de una tarifa según lo que se pague
 * por la chapa. Es la tabla que hay que mirar antes de decidir si el problema
 * es el precio de venta o el de compra.
 */
export function sensibilidadChapa(tarifario, tarifaPlana, base = 'm2', bandaId = 'simple', precios = null) {
  const campo = CAMPO[base] || CAMPO.m2;
  const fila = tarifario.filas.find((f) => !f.error);
  const d = fila?.bandas?.[bandaId];
  if (!d) return [];

  const actual = tarifario.material.precioKg;
  const lista = precios || [0.7, 0.85, 1, 1.15, 1.3, 1.5].map((f) => Math.round((actual * f) / 50) * 50);
  const materialActual = base === 'kg' ? d.materialKg : d.materialM2;
  const proceso = d[campo.costo] - materialActual;

  return lista.map((precioChapa) => {
    const material = materialActual * (precioChapa / actual);
    const costo = material + proceso;
    const utilidadPct = tarifaPlana > 0 ? ((tarifaPlana - costo) / tarifaPlana) * 100 : -100;
    return {
      precioChapa,
      esActual: Math.abs(precioChapa - actual) < actual * 0.03,
      material,
      costo,
      utilidadPct,
      estado: estadoDe(utilidadPct),
    };
  });
}
