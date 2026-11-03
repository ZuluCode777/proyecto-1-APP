# Metro de Bogotá: investigación para la segunda entrega de ExpoAndes

Fecha del informe y de consulta de todas las fuentes: **2026-11-02** (America/Bogota). Repositorio: `ZuluCode777/proyecto-1-APP`, revisión local `0abca8c`. Alcance: investigación documental, inspección de datos públicos y auditoría de su posible incorporación a TransMiVoz. No se implementaron funciones, no se crearon issues en GitHub y no se accedió al equipo Windows.

## Decisión recomendada

La segunda entrega puede mostrar un catálogo educativo de las 16 estaciones de la Línea 1, marcado permanentemente como proyecto **en construcción, sin servicio comercial**. Debe quedar fuera del planificador real de TransMilenio. La Línea 2 pertenece a otro estado: contratación/precalificación, con trazado proyectado. Su presencia en un servicio cartográfico no demuestra construcción ni operación. [F1, F2, F3]

Hay datos espaciales oficiales y licencia abierta, pero su integración requiere resolver inconsistencias: el GeoJSON de estaciones contiene coordenadas proyectadas sin declarar CRS; sus coordenadas coinciden exactamente con el SHP que declara un sistema local. La consulta REST de estaciones falló; una consulta de la capa de trazado de la primera línea devolvió también la segunda. No hay base para inventar 16 pares de latitud/longitud ni para presentar centroides como accesos oficiales. [F8–F12, F21]

## Método, alcance de las afirmaciones y confianza

Se abrieron publicaciones del Distrito, páginas y respuestas de Catastro/IDECA, archivos descargables de la Empresa Metro de Bogotá (EMB) y un comunicado de TransMilenio. Los resultados de búsqueda sirvieron para localizar documentos, no como prueba final. Las notas del Portal Bogotá identifican a la EMB como fuente institucional; son evidencia primaria de lo comunicado por el Distrito, aunque no sustituyen planos contractuales ni actas de puesta en servicio.

- **Alta:** afirmación explícita en fuente institucional abierta o resultado reproducible de un archivo/consulta inspeccionado.
- **Media:** propuesta o inferencia que relaciona fuentes, o información histórica cuya vigencia técnica no está confirmada.
- **Pendiente:** evidencia insuficiente para publicar el dato como vigente; conservar `null` o una advertencia.

Las publicaciones combinan información técnica y comunicación favorable al proyecto. Se extraen identificadores, fechas y estados; expresiones promocionales como que el Metro «ya es una realidad» no se interpretan como operación comercial. La auditoría de código es estática: demuestra comportamiento implementado, no el estado actual de todas las paradas de buses.

## Estado de las líneas y fechas

| Proyecto | Estado acreditado al corte | Horizonte comunicado, sujeto a cambios | Confianza y límite |
| --- | --- | --- | --- |
| Línea 1, tramo de 16 estaciones | Construcción y pruebas dinámicas. Balance publicado el 28-10-2026: avance general de 83,73 %, medido al 30-09-2026. | Operación comercial prevista para marzo de 2028. Otra comunicación distrital menciona el objetivo del 15-03-2028. | Alta sobre lo publicado; no es garantía de apertura. Pruebas de trenes no son servicio al público. [F1, F4] |
| Línea 2 | Proceso anterior declarado desierto el 20-01-2026; el 07-09-2026 se recibieron tres solicitudes de precalificación. Comunicación posterior consultada las describe en evaluación. | Adjudicación objetivo: primer trimestre de 2027; firma/inicio previstos durante el segundo semestre de 2027 según comunicación de septiembre. Operación proyectada en 2035 según anuncio de enero. | Alta sobre hitos publicados; media sobre cronograma futuro. No se encontró en las fuentes abiertas una adjudicación posterior que permita cambiar ese estado. [F2, F3, F4] |
| Línea 3 | Estudios de factibilidad, según comunicación distrital consultada. | Estudios previstos para mayo de 2027. | Alta como anuncio; fuera del dataset mínimo. [F4] |
| Línea 4 y extensión de Línea 1 hasta calle 100 | Posibilidad de estudios para Línea 4; estudio de extensión de Línea 1 mediante iniciativa privada. | Sin fecha de servicio validada en esta investigación. | No son estaciones adicionales del tramo E1–E16 ni red disponible. [F4] |

Línea 2 está proyectada entre calle 72 y Fontanar del Río, con 15,5 km y 11 estaciones: diez subterráneas y una elevada. Estos datos describen alcance futuro. No mezclar sus estaciones E1–E11 con E1–E16 de Línea 1. [F2]

## Las 16 estaciones de Línea 1

La numeración técnica es la referencia más resistente a cambios de nombre encontrada: el Distrito publica **E1–E16** [F5] y el archivo oficial de estaciones utiliza `NUMERO="01"…"16"` y `NOMBRE="E01"…"E16"` [F10]. No se encontró una garantía institucional de inmutabilidad ni un identificador mundial de parada. Por tanto, `metro-bogota-l1-e01` sería una clave interna propuesta, no un código oficial. `OBJECTID` no sirve como identidad de negocio: en ese archivo E01 es el objeto 16.

Todos los registros siguientes tienen estado de línea **en construcción** y servicio comercial **no disponible** al corte. Ubicación indica corredor y tramo publicado, no dirección de un acceso peatonal. Los nombres de la columna SIG son históricos del archivo descargable de 2022; no sustituyen nombres públicos anunciados en 2026. [F1, F5, F6, F10]

| ID técnico / SIG | Nombre de referencia SIG de 2022 | Nombre público anunciado, para mostrar junto al ID | Corredor y tramo publicados | Intercambio TM documentado, siempre futuro |
| --- | --- | --- | --- | --- |
| E1 / E01 | Cra 96-01 | Gibraltar | Villavicencio; carreras 94–93 | No acreditado en las fuentes consultadas. |
| E2 / E02 | Portal de las Américas-02 | Portal Américas | Villavicencio; carreras 86B–86G | Directo con Portal Américas; fuente describe conexión mediante edificios, escaleras y ascensores. [F7] |
| E3 / E03 | Carrera 80-03 | Ciudad Kennedy | Villavicencio; carreras 80D–80G | No acreditado en las fuentes consultadas. |
| E4 / E04 | Calle 42 Sur-04 | Timiza | Primero de Mayo; calles 42 sur–42C sur | No acreditado en las fuentes consultadas. |
| E5 / E05 | Kennedy-05 | Hospital de Kennedy | Primero de Mayo; calles 40 sur–39 sur | No acreditado en las fuentes consultadas. |
| E6 / E06 | Av Boyaca-06 | Avenida Boyacá | Primero de Mayo; Boyacá–carrera 72C | Plano muestra futura estación y troncal Boyacá; modalidad y disponibilidad pendientes. [F14] |
| E7 / E07 | Av 68-07 | Nombre pendiente en comunicación de junio de 2026 | Primero de Mayo; avenida 68–carrera 52C | Integración futura acreditada; plano muestra futura estación de troncal 68. Nombre y modalidad final pendientes. [F6, F15] |
| E8 / E08 | Cra 50-08 | Puente Aranda | Primero de Mayo; glorieta de carrera 50 | No acreditado en las fuentes consultadas. |
| E9 / E09 | NQS-09 | SENA | NQS; diagonal 16 sur–calle 17A bis sur | Conexión directa enumerada sobre NQS. No se validó ID vigente de contraparte TM. [F7] |
| E10 / E10 | Nariño-10 | Santa Isabel | Calle 1; carreras 24–24C | No acreditado en las fuentes consultadas. |
| E11 / E11 | Calle 1ra-11 | Hospital (HOMI) | Caracas; calles 2–3 | Conexión directa enumerada como Hospital. [F7] |
| E12 / E12 | Calle 10-12 | Avenida Jiménez | Caracas; calles 11–13 | Conexión directa enumerada como Avenida Jiménez. [F7] |
| E13 / E13 | Calle 26-13 | Central | Caracas; calles 24A–26 | Directa según publicación de julio de 2026; documento urbano de 2019 decía proximidad. Contraparte/recorrido final sin validar. [F7, F16] |
| E14 / E14 | Calle 45-14 | Calle 45 | Caracas; calles 42–44 | Conexión directa enumerada como Calle 45. [F7] |
| E15 / E15 | Calle 63-15 | Calle 63 | Caracas; calles 61–63 | Conexión directa enumerada como Calle 63. [F7] |
| E16 / E16 | Calle 72-16 | Calle 72 | Caracas; calles 72–74 | Conexión directa enumerada como Calle 72. [F7] |

Confianza: alta en numeración, transcripción de los tramos publicados, nombres explícitos y lista de ocho conexiones directas; media en vigencia fina de los tramos de la publicación de 2020. El nombre Central está confirmado aparte por una publicación distrital del 24-04-2026 [F13], porque la nota de nombres de junio omite E13 de su enumeración aunque afirma que 15 estaciones tienen nombre [F6]. La numeración completa se verificó en los 16 objetos del archivo [F10]. «No acreditado» significa ausencia de evidencia encontrada, no prueba de que nunca exista conexión.

### Nombres públicos, denominaciones de obra y nombres comerciales

Ciudad Kennedy, Timiza y Santa Isabel fueron anunciados como resultados de votación para E3, E4 y E10 el 24-06-2026. Los nombres del archivo SIG —por ejemplo Carrera 80, Calle 42 Sur y Nariño— permanecen como alias documentales, no como nuevos IDs. No usar «Avenida 68» como nombre definitivo de E7: es una referencia del corredor; la comunicación de junio deja su selección pendiente. [F6, F10]

Los nombres anunciados son denominaciones públicas para un sistema futuro. No se encontró en las fuentes consultadas un acto de patrocinio o de nombres comerciales que autorice a asumir permanencia de marcas. Un nombre comercial posterior debe ser un atributo versionado, sin cambiar identidad técnica ni fusionar estaciones por texto. En particular, Calle 26–Atrio de TransMilenio es una estación de buses: su habilitación completa el 20-06-2026 no significa apertura de E13-Central del Metro. El comunicado del operador identifica expresamente el sistema y también informa cierre definitivo de Calle 34. [F17]

### Precisión pendiente en los intercambios

La comunicación del 06-03-2026 habla de **ocho integraciones directas y dos por proximidad**, pero no identifica las dos últimas [F18]. La publicación del 15-07-2026 sí enumera las ocho directas: E2, E9, E11, E12, E13, E14, E15 y E16 [F7]. Las fichas muestran futuras troncales en E6 y E7 [F14, F15]; esto permite proponerlas como candidatas a verificar, pero no completar por deducción una tabla oficial de dos conexiones por proximidad.

Existe discrepancia temporal para E13: el documento de Planeación de febrero de 2019, página impresa 154, describe proximidad [F16]; la nota distrital de julio de 2026 la incluye como directa [F7]. Para catálogo educativo se puede presentar la previsión más reciente con su fecha y advertencia. Para un enlace de transbordo navegable falta plano vigente, contraparte TM con ID y recorrido accesible. Ninguna integración futura constituye una arista utilizable hoy.

## Datos espaciales oficiales: disponibilidad, CRS y licencia

Los catálogos de estaciones y trazado atribuyen la información a EMB y declaran **Creative Commons Attribution 4.0**. El metadato indica fecha del dato 18-04-2022 y EPSG:3857; la modificación del metadato es 16-06-2026 para estaciones y 05-10-2026 para trazado. Modificar metadatos no acredita levantamiento nuevo ni actualización de accesos. Las descargas GeoJSON figuran modificadas el 05-05-2022 en la API CKAN. [F8, F9, F19]

| Recurso inspeccionado | Evidencia obtenida | CRS comprobado y uso permitido técnicamente |
| --- | --- | --- |
| REST Catastro, capa 0: estaciones [F11] | Metadatos legibles; geometría `esriGeometryPolygon`; campos `NUMERO`, `NOMBRE`, `REFNAME`, `TIPO`. Consultas de atributos, geometrías e IDs devolvieron error ArcGIS 400, `Unable to complete operation.` | Metadatos declaran `wkid=102100`, `latestWkid=3857`: Web Mercator, metros. No se obtuvo una respuesta de estaciones reproyectada a 4326; no se confirma disponibilidad efectiva de sus coordenadas mediante esa consulta. |
| REST Catastro, capa 1: trazado [F12] | Metadatos anuncian primera línea. Consulta con `outSR=4326` devolvió dos entidades: `LINEA=Primera` y `LINEA=Segunda`; una trayectoria cada una, con 8.494 y 1.229 vértices respectivamente. | Metadatos nativos: 3857. Respuesta comprobada: `spatialReference.wkid=4326`; pares `[longitud, latitud]`. Seleccionar por atributo de línea y validar resultado; no seleccionar solo por nombre de capa. |
| Descarga `estaciones.geojson` [F10] | 16 entidades `MultiPolygon`, numeración completa. Primer vértice de E02: `[89482.40880000032, 103797.84600000083, 0.0]`. Sin miembro `crs`. | Sus números no son longitud/latitud ni Web Mercator. Los 97 pares XY coinciden exactamente, en orden y valor, con el SHP de F21. Esa comprobación vincula sus coordenadas con `PCS_CartMAGBOG`; la atribución de CRS se obtiene por correspondencia entre recursos, no por metadato embebido. Rechazar importación directa a Leaflet. |
| Descarga `trazado_plmb.geojson` [F20] | Una entidad `MultiLineString`. Primer vértice: `[87118.59229999967, 105675.71829999983, 0.0]`. Sin miembro `crs`. | También usa coordenadas proyectadas no identificadas dentro del archivo. No asumir 4326 por extensión `.geojson`, ni 3857 por la ficha del catálogo. |
| Descarga SHP de estaciones [F21] | ZIP contiene `ESTACIONES.prj` y archivos SHP/DBF. Se inspeccionó WKT y se compararon las 16 geometrías con F10. | Declara `PCS_CartMAGBOG`, proyección Transverse Mercator en metros, falso este 92334.879, falso norte 109320.965, meridiano central −74.14659166666667 y origen 4.6804861111111. Es definición local; no se asignó un EPSG por parecido. La igualdad de las geometrías respalda el vínculo con el GeoJSON de estaciones; no con el de trazado. |

El `.prj` además define elipsoide `GRS80 Modificado`, semieje 6380687.0 e inverso del achatamiento 298.257222101. No sustituirlo silenciosamente por WGS84. Falta validar transformación/datum y control con puntos oficiales antes de generar posiciones utilizables; la correspondencia del GeoJSON de trazado sigue pendiente. Las geometrías de estaciones son polígonos de infraestructura; un vértice o centroide no es una entrada, un punto de abordaje ni un trayecto peatonal accesible.

La presencia de capas 4 y 5 para Línea 2 en el servicio tampoco prueba operación. Además, la entidad de Línea 2 devuelta por la consulta de trazado advierte que la información está sujeta a estudios de detalle del concesionario. [F12]

### Consultas y huellas para reproducir la inspección

Solicitudes públicas, sin credenciales:

- [Metadatos REST de estaciones](https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/movilidad/metrobogota/MapServer/0?f=pjson).
- [Consulta de atributos de estaciones que devolvió error](https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/movilidad/metrobogota/MapServer/0/query?where=1%3D1&outFields=*&returnGeometry=false&f=json).
- [Consulta de trazados con salida 4326](https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/movilidad/metrobogota/MapServer/1/query?where=1%3D1&outFields=*&outSR=4326&f=json).

SHA-256 de los cuerpos descargados, después de descomprimir transporte HTTP; permiten detectar cambios, no autentican contenido futuro:

| Respuesta | Bytes inspeccionados | SHA-256 |
| --- | --- | --- |
| GeoJSON estaciones | 9.781 | `48ed2ef68b7f199ddc4cd8a9a4854ad5093db19c48f6eab925e4cfe4411d21fa` |
| GeoJSON trazado | 474.332 | `1b71a51d3a5ad9f105efd17f68bd61e6d013631087f9a719541a7079a7432d50` |
| Consulta REST trazados, 4326 | 397.574 | `4ab632329f9b3c0869ab600253d1ad97fdcf1634899118fc8dc6ddcfa14543aa` |

La licencia del catálogo exige atribución; al redistribuir, conservar entidad, URL, fecha de consulta, enlace de licencia y descripción de cambios o transformaciones. No se verificó una licencia independiente para cada posible servicio alternativo de ArcGIS: no extender automáticamente esta autorización a capas de terceros. [F8, F9, F22]

## Dataset mínimo tentativo para la demostración

Propuesta de diseño, todavía sin archivo de datos ni implementación. Su contenido respaldado son las 16 filas anteriores; geometría de estaciones, accesos, horarios, tarifas y tiempos permanecen vacíos hasta validación.

| Componente | Contenido mínimo | Regla de aceptación |
| --- | --- | --- |
| Catálogo de línea | `id_interno`, número 1, entidad EMB, `estado="en_construccion"`, `servicio_comercial=false`, corte y fuentes. | Mostrar estado y fecha también en voz/lectura accesible. No cambiarlo automáticamente al llegar marzo de 2028. |
| Estaciones | 16 registros; clave interna con prefijo de sistema/línea, `identificador_oficial` E01–E16, `numero_oficial`, nombre público, alias SIG, corredor y fuentes por dato. | 16 números únicos. E7 conserva nombre pendiente. Los alias no unen nodos Metro y TM. |
| Geometría de estación | `null` inicialmente; referencia al recurso oficial y motivo de bloqueo. | Solo incorporar geometría con CRS del recurso confirmado y transformación documentada. Un marcador derivado debe identificarse como representación, nunca acceso oficial. |
| Trazado ilustrativo | Opcional: entidad de Línea 1 obtenida mediante consulta 4326 validada, conservando procedencia, fecha y licencia. | Excluir Línea 2 por atributo. Guardar copia revisada para la demo; indicar que representa proyecto y no servicio. Si no supera validación, usar listado sin mapa. |
| Integraciones | Ocho referencias de conexión directa prevista; E6/E7 como referencias futuras pendientes de clasificación; discrepancia E13 preservada. | `habilitada_para_ruteo=false` para todas. ID de contraparte TM `null` mientras no exista correspondencia validada. |
| Horizonte | «Operación prevista: marzo de 2028», fecha de fuente y nivel de certeza. | No inventar horarios, tarifa, frecuencia, ETA o tiempo de caminata. |
| Línea 2 | Solo ficha de contexto en contratación/precalificación, si se necesita explicarla. | Ninguna estación o geometría suya entra en las 16 filas de Línea 1. |

La demo mínima consiste en consultar estación por número/nombre, leer su corredor y explicar una integración futura con cita. No necesita simular un viaje. Si se decide añadir recorridos hipotéticos en otra entrega, deberán identificarse como simulación en cada resultado y permanecer aislados de las indicaciones de viaje reales.

### Invariantes para aislar estados y sistemas

1. El catálogo Metro no entra en `TransmilenioData.stations` ni en `routes`, ni alimenta `findPlaces`, `nearestStations`, `planTrip` o instrucciones de subir/bajar de un bus. Separar datos y consumidores en el límite de entrada; una etiqueta visual aislada no basta.
2. La procedencia (`live`/`snapshot` en el sistema actual) y el estado de servicio son dimensiones distintas. Una consulta en vivo puede contener infraestructura futura; una copia guardada no prueba vigencia operacional.
3. Coincidencia de nombre o cercanía geográfica no autoriza intercambios. Una futura estación Calle 72 del Metro y una estación TM homónima conservan identidades distintas. Tampoco fusionar Línea 1 E01 con Línea 2 E01.
4. Si no hay evidencia de acceso o geometría validada, el valor queda ausente y la interfaz lo comunica. No completar datos mediante coordenadas aproximadas ni geocodificación presentada como oficial.
5. Cualquier habilitación futura del Metro requiere decisión explícita sustentada en confirmación oficial de servicio, paradas, horarios e intercambios vigentes; no un cambio de fecha, nombre o porcentaje de obra.

## Auditoría relevante de la app actual

Evidencia local consultada en `0abca8c`, sin modificar código:

- `lib/transmilenio.ts:122–148` construye `stops` por distancia al trazado, con umbral de 60 metros declarado en línea 23. Esa lista representa cercanía/recorrido, no patrón de paradas confirmado. El propio comentario inicial lo reconoce. `components/route-detail.tsx:86–88` ya advierte que un expreso no para en todas: conservar esa claridad.
- `lib/routes.ts:163–203` usa esa lista para elegir subida, bajada y transbordo; `components/trip-view.tsx:72–76` presenta instrucciones «Sube», «Cambia» y «Bájate». La inferencia geométrica pasa así a recomendación operacional. Es una limitación verificable por lectura del flujo; no se verificó en campo una ruta concreta equivocada.
- `lib/transmilenio.ts:188–190` filtra servicios con `comp_sitp=1 AND est_ruta=1`, pero consulta estaciones con `where=1=1`. No hay filtro de estado de estaciones en esa consulta. No se concluye que todas estén cerradas o que el servicio publique un campo apropiado: falta comprobarlo con contrato de datos vigente.
- `lib/transmilenio-data.ts:11–27` mantiene consulta en caché seis horas y usa copia local si falla la red, con reintento cinco minutos después. La copia inspeccionada contiene 153 estaciones, 124 rutas y `fetchedAt="2026-09-24T15:16:41.502Z"`. Seis horas de caché y procedencia pública no equivalen a alertas de operación en tiempo real.
- `StationSchema` y `BusRouteSchema` (`lib/transmilenio.ts:25–56`) no contienen modo, estado de obra/servicio ni procedencia de cada parada. Añadir estaciones Metro a esos arreglos eliminaría la separación necesaria para GPS y planificador. Es riesgo de una integración futura, no evidencia de que hoy ya exista Metro en el dataset.
- `docs/DEMO.md:100` usa la pregunta sobre buses que «paran» en Héroes como ejemplo, mientras el límite reconocido es «pasan por el recorrido» (`docs/DEMO.md:140–141`). El guion debe alinear promesa y evidencia antes de presentar capacidades al jurado.

## Issues propuestos, en orden de ejecución

Son propuestas documentales para segunda entrega; **no creadas en GitHub**. Dependencias indican secuencia mínima, no autorización de implementación.

### 1. P0 — Aislar catálogo Metro del ruteo y GPS de TransMilenio

Problema: los tipos y consumidores actuales no separan obra, simulación y servicio. Una carga ingenua produciría estaciones cercanas o viajes no disponibles.

Alcance mínimo: establecer contrato de datos independiente para catálogo futuro, identidad por sistema/línea y estado explícito. Criterios: ninguna estación ni conexión Metro aparece en planes TM, GPS operativo o instrucciones de abordaje; consultar «Metro» informa construcción y horizonte con fuente. Verificación futura: casos positivos TM y negativos Metro en búsqueda, planificación y cercanía. Depende de ninguna otra issue; bloquea cualquier importación de datos Metro.

### 2. P0 — Evitar indicaciones de abordaje sustentadas solo en geometría

Problema: `stops` inferido alimenta recomendaciones de subir/bajar/transbordar, aunque no confirma paradas de expresos.

Alcance mínimo: obtener secuencias oficiales verificadas de paradas por servicio/sentido o limitar la función a consulta de recorridos y comunicar que no puede confirmar viaje. Criterios: cercanía al trazado nunca basta para indicar abordaje o transbordo; voz, pantalla de viaje y guion describen el mismo límite. Verificación futura: expreso que atraviesa estación sin parar, variante de sentido y transbordo. No hace falta solucionar toda la red para reconocer y acotar el límite en segunda entrega.

### 3. P1 — Curar catálogo trazable de las 16 estaciones

Depende de 1. Alcance: transcribir tabla, conservar IDs técnicos, separar alias históricos y nombres anunciados, registrar estado/fuente/fecha. Criterios: E01–E16 únicos; E7 pendiente; Central respaldada por F13; no crear estación 17 ni incluir Línea 2. Integraciones futuras sin aristas operativas. Revisión de las 16 filas contra fuentes, sin coordenadas fabricadas.

### 4. P1 — Resolver contrato geoespacial antes de mostrar estaciones en mapa

Depende de 1 y 3. Alcance: confirmar CRS de cada descarga, resolver error de consulta de estaciones o elegir recurso oficial alternativo con licencia acreditada, y documentar transformación. Criterios: respuestas sin error/truncamiento, línea explícita, geometrías válidas, orden de ejes correcto y correspondencia de 16 números; comparar con plano oficial. Rechazar GeoJSON sin CRS verificable y trazados mezclados. Si sigue bloqueado, entregar catálogo textual accesible y dejar mapa de estaciones fuera de alcance.

### 5. P1 — Verificar vigencia TM y hacer visible fecha/procedencia

Problema: cierres y reconstrucciones modifican estaciones; una copia del 24-09-2026 puede no representar estado del día. F17 demuestra cambios concretos de operación, sin permitir generalizar a toda la red.

Alcance: comprobar campos de estado y fuente oficial de cierres/paradas; presentar fecha y alcance de la información donde se dan indicaciones. Criterios: fallo de fuente no se presenta como seguimiento en tiempo real, estaciones cerradas conocidas no reciben indicaciones de abordaje y la demo explica limitación de actualización. Depende de 2 para que datos de recorrido no se conviertan en paradas confirmadas.

### 6. P2 — Cerrar guion y evidencia de segunda entrega

Depende de 1–3 y de la decisión de alcance de 4–5. Alcance: demostración breve de consulta educativa Metro, estado en voz/pantalla, fuentes accesibles, y prueba de separación con TM. Criterios: una consulta de E3 muestra Ciudad Kennedy y alias técnico; E7 informa nombre pendiente; una solicitud de viaje Metro explica indisponibilidad comercial; no promete apertura, tarifa ni ETA. Guardar evidencia de esos casos y discrepancias aún abiertas; no afirmar aprobación de rúbrica académica, porque no se proporcionó aquí.

## Incertidumbres que permanecen abiertas

- Fechas futuras pueden cambiar. La evidencia más reciente de avance abierta fue publicada el 28-10-2026 con corte de septiembre; no se afirma avance de noviembre.
- No se validó un nombre definitivo posterior para E7 ni un régimen de nombres comerciales futuros.
- Falta clasificación institucional individual de las dos conexiones por proximidad, planos vigentes y correspondencia con IDs TM. E13 tiene antecedentes contradictorios; prioridad temporal de una nota no sustituye certificación técnica.
- GeoJSON de estaciones no declara CRS, pero sus 16 geometrías y 97 pares XY coinciden exactamente con el SHP que declara `PCS_CartMAGBOG`. Es evidencia fuerte de correspondencia, sin EPSG o transformación a WGS84 validados. El CRS específico del GeoJSON de trazado permanece sin confirmar. REST declara otro CRS y se registra por separado. No se generaron coordenadas transformadas ni centroides.
- Las consultas a estaciones REST fallaron de forma reproducible en esta sesión; no se establece causa ni duración de la falla. La portada EMB también tuvo problemas de acceso; se recurrió a publicaciones distritales que atribuyen la información a EMB y a archivos de Catastro.
- No se verificaron parada por parada, cierres actuales, accesos accesibles, horarios o tarifa integrada de un futuro servicio Metro. La investigación no respalda navegación real multimodal.
- No se recibió rúbrica de segunda entrega; las issues cubren este alcance Metro/datos y no constituyen auditoría completa del producto.

## Registro de fuentes primarias abiertas

Todas consultadas el **02-11-2026**. «Sin fecha editorial» significa que el recurso inspeccionado no ofrece fecha de publicación fiable. En recursos de datos se distingue fecha del dato, modificación del archivo y modificación del metadato.

| Ref. | Entidad, título y enlace directo | Publicación o fecha declarada | Evidencia utilizada |
| --- | --- | --- | --- |
| F1 | Portal Bogotá / EMB, [balance de rendición de cuentas](https://bogota.gov.co/mi-ciudad/movilidad/2026-10/solo-nos-falta-el-1627-para-subirnos-en-linea-1-del-metro-de-bogota) | 28-10-2026; corte 30-09-2026 | Obra, pruebas y horizonte de marzo de 2028. |
| F2 | Portal Bogotá / EMB, [tres solicitudes de precalificación de Línea 2](https://bogota.gov.co/mi-ciudad/movilidad/solicitud-precalificacion-construccion-de-linea-2-del-metro-de-bogota) | 07-09-2026 | Contratación, alcance de 11 estaciones y previsión contractual. |
| F3 | Portal Bogotá / Alcaldía y EMB, [licitación de Línea 2 declarada desierta](https://bogota.gov.co/mi-ciudad/movilidad/licitacion-publica-internacional-linea-2-de-metro-bogota-febrero-2026) | 20-01-2026 | Hito desierto, adjudicación prevista para 2027 y operación proyectada en 2035. Su anuncio inicial de reapertura no se trata como cronograma cumplido. |
| F4 | Portal Bogotá / Alcaldía, [Metro, cables y nuevas vías](https://bogota.gov.co/mi-ciudad/movilidad/2026-10/metro-cables-y-nuevas-vias-para-futuro-de-bogota-y-cundinamarca-2026) | Página muestra 24-09-2026 aunque URL contiene `2026-10` | Objetivo del 15-03-2028; precalificación Línea 2; estados de otros proyectos. |
| F5 | Portal Bogotá, [ubicación de estaciones E1–E16](https://bogota.gov.co/mi-ciudad/movilidad/estaciones-del-metro-de-bogota) | 20-10-2020 | Identificadores y tramos viales; fuente histórica, no accesos certificados actuales. |
| F6 | Portal Bogotá / EMB, [nombres elegidos tras votación](https://bogota.gov.co/mi-ciudad/movilidad/asi-se-nombraron-tres-estaciones-metro-de-bogota-tras-votacion) | 24-06-2026 | Nombres públicos; E7 pendiente; omisión de E13 en enumeración. |
| F7 | Portal Bogotá / EMB, [integración de estación 2 con Portal Américas](https://bogota.gov.co/mi-ciudad/movilidad/integracion-estacion-2-del-metro-de-bogota-con-el-portal-americas) | 15-07-2026 | Explicación de integración y lista individual de ocho conexiones directas. |
| F8 | Datos Abiertos Bogotá / EMB, [catálogo de estaciones](https://datosabiertos.bogota.gov.co/dataset/estaciones-de-la-primera-linea-del-metro-de-bogota) | Dato: 18-04-2022; metadato: 16-06-2026 | Licencia CC BY 4.0, recursos y CRS declarado. |
| F9 | Datos Abiertos Bogotá / EMB, [catálogo de trazado](https://datosabiertos.bogota.gov.co/dataset/trazado-primera-linea-del-metro-de-bogota) | Dato: 18-04-2022; metadato: 05-10-2026 | Licencia, recursos y antigüedad del dato. |
| F10 | Datos Abiertos Bogotá / EMB, [archivo de estaciones GeoJSON](https://datosabiertos.bogota.gov.co/dataset/f8979f34-66f1-4278-9a16-1312eaddf3a8/resource/17e5e67a-4c29-4337-bb3b-30c631ddf09d/download/estaciones.geojson) | Modificación de archivo según CKAN: 05-05-2022 | Archivo abierto y parseado: 16 objetos, atributos y coordenadas sin CRS. |
| F11 | Catastro / EMB, [metadatos de capa REST 0](https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/movilidad/metrobogota/MapServer/0) | Sin fecha editorial | Polígonos, campos y CRS; solicitudes de consulta documentadas arriba. |
| F12 | Catastro / EMB, [metadatos de capa REST 1](https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/movilidad/metrobogota/MapServer/1) y [consulta inspeccionada](https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/movilidad/metrobogota/MapServer/1/query?where=1%3D1&outFields=*&outSR=4326&f=json) | Sin fecha editorial; consulta 02-11-2026 | CRS, dos líneas y advertencia sobre estudios de detalle. |
| F13 | Portal Bogotá / EMB, [Estación 13-Central](https://bogota.gov.co/en/node/296475) | 24-04-2026 | Correspondencia explícita E13–Central; contenido en español. |
| F14 | EMB, [plano de estación 6](https://bogota.gov.co/sites/default/files/inline-images/1707331647977-c15cb83b-03a0-4651-aac2-2b07f7901df2_1.jpg), alojado en [publicación distrital de estaciones](https://bogota.gov.co/mi-ciudad/movilidad/ubicacion-de-las-estaciones-de-la-linea-1-del-metro-de-bogota) | Página: 26-10-2024; imagen sin fecha editorial visible | Plano inspeccionado visualmente: futura troncal/estación Boyacá. |
| F15 | EMB, [plano de estación 7](https://bogota.gov.co/sites/default/files/inline-images/1707332034745-e3182599-2591-4e7c-b077-8f5d85fb5450_1.jpg), misma publicación distrital | Página: 26-10-2024; imagen sin fecha editorial visible | Plano inspeccionado visualmente: futura estación sobre avenida 68. |
| F16 | Secretaría Distrital de Planeación, [DTS del Plan Parcial Estación Central](https://www.sdp.gov.co/sites/default/files/00_dts_ec_20.02.2019.pdf) | Febrero de 2019, según documento/nombre de recurso | Página impresa 154: integración por proximidad; antecedente histórico. |
| F17 | TransMilenio S. A., [Calle 26–Atrio se habilita por completo](https://www.transmilenio.gov.co/comunicaciones/noticias-de-transmilenio/comunicados-oficiales/nueva-estacion-calle-26-atrio-habilita-completo-marco-obras-metro) | Actualización: 19-06-2026; apertura anunciada: 20-06-2026 | Estación de buses operativa y cierre de Calle 34; no apertura Metro. |
| F18 | Portal Bogotá / EMB, [16 estaciones y mapa interactivo](https://bogota.gov.co/mi-ciudad/movilidad/linea-1-del-metro-de-bogota-contara-con-16-estaciones) | 06-03-2026 | Distinción agregada ocho directas/dos por proximidad. |
| F19 | Datos Abiertos Bogotá, [API CKAN estaciones](https://datosabiertos.bogota.gov.co/api/3/action/package_show?id=estaciones-de-la-primera-linea-del-metro-de-bogota) y [API CKAN trazado](https://datosabiertos.bogota.gov.co/api/3/action/package_show?id=trazado-primera-linea-del-metro-de-bogota) | Recursos creados/modificados el 05-05-2022; metadatos posteriores | URLs, formatos declarados y fechas de archivos. |
| F20 | Datos Abiertos Bogotá / EMB, [archivo de trazado GeoJSON](https://datosabiertos.bogota.gov.co/dataset/27b26604-2334-4591-8106-6c5f67b410c7/resource/b6005d7d-b1f1-4a1a-ba43-dc6f70d16957/download/trazado_plmb.geojson) | Modificación según CKAN: 05-05-2022 | Archivo abierto y parseado: una entidad, coordenadas proyectadas sin CRS. |
| F21 | Datos Abiertos Bogotá / EMB, [estaciones SHP/ZIP](https://datosabiertos.bogota.gov.co/dataset/f8979f34-66f1-4278-9a16-1312eaddf3a8/resource/65fbbca2-9660-4a0a-9e9a-2c612ba6b429/download/estaciones.zip) | Modificación según CKAN: 05-05-2022 | ZIP abierto; WKT de `ESTACIONES.prj` y coincidencia exacta de los 97 pares XY con F10. |
| F22 | Creative Commons, [licencia Attribution 4.0](https://creativecommons.org/licenses/by/4.0/) | Versión 4.0; enlace declarado en catálogos F8/F9 | Atribución, enlace de licencia e indicación de cambios al reutilizar. |

## Comprobación de este entregable

Se revisaron las 16 identidades contra el GeoJSON oficial, nombres contra publicaciones distritales, lista de ocho conexiones contra F7 y comportamiento del planificador contra código local. Las propuestas se distinguen de hechos; fechas previstas no se presentan como servicio vigente. Verificación documental y de respuestas públicas; no se ejecutaron pruebas de producto ni compilación porque solo se añadió este informe.
