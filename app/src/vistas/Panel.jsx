/**
 * Panel — cómo viene el mes de un vistazo.
 *
 * El número que manda no es la facturación: es cuánto falta para el punto de
 * equilibrio. Un mes con muchos presupuestos y poca conversión se ve bien en
 * un gráfico de barras y es un mes perdido. Por eso el equilibrio va arriba,
 * con anillo, y la facturación al lado.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  ResponsiveContainer, ComposedChart, Area, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, PieChart, Pie, Cell, BarChart, RadialBarChart, RadialBar, PolarAngleAxis,
} from 'recharts';
import {
  Plus, FileText, TrendingUp, Target, CheckCircle2, Percent,
  Layers, Users, Gauge, ArrowRight, OctagonAlert, TriangleAlert,
} from 'lucide-react';
import { api } from '@/lib/api';
import { usarEstado } from '@/lib/estado';
import { money, num, pct, fecha, ESTADOS_PRESUPUESTO } from '@/lib/formato';
import { Panel, PanelCab, PanelTitulo, PanelCuerpo, Vacio } from '@/componentes/ui/panel';
import { Boton } from '@/componentes/ui/boton';
import { InsigniaEstado } from '@/componentes/ui/insignia';
import { PALETA, usarColores, ejeMoneda, Globo } from '@/componentes/graficos';
import { calcularEstructura, calcularCostoHoraMaquina, puntoEquilibrio } from '@core/costos.js';
import { revisarDatos } from '@core/salud.js';
import { Aviso } from '@/componentes/ui/varios';
import { BotonCalculadorConsumibles } from '@/componentes/CalculadorConsumibles';
import { cn } from '@/lib/utils';

/* ------------------------------------------------------------------ */
/* Tarjeta de indicador                                                */
/* ------------------------------------------------------------------ */

function Kpi({ etiqueta, valor, nota, Icono, tono = 'acero', chispas }) {
  const tonos = {
    acero: 'from-acero-500/16 text-acero-600 dark:text-acero-300',
    corte: 'from-corte-500/16 text-corte-600 dark:text-corte-300',
    verde: 'from-chapa-500/16 text-chapa-500 dark:text-chapa-300',
    alerta: 'from-alerta-500/16 text-alerta-500 dark:text-alerta-400',
  };
  return (
    <Panel className="relative">
      <div className={cn('absolute inset-x-0 top-0 h-20 bg-gradient-to-b to-transparent pointer-events-none', tonos[tono])} />
      <div className="relative p-4">
        <div className="flex items-start justify-between gap-2">
          <span className="text-[10.5px] font-bold uppercase tracking-[0.6px] text-tenue">{etiqueta}</span>
          <Icono className={cn('size-4 shrink-0', tonos[tono].split(' ').slice(1).join(' '))} />
        </div>
        <div className="mt-1.5 text-[26px] font-bold leading-none tabular text-tinta">{valor}</div>
        {nota ? <div className="mt-1.5 text-[11.5px] text-suave leading-snug">{nota}</div> : null}
        {chispas?.length > 1 ? (
          <div className="mt-3 -mb-1 h-8">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chispas} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id={`chispa-${etiqueta}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#e4572e" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="#e4572e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone" dataKey="v" stroke="#e4572e" strokeWidth={1.5}
                  fill={`url(#chispa-${etiqueta})`} isAnimationActive={false} dot={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Revisión de los datos cargados                                      */
/*                                                                     */
/* Va arriba de todo y sólo aparece cuando hay algo mal. Un dato mal    */
/* cargado no rompe nada: hace que todos los precios salgan mal, en     */
/* silencio. Pasó con $150.000/h de consumibles, que multiplicó por     */
/* seis cada presupuesto hasta que alguien miró un número raro.         */
/* ------------------------------------------------------------------ */

function RevisionDatos() {
  const config = usarEstado((s) => s.config);
  const maquinas = usarEstado((s) => s.maquinas);
  const materiales = usarEstado((s) => s.materiales);
  const laser = usarEstado((s) => s.laser());

  const revision = useMemo(
    () => (config ? revisarDatos({ config, maquinas, materiales }) : null),
    [config, maquinas, materiales]
  );

  if (!revision || revision.ok) return null;

  const hayErrores = revision.errores > 0;

  return (
    <Panel className={cn('border-l-4', hayErrores ? 'border-l-peligro-500' : 'border-l-alerta-500')}>
      <PanelCab
        acciones={
          <span className="text-[11px] text-tenue">
            {revision.errores > 0 ? `${revision.errores} error${revision.errores === 1 ? '' : 'es'}` : null}
            {revision.errores > 0 && revision.avisos > 0 ? ' · ' : null}
            {revision.avisos > 0 ? `${revision.avisos} aviso${revision.avisos === 1 ? '' : 's'}` : null}
          </span>
        }
      >
        {hayErrores ? (
          <OctagonAlert className="size-3.5 text-peligro-500" />
        ) : (
          <TriangleAlert className="size-3.5 text-alerta-500" />
        )}
        <PanelTitulo>Revisá estos datos antes de cotizar</PanelTitulo>
      </PanelCab>

      <PanelCuerpo className="space-y-2">
        {revision.hallazgos.map((h, i) => (
          <Aviso key={i} nivel={h.nivel}>
            <span className="font-semibold">{h.donde}</span> — {h.msg}
            {/* Un aviso que sólo señala el problema obliga a ir a buscarlo. El
                de consumibles trae al lado la herramienta que lo arregla. */}
            {/consumibles/i.test(h.msg) && laser ? (
              <div className="mt-2">
                <BotonCalculadorConsumibles maquina={laser}>
                  Calcularlo con piezas reales
                </BotonCalculadorConsumibles>
              </div>
            ) : null}
          </Aviso>
        ))}
        <p className="pt-1 text-[11px] text-tenue">
          Un dato mal cargado no rompe nada: hace que todos los precios salgan mal sin avisar.
        </p>
      </PanelCuerpo>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */

export function VistaPanel() {
  const config = usarEstado((s) => s.config);
  const materiales = usarEstado((s) => s.materiales);
  const laser = usarEstado((s) => s.laser());
  const sim = usarEstado((s) => s.simbolo());
  const col = usarColores();

  const { data: st, isLoading } = useQuery({
    queryKey: ['estadisticas'],
    queryFn: () => api.get('estadisticas'),
  });

  // Si la ruta del servidor falla, el cálculo se hace igual en el navegador:
  // es el mismo módulo. No hay razón para dejar el panel en blanco.
  const { data: estructuraApi } = useQuery({
    queryKey: ['estructura'],
    queryFn: () => api.get('estructura'),
    retry: false,
  });

  if (isLoading || !st || !config) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="panel-kort h-[132px] animate-pulse" />
        ))}
      </div>
    );
  }

  const est = estructuraApi || calcularEstructura(config.estructura);
  const eq = est.equilibrio || puntoEquilibrio(est, config.comercial?.margen ?? 45);
  const falta = eq.facturacionNecesaria - st.montoMes;
  const avanceEq = eq.facturacionNecesaria > 0
    ? Math.min(100, (st.montoMes / eq.facturacionNecesaria) * 100)
    : 0;

  const porMes = (st.porMes || []).map((m) => ({
    mes: m.mes.slice(5) + '/' + m.mes.slice(2, 4),
    Cotizado: m.monto,
    Aprobado: m.aprobado,
  }));
  const chispas = porMes.map((m) => ({ v: m.Cotizado }));

  const nombreMat = (id) => materiales.find((m) => m.id === id)?.nombre || id;
  const porMaterial = (st.porMaterial || []).map((m) => ({
    nombre: nombreMat(m.material_id),
    Facturado: m.facturado,
    kg: m.kg,
    piezas: m.piezas,
  }));

  const porCliente = (st.porCliente || []).filter((c) => c.facturado > 0).map((c) => ({
    nombre: c.cliente,
    Facturado: c.facturado,
    Utilidad: c.utilidad,
  }));

  const ch = laser ? calcularCostoHoraMaquina(laser, est) : null;
  const partesCosto = ch
    ? [
        ['Amortización', ch.amortizacion], ['Energía', ch.energia], ['Mantenimiento', ch.mantenimiento],
        ['Consumibles', ch.consumibles], ['Operario', ch.operario], ['Estructura', ch.estructura],
      ].filter(([, v]) => v > 0).map(([nombre, valor]) => ({ nombre, valor }))
    : [];

  return (
    <div className="space-y-4">
      {/* ---------------- Cabecera ---------------- */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-tinta">
            Hola, {config.empresa?.nombre || 'KORT'}
          </h1>
          <p className="mt-0.5 text-[13px] text-suave">
            Resumen de la actividad comercial y de producción
          </p>
        </div>
        <div className="flex gap-2">
          <Boton tono="corte" comoHijo>
            <Link to="/cotizador"><Plus />Nuevo presupuesto</Link>
          </Boton>
          <Boton comoHijo>
            <Link to="/presupuestos"><FileText />Ver presupuestos</Link>
          </Boton>
        </div>
      </div>

      {/* ---------------- Indicadores ---------------- */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi
          etiqueta="Presupuestos del mes" Icono={TrendingUp} tono="acero"
          valor={String(st.presupuestosMes)}
          nota={`${money(st.montoMes, sim, 0)} cotizados`}
          chispas={chispas}
        />
        <Kpi
          etiqueta="Aprobados" Icono={CheckCircle2} tono="verde"
          valor={String(st.aprobados)}
          nota={`${money(st.montoAprobado, sim, 0)} en cartera`}
        />
        <Kpi
          etiqueta="Tasa de conversión" Icono={Percent} tono="acero"
          valor={pct(st.tasaConversion, 0)}
          nota={`${st.presupuestos} presupuestos históricos`}
        />
        {falta > 0 ? (
          <Kpi
            etiqueta="Falta para el equilibrio" Icono={Target} tono="alerta"
            valor={money(falta, sim, 0)}
            nota={`de ${money(eq.facturacionNecesaria, sim, 0)} que necesitás por mes`}
          />
        ) : (
          <Kpi
            etiqueta="Equilibrio cubierto" Icono={Target} tono="verde"
            valor={money(-falta, sim, 0) + ' arriba'}
            nota={`necesitabas ${money(eq.facturacionNecesaria, sim, 0)}`}
          />
        )}
      </div>

      <RevisionDatos />

      {/* ---------------- Facturación + equilibrio ---------------- */}
      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <Panel>
          <PanelCab acciones={<span className="text-[11px] text-tenue">cotizado vs aprobado</span>}>
            <PanelTitulo>Facturación por mes</PanelTitulo>
          </PanelCab>
          <PanelCuerpo className="pt-5">
            {porMes.length ? (
              <div className="h-[264px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={porMes} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
                    <defs>
                      <linearGradient id="gCotizado" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#e4572e" stopOpacity={0.34} />
                        <stop offset="100%" stopColor="#e4572e" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke={col.grilla} vertical={false} />
                    <XAxis
                      dataKey="mes" tickLine={false} axisLine={false}
                      tick={{ fill: col.texto, fontSize: 11 }} dy={6}
                    />
                    <YAxis
                      tickLine={false} axisLine={false} width={54}
                      tick={{ fill: col.texto, fontSize: 11 }} tickFormatter={ejeMoneda}
                    />
                    <Tooltip
                      cursor={{ fill: col.grilla, opacity: 0.4 }}
                      content={(p) => <Globo {...p} etiqueta={p.label} sim={sim} />}
                    />
                    <Area
                      type="monotone" dataKey="Cotizado" stroke="#e4572e" strokeWidth={2}
                      fill="url(#gCotizado)"
                    />
                    <Bar dataKey="Aprobado" fill="#1f7a4d" radius={[5, 5, 0, 0]} maxBarSize={34} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <Vacio
                icono={<TrendingUp />}
                titulo="Todavía no hay presupuestos cargados"
                detalle="Cargá el primero desde el cotizador y este gráfico empieza a llenarse solo."
              >
                <Boton tono="corte" tam="sm" comoHijo>
                  <Link to="/cotizador"><Plus />Cotizar</Link>
                </Boton>
              </Vacio>
            )}
          </PanelCuerpo>
        </Panel>

        {/* Anillo del equilibrio: el dato que decide si el mes cierra */}
        <Panel>
          <PanelCab acciones={<Boton tono="fantasma" tam="sm" comoHijo><Link to="/costos">Ajustar</Link></Boton>}>
            <PanelTitulo>Punto de equilibrio</PanelTitulo>
          </PanelCab>
          <PanelCuerpo className="flex flex-col items-center">
            <div className="relative h-[168px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <RadialBarChart
                  data={[{ v: avanceEq }]} innerRadius="72%" outerRadius="100%"
                  startAngle={220} endAngle={-40} barSize={16}
                >
                  <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
                  <RadialBar
                    dataKey="v" cornerRadius={9}
                    fill={avanceEq >= 100 ? '#1f7a4d' : '#e4572e'}
                    background={{ fill: col.grilla }}
                  />
                </RadialBarChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pt-3 pointer-events-none">
                <span className="text-[28px] font-bold leading-none tabular text-tinta">
                  {num(avanceEq, 0)}%
                </span>
                <span className="mt-1 text-[10.5px] uppercase tracking-wider text-tenue">del mes cubierto</span>
              </div>
            </div>
            <dl className="mt-1 w-full space-y-1.5 text-[12.5px]">
              <div className="flex justify-between gap-3">
                <dt className="text-suave">Facturado este mes</dt>
                <dd className="tabular font-semibold">{money(st.montoMes, sim, 0)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-suave">Necesario por mes</dt>
                <dd className="tabular font-semibold">{money(eq.facturacionNecesaria, sim, 0)}</dd>
              </div>
              <div className="flex justify-between gap-3 border-t border-borde pt-1.5">
                <dt className="text-suave">{falta > 0 ? 'Falta' : 'Excedente'}</dt>
                <dd className={cn('tabular font-bold', falta > 0 ? 'text-corte-500' : 'text-chapa-500')}>
                  {money(Math.abs(falta), sim, 0)}
                </dd>
              </div>
            </dl>
          </PanelCuerpo>
        </Panel>
      </div>

      {/* ---------------- Costo por hora + material ---------------- */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel>
          <PanelCab acciones={<Boton tono="fantasma" tam="sm" comoHijo><Link to="/costos">Ajustar</Link></Boton>}>
            <Gauge className="size-3.5 text-corte-500" />
            <PanelTitulo>De qué está hecho el costo por hora</PanelTitulo>
          </PanelCab>
          <PanelCuerpo>
            {ch ? (
              <div className="flex flex-col sm:flex-row items-center gap-4">
                <div className="relative h-[192px] w-[192px] shrink-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={partesCosto} dataKey="valor" nameKey="nombre"
                        innerRadius="60%" outerRadius="100%" paddingAngle={2} stroke="none"
                      >
                        {partesCosto.map((_, i) => (
                          <Cell key={i} fill={PALETA[i % PALETA.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        content={(p) => (
                          <Globo
                            {...p} sim={sim}
                            pie={p.payload?.[0] ? `${num((p.payload[0].value / ch.total) * 100, 0)} % del costo horario` : null}
                          />
                        )}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                    <span className="text-lg font-bold tabular leading-none">{money(ch.total, sim, 0)}</span>
                    <span className="text-[10px] uppercase tracking-wider text-tenue mt-0.5">por hora</span>
                  </div>
                </div>
                <ul className="flex-1 w-full space-y-1">
                  {partesCosto.map((p, i) => (
                    <li key={p.nombre} className="flex items-center gap-2 text-[12.5px]">
                      <span className="size-2.5 rounded-sm shrink-0" style={{ background: PALETA[i % PALETA.length] }} />
                      <span className="text-suave flex-1 truncate">{p.nombre}</span>
                      <span className="tabular font-semibold">{money(p.valor, sim, 0)}</span>
                      <span className="tabular text-tenue w-10 text-right">
                        {num((p.valor / ch.total) * 100, 0)}%
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <Vacio icono={<Gauge />} titulo="No hay una máquina láser configurada" />
            )}
          </PanelCuerpo>
        </Panel>

        <Panel>
          <PanelCab acciones={<Boton tono="fantasma" tam="sm" comoHijo><Link to="/materiales">Precios</Link></Boton>}>
            <Layers className="size-3.5 text-acero-500" />
            <PanelTitulo>Facturación por material</PanelTitulo>
          </PanelCab>
          <PanelCuerpo>
            {porMaterial.length ? (
              <div className="h-[212px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={porMaterial} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke={col.grilla} horizontal={false} />
                    <XAxis
                      type="number" tickLine={false} axisLine={false}
                      tick={{ fill: col.texto, fontSize: 11 }} tickFormatter={ejeMoneda}
                    />
                    <YAxis
                      type="category" dataKey="nombre" width={128} tickLine={false} axisLine={false}
                      tick={{ fill: col.texto, fontSize: 11 }}
                    />
                    <Tooltip
                      cursor={{ fill: col.grilla, opacity: 0.4 }}
                      content={(p) => (
                        <Globo
                          {...p} etiqueta={p.label} sim={sim}
                          pie={p.payload?.[0] ? `${num(p.payload[0].payload.kg, 1)} kg · ${p.payload[0].payload.piezas} piezas` : null}
                        />
                      )}
                    />
                    <Bar dataKey="Facturado" radius={[0, 5, 5, 0]} maxBarSize={22}>
                      {porMaterial.map((_, i) => (
                        <Cell key={i} fill={PALETA[i % PALETA.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <Vacio
                icono={<Layers />} titulo="Se llena cuando apruebes presupuestos"
                detalle="Cada presupuesto aprobado registra los kg y las piezas por material."
              />
            )}
          </PanelCuerpo>
        </Panel>
      </div>

      {/* ---------------- Clientes + últimos ---------------- */}
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel>
          <PanelCab>
            <Users className="size-3.5 text-chapa-500" />
            <PanelTitulo>Clientes que más facturan</PanelTitulo>
          </PanelCab>
          <PanelCuerpo>
            {porCliente.length ? (
              <div className="h-[228px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={porCliente} layout="vertical" margin={{ top: 0, right: 12, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke={col.grilla} horizontal={false} />
                    <XAxis
                      type="number" tickLine={false} axisLine={false}
                      tick={{ fill: col.texto, fontSize: 11 }} tickFormatter={ejeMoneda}
                    />
                    <YAxis
                      type="category" dataKey="nombre" width={132} tickLine={false} axisLine={false}
                      tick={{ fill: col.texto, fontSize: 11 }}
                    />
                    <Tooltip
                      cursor={{ fill: col.grilla, opacity: 0.4 }}
                      content={(p) => <Globo {...p} etiqueta={p.label} sim={sim} />}
                    />
                    <Bar dataKey="Facturado" fill="#1b3a5c" radius={[0, 4, 4, 0]} maxBarSize={13} />
                    <Bar dataKey="Utilidad" fill="#1f7a4d" radius={[0, 4, 4, 0]} maxBarSize={13} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <Vacio icono={<Users />} titulo="Se llena cuando apruebes presupuestos" />
            )}
          </PanelCuerpo>
        </Panel>

        <Panel>
          <PanelCab
            acciones={
              <Boton tono="fantasma" tam="sm" comoHijo>
                <Link to="/presupuestos">Ver todos<ArrowRight /></Link>
              </Boton>
            }
          >
            <FileText className="size-3.5 text-acero-500" />
            <PanelTitulo>Últimos presupuestos</PanelTitulo>
          </PanelCab>
          <PanelCuerpo sinPad>
            {st.ultimos?.length ? (
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-borde">
                    {['N°', 'Cliente', 'Fecha', 'Estado', 'Total'].map((t, i) => (
                      <th
                        key={t}
                        className={cn(
                          'px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-tenue',
                          i === 4 ? 'text-right' : 'text-left'
                        )}
                      >
                        {t}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {st.ultimos.map((p) => (
                    <tr key={p.id} className="border-b border-borde last:border-0 hover:bg-panel-alto transition-colors">
                      <td className="px-4 py-2">
                        <Link to={`/cotizador?id=${p.id}`} className="font-mono text-xs text-corte-500 hover:underline">
                          {p.numero || '—'}
                        </Link>
                      </td>
                      <td className="px-4 py-2 truncate max-w-[180px]">{p.cliente || '—'}</td>
                      <td className="px-4 py-2 text-xs text-suave whitespace-nowrap">{fecha(p.fecha)}</td>
                      <td className="px-4 py-2"><InsigniaEstado mapa={ESTADOS_PRESUPUESTO} estado={p.estado} /></td>
                      <td className="px-4 py-2 text-right tabular font-semibold whitespace-nowrap">
                        {money(p.total, sim, 0)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Vacio icono={<FileText />} titulo="Sin movimientos" />
            )}
          </PanelCuerpo>
        </Panel>
      </div>
    </div>
  );
}
