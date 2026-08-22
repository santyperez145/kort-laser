import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Factory, TriangleAlert, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { usarEstado } from '@/lib/estado';
import { ESTADOS_OT, fecha } from '@/lib/formato';
import { Panel, PanelCab, PanelCuerpo, PanelTitulo, Vacio } from '@/componentes/ui/panel';
import { Boton } from '@/componentes/ui/boton';
import { Insignia, InsigniaEstado } from '@/componentes/ui/insignia';
import { Aviso, Barra } from '@/componentes/ui/varios';
import { VisorNesting } from '@/componentes/visores/VisorNesting';
import { resumenTaller } from '@core/produccion.js';

const FLUJO = ['pendiente', 'material', 'corte', 'plegado', 'terminado', 'entregado'];

function TarjetaOrden({ orden, activa, alElegir }) {
  const piezas = (orden.items || []).reduce((s, i) => s + Number(i.cantidad || 0), 0);
  return <button onClick={alElegir} className={`w-full border-b border-borde p-3 text-left transition-colors ${activa ? 'bg-corte-500/10' : 'hover:bg-panel-alto'}`}>
    <div className="flex items-center justify-between gap-2"><b className="text-sm">OT {orden.numero}</b><InsigniaEstado mapa={ESTADOS_OT} estado={orden.estado} /></div>
    <div className="mt-1 truncate text-xs text-suave">{orden.cliente?.nombre || 'Sin cliente'} · {piezas} piezas</div>
    <div className="mt-1 text-[11px] text-tenue">Entrega {fecha(orden.fechaEntrega)}</div>
  </button>;
}

function Clasificador({ orden, guardarEvento }) {
  const [programaId, setProgramaId] = useState(orden.planProduccion?.programas?.[0]?.id || '');
  const [chapa, setChapa] = useState(0);
  useEffect(() => { setProgramaId(orden.planProduccion?.programas?.[0]?.id || ''); setChapa(0); }, [orden.id]);
  const programas = orden.planProduccion?.programas || [];
  const programa = programas.find((p) => p.id === programaId) || programas[0];
  const estados = orden.taller?.corte?.programas?.[programa?.id]?.piezas || {};
  const resumen = resumenTaller(orden);
  if (!programa) return <Aviso nivel="aviso">Esta OT es anterior al plan visual. Podés moverla de etapa, pero no se inventa un nesting recalculado: reabrí y guardá el presupuesto si necesitás clasificar pieza por pieza.</Aviso>;
  const alPieza = (_p, indice, clave) => {
    const actual = estados[clave]?.estado || 'pendiente';
    const estado = actual === 'pendiente' ? 'retirada' : actual === 'retirada' ? 'rechazada' : 'pendiente';
    guardarEvento({ tipo: 'clasificar', programaId: programa.id, chapaIndice: chapa, piezaIndice: indice, estado });
  };
  return <div className="space-y-3">
    <div className="flex flex-wrap gap-2">
      {programas.map((p, i) => <Boton key={p.id} tam="sm" tono={p.id === programa.id ? 'corte' : 'neutro'} onClick={() => { setProgramaId(p.id); setChapa(0); }}>Programa {i + 1}</Boton>)}
      {(programa.layout || []).map((_, i) => <Boton key={i} tam="sm" tono={i === chapa ? 'acero' : 'fantasma'} onClick={() => setChapa(i)}>Chapa {i + 1}</Boton>)}
    </div>
    <div className="grid gap-3 sm:grid-cols-4">
      <Insignia tono="gris">{resumen.pendientes} pendientes</Insignia><Insignia tono="verde">{resumen.retiradas} retiradas</Insignia><Insignia tono="rojo">{resumen.rechazadas} rechazadas</Insignia><Insignia tono="amarillo">{resumen.reposiciones} a recortar</Insignia>
    </div>
    <VisorNesting nesting={{ layout: programa.layout }} indiceChapa={chapa} estados={estados} alPieza={alPieza} alto={440} />
    <p className="text-xs text-tenue">Tocá una pieza: pendiente → retirada → rechazada → pendiente. Los rechazos entran automáticamente en la cola de recorte.</p>
  </div>;
}

function Plegados({ orden, guardarEvento }) {
  const ops = (orden.planProduccion?.operaciones || []).filter((x) => x.plegado);
  if (!ops.length) return null;
  return <Panel><PanelCab><Wrench className="size-4 text-corte-500"/><PanelTitulo>Plegado y primera pieza</PanelTitulo></PanelCab><PanelCuerpo className="space-y-3">{ops.map((op) => {
    const e = orden.taller?.plegado?.items?.[op.itemIndice] || {};
    const hechas = e.cantidadHecha || 0;
    return <div key={op.itemIndice} className="rounded-xl border border-borde p-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><b className="text-sm">{op.nombre}</b><span className="text-xs text-suave">V{op.plegado.matrizV || '—'} · {op.plegado.pliegues} pliegues · {op.plegado.angulo}°</span></div>
      <Barra valor={op.cantidad ? hechas / op.cantidad * 100 : 0} className="my-3" tono="verde" />
      <div className="flex flex-wrap items-center gap-2">
        <Boton tam="sm" tono={e.herramientaConfirmada ? 'verde' : 'neutro'} onClick={() => guardarEvento({ tipo:'avance-plegado', itemIndice:op.itemIndice, cantidadHecha:hechas, herramientaConfirmada:!e.herramientaConfirmada, primeraPiezaAprobada:!!e.primeraPiezaAprobada })}><Wrench/> Herramienta</Boton>
        <Boton tam="sm" tono={e.primeraPiezaAprobada ? 'verde' : 'neutro'} onClick={() => guardarEvento({ tipo:'avance-plegado', itemIndice:op.itemIndice, cantidadHecha:hechas, herramientaConfirmada:!!e.herramientaConfirmada, primeraPiezaAprobada:!e.primeraPiezaAprobada })}><Check/> Primera pieza</Boton>
        <Boton tam="sm" disabled={hechas <= 0} onClick={() => guardarEvento({ tipo:'avance-plegado', itemIndice:op.itemIndice, cantidadHecha:hechas-1, herramientaConfirmada:!!e.herramientaConfirmada, primeraPiezaAprobada:!!e.primeraPiezaAprobada })}>−</Boton>
        <b className="min-w-16 text-center text-sm">{hechas} / {op.cantidad}</b>
        <Boton tam="sm" tono="corte" disabled={hechas >= op.cantidad || !e.primeraPiezaAprobada} onClick={() => guardarEvento({ tipo:'avance-plegado', itemIndice:op.itemIndice, cantidadHecha:hechas+1, herramientaConfirmada:!!e.herramientaConfirmada, primeraPiezaAprobada:!!e.primeraPiezaAprobada })}>+ pieza</Boton>
      </div>
    </div>;
  })}</PanelCuerpo></Panel>;
}

export function VistaProduccion() {
  const qc = useQueryClient();
  const recargarCalibracion = usarEstado((s) => s.recargarCalibracion);
  const { data: ordenes = [], isLoading } = useQuery({ queryKey:['ordenes'], queryFn:() => api.get('ordenes'), refetchInterval:15000 });
  const [seleccion, setSeleccion] = useState(null);
  const abiertas = useMemo(() => ordenes.filter((o) => !['entregado','cancelado'].includes(o.estado)), [ordenes]);
  const orden = ordenes.find((o) => o.id === seleccion) || abiertas[0] || ordenes[0];
  useEffect(() => { if (!seleccion && orden) setSeleccion(orden.id); }, [seleccion, orden]);
  const mut = useMutation({ mutationFn:({ ruta, cuerpo }) => api.put(ruta, cuerpo), onSuccess:async () => { await qc.invalidateQueries({queryKey:['ordenes']}); recargarCalibracion().catch(()=>{}); }, onError:(e)=>toast.error(e.message) });
  const evento = (cuerpo) => mut.mutate({ ruta:`ordenes/${orden.id}/taller`, cuerpo });
  const mover = (estado) => {
    const cuerpo = { estado };
    if (estado === 'terminado' && !orden.real?.segundos) {
      const entrada = window.prompt('Tiempo real total de esta OT, en minutos:');
      if (entrada == null) return;
      const minutos = Number(String(entrada).replace(',', '.'));
      if (!(minutos > 0)) return toast.error('Ingresá un tiempo real mayor que cero.');
      cuerpo.real = { segundos: Math.round(minutos * 60), fecha: new Date().toISOString(), nota: '' };
    }
    mut.mutate({ ruta:`ordenes/${orden.id}`, cuerpo });
    if (estado === 'entregado' && orden.presupuestoId) {
      api.put(`presupuestos/${orden.presupuestoId}`, { estado:'facturado' }).catch((e)=>toast.error('La OT se entregó, pero no se pudo facturar el presupuesto: '+e.message));
    }
  };
  if (isLoading) return <div className="p-6 text-sm text-suave">Cargando producción…</div>;
  return <div className="grid min-h-[calc(100vh-110px)] gap-4 p-3 lg:grid-cols-[310px_minmax(0,1fr)] lg:p-4">
    <Panel><PanelCab><Factory className="size-4 text-corte-500"/><PanelTitulo>Cola de taller · {abiertas.length} activas</PanelTitulo></PanelCab><PanelCuerpo sinPad>{ordenes.length ? ordenes.map((o)=><TarjetaOrden key={o.id} orden={o} activa={o.id===orden?.id} alElegir={()=>setSeleccion(o.id)}/>) : <Vacio titulo="No hay órdenes" detalle="Aprobá un presupuesto para crear la primera OT."/>}</PanelCuerpo></Panel>
    {orden ? <main className="min-w-0 space-y-4">
      <Panel><PanelCuerpo><div className="flex flex-wrap items-start justify-between gap-3"><div><div className="flex items-center gap-2"><h1 className="text-xl font-bold">OT {orden.numero}</h1><InsigniaEstado mapa={ESTADOS_OT} estado={orden.estado}/></div><p className="text-sm text-suave">{orden.cliente?.nombre || 'Sin cliente'} · entrega {fecha(orden.fechaEntrega)}</p></div><div className="flex flex-wrap gap-1">{FLUJO.map((e)=><Boton key={e} tam="sm" tono={e===orden.estado?'corte':'neutro'} onClick={()=>mover(e)}>{ESTADOS_OT[e].txt}</Boton>)}</div></div></PanelCuerpo></Panel>
      <Panel><PanelCab><PanelTitulo>Clasificación visual de corte</PanelTitulo></PanelCab><PanelCuerpo><Clasificador orden={orden} guardarEvento={evento}/></PanelCuerpo></Panel>
      {resumenTaller(orden).reposiciones > 0 && <Aviso nivel="aviso"><TriangleAlert className="inline size-4"/> Hay {resumenTaller(orden).reposiciones} pieza(s) rechazadas. La cola de recorte se mantiene hasta reclasificarlas.</Aviso>}
      <Plegados orden={orden} guardarEvento={evento}/>
    </main> : <Vacio icono={<Factory/>} titulo="No hay una OT para mostrar"/>}
  </div>;
}
