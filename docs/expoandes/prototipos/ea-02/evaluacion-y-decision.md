# EA-02 (#28): evaluación y decisión

**Estado: revisión experta provisional.** Ninguna persona ciega o con baja visión ha probado el prototipo y no hubo recorrido con VoiceOver real. La validación con usuarios y la elección final siguen pendientes de A2 ([plan de trabajo](plan-de-trabajo.md), pasos 10 a 13).

## Pregunta

¿Qué estructura permite a una persona ciega o con baja visión iniciar la sesión de orientación, consultar transporte, reconocer un fallo, cancelar y recuperarse, sin depender de la vista ni del color?

## Versión evaluada

[Prototipo](prototipo.html) versión 0.1, rama `ea-02-prototipo-accesible`. El commit exacto figura en el PR. Mismas nueve áreas y mismos textos en las dos variantes:

| Variante | Estructura |
| --- | --- |
| **A — Una acción principal** | Inicio en estrella: cada área a un nivel de distancia, con «Volver». Cada pantalla: título, una frase de estado, una acción grande y los detalles plegados en «Detalles del estado». Franja de actividad y «La app dijo» arriba. |
| **B — Pestañas y lista de estados** | Cinco pestañas (Inicio, Viajar, Asistente, Avisos, Más). Cada pantalla lista todos sus estados como filas, con la acción junto a cada fila. Franja de actividad, «La app dijo» y pestañas abajo. |

Se descartó una tercera variante de flujo guiado (C en [arquitectura](../../arquitectura-y-experimentos.md), prototipo P2) para respetar el día-persona estimado. Puede añadirse si las sesiones muestran problemas de orientación inicial.

## Método

Todo se ejecutó en Chromium sin interfaz, con ventana de 390×844 CSS px (tamaño de iPhone). Los guiones están en [comprobaciones/](comprobaciones/).

1. **Barrido** (`barrido.js`). 345 combinaciones: 2 variantes × 34 estados (35 en B, que añade «Más») × 5 configuraciones (texto 100, 200 y 310 %; baja visión con 100 y 310 %). En cada una se comprueba tamaño de controles, nombre accesible, contraste de todo texto visible, desborde horizontal, que todo estado con color lleve su palabra, un único título y foco en el título.
2. **Invariantes** (`invariantes.js`). 29 pruebas de comportamiento con temporizadores reales: cancelaciones, respuestas tardías, vencimiento de datos, llegada nunca anunciada con ubicación mala, abordaje solo con paradas verificadas, foco al volver y al repintar, texto equivalente, permisos y Escape.
3. **Recorrido de tareas** (`tareas.js`). Diez tareas en ambas variantes. Se cuentan los deslizamientos de VoiceOver necesarios para llegar a cada objetivo desde el foco actual y las activaciones (toque doble). Es una aproximación lineal: VoiceOver real agrupa algunos elementos de otra forma, y el rotor de encabezados o el toque con cuatro dedos acortan los recorridos.
4. **Revisión experta** de las capturas en [capturas/](capturas/) y del árbol de accesibilidad.

## Resultados comunes

| Comprobación | Resultado |
| --- | --- |
| Controles de al menos 44×44 | 345/345 combinaciones; el mínimo usado es 48 px. |
| Nombre accesible en todo control | 345/345. |
| Contraste de texto | Mínimo **17,31:1** en las 345 (objetivo 7:1), en tema claro y en baja visión. |
| Desborde horizontal | Ninguno, también al 310 %. |
| Estado comunicado solo por color | Ninguno: todo estado con color lleva palabra («Urgente:», «Importante:»…), ícono y estilo de borde. |
| Foco al entrar en pantalla | En el título en las 345. |
| Invariantes de comportamiento | **29/29.** |
| Red, guardado, errores | Cero peticiones de red, cero errores de JavaScript. El código no usa almacenamiento, cookies ni red. |
| Palabras partidas | Cero al 100 y 200 %. Al 310 %: 25 palabras en 22 de 34 pantallas (A) y 24 en 22 de 35 (B), por ejemplo «programación» o «TransMilenio». Ocurre con palabras más anchas que la línea; iOS también las corta en AX5. |

## Comparación A y B

### Recorrido de tareas

Deslizamientos / activaciones. Menos es mejor.

| Tarea | A | B |
| --- | --- | --- |
| T1 Iniciar sesión, oír «sin detección», detenerla | 8 / 2 | **4 / 2** |
| T2 Viaje Terminal → Calle 72 (verificado) | **23 / 2** | 33 / 2 |
| T3 Viaje Portal Usme → Molinos (sin confirmar) | **21 / 2** | 29 / 2 |
| T4 Viaje con ubicación denegada (origen manual) | **15 / 3** | 32 / 3 |
| T5 Reconocer ubicación imprecisa | **9 / 1** | 11 / 1 |
| T6 Preguntar por voz y cancelar | **11 / 3** | 36 / 3 |
| T7 Distinguir aviso local, anuncio y Metro | **29 / 1** | 43 / 1 |
| T8 Estación futura E12 del Metro | **24 / 2** | 43 / 3 |
| T9 Accesorio desconectado y reconexión | 25 / 2 | **23 / 2** |
| T10 Abrir lupa, ampliar y congelar | **25 / 6** | 49 / 7 |
| **Total** | **190 / 24** | 303 / 26 |

Las dos escriben el mismo texto en T2, T3 y T4 (6 entradas). A necesita 37 % menos deslizamientos en total y gana 8 de 10 tareas. B gana T1: el estado completo de Inicio se lee sin entrar en otra pantalla.

### Densidad y espacio

| Medida (texto al 100 %) | A | B |
| --- | --- | --- |
| Paradas de lectura por pantalla, media | **16,9** | 23,8 |
| Controles por pantalla, media | **8,5** | 11,5 |
| Franjas fijas con una actividad en curso | **74 px (9 %)** | 203 px (24 %) |
| Franjas fijas con texto ≥ 200 % | **0 px** (dejan de ser fijas) | 59 px (7 %, pestañas) |

### Revisión experta

| | A — Una acción principal | B — Pestañas y lista de estados |
| --- | --- | --- |
| A favor | Una decisión por pantalla; la acción principal aparece en los primeros pasos. «Cancelar» y «La app dijo» quedan cerca del título. Menos texto que recorrer. | Todo el estado visible a la vez. Las pestañas cambian de área sin volver a Inicio. Patrón conocido de iOS. Cada acción está junto al estado que cambia. |
| En contra | Los estados quedan plegados: ver todo exige abrir «Detalles del estado». Cambiar de área exige volver a Inicio. | Cancelar y «La app dijo» quedan al final, lejos del título (T6: 36 deslizamientos). Las pestañas no crecen con Dynamic Type; iOS lo compensa con el visor de contenido grande. «Más» esconde lupa, ajustes, accesorio y Metro. |
| Baja visión | Más espacio útil: sin franjas fijas en texto grande. | Con texto normal, un cuarto de la pantalla queda fijo mientras hay actividad. |

## Cambios de diseño durante la evaluación

| Hallazgo | Cambio |
| --- | --- |
| Íconos de símbolos Unicode aparecían como cuadros vacíos en algunas fuentes. | Íconos en SVG, decorativos y ocultos a VoiceOver. |
| Al 310 %, los márgenes en `em` dejaban «Acceso / rio» partido. | Márgenes laterales fijos; títulos que crecen menos que el texto, como en iOS. |
| Palabras más largas que la línea desbordaban al 310 %. | Corte de palabra solo cuando no cabe; `fieldset` sin ancho mínimo. |
| B perdía frases que A mostraba en el resumen, por ejemplo «No puedo saber si llegaste». | Cada fila de B lleva la misma información en su nota. Prueba de paridad añadida. |
| El botón Iniciar/Detener cambiaba de identificador y se perdía el foco. | Identificador estable en botones que cambian de texto. |
| Repintar con el foco en el título lo perdía. | Título con identificador estable. |
| El aviso de ubicación de iOS no mostraba el interruptor «Ubicación exacta». | Corregido, con prueba de regresión. |
| Las franjas «fijas» no se fijaban. | Corregido; desde 200 % dejan de ser fijas, salvo las pestañas de B. |
| La pregunta por voz se enviaba sin el aviso de envío al servidor. | Voz y texto pasan por el mismo aviso. |
| Faltaba un equivalente del gesto de escape. | Escape cancela lo transitorio o vuelve atrás. |

## Recomendación provisional

**A como base**, por menos recorrido en 8 de 10 tareas, cancelación cerca del título y más espacio útil con texto grande. Conviene probar con usuarios una combinación: la jerarquía de A con una barra de pestañas como la de B, para cambiar de área sin volver a Inicio. La franja de actividad y «La app dijo» se mantendrían arriba.

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

- El árbol de accesibilidad de Chromium y las capturas no prueban VoiceOver. El orden de lectura en Safari para iOS y en SwiftUI puede diferir.
- El tamaño de texto es simulado. Dynamic Type, Negrita, Aumentar contraste, Reducir movimiento e Invertir colores reales requieren iPhone.
- Accesorio, ubicación, cámara, audio y permisos están simulados. No se midió latencia, audio por auriculares ni la coexistencia de VoiceOver con la voz de la app (experimento X2).
- El contraste calculado no dice cómo lo perciben personas con baja visión.
- Los datos de viaje son de ejemplo (8 G y 8 T del 3/11/2026); el prototipo no consulta el backend.
