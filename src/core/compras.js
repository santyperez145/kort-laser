/**
 * Qué chapa hay que comprar para hacer un presupuesto.
 *
 * El cotizador dice cuánto cobrar. Esto dice qué pedirle al proveedor: cuántas
 * chapas de cada material y espesor, cuánto pesan, cuánto salen y qué queda
 * de recorte.
 *
 * Por qué existe: el paso entre "el cliente aprobó" y "voy a comprar" se hace
 * a mano, con la cotización en pantalla y una calculadora. Ahí se compra de
 * menos y hay que parar la máquina a mitad de trabajo, o se compra de más y
 * el capital queda en el depósito. Los dos errores cuestan plata y los dos
 * salen del mismo número que el sistema ya calculó.
 *
 * Sin dependencias, como todo `src/core/`.
 */

import { pesoKg } from './materials.js';

const nz = (v, d = 0) => (Number.isFinite(v) ? v : d);

/**
 * Lista de compra de un presupuesto ya cotizado.
 *
 * Consolida por (material, espesor, chapa): es como se compra y como se
 * factura. El gas NO entra en la clave — a diferencia del nesting, donde
 * cambiarlo es cambiar de programa, al proveedor de chapa le da igual con qué
 * se va a cortar.
 *
 * @param {Object} cotizacion resultado de `cotizarPresupuesto()`
 * @param {Object} ctx { materiales, config }
 * @param {Object} [opts] { redondearChapas = true }
 */
export function listaDeCompra(cotizacion, ctx, opts = {}) {
  const redondear = opts.redondearChapas !== false;
  const materiales = ctx?.materiales || [];
  const items = (cotizacion?.items || []).filter((i) => i && !i.error);

  /* Se agrupa por chapa comprable. Las chapas fraccionarias de los ítems que
     comparten grupo se suman: el grupo ya repartió el total, así que sumar
     las partes reconstruye exactamente las chapas del programa. */
  const porClave = new Map();
  const gruposContados = new Set();

  for (const it of items) {
    const nst = it.nesting;
    if (!nst || nst.error || !nst.chapa) continue;
    const chapa = nst.chapa;
    const clave = `${it.material.id}|${it.espesor}|${chapa.w}x${chapa.h}`;

    if (!porClave.has(clave)) {
      const mat = materiales.find((m) => m.id === it.material.id) || it.material;
      const pesoChapa = pesoKg(chapa.w * chapa.h, it.espesor, it.material.densidad);
      porClave.set(clave, {
        clave,
        materialId: it.material.id,
        material: it.material.nombre,
        familia: mat.familia || null,
        espesor: it.espesor,
        chapa: { w: chapa.w, h: chapa.h },
        precioKg: nz(it.material.precioKg),
        pesoChapa,
        costoChapa: pesoChapa * nz(it.material.precioKg),
        chapasExactas: 0,
        areaConsumidaMM2: 0,
        piezas: 0,
        // Lo lleno que queda el ÚLTIMO programa. Es de donde sale el retazo
        // real: las chapas anteriores están llenas por construcción.
        aprovUltima: null,
        // Lo que el cotizador cobró de material para este grupo. Se toma de
        // ahí y no se recalcula: si difiere, la lista de compra estaría
        // contradiciendo al precio que se le pasó al cliente.
        costoCotizado: 0,
        items: [],
      });
    }
    const g = porClave.get(clave);
    if (g.aprovUltima == null && Number.isFinite(nst.aprovechamientoUltima)) {
      g.aprovUltima = nst.aprovechamientoUltima;
    }

    /* Las chapas de un grupo compartido se cuentan UNA vez, no una por ítem.
       Sumar `nst.chapas` de cada miembro daría lo mismo salvo por el error de
       coma flotante, pero este número se usa para comprar: se cuenta el total
       del grupo, que es el entero que salió del anidado real. */
    if (nst.compartido) {
      if (!gruposContados.has(nst.grupo)) {
        gruposContados.add(nst.grupo);
        g.chapasExactas += nz(nst.chapasGrupo);
      }
    } else {
      g.chapasExactas += nz(nst.chapas);
    }

    g.piezas += it.cantidad;
    g.costoCotizado += nz(it.costos?.material);
    g.areaConsumidaMM2 += nz(it.geometria.areaNetaMM2) * it.cantidad;
    g.items.push({ nombre: it.nombre, cantidad: it.cantidad, pesoTotal: nz(it.geometria.pesoTotal) });
  }

  const lineas = [];
  for (const g of porClave.values()) {
    // Se compran chapas enteras: el proveedor no vende media.
    const chapas = redondear ? Math.ceil(g.chapasExactas - 1e-9) : g.chapasExactas;
    const areaChapaMM2 = g.chapa.w * g.chapa.h;
    const pesoTotal = g.pesoChapa * chapas;
    const costoTotal = g.costoChapa * chapas;
    const pesoEntregado = g.items.reduce((a, i) => a + i.pesoTotal, 0);
    const aprovechamiento = pesoTotal > 0 ? pesoEntregado / pesoTotal : 0;

    /* El sobrante de la ÚLTIMA chapa. Las anteriores están llenas por
       construcción del anidado, así que el retazo aprovechable es lo que
       queda libre en el último programa. Un 40 % de una 3000×1500 son 1,8 m²
       de chapa buena que hay que guardar identificada, no tirar.

       Si el anidado no reportó el dato de la última, se cae al redondeo de
       chapas, que es la cota inferior: preferimos subestimar el retazo antes
       que prometer uno que no existe. */
    const sobranteFraccion =
      g.aprovUltima != null ? Math.max(0, 1 - g.aprovUltima) : redondear ? chapas - g.chapasExactas : 0;
    const retazoM2 = (sobranteFraccion * areaChapaMM2) / 1e6;

    /* Lo que el trabajo REALMENTE consume, que no es lo mismo que lo que hay
       que ir a comprar. Cuando el anidado deja media chapa libre, esa mitad
       no se gasta en este trabajo: se guarda como retazo y se usa en el
       siguiente. Es el número que el cotizador ya decidió al elegir entre
       cobrar chapas enteras o área consumida. */
    const costoConsumido = g.costoCotizado;
    // Debajo de este uso no se compra chapa nueva: se busca en el retazero.
    const desdeRetazo = chapas === 1 && (g.aprovUltima ?? 1) < 0.35;

    lineas.push({
      ...g,
      chapas,
      costoConsumido,
      desdeRetazo,
      pesoTotal,
      costoTotal,
      pesoEntregado,
      pesoRecorte: pesoTotal - pesoEntregado,
      aprovechamiento,
      sobranteFraccion,
      retazoM2,
      retazoKg: g.pesoChapa * sobranteFraccion,
      retazoValor: g.costoChapa * sobranteFraccion,
      // Qué pedirle al proveedor, escrito como se pide por teléfono
      pedido:
        `${chapas} chapa${chapas === 1 ? '' : 's'} de ${g.material} de ${g.espesor} mm, ` +
        `${g.chapa.w} × ${g.chapa.h} mm (${pesoTotal.toFixed(1)} kg)`,
    });
  }

  lineas.sort((a, b) => b.costoTotal - a.costoTotal);

  const total = lineas.reduce((a, l) => a + l.costoTotal, 0);
  const pesoTotal = lineas.reduce((a, l) => a + l.pesoTotal, 0);
  const retazoValor = lineas.reduce((a, l) => a + l.retazoValor, 0);

  /* Avisos accionables, no decorativos. Cada uno tiene que sugerir algo que
     se pueda hacer antes de llamar al proveedor. */
  const avisos = [];
  for (const l of lineas) {
    if (l.desdeRetazo) {
      /* Este es el caso de la pieza suelta. Decir "comprá una chapa de
         3000×1500" para un trabajo que usa el 1 % es un mal consejo: el
         taller lo saca del retazero y por eso el cotizador cobra por área
         consumida y no por chapa entera. */
      avisos.push({
        nivel: 'info',
        clave: l.clave,
        msg:
          `El trabajo usa apenas el ${((l.aprovUltima ?? 0) * 100).toFixed(0)} % de una chapa de ${l.espesor} mm. ` +
          'Buscalo primero en el retazero: no hace falta chapa nueva.',
      });
    } else if (l.sobranteFraccion > 0.35 && l.chapas >= 1) {
      avisos.push({
        nivel: 'aviso',
        clave: l.clave,
        msg:
          `Sobra ${(l.sobranteFraccion * 100).toFixed(0)} % de la última chapa de ${l.material} ` +
          `de ${l.espesor} mm: ${l.retazoM2.toFixed(2)} m² por ${moneda(l.retazoValor)}. ` +
          'Es chapa buena — guardala identificada o metele otro pedido del mismo espesor.',
      });
    }
    if (!l.desdeRetazo && l.aprovechamiento > 0 && l.aprovechamiento < 0.5) {
      avisos.push({
        nivel: 'aviso',
        clave: l.clave,
        msg:
          `De las ${l.chapas} chapas de ${l.espesor} mm se entrega el ${(l.aprovechamiento * 100).toFixed(0)} % en piezas. ` +
          `Quedan ${l.pesoRecorte.toFixed(1)} kg de recorte: revisá si conviene juntar este trabajo con otro.`,
      });
    }
  }
  if (lineas.length > 3) {
    avisos.push({
      nivel: 'info',
      msg:
        `${lineas.length} tipos de chapa distintos en un solo presupuesto. ` +
        'Pedí todo junto: el flete a La Rioja se cobra por viaje, no por kilo.',
    });
  }

  /* Qué parte del precio se va en material. Se mide contra lo que el trabajo
     CONSUME, no contra las chapas enteras que hay que ir a buscar: una pieza
     suelta que sale de un retazo daría 2.685 % y el número dejaría de servir
     para lo único que sirve — saber si el anticipo alcanza. */
  const consumido = lineas.reduce((a, l) => a + l.costoConsumido, 0);
  const subtotal = cotizacion?.resumen?.subtotal ?? 0;

  return {
    lineas,
    total,
    consumido,
    pesoTotal,
    retazoValor,
    avisos,
    sobreVenta: subtotal > 0 ? consumido / subtotal : null,
  };
}

/** Texto para copiar y mandarle al proveedor por WhatsApp. */
export function pedidoEnTexto(lista, { encabezado = 'Buen día, necesito cotización de:' } = {}) {
  if (!lista?.lineas?.length) return '';
  const l = [encabezado, ''];
  for (const x of lista.lineas) l.push(`• ${x.pedido}`);
  l.push('', `Total aproximado: ${lista.pesoTotal.toFixed(0)} kg.`);
  return l.join('\n');
}

const moneda = (v) =>
  `$ ${Number.isFinite(v) ? v.toLocaleString('es-AR', { maximumFractionDigits: 0 }) : '—'}`;
