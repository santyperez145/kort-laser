import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ClipboardCheck, Factory, Layers3, Plus, TriangleAlert, Wrench, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { usarEstado } from '@/lib/estado';
import { ESTADOS_OT, fecha } from '@/lib/formato';
import { Panel, PanelCab, PanelCuerpo, PanelTitulo, Vacio } from '@/componentes/ui/panel';
import { Boton } from '@/componentes/ui/boton';
import { Insignia, InsigniaEstado } from '@/componentes/ui/insignia';
import { Aviso, Barra } from '@/componentes/ui/varios';
import { VisorNesting } from '@/componentes/visores/VisorNesting';
import { Campo, Entrada, Selector, Opcion } from '@/componentes/ui/campos';
import { resumenTaller, retazoSeguroDePrograma } from '@core/produccion.js';
import { ACCIONES_NO_CONFORMIDAD, CAUSAS_NO_CONFORMIDAD, resumenCalidad } from '@core/calidad.js';

const FLUJO = ['pendiente', 'material', 'corte', 'plegado', 'terminado', 'entregado'];

function TarjetaOrden({ orden, activa, alElegir }) {
  const piezas = (orden.items || []).reduce((s, i) => s + Number(i.cantidad || 0), 0);
  return <button onClick={alElegir} className={`w-full border-b border-borde p-3 text-left transition-colors ${activa ? 'bg-corte-500/10' : 'hover:bg-panel-alto'}`}>
    <div className="flex items-center justify-between gap-2"><b className="text-sm">OT {orden.numero}</b><InsigniaEstado mapa={ESTADOS_OT} estado={orden.estado} /></div>
    <div className="mt-1 truncate text-xs text-suave">{orden.cliente?.nombre || 'Sin cliente'} · {piezas} piezas</div>
    <div className="mt-1 text-[11px] text-tenue">Entrega {fecha(orden.fechaEntrega)}</div>
  </button>;
}

function ConfirmacionChapa({ orden, programa, chapa, guardarEvento }) {
  const layout = programa.layout[chapa];
  const confirmada = orden.taller?.corte?.programas?.[programa.id]?.chapas?.[chapa];
  const [form, setForm] = useState({ origen: programa.retazoId ? 'retazo' : 'chapa-nueva', lote:'', ubicacion:'', w:layout.w, h:layout.h, guardarRetazo:true });
  useEffect(() => setForm({ origen: programa.retazoId ? 'retazo' : 'chapa-nueva', lote:programa.retazoId || '', ubicacion:'', w:layout.w, h:layout.h, guardarRetazo:true }), [programa.id, chapa, layout.w, layout.h, programa.retazoId]);
  let sobrante;
  try { sobrante = retazoSeguroDePrograma(programa, chapa, form, { separacion:5 }); } catch (e) { sobrante = { util:false, motivo:e.message, w:0, h:0, areaM2:0 }; }
  if (confirmada) return <Aviso nivel="info"><b>Chapa física confirmada.</b> {confirmada.origen === 'chapa-nueva' ? 'Chapa nueva' : confirmada.origen === 'retazo' ? 'Retazo del stock' : 'Material del cliente'} · {confirmada.medidas.w} × {confirmada.medidas.h} mm{confirmada.lote ? ` · lote ${confirmada.lote}` : ''}. {confirmada.guardarRetazo ? `Se dio de alta una franja de ${Math.round(confirmada.retazo.w)} × ${Math.round(confirmada.retazo.h)} mm.` : 'Sin retazo reutilizable.'}</Aviso>;
  return <div className="rounded-xl border border-borde bg-panel-alto/35 p-3">
    <div className="mb-3 flex items-center gap-2"><Layers3 className="size-4 text-corte-500"/><b className="text-sm">Confirmar chapa física antes de cortar</b></div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <Campo etiqueta="Origen"><Selector valor={form.origen} alCambiar={(v)=>setForm({...form,origen:v})}><Opcion valor="chapa-nueva">Chapa nueva</Opcion><Opcion valor="retazo">Retazo del stock</Opcion><Opcion valor="cliente">Material del cliente</Opcion></Selector></Campo>
      <Campo etiqueta="Ancho real"><Entrada type="number" min={layout.w} unidad="mm" value={form.w} onChange={(e)=>setForm({...form,w:Number(e.target.value)})}/></Campo>
      <Campo etiqueta="Alto real"><Entrada type="number" min={layout.h} unidad="mm" value={form.h} onChange={(e)=>setForm({...form,h:Number(e.target.value)})}/></Campo>
      <Campo etiqueta="Lote / colada"><Entrada value={form.lote} onChange={(e)=>setForm({...form,lote:e.target.value})} placeholder="Opcional"/></Campo>
      <Campo etiqueta="Ubicación retazo"><Entrada value={form.ubicacion} onChange={(e)=>setForm({...form,ubicacion:e.target.value})} placeholder="Ej. Rack A"/></Campo>
    </div>
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
      <label className="flex items-center gap-2 text-xs text-suave"><input type="checkbox" checked={form.guardarRetazo && sobrante.util} disabled={!sobrante.util || form.origen === 'cliente'} onChange={(e)=>setForm({...form,guardarRetazo:e.target.checked})}/>{sobrante.util ? `Guardar franja intacta ${Math.round(sobrante.w)} × ${Math.round(sobrante.h)} mm (${sobrante.areaM2.toFixed(2)} m²)` : sobrante.motivo}</label>
      <Boton tono="corte" tam="sm" disabled={!sobrante.util && (form.w < layout.w || form.h < layout.h)} onClick={()=>guardarEvento({ tipo:'confirmar-chapa', programaId:programa.id, chapaIndice:chapa, ...form, guardarRetazo:form.origen !== 'cliente' && form.guardarRetazo })}><Check/> Confirmar chapa</Boton>
    </div>
  </div>;
}

function Clasificador({ orden, guardarEvento, guardarCalidad }) {
  const [programaId, setProgramaId] = useState(orden.planProduccion?.programas?.[0]?.id || '');
  const [chapa, setChapa] = useState(0);
  const [rechazo, setRechazo] = useState(null);
  useEffect(() => { setProgramaId(orden.planProduccion?.programas?.[0]?.id || ''); setChapa(0); }, [orden.id]);
  const programas = orden.planProduccion?.programas || [];
  const programa = programas.find((p) => p.id === programaId) || programas[0];
  const estados = orden.taller?.corte?.programas?.[programa?.id]?.piezas || {};
  const resumen = resumenTaller(orden);
  if (!programa) return <Aviso nivel="aviso">Esta OT es anterior al plan visual. Podés moverla de etapa, pero no se inventa un nesting recalculado: reabrí y guardá el presupuesto si necesitás clasificar pieza por pieza.</Aviso>;
  const alPieza = (_p, indice, clave) => {
    const actual = estados[clave]?.estado || 'pendiente';
    if (actual === 'retirada') {
      const pieza = programa.layout[chapa]?.piezas?.[indice];
      const item = programa.items?.find((x)=>x.idEnLayout === pieza?.id) || programa.items?.[0];
      setRechazo({ programaId:programa.id, chapaIndice:chapa, piezaIndice:indice,
        itemIndice:item?.itemIndice ?? 0, causa:'dimension', accion:'recortar', detalle:'' });
      return;
    }
    guardarEvento({ tipo:'clasificar', programaId:programa.id, chapaIndice:chapa, piezaIndice:indice,
      estado:actual === 'rechazada' ? 'pendiente' : 'retirada' });
  };
  const confirmarRechazo = () => {
    guardarCalidad({ tipo:'abrir-no-conformidad', id:`nc-${Date.now()}`, ...rechazo, cantidad:1 });
    setRechazo(null);
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
    {rechazo && <div className="rounded-xl border border-peligro-500/40 bg-peligro-500/5 p-3">
      <div className="flex items-center justify-between gap-2"><b className="text-sm">Rechazar pieza · chapa {rechazo.chapaIndice+1}, posición {rechazo.piezaIndice+1}</b><Boton tam="iconoSm" tono="fantasma" onClick={()=>setRechazo(null)}><X/></Boton></div>
      <p className="mt-1 text-xs text-tenue">La causa queda unida a esta OT, programa, chapa y posición del nesting.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3"><Campo etiqueta="Causa"><Selector valor={rechazo.causa} alCambiar={(v)=>setRechazo({...rechazo,causa:v})}>{CAUSAS_NO_CONFORMIDAD.map(([id,txt])=><Opcion key={id} valor={id}>{txt}</Opcion>)}</Selector></Campo><Campo etiqueta="Acción"><Selector valor={rechazo.accion} alCambiar={(v)=>setRechazo({...rechazo,accion:v})}>{ACCIONES_NO_CONFORMIDAD.map(([id,txt])=><Opcion key={id} valor={id}>{txt}</Opcion>)}</Selector></Campo><Campo etiqueta="Detalle"><Entrada value={rechazo.detalle} onChange={(e)=>setRechazo({...rechazo,detalle:e.target.value})} placeholder="Defecto observado"/></Campo></div>
      <div className="mt-3 flex justify-end"><Boton tono="peligro" onClick={confirmarRechazo}><TriangleAlert/> Confirmar rechazo</Boton></div>
    </div>}
    <ConfirmacionChapa orden={orden} programa={programa} chapa={chapa} guardarEvento={guardarEvento}/>
    <p className="text-xs text-tenue">Tocá una pieza para retirarla. Si la volvés a tocar, el sistema exige causa y acción antes de rechazarla.</p>
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
      {op.plegado.secuencia?.length ? <div className="mb-3 flex gap-2 overflow-x-auto pb-1">{op.plegado.secuencia.map((s)=><div key={s.paso} className="min-w-36 rounded-lg border border-borde bg-panel-alto p-2"><span className="text-[10px] font-bold uppercase text-corte-500">Paso {s.paso}</span><div className="text-xs font-semibold">Línea {s.pliegue} · {s.grados}°</div><div className="text-[11px] text-tenue">{s.sentido === 'arriba' ? '↑ plegar arriba' : '↓ plegar abajo'} · ala {Math.round(s.voladizo)} mm</div></div>)}</div> : <p className="mb-3 text-xs text-tenue">Esta OT no trae una secuencia geométrica guardada; verificá el orden con el plano antes de plegar.</p>}
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

function Calidad({ orden, guardarEvento }) {
  const operaciones = orden.planProduccion?.operaciones || [];
  const [itemIndice, setItemIndice] = useState(operaciones[0]?.itemIndice ?? 0);
  const [cota, setCota] = useState({ nombre:'Ancho', nominal:'', toleranciaMas:'0.5', toleranciaMenos:'0.5', unidad:'mm' });
  const [valores, setValores] = useState({});
  const [nc, setNc] = useState({ causa:'dimension', accion:'recortar', cantidad:1, detalle:'' });
  const [evidencia, setEvidencia] = useState(null);
  useEffect(() => { setItemIndice(operaciones[0]?.itemIndice ?? 0); }, [orden.id]);
  const op = operaciones.find((x) => x.itemIndice === itemIndice) || operaciones[0];
  const estado = orden.calidad?.items?.[op?.itemIndice] || {};
  const caracteristicas = Object.values(estado.caracteristicas || {});
  const noConformidades = Object.values(orden.calidad?.noConformidades || {}).filter((x) => x.itemIndice === op?.itemIndice);
  const resumen = resumenCalidad(orden);
  if (!op) return null;
  const agregarCota = () => {
    guardarEvento({ tipo:'definir-caracteristica', itemIndice:op.itemIndice, id:`cota-${Date.now()}`, ...cota });
    setCota({ ...cota, nombre:'', nominal:'' });
  };
  const registrarNc = async () => {
    try {
      let ruta = '';
      if (evidencia) {
        if (evidencia.size > 8 * 1024 * 1024) throw new Error('La foto supera 8 MB. Reducila antes de guardarla.');
        if (!['image/jpeg','image/png','image/webp'].includes(evidencia.type)) throw new Error('La evidencia debe ser JPG, PNG o WebP.');
        const extension = evidencia.name.split('.').pop()?.toLowerCase() || 'jpg';
        const guardada = await api.guardarArchivo(`NC-${Date.now()}.${extension}`, new Uint8Array(await evidencia.arrayBuffer()), `OT-${orden.numero || orden.id}-calidad`);
        ruta = guardada.ruta;
      }
      guardarEvento({tipo:'abrir-no-conformidad',itemIndice:op.itemIndice,...nc,id:`nc-${Date.now()}`,evidencia:ruta});
      setEvidencia(null);
    } catch (e) { toast.error(e.message); }
  };
  return <Panel><PanelCab><ClipboardCheck className="size-4 text-corte-500"/><PanelTitulo>Calidad dimensional y retrabajo</PanelTitulo></PanelCab><PanelCuerpo className="space-y-4">
    <div className="flex flex-wrap gap-2">{operaciones.map((x)=><Boton key={x.itemIndice} tam="sm" tono={x.itemIndice===op.itemIndice?'corte':'neutro'} onClick={()=>setItemIndice(x.itemIndice)}>{x.nombre}</Boton>)}</div>
    <div className="grid gap-2 sm:grid-cols-4"><Insignia tono="gris">{resumen.itemsInspeccionados} inspeccionados</Insignia><Insignia tono="verde">{resumen.lotesLiberados} liberados</Insignia><Insignia tono="rojo">{resumen.noConformidadesAbiertas} NC abiertas</Insignia><Insignia tono="amarillo">{resumen.reposiciones} a recortar</Insignia></div>
    <Aviso nivel="info"><b>La tolerancia sale del plano, no de una suposición del sistema.</b> Cargá nominal y desvíos permitidos; los límites y la conformidad se calculan automáticamente. Los bordes también cuentan como conformes.</Aviso>
    <div className="rounded-xl border border-borde p-3">
      <b className="text-sm">Plan de inspección · primera pieza</b>
      {op.geometria && <p className="mt-1 text-xs text-tenue">Referencia cotizada: {Math.round(op.geometria.ancho)} × {Math.round(op.geometria.alto)} × {op.geometria.espesor} mm. Verificá contra el plano vigente.</p>}
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Campo etiqueta="Característica"><Entrada value={cota.nombre} onChange={(e)=>setCota({...cota,nombre:e.target.value})} placeholder="Ancho, Ø agujero…"/></Campo>
        <Campo etiqueta="Nominal"><Entrada type="number" value={cota.nominal} unidad={cota.unidad} onChange={(e)=>setCota({...cota,nominal:e.target.value})}/></Campo>
        <Campo etiqueta="Tolerancia +"><Entrada type="number" min="0" step="0.01" value={cota.toleranciaMas} unidad={cota.unidad} onChange={(e)=>setCota({...cota,toleranciaMas:e.target.value})}/></Campo>
        <Campo etiqueta="Tolerancia −"><Entrada type="number" min="0" step="0.01" value={cota.toleranciaMenos} unidad={cota.unidad} onChange={(e)=>setCota({...cota,toleranciaMenos:e.target.value})}/></Campo>
        <Campo etiqueta="Unidad"><Selector valor={cota.unidad} alCambiar={(v)=>setCota({...cota,unidad:v})}><Opcion valor="mm">mm</Opcion><Opcion valor="°">grados</Opcion></Selector></Campo>
        <div className="flex items-end"><Boton tono="corte" className="w-full" disabled={!cota.nombre || cota.nominal===''} onClick={agregarCota}><Plus/> Agregar</Boton></div>
      </div>
      <div className="mt-3 space-y-2">{caracteristicas.map((c)=>{
        const ultima = [...(estado.mediciones || [])].reverse().find((m)=>m.caracteristicaId===c.id);
        return <div key={c.id} className="grid items-center gap-2 rounded-lg bg-panel-alto p-2 sm:grid-cols-[minmax(150px,1fr)_180px_auto]">
          <div><b className="text-xs">{c.nombre}: {c.nominal} {c.unidad}</b><div className="text-[11px] text-tenue">Aceptable: {c.nominal-c.toleranciaMenos} a {c.nominal+c.toleranciaMas} {c.unidad}</div></div>
          <Entrada type="number" step="0.01" unidad={c.unidad} value={valores[c.id] ?? ''} onChange={(e)=>setValores({...valores,[c.id]:e.target.value})} placeholder="Medición real"/>
          <div className="flex items-center gap-2"><Boton tam="sm" disabled={valores[c.id]==null || valores[c.id]===''} onClick={()=>guardarEvento({tipo:'registrar-medicion',itemIndice:op.itemIndice,caracteristicaId:c.id,valor:valores[c.id]})}>Medir</Boton>{ultima && <Insignia tono={ultima.estado==='conforme'?'verde':'rojo'}>{ultima.valor} · {ultima.estado==='conforme'?'conforme':'fuera'}</Insignia>}</div>
        </div>;
      })}{!caracteristicas.length && <p className="text-xs text-tenue">Todavía no hay cotas de control. Copialas del plano aprobado.</p>}</div>
      <div className="mt-3 flex items-center justify-between gap-3"><span className="text-xs text-suave">Estado: <b>{estado.liberacion?.estado==='liberado'?'lote liberado':'pendiente de medición'}</b></span><Boton tono={estado.liberacion?.estado==='liberado'?'verde':'corte'} disabled={estado.liberacion?.estado==='liberado'} onClick={()=>guardarEvento({tipo:'liberar-lote',itemIndice:op.itemIndice})}><Check/> Liberar primera pieza</Boton></div>
    </div>
    <div className="rounded-xl border border-borde p-3">
      <b className="text-sm">No conformidad y acción</b>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Campo etiqueta="Causa"><Selector valor={nc.causa} alCambiar={(v)=>setNc({...nc,causa:v})}>{CAUSAS_NO_CONFORMIDAD.map(([id,txt])=><Opcion key={id} valor={id}>{txt}</Opcion>)}</Selector></Campo>
        <Campo etiqueta="Acción"><Selector valor={nc.accion} alCambiar={(v)=>setNc({...nc,accion:v})}>{ACCIONES_NO_CONFORMIDAD.map(([id,txt])=><Opcion key={id} valor={id}>{txt}</Opcion>)}</Selector></Campo>
        <Campo etiqueta="Cantidad afectada"><Entrada type="number" min="1" max={op.cantidad} value={nc.cantidad} onChange={(e)=>setNc({...nc,cantidad:e.target.value})}/></Campo>
        <Campo etiqueta="Detalle"><Entrada value={nc.detalle} onChange={(e)=>setNc({...nc,detalle:e.target.value})} placeholder="Qué pasó y dónde"/></Campo>
        <Campo etiqueta="Foto de evidencia" ayuda="JPG, PNG o WebP · máx. 8 MB"><Entrada type="file" accept="image/jpeg,image/png,image/webp" onChange={(e)=>setEvidencia(e.target.files?.[0] || null)}/></Campo>
      </div>
      <div className="mt-3 flex justify-end"><Boton tono="peligro" onClick={registrarNc}><TriangleAlert/> Registrar NC</Boton></div>
      <div className="mt-3 space-y-2">{noConformidades.map((x)=><div key={x.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-panel-alto p-2 text-xs"><span><b>{CAUSAS_NO_CONFORMIDAD.find(([id])=>id===x.causa)?.[1]}</b> · {x.cantidad} pieza(s) · {ACCIONES_NO_CONFORMIDAD.find(([id])=>id===x.accion)?.[1]}{x.detalle?` · ${x.detalle}`:''}{x.evidencia && <> · <a className="text-corte-500 underline" href={`/${x.evidencia}`} target="_blank" rel="noreferrer">ver foto</a></>}</span>{x.estado==='abierta'?<Boton tam="sm" tono="verde" onClick={()=>guardarEvento({tipo:'cerrar-no-conformidad',id:x.id,resolucion:'Acción completada y verificada'})}><Check/> Cerrar</Boton>:<Insignia tono="verde"><X className="size-3"/> cerrada</Insignia>}</div>)}</div>
    </div>
  </PanelCuerpo></Panel>;
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
  const eventoCalidad = (cuerpo) => mut.mutate({ ruta:`ordenes/${orden.id}/calidad`, cuerpo });
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
      <Panel><PanelCab><PanelTitulo>Clasificación visual de corte</PanelTitulo></PanelCab><PanelCuerpo><Clasificador orden={orden} guardarEvento={evento} guardarCalidad={eventoCalidad}/></PanelCuerpo></Panel>
      {resumenTaller(orden).reposiciones > 0 && <Aviso nivel="aviso"><TriangleAlert className="inline size-4"/> Hay {resumenTaller(orden).reposiciones} pieza(s) rechazadas. La cola de recorte se mantiene hasta reclasificarlas.</Aviso>}
      <Plegados orden={orden} guardarEvento={evento}/>
      <Calidad orden={orden} guardarEvento={eventoCalidad}/>
    </main> : <Vacio icono={<Factory/>} titulo="No hay una OT para mostrar"/>}
  </div>;
}
