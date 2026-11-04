# EA-05 (#31): paradas verificadas, sentido y calendario

Rama `ea-05-paradas-verificadas-sentido`. Esta nota describe el estado final del
trabajo; no es un registro histórico. Todo en español, según `AGENTS.md`.

## Problema

El catálogo deducía las paradas de cada servicio por cercanía geométrica
(≤ 60 m a la línea) y el planificador trataba esa cercanía como un lugar donde
se puede subir, bajar o transbordar. Eso produce instrucciones inseguras: un
expreso pasa cerca de una estación sin detenerse, y las etiquetas de sentido
(`from`/`to`) podían contradecir el orden real del recorrido (8 G y 8 T).

## Qué entrega

Una consulta de viaje solo indica subir, bajar o transbordar cuando hay
evidencia de paradas atendidas, sentido confirmado y servicio dentro de su
franja programada. La geometría sigue disponible como recorrido ilustrativo.

### Separación recorrido vs. parada atendida (contrato aditivo)

- `BusRoute.stops`: estaciones CERCANAS AL TRAZADO, solo para ilustrar el
  recorrido; estar en la lista no prueba que el servicio pare.
- `BusRoute.servedStops`: paradas ATENDIDAS verificadas, con `order`,
  `canBoard`/`canAlight`, `source`, `date`, `status`, `nodeId`, `franjas`
  (horas programadas por `serviceId`) y `conteoExacto`. Vacío si no hay
  evidencia; nunca se rellena por proximidad.
- `BusRoute.verifiedCalendar`: calendario verificado (servicios del GTFS,
  excepciones, ventana de vigencia, zona horaria). Sin él no se afirma
  operación ni salida inmediata.
- `directionEvidence`: reconciliación del sentido; solo `verified` + `consistente`
  habilita prescribir.

### Validación compartida (`lib/evidencia.ts`)

Único responsable de decidir si una parada o un calendario pueden sustentar una
instrucción. Rechaza fuente vacía, fecha de evidencia vacía/malformada/futura/
vencida (`MAX_EVIDENCIA_DIAS = 31`), estado no operativo, secuencia con `order`
duplicado y sentido sin confirmar. Distingue tres estados de calendario
(`estadoCalendarioEnFecha`: `opera` | `no-opera` | `sin-verificar`) y cuatro de
operación en parada (`estadoOperacionEnParada`: `en-franja` | `fuera-de-franja`
| `sin-servicio-hoy` | `sin-verificar`), evaluados en fecha/hora de Bogotá, con
excepciones y con las horas GTFS que pasan de las 24:00. «Vencido» o
«desconocido» NUNCA equivalen a «no hay servicio».

### Planificador y asistente

- `planTrip` es la ÚNICA puerta prescriptiva: paradas verificadas, sentido
  confirmado y abordaje en franja ahora. `planTripCandidato` informa un viaje
  cuya operación actual no está confirmada, sin dar órdenes.
- `tripSummaryStillValid(legs, data, now)` revalida un resumen (sentido,
  paradas, franja, máximo un transbordo conectado, conteos coherentes).
- `respuestaPrescriptivaValida(reply, data, now)` valida el resumen de una
  respuesta; no certifica el texto libre `reply.reply`.
- El texto y los pasos prescriptivos se reconstruyen desde el resumen validado
  con la función responsable compartida (`textoViajeDesdeResumen`), no desde la
  prosa recibida. El número exacto de estaciones solo se dice si
  `conteoVerificado` es `true`.

## Fuente de evidencia

GTFS oficial diario de TransMilenio S.A.:
`https://gtfs.transmilenio.gov.co/manifest.json` (generado 2026-11-03T04:19:59-05:00)
y `https://gtfs.transmilenio.gov.co/GTFS.zip` (119 934 110 bytes, SHA-256
`2e916be87f4341edcc894fc2185875e63df1e6f6b8f8ecabbf81a5310bd87f43`).

**Licencia:** el catálogo distrital (CKAN, `package_show` de
`especificacion-gtfs-general-transport-feed-specification-sitp`) declara
**CC-BY-SA-4.0** para su conjunto GTFS, con metadatos de 2022/2023 (declaran la
licencia, no la frescura). El portal nuevo, su manifest y el ZIP diario no
repiten ese aviso; no se inventa una licencia propia del endpoint ni se toma la
ausencia de aviso por prohibición. **Atribución: TransMilenio S.A.**

**Qué se transcribió** (en `lib/evidencia-gtfs.ts`, extraído por streaming de
`stop_times.txt` de 573 MB; el ZIP crudo de 120 MB no se versiona):

- Calendario de los `service_id` de 8 G y 8 T: 1 (lunes a viernes), 2 (sábado),
  4 (domingo/festivo), vigencia 2026-01-01..2026-12-31, zona `America/Bogota`,
  con las 19 excepciones por servicio (incluye 2026-11-16).
- Patrón de paradas completo con más viajes de cada servicio
  (route_id 13307 = 8 G, 13308 = 8 T), 27 paradas GTFS → **26 mapeadas** por
  sentido: **Calle 53** (`parent_station` 90012) no está en la capa de
  estaciones del catálogo y queda fuera; no se inventa. Cada parada trae su
  primera y última salida programada por `service_id`.
- **8 T** tiene variantes que omiten Calle 187 (7 viajes) y otras parciales;
  por eso su `conteoExacto` es `false` y no se dice un número exacto de
  estaciones. 8 G tiene `conteoExacto` `true`.

### Reconciliación 8 G / 8 T

GIS traía `orig_ruta`/`dest_ruta` invertidos en ambos. Se corrigió
`from`/`to`/`label` desde el GTFS (8 G: Terminal → Guatoque - Veraguas; 8 T:
Guatoque - Veraguas → Terminal), con `directionEvidence.verified = true`. Se
**preserva** la geometría (`stops`, `path`); no se invierte nada ni se tocan los
demás servicios. La corrección se aplica en vivo (`normalizeTransmilenio`) y
sobre la copia (`lib/transmilenio-data.ts` y la migración), para que llegue a la
app sin depender del origen de datos.

### H72 no para en Calle 127

El GTFS (route_id 13476) no incluye el nodo 2202 (Calle 127) en ningún patrón;
H72 queda sin `servedStops`, así que el planificador se abstiene y nunca ofrece
abordar en Calle 127. Evidencia independiente del aviso de 2018.

## Consumidores

- **total-agent**: revalida la respuesta contra el catálogo más reciente (ref,
  no cierre sobre datos viejos) y el reloj actual ANTES de pasos/subtítulo/voz y
  otra vez antes de navegar; reconstruye el texto prescriptivo desde el resumen
  validado; degrada a un aviso seguro si el viaje ya no es prescriptible.
- **trip-view**: oculta el número de estaciones si `conteoVerificado` es
  `false`; revalida con un temporizador acotado mientras la pantalla sigue
  abierta; un resumen invalidado se muestra como trazado/información sin
  imperativos.
- **route-detail**: marca cada parada con `paradasPrescriptibles` (no valida una
  y marca todas); usa `estadoCalendarioEnFecha` en pantalla y voz (vencido/
  desconocido no dice «no hay servicio»); separa el horario publicado de la
  disponibilidad actual; avisa el sentido sin confirmar también para
  indeterminado/sin verificar; conserva voz automática y botón Escuchar.
- **diagnostics**: valida el payload real del asistente con el catálogo y
  `respuestaPrescriptivaValida`; un payload forjado (abordar H72 en Calle 127)
  debe fallar; fuera de horario puede abstenerse honestamente. No hay parámetro
  `now` público en la API ni se congela el reloj productivo; la prueba positiva
  determinista con reloj fijo vive en los tests unitarios.

## Comandos ejecutados

- `pnpm exec tsc --noEmit` → sin errores.
- `pnpm test` → 91 pruebas, 0 fallos (incluye reloj fijo 2026 y 2027).
- `pnpm build` → compilación de producción correcta.
- `pnpm verificar`: **no se ejecutó en este entorno.** El arnés usa Chrome
  headless y Chrome-for-Testing no inicializa en este contenedor (crashpad/
  zygote). No se reintenta con flags ni se modifica CI; el coordinador correrá
  `pnpm verificar` en su host.

## Límites

- No hay tiempo real: estar en franja es horario programado, no garantía de que
  pase un bus. La evidencia caduca (`MAX_EVIDENCIA_DIAS`) y debe regenerarse del
  GTFS vigente; en 2027 el calendario y las paradas quedan `sin-verificar` y la
  app se abstiene, sin afirmar que no haya servicio.
- Solo 8 G y 8 T tienen evidencia GTFS integrada; ampliar a más servicios es
  aditivo sobre `servedStops`.
- Calle 53 queda fuera del patrón mapeado por no estar en la capa de estaciones.
- Riesgo señalado por revisión (en observación, sin resolver aún): 8 T tiene
  viajes que omiten Calle 187; quitar el conteo puede no bastar para ordenar
  bajar allí sin seleccionar patrón. Se conservan los datos del núcleo mientras
  llega el hallazgo corroborado.
- No se tocaron GPS, foco ni otros issues (32/33/34), ni workflows, secretos,
  infraestructura o Windows.
