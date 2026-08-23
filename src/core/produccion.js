/** Estado de taller y fotografía inmutable del plan vendido. */
const copiar = (valor) => valor == null ? valor : JSON.parse(JSON.stringify(valor));

export function crearPlanProduccion(cotizacion, itemsOriginales = []) {
  const programas = new Map();
  const operaciones = [];
  for (let indice = 0; indice < (cotizacion?.items || []).length; indice++) {
    const r = cotizacion.items[indice];
    if (!r || r.error) continue;
    const original = itemsOriginales[indice] || {};
    const n = r.nesting;
    const procesoCorte = r.costos?.proceso === 'guillotina' ? 'guillotina' : 'laser';
    operaciones.push({
      itemIndice: indice, nombre: r.nombre || original.nombre || `Pieza ${indice + 1}`,
      cantidad: r.cantidad, corte: procesoCorte,
      gas: procesoCorte === 'laser' ? (r.corte?.gasTipo || r.gas || null) : null,
      segundosCorte: procesoCorte === 'guillotina'
        ? (r.costos?.tPreparacion || 0) + (r.costos?.golpesGuillotina || 0)
        : (r.corte?.tTotal || 0),
      geometria: r.geometria ? { ancho:r.geometria.ancho, alto:r.geometria.alto, espesor:r.espesor } : null,
      plegado: r.plegado ? {
        pliegues: r.plegado.nPliegues || original.plegado?.pliegues || 0,
        largoPliegue: r.plegado.largoPliegue || original.plegado?.largoPliegue || 0,
        segundos: r.plegado.tTotal || 0, matrizV: r.datosPliegue?.V || original.plegado?.matrizV || null,
        fuerzaKNm: r.datosPliegue?.fuerzaKNm || null, angulo: original.plegado?.angulo || 90,
        secuencia: copiar(original.meta?.secuencia || []),
        perfil: copiar(original.meta?.perfil || null),
      } : null,
    });
    if (!n?.layout?.length || procesoCorte !== 'laser') continue;
    const clave = n.compartido ? `grupo:${n.grupo}` : `item:${indice}`;
    if (!programas.has(clave)) programas.set(clave, {
      id: clave, materialId: r.material?.id || original.materialId || '', material: r.material?.nombre || '',
      espesor: r.espesor, gas: r.corte?.gasTipo || r.gas || null, chapa: copiar(n.chapa),
      metodo: n.metodo || '', aprovechamiento: n.aprovechamiento || 0, layout: copiar(n.layout), items: [],
      retazoId: r.retazo?.id || null,
    });
    programas.get(clave).items.push({
      itemIndice: indice, idEnLayout: n.idEnLayout || 'p',
      nombre: r.nombre || original.nombre || `Pieza ${indice + 1}`, cantidad: r.cantidad,
    });
  }
  return { version: 1, creado: new Date().toISOString(), programas: [...programas.values()], operaciones };
}

const programaDe = (orden, id) => (orden?.planProduccion?.programas || []).find((p) => p.id === id);
const piezaDe = (programa, ci, pi) => programa?.layout?.[ci]?.piezas?.[pi] || null;

/** Franja rectangular intacta; el esqueleto entre piezas no se promete como stock. */
export function retazoSeguroDePrograma(programa, chapaIndice, medidas = {}, opciones = {}) {
  const layout = programa?.layout?.[Number(chapaIndice)];
  if (!layout) throw new Error('La chapa no existe en el programa guardado.');
  const w = Number(medidas.w || layout.w);
  const h = Number(medidas.h || layout.h);
  if (w + 1e-6 < layout.w || h + 1e-6 < layout.h) throw new Error('La chapa física es menor que la usada por el nesting.');
  const separacion = Math.max(0, Number(opciones.separacion ?? 5));
  const alto = Math.max(0, h - Number(layout.alturaOcupada || h) - separacion);
  const minLado = Math.max(1, Number(opciones.minLado ?? 100));
  const minAreaMM2 = Math.max(0, Number(opciones.minAreaM2 ?? 0.05) * 1e6);
  const util = w >= minLado && alto >= minLado && w * alto >= minAreaMM2;
  return { util, w, h: alto, areaM2: (w * alto) / 1e6, motivo: util ? null : 'La franja intacta es demasiado chica para volver al stock.' };
}

/** El servidor aplica y persiste una acción por transacción para no pisar otra tablet. */
export function aplicarEventoTaller(orden, evento, fecha = new Date().toISOString()) {
  if (!orden || !evento?.tipo) throw new Error('Falta la orden o el tipo de evento.');
  const siguiente = copiar(orden);
  siguiente.taller ||= { version: 1, corte: { programas: {} }, plegado: { items: {} } };
  siguiente.taller.corte ||= { programas: {} };
  siguiente.taller.corte.programas ||= {};
  siguiente.taller.plegado ||= { items: {} };
  siguiente.taller.plegado.items ||= {};
  if (evento.tipo === 'clasificar') {
    const programa = programaDe(siguiente, evento.programaId);
    if (!programa) throw new Error('El programa de corte no existe en esta OT.');
    const ci = Number(evento.chapaIndice), pi = Number(evento.piezaIndice);
    if (!Number.isInteger(ci) || !Number.isInteger(pi) || !piezaDe(programa, ci, pi)) throw new Error('La pieza no existe en el nesting guardado.');
    if (!['pendiente', 'retirada', 'rechazada'].includes(evento.estado)) throw new Error('Estado de pieza inválido.');
    const ep = siguiente.taller.corte.programas[evento.programaId] ||= { piezas: {} };
    ep.piezas ||= {};
    const clave = `${ci}:${pi}`;
    if (evento.estado === 'pendiente') delete ep.piezas[clave];
    else ep.piezas[clave] = { estado: evento.estado, fecha, operario: String(evento.operario || '').slice(0, 80), motivo: String(evento.motivo || '').slice(0, 240) };
  } else if (evento.tipo === 'confirmar-chapa') {
    const programa = programaDe(siguiente, evento.programaId);
    if (!programa) throw new Error('El programa de corte no existe en esta OT.');
    const ci = Number(evento.chapaIndice);
    if (!Number.isInteger(ci) || !programa.layout?.[ci]) throw new Error('La chapa no existe en el programa guardado.');
    if (!['chapa-nueva', 'retazo', 'cliente'].includes(evento.origen)) throw new Error('Origen de chapa inválido.');
    const ep = siguiente.taller.corte.programas[evento.programaId] ||= { piezas: {} };
    ep.chapas ||= {};
    const medidas = { w: Number(evento.w || programa.layout[ci].w), h: Number(evento.h || programa.layout[ci].h) };
    const retazo = retazoSeguroDePrograma(programa, ci, medidas, { separacion: evento.separacion });
    const existente = ep.chapas[ci];
    if (existente) {
      const repetido = existente.origen === evento.origen && existente.lote === String(evento.lote || '').slice(0, 100) &&
        existente.ubicacion === String(evento.ubicacion || '').slice(0, 100) &&
        existente.medidas.w === medidas.w && existente.medidas.h === medidas.h &&
        existente.guardarRetazo === (evento.guardarRetazo === true && retazo.util);
      if (repetido) return siguiente;
      throw new Error('Esta chapa física ya fue confirmada y no se puede reemplazar en silencio.');
    }
    ep.chapas[ci] = {
      origen: evento.origen, lote: String(evento.lote || '').slice(0, 100),
      ubicacion: String(evento.ubicacion || '').slice(0, 100), medidas,
      guardarRetazo: evento.guardarRetazo === true && retazo.util,
      retazo, fecha, operario: String(evento.operario || '').slice(0, 80),
    };
  } else if (evento.tipo === 'avance-plegado') {
    const indice = Number(evento.itemIndice);
    const op = siguiente.planProduccion?.operaciones?.find((x) => x.itemIndice === indice && x.plegado);
    if (!op) throw new Error('El item no tiene una operación de plegado guardada.');
    siguiente.taller.plegado.items[indice] = {
      ...(siguiente.taller.plegado.items[indice] || {}),
      cantidadHecha: Math.max(0, Math.min(op.cantidad, Math.round(Number(evento.cantidadHecha) || 0))),
      primeraPiezaAprobada: evento.primeraPiezaAprobada === true,
      herramientaConfirmada: evento.herramientaConfirmada === true,
      fecha, operario: String(evento.operario || '').slice(0, 80),
    };
  } else throw new Error('Tipo de evento de taller inválido.');
  siguiente.taller.actualizado = fecha;
  return siguiente;
}

export function resumenTaller(orden) {
  let total = 0, retiradas = 0, rechazadas = 0;
  for (const programa of orden?.planProduccion?.programas || []) {
    const estados = orden?.taller?.corte?.programas?.[programa.id]?.piezas || {};
    for (let ci = 0; ci < (programa.layout || []).length; ci++) {
      const piezas = programa.layout[ci]?.piezas || [];
      total += piezas.length;
      for (let pi = 0; pi < piezas.length; pi++) {
        const estado = estados[`${ci}:${pi}`]?.estado;
        if (estado === 'retirada') retiradas++;
        if (estado === 'rechazada') rechazadas++;
      }
    }
  }
  return { total, retiradas, rechazadas, pendientes: Math.max(0, total - retiradas - rechazadas), reposiciones: rechazadas };
}
