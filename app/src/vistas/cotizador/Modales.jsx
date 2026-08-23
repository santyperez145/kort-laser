import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Upload, FileUp, Search, Scissors } from 'lucide-react';

import { usarCotizador, itemNuevo } from './contexto';
import { Dialogo, ContenidoDialogo, Aviso } from '@/componentes/ui/varios';
import { Boton } from '@/componentes/ui/boton';
import { Insignia } from '@/componentes/ui/insignia';
import { Entrada } from '@/componentes/ui/campos';
import { miniatura } from '@/lib/miniatura';
import { usarEstado } from '@/lib/estado';
import { num } from '@/lib/formato';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';

import { categorias, getPieza, paramsPorDefecto } from '@core/library.js';
import { catalogo, paramsDeVariante, resumenCatalogo } from '@core/variantes.js';
import { leerDXF } from '@core/dxf-read.js';
import { shapeBBox } from '@core/geometry.js';
import { auditarFabricabilidad } from '@core/fabricabilidad.js';

/* ------------------------------------------------------------------ */
/* Biblioteca de piezas paramétricas                                   */
/* ------------------------------------------------------------------ */

export function Biblioteca({ abierto, alCerrar }) {
  const { doc, sel, setDoc, agregarItem } = usarCotizador();
  const materiales = usarEstado((s) => s.materiales);
  const [busca, setBusca] = useState('');

  /* El catálogo son las familias (para diseñar) más todas sus medidas
     normalizadas (para el mostrador, donde nadie piensa en parámetros sino en
     "una brida DN100"). Sin buscar se muestran sólo las familias: 362 entradas
     de una no se leen. Apenas se escribe algo, se busca en todo. */
  const [verMedidas, setVerMedidas] = useState(false);
  const todo = useMemo(() => catalogo(), []);
  const resumen = useMemo(() => resumenCatalogo(), []);

  const cats = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const base = q || verMedidas ? todo : todo.filter((x) => !x.esVariante);
    const filtradas = q
      ? base.filter(
          (p) =>
            p.nombre.toLowerCase().includes(q) ||
            (p.descripcion || '').toLowerCase().includes(q) ||
            (p.categoria || '').toLowerCase().includes(q)
        )
      : base;
    const porCat = new Map();
    for (const p of filtradas) {
      const c = p.categoria || 'Otros';
      if (!porCat.has(c)) porCat.set(c, []);
      porCat.get(c).push(p);
    }
    return [...porCat.entries()]
      .map(([nombre, piezas]) => ({ nombre, piezas }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [busca, verMedidas, todo]);

  const elegir = (entrada) => {
    const piezaId = typeof entrada === 'string' ? entrada : entrada.piezaId;
    const def = getPieza(piezaId);
    const actual = doc.items[sel];
    // Una medida normalizada trae sus cotas cargadas; una familia, las de fábrica
    const params =
      typeof entrada === 'string' || !entrada.esVariante
        ? paramsPorDefecto(piezaId)
        : paramsDeVariante(entrada);
    const nombre = typeof entrada === 'string' ? def.nombre : entrada.nombre || def.nombre;

    if (actual && actual.origen === 'libreria') {
      // Cambiar la pieza del ítem actual, no agregar uno nuevo: es lo que
      // espera quien está probando formas antes de decidir.
      setDoc((d) => {
        const items = d.items.slice();
        items[sel] = {
          ...items[sel],
          origen: 'libreria',
          piezaId,
          params,
          nombre,
        };
        return { ...d, items };
      });
    } else {
      agregarItem(
        itemNuevo(materiales, { piezaId, params, nombre })
      );
    }
    alCerrar();
  };

  return (
    <Dialogo open={abierto} onOpenChange={(v) => !v && alCerrar()}>
      <ContenidoDialogo
        titulo={`Biblioteca · ${resumen.total} piezas`}
        descripcion="Elegí una familia para diseñar con parámetros, o una medida normalizada que ya viene con sus cotas cargadas."
        ancho="max-w-5xl"
      >
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-tenue" />
            <Entrada
              autoFocus placeholder="Buscar por nombre o medida — «DN100», «bandeja 200», «celosía»…"
              className="pl-9"
              value={busca} onChange={(e) => setBusca(e.target.value)}
            />
          </div>
          <Boton
            tam="sm"
            tono={verMedidas ? 'acero' : 'neutro'}
            onClick={() => setVerMedidas((v) => !v)}
          >
            {verMedidas ? 'Ver sólo familias' : `Ver las ${resumen.medidas} medidas`}
          </Boton>
        </div>

        <p className="mb-3 text-[11.5px] leading-snug text-suave">
          <strong>{resumen.familias} familias</strong> para diseñar con parámetros, y{' '}
          <strong>{resumen.medidas} medidas normalizadas</strong> listas para cotizar —bridas DIN,
          caños en pulgadas, bandejas IEC, rack 19″—. Todas se recalculan al cambiar material o
          espesor.
        </p>

        {cats.map((cat) => (
          <div key={cat.nombre} className="mb-5 last:mb-0">
            <h4 className="mb-2 text-[11px] font-bold uppercase tracking-[0.6px] text-corte-500">
              {cat.nombre}
            </h4>
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {cat.piezas.map((p, i) => (
                <button
                  key={p.piezaId + '-' + p.nombre + i}
                  onClick={() => elegir(p)}
                  className={cn(
                    'rounded-xl border border-borde bg-panel p-3 text-left transition-all cursor-pointer',
                    'hover:border-corte-500 hover:-translate-y-px hover:shadow-lg hover:shadow-corte-500/10'
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-[13.5px] font-semibold">{p.nombre}</span>
                    {p.esVariante ? (
                      <Insignia tono="azul" className="shrink-0 text-[9.5px]">medida</Insignia>
                    ) : null}
                  </div>
                  <p className="mt-1 text-[11.5px] leading-relaxed text-suave">{p.descripcion}</p>
                </button>
              ))}
            </div>
          </div>
        ))}

        {!cats.length && (
          <p className="py-10 text-center text-sm text-tenue">
            Ninguna pieza coincide con «{busca}».
          </p>
        )}
      </ContenidoDialogo>
    </Dialogo>
  );
}

/* ------------------------------------------------------------------ */
/* Importar DXF                                                        */
/* ------------------------------------------------------------------ */

export function ImportarDXF({ abierto, alCerrar }) {
  const { doc, sel, agregarItem } = usarCotizador();
  const materiales = usarEstado((s) => s.materiales);
  const laser = usarEstado((s) => s.maquinas.find((m)=>m.tipo==='laser') || s.maquinas[0]);
  const entrada = useRef(null);
  const [encima, setEncima] = useState(false);
  const [lectura, setLectura] = useState(null);
  const [nombreArchivo, setNombreArchivo] = useState('');
  const [textoOriginal, setTextoOriginal] = useState('');
  // Separar es una decisión explícita: por defecto se respeta el diseño.
  // Arranca en lo que sugiere el análisis del dibujo, no siempre en "conjunto":
  // un archivo con doce copias de la misma pieza es un lote, no un cartel.
  const [separar, setSeparar] = useState(false);

  const procesar = (file) => {
    if (!/\.dxf$/i.test(file.name)) return setLectura({ error:'El archivo debe ser DXF.', avisos:[], piezas:[] });
    if (file.size > 8*1024*1024) return setLectura({ error:'El DXF supera 8 MB. Exportá sólo la geometría de corte necesaria.', avisos:[], piezas:[] });
    const lector = new FileReader();
    lector.onload = () => {
      try {
        const texto=String(lector.result);
        const r = leerDXF(texto, { espesor: doc.items[sel]?.espesor || 2 });
        setLectura(r);
        setNombreArchivo(file.name);
        setTextoOriginal(texto);
        // Se arranca en lo que el análisis del dibujo sugiere. Sigue siendo
        // una propuesta: el selector queda a la vista para cambiarla.
        setSeparar(r.agrupamiento?.sugerencia === 'sueltas');
      } catch (e) {
        setLectura({ error: e.message, avisos: [], piezas: [] });
      }
    };
    lector.readAsText(file);
  };

  const auditoriaDe = (shape) => auditarFabricabilidad(shape, { espesor:doc.items[sel]?.espesor||2, mesa:laser?.areaTrabajo||{w:3000,h:1500} });
  const auditoriaConjunto = lectura?.conjunto ? auditoriaDe(lectura.conjunto) : null;
  const auditoriasPiezas = (lectura?.piezas||[]).map((p)=>auditoriaDe({outer:p.outer,holes:p.holes,pliegues:[]}));
  const guardarOriginal = async () => {
    const guardado=await api.guardarArchivo(`${Date.now()}-${nombreArchivo.replace(/[^\w.áéíóúñÁÉÍÓÚÑ-]/g,'_')}`,textoOriginal,'planos-clientes');
    return guardado.ruta;
  };

  const nuevoItemDXF = (shape, sufijo = '', rutaOriginal = '') => {
    const it = itemNuevo(materiales, {
      origen: 'dxf',
      nombre: `${nombreArchivo.replace(/\.dxf$/i, '')}${sufijo}`,
      shape,
      archivo: nombreArchivo,
      ...(doc.items[sel] ? { materialId:doc.items[sel].materialId, espesor:doc.items[sel].espesor } : {}),
      meta: { modelo3D: { tipo: 'plano' }, planoImportado:{ tipo:'dxf',archivo:nombreArchivo,rutaOriginal,fecha:new Date().toISOString() } },
    });
    delete it.piezaId;
    delete it.params;
    return it;
  };

  /** El dibujo tal cual lo mandó el cliente, con sus posiciones relativas. */
  const agregarConjunto = async () => {
    if(auditoriaConjunto?.bloqueado)return toast.error(`DXF bloqueado: ${auditoriaConjunto.errores[0].msg}`);
    try { const ruta=await guardarOriginal(); agregarItem(nuevoItemDXF({ ...lectura.conjunto, pliegues: [] },'',ruta)); cerrar(); toast.success('Dibujo importado como una pieza'); }
    catch(e){toast.error(`No se guardó el DXF original: ${e.message}`);}
  };

  const agregarParte = (p, n, rutaOriginal) => {
    const shape={ outer:p.outer,holes:p.holes,pliegues:[] };
    if(auditoriaDe(shape).bloqueado)return false;
    agregarItem(nuevoItemDXF(shape, n > 1 ? ' · ' + n : '',rutaOriginal)); return true;
  };

  const cerrar = () => {
    setLectura(null);
    setNombreArchivo('');
    setTextoOriginal('');
    setSeparar(false);
    alCerrar();
  };

  return (
    <Dialogo open={abierto} onOpenChange={(v) => !v && cerrar()}>
      <ContenidoDialogo
        titulo="Importar DXF y cotizar"
        descripcion="Se leen LINE, ARC, CIRCLE, LWPOLYLINE, POLYLINE, ELLIPSE, SPLINE y bloques. Las capas PLEGADO / BEND se interpretan como líneas de plegado y no se cortan."
        ancho="max-w-4xl"
      >
        <input
          ref={entrada} type="file" accept=".dxf" className="hidden"
          onChange={(e) => e.target.files?.[0] && procesar(e.target.files[0])}
        />

        <button
          type="button"
          onClick={() => entrada.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setEncima(true);
          }}
          onDragLeave={() => setEncima(false)}
          onDrop={(e) => {
            e.preventDefault();
            setEncima(false);
            if (e.dataTransfer.files[0]) procesar(e.dataTransfer.files[0]);
          }}
          className={cn(
            'flex w-full flex-col items-center rounded-xl border-2 border-dashed px-6 py-9 transition-colors cursor-pointer',
            encima
              ? 'border-corte-500 bg-corte-500/10 text-corte-500'
              : 'border-borde bg-panel-alto text-suave hover:border-borde-fuerte'
          )}
        >
          <Upload className="mb-2 size-7" />
          <strong className="text-sm">Soltá acá el DXF del cliente</strong>
          <span className="mt-1 text-xs text-tenue">o hacé clic para elegir el archivo</span>
        </button>

        {lectura?.error && (
          <Aviso nivel="error" className="mt-4">
            No se pudo leer el archivo: {lectura.error}
          </Aviso>
        )}

        {lectura?.avisos?.map((a, i) => (
          <Aviso key={i} nivel={a.nivel} className="mt-3">
            {a.msg}
          </Aviso>
        ))}

        {lectura?.conjunto ? (
          <>
            <p className="mt-4 text-[11.5px] text-suave">
              {lectura.stats.entidades} entidades · {lectura.stats.contornosCerrados} contornos
              cerrados · unidades: {lectura.unidades}
            </p>

            {/* El dibujo completo, tal cual vino. Es lo que se ofrece primero:
                varios contornos sueltos pueden ser un cartel o un juego que se
                entrega armado, y separarlos de oficio rompe el diseño. */}
            <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start">
              <img
                src={miniatura(lectura.conjunto, 360, 260)} alt="Dibujo completo"
                className="w-full sm:w-[300px] shrink-0 rounded-xl border border-borde bg-white"
              />
              <div className="min-w-0 flex-1">
                <h4 className="text-[15px] font-semibold">El dibujo completo</h4>
                <p className="mt-1 text-[12.5px] leading-relaxed text-suave">
                  {(() => {
                    const b = shapeBBox(lectura.conjunto);
                    const n = lectura.piezas.length;
                    return `${num(b.w, 1)} × ${num(b.h, 1)} mm · ${n} contorno${n === 1 ? '' : 's'} exterior${n === 1 ? '' : 'es'}`;
                  })()}
                </p>
                <p className="mt-2 text-[12px] leading-relaxed text-tenue">
                  Se importa como una sola pieza, respetando las posiciones que dibujó el cliente.
                </p>
                <Boton tono="corte" className="mt-3" onClick={agregarConjunto} disabled={auditoriaConjunto?.bloqueado}>
                  <FileUp />
                  Importar el dibujo completo
                </Boton>
                {auditoriaConjunto && <div className="mt-3 rounded-lg border border-borde p-2 text-[11px]"><b>Auditoría: {auditoriaConjunto.bloqueado?'bloqueado':auditoriaConjunto.avisos.length?`${auditoriaConjunto.avisos.length} revisión(es)`:'geometría válida'}</b>{[...auditoriaConjunto.errores,...auditoriaConjunto.avisos].map((a,i)=><p key={a.codigo+i} className={i<auditoriaConjunto.errores.length?'text-peligro-500':'text-suave'}>• {a.msg}</p>)}</div>}
              </div>
            </div>

            {lectura.piezas.length > 1 && (
              <div className="mt-5 border-t border-borde pt-4">
                {/* El sistema mira el dibujo y propone lo más probable, con el
                    motivo a la vista. La decisión final la toma quien cotiza:
                    sólo el cliente sabe si eso es un cartel o un lote. */}
                <div className="mb-3 rounded-xl border border-borde bg-panel-alto p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-wide text-tenue">
                      ¿Qué es este dibujo?
                    </span>
                    {lectura.agrupamiento && (
                      <Insignia tono={lectura.agrupamiento.confianza >= 0.8 ? 'verde' : 'amarillo'}>
                        {lectura.agrupamiento.confianza >= 0.8 ? 'Detectado' : 'No es seguro'}
                      </Insignia>
                    )}
                  </div>

                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <button
                      onClick={() => setSeparar(false)}
                      className={`rounded-lg border p-2.5 text-left transition ${
                        !separar ? 'border-corte-500 bg-corte-500/8' : 'border-borde hover:border-borde-fuerte'
                      }`}
                    >
                      <div className="text-[13px] font-semibold">Un solo diseño</div>
                      <div className="mt-0.5 text-[11px] leading-snug text-suave">
                        Cartel, juego que se entrega armado, o piezas cuya separación es parte del
                        pedido. Se respetan las posiciones del archivo.
                      </div>
                    </button>
                    <button
                      onClick={() => setSeparar(true)}
                      className={`rounded-lg border p-2.5 text-left transition ${
                        separar ? 'border-corte-500 bg-corte-500/8' : 'border-borde hover:border-borde-fuerte'
                      }`}
                    >
                      <div className="text-[13px] font-semibold">
                        {lectura.piezas.length} piezas sueltas
                      </div>
                      <div className="mt-0.5 text-[11px] leading-snug text-suave">
                        Cada contorno es un ítem propio y se anida por su cuenta. Se puede pedir
                        distinta cantidad de cada una.
                      </div>
                    </button>
                  </div>

                  {lectura.agrupamiento && (
                    <p className="mt-2 text-[11.5px] leading-snug text-tenue">
                      {lectura.agrupamiento.motivo}
                    </p>
                  )}
                </div>

                {separar && (
                  <>

                    <div className="mt-3 grid gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
                      {lectura.piezas.map((p, i) => {
                        const sh = { outer: p.outer, holes: p.holes, pliegues: [] };
                        const b = shapeBBox(sh);
                        const audit = auditoriasPiezas[i];
                        return (
                          <button
                            key={i}
                            disabled={audit?.bloqueado}
                            onClick={async () => {
                              try { const ruta=await guardarOriginal(); if(!agregarParte(p,i+1,ruta))return toast.error('Esa pieza tiene errores geométricos.'); cerrar(); toast.success('Pieza importada y cotizada'); }
                              catch(e){toast.error(`No se guardó el DXF original: ${e.message}`);}
                            }}
                            className="rounded-xl border border-borde bg-panel p-2.5 text-left transition-all cursor-pointer hover:border-corte-500 hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <img
                              src={miniatura(sh, 220, 170)} alt=""
                              className="w-full rounded-lg bg-white"
                            />
                            <div className="mt-2 text-[13px] font-semibold">Pieza {i + 1}</div>
                            <div className="text-[11px] text-suave tabular">
                              {num(b.w, 1)} × {num(b.h, 1)} mm · {p.holes.length} agujeros
                            </div>
                            {audit?.bloqueado && <div className="mt-1 text-[10px] text-peligro-500">Bloqueada: {audit.errores[0].msg}</div>}
                          </button>
                        );
                      })}
                    </div>

                    <Boton
                      ancho="completo" className="mt-4"
                      disabled={auditoriasPiezas.some((a)=>a.bloqueado)}
                      onClick={async () => {
                        try { const ruta=await guardarOriginal(); const n=lectura.piezas.filter((p,i)=>agregarParte(p,i+1,ruta)).length; cerrar(); toast.success(`${n} piezas válidas importadas por separado`); }
                        catch(e){toast.error(`No se guardó el DXF original: ${e.message}`);}
                      }}
                    >
                      <Scissors />
                      Agregar las {lectura.piezas.length} por separado
                    </Boton>
                  </>
                )}
              </div>
            )}
          </>
        ) : null}
      </ContenidoDialogo>
    </Dialogo>
  );
}
