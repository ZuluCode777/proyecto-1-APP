# Banco del accesorio, 12/11/2026 (en pausa; se reanuda en el paso 6)

Primer ensayo en placa real del firmware de EA-12 (PR #87) y del SEN0395. Evidencia, sin cambios en el repositorio. Las capturas de la mañana se perdieron con el reinicio del portátil (13:13, `/tmp` borrado); de esa parte queda solo lo resumido aquí. Las de la tarde están en esta carpeta.

| Campo | Valor |
| --- | --- |
| Commit | Mañana: `93ee192`. Tarde: `eeb1c85` (cabeza del PR #87; bajo `firmware/` igual a `93ee192` salvo una línea del README) |
| Main actual | PR #91 (correcciones de H1/H2/H3/S2) fusionado en main como `984b0a2` hacia las 11:47 UTC del 13/11. **La placa no lo lleva**: sus retests requieren cargar desde main. `984b0a2` **no** corrige R1, R2 ni R6 (abajo): `enlace_radar.cpp:98` sigue con `reiniciar(false)` y `sen0395.h:70-74` con 3 m y 100/400. |
| Herramientas | `arduino-cli` 1.5.1, núcleo `esp32:esp32@3.3.12` (ESP-IDF 5.5.5), `esptool` 5.3.1 |
| FQBN | `esp32:esp32:esp32s3:FlashSize=16M,CDCOnBoot=cdc` (**desviación**: `CDCOnBoot=cdc` para leer `Serial` por el USB nativo) |
| Placa | ESP32-S3-N16R8, flash 16 MB, USB nativo 303a:1001 en el portátil (Fedora) |
| Radar | SEN0395 a **3V3** con masa común; TX del radar a GPIO17, RX del radar a GPIO18 (cableado confirmado por el usuario a las 19:18) |
| Pines | `VISIONARIA_PIN_BOTON 0` (BOOT), `VISIONARIA_PIN_RADAR_RX 17`, `VISIONARIA_PIN_RADAR_TX 18` |
| Centrales | Portátil (BlueZ 5.87, `busctl`, `bluetoothctl`); iPhone con nRF Connect (modelo y versión de iOS **no registrados**) |
| Fecha y hora | 12/11/2026, 11:16–12:36 y 18:30–22:12 (UTC−5) |

## Hallazgos de seguridad (primero)

**Just Works (paso 3b): pasa con la ventana cerrada y abierta.** Portátil con agente `NoInputNoOutput` (`bluetoothctl`: `agent off`, `agent NoInputNoOutput`, `default-agent`, `pair`):
- Ventana cerrada (21:45:55): «emparejamiento rechazado (sin ventana de alta o acción no admitida)» y «enlace sin protección suficiente; se corta». BlueZ: `AuthenticationCanceled`, `Paired: no`. Con la ventana cerrada el firmware declara OOB, así que no hay método Just Works que negociar.
- Ventana abierta (21:50:33, «Alta: ventana abierta» a las 21:50:09): «enlace sin protección suficiente; se corta», sin petición de clave, `Paired: no`, `rechazados=0`: no se ofreció ningún vínculo para guardar.

**S1. Residuo de vínculo tras el borrado de 10 s: no reproducido en el código del PR.** Visto una vez en la mañana con la copia de diagnóstico (`REPEAT_PAIRING` tras «Vínculos borrados»). Por la tarde, en la compilación de simulación sin cambios, dos intentos:
- 19:07, borrar, olvidar en iOS y reconectar con la ventana cerrada: sin `REPEAT_PAIRING`; el iPhone se trató como desconocido.
- 19:12, misma secuencia con reconexiones previas con claves viejas: sin `REPEAT_PAIRING`.
Queda como observación sin reproducir.

**S2. Conexiones que el firmware no registra (H2).** Con el portátil, la conexión quedó abierta 40 s o más sin sesión y sin corte de gracia. Visto también en el código sin cambios: a las 19:13:06, dos «enlace sin protección suficiente» llegaron sin «conexión nueva». No se filtraron datos. Corregido en PR #91 según el orquestador; **sin retest en placa**.

**Segunda conexión simultánea: pasa.** Con el iPhone conectado la placa no anuncia; el portátil no la encontró y las notificaciones del iPhone siguieron (+50 cada 5 s).

Ninguna prueba de 3 a/b/c/d/f dio acceso a datos sin vínculo.

## Hallazgos del radar y su enlace (tarde)

Evidencia en `paso5-*.log`, `radar-ordenes.log` (órdenes a mano por un puente USB-UART) y `paso5-45cm-dialogo.log` (copia que refleja en el serie lo que va y viene por la UART).

**R1. `sensorStop` con el radar ya parado responde `sensor stopped already` + `Error`, y el firmware lo toma como fallo** (`sen0395.cpp:221`, rama `Error` en `Configurando`). Pasó en todos los arranques de la tarde en que el radar estaba parado. El radar queda en salud 4.

**R2. La recuperación nunca vuelve a arrancar el radar.** `enlace_radar.cpp:98` reintenta con `reiniciar(false)`: aplica `detRangeCfg` y `outputLatency` sin `saveCfg`, y el SEN0395 responde a `sensorStart` con `new parameter isn't save, can't startSensor` + `Error`, aunque los valores sean los mismos. Combinado con R1, el firmware queda en bucle de salud 2/4 hasta reiniciar la placa. Visto en vivo dos veces tras R3 (21:03 y 21:30). Con una copia que reintenta con `reiniciar(true)` la configuración se aplicó y el radar arrancó.

**R3. El radar se reinicia solo.** Imprime `..\User_code\main.c  line:232` y `reset system` y vuelve **parado**. Dos veces (21:03:10 y 21:30:11), las dos unos 20 s después de un `sensorStart`, una con movimiento delante y otra sin nada. Hipótesis: alimentación a 3,3 V, por debajo de los 3,6–5 V de la ficha (`plan-firmware.md` § Conexión eléctrica). No se pasó a 5 V: el plan exige medir antes el TX del radar.

**R4. Primer byte perdido una vez.** A las 19:55 el radar recibió `ensorStop` («is not recognized as a CLI command») y respondió `Error`. Se observó en un solo arranque.

**R5. La latencia de detección no es la que supone el firmware.** Tras `outputLatency -1 100 400`, `getLatency` devuelve `Response 0.025 10.000`. El comentario de `sen0395.h:71` supone 2,5 s / 10 s.

**R6. La ventana por defecto de 3 m deja el radar en «presencia» casi siempre** (`sen0395.h:70`, `ventana_fin = 20`). Con el código del PR, todas las tramas vigentes de la tarde fueron `$JYBSS,1`. El equipo usa ~40 cm. Unidades comprobadas: `detRangeCfg -1 0 N` en pasos de 15 cm (`getRange` da `0.000 0.450` con N = 3); `outputLatency -1 A B` con B en pasos de 25 ms. Con 0–30 cm (`detRangeCfg -1 0 2`) y 0,2 s para despejar (`outputLatency -1 0 8`), pedidos por el usuario, el radar responde como espera el equipo.

**R7. Fallos esporádicos de la UART.** Código del PR (3 m): 4 en ~21 min. Copia de 30 cm: 8 en ~38 min. Cada uno suma `perdidas` +1, `largas` +1 y `descartados` +17, y a veces se ve `salud=3` un instante; se recupera sola. Causa probable: cables de prueba.

**R8. El sketch del equipo tiene RX y TX al revés que el cableado actual** (`PIN_RX_ESP 18`, `PIN_TX_ESP 17`). El firmware lee el radar en GPIO17 y recibe tramas, así que el cableado actual es TX del radar a GPIO17. A 3,3 V el cruce no daña nada.

## Hallazgos funcionales de la mañana (BLE)

**H1. La dirección BLE cambia en cada arranque, y el vínculo de iOS no sobrevive a un reinicio de la placa.** `accesorio.ino:547` (`ble_hs_id_infer_auto(0, …)`) prefiere la dirección aleatoria que la biblioteca de Arduino genera en cada `onSync`. Con una dirección pública fija, el iPhone reconectó tras reiniciar la placa sin ventana ni clave. Visto de nuevo por la tarde: cada carga obligó a emparejar otra vez, y la placa rechazó el emparejamiento nuevo («re-emparejamiento rechazado; el vínculo se conserva») hasta abrir la ventana.

**H2.** `BLE_GAP_EVENT_CONNECT` llega con `status ≠ 0` en enlaces vivos (19, 22, 26), a veces después de `ENC_CHANGE`; `accesorio.ino:429` lo descarta.

**H3.** La gracia de 30 s cuenta desde la conexión, no desde la petición de clave. Por la tarde volvió a cortar un intento mientras se escribía la clave (19:23:12).

**H4 (menor).** El corte por gracia se imprime hasta 16 veces antes de la desconexión.

## Copia de seguridad (paso 0)

Se hizo y verificó en la mañana (16 MiB, SHA-256 `3f07c734…f320`), pero estaba en `/tmp` y **se perdió** con el reinicio del portátil. El sketch original de la placa no se puede recuperar.

## Resultados por paso

| Paso | Resultado | Evidencia |
| --- | --- | --- |
| 1. Por defecto | **Pasa** | «sin pines… salud 6», «sin clave…; no se inicia», sin anuncio BLE. |
| 2. Simulación | **Pasa** | `Visionaria-SIM`, clave incorrecta rechazada, alta con BOOT, Información correcta, Medición `0x21` (bit 5), 10 Hz. |
| 3a. Lecturas sin emparejar | **Pasa** | |
| 3b. Just Works | **Pasa** (ventana cerrada y abierta) | Ver arriba. |
| 3c. Escrituras | No concluyente | BlueZ las rechaza localmente: no hay propiedad de escritura. |
| 3d. CCCD sin cifrar | **Pasa** (portátil) | |
| 3e. Ventana cerrada con teclado | **Pasa** | |
| 3f. Re-emparejar fuera de ventana | **Pasa** | |
| 3g. Lecturas repetidas | **Pasa** (lecturas simples) | Cada lectura de Medición sin suscripción: secuencia +1. «Read Multiple» no probado. |
| Gracia de 30 s | **Pasa** iPhone / **falla** portátil (H2) | |
| 4a. Reinicio de placa | **Falla** con PR (H1); pasa con dirección fija | |
| 4a. Reinicio del iPhone | Omitido por decisión del usuario | iOS conserva los vínculos BLE; riesgo bajo. |
| 4b. Borrado de 10 s conectado | **Pasa** | |
| 4c. Borrado durante el emparejamiento | **Pasa** | |
| 5. Radar real, código del PR (3 m) | **Pasa en la UART; ausencia no observable** | Configuración aceptada, 1 Hz, `errores=0`. Medición `0x03` vigente y `0x00` vencida (edad 624/835/625 ms). Nunca `0x01` (R6). |
| 5. Radar real, copia de 30 cm / 0,2 s | **Pasa** | Sin nada delante: `0101`; con movimiento: `0103`; vencida: `0100`. «Sin blanco» nunca sale como vigente con blanco, ni una trama vencida como «sin blanco». |
| 6. Desconectar TX, recuperación | **No hecho** | Siguiente paso. R2 predice que con el código del PR no se recupera. |
| 6b. 20 reconexiones | No hecho | |
| 6c. Captura ≥ 10 min (`t_host_ms,hex`) | No hecho | El portátil no sostiene una sesión con el firmware del PR (H2); hace falta el firmware de main o una captura desde el iPhone. |
| 7. App (EA-15 T1–T11) | **No hecho** | La app del PR #87 no está instalada en el iPhone. T1–T11: todos sin hacer. |
| Trama notificada decodificada | **Hecha** | Notificación con radar: `01 03 141C 3EC88967 8AD40E00 FFFF 0080 8000 FF 00`: v1, banderas `0x03`, secuencia 7188, arranque `6789c83e`, instante 972 938 ms, distancia y azimut desconocidos, edad 128 ms, batería desconocida, salud 0. |

## Qué hay en la placa ahora

La placa está **desconectada** del portátil (su USB desapareció a las 22:12:28).

Última carga: copia de diagnóstico de la compilación **real** de `eeb1c85` (RX 17, TX 18, botón 0, clave). Cambios solo en el scratchpad:
- `sen0395.h`: `ventana_fin = 2` (0–30 cm), `latencia_deteccion = 0`, `latencia_desaparicion = 8` (0,2 s).
- `sen0395.cpp`: acepta `sensor stopped already` + `Error` como hecho en `sensorStop`.
- `enlace_radar.cpp:98`: `reiniciar(true)` (con `saveCfg`).
- `accesorio.ino`: envía `\r\n` antes de la primera orden y refleja la UART del radar en el serie.

La flash del radar guarda 0–30 cm y `outputLatency -1 0 8`. La NVS de la placa guarda el vínculo del iPhone del emparejamiento de las 21:36; por H1, la próxima carga obligará a emparejar de nuevo.

## Desviaciones

- `CDCOnBoot=cdc`.
- Pasos 2 (en parte), 3e, 3f y 4 de la mañana sobre copias de diagnóstico.
- La parte de ausencia del paso 5, 3b y la trama decodificada, sobre la copia de diagnóstico de 30 cm descrita arriba.
- Puente USB-UART de banco (`puente.ino`, sin clave) para hablar con el radar a mano.
- Bluetooth del portátil desbloqueado con `rfkill`; agente de BlueZ cambiado a `NoInputNoOutput` durante 3b (sesiones de `bluetoothctl` ya cerradas).

## Arreglos recomendados (PR aparte)

1. `sen0395.cpp:221`: en el paso `sensorStop`, aceptar `sensor stopped already` (y en `sensorStart`, `sensor started already`) como éxito.
2. `enlace_radar.cpp:98`: recuperar con `saveCfg` (`reiniciar(true)`) o sin tocar `detRangeCfg`/`outputLatency`, porque el SEN0395 no arranca con parámetros sin guardar.
3. `sen0395.h:70-74`: ventana y latencias de la feria (equipo: 0–30/45 cm, `outputLatency -1 0 8…40`), y corregir el comentario de unidades (R5).
4. `accesorio.ino:315`: enviar `\r\n` tras `Serial1.begin` antes de la primera orden (R4).
5. Alimentación del radar (R3): medir el TX con el divisor del plan y decidir 5 V; hasta entonces, R1+R2 son lo que permite recuperar un radar que se reinicia solo.
6. H1–H3/S2: ya en main (`984b0a2`), sin retest en placa.

## Pendiente, en orden

1. **Reanudar en el paso 6:** cargar la placa (ver abajo), desconectar el cable del TX del radar en GPIO17, esperar 20 s, reconectarlo, esperar 30 s. Esperado: salud 2 y luego 0 sin reiniciar la placa (con la copia de diagnóstico; el código del PR no se recupera por R2).
2. Paso 6: 20 reconexiones y captura de ≥ 10 min.
3. Cargar desde main (`984b0a2`) y repetir H1 (reinicio de placa con el vínculo), H2 (portátil) y H3.
4. Paso 7 con la app instalada (T1–T11).
5. 3c con una herramienta que escriba por el aire; «Read Multiple».

## Limpieza

- Borradas todas las copias de `configuracion_local.h` (build-radar, build-sim, build-radar-45cm, diag-45cm y el worktree). Worktree limpio. El archivo secreto de la clave se conserva para reanudar.
- La clave no aparece en ningún log, informe ni artefacto. (Un archivo ajeno de 2 MB en el scratchpad, `iosmain.txt`, contiene esos seis dígitos como fracción de una marca de tiempo; no es una fuga y no se tocó.)
- Capturas detenidas; no queda ningún proceso de captura.
