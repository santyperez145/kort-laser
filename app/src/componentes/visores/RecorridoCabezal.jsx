/**
 * KORT · Dónde está el cabezal, en vivo
 *
 * Dibuja el recorrido real que informó la pasarela sobre el área de trabajo de
 * la máquina. Es de SÓLO LECTURA: esta pantalla nunca manda un movimiento al
 * CNC, igual que el resto del tablero.
 *
 * Tres decisiones que hacen la diferencia entre un gráfico y una herramienta:
 *
 * 1. **El trazo de corte y el de posicionamiento se dibujan distinto.** Uno
 *    consume chapa y el otro no. Verlos iguales esconde justamente lo que se
 *    mira acá: cuánto del tiempo de máquina se va en aire.
 *
 * 2. **Un hueco en los datos es un hueco en el trazo.** `recorridoCabezal` ya
 *    parte la serie cuando la pasarela estuvo callada; acá cada tramo se
 *    dibuja como un `path` independiente. Unirlos mostraría una línea recta
 *    que la máquina nunca hizo, y en una pantalla de taller eso se cree.
 *
 * 3. **Una posición fuera del área de trabajo se ve, no se recorta.** Es el
 *    síntoma de un adaptador leyendo el registro equivocado, y taparlo con un
 *    clamp convertiría un error de instalación en un cabezal quieto contra el
 *    borde. El área nominal se dibuja como marco y lo que se sale, se sale.
 *
 * Va en SVG y no en canvas: son unos pocos miles de puntos, se ve nítido en
 * cualquier pantalla y hereda los colores del tema sin trabajo extra.
 */

import { useMemo } from 'react';

const MARGEN = 10;

export function RecorridoCabezal({
  tramos = [],
  area = { w: 3000, h: 1500 },
  ultima = null,
  alto = 260,
}) {
  const w = Math.max(1, area?.w || 3000);
  const h = Math.max(1, area?.h || 1500);

  const { paths, fuera, puntos } = useMemo(() => {
    const paths = [];
    let fuera = 0;
    let puntos = 0;

    for (const tramo of tramos || []) {
      /* Se parte además por cambio de estado del haz: un `path` con corte y
         rápido mezclados no se puede pintar de dos colores. */
      let actual = null;
      for (const p of tramo) {
        puntos++;
        if (p.x < 0 || p.y < 0 || p.x > w || p.y > h) fuera++;
        if (!actual || actual.emitiendo !== p.emitiendo) {
          // El primer punto del tramo nuevo repite el último del anterior,
          // o el trazo quedaría con cortes de un píxel entre segmentos.
          const previo = actual?.d.at(-1);
          actual = { emitiendo: p.emitiendo, d: previo ? [previo] : [] };
          paths.push(actual);
        }
        actual.d.push(p);
      }
    }
    return { paths: paths.filter((p) => p.d.length > 1), fuera, puntos };
  }, [tramos, w, h]);

  // Y hacia arriba: en la máquina el origen está abajo a la izquierda y en SVG
  // arriba. Sin esto el dibujo sale espejado y nadie lo nota hasta que compara
  // con la chapa.
  const d = (pts) =>
    pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${(h - p.y).toFixed(1)}`).join(' ');

  const hayDatos = puntos > 0;

  return (
    <div>
      <svg
        viewBox={`${-MARGEN} ${-MARGEN} ${w + MARGEN * 2} ${h + MARGEN * 2}`}
        style={{ width: '100%', height: alto }}
        role="img"
        aria-label="Recorrido del cabezal sobre el área de trabajo"
      >
        {/* El área nominal de la máquina. Lo que se salga de este marco es un
            dato para mirar, no para esconder. */}
        <rect
          x={0} y={0} width={w} height={h}
          className="fill-lienzo stroke-borde-fuerte"
          strokeWidth={Math.max(2, w / 600)}
        />

        {paths.map((p, i) => (
          <path
            key={i}
            d={d(p.d)}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            /* Corte en naranja —el mismo que significa "esto lo corta la
               máquina" en todos los visores— y posicionamiento en un gris
               fino y punteado, porque es movimiento que no produce nada. */
            stroke={p.emitiendo ? '#e4572e' : 'currentColor'}
            className={p.emitiendo ? '' : 'text-tenue'}
            strokeWidth={p.emitiendo ? Math.max(3, w / 400) : Math.max(1.5, w / 900)}
            strokeDasharray={p.emitiendo ? undefined : `${w / 150} ${w / 150}`}
            opacity={p.emitiendo ? 0.95 : 0.5}
          />
        ))}

        {/* Dónde está ahora. Se dibuja al final para que quede sobre el trazo. */}
        {ultima?.x != null && ultima?.y != null ? (
          <g>
            <circle
              cx={ultima.x} cy={h - ultima.y} r={Math.max(10, w / 130)}
              fill="none" stroke="#e4572e" strokeWidth={Math.max(2, w / 700)} opacity={0.7}
            />
            <circle cx={ultima.x} cy={h - ultima.y} r={Math.max(4, w / 320)} fill="#e4572e" />
          </g>
        ) : null}
      </svg>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10.5px] text-suave">
        {hayDatos ? (
          <>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-0.5 w-4 rounded" style={{ background: '#e4572e' }} />
              Cortando
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-px w-4 border-t border-dashed border-tenue" />
              Posicionamiento
            </span>
            <span className="tabular text-tenue">
              {puntos.toLocaleString('es-AR')} puntos · área {w}×{h} mm
            </span>
          </>
        ) : (
          <span className="text-tenue">
            La pasarela todavía no informó ninguna posición. El recorrido aparece cuando el
            adaptador manda <code className="font-mono">posicion</code> en la muestra.
          </span>
        )}

        {fuera > 0 ? (
          <span className="font-semibold text-alerta-500">
            {fuera} punto{fuera === 1 ? '' : 's'} fuera del área declarada — revisá qué registro
            está leyendo el adaptador, o el área de trabajo cargada en Máquinas.
          </span>
        ) : null}
      </div>
    </div>
  );
}
