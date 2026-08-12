import * as LabelPrimitive from '@radix-ui/react-label';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

const baseControl =
  'w-full rounded-lg border border-borde bg-panel px-3 text-[13px] text-tinta ' +
  'transition-colors placeholder:text-tenue outline-none ' +
  'hover:border-borde-fuerte ' +
  'focus:border-corte-500 focus:ring-2 focus:ring-corte-500/25 ' +
  'disabled:opacity-50 disabled:cursor-not-allowed';

export function Etiqueta({ className, ...props }) {
  return (
    <LabelPrimitive.Root
      className={cn(
        'block text-[11px] font-semibold uppercase tracking-[0.4px] text-suave mb-1.5',
        className
      )}
      {...props}
    />
  );
}

export function Entrada({ className, unidad, ...props }) {
  const input = (
    <input
      className={cn(baseControl, 'h-9 tabular', unidad && 'pr-10', className)}
      {...props}
    />
  );
  if (!unidad) return input;
  return (
    <div className="relative">
      {input}
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-tenue">
        {unidad}
      </span>
    </div>
  );
}

export function AreaTexto({ className, ...props }) {
  return <textarea className={cn(baseControl, 'py-2 min-h-[68px] resize-y leading-relaxed', className)} {...props} />;
}

/** Campo con etiqueta arriba. Es el bloque que se repite en todo el cotizador. */
export function Campo({ etiqueta, ayuda, className, children }) {
  return (
    <div className={cn('min-w-0', className)}>
      {etiqueta ? <Etiqueta>{etiqueta}</Etiqueta> : null}
      {children}
      {ayuda ? <p className="mt-1 text-[11px] text-tenue leading-snug">{ayuda}</p> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Selector (Radix)                                                    */
/*                                                                     */
/* Se usa el de Radix y no un <select> nativo porque las opciones de    */
/* material y de gas llevan una segunda línea con la calidad de canto,  */
/* y el nativo no deja pintar nada adentro de una <option>.             */
/* ------------------------------------------------------------------ */

export function Selector({ valor, alCambiar, placeholder, children, className, disabled }) {
  return (
    <SelectPrimitive.Root value={valor} onValueChange={alCambiar} disabled={disabled}>
      <SelectPrimitive.Trigger
        className={cn(
          baseControl,
          'h-9 flex items-center justify-between gap-2 text-left data-[placeholder]:text-tenue',
          className
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon>
          <ChevronDown className="size-4 text-tenue shrink-0" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>

      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={4}
          className={cn(
            'z-[300] max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-hidden',
            'rounded-xl border border-borde bg-panel shadow-xl shadow-black/20',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95'
          )}
        >
          <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

export function Opcion({ valor, children, detalle, className }) {
  return (
    <SelectPrimitive.Item
      value={valor}
      className={cn(
        'relative flex cursor-pointer select-none items-center gap-2 rounded-lg py-1.5 pl-2.5 pr-8 text-[13px]',
        'outline-none data-[highlighted]:bg-corte-500/12 data-[highlighted]:text-corte-600',
        'dark:data-[highlighted]:text-corte-300',
        className
      )}
    >
      <div className="min-w-0 flex-1">
        <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
        {detalle ? <div className="text-[11px] text-tenue truncate">{detalle}</div> : null}
      </div>
      <SelectPrimitive.ItemIndicator className="absolute right-2.5">
        <Check className="size-3.5 text-corte-500" />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}
