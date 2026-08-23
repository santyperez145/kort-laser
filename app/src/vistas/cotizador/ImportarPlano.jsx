/**
 * Importar el plano del cliente desde una imagen o un PDF.
 *
 * Es la puerta de entrada más común y la que más tiempo ahorra: el cliente
 * manda una foto del plano por WhatsApp o un PDF exportado del CAD, y hasta
 * ahora eso había que redibujarlo a mano antes de poder cotizar.
 *
 * Los dos caminos NO son iguales y la interfaz lo dice:
 *
 * - **PDF vectorial**: la geometría ya está adentro, en unidades reales. Sale
 *   exacta y no hay nada que calibrar.
 * - **Imagen**: son píxeles. Hay que decir cuánto mide algo del dibujo. El
 *   sistema no lo adivina, porque adivinarlo sería cotizar una pieza que no
 *   es la que el cliente pidió.
 */

import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Upload, Ruler, ScanLine, Loader2, Crosshair, Download } from 'lucide-react';
import trabajadorPDF from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

import { usarCotizador, itemNuevo } from './contexto';
import { Dialogo, ContenidoDialogo, Aviso } from '@/componentes/ui/varios';
import { Boton } from '@/componentes/ui/boton';
import { Campo, Entrada } from '@/componentes/ui/campos';
import { Insignia } from '@/componentes/ui/insignia';
import { usarEstado } from '@/lib/estado';
import { num } from '@/lib/formato';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { descargar } from '@/lib/formato';

import { vectorizar, aPieza, escalaDesdeReferencia } from '@core/vectorizar.js';
import { leerPlanoPDF, planoAPieza } from '@core/pdf-plano.js';
import { shapeBBox, shapeArea, shapeCutLength } from '@core/geometry.js';
import { generarDXF } from '@core/dxf-write.js';

/** Lee un archivo de imagen y devuelve sus píxeles. */
function pixelesDe(file, maxLado = 2200) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      /* Se limita el lado mayor: una foto de celular son 4000 px y el trazado
         es O(n) sobre los píxeles. Arriba de ~2200 px no mejora el contorno
         —la línea ya está resuelta— y sí multiplica la espera. */
      const escala = Math.min(1, maxLado / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * escala));
      const h = Math.max(1, Math.round(img.height * escala));
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(ctx.getImageData(0, 0, w, h));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo abrir la imagen'));
    };
    img.src = url;
  });
}

/** Un PDF escaneado se rasteriza localmente; no sale de la PC del taller. */
async function pixelesDePDF(file, pagina = 1, maxLado = 2200) {
  // Carga diferida: el lector pesa, pero sólo hace falta cuando el PDF es un
  // escaneo. El cotizador normal no debe pagar ese costo al arrancar.
  const pdfjs = await import('pdfjs-dist/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = trabajadorPDF;
  const doc = await pdfjs.getDocument({ data:new Uint8Array(await file.arrayBuffer()) }).promise;
  const hoja = await doc.getPage(Math.max(1, Math.min(doc.numPages, pagina)));
  const base = hoja.getViewport({ scale:1 });
  const escala = Math.min(3, maxLado / Math.max(base.width, base.height));
  const vista = hoja.getViewport({ scale:escala });
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(vista.width)); c.height = Math.max(1, Math.round(vista.height));
  const ctx = c.getContext('2d', { willReadFrequently:true });
  await hoja.render({ canvasContext:ctx, viewport:vista }).promise;
  const imagen = ctx.getImageData(0, 0, c.width, c.height);
  const paginas = doc.numPages;
  await doc.destroy();
  return { imagen, paginas };
}

export function ImportarPlano({ abierto, alCerrar }) {
  const { agregarItem } = usarCotizador();
  const materiales = usarEstado((s) => s.materiales);
  const entrada = useRef(null);
  const lienzo = useRef(null);
  const transformacion = useRef({ escala:1 });

  const [encima, setEncima] = useState(false);
  const [trabajando, setTrabajando] = useState(false);
  const [archivo, setArchivo] = useState('');
  const [archivoFuente, setArchivoFuente] = useState(null);
  const [fuente, setFuente] = useState(null); // 'imagen' | 'pdf'
  const [imagen, setImagen] = useState(null); // ImageData original
  const [res, setRes] = useState(null); // resultado de vectorizar / leerPlanoPDF
  const [sensibilidad, setSensibilidad] = useState(0.14);
  const [minPixeles, setMinPixeles] = useState(40);
  const [medidaMM, setMedidaMM] = useState('');
  const [puntos, setPuntos] = useState([]);
  const [tipoArchivo, setTipoArchivo] = useState(null);
  const [verificado, setVerificado] = useState(false);
  const [error, setError] = useState(null);

  const limpiar = () => {
    setArchivo(''); setArchivoFuente(null); setFuente(null); setImagen(null); setRes(null);
    setMedidaMM(''); setPuntos([]); setTipoArchivo(null); setVerificado(false);
    setError(null); setSensibilidad(0.14); setMinPixeles(40);
  };

  const cerrar = () => { limpiar(); alCerrar(); };

  const procesar = async (file) => {
    setError(null);
    setTrabajando(true);
    try {
      const extension = file.name.split('.').pop()?.toLowerCase();
      if (!['jpg','jpeg','png','webp','pdf'].includes(extension)) throw new Error('Usá un archivo JPG, PNG, WebP o PDF.');
      if (file.size > 8 * 1024 * 1024) throw new Error('El plano supera 8 MB. Reducilo o exportá sólo la hoja necesaria.');
      if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const r = await leerPlanoPDF(bytes);
        if (r.vectorial) {
          setFuente('pdf'); setTipoArchivo('pdf-vectorial'); setImagen(null); setRes(r);
        } else {
          const raster = await pixelesDePDF(file);
          setFuente('imagen'); setTipoArchivo('pdf-escaneado'); setImagen(raster.imagen);
          const vr = vectorizar(raster.imagen, { sensibilidad, minPixeles });
          vr.avisos.unshift({ nivel:'info', msg:`PDF escaneado: se vectorizó la página 1 de ${raster.paginas}. Marcá dos extremos de una cota para darle tamaño real.` });
          setRes(vr);
        }
      } else {
        const img = await pixelesDe(file);
        setFuente('imagen'); setTipoArchivo('imagen');
        setImagen(img);
        setRes(vectorizar(img, { sensibilidad, minPixeles }));
      }
      setArchivo(file.name);
      setArchivoFuente(file);
      setPuntos([]); setVerificado(false);
    } catch (e) {
      setError(e.message);
      setRes(null);
    } finally {
      setTrabajando(false);
    }
  };

  /* Re-detectar cuando se mueven los controles. Con retardo porque cada
     pasada recorre la imagen entera y el usuario arrastra el control. */
  useEffect(() => {
    if (fuente !== 'imagen' || !imagen) return undefined;
    const t = setTimeout(() => {
      try {
        setRes(vectorizar(imagen, { sensibilidad, minPixeles }));
      } catch (e) {
        setError(e.message);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [sensibilidad, minPixeles, imagen, fuente]);

  /* Vista previa: la imagen apagada y encima los contornos detectados. Sin
     esto no hay forma de saber si agarró la pieza o el membrete. */
  useEffect(() => {
    const c = lienzo.current;
    if (!c || !res) return;
    const cont = res.contornos || [];
    const W = fuente === 'imagen' ? res.ancho : Math.max(...cont.flatMap((x) => x.puntos.map((p) => p[0])), 1);
    const H = fuente === 'imagen' ? res.alto : Math.max(...cont.flatMap((x) => x.puntos.map((p) => p[1])), 1);
    const escala = Math.min(520 / W, 340 / H, 1);
    transformacion.current = { escala };
    c.width = Math.max(1, Math.round(W * escala));
    c.height = Math.max(1, Math.round(H * escala));
    const g = c.getContext('2d');
    g.fillStyle = '#ffffff';
    g.fillRect(0, 0, c.width, c.height);

    if (fuente === 'imagen' && imagen) {
      const tmp = document.createElement('canvas');
      tmp.width = imagen.width;
      tmp.height = imagen.height;
      tmp.getContext('2d').putImageData(imagen, 0, 0);
      g.globalAlpha = 0.28;
      g.drawImage(tmp, 0, 0, c.width, c.height);
      g.globalAlpha = 1;
    }

    g.lineWidth = 1.6;
    cont.forEach((x, i) => {
      // El más grande en naranja: es el que va a ser el contorno de la pieza
      g.strokeStyle = i === 0 ? '#e4572e' : '#1f7a4d';
      g.beginPath();
      const pts = x.puntos;
      // En el PDF la Y va hacia arriba; en el lienzo, hacia abajo
      const py = (v) => (fuente === 'pdf' ? c.height - v * escala : v * escala);
      g.moveTo(pts[0][0] * escala, py(pts[0][1]));
      for (const [px, pyv] of pts.slice(1)) g.lineTo(px * escala, py(pyv));
      g.closePath();
      g.stroke();
    });
    for (let i = 0; i < puntos.length; i++) {
      const p = puntos[i];
      g.fillStyle = '#e4572e'; g.strokeStyle = '#ffffff'; g.lineWidth = 2;
      g.beginPath(); g.arc(p.x, p.y, 6, 0, Math.PI * 2); g.fill(); g.stroke();
      g.fillStyle = '#111827'; g.font = 'bold 11px sans-serif'; g.fillText(String(i + 1), p.x + 9, p.y - 7);
    }
    if (puntos.length === 2) {
      g.strokeStyle = '#e4572e'; g.lineWidth = 2; g.setLineDash([5,4]);
      g.beginPath(); g.moveTo(puntos[0].x,puntos[0].y); g.lineTo(puntos[1].x,puntos[1].y); g.stroke(); g.setLineDash([]);
    }
  }, [res, imagen, fuente, puntos]);

  /* La escala. En el PDF no hace falta; en la imagen la pone una persona
     diciendo cuánto mide el ancho total de lo que se detectó. */
  const distanciaReferencia = puntos.length === 2
    ? Math.hypot(puntos[1].x-puntos[0].x, puntos[1].y-puntos[0].y) / transformacion.current.escala
    : 0;
  const mmPorPx = fuente === 'imagen' && medidaMM
    ? escalaDesdeReferencia(distanciaReferencia, parseFloat(medidaMM)) : null;
  const escalaPDF = fuente === 'pdf' && medidaMM && distanciaReferencia
    ? parseFloat(medidaMM) / distanciaReferencia : 1;

  let vistaPrevia = null;
  if (res?.contornos?.length && (fuente === 'pdf' || mmPorPx)) {
    try {
      const p =
        fuente === 'pdf'
          ? planoAPieza(res.contornos, { escala:escalaPDF })
          : aPieza(res.contornos, mmPorPx, { altoImagen: res.alto });
      const bb = shapeBBox(p.shape);
      vistaPrevia = {
        ...p,
        ancho: bb.w,
        alto: bb.h,
        areaM2: shapeArea(p.shape) / 1e6,
        corteM: shapeCutLength(p.shape) / 1000,
      };
    } catch (e) {
      vistaPrevia = { error: e.message };
    }
  }

  const usar = async (bajar = false) => {
    if (!vistaPrevia || vistaPrevia.error) return;
    let rutaOriginal = '';
    try {
      if (archivoFuente) {
        const original = await api.guardarArchivo(
          `${Date.now()}-${archivo.replace(/[^\w.áéíóúñÁÉÍÓÚÑ-]/g,'_')}`,
          new Uint8Array(await archivoFuente.arrayBuffer()), 'planos-clientes'
        );
        rutaOriginal = original.ruta;
      }
    } catch (e) {
      toast.error(`No se guardó el plano original: ${e.message}`);
      return;
    }
    const it = itemNuevo(materiales, {
      origen: 'plano',
      nombre: archivo.replace(/\.[^.]+$/, ''),
      shape: vistaPrevia.shape,
      archivo,
      meta: {
        modelo3D: { tipo: 'plano' },
        planoImportado: {
          tipo:tipoArchivo, archivo, rutaOriginal,
          referenciaMM:medidaMM ? Number(medidaMM) : null,
          referenciaDetectada:distanciaReferencia || null,
          escalaAplicada:fuente === 'imagen' ? mmPorPx : escalaPDF,
          cotasVerificadas:true, fecha:new Date().toISOString(),
        },
      },
    });
    delete it.piezaId;
    delete it.params;
    agregarItem(it);
    if (bajar) {
      const dxf = generarDXF([{ shape:vistaPrevia.shape }], {
        titulo:`KORT - ${it.nombre}`, subtitulo:`Reconstruido de ${archivo} · verificar plano aprobado`,
      });
      const nombre = `${it.nombre.replace(/[^\w-]/g,'_')}-tamanio-real.dxf`;
      descargar(nombre, dxf, 'application/dxf');
      try { await api.guardarArchivo(nombre, dxf, 'dxf-planos'); }
      catch (e) { toast.warning(`El DXF se descargó, pero no se copió a salidas: ${e.message}`); }
    }
    toast.success(
      fuente === 'pdf'
        ? 'Plano importado del PDF con medidas exactas'
        : `Plano vectorizado a ${num(vistaPrevia.ancho, 0)} × ${num(vistaPrevia.alto, 0)} mm`
    );
    cerrar();
  };

  return (
    <Dialogo open={abierto} onOpenChange={(v) => !v && cerrar()}>
      <ContenidoDialogo
        titulo="Importar plano (imagen o PDF)"
        descripcion="Una foto del plano, un escaneo o un PDF del CAD. Del PDF vectorial las medidas salen exactas; de una imagen hay que indicar una medida de referencia."
        ancho="max-w-4xl"
      >
        <input
          ref={entrada} type="file" accept="image/jpeg,image/png,image/webp,.pdf,application/pdf" className="hidden"
          onChange={(e) => e.target.files?.[0] && procesar(e.target.files[0])}
        />

        {!res && !trabajando ? (
          <button
            type="button"
            onClick={() => entrada.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setEncima(true); }}
            onDragLeave={() => setEncima(false)}
            onDrop={(e) => {
              e.preventDefault();
              setEncima(false);
              if (e.dataTransfer.files[0]) procesar(e.dataTransfer.files[0]);
            }}
            className={cn(
              'flex w-full cursor-pointer flex-col items-center rounded-xl border-2 border-dashed px-6 py-9 transition-colors',
              encima
                ? 'border-corte-500 bg-corte-500/10 text-corte-500'
                : 'border-borde bg-panel-alto text-suave hover:border-borde-fuerte'
            )}
          >
            <Upload className="mb-2 size-7" />
            <strong className="text-sm">Soltá acá la foto, el escaneo o el PDF</strong>
            <span className="mt-1 text-xs text-tenue">
              JPG, PNG o PDF · el dibujo tiene que estar cerrado y verse completo
            </span>
          </button>
        ) : null}

        {trabajando ? (
          <div className="flex items-center gap-2 py-8 text-[13px] text-suave">
            <Loader2 className="size-4 animate-spin" />
            Analizando el plano…
          </div>
        ) : null}

        {error ? <Aviso nivel="error" className="mt-3">{error}</Aviso> : null}

        {res ? (
          <div className="mt-3 grid gap-4 md:grid-cols-[minmax(0,1fr)_280px]">
            <div>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[12.5px] font-semibold">{archivo}</span>
                <Insignia tono={fuente === 'pdf' ? 'verde' : 'azul'}>
                  {tipoArchivo === 'pdf-vectorial' ? 'PDF vectorial' : tipoArchivo === 'pdf-escaneado' ? 'PDF escaneado · calibrar' : 'Imagen · calibrar'}
                </Insignia>
              </div>
              <div className="mt-2 overflow-hidden rounded-lg border border-borde bg-white">
                <canvas ref={lienzo} className="block max-w-full cursor-crosshair" onClick={(e)=>{
                  const c=e.currentTarget, r=c.getBoundingClientRect();
                  const p={x:(e.clientX-r.left)*c.width/r.width,y:(e.clientY-r.top)*c.height/r.height};
                  setPuntos((ps)=>ps.length>=2?[p]:[...ps,p]); setVerificado(false);
                }}/>
              </div>
              <p className="mt-1.5 text-[11px] text-tenue">
                En naranja el contorno exterior de la pieza; en verde los agujeros y las demás
                partes. Hacé clic en los dos extremos de una cota conocida para calibrar o comprobar la escala.
              </p>
            </div>

            <div className="space-y-3">
              <div className="rounded-lg border border-corte-500/30 bg-corte-500/5 p-3">
                <div className="flex items-center gap-2 text-xs font-bold"><Crosshair className="size-4 text-corte-500"/> Referencia dimensional</div>
                <p className="mt-1 text-[11px] text-tenue">{puntos.length < 2 ? `Marcá ${2-puntos.length} punto(s) sobre los extremos de una cota.` : `Distancia detectada: ${num(distanciaReferencia,2)} ${fuente==='pdf'?'mm del PDF':'px'}.`}</p>
                <Campo etiqueta="Medida real entre los puntos" className="mt-2" ayuda={fuente==='pdf'?'Opcional si el CAD está realmente exportado 1:1; cargarla corrige su escala.':'Obligatoria: una foto sólo contiene píxeles.'}>
                  <Entrada type="number" min="0.01" step="any" unidad="mm" value={medidaMM}
                    disabled={puntos.length!==2} onChange={(e)=>{setMedidaMM(e.target.value);setVerificado(false);}}
                    placeholder={puntos.length===2?'Ej. 250':'Primero marcá dos puntos'}/>
                </Campo>
                {puntos.length>0 && <Boton tam="sm" tono="fantasma" className="mt-2" onClick={()=>{setPuntos([]);setMedidaMM('');setVerificado(false);}}>Volver a marcar</Boton>}
              </div>

              {fuente === 'imagen' ? (
                <>
                  <Aviso nivel="aviso">Si es una foto, sacala perpendicular al plano y sin perspectiva. Una sola referencia corrige escala, pero no puede corregir una hoja fotografiada en diagonal.</Aviso>

                  <Campo etiqueta="Sensibilidad" ayuda="Subila si el dibujo es tenue; bajala si entra el fondo.">
                    <input
                      type="range" min="0.04" max="0.35" step="0.01"
                      value={sensibilidad}
                      onChange={(e) => setSensibilidad(+e.target.value)}
                      className="w-full accent-corte-500"
                    />
                  </Campo>

                  <Campo etiqueta="Tamaño mínimo del contorno" ayuda="Subilo para descartar textos y cotas.">
                    <Entrada
                      type="number" min={4} step={4} unidad="px"
                      value={minPixeles}
                      onChange={(e) => setMinPixeles(Math.max(4, +e.target.value || 4))}
                    />
                  </Campo>
                </>
              ) : <Aviso nivel="ok">El PDF vectorial conserva unidades. Verificá al menos una cota conocida; si coincide, dejá la corrección vacía.</Aviso>}

              <div className="rounded-lg border border-borde px-3 py-2 text-[12px]">
                <div className="mb-1 flex items-center gap-1.5 text-[10.5px] font-bold uppercase tracking-wide text-tenue">
                  <ScanLine className="size-3" />
                  Detectado
                </div>
                <div className="flex justify-between">
                  <span className="text-suave">Contornos</span>
                  <span className="tabular font-mono">{res.contornos.length}</span>
                </div>
                {vistaPrevia && !vistaPrevia.error ? (
                  <>
                    <div className="flex justify-between">
                      <span className="text-suave">Medida</span>
                      <span className="tabular font-mono">
                        {num(vistaPrevia.ancho, 1)} × {num(vistaPrevia.alto, 1)} mm
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-suave">Agujeros</span>
                      <span className="tabular font-mono">{vistaPrevia.agujeros}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-suave">Corte</span>
                      <span className="tabular font-mono">{num(vistaPrevia.corteM, 2)} m</span>
                    </div>
                  </>
                ) : (
                  <p className="mt-1 flex gap-1.5 text-[11px] leading-snug text-suave">
                    <Ruler className="mt-0.5 size-3 shrink-0" />
                    {fuente==='imagen'?'Marcá dos puntos y cargá su medida real.':'La pieza usa la escala 1:1 del PDF.'}
                  </p>
                )}
              </div>

              <label className="flex items-start gap-2 rounded-lg border border-borde p-2 text-[11px] leading-snug text-suave">
                <input type="checkbox" className="mt-0.5" checked={verificado} onChange={(e)=>setVerificado(e.target.checked)}/>
                <span><b className="text-tinta">Verifiqué las cotas críticas contra el plano aprobado.</b><br/>La vectorización reconstruye contornos; no interpreta tolerancias, roscas ni notas técnicas.</span>
              </label>

              <div className="grid grid-cols-2 gap-2">
                <Boton tam="sm" onClick={limpiar}>Otro archivo</Boton>
                <Boton
                  tam="sm" tono="neutro" onClick={()=>usar(false)}
                  disabled={!vistaPrevia || !!vistaPrevia?.error || !verificado}
                >
                  Usar esta pieza
                </Boton>
                <Boton tam="sm" tono="corte" className="col-span-2" onClick={()=>usar(true)}
                  disabled={!vistaPrevia || !!vistaPrevia?.error || !verificado}>
                  <Download/> Usar y generar DXF en tamaño real
                </Boton>
              </div>
            </div>
          </div>
        ) : null}

        {vistaPrevia?.error ? <Aviso nivel="error" className="mt-3">{vistaPrevia.error}</Aviso> : null}

        {(res?.avisos || []).map((a, i) => (
          <Aviso key={'r' + i} nivel={a.nivel} className="mt-2">{a.msg}</Aviso>
        ))}
        {(vistaPrevia?.avisos || []).map((a, i) => (
          <Aviso key={'p' + i} nivel={a.nivel} className="mt-2">{a.msg}</Aviso>
        ))}
      </ContenidoDialogo>
    </Dialogo>
  );
}
