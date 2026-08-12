/**
 * KORT - Revisión de los datos cargados
 *
 * Por qué existe: el motor calcula bien, pero calcula con lo que le cargaron.
 * Un campo mal tipeado no rompe nada — hace que todos los precios salgan mal,
 * en silencio, hasta que alguien mira un número y dice "esto es imposible".
 * Ya pasó: $150.000/hora en consumibles (el valor de referencia es $2.800)
 * llevó la hora de máquina de $30.000 a $177.000 y multiplicó por seis cada
 * presupuesto. Nadie se enteró durante días.
 *
 * ⚠️ **Las reglas son RELATIVAS y estructurales, nunca umbrales en pesos.**
 * Con la inflación argentina cualquier "avisá si supera $X" queda viejo en
 * meses y termina saltando siempre — y un aviso que salta siempre enseña a
 * ignorar los avisos. Se comparan proporciones, coherencias entre campos y
 * relaciones físicas, que no se desactualizan.
 *
 * Cada hallazgo dice DÓNDE se arregla, porque un aviso que no dice qué hacer
 * es ruido.
 */

import { calcularCostoHoraMaquina, calcularEstructura, revisarCostoHora } from './costos.js';

const n = (v) => (typeof v === 'number' && isFinite(v) ? v : null);

/** Densidades reales, g/cm³. Fuera de este rango no es un metal de chapa. */
const DENSIDAD_MIN = 0.5;
const DENSIDAD_MAX = 25;

function hallazgo(nivel, area, donde, msg) {
  return { nivel, area, donde, msg };
}

/* ------------------------------------------------------------------ */

function revisarComercial(cfg) {
  const out = [];
  const c = cfg.comercial || {};

  if (!(n(c.margen) > 0)) {
    out.push(hallazgo('error', 'comercial', 'Configuración → Comercial',
      'El margen es cero o no está cargado: estarías vendiendo al costo.'));
  } else if (c.margen > 300) {
    out.push(hallazgo('aviso', 'comercial', 'Configuración → Comercial',
      `Un margen de ${c.margen} % es altísimo. ¿Querías poner ${(c.margen / 10).toFixed(0)} %?`));
  }

  if (!(n(c.tipoCambio) > 0)) {
    out.push(hallazgo('aviso', 'comercial', 'Configuración → Comercial',
      'Sin tipo de cambio no se puede mostrar el total en dólares.'));
  }

  // Coherencia entre los dos mínimos: el de un ítem no puede superar al del
  // presupuesto entero, porque un presupuesto de un solo ítem sería imposible.
  const minItem = n(c.minimoPorItem);
  const minFac = n(c.minimoFacturacion);
  if (minItem != null && minFac != null && minItem > minFac && minFac > 0) {
    out.push(hallazgo('aviso', 'comercial', 'Configuración → Comercial',
      `El mínimo por ítem (${minItem}) es mayor que el mínimo de facturación (${minFac}). ` +
      'Un presupuesto de un solo ítem nunca podría cumplir los dos.'));
  }

  const aprov = n(c.aprovechamientoObjetivo);
  if (aprov != null && (aprov <= 0 || aprov > 1)) {
    out.push(hallazgo('aviso', 'comercial', 'Configuración → Comercial',
      `El aprovechamiento objetivo se expresa entre 0 y 1 (0,78 = 78 %). Está en ${aprov}.`));
  }

  return out;
}

function revisarEstructura(cfg) {
  const out = [];
  const e = cfg.estructura || {};
  const est = calcularEstructura(e);

  if (!(est.horasProductivas > 0)) {
    out.push(hallazgo('error', 'estructura', 'Costos → Estructura',
      'Las horas productivas del mes dan cero: todo costo por hora sería infinito.'));
    return out;
  }

  const ocup = n(e.ocupacionProductiva);
  if (ocup != null && (ocup < 15 || ocup > 95)) {
    out.push(hallazgo('aviso', 'estructura', 'Costos → Estructura',
      `Una ocupación productiva del ${ocup} % es poco creíble. Lo normal en un taller ` +
      'chico está entre 40 % y 75 %: el resto del tiempo la máquina espera trabajo.'));
  }

  // La potencia contratada es costo fijo: si se lleva casi todo, o está mal
  // cargada o hay contratada de más, que es plata tirada todos los meses.
  const potencia = est.items?.find((i) => i.id === 'potencia');
  if (potencia && potencia.pct > 60) {
    out.push(hallazgo('aviso', 'estructura', 'Costos → Energía',
      `La potencia contratada es el ${Math.round(potencia.pct)} % de la estructura. ` +
      'Revisá en la factura los kW que tenés contratados: si sobran, se pagan igual.'));
  }

  return out;
}

function revisarMaquinas(maquinas, estructura) {
  const out = [];
  if (!maquinas?.length) {
    out.push(hallazgo('error', 'maquinas', 'Máquinas', 'No hay ninguna máquina cargada.'));
    return out;
  }

  for (const m of maquinas) {
    // Dominancia de un componente: es lo que detectó el caso de los consumibles
    for (const a of revisarCostoHora(m, estructura)) {
      out.push(hallazgo(a.nivel, 'maquinas', `Máquinas → ${m.nombre || m.id}`, a.msg));
    }

    const ch = calcularCostoHoraMaquina(m, estructura);
    if (!(ch.total > 0)) {
      out.push(hallazgo('error', 'maquinas', `Máquinas → ${m.nombre || m.id}`,
        'El costo por hora da cero: faltan cargar los costos de la máquina.'));
    }

    const c = m.costo || {};
    if (n(c.vidaUtilHoras) != null && c.vidaUtilHoras < 1000) {
      out.push(hallazgo('aviso', 'maquinas', `Máquinas → ${m.nombre || m.id}`,
        `${c.vidaUtilHoras} horas de vida útil es muy poco (son ~6 meses de trabajo). ` +
        'Con ese número la amortización se dispara.'));
    }
  }
  return out;
}

function revisarMateriales(materiales) {
  const out = [];
  const activos = (materiales || []).filter((m) => m.activo !== false);

  if (!activos.length) {
    out.push(hallazgo('error', 'materiales', 'Materiales', 'No hay materiales activos.'));
    return out;
  }

  for (const m of activos) {
    if (!(n(m.precioKg) > 0)) {
      out.push(hallazgo('error', 'materiales', `Materiales → ${m.nombre}`,
        'Sin precio por kilo, todo lo que se cotice con este material sale sin costo de material.'));
    }
    const d = n(m.densidad);
    if (d == null || d < DENSIDAD_MIN || d > DENSIDAD_MAX) {
      out.push(hallazgo('error', 'materiales', `Materiales → ${m.nombre}`,
        `La densidad (${m.densidad}) no es la de un metal. El acero es 7,85 y el aluminio 2,70 g/cm³. ` +
        'De acá sale el peso, y del peso sale el precio del material.'));
    }
    if (!m.espesores?.length) {
      out.push(hallazgo('aviso', 'materiales', `Materiales → ${m.nombre}`,
        'No tiene espesores cargados: no se puede elegir en el cotizador.'));
    }
  }

  // Coherencia entre materiales: el inoxidable siempre sale más que el acero
  // al carbono. Si está al revés, alguien confundió dos filas.
  const acero = activos.find((m) => /acero|sae|f24/i.test(m.id + m.nombre) && !/inox/i.test(m.id + m.nombre));
  const inox = activos.find((m) => /inox/i.test(m.id + m.nombre));
  if (acero && inox && n(acero.precioKg) > 0 && n(inox.precioKg) > 0 && inox.precioKg <= acero.precioKg) {
    out.push(hallazgo('aviso', 'materiales', 'Materiales',
      `El inoxidable (${inox.precioKg}/kg) no puede costar menos que el acero al carbono ` +
      `(${acero.precioKg}/kg). Revisá si no se cruzaron los precios.`));
  }

  return out;
}

function revisarProduccion(cfg) {
  const out = [];
  const p = cfg.produccion || {};
  const g = p.gases || {};

  /* No se compara N2 contra O2: no hay una relación que se sostenga. El
     oxígeno va en cilindros y se consume a 1-3 m³/h; el nitrógeno se compra
     líquido a granel y se consume a 25-95. Que el O2 salga el triple por m³
     es normal — lo que encarece el inoxidable es el CAUDAL, no el precio
     unitario. La única relación firme es la del aire. */
  if (n(g.AIRE) > 0 && n(g.N2) > 0 && g.AIRE > g.N2) {
    out.push(hallazgo('aviso', 'produccion', 'Configuración → Gases',
      'El aire comprimido figura más caro que el nitrógeno. El aire lo genera el compresor: ' +
      'debería ser el más barato de los tres.'));
  }

  if (n(p.separacionPiezas) != null && p.separacionPiezas <= 0) {
    out.push(hallazgo('error', 'produccion', 'Configuración → Producción',
      'La separación entre piezas es cero: el nesting las pegaría y no se pueden cortar.'));
  }

  return out;
}

/* ------------------------------------------------------------------ */

/**
 * Revisa toda la configuración cargada y devuelve los problemas encontrados,
 * ordenados por gravedad.
 *
 * @returns {{ hallazgos: Array, errores: number, avisos: number, ok: boolean }}
 */
export function revisarDatos({ config, maquinas, materiales } = {}) {
  const cfg = config || {};
  const estructura = calcularEstructura(cfg.estructura);

  const hallazgos = [
    ...revisarComercial(cfg),
    ...revisarEstructura(cfg),
    ...revisarMaquinas(maquinas, estructura),
    ...revisarMateriales(materiales),
    ...revisarProduccion(cfg),
  ];

  const orden = { error: 0, aviso: 1, info: 2 };
  hallazgos.sort((a, b) => (orden[a.nivel] ?? 3) - (orden[b.nivel] ?? 3));

  const errores = hallazgos.filter((h) => h.nivel === 'error').length;
  const avisos = hallazgos.filter((h) => h.nivel === 'aviso').length;
  return { hallazgos, errores, avisos, ok: hallazgos.length === 0 };
}
