/**
 * Emulador de un adaptador de máquina. No toca el CNC: publica el mismo
 * contrato que en producción entregará OPC UA, MTConnect o la API del OEM.
 */

const base = process.env.KORT_URL || 'http://localhost:4321';
const token = process.env.KORT_MACHINE_TOKEN || '';
let progreso = 0;
let tick = 0;

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
  const muestra = {
    maquinaId: 'laser-3kw', estado, modo: 'automático', programa: 'NEST-ACERO-12MM-0042',
    ordenId: '2026-0042', progreso,
    potenciaPct: cortando ? 58 + Math.sin(tick / 3) * 24 : 0,
    velocidadMMMin: cortando ? 7200 + Math.sin(tick / 5) * 850 : 0,
    gas: 'O2', piezasBuenas: Math.floor(progreso / 10), piezasRechazadas: 0,
    fuente: 'simulador-kort',
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
