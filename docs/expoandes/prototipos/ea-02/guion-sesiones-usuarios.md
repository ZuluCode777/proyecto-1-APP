# EA-02 (#28): guion de sesiones con usuarios

Para A2 y el equipo. Las sesiones requieren personas, consentimiento y facilitación, y no se pueden hacer desde el sandbox. Si no hay participantes, la decisión se registra como «revisión experta provisional» y la validación con usuarios queda pendiente.

A2 decidió el 7/11/2026 hacer las pruebas con usuarios cuando la app esté desarrollada en Xcode, no con este prototipo. Este guion se escribió para el prototipo; las direcciones y el panel del facilitador no existen en la app.

## Antes de la sesión

- **Participantes:** personas ciegas o con baja visión que acepten participar. Registrar solo un código (P1, P2…), nunca nombres, teléfonos, voz ni fotos de la cara.
- **Equipo:** iPhone con VoiceOver para quien lo usa, y auriculares si los usa.
- **Tamaño de texto:** el prototipo no toma el del iPhone. Preguntar qué tamaño usa la persona y elegir el más parecido con `texto=100`, `135`, `200` o `310`. Añadir `bajavision=1` si lo prefiere.
- **Dirección inicial:** abrir el prototipo en Safari del iPhone según el [README](README.md), una vez por variante: `prototipo.html?variante=A&panel=0` (o `B`). El panel queda oculto para que la persona no lo recorra con VoiceOver.
- **Cambiar de tarea sin editar la dirección:** mantener pulsado 1,5 s el aviso negro de arriba de la página (con VoiceOver: toque doble y mantener). Aparece el panel; elegir la tarea en «Tarea» y pulsar «Aplicar y volver a Inicio». El panel se oculta solo y la página vuelve arriba. Quien participa empieza siempre en Inicio.
- **Orden:** la mitad de los participantes empieza por A y la otra mitad por B.

## Duración y subconjunto de tareas

Diez tareas en dos variantes son 20 recorridos y no caben en 45 minutos. Cada sesión hace un núcleo común y una parte rotativa:

| Parte | Tareas | Tiempo |
| --- | --- | --- |
| Consentimiento y preparación | No aplica | 5 min |
| Núcleo, en A y en B | T1, T2, T5, T6, T9 | unos 30 min (3 min por recorrido) |
| Rotativa, en una sola variante | Dos de T3, T4, T7 y T8, distintas para cada participante, alternando la variante | 6 min |
| Preguntas finales | No aplica | 4 min |

- T10 se hace solo con personas de baja visión, en lugar de una tarea rotativa.
- Con personas de baja visión, T1 y T6 en B se hacen con `texto=200`, para ver la barra de pestañas y la franja de abajo con texto grande.
- Si la persona se cansa, parar. Las tareas que falten se hacen en una segunda sesión o se registran como no hechas.

## Consentimiento (leer en voz alta)

> Vamos a probar un prototipo, no la app terminada. Evaluamos el diseño, no a ti. Puedes parar, saltar una tarea o retirar tu consentimiento cuando quieras, también después de la sesión. Anotaremos qué pasa en cada tarea con un código, sin tu nombre. ¿Aceptas participar?

Si acepta participar, preguntar aparte:

> También nos ayudaría grabar solo el audio que sale del iPhone, es decir, lo que dice VoiceOver o la app. No queremos grabar tu voz. La grabación se guarda fuera del repositorio, solo la escuchan quienes facilitan la sesión, y se borra cuando terminemos de anotar los resultados. Puedes decir que no y participar igual. ¿Aceptas esa grabación?

- Registrar «sí» o «no» por separado para participar y para grabar. Sin consentimiento para participar, no se hace la sesión. Sin consentimiento para grabar, no se graba nada.
- Si se graba, grabar solo la salida del iPhone, no el micrófono de la sala. Si la voz de la persona queda en la grabación, se borra ese tramo.
- La grabación nunca se sube al repositorio ni a un issue. Se borra al pasar los resultados a la tabla de registro.
- Si la persona retira el consentimiento, se borran su grabación y su fila del registro.

## Tareas

Leer la instrucción tal cual, sin indicar dónde tocar. Ayudar solo si la persona lo pide o lleva 3 minutos bloqueada, y anotarlo. La columna «Para quien facilita» no se lee en voz alta.

| Tarea | Escenario | Instrucción para la persona | Para quien facilita | Éxito |
| --- | --- | --- | --- | --- |
| T1 | `T1` | «Empieza la sesión con tu accesorio y dime qué detecta. Luego detenla.» | Bluetooth empieza sin permiso: la persona verá la explicación previa y el aviso simulado de iOS. | Acepta el permiso, dice que no detecta nada **y** que eso no significa camino libre, y detiene la sesión. |
| T2 | `T2` | «Averigua cómo ir de Terminal a Calle 72.» | Sin indicaciones adicionales | Dice dónde subir y dónde bajar. |
| T3 | `T3` | «Averigua cómo ir de Portal Usme a Molinos.» | Sin indicaciones adicionales | Explica que la app no confirma dónde subir. |
| T4 | `T4` | «Estás en Terminal y quieres ir a Calle 72. Prueba usar tu ubicación como origen. Cuando el iPhone te pida permiso, no lo des.» | Ubicación empieza sin permiso. Tras «No permitir», la app explica y lleva al campo Origen. | Rechaza el permiso, escribe el origen y obtiene el viaje. |
| T5 | `T5` | «Pregunta a la app si ya llegaste a la estación.» | La ubicación es imprecisa (±200 m). Vale mirar Ubicación y orientación o preguntarle al asistente. La respuesta del asistente a «¿ya llegué?» es una **propuesta que el backend no tiene (requiere cambio de contrato, A1)**: anotar en el registro si la persona usó esa vía. | Dice que la app no lo puede saber por la precisión. |
| T6 | `T6` | «Hazle una pregunta al asistente hablando y cancela antes de que responda.» | Micrófono y reconocimiento de voz empiezan sin permiso: verá la explicación y dos avisos simulados. | Acepta los permisos, cancela y no llega respuesta. |
| T7 | `T7` | «Revisa los avisos y dime cuál viene del teléfono y cuál de TransMilenio.» | El anuncio del operador es un ejemplo ficticio. | Distingue aviso del teléfono, anuncio (de ejemplo) y Metro. |
| T8 | `T8` | «¿Se puede viajar hoy desde la estación Avenida Jiménez del Metro?» | Sin indicaciones adicionales | Dice que no hay servicio. |
| T9 | `T9` | «Usa la app como quieras. Si notas algo raro, dime qué pasó y arréglalo.» | Cargar directamente `prototipo.html?variante=A&panel=0&escenario=T9&desconectar=20` (o `variante=B`), sin aplicar otra tarea después. Desde el panel también sirve: elegir T9, pulsar «Desconectar en 20 s» y luego «Aplicar y volver a Inicio»; los 20 s cuentan desde que se aplica. «Reiniciar estado» descarta la desconexión pedida: si se pulsa, volver a pedir «Desconectar en 20 s». Comprobar que aparece «Se perdió la conexión con el accesorio». Si la persona detuvo la sesión antes, el panel dice «T9: no se desconectó»: repetir la tarea. | Reconoce la desconexión y reconecta. |
| T10 | `T10` | «Usa la lupa para ampliar un letrero y deja la imagen quieta.» | Solo baja visión. El escenario pone texto al 200 % y baja visión, salvo que la dirección indique otro `texto=`. Cámara empieza sin permiso. | Abre la lupa, amplía y congela. |

## Registro por tarea

Copiar esta tabla por participante. Sin datos identificables.

| Campo | Valor |
| --- | --- |
| Participante | P_ |
| Visión | Ceguera / baja visión |
| Tecnología que usa | VoiceOver / Zoom / texto grande / otra |
| Plataforma habitual | iPhone / Android / otra |
| Orden de variantes | A→B / B→A |
| Tareas rotativas | (por ejemplo T3 en A y T7 en B) |
| Consentimiento para grabar | Sí / No |

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

- Cuando llega un evento (conexión, vencimiento, desconexión), el prototipo repinta la pantalla. Conserva el desplazamiento, el foco y los «details» abiertos, pero VoiceOver puede releer el control enfocado. No atribuirlo a la variante.
- Accesorio, ubicación, cámara y permisos son simulados; los avisos del sistema llevan «Simulación del aviso de iOS».

## Después

- Resumir en la [evaluación](evaluacion-y-decision.md): número de participantes, resultados por tarea y variante, dificultades y cambios propuestos.
- Indicar qué se probó en Safari y qué queda para SwiftUI.
- A2 registra la decisión en la evaluación y en #28.
