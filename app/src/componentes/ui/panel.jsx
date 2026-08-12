import { cn } from '@/lib/utils';

export function Panel({ className, children, ...props }) {
  return (
    <section className={cn('panel-kort overflow-hidden', className)} {...props}>
      {children}
    </section>
  );
}

export function PanelCab({ className, children, acciones, ...props }) {
  return (
    <header
      className={cn(
        'flex items-center justify-between gap-3 border-b border-borde px-4 py-2.5 min-h-[46px]',
        className
      )}
      {...props}
    >
      <div className="flex items-center gap-2.5 min-w-0">{children}</div>
      {acciones ? <div className="flex items-center gap-2 shrink-0">{acciones}</div> : null}
    </header>
  );
}

export function PanelTitulo({ className, children, ...props }) {
  return (
    <h3
      className={cn('text-[11px] font-bold uppercase tracking-[0.6px] text-suave truncate', className)}
      {...props}
    >
      {children}
    </h3>
  );
}

export function PanelCuerpo({ className, sinPad = false, children, ...props }) {
  return (
    <div className={cn(sinPad ? '' : 'p-4', className)} {...props}>
      {children}
    </div>
  );
}

/** Estado vacío. Siempre dice qué hacer, no sólo que no hay nada. */
export function Vacio({ icono, titulo, detalle, className, children }) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-12 text-center', className)}>
      {icono ? <div className="mb-3 text-tenue/45 [&_svg]:size-9">{icono}</div> : null}
      <p className="text-sm text-suave">{titulo}</p>
      {detalle ? <p className="mt-1 text-xs text-tenue max-w-xs leading-relaxed">{detalle}</p> : null}
      {children ? <div className="mt-4">{children}</div> : null}
    </div>
  );
}
