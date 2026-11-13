# Informe del banco del accesorio (13/11/2026, tarde)

Continuación del [traspaso](traspaso.md) del 13/11 sobre la rama
`fix/firmware-radar-banco-12-11-rango` (`9227bab`, sin modificar). Todas
las pruebas son del 13/11/2026; las hizo Antonia en la placa.

## Hallazgos de seguridad

**Ningún fallo de seguridad nuevo.** Todas las comprobaciones de seguridad
que se pudieron hacer cumplen:

| Comprobación | Resultado | Evidencia |
| --- | --- | --- |
| Leer sin emparejar (paso 3 a) | Rechazada | nRF Connect: «Encryption is insufficient» |
| Emparejar con la ventana de alta cerrada (paso 3 e) | Cortado sin pedir clave y sin vínculo | 3 conexiones, cada una con «enlace sin protección suficiente; se corta» en ≤ 15 s; sin «se pide la clave…»; `rechazados=0` |
| Enlace sin proteger (H4, H2) | Corte a ≈ 30 s, aviso una vez por conexión | «enlace sin proteger pasado el plazo; se corta» una vez en cada una de 2 conexiones |
| Clave pedida y no tecleada (H3) | Corte ≈ 30 s tras la petición y antes de 60 s desde la conexión | petición entre `t=915` y `920` s, corte entre `945` y `950` s |
| Emparejar con la clave (H3) | Enlace cifrado, autenticado y vinculado | «BLE: enlace cifrado, autenticado y vinculado»; la ventana se cierra al vincular |
| Segundo cliente con una sesión activa | No conectó | el segundo iPhone quedó «conectando»; el serie no muestra ningún evento BLE |
| La clave en el serie | No aparece | los avisos de la petición no llevan dígitos |

**Seguridad sin probar:**

- **La anomalía tras ciclos rápidos.** El traspaso dice que, después de 10
  conexiones seguidas, la placa siguió en `conectada=1`, anunciaba y
  aceptó una conexión del portátil. No se repitió ese procedimiento
  (decisión de Antonia). Solo se probó el caso base.
- **La ampliación del plazo de H3.** No se probó emparejar cuando ya
  pasaron más de 30 s desde la conexión (decisión de Antonia).
- La clave usada es la de Nicolás. Antonia la tecleó en su iPhone; no pasó
  por el chat, el informe ni ningún archivo de esta sesión.

## Resumen

| Prueba | Resultado |
| --- | --- |
| R2, TX del radar desconectado 20 s | Cumple |
| R2, corte de alimentación del radar | Cumple; la flash conserva la ventana (`rango_distinto=0`) |
| R2, ventana distinta | No probada (necesita una segunda UART) |
| R1/R4, reinicios de la placa | Parcial: 7 arranques limpios de 10; sin salud 4 ni `errores` |
| R6, Información | Cumple: 0 / 300 mm, perfil 1, capacidades 0 |
| R6, detección | Cumple (presencia con la mano, sin blanco sin ella); vuelta a 0 en 0,2 s no medida |
| H4 | Cumple |
| H3 | Cumple; ampliación sin probar |
| Anomalía del enlace | No reproducida en el caso base; ciclos rápidos sin hacer |
| B0, 30 min sin reinicios | Cumple: ≈ 42 min con BLE activo, tras los reinicios del arranque |
| Punto 5 / R3, el radar se reinicia tras el arranque | Reproducido; causa sin determinar |

## Cómo se hizo

- Placa ESP32-S3-N16R8 con el radar SEN0395 a 3V3, ya cargada con la
  compilación real de `6bef085`: el serie imprime «se repite el arranque del
  radar (…)» y `rango_distinto`, que solo existen en esa rama. No se volvió
  a cargar.
- **No prueba el PR #98** (`fix/firmware-banco-12-11-r1-r2-r5-r6`, ventana
  de 45 cm): es otra implementación de R1, R2, R5 y R6 que no contiene
  `6bef085`.
- Antonia manejó la placa en Windows con el Monitor Serie del Arduino IDE
  (115200), un iPhone con nRF Connect y un segundo iPhone. Kiro Web analizó
  las líneas que ella copió: no tenía la placa conectada (sin
  `/dev/ttyACM*` ni `/dev/ttyUSB*`).
- Dos arranques de referencia:
  - **Arranque 1** (≈ 12:32:58): R2 y punto 5. Se deduce de `t=210005` a
    las 12:36:28 y `t=1025006` a las 12:50:03.
  - **Arranque `7cbdb71c`**, el último de la prueba de reinicios: H4, H3,
    R6, anomalía y B0.
- Casi todas las copias perdieron la hora del Monitor: los tiempos se dan
  con `t` (ms desde el arranque) y con el contador `alta`.

### Límites del método

- Este firmware no muestra por el serie las órdenes ni las respuestas del
  radar (`sensorStop`, `getRange`, `Done`…). Lo que pide el guion sobre el
  texto de cada orden no se pudo comprobar: solo los contadores.
- `estado` y `uart` salen cada 5 s: los tiempos tienen esa resolución. No
  alcanza para confirmar el umbral de 2,5 s hasta salud 2.
- La presencia solo se ve por BLE, en el byte de banderas de Medición.

## Resultados

### Punto 5 / R3: el radar se reinicia solo tras cada arranque

- Arranque 1: alternó salud 1 → 0 → 2 con «Radar: sin latido o
  configuración fallida; se repite el arranque…» (12:33:28) y `otras`
  subiendo de a 3 por evento. Estable desde
  `12:36:28.320 uart validas=119 … errores=0 timeouts=0 … reintentos=4
  rango_distinto=0`.
- Arranque `b9655a8a`: salud 0 a los 10 s; a los 20-25 s, salud 2 con
  `otras` +3 y `parciales` +1; recuperado a los 40 s; se repite a los
  40-45 s (`otras` 3 → 6); recuperado a los 60 s.
- Patrón: en los primeros minutos tras cada arranque el radar se reinicia
  solo unas cinco veces (`otras=15`, `reintentos=4`), unos 20 s después de
  cada `sensorStart`, con 3 líneas «otras» por vez, como el aviso de
  reinicio de R3 del 12/11. La recuperación lo devuelve siempre a salud 0.
- Causa sin determinar. Hipótesis del 12/11: alimentación a 3,3 V, por
  debajo de los 3,6-5 V de la ficha.

### R2: TX del radar desconectado 20 s (paso 11 b), arranque 1

| `t` (s) | Línea | Lectura |
| --- | --- | --- |
| 1305,006 | salud=0, validas=950 | antes del corte |
| 1310,006 | salud=0, validas=953 | el cable sale entre 1305 y 1310 |
| 1315,006 – 1320,006 | salud=2 | sin tramas |
| entre 1320 y 1325 | «Radar: sin latido…» | primer reintento (`reintentos` 12 → 13, `timeouts` 7 → 8) |
| 1325,006 – 1335,006 | salud=4 fase=3 | reintentos sin respuesta |
| entre 1335 y 1340 | «Radar: sin latido…» | tercer reintento (`reintentos` → 15) |
| 1340,007 | salud=1 fase=1 | arranque del radar |
| 1345,007 | salud=0, validas=955 | recuperado |
| 1400,007 | salud=0, validas=1011 | estable |

- Cumple: vuelve a salud 0 sin reiniciar la placa (`t` continuo), con
  `errores=0` y `rango_distinto=0`. El primer reintento llega unos 10 s
  después de perder la salud, como dice el paso 6. Hicieron falta 3
  reintentos.
- Salud 4 mientras las órdenes no tienen respuesta: es lo documentado
  (`ea-11-radar.md`, § Secuencia de configuración, punto 2).
- Un intento anterior, entre 12:37 y 12:50 y sin duración registrada,
  también se recuperó (`reintentos` 4 → 12, `timeouts` 0 → 7, `otras` sin
  cambio).

### R2: corte de alimentación del radar (paso 11 b), arranque 1

Se sacó el jumper V del sensor unos 5 s y se volvió a poner en el mismo
pin. La otra punta siguió en 3V3.

| `t` (s) | Línea | Lectura |
| --- | --- | --- |
| 1580,007 | salud=0, validas=1196 | antes del corte |
| 1585,007 – 1590,007 | salud=2 | el radar se apaga entre 1580 y 1585 |
| entre 1590 y 1615 | 3 × «Radar: sin latido…», salud 1 y 4 | `reintentos` 15 → 18, `timeouts` 9 → 11 |
| 1615,008 | salud=1 fase=1 | el radar contesta (`ignoradas` 66 → 72) |
| 1620,008 | salud=0, validas=1201 | recuperado, unos 35-40 s después del corte |

- Cumple: vuelve a salud 0 sin reiniciar la placa, `errores=0`.
- La flash del radar conserva la ventana tras el corte:
  `rango_distinto=0`.
- `otras` no cambió: este corte no contó el aviso de reinicio del radar
  como «otra».

### R1/R4: reinicios de la placa (paso 11 a) — parcial

16 arranques con identificador distinto: `3406d91d`, `f1c63c27`,
`38cf09c7`, `7de09da4`, `974b53e3`, `f5309a71`, `aa447520`, `415958ca`,
`46d3f3df`, `315200e1`, `b9655a8a`, `cba1bba1`, `0405dcbe`, `0891cc2d`,
`0a922a0d`, `7cbdb71c`.

- Ninguno con salud 4 ni `errores` distinto de 0.
- 7 llegaron a salud 0 (a los 10 s): `3406d91d`, `f1c63c27`, `aa447520`,
  `46d3f3df`, `315200e1`, `b9655a8a`, `0891cc2d`. El resto fueron RST
  pulsados antes de tiempo o dos veces seguidas (Antonia lo confirmó): no
  hubo reinicios espontáneos de la placa.
- Varios RST cayeron en plena configuración (salud 1 a los 5 s). Es
  probable, pero no comprobable con este serie, que en alguno el radar
  quedara parado, que es la condición de R1. Los arranques siguientes
  llegaron igual a salud 0.
- El guion pide al menos 10 arranques con el radar parado. Se cerró con 7
  por decisión de Antonia. No se pudo ver el texto de la primera orden
  (`sensorStop` íntegro).
- En `315200e1` y `b9655a8a` se descartó una trama de 17 bytes al
  arrancar (`descartados=17`, `perdidas=1`).

### H4: aviso de corte de un enlace sin proteger (paso 11 d), arranque `7cbdb71c`

| Conexión | «conexión nueva» | «enlace sin proteger pasado el plazo; se corta» |
| --- | --- | --- |
| 1 | entre `t=500` y `505` s | entre `t=530` y `535` s (una vez), y «conexión terminada» |
| 2 | entre `t=535` y `540` s | entre `t=565` y `570` s (una vez), y «conexión terminada» |

- Cumple: un aviso por conexión y corte a los 25-35 s de conectar.
  `rechazados=0`. El radar no se alteró.

### H3: petición de clave (paso 10 c), arranque `7cbdb71c`

**Sin teclear la clave:**

| `t` (s) | Línea |
| --- | --- |
| ≈ 888,2 | «Alta: ventana abierta 60 s» (`alta=58216` a `t=890008`) |
| entre 895 y 900 | «BLE: conexión nueva…» |
| entre 915 y 920 | «BLE: se pide la clave en el teléfono; plazo ampliado» |
| entre 945 y 950 | «enlace sin protección suficiente; se corta», «enlace sin proteger pasado el plazo; se corta», «conexión terminada», «Alta: ventana cerrada» |

- Cumple: corte 25-35 s tras la petición y 45-55 s tras conectar.
- Límite: coincidieron tres plazos en los mismos segundos (la gracia de
  30 s, el timeout de 30 s del emparejamiento del propio Bluetooth y el
  cierre de la ventana, a ≈ 948,2 s). No se puede atribuir el corte solo a
  la gracia.
- Observación: dos avisos de corte en la misma conexión (cambio de
  cifrado fallido y gracia). No es la repetición de H4.

**Tecleando la clave:**

| `t` (s) | Línea |
| --- | --- |
| ≈ 1371,0 | «Alta: ventana abierta 60 s» (`alta=55994` a `t=1375010`) |
| entre 1375 y 1380 | «conexión nueva» y, seguida, «se pide la clave en el teléfono; plazo ampliado» |
| entre 1385 y 1390 | «BLE: enlace cifrado, autenticado y vinculado» y «Alta: ventana cerrada» |
| hasta 2930 | `conectada=1` sin cortes, `rechazados=0` |

- Cumple: empareja con la clave y la sesión sigue viva.
- No se ejercitó la ampliación: todo terminó antes de 30 s desde la
  conexión.

**Con la ventana cerrada** (paso 3 e): tres conexiones, entre `t=1175` y
`1210` s, cortadas con «enlace sin protección suficiente; se corta» sin
«se pide la clave…». Ver «Hallazgos de seguridad».

### R6: Información y detección por BLE (paso 11 c), arranque `7cbdb71c`

Información: `010000001CB7BD7C000100016400F40100002C01`

| Bytes | Valor | Campo |
| --- | --- | --- |
| 0-1 | `01 00` | contrato 1.0 |
| 2-3 | `00 00` | capacidades 0 |
| 4-7 | `1C B7 BD 7C` | arranque `7cbdb71c`, el mismo del serie |
| 8-10 | `00 01 00` | firmware 0.1.0 |
| 11 | `01` | perfil 1 (personas) |
| 12-15 | `64 00`, `F4 01` | periodo 100 ms, caducidad 500 ms |
| 16-19 | `00 00 2C 01` | ventana **0 / 300 mm** |

Medición (notificaciones):

| Caso | Trama | Lectura |
| --- | --- | --- |
| Mano a ≈ 15 cm | `0103901D1CB7BD7C26032500FFFF00806400FF00` | banderas `03` (vigente + presencia), secuencia 7568, distancia `0xFFFF`, azimut −32768, edad 100 ms, salud 0 |
| Sin nada delante | `0101A5221CB7BD7C60FF2600FFFF0080C001FF00` | banderas `01` (vigente, sin blanco), secuencia 8869, edad 448 ms, salud 0 |

- Cumple con el contrato §2.1 y §3.2 para el SEN0395. La secuencia avanza
  con el instante (1 301 tramas en 130,1 s).
- No medido: la vuelta a 0 en unos 0,2 s (se miró a ojo).
- La edad de 448 ms, cerca de la caducidad de 500 ms, muestra el conflicto
  de 1 Hz del contrato §7: parte de las tramas salen vencidas (banderas
  `00`).
- `lecturas=0` es esperable: ese contador solo cuenta lecturas de
  Medición.

### Anomalía del enlace: caso base, arranque `7cbdb71c`

Con el iPhone 1 vinculado, conectado y suscrito (`conectada=1 suscrita=1`
de `t≈1670` a `2930` s), un segundo iPhone vio «Visionaria» en su lista,
pidió conexión y se quedó «conectando». En ese tramo el serie no imprime
ninguna línea BLE: ninguna conexión llegó a la placa. La entrada de la
lista pudo venir de una búsqueda anterior (no se comprobó si su RSSI
cambiaba). Los ciclos rápidos del traspaso no se hicieron.

### Detección a través de la tapa impresa

La ventana de la tapa no atraviesa: quedan ≈ 3 mm de PLA sobre las
antenas (error del diseño, `firmware/caja/caja-manilla.scad`: el labio es
macizo). Con la tapa apoyada sobre el sensor, una lectura de Medición dio
banderas `03` (`lecturas=1` a `t=4460014`). Suscrito, nRF Connect mostró
casi siempre `0100` (dato vencido), lo esperable con el conflicto de 1 Hz
del contrato §7. Antonia dio la prueba por cerrada; la serie de lecturas
con y sin la mano no quedó registrada aquí.

Se observaron además 5 ciclos de suscripción y retirada en la misma
conexión (`t=4345` a `4475` s): un «suscrito» o «retirada» por cambio,
sin cortes ni errores.

### B0 y estabilidad con BLE activo, arranque `7cbdb71c`

- `otras=15`, `reintentos=4`, `errores=0` y `timeouts=0` sin cambios desde
  `t=420` hasta `t=2930` s (≈ 42 min): más de 30 min sin reinicios del
  radar con BLE activo, pasados los reinicios del arranque.
- `notif` de 12 (`t=1670`) a 12 612 (`t=2930`), exactamente +50 cada 5 s:
  10,0 notificaciones por segundo durante 21 min. No sustituye la captura
  del paso 8.
- En el tramo, una línea con salud 3 (`t=1555`, `largas` +1) y 6 tramas
  largas descartadas en total (`largas` 3 → 9, `perdidas` 3 → 9).

## Pendiente

1. **Anomalía tras ciclos rápidos** (seguridad): sin probar.
2. **Ampliación de H3**: emparejar pasados 30 s desde la conexión, sin
   probar.
3. **R1/R4**: completar 10 arranques con el radar parado y ver el texto de
   la primera orden. Necesita una copia con espejo de la UART o el puente
   (`herramientas/puente_radar`).
4. **R2**: ver qué órdenes usa la recuperación (mismo requisito) y la
   prueba de «ventana distinta» con una segunda UART.
5. **R6**: medir la vuelta a 0 en unos 0,2 s con registro de tiempos.
6. **Punto 5 / R3**: la causa de los reinicios del radar tras el arranque.
   Pasar a 5 V exige antes medir el TX del radar con el divisor del plan, y
   lo decide una persona.
7. **Sin hacer**, del traspaso: paso 7 (20 ciclos de reconexión), paso 8
   (captura de 10 min con análisis), paso 9 (referencia en iOS) y S1.
8. **Decisión humana**: el PR de las ramas del firmware hacia `main`
   (traspaso, punto 7).

## Limpieza

- En el entorno de Kiro Web no hay ninguna copia de
  `configuracion_local.h`: la búsqueda no encontró ninguna. En esta sesión
  no se creó ni se leyó ese archivo, ni se cargó firmware.
- Kiro no lanzó ningún proceso sobre la placa.
- Pendiente de Antonia: borrar, sin abrirlas, las copias de
  `configuracion_local.h` que haya en su computadora, si existen.
- La rama `fix/firmware-radar-banco-12-11-rango` quedó sin modificar: este
  informe va en una rama aparte que parte de ella.
