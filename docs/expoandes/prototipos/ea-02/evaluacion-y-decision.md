# EA-02 (#28): evaluación y decisión

**Estado: revisión experta provisional.** Ninguna persona ciega o con baja visión ha probado el prototipo y no hubo recorrido con VoiceOver real. La validación con usuarios y la elección final siguen pendientes de A2 ([plan de trabajo](plan-de-trabajo.md), pasos 10 a 13).

## Pregunta

¿Qué estructura permite a una persona ciega o con baja visión iniciar la sesión de proximidad, consultar transporte, reconocer un fallo, cancelar y recuperarse, sin depender de la vista ni del color?

## Versión evaluada

[Prototipo](prototipo.html) versión 0.1, rama `ea-02-prototipo-accesible`. El commit exacto figura en el PR. Las dos variantes tienen las mismas nueve áreas y los mismos textos:

| Variante | Estructura |
| --- | --- |
| **A — Una acción principal** | Inicio en estrella: cada área a un nivel de distancia, con «Volver». Cada pantalla tiene título, una frase de estado, una acción grande y los detalles plegados en «Detalles del estado». La franja de actividad y «La app dijo» van arriba, antes del título. |
| **B — Pestañas y lista de estados** | Cinco pestañas: Inicio, Viajar, Asistente, Avisos y Más. Cada pantalla lista todos sus estados como filas, con la acción junto a cada fila. La franja de actividad, «La app dijo» y las pestañas van abajo. |

Se descartó una tercera variante de flujo guiado (C en [arquitectura](../../arquitectura-y-experimentos.md), prototipo P2) para respetar el día-persona estimado. Puede añadirse si las sesiones muestran problemas de orientación inicial.

## Método

Todo se ejecutó en Chromium sin interfaz, con ventana de 390×844 CSS px (tamaño de iPhone). Los guiones están en [comprobaciones/](comprobaciones/).

1. **Barrido** (`barrido.js`). 355 combinaciones: 2 variantes × 35 estados (36 en B, que añade «Más») × 5 configuraciones (texto al 100, 200 y 310 %; baja visión al 100 y 310 %). En cada combinación se comprueban:
   - tamaño y nombre accesible de cada control;
   - contraste de todo texto visible;
   - desborde horizontal;
   - que todo estado con color lleve su palabra;
   - un único título y el foco en él (en las 335 combinaciones sin diálogo abierto).

   También cuenta palabras partidas y mide las franjas fijas.
2. **Invariantes** (`invariantes.js`). 47 pruebas de comportamiento con temporizadores reales: cancelaciones y respuestas tardías, foco, vencimiento de datos, ubicación sin llegada ni distancia falsa, abordaje solo verificado, Metro, paridad de frases de seguridad entre A y B, permisos, Escape y teclado.
3. **Teclado.** Una prueba completa T2 solo con Tab, Enter y escritura en cada variante, y comprueba que no hay `tabindex` positivos.
4. **Recorrido de tareas** (`tareas.js`). Diez tareas en ambas variantes. Cuenta los deslizamientos de VoiceOver necesarios para llegar a cada objetivo desde el foco actual, y las activaciones (toque doble). Si el texto buscado aparece en dos lugares, por ejemplo en el resultado y en «La app dijo», se toma el más cercano. Es una aproximación lineal: VoiceOver real agrupa algunos elementos de otra forma, y el rotor de encabezados o el toque con cuatro dedos acortan los recorridos.
5. **Revisión experta** de las capturas en [capturas/](capturas/) y del árbol de accesibilidad. Además hubo una revisión independiente del código y los documentos; sus hallazgos se corrigieron (ver «Cambios»).

## Resultados comunes

| Comprobación | Resultado |
| --- | --- |
| Controles de al menos 44×44 | 355/355 combinaciones. El mínimo usado es 48 px. |
| Nombre accesible en todo control | 355/355. |
| Contraste de texto | Mínimo **17,31:1** en las 355 (objetivo 7:1), en tema claro y en baja visión. |
| Desborde horizontal | Ninguno, también al 310 %. |
| Estado comunicado solo por color | Ninguno. Todo estado con color lleva palabra («Urgente:», «Importante:»…) e ícono. |
| Foco en el título al entrar en pantalla | 335/335 combinaciones sin diálogo. Con diálogo, el foco va a su título. |
| Invariantes de comportamiento | **47/47.** |
| Teclado | T2 completa con 5 pulsaciones de Tab en A y 11 en B. No hay `tabindex` positivos. |
| Red, guardado, errores | Cero peticiones de red y cero errores de JavaScript. El código no usa almacenamiento, cookies ni red. |
| Palabras partidas | Ninguna al 100 y al 200 %. Al 310 %: 28 palabras en 23 de 35 pantallas (A) y 27 en 23 de 36 (B), por ejemplo «programación» o «TransMilenio». Pasa con palabras más anchas que la línea; iOS también las corta en AX5. |

## Comparación A y B

### Recorrido de tareas

Deslizamientos / activaciones. Menos es mejor.

| Tarea | A | B |
| --- | --- | --- |
| T1 Iniciar sesión, oír «sin detección», detenerla | **3 / 2** | 4 / 2 |
| T2 Viaje Terminal → Calle 72 (verificado) | **16 / 2** | 33 / 2 |
| T3 Viaje Portal Usme → Molinos (sin confirmar) | **12 / 2** | 29 / 2 |
| T4 Viaje con ubicación denegada (origen manual) | **15 / 3** | 32 / 3 |
| T5 Reconocer ubicación imprecisa | **9 / 1** | 11 / 1 |
| T6 Preguntar por voz y cancelar | **8 / 3** | 29 / 3 |
| T7 Distinguir aviso local, anuncio y Metro | **29 / 1** | 43 / 1 |
| T8 Estación futura E12 del Metro | **24 / 2** | 43 / 3 |
| T9 Accesorio desconectado y reconexión | **14 / 2** | 19 / 2 |
| T10 Abrir lupa, ampliar y congelar | **25 / 6** | 49 / 7 |
| **Total** | **155 / 24** | 292 / 26 |

Las dos escriben el mismo texto en T2, T3 y T4 (6 entradas). A necesita 47 % menos deslizamientos y gana las 10 tareas. La diferencia es pequeña en T1 y T5, donde B muestra el estado completo sin entrar en otra pantalla. Es mayor donde B deja la cancelación y «La app dijo» al final (T6) o esconde el área en «Más» (T8, T10).

Las filas de B probablemente se leen en VoiceOver como dos paradas (nombre y valor), y el conteo las toma como una. Si es así, los recorridos de B serían aún más largos.

### Densidad y espacio

| Medida | A | B |
| --- | --- | --- |
| Paradas de lectura por pantalla, media, texto al 100 % | **16,7** | 23,7 |
| Controles por pantalla, media, texto al 100 % | **8,3** | 11,4 |
| Franjas fijas en Inicio con una sesión activa, texto al 100 % | **71 px (8 %)** | 197 px (23 %) |
| Franjas fijas con texto al 200 o 310 % | **0 px** (dejan de ser fijas) | 59 px (7 %, pestañas) |

### Revisión experta

| | A — Una acción principal | B — Pestañas y lista de estados |
| --- | --- | --- |
| A favor | Una decisión por pantalla; la acción principal aparece en los primeros pasos. «Cancelar» y «La app dijo» quedan justo antes del título. Menos texto que recorrer. | Todo el estado visible a la vez. Las pestañas cambian de área sin volver a Inicio. Patrón conocido de iOS. Cada acción está junto al estado que cambia. |
| En contra | Los estados quedan plegados: ver todo exige abrir «Detalles del estado». Cambiar de área exige volver a Inicio. | Cancelar y «La app dijo» quedan al final, lejos del título. Las pestañas no crecen con Dynamic Type; iOS lo compensa con el visor de contenido grande. «Más» esconde lupa, ajustes, accesorio y Metro. |
| Baja visión | Más espacio útil: sin franjas fijas con texto grande. | Con texto normal, casi un cuarto de la pantalla queda fijo mientras hay actividad. |

## Cambios de diseño durante la evaluación

| Hallazgo | Cambio |
| --- | --- |
| Los íconos de símbolos Unicode aparecían como cuadros vacíos en algunas fuentes. | Íconos en SVG, decorativos y ocultos a VoiceOver. |
| Al 310 %, los márgenes en `em` partían «Accesorio» en dos líneas. | Márgenes laterales fijos; los títulos crecen menos que el texto, como en iOS. |
| Palabras más largas que la línea desbordaban al 310 %. | Se cortan solo cuando no caben; los `fieldset` no tienen ancho mínimo. |
| B perdía frases que A daba en el resumen, por ejemplo «No puedo saber si llegaste». | Cada fila de B lleva la misma información en su nota. Prueba de paridad de frases de seguridad añadida. |
| El botón Iniciar/Detener cambiaba de identificador y se perdía el foco. | Identificador estable en botones que cambian de texto. |
| El foco caía en la página al pulsar un control que desaparece: cancelar desde la franja, «Entendido, enviar», «Elegir», «Reintentar». | El foco va al control que inicia la actividad; si no está en pantalla, a «Repetir». Prueba añadida. |
| Con ubicación imprecisa o antigua se mostraba distancia y se ofrecía orientar. | Sin distancia ni dirección con ubicación no fiable; la acción principal es «Actualizar ubicación». Si la ubicación empeora durante la orientación, se detiene y se avisa. |
| Una búsqueda de ubicación cancelada podía completar otra posterior, rellenar el origen tras salir de Rutas o dejar la orientación activa sin ubicación. | Cada búsqueda tiene turno; salir de la pantalla la cancela; cancelarla detiene la orientación. Al salir, todo lo cancelado se dice en un solo anuncio. |
| El paso de vuelta a «sin detección» se decía sin «no significa que el camino esté libre». | La voz incluye la advertencia, y la prueba revisa también la voz. |
| Dos anuncios seguidos se pisaban, por ejemplo al olvidar el accesorio con la sesión activa. | Un solo anuncio con ambas cosas. |
| Con catálogo viejo, el asistente daba el horario como verificado. | Lo da como horario publicado. |
| «Calle 1» se resolvía como «Calle 187». | Coincidencia por palabras completas. |
| El aviso de ubicación de iOS no mostraba el interruptor «Ubicación exacta», y un segundo Escape lo cerraba. | Interruptor visible; el aviso se reabre si se cierra sin respuesta. |
| Las franjas «fijas» no se fijaban. | Corregido. Con texto al 200 % o más dejan de ser fijas, salvo las pestañas de B. |
| La pregunta por voz se enviaba sin el aviso de envío al servidor. | Voz y texto pasan por el mismo aviso. |
| Faltaba un equivalente del gesto de escape. | Escape cancela lo transitorio o vuelve atrás. |
| La primera versión del conteo de tareas tomaba la primera aparición del texto en la página, no la más cercana al foco. | Corregido. Con la regla anterior el total era A 206 y B 303, y B ganaba T1 y T9. |

## Recomendación provisional

**A como base**, por menos recorrido en las diez tareas, cancelación justo antes del título y más espacio útil con texto grande. Conviene probar con usuarios una combinación: la jerarquía de A con una barra de pestañas como la de B, para cambiar de área sin volver a Inicio. La franja de actividad y «La app dijo» se mantendrían arriba.

Esta recomendación sale de mediciones automáticas y revisión experta. No sustituye las sesiones con usuarios ni el recorrido con VoiceOver en iPhone.

## Decisión

| Campo | Valor |
| --- | --- |
| Decisión | **Pendiente de A2.** |
| Opciones | A, B o combinación A + pestañas. |
| Validación con usuarios | Pendiente. Muestra: ninguna todavía. |
| Fecha | — |
| Consecuencia para #43 | Las vistas SwiftUI de #43 siguen la variante elegida y la [especificación de accesibilidad](especificacion-accesibilidad.md). |

## Límites

- El árbol de accesibilidad de Chromium y las capturas no prueban VoiceOver. El orden de lectura de Safari para iOS y el de SwiftUI pueden diferir.
- Cada repintado reconstruye la pantalla y devuelve el foco a un elemento nuevo con el mismo identificador. Es probable que VoiceOver relea ese control cuando llega un evento (conexión, vencimiento, desconexión). Es un efecto del prototipo, no del diseño: en SwiftUI la vista bajo el foco conserva su identidad. Anotarlo en las sesiones para no atribuirlo a la variante.
- El tamaño de texto es simulado: Safari no aplica el Dynamic Type del iPhone a este prototipo. Dynamic Type, Negrita, Aumentar contraste, Reducir movimiento e Invertir colores reales requieren iPhone.
- Accesorio, ubicación, cámara, audio y permisos están simulados. No se midió latencia, audio por auriculares ni la coexistencia de VoiceOver con la voz de la app (experimento X2).
- El contraste calculado no dice cómo lo perciben personas con baja visión.
- Los datos de viaje son de ejemplo (8 G y 8 T del 3/11/2026). El prototipo no consulta el backend.
