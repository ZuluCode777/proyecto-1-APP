# Auditoría de código para la segunda entrega de ExpoAndes

Fecha de auditoría y consulta de fuentes: **2026-11-02**, zona America/Bogota.
Repositorio: [ZuluCode777/proyecto-1-APP](https://github.com/ZuluCode777/proyecto-1-APP).
Versión examinada: [`0abca8cbd7dbf95c01ae0fbccdc67804174a13c9`](https://github.com/ZuluCode777/proyecto-1-APP/tree/0abca8cbd7dbf95c01ae0fbccdc67804174a13c9), último cambio del 2026-09-24.

## Qué hace este repositorio

TransMiVoz es un cliente web de TransMilenio para personas con baja visión o ceguera. Busca servicios troncales, muestra recorridos, interpreta preguntas por reglas u Ollama y ofrece voz, estaciones cercanas, lupa y enlaces telefónicos. La carga asumida es una demostración académica con pocos usuarios simultáneos y un servidor Next.js; no se midió capacidad bajo carga.

**Dictamen:** existe una base reutilizable para la entrega. Antes de presentar la aplicación como guía de viaje, deben corregirse la confusión entre recorrido y parada, las contradicciones de sentido y las afirmaciones de llegada basadas en ubicación imprecisa. Migrar la interfaz a iOS no corrige esas reglas del dominio.

## Alcance y calidad de la evidencia

- Se leyeron `AGENTS.md`, README, configuración de despliegue e integración continua, bibliotecas de dominio, endpoints, hooks, pantallas y pruebas TypeScript. Las skills solicitadas `how`, `why`, `codebase-design`, `domain-modeling` y `ponytail-audit` orientaron la revisión. Esta revisión fue una tarea delegada por la coordinación; no creó subagentes ni otros documentos de contexto o decisiones.
- Solo se añade este informe. No se modifican fuentes, dependencias, datos ni configuración; no se crean issues. No se accedió al host Windows, sus servicios, sus secretos ni la aplicación desplegada.
- El padre conserva la ejecución del baseline. Esta revisión ejecutó únicamente comprobaciones puntuales en memoria, importando funciones existentes y simulando eventos. No ejecutó compilación, `tsc`, `pnpm test` completo ni `pnpm verificar`.
- **Confianza alta, directa:** resultado determinable de una rama de código, reproducción determinista o afirmación explícita en fuente oficial abierta. Cada hallazgo distingue prueba ejecutada de caso propuesto para reproducir. **Confianza media:** efecto de interacción que necesita navegador o dispositivo real para confirmarse. **Pendiente:** dato no verificable con los accesos disponibles. La arquitectura y los cortes propuestos son recomendaciones, no funciones implementadas.
- Las referencias `archivo:línea` corresponden al commit anterior. Las fechas HTTP `Last-Modified` se distinguen de publicación editorial. Ninguna fecha de rastreo se trata como fecha de publicación.

El [issue #6](https://github.com/ZuluCode777/proyecto-1-APP/issues/6), creado el 2026-09-23 y actualizado el 2026-09-24, describe el MVP de septiembre. No constituye por sí solo una especificación de la segunda entrega. Se contrastó con los PDF locales `EnunciadoProyectoInicial-202610.pdf` y `Rubrica de calificacion Entrega Documento Final.pdf`, ubicados en el directorio padre del repositorio. El segundo lleva una impresión fechada 2026-10-21; no identifica una fecha editorial distinta. La rúbrica pide requisitos trazables, justificación tecnológica, diseño y evidencia de ejecución; no impone SwiftUI ni una lista nueva de funciones. El conjunto definitivo de requisitos de la segunda entrega sigue por confirmar.

La lectura de esos documentos separa tres hechos: se exige un MVP y evidencia de validación; el repositorio acredita una implementación de septiembre; no hay evidencia suficiente para declarar cumplidas nuevas funciones de noviembre. Este informe usa esa distinción para ordenar trabajo, sin convertir propuestas en compromisos aprobados.

## Flujos y contratos actuales

| Flujo | Recorrido real en código | Contrato que debe preservarse |
| --- | --- | --- |
| Inicio y modos | `app/page.tsx` → `TransMiVozApp`; modo, contraste y favoritas en `localStorage` | Preferencias locales; cambiar modo regresa a inicio. |
| Datos | `useTransmilenio` → `GET /api/transmilenio` → caché de servidor → ArcGIS capas 2 y 15; ante fallo, copia JSON | Datos públicos normalizados; petición compartida mientras está pendiente; seis horas en vivo y cinco minutos antes de reintentar tras fallo. |
| Búsqueda y detalle | `searchRoutes` → lista → selección por código → `RouteDetail` y Leaflet | Identificar servicio y sentido; geometría no demuestra que se pueda abordar. |
| Asistente | voz o texto → `POST /api/agent` con frase y coordenada opcional → Ollama opcional → `Intent` → `runIntent` → respuesta validada → voz y navegación | Ollama interpreta; `runIntent` obtiene hechos del catálogo. Salidas del modelo no ejecutan comandos ni consultas arbitrarias. |
| Respaldo del asistente | Si la petición falla y ya hay datos, `interpretCommand` corre en navegador | El respaldo depende de datos previamente cargados; no equivale a disponibilidad sin red desde un arranque frío. |
| GPS | permiso explícito en pantalla GPS → `watchPosition` → distancia y rumbo hacia estaciones → aviso de proximidad; Google Maps solo al pulsar botón | Ubicación, precisión, antigüedad y referencia de brújula deben viajar juntas. Un punto de estación no demuestra acceso peatonal. |
| Lupa | `getUserMedia(video, audio:false)` → vídeo, filtros CSS, zoom y pausa | No reconoce ni lee texto. Detiene pistas al salir, incluso si el permiso llega tarde. |
| Emergencia | enlaces `tel:123`, `tel:156`, `tel:195` | Abre el marcador; no demuestra llamada completada, atención o despacho de ayuda. |

Referencias principales: `components/transmivoz-app.tsx:40–58`, `hooks/use-transmilenio.ts:6–32`, `lib/transmilenio-data.ts:17–33`, `app/api/agent/route.ts:54–90`, `components/total-agent.tsx:55–95`, `components/auditory-gps.tsx:80–155`, `components/vision-assist.tsx:47–84` y `components/assistance.tsx:12–16`.

### Vocabulario del dominio que condiciona el diseño

- **Estación:** entidad geográfica identificada por `Station.id`. Su coordenada actual no representa un acceso ni un vagón accesible.
- **Lugar:** agrupación de estaciones por nombre corto, como los dos Ricaurte (`lib/routes.ts:9–17`). Esta agrupación permite buscar; no acredita una conexión peatonal accesible.
- **Servicio y sentido:** oferta identificada actualmente por `BusRoute.code`, origen y destino. Debe tener una secuencia consistente de paradas atendidas.
- **Recorrido:** geometría por la que circula un servicio. Puede pasar cerca de una estación sin detenerse.
- **Parada atendida:** punto y orden donde el servicio permite subir o bajar. Hoy `BusRoute.stops` guarda estaciones inferidas por geometría, aunque el planificador las consume como paradas.
- **Plan:** uno o dos tramos con abordaje y descenso. Debe derivarse de paradas confirmadas; para recomendar viajar ahora también necesita vigencia y calendario.
- **Proximidad:** distancia estimada entre coordenadas. No significa entrada localizada, ruta peatonal ni llegada confirmada.

La primera corrección pertenece al modelo y normalizador de transporte, compartidos por web, API e iOS. Añadir advertencias distintas en cada pantalla conservaría la confusión.

## Funciones implementadas, parciales y ausentes

| Función del MVP documentado o de esta propuesta | Estado observado | Evidencia y límite |
| --- | --- | --- |
| Interfaz web con dos modos y alto contraste | Implementada; validación accesible parcial | `components/transmivoz-app.tsx:45–83`, `app/globals.css:62–166`; falta prueba de navegación y foco con lector de pantalla. |
| Catálogo real y copia de respaldo | Implementada; recuperación parcial | `lib/transmilenio-data.ts:17–33`; la copia contiene 153 estaciones y 124 servicios, consultados el 2026-09-24. No es inventario verificado de noviembre. |
| Búsqueda por estación o código | Parcial | `lib/routes.ts:104–141`; 16 códigos existentes no son reconocidos. |
| Recorridos y mapas | Implementados para geometría | `components/transit-map.tsx:43–110`; teselas dependen de OpenStreetMap. Paradas y sentido requieren corrección. |
| Viaje directo y con un transbordo | Parcial | `lib/routes.ts:163–203`; calcula candidatos geométricos, sin validar paradas reales ni horario vigente. |
| Asistente escrito y hablado | Parcial | `components/total-agent.tsx:55–193`; preguntas aisladas, sin conservar origen de una aclaración. |
| Ollama local con reglas de respaldo | Implementado; funcionamiento real no revalidado | `lib/ollama.ts:121–171`; las pruebas simulan respuestas. No se llamó al Ollama de Windows. |
| Síntesis y reconocimiento de voz | Integración implementada | `hooks/use-speech.ts:42–126`; disponibilidad de la API no prueba reconocimiento, audio audible ni procesamiento local. |
| Estaciones cercanas y GPS auditivo | Parcial | `components/auditory-gps.tsx:44–155`; rumbo y distancia, sin cálculo de itinerario peatonal dentro de la app. |
| Lupa, cuatro filtros, zoom y congelado | Implementados | `components/vision-assist.tsx:13–36, 87–107, 174–209`. |
| Lectura automática de letreros, reconocimiento de buses u obstáculos | Ausentes | La lupa solo manipula vídeo; `package.json` y `components/vision-assist.tsx` no contienen reconocimiento de imágenes o texto. El issue #6 excluye la promesa anterior de leer letreros. |
| Ayuda telefónica | Implementada como enlaces | `components/assistance.tsx:29–55`; 123 y 195 corroborados; etiqueta de 156 pendiente de verificar. |
| Favoritas | Implementadas localmente | `hooks/use-favorites.ts:25–42`; empieza con sugerencias, sin cuenta ni sincronización. |
| Tarifas y llegadas de buses en vivo | Ausentes y declaradas como tales | `lib/local-agent.ts:213–218`; no es por sí mismo un defecto respecto al MVP de septiembre. Disponibilidad externa de datos en vivo sigue abierta. |
| Notificaciones operacionales | Ausentes | Campana responde siempre que no hay novedades: `components/transmivoz-app.tsx:165`. No hay suscripción o consulta de alertas. |
| Arranque completo sin conexión | Ausente como garantía | Copia del lado servidor y datos en memoria del navegador; no se encontró service worker ni almacenamiento duradero del catálogo. |
| Aplicación nativa SwiftUI | Ausente; propuesta en este informe | Árbol actual contiene Next.js/React, sin proyecto Xcode ni archivos Swift. |
| Pruebas y diagnóstico | Implementados; prueba de tareas reales insuficiente | `package.json:9`, `components/diagnostics.tsx:30–156`, `scripts/verificar.mjs:132–161`. |

## Hallazgos que deben corregirse

Orden por impacto sobre la persona y después por alcance de la corrección. P1: afecta instrucciones de viaje, privacidad o control de la interacción principal. P2: falla funcional o garantía sin demostrar. No hay evidencia para asignar una vulnerabilidad crítica ni para declarar segura la guía en calle.

### 1. P1: el planificador transforma estaciones cercanas a la línea en lugares de abordaje

- **Qué ocurre:** `lib/transmilenio.ts:140–148` deduce `stops` a menos de 60 m; `lib/routes.ts:114–119, 169–196` los trata como paradas. `lib/local-agent.ts:178–184` y `components/trip-view.tsx:71–79` dan órdenes de subir y bajar sin esa incertidumbre.
- **Reproducción:** con la copia actual, `planTrip` entre Calle 127 y Portal Usme, con límite 124, incluye un tramo H72 que aborda en Calle 127. El propio proveedor documentó que H72 dejó de parar allí [F2]; la copia contiene 38 estaciones del recorrido de H72. La falta de confirmación no depende de que ese aviso histórico siga vigente hoy.
- **Corrección y dueño:** incorporar paradas atendidas, orden, sentido y procedencia en `lib/transmilenio.ts`; `planTrip` debe excluir abordajes no confirmados. Mantener geometría para dibujar. TransMilenio sí enumera una matriz de paradas troncales [F1]; su descarga y vigencia deben validarse antes de integrarla.
- **Si se omite:** la persona puede esperar un servicio que no se detiene o recibir un descenso imposible. **Confianza alta** en el defecto y reproducción; estado operativo actual de cada parada, pendiente de catálogo vigente.

### 2. P1: etiqueta de sentido y secuencia de estaciones se contradicen

- **Qué ocurre:** `lib/transmilenio.ts:141–159` ordena estaciones por la polilínea y construye etiquetas con `orig_ruta` y `dest_ruta` sin reconciliarlos. El plan usa un orden y el detalle anuncia el otro (`components/route-detail.tsx:18–26`).
- **Reproducción:** en la copia, `8 G` declara `from: Guatoque - Veraguas`, `to: Terminal`, pero `stops[0]` es Terminal y el último es Guatoque - Veraguas. El viaje Portal Norte → Portal Usme recomienda `8 G` hasta Toberín, mientras su etiqueta anuncia dirección Terminal. `8 T` presenta la contradicción inversa.
- **Corrección y dueño:** el normalizador debe fijar un sentido consistente con la secuencia oficial de paradas. Añadir una prueba con esos dos registros reales; no invertir todas las geometrías indiscriminadamente.
- **Si se omite:** selección y voz pueden indicar sentidos opuestos. **Confianza alta** en contradicción interna; cuál atributo upstream está errado requiere conciliación con fuente oficial vigente.

### 3. P1: el GPS anuncia llegada ignorando precisión y acceso

- **Qué ocurre:** `components/auditory-gps.tsx:88–98` descarta `coords.accuracy`; `:120–128` anuncia llegada si el centro estimado queda a 30 m de la coordenada de estación. La API comunica incertidumbre en metros [F5].
- **Reproducción:** entregar al callback una posición a 20 m del destino con `accuracy: 200`, elegir ese destino y observar que la condición anuncia llegada igualmente. No comprueba entrada ni lado de la vía.
- **Corrección y dueño:** conservar precisión y marca de tiempo en el módulo de ubicación; anunciar proximidad estimada y precisión insuficiente cuando corresponda. Solo una entrada verificada y una regla validada permiten afirmar llegada al acceso. Explicar que rumbo directo no es itinerario peatonal.
- **Si se omite:** una estimación amplia se comunica como confirmación física. **Confianza alta** en condición; prueba en calle no realizada.

### 4. P1: orientación relativa se usa como brújula y deja listeners activos

- **Qué ocurre:** `components/auditory-gps.tsx:57–78` convierte cualquier `alpha` a norte sin consultar `event.absolute`. Escucha simultáneamente eventos relativos y absolutos; el último puede sobrescribir al válido. No elimina esos listeners al salir; la limpieza de `:102–108` solo cancela el GPS.
- **Reproducción:** emitir `{alpha:0, absolute:false}`: el handler fija heading 0 aunque la referencia arbitraria no represente norte [F4]. Entrar, activar y salir tres veces registra handlers nuevos sin retirarlos. Pulsar activar repetidamente antes de la primera posición también deja watchers anteriores sin identificador para cancelarlos.
- **Corrección y dueño:** en GPS, aceptar rumbo con referencia válida y usar cardinales cuando falte; gestionar una sola suscripción y retirar todos los listeners y watchers al salir o reintentar.
- **Si se omite:** una indicación puede ordenar ir de frente hacia una dirección equivocada y el uso de sensores puede continuar fuera de pantalla. **Confianza alta** por trazado de eventos; calibración física no probada.

### 5. P1: el asistente reutiliza indefinidamente la primera ubicación

- **Qué ocurre:** `components/total-agent.tsx:41–52` evita toda adquisición cuando `positionRef.current` ya existe. La posición no tiene hora ni precisión y se envía en cada pregunta (`:65–68`).
- **Reproducción:** obtener posición junto a Portal Usme, desplazarse o simular otra ubicación sin desmontar el asistente y preguntar por Molinos. No se solicita una nueva posición; `lib/local-agent.ts:267–270` sigue usando Portal Usme como origen.
- **Corrección y dueño:** el estado de ubicación debe conservar fecha y precisión, renovarse cuando se necesite y permitir origen escrito. Coordinarlo con GPS; un único dueño del dato evita dos ubicaciones contradictorias.
- **Si se omite:** instrucciones de viaje parten de un lugar anterior. **Confianza alta** en comportamiento de caché; movimiento físico no ensayado.

### 6. P1: el diálogo de voz reinicia la escucha y acepta resultados después de cerrar

- **Qué ocurre:** `hooks/use-speech.ts:108–115` cambia `start` cuando cambia `listening`; el efecto de `components/voice-overlay.tsx:46–57` depende de `start` y vuelve a programarlo al terminar una escucha. Cerrar usa `stop()` (`:59–63`), que puede producir resultado; `handleResult` no comprueba apertura (`:19–24`). Esa distinción entre detener y abortar está documentada [F3].
- **Reproducción:** abrir búsqueda hablada, emitir `onerror(no-speech)` y `onend`, esperar 900 ms: vuelve a iniciar sin otro toque. Cerrar y entregar un `onresult` tardío con B23 sigue llamando `onTranscript`. Una simulación del hook y componente reales produjo `1 → 2` escuchas y una transcripción con `open:false`.
- **Corrección y dueño:** estabilizar el control del reconocimiento y programar apertura una sola vez; cerrar debe abortar, invalidar resultados y limpiar temporizadores. Conservar reintento explícito.
- **Si se omite:** se reactiva captura sin intención nueva o se navega después de cancelar. **Confianza alta** con simulación; evento real varía según navegador.

### 7. P1: una respuesta pendiente puede hablar fuera de su pantalla y no tiene espera máxima de cliente

- **Qué ocurre:** `components/total-agent.tsx:65–95` no cancela ni limita el `fetch`. La revisión de vigencia ocurre solo antes de navegar; los pasos y `speak` suceden antes. Al desmontar solo se incrementa `lastAskRef` (`:144–150`).
- **Reproducción:** mantener pendiente `/api/agent`, salir del asistente y resolver la petición. El flujo alcanza `speak(reply.reply)` pese al desmontaje. Si la conexión no resuelve ni rechaza, `busyRef` permanece activo y bloquea preguntas en esa instancia.
- **Corrección y dueño:** el controlador de pregunta debe poseer `AbortController`, espera máxima e identificador vigente; comprobar vigencia antes de cualquier efecto, incluyendo voz. Cancelar al salir y usar respaldo local únicamente si la pregunta continúa activa.
- **Si se omite:** respuesta anterior interrumpe otra tarea o el asistente queda esperando sin recuperación. **Confianza alta** en flujo; no se provocó fallo en servidor real.

### 8. P1: no se informa la salida de audio, texto y ubicación antes de usarlos

- **Qué ocurre:** `hooks/use-speech.ts:75–94` no exige reconocimiento local. MDN explica que algunos navegadores envían audio a un servicio y que `processLocally:false` permite procesamiento remoto [F3, F6]. `components/total-agent.tsx:167, 190` pide ubicación incluso para un saludo escrito; `:68` la adjunta cuando ya está disponible. No se encontró aviso de privacidad o control de uso de ubicación en esas pantallas.
- **Reproducción:** conceder ubicación una vez y enviar «hola»: viaja la coordenada aunque la intención no la necesita. Abrir voz no explica que el audio puede salir del dispositivo. La cámara de la lupa, en cambio, no tiene carga de imágenes en su flujo revisado.
- **Corrección y dueño:** informar destinatarios y propósito antes de captura; permitir texto y origen manual sin ubicación. Solicitar coordenada solo cuando el flujo lo requiera y ofrecer revocación. Distinguir audio del navegador, texto al backend, frase a Ollama y apertura opcional de Google Maps (`components/auditory-gps.tsx:152–154`).
- **Si se omite:** usar Ollama local se puede interpretar erróneamente como privacidad de todo el recorrido. **Confianza alta** en datos enviados y falta de control en código; proveedor, retención efectiva y cumplimiento jurídico no verificados.

### 9. P2: datos vacíos son válidos y provocan excepción en GPS del asistente

- **Qué ocurre:** `lib/transmilenio.ts:52–59, 122–129` acepta catálogos vacíos; `lib/transmilenio-data.ts:20–22` los guarda como éxito. `lib/local-agent.ts:226–229` accede a `nearest.name` sin comprobar existencia.
- **Reproducción ejecutada:** `normalizeTransmilenio({features:[]},{features:[]},fecha,"live")` pasa `TransmilenioDataSchema.safeParse`; `interpretCommand("donde estoy",datosVacios,{position})` lanza `Cannot read properties of undefined (reading 'name')`.
- **Corrección y dueño:** validar completitud mínima y referencias del catálogo antes de reemplazar la caché; usar último dato válido o copia si falla. El resolutor debe devolver un mensaje recuperable cuando no haya estaciones, también para `trip` (`:267–269`).
- **Si se omite:** un éxito HTTP vacío desactiva respaldo y puede convertir preguntas en errores del servidor. **Confianza alta**, reproducido sin red.

### 10. P2: dieciséis servicios del catálogo no pueden pedirse por código

- **Qué ocurre:** `lib/routes.ts:104–111` exige letras antes de números. `lib/text.ts:29–32` descarta palabras de un carácter; la búsqueda alternativa pierde también `8 G`.
- **Reproducción ejecutada:** `findRouteByCode("8 G",data)` devuelve `undefined`; `searchRoutes("8 G",data)` devuelve `[]`; «información de la 8 G» no abre ruta. Afecta `1 P`, `1 U`, `2 M`, `2 P`, `3 C`, `3 P`, `4 H`, `4 P`, `5 C`, `5 P`, `6 C`, `6 P`, `7 E`, `7 P`, `8 G`, `8 T`.
- **Corrección y dueño:** resolver códigos con el índice del catálogo, admitiendo espacios y orden publicados. Compartir ese comportamiento con reglas y validación de Ollama, que también llama a `findRouteByCode` (`lib/ollama.ts:153`).
- **Si se omite:** el asistente puede recomendar una ruta que después no logra consultar por su código. **Confianza alta**, barrido de los 124 códigos ejecutado.

### 11. P2: el asistente pide una aclaración que no sabe continuar

- **Qué ocurre:** `lib/local-agent.ts:308–309` pregunta destino, pero `AgentContext` solo admite ubicación (`:80–83`). El cliente envía frase y posición; no hay origen pendiente en cliente o endpoint.
- **Reproducción ejecutada:** «salgo desde Ricaurte» responde preguntando destino. Responder «Calle 72» lista 28 rutas y vuelve a pedir origen, en vez de resolver Ricaurte → Calle 72. Con ubicación concedida puede sustituir el origen expresado por el origen geográfico.
- **Corrección y dueño:** representar la aclaración pendiente en la interfaz del asistente y enviarla explícitamente al resolutor. Cancelar debe limpiar ese estado. No hace falta almacenar historiales completos ni introducir memoria del modelo.
- **Si se omite:** la conversación ofrecida por la app entra en una repetición y aumenta la carga para usuarios de voz. **Confianza alta**, dos turnos reproducidos.

### 12. P2: cambiar de pantalla no coloca el foco en el resultado

- **Qué ocurre:** `components/transmivoz-app.tsx:55–58, 123–145` cambia estado React; no mueve foco ni mantiene un destino de foco. `components/screen-header.tsx:31` solo dibuja un encabezado sin foco programático. Las pantallas salientes se desmontan.
- **Reproducción propuesta:** con teclado, activar una ruta de la lista y revisar `document.activeElement` después del desmontaje; continuar con Tab. Desde un viaje abierto automáticamente, verificar con VoiceOver dónde comienza la siguiente exploración. El código no ordena empezar en título o instrucciones del resultado.
- **Corrección y dueño:** navegación de la aplicación debe definir foco de entrada y restauración al volver, con título identificable. Coordinar anuncios con el lector de pantalla para evitar voz duplicada; preservar el diálogo nativo ya usado en `components/modal.tsx:13–24`.
- **Si se omite:** una respuesta hablada puede abrir contenido sin ofrecer una continuación predecible por teclado o lector. **Confianza media**; falta validación en navegador y lector de pantalla reales, por lo que no se declara aquí incumplimiento WCAG específico.

### 13. P2: el navegador conserva para siempre el primer catálogo y no ofrece reintento en pantalla

- **Qué ocurre:** `hooks/use-transmilenio.ts:6–17` conserva la promesa exitosa sin vencimiento; el TTL de seis horas solo existe en servidor. Tras error, limpia la promesa, pero el efecto montado no reintenta (`:24–32`). La pantalla de error no ofrece recuperación (`components/transmivoz-app.tsx:152–155`).
- **Reproducción:** mantener abierta la app tras seis horas no hace otra consulta; cambiar entre pantallas usa la misma promesa. Si la primera carga falla y vuelve la conexión, el estado permanece fallido hasta remontar o recargar. La lista muestra fecha pero no `source` (`components/route-list.tsx:25–29`); detalle y viaje tampoco anuncian respaldo o antigüedad.
- **Corrección y dueño:** el hook de datos debe poseer vencimiento, reintento explícito y estado de procedencia. Mostrar y anunciar antigüedad cuando modifica la confianza del plan, usando una versión común para catálogo y viaje.
- **Si se omite:** backend actualizado y pantalla abierta pueden mostrar versiones distintas; una copia antigua parece consulta operativa actual. **Confianza alta** por ciclo de caché; no se esperaron seis horas.

### 14. P2: el plan recomienda tomar servicios sin evaluar cuándo operan

- **Qué ocurre:** `lib/routes.ts:163–209` solo evalúa orden de estaciones y número de tramos. La interfaz no recibe fecha, hora o calendario; `schedule` contiene textos (`lib/transmilenio.ts:44–48`). `describePlan` dice «Toma la…» sin aclarar que es una conexión sin validación temporal.
- **Reproducción ejecutada:** un servicio de prueba con tres estaciones y todos sus horarios vacíos se devuelve como plan directo. La misma consulta a medianoche y de día produce las mismas opciones por diseño.
- **Corrección y dueño:** mientras no haya calendario estructurado, presentar opciones como conexiones y advertir que falta verificar operación. Para un plan de salida inmediata, calendario, hora de Bogotá y vigencia pertenecen al planificador y a la fuente normalizada, no a textos calculados por el modelo.
- **Si se omite:** la persona puede recibir como instrucción inmediata una conexión no operativa. **Confianza alta** sobre ausencia de validación; no se identificó una salida operativa concreta de noviembre.

### 15. P2: una clasificación «unknown» de Ollama anula reglas que sí entienden la pregunta

- **Qué ocurre:** `lib/ollama.ts:170–171` devuelve `{type:"unknown"}` como intención válida; `app/api/agent/route.ts:83–84` la ejecuta directamente. No intenta reglas para esa falta de comprensión.
- **Reproducción ejecutada:** simular JSON válido de Ollama con `intent:"unknown"` para «información de la B23». El adaptador devuelve `unknown`, mientras `parseIntent` obtiene `route_info/B23` con los mismos datos. No se afirma que el modelo real falle con esa frase.
- **Corrección y dueño:** política de selección de intérprete en el endpoint: ante desconocimiento del modelo, usar la intención conocida de reglas. Mantener validación de entidades y respuestas de desconocimiento cuando ninguno entiende.
- **Si se omite:** activar el modelo puede hacer fallar comandos que funcionan sin él. **Confianza alta** con salida simulada; frecuencia en modelo real desconocida.

### 16. P2: las nueve pruebas pueden aprobar sin comprobar las tareas anunciadas

- **Qué ocurre:** `components/diagnostics.tsx:113–118` comprueba existencia de reconocimiento, sin iniciarlo; `:97–109` encola voz sin esperar éxito de reproducción; `:64–65` acepta cualquier acción `trip`. `scripts/verificar.mjs:55–56, 126–130` simula dispositivos y permisos. `lib/routes.test.ts:52–58` ni siquiera exige dos tramos en el caso llamado transbordo.
- **Reproducción:** un navegador con constructor de voz presente pero servicio inaccesible obtiene «Disponible» en diagnóstico. Un asistente que devuelve un tramo geométrico incorrecto pasa si `action` es `trip`. La suite actual no ejercita cierre de micrófono, foco, origen de aclaraciones ni viaje contra paradas oficiales.
- **Corrección y dueño:** conservar diagnóstico como comprobación de capacidades. Añadir pruebas de tareas a través de la interfaz que las personas usan, con resultados de paradas confirmadas y aserciones concretas de transbordo. Separar permiso disponible, captura, reconocimiento y reproducción.
- **Si se omite:** CI en verde y «9 de 9» pueden respaldar afirmaciones que nunca verificaron. **Confianza alta** en alcance de los checks; esta revisión no ejecutó el baseline.

## Arquitectura nativa propuesta: SwiftUI con el backend existente

**Decisión propuesta, no implementada:** un único cliente iOS SwiftUI para presentación y sensores; Next.js continúa siendo dueño del catálogo, las reglas de transporte y la interpretación con Ollama. No se porta el planificador a Swift ni se añade otro servidor. La misma corrección de paradas debe beneficiar a ambos clientes.

### Propiedad y contratos

1. **Interfaz iOS:** `NavigationStack`, listas, formularios y controles SwiftUI estándar; textos escalables, etiquetas accesibles y foco de accesibilidad. Apple documenta soporte básico en controles y exige verificar la experiencia con tecnologías de asistencia [F7]. Un modelo de estado de aplicación, ligado al actor principal, posee navegación, consulta vigente y plan seleccionado; sin bus global de eventos ni arquitectura de plugins.
2. **Acceso HTTP concreto:** un `ClienteTransMiVoz` con `URLSession`, `async/await` y tipos `Codable` consume `GET /api/transmilenio` y `POST /api/agent`. Debe traducir la unión `action` de JSON a casos Swift, validar tramos no vacíos, cancelar tareas al salir y distinguir 401, 413, 429, timeout y ausencia de conexión. No copiar secretos al binario; para la demostración, clave introducida por la persona y almacenada en Keychain, enviada solo al origen HTTPS configurado. Autenticación de un producto público posterior exige una decisión propia.
3. **Transporte en backend:** ampliar `lib/transmilenio.ts` con paradas confirmadas, sentido, calendario y versión/procedencia. `lib/routes.ts` conserva planificación y búsquedas. Para selección explícita de origen/destino en iOS, un pequeño `POST /api/viajes` puede invocar ese planificador con identificadores validados. Así se evita convertir selecciones estructuradas a frases y volver a interpretarlas. No hace falta una capa adicional de servicios.
4. **Voz en iOS:** Speech y `AVAudioEngine` para captura; `AVSpeechSynthesizer` para respuesta y finalización del habla [F11]. Consultar soporte de reconocimiento local para idioma y dispositivo; solo usar `requiresOnDeviceRecognition` cuando está soportado. Si no lo está, ofrecer texto o procesamiento remoto explicado y consentido, sin prometer español colombiano sin conexión en todo iPhone [F8]. Un único dueño de sesión de audio evita escuchar la propia síntesis y reemplaza esperas fijas de 650/900 ms.
5. **Ubicación y mapa:** Core Location con permiso mientras se usa la app [F10]; conservar fecha, precisión y validez del rumbo. MapKit dibuja geometrías del backend; lista y descripción textual ofrecen el mismo contenido esencial. Al cerrar la tarea se detienen sensores. Un enlace explícito puede abrir navegación a pie externa; no presentar una línea hacia el centro de una estación como trayecto accesible verificado.
6. **Cámara:** AVFoundation para captura y zoom; filtros de imagen para la lupa. Si lectura de letreros entra realmente en el alcance, Vision ofrece reconocimiento local de texto y puntuaciones de confianza [F9]. Mostrar y leer texto reconocido requiere un corte separado; no convertir una lectura incierta en identificación confirmada de bus u obstáculo.
7. **Persistencia mínima:** preferencias y favoritas locales; catálogo y último plan descargados con fecha y versión. Sin conexión, mostrar solo datos disponibles y etiquetados. Planificar nuevos viajes offline implicaría otro alcance: no duplicar de inmediato reglas TypeScript en Swift.

El módulo profundo a conservar es la resolución de transporte: una interfaz de consulta pequeña oculta fuentes, normalización, validez de paradas y planificación. La variación real entre clientes está en presentación, sensores y accesibilidad; ahí encajan adaptadores nativos. `Station.id` y código de servicio deben permanecer estables y versionados en el contrato; nombres visibles no deben convertirse en identificadores nuevos de iOS.

### Comparación de reutilización

| Opción | Qué reutiliza | Trabajo y limitación material |
| --- | --- | --- |
| Continuar web | React, Leaflet, hooks y backend completos | Menor trabajo inicial; conserva límites y pruebas específicas del navegador para voz, foco y sensores. |
| Envolver web en WKWebView | Mayor parte de interfaz y backend | Sigue dependiendo de interfaz web; puentes de permisos y audio añaden trabajo. No satisface una interfaz nativa SwiftUI por sí sola. |
| SwiftUI con backend actual, propuesta elegida | Datos, normalización, planificador, parser, Ollama y pruebas de dominio | Reescribe vistas y sensores, incorpora contrato Swift y validación iOS; concentra reglas en un solo lugar. Requiere equipo con macOS/Xcode y pruebas en iPhone, no verificados aquí. |
| Reescribir también backend en Swift | Conceptos y datos de entrada | Duplica transición y pruebas; pierde reutilización inmediata sin necesidad demostrada para esta entrega. |

No se estiman días ni porcentajes de reutilización: faltan calendario, disponibilidad del equipo, acceso a Mac y requisitos cerrados. Reutilización funcional del backend tampoco equivale a ausencia de correcciones: los hallazgos 1, 2, 9, 10, 14 y 15 viven precisamente allí.

## Cortes verticales ordenados, listos para convertirse en tickets

No se han publicado issues. Cada fila describe un resultado comprobable de extremo a extremo, con dependencias explícitas.

| Orden | Corte y prioridad | Dueño mínimo | Criterio de aceptación | Dependencia |
| --- | --- | --- | --- | --- |
| E1 | P1: una recomendación usa paradas y sentido confirmados | Normalizador, modelo, planificador y presentación del viaje | Un expreso no se ofrece donde no para; 8 G/8 T tienen etiquetas y orden consistentes; procedencia y fecha visibles y habladas. Prueba de referencia independiente del cálculo geométrico. Cubre 1 y 2. | Obtener y validar fuente de paradas. |
| E2 | P1: orientar sin afirmar llegada incierta | Estado de ubicación y GPS | Precisión mala no anuncia llegada; evento relativo no se toma como norte; nueva ubicación reemplaza la antigua; activar/salir no deja listeners ni watchers. Cubre 3, 4 y 5. | Independiente de E1 para trabajar; acceso físico solo con datos verificados. |
| E3 | P1: hablar, cancelar y continuar otra tarea sin respuestas tardías | Hook de voz y controlador de preguntas | Sin reinicio automático tras `no-speech`; cerrar aborta; respuesta vieja no habla ni navega; timeout libera interfaz y ofrece recuperación. Cubre 6 y 7. | Ninguna. |
| E4 | P1/P2: completar consulta con permiso opcional y aclaración de origen | Asistente, contratos y navegación | Explicar envíos; «hola» no necesita coordenada; «salgo desde Ricaurte» → «Calle 72» conserva origen; cancelar lo borra; foco llega al resultado y vuelve al origen. Cubre 8, 11 y 12. | E3 para validar voz. |
| E5 | P2: buscar todos los códigos y recuperarse de datos o modelo fallidos | Índice de rutas, caché, endpoint | Los 124 códigos de la copia son consultables; respuesta vacía conserva datos válidos; usuario puede reintentar sin recargar; se informa copia/antigüedad; `unknown` de modelo usa reglas conocidas. Cubre 9, 10, 13 y 15. | Ninguna; conservar compatibilidad de JSON. |
| E6 | P2: distinguir conexión posible de servicio que opera ahora | Fuente normalizada, planificador y texto de respuesta | Si no hay calendario fiable, no afirmar salida inmediata; con calendario, excluir servicio fuera de operación en Bogotá y probar festivo/cambio de día. Cubre 14. | E1 y calendario verificable. |
| E7 | P2: demostrar tareas y documentar límites de la entrega | Pruebas de dominio, interfaz y documentación | Una búsqueda numérica, un viaje directo, un transbordo, una aclaración, cancelación y permiso denegado con aserciones reales; verificación manual con lector de pantalla. Evidencia fechada y separada de mocks. Cubre 16. | Criterios de E1–E6; puede construirse por corte. |
| E8 | Evolución propuesta: primera tarea nativa completa | SwiftUI + cliente HTTP, backend actual | En iPhone: seleccionar origen/destino, recibir un plan confirmado, explorarlo con VoiceOver y oírlo; permiso denegado y red caída recuperables. Sin secretos embebidos ni reglas duplicadas. | Alcance nativo aprobado, Mac/Xcode, E1 y E3–E5. |

OCR, alertas en vivo, obstáculos y navegación accesible por calle no se incluyen tácitamente en E8. Requieren necesidad validada, fuente y criterio de aceptación propios; actualmente son ausencias o propuestas, no trabajo prometido por el MVP de septiembre.

## Comprobaciones realizadas y pruebas que faltan

Se importaron los módulos existentes con `node --import ./test/register.mjs --input-type=module` y se ejecutaron reproducciones de catálogo, códigos, planes, aclaraciones y datos vacíos. También se simuló una salida `unknown` de Ollama. No hubo modificaciones de archivos para esas pruebas ni llamadas al modelo real.

Resultados observados:

- Copia: `fetchedAt = 2026-09-24T15:16:41.502Z`, `source = snapshot`, 153 estaciones, 124 rutas.
- Los 16 códigos enumerados en el hallazgo 10 fallaron en `findRouteByCode`.
- H72 apareció como opción de Calle 127 a Portal Usme; su lista geométrica tiene 38 estaciones.
- `8 G` y `8 T` presentan extremos opuestos a sus listas de estaciones.
- «salgo desde Ricaurte» y después «Calle 72» no formaron una conversación de viaje.
- Catálogo vacío pasó esquema y GPS produjo excepción.
- Una ruta sintética sin horarios fue devuelta como plan directo.
- La salida simulada de Ollama `unknown` desplazó una intención que reglas sí reconocían.
- Una simulación en memoria, transpiliando el hook y diálogo existentes y sustituyendo React y reconocimiento por dobles, confirmó reinicio automático y transcripción después del cierre. Es una comprobación de ciclo de estado, no una certificación de comportamiento de Chrome o Safari.

Para reproducir los defectos principales sin iniciar servidor:

```bash
node --import ./test/register.mjs --input-type=module <<'JS'
import datos from './data/transmilenio.json' with {type:'json'};
import {findPlaces,findRouteByCode,planTrip} from './lib/routes.ts';
import {interpretCommand} from './lib/local-agent.ts';
import {normalizeTransmilenio,TransmilenioDataSchema} from './lib/transmilenio.ts';
console.log('Código numérico:',findRouteByCode('8 G',datos));
const planes=planTrip({origin:findPlaces('Calle 127',datos)[0],destination:findPlaces('Portal Usme',datos)[0]},datos,124);
console.log('H72 desde Calle 127:',planes.some(p=>p.some(t=>t.route.code==='H72')));
for(const frase of ['salgo desde Ricaurte','Calle 72']) console.log(interpretCommand(frase,datos).reply);
const vacios=normalizeTransmilenio({features:[]},{features:[]},'2026-11-02T00:00:00Z','live');
console.log('Vacío válido:',TransmilenioDataSchema.safeParse(vacios).success);
try { interpretCommand('donde estoy',vacios,{position:{lat:4.6,lng:-74.1}}); }
catch(error) { console.log('Fallo GPS:',error.message); }
JS
```

Las pruebas actuales sí cubren reglas de intención, algunos viajes y búsquedas, nombres truncados, geometría, validación de JSON de Ollama, autenticación Basic y límite de frecuencia. La integración continua configura tipos, unitarias, instalador PowerShell, compilación y diagnóstico. No se declara su resultado actual: el padre ejecuta baseline. Una prueba verde de geometría valida su algoritmo, no la verdad de una parada operativa.

## Fronteras de confianza y restricciones de arquitectura

- **Bien resuelto y reutilizable:** esquemas Zod en entradas/salidas; latitud y longitud de la petición con rango; entidades de Ollama comprobadas contra catálogo; timeout del modelo; respaldo determinista; autenticación Basic cuando hay clave; comparación de hash con `timingSafeEqual`; caché con petición compartida y fallback; liberación de cámara al salir. Referencias: `app/api/agent/route.ts:37–42`, `lib/ollama.ts:136–164`, `lib/access.ts:10–18`, `lib/transmilenio-data.ts:14–33`, `components/vision-assist.tsx:63–84`.
- **Límite de seguridad concreto:** `app/api/agent/route.ts:64–65` comprueba 2.000 caracteres después de leer todo el cuerpo; no es un límite de lectura por streaming. No se hizo prueba de agotamiento ni se verificó un límite upstream. Antes de exposición pública amplia debe probarse ese límite efectivo, sin tratar la validación del mensaje como protección de memoria.
- **Despliegue actual documentado:** un proceso Next.js y Ollama propio; el limitador en memoria es coherente con ese prototipo. Sus comentarios ya declaran limitación por instancia (`lib/rate-limit.ts:4–7`) y confianza en `x-forwarded-for` detrás del proxy (`app/api/agent/route.ts:22–25`). No se califican como fallos de un despliegue multiproceso que no se observó.
- **Sin clave:** acceso permitido explícitamente en `lib/access.ts:10–11`; producción solo advierte en `instrumentation.ts:8–9`. No se leyó configuración efectiva, así que no se afirma que la app publicada esté abierta.
- **Datos personales:** coordenada y frase llegan al backend; solo la frase y catálogo entran en el prompt de Ollama (`lib/ollama.ts:125–134`). La lupa no envía imágenes en el código revisado. Las teselas se solicitan a OpenStreetMap y el botón externo de Google Maps incluye origen y destino. No se observaron escrituras de historial de conversaciones en este flujo; logs e infraestructura fuera del repo no fueron inspeccionados.
- **Escala y simplicidad:** el recorrido de pares para transbordo está documentado y acotado a 124 servicios (`lib/routes.ts:159–161`); no hay medición que justifique sustituirlo ahora. Primero corregir el significado de sus aristas. No se propone introducir base de datos, colas, microservicios o framework de agentes.

## Fuentes externas consultadas

Todas se consultaron el **2026-11-02**. Solo se usan fuentes primarias o documentación oficial. Las páginas que no pudieron abrirse no sustentan afirmaciones concluyentes.

| Ref. | Fuente y autor/editor | Fecha publicada o actualizada identificable | Evidencia y confianza |
| --- | --- | --- | --- |
| F1 | [Consulta toda la oferta de datos abiertos de TRANSMILENIO](https://www.transmilenio.gov.co/comunicaciones/noticias-de-transmilenio/boletines-informativos/consulta-toda-la-oferta-de-datos-abiertos-de-transmilenio), TRANSMILENIO S.A. | Actualización mostrada: 2025-12-02; publicación original no identificada. | Página abierta: enumera matriz de paradas troncales y horarios. Alta para existencia anunciada; no demuestra descarga vigente o licencia específica del recurso. |
| F2 | [Servicios B12–G12, B72–H72 y B11–G11 presentan novedad](https://www.transmilenio.gov.co/comunicaciones/publicaciones/2018/servicios-de-transmilenio-b12-g12-b72-h72-b11-g11-presentan-novedad), TRANSMILENIO S.A. | Aviso refiere cambio del 2018-11-03; página muestra actualización 2026-04-22. | Página abierta: H72/B72 dejan de parar en Calle 127. Alta para aviso histórico; vigencia actual debe reconciliarse. |
| F3 | [SpeechRecognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition), MDN contributors | Última modificación mostrada: 2026-08-19. | Página abierta: disponibilidad limitada, posible servicio remoto y diferencia `stop`/`abort`. Alta para contrato de API; proveedor concreto depende del navegador. |
| F4 | [DeviceOrientationEvent.absolute](https://developer.mozilla.org/en-US/docs/Web/API/DeviceOrientationEvent/absolute), MDN contributors | Última modificación mostrada: 2023-12-16. | Página abierta: `absolute:false` usa referencia arbitraria. Alta. |
| F5 | [GeolocationCoordinates.accuracy](https://developer.mozilla.org/en-US/docs/Web/API/GeolocationCoordinates/accuracy), MDN contributors | Última modificación mostrada: 2023-12-31. | Página abierta: precisión en metros y nivel de confianza. Alta; no certifica ubicación física de la app. |
| F6 | [SpeechRecognition.processLocally](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/processLocally), MDN contributors | Última modificación mostrada: 2025-09-30. | Página abierta: valor por defecto permite procesamiento local o remoto; propiedad experimental. Alta, sin asumir soporte `es-CO`. |
| F7 | [Accessibility fundamentals](https://developer.apple.com/documentation/swiftui/accessibility-fundamentals), Apple Developer | Publicación no indicada; respuesta Markdown con `Last-Modified: 2026-09-10`. | HTML solicitó JavaScript; se abrió [versión Markdown oficial](https://developer.apple.com/documentation/swiftui/accessibility-fundamentals.md) por HTTP. Soporte de controles y verificación con tecnologías de asistencia. Alta. |
| F8 | [requiresOnDeviceRecognition](https://developer.apple.com/documentation/speech/sfspeechrecognitionrequest/requiresondevicerecognition), Apple Developer | Publicación no indicada; versión Markdown con `Last-Modified: 2026-08-06`. | [Contenido oficial abierto](https://developer.apple.com/documentation/speech/sfspeechrecognitionrequest/requiresondevicerecognition.md): requiere soporte del reconocedor para mantener audio local. Alta; idiomas/dispositivos de destino no comprobados. |
| F9 | [Recognizing Text in Images](https://developer.apple.com/documentation/vision/recognizing-text-in-images), Apple Developer | Publicación no indicada; versión Markdown con `Last-Modified: 2026-08-06`. | [Contenido oficial abierto](https://developer.apple.com/documentation/vision/recognizing-text-in-images.md): reconocimiento en dispositivo y confianza de candidatos. Alta sobre capacidad del framework; calidad con letreros reales no evaluada. |
| F10 | [requestWhenInUseAuthorization](https://developer.apple.com/documentation/corelocation/cllocationmanager/requestwheninuseauthorization()), Apple Developer | Publicación no indicada; versión Markdown con `Last-Modified: 2026-10-14`. | [Contenido oficial abierto](https://developer.apple.com/documentation/corelocation/cllocationmanager/requestwheninuseauthorization().md): permiso en uso, descripción de propósito y seguimiento esperado. Alta. |
| F11 | [AVSpeechSynthesizer](https://developer.apple.com/documentation/avfaudio/avspeechsynthesizer), Apple Developer | Publicación no indicada; versión Markdown con `Last-Modified: 2026-11-02`. | [Contenido oficial abierto](https://developer.apple.com/documentation/avfaudio/avspeechsynthesizer.md): síntesis, cola, cancelación y delegado de eventos. Alta. |
| F12 | [Nuestros canales de atención](https://www.transmilenio.gov.co/atencion-y-servicio-a-la-ciudadania/canales-de-atencion-al-usuario/nuestros-canales-de-atencion), TRANSMILENIO S.A. | Actualización mostrada: 2026-04-22. | Página abierta: 123 para seguridad/emergencias y 195 para atención. Alta para esos canales. No corrobora etiqueta «Policía de TransMilenio, 156»; no demuestra por sí sola que 156 esté desconectado. |
| F13 | [FeatureServer de planificación del SITP](https://gis.transmilenio.gov.co/arcgis/rest/services/ConsultaSubgerenciaPlanificacionSITP/Consulta_Planificacion_SITP/FeatureServer?f=pjson), TRANSMILENIO S.A. | Sin fecha editorial; descripción refiere base elaborada en 2024. | JSON oficial abierto por HTTP: capas 2 y 15, límite publicado de 2.000 registros. Alta para metadatos observados; no se hizo inventario operativo completo en vivo. |
| F14 | [GTFS Bogotá](https://gis.transmilenio.gov.co/gtfs/), dominio oficial de TRANSMILENIO | Sin fecha verificable. | Búsqueda mostró referencias a posiciones y actualizaciones, pero apertura web y HTTP directo devolvieron 500. **No confirmado** contenido actual, cobertura, licencia o acceso a feeds. No sustenta promesa de tiempo real ni una conclusión de inexistencia. |
| F15 | [Matriz de paradas troncales](https://datosabiertos.bogota.gov.co/dataset/matriz-de-paradas-rutas-troncales-transmilenio), portal distrital | Sin fecha verificable en esta revisión. | Apertura no accesible por herramienta. F1 acredita anuncio; descarga, esquema, versión y vigencia quedan pendientes. |

Los documentos PDF locales se convirtieron con MarkItDown para cotejar estructura y contenido, además de una extracción de texto inicial. Se verificó que las conversiones no estuvieran vacías. No se asigna a esos PDF un URL público inventado: están disponibles en el directorio de proyecto y la rúbrica solo muestra un enlace de aula privada truncado.

## Incertidumbres y partes no comprobadas

- No se verificaron servicios de Windows, disponibilidad del despliegue, configuración efectiva de clave o logs. No se probaron llamadas telefónicas, llamadas de emergencia, micrófono real, brújula física, cámara de iPhone ni recorrido en vía pública.
- No se evaluaron capacidades del grupo, acceso a Mac, costo de distribución iOS, idioma exacto disponible para reconocimiento local o comportamiento en segundo plano. La propuesta mantiene sensores en uso; segundo plano exige otro requisito y validación.
- El catálogo de referencia para paradas debe descargarse y conciliar identificadores, sentido, fechas y calendario. El buscador oficial de H72 apareció en búsqueda, pero su apertura solo devolvió una página que exige JavaScript; el resultado de búsqueda no se usó como prueba independiente de un inventario actual.
- La afirmación de README `:68–69` sobre inexistencia de posiciones en tiempo real no quedó verificada. F14 es una pista fallida de acceso, no evidencia de ausencia. Mantener función fuera del alcance actual es una decisión de producto válida; justificarla con una inexistencia general no comprobada exige corrección documental.
- F12 no valida 156. Antes de la demostración debe corroborarse canal y etiqueta con una fuente institucional vigente; nunca probarlo llamando a emergencias durante una prueba técnica.
- Historia local y documentación explican que el límite geométrico era conocido. No se infiere una decisión de seguridad validada a partir de ese reconocimiento. No se consultaron conversaciones del equipo, analítica, incidencias de producción ni documentos externos privados; no hay evidencia para atribuir motivaciones adicionales.
- Instaladores y procesos PowerShell no se auditaron en profundidad: son infraestructura fuera del foco solicitado y el host real quedó excluido. Tampoco se revalidó el contraste calculado ni la experiencia real con personas con discapacidad visual.

**Prioridad de cierre:** E1–E4 antes de validar autonomía de viaje; E5–E7 para una demostración verificable y recuperable. SwiftUI puede reutilizar esas correcciones mediante el backend existente, con E8 como primera tarea nativa completa.
