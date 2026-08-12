/**
 * Piezas compartidas de los gráficos.
 *
 * Recharts no lee variables CSS: los colores de ejes y grilla hay que
 * pasárselos como valores. Este módulo los deriva del tema activo para que
 * un gráfico no quede con los ejes negros sobre fondo negro al cambiarlo.
 */

import { usarTema } from '@/lib/estado';
import { money } from '@/lib/formato';

/** Paleta categórica. Arranca con los tres colores de marca. */
export const PALETA = [
  '#e4572e', '#1b6fc2', '#1f7a4d', '#b7791f',
  '#8e44ad', '#16a085', '#c0392b', '#4f77a0',
];

export function usarColores() {
  const oscuro = usarTema((s) => s.oscuro);
  return {
    oscuro,
    texto: oscuro ? '#9aa8b8' : '#5b6672',
    tenue: oscuro ? '#6b7a8b' : '#8a97a5',
    grilla: oscuro ? '#2a3543' : '#e3e9ef',
    panel: oscuro ? '#171d26' : '#ffffff',
    borde: oscuro ? '#2a3543' : '#dde3ea',
    tinta: oscuro ? '#e8edf3' : '#12161c',
  };
}

/** Eje de plata: sin el símbolo, que ya está en el título de la tarjeta. */
export function ejeMoneda(v) {
  const a = Math.abs(v);
  if (a >= 1_000_000) return (v / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1) + ' M';
  if (a >= 1_000) return Math.round(v / 1000) + ' k';
  return String(v);
}

export function Globo({ activo, payload, etiqueta, sim = '$', pie }) {
  if (!activo || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-borde bg-panel px-3 py-2 shadow-xl shadow-black/25 text-xs">
      {etiqueta ? <div className="font-semibold text-tinta mb-1.5">{etiqueta}</div> : null}
      <div className="space-y-1">
        {payload.map((p, i) => (
          <div key={i} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-suave">
              <span className="size-2 rounded-full" style={{ background: p.color || p.payload?.fill }} />
              {p.name}
            </span>
            <span className="tabular font-semibold text-tinta">{money(p.value, sim, 0)}</span>
          </div>
        ))}
      </div>
      {pie ? <div className="mt-1.5 border-t border-borde pt-1.5 text-[11px] text-tenue">{pie}</div> : null}
    </div>
  );
}
