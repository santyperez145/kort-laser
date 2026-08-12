# CLAUDE.md

Contexto para trabajar en este repositorio.

## Qué es

Sistema de cotización, diseño y producción para **KORT**, un taller real de
corte láser y plegado CNC en La Rioja, Argentina. **No es un ejercicio**: con
esto se cotiza y se produce de verdad. Un número mal calculado acá se convierte
en un presupuesto perdido o en un trabajo que se hace a pérdida.

El dueño es Santiago (`santyperez145`). Máquina: **fibra de 3 kW, mesa 3015**.
Plegadora CNC 100 t × 3200.

## Comandos

```bash
npm install        # sólo la primera vez
npm run build      # compila la interfaz a web-dist/  (hace falta tras tocar app/)
npm start          # arranca en http://localhost:4321
npm run dev        # servidor + Vite con recarga en vivo (front en :5173)
npm test           # 96 verificaciones del núcleo
```

En Windows, `INICIAR.bat` hace todo con doble clic: instala si falta, compila
la interfaz si falta y arranca.

⚠️ **`npm start` NO compila.** Si tocaste algo de `app/` y no ves el cambio,
falta el `npm run build`. Para trabajar, `npm run dev` y listo.

**Corré los tests antes de dar por terminado cualquier cambio en `src/core/`.**
Varios de ellos existen porque ya atraparon errores reales de datos, no sólo de
código.

## Idioma y estilo

- **Todo en español rioplatense**: código, comentarios, commits, interfaz.
  Voseo en los textos de interfaz ("cargá", "fijate", "tenés").
- Los comentarios explican **por qué**, no qué. Si un número tiene una fuente
  o un supuesto, va en el comentario.
- **La interfaz usa librerías; el motor de cálculo no.** Esa es la línea, y es
  deliberada. `app/` va con React, Tailwind, Radix, Recharts, Konva y
  react-three-fiber. `src/core/` —corte, plegado, nesting, DXF, PDF, precios—
  **no importa nada de fuera** y sigue así: es lo que hace que corra igual en
  Node y en el navegador, y lo que permite que los 96 tests lo verifiquen sin
  levantar un navegador.
- **Nada de CDN: todo se sirve desde la máquina del taller**, que puede estar
  sin internet. Las dependencias se empaquetan en `web-dist/` y se sirven desde
  Express. Esto ya se comió un intento: el `<Environment>` de drei baja su HDRI
  de un CDN y hubo que sacarlo — la iluminación del visor 3D es de tres puntos
  hecha a mano por eso.

## Arquitectura

```
src/core/     Motor de cálculo. Corre igual en Node y en el navegador
              (ESM puro, sin dependencias). React lo importa con el alias
              @core; los tests, por ruta. Una sola fuente de verdad.
src/server/   Base de datos SQLite y su esquema.
app/          Interfaz nueva: React + Vite + Tailwind + Radix.
              app/src/componentes/ui/   kit propio estilo shadcn
              app/src/componentes/visores/  2D (Konva), 3D (r3f), nesting
              app/src/vistas/           Panel y Cotizador
web/          Interfaz anterior: vanilla JS. Siguen vivas 7 vistas.
web-dist/     Salida de `npm run build`. No se commitea.
server.js     Express + Helmet + Zod.
tests/run.js  Suite completa. Un solo archivo, sin runner externo.
docs/PRECIOS.md  De dónde sale cada número, con nivel de confianza.
```

El servidor sólo persiste, sirve y valida la forma de lo que entra: **todo el
cálculo pasa en el navegador**, para que el cotizador responda mientras se
escribe. En un mostrador, esperar una vuelta de red por cada tecla se nota.

### Las dos interfaces conviven, y el iframe no es pereza

Panel y Cotizador están rehechos en React. Las otras siete vistas
(Presupuestos, Producción, Clientes, Materiales, Máquinas, Costos,
Configuración) siguen siendo las de antes y se muestran **dentro de un
iframe** apuntando a `/legacy`.

El aislamiento es el punto: `web/css/app.css` estiliza `button`, `input`,
`table` y `main` **por selector de elemento**. Cargada en el mismo documento
que la interfaz nueva, le cambia el aspecto a todos los componentes apenas se
visita una de esas vistas. Por la misma razón las variables CSS nuevas van con
prefijo `--k-`: las viejas usan `--fondo`, `--panel`, `--borde` y `--tinta`
como hex y las nuevas como tripletas RGB, así que compartir nombre rompería el
tema de una de las dos según cuál hoja cargue última.

Para migrar una vista: escribirla en `app/src/vistas/`, cambiar su `<Route>` en
`app/src/App.jsx` y marcarla `nuevo: true` en `RUTAS` de `Estructura.jsx`. No
hay nada más que desarmar. Cuando no quede ninguna, se borran `web/`, la
excepción de CSP del legado y el prefijo `--k-` deja de hacer falta.

## Invariantes que no se pueden romper

Estas cuatro cosas, si se rompen, hacen que el sistema cotice mal en silencio.
Son la razón de ser de varios tests.

1. **`cuttingSpeed()` nunca extrapola por encima de `maxEspesor`.** Devuelve
   `null` y el cotizador da error. Si extrapolara, el sistema aceptaría inox
   de 20 mm en una máquina de 3 kW: un trabajo que se vende y no se puede
   entregar. Vale más perder la venta.

2. **Los materiales tienen tablas POR GAS** (`procesos: { O2, N2, AIRE }`), no
   una tabla única. El nitrógeno consume 25-95 m³/h y el oxígeno 1-3 m³/h: ese
   factor 30× es lo que define el precio del inoxidable. Cualquier refactor de
   `materials.js` debe conservar esa estructura.

3. **La potencia eléctrica contratada es costo FIJO, no variable.** EDELAR la
   cobra por kW-mes se use o no. Vive en `costos.js` → estructura del taller y
   se reparte por hora productiva. Si se moviera a `maquina.costo.energia`, los
   trabajos largos la pagarían dos veces y los cortos no la pagarían nunca.

4. **`pathArea()` y `pathBBox()` son exactos con arcos**, no aproximados por
   polígono inscripto. Aproximar subestima el peso del material y con él el
   precio. Ya pasó una vez.

5. **Una pieza puede tener VARIAS PARTES, y el DXF del cliente no se separa
   solo.** Un dibujo con varios contornos exteriores sueltos no es
   necesariamente un lote de piezas independientes: puede ser un cartel, un
   juego que se entrega armado, o piezas cuya separación es parte del pedido.
   Separarlo de oficio rompe el diseño **y cotiza mal en silencio**, porque
   cada parte pasaría a anidarse por su cuenta en otra posición.

   `shape.partes` es la lista `[{outer, holes}]`; cuando no está, la pieza es
   de una sola parte y `outer`/`holes` alcanzan — que es el caso de TODA la
   biblioteca paramétrica. **Ninguna cuenta debe leer `sh.outer` directo: va
   por `partesDe(sh)`**, o mide sólo la parte más grande y el precio sale
   corto. `leerDXF()` devuelve `conjunto` (el dibujo entero) además de
   `piezas` (las partes sueltas, por si de verdad son independientes).

   ⚠️ **En el nesting, una pieza multiparte va por su rectángulo envolvente**,
   no por el contorno de una de sus partes: las partes viajan juntas, así que
   usar el contorno prometería un encastre que en la chapa no existe.

6. **El nesting es por PRESUPUESTO, no por ítem.** La máquina corta un programa
   por chapa, no un ítem por chapa. `planificarNesting()` agrupa por
   (material, espesor, gas, chapa) y reparte chapas, material y setup **por el
   área que ocupa cada ítem en el layout real**. Volver a anidar un ítem por su
   cuenta cuando comparte grupo da un número distinto del que se va a cortar.
   El gas va en la clave a propósito: cambiarlo es cambiar de programa y de
   boquilla. Y `nesting.chapas` es **fraccionario** cuando la chapa es
   compartida — para el total se suma `chapasGrupo` una vez por grupo, que es
   lo que `cotizarPresupuesto()` hace con el `Set` de grupos contados. Sumar
   las fracciones da lo mismo salvo por el error de coma flotante, y ese número
   se usa para comprar material.

## Trampas conocidas

- **Node 21.7 + `better-sqlite3` = segfault.** No hay prebuilds para esa ABI y
  no hay toolchain de compilación en la máquina. Por eso se usa
  `node-sqlite3-wasm`. No cambiar sin verificar que la máquina de Santiago
  pueda compilar módulos nativos.
- **`node-sqlite3-wasm` es CommonJS**: se importa por defecto y se
  desestructura, no con `import { Database }`.
- **three.js necesita el import map** de `web/index.html` (OrbitControls
  importa `"three"` como especificador desnudo) **y** que se sirva también
  `three.core.min.js`, porque el build minificado está partido en dos archivos.
- **Las líneas de plegado viajan en `shape.pliegues`.** No pasarlas además por
  `opts.lineasPlegado` al generar el DXF o salen duplicadas y el CAM las corta
  dos veces.
- **Los visores miden el contenedor con `useLayoutEffect`, no con el
  `ResizeObserver` solo.** El observer sólo entrega notificaciones cuando la
  página está pintando frames: con la pestaña en segundo plano nunca llega la
  primera y el visor se queda clavado en 600 px. Por lo mismo, el `div` que
  lleva la referencia se renderiza **siempre**, con geometría o sin ella — si
  el estado vacío devolviera otro elemento, el observer quedaría mirando uno ya
  desmontado.
- **Konva y three redibujan por `requestAnimationFrame`.** Verificar el lienzo
  con la pestaña oculta da un canvas en blanco que no es un bug. Para probarlo
  de verdad: `window.Konva.stages[0].draw()` fuerza un dibujado síncrono.
- **Vite 8 va sobre rolldown: `manualChunks` tiene que ser una función**, no un
  mapa. Con un objeto el build falla con `manualChunks is not a function`.
- **La CSP no permite scripts inline en la aplicación nueva.** El arranque del
  tema vive en `app/public/tema.js` por eso. `/legacy` sí los permite, acotado,
  porque su `<script type="importmap">` no se puede sacar del HTML.
- **La migración desde el formato viejo NO debe importar tablas técnicas.**
  `fusionarMateriales()` conserva precios y medidas del usuario pero descarta
  las `speeds` viejas. Sin eso, actualizar deja el motor de corte con datos
  obsoletos y precios mal, en silencio.

## Datos: qué está verificado y qué no

`docs/PRECIOS.md` clasifica cada número en 🟢 verificado / 🟡 estimado /
🔴 a confirmar. **Mantenerlo actualizado es parte de cambiar un dato.**

Verificado con fuente oficial: tarifa EDELAR (Res. EUCOP 001/2026), escala
UOM rama 17 (abril 2026), dólar mayorista.

Sin verificar y sensible: precios de gases (el más incierto y el que más mueve
el precio del inox), gastos de estructura, precios de aluminio y cobre.

## Al hacer commits

- Mensaje en español, explicando el porqué del cambio si no es obvio.
- Terminar con `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.
- **Nunca commitear** `data/*.db`, `data/backups/`, `salidas/` ni
  `node_modules/`. Ya está en `.gitignore`, pero el repo es **público**: si se
  agregan datos reales del taller, quedan expuestos.

## Qué sigue

Ver [ROADMAP.md](ROADMAP.md). La limitación más importante hoy es que **el
nesting es por ítem y no por presupuesto**: está documentada ahí con su
impacto medido.
