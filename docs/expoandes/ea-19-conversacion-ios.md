# EA-19: conversación por voz y texto en el iPhone, con aclaración y permisos (software)

Estado al **12 de noviembre de 2026**. Issue: [#45](https://github.com/ZuluCode777/proyecto-1-APP/issues/45). Describe el **software** de la pestaña Consulta (`ios/TransMiVoz/Voz/`, `Estado/ConsultaModelo.swift`) y el cambio aditivo del backend. **No hay prueba en un iPhone**: nadie ha dictado con el micrófono real, oído la respuesta por auriculares ni usado VoiceOver con esto. Que compile y pase en CI **no prueba** el reconocimiento del español, la privacidad del servicio, la convivencia acústica ni el comportamiento del sistema. EA-19 **sigue abierta**; lo que exige dispositivo está en la [lista de banco](#lista-de-banco-pendiente).

## Qué hay

- **Dictado** de la pregunta: botón «Dictar pregunta» en la pantalla Consulta. El texto reconocido va al campo; la persona lo revisa y pulsa «Enviar». El campo de texto nunca se bloquea: es la alternativa en todo estado.
- **Aclaración entre turnos**: «Salgo desde Ricaurte» deja «Origen pendiente: Ricaurte» y la pregunta siguiente («Calle 72») lo lleva de vuelta al servidor.
- **Respuesta hablada**: una pregunta dictada (y no editada después) se contesta también en voz alta por la misma `ControlVoz` que los avisos del accesorio. Lee también el límite de la acción («Esta app no usa tu ubicación…»), no solo el texto del servidor. Nunca corta un aviso que ya suena.
- **Cancelar y salir** invalidan captura, solicitud y voz de la respuesta.

## Contrato con el backend (cambio aditivo)

El servidor no guarda historial: `/api/agent` recibía solo `message` y «Calle 72» sola listaba las rutas que pasan por esa estación, sin origen. El contrato no podía expresar la aclaración, así que se añadió, sin cambiar nada de lo existente:

| Dónde | Campo | Significado |
| --- | --- | --- |
| Respuesta (`AgentReplySchema`, `lib/local-agent.ts`) | `aclaracion?: { origen: string }` | Solo la lleva «salgo desde X» sin destino (`trip_missing_destination`): el origen que falta completar. |
| Petición (`app/api/agent/route.ts`) | `pendiente?: { origen: string }` | El origen del turno anterior. Un valor inválido se descarta; sin él la petición es la de siempre. |

`conOrigenPendiente` (`lib/seleccion-interprete.ts`) aplica la regla en el servidor, después de elegir la intención: solo completa un viaje que llega **sin** origen. Con el modelo cargado, `requiereModelo` no lo consulta cuando hay `pendiente` y las reglas leen un viaje sin origen: el modelo no ve el pendiente y podría tomar «Calle 72» por otra cosa, así que responden las reglas, como con `trip_missing_destination`. Un origen que la persona dijo ahora no se sustituye, cualquier otra intención (cancelar, ayuda, una ruta) ignora el pendiente, y como el viaje ya trae origen, `runIntent` no usa el GPS. La web no cambia: ignora el campo nuevo. Las reglas de transporte siguen en TypeScript; Swift solo guarda y reenvía el origen. Pruebas: `lib/ea19-aclaracion.test.ts` y, sobre el `POST` real con el modelo cargado, `lib/ea19-aclaracion-ruta.test.ts`.

En el iPhone, el origen vive **en memoria**, en `ConsultaModelo.origenPendiente`; no hay historial, ni remoto ni local.

| Evento | Qué pasa con el origen pendiente |
| --- | --- |
| Respuesta con `aclaracion` | Queda ese origen. |
| Cualquier otra respuesta | Se borra (un viaje completo no deja nada pendiente). |
| Error (red, 401, 429, plazo…) | Se conserva: «Reintentar» repite la pregunta con el mismo origen. |
| «Cancelar» con una consulta en curso | Se borra. Una respuesta tardía de esa consulta se descarta y no lo revive. |
| «Reintentar» tras cancelar | Acción explícita: repite la pregunta tal como salió, con el origen que llevaba. El botón lo dice: «Reintentar con origen Ricaurte». |
| Salir de la pestaña | Cancela lo que está en curso (y con ello el origen); sin nada en curso, el origen pendiente se conserva y la pantalla lo muestra. |
| «Olvidar origen» | Se borra. |
| Escenario Metro | No viaja (la aclaración es de un viaje de TransMilenio). |

## Audio: un solo dueño

`SintetizadorSistema` (`Accesorio/AudioSistema.swift`) sigue siendo el único que configura `AVAudioSession`. Se le añadieron `abrirCaptura` y `cerrarCaptura`; el reconocedor no toca la sesión.

- Captura: `.playAndRecord` con `.allowBluetooth` y `.duckOthers`. No `.record`: sin salidas, `rutaActual` daría «desconocida» y `ControlVoz` callaría los avisos del accesorio mientras se dicta. Al cerrar la captura la sesión vuelve a la categoría de la voz (`.playback`, sin activar).
- **Antes de capturar se corta solo la respuesta hablada de la pantalla** (`DictadoModelo.cortarVozPropia`, que fija la consulta). Si lo que suena es un aviso del accesorio, **no se corta y el micrófono no se abre**: el botón pasa a «esperando el aviso» y la pantalla dice «Está sonando un aviso. Vuelve a tocar «Dictar pregunta» cuando termine.» (anuncio con prioridad y foco al mensaje). Vale por los dos caminos que abren el micrófono, el botón y la respuesta a los avisos de permiso del sistema (`arrancar`), porque mientras esos avisos están en pantalla puede empezar a sonar algo.
- **Con la captura abierta no se habla**: la respuesta hablada se omite (la pantalla la muestra igual) y, si una locución va a empezar por otra vía (un aviso del accesorio), el dictado se cancela y la persona lo oye (`ControlVoz.alHablar`, gancho añadido a `PoliticaAudio`, pequeño y aditivo).
- **La respuesta hablada es habla de rutina y cede ante un aviso físico** (arquitectura-y-experimentos.md, «Política de voz»): pasa por `ControlVoz.anunciar`, con su cola de uno y sus reglas (ruta privada, voz permitida, sin interrupción), pero antes `ConsultaModelo` comprueba con `ControlVoz.hablando` (solo lectura) si suena algo que no es suyo. Si suena, la respuesta solo se muestra y no se repite sola. Es una guarda mínima y local. Al integrar con EA-20 (#46) se **conserva junto a** la prioridad de `ControlVoz.anunciar(_:prioridad:)`, no se sustituye: la respuesta va como `.rutina`, y esa regla solo la frena ante una advertencia o un aviso urgente, mientras que esta guarda la frena también ante cualquier locución ajena, como un mensaje de rutina del accesorio. Lo mismo vale para el dictado: el micrófono no se abre (`.vozOcupada`) mientras suene algo que no es la respuesta de la pantalla. La voz urgente no se puede silenciar; `advertenciasSilenciadas` solo calla a las advertencias. Al salir solo se corta la locución propia (`ControlVoz.locuciones`): si habló otro después, no se toca.
- **«Enviar» con el micrófono abierto** (o esperando los avisos de permiso) cancela el dictado antes de enviar: el texto parcial se queda en el campo como texto escrito, lo que llegue después se descarta y la respuesta de esa pregunta no se lee en voz alta (un parcial no es una pregunta dictada y revisada). Mientras la captura está abierta, la pantalla difiere el anuncio de VoiceOver y el movimiento del foco por un cambio de la consulta, y los hace al cerrarla.
- **Solo se lee una pregunta dictada y sin editar**: `DictadoModelo.ultimoDictado` se borra al empezar otra captura, al enviar y con cualquier edición del campo (`ConsultaModelo.editarTexto`), también si el texto vuelve a quedar igual a lo dictado. «Reintentar» repite lo enviado y no lee la respuesta.
- `SintetizadorSistema.capturaAbierta`: mientras hay captura, el aviso tardío de una locución anterior (`didFinish`/`didCancel` llegan después de cortarla) no libera la sesión de audio y no cierra el micrófono.
- Con la captura abierta **no se anuncia «escuchando» por VoiceOver**: sonaría sobre el micrófono y entraría como texto. Solo vibra; el resto de estados se anuncia con el micrófono ya cerrado.

## Reconocimiento y privacidad

`ReconocedorSFSpeech` consulta al sistema cada vez, sin suponer nada: `SFSpeechRecognizer` para español de Colombia y, si no existe, de España; `isAvailable` y `supportsOnDeviceRecognition`. La pantalla lo dice **antes** de pedir nada, con el idioma que el sistema ofreció:

- reconocimiento local declarado: «Según tu iPhone, el dictado se hace en este equipo, en español de Colombia: el audio no saldría de él.» (se pide `requiresOnDeviceRecognition`; lo dice el sistema, no la app lo garantiza);
- si no: «Dictado con el servicio de Apple, en español de Colombia: el audio se envía a Apple.»;
- sin reconocedor o no disponible: «El dictado no está disponible ahora. Escribe tu pregunta.»

La misma línea va en la pista del botón (`accessibilityHint`), porque VoiceOver llega al botón antes que a la línea de abajo. Que el sistema declare reconocimiento local **no prueba** que sea bueno con acento colombiano ni que funcione sin red: no se promete. Permisos (micrófono y reconocimiento de voz) se piden al tocar el botón, no antes; los textos del sistema están en `project.pbxproj` (`INFOPLIST_KEY_NSMicrophoneUsageDescription` y `NSSpeechRecognitionUsageDescription`). Negados o restringidos, la pantalla lo dice, ofrece «Abrir Ajustes» y el texto sigue funcionando. Ruido o silencio (`kAFAssistantErrorDomain` 1110) y fallos del servicio también dejan el texto.

## Accesibilidad

El botón cambia de texto, icono y valor («detenido», «escuchando», «sin permiso», «no disponible»…): el estado no depende del color. Los estados que impiden dictar se anuncian con prioridad y mueven el foco de VoiceOver a su mensaje; al terminar se anuncia «Dictado terminado: …» con el texto. Todo escala con Dynamic Type; el botón mide al menos 44 pt.

## Criterios de #45

| Criterio | Estado |
| --- | --- |
| Dueño de sesión único; captura y reproducción no se realimentan; texto disponible con permiso negado, servicio caído o ruido | **Cubierto por software** (pruebas con dobles y de interfaz con reconocedor sintético). **Pendiente en dispositivo**: realimentación real con altavoz y con auriculares. |
| «Salgo desde Ricaurte» + «Calle 72» conserva el origen; cancelar borra la aclaración; sin GPS ni historial remoto | **Cubierto por software** (backend con el catálogo de la copia guardada; app con cliente controlable). |
| Capacidad real de reconocimiento local; explicar si el audio usa el servicio remoto; alternativa | **Cubierto por software** en la consulta y el texto. **Pendiente en dispositivo**: qué declara cada iPhone para es-CO / es-ES y la calidad del reconocimiento. No se promete español colombiano sin red. |
| Cancelar/salir invalida captura, solicitud, habla y navegación; 401/413/429, plazo y red caída con foco accesible | **Cubierto por software**. No hay navegación a pantallas en esta versión (las acciones solo muestran su límite), así que no hay navegación que invalidar. Foco con VoiceOver real: **pendiente**. |
| Rutas, GPS, horarios y Metro muestran evidencia del catálogo; el modelo nunca crea incidentes, confirma paradas ni decide alertas físicas | **Ya cubierto por EA-17**: la respuesta muestra la procedencia del catálogo tal como la da el servidor; la lectura en voz alta usa lo mismo que la pantalla (un viaje lee el aviso de la app, no el texto del servidor). Este cambio no añade ninguna acción. |

## Lista de banco (pendiente)

1. Dictar con el micrófono del iPhone en español: qué reconocedor y qué capacidad (`local` o `remoto`) declara cada dispositivo, tasa de aciertos con frases de la feria («Salgo desde Ricaurte», «Calle 72», nombres de estaciones) y con ruido de calle.
2. Respuesta hablada con auriculares con cable y Bluetooth: que no entre en el micrófono al volver a dictar, y qué pasa con el micrófono Bluetooth (perfil de manos libres) al abrir y cerrar la captura.
3. Un aviso del accesorio con la captura abierta: que el dictado se cancele, el aviso suene entero y la persona lo entienda. Y un aviso sonando al tocar «Dictar pregunta» o al responder a los avisos de permiso: que el micrófono no se abra, el aviso no se corte y el mensaje se entienda.
4. VoiceOver real: foco y anuncios del botón, de los mensajes de permiso y del origen pendiente.
5. Permisos reales: primer uso, negado, restringido y reactivado desde Ajustes.

## Límites

- El dictado termina cuando la persona lo detiene; no hay corte automático por silencio ni plazo de captura propio (el servicio de Apple limita la duración). Una interrupción del audio (una llamada) con la captura abierta no tiene tratamiento propio: el botón siempre deja detenerla o cancelarla. Pasar a segundo plano la cancela, junto con la consulta en curso y la voz de la respuesta.
- Las pruebas de interfaz usan un reconocedor sintético con frases fijas (`-PRUEBAS_UI_DICTADO_SINTETICO`) y rotulado; no prueban el micrófono ni el español.
- Un cambio de configuración del motor de audio o de la ruta (el perfil de manos libres Bluetooth) con la captura abierta no tiene tratamiento propio: no se detecta ni se reinicia la captura.
- Un aviso que `ControlVoz` silencia (voz apagada, ruta no privada, interrupción) no cancela la captura abierta: solo cancela el dictado el aviso que va a sonar.
- Si la respuesta no se lee porque sonaba un aviso, no se repite sola; la pantalla la muestra. «Reintentar» de una pregunta dictada tampoco la lee.
- Anuncio de VoiceOver encima de un aviso físico: la app no puede cancelar a VoiceOver; el anuncio del mensaje «Está sonando un aviso» llega con prioridad y no se prueba cómo suena junto al aviso.
- Cambios de ruta de audio al abrir el micrófono Bluetooth pueden provocar el aviso de «sin auriculares» del accesorio si la ruta pasa por una no privada un instante: sin medir.
- No se compiló ni se ejecutó donde se escribió (sin Xcode): la CI iOS es la primera compilación.
