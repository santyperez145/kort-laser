/**
 * Inventario de retazos de chapa.
 *
 * Un retazo no es una chapa estandar: tiene medida, material y espesor
 * propios. El modulo solo calcula y ordena candidatos; decidir si una pieza
 * entra de verdad sigue siendo responsabilidad del nesting, que conoce la
 * geometria completa y las separaciones del programa.
 */

const n = (valor, defecto = 0) => {
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : defecto;
};

const positivo = (valor, defecto = 0) => Math.max(0, n(valor, defecto));

export const ESTADOS_RETAZO = ['disponible', 'reservado', 'descartado'];

export function normalizarRetazo(retazo = {}) {
  const estado = ESTADOS_RETAZO.includes(retazo.estado) ? retazo.estado : 'disponible';
  return {
    id: String(retazo.id || ''),
    materialId: String(retazo.materialId || retazo.material_id || ''),
    espesor: positivo(retazo.espesor),
    w: positivo(retazo.w ?? retazo.ancho),
    h: positivo(retazo.h ?? retazo.alto),
    cantidad: Math.max(0, Math.round(n(retazo.cantidad, 1))),
    estado,
    ubicacion: String(retazo.ubicacion || '').trim(),
    lote: String(retazo.lote || '').trim(),
    origen: String(retazo.origen || 'corte').trim(),
    notas: String(retazo.notas || '').trim(),
    creado: retazo.creado || null,
    modificado: retazo.modificado || null,
  };
}

export function superficieRetazoM2(retazo) {
  const r = normalizarRetazo(retazo);
  return (r.w * r.h * r.cantidad) / 1e6;
}

export function pesoRetazoKg(retazo, material) {
  const r = normalizarRetazo(retazo);
  return (r.w * r.h * r.espesor * n(material?.densidad)) / 1e6 * r.cantidad;
}

export function valorRetazo(retazo, material) {
  return pesoRetazoKg(retazo, material) * n(material?.precioKg);
}

function claveStock(retazo) {
  return `${retazo.materialId}|${retazo.espesor}`;
}

/** Resumen para compras y reposicion, agrupado por material y espesor. */
export function resumenStockRetazos(retazos = [], materiales = []) {
  const porId = new Map((materiales || []).map((m) => [m.id, m]));
  const grupos = new Map();
  for (const original of retazos || []) {
    const r = normalizarRetazo(original);
    if (!r.materialId || r.w <= 0 || r.h <= 0 || r.cantidad <= 0) continue;
    const material = porId.get(r.materialId);
    const clave = claveStock(r);
    if (!grupos.has(clave)) {
      grupos.set(clave, {
        clave,
        materialId: r.materialId,
        material: material?.nombre || r.materialId,
        espesor: r.espesor,
        unidades: 0,
        disponibles: 0,
        reservadas: 0,
        descartadas: 0,
        superficieM2: 0,
        pesoKg: 0,
        valor: 0,
        retazos: 0,
      });
    }
    const g = grupos.get(clave);
    g.retazos += 1;
    g.unidades += r.cantidad;
    if (r.estado === 'disponible') g.disponibles += r.cantidad;
    if (r.estado === 'reservado') g.reservadas += r.cantidad;
    if (r.estado === 'descartado') g.descartadas += r.cantidad;
    if (r.estado !== 'descartado') {
      g.superficieM2 += superficieRetazoM2(r);
      g.pesoKg += pesoRetazoKg(r, material);
      g.valor += valorRetazo(r, material);
    }
  }
  return [...grupos.values()].sort((a, b) => b.valor - a.valor || a.material.localeCompare(b.material));
}

function orientacionQueEntra(w, h, rw, rh) {
  if (w <= rw && h <= rh) return { rotacion: 0, w, h };
  if (h <= rw && w <= rh) return { rotacion: 90, w: h, h: w };
  return null;
}

/**
 * Busca retazos que pueden recibir el rectangulo envolvente de una pieza.
 * Es una preseleccion conservadora: el nesting debe confirmar el encastre
 * final cuando la pieza tiene una forma irregular o varias partes.
 */
export function candidatosRetazo(retazos = [], requisito = {}, opciones = {}) {
  const materialId = requisito.materialId || requisito.material_id;
  const espesor = n(requisito.espesor);
  const w = positivo(requisito.w ?? requisito.ancho);
  const h = positivo(requisito.h ?? requisito.alto);
  const cantidad = Math.max(1, Math.round(n(requisito.cantidad, 1)));
  const margen = positivo(opciones.margen);
  const tolerancia = positivo(opciones.tolerancia, 0.01);
  if (!materialId || !(espesor > 0) || !(w > 0) || !(h > 0)) return [];

  return (retazos || [])
    .map(normalizarRetazo)
    .filter((r) => r.estado === 'disponible' && r.cantidad >= cantidad)
    .filter((r) => r.materialId === materialId && Math.abs(r.espesor - espesor) <= tolerancia)
    .map((r) => {
      const orientacion = orientacionQueEntra(w + margen * 2, h + margen * 2, r.w, r.h);
      if (!orientacion) return null;
      const areaNecesaria = (w * h) / 1e6;
      const areaRetazo = (r.w * r.h) / 1e6;
      return {
        ...r,
        cantidadSolicitada: cantidad,
        rotacion: orientacion.rotacion,
        areaNecesariaM2: areaNecesaria,
        desperdicioM2: Math.max(0, areaRetazo - areaNecesaria),
        aprovechamiento: areaRetazo > 0 ? areaNecesaria / areaRetazo : 0,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.desperdicioM2 - b.desperdicioM2 || a.w * a.h - b.w * b.h);
}

/** Decrementa unidades de un retazo sin inventar cortes del sobrante. */
export function consumirRetazo(retazos = [], id, cantidad = 1) {
  const cuanto = Math.max(1, Math.round(n(cantidad, 1)));
  let encontrado = false;
  const salida = (retazos || []).map((original) => {
    const r = normalizarRetazo(original);
    if (r.id !== id) return original;
    encontrado = true;
    if (r.estado !== 'disponible' || r.cantidad < cuanto) return original;
    return { ...r, cantidad: r.cantidad - cuanto, modificado: new Date().toISOString() };
  });
  return { retazos: salida, encontrado };
}
