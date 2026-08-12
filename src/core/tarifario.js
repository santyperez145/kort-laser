/**
 * KORT - Tarifario por m²
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE
 *
 * En el taller no siempre hay tiempo de cotizar pieza por pieza. Cuando el
 * cliente pregunta por teléfono "¿a cuánto el metro cuadrado?", hace falta un
 * número. El problema es que **una sola tarifa plana para todo es la forma más
 * silenciosa de perder plata**, porque el costo por m² no depende del m²:
 * depende del espesor y de cuánto corte tenga la pieza.
 *
 * Medido con el motor, para acero al carbono con la chapa puesta por KORT:
 *
 *   0,9 mm  →  costo  $22.700/m²
 *   1,2 mm  →  costo  $29.800/m²
 *   3   mm  →  costo  $73.600/m²
 *   6   mm  →  costo $144.900/m²
 *
 * El material escala con el espesor y el precio plano no. Con una tarifa única
 * de $90.000/m² el trabajo de 1,2 mm deja 67 % y el de 4 mm **se hace a
 * pérdida**, sin que nadie se entere hasta que falta la plata.
 *
 * Este módulo genera la tabla de precios por m² a partir del costo real, por
 * espesor y por densidad de corte, para que la tarifa rápida siga siendo
 * rentable en todos los casos.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { makeShape, rect, circle } from './geometry.js';
import { pesoKg, findMaterial, gasRecomendado } from './materials.js';
import { redondear } from './pricing.js';

/**
 * Bandas de densidad de corte, en metros de corte por m² de chapa.
 *
 * Son la variable que el cliente entiende sin saber de láser: "¿es una placa
 * lisa o tiene muchos agujeros?". Los cortes de banda salen de medir trabajos
 * reales, no de números redondos.
 */
export const BANDAS = [
  {
    id: 'simple',
    nombre: 'Simple',
    descripcion: 'Placas, bridas, tapas. Pocos contornos y agujeros grandes.',
    ejemplo: 'Una placa de 300×200 con 4 agujeros',
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

/**
 * Construye una pieza sintética con la densidad de corte pedida.
 *
 * Se usa una pieza de referencia de 300×200 y se le agregan los agujeros que
 * hagan falta para llegar a los metros de corte por m² de la banda. No es una
 * pieza real: es una probeta para medir el costo del proceso.
 */
function probeta(mPorM2, ladoMM = 300, altoMM = 200) {
  const areaM2 = (ladoMM * altoMM) / 1e6;
  const perimetroM = (2 * (ladoMM + altoMM)) / 1000;
  const objetivoM = mPorM2 * areaM2;
  const faltanM = Math.max(0, objetivoM - perimetroM);

  const diaAgujero = 8;
  const perimetroAgujeroM = (Math.PI * diaAgujero) / 1000;
  const n = Math.round(faltanM / perimetroAgujeroM);

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
 * Genera el tarifario completo.
 *
 * @param {Object} ctx      { materiales, maquinas, config }
 * @param {Object} opts
 *   materialId       cuál cotizar (por defecto, el primero activo)
 *   espesores        lista; por defecto los del material
 *   margen           % sobre costo; por defecto el de la config
 *   conMaterial      true = KORT pone la chapa · false = la trae el cliente
 *   incluyeIVA       mostrar el precio final con IVA
 *   cotizarItem      función de cotización (se inyecta para no crear un ciclo
 *                    de imports entre pricing.js y este módulo)
 */
export function generarTarifario(ctx, opts = {}) {
  const cfg = ctx.config;
  const com = cfg.comercial;
  const material = opts.materialId ? findMaterial(ctx.materiales, opts.materialId) : ctx.materiales.find((m) => m.activo !== false);
  const espesores = opts.espesores?.length ? opts.espesores : material.espesores;
  const margen = opts.margen ?? com.margen;
  const conMaterial = opts.conMaterial !== false;
  const cotizar = opts.cotizarItem;
  if (typeof cotizar !== 'function') throw new Error('generarTarifario necesita que le pasen cotizarItem');

  const laser = (ctx.maquinas || []).find((m) => m.tipo === 'laser');
  const chapa = material.chapaStd;
  const areaChapaM2 = (chapa.w * chapa.h) / 1e6;

  const filas = [];
  for (const espesor of espesores) {
    const gas = gasRecomendado(material, espesor);
    const pesoM2 = pesoKg(1e6, espesor, material.densidad); // kg por m²
    const materialM2 = pesoM2 * material.precioKg;

    const porBanda = {};
    let hayError = null;

    for (const banda of BANDAS) {
      const p = probeta(banda.mPorM2);
      // Cantidad que llena una chapa, para que el setup se reparta como en un
      // trabajo real y no distorsione el precio por m².
      const cantidad = Math.max(1, Math.floor((chapa.w * chapa.h * 0.78) / (p.ladoMM * p.altoMM)));

      const r = cotizar(
        {
          nombre: `Tarifario ${espesor} mm ${banda.id}`,
          shape: p.shape,
          materialId: material.id,
          espesor,
          cantidad,
          gas,
          margen,
        },
        ctx
      );
      if (r.error) {
        hayError = r.error;
        break;
      }

      const areaPiezasM2 = ((p.ladoMM * p.altoMM) / 1e6) * cantidad;
      // El precio se expresa por m² de PIEZA entregada, que es lo que el
      // cliente compra. El retazo ya está dentro del costo del material.
      const costoM2 = r.costos.total / areaPiezasM2;
      const materialIncluido = r.costos.material / areaPiezasM2;
      const procesoM2 = costoM2 - materialIncluido;

      const base = conMaterial ? costoM2 : procesoM2;
      let precio = base * (1 + margen / 100);
      if (com.aplicarIIBB) precio *= 1 + (com.ingresosBrutos || 0) / 100;
      precio = redondear(precio, com.redondeo);

      porBanda[banda.id] = {
        costoM2: base,
        materialM2: materialIncluido,
        procesoM2,
        precioM2: precio,
        precioConIVA: precio * (1 + (com.iva || 0) / 100),
        metrosCorteM2: banda.mPorM2,
        minutosPorM2: (r.corte.tTotal / 60) / areaPiezasM2,
        gas,
      };
    }

    filas.push({
      espesor,
      gas,
      pesoM2,
      materialM2,
      error: hayError,
      bandas: porBanda,
    });
  }

  return {
    material: { id: material.id, nombre: material.nombre, precioKg: material.precioKg },
    chapa,
    areaChapaM2,
    potenciaKW: laser?.potenciaKW,
    margen,
    conMaterial,
    ivaPct: com.iva,
    simbolo: com.simbolo,
    generado: null, // lo estampa quien lo llama, para no usar Date aquí
    bandas: BANDAS,
    filas,
  };
}

/**
 * Compara una tarifa plana contra el costo real y dice dónde deja de convenir.
 *
 * Es la función que contesta "¿me sirve seguir cobrando $X el m²?". Devuelve,
 * por espesor y banda, la utilidad que queda y a partir de dónde se trabaja a
 * pérdida.
 */
export function evaluarTarifaPlana(tarifario, tarifaPlana) {
  const out = [];
  let primerRojo = null;
  let primerAmarillo = null;

  for (const fila of tarifario.filas) {
    if (fila.error) {
      out.push({ espesor: fila.espesor, error: fila.error });
      continue;
    }
    const porBanda = {};
    for (const b of tarifario.bandas) {
      const d = fila.bandas[b.id];
      if (!d) continue;
      const utilidad = tarifaPlana - d.costoM2;
      const utilidadPct = tarifaPlana > 0 ? (utilidad / tarifaPlana) * 100 : 0;
      porBanda[b.id] = {
        utilidad,
        utilidadPct,
        costoM2: d.costoM2,
        precioSugerido: d.precioM2,
        // Verde: margen sano · Amarillo: ajustado · Rojo: se trabaja a pérdida
        estado: utilidadPct < 0 ? 'perdida' : utilidadPct < 25 ? 'ajustado' : 'sano',
      };
      if (utilidadPct < 0 && primerRojo == null) primerRojo = { espesor: fila.espesor, banda: b.id };
      else if (utilidadPct < 25 && primerAmarillo == null) primerAmarillo = { espesor: fila.espesor, banda: b.id };
    }
    out.push({ espesor: fila.espesor, bandas: porBanda });
  }

  return {
    tarifaPlana,
    filas: out,
    primerEspesorAjustado: primerAmarillo,
    primerEspesorAPerdida: primerRojo,
  };
}

/**
 * Espesor máximo al que una tarifa plana sigue siendo rentable, para la banda
 * indicada. Es el número que hay que tener escrito en el mostrador.
 */
export function techoDeTarifa(tarifario, tarifaPlana, bandaId = 'media', utilidadMinimaPct = 30) {
  let ultimo = null;
  for (const fila of tarifario.filas) {
    const d = fila.bandas?.[bandaId];
    if (!d) continue;
    const pct = ((tarifaPlana - d.costoM2) / tarifaPlana) * 100;
    if (pct >= utilidadMinimaPct) ultimo = fila.espesor;
    else break;
  }
  return ultimo;
}
