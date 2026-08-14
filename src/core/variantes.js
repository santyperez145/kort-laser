/**
 * Medidas normalizadas: el catálogo de todos los días.
 *
 * Las piezas de `library.js` son familias con parámetros: una brida sirve para
 * cualquier diámetro. Eso está bien para diseñar, pero en el mostrador nadie
 * piensa en parámetros — piensa en **"una brida DN100"** o **"una abrazadera
 * para caño de 2 pulgadas"**.
 *
 * Acá viven esas medidas, tomadas de normas y de lo que realmente se vende en
 * Argentina. Cada entrada es una pieza lista para cotizar, con su nombre de
 * catálogo y sus cotas cargadas.
 *
 * ## Por qué no son 300 `build()` escritos a mano
 *
 * Porque serían 300 formas de equivocarse. Una familia parametrizada se prueba
 * una vez y anda para todas sus medidas; trescientas funciones sueltas hay que
 * probarlas de a una, y las que nadie usa se pudren en silencio hasta que
 * alguien las elige y salen mal. Un catálogo grande hecho de familias chicas y
 * verificadas es más grande **y** más confiable que uno hecho de piezas
 * sueltas.
 *
 * Cada tabla dice de dónde salió. Las que son estimaciones lo dicen.
 */

import { PIEZAS, getPieza, paramsPorDefecto } from './library.js';
import { MOTIVOS } from './decorativo.js';

/* ── Tablas de medidas ──────────────────────────────────────────────────── */

/**
 * 🟢 Bridas planas DIN 2576 / EN 1092-1 tipo 01, PN10.
 * Diámetro exterior, círculo de pernos, cantidad y diámetro de bulón.
 * Es la norma que usa la industria alimenticia y de agua en Argentina.
 */
const BRIDAS_DIN2576 = [
  ['DN15', 95, 65, 4, 14, 21.3],
  ['DN20', 105, 75, 4, 14, 26.9],
  ['DN25', 115, 85, 4, 14, 33.7],
  ['DN32', 140, 100, 4, 18, 42.4],
  ['DN40', 150, 110, 4, 18, 48.3],
  ['DN50', 165, 125, 4, 18, 60.3],
  ['DN65', 185, 145, 8, 18, 76.1],
  ['DN80', 200, 160, 8, 18, 88.9],
  ['DN100', 220, 180, 8, 18, 114.3],
  ['DN125', 250, 210, 8, 18, 139.7],
  ['DN150', 285, 240, 8, 22, 168.3],
  ['DN200', 340, 295, 8, 22, 219.1],
  ['DN250', 395, 350, 12, 22, 273.0],
  ['DN300', 445, 400, 12, 22, 323.9],
];

/**
 * 🟢 Caños de acero, diámetro exterior real por medida nominal en pulgadas.
 * Norma ASTM A53 / IRAM. Es lo que hay que medir para una abrazadera: el
 * nominal NO es el diámetro.
 */
const CANOS_PULGADA = [
  ['1/2"', 21.3], ['3/4"', 26.7], ['1"', 33.4], ['1 1/4"', 42.2],
  ['1 1/2"', 48.3], ['2"', 60.3], ['2 1/2"', 73.0], ['3"', 88.9],
  ['4"', 114.3], ['5"', 141.3], ['6"', 168.3],
];

/** 🟢 Anchos normalizados de bandeja portacables (IEC 61537 y uso local). */
const BANDEJAS = [50, 100, 150, 200, 300, 400, 450, 600];

/** 🟢 Alturas de panel de rack 19″: 1U = 44,45 mm. Ancho de frente 482,6 mm. */
const RACK_U = [1, 2, 3, 4, 6, 8];

/**
 * 🟡 Perfiles plegados de uso corriente en obra. Las medidas son las que se
 * piden habitualmente; el espesor lo define quien cotiza.
 */
const ANGULOS = [
  [25, 25], [30, 30], [38, 38], [40, 40], [50, 50],
  [60, 60], [75, 50], [80, 40], [100, 50], [100, 100],
];

const CANALES_U = [
  [40, 20], [50, 25], [60, 30], [80, 40], [100, 50], [120, 50], [150, 50], [200, 60],
];

/** 🟡 Discos y arandelas de taller. */
const DISCOS = [50, 60, 80, 100, 120, 150, 180, 200, 250, 300, 400, 500];

/** 🟡 Tapas de caja de luz y registro, medidas argentinas de uso corriente. */
const TAPAS = [
  ['5×5', 50, 50], ['10×5', 100, 50], ['10×10', 100, 100],
  ['15×15', 150, 150], ['20×20', 200, 200], ['30×20', 300, 200],
  ['30×30', 300, 300], ['40×40', 400, 400],
];

/** 🟡 Parantes de estantería: alturas que se piden y entran en la plegadora. */
const PARANTES = [1000, 1500, 1800, 2000, 2400, 3000];

/** 🟡 Estantes: combinaciones de ancho y fondo que se venden armadas. */
const ESTANTES = [
  [600, 300], [600, 400], [900, 300], [900, 400], [900, 500],
  [1200, 400], [1200, 500], [1500, 400], [1500, 500],
];

/** 🟡 Ménsulas de pared, por largo de brazo. */
const MENSULAS = [150, 200, 250, 300, 350, 400, 500];

/** 🟡 Peldaños de escalera de servicio, por ancho. */
const PELDANOS = [600, 700, 800, 900, 1000, 1200];

/** 🟡 Paneles decorativos: la medida de hoja completa y las dos mitades. */
const PANELES = [
  ['hoja entera', 1200, 2400], ['media hoja', 1200, 1200],
  ['tira', 600, 2400], ['puerta', 900, 2000],
];

/** Pletinas: medidas de planchuela que se cortan todo el tiempo. */
const PLETINAS = [
  [200, 25], [200, 38], [300, 25], [300, 38], [300, 50],
  [400, 38], [400, 50], [500, 50], [600, 50], [600, 75], [800, 75], [1000, 100],
];

/** Rejillas de ventilacion, medidas de tablero y de mueble. */
const REJILLAS = [
  [100, 100], [150, 150], [200, 100], [200, 200], [300, 150],
  [300, 300], [400, 200], [500, 300],
];

/** Cartelas de refuerzo, por cateto. */
const CARTELAS = [80, 100, 120, 150, 200, 250, 300];

/** Placas base de columna, por lado. */
const PLACAS_BASE = [150, 200, 250, 300, 350, 400, 500];

/** Escuadras de union, por ala. */
const ESCUADRAS = [[40, 40], [50, 50], [60, 60], [80, 80], [100, 100], [120, 80]];

/** Largueros de rack, por luz entre parantes. */
const LARGUEROS = [900, 1200, 1500, 1800, 2100, 2400, 2700];

/** Anillos y refuerzos circulares. */
const ANILLOS = [[100, 60], [150, 90], [200, 120], [250, 150], [300, 200], [400, 280], [500, 350]];

/** Reducciones de conducto: las medidas de ventilacion que mas se piden. */
const CONOS = [[300, 200], [400, 250], [400, 300], [500, 300], [500, 400], [600, 400], [800, 500]];

/** Virolas: diametro y alto de uso corriente en tanques y silos. */
const VIROLAS = [[300, 500], [400, 500], [500, 600], [600, 800], [800, 1000], [1000, 1200]];

/** Codos segmentados para conducto. */
const CODOS = [200, 250, 300, 400, 500, 600];

/** Bandejas y cajas: medidas de uso corriente. */
const CAJAS = [
  [200, 150, 50], [300, 200, 60], [400, 300, 80], [500, 400, 100],
  [600, 400, 100], [800, 600, 150],
];

/** Perfiles Z y sombrero, por alma. */
const PERFILES_Z = [60, 80, 100, 120, 150, 200];
const SOMBREROS = [40, 50, 60, 80, 100];

/** Poligonos de tapa y decorativos. */
const POLIGONOS = [
  ['Hexagono', 6, 50], ['Hexagono', 6, 80], ['Hexagono', 6, 120], ['Hexagono', 6, 200],
  ['Octogono', 8, 80], ['Octogono', 8, 150], ['Octogono', 8, 250],
  ['Estrella', 5, 100], ['Estrella', 5, 200],
];

/** Pinones para cadena: dientes que se piden en transportadores. */
/* Desde 11 dientes: con menos, el cubo y el chavetero se comen el disco y la
   pieza no existe. Es un limite geometrico real, no una medida que falte. */
const PINONES = [13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 24, 25, 30, 38, 45, 57, 76];

/* -- Armado del catalogo -- */

const v = (piezaId, nombre, params, extra = {}) => ({
  piezaId,
  nombre,
  params,
  ...extra,
});

/**
 * Todas las variantes normalizadas.
 *
 * Se arman a partir de las tablas de arriba, así que agregar una medida es
 * agregar una fila y no escribir una pieza nueva.
 */
export function generarVariantes() {
  const out = [];

  for (const [dn, ext, bcd, n, dia, cano] of BRIDAS_DIN2576) {
    /* La brida cuadrada se define por el lado y por el margen del perno al
       borde, no por un circulo de pernos: con el BCD de la norma y el lado
       exterior, el margen sale de la diferencia. */
    out.push(
      v('brida-cuadrada', `Brida ${dn} · DIN 2576`, {
        lado: ext, diaInt: cano + 2, diaAgujero: dia,
        margen: Math.max(dia, Math.round((ext - bcd) / 2)),
        ochoPernos: n >= 8, r: Math.round(ext * 0.08),
      }, { norma: 'DIN 2576 / EN 1092-1 PN10', grupo: 'Bridas' })
    );
    // Y la version redonda, que es la que pide la industria alimenticia
    out.push(
      v('disco', `Brida circular ${dn} · DIN 2576`, {
        dia: ext, diaInt: cano + 2, bcd, nAgujeros: n, diaAgujero: dia, fase: 360 / (2 * n),
      }, { norma: 'DIN 2576 / EN 1092-1 PN10', grupo: 'Bridas' })
    );
  }

  for (const [pulg, dext] of CANOS_PULGADA) {
    out.push(
      v('abrazadera-cano', `Abrazadera caño ${pulg} (Ø${dext} mm)`, {
        diaCano: dext, ancho: dext < 50 ? 25 : dext < 100 ? 30 : 40,
        pata: dext < 50 ? 30 : 40, diaBulon: dext < 50 ? 8 : 10,
      }, { norma: 'ASTM A53 · diámetro exterior real', grupo: 'Cañerías' })
    );
  }

  for (const ancho of BANDEJAS) {
    out.push(
      v('bandeja-portacables', `Bandeja portacables ${ancho} mm`, {
        ancho, altura: ancho <= 100 ? 50 : ancho <= 300 ? 60 : 85, largo: 3000,
      }, { norma: 'IEC 61537', grupo: 'Electricidad' })
    );
  }

  for (const u of RACK_U) {
    out.push(
      v('panel-rack', `Panel rack 19″ ${u}U`, { u }, { norma: 'EIA-310 · 1U = 44,45 mm', grupo: 'Rack 19″' })
    );
  }

  for (const [a, b] of ANGULOS) {
    out.push(v('angulo-l', `Ángulo ${a} × ${b}`, { a, b, largo: 3000 }, { grupo: 'Perfiles' }));
  }

  for (const [alma, ala] of CANALES_U) {
    out.push(v('canal-u', `Canal U ${alma} × ${ala}`, { alma, ala, largo: 3000 }, { grupo: 'Perfiles' }));
  }

  for (const d of DISCOS) {
    /* El interior y el circulo de pernos se escalan con el diametro. Dejando
       los de fabrica, un disco de 50 salia con un agujero de 80 y area
       negativa: la pieza no existia. */
    out.push(v('disco', `Disco pleno Ø${d}`, {
      dia: d, diaInt: 0, nAgujeros: 0, bcd: 0,
    }, { grupo: 'Chapa plana' }));
    out.push(v('disco', `Arandela Ø${d}`, {
      dia: d, diaInt: Math.round(d * 0.4), nAgujeros: 0, bcd: 0,
    }, { grupo: 'Chapa plana' }));
    if (d >= 100) {
      out.push(v('disco', `Tapa con pernos Ø${d}`, {
        dia: d, diaInt: Math.round(d * 0.35), bcd: Math.round(d * 0.78),
        nAgujeros: d < 200 ? 4 : 8, diaAgujero: d < 200 ? 8 : 12,
      }, { grupo: 'Chapa plana' }));
    }
  }

  for (const [nombre, w, h] of TAPAS) {
    out.push(v('placa', `Tapa ${nombre} cm`, { w, h, r: 4, patron: 'esquinas', dia: 5, margen: 10 }, { grupo: 'Tapas' }));
  }

  for (const altura of PARANTES) {
    for (const perfil of ['L', 'C']) {
      out.push(
        v('parante-rack', `Parante ranurado ${altura} mm · ${perfil === 'L' ? 'ángulo' : 'perfil C'}`,
          { altura, perfil }, { grupo: 'Estanterías' })
      );
    }
  }

  for (const [ancho, fondo] of ESTANTES) {
    out.push(v('estante-rack', `Estante ${ancho} × ${fondo}`, { ancho, fondo }, { grupo: 'Estanterías' }));
  }

  for (const brazo of MENSULAS) {
    out.push(v('mensula-pared', `Ménsula ${brazo} mm`, { brazo, altura: brazo }, { grupo: 'Estanterías' }));
  }

  for (const largo of PELDANOS) {
    out.push(v('peldano-escalera', `Peldaño ${largo} mm`, { largo }, { grupo: 'Escaleras' }));
  }

  for (const m of MOTIVOS) {
    for (const [nombre, ancho, alto] of PANELES) {
      out.push(
        v('panel-decorativo', `Celosía ${m.nombre.toLowerCase()} · ${nombre} ${ancho}×${alto}`,
          { ancho, alto, motivo: m.id, tamMotivo: 60 }, { grupo: 'Decoración' })
      );
    }
  }

  for (const [largo, ancho] of PLETINAS) {
    out.push(v('pletina', `Pletina ${largo} × ${ancho}`, { largo, ancho, n: 2, dia: 10 }, { grupo: 'Chapa plana' }));
  }

  for (const [w, h] of REJILLAS) {
    out.push(v('rejilla', `Rejilla ${w} × ${h}`, { w, h }, { grupo: 'Ventilación' }));
  }

  for (const c of CARTELAS) {
    out.push(v('cartela', `Cartela ${c} × ${c}`, { a: c, b: c }, { grupo: 'Estructura' }));
  }

  for (const l of PLACAS_BASE) {
    out.push(v('placa-base', `Placa base ${l} × ${l}`, { w: l, h: l }, { grupo: 'Estructura' }));
  }

  for (const [a, b] of ESCUADRAS) {
    out.push(v('escuadra', `Escuadra ${a} × ${b}`, { a, b }, { grupo: 'Estructura' }));
  }

  for (const largo of LARGUEROS) {
    out.push(v('larguero-rack', `Larguero rack ${largo} mm`, { largo }, { grupo: 'Estanterías' }));
  }

  for (const [ext, int] of ANILLOS) {
    out.push(v('anillo', `Anillo Ø${ext}/${int}`, { diaExt: ext, diaInt: int }, { grupo: 'Chapa plana' }));
  }

  for (const [d1, d2] of CONOS) {
    out.push(v('cono', `Reducción Ø${d1} a Ø${d2}`, { d1, d2, h: Math.round(d1 * 0.8) }, { grupo: 'Calderería' }));
  }

  for (const [dia, alto] of VIROLAS) {
    out.push(v('virola', `Virola Ø${dia} × ${alto}`, { dia, alto }, { grupo: 'Calderería' }));
  }

  for (const dia of CODOS) {
    out.push(v('codo', `Codo 90° Ø${dia}`, { dia }, { grupo: 'Calderería' }));
    out.push(v('codo', `Codo 45° Ø${dia}`, { dia, anguloTotal: 45, gajos: 2 }, { grupo: 'Calderería' }));
  }

  for (const [L, A, H] of CAJAS) {
    out.push(v('bandeja', `Bandeja ${L} × ${A} × ${H}`, { L, A, H }, { grupo: 'Cajas' }));
    out.push(v('tapa-pestanas', `Tapa ${L} × ${A}`, { L: L + 4, A: A + 4 }, { grupo: 'Cajas' }));
  }

  for (const alma of PERFILES_Z) {
    out.push(v('perfil-z', `Perfil Z alma ${alma}`, { alma, largo: 3000 }, { grupo: 'Perfiles' }));
  }

  for (const alma of SOMBREROS) {
    out.push(v('sombrero', `Perfil sombrero alma ${alma}`, { alma, largo: 3000 }, { grupo: 'Perfiles' }));
  }

  for (const [nombre, lados, radio] of POLIGONOS) {
    out.push(
      v('poligono', `${nombre} Ø${radio * 2}`, {
        lados, radio, estrella: nombre === 'Estrella', radioInterior: Math.round(radio * 0.45),
      }, { grupo: 'Decoración' })
    );
  }

  for (const z of PINONES) {
    out.push(v('pinon', `Piñón ${z} dientes`, { z }, { grupo: 'Mecánica' }));
  }

  for (const z of [12, 16, 20, 24, 30, 40, 50, 60]) {
    out.push(v('engranaje', `Engranaje ${z} dientes · módulo 2`, { z, modulo: 2 }, { grupo: 'Mecánica' }));
  }

  return out;
}

/* ── API ────────────────────────────────────────────────────────────────── */

let _cache = null;

/** Las variantes, calculadas una vez. */
export function variantes() {
  if (!_cache) _cache = generarVariantes();
  return _cache;
}

/**
 * El catálogo completo: cada familia de `library.js` más todas sus medidas
 * normalizadas.
 *
 * Se devuelve plano y con `esVariante` para que la interfaz pueda mostrar las
 * familias arriba —que son las que se usan para diseñar— y las medidas abajo.
 */
export function catalogo() {
  const familias = PIEZAS.map((p) => ({
    piezaId: p.id,
    nombre: p.nombre,
    categoria: p.categoria,
    descripcion: p.descripcion,
    params: null, // los que trae por defecto
    esVariante: false,
  }));
  const medidas = variantes().map((x) => {
    const def = getPieza(x.piezaId);
    return {
      ...x,
      categoria: x.grupo || def?.categoria || 'Otros',
      descripcion: x.norma ? `Medida normalizada · ${x.norma}` : 'Medida de uso corriente',
      esVariante: true,
    };
  });
  return [...familias, ...medidas];
}

/** Cuántas entradas tiene el catálogo, por grupo. */
export function resumenCatalogo() {
  const todo = catalogo();
  const porGrupo = new Map();
  for (const x of todo) {
    porGrupo.set(x.categoria, (porGrupo.get(x.categoria) || 0) + 1);
  }
  return {
    total: todo.length,
    familias: PIEZAS.length,
    medidas: variantes().length,
    grupos: [...porGrupo.entries()].map(([g, n]) => ({ grupo: g, n })).sort((a, b) => b.n - a.n),
  };
}

/**
 * Los parámetros de una variante, completados con los de fábrica de su
 * familia. Lo que falta en la tabla lo pone la pieza.
 */
export function paramsDeVariante(variante) {
  return { ...paramsPorDefecto(variante.piezaId), ...(variante.params || {}) };
}
