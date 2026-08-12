/**
 * KORT - Máquinas y costo horario
 *
 * El costo por hora de máquina es el número que decide si un trabajo deja
 * ganancia o la quema. Acá se arma con todos sus componentes a la vista:
 * amortización, energía, gas, consumibles, mantenimiento, operario y estructura.
 */

import { h, vaciar, toast, money, num, formulario } from '../ui.js';
import { estado as G, simbolo, guardarMaquinas } from '../api.js';
import { calcularEstructura, calcularCostoHoraMaquina } from '/src/core/costos.js';

export async function render(cont) {
  let maquinas = JSON.parse(JSON.stringify(G.maquinas));
  const sim = simbolo();
  const estructura = calcularEstructura(G.config.estructura);
  const calcularCostoHora = (m) => calcularCostoHoraMaquina(m, estructura);

  cont.appendChild(
    h('div.cabecera-vista',
      h('div', h('h1', 'Máquinas'), h('p.sub', 'Parámetros técnicos y cálculo del costo horario')),
      h('div.acciones', h('button.btn-primario', { onclick: guardar }, '💾 Guardar cambios'))
    )
  );

  const contenedor = h('div.grid.g2');
  cont.appendChild(contenedor);

  function pintar() {
    vaciar(contenedor);
    for (const m of maquinas) contenedor.appendChild(tarjeta(m));
  }

  function tarjeta(m) {
    const costo = calcularCostoHora(m);
    const panelCosto = h('div');

    const refrescarCosto = () => {
      const c = calcularCostoHora(m);
      vaciar(panelCosto);
      const total = c.total || 1;
      const filas = [
        ['Amortización del equipo', c.amortizacion],
        ['Energía eléctrica (variable)', c.energia],
        ['Mantenimiento', c.mantenimiento],
        ['Consumibles (óptica, boquillas)', c.consumibles],
        ['Operario', c.operario],
        ['Estructura del taller', c.estructura],
      ];
      for (const [k, v] of filas) {
        panelCosto.appendChild(
          h('div', { style: { marginBottom: '7px' } },
            h('div.fila.entre.chico', h('span.suave', k), h('span.mono', money(v, sim, 0))),
            h('div.barra', h('div', { style: { width: (v / total) * 100 + '%' } }))
          )
        );
      }
      panelCosto.appendChild(
        h('div', { style: { marginTop: '12px', paddingTop: '10px', borderTop: '2px solid var(--tinta)' } },
          h('div.fila.entre',
            h('strong', 'COSTO POR HORA'),
            h('span.precio-grande', { style: { fontSize: '24px' } }, money(c.total, sim, 0))
          ),
          h('div.chico.tenue', `${money(c.total / 60, sim, 0)} por minuto de máquina`)
        )
      );
    };

    const camposMaquina = m.tipo === 'laser'
      ? [
          { key: 'nombre', label: 'Nombre', tipo: 'txt' },
          { key: 'potenciaKW', label: 'Potencia de la fuente', tipo: 'num', unidad: 'kW', ancho: 'medio' },
          { key: 'aceleracion', label: 'Aceleración', tipo: 'num', unidad: 'G', ancho: 'medio' },
          { key: 'velocidadRapida', label: 'Velocidad de posicionamiento', tipo: 'num', unidad: 'mm/min', ancho: 'medio' },
          { key: 'desviacionUnion', label: 'Tolerancia de esquina', tipo: 'num', unidad: 'mm', ancho: 'medio' },
          { key: 'entradaMM', label: 'Longitud de entrada (lead-in)', tipo: 'num', unidad: 'mm', ancho: 'medio' },
          { key: 'eficiencia', label: 'Eficiencia real (0 a 1)', tipo: 'num', ancho: 'medio' },
          { key: 'tiempoCargaChapa', label: 'Carga/descarga de chapa', tipo: 'num', unidad: 's', ancho: 'medio' },
          { key: 'tiempoSetupPrograma', label: 'Setup de programa', tipo: 'num', unidad: 's', ancho: 'medio' },
          { key: 'tiempoDescarga', label: 'Retiro por pieza', tipo: 'num', unidad: 's', ancho: 'medio' },
        ]
      : [
          { key: 'nombre', label: 'Nombre', tipo: 'txt' },
          { key: 'toneladas', label: 'Tonelaje', tipo: 'num', unidad: 't', ancho: 'medio' },
          { key: 'largoUtil', label: 'Largo útil', tipo: 'num', unidad: 'mm', ancho: 'medio' },
          { key: 'ejes', label: 'Ejes controlados', tipo: 'num', entero: true, ancho: 'medio' },
          { key: 'tiempoSetupHerramienta', label: 'Setup de herramental', tipo: 'num', unidad: 's', ancho: 'medio' },
          { key: 'tiempoPorPliegue', label: 'Tiempo base por pliegue', tipo: 'num', unidad: 's', ancho: 'medio' },
          { key: 'factorLargo', label: 'Segundos extra por mm de pliegue', tipo: 'num', ancho: 'medio' },
          { key: 'factorPeso', label: 'Segundos extra por kg de pieza', tipo: 'num', ancho: 'medio' },
        ];

    const formM = formulario(camposMaquina, m, (k, v) => { m[k] = v; });

    const camposCosto = [
      { key: 'valorEquipo', label: 'Valor del equipo', tipo: 'num', unidad: sim },
      { key: 'vidaUtilHoras', label: 'Vida útil estimada', tipo: 'num', unidad: 'h', ancho: 'medio' },
      { key: 'consumoKW', label: 'Consumo eléctrico medio', tipo: 'num', unidad: 'kW', ancho: 'medio' },
      { key: 'costoKWh', label: 'Costo del kWh', tipo: 'num', unidad: sim, ancho: 'medio' },
      { key: 'mantenimientoHora', label: 'Mantenimiento por hora', tipo: 'num', unidad: sim, ancho: 'medio' },
      { key: 'consumiblesHora', label: 'Consumibles por hora', tipo: 'num', unidad: sim, ancho: 'medio' },
      { key: 'operarioHora', label: 'Costo real de la hora de operario', tipo: 'num', unidad: sim, ancho: 'medio' },
      { key: 'dedicacionOperario', label: 'Dedicación del operario', tipo: 'num', unidad: '%', ancho: 'medio' },
    ];
    m.costo = m.costo || {};
    const formC = formulario(camposCosto, m.costo, (k, v) => { m.costo[k] = v; refrescarCosto(); });
    const formEstr = formulario(
      [{ key: 'participacionEstructura', label: 'Parte de la estructura del taller que absorbe', tipo: 'num', unidad: '%' }],
      m, (k, v) => { m[k] = v; refrescarCosto(); }
    );

    const areaCampos = m.tipo === 'laser'
      ? h('div.campo-fila',
          h('div.campo', h('label', 'Área de trabajo X (mm)'),
            h('input', { type: 'number', value: m.areaTrabajo?.w ?? 3000, oninput: (e) => { m.areaTrabajo = { ...m.areaTrabajo, w: +e.target.value }; } })),
          h('div.campo', h('label', 'Área de trabajo Y (mm)'),
            h('input', { type: 'number', value: m.areaTrabajo?.h ?? 1500, oninput: (e) => { m.areaTrabajo = { ...m.areaTrabajo, h: +e.target.value }; } }))
        )
      : null;

    refrescarCosto();

    return h('div.panel',
      h('div.panel-cab',
        h('h3', m.nombre),
        h('span.badge.' + (m.tipo === 'laser' ? 'b-naranja' : 'b-azul'), m.tipo === 'laser' ? 'Láser' : 'Plegadora')
      ),
      h('div.panel-cuerpo',
        h('div.chico.tenue.negrita.mb', 'PARÁMETROS TÉCNICOS'),
        formM.el,
        areaCampos,
        h('div.chico.tenue.negrita', { style: { marginTop: '18px', marginBottom: '10px' } }, 'COMPONENTES DEL COSTO'),
        formC.el,
        formEstr.el,
        h('div.chico.tenue', { style: { marginTop: '-4px', marginBottom: '10px' } },
          `Estructura del taller: ${money(estructura.porHora, sim, 0)}/h repartidos entre las máquinas. Se configura en la solapa Costos.`),
        h('div', { style: { background: 'var(--panel-2)', borderRadius: '8px', padding: '12px', marginTop: '10px' } }, panelCosto)
      )
    );
  }

  async function guardar() {
    await guardarMaquinas(maquinas);
    toast('Máquinas guardadas', 'ok');
    pintar();
  }

  pintar();

  cont.appendChild(
    h('div.aviso.aviso-info.mt',
      h('span', 'ⓘ'),
      h('div',
        h('strong', 'Cómo se usan estos números. '),
        'La aceleración y la tolerancia de esquina alimentan el simulador de recorrido: por eso una pieza con muchos agujeros chicos cotiza más caro que una placa lisa del mismo perímetro. ',
        'Si tus tiempos reales dan sistemáticamente más altos, bajá la eficiencia; si dan más bajos, subí la aceleración. ',
        h('br'), h('br'),
        h('strong', 'Energía: '), 'acá va sólo el consumo variable (kWh mientras la máquina trabaja). ',
        'El cargo por potencia contratada de EDELAR es un gasto fijo mensual y va en Costos, no acá: si lo pusieras como variable, ',
        'los trabajos largos lo pagarían dos veces y los cortos no lo pagarían nunca.')
    )
  );

  return {};
}
