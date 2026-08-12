/**
 * Puente hacia la interfaz anterior.
 *
 * Panel y Cotizador ya están rehechos en React; las otras siete vistas siguen
 * siendo las de antes y se muestran acá dentro de un iframe. El aislamiento
 * es el punto: `web/css/app.css` estiliza `button`, `input` y `table` por
 * selector de elemento, así que cargarla en el mismo documento le cambiaría
 * el aspecto a toda la interfaz nueva.
 *
 * Cuando una vista se migra, se saca de `Estructura.RUTAS` como legado y
 * deja de pasar por acá. No hay nada más que desarmar.
 */

import { useRef } from 'react';
import { ExternalLink } from 'lucide-react';
import { usarTema } from '@/lib/estado';
import { Boton } from '@/componentes/ui/boton';

export function Legacy({ ruta }) {
  const oscuro = usarTema((s) => s.oscuro);
  const iframe = useRef(null);
  const src = `/legacy/?embebido=1&tema=${oscuro ? 'oscuro' : 'claro'}#/${ruta}`;

  return (
    <div className="space-y-3">
      <div className="no-imprimir flex items-center justify-between gap-3 rounded-xl border border-borde bg-panel-alto px-3.5 py-2">
        <p className="text-[11.5px] text-suave leading-snug">
          Interfaz anterior. Funciona igual que siempre — todavía no le tocó el rediseño.
        </p>
        <Boton tono="fantasma" tam="sm" comoHijo>
          <a href={src} target="_blank" rel="noreferrer">
            <ExternalLink />
            Abrir aparte
          </a>
        </Boton>
      </div>

      <iframe
        ref={iframe}
        // Al cambiar de tema se remonta: es la forma más simple de que el
        // iframe lo tome, y estas vistas son listados sin estado que perder.
        key={`${ruta}-${oscuro}`}
        src={src}
        title="Interfaz anterior de KORT"
        className="w-full rounded-xl border border-borde bg-panel"
        style={{ height: 'calc(100vh - 148px)', minHeight: 520 }}
      />
    </div>
  );
}
