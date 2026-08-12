import { useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Upload, FileUp, Search } from 'lucide-react';

import { usarCotizador, itemNuevo } from './contexto';
import { Dialogo, ContenidoDialogo, Aviso } from '@/componentes/ui/varios';
import { Boton } from '@/componentes/ui/boton';
import { Entrada } from '@/componentes/ui/campos';
import { miniatura } from '@/lib/miniatura';
import { usarEstado } from '@/lib/estado';
import { num } from '@/lib/formato';
import { cn } from '@/lib/utils';

import { categorias, getPieza, paramsPorDefecto } from '@core/library.js';
import { leerDXF } from '@core/dxf-read.js';
import { shapeBBox } from '@core/geometry.js';

/* ------------------------------------------------------------------ */
/* Biblioteca de piezas paramétricas                                   */
/* ------------------------------------------------------------------ */

export function Biblioteca({ abierto, alCerrar }) {
  const { doc, sel, setDoc, agregarItem } = usarCotizador();
  const materiales = usarEstado((s) => s.materiales);
  const [busca, setBusca] = useState('');

  const cats = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return categorias()
      .map((c) => ({
        ...c,
        piezas: q
          ? c.piezas.filter(
              (p) =>
                p.nombre.toLowerCase().includes(q) ||
                (p.descripcion || '').toLowerCase().includes(q)
            )
          : c.piezas,
      }))
      .filter((c) => c.piezas.length);
  }, [busca]);

  const elegir = (piezaId) => {
    const def = getPieza(piezaId);
    const actual = doc.items[sel];

    if (actual && actual.origen === 'libreria') {
      // Cambiar la pieza del ítem actual, no agregar uno nuevo: es lo que
      // espera quien está probando formas antes de decidir.
      setDoc((d) => {
        const items = d.items.slice();
        items[sel] = {
          ...items[sel],
          origen: 'libreria',
          piezaId,
          params: paramsPorDefecto(piezaId),
          nombre: def.nombre,
        };
        return { ...d, items };
      });
    } else {
      agregarItem(
        itemNuevo(materiales, {
          piezaId,
          params: paramsPorDefecto(piezaId),
          nombre: def.nombre,
        })
      );
    }
    alCerrar();
  };

  return (
    <Dialogo open={abierto} onOpenChange={(v) => !v && alCerrar()}>
      <ContenidoDialogo
        titulo="Biblioteca de piezas paramétricas"
        descripcion="Elegí una forma y ajustá las medidas después. Todas se recalculan solas al cambiar material o espesor."
        ancho="max-w-5xl"
      >
        <div className="relative mb-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-tenue" />
          <Entrada
            autoFocus placeholder="Buscar una pieza…" className="pl-9"
            value={busca} onChange={(e) => setBusca(e.target.value)}
          />
        </div>

        {cats.map((cat) => (
          <div key={cat.nombre} className="mb-5 last:mb-0">
            <h4 className="mb-2 text-[11px] font-bold uppercase tracking-[0.6px] text-corte-500">
              {cat.nombre}
            </h4>
            <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {cat.piezas.map((p) => (
                <button
                  key={p.id}
                  onClick={() => elegir(p.id)}
                  className={cn(
                    'rounded-xl border border-borde bg-panel p-3 text-left transition-all cursor-pointer',
                    'hover:border-corte-500 hover:-translate-y-px hover:shadow-lg hover:shadow-corte-500/10'
                  )}
                >
                  <div className="text-[13.5px] font-semibold">{p.nombre}</div>
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
  const entrada = useRef(null);
  const [encima, setEncima] = useState(false);
  const [lectura, setLectura] = useState(null);
  const [nombreArchivo, setNombreArchivo] = useState('');

  const procesar = (file) => {
    const lector = new FileReader();
    lector.onload = () => {
      try {
        const r = leerDXF(String(lector.result), { espesor: doc.items[sel]?.espesor || 2 });
        setLectura(r);
        setNombreArchivo(file.name);
      } catch (e) {
        setLectura({ error: e.message, avisos: [], piezas: [] });
      }
    };
    lector.readAsText(file);
  };

  const agregar = (p, n) => {
    const shape = { outer: p.outer, holes: p.holes, pliegues: [] };
    const it = itemNuevo(materiales, {
      origen: 'dxf',
      nombre: `${nombreArchivo.replace(/\.dxf$/i, '')}${n > 1 ? ' · ' + n : ''}`,
      shape,
      archivo: nombreArchivo,
      meta: { modelo3D: { tipo: 'plano' } },
    });
    delete it.piezaId;
    delete it.params;
    agregarItem(it);
  };

  const cerrar = () => {
    setLectura(null);
    setNombreArchivo('');
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

        {lectura?.piezas?.length ? (
          <>
            <p className="mt-4 text-[11.5px] text-suave">
              {lectura.stats.entidades} entidades · {lectura.stats.contornosCerrados} contornos
              cerrados · unidades: {lectura.unidades}
            </p>

            <div className="mt-3 grid gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
              {lectura.piezas.map((p, i) => {
                const sh = { outer: p.outer, holes: p.holes, pliegues: [] };
                const b = shapeBBox(sh);
                return (
                  <button
                    key={i}
                    onClick={() => {
                      agregar(p, i + 1);
                      cerrar();
                      toast.success('Pieza importada y cotizada');
                    }}
                    className="rounded-xl border border-borde bg-panel p-2.5 text-left transition-all cursor-pointer hover:border-corte-500 hover:-translate-y-px"
                  >
                    <img
                      src={miniatura(sh, 220, 170)} alt=""
                      className="w-full rounded-lg bg-white"
                    />
                    <div className="mt-2 text-[13px] font-semibold">Pieza {i + 1}</div>
                    <div className="text-[11px] text-suave tabular">
                      {num(b.w, 1)} × {num(b.h, 1)} mm · {p.holes.length} agujeros
                    </div>
                  </button>
                );
              })}
            </div>

            {lectura.piezas.length > 1 && (
              <Boton
                tono="corte" ancho="completo" className="mt-4"
                onClick={() => {
                  lectura.piezas.forEach((p, i) => agregar(p, i + 1));
                  cerrar();
                  toast.success(`${lectura.piezas.length} piezas importadas`);
                }}
              >
                <FileUp />
                Agregar las {lectura.piezas.length} piezas al presupuesto
              </Boton>
            )}
          </>
        ) : null}
      </ContenidoDialogo>
    </Dialogo>
  );
}
