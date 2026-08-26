/**
 * Costos de estructura — cuánto cuesta tener el taller abierto una hora.
 *
 * Es la pantalla que más plata mueve del sistema y la que menos se abre: de
 * acá sale el $/hora que multiplica el tiempo de TODOS los trabajos. Un campo
 * mal cargado no rompe nada, hace que todos los precios salgan mal en
 * silencio — ya pasó con los $150.000/h de consumibles.
 *
 * Por eso los avisos de `revisarDatos()` no se quedan en el Panel: se muestran
 * **al lado del campo que los causa**. Antes el Panel decía "los consumibles
 * son el 85 % del costo horario" y te mandaba a una pantalla donde había que
 * adivinar cuál de veinte campos era.
 *
 * Todo recalcula mientras se escribe y nada se guarda hasta apretar Guardar:
 * hay que poder probar "¿y si el alquiler sube 30 %?" sin miedo.
 */

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Save, HardHat, FlaskConical, RotateCcw, Clock, Zap, Receipt, Gauge, TriangleAlert, OctagonAlert,
} from 'lucide-react';

import { usarEstado } from '@/lib/estado';
import { money, num, pct } from '@/lib/formato';
import { Panel, PanelCab, PanelTitulo, PanelCuerpo } from '@/componentes/ui/panel';
import { Boton } from '@/componentes/ui/boton';
import { Campo, Entrada, Selector, Opcion } from '@/componentes/ui/campos';
import { Dialogo, ContenidoDialogo, Aviso, Barra } from '@/componentes/ui/varios';
import { cn } from '@/lib/utils';

import {
  calcularEstructura, calcularCostoHoraMaquina, puntoEquilibrio, costoHoraOperario,
  evaluarGeneradorN2, TARIFAS_EDELAR, UOM_RAMA17, CARGAS_LABORALES,
} from '@core/costos.js';
import { revisarDatos } from '@core/salud.js';

/* Campos de gasto fijo. La etiqueta dice qué es en criollo, no el nombre del
   campo: "sueldos que no producen" se entiende, `sueldosIndirectosMes` no. */
const GASTOS = [
  { k: 'alquilerMes', txt: 'Alquiler del galpón' },
  { k: 'expensasServiciosMes', txt: 'Agua, internet, teléfono, limpieza' },
  { k: 'sueldosIndirectosMes', txt: 'Sueldos que no producen' },
  { k: 'contadorMes', txt: 'Contador y honorarios' },
  { k: 'segurosMes', txt: 'Seguros' },
  { k: 'tasaMunicipalMes', txt: 'Tasa municipal' },
  { k: 'otrosFijosMes', txt: 'Otros gastos fijos' },
  { k: 'cuotaCreditoMes', txt: 'Cuota de crédito de la máquina' },
];

export function VistaCostos() {
  const config = usarEstado((s) => s.config);
  const maquinas = usarEstado((s) => s.maquinas);
  const materiales = usarEstado((s) => s.materiales);
  const guardarConfig = usarEstado((s) => s.guardarConfig);
  const guardarMaquinas = usarEstado((s) => s.guardarMaquinas);
  const sim = usarEstado((s) => s.simbolo());

  /* Copia local: se juega con los números y recién al guardar se escriben.
     Arranca en null y se llena cuando llega la configuración: inicializarlo
     con `config?.estructura || {}` dejaba el borrador VACÍO para siempre si el
     primer render ocurría antes de que cargara, y la pantalla mostraba
     "$0/hora productiva" sobre "0 horas de taller abierto". */
  const [borrador, setBorrador] = useState(null);

  useEffect(() => {
    // Sólo la primera vez: después no se pisa lo que la persona esté editando.
    if (borrador === null && config?.estructura) setBorrador({ ...config.estructura });
  }, [config, borrador]);
  const [guardando, setGuardando] = useState(false);
  const [herramienta, setHerramienta] = useState(null);

  const sucio = useMemo(
    () => borrador !== null && JSON.stringify(borrador) !== JSON.stringify(config?.estructura || {}),
    [borrador, config]
  );

  const est = useMemo(() => calcularEstructura(borrador || config?.estructura), [borrador, config]);
  const equilibrio = useMemo(
    () => puntoEquilibrio(est, config?.comercial?.margen ?? 45),
    [est, config]
  );

  /* Los mismos avisos que muestra el Panel, pero acá al lado del campo. Se
     evalúan con el BORRADOR, así se ve desaparecer el aviso mientras se
     corrige el número. */
  const revision = useMemo(
    () =>
      config
        ? revisarDatos({
            config: { ...config, estructura: borrador || config.estructura },
            maquinas,
            materiales,
          })
        : null,
    [config, borrador, maquinas, materiales]
  );
  const avisosDe = (area) => revision?.hallazgos.filter((h) => h.area === area) || [];

  const set = (k, v) => setBorrador((b) => ({ ...b, [k]: v }));

  const cambiarTarifa = (id) => {
    const t = TARIFAS_EDELAR.categorias.find((x) => x.id === id);
    if (!t) return;
    setBorrador((b) => ({
      ...b,
      tarifa: t.id,
      cargoPotenciaKWMes: t.cargoPotenciaKWMes,
      cargoFijoElectricoMes: t.cargoFijoMes,
      costoKWh: t.energiaResto,
    }));
  };

  const guardar = async () => {
    setGuardando(true);
    try {
      await guardarConfig({ estructura: borrador });
      toast.success('Costos guardados');
    } catch (e) {
      toast.error('No se pudo guardar: ' + e.message);
    } finally {
      setGuardando(false);
    }
  };

  if (!config || !borrador) return <div className="panel-kort h-[60vh] animate-pulse" />;

  const num2 = (k, extra = {}) => (
    <Entrada
      type="number"
      step="any"
      value={borrador[k] ?? 0}
      onChange={(e) => set(k, parseFloat(e.target.value) || 0)}
      {...extra}
    />
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-tinta">Costos de estructura</h1>
          <p className="mt-0.5 text-[13px] text-suave">
            Cuánto cuesta tener el taller abierto una hora, y de dónde sale ese número
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Boton onClick={() => setHerramienta('operario')}>
            <HardHat />
            Calcular hora de operario
          </Boton>
          <Boton onClick={() => setHerramienta('n2')}>
            <FlaskConical />
            ¿Conviene un generador de N₂?
          </Boton>
          {sucio ? (
            <Boton tono="fantasma" onClick={() => setBorrador({ ...(config.estructura || {}) })}>
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

      <Aviso nivel="aviso">
        <strong>Estos números son de referencia para La Rioja, no son los tuyos.</strong> La tarifa
        eléctrica sí es la real de EDELAR (Res. EUCOP 001/2026) y el sueldo sale del convenio UOM
        rama 17. El alquiler, los seguros y el resto están puestos para que el sistema arranque con
        un orden de magnitud creíble: cambialos por lo que pagás vos.
      </Aviso>

      {/* Avisos que dependen de la estructura, arriba de los campos que los causan */}
      {avisosDe('estructura').map((h, i) => (
        <Aviso key={i} nivel={h.nivel}>{h.msg}</Aviso>
      ))}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Panel>
            <PanelCab>
              <Clock className="size-3.5 text-corte-500" />
              <PanelTitulo>Horas de trabajo</PanelTitulo>
            </PanelCab>
            <PanelCuerpo className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo etiqueta="Días hábiles por mes">{num2('diasHabilesMes')}</Campo>
                <Campo etiqueta="Horas por día">{num2('horasPorDia')}</Campo>
              </div>
              <Campo
                etiqueta="Ocupación productiva"
                ayuda="El resto del tiempo la máquina espera trabajo. En un taller chico es 40-75 %."
              >
                {num2('ocupacionProductiva', { unidad: '%' })}
              </Campo>
              <p className="tabular text-[11.5px] text-suave">
                Da <strong>{num(est.horasProductivas, 1)} horas productivas</strong> por mes, sobre{' '}
                {num(est.horasAbiertas, 0)} de taller abierto.
              </p>
            </PanelCuerpo>
          </Panel>

          <Panel>
            <PanelCab acciones={<span className="text-[11px] text-tenue">EDELAR</span>}>
              <Zap className="size-3.5 text-alerta-500" />
              <PanelTitulo>Energía eléctrica</PanelTitulo>
            </PanelCab>
            <PanelCuerpo className="space-y-3">
              <Campo etiqueta="Categoría tarifaria">
                <Selector valor={borrador.tarifa || ''} alCambiar={cambiarTarifa}>
                  {TARIFAS_EDELAR.categorias.map((t) => (
                    <Opcion key={t.id} valor={t.id}>{t.nombre}</Opcion>
                  ))}
                </Selector>
              </Campo>
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo
                  etiqueta="Potencia contratada"
                  ayuda="Se paga se use o no. Si tenés de más, es plata tirada todos los meses."
                >
                  {num2('potenciaContratadaKW', { unidad: 'kW' })}
                </Campo>
                <Campo etiqueta="Cargo por potencia">
                  {num2('cargoPotenciaKWMes', { unidad: '$/kW-mes' })}
                </Campo>
                <Campo etiqueta="Cargo fijo mensual">{num2('cargoFijoElectricoMes', { unidad: '$' })}</Campo>
                <Campo etiqueta="Energía">{num2('costoKWh', { unidad: '$/kWh' })}</Campo>
              </div>
            </PanelCuerpo>
          </Panel>
        </div>

        <Panel>
          <PanelCab>
            <Receipt className="size-3.5 text-acero-500" />
            <PanelTitulo>Gastos fijos mensuales</PanelTitulo>
          </PanelCab>
          <PanelCuerpo className="space-y-3">
            {GASTOS.map((g) => (
              <Campo key={g.k} etiqueta={g.txt}>{num2(g.k, { unidad: '$/mes' })}</Campo>
            ))}
            <Campo etiqueta="Ingresos brutos">{num2('ingresosBrutosPct', { unidad: '%' })}</Campo>
          </PanelCuerpo>
        </Panel>
      </div>

      {/* ---------------- De dónde sale el costo por hora ---------------- */}
      <Panel>
        <PanelCab
          acciones={
            <span className="tabular text-[13px] font-bold">
              {money(est.porHora, sim, 0)}/hora productiva
            </span>
          }
        >
          <Gauge className="size-3.5 text-corte-500" />
          <PanelTitulo>De dónde sale el costo por hora</PanelTitulo>
        </PanelCab>
        <PanelCuerpo className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Kpi etiqueta="Estructura por mes" valor={money(est.totalMes, sim, 0)} />
            <Kpi etiqueta="Horas productivas" valor={num(est.horasProductivas, 1) + ' h'} />
            <Kpi
              etiqueta="Facturación de equilibrio"
              valor={money(equilibrio.facturacionNecesaria, sim, 0)}
              nota={`${money(equilibrio.porDiaHabil, sim, 0)} por día hábil`}
            />
          </div>

          <ul className="space-y-1.5">
            {(est.items || []).map((i) => (
              <li key={i.id} className="flex items-center gap-3 text-[12.5px]">
                <span className="w-56 shrink-0 truncate text-suave" title={i.detalle || i.nombre}>
                  {i.nombre}
                </span>
                <Barra valor={i.pct} className="flex-1" tono={i.pct > 50 ? 'corte' : 'acero'} />
                <span className="tabular w-24 text-right font-semibold">{money(i.valor, sim, 0)}</span>
                <span className="tabular w-12 text-right text-tenue">{num(i.pct, 0)} %</span>
              </li>
            ))}
          </ul>
        </PanelCuerpo>
      </Panel>

      {/* ---------------- Máquinas ---------------- */}
      <div className="grid gap-4 lg:grid-cols-2">
        {maquinas.map((m) => {
          const c = calcularCostoHoraMaquina(m, est);
          const suyos = avisosDe('maquinas').filter((h) => h.donde.includes(m.nombre || m.id));
          const partes = [
            ['Amortización', c.amortizacion],
            ['Energía', c.energia],
            ['Mantenimiento', c.mantenimiento],
            ['Consumibles', c.consumibles],
            ['Operario', c.operario],
            ['Estructura', c.estructura],
          ].filter(([, v]) => v > 0);

          return (
            <Panel key={m.id} className={cn(suyos.length && 'border-l-4 border-l-alerta-500')}>
              <PanelCab
                acciones={
                  <span className="tabular text-[13px] font-bold">{money(c.total, sim, 0)}/h</span>
                }
              >
                <PanelTitulo>{m.nombre}</PanelTitulo>
              </PanelCab>
              <PanelCuerpo className="space-y-2">
                {suyos.map((h, i) => (
                  <Aviso key={i} nivel={h.nivel}>{h.msg}</Aviso>
                ))}
                <ul className="space-y-1">
                  {partes.map(([nombre, valor]) => (
                    <li key={nombre} className="flex items-center gap-3 text-[12.5px]">
                      <span className="w-32 shrink-0 text-suave">{nombre}</span>
                      <Barra
                        valor={(valor / c.total) * 100}
                        className="flex-1"
                        tono={valor / c.total > 0.5 ? 'corte' : 'acero'}
                      />
                      <span className="tabular w-24 text-right font-semibold">{money(valor, sim, 0)}</span>
                      <span className="tabular w-12 text-right text-tenue">
                        {num((valor / c.total) * 100, 0)} %
                      </span>
                    </li>
                  ))}
                </ul>
              </PanelCuerpo>
            </Panel>
          );
        })}
      </div>

      <CalculadoraOperario
        abierto={herramienta === 'operario'}
        alCerrar={() => setHerramienta(null)}
        maquinas={maquinas}
        guardarMaquinas={guardarMaquinas}
        sim={sim}
      />
      <GeneradorN2
        abierto={herramienta === 'n2'}
        alCerrar={() => setHerramienta(null)}
        precioN2={config?.produccion?.gases?.N2 ?? 1400}
        sim={sim}
      />
    </div>
  );
}

function Kpi({ etiqueta, valor, nota }) {
  return (
    <div className="rounded-xl border border-borde bg-panel-alto px-3 py-2.5">
      <div className="text-[10px] font-bold uppercase tracking-wider text-tenue">{etiqueta}</div>
      <div className="tabular mt-0.5 text-lg font-bold leading-none">{valor}</div>
      {nota ? <div className="mt-1 text-[11px] text-suave">{nota}</div> : null}
    </div>
  );
}

function Fila({ etiqueta, valor, total = false }) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-3 border-b border-dashed border-borde py-1.5 last:border-0 text-[12.5px]',
        total && 'mt-1 border-b-0 border-t-2 border-solid border-tinta pt-2 text-[15px] font-bold'
      )}
    >
      <span className={total ? '' : 'text-suave'}>{etiqueta}</span>
      <span className="tabular font-mono">{valor}</span>
    </div>
  );
}

/**
 * Lo que sale una hora de operario de verdad.
 *
 * El recibo dice una cosa y la hora cuesta otra: adicionales, cargas
 * sociales, aguinaldo y las horas que se pagan sin trabajar. Casi el doble.
 */
function CalculadoraOperario({ abierto, alCerrar, maquinas, guardarMaquinas, sim }) {
  const [categoria, setCategoria] = useState('operador-cnc');
  const cat = UOM_RAMA17.categorias.find((c) => c.id === categoria) || UOM_RAMA17.categorias[0];
  const c = useMemo(() => costoHoraOperario(cat.basicoHora, CARGAS_LABORALES), [cat]);

  const aplicar = async () => {
    try {
      await guardarMaquinas(
        maquinas.map((m) => ({ ...m, costo: { ...m.costo, operarioHora: Math.round(c.total) } }))
      );
      toast.success('Costo de operario aplicado a todas las máquinas');
      alCerrar();
    } catch (e) {
      toast.error('No se pudo aplicar: ' + e.message);
    }
  };

  return (
    <Dialogo open={abierto} onOpenChange={(v) => !v && alCerrar()}>
      <ContenidoDialogo
        titulo="Costo real de una hora de operario"
        descripcion="Escala UOM rama 17 (metalmecánica) vigente desde abril 2026. La paritaria quedó congelada, así que estos valores siguen rigiendo."
        ancho="max-w-xl"
      >
        <Campo etiqueta="Categoría">
          <Selector valor={categoria} alCambiar={setCategoria}>
            {UOM_RAMA17.categorias.map((x) => (
              <Opcion key={x.id} valor={x.id} detalle={`${money(x.basicoHora, sim, 2)}/h básico`}>
                {x.nombre}
              </Opcion>
            ))}
          </Selector>
        </Campo>

        <div className="mt-4">
          <Fila etiqueta="Básico de convenio" valor={money(c.basico, sim, 2)} />
          <Fila
            etiqueta={`Adicionales (${CARGAS_LABORALES.adicionalesConvenio} %)`}
            valor={money(c.conAdicionales - c.basico, sim, 2)}
          />
          <Fila
            etiqueta={`Cargas sociales + ART (${(
              CARGAS_LABORALES.contribucionesPatronales +
              CARGAS_LABORALES.art +
              CARGAS_LABORALES.seguroVida
            ).toFixed(1)} %)`}
            valor={money(c.cargasSociales, sim, 2)}
          />
          <Fila etiqueta={`Aguinaldo (${CARGAS_LABORALES.sac} %)`} valor={money(c.sac, sim, 2)} />
          <Fila
            etiqueta={`Vacaciones y ausentismo (${CARGAS_LABORALES.factorHorasNoTrabajadas} %)`}
            valor={money(c.ajusteHorasNoTrabajadas, sim, 2)}
          />
          <Fila etiqueta="COSTO POR HORA TRABAJADA" valor={money(c.total, sim, 2)} total />
        </div>

        <p className="mt-3 text-[12px] leading-relaxed text-suave">
          El recibo dice {money(c.basico, sim, 0)} la hora, pero la hora de esa persona te sale{' '}
          <strong>{money(c.total, sim, 0)}</strong>: {num(c.multiplicador, 2)} veces más. Ese es el
          número que va en Máquinas.
        </p>

        <Boton tono="corte" className="mt-4" onClick={aplicar}>
          Aplicar a las máquinas
        </Boton>
      </ContenidoDialogo>
    </Dialogo>
  );
}

/**
 * ¿Conviene comprar un generador de nitrógeno?
 *
 * Es la inversión más rentable de un taller que corta inoxidable seguido, y
 * casi nadie la calcula.
 */
function GeneradorN2({ abierto, alCerrar, precioN2, sim }) {
  const [consumo, setConsumo] = useState(3000);
  const [precio, setPrecio] = useState(precioN2);
  const [inversion, setInversion] = useState(38000000);

  const r = useMemo(
    () =>
      evaluarGeneradorN2({
        consumoM3Mes: consumo || 0,
        precioM3Actual: precio || 0,
        inversion: inversion || 0,
      }),
    [consumo, precio, inversion]
  );

  return (
    <Dialogo open={abierto} onOpenChange={(v) => !v && alCerrar()}>
      <ContenidoDialogo
        titulo="¿Conviene comprar un generador de nitrógeno?"
        descripcion="Cortar inoxidable con N₂ consume entre 25 y 95 m³/h. Un generador PSA produce a unos $320 el m³ contra los $1.400 del termo."
        ancho="max-w-xl"
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <Campo etiqueta="Consumo por mes">
            <Entrada
              type="number" step="any" unidad="m³"
              value={consumo}
              onChange={(e) => setConsumo(parseFloat(e.target.value) || 0)}
            />
          </Campo>
          <Campo etiqueta="Lo que pagás el m³">
            <Entrada
              type="number" step="any"
              value={precio}
              onChange={(e) => setPrecio(parseFloat(e.target.value) || 0)}
            />
          </Campo>
          <Campo etiqueta="Inversión del equipo">
            <Entrada
              type="number" step="any"
              value={inversion}
              onChange={(e) => setInversion(parseFloat(e.target.value) || 0)}
            />
          </Campo>
        </div>

        <div className="mt-4">
          <Fila etiqueta="Gasto actual en nitrógeno" valor={money(consumo * precio, sim, 0) + '/mes'} />
          <Fila etiqueta="Ahorro con generador" valor={money(r.ahorroMes, sim, 0) + '/mes'} />
          <Fila etiqueta="Amortización del equipo" valor={money(r.amortizacionMes, sim, 0) + '/mes'} />
          <Fila
            etiqueta={r.conviene ? 'GANANCIA NETA' : 'PÉRDIDA NETA'}
            valor={money(r.beneficioMes, sim, 0) + '/mes'}
            total
          />
        </div>

        <Aviso nivel={r.conviene ? 'info' : 'aviso'} className="mt-4">
          {r.conviene
            ? `Con ese consumo el generador se paga en ${num(r.mesesRepago, 0)} meses y después son ${money(r.ahorroMes, sim, 0)} por mes que quedan en el taller.`
            : `Con ese consumo todavía no conviene: el repago daría ${
                isFinite(r.mesesRepago) ? num(r.mesesRepago, 0) + ' meses' : 'nunca'
              }. Volvé a mirarlo cuando cortes más inoxidable.`}
        </Aviso>
      </ContenidoDialogo>
    </Dialogo>
  );
}
