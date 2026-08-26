/**
 * Presupuestos — la lista desde la que se decide.
 *
 * No es un historial: es la cartera abierta. Lo que hace falta saber al entrar
 * no es "cuántos hay" sino **cuáles hay que mirar hoy**, y con la inflación
 * argentina eso cambia solo aunque nadie toque nada: un presupuesto que se
 * mandó hace dos semanas puede haber quedado por debajo del costo porque
 * subió la chapa.
 *
 * Por eso arriba va el riesgo y no un contador.
 *
 * ⚠️ El riesgo de cada fila se calcula con `impactoMaterialRapido()`, que es
 * EXACTO para el material y no mira nada más. Recotizar cada presupuesto
 * significaría anidar cada uno: con cincuenta, varios segundos de pantalla
 * congelada para pintar una tabla. El número fino sale al abrirlo.
 */

import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Plus, Search, Pencil, Factory, Trash2, TriangleAlert, OctagonAlert, ArrowUpRight,
} from 'lucide-react';

import { api } from '@/lib/api';
import { usarEstado } from '@/lib/estado';
import { money, num, fecha, ESTADOS_PRESUPUESTO } from '@/lib/formato';
import { Panel, PanelCab, PanelCuerpo, Vacio } from '@/componentes/ui/panel';
import { Boton } from '@/componentes/ui/boton';
import { Entrada, Selector, Opcion } from '@/componentes/ui/campos';
import { Insignia } from '@/componentes/ui/insignia';
import { Dialogo, ContenidoDialogo } from '@/componentes/ui/varios';
import { cn } from '@/lib/utils';
import { impactoMaterialRapido, carteraEnRiesgo } from '@core/vigencia.js';

export function VistaPresupuestos() {
  const materiales = usarEstado((s) => s.materiales);
  const sim = usarEstado((s) => s.simbolo());
  const navegar = useNavigate();
  const qc = useQueryClient();

  const [busca, setBusca] = useState('');
  const [estado, setEstado] = useState('__todos__');
  const [soloRiesgo, setSoloRiesgo] = useState(false);
  const [aBorrar, setABorrar] = useState(null);

  const { data: presupuestos = [], isLoading } = useQuery({
    queryKey: ['presupuestos'],
    queryFn: () => api.get('presupuestos'),
  });

  const recargar = () => qc.invalidateQueries({ queryKey: ['presupuestos'] });

  /* Riesgo por presupuesto. El catálogo de materiales es el mismo para todos,
     así que se recorre una vez por lista y no una vez por fila. */
  const conRiesgo = useMemo(() => {
    const ordenados = [...presupuestos].sort((a, b) =>
      String(b.creado || b.fecha || '').localeCompare(String(a.creado || a.fecha || ''))
    );
    return ordenados.map((p) => ({ p, riesgo: impactoMaterialRapido(p, materiales) }));
  }, [presupuestos, materiales]);

  const cartera = useMemo(() => carteraEnRiesgo(presupuestos, materiales), [presupuestos, materiales]);

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return conRiesgo.filter(({ p, riesgo }) => {
      if (estado !== '__todos__' && (p.estado || 'borrador') !== estado) return false;
      if (soloRiesgo && !(riesgo?.enRojo || Math.abs(riesgo?.pct ?? 0) >= 1.5)) return false;
      if (!q) return true;
      return (
        String(p.numero || '').toLowerCase().includes(q) ||
        String(p.cliente?.nombre || '').toLowerCase().includes(q) ||
        (p.items || []).some((i) => String(i.nombre || '').toLowerCase().includes(q))
      );
    });
  }, [conRiesgo, busca, estado, soloRiesgo]);

  const abrir = (p) => navegar(`/cotizador?id=${p.id}`);

  const aProduccion = async (p) => {
    try {
      const salida = await api.post('ordenes/aprobar', { presupuestoId: p.id });
      const ot = salida.orden || salida;
      const n = salida.reservadas;
      const detalle = n ? ` · ${n} unidad${n === 1 ? '' : 'es'} de retazo reservada${n === 1 ? '' : 's'}` : '';
      toast.success(`Orden ${ot.numero} creada${detalle}`);
      recargar();
    } catch (e) {
      toast.error('No se pudo aprobar: ' + e.message);
    }
  };

  const cambiarEstado = async (p, nuevo) => {
    // Aprobar no es cambiar una etiqueta: crea la orden y reserva retazos.
    if (nuevo === 'aprobado' && p.estado !== 'aprobado') return aProduccion(p);
    try {
      await api.put('presupuestos/' + p.id, { estado: nuevo });
      recargar();
      toast.success('Estado actualizado');
    } catch (e) {
      toast.error('No se pudo actualizar: ' + e.message);
    }
  };

  const borrar = async () => {
    const p = aBorrar;
    setABorrar(null);
    try {
      await api.del('presupuestos/' + p.id);
      recargar();
      toast.success('Presupuesto eliminado');
    } catch (e) {
      toast.error('No se pudo eliminar: ' + e.message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-tinta">Presupuestos</h1>
          <p className="mt-0.5 text-[13px] text-suave">
            La cartera abierta y qué hay que revisar antes de sostener un precio
          </p>
        </div>
        <Boton tono="corte" comoHijo>
          <Link to="/cotizador"><Plus />Nuevo presupuesto</Link>
        </Boton>
      </div>

      {cartera.enRojo > 0 || cartera.subieron > 0 ? (
        <Panel className={cn('border-l-4', cartera.enRojo ? 'border-l-peligro-500' : 'border-l-alerta-500')}>
          <PanelCuerpo className="flex flex-wrap items-center gap-x-6 gap-y-3">
            {cartera.enRojo > 0 ? (
              <div className="flex items-start gap-2">
                <OctagonAlert className="mt-0.5 size-4 shrink-0 text-peligro-500" />
                <div>
                  <div className="text-[13px] font-semibold">
                    {cartera.enRojo} presupuesto{cartera.enRojo === 1 ? '' : 's'}{' '}
                    {cartera.enRojo === 1 ? 'quedó' : 'quedaron'} por debajo del costo
                  </div>
                  <div className="tabular text-[11.5px] text-suave">
                    Sostenerlos cuesta {money(cartera.montoEnRiesgo, sim, 0)} de bolsillo
                  </div>
                </div>
              </div>
            ) : null}

            {cartera.subieron > 0 ? (
              <div className="flex items-start gap-2">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-alerta-500" />
                <div>
                  <div className="text-[13px] font-semibold">
                    {cartera.subieron} con el costo más alto que cuando se cotizó
                  </div>
                  <div className="text-[11.5px] text-suave">Todavía dejan ganancia, pero menos</div>
                </div>
              </div>
            ) : null}

            <Boton
              tam="sm"
              tono={soloRiesgo ? 'corte' : 'neutro'}
              className="ml-auto"
              onClick={() => setSoloRiesgo((v) => !v)}
            >
              {soloRiesgo ? 'Ver todos' : 'Ver sólo los que cambiaron'}
            </Boton>
          </PanelCuerpo>
        </Panel>
      ) : null}

      <Panel>
        <PanelCab
          acciones={
            <span className="tabular text-[11px] text-tenue">
              {lista.length} de {presupuestos.length}
            </span>
          }
        >
          <div className="relative w-full max-w-[300px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-tenue" />
            <Entrada
              placeholder="Buscar por número, cliente o pieza…"
              className="h-8 pl-8"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
          <Selector valor={estado} alCambiar={setEstado} className="h-8 w-[168px]">
            <Opcion valor="__todos__">Todos los estados</Opcion>
            {Object.entries(ESTADOS_PRESUPUESTO).map(([k, v]) => (
              <Opcion key={k} valor={k}>{v.txt}</Opcion>
            ))}
          </Selector>
        </PanelCab>

        <PanelCuerpo sinPad>
          {isLoading ? (
            <div className="space-y-2 p-4">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-10 animate-pulse rounded bg-panel-alto" />
              ))}
            </div>
          ) : !lista.length ? (
            <Vacio
              icono={<Search />}
              titulo={presupuestos.length ? 'Ningún presupuesto coincide' : 'Todavía no hay presupuestos'}
              detalle={
                presupuestos.length
                  ? 'Probá con otro texto o sacá el filtro.'
                  : 'Cotizá el primero y va a aparecer acá.'
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-borde">
                    {['N°', 'Cliente', 'Fecha', 'Ítems', 'Piezas', 'Peso', 'Total', 'Cambio', 'Estado', ''].map(
                      (t, i) => (
                        <th
                          key={t + i}
                          className={cn(
                            'whitespace-nowrap px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-tenue',
                            [3, 4, 5, 6].includes(i) ? 'text-right' : 'text-left'
                          )}
                        >
                          {t}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody>
                  {lista.map(({ p, riesgo }) => {
                    const r = p.resumen || {};
                    return (
                      <tr
                        key={p.id}
                        className={cn(
                          'border-b border-borde transition-colors last:border-0 hover:bg-panel-alto',
                          riesgo?.enRojo && 'bg-peligro-500/5'
                        )}
                      >
                        <td className="px-3 py-2">
                          <button
                            onClick={() => abrir(p)}
                            className="cursor-pointer font-mono text-xs text-corte-500 hover:underline"
                          >
                            {p.numero || '—'}
                          </button>
                        </td>
                        <td className="max-w-[200px] truncate px-3 py-2">
                          <button onClick={() => abrir(p)} className="cursor-pointer text-left hover:underline">
                            {p.cliente?.nombre || '—'}
                          </button>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-xs text-suave">
                          {fecha(p.fecha || p.creado)}
                        </td>
                        <td className="tabular px-3 py-2 text-right">{p.items?.length || 0}</td>
                        <td className="tabular px-3 py-2 text-right">{r.piezasTotales ?? '—'}</td>
                        <td className="tabular whitespace-nowrap px-3 py-2 text-right">
                          {r.pesoTotal != null ? num(r.pesoTotal, 1) + ' kg' : '—'}
                        </td>
                        <td className="tabular whitespace-nowrap px-3 py-2 text-right font-semibold">
                          {money(r.total, sim, 0)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2">
                          <CeldaCambio riesgo={riesgo} sim={sim} />
                        </td>
                        <td className="px-3 py-2">
                          <Selector
                            valor={p.estado || 'borrador'}
                            alCambiar={(v) => cambiarEstado(p, v)}
                            className="h-7 w-[132px] text-xs"
                          >
                            {Object.entries(ESTADOS_PRESUPUESTO).map(([k, v]) => (
                              <Opcion key={k} valor={k}>{v.txt}</Opcion>
                            ))}
                          </Selector>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex gap-1">
                            <Boton tam="iconoSm" title="Abrir en el cotizador" onClick={() => abrir(p)}>
                              <Pencil />
                            </Boton>
                            <Boton tam="iconoSm" title="Pasar a producción" onClick={() => aProduccion(p)}>
                              <Factory />
                            </Boton>
                            <Boton tono="peligro" tam="iconoSm" title="Eliminar" onClick={() => setABorrar(p)}>
                              <Trash2 />
                            </Boton>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </PanelCuerpo>
      </Panel>

      <Dialogo open={!!aBorrar} onOpenChange={(v) => !v && setABorrar(null)}>
        <ContenidoDialogo titulo="Eliminar presupuesto" ancho="max-w-md">
          <p className="text-[13px] leading-relaxed">
            Se va a borrar el presupuesto <strong>{aBorrar?.numero || ''}</strong> de{' '}
            <strong>{aBorrar?.cliente?.nombre || 'sin cliente'}</strong>. No se puede deshacer.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Boton onClick={() => setABorrar(null)}>Cancelar</Boton>
            <Boton tono="peligro" onClick={borrar}>Eliminar</Boton>
          </div>
        </ContenidoDialogo>
      </Dialogo>
    </div>
  );
}

/**
 * Cuánto se movió el material desde que se cotizó.
 *
 * Un guión no es lo mismo que un cero: si el presupuesto es anterior a que se
 * guardara el precio por ítem, no se puede saber — y decir "0 %" sería mentir
 * para el lado tranquilizador.
 */
function CeldaCambio({ riesgo, sim }) {
  if (!riesgo) {
    return (
      <span
        className="text-[11px] text-tenue"
        title="Cotizado antes de que se guardara el precio del material: no se puede comparar"
      >
        —
      </span>
    );
  }

  if (riesgo.enRojo) {
    return (
      <Insignia
        tono="rojo"
        title={`Sostenerlo cuesta ${money(Math.abs(riesgo.utilidadEstimadaHoy || 0), sim, 0)} de bolsillo`}
      >
        <OctagonAlert className="size-3" />
        bajo costo
      </Insignia>
    );
  }

  if (riesgo.pct == null || Math.abs(riesgo.pct) < 1.5) {
    return <span className="text-[11px] text-tenue">sin cambios</span>;
  }

  const sube = riesgo.pct > 0;
  return (
    <Insignia
      tono={sube ? 'amarillo' : 'verde'}
      title={
        `${sube ? 'Más' : 'Menos'} costo de material: ${money(Math.abs(riesgo.delta), sim, 0)}` +
        (riesgo.parcial ? ' · parcial: hay ítems sin precio guardado' : '')
      }
    >
      <ArrowUpRight className={cn('size-3', !sube && 'rotate-90')} />
      {sube ? '+' : ''}
      {riesgo.pct.toFixed(1)} %
    </Insignia>
  );
}
