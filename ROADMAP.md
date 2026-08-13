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
| **Revisar tu tarifa de $90.000/m²** | Tarifario | Con 4 mm o más **estás trabajando a pérdida**: ver abajo |

Después de esto, el cotizador deja de estimar y empieza a calcular. Recién ahí
tiene sentido agregarle funciones.

---

## Lo primero: tus precios

Hoy se cobra de dos formas y las dos están medidas contra el costo real:

### Por kilo — $3.800/kg de chapa lisa cortada ⛔

**No cubre el costo en ningún espesor.** Los 56 casos dan negativo, del −6 % en
6 mm simple al −326 % en chapa perforada gruesa.

La razón no es el corte, es el recorte: con 77 % de aprovechamiento, la chapa
de $2.950/kg se convierte en **$3.869 por kilo entregado antes de encender la
máquina**. Se está vendiendo por debajo del material.

| Para trabajos | Piso | Sugerido (45 %) |
|---|---|---|
| Simples (chapa lisa cortada) | $4.500/kg | **$6.500/kg** |
| Medios | $5.000/kg | $8.500/kg |
| Complejos | $6.500/kg | $12.500/kg |
| Perforados | $10.500/kg | $24.500/kg |

**La buena noticia: cobrar por kilo es la mejor base.** Varía sólo 1,08× entre
0,9 y 20 mm, contra 20× del $/m². Una tarifa única por kilo es sostenible; una
por m² no lo es.

### Por m² — $90.000/m² en 1,2 mm ⚠

Cierra bien en chapa fina (52 % en 1,2 mm) y **se rompe con el espesor**: a
partir de 3 mm se trabaja a pérdida. Techo real: 1,5 mm en trabajos simples,
1,2 mm en complejos.

### Antes de mover un precio

Todo esto depende de que la chapa cueste **$2.950/kg**, que es un valor de
referencia y no una factura. La vista *Tarifario* tiene las dos palancas:

| Si la chapa sale | Utilidad con $3.800/kg |
|---|---|
| $2.050/kg | ⚠ 20 % |
| $2.500/kg | ⚠ 5 % |
| **$2.950/kg** | **⛔ −11 %** |
| $3.400/kg | ⛔ −26 % |

| Con aprovechamiento | Utilidad con $3.800/kg |
|---|---|
| 70 % | ⛔ −20 % |
| **78 %** | **⛔ −9 %** |
| 90 % | ⚠ 5 % |
| 95 % | ⚠ 9 % |

Ni comprando muy barato ni aprovechando al 95 % los $3.800 llegan a un margen
sano. **Cargá tu precio real de chapa en Materiales y volvé a mirar la tabla
antes de decidir.**

---

## Fase 1 — Precisión de lo que ya existe

### ✅ 1.0 Cada precio muestra de dónde sale

`src/core/explicacion.js`. El cotizador y el tarifario abren la cuenta completa
al lado del número: la geometría medida, el kilo de chapa, la velocidad de
tabla contra la velocidad media real, el desglose de la hora de máquina, el
gas con sus alternativas, y después la cadena costo → margen → descuento →
IIBB → precio.

Dos razones, y la segunda es la que importa:

1. Un precio sin explicación no se puede defender en el mostrador.
2. **Un precio sin explicación no se puede corregir.** Cuando un dato mal
   cargado multiplica todo —ya pasó, con consumibles a $150.000/h— la única
   forma de encontrarlo es ver de dónde salió el número.

El módulo **no calcula nada**: lee el resultado ya cotizado y lo narra. Si
tuviera cuentas propias, tarde o temprano diría algo distinto de lo que se
cobra, que es justo lo que tiene que evitar. Un test verifica que los bloques
sumen exactamente el costo total.

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

### ✅ 1.1b El DXF del cliente ya no se parte solo

Un dibujo con varios contornos exteriores sueltos **se importa como una sola
pieza**, con las posiciones que dibujó el cliente. Antes se partía de oficio en
N piezas independientes, y eso rompe el diseño de un cartel o de un juego que
se entrega armado — además de cotizar mal en silencio, porque cada parte pasaba
a anidarse por su cuenta en otra posición.

Separar sigue estando, pero como decisión explícita: en el importador hay un
"¿En realidad son N piezas sueltas?" que muestra las tarjetas una por una.

Para eso el modelo de pieza pasó a admitir **varias partes** (`shape.partes`).
Área, longitud de corte, perforaciones, caja envolvente, recorrido, DXF de
salida, 3D y los dos visores suman todas las partes. Un recuadro con contenido
sigue siendo una pieza con agujeros, como antes.

Verificado con dos rectángulos sueltos (200×100 y 150×100 separados 100 mm):
mide 450×100 mm, 1,10 m de corte, 2 perforaciones y 0,550 kg — los tres a mano
dan lo mismo. 8 tests nuevos.

⚠️ En el nesting una pieza multiparte va por su **rectángulo envolvente**: las
partes viajan juntas, así que usar el contorno de una prometería un encastre
que en la chapa no existe.

### ✅ 1.5 El anidado rota y acomoda las piezas

Antes probaba sólo 0/90/180/270. Ahora prueba además 45° y **el giro que deja a
la pieza en su rectángulo envolvente más chico** (envolvente convexa + teorema
del rectángulo mínimo), y en vez de bajar la pieza a lo bruto puntúa la altura
y el hueco que deja atrapado debajo, así se mete en las concavidades.

| Pieza | Antes | Ahora |
|---|---|---|
| Triángulo 240×200 | 73 por chapa | **92** (+26 %) |
| Escuadra 220×220 | 87 | **92** (+6 %) |
| Perfil L, trapecio, disco, placa | — | igual |

**+4,1 % de piezas por chapa y ningún caso peor**, porque el multi-arranque
incluye siempre la variante conservadora: si girar no ayuda, gana la de antes.

### ✅ 1.6 Diseñador gráfico de plegado

Vista propia (`/plegado`) para armar piezas plegadas dibujando la sección
transversal tramo por tramo. De ahí salen juntos y coherentes el desarrollo, las
líneas de plegado, el 3D, el tonelaje, los avisos de fabricabilidad y el orden
en que hay que plegar. Incluye 7 plantillas (L, U, Z, omega, cajón, goterón,
canto rebatido), todas verificadas como plegables de verdad.

Detecta lo que arruina una pieza en la plegadora: alas por debajo del mínimo,
piezas más largas que la máquina y **tramos que se cruzan al cerrarse**.

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

### 📋 1.7 Anidado dentro del hueco de otra pieza

El anidado por perfil no mete piezas en las "cuevas": si una pieza en U deja un
hueco cerrado adentro, ahí no entra nada aunque quepa. Para piezas grandes con
recortes internos (bridas, marcos) eso es material tirado.

Requiere pasar del perfil por columna a una malla de ocupación real. Es el
salto grande del anidado y el que más material queda por ganar.

**Esfuerzo:** alto.

### 📋 1.8 Anidar también los agujeros grandes

Una brida de Ø400 con agujero central de Ø250 deja adentro un disco de material
que hoy se tira. Si el agujero es más grande que la pieza más chica del
presupuesto, se podría cortar ahí adentro.

**Esfuerzo:** medio, y depende de 1.7.

---

## Fase 2 — Que el sistema aprenda de la producción

### 🔜 2.1 Tiempo real vs estimado

Cargar en la orden de trabajo cuánto tardó de verdad y compararlo con lo
estimado. Con 20 o 30 trabajos cargados, el sistema puede sugerir el ajuste de
eficiencia y de velocidades **con tus datos**, en vez de que lo calibres a mano.

Es el paso que convierte al sistema en algo que mejora solo. La base ya guarda
todo lo necesario; falta el campo, la pantalla y el análisis.

**Esfuerzo:** medio. **Alto valor a mediano plazo.**

### ✅ 2.0 Lista de compra de material

`src/core/compras.js`. Del presupuesto salen las chapas a comprar: cuántas de
cada material y espesor, cuánto pesan, cuánto salen y qué retazo queda. Se ve
en el cotizador, va al pie de la orden de trabajo (nunca al presupuesto del
cliente) y se copia como pedido para mandarle al proveedor.

El paso de "el cliente aprobó" a "voy a comprar" se hacía a mano con
calculadora. Comprar de menos para la máquina a mitad de trabajo; comprar de
más deja el capital en el depósito.

Dos decisiones que importan:

- **Las chapas se cuentan una vez por grupo**, igual que en el nesting por
  presupuesto. Sumar las fracciones de cada ítem daría casi lo mismo, pero
  este número se usa para comprar.
- **La relación material/venta se mide contra lo CONSUMIDO**, no contra las
  chapas enteras. Una pieza suelta que sale de un retazo daba 2.685 % y el
  número dejaba de servir para lo único que sirve: saber si el anticipo
  alcanza para comprar la chapa. Cuando el trabajo usa menos del 35 % de una
  chapa, en vez de mandar a comprar manda al retazero.

### 📋 2.2 Stock de retazos

Ya está la mitad: `listaDeCompra()` informa el retazo que queda en cada
programa, en m², en kilos y en pesos. Falta darlo de alta como stock y poder
anidar sobre un retazo existente en vez de sobre chapa nueva.

En un taller chico esto es plata directa: los retazos hoy se apilan y se
oxidan. Requiere ABM de retazos y que el cotizador los ofrezca cuando la pieza
entra.

**Esfuerzo:** medio-alto.

### 📋 2.3 Stock de chapa y punto de reposición

Saber cuánta chapa hay de cada material y espesor, descontar al producir y
avisar cuándo reponer. Con el historial de consumo que ya guarda la base y la
lista de compra que ya sale de cada presupuesto, puede sugerir la orden.

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

**31 piezas.** Las últimas seis son la familia de estantería y racks —parante
ranurado, estante, ménsula de pared, larguero perfil C— más el peldaño
antideslizante y la abrazadera para caño, que son de los trabajos que más se
repiten.

Faltan, por orden de pedido probable: escalera de cable, tapa de tanque con
boca de hombre, pie de columna con cartelas, guardacadena, puerta de tablero.

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
| 🔜 | **Node 21.7 no es LTS y ahora BLOQUEA el build** | **Alto**: Vite 8 usa rolldown, que necesita Node ≥ 22.12. En esta máquina `npm run build` no corre. Ya había bloqueado `better-sqlite3`. Instalar Node 22 LTS lo resuelve todo junto |
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
