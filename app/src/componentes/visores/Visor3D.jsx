/**
 * Visor 3D — la pieza doblada, con react-three-fiber.
 *
 * Sirve para una cosa concreta: ver si el plegado da lo que uno cree antes de
 * mandar la chapa a la máquina. Las caras y los cantos van con materiales
 * distintos porque el canto cortado con láser no refleja como la cara
 * laminada, y esa diferencia es la que hace que se lea como chapa.
 */

import { useEffect, useMemo, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
// Nada de `Environment` de drei: sus presets se bajan de un CDN y el taller
// puede estar sin internet (además de que la CSP del servidor no lo permite).
// La iluminación es de tres puntos, hecha a mano y servida desde acá.
import { OrbitControls, Grid } from '@react-three/drei';
// RoomEnvironment es PROCEDURAL: arma la escena de reflejos con geometría y
// luces en código, sin bajar ningún HDRI. Por eso sí se puede usar sin
// internet, a diferencia del <Environment> de drei.
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import * as THREE from 'three';
import { Box, Move3d, Square, Layers2, Spline } from 'lucide-react';
import { geometriasDelModelo } from '@/lib/geometria3d';
import { usarTema } from '@/lib/estado';
import { Boton } from '@/componentes/ui/boton';

const VISTAS = {
  iso: { dir: [1, 0.85, 1.25], txt: 'Iso', Icono: Box },
  frontal: { dir: [0, 0, 1], txt: 'Frente', Icono: Square },
  lateral: { dir: [1, 0, 0.001], txt: 'Lateral', Icono: Layers2 },
  superior: { dir: [0, 1, 0.001], txt: 'Planta', Icono: Move3d },
};

/**
 * Encuadra la pieza y coloca la cámara. Va adentro del Canvas porque necesita
 * la cámara y los controles reales, no una referencia externa.
 */
function Camara({ vista, radio }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls);

  useEffect(() => {
    const dist = (radio / Math.sin((camera.fov * Math.PI) / 360)) * 1.25;
    const [x, y, z] = (VISTAS[vista] || VISTAS.iso).dir;
    camera.position.copy(new THREE.Vector3(x, y, z).normalize().multiplyScalar(dist));
    camera.near = Math.max(0.5, dist / 500);
    camera.far = dist * 20;
    camera.updateProjectionMatrix();
    camera.lookAt(0, 0, 0);
    if (controls) {
      controls.target.set(0, 0, 0);
      controls.update();
    }
  }, [vista, radio, camera, controls]);

  return null;
}

/**
 * Mapa de reflejos.
 *
 * Es lo que separa "una forma gris" de "una chapa". Un metal sin entorno que
 * reflejar se ve plano por más que se le suba el `metalness`: el brillo del
 * acero es, literalmente, el reflejo de lo que tiene alrededor.
 *
 * Se genera una sola vez y se libera al desmontar: el PMREM ocupa memoria de
 * GPU y el cotizador cambia de pieza muchas veces mientras se escribe.
 */
function Entorno() {
  const gl = useThree((s) => s.gl);
  const escena = useThree((s) => s.scene);

  useEffect(() => {
    const pmrem = new THREE.PMREMGenerator(gl);
    const entorno = pmrem.fromScene(new RoomEnvironment(), 0.04);
    escena.environment = entorno.texture;
    escena.environmentIntensity = 0.55;
    return () => {
      escena.environment = null;
      entorno.texture.dispose();
      pmrem.dispose();
    };
  }, [gl, escena]);

  return null;
}

function Pieza({ modelo, aristas }) {
  const geoms = useMemo(() => geometriasDelModelo(modelo), [modelo]);

  // Las geometrías se construyen a mano: si no se liberan, cambiar de pieza
  // veinte veces mientras se cotiza deja veinte buffers en la GPU.
  useEffect(() => {
    return () => {
      geoms.caras?.dispose();
      geoms.cantos?.dispose();
    };
  }, [geoms]);

  if (!geoms.caras && !geoms.cantos) return null;

  return (
    <group>
      {geoms.caras && (
        <mesh geometry={geoms.caras} castShadow receiveShadow>
          <meshStandardMaterial color="#aebecd" metalness={0.85} roughness={0.28} envMapIntensity={1.15} side={THREE.DoubleSide} flatShading />
        </mesh>
      )}
      {geoms.cantos && (
        <mesh geometry={geoms.cantos} castShadow receiveShadow>
          <meshStandardMaterial color="#7f909f" metalness={0.55} roughness={0.62} envMapIntensity={0.8} side={THREE.DoubleSide} flatShading />
        </mesh>
      )}
      {aristas && geoms.caras && (
        <lineSegments>
          <edgesGeometry args={[geoms.caras, 25]} />
          <lineBasicMaterial color="#2b3644" transparent opacity={0.45} />
        </lineSegments>
      )}
    </group>
  );
}

export function Visor3D({ modelo, alto = 400 }) {
  const oscuro = usarTema((s) => s.oscuro);
  const [vista, setVista] = useState('iso');
  const [aristas, setAristas] = useState(false);

  const radio = useMemo(() => {
    const t = modelo?.bbox?.tam;
    return t ? Math.max(Math.hypot(t[0], t[1], t[2]) / 2, 10) : 100;
  }, [modelo]);

  const alturaPiso = useMemo(() => {
    const b = modelo?.bbox;
    return b ? -(b.centro[2] - b.min[2]) - 0.5 : 0;
  }, [modelo]);

  if (!modelo?.faces?.length) {
    return (
      <div
        className="flex items-center justify-center rounded-xl text-[13px] text-tenue bg-lienzo"
        style={{ height: alto }}
      >
        Sin modelo 3D para esta pieza
      </div>
    );
  }

  return (
    <div className="relative rounded-xl overflow-hidden bg-lienzo" style={{ height: alto }}>
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ fov: 42, position: [radio * 2, radio * 1.6, radio * 2.4] }}
        gl={{
          antialias: true,
          preserveDrawingBuffer: true,
          // ACES comprime los brillos en vez de quemarlos: sin esto, el
          // reflejo del entorno sobre el metal sale como una mancha blanca.
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.05,
        }}
      >
        <color attach="background" args={[oscuro ? '#0f141b' : '#f7f9fb']} />
        {/* Tres puntos: principal con sombra, relleno frío del lado opuesto y
            contraluz que despega la pieza del fondo. Sin el contraluz, una
            chapa oscura sobre fondo oscuro pierde el canto. */}
        <hemisphereLight intensity={oscuro ? 0.5 : 0.85} groundColor={oscuro ? '#0b0f15' : '#d7dee7'} />
        <directionalLight
          position={[radio * 1.2, radio * 2, radio * 2.4]}
          intensity={oscuro ? 1.7 : 2.2}
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-bias={-0.0005}
        />
        <directionalLight position={[-radio * 2, radio * 0.6, -radio]} intensity={0.55} color="#9fc4e8" />
        <directionalLight position={[0, -radio, -radio * 1.6]} intensity={0.35} color="#ffd7c2" />

        <Entorno />
        <Pieza modelo={modelo} aristas={aristas} />

        {/* Plano que sólo recibe sombra: apoya la pieza en el piso. Sin él la
            sombra no tiene dónde caer y la pieza flota. */}
        <mesh position={[0, alturaPiso + 0.1, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[radio * 8, radio * 8]} />
          <shadowMaterial opacity={oscuro ? 0.32 : 0.18} />
        </mesh>

        <Grid
          position={[0, alturaPiso, 0]}
          args={[radio * 8, radio * 8]}
          cellSize={Math.max(10, radio / 5)}
          sectionSize={Math.max(50, radio)}
          cellColor={oscuro ? '#2a3543' : '#cfd8e2'}
          sectionColor={oscuro ? '#3d4a5a' : '#9aa8b8'}
          fadeDistance={radio * 14}
          infiniteGrid={false}
        />

        <OrbitControls makeDefault enableDamping dampingFactor={0.12} />
        <Camara vista={vista} radio={radio} />
      </Canvas>

      <div className="absolute right-2.5 top-2.5 flex flex-wrap justify-end gap-1">
        {Object.entries(VISTAS).map(([k, v]) => (
          <Boton
            key={k}
            tam="sm"
            tono={vista === k ? 'corte' : 'neutro'}
            className={vista === k ? '' : 'bg-panel/90 backdrop-blur'}
            onClick={() => setVista(k)}
          >
            <v.Icono />
            {v.txt}
          </Boton>
        ))}
        <Boton
          tam="sm"
          tono={aristas ? 'corte' : 'neutro'}
          className={aristas ? '' : 'bg-panel/90 backdrop-blur'}
          onClick={() => setAristas((a) => !a)}
        >
          <Spline />
          Aristas
        </Boton>
      </div>

      <div className="pointer-events-none absolute bottom-2.5 left-2.5 rounded-lg bg-black/65 px-2.5 py-1 font-mono text-[11px] text-white">
        Arrastrar: orbitar · Rueda: acercar · Botón derecho: mover
      </div>
    </div>
  );
}
