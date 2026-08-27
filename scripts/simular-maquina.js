/**
 * Emulador de un adaptador de máquina. No toca el CNC: publica el mismo
 * contrato que en producción entregará OPC UA, MTConnect o la API del OEM.
 */

const base = process.env.KORT_URL || 'http://localhost:4321';
const token = process.env.KORT_MACHINE_TOKEN || '';
let progreso = 0;
let tick = 0;

/* Un recorrido con forma de nesting real: seis piezas en dos filas, cada una
   con su contorno y un agujero, y los rápidos entre pieza y pieza. Existe
   para poder VERIFICAR el visor de recorrido sin la máquina — no para que
   parezca que hay una máquina conectada. Todas las muestras van estampadas
   con `fuente: 'simulador-kort'` y el tablero lo muestra. */
function piezasDelNesting() {
  const puntos = [];
  const anchoPieza = 380, altoPieza = 260, sep = 60;
  for (let fila = 0; fila < 2; fila++) {
    for (let col = 0; col < 3; col++) {
      const x0 = 200 + col * (anchoPieza + sep);
      const y0 = 250 + fila * (altoPieza + sep);
      // Rápido hasta la entrada, sin emitir.
      puntos.push({ x: x0, y: y0, cortando: false });
      // Agujero central primero, como lo haría el CAM.
      const cx = x0 + anchoPieza / 2, cy = y0 + altoPieza / 2, r = 45;
      for (let a = 0; a <= 12; a++) {
        const t = (a / 12) * Math.PI * 2;
        puntos.push({ x: cx + r * Math.cos(t), y: cy + r * Math.sin(t), cortando: true });
      }
      puntos.push({ x: x0, y: y0, cortando: false });
      // Y después el contorno exterior.
      for (const [dx, dy] of [[0,0],[anchoPieza,0],[anchoPieza,altoPieza],[0,altoPieza],[0,0]]) {
        puntos.push({ x: x0 + dx, y: y0 + dy, cortando: true });
      }
    }
  }
  return puntos;
}
const RECORRIDO = piezasDelNesting();

console.log(`Simulando láser 3 kW contra ${base}. Cortá con Ctrl+C.`);

async function enviar() {
  tick++;
  const ciclo = tick % 95;
  let estado = 'produciendo';
  if (ciclo < 8) estado = 'preparando';
  else if (ciclo > 80 && ciclo < 86) estado = 'pausada';
  else if (ciclo >= 86) estado = 'inactiva';
  if (estado === 'produciendo') progreso = Math.min(100, progreso + 1.35);
  if (ciclo === 0) progreso = 0;

  const cortando = estado === 'produciendo';
  const paso = RECORRIDO[tick % RECORRIDO.length];
  const muestra = {
    maquinaId: 'laser-3kw', estado, modo: 'automático', programa: 'NEST-ACERO-12MM-0042',
    ordenId: '2026-0042', progreso,
    potenciaPct: cortando ? 58 + Math.sin(tick / 3) * 24 : 0,
    velocidadMMMin: cortando ? 7200 + Math.sin(tick / 5) * 850 : 0,
    gas: 'O2', piezasBuenas: Math.floor(progreso / 10), piezasRechazadas: 0,
    fuente: 'simulador-kort',
    posicion: cortando
      ? { x: paso.x, y: paso.y, z: 1.2 }
      // Con la máquina parada el cabezal sigue en algún lado: la posición no
      // desaparece porque el haz esté apagado.
      : { x: paso.x, y: paso.y, z: 40 },
    laser: {
      potenciaW: cortando && paso.cortando ? Math.round(3000 * (0.58 + Math.sin(tick / 3) * 0.24)) : 0,
      tempC: 26 + Math.sin(tick / 40) * 2.5,
      horasEncendida: 1180 + tick / 3600,
      horasEmitiendo: 412 + tick / 7200,
      alarma: null,
    },
  };
  const res = await fetch(`${base}/api/telemetria`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { 'X-KORT-Machine-Token': token } : {}) },
    body: JSON.stringify(muestra),
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 160)}`);
  process.stdout.write(`\r${estado.padEnd(12)} ${progreso.toFixed(0).padStart(3)} % · ${muestra.velocidadMMMin.toFixed(0)} mm/min   `);
}

setInterval(() => enviar().catch((e) => process.stderr.write(`\nNo se pudo enviar: ${e.message}\n`)), 1000);
enviar().catch((e) => console.error(`No se pudo iniciar: ${e.message}`));
