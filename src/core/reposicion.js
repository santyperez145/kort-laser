/**
 * Reposición de chapas enteras.
 *
 * El punto de pedido se expresa en unidades físicas, nunca en pesos: la
 * inflación cambia el valor pero no cuántas chapas hacen falta para producir.
 */

const CERRADOS = new Set(['terminado', 'entregado', 'cancelado']);
const CONSUMIDOS = new Set(['terminado', 'entregado']);
const n = (v, d = 0) => Number.isFinite(Number(v)) ? Number(v) : d;

export function requerimientosDeCotizacion(cotizacion) {
  const grupos = new Map();
  const contados = new Set();
  for (const item of cotizacion?.items || []) {
    const ns = item?.nesting;
    if (!ns || ns.error || !ns.chapa || item?.costos?.materialDelCliente || item?.retazo) continue;
    const clave = `${item.material.id}|${item.espesor}|${ns.chapa.w}x${ns.chapa.h}`;
    if (!grupos.has(clave)) grupos.set(clave, {
      clave, materialId: item.material.id, material: item.material.nombre,
      espesor: item.espesor, chapa: { w: ns.chapa.w, h: ns.chapa.h }, chapas: 0,
    });
    if (ns.compartido) {
      if (contados.has(ns.grupo)) continue;
      contados.add(ns.grupo);
      grupos.get(clave).chapas += n(ns.chapasGrupo);
    } else grupos.get(clave).chapas += n(ns.chapas);
  }
  return [...grupos.values()].map((x) => ({ ...x, chapas: Math.ceil(x.chapas - 1e-9) }));
}

function claveDe(materialId, espesor, chapa) {
  return `${materialId}|${n(espesor)}|${n(chapa?.w)}x${n(chapa?.h)}`;
}

function diasEntre(a, b) {
  return Math.max(1, (new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

/**
 * Calcula reposición con demanda comprometida más un colchón basado en el
 * consumo real. Sin historial, no inventa rotación: sólo cubre las OTs.
 */
export function planReposicion({ retazos = [], ordenes = [], materiales = [], hoy = new Date(), diasHistorial = 90, plazoDias = 10 } = {}) {
  const fin = new Date(hoy);
  const inicio = new Date(fin.getTime() - Math.max(1, diasHistorial) * 86400000);
  const grupos = new Map();

  const asegurar = (req) => {
    const clave = req.clave || claveDe(req.materialId, req.espesor, req.chapa);
    if (!grupos.has(clave)) grupos.set(clave, {
      clave, materialId: req.materialId, material: req.material || req.materialId,
      espesor: n(req.espesor), chapa: { w: n(req.chapa?.w), h: n(req.chapa?.h) },
      disponibles: 0, comprometidas: 0, consumidasPeriodo: 0,
    });
    return grupos.get(clave);
  };

  for (const r of retazos || []) {
    if (r.estado !== 'disponible' || n(r.cantidad) <= 0) continue;
    const mat = materiales.find((m) => m.id === r.materialId);
    const std = mat?.chapaStd;
    // Sólo una chapa con medida completa cuenta como stock comprable. Un
    // retazo grande puede servir, pero el nesting es quien debe confirmarlo.
    if (!std || Math.abs(n(r.w) - n(std.w)) > 1 || Math.abs(n(r.h) - n(std.h)) > 1) continue;
    const g = asegurar({ materialId: r.materialId, material: mat?.nombre, espesor: r.espesor, chapa: std });
    const reservadas = (r.reservas || []).reduce((s, x) => s + n(x.cantidad), 0);
    g.disponibles += Math.max(0, n(r.cantidad) - reservadas);
  }

  for (const orden of ordenes || []) {
    if (orden.estado === 'cancelado') continue;
    const requisitos = orden.requerimientosChapa || [];
    const fecha = new Date(orden.modificado || orden.creado || 0);
    for (const req of requisitos) {
      const g = asegurar(req);
      if (!CERRADOS.has(orden.estado)) g.comprometidas += n(req.chapas);
      if (CONSUMIDOS.has(orden.estado) && fecha >= inicio && fecha <= fin) g.consumidasPeriodo += n(req.chapas);
    }
  }

  const diasMedidos = diasEntre(inicio, fin);
  return [...grupos.values()].map((g) => {
    const consumoDiario = g.consumidasPeriodo / diasMedidos;
    const seguridad = Math.ceil(consumoDiario * Math.max(0, plazoDias));
    const objetivo = g.comprometidas + seguridad;
    const comprar = Math.max(0, Math.ceil(objetivo - g.disponibles));
    return {
      ...g, diasHistorial: diasMedidos, plazoDias, consumoDiario, seguridad,
      objetivo, comprar,
      estado: comprar > 0 ? (g.disponibles < g.comprometidas ? 'critico' : 'reponer') : 'cubierto',
      explicacion: `${g.comprometidas} comprometidas + ${seguridad} de seguridad - ${g.disponibles} disponibles = ${comprar} a comprar`,
    };
  }).sort((a, b) => b.comprar - a.comprar || a.material.localeCompare(b.material) || a.espesor - b.espesor);
}
