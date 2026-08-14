/**
 * Stock de chapa y retazos.
 *
 * El retazero no se mezcla con Materiales: un material dice cuanto cuesta el
 * kilo, mientras que cada retazo dice que superficie concreta existe hoy en
 * el deposito. Esa separacion permite cotizar sin inventar disponibilidad.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Archive, Pencil, Plus, Save, Search, Trash2, X,
} from 'lucide-react';

import { Panel, PanelCab, PanelTitulo, PanelCuerpo, Vacio } from '@/componentes/ui/panel';
import { Boton } from '@/componentes/ui/boton';
import { Campo, Entrada, Selector, Opcion, AreaTexto } from '@/componentes/ui/campos';
import { Aviso, Dialogo, ContenidoDialogo, CerrarDialogo } from '@/componentes/ui/varios';
import { Insignia } from '@/componentes/ui/insignia';
import { usarEstado } from '@/lib/estado';
import { money, num } from '@/lib/formato';
import { cn } from '@/lib/utils';
import {
  candidatosRetazo, normalizarRetazo, pesoRetazoKg, resumenStockRetazos, superficieRetazoM2, valorRetazo,
} from '@core/retazos.js';

const clonar = (v) => JSON.parse(JSON.stringify(v));
const ESTADO_TONO = { disponible: 'verde', reservado: 'amarillo', descartado: 'rojo' };
const ESTADO_TEXTO = { disponible: 'Disponible', reservado: 'Reservado', descartado: 'Descartado' };

function fichaVacia(materiales) {
  const m = materiales[0];
  return {
    id: `retazo-${Date.now().toString(36)}`,
    materialId: m?.id || '',
    espesor: m?.espesores?.[0] || 1.5,
    w: 1000,
    h: 500,
    cantidad: 1,
    estado: 'disponible',
    ubicacion: 'Deposito',
    lote: '',
    origen: 'corte',
    notas: '',
    _nuevo: true,
  };
}

function estadoStock(r) {
  return <Insignia tono={ESTADO_TONO[r.estado] || 'gris'}>{ESTADO_TEXTO[r.estado] || r.estado}</Insignia>;
}

export function VistaStock() {
  const guardados = usarEstado((s) => s.retazos);
  const materiales = usarEstado((s) => s.materiales);
  const guardarRetazos = usarEstado((s) => s.guardarRetazos);
  const sim = usarEstado((s) => s.simbolo());
  const [retazos, setRetazos] = useState([]);
  const sembrado = useRef(false);
  const [sucio, setSucio] = useState(false);
  const [editando, setEditando] = useState(null);
  const [filtro, setFiltro] = useState({ materialId: '', estado: 'disponible', texto: '' });
  const [busqueda, setBusqueda] = useState({ materialId: '', espesor: '', w: '', h: '' });

  useEffect(() => {
    if (sembrado.current || !Array.isArray(guardados)) return;
    sembrado.current = true;
    setRetazos(clonar(guardados));
  }, [guardados]);

  useEffect(() => {
    if (!busqueda.materialId && materiales[0]) {
      setBusqueda((b) => ({ ...b, materialId: materiales[0].id, espesor: materiales[0].espesores?.[0] || '' }));
    }
  }, [materiales, busqueda.materialId]);

  const porMaterial = useMemo(() => new Map(materiales.map((m) => [m.id, m])), [materiales]);
  const resumen = useMemo(() => resumenStockRetazos(retazos, materiales), [retazos, materiales]);
  const lista = useMemo(() => retazos
    .map(normalizarRetazo)
    .filter((r) => !filtro.materialId || r.materialId === filtro.materialId)
    .filter((r) => !filtro.estado || r.estado === filtro.estado)
    .filter((r) => !filtro.texto || `${r.ubicacion} ${r.lote} ${r.notas}`.toLowerCase().includes(filtro.texto.toLowerCase()))
    .sort((a, b) => a.materialId.localeCompare(b.materialId) || a.espesor - b.espesor || a.w * a.h - b.w * b.h), [retazos, filtro]);
  const candidatos = useMemo(() => candidatosRetazo(retazos, {
    materialId: busqueda.materialId,
    espesor: Number(busqueda.espesor),
    w: Number(busqueda.w),
    h: Number(busqueda.h),
  }, { margen: 10 }), [retazos, busqueda]);

  const total = useMemo(() => resumen.reduce((a, x) => ({
    unidades: a.unidades + x.disponibles,
    m2: a.m2 + x.superficieM2,
    kg: a.kg + x.pesoKg,
    valor: a.valor + x.valor,
  }), { unidades: 0, m2: 0, kg: 0, valor: 0 }), [resumen]);

  const tocar = (fn) => {
    setRetazos((prev) => {
      const copia = clonar(prev);
      fn(copia);
      return copia;
    });
    setSucio(true);
  };

  const guardar = async () => {
    try {
      const normalizados = retazos.map((r) => ({ ...normalizarRetazo(r), modificado: new Date().toISOString() }));
      await guardarRetazos(normalizados);
      setSucio(false);
      toast.success('Stock de retazos guardado');
    } catch (e) {
      toast.error(`No se pudo guardar el retazero: ${e.message}`);
    }
  };

  const borrar = (r) => {
    if (!confirm(`Se va a quitar el retazo de ${r.w} × ${r.h} mm del inventario.\n\nSi ya se uso, conviene dejarlo en cero y conservar la trazabilidad.`)) return;
    setRetazos((prev) => prev.filter((x) => x.id !== r.id));
    setSucio(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Stock de chapa</h1>
          <p className="text-[13px] text-suave">Retazos identificados para bajar compras y evitar material inmovilizado</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Boton tam="sm" onClick={() => setEditando(fichaVacia(materiales))}><Plus />Nuevo retazo</Boton>
          <Boton tam="sm" tono={sucio ? 'corte' : 'neutro'} onClick={guardar} disabled={!sucio}>
            <Save />{sucio ? 'Guardar cambios' : 'Sin cambios'}
          </Boton>
        </div>
      </div>

      <Aviso nivel="info">
        Cargá cada sobrante con su medida real y ubicación. El sistema sólo ofrece un retazo si coincide el material,
        el espesor y entra el rectángulo envolvente de la pieza; el nesting confirma el encastre final antes de cortar.
      </Aviso>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi titulo="Unidades disponibles" valor={num(total.unidades, 0)} detalle="retazos identificados" />
        <Kpi titulo="Superficie útil" valor={`${num(total.m2, 2)} m²`} detalle="sin contar descartados" />
        <Kpi titulo="Peso en deposito" valor={`${num(total.kg, 1)} kg`} detalle="material recuperable" />
        <Kpi titulo="Valor de referencia" valor={money(total.valor, sim, 0)} detalle="a precio de compra actual" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Panel>
          <PanelCab acciones={<span className="text-[11px] text-tenue">{lista.length} registros visibles</span>}>
            <Archive className="size-3.5 text-corte-500" />
            <PanelTitulo>Retazos en inventario</PanelTitulo>
          </PanelCab>
          <PanelCuerpo sinPad>
            <div className="grid gap-2 border-b border-borde p-3 md:grid-cols-[180px_150px_1fr]">
              <Selector valor={filtro.materialId || '__todos__'} alCambiar={(v) => setFiltro((x) => ({ ...x, materialId: v === '__todos__' ? '' : v }))}>
                <Opcion valor="__todos__">Todos los materiales</Opcion>
                {materiales.map((m) => <Opcion key={m.id} valor={m.id}>{m.nombre}</Opcion>)}
              </Selector>
              <Selector valor={filtro.estado || '__todos__'} alCambiar={(v) => setFiltro((x) => ({ ...x, estado: v === '__todos__' ? '' : v }))}>
                <Opcion valor="__todos__">Todos los estados</Opcion>
                <Opcion valor="disponible">Disponibles</Opcion>
                <Opcion valor="reservado">Reservados</Opcion>
                <Opcion valor="descartado">Descartados</Opcion>
              </Selector>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-tenue" />
                <Entrada className="pl-9" value={filtro.texto} onChange={(e) => setFiltro((x) => ({ ...x, texto: e.target.value }))} placeholder="Ubicacion, lote o nota" />
              </div>
            </div>
            {lista.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead><tr className="border-b border-borde">
                    {['Material', 'Medida', 'Cant.', 'Superficie', 'Peso', 'Valor', 'Estado', ''].map((h, i) => <th key={h} className={cn('px-3 py-2 text-[10px] uppercase tracking-wide text-tenue', i > 1 && i < 6 ? 'text-right' : 'text-left')}>{h}</th>)}
                  </tr></thead>
                  <tbody>{lista.map((r) => {
                    const m = porMaterial.get(r.materialId);
                    return <tr key={r.id} className="border-b border-borde/60 last:border-0 hover:bg-panel-alto">
                      <td className="px-3 py-2"><div className="font-semibold">{m?.nombre || r.materialId}</div><div className="text-[10.5px] text-tenue">{r.ubicacion || 'Sin ubicacion'}{r.lote ? ` · ${r.lote}` : ''}</div></td>
                      <td className="px-3 py-2 font-mono text-suave">{r.w} × {r.h} · {r.espesor} mm</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.cantidad}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{num(superficieRetazoM2(r) / Math.max(1, r.cantidad), 2)} m²/u</td>
                      <td className="px-3 py-2 text-right tabular-nums">{num(pesoRetazoKg(r, m), 1)} kg</td>
                      <td className="px-3 py-2 text-right tabular-nums">{money(valorRetazo(r, m), sim, 0)}</td>
                      <td className="px-3 py-2">{estadoStock(r)}</td>
                      <td className="px-3 py-2"><div className="flex justify-end gap-1"><Boton tam="iconoSm" tono="fantasma" title="Editar retazo" onClick={() => setEditando(r)}><Pencil /></Boton><Boton tam="iconoSm" tono="peligro" title="Quitar del inventario" onClick={() => borrar(r)}><Trash2 /></Boton></div></td>
                    </tr>;
                  })}</tbody>
                </table>
              </div>
            ) : <Vacio icono={<Archive />} titulo="No hay retazos con este filtro" detalle="Cargá el primer sobrante cuando termina un programa de corte." />}
          </PanelCuerpo>
        </Panel>

        <Panel>
          <PanelCab><Search className="size-3.5 text-chapa-500" /><PanelTitulo>Buscar material para una pieza</PanelTitulo></PanelCab>
          <PanelCuerpo className="space-y-3">
            <p className="text-[12px] leading-relaxed text-suave">Usá la medida del rectángulo envolvente. Se deja un margen de 10 mm por lado para el nesting.</p>
            <Campo etiqueta="Material"><Selector valor={busqueda.materialId} alCambiar={(v) => setBusqueda((x) => ({ ...x, materialId: v, espesor: materiales.find((m) => m.id === v)?.espesores?.[0] || '' }))}>{materiales.map((m) => <Opcion key={m.id} valor={m.id}>{m.nombre}</Opcion>)}</Selector></Campo>
            <div className="grid grid-cols-3 gap-2"><Campo etiqueta="Espesor"><Entrada type="number" step="0.1" value={busqueda.espesor} onChange={(e) => setBusqueda((x) => ({ ...x, espesor: e.target.value }))} unidad="mm" /></Campo><Campo etiqueta="Ancho"><Entrada type="number" value={busqueda.w} onChange={(e) => setBusqueda((x) => ({ ...x, w: e.target.value }))} unidad="mm" /></Campo><Campo etiqueta="Alto"><Entrada type="number" value={busqueda.h} onChange={(e) => setBusqueda((x) => ({ ...x, h: e.target.value }))} unidad="mm" /></Campo></div>
            {candidatos.length ? <div className="space-y-2"><div className="text-[11px] font-semibold uppercase tracking-wide text-suave">{candidatos.length} candidato{candidatos.length === 1 ? '' : 's'}</div>{candidatos.slice(0, 5).map((c) => <div key={c.id} className="rounded-lg border border-borde bg-panel-alto p-2.5"><div className="flex items-center justify-between gap-2"><strong className="text-[12px]">{c.w} × {c.h} mm</strong><Insignia tono="verde">{c.rotacion ? 'Gira 90°' : 'Entra derecho'}</Insignia></div><div className="mt-1 text-[11px] text-suave">{c.ubicacion || 'Sin ubicacion'} · aprovecha {num(c.aprovechamiento * 100, 0)} % · {c.cantidad} unidad{c.cantidad === 1 ? '' : 'es'}</div></div>)}</div> : <Aviso nivel="info">Cargá material, espesor, ancho y alto para encontrar un retazo compatible.</Aviso>}
          </PanelCuerpo>
        </Panel>
      </div>

      {editando ? <DialogoRetazo retazo={editando} materiales={materiales} alCerrar={() => setEditando(null)} alGuardar={(datos) => {
        tocar((copia) => {
          const i = copia.findIndex((x) => x.id === datos.id);
          if (i >= 0) copia[i] = datos;
          else copia.push(datos);
        });
        setEditando(null);
      }} /> : null}
    </div>
  );
}

function Kpi({ titulo, valor, detalle }) {
  return <Panel><PanelCuerpo><div className="text-[10px] font-bold uppercase tracking-wide text-tenue">{titulo}</div><div className="mt-1 text-xl font-bold tabular-nums text-tinta">{valor}</div><div className="mt-1 text-[11px] text-suave">{detalle}</div></PanelCuerpo></Panel>;
}

function DialogoRetazo({ retazo, materiales, alCerrar, alGuardar }) {
  const [f, setF] = useState(() => normalizarRetazo(retazo));
  const material = materiales.find((m) => m.id === f.materialId);
  const actualizar = (campo, valor) => setF((x) => ({ ...x, [campo]: valor }));
  return <Dialogo open onOpenChange={(v) => !v && alCerrar()}>
    <ContenidoDialogo titulo={retazo._nuevo ? 'Nuevo retazo' : 'Editar retazo'} descripcion="Medidas reales del sobrante, no las de la chapa de proveedor." ancho="max-w-2xl">
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="Material"><Selector valor={f.materialId} alCambiar={(v) => actualizar('materialId', v)}>{materiales.map((m) => <Opcion key={m.id} valor={m.id}>{m.nombre}</Opcion>)}</Selector></Campo>
        <Campo etiqueta="Estado"><Selector valor={f.estado} alCambiar={(v) => actualizar('estado', v)}><Opcion valor="disponible">Disponible</Opcion><Opcion valor="reservado">Reservado</Opcion><Opcion valor="descartado">Descartado</Opcion></Selector></Campo>
        <Campo etiqueta="Espesor" ayuda="Tiene que coincidir con el espesor que se va a cortar."><Entrada type="number" step="0.1" min="0.1" value={f.espesor} onChange={(e) => actualizar('espesor', +e.target.value || 0)} unidad="mm" /></Campo>
        <Campo etiqueta="Cantidad"><Entrada type="number" min="0" step="1" value={f.cantidad} onChange={(e) => actualizar('cantidad', +e.target.value || 0)} unidad="u." /></Campo>
        <Campo etiqueta="Ancho"><Entrada type="number" min="1" value={f.w} onChange={(e) => actualizar('w', +e.target.value || 0)} unidad="mm" /></Campo>
        <Campo etiqueta="Alto"><Entrada type="number" min="1" value={f.h} onChange={(e) => actualizar('h', +e.target.value || 0)} unidad="mm" /></Campo>
        <Campo etiqueta="Ubicacion"><Entrada value={f.ubicacion} onChange={(e) => actualizar('ubicacion', e.target.value)} placeholder="Rack A · nivel 2" /></Campo>
        <Campo etiqueta="Lote / referencia"><Entrada value={f.lote} onChange={(e) => actualizar('lote', e.target.value)} placeholder="OT-2026-0042" /></Campo>
      </div>
      <Campo etiqueta="Notas" className="mt-3"><AreaTexto rows={3} value={f.notas} onChange={(e) => actualizar('notas', e.target.value)} placeholder="Oxido, rayas, cara protegida, lado util..." /></Campo>
      {material ? <div className="mt-3 rounded-lg bg-panel-alto p-3 text-[12px] text-suave">Este registro representa <strong>{num(superficieRetazoM2(f), 2)} m²</strong>, <strong>{num(pesoRetazoKg(f, material), 1)} kg</strong> y aproximadamente <strong>{money(valorRetazo(f, material), '$', 0)}</strong> de material recuperable.</div> : null}
      <div className="mt-4 flex justify-end gap-2"><CerrarDialogo asChild><Boton><X />Cancelar</Boton></CerrarDialogo><Boton tono="corte" onClick={() => alGuardar({ ...normalizarRetazo(f), modificado: new Date().toISOString() })}><Save />Guardar retazo</Boton></div>
    </ContenidoDialogo>
  </Dialogo>;
}
