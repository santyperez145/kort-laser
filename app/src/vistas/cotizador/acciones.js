/**
 * Salidas del cotizador: DXF para la máquina, PDF para el cliente y orden de
 * trabajo para el taller.
 *
 * Todo lo que se genera se descarga Y se guarda en `salidas/`, ordenado por
 * tipo. El taller lo encuentra ahí sin abrir el sistema, que es como se
 * trabaja cuando la máquina ya está cortando.
 */

import { toast } from 'sonner';
import { api } from '@/lib/api';
import { descargar } from '@/lib/formato';
import { miniatura } from '@/lib/miniatura';
import { generarDXF, generarDXFNesting } from '@core/dxf-write.js';
import { generarPresupuestoPDF, generarOrdenTrabajoPDF } from '@core/quote-pdf.js';
import { listaDeCompra } from '@core/compras.js';
import { mensajePresupuesto, enlaceWhatsApp, enlaceMail } from '@core/envio.js';

/** Un cálculo accesorio que falla no puede impedir que salga el papel. */
const seguro = (fn) => { try { return fn(); } catch { return null; } };

const limpio = (s) => String(s || 'pieza').replace(/[^\w-]/g, '_');

export function nombreArchivo(doc, base, ext) {
  const cli = (doc.cliente?.nombre || 'sin-cliente')
    .replace(/[^\w\sáéíóúñÁÉÍÓÚÑ-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
  return `${base}-${doc.numero || 'borrador'}-${cli}.${ext}`.toLowerCase();
}

export function miniaturasDeItems(resueltos) {
  const m = {};
  (resueltos || []).forEach((r, i) => {
    if (r.shape) m[i] = miniatura(r.shape, 340, 280);
  });
  return m;
}

export function descargarDXFItem(item, resuelto) {
  if (!resuelto?.shape) return toast.error('Ese ítem no tiene geometría');

  // Las líneas de plegado ya viajan dentro de shape.pliegues: no repetirlas
  // acá, o el CAM recibiría cada una dos veces y las cortaría.
  const dxf = generarDXF([{ shape: resuelto.shape }], {
    titulo: `KORT - ${item.nombre}`,
    subtitulo: `${item.materialId} ${item.espesor} mm - Cantidad ${item.cantidad}`,
  });
  const nombre = `${limpio(item.nombre)}-${item.espesor}mm.dxf`;
  descargar(nombre, dxf, 'application/dxf');
  api.guardarArchivo(nombre, dxf, 'dxf').catch(() => {});
  toast.success('DXF generado y guardado en salidas/dxf');
}

export function descargarDXFNesting(item, resuelto, r) {
  if (!r?.nesting?.layout?.length || !resuelto?.shape) {
    return toast.error('Sin nesting para exportar');
  }
  let n = 0;
  for (const chapa of r.nesting.layout) {
    const dxf = generarDXFNesting(chapa, { p: resuelto.shape });
    const nombre = `nesting-${limpio(item.nombre)}-chapa${chapa.indice}.dxf`;
    descargar(nombre, dxf, 'application/dxf');
    api.guardarArchivo(nombre, dxf, 'dxf').catch(() => {});
    if (++n >= 6) break; // no inundar la carpeta de descargas
  }
  toast.success(`${n} chapa(s) exportada(s)`);
}

export async function exportarPDF({ doc, coti, config, resueltos, actualizarDoc }) {
  if (!coti?.items.length) return toast.error('No hay ítems para cotizar');

  let numero = doc.numero;
  if (!numero) {
    numero = (await api.get('numero?tipo=P')).numero;
    actualizarDoc({ numero });
  }

  const bytes = generarPresupuestoPDF({
    presupuesto: { ...doc, numero },
    cotizacion: coti,
    config,
    miniaturas: miniaturasDeItems(resueltos),
  });
  const nombre = nombreArchivo({ ...doc, numero }, 'presupuesto', 'pdf');
  descargar(nombre, bytes, 'application/pdf');

  try {
    await api.guardarArchivo(nombre, bytes, 'presupuestos');
    toast.success('PDF generado y guardado en salidas/presupuestos');
  } catch {
    toast.success('PDF descargado');
  }
  return { numero, nombre };
}

/**
 * Mandarle el presupuesto al cliente por WhatsApp o por mail.
 *
 * Genera el PDF primero y después abre la conversación con el mensaje escrito.
 * El adjunto lo pone la persona: ni WhatsApp Web ni `mailto:` aceptan archivos
 * por URL, y la alternativa sería exponer la máquina del taller a internet.
 *
 * Por eso el PDF se descarga ANTES de abrir el chat: cuando aparece la ventana
 * de WhatsApp el archivo ya está en Descargas, listo para arrastrar.
 */
export async function enviarPresupuesto({ doc, coti, config, resueltos, actualizarDoc, via = 'whatsapp' }) {
  if (!coti?.items.length) return toast.error('No hay ítems para cotizar');

  const salida = await exportarPDF({ doc, coti, config, resueltos, actualizarDoc });
  const presupuesto = { ...doc, numero: salida?.numero || doc.numero };
  const mensaje = mensajePresupuesto({ presupuesto, cotizacion: coti, config, tipo: via });

  const destino =
    via === 'whatsapp'
      ? enlaceWhatsApp({ telefono: doc.cliente?.telefono, mensaje })
      : enlaceMail({ email: doc.cliente?.email, mensaje, presupuesto, config });

  if (destino.aviso) toast.warning(destino.aviso, { duration: 7000 });

  /* `noopener` es obligatorio: sin él la pestaña que se abre puede tocar
     `window.opener` y redirigir el sistema. */
  window.open(destino.url, '_blank', 'noopener,noreferrer');

  toast.info(`Adjuntá "${salida?.nombre || 'el PDF'}" — está en tus descargas`, { duration: 8000 });
}

export async function exportarOT({ doc, coti, config, resueltos, actualizarDoc, ctx }) {
  if (!coti?.items.length) return toast.error('No hay ítems');

  const numero = doc.numeroOT || (await api.get('numero?tipo=OT')).numero;
  if (!doc.numeroOT) actualizarDoc({ numeroOT: numero });

  const bytes = generarOrdenTrabajoPDF({
    orden: { numero, cliente: doc.cliente, fechaEntrega: null },
    cotizacion: coti,
    config,
    miniaturas: miniaturasDeItems(resueltos),
    // El que va a la casa de chapas se lleva este papel: la lista de compra
    // va en la orden de trabajo y nunca en el presupuesto del cliente.
    compra: ctx ? seguro(() => listaDeCompra(coti, ctx())) : null,
  });
  const nombre = `orden-trabajo-${numero}.pdf`;
  descargar(nombre, bytes, 'application/pdf');
  api.guardarArchivo(nombre, bytes, 'ordenes').catch(() => {});
  toast.success('Orden de trabajo generada');
}
