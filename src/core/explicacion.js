/**
 * De dónde sale cada número.
 *
 * El cotizador tira un precio. Este módulo arma la cuenta que lo produjo,
 * paso a paso y con los números puestos, para poder mostrarla al lado.
 *
 * Por qué existe: un precio sin explicación no se puede defender ni corregir.
 * Cuando un cliente pregunta "¿por qué me sale esto?" hay que poder abrir la
 * cuenta en el mostrador. Y cuando el número parece raro, la única manera de
 * encontrar el dato mal cargado es ver de dónde salió — ya pasó una vez con
 * los consumibles a $150.000/h.
 *
 * No calcula NADA. Lee el resultado de `cotizarItem()` y lo narra. Si acá
 * apareciera una cuenta propia, tarde o temprano diría algo distinto de lo
 * que se cobra, que es justo lo que este módulo tiene que evitar.
 */

/* ── Formato ────────────────────────────────────────────────────────────── */

const num = (v, d = 2) =>
  Number.isFinite(v)
    ? v.toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d })
    : '—';

const money = (v, d = 0) => `$ ${num(v, d)}`;

const tiempo = (s) => {
  if (!Number.isFinite(s) || s < 0) return '—';
  if (s < 60) return `${num(s, 1)} s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s % 60);
  if (m < 60) return `${m}m ${r}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
};

/** Niveles de confianza, los mismos de docs/PRECIOS.md. */
export const NIVELES = {
  verificado: { icono: '🟢', texto: 'Verificado con fuente' },
  estimado: { icono: '🟡', texto: 'Estimado a partir de datos verificados' },
  confirmar: { icono: '🔴', texto: 'A confirmar: pedí la cotización' },
  medido: { icono: '🟢', texto: 'Medido por simulación del recorrido' },
};

const paso = (concepto, cuenta, valor = null, nota = null) => ({ concepto, cuenta, valor, nota });

/* ── Explicación de un ítem cotizado ───────────────────────────────────── */

/**
 * @param {Object} r resultado de `cotizarItem()`
 * @param {Object} ctx { config } — sólo para leer parámetros comerciales
 * @returns {{bloques: Array, cadena: Array, resumen: Object}}
 */
export function explicarItem(r, ctx = {}) {
  if (!r || r.error) return { bloques: [], cadena: [], resumen: null };
  const cfg = ctx.config || {};
  const com = cfg.comercial || {};
  const g = r.geometria;
  const c = r.costos;
  const n = r.cantidad;

  const bloques = [];

  /* ── Geometría: es el insumo de todo lo demás ─────────────────────── */
  bloques.push({
    id: 'geometria',
    titulo: 'Geometría de la pieza',
    importe: null,
    resumen: `${num(g.ancho, 1)} × ${num(g.alto, 1)} mm · ${num(g.pesoPieza, 3)} kg/u`,
    nivel: 'medido',
    fuente:
      'Medido sobre el contorno real. El área y el rectángulo envolvente se ' +
      'calculan de forma exacta con arcos, no aproximando las curvas por ' +
      'polígonos: aproximar subestima el peso y con él el precio.',
    pasos: [
      paso('Rectángulo envolvente', `${num(g.ancho, 1)} × ${num(g.alto, 1)} mm`),
      paso(
        'Área de material',
        `${num(g.areaNetaMM2 / 1e6, 4)} m² (contorno menos agujeros)`,
        null,
        g.areaBBoxMM2 > g.areaNetaMM2 * 1.01
          ? `El envolvente son ${num(g.areaBBoxMM2 / 1e6, 4)} m²: la diferencia es lo que se recorta.`
          : null
      ),
      paso('Largo de corte', `${num(g.largoCorteMM / 1000, 3)} m por pieza`),
      paso('Perforaciones', `${g.piercings} por pieza`),
      paso(
        'Peso unitario',
        `${num(g.areaNetaMM2 / 1e6, 4)} m² × ${num(r.espesor, 2)} mm × ${num(r.material.densidad, 2)} g/cm³ = ${num(g.pesoPieza, 3)} kg`,
        g.pesoPieza
      ),
      paso('Peso del lote', `${num(g.pesoPieza, 3)} kg × ${n} u = ${num(g.pesoTotal, 2)} kg`, g.pesoTotal),
    ],
  });

  /* ── Material ──────────────────────────────────────────────────────── */
  const nst = r.nesting || {};
  const chapa = nst.chapa || {};
  const pasosMat = [
    paso(
      'Chapa de compra',
      `${num(chapa.w, 0)} × ${num(chapa.h, 0)} mm × ${num(r.espesor, 2)} mm = ${num(c.pesoChapa, 2)} kg`
    ),
    paso(
      'Costo de la chapa entera',
      `${num(c.pesoChapa, 2)} kg × ${money(r.material.precioKg, 0)}/kg = ${money(c.costoChapa)}`,
      c.costoChapa
    ),
  ];
  if (nst.aprovechamiento) {
    pasosMat.push(
      paso(
        'Anidado',
        `${num(nst.aprovechamiento * 100, 1)} % de aprovechamiento` +
          (nst.piezasPorChapa ? ` · ${nst.piezasPorChapa} piezas por chapa` : ''),
        null,
        nst.compartido
          ? `Anidado junto con ${nst.itemsEnGrupo} ítems del mismo material, espesor y gas: la máquina corta un programa por chapa, no un ítem por chapa.`
          : `Método: ${nst.metodo || 'forma real'}.`
      )
    );
    pasosMat.push(
      paso(
        'Chapas necesarias',
        nst.compartido
          ? `${num(nst.chapasGrupo, 2)} en el grupo, de las cuales le tocan ${num(nst.chapas, 3)} por el área que ocupa`
          : `${num(nst.chapas, 2)}`
      )
    );
  }
  pasosMat.push(
    paso(
      `Criterio de cobro: ${c.modoMaterial}`,
      c.modoMaterial.startsWith('Chapas')
        ? `${num(nst.chapas ?? 0, 3)} chapas × ${money(c.costoChapa)} = ${money(c.material)}`
        : `área realmente consumida ÷ aprovechamiento objetivo ${num((com.aprovechamientoObjetivo ?? 0.75) * 100, 0)} %` +
          (com.scrapMinimo ? ` + ${num(com.scrapMinimo, 0)} % de scrap` : ''),
      c.material,
      c.modoMaterial.startsWith('Área')
        ? 'Se cobra por área porque el recorte queda utilizable: si se cobrara la chapa entera, el cliente pagaría un retazo que se usa en otro trabajo.'
        : 'Se cobra la chapa entera porque el anidado la deja llena: no queda recorte aprovechable.'
    )
  );
  bloques.push({
    id: 'material',
    titulo: 'Material',
    importe: c.material,
    resumen: `${money(r.material.precioKg, 0)}/kg de compra · ${c.modoMaterial}`,
    nivel: r.material.id === 'acero-sae1010' ? 'verificado' : 'estimado',
    fuente:
      r.material.id === 'acero-sae1010'
        ? 'Precio de compra confirmado por el taller (factura, agosto 2026). Es el dato más confiable del sistema.'
        : 'Derivado del acero al carbono verificado usando la relación de precio entre metales, que es estable aunque el valor absoluto se mueva. Ver docs/PRECIOS.md.',
    pasos: pasosMat,
    avisos:
      nst.aprovechamiento && nst.aprovechamiento < 0.6
        ? [
            `Con ${num(nst.aprovechamiento * 100, 0)} % de aprovechamiento el recorte lo paga alguien. ` +
              'Probá subir la cantidad o combinar esta pieza con otra del mismo espesor.',
          ]
        : [],
  });

  /* ── Corte láser: producción ───────────────────────────────────────── */
  const co = r.corte || {};
  const hl = c.desgloseHoraLaser || {};
  bloques.push({
    id: 'corte',
    titulo: 'Corte láser (producción)',
    importe: c.corte,
    resumen: `${tiempo(co.tProduccion)} × ${money(c.costoHoraLaser)}/h`,
    nivel: 'medido',
    fuente:
      'El tiempo NO es largo ÷ velocidad de catálogo. Se simula el recorrido ' +
      'real de la máquina: aceleración, frenado en cada esquina según su ' +
      'ángulo, límite de velocidad en los arcos por la fuerza centrípeta y ' +
      'anticipación de los tramos siguientes. La velocidad de corte sale de ' +
      'la tabla del material para este gas y espesor.',
    pasos: [
      paso(
        'Velocidad de tabla',
        `${num(co.vNominal, 0)} mm/min en ${r.material.nombre} de ${num(r.espesor, 2)} mm con ${co.gasNombre || co.gasTipo}`
      ),
      paso(
        'Velocidad media real',
        `${num(co.vMediaEfectiva, 0)} mm/min` +
          (co.penalizacion > 0 ? ` (${num(co.penalizacion * 100, 0)} % por debajo de la nominal)` : ''),
        null,
        'Menor que la de tabla: la máquina frena en cada esquina y en los agujeros chicos. Esa diferencia es la que casi ningún cotizador modela.'
      ),
      paso('Recorrido total', `${num((co.longitudTotal ?? 0) / 1000, 2)} m de corte · ${co.piercingsTotal ?? 0} perforaciones`),
      paso('Tiempo de producción', tiempo(co.tProduccion), null, `Para las ${n} piezas del lote.`),
      paso(
        'Costo de la hora de máquina',
        [
          hl.amortizacion ? `amortización ${money(hl.amortizacion)}` : null,
          hl.energia ? `energía ${money(hl.energia)}` : null,
          hl.consumibles ? `consumibles ${money(hl.consumibles)}` : null,
          hl.mantenimiento ? `mantenimiento ${money(hl.mantenimiento)}` : null,
          hl.operario ? `operario ${money(hl.operario)}` : null,
          hl.estructura ? `estructura ${money(hl.estructura)}` : null,
        ]
          .filter(Boolean)
          .join(' + ') + ` = ${money(c.costoHoraLaser)}/h`,
        c.costoHoraLaser,
        'La potencia eléctrica contratada NO está acá: es un costo fijo mensual que se paga se use o no la máquina, y va en estructura repartida por hora productiva.'
      ),
      paso('Costo de producción', `${tiempo(co.tProduccion)} × ${money(c.costoHoraLaser)}/h = ${money(c.corte)}`, c.corte),
    ],
  });

  /* ── Puesta a punto ────────────────────────────────────────────────── */
  bloques.push({
    id: 'preparacion',
    titulo: 'Puesta a punto',
    importe: c.preparacion,
    resumen: `${tiempo(c.tPreparacion)} · ${num(c.preparacionPct * 100, 0)} % del costo`,
    nivel: 'estimado',
    fuente:
      'Programar la máquina y cargar cada chapa. Va en su propia línea a ' +
      'propósito: sumarla al corte hacía que un trabajo de una pieza mostrara ' +
      'minutos de "corte láser" cuando cortarla son segundos.',
    pasos: [
      paso('Setup del programa', tiempo(co.tSetup || 0), null, 'Uno por programa, no por pieza.'),
      paso('Carga de chapas', tiempo(co.tChapas || 0)),
      paso('Costo', `${tiempo(c.tPreparacion)} × ${money(c.costoHoraLaser)}/h = ${money(c.preparacion)}`, c.preparacion),
    ],
    avisos:
      c.preparacionPct > 0.4
        ? [
            `La preparación es el ${num(c.preparacionPct * 100, 0)} % del costo. ` +
              'Con más cantidad el unitario baja fuerte: mostrale al cliente el precio por 10 y por 50.',
          ]
        : [],
  });

  /* ── Gas ───────────────────────────────────────────────────────────── */
  const alt = (r.alternativasGas || []).filter((a) => a && a.gas !== c.gasTipo && Number.isFinite(a.costoGas));
  bloques.push({
    id: 'gas',
    titulo: `Gas de asistencia (${c.gasTipo})`,
    importe: c.gas,
    resumen: `${num(c.gasM3, 3)} m³ × ${money(c.precioGasM3)}/m³`,
    nivel: 'confirmar',
    fuente:
      'El precio del gas es el número más incierto del sistema: los gases ' +
      'industriales no tienen lista pública, se cotizan por cliente y por ' +
      'volumen. El consumo sí es firme: sale del caudal de la tabla del ' +
      'material por el tiempo que el haz está encendido.',
    pasos: [
      paso(
        'Caudal',
        `${num(co.gasCaudal ?? 0, 1)} m³/h a ${num(co.gasPresion ?? 0, 1)} bar · boquilla ${num(co.boquilla ?? 0, 1)} mm`
      ),
      paso('Consumo del lote', `${num(c.gasM3, 3)} m³`),
      paso('Costo', `${num(c.gasM3, 3)} m³ × ${money(c.precioGasM3)}/m³ = ${money(c.gas)}`, c.gas),
      ...alt.map((a) =>
        paso(
          `Si se cortara con ${a.nombre || a.gas}`,
          `${money(a.costoGas)} de gas · ${a.calidad}`,
          null,
          a.costoGas < c.gas
            ? `Saldría ${money(c.gas - a.costoGas)} menos en este lote. ${a.notas || ''}`.trim()
            : `Saldría ${money(a.costoGas - c.gas)} más. ${a.notas || ''}`.trim()
        )
      ),
    ],
    avisos:
      c.gasTipo === 'N2' && c.gas > c.corte
        ? ['El nitrógeno cuesta más que la hora de máquina en este trabajo. Es el caso donde un generador de N₂ se paga solo: mirá la calculadora en Costos.']
        : [],
  });

  /* ── Plegado ───────────────────────────────────────────────────────── */
  if (c.plegado > 0 && r.plegado) {
    const p = r.plegado;
    const dp = r.datosPliegue || {};
    bloques.push({
      id: 'plegado',
      titulo: 'Plegado',
      importe: c.plegado,
      resumen: `${p.nPliegues} pliegues × ${n} u · ${tiempo(p.tTotal)}`,
      nivel: 'estimado',
      fuente:
        'Tiempo por pliegue según el largo y el peso de la pieza (arriba de ' +
        'cierto peso hace falta un segundo operario). El desarrollo usa el ' +
        'K-factor del material, no una regla fija.',
      pasos: [
        paso('Matriz', `V${dp.matrizV ?? '—'} · radio interno ${num(dp.radioInterno, 1)} mm`),
        paso('Fuerza', `${num(dp.toneladas, 1)} t para ${num(p.largoPliegue, 0)} mm de pliegue`),
        paso('Tiempo', `${p.nPliegues} pliegues × ${n} piezas = ${tiempo(p.tTotal)}`),
        paso(
          'Costo',
          `${tiempo(p.tTotal)} × ${money(p.costoHora?.total ?? 0)}/h = ${money(c.plegado)}`,
          c.plegado,
          'La hora de plegadora es distinta de la de láser: menos amortización, más operario.'
        ),
      ],
    });
  }

  /* ── Acabado y procesos ────────────────────────────────────────────── */
  if (c.acabado > 0 && c.detalleAcabado) {
    const d = c.detalleAcabado;
    bloques.push({
      id: 'acabado',
      titulo: `Acabado: ${d.nombre}`,
      importe: c.acabado,
      resumen: d.base === 'superficie' ? `${num(d.superficieM2, 3)} m² (las dos caras)` : `${num(d.pesoTotal, 2)} kg`,
      nivel: 'confirmar',
      fuente: 'Tarifa del proveedor de tratamiento. Confirmala: varía mucho por lote y por color.',
      pasos: [
        paso(
          'Base de cobro',
          d.base === 'superficie'
            ? `${num(d.superficieM2, 3)} m² × tarifa = ${money(c.acabado)}`
            : `${num(d.pesoTotal, 2)} kg × tarifa = ${money(c.acabado)}`,
          c.acabado
        ),
      ],
    });
  }
  if (c.procesos > 0) {
    bloques.push({
      id: 'procesos',
      titulo: 'Procesos adicionales',
      importe: c.procesos,
      resumen: c.detalleProcesos.map((p) => p.nombre).join(', '),
      nivel: 'estimado',
      fuente: 'Tarifas cargadas en Configuración → Procesos.',
      pasos: c.detalleProcesos.map((p) =>
        paso(p.nombre, `${num(p.cantidad, 0)} ${p.unidad} → ${money(p.costo)}`, p.costo)
      ),
    });
  }
  if (c.ingenieria > 0) {
    bloques.push({
      id: 'ingenieria',
      titulo: 'Ingeniería',
      importe: c.ingenieria,
      resumen: `${num(c.ingenieria / Math.max(1, com.ingenieriaHora || 1), 1)} h`,
      nivel: 'estimado',
      fuente: 'Horas de dibujo, corrección de archivo o desarrollo, a la tarifa de Configuración.',
      pasos: [paso('Horas × tarifa', `${money(com.ingenieriaHora || 0)}/h = ${money(c.ingenieria)}`, c.ingenieria)],
    });
  }

  /* ── Del costo al precio ───────────────────────────────────────────── */
  const pr = r.precio;
  const cadena = [];
  cadena.push({
    etiqueta: 'Costo total',
    valor: c.total,
    cuenta: bloques
      .filter((b) => b.importe > 0)
      .map((b) => `${b.titulo.split(' (')[0]} ${money(b.importe)}`)
      .join(' + '),
  });
  cadena.push({
    etiqueta: `Margen ${num(pr.margen, 0)} %`,
    valor: pr.lista,
    cuenta: `${money(c.total)} × ${num(1 + pr.margen / 100, 2)} = ${money(pr.lista)}`,
    nota:
      'El margen es lo que queda para reinvertir, cubrir los trabajos que ' +
      'salen mal y crecer. No es ganancia limpia: los impuestos y los gastos ' +
      'que no se pueden imputar a un trabajo salen de acá.',
    interno: true,
  });
  if (pr.descuentoPct > 0) {
    cadena.push({
      etiqueta: `Descuento por cantidad ${num(pr.descuentoPct, 0)} %`,
      valor: pr.lista * (1 - pr.descuentoPct / 100),
      cuenta: `${money(pr.lista)} × ${num(1 - pr.descuentoPct / 100, 2)}`,
      nota: 'Se justifica porque el setup se reparte entre más piezas: el costo unitario realmente baja.',
    });
  }
  if (pr.recargoPct > 0) {
    cadena.push({
      etiqueta: `Recargo por urgencia ${num(pr.recargoPct, 0)} %`,
      valor: null,
      cuenta: `× ${num(1 + pr.recargoPct / 100, 2)}`,
      nota: 'Un trabajo urgente desplaza a otro que ya estaba programado.',
    });
  }
  if (pr.iibbPct > 0) {
    cadena.push({
      etiqueta: `Ingresos brutos ${num(pr.iibbPct, 1)} %`,
      valor: pr.iibb,
      cuenta: `+ ${money(pr.iibb)}`,
      nota:
        'Es un impuesto sobre la facturación, no sobre la ganancia: se paga ' +
        'aunque el trabajo se haga a pérdida. Si no se traslada al precio, ' +
        'sale del margen. Preguntale a tu contador si te corresponde alguna ' +
        'exención por actividad industrial en La Rioja.',
    });
  }
  if (pr.aplicoMinimo) {
    cadena.push({
      etiqueta: 'Mínimo por ítem',
      valor: pr.neto,
      cuenta: `se aplicó el mínimo de ${money(com.minimoPorItem || 0)}`,
      nota: 'Debajo de este número el trabajo no paga ni la atención al cliente.',
    });
  }
  cadena.push({
    etiqueta: 'Precio final',
    valor: pr.neto,
    cuenta: `${money(pr.neto)} por ${n} u = ${money(pr.unitario, 2)} c/u`,
    fuerte: true,
  });

  return {
    bloques,
    cadena,
    resumen: {
      costo: c.total,
      neto: pr.neto,
      unitario: pr.unitario,
      utilidad: pr.utilidad,
      utilidadPct: pr.utilidadPct,
      // Qué pesa más. Ordenado para poder decir "el 97 % de esto es material".
      participacion: bloques
        .filter((b) => b.importe > 0)
        .map((b) => ({ id: b.id, titulo: b.titulo, importe: b.importe, pct: (b.importe / c.total) * 100 }))
        .sort((a, b) => b.importe - a.importe),
    },
  };
}

/* ── Explicación de una tarifa del tarifario ───────────────────────────── */

/**
 * Narra cómo se llegó a una tarifa por m², por kg o por metro de corte.
 *
 * @param {Object} b   la banda de complejidad de `generarTarifario()`,
 *                     o sea `fila.bandas[id]`
 * @param {Object} ctx { base, espesor, banda, material, margen }
 */
export function explicarTarifa(b, ctx = {}) {
  if (!b) return null;
  const base = ctx.base || 'm2';
  const suf = { m2: 'M2', kg: 'Kg', metro: 'Metro' }[base] || 'M2';
  const unidad = { m2: 'm²', kg: 'kg', metro: 'm de corte' }[base] || 'm²';
  const costo = b['costo' + suf];
  const minimo = b['minimo' + suf];
  const precio = b['precio' + suf];
  const material = b['material' + suf] ?? null;
  const proceso = b['proceso' + suf] ?? null;
  const margen = ctx.margen ?? null;

  const pasos = [];

  pasos.push(
    paso(
      'Cómo se obtiene',
      `Se cotiza una pieza real de complejidad "${ctx.banda || 'la elegida'}" en ${num(ctx.espesor ?? 0, 2)} mm, ` +
        `en la cantidad que llena una chapa, y se divide su costo por los ${unidad} que entrega.`,
      null,
      'Usa el mismo motor que las cotizaciones. Por eso el tarifario y el cotizador nunca se contradicen.'
    )
  );

  if (material != null && base === 'kg') {
    pasos.push(
      paso(
        'Kilo entregado',
        `${money(material)}/kg de material` +
          (b.aprovechamiento
            ? ` — el de compra más el recorte, con el anidado al ${num(b.aprovechamiento * 100, 0)} %`
            : ''),
        material,
        'El kilo que se entrega NO cuesta el kilo que se compró: el recorte lo paga el taller. ' +
          'Cualquier cuenta de $/kg que use el precio de compra directo subestima el costo casi un 30 %.'
      )
    );
  } else if (material != null) {
    pasos.push(paso(`Material por ${unidad}`, money(material), material));
  }
  if (proceso != null) {
    pasos.push(
      paso(
        `Proceso por ${unidad}`,
        money(proceso),
        proceso,
        `Corte, gas y puesta a punto: ${num(b.minutosPorM2 ?? 0, 1)} minutos de máquina por m².`
      )
    );
  }
  pasos.push(paso(`Costo por ${unidad}`, money(costo, 2), costo));
  if (minimo != null) {
    pasos.push(
      paso(
        'Piso',
        `${money(minimo, 2)} por ${unidad}`,
        minimo,
        'Debajo de esto se trabaja a pérdida: es el costo más los ingresos brutos, sin un peso de margen.'
      )
    );
  }
  if (precio != null) {
    pasos.push(
      paso(
        `Precio sugerido por ${unidad}`,
        margen != null
          ? `${money(costo, 2)} × ${num(1 + margen / 100, 2)} (margen ${num(margen, 0)} %) + IIBB = ${money(precio, 2)}`
          : money(precio, 2),
        precio
      )
    );
  }
  if (b.metrosCorteM2) {
    pasos.push(
      paso(
        'Complejidad de la banda',
        `${num(b.metrosCorteM2, 0)} m de corte por m²`,
        null,
        'Una placa lisa tiene 14 m/m² y una perforada 160: por eso una sola tarifa por m² no puede servir para todo.'
      )
    );
  }

  /* Devuelve la misma forma que un bloque de `explicarItem()` para que la
     interfaz pueda dibujarlos con el mismo componente. */
  return {
    id: `tarifa-${ctx.espesor}-${ctx.banda}-${base}`,
    titulo: `${num(ctx.espesor ?? 0, 2)} mm · ${ctx.banda || ''} · por ${unidad}`,
    importe: precio,
    resumen: `costo ${money(costo, 2)} · piso ${money(minimo, 2)} · sugerido ${money(precio, 2)}`,
    pasos,
    nivel: 'estimado',
    fuente:
      'Cotización real de una pieza representativa dividida por lo que ' +
      'entrega. La confianza de este número es la del dato que más pesa: el ' +
      'precio de compra de la chapa (verificado) y el del gas (a confirmar).',
  };
}

/* ── Texto plano, para copiar y pegar en un mail ───────────────────────── */

/**
 * Sólo los bloques que el cliente puede ver. La cadena de precio va marcada
 * `interno: true` en el margen justamente para poder excluirla acá: el
 * presupuesto que sale del taller no muestra nuestra ganancia.
 */
export function explicacionEnTexto(exp, { incluirInterno = false } = {}) {
  if (!exp) return '';
  const l = [];
  for (const b of exp.bloques) {
    l.push(`${b.titulo}${b.importe != null ? ` — ${money(b.importe)}` : ''}`);
    for (const p of b.pasos) l.push(`   · ${p.concepto}: ${p.cuenta}`);
    if (b.fuente) l.push(`   (${b.fuente})`);
    l.push('');
  }
  for (const c of exp.cadena) {
    if (c.interno && !incluirInterno) continue;
    l.push(`${c.etiqueta}: ${c.cuenta}`);
  }
  return l.join('\n');
}
