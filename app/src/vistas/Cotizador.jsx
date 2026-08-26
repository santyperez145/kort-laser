/**
 * Cotizador — la vista central del sistema.
 *
 * Arma un presupuesto ítem por ítem, recalcula el precio mientras se escribe
 * y desde acá salen el PDF, la orden de trabajo y los DXF para la máquina.
 *
 * El cálculo pasa entero en el navegador (`src/core/pricing.js`). El servidor
 * sólo guarda. Es lo que permite que mover una cota mueva el precio sin
 * esperar una vuelta de red — y en un mostrador esa espera se nota.
 */

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { FilePlus2 } from 'lucide-react';

import { api } from '@/lib/api';
import { usarEstado } from '@/lib/estado';
import { requerimientosDeCotizacion } from '@core/reposicion.js';
import { crearPlanProduccion } from '@core/produccion.js';
import { Panel, PanelCab, PanelTitulo, PanelCuerpo } from '@/componentes/ui/panel';
import { Boton } from '@/componentes/ui/boton';
import { Aviso } from '@/componentes/ui/varios';
import { Campo, Entrada, Selector, Opcion } from '@/componentes/ui/campos';
import { InsigniaEstado } from '@/componentes/ui/insignia';
import { ESTADOS_PRESUPUESTO, money } from '@/lib/formato';

import { CtxCotizador, docVacio, itemNuevo, usarCotizador } from './cotizador/contexto';
import { evaluarVigencia, materialesQueSeMovieron } from '@core/vigencia.js';
import { ListaItems } from './cotizador/ListaItems';
import { Lienzo } from './cotizador/Lienzo';
import { Parametros } from './cotizador/Parametros';
import { Precio } from './cotizador/Precio';

import { construir } from '@core/library.js';
import { cotizarPresupuesto } from '@core/pricing.js';

/** Reconstruye la geometría de un ítem (biblioteca = recalculada; DXF = guardada). */
function geometria(item, materiales) {
  const material = materiales.find((m) => m.id === item.materialId) || materiales[0];
  if (item.origen === 'libreria') {
    try {
      const r = construir(item.piezaId, item.params, { espesor: item.espesor, material });
      return { shape: r.shape, meta: r, avisos: r.avisos || [] };
    } catch (e) {
      return { shape: null, meta: null, avisos: [{ nivel: 'error', msg: e.message }] };
    }
  }
  return { shape: item.shape, meta: item.meta || { modelo3D: { tipo: 'plano' } }, avisos: [] };
}

/** Clave donde el diseñador de plegado deja la pieza para cotizar. */
export const CLAVE_ITEM_PENDIENTE = 'kort-item-pendiente';

/* ── Borrador que sobrevive a cerrar la pestaña ─────────────────────────── */

/**
 * El presupuesto en curso vivía sólo en memoria. Cambiar a Materiales y
 * volver, recargar la página o cerrar el navegador sin querer borraba todo lo
 * cargado sin un aviso — y armar un presupuesto de varios ítems con DXF del
 * cliente son veinte minutos de trabajo.
 *
 * Se guarda en `localStorage` y no en la base a propósito: un borrador no es
 * un presupuesto. Mandarlo al servidor llenaría el listado de basura a medio
 * hacer y consumiría números de presupuesto que después quedan con agujeros.
 */
const CLAVE_BORRADOR = 'kort-borrador-cotizador';

function guardarBorrador(doc) {
  try {
    // Un documento sin nada cargado no pisa uno que sí tenía cosas
    const vacio = !doc?.cliente?.nombre && (doc?.items || []).length <= 1 && !doc?.items?.[0]?.shape;
    if (doc?.id || vacio) return;
    localStorage.setItem(CLAVE_BORRADOR, JSON.stringify({ doc, fecha: Date.now() }));
  } catch {
    /* Sin espacio (un DXF grande puede llenar la cuota): se sigue trabajando
       en memoria. No vale la pena molestar con un error por esto. */
  }
}

function leerBorrador() {
  try {
    const crudo = localStorage.getItem(CLAVE_BORRADOR);
    if (!crudo) return null;
    const { doc, fecha } = JSON.parse(crudo);
    // Una semana. Más viejo que eso ya no es "lo que estaba haciendo".
    if (!doc || Date.now() - fecha > 7 * 24 * 3600 * 1000) return null;
    return doc;
  } catch {
    return null;
  }
}

function olvidarBorrador() {
  try {
    localStorage.removeItem(CLAVE_BORRADOR);
  } catch {
    /* nada que hacer */
  }
}

/**
 * Levanta la pieza que dejó otra vista y la borra: es un pase de mano, no un
 * guardado. Si quedara, volver al cotizador la volvería a agregar sola.
 */
function tomarItemPendiente() {
  try {
    const crudo = sessionStorage.getItem(CLAVE_ITEM_PENDIENTE);
    if (!crudo) return null;
    sessionStorage.removeItem(CLAVE_ITEM_PENDIENTE);
    const item = JSON.parse(crudo);
    return item?.shape ? item : null;
  } catch {
    return null;
  }
}

/**
 * Deja pasar el valor recién cuando dejaste de escribir.
 *
 * `useDeferredValue` posterga el pintado pero NO evita el cálculo: escribir
 * "300" en la cantidad dispara tres cotizaciones (3, 30 y 300) y cada una
 * anida el lote entero. Medido con 300 piezas: una tarea de 3,5 segundos con
 * el hilo bloqueado, tres veces seguidas.
 *
 * Con esto se paga una sola. El retardo es corto a propósito: más de ~250 ms
 * se siente como que el sistema no responde, que es justo lo que se quiere
 * evitar.
 */
function usarQuieto(valor, ms = 220) {
  const [quieto, setQuieto] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setQuieto(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return quieto;
}

export function VistaCotizador() {
  const [params, setParams] = useSearchParams();
  const materiales = usarEstado((s) => s.materiales);
  const config = usarEstado((s) => s.config);
  const clientes = usarEstado((s) => s.clientes);
  const ctx = usarEstado((s) => s.ctx);
  const recargarClientes = usarEstado((s) => s.recargarClientes);

  const [doc, setDoc] = useState(docVacio);
  const [sel, setSel] = useState(0);
  const [cargando, setCargando] = useState(false);

  /* ---------------- Carga inicial ---------------- */
  const id = params.get('id');
  const idCliente = params.get('cliente');

  /**
   * ⚠️ Este efecto CREA el presupuesto desde cero, así que sólo puede correr
   * cuando cambia el presupuesto que se está mirando — nunca porque se
   * recargaron los materiales.
   *
   * Tenía a `materiales` en las dependencias: al guardar un precio desde la
   * vista de Materiales, el estado global se recargaba, el array cambiaba de
   * referencia y esto borraba el presupuesto que estabas armando y lo dejaba
   * con la pieza por defecto. Se perdía el trabajo sin ningún aviso.
   *
   * `arrancado` recuerda para qué presupuesto ya se inicializó.
   */
  const arrancado = useRef(null);

  useEffect(() => {
    const clave = id || 'nuevo';
    if (arrancado.current === clave) return undefined;
    if (!materiales.length) return undefined;
    arrancado.current = clave;

    let vivo = true;
    async function arrancar() {
      if (id) {
        setCargando(true);
        try {
          const guardado = await api.get('presupuestos/' + id);
          if (vivo) setDoc({ ...docVacio(), ...guardado });
        } catch {
          toast.error('No se encontró el presupuesto');
          if (vivo) setDoc({ ...docVacio(), items: [itemNuevo(materiales)] });
        } finally {
          if (vivo) setCargando(false);
        }
      } else {
        // El diseñador de plegado deja acá la pieza que se acaba de armar.
        // Sin esto, "Cotizar esta pieza" abría el cotizador con la plantilla
        // por defecto y el perfil diseñado se perdía.
        const delPlegado = tomarItemPendiente();
        if (delPlegado) {
          setDoc({ ...docVacio(), items: [delPlegado] });
          toast.success('Perfil plegado cargado en el presupuesto');
        } else {
          // Lo que quedó a medio hacer la última vez tiene prioridad sobre
          // empezar de cero: si estaba ahí, es porque nadie lo cerró a mano.
          const borrador = leerBorrador();
          if (borrador) {
            setDoc({ ...docVacio(), ...borrador });
            toast.info('Se recuperó el presupuesto que estabas armando', {
              duration: 6000,
              action: {
                label: 'Empezar de cero',
                onClick: () => {
                  olvidarBorrador();
                  setDoc({ ...docVacio(), items: [itemNuevo(materiales)] });
                },
              },
            });
          } else {
            setDoc({ ...docVacio(), items: [itemNuevo(materiales)] });
          }
        }
      }
      if (vivo) setSel(0);
    }
    arrancar();
    return () => {
      vivo = false;
    };
  }, [id, materiales]);

  /* Autoguardado del borrador. Con retardo porque `doc` cambia en cada tecla
     y serializar un DXF grande en cada una se nota al escribir. */
  useEffect(() => {
    if (!arrancado.current) return undefined;
    const t = setTimeout(() => guardarBorrador(doc), 800);
    return () => clearTimeout(t);
  }, [doc]);

  /* Vino de "cotizar para este cliente" en la lista de Clientes.
   *
   * Va en un efecto propio y no dentro del armado del presupuesto porque ese
   * armado tiene varios caminos —presupuesto guardado, pieza que viene de
   * Plegado, borrador a medio hacer— y meterle el cliente a cada uno sería
   * repetir lo mismo tres veces y olvidarse en el cuarto.
   *
   * Sólo completa si todavía no hay cliente: si el presupuesto ya traía uno,
   * el de la URL no lo pisa. */
  useEffect(() => {
    if (!idCliente || !clientes.length) return;
    setDoc((d) => {
      if (d.clienteId || d.cliente?.nombre) return d;
      const c = clientes.find((x) => x.id === idCliente);
      if (!c) return d;
      return {
        ...d,
        clienteId: c.id,
        cliente: {
          nombre: c.nombre || '', cuit: c.cuit || '', telefono: c.telefono || '',
          email: c.email || '', direccion: c.direccion || '',
        },
      };
    });
  }, [idCliente, clientes]);

  /* ---------------- Cálculo derivado ----------------
     `useDeferredValue` deja que la tecla se pinte antes de recotizar. Sin
     esto, escribir una cota en una pieza con muchos agujeros se siente
     pegajoso: el simulador de corte recorre la geometría entera. */
  const docQuieto = usarQuieto(doc);
  const docDiferido = useDeferredValue(docQuieto);
  const calculando = doc !== docDiferido;

  const { resueltos, coti } = useMemo(() => {
    if (!materiales.length || !docDiferido.items?.length) return { resueltos: [], coti: null };
    const resueltos = docDiferido.items.map((it) => {
      const g = geometria(it, materiales);
      return { ...it, shape: g.shape, _meta: g.meta, _avisos: g.avisos };
    });
    let coti = null;
    try {
      coti = cotizarPresupuesto(
        { items: resueltos.filter((i) => i.shape), descuentoGlobal: docDiferido.descuentoGlobal },
        ctx()
      );
    } catch (e) {
      // Un error de cotización se muestra: tragarlo dejaría el precio anterior
      // en pantalla como si siguiera valiendo.
      toast.error('No se pudo cotizar: ' + e.message);
    }
    return { resueltos, coti };
  }, [docDiferido, materiales, ctx]);

  /* ---------------- ¿Sigue en pie este precio? ----------------
     Sólo tiene sentido en un presupuesto YA guardado: se compara el costo con
     el que se cotizó contra el de hoy. Con la inflación argentina, honrar uno
     de tres semanas puede ser vender por debajo del costo, y hasta ahora nada
     lo avisaba: `validezDias` se imprimía en el PDF y nadie la miraba. */
  const vigencia = useMemo(() => {
    if (!doc.id || !doc.resumen?.costo || !coti?.resumen?.costo) return null;
    const v = evaluarVigencia({
      presupuesto: doc,
      costoHoy: coti.resumen.costo,
      config,
    });
    if (!v) return null;
    /* Se comparan los items GUARDADOS contra el catálogo de hoy. Usar la
       cotización recién hecha compararía el precio actual contra sí mismo y
       no mostraría nunca ninguna variación. */
    const guardados = (doc.items || [])
      .filter((it) => it._precioKgMaterial > 0)
      .map((it) => ({
        material: {
          id: it.materialId,
          nombre: materiales.find((m) => m.id === it.materialId)?.nombre || it.materialId,
          precioKg: it._precioKgMaterial,
        },
      }));
    return { ...v, materiales: materialesQueSeMovieron(guardados, materiales) };
  }, [doc, coti, config, materiales]);

  /* ---------------- Mutadores ---------------- */
  const actualizarDoc = useCallback((cambios) => {
    setDoc((d) => ({ ...d, ...(typeof cambios === 'function' ? cambios(d) : cambios) }));
  }, []);

  const actualizarItem = useCallback((i, cambios) => {
    setDoc((d) => {
      const items = d.items.slice();
      items[i] = { ...items[i], ...(typeof cambios === 'function' ? cambios(items[i]) : cambios) };
      return { ...d, items };
    });
  }, []);

  const agregarItem = useCallback((item) => {
    setDoc((d) => {
      const items = [...d.items, item];
      setSel(items.length - 1);
      return { ...d, items };
    });
  }, []);

  const quitarItem = useCallback((i) => {
    setDoc((d) => {
      const items = d.items.filter((_, k) => k !== i);
      setSel((s) => Math.max(0, Math.min(s, items.length - 1)));
      return { ...d, items };
    });
  }, []);

  const duplicarItem = useCallback(() => {
    setDoc((d) => {
      const it = d.items[sel];
      if (!it) return d;
      const copia = structuredClone({ ...it, nombre: it.nombre + ' (copia)' });
      const items = [...d.items.slice(0, sel + 1), copia, ...d.items.slice(sel + 1)];
      setSel(sel + 1);
      return { ...d, items };
    });
  }, [sel]);

  const nuevoPresupuesto = useCallback(() => {
    // Pedir uno nuevo es decir explícitamente "esto ya no me sirve": es el
    // único momento en que se descarta el borrador sin haberlo guardado.
    olvidarBorrador();
    setDoc({ ...docVacio(), items: [itemNuevo(materiales)] });
    setSel(0);
    if (id) setParams({}, { replace: true });
  }, [materiales, id, setParams]);

  /* ---------------- Guardado ---------------- */
  const guardar = useCallback(async () => {
    if (!coti) return toast.error('No hay nada para guardar');

    // Mientras se escribe usamos calidad equilibrada para responder en cada
    // tecla. Guardar es el punto deliberado donde sí vale esperar: se compite
    // con más órdenes, pesos y giros de 7,5° y esa fotografía queda congelada
    // en la OT. Precio y nesting se guardan juntos desde el mismo resultado.
    const contexto = ctx();
    const definitiva = cotizarPresupuesto(
      { items: resueltos.filter((i) => i.shape), descuentoGlobal: doc.descuentoGlobal },
      { ...contexto, config: { ...contexto.config, produccion: { ...contexto.config?.produccion, nestingCalidad: 'maxima' } } }
    );

    // Se guardan además, desnormalizados, los valores que la base indexa para
    // poder consultarlos por SQL (facturación por material, kg consumidos…).
    const cuerpo = {
      ...doc,
      resumen: definitiva.resumen,
      requerimientosChapa: requerimientosDeCotizacion(definitiva),
      // Es una fotografía del programa vendido. Producción no debe recalcular
      // el nesting con precios, chapas o algoritmos que cambien más adelante.
      planProduccion: crearPlanProduccion(definitiva, doc.items),
      items: doc.items.map((it, i) => {
        const r = definitiva.items[i];
        return {
          ...it,
          /* Se guarda la geometría SALVO que se pueda reconstruir.
             Estaba al revés —"guardala sólo si es DXF"— y eso deja sin
             geometría a todo origen que no sea `libreria` ni `dxf`: la pieza
             se guarda, se reabre vacía y no hay forma de recuperarla. La
             regla correcta es la inversa, porque el caso reconstruible es uno
             solo y conocido. */
          shape: it.origen === 'libreria' ? undefined : it.shape,
          gas: r?.corte?.gasTipo ?? it.gas ?? null,
          _pesoTotal: r?.geometria?.pesoTotal ?? 0,
          _largoCorte: r?.geometria?.largoCorteMM ?? 0,
          _precioNeto: r?.precio?.neto ?? 0,
          _costoTotal: r?.costos?.total ?? 0,
          // El $/kg con el que se cotizó. Sin esto, al reabrir el presupuesto
          // se puede saber que el costo cambió pero no CUÁL material se movió,
          // y quien cotiza tiene que salir a buscarlo a mano.
          _precioKgMaterial: r?.material?.precioKg ?? null,
        };
      }),
    };

    try {
      // Alta de cliente nuevo si se escribió un nombre que no está en la base
      if (doc.cliente?.nombre && !doc.clienteId) {
        const existe = clientes.find(
          (c) => c.nombre.toLowerCase() === doc.cliente.nombre.toLowerCase()
        );
        if (existe) {
          cuerpo.clienteId = existe.id;
        } else {
          const c = await api.post('clientes', { ...doc.cliente, notas: '' });
          cuerpo.clienteId = c.id;
          await recargarClientes();
        }
      }

      if (doc.id) {
        await api.put('presupuestos/' + doc.id, cuerpo);
        actualizarDoc({ clienteId: cuerpo.clienteId ?? doc.clienteId });
        toast.success('Presupuesto actualizado');
      } else {
        const nuevo = await api.post('presupuestos', cuerpo);
        actualizarDoc({ id: nuevo.id, numero: nuevo.numero, clienteId: cuerpo.clienteId ?? doc.clienteId });
        // Ya vive en la base: el borrador dejaría una copia vieja que después
        // se recupera sola y pisa el trabajo bueno.
        olvidarBorrador();
        toast.success(`Presupuesto ${nuevo.numero} guardado`);
      }
    } catch (e) {
      toast.error('No se pudo guardar: ' + e.message);
    }
  }, [doc, coti, resueltos, ctx, clientes, recargarClientes, actualizarDoc]);

  const valor = useMemo(
    () => ({
      doc, setDoc, sel, setSel, coti, resueltos, calculando, vigencia,
      actualizarDoc, actualizarItem, agregarItem, quitarItem, duplicarItem, guardar,
      item: doc.items[sel],
      resuelto: resueltos[sel],
      r: coti?.items[sel],
    }),
    [doc, sel, coti, resueltos, calculando, vigencia, actualizarDoc, actualizarItem, agregarItem, quitarItem, duplicarItem, guardar]
  );

  if (!materiales.length || cargando) {
    return <div className="panel-kort h-[70vh] animate-pulse" />;
  }

  return (
    <CtxCotizador.Provider value={valor}>
      <div className="space-y-4">
        <Cabecera onNuevo={nuevoPresupuesto} />

        {/* Un presupuesto guardado no sabe solo que quedó viejo. Con la
            inflación argentina, honrar uno de tres semanas puede ser vender
            por debajo del costo. */}
        {vigencia && vigencia.nivel !== 'ok' ? (
          <Aviso nivel={vigencia.nivel}>
            <strong>{vigencia.mensaje}</strong>
            {vigencia.dias != null ? (
              <span className="opacity-80">
                {' '}Se cotizó hace {vigencia.dias} día{vigencia.dias === 1 ? '' : 's'}.
              </span>
            ) : null}
            {vigencia.materiales?.length ? (
              <ul className="mt-1.5 space-y-0.5 opacity-90">
                {vigencia.materiales.map((m) => (
                  <li key={m.id} className="tabular">
                    · {m.nombre}: {m.pct > 0 ? '+' : ''}{m.pct.toFixed(1)} % ({m.entonces} → {m.hoy} /kg)
                  </li>
                ))}
              </ul>
            ) : null}
            {vigencia.precioParaMismoMargen ? (
              <p className="mt-1.5">
                Para conservar el margen original habría que cotizarlo en{' '}
                <strong className="tabular">
                  {money(vigencia.precioParaMismoMargen, config?.comercial?.simbolo || '$', 0)}
                </strong>{' '}
                (se prometió {money(vigencia.precioPrometido, config?.comercial?.simbolo || '$', 0)}).
              </p>
            ) : null}
          </Aviso>
        ) : null}

        {/* Con la navegación arriba y no al costado entran las tres columnas
            desde 1280 px, que es la notebook del taller. Antes hacían falta
            1536 y el precio se caía abajo del plano. */}
        <div className="grid gap-4 items-start grid-cols-1 lg:grid-cols-[276px_minmax(380px,1fr)] xl:grid-cols-[276px_minmax(430px,1fr)_344px]">
          <ListaItems />
          <div className="space-y-4 min-w-0">
            <Lienzo />
            <Parametros />
          </div>
          <div className="xl:sticky xl:top-[76px] space-y-4 min-w-0">
            <Precio />
          </div>
        </div>
      </div>
    </CtxCotizador.Provider>
  );
}

/* ------------------------------------------------------------------ */
/* Cabecera: cliente y datos del presupuesto                           */
/* ------------------------------------------------------------------ */

function Cabecera({ onNuevo }) {
  const { doc, actualizarDoc } = usarCotizador();
  const clientes = usarEstado((s) => s.clientes);
  const cli = doc.cliente || {};

  const elegirCliente = (idCliente) => {
    if (idCliente === '__nuevo__') {
      return actualizarDoc({
        clienteId: null,
        cliente: { nombre: '', cuit: '', telefono: '', email: '', direccion: '' },
      });
    }
    const c = clientes.find((x) => x.id === idCliente);
    actualizarDoc({
      clienteId: idCliente,
      cliente: c
        ? { nombre: c.nombre, cuit: c.cuit, telefono: c.telefono, email: c.email, direccion: c.direccion }
        : cli,
    });
  };

  const campo = (etiqueta, clave, tipo = 'text') => (
    <Campo etiqueta={etiqueta}>
      <Entrada
        type={tipo}
        value={cli[clave] || ''}
        onChange={(e) => actualizarDoc((d) => ({ cliente: { ...d.cliente, [clave]: e.target.value } }))}
      />
    </Campo>
  );

  return (
    <Panel>
      <PanelCab
        acciones={
          <>
            {doc.estado ? <InsigniaEstado mapa={ESTADOS_PRESUPUESTO} estado={doc.estado} /> : null}
            <Boton tam="sm" onClick={onNuevo}>
              <FilePlus2 />
              Nuevo
            </Boton>
          </>
        }
      >
        <PanelTitulo className="text-[13px] normal-case tracking-normal text-tinta">
          {doc.numero ? `Presupuesto N° ${doc.numero}` : 'Nuevo presupuesto'}
        </PanelTitulo>
      </PanelCab>

      <PanelCuerpo className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Campo etiqueta="Cliente" className="md:col-span-2 xl:col-span-1">
          <Selector
            valor={doc.clienteId || '__nuevo__'}
            alCambiar={elegirCliente}
            placeholder="Elegí un cliente"
          >
            <Opcion valor="__nuevo__">Cliente nuevo / consumidor final</Opcion>
            {clientes.map((c) => (
              <Opcion key={c.id} valor={c.id} detalle={c.cuit || undefined}>
                {c.nombre}
              </Opcion>
            ))}
          </Selector>
        </Campo>

        {campo('Nombre / Razón social', 'nombre')}
        {campo('CUIT', 'cuit')}
        {campo('Teléfono', 'telefono')}
        {campo('Email', 'email', 'email')}

        <Campo etiqueta="Entrega (días hábiles)">
          <Entrada
            type="number" min={0} value={doc.entregaDias}
            onChange={(e) => actualizarDoc({ entregaDias: +e.target.value })}
          />
        </Campo>

        <Campo etiqueta="Condición de pago" className="md:col-span-2">
          <Entrada
            value={doc.condicionPago}
            onChange={(e) => actualizarDoc({ condicionPago: e.target.value })}
          />
        </Campo>
      </PanelCuerpo>
    </Panel>
  );
}
