# EA-25 · Paridad iPhone: rutas, detalle, viaje y mapa

Issue [#51](https://github.com/ZuluCode777/proyecto-1-APP/issues/51), parte de #26. Este documento registra qué flujos de la web tiene ya el iPhone, cuáles no y por qué, y qué falta probar en un iPhone real. **No afirma una migración total**: el criterio final de #51 exige verificar con VoiceOver, contraste y una mano en un dispositivo, y eso sigue pendiente.

Alcance de esta entrega (rama `feat/ea25-rutas-mapas-ios`): buscador y detalle de rutas, selección estructurada de origen y destino, y el mapa y el listado del mismo tramo. La lupa (#86) y Ajustes, Favoritas y Ayuda (#80) ya estaban fusionadas y no se rehicieron; sus diferencias con la web siguen en [ios/README.md](../../ios/README.md).

Todo lo escrito aquí es **software**: las pruebas de TypeScript corrieron en el equipo donde se escribió; el código Swift **no se compiló ni se ejecutó donde se escribió** (sin Xcode), así que la primera compilación y las pruebas Swift son las del flujo `iOS` de GitHub sobre el PR. Los datos de las pruebas de interfaz son inventados y rotulados «[SIMULADO]».

## Qué hace el iPhone ahora

- **Entrada.** Un botón con icono de mapa en la barra de Consulta («Rutas y viaje») abre la búsqueda. No hay pestaña nueva. Una respuesta de ruta en Consulta ofrece «Ver la ruta … y su mapa»; una respuesta de estación ofrece «Ver las rutas que pasan por la estación».
- **Buscar rutas.** Código de ruta o nombre de estación; el servidor ejecuta el mismo `searchRoutes` que la web. Resultados con código, origen y destino, el total si se recortó a 50, la procedencia del catálogo y, si es antiguo, el aviso con «Volver a consultar».
- **Detalle de una ruta.** Sentido (solo se afirma si una fuente vigente lo confirma), calendario de hoy, horario publicado, estaciones cercanas al trazado con «Parada verificada» solo donde el validador del servidor la acepta, mapa del mismo recorrido y «Guardar»/«Quitar» en las favoritas del iPhone (las de Ajustes ▸ Favoritas).
- **Viaje entre dos lugares.** Origen y destino se eligen de la lista de lugares que entrega el servidor y viajan como **datos** al planificador; nunca se arma una frase. El servidor decide el estado y la pantalla lo dice: operativo, candidato sin operación confirmada, solo recorrido (rutas que pasan cerca de los dos lugares), sin recorrido o mismo lugar. Cada tramo se lista y el mapa dibuja los mismos tramos.
- **Sin ubicación.** No se pide ningún permiso nuevo; el origen se elige de la lista.

## Contrato `POST /api/planificador` (cambio de backend)

El backend es el único dueño de estaciones y planificación. Hasta ahora ningún endpoint aceptaba origen y destino como datos (`/api/agent` solo recibe una frase y `/api/transmilenio` entrega el catálogo entero (unos 230 KB en la copia guardada) y obligaría a copiar a Swift las reglas de evidencia (`sentidoConfirmado`, `paradasPrescriptibles`, calendario), que no deben duplicarse). Se añadió el contrato mínimo:

| Operación (`operacion`) | Petición | Respuesta 200 |
| --- | --- | --- |
| `buscar-rutas` | `consulta` (1–80) | `rutas[]` (`codigo`, `desde`, `hacia`; hasta 50), `total`, `catalogo` |
| `detalle-ruta` | `codigo` (1–12), sin distinguir mayúsculas ni espacios | `codigo`, `etiqueta`, `desde`, `hacia`, `sentido`, `calendario`, `horario`, `estaciones[]` (`nombre`, `coordenada` o `null`, `paradaVerificada`), `trazado[]`, `catalogo` |
| `listar-lugares` | nada más | `lugares[]` (nombres únicos, ordenados), `catalogo` |
| `planear-viaje` | `origen` y `destino` (1–80), nombres exactos de `listar-lugares` | `origen`, `destino`, `resultado`, `tramos[]` (hasta 2), `rutasPorElTrazado[]`, `catalogo` |

- Valida con Zod (`strictObject`: un campo de más o una frase en lugar de datos da 400). Cuerpo de hasta 1.000 bytes, leído por stream. 404 `{"error":"no-encontrado"}` para una ruta o lugar que no existe; un nombre que no es exactamente un lugar (por ejemplo «de Ricaurte a Calle 72») no se interpreta: es 404.
- Usa las funciones de la web: `searchRoutes`, `planTrip`, `planTripCandidato`, `routesAlongBoth`, `paradasPrescriptibles`, `sentidoConfirmado`, `estadoCalendarioEnFecha`. Solo se añadieron `listarLugares` y `lugarPorNombre` en `lib/routes.ts`.
- Solo entrega las coordenadas que el catálogo tiene; si falta una, el campo es `null` y la app no dibuja ni sustituye ese punto.
- Pasa por el `proxy` (HTTP Basic), como `/api/transmilenio`. **No lleva límite de peticiones propio**: no consulta ningún modelo ni servicio externo.
- Contrato en `lib/contrato-planificador.ts`, manejador en `app/api/planificador/route.ts`, pruebas en `lib/ea25-planificador.test.ts`. Una prueba lee los fixtures de `ios/TransMiVozTests/FixturesPlanificador.swift` y comprueba que cumplen los esquemas, y otra compara las cotas de `EntradaPlanificador.swift` con las del servidor.
- **Render necesita un despliegue manual** para que el endpoint exista. Hasta entonces el iPhone recibe un 404 sin el cuerpo del planificador y lo muestra como falla del servidor (código 404), no como «no encontrado».

## Paridad con la web

| Flujo de la web | iPhone | Estado |
| --- | --- | --- |
| Buscar por estación o ruta (`PartialRoutes`, `searchRoutes`) | Búsqueda de rutas, mismo `searchRoutes` en el servidor | Cubierto en software |
| Buscar hablando | No; la voz de Consulta es otra tarea (#45) | Diferencia |
| Lista de rutas con procedencia (`RouteList`) | Resultados con procedencia, total y aviso de datos antiguos | Cubierto; la web además dice la procedencia en voz |
| Detalle de una ruta (`RouteDetail`) | Sentido, calendario, horario, estaciones, paradas verificadas, mapa y Guardar | Cubierto; sin «Escuchar» ni lectura en voz propia (VoiceOver) |
| Estado que se renueva | El detalle se consulta al abrirlo y con «Volver a consultar»; la web renueva cada 30 s | Diferencia |
| Plan de viaje (`TripView`) desde una frase del asistente | Selección estructurada de dos lugares; el servidor planea | Distinto a propósito (criterio de #51) |
| «Sube en» y «Bájate en» | El iPhone nombra «Abordaje» y «Descenso» solo en un viaje operativo y no da órdenes; el candidato dice «Desde» y «Hasta». No hay revalidación en el dispositivo (la web revalida cada 30 s) | Diferencia, conservadora |
| Alternativas del viaje («También te sirven…») | Solo el mejor plan | Diferencia |
| Origen por GPS | No hay ubicación en el iPhone | Diferencia |
| Mapa (`TransitMap`, Leaflet y OpenStreetMap) | MapKit; trazado del tramo entre abordaje y descenso, marcas con los nombres del listado; sin ubicación de la persona | Cubierto en código; **mapa sin verificar en Simulator ni iPhone** |
| Capa del Metro futuro (#85, `lib/metro-cartografia.ts`) | **No**: no sale por ningún contrato HTTP; exponerla requiere un endpoint y revisar de nuevo la licencia y las coordenadas en el iPhone | Pendiente |
| Rutas frecuentes (lista de la web) | Ajustes ▸ Favoritas (#80); sus filas **no** abren el detalle | Diferencia |
| Respuesta del asistente `route` y `search` | Enlaces al detalle y a la lista de rutas de la estación | Cubierto |
| Respuesta `trip` del asistente | Sigue sin órdenes de abordaje (EA-17): tramos como información | Sin cambios |
| Lupa, Ajustes, Favoritas, Ayuda | Fusionados en #86 y #80 | No se tocó; ver `ios/README.md` |

## Criterios de #51

| Criterio | Estado |
| --- | --- |
| Buscador, detalle y selección estructurada consumen el planificador compartido por un contrato validado; mapa y listado reflejan el mismo tramo; sin frase ni planificación en Swift | **Cubierto en software.** Backend: 25 pruebas nuevas, `tsc`, `pnpm test` y `pnpm build` en verde. Swift: pruebas escritas (decodificación estricta, cliente HTTP simulado, modelos, mapa y listado del mismo tramo) y **sin ejecutar donde se escribieron**; las ejecuta la CI del PR |
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
- Despliegue manual de Render para que exista `/api/planificador`.
- Capa del Metro en el mapa del iPhone (contrato HTTP y verificación aparte).
- Abrir el detalle desde las filas de Favoritas, y las alternativas del viaje, si se decide que cuentan para la paridad.
- Auditorías de accesibilidad con el texto más grande (`AccessibilityXXXL`) para las pantallas nuevas: hoy solo se comprueba que lo esencial se alcanza entero y tocable al desplazar, como en Ajustes. La auditoría completa de tamaño normal cubre la búsqueda con resultados y la selección del viaje; el detalle y el resultado del viaje no se auditan porque se espera que midan más que el área visible (no se midió).
