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

  /* Una orden abierta sin `resumen.tiempoProduccion` da 0 segundos y se cae
     del filtro de abajo. Eso hace que la carga del taller quede corta y la
     fecha prometida salga optimista — el error caro, porque se promete y no
     se cumple. No se puede estimar lo que no se midió, así que se cuentan
     aparte y quien lea el plazo se entera de que puede quedar corto. */
  const conEstado = (ordenes || []).map((o) => ({ ...o, _segRestantes: segundosRestantesOrden(o) }));
  const sinEstimacion = conEstado.filter(
    (o) => o._segRestantes <= 0 && !ESTADOS_CERRADOS.has(o.estado || 'pendiente')
  ).length;

  const abiertas = conEstado
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
    sinEstimacion,
    atrasadas: plan.filter((o) => o.atrasada || o.vencida).length,
    vencidas: plan.filter((o) => o.vencida).length,
    sinFecha: plan.filter((o) => !o.fechaEntrega).length,
    ordenes: plan,
  };
}


/**
 * ¿En cuántos días hábiles se puede prometer un trabajo que todavía no entró?
 *
 * `agendaProduccion` ya sabía la carga comprometida y la capacidad diaria, y
 * no la usaba nadie: el presupuesto imprimía "Entrega estimada: 7 días
 * hábiles" con un 7 escrito a mano que no dependía del trabajo ni de lo que
 * había en la máquina. Un trabajo de 20 minutos y uno de 40 horas prometían
 * lo mismo.
 *
 * La cuenta es la del taller, no una fórmula: lo que hay en cola más lo nuevo,
 * dividido por lo que la máquina produce en un día. La capacidad ya sale de
 * `ocupacionProductiva` —60 % de 8 h son 4,8 h de corte real, no 8—, porque
 * prometer con las horas pagadas es prometer una fecha que no se cumple.
 *
 * ⚠️ Devuelve una sugerencia, nunca escribe el campo. El plazo lo promete el
 * taller: puede tener un turno extra, un feriado o un trabajo que sabe que se
 * va a demorar por el cliente. Y si hay órdenes sin tiempo estimado lo dice,
 * porque ahí el número queda corto y ocultarlo sería la peor versión de esto.
 */
export function plazoParaTrabajo(agenda, segundosTrabajo = 0, hoy = new Date()) {
  if (!agenda?.capacidadDiariaSegundos) return null;
  const seg = n(segundosTrabajo, 0);
  if (seg <= 0) return null;

  const capacidad = agenda.capacidadDiariaSegundos;
  const cola = n(agenda.segundosComprometidos, 0);
  const dias = Math.max(1, Math.ceil((cola + seg) / capacidad));

  return {
    dias,
    fecha: isoDia(sumarHabiles(hoy, dias)),
    horasTrabajo: seg / 3600,
    horasEnCola: cola / 3600,
    capacidadDiariaHoras: capacidad / 3600,
    ordenesAbiertas: agenda.abiertas,
    // Cuántas órdenes abiertas no aportan tiempo: el plazo queda corto por
    // cada una de ellas y no hay forma de saber cuánto.
    sinEstimacion: agenda.sinEstimacion || 0,
    // Sin nada en cola el número sale sólo del trabajo, y conviene decirlo:
    // "2 días" con la máquina libre y "2 días" con 30 h adelante no son la
    // misma promesa.
    maquinaLibre: cola <= 0,
  };
}

/** El texto, en un solo lugar, porque lo usan el cotizador y el PDF. */
export function explicarPlazo(p) {
  if (!p) return null;
  /* Coma decimal, como el resto de la aplicación, y minutos por debajo de la
     hora: "0,1 h de máquina" para un trabajo de seis minutos es un número
     correcto que no se entiende. */
  const h = (v) => {
    if (v < 1) return `${Math.max(1, Math.round(v * 60))} min`;
    const r = v >= 10 ? Math.round(v) : Math.round(v * 10) / 10;
    return `${String(r).replace('.', ',')} h`;
  };
  const partes = [`Son ${h(p.horasTrabajo)} de máquina`];

  if (p.maquinaLibre) partes.push('y no hay nada en cola');
  else partes.push(`y hay ${h(p.horasEnCola)} comprometidas en ${p.ordenesAbiertas} orden${p.ordenesAbiertas === 1 ? '' : 'es'}`);

  partes.push(`a ${h(p.capacidadDiariaHoras)} de producción por día`);

  let msg = `${partes.join(', ')} ⇒ ${p.dias} día${p.dias === 1 ? '' : 's'} hábil${p.dias === 1 ? '' : 'es'}.`;
  if (p.sinEstimacion > 0) {
    msg += ` Hay ${p.sinEstimacion} orden${p.sinEstimacion === 1 ? '' : 'es'} abierta${p.sinEstimacion === 1 ? '' : 's'} sin tiempo estimado: el plazo puede quedar corto.`;
  }
  return msg;
}
