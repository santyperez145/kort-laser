/**
 * KORT · La cadena óptica: fuente, cabezal y lo que sale de ahí
 *
 * Hasta acá el modelo conocía la máquina por un solo número: `potenciaKW`.
 * Con 3 kW alcanza para elegir la fila de la tabla de velocidades, pero deja
 * afuera todo lo que decide **cómo** corta este equipo y no otro de 3 kW:
 *
 *   fuente (núcleo de la fibra) → colimador → lente de foco → boquilla
 *
 * De esa cadena sale el diámetro del punto focal, y del punto focal salen la
 * sangría, el detalle mínimo que se puede cortar y buena parte de la calidad
 * de canto. Dos máquinas de 3 kW con ópticas distintas cortan distinto.
 *
 * ── El único número que se calcula, y por qué se puede ─────────────────────
 *
 * El diámetro del punto focal es óptica geométrica pura:
 *
 *     punto = núcleo de la fibra × (foco / colimador)
 *
 * Es una ampliación: el cabezal proyecta la punta de la fibra sobre la chapa.
 * Con fibra de 50 µm, colimador de 100 mm y foco de 150 mm da 75 µm. No hay
 * nada empírico ahí — por eso este módulo lo calcula y no lo estima.
 *
 * ⚠️ **Todo lo demás se mide, no se deduce.** La sangría real depende del gas,
 * la presión, la velocidad y el estado de la boquilla; una fórmula que la
 * "calcule" daría un número plausible y falso, que es exactamente lo que este
 * proyecto no admite. Acá hay una estimación explícitamente rotulada como tal
 * para arrancar, y `sangriaMedida` la reemplaza en cuanto alguien corte un
 * cuadrado de 100 mm y lo mida con un calibre. Medir gana siempre.
 *
 * ── Los límites del cabezal ────────────────────────────────────────────────
 *
 * Un cabezal tiene presión máxima de trabajo y diámetro máximo de boquilla.
 * Si la tabla de proceso de un material pide más de lo que el cabezal
 * soporta, esa combinación no se puede cortar en calidad — y hoy el sistema
 * la cotizaría igual. Es el mismo agujero que ya cierra `maxEspesor`: vale
 * más perder la venta que no poder entregarla.
 */

const n = (v, d = null) => (typeof v === 'number' && isFinite(v) ? v : d);

/** λ de un láser de fibra de iterbio. Fija: no es un parámetro del taller. */
export const LAMBDA_UM = 1.07;

/**
 * Diámetro del punto focal, en µm.
 *
 * @param {Object} o  { nucleoFibraUM, colimadorMM, focoMM }
 * @returns {number|null}  null si falta alguno: no se inventa un valor.
 */
export function diametroPunto(o = {}) {
  const nucleo = n(o.nucleoFibraUM);
  const col = n(o.colimadorMM);
  const foco = n(o.focoMM);
  if (!(nucleo > 0) || !(col > 0) || !(foco > 0)) return null;
  return nucleo * (foco / col);
}

/**
 * Sangría estimada, en mm.
 *
 * ⚠️ ESTIMACIÓN. El punto focal marca el piso —la sangría nunca es menor que
 * el punto— y a partir de ahí se ensancha con el espesor, porque el haz
 * diverge por debajo del foco y el gas arrastra material fundido de las
 * paredes. Con oxígeno ensancha más que con nitrógeno o aire: la reacción
 * exotérmica quema fuera del punto.
 *
 * Los coeficientes son de orden de magnitud, no de este equipo. Sirven para
 * que el nesting no separe piezas a ciegas y para poner un número inicial en
 * la ficha; el número bueno sale de cortar un cuadrado y medirlo.
 */
export function sangriaEstimada(puntoUM, espesor, gas = 'N2') {
  const p = n(puntoUM);
  const t = n(espesor, 0);
  if (!(p > 0) || !(t > 0)) return null;
  const base = p / 1000; // mm
  // Ensanchamiento por espesor: ~4 % del espesor, y el O2 agrega la mitad más.
  const porEspesor = t * (gas === 'O2' ? 0.06 : 0.04);
  return Math.round((base + porEspesor) * 1000) / 1000;
}

/**
 * La sangría que se va a usar: la medida si existe, la estimada si no.
 * Devuelve siempre de dónde salió, porque un número medido y uno estimado no
 * valen lo mismo y la ficha técnica tiene que poder decirlo.
 */
export function sangria(maquina = {}, espesor, gas = 'N2') {
  const op = maquina.optica || {};
  const medida = n(op.sangriaMedida);
  if (medida > 0) return { mm: medida, origen: 'medida' };

  const punto = diametroPunto(op);
  const est = sangriaEstimada(punto, espesor, gas);
  if (est == null) return { mm: null, origen: 'sin datos' };
  return { mm: est, origen: 'estimada' };
}

/**
 * ¿La tabla de proceso de estos materiales pide más de lo que el cabezal da?
 *
 * Se recorre cada material × gas × espesor de la propia tabla, así que no hay
 * que enumerar combinaciones a mano: si mañana se agrega un material, este
 * chequeo lo cubre solo.
 */
export function revisarCabezal(maquina = {}, materiales = []) {
  const op = maquina.optica || {};
  const pMax = n(op.presionMaxBar);
  const bMax = n(op.boquillaMaxMM);
  if (!pMax && !bMax) return [];

  const out = [];
  for (const m of materiales || []) {
    if (m?.activo === false) continue;
    for (const [gas, datos] of Object.entries(m.procesos || {})) {
      const tope = n(datos.maxEspesor, Infinity);

      if (pMax) {
        /* Sólo los espesores que el material declara cortables: pedir presión
           para un espesor que la tabla ya rechaza sería un aviso falso. */
        const excede = Object.entries(datos.presion || {})
          .map(([t, v]) => ({ t: Number(t), v: n(v, 0) }))
          .filter((x) => x.t <= tope && x.v > pMax);
        if (excede.length) {
          const peor = excede.reduce((a, b) => (b.v > a.v ? b : a));
          out.push({
            nivel: 'aviso',
            campo: 'presionMaxBar',
            msg:
              `${m.nombre} con ${gas} a ${peor.t} mm pide ${peor.v} bar y el cabezal ` +
              `soporta ${pMax}. A menos presión el canto sale con rebaba y hay que ` +
              'desbarbar, o directamente no corta. Conviene bajar el espesor máximo ' +
              'de ese proceso antes de venderlo.',
          });
        }
      }

      if (bMax) {
        const excede = Object.entries(datos.boquilla || {})
          .map(([t, v]) => ({ t: Number(t), v: n(v, 0) }))
          .filter((x) => x.t <= tope && x.v > bMax);
        if (excede.length) {
          const peor = excede.reduce((a, b) => (b.v > a.v ? b : a));
          out.push({
            nivel: 'aviso',
            campo: 'boquillaMaxMM',
            msg:
              `${m.nombre} con ${gas} a ${peor.t} mm necesita boquilla de ${peor.v} mm ` +
              `y el cabezal toma hasta ${bMax}. Esa combinación no se puede montar.`,
          });
        }
      }
    }
  }
  return out;
}

/** Lo que se muestra en la ficha técnica. Null donde falte el dato. */
export function fichaOptica(maquina = {}) {
  const op = maquina.optica || {};
  const punto = diametroPunto(op);
  return {
    fuente: op.fuente || null,
    cabezal: op.cabezal || null,
    nucleoFibraUM: n(op.nucleoFibraUM),
    colimadorMM: n(op.colimadorMM),
    focoMM: n(op.focoMM),
    puntoUM: punto == null ? null : Math.round(punto * 10) / 10,
    ampliacion: punto == null ? null : Math.round((op.focoMM / op.colimadorMM) * 100) / 100,
    presionMaxBar: n(op.presionMaxBar),
    boquillaMaxMM: n(op.boquillaMaxMM),
    autofoco: op.autofoco === true ? true : op.autofoco === false ? false : null,
    sangriaMedida: n(op.sangriaMedida),
  };
}
