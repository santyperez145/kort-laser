/**
 * Anidar adentro del agujero de otra pieza.
 *
 * Cuando se corta una brida, un anillo o una placa con una ventana grande, el
 * material de adentro del agujero **se tira**. Ya está comprado, ya está en la
 * chapa y ya se paga: si ahí entra una pieza chica, esa pieza sale gratis en
 * material.
 *
 * Es lo que hace el software de nesting profesional y es lo que más ataca el
 * desperdicio en un taller que corta bridas o tapas. Con una brida de 300 mm y
 * agujero de 200, el agujero solo son 314 cm² de chapa por pieza.
 *
 * ## La regla que no se afloja
 *
 * **Nunca prometer un encaje que no existe.** El agujero se rasteriza, se
 * achica el borde por la separación de corte y adentro se busca el mayor
 * rectángulo que entre. Después se anida dentro de ESE rectángulo, no dentro
 * del contorno del agujero. Es conservador a propósito: en un agujero con
 * forma de riñón el rectángulo inscripto desperdicia un poco, pero lo que
 * promete entra siempre. Un anidado optimista se descubre con la máquina
 * cortando y la chapa arruinada.
 *
 * Sin dependencias, como todo `src/core/`.
 */

import { flattenPath, partesDe } from './geometry.js';

/* ── Rotar una forma como la rotó el anidador ───────────────────────────── */

/**
 * Rota contorno y agujeros JUNTOS y los lleva al origen igual que el motor de
 * anidado, para que las coordenadas de los agujeros caigan donde la pieza
 * quedó colocada. Si se rotaran por separado, los agujeros aparecerían
 * corridos respecto de su pieza — y el sistema propondría meter una pieza en
 * un lugar donde hay material.
 */
function formaRotada(shape, grados, tol = 0.35) {
  const a = (grados * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const rot = (pts) => pts.map(([x, y]) => [x * c - y * s, x * s + y * c]);

  const partes = partesDe(shape);
  const outers = partes.map((p) => rot(flattenPath(p.outer, tol)));
  const holes = partes.flatMap((p) => (p.holes || []).map((h) => rot(flattenPath(h, tol))));

  let minX = Infinity;
  let minY = Infinity;
  for (const o of outers) for (const [x, y] of o) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
  }
  const mover = (pts) => pts.map(([x, y]) => [x - minX, y - minY]);
  return { outers: outers.map(mover), holes: holes.map(mover) };
}

/* ── Mayor rectángulo inscripto ─────────────────────────────────────────── */

/** Punto en polígono, por cruce de rayos. */
function dentroDe(px, py, poly) {
  let dentro = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi) {
      dentro = !dentro;
    }
  }
  return dentro;
}

/**
 * Mayor rectángulo de 1s en una matriz binaria (método del histograma).
 *
 * O(filas × columnas) con una pila. Es exacto sobre la grilla: lo único que
 * aproxima es la resolución, y esa aproxima hacia adentro porque una celda
 * sólo cuenta si su centro está dentro del agujero.
 */
function mayorRectangulo(m, cols, filas) {
  const alturas = new Int32Array(cols);
  let mejor = { area: 0, x: 0, y: 0, w: 0, h: 0 };
  const pila = [];

  for (let y = 0; y < filas; y++) {
    for (let x = 0; x < cols; x++) alturas[x] = m[y * cols + x] ? alturas[x] + 1 : 0;

    pila.length = 0;
    for (let x = 0; x <= cols; x++) {
      const h = x === cols ? 0 : alturas[x];
      while (pila.length && alturas[pila[pila.length - 1]] >= h) {
        const alto = alturas[pila.pop()];
        const izq = pila.length ? pila[pila.length - 1] + 1 : 0;
        const ancho = x - izq;
        const area = alto * ancho;
        if (area > mejor.area) mejor = { area, x: izq, y: y - alto + 1, w: ancho, h: alto };
      }
      pila.push(x);
    }
  }
  return mejor;
}

/**
 * El mayor rectángulo utilizable dentro de un agujero, en milímetros.
 *
 * @param {Array} poly agujero en coordenadas de chapa
 * @param {number} separacion holgura al borde del agujero
 * @param {number} res tamaño de celda en mm
 */
export function rectanguloEnHueco(poly, separacion = 5, res = 2) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of poly) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  const w = maxX - minX;
  const h = maxY - minY;
  if (!(w > 0) || !(h > 0)) return null;

  const cols = Math.floor(w / res);
  const filas = Math.floor(h / res);
  if (cols < 2 || filas < 2) return null;

  const m = new Uint8Array(cols * filas);
  for (let j = 0; j < filas; j++) {
    for (let i = 0; i < cols; i++) {
      const cx = minX + (i + 0.5) * res;
      const cy = minY + (j + 0.5) * res;
      m[j * cols + i] = dentroDe(cx, cy, poly) ? 1 : 0;
    }
  }

  /* Se achica el borde por la separación: la pieza de adentro no puede quedar
     pegada al contorno del agujero o los dos cortes se tocan y se arruinan.
     Se erosiona en vez de restar del rectángulo final porque el agujero puede
     no ser convexo. */
  const r = Math.max(1, Math.round(separacion / res));
  let mask = m;
  for (let p = 0; p < r; p++) {
    const n = new Uint8Array(mask);
    for (let j = 0; j < filas; j++) {
      for (let i = 0; i < cols; i++) {
        if (!mask[j * cols + i]) continue;
        if (i === 0 || j === 0 || i === cols - 1 || j === filas - 1) {
          n[j * cols + i] = 0;
          continue;
        }
        /* Los OCHO vecinos, no los cuatro ortogonales. Con cuatro, la erosión
           come un rombo en vez de un cuadrado y la holgura en diagonal queda
           un 30 % más corta que la pedida: en un agujero redondo la esquina
           del rectángulo terminaba a 114,6 mm del centro cuando el borde útil
           era 112,5. Poco, pero el parámetro tiene que valer lo que dice en
           todas las direcciones — si no, no sirve para decidir. */
        let libre = true;
        for (let dj = -1; dj <= 1 && libre; dj++) {
          for (let di = -1; di <= 1; di++) {
            if (!mask[(j + dj) * cols + i + di]) { libre = false; break; }
          }
        }
        if (!libre) n[j * cols + i] = 0;
      }
    }
    mask = n;
  }

  const mejor = mayorRectangulo(mask, cols, filas);
  if (mejor.area === 0) return null;
  return {
    x: minX + mejor.x * res,
    y: minY + mejor.y * res,
    w: mejor.w * res,
    h: mejor.h * res,
  };
}

/* ── Buscar todos los huecos aprovechables de una chapa ────────────────── */

/**
 * Los rectángulos utilizables dentro de los agujeros de las piezas ya
 * colocadas en una chapa.
 *
 * @param {Object} chapaLayout una entrada de `nest().chapas`
 * @param {Map}    formas      id → shape de cada ítem
 * @param {Object} opts        { separacion, resolucion, minLado }
 */
export function huecosDe(chapaLayout, formas, opts = {}) {
  const sep = opts.separacion ?? 5;
  const res = opts.resolucion ?? 2;
  // Debajo de este lado no vale la pena: son recortes que nadie usa y cada
  // pieza metida ahí es un pinchado más y un riesgo de que se caiga.
  const minLado = opts.minLado ?? 25;

  const out = [];
  for (const p of chapaLayout.piezas || []) {
    const shape = formas.get(p.id);
    if (!shape) continue;
    const f = formaRotada(shape, p.rot || 0);
    if (!f.holes.length || !f.outers.length) continue;

    /* La traslación se deduce del contorno ya colocado en vez de recalcularla:
       el motor le suma un `offsetX` propio del perfil rasterizado, y volver a
       derivarlo acá sería duplicar una cuenta que ya se hizo — con el riesgo
       de que las dos digan cosas distintas. */
    const ref = p.poly?.[0];
    const base = f.outers[0]?.[0];
    if (!ref || !base) continue;
    const dx = ref[0] - base[0];
    const dy = ref[1] - base[1];

    for (const h of f.holes) {
      const enChapa = h.map(([x, y]) => [x + dx, y + dy]);
      const rect = rectanguloEnHueco(enChapa, sep, res);
      if (!rect || rect.w < minLado || rect.h < minLado) continue;
      out.push({ ...rect, anfitrion: p.nombre || p.id, anfitrionId: p.id });
    }
  }
  out.sort((a, b) => b.w * b.h - a.w * a.h);
  return out;
}

/* ── Colocar piezas adentro de los huecos ──────────────────────────────── */

/**
 * Acomoda piezas dentro de un rectángulo, en grilla simple.
 *
 * Es a propósito más tonto que el anidador principal: adentro de un agujero
 * entran pocas piezas y en filas, y un anidado sofisticado ahí gana milímetros
 * mientras multiplica las formas de equivocarse. Prueba las dos orientaciones
 * y se queda con la que mete más.
 */
function acomodarEnRect(rect, pieza, sep) {
  const opciones = [
    { w: pieza.w, h: pieza.h, rot: 0 },
    { w: pieza.h, h: pieza.w, rot: 90 },
  ];
  let mejor = { n: 0, pos: [] };
  for (const o of opciones) {
    const cols = Math.floor((rect.w + sep) / (o.w + sep));
    const filas = Math.floor((rect.h + sep) / (o.h + sep));
    const n = cols * filas;
    if (n <= mejor.n) continue;
    const pos = [];
    for (let j = 0; j < filas; j++) {
      for (let i = 0; i < cols; i++) {
        pos.push({ x: rect.x + i * (o.w + sep), y: rect.y + j * (o.h + sep), w: o.w, h: o.h, rot: o.rot });
      }
    }
    mejor = { n, pos };
  }
  return mejor.pos;
}

/**
 * Mete en los agujeros de las chapas anteriores las piezas que quedaron en la
 * ÚLTIMA, para ver si esa chapa se puede evitar.
 *
 * Es el caso que mueve plata: si la última chapa tiene ocho piezas sueltas y
 * las ocho entran en los agujeros de las bridas de las chapas anteriores, se
 * compra **una chapa menos**.
 *
 * @param {Object} resultado el de `nest()`
 * @param {Map}    formas    id → shape
 * @param {Object} opts      { separacion, resolucion, minLado }
 * @returns {{resultado, movidas:number, chapaEvitada:boolean, huecos:Array}}
 */
export function aprovecharHuecos(resultado, formas, opts = {}) {
  const sep = (opts.separacion ?? 5) * 1.5; // más holgura que entre piezas normales
  const chapas = resultado?.chapas || [];
  if (chapas.length < 2) {
    return { resultado, movidas: 0, chapaEvitada: false, huecos: [] };
  }

  const ultima = chapas[chapas.length - 1];
  const anteriores = chapas.slice(0, -1);
  const pendientes = (ultima.piezas || []).slice();
  if (!pendientes.length) return { resultado, movidas: 0, chapaEvitada: false, huecos: [] };

  const huecos = [];
  anteriores.forEach((ch, i) => {
    for (const h of huecosDe(ch, formas, { ...opts, separacion: sep })) huecos.push({ ...h, chapa: i });
  });
  if (!huecos.length) return { resultado, movidas: 0, chapaEvitada: false, huecos: [] };

  const movidas = [];
  for (const hueco of huecos) {
    if (!pendientes.length) break;
    // Se prueba con la pieza más grande que quede: si entra la grande, entra
    // cualquiera, y las grandes son las que hacen falta sacar de la última chapa
    pendientes.sort((a, b) => b.w * b.h - a.w * a.h);
    for (let k = 0; k < pendientes.length; k++) {
      const pos = acomodarEnRect(hueco, pendientes[k], sep);
      if (!pos.length) continue;
      const cuantas = Math.min(pos.length, pendientes.filter((p) => p.id === pendientes[k].id).length);
      let puestas = 0;
      for (let i = pendientes.length - 1; i >= 0 && puestas < cuantas; i--) {
        if (pendientes[i].id !== pendientes[k].id) continue;
        const p = pendientes.splice(i, 1)[0];
        const q = pos[puestas];
        anteriores[hueco.chapa].piezas.push({
          ...p,
          x: q.x,
          y: q.y,
          rot: q.rot,
          enHueco: hueco.anfitrion,
          poly: null, // el visor la dibuja por su rectángulo: no se promete el contorno
        });
        anteriores[hueco.chapa].areaUsada += p.areaReal ?? p.w * p.h;
        movidas.push(p);
        puestas++;
      }
      if (puestas) break;
    }
  }

  if (!movidas.length) return { resultado, movidas: 0, chapaEvitada: false, huecos };

  ultima.piezas = pendientes;
  ultima.areaUsada = pendientes.reduce((a, p) => a + (p.areaReal ?? p.w * p.h), 0);

  const chapaEvitada = pendientes.length === 0;
  const nuevas = chapaEvitada ? anteriores : [...anteriores, ultima];
  const areaChapa = resultado.areaChapa;
  const areaUsadaTotal = nuevas.reduce((a, c) => a + c.areaUsada, 0);

  return {
    resultado: {
      ...resultado,
      chapas: nuevas.map((c, i) => ({ ...c, indice: i + 1, aprovechamiento: c.areaUsada / areaChapa })),
      cantidadChapas: nuevas.length,
      aprovechamientoGlobal: nuevas.length ? areaUsadaTotal / (nuevas.length * areaChapa) : 0,
      aprovechamientoUltima: nuevas.length ? nuevas[nuevas.length - 1].areaUsada / areaChapa : 0,
      areaConsumidaTotal: areaUsadaTotal,
      piezasEnHuecos: movidas.length,
    },
    movidas: movidas.length,
    chapaEvitada,
    huecos,
  };
}
