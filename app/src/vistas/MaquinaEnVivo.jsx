/** Tablero MES de sólo lectura: nunca envía órdenes ni movimientos al CNC. */

import { useQuery } from '@tanstack/react-query';
import {
  Area, AreaChart, CartesianGrid, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Activity, AlertTriangle, Cpu, Gauge, PlayCircle, Radio, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { Panel, PanelCab, PanelTitulo, PanelCuerpo, Vacio } from '@/componentes/ui/panel';
import { Aviso } from '@/componentes/ui/varios';
import { Insignia } from '@/componentes/ui/insignia';
import { num, pct } from '@/lib/formato';

const ESTADO = {
  apagada: ['Apagada', 'gris'], inactiva: ['En espera', 'gris'], preparando: ['Preparando', 'amarillo'],
  produciendo: ['Produciendo', 'verde'], pausada: ['Pausada', 'amarillo'], alarma: ['Alarma', 'rojo'],
};

function hora(iso) {
  return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function duracion(seg) {
  if (!Number.isFinite(seg)) return '—';
  const h = Math.floor(seg / 3600);
  const m = Math.floor((seg % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}

function Kpi({ titulo, valor, detalle, Icono }) {
  return <Panel><PanelCuerpo><div className="flex items-start justify-between"><div><div className="text-[10px] font-bold uppercase tracking-wide text-tenue">{titulo}</div><div className="mt-1 text-2xl font-bold tabular-nums text-tinta">{valor}</div><div className="mt-1 text-[11px] text-suave">{detalle}</div></div><Icono className="size-5 text-corte-500" /></div></PanelCuerpo></Panel>;
}

export function VistaMaquinaEnVivo() {
  const { data, isError, error } = useQuery({
    queryKey: ['telemetria', 'laser-3kw'],
    queryFn: () => api.get('telemetria?maquina=laser-3kw&horas=8'),
    refetchInterval: 3000,
    staleTime: 1000,
  });
  const muestras = (data?.muestras || []).map((m) => ({ ...m, hora: hora(m.fecha) }));
  const r = data?.resumen;
  const u = r?.ultima;
  const [estadoTexto, estadoTono] = ESTADO[u?.estado] || ['Sin datos', 'gris'];

  return <div className="space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-xl font-bold tracking-tight">Máquina en vivo</h1><p className="text-[13px] text-suave">Estado, programa y comportamiento del láser de 3 kW</p></div>
      <div className="flex items-center gap-2"><Insignia tono={r?.conectada ? 'verde' : 'rojo'}><Radio className="mr-1 inline size-3" />{r?.conectada ? 'Datos en vivo' : 'Sin señal'}</Insignia><Insignia tono={estadoTono}>{estadoTexto}</Insignia></div>
    </div>

    {isError ? <Aviso nivel="error">No se pudo leer la máquina: {error.message}</Aviso> : null}
    {!muestras.length ? <Aviso nivel="info"><strong>Pasarela preparada, todavía sin controlador conectado.</strong> Corré <code>npm run simular-maquina</code> para validar el tablero. Para datos reales hay que relevar marca, modelo de CNC y si expone OPC UA, MTConnect o API del fabricante.</Aviso> : null}
    <Aviso nivel="info"><ShieldCheck className="mr-1 inline size-3.5" />Esta conexión es de sólo lectura. KORT no envía código, movimientos ni cambios de parámetros al CNC.</Aviso>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Kpi titulo="Estado actual" valor={estadoTexto} detalle={r?.conectada ? `última muestra hace ${num(r.edadSeg, 0)} s` : 'sin telemetría reciente'} Icono={Activity} />
      <Kpi titulo="Programa" valor={u?.programa || '—'} detalle={u?.ordenId ? `OT ${u.ordenId}` : 'sin OT asociada'} Icono={PlayCircle} />
      <Kpi titulo="Avance" valor={u ? pct(u.progreso, 0) : '—'} detalle={u?.gas ? `gas ${u.gas}` : 'sin dato de proceso'} Icono={Gauge} />
      <Kpi titulo="Disponibilidad observada" valor={r?.disponibilidad == null ? '—' : pct(r.disponibilidad * 100, 1)} detalle="produciendo ÷ tiempo conectado planificado" Icono={Cpu} />
    </div>

    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Panel>
        <PanelCab><Activity className="size-3.5 text-corte-500" /><PanelTitulo>Proceso — últimas 8 horas</PanelTitulo></PanelCab>
        <PanelCuerpo>
          {muestras.length ? <div className="h-[330px]"><ResponsiveContainer width="100%" height="100%"><AreaChart data={muestras} margin={{ top: 10, right: 18, bottom: 0, left: 0 }}>
            <defs><linearGradient id="potencia-maquina" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#e4572e" stopOpacity=".45"/><stop offset="1" stopColor="#e4572e" stopOpacity=".02"/></linearGradient></defs>
            <CartesianGrid strokeDasharray="3 3" opacity={0.18}/><XAxis dataKey="hora" minTickGap={45} tick={{ fontSize: 10 }}/><YAxis yAxisId="pct" domain={[0, 100]} tick={{ fontSize: 10 }} unit=" %"/><YAxis yAxisId="vel" orientation="right" tick={{ fontSize: 10 }}/>
            <Tooltip labelFormatter={(x) => `Hora ${x}`} formatter={(v, nombre) => [num(v, 0), nombre]}/>
            <Area yAxisId="pct" type="monotone" dataKey="potenciaPct" name="Potencia %" stroke="#e4572e" fill="url(#potencia-maquina)" isAnimationActive={false}/>
            <Line yAxisId="pct" type="monotone" dataKey="progreso" name="Avance %" stroke="#3da56b" dot={false} strokeWidth={2} isAnimationActive={false}/>
            <Line yAxisId="vel" type="monotone" dataKey="velocidadMMMin" name="Velocidad mm/min" stroke="#4d83c3" dot={false} strokeWidth={1.5} isAnimationActive={false}/>
          </AreaChart></ResponsiveContainer></div> : <Vacio icono={<Activity />} titulo="Esperando muestras" detalle="El gráfico aparece cuando la pasarela recibe telemetría." />}
        </PanelCuerpo>
      </Panel>

      <Panel>
        <PanelCab><AlertTriangle className="size-3.5 text-alerta-500" /><PanelTitulo>Alarmas recientes</PanelTitulo></PanelCab>
        <PanelCuerpo sinPad>
          {r?.alarmas?.length ? <div>{r.alarmas.map((a, i) => <div key={`${a.fecha}-${i}`} className="border-b border-borde p-3 last:border-0"><div className="flex justify-between gap-2"><Insignia tono="rojo">{a.estado}</Insignia><span className="text-[10px] text-tenue">{hora(a.fecha)}</span></div><div className="mt-1 text-[12px] text-tinta">{a.alarma || 'Parada informada por el controlador'}</div><div className="mt-1 text-[10px] text-suave">{a.programa || 'sin programa'}</div></div>)}</div> : <Vacio icono={<ShieldCheck />} titulo="Sin alarmas en el período" detalle="Las alarmas del controlador quedan trazadas con fecha y programa." />}
        </PanelCuerpo>
      </Panel>
    </div>

    {r ? <Panel><PanelCab><PanelTitulo>Tiempo observado por estado</PanelTitulo></PanelCab><PanelCuerpo><div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-6">{Object.entries(r.segundosPorEstado || {}).map(([estado, seg]) => <div key={estado} className="rounded-lg border border-borde bg-panel-alto p-3"><div className="text-[10px] uppercase text-tenue">{ESTADO[estado]?.[0] || estado}</div><div className="mt-1 font-semibold tabular-nums">{duracion(seg)}</div></div>)}</div><p className="mt-3 text-[11px] text-suave">No se muestra OEE hasta disponer de ciclo ideal y piezas buenas/rechazadas confiables. La disponibilidad sola no se disfraza de OEE.</p></PanelCuerpo></Panel> : null}
  </div>;
}
