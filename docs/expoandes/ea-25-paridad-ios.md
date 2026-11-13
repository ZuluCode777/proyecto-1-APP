# EA-25 · Paridad iPhone: rutas, detalle, viaje y mapa

Issue [#51](https://github.com/ZuluCode777/proyecto-1-APP/issues/51), parte de #26. Este documento registra qué flujos de la web tiene ya el iPhone, cuáles no y por qué, y qué falta probar en un iPhone real. **No afirma una migración total**: el criterio final de #51 exige verificar con VoiceOver, contraste y una mano en un dispositivo, y eso sigue pendiente.

Alcance de esta entrega (rama `feat/ea25-rutas-mapas-ios`): buscador y detalle de rutas, selección estructurada de origen y destino, y el mapa y el listado del mismo tramo. La lupa (#86) y Ajustes, Favoritas y Ayuda (#80) ya estaban fusionadas y no se rehicieron; sus diferencias con la web siguen en [ios/README.md](../../ios/README.md).

**Segunda entrega (rama `feat/contratos-paridad-iphone`, refs #51 y #50): solo backend.** Tres contratos nuevos de `POST /api/planificador` para que la app de iPhone alcance la paridad con la web sin reimplementar reglas: [alternativas del viaje, Metro de la Línea 1 y estaciones cercanas](#contratos-de-paridad-con-la-web-alternativas-metro-y-estaciones-cercanas). **No hay pantalla Swift nueva** ni se tocó `ios/`: las pantallas las construyen los agentes de iPhone sobre estos contratos.

Todo lo escrito aquí es **software**: las pruebas de TypeScript corrieron en el equipo donde se escribió; el código Swift **no se compiló ni se ejecutó donde se escribió** (sin Xcode), así que la primera compilación y las pruebas Swift son las del flujo `iOS` de GitHub sobre el PR. Los datos de las pruebas de interfaz son inventados y rotulados «[SIMULADO]».

## Qué hace el iPhone ahora

- **Entrada.** Un botón con icono de mapa en la barra de Consulta («Rutas y viaje») abre la búsqueda. No hay pestaña nueva. Una respuesta de ruta en Consulta ofrece «Ver la ruta … y su mapa»; una respuesta de estación ofrece «Ver las rutas que pasan por la estación».
- **Buscar rutas.** Código de ruta o nombre de estación; el servidor ejecuta el mismo `searchRoutes` que la web. Resultados con código, origen y destino, el total si se recortó a 50, la procedencia del catálogo y, si es antiguo, el aviso con «Volver a consultar».
- **Detalle de una ruta.** Sentido (solo se afirma si una fuente vigente lo confirma), calendario de hoy, horario publicado, estaciones cercanas al trazado con «Parada verificada» solo donde el validador del servidor la acepta, mapa del mismo recorrido y «Guardar»/«Quitar» en las favoritas del iPhone (las de Ajustes ▸ Favoritas).
- **Viaje entre dos lugares.** Origen y destino se eligen de la lista de lugares que entrega el servidor y viajan como **datos** al planificador; nunca se arma una frase. El servidor decide el estado y la pantalla lo dice: operativo (tramos con abordaje y descenso, y el mapa de los mismos tramos), candidato sin operación confirmada (**solo los códigos de las rutas**, sin paradas, sin conteo y sin mapa), solo recorrido (rutas que pasan cerca de los dos lugares), sin recorrido o mismo lugar.
- **Sin ubicación.** No se pide ningún permiso nuevo; el origen se elige de la lista.

## Contrato `POST /api/planificador` (cambio de backend)

El backend es el único dueño de estaciones y planificación. Hasta ahora ningún endpoint aceptaba origen y destino como datos (`/api/agent` solo recibe una frase y `/api/transmilenio` entrega el catálogo entero (unos 230 KB en la copia guardada) y obligaría a copiar a Swift las reglas de evidencia (`sentidoConfirmado`, `paradasPrescriptibles`, calendario), que no deben duplicarse). Se añadió el contrato mínimo:

| Operación (`operacion`) | Petición | Respuesta 200 |
| --- | --- | --- |
| `buscar-rutas` | `consulta` (1–80) | `rutas[]` (`codigo`, `desde`, `hacia`; hasta 50), `total`, `catalogo` |
| `detalle-ruta` | `codigo` (1–12), sin distinguir mayúsculas ni espacios | `codigo`, `etiqueta`, `desde`, `hacia`, `sentido`, `calendario`, `horario`, `estaciones[]` (`nombre`, `coordenada` o `null`, `paradaVerificada`), `trazado[]`, `catalogo` |
| `listar-lugares` | nada más | `lugares[]` (nombres únicos, ordenados), `catalogo` |
| `planear-viaje` | `origen` y `destino` (1–80), nombres exactos de `listar-lugares` | `origen`, `destino`, `resultado`, `tramos[]` (hasta 2; completos solo si `operativo`, y solo `{codigoRuta}` si `candidato`), `rutasPorElTrazado[]`, `catalogo`, y **opcional** `alternativas[]` (hasta 2 `{codigoRuta}`, solo en un `operativo` directo; ver [abajo](#1-alternativas-del-viaje-planear-viaje)) |
| `metro-linea-1` | nada más | `linea`, `textoEstado`, `mapa` (rótulo, aviso, atribución, trazado), `estaciones[]` (16, con su huella), `linea2`, `corte`, `atribucion`, `fuentes[]`; ver [abajo](#2-metro-línea-1-metro-linea-1) |
| `estaciones-cercanas` | `lat` y `lng` (rangos válidos); opcionales `precision`, `edadMs`, `rumbo` | `resultado` (`cercanas` o `ubicacion-vencida`), `estaciones[]` (hasta 4: nombre, coordenada, distancia, orientación), `catalogo`; ver [abajo](#3-estaciones-cercanas-estaciones-cercanas) |

- Valida con Zod (`strictObject`: un campo de más o una frase en lugar de datos da 400; también una operación desconocida). Cuerpo de hasta 1.000 bytes, comprobado en el manejador **después** de que el `proxy` lo almacene entero (Next lo carga antes de llamar al manejador; ver [EA-10](ea-10-recursos-autenticacion.md)): la cota limita lo que se procesa, no lo que se recibe. 404 `{"error":"no-encontrado"}` para una ruta o lugar que no existe; un nombre que no es exactamente un lugar (por ejemplo «de Ricaurte a Calle 72») no se interpreta: es 404.
- Usa las funciones de la web: `searchRoutes`, `planTrip`, `planTripCandidato`, `routesAlongBoth`, `paradasPrescriptibles`, `sentidoConfirmado`, `estadoCalendarioEnFecha`. Solo se añadieron `listarLugares` y `lugarPorNombre` en `lib/routes.ts`.
- Solo entrega las coordenadas que el catálogo tiene; si falta una, el campo es `null` y la app no dibuja ni sustituye ese punto.
- Pasa por el `proxy` (HTTP Basic), como `/api/transmilenio`; una prueba comprueba que `/api/planificador` sigue protegido.
- **Límite de peticiones propio**, con dos cubos que no comparten cuota con `/api/agent`: `planear-viaje` 30 por minuto y las otras cinco operaciones (`buscar-rutas`, `detalle-ruta`, `listar-lugares`, `metro-linea-1` y `estaciones-cercanas`) 60 por minuto **entre todas**, con 429 y `Retry-After`. Planear recorre pares de rutas y cuesta unos 60 ms de CPU síncrona (45,6 de promedio y 70,3 de pico medidos en la revisión del PR), que bloquean el bucle de eventos compartido con `/api/agent` y la web; 30 por minuto son unos 1,8 s de CPU por minuto (~3 % del bucle). Las otras operaciones cuestan menos de 1 ms (`estaciones-cercanas` ordena unas 150 estaciones; `metro-linea-1` devuelve un cuerpo ya armado). `claveCliente()` es hoy una sola clave para todos, así que son **techos globales**, no por persona.
- Las respuestas tienen cotas en el esquema (`rutas` 50, `estaciones` 200, `trazado` 1.000 puntos, `lugares` 500) que el cliente hace cumplir; una prueba las compara con las constantes de `RespuestaPlanificador.swift` y comprueba que cada ruta del catálogo cabe.
- Contrato en `lib/contrato-planificador.ts`, manejador en `app/api/planificador/route.ts`, pruebas en `lib/ea25-planificador.test.ts`. Una prueba lee los fixtures de `ios/TransMiVozTests/FixturesPlanificador.swift` y comprueba que cumplen los esquemas, y otra compara las cotas de `EntradaPlanificador.swift` con las del servidor.
- **Render necesita un despliegue manual** para que el endpoint exista. Hasta entonces el iPhone recibe un 404 sin el cuerpo del planificador y lo muestra como falla del servidor (código 404), no como «no encontrado». Con la segunda entrega, un servidor sin desplegar contesta **400 `peticion-invalida`** a `metro-linea-1` y `estaciones-cercanas` (operación desconocida) y no manda `alternativas`.

## Contratos de paridad con la web: alternativas, Metro y estaciones cercanas

Regla de [ios/README.md](../../ios/README.md): las reglas de transporte viven en el backend (`lib/`); el iPhone llama contratos HTTP y no reimplementa nada. Los tres contratos comparten autenticación (HTTP Basic por el `proxy`), cota de cuerpo (1.000 bytes) y cubos de límite con las operaciones anteriores. Las pruebas están en `lib/ea25-paridad.test.ts`.

**Errores, para las tres.** Una petición inválida (JSON roto, campo de más, coordenada fuera de rango, operación desconocida) responde **400** `{"error":"peticion-invalida"}` sin repetir lo recibido; un cuerpo de más de 1.000 bytes, **413**; el límite, **429** con `Retry-After`; sin clave, **401** del `proxy`. **No hay 404 nuevo**: `metro-linea-1` y `estaciones-cercanas` no buscan una entidad por nombre; sin estaciones en el catálogo, `estaciones-cercanas` responde 200 con la lista vacía, como la pantalla de la web. El 404 `{"error":"no-encontrado"}` de `planear-viaje` no cambia.

### 1. Alternativas del viaje (`planear-viaje`)

La web dice «También te sirven B23 y H54» cuando el mejor plan es una ruta directa y hay otras directas (`runIntent` en `lib/local-agent.ts`). Esa decisión es ahora `alternativasDelViaje` (`lib/routes.ts`) y la usan la web y el contrato; ambos piden `MAX_PLANES_VIAJE` (3) planes: el primero es el viaje y los demás, las alternativas, de menos a más estaciones.

| Campo | Qué es |
| --- | --- |
| `alternativas` | **Opcional.** Solo en `resultado: "operativo"` con un solo tramo, y solo si hay otras rutas directas. De 1 a 2 elementos `{"codigoRuta": "H54"}`. **Ausente** (no una lista vacía) con un transbordo, con una sola ruta, y en cualquier otro estado, incluido `candidato` (la web tampoco da alternativas ahí) |

- **Solo el código, sin paradas.** La otra ruta puede abordarse en otra estación del mismo lugar y su parada no se garantiza en el contrato; la web tampoco la dice. Un cliente que muestre una alternativa dice «También te sirven la H54», sin «sube en…».
- **Compatible con la app ya instalada en los teléfonos de la feria.** No se renombró, quitó ni cambió ningún campo ni estado. La respuesta de hoy es idéntica cuando no hay alternativas (la clave no se envía); cuando las hay, solo se suma la clave `alternativas`, que el decodificador Swift actual (`RespuestaPlanificador.swift`: `Decodable` con las claves que conoce, sin `allKeys` ni rechazo de claves desconocidas) ignora. Una prueba comprueba ambas cosas.
- El mejor plan no cambia por pedir tres planes en lugar de uno (misma ordenación y mismo costo de CPU: `buscarPlanes` ya calculaba todos antes de recortar).

```json
{ "origen": "Alfa", "destino": "Eco", "resultado": "operativo",
  "tramos": [ { "codigoRuta": "X1", "abordaje": {…}, "descenso": {…}, "estacionesRecorridas": 2, "conteoVerificado": true, "trazado": […] } ],
  "rutasPorElTrazado": [],
  "alternativas": [ { "codigoRuta": "V1" }, { "codigoRuta": "V2" } ],
  "catalogo": { "procedencia": "…", "antiguo": false } }
```

### 2. Metro, Línea 1 (`metro-linea-1`)

Petición: `{"operacion":"metro-linea-1"}`. Devuelve lo que muestran la pantalla «Metro de Bogotá» de la web (`components/metro-list.tsx`) y su capa del mapa (EA-24). Es el catálogo **educativo de un proyecto futuro, sin servicio** (EA-13): no usa rutas, GPS ni planificador de TransMilenio, no lleva `catalogo` de TransMilenio, no depende de la hora y el manejador ni carga el catálogo de TransMilenio. Pesa unos 31 KB y solo cambia con un despliegue: conviene pedirlo una vez por sesión.

| Campo | Contenido (todo el texto es el de la web, tal cual) |
| --- | --- |
| `linea` | `nombre` («Línea 1»), `subtitulo` («Línea 1 · en construcción · sin servicio»), `estado` («en construcción y sin servicio comercial»), `horizonte` (la previsión de marzo de 2028, «es una previsión»), `servicioComercial` (siempre `false`) |
| `textoEstado` | La nota de estado de la pantalla, que la web también dice en voz al entrar: estado, límites («solo consulta: no planeo viajes en Metro…»), aviso del mapa y «Datos al 2 de noviembre de 2026.» |
| `mapa` | `rotulo`, `aviso`, `atribucion` (completa, con licencia, fechas y cambios), `atribucionCorta`, `entidad`, `publicador`, `licencia`, `licenciaUrl`, `fechaDato` y `consultado` (ISO), `cambios[]`, `trazado[]` (157 puntos `{lat, lng}`, simplificado a 1 m) |
| `estaciones[]` | Exactamente 16, de E01 a E16: `numero`, `id`, `nombre` (`null` en E07), `nombreMostrado` («nombre pendiente» en E07), `nombreEstado`, `corredor`, los párrafos de la ficha (`descripcionNombre`, `nombreTecnico`, `conexion`, `avisoUbicacion`, `enElMapa`), `etiquetaHuella` (lo que dice la huella al tocarla), `fuentes[]` (ids de `fuentes`) y `huella[]` (anillo cerrado de `{lat, lng}`) |
| `linea2` | `titulo` y `texto`: una ficha de contexto, sin estaciones ni geometría |
| `corte`, `atribucion`, `fuentes[]` | Fecha de corte (ISO y hablada), atribución de identificadores y nombres técnicos, y cada fuente con `id`, `entidad`, `titulo`, `fecha`, `url` y `texto` (la línea que muestra la web) |

Cotas del esquema (`lib/contrato-metro.ts`): trazado ≤ 500 puntos, huella 4–100, texto ≤ 1.500 caracteres, 16 estaciones exactas. El esquema es `strictObject` en todos los niveles.

**Reglas de EA-24 que el contrato conserva y una prueba hace cumplir** (los clientes deben respetarlas al dibujar):

- Una huella es un **polígono ilustrativo** del diseño de 2022. **No hay punto por estación**: ni centroide, ni `lat`/`lng` aparte de la `huella`. Dibujar un marcador en el centro de una huella sería presentarla como entrada o parada; no se hace.
- **No hay accesos peatonales** (sin licencia acreditada) ni geometría de la Línea 2. Una huella «no es una entrada ni indica transbordos»; `conexion` termina siempre en «Hoy no hay transbordos habilitados.».
- El **rótulo** (`mapa.rotulo`), el **aviso** y la **atribución completa** con licencia CC BY 4.0, fecha del dato (18-04-2022) y consulta (12-11-2026) se ven **junto al mapa**; la corta va en el control de atribución del mapa. El rótulo no se tapa con otros controles.
- El trazado se dibuja punteado y fino, **distinto de una ruta en servicio**, y al tocarlo repite el rótulo. Cada huella dice, al tocarla, su `etiquetaHuella`. El listado de 16 estaciones es completo y **no depende del mapa**.
- **El Metro no se dibuja** en los mapas de ruta, de viaje ni del GPS, y `estaciones-cercanas` nunca lo devuelve.
- Los datos viajan en `{lat, lng}`; la fuente guarda `[longitud, latitud]` y la conversión está en un solo lugar (`lib/contrato-metro.ts`). Una prueba comprueba que ningún punto salga con los ejes invertidos.
- Una prueba compara este contrato con lo que dibuja `MetroList` (encabezado, nota, rótulo, etiquetas de huella, cada párrafo de cada ficha, la Línea 2 y las fuentes): si la web cambia un texto sin el contrato, falla.

Forma (recortada):

```json
{ "linea": { "nombre": "Línea 1", "subtitulo": "Línea 1 · en construcción · sin servicio", "estado": "en construcción y sin servicio comercial", "horizonte": "…", "servicioComercial": false },
  "textoEstado": "Metro de Bogotá, Línea 1: en construcción y sin servicio comercial. … Datos al 2 de noviembre de 2026.",
  "mapa": { "rotulo": "Metro Línea 1 · proyecto futuro, sin servicio", "aviso": "…", "atribucion": "Trazado y huellas de estación: Empresa Metro de Bogotá S.A. (EMB), Datos Abiertos Bogotá / IDECA, licencia CC BY 4.0. Dato del 18-04-2022, consultado el 12-11-2026. Cambios: …",
            "atribucionCorta": "Metro: EMB, CC BY 4.0, dato de 2022, trazado simplificado", "entidad": "…", "publicador": "…", "licencia": "CC BY 4.0", "licenciaUrl": "https://creativecommons.org/licenses/by/4.0/",
            "fechaDato": "2022-04-18", "consultado": "2026-11-12", "cambios": ["…"], "trazado": [ { "lat": 4.647533, "lng": -74.193585 }, … ] },
  "estaciones": [ { "numero": 1, "id": "E01", "nombre": "Gibraltar", "nombreMostrado": "Gibraltar", "nombreEstado": "anunciado", "corredor": "Villavicencio; carreras 94–93",
                    "descripcionNombre": "…", "nombreTecnico": "…", "conexion": "…", "avisoUbicacion": "…", "enElMapa": "En el mapa: huella ilustrativa del proyecto; no es una entrada.",
                    "etiquetaHuella": "E01 · Gibraltar: huella ilustrativa del proyecto; no es una entrada", "fuentes": ["F5", "F10", "F6"],
                    "huella": [ { "lat": 4.641122, "lng": -74.177869 }, … ] }, … ],
  "linea2": { "titulo": "Línea 2 · en contratación · 11 estaciones proyectadas", "texto": "…" },
  "corte": { "fecha": "2026-11-02", "hablada": "2 de noviembre de 2026" },
  "atribucion": "…", "fuentes": [ { "id": "F1", "entidad": "…", "titulo": "…", "fecha": "…", "url": "https://…", "texto": "F1 · …" }, … ] }
```

### 3. Estaciones cercanas (`estaciones-cercanas`)

Lo que da `AuditoryGps` (`components/auditory-gps.tsx`): las 4 estaciones de TransMilenio más cercanas a una coordenada, con distancia y orientación. El orden y las distancias son los de `nearestStations`; la distancia hablada, la de `spokenDistance`; y la dirección y su frase, las de `orientarHacia` y `cardinalHacia` (`lib/ubicacion.ts`), que antes vivían dentro del componente y ahora usan la web y el contrato (la web quedó con el mismo comportamiento: pasa por sus pruebas de EA-07).

**Petición** (`strictObject`; el cuerpo más grande posible pesa unos 200 bytes):

| Campo | Tipo y rango | Obligatorio | Significado |
| --- | --- | --- | --- |
| `lat` | número, −90 a 90 | Sí | Latitud |
| `lng` | número, −180 a 180 | Sí | Longitud |
| `precision` | número, 0 a 100.000 | No | Radio de precisión en metros (`horizontalAccuracy` de CoreLocation; omitir si es negativo). Sin él, o con más de 50 m, solo se da referencia cardinal y **nunca un giro**; si la estación cae dentro del margen, ninguna dirección |
| `edadMs` | entero, 0 a 600.000 | No | Milisegundos desde que se capturó la lectura. Más de 60.000 (`EDAD_MAXIMA_POSICION_MS`): `ubicacion-vencida`. Ausente: recién capturada |
| `rumbo` | objeto | No | Brújula respecto al norte, para el giro relativo. Sin él nunca hay giro. `grados` (número 0–360, obligatorio), `calidad` (número −1 a 360, cota de error en grados: `headingAccuracy`; omitir o negativa = no fiable; más de 25° tampoco), `edadMs` (entero 0–600.000, obligatorio; más de 2.000 = vencido) |

Recomendación para la app: `trueHeading` de `CLHeading` si es válido (no negativo), porque la dirección hacia la estación es geográfica; si no lo es, no mandar `rumbo`. La referencia es siempre «respecto al norte»: el contrato no admite un rumbo relativo (en la web el `alpha` relativo se descarta).

**Respuesta 200:**

| Campo | Contenido |
| --- | --- |
| `resultado` | `cercanas`, o `ubicacion-vencida` (lectura de más de 60 s; `estaciones` vacío; la app dice su propio texto, no hay uno en el contrato) |
| `estaciones[]` | Hasta 4, de más cerca a más lejos. Cada una: `nombre`, `coordenada` (`lat`, `lng` de la estación, para el mapa), `distanciaMetros` (entero), `distanciaHablada` («90 metros», «1,2 kilómetros»; la que dice la web) y `orientacion` |
| `orientacion` | `modo`, `cardinal`, `relativa`, `indicacion` |
| `catalogo` | `procedencia` y `antiguo`, como en las demás operaciones |

| `orientacion.modo` | Cuándo | `cardinal` | `relativa` |
| --- | --- | --- | --- |
| `relativa` | `precision` ≤ 50 m, estación fuera del margen de error y `rumbo` fiable (absoluto, `calidad` entre 0 y 25°, medido hace ≤ 2 s) | «al noreste» | «a tu derecha», «de frente»… |
| `cardinal-brujula` | Precisión suficiente pero sin rumbo fiable | «al noreste» | `null` |
| `cardinal-precision` | Sin `precision` o de más de 50 m | «al noreste» | `null` |
| `sin-direccion` | La estación está dentro del margen de error (`distancia ≤ precision`) | `null` | `null` |

`indicacion` es la frase que la web dice con «Oriéntame por voz»; `cardinal` es el texto de la fila de la lista. La app los muestra y los dice, y **no calcula distancia, rumbo ni giro**. Con `cardinal: null` la fila solo lleva la distancia, igual que la web.

```json
POST /api/planificador
{"operacion":"estaciones-cercanas","lat":4.6124,"lng":-74.0935,"precision":12,"edadMs":800,"rumbo":{"grados":90,"calidad":10,"edadMs":300}}

200
{ "resultado": "cercanas",
  "estaciones": [
    { "nombre": "Ricaurte - NQS", "coordenada": { "lat": 4.611683784449027, "lng": -74.09386594942337 }, "distanciaMetros": 89, "distanciaHablada": "90 metros",
      "orientacion": { "modo": "relativa", "cardinal": "al suroeste", "relativa": "hacia atrás a tu derecha", "indicacion": "Ricaurte - NQS está a 90 metros hacia atrás a tu derecha." } },
    { "nombre": "Ricaurte - CL 13", "coordenada": { "lat": 4.612680959785939, "lng": -74.09009249415548 }, "distanciaMetros": 379, "distanciaHablada": "380 metros",
      "orientacion": { "modo": "relativa", "cardinal": "al este", "relativa": "de frente", "indicacion": "Ricaurte - CL 13 está a 380 metros de frente." } } ],
  "catalogo": { "procedencia": "Datos de una copia guardada de TransMilenio del 24/9/2026 (sin conexión al servicio en vivo).", "antiguo": true } }
```

(Respuesta recortada a 2 de 4 estaciones.)

**Privacidad.** La coordenada, la precisión y el rumbo viajan en el **cuerpo** del POST, nunca en la URL (los registros de acceso de una plataforma suelen guardar la URL). El manejador y el contrato **no escriben ningún registro** (una prueba lo comprueba en el código y con la salida real), **no guardan nada** (sin base de datos, sin caché de peticiones, sin la coordenada en la clave del límite: `claveCliente()` es una sola clave global) y **no envían la coordenada a ningún otro servicio**. La respuesta **no repite** la coordenada, la precisión ni el rumbo; devuelve solo coordenadas de estaciones, que son del catálogo, y las distancias y direcciones que la respuesta necesita. Lo que este código no controla: los registros de Render o de la red delante del servidor, y el hecho de que cuatro distancias a estaciones conocidas bastarían, a quien las vea, para estimar la posición; la respuesta solo vuelve a quien la pidió.

**Uso desde la app.** Pedirlo a demanda (al activar la ubicación, al «Repetir indicación», al renovar), **no en cada actualización de CoreLocation**: las otras cinco operaciones comparten 60 peticiones por minuto en todo el servidor.

**Qué no está en este contrato** (diferencias con el GPS de la web): el aviso de proximidad («Estás muy cerca de…», `decisionLlegada`: menos de 30 m con precisión de 50 m o menos) y su seguimiento de un destino elegido; el enlace a Google Maps; el texto de «ubicación vencida» y los de permisos; y el mapa con «Tú estás aquí». Ver las preguntas abiertas en el PR.

## Paridad con la web

| Flujo de la web | iPhone | Estado |
| --- | --- | --- |
| Buscar por estación o ruta (`PartialRoutes`, `searchRoutes`) | Búsqueda de rutas, mismo `searchRoutes` en el servidor | Cubierto en software |
| Buscar hablando | No; la voz de Consulta es otra tarea (#45) | Diferencia |
| Lista de rutas con procedencia (`RouteList`) | Resultados con procedencia, total y aviso de datos antiguos | Cubierto; la web además dice la procedencia en voz |
| Detalle de una ruta (`RouteDetail`) | Sentido, calendario, horario, estaciones, paradas verificadas, mapa y Guardar | Cubierto; sin «Escuchar» ni lectura en voz propia (VoiceOver) |
| Estado que se renueva | El detalle se consulta al abrirlo y con «Volver a consultar»; la web renueva cada 30 s | Diferencia |
| Plan de viaje (`TripView`) desde una frase del asistente | Selección estructurada de dos lugares; el servidor planea | Distinto a propósito (criterio de #51) |
| «Sube en» y «Bájate en» (viaje operativo) | El iPhone nombra «Abordaje» y «Descenso» como datos, sin imperativo, y no revalida en el dispositivo (la web revalida cada 30 s) | Diferencia |
| Servicio candidato, sin operación confirmada (`tripCandidatoReply`) | Igual que la web: solo los códigos de las rutas con el origen y el destino elegidos y «no se dan indicaciones de abordaje». **Sin paradas, sin conteo, sin transbordo y sin mapa**; el servidor ni siquiera los envía | Cubierto |
| Alternativas del viaje («También te sirven…») | **Contrato listo** (`alternativas`, solo códigos); la pantalla no las muestra todavía | Pendiente en Swift |
| Origen por GPS | No hay ubicación en el iPhone | Diferencia |
| GPS auditivo: estaciones cercanas con distancia y dirección (`AuditoryGps`) | **Contrato listo** (`estaciones-cercanas`); sin pantalla, sin CoreLocation y sin brújula en la app | Pendiente en Swift; la ubicación pide permiso, privacidad y prueba en iPhone |
| Mapa (`TransitMap`, Leaflet y OpenStreetMap) | MapKit; trazado del tramo entre abordaje y descenso, marcas con los nombres del listado; sin ubicación de la persona | Cubierto en código; **mapa sin verificar en Simulator ni iPhone** |
| Pantalla «Metro de Bogotá» y capa del Metro futuro (`MetroList`, #85, `lib/metro-cartografia.ts`) | **Contrato listo** (`metro-linea-1`: 16 estaciones, huellas, trazado, atribución y licencia). La pantalla y el mapa siguen sin existir; la licencia y las coordenadas están verificadas en EA-24, pero **el dibujo en MapKit no** | Pendiente en Swift |
| Rutas frecuentes (lista de la web) | Ajustes ▸ Favoritas (#80); sus filas **no** abren el detalle | Diferencia |
| Respuesta del asistente `route` y `search` | Enlaces al detalle y a la lista de rutas de la estación | Cubierto |
| Respuesta `trip` del asistente | Sigue sin órdenes de abordaje (EA-17): tramos como información | Sin cambios |
| Lupa, Ajustes, Favoritas, Ayuda | Fusionados en #86 y #80 | No se tocó; ver `ios/README.md` |

## Criterios de #51

| Criterio | Estado |
| --- | --- |
| Buscador, detalle y selección estructurada consumen el planificador compartido por un contrato validado; mapa y listado reflejan el mismo tramo; sin frase ni planificación en Swift | **Cubierto en software.** Backend: 30 pruebas nuevas, `tsc`, `pnpm test` y `pnpm build` en verde. Swift: pruebas escritas (decodificación estricta, cliente HTTP simulado, modelos, mapa y listado del mismo tramo) y **sin ejecutar donde se escribieron**; las ejecuta la CI del PR |
| Cámara nativa, zoom, filtros, congelado y liberación de recursos | Ya cubierto por #86 en software; **pendiente en iPhone** |
| Favoritas, preferencias y ayuda con estados vacíos y errores | #80 en software; ahora «Guardar» y «Quitar» desde el detalle y el texto de Favoritas vacía actualizado; **pendiente revisar en iPhone** |
| La lupa no promete OCR ni detección | Sin cambios (#86) |
| VoiceOver, contraste y una mano en un iPhone real, sin depender del mapa ni del color | **Pendiente** (pruebas del viernes). La interfaz está escrita para ello (la lista lleva todo, el mapa es una pieza con etiqueta, el estado no va solo en color) pero no se probó |
| Registrar paridad completa y diferencias | Este documento. **No se afirma migración total** hasta cerrar el punto anterior |

## Cómo se evita depender del mapa o del color

- Todo dato del mapa está en el listado de la misma pantalla, que se lee primero: estaciones numeradas, «Parada verificada» en texto, tramos con su ruta, abordaje y descenso. Una estación sin coordenada se lista y no se dibuja.
- Para VoiceOver el mapa es **una sola pieza** con etiqueta («Es una ayuda visual: el listado tiene la misma información»); sus marcas y calles no se recorren.
- El trazado de cada tramo se distingue por el número del tramo en el listado, no por el color o el ancho de la línea.
- Sin conexión MapKit no baja las calles: queda el trazado sobre un fondo vacío y una nota lo dice.
- En las pruebas de interfaz el mapa **no se dibuja** (`-PRUEBAS_UI_SIMULADAS`): la pantalla lo rotula («Modo de pruebas: el mapa no se dibuja; el listado tiene lo mismo»). Se decidió así porque el contenido de MapKit no se puede auditar de forma determinista en un Simulator sin red y no se quiso diferir contraste (`LibroContrasteDiferido`) para algo que no se ve. **MapKit queda sin verificar** hasta abrirlo a mano en el Simulator o en el iPhone.

## Qué falta

- Ejecución de la CI `iOS` sobre el PR (compilación, pruebas Swift y de interfaz).
- iPhone real: VoiceOver con búsqueda, detalle, selector de lugares y resultado del viaje; contraste y Dynamic Type; uso con una mano; mapa con y sin conexión.
- Despliegue manual de Render para que exista `/api/planificador` y, con la segunda entrega, `metro-linea-1`, `estaciones-cercanas` y `alternativas`.
- Pantallas Swift sobre los tres contratos nuevos: alternativas del viaje, «Metro de Bogotá» con su capa en MapKit (verificar rótulo, atribución y que la huella no se lea como entrada) y estaciones cercanas con CoreLocation y brújula (permiso, aviso previo y prueba en un iPhone).
- Abrir el detalle desde las filas de Favoritas, si se decide que cuenta para la paridad.
- Auditorías de accesibilidad con el texto más grande (`AccessibilityXXXL`) para las pantallas nuevas: hoy solo se comprueba que lo esencial se alcanza entero y tocable al desplazar, como en Ajustes. La auditoría completa de tamaño normal cubre la búsqueda con resultados y la selección del viaje; el detalle y el resultado del viaje no se auditan porque se espera que midan más que el área visible (no se midió).
- Deuda conocida de código (revisión 1, no corregida): la fila de resultado de búsqueda y la de rutas por el trazado repiten el mismo `NavigationLink`; las pantallas repiten el `switch` sobre `EstadoCarga`; algunos textos de las vistas (títulos de sección, etiquetas de enlaces de Consulta) no están en `TextoRutas`; el alcance real del botón de la barra de Consulta con una mano y con VoiceOver es una comprobación de dispositivo pendiente.
- Deuda conocida de código (revisión 2, no corregida): `PlanViaje` guarda `tramos`, `codigosCandidatos` y `rutasPorElTrazado` como arreglos paralelos (un `enum` con valores asociados lo expresaría mejor); el `switch` de anuncio y foco sobre `EstadoCarga` está copiado cuatro veces; la prueba de interfaz del detalle copia el cálculo de `contenido`, `arriba` y `abajo` de `exponer`. Los códigos de un servicio candidato no dicen si son tramos consecutivos o alternativas, igual que en la web: decir «transbordo» sería una indicación de abordaje.
