# EA-12: firmware BLE del accesorio, seguridad y guion de banco

Estado al **7 de noviembre de 2026**. Issue: [#38](https://github.com/ZuluCode777/proyecto-1-APP/issues/38). Este documento describe el **software** de EA-12 (`firmware/accesorio/accesorio.ino` y `enlace_accesorio.h/.cpp`) y deja el **guion de banco**. **No hay mediciones ni enlace probado**: nadie ha cargado el firmware en una placa, energizado el radar ni emparejado un iPhone. Que el sketch compile **no prueba** el radar, el enlace, la seguridad ni los pines. EA-12 **sigue abierta**: los criterios que exigen hardware están pendientes (tabla del final).

Manda el [contrato BLE v1.0](contrato-ble.md) (no cambia aquí: ni sus bytes, ni su versión, ni los vectores). El intérprete del radar es [EA-11](ea-11-radar.md). Donde el [plan de firmware](plan-firmware.md) difiere, valen el contrato y este documento.

## Qué hace

- **Servicio y tramas.** Servicio `e13a0000-76b8-4fb0-9d2b-8c4f8d8a7e31`, Información `…0001` (lectura, 20 bytes) y Medición `…0002` (lectura y notificación, 20 bytes). Las tramas las codifica `trama_ble` a través de `EmisorSintetico`, que conserva su nombre histórico pero es el codificador de verdad: lo usan el sintético y el real.
- **Capacidades reales.** Información con capacidades `0x0000` (sin distancia, azimut ni batería), perfil `1`, periodo 100 ms, caducidad 500 ms y la ventana configurada del radar en mm (hoy `0`/`3000`, la de fábrica del fabricante, sin ensayo). Presencia dentro de una ventana: nunca distancia ni azimut. `SinBlanco` es «sin detección en este momento», nunca «camino libre».
- **Identificador de arranque** aleatorio (`esp_random()`) y distinto del anterior, que se guarda en NVS. Si la fuente no lo logra en 8 intentos, el BLE no arranca.
- **Lectura fresca.** Cada lectura de Medición genera una trama **nueva** (secuencia +1 e instante propio) en el callback `onRead`; nunca devuelve la última notificada. Si no puede generarla, devuelve longitud 0, que el cliente rechaza.
- **Notificaciones acotadas.** A lo sumo una cada 100 ms, desde la suscripción; tras un hueco no se recuperan en ráfaga. La secuencia sube con cada trama generada (lecturas incluidas), también sin blanco o con fallo.
- **Suscripción.** Un booleano por conexión, no un contador: suscribir dos veces no duplica nada. La reconexión empieza sin suscripción ni datos; si el stack restaura la suscripción de un vínculo, se acepta una sola, y solo con el enlace protegido.
- **La única escritura es el CCCD.** Las dos características no tienen propiedad de escritura; no hay comandos, texto, umbrales ni actualización remota (contrato §1).
- **Radar autónomo.** `loop()` lee la UART, alimenta el intérprete de EA-11 y envía sus órdenes **en cada ciclo (2 ms)**, haya cliente, suscripción o autorización BLE, o no. Con la clave sin provisionar la UART también funciona y se diagnostica por el puerto serie. La salud sale del radar sin red, servidor ni IA.
- **Fallo del radar.** `Interprete::entrada()` entrega `Fallo` con la salud (1 iniciando, 2 sin trama válida en 2500 ms, 3 trama inválida, 4 `Error` o sin respuesta, 6 configuración no válida). Sin pines elegidos, el firmware publica salud `6` sin abrir la UART. Salud `5` (alimentación) no la produce nadie: no hay medición eléctrica.
- **UART 2500 ms, GPIO2 no usado.** El latido es la trama `$JYBSS` completa (≤ 2500 ms). El pin GPIO2 del sensor **no se lee**: sigue provisional hasta B2. Con la UART a 1 Hz, la edad del resultado supera 500 ms cerca de la mitad del tiempo y esas tramas salen como vencidas (bit 0 en cero): es el conflicto del contrato §7, no un defecto. La edad que se publica es la **real** de la última trama recibida; consultar o reemitir nunca la rejuvenece.
- **Nada retenido por conexión.** `entrada_para_sesion()` descarta, para una conexión nueva, toda observación recibida antes de conectar (o en el mismo milisegundo): sale como resultado vencido hasta que llegue una trama UART **posterior** a la conexión. Un fallo se publica tal cual (la salud es el estado actual, no un dato retenido).
- **Simulación distinguible.** `-DVISIONARIA_SIMULACION=1` genera presencia sintética alterna cada 2 s con el bit 5 activo y anuncia `Visionaria-SIM`; no combina con pines del radar (error de compilación). La compilación real anuncia `Visionaria` y nunca activa el bit 5.
- **Versión.** Contrato 1.0; firmware 0.1.0 (Información, bytes 8 a 10).

## Seguridad

Todo esto está configurado en el **stack NimBLE** del núcleo, no solo en banderas del módulo portátil. `enlace_accesorio` decide con lo que el stack le informa; no lo sustituye.

| Capa | Qué hace el firmware |
| --- | --- |
| Emparejamiento | `setCapability(ESP_IO_CAP_OUT)` (solo pantalla), `setAuthenticationMode(bonding, mitm, sc) = (true, true, true)` y `ble_hs_cfg.sm_sc_only = 1`: LE Secure Connections con protección MITM por clave de 6 dígitos y vínculo. No hay Just Works. |
| Permisos GATT | Información y Medición con `PROPERTY_READ_ENC \| PROPERTY_READ_AUTHEN`: lectura solo con enlace cifrado y autenticado. (En NimBLE `setAccessPermissions()` no hace nada; la protección son estas banderas, y un `#error` impide compilar con otro stack.) |
| Sesión | `seguridad_suficiente()` exige cifrado, autenticación, vínculo y clave de 16 bytes sobre `ble_gap_conn_desc.sec_state`. Se evalúa al autenticar, al suscribir y **en vivo antes de cada notificación**. Sin ella: no se suscribe, no se notifica y se corta. |
| Plazo | Una conexión sin proteger se corta a los 30 s. |
| Un cliente | Con una conexión activa no se anuncia; se retoma al desconectar. |
| Alta | Botón físico: pulsación de 3 a 10 s abre la ventana **60 s**; la ventana cierra al emparejar con éxito, al cumplirse el plazo (también con vuelta del reloj de 32 bits), al borrar vínculos y al reiniciar. Fuera de la ventana el stack usa una clave **aleatoria desconocida**, así que ningún emparejamiento nuevo puede terminar; la clave provisionada solo se aplica mientras la ventana está abierta. |
| Borrado | Pulsación de 10 s o más: `ble_store_clear()` (todos los vínculos), cierra la ventana y corta la conexión. Las acciones se deciden **al soltar**; un botón atascado no hace nada. |

**Clave provisionada, fuera de Git.** La clave de 6 dígitos sale de `VISIONARIA_CLAVE_ENLACE` en `firmware/accesorio/configuracion_local.h` (ignorado por Git) o de una bandera de compilación. El repositorio solo trae `configuracion_local.ejemplo.h` con el procedimiento. Sin clave válida (o con una trivial: `000000`, `123456`, `654321`, dígitos repetidos), el sketch **no compila** o, si falta, **no arranca el BLE** y lo dice por el puerto serie (falla cerrado). La clave no se imprime ni se escribe en el repositorio, issues o chat. Quien prepara el accesorio la genera con el generador del sistema y la guarda donde guarda sus secretos.

### Límites declarados

- **Clave estática y reutilizable.** El accesorio no tiene pantalla ni teclado: la clave es fija por unidad. En LESC con clave, un intermediario que provoque emparejamientos fallidos repetidos durante una ventana abierta aprende la clave bit a bit. La ventana de 60 s con presencia física reduce la exposición, no la elimina. Si se sospecha una filtración: clave nueva, recompilar, cargar y borrar vínculos.
- **Repetición de emparejamiento de la biblioteca.** Si un par ya vinculado intenta emparejar de nuevo, la biblioteca borra el vínculo viejo antes de que el emparejamiento falle (con la ventana cerrada, falla). Un atacante que suplante la dirección de un par vinculado puede así **borrar ese vínculo** (denegación de servicio), no leer datos. Se recupera abriendo el alta. No se parcha la biblioteca.
- **CCCD sin cifrado propio en NimBLE.** El stack deja escribir el CCCD sin cifrado. La defensa es del firmware: ignora la suscripción de un enlace sin proteger y nunca notifica sin comprobar el enlace en vivo. El cliente debe leer Información (que fuerza el emparejamiento) **antes** de suscribirse, como ya exige el contrato §5.1; una suscripción anterior al emparejamiento se ignora y no se reaplica.
- **Denegación de servicio por radio.** Un dispositivo que conecte y no autentique ocupa el cupo hasta 30 s; el bloqueo de radio no se puede evitar. Ni el cifrado ni la versión evitan esos fallos; ninguno equivale a «sin obstáculos».
- **`sec_state.bonded`.** Se exige que el stack lo marque. No se ha comprobado **cuándo** lo marca respecto del evento de cifrado; si lo hiciera tarde, el enlace quedaría sin notificaciones (falla cerrado) y habría que verlo en banco.
- **Qué evidencia afirma `cifradoAutenticado` en iOS** sigue pendiente (contrato §6): Core Bluetooth no expone el nivel. La capa de iOS es EA-15 y no está aquí.
- **Un pulsador activo en bajo y la clave de ejemplo** son supuestos de montaje que quien arma el accesorio confirma.

## Pines y hardware: nada sin selección humana

Los pines exactos de la placa recibida **no están verificados**. El firmware no trae pines por defecto: cada hardware se habilita solo si alguien define su macro.

| Macro | Si falta |
| --- | --- |
| `VISIONARIA_PIN_RADAR_RX` y `VISIONARIA_PIN_RADAR_TX` (juntos) | No abre la UART; salud `6`. |
| `VISIONARIA_PIN_BOTON` | La ventana de alta nunca se abre: nadie puede emparejar. |
| `VISIONARIA_CLAVE_ENLACE` | El BLE no arranca. |

Al compilar se rechazan los pines de arranque (0 excepto como botón, 3, 45, 46), USB (19, 20), consola (43, 44), inexistentes, flash y PSRAM (22 a 37) y los fuera de 0 a 48; RX y TX distintos; el botón distinto de los del radar. Es una lista de exclusión basada en el plan de firmware y las hojas de datos de Espressif: **un pin permitido no está probado** en la placa. Los pines de los jobs de CI (`4`, `5`, `0`) son de ejemplo para compilar la rama de hardware y **no son la selección real**. Primera conexión del radar: sigue [plan-firmware.md](plan-firmware.md#conexión-eléctrica) (3V3, masa común); no se energiza nada hasta revisar el cableado.

## Integración con EA-11

El único punto de contacto con el intérprete es `atender_radar()` en `accesorio.ino`, que usa solo la API pública de [ea-11-radar.md](ea-11-radar.md): `procesar`, `salida_pendiente`, `salida_enviada`, `entrada`, `salud`, `fase`, `contadores`, `ventana_minima_mm`/`ventana_maxima_mm` y `reiniciar`. Si esa API cambia, es el único sitio que hay que revisar.

- Cada ciclo lee como máximo 256 bytes y los entrega con `millis()`; llama a `procesar` también con `n == 0`. Si en la UART quedan más de 256 bytes esperando, **todo lo leído en ese ciclo se descarta** en vez de entregarse como reciente (y se cuenta en `descartados`): perder esas tramas es seguro, rejuvenecerlas no. Puede quedar una línea partida, que el intérprete cuenta como inválida.
- La UART se vacía antes de `reiniciar()` al arrancar. El firmware **no** llama a `reiniciar()` después: un fallo de configuración `Error` o un radar mudo se quedan en su salud hasta reiniciar la placa (cada `saveCfg` escribe la flash del sensor).
- Los callbacks BLE y `loop()` comparten el intérprete bajo un mismo cerrojo (FreeRTOS), y `millis()` se lee dentro de él para que el reloj del intérprete no decrezca.
- Cada 5 s el puerto serie imprime una línea `estado …` y, con radar real, una línea `uart …` con los contadores (válidas, parciales, largas, otras, ignoradas, errores, timeouts, descartados). Es la bitácora de banco; no lleva datos personales ni la clave.

## Compilar

Núcleo de Espressif **3.3.12** (existe en el índice oficial; comprobado el 7 de noviembre de 2026), ESP-IDF 5.5.5 según el plan, placa `esp32s3`, y **NimBLE** como stack de BLE (no hay biblioteca nueva). `arduino-cli` **1.5.1**.

```bash
URL=https://espressif.github.io/arduino-esp32/package_esp32_index.json
arduino-cli core update-index --additional-urls "$URL"
arduino-cli core install esp32:esp32@3.3.12 --additional-urls "$URL"
arduino-cli compile --fqbn esp32:esp32:esp32s3:FlashSize=16M firmware/accesorio
```

Con `FlashSize=16M` y el esquema de particiones por defecto, la aplicación dispone de 1 310 720 bytes; el firmware real usa unos 576 000 (43 %), la compilación sin pines ni clave unos 286 000 (21 %) y la de simulación unos 574 000 (43 %). La PSRAM queda desactivada. El núcleo completo ocupa unos 6 GB; el job de CI conserva solo lo del ESP32-S3 (unos 2 GB, borrando las cadenas de otros chips) y lo guarda en caché.

Variantes (banderas de compilación o `configuracion_local.h`), por ejemplo:

```bash
arduino-cli compile --fqbn esp32:esp32:esp32s3:FlashSize=16M \
  --build-property "compiler.cpp.extra_flags=-DVISIONARIA_SIMULACION=1 -DVISIONARIA_PIN_BOTON=0 -DVISIONARIA_CLAVE_ENLACE=<6 dígitos>" \
  firmware/accesorio
```

Cargar y ver el puerto serie son pasos de banco, con la placa en la mano; este trabajo no cargó nada. El CI (`contrato-ble.yml`, job `sketch`) compila la configuración sin pines ni clave, la de radar real y la de simulación, y comprueba que **fallan** un pin vetado, una clave trivial y la simulación con pines del radar. Usa una clave descartable por ejecución, enmascarada y nunca cargada.

## Pruebas del portátil

```bash
make -C firmware probar               # codificador, vectores EA-04 y parser EA-11
bash firmware/pruebas/probar_enlace.sh  # EA-12: sesión, alta, botón, ritmo, pines, seguridad
python3 firmware/herramientas/analizar_captura.py --autoprueba
```

`pruebas_enlace.cpp` (20 000 comprobaciones; casi todas son el barrido de ritmo) cubre: clave y pines; identificador de arranque (fuente atascada, cero, igual al anterior); Información del SEN0395; «nada retenido» (borde de 1 ms, edad desconocida, vuelta del reloj, fallo que pasa tal cual); simulación y salud 6; lectura fresca; ventana (59 999/60 000 ms, vuelta del reloj, reloj que retrocede, cierre sin reapertura); botón (umbrales, rebote, una sola acción al soltar, vuelta del reloj); seguridad (sin cifrado, sin MITM, sin vínculo, clave corta); suscripción (rechazo sin protección, idempotencia, pérdida de protección, reconexión sin herencia, evento duplicado); ritmo (100 por 10 s, sin ráfagas ni acumulación, bloqueo de 2 s, vuelta del reloj); plazo de 30 s; y, con el **intérprete real** de EA-11, conexión nueva sin observación previa, edad real (10, 500, 501 ms), estancamiento a salud 2, reconexión y un ciclo bloqueado que no rejuvenece bytes.

**Lo que estas pruebas no son.** No prueban NimBLE, el emparejamiento, los permisos GATT, el cifrado, `sec_state`, el CCCD, la UART ni el radar. Son lógica y tramas escritas a mano.

## Guion de banco (pendiente; lo ejecuta H3 con H1)

Antes: cableado revisado por una persona, pines elegidos en `configuracion_local.h` y clave generada (ver la plantilla). Registrar commit, versión del núcleo, FQBN, placa, versión de iOS y del iPhone en un CSV sin datos personales.

1. **Arranque sin selección.** Cargar la compilación por defecto. Esperado: por el serie, «sin pines» y «sin clave»; el radar no se toca; no se anuncia BLE.
2. **Simulación.** Cargar `-DVISIONARIA_SIMULACION=1` con botón y clave. Mantener el botón 4 s, emparejar desde el iPhone o `bluetoothctl` con la clave, leer Información y suscribirse. Esperado: tramas con bit 5 y nombre `Visionaria-SIM`. Intentar emparejar con la ventana cerrada: debe fallar.
3. **Seguridad.** (a) Sin emparejar, leer Información y Medición: deben fallar con «autenticación insuficiente». (b) Intentar emparejar como «Just Works» (herramienta que anuncie sin entrada ni salida): debe fallar. (c) Escribir en las características: debe fallar. (d) Suscribirse sin vínculo: no deben llegar notificaciones. Registrar cada resultado; si alguno pasa, es un hallazgo de seguridad.
4. **Vínculo.** Reiniciar la placa y el iPhone: reconexión sin ventana abierta. Pulsar 10 s: vínculos borrados, la reconexión falla.
5. **Radar real** (solo tras B0/B1 de [EA-11](ea-11-radar.md)). Cargar la compilación real y comprobar `uart …` sin errores; presencia dentro y fuera de la ventana; `sin blanco` no se presenta como libre.
6. **Fallos.** Desconectar el TX del radar: salud 2 en ≤ 2,5 s con el BLE conectado y con el BLE apagado. Reiniciar el radar: salud 2 y, hasta reiniciar la placa, sin recuperación automática (límite conocido). Reiniciar la ESP32: identificador de arranque nuevo y secuencia en 0; el iPhone debe releer Información.
7. **Reconexión.** Cortar y recuperar el enlace 20 veces: una sola suscripción por conexión, sin tramas de la conexión anterior, la primera trama vigente llega solo tras una trama UART posterior a la conexión.
8. **Mediciones del criterio 5 del issue.** Capturar ≥ 10 min de notificaciones en un CSV `t_host_ms,hex` y ejecutar `python3 firmware/herramientas/analizar_captura.py captura.csv`: frecuencia, pérdidas por huecos de secuencia, intervalos (mediana y p95), deriva de relojes y reparto de salud. Para la **latencia** no hay reloj común: usar una señal física visible (persona que cruza una marca) filmada junto al registro del equipo, o un pulso de GPIO de la placa, y documentar el método y su incertidumbre. Para el **consumo**, un medidor USB en serie con la placa, con BLE activo y sin él. Nada de esto está medido.

## Estado de los criterios de #38

| Criterio | Estado |
| --- | --- |
| Contrato versionado, capacidades reales, notificaciones acotadas, secuencia, salud; fixture y sensor real distinguibles | Software hecho y probado en el portátil; **falta verlo en la placa**. |
| Selección y protección acordadas; datos o configuración inválidos no se aceptan | Configurado en el stack NimBLE y probada la lógica; **falta comprobar en la placa con un iPhone** (pasos 2 a 4). |
| Pérdida de enlace, reinicio de ESP32 y del radar, reconexión sin suscripciones duplicadas ni mediciones previas | Lógica probada en el portátil; **falta banco** (pasos 6 y 7). El reinicio del radar sin reiniciar la placa **no recupera** (límite). |
| Ausencia de mediciones nuevas anunciada; sin detección no es «camino libre»; sin servidor ni IA | Salud 2 y latido de 500 ms en el cliente; **falta banco**. |
| Medir frecuencia, pérdida, consumo y latencia | **Pendiente.** Guion y analizador listos, sin mediciones. |

## Pendiente

- **Placa y radar:** todo lo del guion. Hasta entonces, nada de esto se declara probado.
- **B2:** si el GPIO2 cambia antes que la trama. El firmware no lo usa; cuando B2 lo decida, se añade solo con `latido_vigente()` y sin tomar la edad del pin.
- **Pines y cableado:** los fija quien reciba la placa en `configuracion_local.h`.
- **Core Bluetooth y qué evidencia afirma `cifradoAutenticado` en iOS:** EA-15.
- **`sec_state.bonded` y el CCCD de NimBLE:** verificar en banco (límites arriba).
- **Reinicio del radar sin reiniciar la placa:** decidir en banco si `reiniciar()` se dispara solo; hoy no.
