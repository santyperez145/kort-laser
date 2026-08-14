/**
 * KORT - Base de datos
 *
 * SQLite real (node-sqlite3-wasm: el motor completo compilado a WebAssembly,
 * sin compilación nativa ni dependencias del sistema). Un solo archivo,
 * data/kort.db, que se puede copiar, abrir con cualquier visor de SQLite y
 * respaldar con arrastrarlo a un pendrive.
 *
 * Qué gana el taller respecto de guardar JSON:
 *
 *  · HISTORIAL DE PRECIOS. Cada vez que cambia el precio de un material queda
 *    registrado con fecha. Con la inflación argentina eso no es un lujo: es
 *    poder contestar "¿por qué esto salía la mitad en marzo?" y ver la curva.
 *  · BÚSQUEDA REAL (FTS5) sobre presupuestos, clientes y piezas.
 *  · CONSULTAS. "Cuánto facturé por material", "qué cliente deja más margen",
 *    "cuántos kg de inox consumí" salen en una query, no recorriendo arrays.
 *  · TRANSACCIONES. Un corte de luz a mitad de un guardado no deja el archivo
 *    a medio escribir.
 *  · BITÁCORA. Quién cambió qué y cuándo.
 */

import fs from 'node:fs';
import path from 'node:path';
// node-sqlite3-wasm es CommonJS: se importa por defecto y se desestructura.
import sqlite from 'node-sqlite3-wasm';
const { Database } = sqlite;
import { DEFAULT_MATERIALS } from '../core/materials.js';
import { DEFAULT_MACHINE, DEFAULT_PLEGADORA } from '../core/cutting.js';
import { DEFAULT_CONFIG } from '../core/pricing.js';

const ESQUEMA = [
  /* v1 ─ estructura base ------------------------------------------------ */
  `
  CREATE TABLE IF NOT EXISTS ajustes (
    clave   TEXT PRIMARY KEY,
    valor   TEXT NOT NULL,
    modificado TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS clientes (
    id        TEXT PRIMARY KEY,
    nombre    TEXT NOT NULL,
    cuit      TEXT,
    telefono  TEXT,
    email     TEXT,
    direccion TEXT,
    contacto  TEXT,
    descuento REAL DEFAULT 0,
    notas     TEXT,
    creado    TEXT NOT NULL,
    modificado TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS ix_clientes_nombre ON clientes(nombre);

  CREATE TABLE IF NOT EXISTS presupuestos (
    id          TEXT PRIMARY KEY,
    numero      TEXT UNIQUE,
    fecha       TEXT,
    estado      TEXT DEFAULT 'borrador',
    cliente_id  TEXT REFERENCES clientes(id) ON DELETE SET NULL,
    cliente_nombre TEXT,
    total       REAL DEFAULT 0,
    costo       REAL DEFAULT 0,
    utilidad    REAL DEFAULT 0,
    peso_total  REAL DEFAULT 0,
    piezas      INTEGER DEFAULT 0,
    chapas      INTEGER DEFAULT 0,
    tiempo_prod REAL DEFAULT 0,
    tipo_cambio REAL,
    datos       TEXT NOT NULL,
    creado      TEXT NOT NULL,
    modificado  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS ix_pres_estado ON presupuestos(estado);
  CREATE INDEX IF NOT EXISTS ix_pres_fecha  ON presupuestos(fecha);
  CREATE INDEX IF NOT EXISTS ix_pres_cliente ON presupuestos(cliente_id);

  CREATE TABLE IF NOT EXISTS presupuesto_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    presupuesto_id TEXT NOT NULL REFERENCES presupuestos(id) ON DELETE CASCADE,
    orden       INTEGER,
    nombre      TEXT,
    material_id TEXT,
    espesor     REAL,
    gas         TEXT,
    cantidad    INTEGER,
    peso_total  REAL,
    largo_corte REAL,
    precio_neto REAL,
    costo_total REAL
  );
  CREATE INDEX IF NOT EXISTS ix_items_pres ON presupuesto_items(presupuesto_id);
  CREATE INDEX IF NOT EXISTS ix_items_mat  ON presupuesto_items(material_id);

  CREATE TABLE IF NOT EXISTS ordenes (
    id          TEXT PRIMARY KEY,
    numero      TEXT UNIQUE,
    presupuesto_id TEXT REFERENCES presupuestos(id) ON DELETE SET NULL,
    cliente_nombre TEXT,
    estado      TEXT DEFAULT 'pendiente',
    prioridad   TEXT DEFAULT 'normal',
    fecha_entrega TEXT,
    datos       TEXT NOT NULL,
    creado      TEXT NOT NULL,
    modificado  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS ix_ord_estado ON ordenes(estado);

  CREATE TABLE IF NOT EXISTS piezas (
    id      TEXT PRIMARY KEY,
    nombre  TEXT NOT NULL,
    origen  TEXT,
    datos   TEXT NOT NULL,
    creado  TEXT NOT NULL,
    modificado TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS precios_material (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    material_id TEXT NOT NULL,
    nombre      TEXT,
    precio_kg   REAL NOT NULL,
    tipo_cambio REAL,
    precio_usd  REAL,
    motivo      TEXT,
    fecha       TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS ix_precios_mat ON precios_material(material_id, fecha);

  CREATE TABLE IF NOT EXISTS contadores (
    clave TEXT PRIMARY KEY,
    valor INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS bitacora (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha  TEXT NOT NULL,
    tipo   TEXT NOT NULL,
    entidad TEXT,
    entidad_id TEXT,
    detalle TEXT
  );
  CREATE INDEX IF NOT EXISTS ix_bitacora_fecha ON bitacora(fecha);
  `,

  /* v2 ─ búsqueda de texto completo ------------------------------------- */
  `
  CREATE VIRTUAL TABLE IF NOT EXISTS busqueda USING fts5(
    entidad UNINDEXED, ref UNINDEXED, titulo, cuerpo
  );
  `,

  /* v3 - firma simple de operario en bitacora ---------------------------- */
  `
  ALTER TABLE bitacora ADD COLUMN operario TEXT;
  `,
];

const COLECCIONES = {
  clientes: { tabla: 'clientes', columnas: ['nombre', 'cuit', 'telefono', 'email', 'direccion', 'contacto', 'descuento', 'notas'] },
  presupuestos: { tabla: 'presupuestos' },
  ordenes: { tabla: 'ordenes' },
  piezas: { tabla: 'piezas' },
};

export class DB {
  constructor(dir) {
    this.dir = dir;
    this.backupDir = path.join(dir, 'backups');
    fs.mkdirSync(this.dir, { recursive: true });
    fs.mkdirSync(this.backupDir, { recursive: true });
    this.archivo = path.join(dir, 'kort.db');

    this.db = new Database(this.archivo);
    this.db.run('PRAGMA journal_mode = WAL');
    this.db.run('PRAGMA foreign_keys = ON');
    this.db.run('PRAGMA synchronous = NORMAL');

    this.migrar();
    this.seed();
    this.importarJSONLegado();
    this.backupDiario();
  }

  /* ---------------- Migraciones ---------------- */

  migrar() {
    this.db.run('CREATE TABLE IF NOT EXISTS _version (v INTEGER NOT NULL)');
    const fila = this.db.get('SELECT v FROM _version LIMIT 1');
    let v = fila ? fila.v : 0;
    for (let i = v; i < ESQUEMA.length; i++) {
      this.db.exec(ESQUEMA[i]);
      v = i + 1;
    }
    if (!fila) this.db.run('INSERT INTO _version (v) VALUES (?)', [v]);
    else this.db.run('UPDATE _version SET v = ?', [v]);
    this.version = v;
  }

  cerrar() {
    try {
      this.db.close();
    } catch {}
  }

  /* ---------------- Ajustes (config, materiales, máquinas) ---------------- */

  leer(clave, porDefecto = null) {
    const f = this.db.get('SELECT valor FROM ajustes WHERE clave = ?', [clave]);
    if (!f) {
      if (porDefecto != null) this.escribir(clave, porDefecto);
      return porDefecto;
    }
    try {
      return JSON.parse(f.valor);
    } catch {
      return porDefecto;
    }
  }

  escribir(clave, valor, operario = null) {
    const antes = clave === 'materiales' ? this.leerCrudo('materiales') : null;
    this.db.run(
      `INSERT INTO ajustes (clave, valor, modificado) VALUES (?, ?, ?)
       ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, modificado = excluded.modificado`,
      [clave, JSON.stringify(valor), new Date().toISOString()]
    );
    if (clave === 'materiales') this.registrarCambiosDePrecio(antes, valor);
    this.log('ajuste', clave, null, null, operario);
    return valor;
  }

  leerCrudo(clave) {
    const f = this.db.get('SELECT valor FROM ajustes WHERE clave = ?', [clave]);
    if (!f) return null;
    try {
      return JSON.parse(f.valor);
    } catch {
      return null;
    }
  }

  /**
   * Guarda en el historial cada precio que cambió. Es lo que después permite
   * ver la curva de inflación de la chapa y decidir cuándo hay que
   * actualizar los presupuestos vigentes.
   */
  registrarCambiosDePrecio(antes, ahora, motivo = 'edición manual') {
    if (!Array.isArray(ahora)) return;
    const tc = this.leerCrudo('config')?.comercial?.tipoCambio ?? null;
    const fecha = new Date().toISOString();
    const previos = new Map((antes || []).map((m) => [m.id, m.precioKg]));
    for (const m of ahora) {
      const anterior = previos.get(m.id);
      if (anterior != null && Math.abs(anterior - m.precioKg) < 0.01) continue;
      this.db.run(
        `INSERT INTO precios_material (material_id, nombre, precio_kg, tipo_cambio, precio_usd, motivo, fecha)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [m.id, m.nombre, m.precioKg, tc, tc ? m.precioKg / tc : null, anterior == null ? 'alta' : motivo, fecha]
      );
    }
  }

  /** Serie histórica del precio de un material (o de todos). */
  historialPrecios(materialId = null, limite = 500) {
    if (materialId) {
      return this.db.all(
        'SELECT * FROM precios_material WHERE material_id = ? ORDER BY fecha DESC LIMIT ?',
        [materialId, limite]
      );
    }
    return this.db.all('SELECT * FROM precios_material ORDER BY fecha DESC LIMIT ?', [limite]);
  }

  /** Variación porcentual del precio de cada material en los últimos N días. */
  variacionPrecios(dias = 90) {
    const desde = new Date(Date.now() - dias * 86400000).toISOString();
    return this.db.all(
      `SELECT material_id, nombre,
              MIN(precio_kg) AS minimo, MAX(precio_kg) AS maximo,
              COUNT(*) AS cambios,
              (SELECT precio_kg FROM precios_material p2
                WHERE p2.material_id = p.material_id AND p2.fecha >= ?
                ORDER BY p2.fecha ASC LIMIT 1) AS inicial,
              (SELECT precio_kg FROM precios_material p3
                WHERE p3.material_id = p.material_id
                ORDER BY p3.fecha DESC LIMIT 1) AS actual
         FROM precios_material p
        WHERE fecha >= ?
        GROUP BY material_id
        ORDER BY nombre`,
      [desde, desde]
    ).map((r) => ({
      ...r,
      variacionPct: r.inicial > 0 ? ((r.actual - r.inicial) / r.inicial) * 100 : 0,
    }));
  }

  /* ---------------- Colecciones ---------------- */

  lista(nombre) {
    switch (nombre) {
      case 'clientes':
        return this.db.all('SELECT * FROM clientes ORDER BY nombre');
      case 'presupuestos':
        return this.db.all('SELECT datos FROM presupuestos ORDER BY creado DESC').map((r) => JSON.parse(r.datos));
      case 'ordenes':
        return this.db.all('SELECT datos FROM ordenes ORDER BY creado DESC').map((r) => JSON.parse(r.datos));
      case 'piezas':
        return this.db.all('SELECT datos FROM piezas ORDER BY nombre').map((r) => JSON.parse(r.datos));
      default:
        return [];
    }
  }

  obtener(nombre, id) {
    if (nombre === 'clientes') return this.db.get('SELECT * FROM clientes WHERE id = ?', [id]) || null;
    const tabla = COLECCIONES[nombre]?.tabla;
    if (!tabla) return null;
    const f = this.db.get(`SELECT datos FROM ${tabla} WHERE id = ?`, [id]);
    return f ? JSON.parse(f.datos) : null;
  }

  crear(nombre, obj, operario = null) {
    const ahora = new Date().toISOString();
    const item = { ...obj, id: obj.id || nuevoId(), creado: obj.creado || ahora, modificado: ahora };
    this.guardarFila(nombre, item, true);
    this.log('alta', nombre, item.id, item.numero || item.nombre, operario);
    return item;
  }

  actualizar(nombre, id, cambios, operario = null) {
    const actual = this.obtener(nombre, id);
    if (!actual) return null;
    const item = { ...actual, ...cambios, id, modificado: new Date().toISOString() };
    this.guardarFila(nombre, item, false);
    this.log('modificación', nombre, id, item.numero || item.nombre, operario);
    return item;
  }

  borrar(nombre, id, operario = null) {
    const tabla = COLECCIONES[nombre]?.tabla;
    if (!tabla) return false;
    const antes = this.db.get(`SELECT id FROM ${tabla} WHERE id = ?`, [id]);
    if (!antes) return false;
    this.db.run(`DELETE FROM ${tabla} WHERE id = ?`, [id]);
    this.db.run('DELETE FROM busqueda WHERE ref = ?', [id]);
    this.log('baja', nombre, id, null, operario);
    return true;
  }

  guardarFila(nombre, item, esAlta) {
    const json = JSON.stringify(item);
    const ahora = item.modificado;

    if (nombre === 'clientes') {
      this.db.run(
        `INSERT INTO clientes (id, nombre, cuit, telefono, email, direccion, contacto, descuento, notas, creado, modificado)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET nombre=excluded.nombre, cuit=excluded.cuit, telefono=excluded.telefono,
           email=excluded.email, direccion=excluded.direccion, contacto=excluded.contacto,
           descuento=excluded.descuento, notas=excluded.notas, modificado=excluded.modificado`,
        [item.id, item.nombre || '', item.cuit || '', item.telefono || '', item.email || '',
         item.direccion || '', item.contacto || '', Number(item.descuento) || 0, item.notas || '',
         item.creado, ahora]
      );
      this.indexar('cliente', item.id, item.nombre, [item.cuit, item.email, item.telefono, item.notas].join(' '));
      return;
    }

    if (nombre === 'presupuestos') {
      const r = item.resumen || {};
      this.db.run(
        `INSERT INTO presupuestos (id, numero, fecha, estado, cliente_id, cliente_nombre, total, costo,
            utilidad, peso_total, piezas, chapas, tiempo_prod, tipo_cambio, datos, creado, modificado)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET numero=excluded.numero, fecha=excluded.fecha, estado=excluded.estado,
           cliente_id=excluded.cliente_id, cliente_nombre=excluded.cliente_nombre, total=excluded.total,
           costo=excluded.costo, utilidad=excluded.utilidad, peso_total=excluded.peso_total,
           piezas=excluded.piezas, chapas=excluded.chapas, tiempo_prod=excluded.tiempo_prod,
           tipo_cambio=excluded.tipo_cambio, datos=excluded.datos, modificado=excluded.modificado`,
        [item.id, item.numero || null, item.fecha || item.creado?.slice(0, 10) || null,
         item.estado || 'borrador', item.clienteId || null, item.cliente?.nombre || '',
         r.total || 0, r.costo || 0, r.utilidad || 0, r.pesoTotal || 0, r.piezasTotales || 0,
         r.chapasTotal || 0, r.tiempoProduccion || 0, r.tipoCambio || null, json, item.creado, ahora]
      );
      // Los ítems se guardan también desnormalizados para poder consultarlos
      this.db.run('DELETE FROM presupuesto_items WHERE presupuesto_id = ?', [item.id]);
      (item.items || []).forEach((it, i) => {
        this.db.run(
          `INSERT INTO presupuesto_items (presupuesto_id, orden, nombre, material_id, espesor, gas,
             cantidad, peso_total, largo_corte, precio_neto, costo_total)
           VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          [item.id, i, it.nombre || '', it.materialId || '', it.espesor || 0, it.gas || '',
           it.cantidad || 0, it._pesoTotal || 0, it._largoCorte || 0, it._precioNeto || 0, it._costoTotal || 0]
        );
      });
      this.indexar('presupuesto', item.id, `${item.numero || ''} ${item.cliente?.nombre || ''}`,
        (item.items || []).map((i) => i.nombre).join(' ') + ' ' + (item.notas || ''));
      return;
    }

    if (nombre === 'ordenes') {
      this.db.run(
        `INSERT INTO ordenes (id, numero, presupuesto_id, cliente_nombre, estado, prioridad, fecha_entrega, datos, creado, modificado)
         VALUES (?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET numero=excluded.numero, presupuesto_id=excluded.presupuesto_id,
           cliente_nombre=excluded.cliente_nombre, estado=excluded.estado, prioridad=excluded.prioridad,
           fecha_entrega=excluded.fecha_entrega, datos=excluded.datos, modificado=excluded.modificado`,
        [item.id, item.numero || null, item.presupuestoId || null, item.cliente?.nombre || '',
         item.estado || 'pendiente', item.prioridad || 'normal', item.fechaEntrega || null,
         json, item.creado, ahora]
      );
      this.indexar('orden', item.id, `${item.numero || ''} ${item.cliente?.nombre || ''}`, '');
      return;
    }

    if (nombre === 'piezas') {
      this.db.run(
        `INSERT INTO piezas (id, nombre, origen, datos, creado, modificado) VALUES (?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET nombre=excluded.nombre, origen=excluded.origen,
           datos=excluded.datos, modificado=excluded.modificado`,
        [item.id, item.nombre || '', item.origen || '', json, item.creado, ahora]
      );
      this.indexar('pieza', item.id, item.nombre, item.notas || '');
    }
  }

  indexar(entidad, ref, titulo, cuerpo) {
    this.db.run('DELETE FROM busqueda WHERE ref = ?', [ref]);
    this.db.run('INSERT INTO busqueda (entidad, ref, titulo, cuerpo) VALUES (?,?,?,?)',
      [entidad, ref, titulo || '', cuerpo || '']);
  }

  /** Búsqueda de texto completo sobre todo el sistema. */
  buscar(texto, limite = 40) {
    if (!texto || !texto.trim()) return [];
    const q = texto.trim().replace(/["']/g, '').split(/\s+/).map((t) => `${t}*`).join(' ');
    try {
      return this.db.all(
        `SELECT entidad, ref, titulo, snippet(busqueda, 3, '[', ']', '…', 12) AS extracto
           FROM busqueda WHERE busqueda MATCH ? ORDER BY rank LIMIT ?`,
        [q, limite]
      );
    } catch {
      return [];
    }
  }

  /* ---------------- Numeración ---------------- */

  siguienteNumero(tipo) {
    const anio = new Date().getFullYear();
    const clave = `${tipo}-${anio}`;
    this.db.run('INSERT INTO contadores (clave, valor) VALUES (?, 0) ON CONFLICT(clave) DO NOTHING', [clave]);
    this.db.run('UPDATE contadores SET valor = valor + 1 WHERE clave = ?', [clave]);
    const v = this.db.get('SELECT valor FROM contadores WHERE clave = ?', [clave]).valor;
    return `${anio}-${String(v).padStart(4, '0')}`;
  }

  log(tipo, entidad, entidadId, detalle, operario = null) {
    try {
      this.db.run('INSERT INTO bitacora (fecha, tipo, entidad, entidad_id, detalle, operario) VALUES (?,?,?,?,?,?)',
        [new Date().toISOString(), tipo, entidad || null, entidadId || null, detalle || null, operario || null]);
    } catch {}
  }

  bitacora(limite = 100) {
    return this.db.all('SELECT * FROM bitacora ORDER BY id DESC LIMIT ?', [limite]);
  }

  /* ---------------- Consultas de negocio ---------------- */

  /** Facturación y margen por mes. */
  porMes(meses = 12) {
    return this.db.all(
      `SELECT substr(COALESCE(fecha, creado), 1, 7) AS mes,
              COUNT(*) AS cantidad,
              SUM(total) AS monto,
              SUM(CASE WHEN estado IN ('aprobado','facturado') THEN total ELSE 0 END) AS aprobado,
              SUM(CASE WHEN estado IN ('aprobado','facturado') THEN utilidad ELSE 0 END) AS utilidad
         FROM presupuestos
        GROUP BY mes ORDER BY mes DESC LIMIT ?`,
      [meses]
    ).reverse();
  }

  /** Consumo y facturación por material: para saber qué comprar. */
  porMaterial() {
    return this.db.all(
      `SELECT i.material_id,
              COUNT(DISTINCT i.presupuesto_id) AS presupuestos,
              SUM(i.cantidad)   AS piezas,
              SUM(i.peso_total) AS kg,
              SUM(i.precio_neto) AS facturado
         FROM presupuesto_items i
         JOIN presupuestos p ON p.id = i.presupuesto_id
        WHERE p.estado IN ('aprobado','facturado')
        GROUP BY i.material_id
        ORDER BY facturado DESC`
    );
  }

  /** Ranking de clientes por facturación aprobada. */
  porCliente(limite = 15) {
    return this.db.all(
      `SELECT cliente_nombre AS cliente, COUNT(*) AS presupuestos,
              SUM(total) AS cotizado,
              SUM(CASE WHEN estado IN ('aprobado','facturado') THEN total ELSE 0 END) AS facturado,
              SUM(CASE WHEN estado IN ('aprobado','facturado') THEN utilidad ELSE 0 END) AS utilidad
         FROM presupuestos
        WHERE cliente_nombre <> ''
        GROUP BY cliente_nombre ORDER BY facturado DESC LIMIT ?`,
      [limite]
    );
  }

  estadisticas() {
    const mes = new Date().toISOString().slice(0, 7);
    const uno = (sql, p = []) => this.db.get(sql, p) || {};
    const tot = uno('SELECT COUNT(*) n, COALESCE(SUM(total),0) m FROM presupuestos');
    const delMes = uno("SELECT COUNT(*) n, COALESCE(SUM(total),0) m FROM presupuestos WHERE substr(COALESCE(fecha,creado),1,7) = ?", [mes]);
    const aprob = uno("SELECT COUNT(*) n, COALESCE(SUM(total),0) m, COALESCE(SUM(utilidad),0) u FROM presupuestos WHERE estado IN ('aprobado','facturado')");
    const ord = uno("SELECT COUNT(*) n FROM ordenes WHERE estado NOT IN ('entregado','cancelado')");
    const cli = uno('SELECT COUNT(*) n FROM clientes');

    return {
      presupuestos: tot.n,
      montoTotal: tot.m,
      presupuestosMes: delMes.n,
      montoMes: delMes.m,
      aprobados: aprob.n,
      montoAprobado: aprob.m,
      utilidadAprobada: aprob.u,
      tasaConversion: tot.n ? (aprob.n / tot.n) * 100 : 0,
      ordenesAbiertas: ord.n,
      clientes: cli.n,
      ultimos: this.db.all(
        `SELECT id, numero, cliente_nombre AS cliente, total, estado, COALESCE(fecha, creado) AS fecha
           FROM presupuestos ORDER BY creado DESC LIMIT 8`
      ),
      porEstado: Object.fromEntries(
        this.db.all('SELECT estado, COUNT(*) n FROM presupuestos GROUP BY estado').map((r) => [r.estado, r.n])
      ),
      porMes: this.porMes(12),
      porMaterial: this.porMaterial(),
      porCliente: this.porCliente(8),
    };
  }

  /* ---------------- Datos iniciales y migración ---------------- */

  seed() {
    if (!this.leerCrudo('config')) this.escribir('config', DEFAULT_CONFIG);
    if (!this.leerCrudo('materiales')) this.escribir('materiales', DEFAULT_MATERIALS);
    if (!this.leerCrudo('maquinas')) this.escribir('maquinas', [DEFAULT_MACHINE, DEFAULT_PLEGADORA]);
  }

  /**
   * Si existen los JSON de la versión anterior, se importan una sola vez y
   * se mueven a data/legado/. Nadie pierde nada al actualizar.
   */
  importarJSONLegado() {
    if (this.leerCrudo('_importado_json')) return;
    const legado = path.join(this.dir, 'legado');
    let algo = false;

    const cargar = (nombre) => {
      const f = path.join(this.dir, `${nombre}.json`);
      if (!fs.existsSync(f)) return null;
      try {
        return JSON.parse(fs.readFileSync(f, 'utf8'));
      } catch {
        return null;
      }
    };

    for (const col of ['clientes', 'presupuestos', 'ordenes', 'piezas']) {
      const datos = cargar(col);
      if (!Array.isArray(datos) || !datos.length) continue;
      for (const item of datos) {
        try {
          this.guardarFila(col, { ...item, id: item.id || nuevoId(), creado: item.creado || new Date().toISOString(), modificado: new Date().toISOString() }, true);
          algo = true;
        } catch {}
      }
    }
    // Los materiales y máquinas de la versión anterior tienen otro formato
    // (tabla única de velocidades en vez de una por gas, overhead fijo en vez
    // de estructura). Importarlos tal cual rompería el motor de corte, así
    // que se conserva SÓLO lo que el taller cargó a mano: precios, medidas de
    // chapa, valores de equipo. Las tablas técnicas quedan en las nuevas.
    const matLegado = cargar('materiales');
    if (Array.isArray(matLegado) && matLegado.length) {
      this.escribir('materiales', fusionarMateriales(this.leerCrudo('materiales'), matLegado));
      algo = true;
    }
    const maqLegado = cargar('maquinas');
    if (Array.isArray(maqLegado) && maqLegado.length) {
      this.escribir('maquinas', fusionarMaquinas(this.leerCrudo('maquinas'), maqLegado));
      algo = true;
    }
    const cfgLegado = cargar('config');
    if (cfgLegado) {
      this.escribir('config', fusionarConfig(this.leerCrudo('config'), cfgLegado));
      algo = true;
    }
    const cont = cargar('contadores');
    if (cont && typeof cont === 'object') {
      for (const [k, v] of Object.entries(cont)) {
        this.db.run('INSERT INTO contadores (clave, valor) VALUES (?,?) ON CONFLICT(clave) DO UPDATE SET valor = MAX(valor, excluded.valor)', [k, Number(v) || 0]);
      }
      algo = true;
    }

    if (algo) {
      fs.mkdirSync(legado, { recursive: true });
      for (const n of ['clientes', 'presupuestos', 'ordenes', 'piezas', 'config', 'materiales', 'maquinas', 'contadores']) {
        const f = path.join(this.dir, `${n}.json`);
        if (fs.existsSync(f)) {
          try {
            fs.renameSync(f, path.join(legado, `${n}.json`));
          } catch {}
        }
      }
      this.log('migración', 'json', null, 'importados los datos de la versión anterior');
    }
    this.escribir('_importado_json', { fecha: new Date().toISOString(), importo: algo });
  }

  /** Copia del archivo .db una vez por día, se conservan las últimas 30. */
  backupDiario() {
    const dia = new Date().toISOString().slice(0, 10);
    const destino = path.join(this.backupDir, `kort.${dia}.db`);
    if (fs.existsSync(destino)) return;
    try {
      this.db.run('PRAGMA wal_checkpoint(TRUNCATE)');
      fs.copyFileSync(this.archivo, destino);
      const viejos = fs.readdirSync(this.backupDir).filter((f) => f.startsWith('kort.') && f.endsWith('.db')).sort();
      while (viejos.length > 30) fs.unlinkSync(path.join(this.backupDir, viejos.shift()));
    } catch {}
  }

  /* ---------------- Respaldo completo ---------------- */

  exportarTodo() {
    return {
      version: this.version,
      motor: 'sqlite',
      exportado: new Date().toISOString(),
      config: this.leerCrudo('config'),
      materiales: this.leerCrudo('materiales'),
      maquinas: this.leerCrudo('maquinas'),
      clientes: this.lista('clientes'),
      presupuestos: this.lista('presupuestos'),
      ordenes: this.lista('ordenes'),
      piezas: this.lista('piezas'),
      contadores: Object.fromEntries(this.db.all('SELECT clave, valor FROM contadores').map((r) => [r.clave, r.valor])),
      historialPrecios: this.historialPrecios(null, 5000),
    };
  }

  importarTodo(data) {
    this.db.run('BEGIN');
    try {
      for (const t of ['presupuesto_items', 'presupuestos', 'ordenes', 'piezas', 'clientes', 'busqueda']) {
        this.db.run(`DELETE FROM ${t}`);
      }
      for (const doc of ['config', 'materiales', 'maquinas']) {
        if (data[doc]) this.escribir(doc, data[doc]);
      }
      for (const col of ['clientes', 'presupuestos', 'ordenes', 'piezas']) {
        for (const item of data[col] || []) {
          this.guardarFila(col, {
            ...item,
            id: item.id || nuevoId(),
            creado: item.creado || new Date().toISOString(),
            modificado: new Date().toISOString(),
          }, true);
        }
      }
      for (const [k, v] of Object.entries(data.contadores || {})) {
        this.db.run('INSERT INTO contadores (clave, valor) VALUES (?,?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor', [k, Number(v) || 0]);
      }
      for (const h of data.historialPrecios || []) {
        this.db.run(
          'INSERT INTO precios_material (material_id, nombre, precio_kg, tipo_cambio, precio_usd, motivo, fecha) VALUES (?,?,?,?,?,?,?)',
          [h.material_id, h.nombre, h.precio_kg, h.tipo_cambio, h.precio_usd, h.motivo, h.fecha]
        );
      }
      this.db.run('COMMIT');
      this.log('restauración', 'respaldo', null, 'importado un respaldo completo');
      return true;
    } catch (e) {
      this.db.run('ROLLBACK');
      throw e;
    }
  }
}

/**
 * Fusión profunda para guardar configuración sin perder lo que no vino.
 *
 * Los arreglos se reemplazan enteros: una lista de acabados editada es la
 * lista nueva, no una mezcla con la vieja.
 */
export function fusionarProfundo(base, encima) {
  if (Array.isArray(encima)) return encima;
  if (!encima || typeof encima !== 'object') return encima;
  const out = { ...(base && typeof base === 'object' && !Array.isArray(base) ? base : {}) };
  for (const [k, v] of Object.entries(encima)) {
    if (v === undefined) continue;
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? fusionarProfundo(out[k], v) : v;
  }
  return out;
}

export function nuevoId() {
  return Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e9).toString(36);
}

/* ------------------------------------------------------------------ */
/* Migración desde el formato anterior                                 */
/* ------------------------------------------------------------------ */

/** ¿Es un material del formato viejo (tabla única de velocidades)? */
function esFormatoViejo(m) {
  return !!m && !m.procesos && !!m.speeds;
}

/**
 * Conserva del material viejo lo que cargó el usuario (precio, medidas de
 * chapa, espesores que realmente compra, notas) y descarta las tablas
 * técnicas obsoletas, que ahora van por gas.
 */
export function fusionarMateriales(nuevos, viejos) {
  const porId = new Map((viejos || []).map((m) => [m.id, m]));
  const salida = (nuevos || []).map((n) => {
    const v = porId.get(n.id);
    if (!v) return n;
    porId.delete(n.id);
    const m = { ...n };
    if (typeof v.precioKg === 'number' && v.precioKg > 0) m.precioKg = v.precioKg;
    if (v.chapaStd?.w && v.chapaStd?.h) m.chapaStd = v.chapaStd;
    if (typeof v.activo === 'boolean') m.activo = v.activo;
    if (v.notas && v.notas !== n.notas) m.notas = v.notas;
    // Sólo se aceptan espesores que la nueva tabla pueda cortar de verdad
    if (Array.isArray(v.espesores) && v.espesores.length) {
      const permitidos = new Set(n.espesores);
      const filtrados = v.espesores.filter((e) => permitidos.has(e));
      if (filtrados.length) m.espesores = filtrados;
    }
    return m;
  });
  // Materiales que el usuario había creado y que no existen en la base nueva:
  // se conservan sólo si ya venían en formato nuevo.
  for (const v of porId.values()) if (!esFormatoViejo(v)) salida.push(v);
  return salida;
}

/**
 * Las máquinas cambian de modelo de costo: desaparece `overheadHora` (ahora
 * es la estructura del taller) y aparecen `dedicacionOperario` y
 * `participacionEstructura`.
 */
export function fusionarMaquinas(nuevas, viejas) {
  const porTipo = new Map((viejas || []).map((m) => [m.tipo, m]));
  return (nuevas || []).map((n) => {
    const v = porTipo.get(n.tipo);
    if (!v) return n;
    const m = { ...n, costo: { ...n.costo } };
    // Parámetros técnicos que el taller haya calibrado
    for (const k of ['nombre', 'potenciaKW', 'aceleracion', 'velocidadRapida', 'desviacionUnion',
      'entradaMM', 'eficiencia', 'tiempoCargaChapa', 'tiempoSetupPrograma', 'tiempoDescarga',
      'areaTrabajo', 'toneladas', 'largoUtil', 'ejes', 'tiempoSetupHerramienta', 'tiempoPorPliegue']) {
      if (v[k] != null) m[k] = v[k];
    }
    // Componentes del costo que siguen significando lo mismo
    for (const k of ['valorEquipo', 'vidaUtilHoras', 'consumoKW', 'costoKWh',
      'mantenimientoHora', 'consumiblesHora', 'operarioHora']) {
      if (v.costo?.[k] != null) m.costo[k] = v.costo[k];
    }
    return m;
  });
}

/** Config: se parte de la nueva y se pisan sólo las claves que existían. */
export function fusionarConfig(nueva, vieja) {
  const out = JSON.parse(JSON.stringify(nueva));
  const mezclar = (destino, origen) => {
    for (const [k, v] of Object.entries(origen || {})) {
      if (v == null) continue;
      if (Array.isArray(v)) destino[k] = v;
      else if (typeof v === 'object') {
        destino[k] = destino[k] && typeof destino[k] === 'object' ? destino[k] : {};
        mezclar(destino[k], v);
      } else if (k in destino || destino[k] === undefined) destino[k] = v;
    }
  };
  mezclar(out.empresa, vieja.empresa);
  mezclar(out.comercial, vieja.comercial);
  if (vieja.produccion) {
    out.produccion.separacionPiezas = vieja.produccion.separacionPiezas ?? out.produccion.separacionPiezas;
    out.produccion.margenChapa = vieja.produccion.margenChapa ?? out.produccion.margenChapa;
    // Los precios de gas viejos no se traen: el modelo de consumo cambió y
    // arrastrarlos daría costos de nitrógeno equivocados.
  }
  if (Array.isArray(vieja.acabados) && vieja.acabados.length) out.acabados = vieja.acabados;
  if (Array.isArray(vieja.procesos) && vieja.procesos.length) out.procesos = vieja.procesos;
  if (vieja.textos) out.textos = vieja.textos;
  // La estructura es nueva: si el usuario no la tenía, se queda la de fábrica
  if (vieja.estructura) mezclar(out.estructura, vieja.estructura);
  return out;
}
