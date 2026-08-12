/**
 * Visor de nesting — cómo quedan las piezas sobre la chapa.
 *
 * Lo que se mira acá no es el dibujo sino el retazo: la línea verde marca
 * hasta dónde llegó la última fila, y todo lo que queda por encima es chapa
 * que se puede guardar entera. Cuando ese retazo es grande conviene ofrecerle
 * más piezas al cliente — casi no suben el costo de material.
 *
 * Cuando la chapa es compartida —varios ítems del mismo material, espesor y
 * gas van juntos— el ítem que se está mirando va en naranja y los demás en
 * gris. Sin esa distinción el layout se lee como una sola pieza repetida y no
 * se entiende de dónde sale el número de chapas.
 */

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Stage, Layer, Rect, Line, Text } from 'react-konva';
import { usarTema } from '@/lib/estado';

const MARGEN = 26;

/**
 * Naranja el ítem que se está mirando, gris el resto. Si la chapa no es
 * compartida, `idResaltado` viene vacío y todo va en naranja como siempre.
 */
function colorDe(idPieza, idResaltado) {
  if (!idResaltado || idPieza === idResaltado) {
    return { relleno: 'rgba(228,87,46,.34)', borde: '#e4572e' };
  }
  return { relleno: 'rgba(120,140,165,.22)', borde: '#7a8ea5' };
}

export function VisorNesting({ nesting, alto = 400, indiceChapa = 0, idResaltado = null }) {
  const oscuro = usarTema((s) => s.oscuro);
  const caja = useRef(null);
  const [ancho, setAncho] = useState(600);

  // Medición inicial síncrona: el ResizeObserver sólo entrega notificaciones
  // si la página está pintando frames, y con la pestaña en segundo plano no
  // llega ninguna. Ver la nota más larga en Visor2D.
  useLayoutEffect(() => {
    const el = caja.current;
    if (!el) return;
    const medir = () => setAncho(el.clientWidth || 600);
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const col = oscuro
    ? { lienzo: '#0f141b', chapa: '#1a212b', borde: '#3d4a5a', texto: '#8a97a5' }
    : { lienzo: '#f7f9fb', chapa: '#ffffff', borde: '#9aa8b8', texto: '#5b6672' };

  const layout = nesting?.layout?.[indiceChapa];

  const vista = useMemo(() => {
    if (!layout) return null;
    const esc = Math.min((ancho - 2 * MARGEN) / layout.w, (alto - 2 * MARGEN) / layout.h);
    return {
      esc,
      ox: (ancho - layout.w * esc) / 2,
      oy: (alto - layout.h * esc) / 2,
    };
  }, [layout, ancho, alto]);

  const { esc, ox, oy } = vista || { esc: 1, ox: 0, oy: 0 };
  // El nesting trabaja con Y hacia arriba desde el borde inferior de la chapa.
  const X = (x) => ox + x * esc;
  const Y = (y) => oy + (layout ? layout.h - y : 0) * esc;

  const yRetazo = layout?.alturaOcupada && layout.alturaOcupada < layout.h - 40
    ? oy + (layout.h - layout.alturaOcupada) * esc
    : null;

  /* El contenedor con la referencia se renderiza SIEMPRE. Si el estado vacío
     devolviera otro `div`, al aparecer el nesting React montaría un elemento
     distinto y el ResizeObserver quedaría observando uno ya desmontado: el
     visor se quedaría clavado en el ancho por defecto. */
  return (
    <div
      ref={caja}
      className="rounded-xl overflow-hidden"
      style={{ height: alto, background: col.lienzo }}
    >
      {!layout ? (
        <div className="flex h-full items-center justify-center px-6 text-center text-[13px] text-tenue">
          {nesting?.error || 'Sin nesting disponible'}
        </div>
      ) : (
      <Stage width={ancho} height={alto}>
        <Layer listening={false}>
          <Rect x={0} y={0} width={ancho} height={alto} fill={col.lienzo} />

          {/* La chapa */}
          <Rect
            x={ox} y={oy}
            width={layout.w * esc} height={layout.h * esc}
            fill={col.chapa} stroke={col.borde} strokeWidth={1.5}
            cornerRadius={2}
          />

          {/* Las piezas anidadas */}
          {layout.piezas.map((p, i) => {
            const c = colorDe(p.id, idResaltado);
            if (p.poly && p.poly.length > 2) {
              // Anidado de forma real: se dibuja el contorno tal cual quedó
              const pts = p.poly.flatMap(([x, y]) => [X(x), Y(y)]);
              return (
                <Line
                  key={i} points={pts} closed
                  fill={c.relleno} stroke={c.borde} strokeWidth={1}
                />
              );
            }
            const rot90 = p.rot === 90 || p.rot === 270 || p.rot === true;
            const w = (rot90 ? p.h : p.w) * esc;
            const h = (rot90 ? p.w : p.h) * esc;
            return (
              <Rect
                key={i}
                x={X(p.x)} y={oy + (layout.h - p.y - (rot90 ? p.w : p.h)) * esc}
                width={w} height={h}
                fill={c.relleno} stroke={c.borde} strokeWidth={1}
              />
            );
          })}

          {/* Línea del retazo aprovechable */}
          {yRetazo != null && (
            <>
              <Line
                points={[ox, yRetazo, ox + layout.w * esc, yRetazo]}
                stroke="#1f7a4d" strokeWidth={1.4} dash={[6, 4]}
              />
              <Text
                x={ox + 4} y={yRetazo - 15}
                text={`retazo útil ${Math.round(layout.h - layout.alturaOcupada)} mm`}
                fontSize={10} fontStyle="600" fontFamily="Segoe UI, sans-serif" fill="#1f7a4d"
              />
            </>
          )}

          <Text
            x={ox} y={oy - 17}
            text={`Chapa ${layout.w} × ${layout.h} mm`}
            fontSize={11} fontFamily="Segoe UI, sans-serif" fill={col.texto}
          />
        </Layer>
      </Stage>
      )}
    </div>
  );
}
