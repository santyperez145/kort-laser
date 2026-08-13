/**
 * Columna de precio: desglose del ítem, ficha técnica y total del presupuesto.
 *
 * El desglose se muestra entero a propósito. Es lo que permite defender un
 * número frente al cliente ("el gas de este inoxidable son X") y lo que hace
 * evidente cuando un costo se disparó por un parámetro mal cargado.
 */

import { useMemo, useState } from 'react';
import { Save, FileText, ClipboardList, Download, Grid3x3, Loader2, Calculator, ShoppingCart } from 'lucide-react';
import { cotizarItem } from '@core/pricing.js';
import { explicarItem } from '@core/explicacion.js';
import { listaDeCompra, pedidoEnTexto } from '@core/compras.js';

import { usarCotizador } from './contexto';
import { descargarDXFItem, descargarDXFNesting, exportarPDF, exportarOT } from './acciones';
import { ComoSeCalcula } from '@/componentes/PorQue';
import { Panel, PanelCab, PanelTitulo, PanelCuerpo, Vacio } from '@/componentes/ui/panel';
import { Boton } from '@/componentes/ui/boton';
import { Campo, Entrada, AreaTexto } from '@/componentes/ui/campos';
import { Barra, Aviso } from '@/componentes/ui/varios';
import { usarEstado } from '@/lib/estado';
import { money, num, pct } from '@/lib/formato';
import { cn } from '@/lib/utils';
import { fmtTiempo } from '@core/cutting.js';

function Fila({ etiqueta, valor, clase }) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-3 border-b border-dashed border-borde py-1.5 last:border-0',
        clase
      )}
    >
      <span className="text-suave min-w-0">{etiqueta}</span>
      <span className="tabular font-mono whitespace-nowrap">{valor}</span>
    </div>
  );
}

function Dato({ etiqueta, valor }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-[12.5px]">
      <dt className="text-suave">{etiqueta}</dt>
      <dd className="tabular font-semibold text-right">{valor}</dd>
    </div>
  );
}

export function Precio() {
  const { doc, item, resuelto, resueltos, coti, r, calculando, actualizarDoc, guardar } = usarCotizador();
  const config = usarEstado((s) => s.config);
  const ctx = usarEstado((s) => s.ctx);
  const sim = usarEstado((s) => s.simbolo());
  const res = coti?.resumen;

  /**
   * Cuando la puesta a punto se come el precio, el dato accionable no es el
   * porcentaje sino cuánto bajaría el unitario cortando más. Se calcula sólo
   * en ese caso: es una cotización extra y no vale la pena hacerla siempre.
   */
  const escala = useMemo(() => {
    if (!r || !resuelto?.shape) return null;
    if ((r.costos.preparacionPct || 0) < 0.4) return null;
    const cantidad = Math.max(1, Math.round(item?.cantidad || 1));
    const propuesta = cantidad < 10 ? 10 : cantidad * 5;
    try {
      const conMas = cotizarItem({ ...resuelto, cantidad: propuesta }, ctx());
      if (conMas.error || !(conMas.precio.unitario < r.precio.unitario)) return null;
      return { cantidad: propuesta, unitario: conMas.precio.unitario };
    } catch {
      return null;
    }
  }, [r, resuelto, item?.cantidad, ctx]);

  /* La derivación completa del precio. Se arma sola a partir del resultado ya
     cotizado — no recalcula nada — así que no cuesta tenerla lista aunque el
     panel esté cerrado. */
  const [verCuenta, setVerCuenta] = useState(false);
  const explicacion = useMemo(() => (r ? explicarItem(r, { config }) : null), [r, config]);

  const args = { doc, coti, config, resueltos, actualizarDoc, ctx };

  return (
    <>
      {/* ---------------- Desglose del ítem ---------------- */}
      <Panel>
        <PanelCab
          acciones={
            <span className="flex items-center gap-1.5 font-mono text-[11px] text-suave tabular">
              {calculando ? <Loader2 className="size-3 animate-spin" /> : null}
              {r ? `${money(r.precio.unitario, sim, 2)} c/u` : null}
            </span>
          }
        >
          <PanelTitulo>Precio del ítem</PanelTitulo>
        </PanelCab>

        <PanelCuerpo>
          {r ? (
            <div className="text-[12.5px]">
              <Fila etiqueta={`Material · ${r.costos.modoMaterial}`} valor={money(r.costos.material, sim, 0)} />
              <Fila
                etiqueta={`Corte láser · ${fmtTiempo(r.corte.tProduccion)}`}
                valor={money(r.costos.corte, sim, 0)}
              />
              {r.costos.tPreparacion > 0 && (
                <Fila
                  etiqueta={`Puesta a punto y carga · ${fmtTiempo(r.costos.tPreparacion)}`}
                  valor={money(r.costos.preparacion, sim, 0)}
                />
              )}
              <Fila
                etiqueta={`${r.corte.gasNombre} · ${num(r.costos.gasM3, 2)} m³`}
                valor={money(r.costos.gas, sim, 0)}
              />
              {r.costos.plegado > 0 && (
                <Fila etiqueta={`Plegado · ${fmtTiempo(r.plegado.tTotal)}`} valor={money(r.costos.plegado, sim, 0)} />
              )}
              {r.costos.acabado > 0 && (
                <Fila etiqueta={r.costos.detalleAcabado.nombre} valor={money(r.costos.acabado, sim, 0)} />
              )}
              {r.costos.procesos > 0 && (
                <Fila etiqueta="Procesos extra" valor={money(r.costos.procesos, sim, 0)} />
              )}
              {r.costos.ingenieria > 0 && (
                <Fila etiqueta="Ingeniería" valor={money(r.costos.ingenieria, sim, 0)} />
              )}

              <Fila etiqueta="COSTO" valor={money(r.costos.total, sim, 0)} clase="font-semibold" />
              <Fila
                etiqueta={`Margen ${num(r.precio.margen, 0)} %`}
                valor={money(r.precio.lista - r.costos.total, sim, 0)}
              />
              {r.precio.descuentoPct > 0 && (
                <Fila
                  etiqueta={`Descuento por cantidad ${num(r.precio.descuentoPct, 0)} %`}
                  valor={'−' + money((r.precio.lista * r.precio.descuentoPct) / 100, sim, 0)}
                />
              )}
              {r.precio.recargoPct > 0 && (
                <Fila
                  etiqueta={`Recargo por urgencia ${num(r.precio.recargoPct, 0)} %`}
                  valor={money(
                    r.precio.neto - r.precio.lista * (1 - r.precio.descuentoPct / 100),
                    sim,
                    0
                  )}
                />
              )}
              {r.precio.iibb > 0 && (
                <Fila etiqueta={`Ingresos brutos ${num(r.precio.iibbPct, 1)} %`} valor={money(r.precio.iibb, sim, 0)} />
              )}
              {r.precio.aplicoMinimo && <Fila etiqueta="Mínimo por ítem aplicado" valor="" />}

              <div className="mt-2 flex items-baseline justify-between gap-3 border-t-2 border-tinta pt-2.5 text-[15px] font-bold">
                <span>Subtotal del ítem</span>
                <span className="tabular font-mono">{money(r.precio.neto, sim, 0)}</span>
              </div>

              {/* El caso del trabajo de una sola pieza: el corte son segundos y
                  el precio es puesta a punto. Decirlo con el número al lado es
                  lo que permite ofrecerle al cliente cortar más de una. */}
              {(r.costos.preparacionPct || 0) >= 0.4 && (
                <Aviso nivel="info" className="mt-3">
                  <strong>
                    {pct(r.costos.preparacionPct * 100, 0)} de este ítem es puesta a punto.
                  </strong>{' '}
                  Cortar la pieza son {fmtTiempo(r.corte.tPieza)}; programar la máquina y cargar la
                  chapa, {fmtTiempo(r.costos.tPreparacion)}.
                  {escala ? (
                    <>
                      {' '}
                      Con <strong>{escala.cantidad} unidades</strong> el unitario baja de{' '}
                      {money(r.precio.unitario, sim, 0)} a{' '}
                      <strong>{money(escala.unitario, sim, 0)}</strong>.
                    </>
                  ) : null}
                </Aviso>
              )}

              {/* La cuenta abierta. Es lo que permite defender el número en el
                  mostrador y, sobre todo, encontrar el dato mal cargado
                  cuando el precio sale raro. */}
              <Boton
                tono="fantasma"
                tam="sm"
                className="mt-3 w-full"
                onClick={() => setVerCuenta((v) => !v)}
                aria-expanded={verCuenta}
              >
                <Calculator className="size-3.5" />
                {verCuenta ? 'Ocultar la cuenta' : '¿De dónde sale este precio?'}
              </Boton>
              {verCuenta && explicacion ? (
                <ComoSeCalcula explicacion={explicacion} className="mt-2.5" />
              ) : null}
            </div>
          ) : (
            <Vacio titulo="Sin cálculo" />
          )}
        </PanelCuerpo>
      </Panel>

      {/* ---------------- Ficha técnica ---------------- */}
      {r ? (
        <Panel>
          <PanelCab>
            <PanelTitulo>Ficha técnica</PanelTitulo>
          </PanelCab>
          <PanelCuerpo>
            <dl>
              <Dato etiqueta="Peso unitario" valor={num(r.geometria.pesoPieza, 3) + ' kg'} />
              <Dato etiqueta="Peso total" valor={num(r.geometria.pesoTotal, 2) + ' kg'} />
              <Dato etiqueta="Largo de corte / pieza" valor={num(r.geometria.largoCorteMM / 1000, 2) + ' m'} />
              <Dato etiqueta="Perforaciones" valor={String(r.geometria.piercings)} />
              <Dato etiqueta="Gas de asistencia" valor={`${r.corte.gasNombre} · ${num(r.corte.gasPresion, 0)} bar`} />
              <Dato etiqueta="Boquilla" valor={num(r.corte.boquilla, 1) + ' mm'} />
              <Dato
                etiqueta="Consumo de gas"
                valor={`${num(r.corte.gasCaudal, 0)} m³/h · ${num(r.costos.gasM3, 2)} m³`}
              />
              <Dato etiqueta="Velocidad nominal" valor={num(r.corte.vNominal, 0) + ' mm/min'} />
              <Dato etiqueta="Velocidad media real" valor={num(r.corte.vMediaEfectiva, 0) + ' mm/min'} />
              <Dato etiqueta="Pérdida por geometría" valor={pct(r.corte.penalizacion * 100, 0)} />
              <Dato etiqueta="Tiempo por pieza" valor={fmtTiempo(r.corte.tPieza)} />
              <Dato etiqueta="Producción del lote" valor={fmtTiempo(r.corte.tProduccion)} />
              <Dato etiqueta="Puesta a punto y carga" valor={fmtTiempo(r.costos.tPreparacion)} />
              <Dato etiqueta="Máquina ocupada (total)" valor={fmtTiempo(r.corte.tTotal)} />
              <Dato
                etiqueta="Chapas necesarias"
                valor={
                  r.nesting.compartido
                    ? `${num(r.nesting.chapas, 2)} de ${r.nesting.chapasGrupo}`
                    : String(r.nesting.chapas ?? '—')
                }
              />
              <Dato etiqueta="Aprovechamiento" valor={pct((r.nesting.aprovechamiento || 0) * 100, 1)} />
            </dl>

            <Barra
              className="mt-2"
              valor={(r.nesting.aprovechamiento || 0) * 100}
              tono={(r.nesting.aprovechamiento || 0) > 0.7 ? 'verde' : 'corte'}
            />

            {/* Sin esta línea el "0,49 de 1" de arriba no se entiende. */}
            {r.nesting.compartido ? (
              <p className="mt-2 text-[11px] leading-relaxed text-tenue">
                Comparte chapa con {r.nesting.itemsEnGrupo - 1} ítem
                {r.nesting.itemsEnGrupo - 1 === 1 ? '' : 's'} del mismo material, espesor y gas:
                se cortan juntos en un solo programa. El material y la puesta a punto se reparten
                por el área que ocupa cada uno.
              </p>
            ) : null}

            <dl className="mt-2 border-t border-borde pt-1">
              <Dato etiqueta="Costo hora láser" valor={money(r.costos.costoHoraLaser, sim, 0) + '/h'} />
            </dl>
          </PanelCuerpo>
        </Panel>
      ) : null}

      {/* ---------------- Total ---------------- */}
      {res ? (
        <Panel>
          <PanelCab>
            <PanelTitulo>Total</PanelTitulo>
          </PanelCab>
          <PanelCuerpo>
            <div className="text-[12.5px]">
              <Fila etiqueta="Subtotal" valor={money(res.subtotal, sim, 2)} />
              {config.comercial.mostrarIVA && (
                <Fila etiqueta={`IVA ${num(res.ivaPct, 0)} %`} valor={money(res.iva, sim, 2)} />
              )}
            </div>

            {res.aplicoMinimo && (
              <Aviso nivel="aviso" className="mt-3">
                Se aplicó el mínimo de facturación de{' '}
                {money(config.comercial.minimoFacturacion, sim, 0)}. La suma de los ítems daba
                menos. Ajustalo en Configuración si no corresponde.
              </Aviso>
            )}

            <div className="mt-3">
              <div className="text-[10px] font-bold uppercase tracking-wider text-tenue">
                Total del presupuesto
              </div>
              <div className="text-[32px] font-extrabold leading-none tracking-tight tabular">
                {money(res.total, sim, 2)}
              </div>
              {res.totalUSD ? (
                <div className="mt-1 text-[13px] text-suave tabular">≈ US$ {num(res.totalUSD, 2)}</div>
              ) : null}
            </div>

            <p className="mt-2 text-[11.5px] text-suave tabular">
              {res.piezasTotales} pieza{res.piezasTotales === 1 ? '' : 's'} · {num(res.pesoTotal, 1)} kg ·{' '}
              {res.chapasTotal} chapa{res.chapasTotal === 1 ? '' : 's'} ·{' '}
              {fmtTiempo(res.tiempoProduccion)} de máquina
            </p>

            <p className="mt-1.5 text-[12px]">
              <span className="text-suave">Utilidad estimada: </span>
              <span className="font-bold text-chapa-500 dark:text-chapa-300 tabular">
                {money(res.utilidad, sim, 0)} ({pct(res.utilidadPct, 1)})
              </span>
            </p>

            <Campo etiqueta="Descuento global" className="mt-4">
              <Entrada
                type="number" min={0} max={90} step={1} unidad="%"
                value={doc.descuentoGlobal || 0}
                onChange={(e) => actualizarDoc({ descuentoGlobal: +e.target.value || 0 })}
              />
            </Campo>
          </PanelCuerpo>
        </Panel>
      ) : null}

      {/* ---------------- Qué hay que comprar ---------------- */}
      <ListaDeCompra coti={coti} ctx={ctx} sim={sim} />

      {/* ---------------- Acciones ---------------- */}
      <Panel>
        <PanelCab>
          <PanelTitulo>Acciones</PanelTitulo>
        </PanelCab>
        <PanelCuerpo className="space-y-2">
          <Boton tono="acero" ancho="completo" onClick={guardar}>
            <Save />
            Guardar presupuesto
          </Boton>
          <Boton tono="corte" ancho="completo" onClick={() => exportarPDF(args)}>
            <FileText />
            Generar PDF del presupuesto
          </Boton>
          <Boton ancho="completo" onClick={() => exportarOT(args)}>
            <ClipboardList />
            Orden de trabajo (taller)
          </Boton>
          <div className="grid grid-cols-2 gap-2">
            <Boton onClick={() => descargarDXFItem(item, resuelto)}>
              <Download />
              DXF pieza
            </Boton>
            <Boton onClick={() => descargarDXFNesting(item, resuelto, r)}>
              <Grid3x3 />
              DXF nesting
            </Boton>
          </div>

          <Campo etiqueta="Observaciones para el presupuesto" className="pt-2">
            <AreaTexto
              rows={3} value={doc.notas}
              onChange={(e) => actualizarDoc({ notas: e.target.value })}
            />
          </Campo>
        </PanelCuerpo>
      </Panel>
    </>
  );
}

/**
 * Qué chapa hay que comprar para hacer este presupuesto.
 *
 * El salto de "el cliente aprobó" a "voy a comprar" se hacía a mano con una
 * calculadora. Comprar de menos para la máquina a mitad de trabajo; comprar de
 * más deja el capital en el depósito. Los dos números salen de lo que el
 * sistema ya calculó.
 */
function ListaDeCompra({ coti, ctx, sim }) {
  const [copiado, setCopiado] = useState(false);
  const lista = useMemo(() => {
    if (!coti?.items?.length) return null;
    try {
      return listaDeCompra(coti, ctx());
    } catch {
      return null;
    }
  }, [coti, ctx]);

  if (!lista || !lista.lineas.length) return null;

  const copiarPedido = async () => {
    try {
      await navigator.clipboard.writeText(pedidoEnTexto(lista));
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      /* sin portapapeles (http sin TLS): el texto igual se ve en pantalla */
    }
  };

  return (
    <Panel>
      <PanelCab
        acciones={
          <span className="font-mono text-[11px] text-suave tabular">{num(lista.pesoTotal, 0)} kg</span>
        }
      >
        <PanelTitulo>Material a comprar</PanelTitulo>
      </PanelCab>
      <PanelCuerpo>
        <div className="text-[12.5px]">
          {lista.lineas.map((l) => (
            <div key={l.clave} className="border-b border-dashed border-borde py-1.5 last:border-0">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0">
                  <strong className="tabular">{l.chapas}</strong> × {l.chapa.w}×{l.chapa.h} ·{' '}
                  {num(l.espesor, 1)} mm
                </span>
                <span className="tabular font-mono whitespace-nowrap">{money(l.costoTotal, sim, 0)}</span>
              </div>
              <div className="text-[11px] text-suave">
                {l.material} · {num(l.pesoTotal, 1)} kg
                {l.desdeRetazo
                  ? ' · alcanza con un retazo'
                  : ` · se entrega el ${pct(l.aprovechamiento * 100, 0)}` +
                    (l.retazoM2 > 0.2 ? ` · queda retazo de ${num(l.retazoM2, 2)} m²` : '')}
              </div>
            </div>
          ))}
          <div className="mt-2 flex items-baseline justify-between gap-3 border-t-2 border-tinta pt-2 font-bold">
            <span>Chapa entera</span>
            <span className="tabular font-mono">{money(lista.total, sim, 0)}</span>
          </div>
          <div className="flex items-baseline justify-between gap-3 text-[11.5px] text-suave">
            <span>De eso, lo que consume este trabajo</span>
            <span className="tabular font-mono">{money(lista.consumido, sim, 0)}</span>
          </div>
        </div>

        {/* Este es el número que decide si el anticipo alcanza para comprar la
            chapa. Se mide contra lo CONSUMIDO: una pieza suelta que sale de un
            retazo no obliga a comprar la chapa entera, y medirlo contra ella
            daría un porcentaje absurdo que nadie miraría dos veces. */}
        {lista.sobreVenta != null ? (
          <p className="mt-2 text-[11.5px] text-suave">
            El material es el{' '}
            <strong className={lista.sobreVenta > 0.5 ? 'text-corte-600 dark:text-corte-300' : ''}>
              {pct(lista.sobreVenta * 100, 0)}
            </strong>{' '}
            de lo que se factura.
            {lista.sobreVenta > 0.5
              ? ' Con un anticipo del 50 % no alcanza para comprar el material: pedí más anticipo o comprá contra entrega.'
              : null}
          </p>
        ) : null}

        {lista.avisos.map((a, i) => (
          <Aviso key={i} nivel={a.nivel} className="mt-2">
            {a.msg}
          </Aviso>
        ))}

        <Boton tono="fantasma" tam="sm" className="mt-3 w-full" onClick={copiarPedido}>
          <ShoppingCart className="size-3.5" />
          {copiado ? 'Copiado' : 'Copiar el pedido para el proveedor'}
        </Boton>
      </PanelCuerpo>
    </Panel>
  );
}
