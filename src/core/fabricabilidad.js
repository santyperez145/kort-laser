/** Auditoría geométrica previa al CAM. Informa; nunca repara una pieza en silencio. */
import { flattenPath, partesDe, pathArea, pathBBox, segEnd, segLength, segStart, shapeBBox } from './geometry.js';

const cerca = (a, b, tol = 1e-6) => Math.hypot(a[0]-b[0], a[1]-b[1]) <= tol;
const cruz = (a,b,c) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const enSegmento = (a,b,p,t=1e-7) => Math.abs(cruz(a,b,p))<=t && p[0]>=Math.min(a[0],b[0])-t && p[0]<=Math.max(a[0],b[0])+t && p[1]>=Math.min(a[1],b[1])-t && p[1]<=Math.max(a[1],b[1])+t;

function intersectan(a,b,c,d) {
  const ab1=cruz(a,b,c), ab2=cruz(a,b,d), cd1=cruz(c,d,a), cd2=cruz(c,d,b);
  if ((ab1>1e-7&&ab2< -1e-7||ab1< -1e-7&&ab2>1e-7) && (cd1>1e-7&&cd2< -1e-7||cd1< -1e-7&&cd2>1e-7)) return true;
  return enSegmento(a,b,c)||enSegmento(a,b,d)||enSegmento(c,d,a)||enSegmento(c,d,b);
}

function puntos(path) {
  const ps=flattenPath(path,0.08);
  if (ps.length>1 && cerca(ps[0],ps.at(-1))) ps.pop();
  return ps;
}

function seCruzaSolo(path) {
  const ps=puntos(path), n=ps.length;
  if (n>1800) return null; // evita congelar un plano con miles de splines discretizadas
  for(let i=0;i<n;i++) for(let j=i+1;j<n;j++) {
    if (j===i+1 || (i===0&&j===n-1)) continue;
    if(intersectan(ps[i],ps[(i+1)%n],ps[j],ps[(j+1)%n])) return true;
  }
  return false;
}

function caminosSeCruzan(a,b) {
  const pa=puntos(a), pb=puntos(b);
  if(pa.length*pb.length>1_500_000) return null;
  for(let i=0;i<pa.length;i++) for(let j=0;j<pb.length;j++)
    if(intersectan(pa[i],pa[(i+1)%pa.length],pb[j],pb[(j+1)%pb.length])) return true;
  return false;
}

function puntoDentro(p, path) {
  const ps=puntos(path); let dentro=false;
  for(let i=0,j=ps.length-1;i<ps.length;j=i++) {
    const a=ps[i],b=ps[j];
    if((a[1]>p[1])!==(b[1]>p[1]) && p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1]+1e-15)+a[0]) dentro=!dentro;
  }
  return dentro;
}

function distanciaPuntoSegmento(p,a,b) {
  const dx=b[0]-a[0],dy=b[1]-a[1],l2=dx*dx+dy*dy;
  if(!l2)return Math.hypot(p[0]-a[0],p[1]-a[1]);
  const t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/l2));
  return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);
}

function distanciaCaminos(a,b) {
  const pa=puntos(a),pb=puntos(b); let min=Infinity;
  if(pa.length*pb.length>1_500_000) return null;
  for(let i=0;i<pa.length;i++) for(let j=0;j<pb.length;j++) {
    min=Math.min(min,distanciaPuntoSegmento(pa[i],pb[j],pb[(j+1)%pb.length]),distanciaPuntoSegmento(pb[j],pa[i],pa[(i+1)%pa.length]));
  }
  return min;
}

const aviso=(codigo,msg,detalle={})=>({codigo,msg,...detalle});

/**
 * Comprueba que la geometría sea coherente y señala límites de proceso.
 * Las reglas térmicas son advertencias porque dependen del material, gas y calidad pedida.
 */
export function auditarFabricabilidad(shape, opts={}) {
  const errores=[],avisos=[];
  const espesor=Math.max(0,Number(opts.espesor)||0);
  const mesa=opts.mesa||{w:3000,h:1500};
  const ligamentoMin=Math.max(1.5,2*espesor);
  const partes=partesDe(shape);
  if(!partes.length) errores.push(aviso('sin-geometria','La pieza no tiene contornos de corte.'));

  const revisarPath=(path,nombre)=>{
    if(!path?.closed) errores.push(aviso('abierto',`${nombre} está abierto.`));
    if(!path?.segs?.length) return errores.push(aviso('vacio',`${nombre} no tiene segmentos.`));
    const area=pathArea(path);
    if(!Number.isFinite(area)) errores.push(aviso('numero-invalido',`${nombre} contiene coordenadas inválidas.`));
    else if(Math.abs(area)<0.01) errores.push(aviso('area-cero',`${nombre} tiene área nula o degenerada.`));
    for(let i=0;i<path.segs.length;i++) {
      const s=path.segs[i],sig=path.segs[(i+1)%path.segs.length];
      const largo=segLength(s);
      if(!Number.isFinite(largo)) errores.push(aviso('numero-invalido',`${nombre} contiene un segmento inválido.`));
      else if(largo<1e-4) errores.push(aviso('segmento-cero',`${nombre} contiene un segmento de longitud cero.`));
      else if(largo<0.15) avisos.push(aviso('segmento-corto',`${nombre} contiene un segmento de ${largo.toFixed(3)} mm: el CAM puede filtrarlo.`));
      const hueco=Math.hypot(...segEnd(s).map((v,k)=>v-segStart(sig)[k]));
      if(hueco>0.02) errores.push(aviso('discontinuidad',`${nombre} tiene extremos separados ${hueco.toFixed(3)} mm.`));
    }
    const auto=seCruzaSolo(path);
    if(auto===true) errores.push(aviso('autointerseccion',`${nombre} se cruza sobre sí mismo.`));
    if(auto===null) avisos.push(aviso('complejidad',`${nombre} es demasiado complejo para comprobar cruces en pantalla; revisalo en el CAM.`));
  };

  partes.forEach((parte,pi)=>{
    revisarPath(parte.outer,`Contorno exterior ${pi+1}`);
    (parte.holes||[]).forEach((h,hi)=>{
      const nombre=`Agujero ${hi+1} de la parte ${pi+1}`; revisarPath(h,nombre);
      const cruce=caminosSeCruzan(parte.outer,h);
      if(cruce===true || !puntoDentro(segStart(h.segs[0]),parte.outer)) errores.push(aviso('agujero-fuera',`${nombre} cruza o queda fuera del contorno exterior.`));
      const b=pathBBox(h),min=Math.min(b.w,b.h);
      if(espesor && min<1.2*espesor) avisos.push(aviso('agujero-chico',`${nombre} tiene ${min.toFixed(2)} mm de paso mínimo; para ${espesor} mm conviene al menos ${(1.2*espesor).toFixed(2)} mm.`));
      const dist=distanciaCaminos(parte.outer,h);
      if(dist!=null && dist<ligamentoMin) avisos.push(aviso('ligamento-borde',`${nombre} deja ${dist.toFixed(2)} mm hasta el borde; se recomienda ≥ ${ligamentoMin.toFixed(2)} mm.`));
    });
    const hs=parte.holes||[];
    for(let i=0;i<hs.length;i++)for(let j=i+1;j<hs.length;j++){
      const cruce=caminosSeCruzan(hs[i],hs[j]);
      if(cruce===true || puntoDentro(segStart(hs[i].segs[0]),hs[j]) || puntoDentro(segStart(hs[j].segs[0]),hs[i])) errores.push(aviso('agujeros-superpuestos',`Los agujeros ${i+1} y ${j+1} de la parte ${pi+1} se superponen.`));
      else { const d=distanciaCaminos(hs[i],hs[j]); if(d!=null&&d<ligamentoMin) avisos.push(aviso('ligamento-agujeros',`Entre los agujeros ${i+1} y ${j+1} quedan ${d.toFixed(2)} mm; se recomienda ≥ ${ligamentoMin.toFixed(2)} mm.`)); }
    }
  });

  for(let i=0;i<partes.length;i++)for(let j=i+1;j<partes.length;j++){
    const cruce=caminosSeCruzan(partes[i].outer,partes[j].outer);
    if(cruce===true || puntoDentro(segStart(partes[i].outer.segs[0]),partes[j].outer) || puntoDentro(segStart(partes[j].outer.segs[0]),partes[i].outer)) errores.push(aviso('partes-superpuestas',`Las partes ${i+1} y ${j+1} se superponen.`));
  }

  const bb=shapeBBox(shape);
  const entra=(bb.w<=mesa.w+1e-6&&bb.h<=mesa.h+1e-6)||(bb.h<=mesa.w+1e-6&&bb.w<=mesa.h+1e-6);
  if(!entra) errores.push(aviso('fuera-mesa',`La pieza mide ${bb.w.toFixed(1)} × ${bb.h.toFixed(1)} mm y no entra en la mesa ${mesa.w} × ${mesa.h} mm ni girada.`));
  return { bloqueado:errores.length>0, errores, avisos, metricas:{partes:partes.length,agujeros:partes.reduce((s,p)=>s+(p.holes||[]).length,0),ancho:bb.w,alto:bb.h,ligamentoRecomendado:ligamentoMin} };
}
