# EA-26 (#52): anuncios operativos verificados

Rama `feat/ea26-anuncios`, desde `origin/main` 81fbe67. Pruebas de red del **11 de noviembre de 2026**, entre las 17:05 y las 17:15 UTC (12:05–12:15 en Bogotá), con peticiones GET de solo lectura a fuentes oficiales, desde un portátil en Colombia. Este documento cubre la investigación, las decisiones y el contrato del endpoint; no hay código de iPhone (la lista en el iPhone es un PR posterior).

## Decisiones ya tomadas

- **Sin push remoto APNs.** Exige el Apple Developer Program de pago y el equipo usa un Personal Team gratuito.
- **Sin cron ni worker de pago.** Render Free se duerme, así que no es un programador fiable.
- **Solo anuncios dentro de la app y notificaciones locales del sistema.** Las notificaciones locales (iOS) quedan fuera de este PR.
- **El modelo de lenguaje no participa.** Ningún anuncio, cierre, accidente o llegada pasa por Ollama ni se genera con él.

Con eso, el criterio 4 de #52 queda así: *aviso en la app* (este PR), *notificación local del sistema* (PR de iPhone, sin permisos de segundo plano) y *push APNs* (no se integra, por la decisión de arriba).

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

- **`sin-fuente`**: nunca hubo una consulta válida desde que arrancó el proceso. Lista vacía, confianza `ninguna` y el mensaje dice que *esto no significa que no haya novedades*. Nunca se presenta como «sin incidentes».
- **`activa`** (confianza `media`): la fuente respondió, el mensaje es válido y su marca tiene menos de 15 minutos. Con lista vacía el mensaje dice que *eso no garantiza que no haya novedades*.
- **`degradada`** (confianza `baja`): la última consulta falló, o la marca de la fuente tiene más de 15 minutos. Se **conserva** la última consulta buena (`consultadoEn`) y la marca de la fuente (`publicadoEn`), que es la fecha que cita el mensaje («la fuente publicó el …»), y se siguen mostrando los anuncios de ese mensaje que aún estén vigentes. Un fallo solo afecta a este endpoint: no bloquea el catálogo, el agente ni nada más.
- **Qué es un mensaje válido:** debe decodificar completo y traer cabecera con marca de tiempo (`header.timestamp`) dentro de un rango plausible: no anterior a 2020 ni más de una hora por delante del reloj del servidor (una marca en milisegundos o absurda queda fuera). Un cuerpo vacío, sin cabecera, truncado o con marca inválida **cuenta como fallo**, no como «fuente sin anuncios»: así una página de mantenimiento que responda 200 no se muestra como «Fuente conectada».
- **Descartados:** anuncios vencidos, aún no vigentes, eliminados (`is_deleted`), sin texto, y duplicados (mismo identificador, o mismo título, descripción y vigencia bajo otro identificador).
- **Vigencia:** con varios periodos rige el que contiene el momento. Un periodo sin inicio vale «desde siempre» y sin fin «hasta siempre» (GTFS-realtime). Una alerta **sin ningún periodo** rige mientras esté en el feed, según la especificación; por eso `fecha` (y `vigenciaHasta`) pueden ser `null`: la app dice que la fuente no publica el inicio y nunca inventa una fecha. Esas alertas van al final de la lista. (En los feeds observados ninguna alerta carecía de periodo.)
- **Caché del servidor:** 30 s por proceso (la fuente publica cada ~26 s), una sola consulta a la vez, espera máxima de 8 s a la fuente y 2 MB de respuesta, contados sobre los bytes reales leídos por stream (`leerBytesLimitado`, de `lib/cuerpo-peticion.ts`, la misma lectura acotada de EA-10; no se confía en `Content-Length` ni en cuerpos comprimidos). **Si se supera la cota se corta la lectura y la consulta cuenta como fallo**: nunca se trunca ni se usa a medias; con una consulta buena previa el estado pasa a `degradada` y conserva sus anuncios, y sin ella queda en `sin-fuente`. El mismo tratamiento tienen el HTTP distinto de 2xx, el tiempo agotado y una lectura que falla. No hay almacén externo ni proceso programado; la consulta ocurre cuando alguien pide `/api/anuncios`.
- **Cliente nativo:** el JSON no depende de la web. `mensaje` ya está en español y `efecto` es un código estable (la web lo traduce con `ETIQUETA_EFECTO`).
- **Simulado:** el endpoint no devuelve contenido de demostración, por eso `origen` solo admite `oficial`. Si algún día se añade, deberá llevar su propio origen y la marca «simulado».
- **Decodificador protobuf:** se escribió a mano (≈95 líneas de código, 109 con comentarios y espacios, `lib/anuncios-servidor.ts`) porque la regla es no añadir dependencias. Solo lee lo que usan las alertas e ignora los campos que no conoce.

La ruta nunca da 500 por la fuente: si armar la respuesta fallara por algo imprevisto, el servicio devuelve `sin-fuente` (con un aviso en el registro) en vez de lanzar.

Sin límite de peticiones propio: la consulta a la fuente ya está acotada por la caché de 30 s, y el límite de `/api/agent` usa una clave compartida que haría competir a las dos rutas.

## Qué muestra la campana ahora

Antes decía siempre «No tienes notificaciones nuevas», lo que sugería que no había incidentes. Ahora abre el panel **Avisos** (`components/avisos.tsx`) y lo lee en voz alta (el estado de la fuente y, por cada anuncio, título, afectación y hasta cuándo rige; hasta cinco, y avisa de que el resto está en la lista de la pantalla, porque en modo solo voz el recuento solo no daría acceso al contenido), con tres secciones que no se mezclan y cada una con su marca en texto:

1. **Anuncios del operador** — estado de la fuente según el endpoint («Fuente conectada», «Fuente con problemas · confianza baja», «Sin fuente conectada»), el mensaje, la fecha que publicó la fuente, la de la última consulta exitosa y, si los hay, cada anuncio (título como encabezado) con «Anuncio oficial · TransMilenio S.A.», afectación, vigencia e identificador. El texto de vigencia y de fechas es de tamaño normal, no reducido. Sin `role="status"`: la voz de la app ya lo dice y un lector de pantalla lo repetiría. Si la web no logra consultar el endpoint: «No pude consultar los anuncios de TransMilenio. Esto no significa que no haya novedades en el servicio.»
2. **Avisos de la app** — marca «Aviso de la app»: la falla al actualizar el catálogo o el uso de la copia guardada; si no hay ninguno, dice que no hay avisos propios y que eso no es un anuncio del operador.
3. **Escenario simulado** — marca «Simulado»: el Metro de Bogotá es un escenario educativo sin servicio comercial y no genera anuncios.

## Pruebas

`lib/ea26-anuncios.test.ts` (24 pruebas): decodificación, forma validada por el esquema, sin fuente, fuente sin anuncios vigentes, vencidos/futuros/eliminados/vacíos, duplicados, fallo tras un éxito (conserva fecha, baja confianza, descarta lo vencido y se recupera), fuente atrasada, mensaje inválido, caché y consulta única, la ruta real `GET` con la fuente en 503, y, tras la revisión: cuerpo vacío o sin cabecera (sin fuente / degradada, nunca «conectada»), marca absurda, en milisegundos, antigua o adelantada, varios periodos, periodo sin inicio y alerta sin periodo (fecha nula), selección de idioma, textos largos, un feed de 600 alertas, tiempo de espera agotado, respuesta por encima de la cota sin `Content-Length` (se corta la lectura y se conserva lo anterior), mensaje degradado con la fecha de publicación, texto hablado con tope y los rótulos de estado. No hay prueba del panel React (`components/avisos.tsx`): la lógica que decide qué se muestra y qué se dice está en funciones puras de `lib/anuncios.ts` (`ETIQUETA_ESTADO`, `textoHablado`) y esas sí se prueban. Los mensajes protobuf se arman con un codificador mínimo dentro de la prueba. Además, `lib/ea10-proxy-matcher.test.ts` confirma que `/api/anuncios` pasa por el `proxy`.

Pruebas de mutación hechas a mano (se rompió el código, falló la prueba, se restauró): quitar el filtro de vencidos, el de eliminados, la deduplicación por contenido, la deduplicación por identificador y la degradación por fallo; y, tras la revisión, quitar el control de cabecera, el de rango de la marca, la rama de alertas sin periodo, la cota de bytes (multiplicada por 3), el uso de la fecha de publicación en el mensaje degradado, el texto hablado por anuncio y la preferencia por el español. Cada una hizo fallar al menos una prueba (la de identificador necesitó añadir un caso: mismo identificador con otro texto).

Comprobado además contra el `alerts.pb` real descargado: el decodificador da las mismas 297 alertas y, evaluado a las 16:00 UTC, los mismos 3 anuncios vigentes que un decodificador protobuf independiente (Python `protobuf` 6.33.5 con un `.proto` mínimo). El servicio real contra la fuente en vivo devolvió `activa`, confianza `media`, 0 anuncios.

## Límites y pendientes

- **No verificado:** el panel React no tiene prueba automática (solo las funciones puras que usa); la veracidad de los anuncios frente a la operación real; la licencia del recurso en tiempo real; la disponibilidad sostenida (una sola jornada); VoiceOver ni lectores de pantalla reales con el panel; el panel en un navegador (se compiló y el endpoint se probó con `next start`, pero no se hizo una revisión visual).
- **Solo anuncios vigentes:** los programados a futuro se descartan. Mostrarlos pide decidir su presentación.
- **Los textos son los de la fuente**, incluidos sus códigos de paradas (`094B00_TM_…`) y errores de digitación; no se reescriben ni se interpretan con IA. Solo se decodifican entidades HTML, se normalizan espacios y se acota el largo.
- **Afectación por identificadores de la fuente**, no por códigos comerciales de ruta.
- La caché y el estado viven en la memoria del proceso: al reiniciar se pierde la última consulta buena y se vuelve a `sin-fuente` hasta la primera respuesta.
- **Fuera de alcance:** lista en el iPhone, notificación local del sistema (con prueba física), APNs, cron o worker.
