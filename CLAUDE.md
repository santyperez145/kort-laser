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
node server.js     # arranca en http://localhost:4321
node tests/run.js  # 96 verificaciones del núcleo
```

En Windows, `INICIAR.bat` hace las tres cosas con doble clic.

**Corré los tests antes de dar por terminado cualquier cambio en `src/core/`.**
Varios de ellos existen porque ya atraparon errores reales de datos, no sólo de
código.

## Idioma y estilo

- **Todo en español rioplatense**: código, comentarios, commits, interfaz.
  Voseo en los textos de interfaz ("cargá", "fijate", "tenés").
- Los comentarios explican **por qué**, no qué. Si un número tiene una fuente
  o un supuesto, va en el comentario.
- **Sin dependencias nuevas salvo que aporten de verdad.** Hoy hay tres
  (`node-sqlite3-wasm`, `three`, `chart.js`) y cada una reemplazó algo que
  valía la pena reemplazar. El resto —motor de corte, plegado, nesting, DXF,
  PDF— es propio y así debe quedar.
- Nada de CDN: todo se sirve desde la máquina del taller, que puede estar sin
  internet.

## Arquitectura

```
src/core/     Motor de cálculo. Corre igual en Node y en el navegador
              (ESM puro, sin APIs de Node). La interfaz lo importa directo
              desde /src/core/*.js, no hay build ni bundler.
src/server/   Base de datos SQLite y su esquema.
web/          Interfaz: vanilla JS, sin framework, un módulo por vista.
tests/run.js  Suite completa. Un solo archivo, sin runner externo.
docs/PRECIOS.md  De dónde sale cada número, con nivel de confianza.
```

El servidor sólo persiste y sirve archivos: **todo el cálculo pasa en el
navegador**, para que el cotizador responda mientras se escribe.

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
