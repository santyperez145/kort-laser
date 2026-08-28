import { estimarConEncogimiento, evidenciaSuficiente } from './aprendizaje.js';

/**
 * KORT - Calibración: el sistema aprende cuánto tarda de verdad
 *
 * Todo el tiempo de máquina que cotiza este sistema es SIMULADO. Está bien
 * simulado —aceleración, look-ahead, penalización por geometría— pero nadie
 * sabe si se queda corto un 10 % o un 40 %. Y esa diferencia es plata: el
 * tiempo de máquina es el segundo componente del costo después del material.
 *
 * Acá se compara lo estimado contra lo que el taller anotó al terminar cada
 * orden, y sale un factor de corrección. Con veinte trabajos reales el
 * cotizador deja de estimar y empieza a estar calibrado contra ESTA máquina,
 * ESTE operario y ESTA forma de trabajar.
 *
 * Cuatro decisiones que hacen que esto sirva en un taller y no sólo en teoría:
 *
 * 1. **Mediana, no promedio.** Un trabajo donde el operario paró a almorzar
 *    con el cronómetro corriendo arrastra el promedio y no mueve la mediana.
 *    Los datos de taller vienen así: la mayoría buenos y algunos absurdos.
 *
 * 2. **No se aplica nada hasta tener suficientes trabajos.** Con tres
 *    mediciones no hay un factor, hay ruido. Corregir con ruido es peor que
 *    no corregir, porque da confianza falsa.
 *
 * 3. **Lo imposible se descarta y se cuenta.** Un ratio de 200 es alguien que
 *    escribió minutos donde iban horas. Se saca de la cuenta pero se informa,
 *    porque si se descarta la mitad de lo cargado hay que revisar cómo se
 *    está midiendo.
 *
 * 4. **Nunca corrige en silencio.** El resultado dice de dónde salió el
 *    factor y con cuántos trabajos. Un precio que cambió sin que se pueda
 *    explicar por qué es exactamente lo que este sistema no hace.
 */

/** Debajo de esto no se corrige nada: no alcanza para distinguir señal de ruido. */
export const MINIMO_TRABAJOS = 5;

/** Con menos de esto el factor se informa pero se marca como provisorio. */
export const TRABAJOS_CONFIABLE = 15;

/**
 * Fuera de esta banda no es una medición, es un error de carga. Un trabajo
 * puede tardar el triple de lo estimado (chapa fea, operario nuevo, la máquina
 * cortando mal) pero no cincuenta veces.
 */
export const RANGO_CREIBLE = [0.2, 5];

/**
 * Bandas de espesor. El corte se comporta muy distinto en chapa fina que en
 * gruesa, pero separar por espesor exacto fragmentaría las muestras hasta que
 * ninguna banda llegue al mínimo.
 */
export const BANDAS = [
  { id: 'fina', hasta: 3, txt: 'hasta 3 mm' },
  { id: 'media', hasta: 8, txt: '3 a 8 mm' },
  { id: 'gruesa', hasta: Infinity, txt: 'más de 8 mm' },
];

export function bandaDe(espesor) {
  const t = Number(espesor) || 0;
  return BANDAS.find((b) => t <= b.hasta) || BANDAS[BANDAS.length - 1];
}

const claveGrupo = (materialId, espesor) => `${materialId}|${bandaDe(espesor).id}`;

function mediana(valores) {
  if (!valores.length) return null;
  const v = [...valores].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/**
 * Desviación absoluta mediana, en proporción a la mediana.
 *
 * Se usa en vez del desvío estándar por lo mismo que la mediana en vez del
 * promedio: un solo valor absurdo dispara el desvío estándar y deja la
 * dispersión sin significado.
 */
function dispersion(valores, med) {
  if (!valores.length || !med) return null;
  const desvios = valores.map((v) => Math.abs(v - med));
  return mediana(desvios) / med;
}

/**
 * Convierte las órdenes terminadas en muestras comparables.
 *
 * Una orden sirve si tiene tiempo real anotado y tiempo estimado guardado.
 * Se le asigna material y banda de espesor **sólo si todos sus ítems
 * comparten los dos**: si la orden mezcla acero de 2 mm con inoxidable de 10,
 * atribuirle el tiempo a uno de los dos sería inventar. Esas órdenes siguen
 * contando para el factor global, que es lo honesto.
 */
export function muestrasDe(ordenes = []) {
  const muestras = [];
  const descartadas = [];

  for (const o of ordenes) {
    const real = Number(o?.real?.segundos);
    const estimado = Number(o?.resumen?.tiempoProduccion);
    if (!(real > 0) || !(estimado > 0)) continue;

    const ratio = real / estimado;
    const muestra = {
      id: o.id,
      numero: o.numero,
      fecha: o.real?.fecha || o.modificado || null,
      real,
      estimado,
      ratio,
    };

    if (ratio < RANGO_CREIBLE[0] || ratio > RANGO_CREIBLE[1]) {
      descartadas.push({ ...muestra, motivo: 'fuera de rango creíble' });
      continue;
    }

    const items = o.items || [];
    const materiales = new Set(items.map((i) => i.materialId).filter(Boolean));
    const bandas = new Set(items.map((i) => bandaDe(i.espesor).id));
    if (materiales.size === 1 && bandas.size === 1) {
      muestra.materialId = [...materiales][0];
      muestra.banda = [...bandas][0];
      muestra.grupo = `${muestra.materialId}|${muestra.banda}`;
    }

    muestras.push(muestra);
  }

  return { muestras, descartadas };
}

function resumirGrupo(ratios) {
  const factor = mediana(ratios);
  const disp = dispersion(ratios, factor);
  return {
    factor,
    n: ratios.length,
    dispersion: disp,
    // "Confiable" es tener suficientes trabajos Y que no estén desparramados.
    // Quince mediciones que van de 0,5 a 3 no calibran nada.
    confiable: ratios.length >= TRABAJOS_CONFIABLE && disp != null && disp <= 0.25,
    suficiente: ratios.length >= MINIMO_TRABAJOS,
  };
}

/**
 * Calibración completa a partir de las órdenes del taller.
 *
 * @returns {{ global: Object, grupos: Object, muestras: Array, descartadas: Array, activa: boolean }}
 */
export function calibrar(ordenes = []) {
  const { muestras, descartadas } = muestrasDe(ordenes);

  const global = resumirGrupo(muestras.map((m) => m.ratio));

  const porGrupo = {};
  for (const m of muestras) {
    if (!m.grupo) continue;
    (porGrupo[m.grupo] ||= []).push(m.ratio);
  }
  const grupos = {};
  for (const [clave, ratios] of Object.entries(porGrupo)) {
    if (ratios.length < MINIMO_TRABAJOS) continue; // no alcanza para este grupo
    const [materialId, banda] = clave.split('|');
    grupos[clave] = { ...resumirGrupo(ratios), materialId, banda };
  }

  /* Los ratios crudos por nivel, que es lo que necesita el estimador
     jerárquico. Se guardan aparte de `grupos` para no tocar el contrato que
     ya consumen las pantallas.

     La banda de espesor sola es un nivel que antes no existía y es el que más
     falta hacía: el comportamiento del corte lo domina el espesor mucho más
     que el material, así que un trabajo de inoxidable de 2 mm dice bastante
     sobre uno de acero de 2 mm — y no decía nada. */
  const ratiosPorBanda = {};
  const ratiosPorGrupo = {};
  for (const m of muestras) {
    if (m.banda) (ratiosPorBanda[m.banda] ||= []).push(m.ratio);
    if (m.grupo) (ratiosPorGrupo[m.grupo] ||= []).push(m.ratio);
  }

  return {
    global,
    grupos,
    ratios: { todo: muestras.map((m) => m.ratio), banda: ratiosPorBanda, grupo: ratiosPorGrupo },
    muestras,
    descartadas,
    // Mientras no haya suficientes trabajos NO se corrige nada. Es la
    // diferencia entre calibrar y adivinar con más pasos.
    activa: global.suficiente,
  };
}

/**
 * Qué factor le corresponde a un corte concreto.
 *
 * Prefiere el grupo (material + banda de espesor) porque es más específico, y
 * cae al global cuando ese grupo todavía no juntó suficientes trabajos.
 *
 * @returns {{ factor: number, origen: 'grupo'|'global'|'ninguno', n: number, detalle: string }}
 */
export function factorPara(calibracion, materialId, espesor) {
  const sinCorregir = { factor: 1, origen: 'ninguno', n: 0, detalle: 'sin calibrar' };
  if (!calibracion?.activa) return sinCorregir;

  const banda = bandaDe(espesor);
  const r = calibracion.ratios;

  /* Encogimiento jerárquico en vez del umbral duro que había antes.
     1,0 → taller → banda de espesor → material+banda, cada nivel confiando en
     su propia medición en proporción a la evidencia que tiene.

     Lo que se gana: el quinto trabajo de un grupo ya no cambia el precio de
     golpe, y el primero ya aporta algo en lugar de nada. Detalle en
     `aprendizaje.js`. */
  const est = r
    ? estimarConEncogimiento([
        { id: 'taller', valores: r.todo || [] },
        { id: `banda:${banda.id}`, valores: r.banda?.[banda.id] || [] },
        { id: `grupo:${materialId}|${banda.id}`, valores: r.grupo?.[claveGrupo(materialId, espesor)] || [] },
      ])
    : null;

  if (!est || !evidenciaSuficiente(est)) {
    // Se mantiene el piso: sin evidencia suficiente no se corrige. Un factor
    // con dos mediciones da confianza falsa, que es peor que no corregir.
    const gl = calibracion.global;
    if (!gl?.suficiente) return sinCorregir;
    return {
      factor: gl.factor, origen: 'global', n: gl.n, confiable: gl.confiable,
      detalle: `${gl.n} trabajos medidos en el taller`,
    };
  }

  const principal = [...est.composicion].sort((a, b) => b.peso - a.peso)[0];
  const origen = principal.id.startsWith('grupo:') ? 'grupo'
    : principal.id.startsWith('banda:') ? 'banda'
    : principal.id === 'taller' ? 'global' : 'ninguno';

  const nombre = origen === 'grupo' ? `${materialId} ${banda.txt}`
    : origen === 'banda' ? `chapa ${banda.txt}`
    : 'el taller';

  return {
    factor: est.valor,
    origen,
    n: principal.n,
    confiable: est.evidencia >= TRABAJOS_CONFIABLE,
    detalle: `${principal.n} trabajos de ${nombre}`,
    // Para poder explicar el número exacto, no sólo el nivel que más pesó.
    composicion: est.composicion,
    evidencia: est.evidencia,
  };
}

/**
 * Texto para mostrarle a quien cotiza. Sin esto el factor sería un número que
 * cambia el precio y no se puede explicar.
 */
export function explicarFactor(f) {
  if (!f || f.origen === 'ninguno') return null;
  const pct = Math.round(Math.abs(f.factor - 1) * 100);
  if (pct < 1) return `Confirmado por ${f.detalle}: la estimación da igual que la realidad.`;
  const direccion = f.factor > 1 ? 'más' : 'menos';
  return (
    `Corregido con ${f.detalle}: en la práctica se tarda ${pct} % ${direccion} ` +
    `que lo que estima el modelo.` + (f.confiable ? '' : ' Todavía con pocos datos.')
  );
}
