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
npm test           # 293 verificaciones del núcleo (ejecutado 2026-08-14)
```

En Windows, `INICIAR.bat` hace todo con doble clic: instala si falta, compila
la interfaz si falta y arranca.

⚠️ **`npm start` NO compila.** Si tocaste algo de `app/` y no ves el cambio,
falta el `npm run build`. Para trabajar, `npm run dev` y listo.

⛔ **El build exige Node ≥ 22.12.** Vite 8 usa rolldown, que llama a
`util.styleText` con un arreglo: una API que no existe antes de Node 22. No hay
parche — instalar el binario nativo a mano deja pasar el primer error y falla
en el siguiente. La máquina de Santiago ya está en **Node 24 LTS**; si aparece
otra con Node 21, actualizarla es el arreglo (esa versión tampoco es LTS y ya
había bloqueado `better-sqlite3`).

**El núcleo y los tests corren en cualquier Node.** Sólo el build de la
interfaz necesita 22.

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
  Node y en el navegador, y lo que permite que las 293 verificaciones corran sin
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
              app/src/componentes/visores/  2D (Konva), 3D (r3f), nesting,
                                            sección de perfil plegado
              app/src/vistas/           Panel, Cotizador, Plegado,
                                        Tarifario y Materiales
web/          Interfaz anterior: vanilla JS. Sigue viva 1 vista (Clientes).
web-dist/     Salida de `npm run build`. No se commitea.
server.js     Express + Helmet + Zod.
tests/run.js  Suite completa. Un solo archivo, sin runner externo.
docs/PRECIOS.md  De dónde sale cada número, con nivel de confianza.
```

Tres módulos del núcleo **no calculan nada nuevo, leen lo ya calculado**:

- `explicacion.js` — arma la derivación paso a paso de un precio (`explicarItem`)
  o de una tarifa (`explicarTarifa`) para mostrarla al lado del número.
- `compras.js` — de un presupuesto cotizado saca qué chapa hay que comprar
  (`listaDeCompra`) y el pedido para el proveedor (`pedidoEnTexto`).
- `envio.js` — arma el mensaje y el enlace para mandarle el presupuesto al
  cliente por WhatsApp o por mail.

Y cuatro que generan o traen geometría:

- `decorativo.js` — reparte un motivo sobre una medida dada (celosías, frentes,
  separadores). Lo difícil no es el motivo, es repartirlo: márgenes iguales,
  sin motivos cortados al borde, y **ligamento ≥ 2 × espesor**.
- `variantes.js` — las medidas normalizadas del catálogo (bridas DIN 2576,
  caños en pulgadas, bandejas IEC, rack 19″). No son piezas nuevas: son tablas
  de cotas sobre las familias que ya existen.
- `vectorizar.js` — de una FOTO o escaneo de un plano saca el contorno y sus
  agujeros. **No adivina la escala**: la pone una persona diciendo cuánto mide
  algo del dibujo. Inventarla sería cotizar una pieza que no es la pedida.
- `pdf-plano.js` — de un PDF exportado del CAD lee la geometría vectorial en
  unidades reales. Ahí la medida sale EXACTA y no hay nada que calibrar. Si el
  PDF es un escaneo, la interfaz lo rasteriza localmente con PDF.js y lo manda
  al camino de la imagen.

Los tres primeros no pueden hacer cuentas propias: si las hicieran, tarde o
temprano dirían algo distinto de lo que se cobra. Esa es toda la regla.



El servidor sólo persiste, sirve y valida la forma de lo que entra: **todo el
cálculo pasa en el navegador**, para que el cotizador responda mientras se
escribe. En un mostrador, esperar una vuelta de red por cada tecla se nota.

### Las dos interfaces conviven, y el iframe no es pereza

Todo está rehecho en React salvo **Clientes**, que sigue siendo la de antes y se muestran **dentro de un
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

### La OT no recalcula el trabajo vendido

`src/core/produccion.js` crea `planProduccion` al guardar el presupuesto. Es
una fotografía sin costos ni margen del nesting, los programas y las
operaciones. Al aprobar, el servidor la copia a la OT. Cambiar después una
chapa predeterminada o mejorar el algoritmo no puede mover las piezas de una
orden que ya se vendió.

La clasificación se guarda con `PUT /api/ordenes/:id/taller`, una acción por
transacción. No mandar el objeto entero desde una tablet: dos puestos abiertos
se pisarían. Las piezas se identifican por `programa + chapaIndice +
piezaIndice`; el rechazo deriva la cola de reposición y no se duplica.

Confirmar una chapa física también es una acción de taller. El único retazo
que se da de alta automáticamente es la franja rectangular intacta por encima
de `layout.alturaOcupada`, menos la separación. El esqueleto entre piezas no
es stock confiable. La clave `OT:id:programa:chapa` evita duplicados si se
reintenta una respuesta perdida; una confirmación diferente exige corrección
explícita y nunca reemplaza trazabilidad en silencio.

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

7. **El presupuesto del cliente no muestra nada nuestro.** Ni margen, ni
   utilidad, ni costo, ni el porcentaje. Tampoco **el tiempo de máquina ni las
   chapas consumidas**: mostrar "18m 2s" al lado de un precio de seis cifras
   convierte la conversación en el precio por minuto de máquina en vez del
   trabajo entregado, y de paso le revela al cliente el rendimiento de nuestro
   anidado. Todo eso va en la **orden de trabajo**, que es interna.

   Hay un test que extrae el TEXTO REAL del PDF y falla si aparece alguna de
   esas palabras o el número del costo. Se verifica sobre el texto y no sobre
   el código a propósito: es lo único que ataja una línea agregada después.

8. **Las micro-uniones son producción, no diseño.** No se modifican las medidas
   de la pieza ni se descuentan del corte cotizado: se exporta un DXF de máquina
   con pequeños tramos abiertos en el contorno exterior y se cobra el repaso
   manual. En automático sólo se aplican a piezas chicas o livianas; forzarlas
   o apagarlas es una decisión explícita del ítem.

## El sistema se calibra solo

Todo el tiempo de máquina que cotiza es **simulado**. `src/core/calibracion.js`
lo compara contra lo que el taller anotó al terminar cada orden
(`orden.real.segundos`) y saca un factor de corrección.

Cuatro reglas que **no se aflojan**, porque son la diferencia entre calibrar y
adivinar con más pasos:

1. **Mediana, no promedio.** Un trabajo donde el operario dejó el cronómetro
   corriendo arrastra el promedio y no mueve la mediana.
2. **Nada se corrige con menos de `MINIMO_TRABAJOS` (5).** Corregir con ruido
   es peor que no corregir: da confianza falsa.
3. **Lo imposible se descarta y se cuenta.** Un ratio fuera de `RANGO_CREIBLE`
   es alguien que escribió minutos donde iban horas. Se informa, porque si se
   descarta la mitad hay que revisar cómo se está midiendo.
4. **Nunca corrige en silencio.** El resultado dice de dónde salió el factor y
   con cuántos trabajos, y la ficha técnica muestra la estimación sin corregir
   al lado.

⚠️ Se agrupa por material **y banda de espesor**, y sólo con órdenes "puras":
si una orden mezcla acero de 2 mm con inoxidable de 10, atribuirle el tiempo a
uno de los dos sería inventar. Esas siguen contando para el factor global.

`ctx.calibracion` es **opcional**: sin ella el factor es 1 y el cálculo queda
exactamente como estaba. Hay un test que lo fija.

## Un presupuesto viejo puede estar por debajo del costo

`src/core/vigencia.js`. Con la inflación argentina un presupuesto se pudre
solo: nadie lo toca y deja de cubrir porque subió la chapa.

Dos cosas distintas, y **decide la segunda**:

- **El calendario** (`validezDias`). Por sí solo no significa nada: si el
  acero no se movió, el precio sigue siendo bueno y vencerlo es perder una
  venta por trámite. Hay un test que lo fija.
- **El costo.** Puede pasar DENTRO de la validez: si la chapa saltó 8 % en una
  semana, uno de cinco días ya está en rojo.

Dos caminos, a propósito:

- `evaluarVigencia()` — al ABRIR un presupuesto. Compara contra la cotización
  rehecha con los precios de hoy. Exacto.
- `impactoMaterialRapido()` — en la LISTA. Usa `_pesoTotal` y
  `_precioKgMaterial` que el presupuesto guardó por ítem: es una
  multiplicación, sin anidar. **Exacto para el material y no mira nada más.**
  Recotizar cincuenta presupuestos para pintar una tabla serían varios
  segundos de pantalla congelada.

⚠️ La comparación lee los ítems **guardados**, no la cotización de hoy: con la
de hoy se compararía el precio actual contra sí mismo y no aparecería nunca
ninguna variación. Fue el primer intento y se vio porque el desglose salía
vacío.

⚠️ Sin `_precioKgMaterial` (presupuestos anteriores al cambio) se muestra
**"—", no "0 %"**. Un guión dice "no se puede saber"; un cero miente para el
lado tranquilizador.

## Un taller no vende chapa: vende horas de máquina

`src/core/rentabilidad.js`. La chapa se compra y se revende; lo escaso, lo que
no se puede fabricar más, son las horas de la fibra y de la plegadora. Ese es
el cuello de botella, y por lo tanto la única unidad en la que conviene
comparar dos trabajos.

Mirar el total del presupuesto es la medida equivocada:

    A · $500.000 en 12 h   ->  $41.700 de utilidad por hora
    B · $ 80.000 en 0,5 h  -> $160.000 por hora

B es cuatro veces mejor negocio aunque parezca el trabajo chico. Un taller que
toma los A porque "son grandes" termina con la máquina llena y la cuenta vacía.

⚠️ Se mide **utilidad** por hora, no facturación por hora. Facturación premia
el material caro, que es plata que entra y sale: cortar inoxidable no es mejor
negocio por el solo hecho de que la chapa salga el triple. Hay un test que fija
que dos trabajos con la misma utilidad y las mismas horas dan lo mismo aunque
uno facture el doble.

⚠️ La vara sale del **historial aprobado de este taller**, no de un número de
manual — y sólo de los aprobados: un presupuesto que el cliente no tomó dice
lo que se pidió, no lo que el taller consigue. Sin al menos cuatro trabajos no
se inventa una referencia y se cae al piso de estructura.

El piso de estructura no es opinión: si el taller gasta $894.000 por mes en
100,8 horas productivas, cada hora tiene que dejar $8.869 sólo para no perder.
Debajo de eso el trabajo no paga ni la parte de alquiler y sueldos que le toca
por ocupar la máquina, y el aviso es de error.

## Trampas conocidas

- **Douglas-Peucker sobre un contorno CERRADO colapsa.** El algoritmo fija el
  primer y el último punto como extremos, y en un lazo esos dos son vecinos:
  la recta de referencia mide un píxel y todo queda "cerca". Un rectángulo de
  800×500 salía con 5 puntos y **área cero**. Hay que cortar el lazo en el
  punto más lejano del primero y simplificar las dos mitades.

- **Enderezar segmentos: 90° también es múltiplo de 90°.** Medir `ang % 90` y
  emparejar la Y cuando el resto es chico convierte los lados VERTICALES en
  horizontales, porque 90 % 90 = 0. Las piezas salían aplanadas. Hay que ver a
  cuál múltiplo se acerca: par = horizontal, impar = vertical.

- **Una línea DIBUJADA tiene grosor, así que da DOS contornos.** El borde de
  afuera y el de adentro del trazo. Sin juntarlos en su línea media, una placa
  con dos agujeros da seis contornos, los agujeros se vuelven piezas y el
  largo de corte sale al doble. Y hay que tomar la línea MEDIA: quedarse con
  el borde externo hace la pieza un ancho de línea más grande.

- **`PUT /api/config` FUSIONA, no reemplaza.** Reemplazaba: mandar sólo
  `{comercial:{margen:50}}` borraba empresa, producción y estructura de costos,
  y el sistema seguía andando con los valores de fábrica sin un solo aviso. Se
  perdía la calibración del taller en silencio. Los arreglos sí se reemplazan
  enteros, porque si no un acabado borrado resucita.

- **Una vista que edita sobre una copia se siembra CUANDO llegan los datos, no
  al montar.** Al montar, el store todavía está vacío: sembrar la copia en el
  `useState` inicial deja la tabla en "Sin materiales" para siempre. Pero
  tampoco puede depender del array del store, porque entonces una recarga pisa
  las ediciones a medio hacer. El patrón es `useEffect` + un `useRef` que
  marque que ya se sembró — igual que el `arrancado` del cotizador.

- **El teléfono argentino NO se manda como está cargado.** WhatsApp quiere
  `5493804123456` y en la agenda está `0380 15 4123456`: hay que sacar el 0 de
  larga distancia, sacar el 15 y poner un 9 después del 54. Con el 15 puesto el
  enlace abre un chat con un número inexistente y el mensaje se pierde **sin
  error**, que es peor que fallar. Vive en `envio.js` → `telefonoWhatsApp()`,
  con nueve casos de prueba porque el código de área tiene 2, 3 o 4 dígitos y
  eso cambia dónde está el 15.

- **El efecto de arranque del cotizador NO puede depender de `materiales`.**
  Crea el presupuesto desde cero; si se recargan los materiales, el array cambia
  de referencia y borra el presupuesto que estabas armando. Se guarda en un
  `useRef` para qué presupuesto ya se inicializó.

- **Las vistas del legado guardan por su cuenta y hay que avisarle a React.**
  Viven en un iframe y la app tiene su propia copia de config/materiales/
  máquinas —la carga una sola vez porque el cotizador la lee en cada tecla—.
  Sin el `postMessage('kort-datos-cambiados')` de `web/js/api.js`, cambiabas un
  precio y el cotizador seguía con el viejo: parecía que no se había guardado.

- **Las rutas son con hash (`#/plegado`).** `HashRouter`, no `BrowserRouter`.
  Navegar a `/plegado` cae en el catch-all y muestra el Panel.


- **"Qué material comprar" y "qué material consume el trabajo" son números
  distintos.** El proveedor no vende media chapa, así que la lista de compra
  pide enteras. Pero una pieza suelta que usa el 1 % de una chapa **no obliga
  a comprarla**: sale del retazero, y por eso el cotizador la cobra por área
  consumida. Medir la relación material/venta contra la chapa entera daba
  2.685 % — un número que nadie mira dos veces y que dejaba de servir para lo
  único que sirve: saber si el anticipo alcanza. `compras.js` informa las dos
  cosas y calcula la relación sobre `costos.material`, que es lo que el
  cotizador ya decidió.

- **La reposición usa la foto del NESTING aprobado, no recalcula una OT.** El
  presupuesto guarda `requerimientosChapa` y la orden lo hereda. Si después
  cambia la chapa estándar, el precio o un parámetro de nesting, la producción
  vendida sigue necesitando exactamente el material con el que se aprobó. El
  punto de pedido es demanda comprometida + seguridad histórica - stock libre;
  no usa umbrales en pesos y no cuenta material aportado por el cliente.

- **Cobrar por kilo: el recorte lo paga el taller.** El kilo que se entrega NO
  cuesta el kilo que se compró: cuesta el de compra dividido el aprovechamiento.
  Con chapa a $2.950 y 77 % de nesting, el kilo entregado sale $3.869 antes de
  encender la máquina. Cualquier cuenta de $/kg que use el precio de compra
  directo subestima el costo casi un 30 %. Ver `tarifario.js` → `materialKg`.


- **La guillotina se decide por la GEOMETRÍA, no por una bandera.** Corta de
  lado a lado, recto y pasante: nada de agujeros, radios de esquina,
  escotaduras ni varias partes. `esRectangularPelada()` lo mide sobre el
  contorno real — si la pieza cambió y un `esRectangulo: true` quedó viejo, se
  manda a la guillotina algo que no puede cortar y se para la producción con
  la chapa comprada.

  Y en **automático** sólo va el desarrollo de una pieza que se PLIEGA, no
  cualquier rectángulo: el canto de guillotina deja rebaba, que adentro de un
  perfil plegado no se ve y en una placa que se entrega tal cual, sí.

  La capacidad baja con la resistencia del material: se publica en acero dulce
  (Rm 370) y un inox de Rm 620 se corta hasta bastante menos espesor.

- **En un panel calado, el LIGAMENTO es lo que decide si sale entero.** Es el
  material que queda entre dos calados. Muy chico, el calor de los dos cortes
  vecinos se suma, se ablanda y la chapa sale ondulada — y no se endereza.
  `decorativo.js` usa **2 × espesor y nunca menos de 1,5 mm**, y si se pide
  menos lo sube y lo avisa: no corrige en silencio, porque quien decide entre
  menos motivos o más espesor es el que lo vende.

- **El porcentaje de calado se mide con el área EXACTA, no con la envolvente.**
  Una ranura o una hoja llenan menos de la mitad de su caja: con la envolvente
  un panel al 38 % se informaba al 60 %. De ese número depende si el panel
  aguanta donde lo van a poner.

- **El catálogo grande son TABLAS, no 300 `build()` a mano.** Trescientas
  funciones sueltas son trescientas formas de equivocarse, y las que nadie usa
  se pudren hasta que alguien las elige. Una familia parametrizada se prueba
  una vez y anda para todas sus medidas. Hay un test que **construye las 330
  medidas** y falla si una sola no da una pieza con área.

- **Más ángulos de rotación en el nesting NO es mejor.** Medido: en un
  trapecio entran 74 piezas con paso de 15° contra 85 con paso de 45°. La
  colocación es golosa y la rotación que mejor apoya a una pieza arruina el
  apoyo de la siguiente. Por eso el giro fino va como **una variante completa
  más** del multi-arranque y no como libertad por pieza: así sólo puede
  ayudar. Como variante gana donde importa — en una pieza tipo gota, de 2
  chapas a 1.

- **Vista previa y liberación tienen presupuestos distintos.** Al escribir se
  usa nesting `equilibrada`; al guardar, Cotizador recalcula precio y layout
  juntos con `maxima` (más órdenes, pesos y giro de 7,5°). Nunca guardar el
  precio de la vista previa con el layout máximo: serían dos consumos de chapa
  distintos. La conservadora sigue dentro de ambas para impedir regresiones.

- **Plegado no certifica herramientas que no conoce.** El motor puede probar
  autocruce final e intermedio, tonelaje, ala y largo. No puede afirmar que no
  chocará contra punzón, matriz, tope o bastidor hasta cargar sus contornos
  reales. La UI debe decir “geometría apta · validar herramienta”, no “sin
  problemas”.

- **Anidar adentro de un agujero: NUNCA prometer un encaje que no existe.**
  `huecos.js` rasteriza el agujero, le achica el borde por la separación de
  corte y busca el mayor rectángulo INSCRIPTO. Se anida dentro de ese
  rectángulo, no del contorno del agujero. En un agujero con forma de riñón
  desperdicia un poco, pero lo que promete entra siempre — un anidado
  optimista se descubre con la máquina cortando y la chapa arruinada.

  Y la erosión mira los **ocho** vecinos, no los cuatro ortogonales: con
  cuatro come un rombo en vez de un cuadrado y la holgura en diagonal queda un
  30 % más corta que la pedida. Hay un test que verifica las cuatro esquinas
  contra el radio útil.

- **El multi-arranque del nesting DEBE incluir la variante conservadora.**
  Elegir la rotación pieza por pieza es óptimo localmente y peor en conjunto:
  en un trapecio entraban 59 piezas contra 69 del método anterior. Tener la
  variante vieja en la lista de candidatas es lo que garantiza que agregar
  rotación libre nunca deje un resultado peor. No sacarla "porque ya no hace
  falta".

- **Los pesos de colocación del nesting están calibrados, no elegidos a ojo.**
  `PESOS = { y: 1, hueco: 0.45, alto: 0.08 }` salió de medir cuántas piezas
  entran en una chapa con seis geometrías distintas. Si se tocan, hay que
  volver a medir: el test `el anidado nunca queda peor` lo detecta.

- **Las plantillas de plegado tienen que ser plegables de verdad.** Un ala de
  12 mm no entra en el ala mínima de una V16 (12,4 mm). Hay un test que corre
  todas las plantillas en 1,5 y 2 mm y falla si alguna da error: si se agrega
  una plantilla nueva con cotas de fantasía, salta ahí. Lo mismo para las
  piezas de estantería, que se construyen en 1,5 / 2 / 3 mm y no pueden
  devolver ningún aviso de nivel `error`.

- **En un sistema de estantería el PASO de las ranuras es un parámetro, no un
  número escondido.** Si el parante y la ménsula no comparten paso, no
  encastran — y eso se descubre en el armado, con la chapa ya cortada.

- **Los `avisos` de una pieza se filtran con `.filter(Boolean)`.** El patrón
  de la biblioteca es armar el arreglo con condicionales que devuelven `null`;
  olvidarse el filtro deja un `null` adentro y cualquier `.some(a => a.nivel)`
  explota.

- **Los componentes de `app/src/componentes/ui/` NO usan los nombres de shadcn.**
  Es `Boton tono/tam` (no `variant/size`), `Selector valor/alCambiar` (no
  `value/onValueChange`), `Opcion valor`, `Aviso nivel`, `Insignia tono`,
  `Entrada unidad`, `PanelCuerpo sinPad`. Escribir a la inglesa compila igual
  y no funciona.


- **"Corte láser" en el desglose es SÓLO producción.** La puesta a punto (setup
  del programa + carga de chapa) va en su propia línea. Sumarlas mostraba
  "corte láser 4m 42s" para una placa de 200×150 en 1,2 mm, cuando cortarla son
  **7 segundos**: el resto es preparación. Un tiempo que no existe hace que
  nadie confíe en el resto de los números.
- **Un dato mal cargado multiplica TODOS los precios en silencio.** Pasó:
  $150.000/h en "consumibles" (el valor de fábrica es $2.800) llevó la hora de
  máquina de $30.000 a $177.000. `src/core/salud.js` → `revisarDatos()` revisa
  config, máquinas y materiales; la tarjeta sale primera en el Panel y el aviso
  de la máquina también en el cotizador, sobre el precio.

  Al agregar una regla, dos condiciones **no negociables**:

  1. **Relativa y estructural, nunca un umbral en pesos.** Con la inflación
     argentina cualquier "avisá si supera $X" queda viejo en meses y termina
     saltando siempre.
  2. **Que no dispare con los valores de fábrica.** Hay un test que lo fija, y
     ya atajó dos reglas mal pensadas: "ningún componente supera el 50 % del
     costo horario" (falso — en la plegadora el operario es el 52 % y está
     bien) y "el N₂ es más caro que el O₂" (falso — el O₂ va en cilindros a 1-3
     m³/h y el N₂ se compra líquido a granel; lo que encarece el inox es el
     caudal, no el precio unitario). Un aviso que salta siempre enseña a
     ignorar los avisos.

  Por eso `revisarCostoHora()` sólo mira **consumibles y mantenimiento**: son
  los únicos componentes sin ancla física. La amortización sale de valor ÷
  horas, la energía de kW × $/kWh, el operario de la escala UOM y la estructura
  del cuadro de gastos — ahí un tipeo se nota solo.

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

- **Calidad no inventa tolerancias.** El ancho calculado por la geometría sirve
  como referencia operativa, pero la aceptación sale del plano aprobado. Toda
  característica requerida necesita nominal y tolerancias superior/inferior;
  el lote sólo se libera si la última medición de cada una es conforme.

- **Una foto no tiene milímetros y una exportación PDF puede no estar 1:1.**
  La imagen se calibra marcando dos extremos de una cota conocida; el PDF
  vectorial permite la misma comprobación y aplica la corrección si se carga.
  Generar DXF exige confirmar cotas críticas. El original se guarda aparte y
  el ítem conserva fuente, referencia, escala, fecha y ruta para auditoría.

- **No abrir SVG ni HEIC como planos.** La entrada se limita a JPG, PNG, WebP
  y PDF de hasta 8 MB. PDF.js debe quedar en una versión sin vulnerabilidades
  conocidas y cargarse de forma diferida: sólo un PDF escaneado lo necesita.

- **“Se pudo dibujar” no significa “se puede cortar”.** Toda geometría externa
  pasa por `auditarFabricabilidad()`: abiertos, discontinuidades,
  autointersecciones, agujeros fuera/superpuestos y fuera de mesa bloquean el
  DXF. Agujero/ligamento/segmento chico son avisos porque dependen de material,
  gas y calidad. El auditor nunca repara ni borra entidades en silencio.

- **El auditor tiene un límite de complejidad deliberado.** Cruzar todos los
  segmentos es cuadrático. Si un contorno supera 1.800 puntos o una pareja
  supera 1,5 millones de comparaciones, se marca para revisión en CAM; no se
  congela el mostrador ni se promete que está sano.

- **Segmentar una pieza XXL no autoriza a aproximarla.** La segmentación
  automática trabaja sólo con un contorno exterior lineal, simple y de una
  parte. Nunca aplana arcos para hacerlos entrar. Los dos paneles vecinos deben
  usar el mismo perfil de junta en sentidos opuestos, ningún corte puede
  atravesar un agujero y la suma de áreas debe conservar la original.

- **Una junta de autoalineación no es un cálculo estructural.** Sirve para
  presentar y fijar la geometría antes de soldar; material, aporte, secuencia,
  penetración y terminación siguen siendo parte de la hoja de proceso. Un
  desarrollo con pliegues se bloquea porque segmentarlo cambia apoyo,
  secuencia y herramental. Si KORT une el conjunto, las horas de soldadura se
  cargan una sola vez en el primer segmento, nunca en todos.

- **La segmentación se confirma después de persistir todos los DXF.** Si falla
  cualquier guardado, el cotizador conserva la pieza original y no agrega
  segmentos parciales. Recién con el lote completo se reemplaza el ítem.

- **Rechazar y abrir la no conformidad es una sola transacción.** Separarlas
  deja una pieza roja sin causa si se corta la red entre las dos llamadas. El
  endpoint de calidad aplica también la clasificación cuando recibe programa,
  chapa y posición, y persiste ambos estados juntos.

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

Ver [ROADMAP.md](ROADMAP.md) y
[docs/LINEAMIENTOS_PRODUCTO.md](docs/LINEAMIENTOS_PRODUCTO.md). Toda función
nueva se contrasta con el flujo integral comercial → ingeniería → material →
producción → calidad → entrega, y con referentes industriales oficiales.

La conexión de máquina es **sólo lectura** hasta tener controlador y protocolo
confirmados. `telemetria.js` es el contrato canónico; ningún adaptador mete su
dialecto en la UI. No llamar OEE a disponibilidad: faltan rendimiento contra
ciclo ideal y calidad medida. La IA sugiere con fuente/confianza y siempre pasa
por validadores determinísticos antes de afectar precio o fabricación.
