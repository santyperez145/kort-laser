/**
 * Estructura de la aplicación: barra superior y área de trabajo.
 *
 * La navegación va arriba, en horizontal, como en la versión anterior. Con
 * lateral se perdían 218 px de ancho, y en el cotizador ese ancho es lo que
 * decide si las tres columnas —ítems, plano, precio— entran juntas o el
 * precio se cae abajo. En una notebook de 1366 px la diferencia es esa.
 */

import { useRef } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  LayoutDashboard, Calculator, FileText, Factory, Users,
  Layers, Cpu, Wallet, Settings, Moon, Sun, Wifi, WifiOff, FoldVertical,
} from 'lucide-react';
import { usarEstado, usarTema } from '@/lib/estado';
import { Boton } from '@/componentes/ui/boton';
import { cn } from '@/lib/utils';

/* `nuevo: true` marca lo que ya está rehecho en React. Las demás siguen
   funcionando con la interfaz anterior hasta que les toque el turno. */
export const RUTAS = [
  { a: '/', txt: 'Panel', Icono: LayoutDashboard, nuevo: true },
  { a: '/cotizador', txt: 'Cotizador', Icono: Calculator, nuevo: true },
  { a: '/plegado', txt: 'Plegado', Icono: FoldVertical, nuevo: true },
  { a: '/presupuestos', txt: 'Presupuestos', Icono: FileText },
  { a: '/ordenes', txt: 'Producción', Icono: Factory },
  { a: '/clientes', txt: 'Clientes', Icono: Users },
  { a: '/materiales', txt: 'Materiales', Icono: Layers },
  { a: '/maquinas', txt: 'Máquinas', Icono: Cpu },
  { a: '/costos', txt: 'Costos', Icono: Wallet },
  { a: '/config', txt: 'Configuración', Icono: Settings },
];

function Logo() {
  return (
    <svg viewBox="0 0 100 100" className="size-[30px] rounded-[7px] shrink-0">
      <rect width="100" height="100" rx="18" fill="#1b3a5c" />
      <path d="M24 22h14v24l20-24h17L52 48l24 30H58L38 52v26H24z" fill="#e4572e" />
    </svg>
  );
}

function Enlace({ ruta, activo }) {
  const { Icono } = ruta;
  return (
    <NavLink
      to={ruta.a}
      title={ruta.nuevo ? undefined : 'Interfaz anterior: todavía sin rediseñar'}
      className={cn(
        'relative flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors',
        activo ? 'text-white font-semibold' : 'text-acero-200/75 hover:bg-white/10 hover:text-white'
      )}
    >
      {activo && (
        // layoutId hace que el resaltado se deslice entre ítems en vez de
        // aparecer y desaparecer: se ve hacia dónde te moviste.
        <motion.span
          layoutId="nav-activo"
          className="absolute inset-0 rounded-lg bg-corte-500"
          transition={{ type: 'spring', stiffness: 480, damping: 38 }}
        />
      )}
      <Icono className="relative size-[15px]" />
      <span className="relative whitespace-nowrap">{ruta.txt}</span>
      {!ruta.nuevo && <span className="relative size-1 rounded-full bg-current opacity-40" />}
    </NavLink>
  );
}

function ChipConexion() {
  const listo = usarEstado((s) => s.listo);
  const error = usarEstado((s) => s.errorConexion);
  const Icono = listo ? Wifi : WifiOff;

  return (
    <div
      title={error || (listo ? 'Datos cargados desde el servidor' : 'Conectando…')}
      className={cn(
        'hidden sm:flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium',
        listo
          ? 'bg-white/12 text-acero-100'
          : 'bg-peligro-500/25 text-white animate-latir'
      )}
    >
      <Icono className="size-3" />
      {listo ? 'Conectado' : error ? 'Sin conexión' : 'Conectando'}
    </div>
  );
}

export function Estructura({ children }) {
  const oscuro = usarTema((s) => s.oscuro);
  const alternar = usarTema((s) => s.alternar);
  const empresa = usarEstado((s) => s.config?.empresa?.nombre);
  const { pathname } = useLocation();
  const nav = useRef(null);

  return (
    <div className="flex h-full flex-col">
      <header className="no-imprimir sticky top-0 z-50 flex h-14 items-center gap-4 bg-acero-900 px-4 shadow-lg shadow-black/25 dark:bg-acero-950">
        <div className="flex shrink-0 items-center gap-2.5">
          <Logo />
          <div className="hidden md:block leading-tight">
            <div className="text-[15px] font-bold tracking-[0.5px] text-white">KORT</div>
            <div className="text-[10px] text-acero-300/80">{empresa || 'Corte láser · Plegado CNC'}</div>
          </div>
        </div>

        {/* Los nueve ítems entran justos en 1280 px: el espaciado está medido
            para eso. Por debajo desborda con scroll horizontal y sin barra
            visible, que ahí comería alto útil. */}
        <nav
          ref={nav}
          className="flex min-w-0 flex-1 items-center overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {RUTAS.map((r) => (
            <Enlace
              key={r.a}
              ruta={r}
              activo={r.a === '/' ? pathname === '/' : pathname.startsWith(r.a)}
            />
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          <ChipConexion />
          <Boton
            tono="fantasma" tam="icono" onClick={alternar} title="Cambiar tema"
            className="text-acero-100 hover:bg-white/12 hover:text-white"
          >
            {oscuro ? <Sun className="size-4" /> : <Moon className="size-4" />}
          </Boton>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto trama-chapa">
        <div className="mx-auto w-full max-w-[1760px] p-4 md:p-5 animate-entrar">{children}</div>
      </main>
    </div>
  );
}
