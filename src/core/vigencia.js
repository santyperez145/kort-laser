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

/* ------------------------------------------------------------------ */
/* La base de costo                                                    */
/* ------------------------------------------------------------------ */

/**
 * `impactoMaterialRapido` mira el precio del material y nada más. Alcanzaba
 * mientras lo único que se movía fuera el acero — que con la inflación es lo
 * que más se mueve— pero deja afuera algo igual de caro: los parámetros con
 * los que el motor calcula.
 *
 * El día que se corrigió el setup del programa de 0 a 180 s, la pieza única
 * pasó de $4.000 a $7.000 (+75 %). Ningún precio de material cambió, así que
 * la cartera habría seguido diciendo que estaba todo bien mientras cada
 * presupuesto abierto quedaba por debajo del costo. Honrar uno es regalar la
 * diferencia.
 *
 * Por eso al guardar se estampa la base con la que se cotizó, igual que se
 * estampa `_precioKgMaterial` por ítem. Son los cinco números que mueven el
 * precio sin tocar la geometría ni el material.
 *
 * ⚠️ Esto detecta que la base cambió; **no** estima en cuánto. Calcular el
 * impacto exacto pide rehacer el nesting y volver a cotizar, que es
 * justamente lo que hace el Cotizador al abrir el presupuesto. Inventar acá
 * un número aproximado sería peor que no darlo: se lee como si fuera el
 * precio nuevo.
 */
export function baseDeCosto(ctx = {}) {
  const cfg = ctx.config || {};
  const com = cfg.comercial || {};
  const laser = (ctx.maquinas || []).find((m) => m.tipo === 'laser');
  if (!laser && !Object.keys(com).length) return null;
  return {
    setup: nz(laser?.tiempoSetupPrograma),
    carga: nz(laser?.tiempoCargaChapa),
    aprovechamiento: nz(com.aprovechamientoObjetivo),
    margen: nz(com.margen),
    // El costo por hora resume estructura, consumibles, energía y operario en
    // un solo número: si cambia cualquiera de ésos, cambia éste.
    costoHora: Math.round(nz(ctx.costoHoraLaser)),
  };
}

/** Qué campos de la base se movieron entre lo guardado y lo de hoy. */
export function baseQueSeMovio(entonces, hoy) {
  if (!entonces || !hoy) return null;
  const NOMBRES = {
    setup: 'Setup del programa',
    carga: 'Carga de chapa',
    aprovechamiento: 'Aprovechamiento objetivo',
    margen: 'Margen',
    costoHora: 'Costo por hora del láser',
  };
  const cambios = [];
  for (const k of Object.keys(NOMBRES)) {
    const a = nz(entonces[k]);
    const b = nz(hoy[k]);
    /* Se compara con tolerancia relativa: el costo por hora se redondea al
       peso y una diferencia de un peso sobre veinticinco mil no es un cambio
       de base, es ruido de redondeo. Un aviso que salta por eso enseña a
       ignorarlo. */
    const escala = Math.max(Math.abs(a), Math.abs(b), 1e-9);
    if (Math.abs(b - a) / escala > 0.001) {
      cambios.push({ campo: k, nombre: NOMBRES[k], entonces: a, hoy: b });
    }
  }
  return cambios.length ? cambios : null;
}

/**
 * Impacto del movimiento de materiales, sin recotizar.
 *
 * La lista de presupuestos necesita saber cuáles están en riesgo, pero
 * recotizar cada uno significa anidar cada uno: con cincuenta presupuestos
 * son varios segundos de pantalla congelada para pintar una tabla.
 *
 * Acá se usa lo que el presupuesto YA guardó por ítem —el peso total y el
 * $/kg con el que se cotizó— y se calcula la diferencia de material contra el
 * catálogo de hoy. Es una multiplicación por ítem: instantáneo.
 *
 * ⚠️ **Es EXACTO para el material y no mira nada más.** No recalcula corte,
 * gas, plegado ni acabados. Y alcanza para lo que se usa: en chapa fina el
 * material es el grueso del costo, así que si el material no se movió el
 * presupuesto casi seguro sigue en pie, y si se movió fuerte hay que abrirlo.
 * El número fino sale al abrirlo, con `evaluarVigencia()`.
 *
 * Devuelve null cuando el presupuesto es anterior a que se guardara el precio
 * por ítem: mejor no decir nada que estimar sobre datos que no están.
 */
export function impactoMaterialRapido(presupuesto, materialesHoy = []) {
  const items = presupuesto?.items || [];
  const precioDe = new Map(materialesHoy.map((m) => [m.id, nz(m.precioKg)]));

  let delta = 0;
  let conDato = 0;
  const porMaterial = new Map();

  for (const it of items) {
    const entonces = nz(it?._precioKgMaterial);
    const peso = nz(it?._pesoTotal);
    const hoy = precioDe.get(it?.materialId) || 0;
    if (!(entonces > 0) || !(hoy > 0) || !(peso > 0)) continue;
    conDato++;
    const d = peso * (hoy - entonces);
    delta += d;
    const acc = porMaterial.get(it.materialId) || { id: it.materialId, entonces, hoy, delta: 0, kg: 0 };
    acc.delta += d;
    acc.kg += peso;
    porMaterial.set(it.materialId, acc);
  }

  if (!conDato) return null;

  const res = presupuesto?.resumen || {};
  const costoEntonces = nz(res.costo);
  const precioPrometido = nz(res.subtotal);
  const costoEstimadoHoy = costoEntonces + delta;

  return {
    delta,
    itemsConDato: conDato,
    itemsTotales: items.length,
    // Parcial cuando algunos ítems son viejos y no tienen el precio guardado:
    // el número sirve igual pero se queda corto, y hay que decirlo.
    parcial: conDato < items.length,
    costoEntonces,
    costoEstimadoHoy,
    pct: costoEntonces > 0 ? (delta / costoEntonces) * 100 : null,
    // La pregunta que importa: ¿lo prometido sigue cubriendo?
    utilidadEstimadaHoy: precioPrometido > 0 ? precioPrometido - costoEstimadoHoy : null,
    enRojo: precioPrometido > 0 && costoEstimadoHoy > precioPrometido,
    materiales: [...porMaterial.values()].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)),
  };
}

/**
 * Resumen de la cartera abierta: qué hay que mirar hoy.
 *
 * Sólo cuentan los presupuestos VIVOS. Uno rechazado o ya facturado no se
 * puede sostener ni perder: incluirlos infla el número y lo vuelve ruido.
 */
export const ESTADOS_VIVOS = ['borrador', 'enviado'];

export function carteraEnRiesgo(presupuestos = [], materialesHoy = [], opts = {}) {
  const vivos = (presupuestos || []).filter((p) =>
    (opts.estados || ESTADOS_VIVOS).includes(p?.estado || 'borrador')
  );

  let enRojo = 0;
  let subieron = 0;
  let montoEnRiesgo = 0;
  let sinDato = 0;
  let baseCambiada = 0;

  for (const p of vivos) {
    /* Dos preguntas distintas sobre el mismo presupuesto, y se cuentan por
       separado a propósito: el material puede no haberse movido un peso
       mientras la base de cálculo cambió entera. Fue exactamente lo que pasó
       al corregir el setup del programa. */
    if (opts.baseHoy && baseQueSeMovio(p?._baseCosto, opts.baseHoy)) baseCambiada++;

    const i = impactoMaterialRapido(p, materialesHoy);
    if (!i) { sinDato++; continue; }
    if (i.enRojo) {
      enRojo++;
      montoEnRiesgo += Math.abs(i.utilidadEstimadaHoy || 0);
    } else if (i.pct != null && i.pct >= VARIACION_IGNORABLE) {
      subieron++;
    }
  }

  return { vivos: vivos.length, enRojo, subieron, montoEnRiesgo, sinDato, baseCambiada };
}
