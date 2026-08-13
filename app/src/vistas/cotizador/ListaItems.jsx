import { useMemo, useState } from 'react';
import { Plus, Upload, Copy, X, Package, Image } from 'lucide-react';
import { usarCotizador } from './contexto';
import { Biblioteca, ImportarDXF } from './Modales';
import { ImportarPlano } from './ImportarPlano';
import { Panel, PanelCab, PanelTitulo, PanelCuerpo } from '@/componentes/ui/panel';
import { Boton } from '@/componentes/ui/boton';
import { miniatura } from '@/lib/miniatura';
import { usarEstado } from '@/lib/estado';
import { money, num } from '@/lib/formato';
import { cn } from '@/lib/utils';

function Miniatura({ shape }) {
  // Redibujar la miniatura en cada tecla es caro y no aporta nada: la lista
  // es de referencia, el plano grande está al lado.
  const src = useMemo(() => (shape ? miniatura(shape, 84, 84) : null), [shape]);
  if (!src) {
    return (
      <div className="grid size-11 shrink-0 place-items-center rounded-lg border border-borde bg-panel-alto">
        <Package className="size-4 text-tenue" />
      </div>
    );
  }
  return (
    <img
      src={src} alt=""
      className="size-11 shrink-0 rounded-lg border border-borde bg-white object-contain"
    />
  );
}

export function ListaItems() {
  const { doc, sel, setSel, coti, resueltos, quitarItem, duplicarItem } = usarCotizador();
  const sim = usarEstado((s) => s.simbolo());
  const [abrirBiblioteca, setAbrirBiblioteca] = useState(false);
  const [abrirDXF, setAbrirDXF] = useState(false);
  const [abrirPlano, setAbrirPlano] = useState(false);

  return (
    <>
      <Panel className="lg:sticky lg:top-[76px]">
        <PanelCab>
          <PanelTitulo>Ítems ({doc.items.length})</PanelTitulo>
        </PanelCab>

        <PanelCuerpo sinPad>
          <ul className="max-h-[46vh] overflow-y-auto">
            {doc.items.map((it, i) => {
              const r = coti?.items[i];
              const activo = i === sel;
              return (
                <li
                  key={i}
                  onClick={() => setSel(i)}
                  className={cn(
                    'group flex cursor-pointer items-center gap-2.5 border-b border-borde px-3 py-2.5 transition-colors last:border-0',
                    activo
                      ? 'bg-corte-500/10 border-l-[3px] border-l-corte-500 pl-[9px]'
                      : 'hover:bg-panel-alto'
                  )}
                >
                  <Miniatura shape={resueltos[i]?.shape} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold">{it.nombre || 'Pieza'}</div>
                    <div className="truncate text-[11.5px] text-suave tabular">
                      {it.cantidad} u · {num(it.espesor, 1)} mm ·{' '}
                      {r ? money(r.precio.neto, sim, 0) : '—'}
                    </div>
                  </div>
                  <Boton
                    tono="peligro" tam="iconoSm" title="Quitar"
                    className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 border-0"
                    onClick={(e) => {
                      e.stopPropagation();
                      quitarItem(i);
                    }}
                  >
                    <X />
                  </Boton>
                </li>
              );
            })}
            {!doc.items.length && (
              <li className="px-3 py-6 text-center text-xs text-tenue">Sin ítems todavía</li>
            )}
          </ul>
        </PanelCuerpo>

        <PanelCuerpo className="space-y-2 border-t border-borde">
          <div className="grid grid-cols-2 gap-2">
            <Boton tono="corte" onClick={() => setAbrirBiblioteca(true)}>
              <Plus />
              Biblioteca
            </Boton>
            <Boton onClick={() => setAbrirDXF(true)}>
              <Upload />
              Importar DXF
            </Boton>
          </div>
          {/* El camino más frecuente: el cliente manda una foto del plano por
              WhatsApp o un PDF del CAD. Antes eso se redibujaba a mano. */}
          <Boton ancho="completo" onClick={() => setAbrirPlano(true)}>
            <Image />
            Importar plano (imagen o PDF)
          </Boton>
          <Boton ancho="completo" tono="fantasma" onClick={duplicarItem} disabled={!doc.items.length}>
            <Copy />
            Duplicar el ítem actual
          </Boton>
        </PanelCuerpo>
      </Panel>

      <Biblioteca abierto={abrirBiblioteca} alCerrar={() => setAbrirBiblioteca(false)} />
      <ImportarDXF abierto={abrirDXF} alCerrar={() => setAbrirDXF(false)} />
      <ImportarPlano abierto={abrirPlano} alCerrar={() => setAbrirPlano(false)} />
    </>
  );
}
