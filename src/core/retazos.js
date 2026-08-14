/**
 * Inventario de retazos de chapa.
 *
 * Un retazo no es una chapa estandar: tiene medida, material y espesor
 * propios. El modulo solo calcula y ordena candidatos; decidir si una pieza
 * entra de verdad sigue siendo responsabilidad del nesting, que conoce la
 * geometria completa y las separaciones del programa.
 */

const n = (valor, defecto = 0) => {
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : defecto;
};

const positivo = (valor, defecto = 0) => Math.max(0, n(valor, defecto));

export const ESTADOS_RETAZO = ['disponible', 'reservado', 'descartado'];

function normalizarReserva(reserva = {}) {
  return {
    ordenId: String(reserva.ordenId || reserva.orden_id || '').trim(),
    presupuestoId: String(reserva.presupuestoId || reserva.presupuesto_id || '').trim(),
    cantidad: Math.max(0, Math.round(n(reserva.cantidad, 0))),
    fecha: reserva.fecha || null,
  };
}

export function normalizarRetazo(retazo = {}) {
  const estado = ESTADOS_RETAZO.includes(retazo.estado) ? retazo.estado : 'disponible';
  return {
    id: String(retazo.id || ''),
    materialId: String(retazo.materialId || retazo.material_id || ''),
    espesor: positivo(retazo.espesor),
    w: positivo(retazo.w ?? retazo.ancho),
    h: positivo(retazo.h ?? retazo.alto),
    cantidad: Math.max(0, Math.round(n(retazo.cantidad, 1))),
    estado,
    ubicacion: String(retazo.ubicacion || '').trim(),
    lote: String(retazo.lote || '').trim(),
    origen: String(retazo.origen || 'corte').trim(),
    notas: String(retazo.notas || '').trim(),
    reservas: (Array.isArray(retazo.reservas) ? retazo.reservas : [])
      .map(normalizarReserva)
      .filter((x) => x.ordenId && x.cantidad > 0),
    creado: retazo.creado || null,
    modificado: retazo.modificado || null,
  };
}

/** Un estado `reservado` manual bloquea todas las unidades del retazo. */
export function cantidadReservada(retazo, excluirOrdenId = '') {
  const r = normalizarRetazo(retazo);
  if (r.estado === 'reservado') return r.cantidad;
  return r.reservas
    .filter((x) => !excluirOrdenId || x.ordenId !== excluirOrdenId)
    .reduce((total, x) => total + x.cantidad, 0);
}

export function unidadesDisponibles(retazo, excluirOrdenId = '') {
  const r = normalizarRetazo(retazo);
  if (r.estado !== 'disponible') return 0;
  return Math.max(0, r.cantidad - cantidadReservada(r, excluirOrdenId));
}

export function superficieRetazoM2(retazo) {
  const r = normalizarRetazo(retazo);
  return (r.w * r.h * r.cantidad) / 1e6;
}

export function pesoRetazoKg(retazo, material) {
  const r = normalizarRetazo(retazo);
  return (r.w * r.h * r.espesor * n(material?.densidad)) / 1e6 * r.cantidad;
}

export function valorRetazo(retazo, material) {
  return pesoRetazoKg(retazo, material) * n(material?.precioKg);
}

function claveStock(retazo) {
  return `${retazo.materialId}|${retazo.espesor}`;
}

/** Resumen para compras y reposicion, agrupado por material y espesor. */
export function resumenStockRetazos(retazos = [], materiales = []) {
  const porId = new Map((materiales || []).map((m) => [m.id, m]));
  const grupos = new Map();
  for (const original of retazos || []) {
    const r = normalizarRetazo(original);
    if (!r.materialId || r.w <= 0 || r.h <= 0 || r.cantidad <= 0) continue;
    const material = porId.get(r.materialId);
    const clave = claveStock(r);
    if (!grupos.has(clave)) {
      grupos.set(clave, {
        clave,
        materialId: r.materialId,
        material: material?.nombre || r.materialId,
        espesor: r.espesor,
        unidades: 0,
        disponibles: 0,
        reservadas: 0,
        descartadas: 0,
        superficieM2: 0,
        pesoKg: 0,
        valor: 0,
        retazos: 0,
        superficieDisponibleM2: 0,
      });
    }
    const g = grupos.get(clave);
    g.retazos += 1;
    g.unidades += r.cantidad;
    const disponibles = unidadesDisponibles(r);
    const reservadas = cantidadReservada(r);
    g.disponibles += disponibles;
    g.reservadas += reservadas;
    if (r.estado === 'descartado') g.descartadas += r.cantidad;
    if (r.estado !== 'descartado') {
      g.superficieM2 += superficieRetazoM2(r);
      g.superficieDisponibleM2 += (r.w * r.h * disponibles) / 1e6;
      g.pesoKg += pesoRetazoKg(r, material);
      g.valor += valorRetazo(r, material);
    }
  }
  return [...grupos.values()].sort((a, b) => b.valor - a.valor || a.material.localeCompare(b.material));
}

function orientacionQueEntra(w, h, rw, rh) {
  if (w <= rw && h <= rh) return { rotacion: 0, w, h };
  if (h <= rw && w <= rh) return { rotacion: 90, w: h, h: w };
  return null;
}

/**
 * Busca retazos que pueden recibir el rectangulo envolvente de una pieza.
 * Es una preseleccion conservadora: el nesting debe confirmar el encastre
 * final cuando la pieza tiene una forma irregular o varias partes.
 */
export function candidatosRetazo(retazos = [], requisito = {}, opciones = {}) {
  const materialId = requisito.materialId || requisito.material_id;
  const espesor = n(requisito.espesor);
  const w = positivo(requisito.w ?? requisito.ancho);
  const h = positivo(requisito.h ?? requisito.alto);
  const cantidad = Math.max(1, Math.round(n(requisito.cantidad, 1)));
  const margen = positivo(opciones.margen);
  const tolerancia = positivo(opciones.tolerancia, 0.01);
  if (!materialId || !(espesor > 0) || !(w > 0) || !(h > 0)) return [];

  return (retazos || [])
    .map(normalizarRetazo)
    .filter((r) => unidadesDisponibles(r) >= cantidad)
    .filter((r) => r.materialId === materialId && Math.abs(r.espesor - espesor) <= tolerancia)
    .map((r) => {
      const orientacion = orientacionQueEntra(w + margen * 2, h + margen * 2, r.w, r.h);
      if (!orientacion) return null;
      const areaNecesaria = (w * h) / 1e6;
      const areaRetazo = (r.w * r.h) / 1e6;
      return {
        ...r,
        cantidadSolicitada: cantidad,
        disponibles: unidadesDisponibles(r),
        rotacion: orientacion.rotacion,
        areaNecesariaM2: areaNecesaria,
        desperdicioM2: Math.max(0, areaRetazo - areaNecesaria),
        aprovechamiento: areaRetazo > 0 ? areaNecesaria / areaRetazo : 0,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.desperdicioM2 - b.desperdicioM2 || a.w * a.h - b.w * b.h);
}

/** Agrupa las unidades de retazo elegidas por los items de una orden. */
export function asignacionesRetazoDeItems(items = []) {
  const porId = new Map();
  for (const item of items || []) {
    const id = String(item?.retazoId || '').trim();
    const cantidad = Math.max(0, Math.round(n(item?.cantidad, 0)));
    if (!id || cantidad <= 0) continue;
    porId.set(id, (porId.get(id) || 0) + cantidad);
  }
  return [...porId.entries()].map(([retazoId, cantidad]) => ({ retazoId, cantidad }));
}

function normalizarAsignaciones(asignaciones = []) {
  const porId = new Map();
  for (const item of asignaciones || []) {
    const retazoId = String(item?.retazoId || item?.id || '').trim();
    const cantidad = Math.max(0, Math.round(n(item?.cantidad, 0)));
    if (!retazoId || cantidad <= 0) continue;
    porId.set(retazoId, (porId.get(retazoId) || 0) + cantidad);
  }
  return porId;
}

/**
 * Reserva unidades para una orden. La operación es idempotente: repetirla
 * para la misma orden reemplaza su reserva anterior en vez de sumarla.
 */
export function reservarRetazos(retazos = [], asignaciones = [], opciones = {}) {
  const ordenId = String(opciones.ordenId || '').trim();
  const presupuestoId = String(opciones.presupuestoId || '').trim();
  if (!ordenId) return { ok: false, motivo: 'Falta el identificador de la orden.' };

  const porId = normalizarAsignaciones(asignaciones);
  const originales = (retazos || []).map(normalizarRetazo);
  const porRetazo = new Map(originales.map((r) => [r.id, r]));

  for (const [retazoId, cantidad] of porId) {
    const r = porRetazo.get(retazoId);
    if (!r) return { ok: false, motivo: `El retazo ${retazoId} ya no existe en el stock.` };
    if (r.estado !== 'disponible') {
      return { ok: false, motivo: `El retazo ${retazoId} no está disponible.` };
    }
    const libres = unidadesDisponibles(r, ordenId);
    if (libres < cantidad) {
      return {
        ok: false,
        motivo: `El retazo ${retazoId} tiene ${libres} unidad${libres === 1 ? '' : 'es'} libre${libres === 1 ? '' : 's'} y la orden necesita ${cantidad}.`,
      };
    }
  }

  const fecha = opciones.fecha || new Date().toISOString();
  const salida = originales.map((r) => {
    const reservas = r.reservas.filter((x) => x.ordenId !== ordenId);
    const cantidad = porId.get(r.id) || 0;
    if (cantidad > 0) reservas.push({ ordenId, presupuestoId, cantidad, fecha });
    return { ...r, reservas, modificado: fecha };
  });
  return {
    ok: true,
    retazos: salida,
    reservadas: [...porId.values()].reduce((total, cantidad) => total + cantidad, 0),
    asignaciones: [...porId.entries()].map(([retazoId, cantidad]) => ({ retazoId, cantidad })),
  };
}

/** Libera sólo las reservas de una orden; repetir la operación no falla. */
export function liberarRetazos(retazos = [], ordenId) {
  const dueño = String(ordenId || '').trim();
  if (!dueño) return { ok: false, motivo: 'Falta el identificador de la orden.' };
  let liberadas = 0;
  const fecha = new Date().toISOString();
  const salida = (retazos || []).map((original) => {
    const r = normalizarRetazo(original);
    const propias = r.reservas.filter((x) => x.ordenId === dueño);
    liberadas += propias.reduce((total, x) => total + x.cantidad, 0);
    if (!propias.length) return r;
    return { ...r, reservas: r.reservas.filter((x) => x.ordenId !== dueño), modificado: fecha };
  });
  return { ok: true, retazos: salida, liberadas };
}

/** Consume la reserva al entrar en corte, manteniendo el sobrante trazable. */
export function consumirRetazos(retazos = [], ordenId) {
  const dueño = String(ordenId || '').trim();
  if (!dueño) return { ok: false, motivo: 'Falta el identificador de la orden.' };
  const originales = (retazos || []).map(normalizarRetazo);
  const propias = originales.flatMap((r) => r.reservas
    .filter((x) => x.ordenId === dueño)
    .map((x) => ({ retazoId: r.id, cantidad: x.cantidad })));
  if (!propias.length) return { ok: true, retazos: originales, consumidas: 0 };

  for (const { retazoId, cantidad } of propias) {
    const r = originales.find((x) => x.id === retazoId);
    if (!r || r.cantidad < cantidad) {
      return { ok: false, motivo: `El retazo ${retazoId} no tiene unidades suficientes para consumir la reserva.` };
    }
  }

  const fecha = new Date().toISOString();
  const porId = new Map();
  for (const reserva of propias) porId.set(reserva.retazoId, (porId.get(reserva.retazoId) || 0) + reserva.cantidad);
  const salida = originales.map((r) => {
    const cantidad = porId.get(r.id) || 0;
    if (!cantidad) return r;
    const restante = r.cantidad - cantidad;
    return {
      ...r,
      cantidad: restante,
      estado: restante > 0 ? 'disponible' : 'descartado',
      reservas: r.reservas.filter((x) => x.ordenId !== dueño),
      modificado: fecha,
    };
  });
  return {
    ok: true,
    retazos: salida,
    consumidas: propias.reduce((total, x) => total + x.cantidad, 0),
  };
}

/** Decrementa unidades de un retazo sin inventar cortes del sobrante. */
export function consumirRetazo(retazos = [], id, cantidad = 1) {
  const cuanto = Math.max(1, Math.round(n(cantidad, 1)));
  let encontrado = false;
  const salida = (retazos || []).map((original) => {
    const r = normalizarRetazo(original);
    if (r.id !== id) return original;
    encontrado = true;
    if (r.estado !== 'disponible' || r.cantidad < cuanto) return original;
    return { ...r, cantidad: r.cantidad - cuanto, modificado: new Date().toISOString() };
  });
  return { retazos: salida, encontrado };
}
