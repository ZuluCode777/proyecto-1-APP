# Firmware del accesorio (ESP32-S3-N16R8 y SEN0395)

Estado al **6 de noviembre de 2026**: solo está el **núcleo portátil del contrato BLE v1.0** (EA-04) y sus pruebas en el portátil. **No hay** sketch, lectura de la UART del SEN0395, GPIO, BLE ni ensayo de banco. El diseño del firmware completo está en [plan-firmware.md](../docs/expoandes/plan-firmware.md); el contrato, en [contrato-ble.md](../docs/expoandes/contrato-ble.md).

## Qué hay

```text
firmware/
  accesorio/
    trama_ble.h/.cpp         Información y Medición de 20 bytes: codifica, decodifica
                             y valida (mismas reglas y mismo orden de errores que Swift)
    emisor_sintetico.h/.cpp  genera Medición a partir de una entrada de radar SIMULADA
  pruebas/pruebas.cpp        pruebas en el portátil con los vectores de ../contratos/ble/
  Makefile                   make probar
```

Los dos módulos **no incluyen `Arduino.h`**, no usan excepciones ni memoria dinámica, y compilan igual con `g++` y con el núcleo Arduino de Espressif. `accesorio.ino` y `sen0395.h/.cpp` (intérprete de `$JYBSS`) no existen todavía: son el trabajo de EA-11/EA-12.

El emisor es **sintético**: no habla con un radar. Sirve para que el iPhone pruebe sin radar y para fijar, con vectores, cómo se publican la caducidad, la secuencia, el reinicio y la simulación.

## Probar

```bash
make -C firmware probar
```

Necesita `g++` con C++17. Compila con `-Wall -Wextra -Werror -pedantic`, ejecuta las pruebas directas (ejemplo del informe, emisor, nombres de error) y los vectores `vectores.txt` y `sesiones.txt`. Salida esperada: `N comprobaciones, 0 fallos`. Los mismos vectores los ejecuta Swift ([`ios/ContratoBLE`](../ios/ContratoBLE/README.md)); CI en [contrato-ble.yml](../.github/workflows/contrato-ble.yml).

`make -C firmware probar VECTORES=ruta` usa otra carpeta de vectores.

## Uso del emisor

```cpp
using namespace visionaria::ble;
Informacion info;                 // SEN0395: capacidades 0, perfil 1, ventana en mm
info.id_arranque = /* aleatorio por arranque */;
info.perfil = 1;
info.distancia_maxima_mm = 3000;
uint8_t trama[kLongitudTrama];
if (codificar_informacion(info, trama) != Error::Ninguno) { /* no publicar */ }

EmisorSintetico emisor(info, /*simulacion=*/true);
EntradaRadar e;
e.estado = EstadoRadar::Presencia;
e.edad_ms = 20;                   // edad > 500 sale como "vencido", nunca vigente
emisor.generar(millis(), e, trama);
```

La edad de una fuente a 1 Hz (UART del SEN0395) supera 500 ms durante cerca de la mitad de cada segundo; el emisor publica entonces el resultado como vencido. El conflicto con la caducidad de v1.0 y la opción provisional del GPIO2 están en la [sección 7 del contrato](../docs/expoandes/contrato-ble.md#7-sen0395-conflicto-de-1-hz-y-b2); **B2 sigue pendiente**.

## Pendiente

- **Pines y cableado:** se fijan aquí según la serigrafía de la placa recibida. No se inventan antes de tenerla; las restricciones eléctricas y los pines a evitar están en el plan de firmware.
- Intérprete `$JYBSS`, ciclo de 100 ms, UART, GPIO2, BLE con enlace cifrado y autenticado, alta por botón: EA-11 y EA-12.
- Herramientas (Arduino o ESP-IDF): las confirma H3 en el primer PR de firmware.
