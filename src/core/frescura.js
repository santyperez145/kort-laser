/**
 * KORT · ¿Hace cuánto que no se toca este precio?
 *
 * El historial de precios ya guardaba cada cambio desde el primer día, pero
 * nadie lo miraba: la pantalla de Materiales muestra el número y no dice de
 * cuándo es. Un precio sin fecha se lee como si fuera de hoy.
 *
 * El modo de falla no es olvidarse de todo — es olvidarse de lo que no se
 * compra seguido. El acero se actualiza porque entra chapa todas las semanas;
 * el aluminio, el latón y el cobre quedan con el precio de la carga inicial, y
 * el día que entra un trabajo de aluminio se cotiza con un número de hace seis
 * meses. En Argentina eso no es un redondeo: es vender por debajo del costo.
 *
 * Por eso hay DOS reglas, y hacen falta las dos:
 *
 *   1. **Relativa** — este material quedó muy atrás respecto de lo que el
 *      propio taller viene actualizando. Es la que encuentra al olvidado, y se
 *      calibra sola: si acá se revisan precios cada semana, dos meses es
 *      mucho; si se revisan por trimestre, no.
 *
 *   2. **Absoluta, en días** — el catálogo entero quedó viejo. Sin ésta, la
 *      regla relativa no encuentra nada cuando *todo* está igual de
 *      desactualizado, que es el peor caso y el más fácil de llegar.
 *
 * ⚠️ El umbral va en días y nunca en pesos. "Avisá si el acero pasa de $X"
 * queda viejo en un mes y termina saltando siempre; los días no se
 * desactualizan con la inflación. Mismo criterio que `salud.js`.
 *
 * ⚠️ Y no se estima cuánto habría que cobrar. Este módulo dice qué precio hay
 * que ir a mirar; el número real lo trae el proveedor. Inventar una corrección
 * "por inflación" sería exactamente la clase de dato plausible y falso que
 * este proyecto no admite.
 */

const DIA = 24 * 60 * 60 * 1000;

/**
 * Días de atraso respecto de la última revisión del taller a partir de los
 * cuales el material se considera olvidado.
 *
 * 30 días porque los distribuidores de chapa en Argentina reajustan cerca de
 * una vez por mes: quedarse un ciclo entero atrás ya se paga.
 */
export const ATRASO_RELATIVO = 30;

/** Días sin ninguna revisión a partir de los cuales el catálogo entero pide una mirada. */
export const DIAS_REVISION = 45;

const dias = (a, b) => Math.max(0, Math.round((a - b) / DIA));

/**
 * @param {Array}  materiales  catálogo actual
 * @param {Array}  historial   filas de `precios_material` ({ material_id, fecha })
 * @param {Object} opts        { hoy: Date }
 *
 * @returns {{
 *   porMaterial: Array<{id, nombre, precioKg, dias, desde, atrasado, sinDato}>,
 *   masReciente: number|null,   // días desde la última revisión de CUALQUIER material
 *   atrasados: Array,           // los olvidados respecto del resto
 *   sinDato: Array,             // sin una sola fila de historial
 *   catalogoViejo: boolean,     // nadie tocó un precio en DIAS_REVISION
 * }}
 */
export function frescuraDePrecios(materiales = [], historial = [], opts = {}) {
  const hoy = opts.hoy instanceof Date ? opts.hoy : new Date();

  /* La fila más nueva de cada material. El historial viene ordenado por fecha
     descendente, pero no se confía en eso: si alguien cambia el ORDER BY del
     endpoint, esto empezaría a leer la fila más vieja y diría que todo está
     desactualizado sin que ningún test lo note. */
  const ultima = new Map();
  for (const f of historial || []) {
    const id = f?.material_id ?? f?.materialId;
    const t = Date.parse(f?.fecha);
    if (!id || !isFinite(t)) continue;
    const previa = ultima.get(id);
    if (!previa || t > previa) ultima.set(id, t);
  }

  const activos = (materiales || []).filter((m) => m?.activo !== false);

  const porMaterial = activos.map((m) => {
    const t = ultima.get(m.id);
    return {
      id: m.id,
      nombre: m.nombre || m.id,
      precioKg: m.precioKg,
      dias: t ? dias(hoy, t) : null,
      desde: t ? new Date(t).toISOString() : null,
      sinDato: !t,
      atrasado: false,
    };
  });

  const conFecha = porMaterial.filter((x) => x.dias != null);
  // La revisión más reciente del taller: el material con menos días encima.
  const masReciente = conFecha.length ? Math.min(...conFecha.map((x) => x.dias)) : null;

  for (const x of conFecha) {
    x.atrasado = x.dias - masReciente >= ATRASO_RELATIVO;
  }

  return {
    porMaterial,
    masReciente,
    atrasados: porMaterial.filter((x) => x.atrasado),
    sinDato: porMaterial.filter((x) => x.sinDato),
    catalogoViejo: masReciente != null && masReciente >= DIAS_REVISION,
  };
}

/**
 * El texto para la pantalla. Vive acá y no en el componente porque la misma
 * frase la usan Materiales y el chequeo de salud, y dos redacciones distintas
 * del mismo hecho se leen como dos problemas distintos.
 */
export function explicarFrescura(f) {
  if (!f) return null;

  if (f.catalogoViejo) {
    return {
      nivel: 'aviso',
      msg:
        `Hace ${f.masReciente} días que no se actualiza ningún precio de material. ` +
        'Con la inflación de acá, un catálogo de mes y medio ya cotiza por debajo del costo ' +
        'en todo lo que se venda.',
    };
  }

  if (f.atrasados.length) {
    const lista = f.atrasados
      .slice(0, 3)
      .map((x) => `${x.nombre} (${x.dias} días)`)
      .join(', ');
    const resto = f.atrasados.length > 3 ? ` y ${f.atrasados.length - 3} más` : '';
    return {
      nivel: 'aviso',
      msg:
        `${f.atrasados.length} material${f.atrasados.length === 1 ? '' : 'es'} quedó atrás del ` +
        `resto del catálogo: ${lista}${resto}. Se actualiza lo que se compra seguido y el resto ` +
        'queda viejo, hasta que entra un trabajo de ese material y se cotiza con el precio de ' +
        'hace meses.',
    };
  }

  return null;
}
