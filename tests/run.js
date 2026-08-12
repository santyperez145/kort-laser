/**
 * KORT - Suite de verificación del núcleo
 *
 * Comprueba que los cálculos den los valores correctos: geometría, tiempos de
 * corte, desarrollo de plegado, nesting, DXF de ida y vuelta, precios y PDF.
 *
 *   node tests/run.js
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  rect, circle, slot, polyline, makeShape, shapeArea, shapeCutLength,
  shapeBBox, shapePiercings, pathLength, pathArea, regularPolygon, TAU, rad,
  makeShapeMulti, partesDe, esMultiParte,
} from '../src/core/geometry.js';
import {
  DEFAULT_MATERIALS, interpTable, cuttingSpeed, pesoKg, findMaterial, GASES,
  gasRecomendado, gasesDisponibles, gasFlow, compararGases, proceso, espesorMaximo, boquilla,
} from '../src/core/materials.js';
import { tiempoCortePieza, tiempoCorteLote, recorridoRapido, DEFAULT_MACHINE, DEFAULT_PLEGADORA, calcularCostoHora, fmtTiempo } from '../src/core/cutting.js';
import {
  calcularEstructura, calcularCostoHoraMaquina, costoHoraOperario, puntoEquilibrio,
  evaluarGeneradorN2, revisarCostoHora, DEFAULT_ESTRUCTURA, TARIFAS_EDELAR, UOM_RAMA17,
  CARGAS_LABORALES,
} from '../src/core/costos.js';
import { calcularPliegue, calcularDesarrollo, matrizRecomendada, validarPlegado, tiempoPlegado } from '../src/core/bending.js';
import { nest, piezasPorChapa, compararMetodos, rellenoSinCosto } from '../src/core/nesting.js';
import { generarDXF } from '../src/core/dxf-write.js';
import { leerDXF } from '../src/core/dxf-read.js';
import { cotizarItem, cotizarPresupuesto, planificarNesting, DEFAULT_CONFIG, redondear, descuentoPorCantidad } from '../src/core/pricing.js';
import { construir, PIEZAS, paramsPorDefecto } from '../src/core/library.js';
import { revisarDatos } from '../src/core/salud.js';
import { construirMesh } from '../src/core/mesh3d.js';
import { PDF, anchoTexto } from '../src/core/pdf.js';
import { generarPresupuestoPDF } from '../src/core/quote-pdf.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let ok = 0;
let fallos = 0;
const errores = [];

function test(nombre, fn) {
  try {
    fn();
    ok++;
    console.log(`  \x1b[32m✓\x1b[0m ${nombre}`);
  } catch (e) {
    fallos++;
    errores.push({ nombre, e });
    console.log(`  \x1b[31m✗\x1b[0m ${nombre}`);
    console.log(`      ${e.message.split('\n')[0]}`);
  }
}

function grupo(t) {
  console.log(`\n\x1b[1m${t}\x1b[0m`);
}

const cerca = (a, b, tol = 1e-6, msg = '') =>
  assert.ok(Math.abs(a - b) <= tol, `${msg} esperado ${b}, obtenido ${a} (tolerancia ${tol})`);

const acero = findMaterial(DEFAULT_MATERIALS, 'acero-sae1010');
const inox = findMaterial(DEFAULT_MATERIALS, 'inox-304');
const CTX = { materiales: DEFAULT_MATERIALS, maquinas: [DEFAULT_MACHINE, DEFAULT_PLEGADORA], config: DEFAULT_CONFIG };

/* ================================================================== */
grupo('Geometría');

test('perímetro y área de un rectángulo', () => {
  const r = rect(0, 0, 100, 50);
  cerca(pathLength(r), 300, 1e-9);
  cerca(Math.abs(pathArea(r)), 5000, 1e-6);
});

test('rectángulo con esquinas redondeadas: perímetro correcto', () => {
  const r = rect(0, 0, 100, 50, 10);
  // 2(100-20) + 2(50-20) + circunferencia de r=10
  cerca(pathLength(r), 160 + 60 + TAU * 10, 1e-6);
});

test('círculo: perímetro y área', () => {
  const c = circle(0, 0, 25);
  cerca(pathLength(c), TAU * 25, 1e-6);
  cerca(Math.abs(pathArea(c)), Math.PI * 625, 1.5);
});

test('ranura (oblongo): perímetro = 2 rectas + 2 semicírculos', () => {
  const s = slot(0, 0, 50, 10);
  cerca(pathLength(s), 2 * 40 + TAU * 5, 1e-6);
});

test('área neta descuenta los agujeros', () => {
  const sh = makeShape(rect(0, 0, 100, 100), [circle(50, 50, 10)]);
  cerca(shapeArea(sh), 10000 - Math.PI * 100, 1);
});

test('longitud de corte suma contorno + agujeros', () => {
  const sh = makeShape(rect(0, 0, 100, 100), [circle(30, 30, 5), circle(70, 70, 5)]);
  cerca(shapeCutLength(sh), 400 + 2 * TAU * 5, 1e-6);
  assert.equal(shapePiercings(sh), 3);
});

test('polígono regular de 6 lados inscripto en r=50', () => {
  const p = regularPolygon(0, 0, 50, 6);
  cerca(pathLength(p), 6 * 50, 1e-6); // en el hexágono el lado = radio
});

test('bounding box', () => {
  const b = shapeBBox(makeShape(rect(10, 20, 100, 50)));
  cerca(b.minX, 10, 1e-9);
  cerca(b.w, 100, 1e-9);
  cerca(b.h, 50, 1e-9);
});

/* ================================================================== */
grupo('Materiales');

test('interpolación logarítmica entre espesores de tabla', () => {
  const tabla = acero.procesos.O2.speeds;
  const v3 = interpTable(tabla, 3);
  const v4 = interpTable(tabla, 4);
  const v35 = interpTable(tabla, 3.5);
  assert.ok(v35 < v3 && v35 > v4, 'debe caer entre los dos valores de tabla');
});

test('la velocidad crece con la potencia, sublinealmente', () => {
  const v3kW = cuttingSpeed(acero, 5, 3);
  const v6kW = cuttingSpeed(acero, 5, 6);
  assert.ok(v6kW > v3kW, 'más potencia = más velocidad');
  assert.ok(v6kW < v3kW * 2, 'no debe escalar linealmente');
});

test('peso de una chapa 3000x1500x2 de acero = 70,65 kg', () => {
  cerca(pesoKg(3000 * 1500, 2, 7.85), 70.65, 0.01);
});

/* ================================================================== */
grupo('Tiempo de corte');

test('una placa lisa corta a velocidad casi nominal', () => {
  const sh = makeShape(rect(0, 0, 1000, 1000));
  const r = tiempoCortePieza(sh, acero, 3, DEFAULT_MACHINE);
  assert.ok(r.vMediaEfectiva > r.vNominal * 0.85, `esperado >85 % de la nominal, obtenido ${((r.vMediaEfectiva / r.vNominal) * 100).toFixed(0)} %`);
});

test('las esquinas frenan la máquina: piezas chicas rinden menos', () => {
  const grande = tiempoCortePieza(makeShape(rect(0, 0, 500, 500)), acero, 3, DEFAULT_MACHINE);
  const chica = tiempoCortePieza(makeShape(rect(0, 0, 20, 20)), acero, 3, DEFAULT_MACHINE);
  assert.ok(chica.vMediaEfectiva < grande.vMediaEfectiva, 'la pieza chica debe tener menor velocidad media');
});

test('60 agujeros chicos cuestan mucho más que la misma longitud en recto', () => {
  const conAgujeros = makeShape(rect(0, 0, 300, 300), Array.from({ length: 60 }, (_, i) =>
    circle(30 + (i % 10) * 25, 30 + Math.floor(i / 10) * 45, 4)));
  const liso = makeShape(rect(0, 0, 300, 300));
  const a = tiempoCortePieza(conAgujeros, acero, 3, DEFAULT_MACHINE);
  const b = tiempoCortePieza(liso, acero, 3, DEFAULT_MACHINE);
  assert.equal(a.piercings, 61);
  assert.ok(a.tPieza > b.tPieza * 2, 'la pieza perforada debe llevar bastante más tiempo');
  assert.ok(a.tPierce > 0, 'debe contar el tiempo de perforación');
});

test('un arco de radio chico limita la velocidad más que uno grande', () => {
  const chico = tiempoCortePieza(makeShape(circle(0, 0, 3)), acero, 3, DEFAULT_MACHINE);
  const grande = tiempoCortePieza(makeShape(circle(0, 0, 200)), acero, 3, DEFAULT_MACHINE);
  assert.ok(chico.vMediaEfectiva < grande.vMediaEfectiva);
});

test('el lote incluye setup y carga de chapa una sola vez', () => {
  const sh = makeShape(rect(0, 0, 200, 100));
  const l1 = tiempoCorteLote(sh, acero, 2, DEFAULT_MACHINE, 1, 1, true);
  const l10 = tiempoCorteLote(sh, acero, 2, DEFAULT_MACHINE, 10, 1, true);
  assert.ok(l10.tTotal < l1.tTotal * 10, 'el setup se reparte entre las piezas');
  cerca(l10.tSetup, DEFAULT_MACHINE.tiempoSetupPrograma, 1e-9);
});

test('el inoxidable de 6 mm tarda más que el acero de 6 mm', () => {
  const sh = makeShape(rect(0, 0, 300, 200));
  const a = tiempoCortePieza(sh, acero, 6, DEFAULT_MACHINE);
  const i = tiempoCortePieza(sh, inox, 6, DEFAULT_MACHINE);
  assert.ok(i.tPieza > a.tPieza);
});

test('costo horario: suma de componentes', () => {
  const est = calcularEstructura(DEFAULT_ESTRUCTURA);
  const c = calcularCostoHoraMaquina(DEFAULT_MACHINE, est);
  const k = DEFAULT_MACHINE.costo;
  const esperado =
    k.valorEquipo / k.vidaUtilHoras +
    k.consumoKW * k.costoKWh +
    k.mantenimientoHora + k.consumiblesHora +
    (k.operarioHora * k.dedicacionOperario) / 100 +
    est.porHora * (DEFAULT_MACHINE.participacionEstructura / 100);
  cerca(c.total, esperado, 1e-6);
  assert.ok(c.total > 20000 && c.total < 60000, `costo horario fuera de rango creíble: ${c.total.toFixed(0)}`);
});

test('formato de tiempo legible', () => {
  assert.equal(fmtTiempo(3725), '1h 2m 5s');
  assert.equal(fmtTiempo(45), '45s');
});

/* ================================================================== */
grupo('Plegado');

test('matriz V recomendada ≈ 8×espesor en chapa fina', () => {
  assert.equal(matrizRecomendada(2), 16);
  assert.equal(matrizRecomendada(1), 8);
});

test('bend allowance de una L de 90° en 2 mm', () => {
  const p = calcularPliegue(2, 90, acero, 16, 500);
  cerca(p.radioInterno, 0.16 * 16, 1e-9);
  const BAesperado = rad(90) * (p.radioInterno + p.kFactor * 2);
  cerca(p.BA, BAesperado, 1e-9);
  cerca(p.BD, 2 * Math.tan(rad(45)) * (p.radioInterno + 2) - p.BA, 1e-9);
});

test('el desarrollo es menor que la suma de cotas exteriores', () => {
  const d = calcularDesarrollo([50, 50], [90], 2, acero, 16, 500);
  assert.ok(d.desarrollo < 100, 'debe descontar la deducción');
  assert.ok(d.desarrollo > 95, 'la deducción no puede ser desmedida');
  cerca(d.desarrollo, 100 - d.pliegues[0].BD, 1e-9);
});

test('tonelaje: F = 1.33·Rm·t²/V', () => {
  const p = calcularPliegue(3, 90, acero, 24, 1000);
  const kN = (1.33 * acero.Rm * 9) / 24;
  cerca(p.toneladasPorMetro, kN / 9.80665, 1e-6);
  cerca(p.toneladas, p.toneladasPorMetro, 1e-9); // 1000 mm = 1 m
});

test('más espesor exige mucho más tonelaje (crece con el cuadrado)', () => {
  const p2 = calcularPliegue(2, 90, acero, 16, 1000);
  const p4 = calcularPliegue(4, 90, acero, 32, 1000);
  assert.ok(p4.toneladas > p2.toneladas * 1.5);
});

test('avisa si la pieza supera el tonelaje de la plegadora', () => {
  const p = calcularPliegue(12, 90, acero, 100, 3000);
  const avisos = validarPlegado({ t: 12, material: acero, pliegues: [p], largoMM: 3000, alas: [] }, DEFAULT_PLEGADORA);
  assert.ok(avisos.some((a) => a.nivel === 'error'), 'debería avisar que no alcanza el tonelaje');
});

test('avisa si el ala es menor al mínimo plegable', () => {
  const p = calcularPliegue(3, 90, acero, 24, 500);
  const avisos = validarPlegado({ t: 3, material: acero, pliegues: [p], largoMM: 500, alas: [8] }, DEFAULT_PLEGADORA);
  assert.ok(avisos.some((a) => a.nivel === 'error' && /ala/i.test(a.msg)));
});

test('el tiempo de plegado por pieza baja con la cantidad', () => {
  const t1 = tiempoPlegado(1, 4, 500, 2, DEFAULT_PLEGADORA);
  const t50 = tiempoPlegado(50, 4, 500, 2, DEFAULT_PLEGADORA);
  assert.ok(t50.tPieza < t1.tPieza, 'curva de aprendizaje');
  assert.ok(t50.tTotal > t1.tTotal);
});

/* ================================================================== */
grupo('Nesting');

test('piezas de 100×100 en chapa de 1000×1000', () => {
  const r = nest([{ id: 'a', w: 100, h: 100, cantidad: 50 }], { w: 1000, h: 1000 }, { margen: 10, separacion: 5 });
  assert.ok(r.cantidadChapas >= 1);
  assert.ok(r.chapas[0].piezas.length >= 60 || r.piezasColocadas === 50);
  assert.equal(r.piezasColocadas, 50);
});

test('el aprovechamiento está entre 0 y 1', () => {
  const r = nest([{ id: 'a', w: 300, h: 200, cantidad: 20 }], { w: 3000, h: 1500 }, {});
  assert.ok(r.aprovechamientoGlobal > 0 && r.aprovechamientoGlobal <= 1, `obtenido ${r.aprovechamientoGlobal}`);
});

test('reparte en varias chapas cuando no entra todo', () => {
  const r = nest([{ id: 'a', w: 1400, h: 900, cantidad: 10 }], { w: 3000, h: 1500 }, {});
  assert.ok(r.cantidadChapas > 1);
  assert.equal(r.piezasColocadas, 10);
});

test('una pieza más grande que la chapa no se coloca', () => {
  const r = nest([{ id: 'a', w: 5000, h: 200, cantidad: 1 }], { w: 3000, h: 1500 }, {});
  assert.equal(r.noEntran.length, 1);
});

test('la rotación permite acomodar más piezas', () => {
  const sinRot = nest([{ id: 'a', w: 1400, h: 400, cantidad: 6, rotable: false }], { w: 3000, h: 1500 }, {});
  const conRot = nest([{ id: 'a', w: 1400, h: 400, cantidad: 6, rotable: true }], { w: 3000, h: 1500 }, {});
  assert.ok(conRot.cantidadChapas <= sinRot.cantidadChapas);
});

test('ninguna pieza se sale de la chapa ni se superpone', () => {
  const r = nest([{ id: 'a', w: 220, h: 130, cantidad: 40 }], { w: 3000, h: 1500 }, { margen: 10, separacion: 5 });
  for (const ch of r.chapas) {
    for (const p of ch.piezas) {
      assert.ok(p.x >= 10 - 1e-9 && p.y >= 10 - 1e-9, 'respeta el margen');
      const w = p.rot ? p.h : p.w;
      const hh = p.rot ? p.w : p.h;
      assert.ok(p.x + w <= ch.w - 10 + 5, 'no se pasa del borde');
      assert.ok(p.y + hh <= ch.h - 10 + 5, 'no se pasa del borde');
    }
    for (let i = 0; i < ch.piezas.length; i++) {
      for (let j = i + 1; j < ch.piezas.length; j++) {
        const a = ch.piezas[i];
        const b = ch.piezas[j];
        const aw = a.rot ? a.h : a.w;
        const ah = a.rot ? a.w : a.h;
        const bw = b.rot ? b.h : b.w;
        const bh = b.rot ? b.w : b.h;
        const solapa = a.x < b.x + bw && b.x < a.x + aw && a.y < b.y + bh && b.y < a.y + ah;
        assert.ok(!solapa, `las piezas ${i} y ${j} se superponen`);
      }
    }
  }
});

/* ================================================================== */
grupo('DXF');

test('escribe un DXF válido con las secciones obligatorias', () => {
  const sh = makeShape(rect(0, 0, 100, 60, 8), [circle(50, 30, 10)]);
  const dxf = generarDXF([sh], { titulo: 'Prueba' });
  assert.ok(dxf.includes('SECTION'));
  assert.ok(dxf.includes('ENTITIES'));
  assert.ok(dxf.includes('EOF'));
  assert.ok(dxf.includes('CORTE'));
  assert.ok(dxf.includes('CIRCLE') || dxf.includes('ARC'));
});

test('ida y vuelta: escribir y volver a leer conserva las medidas', () => {
  const sh = makeShape(rect(0, 0, 200, 120), [circle(60, 60, 15), circle(140, 60, 15)]);
  const dxf = generarDXF([sh]);
  const r = leerDXF(dxf);
  assert.equal(r.piezas.length, 1, 'debe reconocer una sola pieza');
  assert.equal(r.piezas[0].holes.length, 2, 'debe reconocer los dos agujeros');
  const b = shapeBBox(r.piezas[0]);
  cerca(b.w, 200, 0.05, 'ancho');
  cerca(b.h, 120, 0.05, 'alto');
  cerca(shapeCutLength(r.piezas[0]), shapeCutLength(sh), 0.5, 'longitud de corte');
});

test('ida y vuelta con arcos: rectángulo redondeado', () => {
  const sh = makeShape(rect(0, 0, 150, 80, 12));
  const r = leerDXF(generarDXF([sh]));
  assert.equal(r.piezas.length, 1);
  cerca(shapeCutLength(r.piezas[0]), shapeCutLength(sh), 0.5);
});

test('detecta varias piezas independientes en un mismo archivo', () => {
  const a = makeShape(rect(0, 0, 100, 100));
  const b = makeShape(rect(200, 0, 100, 100));
  const r = leerDXF(generarDXF([a, b]));
  assert.equal(r.piezas.length, 2);
});

test('lee LWPOLYLINE con bulge (arcos en polilínea)', () => {
  const dxf = [
    '0', 'SECTION', '2', 'ENTITIES',
    '0', 'LWPOLYLINE', '8', 'CORTE', '90', '4', '70', '1',
    '10', '0', '20', '0', '42', '0',
    '10', '100', '20', '0', '42', '0.4142135',
    '10', '100', '20', '50', '42', '0',
    '10', '0', '20', '50', '42', '0',
    '0', 'ENDSEC', '0', 'EOF',
  ].join('\r\n');
  const r = leerDXF(dxf);
  assert.equal(r.piezas.length, 1);
  assert.ok(r.piezas[0].outer.segs.some((s) => s.t === 'A'), 'el bulge debe convertirse en arco');
});

test('convierte automáticamente un archivo en pulgadas', () => {
  const dxf = [
    '0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '1', '0', 'ENDSEC',
    '0', 'SECTION', '2', 'ENTITIES',
    '0', 'LINE', '8', '0', '10', '0', '20', '0', '11', '1', '21', '0',
    '0', 'LINE', '8', '0', '10', '1', '20', '0', '11', '1', '21', '1',
    '0', 'LINE', '8', '0', '10', '1', '20', '1', '11', '0', '21', '1',
    '0', 'LINE', '8', '0', '10', '0', '20', '1', '11', '0', '21', '0',
    '0', 'ENDSEC', '0', 'EOF',
  ].join('\r\n');
  const r = leerDXF(dxf);
  const b = shapeBBox(r.piezas[0]);
  cerca(b.w, 25.4, 0.01, '1 pulgada = 25,4 mm');
});

test('avisa cuando hay contornos abiertos', () => {
  const dxf = [
    '0', 'SECTION', '2', 'ENTITIES',
    '0', 'LINE', '8', '0', '10', '0', '20', '0', '11', '100', '21', '0',
    '0', 'LINE', '8', '0', '10', '100', '20', '0', '11', '100', '21', '50',
    '0', 'ENDSEC', '0', 'EOF',
  ].join('\r\n');
  const r = leerDXF(dxf);
  assert.ok(r.avisos.some((a) => /abierto/i.test(a.msg)));
});

test('la capa PLEGADO no se cuenta como corte', () => {
  const sh = makeShape(rect(0, 0, 100, 50));
  const dxf = generarDXF([sh], { lineasPlegado: [{ x1: 50, y1: 0, x2: 50, y2: 50, label: 'P1' }] });
  const r = leerDXF(dxf);
  assert.equal(r.piezas.length, 1);
  cerca(shapeCutLength(r.piezas[0]), 300, 0.1, 'el pliegue no suma longitud de corte');
  assert.ok(r.plegado.length > 0, 'debe recuperar las líneas de plegado');
});

/* ================================================================== */
grupo('Biblioteca paramétrica');

test('todas las piezas se construyen sin error', () => {
  for (const def of PIEZAS) {
    const r = construir(def.id, paramsPorDefecto(def.id), { espesor: 2, material: acero });
    assert.ok(r.shape?.outer?.segs?.length, `${def.id} no generó contorno`);
    const b = shapeBBox(r.shape);
    assert.ok(b.w > 0 && b.h > 0, `${def.id} tiene bounding box nulo`);
    assert.ok(isFinite(shapeCutLength(r.shape)), `${def.id} longitud de corte inválida`);
  }
});

test('todas las piezas producen un modelo 3D con caras', () => {
  for (const def of PIEZAS) {
    const r = construir(def.id, paramsPorDefecto(def.id), { espesor: 2, material: acero });
    const mesh = construirMesh({ shape: r.shape, modelo3D: r.modelo3D }, 2, 1.6);
    assert.ok(mesh.faces.length > 0, `${def.id} no generó caras 3D`);
    for (const f of mesh.faces) {
      for (const p of f.pts) {
        assert.ok(p.every(Number.isFinite), `${def.id} tiene vértices inválidos`);
      }
    }
  }
});

test('el desarrollo del ángulo L coincide con el cálculo de plegado', () => {
  const r = construir('angulo-l', { a: 50, b: 40, largo: 500, angulo: 90, nAgujeros: 0 }, { espesor: 2, material: acero });
  const d = calcularDesarrollo([50, 40], [90], 2, acero, null, 500);
  const b = shapeBBox(r.shape);
  cerca(b.w, d.desarrollo, 0.01);
});

test('la bandeja tiene los 4 pliegues y el desarrollo esperado', () => {
  const r = construir('bandeja', { L: 300, A: 200, H: 60, esquina: 'redondo' }, { espesor: 2, material: acero });
  assert.equal(r.pliegues.length, 4);
  const b = shapeBBox(r.shape);
  assert.ok(b.w > 300 && b.w < 300 + 2 * 60, 'el desarrollo debe estar entre la base y base+2·altura');
  assert.ok(b.h > 200 && b.h < 200 + 2 * 60);
});

test('la virola desarrolla π×D', () => {
  const r = construir('virola', { dia: 300, alto: 500, referencia: 'medio', costura: 0, nAgujeros: 0 }, { espesor: 2, material: acero });
  const b = shapeBBox(r.shape);
  cerca(b.w, Math.PI * (300 - 2), 0.01);
});

test('el cono genera un sector con el ángulo correcto', () => {
  const r = construir('cono', { d1: 400, d2: 150, h: 300, costura: 0, partes: 1 }, { espesor: 1, material: acero });
  const d1 = 399;
  const d2 = 149;
  const L = Math.sqrt(300 ** 2 + ((d1 - d2) / 2) ** 2);
  const R1 = (L * d1) / (d1 - d2);
  cerca(r.info.generatriz, L, 0.01);
  cerca(r.info.radioMayor, R1, 0.01);
  cerca(r.info.anguloDesarrollo, (180 * (Math.PI * d1)) / (R1 * Math.PI), 0.01);
});

test('el engranaje tiene el diámetro primitivo m·z', () => {
  const r = construir('engranaje', { z: 20, modulo: 4, anguloPresion: 20, diaEje: 15 }, { espesor: 3, material: acero });
  cerca(r.info.primitivo, 80, 0.001);
  cerca(r.info.exterior, 88, 0.001);
  const b = shapeBBox(r.shape);
  cerca(b.w, 88, 0.6, 'el bounding box debe coincidir con el diámetro exterior');
});

test('la rejilla genera la cantidad de agujeros esperada', () => {
  const r = construir('rejilla', { w: 100, h: 100, margen: 10, dia: 5, paso: 10, tresbolillo: false, forma: 'circulo', r: 0 }, { espesor: 1.5, material: acero });
  assert.equal(r.shape.holes.length, 9 * 9);
});

test('el panel de rack mide 482,6 mm', () => {
  const r = construir('panel-rack', { u: 2, conVentilacion: false }, { espesor: 2, material: acero });
  const b = shapeBBox(r.shape);
  cerca(b.w, 482.6, 0.01);
  cerca(b.h, 88.9, 0.01);
});

test('los parámetros fuera de rango se corrigen solos', () => {
  const r = construir('placa', { w: -50, h: 200, r: 999 }, { espesor: 2, material: acero });
  const b = shapeBBox(r.shape);
  assert.ok(b.w > 0 && b.h > 0);
});

/* ================================================================== */
grupo('Precios');

test('cotiza una placa simple con todos los componentes', () => {
  const sh = makeShape(rect(0, 0, 200, 150), [circle(100, 75, 20)]);
  const r = cotizarItem({ nombre: 'Placa', shape: sh, materialId: 'acero-sae1010', espesor: 3, cantidad: 10 }, CTX);
  assert.ok(!r.error, r.error);
  assert.ok(r.costos.material > 0, 'material');
  assert.ok(r.costos.corte > 0, 'corte');
  assert.ok(r.costos.gas > 0, 'gas');
  assert.ok(r.precio.neto > r.costos.total, 'el precio debe cubrir el costo');
  cerca(r.precio.unitario * r.cantidad, r.precio.neto, 1e-6);
});

test('avisa cuando un componente del costo horario domina de forma absurda', () => {
  const est = calcularEstructura(DEFAULT_CONFIG.estructura);

  // El caso real: $150.000/h de consumibles contra los $2.800 de fábrica
  const rota = { ...DEFAULT_MACHINE, costo: { ...DEFAULT_MACHINE.costo, consumiblesHora: 150000 } };
  const avisos = revisarCostoHora(rota, est);
  assert.equal(avisos.length, 1, 'tiene que avisar');
  assert.equal(avisos[0].componente, 'consumibles');
  assert.ok(avisos[0].pct > 0.7 && avisos[0].nivel === 'error');

  // La máquina de fábrica no puede disparar el aviso, o nadie le da bola
  assert.equal(revisarCostoHora(DEFAULT_MACHINE, est).length, 0, 'los valores de fábrica son sanos');
});

test('el corte y la puesta a punto se cobran por separado', () => {
  // Una placa chica en chapa fina: cortarla son segundos, prepararla minutos.
  // Mezclarlos mostraba "corte láser 4m 42s", que es un tiempo que no existe.
  const sh = makeShape(rect(0, 0, 200, 150), [circle(20, 20, 4), circle(180, 130, 4)]);
  const r = cotizarItem({ shape: sh, materialId: 'acero-sae1010', espesor: 1.2, cantidad: 1 }, CTX);

  assert.ok(r.corte.tPieza < 30, `cortar esta placa no puede tardar ${r.corte.tPieza.toFixed(0)}s`);
  cerca(r.costos.tPreparacion, r.corte.tSetup + r.corte.tChapas, 1e-9, 'preparación = setup + carga');

  // La suma no cambió: sigue siendo el tiempo de máquina completo
  const costoHora = r.costos.costoHoraLaser;
  cerca(r.costos.corte + r.costos.preparacion, (r.corte.tTotal / 3600) * costoHora, 1e-6);

  // Y en un trabajo de una pieza la preparación tiene que dominar
  assert.ok(r.costos.preparacionPct > 0.5, 'con una sola pieza el precio es casi todo preparación');
});

test('con más cantidad la preparación se diluye y el unitario se desploma', () => {
  const sh = makeShape(rect(0, 0, 200, 150));
  const base = { shape: sh, materialId: 'acero-sae1010', espesor: 1.2 };
  const uno = cotizarItem({ ...base, cantidad: 1 }, CTX);
  const cien = cotizarItem({ ...base, cantidad: 100 }, CTX);

  assert.ok(cien.costos.preparacionPct < uno.costos.preparacionPct / 5, 'la preparación se reparte');
  assert.ok(cien.precio.unitario < uno.precio.unitario / 3, 'el unitario tiene que caer fuerte');
  // Pero el tiempo de preparación en segundos es el mismo: un programa, una chapa
  cerca(cien.corte.tSetup, uno.corte.tSetup, 1e-9);
});

test('el precio unitario baja con la cantidad', () => {
  const sh = makeShape(rect(0, 0, 150, 100));
  const base = { nombre: 'X', shape: sh, materialId: 'acero-sae1010', espesor: 2 };
  const u1 = cotizarItem({ ...base, cantidad: 1 }, CTX).precio.unitario;
  const u100 = cotizarItem({ ...base, cantidad: 100 }, CTX).precio.unitario;
  assert.ok(u100 < u1, `unitario a 100 (${u100.toFixed(0)}) debe ser menor que a 1 (${u1.toFixed(0)})`);
});

test('el inoxidable sale bastante más caro que el acero', () => {
  const sh = makeShape(rect(0, 0, 200, 200));
  const a = cotizarItem({ shape: sh, materialId: 'acero-sae1010', espesor: 2, cantidad: 5 }, CTX);
  const i = cotizarItem({ shape: sh, materialId: 'inox-304', espesor: 2, cantidad: 5 }, CTX);
  assert.ok(i.precio.neto > a.precio.neto * 1.5);
});

test('el plegado suma costo y tiempo', () => {
  const sh = makeShape(rect(0, 0, 200, 500));
  const sin = cotizarItem({ shape: sh, materialId: 'acero-sae1010', espesor: 2, cantidad: 10 }, CTX);
  const con = cotizarItem({ shape: sh, materialId: 'acero-sae1010', espesor: 2, cantidad: 10, plegado: { pliegues: 2, largoPliegue: 500, angulo: 90 } }, CTX);
  assert.ok(con.costos.plegado > 0);
  assert.ok(con.precio.neto > sin.precio.neto);
  assert.ok(con.datosPliegue.matrizV > 0);
});

test('los acabados se cobran según su base (peso o superficie)', () => {
  const sh = makeShape(rect(0, 0, 500, 500));
  const base = { shape: sh, materialId: 'acero-sae1010', espesor: 3, cantidad: 4 };
  const pintura = cotizarItem({ ...base, acabadoId: 'pintura-polvo' }, CTX);
  const galv = cotizarItem({ ...base, acabadoId: 'galvanizado' }, CTX);
  assert.ok(pintura.costos.acabado > 0 && galv.costos.acabado > 0);
  const vPintura = DEFAULT_CONFIG.acabados.find((a) => a.id === 'pintura-polvo').valor;
  const vGalv = DEFAULT_CONFIG.acabados.find((a) => a.id === 'galvanizado').valor;
  cerca(pintura.costos.acabado, pintura.costos.detalleAcabado.superficieM2 * vPintura, 1);
  cerca(galv.costos.acabado, galv.geometria.pesoTotal * vGalv, 1);
});

test('el recargo por urgencia se aplica sobre el precio', () => {
  const sh = makeShape(rect(0, 0, 300, 300));
  const normal = cotizarItem({ shape: sh, materialId: 'acero-sae1010', espesor: 2, cantidad: 5 }, CTX);
  const express = cotizarItem({ shape: sh, materialId: 'acero-sae1010', espesor: 2, cantidad: 5, urgencia: 'express' }, CTX);
  assert.ok(express.precio.neto > normal.precio.neto);
});

test('los descuentos por cantidad respetan los escalones', () => {
  assert.equal(descuentoPorCantidad(5, DEFAULT_CONFIG.comercial.descuentos), 0);
  assert.equal(descuentoPorCantidad(10, DEFAULT_CONFIG.comercial.descuentos), 5);
  assert.equal(descuentoPorCantidad(120, DEFAULT_CONFIG.comercial.descuentos), 18);
  assert.equal(descuentoPorCantidad(1000, DEFAULT_CONFIG.comercial.descuentos), 25);
});

test('el redondeo comercial va hacia arriba', () => {
  assert.equal(redondear(1234, 100), 1300);
  assert.equal(redondear(1200, 100), 1200);
});

test('el presupuesto suma los ítems, aplica IVA y respeta el mínimo', () => {
  const sh = makeShape(rect(0, 0, 400, 300), [circle(200, 150, 30)]);
  const p = cotizarPresupuesto({
    items: [
      { nombre: 'A', shape: sh, materialId: 'acero-sae1010', espesor: 3, cantidad: 12 },
      { nombre: 'B', shape: makeShape(rect(0, 0, 100, 100)), materialId: 'inox-304', espesor: 2, cantidad: 30 },
    ],
  }, CTX);
  assert.equal(p.items.length, 2);
  cerca(p.resumen.iva, p.resumen.subtotal * 0.21, 0.01);
  cerca(p.resumen.total, p.resumen.subtotal + p.resumen.iva, 0.01);
  assert.ok(p.resumen.subtotal >= DEFAULT_CONFIG.comercial.minimoFacturacion);
  assert.ok(p.resumen.piezasTotales === 42);
  assert.ok(p.resumen.utilidadPct > 0 && p.resumen.utilidadPct < 100);
});

test('una pieza que no entra en la chapa devuelve el error correspondiente', () => {
  const sh = makeShape(rect(0, 0, 4000, 200));
  const r = cotizarItem({ shape: sh, materialId: 'acero-sae1010', espesor: 2, cantidad: 1 }, CTX);
  assert.ok(r.nesting.error, 'debe informar que no entra');
});

test('un espesor por encima del máximo devuelve error explicativo', () => {
  const sh = makeShape(rect(0, 0, 100, 100));
  // El inoxidable a 3 kW llega hasta 12 mm: pedir 20 tiene que fallar claro
  const r = cotizarItem({ shape: sh, materialId: 'inox-304', espesor: 20, cantidad: 1 }, CTX);
  assert.ok(r.error, 'debería informar que no se puede cortar');
  assert.ok(/supera|no tiene datos/i.test(r.error), `mensaje poco claro: ${r.error}`);
});

/* ================================================================== */
/* ================================================================== */

grupo('Revisión de los datos cargados');

const DATOS_OK = { config: DEFAULT_CONFIG, maquinas: [DEFAULT_MACHINE, DEFAULT_PLEGADORA], materiales: DEFAULT_MATERIALS };

test('los valores de fábrica no disparan NINGÚN aviso', () => {
  const r = revisarDatos(DATOS_OK);
  assert.ok(r.ok, 'un aviso que salta siempre enseña a ignorar los avisos: ' +
    r.hallazgos.map((h) => `[${h.nivel}] ${h.donde}: ${h.msg}`).join(' | '));
});

test('detecta el caso real: un componente que se come el costo horario', () => {
  const rota = { ...DEFAULT_MACHINE, costo: { ...DEFAULT_MACHINE.costo, consumiblesHora: 150000 } };
  const r = revisarDatos({ ...DATOS_OK, maquinas: [rota, DEFAULT_PLEGADORA] });
  assert.equal(r.errores, 1);
  assert.ok(/consumibles/.test(r.hallazgos[0].msg));
  assert.ok(/Máquinas/.test(r.hallazgos[0].donde), 'tiene que decir dónde se arregla');
});

test('detecta una densidad que no es la de un metal', () => {
  const mats = DEFAULT_MATERIALS.map((m) => (m.id === 'acero-sae1010' ? { ...m, densidad: 785 } : m));
  const r = revisarDatos({ ...DATOS_OK, materiales: mats });
  assert.ok(r.hallazgos.some((h) => h.nivel === 'error' && /densidad/i.test(h.msg)));
});

test('detecta un material sin precio por kilo', () => {
  const mats = DEFAULT_MATERIALS.map((m) => (m.id === 'inox-304' ? { ...m, precioKg: 0 } : m));
  const r = revisarDatos({ ...DATOS_OK, materiales: mats });
  assert.ok(r.hallazgos.some((h) => h.nivel === 'error' && /precio por kilo/i.test(h.msg)));
});

test('detecta los dos mínimos contradictorios', () => {
  const cfg = { ...DEFAULT_CONFIG, comercial: { ...DEFAULT_CONFIG.comercial, minimoPorItem: 90000, minimoFacturacion: 60000 } };
  const r = revisarDatos({ ...DATOS_OK, config: cfg });
  assert.ok(r.hallazgos.some((h) => /mínimo por ítem/i.test(h.msg)));
});

test('detecta el aire más caro que el nitrógeno, que es imposible', () => {
  // El aire lo genera el compresor del taller: no puede salir más que un gas
  // comprado. Es la única relación entre gases que se sostiene siempre.
  const cfg = {
    ...DEFAULT_CONFIG,
    produccion: { ...DEFAULT_CONFIG.produccion, gases: { O2: 4500, N2: 1400, AIRE: 2000 } },
  };
  const r = revisarDatos({ ...DATOS_OK, config: cfg });
  assert.ok(r.hallazgos.some((h) => /aire comprimido figura más caro/i.test(h.msg)));
});

test('NO se queja de que el oxígeno salga más que el nitrógeno', () => {
  // Es lo normal: el O2 va en cilindros a 1-3 m³/h y el N2 se compra líquido
  // a granel para consumir 25-95. Avisar acá sería inventar una regla.
  const r = revisarDatos(DATOS_OK);
  assert.ok(!r.hallazgos.some((h) => /nitrógeno/i.test(h.msg)));
});

test('NO se queja del operario dominante en la plegadora', () => {
  // Una plegadora es barata y el trabajo es casi todo mano de obra: el 52 %
  // de operario es correcto, no un error de carga.
  const r = revisarDatos({ ...DATOS_OK, maquinas: [DEFAULT_PLEGADORA] });
  assert.ok(!r.hallazgos.some((h) => /operario/i.test(h.msg)));
});

test('detecta el margen en cero, que sería vender al costo', () => {
  const cfg = { ...DEFAULT_CONFIG, comercial: { ...DEFAULT_CONFIG.comercial, margen: 0 } };
  const r = revisarDatos({ ...DATOS_OK, config: cfg });
  assert.ok(r.hallazgos.some((h) => h.nivel === 'error' && /margen/i.test(h.msg)));
});

test('los errores se listan antes que los avisos', () => {
  const rota = { ...DEFAULT_MACHINE, costo: { ...DEFAULT_MACHINE.costo, consumiblesHora: 150000 } };
  const cfg = { ...DEFAULT_CONFIG, comercial: { ...DEFAULT_CONFIG.comercial, minimoPorItem: 90000, minimoFacturacion: 60000 } };
  const r = revisarDatos({ config: cfg, maquinas: [rota], materiales: DEFAULT_MATERIALS });
  assert.ok(r.errores >= 1 && r.avisos >= 1);
  assert.equal(r.hallazgos[0].nivel, 'error', 'lo que rompe va primero');
});

/* ================================================================== */

grupo('Piezas de varias partes (carteles, juegos, DXF de cliente)');

test('con una sola parte no se complica: es una pieza normal', () => {
  const sh = makeShapeMulti([{ outer: rect(0, 0, 100, 50), holes: [] }]);
  assert.ok(!sh.partes, 'con una sola parte no hace falta la lista');
  assert.ok(!esMultiParte(sh));
  cerca(shapeArea(sh), 100 * 50, 1e-6);
  assert.equal(partesDe(sh).length, 1);
});

test('el área, el corte y las perforaciones suman TODAS las partes', () => {
  const sh = makeShapeMulti([
    { outer: rect(0, 0, 100, 50), holes: [circle(50, 25, 10)] },
    { outer: rect(200, 0, 60, 40), holes: [] },
  ]);
  assert.ok(esMultiParte(sh));
  cerca(shapeArea(sh), 100 * 50 + 60 * 40 - Math.PI * 100, 1e-3, 'área neta');
  cerca(shapeCutLength(sh), 2 * (100 + 50) + 2 * Math.PI * 10 + 2 * (60 + 40), 1e-3, 'longitud de corte');
  // Un piercing por contorno cerrado: 2 exteriores + 1 agujero
  assert.equal(shapePiercings(sh), 3);
});

test('la caja envolvente cubre todas las partes, no sólo la más grande', () => {
  const sh = makeShapeMulti([
    { outer: rect(0, 0, 100, 50), holes: [] },
    { outer: rect(200, 0, 60, 40), holes: [] },
  ]);
  const b = shapeBBox(sh);
  cerca(b.minX, 0, 1e-6);
  cerca(b.maxX, 260, 1e-6);
  cerca(b.w, 260, 1e-6, 'si diera 100 estaría midiendo sólo una parte');
});

test('el recorrido de corte pasa por los contornos de todas las partes', () => {
  const sh = makeShapeMulti([
    { outer: rect(0, 0, 100, 50), holes: [circle(50, 25, 8)] },
    { outer: rect(200, 0, 60, 40), holes: [] },
  ]);
  const { orden } = recorridoRapido(sh);
  assert.equal(orden.length, 3, 'dos exteriores y un agujero');
  // El agujero de una parte va antes que su propio contorno, o la pieza se
  // suelta antes de terminar de cortarla
  assert.ok(orden.indexOf(sh.partes[0].holes[0]) < orden.indexOf(sh.partes[0].outer));
});

test('un DXF con dos contornos sueltos se importa como UNA pieza de dos partes', () => {
  const dxf = generarDXF([
    { shape: makeShape(rect(0, 0, 100, 50)) },
    { shape: makeShape(rect(0, 0, 60, 40)), dx: 200 },
  ]);
  const r = leerDXF(dxf);
  assert.ok(r.conjunto, 'tiene que venir el dibujo completo como una pieza');
  assert.equal(r.conjunto.partes.length, 2, 'las dos partes, con sus posiciones');
  cerca(shapeArea(r.conjunto), 100 * 50 + 60 * 40, 1, 'el área es la de las dos');
  // Y las piezas sueltas siguen disponibles por si de verdad son independientes
  assert.equal(r.piezas.length, 2);
});

test('un DXF con recuadro y contenido sigue siendo una pieza con agujeros', () => {
  const dxf = generarDXF([
    { shape: makeShape(rect(0, 0, 300, 200), [circle(80, 100, 20), circle(220, 100, 20)]) },
  ]);
  const r = leerDXF(dxf);
  assert.equal(r.piezas.length, 1, 'el recuadro con contenido es UNA pieza');
  assert.equal(r.piezas[0].holes.length, 2);
  assert.ok(!esMultiParte(r.conjunto), 'no hay varias partes acá');
});

test('una pieza de varias partes se anida por su rectángulo, sin prometer encastre', () => {
  // Dos cuadrados de 100 separados 200: el hueco del medio NO se puede usar
  // para meter otra pieza, porque las partes viajan juntas.
  const sh = makeShapeMulti([
    { outer: rect(0, 0, 100, 100), holes: [] },
    { outer: rect(300, 0, 100, 100), holes: [] },
  ]);
  const b = shapeBBox(sh);
  cerca(b.w, 400, 1e-6);
  const r = nest([{ id: 'm', w: b.w, h: b.h, cantidad: 8, shape: sh }], { w: 1000, h: 300 }, { separacion: 5, margen: 10 });
  // Por rectángulo entran 6 por chapa (2 × 3): 8 necesitan dos chapas.
  // Si anidara por el contorno de una sola parte, entrarían todas en una.
  assert.ok(r.cantidadChapas >= 2, `entraron todas en ${r.cantidadChapas} chapa(s): está prometiendo un encastre falso`);
});

test('el DXF de salida escribe los contornos de todas las partes', () => {
  const sh = makeShapeMulti([
    { outer: rect(0, 0, 100, 50), holes: [] },
    { outer: rect(200, 0, 60, 40), holes: [] },
  ]);
  const dxf = generarDXF([{ shape: sh }]);
  const releido = leerDXF(dxf);
  assert.equal(releido.piezas.length, 2, 'las dos partes tienen que llegar al CAM');
  cerca(shapeArea(releido.conjunto), shapeArea(sh), 1, 'y con la misma área');
});

/* ================================================================== */

grupo('Nesting por presupuesto');

/* El caso del ROADMAP 1.1, que es el que motivó todo esto: tres placas
   distintas del mismo material y espesor. La máquina las corta en UNA chapa
   con UN programa; el sistema reportaba tres de cada cosa. */
const TRES_PLACAS = [
  { nombre: 'A', shape: makeShape(rect(0, 0, 600, 400)), materialId: 'acero-sae1010', espesor: 3, cantidad: 4 },
  { nombre: 'B', shape: makeShape(rect(0, 0, 500, 300)), materialId: 'acero-sae1010', espesor: 3, cantidad: 4 },
  { nombre: 'C', shape: makeShape(rect(0, 0, 400, 250)), materialId: 'acero-sae1010', espesor: 3, cantidad: 4 },
];

test('tres piezas del mismo material y espesor comparten una sola chapa', () => {
  const r = cotizarPresupuesto({ items: TRES_PLACAS }, CTX);
  assert.equal(r.resumen.chapasTotal, 1, 'tienen que entrar en una chapa, no en tres');
  for (const it of r.items) assert.ok(it.nesting.compartido, `${it.nombre} debería compartir chapa`);
  assert.equal(r.items[0].nesting.itemsEnGrupo, 3);
});

test('el setup se cobra una vez, no una por ítem', () => {
  const r = cotizarPresupuesto({ items: TRES_PLACAS }, CTX);
  const setup = r.items.reduce((a, i) => a + i.corte.tSetup, 0);
  cerca(setup, DEFAULT_MACHINE.tiempoSetupPrograma, 1e-6, 'un programa, un setup');
});

test('las partes de chapa de cada ítem suman las chapas del grupo', () => {
  const r = cotizarPresupuesto({ items: TRES_PLACAS }, CTX);
  const suma = r.items.reduce((a, i) => a + i.nesting.chapas, 0);
  cerca(suma, r.items[0].nesting.chapasGrupo, 1e-9, 'el prorrateo no puede perder ni inventar chapa');
});

test('el área prorrateada suma exactamente el área anidada del grupo', () => {
  const plan = planificarNesting(TRES_PLACAS, { ...CTX, estructura: undefined });
  const areas = [...plan.values()].map((p) => p.areaConsumida);
  const fracciones = [...plan.values()].map((p) => p.fraccion);
  cerca(fracciones.reduce((a, b) => a + b, 0), 1, 1e-9, 'las fracciones tienen que sumar 1');
  assert.ok(areas.every((a) => a > 0), 'ningún ítem puede quedar con área cero');
});

test('agrupar baja el costo, nunca lo sube', () => {
  const r = cotizarPresupuesto({ items: TRES_PLACAS }, CTX);
  // Lo mismo cotizado de a uno, que es como se hacía antes
  const suelto = TRES_PLACAS.reduce((a, it) => a + cotizarItem(it, CTX).costos.total, 0);
  assert.ok(r.resumen.costo < suelto, `agrupado ${r.resumen.costo.toFixed(0)} debe ser menor que suelto ${suelto.toFixed(0)}`);
  // El ahorro viene del setup y la carga de chapa, no del material
  assert.ok(r.resumen.costo > suelto * 0.9, 'un ahorro mayor al 10 % sería sospechoso: revisar');
});

test('materiales distintos NO comparten chapa', () => {
  const items = [
    { nombre: 'A', shape: makeShape(rect(0, 0, 300, 200)), materialId: 'acero-sae1010', espesor: 2, cantidad: 2 },
    { nombre: 'B', shape: makeShape(rect(0, 0, 300, 200)), materialId: 'inox-304', espesor: 2, cantidad: 2 },
  ];
  const r = cotizarPresupuesto({ items }, CTX);
  for (const it of r.items) assert.ok(!it.nesting.compartido, `${it.nombre} no puede compartir chapa con otro material`);
  assert.equal(r.resumen.chapasTotal, 2);
});

test('espesores distintos NO comparten chapa', () => {
  const sh = makeShape(rect(0, 0, 300, 200));
  const items = [
    { nombre: 'A', shape: sh, materialId: 'acero-sae1010', espesor: 2, cantidad: 2 },
    { nombre: 'B', shape: sh, materialId: 'acero-sae1010', espesor: 5, cantidad: 2 },
  ];
  const r = cotizarPresupuesto({ items }, CTX);
  for (const it of r.items) assert.ok(!it.nesting.compartido, 'dos espesores no salen de la misma chapa');
});

test('gases distintos NO comparten chapa (es otro programa y otra boquilla)', () => {
  const disponibles = gasesDisponibles(acero, 3).map((g) => g.id);
  if (disponibles.length < 2) return; // el material no da para probarlo
  const sh = makeShape(rect(0, 0, 300, 200));
  const items = [
    { nombre: 'A', shape: sh, materialId: 'acero-sae1010', espesor: 3, cantidad: 2, gas: disponibles[0] },
    { nombre: 'B', shape: sh, materialId: 'acero-sae1010', espesor: 3, cantidad: 2, gas: disponibles[1] },
  ];
  const r = cotizarPresupuesto({ items }, CTX);
  for (const it of r.items) assert.ok(!it.nesting.compartido, 'distinto gas es distinto programa');
});

test('un ítem solo se cotiza igual que antes del cambio', () => {
  const it = TRES_PLACAS[0];
  const solo = cotizarItem(it, CTX);
  const enPresupuesto = cotizarPresupuesto({ items: [it] }, CTX).items[0];
  cerca(enPresupuesto.costos.total, solo.costos.total, 1e-9, 'no debe cambiar nada con un solo ítem');
  cerca(enPresupuesto.precio.neto, solo.precio.neto, 1e-9);
  assert.equal(enPresupuesto.nesting.chapas, solo.nesting.chapas);
  assert.ok(!enPresupuesto.nesting.compartido);
});

test('dice cuántas piezas más entran en la chapa sin costo de material', () => {
  const piezas = [
    { id: 'a', nombre: 'A', w: 600, h: 400, cantidad: 4, shape: makeShape(rect(0, 0, 600, 400)) },
    { id: 'b', nombre: 'B', w: 400, h: 250, cantidad: 4, shape: makeShape(rect(0, 0, 400, 250)) },
  ];
  const chapa = { w: 2440, h: 1220 };
  const opts = { separacion: DEFAULT_CONFIG.produccion.separacionPiezas, margen: DEFAULT_CONFIG.produccion.margenChapa };
  const base = nest(piezas, chapa, opts);
  const relleno = rellenoSinCosto(piezas, chapa, opts);

  assert.ok(relleno.length > 0, 'en una chapa a medio usar tiene que entrar algo más');
  // La pieza chica tiene que admitir al menos tantas extra como la grande
  const a = relleno.find((x) => x.id === 'a');
  const b = relleno.find((x) => x.id === 'b');
  if (a && b) assert.ok(b.extra >= a.extra, 'deberían entrar más piezas chicas que grandes');

  // Y lo que promete tiene que ser verdad: agregar esas piezas no suma chapa
  for (const s of relleno) {
    const con = nest(
      piezas.map((p) => (p.id === s.id ? { ...p, cantidad: p.cantidad + s.extra } : p)),
      chapa,
      opts
    );
    assert.equal(con.cantidadChapas, base.cantidadChapas, `${s.nombre}: +${s.extra} no debe agregar chapa`);
  }
});

test('si la chapa ya está llena no promete piezas extra', () => {
  const piezas = [{ id: 'a', nombre: 'A', w: 1200, h: 600, cantidad: 6, shape: makeShape(rect(0, 0, 1200, 600)) }];
  const chapa = { w: 2440, h: 1220 };
  const opts = { separacion: 5, margen: 10 };
  const relleno = rellenoSinCosto(piezas, chapa, opts);
  const base = nest(piezas, chapa, opts);
  for (const s of relleno) {
    const con = nest([{ ...piezas[0], cantidad: 6 + s.extra }], chapa, opts);
    assert.equal(con.cantidadChapas, base.cantidadChapas, 'no puede prometer lo que no entra');
  }
});

test('una pieza que no entra en la chapa no rompe el grupo', () => {
  const items = [
    { nombre: 'chica', shape: makeShape(rect(0, 0, 300, 200)), materialId: 'acero-sae1010', espesor: 2, cantidad: 2 },
    { nombre: 'gigante', shape: makeShape(rect(0, 0, 9000, 4000)), materialId: 'acero-sae1010', espesor: 2, cantidad: 1 },
  ];
  const r = cotizarPresupuesto({ items }, CTX);
  const gigante = r.items.find((i) => i.nombre === 'gigante');
  assert.ok(gigante.nesting.error, 'la pieza gigante tiene que seguir avisando que no entra');
  assert.ok(r.resumen.chapasTotal >= 1);
});

/* ================================================================== */

grupo('Gases de asistencia (3 kW)');

test('cada material declara sus gases con límite de espesor coherente', () => {
  for (const m of DEFAULT_MATERIALS) {
    assert.ok(Object.keys(m.procesos || {}).length > 0, `${m.id} no tiene procesos`);
    for (const [g, p] of Object.entries(m.procesos)) {
      assert.ok(GASES[g], `${m.id}: gas desconocido ${g}`);
      assert.ok(p.maxEspesor > 0, `${m.id}/${g} sin maxEspesor`);
      const maxTabla = Math.max(...Object.keys(p.speeds).map(Number));
      cerca(maxTabla, p.maxEspesor, p.maxEspesor * 0.35, `${m.id}/${g}: la tabla llega a ${maxTabla} y declara ${p.maxEspesor}`);
    }
    assert.ok(m.espesores.every((e) => e <= espesorMaximo(m) + 1e-9),
      `${m.id}: hay espesores en venta que no se pueden cortar a 3 kW`);
  }
});

test('la velocidad cae siempre al aumentar el espesor', () => {
  for (const m of DEFAULT_MATERIALS) {
    for (const [g, p] of Object.entries(m.procesos)) {
      const esp = Object.keys(p.speeds).map(Number).sort((a, b) => a - b);
      for (let i = 1; i < esp.length; i++) {
        assert.ok(p.speeds[esp[i]] < p.speeds[esp[i - 1]],
          `${m.id}/${g}: ${esp[i]} mm no es más lento que ${esp[i - 1]} mm`);
      }
    }
  }
});

test('con nitrógeno el acero fino corta más rápido que con oxígeno', () => {
  const vO2 = cuttingSpeed(acero, 2, 3, 'O2');
  const vN2 = cuttingSpeed(acero, 2, 3, 'N2');
  assert.ok(vN2 > vO2, 'en 2 mm el N2 a alta presión es más rápido');
});

test('con oxígeno el acero grueso corta más rápido que con nitrógeno', () => {
  const vO2 = cuttingSpeed(acero, 6, 3, 'O2');
  const vN2 = cuttingSpeed(acero, 6, 3, 'N2');
  assert.ok(vO2 > vN2, 'en 6 mm el aporte térmico del O2 gana');
});

test('el nitrógeno consume muchísimo más caudal que el oxígeno', () => {
  const fO2 = gasFlow(acero, 3, 'O2');
  const fN2 = gasFlow(acero, 3, 'N2');
  assert.ok(fN2 > fO2 * 20, `N2 ${fN2} m³/h vs O2 ${fO2} m³/h: la diferencia debe ser de un orden de magnitud`);
});

test('cortar inoxidable con aire sale muchísimo más barato que con nitrógeno', () => {
  const comp = compararGases(inox, 3, 3, DEFAULT_CONFIG.produccion.gases, 10000);
  const aire = comp.find((c) => c.gas === 'AIRE');
  const n2 = comp.find((c) => c.gas === 'N2');
  assert.ok(aire && n2);
  assert.ok(aire.costoGas < n2.costoGas / 5,
    `aire ${aire.costoGas.toFixed(0)} vs N2 ${n2.costoGas.toFixed(0)}: el ahorro debería ser grande`);
  assert.equal(comp[0].gas, 'AIRE', 'la comparativa debe venir ordenada de más barato a más caro');
});

test('el gas recomendado respeta el límite de espesor', () => {
  // El acero al carbono a 8 mm ya no se puede con N2 (máximo 6): debe caer a O2
  assert.equal(gasRecomendado(acero, 8), 'O2');
  assert.equal(gasRecomendado(inox, 3), 'N2');
  assert.ok(gasesDisponibles(acero, 12).every((g) => g.id === 'O2'));
});

test('la boquilla crece con el espesor', () => {
  assert.ok(boquilla(inox, 8, 'N2') > boquilla(inox, 1, 'N2'));
});

test('el costo del gas aparece en la cotización y pesa en inoxidable', () => {
  const sh = makeShape(rect(0, 0, 400, 300));
  const conN2 = cotizarItem({ shape: sh, materialId: 'inox-304', espesor: 3, cantidad: 20, gas: 'N2' }, CTX);
  const conAire = cotizarItem({ shape: sh, materialId: 'inox-304', espesor: 3, cantidad: 20, gas: 'AIRE' }, CTX);
  assert.ok(conN2.costos.gas > conAire.costos.gas * 3, 'el N2 tiene que costar bastante más que el aire');
  assert.equal(conN2.corte.gasTipo, 'N2');
  assert.ok(conN2.alternativasGas.length >= 2, 'debe ofrecer las alternativas de gas');
});

/* ================================================================== */
grupo('Costos reales (La Rioja)');

test('el cuadro tarifario de EDELAR tiene la categoría del taller', () => {
  const t = TARIFAS_EDELAR.categorias.find((c) => c.id === 'T2-BT1');
  assert.ok(t, 'falta T2-BT1');
  cerca(t.cargoPotenciaKWMes, 9296.43, 0.01);
  cerca(t.energiaResto, 106.4609, 0.0001);
  assert.ok(t.energiaValle < t.energiaResto, 'el valle tiene que ser más barato');
});

test('la potencia contratada pesa más que la energía consumida', () => {
  const e = calcularEstructura(DEFAULT_ESTRUCTURA);
  const potencia = e.items.find((i) => i.id === 'potencia');
  assert.ok(potencia, 'falta el ítem de potencia contratada');
  // 14 kW de consumo × $106,46 = ~$1.490/h de energía variable
  const energiaVariableHora = DEFAULT_MACHINE.costo.consumoKW * DEFAULT_MACHINE.costo.costoKWh;
  assert.ok(potencia.porHora > energiaVariableHora,
    `el cargo por potencia (${potencia.porHora.toFixed(0)} $/h) debería superar a la energía variable (${energiaVariableHora.toFixed(0)} $/h)`);
});

test('si el taller trabaja menos horas, el costo por hora sube', () => {
  const ocupado = calcularEstructura({ ...DEFAULT_ESTRUCTURA, ocupacionProductiva: 85 });
  const flojo = calcularEstructura({ ...DEFAULT_ESTRUCTURA, ocupacionProductiva: 40 });
  assert.ok(flojo.porHora > ocupado.porHora * 1.8, 'la estructura se reparte entre menos horas');
  cerca(ocupado.totalMes, flojo.totalMes, 1e-6, 'el gasto fijo del mes no cambia');
});

test('el costo real del operario casi duplica el básico de convenio', () => {
  const cnc = UOM_RAMA17.categorias.find((c) => c.id === 'operador-cnc');
  const c = costoHoraOperario(cnc.basicoHora, CARGAS_LABORALES);
  assert.ok(c.multiplicador > 1.6 && c.multiplicador < 2.2,
    `multiplicador fuera de rango: ${c.multiplicador.toFixed(2)}`);
  cerca(c.total, DEFAULT_MACHINE.costo.operarioHora, DEFAULT_MACHINE.costo.operarioHora * 0.05,
    'el valor cargado en la máquina debe coincidir con el cálculo de convenio');
});

test('el punto de equilibrio es coherente con la estructura', () => {
  const est = calcularEstructura(DEFAULT_ESTRUCTURA);
  const pe = puntoEquilibrio(est, 45);
  assert.ok(pe.facturacionNecesaria > est.totalMes, 'hay que facturar más que el gasto fijo');
  assert.ok(pe.porDiaHabil > 0);
});

test('el generador de nitrógeno conviene con consumo alto y no con consumo bajo', () => {
  const mucho = evaluarGeneradorN2({ consumoM3Mes: 4000, precioM3Actual: 1400 });
  const poco = evaluarGeneradorN2({ consumoM3Mes: 100, precioM3Actual: 1400 });
  assert.ok(mucho.conviene, 'con 4.000 m³/mes tiene que convenir');
  assert.ok(!poco.conviene, 'con 100 m³/mes no tiene que convenir');
  assert.ok(mucho.mesesRepago < poco.mesesRepago);
});

test('ingresos brutos se refleja en el precio', () => {
  const sh = makeShape(rect(0, 0, 300, 200));
  const base = { shape: sh, materialId: 'acero-sae1010', espesor: 3, cantidad: 20 };
  const con = cotizarItem(base, CTX);
  const sin = cotizarItem(base, {
    ...CTX,
    config: { ...DEFAULT_CONFIG, comercial: { ...DEFAULT_CONFIG.comercial, aplicarIIBB: false } },
  });
  assert.ok(con.precio.iibb > 0, 'debe calcular IIBB');
  assert.equal(sin.precio.iibb, 0);
  assert.ok(con.precio.neto >= sin.precio.neto);
});

/* ================================================================== */
grupo('Nesting de forma real');

test('el anidado por forma real coloca todas las piezas y no se sale de la chapa', () => {
  const triangulo = makeShape(polyline([[0, 0], [200, 0], [100, 170]], true));
  const r = nest(
    [{ id: 't', nombre: 'Triángulo', w: 200, h: 170, cantidad: 24, shape: triangulo, areaReal: 200 * 170 / 2 }],
    { w: 3000, h: 1500 },
    { margen: 10, separacion: 5, formaReal: true }
  );
  assert.equal(r.metodo, 'forma real');
  assert.equal(r.piezasColocadas, 24);
  for (const ch of r.chapas) {
    for (const p of ch.piezas) {
      assert.ok(p.x >= 10 - 1e-6 && p.y >= 10 - 1e-6, `pieza fuera del margen: ${p.x},${p.y}`);
      assert.ok(p.x + p.w <= ch.w + 1e-6, 'se pasa a lo ancho');
      assert.ok(p.y + p.h <= ch.h + 1e-6, 'se pasa a lo alto');
    }
  }
});

test('los triángulos se encastran: la forma real gana material sobre el rectángulo', () => {
  const triangulo = makeShape(polyline([[0, 0], [240, 0], [120, 200]], true));
  const items = [{ id: 't', nombre: 'Triángulo', w: 240, h: 200, cantidad: 40, shape: triangulo, areaReal: 240 * 200 / 2 }];
  const c = compararMetodos(items, { w: 3000, h: 1500 }, { margen: 10, separacion: 5 });
  assert.ok(c.formaReal.chapas <= c.rectangular.chapas,
    `forma real usó ${c.formaReal.chapas} chapas y el rectangular ${c.rectangular.chapas}`);
  console.log(`      → rectangular: ${c.rectangular.chapas} chapa(s) · forma real: ${c.formaReal.chapas} chapa(s)`);
});

test('las piezas del layout traen su polígono real para dibujarlas', () => {
  const disco = makeShape(circle(50, 50, 50));
  const r = nest([{ id: 'd', w: 100, h: 100, cantidad: 12, shape: disco, areaReal: Math.PI * 2500 }],
    { w: 1000, h: 800 }, { formaReal: true });
  const p = r.chapas[0].piezas[0];
  assert.ok(Array.isArray(p.poly) && p.poly.length > 8, 'debe traer el contorno en coordenadas de chapa');
  const dentro = p.poly.every(([x, y]) => x >= 0 && y >= 0 && x <= 1000 && y <= 800);
  assert.ok(dentro, 'el polígono dibujado tiene que caer dentro de la chapa');
});

test('sin geometría cae al motor rectangular sin romperse', () => {
  const r = nest([{ id: 'a', w: 200, h: 100, cantidad: 10 }], { w: 3000, h: 1500 }, { formaReal: true });
  assert.equal(r.metodo, 'rectangular');
  assert.equal(r.piezasColocadas, 10);
});

/* ================================================================== */
grupo('Nesting: rotación y acomodado');

const { PESOS, angulosMinimaArea } = await import('../src/core/nesting.js');

/** Configuración equivalente a la del motor anterior, para comparar. */
const NEST_VIEJO = { rotacionLibre: false, orden: 'lado', pesos: { y: 1, hueco: 0, alto: 0 } };

function piezasEnUnaChapa(shape, w, h, areaReal, opts = {}) {
  const chapa = { w: 2440, h: 1220 };
  const r = nest([{ id: 'x', nombre: 'p', w, h, cantidad: 400, shape, areaReal }], chapa,
    { margen: 10, separacion: 5, maxChapas: 1, ...opts });
  return r.chapas[0]?.piezas.length || 0;
}

test('el ángulo de mínima área encuentra el giro de una pieza en diagonal', () => {
  // Un rectángulo girado 30°: el mejor giro tiene que devolverlo a la horizontal
  const a = rad(30);
  const pts = [[0, 0], [200, 0], [200, 80], [0, 80]].map(([x, y]) => [
    x * Math.cos(a) - y * Math.sin(a),
    x * Math.sin(a) + y * Math.cos(a),
  ]);
  const angulos = angulosMinimaArea(pts, 2);
  const bueno = angulos.some((g) => {
    const d = Math.abs(((g - 330) % 180 + 180) % 180);
    return d < 3 || Math.abs(d - 90) < 3;
  });
  assert.ok(bueno, `esperaba un giro cerca de 330° o 60°, dio ${angulos.map((x) => x.toFixed(0)).join(', ')}`);
});

test('el anidado nunca queda peor que el motor anterior', () => {
  const casos = [
    ['triángulo', makeShape(polyline([[0, 0], [240, 0], [120, 200]], true)), 240, 200, 24000],
    ['perfil L', makeShape(polyline([[0, 0], [200, 0], [200, 60], [70, 60], [70, 180], [0, 180]], true)), 200, 180, 200 * 60 + 70 * 120],
    ['trapecio', makeShape(polyline([[0, 0], [300, 0], [220, 150], [80, 150]], true)), 300, 150, ((300 + 140) / 2) * 150],
    ['escuadra', makeShape(polyline([[0, 0], [220, 0], [220, 50], [50, 50], [50, 220], [0, 220]], true)), 220, 220, 220 * 50 + 50 * 170],
    ['disco', makeShape(circle(90, 90, 90)), 180, 180, Math.PI * 8100],
    ['placa', makeShape(rect(0, 0, 300, 200)), 300, 200, 60000],
  ];
  let viejas = 0;
  let nuevas = 0;
  for (const [nombre, sh, w, h, area] of casos) {
    const antes = piezasEnUnaChapa(sh, w, h, area, NEST_VIEJO);
    const ahora = piezasEnUnaChapa(sh, w, h, area);
    assert.ok(ahora >= antes,
      `en ${nombre} entraban ${antes} piezas y ahora entran ${ahora}: el multi-arranque debe incluir la variante conservadora`);
    viejas += antes;
    nuevas += ahora;
  }
  assert.ok(nuevas > viejas, 'en el conjunto tiene que haber mejora');
  console.log(`      → ${viejas} piezas antes, ${nuevas} ahora (+${(((nuevas - viejas) / viejas) * 100).toFixed(1)} %)`);
});

test('los triángulos ganan mucho al poder girarse', () => {
  const tri = makeShape(polyline([[0, 0], [240, 0], [120, 200]], true));
  const sinGiro = piezasEnUnaChapa(tri, 240, 200, 24000, NEST_VIEJO);
  const conGiro = piezasEnUnaChapa(tri, 240, 200, 24000);
  assert.ok(conGiro >= sinGiro * 1.15,
    `esperaba al menos 15 % más triángulos por chapa, pasó de ${sinGiro} a ${conGiro}`);
});

test('las rotaciones repetidas se descartan: un disco no se prueba ocho veces', () => {
  // Si no se dedupliaran, un disco tardaría varias veces más que una placa de
  // área parecida. Se compara el tiempo relativo, no un umbral en ms.
  const disco = makeShape(circle(90, 90, 90));
  const placa = makeShape(rect(0, 0, 180, 180));
  const t0 = Date.now();
  piezasEnUnaChapa(disco, 180, 180, Math.PI * 8100);
  const tDisco = Date.now() - t0;
  const t1 = Date.now();
  piezasEnUnaChapa(placa, 180, 180, 32400);
  const tPlaca = Date.now() - t1;
  assert.ok(tDisco < tPlaca * 6 + 250,
    `el disco tardó ${tDisco} ms contra ${tPlaca} ms de la placa: parece que prueba rotaciones repetidas`);
});

test('una pieza marcada como no rotable se respeta', () => {
  const tri = makeShape(polyline([[0, 0], [240, 0], [120, 200]], true));
  const r = nest([{ id: 'x', nombre: 'p', w: 240, h: 200, cantidad: 20, shape: tri, areaReal: 24000, rotable: false }],
    { w: 2440, h: 1220 }, { margen: 10, separacion: 5 });
  for (const ch of r.chapas) for (const p of ch.piezas) {
    assert.equal(p.rot, 0, 'no se puede girar una pieza marcada como no rotable');
  }
});

test('los pesos del criterio de colocación están calibrados, no en cero', () => {
  assert.ok(PESOS.hueco > 0, 'sin el término de hueco las piezas dejan huecos atrapados');
  assert.ok(PESOS.y > 0);
});

/* ================================================================== */
grupo('Tarifario por m²');

const { generarTarifario, evaluarTarifaPlana, techoDeTarifa, BANDAS } = await import('../src/core/tarifario.js');

test('genera una fila por espesor y una columna por banda', () => {
  const t = generarTarifario(CTX, { materialId: 'acero-sae1010', cotizarItem });
  assert.equal(t.filas.length, acero.espesores.length);
  for (const f of t.filas) {
    if (f.error) continue;
    for (const b of BANDAS) {
      assert.ok(f.bandas[b.id], `falta la banda ${b.id} en ${f.espesor} mm`);
      assert.ok(f.bandas[b.id].precioM2 > 0);
    }
  }
});

test('a más espesor, más caro el m²', () => {
  const t = generarTarifario(CTX, { materialId: 'acero-sae1010', cotizarItem });
  const validas = t.filas.filter((f) => !f.error);
  for (let i = 1; i < validas.length; i++) {
    assert.ok(
      validas[i].bandas.media.precioM2 > validas[i - 1].bandas.media.precioM2,
      `${validas[i].espesor} mm no es más caro que ${validas[i - 1].espesor} mm`
    );
  }
});

test('a más densidad de corte, más caro el m²', () => {
  const t = generarTarifario(CTX, { materialId: 'acero-sae1010', cotizarItem });
  const f = t.filas.find((x) => x.espesor === 2 && !x.error);
  assert.ok(f);
  assert.ok(f.bandas.simple.precioM2 < f.bandas.media.precioM2);
  assert.ok(f.bandas.media.precioM2 < f.bandas.compleja.precioM2);
  assert.ok(f.bandas.compleja.precioM2 < f.bandas.perforada.precioM2);
});

test('sin material el precio es menor que con material', () => {
  const con = generarTarifario(CTX, { materialId: 'acero-sae1010', cotizarItem, conMaterial: true });
  const sin = generarTarifario(CTX, { materialId: 'acero-sae1010', cotizarItem, conMaterial: false });
  const fc = con.filas.find((f) => f.espesor === 2);
  const fs = sin.filas.find((f) => f.espesor === 2);
  assert.ok(fs.bandas.media.precioM2 < fc.bandas.media.precioM2,
    'si el cliente trae la chapa tiene que salir más barato');
  // La diferencia tiene que ser del orden del material
  const dif = fc.bandas.media.precioM2 - fs.bandas.media.precioM2;
  cerca(dif, fc.bandas.media.materialM2 * 1.45 * 1.03, fc.bandas.media.materialM2 * 0.35,
    'la diferencia debería ser el material más su margen');
});

test('el material domina el costo en chapa fina', () => {
  const t = generarTarifario(CTX, { materialId: 'acero-sae1010', cotizarItem });
  const fino = t.filas.find((f) => f.espesor === 1.2);
  const d = fino.bandas.simple;
  const pesoMaterial = d.materialM2 / d.costoM2;
  assert.ok(pesoMaterial > 0.8,
    `en 1,2 mm simple el material debería ser >80 % del costo, dio ${(pesoMaterial * 100).toFixed(0)} %`);
});

test('una tarifa plana deja de convenir a partir de cierto espesor', () => {
  const t = generarTarifario(CTX, { materialId: 'acero-sae1010', cotizarItem });
  const ev = evaluarTarifaPlana(t, 90000);
  assert.ok(ev.primerEspesorAPerdida, 'con $90.000/m² tiene que haber un espesor donde se pierda');
  // En chapa fina y simple tiene que estar sano
  const fino = ev.filas.find((f) => f.espesor === 1.2);
  assert.equal(fino.bandas.simple.estado, 'sano');
  // En chapa gruesa tiene que estar en pérdida
  const grueso = ev.filas.find((f) => f.espesor === 6);
  assert.equal(grueso.bandas.simple.estado, 'perdida');
});

test('el techo de la tarifa baja cuando sube la densidad', () => {
  const t = generarTarifario(CTX, { materialId: 'acero-sae1010', cotizarItem });
  const techoSimple = techoDeTarifa(t, 90000, 'simple');
  const techoCompleja = techoDeTarifa(t, 90000, 'compleja');
  assert.ok(techoSimple != null, 'con $90.000 tiene que haber techo en simple');
  assert.ok(techoCompleja <= techoSimple,
    'una pieza compleja no puede tolerar más espesor que una simple a la misma tarifa');
});

test('una tarifa más alta corre el techo hacia arriba', () => {
  const t = generarTarifario(CTX, { materialId: 'acero-sae1010', cotizarItem });
  assert.ok(techoDeTarifa(t, 200000, 'media') > techoDeTarifa(t, 90000, 'media'));
});

test('el tarifario no inventa espesores que la máquina no corta', () => {
  const t = generarTarifario(CTX, { materialId: 'inox-304', cotizarItem, espesores: [3, 12, 20] });
  const f20 = t.filas.find((x) => x.espesor === 20);
  assert.ok(f20.error, 'inox de 20 mm a 3 kW tiene que dar error, no precio');
  const f3 = t.filas.find((x) => x.espesor === 3);
  assert.ok(!f3.error && f3.bandas.media.precioM2 > 0);
});

/* ================================================================== */
grupo('PDF');

test('el generador produce un PDF con cabecera y EOF', () => {
  const doc = new PDF();
  doc.texto(40, 40, 'KORT · Prueba de acentos: ñ á é í ó ú °', { size: 12, bold: true });
  doc.rect(40, 60, 200, 30, 'f');
  const bytes = doc.save();
  const txt = Buffer.from(bytes).toString('latin1');
  assert.ok(txt.startsWith('%PDF-1.4'));
  assert.ok(txt.includes('%%EOF'));
  assert.ok(txt.includes('/Type /Catalog'));
  assert.ok(txt.includes('xref'));
});

test('el ancho de texto es coherente con el tamaño de fuente', () => {
  const a = anchoTexto('KORT', 10);
  const b = anchoTexto('KORT', 20);
  cerca(b, a * 2, 1e-9);
  assert.ok(anchoTexto('MMMM', 10) > anchoTexto('iiii', 10));
});

test('el presupuesto completo se genera y tiene tamaño razonable', () => {
  const sh = makeShape(rect(0, 0, 300, 200, 10), [circle(80, 100, 12), circle(220, 100, 12)]);
  const coti = cotizarPresupuesto({
    items: [
      { nombre: 'Base de soporte', shape: sh, materialId: 'acero-sae1010', espesor: 4, cantidad: 25, plegado: { pliegues: 2, largoPliegue: 200, angulo: 90 } },
      { nombre: 'Tapa', shape: makeShape(rect(0, 0, 305, 205)), materialId: 'inox-304', espesor: 1.5, cantidad: 25, acabadoId: 'pulido' },
    ],
  }, CTX);
  const bytes = generarPresupuestoPDF({
    presupuesto: {
      numero: '2026-0001',
      fecha: new Date('2026-08-11').toISOString(),
      cliente: { nombre: 'Metalúrgica del Sur S.R.L.', cuit: '30-12345678-9', telefono: '11 4444-5555', email: 'compras@ejemplo.com' },
      notas: 'Se cotiza según plano PL-2026-114 revisión B.',
      entregaDias: 10,
    },
    cotizacion: coti,
    config: DEFAULT_CONFIG,
  });
  assert.ok(bytes.length > 3000, `PDF demasiado chico: ${bytes.length} bytes`);
  const txt = Buffer.from(bytes).toString('latin1');
  assert.ok(txt.includes('%%EOF'));
  const salida = path.join(__dirname, 'salida-presupuesto.pdf');
  fs.writeFileSync(salida, bytes);
  console.log(`      → muestra guardada en tests/salida-presupuesto.pdf (${(bytes.length / 1024).toFixed(1)} kB)`);
});

test('el DXF de una pieza de biblioteca se guarda como muestra', () => {
  const r = construir('bandeja', { L: 300, A: 200, H: 60 }, { espesor: 2, material: acero });
  const dxf = generarDXF([{ shape: r.shape }], {
    titulo: 'KORT - Bandeja 300x200x60',
    lineasPlegado: r.pliegues,
  });
  fs.writeFileSync(path.join(__dirname, 'salida-bandeja.dxf'), dxf, 'utf8');
  const rel = leerDXF(dxf);
  assert.equal(rel.piezas.length, 1, 'el DXF generado debe volver a leerse como una pieza');
  console.log(`      → muestra guardada en tests/salida-bandeja.dxf`);
});

/* ================================================================== */
grupo('Base de datos (SQLite)');

const { DB, fusionarMateriales, fusionarMaquinas, fusionarConfig } = await import('../src/server/db.js');
const dirTmp = path.join(__dirname, '.tmp-db');
fs.rmSync(dirTmp, { recursive: true, force: true });
let dbt = null;

test('crea el esquema y siembra los datos de fábrica', () => {
  dbt = new DB(dirTmp);
  assert.ok(dbt.version >= 2, `versión de esquema inesperada: ${dbt.version}`);
  assert.equal(dbt.leerCrudo('materiales').length, DEFAULT_MATERIALS.length);
  assert.ok(dbt.leerCrudo('config').estructura, 'la config debe traer la estructura');
});

test('numeración correlativa por año, sin repetir', () => {
  const a = dbt.siguienteNumero('P');
  const b = dbt.siguienteNumero('P');
  assert.notEqual(a, b);
  assert.ok(/^\d{4}-\d{4}$/.test(a), `formato inesperado: ${a}`);
  assert.equal(Number(b.split('-')[1]), Number(a.split('-')[1]) + 1);
});

test('alta, lectura, modificación y baja de un cliente', () => {
  const c = dbt.crear('clientes', { nombre: 'Talleres Ñandú SRL', cuit: '30-11111111-1' });
  assert.equal(dbt.obtener('clientes', c.id).nombre, 'Talleres Ñandú SRL', 'los acentos deben sobrevivir');
  dbt.actualizar('clientes', c.id, { telefono: '3804-111111' });
  assert.equal(dbt.obtener('clientes', c.id).telefono, '3804-111111');
  assert.ok(dbt.borrar('clientes', c.id));
  assert.equal(dbt.obtener('clientes', c.id), null);
});

test('guarda un presupuesto y lo puede consultar por material', () => {
  const cli = dbt.crear('clientes', { nombre: 'Metalúrgica del Sur' });
  dbt.crear('presupuestos', {
    numero: dbt.siguienteNumero('P'), fecha: '2026-08-12', estado: 'aprobado',
    clienteId: cli.id, cliente: { nombre: cli.nombre },
    items: [{ nombre: 'Bandeja', materialId: 'inox-304', espesor: 2, gas: 'N2', cantidad: 20, _pesoTotal: 31.2, _precioNeto: 850000, _costoTotal: 600000 }],
    resumen: { total: 1028500, costo: 600000, utilidad: 250000, pesoTotal: 31.2, piezasTotales: 20, chapasTotal: 1 },
  });
  const porMat = dbt.porMaterial();
  assert.equal(porMat.length, 1);
  assert.equal(porMat[0].material_id, 'inox-304');
  cerca(porMat[0].kg, 31.2, 0.01);
  const st = dbt.estadisticas();
  assert.equal(st.aprobados, 1);
  cerca(st.tasaConversion, 100, 0.01);
});

test('el historial de precios registra cada cambio', () => {
  const antes = dbt.historialPrecios('acero-sae1010').length;
  const mats = dbt.leerCrudo('materiales');
  mats.find((m) => m.id === 'acero-sae1010').precioKg = 3500;
  dbt.escribir('materiales', mats);
  const hist = dbt.historialPrecios('acero-sae1010');
  assert.equal(hist.length, antes + 1, 'debe agregar una entrada');
  cerca(hist[0].precio_kg, 3500, 0.01);
  // Guardar sin cambiar el precio no debe ensuciar el historial
  dbt.escribir('materiales', dbt.leerCrudo('materiales'));
  assert.equal(dbt.historialPrecios('acero-sae1010').length, antes + 1);
});

test('la búsqueda de texto completo encuentra con acentos y parcial', () => {
  const r = dbt.buscar('metalur');
  assert.ok(r.length >= 1, 'debe encontrar al cliente o el presupuesto');
  assert.ok(r.some((x) => /Metal/i.test(x.titulo)));
});

test('respaldo y restauración conservan todo', () => {
  const backup = dbt.exportarTodo();
  const clientesAntes = dbt.lista('clientes').length;
  const presAntes = dbt.lista('presupuestos').length;
  dbt.importarTodo(backup);
  assert.equal(dbt.lista('clientes').length, clientesAntes);
  assert.equal(dbt.lista('presupuestos').length, presAntes);
  assert.ok(backup.historialPrecios.length > 0, 'el respaldo debe incluir el historial de precios');
});

test('la migración del formato viejo conserva precios pero descarta tablas obsoletas', () => {
  const viejo = [{
    id: 'acero-sae1010', nombre: 'Acero SAE 1010', precioKg: 9999,
    chapaStd: { w: 2000, h: 1000 }, espesores: [2, 3, 99],
    speeds: { 2: 5200, 3: 3400 }, pierce: { 2: 0.3 }, // formato viejo
  }];
  const fusion = fusionarMateriales(DEFAULT_MATERIALS, viejo);
  const acero = fusion.find((m) => m.id === 'acero-sae1010');
  assert.equal(acero.precioKg, 9999, 'debe conservar el precio que cargó el usuario');
  assert.deepEqual(acero.chapaStd, { w: 2000, h: 1000 }, 'debe conservar la medida de chapa');
  assert.ok(acero.procesos?.O2, 'debe quedarse con la tabla nueva por gas');
  assert.ok(!acero.speeds, 'debe descartar la tabla vieja');
  assert.ok(!acero.espesores.includes(99), 'debe filtrar espesores imposibles');
});

test('la migración de máquinas descarta el overhead viejo', () => {
  const viejas = [{ tipo: 'laser', potenciaKW: 4, costo: { valorEquipo: 111, operarioHora: 5000, overheadHora: 3000 } }];
  const f = fusionarMaquinas([DEFAULT_MACHINE], viejas);
  assert.equal(f[0].potenciaKW, 4, 'conserva la potencia calibrada');
  assert.equal(f[0].costo.valorEquipo, 111);
  assert.equal(f[0].costo.overheadHora, undefined, 'el overhead ya no existe: ahora es la estructura');
  assert.ok(f[0].costo.dedicacionOperario > 0, 'debe traer los campos nuevos');
});

test('la migración de config no arrastra los precios de gas viejos', () => {
  const vieja = { comercial: { margen: 60, tipoCambio: 1200 }, produccion: { gases: { N2: 1400, O2: 900 }, separacionPiezas: 8 } };
  const f = fusionarConfig(DEFAULT_CONFIG, vieja);
  assert.equal(f.comercial.margen, 60, 'conserva el margen del usuario');
  assert.equal(f.produccion.separacionPiezas, 8);
  assert.equal(f.produccion.gases.O2, DEFAULT_CONFIG.produccion.gases.O2, 'los gases se recargan con el modelo nuevo');
  assert.ok(f.estructura, 'la estructura nueva tiene que estar');
});

if (dbt) {
  dbt.cerrar();
  fs.rmSync(dirTmp, { recursive: true, force: true });
}

/* ================================================================== */

console.log(`\n${'─'.repeat(54)}`);
if (fallos === 0) {
  console.log(`\x1b[32m\x1b[1m  ${ok} verificaciones superadas. Núcleo OK.\x1b[0m\n`);
  process.exit(0);
} else {
  console.log(`\x1b[31m\x1b[1m  ${fallos} fallo(s) de ${ok + fallos} verificaciones\x1b[0m\n`);
  for (const { nombre, e } of errores) {
    console.log(`\x1b[31m▸ ${nombre}\x1b[0m`);
    console.log(`  ${e.stack?.split('\n').slice(0, 4).join('\n  ')}\n`);
  }
  process.exit(1);
}
