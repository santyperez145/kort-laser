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
import { Upload, Ruler, ScanLine, Loader2 } from 'lucide-react';

import { usarCotizador, itemNuevo } from './contexto';
import { Dialogo, ContenidoDialogo, Aviso } from '@/componentes/ui/varios';
import { Boton } from '@/componentes/ui/boton';
import { Campo, Entrada } from '@/componentes/ui/campos';
import { Insignia } from '@/componentes/ui/insignia';
import { usarEstado } from '@/lib/estado';
import { num } from '@/lib/formato';
import { cn } from '@/lib/utils';

import { vectorizar, aPieza, escalaDesdeReferencia } from '@core/vectorizar.js';
import { leerPlanoPDF, planoAPieza } from '@core/pdf-plano.js';
import { shapeBBox, shapeArea, shapeCutLength } from '@core/geometry.js';

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

export function ImportarPlano({ abierto, alCerrar }) {
  const { agregarItem } = usarCotizador();
  const materiales = usarEstado((s) => s.materiales);
  const entrada = useRef(null);
  const lienzo = useRef(null);

  const [encima, setEncima] = useState(false);
  const [trabajando, setTrabajando] = useState(false);
  const [archivo, setArchivo] = useState('');
  const [fuente, setFuente] = useState(null); // 'imagen' | 'pdf'
  const [imagen, setImagen] = useState(null); // ImageData original
  const [res, setRes] = useState(null); // resultado de vectorizar / leerPlanoPDF
  const [sensibilidad, setSensibilidad] = useState(0.14);
  const [minPixeles, setMinPixeles] = useState(40);
  const [medidaMM, setMedidaMM] = useState('');
  const [error, setError] = useState(null);

  const limpiar = () => {
    setArchivo(''); setFuente(null); setImagen(null); setRes(null);
    setMedidaMM(''); setError(null); setSensibilidad(0.14); setMinPixeles(40);
  };

  const cerrar = () => { limpiar(); alCerrar(); };

  const procesar = async (file) => {
    setError(null);
    setTrabajando(true);
    try {
      if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
        const r = await leerPlanoPDF(new Uint8Array(await file.arrayBuffer()));
        setFuente('pdf');
        setImagen(null);
        setRes(r);
        if (!r.vectorial) setError('El PDF no tiene geometría vectorial.');
      } else {
        const img = await pixelesDe(file);
        setFuente('imagen');
        setImagen(img);
        setRes(vectorizar(img, { sensibilidad, minPixeles }));
      }
      setArchivo(file.name);
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
  }, [res, imagen, fuente]);

  /* La escala. En el PDF no hace falta; en la imagen la pone una persona
     diciendo cuánto mide el ancho total de lo que se detectó. */
  const anchoDetectadoPx = res?.contornos?.[0]?.bbox?.w ?? 0;
  const mmPorPx =
    fuente === 'imagen' && medidaMM
      ? escalaDesdeReferencia(anchoDetectadoPx, parseFloat(medidaMM))
      : null;

  let vistaPrevia = null;
  if (res?.contornos?.length && (fuente === 'pdf' || mmPorPx)) {
    try {
      const p =
        fuente === 'pdf'
          ? planoAPieza(res.contornos)
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

  const usar = () => {
    if (!vistaPrevia || vistaPrevia.error) return;
    const it = itemNuevo(materiales, {
      origen: 'plano',
      nombre: archivo.replace(/\.[^.]+$/, ''),
      shape: vistaPrevia.shape,
      archivo,
      meta: { modelo3D: { tipo: 'plano' } },
    });
    delete it.piezaId;
    delete it.params;
    agregarItem(it);
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
          ref={entrada} type="file" accept="image/*,.pdf,application/pdf" className="hidden"
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
                  {fuente === 'pdf' ? 'PDF vectorial · medidas exactas' : 'Imagen · hay que calibrar'}
                </Insignia>
              </div>
              <div className="mt-2 overflow-hidden rounded-lg border border-borde bg-white">
                <canvas ref={lienzo} className="block max-w-full" />
              </div>
              <p className="mt-1.5 text-[11px] text-tenue">
                En naranja el contorno exterior de la pieza; en verde los agujeros y las demás
                partes. Si aparecen las cotas o el membrete, recortá la imagen o subí el tamaño
                mínimo.
              </p>
            </div>

            <div className="space-y-3">
              {fuente === 'imagen' ? (
                <>
                  <Campo
                    etiqueta="¿Cuánto mide el ancho de la pieza?"
                    ayuda="Es lo único que el sistema no puede saber solo. Tomá la cota más larga del plano."
                  >
                    <Entrada
                      type="number" step="any" unidad="mm" autoFocus
                      value={medidaMM}
                      onChange={(e) => setMedidaMM(e.target.value)}
                      placeholder={`${num(anchoDetectadoPx, 0)} px detectados`}
                    />
                  </Campo>

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
              ) : (
                <Aviso nivel="ok">
                  El PDF trae la geometría en unidades reales: no hay nada que calibrar.
                </Aviso>
              )}

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
                    Cargá la medida de referencia para ver la pieza.
                  </p>
                )}
              </div>

              <div className="flex gap-2">
                <Boton tam="sm" onClick={limpiar}>Otro archivo</Boton>
                <Boton
                  tam="sm" tono="corte" className="flex-1"
                  onClick={usar}
                  disabled={!vistaPrevia || !!vistaPrevia?.error}
                >
                  Usar esta pieza
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
