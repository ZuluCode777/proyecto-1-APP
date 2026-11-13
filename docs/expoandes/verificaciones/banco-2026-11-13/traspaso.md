# Traspaso del banco del accesorio (13/11/2026)

Lee este archivo entero antes de tocar la placa. Está escrito para que otro agente, sin
el contexto de la conversación, sepa qué se hizo, qué falta y qué reglas no se rompen.

## Reglas que no se rompen

1. **La clave de enlace (6 dígitos) es secreta.** No la imprimas, no la pongas en una
   línea de órdenes, un registro, un diff, un mensaje ni un artefacto. No hagas `cat` de
   `firmware/accesorio/configuracion_local.h`. Nicolás te la da por otro canal. Escríbela
   en ese archivo desde un único proceso `python3 -I` y bórralo al terminar. Antes de
   entregar registros, comprueba dentro de `python3 -I` que no la contienen (devuelve solo
   verdadero o falso).
2. **El radar va solo a 3V3, nunca a 5V.** Pasar a 5V exige antes medir el TX del radar
   con el divisor del plan (`plan-firmware.md`, § Conexión eléctrica), y lo decide una
   persona.
3. **No hagas commit, push ni PR** sin que Nicolás lo pida. Para pasar código entre
   máquinas: `git bundle` y `scp`, o que Nicolás haga `git pull` (`AGENTS.md`, regla 6).
4. **Detén procesos solo por el PID que lanzaste.**
5. Todo lo que se escribe en el repositorio va en español. Los informes, con los
   hallazgos de seguridad primero.

## Código: qué hay y dónde

`main` (e4dc1fe) ya incluye el PR #91: H1 (dirección pública), H2 (enlaces vivos con
sesión) y H3 (gracia de 30 s tras pedir la clave, tope de 60 s). Los arreglos del radar
están en estas ramas; el traspaso va como un commit más encima de `6bef085`:

| Rama (local) | Commit | Contenido |
| --- | --- | --- |
| `fix/firmware-radar-banco-12-11` | `09fae5b` | R1, R2, R4, R5, R6, H4 |
| `fix/firmware-radar-banco-12-11-rango` | `6bef085` (sobre `09fae5b`) | Comprobación de `getRange` en la recuperación ligera (contador `rango_distinto`), aviso de la petición de clave en el serie, guardia de la clave más estricta |

Las pruebas del portátil de `6bef085` pasan: 1 054 / 626 / 21 228 / 585 / 1 019 837
comprobaciones y la guardia sin fallos. **Trabaja sobre la segunda rama**: ya contiene las dos correcciones y este traspaso.

## Qué se verificó hoy en la placa

Placa ESP32-S3-N16R8 en `/dev/ttyACM0`, dirección BLE pública `7C:E8:B1:AB:2A:09`.

| Hallazgo | Compilación | Resultado |
| --- | --- | --- |
| H1 dirección pública estable tras reinicio | `main`, simulación | Cumple (vista del portátil) |
| H1 reconexión del iPhone tras reiniciar la placa | `09fae5b`, real | Cumple: reconectó 8,94 s después del arranque, cifrada y vinculada al instante, sin clave ni `REPEAT_PAIRING`; las lecturas funcionan |
| H2 portátil sin emparejar | `main` | Status 26 → «conexión nueva» → corte a los 30,00 s |
| H2 10 conexiones del iPhone | `09fae5b` | Cumple, las 10 limpias |
| H2 segundo cliente | `09fae5b` | Cumple: el portátil conectó (status 26) y salió «segundo cliente rechazado; un solo cliente a la vez»; la primera sesión siguió viva |
| H3 sin teclear la clave | `09fae5b` | Corte 32,8 s tras conectar |
| H3 clave tecleada despacio | `09fae5b` | Cumple: la primera conexión se cortó a los 34,6 s, el iPhone reconectó y emparejó 31,2 s después de esa conexión (hizo falta la ampliación); el vínculo persistió |
| H4 aviso repetido | `main` | Sigue: 9 mensajes iguales |
| H4 aviso repetido | `09fae5b` | Cumple: una vez por conexión |
| Just Works con la ventana cerrada | `main` | Rechazado |
| Radar estable | `09fae5b`, real | 2 279 tramas válidas acumuladas con `errores=0` y `timeouts=0` (más 5 parciales, 10 largas y 12 perdidas), tras la estabilización |

Registros en [`evidencia/`](evidencia/): `serie-main.log`, `serie-fix.log`, `serie-rango.log`, `compilar-*.log` y `cargar-*.log`. Los del serie están recortados: se conservan todos los eventos y solo una línea `estado` y una `uart` por minuto (los originales, de unas 1 700 líneas, siguen en el portátil de Nicolás). El informe del día anterior es [`../banco-2026-11-12/resultados.md`](../banco-2026-11-12/resultados.md).

## Qué falta, en orden

1. **La placa ya lleva `6bef085` (compilación real), cargada a las 11:44 del 13/11** ([`evidencia/cargar-rango-radar.log`](evidencia/cargar-rango-radar.log)), con la clave de Nicolás, RX 17, TX 18 y botón 0. Arrancó con el radar en salud 0 en 10 s ([`evidencia/serie-rango.log`](evidencia/serie-rango.log)). Si cargas otra vez, o tu placa es otra, compila con `arduino-cli compile --fqbn esp32:esp32:esp32s3:FlashSize=16M,CDCOnBoot=cdc firmware/accesorio` y un `configuracion_local.h` con esos valores. **El iPhone ya olvidó la placa** y la placa conserva su vínculo viejo: para emparejar, abre la ventana de alta (pulsar el botón 4 s) antes de conectar; fuera de ella, el re-emparejamiento se rechaza a propósito.
2. **Paso 11 de `docs/expoandes/ea-12-ble.md`**, completo y sin hacer hasta hoy:
   (a) R1/R4, al menos 10 arranques con el radar parado; (b) R2, TX desconectado 20 s y
   corte de alimentación, con `getRange` y `rango_distinto=0`, y la prueba de «ventana
   distinta» (`detRangeCfg -1 0 3` + `saveCfg` por una segunda UART), que **el agente que la
   escribió no probó**; (c) R6, detección a menos de 30 cm e Información 0/300; (d) H4.
3. **Repetir H3 con el aviso nuevo** («BLE: se pide la clave en el teléfono; plazo
   ampliado»): permite medir el plazo desde la petición y no solo desde la conexión.
4. **Anomalía sin explicar (la más importante).** Tras las 10 conexiones del iPhone con
   nRF Connect, la última a las 11:16:43 de `serie-fix.log`, la placa siguió con
   `conectada=1` hasta las 11:25:56 (cuando se apagó el Bluetooth del iPhone), **anunciaba
   y aceptó una conexión del portátil**. El código solo anuncia con `conectada=0`
   (`accesorio.ino`, `anunciar()`). En una sesión nueva y única (11:32:45) la placa no
   anunciaba. Intenta reproducirla: repetir los ciclos rápidos, terminar con Desconectar y
   escanear desde un segundo dispositivo mientras el serie muestra `conectada=1`. Si se
   reproduce, es un hallazgo (¿sesión muerta que rechaza a los teléfonos reales como
   «segundo cliente»?). Si no, anótala como no reproducida.
5. **El radar se queda mudo tras cada arranque de la placa**, varias veces en el primer o
   segundo minuto (`otras` +3 por evento, probablemente el aviso de reinicio del radar).
   La recuperación ligera lo devuelve y luego es estable. No se sabe si lo causa la
   alimentación o el firmware. Plan: compilación con espejo de la UART o el sketch puente
   (`herramientas/puente_radar`) para ver qué dice el radar en esos momentos.
6. **Sin hacer en esta sesión:** pasos 8 (captura de 10 min con análisis) y 9 (referencia
   en iOS) del guion; el paso 7 pide 20 ciclos y se hicieron 10; S1 (residuo de vínculo
   tras el borrado de 10 s) se vio una vez el 12/11 y no se reprodujo, hoy no se repitió.
7. **Decisión humana pendiente:** subir las ramas y abrir el PR. Nicolás eligió probar
   primero en la placa.

## Procedimiento y trampas del banco

- **Captura del serie:** [`herramientas/capturar_serie.py`](herramientas/capturar_serie.py) y [`herramientas/capturar-siempre.sh`](herramientas/capturar-siempre.sh). La captura lee la clave de `configuracion_local.h` solo para ocultarla («CLAVE»); `REINICIAR=1` pulsa RTS para ver el arranque. [`herramientas/orden_radar.py`](herramientas/orden_radar.py) envía órdenes al radar a través del puente [`puente_radar`](herramientas/puente_radar/puente_radar.ino) (pines 17/18 del cableado del banco). El puerto solo lo abre un
  proceso: para cargar una compilación, detén la captura por su PID.
- **Carga:** `esptool` 5.3.1 del núcleo esp32@3.3.12 (`~/.arduino15/packages/esp32/tools/`).
- **BlueZ:** el portátil olvida los dispositivos no emparejados, así que **primero
  `bluetoothctl --timeout 12 scan le` y luego `bluetoothctl --timeout 12 connect <dirección>`**.
  Sin `--timeout`, `connect` se queda colgado. Si el Bluetooth está bloqueado:
  `rfkill unblock bluetooth` y `bluetoothctl power on`.
- **iOS conserva el enlace** un buen rato después de que nRF Connect lo suelta: para
  forzar el corte, apaga el Bluetooth en Ajustes (no en el Centro de control).
- **Líneas del serie:** `estado t=… radar=… salud=… fase=… conectada=… suscrita=… alta=…
  notif=… lecturas=… rechazados=…` y `uart validas=… parciales=… largas=… otras=…
  ignoradas=… errores=… timeouts=… descartados=… perdidas=… reintentos=… rango_distinto=…`.
- **Radar SEN0395:** `getRange` responde `Response 0.000 0.450` (metros), `Done` y
  `leapMMW:/>`; pasos de `detRangeCfg` de 15 cm; `outputLatency` en unidades de 25 ms.

## Limpieza al terminar

Borra cada copia de `configuracion_local.h` (una orden `rm` por ruta, sin leerlas),
detén las capturas por PID, deja el árbol de trabajo limpio y cuéntaselo a Nicolás.
