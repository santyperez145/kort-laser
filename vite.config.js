/**
 * KORT — configuración de build.
 *
 * El motor de cálculo (`src/core/`) NO se copia ni se duplica: se importa con
 * el alias `@core` desde el mismo lugar donde lo lee Node en los tests. Así
 * sigue habiendo una sola fuente de verdad para los números.
 *
 * En desarrollo Vite sirve el front en 5173 y hace proxy de `/api` y
 * `/salidas` al servidor Express de 4321. En producción no hay dos servidores:
 * `npm run build` deja el bundle en `web-dist/` y Express lo sirve solo.
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(raiz, 'app'),
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      '@': path.join(raiz, 'app/src'),
      '@core': path.join(raiz, 'src/core'),
    },
  },

  server: {
    port: 5173,
    // El core vive fuera de `root`: sin esto Vite se niega a servirlo.
    fs: { allow: [raiz] },
    proxy: {
      '/api': 'http://localhost:4321',
      '/salidas': 'http://localhost:4321',
    },
  },

  build: {
    outDir: path.join(raiz, 'web-dist'),
    emptyOutDir: true,
    // three + recharts + konva pesan; el taller carga desde localhost, no por red.
    chunkSizeWarningLimit: 1800,
    rollupOptions: {
      output: {
        // Vite 8 va sobre rolldown, que espera una función y no un mapa.
        // Se separan los tres pesos pesados para que abrir el Panel no
        // baje también el motor 3D.
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          if (/[\\/]node_modules[\\/](three|@react-three)/.test(id)) return 'three';
          if (/[\\/]node_modules[\\/](recharts|d3-|victory)/.test(id)) return 'graficos';
          if (/[\\/]node_modules[\\/](konva|react-konva)/.test(id)) return 'konva';
        },
      },
    },
  },
});
