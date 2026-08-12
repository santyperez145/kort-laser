/**
 * Diseñador de plegado.
 *
 * La plegadora tiene sus propias reglas y no son las del láser: acá lo que
 * manda es el desarrollo, la matriz, el ala mínima y el orden en que se pliega.
 * Por eso es una vista aparte y no una solapa del cotizador.
 *
 * Se arma la sección transversal tramo por tramo y todo lo demás sale solo:
 * el desarrollo que hay que cortar, dónde van las líneas de plegado, el 3D,
 * el tonelaje, los avisos de fabricabilidad y la secuencia para el operario.
 */

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  Plus, Trash2, ArrowUpDown, Download, Calculator, RotateCcw, ArrowRight,
} from 'lucide-react';

import { Panel, PanelCab, PanelCuerpo, PanelTitulo } from '@/componentes/ui/panel';
import { Boton } from '@/componentes/ui/boton';
import { Campo, Entrada, Selector, Opcion } from '@/componentes/ui/campos';
import { Aviso } from '@/componentes/ui/varios';
import { Insignia } from '@/componentes/ui/insignia';
import { Visor3D } from '@/componentes/visores/Visor3D';
import { VisorSeccion } from '@/componentes/visores/VisorSeccion';
import { usarEstado } from '@/lib/estado';
import { num, descargar } from '@/lib/formato';

import {
  perfilNuevo, calcularPerfil, PLANTILLAS, desdePlantilla,
  agregarTramo, quitarTramo, invertirPliegue,
} from '@core/perfil-plegado.js';
import { MATRICES_V, matrizRecomendada } from '@core/bending.js';
import { generarDXF } from '@core/dxf-write.js';
import { construirMesh } from '@core/mesh3d.js';

const LS_CLAVE = 'kort-perfil-plegado';

export function VistaPlegado() {
  const navegar = useNavigate();
  const materiales = usarEstado((s) => s.materiales);
  const maquinas = usarEstado((s) => s.maquinas);
  const plegadora = maquinas.find((m) => m.tipo === 'plegadora');

  const [perfil, setPerfil] = useState(() => {
    try {
      const g = localStorage.getItem(LS_CLAVE);
      if (g) return { ...perfilNuevo(), ...JSON.parse(g) };
    } catch { /* si el guardado está roto, se arranca de cero */ }
    return perfilNuevo();
  });
  const [sel, setSel] = useState(0);

  const material = materiales.find((m) => m.id === perfil.materialId) || materiales[0];

  const calc = useMemo(() => {
    if (!material) return null;
    try {
      return calcularPerfil(perfil, material, plegadora);
    } catch (e) {
      return { error: e.message };
    }
  }, [perfil, material, plegadora]);

  const mesh = useMemo(() => {
    if (!calc || calc.error) return null;
    try {
      return construirMesh({ shape: calc.shape, modelo3D: calc.modelo3D }, calc.espesor, calc.radioInterno);
    } catch {
      return null;
    }
  }, [calc]);

  const actualizar = (cambios) => {
    const nuevo = typeof cambios === 'function' ? cambios(perfil) : { ...perfil, ...cambios };
    setPerfil(nuevo);
    try {
      localStorage.setItem(LS_CLAVE, JSON.stringify(nuevo));
    } catch { /* sin localStorage el diseñador funciona igual, sólo no recuerda */ }
  };

  const setTramo = (i, v) => actualizar((p) => ({ ...p, tramos: p.tramos.map((x, k) => (k === i ? v : x)) }));
  const setAngulo = (i, campo, v) =>
    actualizar((p) => ({ ...p, angulos: p.angulos.map((a, k) => (k === i ? { ...a, [campo]: v } : a)) }));

  if (!material) return <div className="p-6 text-muted-foreground">Cargando materiales…</div>;

  const errores = (calc?.avisos || []).filter((a) => a.nivel === 'error');
  const espesoresDisponibles = material.espesores || [];

  /* ---------------- Acciones ---------------- */

  const bajarDXF = () => {
    if (!calc || calc.error) return;
    const dxf = generarDXF([{ shape: calc.shape }], {
      titulo: `KORT - Perfil plegado ${calc.desarrollo.toFixed(1)} x ${calc.ancho} mm`,
      subtitulo: `${material.nombre} ${calc.espesor} mm · ${calc.pliegues.length} pliegues · V${calc.matrizV}`,
    });
    descargar(`perfil-plegado-${calc.espesor}mm.dxf`, dxf, 'application/dxf');
    toast.success('DXF generado con las líneas de plegado en su capa');
  };

  const alCotizador = () => {
    if (!calc || calc.error) return;
    if (errores.length) {
      toast.error('Corregí los errores antes de cotizar: la pieza no se puede plegar así');
      return;
    }
    // El cotizador lo levanta como un ítem de geometría propia
    sessionStorage.setItem('kort-item-plegado', JSON.stringify({
      nombre: `Perfil plegado ${calc.pliegues.length}P · ${calc.espesor} mm`,
      origen: 'plegado',
      shape: calc.shape,
      materialId: perfil.materialId,
      espesor: calc.espesor,
      plegado: calc.plegado,
      meta: { modelo3D: calc.modelo3D },
    }));
    navegar('/cotizador?desde=plegado');
  };

  /* ---------------- Render ---------------- */

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Diseñador de plegado</h1>
          <p className="text-sm text-muted-foreground">
            Armá la sección y el sistema calcula el desarrollo, la matriz y el orden de plegado
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Boton tono="neutro" onClick={() => actualizar(perfilNuevo())}>
            <RotateCcw className="size-4" /> Empezar de cero
          </Boton>
          <Boton tono="neutro" onClick={bajarDXF} disabled={!calc || calc.error}>
            <Download className="size-4" /> DXF del desarrollo
          </Boton>
          <Boton onClick={alCotizador} disabled={!calc || calc.error}>
            <Calculator className="size-4" /> Cotizar esta pieza
          </Boton>
        </div>
      </div>

      {/* Plantillas */}
      <Panel>
        <PanelCab><PanelTitulo>Empezar desde un perfil conocido</PanelTitulo></PanelCab>
        <PanelCuerpo className="flex flex-wrap gap-2">
          {PLANTILLAS.map((p) => (
            <button
              key={p.id}
              onClick={() => { actualizar(desdePlantilla(p.id, { espesor: perfil.espesor, ancho: perfil.ancho, materialId: perfil.materialId })); setSel(0); }}
              className="rounded-lg border px-3 py-2 text-left transition hover:border-primary hover:shadow-sm"
            >
              <div className="text-sm font-medium">{p.nombre}</div>
              <div className="text-[11px] text-muted-foreground">{p.descripcion}</div>
            </button>
          ))}
        </PanelCuerpo>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* Visores */}
        <div className="space-y-4">
          <Panel>
            <PanelCab>
              <PanelTitulo>Sección transversal</PanelTitulo>
              {calc && !calc.error && (
                <span className="font-mono text-xs text-muted-foreground">
                  {num(calc.seccion.bbox.w, 0)} × {num(calc.seccion.bbox.h, 0)} mm
                </span>
              )}
            </PanelCab>
            <PanelCuerpo sinPad>
              {calc && !calc.error && (
                <VisorSeccion perfil={calc} seleccion={sel} onSeleccionar={setSel} alto={300} />
              )}
            </PanelCuerpo>
          </Panel>

          <Panel>
            <PanelCab><PanelTitulo>Pieza terminada</PanelTitulo></PanelCab>
            <PanelCuerpo sinPad>
              {mesh ? <Visor3D modelo={mesh} alto={340} />
                : <div className="grid h-[340px] place-items-center text-sm text-muted-foreground">Sin modelo</div>}
            </PanelCuerpo>
          </Panel>
        </div>

        {/* Editor */}
        <div className="space-y-4">
          <Panel>
            <PanelCab><PanelTitulo>Material y medidas</PanelTitulo></PanelCab>
            <PanelCuerpo className="space-y-3">
              <Campo etiqueta="Material">
                <Selector valor={perfil.materialId} alCambiar={(v) => {
                  const m = materiales.find((x) => x.id === v);
                  const esp = m?.espesores?.includes(perfil.espesor) ? perfil.espesor : m?.espesores?.[2] ?? perfil.espesor;
                  actualizar({ materialId: v, espesor: esp });
                }}>
                  {materiales.filter((m) => m.activo !== false).map((m) => (
                    <Opcion key={m.id} valor={m.id}>{m.nombre}</Opcion>
                  ))}
                </Selector>
              </Campo>
              <div className="grid grid-cols-2 gap-3">
                <Campo etiqueta="Espesor">
                  <Selector valor={String(perfil.espesor)} alCambiar={(v) => actualizar({ espesor: Number(v) })}>
                    {espesoresDisponibles.map((e) => <Opcion key={e} valor={String(e)}>{e} mm</Opcion>)}
                  </Selector>
                </Campo>
                <Campo etiqueta="Largo de la pieza" >
                  <Entrada type="number" min={1} unidad="mm" value={perfil.ancho}
                    onChange={(e) => actualizar({ ancho: Math.max(1, Number(e.target.value) || 1) })} />
                </Campo>
              </div>
              <Campo etiqueta="Matriz V">
                <Selector valor={String(perfil.matrizV || 0)} alCambiar={(v) => actualizar({ matrizV: Number(v) })}>
                  <Opcion valor="0">Automática (V{matrizRecomendada(perfil.espesor)})</Opcion>
                  {MATRICES_V.map((v) => <Opcion key={v} valor={String(v)}>V{v}</Opcion>)}
                </Selector>
              </Campo>
            </PanelCuerpo>
          </Panel>

          <Panel>
            <PanelCab>
              <PanelTitulo>Tramos y pliegues</PanelTitulo>
              <Boton tam="sm" tono="neutro" onClick={() => { actualizar(agregarTramo(perfil)); setSel(perfil.tramos.length); }}>
                <Plus className="size-3.5" /> Tramo
              </Boton>
            </PanelCab>
            <PanelCuerpo className="space-y-2">
              {perfil.tramos.map((t, i) => (
                <div key={i}
                  className={`rounded-lg border p-2 transition ${sel === i ? 'border-primary bg-primary/5' : ''}`}
                  onMouseEnter={() => setSel(i)}>
                  <div className="flex items-center gap-2">
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-[11px] font-semibold">
                      {i + 1}
                    </span>
                    <Entrada type="number" min={1} value={t} className="h-8"
                      onChange={(e) => setTramo(i, Math.max(0.1, Number(e.target.value) || 0))} />
                    <span className="text-[11px] text-muted-foreground">mm</span>
                    <Boton tam="iconoSm" tono="fantasma" onClick={() => { actualizar(quitarTramo(perfil, i)); setSel(0); }}
                      disabled={perfil.tramos.length <= 2} title="Quitar tramo">
                      <Trash2 className="size-3.5" />
                    </Boton>
                  </div>

                  {i < perfil.angulos.length && (
                    <div className="mt-2 flex items-center gap-2 pl-8">
                      <span className="text-[11px] text-muted-foreground">Pliegue {i + 1}</span>
                      <Entrada type="number" min={1} max={170} value={perfil.angulos[i].grados} className="h-7 w-20"
                        onChange={(e) => setAngulo(i, 'grados', Math.max(1, Math.min(170, Number(e.target.value) || 90)))} />
                      <span className="text-[11px] text-muted-foreground">°</span>
                      <Boton tam="sm" tono="neutro" onClick={() => actualizar(invertirPliegue(perfil, i))}
                        title="Cambiar el lado del pliegue">
                        <ArrowUpDown className="size-3.5" />
                        {perfil.angulos[i].sentido === 'arriba' ? 'Arriba' : 'Abajo'}
                      </Boton>
                    </div>
                  )}
                </div>
              ))}
            </PanelCuerpo>
          </Panel>

          {calc && !calc.error && (
            <Panel>
              <PanelCab><PanelTitulo>Resultado</PanelTitulo></PanelCab>
              <PanelCuerpo className="space-y-1 text-sm">
                <Dato k="Desarrollo a cortar" v={`${num(calc.desarrollo, 1)} × ${num(calc.ancho, 0)} mm`} fuerte />
                <Dato k="Suma de cotas" v={`${num(calc.sumaCotas, 1)} mm`} />
                <Dato k="Deducción total" v={`− ${num(calc.sumaBD, 2)} mm`} />
                <Dato k="Matriz" v={`V${calc.matrizV}`} />
                <Dato k="Radio interno" v={`${num(calc.radioInterno, 2)} mm`} />
                <Dato k="K-factor" v={num(calc.kFactor, 3)} />
                <Dato k="Ala mínima" v={`${num(calc.alaMinima, 1)} mm`} />
                <Dato k="Fuerza necesaria"
                  v={`${num(Math.max(0, ...calc.pliegues.map((p) => p.toneladas)), 1)} t`} />
                <Dato k="Cambios de herramental" v={String(calc.plegado.herramentales)} />
                <div className="pt-2">
                  <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Líneas de plegado
                  </div>
                  {calc.lineas.map((l) => (
                    <div key={l.indice} className="flex justify-between font-mono text-xs">
                      <span className="text-muted-foreground">P{l.indice} · {l.grados}° {l.sentido === 'arriba' ? '↑' : '↓'}</span>
                      <span>x = {num(l.x, 1)} mm</span>
                    </div>
                  ))}
                </div>
              </PanelCuerpo>
            </Panel>
          )}
        </div>
      </div>

      {/* Avisos y secuencia, a lo ancho */}
      {calc && !calc.error && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel>
            <PanelCab>
              <PanelTitulo>Se puede plegar</PanelTitulo>
              {errores.length
                ? <Insignia tono="rojo">{errores.length} problema{errores.length > 1 ? 's' : ''}</Insignia>
                : <Insignia tono="verde">Sin problemas</Insignia>}
            </PanelCab>
            <PanelCuerpo className="space-y-2">
              {calc.avisos.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Entra en la plegadora, las alas superan el mínimo y ningún tramo choca con otro.
                </p>
              )}
              {calc.avisos.map((a, i) => (
                <Aviso key={i} nivel={a.nivel}>
                  {a.msg}
                </Aviso>
              ))}
            </PanelCuerpo>
          </Panel>

          <Panel>
            <PanelCab><PanelTitulo>Orden de plegado sugerido</PanelTitulo></PanelCab>
            <PanelCuerpo>
              {calc.secuencia.length === 0
                ? <p className="text-sm text-muted-foreground">Sin pliegues.</p>
                : (
                  <ol className="space-y-2">
                    {calc.secuencia.map((s) => (
                      <li key={s.paso} className="flex items-center gap-3 text-sm">
                        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                          {s.paso}
                        </span>
                        <ArrowRight className="size-3.5 text-muted-foreground" />
                        <span>
                          Pliegue <strong>P{s.pliegue}</strong> · {s.grados}° hacia {s.sentido}
                        </span>
                        {s.nota && <span className="text-[11px] text-muted-foreground">— {s.nota}</span>}
                      </li>
                    ))}
                  </ol>
                )}
              <p className="mt-3 text-[11px] text-muted-foreground">
                Se pliega primero lo que menos sobresale, para que la parte ya doblada no choque
                contra el puente de la máquina.
              </p>
            </PanelCuerpo>
          </Panel>
        </div>
      )}

      {calc?.error && <Aviso nivel="error">{calc.error}</Aviso>}
    </div>
  );
}

function Dato({ k, v, fuerte }) {
  return (
    <div className="flex justify-between gap-3 py-0.5">
      <span className="text-muted-foreground">{k}</span>
      <span className={`font-mono tabular-nums ${fuerte ? 'font-semibold' : ''}`}>{v}</span>
    </div>
  );
}
