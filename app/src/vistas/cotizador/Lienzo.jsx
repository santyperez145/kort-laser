/**
 * El plano de la pieza: 2D, 3D y nesting.
 *
 * Debajo van los avisos de fabricabilidad, que son la parte que evita
 * vender lo que no se puede entregar: una pieza más grande que la mesa, un
 * ala más corta que el mínimo de la matriz, un espesor fuera de tabla.
 */

import { useEffect, useMemo, useState } from 'react';
import { Ruler, Box, Grid3x3, Download, Route, Frame, Grid2x2, Gift, Loader2 } from 'lucide-react';

import { usarCotizador } from './contexto';
import { descargarDXFItem, descargarDXFNesting } from './acciones';
import { rellenoSinCosto } from '@core/nesting.js';
import { Visor2D } from '@/componentes/visores/Visor2D';
import { Visor3D } from '@/componentes/visores/Visor3D';
import { VisorNesting } from '@/componentes/visores/VisorNesting';
import { Panel, PanelCab, PanelCuerpo, Vacio } from '@/componentes/ui/panel';
import { Boton } from '@/componentes/ui/boton';
import {
  Pestanias, ListaPestanias, Pestania, ContenidoPestania, Aviso,
} from '@/componentes/ui/varios';
import { usarEstado } from '@/lib/estado';
import { num, pct } from '@/lib/formato';

import { construirMesh } from '@core/mesh3d.js';
import { radioInterno, matrizRecomendada, validarPlegado } from '@core/bending.js';
import { shapeBBox } from '@core/geometry.js';

const ALTO = 400;

export function Lienzo() {
  const { doc, item, resuelto, resueltos, r } = usarCotizador();
  const materiales = usarEstado((s) => s.materiales);
  const config = usarEstado((s) => s.config);
  const laser = usarEstado((s) => s.laser());
  const plegadora = usarEstado((s) => s.plegadora());

  const [pestania, setPestania] = useState('2d');
  const [ops, setOps] = useState({ grilla: true, cotas: true, recorrido: false });
  const [relleno, setRelleno] = useState(null);
  const [calculandoRelleno, setCalculandoRelleno] = useState(false);

  // La sugerencia deja de valer apenas cambia el lote: se borra sola.
  useEffect(() => {
    setRelleno(null);
  }, [r?.nesting?.chapasGrupo, r?.nesting?.aprovechamiento, doc.items.length]);

  const material = materiales.find((m) => m.id === item?.materialId) || materiales[0];

  const modelo3D = useMemo(() => {
    if (pestania !== '3d' || !resuelto?.shape || !material) return null;
    try {
      const Ri = radioInterno(item.plegado?.matrizV || matrizRecomendada(item.espesor), material);
      return construirMesh({ shape: resuelto.shape, modelo3D: resuelto._meta?.modelo3D }, item.espesor, Ri);
    } catch {
      return null;
    }
  }, [pestania, resuelto, material, item]);

  /* ---------------- Avisos de fabricabilidad ---------------- */
  const avisos = useMemo(() => {
    if (!item) return [];
    const out = [...(resuelto?._avisos || [])];

    if (r?.datosPliegue && plegadora) {
      out.push(
        ...validarPlegado(
          {
            t: item.espesor,
            material,
            pliegues: [r.datosPliegue],
            largoMM: item.plegado?.largoPliegue || 0,
            alas: resuelto?._meta?.alas || [],
          },
          plegadora
        )
      );
    }
    if (r?.nesting?.error) {
      out.push({ nivel: 'error', msg: r.nesting.error + '. Reducí la medida o cambiá la chapa.' });
    }
    if (r && r.geometria.ancho > (laser?.areaTrabajo?.w || 3000)) {
      out.push({ nivel: 'error', msg: 'La pieza excede el área de trabajo de la máquina.' });
    }
    if (r?.nesting?.aprovechamientoUltima != null && r.nesting.aprovechamientoUltima < 0.45 && r.nesting.chapas >= 1) {
      out.push({
        nivel: 'info',
        msg: `La última chapa queda al ${pct(r.nesting.aprovechamientoUltima * 100, 0)} de uso. Ofrecerle más piezas al cliente casi no aumenta el costo de material.`,
      });
    }
    return out;
  }, [item, resuelto, r, material, plegadora, laser]);

  /**
   * "¿Qué más entra en esta chapa sin que aumente el material?"
   *
   * Se calcula a pedido y no con cada tecla: cada tanteo es un nesting
   * completo, y en el camino del precio dejaría la pantalla pegajosa.
   */
  const calcularRelleno = () => {
    if (!r?.nesting || r.nesting.error) return;
    setCalculandoRelleno(true);
    // Un cuadro para que el botón alcance a pintarse antes de bloquear el hilo
    setTimeout(() => {
      try {
        const prod = config.produccion;
        const opts = {
          separacion: prod.separacionPiezas,
          margen: prod.margenChapa,
          formaReal: prod.nestingFormaReal !== false,
        };
        // Los ids del layout son 'i' + índice del ítem: de ahí sale quién está
        // en el grupo sin tener que volver a agruparlos acá.
        const indices = r.nesting.compartido
          ? [...new Set(r.nesting.layout.flatMap((ch) => ch.piezas.map((p) => Number(String(p.id).slice(1)))))]
          : [doc.items.indexOf(item)];

        const piezas = indices
          .filter((i) => i >= 0 && resueltos[i]?.shape)
          .map((i) => {
            const b = shapeBBox(resueltos[i].shape);
            return {
              id: 'i' + i,
              nombre: doc.items[i].nombre || 'Pieza',
              w: b.w,
              h: b.h,
              cantidad: Math.max(1, Math.round(doc.items[i].cantidad || 1)),
              shape: resueltos[i].shape,
            };
          });

        setRelleno(piezas.length ? rellenoSinCosto(piezas, r.nesting.chapa, opts) : []);
      } catch {
        setRelleno([]);
      } finally {
        setCalculandoRelleno(false);
      }
    }, 30);
  };

  if (!item) {
    return (
      <Panel>
        <Vacio
          icono={<Frame />}
          titulo="Agregá una pieza para empezar"
          detalle="Elegila de la biblioteca o importá el DXF que te mandó el cliente."
        />
      </Panel>
    );
  }

  const alternar = (k) => setOps((o) => ({ ...o, [k]: !o[k] }));

  return (
    <>
      <Panel>
        <Pestanias value={pestania} onValueChange={setPestania}>
          <PanelCab
            acciones={
              <>
                {pestania === 'nest' && r?.nesting && !r.nesting.error ? (
                  <Boton tam="sm" onClick={calcularRelleno} disabled={calculandoRelleno}>
                    {calculandoRelleno ? <Loader2 className="animate-spin" /> : <Gift />}
                    ¿Qué más entra?
                  </Boton>
                ) : null}
                <Boton
                  tam="sm"
                  onClick={() =>
                    pestania === 'nest'
                      ? descargarDXFNesting(item, resuelto, r)
                      : descargarDXFItem(item, resuelto)
                  }
                >
                  <Download />
                  {pestania === 'nest' ? 'DXF de chapa' : 'DXF'}
                </Boton>
              </>
            }
          >
            <ListaPestanias>
              <Pestania value="2d"><Ruler />Plano 2D</Pestania>
              <Pestania value="3d"><Box />Modelo 3D</Pestania>
              <Pestania value="nest"><Grid3x3 />Nesting</Pestania>
            </ListaPestanias>
          </PanelCab>

          <PanelCuerpo sinPad>
            <ContenidoPestania value="2d" className="relative">
              <Visor2D shape={resuelto?.shape} alto={ALTO} opciones={ops} />
              <div className="absolute right-2.5 top-2.5 flex gap-1">
                <Boton
                  tam="sm" tono={ops.recorrido ? 'corte' : 'neutro'}
                  className={ops.recorrido ? '' : 'bg-panel/90 backdrop-blur'}
                  onClick={() => alternar('recorrido')}
                >
                  <Route />Recorrido
                </Boton>
                <Boton
                  tam="sm" tono={ops.cotas ? 'corte' : 'neutro'}
                  className={ops.cotas ? '' : 'bg-panel/90 backdrop-blur'}
                  onClick={() => alternar('cotas')}
                >
                  <Ruler />Cotas
                </Boton>
                <Boton
                  tam="sm" tono={ops.grilla ? 'corte' : 'neutro'}
                  className={ops.grilla ? '' : 'bg-panel/90 backdrop-blur'}
                  onClick={() => alternar('grilla')}
                >
                  <Grid2x2 />Grilla
                </Boton>
              </div>
              {r ? (
                <div className="pointer-events-none absolute bottom-2.5 left-2.5 rounded-lg bg-black/65 px-2.5 py-1 font-mono text-[11px] text-white tabular">
                  {num(r.geometria.ancho, 1)} × {num(r.geometria.alto, 1)} mm · corte{' '}
                  {num(r.geometria.largoCorteMM / 1000, 2)} m · {r.geometria.piercings} perforaciones
                </div>
              ) : null}
            </ContenidoPestania>

            <ContenidoPestania value="3d">
              <Visor3D modelo={modelo3D} alto={ALTO} />
            </ContenidoPestania>

            <ContenidoPestania value="nest" className="relative">
              <VisorNesting
                nesting={r?.nesting}
                alto={ALTO}
                idResaltado={r?.nesting?.compartido ? r.nesting.idEnLayout : null}
              />
              {r?.nesting?.chapas != null ? (
                <div className="pointer-events-none absolute bottom-2.5 left-2.5 rounded-lg bg-black/65 px-2.5 py-1 font-mono text-[11px] text-white tabular">
                  {r.nesting.piezasPorChapa} piezas por chapa ·{' '}
                  {r.nesting.compartido
                    ? `${r.nesting.chapasGrupo} chapa(s) entre ${r.nesting.itemsEnGrupo} ítems`
                    : `${num(r.nesting.chapas, 0)} chapa(s)`} ·
                  aprovechamiento {pct(r.nesting.aprovechamiento * 100, 1)} · anidado por{' '}
                  {r.nesting.metodo || 'rectángulo'}
                </div>
              ) : null}
              {r?.nesting?.compartido ? (
                <div className="pointer-events-none absolute right-2.5 bottom-2.5 flex flex-col gap-1 rounded-lg bg-black/65 px-2.5 py-1.5 text-[11px] text-white">
                  <span className="flex items-center gap-1.5">
                    <span className="size-2.5 rounded-sm bg-[#e4572e]" />
                    {item.nombre || 'Este ítem'}
                  </span>
                  <span className="flex items-center gap-1.5 text-white/70">
                    <span className="size-2.5 rounded-sm bg-[#7a8ea5]" />
                    Otros {r.nesting.itemsEnGrupo - 1} ítem(s) de la misma chapa
                  </span>
                </div>
              ) : null}
            </ContenidoPestania>
          </PanelCuerpo>
        </Pestanias>
      </Panel>

      {/* El material de esa chapa ya está pagado: lo que entre de más sólo
          cuesta tiempo de máquina y gas. Es la oferta con mejor margen que
          puede hacer el taller. */}
      {relleno ? (
        <Aviso nivel={relleno.length ? 'info' : 'aviso'}>
          {relleno.length ? (
            <>
              <strong>En esta chapa todavía entra más, sin pagar más material:</strong>
              <ul className="mt-1.5 space-y-0.5">
                {relleno.map((s) => (
                  <li key={s.id} className="tabular">
                    · <strong>{s.extra}</strong> unidad{s.extra === 1 ? '' : 'es'} más de{' '}
                    {s.nombre}
                    {s.tope ? ' o más' : ''}
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 opacity-80">
                Sólo suman tiempo de máquina y gas. Sirve para ofrecer repuestos en la misma
                entrega o para hacer stock.
              </p>
            </>
          ) : (
            'La chapa ya está aprovechada: no entra ninguna pieza más sin comprar otra.'
          )}
        </Aviso>
      ) : null}

      {avisos.length ? (
        <div className="space-y-2">
          {avisos.map((a, i) => (
            <Aviso key={i} nivel={a.nivel}>
              {a.msg}
            </Aviso>
          ))}
        </div>
      ) : null}
    </>
  );
}
