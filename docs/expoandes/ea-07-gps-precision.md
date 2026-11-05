# EA-07 (#33): precisión de GPS, frescura de ubicación y rumbo fiable

Rama `ea-07-gps-precision`, desde `origin/main` 11838e5 (con EA-05, EA-06 y EA-08
fusionados). Implementado en Linux; no se modificaron la copia operativa
(`data/transmilenio.json`), los workflows, las configuraciones de producción ni
los servicios de Windows, y no se accedió a Windows, SSH, Ollama real ni hardware.

Responde a los criterios de aceptación de EA-07: conservar posición, precisión y
hora; no anunciar llegada con datos imprecisos; validar la referencia del rumbo
(el `alpha` relativo no es el norte); una sola adquisición por sesión sin fugas; y
documentar una política compartida para la futura adaptación a Core Location.

> **Advertencia sobre los umbrales.** Los valores de edad y precisión de este
> documento son **hipótesis** iniciales, razonables para la web en un teléfono,
> **no garantías físicas** ni medidas con un iPhone real. No se ha probado en
> iPhone ni con VoiceOver; la validación con dispositivo queda pendiente. Lo que
> aquí se verifica es el COMPORTAMIENTO del código (tipos y pruebas en Linux), no
> el rendimiento físico del sensor.

## Política compartida: `lib/ubicacion.ts`

Toda la lógica de decisión vive en un módulo pequeño de funciones **puras**, sin
DOM, sin temporizadores y con el instante inyectable (`ahora`). No es una
plataforma de ubicación ni una abstracción de hardware: es la frontera entre los
datos no confiables del navegador y el resto de la app. La usan por igual:

- el GPS auditivo (`components/auditory-gps.tsx`), y
- la ruta de ubicación del asistente (`components/total-agent.tsx` →
  `lib/consulta-agente.ts` → `app/api/agent/route.ts`),

para que no divergan en qué consideran «fresco», «llegada» o «rumbo fiable».

### Tipos

- `LecturaUbicacion = { lat, lng, precision, hora }`. Además de la coordenada,
  lleva el **radio de precisión** (`GeolocationCoordinates.accuracy`, en metros,
  `null` si el navegador no lo entrega) y la **hora de captura**
  (`GeolocationPosition.timestamp`, epoch en ms, **`null` si el navegador no la
  entrega o no es un tiempo válido**). La hora NO se fabrica: sin una hora real no
  hay evidencia de que la posición sea actual.
- `LecturaRumbo = { grados, referencia, calidad, hora }` (`hora`: epoch ms de la
  **captura del evento**, o `null` si no se pudo verificar) con
  `referencia: "absoluta" | "relativa"` y `calidad` = cota de error en grados si
  la plataforma la da (`webkitCompassAccuracy` de iOS), o `null` si no la ofrece
  (los `alpha` absolutos de otras plataformas no traen calidad).

### Funciones

- `leerPosicionNavegador(posición, ahora?)`: valida y normaliza una
  `GeolocationPosition` a `LecturaUbicacion`. Rechaza lat/lng no finitas o fuera
  de rango (devuelve `null`). `accuracy` ausente o negativa → `precision: null`.
  `timestamp` ausente, no finito o adelantado más de **2 s** → `hora: null`. **No sustituye la
  hora ausente por `ahora`** (no renueva datos viejos al normalizarlos).
- `esFresca` / `ubicacionVigente`: exigen una hora de captura válida (finita, no
  negativa y con adelanto máximo de **2 s** respecto al reloj que valida) y reciente. Sin hora válida, no es fresca. Base de «no
  reutilizar ni enviar coordenadas vencidas».
- `decisionLlegada(posición, distanciaM, …)`: decide si hay **proximidad fiable**
  al punto. Exige **distancia pequeña Y precisión finita que la respalde**. No es
  «llegada a un acceso»: es cercanía medida con confianza suficiente.
- `horaDeEvento(marca, ahora?, relojMonotonico?)`: pasa el `timeStamp` de un
  evento del navegador al reloj epoch de la política. Si la marca es `>= 1e12` la
  toma como epoch (algunas plataformas); si es menor la trata como
  `DOMHighResTimeStamp` relativo y la convierte con el reloj monotónico del mismo
  instante (`performance.now()`): `ahora - (relojMonotonico - marca)`. Devuelve
  `null` si la marca falta, no es finita, es `<= 0`, no hay reloj monotónico para
  convertirla o el resultado supera el margen de adelanto de **2 s**. **No se sustituye por `ahora`**: un evento
  sin fecha verificable no es una captura fresca y cae a cardinal.
- `validarRumbo(lectura, ahora?, edadMaximaMs?, calidadMaximaGrados?)`: un rumbo
  es fiable solo si es numérico en 0..360, de **referencia absoluta**, con
  **calidad conocida y suficiente** (finita, no negativa y ≤ umbral; **sin
  calidad no es fiable**) y **fresco** (hora válida y reciente). Se valida la
  lectura COMPLETA **en el momento de producir la dirección**, no al recibir el
  evento. Con `hora: null` (sin fecha verificable) tampoco es fiable. Si no es
  fiable, quien llama cae a una referencia cardinal/textual con su límite.
- `modoOrientacion(posición, distanciaM, rumbo)`: combina precisión y rumbo.
  Devuelve `relativa` (precisión ≤ umbral Y rumbo fiable), `cardinal-brujula`
  (rumbo no fiable), `cardinal-precision` (precisión desconocida o > umbral) o
  `sin-direccion` (la estación cae dentro del margen de error de la ubicación:
  `distancia ≤ precisión`).

### Umbrales (hipótesis, no seguridad medida)

La política admite un adelanto máximo de **2 s** entre captura y reloj que valida,
para tolerar pequeños desfases. Conserva la hora recibida y rechaza adelantos
mayores. Este margen fijo también se aplica a la posición enviada y al rumbo;
requiere medición física igual que los umbrales de edad y precisión. Las pruebas
cubren el límite de 2.000 ms y el rechazo a partir de 2.001 ms.

| Constante | Valor | Qué decide |
| --- | --- | --- |
| `EDAD_MAXIMA_POSICION_MS` | 60 000 ms | Edad máxima de una posición para reutilizarla o enviarla. |
| `PRECISION_MAXIMA_LLEGADA_M` | 50 m | Radio de confianza del navegador por encima del cual no se afirma proximidad. |
| `DISTANCIA_LLEGADA_M` | 30 m | Distancia al centroide por debajo de la cual hay proximidad (si la precisión acompaña). |
| `EDAD_MAXIMA_RUMBO_MS` | 2 000 ms | Edad máxima de un rumbo para anunciar un giro. |
| `CALIDAD_MAXIMA_RUMBO_GRADOS` | 25° | Cota de error de brújula por encima de la cual el rumbo no se usa para un giro. |

`precision` es el **radio de confianza en metros** que reporta el navegador
(`accuracy`), **no una desviación 1σ** ni una garantía de acceso. Son puntos de
partida: deben ajustarse con medición en dispositivo (en interiores o cañones
urbanos la precisión típica puede ser peor que 50 m).

## Comportamiento por criterio de aceptación

### 1. Conservar posición, precisión y hora; renovar cuando toque

- El GPS y el asistente guardan `LecturaUbicacion`, no una coordenada pelada.
- La vigencia se revalida **en el momento de resolver** (`resolverIntent` usa
  `context.now`; `AuditoryGps` revalida al orientar/repetir/proximidad/Maps): una
  lectura que era fresca al capturar pero envejeció durante una espera ya no se
  usa. No basta que la primera adquisición fuera fresca.
- **Origen explícito prevalece**: una frase con origen no adjunta la ubicación
  (`intencionUsaUbicacion`), y una frase `unknown` tampoco. Un origen explícito
  que no se encuentra **no se reemplaza en silencio por el GPS**: se pide
  aclararlo. Con un solo lugar del catálogo (el destino), `parseIntent` conserva
  el origen dicho aunque no esté en el catálogo, **antes o después del destino**,
  con las formas de `STRONG_ORIGIN`/`WEAK_ORIGIN`: «desde», «saliendo de»,
  «salgo de», «parto de», «estoy en» y «de X a/al/hacia/hasta/para Y» («cómo llego de
  Narnia a Ricaurte», «estoy en Narnia y quiero ir a Ricaurte», «quiero ir a
  Ricaurte desde Narnia», «desde Narnia a la estación Ricaurte»). El origen llega
  hasta la primera palabra que cierra la cláusula (conectores de destino, «y»,
  «quiero»…), con los artículos y «estación de» iniciales quitados. La frase no
  pide ni adjunta ubicación y se responde pidiendo aclarar el origen, antes de
  pedir o adjuntar GPS. Referencias a la ubicación actual («desde aquí para llegar
  a», «desde mi ubicación», «desde donde estoy», «el GPS») siguen usando el GPS.
  La gramática es acotada a frases de rutas, no NLP general; ante un origen
  ambiguo (p. ej. «de noche a Ricaurte») el fallo es seguro: se pide aclarar, no
  se envía la coordenada.
  Si el único lugar catalogado es el origen, el conector de destino conserva
  ambos papeles: «de Ricaurte a Ricaurte» responde que coinciden; «de Ricaurte a
  Narnia» pide aclarar el destino. Ninguna adquiere ni adjunta GPS, incluso con
  una lectura vigente en caché.
- **Origen manual con permiso denegado**: el camino de texto/voz sigue intacto;
  con permiso denegado o vencido la consulta sigue sin coordenada (decisión F/G
  de EA-08, conservada).

### 2. Proximidad segura; separar estación, acceso y orientación

- La proximidad se decide con `decisionLlegada`. El caso de la especificación —
  20 m del centroide con **precisión de 200 m**— devuelve `precision-insuficiente`
  y **nunca** la confirma.
- El punto de la estación es una **referencia aproximada, no un acceso verificado**.
  Cuando el origen inferido por GPS coincide con el destino, el asistente da
  **proximidad estimada con su límite**, nunca «Ya estás en X». Si el origen es
  **explícito** e igual al destino, dice que **coinciden**, sin inventar presencia
  física.
- El aviso de cercanía en el GPS pide **buscar el acceso de la estación** y lo
  llama referencia aproximada. «Oriéntame por voz» da ORIENTACIÓN (hacia dónde
  queda) solo con giro relativo si la precisión y el rumbo son fiables. Con
  precisión desconocida o insuficiente da una referencia **cardinal estimada** con
  su límite, y si la estación cae dentro del margen de error de la ubicación
  (p. ej. 20 m con precisión 200 m) no da dirección: explica el margen y pide una
  lectura más precisa. Los metadatos se conservan hasta producir la indicación
  (orientar y repetir). Para el camino a pie remite a Google Maps como **ruta aproximada con
  accesibilidad no verificada**. No se presenta el rumbo recto como itinerario
  peatonal accesible.

### 3. Rumbo fiable; `alpha` relativo no es el norte; calidad iOS

- Solo un rumbo **absoluto** (brújula de iOS, o `deviceorientation` con
  `absolute === true`), de **calidad conocida y suficiente** y **fresco**
  alimenta un giro. En la práctica, hoy solo `webkitCompassHeading` con
  `webkitCompassAccuracy` cumple: el resto cae a cardinal.
- El `alpha` sin referencia absoluta se marca `relativa` y se descarta. El nombre
  del evento `deviceorientationabsolute` **no basta**: si `absolute === false`, se
  trata como relativo.
- La **calidad** (`webkitCompassAccuracy`) ausente, negativa (p. ej. `-1`,
  calibración desconocida) o peor que el umbral descalifica el giro. Un evento sin dato de
  orientación **invalida el rumbo previo** (no se retiene uno «bueno» viejo).
- La edad del rumbo se cuenta desde la **captura del evento** (`event.timeStamp`
  normalizado con `horaDeEvento`), no desde que el componente lo recibe: un evento
  entregado tarde (capturado hace 10 s) llega vencido y no da giro. Un
  `timeStamp` ausente, inválido, adelantado más de 2 s o sin reloj monotónico para convertirlo
  deja `hora: null` y cae a cardinal.
- El rumbo se valida **al producir la dirección**, no al recibir el evento: un
  rumbo de hace más de 2 s cae a cardinal aunque fuera fiable al llegar. Sin
  rumbo fiable se da una **referencia cardinal** con aviso de orientación
  aproximada. No se inventa calibración.

### 4. Una adquisición por sesión, cancelable, sin fugas

- `AuditoryGps` crea un objeto `Sesion` por activación (su identidad) y lo guarda
  en `sesionRef`; usa `watchPosition` + `clearWatch`. `activate` comprueba que no
  haya sesión **antes** de pedir permisos (doble pulsación no crea un segundo
  watcher). Los callbacks de posición, error y orientación, y el permiso de
  orientación tardío, comprueban que **su** sesión siga viva antes de cualquier
  efecto. La limpieza al desmontar cierra la sesión vigente.
- El GPS solo adopta capturas vigentes. Cada una reemplaza el temporizador de
  vencimiento, calculado desde su hora de captura. Si no llega otra a tiempo,
  retira el marcador y la lista, cierra su sesión, avisa por texto y voz y ofrece
  «Activar mi ubicación» para renovarla. Una actualización, un error o salir de
  la pantalla elimina el temporizador anterior; nunca vence una sesión nueva.
- Un **fallo terminal** (permiso denegado, `code 1`) **cierra solo su sesión**, de
  modo que la persona puede **reintentar** sin acumular sesiones; los callbacks
  viejos de la sesión fallida (éxito, error, orientación o permiso tardío) **no
  tocan** el marcador, la voz ni el watcher de la sesión nueva.
- `TotalAgent.obtenerUbicacion` adquiere con `watchPosition` de **una toma** y
  `clearWatch`, cancelable de verdad: al abortar (salir, cancelar o pregunta
  nueva) o al vencer, libera el watcher. El callback **solo escribe la caché si la
  adquisición sigue viva**; una adquisición cancelada que entrega tarde no
  sobreescribe la posición de otra ni se filtra a una pregunta posterior.
  Además, solo una lectura **vigente** (`ubicacionVigente`) se cachea y resuelve:
  una nueva vencida, adelantada más de 2 s o sin hora no finaliza la adquisición, que espera otra
  vigente o el plazo existente de 2 s/15 s (sin alargarlo) y, si vence, la
  consulta sigue sin coordenada. Se
  conservan las cotas 2 s/15 s, el subtítulo «Esperando permiso», el aviso neutro
  de permiso vencido, la privacidad, el origen manual, `unknown` sin ubicación y
  la voz/navegación de EA-08.

### 5. Metadatos que cruzan la API — política exacta

- **Frontera de envío**: `consultarAgente` aplica `ubicacionVigente` justo antes
  de serializar el cuerpo, con el reloj de ese momento. Ningún llamador puede
  enviar una coordenada vencida, adelantada más de 2 s o sin hora de captura. El
  respaldo local vuelve a revalidar al resolver, con su propio `now`. Tras una
  respuesta HTTP válida se comprueba de nuevo la captura: si venció durante el
  tránsito, se resuelve el respaldo sin usarla. Los rechazos 429/413 se conservan.

- `app/api/agent/route.ts` acepta en `position` los campos opcionales `precision`
  y `hora`. El esquema `zod` valida la posición como un todo: si la posición
  completa está malformada (p. ej. `hora` no finita), `.catch(undefined)` la
  **descarta entera**, de forma conservadora.
- La posición aceptada **conserva precisión y hora** y cruza completa al contexto;
  la vigencia se revalida al **resolver** (tras las esperas de catálogo y Ollama),
  con `now` fijado en ese momento. No se reduce a lat/lng ni se revalida solo al
  parsear.
- Una petición **heredada** con solo `lat`/`lng` (sin `hora`) llega con
  `hora: null`: **no es evidencia fresca**, así que la petición se responde pero
  sin usar la ubicación. No se debilita la validación para retener coordenadas de
  calidad o fecha desconocidas, ni se convierte la falta de metadatos en evidencia
  fresca o precisa.

## Portar a Core Location (cliente iOS nativo futuro)

`lib/ubicacion.ts` es TypeScript y **no se ejecuta en Swift**: lo que es portable
es su POLÍTICA (qué validar y con qué umbrales), que un cliente nativo
re-implementaría alimentándola con datos equivalentes de Core Location:

| Web (`GeolocationPosition`) | Core Location (`CLLocation`) | Campo de `LecturaUbicacion` |
| --- | --- | --- |
| `coords.latitude` / `coords.longitude` | `coordinate.latitude` / `coordinate.longitude` | `lat` / `lng` |
| `coords.accuracy` (m) | `horizontalAccuracy` (m) | `precision` |
| `timestamp` (epoch ms) | `timestamp` (`Date`) | `hora` |

Para el rumbo, `CLHeading` expone `trueHeading`/`magneticHeading` y
`headingAccuracy`; corresponderían a `grados`, `referencia: "absoluta"` (cuando
hay rumbo verdadero/magnético válido) y `calidad`. La idea de validar referencia,
calidad y frescura al producir la dirección se traslada, **no el código**.

`CLLocationManager` NO cancela de forma idéntica a `clearWatch`: su ciclo de vida
(`startUpdatingLocation`/`stopUpdatingLocation`, `requestLocation`, autorización)
es propio. Lo que se conserva como contrato es «una adquisición por sesión» y «no
usar lecturas vencidas», no una equivalencia uno a uno de las APIs.

## Qué se verificó y qué NO

**Verificado en Linux** (comandos con código de salida visible):

- `pnpm exec tsc --noEmit` sin errores.
- `lib/ubicacion.test.ts`: política pura (frescura, margen de reloj de 2 s, hora fuera del margen/NaN/ausente,
  proximidad con precisión, rumbo con calidad conocida y caducidad, modo de
  orientación).
- `lib/ea07-asistente-ubicacion.test.ts`: caminos reales del asistente
  (`runIntent`/`interpretCommand`, respaldo de `consultarAgente` con vencimiento
  por espera, `POST` real con red simulada caída, forma heredada y metadatos
  inválidos).
- `lib/ea07-gps-ubicacion-ui.test.ts`: UI real de `auditory-gps` (TSX/VM) con reloj
  simulado: doble activación, limpieza sin fugas, caducidad visible sin otra
  captura, renovación/cierre del temporizador propio, proximidad segura, rumbo
  vencido/relativo/sin calidad/mala calidad/evento vacío, evento entregado tarde
  con `timeStamp` antiguo (sin giro), fresco, epoch, ausente/inválido/fuera del margen y sin
  reloj monotónico (cardinal), GPS impreciso sin giro
  (orientar y repetir), reintento tras denegación con callbacks viejos de la
  sesión fallida y permiso de orientación tardío.
- `lib/ea08-cancelacion-ui.test.ts`: EA-08 conservado, más adquisición cancelable
  (A cancelada / B vigente: se **entrega de verdad** el callback cancelado de A y
  no corrompe la caché ni habla, navega o consulta), lecturas nuevas vencidas, sin
  hora o fuera del margen que no se cachean ni se envían (espera de una vigente, plazo de
  2 s sin coordenada, cancelar sin recursos colgados) y origen manual antes y
  después del destino sin pedir ni adjuntar ubicación (con y sin caché, con el
  respaldo, y con una referencia actual que sí adquiere).
- `lib/ea07-asistente-ubicacion.test.ts` incluye además la frontera de envío de
  `consultarAgente` (vencida/sin hora/fuera del margen no viajan, fresca sí), la
  respuesta HTTP que vence en tránsito sin ocultar 429/413, y el `POST` real con
  origen manual antes y después del destino.
- `lib/local-agent.test.ts`: `parseIntent`/`interpretCommand` con origen
  desconocido (con «de», «estoy en» y después del destino), referencias a la ubicación actual y texto de proximidad sin
  promesa de ruta peatonal; origen conocido con destino repetido o desconocido,
  también cubiertos por la UI sin adquirir ni adjuntar GPS.

**NO verificado** (requiere dispositivo y queda pendiente):

- Precisión y frescura reales del GPS de un iPhone, dentro y fuera de estaciones.
- Brújula (`webkitCompassHeading`/`webkitCompassAccuracy`) y su calibración.
- Experiencia con VoiceOver. Los umbrales (30/50 m, 60 s, 2 s, 25°) **no** están
  medidos físicamente; son hipótesis para calibrar con datos reales.
