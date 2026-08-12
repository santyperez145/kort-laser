/**
 * Tarifario por m².
 *
 * Cuando el cliente pregunta por teléfono "¿a cuánto el metro cuadrado?" hace
 * falta un número, y cotizar pieza por pieza no siempre se puede. El problema
 * es que **una tarifa plana para todo es la forma más silenciosa de perder
 * plata**: el costo por m² no depende del m², depende del espesor y de cuánto
 * corte tenga la pieza.
 *
 * Esta vista arma la lista de precios desde el costo real y, además, evalúa la
 * tarifa que se está cobrando hoy para mostrar hasta dónde conviene sostenerla.
 */

import { useMemo, useState } from 'react';
import { Printer, TriangleAlert, Check, Info } from 'lucide-react';

import { Panel, PanelCab, PanelCuerpo, PanelTitulo } from '@/componentes/ui/panel';
import { Boton } from '@/componentes/ui/boton';
import { Campo, Entrada, Selector, Opcion } from '@/componentes/ui/campos';
import { Aviso } from '@/componentes/ui/varios';
import { Insignia } from '@/componentes/ui/insignia';
import { usarEstado } from '@/lib/estado';
import { money, num } from '@/lib/formato';

import { generarTarifario, evaluarTarifaPlana, techoDeTarifa, BANDAS } from '@core/tarifario.js';
import { cotizarItem } from '@core/pricing.js';

export function VistaTarifario() {
  const config = usarEstado((s) => s.config);
  const materiales = usarEstado((s) => s.materiales);
  const maquinas = usarEstado((s) => s.maquinas);

  const [materialId, setMaterialId] = useState('acero-sae1010');
  const [conMaterial, setConMaterial] = useState(true);
  const [margen, setMargen] = useState(null); // null = el de la config
  const [tarifaPlana, setTarifaPlana] = useState(90000);

  const ctx = useMemo(() => ({ materiales, maquinas, config }), [materiales, maquinas, config]);
  const sim = config?.comercial?.simbolo || '$';

  const tarifario = useMemo(() => {
    if (!config || !materiales.length) return null;
    try {
      return generarTarifario(ctx, {
        materialId,
        conMaterial,
        margen: margen ?? undefined,
        cotizarItem,
      });
    } catch (e) {
      return { error: e.message };
    }
  }, [ctx, materialId, conMaterial, margen, config, materiales.length]);

  const evaluacion = useMemo(
    () => (tarifario && !tarifario.error ? evaluarTarifaPlana(tarifario, tarifaPlana) : null),
    [tarifario, tarifaPlana]
  );

  if (!config) return <div className="p-6 text-suave">Cargando…</div>;
  if (tarifario?.error) return <Aviso nivel="error">{tarifario.error}</Aviso>;
  if (!tarifario) return <div className="p-6 text-suave">Calculando el tarifario…</div>;

  const material = materiales.find((m) => m.id === materialId);
  const filasOk = tarifario.filas.filter((f) => !f.error);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Tarifario por m²</h1>
          <p className="text-sm text-suave">
            Precios calculados desde tu costo real, por espesor y por cuánto corte tiene la pieza
          </p>
        </div>
        <Boton tono="neutro" onClick={() => window.print()}>
          <Printer className="size-4" /> Imprimir para el mostrador
        </Boton>
      </div>

      {/* Controles */}
      <Panel>
        <PanelCuerpo className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Campo etiqueta="Material">
            <Selector valor={materialId} alCambiar={setMaterialId}>
              {materiales.filter((m) => m.activo !== false).map((m) => (
                <Opcion key={m.id} valor={m.id}>{m.nombre}</Opcion>
              ))}
            </Selector>
          </Campo>
          <Campo etiqueta="¿Quién pone la chapa?">
            <Selector valor={conMaterial ? 'kort' : 'cliente'} alCambiar={(v) => setConMaterial(v === 'kort')}>
              <Opcion valor="kort">La ponés vos (material incluido)</Opcion>
              <Opcion valor="cliente">La trae el cliente (sólo el proceso)</Opcion>
            </Selector>
          </Campo>
          <Campo etiqueta="Margen sobre costo">
            <Entrada type="number" min={0} max={300} unidad="%"
              value={margen ?? config.comercial.margen}
              onChange={(e) => setMargen(Number(e.target.value) || 0)} />
          </Campo>
          <Campo etiqueta="Tu tarifa plana actual" ayuda="Para comparar contra el costo real">
            <Entrada type="number" min={0} step={1000} unidad={`${sim}/m²`}
              value={tarifaPlana}
              onChange={(e) => setTarifaPlana(Number(e.target.value) || 0)} />
          </Campo>
        </PanelCuerpo>
      </Panel>

      {/* Semáforo de la tarifa plana */}
      {evaluacion && (
        <Panel>
          <PanelCab>
            <PanelTitulo>Tu tarifa de {money(tarifaPlana, sim, 0)}/m² contra el costo real</PanelTitulo>
            {evaluacion.primerEspesorAPerdida
              ? <Insignia tono="rojo">A pérdida desde {evaluacion.primerEspesorAPerdida.espesor} mm</Insignia>
              : <Insignia tono="verde">Rentable en todos los espesores</Insignia>}
          </PanelCab>
          <PanelCuerpo sinPad>
            <TablaSemaforo evaluacion={evaluacion} />
          </PanelCuerpo>
        </Panel>
      )}

      {/* Techos */}
      {evaluacion && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {BANDAS.map((b) => {
            const techo = techoDeTarifa(tarifario, tarifaPlana, b.id, 30);
            return (
              <Panel key={b.id}>
                <PanelCuerpo className="space-y-1">
                  <div className="text-[10.5px] font-bold uppercase tracking-wide text-tenue">{b.nombre}</div>
                  <div className={`text-2xl font-bold tabular-nums ${techo ? '' : 'text-peligro-500'}`}>
                    {techo ? `hasta ${techo} mm` : 'nunca'}
                  </div>
                  <div className="text-[11px] text-suave">
                    {techo
                      ? `Con ${money(tarifaPlana, sim, 0)}/m² te queda al menos 30 % de utilidad hasta ese espesor.`
                      : `A ${money(tarifaPlana, sim, 0)}/m² esta clase de trabajo no llega al 30 % en ningún espesor.`}
                  </div>
                </PanelCuerpo>
              </Panel>
            );
          })}
        </div>
      )}

      {/* Lista de precios */}
      <Panel>
        <PanelCab>
          <PanelTitulo>Lista de precios sugerida</PanelTitulo>
          <span className="text-[11px] text-suave">
            {material?.nombre} · chapa a {money(material?.precioKg, sim, 0)}/kg · margen {tarifario.margen} % ·
            {conMaterial ? ' material incluido' : ' sin material'} · sin IVA
          </span>
        </PanelCab>
        <PanelCuerpo sinPad>
          <TablaPrecios tarifario={tarifario} sim={sim} />
        </PanelCuerpo>
      </Panel>

      {/* Qué significa cada banda */}
      <Panel>
        <PanelCab><PanelTitulo>Cómo clasificar un trabajo</PanelTitulo></PanelCab>
        <PanelCuerpo className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {BANDAS.map((b) => (
            <div key={b.id} className="rounded-lg border border-borde p-3">
              <div className="text-sm font-semibold">{b.nombre}</div>
              <div className="mt-1 text-[11.5px] text-suave">{b.descripcion}</div>
              <div className="mt-2 text-[11px] text-tenue">Ejemplo: {b.ejemplo}</div>
              <div className="mt-1 font-mono text-[11px] text-tenue">≈ {b.mPorM2} m de corte por m²</div>
            </div>
          ))}
        </PanelCuerpo>
      </Panel>

      <Aviso nivel="aviso">
        <strong>Esta tabla vale lo que valga el precio de tu chapa.</strong> Está calculada con{' '}
        {money(material?.precioKg, sim, 0)}/kg. Si pagás otra cosa, actualizalo en Materiales antes de usarla
        para vender: en chapa fina el material es más del 80 % del costo, así que un error ahí se traslada
        entero al precio.
      </Aviso>

      {filasOk.length < tarifario.filas.length && (
        <Aviso nivel="info">
          Algunos espesores no aparecen porque tu máquina de {tarifario.potenciaKW} kW no los corta con calidad.
          Es a propósito: es mejor no cotizar un trabajo que no se puede entregar.
        </Aviso>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function TablaPrecios({ tarifario, sim }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-borde">
            <th className="px-3 py-2 text-left text-[10.5px] font-bold uppercase tracking-wide text-tenue">Espesor</th>
            <th className="px-3 py-2 text-right text-[10.5px] font-bold uppercase tracking-wide text-tenue">kg/m²</th>
            {BANDAS.map((b) => (
              <th key={b.id} className="px-3 py-2 text-right text-[10.5px] font-bold uppercase tracking-wide text-tenue">
                {b.nombre}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tarifario.filas.map((f) => (
            <tr key={f.espesor} className="border-b border-borde/60 last:border-0 hover:bg-panel-alto">
              <td className="px-3 py-2 font-semibold tabular-nums">{f.espesor} mm</td>
              <td className="px-3 py-2 text-right font-mono text-[12px] text-suave tabular-nums">
                {num(f.pesoM2, 1)}
              </td>
              {f.error ? (
                <td colSpan={BANDAS.length} className="px-3 py-2 text-[12px] text-tenue">
                  No se corta con calidad a esta potencia
                </td>
              ) : (
                BANDAS.map((b) => (
                  <td key={b.id} className="px-3 py-2 text-right font-mono tabular-nums">
                    {money(f.bandas[b.id].precioM2, sim, 0)}
                  </td>
                ))
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const TONO_ESTADO = {
  sano: 'text-chapa-600 dark:text-chapa-300',
  ajustado: 'text-alerta-500',
  perdida: 'text-peligro-500 font-semibold',
};
const FONDO_ESTADO = {
  sano: 'bg-chapa-500/8',
  ajustado: 'bg-alerta-500/10',
  perdida: 'bg-peligro-500/12',
};
const ICONO_ESTADO = { sano: Check, ajustado: TriangleAlert, perdida: TriangleAlert };

function TablaSemaforo({ evaluacion }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-borde">
            <th className="px-3 py-2 text-left text-[10.5px] font-bold uppercase tracking-wide text-tenue">Espesor</th>
            {BANDAS.map((b) => (
              <th key={b.id} className="px-3 py-2 text-right text-[10.5px] font-bold uppercase tracking-wide text-tenue">
                {b.nombre}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {evaluacion.filas.filter((f) => !f.error).map((f) => (
            <tr key={f.espesor} className="border-b border-borde/60 last:border-0">
              <td className="px-3 py-2 font-semibold tabular-nums">{f.espesor} mm</td>
              {BANDAS.map((b) => {
                const d = f.bandas[b.id];
                if (!d) return <td key={b.id} />;
                const Icono = ICONO_ESTADO[d.estado];
                return (
                  <td key={b.id} className={`px-3 py-2 text-right tabular-nums ${FONDO_ESTADO[d.estado]}`}>
                    <span className={`inline-flex items-center gap-1 font-mono ${TONO_ESTADO[d.estado]}`}>
                      <Icono className="size-3" />
                      {num(d.utilidadPct, 0)} %
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap items-center gap-4 border-t border-borde px-3 py-2 text-[11px] text-suave">
        <span className="inline-flex items-center gap-1"><Check className="size-3 text-chapa-500" /> Margen sano (≥ 25 %)</span>
        <span className="inline-flex items-center gap-1"><TriangleAlert className="size-3 text-alerta-500" /> Ajustado</span>
        <span className="inline-flex items-center gap-1"><TriangleAlert className="size-3 text-peligro-500" /> Se trabaja a pérdida</span>
        <span className="inline-flex items-center gap-1 ml-auto"><Info className="size-3" /> La utilidad es sobre el precio, después del costo real</span>
      </div>
    </div>
  );
}
