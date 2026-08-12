/**
 * KORT - Base técnica de materiales
 * Calibrada para LÁSER DE FIBRA DE 3 kW · Precios de referencia La Rioja, agosto 2026
 *
 * ─────────────────────────────────────────────────────────────────────────
 * CAMBIO IMPORTANTE respecto de una tabla simple de velocidades:
 * cada material tiene un juego de datos POR GAS DE ASISTENCIA.
 *
 * No es un detalle. Cortar 3 mm de acero con O2 o con N2 cambia:
 *   · la velocidad         (con O2 el oxígeno aporta energía de combustión)
 *   · el canto             (O2 deja óxido, hay que desbarbar o granallar antes de pintar)
 *   · y sobre todo EL COSTO DEL GAS, que va de 1 m³/h con O2 a 40-90 m³/h con N2.
 *
 * Ese factor 40× en consumo es la razón por la que cortar inoxidable con
 * nitrógeno puede costar más que la hora de máquina, y por la que un
 * generador de N2 se paga solo si cortás inox seguido. El sistema ahora lo
 * modela de verdad en vez de esconderlo en un promedio.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Estructura por material:
 *   procesos: { O2 | N2 | AIRE: {
 *      speeds  : { espesor: mm/min }   velocidad de corte a 3 kW
 *      pierce  : { espesor: segundos } tiempo de perforación
 *      flow    : { espesor: m³/h }     caudal de gas
 *      presion : { espesor: bar }      presión en boquilla
 *      boquilla: { espesor: mm }       diámetro de boquilla
 *      maxEspesor, calidad, notas
 *   }}
 *
 * TODO es editable desde Materiales y queda guardado en la base. Los valores
 * son de referencia de fabricante para 3 kW: calibralos con tus tiempos reales.
 */

/** Potencia de la fuente para la que están tabulados estos datos. */
export const POTENCIA_REFERENCIA_KW = 3;

/**
 * Precio de los gases de asistencia.
 * ⚠ Es el número más incierto de todo el sistema y el que más cambia el
 * resultado en inoxidable y aluminio. Pedile la cotización a tu proveedor y
 * cargala acá: la diferencia entre termo criogénico y cilindros es de 3 a 5×.
 */
export const GASES = {
  O2: {
    nombre: 'Oxígeno',
    costoM3: 4500, // termo / cilindros, La Rioja
    unidad: '$/m³',
    notas: 'Consumo bajísimo (1-3 m³/h) porque se corta a baja presión. Deja canto oxidado.',
  },
  N2: {
    nombre: 'Nitrógeno',
    costoM3: 1400, // termo criogénico (dewar). Con tanque a granel baja a ~$500
    unidad: '$/m³',
    notas: 'Canto limpio listo para pintar o soldar, pero consume 25-95 m³/h a 12-20 bar. Es el costo oculto del inoxidable.',
  },
  AIRE: {
    nombre: 'Aire comprimido',
    costoM3: 110, // compresor propio: electricidad + secador + filtros + mantenimiento
    unidad: '$/m³',
    notas: 'Casi gratis si tenés compresor con secador y filtros. Canto apenas oxidado, aceptable en muchos trabajos.',
  },
};

/* ------------------------------------------------------------------ */
/* Materiales                                                          */
/* ------------------------------------------------------------------ */

export const DEFAULT_MATERIALS = [
  {
    id: 'acero-sae1010',
    nombre: 'Acero SAE 1010 (laminado en frío)',
    familia: 'Acero al carbono',
    densidad: 7.85,
    Rm: 370,
    kFactor: 0.42,
    // Referencia: chapa 1,22×2,44 laminada en frío ≈ $86.400 sin IVA (29,8 kg
    // en 1,25 mm) en distribuidoras del Litoral, agosto 2026, más 10-20 % de
    // flete al interior. Ver docs/PRECIOS.md.
    precioKg: 2950,
    chapaStd: { w: 2440, h: 1220 }, // la medida que realmente se consigue
    medidasDisponibles: [
      { w: 2440, h: 1220, nombre: '1,22 × 2,44 m (la más común)' },
      { w: 3000, h: 1500, nombre: '1,50 × 3,00 m' },
      { w: 2000, h: 1000, nombre: '1,00 × 2,00 m' },
    ],
    espesores: [0.9, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 15, 20],
    gasPorDefecto: { hasta: 3, fino: 'AIRE', grueso: 'O2' },
    procesos: {
      O2: {
        calidad: 'Canto oxidado (requiere desbarbado si se va a pintar)',
        maxEspesor: 20,
        speeds: { 1: 8000, 1.5: 7000, 2: 6000, 2.5: 5000, 3: 4200, 4: 3400, 5: 2900, 6: 2600, 8: 1900, 10: 1500, 12: 1150, 15: 800, 20: 550 },
        pierce: { 1: 0.25, 1.5: 0.3, 2: 0.35, 2.5: 0.45, 3: 0.5, 4: 0.7, 5: 0.9, 6: 1.2, 8: 1.8, 10: 2.6, 12: 3.8, 15: 6, 20: 10 },
        flow: { 1: 0.6, 3: 1.0, 6: 1.3, 10: 1.9, 15: 2.6, 20: 3.4 },
        presion: { 1: 0.7, 3: 0.8, 6: 0.6, 10: 0.5, 15: 0.4, 20: 0.4 },
        boquilla: { 1: 1.0, 3: 1.2, 6: 1.5, 10: 2.0, 15: 2.5, 20: 3.0 },
      },
      N2: {
        calidad: 'Canto limpio, listo para pintar o soldar',
        maxEspesor: 6,
        speeds: { 1: 22000, 1.5: 15000, 2: 11000, 2.5: 7500, 3: 5500, 4: 2800, 5: 1500, 6: 900 },
        pierce: { 1: 0.3, 1.5: 0.4, 2: 0.5, 2.5: 0.7, 3: 0.9, 4: 1.5, 5: 2.6, 6: 4.2 },
        flow: { 1: 22, 2: 26, 3: 40, 4: 43, 5: 62, 6: 62 },
        presion: { 1: 12, 2: 14, 3: 15, 4: 16, 5: 18, 6: 18 },
        boquilla: { 1: 1.5, 2: 1.5, 3: 2.0, 4: 2.0, 5: 2.5, 6: 2.5 },
        notas: 'Arriba de 4 mm el nitrógeno en acero al carbono se vuelve antieconómico: conviene O2.',
      },
      AIRE: {
        calidad: 'Canto levemente oxidado, aceptable para la mayoría de los trabajos',
        maxEspesor: 6,
        speeds: { 1: 18000, 1.5: 12000, 2: 8500, 2.5: 6000, 3: 4200, 4: 2200, 5: 1200, 6: 700 },
        pierce: { 1: 0.3, 1.5: 0.4, 2: 0.55, 2.5: 0.75, 3: 1.0, 4: 1.7, 5: 3.0, 6: 4.8 },
        flow: { 1: 20, 2: 24, 3: 34, 4: 38, 5: 50, 6: 50 },
        presion: { 1: 10, 2: 12, 3: 13, 4: 14, 5: 15, 6: 15 },
        boquilla: { 1: 1.5, 2: 1.5, 3: 2.0, 4: 2.0, 5: 2.5, 6: 2.5 },
        notas: 'La opción más rentable en chapa fina si tenés buen secador y filtros.',
      },
    },
    notas: 'Uso general: soportes, bases, estructuras, gabinetes. Requiere pintura o galvanizado.',
    activo: true,
  },

  {
    id: 'acero-f24',
    nombre: 'Acero F-24 / A36 (laminado en caliente)',
    familia: 'Acero al carbono',
    densidad: 7.85,
    Rm: 450,
    kFactor: 0.42,
    precioKg: 2450, // el laminado en caliente es ~15 % más barato por kg
    chapaStd: { w: 6000, h: 1500 },
    medidasDisponibles: [
      { w: 6000, h: 1500, nombre: '1,50 × 6,00 m' },
      { w: 3000, h: 1500, nombre: '1,50 × 3,00 m' },
    ],
    espesores: [3, 4, 5, 6, 8, 10, 12, 16, 20],
    gasPorDefecto: { hasta: 0, fino: 'O2', grueso: 'O2' },
    procesos: {
      O2: {
        calidad: 'Canto oxidado. La cascarilla de laminación puede dar cortes irregulares.',
        maxEspesor: 20,
        speeds: { 3: 4000, 4: 3200, 5: 2750, 6: 2450, 8: 1800, 10: 1400, 12: 1080, 16: 730, 20: 520 },
        pierce: { 3: 0.6, 4: 0.8, 5: 1.0, 6: 1.3, 8: 2.0, 10: 2.9, 12: 4.2, 16: 7, 20: 11 },
        flow: { 3: 1.0, 6: 1.3, 10: 1.9, 16: 2.8, 20: 3.4 },
        presion: { 3: 0.8, 6: 0.6, 10: 0.5, 16: 0.4, 20: 0.4 },
        boquilla: { 3: 1.2, 6: 1.5, 10: 2.0, 16: 2.5, 20: 3.0 },
      },
    },
    notas: 'Estructural. Para piezas gruesas y bases. En 20 mm el 3 kW ya trabaja al límite: velocidad baja y canto áspero.',
    activo: true,
  },

  {
    id: 'inox-304',
    nombre: 'Acero inoxidable AISI 304',
    familia: 'Inoxidable',
    densidad: 8.0,
    Rm: 620,
    kFactor: 0.44,
    // Referencia: chapa 430 fina en lista minorista con IVA ≈ $7.400-7.900/kg
    // (acerosinoxidables.com.ar, ago-2026). El 304 va ~40 % arriba del 430.
    // Este valor es SIN IVA para chapa de 1,5-3 mm.
    precioKg: 8900,
    chapaStd: { w: 3000, h: 1500 },
    medidasDisponibles: [
      { w: 3000, h: 1500, nombre: '1,50 × 3,00 m' },
      { w: 2500, h: 1250, nombre: '1,25 × 2,50 m' },
      { w: 2000, h: 1000, nombre: '1,00 × 2,00 m' },
    ],
    espesores: [0.8, 1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12],
    gasPorDefecto: { hasta: 99, fino: 'N2', grueso: 'N2' },
    procesos: {
      N2: {
        calidad: 'Canto blanco, sin óxido. Es lo que se espera en inoxidable.',
        maxEspesor: 12,
        speeds: { 0.8: 24000, 1: 20000, 1.2: 16000, 1.5: 13000, 2: 9000, 2.5: 6500, 3: 5000, 4: 3000, 5: 2000, 6: 1400, 8: 800, 10: 500, 12: 330 },
        pierce: { 0.8: 0.2, 1: 0.25, 1.2: 0.3, 1.5: 0.4, 2: 0.5, 2.5: 0.65, 3: 0.8, 4: 1.2, 5: 1.8, 6: 2.5, 8: 4.2, 10: 7, 12: 11 },
        flow: { 1: 22, 2: 26, 3: 40, 4: 43, 5: 62, 6: 62, 8: 90, 10: 95, 12: 100 },
        presion: { 1: 12, 2: 14, 3: 15, 4: 16, 5: 18, 6: 18, 8: 20, 10: 20, 12: 20 },
        boquilla: { 1: 1.5, 2: 1.5, 3: 2.0, 4: 2.0, 5: 2.5, 6: 2.5, 8: 3.0, 10: 3.0, 12: 3.5 },
        notas: 'Acá está el costo escondido: 3 mm consume 40 m³/h y 8 mm llega a 90 m³/h.',
      },
      AIRE: {
        calidad: 'Canto levemente amarillento. Sirve en piezas que no se ven o que se pulen después.',
        maxEspesor: 6,
        speeds: { 1: 16000, 1.5: 10000, 2: 7000, 2.5: 5000, 3: 3800, 4: 2200, 5: 1400, 6: 950 },
        pierce: { 1: 0.3, 1.5: 0.5, 2: 0.6, 2.5: 0.8, 3: 1.0, 4: 1.6, 5: 2.4, 6: 3.3 },
        flow: { 1: 20, 2: 24, 3: 34, 4: 38, 5: 50, 6: 50 },
        presion: { 1: 10, 2: 12, 3: 13, 4: 14, 5: 15, 6: 15 },
        boquilla: { 1: 1.5, 2: 1.5, 3: 2.0, 4: 2.0, 5: 2.5, 6: 2.5 },
        notas: 'Cortar inox con aire baja el costo de gas ~12×. Ofrecelo cuando el canto no importa.',
      },
    },
    notas: 'Cocina industrial, alimenticia, cartelería. Cuidá la película protectora: si se quema, hay que pulir.',
    activo: true,
  },

  {
    id: 'inox-430',
    nombre: 'Acero inoxidable AISI 430',
    familia: 'Inoxidable',
    densidad: 7.7,
    Rm: 520,
    kFactor: 0.44,
    precioKg: 6400,
    chapaStd: { w: 3000, h: 1500 },
    medidasDisponibles: [
      { w: 3000, h: 1500, nombre: '1,50 × 3,00 m' },
      { w: 2500, h: 1250, nombre: '1,25 × 2,50 m' },
      { w: 2000, h: 1000, nombre: '1,00 × 2,00 m' },
    ],
    espesores: [0.4, 0.5, 0.6, 0.8, 1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6],
    gasPorDefecto: { hasta: 99, fino: 'N2', grueso: 'N2' },
    procesos: {
      N2: {
        calidad: 'Canto blanco',
        maxEspesor: 6,
        speeds: { 0.4: 32000, 0.5: 30000, 0.6: 28000, 0.8: 25000, 1: 21000, 1.2: 17000, 1.5: 14000, 2: 9500, 2.5: 7000, 3: 5300, 4: 3200, 5: 2100, 6: 1500 },
        pierce: { 0.5: 0.15, 1: 0.25, 1.5: 0.4, 2: 0.5, 3: 0.8, 4: 1.2, 5: 1.8, 6: 2.5 },
        flow: { 1: 22, 2: 26, 3: 40, 4: 43, 5: 62, 6: 62 },
        presion: { 1: 12, 2: 14, 3: 15, 4: 16, 5: 18, 6: 18 },
        boquilla: { 1: 1.5, 2: 1.5, 3: 2.0, 4: 2.0, 5: 2.5, 6: 2.5 },
      },
      AIRE: {
        calidad: 'Canto levemente amarillento',
        maxEspesor: 4,
        speeds: { 0.5: 24000, 1: 17000, 1.5: 11000, 2: 7400, 3: 4000, 4: 2300 },
        pierce: { 0.5: 0.2, 1: 0.3, 1.5: 0.5, 2: 0.6, 3: 1.0, 4: 1.6 },
        flow: { 1: 20, 2: 24, 3: 34, 4: 38 },
        presion: { 1: 10, 2: 12, 3: 13, 4: 14 },
        boquilla: { 1: 1.5, 2: 1.5, 3: 2.0, 4: 2.0 },
      },
    },
    notas: 'Magnético y bastante más barato que el 304. Decoración, interiores, frentes. No apto para intemperie.',
    activo: true,
  },

  {
    id: 'galvanizado',
    nombre: 'Chapa galvanizada',
    familia: 'Acero al carbono',
    densidad: 7.85,
    Rm: 340,
    kFactor: 0.42,
    precioKg: 3400,
    chapaStd: { w: 2440, h: 1220 },
    medidasDisponibles: [
      { w: 2440, h: 1220, nombre: '1,22 × 2,44 m' },
      { w: 3000, h: 1500, nombre: '1,50 × 3,00 m' },
    ],
    espesores: [0.7, 0.9, 1.2, 1.5, 2, 2.5, 3, 4],
    gasPorDefecto: { hasta: 99, fino: 'AIRE', grueso: 'AIRE' },
    procesos: {
      N2: {
        calidad: 'Canto limpio, el zinc del borde se pierde igual',
        maxEspesor: 4,
        speeds: { 0.7: 24000, 0.9: 20000, 1.2: 14000, 1.5: 11000, 2: 8000, 2.5: 6000, 3: 4600, 4: 2500 },
        pierce: { 0.7: 0.25, 1: 0.3, 1.5: 0.4, 2: 0.5, 3: 0.9, 4: 1.5 },
        flow: { 1: 22, 2: 26, 3: 40, 4: 43 },
        presion: { 1: 12, 2: 14, 3: 15, 4: 16 },
        boquilla: { 1: 1.5, 2: 1.5, 3: 2.0, 4: 2.0 },
      },
      AIRE: {
        calidad: 'Canto aceptable. Lo habitual en galvanizado.',
        maxEspesor: 4,
        speeds: { 0.7: 20000, 0.9: 17000, 1.2: 12000, 1.5: 9500, 2: 7000, 2.5: 5200, 3: 3900, 4: 2100 },
        pierce: { 0.7: 0.3, 1: 0.35, 1.5: 0.45, 2: 0.6, 3: 1.0, 4: 1.7 },
        flow: { 1: 20, 2: 24, 3: 34, 4: 38 },
        presion: { 1: 10, 2: 12, 3: 13, 4: 14 },
        boquilla: { 1: 1.5, 2: 1.5, 3: 2.0, 4: 2.0 },
      },
    },
    notas: 'El zinc emite humos: verificá la aspiración. No plegar con radio muy chico, descascara.',
    activo: true,
  },

  {
    id: 'alu-5052',
    nombre: 'Aluminio 5052',
    familia: 'Aluminio',
    densidad: 2.68,
    Rm: 230,
    kFactor: 0.4,
    precioKg: 9800, // ≈ USD 6,5/kg a $1.500
    chapaStd: { w: 3000, h: 1500 },
    medidasDisponibles: [
      { w: 3000, h: 1500, nombre: '1,50 × 3,00 m' },
      { w: 2500, h: 1250, nombre: '1,25 × 2,50 m' },
    ],
    espesores: [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10],
    gasPorDefecto: { hasta: 99, fino: 'N2', grueso: 'N2' },
    procesos: {
      N2: {
        calidad: 'Canto limpio con algo de rebaba en la cara inferior',
        maxEspesor: 10,
        speeds: { 1: 17000, 1.5: 11000, 2: 8000, 2.5: 6000, 3: 4500, 4: 2800, 5: 1900, 6: 1300, 8: 700, 10: 420 },
        pierce: { 1: 0.25, 1.5: 0.4, 2: 0.5, 2.5: 0.6, 3: 0.8, 4: 1.2, 5: 1.9, 6: 2.7, 8: 4.6, 10: 7.5 },
        flow: { 1: 22, 2: 26, 3: 40, 4: 43, 5: 62, 6: 62, 8: 90, 10: 95 },
        presion: { 1: 12, 2: 14, 3: 15, 4: 16, 5: 18, 6: 18, 8: 20, 10: 20 },
        boquilla: { 1: 1.5, 2: 1.5, 3: 2.0, 4: 2.0, 5: 2.5, 6: 2.5, 8: 3.0, 10: 3.0 },
      },
      AIRE: {
        calidad: 'Canto con más rebaba, hay que desbarbar',
        maxEspesor: 5,
        speeds: { 1: 13000, 1.5: 8500, 2: 6200, 3: 3400, 4: 2100, 5: 1400 },
        pierce: { 1: 0.3, 1.5: 0.5, 2: 0.6, 3: 1.0, 4: 1.6, 5: 2.5 },
        flow: { 1: 20, 2: 24, 3: 34, 4: 38, 5: 50 },
        presion: { 1: 10, 2: 12, 3: 13, 4: 14, 5: 15 },
        boquilla: { 1: 1.5, 2: 1.5, 3: 2.0, 4: 2.0, 5: 2.5 },
      },
    },
    notas: 'Muy buena plegabilidad. Alta reflectividad: no cortar sin protección de cabezal ni con la chapa floja.',
    activo: true,
  },

  {
    id: 'alu-6061',
    nombre: 'Aluminio 6061-T6',
    familia: 'Aluminio',
    densidad: 2.7,
    Rm: 310,
    kFactor: 0.4,
    precioKg: 10600,
    chapaStd: { w: 3000, h: 1500 },
    medidasDisponibles: [{ w: 3000, h: 1500, nombre: '1,50 × 3,00 m' }],
    // A 3 kW el aluminio se corta con calidad hasta 10 mm. El 12 mm existe en
    // el mercado pero esta máquina no lo hace: no se ofrece.
    espesores: [1.5, 2, 3, 4, 5, 6, 8, 10],
    gasPorDefecto: { hasta: 99, fino: 'N2', grueso: 'N2' },
    procesos: {
      N2: {
        calidad: 'Canto limpio',
        maxEspesor: 10,
        speeds: { 1.5: 10500, 2: 7600, 3: 4300, 4: 2650, 5: 1800, 6: 1240, 8: 660, 10: 400 },
        pierce: { 1.5: 0.45, 2: 0.55, 3: 0.9, 4: 1.3, 5: 2.0, 6: 2.9, 8: 4.9, 10: 8 },
        flow: { 1: 22, 2: 26, 3: 40, 4: 43, 5: 62, 6: 62, 8: 90, 10: 95 },
        presion: { 1: 12, 2: 14, 3: 15, 4: 16, 5: 18, 6: 18, 8: 20, 10: 20 },
        boquilla: { 1: 1.5, 2: 1.5, 3: 2.0, 4: 2.0, 5: 2.5, 6: 2.5, 8: 3.0, 10: 3.0 },
      },
    },
    notas: 'Estructural. Plegado delicado: puede fisurar, usá radio ≥ 2 × espesor y plegá transversal al laminado.',
    activo: true,
  },

  {
    id: 'laton',
    nombre: 'Latón',
    familia: 'Cobre y aleaciones',
    densidad: 8.5,
    Rm: 350,
    kFactor: 0.42,
    precioKg: 18500, // ≈ USD 12,3/kg
    chapaStd: { w: 2000, h: 1000 },
    medidasDisponibles: [{ w: 2000, h: 1000, nombre: '1,00 × 2,00 m' }],
    espesores: [0.8, 1, 1.5, 2, 3, 4],
    gasPorDefecto: { hasta: 99, fino: 'N2', grueso: 'N2' },
    procesos: {
      N2: {
        calidad: 'Canto limpio',
        maxEspesor: 4,
        speeds: { 0.8: 8500, 1: 7000, 1.5: 4600, 2: 3400, 3: 2000, 4: 1300 },
        pierce: { 0.8: 0.35, 1: 0.45, 1.5: 0.7, 2: 1.0, 3: 1.8, 4: 2.9 },
        flow: { 1: 22, 2: 26, 3: 40, 4: 43 },
        presion: { 1: 12, 2: 14, 3: 15, 4: 16 },
        boquilla: { 1: 1.5, 2: 1.5, 3: 2.0, 4: 2.0 },
      },
    },
    notas: 'Muy reflectivo. Cartelería y decoración. Confirmá que tu fuente tenga aislador de retorno antes de cortarlo.',
    activo: true,
  },

  {
    id: 'cobre',
    nombre: 'Cobre',
    familia: 'Cobre y aleaciones',
    densidad: 8.96,
    Rm: 250,
    kFactor: 0.42,
    precioKg: 22000,
    chapaStd: { w: 2000, h: 1000 },
    medidasDisponibles: [{ w: 2000, h: 1000, nombre: '1,00 × 2,00 m' }],
    espesores: [0.8, 1, 1.5, 2, 3],
    gasPorDefecto: { hasta: 99, fino: 'N2', grueso: 'N2' },
    procesos: {
      N2: {
        calidad: 'Canto limpio',
        maxEspesor: 3,
        speeds: { 0.8: 6000, 1: 5000, 1.5: 3300, 2: 2400, 3: 1300 },
        pierce: { 0.8: 0.45, 1: 0.6, 1.5: 0.9, 2: 1.3, 3: 2.4 },
        flow: { 1: 22, 2: 26, 3: 40 },
        presion: { 1: 12, 2: 14, 3: 15 },
        boquilla: { 1: 1.5, 2: 1.5, 3: 2.0 },
      },
    },
    notas: '⚠ El más reflectivo de todos. A 3 kW el límite práctico es 3 mm. Riesgo real de dañar la fuente si no está preparada.',
    activo: true,
  },
];

/* ------------------------------------------------------------------ */
/* Consultas sobre las tablas                                          */
/* ------------------------------------------------------------------ */

/**
 * Interpolación de una tabla { espesor: valor }.
 * La velocidad cae de forma aproximadamente exponencial con el espesor, así
 * que se interpola en escala logarítmica: mucho más fiel que lineal.
 */
export function interpTable(table, t, logScale = true) {
  if (!table) return null;
  const keys = Object.keys(table)
    .map(Number)
    .filter((k) => !Number.isNaN(k))
    .sort((a, b) => a - b);
  if (!keys.length) return null;
  if (t <= keys[0]) return table[keys[0]];
  if (t >= keys[keys.length - 1]) {
    const a = keys[keys.length - 2] ?? keys[0];
    const b = keys[keys.length - 1];
    if (a === b) return table[b];
    const va = table[a];
    const vb = table[b];
    if (logScale && va > 0 && vb > 0) {
      const k = Math.log(vb / va) / Math.log(b / a);
      return vb * (t / b) ** k;
    }
    return vb + ((t - b) * (vb - va)) / (b - a);
  }
  let i = 0;
  while (keys[i + 1] < t) i++;
  const a = keys[i];
  const b = keys[i + 1];
  const va = table[a];
  const vb = table[b];
  const f = (t - a) / (b - a);
  if (logScale && va > 0 && vb > 0) return Math.exp(Math.log(va) + f * (Math.log(vb) - Math.log(va)));
  return va + f * (vb - va);
}

/** Gases en los que se puede cortar este material a este espesor. */
export function gasesDisponibles(material, espesor) {
  const out = [];
  for (const [id, p] of Object.entries(material.procesos || {})) {
    if (espesor <= (p.maxEspesor ?? 99)) out.push({ id, ...p });
  }
  return out;
}

/** Gas recomendado por defecto para este material y espesor. */
export function gasRecomendado(material, espesor) {
  const g = material.gasPorDefecto || { hasta: 3, fino: 'AIRE', grueso: 'O2' };
  const elegido = espesor <= g.hasta ? g.fino : g.grueso;
  const proc = material.procesos?.[elegido];
  if (proc && espesor <= (proc.maxEspesor ?? 99)) return elegido;
  // Si el preferido no llega a ese espesor, se usa el que sí llegue
  const disp = gasesDisponibles(material, espesor);
  return disp[0]?.id || Object.keys(material.procesos || { O2: 1 })[0];
}

/** Devuelve el bloque de proceso (velocidades, gas, boquilla) para un gas. */
export function proceso(material, espesor, gas = null) {
  const id = gas || gasRecomendado(material, espesor);
  return { id, datos: material.procesos?.[id] || null };
}

/**
 * Velocidad de corte en mm/min.
 * Las tablas están medidas a 3 kW; si la máquina tiene otra potencia se
 * corrige con exponente 0,68 (la velocidad escala sublinealmente con la
 * potencia porque parte de la energía se pierde en conducción térmica).
 */
export function cuttingSpeed(material, espesor, potenciaKW, gas = null) {
  const { datos } = proceso(material, espesor, gas);
  if (!datos) return null;
  // Nunca extrapolar por encima del espesor máximo: la interpolación daría un
  // número positivo y el sistema aceptaría un trabajo que la máquina no puede
  // hacer. Vale más perder la venta que no poder entregarla.
  if (espesor > (datos.maxEspesor ?? Infinity) + 1e-9) return null;
  const base = interpTable(datos.speeds, espesor);
  if (base == null) return null;
  const p = potenciaKW || POTENCIA_REFERENCIA_KW;
  if (Math.abs(p - POTENCIA_REFERENCIA_KW) < 1e-6) return base;
  return base * (p / POTENCIA_REFERENCIA_KW) ** 0.68;
}

export function pierceTime(material, espesor, potenciaKW, gas = null) {
  const { datos } = proceso(material, espesor, gas);
  if (!datos) return 0.5;
  const base = interpTable(datos.pierce, espesor);
  if (base == null) return 0.5;
  const p = potenciaKW || POTENCIA_REFERENCIA_KW;
  return base * (POTENCIA_REFERENCIA_KW / p) ** 0.5;
}

/** Caudal de gas en m³/h. Es lo que decide el costo en inox y aluminio. */
export function gasFlow(material, espesor, gas = null) {
  const { datos } = proceso(material, espesor, gas);
  if (!datos) return 2;
  return interpTable(datos.flow, espesor, false) ?? 2;
}

export function presionGas(material, espesor, gas = null) {
  const { datos } = proceso(material, espesor, gas);
  return datos ? interpTable(datos.presion, espesor, false) ?? 1 : 1;
}

export function boquilla(material, espesor, gas = null) {
  const { datos } = proceso(material, espesor, gas);
  if (!datos) return 1.5;
  const tabla = datos.boquilla || {};
  const keys = Object.keys(tabla).map(Number).sort((a, b) => a - b);
  let v = tabla[keys[0]] ?? 1.5;
  for (const k of keys) if (espesor >= k) v = tabla[k];
  return v;
}

/** Espesor máximo cortable con este material (con cualquier gas). */
export function espesorMaximo(material) {
  return Math.max(...Object.values(material.procesos || {}).map((p) => p.maxEspesor ?? 0), 0);
}

/** Peso en kg de un área (mm²) a un espesor (mm). */
export function pesoKg(areaMM2, espesorMM, densidad) {
  return (areaMM2 * espesorMM * densidad) / 1e6;
}

export function findMaterial(list, id) {
  return list.find((m) => m.id === id) || list[0];
}

export function nearestEspesor(material, t) {
  const list = material.espesores || [];
  if (!list.length) return t;
  return list.reduce((best, e) => (Math.abs(e - t) < Math.abs(best - t) ? e : best), list[0]);
}

/**
 * Comparativa de gases para un material y espesor: cuánto tarda y cuánto
 * cuesta el gas con cada opción. Alimenta el selector del cotizador, que es
 * donde se ve que cortar inox con aire cuesta 12 veces menos.
 */
export function compararGases(material, espesor, potenciaKW, preciosGas, opciones = {}) {
  // Acepta un número suelto por compatibilidad con llamadas viejas
  const o = typeof opciones === 'number' ? { largoCorteMM: opciones } : opciones;
  const largoCorteMM = o.largoCorteMM ?? 1000;
  const piercings = o.piercings ?? 0;
  const eficiencia = o.eficiencia ?? 1;

  const out = [];
  for (const g of gasesDisponibles(material, espesor)) {
    const v = cuttingSpeed(material, espesor, potenciaKW, g.id);
    if (!v) continue;
    // El gas corre mientras el haz está encendido: corte + perforaciones.
    // Contarlo sólo por longitud subestimaría el consumo en piezas con muchos
    // agujeros, que son justamente las que más perforan.
    const segCorte = (largoCorteMM / v) * 60;
    const segPierce = piercings * pierceTime(material, espesor, potenciaKW, g.id);
    const flujo = gasFlow(material, espesor, g.id);
    const m3 = (flujo * (segCorte + segPierce)) / 3600 / eficiencia;
    out.push({
      gas: g.id,
      nombre: GASES[g.id]?.nombre || g.id,
      velocidad: v,
      caudal: flujo,
      presion: presionGas(material, espesor, g.id),
      boquilla: boquilla(material, espesor, g.id),
      segundos: segCorte + segPierce,
      m3,
      costoGas: m3 * (preciosGas?.[g.id] ?? GASES[g.id]?.costoM3 ?? 0),
      calidad: g.calidad,
      notas: g.notas,
    });
  }
  return out.sort((a, b) => a.costoGas - b.costoGas);
}
