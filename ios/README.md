# TransMiVoz para iPhone (SwiftUI)

Cliente iPhone mínimo de TransMiVoz. **Proyecto:** `ios/TransMiVoz.xcodeproj` (se abre directamente en Xcode; no hay generadores ni pasos manuales). **Esquema compartido:** `TransMiVoz`. **Destino mínimo:** iOS 17.0, solo iPhone. Código y comentarios en español.

Es un corte mínimo para EA-09 (#35) con soporte de CI iOS-CI (#68). No es una app terminada ni instalable sin firma: ver [Límites](#límites-de-la-evidencia).

## Qué hace

| Pestaña | Contenido | Necesita red |
| --- | --- | --- |
| Sesión | Accesorio **real** por Bluetooth: buscar y elegir, iniciar, detener, reconectar, estado, avisos hablados por auriculares. Con el enlace **sin autenticar** (política de demostración aprobada por A1 el 12/11/2026 para la feria: las medidas se muestran y se dicen, con el aviso fijo y la voz declarando el límite). Una hoja explica el permiso de Bluetooth antes del aviso del sistema. Las pruebas de interfaz recorren esta misma pantalla con un transporte sintético rotulado (`-PRUEBAS_UI_ACCESORIO_SINTETICO`, solo depuración) y, aparte, la sesión simulada. | No |
| Consulta | Texto o dictado → `POST /api/agent` del backend Next existente, con cancelar, reintentar y errores claros. El dictado (EA-19) pone el texto en el campo y la respuesta a una pregunta dictada también se lee en voz alta; «Salgo desde Ricaurte» + «Calle 72» conserva el origen entre turnos. Un selector en una fila fija sobre el contenido, de texto «Metro (futuro)», activa el escenario Metro (educativo, infraestructura futura), aparte del transporte de hoy. | Sí |
| Lupa | Imagen en vivo de la cámara trasera, ampliada, con los cuatro filtros de la lupa web, aumento dentro del rango del dispositivo y congelado. Solo amplía la imagen: no reconoce ni describe nada, y la imagen no se guarda ni se envía. | No |
| Ajustes | Primera pantalla: origen HTTPS y clave opcional (Llavero si la persona lo pide). El menú «Más ajustes» de la barra abre **Preferencias** (voz propia de los avisos del accesorio, el mismo estado que el interruptor de Sesión), **Favoritas** (rutas guardadas en el iPhone con «Quitar»; agregar llegará con la pantalla de rutas) y **Ayuda** (texto estático con los límites). | No |

Todas las reglas de transporte siguen en el backend (`lib/local-agent.ts`). La app solo envía el texto, valida la respuesta y la muestra. Esta versión **no envía ni pide ubicación** (sin CoreLocation ni permiso): el origen de un viaje se escribe en la pregunta, así que negar la ubicación no existe como bloqueo.

### Contrato HTTP usado

- `POST {origen}/api/agent`, cuerpo `{"message": "..."}` (y, solo en el turno que completa una aclaración, `"pendiente": {"origen": "..."}`; EA-19), `Content-Type: application/json`. Sin reintentos automáticos.
- Entrada validada antes de enviar: no vacía y hasta 300 unidades UTF-16 (igual que el recorte del servidor; la app **rechaza**, no recorta en silencio). Cuerpo ≤ 4.000 bytes.
- Respuesta `AgentReplySchema` (`reply`, `steps`, `engine`, `action` ∈ `none|frequent|gps|search|route|trip`, y `catalogo` y `aclaracion` opcionales). El decodificador rechaza acciones desconocidas, campos faltantes y textos vacíos o desmedidos. `catalogo` (`{procedencia, antiguo}`, EA-17) llega solo en respuestas con datos de ruta, estación o viaje: la frase con la fuente y la fecha, y si el servidor respondió con la copia guardada o con datos en vivo de más de 6 h. La app no calcula fechas ni vigencias; un servidor sin `catalogo` sigue siendo compatible.
- Autenticación: HTTP Basic con usuario fijo `transmivoz` y la clave de la persona (el servidor ignora el usuario). Solo HTTPS, sin credenciales en la URL, y **no se sigue ninguna redirección** para que `Authorization` no viaje a otro origen.
- Errores: 400, 401, 413, 429 (con `Retry-After` en segundos), 503, 5xx, sin conexión, TLS, plazo de 12 s y respuesta incompatible. Cada uno trae mensaje y recuperación. Cancelar, reemplazar o enviar una entrada inválida invalida la consulta vigente, y salir de la pestaña Consulta la cancela: su respuesta tardía se descarta.
- Plazo total de 12 s (propuesta de `arquitectura-y-experimentos.md`, criterio de UX, no una latencia medida). Si vence (un servidor que arranca en frío), la pantalla dice que puede estar arrancando, **conserva la pregunta** y espera un «Reintentar» explícito; no hay reintentos automáticos.

### Dictado y aclaración entre turnos (EA-19, software)

Detalle y límites en [ea-19-conversacion-ios.md](../docs/expoandes/ea-19-conversacion-ios.md). En resumen:

- **Dictado** con `SFSpeechRecognizer` + `AVAudioEngine` detrás de un protocolo (`Voz/ReconocedorVoz.swift`) con doble y reconocedor sintético. Español de Colombia y, si no existe, de España; la pantalla dice, antes de pedir nada, si el sistema declara reconocimiento en el iPhone o si el audio se envía a Apple. **No se promete español colombiano sin red ni calidad de reconocimiento: nada de esto se ha probado en un iPhone.** Permisos de micrófono y de reconocimiento de voz al tocar «Dictar pregunta»; negados, restringidos, sin servicio o con ruido, el campo de texto sigue funcionando.
- **Un solo dueño del audio:** `SintetizadorSistema` abre y cierra la sesión de captura. Antes de capturar se corta solo la respuesta hablada de la pantalla: con un aviso del accesorio sonando el micrófono no se abre (la lectura de transporte cede ante la proximidad), y con la captura abierta no se habla (un aviso la cancela). «Enviar» con el micrófono abierto cancela el dictado. La respuesta hablada pasa por la misma `ControlVoz` que los avisos del accesorio y lee también el límite de la acción.
- **Aclaración:** el servidor responde `aclaracion.origen` a «salgo desde X» y espera `pendiente.origen` en la pregunta siguiente; la app lo guarda en memoria, sin historial. Cancelar lo borra.
- Cancelar o salir de la pestaña invalida captura, solicitud y voz de la respuesta.

### Acciones sin pantalla propia y Metro (EA-17)

- Se reconocen las seis acciones. La web abre una pantalla para `frequent`, `gps`, `search`, `route` y `trip`; el iPhone todavía no las tiene, así que la app muestra el texto del servidor y **dice el límite** («Esta app todavía no tiene la pantalla de…») sin navegar a ninguna. Los textos están en `TransMiVoz/Dominio/PresentacionRespuesta.swift`.
- Un viaje sin confirmar (la guardia retira las órdenes de abordaje) conserva la fecha y la procedencia del catálogo: se muestran aparte porque el texto del servidor no se presenta.
- **Catálogo antiguo:** con `catalogo.antiguo` la respuesta lleva «Datos antiguos», el motivo y un botón «Volver a consultar»; VoiceOver lo oye en el anuncio de la respuesta.
- **Metro:** el selector (fila fija sobre el área desplazable; texto visible «Metro (futuro)», siempre el mismo; su estado, «activado» o «desactivado», va en el valor de accesibilidad y en la introducción) antepone «Metro: » a la pregunta (`TransMiVoz/Dominio/EscenarioConsulta.swift`) para que el servidor la trate como Metro (`interpretarMetro` en `lib/metro.ts`; lo comprueba `lib/ea17-procedencia.test.ts`). La pantalla y el anuncio dicen que es el **escenario Metro, educativo: infraestructura futura, sin servicio comercial** (vocabulario de `CONTEXT.md`; el anuncio al elegirlo sale solo del selector). El selector mide al menos 44×44 pt y su texto escala con Dynamic Type. Va en una fila fija y no en la barra de navegación (la barra limita el control a 36 pt y no escala el texto) ni dentro del contenido desplazable (con el texto más grande cambia hasta dónde se desplaza la pantalla). El servidor responde con `action: none`; si llegara una ruta, estación o viaje de TransMilenio, la app lo trata como respuesta incompatible en vez de presentarlo como Metro. Nunca se promete una ruta de Metro en servicio. La indicación del prefijo resta 7 caracteres al máximo (293).

### Respuestas de viaje (`action: trip`)

El texto de un viaje puede traer órdenes de abordaje sin parada, sentido ni vigencia verificados en el cliente. Esta versión **no muestra el texto** de un viaje: muestra un aviso y los tramos como información (el conteo de estaciones solo si `conteoVerificado`). No es una guía de abordaje. El resto de respuestas pasa por una guardia de contenido equivalente a la política del backend (`contieneImperativoDeViaje` y `respuestaSinImperativos` en `lib/local-agent.ts`, la misma que usa la web): si el texto o algún paso contiene una orden («Toma la X en Y», «sube en», «bájate en», «cambia a/en»), la app muestra el aviso seguro «no te doy indicaciones de abordaje» en su lugar y omite los pasos. Las abstenciones que solo mencionan subir o bajar sin ordenar nada se muestran. Esa guardia no planifica nada y el servidor sigue siendo la autoridad (`TransMiVoz/Dominio/GuardiaContenido.swift`; casos en `GuardiaContenidoTests`, repetidos de `lib/local-agent.test.ts`).

### Lupa de la cámara (EA-25, software)

Una hoja explica el uso de la cámara **antes** del aviso de permiso de iOS, con «Continuar» y una salida «Ahora no» (no pide nada; «Activar la lupa» vuelve a explicarlo); con el permiso denegado o restringido dice cómo activarlo («Abrir Ajustes») y el resto de la app sigue igual. La cámara solo está abierta con la pestaña a la vista y la escena activa: al salir de la pestaña, pasar a segundo plano o bloquear el iPhone se suelta la sesión y el dispositivo. Si la persona sale antes de contestar al aviso, la respuesta tardía no abre nada. La sesión de captura corre en una cola propia, fuera del hilo principal. Sin cámara (Simulator) la pantalla lo dice. Los filtros usan Core Image con valores traducidos a ojo de los filtros CSS de la web: **sin calibrar con la cámara real**. El aumento sale del dispositivo (mínimo y máximo que él declara, con tope de 10×). Con la imagen congelada el control no baja del aumento que tenía al congelar (la cámara no guarda el encuadre completo). La imagen no se invierte con «Invertir colores». Si otra app toma la cámara o el sistema interrumpe la captura, la lupa la suelta y ofrece «Reintentar»: no se reanuda sola, a propósito, para no disputar la cámara a la otra app. **No hay prueba con cámara, iPhone ni VoiceOver reales.**

Diferencias con la lupa web (`components/vision-assist.tsx`):

- Aumento: en el iPhone es el del dispositivo (mínimo y máximo que declara, hasta 10×, paso 0,5); la web escala el vídeo de 1× a 3× con paso 0,1.
- Filtros: los mismos cuatro, en el mismo orden y con «Alto contraste» de partida, pero los valores de Core Image son una traducción a ojo de los CSS y **no están calibrados** con la cámara real.
- Congelado: la imagen fija se amplía recortándola y no se aleja por debajo del aumento que tenía al congelar; la web escala el vídeo entero.
- Al salir de la pestaña se descongela; se conservan el filtro y el aumento elegidos.
- La web pide el permiso sola; aquí una hoja lo explica antes.
- La web reinicia filtro y aumento al salir; la app los conserva (acotados al rango del dispositivo).
- Los avisos hablados de la web son de su propia voz (TTS); la app usa anuncios de VoiceOver.
- La web pide la cámara con `facingMode: environment`; la app usa solo la cámara trasera de ángulo normal.

### Sesión con el accesorio real (EA-15, software)

Core Bluetooth con los UUID y el contrato v1.0 existentes, sobre `SesionProximidad`. **El transporte afirma `desconocido` y, solo tras una lectura protegida de comprobación que termine bien, `cifradoSinAutenticar` (nunca `cifradoAutenticado`: la app no puede distinguir a un impostor sin protección con los mismos UUID, riesgo aceptado por A1 el 12/11/2026 solo para la feria). La política es la de demostración, `permitirAsociacionSinMITM`: la sesión consta NO autenticada y la interfaz lo declara; con `desconocido` o `sinCifrar` rechaza y no hay medidas** (contrato §6; ver «Seguridad del enlace» en ea-15-ios-ble-audio.md). Voz solo por una salida privada (auriculares con cable o Bluetooth; el sistema no distingue un altavoz Bluetooth), cola de uno, corte por cambio de ruta e interrupción, fallo cerrado si el audio no se activa; sin segundo plano. Detalle, pruebas y lista de banco en [ea-15-ios-ble-audio.md](../docs/expoandes/ea-15-ios-ble-audio.md). **No hay prueba con hardware.**

### Sesión local simulada (solo pruebas de interfaz)

Usa el paquete [`ContratoBLE`](ContratoBLE/README.md) con `modo: .simulada` y un guion de tramas inventadas por la app (`TransMiVoz/Sesion/GuionSimulado.swift`). **No hay Core Bluetooth, accesorio ni radar.** La pantalla lo dice siempre («SESIÓN SIMULADA»), muestra «Origen de los datos: simulación» y «Enlace autenticado: no (no hay enlace real)». La sesión usa una asociación sin protección frente a intermediario **solo para poder arrancar el guion**; no se afirma ningún enlace autenticado. Al acabar las tramas, la sesión caduca a «Sin datos vigentes» (la última medida ya es demasiado vieja) y no la repite. El reloj es monotónico (`ProcessInfo.systemUptime`), no la hora de pared. «Sin detección» nunca se presenta como camino libre.

### Seguridad

- Clave: solo en memoria, salvo que se active «Recordar la clave en el Llavero» (`kSecAttrAccessibleWhenUnlockedThisDeviceOnly`, asociada al origen: la clave de un servidor no se ofrece a otro). «Olvidar clave» la borra. Si el Llavero no deja borrar la clave guardada, la app lo dice (no afirma que sea transitoria), la clave se volverá a cargar al abrir la app y se puede reintentar con «Aplicar» u «Olvidar clave».
- Sin claves ni URLs reales en el repositorio, binario, registros o pruebas. Todos los fixtures usan valores inventados (`servidor.ejemplo`, ruta `Z99`, «Estación Ejemplo Norte»).
- `ClaveAcceso` oculta su valor en `description`/`debugDescription`.

## Estructura

```
ios/
  TransMiVoz.xcodeproj/        proyecto + xcshareddata/xcschemes/TransMiVoz.xcscheme
  TransMiVoz/                  app (grupo sincronizado: todo archivo nuevo entra solo)
    Dominio/ Red/ Estado/ Sesion/ Accesorio/ Lupa/ Vistas/ Simulacion/ Assets.xcassets
  TransMiVozTests/             XCTest de lógica, HTTP simulado, BLE compartido
  TransMiVozUITests/           recorridos de interfaz + auditoría de accesibilidad
  ContratoBLE/                 paquete local del contrato BLE (otro responsable)
  scripts/comprobar-ios.sh     las mismas comprobaciones que la CI
```

El proyecto usa grupos sincronizados (`objectVersion 77`): necesita **Xcode 16 o superior**. El runner `macos-26` trae Xcode 26.6 (verificado en #69); la CI de esta app **sí se ejecutó** en el SHA `97b7e819cb5ed478240a25cd253c7bd92a80844b` ([ejecución](https://github.com/ZuluCode777/proyecto-1-APP/actions/runs/42345095644)): Xcode 26.6 (build 17F113) compiló para Simulator y para iPhone genérico sin firma (Release), y pasaron 82 pruebas unitarias y 16 de interfaz (98 en total, 0 fallos, 0 omitidas) con todas las auditorías de accesibilidad, incluida `AccessibilityXXXL`. Eso es evidencia de software en un runner; **no** prueba la app en un iPhone real, ni la apertura en Xcode, ni la guía con otra persona (ver [ios-ci.md](../docs/expoandes/ios-ci.md)). Cambios posteriores a ese SHA necesitan su propia ejecución. El paquete `ContratoBLE` se enlaza por ruta local; el producto `ContratoBLEVectores` solo se enlaza al objetivo de pruebas, nunca a la app.

## Abrir y comprobar en un Mac

```bash
git clone https://github.com/ZuluCode777/proyecto-1-APP.git && cd proyecto-1-APP
git rev-parse HEAD                        # anota el commit
open ios/TransMiVoz.xcodeproj             # o: doble clic en Finder
ios/scripts/comprobar-ios.sh herramientas # versión de Xcode, SDK y runtimes
ios/scripts/comprobar-ios.sh todo         # compila, prueba y compila para iPhone sin firma
```

Cada ejecución local escribe en una carpeta nueva `ios/salida/<fecha UTC>-<pid>/` (logs crudos de `xcodebuild`, `.xcresult`, `herramientas.txt`); el script imprime la ruta al empezar y **no borra ni pisa nada**. Para abrir un resultado: `open ios/salida/<carpeta>/pruebas-simulador.xcresult`. Pasos sueltos: `compilar-simulador`, `pruebas-simulador`, `compilar-dispositivo`; para que varios pasos compartan carpeta, fija `SALIDA=ios/salida/mi-corrida` (ruta que no exista aún: si ya hay un resultado del mismo paso, el script falla y te dice cuál). Limpiar resultados viejos es cosa tuya. Autocomprobación del script (sin Xcode): `ios/scripts/probar-comprobar-ios.sh`. Si tu Xcode o tu Simulator difieren de los de la CI, el script puede fallar al elegir destino a propósito; puedes fijar `SIMULADOR_NOMBRE` e `IOS_MAYOR_ESPERADO` (ver cabecera del script). En Xcode: elige el esquema **TransMiVoz** y un iPhone Simulator, Cmd+U ejecuta todas las pruebas.

Las pruebas de interfaz arrancan la app con `-PRUEBAS_UI_SIMULADAS` (solo en compilaciones de depuración): cliente HTTP simulado, Llavero en memoria, sin red, sesión simulada. Las de la pantalla del accesorio usan `-PRUEBAS_UI_ACCESORIO_SINTETICO` (con `-PRUEBAS_UI_ACCESORIO_PERMISO_CONCEDIDO` o `-PRUEBAS_UI_ACCESORIO_PERMISO_DENEGADO` para las variantes): la misma vista y sesión de producción con un transporte sintético que la pantalla rotula, sin Bluetooth, audio ni red y con el bloqueo por enlace no verificado intacto. Las de Favoritas usan `-PRUEBAS_UI_FAVORITAS_SEMILLA` (solo en compilaciones de depuración; parten con las rutas inventadas Z99 y Z98). Las de la lupa añaden a `-PRUEBAS_UI_SIMULADAS` una cámara sintética que la pantalla rotula («Modo de pruebas: imagen sintética, sin cámara real»; una carta de colores fija que el aumento recorta, sin Core Image ni filtros), con permiso por preguntar (el «sistema» concede) o, con `-PRUEBAS_UI_LUPA_PERMISO_CONCEDIDO`, `-PRUEBAS_UI_LUPA_PERMISO_DENEGADO` o `-PRUEBAS_UI_LUPA_SIN_CAMARA`, las demás variantes. Las del dictado añaden a `-PRUEBAS_UI_SIMULADAS` el argumento `-PRUEBAS_UI_DICTADO_SINTETICO`: un reconocedor sintético que la pantalla rotula («Modo de pruebas: dictado sintético, sin micrófono real.»), sin micrófono, audio ni reconocimiento real, con permiso por preguntar (el «sistema» concede) o, con `-PRUEBAS_UI_DICTADO_PERMISO_CONCEDIDO` o `-PRUEBAS_UI_DICTADO_PERMISO_DENEGADO`, las demás variantes; cada dictado «oye» la frase siguiente de un guion («salgo desde Ricaurte», «Calle 72») o del que fije `-PRUEBAS_UI_DICTADO_GUION` seguido de las frases separadas por `|`. Palabras clave de la consulta: `error401`, `error429`, `sinred`, `lento`, `viaje`, `orden`, `gps`, `frio` (el primer intento agota el plazo, el reintento responde; simula un servidor arrancando, no es Render) y `antiguo` (el primer intento trae la copia guardada, «Volver a consultar» trae datos recientes). En el escenario Metro, cualquier pregunta devuelve una respuesta de Metro simulada.

## Firmar, instalar y recuperar (iPhone real)

Pendiente del Mac y el iPhone del 11/11 (EA-09 / #35). **Nada de esto lo prueba la CI.**

1. **Antes:** Xcode instalado y su primera ejecución terminada; cable de datos; la Apple Account de quien firma con segundo factor a mano; confirmar que ese Xcode soporta el iOS exacto del iPhone (si el iPhone tiene un iOS más nuevo que el que soporta Xcode, actualiza Xcode antes de seguir).
2. Abre `ios/TransMiVoz.xcodeproj`, comprueba el commit con `git rev-parse HEAD` y la versión con `xcodebuild -version`.
3. Xcode ▸ Settings ▸ Accounts: agrega la Apple Account. Selecciona el proyecto ▸ target **TransMiVoz** ▸ Signing & Capabilities: marca «Automatically manage signing», elige el **Team** y cambia el *Bundle Identifier* (`co.transmivoz.app` es un valor provisional que casi seguro está ocupado: usa uno propio, por ejemplo `co.transmivoz.<tus-iniciales>`). No cambies nada más. No subas al repositorio los cambios de equipo ni de identificador.
4. Conecta el iPhone, desbloquéalo y acepta «Confiar en este ordenador». Si Xcode lo pide: iPhone ▸ Ajustes ▸ Privacidad y seguridad ▸ Modo de desarrollador ▸ activar (reinicia el teléfono).
5. Elige el iPhone como destino y pulsa Run. La primera vez: iPhone ▸ Ajustes ▸ General ▸ VPN y gestión de dispositivos ▸ confía en tu perfil de desarrollador.
6. Pestaña **Ajustes**: escribe el origen `https://…` y la clave por el campo (nunca por URL ni archivo). Prueba **Consulta** (respuesta, error de red con modo avión, cancelar, volver). Prueba **Sesión** sin red: debe funcionar.
7. Un Personal Team caduca a los 7 días y hay que reinstalar desde Xcode; no equivale a TestFlight.

Recuperación (solo estas):

| Síntoma | Qué hacer |
| --- | --- |
| «Failed to register bundle identifier» | Cambia el *Bundle Identifier* por uno único. |
| «No account for team» / sin Team | Agrega la Apple Account en Settings ▸ Accounts. |
| El iPhone no aparece o dice «Developer Mode disabled» | Activa Modo de desarrollador y reinicia; reconecta el cable. |
| «Untrusted Developer» al abrir | Ajustes ▸ General ▸ VPN y gestión de dispositivos ▸ confiar. |
| Xcode no soporta el iOS del iPhone | Actualiza Xcode o usa un iPhone compatible. |
| La consulta falla con 401 | La clave es incorrecta o falta (pestaña Ajustes). |
| La consulta falla sin conexión | Revisa Wi-Fi/datos y el origen; la pestaña Sesión sigue siendo útil. |
| Cualquier otro fallo de compilación | Guarda el error exacto y el log (`Report navigator`), la versión de Xcode y el commit; vuelve al commit probado en CI con `git checkout <sha>`. Si no hay acceso al asistente, aplica el respaldo web (Safari) al agotar el día-persona de EA-09 en vez de reescribir. |

## Límites de la evidencia

Esta carpeta, el Simulator y el build sin firma permiten detectar errores de código, de contrato y de interfaz. **No** validan: firma ni instalación en iPhone, enlace BLE o radar reales, emparejamiento, latencia sensor→auricular, dictado, VoiceOver real, audio por auriculares, permisos de micrófono, reconocimiento de voz y ubicación (la app no pide la ubicación; los de micrófono y reconocimiento de voz se piden al tocar «Dictar pregunta», el de Bluetooth al buscar o iniciar y el de cámara al continuar en la lupa, todos sin probar en un iPhone), el reconocimiento del español con micrófono real ni la privacidad del servicio de reconocimiento, la cámara ni sus filtros y aumento reales, segundo plano ni autonomía. Un artefacto del Simulator o el build `generic/platform=iOS` sin firma **no se instala en un iPhone**. Esas pruebas siguen abiertas en #35, #48 y los demás issues de producto.

Fuera de este corte: mapas y origen/destino estructurado (#51), rediseño completo, unificación de avisos (EA-20), ubicación en la consulta.

Los cambios de EA-17 (#43) no se compilaron ni se ejecutaron donde se escribieron (no había Xcode): la CI iOS es la primera compilación. Siguen pendientes en un iPhone real: VoiceOver con la consulta y el Metro, Dynamic Type en el dispositivo y la consulta contra el Render real en frío. Los resultados simulados (`frio`, `antiguo`) no sustituyen esa última prueba.
