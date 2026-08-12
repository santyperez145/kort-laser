/**
 * KORT - Visor 2D
 *
 * Dibuja la pieza en canvas: contorno, agujeros, líneas de plegado, recorrido
 * de corte con el orden real (agujeros primero, contorno al final), puntos de
 * perforación y cotas generales. Zoom con la rueda, desplazamiento arrastrando.
 */

import { flattenPath, pathBBox, arcSweep } from '/src/core/geometry.js';
import { recorridoRapido } from '/src/core/cutting.js';

const COLORES = {
  claro: { fondo: '#f7f9fb', grilla: '#e3e9ef', grillaFuerte: '#cfd8e2', corte: '#12161c', interior: '#1b6fc2', plegado: '#e4572e', rapido: '#b6c1cd', pierce: '#e4572e', cota: '#5b6672', chapa: '#9aa8b8' },
  oscuro: { fondo: '#1a212b', grilla: '#232c38', grillaFuerte: '#2e3a49', corte: '#e8edf3', interior: '#59a5e8', plegado: '#ff7a52', rapido: '#3d4a5a', pierce: '#ff7a52', cota: '#8a97a5', chapa: '#4a5768' },
};

export class Visor2D {
  constructor(contenedor, opts = {}) {
    this.cont = contenedor;
    this.canvas = document.createElement('canvas');
    this.canvas.style.cursor = 'grab';
    this.ctx = this.canvas.getContext('2d');
    this.cont.appendChild(this.canvas);

    this.escala = 1;
    this.ox = 0;
    this.oy = 0;
    this.shape = null;
    this.opciones = {
      grilla: true,
      recorrido: false,
      piercings: true,
      cotas: true,
      plegado: true,
      relleno: true,
      ...opts,
    };
    this.alto = opts.alto || 420;
    this._eventos();
    this._observer = new ResizeObserver(() => this.redimensionar());
    this._observer.observe(this.cont);
    this.redimensionar();
  }

  get col() {
    return document.body.classList.contains('oscuro') ? COLORES.oscuro : COLORES.claro;
  }

  destruir() {
    this._observer?.disconnect();
  }

  redimensionar() {
    const dpr = window.devicePixelRatio || 1;
    const w = this.cont.clientWidth || 600;
    const hh = this.alto;
    this.canvas.width = w * dpr;
    this.canvas.height = hh * dpr;
    this.canvas.style.height = hh + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.W = w;
    this.H = hh;
    this.dibujar();
  }

  _eventos() {
    let arrastrando = false;
    let px = 0;
    let py = 0;
    this.canvas.addEventListener('mousedown', (e) => {
      e.preventDefault(); // si no, arrastrar selecciona el texto de la página
      arrastrando = true;
      px = e.clientX;
      py = e.clientY;
      this.canvas.style.cursor = 'grabbing';
      document.body.style.userSelect = 'none';
    });
    window.addEventListener('mouseup', () => {
      arrastrando = false;
      this.canvas.style.cursor = 'grab';
      document.body.style.userSelect = '';
    });
    window.addEventListener('mousemove', (e) => {
      if (!arrastrando) return;
      this.ox += e.clientX - px;
      this.oy += e.clientY - py;
      px = e.clientX;
      py = e.clientY;
      this.dibujar();
    });
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = this.canvas.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      const f = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const nueva = Math.max(0.02, Math.min(80, this.escala * f));
      this.ox = mx - ((mx - this.ox) * nueva) / this.escala;
      this.oy = my - ((my - this.oy) * nueva) / this.escala;
      this.escala = nueva;
      this.dibujar();
    }, { passive: false });
  }

  cargar(shape, extra = {}) {
    this.shape = shape;
    this.extra = extra;
    this.encuadrar();
  }

  encuadrar() {
    if (!this.shape) return;
    const b = pathBBox(this.shape.outer);
    const m = 46;
    const sx = (this.W - 2 * m) / Math.max(b.w, 1);
    const sy = (this.H - 2 * m) / Math.max(b.h, 1);
    this.escala = Math.min(sx, sy);
    this.ox = (this.W - b.w * this.escala) / 2 - b.minX * this.escala;
    this.oy = (this.H + b.h * this.escala) / 2 + b.minY * this.escala;
    this.dibujar();
  }

  X(x) { return this.ox + x * this.escala; }
  Y(y) { return this.oy - y * this.escala; }

  dibujar() {
    const c = this.ctx;
    const col = this.col;
    c.fillStyle = col.fondo;
    c.fillRect(0, 0, this.W, this.H);
    if (!this.shape) {
      c.fillStyle = col.cota;
      c.font = '13px "Segoe UI", sans-serif';
      c.textAlign = 'center';
      c.fillText('Sin geometría', this.W / 2, this.H / 2);
      return;
    }
    if (this.opciones.grilla) this._grilla();
    if (this.extra?.chapa) this._chapa(this.extra.chapa);

    const sh = this.shape;

    if (this.opciones.relleno) {
      c.beginPath();
      this._trazar(sh.outer);
      for (const hh of sh.holes || []) this._trazar(hh);
      c.fillStyle = document.body.classList.contains('oscuro') ? 'rgba(90,140,200,.16)' : 'rgba(27,58,92,.09)';
      c.fill('evenodd');
    }

    if (this.opciones.recorrido) this._recorrido();

    c.lineWidth = 1.7;
    c.strokeStyle = col.corte;
    c.beginPath();
    this._trazar(sh.outer);
    c.stroke();

    c.lineWidth = 1.3;
    c.strokeStyle = col.interior;
    for (const hh of sh.holes || []) {
      c.beginPath();
      this._trazar(hh);
      c.stroke();
    }

    if (this.opciones.plegado) this._plegado();
    if (this.opciones.piercings) this._piercings();
    if (this.opciones.cotas) this._cotas();
  }

  _trazar(path) {
    const c = this.ctx;
    let primero = true;
    for (const s of path.segs) {
      if (s.t === 'L') {
        if (primero) {
          c.moveTo(this.X(s.x1), this.Y(s.y1));
          primero = false;
        }
        c.lineTo(this.X(s.x2), this.Y(s.y2));
      } else {
        const sweep = arcSweep(s);
        const a1 = -s.a1;
        const a2 = -(s.a1 + sweep);
        c.arc(this.X(s.cx), this.Y(s.cy), s.r * this.escala, a1, a2, sweep > 0);
        primero = false;
      }
    }
    c.closePath();
  }

  _grilla() {
    const c = this.ctx;
    const col = this.col;
    // Paso de grilla adaptativo: 1, 5, 10, 50, 100... mm
    const objetivo = 60; // px
    const pasos = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
    let paso = pasos.find((p) => p * this.escala >= objetivo) || 1000;
    c.lineWidth = 1;
    for (const [p, color] of [[paso, col.grilla], [paso * 5, col.grillaFuerte]]) {
      c.strokeStyle = color;
      c.beginPath();
      const x0 = Math.floor((-this.ox / this.escala) / p) * p;
      for (let x = x0; this.X(x) < this.W; x += p) {
        c.moveTo(Math.round(this.X(x)) + 0.5, 0);
        c.lineTo(Math.round(this.X(x)) + 0.5, this.H);
      }
      const y0 = Math.floor(((this.oy - this.H) / this.escala) / p) * p;
      for (let y = y0; this.Y(y) > 0; y += p) {
        c.moveTo(0, Math.round(this.Y(y)) + 0.5);
        c.lineTo(this.W, Math.round(this.Y(y)) + 0.5);
      }
      c.stroke();
    }
  }

  _chapa(ch) {
    const c = this.ctx;
    c.strokeStyle = this.col.chapa;
    c.setLineDash([7, 5]);
    c.lineWidth = 1.4;
    c.strokeRect(this.X(0), this.Y(ch.h), ch.w * this.escala, ch.h * this.escala);
    c.setLineDash([]);
  }

  _plegado() {
    const lp = this.shape.pliegues || this.extra?.pliegues || [];
    if (!lp.length) return;
    const c = this.ctx;
    c.strokeStyle = this.col.plegado;
    c.lineWidth = 1.5;
    c.setLineDash([9, 5]);
    for (const l of lp) {
      c.beginPath();
      c.moveTo(this.X(l.x1), this.Y(l.y1));
      c.lineTo(this.X(l.x2), this.Y(l.y2));
      c.stroke();
    }
    c.setLineDash([]);
    if (this.escala > 0.28) {
      c.fillStyle = this.col.plegado;
      c.font = '600 10px "Segoe UI", sans-serif';
      c.textAlign = 'center';
      for (const l of lp) {
        if (!l.label) continue;
        const mx = this.X((l.x1 + l.x2) / 2);
        const my = this.Y((l.y1 + l.y2) / 2);
        const vertical = Math.abs(l.x2 - l.x1) < Math.abs(l.y2 - l.y1);
        c.save();
        c.translate(mx, my);
        if (vertical) c.rotate(-Math.PI / 2);
        c.fillText(l.label, 0, -4);
        c.restore();
      }
    }
  }

  _piercings() {
    const c = this.ctx;
    c.fillStyle = this.col.pierce;
    const puntos = [];
    const primero = (p) => {
      const s = p.segs[0];
      return s.t === 'L' ? [s.x1, s.y1] : [s.cx + s.r * Math.cos(s.a1), s.cy + s.r * Math.sin(s.a1)];
    };
    puntos.push(primero(this.shape.outer));
    for (const hh of this.shape.holes || []) puntos.push(primero(hh));
    for (const [x, y] of puntos) {
      c.beginPath();
      c.arc(this.X(x), this.Y(y), 2.6, 0, Math.PI * 2);
      c.fill();
    }
  }

  _recorrido() {
    const c = this.ctx;
    const { orden } = recorridoRapido(this.shape);
    c.strokeStyle = this.col.rapido;
    c.lineWidth = 1;
    c.setLineDash([3, 4]);
    c.beginPath();
    let cur = [0, 0];
    for (const p of orden) {
      const s = p.segs[0];
      const ini = s.t === 'L' ? [s.x1, s.y1] : [s.cx + s.r * Math.cos(s.a1), s.cy + s.r * Math.sin(s.a1)];
      c.moveTo(this.X(cur[0]), this.Y(cur[1]));
      c.lineTo(this.X(ini[0]), this.Y(ini[1]));
      cur = ini;
    }
    c.stroke();
    c.setLineDash([]);
  }

  _cotas() {
    const b = pathBBox(this.shape.outer);
    const c = this.ctx;
    const col = this.col.cota;
    c.strokeStyle = col;
    c.fillStyle = col;
    c.lineWidth = 1;
    c.font = '600 11px "Segoe UI", sans-serif';
    const d = 18;

    // Horizontal (abajo)
    const y = this.Y(b.minY) + d;
    c.beginPath();
    c.moveTo(this.X(b.minX), y);
    c.lineTo(this.X(b.maxX), y);
    c.moveTo(this.X(b.minX), y - 4);
    c.lineTo(this.X(b.minX), y + 4);
    c.moveTo(this.X(b.maxX), y - 4);
    c.lineTo(this.X(b.maxX), y + 4);
    c.stroke();
    c.textAlign = 'center';
    const txtW = `${b.w.toFixed(1)} mm`;
    const anchoTxt = c.measureText(txtW).width + 8;
    c.fillStyle = this.col.fondo;
    c.fillRect(this.X((b.minX + b.maxX) / 2) - anchoTxt / 2, y - 8, anchoTxt, 14);
    c.fillStyle = col;
    c.fillText(txtW, this.X((b.minX + b.maxX) / 2), y + 4);

    // Vertical (izquierda)
    const x = this.X(b.minX) - d;
    c.beginPath();
    c.moveTo(x, this.Y(b.minY));
    c.lineTo(x, this.Y(b.maxY));
    c.moveTo(x - 4, this.Y(b.minY));
    c.lineTo(x + 4, this.Y(b.minY));
    c.moveTo(x - 4, this.Y(b.maxY));
    c.lineTo(x + 4, this.Y(b.maxY));
    c.stroke();
    c.save();
    c.translate(x, this.Y((b.minY + b.maxY) / 2));
    c.rotate(-Math.PI / 2);
    const txtH = `${b.h.toFixed(1)} mm`;
    const anchoTxt2 = c.measureText(txtH).width + 8;
    c.fillStyle = this.col.fondo;
    c.fillRect(-anchoTxt2 / 2, -8, anchoTxt2, 14);
    c.fillStyle = col;
    c.fillText(txtH, 0, 4);
    c.restore();
  }
}

/**
 * Renderiza una miniatura de la pieza sobre fondo blanco y la devuelve como
 * dataURL JPEG (lo que necesita el generador de PDF).
 */
export function miniatura(shape, w = 320, h = 260, opts = {}) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const c = cv.getContext('2d');
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, w, h);
  if (!shape) return cv.toDataURL('image/jpeg', 0.86);

  const b = pathBBox(shape.outer);
  const m = 14;
  const esc = Math.min((w - 2 * m) / Math.max(b.w, 1), (h - 2 * m) / Math.max(b.h, 1));
  const ox = (w - b.w * esc) / 2 - b.minX * esc;
  const oy = (h + b.h * esc) / 2 + b.minY * esc;
  const X = (x) => ox + x * esc;
  const Y = (y) => oy - y * esc;

  const trazar = (path) => {
    let primero = true;
    for (const s of path.segs) {
      if (s.t === 'L') {
        if (primero) {
          c.moveTo(X(s.x1), Y(s.y1));
          primero = false;
        }
        c.lineTo(X(s.x2), Y(s.y2));
      } else {
        const sweep = arcSweep(s);
        c.arc(X(s.cx), Y(s.cy), s.r * esc, -s.a1, -(s.a1 + sweep), sweep > 0);
        primero = false;
      }
    }
    c.closePath();
  };

  c.beginPath();
  trazar(shape.outer);
  for (const hh of shape.holes || []) trazar(hh);
  c.fillStyle = '#e8eef5';
  c.fill('evenodd');

  c.lineWidth = Math.max(1, esc * 0.9);
  c.strokeStyle = '#12161c';
  c.beginPath();
  trazar(shape.outer);
  c.stroke();

  c.lineWidth = Math.max(0.8, esc * 0.7);
  c.strokeStyle = '#1b6fc2';
  for (const hh of shape.holes || []) {
    c.beginPath();
    trazar(hh);
    c.stroke();
  }

  const lp = shape.pliegues || opts.pliegues || [];
  if (lp.length) {
    c.strokeStyle = '#e4572e';
    c.lineWidth = 1.2;
    c.setLineDash([6, 4]);
    for (const l of lp) {
      c.beginPath();
      c.moveTo(X(l.x1), Y(l.y1));
      c.lineTo(X(l.x2), Y(l.y2));
      c.stroke();
    }
    c.setLineDash([]);
  }
  return cv.toDataURL('image/jpeg', 0.86);
}
