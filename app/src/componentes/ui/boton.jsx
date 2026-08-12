import { Slot } from '@radix-ui/react-slot';
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const variantes = cva(
  'inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap ' +
    'transition-all duration-150 outline-none cursor-pointer select-none ' +
    'focus-visible:ring-2 focus-visible:ring-corte-500/60 focus-visible:ring-offset-1 focus-visible:ring-offset-panel ' +
    'disabled:opacity-45 disabled:pointer-events-none active:translate-y-px ' +
    '[&_svg]:shrink-0 [&_svg]:size-4',
  {
    variants: {
      tono: {
        neutro: 'bg-panel border border-borde text-tinta hover:border-borde-fuerte hover:bg-panel-alto',
        // El naranja es la acción que hace avanzar el presupuesto. Uno por pantalla.
        corte: 'bg-corte-500 text-white border border-corte-500 hover:bg-corte-600 hover:border-corte-600 shadow-sm shadow-corte-500/25',
        acero: 'bg-acero-900 text-white border border-acero-900 hover:bg-acero-800 dark:bg-acero-700 dark:hover:bg-acero-600',
        verde: 'bg-chapa-500 text-white border border-chapa-500 hover:bg-chapa-600',
        fantasma: 'text-suave hover:bg-panel-alto hover:text-tinta',
        peligro: 'border border-borde text-peligro-500 hover:bg-peligro-500/10 hover:border-peligro-500',
      },
      tam: {
        sm: 'h-7 px-2.5 text-xs [&_svg]:size-3.5',
        md: 'h-9 px-3.5 text-[13px]',
        lg: 'h-11 px-5 text-sm',
        icono: 'h-9 w-9 p-0',
        iconoSm: 'h-7 w-7 p-0 [&_svg]:size-3.5',
      },
      ancho: { completo: 'w-full' },
    },
    defaultVariants: { tono: 'neutro', tam: 'md' },
  }
);

export function Boton({ className, tono, tam, ancho, comoHijo = false, ...props }) {
  const Comp = comoHijo ? Slot : 'button';
  return <Comp className={cn(variantes({ tono, tam, ancho }), className)} {...props} />;
}

export { variantes as variantesBoton };
