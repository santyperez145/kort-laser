/**
 * KORT - ¿Este presupuesto todavía se puede sostener?
 *
 * `validezDias` existía pero sólo se imprimía en el PDF. Nadie verificaba
 * nada. Con la inflación argentina eso es un agujero de plata concreto: se
 * abre un presupuesto de hace tres semanas, el cliente dice "dale, lo tomo", y
 * se factura por debajo del costo de hoy sin que nadie se entere hasta que
 * llega la factura de la chapa.
 *
 * Acá se comparan DOS cosas que la gente mezcla y son distintas:
 *
 *   1. **El calendario.** Pasaron más días que la validez declarada. Por sí
 *      solo no significa nada: si el acero no se movió, el precio sigue
 *      siendo bueno y vencerlo es perder una venta por trámite.
 *
 *   2. **El costo.** Rehacer la cuenta con los precios de hoy y ver si lo que
 *      se prometió sigue cubriendo. Esto sí importa, y puede pasar dentro de
 *      la validez: si la chapa saltó 8 % en una semana, un presupuesto de
 *      cinco días ya puede estar en rojo.
 *
 * Lo que decide es el segundo. El primero es contexto.
 *
 * ⚠️ El impacto se informa EN PESOS, no en porcentaje. "Perdés 6 % de margen"
 * no mueve a nadie; "este trabajo te deja $47.300 menos de lo que creías" sí.
 *
 * Este módulo no cotiza: recibe el costo de entonces y el de hoy, y compara.
 * Rehacer la cuenta es del que llama, que ya tiene el motor a mano.
 */

const nz = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);

const DIA = 24 * 60 * 60 * 1000;

/** Umbral a partir del cual una variación de costo deja de ser ruido. */
export const VARIACION_IGNORABLE = 1.5; // %

/**
 * @param {Object} p
 *   presupuesto  { fecha, resumen: { costo, subtotal, total }, items? }
 *   costoHoy     number — el mismo presupuesto recotizado con los precios de hoy
 *   config       { comercial: { validezDias, margen, simbolo } }
 *   hoy          Date (inyectable para poder testear)
 */
export function evaluarVigencia({ presupuesto, costoHoy, config = {}, hoy = new Date() } = {}) {
  const com = config.comercial || {};
  const res = presupuesto?.resumen || {};
  const costoEntonces = nz(res.costo);
  const precioPrometido = nz(res.subtotal);

  if (!(costoEntonces > 0) || !(nz(costoHoy) > 0)) return null;

  /* --- Calendario --- */
  const fecha = presupuesto?.fecha ? new Date(presupuesto.fecha) : null;
  const dias = fecha && isFinite(fecha.getTime())
    ? Math.max(0, Math.floor((hoy.getTime() - fecha.getTime()) / DIA))
    : null;
  const validez = nz(com.validezDias, 10);
  const vencidoPorCalendario = dias != null && dias > validez;

  /* --- Costo --- */
  const variacionMonto = costoHoy - costoEntonces;
  const variacionPct = (variacionMonto / costoEntonces) * 100;

  /* El margen es lo que queda del precio prometido después del costo de HOY.
     Es la cuenta que importa: el precio ya está dicho y no se puede mover. */
  const margenEntonces = precioPrometido > 0 ? ((precioPrometido - costoEntonces) / precioPrometido) * 100 : 0;
  const margenHoy = precioPrometido > 0 ? ((precioPrometido - costoHoy) / precioPrometido) * 100 : 0;
  const utilidadHoy = precioPrometido - costoHoy;

  /* --- Veredicto ---
     Lo que decide es si el precio prometido sigue cubriendo. Vencido por
     calendario con precios quietos NO es un problema: es un trámite, y
     tratarlo como alarma enseña a ignorar las alarmas. */
  let nivel = 'ok';
  let mensaje;

  if (utilidadHoy < 0) {
    nivel = 'error';
    mensaje =
      `Este presupuesto quedó por debajo del costo: hoy cuesta hacerlo más de lo que se cotizó. ` +
      `Sostenerlo cuesta ${Math.abs(utilidadHoy).toFixed(0)} de bolsillo.`;
  } else if (margenEntonces - margenHoy >= 10) {
    nivel = 'aviso';
    mensaje =
      `El costo subió ${variacionPct.toFixed(1)} %: el margen bajó de ${margenEntonces.toFixed(0)} % ` +
      `a ${margenHoy.toFixed(0)} %. Son ${Math.abs(variacionMonto).toFixed(0)} menos de ganancia.`;
  } else if (Math.abs(variacionPct) >= VARIACION_IGNORABLE) {
    nivel = 'aviso';
    mensaje =
      `El costo ${variacionMonto > 0 ? 'subió' : 'bajó'} ${Math.abs(variacionPct).toFixed(1)} % ` +
      `desde que se cotizó. El margen quedó en ${margenHoy.toFixed(0)} %.`;
  } else if (vencidoPorCalendario) {
    // Sin movimiento de costo, el vencimiento es sólo formal
    nivel = 'ok';
    mensaje =
      `Pasaron ${dias} días (la validez era de ${validez}), pero los costos casi no se movieron: ` +
      'el precio se puede sostener.';
  } else {
    mensaje = 'Los costos no se movieron desde que se cotizó.';
  }

  return {
    dias,
    validez,
    vencidoPorCalendario,
    costoEntonces,
    costoHoy: nz(costoHoy),
    variacionMonto,
    variacionPct,
    precioPrometido,
    margenEntonces,
    margenHoy,
    utilidadHoy,
    // Cuánto habría que cotizar hoy para conservar el margen original
    precioParaMismoMargen: margenEntonces < 100
      ? nz(costoHoy) / (1 - margenEntonces / 100)
      : null,
    nivel,
    mensaje,
  };
}

/**
 * Variación de precio de los materiales que usa un presupuesto.
 *
 * Sirve para explicar POR QUÉ cambió el costo: sin esto el aviso dice "subió
 * 9 %" y quien cotiza tiene que salir a buscar cuál de los materiales fue.
 *
 * @param {Array} itemsCotizados  `cotizacion.items` de entonces
 * @param {Array} materialesHoy   catálogo actual
 */
export function materialesQueSeMovieron(itemsCotizados = [], materialesHoy = []) {
  const vistos = new Map();
  for (const it of itemsCotizados) {
    const id = it?.material?.id;
    const entonces = nz(it?.material?.precioKg);
    if (!id || !(entonces > 0) || vistos.has(id)) continue;
    const hoy = nz(materialesHoy.find((m) => m.id === id)?.precioKg);
    if (!(hoy > 0)) continue;
    const pct = ((hoy - entonces) / entonces) * 100;
    if (Math.abs(pct) < VARIACION_IGNORABLE) continue;
    vistos.set(id, {
      id,
      nombre: it.material.nombre || id,
      entonces,
      hoy,
      pct,
    });
  }
  return [...vistos.values()].sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
}
