/**
 * Configuración — los parámetros con los que se cotiza.
 *
 * Es la tercera pantalla de parámetros, después de Costos y Máquinas, y la que
 * más cosas distintas junta: los datos de la empresa que salen en el PDF, la
 * política comercial que decide los precios, los catálogos de acabados y
 * procesos, y el respaldo.
 *
 * Va en pestañas por eso mismo: en una sola columna había que bajar ocho
 * bloques para llegar a los descuentos por cantidad, y nadie llegaba.
 *
 * Los avisos de `revisarDatos()` aparecen dentro de la pestaña que los causa —
 * el `aprovechamientoObjetivo` mal puesto está subfacturando material en cada
 * cotización y hasta ahora sólo se veía en el Panel, lejos del campo.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Save, RotateCcw, Plus, Trash2, Download, Upload, Building2, Percent,
  Factory, ListOrdered, DatabaseBackup,
} from 'lucide-react';

import { api } from '@/lib/api';
import { usarEstado } from '@/lib/estado';
import { descargar } from '@/lib/formato';
import { Panel, PanelCab, PanelTitulo, PanelCuerpo } from '@/componentes/ui/panel';
import { Boton } from '@/componentes/ui/boton';
import { Campo, Entrada, AreaTexto, Selector, Opcion } from '@/componentes/ui/campos';
import {
  Pestanias, ListaPestanias, Pestania, ContenidoPestania, Aviso, Dialogo, ContenidoDialogo,
} from '@/componentes/ui/varios';
import { revisarDatos } from '@core/salud.js';
import { DEFAULT_ACABADOS, DEFAULT_PROCESOS } from '@core/pricing.js';

const CONDICIONES_BASE = [
  'Validez de la oferta según la fecha indicada en el encabezado.',
  'Los precios están sujetos a variación del costo de la materia prima.',
  'El plazo de entrega comienza con la aprobación y los archivos definitivos.',
  'Los archivos deben entregarse en DXF, DWG o STEP.',
  'Tolerancias según DIN 2768-m salvo indicación en plano.',
  'El desarrollo de piezas plegadas se calcula con el K-factor del material.',
  'No incluye tratamientos superficiales ni herrajes salvo que estén detallados.',
  'El material sobrante queda en poder de KORT salvo acuerdo previo.',
].join('\n');

const EMPRESA = [
  { k: 'nombre', txt: 'Nombre comercial', ancho: true },
  { k: 'razonSocial', txt: 'Razón social', ancho: true },
  { k: 'cuit', txt: 'CUIT' },
  { k: 'direccion', txt: 'Dirección', ancho: true },
  { k: 'telefono', txt: 'Teléfono' },
  { k: 'email', txt: 'Email' },
  { k: 'web', txt: 'Sitio web / redes', ancho: true },
];

const IVA = ['Responsable Inscripto', 'Monotributo', 'Exento', 'Consumidor Final'];

export function VistaConfiguracion() {
  const config = usarEstado((s) => s.config);
  const maquinas = usarEstado((s) => s.maquinas);
  const materiales = usarEstado((s) => s.materiales);
  const guardarConfig = usarEstado((s) => s.guardarConfig);
  const cargar = usarEstado((s) => s.cargar);
  const sim = usarEstado((s) => s.simbolo());

  const [b, setB] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [restaurando, setRestaurando] = useState(null);
  const entradaArchivo = useRef(null);

  useEffect(() => {
    if (b === null && config) {
      setB({
        empresa: { ...(config.empresa || {}) },
        comercial: { ...(config.comercial || {}), descuentos: [...(config.comercial?.descuentos || [])] },
        produccion: { ...(config.produccion || {}), gases: { ...(config.produccion?.gases || {}) } },
        acabados: structuredClone(config.acabados || DEFAULT_ACABADOS),
        procesos: structuredClone(config.procesos || DEFAULT_PROCESOS),
        textos: { ...(config.textos || {}) },
      });
    }
  }, [config, b]);

  const sucio = useMemo(() => {
    if (!b || !config) return false;
    return ['empresa', 'comercial', 'produccion', 'acabados', 'procesos', 'textos'].some(
      (k) => JSON.stringify(b[k]) !== JSON.stringify(config[k] ?? (k === 'acabados' ? DEFAULT_ACABADOS : k === 'procesos' ? DEFAULT_PROCESOS : {}))
    );
  }, [b, config]);

  /* Se evalúa contra el BORRADOR: el aviso desaparece mientras se corrige. */
  const revision = useMemo(
    () => (config && b ? revisarDatos({ config: { ...config, ...b }, maquinas, materiales }) : null),
    [config, b, maquinas, materiales]
  );
  const avisos = (area) => revision?.hallazgos.filter((h) => h.area === area) || [];

  const set = (grupo, k, v) => setB((x) => ({ ...x, [grupo]: { ...x[grupo], [k]: v } }));

  const guardar = async () => {
    setGuardando(true);
    try {
      await guardarConfig(b);
      toast.success('Configuración guardada');
    } catch (e) {
      toast.error('No se pudo guardar: ' + e.message);
    } finally {
      setGuardando(false);
    }
  };

  const exportar = async () => {
    try {
      const datos = await api.get('respaldo');
      const nombre = `respaldo-kort-${new Date().toISOString().slice(0, 10)}.json`;
      descargar(nombre, JSON.stringify(datos, null, 2), 'application/json');
      toast.success('Respaldo descargado');
    } catch (e) {
      toast.error('No se pudo exportar: ' + e.message);
    }
  };

  const importar = (file) => {
    const lector = new FileReader();
    lector.onload = async () => {
      try {
        await api.post('respaldo', JSON.parse(String(lector.result)));
        await cargar();
        setB(null); // que se rearme con lo que acaba de entrar
        toast.success('Respaldo restaurado');
      } catch (e) {
        toast.error('No se pudo importar: ' + e.message);
      }
    };
    lector.readAsText(file);
  };

  const restaurarTabla = async () => {
    const tabla = restaurando;
    setRestaurando(null);
    try {
      await api.post('restaurar', { tabla });
      await cargar();
      setB(null);
      toast.success(`${tabla} restaurado a los valores de fábrica`);
    } catch (e) {
      toast.error('No se pudo restaurar: ' + e.message);
    }
  };

  if (!config || !b) return <div className="panel-kort h-[60vh] animate-pulse" />;

  const txt = (grupo, k, txtLabel, extra = {}) => (
    <Campo etiqueta={txtLabel} {...(extra.ancho ? { className: 'sm:col-span-2' } : {})}>
      <Entrada value={b[grupo][k] ?? ''} onChange={(e) => set(grupo, k, e.target.value)} />
    </Campo>
  );

  const nmr = (grupo, k, txtLabel, u, ayuda) => (
    <Campo etiqueta={txtLabel} ayuda={ayuda}>
      <Entrada
        type="number" step="any" unidad={u}
        value={b[grupo][k] ?? 0}
        onChange={(e) => set(grupo, k, parseFloat(e.target.value) || 0)}
      />
    </Campo>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-tinta">Configuración</h1>
          <p className="mt-0.5 text-[13px] text-suave">
            Los parámetros con los que se cotiza y los datos que salen en el PDF
          </p>
        </div>
        <div className="flex gap-2">
          {sucio ? (
            <Boton tono="fantasma" onClick={() => setB(null)}>
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

      <Pestanias defaultValue="comercial">
        <ListaPestanias className="flex-wrap">
          <Pestania value="comercial"><Percent />Política comercial</Pestania>
          <Pestania value="produccion"><Factory />Producción y gases</Pestania>
          <Pestania value="catalogos"><ListOrdered />Acabados y procesos</Pestania>
          <Pestania value="empresa"><Building2 />Empresa y PDF</Pestania>
          <Pestania value="respaldo"><DatabaseBackup />Respaldo</Pestania>
        </ListaPestanias>

        {/* ---------------- Comercial ---------------- */}
        <ContenidoPestania value="comercial" className="mt-4 space-y-4">
          {avisos('comercial').map((h, i) => (
            <Aviso key={i} nivel={h.nivel}>{h.msg}</Aviso>
          ))}

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel>
              <PanelCab><PanelTitulo>Precio</PanelTitulo></PanelCab>
              <PanelCuerpo className="grid gap-3 sm:grid-cols-2">
                {nmr('comercial', 'margen', 'Margen sobre costo', '%')}
                {nmr('comercial', 'iva', 'IVA', '%')}
                {nmr('comercial', 'ingresosBrutos', 'Ingresos brutos', '%')}
                {nmr('comercial', 'redondeo', 'Redondear precios a múltiplos de', sim)}
                {nmr('comercial', 'minimoFacturacion', 'Mínimo de facturación', sim)}
                {nmr(
                  'comercial', 'minimoPorItem', 'Mínimo por ítem', sim,
                  'Tiene que cubrir al menos la puesta a punto: un trabajo de una pieza son minutos de programa que se pagan igual.'
                )}
                {nmr('comercial', 'ingenieriaHora', 'Hora de ingeniería / CAD', sim)}
                {nmr('comercial', 'validezDias', 'Validez del presupuesto', 'días')}
                <Campo etiqueta="Discriminar IVA en el presupuesto" className="sm:col-span-2">
                  <label className="flex cursor-pointer items-center gap-2.5 text-[13px]">
                    <input
                      type="checkbox"
                      className="size-4 cursor-pointer accent-corte-500"
                      checked={!!b.comercial.mostrarIVA}
                      onChange={(e) => set('comercial', 'mostrarIVA', e.target.checked)}
                    />
                    Mostrar el IVA como línea aparte
                  </label>
                </Campo>
              </PanelCuerpo>
            </Panel>

            <Panel>
              <PanelCab><PanelTitulo>Moneda, recargos y material</PanelTitulo></PanelCab>
              <PanelCuerpo className="grid gap-3 sm:grid-cols-2">
                {txt('comercial', 'simbolo', 'Símbolo de moneda')}
                {txt('comercial', 'moneda', 'Moneda')}
                {nmr('comercial', 'tipoCambio', 'Tipo de cambio (referencia USD)')}
                {nmr('comercial', 'recargoUrgente', 'Recargo por urgencia', '%')}
                {nmr('comercial', 'recargoExpress', 'Recargo express 24 h', '%')}
                {nmr(
                  'comercial', 'recargoMaterialCliente', 'Recargo si el material lo pone el cliente', '%',
                  'Se pierde el margen del material y el riesgo de una chapa fea pasa al taller.'
                )}
                <Campo etiqueta="Cómo se cobra el material" className="sm:col-span-2">
                  <Selector
                    valor={b.comercial.modoMaterial || 'auto'}
                    alCambiar={(v) => set('comercial', 'modoMaterial', v)}
                  >
                    <Opcion valor="auto" detalle="chapa entera si el nesting se llenó, si no área consumida">
                      Automático
                    </Opcion>
                    <Opcion valor="nesting" detalle="siempre la chapa completa">Chapas completas</Opcion>
                    <Opcion valor="prorrateado" detalle="sólo lo que ocupa la pieza">Área consumida</Opcion>
                  </Selector>
                </Campo>
                {nmr(
                  'comercial', 'aprovechamientoObjetivo', 'Aprovechamiento objetivo (0 a 1)', null,
                  'Desde este umbral se cobra la chapa entera. Un nesting real de piezas variadas da 60-75 %: pedirle más hace que nunca se alcance y el retazo no lo pague nadie.'
                )}
                {nmr('comercial', 'scrapMinimo', 'Recorte inevitable', '%')}
              </PanelCuerpo>
            </Panel>
          </div>

          <TablaDescuentos
            filas={b.comercial.descuentos || []}
            alCambiar={(descuentos) => setB((x) => ({ ...x, comercial: { ...x.comercial, descuentos } }))}
          />
        </ContenidoPestania>

        {/* ---------------- Producción ---------------- */}
        <ContenidoPestania value="produccion" className="mt-4 space-y-4">
          {avisos('produccion').map((h, i) => (
            <Aviso key={i} nivel={h.nivel}>{h.msg}</Aviso>
          ))}

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel>
              <PanelCab><PanelTitulo>Nesting</PanelTitulo></PanelCab>
              <PanelCuerpo className="grid gap-3 sm:grid-cols-2">
                {nmr('produccion', 'separacionPiezas', 'Separación entre piezas', 'mm')}
                {nmr('produccion', 'margenChapa', 'Borde de chapa no utilizable', 'mm')}
              </PanelCuerpo>
            </Panel>

            <Panel>
              <PanelCab><PanelTitulo>Gases de asistencia</PanelTitulo></PanelCab>
              <PanelCuerpo className="grid gap-3 sm:grid-cols-2">
                {['O2', 'N2', 'AIRE'].map((g) => (
                  <Campo
                    key={g}
                    etiqueta={{ O2: 'Oxígeno', N2: 'Nitrógeno', AIRE: 'Aire comprimido' }[g]}
                  >
                    <Entrada
                      type="number" step="any" unidad={`${sim}/m³`}
                      value={b.produccion.gases?.[g] ?? 0}
                      onChange={(e) =>
                        setB((x) => ({
                          ...x,
                          produccion: {
                            ...x.produccion,
                            gases: { ...x.produccion.gases, [g]: parseFloat(e.target.value) || 0 },
                          },
                        }))
                      }
                    />
                  </Campo>
                ))}
                <p className="text-[11px] leading-relaxed text-tenue sm:col-span-2">
                  Es el dato más incierto del sistema y el que más mueve el precio del inoxidable:
                  cortar con nitrógeno consume entre 25 y 95 m³/h contra 1 a 3 del oxígeno. Pedile
                  la cotización a tu proveedor.
                </p>
              </PanelCuerpo>
            </Panel>
          </div>
        </ContenidoPestania>

        {/* ---------------- Catálogos ---------------- */}
        <ContenidoPestania value="catalogos" className="mt-4 space-y-4">
          <TablaCatalogo
            titulo="Acabados superficiales"
            filas={b.acabados}
            tipos={[
              { v: 'ninguno', t: 'No se cobra' },
              { v: 'superficie', t: 'Superficie (m²)' },
              { v: 'peso', t: 'Peso (kg)' },
              { v: 'perimetro', t: 'Perímetro (m)' },
            ]}
            alCambiar={(acabados) => setB((x) => ({ ...x, acabados }))}
            porDefecto={DEFAULT_ACABADOS}
          />
          <TablaCatalogo
            titulo="Procesos adicionales"
            filas={b.procesos}
            tipos={[
              { v: 'hora', t: 'Hora de trabajo' },
              { v: 'operacion', t: 'Por operación / unidad' },
            ]}
            alCambiar={(procesos) => setB((x) => ({ ...x, procesos }))}
            porDefecto={DEFAULT_PROCESOS}
          />
        </ContenidoPestania>

        {/* ---------------- Empresa ---------------- */}
        <ContenidoPestania value="empresa" className="mt-4 space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel>
              <PanelCab><PanelTitulo>Datos de la empresa</PanelTitulo></PanelCab>
              <PanelCuerpo className="grid gap-3 sm:grid-cols-2">
                {EMPRESA.map((f) => txt('empresa', f.k, f.txt, f))}
                <Campo etiqueta="Condición frente al IVA">
                  <Selector
                    valor={b.empresa.condicionIVA || IVA[0]}
                    alCambiar={(v) => set('empresa', 'condicionIVA', v)}
                  >
                    {IVA.map((x) => <Opcion key={x} valor={x}>{x}</Opcion>)}
                  </Selector>
                </Campo>
              </PanelCuerpo>
            </Panel>

            <Panel>
              <PanelCab><PanelTitulo>Condiciones que salen en el PDF</PanelTitulo></PanelCab>
              <PanelCuerpo>
                <AreaTexto
                  rows={12}
                  value={b.textos.condiciones ?? CONDICIONES_BASE}
                  onChange={(e) => set('textos', 'condiciones', e.target.value)}
                />
                <p className="mt-2 text-[11px] text-tenue">Una condición por línea.</p>
              </PanelCuerpo>
            </Panel>
          </div>
        </ContenidoPestania>

        {/* ---------------- Respaldo ---------------- */}
        <ContenidoPestania value="respaldo" className="mt-4">
          <Panel>
            <PanelCab><PanelTitulo>Respaldo y datos</PanelTitulo></PanelCab>
            <PanelCuerpo className="space-y-4">
              <p className="text-[12.5px] leading-relaxed text-suave">
                El respaldo se lleva todo: clientes, presupuestos, órdenes, materiales, máquinas y
                configuración. Es un archivo JSON que podés guardar donde quieras.
              </p>
              <div className="flex flex-wrap gap-2">
                <Boton onClick={exportar}>
                  <Download />
                  Descargar respaldo completo
                </Boton>
                <Boton onClick={() => entradaArchivo.current?.click()}>
                  <Upload />
                  Restaurar desde un archivo
                </Boton>
                <input
                  ref={entradaArchivo}
                  type="file"
                  accept=".json"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && importar(e.target.files[0])}
                />
              </div>

              <Aviso nivel="aviso">
                Restaurar un respaldo <strong>reemplaza todo lo que hay ahora</strong>. No se
                fusiona: lo que no esté en el archivo se pierde.
              </Aviso>

              <div className="border-t border-borde pt-4">
                <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-tenue">
                  Volver a los valores de fábrica
                </div>
                <div className="flex flex-wrap gap-2">
                  {['materiales', 'maquinas', 'config'].map((t) => (
                    <Boton key={t} tono="peligro" tam="sm" onClick={() => setRestaurando(t)}>
                      {t === 'config' ? 'Configuración' : t === 'maquinas' ? 'Máquinas' : 'Materiales'}
                    </Boton>
                  ))}
                </div>
              </div>
            </PanelCuerpo>
          </Panel>
        </ContenidoPestania>
      </Pestanias>

      <Dialogo open={!!restaurando} onOpenChange={(v) => !v && setRestaurando(null)}>
        <ContenidoDialogo titulo="Volver a los valores de fábrica" ancho="max-w-md">
          <p className="text-[13px] leading-relaxed">
            Se van a reemplazar <strong>{restaurando}</strong> por los valores de referencia del
            sistema. Lo que tengas cargado ahí se pierde.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Boton onClick={() => setRestaurando(null)}>Cancelar</Boton>
            <Boton tono="peligro" onClick={restaurarTabla}>Restaurar</Boton>
          </div>
        </ContenidoDialogo>
      </Dialogo>
    </div>
  );
}

/**
 * Descuentos por cantidad.
 *
 * Se muestran ordenados por cantidad porque así se leen: "de 10 en adelante,
 * 5 %". Desordenados no se entiende cuál pisa a cuál.
 */
function TablaDescuentos({ filas, alCambiar }) {
  const ordenadas = [...filas].sort((a, b) => (a.desde || 0) - (b.desde || 0));

  const cambiar = (i, k, v) => {
    const copia = [...ordenadas];
    copia[i] = { ...copia[i], [k]: v };
    alCambiar(copia);
  };

  return (
    <Panel>
      <PanelCab
        acciones={
          <Boton tam="sm" onClick={() => alCambiar([...ordenadas, { desde: 10, pct: 5 }])}>
            <Plus />
            Agregar
          </Boton>
        }
      >
        <PanelTitulo>Descuentos por cantidad</PanelTitulo>
      </PanelCab>
      <PanelCuerpo sinPad>
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-borde">
              <th className="px-4 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-tenue">
                Desde (unidades)
              </th>
              <th className="px-4 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-tenue">
                Descuento
              </th>
              <th className="w-12" />
            </tr>
          </thead>
          <tbody>
            {ordenadas.map((d, i) => (
              <tr key={i} className="border-b border-borde last:border-0">
                <td className="px-4 py-2">
                  <Entrada
                    type="number" min={1} className="max-w-[140px]"
                    value={d.desde ?? 0}
                    onChange={(e) => cambiar(i, 'desde', parseInt(e.target.value, 10) || 0)}
                  />
                </td>
                <td className="px-4 py-2">
                  <Entrada
                    type="number" min={0} max={90} unidad="%" className="max-w-[140px]"
                    value={d.pct ?? 0}
                    onChange={(e) => cambiar(i, 'pct', parseFloat(e.target.value) || 0)}
                  />
                </td>
                <td className="px-4 py-2">
                  <Boton
                    tono="peligro" tam="iconoSm"
                    onClick={() => alCambiar(ordenadas.filter((_, j) => j !== i))}
                  >
                    <Trash2 />
                  </Boton>
                </td>
              </tr>
            ))}
            {!ordenadas.length ? (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-[12px] text-tenue">
                  Sin descuentos por cantidad
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </PanelCuerpo>
    </Panel>
  );
}

/** Acabados y procesos: misma tabla, distintos tipos de cobro. */
function TablaCatalogo({ titulo, filas, tipos, alCambiar, porDefecto }) {
  const cambiar = (i, k, v) => alCambiar(filas.map((f, j) => (j === i ? { ...f, [k]: v } : f)));

  return (
    <Panel>
      <PanelCab
        acciones={
          <>
            <Boton
              tam="sm"
              onClick={() =>
                alCambiar([
                  ...filas,
                  { id: 'x' + Date.now().toString(36), nombre: 'Nuevo', tipo: tipos[0].v, valor: 0, unidad: '' },
                ])
              }
            >
              <Plus />
              Agregar
            </Boton>
            <Boton tam="sm" tono="fantasma" onClick={() => alCambiar(structuredClone(porDefecto))}>
              <RotateCcw />
              Restaurar
            </Boton>
          </>
        }
      >
        <PanelTitulo>{titulo}</PanelTitulo>
      </PanelCab>
      <PanelCuerpo sinPad>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-borde">
                {['Nombre', 'Se cobra por', 'Valor', 'Unidad', ''].map((t, i) => (
                  <th
                    key={t + i}
                    className="whitespace-nowrap px-3 py-2 text-left text-[10px] font-bold uppercase tracking-wider text-tenue"
                  >
                    {t}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filas.map((f, i) => (
                <tr key={f.id || i} className="border-b border-borde last:border-0">
                  <td className="px-3 py-2">
                    <Entrada value={f.nombre || ''} onChange={(e) => cambiar(i, 'nombre', e.target.value)} />
                  </td>
                  <td className="px-3 py-2">
                    <Selector valor={f.tipo} alCambiar={(v) => cambiar(i, 'tipo', v)} className="w-[190px]">
                      {tipos.map((o) => <Opcion key={o.v} valor={o.v}>{o.t}</Opcion>)}
                    </Selector>
                  </td>
                  <td className="px-3 py-2">
                    <Entrada
                      type="number" step="any" className="max-w-[130px]"
                      value={f.valor ?? 0}
                      onChange={(e) => cambiar(i, 'valor', parseFloat(e.target.value) || 0)}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Entrada
                      className="max-w-[150px]"
                      value={f.unidad || ''}
                      onChange={(e) => cambiar(i, 'unidad', e.target.value)}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Boton
                      tono="peligro" tam="iconoSm"
                      onClick={() => alCambiar(filas.filter((_, j) => j !== i))}
                    >
                      <Trash2 />
                    </Boton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </PanelCuerpo>
    </Panel>
  );
}
