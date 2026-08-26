/**
 * KORT · Aplicar el arreglo que propone un hallazgo
 *
 * Por qué existe: el aviso de que el setup del programa estaba en cero estuvo
 * días en pantalla sin que nadie lo tocara. No porque no se entendiera —el
 * mensaje decía el problema, la consecuencia y hasta el valor de referencia—
 * sino porque arreglarlo pedía salir del Panel, entrar a Máquinas, encontrar
 * el campo y escribir un número. Mientras tanto cada trabajo de pocas piezas
 * se cotizaba por debajo del costo.
 *
 * Un aviso que no se puede accionar donde se lee se aprende a ignorar, y un
 * aviso ignorado es peor que no tenerlo: ocupa lugar y enseña a saltear los
 * demás.
 *
 * Las tres reglas que hacen que el botón sea seguro:
 *
 * 1. **Vista previa siempre.** Se muestra qué hay hoy y qué quedaría, campo
 *    por campo. Nada se aplica sin que alguien lo lea.
 * 2. **No pisa lo cargado a mano.** `salud.js` sólo propone los campos que
 *    están vacíos; acá además se vuelve a mostrar el valor actual al lado,
 *    así un reemplazo inesperado se ve antes de confirmar.
 * 3. **Es un punto de partida, no una medición.** El texto lo dice sin
 *    suavizarlo: son valores de referencia de industria y hay que cronometrar
 *    los propios. Presentar una referencia como si fuera un dato del taller
 *    sería exactamente el problema que este panel viene a resolver.
 */

import { useState } from 'react';
import { Wrench } from 'lucide-react';
import { toast } from 'sonner';

import { Boton } from '@/componentes/ui/boton';
import { Dialogo, DisparadorDialogo, ContenidoDialogo, CerrarDialogo, Aviso } from '@/componentes/ui/varios';
import { usarEstado } from '@/lib/estado';

/* Cómo se lee cada campo. Un `180` suelto no dice nada; "180 s (3 min)" sí, y
   la equivalencia en minutos es la que deja ver de un vistazo si el número es
   creíble para el taller. */
const CAMPOS = {
  tiempoSetupPrograma: {
    nombre: 'Setup del programa',
    mostrar: (v) => `${v} s${v >= 60 ? ` (${(v / 60).toFixed(v % 60 ? 1 : 0)} min)` : ''}`,
  },
  tiempoCargaChapa: {
    nombre: 'Carga de chapa',
    mostrar: (v) => `${v} s${v >= 60 ? ` (${(v / 60).toFixed(v % 60 ? 1 : 0)} min)` : ''}`,
  },
  aprovechamientoObjetivo: {
    nombre: 'Aprovechamiento objetivo',
    mostrar: (v) => `${Math.round(v * 100)} %`,
  },
};

const leer = (campo, v) =>
  v == null || v === '' ? 'sin cargar' : (CAMPOS[campo]?.mostrar?.(v) ?? String(v));

export function ArreglarHallazgo({ arreglo }) {
  const { config, maquinas, guardarConfig, guardarMaquinas } = usarEstado();
  const [abierto, setAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);

  if (!arreglo?.campos || !Object.keys(arreglo.campos).length) return null;

  const esMaquina = arreglo.destino === 'maquina';
  const maquina = esMaquina ? (maquinas || []).find((m) => m.id === arreglo.id) : null;

  // Si el arreglo apunta a una máquina que ya no está, no se ofrece el botón:
  // aplicarlo crearía una máquina fantasma o fallaría en silencio.
  if (esMaquina && !maquina) return null;

  const actual = esMaquina ? maquina : config?.comercial || {};
  const filas = Object.entries(arreglo.campos).map(([campo, valor]) => ({
    campo,
    nombre: CAMPOS[campo]?.nombre || campo,
    antes: actual?.[campo],
    despues: valor,
  }));

  // Un arreglo que no cambia nada no se ofrece: el botón quedaría sin efecto y
  // eso enseña a desconfiar del resto.
  const pisaAlgo = filas.some((f) => f.antes != null && f.antes !== '' && Number(f.antes) !== 0);

  async function aplicar() {
    setGuardando(true);
    try {
      if (esMaquina) {
        await guardarMaquinas(
          maquinas.map((m) => (m.id === arreglo.id ? { ...m, ...arreglo.campos } : m)),
        );
      } else {
        await guardarConfig({ comercial: { ...(config?.comercial || {}), ...arreglo.campos } });
      }
      toast.success('Aplicado', {
        description: 'Los precios se recalculan con el valor nuevo. Cronometrá el tuyo y corregilo.',
      });
      setAbierto(false);
    } catch (e) {
      // Sin `?? algo`: si no se pudo guardar hay que decirlo, no dejar el
      // diálogo cerrado como si hubiera andado.
      toast.error('No se pudo guardar', { description: e.message });
    } finally {
      setGuardando(false);
    }
  }

  return (
    <Dialogo open={abierto} onOpenChange={setAbierto}>
      <DisparadorDialogo asChild>
        <Boton tam="sm" tono="neutro" className="mt-2">
          <Wrench className="size-3.5" />
          {arreglo.etiqueta || 'Aplicar el valor de referencia'}
        </Boton>
      </DisparadorDialogo>

      <ContenidoDialogo
        ancho="max-w-lg"
        titulo={arreglo.etiqueta || 'Aplicar el valor de referencia'}
        descripcion={esMaquina ? `Máquina: ${maquina.nombre || maquina.id}` : 'Configuración → Comercial'}
      >
        <div className="space-y-3">
          <div className="overflow-hidden rounded-lg border border-borde">
            <table className="w-full text-[13px]">
              <thead className="bg-panel-alto text-[11px] uppercase tracking-wide text-tenue">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">Campo</th>
                  <th className="px-3 py-2 text-right font-semibold">Hoy</th>
                  <th className="px-3 py-2 text-right font-semibold">Quedaría</th>
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => (
                  <tr key={f.campo} className="border-t border-borde">
                    <td className="px-3 py-2">{f.nombre}</td>
                    <td className="px-3 py-2 text-right tabular text-tenue">{leer(f.campo, f.antes)}</td>
                    <td className="px-3 py-2 text-right tabular font-semibold text-corte-500">
                      {leer(f.campo, f.despues)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {arreglo.porque ? <p className="text-[12px] text-suave">{arreglo.porque}</p> : null}

          {pisaAlgo ? (
            <Aviso nivel="aviso">
              Alguno de estos campos ya tiene un valor cargado y se va a reemplazar. Si ese número
              salió de medirlo en tu taller, cancelá: el tuyo es mejor que cualquier referencia.
            </Aviso>
          ) : null}

          <div className="flex justify-end gap-2 pt-1">
            <CerrarDialogo asChild>
              <Boton tono="fantasma" tam="sm">Cancelar</Boton>
            </CerrarDialogo>
            <Boton tono="corte" tam="sm" onClick={aplicar} disabled={guardando}>
              {guardando ? 'Guardando…' : 'Aplicar'}
            </Boton>
          </div>
        </div>
      </ContenidoDialogo>
    </Dialogo>
  );
}
