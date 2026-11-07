# EA-02 (#28): plan de trabajo y reparto

Issue: [#28: Prototipar rediseño accesible de los flujos principales del iPhone](https://github.com/ZuluCode777/proyecto-1-APP/issues/28), parte de [#26](https://github.com/ZuluCode777/proyecto-1-APP/issues/26). Bloquea a [#43](https://github.com/ZuluCode777/proyecto-1-APP/issues/43). Responsable: A2. Rama: `ea-02-prototipo-accesible`.

## Objetivo

Elegir una interfaz completa y accesible para el iPhone antes de construir las vistas finales de #43 y sus sucesoras. La interfaz cubre cinco flujos: iniciar orientación, consultar transporte, conversar, revisar avisos y gestionar el accesorio. Para elegir se comparan al menos dos prototipos desechables con la misma información y distinta estructura, y se registra la decisión con sus pruebas y límites.

## Comprobaciones antes de empezar (4/11/2026)

| Comprobación | Resultado |
| --- | --- |
| Issue abierto y libre | Abierto, sin persona asignada, sin comentarios, sin bloqueos. Se asignó a A2 (`jacobojacobojacobo`). |
| Otros agentes o PR | Ningún PR abierto. Ninguna rama ni PR menciona EA-02 o #28. La única rama reciente de agente es `ea-05-paradas-verificadas-sentido` (#31), ya fusionada. |
| Rama de trabajo | `ea-02-prototipo-accesible`, creada desde `main` en `7fbee2a`. Nada se sube a `main`. |
| Integración continua de `main` | En verde en `7fbee2a`. |

## Pasos

Estado: **hecho**, **en curso** o **pendiente**. «Kiro» es el agente en el sandbox Linux; «Agente con Mac» es cualquier agente o persona con Mac, Xcode e iPhone.

| # | Paso | Quién | Estado |
| --- | --- | --- | --- |
| 1 | Releer #28, #26, #43, #45, #46, #51, `CONTEXT.md`, arquitectura (prototipo P2), auditoría e investigación Metro; inventariar pantallas y textos actuales. | Kiro | Hecho |
| 2 | Fijar pregunta, tareas representativas y criterios de aprobación. | Kiro | Hecho, en [evaluación y decisión](evaluacion-y-decision.md) |
| 3 | Especificar lectura y foco, Dynamic Type, controles de 44×44 pt, contraste 7:1, texto equivalente al audio, modo de baja visión, cancelación, permisos y separación de avisos. | Kiro | Hecho, en [especificación de accesibilidad](especificacion-accesibilidad.md) |
| 4 | Construir el prototipo desechable con dos variantes (A y B), nueve áreas y sus estados, sin red ni guardado. | Kiro | Hecho, en [prototipo.html](prototipo.html) |
| 5 | Comprobar en Chromium sin interfaz, a 390×844: tamaño y nombre de controles, contraste calculado, texto al 100/200/310 % y baja visión, desbordes, foco al entrar, volver, repintar y al desaparecer un control, comportamiento (66 pruebas), ausencia de red y de guardado. | Kiro | Hecho, resultados en evaluación |
| 6 | Recorrido experto: diez tareas por variante con conteo aproximado de deslizamientos de VoiceOver, y T2 completa solo con teclado en ambas. | Kiro | Hecho, marcado como revisión experta provisional |
| 7 | Preparar guion de sesiones con usuarios y tabla de registro sin datos identificables. | Kiro | Hecho, en [guion de sesiones](guion-sesiones-usuarios.md) |
| 8 | Registrar recomendación provisional, cambios de diseño y límites. | Kiro | Hecho, en evaluación |
| 9 | Revisión independiente del diff; corregir sus hallazgos y volver a revisar. | Kiro | Hecho, ver cambios en evaluación |
| 9b | Abrir PR en español hacia `main`, con revisión limpia e integración continua en verde. Sin fusionar hasta que A2 lo indique. | Kiro | Hecho, [PR #58](https://github.com/ZuluCode777/proyecto-1-APP/pull/58) |
| 10 | Abrir el prototipo en Safari de iPhone con VoiceOver y recorrer las tareas en ambas variantes. | Agente con Mac | Pendiente. A2 no puede revisar las funciones del iPhone. |
| 11 | Probar tamaños de Dynamic Type reales, Negrita, Aumentar contraste y Reducir movimiento en el iPhone. | Agente con Mac | Pendiente. A2 no puede revisar las funciones del iPhone. |
| 12 | Sesiones con personas ciegas y de baja visión, con consentimiento. Si no hay participantes, la validación sigue pendiente. | A2 con el equipo | Pendiente. Se harán cuando la app esté desarrollada en Xcode, no con este prototipo. |
| 13 | Elegir variante (o combinación) y registrar la decisión en la evaluación y en #28. | A2 | Hecho el 7/11/2026: variante B con ajustes, en la [evaluación](evaluacion-y-decision.md) y en el PR #58. Falta anotarla en #28. |
| 14 | Fusionar el PR cuando A2 lo indique. | A2 | A2 pidió fusionar el 7/11/2026; Kiro lo fusiona por ese pedido. |

## Qué no se puede hacer en el sandbox

El sandbox es Linux, sin Mac, Xcode, simulador de iOS ni iPhone. Su red solo llega a GitHub; el registro de npm está bloqueado.

| Trabajo | Motivo | Queda para |
| --- | --- | --- |
| Recorrido con VoiceOver real (Safari o app nativa) | No hay iPhone ni macOS. El árbol de accesibilidad de Chromium no es VoiceOver. | Agente con Mac, paso 10 |
| Dynamic Type, Negrita, Aumentar contraste, Reducir movimiento e Invertir colores reales | Son ajustes de iOS. El prototipo solo simula el tamaño de texto. | Agente con Mac, paso 11 |
| Prototipo SwiftUI o prueba en simulador | SwiftUI y el simulador solo existen en macOS. | #35 y #43 |
| Audio real: VoiceOver y voz de la app a la vez, auriculares, llamadas | Sin dispositivo ni salida de audio. | #35, #41 y experimento X2 |
| Bluetooth, accesorio, GPS y cámara reales | Sin hardware. El prototipo los simula y lo indica en pantalla. | #35, #41 y #33 |
| Sesiones con usuarios | Requieren personas, consentimiento y facilitación. | A2, paso 12, con la app de Xcode |
| Elección final de la variante | Decisión humana (`ready-for-human`). | A2, paso 13. Hecho: variante B. |
| `pnpm install`, `tsc`, `pnpm test`, `pnpm build`, `pnpm verificar` locales | El registro de npm está bloqueado. El cambio no toca código de la app; la integración continua del PR los ejecuta. | Integración continua |
| Percepción del contraste por personas con baja visión | El sandbox solo calcula cocientes. | Paso 12 |

## Reglas de trabajo

- Trabajar solo en `ea-02-prototipo-accesible`. Nunca hacer commit ni push a `main`.
- Todo cambio llega a `main` mediante PR revisado. Ningún agente fusiona por su cuenta; solo A2 decide cuándo.
- Antes de retomar, releer #28 y sus comentarios, y comprobar que nadie más trabaja en el issue o la rama.
- No presentar capturas o el árbol de Chromium como prueba de VoiceOver, ni el prototipo como app terminada.
- No registrar secretos ni datos personales de participantes.

## Prototipo en `main`

La skill `prototype` pide que el prototipo viva en una rama desechable fuera de `main`. A2 pidió fusionar el PR #58 completo, así que `prototipo.html` entra a `main` como excepción deliberada. Queda como registro de la decisión y no pasa a producción, porque las vistas se escriben en SwiftUI en #43.
