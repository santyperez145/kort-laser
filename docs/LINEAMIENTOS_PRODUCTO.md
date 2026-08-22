# Lineamientos de producto y arquitectura — KORT

Fecha de investigación: **22 de agosto de 2026**.

Este documento es obligatorio para toda función nueva. KORT no busca copiar la
apariencia de una aplicación: busca cubrir, con tecnología propia y verificable,
el flujo que las mejores plataformas industriales resuelven entre varias suites.

## Visión

KORT será el sistema operativo de una metalúrgica de chapa: desde el pedido del
cliente hasta la entrega y el costo real. Debe funcionar localmente sin internet,
ser rápido en el mostrador, claro en el taller y poder crecer a varias máquinas,
puestos y sedes sin reescribir el núcleo.

La cadena completa es:

`RFQ → plano → fabricabilidad → cotización → aprobación → material → nesting → programa → corte → clasificación → plegado → calidad → entrega → costo real → aprendizaje`.

Si una función no deja trazabilidad en esa cadena, está incompleta.

## Referentes estudiados y qué aprendemos

| Referente | Fortaleza oficial | Patrón que adopta KORT |
|---|---|---|
| TRUMPF Oseon | MES + logística, pantallas por rol, instrucciones en taller, clasificación, plegado y analítica | Flujo continuo por OT, puesto de trabajo visual y material trazable |
| Lantek Expert/Integra/MES Wos | CAD/CAM, nesting, ERP/MES y conexión con múltiples máquinas | Modelo desacoplado del fabricante y nesting como fuente de producción |
| SigmaNEST Shop Floor/Color Offload | balance de carga, nesting coloreado, descarga de piezas, rechazo y retazos desde tablet | Vista de chapa interactiva, clasificación por color y feedback pieza a pieza |
| Paperless Parts | análisis de archivos, cotización configurable, revisión de requisitos e IA con aprobación humana | Bandeja de RFQ, extracción asistida y guardas determinísticas antes de cotizar |
| ProShop ERP | OT, inventario, calidad, mantenimiento, herramientas y costo real en una sola plataforma | ERP/MES integrado, instrucciones visuales, QMS y mantenimiento preventivo |
| OPC UA Machine Tools | estado, trabajos, tiempos, alarmas, KPI y modelo específico de láser | Contrato canónico y adaptadores de telemetría de sólo lectura |
| SigmaNEST TrueShape/SuperNest | multi-arranque por presupuesto de tiempo, línea común, estabilidad y secuencias NC | Vista previa rápida y optimización máxima reproducible al liberar; material y operación se miden por separado |
| TRUMPF TecZone Bend | secuencia automática, herramienta y control de colisiones en tiempo real sobre 2D/3D | Simulación paso a paso y niveles de certeza; nunca certificar colisión de máquina sin geometría real |

Fuentes oficiales:

- [TRUMPF Oseon](https://www.trumpf.com/es_ES/productos/software/oseon/)
- [Innovaciones Oseon](https://www.trumpf.com/en_US/products/software/oseon/oseon-releases/)
- [Lantek MOSS](https://www.lantek.com/mx/moss)
- [Lantek MES Wos](https://www.lantek.com/mx/lantek-wos)
- [SigmaNEST Shop Floor](https://www.sigmanest.com/en/shop-floor)
- [SigmaNEST Color Offload](https://www.sigmanest.com/en/color-offload)
- [Paperless Parts para cotización](https://www.paperlessparts.com/)
- [IA de Paperless Parts](https://www.paperlessparts.com/artificial-intelligence-in-paperless-parts/)
- [ProShop ERP industrial](https://proshoperp.com/product/)
- [OPC UA Machine Tools — monitoring y jobs](https://reference.opcfoundation.org/specs/OPC-40501-1/4.2.3.3)
- [OPC UA Companion Specifications](https://opcfoundation.org/about/opc-technologies/opc-ua/ua-companion-specifications/)
- [SigmaNEST — TrueShape, SuperNest y estrategias NC](https://www.sigmanest.com/en/sigmanest)
- [TRUMPF TecZone Bend — secuencia y colisiones](https://www.trumpf.com/en_US/products/machines-systems/bending-machines/trubend-series-7000/)

Las afirmaciones comerciales de fabricantes son referencias funcionales, no
evidencia de retorno para KORT. Cada mejora propia se mide con casos del taller.

### Qué significa “mejor nesting”

No es sólo el porcentaje de chapa. El orden de prioridades de KORT es: que todo
quepa sin interferencias, menos chapas, un remanente grande y recuperable,
estabilidad térmica/mecánica y recién después menos recorrido y perforaciones.
La vista previa usa un presupuesto equilibrado; al guardar compiten más órdenes,
pesos y giros de 7,5°. La estrategia conservadora siempre participa, por lo que
agregar búsqueda nunca puede empeorar el resultado conocido.

Línea común, chain/bridge cutting y reordenamiento NC son una segunda capa:
pueden ahorrar corte y perforaciones, pero también elevar piezas o concentrar
calor. No se activan sólo porque dos bordes coinciden; requieren reglas por
material, espesor, extracción de piezas y aprobación del postprocesador.

### Niveles de certeza en plegado

- **Determinístico:** desarrollo, radio, ala mínima, tonelaje, largo útil,
  autocruce final y autocruce de cada estado intermedio.
- **Condicional:** orden sugerido y manipulación; el operario puede invertir o
  voltear la pieza y debe confirmar la primera unidad.
- **Pendiente de modelo:** colisión con punzón, matriz, tope y bastidor. Sólo se
  habilita cuando sus contornos reales estén cargados; una silueta genérica no
  puede certificar una pieza real.

## Arquitectura objetivo

### 1. Núcleo determinístico

Geometría, tiempos, nesting, plegado, costos, PDF y validadores continúan en
`src/core/`, ESM puro y sin servicios externos. Todo número que vende o fabrica
debe poder reproducirse en tests sin red, IA ni navegador.

### 2. API modular

Express es el límite transaccional. La API no duplica cálculos; persiste,
valida, audita y coordina cambios de estado. Los dominios evolucionan como
módulos: comercial, ingeniería, producción, stock, calidad, mantenimiento y
telemetría.

### 3. Datos

SQLite sigue siendo correcto para una planta local y una sola instancia. WAL,
transacciones y respaldos son obligatorios. Se migra a PostgreSQL sólo si hay
escritura concurrente desde varias sedes o despliegue de alta disponibilidad;
no por moda. Los eventos de máquina son append-only y las entidades de negocio
guardan su foto técnica al aprobarse.

### 4. Integración con máquinas

Orden de preferencia:

1. OPC UA for Machine Tools / Laser Systems.
2. API oficial o SDK del fabricante.
3. MTConnect.
4. Exportación de archivos/logs documentada por el OEM.
5. PLC/gateway industrial mediante un adaptador aislado.

Nunca leer directamente tablas internas del CNC ni automatizar clics en su HMI.
Primera etapa siempre **sólo lectura**. Enviar programas exige postprocesador del
modelo exacto, simulación, checksum, aprobación humana y respaldo del OEM.

Cada adaptador traduce a `kort.telemetria.v1`: máquina, fecha, estado, modo,
programa, OT, progreso, potencia, velocidad, gas, alarma y conteos de calidad.
Credenciales viven fuera del repositorio. La red de máquina no se publica a
internet y el servidor de ingestión autentica el puente.

## Inteligencia artificial responsable

“IA bien entrenada” no significa un chatbot genérico. Para KORT se aplica:

- **Extraer y sugerir:** requisitos de PDF, material, espesor, tolerancias,
  operaciones, riesgos, BOM y similitud con trabajos anteriores.
- **Nunca decidir sola:** precio final, escala de una imagen, material, DXF de
  producción, plegado, nesting liberado o programa CNC requieren confirmación.
- **Validación determinística posterior:** contornos cerrados, escala, unidades,
  área, agujeros, ligamentos, tonelaje, colisiones y límites de máquina.
- **Conjunto de evaluación real:** planos anonimizados de KORT, respuesta
  esperada y métricas por campo. No se libera una versión que empeora el set.
- **Proveniencia y confianza:** cada sugerencia indica archivo/página/zona,
  confianza y modelo usado. La corrección humana queda como feedback.
- **Privacidad:** no subir planos de clientes a un proveedor externo sin
  consentimiento y política definida. Debe existir modo local o sin IA.

El sistema ya “aprende” tiempos por estadística robusta. La IA futura complementa
eso; nunca reemplaza fórmulas físicas ni tablas de máquina.

## Diseño de interfaz

### Navegación por trabajo, no por tabla

- **Comercial:** RFQ, cotizaciones, clientes, seguimiento.
- **Ingeniería:** archivos, piezas, revisiones, 2D/3D, fabricabilidad.
- **Planificación:** material, nesting, agenda, compras.
- **Taller:** máquina en vivo, cola, programa, clasificación, plegado.
- **Calidad:** inspección, rechazo, retrabajo, trazabilidad.
- **Gestión:** costos, rentabilidad, mantenimiento, configuración y auditoría.

La barra actual puede crecer durante la migración, pero el destino es navegación
agrupada por estas áreas para no terminar con veinte enlaces iguales.

### Patrón de pantalla profesional

1. Encabezado con objetivo, estado global y acción primaria.
2. Alertas accionables antes que métricas decorativas.
3. KPIs con definición y período visible.
4. Área principal que responde la tarea del usuario.
5. Detalle progresivo; el operario no ve márgenes y el cliente nunca ve datos internos.
6. Estado vacío que explica cómo empezar.
7. Carga, error, desconexión y datos antiguos diseñados explícitamente.

### Modales

Un modal sirve para una decisión acotada o una edición corta. Un flujo con más
de dos pasos, comparación, plano grande o información persistente merece una
pantalla/panel. Ningún modal anidado. Cerrar con cambios pide confirmación. La
acción destructiva nombra exactamente qué afecta y si se recupera.

### Gráficos

Todo gráfico declara unidad, período, fuente y significado. No usar tortas con
muchas categorías ni ejes dobles sin leyenda. “En vivo” significa edad de la
última muestra visible. OEE sólo existe con disponibilidad, rendimiento y
calidad medidos; no se inventa con datos parciales.

## Capacidades mínimas de una metalúrgica completa

- CRM/RFQ y seguimiento comercial.
- Cotización versionada, aprobaciones y vigencia de costos.
- PDM: archivos, revisiones, assemblies/BOM y cambios de ingeniería.
- CAD/CAM: DXF, 2D/3D, fabricabilidad, nesting y postprocesado controlado.
- MRP/WMS: chapa, retazos, reservas, compras, recepción y ubicaciones.
- MES: cola, operaciones, tiempos, personal, máquina, clasificación y retrabajo.
- Plegado: desarrollos, herramientas, secuencia y control de primera pieza.
- QMS: plan de inspección, no conformidad, causa, acción y evidencia.
- Mantenimiento: preventivo por horas/ciclos, repuestos e incidentes.
- Costeo real: estimado versus real por OT y aprendizaje trazable.
- Entrega: embalaje, remito, factura e historial del cliente.
- Analítica: margen, conversión, entrega a tiempo, utilización y desperdicio.

## Calidad y escalabilidad

- Toda fórmula nueva lleva fuente, supuestos, unidad y test manual conocido.
- Toda mutación debe persistir, confirmar éxito y sobrevivir una recarga.
- Cambios de estado relacionados se hacen en una transacción.
- Contratos de integración se versionan y validan con Zod.
- Dependencias externas se justifican por capacidad mantenible; nada por CDN.
- Tests de núcleo, API y componentes críticos; build y prueba visual antes de publicar.
- Accesibilidad: teclado, foco, contraste, etiquetas y objetivos táctiles.
- Rendimiento: paginar históricos; resumir telemetría; no mandar años de datos al navegador.
- Observabilidad: salud de base, adaptadores, edad de datos, errores y respaldos.
- Seguridad: mínimo privilegio, secretos fuera de Git y telemetría separada del control CNC.

## Regla de priorización

1. Seguridad y verdad de fabricación.
2. Evitar vender a pérdida.
3. Ahorrar material.
4. Reducir plazo y errores de taller.
5. Mejorar conversión comercial.
6. Automatizar lo repetitivo.
7. Recién después, funciones vistosas.

Cada fase del roadmap debe declarar impacto, datos requeridos, riesgo, prueba de
aceptación y qué referente industrial cubre. “La competencia lo tiene” justifica
investigar; no justifica agregar complejidad sin un problema de KORT.
