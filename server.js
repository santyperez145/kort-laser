/**
 * KORT - Servidor
 *
 * HTTP sin dependencias: sirve la interfaz, expone la API REST de datos y
 * guarda los archivos generados (PDF, DXF) en la carpeta `salidas/`, ordenados
 * por presupuesto, para que el taller los encuentre sin abrir el sistema.
 *
 * Arranque:  node server.js       (o doble clic en INICIAR.bat)
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DB } from './src/server/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUERTO = Number(process.env.PORT) || 4321;
const RAIZ = __dirname;
const DIR_DATOS = path.join(RAIZ, 'data');
const DIR_SALIDAS = path.join(RAIZ, 'salidas');

const db = new DB(DIR_DATOS);
fs.mkdirSync(DIR_SALIDAS, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
  '.dxf': 'application/dxf',
  '.txt': 'text/plain; charset=utf-8',
};

function json(res, data, code = 200) {
  const body = JSON.stringify(data);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function leerCuerpo(req, limiteMB = 60) {
  return new Promise((resolve, reject) => {
    const partes = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > limiteMB * 1024 * 1024) {
        reject(new Error('Cuerpo demasiado grande'));
        req.destroy();
        return;
      }
      partes.push(c);
    });
    req.on('end', () => {
      const s = Buffer.concat(partes).toString('utf8');
      if (!s) return resolve({});
      try {
        resolve(JSON.parse(s));
      } catch (e) {
        reject(new Error('JSON inválido'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Librerías externas servidas desde node_modules. Se listan una por una en
 * vez de exponer la carpeta entera: sólo sale a la web lo que la interfaz
 * necesita de verdad.
 */
const LIBRERIAS = {
  '/lib/three.module.js': 'node_modules/three/build/three.module.min.js',
  // three.module.min.js re-exporta desde three.core.min.js: hay que servir los dos
  '/lib/three.core.min.js': 'node_modules/three/build/three.core.min.js',
  '/lib/OrbitControls.js': 'node_modules/three/examples/jsm/controls/OrbitControls.js',
  '/lib/chart.umd.js': 'node_modules/chart.js/dist/chart.umd.js',
};

/** Sirve un archivo estático evitando salir de la carpeta del proyecto. */
function servirEstatico(res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  if (rel === '/' || rel === '') rel = '/web/index.html';

  if (LIBRERIAS[rel]) {
    const lib = path.join(RAIZ, LIBRERIAS[rel]);
    if (fs.existsSync(lib)) {
      res.writeHead(200, {
        'Content-Type': 'text/javascript; charset=utf-8',
        'Content-Length': fs.statSync(lib).size,
        'Cache-Control': 'public, max-age=86400',
      });
      return fs.createReadStream(lib).pipe(res);
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end(`Falta la librería ${rel}. Ejecutá: npm install`);
  }

  if (rel.startsWith('/salidas/')) {
    // permitido: archivos generados
  } else if (!rel.startsWith('/web/') && !rel.startsWith('/src/')) {
    rel = '/web' + rel;
  }
  const destino = path.normalize(path.join(RAIZ, rel));
  if (!destino.startsWith(RAIZ)) {
    res.writeHead(403);
    return res.end('Prohibido');
  }
  fs.stat(destino, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('No encontrado: ' + rel);
    }
    const ext = path.extname(destino).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(destino).pipe(res);
  });
}

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

const COLECCIONES = ['clientes', 'presupuestos', 'ordenes', 'piezas'];
const DOCUMENTOS = ['config', 'materiales', 'maquinas'];

async function api(req, res, url) {
  const partes = url.pathname.split('/').filter(Boolean); // ['api', recurso, id?]
  const recurso = partes[1];
  const id = partes[2] ? decodeURIComponent(partes[2]) : null;
  const metodo = req.method;

  // --- Documentos únicos (config, materiales, máquinas)
  if (DOCUMENTOS.includes(recurso)) {
    if (metodo === 'GET') return json(res, db.leer(recurso));
    if (metodo === 'PUT') {
      const body = await leerCuerpo(req);
      return json(res, db.escribir(recurso, body));
    }
    return json(res, { error: 'Método no permitido' }, 405);
  }

  // --- Colecciones
  if (COLECCIONES.includes(recurso)) {
    if (metodo === 'GET' && !id) {
      const lista = db.lista(recurso);
      const q = (url.searchParams.get('q') || '').toLowerCase();
      const estado = url.searchParams.get('estado');
      let out = lista;
      if (q) out = out.filter((x) => JSON.stringify(x).toLowerCase().includes(q));
      if (estado) out = out.filter((x) => x.estado === estado);
      return json(res, out);
    }
    if (metodo === 'GET' && id) {
      const o = db.obtener(recurso, id);
      return o ? json(res, o) : json(res, { error: 'No existe' }, 404);
    }
    if (metodo === 'POST') {
      const body = await leerCuerpo(req);
      if (recurso === 'presupuestos' && !body.numero) body.numero = db.siguienteNumero('P');
      if (recurso === 'ordenes' && !body.numero) body.numero = db.siguienteNumero('OT');
      return json(res, db.crear(recurso, body), 201);
    }
    if (metodo === 'PUT' && id) {
      const body = await leerCuerpo(req);
      const o = db.actualizar(recurso, id, body);
      return o ? json(res, o) : json(res, { error: 'No existe' }, 404);
    }
    if (metodo === 'DELETE' && id) {
      return json(res, { ok: db.borrar(recurso, id) });
    }
    return json(res, { error: 'Método no permitido' }, 405);
  }

  // --- Numeración
  if (recurso === 'numero' && metodo === 'GET') {
    return json(res, { numero: db.siguienteNumero(url.searchParams.get('tipo') || 'P') });
  }

  // --- Guardado de archivos generados (PDF / DXF)
  if (recurso === 'archivos' && metodo === 'POST') {
    const body = await leerCuerpo(req);
    const nombre = String(body.nombre || 'archivo.bin').replace(/[^\w.\-áéíóúñÁÉÍÓÚÑ ]/g, '_');
    const carpeta = String(body.carpeta || '').replace(/[^\w.\-áéíóúñÁÉÍÓÚÑ ]/g, '_');
    const dir = carpeta ? path.join(DIR_SALIDAS, carpeta) : DIR_SALIDAS;
    fs.mkdirSync(dir, { recursive: true });
    const destino = path.join(dir, nombre);
    if (!path.normalize(destino).startsWith(DIR_SALIDAS)) return json(res, { error: 'Ruta inválida' }, 400);
    const datos = body.base64 ? Buffer.from(body.base64, 'base64') : Buffer.from(String(body.texto ?? ''), 'utf8');
    fs.writeFileSync(destino, datos);
    return json(res, { ok: true, ruta: path.relative(RAIZ, destino).replace(/\\/g, '/') });
  }

  if (recurso === 'archivos' && metodo === 'GET') {
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
      return json(res, listar(DIR_SALIDAS).sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 300));
    } catch {
      return json(res, []);
    }
  }

  // --- Respaldo completo
  if (recurso === 'respaldo') {
    if (metodo === 'GET') return json(res, db.exportarTodo());
    if (metodo === 'POST') {
      const body = await leerCuerpo(req);
      db.cache.clear();
      db.importarTodo(body);
      return json(res, { ok: true });
    }
  }

  // --- Restaurar valores de fábrica de una tabla
  if (recurso === 'restaurar' && metodo === 'POST') {
    const body = await leerCuerpo(req);
    const { DEFAULT_MATERIALS } = await import('./src/core/materials.js');
    const { DEFAULT_MACHINE, DEFAULT_PLEGADORA } = await import('./src/core/cutting.js');
    const { DEFAULT_CONFIG } = await import('./src/core/pricing.js');
    if (body.tabla === 'materiales') return json(res, db.escribir('materiales', DEFAULT_MATERIALS));
    if (body.tabla === 'maquinas') return json(res, db.escribir('maquinas', [DEFAULT_MACHINE, DEFAULT_PLEGADORA]));
    if (body.tabla === 'config') return json(res, db.escribir('config', DEFAULT_CONFIG));
    return json(res, { error: 'Tabla desconocida' }, 400);
  }

  // --- Estadísticas para el panel (consultas SQL, no recorriendo arrays)
  if (recurso === 'estadisticas' && metodo === 'GET') {
    return json(res, db.estadisticas());
  }

  // --- Búsqueda de texto completo (FTS5) sobre todo el sistema
  if (recurso === 'buscar' && metodo === 'GET') {
    return json(res, db.buscar(url.searchParams.get('q') || '', Number(url.searchParams.get('limite')) || 40));
  }

  // --- Historial y variación de precios de material
  if (recurso === 'precios' && metodo === 'GET') {
    const modo = partes[2];
    if (modo === 'variacion') {
      return json(res, db.variacionPrecios(Number(url.searchParams.get('dias')) || 90));
    }
    return json(res, db.historialPrecios(url.searchParams.get('material') || null,
      Number(url.searchParams.get('limite')) || 500));
  }

  // --- Bitácora de cambios
  if (recurso === 'bitacora' && metodo === 'GET') {
    return json(res, db.bitacora(Number(url.searchParams.get('limite')) || 100));
  }

  // --- Costo de estructura calculado en el servidor
  if (recurso === 'estructura' && metodo === 'GET') {
    const { calcularEstructura, puntoEquilibrio } = await import('./src/core/costos.js');
    const cfg = db.leer('config');
    const est = calcularEstructura(cfg.estructura);
    return json(res, { ...est, equilibrio: puntoEquilibrio(est, cfg.comercial?.margen ?? 45) });
  }

  return json(res, { error: 'Recurso desconocido: ' + recurso }, 404);
}

/* ------------------------------------------------------------------ */

const servidor = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (url.pathname.startsWith('/api/')) {
    try {
      await api(req, res, url);
    } catch (e) {
      if (!res.headersSent) json(res, { error: e.message }, 500);
    }
    return;
  }
  servirEstatico(res, url.pathname);
});

servidor.listen(PUERTO, () => {
  const linea = '─'.repeat(52);
  console.log(`\n┌${linea}┐`);
  console.log('│  KORT · Sistema de corte láser y plegado CNC       │');
  console.log(`├${linea}┤`);
  console.log(`│  Abrí en el navegador:  http://localhost:${PUERTO}${' '.repeat(Math.max(0, 9 - String(PUERTO).length))}│`);
  console.log(`│  Datos:    ./data                                 │`);
  console.log(`│  Salidas:  ./salidas  (PDF y DXF generados)        │`);
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
