/**
 * KORT - Costos de estructura
 *
 * La pantalla más importante del sistema para el bolsillo. Acá se ve cuánto
 * cuesta tener el taller abierto una hora, de dónde sale ese número y cuánto
 * hay que facturar para no perder plata.
 */

import { h, vaciar, toast, money, num, pct, formulario, modal, cerrarModal } from '../ui.js';
import { api, estado as G, simbolo, guardarConfig } from '../api.js';
import {
  calcularEstructura, puntoEquilibrio, evaluarGeneradorN2,
  costoHoraOperario, UOM_RAMA17, CARGAS_LABORALES, TARIFAS_EDELAR,
} from '/src/core/costos.js';
import { calcularCostoHoraMaquina } from '/src/core/costos.js';

export async function render(cont) {
  const sim = simbolo();
  let cfg = JSON.parse(JSON.stringify(G.config));
  cfg.estructura = cfg.estructura || {};

  const panelResultado = h('div');
  const panelMaquinas = h('div');

  cont.appendChild(
    h('div.cabecera-vista',
      h('div',
        h('h1', 'Costos de estructura'),
        h('p.sub', 'Cuánto cuesta tener el taller abierto una hora, y de dónde sale ese número')
      ),
      h('div.acciones',
        h('button', { onclick: abrirCalculadoraSueldo }, '👷 Calcular hora de operario'),
        h('button', { onclick: abrirGeneradorN2 }, '⚗ ¿Conviene un generador de N₂?'),
        h('button.btn-primario', { onclick: guardar }, '💾 Guardar')
      )
    )
  );

  cont.appendChild(
    h('div.aviso.aviso-aviso',
      h('span', '⚠'),
      h('div',
        h('strong', 'Estos números son de referencia para La Rioja, no son los tuyos. '),
        'La tarifa eléctrica sí es la real de EDELAR (Res. EUCOP 001/2026) y el sueldo sale del convenio UOM rama 17. ',
        'El alquiler, los seguros y el resto están puestos para que el sistema arranque con un orden de magnitud creíble: cambialos por lo que pagás vos.')
    )
  );

  /* ---------------- Formularios ---------------- */

  const selTarifa = h('select',
    ...TARIFAS_EDELAR.categorias.map((t) =>
      h('option', { value: t.id, selected: t.id === cfg.estructura.tarifa }, t.nombre))
  );
  selTarifa.onchange = () => {
    const t = TARIFAS_EDELAR.categorias.find((x) => x.id === selTarifa.value);
    cfg.estructura.tarifa = t.id;
    cfg.estructura.cargoPotenciaKWMes = t.cargoPotenciaKWMes;
    cfg.estructura.cargoFijoElectricoMes = t.cargoFijoMes;
    cfg.estructura.costoKWh = t.energiaResto;
    render2();
    refrescar();
  };

  const formHoras = () => formulario(
    [
      { key: 'diasHabilesMes', label: 'Días hábiles por mes', tipo: 'num', entero: true, ancho: 'medio' },
      { key: 'horasPorDia', label: 'Horas por día', tipo: 'num', ancho: 'medio' },
      { key: 'ocupacionProductiva', label: 'Ocupación productiva', tipo: 'num', unidad: '%' },
    ],
    cfg.estructura, (k, v) => { cfg.estructura[k] = v; refrescar(); }
  );

  const formLuz = () => formulario(
    [
      { key: 'potenciaContratadaKW', label: 'Potencia contratada', tipo: 'num', unidad: 'kW', ancho: 'medio' },
      { key: 'cargoPotenciaKWMes', label: 'Cargo por potencia', tipo: 'num', unidad: '$/kW-mes', ancho: 'medio' },
      { key: 'cargoFijoElectricoMes', label: 'Cargo fijo mensual', tipo: 'num', unidad: '$', ancho: 'medio' },
      { key: 'costoKWh', label: 'Energía', tipo: 'num', unidad: '$/kWh', ancho: 'medio' },
    ],
    cfg.estructura, (k, v) => { cfg.estructura[k] = v; refrescar(); }
  );

  const formGastos = () => formulario(
    [
      { key: 'alquilerMes', label: 'Alquiler del galpón', tipo: 'num', unidad: '$/mes' },
      { key: 'expensasServiciosMes', label: 'Agua, internet, teléfono, limpieza', tipo: 'num', unidad: '$/mes' },
      { key: 'sueldosIndirectosMes', label: 'Sueldos que no producen', tipo: 'num', unidad: '$/mes' },
      { key: 'contadorMes', label: 'Contador y honorarios', tipo: 'num', unidad: '$/mes', ancho: 'medio' },
      { key: 'segurosMes', label: 'Seguros', tipo: 'num', unidad: '$/mes', ancho: 'medio' },
      { key: 'tasaMunicipalMes', label: 'Tasa municipal', tipo: 'num', unidad: '$/mes', ancho: 'medio' },
      { key: 'otrosFijosMes', label: 'Otros gastos fijos', tipo: 'num', unidad: '$/mes', ancho: 'medio' },
      { key: 'cuotaCreditoMes', label: 'Cuota de crédito de la máquina', tipo: 'num', unidad: '$/mes', ancho: 'medio' },
      { key: 'ingresosBrutosPct', label: 'Ingresos brutos', tipo: 'num', unidad: '%', ancho: 'medio' },
    ],
    cfg.estructura, (k, v) => { cfg.estructura[k] = v; refrescar(); }
  );

  const raiz = h('div.grid.g2');
  cont.appendChild(raiz);
  cont.appendChild(panelResultado);
  cont.appendChild(panelMaquinas);

  function render2() {
    vaciar(raiz);
    raiz.appendChild(
      h('div',
        h('div.panel.mb',
          h('div.panel-cab', h('h3', 'Horas de trabajo')),
          h('div.panel-cuerpo',
            formHoras().el,
            h('p.chico.suave', { style: { margin: 0 } },
              'La ocupación productiva es el porcentaje de horas abiertas en que realmente hay una máquina haciendo algo facturable. En un taller chico ronda el 55-70 %. Bajala y mirá cómo sube el costo por hora: eso es lo que pasa en un mes flojo.'))
        ),
        h('div.panel',
          h('div.panel-cab', h('h3', 'Energía eléctrica'), h('span.chico.tenue', 'EDELAR')),
          h('div.panel-cuerpo',
            h('div.campo', h('label', 'Categoría tarifaria'), selTarifa),
            formLuz().el,
            h('div.aviso.aviso-info', h('span', 'ⓘ'),
              h('div', h('strong', 'El cargo por potencia se paga se use o no. '),
                'Con 30 kW contratados son casi $280.000 por mes antes de encender la máquina. Si tenés contratada más potencia de la que usás, estás tirando plata: revisá la demanda máxima real en la factura.')))
        )
      )
    );
    raiz.appendChild(
      h('div.panel',
        h('div.panel-cab', h('h3', 'Gastos fijos mensuales')),
        h('div.panel-cuerpo', formGastos().el)
      )
    );
  }

  /* ---------------- Resultado ---------------- */

  function refrescar() {
    const est = calcularEstructura(cfg.estructura);
    const eq = puntoEquilibrio(est, cfg.comercial?.margen ?? 45);

    vaciar(panelResultado);
    panelResultado.appendChild(
      h('div.grid.g4.mb',
        kpi('Gasto fijo del mes', money(est.totalMes, sim, 0), 'sin material ni mano de obra directa'),
        kpi('Horas productivas', num(est.horasProductivas, 0) + ' h', `de ${num(est.horasAbiertas, 0)} h abiertas`),
        kpi('Estructura por hora', money(est.porHora, sim, 0), 'se suma a cada hora de máquina', 'var(--naranja)'),
        kpi('Facturación de equilibrio', money(eq.facturacionNecesaria, sim, 0), `${money(eq.porDiaHabil, sim, 0)} por día hábil`, 'var(--verde)')
      )
    );

    const filas = est.items.map((i) =>
      h('tr',
        h('td', h('strong', i.nombre), i.detalle ? h('div.chico.tenue', i.detalle) : null),
        h('td.num', money(i.valor, sim, 0)),
        h('td.num', money(i.porHora, sim, 0)),
        h('td', h('div.barra', { style: { minWidth: '90px' } }, h('div', { style: { width: i.pct + '%' } }))),
        h('td.num.chico', pct(i.pct, 1))
      )
    );

    panelResultado.appendChild(
      h('div.panel.mb',
        h('div.panel-cab', h('h3', 'De dónde sale el costo por hora')),
        h('div.panel-cuerpo.sin-pad',
          h('table',
            h('thead', h('tr', h('th', 'Concepto'), h('th.num', '$/mes'), h('th.num', '$/hora'), h('th', ''), h('th.num', '%'))),
            h('tbody', ...filas,
              h('tr', { style: { borderTop: '2px solid var(--tinta)' } },
                h('td', h('strong', 'TOTAL')),
                h('td.num.negrita', money(est.totalMes, sim, 0)),
                h('td.num.negrita', money(est.porHora, sim, 0)),
                h('td'), h('td')))
          ))
      )
    );

    // Impacto en las máquinas
    vaciar(panelMaquinas);
    const tarjetas = G.maquinas.map((m) => {
      const c = calcularCostoHoraMaquina(m, est);
      const partes = [
        ['Amortización', c.amortizacion],
        ['Energía', c.energia],
        ['Mantenimiento', c.mantenimiento],
        ['Consumibles', c.consumibles],
        ['Operario', c.operario],
        ['Estructura', c.estructura],
      ];
      return h('div.panel',
        h('div.panel-cab', h('h3', m.nombre), h('span.mono.negrita', money(c.total, sim, 0) + '/h')),
        h('div.panel-cuerpo',
          ...partes.map(([k, v]) =>
            h('div', { style: { marginBottom: '7px' } },
              h('div.fila.entre.chico', h('span.suave', k), h('span.mono', money(v, sim, 0))),
              h('div.barra', h('div', { style: { width: (v / c.total) * 100 + '%' } })))),
          h('div.chico.tenue', { style: { marginTop: '10px' } },
            `${money(c.total / 60, sim, 0)} por minuto · US$ ${num(c.total / (cfg.comercial?.tipoCambio || 1500), 2)}/h`)
        )
      );
    });
    panelMaquinas.appendChild(
      h('div',
        h('h2', { style: { fontSize: '15px', margin: '18px 0 10px' } }, 'Impacto en el costo horario de cada máquina'),
        h('div.grid.g2', ...tarjetas))
    );
  }

  function kpi(etiqueta, valor, nota, color) {
    return h('div.panel.kpi',
      h('div.etiqueta', etiqueta),
      h('div.valor', { style: color ? { color } : null }, valor),
      h('div.nota', nota));
  }

  /* ---------------- Herramientas ---------------- */

  function abrirCalculadoraSueldo() {
    const sel = h('select', ...UOM_RAMA17.categorias.map((c) =>
      h('option', { value: c.id }, `${c.nombre} — $${c.basicoHora.toFixed(2)}/h básico`)));
    sel.value = 'operador-cnc';
    const salida = h('div');

    const calcular = () => {
      const cat = UOM_RAMA17.categorias.find((c) => c.id === sel.value);
      const c = costoHoraOperario(cat.basicoHora, CARGAS_LABORALES);
      vaciar(salida);
      salida.appendChild(
        h('div.desglose',
          fila('Básico de convenio', money(c.basico, sim, 2)),
          fila(`Adicionales (${CARGAS_LABORALES.adicionalesConvenio} %)`, money(c.conAdicionales - c.basico, sim, 2)),
          fila(`Cargas sociales + ART (${(CARGAS_LABORALES.contribucionesPatronales + CARGAS_LABORALES.art + CARGAS_LABORALES.seguroVida).toFixed(1)} %)`, money(c.cargasSociales, sim, 2)),
          fila(`Aguinaldo (${CARGAS_LABORALES.sac} %)`, money(c.sac, sim, 2)),
          fila(`Vacaciones y ausentismo (${CARGAS_LABORALES.factorHorasNoTrabajadas} %)`, money(c.ajusteHorasNoTrabajadas, sim, 2)),
          h('div.fila.total', h('span', 'COSTO POR HORA TRABAJADA'), h('span', money(c.total, sim, 2)))),
        h('p.chico.suave',
          `El recibo dice ${money(c.basico, sim, 0)} la hora, pero la hora de esa persona te sale ${money(c.total, sim, 0)}: ${num(c.multiplicador, 2)} veces más. Ese es el número que va en Máquinas.`),
        h('button.btn-primario', {
          onclick: () => {
            for (const m of G.maquinas) m.costo.operarioHora = Math.round(c.total);
            api.put('maquinas', G.maquinas).then(() => {
              toast('Costo de operario aplicado a todas las máquinas', 'ok');
              cerrarModal();
              refrescar();
            });
          },
        }, 'Aplicar a las máquinas')
      );
    };
    sel.onchange = calcular;

    modal({
      titulo: 'Costo real de una hora de operario',
      ancho: '560px',
      cuerpo: h('div',
        h('p.chico.suave', { style: { marginTop: 0 } },
          `Escala UOM rama 17 (metalmecánica) vigente desde abril 2026. La paritaria quedó congelada, así que estos valores siguen rigiendo.`),
        h('div.campo', h('label', 'Categoría'), sel),
        salida),
    });
    calcular();
  }

  function abrirGeneradorN2() {
    const inp = (v) => h('input', { type: 'number', step: 'any', value: v });
    const consumo = inp(3000);
    const precio = inp(cfg.produccion?.gases?.N2 ?? 1400);
    const inversion = inp(38000000);
    const salida = h('div');

    const calcular = () => {
      const r = evaluarGeneradorN2({
        consumoM3Mes: +consumo.value || 0,
        precioM3Actual: +precio.value || 0,
        inversion: +inversion.value || 0,
      });
      vaciar(salida);
      salida.appendChild(
        h('div.desglose',
          fila('Gasto actual en nitrógeno', money((+consumo.value || 0) * (+precio.value || 0), sim, 0) + '/mes'),
          fila('Ahorro con generador', money(r.ahorroMes, sim, 0) + '/mes'),
          fila('Amortización del equipo', money(r.amortizacionMes, sim, 0) + '/mes'),
          h('div.fila.total',
            h('span', r.conviene ? 'GANANCIA NETA' : 'PÉRDIDA NETA'),
            h('span', { class: r.conviene ? 'verde' : 'rojo' }, money(r.beneficioMes, sim, 0) + '/mes'))),
        h('div', { class: 'aviso ' + (r.conviene ? 'aviso-info' : 'aviso-aviso'), style: { marginTop: '12px' } },
          h('span', r.conviene ? '✓' : '⚠'),
          h('div', r.conviene
            ? `Con ese consumo el generador se paga en ${num(r.mesesRepago, 0)} meses y después son ${money(r.ahorroMes, sim, 0)} por mes que quedan en el taller.`
            : `Con ese consumo todavía no conviene: el repago daría ${isFinite(r.mesesRepago) ? num(r.mesesRepago, 0) + ' meses' : 'nunca'}. Volvé a mirarlo cuando cortes más inoxidable.`))
      );
    };
    for (const i of [consumo, precio, inversion]) i.oninput = calcular;

    modal({
      titulo: '¿Conviene comprar un generador de nitrógeno?',
      ancho: '560px',
      cuerpo: h('div',
        h('p.chico.suave', { style: { marginTop: 0 } },
          'Cortar inoxidable con N₂ consume entre 25 y 95 m³/h. Es la inversión más rentable de un taller que corta inox seguido, y casi nadie la calcula. Un generador PSA produce a unos $320 el m³ contra los $1.400 del termo.'),
        h('div.campo', h('label', 'Consumo de nitrógeno (m³ por mes)'), consumo),
        h('div.campo', h('label', 'Lo que pagás hoy el m³'), precio),
        h('div.campo', h('label', 'Inversión estimada en el generador'), inversion),
        salida),
    });
    calcular();
  }

  const fila = (a, b) => h('div.fila', h('span', a), h('span', b));

  async function guardar() {
    await guardarConfig(cfg);
    toast('Costos de estructura guardados', 'ok');
    refrescar();
  }

  render2();
  refrescar();
  return {};
}
