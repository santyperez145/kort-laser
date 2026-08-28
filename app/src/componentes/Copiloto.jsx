/**
 * KORT · El copiloto en pantalla
 *
 * Lo primero que se ve al abrir el panel. No es un resumen decorativo: es la
 * lista de lo que conviene hacer hoy, ordenada por cuánto cuesta no hacerlo, y
 * cada renglón con la evidencia que lo sostiene.
 *
 * Dos decisiones de presentación que importan tanto como el cálculo:
 *
 * 1. **La evidencia se ve sin tener que abrir nada.** Un panel que dice
 *    "3 presupuestos en riesgo" y esconde el porqué detrás de un clic enseña a
 *    creerle sin mirar, que es justo lo contrario de lo que se busca.
 *
 * 2. **El impacto en pesos sólo aparece cuando existe.** Donde el copiloto
 *    devuelve null no se escribe un guión ni un cero: no se escribe nada. Un
 *    cero al lado de un importe verdadero se lee como "esto no cuesta plata".
 */

import { useNavigate } from 'react-router-dom';
import { Compass, ArrowRight, Wallet, CalendarClock, Database, Ruler, TrendingUp } from 'lucide-react';

import { Panel, PanelCab, PanelTitulo, PanelCuerpo } from '@/componentes/ui/panel';
import { Boton } from '@/componentes/ui/boton';
import { cn } from '@/lib/utils';

const ICONO = {
  plata: Wallet,
  promesa: CalendarClock,
  dato: Database,
  medir: Ruler,
  oportunidad: TrendingUp,
};

/* El color acompaña siempre a una etiqueta legible: nadie tiene que recordar
   qué significa el naranja. */
const TONO = {
  plata: ['text-peligro-500', 'Plata'],
  promesa: ['text-alerta-500', 'Compromiso'],
  dato: ['text-acero-500', 'Dato'],
  medir: ['text-tenue', 'Medición'],
  oportunidad: ['text-chapa-500', 'Oportunidad'],
};

export function Copiloto({ resultado, resumen, sim = '$' }) {
  const navegar = useNavigate();
  if (!resultado) return null;

  const { sugerencias, hay } = resultado;

  return (
    <Panel className="border-l-4 border-l-corte-500">
      <PanelCab
        acciones={<span className="text-[11px] text-tenue">{hay || 'sin'} pendiente{hay === 1 ? '' : 's'}</span>}
      >
        <Compass className="size-3.5 text-corte-500" />
        <PanelTitulo>Qué conviene hacer hoy</PanelTitulo>
      </PanelCab>

      <PanelCuerpo className="space-y-2.5">
        {resumen ? <p className="text-[13px] text-tinta">{resumen}</p> : null}

        {sugerencias.map((s, i) => {
          const Icono = ICONO[s.tipo] || Database;
          const [color, etiqueta] = TONO[s.tipo] || ['text-tenue', s.tipo];
          return (
            <div
              key={i}
              className="rounded-lg border border-borde bg-panel-alto p-3"
            >
              <div className="flex items-start gap-2.5">
                <Icono className={cn('mt-0.5 size-4 shrink-0', color)} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className={cn('text-[10px] font-bold uppercase tracking-wide', color)}>
                      {etiqueta}
                    </span>
                    <span className="text-[13px] font-semibold text-tinta">{s.titulo}</span>
                    {/* Sólo si existe. Ver el encabezado del archivo. */}
                    {s.impactoPesos != null ? (
                      <span className="tabular text-[12px] font-semibold text-peligro-500">
                        {sim} {Math.round(s.impactoPesos).toLocaleString('es-AR')}
                      </span>
                    ) : null}
                  </div>

                  <p className="mt-1 text-[12px] leading-relaxed text-suave">{s.porque}</p>

                  {s.accion ? (
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <span className="text-[11.5px] text-tinta">{s.accion}</span>
                      {s.ruta ? (
                        <Boton tam="sm" tono="fantasma" onClick={() => navegar(s.ruta)}>
                          Ir <ArrowRight />
                        </Boton>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </PanelCuerpo>
    </Panel>
  );
}
