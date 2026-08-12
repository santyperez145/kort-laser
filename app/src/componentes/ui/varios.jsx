import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as AccordionPrimitive from '@radix-ui/react-accordion';
import * as ProgressPrimitive from '@radix-ui/react-progress';
import * as SeparatorPrimitive from '@radix-ui/react-separator';
import { ChevronDown, X, AlertTriangle, Info, OctagonAlert } from 'lucide-react';
import { cn } from '@/lib/utils';

/* ---------------- Pestañas ---------------- */

export const Pestanias = TabsPrimitive.Root;

export function ListaPestanias({ className, ...props }) {
  return (
    <TabsPrimitive.List
      className={cn('inline-flex items-center gap-0.5 rounded-lg bg-panel-alto p-0.5', className)}
      {...props}
    />
  );
}

export function Pestania({ className, ...props }) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'inline-flex items-center gap-1.5 rounded-[7px] px-3 py-1.5 text-xs font-medium text-suave',
        'transition-all cursor-pointer outline-none',
        'hover:text-tinta',
        'data-[state=active]:bg-panel data-[state=active]:text-tinta data-[state=active]:font-semibold',
        'data-[state=active]:shadow-sm data-[state=active]:ring-1 data-[state=active]:ring-borde',
        '[&_svg]:size-3.5',
        className
      )}
      {...props}
    />
  );
}

export const ContenidoPestania = TabsPrimitive.Content;

/* ---------------- Diálogo ---------------- */

export const Dialogo = DialogPrimitive.Root;
export const DisparadorDialogo = DialogPrimitive.Trigger;

export function ContenidoDialogo({ className, titulo, descripcion, children, ancho = 'max-w-3xl' }) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className={cn(
          'fixed inset-0 z-[250] bg-black/55 backdrop-blur-[3px]',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0'
        )}
      />
      <DialogPrimitive.Content
        className={cn(
          'fixed left-1/2 top-1/2 z-[260] w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2',
          'max-h-[88vh] overflow-hidden flex flex-col',
          'rounded-2xl border border-borde bg-panel shadow-2xl shadow-black/40',
          'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          ancho,
          className
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-borde px-5 py-3.5">
          <div className="min-w-0">
            <DialogPrimitive.Title className="text-base font-semibold text-tinta">
              {titulo}
            </DialogPrimitive.Title>
            {descripcion ? (
              <DialogPrimitive.Description className="mt-0.5 text-xs text-suave leading-relaxed">
                {descripcion}
              </DialogPrimitive.Description>
            ) : (
              <DialogPrimitive.Description className="sr-only">{titulo}</DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close className="rounded-lg p-1.5 text-tenue hover:bg-panel-alto hover:text-tinta transition-colors cursor-pointer">
            <X className="size-4" />
          </DialogPrimitive.Close>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export const CerrarDialogo = DialogPrimitive.Close;

/* ---------------- Acordeón (reemplaza los <details>) ---------------- */

export function Acordeon({ className, ...props }) {
  return <AccordionPrimitive.Root className={cn('w-full', className)} {...props} />;
}

export function SeccionAcordeon({ valor, titulo, extra, children, className }) {
  return (
    <AccordionPrimitive.Item value={valor} className={cn('border-t border-borde first:border-t-0', className)}>
      <AccordionPrimitive.Header>
        <AccordionPrimitive.Trigger
          className={cn(
            'group flex w-full items-center justify-between gap-3 py-3 text-left cursor-pointer',
            'text-[13px] font-semibold text-tinta outline-none hover:text-corte-500 transition-colors'
          )}
        >
          <span className="flex items-center gap-2 min-w-0">{titulo}</span>
          <span className="flex items-center gap-2 shrink-0">
            {extra}
            <ChevronDown className="size-4 text-tenue transition-transform duration-200 group-data-[state=open]:rotate-180" />
          </span>
        </AccordionPrimitive.Trigger>
      </AccordionPrimitive.Header>
      <AccordionPrimitive.Content className="overflow-hidden data-[state=open]:animate-accordion-down data-[state=closed]:animate-accordion-up">
        <div className="pb-4">{children}</div>
      </AccordionPrimitive.Content>
    </AccordionPrimitive.Item>
  );
}

/* ---------------- Barra de progreso ---------------- */

export function Barra({ valor = 0, className, tono = 'corte' }) {
  const v = Math.max(0, Math.min(100, valor));
  const relleno = {
    corte: 'bg-corte-500',
    verde: 'bg-chapa-500',
    acero: 'bg-acero-500',
  }[tono];
  return (
    <ProgressPrimitive.Root
      value={v}
      className={cn('relative h-1.5 w-full overflow-hidden rounded-full bg-panel-alto border border-borde', className)}
    >
      <ProgressPrimitive.Indicator
        className={cn('h-full rounded-full transition-all duration-500 ease-out', relleno)}
        style={{ width: `${v}%` }}
      />
    </ProgressPrimitive.Root>
  );
}

export function Separador({ className, ...props }) {
  return <SeparatorPrimitive.Root className={cn('bg-borde h-px w-full', className)} {...props} />;
}

/* ---------------- Avisos de fabricabilidad ---------------- */

const ICONO_AVISO = { error: OctagonAlert, aviso: AlertTriangle, info: Info };

const TONO_AVISO = {
  error: 'border-peligro-500/35 bg-peligro-500/10 text-peligro-500 dark:text-peligro-400',
  aviso: 'border-alerta-500/35 bg-alerta-500/10 text-alerta-500 dark:text-alerta-400',
  info: 'border-acero-500/35 bg-acero-500/10 text-acero-700 dark:text-acero-300',
};

/**
 * Un aviso de fabricabilidad no es decoración: dice que la pieza no se puede
 * hacer, o que se puede hacer mejor. Por eso el error lleva franja de máquina.
 */
export function Aviso({ nivel = 'info', children, className }) {
  const Icono = ICONO_AVISO[nivel] || Info;
  return (
    <div
      className={cn(
        'relative flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-[12.5px] leading-relaxed',
        TONO_AVISO[nivel] || TONO_AVISO.info,
        nivel === 'error' && 'franja-alerta',
        className
      )}
    >
      <Icono className="size-4 shrink-0 mt-px" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
