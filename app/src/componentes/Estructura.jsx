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
  Layers, Cpu, Wallet, Settings, Moon, Sun, Wifi, WifiOff, FoldVertical, Tags,
  UserRound, Archive,
  RadioTower, MoreHorizontal,
} from 'lucide-react';
import { usarEstado, usarOperario, usarTema } from '@/lib/estado';
import { Boton } from '@/componentes/ui/boton';
import { cn } from '@/lib/utils';

/* `nuevo: true` marca lo que ya está rehecho en React. Las demás siguen
   funcionando con la interfaz anterior hasta que les toque el turno. */
export const RUTAS = [
  { a: '/', txt: 'Panel', Icono: LayoutDashboard, nuevo: true },
  { a: '/cotizador', txt: 'Cotizador', Icono: Calculator, nuevo: true },
  { a: '/plegado', txt: 'Plegado', Icono: FoldVertical, nuevo: true },
  { a: '/tarifario', txt: 'Tarifario', Icono: Tags, nuevo: true },
  { a: '/presupuestos', txt: 'Presupuestos', Icono: FileText, nuevo: true },
  { a: '/ordenes', txt: 'Producción', Icono: Factory, nuevo: true },
  { a: '/clientes', txt: 'Clientes', Icono: Users },
  { a: '/materiales', txt: 'Materiales', Icono: Layers, nuevo: true },
  { a: '/stock', txt: 'Stock chapa', Icono: Archive, nuevo: true },
  { a: '/maquina-en-vivo', txt: 'Máquina en vivo', Icono: RadioTower, nuevo: true },
  { a: '/maquinas', txt: 'Máquinas', Icono: Cpu, nuevo: true },
  { a: '/costos', txt: 'Costos', Icono: Wallet, nuevo: true },
  { a: '/config', txt: 'Configuración', Icono: Settings },
];

const PRINCIPALES = new Set(['/', '/cotizador', '/ordenes', '/plegado', '/maquina-en-vivo', '/stock']);
const RUTAS_PRINCIPALES = RUTAS.filter((r) => PRINCIPALES.has(r.a));
const RUTAS_MAS = RUTAS.filter((r) => !PRINCIPALES.has(r.a));
const MOVIL_FIJAS = new Set(['/', '/cotizador', '/ordenes']);
const RUTAS_MOVIL = RUTAS.filter((r) => MOVIL_FIJAS.has(r.a));
const RUTAS_MOVIL_MAS = RUTAS.filter((r) => !MOVIL_FIJAS.has(r.a));

function Logo() {
  return (
    <div className="flex h-9 w-[124px] shrink-0 items-center justify-center rounded-md bg-white px-2 shadow-sm ring-1 ring-white/20">
      <img src="/kort-logo.png" alt="KORT" className="h-full w-full object-contain" />
    </div>
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

function MenuMas({ pathname, rutas = RUTAS_MAS }) {
  const activo = rutas.some((r) => pathname.startsWith(r.a));
  return <details className="group relative shrink-0">
    <summary className={cn(
      'flex cursor-pointer list-none items-center gap-1.5 rounded-lg px-2.5 py-2 text-[13px] transition-colors [&::-webkit-details-marker]:hidden',
      activo ? 'bg-corte-500 font-semibold text-white' : 'text-acero-200/75 hover:bg-white/10 hover:text-white'
    )}><MoreHorizontal className="size-[15px]" /><span>Más</span></summary>
    <div className="absolute right-0 top-[calc(100%+8px)] z-[80] grid min-w-[220px] gap-1 rounded-xl border border-white/10 bg-acero-900 p-2 shadow-2xl shadow-black/45 dark:bg-acero-950">
      {rutas.map((r) => <NavLink key={r.a} to={r.a} onClick={(e) => e.currentTarget.closest('details')?.removeAttribute('open')} className={({ isActive }) => cn('flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] text-acero-200 hover:bg-white/10 hover:text-white', isActive && 'bg-corte-500 text-white')}><r.Icono className="size-3.5" /><span className="flex-1">{r.txt}</span>{!r.nuevo ? <span className="size-1 rounded-full bg-current opacity-40" /> : null}</NavLink>)}
    </div>
  </details>;
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

function SelectorOperario() {
  const nombre = usarOperario((s) => s.nombre);
  const cambiar = usarOperario((s) => s.cambiar);

  return (
    <label
      className="hidden lg:flex h-9 w-[172px] shrink-0 items-center gap-2 rounded-lg border border-white/10 bg-white/8 px-2.5 text-acero-100 focus-within:border-corte-400/70 focus-within:ring-2 focus-within:ring-corte-500/25"
      title="Operario que firma los cambios en la bitácora"
    >
      <UserRound className="size-4 text-acero-300" />
      <input
        value={nombre}
        onChange={(e) => cambiar(e.target.value)}
        placeholder="Operario"
        className="min-w-0 flex-1 bg-transparent text-[12px] font-medium text-white outline-none placeholder:text-acero-300/70"
      />
    </label>
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

        {/* Las acciones diarias quedan siempre visibles. Administración y
            consultas secundarias van en Más: un scroll horizontal escondía
            justamente la máquina en vivo en monitores de 1280 px. */}
        <nav
          ref={nav}
          className="flex min-w-0 flex-1 items-center overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          <div className="hidden lg:flex min-w-0 items-center"><>{RUTAS_PRINCIPALES.map((r) => <Enlace key={r.a} ruta={r} activo={r.a === '/' ? pathname === '/' : pathname.startsWith(r.a)} />)}</><MenuMas pathname={pathname} /></div>
          <div className="flex min-w-0 items-center lg:hidden"><>{RUTAS_MOVIL.map((r) => <Enlace key={r.a} ruta={r} activo={r.a === '/' ? pathname === '/' : pathname.startsWith(r.a)} />)}</><MenuMas pathname={pathname} rutas={RUTAS_MOVIL_MAS} /></div>
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          <SelectorOperario />
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
