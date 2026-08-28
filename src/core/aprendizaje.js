/**
 * KORT · Aprender con pocos datos sin inventar
 *
 * Un taller que arranca no tiene mil trabajos medidos: tiene tres. Y los
 * tiene repartidos —dos de acero fino, uno de inoxidable grueso—, así que
 * ninguna celda tiene suficiente para decidir sola. Ése es el problema real, y
 * no es "falta de datos": es que los datos están fragmentados justo donde más
 * se necesitan.
 *
 * ── Por qué un umbral duro está mal ────────────────────────────────────────
 *
 * `calibracion.js` usaba una regla de todo o nada: con menos de 5 trabajos en
 * un grupo se ignora el grupo entero y se usa el promedio del taller; con 5 se
 * pasa a usar sólo el grupo. Eso tiene dos problemas que cuestan plata:
 *
 *   1. **El salto.** El quinto trabajo cambia el precio de golpe, porque se
 *      pasa de "no sé nada de este grupo" a "sé todo". Un presupuesto rehecho
 *      el martes sale distinto que el del lunes sin que nada haya cambiado en
 *      el taller.
 *   2. **Con 5 muestras la mediana todavía es ruido.** Confiar 100 % en ella
 *      es tan arbitrario como ignorarla del todo.
 *
 * ── Lo que hace este módulo ────────────────────────────────────────────────
 *
 * Encogimiento hacia el padre (shrinkage jerárquico). Cada nivel confía en su
 * propia medición en proporción a cuánta evidencia tiene, y lo que le falta lo
 * pide prestado al nivel de arriba:
 *
 *     estimación = peso × lo_medido_acá + (1 − peso) × lo_que_dice_el_padre
 *
 * Con 0 muestras el peso es 0 y queda exactamente el padre: no cambia nada,
 * que es lo correcto. No hay salto en ningún punto — la confianza crece de a
 * poco, como crece la evidencia.
 *
 * ⚠️ El peso NO sale de contar muestras sino de cuán consistentes son (ver
 * `pesoDeEvidencia`). Contar solo tiene un defecto grave en una jerarquía: las
 * mismas observaciones aparecen en varios niveles, y si cada nivel encoge por
 * cantidad, terminan arrastradas varias veces hacia el modelo sin corregir.
 * Seis trabajos que dicen todos 1,5 daban 1,44 en vez de 1,5. Con el peso por
 * consistencia dan 1,5 exacto, y seis desparramadas con la misma mediana dan
 * 1,08 — que es lo correcto, porque ahí no hay señal.
 *
 * La jerarquía va de lo general a lo específico, y la raíz es 1,0 —el modelo
 * sin corregir—:
 *
 *     1,0  →  todo el taller  →  banda de espesor  →  material + banda
 *
 * Esto no es una heurística: es el estimador que corresponde cuando hay muchas
 * celdas con pocas observaciones cada una. Lo que aporta acá es que **empieza
 * a servir con el primer trabajo medido** en vez de con el quinto, y que nunca
 * produce un salto de precio.
 *
 * ── Lo que NO hace, a propósito ────────────────────────────────────────────
 *
 * No extrapola a combinaciones que nunca vio más allá de lo que dice el padre,
 * no inventa una tendencia temporal con cuatro puntos y no devuelve un número
 * sin decir de cuánta evidencia salió. Cada estimación viene con su
 * composición —cuánto salió de cada nivel— para que un precio que cambió se
 * pueda explicar. Un modelo que no puede explicar por qué subió un precio no
 * se puede usar para cotizarle a un cliente.
 */

/**
 * Evidencia mínima para PRESENTAR una estimación como medida.
 *
 * ⚠️ No gobierna el peso —eso lo hace `pesoDeEvidencia` mirando consistencia—
 * sino la otra decisión, que es distinta: el número existe siempre, encogido
 * hacia el modelo cuando no hay nada, pero mostrarlo como "corregido con datos
 * del taller" en vez de "todavía estimando" pide un piso. Coincide con el
 * `MINIMO_TRABAJOS` que ya usaba la calibración.
 */
export const K_CONFIANZA = 5;

/**
 * Cuánto se espera que un grupo REAL difiera de su padre.
 *
 * 15 %: cortar inoxidable fino no debería desviarse mucho más que eso del
 * comportamiento general de la máquina. Es la escala contra la que se compara
 * el desparramo de las mediciones para decidir cuánto creerles.
 */
export const TAU_ENTRE_GRUPOS = 0.15;

/**
 * Piso de la dispersión medida. En un taller nadie cronometra mejor que esto
 * —los tiempos se anotan redondeados a los cinco minutos— así que una
 * dispersión observada de cero es un artefacto de tener pocas muestras, no
 * evidencia de precisión perfecta. Sin este piso, dos mediciones iguales
 * darían confianza total.
 */
export const DISPERSION_PISO = 0.05;

const n = (v, d = null) => (typeof v === 'number' && isFinite(v) ? v : d);

/** Mediana. Robusta ante el trabajo donde alguien dejó el cronómetro corriendo. */
export function mediana(xs) {
  const l = (xs || []).filter((x) => isFinite(x)).sort((a, b) => a - b);
  if (!l.length) return null;
  const m = Math.floor(l.length / 2);
  return l.length % 2 ? l[m] : (l[m - 1] + l[m]) / 2;
}

/**
 * Desviación absoluta mediana, escalada para ser comparable a un desvío
 * estándar. Se usa para decir si un nivel está desparramado, no para corregir:
 * con pocos datos una medida de dispersión es orientativa y nada más.
 */
export function dispersionRobusta(xs, centro = null) {
  const l = (xs || []).filter((x) => isFinite(x));
  if (l.length < 2) return null;
  const c = centro == null ? mediana(l) : centro;
  const mad = mediana(l.map((x) => Math.abs(x - c)));
  return mad == null ? null : mad * 1.4826;
}

/**
 * Estima encogiendo hacia el padre.
 *
 * Cuánto creerle a un nivel, entre 0 y 1.
 *
 * No alcanza con contar: **seis mediciones que dicen todas 1,5 son mucha más
 * evidencia que seis desparramadas entre 0,8 y 2,2**, y una fórmula que sólo
 * mire la cantidad las trata igual. Peor todavía en una jerarquía, donde las
 * mismas observaciones aparecen en varios niveles: si cada nivel encoge por
 * cantidad, las mismas seis muestras terminan arrastradas tres veces hacia el
 * modelo sin corregir y el resultado queda sistemáticamente corto.
 *
 *     peso = n·τ² / (n·τ² + σ²)
 *
 * σ es lo desparramadas que están las mediciones y τ cuánto se espera que un
 * grupo real difiera de su padre. Con mediciones consistentes σ es chico y el
 * peso se va a 1: seis trabajos que coinciden convencen. Con mediciones
 * dispersas el peso baja aunque haya muchas, que es lo correcto — ahí no hay
 * señal, hay ruido.
 *
 * ⚠️ Con menos de 3 muestras σ no se puede estimar. Ahí se usa un σ
 * deliberadamente alto (2τ), que deja el peso en 0,2 con una muestra y 0,33
 * con dos. Estimar la dispersión con dos puntos daría cero y confianza total
 * por casualidad.
 */
export function pesoDeEvidencia(valores, tau = TAU_ENTRE_GRUPOS) {
  const n = valores.length;
  if (!n) return 0;
  const sigma = n >= 3
    ? Math.max(DISPERSION_PISO, dispersionRobusta(valores) ?? DISPERSION_PISO)
    : tau * 2;
  const t2 = tau * tau;
  return (n * t2) / (n * t2 + sigma * sigma);
}

/**
 * Estima encogiendo hacia el padre.
 *
 * @param {Array<{id, valores}>} niveles  de más general a más específico
 * @param {number} raiz  el valor cuando no hay ninguna evidencia
 * @param {number} tau   cuánto se espera que un grupo real difiera del padre
 *
 * @returns {{ valor, composicion, n, evidencia }}
 *   `composicion` dice cuánto pesó cada nivel — es lo que permite explicar el
 *   número en vez de mostrarlo y ya.
 */
export function estimarConEncogimiento(niveles = [], raiz = 1, tau = TAU_ENTRE_GRUPOS) {
  let acumulado = raiz;
  const composicion = [{ id: 'modelo', n: 0, peso: 1, valor: raiz }];
  let nMasEspecifico = 0;

  for (const nivel of niveles) {
    const valores = (nivel?.valores || []).filter((x) => isFinite(x));
    if (!valores.length) continue;

    const propio = mediana(valores);
    if (propio == null) continue;

    const peso = pesoDeEvidencia(valores, tau);
    acumulado = peso * propio + (1 - peso) * acumulado;
    nMasEspecifico = valores.length;

    // Todo lo anterior se diluye por (1 - peso); este nivel entra con `peso`.
    for (const c of composicion) c.peso *= 1 - peso;
    composicion.push({ id: nivel.id, n: valores.length, peso, valor: propio });
  }

  return {
    valor: acumulado,
    composicion: composicion.filter((c) => c.peso > 0.005),
    n: nMasEspecifico,
    /* Evidencia total: la suma de observaciones que efectivamente pesaron.
       No es lo mismo "1,25 con 40 trabajos" que "1,25 con 2", y quien lea el
       número tiene derecho a saber cuál de los dos es. */
    evidencia: composicion.reduce((s, c) => s + c.n * c.peso, 0),
  };
}

/**
 * De la composición al castellano.
 *
 * Se nombra el nivel que más pesó y se aclara de dónde salió el resto. Sin
 * esto el encogimiento sería una caja negra que mueve precios, que es peor
 * que el umbral duro que vino a reemplazar.
 */
export function explicarEncogimiento(est, nombres = {}) {
  if (!est || !est.composicion?.length) return null;
  const ordenada = [...est.composicion].sort((a, b) => b.peso - a.peso);
  const principal = ordenada[0];

  const nombre = (c) => nombres[c.id] || c.id;
  if (principal.id === 'modelo') {
    return 'Todavía sin evidencia propia: se usa la estimación del modelo sin corregir.';
  }

  const pctPrincipal = Math.round(principal.peso * 100);
  const resto = ordenada.slice(1).filter((c) => c.peso >= 0.05);
  const detalleResto = resto.length
    ? ` El ${100 - pctPrincipal} % restante se apoya en ${resto.map(nombre).join(' y ')}.`
    : '';

  return (
    `${pctPrincipal} % de este número sale de ${principal.n} ` +
    `trabajo${principal.n === 1 ? '' : 's'} de ${nombre(principal)}.${detalleResto}`
  );
}

/**
 * ¿Alcanza la evidencia para mostrar esto como un dato y no como una pista?
 *
 * Se separa a propósito de la estimación: el número existe siempre —encogido
 * hacia el modelo cuando no hay nada—, pero **presentarlo como si estuviera
 * medido es otra cosa**. Esta función es la que decide si la pantalla dice
 * "corregido con datos del taller" o "todavía estimando".
 */
export function evidenciaSuficiente(est, minimo = K_CONFIANZA) {
  return !!est && est.evidencia >= minimo;
}
