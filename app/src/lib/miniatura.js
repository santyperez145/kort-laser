/**
 * Miniatura de la pieza como dataURL JPEG.
 *
 * Sale siempre sobre fondo blanco y con los colores del plano —negro el
 * contorno, azul los interiores, naranja discontinuo el plegado— porque el
 * mismo dibujo se imprime en el presupuesto y en la orden de trabajo. No
 * sigue el tema de la pantalla a propósito: una miniatura en modo oscuro
 * dentro del PDF sale como un rectángulo negro.
 *
 * Gemela de la que hay en `web/js/viewer2d.js`, que muere cuando se retire la
 * interfaz anterior del cotizador.
 */

import { arcSweep, partesDe, shapeBBox } from '@core/geometry.js';

export function miniatura(shape, w = 320, h = 260, opts = {}) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const c = cv.getContext('2d');
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, w, h);
  if (!shape) return cv.toDataURL('image/jpeg', 0.86);

  const partes = partesDe(shape);
  const b = shapeBBox(shape);
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

  // Relleno de todas las partes de una: la regla par-impar deja los agujeros
  // calados sin importar cuántos contornos exteriores haya.
  c.beginPath();
  for (const p of partes) {
    trazar(p.outer);
    for (const hh of p.holes || []) trazar(hh);
  }
  c.fillStyle = '#e8eef5';
  c.fill('evenodd');

  c.lineWidth = Math.max(1, esc * 0.9);
  c.strokeStyle = '#12161c';
  for (const p of partes) {
    c.beginPath();
    trazar(p.outer);
    c.stroke();
  }

  c.lineWidth = Math.max(0.8, esc * 0.7);
  c.strokeStyle = '#1b6fc2';
  for (const p of partes) {
    for (const hh of p.holes || []) {
      c.beginPath();
      trazar(hh);
      c.stroke();
    }
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
