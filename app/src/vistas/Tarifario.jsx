/**
 * Tarifario.
 *
 * Contesta la pregunta del mostrador —"¿a cuánto?"— sin que la respuesta
 * termine costando plata. Trabaja en las tres bases que se usan de verdad
 * ($/m², $/kg y $/m de corte) porque cada una se rompe por un lado distinto,
 * y muestra las dos cosas que hacen falta para no cobrar ni barato ni caro:
 * el PISO por debajo del cual se pierde, y el precio con el margen que se
 * quiera.
 */

import { useMemo, useState } from 'react';
import { Printer, TriangleAlert, Check, Info, TrendingDown, Scissors, ShoppingCart } from 'lucide-react';

import { Panel, PanelCab, PanelCuerpo, PanelTitulo } from '@/componentes/ui/panel';
import { Boton } from '@/componentes/ui/boton';
import { Campo, Entrada, Selector, Opcion } from '@/componentes/ui/campos';
import { Aviso } from '@/componentes/ui/varios';
import { Insignia } from '@/componentes/ui/insignia';
import { BloqueExplicacion } from '@/componentes/PorQue';
import { usarEstado } from '@/lib/estado';
import { money, num } from '@/lib/formato';
import { cn } from '@/lib/utils';

import {
  generarTarifario, evaluarTarifaPlana, techoDeTarifa, rangoRecomendado,
  sensibilidadChapa, sensibilidadAprovechamiento, BANDAS, BASES,
} from '@core/tarifario.js';
import { cotizarItem } from '@core/pricing.js';
import { explicarTarifa } from '@core/explicacion.js';

/** Tarifa que se está cobrando hoy, por base. Arranca con lo que cobra KORT. */
const TARIFA_INICIAL = { m2: 90000, kg: 3800, metro: 0 };

const CAMPO_COSTO = { m2: 'costoM2', kg: 'costoKg', metro: 'costoMetro' };
const CAMPO_PRECIO = { m2: 'precioM2', kg: 'precioKg', metro: 'precioMetro' };
const CAMPO_MINIMO = { m2: 'minimoM2', kg: 'minimoKg', metro: 'minimoMetro' };

export function VistaTarifario() {
  const config = usarEstado((s) => s.config);
  const materiales = usarEstado((s) => s.materiales);
  const maquinas = usarEstado((s) => s.maquinas);

  const [materialId, setMaterialId] = useState('acero-sae1010');
  const [base, setBase] = useState('kg');
  const [conMaterial, setConMaterial] = useState(true);
  const [margen, setMargen] = useState(null);
  const [tarifas, setTarifas] = useState(TARIFA_INICIAL);

  const tarifaPlana = tarifas[base] || 0;
  const setTarifa = (v) => setTarifas((t) => ({ ...t, [base]: v }));

  const ctx = useMemo(() => ({ materiales, maquinas, config }), [materiales, maquinas, config]);
  const sim = config?.comercial?.simbolo || '$';
  const baseDef = BASES.find((b) => b.id === base);

  const tarifario = useMemo(() => {
    if (!config || !materiales.length) return null;
    try {
      return generarTarifario(ctx, { materialId, conMaterial, margen: margen ?? undefined, cotizarItem });
    } catch (e) {
      return { error: e.message };
    }
  }, [ctx, materialId, conMaterial, margen, config, materiales.length]);

  const ev = useMemo(
    () => (tarifario && !tarifario.error && tarifaPlana > 0 ? evaluarTarifaPlana(tarifario, tarifaPlana, base) : null),
    [tarifario, tarifaPlana, base]
  );
  const sensChapa = useMemo(
    () => (tarifario && !tarifario.error && tarifaPlana > 0 ? sensibilidadChapa(tarifario, tarifaPlana, base, 'simple') : []),
    [tarifario, tarifaPlana, base]
  );
  const sensAprov = useMemo(
    () => (tarifario && !tarifario.error && tarifaPlana > 0 ? sensibilidadAprovechamiento(tarifario, tarifaPlana, base, 'simple') : []),
    [tarifario, tarifaPlana, base]
  );

  if (!config) return <div className="p-6 text-suave">Cargando…</div>;
  if (tarifario?.error) return <Aviso nivel="error">{tarifario.error}</Aviso>;
  if (!tarifario) return <div className="p-6 text-suave">Calculando el tarifario…</div>;

  const material = materiales.find((m) => m.id === materialId);
  const dec = base === 'm2' ? 0 : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Tarifario</h1>
          <p className="text-sm text-suave">
            Cuánto cobrar para no regalar ni espantar, calculado desde tu costo real
          </p>
        </div>
        <Boton tono="neutro" onClick={() => window.print()}>
          <Printer className="size-4" /> Imprimir para el mostrador
        </Boton>
      </div>

      {/* Base de cobro */}
      <Panel>
        <PanelCab><PanelTitulo>¿Cómo cobrás?</PanelTitulo></PanelCab>
        <PanelCuerpo className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-3">
            {BASES.map((b) => (
              <button
                key={b.id}
                onClick={() => setBase(b.id)}
                className={`rounded-lg border p-3 text-left transition ${
                  base === b.id ? 'border-corte-500 bg-corte-500/8 shadow-sm' : 'border-borde hover:border-borde-fuerte'
                }`}
              >
                <div className="text-sm font-semibold">{b.nombre}</div>
                <div className="font-mono text-[11px] text-tenue">{b.unidad}</div>
                <div className="mt-1 text-[11px] leading-snug text-suave">{b.ayuda}</div>
              </button>
            ))}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Campo etiqueta="Material">
              <Selector valor={materialId} alCambiar={setMaterialId}>
                {materiales.filter((m) => m.activo !== false).map((m) => (
                  <Opcion key={m.id} valor={m.id}>{m.nombre}</Opcion>
                ))}
              </Selector>
            </Campo>
            <Campo etiqueta="¿Quién pone la chapa?">
              <Selector valor={conMaterial ? 'kort' : 'cliente'} alCambiar={(v) => setConMaterial(v === 'kort')}>
                <Opcion valor="kort">La ponés vos</Opcion>
                <Opcion valor="cliente">La trae el cliente</Opcion>
              </Selector>
            </Campo>
            <Campo etiqueta="Margen objetivo">
              <Entrada type="number" min={0} max={300} unidad="%"
                value={margen ?? config.comercial.margen}
                onChange={(e) => setMargen(Number(e.target.value) || 0)} />
            </Campo>
            <Campo etiqueta="Lo que cobrás hoy" ayuda="Para compararlo contra el costo">
              <Entrada type="number" min={0} unidad={baseDef.unidad.replace('$', sim)}
                value={tarifaPlana} onChange={(e) => setTarifa(Number(e.target.value) || 0)} />
            </Campo>
          </div>
        </PanelCuerpo>
      </Panel>

      {/* Veredicto */}
      {ev && <Veredicto ev={ev} sim={sim} baseDef={baseDef} tarifario={tarifario} />}

      {/* Cuánto cobrar */}
      <Panel>
        <PanelCab>
          <PanelTitulo>Cuánto cobrar, por nivel de detalle</PanelTitulo>
          <span className="text-[11px] text-suave">
            margen {tarifario.margen} % · {conMaterial ? 'material incluido' : 'sólo proceso'} · sin IVA
          </span>
        </PanelCab>
        <PanelCuerpo className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {BANDAS.map((b) => {
            const r = rangoRecomendado(tarifario, base, b.id);
            if (!r) return null;
            const disperso = r.dispersion > 1.6;
            return (
              <div key={b.id} className="rounded-lg border border-borde p-3">
                <div className="text-[10.5px] font-bold uppercase tracking-wide text-tenue">{b.nombre}</div>
                <div className="mt-1 text-xl font-bold tabular-nums">
                  {money(r.maximo, sim, dec)}
                </div>
                <div className="text-[11px] text-suave">
                  piso <span className="font-mono">{money(r.minimo, sim, dec)}</span> · por debajo se pierde
                </div>
                <div className="mt-2 text-[11px] leading-snug text-tenue">{b.descripcion}</div>
                {disperso && (
                  <div className="mt-2 flex items-start gap-1 text-[11px] text-alerta-500">
                    <TriangleAlert className="mt-px size-3 shrink-0" />
                    <span>Varía {num(r.dispersion, 1)}× entre espesores: acá un precio único no sirve, usá la tabla.</span>
                  </div>
                )}
              </div>
            );
          })}
        </PanelCuerpo>
      </Panel>

      {/* Semáforo */}
      {ev && (
        <Panel>
          <PanelCab>
            <PanelTitulo>
              Tu tarifa de {money(tarifaPlana, sim, dec)} {baseDef.unidad.replace('$', '')} contra el costo real
            </PanelTitulo>
            <span className="text-[11px] text-suave">utilidad que te queda, sobre el precio</span>
          </PanelCab>
          <PanelCuerpo sinPad>
            <TablaSemaforo ev={ev} />
          </PanelCuerpo>
        </Panel>
      )}

      {/* Las dos palancas */}
      {ev && (sensChapa.length > 0 || sensAprov.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel>
            <PanelCab>
              <PanelTitulo>¿Comprás caro?</PanelTitulo>
              <ShoppingCart className="size-4 text-tenue" />
            </PanelCab>
            <PanelCuerpo sinPad>
              <TablaSensibilidad
                filas={sensChapa} sim={sim} dec={dec}
                etiqueta={(s) => money(s.precioChapa, sim, 0)}
                titulo="Chapa $/kg"
              />
              <p className="border-t border-borde px-3 py-2 text-[11px] text-suave">
                Si conseguís la chapa más barata, la misma tarifa empieza a cerrar. Es la mitad de la
                pregunta que no depende del precio de venta.
              </p>
            </PanelCuerpo>
          </Panel>

          <Panel>
            <PanelCab>
              <PanelTitulo>¿O tirás mucho recorte?</PanelTitulo>
              <Scissors className="size-4 text-tenue" />
            </PanelCab>
            <PanelCuerpo sinPad>
              <TablaSensibilidad
                filas={sensAprov} sim={sim} dec={dec}
                etiqueta={(s) => `${(s.aprovechamiento * 100).toFixed(0)} %`}
                titulo="Aprovechamiento"
              />
              <p className="border-t border-borde px-3 py-2 text-[11px] text-suave">
                <strong>Esta es la palanca que sí controlás.</strong> El recorte lo pagás vos: cobrando por
                kilo, subir el aprovechamiento es exactamente lo mismo que comprar más barato. Agrupá
                pedidos del mismo espesor y usá los retazos.
              </p>
            </PanelCuerpo>
          </Panel>
        </div>
      )}

      {/* Lista de precios */}
      <Panel>
        <PanelCab>
          <PanelTitulo>Lista de precios sugerida · {baseDef.nombre.toLowerCase()}</PanelTitulo>
          <span className="text-[11px] text-suave">
            {material?.nombre} · chapa a {money(material?.precioKg, sim, 0)}/kg
          </span>
        </PanelCab>
        <PanelCuerpo sinPad>
          <TablaPrecios tarifario={tarifario} sim={sim} base={base} dec={dec} />
        </PanelCuerpo>
      </Panel>

      {/* Guía */}
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
        <strong>Todo esto vale lo que valga el precio de tu chapa.</strong> Está calculado con{' '}
        {money(material?.precioKg, sim, 0)}/kg, que es un valor de referencia, no tu factura. Cargá el
        tuyo en Materiales antes de decidir un precio: en chapa fina el material es más del 80 % del
        costo, así que un error ahí se traslada entero.
      </Aviso>
    </div>
  );
}

/* ------------------------------------------------------------------ */

const TEXTO_VEREDICTO = {
  'todo-perdida': {
    tono: 'error',
    titulo: 'Con esta tarifa perdés plata en todos los casos',
    detalle: 'No hay espesor ni tipo de trabajo donde cierre. Hay que subirla, comprar más barato o aprovechar mejor la chapa.',
  },
  'mayoria-perdida': {
    tono: 'error',
    titulo: 'Con esta tarifa perdés plata en la mayoría de los trabajos',
    detalle: 'Sólo cierra en algunos casos puntuales. Como tarifa general no sirve.',
  },
  parcial: {
    tono: 'aviso',
    titulo: 'La tarifa cierra en algunos trabajos y en otros no',
    detalle: 'Fijate en la tabla dónde se pone en rojo: ahí hay que cotizar aparte o subir el precio.',
  },
  sana: {
    tono: 'info',
    titulo: 'La tarifa cubre el costo en todos los casos',
    detalle: 'Podés sostenerla. Si en algún caso el margen queda muy alto, ahí tenés lugar para competir.',
  },
};

function Veredicto({ ev, sim, baseDef, tarifario }) {
  const v = TEXTO_VEREDICTO[ev.veredicto];
  const u = baseDef.unidad.replace('$', '');
  return (
    <Aviso nivel={v.tono}>
      <div className="space-y-1">
        <div className="text-[13px] font-semibold">{v.titulo}</div>
        <div>{v.detalle}</div>
        <div className="flex flex-wrap gap-x-5 gap-y-1 pt-1 font-mono text-[11.5px]">
          <span>{ev.casosEnPerdida} de {ev.casos} casos en pérdida</span>
          <span>
            peor: {ev.peor.espesor} mm {ev.peor.banda} ({num(ev.peor.utilidadPct, 0)} %)
          </span>
          <span>
            mejor: {ev.mejor.espesor} mm {ev.mejor.banda} ({num(ev.mejor.utilidadPct, 0)} %)
          </span>
        </div>
        {ev.veredicto !== 'sana' && (
          <div className="pt-1 text-[12px]">
            Para dejar {tarifario.margen} % en trabajos simples habría que cobrar{' '}
            <strong className="font-mono">
              {money(rangoRecomendado(tarifario, ev.base, 'simple')?.maximo ?? 0, sim, 0)} {u}
            </strong>.
          </div>
        )}
      </div>
    </Aviso>
  );
}

const TONO = {
  sano: 'text-chapa-600 dark:text-chapa-300',
  ajustado: 'text-alerta-500',
  perdida: 'text-peligro-500 font-semibold',
};
const FONDO = {
  sano: 'bg-chapa-500/8',
  ajustado: 'bg-alerta-500/10',
  perdida: 'bg-peligro-500/12',
};
const ICONO = { sano: Check, ajustado: TriangleAlert, perdida: TrendingDown };

function Celda({ estado, children }) {
  const I = ICONO[estado];
  return (
    <td className={`px-3 py-2 text-right tabular-nums ${FONDO[estado]}`}>
      <span className={`inline-flex items-center gap-1 font-mono ${TONO[estado]}`}>
        <I className="size-3" />
        {children}
      </span>
    </td>
  );
}

function TablaSemaforo({ ev }) {
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
          {ev.filas.filter((f) => !f.error).map((f) => (
            <tr key={f.espesor} className="border-b border-borde/60 last:border-0">
              <td className="px-3 py-2 font-semibold tabular-nums">{f.espesor} mm</td>
              {BANDAS.map((b) => {
                const d = f.bandas[b.id];
                if (!d) return <td key={b.id} />;
                return <Celda key={b.id} estado={d.estado}>{num(d.utilidadPct, 0)} %</Celda>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex flex-wrap items-center gap-4 border-t border-borde px-3 py-2 text-[11px] text-suave">
        <span className="inline-flex items-center gap-1"><Check className="size-3 text-chapa-500" /> Sano (≥ 25 %)</span>
        <span className="inline-flex items-center gap-1"><TriangleAlert className="size-3 text-alerta-500" /> Ajustado</span>
        <span className="inline-flex items-center gap-1"><TrendingDown className="size-3 text-peligro-500" /> A pérdida</span>
        <span className="ml-auto inline-flex items-center gap-1"><Info className="size-3" /> Utilidad sobre el precio, después del costo real</span>
      </div>
    </div>
  );
}

function TablaSensibilidad({ filas, sim, dec, etiqueta, titulo }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-borde">
            <th className="px-3 py-2 text-left text-[10.5px] font-bold uppercase tracking-wide text-tenue">{titulo}</th>
            <th className="px-3 py-2 text-right text-[10.5px] font-bold uppercase tracking-wide text-tenue">Costo</th>
            <th className="px-3 py-2 text-right text-[10.5px] font-bold uppercase tracking-wide text-tenue">Utilidad</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((s, i) => (
            <tr key={i} className={`border-b border-borde/60 last:border-0 ${s.esActual ? 'bg-acero-500/8' : ''}`}>
              <td className="px-3 py-2 font-mono tabular-nums">
                {etiqueta(s)}
                {s.esActual && <span className="ml-2 text-[10px] font-sans text-tenue">hoy</span>}
              </td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-suave">{money(s.costo, sim, dec)}</td>
              <Celda estado={s.estado}>{num(s.utilidadPct, 0)} %</Celda>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TablaPrecios({ tarifario, sim, base, dec }) {
  const campoPrecio = CAMPO_PRECIO[base];
  const campoMinimo = CAMPO_MINIMO[base];
  /* Cualquier celda se puede abrir para ver la cuenta que la produjo. Sin
     esto la tabla es un oráculo: da números que no se pueden discutir ni
     corregir. */
  const [detalle, setDetalle] = useState(null);
  const exp = useMemo(() => {
    if (!detalle) return null;
    const f = tarifario.filas.find((x) => x.espesor === detalle.espesor);
    if (!f || f.error) return null;
    return explicarTarifa(f.bandas[detalle.banda], {
      base,
      espesor: f.espesor,
      banda: BANDAS.find((b) => b.id === detalle.banda)?.nombre || detalle.banda,
      margen: tarifario.margen,
    });
  }, [detalle, tarifario, base]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-borde">
            <th className="px-3 py-2 text-left text-[10.5px] font-bold uppercase tracking-wide text-tenue">Espesor</th>
            <th className="px-3 py-2 text-right text-[10.5px] font-bold uppercase tracking-wide text-tenue">
              {base === 'kg' ? 'm²/kg' : 'kg/m²'}
            </th>
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
                {base === 'kg' ? num(f.m2PorKg, 3) : num(f.kgPorM2, 1)}
              </td>
              {f.error ? (
                <td colSpan={BANDAS.length} className="px-3 py-2 text-[12px] text-tenue">
                  No se corta con calidad a esta potencia
                </td>
              ) : (
                BANDAS.map((b) => {
                  const activa = detalle?.espesor === f.espesor && detalle?.banda === b.id;
                  return (
                    <td key={b.id} className="px-1 py-1 text-right tabular-nums">
                      <button
                        type="button"
                        title="Ver cómo se llegó a este número"
                        onClick={() =>
                          setDetalle(activa ? null : { espesor: f.espesor, banda: b.id })
                        }
                        className={cn(
                          'w-full rounded px-2 py-1 text-right hover:bg-corte-500/8',
                          activa && 'bg-corte-500/12 ring-1 ring-corte-500/40'
                        )}
                      >
                        <div className="font-mono font-semibold">{money(f.bandas[b.id][campoPrecio], sim, dec)}</div>
                        <div className="font-mono text-[10.5px] text-tenue">
                          piso {money(f.bandas[b.id][campoMinimo], sim, dec)}
                        </div>
                      </button>
                    </td>
                  );
                })
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {exp ? (
        <div className="mt-3 px-3 pb-3">
          <BloqueExplicacion bloque={exp} abiertoInicial />
        </div>
      ) : (
        <p className="px-3 pb-3 text-[11.5px] text-tenue">
          Tocá cualquier precio de la tabla para ver la cuenta que lo produjo.
        </p>
      )}
    </div>
  );
}
