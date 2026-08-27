/**
 * Máquinas — parámetros técnicos y costo horario.
 *
 * El costo por hora es el número que decide si un trabajo deja ganancia o la
 * quema, y acá viven los campos que más lo mueven: consumibles, mantenimiento,
 * valor del equipo y los tiempos de puesta a punto. Todos ya rompieron precios
 * en silencio alguna vez.
 *
 * Por eso el calculador de consumibles vive acá, al lado del campo, y no
 * colgado de un aviso en otra pantalla: el lugar donde se detecta el problema
 * y el lugar donde se arregla tienen que ser el mismo.
 */

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Save, RotateCcw, Gauge } from 'lucide-react';

import { usarEstado } from '@/lib/estado';
import { money } from '@/lib/formato';
import { Panel, PanelCab, PanelTitulo, PanelCuerpo } from '@/componentes/ui/panel';
import { Boton } from '@/componentes/ui/boton';
import { Campo, Entrada } from '@/componentes/ui/campos';
import { Insignia } from '@/componentes/ui/insignia';
import { Aviso, Barra } from '@/componentes/ui/varios';
import { BotonCalculadorConsumibles } from '@/componentes/CalculadorConsumibles';
import { cn } from '@/lib/utils';

import { calcularEstructura, calcularCostoHoraMaquina } from '@core/costos.js';
import { revisarDatos } from '@core/salud.js';
import { factorPara, explicarFactor } from '@core/calibracion.js';
import { fichaOptica, sangria, revisarCabezal } from '@core/optica.js';

/* Los campos técnicos alimentan el simulador de recorrido: la aceleración y la
   tolerancia de esquina son la razón de que una pieza con muchos agujeros
   chicos cotice más que una placa lisa del mismo perímetro. */
const TECNICOS = {
  laser: [
    { k: 'potenciaKW', txt: 'Potencia de la fuente', u: 'kW' },
    { k: 'aceleracion', txt: 'Aceleración', u: 'G' },
    { k: 'velocidadRapida', txt: 'Velocidad de posicionamiento', u: 'mm/min' },
    { k: 'desviacionUnion', txt: 'Tolerancia de esquina', u: 'mm' },
    { k: 'entradaMM', txt: 'Longitud de entrada (lead-in)', u: 'mm' },
    { k: 'eficiencia', txt: 'Eficiencia real (0 a 1)' },
    { k: 'tiempoCargaChapa', txt: 'Carga/descarga de chapa', u: 's' },
    { k: 'tiempoSetupPrograma', txt: 'Setup de programa', u: 's' },
    { k: 'tiempoDescarga', txt: 'Retiro por pieza', u: 's' },
  ],
  plegadora: [
    { k: 'toneladas', txt: 'Tonelaje', u: 't' },
    { k: 'largoUtil', txt: 'Largo útil', u: 'mm' },
    { k: 'ejes', txt: 'Ejes controlados' },
    { k: 'tiempoSetupHerramienta', txt: 'Setup de herramental', u: 's' },
    { k: 'tiempoPorPliegue', txt: 'Tiempo base por pliegue', u: 's' },
    { k: 'factorLargo', txt: 'Segundos extra por mm de pliegue' },
    { k: 'factorPeso', txt: 'Segundos extra por kg de pieza' },
  ],
};

/* La cadena óptica. Hasta acá la máquina era `potenciaKW` y nada más: con 3 kW
   se elige la fila de la tabla de velocidades, pero dos equipos de 3 kW con
   ópticas distintas cortan distinto. De estos tres números sale el punto
   focal, y del punto focal salen la sangría y el detalle mínimo.

   Los límites del cabezal no son decorativos: si un proceso pide más presión
   o una boquilla más grande de la que entra, esa combinación no se puede
   cortar en calidad y hoy se cotizaría igual. */
/* Coma decimal, como el resto de la aplicación. */
const coma = (v) => (v == null ? '' : String(v).replace('.', ','));

const OPTICA_NUM = [
  { k: 'nucleoFibraUM', txt: 'Núcleo de la fibra', u: 'µm' },
  { k: 'colimadorMM', txt: 'Colimador', u: 'mm' },
  { k: 'focoMM', txt: 'Lente de foco', u: 'mm' },
  { k: 'presionMaxBar', txt: 'Presión máxima del cabezal', u: 'bar' },
  { k: 'boquillaMaxMM', txt: 'Boquilla máxima', u: 'mm' },
  { k: 'sangriaMedida', txt: 'Sangría medida (0 = estimar)', u: 'mm' },
];

const COSTOS = [
  { k: 'valorEquipo', txt: 'Valor del equipo', ancho: true },
  { k: 'vidaUtilHoras', txt: 'Vida útil estimada', u: 'h' },
  { k: 'consumoKW', txt: 'Consumo eléctrico medio', u: 'kW' },
  { k: 'costoKWh', txt: 'Costo del kWh' },
  { k: 'mantenimientoHora', txt: 'Mantenimiento por hora' },
  { k: 'consumiblesHora', txt: 'Consumibles por hora' },
  { k: 'operarioHora', txt: 'Costo real de la hora de operario' },
  { k: 'dedicacionOperario', txt: 'Dedicación del operario', u: '%' },
];

export function VistaMaquinas() {
  const config = usarEstado((s) => s.config);
  const materiales = usarEstado((s) => s.materiales);
  const guardadas = usarEstado((s) => s.maquinas);
  const guardarMaquinas = usarEstado((s) => s.guardarMaquinas);
  const calibracion = usarEstado((s) => s.calibracion);
  const sim = usarEstado((s) => s.simbolo());

  /* Copia local. Arranca en null y se llena cuando llegan las máquinas: si se
     inicializara con el valor de entonces, un primer render antes de la carga
     dejaría el borrador vacío para siempre. */
  const [borrador, setBorrador] = useState(null);
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (borrador === null && guardadas?.length) setBorrador(structuredClone(guardadas));
  }, [guardadas, borrador]);

  const estructura = useMemo(() => calcularEstructura(config?.estructura), [config]);

  const sucio = useMemo(
    () => borrador !== null && JSON.stringify(borrador) !== JSON.stringify(guardadas),
    [borrador, guardadas]
  );

  /* Los avisos se evalúan contra el BORRADOR: se ven desaparecer mientras se
     corrige el número, sin tener que guardar para saber si quedó bien. */
  const revision = useMemo(
    () => (config && borrador ? revisarDatos({ config, maquinas: borrador, materiales }) : null),
    [config, borrador, materiales]
  );

  const set = (i, k, v) =>
    setBorrador((b) => b.map((m, j) => (j === i ? { ...m, [k]: v } : m)));

  const setCosto = (i, k, v) =>
    setBorrador((b) => b.map((m, j) => (j === i ? { ...m, costo: { ...m.costo, [k]: v } } : m)));

  const setOptica = (i, k, v) =>
    setBorrador((b) => b.map((m, j) => (j === i ? { ...m, optica: { ...m.optica, [k]: v } } : m)));

  const guardar = async () => {
    setGuardando(true);
    try {
      await guardarMaquinas(borrador);
      toast.success('Máquinas guardadas');
    } catch (e) {
      toast.error('No se pudo guardar: ' + e.message);
    } finally {
      setGuardando(false);
    }
  };

  if (!config || !borrador) return <div className="panel-kort h-[60vh] animate-pulse" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-tinta">Máquinas</h1>
          <p className="mt-0.5 text-[13px] text-suave">
            Parámetros técnicos y cálculo del costo horario
          </p>
        </div>
        <div className="flex gap-2">
          {sucio ? (
            <Boton tono="fantasma" onClick={() => setBorrador(structuredClone(guardadas))}>
              <RotateCcw />
              Descartar
            </Boton>
          ) : null}
          <Boton tono="corte" onClick={guardar} disabled={!sucio || guardando}>
            <Save />
            {sucio ? 'Guardar cambios' : 'Sin cambios'}
          </Boton>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {borrador.map((m, i) => (
          <TarjetaMaquina
            key={m.id}
            m={m}
            i={i}
            sim={sim}
            estructura={estructura}
            calibracion={calibracion}
            avisos={revision?.hallazgos.filter((h) => h.donde?.includes(m.nombre || m.id)) || []}
            set={set}
            setCosto={setCosto}
            setOptica={setOptica}
            materiales={materiales}
            maquinasGuardadas={guardadas}
          />
        ))}
      </div>

      <Aviso nivel="info">
        <strong>Cómo se usan estos números.</strong> La aceleración y la tolerancia de esquina
        alimentan el simulador de recorrido: por eso una pieza con muchos agujeros chicos cotiza más
        caro que una placa lisa del mismo perímetro.
        <p className="mt-2">
          <strong>Energía:</strong> acá va sólo el consumo variable, los kWh mientras la máquina
          trabaja. El cargo por potencia contratada de EDELAR es un gasto fijo mensual y va en
          Costos, no acá: si lo pusieras como variable, los trabajos largos lo pagarían dos veces y
          los cortos no lo pagarían nunca.
        </p>
      </Aviso>
    </div>
  );
}

function TarjetaMaquina({ m, i, sim, estructura, calibracion, avisos, set, setCosto, setOptica, materiales, maquinasGuardadas }) {
  const c = useMemo(() => calcularCostoHoraMaquina(m, estructura), [m, estructura]);
  const esLaser = m.tipo === 'laser';

  /* El sistema YA corrige los tiempos con lo medido en producción. Decirlo acá
     evita el error de bajar la eficiencia "porque los tiempos dan cortos" y
     terminar aplicando la corrección dos veces. */
  const factor = useMemo(
    () => (esLaser && calibracion?.activa ? factorPara(calibracion, null, 2) : null),
    [esLaser, calibracion]
  );

  /* Se revisa contra el catálogo entero, no contra una lista escrita a mano:
     si mañana se agrega un material, el chequeo lo cubre solo. */
  const avisosCabezal = useMemo(
    () => (esLaser ? revisarCabezal(m, materiales) : []),
    [esLaser, m, materiales]
  );

  const partes = [
    ['Amortización del equipo', c.amortizacion],
    ['Energía eléctrica (variable)', c.energia],
    ['Mantenimiento', c.mantenimiento],
    ['Consumibles (óptica, boquillas)', c.consumibles],
    ['Operario', c.operario],
    ['Estructura del taller', c.estructura],
  ];
  const total = c.total || 1;

  const campo = (k, txt, u, onChange, valor) => (
    <Campo key={k} etiqueta={txt}>
      <Entrada
        type="number"
        step="any"
        unidad={u}
        value={valor ?? 0}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
      />
    </Campo>
  );

  return (
    <Panel className={cn(avisos.length && 'border-l-4 border-l-alerta-500')}>
      <PanelCab
        acciones={
          <Insignia tono={esLaser ? 'naranja' : 'azul'}>{esLaser ? 'Láser' : 'Plegadora'}</Insignia>
        }
      >
        <PanelTitulo className="text-[13px] normal-case tracking-normal text-tinta">
          {m.nombre}
        </PanelTitulo>
      </PanelCab>

      <PanelCuerpo className="space-y-4">
        {avisos.map((h, k) => (
          <Aviso key={k} nivel={h.nivel}>
            {h.msg}
            {/consumibles/i.test(h.msg) ? (
              <div className="mt-2">
                <BotonCalculadorConsumibles maquina={maquinasGuardadas.find((x) => x.id === m.id)}>
                  Calcularlo con piezas reales
                </BotonCalculadorConsumibles>
              </div>
            ) : null}
          </Aviso>
        ))}

        <div>
          <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-tenue">
            Parámetros técnicos
          </div>
          <Campo etiqueta="Nombre" className="mb-3">
            <Entrada value={m.nombre || ''} onChange={(e) => set(i, 'nombre', e.target.value)} />
          </Campo>
          <div className="grid gap-3 sm:grid-cols-2">
            {(TECNICOS[esLaser ? 'laser' : 'plegadora'] || []).map((f) =>
              campo(f.k, f.txt, f.u, (v) => set(i, f.k, v), m[f.k])
            )}
            {esLaser ? (
              <>
                <Campo etiqueta="Área de trabajo X">
                  <Entrada
                    type="number" unidad="mm"
                    value={m.areaTrabajo?.w ?? 3000}
                    onChange={(e) =>
                      set(i, 'areaTrabajo', { ...m.areaTrabajo, w: parseFloat(e.target.value) || 0 })
                    }
                  />
                </Campo>
                <Campo etiqueta="Área de trabajo Y">
                  <Entrada
                    type="number" unidad="mm"
                    value={m.areaTrabajo?.h ?? 1500}
                    onChange={(e) =>
                      set(i, 'areaTrabajo', { ...m.areaTrabajo, h: parseFloat(e.target.value) || 0 })
                    }
                  />
                </Campo>
              </>
            ) : null}
          </div>

          {esLaser ? (
            <div className="mt-4">
              <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-tenue">
                Fuente y cabezal
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo etiqueta="Fuente (marca y modelo)">
                  <Entrada
                    value={m.optica?.fuente || ''}
                    placeholder="Max Photonics MSFC-3000C"
                    onChange={(e) => setOptica(i, 'fuente', e.target.value)}
                  />
                </Campo>
                <Campo etiqueta="Cabezal (marca y modelo)">
                  <Entrada
                    value={m.optica?.cabezal || ''}
                    placeholder="Empower"
                    onChange={(e) => setOptica(i, 'cabezal', e.target.value)}
                  />
                </Campo>
                {OPTICA_NUM.map((f) => (
                  <Campo key={f.k} etiqueta={f.txt}>
                    <Entrada
                      type="number" step="any" unidad={f.u}
                      value={m.optica?.[f.k] ?? 0}
                      onChange={(e) => setOptica(i, f.k, parseFloat(e.target.value) || 0)}
                    />
                  </Campo>
                ))}
              </div>

              {/* El punto focal se calcula, no se carga: es óptica geométrica.
                  Mostrarlo acá es la forma de que se note si un dato quedó mal
                  tipeado — un punto de 500 µm salta a la vista. */}
              {fichaOptica(m).puntoUM ? (
                <p className="mt-2 text-[11px] text-suave">
                  Punto focal <strong className="tabular">{coma(fichaOptica(m).puntoUM)} µm</strong>{' '}
                  (ampliación {coma(fichaOptica(m).ampliacion)}×). Sangría estimada en 3 mm con N₂:{' '}
                  <strong className="tabular">{coma(sangria(m, 3, 'N2').mm)} mm</strong>
                  {sangria(m, 3, 'N2').origen === 'medida' ? ' (medida)' : ' (estimada — medila cortando un cuadrado de 100 mm)'}.
                </p>
              ) : (
                <p className="mt-2 text-[11px] text-tenue">
                  Con el núcleo de la fibra, el colimador y el foco se calcula el punto focal.
                  Los tres están en la hoja de datos de la fuente y en el manual del cabezal.
                </p>
              )}

              {avisosCabezal.length ? (
                <div className="mt-2 space-y-1.5">
                  {avisosCabezal.map((a, k) => (
                    <Aviso key={k} nivel={a.nivel}>{a.msg}</Aviso>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {factor ? (
            <Aviso nivel="info" className="mt-3">
              <strong>No toques la eficiencia para ajustar tiempos: ya se ajustan solos.</strong>{' '}
              {explicarFactor(factor)} Si además bajás la eficiencia, la corrección se aplica dos
              veces y los precios salen de más.
            </Aviso>
          ) : null}
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wider text-tenue">
              Componentes del costo
            </span>
            {esLaser ? (
              <BotonCalculadorConsumibles maquina={maquinasGuardadas.find((x) => x.id === m.id)}>
                Calcular consumibles
              </BotonCalculadorConsumibles>
            ) : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {COSTOS.map((f) =>
              campo(f.k, f.txt, f.u || sim, (v) => setCosto(i, f.k, v), m.costo?.[f.k])
            )}
            {campo(
              'participacionEstructura',
              'Parte de la estructura que absorbe',
              '%',
              (v) => set(i, 'participacionEstructura', v),
              m.participacionEstructura
            )}
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-tenue">
            Estructura del taller: {money(estructura.porHora, sim, 0)}/h repartidos entre las
            máquinas. Se configura en Costos.
          </p>
        </div>

        {/* ---------------- Costo por hora ---------------- */}
        <div className="rounded-xl bg-panel-alto p-3">
          <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-tenue">
            <Gauge className="size-3" />
            Costo por hora
          </div>
          <ul className="space-y-1.5">
            {partes.map(([nombre, valor]) => (
              <li key={nombre} className="flex items-center gap-2.5 text-[12px]">
                <span className="w-44 shrink-0 truncate text-suave">{nombre}</span>
                <Barra
                  valor={(valor / total) * 100}
                  className="flex-1"
                  tono={valor / total > 0.5 ? 'corte' : 'acero'}
                />
                <span className="tabular w-20 text-right font-semibold">{money(valor, sim, 0)}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-baseline justify-between border-t-2 border-tinta pt-2.5">
            <strong className="text-[13px]">COSTO POR HORA</strong>
            <span className="tabular text-2xl font-extrabold">{money(c.total, sim, 0)}</span>
          </div>
          <div className="tabular mt-0.5 text-right text-[11px] text-tenue">
            {money(c.total / 60, sim, 0)} por minuto de máquina
          </div>
        </div>
      </PanelCuerpo>
    </Panel>
  );
}
