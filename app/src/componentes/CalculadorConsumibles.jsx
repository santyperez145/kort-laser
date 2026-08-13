/**
 * Calculador de consumibles por hora.
 *
 * El campo "consumibles por hora" era el único costo del sistema sin manera de
 * contrastarlo: un número suelto en pesos, sin fuente y sin desglose. Ahí un
 * $150.000 mal tipeado —contra los $2.800 de referencia— multiplicó por seis
 * todos los precios y nadie lo notó durante días.
 *
 * Acá el número se arma con piezas: precio y horas de duración de cada una.
 * Un error se ve solo, porque una boquilla de $18.000 que dura 45 horas no
 * puede dar $150.000 por hora.
 *
 * Se abre desde la tarjeta de revisión del Panel, que es donde aparece el
 * problema. Guardar escribe `costo.consumiblesHora` de la máquina.
 */

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Calculator, RotateCcw, Save, Info } from 'lucide-react';

import { Dialogo, ContenidoDialogo, Aviso } from '@/componentes/ui/varios';
import { Boton } from '@/componentes/ui/boton';
import { Entrada, Campo, Selector, Opcion } from '@/componentes/ui/campos';
import { usarEstado } from '@/lib/estado';
import { money, num } from '@/lib/formato';
import { CONSUMIBLES_LASER, costoConsumiblesHora } from '@core/consumibles.js';
import { GASES } from '@core/materials.js';

export function CalculadorConsumibles({ abierto, alCerrar, maquina }) {
  const maquinas = usarEstado((s) => s.maquinas);
  const guardarMaquinas = usarEstado((s) => s.guardarMaquinas);
  const sim = usarEstado((s) => s.simbolo());

  // Si la máquina ya tiene su lista guardada se edita esa; si no, se arranca
  // de la de referencia. Lo que se guarda es la lista Y el total, así la
  // próxima vez se puede seguir editando en vez de volver a empezar.
  const [lista, setLista] = useState(() =>
    (maquina?.costo?.consumibles?.length ? maquina.costo.consumibles : CONSUMIBLES_LASER).map((c) => ({ ...c }))
  );
  const [gas, setGas] = useState('AIRE');
  const [guardando, setGuardando] = useState(false);

  const resultado = useMemo(() => costoConsumiblesHora(lista, { gas }), [lista, gas]);
  const actual = maquina?.costo?.consumiblesHora;

  const cambiar = (i, campo, valor) => {
    setLista((l) => l.map((c, k) => (k === i ? { ...c, [campo]: valor } : c)));
  };

  const guardar = async () => {
    if (!maquina) return;
    setGuardando(true);
    try {
      const actualizada = {
        ...maquina,
        costo: {
          ...maquina.costo,
          consumiblesHora: Math.round(resultado.total),
          // La lista queda guardada para poder revisarla y corregirla después
          consumibles: lista,
        },
      };
      await guardarMaquinas(maquinas.map((m) => (m.id === maquina.id ? actualizada : m)));
      toast.success(`Consumibles guardados: ${money(resultado.total, sim, 0)}/h`);
      alCerrar();
    } catch (e) {
      toast.error('No se pudo guardar: ' + e.message);
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Dialogo open={abierto} onOpenChange={(v) => !v && alCerrar()}>
      <ContenidoDialogo
        titulo="¿Cuánto gastás de consumibles por hora?"
        descripcion="Cargá lo que te cuesta cada pieza y cuántas horas de corte te dura. El costo por hora sale solo."
        ancho="max-w-3xl"
      >
        <Aviso nivel="info">
          <strong>Las horas de duración son del equipo; los precios son tuyos.</strong> Las que vienen
          cargadas son de referencia y sirven para arrancar, pero pedile los precios a tu proveedor:
          son el dato que más mueve este número.
        </Aviso>

        <Campo etiqueta="Gas con el que cortás más" className="mt-4 max-w-xs">
          <Selector valor={gas} alCambiar={setGas}>
            {['AIRE', 'N2', 'O2'].map((g) => (
              <Opcion key={g} valor={g}>
                {GASES[g]?.nombre || g}
              </Opcion>
            ))}
          </Selector>
        </Campo>
        <p className="mt-1 text-[11px] text-tenue">
          Cortando con oxígeno hay más salpicadura y la lente protectora se pica antes.
        </p>

        <div className="mt-4 overflow-x-auto rounded-xl border border-borde">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-borde bg-panel-alto">
                <th className="px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-tenue">
                  Pieza
                </th>
                <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-tenue w-32">
                  Precio
                </th>
                <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-tenue w-28">
                  Dura (h)
                </th>
                <th className="px-3 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-tenue w-28">
                  Por hora
                </th>
              </tr>
            </thead>
            <tbody>
              {lista.map((c, i) => {
                const d = resultado.detalle.find((x) => x.id === c.id);
                return (
                  <tr key={c.id} className="border-b border-borde last:border-0 align-top">
                    <td className="px-3 py-2">
                      <div className="font-medium">{c.nombre}</div>
                      {c.nota ? (
                        <div className="mt-0.5 text-[11px] leading-snug text-tenue">{c.nota}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <Entrada
                        type="number" min={0} step="any" className="text-right"
                        value={c.precio ?? ''}
                        onChange={(e) => cambiar(i, 'precio', parseFloat(e.target.value) || 0)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <Entrada
                        type="number" min={0} step="any" className="text-right"
                        value={c.vidaHoras ?? ''}
                        onChange={(e) => cambiar(i, 'vidaHoras', parseFloat(e.target.value) || 0)}
                      />
                    </td>
                    <td className="px-3 py-2 text-right tabular font-semibold whitespace-nowrap">
                      {d ? money(d.porHora, sim, 0) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex flex-wrap items-end justify-between gap-4 rounded-xl border border-borde bg-panel-alto px-4 py-3">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-tenue">
              Consumibles por hora de corte
            </div>
            <div className="text-[26px] font-bold leading-none tabular">
              {money(resultado.total, sim, 0)}
            </div>
            {actual > 0 && Math.abs(actual - resultado.total) / Math.max(1, resultado.total) > 0.05 ? (
              <div className="mt-1 text-[11.5px] text-suave">
                Hoy la máquina tiene <span className="tabular font-semibold">{money(actual, sim, 0)}</span>
                {actual > resultado.total * 1.5 ? ' — bastante más de lo que da esta lista.' : '.'}
              </div>
            ) : null}
          </div>

          <div className="flex gap-2">
            <Boton
              tono="fantasma" tam="sm"
              onClick={() => setLista(CONSUMIBLES_LASER.map((c) => ({ ...c })))}
            >
              <RotateCcw />
              Volver a la referencia
            </Boton>
            <Boton tono="corte" onClick={guardar} disabled={guardando || !maquina}>
              <Save />
              Guardar en la máquina
            </Boton>
          </div>
        </div>

        <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-tenue">
          <Info className="size-3.5 shrink-0 mt-px" />
          Las horas son de <strong className="font-semibold">corte</strong>, no de taller abierto. Si
          la máquina corta 4 h por día, una lente de 60 h te dura tres semanas.
        </p>
      </ContenidoDialogo>
    </Dialogo>
  );
}

/** Botón que abre el calculador. Se usa desde la tarjeta de revisión. */
export function BotonCalculadorConsumibles({ maquina, children }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <Boton tam="sm" onClick={() => setAbierto(true)} disabled={!maquina}>
        <Calculator />
        {children || 'Calcular consumibles'}
      </Boton>
      {abierto ? (
        <CalculadorConsumibles abierto={abierto} alCerrar={() => setAbierto(false)} maquina={maquina} />
      ) : null}
    </>
  );
}
