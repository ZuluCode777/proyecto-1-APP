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
- `respuestaSeguraParaMostrar` también rechaza órdenes de abordaje en el texto
  o en los pasos de respuestas informativas; un `search` no basta para certificar
  una abstención segura.
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
  y marca todas), exige permiso de subir o bajar y renueva la validación cada
  30 segundos mientras permanece abierto; usa `estadoCalendarioEnFecha` en pantalla y voz (vencido/
  desconocido no dice «no hay servicio»); separa el horario publicado de la
  disponibilidad actual; avisa el sentido sin confirmar también para
  indeterminado/sin verificar; conserva voz automática y botón Escuchar.
- **diagnostics**: valida el payload real del asistente con el catálogo y
  `respuestaSeguraParaMostrar`; rechaza un viaje forjado y una abstención con
  órdenes de abordaje en texto o pasos. Fuera de horario puede abstenerse
  honestamente. No hay parámetro
  `now` público en la API ni se congela el reloj productivo; la prueba positiva
  determinista con reloj fijo vive en los tests unitarios.

## Comandos ejecutados

- `pnpm exec tsc --noEmit` → sin errores.
- `pnpm test` → 98 pruebas, 0 fallos (incluye reloj fijo 2026 y 2027, el borde
  de franja, el contenido inseguro de una abstención y los payloads forjados).
- `pnpm build` → compilación de producción correcta.
- `pnpm verificar http://127.0.0.1:3218` → **9/9** en el host del coordinador,
  contra la compilación de producción, con Chrome y clave de prueba. Catálogo
  en vivo: 153 estaciones y 124 rutas. Micrófono, cámara y ubicación simulados;
  no constituye una prueba física de accesibilidad ni operación del transporte.
- Siete regresiones adicionales en Chrome: H72/Calle 127 bloqueado antes de
  subtítulo/voz; 8 T reconstruido sin conteo no verificado; vencimiento del plan
  abierto; vencimiento antes de navegar; cierre de franja durante la animación;
  órdenes ocultas en un `search`; renovación del calendario y las marcas del
  detalle abierto, sin marcar Calle 187 en 8 T.
- Revisión independiente final sin hallazgos funcionales. También ejecutó seis
  casos del diagnóstico real, dos del flujo de animación y seis del núcleo.

## Límites

- No hay tiempo real: estar en franja es horario programado, no garantía de que
  pase un bus. La evidencia del GTFS es del 3 de noviembre de 2026; por su fecha
  civil es utilizable mientras su antigüedad no supere `MAX_EVIDENCIA_DIAS` (31
  días), es decir hasta el 4 de diciembre inclusive, y desde el 5 de diciembre
  la app se abstiene por antigüedad. Debe regenerarse del GTFS vigente. Una
  evidencia vencida o fuera de la ventana de vigencia del calendario queda
  `sin-verificar`: la app se abstiene, nunca afirma que no haya servicio.
- Solo 8 G y 8 T tienen evidencia GTFS integrada; ampliar a más servicios es
  aditivo sobre `servedStops`.
- Calle 53 queda fuera del patrón mapeado por no estar en la capa de estaciones.
- Las franjas son primera y última salida programadas, no la próxima salida ni
  una garantía de servicio continuo. En un transbordo ambos abordajes se evalúan
  contra la hora actual; no se inventan tiempos de viaje ni de llegada.
- Calle 187 en 8 T conserva evidencia informativa (aparece en el patrón con más
  viajes) pero NO es prescriptible: su `status` es `sin-verificar` con
  `canBoard`/`canAlight` en falso hasta distinguir el patrón, porque hay viajes
  de 8 T que la omiten. Por eso el planificador no ordena subir ni bajar allí en
  8 T, y el conteo del servicio no es exacto.
- No se tocaron GPS, foco ni otros issues (32/33/34), ni workflows, secretos,
  infraestructura o Windows.
