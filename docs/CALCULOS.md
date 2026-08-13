# Cómo se calcula cada número

Este documento existe para que cualquier precio del sistema se pueda explicar.
Cada fórmula está acá con **de dónde sale cada dato** y **cómo verificarla a
mano**. Si un número no cierra, se empieza por acá.

Todas las cuentas de este archivo están cubiertas por tests en
`tests/run.js` → grupo "Auditoría de los cálculos", que las compara contra el
cálculo hecho a mano. Si alguien cambia una fórmula, el test falla.

---

## El orden en que se calcula

```
        ┌─ geometría (área, perímetro, agujeros)
        │
peso ───┼─ nesting ──── chapas y aprovechamiento ──── COSTO MATERIAL
        │                                                   │
        └─ simulación de corte ── tiempo de máquina ─────────┤
                                        │                    │
                     costo horario ─────┘                    ├─→ COSTO
                            │                                │
        estructura del taller                    gas, plegado, acabados
                                                             │
                                            margen → descuento → IIBB → PRECIO
```

---

## 1. Geometría

| Qué | Fórmula | Dónde |
|---|---|---|
| Área de un contorno | Fórmula del área con signo (shoelace) **+ el segmento circular de cada arco**: `r²/2 · (θ − sen θ)` | `geometry.js` → `pathArea()` |
| Área neta de la pieza | área exterior − área de los agujeros | `shapeArea()` |
| Longitud de corte | Σ largo de cada segmento. Recta: `√(Δx²+Δy²)`. Arco: `|θ|·r` | `shapeCutLength()` |
| Perforaciones | 1 por el contorno exterior + 1 por cada agujero | `shapePiercings()` |
| Peso | `área_mm² × espesor_mm × densidad / 10⁶` | `materials.js` → `pesoKg()` |

**Por qué el área es exacta y no aproximada.** Un círculo aproximado por un
polígono inscripto de 32 lados mide 0,64 % menos que el círculo real. En una
brida de Ø400 en 10 mm son 60 gramos por pieza que nadie cobra. Se aproximó una
vez y se corrigió.

**Verificación a mano:** placa de 400 × 300 × 2 mm en acero.
`0,4 × 0,3 = 0,12 m²` · `0,12 × 2 × 7,85 = 1,884 kg` · perímetro `2×(400+300) = 1400 mm`.

---

## 2. Estructura del taller

Todo lo que se paga esté la máquina prendida o apagada.

```
horas abiertas    = días hábiles × horas por día
horas productivas = horas abiertas × ocupación productiva
estructura/hora   = suma de gastos fijos del mes ÷ horas productivas
```

**Verificación:** 21 días × 9 h = 189 h abiertas. Al 60 % → 113,4 h productivas.
Con $1.744.000 de gasto fijo → **$15.379/h**.

⚠️ **La potencia eléctrica contratada va acá, no en la máquina.** EDELAR la
cobra por kW-mes se use o no: 30 kW × $9.296,43 = **$278.893 fijos por mes**.
Si estuviera como costo variable de la máquina, los trabajos largos la pagarían
dos veces y los cortos no la pagarían nunca.

Consecuencia buscada: **si el taller trabaja menos horas, el costo por hora
sube solo.** Es la señal económica más útil que da el sistema.

| Dato | Fuente | Nivel |
|---|---|---|
| Cargo por potencia, cargo fijo, $/kWh | EDELAR, Res. EUCOP 001 Acta 028 (14/04/2026) | 🟢 |
| Alquiler, seguros, contador, tasa | Estimación para La Rioja | 🔴 **cargá los tuyos** |
| Ocupación productiva | Supuesto de taller chico (55-70 %) | 🟡 |

---

## 3. Costo horario de la máquina

```
amortización = valor del equipo ÷ vida útil en horas
energía      = consumo kW × $/kWh          (sólo la variable)
operario     = costo real por hora × dedicación %
estructura   = estructura/hora × participación de esta máquina %
costo/hora   = amortización + energía + mantenimiento + consumibles
             + operario + estructura
```

**Verificación con los valores de referencia:**

| Componente | Cuenta | Resultado |
|---|---|---|
| Amortización | $125.000.000 ÷ 20.000 h | $6.250 |
| Energía | 14 kW × $106,46 | $1.490 |
| Mantenimiento | dato cargado | $4.000 |
| Consumibles | lista de piezas ÷ vida útil | $2.747 |
| Operario | $12.750 × 80 % | $10.200 |
| Estructura | $15.379 × 60 % | $9.228 |
| **TOTAL** | | **$33.968/h** |

### De dónde sale el costo del operario

No es lo que dice el recibo. Del básico de convenio al costo real:

```
básico UOM rama 17, Operador CNC              $ 6.868,42/h   🟢 paritaria abr-2026
+ adicionales de convenio (10 %)              $   686,84
+ cargas patronales + ART + seg. vida (33,9%) $ 2.561,74
+ aguinaldo (8,33 %)                          $   843,00
+ vacaciones y ausentismo (14 %)              $ 1.786,00
──────────────────────────────────────────────────────────
= costo por hora TRABAJADA                    $ 12.746      → multiplicador 1,86×
```

---

## 4. Tiempo de corte

**El corte y la puesta a punto van separados.** "Corte láser" es sólo el
tiempo cortando; programar la máquina y cargar la chapa tienen su propia línea.
Sumarlos mostraba "corte láser 4m 42s" para una placa que se corta en 10 s, y
un tiempo que no existe hace que nadie confíe en el resto de los números.

**No se divide perímetro por velocidad.** Eso subestima cualquier pieza con
detalle, porque la máquina no corta a velocidad constante: frena en cada
esquina y en cada arco chico.

Se simula el planificador de movimiento real:

1. Cada contorno se parte en tramos con su longitud y su curvatura.
2. Velocidad máxima en cada arco: `v = √(a · R)` (aceleración centrípeta).
3. Velocidad en cada esquina, por desviación de unión:
   `v = √(a · δ · sen(θ/2) / (1 − sen(θ/2)))`
4. Pasada hacia atrás y hacia adelante ("look-ahead") para que ninguna
   velocidad sea inalcanzable con la aceleración disponible.
5. Perfil trapezoidal por tramo → tiempo exacto.

```
tiempo de máquina = (corte + entradas + perforaciones + rápidos) ÷ eficiencia
tiempo del lote   = tiempo por pieza × cantidad
                  + carga de chapa × chapas
                  + setup del programa
```

**Verificación:** placa de 400×300 en 2 mm con aire a 8.500 mm/min.
`1.400 mm ÷ 8.500 mm/min × 60 = 9,9 s`. El simulador da **10 s** — apenas más,
porque las cuatro esquinas obligan a frenar.

**Cuándo frena de verdad.** La velocidad en un arco está limitada por
`v = √(a · R)`. Con 1,2 G y un material que corta a 8.500 mm/min, el límite
recién aparece cuando `R < v²/a ≈ 1,7 mm`: **un agujero de Ø6 no frena la
máquina, uno de Ø2,5 sí.**

Medido sobre una placa de 300×200 en 2 mm con 80 agujeros:

| Diámetro | Velocidad media | Caída |
|---|---|---|
| sin agujeros | 8.475 mm/min | — |
| Ø6 | 8.052 | 5 % |
| Ø4 | 7.947 | 6 % |
| Ø3 | 7.705 | 9 % |
| Ø2,5 | 7.466 | 12 % |
| Ø2 | 7.241 | 15 % |
| Ø1 | 6.902 | 19 % |

La caída es gradual y no un salto, porque el promedio incluye los 1.400 mm de
perímetro recto que se recorren a velocidad plena. **El modelo no inventa una
penalización donde no la hay**: con agujeros grandes casi no penaliza, que es
lo que pasa en la máquina.

⚠️ **`cuttingSpeed()` nunca extrapola por encima del espesor máximo.** Devuelve
`null` y el cotizador da error. Si extrapolara, aceptaría inoxidable de 20 mm en
una máquina de 3 kW: un trabajo que se vende y no se puede entregar.

---

## 5. Gas de asistencia

```
m³ = caudal (m³/h) × (tiempo de corte + entradas + perforaciones) ÷ 3600
```

El gas corre sólo mientras el haz está encendido; en los movimientos rápidos el
obturador está cerrado.

**Acá está el número que casi ningún cotizador modela:**

| Corte | Gas | Caudal |
|---|---|---|
| Acero 6 mm | O₂ | 1,3 m³/h |
| Inox 3 mm | N₂ | **40 m³/h** |
| Inox 8 mm | N₂ | **90 m³/h** |

Cortar inoxidable con nitrógeno consume **30 veces más gas** que cortar acero
con oxígeno. El precio del gas es 🔴 **el dato más incierto del sistema**:
entre termo, granel y generador hay 4× de diferencia.

---

## 6. Nesting y costo del material

El nesting agrupa por **(material, espesor, gas, chapa)** y anida todo junto:
la máquina corta un programa por chapa, no un ítem por chapa.

```
kg de la chapa   = ancho × alto × espesor × densidad / 10⁶
costo de la chapa = kg × $/kg de compra
```

Después, según el modo:

| Modo | Cuenta | Cuándo conviene |
|---|---|---|
| Chapas completas | `chapas × costo de la chapa` | El trabajo llena la chapa |
| Área consumida | `área ÷ (área chapa × aprovechamiento objetivo) × costo × (1 + scrap)` | Queda retazo reutilizable |
| **Automático** | el menor de los dos, salvo que el aprovechamiento supere el objetivo | Por defecto |

### El recorte lo paga el taller

**Ésta es la cuenta que más plata mueve y la que menos se ve.**

```
$/kg entregado = $/kg comprado ÷ aprovechamiento
```

Con chapa a $3.800/kg y 77 % de aprovechamiento:

```
3.800 ÷ 0,77 = $ 4.935 por kilo entregado, antes de encender la máquina
```

El kilo que entregás **no es** el kilo que comprás. Cualquier tarifa por kilo
que use el precio de compra directo subestima el costo casi un 30 %.

⚠️ El modo automático supone que **el retazo se reutiliza**. Si en la práctica
se apila y se oxida, hay que pasar a "Chapas completas" o el sistema
subestima el material.

---

## 7. Plegado

```
Ri  = 0,16 × V                    radio interno al aire (0,17 en aluminio)
K   = f(Ri/espesor)               K-factor efectivo, 0,33 a 0,50
BA  = (π/180) · ángulo · (Ri + K·t)          bend allowance
OSSB = tan(ángulo/2) · (Ri + t)              outside setback
BD  = 2·OSSB − BA                            bend deduction
desarrollo = Σ cotas exteriores − Σ BD
```

Tonelaje al aire:

```
F [kN/m] = C · Rm · t² / V        con C = 1,33
toneladas = F × largo[m] / 9,80665
```

Ala mínima plegable: `0,65 × V + t`.

**Verificación:** canal U 40/100/40 en 2 mm, V16.
`Ri = 2,56 mm` · `Σ cotas = 180 mm` · `Σ BD = 7,75 mm` → **desarrollo 172,25 mm**.

---

## 8. Del costo al precio

```
COSTO = material + corte + preparación + gas + plegado + acabados + procesos + ingeniería
lista = COSTO × (1 + margen %)
neto  = lista × (1 − descuento por cantidad %) × (1 + recargo urgencia %)
neto  = neto × (1 + ingresos brutos %)
neto  = máximo(neto, mínimo por ítem)
neto  = redondear hacia arriba al múltiplo configurado
```

Ingresos brutos se suma **sobre la facturación, no sobre la ganancia**: si no se
traslada al precio, sale del margen.

**Verificación:** placa de 400×300 en 2 mm, 30 unidades, chapa a $3.800/kg.

| Concepto | Valor |
|---|---|
| Material (área consumida) | $297.382 |
| Corte (producción) | $494 |
| Puesta a punto y carga de chapa | $3.161 |
| Gas (2,1 m³ de aire × $110) | $231 |
| **COSTO** | **$304.665** |
| + margen 45 % | $441.765 |
| − descuento por cantidad 8 % | $406.424 |
| + ingresos brutos 3 % | $12.193 |
| **NETO** | **$419.000** ($13.967 c/u) |

El material es el **97,6 %** del costo. Por eso, en chapa fina, un error en el
precio del kilo se traslada casi entero al precio final.

---

## 9. Tarifario

El tarifario corre el motor completo sobre una **probeta**: una pieza sintética
de 400 × 300 con la cantidad de agujeros que haga falta para llegar a los metros
de corte por m² de cada banda. No es una pieza real, es una muestra para medir
el costo del proceso a esa densidad.

```
costo por m²  = costo del lote ÷ m² de pieza entregados
costo por kg  = costo del lote ÷ kg entregados
costo por m   = costo del lote ÷ metros de corte
```

Las tres son **el mismo dinero en otra unidad** y el sistema lo verifica:
`costoM2 = costoKg × kg/m²` con 1 % de tolerancia.

| Banda | m de corte por m² | Ejemplo |
|---|---|---|
| Simple | 14 | Placa 400×300 sin agujeros |
| Media | 35 | Frente de gabinete con pasacables |
| Compleja | 75 | Piezas de 100×80 anidadas |
| Perforada | 160 | Rejilla con 400 agujeros |

### Por qué cada base se rompe por un lado distinto

- **Por m²** falla con el **espesor**: el material escala con el espesor y el
  precio plano no. De 1 a 20 mm el precio correcto varía **20×**.
- **Por kg** falla con la **chapa fina**: un kilo de 0,9 mm es 0,142 m² y uno de
  10 mm es 0,013 m² — once veces más superficie que cortar por el mismo kilo
  cobrado. Aun así el precio correcto varía sólo **1,08×**, así que **es la
  mejor base para una tarifa única**.
- **Por metro de corte** no cobra el material: sólo sirve si la chapa la trae
  el cliente.

---

## Niveles de confianza

| Dato | Nivel | Fuente |
|---|---|---|
| Precio de compra del acero al carbono | 🟢 | **Factura del taller**, ago-2026 |
| Tarifa eléctrica EDELAR | 🟢 | Res. EUCOP 001 Acta 028, 14/04/2026 |
| Escala salarial UOM rama 17 | 🟢 | Paritaria abril 2026 |
| Tipo de cambio | 🟢 | Dólar mayorista ago-2026 |
| Precios del resto de los metales | 🟡 | Relación estable contra el acero |
| Velocidades de corte a 3 kW | 🟡 | Tablas de fabricante, sin calibrar con la máquina |
| Cargas laborales | 🟡 | Alícuotas habituales — confirmar con el contador |
| Gastos de estructura | 🔴 | Estimación para La Rioja |
| **Precio de los gases** | 🔴 | **El más incierto: pedí cotización** |

Ver [PRECIOS.md](PRECIOS.md) para el detalle de cada fuente.
