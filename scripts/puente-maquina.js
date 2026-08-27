/**
 * KORT · Puente Modbus TCP → telemetría
 *
 * Lee registros de un equipo por Modbus TCP y publica el contrato canónico de
 * KORT (`kort.telemetria.v2`) contra `/api/telemetria`.
 *
 * ── SÓLO LECTURA, y de verdad ──────────────────────────────────────────────
 *
 * Este puente implementa **únicamente** los códigos de función 3 y 4 (leer
 * registros). Los códigos de escritura —5, 6, 15, 16— no están escritos en
 * ninguna parte de este archivo, así que no hay forma de que un error de
 * configuración termine escribiendo un registro de una fuente láser. Es una
 * garantía estructural y no una promesa en un comentario: revisá el código.
 *
 * ── Por qué Modbus y no otra cosa ──────────────────────────────────────────
 *
 * Las fuentes de fibra (Max Photonics, Raycus, IPG) exponen su estado por
 * Modbus RTU sobre RS-485 o Modbus TCP sobre Ethernet, según el modelo. Es el
 * bus más accesible de la máquina y el único que se puede pinchar sin tocar
 * el lazo de control. El CNC —posición del cabezal, programa, avance— suele
 * hablar otro protocolo; para eso está el mismo contrato con otro adaptador.
 *
 * ⚠️ **Este archivo NO trae direcciones de registro.** El mapa lo define el
 * fabricante y cambia entre modelos y hasta entre versiones de firmware:
 * inventarlo daría lecturas plausibles y falsas, que es peor que no leer
 * nada. Las direcciones están en el manual de la fuente y se cargan en el
 * archivo de configuración.
 *
 * ── Uso ────────────────────────────────────────────────────────────────────
 *
 *   node scripts/puente-maquina.js puente-maquina.json
 *
 * El archivo de configuración se genera con:
 *
 *   node scripts/puente-maquina.js --ejemplo > puente-maquina.json
 *
 * Para explorar registros sin publicar nada (útil para encontrar cuál es cuál
 * comparando contra la pantalla del equipo):
 *
 *   node scripts/puente-maquina.js puente-maquina.json --leer 0 40
 */

import net from 'node:net';
import fs from 'node:fs';

/* ------------------------------------------------------------------ */
/* Modbus TCP, mínimo y de sólo lectura                                */
/* ------------------------------------------------------------------ */

const FUNCION = { holding: 3, input: 4 };

class ModbusTCP {
  constructor({ host, puerto = 502, unidad = 1, timeoutMs = 3000 }) {
    Object.assign(this, { host, puerto, unidad, timeoutMs });
    this.sock = null;
    this.transaccion = 0;
  }

  conectar() {
    return new Promise((resolve, reject) => {
      const s = new net.Socket();
      s.setNoDelay(true);
      const alFallar = (e) => { s.destroy(); reject(e); };
      s.once('error', alFallar);
      s.setTimeout(this.timeoutMs, () => alFallar(new Error('timeout al conectar')));
      s.connect(this.puerto, this.host, () => {
        s.setTimeout(0);
        s.off('error', alFallar);
        s.on('error', () => { /* se maneja por operación */ });
        this.sock = s;
        resolve();
      });
    });
  }

  cerrar() {
    if (this.sock) { this.sock.destroy(); this.sock = null; }
  }

  /** Lee `cantidad` registros de 16 bits. Devuelve un Buffer. */
  leer(tipo, direccion, cantidad) {
    const fn = FUNCION[tipo];
    if (!fn) throw new Error(`Tipo de registro desconocido: ${tipo}`);
    if (cantidad < 1 || cantidad > 125) throw new Error('Modbus lee entre 1 y 125 registros por vez');

    return new Promise((resolve, reject) => {
      if (!this.sock) return reject(new Error('sin conexión'));
      const tid = (this.transaccion = (this.transaccion + 1) & 0xffff);

      const pedido = Buffer.alloc(12);
      pedido.writeUInt16BE(tid, 0);      // transacción
      pedido.writeUInt16BE(0, 2);        // protocolo (0 = Modbus)
      pedido.writeUInt16BE(6, 4);        // largo del resto
      pedido.writeUInt8(this.unidad, 6);
      pedido.writeUInt8(fn, 7);
      pedido.writeUInt16BE(direccion, 8);
      pedido.writeUInt16BE(cantidad, 10);

      let acumulado = Buffer.alloc(0);
      const limpiar = () => {
        clearTimeout(reloj);
        this.sock?.off('data', alRecibir);
        this.sock?.off('error', alError);
      };
      const alError = (e) => { limpiar(); reject(e); };
      const reloj = setTimeout(() => { limpiar(); reject(new Error('timeout de lectura')); }, this.timeoutMs);

      const alRecibir = (chunk) => {
        acumulado = Buffer.concat([acumulado, chunk]);
        // Cabecera MBAP: 6 bytes + el largo declarado.
        while (acumulado.length >= 6) {
          const largo = acumulado.readUInt16BE(4);
          if (acumulado.length < 6 + largo) return;
          const marco = acumulado.subarray(0, 6 + largo);
          acumulado = acumulado.subarray(6 + largo);
          if (marco.readUInt16BE(0) !== tid) continue; // respuesta de otro pedido
          const funcion = marco.readUInt8(7);
          if (funcion & 0x80) {
            limpiar();
            return reject(new Error(`excepción Modbus ${marco.readUInt8(8)} (función ${funcion & 0x7f})`));
          }
          const bytes = marco.readUInt8(8);
          limpiar();
          return resolve(marco.subarray(9, 9 + bytes));
        }
      };

      this.sock.on('data', alRecibir);
      this.sock.once('error', alError);
      this.sock.write(pedido);
    });
  }
}

/* ------------------------------------------------------------------ */
/* Decodificación                                                      */
/* ------------------------------------------------------------------ */

/**
 * ⚠️ El orden de palabras de un valor de 32 bits NO está en el estándar
 * Modbus, y los fabricantes eligen distinto. Si un contador de horas da un
 * número absurdo (millones), es esto: probá con `"palabras": "menor-primero"`.
 * Un valor mal decodificado se ve perfectamente creíble, por eso es lo primero
 * que hay que revisar.
 */
export function decodificar(buf, desplazamiento, campo) {
  const tipo = campo.tipo || 'uint16';
  const invertir = (campo.palabras || 'mayor-primero') === 'menor-primero';
  const o = desplazamiento * 2;

  const leer32 = (metodo) => {
    if (!invertir) return buf[metodo](o);
    const b = Buffer.alloc(4);
    buf.copy(b, 0, o + 2, o + 4);
    buf.copy(b, 2, o, o + 2);
    return b[metodo](0);
  };

  let crudo;
  switch (tipo) {
    case 'uint16': crudo = buf.readUInt16BE(o); break;
    case 'int16': crudo = buf.readInt16BE(o); break;
    case 'uint32': crudo = leer32('readUInt32BE'); break;
    case 'int32': crudo = leer32('readInt32BE'); break;
    case 'float32': crudo = leer32('readFloatBE'); break;
    default: throw new Error(`Tipo desconocido: ${tipo}`);
  }
  const escala = typeof campo.escala === 'number' ? campo.escala : 1;
  return crudo * escala;
}

/** Cuántos registros ocupa un campo. */
export const anchoDe = (campo) => (/32$/.test(campo.tipo || 'uint16') ? 2 : 1);

/* ------------------------------------------------------------------ */
/* Configuración                                                       */
/* ------------------------------------------------------------------ */

const EJEMPLO = {
  _leeme: [
    'Las direcciones de registro las define el fabricante: sacalas del manual',
    'de TU fuente y de TU control. Este archivo no trae ninguna a propósito —',
    'una dirección inventada devuelve un número creíble y falso.',
    '',
    'Cada campo: { registro, tipo, escala, palabras, fn }',
    '  tipo    uint16 | int16 | uint32 | int32 | float32   (por defecto uint16)',
    '  escala  multiplicador (0.1 si el equipo manda décimas)',
    '  palabras  mayor-primero | menor-primero  (sólo para los de 32 bits)',
    '  fn      holding (código 3, por defecto) | input (código 4)',
  ],
  kort: { url: 'http://localhost:4321', token: '' },
  maquinaId: 'laser-3kw',
  intervaloMs: 1000,
  modbus: { host: '192.168.1.50', puerto: 502, unidad: 1, timeoutMs: 3000 },
  campos: {
    'laser.potenciaW': { registro: null, tipo: 'uint16', escala: 1 },
    'laser.tempC': { registro: null, tipo: 'int16', escala: 0.1 },
    'laser.horasEncendida': { registro: null, tipo: 'uint32', escala: 1 },
    'laser.horasEmitiendo': { registro: null, tipo: 'uint32', escala: 1 },
    'posicion.x': { registro: null, tipo: 'int32', escala: 0.001 },
    'posicion.y': { registro: null, tipo: 'int32', escala: 0.001 },
    'posicion.z': { registro: null, tipo: 'int32', escala: 0.001 },
    'velocidadMMMin': { registro: null, tipo: 'uint32', escala: 1 },
    'potenciaPct': { registro: null, tipo: 'uint16', escala: 1 },
  },
  /* El estado sale de un registro cuyo valor se traduce a los estados que
     entiende KORT. Si el equipo no informa estado, se deduce de la potencia:
     con potencia óptica > 0 está produciendo. */
  estado: { registro: null, mapa: { 0: 'inactiva', 1: 'produciendo', 2: 'pausada', 3: 'alarma' } },
};

function cargarConfig(ruta) {
  const cfg = JSON.parse(fs.readFileSync(ruta, 'utf8'));
  const campos = Object.entries(cfg.campos || {})
    .filter(([, c]) => c && Number.isInteger(c.registro))
    .map(([nombre, c]) => ({ nombre, ...c }));

  if (!campos.length) {
    throw new Error(
      `No hay ningún campo con dirección de registro en ${ruta}.\n` +
      'Cargá las direcciones del manual de tu equipo: sin eso este puente no tiene qué leer,\n' +
      'y publicar ceros sería peor que no publicar nada.'
    );
  }
  return { ...cfg, campos };
}

/* ------------------------------------------------------------------ */
/* Publicación                                                         */
/* ------------------------------------------------------------------ */

export function armarMuestra(valores, cfg) {
  const en = (ruta) => valores[ruta];
  const bloque = (prefijo, claves) => {
    const o = {};
    let hay = false;
    for (const k of claves) {
      const v = en(`${prefijo}.${k}`);
      // undefined = ese registro no está configurado. Va null y NUNCA 0: cero
      // es una lectura válida y confundirlas dibuja una máquina que no existe.
      o[k] = v === undefined ? null : v;
      if (v !== undefined) hay = true;
    }
    return hay ? o : null;
  };

  const potencia = en('laser.potenciaW');
  const estado =
    valores._estado ||
    (potencia === undefined ? 'inactiva' : potencia > 0 ? 'produciendo' : 'inactiva');

  return {
    maquinaId: cfg.maquinaId || 'laser-3kw',
    estado,
    fuente: 'modbus',
    potenciaPct: en('potenciaPct'),
    velocidadMMMin: en('velocidadMMMin'),
    posicion: bloque('posicion', ['x', 'y', 'z']),
    laser: bloque('laser', ['potenciaW', 'tempC', 'horasEncendida', 'horasEmitiendo']),
  };
}

async function publicar(muestra, cfg) {
  const base = cfg.kort?.url || 'http://localhost:4321';
  const token = process.env.KORT_MACHINE_TOKEN || cfg.kort?.token || '';
  const res = await fetch(`${base}/api/telemetria`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { 'X-KORT-Machine-Token': token } : {}) },
    body: JSON.stringify(muestra),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
}

/* ------------------------------------------------------------------ */
/* Programa                                                            */
/* ------------------------------------------------------------------ */

async function leerTodo(cliente, campos, estadoCfg) {
  const valores = {};
  /* Una lectura por campo. Es más lento que agrupar en bloques contiguos,
     pero un rango que cruza un registro reservado hace que algunos equipos
     devuelvan excepción para TODO el bloque, y ahí se pierden también los
     campos que sí andaban. A 1 Hz sobra el tiempo. */
  for (const c of campos) {
    try {
      const buf = await cliente.leer(c.fn || 'holding', c.registro, anchoDe(c));
      valores[c.nombre] = decodificar(buf, 0, c);
    } catch (e) {
      // Se informa y se sigue: que un registro falle no puede dejar sin
      // publicar los otros ocho.
      process.stderr.write(`\n[${c.nombre}] registro ${c.registro}: ${e.message}\n`);
    }
  }

  if (estadoCfg && Number.isInteger(estadoCfg.registro)) {
    try {
      const buf = await cliente.leer(estadoCfg.fn || 'holding', estadoCfg.registro, 1);
      const crudo = buf.readUInt16BE(0);
      valores._estado = estadoCfg.mapa?.[crudo] || estadoCfg.mapa?.[String(crudo)] || null;
    } catch (e) {
      process.stderr.write(`\n[estado] registro ${estadoCfg.registro}: ${e.message}\n`);
    }
  }
  return valores;
}

async function explorar(cliente, desde, cantidad) {
  console.log(`Leyendo ${cantidad} registros desde ${desde}. NO se publica nada.\n`);
  const buf = await cliente.leer('holding', desde, cantidad);
  for (let i = 0; i < cantidad; i++) {
    const u16 = buf.readUInt16BE(i * 2);
    const linea = [
      String(desde + i).padStart(6),
      String(u16).padStart(7),
      `0x${u16.toString(16).padStart(4, '0')}`,
    ];
    if (i + 1 < cantidad) {
      linea.push(`u32(mayor)=${String(buf.readUInt32BE(i * 2)).padStart(12)}`);
      const b = Buffer.alloc(4);
      buf.copy(b, 0, i * 2 + 2, i * 2 + 4);
      buf.copy(b, 2, i * 2, i * 2 + 2);
      linea.push(`u32(menor)=${String(b.readUInt32BE(0)).padStart(12)}`);
    }
    console.log(linea.join('  '));
  }
  console.log('\nCompará contra lo que muestra la pantalla del equipo para saber cuál es cuál.');
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--ejemplo')) {
    console.log(JSON.stringify(EJEMPLO, null, 2));
    return;
  }

  const ruta = args.find((a) => !a.startsWith('--'));
  if (!ruta) {
    console.error(
      'Uso:\n' +
      '  node scripts/puente-maquina.js --ejemplo > puente-maquina.json\n' +
      '  node scripts/puente-maquina.js puente-maquina.json\n' +
      '  node scripts/puente-maquina.js puente-maquina.json --leer 0 40\n'
    );
    process.exit(1);
  }

  const iLeer = args.indexOf('--leer');
  const soloLeer = iLeer >= 0;
  const cfg = soloLeer
    ? JSON.parse(fs.readFileSync(ruta, 'utf8'))
    : cargarConfig(ruta);

  const cliente = new ModbusTCP(cfg.modbus || {});
  await cliente.conectar();
  console.log(`Conectado a ${cfg.modbus.host}:${cfg.modbus.puerto || 502} (unidad ${cfg.modbus.unidad ?? 1}).`);

  if (soloLeer) {
    await explorar(cliente, Number(args[iLeer + 1] || 0), Number(args[iLeer + 2] || 20));
    cliente.cerrar();
    return;
  }

  console.log(`Publicando ${cfg.campos.length} campos cada ${cfg.intervaloMs || 1000} ms. Ctrl+C para cortar.\n`);
  const cerrar = () => { cliente.cerrar(); process.exit(0); };
  process.on('SIGINT', cerrar);
  process.on('SIGTERM', cerrar);

  const tick = async () => {
    try {
      const valores = await leerTodo(cliente, cfg.campos, cfg.estado);
      const muestra = armarMuestra(valores, cfg);
      await publicar(muestra, cfg);
      const p = muestra.posicion;
      process.stdout.write(
        `\r${muestra.estado.padEnd(12)}` +
        `${p ? ` X${(p.x ?? 0).toFixed(0).padStart(6)} Y${(p.y ?? 0).toFixed(0).padStart(6)}` : ''}` +
        `${muestra.laser?.potenciaW != null ? ` ${String(Math.round(muestra.laser.potenciaW)).padStart(5)} W` : ''}` +
        `${muestra.laser?.tempC != null ? ` ${muestra.laser.tempC.toFixed(1)} °C` : ''}   `
      );
    } catch (e) {
      process.stderr.write(`\nNo se pudo publicar: ${e.message}\n`);
    }
  };

  await tick();
  setInterval(tick, Math.max(200, cfg.intervaloMs || 1000));
}

/* Sólo corre si se lo invocó directamente. Sin esta guarda, importarlo desde
   un test abriría un socket contra la máquina del taller. */
const invocadoDirecto =
  process.argv[1] && /puente-maquina\.js$/.test(process.argv[1].replace(/\\/g, '/'));

if (invocadoDirecto) {
  main().catch((e) => {
    console.error(`\n${e.message}`);
    process.exit(1);
  });
}
