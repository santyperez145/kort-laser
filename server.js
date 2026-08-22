/**
 * KORT - Servidor
 *
 * Express + Helmet + Zod. Sirve el bundle de React (`web-dist/`), expone la
 * API REST de datos y guarda los archivos generados (PDF, DXF) en `salidas/`,
 * ordenados por presupuesto, para que el taller los encuentre sin abrir el
 * sistema.
 *
 * Arranque:  npm start        (compila el front si hace falta y levanta)
 *            node server.js   (levanta con lo que ya esté compilado)
 *            o doble clic en INICIAR.bat
 *
 * Nota de diseño: el cálculo NO pasa por acá. `src/core/` corre en el
 * navegador para que el cotizador responda mientras se escribe; el servidor
 * sólo persiste, sirve y valida la forma de lo que entra.
 */

import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import { z } from 'zod';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DB, fusionarProfundo, nuevoId } from './src/server/db.js';
import {
  asignacionesRetazoDeItems,
  consumirRetazos,
  liberarRetazos,
  normalizarRetazo,
  reservarRetazos,
} from './src/core/retazos.js';
import { normalizarMuestra, resumirTelemetria, serieTelemetria } from './src/core/telemetria.js';
import { aplicarEventoTaller } from './src/core/produccion.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUERTO = Number(process.env.PORT) || 4321;
const RAIZ = __dirname;
const EN_VERCEL = process.env.VERCEL === '1';
const DIR_DATOS = EN_VERCEL ? path.join('/tmp', 'kort-data') : (process.env.KORT_DATA_DIR || path.join(RAIZ, 'data'));
const DIR_SALIDAS = EN_VERCEL ? path.join('/tmp', 'kort-salidas') : (process.env.KORT_SALIDAS_DIR || path.join(RAIZ, 'salidas'));
const DIR_WEB = path.join(RAIZ, 'web-dist');

const db = new DB(DIR_DATOS);
db.limpiarTelemetria(new Date(Date.now() - 180 * 86400000).toISOString());
fs.mkdirSync(DIR_SALIDAS, { recursive: true });

const hayBundle = fs.existsSync(path.join(DIR_WEB, 'index.html'));

/* ------------------------------------------------------------------ */
/* Esquemas                                                            */
/*                                                                     */
/* Los documentos del taller (materiales, config, presupuestos) son     */
/* JSON libre a propósito: el motor de cálculo evoluciona más rápido    */
/* que cualquier esquema que escribamos acá, y una validación estricta  */
/* rompería presupuestos guardados con una versión anterior. Lo que sí  */
/* se valida es todo lo que toca el disco o construye una ruta.         */
/* ------------------------------------------------------------------ */

const COLECCIONES = ['clientes', 'presupuestos', 'ordenes', 'piezas'];
const DOCUMENTOS = ['config', 'materiales', 'maquinas', 'retazos'];

const esquemaArchivo = z.object({
  nombre: z.string().min(1).max(180).default('archivo.bin'),
  carpeta: z.string().max(120).default(''),
  base64: z.string().optional(),
  texto: z.string().optional(),
});

const esquemaRestaurar = z.object({
  tabla: z.enum(['materiales', 'maquinas', 'config']),
});

const esquemaRespaldo = z.record(z.string(), z.unknown());

const esquemaAprobar = z.object({
  presupuestoId: z.string().min(1),
});

const esquemaTelemetria = z.object({
  maquinaId: z.string().min(1).max(80).optional(),
  fecha: z.string().datetime().optional(),
  estado: z.enum(['apagada', 'inactiva', 'preparando', 'produciendo', 'pausada', 'alarma']),
  modo: z.string().max(60).optional(),
  programa: z.string().max(180).optional(),
  ordenId: z.string().max(80).optional(),
  progreso: z.coerce.number().min(0).max(100).optional(),
  potenciaPct: z.coerce.number().min(0).max(100).optional(),
  velocidadMMMin: z.coerce.number().min(0).max(200000).optional(),
  gas: z.string().max(16).optional(),
  alarma: z.string().max(500).optional(),
  piezasBuenas: z.coerce.number().int().nonnegative().optional(),
  piezasRechazadas: z.coerce.number().int().nonnegative().optional(),
  fuente: z.string().max(60).optional(),
});

const esquemaEntero = (def, max) =>
  z.coerce.number().int().positive().max(max).catch(def).default(def);

/** Convierte un fallo de Zod en un 400 legible en vez de un 500 opaco. */
function validar(esquema, valor) {
  const r = esquema.safeParse(valor);
  if (!r.success) {
    const detalle = r.error.issues.map((i) => `${i.path.join('.') || 'cuerpo'}: ${i.message}`).join('; ');
    const e = new Error('Datos inválidos — ' + detalle);
    e.status = 400;
    throw e;
  }
  return r.data;
}

/**
 * Nombre de archivo seguro. Se hace en dos pasos porque `..` sobrevive a un
 * reemplazo de caracteres: primero se sacan los separadores y los puntos
 * dobles, después se filtra el resto.
 */
function nombreSeguro(s) {
  return String(s)
    .replace(/[\\/]+/g, '_')
    .replace(/\.{2,}/g, '_')
    .replace(/[^\w.\-áéíóúñÁÉÍÓÚÑ ]/g, '_')
    .slice(0, 180);
}

function operarioSeguro(s) {
  const limpio = String(s || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  return limpio || null;
}

/* ------------------------------------------------------------------ */
/* Aplicación                                                          */
/* ------------------------------------------------------------------ */

const app = express();
app.disable('x-powered-by');

/**
 * CSP sin `unsafe-inline` para scripts.
 *
 * No hay ningún script inline en la aplicación: el arranque del tema vive en
 * `/tema.js`, servido desde acá. Se intentó primero autorizarlo por hash y no
 * vale la pena — un hash mal calculado deja la página muda, y para saber por
 * qué hay que leer la consola.
 *
 * `style-src` sí necesita 'unsafe-inline': Radix, Recharts y Konva escriben
 * estilos en el elemento, y para eso no existe el equivalente del hash.
 */
const directivasBase = {
  defaultSrc: ["'self'"],
  styleSrc: ["'self'", "'unsafe-inline'"],
  // Los visores 2D y las miniaturas del PDF salen de canvas como data:
  imgSrc: ["'self'", 'data:', 'blob:'],
  fontSrc: ["'self'", 'data:'],
  workerSrc: ["'self'", 'blob:'],
  objectSrc: ["'none'"],
  // Sin CDN: nada sale de esta máquina. El taller puede estar sin internet.
  connectSrc: ["'self'"],
  upgradeInsecureRequests: null,
};

const cspEstricta = helmet.contentSecurityPolicy({
  useDefaults: true,
  directives: { ...directivasBase, scriptSrc: ["'self'"] },
});

/**
 * La interfaz anterior necesita `unsafe-inline` para su `<script
 * type="importmap">`, que resuelve el especificador desnudo "three" de
 * OrbitControls. Un import map externo no lo soportan todos los navegadores,
 * así que no hay forma de sacarlo del HTML.
 *
 * Se afloja SÓLO para `/legacy`, `/web` y `/lib`, que es código propio que ya
 * está en el repositorio y sale de esta misma máquina. La aplicación nueva
 * queda con la política estricta, y cuando se migren las siete vistas que
 * faltan esta excepción se borra junto con la carpeta.
 */
const cspLegado = helmet.contentSecurityPolicy({
  useDefaults: true,
  directives: { ...directivasBase, scriptSrc: ["'self'", "'unsafe-inline'"] },
});

const RUTAS_LEGADO = ['/legacy', '/web/', '/lib/'];

app.use((req, res, siguiente) => {
  const legado = RUTAS_LEGADO.some((p) => req.path.startsWith(p));
  return (legado ? cspLegado : cspEstricta)(req, res, siguiente);
});

app.use(
  helmet({
    contentSecurityPolicy: false, // ya la puso el middleware de arriba
    // El sistema se sirve por HTTP en la red del taller: HSTS lo dejaría
    // inaccesible desde cualquier navegador que lo haya visitado una vez.
    hsts: false,
    crossOriginEmbedderPolicy: false,
  })
);

app.use(compression());
app.use(express.json({ limit: '60mb' }));
app.use((req, _res, siguiente) => {
  req.operario = operarioSeguro(req.get('x-kort-operario'));
  siguiente();
});

/* ---------------- API ---------------- */

const api = express.Router();

function validarEdicionRetazos(lista) {
  const normalizados = lista.map(normalizarRetazo);
  const ids = new Set();
  const actuales = new Map((db.leer('retazos') || []).map((r) => [r.id, normalizarRetazo(r)]));
  const errores = [];
  const reservadas = (r) => r.reservas.reduce((total, x) => total + x.cantidad, 0);

  for (const r of normalizados) {
    if (!r.id) errores.push('Hay un retazo sin id.');
    if (ids.has(r.id)) errores.push(`El id de retazo ${r.id} está repetido.`);
    ids.add(r.id);
    if (reservadas(r) > r.cantidad) errores.push(`El retazo ${r.id} tiene más unidades reservadas que físicas.`);
    if (r.estado === 'descartado' && r.reservas.length) errores.push(`El retazo ${r.id} no puede descartarse mientras una OT lo reserva.`);

    const anterior = actuales.get(r.id);
    if (!anterior?.reservas.length) continue;
    const nuevasPorOrden = new Map(r.reservas.map((x) => [x.ordenId, x.cantidad]));
    for (const reserva of anterior.reservas) {
      if ((nuevasPorOrden.get(reserva.ordenId) || 0) < reserva.cantidad) {
        errores.push(`No se puede quitar la reserva de la orden ${reserva.ordenId} desde Stock.`);
      }
    }
    if (r.materialId !== anterior.materialId || r.espesor !== anterior.espesor || r.w !== anterior.w || r.h !== anterior.h) {
      errores.push(`No se pueden cambiar medidas o material del retazo ${r.id} mientras está reservado.`);
    }
  }
  for (const anterior of actuales.values()) {
    if (anterior.reservas.length && !ids.has(anterior.id)) errores.push(`No se puede borrar el retazo ${anterior.id} mientras está reservado.`);
  }
  return errores.length ? { ok: false, motivo: errores.join(' ') } : { ok: true };
}

// --- Documentos únicos (config, materiales, máquinas)
api.get('/:recurso', (req, res, siguiente) => {
  const { recurso } = req.params;
  if (!DOCUMENTOS.includes(recurso)) return siguiente();
  res.json(db.leer(recurso));
});

/**
 * Guardado de los documentos de configuración.
 *
 * ⚠️ Acá había una bomba: el PUT reemplazaba el documento entero por lo que
 * viniera en el cuerpo. Un cliente que mandara sólo `{comercial:{margen:50}}`
 * **borraba la empresa, la producción y la estructura de costos**, y el
 * sistema seguía andando con los valores de fábrica como si nada. Se pierde
 * la calibración del taller sin un solo mensaje de error.
 *
 * Ahora se fusiona sobre lo que ya estaba y, en las listas, se valida que
 * tengan forma de lista antes de pisar nada.
 */
api.put('/:recurso', (req, res, siguiente) => {
  const { recurso } = req.params;
  if (!DOCUMENTOS.includes(recurso)) return siguiente();
  const cuerpo = req.body;

  if (recurso === 'materiales' || recurso === 'maquinas' || recurso === 'retazos') {
    if (!Array.isArray(cuerpo) || (recurso !== 'retazos' && cuerpo.length === 0)) {
      return res.status(400).json({
        error: `${recurso} tiene que ser una lista con al menos un elemento. No se guardó nada.`,
      });
    }
    const sinId = cuerpo.filter((x) => !x || typeof x !== 'object' || !x.id);
    if (sinId.length) {
      return res.status(400).json({ error: `Hay ${sinId.length} ${recurso} sin id. No se guardó nada.` });
    }
    if (recurso === 'retazos') {
      const control = validarEdicionRetazos(cuerpo);
      if (!control.ok) return res.status(409).json({ error: control.motivo });
    }
    if (recurso === 'materiales') {
      const sinProcesos = cuerpo.filter((m) => !m.procesos || !Object.keys(m.procesos).length);
      if (sinProcesos.length) {
        return res.status(400).json({
          error: `Estos materiales no tienen tablas de corte por gas: ${sinProcesos.map((m) => m.id).join(', ')}. `
            + 'Guardarlos dejaría al cotizador sin poder calcular. No se guardó nada.',
        });
      }
    }
    return res.json(db.escribir(recurso, cuerpo, req.operario));
  }

  // config: se fusiona sobre lo guardado, nunca se reemplaza a ciegas
  if (!cuerpo || typeof cuerpo !== 'object' || Array.isArray(cuerpo)) {
    return res.status(400).json({ error: 'La configuración tiene que ser un objeto. No se guardó nada.' });
  }
  const actual = db.leer('config') || {};
  return res.json(db.escribir('config', fusionarProfundo(actual, cuerpo), req.operario));
});

// --- Colecciones
api.get('/:recurso', (req, res, siguiente) => {
  const { recurso } = req.params;
  if (!COLECCIONES.includes(recurso)) return siguiente();
  const q = String(req.query.q || '').toLowerCase();
  const estado = req.query.estado;
  let out = db.lista(recurso);
  if (q) out = out.filter((x) => JSON.stringify(x).toLowerCase().includes(q));
  if (estado) out = out.filter((x) => x.estado === estado);
  res.json(out);
});

api.get('/:recurso/:id', (req, res, siguiente) => {
  const { recurso, id } = req.params;
  if (!COLECCIONES.includes(recurso)) return siguiente();
  const o = db.obtener(recurso, id);
  if (!o) return res.status(404).json({ error: 'No existe' });
  res.json(o);
});

function asignacionesDeOrden(orden) {
  if (Array.isArray(orden?.retazos) && orden.retazos.length) {
    return orden.retazos
      .filter((x) => x.estado !== 'liberado' && x.estado !== 'consumido')
      .map((x) => ({ retazoId: x.retazoId || x.id, cantidad: x.cantidad }));
  }
  return asignacionesRetazoDeItems(orden?.items || []);
}

function marcasRetazoOrden(asignaciones, estado) {
  const fecha = new Date().toISOString();
  return (asignaciones || []).map((x) => ({
    retazoId: x.retazoId || x.id,
    cantidad: x.cantidad,
    estado,
    fecha,
  }));
}

/**
 * Aprueba un presupuesto y crea su OT en una sola transaccion. El cliente no
 * decide el numero de OT ni escribe el stock: ambos salen de la base.
 */
api.post('/ordenes/aprobar', (req, res) => {
  const { presupuestoId } = validar(esquemaAprobar, req.body);
  const presupuesto = db.obtener('presupuestos', presupuestoId);
  if (!presupuesto) return res.status(404).json({ error: 'El presupuesto no existe.' });

  const existente = db.lista('ordenes').find((x) => x.presupuestoId === presupuestoId);
  if (existente) {
    return res.json({ orden: existente, repetido: true, reservadas: (existente.retazos || []).filter((x) => x.estado === 'reservado').reduce((a, x) => a + Number(x.cantidad || 0), 0) });
  }

  const id = nuevoId();
  const asignaciones = asignacionesRetazoDeItems(presupuesto.items || []);
  const orden = {
    id,
    presupuestoId: presupuesto.id,
    cliente: presupuesto.cliente,
    items: (presupuesto.items || []).map((item) => ({
      nombre: item.nombre,
      cantidad: item.cantidad,
      materialId: item.materialId,
      espesor: item.espesor,
      materialCliente: item.materialCliente === true,
      retazoId: item.retazoId || null,
    })),
    resumen: presupuesto.resumen,
    planProduccion: presupuesto.planProduccion || null,
    // Queda congelado al aprobar: producción necesita lo que pidió ese
    // nesting, aunque después cambien precios o medidas predeterminadas.
    requerimientosChapa: presupuesto.requerimientosChapa || [],
    retazos: marcasRetazoOrden(asignaciones, 'reservado'),
    estado: 'pendiente',
    fechaEntrega: '',
    prioridad: 'normal',
  };

  try {
    const salida = db.transaccion(() => {
      const reserva = reservarRetazos(db.leer('retazos') || [], asignaciones, {
        ordenId: id,
        presupuestoId: presupuesto.id,
      });
      if (!reserva.ok) {
        const error = new Error(reserva.motivo);
        error.status = 409;
        throw error;
      }
      orden.numero = db.siguienteNumero('OT');
      db.escribir('retazos', reserva.retazos, req.operario);
      const creada = db.crear('ordenes', orden, req.operario);
      db.actualizar('presupuestos', presupuesto.id, { estado: 'aprobado' }, req.operario);
      return { orden: creada, reservadas: reserva.reservadas };
    });
    res.status(201).json(salida);
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

/** Una acción por transacción: dos tablets no se pisan el estado completo. */
api.put('/ordenes/:id/taller', (req, res, siguiente) => {
  const { id } = req.params;
  if (!db.obtener('ordenes', id)) return siguiente();
  try {
    const salida = db.transaccion(() => {
      const actual = db.obtener('ordenes', id);
      const evento = { ...req.body, operario: req.operario || req.body?.operario || '' };
      const actualizado = aplicarEventoTaller(actual, evento);
      return db.actualizar('ordenes', id, { taller: actualizado.taller }, req.operario);
    });
    res.json(salida);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

api.post('/:recurso', (req, res, siguiente) => {
  const { recurso } = req.params;
  if (!COLECCIONES.includes(recurso)) return siguiente();
  const body = { ...req.body };
  if (recurso === 'presupuestos' && !body.numero) body.numero = db.siguienteNumero('P');
  if (recurso === 'ordenes' && !body.numero) body.numero = db.siguienteNumero('OT');
  res.status(201).json(db.crear(recurso, body, req.operario));
});

/** Cambios de etapa con movimiento real del retazero. */
api.put('/ordenes/:id', (req, res, siguiente) => {
  const { id } = req.params;
  const actual = db.obtener('ordenes', id);
  if (!actual) return siguiente();
  const nuevoEstado = req.body?.estado;
  if (!nuevoEstado || nuevoEstado === actual.estado) {
    return res.json(db.actualizar('ordenes', id, req.body, req.operario));
  }
  if (actual.estado === 'cancelado' && nuevoEstado !== 'cancelado') {
    return res.status(409).json({ error: 'Una orden cancelada no vuelve a producción. Creá una nueva OT.' });
  }

  try {
    const salida = db.transaccion(() => {
      let retazos = db.leer('retazos') || [];
      let cambios = { ...req.body };
      const asignaciones = asignacionesDeOrden(actual);

      if (nuevoEstado === 'corte' && actual.estado !== 'corte') {
        // Las OTs antiguas no tienen la marca de reserva. Se intenta reservar
        // antes de consumirlas para que nunca se descuente stock sin respaldo.
        const reserva = reservarRetazos(retazos, asignaciones, {
          ordenId: id,
          presupuestoId: actual.presupuestoId,
        });
        if (!reserva.ok) {
          const error = new Error(reserva.motivo);
          error.status = 409;
          throw error;
        }
        retazos = reserva.retazos;
        const consumo = consumirRetazos(retazos, id);
        if (!consumo.ok) {
          const error = new Error(consumo.motivo);
          error.status = 409;
          throw error;
        }
        if (consumo.consumidas > 0) {
          retazos = consumo.retazos;
          cambios.retazos = marcasRetazoOrden(asignaciones, 'consumido');
        }
        if (consumo.consumidas > 0 || reserva.reservadas > 0) db.escribir('retazos', retazos, req.operario);
      }

      if (nuevoEstado === 'cancelado') {
        const liberacion = liberarRetazos(retazos, id);
        if (!liberacion.ok) {
          const error = new Error(liberacion.motivo);
          error.status = 409;
          throw error;
        }
        if (liberacion.liberadas > 0) {
          db.escribir('retazos', liberacion.retazos, req.operario);
          cambios.retazos = marcasRetazoOrden(asignaciones, 'liberado');
        }
      }

      return db.actualizar('ordenes', id, cambios, req.operario);
    });
    res.json(salida);
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});

// Una aprobacion sin OT dejaria el presupuesto vendido pero sin material
// reservado. La unica entrada valida es "Pasar a produccion".
api.put('/presupuestos/:id', (req, res, siguiente) => {
  const actual = db.obtener('presupuestos', req.params.id);
  if (!actual) return siguiente();
  if (req.body?.estado === 'aprobado' && actual.estado !== 'aprobado') {
    const tieneOrden = db.lista('ordenes').some((x) => x.presupuestoId === actual.id);
    if (!tieneOrden) return res.status(409).json({ error: 'Aprobá desde "Pasar a producción" para crear la OT y reservar el material.' });
  }
  res.json(db.actualizar('presupuestos', actual.id, req.body, req.operario));
});

api.put('/:recurso/:id', (req, res, siguiente) => {
  const { recurso, id } = req.params;
  if (!COLECCIONES.includes(recurso)) return siguiente();
  const o = db.actualizar(recurso, id, req.body, req.operario);
  if (!o) return res.status(404).json({ error: 'No existe' });
  res.json(o);
});

/** Borrar una OT tambien libera lo que seguia reservado. */
api.delete('/ordenes/:id', (req, res, siguiente) => {
  const { id } = req.params;
  const actual = db.obtener('ordenes', id);
  if (!actual) return siguiente();
  const salida = db.transaccion(() => {
    const liberacion = liberarRetazos(db.leer('retazos') || [], id);
    if (liberacion.ok && liberacion.liberadas > 0) db.escribir('retazos', liberacion.retazos, req.operario);
    return { ok: db.borrar('ordenes', id, req.operario), liberadas: liberacion.liberadas || 0 };
  });
  res.json(salida);
});

api.delete('/:recurso/:id', (req, res, siguiente) => {
  const { recurso, id } = req.params;
  if (!COLECCIONES.includes(recurso)) return siguiente();
  res.json({ ok: db.borrar(recurso, id, req.operario) });
});

// --- Numeración correlativa
api.get('/numero', (req, res) => {
  const tipo = z.enum(['P', 'OT']).catch('P').parse(req.query.tipo);
  res.json({ numero: db.siguienteNumero(tipo) });
});

// --- Guardado de archivos generados (PDF / DXF)
api.post('/archivos', (req, res) => {
  const body = validar(esquemaArchivo, req.body);
  const nombre = nombreSeguro(body.nombre);
  const carpeta = body.carpeta ? nombreSeguro(body.carpeta) : '';
  const dir = carpeta ? path.join(DIR_SALIDAS, carpeta) : DIR_SALIDAS;
  const destino = path.join(dir, nombre);
  // Cinturón y tiradores: aunque el nombre ya venga saneado, la ruta final
  // tiene que caer adentro de salidas/ o no se escribe.
  if (!path.normalize(destino).startsWith(DIR_SALIDAS)) {
    return res.status(400).json({ error: 'Ruta inválida' });
  }
  fs.mkdirSync(dir, { recursive: true });
  const datos = body.base64
    ? Buffer.from(body.base64, 'base64')
    : Buffer.from(String(body.texto ?? ''), 'utf8');
  fs.writeFileSync(destino, datos);
  res.json({ ok: true, ruta: path.relative(RAIZ, destino).replace(/\\/g, '/') });
});

api.get('/archivos', (_req, res) => {
  const listar = (dir, base = '') => {
    const out = [];
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = base ? `${base}/${e.name}` : e.name;
      if (e.isDirectory()) out.push(...listar(path.join(dir, e.name), rel));
      else {
        const st = fs.statSync(path.join(dir, e.name));
        out.push({ nombre: rel, tam: st.size, fecha: st.mtime.toISOString() });
      }
    }
    return out;
  };
  try {
    res.json(listar(DIR_SALIDAS).sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 300));
  } catch {
    res.json([]);
  }
});

// --- Respaldo completo
api.get('/respaldo', (_req, res) => res.json(db.exportarTodo()));

api.post('/respaldo', (req, res) => {
  const body = validar(esquemaRespaldo, req.body);
  db.cache.clear();
  db.importarTodo(body);
  res.json({ ok: true });
});

// --- Restaurar valores de fábrica de una tabla
api.post('/restaurar', async (req, res) => {
  const { tabla } = validar(esquemaRestaurar, req.body);
  const { DEFAULT_MATERIALS } = await import('./src/core/materials.js');
  const { DEFAULT_MACHINE, DEFAULT_PLEGADORA } = await import('./src/core/cutting.js');
  const { DEFAULT_CONFIG } = await import('./src/core/pricing.js');
  if (tabla === 'materiales') return res.json(db.escribir('materiales', DEFAULT_MATERIALS, req.operario));
  if (tabla === 'maquinas') return res.json(db.escribir('maquinas', [DEFAULT_MACHINE, DEFAULT_PLEGADORA], req.operario));
  res.json(db.escribir('config', DEFAULT_CONFIG, req.operario));
});

// --- Estadísticas para el panel (consultas SQL, no recorriendo arrays)
api.get('/estadisticas', (_req, res) => res.json(db.estadisticas()));

// --- Búsqueda de texto completo (FTS5) sobre todo el sistema
api.get('/buscar', (req, res) => {
  res.json(db.buscar(String(req.query.q || ''), validar(esquemaEntero(40, 300), req.query.limite)));
});

// --- Historial y variación de precios de material
api.get('/precios/variacion', (req, res) => {
  res.json(db.variacionPrecios(validar(esquemaEntero(90, 3650), req.query.dias)));
});

api.get('/precios', (req, res) => {
  const material = req.query.material ? String(req.query.material) : null;
  res.json(db.historialPrecios(material, validar(esquemaEntero(500, 5000), req.query.limite)));
});

// --- Bitácora de cambios
api.get('/bitacora', (req, res) => {
  res.json(db.bitacora(validar(esquemaEntero(100, 1000), req.query.limite)));
});

// --- Costo de estructura calculado en el servidor
api.get('/estructura', async (_req, res) => {
  const { calcularEstructura, puntoEquilibrio } = await import('./src/core/costos.js');
  const cfg = db.leer('config');
  const est = calcularEstructura(cfg.estructura);
  res.json({ ...est, equilibrio: puntoEquilibrio(est, cfg.comercial?.margen ?? 45) });
});

// --- Carga de taller y fecha prometible
api.get('/agenda', async (_req, res) => {
  const { agendaProduccion } = await import('./src/core/agenda.js');
  res.json(agendaProduccion(db.lista('ordenes'), db.leer('config') || {}));
});

// --- Máquina en vivo ----------------------------------------------------

api.get('/telemetria', (req, res) => {
  const maquinaId = String(req.query.maquina || 'laser-3kw').slice(0, 80);
  const horas = Math.max(0.1, Math.min(168, Number(req.query.horas) || 8));
  const desde = new Date(Date.now() - horas * 3600000).toISOString();
  const muestras = db.telemetria(maquinaId, desde, 12000);
  res.json({
    maquinaId, desde, muestras: serieTelemetria(muestras),
    resumen: resumirTelemetria(muestras),
    contrato: 'kort.telemetria.v1',
  });
});

api.post('/telemetria', (req, res) => {
  const tokenConfigurado = process.env.KORT_MACHINE_TOKEN || '';
  const tokenRecibido = String(req.get('X-KORT-Machine-Token') || '');
  const ip = String(req.socket.remoteAddress || '');
  const esLocal = ip === '127.0.0.1' || ip === '::1' || ip.endsWith('::ffff:127.0.0.1');
  // Sin token sólo escucha al puente instalado en esta PC. Abrir una entrada
  // anónima en la LAN permitiría falsificar alarmas y métricas de producción.
  if ((tokenConfigurado && tokenRecibido !== tokenConfigurado) || (!tokenConfigurado && !esLocal)) {
    return res.status(403).json({ error: 'Origen de telemetría no autorizado.' });
  }
  const muestra = normalizarMuestra(validar(esquemaTelemetria, req.body));
  db.registrarTelemetria(muestra);
  res.status(201).json(muestra);
});

api.use((req, res) => {
  res.status(404).json({ error: 'Recurso desconocido: ' + req.path.split('/')[1] });
});

app.use('/api', api);

/* ---------------- Estáticos ---------------- */

// Los archivos generados: se listan y se abren desde el navegador.
app.use('/salidas', express.static(DIR_SALIDAS, { index: false, dotfiles: 'deny' }));

/* ---------------- Interfaz anterior ---------------- */

/**
 * Las vistas que todavía no se rehicieron en React se sirven tal cual estaban
 * y la aplicación nueva las embebe en un iframe.
 *
 * El aislamiento no es pereza: `web/css/app.css` estiliza `button`, `input`,
 * `table` y `main` por selector de elemento. Cargada en el mismo documento que
 * la interfaz nueva, le cambia el aspecto a todos los componentes apenas se
 * visita una de esas vistas. El iframe corta eso de raíz, y cada vista que se
 * migra sale de acá sin tocar a las demás.
 */
const DIR_LEGADO = path.join(RAIZ, 'web');

const LIBRERIAS = {
  '/lib/three.module.js': 'node_modules/three/build/three.module.min.js',
  // three.module.min.js re-exporta desde three.core.min.js: hay que servir los dos
  '/lib/three.core.min.js': 'node_modules/three/build/three.core.min.js',
  '/lib/OrbitControls.js': 'node_modules/three/examples/jsm/controls/OrbitControls.js',
  '/lib/chart.umd.js': 'node_modules/chart.js/dist/chart.umd.js',
};

app.get(Object.keys(LIBRERIAS), (req, res) => {
  const lib = path.join(RAIZ, LIBRERIAS[req.path]);
  if (!fs.existsSync(lib)) {
    return res.status(404).type('text/plain').send(`Falta la librería ${req.path}. Ejecutá: npm install`);
  }
  res.type('text/javascript; charset=utf-8').sendFile(lib);
});

app.use('/web', express.static(DIR_LEGADO, { index: false }));
// El motor de cálculo: la interfaz anterior lo importa por ruta absoluta.
app.use('/src/core', express.static(path.join(RAIZ, 'src/core'), { index: false }));

app.get(['/legacy', '/legacy/'], (_req, res) => res.sendFile(path.join(DIR_LEGADO, 'index.html')));

if (hayBundle) {
  // Los assets de Vite llevan hash en el nombre: se pueden cachear fuerte.
  app.use(express.static(DIR_WEB, { index: false, maxAge: '7d', setHeaders: (res, f) => {
    if (f.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  } }));

  // SPA: cualquier ruta que no sea API ni archivo devuelve el index.
  // HEAD entra también: si no, un chequeo de salud recibe un 404 y parece
  // que el sistema está caído cuando está andando.
  app.use((req, res, siguiente) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return siguiente();
    res.sendFile(path.join(DIR_WEB, 'index.html'));
  });
} else {
  app.use((_req, res) => {
    res.status(503).type('text/plain; charset=utf-8').send(
      'El front todavía no está compilado.\n\n' +
        'Ejecutá:  npm run build\n' +
        'O para desarrollar con recarga en vivo:  npm run dev\n'
    );
  });
}

/* ---------------- Errores ---------------- */

// Cuatro argumentos: es así como Express reconoce el manejador de errores.
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _siguiente) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'Error interno' });
});

/* ------------------------------------------------------------------ */

export function iniciarServidor() {
  const servidor = app.listen(PUERTO, () => {
    const linea = '─'.repeat(52);
    console.log(`\n┌${linea}┐`);
    console.log('│  KORT · Sistema de corte láser y plegado CNC       │');
    console.log(`├${linea}┤`);
    console.log(`│  Abrí en el navegador:  http://localhost:${PUERTO}${' '.repeat(Math.max(0, 9 - String(PUERTO).length))}│`);
    console.log(`│  Datos:    ./data                                 │`);
    console.log(`│  Salidas:  ./salidas  (PDF y DXF generados)        │`);
    if (!hayBundle) {
      console.log(`├${linea}┤`);
      console.log('│  ⚠  Front sin compilar — corré:  npm run build     │');
    }
    console.log(`├${linea}┤`);
    console.log('│  Para cerrar: Ctrl+C                              │');
    console.log(`└${linea}┘\n`);
  });

  servidor.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.error(`\n  El puerto ${PUERTO} ya está en uso.`);
      console.error(`  Puede que el sistema ya esté abierto en http://localhost:${PUERTO}`);
      console.error(`  O arrancalo en otro puerto:  set PORT=4322 && node server.js\n`);
    } else console.error(e);
    process.exit(1);
  });

  return servidor;
}

if (path.resolve(process.argv[1] || '') === __filename) iniciarServidor();

export default app;
