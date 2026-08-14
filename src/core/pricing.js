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
import { factorPara } from './calibracion.js';
import { DEFAULT_GUILLOTINA, compararConLaser, tiempoGuillotina } from './guillotina.js';

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
    /**
     * Recargo sobre el tiempo de máquina cuando la chapa la pone el cliente.
     *
     * 30 % es el orden de lo que cobra un taller, y sale de dos cosas
     * concretas, no de un capricho:
     *
     * - Se pierde el margen del material. En chapa fina el material es el
     *   grueso del trabajo; cortando a la misma tarifa, el trabajo queda con
     *   casi nada de ganancia.
     * - El riesgo cambia de manos. Chapa alabeada, con óxido o con un espesor
     *   que no es el que dice: el corte sale mal y la repone el taller, que no
     *   la compró ni la eligió.
     *
     * Se puede poner en 0 si se prefiere cobrarlo con el margen del ítem. Lo
     * importante es que sea una decisión y no un olvido.
     */
    recargoMaterialCliente: 30,
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

/* ================================================================== */
/* Nesting por presupuesto                                             */
/* ================================================================== */

/** La chapa del material, recortada al área de trabajo de la máquina. */
function chapaDe(item, material, laser) {
  const std = item.chapa || material.chapaStd || { w: 3000, h: 1500 };
  return {
    w: Math.min(std.w, laser.areaTrabajo?.w ?? std.w),
    h: Math.min(std.h, laser.areaTrabajo?.h ?? std.h),
  };
}

/** Si la pieza entra en la chapa, en cualquiera de las dos orientaciones. */
function entraEnChapa(bbox, chapa, margen) {
  const w = chapa.w - 2 * margen;
  const h = chapa.h - 2 * margen;
  return (bbox.w <= w && bbox.h <= h) || (bbox.h <= w && bbox.w <= h);
}

/**
 * Agrupa los ítems que van juntos a la misma chapa y los anida de una sola vez.
 *
 * Por qué existe: la máquina no corta un ítem por chapa, corta un PROGRAMA por
 * chapa. Tres piezas distintas del mismo material y espesor entran juntas y se
 * cortan de una. Anidando por ítem el sistema reportaba tres chapas donde va
 * una, cobraba tres puestas a punto que nunca ocurren, y mostraba un
 * aprovechamiento subestimado — que es justo el número que dice si conviene
 * ofrecerle más piezas al cliente.
 *
 * Medido con tres placas de acero de 3 mm (600×400, 500×300 y 400×250, cuatro
 * de cada una): 3 chapas al 32/20/13 % pasan a 1 chapa al 65,8 % —el techo
 * teórico de ese lote sobre la chapa de 2440×1220— y 13,5 minutos de setup y
 * carga pasan a 4,5. El costo baja $5.096 sobre $199.662, un 2,6 %.
 *
 * La clave del grupo lleva el gas además del material y el espesor: cambiar de
 * gas es cambiar de programa y de boquilla, así que no comparten chapa aunque
 * el material sea el mismo.
 *
 * Lo que le toca a cada ítem se reparte **por el área que ocupa en el layout
 * real**, no por cantidad de piezas: una pieza grande consume más chapa y más
 * carga de material, y tiene que pagarla.
 *
 * Los grupos de un solo ítem no se planifican acá — los anida `cotizarItem`
 * como siempre. Así el camino de siempre queda intacto y este código sólo
 * corre cuando efectivamente hay algo que compartir.
 *
 * @returns {Map<number, Object>} índice del ítem -> su parte del grupo
 */
export function planificarNesting(itemsCrudos, ctx) {
  const cfg = ctx.config || DEFAULT_CONFIG;
  const prod = cfg.produccion;
  const laser = (ctx.maquinas || []).find((m) => m.tipo === 'laser') || DEFAULT_MACHINE;
  const nestOpts = {
    separacion: prod.separacionPiezas,
    margen: prod.margenChapa,
    formaReal: prod.nestingFormaReal !== false,
  };

  /* --- Agrupar --- */
  const grupos = new Map();
  (itemsCrudos || []).forEach((item, indice) => {
    if (!item?.shape) return;
    const material = findMaterial(ctx.materiales, item.materialId);
    if (!material) return;
    const t = nz(item.espesor, material.espesores?.[0] ?? 2);
    const gas = item.gas || gasRecomendado(material, t);
    const chapa = chapaDe(item, material, laser);
    const bbox = shapeBBox(item.shape);
    if (!entraEnChapa(bbox, chapa, prod.margenChapa)) return;

    const clave = `${material.id}|${t}|${gas}|${chapa.w}x${chapa.h}`;
    if (!grupos.has(clave)) {
      grupos.set(clave, { clave, materialId: material.id, espesor: t, gas, chapa, miembros: [] });
    }
    grupos.get(clave).miembros.push({
      indice,
      item,
      bbox,
      cantidad: Math.max(1, Math.round(nz(item.cantidad, 1))),
    });
  });

  /* --- Anidar cada grupo compartido --- */
  const plan = new Map();
  for (const g of grupos.values()) {
    if (g.miembros.length < 2) continue;

    const piezas = g.miembros.map((m) => ({
      id: 'i' + m.indice,
      nombre: m.item.nombre || 'Pieza',
      w: m.bbox.w,
      h: m.bbox.h,
      cantidad: m.cantidad,
      shape: m.item.shape,
    }));

    let r;
    try {
      r = nest(piezas, g.chapa, nestOpts);
    } catch {
      continue; // ante cualquier problema, cada ítem se anida solo como antes
    }
    if (!r?.cantidadChapas) continue;

    // Si el motor no pudo colocar todo, no se comparte: cotizar por ítem da un
    // número conservador y verificable, y esto no es lugar para adivinar.
    if (r.noEntran?.length || r.piezasColocadas < r.piezasPedidas) continue;

    // Área consumida por ítem, leída del layout que efectivamente salió
    const areaPorItem = {};
    for (const ch of r.chapas) {
      for (const p of ch.piezas) {
        areaPorItem[p.id] = (areaPorItem[p.id] || 0) + (p.areaReal ?? p.w * p.h);
      }
    }
    const areaGrupo = Object.values(areaPorItem).reduce((a, b) => a + b, 0);
    if (!(areaGrupo > 0)) continue;

    for (const m of g.miembros) {
      const id = 'i' + m.indice;
      const areaItem = areaPorItem[id] || 0;
      const fraccion = areaItem / areaGrupo;
      plan.set(m.indice, {
        compartido: true,
        clave: g.clave,
        idEnLayout: id,
        chapa: g.chapa,
        // Su parte de las chapas del grupo. Las fracciones de todos los ítems
        // suman exactamente la cantidad de chapas del grupo.
        chapas: r.cantidadChapas * fraccion,
        chapasGrupo: r.cantidadChapas,
        fraccion,
        fraccionSetup: fraccion,
        areaConsumida: areaItem,
        aprovechamiento: r.aprovechamientoGlobal,
        aprovechamientoUltima: r.aprovechamientoUltima,
        metodo: r.metodo,
        layout: r.chapas,
        itemsEnGrupo: g.miembros.length,
        piezasEnGrupo: r.piezasColocadas,
        nombresEnGrupo: g.miembros.map((x) => x.item.nombre || 'Pieza'),
      });
    }
  }
  return plan;
}

/**
 * Cotiza UN ítem (una pieza × cantidad).
 *
 * @param {Object} item
 *   shape, materialId, espesor, cantidad, gas,
 *   plegado {pliegues, largoPliegue, angulo, matrizV, herramentales},
 *   acabadoId, procesos[], ingenieriaHoras, margen, urgencia, descuento
 * @param {Object} ctx { materiales, maquinas, config }
 * @param {Object} [planItem] parte del grupo cuando comparte chapa con otros
 *   ítems (ver `planificarNesting`). Sin esto el ítem se anida solo, que es
 *   el comportamiento de siempre y el que usa cualquier llamada directa.
 */
export function cotizarItem(item, ctx, planItem = null) {
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
  const compartido = planItem?.compartido ? planItem : null;
  const chapa = compartido?.chapa || chapaDe(item, material, laser);
  const nestOpts = {
    separacion: prod.separacionPiezas,
    margen: prod.margenChapa,
    formaReal: prod.nestingFormaReal !== false,
  };
  const cabe = entraEnChapa(bbox, chapa, prod.margenChapa);

  // Cuando el ítem comparte chapa con otros, el anidado ya lo hizo
  // `planificarNesting` con todo el grupo junto: volver a anidarlo solo daría
  // un número distinto del que se va a cortar.
  let nesting = null;
  if (!compartido && cabe) {
    nesting = nest(
      [{ id: 'p', nombre: item.nombre || 'Pieza', w: bbox.w, h: bbox.h, cantidad, shape }],
      chapa,
      nestOpts
    );
  }
  const chapas = compartido ? compartido.chapas : nesting ? nesting.cantidadChapas : Math.ceil(cantidad);
  const aprovechamiento = compartido ? compartido.aprovechamiento : nesting ? nesting.aprovechamientoGlobal : 0;

  /* --- Costo de material ----------------------------------------------- */
  const areaChapa = chapa.w * chapa.h;
  const pesoChapa = pesoKg(areaChapa, t, material.densidad);
  const costoChapa = pesoChapa * nz(material.precioKg);

  const costoPorChapasEnteras = chapas * costoChapa;
  // El área realmente consumida sale del nesting cuando está disponible:
  // con nesting de forma real, dos piezas que encastran consumen menos.
  const areaConsumida = compartido
    ? compartido.areaConsumida
    : nesting?.areaConsumidaTotal ?? areaBBox * cantidad;
  const costoProrrateado =
    (areaConsumida / (areaChapa * Math.max(0.3, com.aprovechamientoObjetivo))) *
    costoChapa *
    (1 + nz(com.scrapMinimo) / 100);

  /* --- ¿Quién pone la chapa? -------------------------------------------
   *
   * Con material del cliente NO se cobra el material, pero el trabajo no vale
   * lo mismo que cortando material propio, y por dos razones concretas:
   *
   * 1. Se pierde el margen del material, que en chapa fina es el grueso del
   *    trabajo. Cobrar la misma hora deja el trabajo casi sin ganancia.
   * 2. El riesgo cambia de manos. Si la chapa viene alabeada, con óxido o con
   *    un espesor que no es el que dice, el corte sale mal — y la repone el
   *    taller, que no la compró ni la eligió.
   *
   * Por eso hay un recargo sobre el tiempo de máquina. Es un porcentaje
   * configurable y explícito, no un número escondido: el cliente que trae la
   * chapa lo pregunta siempre.
   *
   * Tampoco se anida con otros trabajos: la chapa es de él y vuelve con su
   * recorte. Eso ya lo resuelve `item.chapa`, que pisa la chapa estándar. */
  const materialDelCliente = item.materialCliente === true;

  let costoMaterial;
  let modoMaterialUsado;
  if (materialDelCliente) {
    costoMaterial = 0;
    modoMaterialUsado = 'Lo pone el cliente';
  } else if (com.modoMaterial === 'nesting') {
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
  // El setup es UNO por programa. Si el ítem comparte chapa, le toca su parte
  // según el área que ocupa; si va solo, lo paga entero.
  const factorSetup = compartido ? compartido.fraccionSetup : item.incluirSetup !== false;
  const corteBruto = tiempoCorteLote(shape, material, t, laser, cantidad, chapas, factorSetup, gas);
  if (corteBruto.error) return { error: corteBruto.error, nombre: item.nombre };

  /* Calibración contra lo que el taller tardó de verdad.
   *
   * `ctx.calibracion` es opcional: sin ella el factor es 1 y el cálculo queda
   * exactamente como estaba. Sólo aparece cuando hay suficientes órdenes
   * medidas — corregir con tres mediciones sería darle confianza falsa a un
   * número que sigue siendo una estimación.
   *
   * El factor escala TODOS los componentes del tiempo, no sólo el corte: el
   * taller mide el trabajo entero (desde que empieza a preparar hasta que
   * termina), así que el ratio se sacó sobre el total y aplicarlo sólo a una
   * parte corregiría de menos. Escalar todo mantiene además la suma cerrada:
   * producción + carga + setup sigue dando el total. */
  const cal = ctx.calibracion ? factorPara(ctx.calibracion, material.id, t) : null;
  const fCal = cal && isFinite(cal.factor) && cal.factor > 0 ? cal.factor : 1;
  const corte =
    fCal === 1
      ? { ...corteBruto, calibracion: cal }
      : {
          ...corteBruto,
          tPieza: corteBruto.tPieza * fCal,
          tProduccion: corteBruto.tProduccion * fCal,
          tChapas: corteBruto.tChapas * fCal,
          tSetup: corteBruto.tSetup * fCal,
          tTotal: corteBruto.tTotal * fCal,
          // El tiempo sin corregir se conserva para poder mostrar la diferencia
          tTotalModelo: corteBruto.tTotal,
          calibracion: cal,
        };

  const costoHoraLaser = calcularCostoHoraMaquina(laser, estructura);

  /* Producción y puesta a punto se separan porque son cosas distintas y el
     cliente pregunta. Cortar una placa de 200×150 en 1,2 mm son ~7 segundos;
     programar la máquina y cargar la chapa son 4 minutos y medio. Sumarlos en
     una línea llamada "corte láser" hacía que un trabajo de una pieza mostrara
     4m 42s de corte, que es un número que no existe: el 96 % de eso es
     preparación. La suma no cambia — cambia que ahora se puede explicar. */
  const tPreparacion = (corte.tSetup || 0) + (corte.tChapas || 0);
  const costoCorteBase = (corte.tProduccion / 3600) * costoHoraLaser.total;
  const costoPreparacionBase = (tPreparacion / 3600) * costoHoraLaser.total;

  /* Recargo por material del cliente: se aplica al tiempo de máquina, que es
     lo único que queda para cobrar cuando la chapa no la pone el taller. */
  const pctMaterialCliente = materialDelCliente ? nz(com.recargoMaterialCliente, 0) : 0;
  const factorMC = 1 + pctMaterialCliente / 100;
  const costoCorte = costoCorteBase * factorMC;
  const costoPreparacion = costoPreparacionBase * factorMC;
  const recargoMaterialCliente = costoCorte + costoPreparacion - costoCorteBase - costoPreparacionBase;
  const precioGas = nz(prod.gases?.[corte.gasTipo], GASES[corte.gasTipo]?.costoM3 ?? 800);
  const costoGas = corte.gasM3Total * precioGas;

  // Alternativas de gas: cuánto costaría el mismo corte con los otros gases.
  const alternativasGas = compararGases(material, t, laser.potenciaKW, prod.gases, {
    largoCorteMM: corte.longitudTotal || largoCorte * cantidad,
    piercings: corte.piercingsTotal || piercings * cantidad,
  });

  /* --- ¿Y si esto va a la guillotina? -----------------------------------
     El desarrollo de una pieza plegada es casi siempre un rectángulo pelado:
     un ángulo, una U, una bandeja. Cortar eso con el láser es pagar fuente,
     gas y perforaciones para hacer cuatro líneas rectas.

     Se compara SIEMPRE y se informa, pero sólo se aplica si el ítem lo pide
     (`corte: 'guillotina'`) o si está en automático. La decisión se muestra
     con los dos números al lado: una máquina que elige sola y no explica es
     una que nadie audita. */
  const guillotina = (ctx.maquinas || []).find((m) => m.tipo === 'guillotina') || DEFAULT_GUILLOTINA;
  const costoHoraGuillotina = calcularCostoHoraMaquina(guillotina, estructura);
  const alternativaGuillotina = compararConLaser(
    { shape, espesor: t, material, cantidad, chapa },
    {
      horaGuillotina: costoHoraGuillotina.total,
      tiempoLaser: corte.tTotal,
      costoLaser: costoCorteBase + costoPreparacionBase + costoGas,
    },
    guillotina
  );

  /* En automático la guillotina se usa para el DESARROLLO DE UNA PIEZA QUE SE
     PLIEGA, y no para cualquier rectángulo.

     La razón es el canto: la guillotina deja una rebaba y un leve arrastre que
     en un blanco plegado no se ve —queda adentro del perfil o lo tapa el
     pliegue— pero en una placa que se entrega tal cual, sí. Una chapa lisa
     cortada es un producto terminado y el cliente la mira; el desarrollo de un
     ángulo es una etapa intermedia.

     Quien quiera forzarlo tiene `corte: 'guillotina'` y `corte: 'laser'`. */
  const modoCorte = item.corte || 'auto';
  const esDesarrolloPlegado = Math.max(0, Math.round(nz((item.plegado || {}).pliegues, 0))) > 0;
  const usaGuillotina =
    modoCorte === 'guillotina'
      ? alternativaGuillotina.apta
      : modoCorte === 'auto' &&
        esDesarrolloPlegado &&
        alternativaGuillotina.apta &&
        alternativaGuillotina.ahorro > 0;

  /* Los tiempos y costos que EFECTIVAMENTE se cobran. Si va a la guillotina,
     el láser no se enciende: no hay gas, no hay perforaciones y la hora de
     máquina es otra. */
  const tGuillo = usaGuillotina
    ? tiempoGuillotina(alternativaGuillotina.ancho, alternativaGuillotina.alto, cantidad, chapa, guillotina)
    : null;
  const costoCorteEfectivo = usaGuillotina
    ? (tGuillo.tProduccion / 3600) * costoHoraGuillotina.total * factorMC
    : costoCorte;
  const costoPreparacionEfectivo = usaGuillotina
    ? (tGuillo.tSetup / 3600) * costoHoraGuillotina.total * factorMC
    : costoPreparacion;
  const costoGasEfectivo = usaGuillotina ? 0 : costoGas;
  const tPreparacionEfectivo = usaGuillotina ? tGuillo.tSetup : tPreparacion;

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
    costoMaterial + costoCorteEfectivo + costoPreparacionEfectivo + costoGasEfectivo + costoPlegado +
    costoAcabado + costoProcesos + costoIngenieria;
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
    nesting: compartido
      ? {
          // Fraccionario a propósito: es la parte que le toca de las chapas
          // del grupo. Las partes de todos los ítems suman `chapasGrupo`.
          chapas,
          compartido: true,
          grupo: compartido.clave,
          chapasGrupo: compartido.chapasGrupo,
          itemsEnGrupo: compartido.itemsEnGrupo,
          nombresEnGrupo: compartido.nombresEnGrupo,
          piezasEnGrupo: compartido.piezasEnGrupo,
          fraccion: compartido.fraccion,
          idEnLayout: compartido.idEnLayout,
          aprovechamiento,
          aprovechamientoUltima: compartido.aprovechamientoUltima,
          piezasPorChapa: compartido.layout[0]?.piezas.length || 0,
          metodo: compartido.metodo,
          chapa,
          layout: compartido.layout,
        }
      : nesting
        ? {
            chapas,
            compartido: false,
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
      materialDelCliente,
      recargoMaterialClientePct: pctMaterialCliente,
      recargoMaterialCliente,
      // Lo que habría costado el material si lo pusiera el taller. Sirve para
      // mostrarle al cliente cuánto se ahorra trayendo la chapa, que es
      // exactamente lo que pregunta.
      materialSiLoPusieraElTaller: materialDelCliente
        ? (aprovechamiento >= com.aprovechamientoObjetivo
            ? costoPorChapasEnteras
            : Math.min(costoProrrateado, costoPorChapasEnteras))
        : null,
      costoChapa,
      pesoChapa,
      // `corte` es SÓLO producción (cortar las piezas del lote). La puesta a
      // punto va aparte: sumarlas escondía que un trabajo de una pieza es casi
      // todo preparación.
      corte: costoCorteEfectivo,
      preparacion: costoPreparacionEfectivo,
      tPreparacion: tPreparacionEfectivo,
      /* Con qué máquina se corta y cuánto se ahorró por no usar el láser.
         Se informan las dos cosas: el número solo no permite discutir la
         decisión, y ésta es una decisión que a veces hay que revertir (una
         pieza a la vista quiere canto de láser, no rebaba de guillotina). */
      proceso: usaGuillotina ? 'guillotina' : 'laser',
      guillotina: alternativaGuillotina,
      golpesGuillotina: tGuillo?.golpes ?? 0,
      tirasGuillotina: tGuillo?.tiras ?? 0,
      // Qué parte del costo es preparación. Arriba de ~0,4 conviene avisarle a
      // quien cotiza que subiendo la cantidad el unitario se desploma.
      preparacionPct: costoTotal > 0 ? costoPreparacion / costoTotal : 0,
      costoHoraLaser: costoHoraLaser.total,
      desgloseHoraLaser: costoHoraLaser,
      gas: costoGasEfectivo,
      gasTipo: usaGuillotina ? null : corte.gasTipo,
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

  // Primero se decide qué va junto a la misma chapa: la máquina corta un
  // programa por chapa, no un ítem por chapa.
  const plan = planificarNesting(presupuesto.items, ctx2);

  const items = [];
  const errores = [];
  (presupuesto.items || []).forEach((it, i) => {
    const r = cotizarItem(it, ctx2, plan.get(i));
    if (r.error) errores.push(r);
    else items.push(r);
  });

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
  // Las chapas de un grupo compartido se cuentan UNA vez, no una por ítem.
  // Sumar las fracciones daría lo mismo salvo por el error de coma flotante,
  // y este número se usa para comprar material: tiene que ser entero y exacto.
  const gruposContados = new Set();
  let chapasTotal = 0;
  for (const i of items) {
    const n = i.nesting;
    if (!n || n.error) continue;
    if (!n.compartido) {
      chapasTotal += n.chapas;
    } else if (!gruposContados.has(n.grupo)) {
      gruposContados.add(n.grupo);
      chapasTotal += n.chapasGrupo;
    }
  }
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
