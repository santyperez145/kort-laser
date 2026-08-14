/**
 * KORT - Consumibles del láser
 *
 * "Consumibles por hora" era el único costo del sistema sin manera de
 * contrastarlo: un campo libre en pesos, sin fuente y sin desglose. Por eso un
 * $150.000 mal tipeado (contra los $2.800 de referencia) multiplicó por seis
 * todos los precios sin que nada chirriara.
 *
 * Acá el número deja de ser mágico: sale de piezas reales, con su precio y su
 * vida útil. Si algo está mal cargado se ve enseguida, porque una boquilla que
 * dura 45 horas y sale $18.000 no puede dar $150.000 por hora.
 *
 * ⚠️ **Las vidas útiles son técnicas; los precios NO están verificados.**
 * Las horas de duración salen del comportamiento del equipo y son bastante
 * estables entre talleres. Los precios en pesos son un orden de magnitud para
 * arrancar y hay que reemplazarlos por los del proveedor: son 🔴 en
 * docs/PRECIOS.md. El valor que producen (~$2.800/h) coincide con la regla
 * práctica de USD 1,5-4 por hora de corte en un fibra de 3 kW.
 */

/**
 * Por qué el gas de asistencia cambia la vida de la lente: cortando acero con
 * oxígeno hay mucha más salpicadura y humo que con nitrógeno o aire, así que
 * la protectora se ensucia y se pica bastante antes.
 */
export const FACTOR_VIDA_LENTE = { O2: 0.7, N2: 1.15, AIRE: 1 };

/**
 * Lista de referencia para un fibra de 3 kW con mesa 3015.
 * `vidaHoras` = horas de CORTE, no horas de taller abierto.
 */
export const CONSUMIBLES_LASER = [
  {
    id: 'lente-protectora',
    nombre: 'Lente protectora',
    precio: 28000,
    vidaHoras: 60,
    nota: 'Se pica con la salpicadura. Con O₂ dura bastante menos que con N₂.',
    dependeDelGas: true,
  },
  {
    id: 'boquilla',
    nombre: 'Boquilla',
    precio: 18000,
    vidaHoras: 45,
    nota: 'Se deforma con el calor y con cualquier choque contra la chapa levantada.',
  },
  {
    id: 'ceramica',
    nombre: 'Cerámica del cabezal',
    precio: 45000,
    vidaHoras: 250,
    nota: 'Dura hasta que hay un choque. La vida real la define cuántos choques hay.',
  },
  {
    id: 'filtro-aspiracion',
    nombre: 'Filtros de aspiración',
    precio: 320000,
    vidaHoras: 400,
    nota: 'Se saturan con el humo. Cortando galvanizado o pintado duran mucho menos.',
  },
  {
    id: 'lente-enfoque',
    nombre: 'Lente de enfoque / colimadora',
    precio: 450000,
    vidaHoras: 1500,
    nota: 'No es de rutina: se cambia cuando se daña o pierde calidad de corte.',
  },
  {
    id: 'varios',
    nombre: 'Juntas, o-rings y varios',
    precio: 12000,
    vidaHoras: 20,
    nota: 'Lo chico que se va reponiendo sin llevar la cuenta.',
  },
];

const n = (v) => (typeof v === 'number' && isFinite(v) ? v : 0);

/**
 * Costo por hora de corte a partir de la lista de consumibles.
 *
 * @param {Array} lista  [{ precio, vidaHoras, dependeDelGas }]
 * @param {Object} opts  { gas } para ajustar la vida de lo que depende del gas
 * @returns {{ total: number, detalle: Array }}
 */
export function costoConsumiblesHora(lista = CONSUMIBLES_LASER, opts = {}) {
  const factor = FACTOR_VIDA_LENTE[opts.gas] ?? 1;
  const detalle = [];
  let total = 0;

  for (const c of lista) {
    const vida = n(c.vidaHoras) * (c.dependeDelGas ? factor : 1);
    // Sin vida útil no se puede prorratear: se ignora en vez de dividir por
    // cero y devolver Infinity, que envenenaría todo el costo de la máquina.
    if (!(vida > 0) || !(n(c.precio) > 0)) continue;
    const porHora = n(c.precio) / vida;
    total += porHora;
    detalle.push({ id: c.id, nombre: c.nombre, precio: n(c.precio), vidaHoras: vida, porHora });
  }

  detalle.sort((a, b) => b.porHora - a.porHora);
  return { total, detalle };
}

/**
 * ¿El valor cargado a mano es coherente con una lista de consumibles real?
 *
 * Se compara contra una banda amplia a propósito: la idea no es discutir si
 * son $2.800 o $4.100 —eso depende del taller y del proveedor— sino atajar el
 * caso en que alguien puso un mensual donde iba un horario, o le sobró un
 * cero. Un factor 4 en cualquiera de los dos sentidos ya es otra cosa.
 */
export function revisarConsumiblesHora(valorCargado, referencia = null) {
  const ref = referencia ?? costoConsumiblesHora().total;
  const v = n(valorCargado);
  if (!(ref > 0) || !(v > 0)) return null;
  const factor = v / ref;
  if (factor > 4) {
    return {
      nivel: 'error',
      factor,
      msg:
        `El costo de consumibles cargado es ${factor.toFixed(0)} veces el que sale de una lista ` +
        `de piezas normal. ¿No pusiste un gasto mensual en un campo que es por hora?`,
    };
  }
  if (factor < 0.25) {
    return {
      nivel: 'aviso',
      factor,
      msg:
        'El costo de consumibles cargado es muy bajo para un fibra: lentes, boquillas y ' +
        'filtros solos ya dan bastante más. Si queda así, el precio de cada corte sale corto.',
    };
  }
  return null;
}

function fechaOrden(o) {
  return new Date(o.real?.fecha || o.actualizado || o.creado || o.fecha || 0).getTime();
}

function horasOrden(o) {
  const real = n(o.real?.segundos) / 3600;
  if (real > 0) return real;
  return n(o.resumen?.tiempoProduccion) / 3600;
}

/**
 * Estado preventivo por horas de arco/corte acumuladas desde el ultimo cambio.
 *
 * Si no hay fecha de cambio cargada se usa todo el historial medido: no sirve
 * para decidir "cambiar hoy", pero si para mostrar que falta cargar el hito de
 * mantenimiento y que el sistema ya tiene las horas para avisar.
 */
export function estadoConsumiblesPorHoras(ordenes = [], lista = CONSUMIBLES_LASER, opts = {}) {
  const cambios = opts.ultimosCambios || {};
  const cerradas = new Set(['terminada', 'entregada', 'facturada', 'cerrada']);
  const horasTotales = (ordenes || [])
    .filter((o) => !o.estado || cerradas.has(o.estado))
    .reduce((acc, o) => acc + horasOrden(o), 0);

  const items = (lista || []).map((c) => {
    const desde = cambios[c.id] ? new Date(cambios[c.id]).getTime() : 0;
    const horas = (ordenes || [])
      .filter((o) => !o.estado || cerradas.has(o.estado))
      .filter((o) => !desde || fechaOrden(o) >= desde)
      .reduce((acc, o) => acc + horasOrden(o), 0);
    const vida = n(c.vidaHoras);
    const pct = vida > 0 ? (horas / vida) * 100 : 0;
    return {
      id: c.id,
      nombre: c.nombre,
      vidaHoras: vida,
      horas,
      pct,
      horasRestantes: vida - horas,
      ultimoCambio: cambios[c.id] || null,
      nivel: pct >= 100 ? 'error' : pct >= 80 ? 'aviso' : 'ok',
    };
  }).sort((a, b) => b.pct - a.pct);

  return {
    horasTotales,
    items,
    vencidos: items.filter((x) => x.nivel === 'error').length,
    porVencer: items.filter((x) => x.nivel === 'aviso').length,
    sinCambiosCargados: !Object.keys(cambios).length,
  };
}
