/**
 * KORT - Motor de precios
 * Valores de referencia: La Rioja, Argentina · agosto 2026
 *
 * Une geometría + tiempo de máquina + material + gas + nesting + acabados y
 * devuelve un precio con TODO el desglose visible. La regla de oro del
 * sistema: ningún número aparece sin que se pueda explicar de dónde salió,
 * porque el día que un cliente pregunta "¿por qué sale esto?" hay que poder
 * contestarle.
 *
 * Orden del cálculo:
 *   costo material  (según nesting real)
 *   + costo láser   (tiempo simulado × $/hora de máquina, con estructura)
 *   + gas de asistencia (según el gas elegido: acá se ve el costo del N2)
 *   + costo plegado (setup + ciclo × $/hora de plegadora)
 *   + acabados y procesos extra
 *   + ingeniería / preparación de archivo
 *   = COSTO
 *   + margen                    -> PRECIO DE LISTA
 *   - descuento por cantidad
 *   + recargo por urgencia
 *   + ingresos brutos
 *   = NETO   (+ IVA) = TOTAL
 */

import { shapeArea, shapeBBox, shapeCutLength, shapePiercings } from './geometry.js';
import { pesoKg, findMaterial, GASES, gasRecomendado, compararGases } from './materials.js';
import { tiempoCorteLote, DEFAULT_MACHINE, DEFAULT_PLEGADORA } from './cutting.js';
import { calcularEstructura, calcularCostoHoraMaquina, DEFAULT_ESTRUCTURA } from './costos.js';
import { tiempoPlegado, calcularPliegue } from './bending.js';
import { nest } from './nesting.js';

/** Catálogo de acabados. Precios de referencia de tercerizadores, ago-2026. */
export const DEFAULT_ACABADOS = [
  { id: 'ninguno', nombre: 'Sin acabado', tipo: 'ninguno', valor: 0, unidad: '-' },
  { id: 'desbarbado', nombre: 'Desbarbado manual', tipo: 'perimetro', valor: 850, unidad: '$/m de canto' },
  { id: 'granallado', nombre: 'Granallado', tipo: 'peso', valor: 900, unidad: '$/kg' },
  { id: 'pintura-polvo', nombre: 'Pintura en polvo (termolaqueado)', tipo: 'superficie', valor: 18000, unidad: '$/m²' },
  { id: 'pintura-sintetica', nombre: 'Pintura sintética / esmalte', tipo: 'superficie', valor: 9500, unidad: '$/m²' },
  { id: 'zincado', nombre: 'Zincado electrolítico', tipo: 'peso', valor: 2400, unidad: '$/kg' },
  { id: 'galvanizado', nombre: 'Galvanizado en caliente', tipo: 'peso', valor: 2100, unidad: '$/kg' },
  { id: 'pulido', nombre: 'Pulido / satinado', tipo: 'superficie', valor: 26000, unidad: '$/m²' },
  { id: 'anodizado', nombre: 'Anodizado', tipo: 'superficie', valor: 21000, unidad: '$/m²' },
];

/** Procesos adicionales, cobrados por tiempo u operación. */
export const DEFAULT_PROCESOS = [
  { id: 'soldadura-mig', nombre: 'Soldadura MIG', tipo: 'hora', valor: 17000, unidad: '$/h' },
  { id: 'soldadura-tig', nombre: 'Soldadura TIG', tipo: 'hora', valor: 22000, unidad: '$/h' },
  { id: 'roscado', nombre: 'Roscado / macho', tipo: 'operacion', valor: 450, unidad: '$/rosca' },
  { id: 'avellanado', nombre: 'Avellanado', tipo: 'operacion', valor: 380, unidad: '$/agujero' },
  { id: 'inserto', nombre: 'Inserto / tuerca remachable', tipo: 'operacion', valor: 1100, unidad: '$/u' },
  { id: 'embalaje', nombre: 'Embalaje reforzado', tipo: 'operacion', valor: 6500, unidad: '$/bulto' },
];

export const DEFAULT_CONFIG = {
  empresa: {
    nombre: 'KORT',
    razonSocial: 'KORT - Corte Láser y Plegado CNC',
    cuit: '',
    direccion: 'La Rioja, Argentina',
    telefono: '',
    email: '',
    web: '',
    logo: '',
    condicionIVA: 'Responsable Inscripto',
    provincia: 'La Rioja',
  },
  comercial: {
    moneda: 'ARS',
    simbolo: '$',
    tipoCambio: 1500, // dólar mayorista, agosto 2026
    margen: 45, // % sobre costo
    iva: 21,
    mostrarIVA: true,
    ingresosBrutos: 3.0, // % · La Rioja. Verificá tu alícuota: hay exenciones industriales
    aplicarIIBB: true,
    minimoFacturacion: 60000,
    minimoPorItem: 12000,
    validezDias: 10, // con esta inflación, más de 10 días es regalar plata
    redondeo: 500,
    ingenieriaHora: 18000,
    recargoUrgente: 35,
    recargoExpress: 70,
    descuentos: [
      { desde: 10, pct: 5 },
      { desde: 25, pct: 8 },
      { desde: 50, pct: 12 },
      { desde: 100, pct: 18 },
      { desde: 500, pct: 25 },
    ],
    modoMaterial: 'auto', // 'auto' | 'nesting' | 'prorrateado'
    aprovechamientoObjetivo: 0.78,
    scrapMinimo: 8, // %
    condicionPagoDefecto: '50 % anticipo, saldo contra entrega',
  },
  produccion: {
    separacionPiezas: 5, // mm entre piezas en el nesting
    margenChapa: 10, // mm de borde no utilizable
    nestingFormaReal: true, // anidar por contorno real y no por rectángulo
    gases: {
      O2: GASES.O2.costoM3,
      N2: GASES.N2.costoM3,
      AIRE: GASES.AIRE.costoM3,
    },
  },
  estructura: DEFAULT_ESTRUCTURA,
  acabados: DEFAULT_ACABADOS,
  procesos: DEFAULT_PROCESOS,
};

const nz = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);

export function redondear(v, paso) {
  if (!paso || paso <= 0) return v;
  return Math.ceil(v / paso) * paso;
}

export function descuentoPorCantidad(cantidad, escalones = []) {
  let pct = 0;
  for (const e of escalones) if (cantidad >= e.desde) pct = Math.max(pct, e.pct);
  return pct;
}

/**
 * Cotiza UN ítem (una pieza × cantidad).
 *
 * @param {Object} item
 *   shape, materialId, espesor, cantidad, gas,
 *   plegado {pliegues, largoPliegue, angulo, matrizV, herramentales},
 *   acabadoId, procesos[], ingenieriaHoras, margen, urgencia, descuento
 * @param {Object} ctx { materiales, maquinas, config }
 */
export function cotizarItem(item, ctx) {
  const cfg = ctx.config || DEFAULT_CONFIG;
  const com = cfg.comercial;
  const prod = cfg.produccion;
  const material = findMaterial(ctx.materiales, item.materialId);
  const laser = (ctx.maquinas || []).find((m) => m.tipo === 'laser') || DEFAULT_MACHINE;
  const plegadora = (ctx.maquinas || []).find((m) => m.tipo === 'plegadora') || DEFAULT_PLEGADORA;
  const estructura = ctx.estructura || calcularEstructura(cfg.estructura || DEFAULT_ESTRUCTURA);

  const cantidad = Math.max(1, Math.round(nz(item.cantidad, 1)));
  const t = nz(item.espesor, material.espesores?.[0] ?? 2);
  const shape = item.shape;
  const gas = item.gas || gasRecomendado(material, t);

  /* --- Geometría ------------------------------------------------------- */
  const bbox = shapeBBox(shape);
  const areaNeta = shapeArea(shape);
  const areaBBox = Math.max(1, bbox.w * bbox.h);
  const largoCorte = shapeCutLength(shape);
  const piercings = shapePiercings(shape);
  const pesoPieza = pesoKg(areaNeta, t, material.densidad);

  /* --- Nesting --------------------------------------------------------- */
  const chapaStd = item.chapa || material.chapaStd || { w: 3000, h: 1500 };
  const chapa = {
    w: Math.min(chapaStd.w, laser.areaTrabajo?.w ?? chapaStd.w),
    h: Math.min(chapaStd.h, laser.areaTrabajo?.h ?? chapaStd.h),
  };
  const nestOpts = {
    separacion: prod.separacionPiezas,
    margen: prod.margenChapa,
    formaReal: prod.nestingFormaReal !== false,
  };
  const cabe =
    (bbox.w <= chapa.w - 2 * prod.margenChapa && bbox.h <= chapa.h - 2 * prod.margenChapa) ||
    (bbox.h <= chapa.w - 2 * prod.margenChapa && bbox.w <= chapa.h - 2 * prod.margenChapa);

  let nesting = null;
  if (cabe) {
    nesting = nest(
      [{ id: 'p', nombre: item.nombre || 'Pieza', w: bbox.w, h: bbox.h, cantidad, shape }],
      chapa,
      nestOpts
    );
  }
  const chapas = nesting ? nesting.cantidadChapas : Math.ceil(cantidad);
  const aprovechamiento = nesting ? nesting.aprovechamientoGlobal : 0;

  /* --- Costo de material ----------------------------------------------- */
  const areaChapa = chapa.w * chapa.h;
  const pesoChapa = pesoKg(areaChapa, t, material.densidad);
  const costoChapa = pesoChapa * nz(material.precioKg);

  const costoPorChapasEnteras = chapas * costoChapa;
  // El área realmente consumida sale del nesting cuando está disponible:
  // con nesting de forma real, dos piezas que encastran consumen menos.
  const areaConsumida = nesting?.areaConsumidaTotal ?? areaBBox * cantidad;
  const costoProrrateado =
    (areaConsumida / (areaChapa * Math.max(0.3, com.aprovechamientoObjetivo))) *
    costoChapa *
    (1 + nz(com.scrapMinimo) / 100);

  let costoMaterial;
  let modoMaterialUsado;
  if (com.modoMaterial === 'nesting') {
    costoMaterial = costoPorChapasEnteras;
    modoMaterialUsado = 'Chapas completas';
  } else if (com.modoMaterial === 'prorrateado') {
    costoMaterial = costoProrrateado;
    modoMaterialUsado = 'Área consumida';
  } else {
    if (aprovechamiento >= com.aprovechamientoObjetivo) {
      costoMaterial = costoPorChapasEnteras;
      modoMaterialUsado = 'Chapas completas (nesting lleno)';
    } else {
      costoMaterial = Math.min(costoProrrateado, costoPorChapasEnteras);
      modoMaterialUsado = 'Área consumida (retazo reutilizable)';
    }
  }
  const pesoTotal = pesoPieza * cantidad;

  /* --- Corte láser ------------------------------------------------------ */
  const corte = tiempoCorteLote(shape, material, t, laser, cantidad, chapas, item.incluirSetup !== false, gas);
  if (corte.error) return { error: corte.error, nombre: item.nombre };

  const costoHoraLaser = calcularCostoHoraMaquina(laser, estructura);
  const costoCorte = (corte.tTotal / 3600) * costoHoraLaser.total;
  const precioGas = nz(prod.gases?.[corte.gasTipo], GASES[corte.gasTipo]?.costoM3 ?? 800);
  const costoGas = corte.gasM3Total * precioGas;

  // Alternativas de gas: cuánto costaría el mismo corte con los otros gases.
  const alternativasGas = compararGases(material, t, laser.potenciaKW, prod.gases, {
    largoCorteMM: corte.longitudTotal || largoCorte * cantidad,
    piercings: corte.piercingsTotal || piercings * cantidad,
  });

  /* --- Plegado ---------------------------------------------------------- */
  const pl = item.plegado || {};
  const nPliegues = Math.max(0, Math.round(nz(pl.pliegues, 0)));
  let plegado = null;
  let costoPlegado = 0;
  let datosPliegue = null;
  if (nPliegues > 0) {
    const largoPliegue = nz(pl.largoPliegue, Math.min(bbox.w, bbox.h));
    datosPliegue = calcularPliegue(t, nz(pl.angulo, 90), material, pl.matrizV || null, largoPliegue);
    plegado = tiempoPlegado(cantidad, nPliegues, largoPliegue, pesoPieza, plegadora, nz(pl.herramentales, 1));
    const costoHoraPlegadora = calcularCostoHoraMaquina(plegadora, estructura);
    costoPlegado = (plegado.tTotal / 3600) * costoHoraPlegadora.total;
    plegado.costoHora = costoHoraPlegadora;
    plegado.nPliegues = nPliegues;
    plegado.largoPliegue = largoPliegue;
  }

  /* --- Acabados --------------------------------------------------------- */
  const acabado = (cfg.acabados || DEFAULT_ACABADOS).find((a) => a.id === item.acabadoId) || null;
  let costoAcabado = 0;
  let detalleAcabado = null;
  if (acabado && acabado.tipo !== 'ninguno') {
    const superficieM2 = ((areaNeta * 2) / 1e6) * cantidad;
    if (acabado.tipo === 'superficie') costoAcabado = superficieM2 * acabado.valor;
    else if (acabado.tipo === 'peso') costoAcabado = pesoTotal * acabado.valor;
    else if (acabado.tipo === 'perimetro') costoAcabado = (largoCorte / 1000) * cantidad * acabado.valor;
    detalleAcabado = { nombre: acabado.nombre, base: acabado.tipo, superficieM2, pesoTotal, costo: costoAcabado };
  }

  /* --- Procesos extra --------------------------------------------------- */
  let costoProcesos = 0;
  const detalleProcesos = [];
  for (const p of item.procesos || []) {
    const def = (cfg.procesos || DEFAULT_PROCESOS).find((x) => x.id === p.id);
    if (!def) continue;
    const q = nz(p.cantidad, 0);
    const c = def.tipo === 'hora' ? q * def.valor : q * def.valor * cantidad;
    costoProcesos += c;
    detalleProcesos.push({ nombre: def.nombre, cantidad: q, unidad: def.unidad, costo: c });
  }

  /* --- Ingeniería ------------------------------------------------------- */
  const costoIngenieria = nz(item.ingenieriaHoras, 0) * nz(com.ingenieriaHora);

  /* --- Totales ---------------------------------------------------------- */
  const costoTotal =
    costoMaterial + costoCorte + costoGas + costoPlegado + costoAcabado + costoProcesos + costoIngenieria;
  const margen = nz(item.margen, com.margen);
  const precioLista = costoTotal * (1 + margen / 100);

  const pctDesc = item.descuento != null ? nz(item.descuento) : descuentoPorCantidad(cantidad, com.descuentos);
  const conDescuento = precioLista * (1 - pctDesc / 100);

  const recargoPct =
    item.urgencia === 'express' ? nz(com.recargoExpress) : item.urgencia === 'urgente' ? nz(com.recargoUrgente) : 0;
  let neto = conDescuento * (1 + recargoPct / 100);

  // Ingresos brutos: es un impuesto sobre la facturación, no sobre la
  // ganancia. Si no se traslada al precio, sale del margen.
  const iibbPct = com.aplicarIIBB ? nz(com.ingresosBrutos) : 0;
  const iibb = iibbPct > 0 ? neto * (iibbPct / 100) : 0;
  neto += iibb;

  const minItem = nz(com.minimoPorItem);
  let aplicoMinimo = false;
  if (neto < minItem) {
    neto = minItem;
    aplicoMinimo = true;
  }
  neto = redondear(neto, com.redondeo);
  const unitario = neto / cantidad;

  return {
    nombre: item.nombre || 'Pieza',
    cantidad,
    material: { id: material.id, nombre: material.nombre, precioKg: material.precioKg, densidad: material.densidad },
    espesor: t,
    gas,
    geometria: {
      ancho: bbox.w,
      alto: bbox.h,
      areaNetaMM2: areaNeta,
      areaBBoxMM2: areaBBox,
      largoCorteMM: largoCorte,
      piercings,
      pesoPieza,
      pesoTotal,
    },
    nesting: nesting
      ? {
          chapas,
          aprovechamiento,
          aprovechamientoUltima: nesting.aprovechamientoUltima,
          piezasPorChapa: nesting.chapas[0]?.piezas.length || 0,
          metodo: nesting.metodo,
          chapa,
          layout: nesting.chapas,
        }
      : { error: 'La pieza no entra en la chapa / área de trabajo', chapa },
    corte,
    plegado,
    datosPliegue,
    alternativasGas,
    costos: {
      material: costoMaterial,
      modoMaterial: modoMaterialUsado,
      costoChapa,
      pesoChapa,
      corte: costoCorte,
      costoHoraLaser: costoHoraLaser.total,
      desgloseHoraLaser: costoHoraLaser,
      gas: costoGas,
      gasTipo: corte.gasTipo,
      gasM3: corte.gasM3Total,
      precioGasM3: precioGas,
      plegado: costoPlegado,
      acabado: costoAcabado,
      detalleAcabado,
      procesos: costoProcesos,
      detalleProcesos,
      ingenieria: costoIngenieria,
      total: costoTotal,
      porPieza: costoTotal / cantidad,
    },
    precio: {
      margen,
      lista: precioLista,
      descuentoPct: pctDesc,
      recargoPct,
      iibbPct,
      iibb,
      aplicoMinimo,
      neto,
      unitario,
      utilidad: neto - costoTotal - iibb,
      utilidadPct: neto > 0 ? ((neto - costoTotal - iibb) / neto) * 100 : 0,
    },
    tiempos: {
      corteUnitario: corte.tPieza,
      corteTotal: corte.tTotal,
      plegadoTotal: plegado?.tTotal || 0,
      total: corte.tTotal + (plegado?.tTotal || 0),
    },
  };
}

/** Cotiza un presupuesto completo y agrega totales, IVA y mínimos. */
export function cotizarPresupuesto(presupuesto, ctx) {
  const cfg = ctx.config || DEFAULT_CONFIG;
  const com = cfg.comercial;
  const estructura = ctx.estructura || calcularEstructura(cfg.estructura || DEFAULT_ESTRUCTURA);
  const ctx2 = { ...ctx, estructura };

  const items = [];
  const errores = [];
  for (const it of presupuesto.items || []) {
    const r = cotizarItem(it, ctx2);
    if (r.error) errores.push(r);
    else items.push(r);
  }

  const subtotalCosto = items.reduce((a, i) => a + i.costos.total, 0);
  let subtotal = items.reduce((a, i) => a + i.precio.neto, 0);

  const descGlobal = nz(presupuesto.descuentoGlobal, 0);
  subtotal = subtotal * (1 - descGlobal / 100);

  let aplicoMinimo = false;
  if (subtotal > 0 && subtotal < nz(com.minimoFacturacion)) {
    subtotal = nz(com.minimoFacturacion);
    aplicoMinimo = true;
  }
  subtotal = redondear(subtotal, com.redondeo);

  const iva = com.mostrarIVA ? subtotal * (nz(com.iva) / 100) : 0;
  const total = subtotal + iva;

  const tiempoTotal = items.reduce((a, i) => a + i.tiempos.total, 0);
  const pesoTotal = items.reduce((a, i) => a + i.geometria.pesoTotal, 0);
  const chapasTotal = items.reduce((a, i) => a + (i.nesting?.chapas || 0), 0);
  const gasTotal = items.reduce((a, i) => a + i.costos.gas, 0);

  return {
    items,
    errores,
    estructura,
    resumen: {
      cantidadItems: items.length,
      piezasTotales: items.reduce((a, i) => a + i.cantidad, 0),
      costo: subtotalCosto,
      subtotal,
      descuentoGlobal: descGlobal,
      aplicoMinimo,
      iva,
      ivaPct: com.iva,
      total,
      utilidad: subtotal - subtotalCosto,
      utilidadPct: subtotal > 0 ? ((subtotal - subtotalCosto) / subtotal) * 100 : 0,
      tiempoProduccion: tiempoTotal,
      pesoTotal,
      chapasTotal,
      costoGas: gasTotal,
      moneda: com.moneda,
      simbolo: com.simbolo,
      totalUSD: com.tipoCambio > 0 ? total / com.tipoCambio : null,
      tipoCambio: com.tipoCambio,
    },
  };
}

/** Formateo de moneda estilo argentino: $ 1.234.567,89 */
export function fmtMoneda(v, simbolo = '$', decimales = 2) {
  if (!isFinite(v)) return '-';
  const n = Math.abs(v).toFixed(decimales);
  const [ent, dec] = n.split('.');
  const miles = ent.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${v < 0 ? '-' : ''}${simbolo} ${miles}${dec ? ',' + dec : ''}`;
}

export function fmtNum(v, d = 1) {
  if (!isFinite(v)) return '-';
  return v.toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });
}
