/**
 * Visor 2D — el plano de la pieza sobre Konva.
 *
 * Muestra lo que va a hacer la máquina, no un dibujo bonito: contorno de
 * corte en negro, contornos interiores en azul, líneas de plegado en naranja
 * discontinuo (que NO se cortan), los puntos de perforación y, opcionalmente,
 * el recorrido en vacío con el orden real —agujeros primero, contorno al
 * final—. Ese orden importa: al revés, la pieza se suelta antes de terminar.
 *
 * La geometría se aplana con `flattenPath` a 0,05 mm en vez de dibujar los
 * arcos a mano. Es la misma tolerancia que usa el simulador de corte, así que
 * lo que se ve y lo que se cotiza salen del mismo polígono.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Stage, Layer, Rect, Line, Circle, Text, Shape, Group } from 'react-konva';
import { flattenPath, shapeBBox, partesDe } from '@core/geometry.js';
import { recorridoRapido } from '@core/cutting.js';
import { usarTema } from '@/lib/estado';
import { num } from '@/lib/formato';

const COLORES = {
  claro: {
    lienzo: '#f7f9fb', grilla: '#e3e9ef', grillaFuerte: '#cfd8e2',
    corte: '#12161c', interior: '#1b6fc2', plegado: '#e4572e',
    rapido: '#b6c1cd', pierce: '#e4572e', cota: '#5b6672',
    relleno: 'rgba(27,58,92,.09)',
  },
  oscuro: {
    lienzo: '#0f141b', grilla: '#232c38', grillaFuerte: '#2e3a49',
    corte: '#e8edf3', interior: '#59a5e8', plegado: '#ff7a52',
    rapido: '#3d4a5a', pierce: '#ff7a52', cota: '#8a97a5',
    relleno: 'rgba(90,140,200,.16)',
  },
};

const MARGEN = 46;

/** Primer punto de un contorno: ahí es donde la máquina perfora. */
function inicio(path) {
  const s = path.segs[0];
  return s.t === 'L'
    ? [s.x1, s.y1]
    : [s.cx + s.r * Math.cos(s.a1), s.cy + s.r * Math.sin(s.a1)];
}

const planar = (pts) => pts.flat();

export function Visor2D({ shape, alto = 400, opciones = {}, chapa = null }) {
  const oscuro = usarTema((s) => s.oscuro);
  const col = oscuro ? COLORES.oscuro : COLORES.claro;

  const caja = useRef(null);
  const [ancho, setAncho] = useState(600);
  const [vista, setVista] = useState({ esc: 1, ox: 0, oy: 0 });
  const arrastre = useRef(null);

  const { grilla = true, recorrido = false, cotas = true, piercings = true, plegado = true } = opciones;

  /* ---------------- Medida del contenedor ----------------
     La primera medición va en un efecto de layout y no en el ResizeObserver.
     El observer sólo entrega notificaciones cuando la página está pintando
     frames: con la pestaña en segundo plano nunca llega la primera, y el
     visor se quedaba clavado en el ancho por defecto. `clientWidth` en
     useLayoutEffect se lee siempre, haya frame o no. */
  useLayoutEffect(() => {
    const el = caja.current;
    if (!el) return;
    const medir = () => setAncho(el.clientWidth || 600);
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ---------------- Geometría aplanada ---------------- */
  const geo = useMemo(() => {
    if (!shape?.outer) return null;
    // Una pieza puede tener varias partes disjuntas (un cartel importado de un
    // DXF, por ejemplo): se dibujan todas, no sólo la más grande.
    const partes = partesDe(shape).map((p) => ({
      outer: flattenPath(p.outer, 0.05),
      holes: (p.holes || []).map((h) => flattenPath(h, 0.05)),
    }));
    return {
      partes,
      bbox: shapeBBox(shape),
      pliegues: shape.pliegues || [],
      perforaciones: partesDe(shape).flatMap((p) => [inicio(p.outer), ...(p.holes || []).map(inicio)]),
    };
  }, [shape]);

  const salto = useMemo(() => {
    if (!shape?.outer || !recorrido) return [];
    try {
      const { orden } = recorridoRapido(shape);
      const puntos = [[0, 0], ...orden.map(inicio)];
      return puntos.slice(0, -1).map((p, i) => [p, puntos[i + 1]]);
    } catch {
      // El recorrido es una ayuda visual: si falla, el plano se ve igual.
      return [];
    }
  }, [shape, recorrido]);

  /* ---------------- Encuadre ---------------- */
  const encuadrar = useCallback(() => {
    if (!geo) return;
    const b = geo.bbox;
    const esc = Math.min(
      (ancho - 2 * MARGEN) / Math.max(b.w, 1),
      (alto - 2 * MARGEN) / Math.max(b.h, 1)
    );
    setVista({
      esc,
      ox: (ancho - b.w * esc) / 2 - b.minX * esc,
      oy: (alto + b.h * esc) / 2 + b.minY * esc,
    });
  }, [geo, ancho, alto]);

  useEffect(() => {
    encuadrar();
  }, [encuadrar]);

  /* ---------------- Pan y zoom ---------------- */
  const alRodar = (e) => {
    e.evt.preventDefault();
    const stage = e.target.getStage();
    const p = stage.getPointerPosition();
    if (!p) return;
    setVista((v) => {
      const f = e.evt.deltaY < 0 ? 1.12 : 1 / 1.12;
      const esc = Math.max(0.02, Math.min(80, v.esc * f));
      return {
        esc,
        ox: p.x - ((p.x - v.ox) * esc) / v.esc,
        oy: p.y - ((p.y - v.oy) * esc) / v.esc,
      };
    });
  };

  const alBajar = (e) => {
    const p = e.target.getStage().getPointerPosition();
    arrastre.current = p ? { x: p.x, y: p.y } : null;
  };

  const alMover = (e) => {
    if (!arrastre.current) return;
    const p = e.target.getStage().getPointerPosition();
    if (!p) return;
    const dx = p.x - arrastre.current.x;
    const dy = p.y - arrastre.current.y;
    arrastre.current = { x: p.x, y: p.y };
    setVista((v) => ({ ...v, ox: v.ox + dx, oy: v.oy + dy }));
  };

  const soltar = () => {
    arrastre.current = null;
  };

  /* ---------------- Derivados de pantalla ---------------- */
  const { esc, ox, oy } = vista;
  const X = (x) => ox + x * esc;
  const Y = (y) => oy - y * esc;

  const lineasGrilla = useMemo(() => {
    if (!grilla) return [];
    const pasos = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
    const paso = pasos.find((p) => p * esc >= 60) || 1000;
    const out = [];
    for (const [p, color] of [[paso, col.grilla], [paso * 5, col.grillaFuerte]]) {
      const x0 = Math.floor(-ox / esc / p) * p;
      for (let x = x0; ox + x * esc < ancho; x += p) {
        const px = Math.round(ox + x * esc) + 0.5;
        out.push({ pts: [px, 0, px, alto], color });
      }
      const y0 = Math.floor((oy - alto) / esc / p) * p;
      for (let y = y0; oy - y * esc > 0; y += p) {
        const py = Math.round(oy - y * esc) + 0.5;
        out.push({ pts: [0, py, ancho, py], color });
      }
    }
    return out;
  }, [grilla, esc, ox, oy, ancho, alto, col]);

  const b = geo?.bbox;

  /* El contenedor con la referencia se renderiza SIEMPRE, tenga geometría o
     no. Si el estado vacío devolviera otro `div`, al aparecer la pieza React
     montaría un elemento distinto y el ResizeObserver quedaría observando uno
     ya desmontado: el visor se quedaba clavado en los 600 px por defecto. */
  return (
    <div ref={caja} className="rounded-xl overflow-hidden" style={{ height: alto, background: col.lienzo }}>
      {!geo ? (
        <div className="flex h-full items-center justify-center text-[13px] text-tenue">
          Sin geometría
        </div>
      ) : (
      <Stage
        width={ancho}
        height={alto}
        onWheel={alRodar}
        onMouseDown={alBajar}
        onMouseMove={alMover}
        onMouseUp={soltar}
        onMouseLeave={soltar}
        style={{ cursor: arrastre.current ? 'grabbing' : 'grab' }}
      >
        {/* --- Fondo y grilla, en coordenadas de pantalla --- */}
        <Layer listening={false}>
          <Rect x={0} y={0} width={ancho} height={alto} fill={col.lienzo} />
          {lineasGrilla.map((l, i) => (
            <Line key={i} points={l.pts} stroke={l.color} strokeWidth={1} />
          ))}
          {chapa ? (
            <Rect
              x={X(0)} y={Y(chapa.h)}
              width={chapa.w * esc} height={chapa.h * esc}
              stroke={col.grillaFuerte} strokeWidth={1.4} dash={[7, 5]}
            />
          ) : null}
        </Layer>

        {/* --- La pieza, en milímetros. El grupo lleva la transformación,
              así los espesores de línea quedan en píxeles de pantalla. --- */}
        <Layer listening={false}>
          <Group x={ox} y={oy} scaleX={esc} scaleY={-esc}>
            {/* Relleno con regla par-impar: los agujeros quedan calados */}
            <Shape
              sceneFunc={(ctx) => {
                const trazar = (pts) => {
                  if (!pts.length) return;
                  ctx.moveTo(pts[0][0], pts[0][1]);
                  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
                  ctx.closePath();
                };
                ctx.beginPath();
                for (const p of geo.partes) {
                  trazar(p.outer);
                  p.holes.forEach(trazar);
                }
                // Konva no expone la regla par-impar: se usa el contexto crudo,
                // que ya tiene aplicada la transformación del grupo.
                const raw = ctx._context;
                raw.fillStyle = col.relleno;
                raw.fill('evenodd');
              }}
            />

            {recorrido &&
              salto.map(([a, z], i) => (
                <Line
                  key={i}
                  points={[a[0], a[1], z[0], z[1]]}
                  stroke={col.rapido} strokeWidth={1} dash={[3, 4]}
                  strokeScaleEnabled={false} dashEnabled
                />
              ))}

            {geo.partes.map((p, i) => (
              <Line
                key={'o' + i}
                points={planar(p.outer)} closed
                stroke={col.corte} strokeWidth={1.7} strokeScaleEnabled={false}
                lineJoin="round"
              />
            ))}

            {geo.partes.flatMap((p, i) =>
              p.holes.map((h, j) => (
                <Line
                  key={`h${i}-${j}`}
                  points={planar(h)} closed
                  stroke={col.interior} strokeWidth={1.3} strokeScaleEnabled={false}
                  lineJoin="round"
                />
              ))
            )}

            {plegado &&
              geo.pliegues.map((l, i) => (
                <Line
                  key={i}
                  points={[l.x1, l.y1, l.x2, l.y2]}
                  stroke={col.plegado} strokeWidth={1.5} dash={[9, 5]}
                  strokeScaleEnabled={false}
                />
              ))}
          </Group>
        </Layer>

        {/* --- Anotaciones: van en pantalla o el texto saldría espejado --- */}
        <Layer listening={false}>
          {piercings &&
            geo.perforaciones.map(([x, y], i) => (
              <Circle key={i} x={X(x)} y={Y(y)} radius={2.6} fill={col.pierce} />
            ))}

          {plegado && esc > 0.28 &&
            geo.pliegues.filter((l) => l.label).map((l, i) => {
              const vertical = Math.abs(l.x2 - l.x1) < Math.abs(l.y2 - l.y1);
              return (
                <Text
                  key={i}
                  x={X((l.x1 + l.x2) / 2)} y={Y((l.y1 + l.y2) / 2) - 6}
                  text={l.label} fontSize={10} fontStyle="600"
                  fontFamily="Segoe UI, sans-serif" fill={col.plegado}
                  rotation={vertical ? -90 : 0} offsetX={0} align="center"
                />
              );
            })}

          {cotas && (
            <>
              <Line
                points={[X(b.minX), Y(b.minY) + 18, X(b.maxX), Y(b.minY) + 18]}
                stroke={col.cota} strokeWidth={1}
              />
              <Line points={[X(b.minX), Y(b.minY) + 14, X(b.minX), Y(b.minY) + 22]} stroke={col.cota} strokeWidth={1} />
              <Line points={[X(b.maxX), Y(b.minY) + 14, X(b.maxX), Y(b.minY) + 22]} stroke={col.cota} strokeWidth={1} />
              <Text
                x={X((b.minX + b.maxX) / 2) - 60} y={Y(b.minY) + 22}
                width={120} align="center"
                text={`${num(b.w, 1)} mm`} fontSize={11} fontStyle="600"
                fontFamily="Segoe UI, sans-serif" fill={col.cota}
              />

              <Line
                points={[X(b.minX) - 18, Y(b.minY), X(b.minX) - 18, Y(b.maxY)]}
                stroke={col.cota} strokeWidth={1}
              />
              <Line points={[X(b.minX) - 22, Y(b.minY), X(b.minX) - 14, Y(b.minY)]} stroke={col.cota} strokeWidth={1} />
              <Line points={[X(b.minX) - 22, Y(b.maxY), X(b.minX) - 14, Y(b.maxY)]} stroke={col.cota} strokeWidth={1} />
              <Text
                x={X(b.minX) - 26} y={Y((b.minY + b.maxY) / 2) + 60}
                width={120} align="center" rotation={-90}
                text={`${num(b.h, 1)} mm`} fontSize={11} fontStyle="600"
                fontFamily="Segoe UI, sans-serif" fill={col.cota}
              />
            </>
          )}
        </Layer>
      </Stage>
      )}
    </div>
  );
}

export { MARGEN };
