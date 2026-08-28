/**
 * KORT · Modelo de corte: auditoría física de las tablas y corrección aprendida
 *
 * ══ Lo primero: qué NO hace, y por qué ═════════════════════════════════════
 *
 * Este módulo **no reemplaza la interpolación de la tabla**, y no es por
 * cautela: es porque se midió y la tabla gana.
 *
 * La primera versión ajustaba un modelo de dos parámetros derivado del balance
 * de energía y lo iba a poner en lugar de `cuttingSpeed`. Antes de hacerlo se
 * comparó con el mismo protocolo —sacar un punto, predecirlo con lo que
 * queda— sobre los 131 puntos de las tablas (2026-08-28):
 *
 *                              modelo    tabla
 *     interpolando (101 pts)    10,9 %    2,3 %
 *     extrapolando  (30 pts)    42,8 %    5,1 %
 *
 * La tabla gana en las 15 combinaciones material×gas, sin excepción. Tiene
 * sentido: una recta en log-log es demasiado rígida para curvas que tienen
 * curvatura real, y entre dos filas cargadas la interpolación usa información
 * local que un ajuste global promedia.
 *
 * Poner el modelo igual habría empeorado todos los precios del sistema. Queda
 * escrito porque el resultado es el valor: **un modelo entrenado que no se usa
 * para predecir puede ser correcto**, y descubrirlo pide medir en vez de
 * suponer.
 *
 * ══ Para qué SÍ sirve ══════════════════════════════════════════════════════
 *
 * Para las dos cosas que la tabla no puede hacer:
 *
 * **1. Auditar la tabla contra la física.** El ajuste recupera parámetros con
 * significado —cómo cae el acoplamiento con el espesor, y cuánta energía entra
 * realmente al material— y los contrasta con lo que admite el metal. Una tabla
 * mal cargada da precios mal en silencio; esto la delata. Los R² medidos van
 * de 0,943 a 0,993, lo que confirma que la forma funcional derivada de la
 * física es la correcta aunque no sea el mejor predictor punto a punto.
 *
 * **2. Aprender la corrección de ESTA máquina.** La tabla dice lo que hace una
 * fibra de 3 kW genérica. Este taller tiene una Max Photonics con un cabezal
 * Empower, chapa de un proveedor concreto y un operario concreto. Lo que se
 * aprende no es la velocidad —eso lo da la tabla— sino **cuánto se desvía la
 * realidad de la tabla**, que con cero mediciones vale exactamente 1 y no
 * cambia nada.
 *
 * ══ La física, que es lo que da la forma funcional ═════════════════════════
 *
 * Cortar es fundir y soplar. La potencia que entra funde el volumen que se
 * abre por unidad de tiempo:
 *
 *     η · P  =  v · t · w · ρ · h_f
 *
 *   η acoplamiento    P potencia    v velocidad    t espesor
 *   w sangría         ρ densidad    h_f energía específica de fusión
 *
 * Si η fuera constante la velocidad caería como 1/t. Cae más rápido, porque al
 * aumentar el espesor se pierde más calor por conducción. Con η = η₀·t^k:
 *
 *     ln v  =  c  +  m · ln t        con m = k − 1
 *
 * Los dos parámetros son auditables:
 *
 * - **m** tiene que estar entre −2,2 y −0,7. Medido va de −0,90 (acero con O₂)
 *   a −1,80 (acero con N₂), y esa diferencia es real: el oxígeno sostiene la
 *   velocidad en espesor gracias a la reacción.
 * - **η** tiene que caer en lo que admite la absortividad DEL METAL. El cobre
 *   refleja el 95 % de un haz de fibra, así que su η es legítimamente ~0,03; una
 *   banda única para todos los metales lo marcaría como error de carga.
 *
 * ══ Qué lo hace autoentrenable ═════════════════════════════════════════════
 *
 * El ajuste se guarda como **estadísticos suficientes** (n, Σx, Σx², Σy, Σxy,
 * Σy²) y no como una lista de puntos. Incorporar una medición es una suma:
 * O(1), sin reentrenar, y con el mismo resultado exacto que reajustar desde
 * cero. Restar un punto es sumarlo con peso −1, que es cómo la validación
 * cruzada saca una observación sin rehacer nada.
 *
 * Admite olvido exponencial, porque una máquina envejece: una lente sucia y
 * una boquilla gastada hacen que lo medido hace un año valga menos que lo de
 * ayer.
 */

/**
 * Energía específica para llevar el material de ambiente a fundido, en J/kg.
 * Calor sensible más calor latente de fusión, con valores estándar de
 * metalurgia. Se usa SÓLO para el chequeo de plausibilidad: la predicción no
 * depende de esto, porque la constante queda absorbida en el intercepto.
 */
export const ENERGIA_FUSION = {
  acero: 1.0e6,
  inoxidable: 1.05e6,
  galvanizado: 1.0e6,
  aluminio: 0.97e6,
  cobre: 0.61e6,
  laton: 0.55e6,
};

/** Potencia a la que están medidas las tablas. */
export const POTENCIA_TABLA_KW = 3;

/**
 * Absortividad a 1,07 µm: qué fracción del haz entra al metal en vez de
 * rebotar. Es la propiedad que más separa a estos materiales, y de lejos.
 *
 * ⚠️ **El cobre refleja alrededor del 95 % de un haz de fibra.** Por eso un
 * acoplamiento de 0,03 en cobre no es un error de tabla: es la razón física de
 * que el cobre sea difícil de cortar con láser de fibra y de que haya que
 * cuidar la reflexión de vuelta hacia la fuente. Lo mismo, en menor medida,
 * con el latón y el aluminio.
 *
 * Una banda de plausibilidad única para todos los metales marcaría como
 * sospechosos justamente a los que se comportan como corresponde. La primera
 * versión de este módulo lo hacía, y el propio modelo lo destapó: daba por
 * dudosos el cobre, el latón y los dos aluminios, que eran los cuatro casos
 * bien cargados.
 */
export const ABSORTIVIDAD = {
  acero: 0.35,
  inoxidable: 0.35,
  galvanizado: 0.35,
  aluminio: 0.10,
  laton: 0.08,
  cobre: 0.05,
};

/**
 * Qué fracción de lo absorbido termina fundiendo la sangría, en vez de irse
 * por conducción al material que rodea al corte. Entre 20 % y el total.
 */
export const FRACCION_UTIL = [0.2, 1.0];

/**
 * Con O₂ el techo se multiplica: la combustión del hierro aporta energía que
 * el haz no puso, así que el acoplamiento aparente —medido sólo contra la
 * potencia óptica— legítimamente lo supera. Es la razón de que el oxígeno
 * corte mucho más grueso a la misma potencia.
 */
export const REFUERZO_OXIDACION = 3;

/** Pendiente creíble en log-log. Fuera de acá la tabla dice algo que no pasa. */
export const BANDA_PENDIENTE = [-2.2, -0.7];

const ln = Math.log;
const esNum = (v) => typeof v === 'number' && isFinite(v);

function familiaDe(material) {
  const f = String(material?.familia || material?.id || '').toLowerCase();
  if (/inox/.test(f)) return 'inoxidable';
  if (/galv/.test(f)) return 'galvanizado';
  if (/alumin/.test(f)) return 'aluminio';
  if (/cobre/.test(f)) return 'cobre';
  if (/laton|latón/.test(f)) return 'laton';
  return 'acero';
}

/* ------------------------------------------------------------------ */
/* Estadísticos suficientes                                            */
/* ------------------------------------------------------------------ */

/**
 * Todo lo que hace falta para ajustar una recta y calcular incertidumbre,
 * en seis números. Que sean seis y no una lista de puntos es lo que hace que
 * incorporar una medición sea una suma en vez de un reentrenamiento.
 */
export function statsVacios() {
  return { n: 0, sx: 0, sxx: 0, sy: 0, sxy: 0, syy: 0 };
}

/**
 * ⚠️ El peso puede ser NEGATIVO, y es a propósito: restar un punto es cómo la
 * validación cruzada saca una observación en O(1) sin reentrenar. La primera
 * versión rechazaba los negativos y por eso `validar()` no sacaba nada — medía
 * error de ajuste y lo llamaba validación, que es exactamente el error que la
 * función existe para no cometer.
 */
export function sumar(stats, x, y, peso = 1) {
  if (!esNum(x) || !esNum(y) || !esNum(peso) || peso === 0) return stats;
  return {
    n: stats.n + peso,
    sx: stats.sx + peso * x,
    sxx: stats.sxx + peso * x * x,
    sy: stats.sy + peso * y,
    sxy: stats.sxy + peso * x * y,
    syy: stats.syy + peso * y * y,
  };
}

/** Olvido exponencial: lo viejo pesa menos. Una máquina envejece. */
export function envejecer(stats, factor) {
  if (!(factor > 0) || factor >= 1) return stats;
  return {
    n: stats.n * factor, sx: stats.sx * factor, sxx: stats.sxx * factor,
    sy: stats.sy * factor, sxy: stats.sxy * factor, syy: stats.syy * factor,
  };
}

/**
 * Resuelve la recta por mínimos cuadrados y su incertidumbre.
 *
 * Con menos de 3 puntos no se devuelve modelo: dos puntos definen una recta
 * exacta sin residuo, y presentarla con error cero sería afirmar una
 * precisión que no existe.
 */
export function ajustarRecta(stats) {
  const { n, sx, sxx, sy, sxy, syy } = stats;
  if (!(n >= 3)) return null;

  const xm = sx / n;
  const ym = sy / n;
  const sxxc = sxx - n * xm * xm; // Σ(x−x̄)²
  const sxyc = sxy - n * xm * ym;
  const syyc = syy - n * ym * ym;
  if (!(sxxc > 1e-12)) return null; // todos los puntos al mismo espesor

  const m = sxyc / sxxc;
  const c = ym - m * xm;

  // Residuo cuadrático y varianza del error, con n−2 grados de libertad.
  const sse = Math.max(0, syyc - m * sxyc);
  const s2 = n > 2 ? sse / (n - 2) : 0;
  const r2 = syyc > 1e-12 ? Math.max(0, 1 - sse / syyc) : null;

  return { m, c, n, xm, sxxc, s2, s: Math.sqrt(s2), r2 };
}

/* ------------------------------------------------------------------ */
/* Entrenamiento                                                       */
/* ------------------------------------------------------------------ */

/**
 * Entrena una combinación material×gas a partir de su tabla.
 *
 * Devuelve además el acoplamiento recuperado y si es plausible, que es lo que
 * convierte esto en un modelo auditable en vez de una curva.
 */
export function entrenarProceso(material, gas, datos, opts = {}) {
  const kerf = opts.kerfM ?? 0.0002; // 0,2 mm, orden de magnitud típico
  const potenciaW = (opts.potenciaKW ?? POTENCIA_TABLA_KW) * 1000;
  const maxEsp = esNum(datos?.maxEspesor) ? datos.maxEspesor : Infinity;

  let stats = statsVacios();
  const puntos = [];
  for (const [tStr, vStr] of Object.entries(datos?.speeds || {})) {
    const t = Number(tStr);
    const v = Number(vStr);
    // Un punto por encima del espesor máximo declarado no es un dato de corte:
    // es una fila que quedó en la tabla y arrastraría el ajuste.
    if (!(t > 0) || !(v > 0) || t > maxEsp + 1e-9) continue;
    puntos.push({ t, v });
    stats = sumar(stats, ln(t), ln(v));
  }

  const recta = ajustarRecta(stats);
  if (!recta) return null;

  /* Acoplamiento recuperado en el CENTROIDE del ajuste, no a 1 mm.
     Dos razones, y las dos importan:

     - Estadística: el centroide es donde la recta está mejor determinada.
       Evaluar en un extremo arrastra el error de la pendiente.
     - Física: en chapa fina el corte NO está limitado por potencia sino por
       la dinámica de la máquina —no se puede acelerar más rápido— así que el
       balance de energía da un acoplamiento artificialmente bajo. La primera
       versión evaluaba a 1 mm y por eso marcaba mal medio catálogo. */
  const tRef = Math.exp(recta.xm); // mm
  const vRef = Math.exp(recta.c + recta.m * recta.xm) / 60 / 1000; // m/s
  const rho = (material?.densidad || 7.85) * 1000; // g/cm³ → kg/m³
  const familia = familiaDe(material);
  const hf = ENERGIA_FUSION[familia] || ENERGIA_FUSION.acero;
  const eta = (vRef * (tRef / 1000) * kerf * rho * hf) / potenciaW;

  const modo = gas === 'O2' ? 'oxidacion' : 'fusion';
  const abs = ABSORTIVIDAD[familia] ?? ABSORTIVIDAD.acero;
  const etaMin = abs * FRACCION_UTIL[0];
  const etaMax = abs * FRACCION_UTIL[1] * (modo === 'oxidacion' ? REFUERZO_OXIDACION : 1);
  const pendienteOk = recta.m >= BANDA_PENDIENTE[0] && recta.m <= BANDA_PENDIENTE[1];
  const acopleOk = eta >= etaMin && eta <= etaMax;

  return {
    materialId: material.id,
    gas,
    modo,
    ...recta,
    stats,
    puntos: puntos.length,
    dominio: {
      min: Math.min(...puntos.map((p) => p.t)),
      max: Math.max(...puntos.map((p) => p.t)),
      maxEspesor: maxEsp,
    },
    fisica: {
      // k = m + 1: cómo cae el acoplamiento con el espesor.
      k: recta.m + 1,
      eta,
      plausible: pendienteOk && acopleOk,
      absortividad: abs,
      evaluadoEn: tRef,
      motivo: pendienteOk
        ? (acopleOk ? null : `acoplamiento ${eta.toFixed(3)} fuera de [${etaMin.toFixed(3)}, ${etaMax.toFixed(2)}], que es lo que admite un material con absortividad ${abs} cortado por ${modo}`)
        : `la velocidad cae como t^${recta.m.toFixed(2)}, que no corresponde a ningún proceso real`,
    },
  };
}

/** Entrena todo el catálogo. La clave es `materialId|gas`. */
export function entrenar(materiales = [], opts = {}) {
  const procesos = {};
  let puntos = 0;
  for (const m of materiales || []) {
    if (m?.activo === false) continue;
    for (const [gas, datos] of Object.entries(m.procesos || {})) {
      const p = entrenarProceso(m, gas, datos, opts);
      if (!p) continue;
      procesos[`${m.id}|${gas}`] = p;
      puntos += p.puntos;
    }
  }
  return {
    procesos,
    combinaciones: Object.keys(procesos).length,
    puntos,
    dudosos: Object.values(procesos).filter((p) => !p.fisica.plausible),
  };
}

/* ------------------------------------------------------------------ */
/* Corrección aprendida sobre la tabla                                 */
/* ------------------------------------------------------------------ */

/**
 * Lo que se aprende NO es la velocidad —eso lo da la tabla, y mejor— sino
 * cuánto se desvía esta máquina de la tabla:
 *
 *     ln(v_real / v_tabla)  =  a  +  b · ln t
 *
 * Con cero mediciones no hay recta y la corrección vale exactamente 1: el
 * sistema se comporta igual que hoy. Esa es la propiedad que lo hace seguro de
 * activar — no puede empeorar nada mientras no haya evidencia.
 *
 * El término en ln t existe porque la desviación no tiene por qué ser pareja:
 * una boquilla gastada afecta más al espesor grueso, y una chapa con más
 * cascarilla que la del catálogo afecta más al fino.
 */
export function correccionVacia() {
  return { procesos: {}, mediciones: 0 };
}

/**
 * Incorpora una medición real: se cortó tal material, de tal espesor, con tal
 * gas, y la máquina fue a tal velocidad.
 *
 * @param {number} peso  cuánto vale frente a otra medición. Se deja en 1: acá
 *   todas las observaciones son del mismo taller y la misma máquina, así que
 *   no hay razón para preferir una. (El peso existe para el olvido y para la
 *   validación cruzada, que resta con −1.)
 */
export function aprenderMedicion(correccion, { materialId, gas, espesor, velocidadReal, velocidadTabla, peso = 1 }) {
  if (!(espesor > 0) || !(velocidadReal > 0) || !(velocidadTabla > 0)) return correccion;
  const clave = `${materialId}|${gas}`;
  const previo = correccion?.procesos?.[clave] || statsVacios();
  const stats = sumar(previo, ln(espesor), ln(velocidadReal / velocidadTabla), peso);
  return {
    ...correccion,
    procesos: { ...(correccion?.procesos || {}), [clave]: stats },
    mediciones: (correccion?.mediciones || 0) + 1,
  };
}

/**
 * El factor por el que hay que multiplicar la velocidad de tabla.
 *
 * Con menos de 3 mediciones no se ajusta una recta —dos puntos la definen sin
 * residuo y daría certeza falsa— pero **sí se usa el promedio**, encogido
 * hacia 1 según cuánta evidencia hay. Así la primera medición ya aporta algo
 * sin que una sola dé vuelta el modelo.
 *
 * @returns {{ factor, n, ic, origen }} — `factor` es 1 exacto cuando no hay nada.
 */
export function factorCorreccion(correccion, materialId, gas, espesor, opts = {}) {
  const sinDatos = { factor: 1, n: 0, ic: null, origen: 'sin mediciones' };
  const stats = correccion?.procesos?.[`${materialId}|${gas}`];
  if (!stats || !(stats.n > 0) || !(espesor > 0)) return sinDatos;

  const x = ln(espesor);
  const recta = ajustarRecta(stats);

  if (!recta) {
    /* Pocas mediciones: promedio simple encogido hacia 1. El encogimiento usa
       el mismo criterio que `aprendizaje.js` — la evidencia manda cuánto se
       cree, y con una sola medición se cree poco. */
    const media = stats.sy / stats.n;
    const peso = stats.n / (stats.n + 3);
    return {
      factor: Math.exp(media * peso),
      n: stats.n,
      ic: null,
      origen: `${Math.round(stats.n)} medición${stats.n === 1 ? '' : 'es'}, promedio encogido`,
    };
  }

  const lnF = recta.c + recta.m * x;
  const se = recta.s * Math.sqrt(1 + 1 / recta.n + ((x - recta.xm) ** 2) / recta.sxxc);
  const z = opts.z ?? 1.96;
  return {
    factor: Math.exp(lnF),
    n: recta.n,
    ic: [Math.exp(lnF - z * se), Math.exp(lnF + z * se)],
    origen: `${Math.round(recta.n)} mediciones de este material y gas`,
  };
}

/**
 * Velocidad final: la de tabla corregida por lo que aprendió la máquina.
 *
 * @param {number} vTabla  lo que devuelve `cuttingSpeed`, que sigue siendo la
 *   fuente primaria porque se midió que es mejor predictor.
 */
export function velocidadCorregida(vTabla, correccion, materialId, gas, espesor, opts = {}) {
  if (!(vTabla > 0)) return null;
  const f = factorCorreccion(correccion, materialId, gas, espesor, opts);
  return {
    v: vTabla * f.factor,
    vTabla,
    factor: f.factor,
    n: f.n,
    origen: f.origen,
    ic: f.ic ? [vTabla * f.ic[0], vTabla * f.ic[1]] : null,
  };
}

/* ------------------------------------------------------------------ */
/* Validación honesta                                                  */
/* ------------------------------------------------------------------ */

/**
 * Validación cruzada dejando-uno-afuera.
 *
 * ⚠️ El error de ajuste —qué tan bien el modelo reproduce los puntos con los
 * que se entrenó— siempre se ve mejor de lo que el modelo es. Acá cada punto
 * se predice con un modelo que NO lo vio, que es la única medida de error que
 * significa algo. Se puede hacer en O(1) por punto restándolo de los
 * estadísticos suficientes, sin reentrenar nada.
 *
 * Devuelve el error porcentual absoluto MEDIANO: la mediana y no el promedio,
 * porque un punto raro en la tabla no puede definir la nota del modelo.
 */
export function validar(materiales = [], opts = {}) {
  const porProceso = {};
  const todos = [];

  for (const m of materiales || []) {
    if (m?.activo === false) continue;
    for (const [gas, datos] of Object.entries(m.procesos || {})) {
      const completo = entrenarProceso(m, gas, datos, opts);
      if (!completo || completo.n < 4) continue; // sacar uno dejaría menos de 3

      const errores = [];
      const maxEsp = esNum(datos.maxEspesor) ? datos.maxEspesor : Infinity;
      for (const [tStr, vStr] of Object.entries(datos.speeds || {})) {
        const t = Number(tStr);
        const v = Number(vStr);
        if (!(t > 0) || !(v > 0) || t > maxEsp + 1e-9) continue;

        // Sacar este punto de los estadísticos: sumarlo con peso −1.
        const sinEl = sumar(completo.stats, ln(t), ln(v), -1);
        const recta = ajustarRecta({ ...sinEl, n: sinEl.n });
        if (!recta) continue;

        const pred = Math.exp(recta.c + recta.m * ln(t));
        errores.push(Math.abs(pred - v) / v * 100);
      }
      if (!errores.length) continue;

      errores.sort((a, b) => a - b);
      const mid = Math.floor(errores.length / 2);
      const mediana = errores.length % 2 ? errores[mid] : (errores[mid - 1] + errores[mid]) / 2;
      porProceso[`${m.id}|${gas}`] = {
        materialId: m.id, gas, n: errores.length,
        errorMedianoPct: mediana,
        errorMaxPct: errores[errores.length - 1],
        r2: completo.r2,
      };
      todos.push(...errores);
    }
  }

  todos.sort((a, b) => a - b);
  const mid = Math.floor(todos.length / 2);
  return {
    porProceso,
    puntos: todos.length,
    errorMedianoPct: todos.length ? (todos.length % 2 ? todos[mid] : (todos[mid - 1] + todos[mid]) / 2) : null,
    // El percentil 90 dice qué tan mal se pone en el peor caso razonable.
    errorP90Pct: todos.length ? todos[Math.min(todos.length - 1, Math.floor(todos.length * 0.9))] : null,
  };
}

/* ------------------------------------------------------------------ */

/** Envejece la corrección aprendida: lo viejo pesa menos que lo de ayer. */
export function envejecerCorreccion(correccion, factor = 0.98) {
  if (!correccion?.procesos) return correccion;
  const procesos = {};
  for (const [k, st] of Object.entries(correccion.procesos)) procesos[k] = envejecer(st, factor);
  return { ...correccion, procesos };
}

/* ------------------------------------------------------------------ */

/** Qué tan bueno es el modelo, en castellano y sin adornos. */
export function explicarModelo(modelo, val) {
  if (!modelo?.combinaciones) return 'Todavía no hay tablas suficientes para entrenar el modelo.';

  const partes = [
    `Entrenado sobre ${modelo.puntos} puntos en ${modelo.combinaciones} combinaciones material×gas.`,
  ];
  if (val?.errorMedianoPct != null) {
    partes.push(
      `Error mediano de ${val.errorMedianoPct.toFixed(1)} % validando contra puntos que no vio ` +
      `(p90: ${val.errorP90Pct.toFixed(1)} %).`
    );
  }
  if (modelo.dudosos.length) {
    partes.push(
      `⚠️ ${modelo.dudosos.length} ${modelo.dudosos.length === 1 ? 'combinación no cierra' : 'combinaciones no cierran'} con la física: ` +
      modelo.dudosos.slice(0, 2).map((d) => `${d.materialId} con ${d.gas} (${d.fisica.motivo})`).join('; ') + '.'
    );
  }
  return partes.join(' ');
}
