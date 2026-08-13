# De dónde sale cada número

Agosto de 2026 · La Rioja, Argentina · fuente de fibra de 3 kW

Este archivo existe para que dentro de seis meses puedas saber **qué está
verificado y qué es una estimación**. Sin esto, todos los números parecen
igual de confiables, y no lo son.

Los datos están clasificados en tres niveles:

| Nivel | Qué significa |
|---|---|
| 🟢 **Verificado** | Sale de una fuente oficial o publicada, con fecha |
| 🟡 **Estimado** | Cálculo propio a partir de datos verificados |
| 🔴 **A confirmar** | Orden de magnitud razonable, pero hay que pedir la cotización |

---

## 🟢 Tarifa eléctrica — EDELAR

**Fuente:** [Cuadro tarifario EDELAR S.A.](https://www.edelar.com.ar/files.php?f=cuadro-tarifario.pdf),
Resolución EUCOP N° 001 Acta 028 del 14/04/2026.

Categoría **T2-BT1** (baja tensión, entre 10 y 50 kW): es la que corresponde a
un taller con un láser de 3 kW.

| Concepto | Valor |
|---|---|
| Cargo por capacidad de suministro | **$ 9.296,43 / kW-mes** |
| Cargo fijo | **$ 15.106,90 / mes** |
| Energía, hora pico | $ 104,6719 / kWh |
| Energía, hora valle | $ 90,6769 / kWh |
| Energía, resto (8 a 18 h) | **$ 106,4609 / kWh** |

El sistema usa la banda "resto" porque es cuando trabaja el taller.

### Por qué esto cambió el modelo de costos

El cargo por potencia **se paga uses o no la máquina**. Con 30 kW contratados
son $ 278.893 por mes antes de encender nada. Repartido entre 113 horas
productivas da **$ 2.469 por hora**, contra $ 1.490/h de la energía que el
láser realmente consume.

Es decir: **la potencia contratada cuesta más que la electricidad que gastás.**

Por eso en el sistema el cargo por potencia es un gasto fijo (va en *Costos de
estructura*) y no un costo variable de la máquina. Si estuviera como variable,
los trabajos largos lo pagarían dos veces y los cortos no lo pagarían nunca.

> **Acción concreta:** mirá la demanda máxima registrada en tu factura. Si
> tenés contratados 30 kW y nunca pasás de 18, estás regalando ~$ 111.000 por
> mes. La reducción de potencia contratada se pide a la distribuidora.

---

## 🟢 Mano de obra — UOM Rama 17 (metalmecánica)

**Fuente:** escala salarial UOM rama 17, vigente desde abril 2026. La paritaria
quedó congelada por la intervención judicial del gremio, así que estos valores
siguen rigiendo a agosto.

| Categoría | Básico por hora |
|---|---|
| Ingresante | $ 4.313,43 |
| Operario calificado | $ 4.672,74 |
| Medio oficial | $ 5.036,08 |
| Operario especializado | $ 5.387,45 |
| Oficial múltiple | $ 6.418,60 |
| **Oficial múltiple superior / Operador CNC** | **$ 6.868,42** |

### 🟡 Costo real para la empresa

El básico no es lo que te sale la hora de esa persona. El sistema aplica:

```
básico                                    $  6.868,42
+ adicionales de convenio (10 %)          $    686,84
+ cargas patronales + ART (33,9 %)        $  2.561,74
+ aguinaldo (8,33 %)                      $    843,00
+ vacaciones y ausentismo (14 %)          $  1.786,00
─────────────────────────────────────────────────────
= costo por hora TRABAJADA                $ 12.746
```

**Multiplicador: 1,86 ×.** El recibo dice $6.868 y la hora sale $12.746.

Las alícuotas están en `src/core/costos.js` → `CARGAS_LABORALES`. Confirmalas
con tu contador: la de ART depende de tu siniestralidad.

---

## 🟢 Tipo de cambio

Dólar mayorista **$ 1.500** (agosto 2026, rondando los $1.495-1.500 con el BCRA
sosteniendo la banda). Se usa sólo como referencia informativa en el
presupuesto; los precios se cargan en pesos.

---

## 🟢 Precio de compra del acero al carbono

**$3.800/kg** — confirmado por el taller en agosto de 2026. Es el **precio de
compra de la chapa**, no lo que se cobra.

Es el dato más confiable de todo el sistema: sale de la factura, no de una
estimación. Todo lo demás se calibra a partir de él.

⚠️ Y es el que más pesa: en chapa de 2 mm el material es el **97 % del costo**
de una placa simple. Un error del 10 % acá es un 9 % en el precio final.

### El resto de los metales, en relación al acero

Las relaciones de precio entre metales son estables aunque el valor absoluto se
mueva, así que se derivan del ancla verificada:

| Material | $/kg | Relación |
|---|---|---|
| Acero SAE 1010 (frío) | **3.800** 🟢 | 1,00 × |
| Acero F-24 (caliente) | 3.100 | 0,82 × |
| Galvanizado | 4.400 | 1,16 × |
| Inoxidable 430 | 6.500 | 1,71 × |
| Inoxidable 304 | 8.900 | 2,34 × |
| Aluminio 5052 | 9.900 | 2,61 × |
| Aluminio 6061-T6 | 10.700 | 2,82 × |
| Latón | 18.600 | 4,89 × |
| Cobre | 22.000 | 5,79 × |

---

## 🟡 Precios de material (referencias anteriores)

### Acero al carbono

**Referencia:** chapa lisa laminada en frío 1,22 × 2,44 m cotizada en
distribuidoras del Litoral a **$ 86.386 sin IVA** ($ 104.527 con IVA). Una
chapa de 1,25 mm en esa medida pesa 29,80 kg → **≈ $ 2.900/kg sin IVA**.

Al interior del país se le suma entre 5 % y 25 % de flete según distancia.

| Material | $/kg cargado | Criterio |
|---|---|---|
| SAE 1010 (laminado en frío) | 2.950 | Referencia + flete a La Rioja |
| F-24 / A36 (laminado en caliente) | 2.450 | ~15 % menos que el frío |
| Galvanizado | 3.400 | ~15 % más que el frío |

### 🟡 Inoxidable

**Referencia:** chapa AISI 430 fina en lista minorista con IVA a
**$ 7.360-7.920/kg** (0,40 a 0,60 mm, medidas 1×2 y 1,25×2,5). Descontando IVA
quedan ~$ 6.100-6.550/kg. La chapa fina tiene sobreprecio por kilo: en 2-3 mm
baja.

| Material | $/kg cargado |
|---|---|
| AISI 304 | 8.900 |
| AISI 430 | 6.400 |

El 304 se cotiza entre 35 % y 45 % arriba del 430.

### 🔴 Aluminio y cobre

Estimados a partir de la referencia internacional convertida a $1.500:

| Material | $/kg | USD/kg implícito |
|---|---|---|
| Aluminio 5052 | 9.800 | 6,5 |
| Aluminio 6061-T6 | 10.600 | 7,1 |
| Latón | 18.500 | 12,3 |
| Cobre | 22.000 | 14,7 |

**Pedí cotización.** Estos son los menos confiables de la lista.

---

## 🔴 Gases de asistencia

**Este es el número más incierto del sistema y el que más mueve el precio del
inoxidable.** Los gases industriales no tienen lista pública: se cotizan por
cliente y por volumen.

| Gas | $/m³ cargado | Supuesto |
|---|---|---|
| Oxígeno | 4.500 | Cilindros / termo |
| Nitrógeno | 1.400 | Termo criogénico (dewar) |
| Aire comprimido | 110 | Compresor propio: electricidad + secador + filtros |

La diferencia entre modalidades es enorme:

- Nitrógeno en **cilindros**: 3 a 5 × más caro
- Nitrógeno en **tanque a granel**: ~$ 500/m³
- Nitrógeno de **generador PSA**: ~$ 320/m³

### Por qué importa tanto

El consumo de gas es lo que casi ningún cotizador modela, y la diferencia entre
gases es de **un orden de magnitud**:

| Corte | Gas | Caudal | Presión |
|---|---|---|---|
| Acero 6 mm | O₂ | **1,3 m³/h** | 0,6 bar |
| Inox 3 mm | N₂ | **40 m³/h** | 15 bar |
| Inox 8 mm | N₂ | **90 m³/h** | 20 bar |

Cortar inoxidable con nitrógeno consume **30 veces más gas** que cortar acero
con oxígeno. En un lote de 30 piezas de inox de 3 mm el nitrógeno son ~$ 6.400
contra ~$ 550 del aire comprimido.

El sistema muestra esa comparativa en cada cotización y tiene una calculadora
de repago de generador de N₂ en *Costos*.

---

## 🟢🟡 Velocidades de corte a 3 kW

Consolidadas de tablas de fabricantes de fuentes y máquinas de fibra, cruzadas
entre sí y verificadas contra el comportamiento físico esperado (la velocidad
cae aproximadamente con el cuadrado del espesor; el O₂ gana en chapa gruesa por
el aporte de la combustión; el N₂ gana en chapa fina por la presión).

Límites reales de una fuente de 3 kW, que el sistema **hace cumplir** (se niega
a cotizar por encima):

| Material | Máximo con calidad |
|---|---|
| Acero al carbono (O₂) | 20 mm |
| Acero al carbono (N₂ / aire) | 6 mm |
| Inoxidable (N₂) | 12 mm |
| Aluminio (N₂) | 10 mm |
| Latón | 4 mm |
| Cobre | 3 mm |

> Estas tablas son el punto de partida, no la verdad. **Calibralas.** Cortá una
> pieza conocida, cronometrala y ajustá la velocidad de ese espesor en
> *Materiales → ⚡* hasta que el tiempo estimado coincida. Con dos o tres
> espesores medidos, el resto interpola bien.

---

## 🟡🔴 Consumibles del láser

Era el único costo del sistema **sin fuente ni desglose**: un campo libre en
pesos. Por eso un `$150.000` mal tipeado —contra los $2.800 de referencia—
multiplicó por seis todos los precios sin que nada chirriara.

Ahora el número sale de piezas, en `src/core/consumibles.js`, y se edita desde
el calculador que abre la tarjeta de revisión del Panel.

| Pieza | Precio | Dura | Por hora | |
|---|---|---|---|---|
| Filtros de aspiración | $320.000 | 400 h | $800 | 🔴 |
| Juntas, o-rings y varios | $12.000 | 20 h | $600 | 🔴 |
| Lente protectora | $28.000 | 60 h | $467 | 🔴 |
| Boquilla | $18.000 | 45 h | $400 | 🔴 |
| Lente de enfoque / colimadora | $450.000 | 1.500 h | $300 | 🔴 |
| Cerámica del cabezal | $45.000 | 250 h | $180 | 🔴 |
| **TOTAL** | | | **$2.747/h** | 🟡 |

**Las horas de duración son 🟡 y los precios 🔴.** La vida útil sale del
comportamiento del equipo y es bastante estable entre talleres; los precios en
pesos son un orden de magnitud para arrancar y **hay que pedírselos al
proveedor**. Son el dato que más mueve este número.

Las horas son de **corte**, no de taller abierto. Si la máquina corta 4 h por
día, una lente de 60 h dura tres semanas.

### El cruce que da confianza

La regla práctica en un fibra de 3 kW son **USD 1,5 a 4 por hora de corte**. A
$1.550 eso da **$2.300 a $6.200/h**, y la lista cae adentro. Los $150.000 que
llegaron a estar cargados eran **25 veces el techo** de esa banda.

### Ajuste por gas

Cortando con oxígeno hay más salpicadura y humo, así que la lente protectora se
pica antes: con O₂ el total sube a **$2.947/h** y con N₂ baja a **$2.686/h**.

---

## 🔴 Gastos de estructura

Todos los valores de *Costos de estructura* (alquiler, seguros, contador, tasa
municipal) son **estimaciones de orden de magnitud para La Rioja**. No hay
manera de verificarlos sin tus facturas.

Cambiálos por los tuyos antes de cotizar en serio: son el 60 % del costo por
hora de máquina.

Alícuota de Ingresos Brutos cargada: **3,0 %**. La Rioja tiene regímenes
diferenciados y exenciones para actividad industrial — **preguntale a tu
contador si te corresponde alguna**, porque son 3 puntos directos sobre la
facturación.

---

## Cómo mantener esto al día

1. **Precios de material:** cada vez que te llega una factura de chapa,
   actualizá el $/kg. El sistema guarda el historial con fecha y dólar del día.
2. **Tarifa eléctrica:** EDELAR actualiza el cuadro varias veces al año.
   Revisá `TARIFAS_EDELAR` en `src/core/costos.js`.
3. **Paritaria UOM:** cuando se destrabe, actualizá `UOM_RAMA17` y usá la
   calculadora de *Costos → Calcular hora de operario*.
4. **Gases:** pedí la cotización una vez y cargala. No cambia tan seguido.
