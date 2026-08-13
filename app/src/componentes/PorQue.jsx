/**
 * "¿De dónde sale este número?"
 *
 * Muestra la derivación que arma `@core/explicacion.js`: la cuenta con los
 * números puestos, paso a paso, y de dónde salió cada dato.
 *
 * Va plegado por defecto. El precio se lee de un vistazo; la cuenta se abre
 * cuando alguien pregunta — que es cuando hace falta y no antes.
 */

import { useState } from 'react';
import { ChevronRight, HelpCircle } from 'lucide-react';
import { NIVELES } from '@core/explicacion.js';

import { Insignia } from '@/componentes/ui/insignia';
import { Aviso } from '@/componentes/ui/varios';
import { cn } from '@/lib/utils';

/** El semáforo de confianza de docs/PRECIOS.md, en chico. */
export function Confianza({ nivel, className }) {
  const n = NIVELES[nivel];
  if (!n) return null;
  const tono = nivel === 'confirmar' ? 'rojo' : nivel === 'estimado' ? 'amarillo' : 'verde';
  return (
    <Insignia tono={tono} className={cn('gap-1 text-[10px]', className)} title={n.texto}>
      <span aria-hidden>{n.icono}</span>
      {n.texto}
    </Insignia>
  );
}

/** Un paso: el concepto a la izquierda, la cuenta a la derecha. */
function Paso({ paso }) {
  return (
    <li className="border-b border-dashed border-borde py-1.5 last:border-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-suave text-[11.5px]">{paso.concepto}</span>
        <span className="tabular font-mono text-[11.5px] text-right">{paso.cuenta}</span>
      </div>
      {paso.nota ? <p className="mt-1 text-[11px] leading-snug text-suave/80">{paso.nota}</p> : null}
    </li>
  );
}

/**
 * Un bloque plegable de la explicación.
 * @param {Object} bloque el que devuelve `explicarItem()`
 */
export function BloqueExplicacion({ bloque, abiertoInicial = false }) {
  const [abierto, setAbierto] = useState(abiertoInicial);
  if (!bloque) return null;

  return (
    <div className="rounded-md border border-borde">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-2 text-left hover:bg-panel/60"
        aria-expanded={abierto}
      >
        <ChevronRight className={cn('size-3.5 shrink-0 text-suave transition-transform', abierto && 'rotate-90')} />
        <span className="min-w-0 flex-1">
          <span className="block text-[12.5px] font-semibold">{bloque.titulo}</span>
          <span className="block truncate text-[11px] text-suave">{bloque.resumen}</span>
        </span>
        {bloque.importe != null ? (
          <span className="tabular font-mono text-[12px] whitespace-nowrap">
            {bloque.importe.toLocaleString('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 })}
          </span>
        ) : null}
      </button>

      {abierto ? (
        <div className="border-t border-borde px-2.5 pt-2 pb-2.5">
          <ul>
            {bloque.pasos.map((p, i) => (
              <Paso key={i} paso={p} />
            ))}
          </ul>
          {bloque.fuente ? (
            <p className="mt-2.5 flex flex-col gap-1.5 text-[11px] leading-snug text-suave">
              <Confianza nivel={bloque.nivel} className="self-start" />
              {bloque.fuente}
            </p>
          ) : null}
          {(bloque.avisos || []).map((a, i) => (
            <Aviso key={i} nivel="aviso" className="mt-2">
              {a}
            </Aviso>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * La explicación completa de un ítem.
 *
 * `incluirInterno` decide si se ve el margen. En pantalla sí — es la
 * herramienta para decidir el precio. En cualquier cosa que salga hacia el
 * cliente, no.
 */
export function ComoSeCalcula({ explicacion, incluirInterno = true, className }) {
  if (!explicacion || !explicacion.bloques.length) return null;
  const { bloques, cadena, resumen } = explicacion;

  return (
    <div className={cn('space-y-2', className)}>
      {/* Qué pesa. Antes que la cuenta larga, porque es lo primero que hay
          que saber: si el 96 % es material, el precio se pelea con el
          proveedor de chapa, no ajustando el margen. */}
      {resumen?.participacion?.length ? (
        <div className="rounded-md border border-borde bg-panel/40 px-2.5 py-2">
          <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-suave uppercase">Qué pesa en el costo</p>
          <div className="flex h-2 overflow-hidden rounded-full">
            {resumen.participacion.map((p) => (
              <div
                key={p.id}
                className={cn(
                  'h-full',
                  p.id === 'material' && 'bg-acero-500',
                  p.id === 'corte' && 'bg-corte-500',
                  p.id === 'preparacion' && 'bg-alerta-500',
                  p.id === 'gas' && 'bg-chapa-500',
                  !['material', 'corte', 'preparacion', 'gas'].includes(p.id) && 'bg-suave'
                )}
                style={{ width: `${p.pct}%` }}
                title={`${p.titulo}: ${p.pct.toFixed(1)} %`}
              />
            ))}
          </div>
          <p className="mt-1.5 text-[11px] text-suave">
            {resumen.participacion[0].titulo} es el{' '}
            <strong>{resumen.participacion[0].pct.toFixed(0)} %</strong> del costo.
            {resumen.participacion[0].id === 'material' && resumen.participacion[0].pct > 80
              ? ' Acá el precio se pelea con el proveedor de chapa, no con el margen.'
              : null}
          </p>
        </div>
      ) : null}

      {bloques.map((b) => (
        <BloqueExplicacion key={b.id} bloque={b} />
      ))}

      {/* Del costo al precio */}
      <div className="rounded-md border border-borde px-2.5 py-2">
        <p className="mb-1.5 text-[11px] font-semibold tracking-wide text-suave uppercase">Del costo al precio</p>
        <ul>
          {cadena
            .filter((c) => incluirInterno || !c.interno)
            .map((c, i) => (
              <li
                key={i}
                className={cn(
                  'border-b border-dashed border-borde py-1.5 last:border-0',
                  c.fuerte && 'border-t-2 border-t-tinta border-b-0 pt-2 font-bold'
                )}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className={cn('text-[11.5px]', !c.fuerte && 'text-suave')}>{c.etiqueta}</span>
                  <span className="tabular font-mono text-[11.5px] text-right">{c.cuenta}</span>
                </div>
                {c.nota ? <p className="mt-1 text-[11px] leading-snug text-suave/80">{c.nota}</p> : null}
              </li>
            ))}
        </ul>
      </div>
    </div>
  );
}

/** Botón chico para colgar al lado de un número suelto. */
export function BotonPorQue({ onClick, titulo = '¿De dónde sale?' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={titulo}
      aria-label={titulo}
      className="text-suave hover:text-acento inline-flex items-center"
    >
      <HelpCircle className="size-3.5" />
    </button>
  );
}
