# Firmware del accesorio (ESP32-S3-N16R8 y SEN0395)

Estado al **7 de noviembre de 2026**: hay el **núcleo portátil del contrato BLE v1.0** (EA-04), el **intérprete de la UART del SEN0395** con su recuperación (EA-11), y el **sketch con servicio BLE, seguridad y alta** sobre NimBLE nativo (EA-12), todos probados en el portátil y el sketch **compilado** para ESP32-S3. **No hay ensayo de banco**: nadie ha cargado el firmware en la placa, energizado el radar, leído su UART real ni emparejado un iPhone. Compilar no prueba nada de eso. Diseño: [plan-firmware.md](../docs/expoandes/plan-firmware.md); contrato: [contrato-ble.md](../docs/expoandes/contrato-ble.md); radar: [ea-11-radar.md](../docs/expoandes/ea-11-radar.md); BLE, seguridad y guion de banco: [ea-12-ble.md](../docs/expoandes/ea-12-ble.md).

## Qué hay

```text
firmware/
  accesorio/
    accesorio.ino            sketch: UART, GPIO y BLE sobre la API nativa de NimBLE (GAP, GATT, vínculos)
    puerta_ble.h/.cpp        política de emparejamiento, vínculos, revocación, lectura y notificación (portátil)
    enlace_radar.h/.cpp      lectura de la UART, pérdida de bytes y recuperación del radar (portátil)
    enlace_accesorio.h/.cpp  sesión, ventana de alta, botón, ritmo, pines y clave (portátil)
    sen0395.h/.cpp           intérprete de $JYBSS y de las órdenes del radar (EA-11, portátil)
    trama_ble.h/.cpp         Información y Medición de 20 bytes: codifica, decodifica
                             y valida (mismas reglas y mismo orden de errores que Swift)
    emisor_sintetico.h/.cpp  codificador de Medición desde una EntradaRadar. El nombre es
                             histórico: lo usa también el firmware real
    configuracion_local.ejemplo.h  plantilla de pines y clave (la copia real no se versiona)
  herramientas/
    analizar_captura.py      analiza una captura de Medición (frecuencia, pérdida, deriva)
  pruebas/
    pruebas.cpp              vectores de ../contratos/ble/ (EA-04)
    pruebas_sen0395.cpp      intérprete del radar (EA-11)
    pruebas_enlace.cpp       sesión, alta y seguridad (EA-12)
    pruebas_puerta_ble.cpp   política de GAP/GATT con el intérprete real del radar (EA-12)
    pruebas_radar_integracion.cpp  desborde de la UART y recuperación del radar (EA-11 y EA-12)
    probar_enlace.sh         compila y ejecuta las tres suites de EA-12 y la guardia del sketch
  Makefile                   make probar
```

Los módulos portátiles **no incluyen `Arduino.h`**, no usan excepciones ni memoria dinámica, y compilan igual con `g++` y con el núcleo Arduino de Espressif. `accesorio.ino` es lo único que toca hardware.

## Probar en el portátil

```bash
make -C firmware probar                 # EA-04 (1054) y EA-11 (594): vectores y parser
bash firmware/pruebas/probar_enlace.sh  # EA-12: enlace (21 203), política BLE (488), radar (1 019 106) y guardia del sketch
python3 firmware/herramientas/analizar_captura.py --autoprueba
```

Necesitan `g++` con C++17 (`-Wall -Wextra -Werror -pedantic`) y Python 3. Salida esperada: `N comprobaciones, 0 fallos`. Los vectores de EA-04 los ejecuta también Swift ([`ios/ContratoBLE`](../ios/ContratoBLE/README.md)). CI: [contrato-ble.yml](../.github/workflows/contrato-ble.yml). Son lógica y tramas escritas a mano, con el intérprete real del radar y un doble mínimo de la UART y del stack: no prueban NimBLE (que llame a los ganchos, el emparejamiento, el cifrado), la UART real ni el radar. El job `sketch` de CI añade un gate sobre el binario: sin el envoltorio BLE de Arduino y sin cadenas que impriman la clave (la búsqueda de cadenas se autoprueba con un binario sintético). La notificación y el borrado de vínculos corren como eventos de la tarea del host de NimBLE; la serialización se revisó contra su fuente. Falta ejecutar el enlace en banco.

## Compilar el sketch

Herramientas fijadas: `arduino-cli` **1.5.1** y núcleo `esp32:esp32` **3.3.12** (comprobado en el índice oficial el 7/11/2026), placa `esp32s3` con `FlashSize=16M`, stack **NimBLE** incluido en el núcleo (sin bibliotecas nuevas). La biblioteca BLE de Arduino solo arranca el stack; el GAP, el GATT y el almacén de vínculos son del sketch, sobre la API nativa de NimBLE.

```bash
URL=https://espressif.github.io/arduino-esp32/package_esp32_index.json
arduino-cli core update-index --additional-urls "$URL"
arduino-cli core install esp32:esp32@3.3.12 --additional-urls "$URL"   # ~6 GB instalado
arduino-cli compile --fqbn esp32:esp32:esp32s3:FlashSize=16M firmware/accesorio
```

Sin configuración local compila, pero **no habilita nada**: sin pines no abre la UART y publica salud 6; sin pin del botón no se puede abrir el alta; sin clave no arranca el BLE.

## Preparar un accesorio (con la placa sin energizar el radar)

1. `cp firmware/accesorio/configuracion_local.ejemplo.h firmware/accesorio/configuracion_local.h` (Git ignora el resultado).
2. Genera una clave de 6 dígitos con `printf '%06d\n' $(( $(od -An -N4 -tu4 /dev/urandom) % 899999 + 100000 ))` y pégala en el archivo. No la escribas en el repositorio, un issue ni un chat; el iPhone la pedirá al emparejar.
3. Fija los pines (`VISIONARIA_PIN_RADAR_RX`, `VISIONARIA_PIN_RADAR_TX`, `VISIONARIA_PIN_BOTON`) mirando la serigrafía de **la placa recibida**. Ningún pin de este repositorio está probado. El compilador rechaza los de arranque, USB, consola y PSRAM.
4. Compila y carga. Alta: mantén el botón de 3 a menos de 10 s (60 s para emparejar); 10 s o más borra los vínculos.

Compilación de simulación (presencia sintética, bit 5, nombre `Visionaria-SIM`, sin radar): `-DVISIONARIA_SIMULACION=1` más botón y clave. Otras banderas, límites de seguridad y guion de banco: [ea-12-ble.md](../docs/expoandes/ea-12-ble.md).

## Uso del codificador

```cpp
using namespace visionaria::ble;
Informacion info;                 // SEN0395: capacidades 0, perfil 1, ventana en mm
info.id_arranque = /* aleatorio por arranque */;
info.perfil = 1;
info.distancia_maxima_mm = 3000;
uint8_t trama[kLongitudTrama];
if (codificar_informacion(info, trama) != Error::Ninguno) { /* no publicar */ }

EmisorSintetico emisor(info, /*simulacion=*/false);
EntradaRadar e = radar.entrada(millis());   // sen0395::Interprete
emisor.generar(millis(), e, trama);         // edad > 500: sale "vencido", nunca vigente
```

La edad de una fuente a 1 Hz (UART del SEN0395) supera 500 ms durante cerca de la mitad de cada segundo; el emisor publica entonces el resultado como vencido. El conflicto con la caducidad de v1.0 y la opción provisional del GPIO2 están en la [sección 7 del contrato](../docs/expoandes/contrato-ble.md#7-sen0395-conflicto-de-1-hz-y-b2); **B2 sigue pendiente** y el firmware no lee el GPIO2.

## Pendiente

- **Todo lo físico:** cargar la placa, B0/B1/B2, emparejamiento con un iPhone (incluido el rechazo de Just Works, el re-emparejamiento fuera de la ventana y la restauración del vínculo), reconexión, reinicios del radar y de la placa, frecuencia, pérdida, consumo y latencia. Guion en [ea-12-ble.md](../docs/expoandes/ea-12-ble.md#guion-de-banco-pendiente-lo-ejecuta-h3-con-h1).
- **Pines y cableado:** los fija quien reciba la placa, en `configuracion_local.h`.
- **Herramientas:** el sketch ya compila con Arduino; H3 confirma Arduino frente a ESP-IDF al revisar el PR.
- **Core Bluetooth y evidencia de enlace autenticado en iOS:** EA-15.
