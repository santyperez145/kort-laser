import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const variantes = cva(
  'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold whitespace-nowrap border',
  {
    variants: {
      tono: {
        gris: 'bg-panel-alto text-suave border-borde',
        verde: 'bg-chapa-500/12 text-chapa-500 dark:text-chapa-300 border-chapa-500/25',
        naranja: 'bg-corte-500/12 text-corte-600 dark:text-corte-300 border-corte-500/25',
        azul: 'bg-acero-500/12 text-acero-700 dark:text-acero-300 border-acero-500/25',
        rojo: 'bg-peligro-500/12 text-peligro-500 dark:text-peligro-400 border-peligro-500/25',
        amarillo: 'bg-alerta-500/14 text-alerta-500 dark:text-alerta-400 border-alerta-500/25',
      },
    },
    defaultVariants: { tono: 'gris' },
  }
);

export function Insignia({ tono, className, children, ...props }) {
  return (
    <span className={cn(variantes({ tono }), className)} {...props}>
      {children}
    </span>
  );
}

/** Insignia de estado a partir de uno de los mapas de `formato.js`. */
export function InsigniaEstado({ mapa, estado, className }) {
  const e = mapa[estado] || mapa.borrador || mapa.pendiente || { txt: estado || '—', tono: 'gris' };
  return (
    <Insignia tono={e.tono} className={className}>
      {e.txt}
    </Insignia>
  );
}
