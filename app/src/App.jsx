import { useEffect } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster, toast } from 'sonner';

import { Estructura } from '@/componentes/Estructura';
import { usarEstado, usarTema } from '@/lib/estado';
import { VistaPanel } from '@/vistas/Panel';
import { VistaCotizador } from '@/vistas/Cotizador';
import { VistaPlegado } from '@/vistas/Plegado';
import { VistaTarifario } from '@/vistas/Tarifario';
import { VistaMateriales } from '@/vistas/Materiales';
import { VistaStock } from '@/vistas/Stock';
import { VistaMaquinaEnVivo } from '@/vistas/MaquinaEnVivo';
import { VistaProduccion } from '@/vistas/Produccion';
import { Legacy } from '@/vistas/Legacy';
import { VistaPresupuestos } from '@/vistas/Presupuestos';
import { Aviso } from '@/componentes/ui/varios';
import { Boton } from '@/componentes/ui/boton';

const cliente = new QueryClient({
  defaultOptions: {
    queries: {
      // Los datos del taller los cambia quien está sentado acá, no un proceso
      // de fondo: no hace falta refrescar al volver a la pestaña.
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      retry: 1,
    },
  },
});

/* Se usa el hash y no el historial del navegador porque la aplicación se abre
   con doble clic desde la máquina del taller: con rutas reales, recargar en
   /cotizador dependería de que el servidor devuelva el index, y el enlace
   `#/cotizador?id=…` que ya guardaban las vistas anteriores sigue andando. */

function Contenido() {
  return (
    <Estructura>
      <Routes>
        <Route path="/" element={<VistaPanel />} />
        <Route path="/cotizador" element={<VistaCotizador />} />
        <Route path="/plegado" element={<VistaPlegado />} />
        <Route path="/tarifario" element={<VistaTarifario />} />
        <Route path="/presupuestos" element={<VistaPresupuestos />} />
        <Route path="/ordenes" element={<VistaProduccion />} />
        <Route path="/clientes" element={<Legacy ruta="clientes" />} />
        <Route path="/materiales" element={<VistaMateriales />} />
        <Route path="/stock" element={<VistaStock />} />
        <Route path="/maquina-en-vivo" element={<VistaMaquinaEnVivo />} />
        <Route path="/maquinas" element={<Legacy ruta="maquinas" />} />
        <Route path="/costos" element={<Legacy ruta="costos" />} />
        <Route path="/config" element={<Legacy ruta="config" />} />
        <Route path="*" element={<VistaPanel />} />
      </Routes>
    </Estructura>
  );
}

function SinConexion({ mensaje, alReintentar }) {
  return (
    <div className="grid h-full place-items-center p-6">
      <div className="panel-kort max-w-md p-6">
        <h1 className="text-lg font-bold">No se pudo conectar con el servidor</h1>
        <p className="mt-1 text-[13px] text-suave">
          La interfaz cargó, pero la API no responde. Revisá que el servidor esté corriendo.
        </p>
        <Aviso nivel="error" className="mt-4">
          {mensaje}
        </Aviso>
        <Boton tono="corte" className="mt-4" onClick={alReintentar}>
          Reintentar
        </Boton>
      </div>
    </div>
  );
}

export function App() {
  const cargar = usarEstado((s) => s.cargar);
  const listo = usarEstado((s) => s.listo);
  const error = usarEstado((s) => s.errorConexion);
  const iniciarTema = usarTema((s) => s.iniciar);

  useEffect(() => {
    iniciarTema();
    cargar().catch((e) => toast.error('No se pudo conectar con el servidor: ' + e.message));
  }, [cargar, iniciarTema]);

  /**
   * Las vistas que todavía están en la interfaz anterior viven en un iframe y
   * guardan por su cuenta. Esta app tiene su propia copia de config,
   * materiales y máquinas —la carga una sola vez porque el cotizador la lee en
   * cada tecla—, así que sin este puente cambiabas un precio en Materiales y
   * el cotizador seguía calculando con el viejo hasta recargar la página.
   * Parecía que el cambio no se había guardado, y en realidad sí se guardaba.
   */
  useEffect(() => {
    const alMensaje = (ev) => {
      if (ev.origin !== window.location.origin) return;
      if (ev.data?.tipo !== 'kort-datos-cambiados') return;
      cargar()
        .then(() => toast.success(`${ev.data.que || 'Los datos'} actualizado, el cotizador ya usa el valor nuevo`))
        .catch(() => {});
    };
    window.addEventListener('message', alMensaje);
    return () => window.removeEventListener('message', alMensaje);
  }, [cargar]);

  return (
    <QueryClientProvider client={cliente}>
      {error && !listo ? (
        <SinConexion mensaje={error} alReintentar={() => cargar().catch(() => {})} />
      ) : (
        <HashRouter>
          <Contenido />
        </HashRouter>
      )}
      <Toaster
        position="bottom-right"
        richColors
        closeButton
        toastOptions={{ style: { fontFamily: 'Segoe UI, system-ui, sans-serif' } }}
      />
    </QueryClientProvider>
  );
}
