/**
 * Configuración del ítem: material, gas, geometría, plegado y acabados.
 *
 * El orden no es casual — es el orden en que se decide un trabajo real:
 * primero de qué es y cuánto, después con qué gas se corta (que en inoxidable
 * define el precio), después la forma, y al final los procesos extra.
 */

import { useMemo } from 'react';
import { Wind, Shapes, CornerUpRight, Sparkles, Info } from 'lucide-react';

import { usarCotizador } from './contexto';
import { Panel, PanelCab, PanelTitulo, PanelCuerpo } from '@/componentes/ui/panel';
import { Campo, Entrada, AreaTexto, Selector, Opcion, Etiqueta } from '@/componentes/ui/campos';
import { Acordeon, SeccionAcordeon, Aviso } from '@/componentes/ui/varios';
import { Insignia } from '@/componentes/ui/insignia';
import { usarEstado } from '@/lib/estado';
import { money, num } from '@/lib/formato';

import { construir, getPieza } from '@core/library.js';
import { DEFAULT_ACABADOS, DEFAULT_PROCESOS } from '@core/pricing.js';
import { GASES, gasesDisponibles, gasRecomendado } from '@core/materials.js';
import { matrizRecomendada, MATRICES_V } from '@core/bending.js';
import { shapeBBox } from '@core/geometry.js';

/* ------------------------------------------------------------------ */
/* Campo genérico a partir de la definición de la pieza                */
/* ------------------------------------------------------------------ */

function CampoDinamico({ def, valor, alCambiar }) {
  if (def.tipo === 'bool') {
    return (
      <label className="flex cursor-pointer items-center gap-2.5 py-1.5">
        <input
          type="checkbox"
          checked={!!valor}
          onChange={(e) => alCambiar(e.target.checked)}
          className="size-4 accent-corte-500 cursor-pointer"
        />
        <span className="text-[12.5px]">{def.label}</span>
      </label>
    );
  }

  if (def.tipo === 'sel') {
    const opciones = (def.opciones || []).map((o) => ({
      v: String(o.v ?? o.value ?? o),
      t: String(o.t ?? o.text ?? o),
    }));
    return (
      <Campo etiqueta={def.label}>
        <Selector valor={String(valor ?? '')} alCambiar={alCambiar}>
          {opciones.map((o) => (
            <Opcion key={o.v} valor={o.v}>
              {o.t}
            </Opcion>
          ))}
        </Selector>
      </Campo>
    );
  }

  if (def.tipo === 'area') {
    return (
      <Campo etiqueta={def.label}>
        <AreaTexto rows={def.filas || 3} value={valor ?? ''} onChange={(e) => alCambiar(e.target.value)} />
      </Campo>
    );
  }

  if (def.tipo === 'txt') {
    return (
      <Campo etiqueta={def.label}>
        <Entrada value={valor ?? ''} placeholder={def.placeholder || ''} onChange={(e) => alCambiar(e.target.value)} />
      </Campo>
    );
  }

  return (
    <Campo etiqueta={def.label}>
      <Entrada
        type="number"
        unidad={def.unidad}
        step={def.paso ?? (def.entero ? 1 : 'any')}
        min={def.min ?? undefined}
        max={def.max ?? undefined}
        value={valor ?? ''}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          // Un campo vacío no vale 0: 0 es una medida y vacío es "todavía no
          // escribí nada". Se conserva el texto hasta que sea un número.
          alCambiar(isFinite(v) ? v : e.target.value === '' ? '' : (def.def ?? 0));
        }}
      />
    </Campo>
  );
}

/* ------------------------------------------------------------------ */

export function Parametros() {
  const { item, resuelto, r, sel, actualizarItem } = usarCotizador();
  const materiales = usarEstado((s) => s.materiales);
  const config = usarEstado((s) => s.config);
  const sim = usarEstado((s) => s.simbolo());

  const material = materiales.find((m) => m.id === item?.materialId) || materiales[0];

  const activos = useMemo(() => materiales.filter((m) => m.activo !== false), [materiales]);

  if (!item || !material) return null;

  const recomendado = gasRecomendado(material, item.espesor);
  const gases = gasesDisponibles(material, item.espesor);

  const pl = item.plegado || { pliegues: 0, largoPliegue: 0, angulo: 90, matrizV: 0, herramentales: 1 };
  const bbox = resuelto?.shape ? shapeBBox(resuelto.shape) : { w: 0, h: 0 };

  /** Cambiar un parámetro de geometría puede cambiar el plegado sugerido. */
  const cambiarParam = (clave, valor) => {
    actualizarItem(sel, (it) => {
      const params = { ...it.params, [clave]: valor };
      let plegado = it.plegado;
      try {
        const meta = construir(it.piezaId, params, { espesor: it.espesor, material });
        if (meta?.plegado) plegado = { ...it.plegado, ...meta.plegado };
      } catch {
        // Geometría inválida con este valor: el aviso ya lo muestra el lienzo.
      }
      return { params, plegado };
    });
  };

  const cambiarMaterial = (id) => {
    const m = materiales.find((x) => x.id === id);
    actualizarItem(sel, (it) => ({
      materialId: id,
      espesor: m && !m.espesores.includes(it.espesor)
        ? m.espesores[Math.min(3, m.espesores.length - 1)]
        : it.espesor,
      gas: null,
    }));
  };

  const def = item.origen === 'libreria' ? getPieza(item.piezaId) : null;
  const acabados = config.acabados || DEFAULT_ACABADOS;
  const procesos = config.procesos || DEFAULT_PROCESOS;

  return (
    <Panel>
      <PanelCab>
        <PanelTitulo>Configuración del ítem</PanelTitulo>
      </PanelCab>

      <PanelCuerpo className="space-y-4">
        <Campo etiqueta="Nombre del ítem (aparece en el presupuesto)">
          <Entrada value={item.nombre} onChange={(e) => actualizarItem(sel, { nombre: e.target.value })} />
        </Campo>

        <div className="grid gap-3 sm:grid-cols-3">
          <Campo etiqueta="Material">
            <Selector valor={item.materialId} alCambiar={cambiarMaterial}>
              {activos.map((m) => (
                <Opcion key={m.id} valor={m.id}>
                  {m.nombre}
                </Opcion>
              ))}
            </Selector>
          </Campo>

          <Campo etiqueta="Espesor">
            <Selector
              valor={String(item.espesor)}
              alCambiar={(v) => actualizarItem(sel, { espesor: +v, gas: null })}
            >
              {material.espesores.map((e) => (
                <Opcion key={e} valor={String(e)}>
                  {e} mm
                </Opcion>
              ))}
            </Selector>
          </Campo>

          <Campo etiqueta="Cantidad">
            <Entrada
              type="number" min={1} step={1} value={item.cantidad}
              onChange={(e) =>
                actualizarItem(sel, { cantidad: Math.max(1, Math.round(+e.target.value || 1)) })
              }
            />
          </Campo>
        </div>

        {/* Quién pone la chapa cambia el precio de dos maneras y conviene que
            se decida acá, mirando el material, y no al final. */}
        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-borde bg-panel-alto px-3 py-2.5">
          <input
            type="checkbox"
            checked={!!item.materialCliente}
            onChange={(e) => actualizarItem(sel, { materialCliente: e.target.checked })}
            className="mt-0.5 size-4 accent-corte-500 cursor-pointer"
          />
          <span className="min-w-0">
            <span className="text-[13px] font-medium">El material lo pone el cliente</span>
            <span className="mt-0.5 block text-[11.5px] leading-snug text-suave">
              No se cobra la chapa. Se aplica un recargo del{' '}
              {num(config.comercial.recargoMaterialCliente ?? 0, 0)} % sobre el tiempo de máquina:
              se pierde el margen del material y el riesgo de una chapa fea pasa al taller.
            </span>
          </span>
        </label>

        <Campo etiqueta="Gas de asistencia">
          <Selector
            valor={item.gas || '__reco__'}
            alCambiar={(v) => actualizarItem(sel, { gas: v === '__reco__' ? null : v })}
          >
            <Opcion valor="__reco__" detalle="lo que conviene para este material y espesor">
              Recomendado ({GASES[recomendado]?.nombre || recomendado})
            </Opcion>
            {gases.map((g) => (
              <Opcion key={g.id} valor={g.id} detalle={g.calidad}>
                {GASES[g.id]?.nombre || g.id}
              </Opcion>
            ))}
          </Selector>
        </Campo>

        <Acordeon type="multiple" defaultValue={['geometria']} className="border-t border-borde">
          <ComparativaGases r={r} sim={sim} />

          <SeccionAcordeon
            valor="geometria"
            titulo={
              <>
                <Shapes className="size-4 text-corte-500" />
                Geometría
                {def ? <span className="text-[11px] font-normal text-tenue">· {def.nombre}</span> : null}
              </>
            }
          >
            {def ? (
              <>
                <p className="mb-3 text-[11.5px] leading-relaxed text-suave">{def.descripcion}</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {def.params.map((p) => (
                    <CampoDinamico
                      key={p.key}
                      def={p}
                      valor={item.params?.[p.key]}
                      alCambiar={(v) => cambiarParam(p.key, v)}
                    />
                  ))}
                </div>
              </>
            ) : (
              <Aviso nivel="info">
                Geometría importada{item.archivo ? ` de ${item.archivo}` : ''}. Las medidas vienen
                del archivo del cliente.
              </Aviso>
            )}
          </SeccionAcordeon>

          <SeccionAcordeon
            valor="plegado"
            titulo={
              <>
                <CornerUpRight className="size-4 text-corte-500" />
                Plegado
              </>
            }
            extra={
              pl.pliegues > 0 ? (
                <Insignia tono="naranja">{pl.pliegues} pliegue{pl.pliegues === 1 ? '' : 's'}</Insignia>
              ) : null
            }
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo etiqueta="Cantidad de pliegues">
                <Entrada
                  type="number" min={0} step={1} value={pl.pliegues}
                  onChange={(e) =>
                    actualizarItem(sel, (it) => ({
                      plegado: { ...it.plegado, pliegues: Math.max(0, Math.round(+e.target.value || 0)) },
                    }))
                  }
                />
              </Campo>
              <Campo etiqueta="Ángulo">
                <Entrada
                  type="number" min={1} max={170} unidad="°" value={pl.angulo}
                  onChange={(e) =>
                    actualizarItem(sel, (it) => ({ plegado: { ...it.plegado, angulo: +e.target.value || 90 } }))
                  }
                />
              </Campo>
              <Campo
                etiqueta="Largo de pliegue"
                ayuda={!pl.largoPliegue && bbox.h ? `Sugerido: ${Math.round(Math.min(bbox.w, bbox.h))} mm` : null}
              >
                <Entrada
                  type="number" min={0} unidad="mm" value={pl.largoPliegue}
                  onChange={(e) =>
                    actualizarItem(sel, (it) => ({ plegado: { ...it.plegado, largoPliegue: +e.target.value || 0 } }))
                  }
                />
              </Campo>
              <Campo etiqueta="Matriz V">
                <Selector
                  valor={String(pl.matrizV || 0)}
                  alCambiar={(v) =>
                    actualizarItem(sel, (it) => ({ plegado: { ...it.plegado, matrizV: +v || 0 } }))
                  }
                >
                  <Opcion valor="0">Automática (V{matrizRecomendada(item.espesor)})</Opcion>
                  {MATRICES_V.map((v) => (
                    <Opcion key={v} valor={String(v)}>
                      V{v}
                    </Opcion>
                  ))}
                </Selector>
              </Campo>
              <Campo etiqueta="Cambios de herramental">
                <Entrada
                  type="number" min={1} step={1} value={pl.herramentales}
                  onChange={(e) =>
                    actualizarItem(sel, (it) => ({
                      plegado: { ...it.plegado, herramentales: Math.max(1, Math.round(+e.target.value || 1)) },
                    }))
                  }
                />
              </Campo>
            </div>

            <FichaPliegue r={r} desarrollo={resuelto?._meta?.desarrollo} />
          </SeccionAcordeon>

          <SeccionAcordeon
            valor="acabados"
            titulo={
              <>
                <Sparkles className="size-4 text-corte-500" />
                Acabados y procesos
              </>
            }
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo etiqueta="Acabado superficial">
                <Selector valor={item.acabadoId} alCambiar={(v) => actualizarItem(sel, { acabadoId: v })}>
                  {acabados.map((a) => (
                    <Opcion key={a.id} valor={a.id}>
                      {a.nombre}
                    </Opcion>
                  ))}
                </Selector>
              </Campo>

              <Campo etiqueta="Prioridad">
                <Selector valor={item.urgencia} alCambiar={(v) => actualizarItem(sel, { urgencia: v })}>
                  <Opcion valor="normal">Plazo normal</Opcion>
                  <Opcion valor="urgente">Urgente (+{config.comercial.recargoUrgente} %)</Opcion>
                  <Opcion valor="express">Express 24 h (+{config.comercial.recargoExpress} %)</Opcion>
                </Selector>
              </Campo>

              <Campo etiqueta="Horas de ingeniería / CAD">
                <Entrada
                  type="number" min={0} step={0.25} unidad="h" value={item.ingenieriaHoras || 0}
                  onChange={(e) => actualizarItem(sel, { ingenieriaHoras: +e.target.value || 0 })}
                />
              </Campo>

              <Campo etiqueta="Margen del ítem" ayuda={`Vacío = el general (${config.comercial.margen} %)`}>
                <Entrada
                  type="number" min={0} step={1} unidad="%"
                  placeholder={String(config.comercial.margen)}
                  value={item.margen ?? ''}
                  onChange={(e) =>
                    actualizarItem(sel, { margen: e.target.value === '' ? undefined : +e.target.value })
                  }
                />
              </Campo>
            </div>

            <Etiqueta className="mt-4">Procesos adicionales</Etiqueta>
            <div className="divide-y divide-borde rounded-lg border border-borde">
              {procesos.map((p) => {
                const actual = (item.procesos || []).find((x) => x.id === p.id);
                return (
                  <div key={p.id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <div className="text-[12.5px] truncate">{p.nombre}</div>
                      <div className="text-[11px] text-tenue">{p.unidad}</div>
                    </div>
                    <Entrada
                      type="number" min={0} step="any" className="w-24"
                      value={actual?.cantidad ?? 0}
                      onChange={(e) => {
                        const q = parseFloat(e.target.value) || 0;
                        actualizarItem(sel, (it) => {
                          const otros = (it.procesos || []).filter((x) => x.id !== p.id);
                          return { procesos: q > 0 ? [...otros, { id: p.id, cantidad: q }] : otros };
                        });
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </SeccionAcordeon>
        </Acordeon>
      </PanelCuerpo>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Comparativa de gases                                                */
/*                                                                     */
/* Es lo que más plata mueve en inoxidable y aluminio: el nitrógeno     */
/* consume 25-95 m³/h contra 1-3 del oxígeno. Ese factor 30× define el  */
/* precio de la pieza, así que la comparativa se abre sola cuando hay   */
/* un gas más barato que el elegido.                                    */
/* ------------------------------------------------------------------ */

function ComparativaGases({ r, sim }) {
  if (!r?.alternativasGas?.length || r.alternativasGas.length < 2) return null;

  const elegido = r.corte.gasTipo;
  const mejor = r.alternativasGas[0];
  const actual = r.alternativasGas.find((a) => a.gas === elegido);
  const ahorro = actual && mejor && actual.gas !== mejor.gas ? actual.costoGas - mejor.costoGas : 0;

  return (
    <SeccionAcordeon
      valor="gases"
      titulo={
        <>
          <Wind className="size-4 text-corte-500" />
          Comparativa de gases
        </>
      }
      extra={ahorro > 0 ? <Insignia tono="verde">ahorrás {money(ahorro, sim, 0)}</Insignia> : null}
    >
      <div className="overflow-x-auto rounded-lg border border-borde">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-borde bg-panel-alto">
              {['Gas', 'Velocidad', 'Caudal', 'Costo del gas'].map((t, i) => (
                <th
                  key={t}
                  className={`px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-tenue ${i ? 'text-right' : 'text-left'}`}
                >
                  {t}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {r.alternativasGas.map((a) => (
              <tr
                key={a.gas}
                className={`border-b border-borde last:border-0 ${a.gas === elegido ? 'bg-corte-500/8' : ''}`}
              >
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{a.nombre}</span>
                    {a.gas === elegido ? <Insignia tono="naranja">en uso</Insignia> : null}
                  </div>
                  <div className="text-[11px] text-tenue">{a.calidad}</div>
                </td>
                <td className="px-3 py-2 text-right tabular whitespace-nowrap">{num(a.velocidad, 0)} mm/min</td>
                <td className="px-3 py-2 text-right tabular whitespace-nowrap">{num(a.caudal, 0)} m³/h</td>
                <td className="px-3 py-2 text-right tabular font-semibold whitespace-nowrap">
                  {money(a.costoGas, sim, 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {ahorro > 0 ? (
        <Aviso nivel="info" className="mt-3">
          Con {mejor.nombre.toLowerCase()} este trabajo gasta {money(ahorro, sim, 0)} menos de gas.{' '}
          <strong>Antes de cambiar, fijate si el canto lo permite:</strong> {mejor.calidad}
        </Aviso>
      ) : null}

      <p className="mt-2 flex items-center gap-1.5 text-[11px] text-tenue">
        <Info className="size-3" />
        Boquilla {num(r.corte.boquilla, 1)} mm · {num(r.corte.gasPresion, 1)} bar ·{' '}
        {num(r.corte.gasM3, 2)} m³ para este lote
      </p>
    </SeccionAcordeon>
  );
}

/* ------------------------------------------------------------------ */

function FichaPliegue({ r, desarrollo }) {
  if (!r?.datosPliegue) return null;
  const d = r.datosPliegue;

  const filas = [
    ['Matriz V', 'V' + d.matrizV],
    ['Radio interno', num(d.radioInterno, 2) + ' mm'],
    ['K-factor', num(d.kFactor, 3)],
    ['Deducción por pliegue', num(d.BD, 2) + ' mm'],
    desarrollo ? ['Desarrollo total', num(desarrollo.desarrollo, 1) + ' mm'] : null,
    ['Ala mínima', num(d.alaMinima, 1) + ' mm'],
    ['Fuerza requerida', `${num(d.toneladas, 1)} t (${num(d.toneladasPorMetro, 1)} t/m)`],
  ].filter(Boolean);

  return (
    <div className="mt-3 rounded-lg bg-panel-alto p-3">
      <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-tenue">
        Cálculo de plegado
      </div>
      <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
        {filas.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 text-[12.5px]">
            <dt className="text-suave">{k}</dt>
            <dd className="tabular font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
