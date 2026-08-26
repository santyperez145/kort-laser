/**
 * KORT - Rentabilidad por hora de máquina
 *
 * Un taller de corte no vende chapa: **vende horas de máquina**. La chapa la
 * compra y la revende; lo que es escaso y no se puede fabricar más son las
 * horas de la fibra y de la plegadora. Ese es el cuello de botella real, y por
 * lo tanto la única unidad en la que conviene comparar dos trabajos.
 *
 * Nadie lo mide. Se mira el total del presupuesto, que es exactamente la
 * medida equivocada:
 *
 *   A · $500.000 en 12 h de máquina  ->  $41.700 de utilidad por hora
 *   B · $ 80.000 en 0,5 h            ->  $160.000 por hora
 *
 * B es cuatro veces mejor negocio aunque parezca el trabajo chico. Un taller
 * que toma los A porque "son grandes" termina con la máquina llena y la
 * cuenta vacía.
 *
 * ⚠️ **Se mide UTILIDAD por hora, no facturación por hora.** Facturación por
 * hora premia el material caro, que es plata que entra y sale: cortar
 * inoxidable no es mejor negocio que cortar acero por el solo hecho de que la
 * chapa salga el triple. Lo que queda es lo que importa.
 *
 * ⚠️ Y se compara contra lo que ESTE taller consigue de verdad, no contra un
 * número de manual. La referencia sale de los presupuestos aprobados: si el
 * promedio del taller es $95.000/h, un trabajo a $60.000/h es malo acá aunque
 * en otro lado sea excelente.
 */

const nz = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);

/**
 * Piso para no dividir por un tiempo degenerado.
 *
 * Está en diez segundos, no en un minuto: un trabajo de una pieza chica ocupa
 * la máquina poco más de un minuto y su tasa por hora es perfectamente
 * significativa —de hecho es de los casos donde más importa mirarla, porque
 * la puesta a punto se come el precio—. Con el umbral en un minuto esos
 * trabajos quedaban sin evaluar, que era justo al revés de lo que hace falta.
 */
export const MINIMO_HORAS = 10 / 3600;
export const MINIMO_TRABAJOS_REFERENCIA = 4;

/**
 * Rentabilidad de un presupuesto cotizado.
 *
 * @param {Object} coti  lo que devuelve `cotizarPresupuesto()`
 */
export function rentabilidad(coti) {
  const res = coti?.resumen;
  if (!res) return null;

  const horas = nz(res.tiempoProduccion) / 3600;
  const utilidad = nz(res.utilidad);
  const subtotal = nz(res.subtotal);
  const costo = nz(res.costo);

  // El material que hay que poner antes de cobrar. No es un costo más: es
  // plata inmovilizada, y en un taller chico es la diferencia entre poder
  // tomar el trabajo y no poder.
  const material = (coti.items || []).reduce((a, i) => a + nz(i?.costos?.material), 0);

  if (!(horas > MINIMO_HORAS) || !(subtotal > 0)) {
    return { horas, utilidad, subtotal, costo, material, utilidadPorHora: null, materialPct: null };
  }

  return {
    horas,
    utilidad,
    subtotal,
    costo,
    material,
    utilidadPorHora: utilidad / horas,
    facturacionPorHora: subtotal / horas,
    // Qué parte del precio es chapa que hay que comprar primero
    materialPct: (material / subtotal) * 100,
  };
}

/**
 * Lo que este taller consigue por hora, sacado de sus propios trabajos.
 *
 * Sólo cuentan los APROBADOS: un presupuesto que el cliente no tomó no dice
 * nada sobre lo que el taller consigue, dice sobre lo que pidió. Mezclarlos
 * infla la referencia y deja a todos los trabajos reales "por debajo del
 * promedio", que es una referencia inservible.
 *
 * Mediana y no promedio, por lo mismo de siempre: un trabajo raro no puede
 * mover la vara.
 */
export function referenciaDelTaller(presupuestos = [], opts = {}) {
  const estados = opts.estados || ['aprobado', 'facturado'];
  const tasas = [];

  for (const p of presupuestos) {
    if (!estados.includes(p?.estado)) continue;
    const r = p.resumen || {};
    const horas = nz(r.tiempoProduccion) / 3600;
    const utilidad = nz(r.utilidad);
    if (!(horas > MINIMO_HORAS) || !(utilidad > 0)) continue;
    tasas.push(utilidad / horas);
  }

  if (tasas.length < MINIMO_TRABAJOS_REFERENCIA) {
    return { hay: false, n: tasas.length, minimo: MINIMO_TRABAJOS_REFERENCIA };
  }

  tasas.sort((a, b) => a - b);
  const m = Math.floor(tasas.length / 2);
  const mediana = tasas.length % 2 ? tasas[m] : (tasas[m - 1] + tasas[m]) / 2;

  return {
    hay: true,
    n: tasas.length,
    mediana,
    // Los cuartiles dicen si el taller es parejo o si vive de dos trabajos
    p25: tasas[Math.floor(tasas.length * 0.25)],
    p75: tasas[Math.floor(tasas.length * 0.75)],
  };
}

/**
 * El piso teórico: cuánto tiene que dejar CADA hora productiva para que el
 * taller no pierda plata.
 *
 * Sale de la estructura, no de una opinión: si el taller gasta $894.000 por
 * mes y tiene 100,8 horas productivas, cada hora tiene que dejar $8.869 sólo
 * para no perder. Es un piso, no un objetivo.
 */
export function pisoDelTaller(estructura) {
  const total = nz(estructura?.totalMes);
  const horas = nz(estructura?.horasProductivas);
  if (!(total > 0) || !(horas > 0)) return null;
  return { porHora: total / horas, totalMes: total, horas };
}

/**
 * Veredicto sobre un trabajo concreto.
 *
 * Devuelve el número Y qué habría que cobrar para llegar al objetivo, porque
 * "este trabajo es malo" sin decir a cuánto deja de serlo no sirve para
 * negociar con nadie.
 */
export function evaluarTrabajo(coti, { presupuestos = [], estructura = null } = {}) {
  const r = rentabilidad(coti);
  if (!r || r.utilidadPorHora == null) return null;

  const ref = referenciaDelTaller(presupuestos);
  const piso = pisoDelTaller(estructura);

  /* La vara: lo que el taller consigue de verdad si hay historial; si no, el
     piso de la estructura. Nunca un número inventado. */
  const vara = ref.hay ? ref.mediana : piso?.porHora ?? null;
  const origen = ref.hay ? 'historial' : piso ? 'estructura' : null;

  let nivel = 'ok';
  let mensaje = null;
  let precioParaLaVara = null;

  if (piso && r.utilidadPorHora < piso.porHora) {
    /* Debajo del piso no es "poco rentable": es que el trabajo no paga ni la
       parte de alquiler, luz y sueldos que le toca por ocupar la máquina. */
    nivel = 'error';
    mensaje =
      `Este trabajo deja ${Math.round(r.utilidadPorHora)} por hora de máquina y el taller ` +
      `necesita ${Math.round(piso.porHora)} sólo para cubrir sus gastos fijos. Ocupa ` +
      `${r.horas.toFixed(1)} h y no las paga.`;
  } else if (vara && r.utilidadPorHora < vara * 0.7) {
    nivel = 'aviso';
    mensaje =
      `Deja ${Math.round(r.utilidadPorHora)} por hora contra ${Math.round(vara)} que consigue ` +
      `el taller ${origen === 'historial' ? 'en sus trabajos aprobados' : 'como piso de estructura'}. ` +
      'Ocupa la máquina y rinde menos que lo habitual.';
  } else if (vara && r.utilidadPorHora > vara * 1.4) {
    nivel = 'bueno';
    mensaje =
      `Deja ${Math.round(r.utilidadPorHora)} por hora contra ${Math.round(vara)} habitual: ` +
      'de los trabajos que conviene priorizar.';
  }

  if (vara && r.utilidadPorHora < vara) {
    /* Cuánto habría que cobrar para llegar a la vara. El costo no se mueve:
       lo único que cambia es el precio. */
    precioParaLaVara = r.costo + vara * r.horas;
  }

  return {
    ...r,
    vara,
    origenVara: origen,
    piso: piso?.porHora ?? null,
    referencia: ref,
    nivel,
    mensaje,
    precioParaLaVara,
    // El material que hay que poner antes de cobrar: en un taller chico decide
    // si el trabajo se puede tomar, aparte de si conviene.
    materialAdelantado: r.material,
  };
}

/**
 * Ordena presupuestos por lo que dejan por hora.
 *
 * Sirve para decidir qué empujar cuando hay más trabajo que máquina, que es
 * el único momento en que la pregunta importa.
 */
export function ordenarPorRendimiento(presupuestos = []) {
  return presupuestos
    .map((p) => {
      const r = p.resumen || {};
      const horas = nz(r.tiempoProduccion) / 3600;
      const utilidad = nz(r.utilidad);
      return {
        presupuesto: p,
        horas,
        utilidad,
        utilidadPorHora: horas > MINIMO_HORAS ? utilidad / horas : null,
      };
    })
    .filter((x) => x.utilidadPorHora != null)
    .sort((a, b) => b.utilidadPorHora - a.utilidadPorHora);
}
