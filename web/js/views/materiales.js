/**
 * KORT - Materiales
 *
 * Acá vive la verdad del negocio: el precio del kilo y la velocidad real de
 * corte de tu máquina. Los valores de fábrica son un punto de partida; cuando
 * los reemplaces por tus mediciones, el cotizador deja de estimar y empieza a
 * calcular.
 */

import { h, vaciar, toast, confirmar, modal, cerrarModal, money, num, pct, fecha } from '../ui.js';
import { api, estado as G, simbolo, guardarMateriales, laser } from '../api.js';
import {
  cuttingSpeed, pierceTime, pesoKg, GASES, gasRecomendado, gasesDisponibles,
  gasFlow, presionGas, boquilla, espesorMaximo, compararGases,
} from '/src/core/materials.js';

export async function render(cont) {
  let mats = JSON.parse(JSON.stringify(G.materiales));
  const sim = simbolo();
  const cuerpo = h('tbody');

  cont.appendChild(
    h('div.cabecera-vista',
      h('div',
        h('h1', 'Materiales'),
        h('p.sub', 'Precios, espesores, velocidades de corte y datos de plegado')
      ),
      h('div.acciones',
        h('button', { onclick: verHistorial }, '📈 Historial de precios'),
        h('button', { onclick: actualizarPrecios }, '％ Actualizar precios en masa'),
        h('button', { onclick: nuevo }, '＋ Nuevo material'),
        h('button.btn-primario', { onclick: guardar }, '💾 Guardar cambios')
      )
    )
  );

  cont.appendChild(
    h('div.aviso.aviso-info',
      h('span', 'ⓘ'),
      h('div', h('strong', 'Tablas calibradas para una fuente de 3 kW. '),
        'Cada material tiene una tabla por gas de asistencia: la velocidad, la perforación y sobre todo el consumo cambian muchísimo entre oxígeno, nitrógeno y aire. ',
        h('br'),
        h('strong', 'Para calibrar: '),
        'cortá una pieza conocida, cronometrala de verdad y ajustá la velocidad de ese espesor hasta que coincida. Con dos o tres espesores medidos, el resto interpola bien.')
    )
  );

  cont.appendChild(
    h('div.panel',
      h('div.panel-cuerpo.sin-pad',
        h('table',
          h('thead', h('tr',
            h('th', 'Material'), h('th', 'Familia'), h('th.num', 'Densidad'), h('th.num', '$/kg'),
            h('th.num', 'Rm'), h('th.num', 'K'), h('th', 'Espesores'), h('th', 'Chapa'), h('th', 'Gases'), h('th', '')
          )),
          cuerpo
        )
      )
    )
  );

  function pintar() {
    vaciar(cuerpo);
    for (const m of mats) {
      cuerpo.appendChild(
        h('tr', { style: m.activo === false ? { opacity: '.45' } : null },
          h('td', h('strong', m.nombre), m.notas ? h('div.chico.tenue', m.notas) : null),
          h('td.chico', m.familia),
          h('td.num', num(m.densidad, 2)),
          h('td.num.negrita', money(m.precioKg, sim, 0)),
          h('td.num', num(m.Rm, 0)),
          h('td.num', num(m.kFactor, 2)),
          h('td.chico.mono', (m.espesores || []).join(' · '),
            h('div.chico.tenue', `máx. ${espesorMaximo(m)} mm a 3 kW`)),
          h('td.chico.mono', `${m.chapaStd?.w}×${m.chapaStd?.h}`),
          h('td.chico', Object.keys(m.procesos || {}).map((g) =>
            h('span.badge.' + (g === 'N2' ? 'b-azul' : g === 'O2' ? 'b-naranja' : 'b-verde'),
              { style: { marginRight: '3px' } }, g))),
          h('td', h('div.fila',
            h('button.btn-sm', { onclick: () => editar(m) }, '✎'),
            h('button.btn-sm', { title: 'Tablas de corte por gas', onclick: () => tablas(m) }, '⚡'),
            h('button.btn-sm', { onclick: () => { m.activo = m.activo === false; pintar(); } }, m.activo === false ? '👁' : '🚫'),
            h('button.btn-sm.btn-peligro', { onclick: () => borrar(m) }, '✕')
          ))
        )
      );
    }
  }

  function editar(m) {
    const campos = [
      ['nombre', 'Nombre', 'text'],
      ['familia', 'Familia', 'text'],
      ['densidad', 'Densidad (g/cm³)', 'number'],
      ['precioKg', 'Precio por kg', 'number'],
      ['Rm', 'Resistencia a tracción Rm (N/mm²)', 'number'],
      ['kFactor', 'K-factor base', 'number'],
    ];
    const inputs = {};
    const form = h('div');
    for (const [k, label, tipo] of campos) {
      inputs[k] = h('input', { type: tipo, step: 'any', value: m[k] ?? '' });
      form.appendChild(h('div.campo', h('label', label), inputs[k]));
    }
    inputs.espesores = h('input', { type: 'text', value: (m.espesores || []).join(', ') });
    form.appendChild(h('div.campo', h('label', 'Espesores disponibles (separados por coma)'), inputs.espesores));
    inputs.chapaW = h('input', { type: 'number', value: m.chapaStd?.w ?? 3000 });
    inputs.chapaH = h('input', { type: 'number', value: m.chapaStd?.h ?? 1500 });
    form.appendChild(h('div.campo-fila',
      h('div.campo', h('label', 'Ancho de chapa (mm)'), inputs.chapaW),
      h('div.campo', h('label', 'Alto de chapa (mm)'), inputs.chapaH)));
    const disponibles = Object.keys(m.procesos || {});
    const opGas = (sel) => disponibles.map((g) => h('option', { value: g, selected: sel === g }, GASES[g]?.nombre || g));
    inputs.gasFino = h('select', ...opGas(m.gasPorDefecto?.fino));
    inputs.gasGrueso = h('select', ...opGas(m.gasPorDefecto?.grueso));
    inputs.gasHasta = h('input', { type: 'number', step: 'any', value: m.gasPorDefecto?.hasta ?? 3 });
    form.appendChild(h('div.campo-fila-3',
      h('div.campo', h('label', 'Gas por defecto en fino'), inputs.gasFino),
      h('div.campo', h('label', 'Hasta (mm)'), inputs.gasHasta),
      h('div.campo', h('label', 'Gas por defecto en grueso'), inputs.gasGrueso)));
    form.appendChild(h('p.chico.suave', { style: { marginTop: '-4px' } },
      'Es sólo el gas que se propone por defecto: en cada cotización se puede cambiar. Las tablas de velocidad y consumo se editan con el botón ⚡.'));
    inputs.notas = h('textarea', { rows: 2 });
    inputs.notas.value = m.notas || '';
    form.appendChild(h('div.campo', h('label', 'Notas de taller'), inputs.notas));

    modal({
      titulo: 'Editar material',
      ancho: '600px',
      cuerpo: form,
      pie: [
        h('button', { onclick: cerrarModal }, 'Cancelar'),
        h('button.btn-primario', {
          onclick: () => {
            m.nombre = inputs.nombre.value;
            m.familia = inputs.familia.value;
            m.densidad = +inputs.densidad.value;
            m.precioKg = +inputs.precioKg.value;
            m.Rm = +inputs.Rm.value;
            m.kFactor = +inputs.kFactor.value;
            const pedidos = inputs.espesores.value.split(',').map((s) => parseFloat(s.trim())).filter((n) => isFinite(n)).sort((a, b) => a - b);
            const max = espesorMaximo(m);
            const fuera = pedidos.filter((e) => e > max);
            m.espesores = pedidos.filter((e) => e <= max);
            m.chapaStd = { w: +inputs.chapaW.value, h: +inputs.chapaH.value };
            m.gasPorDefecto = { fino: inputs.gasFino.value, grueso: inputs.gasGrueso.value, hasta: +inputs.gasHasta.value };
            m.notas = inputs.notas.value;
            cerrarModal();
            pintar();
            if (fuera.length) {
              toast(`No se agregaron ${fuera.join(', ')} mm: superan el máximo de ${max} mm que corta la máquina`, 'error', 6000);
            }
          },
        }, 'Aceptar'),
      ],
    });
  }

  /** Tablas de corte, una pestaña por gas de asistencia. */
  function tablas(m) {
    const maq = laser();
    const gases = Object.keys(m.procesos || {});
    let gasActivo = gases[0];
    const contenido = h('div');
    const tabs = h('div.tabs', { style: { marginBottom: '12px' } });

    const pintarTabs = () => {
      vaciar(tabs);
      for (const g of gases) {
        tabs.appendChild(h('button', {
          class: g === gasActivo ? 'activo' : '',
          onclick: () => { gasActivo = g; pintarTabs(); pintarTabla(); },
        }, GASES[g]?.nombre || g));
      }
    };

    const pintarTabla = () => {
      vaciar(contenido);
      const p = m.procesos[gasActivo];
      const espesores = m.espesores.filter((e) => e <= p.maxEspesor);
      const filas = h('tbody');

      for (const e of espesores) {
        const enTabla = p.speeds[e] != null;
        const vInput = h('input', {
          type: 'number', step: 'any', style: { width: '105px' },
          value: Math.round(p.speeds[e] ?? cuttingSpeed(m, e, 3, gasActivo) ?? 0),
          onchange: (ev) => { p.speeds[e] = +ev.target.value; pintarTabla(); },
        });
        const pInput = h('input', {
          type: 'number', step: 'any', style: { width: '80px' },
          value: (p.pierce[e] ?? pierceTime(m, e, 3, gasActivo)).toFixed(2),
          onchange: (ev) => { p.pierce[e] = +ev.target.value; pintarTabla(); },
        });
        const vReal = cuttingSpeed(m, e, maq?.potenciaKW || 3, gasActivo);
        const caudal = gasFlow(m, e, gasActivo);
        const precioGas = G.config.produccion?.gases?.[gasActivo] ?? GASES[gasActivo]?.costoM3 ?? 0;
        // Costo de gas por metro lineal de corte
        const costoGasMetro = vReal > 0 ? (caudal / 60 / vReal) * 1000 * precioGas : 0;

        filas.appendChild(
          h('tr', { style: enTabla ? null : { opacity: 0.6 } },
            h('td.negrita', `${e} mm`, enTabla ? null : h('div.chico.tenue', 'interpolado')),
            h('td', vInput),
            h('td.num.chico', num(vReal, 0)),
            h('td', pInput),
            h('td.num.chico', num(caudal, 1)),
            h('td.num.chico', num(presionGas(m, e, gasActivo), 0)),
            h('td.num.chico', num(boquilla(m, e, gasActivo), 1)),
            h('td.num.chico.negrita', money(costoGasMetro, sim, 1))
          )
        );
      }

      contenido.appendChild(
        h('div',
          h('div.aviso.aviso-info', h('span', 'ⓘ'),
            h('div', h('strong', p.calidad), p.notas ? h('div.chico', { style: { marginTop: '3px' } }, p.notas) : null)),
          h('table', { style: { fontSize: '12.5px' } },
            h('thead', h('tr',
              h('th', 'Espesor'), h('th', 'Velocidad @3 kW'), h('th.num', `Tu máquina (${maq?.potenciaKW ?? 3} kW)`),
              h('th', 'Perforación (s)'), h('th.num', 'Caudal m³/h'), h('th.num', 'bar'),
              h('th.num', 'Boquilla'), h('th.num', 'Gas $/m corte')
            )),
            filas)
        )
      );
    };

    pintarTabs();
    pintarTabla();

    modal({
      titulo: `Tablas de corte · ${m.nombre}`,
      ancho: '900px',
      cuerpo: h('div',
        h('p.chico.suave', { style: { marginTop: 0 } },
          `Valores de referencia para 3 kW. La columna "tu máquina" los corrige a la potencia real y es la que usa el cotizador. `,
          h('strong', 'La última columna es la que hay que mirar: '),
          'cuánto cuesta el gas por cada metro de corte.'),
        tabs, contenido),
      pie: [h('button.btn-primario', { onclick: () => { cerrarModal(); pintar(); } }, 'Listo')],
    });
  }

  /** Historial de precios: la curva de la inflación de tu materia prima. */
  async function verHistorial() {
    const [hist, variacion] = await Promise.all([
      api.get('precios', '?limite=400'),
      api.get('precios/variacion', '?dias=180'),
    ]);

    const cuerpo = h('div');
    if (!hist.length) {
      cuerpo.appendChild(h('div.vacio', h('div.icono', '📈'),
        'Todavía no hay historial. Se registra solo cada vez que cambiás un precio y guardás.'));
    } else {
      if (variacion.length) {
        cuerpo.appendChild(h('h4', { style: { margin: '0 0 8px', fontSize: '12px', textTransform: 'uppercase', color: 'var(--naranja)' } },
          'Variación de los últimos 180 días'));
        cuerpo.appendChild(
          h('table', { style: { marginBottom: '20px' } },
            h('thead', h('tr', h('th', 'Material'), h('th.num', 'Inicial'), h('th.num', 'Actual'),
              h('th.num', 'Variación'), h('th.num', 'Cambios'))),
            h('tbody', ...variacion.map((v) =>
              h('tr',
                h('td', v.nombre),
                h('td.num', money(v.inicial, sim, 0)),
                h('td.num.negrita', money(v.actual, sim, 0)),
                h('td.num', { class: v.variacionPct >= 0 ? 'rojo' : 'verde' },
                  (v.variacionPct >= 0 ? '+' : '') + num(v.variacionPct, 1) + ' %'),
                h('td.num.chico', String(v.cambios)))))
          )
        );
      }
      cuerpo.appendChild(h('h4', { style: { margin: '0 0 8px', fontSize: '12px', textTransform: 'uppercase', color: 'var(--naranja)' } },
        'Todos los cambios registrados'));
      cuerpo.appendChild(
        h('div.scroll-y',
          h('table',
            h('thead', h('tr', h('th', 'Fecha'), h('th', 'Material'), h('th.num', '$/kg'),
              h('th.num', 'US$/kg'), h('th', 'Motivo'))),
            h('tbody', ...hist.map((r) =>
              h('tr',
                h('td.chico', fecha(r.fecha)),
                h('td.chico', r.nombre),
                h('td.num', money(r.precio_kg, sim, 0)),
                h('td.num.chico', r.precio_usd ? 'US$ ' + num(r.precio_usd, 2) : '—'),
                h('td.chico.tenue', r.motivo))))
          ))
      );
    }

    modal({
      titulo: 'Historial de precios de materiales',
      ancho: '820px',
      cuerpo: h('div',
        h('p.chico.suave', { style: { marginTop: 0 } },
          'Cada vez que cambiás un precio queda registrado con fecha y con el dólar del día. Sirve para dos cosas: contestarle a un cliente por qué cambió el precio, y ver si tu materia prima subió más o menos que la inflación.'),
        cuerpo),
    });
  }

  function nuevo() {
    const base = JSON.parse(JSON.stringify(G.materiales[0]));
    base.id = 'material-' + Date.now().toString(36);
    base.nombre = 'Material nuevo';
    mats.push(base);
    pintar();
    editar(base);
  }

  function borrar(m) {
    confirmar('Eliminar material', `Se va a quitar "${m.nombre}" de la lista. Los presupuestos ya guardados no cambian.`, () => {
      mats = mats.filter((x) => x !== m);
      pintar();
    }, 'Eliminar');
  }

  function actualizarPrecios() {
    const inp = h('input', { type: 'number', step: 'any', value: 10 });
    const selFam = h('select',
      h('option', { value: '' }, 'Todos los materiales'),
      ...[...new Set(mats.map((m) => m.familia))].map((f) => h('option', { value: f }, f))
    );
    modal({
      titulo: 'Actualizar precios',
      ancho: '460px',
      cuerpo: h('div',
        h('p.chico.suave', { style: { marginTop: 0 } }, 'Aplica un porcentaje sobre el precio por kilo. Usá un número negativo para bajar.'),
        h('div.campo', h('label', 'Familia'), selFam),
        h('div.campo', h('label', 'Variación (%)'), inp)
      ),
      pie: [
        h('button', { onclick: cerrarModal }, 'Cancelar'),
        h('button.btn-primario', {
          onclick: () => {
            const p = +inp.value || 0;
            let n = 0;
            for (const m of mats) {
              if (selFam.value && m.familia !== selFam.value) continue;
              m.precioKg = Math.round(m.precioKg * (1 + p / 100));
              n++;
            }
            cerrarModal();
            pintar();
            toast(`${n} materiales actualizados ${p >= 0 ? '+' : ''}${p} %`, 'ok');
          },
        }, 'Aplicar'),
      ],
    });
  }

  async function guardar() {
    await guardarMateriales(mats);
    toast('Materiales guardados', 'ok');
  }

  pintar();
  return {};
}
