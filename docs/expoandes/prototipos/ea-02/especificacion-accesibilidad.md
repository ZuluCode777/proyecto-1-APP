# EA-02 (#28): especificación de accesibilidad para el iPhone

Reglas que deben cumplir las vistas de [#43](https://github.com/ZuluCode777/proyecto-1-APP/issues/43), [#45](https://github.com/ZuluCode777/proyecto-1-APP/issues/45), [#46](https://github.com/ZuluCode777/proyecto-1-APP/issues/46) y [#51](https://github.com/ZuluCode777/proyecto-1-APP/issues/51), sea cual sea la variante elegida. El [prototipo](prototipo.html) las aplica en web y las [comprobaciones](comprobaciones/) las verifican en Chromium. **Ninguna se ha comprobado todavía con VoiceOver ni en iPhone.** Las APIs de SwiftUI citadas son puntos de partida para #43 y deben confirmarse en Xcode.

Vocabulario según [CONTEXT.md](../../../../CONTEXT.md) y la [arquitectura](../../arquitectura-y-experimentos.md): «sin detección», nunca «camino libre»; «orientación hacia estación», nunca «ruta peatonal» ni «guía»; «escenario Metro», nunca «viaje»; «sesión de proximidad» para la sesión con el accesorio.

## 1. Lectura y foco

| Regla | Prototipo | SwiftUI (a confirmar) |
| --- | --- | --- |
| Cada pantalla tiene un único título, marcado como encabezado. | `h1` | `.accessibilityAddTraits(.isHeader)` |
| Al entrar en una pantalla, el foco va al título. | `repintar({ enfocar: 'h1' })` | `@AccessibilityFocusState` y `.accessibilityFocused` |
| Al volver, el foco regresa al control que abrió la pantalla. | `desde` en la pila | Guardar el identificador de origen y reenfocarlo |
| Un resultado asíncrono (viaje, respuesta) mueve el foco a su encabezado y se anuncia una vez. | `resultado-titulo`, `respuesta-titulo` | Foco más `AccessibilityNotification.Announcement` (iOS 17) |
| Un cambio de estado sin navegación se anuncia y **no** mueve el foco. | Regiones vivas ocultas | Anuncio; nunca reconstruir la vista bajo el foco |
| Un repintado conserva el foco en el mismo control. Si ese control desaparece, el foco va a un destino definido, nunca a la nada. | `data-id` estable y `respaldo` | Identidad estable (`id`) en `ForEach` y botones; foco explícito tras quitar un control |
| Un botón que cambia de texto (Iniciar/Detener) conserva su identidad. | `sesion-principal`, `acc-principal`, `gps-principal` | Mismo botón con etiqueta variable |
| Los íconos son decorativos. | `aria-hidden` | `.accessibilityHidden(true)` |
| Una fila de estado se lee como una unidad: severidad, nombre, valor, nota. | Bloque de texto único | `.accessibilityElement(children: .combine)` |

Orden de lectura de cada pantalla:

- **A:** «Volver» (o el nombre de la app en Inicio), franja de actividad (si hay), «La app dijo» con «Repetir», título, aviso fijo (si hay), frase de estado, acción principal, contenido, más acciones y detalles plegados. Al entrar, el foco va al título: la cancelación queda un deslizamiento hacia atrás.
- **B:** «Volver» (si hay), título, aviso fijo, filas de estado con su acción, contenido, acciones, y al final la franja de actividad, «La app dijo» y las pestañas.

## 2. Dynamic Type

- El texto de cuerpo es 17 pt en el tamaño por omisión y llega a unos 53 pt en AX5 (310 %). El prototipo simula 100, 135, 200 y 310 %.
- Nada se trunca ni se superpone. Las filas pasan a una columna; los botones crecen en alto.
- Los títulos crecen menos que el cuerpo, como los estilos de iOS.
- Desde 200 %, las franjas que estaban fijas se desplazan con el contenido: la de actividad en A, y la de actividad y «La app dijo» en B. Si quedaran fijas, con texto al 310 % taparían más de la mitad de la pantalla en A y más que la pantalla entera en B, según una medición manual en Chromium.
- Si se usa barra de pestañas, no crece con el texto: se usa el visor de contenido grande del sistema (`.accessibilityShowsLargeContentViewer()`; `TabView` lo trae).
- En SwiftUI: estilos de texto (`.body`, `.headline`), `@ScaledMetric` para espacios, `ViewThatFits` o `dynamicTypeSize.isAccessibilitySize` para cambiar de fila a columna. Nada de alturas fijas.
- Al 310 % algunas palabras largas se parten. Revisar en iPhone si conviene acortar textos.

## 3. Controles

- Área táctil mínima de **44×44 pt**; el prototipo usa 48. En SwiftUI: `.frame(minWidth: 44, minHeight: 44)` y `.contentShape(Rectangle())`.
- Cada control tiene nombre propio que dice qué hace: «Cancelar consulta», «Detener sesión», «Volver a Inicio». Nunca «OK» ni «Aquí».
- Las opciones de radio y los interruptores muestran su estado en texto («Modo baja visión: activado»).

## 4. Contraste y color

- Objetivo de **7:1** para todo texto, en tema normal y en baja visión. Medido: mínimo 17,31:1.
- Bordes y foco: al menos 3:1 contra el fondo (negro sobre blanco, amarillo sobre negro).
- El color **nunca** comunica un estado solo. Cada estado lleva palabra («Urgente:», «Importante:», «Información:», «Verificado:», «Simulación:») e ícono. Urgente, Importante y Simulación además tienen borde propio: doble, discontinuo y punteado.
- Respetar Aumentar contraste (`colorSchemeContrast == .increased`) y Diferenciar sin color (`accessibilityDifferentiateWithoutColor`).

## 5. Texto equivalente al audio

- Todo lo que la app dice aparece también en «La app dijo», con botón «Repetir».
- El texto en pantalla y la locución salen de las mismas funciones (`textoResultado`, `pasosViaje`), para que no diverjan.
- Con VoiceOver activo, el anuncio lo lee VoiceOver; la voz propia de la app empieza apagada para no hablar dos veces. Debe decidirse en el experimento X2 (`UIAccessibility.isVoiceOverRunning`, `AVSpeechUtterance.prefersAssistiveTechnologySettings`).
- Los avisos urgentes (proximidad, pérdida del accesorio) usan anuncio prioritario. Los avisos de rutina usan anuncio cortés.
- Sin salida de audio confirmada (auriculares desconectados), los avisos no se reproducen por el altavoz automáticamente; quedan en pantalla y en Avisos.

## 6. Modo de baja visión

- Fondo negro, texto blanco, acciones principales en amarillo con texto negro, bordes de 5 px y palabra de severidad subrayada.
- Interlineado de 1,5.
- Independiente del tamaño de texto: se combinan.
- La imagen de la lupa no se invierte con Invertir colores (`.accessibilityIgnoresInvertColors()`).

## 7. Cancelación siempre disponible

- Toda actividad en curso (escucha, consulta, búsqueda de ubicación, orientación hacia la estación, sesión de proximidad) aparece en la franja «Actividad en curso» con su propio botón: «Cancelar escucha», «Cancelar consulta», «Cancelar búsqueda», «Detener orientación», «Detener sesión».
- Tras cancelar con un botón que desaparece (por ejemplo, desde la franja), el foco va al control que inicia esa actividad («Consultar viaje», «Hablar», el botón de ubicación o de sesión). Si ese control no está en la pantalla actual, va a «Repetir», junto a lo que la app acaba de decir. Nunca queda sin foco.
- Cancelar una búsqueda de ubicación también detiene la orientación, que se quedaría sin ubicación actual.
- La franja está en el mismo lugar en todas las pantallas.
- El gesto de escape de VoiceOver (dos dedos en «Z») cancela lo transitorio; si no hay nada que cancelar, vuelve atrás. En el prototipo, la tecla Escape. En SwiftUI: `.accessibilityAction(.escape)`.
- Salir de una pantalla cancela su consulta o escucha.
- Una respuesta que llega después de cancelar se descarta: no habla, no se muestra y no navega.
- Un aviso de proximidad durante la escucha corta la captura y no la reanuda sola.
- Propuesta para validar: Magic Tap (dos dedos, dos toques) cancela lo transitorio o repite «La app dijo».

## 8. Permisos

Cada permiso se explica en una hoja propia justo antes del aviso del sistema, con una alternativa sin permiso. Denegar nunca bloquea el resto de la app. iOS no vuelve a preguntar: la app explica cómo activarlo en Ajustes.

| Permiso | Cuándo | Alternativa | Clave de Info.plist |
| --- | --- | --- | --- |
| Ubicación | Al tocar «Activar ubicación» o «Usar mi ubicación como origen». | Escribir el origen. | `NSLocationWhenInUseUsageDescription` |
| Micrófono y reconocimiento de voz | Al tocar «Hablar». Se advierte que el audio puede ir a Apple si no hay reconocimiento en el dispositivo. | Escribir la pregunta. | `NSMicrophoneUsageDescription`, `NSSpeechRecognitionUsageDescription` |
| Bluetooth | Al iniciar la sesión de proximidad. | El resto de la app funciona. | `NSBluetoothAlwaysUsageDescription` |
| Cámara | Al abrir la lupa. | Ninguna; la lupa no está disponible. | `NSCameraUsageDescription` |

- Con «Ubicación exacta» desactivada, iOS da una posición aproximada (kilómetros). La app no orienta con ella y lo dice.
- Antes del primer envío al servidor, el asistente avisa que la pregunta se envía y que la ubicación solo va si se activa.

## 9. Ubicación

- Siempre se muestran precisión y antigüedad.
- Con ubicación imprecisa, antigua o aproximada, **nunca** se anuncia llegada, no se muestra distancia ni dirección y no se ofrece orientar: la acción es actualizar la ubicación o escribir el origen.
- Si la ubicación empeora durante la orientación, esta se detiene y se dice por qué.
- Una búsqueda de ubicación cancelada, o de una pantalla que se dejó, no completa nada después.
- Cerca de la estación se dice «Esto no confirma que estés en un acceso».
- Sin brújula fiable, solo punto cardinal y «no sé hacia dónde miras».

## 10. Avisos, anuncios y simulación

La pantalla Avisos tiene tres secciones con encabezado propio:

1. **Avisos de este teléfono:** desconexión, dato vencido, ubicación imprecisa, audio, red. Cada uno lleva severidad, origen y hora, y los botones «Repetir» y «Silenciar». Los urgentes no se pueden silenciar mientras sigan activos. Un aviso repetido actualiza el anterior; no se acumulan.
2. **Anuncios del operador:** sin fuente conectada se dice «Esto no significa que no haya novedades en el servicio». Un anuncio muestra fuente, publicación y vigencia.
3. **Escenario Metro:** el Metro no tiene servicio comercial y no genera anuncios.

En Metro, un aviso fijo dice que es escenario educativo. Ningún texto da indicaciones de abordaje.

## 11. Transporte

- Solo un viaje con paradas, sentido y horario verificados dice «Sube» y «Bájate».
- Sin esa evidencia, o con catálogo viejo, se explica por qué no se indica abordaje.
- Se muestran fuente y vigencia de los datos.
- Errores de red, 401 y 429 tienen texto propio y reintento explícito.

## Cómo se comprueba

| Regla | Comprobación automática | Pendiente en iPhone |
| --- | --- | --- |
| 1 Lectura y foco | Título único, foco al entrar, volver, repintar y al desaparecer un control; recorrido con teclado | Orden real de VoiceOver en Safari y SwiftUI |
| 2 Dynamic Type | Sin desborde a 100/200/310 %; palabras partidas contadas | Tamaños reales del sistema |
| 3 Controles | ≥ 44×44 y nombre accesible | Uso con una mano |
| 4 Contraste y color | ≥ 7:1; estado con palabra | Percepción con baja visión |
| 5 Audio | Texto visible igual a la región viva | VoiceOver y voz propia a la vez (X2) |
| 7 Cancelación | Escape, cancelar y salir; descarte de respuestas tardías | Gesto de escape y Magic Tap |
| 8 Permisos | Hoja previa, Escape, denegación y alternativa | Avisos reales del sistema |
| 9–11 | Llegada, distancia, abordaje, Metro y paridad entre variantes | Datos reales del backend |
