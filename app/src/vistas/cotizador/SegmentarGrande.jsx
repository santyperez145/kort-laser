import { useMemo, useState } from 'react';
import { Download, Puzzle, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { usarCotizador } from './contexto';
import { Dialogo, ContenidoDialogo, Aviso } from '@/componentes/ui/varios';
import { Boton } from '@/componentes/ui/boton';
import { Campo, Entrada, Selector, Opcion } from '@/componentes/ui/campos';
import { Insignia } from '@/componentes/ui/insignia';
import { miniatura } from '@/lib/miniatura';
import { descargar } from '@/lib/formato';
import { api } from '@/lib/api';
import { usarEstado } from '@/lib/estado';
import { generarDXF } from '@core/dxf-write.js';
import { segmentarPieza } from '@core/segmentacion.js';

export function SegmentarGrande({ abierto, alCerrar, item, shape, indice }) {
  const { agregarItem, quitarItem } = usarCotizador();
  const laser=usarEstado((s)=>s.maquinas.find((m)=>m.tipo==='laser')||s.maquinas[0]);
  const [cfg,setCfg]=useState({eje:'auto',profundidad:Math.max(6,3*Number(item?.espesor||2)),paso:Math.max(45,18*Number(item?.espesor||2)),margenMesa:15,union:'kort',horasSoldadura:1});
  const mesa=laser?.areaTrabajo||{w:3000,h:1500};
  const plan=useMemo(()=>shape?segmentarPieza(shape,{...cfg,eje:cfg.eje==='auto'?undefined:cfg.eje,espesor:item?.espesor,mesa}):null,[shape,cfg,item?.espesor,mesa.w,mesa.h]);

  const confirmar=async (bajarDXF=false)=>{
    if(!plan||plan.error||!plan.segmentos.length)return;
    if(cfg.union==='kort'&&!(Number(cfg.horasSoldadura)>0))return toast.error('Cargá las horas previstas de soldadura y armado.');
    const grupo=`SEG-${Date.now()}`;
    try{
      const nuevos=plan.segmentos.map((segmento,i)=>{
        const nombre=`${item.nombre} · segmento ${i+1}/${plan.segmentos.length}`;
        const nuevo=structuredClone({...item,nombre,origen:'segmentado',shape:plan.segmentos[i],piezaId:undefined,params:undefined,
          meta:{...(item.meta||{}),modelo3D:{tipo:'plano'},segmentacion:{grupo,indice:i+1,total:plan.segmentos.length,juntas:plan.juntas,instrucciones:plan.instrucciones,union:cfg.union}},
          procesos:cfg.union==='kort'
            ? (i===0?[...(item.procesos||[]).filter((p)=>p.id!=='soldadura-mig'),{id:'soldadura-mig',cantidad:Number(cfg.horasSoldadura)}]:(item.procesos||[]).filter((p)=>p.id!=='soldadura-mig'))
            : (item.procesos||[]),
        });
        delete nuevo.piezaId;delete nuevo.params;
        return nuevo;
      });
      const archivos=bajarDXF?nuevos.map((nuevo,i)=>({
        archivo:`${nuevo.nombre.replace(/[^\w-]/g,'_')}.dxf`,
        dxf:generarDXF([{shape:plan.segmentos[i]}],{titulo:`KORT - ${nuevo.nombre}`,subtitulo:`Grupo ${grupo} · junta complementaria · ${item.espesor} mm`}),
      })):[];
      // El presupuesto se modifica recién cuando todos los archivos quedaron
      // persistidos: una falla de disco no puede crear media pieza en pantalla.
      for(const a of archivos)await api.guardarArchivo(a.archivo,a.dxf,`dxf-segmentados-${grupo}`);
      nuevos.forEach(agregarItem);
      quitarItem(indice);
      for(const a of archivos)descargar(a.archivo,a.dxf,'application/dxf');
      toast.success(`${plan.segmentos.length} segmentos creados${bajarDXF?' y DXF guardados':''}`);alCerrar();
    }catch(e){toast.error(`No se completó la segmentación: ${e.message}`);}
  };

  return <Dialogo open={abierto} onOpenChange={(v)=>!v&&alCerrar()}><ContenidoDialogo titulo="Segmentar pieza mayor que la mesa" descripcion="Crea paneles cortables con una junta complementaria de autoalineación. No reemplaza la revisión estructural ni el procedimiento de soldadura." ancho="max-w-5xl">
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
      <Campo etiqueta="Dirección"><Selector valor={cfg.eje} alCambiar={(v)=>setCfg({...cfg,eje:v})}><Opcion valor="auto">Automática</Opcion><Opcion valor="x">Cortes verticales</Opcion><Opcion valor="y">Cortes horizontales</Opcion></Selector></Campo>
      <Campo etiqueta="Profundidad encastre"><Entrada type="number" min="3" max="30" unidad="mm" value={cfg.profundidad} onChange={(e)=>setCfg({...cfg,profundidad:Number(e.target.value)})}/></Campo>
      <Campo etiqueta="Paso"><Entrada type="number" min="30" max="180" unidad="mm" value={cfg.paso} onChange={(e)=>setCfg({...cfg,paso:Number(e.target.value)})}/></Campo>
      <Campo etiqueta="Margen de mesa"><Entrada type="number" min="5" unidad="mm" value={cfg.margenMesa} onChange={(e)=>setCfg({...cfg,margenMesa:Number(e.target.value)})}/></Campo>
      <Campo etiqueta="Quién une"><Selector valor={cfg.union} alCambiar={(v)=>setCfg({...cfg,union:v})}><Opcion valor="kort">KORT suelda</Opcion><Opcion valor="cliente">Cliente ensambla</Opcion></Selector></Campo>
      <Campo etiqueta="Soldadura + armado" ayuda="Total de todo el lote"><Entrada type="number" min="0.1" step="0.25" unidad="h" disabled={cfg.union!=='kort'} value={cfg.horasSoldadura} onChange={(e)=>setCfg({...cfg,horasSoldadura:e.target.value})}/></Campo>
    </div>
    {plan?.error?<Aviso nivel="error" className="mt-4"><TriangleAlert className="inline size-4"/> {plan.error}</Aviso>:plan&&<>
      <div className="mt-4 flex flex-wrap items-center gap-2"><Insignia tono="verde">{plan.segmentos.length} segmentos</Insignia><Insignia tono="azul">{plan.juntas.length} juntas</Insignia><span className="text-xs text-suave">Mesa {mesa.w} × {mesa.h} mm · encastre {plan.profundidad} mm · paso {Math.round(plan.paso)} mm</span></div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{plan.segmentos.map((s,i)=><div key={i} className="rounded-xl border border-borde p-2"><img src={miniatura(s,300,190)} className="h-40 w-full rounded-lg bg-white object-contain"/><div className="mt-1 text-xs font-semibold">Segmento {i+1}/{plan.segmentos.length}</div></div>)}</div>
      <Aviso nivel="aviso" className="mt-3"><b>Control de deformación.</b> El encastre posiciona, pero no rigidiza. Presentá y prensá sobre mesa plana; verificá cotas; punteá del centro hacia afuera alternando lados y dejando enfriar. La soldadura final debe seguir una hoja de proceso acorde al uso, material y espesor.</Aviso>
      <ol className="mt-3 list-decimal space-y-1 pl-5 text-xs text-suave">{plan.instrucciones.map((x,i)=><li key={i}>{x}</li>)}</ol>
    </>}
    <div className="mt-4 flex flex-wrap justify-end gap-2"><Boton onClick={alCerrar}>Cancelar</Boton><Boton tono="neutro" disabled={!plan||!!plan.error} onClick={()=>confirmar(false)}><Puzzle/> Reemplazar por segmentos</Boton><Boton tono="corte" disabled={!plan||!!plan.error} onClick={()=>confirmar(true)}><Download/> Segmentar y generar DXF</Boton></div>
  </ContenidoDialogo></Dialogo>;
}
