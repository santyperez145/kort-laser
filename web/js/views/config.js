/** KORT - Configuración: datos de la empresa, política comercial y respaldos. */

import { h, vaciar, toast, confirmar, formulario, money, num, descargar, modal, cerrarModal } from '../ui.js';
import { api, estado as G, guardarConfig, simbolo } from '../api.js';
import { DEFAULT_ACABADOS, DEFAULT_PROCESOS } from '/src/core/pricing.js';

export async function render(cont) {
  let cfg = JSON.parse(JSON.stringify(G.config));
  const sim = () => cfg.comercial.simbolo || '$';

  cont.appendChild(
    h('div.cabecera-vista',
      h('div', h('h1', 'Configuración'), h('p.sub', 'Datos de la empresa, política de precios, acabados y respaldos')),
      h('div.acciones', h('button.btn-primario', { onclick: guardar }, '💾 Guardar configuración'))
    )
  );

  /* ---------------- Empresa ---------------- */
  const formEmpresa = formulario(
    [
      { key: 'nombre', label: 'Nombre comercial', tipo: 'txt' },
      { key: 'razonSocial', label: 'Razón social', tipo: 'txt' },
      { key: 'cuit', label: 'CUIT', tipo: 'txt', ancho: 'medio' },
      { key: 'condicionIVA', label: 'Condición frente al IVA', tipo: 'sel', ancho: 'medio',
        opciones: ['Responsable Inscripto', 'Monotributo', 'Exento', 'Consumidor Final'].map((v) => ({ v, t: v })) },
      { key: 'direccion', label: 'Dirección', tipo: 'txt' },
      { key: 'telefono', label: 'Teléfono', tipo: 'txt', ancho: 'medio' },
      { key: 'email', label: 'Email', tipo: 'txt', ancho: 'medio' },
      { key: 'web', label: 'Sitio web / redes', tipo: 'txt' },
    ],
    cfg.empresa,
    (k, v) => { cfg.empresa[k] = v; }
  );

  /* ---------------- Comercial ---------------- */
  const formComercial = formulario(
    [
      { key: 'margen', label: 'Margen sobre costo', tipo: 'num', unidad: '%', ancho: 'medio' },
      { key: 'iva', label: 'IVA', tipo: 'num', unidad: '%', ancho: 'medio' },
      { key: 'mostrarIVA', label: 'Discriminar IVA en el presupuesto', tipo: 'bool' },
      { key: 'simbolo', label: 'Símbolo de moneda', tipo: 'txt', ancho: 'medio' },
      { key: 'moneda', label: 'Moneda', tipo: 'txt', ancho: 'medio' },
      { key: 'tipoCambio', label: 'Tipo de cambio (referencia USD)', tipo: 'num', ancho: 'medio' },
      { key: 'validezDias', label: 'Validez del presupuesto', tipo: 'num', unidad: 'días', ancho: 'medio' },
      { key: 'minimoFacturacion', label: 'Mínimo de facturación', tipo: 'num', ancho: 'medio' },
      { key: 'minimoPorItem', label: 'Mínimo por ítem', tipo: 'num', ancho: 'medio' },
      { key: 'redondeo', label: 'Redondear precios a múltiplos de', tipo: 'num', ancho: 'medio' },
      { key: 'ingenieriaHora', label: 'Hora de ingeniería / CAD', tipo: 'num', ancho: 'medio' },
      { key: 'recargoUrgente', label: 'Recargo por urgencia', tipo: 'num', unidad: '%', ancho: 'medio' },
      { key: 'recargoExpress', label: 'Recargo express 24 h', tipo: 'num', unidad: '%', ancho: 'medio' },
      { key: 'modoMaterial', label: 'Cómo se cobra el material', tipo: 'sel',
        opciones: [
          { v: 'auto', t: 'Automático (recomendado)' },
          { v: 'nesting', t: 'Siempre chapas completas' },
          { v: 'prorrateado', t: 'Siempre por área consumida' },
        ] },
      { key: 'aprovechamientoObjetivo', label: 'Aprovechamiento objetivo (0 a 1)', tipo: 'num', ancho: 'medio' },
      { key: 'scrapMinimo', label: 'Recorte inevitable', tipo: 'num', unidad: '%', ancho: 'medio' },
    ],
    cfg.comercial,
    (k, v) => { cfg.comercial[k] = v; }
  );

  /* ---------------- Descuentos por cantidad ---------------- */
  const tablaDesc = h('tbody');
  function pintarDescuentos() {
    vaciar(tablaDesc);
    cfg.comercial.descuentos = cfg.comercial.descuentos || [];
    cfg.comercial.descuentos.forEach((d, i) => {
      tablaDesc.appendChild(
        h('tr',
          h('td', h('input', { type: 'number', min: 1, value: d.desde, onchange: (e) => { d.desde = +e.target.value; } })),
          h('td', h('input', { type: 'number', min: 0, max: 90, value: d.pct, onchange: (e) => { d.pct = +e.target.value; } })),
          h('td', h('button.btn-sm.btn-peligro', { onclick: () => { cfg.comercial.descuentos.splice(i, 1); pintarDescuentos(); } }, '✕'))
        )
      );
    });
  }
  pintarDescuentos();

  /* ---------------- Producción ---------------- */
  const formProd = formulario(
    [
      { key: 'separacionPiezas', label: 'Separación entre piezas en el nesting', tipo: 'num', unidad: 'mm', ancho: 'medio' },
      { key: 'margenChapa', label: 'Borde de chapa no utilizable', tipo: 'num', unidad: 'mm', ancho: 'medio' },
    ],
    cfg.produccion,
    (k, v) => { cfg.produccion[k] = v; }
  );
  const formGases = formulario(
    [
      { key: 'O2', label: 'Oxígeno', tipo: 'num', unidad: sim() + '/m³', ancho: 'medio' },
      { key: 'N2', label: 'Nitrógeno', tipo: 'num', unidad: sim() + '/m³', ancho: 'medio' },
      { key: 'AIRE', label: 'Aire comprimido', tipo: 'num', unidad: sim() + '/m³', ancho: 'medio' },
    ],
    cfg.produccion.gases || {},
    (k, v) => { cfg.produccion.gases = { ...cfg.produccion.gases, [k]: v }; }
  );

  /* ---------------- Acabados y procesos ---------------- */
  function tablaEditable(lista, titulo, opcionesTipo, alRestaurar) {
    const cuerpo = h('tbody');
    const pintar = () => {
      vaciar(cuerpo);
      lista.forEach((a, i) => {
        cuerpo.appendChild(
          h('tr',
            h('td', h('input', { type: 'text', value: a.nombre, onchange: (e) => { a.nombre = e.target.value; } })),
            h('td', h('select', { onchange: (e) => { a.tipo = e.target.value; } },
              ...opcionesTipo.map((o) => h('option', { value: o.v, selected: a.tipo === o.v }, o.t)))),
            h('td', h('input', { type: 'number', step: 'any', value: a.valor, onchange: (e) => { a.valor = +e.target.value; } })),
            h('td', h('input', { type: 'text', value: a.unidad || '', onchange: (e) => { a.unidad = e.target.value; } })),
            h('td', h('button.btn-sm.btn-peligro', { onclick: () => { lista.splice(i, 1); pintar(); } }, '✕'))
          )
        );
      });
    };
    pintar();
    return h('div.panel.mb',
      h('div.panel-cab', h('h3', titulo),
        h('div.fila',
          h('button.btn-sm', { onclick: () => { lista.push({ id: 'x' + Date.now().toString(36), nombre: 'Nuevo', tipo: opcionesTipo[0].v, valor: 0, unidad: '' }); pintar(); } }, '＋'),
          h('button.btn-sm', { onclick: alRestaurar }, '↺ Restaurar'))),
      h('div.panel-cuerpo.sin-pad',
        h('table', h('thead', h('tr', h('th', 'Nombre'), h('th', 'Se cobra por'), h('th', 'Valor'), h('th', 'Unidad'), h('th', ''))), cuerpo))
    );
  }

  cfg.acabados = cfg.acabados || DEFAULT_ACABADOS;
  cfg.procesos = cfg.procesos || DEFAULT_PROCESOS;

  const panelAcabados = tablaEditable(
    cfg.acabados, 'Acabados superficiales',
    [
      { v: 'ninguno', t: 'No se cobra' },
      { v: 'superficie', t: 'Superficie (m²)' },
      { v: 'peso', t: 'Peso (kg)' },
      { v: 'perimetro', t: 'Perímetro (m)' },
    ],
    () => { cfg.acabados = JSON.parse(JSON.stringify(DEFAULT_ACABADOS)); render2(); }
  );

  const panelProcesos = tablaEditable(
    cfg.procesos, 'Procesos adicionales',
    [
      { v: 'hora', t: 'Hora de trabajo' },
      { v: 'operacion', t: 'Por operación / unidad' },
    ],
    () => { cfg.procesos = JSON.parse(JSON.stringify(DEFAULT_PROCESOS)); render2(); }
  );

  /* ---------------- Condiciones del PDF ---------------- */
  const areaCond = h('textarea', { rows: 9 });
  areaCond.value = cfg.textos?.condiciones ||
    [
      'Validez de la oferta según la fecha indicada en el encabezado.',
      'Los precios están sujetos a variación del costo de la materia prima.',
      'El plazo de entrega comienza con la aprobación y los archivos definitivos.',
      'Los archivos deben entregarse en DXF, DWG o STEP.',
      'Tolerancias según DIN 2768-m salvo indicación en plano.',
      'El desarrollo de piezas plegadas se calcula con el K-factor del material.',
      'No incluye tratamientos superficiales ni herrajes salvo que estén detallados.',
      'El material sobrante queda en poder de KORT salvo acuerdo previo.',
    ].join('\n');
  areaCond.oninput = () => { cfg.textos = { ...cfg.textos, condiciones: areaCond.value }; };

  /* ---------------- Respaldo ---------------- */
  const panelRespaldo = h('div.panel',
    h('div.panel-cab', h('h3', 'Respaldo y datos')),
    h('div.panel-cuerpo',
      h('p.chico.suave', { style: { marginTop: 0 } },
        'El sistema ya guarda una copia automática por día en data/backups. Este botón te deja llevarte todo en un archivo, por si cambiás de computadora.'),
      h('div.acciones',
        h('button', { onclick: exportar }, '⤓ Descargar respaldo completo'),
        h('button', { onclick: importar }, '⤒ Restaurar desde archivo'),
      ),
      h('div.acciones.mt',
        h('button.btn-peligro', { onclick: () => restaurar('materiales') }, '↺ Materiales de fábrica'),
        h('button.btn-peligro', { onclick: () => restaurar('maquinas') }, '↺ Máquinas de fábrica'),
      )
    )
  );

  const raiz = h('div');
  cont.appendChild(raiz);

  function render2() {
    vaciar(raiz);
    raiz.appendChild(
      h('div.grid.g2.mb',
        h('div.panel', h('div.panel-cab', h('h3', 'Datos de la empresa')), h('div.panel-cuerpo', formEmpresa.el)),
        h('div.panel', h('div.panel-cab', h('h3', 'Política comercial')), h('div.panel-cuerpo', formComercial.el))
      )
    );
    raiz.appendChild(
      h('div.grid.g2.mb',
        h('div.panel',
          h('div.panel-cab', h('h3', 'Descuentos por cantidad'),
            h('button.btn-sm', { onclick: () => { cfg.comercial.descuentos.push({ desde: 10, pct: 5 }); pintarDescuentos(); } }, '＋')),
          h('div.panel-cuerpo.sin-pad',
            h('table', h('thead', h('tr', h('th', 'Desde (unidades)'), h('th', 'Descuento (%)'), h('th', ''))), tablaDesc))
        ),
        h('div.panel',
          h('div.panel-cab', h('h3', 'Producción y gases')),
          h('div.panel-cuerpo', formProd.el, h('div.chico.tenue.negrita', { style: { margin: '10px 0 8px' } }, 'PRECIO DE LOS GASES'), formGases.el)
        )
      )
    );
    raiz.appendChild(panelAcabados);
    raiz.appendChild(panelProcesos);
    raiz.appendChild(
      h('div.grid.g2',
        h('div.panel',
          h('div.panel-cab', h('h3', 'Condiciones que salen en el PDF')),
          h('div.panel-cuerpo', h('p.chico.suave', { style: { marginTop: 0 } }, 'Una condición por línea.'), areaCond)
        ),
        panelRespaldo
      )
    );
  }
  render2();

  async function guardar() {
    await guardarConfig(cfg);
    toast('Configuración guardada', 'ok');
  }

  async function exportar() {
    const datos = await api.get('respaldo');
    const nombre = `kort-respaldo-${new Date().toISOString().slice(0, 10)}.json`;
    descargar(nombre, JSON.stringify(datos, null, 2), 'application/json');
    toast('Respaldo descargado', 'ok');
  }

  function importar() {
    const input = h('input', { type: 'file', accept: '.json', style: { display: 'none' } });
    input.onchange = () => {
      const f = input.files[0];
      if (!f) return;
      const lector = new FileReader();
      lector.onload = () => {
        confirmar('Restaurar respaldo', 'Se van a reemplazar TODOS los datos actuales (clientes, presupuestos, configuración). ¿Seguimos?', async () => {
          try {
            await api.post('respaldo', JSON.parse(String(lector.result)));
            toast('Respaldo restaurado. Recargando…', 'ok');
            setTimeout(() => location.reload(), 900);
          } catch (e) {
            toast('Archivo inválido: ' + e.message, 'error');
          }
        }, 'Restaurar');
      };
      lector.readAsText(f);
    };
    document.body.appendChild(input);
    input.click();
    setTimeout(() => input.remove(), 1000);
  }

  function restaurar(tabla) {
    confirmar('Restaurar valores de fábrica', `Se van a reemplazar los datos de "${tabla}" por los originales del sistema.`, async () => {
      await api.post('restaurar', { tabla });
      toast('Restaurado. Recargando…', 'ok');
      setTimeout(() => location.reload(), 800);
    }, 'Restaurar');
  }

  return {};
}
