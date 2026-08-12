/**
 * Caras planas del modelo -> geometría de three.js.
 *
 * `src/core/mesh3d.js` devuelve la pieza como una lista de caras planas
 * ({ pts, holes, tipo }) porque toda pieza de chapa lo es. Acá cada cara se
 * proyecta a su propio plano, se triangula CON sus agujeros y se devuelve al
 * espacio. Ese paso es lo que hace que una chapa perforada se vea perforada
 * en vez de tapada.
 *
 * Nota de ejes: el modelo trabaja en Z arriba (como el plano de la chapa) y
 * three.js en Y arriba. Se intercambian al construir la geometría, no antes:
 * si se hiciera en mesh3d.js, el DXF y el 3D dejarían de compartir sistema.
 */

import * as THREE from 'three';

/** Normal por el método de Newell: robusto ante vértices casi colineales. */
function normalNewell(pts) {
  const n = new THREE.Vector3();
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    n.x += (a[1] - b[1]) * (a[2] + b[2]);
    n.y += (a[2] - b[2]) * (a[0] + b[0]);
    n.z += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return n.normalize();
}

export function geometriaDeCara(face, centro) {
  const pts = face.pts;
  if (!pts || pts.length < 3) return null;

  const n = normalNewell(pts);
  if (!isFinite(n.x)) return null;

  // Base local del plano
  let u = new THREE.Vector3(1, 0, 0);
  if (Math.abs(n.dot(u)) > 0.9) u = new THREE.Vector3(0, 1, 0);
  u = u.clone().sub(n.clone().multiplyScalar(n.dot(u))).normalize();
  const v = new THREE.Vector3().crossVectors(n, u).normalize();
  const origen = new THREE.Vector3(...pts[0]);

  const a2 = (p) => {
    const d = new THREE.Vector3(p[0], p[1], p[2]).sub(origen);
    return new THREE.Vector2(d.dot(u), d.dot(v));
  };

  const forma = new THREE.Shape(pts.map(a2));
  for (const h of face.holes || []) {
    if (h && h.length >= 3) forma.holes.push(new THREE.Path(h.map(a2)));
  }

  let geom;
  try {
    geom = new THREE.ShapeGeometry(forma);
  } catch {
    return null;
  }

  const pos = geom.attributes.position;
  const arr = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const p = origen
      .clone()
      .addScaledVector(u, pos.getX(i))
      .addScaledVector(v, pos.getY(i))
      .sub(centro);
    arr[i * 3] = p.x;
    arr[i * 3 + 1] = p.z; // Z del modelo -> Y de three.js
    arr[i * 3 + 2] = -p.y;
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  if (geom.index) out.setIndex(Array.from(geom.index.array));
  geom.dispose();
  out.computeVertexNormals();
  return out;
}

/** Une varias geometrías en una sola: cientos de draw calls arruinan el orbitado. */
export function fusionar(geoms) {
  let totalVerts = 0;
  let totalIdx = 0;
  for (const g of geoms) {
    totalVerts += g.attributes.position.count;
    totalIdx += g.index ? g.index.count : g.attributes.position.count;
  }
  const pos = new Float32Array(totalVerts * 3);
  const idx = totalVerts > 65535 ? new Uint32Array(totalIdx) : new Uint16Array(totalIdx);
  let vo = 0;
  let io = 0;
  for (const g of geoms) {
    pos.set(g.attributes.position.array, vo * 3);
    const n = g.attributes.position.count;
    if (g.index) {
      for (let i = 0; i < g.index.count; i++) idx[io++] = g.index.array[i] + vo;
    } else {
      for (let i = 0; i < n; i++) idx[io++] = i + vo;
    }
    vo += n;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.computeVertexNormals();
  return out;
}

/**
 * Separa el modelo en dos geometrías fusionadas: caras y cantos. Van con
 * materiales distintos porque el canto de una chapa cortada con láser no
 * refleja como la cara laminada, y esa diferencia es la que hace que la
 * pieza se lea como chapa y no como un bloque.
 */
export function geometriasDelModelo(modelo) {
  if (!modelo?.faces?.length) return { caras: null, cantos: null };
  const centro = new THREE.Vector3(...modelo.bbox.centro);
  const caras = [];
  const cantos = [];
  for (const f of modelo.faces) {
    const g = geometriaDeCara(f, centro);
    if (!g) continue;
    (f.tipo === 'canto' ? cantos : caras).push(g);
  }
  return {
    caras: caras.length ? fusionar(caras) : null,
    cantos: cantos.length ? fusionar(cantos) : null,
  };
}
