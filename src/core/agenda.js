/**
 * Agenda de producción.
 *
 * No promete por calendario fijo: usa los segundos de producción que ya trae
 * cada orden y la capacidad productiva configurada del taller.
 */

const ESTADOS_CERRADOS = new Set(['terminado', 'entregado', 'cancelado']);

const FACTOR_RESTANTE = {
  pendiente: 1,
  material: 1,
  corte: 0.55,
  plegado: 0.18,
};

const MS_DIA = 86400000;

function n(v, d = 0) {
  return typeof v === 'number' && isFinite(v) ? v : d;
}

function isoDia(fecha) {
  return fecha.toISOString().slice(0, 10);
}

function desdeISO(dia) {
  const [y, m, d] = String(dia).slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y || 1970, (m || 1) - 1, d || 1, 12));
}

function esHabil(fecha) {
  const d = fecha.getUTCDay();
  return d !== 0 && d !== 6;
}

function normalizarHabil(fecha) {
  const f = new Date(fecha);
  f.setUTCHours(12, 0, 0, 0);
  while (!esHabil(f)) f.setTime(f.getTime() + MS_DIA);
  return f;
}

function sumarHabiles(fecha, dias) {
  const f = normalizarHabil(fecha);
  let restantes = Math.max(0, Math.ceil(dias));
  while (restantes > 0) {
    f.setTime(f.getTime() + MS_DIA);
    if (esHabil(f)) restantes--;
  }
  return f;
}

export function capacidadDiariaSegundos(config = {}) {
  const e = config.estructura || {};
  const horasDia = n(e.horasPorDia, 9);
  const ocupacion = n(e.ocupacionProductiva, 65);
  return Math.max(1800, horasDia * (ocupacion / 100) * 3600);
}

export function segundosRestantesOrden(orden) {
  const estado = orden?.estado || 'pendiente';
  if (ESTADOS_CERRADOS.has(estado)) return 0;
  const estimado = n(orden?.resumen?.tiempoProduccion, 0);
  const factor = FACTOR_RESTANTE[estado] ?? 1;
  return Math.max(0, estimado * factor);
}

function prioridadOrden(o) {
  if (o.prioridad === 'urgente') return 0;
  if (o.fechaEntrega) return 1;
  return 2;
}

function fechaPrometibleDesdeCarga(hoy, capacidad, segundosAcumulados) {
  if (segundosAcumulados <= 0) return isoDia(normalizarHabil(hoy));
  const dias = Math.max(0, Math.ceil(segundosAcumulados / capacidad) - 1);
  return isoDia(sumarHabiles(hoy, dias));
}

export function agendaProduccion(ordenes = [], config = {}, hoy = new Date()) {
  const capacidad = capacidadDiariaSegundos(config);
  const hoyHabil = normalizarHabil(hoy);

  const abiertas = (ordenes || [])
    .map((o) => ({ ...o, _segRestantes: segundosRestantesOrden(o) }))
    .filter((o) => o._segRestantes > 0)
    .sort((a, b) => {
      const pa = prioridadOrden(a) - prioridadOrden(b);
      if (pa) return pa;
      const fa = a.fechaEntrega || '9999-12-31';
      const fb = b.fechaEntrega || '9999-12-31';
      if (fa !== fb) return fa.localeCompare(fb);
      return String(a.creado || '').localeCompare(String(b.creado || ''));
    });

  let acumulado = 0;
  const plan = abiertas.map((o) => {
    acumulado += o._segRestantes;
    const fechaPrometible = fechaPrometibleDesdeCarga(hoyHabil, capacidad, acumulado);
    const comprometida = o.fechaEntrega ? desdeISO(o.fechaEntrega) : null;
    const atrasada = comprometida ? isoDia(comprometida) < fechaPrometible : false;
    const vencida = comprometida ? isoDia(comprometida) < isoDia(hoyHabil) : false;
    return {
      id: o.id,
      numero: o.numero,
      cliente: o.cliente?.nombre || o.cliente_nombre || '',
      estado: o.estado || 'pendiente',
      prioridad: o.prioridad || 'normal',
      fechaEntrega: o.fechaEntrega || null,
      fechaPrometible,
      segundosRestantes: o._segRestantes,
      horasRestantes: o._segRestantes / 3600,
      atrasada,
      vencida,
    };
  });

  const segundosTotales = plan.reduce((s, o) => s + o.segundosRestantes, 0);
  const diasComprometidos = segundosTotales / capacidad;

  return {
    fecha: isoDia(hoyHabil),
    capacidadDiariaSegundos: capacidad,
    capacidadDiariaHoras: capacidad / 3600,
    segundosComprometidos: segundosTotales,
    horasComprometidas: segundosTotales / 3600,
    diasComprometidos,
    fechaDisponible: fechaPrometibleDesdeCarga(hoyHabil, capacidad, segundosTotales),
    abiertas: plan.length,
    atrasadas: plan.filter((o) => o.atrasada || o.vencida).length,
    vencidas: plan.filter((o) => o.vencida).length,
    sinFecha: plan.filter((o) => !o.fechaEntrega).length,
    ordenes: plan,
  };
}
