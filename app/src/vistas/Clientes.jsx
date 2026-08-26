/**
 * Clientes — la base de contactos y qué trabajo trae cada uno.
 *
 * La vista anterior mostraba cuánto facturó cada cliente. Eso alcanza para
 * saber quién compra, no para saber **quién conviene**: un cliente que trae
 * trabajos grandes de mucha chapa factura mucho y puede dejar menos por hora
 * de máquina que otro que trae piezas chicas seguido.
 *
 * Por eso además del facturado va el rendimiento: lo que deja por hora del
 * recurso escaso. Es la misma vara que usa el cotizador, y acá sirve para
 * decidir a quién llamar cuando hay hueco en la máquina.
 *
 * ⚠️ El rendimiento sale sólo de los trabajos APROBADOS. Un presupuesto que el
 * cliente no tomó dice lo que se le ofreció, no lo que dejó.
 */

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Search, Pencil, Calculator, Trash2, Users } from 'lucide-react';

import { api } from '@/lib/api';
import { usarEstado } from '@/lib/estado';
import { money, num, fecha } from '@/lib/formato';
import { Panel, PanelCab, PanelCuerpo, Vacio } from '@/componentes/ui/panel';
import { Boton } from '@/componentes/ui/boton';
import { Campo, Entrada, AreaTexto, Selector, Opcion } from '@/componentes/ui/campos';
import { Dialogo, ContenidoDialogo } from '@/componentes/ui/varios';
import { cn } from '@/lib/utils';
import { MINIMO_HORAS } from '@core/rentabilidad.js';

const CAMPOS = [
  { k: 'nombre', txt: 'Nombre / Razón social', ancho: true },
  { k: 'cuit', txt: 'CUIT' },
  { k: 'telefono', txt: 'Teléfono' },
  { k: 'email', txt: 'Email', tipo: 'email' },
  { k: 'direccion', txt: 'Dirección', ancho: true },
  { k: 'contacto', txt: 'Persona de contacto', ancho: true },
];

const VIVOS = ['aprobado', 'facturado'];

export function VistaClientes() {
  const sim = usarEstado((s) => s.simbolo());
  const recargarClientes = usarEstado((s) => s.recargarClientes);
  const navegar = useNavigate();
  const qc = useQueryClient();

  const [busca, setBusca] = useState('');
  const [orden, setOrden] = useState('facturado');
  const [editando, setEditando] = useState(null); // objeto o 'nuevo'
  const [aBorrar, setABorrar] = useState(null);

  const { data: clientes = [], isLoading } = useQuery({
    queryKey: ['clientes'],
    queryFn: () => api.get('clientes'),
  });
  const { data: presupuestos = [] } = useQuery({
    queryKey: ['presupuestos'],
    queryFn: () => api.get('presupuestos'),
  });

  const recargar = async () => {
    qc.invalidateQueries({ queryKey: ['clientes'] });
    // El cotizador lee los clientes del estado global, no de React Query
    await recargarClientes().catch(() => {});
  };

  /* Historial por cliente. Se cruza por id y también por nombre: los
     presupuestos viejos se guardaban sin `clienteId`, y perder ese historial
     haría ver a un cliente de años como si nunca hubiera comprado. */
  const conHistorial = useMemo(() => {
    return clientes.map((c) => {
      const suyos = presupuestos.filter(
        (p) => p.clienteId === c.id || (!p.clienteId && p.cliente?.nombre === c.nombre)
      );
      const cerrados = suyos.filter((p) => VIVOS.includes(p.estado));
      const facturado = cerrados.reduce((a, p) => a + (p.resumen?.total || 0), 0);

      // Rendimiento: utilidad sobre horas de máquina, sólo de lo aprobado
      let horas = 0;
      let utilidad = 0;
      for (const p of cerrados) {
        const h = (p.resumen?.tiempoProduccion || 0) / 3600;
        if (h > MINIMO_HORAS) {
          horas += h;
          utilidad += p.resumen?.utilidad || 0;
        }
      }
      return {
        c,
        n: suyos.length,
        cerrados: cerrados.length,
        facturado,
        horas,
        rinde: horas > MINIMO_HORAS ? utilidad / horas : null,
        ultimo: suyos.map((p) => p.fecha || p.creado).filter(Boolean).sort().pop(),
      };
    });
  }, [clientes, presupuestos]);

  const lista = useMemo(() => {
    const q = busca.trim().toLowerCase();
    const filtrados = conHistorial.filter(({ c }) =>
      !q ||
      [c.nombre, c.cuit, c.telefono, c.email, c.contacto]
        .some((x) => String(x || '').toLowerCase().includes(q))
    );
    return filtrados.sort((a, b) => {
      if (orden === 'rendimiento') return (b.rinde ?? -1) - (a.rinde ?? -1);
      if (orden === 'nombre') return String(a.c.nombre || '').localeCompare(String(b.c.nombre || ''));
      if (orden === 'ultimo') return String(b.ultimo || '').localeCompare(String(a.ultimo || ''));
      return b.facturado - a.facturado;
    });
  }, [conHistorial, busca, orden]);

  const guardar = async (datos) => {
    if (!String(datos.nombre || '').trim()) return toast.error('El nombre es obligatorio');
    try {
      if (editando === 'nuevo') await api.post('clientes', datos);
      else await api.put('clientes/' + editando.id, datos);
      setEditando(null);
      await recargar();
      toast.success('Cliente guardado');
    } catch (e) {
      toast.error('No se pudo guardar: ' + e.message);
    }
  };

  const borrar = async () => {
    const c = aBorrar;
    setABorrar(null);
    try {
      await api.del('clientes/' + c.id);
      await recargar();
      toast.success('Cliente eliminado');
    } catch (e) {
      toast.error('No se pudo eliminar: ' + e.message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-tinta">Clientes</h1>
          <p className="mt-0.5 text-[13px] text-suave">
            Quién compra, cuánto deja y a quién llamar cuando hay hueco en la máquina
          </p>
        </div>
        <Boton tono="corte" onClick={() => setEditando('nuevo')}>
          <Plus />
          Nuevo cliente
        </Boton>
      </div>

      <Panel>
        <PanelCab
          acciones={
            <span className="tabular text-[11px] text-tenue">
              {lista.length} de {clientes.length}
            </span>
          }
        >
          <div className="relative w-full max-w-[280px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-tenue" />
            <Entrada
              placeholder="Buscar cliente…"
              className="h-8 pl-8"
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
            />
          </div>
          <Selector valor={orden} alCambiar={setOrden} className="h-8 w-[190px]">
            <Opcion valor="facturado">Los que más facturaron</Opcion>
            <Opcion valor="rendimiento" detalle="lo que deja cada hora de máquina">
              Los que más rinden
            </Opcion>
            <Opcion valor="ultimo">Los más recientes</Opcion>
            <Opcion valor="nombre">Por nombre</Opcion>
          </Selector>
        </PanelCab>

        <PanelCuerpo sinPad>
          {isLoading ? (
            <div className="space-y-2 p-4">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-10 animate-pulse rounded bg-panel-alto" />
              ))}
            </div>
          ) : !lista.length ? (
            <Vacio
              icono={<Users />}
              titulo={clientes.length ? 'Ningún cliente coincide' : 'Todavía no hay clientes'}
              detalle={
                clientes.length
                  ? 'Probá con otro texto.'
                  : 'Se cargan solos al guardar un presupuesto con un nombre nuevo.'
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-borde">
                    {['Cliente', 'CUIT', 'Contacto', 'Presup.', 'Facturado', '$/h máquina', 'Último', ''].map(
                      (t, i) => (
                        <th
                          key={t + i}
                          className={cn(
                            'whitespace-nowrap px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-tenue',
                            [3, 4, 5].includes(i) ? 'text-right' : 'text-left'
                          )}
                        >
                          {t}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody>
                  {lista.map(({ c, n, cerrados, facturado, rinde, horas, ultimo }) => (
                    <tr key={c.id} className="border-b border-borde transition-colors last:border-0 hover:bg-panel-alto">
                      <td className="px-3 py-2">
                        <button
                          onClick={() => setEditando(c)}
                          className="cursor-pointer text-left font-semibold hover:underline"
                        >
                          {c.nombre}
                        </button>
                        {c.notas ? (
                          <div className="max-w-[260px] truncate text-[11px] text-tenue">{c.notas}</div>
                        ) : null}
                        {c.descuento > 0 ? (
                          <div className="text-[11px] text-corte-500">
                            Descuento habitual {num(c.descuento, 0)} %
                          </div>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{c.cuit || '—'}</td>
                      <td className="max-w-[220px] truncate px-3 py-2 text-xs text-suave">
                        {[c.telefono, c.email].filter(Boolean).join(' · ') || '—'}
                      </td>
                      <td
                        className="tabular px-3 py-2 text-right"
                        title={`${cerrados} aprobado(s) de ${n}`}
                      >
                        {n}
                      </td>
                      <td className="tabular whitespace-nowrap px-3 py-2 text-right font-semibold">
                        {money(facturado, sim, 0)}
                      </td>
                      <td
                        className="tabular whitespace-nowrap px-3 py-2 text-right"
                        title={
                          rinde != null
                            ? `${num(horas, 1)} h de máquina en trabajos aprobados`
                            : 'Sin trabajos aprobados con tiempo de producción guardado'
                        }
                      >
                        {rinde != null ? (
                          <span className={cn(orden === 'rendimiento' && 'font-semibold')}>
                            {money(rinde, sim, 0)}
                          </span>
                        ) : (
                          <span className="text-[11px] text-tenue">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs text-suave">{fecha(ultimo)}</td>
                      <td className="px-3 py-2">
                        <div className="flex gap-1">
                          <Boton tam="iconoSm" title="Editar" onClick={() => setEditando(c)}>
                            <Pencil />
                          </Boton>
                          <Boton
                            tam="iconoSm"
                            title="Cotizar para este cliente"
                            onClick={() => navegar(`/cotizador?cliente=${c.id}`)}
                          >
                            <Calculator />
                          </Boton>
                          <Boton tono="peligro" tam="iconoSm" title="Eliminar" onClick={() => setABorrar(c)}>
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

      <FichaCliente
        cliente={editando === 'nuevo' ? null : editando}
        abierto={!!editando}
        alCerrar={() => setEditando(null)}
        alGuardar={guardar}
      />

      <Dialogo open={!!aBorrar} onOpenChange={(v) => !v && setABorrar(null)}>
        <ContenidoDialogo titulo="Eliminar cliente" ancho="max-w-md">
          <p className="text-[13px] leading-relaxed">
            Se va a borrar <strong>{aBorrar?.nombre}</strong>. Los presupuestos ya emitidos no se
            tocan.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Boton onClick={() => setABorrar(null)}>Cancelar</Boton>
            <Boton tono="peligro" onClick={borrar}>Eliminar</Boton>
          </div>
        </ContenidoDialogo>
      </Dialogo>
    </div>
  );
}

function FichaCliente({ cliente, abierto, alCerrar, alGuardar }) {
  /* `key` en el Dialogo remonta el formulario al cambiar de cliente: sin eso
     los campos conservarían lo del anterior. */
  const [d, setD] = useState({});

  const inicial = useMemo(
    () => ({
      nombre: cliente?.nombre || '',
      cuit: cliente?.cuit || '',
      telefono: cliente?.telefono || '',
      email: cliente?.email || '',
      direccion: cliente?.direccion || '',
      contacto: cliente?.contacto || '',
      descuento: cliente?.descuento ?? 0,
      notas: cliente?.notas || '',
    }),
    [cliente]
  );

  const valor = { ...inicial, ...d };
  const set = (k, v) => setD((x) => ({ ...x, [k]: v }));

  const cerrar = () => {
    setD({});
    alCerrar();
  };

  return (
    <Dialogo open={abierto} onOpenChange={(v) => !v && cerrar()}>
      <ContenidoDialogo
        titulo={cliente ? 'Editar cliente' : 'Nuevo cliente'}
        ancho="max-w-xl"
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {CAMPOS.map((f) => (
            <Campo key={f.k} etiqueta={f.txt} className={f.ancho ? 'sm:col-span-2' : ''}>
              <Entrada
                type={f.tipo || 'text'}
                value={valor[f.k]}
                onChange={(e) => set(f.k, e.target.value)}
              />
            </Campo>
          ))}
          <Campo
            etiqueta="Descuento habitual"
            ayuda="Se sugiere al cotizarle, no se aplica solo."
          >
            <Entrada
              type="number" min={0} max={90} step={1} unidad="%"
              value={valor.descuento}
              onChange={(e) => set('descuento', parseFloat(e.target.value) || 0)}
            />
          </Campo>
          <Campo etiqueta="Notas" className="sm:col-span-2">
            <AreaTexto rows={3} value={valor.notas} onChange={(e) => set('notas', e.target.value)} />
          </Campo>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Boton onClick={cerrar}>Cancelar</Boton>
          <Boton tono="corte" onClick={() => alGuardar(valor)}>
            Guardar
          </Boton>
        </div>
      </ContenidoDialogo>
    </Dialogo>
  );
}
