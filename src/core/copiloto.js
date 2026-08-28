/**
 * KORT · Copiloto: qué conviene hacer hoy, y por qué
 *
 * El sistema ya sabe muchas cosas sueltas —qué precio quedó viejo, qué orden
 * se va a atrasar, qué trabajo deja poco por hora, qué dato está mal cargado—
 * pero cada una vive en su pantalla. Quien abre el panel a la mañana tiene que
 * recorrer siete lugares para armarse la lista, y no la arma.
 *
 * Esto la arma. No es un chat ni un generador de texto: es un razonador sobre
 * el estado medido del taller, y cada renglón sale de un módulo que ya calcula
 * ese número.
 *
 * ── Las cuatro reglas que lo hacen confiable ───────────────────────────────
 *
 * 1. **Cada recomendación trae su evidencia.** `porque` no es una frase de
 *    color: dice el número del que salió y de dónde se midió. Una sugerencia
 *    que no se puede auditar es una opinión, y las opiniones no mueven precios
 *    en un taller.
 *
 * 2. **Se ordena por impacto, no por tema.** Agrupar por área hace que todo
 *    parezca igual de urgente. Lo primero de la lista tiene que ser lo que más
 *    cuesta no hacer.
 *
 * 3. **El impacto en pesos sólo se informa cuando se puede calcular.** Cuando
 *    no, se dice que no está cuantificado en vez de inventar un número. Un
 *    peso falso al lado de uno verdadero contamina los dos.
 *
 * 4. **Con el taller vacío no se inventan hallazgos.** Un sistema recién
 *    instalado no tiene problemas de cartera: tiene que empezar a medir. Decir
 *    otra cosa sería ruido con formato de diagnóstico.
 *
 * ── Lo que NO hace ─────────────────────────────────────────────────────────
 *
 * No decide por nadie: no cambia un precio, no manda un mail, no reprograma
 * una orden. Ordena y explica; ejecutar es de quien conoce a su cliente.
 */

import { revisarDatos } from './salud.js';
import { frescuraDePrecios, explicarFrescura } from './frescura.js';
import { baseQueSeMovio, impactoMaterialRapido, ESTADOS_VIVOS } from './vigencia.js';
import { agendaProduccion } from './agenda.js';
import { evaluarTrabajo } from './rentabilidad.js';
import { revisarCabezal } from './optica.js';
import { entrenar as entrenarModelo } from './modelo-corte.js';
import { evidenciaSuficiente } from './aprendizaje.js';

const n = (v, d = 0) => (typeof v === 'number' && isFinite(v) ? v : d);

/**
 * Peso de cada urgencia al ordenar. No es una escala de gravedad abstracta:
 * es cuánto cuesta NO hacerlo.
 *
 * `plata` va primero porque es dinero que se pierde hoy y de forma silenciosa
 * —un presupuesto por debajo del costo se honra sin que nadie se entere—.
 * `promesa` después: un atraso cuesta un cliente, que se nota más tarde pero
 * duele más. `dato` va tercero aunque parezca menor, porque un dato mal
 * cargado envenena todos los precios a la vez.
 */
const PESO = { plata: 1000, promesa: 700, dato: 500, medir: 200, oportunidad: 100 };

function sugerencia(tipo, titulo, porque, opts = {}) {
  return {
    tipo,
    titulo,
    porque,
    accion: opts.accion || null,
    ruta: opts.ruta || null,
    // null significa "no se puede calcular", NUNCA cero. Cero es "no cuesta
    // nada", que es una afirmación distinta y casi siempre falsa.
    impactoPesos: typeof opts.impactoPesos === 'number' ? opts.impactoPesos : null,
    prioridad: (PESO[tipo] || 0) + n(opts.extra),
  };
}

/* ------------------------------------------------------------------ */

function porLaPlata({ presupuestos, materiales, baseHoy }) {
  const out = [];
  const vivos = (presupuestos || []).filter((p) => ESTADOS_VIVOS.includes(p?.estado || 'borrador'));
  if (!vivos.length) return out;

  let enRojo = 0;
  let monto = 0;
  for (const p of vivos) {
    const i = impactoMaterialRapido(p, materiales);
    if (i?.enRojo) {
      enRojo++;
      monto += Math.abs(i.utilidadEstimadaHoy || 0);
    }
  }
  if (enRojo) {
    out.push(sugerencia(
      'plata',
      `${enRojo} presupuesto${enRojo === 1 ? '' : 's'} quedó por debajo del costo`,
      `El material subió desde que se cotizaron. Sostenerlos cuesta ${Math.round(monto)} de bolsillo.`,
      { accion: 'Reabrilos y recotizá antes de que alguien los acepte', ruta: '/presupuestos', impactoPesos: monto, extra: enRojo }
    ));
  }

  if (baseHoy) {
    const cambiados = vivos.filter((p) => baseQueSeMovio(p._baseCosto, baseHoy)).length;
    if (cambiados) {
      out.push(sugerencia(
        'plata',
        `${cambiados} se cotizó con otra base de cálculo`,
        'Cambió el setup, el aprovechamiento, el margen o el costo por hora. El precio de material ' +
        'puede no haberse movido y el presupuesto estar viejo igual.',
        { accion: 'Abrilos: el precio se recalcula solo con lo de hoy', ruta: '/presupuestos', extra: cambiados }
      ));
    }
  }
  return out;
}

function porLasPromesas({ ordenes, config }) {
  const out = [];
  if (!ordenes?.length || !config) return out;

  const ag = agendaProduccion(ordenes, config);
  if (ag.vencidas) {
    out.push(sugerencia(
      'promesa',
      `${ag.vencidas} orden${ag.vencidas === 1 ? '' : 'es'} con la fecha ya vencida`,
      'La fecha comprometida pasó y el trabajo sigue abierto.',
      { accion: 'Llamá al cliente antes de que llame él', ruta: '/produccion', extra: ag.vencidas * 10 }
    ));
  }
  const soloAtrasadas = ag.atrasadas - ag.vencidas;
  if (soloAtrasadas > 0) {
    out.push(sugerencia(
      'promesa',
      `${soloAtrasadas} no entra${soloAtrasadas === 1 ? '' : 'n'} en la carga real de máquina`,
      `Hay ${Math.round(ag.horasComprometidas)} h comprometidas a ${ag.capacidadDiariaHoras.toFixed(1)} h ` +
      'por día: la fecha prometida no cierra contra lo que la máquina puede hacer.',
      { accion: 'Repriorizá o corré la fecha ahora, no la semana que viene', ruta: '/produccion', extra: soloAtrasadas * 5 }
    ));
  }
  if (ag.sinEstimacion) {
    out.push(sugerencia(
      'dato',
      `${ag.sinEstimacion} orden${ag.sinEstimacion === 1 ? '' : 'es'} abierta${ag.sinEstimacion === 1 ? '' : 's'} sin tiempo estimado`,
      'No aportan carga a la agenda, así que toda fecha que se prometa queda corta por ellas.',
      { accion: 'Cargales el tiempo o cerralas', ruta: '/produccion' }
    ));
  }
  return out;
}

function porLosDatos({ config, maquinas, materiales, historialPrecios }) {
  const out = [];
  if (!config) return out;

  const rev = revisarDatos({ config, maquinas, materiales, historialPrecios });
  for (const h of rev.hallazgos) {
    out.push(sugerencia(
      'dato',
      h.msg.split('.')[0].slice(0, 90),
      `${h.donde}. ${h.msg}`,
      {
        accion: h.arreglo ? 'Se puede aplicar el valor de referencia desde el panel' : 'Revisalo en su pantalla',
        ruta: '/',
        // Un error envenena los precios más que un aviso.
        extra: h.nivel === 'error' ? 300 : 0,
      }
    ));
  }

  /* Auditoría física de las tablas de proceso. No mira si un número está
     fuera de un rango arbitrario: ajusta el balance de energía del corte a
     cada curva y comprueba que los parámetros recuperados —cómo cae el
     acoplamiento con el espesor, cuánta energía entra al metal— sean posibles
     para ESE metal. Una tabla mal cargada da precios mal en silencio. */
  const modelo = entrenarModelo(materiales);
  for (const d of modelo.dudosos) {
    out.push(sugerencia(
      'dato',
      `La tabla de ${d.materialId} con ${d.gas} no cierra con la física del corte`,
      `${d.fisica.motivo}. Ajustado sobre ${d.puntos} espesores (R² ${d.r2?.toFixed(3)}), ` +
      'todos los precios de ese material salen de esa curva.',
      { accion: 'Contrastá esos espesores contra la tabla del fabricante', ruta: '/materiales', extra: 100 }
    ));
  }

  const laser = (maquinas || []).find((m) => m.tipo === 'laser');
  if (laser) {
    for (const a of revisarCabezal(laser, materiales)) {
      out.push(sugerencia('dato', 'El cabezal no llega a lo que pide un proceso', a.msg, {
        accion: 'Bajá el espesor máximo de ese proceso o cambiá la boquilla',
        ruta: '/materiales',
      }));
    }
  }
  return out;
}

function porLoQueFaltaMedir({ maquinas, calibracion, telemetria, materiales, historialPrecios }) {
  const out = [];

  const laser = (maquinas || []).find((m) => m.tipo === 'laser');
  const op = laser?.optica || {};
  if (laser && !(n(op.nucleoFibraUM) > 0 && n(op.colimadorMM) > 0 && n(op.focoMM) > 0)) {
    out.push(sugerencia(
      'medir',
      'Falta la óptica de la fuente y el cabezal',
      'Sin el núcleo de la fibra, el colimador y el foco no se puede calcular el punto focal, ' +
      'y sin punto focal la sangría es una estimación genérica en vez de la de esta máquina.',
      { accion: 'Los tres están en la hoja de datos de la fuente y el manual del cabezal', ruta: '/maquinas' }
    ));
  }

  if (!calibracion?.activa) {
    out.push(sugerencia(
      'medir',
      'El cotizador todavía estima el tiempo, no lo tiene medido',
      'Todo el tiempo de máquina que se cotiza es simulado. Anotando el tiempo real al cerrar ' +
      'cada orden, el sistema aprende cuánto tarda de verdad ESTA máquina.',
      { accion: 'Anotá el tiempo real al cerrar las órdenes', ruta: '/produccion' }
    ));
  }

  if (telemetria && !telemetria.conectada) {
    out.push(sugerencia(
      'medir',
      'La máquina no está informando nada',
      'Sin telemetría el tiempo real se carga a mano, y lo que se carga a mano se carga tarde o no se carga.',
      { accion: 'Conectá la pasarela: npm run puente-maquina', ruta: '/maquina-en-vivo' }
    ));
  }

  const f = frescuraDePrecios(materiales, historialPrecios);
  const e = explicarFrescura(f);
  if (e) {
    out.push(sugerencia('dato', 'Hay precios de material sin actualizar', e.msg, {
      accion: 'Pedile la lista al proveedor y actualizalos',
      ruta: '/materiales',
    }));
  }
  return out;
}

function porOportunidad({ presupuestos, config }) {
  const out = [];
  const vivos = (presupuestos || []).filter((p) => ESTADOS_VIVOS.includes(p?.estado || 'borrador'));
  if (!vivos.length) return out;

  /* La vara sale del historial de trabajos APROBADOS del propio taller, o del
     piso de la estructura si todavía no hay historial. `evaluarTrabajo` ya
     resuelve cuál usar y devuelve null cuando no puede: acá no se inventa una
     referencia. */
  const contexto = { presupuestos, estructura: config?.estructura || null };
  const evaluados = vivos
    .map((p) => ({ p, ev: evaluarTrabajo({ resumen: p.resumen, items: [] }, contexto) }))
    .filter((x) => x.ev);

  const bajoElPiso = evaluados.filter((x) => x.ev.nivel === 'error');
  if (bajoElPiso.length) {
    out.push(sugerencia(
      'plata',
      `${bajoElPiso.length} presupuesto${bajoElPiso.length === 1 ? '' : 's'} no paga ni los gastos fijos que ocupa`,
      bajoElPiso[0].ev.mensaje,
      { accion: 'Recotizalos o dejalos ir: ocupan máquina y no la pagan', ruta: '/presupuestos', extra: bajoElPiso.length * 20 }
    ));
  }

  const flojos = evaluados.filter((x) => x.ev.nivel === 'aviso');
  if (flojos.length) {
    out.push(sugerencia(
      'oportunidad',
      `${flojos.length} rinde${flojos.length === 1 ? '' : 'n'} menos por hora que lo habitual del taller`,
      flojos[0].ev.mensaje,
      { accion: 'Si entran todos juntos, priorizá los otros', ruta: '/presupuestos' }
    ));
  }
  return out;
}

/* ------------------------------------------------------------------ */

/**
 * @param {Object} estado  todo lo que el copiloto puede mirar. Lo que falte se
 *   omite en silencio: no tener órdenes no es un hallazgo, es un taller nuevo.
 *
 * @returns {{ sugerencias, arranque, hay }}
 *   `arranque` es true cuando el taller todavía no tiene con qué operar. Ahí
 *   la lista es de qué cargar, no de qué está mal.
 */
export function copiloto(estado = {}) {
  const {
    config, maquinas = [], materiales = [], presupuestos = [], ordenes = [],
    historialPrecios = [], calibracion = null, telemetria = null, baseHoy = null,
  } = estado;

  const sugerencias = [
    ...porLaPlata({ presupuestos, materiales, baseHoy }),
    ...porLasPromesas({ ordenes, config }),
    ...porLosDatos({ config, maquinas, materiales, historialPrecios }),
    ...porLoQueFaltaMedir({ maquinas, calibracion, telemetria, materiales, historialPrecios }),
    ...porOportunidad({ presupuestos, config }),
  ].sort((a, b) => b.prioridad - a.prioridad);

  return {
    sugerencias,
    /* Taller recién instalado: sin presupuestos ni órdenes no hay cartera en
       riesgo ni promesas que romper, y presentar hallazgos ahí sería ruido con
       formato de diagnóstico. */
    arranque: presupuestos.length === 0 && ordenes.length === 0,
    hay: sugerencias.length,
  };
}

/**
 * Una línea para el encabezado del panel.
 *
 * Deliberadamente no dice "todo bien" cuando lo único cierto es que no hay
 * nada cargado: son dos estados distintos y confundirlos es lo que hace que
 * un tablero deje de creerse.
 */
export function resumenCopiloto(r, calibracion = null) {
  if (!r) return null;
  if (!r.hay) {
    return r.arranque
      ? 'Todavía no hay con qué operar: cargá materiales, máquina y el primer presupuesto.'
      : 'Nada urgente hoy.';
  }
  const primera = r.sugerencias[0];
  const conPlata = r.sugerencias.filter((s) => s.impactoPesos != null);
  const total = conPlata.reduce((s, x) => s + x.impactoPesos, 0);

  /* Sólo se menciona la calibración si NO está ya en la lista: repetir el
     mismo hecho en el encabezado y en el primer renglón hace que el tablero se
     lea como si tuviera el doble de problemas. */
  const yaEnLista = r.sugerencias.some((s) => /estima el tiempo/.test(s.titulo));
  const aprendiendo = calibracion?.activa && evidenciaSuficiente({ evidencia: calibracion.global?.n || 0 });

  return (
    `${r.hay} cosa${r.hay === 1 ? '' : 's'} para mirar. La primera: ${primera.titulo.toLowerCase()}.` +
    (total > 0 ? ` Hay ${Math.round(total)} en juego.` : '') +
    (aprendiendo || yaEnLista ? '' : ' El cotizador todavía estima el tiempo en vez de tenerlo medido.')
  );
}
