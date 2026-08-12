/** KORT - Utilidades de interfaz (creación de DOM, avisos, modales, formularios). */

/** Crea un elemento. h('div.clase#id', {attrs}, hijos...) */
export function h(sel, props = null, ...hijos) {
  let tag = 'div';
  const clases = [];
  let id = null;
  const m = String(sel).match(/^([a-zA-Z0-9]+)?((?:[.#][\w-]+)*)$/);
  if (m) {
    tag = m[1] || 'div';
    for (const p of (m[2] || '').match(/[.#][\w-]+/g) || []) {
      if (p[0] === '.') clases.push(p.slice(1));
      else id = p.slice(1);
    }
  } else tag = sel;

  const el = document.createElement(tag);
  if (clases.length) el.className = clases.join(' ');
  if (id) el.id = id;

  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    hijos.unshift(props);
    props = null;
  }
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className += (el.className ? ' ' : '') + v;
      else if (k === 'html') el.innerHTML = v;
      else if (k === 'text') el.textContent = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked') el.checked = !!v;
      else el.setAttribute(k, v);
    }
  }
  agregar(el, hijos);
  return el;
}

function agregar(el, hijos) {
  for (const c of hijos.flat(4)) {
    if (c == null || c === false || c === true) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export function vaciar(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/* ---------------- Avisos ---------------- */

export function toast(msg, tipo = '', ms = 3200) {
  const t = h('div.toast' + (tipo ? '.' + tipo : ''), msg);
  $('#toasts').appendChild(t);
  setTimeout(() => {
    t.style.transition = 'opacity .25s, transform .25s';
    t.style.opacity = '0';
    t.style.transform = 'translateX(20px)';
    setTimeout(() => t.remove(), 260);
  }, ms);
}

export function estado(txt) {
  const c = $('#chip-estado');
  if (c) c.textContent = txt;
}

/* ---------------- Modal ---------------- */

export function modal({ titulo, cuerpo, pie, ancho }) {
  const fondo = $('#modal-fondo');
  const m = $('#modal');
  vaciar(m);
  if (ancho) m.style.maxWidth = ancho;
  m.appendChild(
    h('div.modal-cab', h('h3', titulo), h('button.btn-sm', { onclick: cerrarModal }, '✕'))
  );
  m.appendChild(h('div.modal-cuerpo', cuerpo));
  if (pie) m.appendChild(h('div.modal-pie', pie));
  fondo.classList.remove('oculto');
  fondo.onclick = (e) => {
    if (e.target === fondo) cerrarModal();
  };
  return m;
}

export function cerrarModal() {
  $('#modal-fondo').classList.add('oculto');
}

export function confirmar(titulo, mensaje, onSi, textoSi = 'Confirmar') {
  modal({
    titulo,
    ancho: '460px',
    cuerpo: h('p', { style: { margin: 0, lineHeight: '1.6' } }, mensaje),
    pie: [
      h('button', { onclick: cerrarModal }, 'Cancelar'),
      h('button.btn-primario', {
        onclick: () => {
          cerrarModal();
          onSi();
        },
      }, textoSi),
    ],
  });
}

/* ---------------- Formularios ---------------- */

/**
 * Genera un formulario a partir de una definición de campos.
 * campos: [{key,label,tipo:'num'|'txt'|'sel'|'bool'|'area',unidad,opciones,min,max,paso,ancho}]
 */
export function formulario(campos, valores, onCambio, opts = {}) {
  const cont = h('div');
  const inputs = {};
  let fila = null;

  for (const c of campos) {
    const val = valores[c.key] ?? c.def ?? '';
    let input;

    if (c.tipo === 'bool') {
      input = h('input', { type: 'checkbox', checked: !!val });
      const campo = h('div.check', input, h('label', c.label));
      input.addEventListener('change', () => onCambio(c.key, input.checked));
      cont.appendChild(campo);
      inputs[c.key] = input;
      continue;
    }

    if (c.tipo === 'sel') {
      input = h('select', ...(c.opciones || []).map((o) =>
        h('option', { value: o.v ?? o.value ?? o, selected: (o.v ?? o.value ?? o) === val }, o.t ?? o.text ?? o)
      ));
      input.value = val;
      input.addEventListener('change', () => onCambio(c.key, input.value));
    } else if (c.tipo === 'area') {
      input = h('textarea', { rows: c.filas || 3 });
      input.value = val;
      input.addEventListener('input', () => onCambio(c.key, input.value));
    } else if (c.tipo === 'txt') {
      input = h('input', { type: 'text', placeholder: c.placeholder || '' });
      input.value = val;
      input.addEventListener('input', () => onCambio(c.key, input.value));
    } else {
      input = h('input', {
        type: 'number',
        step: c.paso ?? (c.entero ? 1 : 'any'),
        min: c.min ?? null,
        max: c.max ?? null,
      });
      input.value = val;
      const emitir = () => {
        let v = parseFloat(input.value);
        if (!isFinite(v)) v = c.def ?? 0;
        onCambio(c.key, v);
      };
      input.addEventListener('input', debounce(emitir, opts.debounce ?? 220));
      input.addEventListener('blur', emitir);
    }

    const envoltura = c.unidad
      ? h('div.unidad', input, h('span', c.unidad))
      : input;
    const campo = h('div.campo', h('label', c.label), envoltura);
    inputs[c.key] = input;

    if (c.ancho === 'medio') {
      if (!fila) {
        fila = h('div.campo-fila');
        cont.appendChild(fila);
      }
      fila.appendChild(campo);
      if (fila.children.length >= 2) fila = null;
    } else {
      fila = null;
      cont.appendChild(campo);
    }
  }
  return { el: cont, inputs };
}

export function debounce(fn, ms) {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
}

/* ---------------- Formato ---------------- */

export function money(v, sim = '$', dec = 2) {
  if (!isFinite(v)) return '—';
  const n = Math.abs(v).toFixed(dec);
  const [e, d] = n.split('.');
  return `${v < 0 ? '-' : ''}${sim} ${e.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${d ? ',' + d : ''}`;
}

export function num(v, d = 1) {
  if (!isFinite(v)) return '—';
  return v.toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function pct(v, d = 1) {
  return num(v, d) + ' %';
}

export function fecha(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function fechaHora(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** Descarga bytes o texto como archivo. */
export function descargar(nombre, datos, mime = 'application/octet-stream') {
  const blob = datos instanceof Blob ? datos : new Blob([datos], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: nombre });
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 1500);
}

export function bytesABase64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export const ESTADOS_PRESUPUESTO = {
  borrador: { txt: 'Borrador', clase: 'b-gris' },
  enviado: { txt: 'Enviado', clase: 'b-azul' },
  aprobado: { txt: 'Aprobado', clase: 'b-verde' },
  rechazado: { txt: 'Rechazado', clase: 'b-rojo' },
  vencido: { txt: 'Vencido', clase: 'b-amarillo' },
  facturado: { txt: 'Facturado', clase: 'b-verde' },
};

export const ESTADOS_OT = {
  pendiente: { txt: 'Pendiente', clase: 'b-gris' },
  material: { txt: 'Esperando material', clase: 'b-amarillo' },
  corte: { txt: 'En corte', clase: 'b-naranja' },
  plegado: { txt: 'En plegado', clase: 'b-naranja' },
  terminado: { txt: 'Terminado', clase: 'b-azul' },
  entregado: { txt: 'Entregado', clase: 'b-verde' },
  cancelado: { txt: 'Cancelado', clase: 'b-rojo' },
};

export function badge(mapa, estado) {
  const e = mapa[estado] || mapa.borrador || { txt: estado || '—', clase: 'b-gris' };
  return h('span.badge.' + e.clase, e.txt);
}
