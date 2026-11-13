# Firmware del accesorio: ESP32-S3-N16R8 y SEN0395

Actualización: **6 de noviembre de 2026**. Feria: **17 de noviembre**. Este documento registra el hardware comprado y planifica el firmware. Todavía no hay código de firmware en el repositorio ni mediciones de banco. Las cifras de este documento vienen del fabricante o son umbrales de ensayo, no resultados.

## Decisión de hardware

El 6/11 Nicolás confirmó que el equipo **compró** una placa **ESP32-S3-N16R8** (16 MB de flash, 8 MB de PSRAM octal) y un radar **DFRobot SEN0395** de 24 GHz. Con eso queda elegido el hardware de EA-03 ([#29](https://github.com/ZuluCode777/proyecto-1-APP/issues/29)). La frase «ningún componente comprado» de los informes del 2/11 deja de valer; esos informes se conservan como evidencia histórica.

## Qué entrega el SEN0395

Datos de la [wiki de DFRobot](https://wiki.dfrobot.com/mmWave_Radar_Human_Presence_Detection_SKU_SEN0395), consultada el 6/11/2026:

| Aspecto | Dato del fabricante |
| --- | --- |
| Alimentación | 3,6–5 V, 90 mA. La wiki no publica el nivel lógico de la UART. |
| UART | 115200 baudios, 8 bits, sin paridad, 1 bit de parada. |
| Salida | Trama ASCII `$JYBSS,1, , , *` (presencia) o `$JYBSS,0, , , *` (nadie), a 1 Hz por defecto. El pin GPIO2 del sensor sube con presencia. **No entrega distancia ni ángulo.** |
| Ventana de detección | `detRangeCfg -1 <inicio> <fin> …`: hasta cuatro tramos, en pasos de 15 cm (índices 0–127). De fábrica, `detRangeCfg -1 0 20`, de 0 a 3 m; esa ventana dejó el radar en «presencia» casi siempre (banco del 12/11), así que el firmware fija por defecto `detRangeCfg -1 0 3` (0 a 45 cm, la de ~40 cm del equipo; `getRange` responde `0.000 0.450`). Alcance declarado: 9 m. |
| Retardos | `outputLatency -1 <al detectar> <al desaparecer>`; el segundo va en unidades de 25 ms. La wiki da por defecto 2,5 s y 10 s, pero en el banco del 12/11 `getLatency` respondió `0.025 10.000` tras `outputLatency -1 100 400`: 0,025 s al detectar y 10 s al desaparecer. El primer valor no va en unidades de 25 ms (un solo punto medido). El firmware conserva `100 400`. |
| Configuración | Solo con el sensor detenido (`sensorStop`). Después, `saveCfg 0x45670123 0xCDEF89AB 0x956128C6 0xDF54AC89` y `sensorStart`. Cada orden responde `Done` o `Error`. |
| Haz | 100 × 40°. |
| Blancos | Personas en movimiento, con micromovimiento o quietas, y «movimiento de todos los objetos» en su rango. No declara detección de objetos quietos que no sean personas. |

## El sensor de parqueo: qué demuestra y qué no

La [publicación de DFRobot Community](https://community.dfrobot.com/makelog-313340.html) (seanconway, 3/7/2023) usa un SEN0395 con un Arduino Nano para avisar al estacionar en un garaje. Fija la ventana con `_sensor.DetRangeCfg(0, 9);` (según el comentario del autor, de 0,5 a 6 m) y usa el pin IO2 para encender una tira LED a través de un MOSFET.

Demuestra que el sensor reacciona a un carro **en movimiento** que entra en una ventana configurada. No demuestra:

- **Distancia numérica.** El proyecto lee un sí o un no: hay algo moviéndose dentro de la ventana. Para avisar a 1 m se fija la ventana en 1 m, y el sensor no dice si el blanco está a 0,4 m o a 0,9 m.
- **Objetos quietos.** Todas las pruebas usaron un carro que se acercaba. No se probó un carro detenido ni una pared.
- **Exactitud o retardo.** No publica error, frecuencia de actualización ni retardo. El autor anota que el sensor tarda al menos 5 s en estabilizarse al encender.

Para el producto, el SEN0395 da un aviso de **«movimiento o persona a menos de X m»**, con X ajustable en pasos de 15 cm. No da la distancia radial que pide la puerta 1 de [puertas de hardware](puertas-hardware.md).

Hay una diferencia con nuestro uso. En el garaje el sensor está fijo y el blanco se mueve. En el accesorio, el sensor va en el cuerpo de quien camina, así que una pared también se mueve respecto al sensor. Eso podría activar la detección al acercarse a obstáculos quietos, pero también podrían activarla el suelo y los objetos laterales dentro del haz de 100 × 40°. Es una hipótesis que decide el ensayo B5, no una capacidad del sensor.

## Consecuencias para metas y contrato

**Metas físicas.** G2 (objetivos móviles) se ensaya como presencia dentro de una ventana, no como distancia. G1 (obstáculos estáticos) queda **pendiente** hasta B4 y B5.

Mantener G1 con el SEN0395 significa, en el mejor caso, que B5 muestra que caminar hacia una pared o un poste activa «algo a menos de X m» con pocas falsas alarmas del suelo. G1 pasa entonces a ser un aviso de cercanía mientras se camina. Ni en ese caso entrega el sensor un número de distancia, una dirección ni la detección de una pared con la persona quieta.

Si B4 y B5 fallan, G1 se registra en la feria como no lograda con este sensor; la [rúbrica](lectura-rubrica.md) no exige radar. El equipo decide entonces si agrega el sensor óptico de [compras](compras-bogota.md) (VL53L1X, hasta 4 m). Eso exige aprobar un diseño multimodal y presupuesto, y no se presenta como detección por mmWave. El 6/11 [Electronilab](https://electronilab.co/tienda/vl53l1x-sensor-de-distancia-tiempo-de-vuelo-30mm-a-4000mm/) (Bogotá) mostraba el VL53L1X a $31.900 con «Últimas 2 uds» y entrega el mismo día en Bogotá; Sigma no lo lista, y Mercado Libre y Vistronica no pudieron consultarse. Con dos unidades en existencia, si el equipo quiere ese respaldo conviene comprarlo antes de la decisión del 9/11.

**Contrato BLE v1.0** ([§8 del informe](investigacion-hardware-ios.md#8-contrato-ble-propuesto-versión-10)). El SEN0395 cabe en los 20 bytes sin cambiar su distribución:

- Información: capacidades `0x0000` (sin distancia ni azimut), perfil `1` (personas) y, en distancia mínima y máxima, la ventana configurada en mm. EA-04 debe escribir que, sin capacidad de distancia, esos dos campos describen la ventana de presencia.
- Medición: bit 0, hay resultado vigente del radar; bit 1, presencia dentro de la ventana; bits 2 y 3 siempre en cero; distancia `0xFFFF`; azimut `−32768`.

**Conflicto que EA-04 debe resolver.** La v1.0 fija una caducidad de 500 ms, pero la trama UART llega a 1 Hz. Con la UART, la mitad del tiempo el último resultado supera 500 ms y el iPhone lo descarta. Hay dos salidas, que se eligen con los datos de B2:

1. Leer el pin GPIO2 del sensor cada 100 ms, si B2 muestra que cambia antes que la trama. La UART queda para órdenes, diagnóstico y salud.
2. Publicar una v1.1 con caducidad mayor para el perfil de presencia. Requiere cambiar el decodificador del iPhone (A2).

**Recomendación: opción 1.** Mantiene la v1.0 sin tocar el iPhone y usa la señal más reciente que da el sensor. Si B2 muestra que el pin no cambia antes que la trama, la opción 2 tampoco mejora el aviso: solo haría aceptar datos más viejos, y el requisito de retardo queda incumplido con este sensor. Un pin quieto en bajo no distingue «nadie» de «sensor caído», así que la trama UART sigue como latido: sin trama válida en 2,5 s, salud `2` aunque el pin diga otra cosa.

**Retardo de aviso.** Con el retardo por defecto medido de 0,025 s al detectar, el retardo configurado ya no impide por sí solo la meta de p95 ≤ 300 ms del sensor al sonido; el retardo real de la trama (a 1 Hz) no se midió y lo mide B2. El firmware baja `outputLatency` al mínimo que B2 muestre estable. Si no se cumple, el requisito queda incumplido y se declara.

## Conexión eléctrica

Ninguna fuente consultada publica el nivel lógico de la UART ni del GPIO2 del SEN0395, y el equipo no tiene multímetro. Los GPIO del ESP32-S3 admiten como máximo VDD + 0,3 V (3,6 V); un TX de 5 V puede dañarlos.

- **Primera conexión: sensor alimentado desde 3V3**, como en el [ejemplo de DFRobot para FireBeetle ESP32](https://wiki.dfrobot.com/sen0395/docs/21401), que conecta VCC a 3V3 y TX/RX directo a pines del ESP32. Alimentado a 3,3 V, el sensor no puede sacar más de 3,3 V por sus pines, así que el ESP32 no corre riesgo. Masa común.
- 3,3 V queda por debajo de los 3,6–5 V de la ficha. B0 y B1 comprueban que así responde `Done`, envía tramas válidas y aguanta 30 min sin reinicios.
- Si falla con 3,3 V, pasar a 5 V solo después de medir su TX. Sin multímetro: llevar el TX a una entrada ADC1 del ESP32 a través de dos resistencias iguales (por ejemplo, 10 kΩ en serie y 10 kΩ a masa) y leer con `analogReadMilliVolts()`. La línea en reposo queda en alto; tomar el máximo de un segundo de lecturas. Un TX de 5 V se lee como unos 2,5 V y uno de 3,3 V como unos 1,65 V; ambos son seguros para la entrada. Si el TX es de 5 V, dejar un divisor en la línea de recepción (por ejemplo, 1 kΩ en serie y 2 kΩ a masa). También sirve un multímetro prestado de un laboratorio de la universidad.
- Usar un UART libre (UART1) y una entrada digital para el GPIO2 del sensor. Evitar GPIO0, 3, 45 y 46 (pines de arranque), 19 y 20 (USB), 43 y 44 (consola UART0) y 35 a 37 (PSRAM octal en módulos R8). Fijar los pines en `firmware/README.md` según la serigrafía de la placa recibida.

## Diseño del firmware

**Herramientas (propuesta).** Núcleo Arduino de Espressif (`esp32:esp32`) con `arduino-cli`. Espressif declara el ESP32-S3 soportado y estable; la versión vigente es 3.3.12 (18/9/2026, sobre ESP-IDF 5.5.5). Placa `esp32s3` («ESP32S3 Dev Module») con `FlashSize=16M`; la PSRAM no hace falta y queda desactivada. La biblioteca BLE del núcleo usa NimBLE en el S3 y no requiere dependencias externas. Los ejemplos de DFRobot son Arduino, y el equipo de hardware compila y carga sin instalar ESP-IDF. H3 confirma o cambia a ESP-IDF en el primer PR.

```bash
URL=https://espressif.github.io/arduino-esp32/package_esp32_index.json
arduino-cli core update-index --additional-urls "$URL"
arduino-cli core install esp32:esp32@3.3.12 --additional-urls "$URL"
arduino-cli compile --fqbn esp32:esp32:esp32s3:FlashSize=16M firmware/accesorio
```

No se usa la biblioteca `DFRobot_mmWave_Radar`: el protocolo son unas pocas órdenes de texto y una trama, y un intérprete propio se prueba en el portátil sin placa.

Estructura propuesta:

```text
firmware/
  README.md            versiones, pines, cableado, compilar, cargar y probar
  accesorio/
    accesorio.ino      arranque, ciclo de 100 ms, UART, GPIO y BLE
    sen0395.h/.cpp     órdenes y lectura de tramas $JYBSS, sin Arduino.h
    trama_ble.h/.cpp   Información y Medición de 20 bytes, sin Arduino.h
  pruebas/
    pruebas.cpp        pruebas en el portátil del intérprete y de los vectores
  vectores/            vectores de EA-04, compartidos con las pruebas del iPhone
```

`sen0395` y `trama_ble` no incluyen `Arduino.h`. Así compilan igual para la placa y con `g++` en el portátil y en CI.

**Comportamiento:**

1. **Arranque.** Genera un identificador de arranque aleatorio. Envía `sensorStop`, `detRangeCfg`, `outputLatency`, `saveCfg` y `sensorStart`, y exige `Done` en cada uno; si alguno falla, salud `4` (con una excepción: `sensorStop` con el radar ya parado contesta `sensor stopped already` y `Error`, y cuenta como `Done`). Mientras el sensor se estabiliza (al menos 5 s; B1 lo mide), salud `1`. Guardar la configuración en cada arranque escribe la flash del sensor; con decenas de arranques no importa.
2. **Lectura.** Lee la UART sin bloquear y acepta solo `$JYBSS,0, , , *` y `$JYBSS,1, , , *` completas. Trama parcial o desconocida: salud `3`. Sin trama válida durante 2,5 s: salud `2`. Tras un fallo nunca reutiliza el último resultado.
3. **Emisión.** Cada 100 ms toma la presencia (del pin GPIO2 si EA-04 adopta la opción 1), codifica Medición y notifica, también sin presencia o con fallo, con secuencia, instante y edad del resultado. Información se fija al arrancar.
4. **Enlace.** Servicio y UUID de §8.1. Lectura y suscripción solo con enlace cifrado. Alta con el botón BOOT (GPIO0, que puede leerse después del arranque) durante 60 s y clave fija del accesorio, según EA-12. Si la placa solo logra emparejamiento sin protección MITM, se declara ese límite.
5. **Simulación.** Una opción de compilación genera presencia sintética con el bit 5 activo, para que A2 pruebe el iPhone sin radar. La compilación de feria la deja apagada.

## Pruebas

**En el portátil y en CI.** `pruebas.cpp` cubre tramas válidas 0 y 1, trama cortada, basura, línea demasiado larga, respuesta `Error` y orden sin respuesta. También codifica los 20 bytes y los compara con los vectores de EA-04, incluidos los que el iPhone debe rechazar. Se añade a `.github/workflows/ci.yml` un job `firmware` que compila y ejecuta esas pruebas con `g++` y compila el sketch con `arduino-cli` para `esp32:esp32:esp32s3`. A1 revisa el cambio del workflow; el job web no cambia.

**Banco** (EA-11 y EA-16; H2 ejecuta, H1 registra en CSV sin datos personales):

| Ensayo | Qué mide y qué decide |
| --- | --- |
| B0 eléctrico | Sensor a 3,3 V: responde `Done`, envía tramas y aguanta 30 min sin reinicios con BLE activo. Si falla, medir el TX con el ADC antes de pasar a 5 V. |
| B1 tramas | 10 min de UART cruda: formato real, frecuencia, tiempo hasta la primera trama al encender y tras `sensorStart`, respuesta al desconectar. |
| B2 retardo | Persona entra y sale de la ventana sobre marcas en el piso. Retardo del GPIO2 y de la trama con `outputLatency` mínimo, y si el pin cambia antes que la trama. Decide el conflicto de caducidad. |
| B3 borde de ventana | Ventanas de 1,5 m y 3 m; persona camina hacia el sensor, 30 recorridos por ventana. Distancia real a la que cambia la detección. Es el equivalente medido del sensor de parqueo. |
| B4 estáticos, sensor fijo | Caja rígida y panel de madera quietos a 1, 2 y 3 m, 30 presentaciones por blanco y distancia (puerta 1). Se espera que falle; el resultado se registra igual. |
| B5 portador en marcha | Sensor en el pecho; caminar hacia una pared y un poste, y por un pasillo libre. Aciertos y falsas alarmas por suelo y objetos laterales. Decide si G1 sigue con este sensor. |
| B6 barrido de ventanas (opcional) | Tiempo de reconfigurar la ventana y si exige `saveCfg`. Solo si B1 muestra arranques rápidos. Daría distancia por tramos cada varios segundos, no apta para aviso inmediato. |

## Calendario y responsables

El trabajo cabe en los issues existentes; no hace falta abrir otros. Con una sola placa, H2 y H3 reservan turnos de banco.

| Fecha | Trabajo | Responsable | Issue |
| --- | --- | --- | --- |
| 6–7 nov | Intérprete, codificación, vectores, pruebas en el portátil y job de CI. No necesita placa; apto para agente. | H3; A1 revisa CI | [EA-04 #30](https://github.com/ZuluCode777/proyecto-1-APP/issues/30), [EA-11 #37](https://github.com/ZuluCode777/proyecto-1-APP/issues/37) |
| 6–7 nov | B0, B1 y B2 | H2; H1 registra | EA-11 #37 |
| 7 nov | Fijar capacidades, perfil, semántica de la ventana y salida del conflicto de caducidad | H3 y A2 | EA-04 #30 |
| 7–8 nov | Firmware 0.1 en placa: UART, Información y Medición por BLE. Lectura con nRF Connect o `bluetoothctl`. | H3 | [EA-12 #38](https://github.com/ZuluCode777/proyecto-1-APP/issues/38) |
| 8–9 nov | B3, B4 y B5 | H2; H1 registra | [EA-16 #42](https://github.com/ZuluCode777/proyecto-1-APP/issues/42) |
| 9 nov | Decidir si G1 sigue con el SEN0395 o se propone el sensor óptico | Equipo | EA-16 #42 |
| 9–10 nov | Enlace cifrado, reconexión, reinicio del radar, 30 min estable; firmware 0.2 | H3 | EA-12 #38 |
| 11–13 nov | Accesorio con iPhone y auriculares | A2 y H3 | [EA-15 #41](https://github.com/ZuluCode777/proyecto-1-APP/issues/41) |
| 12 nov | Congelar placa, pines, firmware y configuración del sensor | H2 y H3 | — |

## Pendientes

- EA-04: semántica de la ventana y caducidad (recomendada: opción 1).
- G1: decisión del 9/11 con B4 y B5.
- Herramientas: Arduino o ESP-IDF, confirmado por H3 en el primer PR de firmware.

## Fuentes

- DFRobot, [mmWave Radar Human Presence Detection, SKU SEN0395](https://wiki.dfrobot.com/mmWave_Radar_Human_Presence_Detection_SKU_SEN0395), con sus páginas de referencia y ejemplos para Arduino UNO y FireBeetle ESP32. Sin fecha editorial; consulta 6/11/2026.
- Espressif, [Arduino-ESP32: Getting Started](https://docs.espressif.com/projects/arduino-esp32/en/latest/getting_started.html), [Installing](https://docs.espressif.com/projects/arduino-esp32/en/latest/installing.html), [versión 3.3.12](https://github.com/espressif/arduino-esp32/releases/tag/3.3.12) y su `boards.txt`; consulta 6/11/2026.
- seanconway, [Parking Assist with SEN0395 mmWave Radar](https://community.dfrobot.com/makelog-313340.html), DFRobot Community, 3/7/2023; consulta 6/11/2026.
- Espressif, [ESP32-S3 Series Datasheet](https://documentation.espressif.com/esp32_s3_datasheet_en.pdf), versión 2.2: pines de arranque GPIO0, 3, 45 y 46; entrada alta máxima VDD + 0,3 V. Consulta 6/11/2026.
- Espressif, [ESP32-S3-WROOM-1/1U Datasheet](https://documentation.espressif.com/esp32-s3-wroom-1_wroom-1u_datasheet_en.pdf), versión 1.8: USB en IO19/IO20, UART0 en GPIO43/GPIO44 e IO35–IO37 ocupados por la PSRAM octal. Consulta 6/11/2026.
