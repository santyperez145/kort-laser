/**
 * KORT - Visor 3D (three.js)
 *
 * Reemplaza al renderizador propio por WebGL real: buffer de profundidad,
 * iluminación de tres puntos, material metálico y OrbitControls. La diferencia
 * se nota en piezas donde las caras se cruzan (bandejas, codos, conos), que
 * con el algoritmo del pintor se dibujaban en el orden equivocado.
 *
 * El modelo entra como caras planas (ver mesh3d.js): cada una se proyecta a su
 * propio plano, se triangula con los agujeros incluidos y se vuelve a colocar
 * en el espacio. Así una chapa perforada se ve perforada de verdad.
 *
 * Arrastrar = orbitar · Rueda = acercar · Botón derecho = desplazar
 */

import * as THREE from '/lib/three.module.js';
import { OrbitControls } from '/lib/OrbitControls.js';

const COLOR_METAL = 0x9fb3c8;
const COLOR_CANTO = 0x7c8ea3;

export class Visor3D {
  constructor(contenedor, opts = {}) {
    this.cont = contenedor;
    this.alto = opts.alto || 420;
    this.W = contenedor.clientWidth || 600;

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true, // necesario para la instantánea del PDF
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(this.W, this.alto);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.canvas = this.renderer.domElement;
    this.canvas.style.display = 'block';
    this.canvas.style.width = '100%';
    contenedor.appendChild(this.canvas);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, this.W / this.alto, 1, 100000);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.addEventListener('change', () => this.pedirRender());

    this._luces();
    this.grupo = new THREE.Group();
    this.scene.add(this.grupo);

    this.mostrarAristas = true;
    this._aplicarTema();
    this._temaHandler = () => {
      this._aplicarTema();
      this.pedirRender();
    };
    window.addEventListener('kort-tema', this._temaHandler);

    this._obs = new ResizeObserver(() => this.redimensionar());
    this._obs.observe(contenedor);

    this._pendiente = false;
    this._animar();
  }

  _luces() {
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x404a56, 1.15));
    const key = new THREE.DirectionalLight(0xffffff, 1.5);
    key.position.set(1, 1.4, 2);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    this.scene.add(key);
    this.key = key;
    const fill = new THREE.DirectionalLight(0xdce8f5, 0.55);
    fill.position.set(-2, -0.6, 1);
    this.scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 0.4);
    rim.position.set(0, -1.5, -2);
    this.scene.add(rim);
  }

  _aplicarTema() {
    const oscuro = document.body.classList.contains('oscuro');
    this.scene.background = new THREE.Color(oscuro ? 0x1a212b : 0xf7f9fb);
    if (this.grid) {
      this.grid.material.opacity = oscuro ? 0.28 : 0.5;
      this.grid.material.color.setHex(oscuro ? 0x3a4756 : 0x9aa8b8);
    }
  }

  destruir() {
    this._obs?.disconnect();
    window.removeEventListener('kort-tema', this._temaHandler);
    this._muerto = true;
    this.controls?.dispose();
    this._limpiar();
    this.renderer?.dispose();
    this.canvas?.remove();
  }

  redimensionar() {
    this.W = this.cont.clientWidth || 600;
    this.renderer.setSize(this.W, this.alto);
    this.camera.aspect = this.W / this.alto;
    this.camera.updateProjectionMatrix();
    this.pedirRender();
  }

  pedirRender() {
    this._pendiente = true;
  }

  _animar() {
    if (this._muerto) return;
    requestAnimationFrame(() => this._animar());
    const movio = this.controls.update();
    if (movio || this._pendiente) {
      this._pendiente = false;
      this.renderer.render(this.scene, this.camera);
    }
  }

  _limpiar() {
    while (this.grupo.children.length) {
      const o = this.grupo.children.pop();
      o.geometry?.dispose?.();
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
      else o.material?.dispose?.();
    }
  }

  /** Carga un modelo { faces:[{pts, holes, tipo}], bbox } de mesh3d.js */
  cargar(modelo) {
    this._limpiar();
    this.modelo = modelo;
    if (!modelo?.faces?.length) {
      this.pedirRender();
      return;
    }

    const centro = new THREE.Vector3(...modelo.bbox.centro);
    const geomsCara = [];
    const geomsCanto = [];

    for (const f of modelo.faces) {
      const g = geometriaDeCara(f, centro);
      if (!g) continue;
      (f.tipo === 'canto' ? geomsCanto : geomsCara).push(g);
    }

    const matCara = new THREE.MeshStandardMaterial({
      color: COLOR_METAL, metalness: 0.72, roughness: 0.38, side: THREE.DoubleSide,
      flatShading: true,
    });
    const matCanto = new THREE.MeshStandardMaterial({
      color: COLOR_CANTO, metalness: 0.6, roughness: 0.55, side: THREE.DoubleSide,
      flatShading: true,
    });

    for (const [geoms, mat] of [[geomsCara, matCara], [geomsCanto, matCanto]]) {
      if (!geoms.length) continue;
      const merged = fusionar(geoms);
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.grupo.add(mesh);

      if (this.mostrarAristas) {
        const edges = new THREE.EdgesGeometry(merged, 25);
        const linea = new THREE.LineSegments(
          edges,
          new THREE.LineBasicMaterial({ color: 0x2b3644, transparent: true, opacity: 0.45 })
        );
        this.grupo.add(linea);
      }
    }

    this._piso(modelo);
    this.encuadrar();
  }

  _piso(modelo) {
    const t = modelo.bbox.tam;
    const s = Math.max(t[0], t[1], 60) * 3;
    if (this.grid) {
      this.scene.remove(this.grid);
      this.grid.geometry.dispose();
      this.grid.material.dispose();
    }
    const div = Math.max(6, Math.min(40, Math.round(s / 50)));
    this.grid = new THREE.GridHelper(s, div, 0x9aa8b8, 0x9aa8b8);
    this.grid.material.transparent = true;
    this.grid.position.y = -(modelo.bbox.centro[2] - modelo.bbox.min[2]) - 0.5;
    this.scene.add(this.grid);
    this._aplicarTema();
  }

  /** Encuadra la pieza en el visor. */
  encuadrar() {
    if (!this.modelo) return;
    const t = this.modelo.bbox.tam;
    const radio = Math.max(Math.hypot(t[0], t[1], t[2]) / 2, 10);
    const dist = radio / Math.sin((this.camera.fov * Math.PI) / 360) * 1.25;
    this.camera.near = Math.max(0.5, dist / 500);
    this.camera.far = dist * 20;
    this.camera.updateProjectionMatrix();
    this.controls.target.set(0, 0, 0);
    this._distancia = dist;
    this.vistaIsometrica();
    if (this.key) {
      this.key.position.set(radio * 1.2, radio * 2, radio * 2.4);
      const cam = this.key.shadow.camera;
      cam.left = -radio * 2;
      cam.right = radio * 2;
      cam.top = radio * 2;
      cam.bottom = -radio * 2;
      cam.near = 1;
      cam.far = radio * 12;
      cam.updateProjectionMatrix();
    }
  }

  _mirarDesde(x, y, z) {
    const d = this._distancia || 500;
    const v = new THREE.Vector3(x, y, z).normalize().multiplyScalar(d);
    this.camera.position.copy(v);
    this.camera.lookAt(0, 0, 0);
    this.controls.update();
    this.pedirRender();
  }

  vistaIsometrica() { this._mirarDesde(1, 0.85, 1.25); }
  vistaFrontal() { this._mirarDesde(0, 0, 1); }
  vistaSuperior() { this._mirarDesde(0, 1, 0.001); }
  vistaLateral() { this._mirarDesde(1, 0, 0.001); }

  alternarAristas() {
    this.mostrarAristas = !this.mostrarAristas;
    if (this.modelo) this.cargar(this.modelo);
    return this.mostrarAristas;
  }

  /** Instantánea JPEG del render, para meterla en el PDF. */
  instantanea(calidad = 0.88) {
    this.renderer.render(this.scene, this.camera);
    return this.canvas.toDataURL('image/jpeg', calidad);
  }
}

/* ------------------------------------------------------------------ */
/* Geometría: cara plana 3D -> triángulos                              */
/* ------------------------------------------------------------------ */

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

/**
 * Proyecta la cara a su propio plano, la triangula con sus agujeros y la
 * devuelve al espacio. Es lo que permite ver una chapa perforada con los
 * agujeros abiertos en vez de tapados.
 *
 * Nota de ejes: el modelo trabaja en Z arriba (como el plano de la chapa) y
 * three.js en Y arriba, así que se intercambian al construir la geometría.
 */
function geometriaDeCara(face, centro) {
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

  const shape = new THREE.Shape(pts.map(a2));
  for (const h of face.holes || []) {
    if (h && h.length >= 3) shape.holes.push(new THREE.Path(h.map(a2)));
  }

  let geom;
  try {
    geom = new THREE.ShapeGeometry(shape);
  } catch {
    return null;
  }

  // Devolver al espacio: (x2,y2) -> origen + x2·u + y2·v, y luego Z arriba -> Y arriba
  const pos = geom.attributes.position;
  const arr = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x2 = pos.getX(i);
    const y2 = pos.getY(i);
    const p = origen.clone().addScaledVector(u, x2).addScaledVector(v, y2).sub(centro);
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

/** Une varias geometrías en una sola (evita cientos de draw calls). */
function fusionar(geoms) {
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
