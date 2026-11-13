# Prompt para el agente que continúa el banco

Pégalo tal cual como primer mensaje del agente.

```
Continúas unas pruebas de banco del accesorio Visionaria (firmware ESP32-S3 con radar SEN0395 y BLE) que dejó a medias otro agente. Todo en el repositorio va en español.

1. Haz checkout de la rama `fix/firmware-radar-banco-12-11-rango`. Contiene las correcciones del radar y todo lo que necesitas para seguir. No la modifiques ni subas nada. Si no está en el remoto, dímelo: me toca subirla a mí.
2. Lee entero `docs/expoandes/verificaciones/banco-2026-11-13/traspaso.md`. Dice qué se probó, qué falta, en qué orden y los trucos del banco. Lee también `docs/expoandes/ea-12-ble.md`, pasos 10 y 11, y `AGENTS.md`.
3. Antes de tocar la placa, di en dos líneas qué entendiste y confirma que la placa está conectada a tu máquina. Si no lo está, no sigas con las pruebas: dímelo.
4. Trabaja en el orden del apartado «Qué falta» de `traspaso.md`: primero el paso 11 con la compilación real, después H3 con el aviso nuevo de la petición de clave, después la anomalía del enlace que anunciaba estando «conectada».

Reglas que no se rompen:

- La clave de enlace de 6 dígitos es secreta: no la imprimas, no la escribas en una línea de órdenes, un registro, un diff, un mensaje ni un archivo versionado, y no hagas `cat` de `firmware/accesorio/configuracion_local.h`. Te la doy yo por otro canal; escríbela en ese archivo desde un único proceso `python3 -I` y bórralo al terminar. Antes de guardar registros, comprueba dentro de `python3 -I` que no la contienen.
- El radar va solo a 3V3, nunca a 5V.
- No hagas commit, push ni PR sin que yo lo pida.
- Detén procesos solo por el PID que lanzaste.
- Para cada resultado, dime la evidencia (línea del serie con su hora), no solo «pasa». Si algo no se pudo probar, dilo.

Al terminar, deja un informe en español en `docs/expoandes/verificaciones/banco-AAAA-MM-DD/informe.md` con los hallazgos de seguridad primero, borra todas las copias de `configuracion_local.h` y cuéntame qué queda pendiente.
```
