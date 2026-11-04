# EA-02 (#28): guion de sesiones con usuarios

Para A2 y el equipo. Las sesiones requieren personas, consentimiento y facilitación, y no se pueden hacer desde el sandbox. Si no hay participantes, la decisión se registra como «revisión experta provisional» y la validación con usuarios queda pendiente.

## Antes de la sesión

- Participantes: personas ciegas o con baja visión que acepten participar. Registrar solo un código (P1, P2…), nunca nombres, teléfonos ni fotos de la cara.
- Equipo: iPhone con VoiceOver para quien lo usa, y auriculares si los usa.
- El prototipo no toma el tamaño de texto del iPhone. Preguntar qué tamaño usa la persona y elegir el más parecido con `texto=100`, `135`, `200` o `310`; añadir `bajavision=1` si lo prefiere.
- Abrir el prototipo en Safari del iPhone según el [README](README.md), con `panel=0` para que el panel no aparezca en el recorrido.
- Preparar cada tarea con su escenario en la dirección: `prototipo.html?variante=A&panel=0&escenario=T2`. La persona que facilita cambia la dirección entre tareas; quien participa empieza siempre en Inicio.
- Alternar el orden: la mitad de los participantes empieza por A y la otra mitad por B.
- Duración prevista: 45 minutos como máximo, con pausas.

## Consentimiento (leer en voz alta)

> Vamos a probar un prototipo, no la app terminada. Evaluamos el diseño, no a ti. Puedes parar o saltar una tarea cuando quieras. Anotaremos qué pasa en cada tarea, sin tu nombre. No grabaremos tu cara. ¿Aceptas participar? ¿Aceptas que grabemos solo el audio de la pantalla?

Registrar «sí» o «no» para participar y para grabar audio. Sin consentimiento, no se hace la sesión.

## Tareas

Leer cada tarea tal cual, sin indicar dónde tocar. Ayudar solo si la persona lo pide o lleva 3 minutos bloqueada, y anotarlo.

| Tarea | Escenario | Instrucción | Éxito |
| --- | --- | --- | --- |
| T1 | `T1` | «Empieza la sesión con tu accesorio y dime qué detecta. Luego detenla.» | Dice que no detecta nada **y** que eso no significa camino libre; detiene la sesión. |
| T2 | `T2` | «Averigua cómo ir de Terminal a Calle 72.» | Dice dónde subir y dónde bajar. |
| T3 | `T3` | «Averigua cómo ir de Portal Usme a Molinos.» | Explica que la app no confirma dónde subir. |
| T4 | `T4` | «Averigua cómo ir de Terminal a Calle 72 usando tu ubicación como origen.» | Ante el permiso denegado, escribe el origen y obtiene el viaje. |
| T5 | `T5` | «¿Ya llegaste a la estación?» | Dice que la app no lo puede saber por la precisión. |
| T6 | `T6` | «Pregúntale al asistente por voz y cancela antes de que responda.» | Cancela; no llega respuesta. |
| T7 | `T7` | «Revisa los avisos y dime cuál viene del teléfono y cuál de TransMilenio.» | Distingue aviso del teléfono, anuncio (de ejemplo) y Metro. |
| T8 | `T8` | «¿Se puede viajar hoy desde la estación Avenida Jiménez del Metro?» | Dice que no hay servicio. |
| T9 | `T9` y `desconectar=20` | El accesorio se desconecta solo a los 20 s. «Usa la app; si algo cambia, dime qué pasó y arréglalo.» | Reconoce la desconexión y reconecta. |
| T10 | `T10` (texto al 200 % y baja visión) | «Usa la lupa para ampliar un letrero y deja la imagen quieta.» Solo para baja visión. | Abre la lupa, amplía y congela. |

## Registro por tarea

Copiar esta tabla por participante. Sin datos identificables.

| Campo | Valor |
| --- | --- |
| Participante | P_ |
| Visión | Ceguera / baja visión |
| Tecnología que usa | VoiceOver / Zoom / texto grande / otra |
| Plataforma habitual | iPhone / Android / otra |
| Orden de variantes | A→B / B→A |

| Tarea | Variante | Resultado (sí / con ayuda / no) | Tiempo aproximado | Ayuda que necesitó | Dificultades y comentarios |
| --- | --- | --- | --- | --- | --- |
| T1 | | | | | |

## Preguntas al final

1. ¿Qué versión te resultó más fácil para saber qué está pasando? ¿Por qué?
2. ¿En qué momento te sentiste perdido o sin control?
3. ¿Encontraste siempre cómo cancelar?
4. ¿Te quedó claro cuándo algo era una simulación o un ejemplo?
5. ¿Qué cambiarías primero?

Registrar opiniones distintas tal como se dan; no convertir la preferencia del equipo en hallazgo de usuarios.

## Efectos del prototipo que no son del diseño

- Cuando llega un evento (conexión, vencimiento, desconexión), el prototipo repinta la pantalla y VoiceOver puede releer el control enfocado. No atribuirlo a la variante.
- Accesorio, ubicación, cámara y permisos son simulados; los avisos del sistema llevan «Simulación del aviso de iOS».

## Después

- Resumir en la [evaluación](evaluacion-y-decision.md): número de participantes, resultados por tarea y variante, dificultades y cambios propuestos.
- Indicar qué se probó en Safari y qué queda para SwiftUI.
- A2 registra la decisión en la evaluación y en #28.
