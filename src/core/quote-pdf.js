/**
 * KORT - Documento de presupuesto en PDF
 *
 * Arma un presupuesto presentable: encabezado con los datos de la empresa,
 * datos del cliente, tabla de ítems con la ficha técnica de cada pieza,
 * miniatura de la geometría, totales, resumen de producción y condiciones
 * comerciales. Pagina solo cuando hace falta y numera todas las hojas.
 */

import { PDF, anchoTexto } from './pdf.js';
import { fmtMoneda, fmtNum } from './pricing.js';
import { fmtTiempo } from './cutting.js';

const COL = {
  tinta: '#12161c',
  suave: '#5b6672',
  linea: '#d8dee6',
  fondo: '#f4f6f9',
  acento: '#e4572e',
  acento2: '#1b3a5c',
  ok: '#1f7a4d',
};

const A4 = { ancho: 595.28, alto: 841.89, margen: 38 };

function fecha(d = new Date()) {
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function sumarDias(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

/**
 * @param {Object} datos
 *   presupuesto : { numero, fecha, cliente:{...}, notas, entregaDias, condicionPago }
 *   cotizacion  : resultado de cotizarPresupuesto()
 *   config      : configuración del sistema
 *   miniaturas  : { [indiceItem]: dataURL JPEG }
 *   opciones    : { mostrarDesglose:boolean, mostrarFicha:boolean }
 */
export function generarPresupuestoPDF(datos) {
  const { presupuesto = {}, cotizacion, config, miniaturas = {}, opciones = {} } = datos;
  const emp = config.empresa || {};
  const com = config.comercial || {};
  const sim = com.simbolo || '$';
  const doc = new PDF(A4);
  const M = doc.margen;
  const W = doc.anchoUtil;
  const fEmision = presupuesto.fecha ? new Date(presupuesto.fecha) : new Date();
  const validez = com.validezDias ?? 15;

  let pagina = 1;
  const paginas = [];

  /* ---------------- Encabezado ---------------- */
  function encabezado(primera) {
    doc.hex(COL.acento2);
    doc.rect(0, 0, doc.W, primera ? 96 : 54, 'f');
    doc.hex(COL.acento);
    doc.rect(0, primera ? 92 : 50, doc.W, 4, 'f');

    doc.texto(M, primera ? 24 : 16, emp.nombre || 'KORT', { size: primera ? 30 : 18, bold: true, color: '#ffffff' });
    if (primera) {
      doc.texto(M, 58, emp.razonSocial || 'Corte láser y plegado CNC', { size: 9.5, color: '#c9d6e4' });
      const l2 = [emp.direccion, emp.telefono, emp.email, emp.web].filter(Boolean).join('  ·  ');
      if (l2) doc.texto(M, 72, l2, { size: 8, color: '#a8bcd0' });
    }

    const xd = doc.W - M;
    doc.texto(xd, primera ? 22 : 16, 'PRESUPUESTO', { size: primera ? 15 : 11, bold: true, color: '#ffffff', align: 'right' });
    doc.texto(xd, primera ? 40 : 32, `N° ${presupuesto.numero || '0001'}`, {
      size: primera ? 12 : 9, bold: true, color: '#ffc9b8', align: 'right',
    });
    if (primera) {
      doc.texto(xd, 58, `Emisión: ${fecha(fEmision)}`, { size: 8.5, color: '#c9d6e4', align: 'right' });
      doc.texto(xd, 71, `Válido hasta: ${fecha(sumarDias(fEmision, validez))}`, { size: 8.5, color: '#c9d6e4', align: 'right' });
    }
    doc.y = primera ? 116 : 74;
  }

  function saltoSiHaceFalta(alto) {
    if (doc.y + alto > doc.H - 62) {
      paginas.push(pagina++);
      doc.nuevaPagina();
      encabezado(false);
      cabeceraTabla();
      return true;
    }
    return false;
  }

  encabezado(true);

  /* ---------------- Cliente ---------------- */
  const cli = presupuesto.cliente || {};
  const altoCli = 62;
  doc.hex(COL.fondo);
  doc.rectRedondo(M, doc.y, W, altoCli, 4, 'f');
  doc.hex(COL.acento);
  doc.rect(M, doc.y, 3, altoCli, 'f');

  doc.texto(M + 12, doc.y + 9, 'CLIENTE', { size: 7.5, bold: true, color: COL.acento });
  doc.texto(M + 12, doc.y + 22, cli.nombre || 'Consumidor final', { size: 12, bold: true, color: COL.tinta });
  const datosCli = [
    cli.cuit ? `CUIT ${cli.cuit}` : null,
    cli.telefono,
    cli.email,
    cli.direccion,
  ].filter(Boolean).join('   ·   ');
  doc.texto(M + 12, doc.y + 40, datosCli || '—', { size: 8.5, color: COL.suave, maxWidth: W * 0.62 });

  const xR = M + W - 12;
  doc.texto(xR, doc.y + 9, 'CONDICIONES', { size: 7.5, bold: true, color: COL.acento, align: 'right' });
  doc.texto(xR, doc.y + 22, presupuesto.condicionPago || com.condicionPagoDefecto || 'A convenir', {
    size: 9, bold: true, color: COL.tinta, align: 'right',
  });
  doc.texto(xR, doc.y + 40, `Entrega estimada: ${presupuesto.entregaDias ?? 7} días hábiles`, {
    size: 8.5, color: COL.suave, align: 'right',
  });
  doc.y += altoCli + 18;

  /* ---------------- Tabla de ítems ---------------- */
  const conMini = opciones.mostrarFicha !== false;
  const cols = conMini
    ? { img: M, desc: M + 54, cant: M + W - 200, uni: M + W - 130, tot: M + W }
    : { img: null, desc: M, cant: M + W - 200, uni: M + W - 130, tot: M + W };

  function cabeceraTabla() {
    doc.hex(COL.acento2);
    doc.rect(M, doc.y, W, 20, 'f');
    doc.texto(cols.desc, doc.y + 6, 'DESCRIPCIÓN', { size: 7.5, bold: true, color: '#ffffff' });
    doc.texto(cols.cant + 26, doc.y + 6, 'CANT.', { size: 7.5, bold: true, color: '#ffffff', align: 'right' });
    doc.texto(cols.uni + 52, doc.y + 6, 'UNITARIO', { size: 7.5, bold: true, color: '#ffffff', align: 'right' });
    doc.texto(cols.tot, doc.y + 6, 'IMPORTE', { size: 7.5, bold: true, color: '#ffffff', align: 'right' });
    doc.y += 20;
  }
  cabeceraTabla();

  const items = cotizacion.items || [];
  items.forEach((it, i) => {
    const g = it.geometria;
    const ficha = [];
    ficha.push(`${it.material.nombre} · ${fmtNum(it.espesor, 1)} mm`);
    ficha.push(`${fmtNum(g.ancho, 0)} × ${fmtNum(g.alto, 0)} mm · ${fmtNum(g.pesoPieza, 2)} kg/u`);
    const l3 = [`Corte ${fmtNum(g.largoCorteMM / 1000, 2)} m`, `${g.piercings} ${g.piercings === 1 ? 'perforación' : 'perforaciones'}`];
    if (it.plegado?.nPliegues) l3.push(`${it.plegado.nPliegues} pliegue${it.plegado.nPliegues === 1 ? '' : 's'}`);
    ficha.push(l3.filter(Boolean).join(' · '));
    if (it.datosPliegue) {
      ficha.push(
        `Plegado: matriz V${it.datosPliegue.matrizV} · R int. ${fmtNum(it.datosPliegue.radioInterno, 1)} mm · ${fmtNum(it.datosPliegue.toneladas, 1)} t`
      );
    }
    if (it.costos.detalleAcabado) ficha.push(`Acabado: ${it.costos.detalleAcabado.nombre}`);

    const alto = Math.max(conMini ? 52 : 26, 20 + ficha.length * 10);
    saltoSiHaceFalta(alto + 6);

    if (i % 2 === 1) {
      doc.hex('#fafbfd');
      doc.rect(M, doc.y, W, alto, 'f');
    }

    const mini = miniaturas[i] || miniaturas[String(i)];
    if (conMini && mini) {
      doc.hex('#ffffff');
      doc.rect(M + 3, doc.y + 5, 44, alto - 10, 'f');
      try {
        doc.imagenDataURL(mini, M + 4, doc.y + 6, 42, alto - 12);
      } catch (e) {
        /* si la miniatura falla, el presupuesto igual sale */
      }
    }

    doc.texto(cols.desc, doc.y + 5, `${i + 1}. ${it.nombre}`, {
      size: 9.5, bold: true, color: COL.tinta, maxWidth: cols.cant - cols.desc - 12,
    });
    let yy = doc.y + 18;
    for (const f of ficha) {
      doc.texto(cols.desc, yy, f, { size: 7.4, color: COL.suave, maxWidth: cols.cant - cols.desc - 12 });
      yy += 9.5;
    }

    doc.texto(cols.cant + 26, doc.y + 6, String(it.cantidad), { size: 10, bold: true, color: COL.tinta, align: 'right' });
    doc.texto(cols.uni + 52, doc.y + 6, fmtMoneda(it.precio.unitario, sim, 2), { size: 9, color: COL.tinta, align: 'right' });
    doc.texto(cols.tot, doc.y + 6, fmtMoneda(it.precio.neto, sim, 2), { size: 10, bold: true, color: COL.tinta, align: 'right' });
    if (it.precio.descuentoPct > 0) {
      doc.texto(cols.tot, doc.y + 19, `incluye ${fmtNum(it.precio.descuentoPct, 0)} % desc. por cantidad`, {
        size: 6.8, color: COL.ok, align: 'right',
      });
    }

    doc.hex(COL.linea, true);
    doc.linea(M, doc.y + alto, M + W, doc.y + alto, 0.4);
    doc.y += alto;
  });

  /* ---------------- Totales ---------------- */
  const r = cotizacion.resumen;
  saltoSiHaceFalta(150);
  doc.y += 14;

  const anchoCaja = 232;
  const xCaja = M + W - anchoCaja;
  const filas = [];
  filas.push(['Subtotal', fmtMoneda(r.subtotal, sim, 2), false]);
  if (r.descuentoGlobal > 0) filas.push([`Descuento ${fmtNum(r.descuentoGlobal, 0)} %`, '', false]);
  if (com.mostrarIVA) filas.push([`IVA ${fmtNum(r.ivaPct, 0)} %`, fmtMoneda(r.iva, sim, 2), false]);
  filas.push(['TOTAL', fmtMoneda(r.total, sim, 2), true]);

  const altoCaja = filas.length * 20 + 12;
  doc.hex(COL.fondo);
  doc.rectRedondo(xCaja, doc.y, anchoCaja, altoCaja, 4, 'f');
  let yf = doc.y + 8;
  filas.forEach(([et, val, fuerte]) => {
    if (fuerte) {
      doc.hex(COL.acento2);
      doc.rect(xCaja, yf - 2, anchoCaja, 22, 'f');
      doc.texto(xCaja + 12, yf + 3, et, { size: 10.5, bold: true, color: '#ffffff' });
      doc.texto(xCaja + anchoCaja - 12, yf + 2, val, { size: 12.5, bold: true, color: '#ffffff', align: 'right' });
    } else {
      doc.texto(xCaja + 12, yf + 3, et, { size: 9, color: COL.suave });
      doc.texto(xCaja + anchoCaja - 12, yf + 3, val, { size: 9.5, color: COL.tinta, align: 'right' });
    }
    yf += 20;
  });

  /* Resumen del trabajo, a la izquierda.
     Va SÓLO lo que le sirve al cliente: cuántas piezas recibe y cuánto pesan
     (que es lo que necesita para el flete). Las chapas consumidas y el tiempo
     de máquina son datos NUESTROS y quedan en la orden de trabajo: mostrar
     "18m 2s" al lado de un precio de seis cifras invita a discutir el precio
     por minuto de máquina en vez de por el trabajo entregado, y además le
     revela al cliente el rendimiento del anidado. */
  const xTec = M;
  const anchoTec = W - anchoCaja - 16;
  doc.texto(xTec, doc.y + 2, 'RESUMEN DEL TRABAJO', { size: 7.5, bold: true, color: COL.acento });
  const tec = [
    ['Ítems', `${cotizacion.items.length}`],
    ['Piezas totales', `${r.piezasTotales} u`],
    ['Peso total', `${fmtNum(r.pesoTotal, 2)} kg`],
    ['Plazo estimado', `${presupuesto.entregaDias ?? 7} días hábiles`],
  ];
  let yt = doc.y + 16;
  for (const [k, v] of tec) {
    doc.texto(xTec, yt, k, { size: 8, color: COL.suave });
    doc.texto(xTec + anchoTec - 8, yt, v, { size: 8.5, bold: true, color: COL.tinta, align: 'right' });
    doc.hex(COL.linea, true);
    doc.linea(xTec, yt + 12, xTec + anchoTec - 8, yt + 12, 0.3);
    yt += 17;
  }
  if (r.totalUSD && com.moneda === 'ARS') {
    doc.texto(xTec, yt + 2, `Referencia: US$ ${fmtNum(r.totalUSD, 2)} (TC ${fmtNum(com.tipoCambio, 0)})`, {
      size: 7.5, color: COL.suave,
    });
  }

  doc.y += Math.max(altoCaja, yt - doc.y) + 18;

  /* ---------------- Notas y condiciones ---------------- */
  saltoSiHaceFalta(120);
  if (presupuesto.notas) {
    doc.texto(M, doc.y, 'OBSERVACIONES', { size: 7.5, bold: true, color: COL.acento });
    doc.y += 12;
    doc.y += doc.parrafo(M, doc.y, presupuesto.notas, W, { size: 8.5, color: COL.tinta });
    doc.y += 10;
  }

  const condiciones =
    presupuesto.condiciones ||
    config.textos?.condiciones ||
    [
      `Validez de la oferta: ${validez} días corridos desde la fecha de emisión.`,
      'Los precios están sujetos a variación del costo de la materia prima; se confirman al momento de la orden de compra.',
      'El plazo de entrega comienza a correr desde la aprobación del presupuesto y la recepción de los archivos definitivos.',
      'Los archivos deben entregarse en DXF, DWG o STEP. Si se requiere digitalización o rediseño, se cotiza por separado.',
      'Tolerancias de corte según DIN 2768-m salvo indicación expresa en plano. Las cotas críticas deben estar indicadas.',
      'El desarrollo de las piezas plegadas se calcula con el K-factor del material; verificar la primera muestra antes de la serie.',
      'No incluye tratamientos superficiales, soldadura ni herrajes salvo que estén detallados en los ítems.',
      'El material sobrante y los retazos quedan en poder de KORT salvo acuerdo previo.',
    ].join('\n');

  doc.texto(M, doc.y, 'CONDICIONES COMERCIALES Y TÉCNICAS', { size: 7.5, bold: true, color: COL.acento });
  doc.y += 12;
  for (const linea of condiciones.split('\n')) {
    if (!linea.trim()) continue;
    saltoSiHaceFalta(20);
    doc.hex(COL.acento);
    doc.rect(M + 1, doc.y + 3, 2.5, 2.5, 'f');
    doc.y += doc.parrafo(M + 10, doc.y, linea.trim(), W - 10, { size: 7.6, color: COL.suave, interlinea: 9.5 });
    doc.y += 2;
  }

  /* ---------------- Firma ---------------- */
  saltoSiHaceFalta(70);
  doc.y += 22;
  doc.hex(COL.linea, true);
  doc.linea(M, doc.y, M + 170, doc.y, 0.7);
  doc.linea(M + W - 170, doc.y, M + W, doc.y, 0.7);
  doc.texto(M, doc.y + 5, emp.nombre || 'KORT', { size: 8, bold: true, color: COL.tinta });
  doc.texto(M, doc.y + 15, 'Firma y aclaración', { size: 7, color: COL.suave });
  doc.texto(M + W, doc.y + 5, 'Conformidad del cliente', { size: 8, bold: true, color: COL.tinta, align: 'right' });
  doc.texto(M + W, doc.y + 15, 'Firma, aclaración y fecha', { size: 7, color: COL.suave, align: 'right' });

  /* ---------------- Pie en todas las páginas ---------------- */
  const total = doc.paginas.length;
  doc.paginas.forEach((pg, i) => {
    doc.cur = pg;
    doc.hex(COL.linea, true);
    doc.linea(M, doc.H - 34, doc.W - M, doc.H - 34, 0.5);
    const pie = [emp.razonSocial || emp.nombre, emp.cuit ? `CUIT ${emp.cuit}` : null, emp.telefono, emp.email]
      .filter(Boolean)
      .join('  ·  ');
    doc.texto(M, doc.H - 28, pie, { size: 7, color: COL.suave, maxWidth: doc.W - 2 * M - 60 });
    doc.texto(doc.W - M, doc.H - 28, `Página ${i + 1} de ${total}`, { size: 7, color: COL.suave, align: 'right' });
  });

  return doc.save();
}

/**
 * Orden de trabajo / hoja de ruta para el taller.
 * Va con la pieza por el taller: qué material, qué espesor, qué pliegues,
 * en qué orden y con qué matriz.
 */
/**
 * Orden de trabajo: el papel que baja al taller. A diferencia del
 * presupuesto, acá SÍ va todo lo nuestro — tiempos, chapas, material a
 * comprar. Nunca sale de la empresa.
 *
 * @param {Object} [compra] resultado de `listaDeCompra()`, opcional
 */
export function generarOrdenTrabajoPDF({ orden, cotizacion, config, miniaturas = {}, compra = null }) {
  const doc = new PDF(A4);
  const M = doc.margen;
  const W = doc.anchoUtil;
  const emp = config.empresa || {};

  doc.hex('#12161c');
  doc.rect(0, 0, doc.W, 66, 'f');
  doc.texto(M, 16, 'ORDEN DE TRABAJO', { size: 20, bold: true, color: '#ffffff' });
  doc.texto(M, 42, `${emp.nombre || 'KORT'} · OT N° ${orden.numero}`, { size: 9, color: '#9fb0c0' });
  doc.texto(doc.W - M, 18, orden.cliente?.nombre || '', { size: 11, bold: true, color: '#ffffff', align: 'right' });
  doc.texto(doc.W - M, 36, `Entrega: ${orden.fechaEntrega || 'a coordinar'}`, { size: 9, color: '#ffc9b8', align: 'right' });
  doc.texto(doc.W - M, 50, `Emitida: ${fecha(new Date())}`, { size: 8, color: '#9fb0c0', align: 'right' });
  doc.y = 84;

  (cotizacion.items || []).forEach((it, i) => {
    if (doc.y > doc.H - 200) {
      doc.nuevaPagina();
      doc.y = M;
    }
    const alto = 132;
    doc.hex('#f4f6f9');
    doc.rectRedondo(M, doc.y, W, alto, 4, 'f');
    doc.hex('#e4572e');
    doc.rect(M, doc.y, 3, alto, 'f');

    doc.texto(M + 14, doc.y + 10, `${i + 1}. ${it.nombre}`, { size: 12.5, bold: true, color: '#12161c' });
    doc.texto(M + W - 14, doc.y + 8, `${it.cantidad} u`, { size: 16, bold: true, color: '#e4572e', align: 'right' });

    const mini = miniaturas[i] || miniaturas[String(i)];
    if (mini) {
      doc.hex('#ffffff');
      doc.rect(M + W - 130, doc.y + 30, 116, 92, 'f');
      try {
        doc.imagenDataURL(mini, M + W - 128, doc.y + 32, 112, 88);
      } catch (e) {}
    }

    const g = it.geometria;
    const filas = [
      ['Material', `${it.material.nombre}`],
      ['Espesor', `${fmtNum(it.espesor, 1)} mm`],
      ['Medida desarrollo', `${fmtNum(g.ancho, 1)} × ${fmtNum(g.alto, 1)} mm`],
      ['Peso unitario', `${fmtNum(g.pesoPieza, 3)} kg`],
      ['Chapas', `${it.nesting?.chapas ?? '-'} (${fmtNum((it.nesting?.aprovechamiento || 0) * 100, 1)} % aprov.)`],
      ['Tiempo láser', fmtTiempo(it.tiempos.corteTotal)],
    ];
    if (it.datosPliegue) {
      filas.push([
        'Pliegues',
        `${it.plegado?.nPliegues ?? 0} × ${it.datosPliegue.anguloDoblado}° · V${it.datosPliegue.matrizV} · R int. ${fmtNum(it.datosPliegue.radioInterno, 1)} mm`,
      ]);
      filas.push(['Tonelaje', `${fmtNum(it.datosPliegue.toneladas, 1)} t (${fmtNum(it.datosPliegue.toneladasPorMetro, 1)} t/m)`]);
      filas.push(['Ala mínima', `${fmtNum(it.datosPliegue.alaMinima, 1)} mm`]);
    }
    if (it.costos.detalleAcabado) filas.push(['Acabado', it.costos.detalleAcabado.nombre]);

    let yy = doc.y + 30;
    let colX = M + 14;
    filas.forEach((f, k) => {
      if (k === Math.ceil(filas.length / 2)) {
        colX = M + 14 + (W - 150) / 2;
        yy = doc.y + 30;
      }
      doc.texto(colX, yy, f[0], { size: 7.5, color: '#5b6672' });
      doc.texto(colX + 92, yy, f[1], { size: 8.5, bold: true, color: '#12161c', maxWidth: (W - 160) / 2 - 92 });
      yy += 13;
    });

    doc.y += alto + 10;
  });

  /* Material a comprar. Va acá y NO en el presupuesto: es información
     nuestra. Al pie de la orden de trabajo sirve para que el que va a la
     casa de chapas lleve el papel con lo que hay que pedir. */
  if (compra?.lineas?.length) {
    doc.y += 6;
    doc.texto(M, doc.y, 'MATERIAL A COMPRAR', { size: 8, bold: true, color: '#e4572e' });
    doc.y += 14;
    for (const l of compra.lineas) {
      doc.hex('#5b6672', true);
      doc.rect(M, doc.y, 9, 9, 'S');
      doc.texto(M + 15, doc.y + 1, l.pedido, { size: 8.5, color: '#12161c', maxWidth: W - 130 });
      doc.texto(M + W, doc.y + 1, fmtMoneda(l.costoTotal, '$', 0), {
        size: 8.5, bold: true, color: '#12161c', align: 'right',
      });
      doc.y += 15;
    }
    doc.texto(M + 15, doc.y + 1, `Total ${fmtNum(compra.pesoTotal, 1)} kg`, { size: 8, color: '#5b6672' });
    doc.texto(M + W, doc.y + 1, fmtMoneda(compra.total, '$', 0), {
      size: 9, bold: true, color: '#12161c', align: 'right',
    });
    doc.y += 20;
  }

  doc.y += 6;
  doc.texto(M, doc.y, 'CONTROL DE CALIDAD', { size: 8, bold: true, color: '#e4572e' });
  doc.y += 14;
  const checks = ['Medidas verificadas', 'Sin rebabas', 'Ángulos de plegado OK', 'Cantidad completa', 'Embalado'];
  for (const c of checks) {
    doc.hex('#5b6672', true);
    doc.rect(M, doc.y, 9, 9, 'S');
    doc.texto(M + 15, doc.y + 1, c, { size: 8.5, color: '#12161c' });
    doc.y += 15;
  }
  doc.texto(M, doc.y + 10, 'Operario: ______________________     Fecha: ____________     Firma: ______________________', {
    size: 8, color: '#5b6672',
  });

  return doc.save();
}

function codigoControl(texto) {
  let h = 2166136261;
  for (const ch of String(texto)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36).toUpperCase().padStart(7, '0').slice(0, 7);
}

function matrizCodigo(texto, n = 13) {
  let h = 2166136261;
  for (const ch of String(texto)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  const celdas = [];
  for (let y = 0; y < n; y++) {
    const fila = [];
    for (let x = 0; x < n; x++) {
      const finder =
        (x < 4 && y < 4) ||
        (x >= n - 4 && y < 4) ||
        (x < 4 && y >= n - 4);
      h ^= (x + 31) * (y + 17);
      h = Math.imul(h, 1103515245) + 12345;
      fila.push(finder ? (x === 0 || y === 0 || x === 3 || y === 3 || (x === 1 && y === 1)) : ((h >>> 27) & 1) === 1);
    }
    celdas.push(fila);
  }
  return celdas;
}

function dibujarCodigo(doc, texto, x, y, tam) {
  const m = matrizCodigo(texto);
  const n = m.length;
  const c = tam / n;
  doc.hex('#ffffff');
  doc.rect(x, y, tam, tam, 'f');
  doc.hex('#12161c');
  for (let yy = 0; yy < n; yy++) {
    for (let xx = 0; xx < n; xx++) {
      if (m[yy][xx]) doc.rect(x + xx * c, y + yy * c, c + 0.08, c + 0.08, 'f');
    }
  }
  doc.hex('#12161c', true);
  doc.rect(x, y, tam, tam, 'S');
}

function materialItem(it) {
  return it.material?.nombre || it.materialNombre || it.materialId || '-';
}

/**
 * Etiquetas para pegar en piezas o paquetes del taller.
 *
 * Una etiqueta por ítem: OT, cliente, material, espesor, cantidad, control y
 * una ruta preparada para la ficha de la orden. El código visual no reemplaza
 * un QR estándar; evita confundir paquetes aunque se imprima chico o se moje.
 */
export function generarEtiquetasPiezasPDF({ orden = {}, cotizacion, config = {}, baseUrl = '' }) {
  const doc = new PDF(A4);
  const M = 24;
  const etiqueta = { w: 255.12, h: 155.91 }; // 90 x 55 mm
  const gap = 10;
  const cols = 2;
  const emp = config.empresa || {};
  const items = cotizacion?.items || [];
  let x = M;
  let y = M;

  items.forEach((it, i) => {
    if (i > 0) {
      if (i % cols === 0) {
        x = M;
        y += etiqueta.h + gap;
      } else {
        x += etiqueta.w + gap;
      }
      if (y + etiqueta.h > doc.H - M) {
        doc.nuevaPagina();
        x = M;
        y = M;
      }
    }

    const id = `${orden.numero || 'OT'}-${i + 1}`;
    const control = codigoControl(`${id}|${it.nombre}|${it.cantidad}|${materialItem(it)}|${it.espesor}`);
    const url = `${baseUrl || ''}/ordenes?id=${encodeURIComponent(orden.id || orden.numero || '')}#item-${i + 1}`;

    doc.hex('#ffffff');
    doc.rectRedondo(x, y, etiqueta.w, etiqueta.h, 5, 'f');
    doc.hex(COL.linea, true);
    doc.rectRedondo(x, y, etiqueta.w, etiqueta.h, 5, 'S');
    doc.hex(COL.acento2);
    doc.rectRedondo(x, y, etiqueta.w, 27, 5, 'f');
    doc.hex(COL.acento);
    doc.rect(x, y + 24, etiqueta.w, 3, 'f');

    doc.texto(x + 10, y + 8, emp.nombre || 'KORT', { size: 8, bold: true, color: '#ffffff' });
    doc.texto(x + etiqueta.w - 10, y + 8, `OT ${orden.numero || '-'}`, { size: 10, bold: true, color: '#ffffff', align: 'right' });

    doc.texto(x + 10, y + 38, `${i + 1}. ${it.nombre}`, { size: 11, bold: true, color: COL.tinta, maxWidth: etiqueta.w - 82 });
    doc.texto(x + 10, y + 55, orden.cliente?.nombre || 'Sin cliente', { size: 8, color: COL.suave, maxWidth: etiqueta.w - 82 });

    const datos = [
      ['Material', materialItem(it)],
      ['Espesor', `${fmtNum(it.espesor, 1)} mm`],
      ['Cantidad', `${it.cantidad} u`],
      ['Medida', `${fmtNum(it.geometria?.ancho || 0, 0)} x ${fmtNum(it.geometria?.alto || 0, 0)} mm`],
    ];
    let yy = y + 75;
    datos.forEach(([k, v]) => {
      doc.texto(x + 10, yy, k, { size: 6.7, color: COL.suave });
      doc.texto(x + 56, yy, v, { size: 7.4, bold: true, color: COL.tinta, maxWidth: etiqueta.w - 130 });
      yy += 11;
    });

    dibujarCodigo(doc, control, x + etiqueta.w - 64, y + 39, 52);
    doc.texto(x + etiqueta.w - 38, y + 98, control, { size: 7, bold: true, color: COL.tinta, align: 'center' });
    doc.texto(x + etiqueta.w - 10, y + 116, `Entrega: ${orden.fechaEntrega || 'coordinar'}`, {
      size: 7.2, bold: true, color: COL.acento, align: 'right',
    });
    doc.texto(x + 10, y + 137, url, { size: 5.8, color: COL.suave, maxWidth: etiqueta.w - 20 });
  });

  if (!items.length) {
    doc.texto(M, M, 'No hay ítems para etiquetar.', { size: 12, color: COL.tinta });
  }

  return doc.save();
}
