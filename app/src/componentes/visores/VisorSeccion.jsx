/**
 * Visor de la sección transversal de un perfil plegado.
 *
 * Dibuja el corte de la pieza como se vería de punta, con el espesor y los
 * radios reales. Cada tramo es clicable: es la forma natural de editar un
 * perfil, señalando el tramo que uno quiere cambiar en vez de buscarlo en una
 * lista de números.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { usarTema } from '@/lib/estado';

const COL = {
  claro: { fondo: '#f7f9fb', chapa: '#8fa3b8', canto: '#5b6672', sel: '#e4572e', cota: '#5b6672', ejeX: '#c3ccd6' },
  oscuro: { fondo: '#1a212b', chapa: '#5d708e', canto: '#8a97a5', sel: '#ff7a52', cota: '#8a97a5', ejeX: '#33404f' },
};

export function VisorSeccion({ perfil, seleccion, onSeleccionar, alto = 300 }) {
  const ref = useRef(null);
  const cont = useRef(null);
  const tema = usarTema((s) => s.tema);
  const [tam, setTam] = useState({ w: 600, h: alto });

  useEffect(() => {
    if (!cont.current) return undefined;
    const ro = new ResizeObserver(() => {
      setTam({ w: cont.current?.clientWidth || 600, h: alto });
    });
    ro.observe(cont.current);
    return () => ro.disconnect();
  }, [alto]);

  /** Contorno cerrado de la sección: la línea media desplazada medio espesor a cada lado. */
  const geometria = useMemo(() => {
    const pts = perfil?.seccion?.pts;
    if (!pts || pts.length < 2) return null;
    const t = perfil.espesor;
    const off = (d) => pts.map((p, i) => {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      let dx = b[0] - a[0];
      let dy = b[1] - a[1];
      const L = Math.hypot(dx, dy) || 1;
      dx /= L;
      dy /= L;
      return [p[0] - dy * d, p[1] + dx * d];
    });
    const arriba = off(t / 2);
    const abajo = off(-t / 2);
    return { contorno: [...arriba, ...abajo.slice().reverse()], media: pts };
  }, [perfil]);

  useEffect(() => {
    const cv = ref.current;
    if (!cv || !geometria) return;
    const c = cv.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    cv.width = tam.w * dpr;
    cv.height = tam.h * dpr;
    cv.style.width = '100%';
    cv.style.height = tam.h + 'px';
    c.setTransform(dpr, 0, 0, dpr, 0, 0);

    const col = tema === 'oscuro' ? COL.oscuro : COL.claro;
    c.fillStyle = col.fondo;
    c.fillRect(0, 0, tam.w, tam.h);

    const b = perfil.seccion.bbox;
    const m = 46;
    const esc = Math.min((tam.w - 2 * m) / Math.max(b.w, 1), (tam.h - 2 * m) / Math.max(b.h, 1));
    const ox = (tam.w - b.w * esc) / 2 - b.minX * esc;
    const oy = (tam.h + b.h * esc) / 2 + b.minY * esc;
    const X = (x) => ox + x * esc;
    const Y = (y) => oy - y * esc;

    // Piso de referencia: ayuda a leer para qué lado va cada pliegue
    c.strokeStyle = col.ejeX;
    c.setLineDash([4, 4]);
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(0, Y(0));
    c.lineTo(tam.w, Y(0));
    c.stroke();
    c.setLineDash([]);

    // El cuerpo de la chapa
    const cont2 = geometria.contorno;
    c.beginPath();
    c.moveTo(X(cont2[0][0]), Y(cont2[0][1]));
    for (let i = 1; i < cont2.length; i++) c.lineTo(X(cont2[i][0]), Y(cont2[i][1]));
    c.closePath();
    c.fillStyle = col.chapa;
    c.globalAlpha = 0.85;
    c.fill();
    c.globalAlpha = 1;
    c.strokeStyle = col.canto;
    c.lineWidth = 1.2;
    c.stroke();

    // Cada tramo recto, resaltando el seleccionado
    c.lineWidth = Math.max(2, perfil.espesor * esc * 0.9);
    c.lineCap = 'round';
    for (const tr of perfil.seccion.tramos) {
      const activo = seleccion === tr.indice - 1;
      c.strokeStyle = activo ? col.sel : 'transparent';
      if (!activo) continue;
      c.beginPath();
      c.moveTo(X(tr.desde[0]), Y(tr.desde[1]));
      c.lineTo(X(tr.hasta[0]), Y(tr.hasta[1]));
      c.stroke();
    }

    // Número de cada tramo y su cota
    c.font = '600 11px "Segoe UI", system-ui, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    perfil.seccion.tramos.forEach((tr, i) => {
      const mx = X((tr.desde[0] + tr.hasta[0]) / 2);
      const my = Y((tr.desde[1] + tr.hasta[1]) / 2);
      const activo = seleccion === i;
      c.fillStyle = activo ? col.sel : col.cota;
      c.beginPath();
      c.arc(mx, my, 9, 0, Math.PI * 2);
      c.fillStyle = activo ? col.sel : col.fondo;
      c.fill();
      c.strokeStyle = activo ? col.sel : col.cota;
      c.lineWidth = 1;
      c.stroke();
      c.fillStyle = activo ? '#fff' : col.cota;
      c.fillText(String(i + 1), mx, my + 0.5);

      // Cota del tramo, corrida hacia afuera
      const dx = tr.hasta[0] - tr.desde[0];
      const dy = tr.hasta[1] - tr.desde[1];
      const L = Math.hypot(dx, dy) || 1;
      const nx = (-dy / L) * 20;
      const ny = (dx / L) * 20;
      c.fillStyle = col.cota;
      c.font = '11px "Segoe UI", system-ui, sans-serif';
      c.fillText(`${perfil.tramos[i]}`, mx + nx, my - ny);
    });

    // Ángulo de cada pliegue
    c.font = '600 10px "Segoe UI", system-ui, sans-serif';
    perfil.pliegues.forEach((p, i) => {
      const tr = perfil.seccion.tramos[i];
      if (!tr) return;
      c.fillStyle = col.sel;
      c.fillText(`${p.grados}°`, X(tr.hasta[0]) + 14, Y(tr.hasta[1]) - 14);
    });
  }, [geometria, perfil, seleccion, tam, tema]);

  /** Clic sobre un tramo: se elige el más cercano al punto. */
  const alHacerClic = (ev) => {
    if (!onSeleccionar || !perfil?.seccion) return;
    const r = ref.current.getBoundingClientRect();
    const px = ev.clientX - r.left;
    const py = ev.clientY - r.top;
    const b = perfil.seccion.bbox;
    const m = 46;
    const esc = Math.min((tam.w - 2 * m) / Math.max(b.w, 1), (tam.h - 2 * m) / Math.max(b.h, 1));
    const ox = (tam.w - b.w * esc) / 2 - b.minX * esc;
    const oy = (tam.h + b.h * esc) / 2 + b.minY * esc;

    let mejor = null;
    perfil.seccion.tramos.forEach((tr, i) => {
      const ax = ox + tr.desde[0] * esc;
      const ay = oy - tr.desde[1] * esc;
      const bx = ox + tr.hasta[0] * esc;
      const by = oy - tr.hasta[1] * esc;
      const vx = bx - ax;
      const vy = by - ay;
      const L2 = vx * vx + vy * vy || 1;
      let s = ((px - ax) * vx + (py - ay) * vy) / L2;
      s = Math.max(0, Math.min(1, s));
      const d = Math.hypot(px - (ax + s * vx), py - (ay + s * vy));
      if (!mejor || d < mejor.d) mejor = { d, i };
    });
    if (mejor && mejor.d < 28) onSeleccionar(mejor.i);
  };

  return (
    <div ref={cont} className="relative rounded-lg overflow-hidden bg-muted/40">
      <canvas ref={ref} onClick={alHacerClic} className="block w-full cursor-pointer" />
      {!geometria && (
        <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">
          Agregá tramos para ver la sección
        </div>
      )}
      <div className="absolute bottom-2 left-2 rounded bg-black/70 px-2 py-1 text-[11px] text-white">
        Clic en un tramo para editarlo
      </div>
    </div>
  );
}
