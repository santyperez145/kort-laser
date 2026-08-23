/** Calidad dimensional y no conformidades. No presupone tolerancias: vienen del plano. */
const copiar = (valor) => valor == null ? valor : JSON.parse(JSON.stringify(valor));

export const CAUSAS_NO_CONFORMIDAD = [
  ['dimension', 'Dimensión fuera de tolerancia'], ['rebaba', 'Rebaba o canto'],
  ['deformacion', 'Deformación térmica'], ['perforacion', 'Perforación defectuosa'],
  ['rayado', 'Rayado superficial'], ['material', 'Material o espesor incorrecto'],
  ['angulo', 'Ángulo de plegado'], ['cota-plegado', 'Cota después del plegado'], ['otro', 'Otro'],
];
export const ACCIONES_NO_CONFORMIDAD = [
  ['recortar', 'Recortar pieza'], ['retrabajar', 'Retrabajar'],
  ['aceptar', 'Aceptar con autorización'], ['descartar', 'Descartar'], ['investigar', 'Investigar causa'],
];

const numeroFinito = (valor, nombre) => {
  const n = Number(valor);
  if (!Number.isFinite(n)) throw new Error(`${nombre} debe ser un número.`);
  return n;
};

export function evaluarMedicion({ nominal, toleranciaMas, toleranciaMenos, valor }) {
  const n = numeroFinito(nominal, 'El nominal');
  const v = numeroFinito(valor, 'La medición');
  const mas = numeroFinito(toleranciaMas, 'La tolerancia superior');
  const menos = numeroFinito(toleranciaMenos, 'La tolerancia inferior');
  if (mas < 0 || menos < 0) throw new Error('Las tolerancias se cargan como magnitudes positivas.');
  const minimo = n - menos, maximo = n + mas;
  return { nominal:n, valor:v, toleranciaMas:mas, toleranciaMenos:menos, minimo, maximo,
    desviacion:v - n, estado:v >= minimo - 1e-9 && v <= maximo + 1e-9 ? 'conforme' : 'fuera' };
}

const operacionDe = (orden, indice) => orden?.planProduccion?.operaciones?.find((x) => x.itemIndice === Number(indice));
const idSeguro = (valor, prefijo, fecha) => String(valor || `${prefijo}-${fecha.replace(/\D/g, '')}`).slice(0, 100);

export function aplicarEventoCalidad(orden, evento, fecha = new Date().toISOString()) {
  if (!orden || !evento?.tipo) throw new Error('Falta la orden o el evento de calidad.');
  const siguiente = copiar(orden);
  siguiente.calidad ||= { version:1, items:{}, noConformidades:{} };
  siguiente.calidad.items ||= {};
  siguiente.calidad.noConformidades ||= {};
  const indice = Number(evento.itemIndice);

  if (evento.tipo === 'definir-caracteristica') {
    if (!operacionDe(siguiente, indice)) throw new Error('El ítem no existe en el plan de producción.');
    const item = siguiente.calidad.items[indice] ||= { caracteristicas:{}, mediciones:[] };
    item.caracteristicas ||= {}; item.mediciones ||= [];
    const id = idSeguro(evento.id, 'cota', fecha);
    const nombre = String(evento.nombre || '').trim().slice(0, 100);
    if (!nombre) throw new Error('La característica necesita un nombre del plano.');
    const nominal = numeroFinito(evento.nominal, 'El nominal');
    const toleranciaMas = numeroFinito(evento.toleranciaMas, 'La tolerancia superior');
    const toleranciaMenos = numeroFinito(evento.toleranciaMenos, 'La tolerancia inferior');
    evaluarMedicion({ nominal, toleranciaMas, toleranciaMenos, valor:nominal });
    item.caracteristicas[id] = { id, nombre, nominal, toleranciaMas, toleranciaMenos,
      unidad:String(evento.unidad || 'mm').slice(0, 12), requerida:evento.requerida !== false, fecha };
  } else if (evento.tipo === 'registrar-medicion') {
    const item = siguiente.calidad.items[indice];
    const caracteristica = item?.caracteristicas?.[evento.caracteristicaId];
    if (!caracteristica) throw new Error('Primero definí la cota y su tolerancia según el plano.');
    const resultado = evaluarMedicion({ ...caracteristica, valor:evento.valor });
    item.mediciones ||= [];
    item.mediciones.push({ id:idSeguro(evento.id, 'med', fecha), caracteristicaId:caracteristica.id,
      muestra:Math.max(1, Math.round(Number(evento.muestra) || 1)), ...resultado, fecha,
      operario:String(evento.operario || '').slice(0, 80) });
    item.liberacion = { estado:'pendiente', fecha:null, operario:'' };
  } else if (evento.tipo === 'liberar-lote') {
    const item = siguiente.calidad.items[indice];
    const requeridas = Object.values(item?.caracteristicas || {}).filter((c) => c.requerida);
    if (!requeridas.length) throw new Error('Definí al menos una cota requerida con la tolerancia del plano.');
    for (const c of requeridas) {
      const ultima = [...(item.mediciones || [])].reverse().find((m) => m.caracteristicaId === c.id);
      if (!ultima) throw new Error(`Falta medir “${c.nombre}”.`);
      if (ultima.estado !== 'conforme') throw new Error(`“${c.nombre}” está fuera de tolerancia.`);
    }
    item.liberacion = { estado:'liberado', fecha, operario:String(evento.operario || '').slice(0, 80) };
  } else if (evento.tipo === 'abrir-no-conformidad') {
    if (!operacionDe(siguiente, indice)) throw new Error('El ítem no existe en el plan de producción.');
    const causa = String(evento.causa || '');
    const accion = String(evento.accion || '');
    if (!CAUSAS_NO_CONFORMIDAD.some(([id]) => id === causa)) throw new Error('Seleccioná una causa válida.');
    if (!ACCIONES_NO_CONFORMIDAD.some(([id]) => id === accion)) throw new Error('Seleccioná una acción válida.');
    const cantidad = Math.max(1, Math.round(Number(evento.cantidad) || 1));
    const id = idSeguro(evento.id, 'nc', fecha);
    siguiente.calidad.noConformidades[id] = { id, itemIndice:indice, programaId:String(evento.programaId || '').slice(0,100),
      chapaIndice:Number.isInteger(Number(evento.chapaIndice)) ? Number(evento.chapaIndice) : null,
      piezaIndice:Number.isInteger(Number(evento.piezaIndice)) ? Number(evento.piezaIndice) : null,
      causa, accion, cantidad, detalle:String(evento.detalle || '').slice(0,500), evidencia:String(evento.evidencia || '').slice(0,300),
      estado:'abierta', fecha, operario:String(evento.operario || '').slice(0,80) };
  } else if (evento.tipo === 'cerrar-no-conformidad') {
    const nc = siguiente.calidad.noConformidades[evento.id];
    if (!nc) throw new Error('La no conformidad no existe.');
    nc.estado = 'cerrada'; nc.resolucion = String(evento.resolucion || '').slice(0,500);
    nc.fechaCierre = fecha; nc.operarioCierre = String(evento.operario || '').slice(0,80);
  } else throw new Error('Tipo de evento de calidad inválido.');
  siguiente.calidad.actualizado = fecha;
  return siguiente;
}

export function resumenCalidad(orden) {
  const items = Object.values(orden?.calidad?.items || {});
  const noConformidades = Object.values(orden?.calidad?.noConformidades || {});
  const abiertas = noConformidades.filter((x) => x.estado === 'abierta');
  return { itemsInspeccionados:items.filter((x) => (x.mediciones || []).length).length,
    lotesLiberados:items.filter((x) => x.liberacion?.estado === 'liberado').length,
    noConformidadesAbiertas:abiertas.length,
    reposiciones:abiertas.filter((x) => x.accion === 'recortar').reduce((s,x) => s + x.cantidad, 0) };
}
