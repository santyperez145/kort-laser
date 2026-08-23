/** Segmentación supervisada de placas planas mayores que la mesa. */
import { makeShape, pathBBox, polyline, partesDe, shapeBBox } from './geometry.js';
import { auditarFabricabilidad } from './fabricabilidad.js';

const EPS=1e-6;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

function puntosLineales(path) {
  if(!path?.closed||!path.segs?.length||path.segs.some((s)=>s.t!=='L')) return null;
  return path.segs.map((s)=>[s.x1,s.y1]);
}

function clipMitad(pts,eje,limite,conservarMayor) {
  const salida=[];
  for(let i=0;i<pts.length;i++){
    const a=pts[i],b=pts[(i+1)%pts.length];
    const va=a[eje]-limite,vb=b[eje]-limite;
    const ina=conservarMayor?va>=-EPS:va<=EPS, inb=conservarMayor?vb>=-EPS:vb<=EPS;
    if(ina)salida.push(a);
    if(ina!==inb){const t=va/(va-vb);salida.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);}
  }
  return salida;
}

function clipBanda(pts,eje,min,max) {
  return clipMitad(clipMitad(pts,eje,min,true),eje,max,false);
}

function junta(eje,valor,desde,hasta,profundidad,paso) {
  const largo=hasta-desde;
  const n=Math.max(2,Math.round(largo/paso));
  const p=largo/n, out=[];
  const punto=(u,v)=>eje===0?[u,v]:[v,u];
  out.push(punto(valor,desde));
  for(let i=0;i<n;i++){
    const y0=desde+i*p, signo=i%2===0?1:-1;
    out.push(punto(valor,y0+p*0.22));
    out.push(punto(valor+signo*profundidad,y0+p*0.22));
    out.push(punto(valor+signo*profundidad,y0+p*0.78));
    out.push(punto(valor,y0+p*0.78));
  }
  out.push(punto(valor,hasta));
  return out;
}

function reemplazarBorde(pts,eje,valor,perfil) {
  const otro=eje===0?1:0;
  let encontrado=-1;
  for(let i=0;i<pts.length;i++){
    const a=pts[i],b=pts[(i+1)%pts.length];
    if(Math.abs(a[eje]-valor)<EPS&&Math.abs(b[eje]-valor)<EPS&&Math.abs(a[otro]-b[otro])>EPS){
      if(encontrado>=0)return null; encontrado=i;
    }
  }
  if(encontrado<0)return null;
  const a=pts[encontrado],b=pts[(encontrado+1)%pts.length];
  const orden=a[otro]<=b[otro]?perfil:[...perfil].reverse();
  const out=[];
  for(let i=0;i<pts.length;i++){
    out.push(pts[i]);
    if(i===encontrado)out.push(...orden.slice(1,-1));
  }
  return out;
}

function cruzaBanda(path,eje,valor,seguridad) {
  const b=pathBBox(path);
  const min=eje===0?b.minX:b.minY,max=eje===0?b.maxX:b.maxY;
  return valor>min-seguridad&&valor<max+seguridad;
}

/**
 * Divide un contorno lineal en bandas y crea una junta complementaria común.
 * El mismo perfil es borde de ambos paneles: no hay solape ni hueco inventado.
 */
export function segmentarPieza(shape,opts={}) {
  const errores=[],avisos=[];
  if(shape?.pliegues?.length)return{error:'Un desarrollo con líneas de plegado necesita rediseño de ingeniería: segmentarlo cambia la secuencia, el apoyo y el herramental.',errores,avisos,segmentos:[]};
  const partes=partesDe(shape);
  if(partes.length!==1)return{error:'La segmentación automática requiere una sola parte exterior.',errores,avisos,segmentos:[]};
  const outer=puntosLineales(partes[0].outer);
  if(!outer)return{error:'La segmentación automática no aproxima curvas: el contorno exterior debe estar formado por líneas.',errores,avisos,segmentos:[]};
  const mesa=opts.mesa||{w:3000,h:1500},bb=shapeBBox(shape),espesor=Math.max(0.5,Number(opts.espesor)||2);
  const eje=opts.eje==='y'?1:opts.eje==='x'?0:(bb.w>=bb.h?0:1);
  const largo=eje===0?bb.w:bb.h,capacidad=eje===0?mesa.w:mesa.h;
  const profundidad=clamp(Number(opts.profundidad)||Math.max(6,3*espesor),3,30);
  const margen=Math.max(5,Number(opts.margenMesa)||15);
  const util=capacidad-2*margen-2*profundidad;
  if(util<=0)return{error:'El margen y la junta dejan la mesa sin longitud útil.',errores,avisos,segmentos:[]};
  const cantidad=Math.max(1,Math.ceil(largo/util));
  if(cantidad===1)return{error:null,errores,avisos:[{nivel:'info',msg:'La pieza ya entra en la mesa; no necesita segmentarse.'}],segmentos:[shape],cantidad:1,eje:eje===0?'x':'y',juntas:[]};
  const min=eje===0?bb.minX:bb.minY,max=eje===0?bb.maxX:bb.maxY;
  const otro=eje===0?1:0,desde=otro===0?bb.minX:bb.minY,hasta=otro===0?bb.maxX:bb.maxY;
  const paso=clamp(Number(opts.paso)||Math.max(45,18*espesor),30,180);
  const seguridad=Math.max(2*espesor,Number(opts.seguridad)||10);
  const juntas=[];
  for(let i=1;i<cantidad;i++){
    const ideal=min+largo*i/cantidad;
    let elegida=null;
    for(let d=0;d<=Math.min(250,largo/cantidad*0.3);d+=5){
      for(const s of d===0?[0]:[-d,d]){
        const v=ideal+s;
        if(!(partes[0].holes||[]).some((h)=>cruzaBanda(h,eje,v,seguridad))){elegida=v;break;}
      }
      if(elegida!=null)break;
    }
    if(elegida==null)return{error:`No hay una zona libre para la junta ${i}: todos los candidatos atraviesan agujeros.`,errores,avisos,segmentos:[]};
    juntas.push({eje:eje===0?'x':'y',valor:elegida,ideal,desplazamiento:elegida-ideal,profundidad,paso});
  }
  juntas.sort((a,b)=>a.valor-b.valor);
  const cortes=[min,...juntas.map((j)=>j.valor),max],segmentos=[];
  for(let i=0;i<cortes.length-1;i++){
    let pts=clipBanda(outer,eje,cortes[i],cortes[i+1]);
    if(pts.length<3)return{error:`El segmento ${i+1} no forma un contorno cerrado simple. Elegí otra dirección de junta.`,errores,avisos,segmentos:[]};
    for(const ji of [i-1,i]){
      if(ji<0||ji>=juntas.length)continue;
      const j=juntas[ji],perfil=junta(eje,j.valor,desde,hasta,profundidad,paso);
      pts=reemplazarBorde(pts,eje,j.valor,perfil);
      if(!pts)return{error:`La junta ${ji+1} atraviesa el contorno más de una vez. Esa geometría necesita segmentación manual.`,errores,avisos,segmentos:[]};
    }
    const holes=(partes[0].holes||[]).filter((h)=>{
      const b=pathBBox(h),c=eje===0?(b.minX+b.maxX)/2:(b.minY+b.maxY)/2;
      return c>=cortes[i]-EPS&&c<=cortes[i+1]+EPS;
    });
    const sh=makeShape(polyline(pts,true),holes,{...(shape.meta||{}),segmentacion:{indice:i+1,total:cantidad}});
    const audit=auditarFabricabilidad(sh,{espesor,mesa});
    const criticos=audit.errores.filter((e)=>e.codigo!=='fuera-mesa');
    if(criticos.length)return{error:`El segmento ${i+1} no pasó la auditoría: ${criticos[0].msg}`,errores:audit.errores,avisos,segmentos:[]};
    if(audit.errores.some((e)=>e.codigo==='fuera-mesa'))return{error:`El segmento ${i+1} todavía no entra en la mesa. Aumentá la cantidad de divisiones o reducí la profundidad.`,errores:audit.errores,avisos,segmentos:[]};
    segmentos.push(sh); avisos.push(...audit.avisos);
  }
  return {error:null,segmentos,cantidad,eje:eje===0?'x':'y',juntas,profundidad,paso,margen,avisos,
    instrucciones:[
      'Presentá todos los segmentos sobre una mesa plana y verificá las cotas generales antes de puntear.',
      'Usá el encastre sólo para posicionar: sujetá con prensas o una plantilla rígida.',
      'Punteá desde el centro hacia los extremos, alternando lados y dejando enfriar para limitar la distorsión.',
      'Definí soldadura, aporte, secuencia final y terminación en la hoja de proceso según material, espesor y uso de la pieza.',
    ]};
}
