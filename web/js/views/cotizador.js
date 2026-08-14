/**
 * KORT - Cotizador
 *
 * La vista central del sistema. Arma un presupuesto ítem por ítem, recalcula
 * el precio en tiempo real y desde acá salen el PDF, la orden de trabajo y
 * los DXF listos para la máquina.
 */

import { h, $, vaciar, toast, modal, cerrarModal, confirmar, formulario, money, num, pct, descargar, debounce, badge, ESTADOS_PRESUPUESTO } from '../ui.js';
import { api, estado as G, ctx, simbolo, laser, plegadora, recargarClientes } from '../api.js';
import { Visor2D, miniatura } from '../viewer2d.js';
import { Visor3D } from '../viewer3d.js';

import { PIEZAS, categorias, construir, paramsPorDefecto, getPieza } from '/src/core/library.js';
import { cotizarPresupuesto, cotizarItem, DEFAULT_ACABADOS, DEFAULT_PROCESOS } from '/src/core/pricing.js';
import { fmtTiempo } from '/src/core/cutting.js';
import { GASES, gasesDisponibles, gasRecomendado } from '/src/core/materials.js';
import { validarPlegado, matrizRecomendada, MATRICES_V } from '/src/core/bending.js';
import { generarDXF, generarDXFNesting } from '/src/core/dxf-write.js';
import { leerDXF } from '/src/core/dxf-read.js';
import { construirMesh } from '/src/core/mesh3d.js';
import { radioInterno } from '/src/core/bending.js';
import { nest } from '/src/core/nesting.js';
import { generarPresupuestoPDF, generarOrdenTrabajoPDF, generarEtiquetasPiezasPDF } from '/src/core/quote-pdf.js';
import { shapeBBox } from '/src/core/geometry.js';

let doc = null;
let sel = 0;
let coti = null;
let v2d = null;
let v3d = null;
let pestania = '2d';
let cont = null;

/* ------------------------------------------------------------------ */

function docVacio() {
  return {
    numero: null,
    fecha: new Date().toISOString().slice(0, 10),
    estado: 'borrador',
    cliente: { nombre: '', cuit: '', telefono: '', email: '', direccion: '' },
    items: [],
    notas: '',
    entregaDias: 7,
    condicionPago: '50 % anticipo, saldo contra entrega',
    descuentoGlobal: 0,
  };
}

function itemNuevo(base = {}) {
  const mat = G.materiales[0];
  return {
    nombre: 'Pieza',
    origen: 'libreria',
    piezaId: 'placa',
    params: paramsPorDefecto('placa'),
    materialId: mat.id,
    espesor: mat.espesores[Math.min(3, mat.espesores.length - 1)],
    gas: null, // null = usar el gas recomendado para ese material y espesor
    cantidad: 1,
    plegado: { pliegues: 0, largoPliegue: 0, angulo: 90, matrizV: 0, herramentales: 1 },
    acabadoId: 'ninguno',
    procesos: [],
    ingenieriaHoras: 0,
    urgencia: 'normal',
    ...base,
  };
}

/** Reconstruye la geometría de un ítem (biblioteca = recalculada; DXF = guardada). */
function geometria(item) {
  const material = G.materiales.find((m) => m.id === item.materialId) || G.materiales[0];
  if (item.origen === 'libreria') {
    try {
      const r = construir(item.piezaId, item.params, { espesor: item.espesor, material });
      return { shape: r.shape, meta: r, avisos: r.avisos || [] };
    } catch (e) {
      return { shape: null, meta: null, avisos: [{ nivel: 'error', msg: e.message }] };
    }
  }
  return { shape: item.shape, meta: item.meta || { modelo3D: { tipo: 'plano' } }, avisos: [] };
}

function recalcular() {
  const items = doc.items.map((it) => {
    const g = geometria(it);
    return { ...it, shape: g.shape, _meta: g.meta, _avisos: g.avisos };
  });
  doc._resueltos = items;
  coti = cotizarPresupuesto({ items: items.filter((i) => i.shape), descuentoGlobal: doc.descuentoGlobal }, ctx());
  return coti;
}

const recalcularYPintar = debounce(() => {
  recalcular();
  pintar();
}, 90);

/* ------------------------------------------------------------------ */
/* Render principal                                                    */
/* ------------------------------------------------------------------ */

export async function render(contenedor, params) {
  cont = contenedor;
  doc = docVacio();
  sel = 0;
  pestania = '2d';

  const id = params.get('id');
  if (id) {
    try {
      const guardado = await api.get('presupuestos/' + id);
      doc = { ...docVacio(), ...guardado };
    } catch (e) {
      toast('No se encontró el presupuesto', 'error');
    }
  }
  if (!doc.items.length) doc.items.push(itemNuevo());

  recalcular();
  pintar();
  return { destruir: () => { v2d?.destruir(); v3d?.destruir(); v2d = v3d = null; } };
}

function pintar() {
  const scrollY = window.scrollY;
  v2d?.destruir();
  v3d?.destruir();
  v2d = v3d = null;
  vaciar(cont);

  cont.appendChild(cabecera());
  cont.appendChild(
    h('div.cotizador',
      h('div.col-items', panelItems()),
      h('div.col-centro', panelCentro()),
      h('div.col-precio', panelPrecio())
    )
  );
  window.scrollTo(0, scrollY);
}

/* ------------------------------------------------------------------ */
/* Cabecera: cliente y datos del presupuesto                           */
/* ------------------------------------------------------------------ */

function cabecera() {
  const cli = doc.cliente || {};
  const selCliente = h('select',
    h('option', { value: '' }, '— Cliente nuevo / consumidor final —'),
    ...G.clientes.map((c) => h('option', { value: c.id, selected: c.id === doc.clienteId }, c.nombre))
  );
  selCliente.onchange = () => {
    const c = G.clientes.find((x) => x.id === selCliente.value);
    doc.clienteId = selCliente.value || null;
    if (c) doc.cliente = { nombre: c.nombre, cuit: c.cuit, telefono: c.telefono, email: c.email, direccion: c.direccion };
    pintar();
  };

  const campo = (label, key, tipo = 'text', ancho) =>
    h('div.campo', { style: ancho ? { flex: ancho } : null },
      h('label', label),
      h('input', {
        type: tipo, value: cli[key] || '',
        oninput: (e) => { doc.cliente[key] = e.target.value; },
      })
    );

  return h('div.panel.mb',
    h('div.panel-cab',
      h('h2', doc.numero ? `Presupuesto N° ${doc.numero}` : 'Nuevo presupuesto'),
      h('div.fila',
        doc.estado ? badge(ESTADOS_PRESUPUESTO, doc.estado) : null,
        h('button.btn-sm', { onclick: nuevoPresupuesto }, '＋ Nuevo'),
      )
    ),
    h('div.panel-cuerpo',
      h('div.campo', h('label', 'Cliente'), selCliente),
      h('div.campo-fila-3',
        campo('Nombre / Razón social', 'nombre'),
        campo('CUIT', 'cuit'),
        campo('Teléfono', 'telefono'),
      ),
      h('div.campo-fila-3',
        campo('Email', 'email'),
        h('div.campo', h('label', 'Entrega (días hábiles)'),
          h('input', { type: 'number', min: 0, value: doc.entregaDias, oninput: (e) => { doc.entregaDias = +e.target.value; } })),
        h('div.campo', h('label', 'Condición de pago'),
          h('input', { type: 'text', value: doc.condicionPago, oninput: (e) => { doc.condicionPago = e.target.value; } })),
      )
    )
  );
}

function nuevoPresupuesto() {
  confirmar('Nuevo presupuesto', 'Se va a limpiar la pantalla. Si no guardaste el presupuesto actual, se pierde.', () => {
    doc = docVacio();
    doc.items.push(itemNuevo());
    sel = 0;
    recalcular();
    pintar();
  }, 'Empezar de cero');
}

/* ------------------------------------------------------------------ */
/* Columna 1: lista de ítems                                           */
/* ------------------------------------------------------------------ */

function panelItems() {
  const lista = h('ul.lista-items');
  doc.items.forEach((it, i) => {
    const r = coti?.items[i];
    const g = doc._resueltos?.[i];
    const img = h('img.mini');
    if (g?.shape) img.src = miniatura(g.shape, 84, 84);
    lista.appendChild(
      h('li', { class: i === sel ? 'activo' : '', onclick: () => { sel = i; pintar(); } },
        img,
        h('div.txt',
          h('strong', it.nombre || 'Pieza'),
          h('small', `${it.cantidad} u · ${num(it.espesor, 1)} mm · ${r ? money(r.precio.neto, simbolo(), 0) : '—'}`)
        ),
        h('button.btn-sm.btn-peligro', {
          title: 'Quitar',
          onclick: (e) => { e.stopPropagation(); quitarItem(i); },
        }, '✕')
      )
    );
  });
  if (!doc.items.length) lista.appendChild(h('li', h('div.txt', h('small', 'Sin ítems todavía'))));

  return h('div.panel',
    h('div.panel-cab', h('h3', `Ítems (${doc.items.length})`)),
    h('div.panel-cuerpo.sin-pad', lista),
    h('div.panel-cuerpo',
      h('div.acciones',
        h('button.btn-primario.crecer', { onclick: abrirBiblioteca }, '＋ Biblioteca'),
        h('button.crecer', { onclick: abrirImportarDXF }, '⤒ Importar DXF'),
      ),
      h('button.mt-sm', { style: { width: '100%' }, onclick: duplicarItem }, '⧉ Duplicar el ítem actual')
    )
  );
}

function quitarItem(i) {
  doc.items.splice(i, 1);
  if (sel >= doc.items.length) sel = Math.max(0, doc.items.length - 1);
  recalcular();
  pintar();
}

function duplicarItem() {
  const it = doc.items[sel];
  if (!it) return toast('No hay ítem seleccionado');
  doc.items.splice(sel + 1, 0, JSON.parse(JSON.stringify({ ...it, nombre: it.nombre + ' (copia)' })));
  sel++;
  recalcular();
  pintar();
}

/* ------------------------------------------------------------------ */
/* Columna 2: visor + parámetros                                       */
/* ------------------------------------------------------------------ */

function panelCentro() {
  const it = doc.items[sel];
  if (!it) return h('div.panel', h('div.vacio', h('div.icono', '▱'), 'Agregá una pieza para empezar'));

  const res = doc._resueltos[sel];
  const material = G.materiales.find((m) => m.id === it.materialId) || G.materiales[0];

  const caja = h('div.lienzo-caja');
  const botonera = h('div.lienzo-btns');
  const info = h('div.lienzo-info');
  caja.appendChild(botonera);
  caja.appendChild(info);

  setTimeout(() => montarVisor(caja, botonera, info, res, it, material), 0);

  const tabs = h('div.tabs',
    ...[['2d', 'Plano 2D'], ['3d', 'Modelo 3D'], ['nest', 'Nesting']].map(([k, t]) =>
      h('button', { class: pestania === k ? 'activo' : '', onclick: () => { pestania = k; pintar(); } }, t))
  );

  return h('div',
    h('div.panel.mb',
      h('div.panel-cab', tabs, h('div.fila',
        h('button.btn-sm', { onclick: () => descargarDXFItem(sel) }, '⤓ DXF'),
      )),
      h('div.panel-cuerpo.sin-pad', caja)
    ),
    panelAvisos(it, res, material),
    panelParametros(it, res, material)
  );
}

function montarVisor(caja, botonera, info, res, it, material) {
  vaciar(botonera);
  if (pestania === '2d') {
    v2d = new Visor2D(caja, { alto: 400 });
    if (res?.shape) v2d.cargar(res.shape);
    const toggle = (clave, txt) => h('button', {
      class: v2d.opciones[clave] ? 'activo' : '',
      onclick: (e) => {
        v2d.opciones[clave] = !v2d.opciones[clave];
        e.target.style.opacity = v2d.opciones[clave] ? 1 : 0.55;
        v2d.dibujar();
      },
    }, txt);
    botonera.appendChild(h('button', { onclick: () => v2d.encuadrar() }, '⤢ Encuadrar'));
    botonera.appendChild(toggle('recorrido', 'Recorrido'));
    botonera.appendChild(toggle('cotas', 'Cotas'));
    botonera.appendChild(toggle('grilla', 'Grilla'));
    const r = coti?.items[sel];
    if (r) info.textContent = `${num(r.geometria.ancho, 1)} × ${num(r.geometria.alto, 1)} mm · corte ${num(r.geometria.largoCorteMM / 1000, 2)} m · ${r.geometria.piercings} perforaciones`;
  } else if (pestania === '3d') {
    v3d = new Visor3D(caja, { alto: 400 });
    if (res?.shape) {
      const Ri = radioInterno(it.plegado?.matrizV || matrizRecomendada(it.espesor), material);
      const mesh = construirMesh({ shape: res.shape, modelo3D: res._meta?.modelo3D }, it.espesor, Ri);
      v3d.cargar(mesh);
    }
    botonera.appendChild(h('button', { onclick: () => v3d.vistaIsometrica() }, 'Iso'));
    botonera.appendChild(h('button', { onclick: () => v3d.vistaFrontal() }, 'Frente'));
    botonera.appendChild(h('button', { onclick: () => v3d.vistaLateral() }, 'Lateral'));
    botonera.appendChild(h('button', { onclick: () => v3d.vistaSuperior() }, 'Planta'));
    botonera.appendChild(h('button', {
      onclick: (e) => { e.target.style.opacity = v3d.alternarAristas() ? 1 : 0.55; },
    }, 'Aristas'));
    info.textContent = 'Arrastrar: orbitar · Rueda: acercar · Botón derecho: mover';
  } else {
    dibujarNesting(caja, info);
    botonera.appendChild(h('button', { onclick: () => descargarDXFNesting() }, '⤓ DXF de chapa'));
  }
}

function dibujarNesting(caja, info) {
  const r = coti?.items[sel];
  const canvas = document.createElement('canvas');
  caja.appendChild(canvas);
  const pintarCanvas = () => {
    const dpr = window.devicePixelRatio || 1;
    const W = caja.clientWidth || 600;
    const H = 400;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.height = H + 'px';
    const c = canvas.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const oscuro = document.body.classList.contains('oscuro');
    c.fillStyle = oscuro ? '#1a212b' : '#f7f9fb';
    c.fillRect(0, 0, W, H);

    const layout = r?.nesting?.layout?.[0];
    if (!layout) {
      c.fillStyle = oscuro ? '#8a97a5' : '#5b6672';
      c.font = '13px "Segoe UI", sans-serif';
      c.textAlign = 'center';
      c.fillText(r?.nesting?.error || 'Sin nesting disponible', W / 2, H / 2);
      return;
    }
    const m = 24;
    const esc = Math.min((W - 2 * m) / layout.w, (H - 2 * m) / layout.h);
    const ox = (W - layout.w * esc) / 2;
    const oy = (H - layout.h * esc) / 2;
    c.fillStyle = oscuro ? '#232c38' : '#ffffff';
    c.strokeStyle = oscuro ? '#3d4a5a' : '#9aa8b8';
    c.lineWidth = 1.5;
    c.fillRect(ox, oy, layout.w * esc, layout.h * esc);
    c.strokeRect(ox, oy, layout.w * esc, layout.h * esc);

    c.fillStyle = 'rgba(228,87,46,.34)';
    c.strokeStyle = '#e4572e';
    c.lineWidth = 1;
    for (const p of layout.piezas) {
      if (p.poly && p.poly.length > 2) {
        // Nesting de forma real: se dibuja el contorno tal cual quedó anidado
        c.beginPath();
        c.moveTo(ox + p.poly[0][0] * esc, oy + (layout.h - p.poly[0][1]) * esc);
        for (let i = 1; i < p.poly.length; i++) {
          c.lineTo(ox + p.poly[i][0] * esc, oy + (layout.h - p.poly[i][1]) * esc);
        }
        c.closePath();
        c.fill();
        c.stroke();
      } else {
        const rot90 = p.rot === 90 || p.rot === 270 || p.rot === true;
        const x = ox + p.x * esc;
        const y = oy + (layout.h - p.y - (rot90 ? p.w : p.h)) * esc;
        c.fillRect(x, y, (rot90 ? p.h : p.w) * esc, (rot90 ? p.w : p.h) * esc);
        c.strokeRect(x, y, (rot90 ? p.h : p.w) * esc, (rot90 ? p.w : p.h) * esc);
      }
    }

    // Línea del retazo aprovechable que queda arriba
    if (layout.alturaOcupada && layout.alturaOcupada < layout.h - 40) {
      const yCorte = oy + (layout.h - layout.alturaOcupada) * esc;
      c.strokeStyle = '#1f7a4d';
      c.setLineDash([6, 4]);
      c.lineWidth = 1.4;
      c.beginPath();
      c.moveTo(ox, yCorte);
      c.lineTo(ox + layout.w * esc, yCorte);
      c.stroke();
      c.setLineDash([]);
      c.fillStyle = '#1f7a4d';
      c.font = '600 10px "Segoe UI", sans-serif';
      c.textAlign = 'left';
      c.fillText(`retazo útil ${Math.round(layout.h - layout.alturaOcupada)} mm`, ox + 4, yCorte - 4);
    }

    c.fillStyle = oscuro ? '#8a97a5' : '#5b6672';
    c.font = '11px "Segoe UI", sans-serif';
    c.textAlign = 'left';
    c.fillText(`Chapa ${layout.w} × ${layout.h} mm`, ox, oy - 8);
  };
  pintarCanvas();
  const ro = new ResizeObserver(pintarCanvas);
  ro.observe(caja);

  if (r?.nesting?.chapas != null) {
    info.textContent =
      `${r.nesting.piezasPorChapa} piezas por chapa · ${r.nesting.chapas} chapa(s) · ` +
      `aprovechamiento ${pct(r.nesting.aprovechamiento * 100, 1)} · anidado por ${r.nesting.metodo || 'rectángulo'}`;
  }
}

/* ---------------- Avisos de fabricabilidad ---------------- */

function panelAvisos(it, res, material) {
  const avisos = [...(res?.avisos || [])];
  const r = coti?.items[sel];

  if (r?.datosPliegue) {
    avisos.push(
      ...validarPlegado(
        {
          t: it.espesor,
          material,
          pliegues: [r.datosPliegue],
          largoMM: it.plegado.largoPliegue || 0,
          alas: res?._meta?.alas || [],
        },
        plegadora()
      )
    );
  }
  if (r?.nesting?.error) avisos.push({ nivel: 'error', msg: r.nesting.error + '. Reducí la medida o cambiá la chapa.' });
  if (r && r.geometria.ancho > (laser()?.areaTrabajo?.w || 3000)) {
    avisos.push({ nivel: 'error', msg: 'La pieza excede el área de trabajo de la máquina.' });
  }
  if (r?.nesting?.aprovechamientoUltima != null && r.nesting.aprovechamientoUltima < 0.45 && r.nesting.chapas >= 1) {
    avisos.push({
      nivel: 'info',
      msg: `La última chapa queda al ${pct(r.nesting.aprovechamientoUltima * 100, 0)} de uso. Ofrecerle más piezas al cliente casi no aumenta el costo de material.`,
    });
  }
  if (!avisos.length) return h('div');

  return h('div.panel.mb', h('div.panel-cuerpo',
    ...avisos.map((a) => h('div.aviso.aviso-' + (a.nivel || 'info'),
      h('span', a.nivel === 'error' ? '⛔' : a.nivel === 'aviso' ? '⚠' : 'ⓘ'),
      h('div', a.msg)))
  ));
}

/* ---------------- Parámetros del ítem ---------------- */

function panelParametros(it, res, material) {
  const cambiar = (k, v) => {
    it[k] = v;
    recalcularYPintar();
  };

  const selMaterial = h('select', ...G.materiales.filter((m) => m.activo !== false).map((m) =>
    h('option', { value: m.id, selected: m.id === it.materialId }, m.nombre)));
  selMaterial.onchange = () => {
    it.materialId = selMaterial.value;
    const m = G.materiales.find((x) => x.id === it.materialId);
    if (m && !m.espesores.includes(it.espesor)) it.espesor = m.espesores[Math.min(3, m.espesores.length - 1)];
    recalcular();
    pintar();
  };

  const selEspesor = h('select', ...material.espesores.map((e) =>
    h('option', { value: e, selected: Math.abs(e - it.espesor) < 1e-6 }, `${e} mm`)));
  selEspesor.onchange = () => { it.espesor = +selEspesor.value; it.gas = null; recalcular(); pintar(); };

  const recomendado = gasRecomendado(material, it.espesor);
  const selGas = h('select',
    h('option', { value: '', selected: !it.gas }, `Recomendado (${GASES[recomendado]?.nombre || recomendado})`),
    ...gasesDisponibles(material, it.espesor).map((g) =>
      h('option', { value: g.id, selected: it.gas === g.id }, `${GASES[g.id]?.nombre || g.id} — ${g.calidad}`))
  );
  selGas.onchange = () => { it.gas = selGas.value || null; recalcular(); pintar(); };

  const selAcabado = h('select', ...(G.config.acabados || DEFAULT_ACABADOS).map((a) =>
    h('option', { value: a.id, selected: a.id === it.acabadoId }, a.nombre)));
  selAcabado.onchange = () => cambiar('acabadoId', selAcabado.value);

  const selUrgencia = h('select',
    h('option', { value: 'normal', selected: it.urgencia === 'normal' }, 'Plazo normal'),
    h('option', { value: 'urgente', selected: it.urgencia === 'urgente' }, `Urgente (+${G.config.comercial.recargoUrgente} %)`),
    h('option', { value: 'express', selected: it.urgencia === 'express' }, `Express 24 h (+${G.config.comercial.recargoExpress} %)`),
  );
  selUrgencia.onchange = () => cambiar('urgencia', selUrgencia.value);

  /* --- Parámetros de la pieza de biblioteca --- */
  let bloqueParams = null;
  if (it.origen === 'libreria') {
    const def = getPieza(it.piezaId);
    const campos = def.params.map((p) => ({ ...p, ancho: p.tipo === 'num' ? 'medio' : null }));
    const form = formulario(campos, it.params, (k, v) => {
      it.params[k] = v;
      const r = geometria(it);
      if (r.meta?.plegado) it.plegado = { ...it.plegado, ...r.meta.plegado };
      recalcularYPintar();
    });
    bloqueParams = h('div',
      h('div.fila.entre.mb',
        h('strong', def.nombre),
        h('button.btn-sm', { onclick: abrirBiblioteca }, 'Cambiar pieza')
      ),
      h('p.chico.suave', { style: { marginTop: 0 } }, def.descripcion),
      form.el
    );
  } else {
    bloqueParams = h('div',
      h('div.aviso.aviso-info', h('span', 'ⓘ'), h('div', `Geometría importada${it.archivo ? ` de ${it.archivo}` : ''}. Las medidas vienen del archivo del cliente.`))
    );
  }

  /* --- Plegado --- */
  const pl = it.plegado || (it.plegado = { pliegues: 0, largoPliegue: 0, angulo: 90, matrizV: 0, herramentales: 1 });
  const bbox = res?.shape ? shapeBBox(res.shape) : { w: 0, h: 0 };
  const formPlegado = formulario(
    [
      { key: 'pliegues', label: 'Cantidad de pliegues', tipo: 'num', min: 0, entero: true, ancho: 'medio' },
      { key: 'angulo', label: 'Ángulo', tipo: 'num', min: 1, max: 170, unidad: '°', ancho: 'medio' },
      { key: 'largoPliegue', label: 'Largo de pliegue', tipo: 'num', min: 0, unidad: 'mm', ancho: 'medio' },
      {
        key: 'matrizV', label: 'Matriz V', tipo: 'sel', ancho: 'medio',
        opciones: [{ v: 0, t: `Automática (V${matrizRecomendada(it.espesor)})` }, ...MATRICES_V.map((v) => ({ v, t: `V${v}` }))],
      },
      { key: 'herramentales', label: 'Cambios de herramental', tipo: 'num', min: 1, entero: true, ancho: 'medio' },
    ],
    pl,
    (k, v) => {
      pl[k] = k === 'matrizV' ? +v || 0 : v;
      recalcularYPintar();
    }
  );
  if (!pl.largoPliegue && bbox.h) pl.largoPliegue = Math.round(Math.min(bbox.w, bbox.h));

  /* --- Procesos extra --- */
  const procs = G.config.procesos || DEFAULT_PROCESOS;
  const bloqueProcesos = h('div');
  for (const p of procs) {
    const actual = (it.procesos || []).find((x) => x.id === p.id);
    const inp = h('input', {
      type: 'number', min: 0, step: 'any', value: actual?.cantidad ?? 0,
      style: { width: '84px' },
      oninput: (e) => {
        const q = parseFloat(e.target.value) || 0;
        it.procesos = (it.procesos || []).filter((x) => x.id !== p.id);
        if (q > 0) it.procesos.push({ id: p.id, cantidad: q });
        recalcularYPintar();
      },
    });
    bloqueProcesos.appendChild(
      h('div.fila.entre', { style: { padding: '4px 0' } },
        h('div', h('div.chico', p.nombre), h('div.chico.tenue', p.unidad)),
        inp
      )
    );
  }

  return h('div.panel',
    h('div.panel-cab', h('h3', 'Configuración del ítem')),
    h('div.panel-cuerpo',
      h('div.campo', h('label', 'Nombre del ítem (aparece en el presupuesto)'),
        h('input', { type: 'text', value: it.nombre, oninput: (e) => { it.nombre = e.target.value; } })),

      h('div.campo-fila-3',
        h('div.campo', h('label', 'Material'), selMaterial),
        h('div.campo', h('label', 'Espesor'), selEspesor),
        h('div.campo', h('label', 'Cantidad'),
          h('input', {
            type: 'number', min: 1, step: 1, value: it.cantidad,
            oninput: debounce((e) => { it.cantidad = Math.max(1, Math.round(+e.target.value || 1)); recalcularYPintar(); }, 250),
          })),
      ),

      h('div.campo', h('label', 'Gas de asistencia'), selGas),
      panelGases(),


      h('details', { open: true },
        h('summary', { style: { cursor: 'pointer', margin: '4px 0 12px', fontWeight: 600 } }, 'Geometría'),
        bloqueParams
      ),

      h('details', { open: (pl.pliegues || 0) > 0 },
        h('summary', { style: { cursor: 'pointer', margin: '14px 0 10px', fontWeight: 600 } }, 'Plegado'),
        formPlegado.el,
        fichaPliegue()
      ),

      h('details',
        h('summary', { style: { cursor: 'pointer', margin: '14px 0 10px', fontWeight: 600 } }, 'Acabados y procesos'),
        h('div.campo', h('label', 'Acabado superficial'), selAcabado),
        h('div.campo', h('label', 'Prioridad'), selUrgencia),
        h('div.campo-fila',
          h('div.campo', h('label', 'Horas de ingeniería / CAD'),
            h('input', { type: 'number', min: 0, step: 0.25, value: it.ingenieriaHoras || 0,
              oninput: debounce((e) => { it.ingenieriaHoras = +e.target.value || 0; recalcularYPintar(); }, 250) })),
          h('div.campo', h('label', 'Margen del ítem (%)'),
            h('input', { type: 'number', min: 0, step: 1, placeholder: String(G.config.comercial.margen), value: it.margen ?? '',
              oninput: debounce((e) => { it.margen = e.target.value === '' ? undefined : +e.target.value; recalcularYPintar(); }, 250) })),
        ),
        h('label', { style: { marginTop: '8px' } }, 'Procesos adicionales'),
        bloqueProcesos
      )
    )
  );
}

/**
 * Comparativa de gases: lo que más plata mueve en inoxidable y aluminio.
 * Muestra qué pasaría con el mismo corte usando cada gas disponible.
 */
function panelGases() {
  const r = coti?.items[sel];
  if (!r?.alternativasGas?.length || r.alternativasGas.length < 2) return h('div');
  const sim = simbolo();
  const elegido = r.corte.gasTipo;
  const mejor = r.alternativasGas[0];
  const actual = r.alternativasGas.find((a) => a.gas === elegido);

  const filas = r.alternativasGas.map((a) => {
    const esActual = a.gas === elegido;
    return h('tr', { style: esActual ? { background: 'var(--naranja-suave)' } : null },
      h('td',
        h('strong', a.nombre),
        esActual ? h('span.badge.b-naranja', { style: { marginLeft: '6px' } }, 'en uso') : null,
        h('div.chico.tenue', a.calidad)),
      h('td.num.chico', num(a.velocidad, 0) + ' mm/min'),
      h('td.num.chico', num(a.caudal, 0) + ' m³/h'),
      h('td.num.negrita', money(a.costoGas, sim, 0))
    );
  });

  const ahorro = actual && mejor && actual.gas !== mejor.gas ? actual.costoGas - mejor.costoGas : 0;

  return h('details', { open: ahorro > 0 },
    h('summary', { style: { cursor: 'pointer', margin: '4px 0 10px', fontWeight: 600 } },
      'Comparativa de gases',
      ahorro > 0 ? h('span.badge.b-verde', { style: { marginLeft: '8px' } }, `ahorrás ${money(ahorro, sim, 0)}`) : null),
    h('table', { style: { fontSize: '12px' } },
      h('thead', h('tr', h('th', 'Gas'), h('th.num', 'Velocidad'), h('th.num', 'Caudal'), h('th.num', 'Costo del gas'))),
      h('tbody', ...filas)),
    ahorro > 0
      ? h('div.aviso.aviso-info', { style: { marginTop: '8px' } }, h('span', 'ⓘ'),
          h('div',
            `Con ${mejor.nombre.toLowerCase()} este trabajo gasta ${money(ahorro, sim, 0)} menos de gas. `,
            h('strong', 'Antes de cambiar, fijate si el canto lo permite: '),
            mejor.calidad))
      : null,
    h('div.chico.tenue', { style: { marginTop: '6px' } },
      `Boquilla ${num(r.corte.boquilla, 1)} mm · ${num(r.corte.gasPresion, 1)} bar · ${num(r.corte.gasM3, 2)} m³ para este lote`)
  );
}

function fichaPliegue() {
  const r = coti?.items[sel];
  if (!r?.datosPliegue) return h('div');
  const d = r.datosPliegue;
  const dev = doc._resueltos[sel]?._meta?.desarrollo;
  return h('div', { style: { background: 'var(--panel-2)', borderRadius: '8px', padding: '10px 12px', marginTop: '6px' } },
    h('div.chico.tenue.negrita', { style: { marginBottom: '6px' } }, 'CÁLCULO DE PLEGADO'),
    h('div.dato', h('span', 'Matriz V'), h('span', 'V' + d.matrizV)),
    h('div.dato', h('span', 'Radio interno'), h('span', num(d.radioInterno, 2) + ' mm')),
    h('div.dato', h('span', 'K-factor'), h('span', num(d.kFactor, 3))),
    h('div.dato', h('span', 'Deducción por pliegue'), h('span', num(d.BD, 2) + ' mm')),
    dev ? h('div.dato', h('span', 'Desarrollo total'), h('span', num(dev.desarrollo, 1) + ' mm')) : null,
    h('div.dato', h('span', 'Ala mínima'), h('span', num(d.alaMinima, 1) + ' mm')),
    h('div.dato', h('span', 'Fuerza requerida'), h('span', `${num(d.toneladas, 1)} t (${num(d.toneladasPorMetro, 1)} t/m)`)),
  );
}

/* ------------------------------------------------------------------ */
/* Columna 3: precio                                                   */
/* ------------------------------------------------------------------ */

function panelPrecio() {
  const sim = simbolo();
  const r = coti?.items[sel];
  const res = coti?.resumen;

  const fila = (a, b, clase = '') => h('div.fila' + (clase ? '.' + clase : ''), h('span', a), h('span', b));

  const desgloseItem = r
    ? h('div.desglose',
        fila('Material · ' + r.costos.modoMaterial, money(r.costos.material, sim, 0)),
        fila(`Corte láser · ${fmtTiempo(r.corte.tTotal)}`, money(r.costos.corte, sim, 0)),
        fila(`${r.corte.gasNombre} · ${num(r.costos.gasM3, 2)} m³`, money(r.costos.gas, sim, 0)),
        r.costos.plegado > 0 ? fila(`Plegado · ${fmtTiempo(r.plegado.tTotal)}`, money(r.costos.plegado, sim, 0)) : null,
        r.costos.acabado > 0 ? fila(r.costos.detalleAcabado.nombre, money(r.costos.acabado, sim, 0)) : null,
        r.costos.procesos > 0 ? fila('Procesos extra', money(r.costos.procesos, sim, 0)) : null,
        r.costos.ingenieria > 0 ? fila('Ingeniería', money(r.costos.ingenieria, sim, 0)) : null,
        fila('COSTO', money(r.costos.total, sim, 0), 'sub'),
        fila(`Margen ${num(r.precio.margen, 0)} %`, money(r.precio.lista - r.costos.total, sim, 0)),
        r.precio.descuentoPct > 0 ? fila(`Descuento por cantidad ${num(r.precio.descuentoPct, 0)} %`, '−' + money(r.precio.lista * r.precio.descuentoPct / 100, sim, 0)) : null,
        r.precio.recargoPct > 0 ? fila(`Recargo por urgencia ${num(r.precio.recargoPct, 0)} %`, money(r.precio.neto - r.precio.lista * (1 - r.precio.descuentoPct / 100), sim, 0)) : null,
        r.precio.iibb > 0 ? fila(`Ingresos brutos ${num(r.precio.iibbPct, 1)} %`, money(r.precio.iibb, sim, 0)) : null,
        r.precio.aplicoMinimo ? fila('Mínimo por ítem aplicado', '') : null,
        fila('Subtotal del ítem', money(r.precio.neto, sim, 0), 'total')
      )
    : h('div.vacio', 'Sin cálculo');

  const fichaTecnica = r
    ? h('div',
        h('div.dato', h('span', 'Peso unitario'), h('span', num(r.geometria.pesoPieza, 3) + ' kg')),
        h('div.dato', h('span', 'Peso total'), h('span', num(r.geometria.pesoTotal, 2) + ' kg')),
        h('div.dato', h('span', 'Largo de corte / pieza'), h('span', num(r.geometria.largoCorteMM / 1000, 2) + ' m')),
        h('div.dato', h('span', 'Perforaciones'), h('span', String(r.geometria.piercings))),
        h('div.dato', h('span', 'Gas de asistencia'), h('span', `${r.corte.gasNombre} · ${num(r.corte.gasPresion, 0)} bar`)),
        h('div.dato', h('span', 'Boquilla'), h('span', num(r.corte.boquilla, 1) + ' mm')),
        h('div.dato', h('span', 'Consumo de gas'), h('span', `${num(r.corte.gasCaudal, 0)} m³/h · ${num(r.costos.gasM3, 2)} m³`)),
        h('div.dato', h('span', 'Velocidad nominal'), h('span', num(r.corte.vNominal, 0) + ' mm/min')),
        h('div.dato', h('span', 'Velocidad media real'), h('span', num(r.corte.vMediaEfectiva, 0) + ' mm/min')),
        h('div.dato', h('span', 'Pérdida por geometría'), h('span', pct(r.corte.penalizacion * 100, 0))),
        h('div.dato', h('span', 'Tiempo por pieza'), h('span', fmtTiempo(r.corte.tPieza))),
        h('div.dato', h('span', 'Chapas necesarias'), h('span', String(r.nesting.chapas ?? '—'))),
        h('div.dato', h('span', 'Aprovechamiento'), h('span', pct((r.nesting.aprovechamiento || 0) * 100, 1))),
        h('div.mt-sm.barra' + ((r.nesting.aprovechamiento || 0) > 0.7 ? '.verde' : ''),
          h('div', { style: { width: Math.min(100, (r.nesting.aprovechamiento || 0) * 100) + '%' } })),
        h('div.dato', { style: { marginTop: '8px' } }, h('span', 'Costo hora láser'), h('span', money(r.costos.costoHoraLaser, sim, 0) + '/h')),
      )
    : h('div');

  const totalDoc = res
    ? h('div',
        h('div.desglose',
          fila('Subtotal', money(res.subtotal, sim, 2)),
          G.config.comercial.mostrarIVA ? fila(`IVA ${num(res.ivaPct, 0)} %`, money(res.iva, sim, 2)) : null,
        ),
        res.aplicoMinimo
          ? h('div.aviso.aviso-aviso', { style: { marginTop: '10px' } }, h('span', '⚠'),
              h('div', `Se aplicó el mínimo de facturación de ${money(G.config.comercial.minimoFacturacion, sim, 0)}. La suma de los ítems daba menos. Ajustalo en Configuración si no corresponde.`))
          : null,
        h('div', { style: { marginTop: '10px' } },
          h('div.chico.tenue', 'TOTAL DEL PRESUPUESTO'),
          h('div.precio-grande', money(res.total, sim, 2)),
          res.totalUSD ? h('div.precio-unit', `≈ US$ ${num(res.totalUSD, 2)}`) : null,
        ),
        h('div.mt-sm.chico.suave',
          `${res.piezasTotales} pieza${res.piezasTotales === 1 ? '' : 's'} · ${num(res.pesoTotal, 1)} kg · ` +
          `${res.chapasTotal} chapa${res.chapasTotal === 1 ? '' : 's'} · ${fmtTiempo(res.tiempoProduccion)} de máquina`),
        h('div.mt-sm.chico',
          h('span.suave', 'Utilidad estimada: '),
          h('span.negrita.verde', `${money(res.utilidad, sim, 0)} (${pct(res.utilidadPct, 1)})`)),
        h('div.campo.mt',
          h('label', 'Descuento global (%)'),
          h('input', { type: 'number', min: 0, max: 90, step: 1, value: doc.descuentoGlobal || 0,
            oninput: debounce((e) => { doc.descuentoGlobal = +e.target.value || 0; recalcularYPintar(); }, 300) })),
      )
    : h('div');

  return h('div',
    h('div.panel.mb',
      h('div.panel-cab', h('h3', 'Precio del ítem'), r ? h('span.chico.mono', money(r.precio.unitario, sim, 2) + ' c/u') : null),
      h('div.panel-cuerpo', desgloseItem)
    ),
    h('div.panel.mb',
      h('div.panel-cab', h('h3', 'Ficha técnica')),
      h('div.panel-cuerpo', fichaTecnica)
    ),
    h('div.panel.mb',
      h('div.panel-cab', h('h3', 'Total')),
      h('div.panel-cuerpo', totalDoc)
    ),
    h('div.panel',
      h('div.panel-cab', h('h3', 'Acciones')),
      h('div.panel-cuerpo',
        h('button.btn-azul', { style: { width: '100%' }, onclick: guardar }, '💾 Guardar presupuesto'),
        h('button.btn-primario.mt-sm', { style: { width: '100%' }, onclick: exportarPDF }, '📄 Generar PDF del presupuesto'),
        h('button.mt-sm', { style: { width: '100%' }, onclick: exportarOT }, '🧾 Orden de trabajo (taller)'),
        h('button.mt-sm', { style: { width: '100%' }, onclick: exportarEtiquetas }, '🏷 Etiquetas de piezas'),
        h('button.mt-sm', { style: { width: '100%' }, onclick: () => descargarDXFItem(sel) }, '⤓ DXF de la pieza'),
        h('button.mt-sm', { style: { width: '100%' }, onclick: descargarDXFNesting }, '⤓ DXF del nesting'),
        h('div.campo.mt', h('label', 'Observaciones para el presupuesto'),
          h('textarea', { rows: 3, value: doc.notas, oninput: (e) => { doc.notas = e.target.value; } }))
      )
    )
  );
}

/* ------------------------------------------------------------------ */
/* Biblioteca                                                          */
/* ------------------------------------------------------------------ */

function abrirBiblioteca() {
  const cuerpo = h('div');
  for (const cat of categorias()) {
    cuerpo.appendChild(h('h4', { style: { margin: '18px 0 8px', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '.6px', color: 'var(--naranja)' } }, cat.nombre));
    cuerpo.appendChild(
      h('div.grid.g3', ...cat.piezas.map((p) =>
        h('div.tarjeta-pieza', {
          onclick: () => {
            elegirPieza(p.id);
            cerrarModal();
          },
        },
          h('div.cat', cat.nombre),
          h('strong', p.nombre),
          h('p', p.descripcion)
        )))
    );
  }
  modal({ titulo: 'Biblioteca de piezas paramétricas', cuerpo, ancho: '1000px' });
}

function elegirPieza(piezaId) {
  const it = doc.items[sel];
  const nuevo = itemNuevo({ piezaId, params: paramsPorDefecto(piezaId), nombre: getPieza(piezaId).nombre });
  if (it && it.origen === 'libreria') {
    Object.assign(it, { piezaId, params: paramsPorDefecto(piezaId), nombre: getPieza(piezaId).nombre, origen: 'libreria' });
  } else {
    doc.items.push(nuevo);
    sel = doc.items.length - 1;
  }
  const r = geometria(doc.items[sel]);
  if (r.meta?.plegado) doc.items[sel].plegado = { ...doc.items[sel].plegado, ...r.meta.plegado };
  recalcular();
  pintar();
}

/* ------------------------------------------------------------------ */
/* Importar DXF                                                        */
/* ------------------------------------------------------------------ */

function abrirImportarDXF() {
  const input = h('input', { type: 'file', accept: '.dxf', style: { display: 'none' } });
  const zona = h('div.zona-suelta',
    h('div', { style: { fontSize: '30px', marginBottom: '8px' } }, '⤒'),
    h('strong', 'Soltá acá el DXF del cliente'),
    h('div.chico', { style: { marginTop: '4px' } }, 'o hacé clic para elegir el archivo')
  );
  const resultado = h('div.mt');

  zona.onclick = () => input.click();
  zona.ondragover = (e) => { e.preventDefault(); zona.classList.add('activa'); };
  zona.ondragleave = () => zona.classList.remove('activa');
  zona.ondrop = (e) => {
    e.preventDefault();
    zona.classList.remove('activa');
    if (e.dataTransfer.files[0]) procesar(e.dataTransfer.files[0]);
  };
  input.onchange = () => input.files[0] && procesar(input.files[0]);

  function procesar(file) {
    const lector = new FileReader();
    lector.onload = () => {
      vaciar(resultado);
      let r;
      try {
        r = leerDXF(String(lector.result), { espesor: doc.items[sel]?.espesor || 2 });
      } catch (e) {
        resultado.appendChild(h('div.aviso.aviso-error', h('span', '⛔'), h('div', 'No se pudo leer el archivo: ' + e.message)));
        return;
      }
      for (const a of r.avisos) {
        resultado.appendChild(h('div.aviso.aviso-' + a.nivel, h('span', a.nivel === 'error' ? '⛔' : a.nivel === 'aviso' ? '⚠' : 'ⓘ'), h('div', a.msg)));
      }
      if (!r.piezas.length) return;

      resultado.appendChild(h('div.chico.suave.mb',
        `${r.stats.entidades} entidades · ${r.stats.contornosCerrados} contornos cerrados · unidades: ${r.unidades}`));

      const grilla = h('div.grid.g4');
      r.piezas.forEach((p, i) => {
        const sh = { outer: p.outer, holes: p.holes, pliegues: [] };
        const b = shapeBBox(sh);
        const img = h('img', { src: miniatura(sh, 150, 120), style: { width: '100%', borderRadius: '6px', background: '#fff' } });
        grilla.appendChild(
          h('div.tarjeta-pieza', {
            onclick: () => {
              agregarDesdeDXF(sh, file.name, i + 1);
              cerrarModal();
            },
          },
            img,
            h('strong', { style: { marginTop: '6px' } }, `Pieza ${i + 1}`),
            h('p', `${num(b.w, 1)} × ${num(b.h, 1)} mm · ${p.holes.length} agujeros`)
          )
        );
      });
      resultado.appendChild(grilla);

      if (r.piezas.length > 1) {
        resultado.appendChild(h('button.btn-primario.mt', {
          onclick: () => {
            r.piezas.forEach((p, i) => agregarDesdeDXF({ outer: p.outer, holes: p.holes, pliegues: [] }, file.name, i + 1));
            cerrarModal();
          },
        }, `Agregar las ${r.piezas.length} piezas al presupuesto`));
      }
    };
    lector.readAsText(file);
  }

  modal({
    titulo: 'Importar DXF y cotizar',
    ancho: '860px',
    cuerpo: h('div',
      h('p.chico.suave', { style: { marginTop: 0 } },
        'Se leen LINE, ARC, CIRCLE, LWPOLYLINE, POLYLINE, ELLIPSE, SPLINE y bloques. Las capas PLEGADO / BEND se interpretan como líneas de plegado y no se cortan.'),
      zona, input, resultado
    ),
  });
}

function agregarDesdeDXF(shape, archivo, n) {
  const it = itemNuevo({
    origen: 'dxf',
    nombre: `${archivo.replace(/\.dxf$/i, '')}${n > 1 ? ' · ' + n : ''}`,
    shape,
    archivo,
    meta: { modelo3D: { tipo: 'plano' } },
  });
  delete it.piezaId;
  delete it.params;
  doc.items.push(it);
  sel = doc.items.length - 1;
  recalcular();
  pintar();
  toast('Pieza importada y cotizada', 'ok');
}

/* ------------------------------------------------------------------ */
/* Exportaciones                                                       */
/* ------------------------------------------------------------------ */

function nombreArchivo(base, ext) {
  const cli = (doc.cliente?.nombre || 'sin-cliente').replace(/[^\w\sáéíóúñÁÉÍÓÚÑ-]/g, '').trim().replace(/\s+/g, '-');
  return `${base}-${doc.numero || 'borrador'}-${cli}.${ext}`.toLowerCase();
}

function descargarDXFItem(i) {
  const res = doc._resueltos?.[i];
  if (!res?.shape) return toast('Ese ítem no tiene geometría', 'error');
  const it = doc.items[i];
  // Las líneas de plegado ya viajan dentro de shape.pliegues: no repetirlas
  // acá, o el CAM recibiría cada una dos veces.
  const dxf = generarDXF([{ shape: res.shape }], {
    titulo: `KORT - ${it.nombre}`,
    subtitulo: `${it.materialId} ${it.espesor} mm - Cantidad ${it.cantidad}`,
  });
  const nombre = `${(it.nombre || 'pieza').replace(/[^\w-]/g, '_')}-${it.espesor}mm.dxf`;
  descargar(nombre, dxf, 'application/dxf');
  api.guardarArchivo(nombre, dxf, 'dxf').catch(() => {});
  toast('DXF generado y guardado en salidas/dxf', 'ok');
}

function descargarDXFNesting() {
  const r = coti?.items[sel];
  const res = doc._resueltos?.[sel];
  if (!r?.nesting?.layout?.length || !res?.shape) return toast('Sin nesting para exportar', 'error');
  let n = 0;
  for (const chapa of r.nesting.layout) {
    const dxf = generarDXFNesting(chapa, { p: res.shape });
    const nombre = `nesting-${(doc.items[sel].nombre || 'pieza').replace(/[^\w-]/g, '_')}-chapa${chapa.indice}.dxf`;
    descargar(nombre, dxf, 'application/dxf');
    api.guardarArchivo(nombre, dxf, 'dxf').catch(() => {});
    n++;
    if (n >= 6) break; // no inundar la carpeta de descargas
  }
  toast(`${n} chapa(s) exportada(s)`, 'ok');
}

function miniaturasDeItems() {
  const m = {};
  (doc._resueltos || []).forEach((r, i) => {
    if (r.shape) m[i] = miniatura(r.shape, 340, 280);
  });
  return m;
}

async function exportarPDF() {
  if (!coti?.items.length) return toast('No hay ítems para cotizar', 'error');
  if (!doc.numero) doc.numero = (await api.get('numero?tipo=P')).numero;
  const bytes = generarPresupuestoPDF({
    presupuesto: doc,
    cotizacion: coti,
    config: G.config,
    miniaturas: miniaturasDeItems(),
  });
  const nombre = nombreArchivo('presupuesto', 'pdf');
  descargar(nombre, bytes, 'application/pdf');
  try {
    await api.guardarArchivo(nombre, bytes, 'presupuestos');
    toast('PDF generado y guardado en salidas/presupuestos', 'ok');
  } catch {
    toast('PDF descargado', 'ok');
  }
}

async function exportarOT() {
  if (!coti?.items.length) return toast('No hay ítems', 'error');
  const numero = doc.numeroOT || (await api.get('numero?tipo=OT')).numero;
  doc.numeroOT = numero;
  const bytes = generarOrdenTrabajoPDF({
    orden: { numero, cliente: doc.cliente, fechaEntrega: null },
    cotizacion: coti,
    config: G.config,
    miniaturas: miniaturasDeItems(),
  });
  const nombre = `orden-trabajo-${numero}.pdf`;
  descargar(nombre, bytes, 'application/pdf');
  api.guardarArchivo(nombre, bytes, 'ordenes').catch(() => {});
  toast('Orden de trabajo generada', 'ok');
}

async function exportarEtiquetas() {
  if (!coti?.items.length) return toast('No hay ítems', 'error');
  const numero = doc.numeroOT || (await api.get('numero?tipo=OT')).numero;
  doc.numeroOT = numero;
  const bytes = generarEtiquetasPiezasPDF({
    orden: { id: doc.id, numero, cliente: doc.cliente, fechaEntrega: null },
    cotizacion: coti,
    config: G.config,
    baseUrl: window.location.origin,
  });
  const nombre = `etiquetas-${numero}.pdf`;
  descargar(nombre, bytes, 'application/pdf');
  api.guardarArchivo(nombre, bytes, 'etiquetas').catch(() => {});
  toast('Etiquetas generadas', 'ok');
}

async function guardar() {
  if (!coti) return;
  // Se guardan además, desnormalizados, los valores que la base indexa para
  // poder consultarlos por SQL (facturación por material, kg consumidos...).
  const cuerpo = {
    ...doc,
    _resueltos: undefined,
    resumen: coti.resumen,
    items: doc.items.map((it, i) => {
      const r = coti.items[i];
      return {
        ...it,
        shape: it.origen === 'dxf' ? it.shape : undefined,
        gas: r?.corte?.gasTipo ?? it.gas ?? null,
        _pesoTotal: r?.geometria?.pesoTotal ?? 0,
        _largoCorte: r?.geometria?.largoCorteMM ?? 0,
        _precioNeto: r?.precio?.neto ?? 0,
        _costoTotal: r?.costos?.total ?? 0,
      };
    }),
  };
  try {
    // Alta de cliente nuevo si se escribió un nombre que no está en la base
    if (doc.cliente?.nombre && !doc.clienteId) {
      const existe = G.clientes.find((c) => c.nombre.toLowerCase() === doc.cliente.nombre.toLowerCase());
      if (!existe) {
        const c = await api.post('clientes', { ...doc.cliente, notas: '' });
        doc.clienteId = c.id;
        cuerpo.clienteId = c.id;
        await recargarClientes();
      } else doc.clienteId = cuerpo.clienteId = existe.id;
    }
    if (doc.id) {
      await api.put('presupuestos/' + doc.id, cuerpo);
      toast('Presupuesto actualizado', 'ok');
    } else {
      const nuevo = await api.post('presupuestos', cuerpo);
      doc.id = nuevo.id;
      doc.numero = nuevo.numero;
      toast(`Presupuesto ${nuevo.numero} guardado`, 'ok');
    }
    pintar();
  } catch (e) {
    toast('No se pudo guardar: ' + e.message, 'error');
  }
}
