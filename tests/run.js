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
  makeShapeMulti, partesDe, esMultiParte, firmaShape,
  flattenPath,
  pathBBox,
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
import { nest, piezasPorChapa, compararMetodos, rellenoSinCosto, limpiarCacheNesting } from '../src/core/nesting.js';
import { rectanguloEnHueco, huecosDe, aprovecharHuecos } from '../src/core/huecos.js';
import { DEFAULT_GUILLOTINA, esRectangularPelada, puedeGuillotinarse, tiempoGuillotina, espesorMaximoGuillotina } from '../src/core/guillotina.js';
import { panelDecorativo, MOTIVOS, PATRONES, ligamentoMinimo, tamanioParaGrilla } from '../src/core/decorativo.js';
import { catalogo, variantes, resumenCatalogo, paramsDeVariante } from '../src/core/variantes.js';
import { generarDXF } from '../src/core/dxf-write.js';
import { leerDXF } from '../src/core/dxf-read.js';
import { cotizarItem, cotizarPresupuesto, planificarNesting, DEFAULT_CONFIG, redondear, descuentoPorCantidad } from '../src/core/pricing.js';
import { construir, PIEZAS, paramsPorDefecto, getPieza } from '../src/core/library.js';
import { revisarDatos, SETUP_PROGRAMA_REF, CARGA_CHAPA_REF, APROVECHAMIENTO_REF } from '../src/core/salud.js';
import { evaluarVigencia, materialesQueSeMovieron, impactoMaterialRapido, carteraEnRiesgo } from '../src/core/vigencia.js';
import { rentabilidad, referenciaDelTaller, pisoDelTaller, evaluarTrabajo, ordenarPorRendimiento } from '../src/core/rentabilidad.js';
import { detectarLineasComunes, ahorroLineaComun, explicarLineaComun, evaluarLineaComun } from '../src/core/linea-comun.js';
import { costoConsumiblesHora, estadoConsumiblesPorHoras, revisarConsumiblesHora, CONSUMIBLES_LASER } from '../src/core/consumibles.js';
import {
  asignacionesRetazoDeItems,
  candidatosRetazo,
  consumirRetazo,
  consumirRetazos,
  liberarRetazos,
  pesoRetazoKg,
  reservarRetazos,
  resumenStockRetazos,
  superficieRetazoM2,
  unidadesDisponibles,
} from '../src/core/retazos.js';
import { calibrar, factorPara, explicarFactor, MINIMO_TRABAJOS } from '../src/core/calibracion.js';
import { agendaProduccion, capacidadDiariaSegundos, segundosRestantesOrden } from '../src/core/agenda.js';
import { planificarMicroUniones, aplicarMicroUniones, anchoMicroUnion } from '../src/core/micro-uniones.js';
import { planReposicion, requerimientosDeCotizacion } from '../src/core/reposicion.js';
import { normalizarMuestra, resumirTelemetria, serieTelemetria } from '../src/core/telemetria.js';
import { crearPlanProduccion, aplicarEventoTaller, resumenTaller, retazoSeguroDePrograma } from '../src/core/produccion.js';
import { aplicarEventoCalidad, evaluarMedicion, resumenCalidad } from '../src/core/calidad.js';
import { auditarFabricabilidad } from '../src/core/fabricabilidad.js';
import { segmentarPieza } from '../src/core/segmentacion.js';
import { explicarItem, explicarTarifa, explicacionEnTexto } from '../src/core/explicacion.js';
import { listaDeCompra, pedidoEnTexto } from '../src/core/compras.js';
import { telefonoWhatsApp, mensajePresupuesto, enlaceWhatsApp, enlaceMail } from '../src/core/envio.js';
import { vectorizar, aPieza, escalaDesdeReferencia } from '../src/core/vectorizar.js';
import { leerPlanoPDF, planoAPieza, MM_POR_PUNTO } from '../src/core/pdf-plano.js';
import { construirMesh } from '../src/core/mesh3d.js';
import { PDF, anchoTexto } from '../src/core/pdf.js';
import { generarPresupuestoPDF, generarEtiquetasPiezasPDF } from '../src/core/quote-pdf.js';
import { aplicarPreciosProveedor, importarPreciosProveedor, numeroProveedor } from '../src/core/importar-precios.js';

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

/**
 * Texto visible de un PDF nuestro.
 *
 * Los flujos van sin comprimir, así que alcanza con juntar los strings de los
 * operadores `Tj` y deshacer los escapes octales de los acentos. Verificar
 * sobre el texto y no sobre el código es lo que permite atajar una línea
 * agregada más adelante que filtre lo que no debe.
 */
function textoDelPDF(bytes) {
  const crudo = Buffer.from(bytes).toString('latin1');
  const partes = crudo.match(/\(([^)]*)\)\s*Tj/g) || [];
  return partes
    .map((s) => s.slice(1, s.lastIndexOf(')')).replace(/\\([0-7]{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8))))
    .join('\n');
}

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

test('interpreta precios argentinos de proveedor', () => {
  assert.equal(numeroProveedor('$ 3.850,50'), 3850.5);
  assert.equal(numeroProveedor('12,4'), 12.4);
  assert.equal(numeroProveedor('18.600'), 18600);
  assert.equal(numeroProveedor('22,000.75'), 22000.75);
});

test('importa una lista CSV de proveedor y matchea por nombre o id', () => {
  const csv = [
    'Codigo;Descripcion;$/kg',
    'acero-sae1010;SAE 1010 laminado;4.450',
    'x;Inoxidable 304 brillante;10.900',
    'zzz;Fantasia;1.000',
    'aluminio-5052;Aluminio 5052;0',
  ].join('\n');
  const r = importarPreciosProveedor(csv, DEFAULT_MATERIALS);
  assert.equal(r.cambios.length, 2);
  assert.equal(r.cambios[0].id, 'acero-sae1010');
  assert.equal(r.cambios[0].nuevo, 4450);
  assert.equal(r.cambios[1].id, 'inox-304');
  assert.ok(r.ignoradas.some((x) => /no reconocido/.test(x.motivo)));
  assert.ok(r.ignoradas.some((x) => /invalido/.test(x.motivo)));

  const actualizados = aplicarPreciosProveedor(DEFAULT_MATERIALS, r.cambios);
  assert.equal(actualizados.find((m) => m.id === 'acero-sae1010').precioKg, 4450);
  assert.equal(actualizados.find((m) => m.id === 'inox-304').precioKg, 10900);
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

function entidadesDXF(dxf) {
  const inicio = dxf.indexOf('0\r\nSECTION\r\n2\r\nENTITIES');
  const fin = dxf.indexOf('0\r\nENDSEC', inicio);
  const toks = dxf.slice(inicio, fin).split(/\r?\n/);
  const entidades = [];
  let actual = null;
  for (let i = 0; i < toks.length - 1; i += 2) {
    const code = toks[i];
    const value = toks[i + 1];
    if (code === '0') {
      if (actual) entidades.push(actual);
      actual = value === 'LINE' || value === 'ARC' || value === 'CIRCLE' ? { tipo: value } : null;
    } else if (actual) {
      actual[code] = value;
    }
  }
  if (actual) entidades.push(actual);
  return entidades;
}

const entidadesCorte = (dxf) => entidadesDXF(dxf).filter((e) => e['8'] === 'CORTE' || e['8'] === 'CORTE_INTERIOR');

test('escribe un DXF válido con las secciones obligatorias', () => {
  const sh = makeShape(rect(0, 0, 100, 60, 8), [circle(50, 30, 10)]);
  const dxf = generarDXF([sh], { titulo: 'Prueba' });
  assert.ok(dxf.includes('SECTION'));
  assert.ok(dxf.includes('ENTITIES'));
  assert.ok(dxf.includes('EOF'));
  assert.ok(dxf.includes('CORTE'));
  assert.ok(dxf.includes('CIRCLE') || dxf.includes('ARC'));
});

test('el DXF de producción corta interiores antes que exteriores', () => {
  const sh = makeShape(rect(0, 0, 100, 60), [circle(50, 30, 10)]);
  const entidades = entidadesCorte(generarDXF([sh]));
  assert.equal(entidades[0]['8'], 'CORTE_INTERIOR', 'el agujero debe salir antes que el contorno exterior');
  assert.equal(entidades.at(-1)['8'], 'CORTE', 'el exterior libera la pieza al final');
});

test('una pieza anidada en un agujero se corta antes de abrir ese agujero', () => {
  const marco = makeShape(rect(0, 0, 200, 200), [rect(50, 50, 100, 100)]);
  const piezaAdentro = makeShape(rect(0, 0, 20, 20));
  const entidades = entidadesCorte(generarDXF([{ shape: marco }, { shape: piezaAdentro, dx: 90, dy: 90 }]));
  const primerCorte = entidades.findIndex((e) => e['8'] === 'CORTE');
  const primerInterior = entidades.findIndex((e) => e['8'] === 'CORTE_INTERIOR');
  assert.ok(primerCorte >= 0 && primerInterior >= 0);
  assert.ok(primerCorte < primerInterior, 'la pieza chica debe cortarse antes que el agujero que la rodea');
  assert.equal(Number(entidades[primerCorte]['10']), 90, 'el primer exterior es la pieza contenida, no el marco grande');
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

test('la transición cuadrado-redondo conserva las longitudes verdaderas', () => {
  // Es la prueba que importa en un desarrollo: si los bordes desarrollados no
  // miden lo mismo que en el espacio, la pieza no cierra al rolarla y se tira
  // la chapa. Se verifica contra el perímetro de cada boca.
  for (const [lado, dia, h] of [[400, 250, 300], [600, 300, 400], [800, 200, 500]]) {
    const r = construir('transicion', { lado, dia, h, divisiones: 10 }, { espesor: 2, material: acero });
    const pts = flattenPath(r.shape.outer, 0.1);

    let inferior = 0;
    for (let i = 0; i < 4; i++) inferior += Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
    cerca(inferior, r.info.perimetroCuadrado, r.info.perimetroCuadrado * 0.01,
      'el borde de la boca cuadrada tiene que medir su perímetro');

    // El borde superior, descartando el segmento de la costura
    const seg = [];
    for (let i = 5; i < pts.length - 1; i++) seg.push(Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]));
    seg.sort((a, b) => a - b);
    const superior = seg.slice(0, seg.length - 1).reduce((a, b) => a + b, 0);
    cerca(superior, r.info.perimetroRedondo, r.info.perimetroRedondo * 0.02,
      'el borde de la boca redonda tiene que medir su perímetro');
  }
});

test('el desarrollo de la abrazadera va por la fibra neutra, no por el diámetro', () => {
  /* Error clásico: desarrollar el arco con el diámetro exterior del caño. La
     abrazadera sale larga y no aprieta. El arco tiene que medir entre el
     semiperímetro del caño y el de la cara exterior de la chapa. */
  for (const [dia, t] of [[60, 2], [110, 2], [32, 1.5]]) {
    const r = construir('abrazadera-cano', { diaCano: dia, pata: 35 }, { espesor: t, material: acero });
    const interior = (Math.PI * dia) / 2;
    const exterior = (Math.PI * (dia + 2 * t)) / 2;
    assert.ok(
      r.info.arcoDesarrollado > interior && r.info.arcoDesarrollado < exterior,
      `Ø${dia} en ${t} mm: el arco dio ${r.info.arcoDesarrollado.toFixed(1)} y tiene que caer entre ${interior.toFixed(1)} y ${exterior.toFixed(1)}`
    );
    cerca(r.info.desarrollo, r.info.arcoDesarrollado + 2 * 35, 0.01, 'el desarrollo es el arco más las dos patas');
  }
});

test('el parante de rack y el estante comparten el paso de ranuras', () => {
  // Si el paso no se respeta, el estante no encastra: es el fallo que aparece
  // recién en el armado, con la chapa ya cortada.
  const paso = 50;
  const r = construir('parante-rack', { altura: 2000, paso, extremos: 60, perfil: 'L' },
    { espesor: 2, material: acero });
  // (2000 − 2×60) / 50 + 1 = 38,6 → 38 ranuras por ala, dos alas
  assert.equal(r.info.ranurasPorAla, 38, `dio ${r.info.ranurasPorAla} ranuras por ala`);
  assert.equal(r.info.ranuras, 76);

  // Y el perfil C tiene tres alas ranuradas, no dos
  const c = construir('parante-rack', { altura: 2000, paso, extremos: 60, perfil: 'C' },
    { espesor: 2, material: acero });
  assert.equal(c.info.ranuras, 38 * 3, 'el perfil C ranura las tres caras');
});

test('las piezas de estantería y racks se construyen en todos los espesores usables', () => {
  /* Mismo criterio que las plantillas de plegado: una pieza con cotas de
     fantasía compila igual y falla en la plegadora. Acá se verifica que el
     desarrollo exista, tenga área y que ninguna ala quede por debajo del ala
     mínima de su matriz. */
  const nuevas = ['parante-rack', 'estante-rack', 'mensula-pared', 'larguero-rack', 'peldano-escalera', 'abrazadera-cano'];
  for (const id of nuevas) {
    for (const t of [1.5, 2, 3]) {
      const r = construir(id, {}, { espesor: t, material: acero });
      const b = shapeBBox(r.shape);
      assert.ok(shapeArea(r.shape) > 0, `${id} en ${t} mm no tiene área`);
      assert.ok(b.w > 0 && b.h > 0, `${id} en ${t} mm no tiene desarrollo`);
      assert.ok(!(r.avisos || []).some((a) => a.nivel === 'error'),
        `${id} en ${t} mm da error: ${(r.avisos || []).find((a) => a.nivel === 'error')?.msg}`);
      // Nada puede quedar fuera de la chapa más grande que compra el taller
      assert.ok(Math.min(b.w, b.h) <= 1500, `${id} en ${t} mm no entra en ninguna chapa: ${b.w}×${b.h}`);
    }
  }
});

test('el estante avisa cuando la luz es demasiada para el ala', () => {
  const flojo = construir('estante-rack', { ancho: 1200, fondo: 400, ala: 20 }, { espesor: 1.5, material: acero });
  assert.ok(flojo.avisos.some((a) => a.nivel === 'aviso' && /pandear/.test(a.msg)),
    'un estante de 1200 mm con ala de 20 tiene que avisar');
  const firme = construir('estante-rack', { ancho: 600, fondo: 400, ala: 40 }, { espesor: 2, material: acero });
  assert.ok(!firme.avisos.some((a) => /pandear/.test(a.msg)), 'uno de 600 con ala de 40 no debe avisar');
  // Y la carga admisible tiene que crecer con el espesor y caer con la luz
  const grueso = construir('estante-rack', { ancho: 600, fondo: 400, ala: 40 }, { espesor: 3, material: acero });
  assert.ok(grueso.info.cargaAdmisibleKg > firme.info.cargaAdmisibleKg, 'más espesor tiene que aguantar más');
  const largo = construir('estante-rack', { ancho: 1200, fondo: 400, ala: 40 }, { espesor: 2, material: acero });
  assert.ok(largo.info.cargaAdmisibleKg < firme.info.cargaAdmisibleKg, 'más luz tiene que aguantar menos');
});

test('la tolva piramidal usa la altura inclinada, no la vertical', () => {
  // Error clásico: cortar el faldón con la altura de la tolva. Queda corto y
  // no llega, porque el retiro lateral alarga el faldón.
  const r = construir('tolva-piramidal',
    { supA: 600, supB: 600, infA: 200, infB: 200, h: 400, pestana: 0 },
    { espesor: 2, material: acero });
  const retiro = (600 - 200) / 2;
  const esperada = Math.sqrt(400 * 400 + retiro * retiro);
  cerca(r.info.alturaInclinada, esperada, 0.5);
  assert.ok(r.info.alturaInclinada > 400, 'la inclinada siempre supera a la vertical');
  const b = shapeBBox(r.shape);
  cerca(b.h, esperada, 1, 'el faldón cortado tiene que tener esa altura');
});

test('el piñón sale con el diámetro primitivo de norma', () => {
  // Dp = paso / sen(180/z)
  for (const [z, paso] of [[19, 12.7], [25, 15.875], [12, 9.525]]) {
    const r = construir('pinon', { z, paso: String(paso) }, { espesor: 4, material: acero });
    const esperado = paso / Math.sin(Math.PI / z);
    cerca(r.info.primitivo, esperado, 0.01, `z=${z} paso=${paso}`);
    assert.ok(r.info.exterior > r.info.primitivo, 'el exterior tiene que superar al primitivo');
  }
});

test('la brida cuadrada pone los pernos que se le piden', () => {
  const cuatro = construir('brida-cuadrada', { ochoPernos: false, diaInt: 80 }, { espesor: 3, material: acero });
  const ocho = construir('brida-cuadrada', { ochoPernos: true, diaInt: 80 }, { espesor: 3, material: acero });
  // agujero central + pernos
  assert.equal(cuatro.shape.holes.length, 5);
  assert.equal(ocho.shape.holes.length, 9);
});

test('el anillo partido es un solo contorno, sin agujero suelto', () => {
  const entero = construir('anillo', { partido: false }, { espesor: 3, material: acero });
  const partido = construir('anillo', { partido: true }, { espesor: 3, material: acero });
  assert.equal(entero.shape.holes.length, 1, 'el entero tiene su agujero interior');
  assert.equal(partido.shape.holes.length, 0,
    'el partido es una C: si dejara el agujero, el interior se caería como pieza suelta');
});

test('la bandeja portacables no perfora las alas', () => {
  const r = construir('bandeja-portacables',
    { ancho: 200, altura: 60, largo: 1000, perforada: true, diaUnion: 0 },
    { espesor: 1.5, material: acero });
  const bd = r.desarrollo.pliegues[0].BD;
  const x1 = 60 - bd / 2;
  const x2 = x1 + 200 - bd;
  for (const h of r.shape.holes) {
    const b = pathBBox(h);
    assert.ok(b.minX > x1 && b.maxX < x2,
      'perforar el ala la debilita justo donde trabaja: los agujeros van sólo en el fondo');
  }
});

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

grupo('Material puesto por el cliente');

const PLACA_MC = makeShape(rect(0, 0, 300, 200), [circle(150, 100, 15)]);
const ITEM_MC = { shape: PLACA_MC, materialId: 'acero-sae1010', espesor: 2, cantidad: 5 };

test('no se cobra la chapa', () => {
  const r = cotizarItem({ ...ITEM_MC, materialCliente: true }, CTX);
  assert.equal(r.costos.material, 0);
  assert.ok(/cliente/i.test(r.costos.modoMaterial));
  assert.ok(r.costos.materialDelCliente);
});

test('el tiempo de máquina se recarga, y el recargo es explícito', () => {
  const propio = cotizarItem(ITEM_MC, CTX);
  const cliente = cotizarItem({ ...ITEM_MC, materialCliente: true }, CTX);
  const pct = DEFAULT_CONFIG.comercial.recargoMaterialCliente;

  cerca(
    cliente.costos.corte + cliente.costos.preparacion,
    (propio.costos.corte + propio.costos.preparacion) * (1 + pct / 100),
    1e-6,
    'el recargo va sobre el tiempo de máquina'
  );
  cerca(
    cliente.costos.recargoMaterialCliente,
    (propio.costos.corte + propio.costos.preparacion) * (pct / 100),
    1e-6,
    'y se informa por separado para poder explicarlo'
  );
});

test('sale más barato que poniendo el material, pero no gratis', () => {
  const propio = cotizarItem(ITEM_MC, CTX);
  const cliente = cotizarItem({ ...ITEM_MC, materialCliente: true }, CTX);
  assert.ok(cliente.costos.total < propio.costos.total, 'sin chapa tiene que salir menos');
  assert.ok(cliente.costos.total > 0);
  // Y se puede decir cuánto se ahorra el cliente
  assert.ok(cliente.costos.materialSiLoPusieraElTaller > 0);
});

test('el peso y la geometría se siguen calculando', () => {
  // Hacen falta igual: para el acabado, para el plegado y para decirle al
  // cliente cuánta chapa tiene que traer.
  const r = cotizarItem({ ...ITEM_MC, materialCliente: true }, CTX);
  assert.ok(r.geometria.pesoTotal > 0);
  assert.ok(r.geometria.pesoPieza > 0);
  assert.ok(r.nesting.chapas >= 1, 'sigue diciendo cuántas chapas hacen falta');
});

test('con recargo en cero queda sólo el tiempo de máquina', () => {
  const cfg = { ...DEFAULT_CONFIG, comercial: { ...DEFAULT_CONFIG.comercial, recargoMaterialCliente: 0 } };
  const ctx = { ...CTX, config: cfg };
  const propio = cotizarItem(ITEM_MC, ctx);
  const cliente = cotizarItem({ ...ITEM_MC, materialCliente: true }, ctx);
  cerca(cliente.costos.corte, propio.costos.corte, 1e-9);
  assert.equal(cliente.costos.recargoMaterialCliente, 0);
});

test('sin la marca, nada cambia', () => {
  const a = cotizarItem(ITEM_MC, CTX);
  const b = cotizarItem({ ...ITEM_MC, materialCliente: false }, CTX);
  cerca(b.costos.total, a.costos.total, 1e-9);
  assert.equal(b.costos.recargoMaterialCliente, 0);
});

test('respeta la chapa que trae el cliente', () => {
  // La chapa es de él y vuelve con su recorte: no se anida en la estándar
  const chica = cotizarItem({ ...ITEM_MC, materialCliente: true, chapa: { w: 1000, h: 500 } }, CTX);
  const estandar = cotizarItem({ ...ITEM_MC, materialCliente: true }, CTX);
  assert.equal(chica.nesting.chapa.w, 1000);
  assert.ok(chica.nesting.chapas >= estandar.nesting.chapas, 'en una chapa más chica entran menos');
});

/* ================================================================== */

grupo('Micro-uniones');

test('una pieza chica en automático recibe micro-uniones', () => {
  const sh = makeShape(rect(0, 0, 35, 25));
  const plan = planificarMicroUniones(sh, { espesor: 1.2, material: acero, cantidad: 10 });
  assert.equal(plan.activa, true);
  assert.equal(plan.cantidadUniones, 2);
  assert.ok(plan.ancho >= 0.35 && plan.ancho <= 0.8);
  assert.equal(plan.segundosDesbarbado, 100);
});

test('una pieza grande no recibe puentes si no se fuerzan', () => {
  const sh = makeShape(rect(0, 0, 500, 300));
  const plan = planificarMicroUniones(sh, { espesor: 2, material: acero });
  assert.equal(plan.activa, false);
});

test('forzar micro-uniones funciona aunque la pieza sea grande', () => {
  const sh = makeShape(rect(0, 0, 500, 300));
  const plan = planificarMicroUniones(sh, { espesor: 2, material: acero, modo: 'si' });
  assert.equal(plan.activa, true);
});

test('aplicar micro-uniones abre el contorno exterior del DXF', () => {
  const sh = makeShape(rect(0, 0, 35, 25));
  const plan = planificarMicroUniones(sh, { espesor: 1.2, material: acero });
  const prod = aplicarMicroUniones(sh, plan);
  assert.ok(shapeCutLength(prod) < shapeCutLength(sh), 'deja tramos sin cortar');

  const dxf = generarDXF([prod]);
  const vuelta = leerDXF(dxf);
  assert.equal(vuelta.piezas.length, 0, 'el contorno queda abierto por los puentes');
  assert.ok(vuelta.abiertos.length >= 2, 'el CAM recibe segmentos de corte separados');
});

test('cotizar con micro-uniones suma el repaso manual y lo deja explicado', () => {
  const sh = makeShape(rect(0, 0, 35, 25));
  const sin = cotizarItem({ shape: sh, materialId: 'acero-sae1010', espesor: 1.2, cantidad: 10, microUniones: 'no' }, CTX);
  const con = cotizarItem({ shape: sh, materialId: 'acero-sae1010', espesor: 1.2, cantidad: 10, microUniones: 'auto' }, CTX);
  assert.equal(con.microUniones.activa, true);
  assert.ok(con.costos.microUniones > 0);
  assert.ok(con.costos.total > sin.costos.total);
  assert.equal(con.tiempos.microUniones, con.microUniones.segundosDesbarbado);
});

test('el ancho de la micro-unión crece con el espesor pero queda acotado', () => {
  assert.equal(anchoMicroUnion(0.8), 0.35);
  assert.equal(anchoMicroUnion(10), 0.8);
  assert.equal(anchoMicroUnion(2), 0.5);
});

/* ================================================================== */

grupo('Calibración contra lo que tardó de verdad');

/** Órdenes de mentira: n trabajos con un ratio real/estimado dado. */
const ordenesCon = (ratios, extra = {}) =>
  ratios.map((r, i) => ({
    id: 'o' + i,
    numero: 'OT-' + i,
    resumen: { tiempoProduccion: 1000 },
    real: { segundos: 1000 * r, fecha: '2026-08-01' },
    items: [{ materialId: 'acero-sae1010', espesor: 2, cantidad: 1 }],
    ...extra,
  }));

test('con pocos trabajos no corrige nada', () => {
  const c = calibrar(ordenesCon([1.3, 1.4, 1.35]));
  assert.ok(!c.activa, 'con tres mediciones no hay factor, hay ruido');
  assert.equal(factorPara(c, 'acero-sae1010', 2).factor, 1);
});

test('con suficientes trabajos saca el factor', () => {
  const c = calibrar(ordenesCon([1.3, 1.4, 1.35, 1.25, 1.45, 1.3]));
  assert.ok(c.activa);
  const f = factorPara(c, 'acero-sae1010', 2);
  assert.ok(f.factor > 1.25 && f.factor < 1.45, `factor ${f.factor}`);
  assert.ok(f.n >= MINIMO_TRABAJOS);
});

test('un trabajo absurdo no mueve el factor (mediana, no promedio)', () => {
  const sanos = [1.2, 1.25, 1.3, 1.2, 1.28, 1.22];
  const base = calibrar(ordenesCon(sanos));
  // Se agrega uno donde el operario dejó el cronómetro corriendo
  const conRuido = calibrar(ordenesCon([...sanos, 4.9]));
  const d = Math.abs(conRuido.global.factor - base.global.factor);
  assert.ok(d < 0.05, `la mediana se movió ${d.toFixed(3)}: con promedio se iría mucho más`);
});

test('lo imposible se descarta pero se informa', () => {
  const c = calibrar(ordenesCon([1.2, 1.3, 1.25, 1.28, 1.22, 90]));
  assert.equal(c.descartadas.length, 1, 'un ratio de 90 es minutos escritos donde iban horas');
  assert.equal(c.muestras.length, 5);
  assert.ok(/rango/.test(c.descartadas[0].motivo));
});

test('separa por material y banda de espesor cuando hay datos', () => {
  const finas = ordenesCon([1.1, 1.15, 1.12, 1.08, 1.1, 1.13]);
  const gruesas = ordenesCon([2.1, 2.0, 2.2, 2.05, 2.15, 2.1]).map((o) => ({
    ...o,
    id: o.id + 'g',
    items: [{ materialId: 'acero-sae1010', espesor: 12, cantidad: 1 }],
  }));
  const c = calibrar([...finas, ...gruesas]);
  const fFina = factorPara(c, 'acero-sae1010', 2);
  const fGruesa = factorPara(c, 'acero-sae1010', 12);
  assert.equal(fFina.origen, 'grupo');
  assert.equal(fGruesa.origen, 'grupo');
  assert.ok(fGruesa.factor > fFina.factor * 1.5, 'la chapa gruesa tarda bastante más de lo estimado');
});

test('una orden que mezcla materiales sólo cuenta para el factor global', () => {
  const mezcladas = ordenesCon([1.5, 1.5, 1.5, 1.5, 1.5, 1.5]).map((o) => ({
    ...o,
    items: [
      { materialId: 'acero-sae1010', espesor: 2, cantidad: 1 },
      { materialId: 'inox-304', espesor: 10, cantidad: 1 },
    ],
  }));
  const c = calibrar(mezcladas);
  assert.ok(c.activa, 'sirven para el global');
  assert.equal(Object.keys(c.grupos).length, 0, 'atribuirle el tiempo a un material sería inventar');
  assert.equal(factorPara(c, 'acero-sae1010', 2).origen, 'global');
});

test('cae al factor global cuando el grupo no juntó suficientes', () => {
  const c = calibrar(ordenesCon([1.3, 1.35, 1.28, 1.32, 1.3, 1.31]));
  const f = factorPara(c, 'inox-304', 6); // material sin muestras propias
  assert.equal(f.origen, 'global');
  assert.ok(f.factor > 1.2);
});

test('marca como poco confiable lo que está desparramado', () => {
  const disperso = calibrar(ordenesCon([0.5, 2.5, 0.6, 2.2, 1.0, 3.0, 0.4, 2.8]));
  assert.ok(disperso.global.suficiente, 'hay cantidad');
  assert.ok(!disperso.global.confiable, 'pero van de 0,4 a 3: eso no calibra nada');
});

test('sin calibración el precio no cambia en absoluto', () => {
  const sh = makeShape(rect(0, 0, 200, 150));
  const it = { shape: sh, materialId: 'acero-sae1010', espesor: 2, cantidad: 10 };
  const sinCal = cotizarItem(it, CTX);
  const conCalVacia = cotizarItem(it, { ...CTX, calibracion: calibrar([]) });
  cerca(conCalVacia.costos.total, sinCal.costos.total, 1e-9, 'una calibración sin datos no puede tocar el precio');
});

test('el factor corrige el tiempo y el precio, y queda explicado', () => {
  const sh = makeShape(rect(0, 0, 200, 150));
  const it = { shape: sh, materialId: 'acero-sae1010', espesor: 2, cantidad: 10 };
  const cal = calibrar(ordenesCon([1.5, 1.5, 1.5, 1.5, 1.5, 1.5]));

  const base = cotizarItem(it, CTX);
  const cor = cotizarItem(it, { ...CTX, calibracion: cal });

  cerca(cor.corte.tTotal, base.corte.tTotal * 1.5, 1e-6, 'el tiempo se corrige');
  assert.ok(cor.costos.corte > base.costos.corte, 'y con él el costo');
  // La suma tiene que seguir cerrando
  cerca(cor.corte.tProduccion + cor.corte.tChapas + cor.corte.tSetup, cor.corte.tTotal, 1e-6);
  // Y tiene que poder explicarse
  assert.ok(cor.corte.calibracion?.origen === 'grupo' || cor.corte.calibracion?.origen === 'global');
  const txt = explicarFactor(cor.corte.calibracion);
  assert.ok(/50 % más/.test(txt), txt);
});

test('el texto dice cuando la estimación ya daba bien', () => {
  const cal = calibrar(ordenesCon([1.0, 1.0, 1.0, 1.0, 1.0, 1.0]));
  const txt = explicarFactor(factorPara(cal, 'acero-sae1010', 2));
  assert.ok(/igual que la realidad/.test(txt), txt);
});

/* ================================================================== */

grupo('Vigencia del presupuesto');

const CFG_V = { comercial: { validezDias: 10, margen: 45, simbolo: '$' } };
const presu = (costo, subtotal, diasAtras) => ({
  fecha: new Date(Date.now() - diasAtras * 24 * 3600 * 1000).toISOString(),
  resumen: { costo, subtotal, total: subtotal * 1.21 },
});

test('sin movimiento de costos no alarma, aunque este vencido', () => {
  // Vencer una venta por tramite cuando el precio sigue siendo bueno es
  // perder plata, no cuidarla.
  const v = evaluarVigencia({ presupuesto: presu(100000, 180000, 40), costoHoy: 100200, config: CFG_V });
  assert.equal(v.nivel, 'ok');
  assert.ok(v.vencidoPorCalendario, 'por calendario si esta vencido');
  assert.ok(/casi no se movieron/.test(v.mensaje), v.mensaje);
});

test('avisa cuando el costo subio de verdad, aunque este dentro de la validez', () => {
  // Cinco dias, pero la chapa salto: el riesgo es real igual
  const v = evaluarVigencia({ presupuesto: presu(100000, 180000, 5), costoHoy: 118000, config: CFG_V });
  assert.ok(!v.vencidoPorCalendario, 'todavia esta en fecha');
  assert.equal(v.nivel, 'aviso');
  cerca(v.variacionPct, 18, 1e-6);
});

test('marca error cuando el precio prometido ya no cubre el costo', () => {
  const v = evaluarVigencia({ presupuesto: presu(100000, 180000, 20), costoHoy: 195000, config: CFG_V });
  assert.equal(v.nivel, 'error');
  assert.ok(v.utilidadHoy < 0);
  assert.ok(/por debajo del costo/.test(v.mensaje), v.mensaje);
});

test('el impacto se informa en pesos, no solo en porcentaje', () => {
  const v = evaluarVigencia({ presupuesto: presu(100000, 180000, 20), costoHoy: 195000, config: CFG_V });
  // 180.000 prometidos - 195.000 de costo = 15.000 de bolsillo
  cerca(v.utilidadHoy, -15000, 1e-6);
  assert.ok(/15000/.test(v.mensaje.replace(/\./g, '')), v.mensaje);
});

test('dice a cuanto habria que cotizarlo hoy para el mismo margen', () => {
  const v = evaluarVigencia({ presupuesto: presu(100000, 200000, 12), costoHoy: 120000, config: CFG_V });
  // margen original: (200.000-100.000)/200.000 = 50 %  ->  120.000/0,5 = 240.000
  cerca(v.precioParaMismoMargen, 240000, 1e-6);
});

test('el margen de hoy se mide contra el precio YA prometido', () => {
  // El precio no se puede mover: lo unico que cambia es cuanto queda
  const v = evaluarVigencia({ presupuesto: presu(100000, 200000, 3), costoHoy: 140000, config: CFG_V });
  cerca(v.margenEntonces, 50, 1e-6);
  cerca(v.margenHoy, 30, 1e-6);
});

test('sin datos suficientes devuelve null en vez de inventar', () => {
  assert.equal(evaluarVigencia({ presupuesto: { resumen: {} }, costoHoy: 1000, config: CFG_V }), null);
  assert.equal(evaluarVigencia({ presupuesto: presu(100000, 180000, 5), costoHoy: 0, config: CFG_V }), null);
});

test('explica cual material se movio y cuanto', () => {
  const items = [
    { material: { id: 'acero-sae1010', nombre: 'Acero', precioKg: 3800 } },
    { material: { id: 'inox-304', nombre: 'Inoxidable', precioKg: 8900 } },
  ];
  const hoy = [
    { id: 'acero-sae1010', precioKg: 4200 },
    { id: 'inox-304', precioKg: 8950 }, // 0,56 %: ruido, no se informa
  ];
  const m = materialesQueSeMovieron(items, hoy);
  assert.equal(m.length, 1, 'solo el que se movio de verdad');
  assert.equal(m[0].id, 'acero-sae1010');
  cerca(m[0].pct, (4200 - 3800) / 3800 * 100, 1e-6);
});

test('no repite un material usado en varios items', () => {
  const items = [
    { material: { id: 'acero-sae1010', nombre: 'Acero', precioKg: 3800 } },
    { material: { id: 'acero-sae1010', nombre: 'Acero', precioKg: 3800 } },
  ];
  const m = materialesQueSeMovieron(items, [{ id: 'acero-sae1010', precioKg: 4400 }]);
  assert.equal(m.length, 1);
});

test('el impacto rapido es exacto para el material', () => {
  // 20 kg de acero que paso de 3800 a 4200 = +8.000 de material, sin anidar nada
  const p = {
    estado: 'enviado',
    resumen: { costo: 100000, subtotal: 180000 },
    items: [{ materialId: 'acero-sae1010', _pesoTotal: 20, _precioKgMaterial: 3800 }],
  };
  const i = impactoMaterialRapido(p, [{ id: 'acero-sae1010', precioKg: 4200 }]);
  cerca(i.delta, 8000, 1e-6);
  cerca(i.costoEstimadoHoy, 108000, 1e-6);
  cerca(i.utilidadEstimadaHoy, 72000, 1e-6);
  assert.ok(!i.enRojo);
  assert.ok(!i.parcial);
});

test('marca en rojo cuando lo prometido ya no cubre', () => {
  const p = {
    estado: 'enviado',
    resumen: { costo: 100000, subtotal: 105000 },
    items: [{ materialId: 'acero-sae1010', _pesoTotal: 40, _precioKgMaterial: 3800 }],
  };
  const i = impactoMaterialRapido(p, [{ id: 'acero-sae1010', precioKg: 4200 }]);
  cerca(i.delta, 16000, 1e-6);       // 40 kg x 400
  assert.ok(i.enRojo, 'costo 116.000 contra 105.000 prometidos');
});

test('avisa cuando el calculo es parcial por presupuestos viejos', () => {
  const p = {
    resumen: { costo: 100000, subtotal: 180000 },
    items: [
      { materialId: 'acero-sae1010', _pesoTotal: 20, _precioKgMaterial: 3800 },
      { materialId: 'inox-304', _pesoTotal: 10 }, // sin precio guardado
    ],
  };
  const i = impactoMaterialRapido(p, [{ id: 'acero-sae1010', precioKg: 4200 }, { id: 'inox-304', precioKg: 9000 }]);
  assert.ok(i.parcial, 'un item quedo afuera y hay que decirlo');
  assert.equal(i.itemsConDato, 1);
  assert.equal(i.itemsTotales, 2);
});

test('sin ningun precio guardado devuelve null en vez de estimar', () => {
  const p = { resumen: { costo: 100000, subtotal: 180000 }, items: [{ materialId: 'acero-sae1010', _pesoTotal: 20 }] };
  assert.equal(impactoMaterialRapido(p, [{ id: 'acero-sae1010', precioKg: 4200 }]), null);
});

test('la cartera solo cuenta los presupuestos vivos', () => {
  const item = (peso) => [{ materialId: 'acero-sae1010', _pesoTotal: peso, _precioKgMaterial: 3800 }];
  const presus = [
    { estado: 'enviado',    resumen: { costo: 100000, subtotal: 105000 }, items: item(40) }, // en rojo
    { estado: 'borrador',   resumen: { costo: 100000, subtotal: 180000 }, items: item(20) }, // subio, no rojo
    // Estos NO se pueden ni sostener ni perder: no cuentan
    { estado: 'rechazado',  resumen: { costo: 100000, subtotal: 105000 }, items: item(40) },
    { estado: 'facturado',  resumen: { costo: 100000, subtotal: 105000 }, items: item(40) },
  ];
  const c = carteraEnRiesgo(presus, [{ id: 'acero-sae1010', precioKg: 4200 }]);
  assert.equal(c.vivos, 2, 'rechazado y facturado quedan afuera');
  assert.equal(c.enRojo, 1);
  assert.equal(c.subieron, 1);
  assert.ok(c.montoEnRiesgo > 0);
});

test('el impacto rapido acompania a la cuenta completa', () => {
  // El rapido solo mira material; el completo mira todo. En un caso donde el
  // material es lo unico que cambio, los dos tienen que coincidir.
  const p = {
    fecha: new Date().toISOString(),
    resumen: { costo: 100000, subtotal: 180000 },
    items: [{ materialId: 'acero-sae1010', _pesoTotal: 25, _precioKgMaterial: 3800 }],
  };
  const rapido = impactoMaterialRapido(p, [{ id: 'acero-sae1010', precioKg: 4200 }]);
  const completo = evaluarVigencia({ presupuesto: p, costoHoy: rapido.costoEstimadoHoy, config: CFG_V });
  cerca(completo.variacionMonto, rapido.delta, 1e-6);
  cerca(completo.utilidadHoy, rapido.utilidadEstimadaHoy, 1e-6);
});

/* ================================================================== */

grupo('Rentabilidad por hora de maquina');

const coti = (subtotal, costo, horas, material = 0) => ({
  resumen: { subtotal, costo, utilidad: subtotal - costo, tiempoProduccion: horas * 3600 },
  items: [{ costos: { material } }],
});
const aprobado = (subtotal, costo, horas) => ({
  estado: 'aprobado',
  resumen: { subtotal, costo, utilidad: subtotal - costo, tiempoProduccion: horas * 3600 },
});

test('el trabajo chico y rapido puede ser mejor que el grande', () => {
  // Es el caso que motiva todo el modulo
  const grande = rentabilidad(coti(500000, 0, 12));
  const chico = rentabilidad(coti(80000, 0, 0.5));
  cerca(grande.utilidadPorHora, 500000 / 12, 1e-6);
  cerca(chico.utilidadPorHora, 160000, 1e-6);
  assert.ok(chico.utilidadPorHora > grande.utilidadPorHora * 3,
    'el chico rinde mucho mas por hora de maquina');
});

test('mide UTILIDAD por hora, no facturacion por hora', () => {
  // Mismo trabajo, mismas horas, pero uno con chapa cara que solo pasa de largo
  const barato = rentabilidad(coti(200000, 100000, 2, 60000));
  const caro = rentabilidad(coti(400000, 300000, 2, 260000));
  assert.ok(caro.facturacionPorHora > barato.facturacionPorHora, 'factura mas');
  cerca(caro.utilidadPorHora, barato.utilidadPorHora, 1e-6, 'pero deja exactamente lo mismo');
});

test('avisa cuanto material hay que poner antes de cobrar', () => {
  const r = rentabilidad(coti(400000, 300000, 2, 260000));
  cerca(r.material, 260000, 1e-6);
  cerca(r.materialPct, 65, 1e-6);
});

test('la referencia sale solo de los trabajos APROBADOS', () => {
  const presus = [
    aprobado(200000, 100000, 1),   // 100.000/h
    aprobado(300000, 150000, 1.5), // 100.000/h
    aprobado(180000, 120000, 1),   //  60.000/h
    aprobado(240000, 140000, 1),   // 100.000/h
    // Este no lo tomo el cliente: no dice nada sobre lo que el taller consigue
    { estado: 'rechazado', resumen: { subtotal: 900000, costo: 100000, utilidad: 800000, tiempoProduccion: 3600 } },
  ];
  const ref = referenciaDelTaller(presus);
  assert.ok(ref.hay);
  assert.equal(ref.n, 4, 'el rechazado queda afuera');
  cerca(ref.mediana, 100000, 1e-6);
});

test('sin suficientes trabajos no inventa una referencia', () => {
  const ref = referenciaDelTaller([aprobado(200000, 100000, 1), aprobado(300000, 150000, 1.5)]);
  assert.ok(!ref.hay);
  assert.equal(ref.n, 2);
});

test('el piso sale de la estructura, no de una opinion', () => {
  const piso = pisoDelTaller({ totalMes: 894000, horasProductivas: 100.8 });
  cerca(piso.porHora, 894000 / 100.8, 1e-6);
});

test('marca error cuando el trabajo no paga ni los gastos fijos', () => {
  const estructura = { totalMes: 894000, horasProductivas: 100.8 }; // 8.869/h
  // 6 horas de maquina que dejan 30.000: 5.000/h, por debajo del piso
  const e = evaluarTrabajo(coti(230000, 200000, 6), { estructura, presupuestos: [] });
  assert.equal(e.nivel, 'error');
  assert.ok(/no las paga/.test(e.mensaje), e.mensaje);
});

test('compara contra lo que el taller consigue, no contra un numero de manual', () => {
  const presus = [aprobado(200000,100000,1), aprobado(300000,150000,1.5), aprobado(240000,140000,1), aprobado(220000,120000,1)];
  const e = evaluarTrabajo(coti(150000, 100000, 1), { presupuestos: presus, estructura: { totalMes: 894000, horasProductivas: 100.8 } });
  assert.equal(e.origenVara, 'historial');
  assert.equal(e.nivel, 'aviso', '50.000/h contra ~100.000 habitual');
  assert.ok(e.precioParaLaVara > 150000, 'y dice a cuanto habria que cobrarlo');
});

test('dice a cuanto hay que cobrarlo para llegar a la vara', () => {
  const presus = [aprobado(200000,100000,1), aprobado(200000,100000,1), aprobado(200000,100000,1), aprobado(200000,100000,1)];
  // vara = 100.000/h. Trabajo de 2 h con costo 100.000 -> 100.000 + 100.000*2
  const e = evaluarTrabajo(coti(150000, 100000, 2), { presupuestos: presus });
  cerca(e.vara, 100000, 1e-6);
  cerca(e.precioParaLaVara, 300000, 1e-6);
});

test('destaca los trabajos que rinden bastante mas que lo habitual', () => {
  const presus = [aprobado(200000,100000,1), aprobado(200000,100000,1), aprobado(200000,100000,1), aprobado(200000,100000,1)];
  const e = evaluarTrabajo(coti(400000, 100000, 1), { presupuestos: presus });
  assert.equal(e.nivel, 'bueno');
  assert.ok(/priorizar/.test(e.mensaje), e.mensaje);
});

test('ordena por lo que deja por hora y no por el total', () => {
  const grande = aprobado(500000, 0, 12);
  const chico = aprobado(80000, 0, 0.5);
  const orden = ordenarPorRendimiento([grande, chico]);
  assert.equal(orden[0].presupuesto, chico, 'primero el que mas rinde por hora');
});

test('un trabajo de un minuto tambien se evalua', () => {
  // Regresion: el umbral estaba en 1 minuto y dejaba sin evaluar justo los
  // trabajos chicos, que son donde mas importa mirar la tasa por hora.
  const r = rentabilidad(coti(12000, 4500, 70 / 3600));
  assert.ok(r.utilidadPorHora != null, 'setenta segundos es un trabajo real');
  cerca(r.utilidadPorHora, 7500 / (70 / 3600), 1e-6);
});

test('sin horas de maquina no arriesga un numero', () => {
  const r = rentabilidad(coti(100000, 50000, 0));
  assert.equal(r.utilidadPorHora, null);
  assert.equal(evaluarTrabajo(coti(100000, 50000, 0), {}), null);
});

/* ================================================================== */

grupo('Cache de anidados');

const itemsCache = (cantidad = 40) => [{
  id: 'p', nombre: 'Placa', w: 300, h: 200, cantidad,
  shape: makeShape(rect(0, 0, 300, 200), [circle(150, 100, 15)]),
}];
const CHAPA_C = { w: 2440, h: 1220 };
const OPTS_C = { separacion: 5, margen: 10, formaReal: true };

test('acierta aunque la geometria se reconstruya desde cero', () => {
  // Es EL caso: el cotizador llama a construir() con cada tecla y devuelve un
  // objeto nuevo aunque los parametros no hayan cambiado. Comparar por
  // identidad de objeto no serviria y el cache nunca acertaria.
  limpiarCacheNesting();
  const a = nest(itemsCache(), CHAPA_C, OPTS_C);
  const b = nest(itemsCache(), CHAPA_C, OPTS_C); // items y shapes NUEVOS
  assert.equal(a, b, 'tiene que devolver el mismo objeto: es un acierto de cache');
});

test('cambiar la cantidad NO devuelve el anidado viejo', () => {
  limpiarCacheNesting();
  const a = nest(itemsCache(40), CHAPA_C, OPTS_C);
  const b = nest(itemsCache(80), CHAPA_C, OPTS_C);
  assert.notEqual(a, b);
  assert.ok(b.cantidadChapas >= a.cantidadChapas, 'el doble de piezas no puede entrar en menos chapas');
});

test('cambiar una opcion NO devuelve el anidado viejo', () => {
  limpiarCacheNesting();
  const a = nest(itemsCache(), CHAPA_C, OPTS_C);
  const b = nest(itemsCache(), CHAPA_C, { ...OPTS_C, separacion: 20 });
  assert.notEqual(a, b, 'con 20 mm de separacion el layout es otro');
});

test('cambiar la chapa NO devuelve el anidado viejo', () => {
  limpiarCacheNesting();
  const a = nest(itemsCache(), CHAPA_C, OPTS_C);
  const b = nest(itemsCache(), { w: 1500, h: 1000 }, OPTS_C);
  assert.notEqual(a, b);
});

test('cambiar la geometria NO devuelve el anidado viejo', () => {
  limpiarCacheNesting();
  const a = nest(itemsCache(), CHAPA_C, OPTS_C);
  const otros = [{ ...itemsCache()[0], shape: makeShape(rect(0, 0, 300, 260)) }];
  const b = nest(otros, CHAPA_C, OPTS_C);
  assert.notEqual(a, b, 'otra pieza es otro anidado');
});

test('el cache no cambia el resultado', () => {
  limpiarCacheNesting();
  const conCache = nest(itemsCache(), CHAPA_C, OPTS_C);
  const sinCache = nest(itemsCache(), CHAPA_C, { ...OPTS_C, sinCache: true });
  assert.equal(conCache.cantidadChapas, sinCache.cantidadChapas);
  cerca(conCache.aprovechamientoGlobal, sinCache.aprovechamientoGlobal, 1e-9);
  assert.equal(conCache.piezasColocadas, sinCache.piezasColocadas);
});

test('la firma distingue geometrias y sobrevive a la reconstruccion', () => {
  const a = makeShape(rect(0, 0, 300, 200), [circle(150, 100, 15)]);
  const b = makeShape(rect(0, 0, 300, 200), [circle(150, 100, 15)]);
  const c = makeShape(rect(0, 0, 300, 200), [circle(150, 100, 16)]);
  assert.equal(firmaShape(a), firmaShape(b), 'misma geometria, misma firma');
  assert.notEqual(firmaShape(a), firmaShape(c), 'un agujero de 1 mm mas ya es otra pieza');
});

/* ================================================================== */

grupo('Corte en linea comun');

/** Chapa de prueba: rectangulos pegados, con la luz que se le pase. */
const chapaPegada = (luz = 0.2) => ({
  w: 1000, h: 500,
  piezas: [
    { id: 'a', x: 0, y: 0, w: 300, h: 200, rot: 0 },
    { id: 'b', x: 300 + luz, y: 0, w: 300, h: 200, rot: 0 },
    { id: 'c', x: 0, y: 200 + luz, w: 300, h: 200, rot: 0 },
  ],
});

test('detecta los bordes que se pueden cortar una sola vez', () => {
  const r = detectarLineasComunes(chapaPegada(0.2), { separacion: 0.2 });
  // a|b comparten 200 mm de borde vertical; a|c comparten 300 de horizontal
  assert.equal(r.compartidos.length, 2);
  cerca(r.largoCompartido, 500, 1e-6);
});

test('con la separacion normal del nesting NO hay linea comun', () => {
  // Es la trampa del asunto: 5 mm entre piezas son dos cortes, no uno
  const r = detectarLineasComunes(chapaPegada(5), { separacion: 0 });
  assert.equal(r.compartidos.length, 0, 'a 5 mm no se comparte nada');
  cerca(r.largoCompartido, 0, 1e-9);
});

test('ignora bordes demasiado cortos para resolverlos como linea unica', () => {
  const chapa = { w: 1000, h: 500, piezas: [
    { id: 'a', x: 0, y: 0, w: 300, h: 10, rot: 0 },
    { id: 'b', x: 300.2, y: 0, w: 300, h: 10, rot: 0 },
  ] };
  const r = detectarLineasComunes(chapa, { separacion: 0.2 });
  assert.equal(r.compartidos.length, 0, '10 mm de borde no es una linea comun');
});

test('no cuenta piezas que apenas se rozan en una esquina', () => {
  const chapa = { w: 1000, h: 500, piezas: [
    { id: 'a', x: 0, y: 0, w: 200, h: 200, rot: 0 },
    { id: 'b', x: 200.2, y: 200.2, w: 200, h: 200, rot: 0 },
  ] };
  const r = detectarLineasComunes(chapa, { separacion: 0.2 });
  assert.equal(r.compartidos.length, 0, 'el solape es cero: no hay borde compartido');
});

test('respeta la rotacion al armar el rectangulo', () => {
  const chapa = { w: 1000, h: 500, piezas: [
    { id: 'a', x: 0, y: 0, w: 300, h: 200, rot: 0 },
    // rotada 90: ocupa 200 de ancho y 300 de alto
    { id: 'b', x: 300.2, y: 0, w: 300, h: 200, rot: 90 },
  ] };
  const r = detectarLineasComunes(chapa, { separacion: 0.2 });
  assert.equal(r.compartidos.length, 1);
  cerca(r.compartidos[0].largo, 200, 1e-6, 'comparten solo el alto de la mas baja');
});

test('un contorno irregular no ofrece linea comun', () => {
  // Poly triangular: sus vertices no caen todos en el borde de su caja
  const chapa = { w: 1000, h: 500, piezas: [
    { id: 'a', x: 0, y: 0, w: 300, h: 200, poly: [[0,0],[300,0],[150,200]] },
    { id: 'b', x: 300.2, y: 0, w: 300, h: 200, poly: [[300.2,0],[600.2,0],[450,200]] },
  ] };
  const r = detectarLineasComunes(chapa, { separacion: 0.2 });
  assert.equal(r.rectangulares, 0, 'no son rectangulos');
  assert.equal(r.compartidos.length, 0);
});

test('el ahorro nunca puede pasar la mitad del corte total', () => {
  const nesting = { layout: [chapaPegada(0.2)] };
  // Un largo total absurdamente chico: el tope tiene que actuar
  const a = ahorroLineaComun(nesting, 100, { separacion: 0.2 });
  assert.ok(a.ahorroMM <= 50, 'un ahorro mayor a la mitad seria imposible');
});

test('avisa cuando solo una parte de las piezas es rectangular', () => {
  const chapa = chapaPegada(0.2);
  chapa.piezas.push({ id: 'd', x: 700, y: 0, w: 100, h: 100, poly: [[700,0],[800,0],[750,100]] });
  const a = ahorroLineaComun({ layout: [chapa] }, 5000, { separacion: 0.2 });
  assert.ok(!a.aplicable, 'no todas son rectangulares');
  assert.ok(/3 de 4/.test(explicarLineaComun(a)), explicarLineaComun(a));
});

test('el texto dice el ahorro Y lo que se resigna', () => {
  const a = ahorroLineaComun({ layout: [chapaPegada(0.2)] }, 5000, { separacion: 0.2 });
  const t = explicarLineaComun(a);
  assert.ok(/se ahorrar/.test(t), 'tiene que decir cuanto se ahorra');
  assert.ok(/separarlas a mano/.test(t), 'y que salen pegadas');
  assert.ok(/sangr/.test(t), 'y que pierden media sangria');
});

test('evaluar compara el anidado normal contra el pegado', () => {
  const items = [{ id: 'p', nombre: 'Placa', w: 300, h: 200, cantidad: 8,
                   shape: makeShape(rect(0, 0, 300, 200)) }];
  const e = evaluarLineaComun(nest, items, { w: 2440, h: 1220 },
    { separacion: 5, margen: 10, formaReal: false });
  assert.ok(e, 'con ocho rectangulos iguales tiene que encontrar algo');
  assert.ok(e.largoCompartido > 0);
  assert.equal(e.piezasRectangulares, e.piezasTotales, 'son todas rectangulares');
  assert.ok(e.chapasPegado <= e.chapasNormal, 'pegado nunca puede necesitar mas chapas');
});

test('evaluar devuelve null cuando no hay nada que compartir', () => {
  // Una sola pieza no tiene con quien compartir borde
  const items = [{ id: 'p', nombre: 'Placa', w: 300, h: 200, cantidad: 1,
                   shape: makeShape(rect(0, 0, 300, 200)) }];
  const e = evaluarLineaComun(nest, items, { w: 2440, h: 1220 },
    { separacion: 5, margen: 10, formaReal: false });
  assert.equal(e, null);
});

test('evaluar funciona aunque el nesting normal sea por forma real', () => {
  // Regresion: el motor de forma real rasteriza a ~2,7 mm y no puede pegar
  // piezas borde contra borde, asi que la deteccion daba cero siempre.
  // Los dos anidados de la evaluacion van por el motor rectangular.
  const items = [{ id: 'p', nombre: 'Placa', w: 300, h: 200, cantidad: 12,
                   shape: makeShape(rect(0, 0, 300, 200)) }];
  const e = evaluarLineaComun(nest, items, { w: 2440, h: 1220 },
    { separacion: 5, margen: 10, formaReal: true });
  assert.ok(e, 'con formaReal:true tambien tiene que encontrar la oportunidad');
  assert.ok(e.largoCompartido > 1000, `solo ${e.largoCompartido} mm compartidos`);
});

/* ================================================================== */

grupo('Consumibles del láser');

test('el costo por hora sale de piezas con precio y vida útil', () => {
  const r = costoConsumiblesHora();
  assert.ok(r.total > 0);
  assert.equal(r.detalle.length, CONSUMIBLES_LASER.length);
  // Cada línea es precio ÷ vida: la cuenta tiene que poder rehacerse a mano
  for (const d of r.detalle) cerca(d.porHora, d.precio / d.vidaHoras, 1e-9, d.nombre);
  // Y el total es la suma de las líneas
  cerca(r.total, r.detalle.reduce((a, b) => a + b.porHora, 0), 1e-9);
});

test('reproduce el valor de referencia de la máquina de fábrica', () => {
  // Si esto se despega, el $2.800 del DEFAULT_MACHINE dejó de estar explicado
  // y vuelve a ser un número mágico.
  const r = costoConsumiblesHora();
  const referencia = DEFAULT_MACHINE.costo.consumiblesHora;
  assert.ok(Math.abs(r.total - referencia) / referencia < 0.1,
    `la lista da ${r.total.toFixed(0)} y la máquina tiene ${referencia}: se despegaron`);
});

test('con oxígeno la lente protectora dura menos y sale más caro', () => {
  const conO2 = costoConsumiblesHora(undefined, { gas: 'O2' }).total;
  const conN2 = costoConsumiblesHora(undefined, { gas: 'N2' }).total;
  assert.ok(conO2 > conN2, 'cortando con O₂ hay más salpicadura y la protectora se pica antes');
});

test('una pieza sin vida útil se ignora en vez de envenenar el total', () => {
  const lista = [...CONSUMIBLES_LASER, { id: 'x', nombre: 'Rota', precio: 1000, vidaHoras: 0 }];
  const r = costoConsumiblesHora(lista);
  assert.ok(isFinite(r.total), 'dividir por cero daría Infinity y arruinaría toda la hora de máquina');
  cerca(r.total, costoConsumiblesHora().total, 1e-9);
});

test('detecta un mensual puesto donde va un valor por hora', () => {
  const a = revisarConsumiblesHora(150000);
  assert.equal(a?.nivel, 'error');
  assert.ok(/mensual/i.test(a.msg), 'tiene que sugerir la causa probable');
  assert.equal(revisarConsumiblesHora(2800), null, 'el valor de referencia no puede disparar');
  assert.equal(revisarConsumiblesHora(4500), null, 'ni un taller que gasta algo más');
});

test('detecta un consumible tan bajo que no cubre ni las boquillas', () => {
  const a = revisarConsumiblesHora(200);
  assert.equal(a?.nivel, 'aviso');
});

test('la revisión de datos usa la lista real, no una proporción', () => {
  // Inflar consumibles Y mantenimiento a la vez: ninguno llega al 50 % del
  // total, así que el chequeo de dominancia no los ve. Éste sí.
  const rota = {
    ...DEFAULT_MACHINE,
    costo: { ...DEFAULT_MACHINE.costo, consumiblesHora: 45000, mantenimientoHora: 45000 },
  };
  const r = revisarDatos({ config: DEFAULT_CONFIG, maquinas: [rota], materiales: DEFAULT_MATERIALS });
  assert.ok(r.hallazgos.some((h) => /consumibles/i.test(h.msg)), 'lo tiene que atrapar igual');
});

test('no le pide lentes ni boquillas a la plegadora', () => {
  const r = revisarDatos({ config: DEFAULT_CONFIG, maquinas: [DEFAULT_PLEGADORA], materiales: DEFAULT_MATERIALS });
  assert.ok(!r.hallazgos.some((h) => /consumibles/i.test(h.msg)));
});

test('controla consumibles por horas reales acumuladas', () => {
  const ordenes = [
    { estado: 'terminada', real: { segundos: 45 * 3600, fecha: '2026-08-10' } },
    { estado: 'terminada', real: { segundos: 12 * 3600, fecha: '2026-08-11' } },
    { estado: 'pendiente', real: { segundos: 100 * 3600, fecha: '2026-08-12' } },
  ];
  const r = estadoConsumiblesPorHoras(ordenes, [{ id: 'boquilla', nombre: 'Boquilla', vidaHoras: 45 }]);
  assert.equal(r.items[0].nivel, 'error');
  assert.equal(r.vencidos, 1);
  assert.equal(r.horasTotales, 57);
});

test('el control de consumibles respeta el ultimo cambio cargado', () => {
  const ordenes = [
    { estado: 'terminada', real: { segundos: 80 * 3600, fecha: '2026-08-01' } },
    { estado: 'terminada', real: { segundos: 30 * 3600, fecha: '2026-08-10' } },
  ];
  const r = estadoConsumiblesPorHoras(
    ordenes,
    [{ id: 'lente', nombre: 'Lente', vidaHoras: 40 }],
    { ultimosCambios: { lente: '2026-08-05' } }
  );
  assert.equal(r.items[0].horas, 30);
  assert.equal(r.items[0].nivel, 'ok');
});

test('el control de consumibles informa cambios parciales', () => {
  const r = estadoConsumiblesPorHoras(
    [{ estado: 'terminada', real: { segundos: 3600, fecha: '2026-08-12' } }],
    CONSUMIBLES_LASER,
    { ultimosCambios: { boquilla: '2026-08-12' } }
  );
  assert.equal(r.sinCambiosCargados, false);
  assert.equal(r.cambiosCargados, 1);
  assert.equal(r.cambiosFaltantes, CONSUMIBLES_LASER.length - 1);
});

/* ================================================================== */
grupo('Stock de retazos');

const RETAZOS_PRUEBA = [
  { id: 'r1', materialId: 'acero-sae1010', espesor: 3, w: 500, h: 400, cantidad: 2, ubicacion: 'Rack A' },
  { id: 'r2', materialId: 'acero-sae1010', espesor: 3, w: 250, h: 900, cantidad: 1 },
  { id: 'r4', materialId: 'acero-sae1010', espesor: 3, w: 600, h: 600, cantidad: 1, estado: 'reservado' },
  { id: 'r3', materialId: 'inox-304', espesor: 2, w: 700, h: 300, cantidad: 1 },
];

test('calcula superficie y peso real de un retazo', () => {
  const r = RETAZOS_PRUEBA[0];
  cerca(superficieRetazoM2(r), 0.4, 1e-9);
  cerca(pesoRetazoKg(r, acero), 9.42, 0.01);
});

test('resume el stock por material y espesor sin mezclar reservas', () => {
  const resumen = resumenStockRetazos(RETAZOS_PRUEBA, DEFAULT_MATERIALS);
  const acero3 = resumen.find((x) => x.materialId === 'acero-sae1010' && x.espesor === 3);
  assert.ok(acero3);
  assert.equal(acero3.unidades, 4);
  assert.equal(acero3.disponibles, 3);
  cerca(acero3.superficieM2, 0.985, 1e-9);
});

test('encuentra retazos compatibles y prueba la rotacion', () => {
  const candidatos = candidatosRetazo(RETAZOS_PRUEBA, {
    materialId: 'acero-sae1010', espesor: 3, w: 380, h: 220,
  }, { margen: 10 });
  assert.ok(candidatos.length >= 2);
  assert.equal(candidatos[0].id, 'r1');
  assert.equal(candidatos[0].rotacion, 0);
  const girado = candidatosRetazo(RETAZOS_PRUEBA, {
    materialId: 'acero-sae1010', espesor: 3, w: 850, h: 220,
  }, { margen: 10 });
  assert.equal(girado[0].id, 'r2');
  assert.equal(girado[0].rotacion, 90);
  assert.equal(candidatosRetazo(RETAZOS_PRUEBA, {
    materialId: 'acero-sae1010', espesor: 3, w: 380, h: 220, cantidad: 3,
  }).length, 0, 'no debe prometer mas unidades que las que tiene el retazo');
});

test('consumir retazo descuenta unidades sin inventar el sobrante', () => {
  const r = consumirRetazo(RETAZOS_PRUEBA, 'r1', 1);
  assert.equal(r.encontrado, true);
  assert.equal(r.retazos.find((x) => x.id === 'r1').cantidad, 1);
  const reservado = consumirRetazo(RETAZOS_PRUEBA, 'r4', 1);
  assert.equal(reservado.retazos.find((x) => x.id === 'r4').cantidad, 1);
});

test('una cotizacion puede reservar un retazo y lo imputa por area', () => {
  const shape = makeShape(rect(0, 0, 300, 200));
  const ctxRetazo = { ...CTX, retazos: [{ id: 'r1', materialId: 'acero-sae1010', espesor: 3, w: 500, h: 400, cantidad: 1 }] };
  const r = cotizarItem({
    nombre: 'Placa desde retazo', shape, materialId: 'acero-sae1010', espesor: 3, cantidad: 1, retazoId: 'r1',
  }, ctxRetazo);
  assert.equal(r.retazo.id, 'r1');
  assert.equal(r.costos.modoMaterial, 'Retazo del stock');
  assert.equal(r.nesting.chapa.w, 500);
  assert.ok(r.costos.material > 0);
});

test('las reservas de retazo son parciales e idempotentes', () => {
  const base = [{ id: 'r1', materialId: 'acero-sae1010', espesor: 3, w: 500, h: 400, cantidad: 2 }];
  const asignaciones = asignacionesRetazoDeItems([
    { retazoId: 'r1', cantidad: 1 },
    { retazoId: 'r1', cantidad: 1 },
  ]);
  assert.deepEqual(asignaciones, [{ retazoId: 'r1', cantidad: 2 }]);

  const primera = reservarRetazos(base, [{ retazoId: 'r1', cantidad: 1 }], { ordenId: 'ot-1', presupuestoId: 'p-1' });
  assert.equal(primera.ok, true);
  assert.equal(unidadesDisponibles(primera.retazos[0]), 1);
  const repetida = reservarRetazos(primera.retazos, [{ retazoId: 'r1', cantidad: 1 }], { ordenId: 'ot-1', presupuestoId: 'p-1' });
  assert.equal(repetida.ok, true);
  assert.equal(unidadesDisponibles(repetida.retazos[0]), 1, 'reintentar no duplica la reserva');
  const ocupada = reservarRetazos(repetida.retazos, [{ retazoId: 'r1', cantidad: 2 }], { ordenId: 'ot-2' });
  assert.equal(ocupada.ok, false, 'no se pueden prometer unidades ya reservadas');
});

test('cancelar libera y entrar en corte consume la reserva', () => {
  const base = [{ id: 'r1', materialId: 'acero-sae1010', espesor: 3, w: 500, h: 400, cantidad: 2 }];
  const reserva = reservarRetazos(base, [{ retazoId: 'r1', cantidad: 1 }], { ordenId: 'ot-1' });
  const liberada = liberarRetazos(reserva.retazos, 'ot-1');
  assert.equal(unidadesDisponibles(liberada.retazos[0]), 2);
  const segunda = reservarRetazos(liberada.retazos, [{ retazoId: 'r1', cantidad: 1 }], { ordenId: 'ot-2' });
  const consumida = consumirRetazos(segunda.retazos, 'ot-2');
  assert.equal(consumida.consumidas, 1);
  assert.equal(consumida.retazos[0].cantidad, 1);
  assert.equal(unidadesDisponibles(consumida.retazos[0]), 1);
});

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

test('detecta un aprovechamiento objetivo inalcanzable', () => {
  const cfg = { ...DEFAULT_CONFIG, comercial: { ...DEFAULT_CONFIG.comercial, aprovechamientoObjetivo: 0.9 } };
  const r = revisarDatos({ ...DATOS_OK, config: cfg });
  assert.ok(r.hallazgos.some((h) => /aprovechamiento objetivo está en 90/.test(h.msg)),
    'con 90 % el sistema cobra siempre por área y el retazo no lo paga nadie');
});

test('el hallazgo del aprovechamiento trae el arreglo, no sólo el reto', () => {
  const cfg = { ...DEFAULT_CONFIG, comercial: { ...DEFAULT_CONFIG.comercial, aprovechamientoObjetivo: 0.9 } };
  const r = revisarDatos({ ...DATOS_OK, config: cfg });
  const h = r.hallazgos.find((x) => /aprovechamiento objetivo está en 90/.test(x.msg));
  assert.equal(h.arreglo.destino, 'comercial');
  assert.equal(h.arreglo.campos.aprovechamientoObjetivo, APROVECHAMIENTO_REF);
  // El valor propuesto tiene que resolver lo que el propio chequeo detecta, o
  // aplicarlo dejaría el aviso en pantalla y el botón parecería roto.
  const despues = revisarDatos({
    ...DATOS_OK,
    config: { ...cfg, comercial: { ...cfg.comercial, ...h.arreglo.campos } },
  });
  assert.ok(!despues.hallazgos.some((x) => /aprovechamiento objetivo está en/.test(x.msg)),
    'aplicar el arreglo tiene que apagar el aviso que lo propuso');
});

test('el setup en cero propone los segundos de referencia', () => {
  const laser = { ...DEFAULT_MACHINE, tiempoSetupPrograma: 0, tiempoCargaChapa: 0 };
  const r = revisarDatos({ ...DATOS_OK, maquinas: [laser] });
  const h = r.hallazgos.find((x) => /Está en cero/.test(x.msg));
  assert.equal(h.arreglo.destino, 'maquina');
  assert.equal(h.arreglo.id, laser.id);
  assert.equal(h.arreglo.campos.tiempoSetupPrograma, SETUP_PROGRAMA_REF);
  assert.equal(h.arreglo.campos.tiempoCargaChapa, CARGA_CHAPA_REF);
});

test('el arreglo NO pisa el campo que sí tiene un valor cargado', () => {
  /* Es la regla que hace que el botón sea seguro. Si alguien cronometró la
     carga de chapa de SU taller en 45 s, ese número es un dato medido y la
     referencia de 90 s sería peor. Se propone únicamente lo que está vacío. */
  const laser = { ...DEFAULT_MACHINE, tiempoSetupPrograma: 0, tiempoCargaChapa: 45 };
  const r = revisarDatos({ ...DATOS_OK, maquinas: [laser] });
  const h = r.hallazgos.find((x) => /Está en cero/.test(x.msg));
  assert.equal(h.arreglo.campos.tiempoSetupPrograma, SETUP_PROGRAMA_REF);
  assert.ok(!('tiempoCargaChapa' in h.arreglo.campos),
    'los 45 s medidos no se reemplazan por la referencia');
});

test('el margen NO trae arreglo: es una decisión del dueño', () => {
  /* La frontera del mecanismo. Los segundos que tarda subir una chapa son
     física; cuánto quiere ganar el taller no lo puede proponer el sistema, ni
     siquiera cuando el número parece un error de tipeo. */
  const cfg = { ...DEFAULT_CONFIG, comercial: { ...DEFAULT_CONFIG.comercial, margen: 1500 } };
  const r = revisarDatos({ ...DATOS_OK, config: cfg });
  const h = r.hallazgos.find((x) => /margen de 1500/.test(x.msg));
  assert.ok(h, 'igual tiene que avisar');
  assert.ok(!h.arreglo, 'pero sin proponer un número');
});

test('los datos de fábrica no proponen ningún arreglo', () => {
  // Si la configuración correcta ofreciera correcciones, el botón enseñaría a
  // aplicar cambios sin leerlos.
  const r = revisarDatos(DATOS_OK);
  assert.ok(!r.hallazgos.some((h) => h.arreglo), 'nada que arreglar en lo que ya está bien');
});

test('detecta la puesta a punto en cero, que regala todos los trabajos chicos', () => {
  const sinSetup = { ...DEFAULT_MACHINE, tiempoSetupPrograma: 0, tiempoCargaChapa: 0 };
  const r = revisarDatos({ ...DATOS_OK, maquinas: [sinSetup, DEFAULT_PLEGADORA] });
  const h = r.hallazgos.find((x) => /en cero/.test(x.msg));
  assert.ok(h, 'nadie prepara un programa en cero segundos');
  assert.equal(h.nivel, 'error');
  assert.ok(/180 s/.test(h.msg), 'tiene que decir con qué valores arrancar');
});

test('detecta un mínimo por ítem que no cubre la puesta a punto', () => {
  const cfg = { ...DEFAULT_CONFIG, comercial: { ...DEFAULT_CONFIG.comercial, minimoPorItem: 2000 } };
  const r = revisarDatos({ ...DATOS_OK, config: cfg });
  assert.ok(r.hallazgos.some((h) => /no cubre ni la puesta a punto/.test(h.msg)));
});

test('detecta el galvanizado más barato que el acero al carbono', () => {
  const mats = DEFAULT_MATERIALS.map((m) => (m.id === 'galvanizado' ? { ...m, precioKg: 3400 } : m));
  const r = revisarDatos({ ...DATOS_OK, materiales: mats });
  assert.ok(r.hallazgos.some((h) => /zincado/.test(h.msg)), 'es la misma chapa más el zincado');
});

test('NO se queja del F-24 al mismo precio que el laminado en frío', () => {
  // En teoría el caliente sale menos, pero comprando poco volumen pueden
  // salir iguales. Avisar de algo que puede ser correcto enseña a ignorar.
  const mats = DEFAULT_MATERIALS.map((m) => (m.id === 'acero-f24' ? { ...m, precioKg: 3800 } : m));
  const r = revisarDatos({ ...DATOS_OK, materiales: mats });
  assert.ok(!r.hallazgos.some((h) => /F-24|f24/i.test(h.msg)));
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
grupo('Diseñador de plegado');

const {
  perfilNuevo, calcularPerfil, PLANTILLAS, desdePlantilla,
  agregarTramo, quitarTramo, invertirPliegue, secuenciaSugerida,
  optimizarSecuencia,
} = await import('../src/core/perfil-plegado.js');

const PLEG = DEFAULT_PLEGADORA;

test('el desarrollo es la suma de cotas menos las deducciones', () => {
  const p = { ...perfilNuevo(), tramos: [40, 100, 40], espesor: 2, ancho: 500,
    angulos: [{ grados: 90, sentido: 'arriba' }, { grados: 90, sentido: 'arriba' }] };
  const r = calcularPerfil(p, acero, PLEG);
  cerca(r.sumaCotas, 180, 1e-9);
  cerca(r.desarrollo, r.sumaCotas - r.sumaBD, 1e-9);
  assert.ok(r.desarrollo < r.sumaCotas, 'el desarrollo siempre es menor que la suma de cotas');
  assert.equal(r.pliegues.length, 2);
});

test('una chapa sin pliegues no tiene deducción', () => {
  const p = { ...perfilNuevo(), tramos: [200], angulos: [], espesor: 2, ancho: 500 };
  const r = calcularPerfil(p, acero, PLEG);
  cerca(r.desarrollo, 200, 1e-9);
  cerca(r.sumaBD, 0, 1e-9);
  assert.equal(r.lineas.length, 0);
});

test('las líneas de plegado caen dentro del desarrollo y en orden', () => {
  const r = calcularPerfil(desdePlantilla('omega', { espesor: 2, ancho: 500 }), acero, PLEG);
  assert.equal(r.lineas.length, r.pliegues.length);
  let anterior = 0;
  for (const l of r.lineas) {
    assert.ok(l.x > anterior, `las líneas tienen que ir creciendo, ${l.x} vino después de ${anterior}`);
    assert.ok(l.x < r.desarrollo, `la línea en ${l.x} cae fuera del desarrollo de ${r.desarrollo}`);
    anterior = l.x;
  }
});

test('el desarrollo generado es una pieza cortable con sus pliegues', () => {
  const r = calcularPerfil(desdePlantilla('u', { espesor: 2, ancho: 500 }), acero, PLEG);
  const b = shapeBBox(r.shape);
  cerca(b.w, r.desarrollo, 0.01);
  cerca(b.h, r.ancho, 0.01);
  assert.equal(r.shape.pliegues.length, r.pliegues.length);
});

test('a más espesor, más deducción', () => {
  const base = { ...perfilNuevo(), tramos: [50, 100, 50], ancho: 500,
    angulos: [{ grados: 90, sentido: 'arriba' }, { grados: 90, sentido: 'arriba' }] };
  const fino = calcularPerfil({ ...base, espesor: 1 }, acero, PLEG);
  const grueso = calcularPerfil({ ...base, espesor: 4 }, acero, PLEG);
  assert.ok(grueso.sumaBD > fino.sumaBD, 'la chapa gruesa consume más material en el pliegue');
  assert.ok(grueso.desarrollo < fino.desarrollo);
});

test('el sentido del pliegue cambia la forma pero no el desarrollo', () => {
  const u = desdePlantilla('u', { espesor: 2, ancho: 500 });
  const z = invertirPliegue(u, 1);
  const ru = calcularPerfil(u, acero, PLEG);
  const rz = calcularPerfil(z, acero, PLEG);
  cerca(rz.desarrollo, ru.desarrollo, 1e-9, 'plegar para el otro lado no cambia cuánta chapa hace falta');
  // En una U las dos alas vuelven sobre el mismo lado, así que la sección es
  // angosta; en una Z una se va para cada lado y la sección se ensancha.
  // La altura, que la fija el alma, no cambia.
  cerca(rz.seccion.bbox.h, ru.seccion.bbox.h, 0.01, 'el alma es la misma, la altura no cambia');
  assert.ok(rz.seccion.bbox.w > ru.seccion.bbox.w * 1.5,
    `la Z tiene que ser más ancha que la U: ${ru.seccion.bbox.w.toFixed(1)} contra ${rz.seccion.bbox.w.toFixed(1)}`);
});

test('avisa cuando el ala es menor que el mínimo plegable', () => {
  const p = { ...perfilNuevo(), tramos: [5, 100, 50], espesor: 3, ancho: 500,
    angulos: [{ grados: 90, sentido: 'arriba' }, { grados: 90, sentido: 'arriba' }] };
  const r = calcularPerfil(p, acero, PLEG);
  const err = r.avisos.filter((a) => a.nivel === 'error');
  assert.ok(err.some((a) => /ala/i.test(a.msg)), 'un ala de 5 mm en 3 mm de chapa no se puede plegar');
});

test('avisa cuando la pieza no entra en la plegadora', () => {
  const p = { ...perfilNuevo(), tramos: [50, 100, 50], espesor: 2, ancho: PLEG.largoUtil + 500,
    angulos: [{ grados: 90, sentido: 'arriba' }, { grados: 90, sentido: 'arriba' }] };
  const r = calcularPerfil(p, acero, PLEG);
  assert.ok(r.avisos.some((a) => a.nivel === 'error' && /largo útil/i.test(a.msg)));
});

test('detecta tramos que se cruzan al plegar', () => {
  // Dos alas paralelas NO chocan por más juntas que estén: la que choca es la
  // pieza sobrecerrada, donde los pliegues pasan de 90° y las alas convergen.
  const paralelas = { ...perfilNuevo(), tramos: [80, 12, 80], espesor: 2, ancho: 500,
    angulos: [{ grados: 90, sentido: 'arriba' }, { grados: 90, sentido: 'arriba' }] };
  assert.equal(calcularPerfil(paralelas, acero, PLEG).seccion.colisiones.length, 0,
    'dos alas paralelas a 12 mm no se tocan, no hay que avisar de más');

  const cerrada = { ...perfilNuevo(), tramos: [90, 30, 90], espesor: 2, ancho: 500,
    angulos: [{ grados: 150, sentido: 'arriba' }, { grados: 150, sentido: 'arriba' }] };
  const r = calcularPerfil(cerrada, acero, PLEG);
  assert.ok(r.seccion.colisiones.length > 0, 'con pliegues de 150° las alas se cruzan');
  assert.ok(r.avisos.some((a) => a.nivel === 'error' && /se cruzan/i.test(a.msg)));
});

test('todas las plantillas se pliegan sin error en 1,5 y 2 mm', () => {
  for (const esp of [1.5, 2]) {
    for (const pl of PLANTILLAS) {
      const r = calcularPerfil(desdePlantilla(pl.id, { espesor: esp, ancho: 500 }), acero, PLEG);
      const err = r.avisos.filter((a) => a.nivel === 'error');
      assert.equal(err.length, 0,
        `la plantilla "${pl.nombre}" da error en ${esp} mm: ${err.map((e) => e.msg).join(' / ')}`);
      assert.ok(r.desarrollo > 0);
    }
  }
});

test('la secuencia sugerida cubre todos los pliegues una sola vez', () => {
  const r = calcularPerfil(desdePlantilla('omega', { espesor: 2, ancho: 500 }), acero, PLEG);
  assert.equal(r.secuencia.length, r.pliegues.length);
  const vistos = new Set(r.secuencia.map((s) => s.pliegue));
  assert.equal(vistos.size, r.pliegues.length, 'no puede repetir ni saltear un pliegue');
  assert.equal(r.secuencia[0].paso, 1);
});

test('la secuencia empieza por el lado que menos sobresale', () => {
  // Tramos muy desparejos: el ala corta tiene que plegarse primero
  const s = secuenciaSugerida([20, 300, 400], [{ indice: 1 }, { indice: 2 }]);
  assert.equal(s[0].pliegue, 1, 'primero el pliegue del lado corto');
});

test('cada paso sugerido conserva una geometría intermedia sin cruces', () => {
  const perfil = { ...perfilNuevo(), tramos: [30, 120, 80, 25], angulos: [
    { grados: 90, sentido: 'arriba' }, { grados: 90, sentido: 'abajo' }, { grados: 90, sentido: 'arriba' },
  ], espesor: 2, ancho: 500 };
  const r = calcularPerfil(perfil, acero, PLEG);
  assert.equal(r.secuenciaValida, true);
  assert.equal(r.secuencia.length, 3);
  assert.ok(r.secuencia.every((p) => p.estado?.pts?.length > 1 && p.colisiones.length === 0));
});

test('la factibilidad no promete colisión de herramental sin su geometría 3D', () => {
  const r = calcularPerfil({ ...perfilNuevo(), tramos: [40, 100, 40] }, acero, PLEG);
  assert.equal(r.factibilidad.herramental3D, false);
  assert.ok(r.avisos.some((a) => /geometría real.*herramental/i.test(a.msg)));
});

test('agregar y quitar tramos mantiene la coherencia', () => {
  let p = perfilNuevo();
  assert.equal(p.angulos.length, p.tramos.length - 1);
  p = agregarTramo(p, 60, 90, 'abajo');
  assert.equal(p.tramos.length, 3);
  assert.equal(p.angulos.length, 2);
  p = quitarTramo(p, 1);
  assert.equal(p.angulos.length, p.tramos.length - 1, 'siempre un pliegue menos que tramos');
  // No se puede bajar de dos tramos: dejaría de ser un perfil
  const minimo = quitarTramo({ ...perfilNuevo() }, 0);
  assert.equal(minimo.tramos.length, 2);
});

test('cuenta los cambios de herramental por ángulos distintos', () => {
  const igual = calcularPerfil({ ...perfilNuevo(), tramos: [40, 100, 40], espesor: 2, ancho: 500,
    angulos: [{ grados: 90, sentido: 'arriba' }, { grados: 90, sentido: 'arriba' }] }, acero, PLEG);
  const distinto = calcularPerfil({ ...perfilNuevo(), tramos: [40, 100, 40], espesor: 2, ancho: 500,
    angulos: [{ grados: 90, sentido: 'arriba' }, { grados: 135, sentido: 'arriba' }] }, acero, PLEG);
  assert.equal(igual.plegado.herramentales, 1);
  assert.ok(distinto.plegado.herramentales > 1, 'dos ángulos distintos obligan a cambiar herramienta');
});

test('el perfil se puede cotizar como ítem', () => {
  const r = calcularPerfil(desdePlantilla('u', { espesor: 2, ancho: 500 }), acero, PLEG);
  const cot = cotizarItem({
    nombre: 'Canal U', shape: r.shape, materialId: 'acero-sae1010',
    espesor: r.espesor, cantidad: 20, plegado: r.plegado,
  }, CTX);
  assert.ok(!cot.error, cot.error);
  assert.ok(cot.costos.plegado > 0, 'el plegado tiene que costar algo');
  assert.equal(cot.plegado.nPliegues, 2);
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

test('el mayor rectángulo de un agujero redondo es su cuadrado inscripto', () => {
  /* Es la cota que define cuánto se puede meter adentro de un agujero. En un
     círculo de radio R el cuadrado inscripto tiene lado R·√2; con la holgura
     de corte queda un poco menos. Si diera más, se estaría prometiendo un
     encaje que no existe y las dos piezas se cortarían encima. */
  const R = 120;
  const poly = [];
  for (let i = 0; i < 96; i++) {
    const a = (i / 96) * Math.PI * 2;
    poly.push([300 + R * Math.cos(a), 300 + R * Math.sin(a)]);
  }
  const sep = 7.5;
  const r = rectanguloEnHueco(poly, sep, 2);
  const ladoIdeal = R * Math.SQRT2;
  assert.ok(r, 'tiene que encontrar un rectángulo');
  assert.ok(r.w <= ladoIdeal && r.h <= ladoIdeal,
    `dio ${r.w.toFixed(0)}×${r.h.toFixed(0)} y el cuadrado inscripto es ${ladoIdeal.toFixed(0)}: no puede pasarse`);
  assert.ok(r.w > ladoIdeal - 4 * sep, `dio ${r.w.toFixed(0)} y desperdicia demasiado`);

  // Y todo el rectángulo tiene que caer adentro del círculo con su holgura
  for (const [x, y] of [[r.x, r.y], [r.x + r.w, r.y], [r.x, r.y + r.h], [r.x + r.w, r.y + r.h]]) {
    const d = Math.hypot(x - 300, y - 300);
    assert.ok(d <= R - sep + 2, `una esquina quedó a ${d.toFixed(1)} mm del centro y el borde útil es ${(R - sep).toFixed(1)}`);
  }
});

test('las piezas chicas se meten en el agujero de las grandes y ahorran una chapa', () => {
  /* El material de adentro de un agujero ya está comprado y ya se paga. Es lo
     que más ataca el desperdicio en un taller que corta bridas o tapas. */
  const brida = makeShape(rect(0, 0, 320, 320, 20), [circle(160, 160, 120)]);
  const chapita = makeShape(rect(0, 0, 70, 50, 4));
  const b1 = shapeBBox(brida);
  const b2 = shapeBBox(chapita);
  const items = () => [
    { id: 'brida', nombre: 'Brida', w: b1.w, h: b1.h, cantidad: 36, shape: brida },
    { id: 'chapita', nombre: 'Chapita', w: b2.w, h: b2.h, cantidad: 260, shape: chapita },
  ];
  const chapa = { w: 3000, h: 1500 };
  const opts = { separacion: 5, margen: 10, formaReal: true };

  const sinHuecos = nest(items(), chapa, { ...opts, usarHuecos: false });
  const conHuecos = nest(items(), chapa, opts);

  assert.ok(
    conHuecos.cantidadChapas < sinHuecos.cantidadChapas,
    `con huecos usó ${conHuecos.cantidadChapas} chapas y sin huecos ${sinHuecos.cantidadChapas}: tiene que ahorrar al menos una`
  );
  assert.ok(conHuecos.piezasEnHuecos > 0, 'tiene que informar cuántas piezas metió en agujeros');
  assert.ok(
    conHuecos.aprovechamientoGlobal > sinHuecos.aprovechamientoGlobal,
    'y el aprovechamiento tiene que subir'
  );
  // Todas las piezas pedidas siguen estando: no se puede perder ninguna
  const colocadas = conHuecos.chapas.reduce((a, c) => a + c.piezas.length, 0);
  assert.equal(colocadas, 36 + 260, `quedaron ${colocadas} piezas de 296`);
});

test('no se mete una pieza en un agujero donde no entra', () => {
  /* La regla que no se afloja: nunca prometer un encaje que no existe. Una
     brida de 320 no entra en un agujero de 240 por más que sobre chapa. */
  const brida = makeShape(rect(0, 0, 320, 320, 20), [circle(160, 160, 120)]);
  const b1 = shapeBBox(brida);
  const r = nest(
    [{ id: 'brida', nombre: 'Brida', w: b1.w, h: b1.h, cantidad: 78, shape: brida }],
    { w: 3000, h: 1500 },
    { separacion: 5, margen: 10, formaReal: true }
  );
  assert.ok(!r.piezasEnHuecos, 'no puede haber metido una brida adentro de otra brida');
  assert.equal(
    r.chapas.reduce((a, c) => a + c.piezas.length, 0), 78,
    'y no puede haber perdido ninguna'
  );
});

test('el aprovechamiento nunca puede pasar del 100 %', () => {
  /* Daba 114 % con un trapecio, y no era un detalle cosmético: se medía el
     área del RECTÁNGULO ENVOLVENTE en vez de la de la pieza. Un trapecio ocupa
     el 73 % de su envolvente, así que el anidado se veía mucho mejor de lo que
     era — y de ese número salen las chapas a comprar y el retazo que se
     promete guardar. Mentía para el lado peligroso. */
  const formas = {
    trapecio: makeShape(polyline([[0, 0], [300, 0], [220, 180], [80, 180]], true)),
    triangulo: makeShape(polyline([[0, 0], [280, 0], [140, 200]], true)),
    ele: makeShape(polyline([[0, 0], [240, 0], [240, 80], [80, 80], [80, 220], [0, 220]], true)),
    disco: makeShape(circle(100, 100, 90)),
  };
  for (const [nombre, sh] of Object.entries(formas)) {
    const bb = shapeBBox(sh);
    const r = nest(
      [{ id: 'p', nombre, w: bb.w, h: bb.h, cantidad: 120, shape: sh }],
      { w: 3000, h: 1500 },
      { separacion: 4, margen: 10, formaReal: true }
    );
    assert.ok(
      r.aprovechamientoGlobal > 0 && r.aprovechamientoGlobal <= 1,
      `${nombre}: dio ${(r.aprovechamientoGlobal * 100).toFixed(1)} % y no puede pasar de 100`
    );
    for (const ch of r.chapas) {
      assert.ok(ch.aprovechamiento <= 1, `${nombre}: una chapa dio ${(ch.aprovechamiento * 100).toFixed(1)} %`);
    }
    // Y el área consumida tiene que ser la de las piezas, no la del envolvente
    const areaPieza = shapeArea(sh);
    cerca(r.areaConsumidaTotal, areaPieza * 120, areaPieza * 0.5, `${nombre}: el área consumida`);
  }
});

test('el multi-arranque deja la última chapa lo más vacía posible', () => {
  /* El desempate era el área total usada, que es la MISMA en todas las
     variantes porque las piezas son las mismas: nunca desempataba y ganaba
     siempre la primera de la lista. Ahora desempata la última chapa, que es
     lo que deja un retazo grande y entero en vez de varios pedacitos. */
  const sh = makeShape(polyline([[0, 0], [300, 0], [220, 180], [80, 180]], true));
  const bb = shapeBBox(sh);
  const items = () => [{ id: 'p', nombre: 'trapecio', w: bb.w, h: bb.h, cantidad: 200, shape: sh }];
  const chapa = { w: 3000, h: 1500 };
  const base = { separacion: 4, margen: 10, formaReal: true };

  const conservador = nest(items(), chapa, { ...base, orden: 'lado', rotacionLibre: false, pesos: { y: 1, hueco: 0, alto: 0 } });
  const multi = nest(items(), chapa, base);

  assert.ok(
    multi.chapas[0].piezas.length >= conservador.chapas[0].piezas.length,
    `el multi-arranque metió ${multi.chapas[0].piezas.length} y el conservador ${conservador.chapas[0].piezas.length}: nunca puede ser menos`
  );
  assert.ok(multi.cantidadChapas <= conservador.cantidadChapas, 'ni usar más chapas');
});

test('la calidad máxima nunca queda peor que la equilibrada', () => {
  const sh = makeShape(polyline([[0, 0], [260, 0], [210, 80], [90, 190], [0, 130]], true));
  const bb = shapeBBox(sh);
  const items = [{ id:'p', nombre:'irregular', w:bb.w, h:bb.h, cantidad:72, shape:sh }];
  const chapa = { w:1500, h:1000 };
  const opts = { separacion:4, margen:10, formaReal:true };
  const equilibrada = nest(items, chapa, { ...opts, calidad:'equilibrada' });
  const maxima = nest(items, chapa, { ...opts, calidad:'maxima' });
  assert.ok(maxima.cantidadChapas <= equilibrada.cantidadChapas);
  if (maxima.cantidadChapas === equilibrada.cantidadChapas) {
    assert.ok(maxima.aprovechamientoUltima <= equilibrada.aprovechamientoUltima + 1e-9);
  }
  assert.ok(maxima.intentos > equilibrada.intentos);
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
/* ==================================================================
   Auditoría: cada fórmula de docs/CALCULOS.md contra la cuenta a mano.
   Si alguien cambia una fórmula sin querer, acá salta.
   ================================================================== */
grupo('Auditoría de los cálculos');

test('peso: área × espesor × densidad', () => {
  // Placa 400×300×2 mm en acero: 0,12 m² × 2 mm × 7,85 = 1,884 kg
  const sh = makeShape(rect(0, 0, 400, 300));
  const r = cotizarItem({ shape: sh, materialId: 'acero-sae1010', espesor: 2, cantidad: 1 }, CTX);
  cerca(r.geometria.pesoPieza, 1.884, 0.001, 'el peso tiene que dar 1,884 kg');
  cerca(r.geometria.pesoPieza, pesoKg(400 * 300, 2, acero.densidad), 1e-9);
});

test('longitud de corte: el perímetro, sin inventar nada', () => {
  const sh = makeShape(rect(0, 0, 400, 300));
  const r = cotizarItem({ shape: sh, materialId: 'acero-sae1010', espesor: 2, cantidad: 1 }, CTX);
  cerca(r.geometria.largoCorteMM, 2 * (400 + 300), 0.001, 'perímetro = 2×(400+300) = 1400 mm');
});

test('un círculo mide πD, no el polígono inscripto', () => {
  const sh = makeShape(circle(100, 100, 50));
  const r = cotizarItem({ shape: sh, materialId: 'acero-sae1010', espesor: 2, cantidad: 1 }, CTX);
  cerca(r.geometria.largoCorteMM, Math.PI * 100, 0.01, 'perímetro exacto del círculo');
  const areaExacta = Math.PI * 50 * 50;
  cerca(r.geometria.areaNetaMM2, areaExacta, areaExacta * 0.0005,
    'el área del disco tiene que ser exacta, no aproximada');
});

test('estructura: gasto fijo dividido las horas productivas', () => {
  const e = calcularEstructura(DEFAULT_ESTRUCTURA);
  const abiertas = DEFAULT_ESTRUCTURA.diasHabilesMes * DEFAULT_ESTRUCTURA.horasPorDia;
  cerca(e.horasAbiertas, abiertas, 1e-9);
  cerca(e.horasProductivas, (abiertas * DEFAULT_ESTRUCTURA.ocupacionProductiva) / 100, 1e-9);
  cerca(e.porHora, e.totalMes / e.horasProductivas, 1e-9);
  const pot = e.items.find((i) => i.id === 'potencia');
  cerca(pot.valor, DEFAULT_ESTRUCTURA.potenciaContratadaKW * DEFAULT_ESTRUCTURA.cargoPotenciaKWMes, 0.01);
});

test('costo horario: la suma de sus seis componentes', () => {
  const e = calcularEstructura(DEFAULT_ESTRUCTURA);
  const c = calcularCostoHoraMaquina(DEFAULT_MACHINE, e);
  const k = DEFAULT_MACHINE.costo;
  cerca(c.amortizacion, k.valorEquipo / k.vidaUtilHoras, 1e-9);
  cerca(c.energia, k.consumoKW * k.costoKWh, 1e-9);
  cerca(c.operario, (k.operarioHora * k.dedicacionOperario) / 100, 1e-9);
  cerca(c.estructura, e.porHora * (DEFAULT_MACHINE.participacionEstructura / 100), 1e-9);
  cerca(c.total, c.amortizacion + c.energia + c.mantenimiento + c.consumibles + c.operario + c.estructura, 1e-9);
});

test('el operario cuesta 1,86 veces el básico de convenio', () => {
  const cnc = UOM_RAMA17.categorias.find((c) => c.id === 'operador-cnc');
  const c = costoHoraOperario(cnc.basicoHora, CARGAS_LABORALES);
  const conAd = cnc.basicoHora * 1.1;
  const conCargas = conAd * (1 + (26.4 + 7 + 0.5) / 100);
  const conSac = conCargas * 1.0833;
  const final = conSac / 0.86;
  cerca(c.total, final, 1, 'la cuenta a mano tiene que dar lo mismo');
});

test('el tiempo simulado nunca es menor que el teórico', () => {
  for (const [w, h, esp] of [[400, 300, 2], [100, 80, 1.5], [800, 600, 3]]) {
    const sh = makeShape(rect(0, 0, w, h));
    const r = cotizarItem({ shape: sh, materialId: 'acero-sae1010', espesor: esp, cantidad: 1 }, CTX);
    const v = cuttingSpeed(acero, esp, 3, r.corte.gasTipo);
    const teorico = (r.geometria.largoCorteMM / v) * 60;
    assert.ok(r.corte.tCorte >= teorico * 0.98,
      w + 'x' + h + ' en ' + esp + ' mm: simulado ' + r.corte.tCorte.toFixed(1) + 's contra ' + teorico.toFixed(1) + 's teóricos');
    assert.ok(r.corte.tCorte < teorico * 3, 'tampoco puede ser absurdamente más lento');
  }
});

test('los agujeros chicos frenan la máquina; los grandes no', () => {
  // La velocidad en un arco está limitada por la aceleración centrípeta:
  //   v = sqrt(a * R)
  // Con 1,2 G y 8.500 mm/min de material, el límite recién aparece cuando
  // R < v²/a ≈ 1,7 mm. Un agujero de Ø6 NO frena; uno de Ø2,5 sí.
  const lisa = makeShape(rect(0, 0, 300, 200));
  const grandes = [];
  for (let i = 0; i < 10; i++) for (let j = 0; j < 8; j++) grandes.push(circle(15 + i * 30, 12 + j * 24, 3));
  const conGrandes = cotizarItem({ shape: makeShape(rect(0, 0, 300, 200), grandes), materialId: 'acero-sae1010', espesor: 2, cantidad: 1 }, CTX);
  const holes = [];
  for (let i = 0; i < 10; i++) for (let j = 0; j < 8; j++) holes.push(circle(15 + i * 30, 12 + j * 24, 1.25));
  const perforada = makeShape(rect(0, 0, 300, 200), holes);
  const a = cotizarItem({ shape: lisa, materialId: 'acero-sae1010', espesor: 2, cantidad: 1 }, CTX);
  const b = cotizarItem({ shape: perforada, materialId: 'acero-sae1010', espesor: 2, cantidad: 1 }, CTX);
  const caidaChicos = 1 - b.corte.vMediaEfectiva / a.corte.vMediaEfectiva;
  const caidaGrandes = 1 - conGrandes.corte.vMediaEfectiva / a.corte.vMediaEfectiva;
  // Medido: Ø6 cae 5 %, Ø2,5 cae 12 %, Ø1 cae 19 %. La caída es gradual
  // porque el promedio incluye los 1.400 mm de perímetro recto, que se
  // recorren a velocidad plena.
  assert.ok(caidaChicos > 0.09,
    'con 80 agujeros de Ø2,5 la velocidad media tiene que caer al menos 9 %, cayó '
      + (caidaChicos * 100).toFixed(0) + ' %');
  assert.ok(caidaGrandes < 0.07,
    'un agujero de Ø6 está por encima del umbral de curvatura: no debería penalizar más de 7 %, penalizó '
      + (caidaGrandes * 100).toFixed(0) + ' %');
  assert.ok(caidaChicos > caidaGrandes * 1.8,
    'los agujeros chicos tienen que frenar bastante más que los grandes');
  assert.ok(b.corte.penalizacion > a.corte.penalizacion);
});

test('el gas sale del caudal por el tiempo con el haz encendido', () => {
  const sh = makeShape(rect(0, 0, 400, 300));
  const r = cotizarItem({ shape: sh, materialId: 'inox-304', espesor: 3, cantidad: 10, gas: 'N2' }, CTX);
  const horasHaz = (r.corte.tCorte + r.corte.tPierce + r.corte.tEntradas) / 3600;
  cerca(r.corte.gasM3, r.corte.gasCaudal * horasHaz, r.corte.gasM3 * 0.02,
    'm3 = caudal por horas de haz encendido');
  cerca(r.costos.gas, r.costos.gasM3 * r.costos.precioGasM3, 0.01);
});

test('el kilo entregado es el comprado dividido el aprovechamiento', () => {
  const sh = makeShape(rect(0, 0, 400, 300));
  const r = cotizarItem({ shape: sh, materialId: 'acero-sae1010', espesor: 2, cantidad: 30 }, CTX);
  const porKgEntregado = r.costos.material / r.geometria.pesoTotal;
  assert.ok(porKgEntregado > acero.precioKg,
    'el kilo entregado siempre cuesta más que el comprado: el recorte lo paga el taller');
  const esperado = acero.precioKg / (r.nesting.aprovechamiento || 1);
  cerca(porKgEntregado, esperado, esperado * 0.5,
    'entregado ' + porKgEntregado.toFixed(0) + '/kg con ' + (r.nesting.aprovechamiento * 100).toFixed(0) + ' % de aprovechamiento');
});

test('el precio se arma en el orden documentado', () => {
  const sh = makeShape(rect(0, 0, 400, 300));
  const r = cotizarItem({ shape: sh, materialId: 'acero-sae1010', espesor: 2, cantidad: 30 }, CTX);
  const c = r.costos;
  cerca(c.total, c.material + c.corte + c.preparacion + c.gas + c.plegado + c.acabado + c.procesos + c.ingenieria, 0.01);
  cerca(r.precio.lista, c.total * (1 + r.precio.margen / 100), 0.01);
  const conDesc = r.precio.lista * (1 - r.precio.descuentoPct / 100);
  const conIIBB = conDesc * (1 + r.precio.iibbPct / 100);
  assert.ok(Math.abs(r.precio.neto - conIIBB) <= (DEFAULT_CONFIG.comercial.redondeo || 1) + 1,
    'neto ' + r.precio.neto + ' debería salir de ' + conIIBB.toFixed(0) + ' más el redondeo');
});

test('en chapa fina el material domina el costo', () => {
  const sh = makeShape(rect(0, 0, 400, 300));
  const r = cotizarItem({ shape: sh, materialId: 'acero-sae1010', espesor: 2, cantidad: 30 }, CTX);
  const peso = r.costos.material / r.costos.total;
  assert.ok(peso > 0.85, 'el material debería ser >85 % del costo en 2 mm, dio ' + (peso * 100).toFixed(0) + ' %');
});

test('cambiar el precio de la chapa mueve el precio casi en la misma proporción', () => {
  const sh = makeShape(rect(0, 0, 400, 300));
  const base = { shape: sh, materialId: 'acero-sae1010', espesor: 2, cantidad: 30 };
  const caro = {
    ...CTX,
    materiales: CTX.materiales.map((m) => (m.id === 'acero-sae1010' ? { ...m, precioKg: m.precioKg * 1.1 } : m)),
  };
  const a = cotizarItem(base, CTX);
  const b = cotizarItem(base, caro);
  const subida = (b.precio.neto / a.precio.neto - 1) * 100;
  assert.ok(subida > 7 && subida < 11,
    'subir la chapa 10 % debería subir el precio entre 7 y 11 %, subió ' + subida.toFixed(1) + ' %');
});

test('el desarrollo plegado coincide con la cuenta a mano', () => {
  const r = calcularDesarrollo([40, 100, 40], [90, 90], 2, acero, 16, 500);
  cerca(r.sumaCotas, 180, 1e-9);
  cerca(r.desarrollo, 180 - r.sumaBD, 1e-9);
  cerca(r.desarrollo, 172.25, 0.5, 'el desarrollo documentado es 172,25 mm');
  const p = r.pliegues[0];
  cerca(p.BD, 2 * p.OSSB - p.BA, 1e-9);
});

test('el tonelaje sale de la fórmula de plegado al aire', () => {
  const p = calcularPliegue(2, 90, acero, 16, 1000);
  const kNporMetro = (1.33 * acero.Rm * 2 * 2) / 16;
  cerca(p.toneladasPorMetro, kNporMetro / 9.80665, 0.01);
  cerca(p.toneladas, (p.toneladasPorMetro * 1000) / 1000, 0.01);
});

/* ================================================================== */
grupo('Paneles decorativos');

test('el motivo se reparte parejo y con margenes iguales', () => {
  /* Margenes iguales es lo que hace que un panel se vea hecho a proposito y
     no cortado donde llego. Y ningun motivo puede quedar cortado por la
     mitad en el borde. */
  const r = panelDecorativo(
    { ancho: 1200, alto: 2400, motivo: 'rombo', tamMotivo: 60, margen: 50 },
    { espesor: 1.5 }
  );
  const bb = shapeBBox(r.shape);
  cerca(bb.w, 1200, 0.01, 'el panel mide lo que se pidio');
  cerca(bb.h, 2400, 0.01);
  assert.ok(r.info.cols > 1 && r.info.filas > 1, 'tiene que entrar mas de uno');
  assert.equal(r.info.motivos, r.info.cols * r.info.filas);

  // Todos los calados adentro del borde liso
  for (const h of r.shape.holes) {
    const b = pathBBox(h);
    assert.ok(b.minX >= r.info.margen - 0.01, `un calado se sale por la izquierda: ${b.minX.toFixed(1)}`);
    assert.ok(b.minY >= r.info.margen - 0.01, 'un calado se sale por abajo');
    assert.ok(b.maxX <= bb.w - r.info.margen + 0.01, 'un calado se sale por la derecha');
    assert.ok(b.maxY <= bb.h - r.info.margen + 0.01, 'un calado se sale por arriba');
  }
});

test('el ligamento minimo se respeta aunque se pida menos', () => {
  /* Si el ligamento es muy chico, el calor de dos cortes vecinos se suma, se
     ablanda y el panel sale ondulado. No hay forma de enderezarlo despues. */
  cerca(ligamentoMinimo(1.5), 3, 1e-9);
  cerca(ligamentoMinimo(3), 6, 1e-9);
  cerca(ligamentoMinimo(0.5), 1.5, 1e-9, 'nunca menos de 1,5 mm');

  const r = panelDecorativo(
    { ancho: 1200, alto: 2400, motivo: 'circulo', tamMotivo: 60, separacion: 0.5 },
    { espesor: 3 }
  );
  assert.ok(r.info.ligamento >= 6 - 1e-6,
    `dio ${r.info.ligamento.toFixed(1)} mm y el minimo en 3 mm de chapa es 6`);
  assert.ok(r.avisos.some((x) => x.nivel === 'aviso' && /ligamento/i.test(x.msg)),
    'y tiene que avisar que lo subio, no corregirlo en silencio');
});

test('todos los motivos generan un panel cortable', () => {
  for (const m of MOTIVOS) {
    for (const patron of PATRONES) {
      const r = panelDecorativo(
        { ancho: 900, alto: 900, motivo: m.id, tamMotivo: 70, patron: patron.id },
        { espesor: 2 }
      );
      assert.ok(shapeArea(r.shape) > 0, `${m.nombre} en ${patron.nombre}: area cero`);
      assert.ok(r.info.motivos > 0, `${m.nombre} en ${patron.nombre}: no puso ningun calado`);
      assert.ok(r.info.caladoPct > 0 && r.info.caladoPct < 100,
        `${m.nombre}: calado ${r.info.caladoPct.toFixed(1)} % imposible`);
      assert.ok(!r.avisos.some((x) => x.nivel === 'error'), `${m.nombre} en ${patron.nombre} da error`);
    }
  }
});

test('un panel imposible lo dice en vez de devolver una chapa lisa', () => {
  const r = panelDecorativo({ ancho: 100, alto: 100, motivo: 'circulo', tamMotivo: 200 }, { espesor: 2 });
  assert.equal(r.info.motivos, 0);
  assert.ok(r.avisos.some((x) => x.nivel === 'error'), 'tiene que dar error');
  assert.ok(shapeArea(r.shape) > 0, 'y devolver la chapa entera, no algo roto');
});

test('se puede pedir por cantidad de columnas en vez de por tamano', () => {
  /* Es como se pide en el mostrador: "quiero seis columnas a lo ancho". */
  const tam = tamanioParaGrilla({ ancho: 1200, alto: 2400, cols: 6, filas: 12, margen: 50, separacion: 8 });
  assert.ok(tam > 0);
  const r = panelDecorativo(
    { ancho: 1200, alto: 2400, motivo: 'gota', tamMotivo: tam, margen: 50, separacion: 8 },
    { espesor: 2 }
  );
  assert.equal(r.info.cols, 6, `pidio 6 columnas y entraron ${r.info.cols}`);
  assert.equal(r.info.filas, 12, `pidio 12 filas y entraron ${r.info.filas}`);
});

/* ================================================================== */
grupo('Catalogo de medidas normalizadas');

test('todas las medidas del catalogo se construyen de verdad', () => {
  /* Es lo unico que hace real a un catalogo grande: si una medida no
     construye, es una entrada que alguien va a elegir y le va a fallar en el
     mostrador. Se verifican TODAS, en tres espesores. */
  const todas = variantes();
  assert.ok(todas.length > 250, `el catalogo tiene ${todas.length} medidas`);

  const fallan = [];
  for (const x of todas) {
    try {
      const p = construir(x.piezaId, paramsDeVariante(x), { espesor: 2, material: acero });
      if (!(shapeArea(p.shape) > 0)) throw new Error('area cero');
      const b = shapeBBox(p.shape);
      if (!(b.w > 0 && b.h > 0)) throw new Error('sin medida');
      const err = (p.avisos || []).find((z) => z.nivel === 'error');
      if (err) throw new Error(err.msg.slice(0, 60));
    } catch (e) {
      fallan.push(`${x.nombre}: ${e.message}`);
    }
  }
  assert.equal(fallan.length, 0, `no construyen:\n  ${fallan.slice(0, 8).join('\n  ')}`);
});

test('cada medida apunta a una familia que existe', () => {
  for (const x of variantes()) {
    assert.ok(getPieza(x.piezaId), `"${x.nombre}" apunta a la pieza inexistente "${x.piezaId}"`);
    assert.ok(x.nombre && x.nombre.length > 3, 'toda medida necesita un nombre de catalogo');
  }
});

test('las bridas DIN 2576 salen con la medida de la norma', () => {
  /* Una brida con el diametro exterior mal es una brida que no calza contra
     la otra. Se verifica contra la tabla de la norma. */
  const casos = [['DN50', 165], ['DN100', 220], ['DN150', 285], ['DN300', 445]];
  for (const [dn, ext] of casos) {
    const va = variantes().find((x) => x.piezaId === 'disco' && x.nombre.includes(dn));
    assert.ok(va, `falta la brida circular ${dn}`);
    const p = construir(va.piezaId, paramsDeVariante(va), { espesor: 3, material: acero });
    const b = shapeBBox(p.shape);
    cerca(b.w, ext, 0.5, `${dn}: el diametro exterior`);
    cerca(b.h, ext, 0.5, `${dn}: tiene que ser redonda`);
  }
});

test('las abrazaderas usan el diametro EXTERIOR real del cano', () => {
  /* El nominal en pulgadas NO es el diametro: un cano de 2" mide 60,3 mm. Una
     abrazadera hecha con 50,8 mm no entra. */
  const dos = variantes().find((x) => x.piezaId === 'abrazadera-cano' && x.nombre.includes('2"') && !x.nombre.includes('1/2'));
  assert.ok(dos, 'falta la abrazadera de 2 pulgadas');
  assert.ok(/60/.test(dos.nombre), `el nombre tiene que decir el diametro real: "${dos.nombre}"`);
  const p = construir(dos.piezaId, paramsDeVariante(dos), { espesor: 2, material: acero });
  assert.ok(p.info.radioNeutro > 30, 'el radio neutro tiene que salir del diametro exterior');
});

test('el catalogo se resume por grupo sin perder ninguna entrada', () => {
  const r = resumenCatalogo();
  assert.equal(r.total, r.familias + r.medidas);
  assert.equal(r.total, catalogo().length);
  const suma = r.grupos.reduce((a, g) => a + g.n, 0);
  assert.equal(suma, r.total, 'la suma por grupo tiene que dar el total');
});

/* ================================================================== */
grupo('Guillotina');

test('sólo un rectángulo pelado va a la guillotina', () => {
  /* La guillotina corta de lado a lado, recto y pasante. Mandarle algo que no
     puede hacer es parar la producción con la chapa ya comprada, así que la
     decisión se toma sobre la GEOMETRÍA y no sobre una bandera que alguien
     puso a mano y quedó vieja. */
  const apta = esRectangularPelada(makeShape(rect(0, 0, 400, 250)));
  assert.ok(apta.apta, 'un rectángulo pelado sí');
  cerca(apta.ancho, 400, 0.01);
  cerca(apta.alto, 250, 0.01);

  const casos = [
    ['con un agujero', makeShape(rect(0, 0, 400, 250), [circle(200, 125, 20)]), /agujero/i],
    ['con esquinas redondeadas', makeShape(rect(0, 0, 400, 250, 15)), /esquina|vértice/i],
    ['un triángulo', makeShape(polyline([[0, 0], [400, 0], [200, 250]], true)), /vértice|rectángulo/i],
    ['una L', makeShape(polyline([[0, 0], [400, 0], [400, 100], [150, 100], [150, 250], [0, 250]], true)), /vértice|escotadura|rectángulo/i],
  ];
  for (const [nombre, sh, patron] of casos) {
    const r = esRectangularPelada(sh);
    assert.ok(!r.apta, `${nombre} NO puede ir a la guillotina`);
    assert.ok(patron.test(r.motivo), `${nombre}: el motivo "${r.motivo}" tiene que explicar por qué`);
  }
});

test('la capacidad de la guillotina baja con la resistencia del material', () => {
  /* La capacidad se publica en acero dulce. Lo que limita es la fuerza, y la
     fuerza va con la resistencia: un inoxidable de Rm 620 se corta hasta
     bastante menos espesor que un acero de Rm 370. Ignorarlo es prometer un
     corte que la máquina no da. */
  const dulce = espesorMaximoGuillotina({ Rm: 370 });
  const inox = espesorMaximoGuillotina({ Rm: 620 });
  cerca(dulce, 6, 0.01, 'en acero dulce es la capacidad nominal');
  assert.ok(inox < dulce * 0.7, `en inox dio ${inox.toFixed(1)} mm y tiene que ser bastante menos que ${dulce}`);

  const placa = makeShape(rect(0, 0, 300, 200));
  const r = puedeGuillotinarse(placa, 5, { Rm: 620, nombre: 'Inox 304' });
  assert.ok(!r.apta, 'inox de 5 mm no entra en una guillotina de 6 mm en dulce');
  assert.ok(/supera/.test(r.motivo));
});

test('la guillotina corta por tiras: la serie no cuesta un golpe por lado', () => {
  /* Es lo que la hace barata en serie. Se corta la chapa en tiras (un golpe
     por tira) y después cada tira al largo (un golpe por pieza). Cuarenta
     piezas de una tira son cuarenta golpes, no ciento sesenta. */
  const chapa = { w: 3000, h: 1500 };
  const una = tiempoGuillotina(400, 250, 1, chapa, DEFAULT_GUILLOTINA);
  const cuarenta = tiempoGuillotina(400, 250, 40, chapa, DEFAULT_GUILLOTINA);
  assert.ok(cuarenta.golpes < 40 * 4, `dio ${cuarenta.golpes} golpes: no puede ser cuatro por pieza`);
  assert.ok(cuarenta.tProduccion / 40 < una.tProduccion, 'el tiempo por pieza tiene que bajar con la cantidad');
  assert.ok(cuarenta.tiras >= 1 && cuarenta.tiras <= 40);
});

test('el desarrollo de un plegado va a la guillotina y ahorra plata', () => {
  /* El caso real: el desarrollo de una bandeja o un peldaño es un rectángulo
     pelado. Cortarlo con el láser es pagar fuente, gas y perforaciones para
     hacer cuatro líneas rectas. */
  const CTXG = { ...CTX, maquinas: [DEFAULT_MACHINE, DEFAULT_PLEGADORA, DEFAULT_GUILLOTINA] };
  const r = construir('bandeja-portacables', { perforada: false, diaUnion: 0 },
    { espesor: 1.5, material: acero });
  const item = {
    nombre: 'Bandeja', shape: r.shape, materialId: 'acero-sae1010',
    espesor: 1.5, cantidad: 20, plegado: r.plegado,
  };
  const auto = cotizarItem(item, CTXG);
  const forzadoLaser = cotizarItem({ ...item, corte: 'laser' }, CTXG);

  assert.equal(auto.costos.proceso, 'guillotina', 'un desarrollo pelado va a la guillotina');
  assert.equal(forzadoLaser.costos.proceso, 'laser', 'y se puede forzar el láser');
  assert.equal(auto.costos.gas, 0, 'la guillotina no consume gas');
  assert.ok(auto.costos.total < forzadoLaser.costos.total, 'y tiene que salir más barato');
  assert.ok(auto.costos.guillotina.ahorroPct > 30,
    `el ahorro dio ${auto.costos.guillotina.ahorroPct.toFixed(0)} % y en un rectángulo pelado tiene que ser grande`);
});

test('una placa lisa que se entrega tal cual sigue yendo al láser', () => {
  /* En automático la guillotina es para el DESARROLLO de una pieza que se
     pliega, no para cualquier rectángulo. El canto de guillotina deja rebaba:
     adentro de un perfil plegado no se ve, en una placa que se entrega sí. */
  const CTXG = { ...CTX, maquinas: [DEFAULT_MACHINE, DEFAULT_PLEGADORA, DEFAULT_GUILLOTINA] };
  const placa = { nombre: 'Placa', shape: makeShape(rect(0, 0, 400, 250)),
    materialId: 'acero-sae1010', espesor: 2, cantidad: 20 };
  const r = cotizarItem(placa, CTXG);
  assert.equal(r.costos.proceso, 'laser', 'sin pliegues se corta con láser');
  assert.ok(r.costos.guillotina.apta, 'pero el sistema igual informa que se podría');
  assert.ok(r.costos.guillotina.ahorro > 0, 'y cuánto se ahorraría si se decide');

  // Forzándola, se usa
  const forzada = cotizarItem({ ...placa, corte: 'guillotina' }, CTXG);
  assert.equal(forzada.costos.proceso, 'guillotina');
});

/* ================================================================== */
grupo('Segmentación de piezas mayores que la mesa');

test('divide una placa XXL en segmentos que entran y conservan el área', () => {
  const original=makeShape(rect(0,0,6200,1000));
  const plan=segmentarPieza(original,{espesor:3,mesa:{w:3000,h:1500}});
  assert.equal(plan.error,null);
  assert.equal(plan.segmentos.length,3);
  for(const s of plan.segmentos)assert.equal(auditarFabricabilidad(s,{espesor:3,mesa:{w:3000,h:1500}}).bloqueado,false);
  cerca(plan.segmentos.reduce((a,s)=>a+shapeArea(s),0),shapeArea(original),1e-4);
});

test('las dos piezas vecinas comparten exactamente el perfil de junta', () => {
  const plan=segmentarPieza(makeShape(rect(0,0,4000,1000)),{espesor:2,mesa:{w:3000,h:1500},profundidad:8,paso:80});
  assert.equal(plan.segmentos.length,2);
  const x=plan.juntas[0].valor;
  const sobre=(sh)=>flattenPath(sh.outer,0.05).filter((p)=>Math.abs(p[0]-x)<=8.001).map((p)=>p.map((v)=>Math.round(v*1000)/1000));
  const a=sobre(plan.segmentos[0]),b=sobre(plan.segmentos[1]);
  assert.ok(a.length>10&&b.length>10);
  assert.deepEqual(new Set(a.map(JSON.stringify)),new Set(b.map(JSON.stringify)));
});

test('mueve la junta para no atravesar un agujero', () => {
  const original=makeShape(rect(0,0,4000,1000),[circle(2000,500,80)]);
  const plan=segmentarPieza(original,{espesor:2,mesa:{w:3000,h:1500},seguridad:20});
  assert.equal(plan.error,null);
  assert.ok(Math.abs(plan.juntas[0].desplazamiento)>=100,'la junta sale de la zona del agujero');
});

test('no aproxima una curva grande para poder segmentarla', () => {
  const plan=segmentarPieza(makeShape(circle(0,0,2000)),{mesa:{w:3000,h:1500}});
  assert.match(plan.error,/no aproxima curvas/);
});

test('no segmenta automáticamente un desarrollo que después se pliega', () => {
  const shape=makeShape(rect(0,0,4000,1000));
  shape.pliegues=[{x1:2000,y1:0,x2:2000,y2:1000,angulo:90}];
  const plan=segmentarPieza(shape,{mesa:{w:3000,h:1500}});
  assert.match(plan.error,/rediseño de ingeniería/);
});

grupo('Auditoría geométrica antes del CAM');

test('una placa válida con agujeros pasa la auditoría', () => {
  const r = auditarFabricabilidad(makeShape(rect(0,0,300,200),[circle(70,70,10),circle(230,130,10)]),{espesor:2});
  assert.equal(r.bloqueado,false);
  assert.equal(r.metricas.agujeros,2);
});

test('bloquea un contorno que se cruza sobre sí mismo', () => {
  const moño=polyline([[0,0],[100,100],[0,100],[100,0]]);
  const r=auditarFabricabilidad(makeShape(moño));
  assert.ok(r.errores.some((x)=>x.codigo==='autointerseccion'));
});

test('bloquea agujeros fuera de la pieza y agujeros superpuestos', () => {
  const r=auditarFabricabilidad(makeShape(rect(0,0,100,100),[circle(95,50,10),circle(50,50,15),circle(60,50,15)]));
  assert.ok(r.errores.some((x)=>x.codigo==='agujero-fuera'));
  assert.ok(r.errores.some((x)=>x.codigo==='agujeros-superpuestos'));
});

test('un agujero menor a 1,2 veces el espesor se advierte pero no se inventa', () => {
  const r=auditarFabricabilidad(makeShape(rect(0,0,100,100),[circle(50,50,1)]),{espesor:2});
  assert.equal(r.bloqueado,false);
  assert.ok(r.avisos.some((x)=>x.codigo==='agujero-chico'));
});

test('la pieza puede entrar en la mesa girada y se bloquea si no entra de ningún modo', () => {
  assert.equal(auditarFabricabilidad(makeShape(rect(0,0,1400,2900)),{mesa:{w:3000,h:1500}}).bloqueado,false);
  assert.ok(auditarFabricabilidad(makeShape(rect(0,0,1600,3100)),{mesa:{w:3000,h:1500}}).errores.some((x)=>x.codigo==='fuera-mesa'));
});

test('un contorno abierto o discontinuo nunca sale como listo para cortar', () => {
  const abierto=polyline([[0,0],[100,0],[100,100]],false);
  assert.ok(auditarFabricabilidad(makeShape(abierto)).errores.some((x)=>x.codigo==='abierto'));
});

grupo('Planos del cliente: imagen y PDF');

/** Dibuja un plano sintético: placa 400×250 con dos agujeros Ø40. */
function planoDePrueba({ escala = 2, grueso = 3, ruido = 0, sombra = false } = {}) {
  const w = 400 * escala + 200;
  const h = 250 * escala + 200;
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  const set = (x, y, v) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const p = (y * w + x) * 4;
    data[p] = data[p + 1] = data[p + 2] = v;
    data[p + 3] = 255;
  };
  if (sombra) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) set(x, y, 255 - Math.round((x / w) * 90));
  }
  const ox = 100, oy = 100, W = 400 * escala, H = 250 * escala;
  for (let t = 0; t < grueso; t++) {
    for (let x = 0; x <= W; x++) { set(ox + x, oy + t, 20); set(ox + x, oy + H - t, 20); }
    for (let y = 0; y <= H; y++) { set(ox + t, oy + y, 20); set(ox + W - t, oy + y, 20); }
  }
  for (const [cxmm, cymm] of [[100, 125], [300, 125]]) {
    const cx = ox + cxmm * escala, cy = oy + cymm * escala, r = 20 * escala;
    for (let a = 0; a < 3600; a++) {
      const th = (a / 3600) * Math.PI * 2;
      for (let t = 0; t < grueso; t++) {
        set(Math.round(cx + (r - t) * Math.cos(th)), Math.round(cy + (r - t) * Math.sin(th)), 20);
      }
    }
  }
  if (ruido) {
    let s = 12345;
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < w * h * ruido; i++) {
      set((rnd() * w) | 0, (rnd() * h) | 0, rnd() < 0.5 ? 60 : 230);
    }
  }
  return { width: w, height: h, data, anchoPiezaPx: W };
}

test('una línea dibujada da UN contorno, no dos', () => {
  /* Es el error que hace que todo lo demás falle: una línea tiene grosor, así
     que el trazado devuelve el borde de afuera y el de adentro. Sin juntarlos,
     una placa con dos agujeros da seis contornos, los agujeros se convierten
     en piezas y el largo de corte sale al doble. */
  const img = planoDePrueba();
  const r = vectorizar(img);
  assert.equal(r.contornos.length, 3, `dieron ${r.contornos.length} contornos y son 3: la placa y dos agujeros`);
  assert.ok(r.grosorLineaPx >= 2, 'tiene que medir el grosor del trazo');
  // Los dos agujeros se reconocen como círculos y no como polígonos
  const circulos = r.contornos.filter((c) => c.circulo);
  assert.equal(circulos.length, 2, 'los agujeros redondos tienen que salir como círculos');
});

test('la pieza vectorizada mide lo que dice el plano', () => {
  /* La prueba que importa: si las medidas no salen, se corta otra pieza. Se
     verifica en cuatro condiciones distintas porque una foto de taller no es
     un escaneo de laboratorio. */
  const casos = [
    ['limpio', { }],
    ['con ruido', { ruido: 0.004 }],
    ['foto con sombra', { sombra: true }],
    ['baja resolución', { escala: 1 }],
    ['línea gruesa', { grueso: 6 }],
  ];
  for (const [nombre, opts] of casos) {
    const img = planoDePrueba(opts);
    const r = vectorizar(img);
    const mmPorPx = escalaDesdeReferencia(img.anchoPiezaPx, 400);
    const p = aPieza(r.contornos, mmPorPx, { altoImagen: img.height });
    const bb = shapeBBox(p.shape);

    cerca(bb.w, 400, 400 * 0.02, `${nombre}: el ancho`);
    cerca(bb.h, 250, 250 * 0.02, `${nombre}: el alto`);
    assert.equal(p.agujeros, 2, `${nombre}: tienen que salir los dos agujeros`);

    // Área: rectángulo menos los dos círculos
    const esperada = 400 * 250 - 2 * Math.PI * 20 * 20;
    cerca(shapeArea(p.shape), esperada, esperada * 0.04, `${nombre}: el área`);
  }
});

test('sin escala no hay pieza: no se inventa una medida', () => {
  /* Una imagen tiene píxeles, no milímetros. Inventar la escala sería cotizar
     una pieza que no es la que el cliente pidió, y eso se descubre con la
     chapa ya cortada. */
  const r = vectorizar(planoDePrueba());
  assert.throws(() => aPieza(r.contornos, 0), /escala/i);
  assert.throws(() => aPieza(r.contornos, undefined), /escala/i);
  assert.equal(escalaDesdeReferencia(0, 400), null);
  assert.equal(escalaDesdeReferencia(800, 0), null);
});

test('la pieza vectorizada sale derecha, no espejada', () => {
  /* El eje Y de una imagen crece hacia abajo y el de un plano hacia arriba.
     Sin espejar, una pieza asimétrica se corta al revés — y eso no se nota
     hasta que no encastra. Se verifica con un agujero descentrado. */
  const img = planoDePrueba();
  // El agujero de la izquierda está a 100 mm del borde izquierdo y a 125 del piso
  const r = vectorizar(img);
  const mmPorPx = escalaDesdeReferencia(img.anchoPiezaPx, 400);
  const p = aPieza(r.contornos, mmPorPx, { altoImagen: img.height });
  /* La pieza se lleva al origen al normalizarla, así que los agujeros se
     miden contra el borde de la PLACA (el contorno más grande) y no contra
     el borde de la imagen. */
  const placa = r.contornos[0].bbox;
  const centros = r.contornos
    .filter((c) => c.circulo)
    .map((c) => ({
      x: (c.circulo.cx - placa.x) * mmPorPx,
      // Desde abajo: es el sentido del plano, no el de la imagen
      y: (placa.y + placa.h - c.circulo.cy) * mmPorPx,
    }))
    .sort((a, b) => a.x - b.x);
  cerca(centros[0].x, 100, 8, 'el agujero izquierdo en X');
  cerca(centros[0].y, 125, 8, 'el agujero izquierdo en Y');
  cerca(centros[1].x, 300, 8, 'el agujero derecho en X');
});

test('la vectorización avisa cuando no encuentra nada', () => {
  const blanco = { width: 200, height: 200, data: new Uint8ClampedArray(200 * 200 * 4).fill(255) };
  const r = vectorizar(blanco);
  assert.equal(r.contornos.length, 0);
  assert.ok(r.avisos.some((a) => a.nivel === 'error'), 'una hoja en blanco tiene que dar error, no una pieza vacía');
});

test('el PDF vectorial da la medida exacta, sin calibrar', () => {
  /* Un PDF exportado del CAD trae la geometría en unidades reales. Ahí no hay
     que estimar nada: si el sistema no lo aprovechara, estaríamos degradando
     un dato exacto a uno medido a ojo. */
  const P = 1 / MM_POR_PUNTO;
  const doc = new PDF({ ancho: 595.28, alto: 841.89, margen: 20 });
  doc.hex('#000000', true);
  doc.rect(50, 50, 400 * P, 250 * P, 'S');
  doc.rect(50 + 80 * P, 50 + 105 * P, 40 * P, 40 * P, 'S');
  doc.rect(50 + 280 * P, 50 + 105 * P, 40 * P, 40 * P, 'S');

  return leerPlanoPDF(doc.save()).then((r) => {
    assert.ok(r.vectorial, 'tiene que reconocerlo como vectorial');
    assert.equal(r.contornos.length, 3);
    const p = planoAPieza(r.contornos);
    const bb = shapeBBox(p.shape);
    cerca(bb.w, 400, 0.01, 'el ancho sale exacto');
    cerca(bb.h, 250, 0.01, 'el alto sale exacto');
    assert.equal(p.agujeros, 2);
    cerca(shapeArea(p.shape), 400 * 250 - 2 * 40 * 40, 0.1, 'el área sale exacta');
  });
});

test('un PDF sin vectores lo dice en vez de devolver una pieza vacía', () => {
  const doc = new PDF({ ancho: 300, alto: 300, margen: 10 });
  doc.texto(20, 20, 'Esto es sólo texto', { size: 12 });
  return leerPlanoPDF(doc.save()).then((r) => {
    assert.equal(r.contornos.length, 0);
    assert.ok(!r.vectorial);
    assert.ok(
      r.avisos.some((a) => a.nivel === 'error' && /imagen/i.test(a.msg)),
      'tiene que mandar al camino de la imagen'
    );
  });
});

/* ================================================================== */
grupo('Envío del presupuesto');

test('el teléfono argentino se normaliza al formato de WhatsApp', () => {
  /* Es la parte que parece trivial y no lo es. Con el 15 puesto, el enlace
     abre un chat con un número que no existe y el mensaje se pierde SIN QUE
     NADIE SE ENTERE — peor que fallar, porque uno cree que lo mandó. */
  const casos = [
    ['0380 15 4123456', '5493804123456', 'La Rioja, como se escribe en una agenda'],
    ['380 15 4123456', '5493804123456', 'sin el 0 de larga distancia'],
    ['3804123456', '5493804123456', 'ya sin 15 ni 0'],
    ['+54 9 380 412-3456', '5493804123456', 'internacional completo'],
    ['54 9 380 4123456', '5493804123456', 'sin el +'],
    ['011 15 5555-4444', '5491155554444', 'área de 2 dígitos'],
    ['11 5555 4444', '5491155554444', 'CABA directo'],
    ['02954 15 456789', '5492954456789', 'área de 4 dígitos'],
    ['+55 11 91234-5678', '5511912345678', 'brasileño: no se toca'],
  ];
  for (const [entrada, esperado, nota] of casos) {
    assert.equal(telefonoWhatsApp(entrada), esperado, `${nota}: "${entrada}"`);
  }
  // Lo que no es un teléfono no puede devolver algo que parezca uno
  for (const basura of ['', null, undefined, 'hola', '123', '  ']) {
    assert.equal(telefonoWhatsApp(basura), null, `"${basura}" no es un teléfono`);
  }
});

test('el mensaje que se manda no revela nada nuestro', () => {
  /* Misma regla que el PDF: el mensaje sale hacia el cliente, así que no
     puede llevar costo, margen, tiempo de máquina ni chapas. */
  const coti = cotizarPresupuesto({
    items: [
      { nombre: 'Base', shape: makeShape(rect(0, 0, 300, 200)), materialId: 'acero-sae1010', espesor: 3, cantidad: 40 },
      { nombre: 'Tapa', shape: makeShape(rect(0, 0, 310, 210)), materialId: 'acero-sae1010', espesor: 3, cantidad: 20 },
    ],
  }, CTX);
  const msg = mensajePresupuesto({
    presupuesto: { numero: '2026-0007', cliente: { nombre: 'Metalúrgica del Sur SRL' } },
    cotizacion: coti, config: DEFAULT_CONFIG,
  });
  for (const palabra of ['margen', 'utilidad', 'costo', 'chapa', 'máquina', 'aprovecha']) {
    assert.ok(!msg.toLowerCase().includes(palabra), `el mensaje no puede decir "${palabra}"`);
  }
  const costoFmt = Math.round(coti.items[0].costos.total).toLocaleString('es-AR');
  assert.ok(!msg.includes(costoFmt), 'el costo no puede aparecer en el mensaje');

  // Y sí tiene que llevar lo que el cliente necesita para decidir
  assert.ok(msg.includes('2026-0007'), 'el número del presupuesto');
  assert.ok(msg.includes(Math.round(coti.resumen.total).toLocaleString('es-AR')), 'el total');
  assert.ok(/Metalúrgica/.test(msg), 'el saludo con el nombre del cliente');
});

test('el enlace de WhatsApp avisa cuando no pudo interpretar el teléfono', () => {
  /* Si no se puede armar el número, abrir WhatsApp igual sirve (se elige el
     contacto a mano) pero HAY que decirlo: si no, parece que el sistema eligió
     el contacto solo y el mensaje se manda a cualquiera. */
  const bueno = enlaceWhatsApp({ telefono: '0380 15 4123456', mensaje: 'hola' });
  assert.equal(bueno.telefono, '5493804123456');
  assert.equal(bueno.aviso, null);
  assert.ok(bueno.url.startsWith('https://wa.me/5493804123456?text='));

  const malo = enlaceWhatsApp({ telefono: 'no es un tel', mensaje: 'hola' });
  assert.equal(malo.telefono, null);
  assert.ok(malo.aviso, 'un teléfono ilegible tiene que avisar');
  assert.ok(malo.url.startsWith('https://wa.me/?text='), 'y aun así abrir WhatsApp con el mensaje');

  // El mensaje viaja escapado: un & o un # crudo cortarían la URL
  const raro = enlaceWhatsApp({ telefono: '3804123456', mensaje: 'Chapa #4 & plegado 90°' });
  assert.ok(!raro.url.includes('#') && !raro.url.includes(' '), 'el mensaje tiene que ir escapado');
  assert.equal(decodeURIComponent(raro.url.split('text=')[1]), 'Chapa #4 & plegado 90°');
});

/* ================================================================== */
grupo('Lista de compra de material');

test('las chapas a comprar coinciden con las que se van a cortar', () => {
  /* Si la lista de compra dice un número y el nesting otro, se para la
     máquina a mitad del trabajo. Los grupos compartidos se cuentan una sola
     vez, igual que en `cotizarPresupuesto()`. */
  const coti = cotizarPresupuesto({
    items: [
      { nombre: 'Base', shape: makeShape(rect(0, 0, 300, 200), [circle(30, 30, 6)]), materialId: 'acero-sae1010', espesor: 3, cantidad: 40 },
      { nombre: 'Tapa', shape: makeShape(rect(0, 0, 310, 210)), materialId: 'acero-sae1010', espesor: 3, cantidad: 20 },
      { nombre: 'Frente', shape: makeShape(rect(0, 0, 500, 400)), materialId: 'inox-304', espesor: 1.5, cantidad: 12 },
    ],
  }, CTX);
  const lista = listaDeCompra(coti, CTX);

  const suma = lista.lineas.reduce((a, l) => a + l.chapas, 0);
  assert.equal(suma, coti.resumen.chapasTotal,
    `la lista pide ${suma} chapas y el presupuesto cotiza ${coti.resumen.chapasTotal}`);

  // Base y Tapa comparten material, espesor y chapa: van en una sola línea
  assert.equal(lista.lineas.length, 2, 'dos materiales distintos, dos líneas de compra');
  const linea = lista.lineas.find((l) => l.espesor === 3);
  assert.equal(linea.items.length, 2, 'los dos ítems de 3 mm van en la misma compra');
});

test('la lista sólo pide chapas enteras y el costo cierra', () => {
  const coti = cotizarPresupuesto({
    items: [{ nombre: 'Chica', shape: makeShape(rect(0, 0, 100, 80)), materialId: 'acero-sae1010', espesor: 2, cantidad: 3 }],
  }, CTX);
  const lista = listaDeCompra(coti, CTX);
  const l = lista.lineas[0];
  assert.equal(l.chapas, Math.round(l.chapas), 'el proveedor no vende media chapa');
  assert.ok(l.chapas >= 1, 'aunque el trabajo sea chico hay que comprar una chapa');
  cerca(l.costoTotal, l.pesoChapa * l.precioKg * l.chapas, 0.01, 'el costo es peso × precio × chapas');
  cerca(lista.total, lista.lineas.reduce((a, x) => a + x.costoTotal, 0), 0.01);

  // Tres piezas chicas en una chapa entera: el retazo tiene que ser enorme
  assert.ok(l.retazoM2 > 2, `un trabajo chico deja retazo grande, dio ${l.retazoM2.toFixed(2)} m²`);
  /* Y para un trabajo así el consejo NO puede ser "comprá una chapa nueva":
     sale del retazero, que es exactamente por lo que el cotizador lo cobra
     por área consumida y no por chapa entera. */
  assert.ok(l.desdeRetazo, 'tres piezas chicas salen de un retazo');
  assert.ok(lista.avisos.some((a) => /retazero/.test(a.msg)), 'y el aviso tiene que mandarlo al retazero');
  assert.ok(l.costoConsumido < l.costoTotal / 10, 'consume una fracción mínima de la chapa');
});

test('la relación material/venta se mide contra lo consumido, no contra la chapa entera', () => {
  /* Medirlo contra la chapa entera daba 2.685 % en una pieza suelta. Un
     número así no lo mira nadie dos veces, y el dato que tiene que dar es si
     el anticipo alcanza para comprar el material. */
  const coti = cotizarPresupuesto({
    items: [{ nombre: 'Suelta', shape: makeShape(rect(0, 0, 200, 150)), materialId: 'acero-sae1010', espesor: 2, cantidad: 1 }],
  }, CTX);
  const lista = listaDeCompra(coti, CTX);
  assert.ok(lista.sobreVenta < 1.5, `dio ${(lista.sobreVenta * 100).toFixed(0)} %, sigue midiendo la chapa entera`);
  assert.ok(lista.consumido < lista.total, 'lo consumido tiene que ser menos que la chapa entera');
});

test('avisa cuando comprar el material se come la venta', () => {
  /* Es el dato que decide si el anticipo alcanza para comprar: con la compra
     al 80 % de la venta, un anticipo del 50 % no cubre la chapa. */
  const coti = cotizarPresupuesto({
    items: [{ nombre: 'Placa gruesa', shape: makeShape(rect(0, 0, 200, 150)), materialId: 'acero-sae1010', espesor: 12, cantidad: 2 }],
  }, CTX);
  const lista = listaDeCompra(coti, CTX);
  assert.ok(lista.sobreVenta > 0, 'tiene que informar la relación compra/venta');
  assert.ok(Number.isFinite(lista.pesoTotal) && lista.pesoTotal > 0);
});

/* ================================================================== */
grupo('Trazabilidad del precio');

test('la explicación cubre todos los costos que se cobran', () => {
  /* Si un costo se cobra pero no aparece en la explicación, el precio tiene
     una parte que no se puede defender ni auditar. La suma de los bloques
     tiene que dar exactamente el costo total. */
  const item = {
    nombre: 'Ménsula',
    shape: makeShape(rect(0, 0, 300, 200, 8), [circle(40, 40, 6), circle(260, 160, 6)]),
    materialId: 'inox-304', espesor: 2, cantidad: 25,
    plegado: { pliegues: 2, largoPliegue: 200, angulo: 90 },
    acabadoId: 'pulido',
    ingenieriaHoras: 1.5,
  };
  const r = cotizarItem(item, CTX);
  const exp = explicarItem(r, CTX);
  const suma = exp.bloques.filter((b) => b.importe > 0).reduce((a, b) => a + b.importe, 0);
  cerca(suma, r.costos.total, r.costos.total * 1e-9, 'los bloques tienen que sumar el costo total');

  // Y la cadena tiene que terminar en el precio que efectivamente se cobra
  const final = exp.cadena[exp.cadena.length - 1];
  cerca(final.valor, r.precio.neto, 0.01, 'la cadena tiene que cerrar en el neto');
  assert.ok(exp.resumen.participacion[0].pct >= exp.resumen.participacion.at(-1).pct,
    'la participación tiene que venir ordenada de mayor a menor');
});

test('la explicación no inventa números: sale toda del resultado ya cotizado', () => {
  // Se cotiza dos veces con parámetros distintos y la explicación tiene que
  // seguir a la cotización, no a un cálculo propio que se desincronice.
  for (const margen of [20, 45, 80]) {
    const r = cotizarItem({
      nombre: 'Placa', shape: makeShape(rect(0, 0, 200, 150)),
      materialId: 'acero-sae1010', espesor: 2, cantidad: 10, margen,
    }, CTX);
    const exp = explicarItem(r, CTX);
    const linea = exp.cadena.find((c) => c.etiqueta.startsWith('Margen'));
    assert.ok(linea.etiqueta.includes(String(margen)), `el margen ${margen} tiene que figurar tal cual`);
    cerca(linea.valor, r.precio.lista, 0.01);
  }
});

test('el texto exportable esconde el margen salvo que se lo pida explícitamente', () => {
  /* Es el mismo criterio que el PDF: la cuenta abierta es una herramienta de
     mostrador, no algo que salga hacia el cliente con la ganancia adentro. */
  const r = cotizarItem({
    nombre: 'Placa', shape: makeShape(rect(0, 0, 200, 150)),
    materialId: 'acero-sae1010', espesor: 2, cantidad: 10,
  }, CTX);
  const exp = explicarItem(r, CTX);
  const publico = explicacionEnTexto(exp, { incluirInterno: false });
  const interno = explicacionEnTexto(exp, { incluirInterno: true });
  assert.ok(!/Margen/i.test(publico), 'el texto público no puede nombrar el margen');
  assert.ok(/Margen/i.test(interno), 'el interno sí');
  assert.ok(publico.includes('Precio final'), 'el público igual muestra el precio');
});

/* ================================================================== */
grupo("Tarifario");

const {
  generarTarifario, evaluarTarifaPlana, techoDeTarifa, rangoRecomendado,
  sensibilidadChapa, sensibilidadAprovechamiento, BANDAS, BASES,
} = await import('../src/core/tarifario.js');

test('la explicación de la tarifa usa la base pedida', () => {
  const tar = generarTarifario(CTX, { materialId: 'acero-sae1010', cotizarItem });
  const fila = tar.filas.find((f) => !f.error);
  for (const [base, unidad, campo] of [['m2', 'm²', 'precioM2'], ['kg', 'kg', 'precioKg'], ['metro', 'm de corte', 'precioMetro']]) {
    const e = explicarTarifa(fila.bandas.simple, { base, espesor: fila.espesor, banda: 'simple', margen: tar.margen });
    assert.ok(e.titulo.includes(unidad), `${base}: el título tiene que decir "${unidad}"`);
    cerca(e.importe, fila.bandas.simple[campo], 0.01, `${base}: el importe tiene que ser el de esa base`);
    assert.ok(e.pasos.length >= 3, `${base}: la explicación quedó demasiado corta`);
  }
});


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

test('calcula las tres bases y son coherentes entre sí', () => {
  const t = generarTarifario(CTX, { materialId: 'acero-sae1010', cotizarItem });
  const f = t.filas.find((x) => x.espesor === 2 && !x.error);
  const d = f.bandas.simple;
  // costoM2 = costoKg × kg/m²  (la misma plata mirada de dos maneras)
  cerca(d.costoM2, d.costoKg * f.kgPorM2, d.costoM2 * 0.01,
    'el costo por m² y por kg tienen que ser el mismo número en otra unidad');
  // costoMetro × metros por m² = costoM2
  cerca(d.costoMetro * d.metrosCorteM2, d.costoM2, d.costoM2 * 0.08,
    'el costo por metro de corte tiene que cerrar con el costo por m²');
  for (const c of ['precioM2', 'precioKg', 'precioMetro', 'minimoM2', 'minimoKg', 'minimoMetro']) {
    assert.ok(d[c] > 0, `falta ${c}`);
  }
});

test('el precio siempre está por encima del piso', () => {
  const t = generarTarifario(CTX, { materialId: 'acero-sae1010', cotizarItem, margen: 45 });
  for (const f of t.filas.filter((x) => !x.error)) {
    for (const b of BANDAS) {
      const d = f.bandas[b.id];
      assert.ok(d.precioKg > d.minimoKg, `${f.espesor} mm ${b.id}: el precio no puede estar por debajo del piso`);
      assert.ok(d.precioM2 > d.minimoM2);
    }
  }
});

test('cobrar por kilo es estable con el espesor y por m² no', () => {
  const t = generarTarifario(CTX, { materialId: 'acero-sae1010', cotizarItem });
  const rKg = rangoRecomendado(t, 'kg', 'simple');
  const rM2 = rangoRecomendado(t, 'm2', 'simple');
  assert.ok(rKg.dispersion < 1.5,
    `el $/kg debería variar poco entre espesores, varió ${rKg.dispersion.toFixed(2)}×`);
  assert.ok(rM2.dispersion > 5,
    `el $/m² tiene que variar mucho entre espesores, varió ${rM2.dispersion.toFixed(2)}×`);
  assert.ok(rM2.dispersion > rKg.dispersion * 4,
    'la diferencia entre las dos bases es el hallazgo: una tarifa plana por kg es mucho más sostenible');
});

test('el kilo entregado cuesta más que el kilo comprado, por el recorte', () => {
  const t = generarTarifario(CTX, { materialId: 'acero-sae1010', cotizarItem });
  const d = t.filas.find((f) => f.espesor === 2 && !f.error).bandas.simple;
  assert.ok(d.materialKg > t.material.precioKg,
    `el material por kg entregado (${d.materialKg.toFixed(0)}) tiene que superar al de compra (${t.material.precioKg})`);
  // Y la diferencia tiene que explicarse por el aprovechamiento
  cerca(d.materialKg * (d.aprovechamiento ?? 1), t.material.precioKg, t.material.precioKg * 0.25,
    'la diferencia entre kilo comprado y kilo entregado es el aprovechamiento');
});

test('detecta una tarifa por kilo que no cubre el costo', () => {
  const t = generarTarifario(CTX, { materialId: 'acero-sae1010', cotizarItem });
  const barata = evaluarTarifaPlana(t, 3800, 'kg');
  assert.equal(barata.veredicto, 'todo-perdida',
    'con la chapa a 2.950 el kilo, cobrar 3.800 no cubre ni el material con su recorte');
  assert.equal(barata.casosEnPerdida, barata.casos);

  // A $12.000 el kilo ya cierra casi todo, pero todavía no la chapa perforada
  // gruesa: un kilo de rejilla de 20 mm lleva muchísimo corte por kilo.
  const casi = evaluarTarifaPlana(t, 12000, 'kg');
  assert.equal(casi.veredicto, 'parcial');
  assert.ok(casi.casosEnPerdida > 0 && casi.casosEnPerdida < casi.casos / 4);

  const sana = evaluarTarifaPlana(t, 20000, 'kg');
  assert.equal(sana.veredicto, 'sana');
  assert.equal(sana.casosEnPerdida, 0);
});

test('la sensibilidad al precio de la chapa va en el sentido correcto', () => {
  const t = generarTarifario(CTX, { materialId: 'acero-sae1010', cotizarItem });
  const s = sensibilidadChapa(t, 3800, 'kg', 'simple');
  assert.ok(s.length >= 4);
  for (let i = 1; i < s.length; i++) {
    assert.ok(s[i].precioChapa > s[i - 1].precioChapa, 'la tabla va de más barato a más caro');
    assert.ok(s[i].utilidadPct < s[i - 1].utilidadPct, 'si la chapa sube, la utilidad baja');
  }
  assert.ok(s.some((x) => x.esActual), 'tiene que marcar el precio que está cargado hoy');
});

test('la sensibilidad al aprovechamiento va en el sentido correcto', () => {
  const t = generarTarifario(CTX, { materialId: 'acero-sae1010', cotizarItem });
  const s = sensibilidadAprovechamiento(t, 3800, 'kg', 'simple');
  assert.ok(s.length >= 4);
  for (let i = 1; i < s.length; i++) {
    assert.ok(s[i].aprovechamiento > s[i - 1].aprovechamiento);
    assert.ok(s[i].utilidadPct > s[i - 1].utilidadPct,
      'aprovechar mejor la chapa tiene que mejorar la utilidad');
    assert.ok(s[i].material < s[i - 1].material, 'y bajar el material por unidad entregada');
  }
});

test('el techo de la tarifa funciona en las tres bases', () => {
  const t = generarTarifario(CTX, { materialId: 'acero-sae1010', cotizarItem });
  // Por m²: con 90.000 hay techo en chapa fina
  assert.ok(techoDeTarifa(t, 90000, 'simple', 30, 'm2') != null);
  // Por kg: con 3.800 no hay techo en ningún espesor
  assert.equal(techoDeTarifa(t, 3800, 'simple', 30, 'kg'), null,
    'una tarifa que no cubre el costo no puede tener techo');
  // Con un valor sano sí
  assert.ok(techoDeTarifa(t, 12000, 'simple', 30, 'kg') != null);
});

test('sin material el precio por kg baja', () => {
  const con = generarTarifario(CTX, { materialId: 'acero-sae1010', cotizarItem, conMaterial: true });
  const sin = generarTarifario(CTX, { materialId: 'acero-sae1010', cotizarItem, conMaterial: false });
  const dc = con.filas.find((f) => f.espesor === 2).bandas.media;
  const ds = sin.filas.find((f) => f.espesor === 2).bandas.media;
  assert.ok(ds.precioKg < dc.precioKg * 0.5,
    'si el cliente trae la chapa, el precio por kilo tiene que bajar muchísimo: el material es casi todo');
});

test('el tarifario no inventa espesores que la máquina no corta', () => {
  const t = generarTarifario(CTX, { materialId: 'inox-304', cotizarItem, espesores: [3, 12, 20] });
  const f20 = t.filas.find((x) => x.espesor === 20);
  assert.ok(f20.error, 'inox de 20 mm a 3 kW tiene que dar error, no precio');
  const f3 = t.filas.find((x) => x.espesor === 3);
  assert.ok(!f3.error && f3.bandas.media.precioM2 > 0);
});

/* ================================================================== */
/* ================================================================== */
grupo('Agenda de producción');

test('la capacidad diaria sale de horas abiertas por ocupación productiva', () => {
  const cfg = { estructura: { horasPorDia: 8, ocupacionProductiva: 62.5 } };
  cerca(capacidadDiariaSegundos(cfg), 5 * 3600, 1e-9);
});

test('los estados cerrados no cargan la máquina y corte queda como trabajo parcial', () => {
  assert.equal(segundosRestantesOrden({ estado: 'entregado', resumen: { tiempoProduccion: 3600 } }), 0);
  cerca(segundosRestantesOrden({ estado: 'corte', resumen: { tiempoProduccion: 3600 } }), 1980, 1e-9);
});

test('la agenda ordena urgentes primero y no promete sábados', () => {
  const cfg = { estructura: { horasPorDia: 8, ocupacionProductiva: 100 } };
  const plan = agendaProduccion([
    { id: 'normal', numero: 'OT-2', estado: 'pendiente', creado: '2026-08-01', resumen: { tiempoProduccion: 8 * 3600 } },
    { id: 'urgente', numero: 'OT-1', estado: 'pendiente', prioridad: 'urgente', creado: '2026-08-02', resumen: { tiempoProduccion: 8 * 3600 } },
  ], cfg, new Date('2026-08-14T12:00:00Z')); // viernes
  assert.equal(plan.ordenes[0].id, 'urgente');
  assert.equal(plan.ordenes[0].fechaPrometible, '2026-08-14');
  assert.equal(plan.ordenes[1].fechaPrometible, '2026-08-17', 'el segundo día hábil después del viernes es lunes');
});

test('marca atraso cuando la fecha comprometida no entra en la carga real', () => {
  const cfg = { estructura: { horasPorDia: 4, ocupacionProductiva: 50 } }; // 2 h productivas/día
  const plan = agendaProduccion([
    { id: 'a', numero: 'OT-1', estado: 'pendiente', fechaEntrega: '2026-08-14', resumen: { tiempoProduccion: 3 * 3600 } },
  ], cfg, new Date('2026-08-14T12:00:00Z'));
  assert.equal(plan.fechaDisponible, '2026-08-17');
  assert.equal(plan.ordenes[0].atrasada, true);
  assert.equal(plan.atrasadas, 1);
});

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

test('el presupuesto del cliente no revela costo, margen ni tiempo de máquina', () => {
  /* Es una regla de negocio, no cosmética. Si el PDF muestra "18m 2s de
     máquina" al lado de un precio de seis cifras, la conversación pasa a ser
     el precio por minuto de máquina en vez del trabajo entregado — y de paso
     le revela al cliente el rendimiento de nuestro anidado.

     Este test corre sobre el TEXTO REAL del PDF, no sobre el código: es la
     única forma de que no se filtre por una línea agregada más adelante. */
  const coti = cotizarPresupuesto({
    items: [{ nombre: 'Placa', shape: makeShape(rect(0, 0, 300, 200), [circle(30, 30, 6)]),
      materialId: 'acero-sae1010', espesor: 3, cantidad: 40 }],
  }, CTX);
  const bytes = generarPresupuestoPDF({
    presupuesto: { numero: '2026-0002', cliente: { nombre: 'Cliente' } },
    cotizacion: coti,
    config: DEFAULT_CONFIG,
  });
  const txt = textoDelPDF(bytes);

  for (const palabra of ['margen', 'utilidad', 'ganancia', 'costo total', 'chapas a consumir', 'tiempo de m']) {
    assert.ok(!txt.toLowerCase().includes(palabra), `el presupuesto del cliente no puede decir "${palabra}"`);
  }
  // Y el número del costo tampoco puede aparecer escrito en ningún lado
  const costoFmt = Math.round(coti.items[0].costos.total).toLocaleString('es-AR');
  assert.ok(!txt.includes(costoFmt), `el costo (${costoFmt}) aparece impreso en el presupuesto`);

  // Lo que SÍ tiene que estar: qué recibe y cuánto paga
  assert.ok(txt.includes('TOTAL'), 'el presupuesto tiene que mostrar el total');
  assert.ok(/Peso total/i.test(txt), 'el peso sirve para el flete y sí va');
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

test('las etiquetas de pieza imprimen datos de taller por ítem', () => {
  const coti = cotizarPresupuesto({
    items: [
      { nombre: 'Soporte A', shape: makeShape(rect(0, 0, 200, 120)), materialId: 'acero-sae1010', espesor: 3, cantidad: 12 },
      { nombre: 'Tapa B', shape: makeShape(rect(0, 0, 100, 80)), materialId: 'inox-304', espesor: 1.5, cantidad: 4 },
    ],
  }, CTX);
  const bytes = generarEtiquetasPiezasPDF({
    orden: { numero: '2026-0042', cliente: { nombre: 'Cliente de prueba' } },
    cotizacion: coti,
    config: DEFAULT_CONFIG,
    baseUrl: 'https://kort.local',
  });
  assert.ok(bytes.length > 2000, `PDF de etiquetas demasiado chico: ${bytes.length} bytes`);
  const txt = textoDelPDF(bytes);
  assert.ok(txt.includes('OT 2026-0042'));
  assert.ok(txt.includes('Soporte A'));
  assert.ok(txt.includes('Cliente de prueba'));
  assert.ok(txt.includes('Cantidad'));
  assert.ok(Buffer.from(bytes).toString('latin1').includes('%%EOF'));
});

/* ================================================================== */
grupo('Base de datos (SQLite)');

const { DB, fusionarMateriales, fusionarMaquinas, fusionarConfig, fusionarProfundo } = await import('../src/server/db.js');
const dirTmp = path.join(__dirname, '.tmp-db');
fs.rmSync(dirTmp, { recursive: true, force: true });
let dbt = null;

test('crea el esquema y siembra los datos de fábrica', () => {
  dbt = new DB(dirTmp);
  assert.ok(dbt.version >= 3, `versión de esquema inesperada: ${dbt.version}`);
  assert.equal(dbt.leerCrudo('materiales').length, DEFAULT_MATERIALS.length);
  assert.deepEqual(dbt.leerCrudo('retazos'), [], 'el retazero nuevo empieza vacio');
  assert.ok(dbt.leerCrudo('config').estructura, 'la config debe traer la estructura');
  assert.ok(
    dbt.db.all('PRAGMA table_info(bitacora)').some((c) => c.name === 'operario'),
    'la bitácora debe tener firma de operario'
  );
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

test('la bitácora firma los cambios con el operario actual', () => {
  const c = dbt.crear('clientes', { nombre: 'Corte Norte' }, 'Santiago');
  assert.equal(dbt.bitacora(1)[0].operario, 'Santiago');
  dbt.actualizar('clientes', c.id, { telefono: '3804-222222' }, 'Mariela');
  assert.equal(dbt.bitacora(1)[0].operario, 'Mariela');
  dbt.borrar('clientes', c.id, 'Taller');
  assert.equal(dbt.bitacora(1)[0].operario, 'Taller');
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
  assert.deepEqual(backup.retazos, [], 'el respaldo debe incluir el retazero');
});

test('guardar una parte de la config no borra el resto', () => {
  // Regresión: el PUT reemplazaba el documento entero. Mandar sólo
  // {comercial:{margen:50}} borraba empresa, producción y estructura, y el
  // sistema seguía andando con los valores de fábrica sin avisar nada.
  const completa = dbt.leerCrudo('config');
  assert.ok(completa.empresa && completa.produccion && completa.estructura);

  const parcial = fusionarProfundo(completa, { comercial: { margen: 50 } });
  assert.equal(parcial.comercial.margen, 50, 'tiene que aplicar el cambio');
  assert.ok(parcial.empresa, 'no puede perder la empresa');
  assert.ok(parcial.produccion, 'no puede perder producción');
  assert.ok(parcial.estructura, 'no puede perder la estructura de costos');
  assert.equal(
    Object.keys(parcial.comercial).length,
    Object.keys(completa.comercial).length,
    'las demás claves de comercial tienen que seguir ahí'
  );
});

test('las listas se reemplazan enteras, no se mezclan', () => {
  // Si el usuario borra un acabado, tiene que desaparecer: fusionar elemento
  // por elemento lo dejaría resucitado.
  const base = { acabados: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };
  const r = fusionarProfundo(base, { acabados: [{ id: 'a' }] });
  assert.equal(r.acabados.length, 1);
  assert.equal(r.acabados[0].id, 'a');
});

test('la fusión respeta valores nulos y falsos', () => {
  const r = fusionarProfundo(
    { comercial: { mostrarIVA: true, aplicarIIBB: true, redondeo: 500 } },
    { comercial: { mostrarIVA: false, aplicarIIBB: null } }
  );
  assert.equal(r.comercial.mostrarIVA, false, 'false es un valor, no un "sin dato"');
  assert.equal(r.comercial.aplicarIIBB, null);
  assert.equal(r.comercial.redondeo, 500, 'lo que no vino no se toca');
});

test('un perfil de plegado se guarda y se recupera entero', () => {
  const perfil = {
    tramos: [25, 40, 60, 40, 25],
    angulos: [
      { grados: 90, sentido: 'arriba' }, { grados: 90, sentido: 'abajo' },
      { grados: 90, sentido: 'abajo' }, { grados: 90, sentido: 'arriba' },
    ],
    ancho: 500, espesor: 2, materialId: 'acero-sae1010', matrizV: 0,
  };
  const p = dbt.crear('piezas', { nombre: 'Omega 25-40-60 · 2 mm', origen: 'plegado', perfil });
  const leida = dbt.obtener('piezas', p.id);
  assert.equal(leida.nombre, 'Omega 25-40-60 · 2 mm', 'el punto medio y los acentos tienen que sobrevivir');
  assert.deepEqual(leida.perfil.tramos, perfil.tramos);
  assert.equal(leida.perfil.angulos.length, 4);
  assert.equal(leida.perfil.angulos[1].sentido, 'abajo', 'el sentido de cada pliegue importa');

  // Y tiene que poder recalcularse tal cual quedó guardado
  const r = calcularPerfil(leida.perfil, acero, DEFAULT_PLEGADORA);
  assert.ok(r.desarrollo > 0);
  assert.equal(r.pliegues.length, 4);

  assert.ok(dbt.lista('piezas').some((x) => x.origen === 'plegado'), 'tiene que aparecer en la lista');
  dbt.borrar('piezas', p.id);
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

/* ================================================================== */
grupo('Reposición de chapa');

test('el requerimiento cuenta una sola vez un nesting compartido', () => {
  const base = {
    material: { id: 'acero', nombre: 'Acero' }, espesor: 2,
    costos: { materialDelCliente: false }, nesting: {
      chapa: { w: 3000, h: 1500 }, compartido: true, grupo: 'g1', chapasGrupo: 2,
    },
  };
  const r = requerimientosDeCotizacion({ items: [base, { ...base }] });
  assert.equal(r.length, 1);
  assert.equal(r[0].chapas, 2, 'dos ítems del mismo programa no duplican sus chapas');
});

test('material del cliente y retazos elegidos no disparan compras', () => {
  const base = {
    material: { id: 'acero', nombre: 'Acero' }, espesor: 2,
    nesting: { chapa: { w: 3000, h: 1500 }, compartido: false, chapas: 1 },
  };
  const r = requerimientosDeCotizacion({ items: [
    { ...base, costos: { materialDelCliente: true } },
    { ...base, costos: { materialDelCliente: false }, retazo: { id: 'r1' } },
  ] });
  assert.equal(r.length, 0);
});

test('la reposición cubre órdenes abiertas más seguridad y descuenta stock libre', () => {
  const materiales = [{ id: 'acero', nombre: 'Acero', chapaStd: { w: 3000, h: 1500 } }];
  const req = { materialId: 'acero', material: 'Acero', espesor: 2, chapa: { w: 3000, h: 1500 }, chapas: 3 };
  const retazos = [{ materialId: 'acero', espesor: 2, w: 3000, h: 1500, cantidad: 5, estado: 'disponible', reservas: [{ cantidad: 1 }] }];
  const ordenes = [
    { estado: 'pendiente', requerimientosChapa: [req], creado: '2026-08-10' },
    { estado: 'entregado', requerimientosChapa: [{ ...req, chapas: 9 }], modificado: '2026-08-01' },
    { estado: 'cancelado', requerimientosChapa: [{ ...req, chapas: 99 }], modificado: '2026-08-01' },
  ];
  const [r] = planReposicion({ retazos, ordenes, materiales, hoy: new Date('2026-08-14T12:00:00Z'), diasHistorial: 90, plazoDias: 10 });
  assert.equal(r.disponibles, 4);
  assert.equal(r.comprometidas, 3);
  assert.equal(r.seguridad, 1, '9 chapas en 90 días requieren una de colchón para 10 días');
  assert.equal(r.comprar, 0);
  assert.equal(r.explicacion, '3 comprometidas + 1 de seguridad - 4 disponibles = 0 a comprar');
});

/* ================================================================== */
grupo('Telemetría de máquina');

test('normaliza el dialecto del adaptador sin aceptar valores imposibles', () => {
  const m = normalizarMuestra({
    maquina_id: 'laser-3kw', estado: 'produciendo', progreso: 130,
    potencia_pct: -4, velocidad_mm_min: 7200, piezas_buenas: 8,
  }, new Date('2026-08-22T12:00:00Z'));
  assert.equal(m.maquinaId, 'laser-3kw');
  assert.equal(m.progreso, 100);
  assert.equal(m.potenciaPct, 0);
  assert.equal(m.velocidadMMMin, 7200);
  assert.equal(m.piezasBuenas, 8);
});

test('la disponibilidad se pondera por tiempo y no inventa OEE', () => {
  const muestras = [
    { fecha: '2026-08-22T12:00:00Z', estado: 'preparando' },
    { fecha: '2026-08-22T12:00:10Z', estado: 'produciendo' },
    { fecha: '2026-08-22T12:00:30Z', estado: 'inactiva' },
  ];
  const r = resumirTelemetria(muestras, new Date('2026-08-22T12:00:40Z'));
  cerca(r.disponibilidad, 0.5, 1e-9, '20 s produciendo sobre 40 s planificados');
  assert.equal(r.oee, null, 'sin ciclo ideal no hay rendimiento ni OEE');
  assert.equal(r.conectada, true);
});

test('una muestra vieja marca la pasarela desconectada', () => {
  const r = resumirTelemetria([{ fecha: '2026-08-22T12:00:00Z', estado: 'produciendo' }], new Date('2026-08-22T12:01:00Z'));
  assert.equal(r.conectada, false);
  assert.equal(r.segundosPorEstado.produciendo, 15, 'el silencio no se cuenta como producción eterna');
});

test('la serie larga se reduce sin perder el último estado', () => {
  const muestras = Array.from({ length: 1000 }, (_, i) => ({
    fecha: new Date(Date.UTC(2026, 7, 22, 12, 0, i)).toISOString(),
    estado: 'produciendo', potenciaPct: i % 100, progreso: i / 10,
  }));
  const serie = serieTelemetria(muestras, 100);
  assert.ok(serie.length <= 100);
  assert.equal(serie.at(-1).fecha, muestras.at(-1).fecha);
});

test('SQLite persiste y recupera las muestras de máquina', () => {
  const m = normalizarMuestra({ maquinaId: 'laser-3kw', fecha: '2026-08-22T12:00:00Z', estado: 'produciendo', programa: 'NEST-42' });
  dbt.registrarTelemetria(m);
  const leidas = dbt.telemetria('laser-3kw', '2026-08-22T11:59:00Z', 10);
  assert.equal(leidas.length, 1);
  assert.equal(leidas[0].programa, 'NEST-42');
  assert.ok(dbt.exportarTodo().telemetria.length >= 1, 'el respaldo incluye una ventana de telemetría');
});

grupo('Producción y clasificación de taller');

const nestingPrueba = {
  items: [{
    nombre: 'Ménsula', cantidad: 2, material: { id: 'acero', nombre: 'Acero' }, espesor: 2,
    corte: { gasTipo: 'O2', tTotal: 80 }, costos: { proceso: 'laser' },
    nesting: { compartido: false, chapa: { w: 1000, h: 500 }, metodo: 'perfil', aprovechamiento: 0.42,
      layout: [{ w: 1000, h: 500, piezas: [{ id: 'p', x: 0, y: 0, w: 100, h: 60 }, { id: 'p', x: 105, y: 0, w: 100, h: 60 }] }] },
    plegado: { nPliegues: 2, largoPliegue: 100, tTotal: 45 }, datosPliegue: { V: 16, fuerzaKNm: 70 },
  }],
};

test('el plan de producción guarda geometría operativa pero no costos ni ganancia', () => {
  const plan = crearPlanProduccion(nestingPrueba, [{ nombre: 'Ménsula', plegado: { angulo: 90 } }]);
  assert.equal(plan.programas.length, 1);
  assert.equal(plan.programas[0].layout[0].piezas.length, 2);
  assert.equal(plan.operaciones[0].plegado.matrizV, 16);
  const texto = JSON.stringify(plan).toLowerCase();
  assert.ok(!texto.includes('costo'));
  assert.ok(!texto.includes('margen'));
  assert.ok(!texto.includes('ganancia'));
});

test('clasificar una pieza es persistente, reversible y genera reposición', () => {
  const planProduccion = crearPlanProduccion(nestingPrueba);
  let orden = { id: 'ot-1', planProduccion };
  orden = aplicarEventoTaller(orden, { tipo: 'clasificar', programaId: 'item:0', chapaIndice: 0, piezaIndice: 1, estado: 'rechazada' }, '2026-08-22T15:00:00Z');
  assert.deepEqual(resumenTaller(orden), { total: 2, retiradas: 0, rechazadas: 1, pendientes: 1, reposiciones: 1 });
  orden = aplicarEventoTaller(orden, { tipo: 'clasificar', programaId: 'item:0', chapaIndice: 0, piezaIndice: 1, estado: 'pendiente' });
  assert.equal(resumenTaller(orden).rechazadas, 0);
});

test('el avance de plegado se limita a la cantidad vendida', () => {
  const orden = aplicarEventoTaller(
    { id: 'ot-2', planProduccion: crearPlanProduccion(nestingPrueba) },
    { tipo: 'avance-plegado', itemIndice: 0, cantidadHecha: 99, primeraPiezaAprobada: true, herramientaConfirmada: true }
  );
  assert.equal(orden.taller.plegado.items[0].cantidadHecha, 2);
  assert.equal(orden.taller.plegado.items[0].primeraPiezaAprobada, true);
});

test('sólo registra como retazo la franja rectangular intacta', () => {
  const programa = crearPlanProduccion(nestingPrueba).programas[0];
  programa.layout[0].alturaOcupada = 120;
  const r = retazoSeguroDePrograma(programa, 0, { w: 1000, h: 500 }, { separacion: 5 });
  assert.equal(r.util, true);
  assert.equal(r.w, 1000);
  assert.equal(r.h, 375);
  assert.equal(r.areaM2, 0.375);
});

test('no acepta una chapa física menor que el nesting vendido', () => {
  const programa = crearPlanProduccion(nestingPrueba).programas[0];
  assert.throws(() => retazoSeguroDePrograma(programa, 0, { w: 900, h: 500 }), /menor/);
});

test('la chapa física se confirma una sola vez y conserva su trazabilidad', () => {
  const planProduccion = crearPlanProduccion(nestingPrueba);
  planProduccion.programas[0].layout[0].alturaOcupada = 120;
  const orden = aplicarEventoTaller({ id: 'ot-3', planProduccion }, {
    tipo: 'confirmar-chapa', programaId: 'item:0', chapaIndice: 0,
    origen: 'chapa-nueva', lote: 'COLADA-88', ubicacion: 'Rack A', guardarRetazo: true,
  }, '2026-08-22T16:00:00Z');
  const fisica = orden.taller.corte.programas['item:0'].chapas[0];
  assert.equal(fisica.lote, 'COLADA-88');
  assert.equal(fisica.retazo.h, 375);
  const repetida = aplicarEventoTaller(orden, {
    tipo: 'confirmar-chapa', programaId: 'item:0', chapaIndice: 0,
    origen: 'chapa-nueva', lote: 'COLADA-88', ubicacion: 'Rack A', guardarRetazo: true,
  });
  assert.equal(repetida.taller.corte.programas['item:0'].chapas[0].lote, 'COLADA-88', 'reintentar la misma confirmación es idempotente');
  assert.throws(() => aplicarEventoTaller(orden, {
    tipo: 'confirmar-chapa', programaId: 'item:0', chapaIndice: 0, origen: 'cliente',
  }), /ya fue confirmada/);
});

test('calidad evalúa tolerancias asimétricas e incluye sus límites', () => {
  assert.equal(evaluarMedicion({ nominal:100, toleranciaMas:0.2, toleranciaMenos:0.5, valor:99.5 }).estado, 'conforme');
  assert.equal(evaluarMedicion({ nominal:100, toleranciaMas:0.2, toleranciaMenos:0.5, valor:100.2 }).estado, 'conforme');
  assert.equal(evaluarMedicion({ nominal:100, toleranciaMas:0.2, toleranciaMenos:0.5, valor:99.49 }).estado, 'fuera');
  assert.throws(() => evaluarMedicion({ nominal:100, toleranciaMas:-1, toleranciaMenos:0.5, valor:100 }), /positivas/);
});

test('un lote sólo se libera con todas las cotas requeridas conformes', () => {
  let orden = { id:'ot-calidad', planProduccion:crearPlanProduccion(nestingPrueba) };
  orden = aplicarEventoCalidad(orden, { tipo:'definir-caracteristica', itemIndice:0, id:'ancho', nombre:'Ancho', nominal:100, toleranciaMas:0.2, toleranciaMenos:0.2 });
  assert.throws(() => aplicarEventoCalidad(orden, { tipo:'liberar-lote', itemIndice:0 }), /Falta medir/);
  orden = aplicarEventoCalidad(orden, { tipo:'registrar-medicion', itemIndice:0, caracteristicaId:'ancho', valor:100.3 });
  assert.throws(() => aplicarEventoCalidad(orden, { tipo:'liberar-lote', itemIndice:0 }), /fuera/);
  orden = aplicarEventoCalidad(orden, { tipo:'registrar-medicion', itemIndice:0, caracteristicaId:'ancho', valor:100.1 });
  orden = aplicarEventoCalidad(orden, { tipo:'liberar-lote', itemIndice:0 }, '2026-08-22T18:00:00Z');
  assert.equal(orden.calidad.items[0].liberacion.estado, 'liberado');
});

test('una no conformidad conserva el origen y alimenta la reposición', () => {
  let orden = { id:'ot-nc', planProduccion:crearPlanProduccion(nestingPrueba) };
  orden = aplicarEventoCalidad(orden, { tipo:'abrir-no-conformidad', id:'nc-1', itemIndice:0,
    programaId:'item:0', chapaIndice:0, piezaIndice:1, causa:'rebaba', accion:'recortar', cantidad:2, detalle:'Canto inferior' });
  assert.equal(orden.calidad.noConformidades['nc-1'].piezaIndice, 1);
  assert.equal(resumenCalidad(orden).reposiciones, 2);
  orden = aplicarEventoCalidad(orden, { tipo:'cerrar-no-conformidad', id:'nc-1', resolucion:'Recortadas y controladas' });
  assert.equal(resumenCalidad(orden).reposiciones, 0);
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
