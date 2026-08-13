/**
 * Materiales.
 *
 * Acá vive la verdad del negocio: el precio del kilo y la velocidad real de
 * corte de esta máquina. Los valores de fábrica son un punto de partida;
 * cuando se reemplazan por mediciones propias, el cotizador deja de estimar y
 * empieza a calcular.
 *
 * Se edita sobre una COPIA y se guarda con un botón. Es a propósito: cambiar
 * un precio recalcula todos los presupuestos abiertos, y en una tabla que se
 * toca seguido, guardar en cada tecla convierte cualquier tipeo en un cambio
 * real — y en una línea del historial de precios que después hay que explicar.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Save, Plus, TrendingUp, Percent, Zap, Pencil, Trash2, Eye, EyeOff, Info,
} from 'lucide-react';

import { Panel, PanelCab, PanelTitulo, PanelCuerpo, Vacio } from '@/componentes/ui/panel';
import { Boton } from '@/componentes/ui/boton';
import { Campo, Entrada, AreaTexto, Selector, Opcion } from '@/componentes/ui/campos';
import { Aviso, Dialogo, ContenidoDialogo, CerrarDialogo } from '@/componentes/ui/varios';
import { Insignia } from '@/componentes/ui/insignia';
import { usarEstado } from '@/lib/estado';
import { api } from '@/lib/api';
import { money, num, fecha } from '@/lib/formato';
import { cn } from '@/lib/utils';

import {
  cuttingSpeed, pierceTime, GASES, gasFlow, presionGas, boquilla, espesorMaximo,
} from '@core/materials.js';

/** Copia profunda. Los materiales son JSON puro, así que alcanza. */
const clonar = (v) => JSON.parse(JSON.stringify(v));

const TONO_GAS = { N2: 'azul', O2: 'naranja', AIRE: 'verde' };

export function VistaMateriales() {
  const materialesGuardados = usarEstado((s) => s.materiales);
  const guardarMateriales = usarEstado((s) => s.guardarMateriales);
  const config = usarEstado((s) => s.config);
  const laser = usarEstado((s) => s.laser());
  const sim = usarEstado((s) => s.simbolo());

  /* La copia de trabajo se siembra UNA sola vez, y recién cuando el store
     terminó de cargar: al montar la vista todavía está vacío, así que sembrar
     en el `useState` inicial mostraba "Sin materiales" para siempre.
     `sembrado` es lo que evita el otro extremo — que recargar la lista desde
     el legado pise las ediciones a medio hacer, que es el mismo problema que
     ya tuvo el cotizador con su efecto de arranque. */
  const [mats, setMats] = useState([]);
  const sembrado = useRef(false);
  useEffect(() => {
    if (sembrado.current || !materialesGuardados?.length) return;
    sembrado.current = true;
    setMats(clonar(materialesGuardados));
  }, [materialesGuardados]);

  const [sucio, setSucio] = useState(false);
  const [editando, setEditando] = useState(null);
  const [tablasDe, setTablasDe] = useState(null);
  const [verHistorial, setVerHistorial] = useState(false);
  const [verMasivo, setVerMasivo] = useState(false);

  const tocar = (fn) => {
    setMats((prev) => {
      const copia = clonar(prev);
      fn(copia);
      return copia;
    });
    setSucio(true);
  };

  const guardar = async () => {
    try {
      await guardarMateriales(mats);
      setSucio(false);
      toast.success('Materiales guardados');
    } catch (e) {
      toast.error(`No se pudo guardar: ${e.message}`);
    }
  };

  const nuevo = () => {
    const base = clonar(materialesGuardados?.[0] || mats[0]);
    if (!base) return toast.error('No hay ningún material del que partir');
    base.id = 'material-' + Date.now().toString(36);
    base.nombre = 'Material nuevo';
    setMats((prev) => [...prev, base]);
    setSucio(true);
    setEditando(base.id);
  };

  const borrar = (m) => {
    if (!confirm(`Se va a quitar "${m.nombre}" de la lista.\n\nLos presupuestos ya guardados no cambian.`)) return;
    setMats((prev) => prev.filter((x) => x.id !== m.id));
    setSucio(true);
  };

  const enEdicion = mats.find((m) => m.id === editando) || null;
  const enTablas = mats.find((m) => m.id === tablasDe) || null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Materiales</h1>
          <p className="text-[13px] text-suave">
            Precios, espesores, velocidades de corte y datos de plegado
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Boton tam="sm" onClick={() => setVerHistorial(true)}>
            <TrendingUp />
            Historial de precios
          </Boton>
          <Boton tam="sm" onClick={() => setVerMasivo(true)}>
            <Percent />
            Actualizar en masa
          </Boton>
          <Boton tam="sm" onClick={nuevo}>
            <Plus />
            Nuevo material
          </Boton>
          <Boton tam="sm" tono={sucio ? 'corte' : 'neutro'} onClick={guardar} disabled={!sucio}>
            <Save />
            {sucio ? 'Guardar cambios' : 'Sin cambios'}
          </Boton>
        </div>
      </div>

      <Aviso nivel="info">
        <strong>Tablas calibradas para una fuente de 3 kW.</strong> Cada material tiene una tabla por
        gas de asistencia: la velocidad, la perforación y sobre todo el consumo cambian muchísimo
        entre oxígeno, nitrógeno y aire.
        <br />
        <strong>Para calibrar:</strong> cortá una pieza conocida, cronometrala de verdad y ajustá la
        velocidad de ese espesor con <Zap className="inline size-3" /> hasta que coincida. Con dos o
        tres espesores medidos, el resto interpola bien.
      </Aviso>

      <Panel>
        <PanelCuerpo sinPad>
          {mats.length === 0 ? (
            <Vacio titulo="Sin materiales" detalle="Agregá el primero con “Nuevo material”." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-borde">
                    {['Material', 'Familia', 'Densidad', '$/kg', 'Rm', 'K', 'Espesores', 'Chapa', 'Gases', ''].map(
                      (h, i) => (
                        <th
                          key={h + i}
                          className={cn(
                            'px-3 py-2 text-[10.5px] font-bold uppercase tracking-wide text-tenue',
                            [2, 3, 4, 5].includes(i) ? 'text-right' : 'text-left'
                          )}
                        >
                          {h}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody>
                  {mats.map((m) => (
                    <tr
                      key={m.id}
                      className={cn(
                        'border-b border-borde/60 last:border-0 hover:bg-panel-alto',
                        m.activo === false && 'opacity-45'
                      )}
                    >
                      <td className="px-3 py-2">
                        <div className="font-semibold">{m.nombre}</div>
                        {m.notas ? <div className="text-[11px] text-tenue">{m.notas}</div> : null}
                      </td>
                      <td className="px-3 py-2 text-[12px] text-suave">{m.familia}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{num(m.densidad, 2)}</td>
                      <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums">
                        {money(m.precioKg, sim, 0)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-suave">{num(m.Rm, 0)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-suave">{num(m.kFactor, 2)}</td>
                      <td className="px-3 py-2 font-mono text-[11.5px]">
                        {(m.espesores || []).join(' · ')}
                        <div className="text-[10.5px] text-tenue">máx. {espesorMaximo(m)} mm a 3 kW</div>
                      </td>
                      <td className="px-3 py-2 font-mono text-[11.5px] text-suave">
                        {m.chapaStd?.w}×{m.chapaStd?.h}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex gap-1">
                          {Object.keys(m.procesos || {}).map((g) => (
                            <Insignia key={g} tono={TONO_GAS[g] || 'gris'} className="px-1.5 text-[10px]">
                              {g}
                            </Insignia>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex justify-end gap-1">
                          <Boton tam="sm" tono="fantasma" title="Editar" onClick={() => setEditando(m.id)}>
                            <Pencil />
                          </Boton>
                          <Boton
                            tam="sm"
                            tono="fantasma"
                            title="Tablas de corte por gas"
                            onClick={() => setTablasDe(m.id)}
                          >
                            <Zap />
                          </Boton>
                          <Boton
                            tam="sm"
                            tono="fantasma"
                            title={m.activo === false ? 'Volver a usar' : 'Dejar de usar'}
                            onClick={() =>
                              tocar((c) => {
                                const x = c.find((y) => y.id === m.id);
                                x.activo = x.activo === false;
                              })
                            }
                          >
                            {m.activo === false ? <EyeOff /> : <Eye />}
                          </Boton>
                          <Boton tam="sm" tono="peligro" title="Eliminar" onClick={() => borrar(m)}>
                            <Trash2 />
                          </Boton>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </PanelCuerpo>
      </Panel>

      {sucio ? (
        <Aviso nivel="aviso">
          Hay cambios sin guardar. Mientras no guardes, el cotizador sigue usando los precios
          anteriores.
        </Aviso>
      ) : null}

      {enEdicion ? (
        <DialogoEditar
          material={enEdicion}
          alGuardar={(datos, fuera) => {
            tocar((c) => Object.assign(c.find((x) => x.id === enEdicion.id), datos));
            setEditando(null);
            if (fuera.length) {
              toast.error(
                `No se agregaron ${fuera.join(', ')} mm: superan el máximo de ${espesorMaximo(enEdicion)} mm que corta la máquina`,
                { duration: 6000 }
              );
            }
          }}
          alCerrar={() => setEditando(null)}
        />
      ) : null}

      {enTablas ? (
        <DialogoTablas
          material={enTablas}
          laser={laser}
          config={config}
          sim={sim}
          alCambiar={(gas, espesor, campo, valor) =>
            tocar((c) => {
              c.find((x) => x.id === enTablas.id).procesos[gas][campo][espesor] = valor;
            })
          }
          alCerrar={() => setTablasDe(null)}
        />
      ) : null}

      {verHistorial ? <DialogoHistorial sim={sim} alCerrar={() => setVerHistorial(false)} /> : null}

      {verMasivo ? (
        <DialogoMasivo
          familias={[...new Set(mats.map((m) => m.familia))]}
          alAplicar={(familia, pct) => {
            let n = 0;
            tocar((c) => {
              for (const m of c) {
                if (familia && m.familia !== familia) continue;
                m.precioKg = Math.round(m.precioKg * (1 + pct / 100));
                n++;
              }
            });
            setVerMasivo(false);
            toast.success(`${n} materiales actualizados ${pct >= 0 ? '+' : ''}${pct} %`);
          }}
          alCerrar={() => setVerMasivo(false)}
        />
      ) : null}
    </div>
  );
}

/* ── Editar un material ─────────────────────────────────────────────────── */

function DialogoEditar({ material, alGuardar, alCerrar }) {
  const [f, setF] = useState(() => ({
    nombre: material.nombre ?? '',
    familia: material.familia ?? '',
    densidad: material.densidad ?? 7.85,
    precioKg: material.precioKg ?? 0,
    Rm: material.Rm ?? 370,
    kFactor: material.kFactor ?? 0.42,
    espesores: (material.espesores || []).join(', '),
    chapaW: material.chapaStd?.w ?? 3000,
    chapaH: material.chapaStd?.h ?? 1500,
    gasFino: material.gasPorDefecto?.fino ?? '',
    gasGrueso: material.gasPorDefecto?.grueso ?? '',
    gasHasta: material.gasPorDefecto?.hasta ?? 3,
    notas: material.notas ?? '',
  }));
  const set = (k) => (v) => setF((p) => ({ ...p, [k]: v }));
  const disponibles = Object.keys(material.procesos || {});
  const max = espesorMaximo(material);

  const aceptar = () => {
    /* Los espesores por encima del máximo NO se guardan. Es la misma regla que
       `cuttingSpeed()`: aceptar un espesor que la máquina no corta con calidad
       significa venderlo y no poder entregarlo. */
    const pedidos = f.espesores
      .split(',')
      .map((s) => parseFloat(s.trim()))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);
    const fuera = pedidos.filter((e) => e > max);

    alGuardar(
      {
        nombre: f.nombre,
        familia: f.familia,
        densidad: +f.densidad,
        precioKg: +f.precioKg,
        Rm: +f.Rm,
        kFactor: +f.kFactor,
        espesores: pedidos.filter((e) => e <= max),
        chapaStd: { w: +f.chapaW, h: +f.chapaH },
        gasPorDefecto: { fino: f.gasFino, grueso: f.gasGrueso, hasta: +f.gasHasta },
        notas: f.notas,
      },
      fuera
    );
  };

  return (
    <Dialogo open onOpenChange={(v) => !v && alCerrar()}>
      <ContenidoDialogo titulo="Editar material" ancho="max-w-2xl">
        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Nombre">
            <Entrada value={f.nombre} onChange={(e) => set('nombre')(e.target.value)} />
          </Campo>
          <Campo etiqueta="Familia">
            <Entrada value={f.familia} onChange={(e) => set('familia')(e.target.value)} />
          </Campo>
          <Campo etiqueta="Densidad" ayuda="La que define el peso y con él el precio">
            <Entrada
              type="number" step="any" unidad="g/cm³"
              value={f.densidad} onChange={(e) => set('densidad')(e.target.value)}
            />
          </Campo>
          <Campo etiqueta="Precio de compra" ayuda="Cada cambio queda en el historial con fecha">
            <Entrada
              type="number" step="any" unidad="$/kg"
              value={f.precioKg} onChange={(e) => set('precioKg')(e.target.value)}
            />
          </Campo>
          <Campo etiqueta="Resistencia a tracción Rm" ayuda="Define el tonelaje de plegado">
            <Entrada
              type="number" step="any" unidad="N/mm²"
              value={f.Rm} onChange={(e) => set('Rm')(e.target.value)}
            />
          </Campo>
          <Campo etiqueta="K-factor base" ayuda="Define el desarrollo de los pliegues">
            <Entrada
              type="number" step="any"
              value={f.kFactor} onChange={(e) => set('kFactor')(e.target.value)}
            />
          </Campo>
        </div>

        <Campo
          etiqueta="Espesores disponibles"
          ayuda={`Separados por coma. Los que superen ${max} mm no se guardan: es lo que corta esta máquina con calidad.`}
          className="mt-3"
        >
          <Entrada value={f.espesores} onChange={(e) => set('espesores')(e.target.value)} />
        </Campo>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <Campo etiqueta="Ancho de chapa">
            <Entrada
              type="number" unidad="mm"
              value={f.chapaW} onChange={(e) => set('chapaW')(e.target.value)}
            />
          </Campo>
          <Campo etiqueta="Alto de chapa">
            <Entrada
              type="number" unidad="mm"
              value={f.chapaH} onChange={(e) => set('chapaH')(e.target.value)}
            />
          </Campo>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-3">
          <Campo etiqueta="Gas por defecto en fino">
            <Selector valor={f.gasFino} alCambiar={set('gasFino')}>
              {disponibles.map((g) => (
                <Opcion key={g} valor={g}>
                  {GASES[g]?.nombre || g}
                </Opcion>
              ))}
            </Selector>
          </Campo>
          <Campo etiqueta="Hasta">
            <Entrada
              type="number" step="any" unidad="mm"
              value={f.gasHasta} onChange={(e) => set('gasHasta')(e.target.value)}
            />
          </Campo>
          <Campo etiqueta="Gas por defecto en grueso">
            <Selector valor={f.gasGrueso} alCambiar={set('gasGrueso')}>
              {disponibles.map((g) => (
                <Opcion key={g} valor={g}>
                  {GASES[g]?.nombre || g}
                </Opcion>
              ))}
            </Selector>
          </Campo>
        </div>
        <p className="mt-1.5 text-[11.5px] leading-snug text-suave">
          Es sólo el gas que se propone por defecto: en cada cotización se puede cambiar. Las tablas
          de velocidad y consumo se editan con <Zap className="inline size-3" />.
        </p>

        <Campo etiqueta="Notas de taller" className="mt-3">
          <AreaTexto rows={2} value={f.notas} onChange={(e) => set('notas')(e.target.value)} />
        </Campo>

        <div className="mt-4 flex justify-end gap-2">
          <CerrarDialogo asChild>
            <Boton>Cancelar</Boton>
          </CerrarDialogo>
          <Boton tono="corte" onClick={aceptar}>
            Aceptar
          </Boton>
        </div>
      </ContenidoDialogo>
    </Dialogo>
  );
}

/* ── Tablas de corte, una por gas ───────────────────────────────────────── */

function DialogoTablas({ material, laser, config, sim, alCambiar, alCerrar }) {
  const gases = Object.keys(material.procesos || {});
  const [gas, setGas] = useState(gases[0]);
  const p = material.procesos[gas];
  const kW = laser?.potenciaKW || 3;

  const filas = useMemo(() => {
    const precioGas = config?.produccion?.gases?.[gas] ?? GASES[gas]?.costoM3 ?? 0;
    return (material.espesores || [])
      .filter((e) => e <= p.maxEspesor)
      .map((e) => {
        const vReal = cuttingSpeed(material, e, kW, gas);
        const caudal = gasFlow(material, e, gas);
        return {
          espesor: e,
          enTabla: p.speeds[e] != null,
          velocidad: Math.round(p.speeds[e] ?? cuttingSpeed(material, e, 3, gas) ?? 0),
          pierce: +(p.pierce[e] ?? pierceTime(material, e, 3, gas)).toFixed(2),
          vReal,
          caudal,
          presion: presionGas(material, e, gas),
          boquilla: boquilla(material, e, gas),
          // Lo que hay que mirar: cuánto cuesta el gas por metro de corte
          costoGasMetro: vReal > 0 ? (caudal / 60 / vReal) * 1000 * precioGas : 0,
        };
      });
  }, [material, gas, p, kW, config]);

  return (
    <Dialogo open onOpenChange={(v) => !v && alCerrar()}>
      <ContenidoDialogo
        titulo={`Tablas de corte · ${material.nombre}`}
        descripcion="Valores de referencia para 3 kW. La columna “tu máquina” los corrige a la potencia real y es la que usa el cotizador."
        ancho="max-w-4xl"
      >
        <div className="mb-3 flex gap-1.5">
          {gases.map((g) => (
            <Boton key={g} tam="sm" tono={g === gas ? 'acero' : 'neutro'} onClick={() => setGas(g)}>
              {GASES[g]?.nombre || g}
            </Boton>
          ))}
        </div>

        <Aviso nivel="info">
          <strong>{p.calidad}</strong>
          {p.notas ? <div className="mt-1 text-[11.5px]">{p.notas}</div> : null}
        </Aviso>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-borde">
                {['Espesor', 'Velocidad @3 kW', `Tu máquina (${kW} kW)`, 'Perforación', 'Caudal', 'Presión', 'Boquilla', 'Gas $/m corte'].map(
                  (h, i) => (
                    <th
                      key={h}
                      className={cn(
                        'px-2 py-2 text-[10.5px] font-bold uppercase tracking-wide text-tenue',
                        i >= 2 ? 'text-right' : 'text-left'
                      )}
                    >
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {filas.map((f) => (
                <tr
                  key={f.espesor}
                  className={cn('border-b border-borde/60 last:border-0', !f.enTabla && 'opacity-60')}
                >
                  <td className="px-2 py-1.5 font-semibold tabular-nums">
                    {f.espesor} mm
                    {!f.enTabla ? <div className="text-[10px] font-normal text-tenue">interpolado</div> : null}
                  </td>
                  <td className="px-2 py-1.5">
                    <Entrada
                      type="number" step="any" className="h-7 w-24 text-[12px]"
                      value={f.velocidad}
                      onChange={(e) => alCambiar(gas, f.espesor, 'speeds', +e.target.value)}
                    />
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-suave">{num(f.vReal, 0)}</td>
                  <td className="px-2 py-1.5">
                    <Entrada
                      type="number" step="any" className="h-7 w-20 text-[12px]"
                      value={f.pierce}
                      onChange={(e) => alCambiar(gas, f.espesor, 'pierce', +e.target.value)}
                    />
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-suave">{num(f.caudal, 1)} m³/h</td>
                  {/* Con un decimal a propósito: el oxígeno en chapa gruesa
                      trabaja a 0,4-0,6 bar y redondeado a entero mostraba
                      "0 bar", que parece un dato faltante. */}
                  <td className="px-2 py-1.5 text-right tabular-nums text-suave">{num(f.presion, 1)} bar</td>
                  <td className="px-2 py-1.5 text-right tabular-nums text-suave">{num(f.boquilla, 1)}</td>
                  <td className="px-2 py-1.5 text-right font-mono font-semibold tabular-nums">
                    {money(f.costoGasMetro, sim, 1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-3 flex gap-2 text-[11.5px] leading-snug text-suave">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <span>
            <strong>La última columna es la que hay que mirar:</strong> cuánto cuesta el gas por cada
            metro de corte. Es donde se ve por qué el inoxidable con nitrógeno sale lo que sale.
            Acordate de <strong>guardar</strong> al cerrar.
          </span>
        </p>

        <div className="mt-4 flex justify-end">
          <Boton tono="corte" onClick={alCerrar}>
            Listo
          </Boton>
        </div>
      </ContenidoDialogo>
    </Dialogo>
  );
}

/* ── Historial de precios ───────────────────────────────────────────────── */

function DialogoHistorial({ sim, alCerrar }) {
  const [datos, setDatos] = useState(null);

  useMemo(() => {
    Promise.all([api.get('precios?limite=400'), api.get('precios/variacion?dias=180')])
      .then(([hist, variacion]) => setDatos({ hist, variacion }))
      .catch(() => setDatos({ hist: [], variacion: [] }));
  }, []);

  return (
    <Dialogo open onOpenChange={(v) => !v && alCerrar()}>
      <ContenidoDialogo
        titulo="Historial de precios de materiales"
        descripcion="Cada cambio de precio queda registrado con fecha y con el dólar del día. Sirve para contestarle a un cliente por qué cambió el precio, y para ver si tu materia prima subió más o menos que la inflación."
        ancho="max-w-3xl"
      >
        {!datos ? (
          <p className="text-[13px] text-suave">Cargando…</p>
        ) : !datos.hist.length ? (
          <Vacio
            titulo="Todavía no hay historial"
            detalle="Se registra solo cada vez que cambiás un precio y guardás."
          />
        ) : (
          <>
            {datos.variacion.length ? (
              <>
                <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-corte-600 dark:text-corte-300">
                  Variación de los últimos 180 días
                </h4>
                <table className="mb-5 w-full text-[12.5px]">
                  <thead>
                    <tr className="border-b border-borde">
                      {['Material', 'Inicial', 'Actual', 'Variación', 'Cambios'].map((h, i) => (
                        <th
                          key={h}
                          className={cn(
                            'px-2 py-1.5 text-[10.5px] font-bold uppercase tracking-wide text-tenue',
                            i === 0 ? 'text-left' : 'text-right'
                          )}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {datos.variacion.map((v) => (
                      <tr key={v.nombre} className="border-b border-borde/60 last:border-0">
                        <td className="px-2 py-1.5">{v.nombre}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-suave">{money(v.inicial, sim, 0)}</td>
                        <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{money(v.actual, sim, 0)}</td>
                        <td
                          className={cn(
                            'px-2 py-1.5 text-right font-semibold tabular-nums',
                            v.variacionPct >= 0 ? 'text-peligro-500' : 'text-chapa-500'
                          )}
                        >
                          {(v.variacionPct >= 0 ? '+' : '') + num(v.variacionPct, 1)} %
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-tenue">{v.cambios}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            ) : null}

            <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wide text-corte-600 dark:text-corte-300">
              Todos los cambios registrados
            </h4>
            <div className="max-h-72 overflow-y-auto">
              <table className="w-full text-[12.5px]">
                <thead className="sticky top-0 bg-panel">
                  <tr className="border-b border-borde">
                    {['Fecha', 'Material', '$/kg', 'US$/kg', 'Motivo'].map((h, i) => (
                      <th
                        key={h}
                        className={cn(
                          'px-2 py-1.5 text-[10.5px] font-bold uppercase tracking-wide text-tenue',
                          [2, 3].includes(i) ? 'text-right' : 'text-left'
                        )}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {datos.hist.map((r, i) => (
                    <tr key={i} className="border-b border-borde/60 last:border-0">
                      <td className="px-2 py-1.5 text-[11.5px] text-suave">{fecha(r.fecha)}</td>
                      <td className="px-2 py-1.5 text-[11.5px]">{r.nombre}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{money(r.precio_kg, sim, 0)}</td>
                      <td className="px-2 py-1.5 text-right text-[11.5px] tabular-nums text-suave">
                        {r.precio_usd ? 'US$ ' + num(r.precio_usd, 2) : '—'}
                      </td>
                      <td className="px-2 py-1.5 text-[11.5px] text-tenue">{r.motivo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </ContenidoDialogo>
    </Dialogo>
  );
}

/* ── Actualización masiva ───────────────────────────────────────────────── */

function DialogoMasivo({ familias, alAplicar, alCerrar }) {
  const [familia, setFamilia] = useState('');
  const [pct, setPct] = useState(10);

  return (
    <Dialogo open onOpenChange={(v) => !v && alCerrar()}>
      <ContenidoDialogo
        titulo="Actualizar precios"
        descripcion="Aplica un porcentaje sobre el precio por kilo. Usá un número negativo para bajar."
        ancho="max-w-md"
      >
        <Campo etiqueta="Familia">
          <Selector valor={familia} alCambiar={setFamilia} placeholder="Todos los materiales">
            <Opcion valor="">Todos los materiales</Opcion>
            {familias.map((f) => (
              <Opcion key={f} valor={f}>
                {f}
              </Opcion>
            ))}
          </Selector>
        </Campo>
        <Campo etiqueta="Variación" className="mt-3">
          <Entrada
            type="number" step="any" unidad="%"
            value={pct} onChange={(e) => setPct(+e.target.value || 0)}
          />
        </Campo>
        <div className="mt-4 flex justify-end gap-2">
          <CerrarDialogo asChild>
            <Boton>Cancelar</Boton>
          </CerrarDialogo>
          <Boton tono="corte" onClick={() => alAplicar(familia, pct)}>
            Aplicar
          </Boton>
        </div>
      </ContenidoDialogo>
    </Dialogo>
  );
}
