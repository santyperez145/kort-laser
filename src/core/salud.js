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
import { revisarConsumiblesHora } from './consumibles.js';

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
  } else if (aprov != null && aprov > 0.85) {
    /* Este número decide cuándo se cobra chapa entera y cuándo sólo el área
       consumida. Un nesting real de piezas variadas da 60-75 %; pedirle 85 %
       o más es un umbral que casi nunca se alcanza, así que el sistema cobra
       siempre por área y el retazo que queda en el piso no lo paga nadie. En
       chapa fina el material es el grueso del costo: subfacturarlo ahí es de
       lo más caro que puede pasar. */
    out.push(hallazgo('aviso', 'comercial', 'Configuración → Comercial',
      `El aprovechamiento objetivo está en ${Math.round(aprov * 100)} %. Un nesting real de ` +
      'piezas variadas da 60-75 %, así que ese umbral casi nunca se alcanza y el sistema ' +
      'termina cobrando siempre por área consumida: el retazo que queda no lo paga nadie. ' +
      'Con 0,75-0,80 se cobra chapa entera cuando de verdad se llenó.'));
  }

  return out;
}

/**
 * El mínimo por ítem tiene que cubrir, como piso, lo que cuesta poner la
 * máquina en marcha una vez.
 *
 * No es una opinión comercial: es aritmética. Un trabajo de una sola pieza son
 * minutos de programa y carga de chapa que se pagan igual, aunque el corte
 * dure diez segundos. Si el mínimo queda por debajo de eso, cada trabajo chico
 * que entra sale a pérdida — y los trabajos chicos son la mayoría.
 */
function revisarMinimos(cfg, maquinas, estructura) {
  const out = [];
  const c = cfg.comercial || {};
  const laser = (maquinas || []).find((m) => m.tipo === 'laser');
  const minItem = n(c.minimoPorItem);
  if (!laser || minItem == null) return out;

  const ch = calcularCostoHoraMaquina(laser, estructura);
  const setup = n(laser.tiempoSetupPrograma) ?? 0;
  const carga = n(laser.tiempoCargaChapa) ?? 0;
  const seg = setup + carga;

  /* Puesta a punto en cero no existe: alguien tiene que armar el programa y
     alguien tiene que subir la chapa a la mesa. Con estos campos vacíos el
     sistema cobra los segundos de corte y nada más, así que TODO trabajo de
     pocas piezas sale por debajo del costo. Es el error más caro que se puede
     tener cargado, porque no se nota: los precios simplemente salen baratos y
     el taller cree que es competitivo. */
  if (setup <= 0 || carga <= 0) {
    const cuales = [
      setup <= 0 ? 'el setup del programa' : null,
      carga <= 0 ? 'la carga de chapa' : null,
    ].filter(Boolean).join(' y ');
    out.push(hallazgo('error', 'maquinas', `Máquinas → ${laser.nombre || laser.id}`,
      `Está en cero ${cuales}. Nadie prepara un programa ni sube una chapa en cero segundos: ` +
      'así, cada trabajo de pocas piezas se cotiza por debajo del costo y no se nota, porque ' +
      'los precios simplemente salen baratos. Valores de referencia: 180 s de setup y 90 s de ' +
      'carga por chapa sin cambiador de palet.'));
    return out;
  }

  if (!(ch.total > 0)) return out;

  const costoArranque = (seg / 3600) * ch.total;
  if (minItem < costoArranque) {
    out.push(hallazgo('aviso', 'comercial', 'Configuración → Comercial',
      `El mínimo por ítem (${Math.round(minItem)}) no cubre ni la puesta a punto, que sola ` +
      `cuesta ${Math.round(costoArranque)} de máquina. Cada trabajo de pocas piezas que ` +
      'entre sale a pérdida.'));
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
    const donde = `Máquinas → ${m.nombre || m.id}`;

    /* Contra una lista de piezas reales, no contra una proporción. Es un
       chequeo distinto del de dominancia y atrapa un caso que aquél no ve: si
       alguien infla consumibles Y mantenimiento a la vez, ninguno pasa del
       50 % del total pero los dos están mal. Sólo aplica al láser: la
       plegadora no tiene lentes ni boquillas. */
    const aConsumibles = m.tipo === 'laser' ? revisarConsumiblesHora(m.costo?.consumiblesHora) : null;
    if (aConsumibles) out.push(hallazgo(aConsumibles.nivel, 'maquinas', donde, aConsumibles.msg));

    /* Dominancia dentro de la hora de máquina. Si el chequeo contra la lista
       ya se quejó de los consumibles, no se repite: un mismo campo mal
       cargado tiene que dar UN mensaje, y gana el que dice qué hacer
       ("¿no pusiste un mensual donde va un valor por hora?") sobre el que
       sólo informa un porcentaje. Dos avisos para un problema se leen como
       ruido y enseñan a saltearlos. */
    for (const a of revisarCostoHora(m, estructura)) {
      if (aConsumibles && a.componente === 'consumibles') continue;
      out.push(hallazgo(a.nivel, 'maquinas', donde, a.msg));
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

  /* Coherencia entre materiales.
   *
   * Los valores absolutos se mueven todo el tiempo con la inflación, pero el
   * ORDEN entre metales no: cada escalón agrega proceso o aleación y eso no se
   * abarata. Un precio que rompe el orden es casi siempre una fila cargada en
   * el renglón equivocado.
   *
   * Sólo se comparan pares donde la relación es física e indiscutible. El
   * F-24 laminado en caliente contra el SAE 1010 en frío NO está acá: en
   * teoría el caliente sale menos, pero comprando poco volumen pueden salir
   * iguales, y avisar de algo que puede ser correcto enseña a ignorar avisos. */
  const porId = (re) => activos.find((m) => re.test(m.id));
  const acero = porId(/^acero-sae1010/) || porId(/^acero/);
  const galva = porId(/galvaniz/);
  const inox = porId(/^inox/);

  const comparar = (menor, mayor, razon) => {
    if (!menor || !mayor) return;
    if (!(n(menor.precioKg) > 0) || !(n(mayor.precioKg) > 0)) return;
    if (mayor.precioKg > menor.precioKg) return;
    out.push(hallazgo('aviso', 'materiales', `Materiales → ${mayor.nombre}`,
      `${mayor.nombre} (${mayor.precioKg}/kg) no puede salir menos que ${menor.nombre} ` +
      `(${menor.precioKg}/kg): ${razon}. Revisá si no se cargó en el renglón equivocado.`));
  };

  comparar(acero, galva, 'es la misma chapa más el zincado');
  comparar(galva, inox, 'el inoxidable lleva cromo y níquel');
  comparar(acero, inox, 'el inoxidable lleva cromo y níquel');

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
    ...revisarMinimos(cfg, maquinas, estructura),
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
