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

### ✅ 1.0b El plano del cliente entra por foto o PDF

`src/core/vectorizar.js` y `src/core/pdf-plano.js`, con el botón **Importar
plano** en el cotizador. El cliente manda una foto del plano por WhatsApp o un
PDF del CAD y sale una pieza cotizable, con su 2D, 3D, nesting y DXF. Antes eso
se redibujaba a mano: media hora por pieza.

Los dos caminos no son iguales y la interfaz lo dice:

- **PDF vectorial**: la geometría está adentro del archivo en unidades reales.
  Sale **exacta** y no hay nada que calibrar. Medido: 400,00 × 250,00 mm.
- **Imagen**: son píxeles. Hay que decir cuánto mide algo del dibujo. El
  sistema **no lo adivina**, porque adivinarlo sería cotizar una pieza que no
  es la que el cliente pidió, y eso se descubre con la chapa ya cortada.

Medido contra una placa de 400×250 con dos agujeros Ø40, en cinco condiciones
(limpio, con ruido, foto con sombra lateral, baja resolución y línea gruesa):
error menor al 2 % en las cotas y al 4 % en el área, con los dos agujeros
reconocidos como círculos en todos los casos.

Tres cosas que costaron y quedaron documentadas en CLAUDE.md porque son
trampas de verdad: Douglas-Peucker colapsa un contorno cerrado; enderezar
segmentos aplana los lados verticales si se mide `ang % 90`; y una línea
dibujada tiene grosor, así que da DOS contornos que hay que juntar en su línea
media.

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

### ✅ 1.9 La chapa de un plegado se corta en guillotina

`src/core/guillotina.js`. El desarrollo de una pieza plegada es casi siempre
**un rectángulo pelado**: un ángulo, una U, una bandeja, un peldaño. Cortar eso
con el láser es pagar amortización de fuente, gas y perforaciones para hacer
cuatro líneas rectas.

Medido con piezas de la biblioteca, sobre el costo de corte:

| Pieza | Espesor | Cant. | Proceso | Ahorro |
|---|---|---|---|---|
| Bandeja portacables sin perforar | 1,5 mm | 20 | guillotina | **$10.507 (80 %)** |
| Peldaño sin antideslizante | 3 mm | 30 | guillotina | **$13.341 (80 %)** |
| Ángulo L con agujeros | 2 mm | 50 | láser | — |
| Parante de rack ranurado | 2 mm | 20 | láser | — |

Tres reglas:

- **La decisión se toma sobre la geometría**, no sobre una bandera que alguien
  puso a mano. Si la pieza cambió y la bandera quedó vieja, se manda a la
  guillotina algo que no puede cortar.
- **En automático sólo va el desarrollo de algo que se pliega.** El canto de
  guillotina deja rebaba: adentro de un perfil no se ve, en una placa que se
  entrega tal cual, sí. Se puede forzar en los dos sentidos.
- **La capacidad baja con la resistencia del material.** Se publica en acero
  dulce; un inoxidable de Rm 620 se corta hasta bastante menos espesor.

🔴 Los números de la guillotina (`DEFAULT_GUILLOTINA`) son de referencia:
**confirmá capacidad y tiempos con la máquina que tengas.**

### ✅ 1.10 Las piezas giran en cualquier ángulo

El anidado prueba un juego fino de ángulos (paso de 15° por defecto,
configurable con `pasoAngular`) además de los ocho de 45°.

⚠️ Va como **una variante completa más** del multi-arranque y no como libertad
por pieza, y eso se midió: darle a cada pieza 24 ángulos para elegir es óptimo
pieza por pieza y **peor en conjunto** — en un trapecio entran 74 piezas contra
85 con el paso grueso, porque la colocación es golosa y la rotación que mejor
apoya a una arruina el apoyo de la que sigue.

Como variante sólo puede ayudar, porque compite contra las demás y gana la que
usa menos chapa. Medido en una pieza tipo gota: **de 2 chapas a 1**, del 35,4 %
al 70,9 % de aprovechamiento.

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

### ✅ 1.7 Anidado dentro del hueco de otra pieza

`src/core/huecos.js`. El material de adentro de un agujero grande **ya está
comprado y ya se paga**: si ahí entra una pieza chica, esa pieza sale gratis en
material. Es lo que hace el software de nesting profesional y es lo que más
ataca el desperdicio en un taller que corta bridas, tapas o anillos.

Medido con 36 bridas de 320 mm con agujero de 240 más 260 chapitas de 70×50:

| | Chapas | Aprovechamiento | Última chapa |
|---|---|---|---|
| Antes | **2** | 32,8 % | 8,2 % |
| Ahora | **1** | **65,6 %** | — |

**Una chapa de 3000×1500 ahorrada**, con 106 piezas metidas en los agujeros.

Dos decisiones que no se aflojan:

- **Nunca prometer un encaje que no existe.** El agujero se rasteriza, se
  achica el borde por la separación de corte y adentro se busca el mayor
  rectángulo inscripto. Se anida dentro de ESE rectángulo, no del contorno del
  agujero. En un agujero con forma de riñón desperdicia un poco, pero lo que
  promete entra siempre. Un anidado optimista se descubre con la máquina
  cortando y la chapa arruinada.
- **La erosión mira los ocho vecinos, no los cuatro ortogonales.** Con cuatro
  come un rombo en vez de un cuadrado y la holgura en diagonal queda un 30 %
  más corta que la pedida. Poco, pero un parámetro que no vale lo que dice no
  sirve para decidir.

Sólo mueve piezas de la ÚLTIMA chapa: es la única que se puede llegar a
evitar, y tocar las demás sería reacomodar un anidado que ya está bien.

### 📋 1.8 Anidar también los agujeros grandes

Una brida de Ø400 con agujero central de Ø250 deja adentro un disco de material
que hoy se tira. Si el agujero es más grande que la pieza más chica del
presupuesto, se podría cortar ahí adentro.

**Esfuerzo:** medio, y depende de 1.7.

---

## Fase 2 — Que el sistema aprenda de la producción

### ✅ 2.1 Tiempo real vs estimado

`src/core/calibracion.js`. Al marcar una orden como terminada, el taller carga
cuánto tardó de verdad. Con eso sale un factor de corrección que el cotizador
aplica, y que se puede ver en el desglose del precio.

Cuatro decisiones que hacen que sirva en un taller y no sólo en teoría:

- **Mediana, no promedio.** Un trabajo donde el operario paró a almorzar con el
  cronómetro corriendo arrastra el promedio y no mueve la mediana.
- **No corrige nada hasta tener 5 trabajos.** Con tres mediciones no hay un
  factor, hay ruido, y corregir con ruido da confianza falsa.
- **Lo imposible se descarta y se cuenta.** Un ratio de 200 es alguien que
  escribió minutos donde iban horas. Se saca, pero se informa: si se descarta
  la mitad de lo cargado, el problema es cómo se está midiendo.
- **Nunca corrige en silencio.** El resultado dice de dónde salió el factor y
  con cuántos trabajos.

Es el paso que convierte al sistema en algo que mejora solo.

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

### ✅ 2.2 Stock de retazos

Hecho el 2026-08-14. `listaDeCompra()` sigue informando el retazo que queda en
cada programa, y ahora el stock persistente permite darlo de alta, editarlo,
seleccionarlo y buscar candidatos por material, espesor y rectángulo envolvente.
El cotizador puede seleccionar un retazo compatible y calcula el material por
el área consumida, sin compartirlo automáticamente con otro programa. Al
aprobar la orden, la API reserva por orden y cantidad dentro de una transacción
SQLite idempotente; una chapa de varias unidades puede reservar sólo las que
necesita ese trabajo. Al pasar la OT a `corte`, esas unidades se consumen y el
sobrante queda trazable; cancelar o borrar una OT libera sólo la reserva propia.

El ABM vive en `Stock de chapa`, con ubicación, lote, estado, cantidad, peso y
valor de referencia. La preselección es conservadora: el nesting sigue siendo
la autoridad final para la geometría real. La búsqueda también exige que la
cantidad del registro alcance la cantidad pedida, para no prometer producción
en un sobrante que sólo alcanza para una unidad.

**Esfuerzo:** medio-alto.

### 📋 2.3 Stock de chapa y punto de reposición

Saber cuánta chapa hay de cada material y espesor, descontar al producir y
avisar cuándo reponer. Con el historial de consumo que ya guarda la base y la
lista de compra que ya sale de cada presupuesto, puede sugerir la orden.

**Esfuerzo:** medio.

---

## Fase 3 — Lo comercial

### ✅ 3.1 Enviar el presupuesto sin salir del sistema

`src/core/envio.js` + los botones **WhatsApp** y **Mail** en el cotizador.
Generan el PDF, arman el mensaje con el total y las condiciones, y abren la
conversación con el texto escrito.

El adjunto lo pone la persona: ni WhatsApp Web ni `mailto:` aceptan archivos
por URL, y la alternativa sería exponer la máquina del taller a internet. Por
eso el PDF se descarga ANTES de abrir el chat — cuando aparece la ventana, el
archivo ya está en Descargas listo para arrastrar.

La parte que parecía trivial y no lo era: **normalizar el teléfono argentino.**
Un celular se marca `0380 15 4123456` pero WhatsApp lo quiere como
`5493804123456` — sin el 0, sin el 15 y con un 9 después del 54. Con el 15
puesto, el enlace abre un chat con un número que no existe y el mensaje se
pierde sin que nadie se entere, que es peor que fallar. Hay nueve casos de
prueba, incluido el área de 4 dígitos y un número brasileño que no se toca.

El mensaje sigue la misma regla que el PDF: ni costo, ni margen, ni tiempo de
máquina, ni chapas. Un test lo verifica.

### ✅ 3.2 Actualización de precios desde lista del proveedor

Hecho el 2026-08-14. Materiales tiene **Importar lista**: se puede subir o pegar
un CSV exportado desde Excel, con columnas flexibles (`código`, `material`,
`descripción`, `$/kg`, `precio`). Reconoce formatos argentinos como `18.600` y
`3.850,50`, matchea por id o nombre, muestra vista previa de variación y lista
las filas ignoradas para que nada cambie en silencio.

Los cambios quedan preparados sobre la copia de trabajo y recién impactan al
tocar **Guardar cambios**, usando el mismo endpoint que ya registra el historial
de precios. No hay camino paralelo.

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

### ✅ 4.2 Catálogo de 362 piezas

**32 familias** parametrizadas para diseñar, y **330 medidas normalizadas**
listas para cotizar sin tocar un parámetro. En el mostrador nadie piensa en
parámetros: piensa en *"una brida DN100"* o *"una abrazadera para caño de 2
pulgadas"*.

| Grupo | Entradas | Fuente de las medidas |
|---|---|---|
| Chapa plana | 62 | discos, arandelas, tapas, pletinas, anillos |
| Decoración | 58 | 12 motivos × 4 formatos, más polígonos |
| Estanterías | 35 | parantes, estantes, ménsulas, largueros |
| Calderería | 30 | reducciones, virolas, codos de conducto |
| Perfiles | 29 | ángulos, U, Z y sombrero de obra |
| Bridas | 28 | 🟢 DIN 2576 / EN 1092-1 PN10 |
| Mecánica | 27 | piñones de cadena y engranajes módulo 2 |
| Estructura | 20 | cartelas, placas base, escuadras |
| Cañerías | 11 | 🟢 ASTM A53, diámetro exterior real |
| Electricidad | 8 | 🟢 bandejas IEC 61537 |
| Rack 19″ | 6 | 🟢 EIA-310, 1U = 44,45 mm |

**Por qué no son 300 `build()` escritos a mano.** Serían 300 formas de
equivocarse: una familia parametrizada se prueba una vez y anda para todas sus
medidas, mientras que trescientas funciones sueltas hay que probarlas de a una
y las que nadie usa se pudren en silencio hasta que alguien las elige. Un
catálogo hecho de familias verificadas es más grande **y** más confiable.

Hay un test que **construye las 330 medidas** y falla si una sola no da una
pieza con área. Ya atajó dos: un disco de Ø50 que salía con un agujero de Ø80
—área negativa— y un piñón de 11 dientes donde el cubo se come el disco. El
segundo no era un error del código sino un límite geométrico real: la tabla
arranca en 13 dientes.

### ✅ 4.4 Paneles decorativos

`src/core/decorativo.js`. El cliente trae una idea y una medida —"una celosía
de 1200 × 2400"— y el sistema reparte el motivo: **12 motivos** (círculo,
rombo, hexágono, gota, hoja, flor, estrella, cruz, onda…) en grilla, tresbolillo
o rombo, con márgenes iguales y sin ningún motivo cortado al borde.

Lo que hace que un panel se arruine no es el dibujo, es el **ligamento**: el
material entre dos calados. Si es muy chico, el calor de los dos cortes vecinos
se suma, se ablanda y la chapa sale ondulada — y no hay forma de enderezarla.
La regla es **2 × espesor y nunca menos de 1,5 mm**; si se pide menos, se sube
y se avisa.

También informa el **porcentaje de calado**, medido con el área exacta de cada
motivo y no con su rectángulo envolvente: una ranura llena menos de la mitad de
su caja, y con la envolvente un panel al 38 % se informaba al 60 %. Arriba del
40 % la chapa pierde rigidez de verdad, y eso decide si sirve para una celosía
o para una tapa que tiene que sostener algo.

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

## Usuarios y permisos: por qué NO

Se evaluó armar una base de usuarios con login. **La conclusión es que hoy no
corresponde, y conviene dejar escrito el porqué para no volver a discutirlo.**

El sistema corre en **una máquina del taller**, servido desde Express en
`localhost`, y puede estar sin internet. Quien se sienta ahí ya tiene el
archivo `data/kort.db` a mano: un login no protege nada que el acceso físico
no entregue igual. Lo único que agrega es fricción diaria — y una contraseña
que se pide todas las mañanas termina en un papel pegado al monitor, que es
peor que no tenerla.

Pedir usuarios sin necesitarlos también cuesta: hay que mantener altas, bajas,
recuperación de contraseña y permisos por vista, y nada de eso mueve un peso.

**Lo que sí hace falta de todo eso es saber quién tocó qué**, y para eso no
hacen falta contraseñas:

### ✅ U.1 Firma en la bitácora

Hecho el 2026-08-14. La tabla `bitacora` tiene columna `operario`, el servidor
toma `X-KORT-Operario` en cada escritura y la barra superior tiene un selector
simple de firma. La interfaz anterior lo comparte por `localStorage`, así que
también firma cuando se abre una vista legacy aparte.

El panel muestra la bitácora reciente con fecha, entidad, detalle y operario.
No es login ni reemplaza permisos: es trazabilidad operativa para responder
*quién cambió este precio* o *quién cargó este tiempo real* sin fricción.

### 💭 U.2 Login de verdad

Recién tiene sentido si pasa alguna de estas tres cosas:

1. El sistema se publica fuera de la red del taller (ahí es obligatorio, y
   antes hay que revisar toda la superficie de la API).
2. Entra alguien que no debe ver precios de costo ni márgenes — un pasante, un
   cliente mirando el avance de su trabajo.
3. Hace falta responder legalmente por quién aprobó un presupuesto.

Mientras sean Santiago y un operario en la misma máquina, no.

---

## Fase 5 — Producción y taller

Lo que sigue apunta al otro lado del negocio: hoy el sistema cotiza muy bien y
acompaña poco al que está parado frente a la máquina.

### ✅ 5.1 Micro-uniones y orden de corte seguro

Dos problemas de producción que hoy no se modelan y se pagan en chapa:

- Las piezas chicas **se caen entre los travesaños** de la mesa y se pierden o
  se rayan. La solución estándar son micro-uniones: dejar 0,3-0,5 mm sin
  cortar en dos o tres puntos del contorno.
- Una pieza que se suelta antes de tiempo **se levanta y golpea el cabezal**.
  Eso es una boquilla rota y, si hay mala suerte, la lente.

✅ **Micro-uniones hechas.** El ítem tiene modo automático / forzado / apagado.
En automático sólo actúa sobre piezas chicas o livianas; el DXF de producción
sale con los cortes interrumpidos y el presupuesto suma el repaso manual. No se
descuenta el milímetro sin cortar del tiempo de láser: es despreciable y es más
conservador cobrarlo como si se cortara.

Hecho el 2026-08-14. El DXF ya sale con orden de corte seguro: primero
interiores, después exteriores, y las piezas contenidas dentro de agujeros se
cortan antes de abrir el agujero que las rodea. En empates se prioriza de
arriba hacia abajo para reducir pasadas del cabezal sobre chapa ya liberada.

Esto vive en `src/core/dxf-write.js`, así aplica tanto al DXF de pieza como al
DXF de nesting y a cualquier desarrollo futuro que use el escritor común.

### ✅ 5.2 Etiquetas de pieza para el taller

Hecho el 2026-08-14. El cotizador genera un PDF de etiquetas de 90 × 55 mm,
una por ítem, con OT, cliente, material, espesor, cantidad, medida, entrega,
código de control y URL preparada para la ficha de la orden. Se guardan en
`salidas/etiquetas` además de descargarse.

El código visual de control sirve para no mezclar paquetes en el taller aunque
la etiqueta se imprima chica o se manche. Cuando Producción tenga ficha
individual navegable, se puede cambiar ese bloque por QR estándar sin tocar los
datos de la etiqueta.

### ✅ 5.3 Carga de la máquina y fecha de entrega realista

Hecho el 2026-08-14. `src/core/agenda.js` suma la carga pendiente de las órdenes
abiertas, calcula la capacidad diaria desde `estructura.horasPorDia ×
ocupacionProductiva`, saltea fines de semana y marca qué fecha es prometible
para cada OT. Las órdenes urgentes entran primero y una OT queda en riesgo si la
fecha comprometida no entra en la cola real.

El panel muestra horas comprometidas, capacidad real y fecha libre. Producción
agrega una banda de carga y cada tarjeta muestra fecha prometible y horas
restantes. Ya no se promete "7 días" por costumbre: se ve la cola.

### ✅ 5.4 Aviso de consumibles por horas de arco

Hecho el 2026-08-14. El panel cruza las órdenes terminadas con la vida útil de
`consumibles.js` y muestra estado preventivo por horas medidas: boquilla, lente
protectora, cerámica, filtros, lente de enfoque y varios. Marca vencido desde
100 % de vida y por vencer desde 80 %.

Si todavía no se cargó la fecha del último cambio, usa todo el historial medido
y lo dice explícitamente. El panel ahora permite marcar el cambio realizado
hoy por consumible; la fecha queda en `produccion.consumiblesUltimoCambio` y
las horas se recalculan desde ese hito, sin alterar el historial de órdenes.


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
| ✅ | Materiales | Tabla, tablas de corte por gas, historial y actualización masiva |
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
| ✅ | ~~Node 21.7 no es LTS y BLOQUEA el build~~ | Resuelto: la máquina está en **Node 24 LTS**. El build exige ≥ 22.12 porque Vite 8 va sobre rolldown; el núcleo y los tests corren en cualquier Node |
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
