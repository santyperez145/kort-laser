/**
 * KORT - Costos de estructura y mano de obra
 * Valores de referencia: La Rioja, Argentina · agosto 2026
 *
 * ─────────────────────────────────────────────────────────────────────────
 * POR QUÉ EXISTE ESTE MÓDULO
 *
 * Antes el sistema pedía un "overhead por hora" inventado. Eso es el error
 * más caro de una metalúrgica chica: se cotiza con un número redondo que no
 * sale de ningún lado y a fin de mes la plata no está.
 *
 * Acá se cargan los gastos fijos REALES del mes y el sistema calcula el
 * costo por hora dividiéndolos por las horas que la máquina factura de
 * verdad. Si trabajás menos horas, el costo por hora sube solo. Que es
 * exactamente lo que pasa en la realidad.
 *
 * HALLAZGO IMPORTANTE — la potencia contratada:
 * EDELAR cobra en Tarifa 2 (>10 kW) un cargo por capacidad de suministro de
 * $9.296,43 por kW contratado POR MES, se use o no. Con 30 kW contratados
 * son $278.893 fijos todos los meses, más $15.106,90 de cargo fijo. Para un
 * taller que factura 160 horas al mes, eso solo ya son ~$1.840 por hora,
 * MÁS caro que la energía que efectivamente consume el láser.
 *
 * Por eso la potencia contratada se carga acá y no como "costo de energía"
 * de la máquina: es un gasto fijo, no variable.
 * ─────────────────────────────────────────────────────────────────────────
 */

/**
 * Cuadro tarifario EDELAR S.A. — Resolución EUCOP N° 001 Acta 028, 14/04/2026.
 * Fuente: https://www.edelar.com.ar/files.php?f=cuadro-tarifario.pdf
 */
export const TARIFAS_EDELAR = {
  actualizado: '2026-04-14',
  fuente: 'EDELAR S.A. - Res. EUCOP N° 001 Acta 028',
  categorias: [
    {
      id: 'T2-BT1',
      nombre: 'T2-BT1 · Baja tensión, entre 10 y 50 kW',
      recomendadaPara: 'Taller con láser de 3 kW (lo habitual)',
      cargoPotenciaKWMes: 9296.43,
      cargoFijoMes: 15106.9,
      energiaPico: 104.6719,
      energiaValle: 90.6769,
      energiaResto: 106.4609,
    },
    {
      id: 'T2-BT2',
      nombre: 'T2-BT2 · Baja tensión, entre 50 y 300 kW',
      recomendadaPara: 'Taller con varias máquinas grandes',
      cargoPotenciaKWMes: 9296.43,
      cargoFijoMes: 15106.9,
      energiaPico: 104.6719,
      energiaValle: 90.6769,
      energiaResto: 106.4609,
    },
    {
      id: 'T2-MT1',
      nombre: 'T2-MT1 · Media tensión, menor a 300 kW',
      recomendadaPara: 'Planta con subestación propia',
      cargoPotenciaKWMes: 8705.56,
      cargoFijoMes: 106156.41,
      energiaPico: 98.6745,
      energiaValle: 85.4805,
      energiaResto: 100.361,
    },
    {
      id: 'T1-G',
      nombre: 'T1 · Uso general, menos de 10 kW',
      recomendadaPara: 'Sin cargo por potencia, pero no alcanza para un láser',
      cargoPotenciaKWMes: 0,
      cargoFijoMes: 0,
      energiaPico: 160.9301,
      energiaValle: 160.9301,
      energiaResto: 160.9301,
    },
  ],
};

/**
 * Escala salarial UOM, Rama 17 (metalmecánica), vigente desde abril 2026
 * (la paritaria quedó congelada por la intervención del gremio).
 * Valores de BÁSICO POR HORA. El costo para la empresa es bastante más alto:
 * ver `costoHoraOperario`.
 */
export const UOM_RAMA17 = {
  actualizado: '2026-04-01',
  fuente: 'UOM Rama 17 - paritaria abril 2026',
  categorias: [
    { id: 'ingresante', nombre: 'Ingresante', basicoHora: 4313.43 },
    { id: 'operario', nombre: 'Operario calificado', basicoHora: 4672.74 },
    { id: 'medio-oficial', nombre: 'Medio oficial', basicoHora: 5036.08 },
    { id: 'especializado', nombre: 'Operario especializado', basicoHora: 5387.45 },
    { id: 'oficial', nombre: 'Oficial múltiple', basicoHora: 6418.6 },
    { id: 'operador-cnc', nombre: 'Oficial múltiple superior / Operador CNC', basicoHora: 6868.42 },
  ],
};

/**
 * Cargas y factores que convierten el básico de convenio en costo real.
 * Son los que usa cualquier estudio contable en Argentina.
 */
export const CARGAS_LABORALES = {
  adicionalesConvenio: 10, // % · presentismo, antigüedad, adicional por título
  contribucionesPatronales: 26.4, // % · jubilación, PAMI, asig. familiares, FNE, obra social
  art: 7, // % · alícuota típica de metalúrgica (actividad de riesgo medio-alto)
  seguroVida: 0.5, // %
  sac: 8.33, // % · aguinaldo (1/12)
  // Horas pagadas que no se trabajan: vacaciones, feriados, ausentismo,
  // licencias. Sobre ~2.080 h/año pagadas se trabajan ~1.790.
  factorHorasNoTrabajadas: 14, // %
};

/**
 * Costo real por hora TRABAJADA de un operario.
 * Es lo que sale la hora de esa persona, no lo que dice el recibo.
 */
export function costoHoraOperario(basicoHora, cargas = CARGAS_LABORALES) {
  const conAdicionales = basicoHora * (1 + cargas.adicionalesConvenio / 100);
  const conCargas =
    conAdicionales * (1 + (cargas.contribucionesPatronales + cargas.art + cargas.seguroVida) / 100);
  const conSac = conCargas * (1 + cargas.sac / 100);
  const porHoraTrabajada = conSac / (1 - cargas.factorHorasNoTrabajadas / 100);
  return {
    basico: basicoHora,
    conAdicionales,
    cargasSociales: conCargas - conAdicionales,
    sac: conSac - conCargas,
    ajusteHorasNoTrabajadas: porHoraTrabajada - conSac,
    total: porHoraTrabajada,
    multiplicador: porHoraTrabajada / basicoHora,
  };
}

/**
 * Configuración de estructura por defecto: un taller de La Rioja con un
 * láser de 3 kW, una plegadora y dos personas.
 *
 * Todos estos números hay que reemplazarlos por los tuyos. Están puestos
 * para que el sistema arranque con un orden de magnitud creíble, no para
 * que los uses tal cual.
 */
export const DEFAULT_ESTRUCTURA = {
  // ── Horas de trabajo ───────────────────────────────────────────────
  diasHabilesMes: 21,
  horasPorDia: 9,
  // Del total de horas abiertas, cuántas realmente hay una máquina
  // produciendo algo facturable. En un taller chico ronda el 55-70 %.
  ocupacionProductiva: 60, // %

  // ── Energía eléctrica (EDELAR) ────────────────────────────────────
  tarifa: 'T2-BT1',
  potenciaContratadaKW: 30,
  cargoPotenciaKWMes: 9296.43,
  cargoFijoElectricoMes: 15106.9,
  costoKWh: 106.4609, // banda "resto": 8 a 18 h, que es cuando trabaja el taller

  // ── Alquiler e inmueble ───────────────────────────────────────────
  alquilerMes: 850000,
  expensasServiciosMes: 120000, // agua, internet, teléfono, limpieza

  // ── Personal indirecto y servicios profesionales ──────────────────
  sueldosIndirectosMes: 0, // administrativo/a, encargado que no produce
  contadorMes: 180000,
  segurosMes: 145000, // incendio, responsabilidad civil, robo

  // ── Impuestos fijos ───────────────────────────────────────────────
  ingresosBrutosPct: 3.5, // % sobre facturación (La Rioja, industria)
  tasaMunicipalMes: 65000,
  otrosFijosMes: 90000, // papelería, software, herramientas de consumo, imprevistos

  // ── Financiero ────────────────────────────────────────────────────
  cuotaCreditoMes: 0, // si financiaste la máquina, la cuota va acá
};

/**
 * Calcula el costo de estructura por hora productiva, con desglose.
 */
export function calcularEstructura(e = DEFAULT_ESTRUCTURA) {
  const n = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);
  const horasAbiertas = n(e.diasHabilesMes) * n(e.horasPorDia);
  const horasProductivas = Math.max(1, (horasAbiertas * n(e.ocupacionProductiva)) / 100);

  const items = [
    { id: 'potencia', nombre: 'Potencia eléctrica contratada', valor: n(e.potenciaContratadaKW) * n(e.cargoPotenciaKWMes),
      detalle: `${n(e.potenciaContratadaKW)} kW × ${n(e.cargoPotenciaKWMes).toFixed(2)} $/kW-mes` },
    { id: 'cargoFijo', nombre: 'Cargo fijo de electricidad', valor: n(e.cargoFijoElectricoMes) },
    { id: 'alquiler', nombre: 'Alquiler del galpón', valor: n(e.alquilerMes) },
    { id: 'servicios', nombre: 'Servicios y expensas', valor: n(e.expensasServiciosMes) },
    { id: 'indirectos', nombre: 'Sueldos indirectos', valor: n(e.sueldosIndirectosMes) },
    { id: 'contador', nombre: 'Contador y honorarios', valor: n(e.contadorMes) },
    { id: 'seguros', nombre: 'Seguros', valor: n(e.segurosMes) },
    { id: 'municipal', nombre: 'Tasa municipal', valor: n(e.tasaMunicipalMes) },
    { id: 'otros', nombre: 'Otros gastos fijos', valor: n(e.otrosFijosMes) },
    { id: 'credito', nombre: 'Cuota de crédito', valor: n(e.cuotaCreditoMes) },
  ].filter((i) => i.valor > 0);

  const totalMes = items.reduce((a, i) => a + i.valor, 0);
  const porHora = totalMes / horasProductivas;

  return {
    horasAbiertas,
    horasProductivas,
    items: items.map((i) => ({ ...i, porHora: i.valor / horasProductivas, pct: (i.valor / totalMes) * 100 })),
    totalMes,
    porHora,
    // Punto de equilibrio: cuánto tenés que facturar por mes sólo para cubrir
    // la estructura, sin contar material ni mano de obra directa.
    facturacionMinimaMes: totalMes,
    ingresosBrutosPct: n(e.ingresosBrutosPct),
  };
}

/**
 * Costo horario completo de una máquina = amortización + energía variable +
 * mantenimiento + consumibles + operario + estructura.
 *
 * La diferencia con el modelo anterior: la energía ahora es SOLO la variable
 * (kWh consumidos mientras la máquina trabaja); el cargo por potencia
 * contratada vive en la estructura, que es donde corresponde.
 */
export function calcularCostoHoraMaquina(maquina, estructura) {
  const c = maquina.costo || {};
  const est = estructura || calcularEstructura();
  const n = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);

  const amortizacion = n(c.valorEquipo) / Math.max(1, n(c.vidaUtilHoras) || 1);
  const energia = n(c.consumoKW) * n(c.costoKWh);
  const operarioBase = n(c.operarioHora);
  const operario = operarioBase * (n(c.dedicacionOperario) || 100) / 100;

  const items = {
    amortizacion,
    energia,
    mantenimiento: n(c.mantenimientoHora),
    consumibles: n(c.consumiblesHora),
    operario,
    // La estructura se reparte entre las máquinas según cuánto de la
    // capacidad del taller ocupa cada una.
    estructura: est.porHora * ((n(maquina.participacionEstructura) || 50) / 100),
  };
  const total = Object.values(items).reduce((a, b) => a + b, 0);
  return { ...items, total, estructuraMes: est.totalMes, horasProductivas: est.horasProductivas };
}

/**
 * ¿Conviene comprar un generador de nitrógeno?
 *
 * Es la decisión de inversión más rentable de un taller que corta inoxidable,
 * y nadie la calcula. Con 40 m³/h a $1.400 el m³, tres horas de corte de inox
 * por día pagan una cuota importante.
 */
export function evaluarGeneradorN2({ consumoM3Mes, precioM3Actual, precioM3Generador = 320, inversion = 38000000, vidaAnios = 10 }) {
  const ahorroMes = consumoM3Mes * (precioM3Actual - precioM3Generador);
  const amortizacionMes = inversion / (vidaAnios * 12);
  const beneficioMes = ahorroMes - amortizacionMes;
  return {
    consumoM3Mes,
    ahorroMes,
    amortizacionMes,
    beneficioMes,
    mesesRepago: ahorroMes > 0 ? inversion / ahorroMes : Infinity,
    conviene: beneficioMes > 0,
  };
}

/**
 * Cuánto necesita facturar el taller por mes para no perder plata, dado el
 * margen bruto que deja cada trabajo.
 */
export function puntoEquilibrio(estructura, margenBrutoPct = 45) {
  const est = estructura || calcularEstructura();
  const margen = Math.max(1, margenBrutoPct) / 100;
  const facturacion = est.totalMes / (margen / (1 + margen));
  return {
    estructuraMes: est.totalMes,
    facturacionNecesaria: facturacion,
    porDiaHabil: facturacion / 21,
    horasNecesarias: est.horasProductivas,
  };
}
