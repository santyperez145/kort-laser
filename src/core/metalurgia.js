/**
 * KORT · Metalurgia y DFM de chapa: lo que hay que saber antes de doblar
 *
 * Este módulo trae conocimiento de ingeniería que NO sale de la aplicación ni
 * de las tablas del taller: viene de la práctica de herrería y metalúrgica, de
 * las hojas de datos de los productores de chapa y de las guías de diseño para
 * fabricación (DFM) que usan los talleres de plegado.
 *
 * Existe porque el sistema sabía cotizar un pliegue y no sabía si ese pliegue
 * se podía hacer. Son dos preguntas distintas, y la segunda se responde con
 * metalurgia, no con geometría: un 6061-T6 doblado con radio ajustado **se
 * fisura**, y la pieza no sale mal, sale rota.
 *
 * ══ Fuentes, y qué tan firme es cada número ════════════════════════════════
 *
 * Cada dato lleva de dónde salió, porque no todos valen lo mismo:
 *
 * - **`tabla`**: radio mínimo publicado por aleación y temple. Es propiedad
 *   del material, medida y repetible.
 * - **`regla`**: regla de taller de uso general (V ≈ 8·t, ala mínima). Sirve
 *   como punto de partida y el taller la corrige con su herramental.
 * - **`derivado`**: sale de una fórmula con las otras entradas.
 *
 * ⚠️ **Ningún número de acá reemplaza la primera muestra.** El plegado depende
 * del lote de chapa, del estado de la matriz y de la máquina; esto evita
 * mandar a producción algo que se va a fisurar, no reemplaza doblar una pieza
 * y medirla.
 *
 * ══ La dirección del grano, que es lo que más se olvida ════════════════════
 *
 * La chapa sale del laminador con los granos estirados en la dirección de
 * laminación. Doblar **a través** del grano (línea de plegado perpendicular a
 * la laminación) admite radios más chicos; doblar **a favor** abre los granos
 * y fisura, sobre todo en aluminio y en temples duros.
 *
 * Es la diferencia entre una pieza y un descarte, no se ve en el plano, y en
 * un nesting se decide sin pensarlo — al rotar una pieza para que entre mejor
 * en la chapa se le cambia la dirección del grano. Por eso el radio mínimo de
 * acá es el CONSERVADOR (a favor del grano) salvo que se diga la dirección: si
 * no se sabe cómo va a caer la pieza, hay que aguantar el peor caso.
 */

/**
 * Radio interno mínimo, en múltiplos del espesor.
 *
 * `[través, favor]` — a través del grano y a favor. Donde la fuente da un
 * rango por espesor, el menor es para chapa fina y el mayor para gruesa.
 *
 * Verificado el 2026-08-28 contra guías de plegado publicadas:
 * 5052-H32 ≈ 1·t; 6061-T6 ≈ 3–6·t; 304 recocido ≈ 1–2·t; acero dulce
 * ≈ 0,5–1·t. El 6061-T6 es el caso que más lastima: es el aluminio que más se
 * pide por resistencia y el que más se fisura al doblar.
 */
export const RADIO_MINIMO = {
  'acero-sae1010': { traves: 0.5, favor: 1.0, fuente: 'tabla', nota: 'Laminado en frío, muy dúctil.' },
  'acero-f24': { traves: 1.0, favor: 1.5, fuente: 'tabla', nota: 'Laminado en caliente: cascarilla y grano más grueso.' },
  'inox-304': { traves: 1.0, favor: 2.0, fuente: 'tabla', nota: 'Recocido. Endurece por deformación al plegar.' },
  'inox-430': { traves: 1.5, favor: 2.5, fuente: 'tabla', nota: 'Ferrítico: menos dúctil que el 304, más propenso a fisurar.' },
  galvanizado: { traves: 0.8, favor: 1.2, fuente: 'tabla', nota: 'El acero aguanta; el recubrimiento de zinc se descascara antes.' },
  'alu-5052': { traves: 0.5, favor: 1.0, fuente: 'tabla', nota: 'H32. El aluminio de plegar por excelencia.' },
  'alu-6061': { traves: 3.0, favor: 6.0, fuente: 'tabla', nota: 'T6. ⚠️ Se fisura con radio ajustado. Si el diseño lo exige, hay que plegarlo en T4 y tratarlo después.' },
  laton: { traves: 0.5, favor: 1.0, fuente: 'tabla', nota: 'Muy dúctil en estado recocido.' },
  cobre: { traves: 0.5, favor: 1.0, fuente: 'tabla', nota: 'Muy dúctil.' },
};

/** Cuando el material no está en la tabla. Conservador a propósito. */
export const RADIO_MINIMO_DESCONOCIDO = { traves: 1.0, favor: 2.0, fuente: 'regla' };

/**
 * Constante de plegado al aire, forma métrica:
 *
 *     F[kN] = C · Rm[MPa] · t²[mm] · L[m] / V[mm]
 *
 * ⚠️ **1,42 y no 1,33.** El repo tenía 1,33, que está en el extremo bajo del
 * rango que se usa (1,33–1,42) y por lo tanto **subestima el tonelaje ~7 %**.
 * Subestimar es la dirección peligrosa: el sistema dice que el pliegue entra
 * en la plegadora y en la máquina no entra. Verificado el 2026-08-28: 1,42 es
 * el valor estándar para plegado al aire a 90°, y coincide con la fórmula
 * alternativa P = 650·t²·L/V para Rm = 450 MPa (1,42 × 450 = 639 ≈ 650).
 */
export const C_AIRE = 1.42;

const n = (v, d = null) => (typeof v === 'number' && isFinite(v) ? v : d);

function claveDe(material) {
  const id = String(material?.id || '').toLowerCase();
  if (RADIO_MINIMO[id]) return id;
  const f = `${material?.familia || ''} ${id}`.toLowerCase();
  if (/6061/.test(f)) return 'alu-6061';
  if (/5052/.test(f)) return 'alu-5052';
  if (/304/.test(f)) return 'inox-304';
  if (/430/.test(f)) return 'inox-430';
  if (/galv/.test(f)) return 'galvanizado';
  if (/laton|latón/.test(f)) return 'laton';
  if (/cobre/.test(f)) return 'cobre';
  return null;
}

/**
 * Radio interno mínimo en mm.
 *
 * @param {string} grano  'traves' | 'favor' | null. **Null usa el peor caso**,
 *   que es lo correcto cuando no se sabe cómo va a caer la pieza en la chapa:
 *   el nesting rota piezas para aprovechar mejor y ahí se cambia la dirección
 *   del grano sin que nadie lo decida.
 */
export function radioMinimo(material, espesor, grano = null) {
  const t = n(espesor, 0);
  if (!(t > 0)) return null;
  const clave = claveDe(material);
  const d = clave ? RADIO_MINIMO[clave] : RADIO_MINIMO_DESCONOCIDO;
  const mult = grano === 'traves' ? d.traves : d.favor;
  return {
    mm: mult * t,
    multiplo: mult,
    grano: grano || 'sin especificar (se usa el peor caso)',
    fuente: d.fuente,
    nota: d.nota || null,
    conocido: !!clave,
  };
}

/**
 * Distancia mínima del borde de un agujero a la línea de plegado.
 *
 * Un agujero demasiado cerca se deforma al plegar: el material se estira sobre
 * el radio y el agujero sale ovalado. La regla de DFM es
 *
 *     d ≥ 2·t + Ri        agujeros de hasta ~25 mm
 *     d ≥ 2,5·t + Ri      agujeros mayores y ranuras
 *
 * ⚠️ Verificado el 2026-08-28, y me corrigió: había puesto 1,5·t de memoria.
 * El 1,5·t es la regla de agujero a BORDE, que es otra cosa; cerca de un
 * pliegue hace falta más porque ahí el material se deforma.
 */
export function distanciaMinimaAlPliegue(espesor, radioInterno, diametroAgujero = 0) {
  const t = n(espesor, 0);
  const ri = n(radioInterno, 0);
  if (!(t > 0)) return null;
  const grande = n(diametroAgujero, 0) > 25;
  return { mm: (grande ? 2.5 : 2) * t + ri, multiplo: grande ? 2.5 : 2, grande };
}

/**
 * Tonelaje de plegado al aire, por metro y total.
 *
 * Se deja acá y no en `bending.js` porque la constante es un dato de
 * ingeniería externo, no una preferencia del taller, y conviene que viva junto
 * a su justificación.
 */
export function fuerzaPlegado({ espesor, Rm, V, largoMM }) {
  const t = n(espesor, 0);
  const rm = n(Rm, 0);
  const v = n(V, 0);
  if (!(t > 0) || !(rm > 0) || !(v > 0)) return null;
  const kNporMetro = (C_AIRE * rm * t * t) / v;
  const largoM = Math.max(0, n(largoMM, 0)) / 1000;
  return {
    kNporMetro,
    toneladasPorMetro: kNporMetro / 9.80665,
    toneladas: (kNporMetro / 9.80665) * largoM,
    constante: C_AIRE,
  };
}

/**
 * Revisa un plegado contra la metalurgia del material.
 *
 * Devuelve hallazgos con el mismo formato que el resto del sistema. El radio
 * por debajo del mínimo es **error y no aviso**: no es que la pieza salga
 * fea, es que se fisura y hay que rehacerla.
 */
export function revisarPlegadoMetalurgico({ material, espesor, radioInterno, grano = null, agujerosCerca = [] }) {
  const out = [];
  const rmin = radioMinimo(material, espesor, grano);
  if (!rmin) return out;

  const ri = n(radioInterno, 0);
  if (ri > 0 && ri < rmin.mm - 1e-9) {
    out.push({
      nivel: 'error',
      codigo: 'radio-bajo-minimo',
      msg:
        `Radio interno ${ri.toFixed(1)} mm en ${material?.nombre || material?.id} de ${espesor} mm. ` +
        `El mínimo es ${rmin.mm.toFixed(1)} mm (${rmin.multiplo}·espesor` +
        `${grano ? `, ${grano === 'traves' ? 'a través del' : 'a favor del'} grano` : ', sin saber la dirección del grano se toma el peor caso'}). ` +
        `Por debajo de eso el material se fisura en el pliegue.` +
        (rmin.nota ? ` ${rmin.nota}` : ''),
      accion: 'Usá una matriz V mayor, o pedí el material en un temple más dúctil.',
    });
  } else if (ri > 0 && !grano && ri < rmin.mm * 2) {
    /* Entre el mínimo a favor del grano y el doble: entra, pero la dirección
       importa. Vale la pena decirlo porque el nesting rota piezas y ahí se
       decide sin querer. */
    out.push({
      nivel: 'aviso',
      codigo: 'grano-sin-definir',
      msg:
        `El radio ${ri.toFixed(1)} mm alcanza sólo si la pieza se pliega a través del grano. ` +
        'Al rotar la pieza en el nesting se cambia esa dirección sin que nadie lo decida.',
      accion: 'Fijá la orientación en el plano o dejá margen de radio.',
    });
  }

  for (const a of agujerosCerca || []) {
    const dmin = distanciaMinimaAlPliegue(espesor, ri, a.diametro);
    if (!dmin) continue;
    if (n(a.distancia, Infinity) < dmin.mm) {
      out.push({
        nivel: 'aviso',
        codigo: 'agujero-cerca-del-pliegue',
        msg:
          `Un agujero de ${a.diametro ?? '?'} mm queda a ${Number(a.distancia).toFixed(1)} mm de la línea ` +
          `de plegado y hacen falta ${dmin.mm.toFixed(1)} mm (${dmin.multiplo}·espesor + radio). ` +
          'Más cerca, el agujero sale ovalado.',
        accion: 'Alejá el agujero o hacelo después de plegar.',
      });
    }
  }

  return out;
}
