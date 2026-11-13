# EA-26 (#52): anuncios operativos verificados

Rama `feat/ea26-anuncios`. Pruebas de red del **11 de noviembre de 2026**, entre las 17:05 y las 17:15 UTC (12:05–12:15 en Bogotá), con peticiones GET de solo lectura a fuentes oficiales, desde un portátil en Colombia. Este documento cubre la investigación, las decisiones y el contrato del endpoint; la lista en el iPhone está en la sección [iOS](#ios-lista-de-anuncios-en-la-app) (PR posterior).

## Decisiones ya tomadas

- **Sin push remoto APNs.** Exige el Apple Developer Program de pago y el equipo usa un Personal Team gratuito.
- **Sin cron ni worker de pago.** Render Free se duerme, así que no es un programador fiable.
- **Solo anuncios dentro de la app.** Sin notificaciones locales del sistema: la decisión y sus razones están en la sección [iOS](#ios-lista-de-anuncios-en-la-app).
- **El modelo de lenguaje no participa.** Ningún anuncio, cierre, accidente o llegada pasa por Ollama ni se genera con él.

Con eso, el criterio 4 de #52 queda así: *aviso en la app* (este PR), *notificación local del sistema* (no se integra; ver la sección iOS) y *push APNs* (no se integra, por la decisión de arriba).

## Resultado de la investigación

**Sí existe una fuente oficial utilizable**: las alertas GTFS-realtime (`alerts.pb`) que publica TransMilenio S.A. Con dos reservas importantes (licencia no declarada para este recurso y un aviso de mantenimiento en su portal) que se detallan abajo. Por eso la integración se hace con el estado de la fuente a la vista y con confianza limitada, nunca con una promesa de servicio.

### Candidatos

Solo fuentes oficiales; sin redes sociales ni extracción de páginas (scraping).

| # | Candidato | Entidad | Respondió (UTC, 11/11/2026) | Veredicto |
| --- | --- | --- | --- | --- |
| 1 | `https://gtfs.transmilenio.gov.co/alerts.pb` (GTFS-realtime Alerts) | TransMilenio S.A. | 17:06:23 → **200**, 71 469 B, 0,56 s. Repetido 17:07:13 → 200, mismo tamaño | **Se integra** |
| 2 | `https://gtfs.transmilenio.gov.co/manifest.json` | TransMilenio S.A. | 17:05:20 → 200, 1 500 B, 0,58 s | Solo metadatos (ver nota) |
| 3 | `https://gtfs.transmilenio.gov.co/` (portal GTFS) | TransMilenio S.A. | 17:05:21 → 200, HTML | Trae un aviso de mantenimiento (ver reservas) |
| 4 | `https://gis.transmilenio.gov.co/gtfs/` | TransMilenio S.A. | 17:05:21 → **500** | Caído (ya lo había visto la auditoría, F14) |
| 5 | ArcGIS REST `…/rest/services?f=pjson`, carpetas `Paros` y `GTFS_dinamicos` | TransMilenio S.A. | 17:05:22 y 17:06:24 → 200 | Las dos carpetas están **vacías** (`"services": []`) |
| 6 | ArcGIS `ConsultaSubgerenciaOperaciones/consulta_tipo_novedad` (tabla 0) | TransMilenio S.A. | 17:15:37–38 → 200 | Es un catálogo de 13 tipos de novedad (`id_novedad`, `nombre_novedad`, `descripcion`), **no** anuncios. No sirve |
| 7 | RSS/Atom de transmilenio.gov.co (`/rss`, `/feed`, enlaces `alternate` en portada y boletines) | TransMilenio S.A. | `/rss` y `/feed` 17:05:24 → **404**; portada y boletines sin enlace a ningún RSS | No existe |
| 8 | Boletines y página de noticias de transmilenio.gov.co | TransMilenio S.A. | 17:05:22 y 17:05:24 → 200, HTML | Es una página web para leer, sin identificador, vigencia ni afectación estructurados. Leerla sería *scraping*: descartada |
| 9 | Datos abiertos Bogotá, CKAN (`package_search` con «alertas», «gtfs tiempo real», «novedades movilidad») | Distrito (portal), conjuntos de varias entidades | 17:05:29 → 200 (16,4 s), 17:07:56 → 200 (6,1 s), 17:08:02 → 200 (8,6 s, vacío) | Ningún conjunto de anuncios del transporte. «Alertas» devuelve alertas bibliográficas, de salud escolar y de lluvia (IDIGER); «novedades movilidad» devuelve 0. Un `package_search?q=transmilenio` agotó los 25 s de espera a las 17:05:46 |
| 10 | Secretaría de Movilidad (`movilidadbogota.gov.co`, `/rss`) | Secretaría Distrital de Movilidad | 17:08:21 → 200 (HTML); `/rss` 17:08:22 → **404** | Sin feed estructurado encontrado |
| 11 | Metro de Bogotá (`metrodebogota.gov.co`) | Empresa Metro de Bogotá | 17:08:24 → falló la verificación del certificado TLS desde este portátil (`curl: (60)`); no se forzó | Sin servicio comercial: no genera anuncios operativos de todos modos |

Nota del manifiesto: dice `"realtime_available": true` y ofrece `alerts.pb`, `positions.pb` y `tripupdates.pb` con frecuencia «Cada 26 segundos», pero su `generated_at` (04:20 hora de Bogotá) no cambió entre las 12:05 y las 12:07 mientras el propio `alerts.pb` sí cambiaba. No se usa el manifiesto como señal de estado.

### El feed #1 en detalle

- **Entidad:** TransMilenio S.A. (Empresa de Transporte del Tercer Milenio).
- **Formato:** `FeedMessage` de GTFS-realtime (protobuf). `Content-Type: text/plain`, `Cache-Control: no-store`, sin clave de API.
- **Campos por alerta:** `id` (identificador), `active_period` (inicio y fin en segundos desde la época), `informed_entity` (`route_id` y `stop_id`), `cause`, `effect`, `url`, `header_text` y `description_text` (español). No trae fecha de publicación: la única fecha por anuncio es el inicio de su vigencia.
- **Marca de la fuente:** `header.timestamp` avanzó entre las dos consultas (17:06:13 → 17:06:49 UTC), así que el feed se regenera de forma continua.
- **Tamaño y crecimiento:** a las 17:06 UTC del 11/11 eran 297 alertas (71 469 B); a las 01:21 UTC del 12/11 (verificado de nuevo) eran 532 alertas (127 968 B), todas vencidas y todas con periodo. Crece porque acumula alertas ya vencidas, de modo que la cota de 2 MB (ver contrato) no es teórica a largo plazo.
- **Contenido observado (17:06 UTC del 11/11):** 297 alertas, **0 vigentes**. Todas con un solo periodo, todas con `effect` = 4 (desvío) y `cause` = 1 (desconocida). La más reciente terminó a las 16:55:07 UTC. 173 de las 297 duraron menos de 60 s y 95 más de un día. Hay 3 identificadores repetidos y 21 grupos con el mismo título y descripción. Algunos textos traen entidades HTML (`&iacute;`, `&Ntilde;`) y los códigos internos de paradas en la descripción (`Novedad en la operacion en linea 10173\483A09_TM_…`).
- **Afectación:** `route_id` y `stop_id` son identificadores del GTFS de TransMilenio (p. ej. `10173`). **No** coinciden con los identificadores del catálogo troncal de esta app (`data/transmilenio.json`), así que el endpoint los entrega tal cual como «identificador de la fuente» y no los traduce a códigos comerciales (B12, H72…). Traducirlos exige el GTFS estático completo (185 MB); queda fuera.
- **Licencia:** el catálogo CKAN del Distrito declara **CC-BY-SA-4.0** para el conjunto GTFS del SITP de TransMilenio (`especificacion-gtfs-general-transport-feed-specification-sitp`, consultado a las 17:07:49 UTC → 200; metadatos de 2023-12-18). Eso cubre el GTFS estático. **Ningún aviso de licencia o términos acompaña a `alerts.pb`** ni al portal nuevo. No se inventa una licencia para el endpoint ni se toma la ausencia por prohibición. Se atribuye siempre a TransMilenio S.A. y la app solo muestra los anuncios con su origen, sin redistribuir el archivo.

### Reservas (por qué la confianza es limitada)

1. El portal `gtfs.transmilenio.gov.co` mostraba el 11/11/2026 un aviso: «Estamos en mantenimiento: la información de GTFS en tiempo real no se encuentra disponible en este momento». Aun así `alerts.pb` respondía con marca de tiempo actual. No se sabe cuál de las dos señales es la correcta.
2. No se ha contrastado ningún anuncio del feed con un cierre o desvío real. Que haya 0 vigentes a las 17:06 UTC puede ser un día sin novedades o un feed que no refleja la operación.
3. La licencia de este recurso no está declarada (ver arriba).
4. Es una prueba puntual de unos minutos en un solo día; no mide disponibilidad ni latencia sostenidas.

**Por qué `media` y no `baja` con la licencia sin declarar.** `confianza` mide si el feed *funciona* (responde, decodifica, su marca es reciente), no si su uso está autorizado: la licencia es una cuestión de términos que queda registrada aquí y en el PR, no un síntoma de que los datos sean peores. Tampoco el aviso de mantenimiento del portal se puede leer desde el endpoint sin raspar una página (descartado) y el `manifest.json` no es fiable (su `generated_at` no cambió mientras `alerts.pb` sí). Aun así nunca se llega a «alta»: ningún anuncio se ha contrastado con la operación real. Y si el equipo prefiere la prudencia, bajar a `baja` es cambiar un literal en `lib/anuncios-servidor.ts` (`confianza: "media"`).

## Contrato de `GET /api/anuncios`

Protegido como el resto de la app: lo cubre el `proxy` (HTTP Basic con `APP_PASSWORD`; ver `proxy.ts`). Prueba local con `next start`: 401 sin credencial, 200 con ella. Esquema zod en `lib/anuncios.ts` (`AnunciosRespuestaSchema`); la ruta valida la respuesta antes de enviarla. Siempre responde 200 con la forma completa, aunque la fuente esté caída, y con `Cache-Control: no-store`.

```jsonc
{
  "fuente": {
    "estado": "sin-fuente" | "activa" | "degradada",
    "confianza": "ninguna" | "baja" | "media",
    "entidad": "TransMilenio S.A.",
    "nombre": "Alertas GTFS-realtime de TransMilenio",
    "url": "https://gtfs.transmilenio.gov.co/alerts.pb",
    "consultadoEn": "ISO 8601 de la última consulta que funcionó, o null",
    "publicadoEn": "ISO 8601 de la marca de la propia fuente, o null solo en sin-fuente",
    "mensaje": "Frase lista para mostrar y leer en voz alta"
  },
  "anuncios": [
    {
      "origen": "oficial",
      "entidad": "TransMilenio S.A.",
      "identificador": "FeedEntity.id",
      "titulo": "…", "descripcion": "…",
      "fecha": "inicio de la vigencia (ISO 8601), o null si la fuente no lo publica",
      "vigenciaHasta": "ISO 8601 o null",
      "afectacion": { "efecto": "desvio" /* sin-servicio, demoras, … */, "rutas": ["10173"] }
    }
  ]
}
```

Reglas:

- **`sin-fuente`**: no hay datos que mostrar. Ocurre (1) si nunca hubo una consulta válida desde que arrancó el proceso, (2) si pasaron más de 24 h desde la última consulta buena, y (3) si la marca de la propia fuente lleva más de 24 h sin avanzar aunque siga respondiendo 200 (fuente congelada: la consulta se renueva pero los datos no). Lista vacía, confianza `ninguna` y el mensaje dice que *esto no significa que no haya novedades*. Nunca se presenta como «sin incidentes».
- **`activa`** (confianza `media`): la fuente respondió, el mensaje es válido y su marca tiene menos de 15 minutos. Con lista vacía el mensaje dice que *no publica anuncios vigentes* y repite la frase de seguridad: *esto no significa que no haya novedades en el servicio*.
- **`degradada`** (confianza `baja`): la última consulta falló, o la marca de la fuente tiene más de 15 minutos. Se **conserva** la última consulta buena (`consultadoEn`) y la marca de la fuente (`publicadoEn`), que es la fecha que cita el mensaje («la fuente publicó el …»), y se siguen mostrando los anuncios de ese mensaje que aún estén vigentes. Si pasan **24 h sin una consulta buena, o con la marca de la fuente sin avanzar,** se vuelve a `sin-fuente` y la lista queda vacía: un anuncio sin fecha de fin no puede quedar en pantalla para siempre con la fuente caída. Un fallo solo afecta a este endpoint: no bloquea el catálogo, el agente ni nada más.
- **Qué es un mensaje válido:** debe decodificar completo y traer cabecera con marca de tiempo (`header.timestamp`) dentro de un rango plausible: no anterior a 2020 ni más de una hora por delante del reloj del servidor (una marca en milisegundos o absurda queda fuera). Un cuerpo vacío, sin cabecera, truncado o con marca inválida **cuenta como fallo**, no como «fuente sin anuncios»: así una página de mantenimiento que responda 200 no se muestra como «Fuente conectada».
- **Orden:** por gravedad del efecto y, a igual gravedad, por fecha (más reciente primero; los de fecha nula, al final): sin servicio, luego servicio reducido, desvío o problema de accesibilidad (la audiencia de la app lo necesita ya), luego demoras y el resto. Así los cinco que lee la voz son los más graves. (Es el orden de «Reutilizar lista/prioridad» de #52 dentro de lo que existe: no hay otra lista de avisos en la app a la que sumarse.)
- **Título:** si la fuente no trae título, la descripción lo sustituye, acortada al mismo tope de 120 caracteres; si ambos coinciden, la pantalla y la voz no repiten el texto.
- **Descartados:** anuncios vencidos, aún no vigentes, eliminados (`is_deleted`), sin texto, y duplicados (mismo identificador, o mismo título, descripción y vigencia bajo otro identificador).
- **Vigencia:** con varios periodos rige el que contiene el momento. Un periodo sin inicio vale «desde siempre» y sin fin «hasta siempre» (GTFS-realtime). Una alerta **sin ningún periodo** rige mientras esté en el feed, según la especificación; por eso `fecha` (y `vigenciaHasta`) pueden ser `null`: la app dice que la fuente no publica el inicio y nunca inventa una fecha. Esas alertas van al final de la lista. (En los feeds observados ninguna alerta carecía de periodo.)
- **Caché del servidor:** 30 s por proceso (la fuente publica cada ~26 s), una sola consulta a la vez, espera máxima de 8 s a la fuente y 2 MB de respuesta, contados sobre los bytes reales leídos por stream (`leerBytesLimitado`, de `lib/cuerpo-peticion.ts`, la misma lectura acotada de EA-10; no se confía en `Content-Length` ni en cuerpos comprimidos). Al pasar de la **mitad** de la cota se escribe un aviso en el registro (una vez por proceso) para subirla a tiempo. **Si se supera la cota se corta la lectura y la consulta cuenta como fallo**: nunca se trunca ni se usa a medias; con una consulta buena previa el estado pasa a `degradada` y conserva sus anuncios (y a `sin-fuente` a las 24 h), y sin ella queda en `sin-fuente` **para siempre, hasta que alguien suba la cota** (`MAX_BYTES`): la fuente crece al acumular alertas vencidas (≈130 KB el 12/11; ≈155 KB y 644 alertas medidos por la revisión). El mismo tratamiento tienen el HTTP distinto de 2xx, el tiempo agotado y una lectura que falla. No hay almacén externo ni proceso programado; la consulta ocurre cuando alguien pide `/api/anuncios`.
- **Cliente nativo:** el JSON no depende de la web. `mensaje` ya está en español y `efecto` es un código estable (la web lo traduce con `ETIQUETA_EFECTO`, en `lib/anuncios-texto.ts`, junto con los textos de voz y de fechas; `lib/anuncios.ts` solo tiene el esquema). La frase de seguridad «Esto no significa que no haya novedades en el servicio» es una sola constante (`AVISO_SIN_GARANTIA`) usada por el servidor y la web.
- **Simulado:** el endpoint no devuelve contenido de demostración, por eso `origen` solo admite `oficial`. Si algún día se añade, deberá llevar su propio origen y la marca «simulado».
- **Decodificador protobuf:** se escribió a mano (≈115 líneas de código, 124 con comentarios, sin contar las en blanco: desde `type Campo` hasta el final de `decodificarAlertas`, incluidos `CAMPO` y `textoTraducido`; `lib/anuncios-servidor.ts`) porque la regla es no añadir dependencias. Solo lee lo que usan las alertas e ignora los campos que no conoce.

La ruta nunca da 500 por la fuente: si armar la respuesta fallara por algo imprevisto, el servicio devuelve `sin-fuente` (con un aviso en el registro) en vez de lanzar.

Sin límite de peticiones propio: la consulta a la fuente ya está acotada por la caché de 30 s, y el límite de `/api/agent` usa una clave compartida que haría competir a las dos rutas.

## Qué muestra la campana ahora

Antes decía siempre «No tienes notificaciones nuevas», lo que sugería que no había incidentes. Ahora abre el panel **Avisos** (`components/avisos.tsx`) y lo lee en voz alta (el mensaje y la fuente con la hora que publicó y la de la última consulta; y por cada anuncio, entidad, título, descripción recortada a ~100 caracteres —en el feed real el título es un código de lugar y el sentido está en la descripción—, afectación y vigencia; hasta cinco, y avisa de que el resto está en la lista de la pantalla, porque en modo solo voz el recuento solo no daría acceso al contenido; no se leen los identificadores de ruta de la fuente, que no dicen nada al oído). Las fechas van en 24 horas («17:05») para que ninguna frase termine en «p. m..». Al cerrar el panel o desmontarlo la voz de su lectura se corta (solo la suya). Con voz del navegador no hay región viva; solo si falta `speechSynthesis` el resultado (estado, mensaje y lista de anuncios) va en una región `aria-live="polite"`: un solo canal a la vez. La campana ahora se llama «Avisos y anuncios» (antes «Notificaciones»), con tres secciones que no se mezclan y cada una con su marca en texto:

1. **Anuncios del operador** — estado de la fuente según el endpoint («Fuente conectada», «Fuente con problemas · confianza baja», «Sin fuente conectada»), el mensaje, la fecha que publicó la fuente, la de la última consulta exitosa y, si los hay, cada anuncio (título como encabezado) con «Anuncio oficial · TransMilenio S.A.», afectación, vigencia e identificador. El texto de vigencia y de fechas es de tamaño normal, no reducido. Sin `role="status"`: la voz de la app ya lo dice y un lector de pantalla lo repetiría. Si la web no logra consultar el endpoint: «No pude consultar los anuncios de TransMilenio. Esto no significa que no haya novedades en el servicio.»
2. **Avisos de la app** — marca «Aviso de la app» (sirve al criterio 4 de #52, separar avisos en la app de los del operador, y a la petición de distinguir el aviso propio del anuncio oficial): la falla al actualizar el catálogo o el uso de la copia guardada; si no hay ninguno, dice que no hay avisos propios y que eso no es un anuncio del operador.
3. **Escenario simulado** — marca «Simulado» (sirve al criterio 2 de #52: lo que no es del operador lleva origen y una marca accesible en texto): el Metro de Bogotá es un escenario educativo sin servicio comercial y no genera anuncios.

## Pruebas

Dos archivos nuevos, más `lib/ea10-proxy-matcher.test.ts`, que confirma que `/api/anuncios` pasa por el `proxy`:

- **`lib/ea26-anuncios.test.ts`** (35 pruebas), sobre mensajes protobuf armados con un codificador mínimo dentro de la prueba: decodificación; forma validada por el esquema; sin fuente; fuente sin anuncios vigentes; vencidos, futuros, eliminados y vacíos; duplicados; fallo tras un éxito (conserva fecha, baja la confianza, descarta lo vencido y se recupera); fuente atrasada; mensaje inválido; caché y consulta única; la ruta real `GET` con la fuente en 503; cuerpo vacío o sin cabecera (nunca «conectada»); marca absurda, en milisegundos, antigua o adelantada; varios periodos, periodo sin inicio y alerta sin periodo; idioma; textos largos y su acortado (sin partir emojis ni palabras); un feed de 600 alertas; tiempo de espera agotado; respuesta por encima de la cota sin `Content-Length`; aviso de tamaño; orden por gravedad; caducidad a las 24 h sin consulta buena y con la marca congelada; español vacío con respaldo; frase de seguridad única; descripción útil; y las funciones de texto (`textoHablado`, `vigenciaTexto`, `lineaFuente`, `fechaLegible`, `ETIQUETA_ESTADO`, de `lib/anuncios-texto.ts`). Ninguna frase hablada debe terminar en «….», «..», «?.» ni «!.» (hallazgos: «S.A..», «PADRONES..», «¿…?.»).
- **`lib/ea26-avisos-ui.test.ts`** (6 pruebas) ejecuta el TSX real de `Avisos` y `AppHeader` con dobles de React (`useState`/`useEffect` con limpieza) y de la voz: qué dice la voz, que calle al cerrar o desmontar sin cortar la locución de otro, el canal único (voz o región viva, esta con la lista dentro), el fallo de la consulta, las tres secciones con su marca y el rótulo de la campana.

Pruebas de mutación hechas a mano (se rompió el código, falló la prueba, se restauró): quitar el filtro de vencidos, el de eliminados, la deduplicación por contenido, la deduplicación por identificador y la degradación por fallo; y, tras la revisión, quitar la voz de la fuente, el recorte de la descripción, el cierre de punto único, el formato de 24 h, la cancelación al cerrar, la región viva, el rótulo de la campana, la prioridad, la caducidad de 24 h, el aviso de tamaño y el respaldo del español vacío; y, en la primera ronda, quitar el control de cabecera, el de rango de la marca, la rama de alertas sin periodo, la cota de bytes (multiplicada por 3), el uso de la fecha de publicación en el mensaje degradado, el texto hablado por anuncio y la preferencia por el español. Cada una hizo fallar al menos una prueba (la de identificador necesitó añadir un caso: mismo identificador con otro texto). En la tercera ronda: la caducidad por marca congelada, el cierre de frase sin «…» y sin «?», el retroceso a la última palabra y el conteo por puntos de código en `acortar`.

Comprobado además contra el `alerts.pb` real descargado: el decodificador da las mismas 297 alertas y, evaluado a las 16:00 UTC, los mismos 3 anuncios vigentes que un decodificador protobuf independiente (Python `protobuf` 6.33.5 con un `.proto` mínimo). El servicio real contra la fuente en vivo devolvió `activa`, confianza `media`, 0 anuncios.

## Límites y pendientes

- **No verificado:** que el panel se vea y suene bien con navegador, VoiceOver y voz reales (sus pruebas usan dobles de React y de voz; solo se compiló y el endpoint se probó con `next start`); la veracidad de los anuncios frente a la operación real; la licencia del recurso en tiempo real; y la disponibilidad sostenida (una sola jornada). Tampoco se probó el `catch` defensivo del servicio ante un error imprevisto al armar la respuesta.
- **Solo anuncios vigentes:** los programados a futuro se descartan. Mostrarlos pide decidir su presentación.
- **Los textos son los de la fuente**, incluidos sus códigos de paradas (`094B00_TM_…`) y errores de digitación; no se reescriben ni se interpretan con IA. Solo se decodifican entidades HTML, se normalizan espacios y se acorta el largo (120 el título, 300 la descripción, contando caracteres reales, sin partir un emoji y volviendo al último espacio si el corte cae a media palabra; lo quitado se marca con «…»).
- **Afectación por identificadores de la fuente**, no por códigos comerciales de ruta.
- La caché y el estado viven en la memoria del proceso: al reiniciar se pierde la última consulta buena y se vuelve a `sin-fuente` hasta la primera respuesta.
- **Fuera de alcance:** notificación local del sistema, APNs, cron o worker. La lista en el iPhone se documenta en la sección iOS.

## iOS: lista de anuncios en la app

Rama `feat/ea26-anuncios-ios` (PR de iPhone, #52). El iPhone consume `GET /api/anuncios` **tal como está** —sin cambios en el servidor— con el mismo origen HTTPS, la misma clave HTTP Basic y las mismas reglas de red que `POST /api/agent` (`ClienteAnunciosHTTP`, de `ios/TransMiVoz/Anuncios/`): sin redirecciones, sin caché ni reintentos automáticos, plazo total de 12 s y respuesta de hasta 1 MB. Cualquier valor fuera del contrato (estado, confianza, efecto u origen desconocidos, fecha que no sea ISO 8601, `mensaje` en blanco) hace que toda la respuesta sea incompatible: es mejor decir «no pude leerlo» que mostrar a medias un aviso de servicio.

### Qué muestra y cuándo

La sección `AnunciosSeccionVista` va dentro del recuadro «Anuncios oficiales» de la pestaña Avisos (EA-20, #46), que conserva la separación entre anuncios oficiales, avisos propios y escenario simulado; en las pruebas de interfaz el contenido simulado sale ahí mismo, con su marca (como los avisos propios simulados de #46). Pide los anuncios al aparecer y con el botón «Actualizar» (o «Reintentar» si la última consulta falló). Muestra siempre el estado de la fuente **con texto** (no solo icono ni color) y la confianza:

| Situación | Estado que ve la persona | Confianza | Lista |
| --- | --- | --- | --- |
| Aún no se consultó, o el servidor responde `sin-fuente` | «Sin fuente conectada» | ninguna | vacía; dice que eso no significa que no haya novedades |
| El servidor responde `activa` | «Fuente conectada» | la del servidor (`media`) | los anuncios vigentes; la tarjeta muestra el `mensaje` del servidor (con lista vacía, el suyo), salvo que la app haya ocultado algún anuncio (vencido o repetido): entonces muestra su propio texto («En este iPhone se ocultaron N anuncios…») y la frase de seguridad |
| El servidor responde `degradada` | «Fuente con problemas, confianza baja» | baja | los anuncios que el servidor aún da por vigentes |
| La consulta del iPhone falla **después** de una respuesta buena (sin red, 401, plazo…) | «Fuente con problemas, confianza baja» | baja | los de la última respuesta que aún no hayan vencido; **conserva la fecha** que publicó la fuente y la de la última consulta exitosa; el texto lo pone la app (la causa, qué hacer y que lo mostrado puede estar desactualizado), no el `mensaje` viejo del servidor |
| La consulta falla y **nunca** hubo una respuesta buena | «Sin fuente conectada» + «No pude consultar los anuncios…» | ninguna | vacía |

Cada anuncio muestra entidad, identificador, fecha (inicio de la vigencia; «la fuente no la publica» si es `null`), vigencia (fin; «sin fecha de fin publicada» si es `null`), efecto y servicios afectados (identificadores de la fuente, no códigos comerciales). Nada de esto se inventa. Una frase por elemento de texto, sin alturas fijas, para que con el texto más grande no se recorte.

Lo que la app repite del servidor es solo lo mínimo: descarta los anuncios con `vigenciaHasta` ya pasada según el reloj del iPhone (la respuesta conservada tras un fallo envejece y el servidor no puede quitarlos) y los repetidos por origen e identificador (la lista de SwiftUI exige identificadores únicos). Si con eso se oculta algún anuncio, el `mensaje` del servidor (que cuenta los suyos, p. ej. «Hay 2 anuncios vigentes») ya no coincidiría con las tarjetas: la app lo reemplaza por «En este iPhone se ocultaron N anuncios que ya vencieron o estaban repetidos» y la frase de seguridad, y el anuncio de VoiceOver dice «No quedan anuncios vigentes en este iPhone» en vez de «No hay anuncios vigentes publicados». El orden por gravedad es el del servidor. La vigencia real, la deduplicación por contenido, el estado de la fuente y el resto de las reglas del contrato siguen siendo del servidor (`lib/anuncios-servidor.ts`); no se reescriben en Swift.

### Origen y marca de simulación

El contrato solo emite `oficial`. El modelo de Swift admite además `simulado` (el contrato exige que el contenido de demostración lleve su propio origen): un anuncio simulado muestra «Simulado · no es un anuncio del operador», la línea «Origen: contenido de demostración publicado por «Simulación de la app», sin ninguna fuente real» (con su entidad) y la etiqueta de VoiceOver «Anuncio simulado de demostración. No es un anuncio del operador.». El único contenido simulado es el del cliente `ClienteAnunciosSimulado` (solo compilaciones de depuración; argumentos `-PRUEBAS_UI_SIMULADAS`, y `-PRUEBAS_UI_ANUNCIOS_SIN_FUENTE` o `-PRUEBAS_UI_ANUNCIOS_CAIDA`): ningún anuncio simulado sale del servidor ni llega a una compilación de lanzamiento.

### Independencia de la sesión y de los avisos del radar

`AnunciosModelo` no comparte estado, tarea ni red con la sesión del accesorio ni con sus avisos. Un fallo de la consulta, un 401 o un servidor caído solo cambian esta sección. Se comprueba por construcción (modelos separados) y con las pruebas del modelo; **no** se probó en un iPhone con el accesorio real.

### Decisión: solo lista dentro de la app

No se integra notificación local del sistema, ni push remoto (APNs), ni modos de segundo plano, ni cron o worker. Razones:

- **APNs:** exige el Apple Developer Program de pago y el equipo usa un Personal Team gratuito (decisión previa de este documento).
- **Cron o worker:** Render Free se duerme; no es un programador fiable y pagar uno no está autorizado.
- **Notificación local:** para avisar con la app cerrada, algo tendría que consultar el servidor en segundo plano. Eso exige declarar un modo de segundo plano (`UIBackgroundModes` y una tarea de actualización en segundo plano), y es el sistema quien decide cuándo la ejecuta, sin hora garantizada. Con la app abierta, la lista ya está en pantalla y se anuncia por VoiceOver, así que una notificación sería redundante. Además pide un permiso nuevo al usuario y el criterio de #52 exige una prueba física de entrega que no cabe antes del congelamiento del iPhone (13/11/2026, 15:00 en Bogotá).
- **La fuente no lo justifica todavía:** a la muestra del 11/11 tenía 0 anuncios vigentes, ningún anuncio se ha contrastado con la operación real y la licencia del recurso en tiempo real no está declarada (confianza `media`, nunca `alta`). Interrumpir a alguien con una notificación de un dato así sería peor que mostrarlo con sus reservas cuando abre la sección.

Si se retoma, hace falta antes una autorización concreta para el modo de segundo plano y la prueba física de entrega. Sin promesa de servicio permanente.

### Criterios de #52 en el iPhone

| Criterio | Estado |
| --- | --- |
| 1. Fuente oficial, licencia; entidad, identificador, fecha, vigencia y afectación; sin fuente = estado «sin fuente», nunca ausencia de incidentes | Cubierto en software (decodificador, textos y modelo con pruebas unitarias); la investigación de fuente y licencia es la del PR web. **Pendiente** verlo con el servidor real desde un iPhone |
| 2. No inventa anuncios; contenido de demostración con origen y marca de simulación accesible | Cubierto en software; la etiqueta de VoiceOver **no** se probó con VoiceOver real |
| 3. Sin duplicados ni vencidos; un fallo conserva la fecha y baja la confianza sin bloquear la sesión | Cubierto con fixtures y cliente simulado (sin red real); **pendiente** en un iPhone con el accesorio |
| 4. Separar aviso en la app, notificación local y push APNs; no añadir cron, cuenta APNs ni segundo plano sin autorización | Decisión documentada arriba: solo aviso en la app |
| 5. Documentar la decisión de no integrar | Hecho arriba |

### Pruebas y límites (iOS)

- `AnunciosRespuestaTests` (8), `ClienteAnunciosHTTPTests` (14), `AnunciosModeloTests` (16) y `TextoAnunciosTests` (17): decodificación del contrato, cliente con red simulada, vigencia, deduplicación, fallo que conserva la fecha, recuperación, una consulta a la vez y textos. `lib/ea26-anuncios-ios.test.ts` comprueba que los fixtures JSON de `FixturesAnuncios.swift` cumplen el `AnunciosRespuestaSchema` real (zod), como ya hace EA-17 con `FixturesHTTP.swift`. Los fixtures son **simulaciones de contrato con valores inventados**, no respuestas del servidor real.
- Las 55 pruebas unitarias se compilaron y pasaron en Linux (Swift 6.2, contenedor `swift:6.2`, un paquete de prueba con los archivos sin SwiftUI). Eso no acredita ejecución en Apple: la CI de iOS es la primera compilación de SwiftUI y de las pruebas de interfaz.
- Pruebas de mutación a mano (se rompió el código, falló la prueba, se restauró): quitar el filtro de vencidos, la deduplicación, el ocultar la lista con `sin-fuente`, la degradación por fallo, la conservación de la última respuesta, la distinción cancelar/fallar, la consulta única, la frase de seguridad, el rechazo de `mensaje` en blanco, la zona horaria, el reemplazo del `mensaje` del servidor cuando se ocultan anuncios, el conteo de ocultos y el texto de VoiceOver con la lista vacía tras ocultar.
- Pruebas de interfaz (`TransMiVozAnunciosUITests`, `TransMiVozAnunciosTextoGrandeUITests`; cliente simulado, sin red): la lista con cada campo y la marca de simulación, vencidos y repetidos ocultos, sin fuente, una consulta caída que conserva las dos fechas y baja la confianza sin tocar los avisos propios ni la sesión, auditoría de accesibilidad con texto normal y alcance de los elementos con `AccessibilityXXXL`. Las pruebas de #46 que recorrían la fila provisional ahora usan `-PRUEBAS_UI_ANUNCIOS_SIN_FUENTE`. **Escritas sin Xcode: la primera ejecución es la de la CI de macOS.**
- **Pendiente:** VoiceOver, Dynamic Type y contraste en un iPhone real; la consulta contra el Render real; el comportamiento con el accesorio real.
