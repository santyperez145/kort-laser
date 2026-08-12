# KORT · Sistema de corte láser y plegado CNC

Sistema completo de cotización, diseño y producción para una metalúrgica de corte
láser y plegado. Calcula el precio a partir de la física real del proceso (no de
una regla de tres), genera los DXF listos para la máquina, arma el presupuesto
en PDF y sigue el trabajo hasta la entrega.

**Calibrado para una fuente de fibra de 3 kW y para los costos de La Rioja,
Argentina** (agosto 2026). Todos los datos y sus fuentes están documentados en
[docs/PRECIOS.md](docs/PRECIOS.md), clasificados según qué tan verificados están.

Funciona **sin internet** y arranca con doble clic. Los datos viven en una base
SQLite dentro de esta carpeta.

---

## Arrancarlo

1. Instalá **Node.js LTS** desde <https://nodejs.org> (una sola vez, gratis).
2. Doble clic en **`INICIAR.bat`**.
3. Se abre solo en <http://localhost:4321>.

Para cerrarlo: `Ctrl+C` en la ventana negra, o cerrala.

Si preferís la terminal:

```bash
npm install
node server.js
```

---

## Lo primero que tenés que hacer

El sistema viene con datos reales pero **no con los tuyos**. Dedicale 30 minutos
a esto y el cotizador pasa de estimar a calcular:

| Paso | Dónde | Qué cargar |
|---|---|---|
| 1 | **Configuración** | Nombre, CUIT, teléfono y email de KORT. Salen en cada PDF. |
| 2 | **Costos** | Alquiler, seguros y demás gastos fijos del mes. Es el 60 % del costo por hora. |
| 3 | **Costos → Energía** | La potencia que tenés contratada de verdad (mirá la factura). |
| 4 | **Materiales** | El precio por kilo de HOY y los espesores que realmente comprás. |
| 5 | **Máquinas** | Verificá el valor del equipo y las horas de vida útil. |
| 6 | **Configuración → Política comercial** | Tu margen, el mínimo de facturación y los descuentos por cantidad. |

### Cómo calibrar el tiempo de corte

1. Cortá una pieza que ya conozcas y **cronometrala de verdad** (de piercing a fin de contorno).
2. Cargá esa misma pieza en el cotizador y mirá "Tiempo por pieza".
3. Si el sistema da de menos, bajá la eficiencia en **Máquinas** o la velocidad de
   ese espesor en **Materiales → ⚡**. Si da de más, subila.
4. Con dos o tres espesores calibrados, el resto se interpola bien: la velocidad
   de corte cae de forma exponencial con el espesor y el sistema lo modela así.

---

## Tres cosas que este sistema hace y casi ningún cotizador hace

### 1. El gas de asistencia se cotiza de verdad

Cada material tiene una tabla **por gas**: oxígeno, nitrógeno y aire. No es un
detalle de ingeniería, es plata:

| Corte | Gas | Caudal |
|---|---|---|
| Acero 6 mm | O₂ | 1,3 m³/h |
| Inox 3 mm | N₂ | **40 m³/h** |
| Inox 8 mm | N₂ | **90 m³/h** |

Cortar inoxidable con nitrógeno consume 30 veces más gas que cortar acero con
oxígeno. En cada cotización aparece la comparativa: cuánto tarda y cuánto sale
con cada gas, y cuánto ahorrarías cambiando. En un lote típico de inox de 3 mm
la diferencia entre nitrógeno y aire es de **más de $ 5.000 sólo en gas**.

En **Costos** hay además una calculadora de repago de generador de nitrógeno.

### 2. La potencia contratada se paga aunque no cortes

EDELAR cobra **$ 9.296,43 por kW contratado por mes** en tarifa T2. Con 30 kW
son $ 278.893 fijos antes de encender la máquina: repartido entre las horas
que realmente producís, sale **más caro que la electricidad que consumís**.

Por eso el sistema separa los costos fijos (pantalla **Costos**) de los
variables (pantalla **Máquinas**), y el costo por hora sube solo cuando el
taller trabaja menos horas. Que es lo que pasa en la realidad.

### 3. El anidado es por forma real, no por rectángulo

Las piezas se anidan por su contorno: los triángulos se encastran, los discos
se meten en los huecos y una L abraza a la siguiente. Como el material es entre
el 60 % y el 90 % del costo, ganar unos puntos de aprovechamiento rinde más que
cortar más rápido. En la vista de nesting se ve el contorno real de cada pieza
y una línea verde marcando el retazo que queda utilizable.

---

## Cómo se usa

### Cotizar

**Cotizador** es la pantalla principal. Tres columnas: los ítems a la izquierda,
el visor y los parámetros en el medio, el precio a la derecha. Todo se recalcula
mientras escribís.

Una pieza puede entrar de dos maneras:

- **＋ Biblioteca** — elegís una de las 17 piezas paramétricas y ponés las medidas.
  El sistema genera la geometría, el desarrollo plegado, el 3D y el DXF.
- **⤒ Importar DXF** — arrastrás el archivo que te mandó el cliente y en segundos
  tenés el precio. Si el archivo trae varias piezas, las separa y las podés
  cotizar juntas o por separado.

De ahí salen, con un clic: el **PDF del presupuesto**, la **orden de trabajo**
para el taller, el **DXF de la pieza** y el **DXF del nesting**.

### La biblioteca de piezas

| Categoría | Piezas |
|---|---|
| Chapa plana | Placa, disco/brida, pletina, panel de rack 19", rejilla perforada, polígono/estrella |
| Plegado | Ángulo L, canal U, perfil Z, perfil omega, escuadra de refuerzo |
| Cajas | Bandeja/caja abierta, tapa con pestañas |
| Calderería | Desarrollo de cono truncado, virola cilíndrica, codo segmentado por gajos |
| Mecánica | Engranaje recto con perfil de involuta |

Los tres desarrollos de calderería son los que más tiempo ahorran: dibujar a mano
el sector de un cono truncado o los gajos de un codo lleva media hora y sale mal
seguido.

### Producción

Desde **Presupuestos**, el botón ⚙ pasa un trabajo aprobado a **Producción**. Ahí
queda en un tablero con seis etapas (pendiente → esperando material → corte →
plegado → terminado → entregado), con fecha de entrega y aviso en rojo si se
venció. Cuando la orden llega a "entregado", el presupuesto pasa solo a facturado.

---

## Qué hay adentro

### El tiempo de corte no se estima: se simula

Dividir el perímetro por la velocidad de tabla subestima cualquier pieza con
detalle. El sistema simula el planificador de movimiento de la máquina:

1. Descompone cada contorno en tramos con longitud y curvatura.
2. Calcula la velocidad máxima admisible en cada esquina con el modelo de
   desviación de unión, el mismo que usa un control CNC real.
3. Hace una pasada hacia atrás y otra hacia adelante (*look-ahead*) para que
   ninguna velocidad sea inalcanzable con la aceleración disponible.
4. Resuelve cada tramo con perfil trapezoidal.
5. Suma perforaciones, entradas, posicionamientos rápidos y los tiempos fijos de
   carga de chapa y setup de programa.

Resultado: una pieza con 60 agujeros chicos cotiza distinto que una placa lisa
del mismo perímetro. Que es exactamente lo que pasa en la máquina.

### El plegado se calcula con las fórmulas de tabla

```
BA (bend allowance)   = (π/180) · Aº · (Ri + K·T)
OSSB (outside setback)= tan(Aº/2) · (Ri + T)
BD (deducción)        = 2·OSSB − BA
Desarrollo            = Σ cotas exteriores − Σ BD
Fuerza al aire        = 1,33 · Rm · T² / V   [kN por metro]
```

Con eso el sistema elige la matriz V (8×T hasta 3 mm, 10×T hasta 8, 12×T arriba),
saca el radio interno (0,16×V), el ala mínima plegable (0,65×V + T) y el tonelaje
requerido. **Antes de cotizar** avisa si la pieza no entra en la plegadora, si
el ala es impleglable o si el radio va a fisurar el aluminio.

### El material se cobra por lo que se consume

El nesting (MaxRects con rotación) calcula cuántas chapas hacen falta de verdad y
qué aprovechamiento se logra. Después:

- Si el trabajo **llena** la chapa, se cobran chapas enteras.
- Si **no** la llena, se cobra el área consumida, porque el retazo vuelve al stock.

También avisa cuándo la última chapa quedó a medio usar: ofrecerle más piezas al
cliente en ese momento casi no aumenta el costo de material.

### El DXF

- **Escritura**: R12 ASCII con entidades LINE y ARC sueltas, que es lo que todos
  los CAM leen sin problemas (Cypcut, FSCut, Lantek, RDWorks, LightBurn, AutoCAD).
  Capas separadas: `CORTE`, `CORTE_INTERIOR`, `PLEGADO` (punteada, no se corta),
  `GRABADO`, `COTAS`, `TEXTO`.
- **Lectura**: LINE, CIRCLE, ARC, LWPOLYLINE con bulge, POLYLINE/VERTEX, ELLIPSE,
  SPLINE (evaluación B-spline real) y bloques INSERT anidados. Encadena los
  segmentos, detecta qué contorno está dentro de cuál, separa piezas
  independientes, convierte pulgadas a milímetros y avisa de contornos abiertos o
  agujeros más chicos que el espesor.

---

## Base de datos y librerías

Los datos viven en **SQLite** (`data/kort.db`): un solo archivo que podés copiar
a un pendrive y abrir con cualquier visor de SQLite. Se usa
[node-sqlite3-wasm](https://www.npmjs.com/package/node-sqlite3-wasm), que es el
motor completo compilado a WebAssembly: no necesita compilación nativa ni
herramientas de Visual Studio.

Qué gana el taller respecto de guardar archivos sueltos:

- **Historial de precios.** Cada cambio de precio de material queda registrado
  con fecha y con el dólar de ese día. Con la inflación argentina eso no es un
  lujo: es poder contestar "¿por qué esto salía la mitad en marzo?" y ver la
  curva. Está en **Materiales → 📈 Historial**.
- **Búsqueda real** (FTS5) sobre presupuestos, clientes y piezas.
- **Consultas de negocio.** "Cuánto facturé por material", "qué cliente deja más
  margen", "cuántos kg de inox consumí" salen en una query. Alimentan el panel.
- **Transacciones.** Un corte de luz a mitad de un guardado no rompe nada.
- **Bitácora.** Quién cambió qué y cuándo.

Si venías de la versión anterior, los `.json` se importan solos la primera vez y
quedan archivados en `data/legado/`. Se conservan tus precios y tus parámetros
calibrados; las tablas técnicas viejas se reemplazan por las nuevas por gas.

**Librerías externas** (todas servidas desde esta máquina, ninguna CDN):

| Librería | Para qué |
|---|---|
| `node-sqlite3-wasm` | La base de datos |
| `three` | Visor 3D con WebGL: buffer de profundidad, luces y sombras |
| `chart.js` | Los gráficos del panel |

El resto (motor de corte, plegado, nesting, DXF, PDF) es código propio sin
dependencias.

---

## Archivos

```
Proyecto Kort Laser/
├─ INICIAR.bat          arranque por doble clic
├─ server.js            servidor HTTP + API
├─ data/
│  ├─ kort.db             TODOS TUS DATOS
│  ├─ backups/            copia diaria del .db (últimas 30)
│  └─ legado/             los .json de la versión anterior, ya importados
├─ salidas/             PDF y DXF generados, por carpeta
├─ docs/PRECIOS.md      de dónde sale cada número, con su nivel de confianza
├─ src/core/            motor de cálculo
│  ├─ geometry.js         geometría exacta (área y bbox con arcos reales)
│  ├─ materials.js        materiales y tablas de corte POR GAS, a 3 kW
│  ├─ costos.js           estructura, tarifas EDELAR, escala UOM
│  ├─ cutting.js          simulador de tiempo de corte
│  ├─ bending.js          desarrollo, matriz V, tonelaje, validaciones
│  ├─ nesting.js          anidado rectangular y por forma real
│  ├─ pricing.js          motor de precios
│  ├─ library.js          las 17 piezas paramétricas
│  ├─ mesh3d.js           modelo 3D
│  ├─ dxf-write.js        escritor DXF
│  ├─ dxf-read.js         lector DXF
│  ├─ pdf.js              generador de PDF
│  └─ quote-pdf.js        maquetado del presupuesto y la OT
├─ src/server/db.js     esquema SQLite, migraciones y consultas
├─ web/                 interfaz
└─ tests/run.js         86 verificaciones del núcleo
```

**Respaldo**: el sistema copia el `.db` una vez por día en `data/backups`. Si vas
a cambiar de computadora, usá **Configuración → Descargar respaldo completo**:
te llevás todo, historial de precios incluido, en un solo archivo.

---

## Verificar que todo sigue bien

```bash
node tests/run.js
```

Corre 86 verificaciones sobre geometría, tiempos de corte, gases, plegado,
nesting, DXF de ida y vuelta, costos reales, precios y PDF. Deja dos muestras en
`tests/` para abrir y mirar. Si tocaste algo del núcleo, corré esto antes de
seguir usándolo para cotizar.

Entre otras cosas, los tests verifican que **no se pueda cotizar lo que la
máquina no puede cortar**: pedir inoxidable de 20 mm con una fuente de 3 kW
tiene que dar error, no un precio.

---

## Agregar una pieza nueva a la biblioteca

Todo está en `src/core/library.js`. Agregando un objeto al array `PIEZAS` se
generan solos el formulario, el 2D, el 3D, el DXF y la cotización:

```js
{
  id: 'mi-pieza',
  nombre: 'Mi pieza',
  categoria: 'Chapa plana',
  descripcion: 'Para qué sirve.',
  params: [
    P('w', 'Ancho', 200, { min: 5, unidad: 'mm' }),
    P('dia', 'Ø agujero', 10, { min: 1, unidad: 'mm' }),
  ],
  build(p, ctx) {          // ctx trae { espesor, material }
    return {
      shape: makeShape(rect(0, 0, p.w, p.w), [circle(p.w / 2, p.w / 2, p.dia / 2)]),
      modelo3D: { tipo: 'plano' },
    };
  },
}
```

---

## Problemas frecuentes

| Síntoma | Qué pasa |
|---|---|
| "El puerto 4321 ya está en uso" | El sistema ya está abierto en otra ventana. Andá a <http://localhost:4321>. |
| "No se encontró Node.js" | Instalá Node.js LTS desde nodejs.org y volvé a hacer doble clic. |
| "Falta la librería /lib/..." | Corré `npm install` una vez en la carpeta del proyecto. |
| El visor 3D queda en blanco | La PC no tiene WebGL habilitado. El plano 2D y el nesting funcionan igual. |
| El DXF del cliente da "contornos abiertos" | El dibujo tiene extremos sin unir. Se puede cotizar igual, pero avisale al cliente: el láser no cierra la pieza solo. |
| Una pieza dice "no entra en la chapa" | Excede el área de trabajo o la chapa del material. Revisá **Máquinas → Área de trabajo**. |
| "supera el máximo de X mm" | La fuente de 3 kW no llega a ese espesor con ese gas. Probá con otro gas o rechazá el trabajo: es mejor perder la venta que no poder entregarla. |
| Los tiempos dan siempre altos o bajos | Ajustá la eficiencia en **Máquinas** y las velocidades en **Materiales → ⚡**. |
| El costo por hora parece altísimo | Mirá **Costos**: si la ocupación productiva está en 40 %, la estructura se reparte entre pocas horas. Es correcto, y es el problema real a resolver. |
| El total salta a un número redondo | Se aplicó el mínimo de facturación. Se cambia en **Configuración → Política comercial**. |
