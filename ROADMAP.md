# Roadmap

Ordenado por **plata que mueve**, no por dificultad. Cada punto dice qué
problema real resuelve y cuánto cuesta hacerlo.

Estado: ✅ hecho · 🔜 siguiente · 📋 planeado · 💭 idea

---

## Paso 0 — Antes de cualquier código

**Nada de lo que sigue vale tanto como esto.** El sistema calcula bien; los
datos de entrada todavía son de referencia.

| Qué | Dónde | Por qué |
|---|---|---|
| Cargar tus gastos fijos reales | Costos | Son el 60 % del costo por hora |
| Verificar la potencia contratada en la factura | Costos → Energía | Si tenés de más, son ~$110.000/mes tirados |
| Pedir cotización de gases, sobre todo N₂ | Configuración → Gases | Es el número más incierto del sistema |
| Preguntarle al contador tu alícuota de IIBB | Configuración | La Rioja tiene exenciones industriales: son 3 puntos |
| Cronometrar 2-3 espesores | Materiales → ⚡ | Convierte la estimación en cálculo |

Después de esto, el cotizador deja de estimar y empieza a calcular. Recién ahí
tiene sentido agregarle funciones.

---

## Fase 1 — Precisión de lo que ya existe

### ✅ 1.1 Nesting por presupuesto, no por ítem

**Era la limitación más importante que tenía el sistema. Ya está hecho.**

Los ítems se agrupan por (material, espesor, gas, chapa) y se anidan juntos en
`planificarNesting()`. Lo que le toca a cada uno —chapas, material y setup— se
reparte **por el área que ocupa en el layout real**, no por cantidad de piezas:
una pieza grande consume más chapa y la paga.

Medido con el mismo caso de antes (tres placas de acero de 3 mm: 600×400,
500×300 y 400×250, cuatro de cada una, sobre chapa de 2440×1220):

| | Chapas | Aprovechamiento | Setup + carga | Costo |
|---|---|---|---|---|
| Antes (ítem por ítem) | **3** | 32 % / 20 % / 13 % | 13,5 min | $199.662 |
| Ahora (agrupado) | **1** | **65,8 %** | **4,5 min** | **$194.566** |

El 65,8 % es el techo teórico de ese lote: 1.960.000 mm² de piezas sobre una
chapa de 2.976.800 mm². El motor llega al máximo posible.

El ahorro es de $5.096, un 2,6 %. Coincide con lo que estimaba este documento
("9 minutos de máquina de más ≈ $5.100"), y viene del setup y la carga de
chapa, no del material — el modo automático ya cobraba por área consumida.

Lo que además se arregló y no era de plata: el **número de chapas** ahora sirve
para comprar material, y el **aprovechamiento** dejó de estar subestimado, que
es el número que dice si conviene ofrecerle más piezas al cliente.

Cubierto por 12 tests en `tests/run.js` → "Nesting por presupuesto", incluyendo
que un ítem solo se cotiza exactamente igual que antes del cambio.

**De yapa: "¿Qué más entra?"** (`rellenoSinCosto()` + botón en el visor de
nesting). Dice cuántas unidades más de cada pieza entran en esa chapa sin que
haya que comprar otra. El material ya está pagado, así que esas piezas sólo
cuestan tiempo de máquina y gas: es la oferta con mejor margen que puede hacer
el taller, y sirve para vender repuestos en la misma entrega o hacer stock.

Se calcula **a pedido y no con cada tecla**: cada tanteo es un nesting
completo. La búsqueda es por duplicación y después binaria (≈2·log n tanteos
por ítem en vez de n).

⚠️ **Distinto gas es distinto programa y distinta boquilla**, así que no
comparten chapa aunque el material y el espesor coincidan. Lo mismo si la
chapa estándar difiere. Y si el motor no logra colocar todas las piezas del
grupo, se cae a cotizar por ítem: un número conservador y verificable es mejor
que uno optimista que no se puede cortar.

### 📋 1.2 Corte en línea común

Dos piezas rectangulares pegadas comparten el corte del medio: se corta una vez
en vez de dos. En un nesting de piezas rectangulares ahorra entre 15 % y 30 %
de longitud de corte, y con eso tiempo, gas y consumibles.

Requiere detectar bordes rectos colineales y adyacentes en el layout, y
descontar esa longitud del cálculo. Va después de 1.1 porque necesita el
nesting conjunto para tener sentido.

**Esfuerzo:** medio-alto.

### 📋 1.3 Micro-uniones y puentes

Las piezas chicas se caen a la parrilla y se pierden o se marcan. En la máquina
se resuelve dejando micro-uniones de 0,3-0,5 mm sin cortar.

Falta: parámetro por pieza, generarlas en el DXF, y sumar al presupuesto el
tiempo de desbarbar esa unión. Hoy el sistema no las modela, así que subestima
levemente el trabajo de piezas chicas.

**Esfuerzo:** bajo-medio.

### 📋 1.4 Entradas en arco para agujeros chicos

En agujeros de diámetro chico, una entrada recta deja una marca en el canto. Se
usa entrada en arco tangente. Cambia el tiempo y la calidad; hoy se modela una
sola entrada recta para todo.

**Esfuerzo:** bajo.

---

## Fase 2 — Que el sistema aprenda de la producción

### 🔜 2.1 Tiempo real vs estimado

Cargar en la orden de trabajo cuánto tardó de verdad y compararlo con lo
estimado. Con 20 o 30 trabajos cargados, el sistema puede sugerir el ajuste de
eficiencia y de velocidades **con tus datos**, en vez de que lo calibres a mano.

Es el paso que convierte al sistema en algo que mejora solo. La base ya guarda
todo lo necesario; falta el campo, la pantalla y el análisis.

**Esfuerzo:** medio. **Alto valor a mediano plazo.**

### 📋 2.2 Stock de retazos

El nesting ya calcula cuánto retazo útil queda en cada chapa. Falta darlo de
alta como stock y poder anidar sobre un retazo existente en vez de sobre chapa
nueva.

En un taller chico esto es plata directa: los retazos hoy se apilan y se
oxidan. Requiere ABM de retazos y que el cotizador los ofrezca cuando la pieza
entra.

**Esfuerzo:** medio-alto.

### 📋 2.3 Stock de chapa y punto de reposición

Saber cuánta chapa hay de cada material y espesor, descontar al producir y
avisar cuándo reponer. Con el historial de consumo que ya guarda la base, puede
sugerir la compra.

**Esfuerzo:** medio.

---

## Fase 3 — Lo comercial

### 🔜 3.1 Enviar el presupuesto sin salir del sistema

Hoy generás el PDF y lo mandás a mano. Falta el botón que abra WhatsApp Web con
el mensaje y el PDF, o que mande el mail.

Es de lo más barato de hacer y de lo que más tiempo ahorra por día.

**Esfuerzo:** bajo.

### 📋 3.2 Actualización de precios desde lista del proveedor

Importar el Excel o CSV que manda el proveedor y actualizar los precios de una.
Con la inflación argentina esto pasa todos los meses y hoy es carga manual.

El historial de precios ya está: sólo falta la importación.

**Esfuerzo:** bajo-medio.

### 📋 3.3 Seguimiento de presupuestos

Avisar cuáles están por vencer, cuáles no tuvieron respuesta en X días, y
permitir reajustar por inflación con un clic (recalcular con los precios de hoy
manteniendo la geometría).

Con validez de 10 días y esta inflación, un presupuesto viejo aprobado tarde es
un trabajo a pérdida.

**Esfuerzo:** bajo-medio.

### 💭 3.4 Factura electrónica (ARCA/AFIP)

Emitir la factura desde el sistema cuando la orden se entrega. Requiere
certificado digital y el web service de ARCA. Es trabajo real pero elimina la
doble carga.

**Esfuerzo:** alto. Evaluarlo cuando el volumen lo justifique.

---

## Fase 4 — Alcance técnico

### 📋 4.1 Importar STEP y DWG

Hoy entra DXF. Los clientes con SolidWorks mandan STEP; los de AutoCAD viejo,
DWG. Cada formato que no leés es una cotización que hacés a mano o que perdés.

STEP requiere parsear geometría 3D y desplegar la chapa: es el más difícil y el
más valioso. DWG necesita una librería de terceros.

**Esfuerzo:** alto.

### 📋 4.2 Más piezas paramétricas

Las 17 actuales cubren lo habitual. Faltan, por orden de pedido probable:
transición cuadrado-redondo, tolva piramidal, bandeja portacables, escalera de
cable, tapa de tanque con boca de hombre, pie de columna con cartelas.

Cada una es un objeto en `library.js`: el formulario, el 2D, el 3D, el DXF y la
cotización salen solos.

**Esfuerzo:** bajo por pieza. Buen punto de entrada para agregar de a poco.

### 💭 4.3 Generación de código G

Hoy el sistema entrega DXF y el CAM de la máquina hace el resto. Generar
directamente el programa de la máquina saltearía un paso, pero acopla el
sistema a un control específico y el riesgo de un error es alto (choques,
piezas arruinadas). **No hacerlo salvo que haya una razón fuerte.**

### 💭 4.4 Acceso desde el celular en el taller

La interfaz es responsive pero está pensada para escritorio. Una vista reducida
para el celular —ver la orden, marcar avance, sacar la foto del trabajo
terminado— tendría sentido cuando haya más de una persona produciendo.

**Esfuerzo:** medio.

---

## Migración de la interfaz

La interfaz pasó a React + Vite + Tailwind + Radix, con Recharts para los
gráficos, Konva para el 2D y react-three-fiber para el 3D. El backend pasó a
Express + Helmet + Zod. **`src/core/` no se tocó**: sigue siendo ESM sin
dependencias y los 96 tests pasan igual.

Se migró de a una vista para no quedarse con medio sistema andando. Las que
faltan siguen funcionando embebidas desde `/legacy` (ver CLAUDE.md).

| | Vista | Qué falta |
|---|---|---|
| ✅ | Panel | — |
| ✅ | Cotizador | — |
| 🔜 | Materiales | La más grande (361 líneas) y la que más se toca |
| 📋 | Costos | Tiene gráficos propios: pasarlos a Recharts |
| 📋 | Presupuestos · Producción · Clientes | Listados; salen rápido y parecidos entre sí |
| 📋 | Máquinas · Configuración | Formularios largos, poco riesgo |

Al terminar: borrar `web/`, la excepción de CSP de `/legacy` en `server.js` y
el prefijo `--k-` de las variables CSS, que existe sólo para convivir.

---

## Deuda técnica

| | Qué | Riesgo |
|---|---|---|
| ✅ | ~~`cotizador.js` tiene 1.100 líneas y hace demasiado~~ | Partido en `app/src/vistas/cotizador/` |
| 📋 | No hay tests de la interfaz, sólo del núcleo | Medio: una vista puede romperse sin que nadie se entere. Ahora que hay React conviene Vitest + Testing Library |
| 📋 | El bundle son ~2,3 MB (620 kB gzip) en 4 trozos | Bajo: se sirve desde localhost, no por red |
| 💭 | Node 21.7 no es LTS y ya bloqueó `better-sqlite3` | Bajo hoy; pasar a Node 22 LTS cuando convenga |
| 💭 | El nesting por skyline no mete piezas en "cuevas" | Bajo: da del lado seguro, nunca promete un encastre falso |

---

## Cómo se decide qué sigue

La pregunta para cualquier función nueva es **¿cuánta plata mueve por mes?**

- Cotizar más rápido: ahorra tiempo tuyo, que es real pero acotado.
- Cotizar más preciso: evita trabajos a pérdida, que es lo que funde talleres.
- Ahorrar material: el material es el 60-90 % del costo. **Acá está la plata.**
- Ahorrar tiempo de máquina: importa cuando la máquina es el cuello de botella;
  hoy, con la ocupación en 60 %, no lo es.

Por eso el orden: primero que el nesting diga la verdad (1.1), después que
aprenda de la producción (2.1), después el retazo (2.2). Lo vistoso —STEP,
código G, app móvil— va último a propósito.
