# EA-08 (#34): reglas primero y cancelación efectiva

Rama `ea-08-reglas-cancelacion`, desde `origin/main` d8691ec, con EA-05 y EA-06.
Implementación y dos rondas de corrección con Kiro CLI local en Linux, para
revisión independiente (especificación y estándares). No se modificaron la copia
operativa (`data/transmilenio.json`), los workflows, las configuraciones de
producción ni los servicios de Windows. No se accedió a Windows, SSH, Ollama real
ni hardware. Diff sin commit.

Responde a los hallazgos 6, 7, 8 y 15 de la auditoría y a la fila E2-04 de la
investigación de Render/IA. Conserva los contratos públicos: el JSON de
`/api/agent` y una sola acción validada por pregunta; y los controles de EA-05
(paradas verificadas, sentido, calendario, revalidación justo antes de
texto/voz) y de EA-06 (catálogo válido, procedencia, consulta compartida y
reintento). Las rondas 2 y 3 aplican siete decisiones del orquestador (A–G).

## Comportamiento

### Reglas primero (AC1, hallazgo 15)

Las REGLAS interpretan primero (`parseIntent`). Si reconocen la frase, se usan y
**no se consulta el modelo**; un «no entiendo» del modelo no puede anular una
intención conocida. El modelo solo se consulta cuando las reglas devuelven
`unknown`, y su resultado se adopta solo si clasifica una intención conocida; si
falla, se cuelga o también devuelve `unknown`, se conserva la respuesta de
desconocimiento de reglas. Una sola acción validada por pregunta. La política
vive en `lib/seleccion-interprete.ts` (`requiereModelo`, `elegirIntent`), pura y
reutilizada por `app/api/agent/route.ts`.

**Actualización (EA-27, #53), decisión de A1 del 10/11/2026:** la política de
arriba, «las reglas primero», se reemplazó por «el modelo primero cuando está
cargado». Con el modelo cargado se consulta toda pregunta; solo responden las
reglas cuando no hay modelo cargado (`modeloListo` en `lib/ollama.ts`; en ese
caso se responde al instante y se lanza la precarga). Dos excepciones: `metro` y
`trip_missing_destination` los resuelven siempre las reglas, porque las
intenciones del modelo no pueden expresarlas (invariante de EA-13: una consulta
del Metro nunca es viaje, GPS ni abordaje); y se conserva la protección de este
hallazgo, porque un `unknown` del modelo, o una salida que no valida contra los
datos, no anula la intención de las reglas. El texto de arriba y la tabla de
plazos describen EA-08; la política vigente es esta.

### Decisiones A y E — salir calla la voz; navegar por la respuesta no (AC3)

El desmontaje de `TotalAgent` distingue dos causas, sin pausas:

- **Navegación que ordenó la respuesta vigente** (`onAction` de esa respuesta):
  la voz **sigue sonando**. Se marca `navegoPorRespuestaRef` justo antes de
  `onAction`.
- **Salida de la persona** (atrás, inicio, cambio de pantalla no provocado por la
  respuesta): si hay una locución PROPIA del asistente que además sigue siendo la
  última entregada, se **calla**.

El anuncio de `changeMode` del padre NO lo cubre `navegoPorRespuestaRef` (ese
desmontaje no viene de `onAction`): lo resuelve la comprobación de ÚLTIMA
locución (decisión E), porque el anuncio del padre pasa a ser la última
entregada y, por tanto, ya no es la locución propia del asistente.

El seguimiento es por IDENTIDAD de locución, no por una bandera booleana
(decisión E), porque los eventos de cancelación de `speechSynthesis` llegan de
forma ASÍNCRONA en Chrome y un `end`/`error` tardío de una locución ya cancelada
desmarcaría una bandera: `useSpeech.speak` devuelve la `SpeechSynthesisUtterance`
y registra a nivel de MÓDULO la ÚLTIMA entregada (`esUltimaLocucion`, porque
`speechSynthesis` es un singleton global). `TotalAgent` guarda su locución en
`locucionPropiaRef` (el objeto) y, en `end`/`error`, solo la borra si sigue
siendo esa misma. La limpieza llama `cancel()` solo si
`!navegoPorRespuestaRef && locucionPropiaRef.current && esUltimaLocucion(locucionPropiaRef.current)`:
así una segunda pregunta rápida o escrita durante el saludo y luego salir SÍ
calla, y el anuncio de `changeMode` del padre (que pasa a ser la última locución
entregada) NO se corta. Un toque durante «Escuchando…» o «Pensando…» es
cancelación explícita: calla, aborta captura, consulta y espera de ubicación,
invalida la pregunta y libera `busyRef`.

### Decisión B — una frase `unknown` no adjunta coordenada (AC4)

La coordenada se decide con la intención de REGLAS en el cliente y solo se pide
y envía si la frase la usa (GPS o viaje sin origen). Una frase que las reglas no
entienden (`unknown`) **no lleva coordenada**, aunque haya una en caché. Si el
servidor la resuelve con el modelo como `gps` o viaje sin origen, responde por su
camino existente de falta de ubicación/origen (abre el GPS sin nombrar estación,
o pide el origen). El aviso de privacidad coincide con esto. (Revierte la opción
de la ronda 1 que adjuntaba la coordenada en caché para `unknown`.)

### Decisión C — diagnóstico de Ollama sin falsos fallos (AC1)

El estado del motor en `/diagnostico` se reporta según la SALUD de
`GET /api/agent` (`reachable` + `hasModel`), no según el `engine` de una
respuesta `POST`. Con reglas-primero (la política de EA-08; ver la actualización
de EA-27 arriba), una frase conocida no llega al modelo, y un modelo sano que clasifica `unknown` una frase fuera de tema daría
`engine: reglas`; inferir de ahí el estado del modelo producía avisos falsos
(«no respondió», «no interpretó a tiempo»). Ahora: modelo alcanzable y con su
modelo → «alcanzable y con el modelo listo»; caído o sin modelo → aviso real. La
lógica es pura (`lib/estado-motor.ts`, `mensajeMotor`) y no cambia el JSON de
`POST /api/agent`.

### Decisiones D, F y G — espera del permiso de ubicación (AC2/AC3)

`obtenerUbicacion` separa fases según el estado del permiso:

- **Concedido (`granted`):** la posición se acota a **2 s** (`UBICACION_ESPERA_MS`);
  si no llega, la consulta sigue sin coordenada.
- **Pendiente (`prompt`):** anuncia «Esperando permiso de ubicación… Toca para
  cancelar» y espera con una **cota total de 15 s**
  (`UBICACION_PERMISO_ESPERA_MS`, decisión F), porque el `timeout` de
  `getCurrentPosition` no cuenta el aviso de permiso. Al vencer, la pregunta
  sigue SIN coordenada y `busyRef` se libera; el aviso NEUTRO «No recibí permiso
  de ubicación a tiempo.» se antepone al TEXTO y a la VOZ de la respuesta de esa
  pregunta, en una sola locución (no una segunda locución ni cola, para no
  interferir con la identidad de locución de E), tras la revalidación (`sanear`)
  y solo si la pregunta sigue vigente (G1/H1). El aviso es neutro a propósito
  (R5-2): no pide el origen, porque la propia respuesta ya lo pide cuando hace
  falta (un viaje sin origen) y con «dónde estoy» no tendría sentido pedirlo, así
  no suena raro ni repite la petición. Es cancelable
  con un toque en cualquier momento. La petición de posición queda viva: esa
  pregunta no la usa, la siguiente sí.
  **Actualización (EA-07 #33):** esta política cambió. La adquisición ahora usa
  `watchPosition` + `clearWatch` de una toma y se LIBERA al vencer o cancelar, en
  vez de quedar viva; ver `docs/expoandes/ea-07-gps-precision.md`, §4.
- **Denegado (`denied`) o aborto durante `permissions.query`** (decisión G):
  resuelve sin coordenada de inmediato, sin anunciar espera ni pedir la posición.
  Se comprueba `señal.aborted` justo tras resolver la consulta de permiso.

`busyRef` nunca queda bloqueado indefinidamente: lo liberan el toque de
cancelación, la cota de 15 s del permiso pendiente, o el fin de la consulta.

### Esperas acotadas y pausas retiradas (AC2)

- **Modelo (servidor):** `lib/ollama.ts` baja la espera de 8 s a **2 s**, con
  respaldo inmediato a las reglas. **Actualización (EA-27, #53):** la espera es
  ahora de **4,5 s**; ver «Plazos elegidos y por qué».
- **Cliente:** `lib/consulta-agente.ts` añade una **espera máxima de 6 s** con
  `AbortController` para `/api/agent`. Con datos cargados y servidor que tarda,
  falla, devuelve error o JSON inválido, el intérprete de reglas resuelve en el
  navegador dentro del plazo; sin catálogo, un aviso recuperable. Un fallo que
  **no** es aborto (p. ej. catálogo corrupto) no se traga: avisa de forma
  recuperable y vuelve a reposo.
- **Pausas artificiales retiradas:** se eliminaron `STEP_DELAY_MS` (450 ms/paso)
  y `NAVIGATE_DELAY_MS` (2,5 s). El texto, la voz y la apertura ocurren sin
  demora. Queda el arranque de la escucha: `ESCUCHA_ESPERA_MS` (650 ms) en el
  asistente y `ESCUCHA_ESPERA_SUPERPOSICION_MS` (900 ms) en la superposición,
  compartidos desde `hooks/use-speech.ts` (un solo lugar). La superposición usa
  900 ms porque su anuncio inicial es más largo. **No se ha medido** que basten
  para toda la locución; son márgenes iniciales, no garantías, y están en el
  arranque de la escucha, no en el camino de la respuesta.

### Accesibilidad y voz (AC3/AC4, N5)

- El `aria-label` del botón principal es dinámico: «Asistente de voz. Toca para
  hablar…» en reposo, y «Cancelar. Toca para detener la escucha o la respuesta
  en curso.» mientras escucha o piensa.
- La superposición **aborta** al cerrar, descarta `onresult`/`onerror` tardíos
  (`abiertaRef`), arranca una vez por apertura y no reinicia tras `no-speech`;
  `handleError` ignora `"aborted"`, así «Detener» no reporta un error falso.
- `useSpeech`: `start`/`abort` del reconocimiento son estables (leen
  `escuchandoRef`), para que la superposición no reprograme la escucha.
- Avisos de privacidad por pantalla (breves, `role="note"`, antes del
  formulario), cada uno dice lo que esa pantalla envía. El del asistente: el
  audio del reconocimiento puede ir a un servicio del navegador (no es
  necesariamente local); la frase viaja al servidor y, si está activo, al modelo;
  la ubicación es OPCIONAL (puedes decir o escribir el origen) y, si preguntas
  dónde estás o cómo llegar sin origen, se envía a este servidor; al abrir Google
  Maps se comparte el origen. El de la superposición: la búsqueda es local con
  los datos cargados, la frase no se envía al servidor; solo el audio del
  reconocimiento puede salir. Hay alternativa por texto.

## Plazos elegidos y por qué

| Plazo | Valor | Motivo |
| --- | --- | --- |
| Espera del modelo (servidor) | 4,5 s | Con respaldo a las reglas al agotarse. Eran 2 s, con el modelo consultado solo si las reglas no entendían (EA-08). EA-27 (#53) la subió el 10/11/2026 por decisión de A1: de 8 consultas medidas desde Render, una agotó los 2 s (ver `ollama-tunel-feria.md`). Deja 1,5 s de margen bajo la espera del cliente. |
| Espera máxima del cliente por `/api/agent` | 6 s | Más que el modelo (4,5 s) y menos que `maxDuration` (30 s). El servidor puede tardar más (p. ej. tras un reinicio); al vencer, el cliente responde con reglas locales. No se compara con el techo de datos (`LAYER_TIMEOUT_MS = 15 s`): esa es la espera de `/api/transmilenio`, y los datos ya están cargados cuando se pregunta. |
| Posición con permiso concedido | 2 s | Acota `getCurrentPosition` tras el permiso; al vencer, se sigue sin coordenada. |
| Cota del permiso pendiente | 15 s | `UBICACION_PERMISO_ESPERA_MS`: tope total con el permiso en `prompt`; al vencer se sigue sin coordenada y se libera `busyRef`. Cancelable con un toque. |
| Arranque de escucha | 650 ms / 900 ms | Separa el anuncio del inicio de la captura. No medido como suficiente; margen inicial. |

**Peor caso de la primera consulta con ubicación** (permiso aún sin conceder):
la espera del permiso pendiente está acotada a 15 s (cancelable con un toque en
cualquier momento, y `busyRef` libre al vencer); después, la consulta tiene su
espera de 6 s (con el modelo ≤ 4,5 s dentro). El peor caso total aproximado es
**≈ 15 s + 6 s** antes de caer al respaldo local; con el permiso ya concedido,
≈ 2 s + 6 s. Son sumas nominales, no mediciones de dispositivo. Si el permiso se
concede más tarde, esa pregunta no lo usa; la siguiente sí (la posición queda
cacheada). **Actualización (EA-07 #33):** la adquisición ya no queda viva tras
vencer/cancelar; se libera con `clearWatch` (ver `ea-07-gps-precision.md`).

## Mediciones

Medición por etapa del texto local con datos cargados, corpus español de 20
frases (`lib/ea08-medicion.test.ts`), 15 repeticiones por frase y etapa
(n = 300), tras calentamiento. **Herramientas y respuesta se miden JUNTAS** en
`runIntent` (catálogo + plan + texto). **No** incluye `sanear`/validación del
esquema del cliente ni el manejador del endpoint.

**Máquina:** Linux x64, Intel Core i5-9300H @ 2.40 GHz, 8 hilos, 15,4 GB RAM,
Node v26.13.0 (CI usa Node 24; mismo orden de magnitud). Valores observados en
esta ronda (dependen de la máquina; no son contrato):

| Etapa | p50 | p95 |
| --- | --- | --- |
| Interpretación (`parseIntent`) | ~0,04 ms | ~0,1 ms |
| Herramientas + respuesta (`runIntent`, juntas) | ~0,002 ms | ~50 ms |
| Texto local completo | ~0,02 ms | ~45 ms |

Objetivo propuesto por la auditoría —p95 ≤ 500 ms para texto local con datos
cargados— cumplido con amplio margen; la etapa dominante es `planTrip` (124
rutas). La prueba usa un umbral holgado (≈10×) para no ser frágil en CI.

## Evidencia

Pruebas con reloj y proveedor (`fetch`/Ollama) simulados, sin dependencias
nuevas, `node:test`:

- `lib/ea08-reglas-cancelacion.test.ts`: endpoint real `POST /api/agent` con el
  `/api/chat` de Ollama simulado (con el modelo cargado, un comando conocido
  se consulta al modelo (EA-27; en EA-08 eran 0 llamadas); `unknown` del modelo
  no anula regla; modelo colgado → reglas en ~4,5 s);
  **decisión B** (el modelo resuelve `gps`/viaje sin coordenada → camino de falta
  de ubicación/origen); política pura y respaldo/cancelación de `consultarAgente`.
- `lib/ea08-cancelacion-ui.test.ts`: TSX real de `TotalAgent`/`VoiceOverlay` con
  reloj simulado. Para **E** usa el gancho `useSpeech` REAL con una síntesis tipo
  Chrome cuyo `cancel()` entrega los eventos `error` de forma ASÍNCRONA: cubre
  salir con la respuesta propia sonando, una segunda pregunta rápida o escrita
  durante el saludo y salir, `changeMode` del padre que no se corta, y la
  respuesta que navega que no se cancela. Además **R1** (salir con `fetch` que
  ignora la señal), **R3** (toque en «Pensando…» aborta y libera `busyRef`),
  **M13** (fallo no-abort → aviso recuperable), **D/F** (concedido 2 s; pendiente
  anuncia, 15 s de cota, cancelable), **G** (cancelar durante `permissions.query`
  y permiso denegado no anuncian espera), **M16** (una frase `unknown` no pide ni
  adjunta la ubicación, ni la de caché), **R2** (gancho+superposición reales no
  reinician tras `no-speech`), AC2 (sin pausas), cerrar aborta, y el `aria-label`
  dinámico (**N5**).
- `lib/ea08-diagnostico.test.ts`: **decisión C** (`mensajeMotor` por salud GET;
  modelo sano no afirma fallo; caído o sin modelo sí avisa) y el cableado de
  `components/diagnostics.tsx` a `mensajeMotor`.
- `lib/ea08-medicion.test.ts`: medición por etapa (arriba).

**Mutaciones** (revertir el arreglo → falla la prueba que lo cubre → restaurar):

| Mutación | Prueba que falla |
| --- | --- |
| M2 `vigente = () => true` | R1 (salir con fetch que ignora la señal) |
| M6b `start` vuelve a depender de `listening` | R2 (gancho+superposición reales) |
| M8 `stopListening` no aborta el controlador | R3 (toque en «Pensando…») |
| M11 el toque no libera `busyRef` | R3 (la pregunta nueva ya no consulta) |
| M13 se quita el aviso recuperable | M13 |
| M16 se adjunta la coordenada en caché para `unknown` | M16 |
| E-M1 quitar la comprobación de «última locución» | E `changeMode` (el anuncio de modo se corta) |
| E-M2 `terminar` borra la ref sin comprobar identidad | E segunda pregunta / E saludo (el error tardío desmarca) |
| E-M3 sin la marca `navegoPorRespuestaRef` | E «la respuesta que navega no se cancela» |
| F quitar la cota de 15 s del permiso pendiente | F (a los 15 s la consulta no se lanza) |
| G no comprobar aborto tras `permissions.query` | G «cancelar durante query» |
| G tratar `denied` como `prompt` | G «permiso denegado» |
| C `mensajeMotor` afirma fallo con modelo sano | ea08-diagnóstico |
| 2a `alVencer` vacío (no marca `permisoVencido`) | F (la respuesta no lleva el aviso de permiso vencido) |
| 2b sin prefijo (`textoFinal = seguro.reply`) | F (la voz no empieza por el aviso) |
| 2f prefijo sobre `reply.reply` crudo (sin `sanear`) | H1 (se diría la prosa con orden de abordaje) |
| 3 quitar la escucha del aborto en la espera del permiso | D permiso PENDIENTE (queda el temporizador y reaparece el aviso) |
| R5-1 quitar la cláusula «la ubicación se envía al servidor» del aviso | R5-1 (contenido del aviso de privacidad) |

### Cuatro puertas sobre el código final

- `pnpm exec tsc --noEmit`: salida 0.
- `pnpm test`: **206** pruebas correctas, 0 falladas.
- `pnpm build`: salida 0.
- `pnpm verificar http://127.0.0.1:3108` contra el servidor compilado
  (`pnpm start -p 3108` con `setsid`, Chrome `/opt/google/chrome/chrome`,
  `APP_PASSWORD` de `.env.local` sin imprimirla, 3108 libre antes): salida 0,
  **9 de 9** diagnósticos. Se terminó solo el grupo de procesos lanzado.

## Límites

- Los dobles de React, red y reconocimiento no son evidencia de hardware ni de
  voz real; no se probó reconocimiento real, VoiceOver, micrófono físico ni
  recorrido en calle.
- En EA-08 la espera del modelo era un presupuesto propuesto de 2 s, sin
  medición del Ollama real. Desde EA-27 (#53) es de 4,5 s, medida contra el
  Ollama real el 10/11/2026: de 8 consultas desde Render, una agotó los 2 s y
  las otras tardaron entre 0,8 y 2,5 s en total. Deja 1,5 s de margen bajo los
  6 s que espera la web. El `warmUpOllama` del servidor usa su propio plazo de
  60 s para la precarga, fuera del camino de respuesta.
- **Decisión B:** una frase que solo el modelo resolvería como `gps`/viaje sin
  origen pierde la ubicación (no se adjunta para `unknown`). Es la contrapartida
  directa de AC4; el servidor responde pidiendo origen o permiso.
- **Decisiones D/F/G:** la espera del permiso pendiente está acotada a 15 s y es
  cancelable con un toque; `busyRef` nunca queda bloqueado. El peor caso total
  (≈ 15 s + 6 s sin conceder, ≈ 2 s + 6 s concedido) es una suma nominal, no una
  medición de dispositivo. Con permiso concedido pero primera fijación lenta
  (> 2 s), esa consulta sale sin coordenada y pide origen; si el permiso se
  concede tras vencer la cota, esa pregunta no lo usa y la siguiente sí.
- La **confirmación audible ≤ 1 s** del criterio 5 **no se midió**: el código
  dice «Te escucho» antes de cualquier espera, pero no hay medición de latencia
  hasta oírla; queda parcialmente cumplido y pendiente de medición en dispositivo.
- Las mediciones son del texto local con datos cargados, en la máquina indicada;
  no incluyen reconocimiento, red, síntesis ni arranque frío de Render. Sin logs
  de audio, frases completas de personas reales ni posición precisa.
- La prueba PowerShell del instalador permanece en CI; no hay `pwsh` local. No se
  tocaron workflows ni el script de verificación.
