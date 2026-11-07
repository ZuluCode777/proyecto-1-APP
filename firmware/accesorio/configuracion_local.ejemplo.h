// Plantilla de la configuración LOCAL del accesorio (EA-12). No la usa el
// compilador: copia este archivo a `configuracion_local.h` (que Git ignora) y
// completa los valores. Sin ellos el firmware compila, pero no habilita nada:
//   - sin pines del radar: no abre la UART y publica salud 6 (montaje no validado);
//   - sin pin del botón: la ventana de alta nunca se abre, así que nadie puede
//     emparejar;
//   - sin clave válida: no arranca el BLE (falla cerrado) y lo dice por el puerto serie.
//
// Prepara el accesorio así, en el portátil, con el accesorio sin energizar:
//   1. cp firmware/accesorio/configuracion_local.ejemplo.h firmware/accesorio/configuracion_local.h
//   2. Genera la clave de 6 dígitos con el generador del sistema; no la escribas
//      en el chat, en un issue ni en el repositorio:
//        printf '%06d\n' $(( $(od -An -N4 -tu4 /dev/urandom) % 899999 + 100000 ))
//      y pégala abajo. Es la que el iPhone pedirá al emparejar. Guárdala solo en
//      este archivo y donde guarde sus secretos quien prepara el accesorio.
//   3. Fija los pines mirando la serigrafía de LA PLACA RECIBIDA. Ningún pin de
//      este repositorio está probado en la placa; los macros de abajo son la
//      declaración humana de que tú los revisaste.
//
// Una clave estática y reutilizable limita lo que garantiza el emparejamiento
// (docs/expoandes/ea-12-ble.md, "Límites"). Si sospechas que se filtró, genera
// otra, recompila, carga y borra los vínculos con el botón.

// Clave de emparejamiento (passkey) de 6 dígitos. Descomenta y reemplaza.
// No uses 000000, 123456, 654321 ni dígitos repetidos: el firmware los rechaza.
// #define VISIONARIA_CLAVE_ENLACE 000000

// Pines (numeración GPIO del ESP32-S3). RX es el pin del ESP32 que recibe el TX
// del SEN0395. El firmware rechaza al compilar los de arranque, USB, consola y
// PSRAM listados en firmware/accesorio/enlace_accesorio.h.
// #define VISIONARIA_PIN_RADAR_RX 0
// #define VISIONARIA_PIN_RADAR_TX 0

// Pulsador a masa con resistencia interna de subida (activo en bajo). GPIO0 es
// el BOOT de muchas placas; otro pin libre también sirve.
// #define VISIONARIA_PIN_BOTON 0

// Compilación de simulación (presencia sintética con el bit 5 activo; no habla
// con el radar). No se combina con los pines del radar.
// #define VISIONARIA_SIMULACION 1
