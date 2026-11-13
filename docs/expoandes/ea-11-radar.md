# EA-11: intérprete UART del SEN0395 y guion de banco

Estado al **7 de noviembre de 2026**. Issue: [#37](https://github.com/ZuluCode777/proyecto-1-APP/issues/37). Este documento describe el **software portátil** de EA-11 (`firmware/accesorio/sen0395.h/.cpp`) y deja el **guion de banco**. **No hay mediciones**: nadie ha energizado el módulo ni leído su UART real, y las pruebas del portátil usan tramas escritas a mano. EA-11 **sigue abierta**: los criterios que exigen hardware están pendientes (tabla del final).

El contrato manda: [contrato-ble.md](contrato-ble.md) (v1.0, congelado) y su [§7](contrato-ble.md#7-sen0395-conflicto-de-1-hz-y-b2). Donde el [plan de firmware](plan-firmware.md) difiere, vale el contrato.

## Qué es y qué no es

- **Es** presencia dentro de una ventana: `$JYBSS,1, , , *` → `EstadoRadar::Presencia`; `$JYBSS,0, , , *` → `EstadoRadar::SinBlanco`.
- **No es** distancia, ángulo ni «camino libre». No existe ninguna ruta de código que produzca `EstadoRadar::Objetivo`, distancia o azimut; una trama con valores en los campos se rechaza como formato no admitido. `SinBlanco` significa «sin detección en este momento», no «camino despejado».
- **No lee GPIO2.** El pin sigue **provisional** hasta el ensayo B2 y **no acredita B2**. Si EA-12 lo usa, solo con `latido_vigente()` (abajo) y sin tomar la edad del pin.
- **No es electricidad.** Salud `5` (alimentación) no la produce este módulo.

## API (`namespace visionaria::sen0395`)

Portátil: sin `Arduino.h`, sin bloqueo, excepciones ni memoria dinámica (176 bytes de estado en x86-64). Recibe bytes ya leídos y la hora como `uint32_t` en ms con vuelta módulo 2³²; reutiliza `ble::EntradaRadar` de `emisor_sintetico.h`.

```cpp
Interprete radar;                       // o Interprete(Configuracion)
radar.reiniciar();                      // el arranque: stop, rango, latencia, saveCfg y start; descarta todo resultado
radar.reiniciar(false);                 // recuperación: si el radar ya guardó nuestra configuración, solo stop y start (no toca su flash)
radar.perder_entrada(ahora_ms);         // el llamador perdió bytes de la UART: borra línea parcial y resultado

size_t salida_pendiente(uint8_t* dst, size_t cap) const;  // orden con "\r\n"; 0 si nada
void   salida_enviada(uint32_t ahora_ms);                 // solo si se escribió ENTERA
size_t procesar(const uint8_t* d, size_t n, uint32_t ahora_ms);  // n <= 256: procesa; n > 256: descarta entera
ble::EntradaRadar entrada(uint32_t ahora_ms);             // para EmisorSintetico::generar
uint8_t salud(uint32_t ahora_ms);
bool    latido_vigente(uint32_t ahora_ms);                // edad de la trama <= 2500 ms
Fase fase(); MotivoFallo motivo_fallo(); CausaInvalida ultima_causa_invalida();
const Contadores& contadores();
uint16_t ventana_minima_mm(); uint16_t ventana_maxima_mm();  // para ble::Informacion
```

`Configuracion` (valores por defecto, los que el equipo validó en el banco del 12/11/2026): ventana `0..2` (índices de 15 cm = **0 a 30 cm**; el de fábrica es `0..20`, 3 m, y dejaba el radar en «presencia» casi siempre), `latencia_deteccion = 0`, `latencia_desaparicion = 8` (unidades de 25 ms = **0 s al detectar y 0,2 s al despejar**; los de fábrica son 100 y 400, 2,5 s y 10 s), `estabilizacion_ms = 5000` (nunca menos), `respuesta_max_ms = 2000`. `configuracion_valida()` rechaza ventana vacía o > 127, estabilización < 5000 ms o > 2³¹ − 1 ms, y plazo de respuesta 0 o > 2³¹ − 1 ms (`kPlazoMaxMs`). Los plazos de estabilización y purga vencen con `ahora − inicio ≥ plazo` en módulo 2³²: aun si se consulta mucho después del vencimiento, la transición ocurre (el máximo admitido no bloquea nada). A cambio, `ahora_ms` no debe decrecer: un reloj atrás se lee como mucho tiempo transcurrido y adelanta el vencimiento, nunca lo retrasa. El intérprete **no detecta** el retroceso (la salud `6` es solo para una configuración rechazada): un reloj que retrocede puede caducar el resultado o vencer una orden antes de tiempo, y el llamador debe entregar un reloj monotónico.

### Ciclo que debe seguir EA-12

El ciclo no se escribe a mano: lo hace `atender_uart()` de `enlace_radar.h`, que el sketch llama en cada vuelta del `loop`. No copies un bucle propio de lectura: descartar con `n = 0` sin avisar deja en el intérprete una línea a medias que se une con lo que llegue después y fabrica una trama válida falsa (un `SinBlanco` que nadie midió).

```cpp
radar::EstadoUart estado;      // uno por UART, el mismo en todos los ciclos
radar::SupervisorRadar vigilante;
// cada ciclo del loop (2 ms; las notificaciones BLE van a 100 ms), con un PuertoUart que implementa el sketch sobre Serial1:
radar::atender_uart(radar, puerto, estado);   // lee, avisa pérdidas, envía la orden pendiente
vigilante.vigilar(radar, puerto);             // recupera un radar caído o callado
emisor.generar(millis(), radar.entrada(millis()), trama);   // salud != 0 sale como fallo
```

`atender_uart()` lee a lo sumo 256 B, llama a `procesar` **siempre** (también con `n == 0`) y envía la orden de `salida_pendiente()` solo si cabe entera (`salida_enviada()` solo tras escribirla entera). Si en la UART queda más de un trozo, o el controlador avisó de un desborde (consultado al empezar y otra vez tras la lectura y el drenaje, antes de entregar nada al parser: `onReceiveError` corre en otra tarea), **nada** de lo leído en el ciclo se entrega: drena hasta `kMaxDrenajePorCiclo` (4096) bytes y avisa con `perder_entrada()`. Si el drenaje no alcanza a vaciar la UART, `EstadoUart::drenando` queda activo y los ciclos siguientes descartan **todo** lo que haya (aunque sean 17 B con una trama válida y un `Done`) hasta ver la UART vacía, y no envían ninguna orden mientras tanto: esa cola es anterior y no se puede fechar con verdad.

- `procesar` **nunca deja resto**. Con `n ≤ 256` procesa los `n` bytes y devuelve `n`. Con `n > 256` **descarta la oferta entera** en O(1), sin leer un solo byte, y devuelve `n`: es la cantidad *descartada*, no procesada, y el llamador **no debe reofrecerla** (reofrecer parte de ella sería partir un bloque cuya fecha ya no se conoce). El trabajo leído por llamada está acotado a 256 B, pero el retorno puede ser mayor. Ni la trama ni el `Done` dentro de lo descartado valen. El intérprete falla seguro: pierde la línea parcial en curso; en operación el resultado anterior deja de valer (salud `3`, contada como `Larga`) y recupera con una trama íntegra **nueva**, sin renovar el plazo del latido (2500 ms desde la última trama válida); en configuración un `Done` perdido vence por timeout (salud `4`). `atender_uart()` de EA-12 (`enlace_radar.h`) ya cumple esto: ofrece siempre ≤ 256 B, descarta el desborde de la UART (también el resto que un drenaje acotado deja para el ciclo siguiente) y avisa con `perder_entrada()`. `datos == nullptr` devuelve 0 y no cambia nada. La API es nueva en este PR; no hay otro consumidor.
- Llamar `procesar` en **cada** ciclo importa: el intérprete deduce de ello cuándo se leyó la UART por última vez. Si pasan más de 250 ms entre llamadas, los bytes pudieron esperar en el búfer, y sus tramas se fechan en la llamada anterior (más viejas, nunca más jóvenes). Así un bucle bloqueado no hace pasar tramas atrasadas por recientes.
- `reiniciar()` (tras reiniciar o desconectar el radar) no conserva nada. EA-12 debe además vaciar la UART: `SupervisorRadar` lo hace antes de reiniciar y, si la purga acotada no la deja vacía, espera al ciclo siguiente.
- `perder_entrada()` es el aviso de que se **perdieron** bytes de la UART (se descartó un trozo que no se pudo fechar, o el controlador notó un desborde). Borra la línea parcial, para que no se una con lo que llegue después, e invalida el resultado en operación (salud `3`, contada como `Larga`) hasta una trama íntegra **nueva**; no fabrica ni restaura ninguna trama ni renueva el plazo del latido.
- Un fallo de configuración (`Error` o timeout) **no se reintenta solo** dentro del intérprete: cada `saveCfg` escribe la flash del sensor. Quien reintenta es el `SupervisorRadar` de EA-12 (`enlace_radar.h`), con espera creciente y `reiniciar(false)`. El arranque de la placa guarda la configuración una vez (`reiniciar()`). Una recuperación, con el radar ya guardado, **envía `sensorStop`, `getRange` y `sensorStart`** (nada que escriba la flash): el SEN0395 conserva su flash al reiniciarse, y volver a mandar `detRangeCfg`/`outputLatency` —aunque sean los mismos valores— lo deja con «parámetros sin guardar», y entonces rechaza `sensorStart` (`new parameter isn't save, can't startSensor`, banco 12/11, R2). La wiki de DFRobot lo dice: `sensorStart` arranca el radar «when there are no set parameters to be saved». `getRange`, con el radar ya parado, comprueba que su flash sigue teniendo **nuestra ventana** (`Response 0.000 0.300`, en metros, con tolerancia de 10 mm; con `detRangeCfg -1 0 3` el banco dio `Response 0.000 0.450`): si se cambió el módulo con la placa encendida, o la flash perdió la configuración (un bajón de tensión al guardar; el radar va a 3,3 V), arrancarlo así lo dejaría con otros ajustes y sin avisar. Si la ventana no coincide, la respuesta es ilegible (solo vale `Response <m> <m>` exacto; con varias líneas vale la última) o llega `Error`, **el mismo intento** sigue con la secuencia completa y `saveCfg` (cuenta en `rangos_distintos`, que el serie imprime como `rango_distinto`); una ventana que coincide no escribe nada. No se compara la latencia: `getLatency` contradice la documentación (R5). Si `getRange` no contesta a tiempo es un timeout normal y el intento siguiente vuelve a comprobar. Si el arranque falló antes de `saveCfg`, o si una recuperación ligera acaba en `Error`, la siguiente repite la secuencia completa y guarda: es la única forma de arrancarlo, y cada escritura tiene detrás un intento fallido y la espera creciente. Así la flash del radar se escribe una vez por arranque de la placa más, como máximo, una por cada vez que el radar demuestra no tener la configuración.
- Información BLE: capacidades `0`, perfil `1`, y la ventana de `ventana_minima_mm()`/`ventana_maxima_mm()` (describe la ventana de presencia, no una distancia medida).

## Secuencia de configuración

`sensorStop` → `detRangeCfg -1 <inicio> <fin>` → `outputLatency -1 <detectar> <desaparecer>` → `saveCfg 0x45670123 0xCDEF89AB 0x956128C6 0xDF54AC89` → `sensorStart`, cada una terminada en `\r\n` y confirmada con una línea `Done` exacta. `Error` exacta → salud `4`, terminal hasta `reiniciar()`.

**Excepción, solo en `sensorStop`** (banco 12/11, R1): con el radar ya parado contesta la línea exacta `sensor stopped already` y, a continuación, `Error`. La wiki de DFRobot documenta ese `Error` («Command execution failed, the sensor is not in operating status»). Que ya esté parado es lo que se pedía, así que esa pareja se acepta como `Done`, sin contar un `Error` del radar. No vale para otra orden, ni con una línea parecida, ni con el `Error` solo, ni sin orden en curso.

**Unidades** (R5; fuente: DFRobot, «SEN0395 mmWave Radar Reference», https://wiki.dfrobot.com/sen0395/docs/21398, consulta 13/11/2026): `detRangeCfg` en pasos de 15 cm (índices 0–127; el banco lo confirmó: `getRange` dio `0.000 0.450` con `detRangeCfg -1 0 3`); `outputLatency -1 <detectar> <desaparecer>` con ambos valores en unidades de **25 ms** (0–65535), de fábrica 100 y 400 = 2,5 s y 10 s. **Contradicción del banco, sin resolver:** tras `outputLatency -1 100 400`, `getLatency` respondió `0.025 10.000`. El 10 s cuadra con 400 × 25 ms; el 0,025 s no cuadra con los 2,5 s de la wiki para 100. La wiki no documenta `getLatency`, así que no se sabe si es una lectura distinta o un defecto del radar. No se adivina: con los valores por defecto actuales (0 y 8) la duda no importa. Si algún día se sube la latencia al detectar, hay que medirla.

Reglas contra respuestas viejas:

1. Solo se acepta `Done` mientras hay una orden **confirmada con `salida_enviada()` y esperando**. Un `Done` antes del envío, duplicado o sobrante se cuenta como ignorado y no avanza. Límite: lo que aún esté en la UART sin leer no se ve; solo se controla lo ya ofrecido a `procesar()`.
2. Cada orden tiene su plazo (`respuesta_max_ms`, desde `salida_enviada`). 2000 ms exactos aún vale; 2001 es timeout (salud `4`). Un `Done` tardío tras el timeout o el `Error` no revive nada.
3. `salida_enviada()` descarta cualquier línea parcial previa: el resto de un fragmento viejo no se toma por respuesta.
4. Tras un timeout, o si se reinicia con una orden en vuelo, la primera orden nueva se **retiene `respuesta_max_ms` desde que venció el plazo de la orden vieja** (purga): en total, al menos 2 × `respuesta_max_ms` desde que ella se envió. En un reinicio con la orden en vuelo, la purga empieza al vencer su plazo (no al reiniciar), así que una respuesta vieja dentro de esos 2 × `respuesta_max_ms` no confirma la orden nueva; reiniciar varias veces no la acorta. **Límite:** las respuestas del SEN0395 no traen identificador y no se verificó su eco; una respuesta que llegue más de 2 × `respuesta_max_ms` después de su orden no se distingue de la de la orden nueva. No hay garantía posible sin identificadores; B1 mide la latencia real de cada orden para fijar un plazo que lo haga imposible.
5. Las líneas que no son `Done`/`Error` durante la configuración (eco de la orden, tramas de salida continua) se cuentan como ignoradas; **nunca** valen como éxito. Si el formato real difiere de lo supuesto (p. ej. un prefijo de consola pegado a `Done`), la configuración expira con salud `4` de forma visible; no se acepta algo parecido.

## Estabilización

Los **5 s** (mínimo) se cuentan desde el `Done` de `sensorStart`, nunca desde que se envió. Durante ese tiempo las tramas se ignoran y la salud es `1`. Al terminar, se vacía la línea parcial y se exige una **trama íntegra nueva**; mientras no llegue, salud `1` hasta 2500 ms después del fin y salud `2` pasado ese plazo.

## Salud y edad

| Salud | Cuándo |
| --- | --- |
| `0` | Hay trama válida con edad ≤ 2500 ms y nada malo posterior. |
| `1` | Configurando, estabilizando, o sin primer latido aún (≤ 2500 ms tras estabilizar). |
| `2` | Sin trama **válida** (nunca llegó o pasó de 2500 ms desde la última): timeout o desconexión, aunque siga llegando ruido. |
| `3` | Línea parcial, corrupta, larga o de formato no admitido, dentro del plazo de 2500 ms de la última trama válida. Dura hasta la siguiente trama válida; pasado el plazo, `2`. |
| `4` | Línea `Error` (mismo plazo que el `3`), o una orden sin respuesta a tiempo. |
| `6` | Configuración del llamador rechazada. |

- **Latido:** edad ≤ 2500 ms es vigente; 2501 ms no (mismo criterio que 500/501 de la caducidad BLE). Umbral de diseño por confirmar en B1/B2. El plazo corre **solo desde la última trama válida** (o el fin de la estabilización): la corrupción o un `Error` periódicos no lo renuevan, y a los 2501 ms sin válida la salud es `2` (contrato §7).
- **Edad:** `edad_ms` = ahora − recepción íntegra de la última trama. `entrada()` con salud `0` da `Presencia`/`SinBlanco` con esa edad. Con edad > 500 ms el emisor publica el resultado como **vencido** (bit 0 en cero): es el conflicto de 1 Hz del §7, no un defecto del intérprete. Con salud ≠ 0 devuelve `EstadoRadar::Fallo` con edad desconocida y ningún resultado.
- **Cada trama válida completa y nueva renueva la edad**, aunque repita el mismo 0/1: la trama `$JYBSS` no trae contador ni marca de tiempo. **Límite:** el intérprete no puede saber si el radar repitió internamente una lectura vieja; la edad mide desde la recepción íntegra, no desde la captura. Solo recibir otra trama la renueva: llamar a `entrada()` varias veces o **reemitir por BLE no la rejuvenece** (la edad solo crece entre tramas).
- **Nunca se reutiliza un resultado** tras corrupción, `Error`, caducidad, timeout o reinicio. La recuperación exige una trama íntegra nueva.

## Líneas

- Una línea termina en `\r` o `\n`; las vacías se ignoran. Máximo 64 bytes: una línea de 65 o más es inválida (`Larga`), se descarta hasta su terminador y se cuenta **una vez**.
- Solo se aceptan las dos tramas exactas, sin espacios de más ni mayúsculas distintas. Dos tramas pegadas sin terminador, campos con valores, `$JYBSS,2…` o bytes `NUL`/no ASCII son inválidos.
- `Parcial`: línea terminada que es prefijo estricto de una trama válida, o fragmento sin terminador tras 500 ms de silencio. `Otra`: corrupta o formato no admitido (con la UART no se distingue una de otra; por eso «unidad incorrecta» y los campos numéricos caen aquí y nunca se interpretan como distancia).
- Una línea que se queda a medias no se une a bytes llegados mucho después.
- Una trama que cae justo en el límite de la estabilización puede contarse como inválida una vez; la siguiente recupera.

## Pruebas

```bash
make -C firmware probar
```

Ejecuta, con `-Wall -Wextra -Werror -pedantic`, los vectores de EA-04 (sin cambios: `1054 comprobaciones, 0 fallos`) y `pruebas_sen0395.cpp` (`626 comprobaciones, 0 fallos`, sintéticas; la verificación de `getRange` se prueba con el intérprete real en `pruebas_radar_integracion.cpp`, ver ea-12-ble.md). Cubren: `sensorStop` con el radar ya parado (R1: solo la línea exacta, solo ese paso); órdenes exactas y orden; configuración inválida; estabilización y primer latido; tramas 0/1 y edad con el emisor; byte a byte y terminadores; 13 formas inválidas con recuperación; línea larga en 64/65 bytes y fragmentada; fragmentos sin terminador; `Error` en operación; caducidad 2500/2501 y desconexión; vuelta del reloj (estabilización, latido, caducidad y timeout de orden); `Done` duplicado, adelantado, tardío y parcial previo; timeout 2000/2001 ms; reinicio sin resultado antiguo; purga tras timeout y con la orden en vuelo (frontera de 2 × plazo, reinicios repetidos); hueco de lectura; oferta mayor que 256 B descartada entera con retorno `n` (O(1), con trama, `Done`, `Error` y mezcla dentro, con línea parcial previa, en operación y en configuración) y recuperación con una trama íntegra nueva; UART simulada con el recorte de `atender_uart()` (≤ 256 B); ruido y `Error` periódicos que no ocultan el timeout; plazos máximos de configuración (estabilización y purga consultadas en plazo − 1, plazo, plazo + 1 y saltándose el umbral; hueco de 2³¹ ms); ausencia de `Objetivo`; contadores. La corrida con ASan/UBSan no se hizo: las bibliotecas no están instaladas en este equipo.

## Qué NO se probó

Nada con hardware: formato real de las respuestas (¿eco?, ¿prompt `leapMMW:/>`?), tiempo real hasta la primera trama tras `sensorStart`, latencia de cada orden, nivel lógico, comportamiento al desconectar, cuánto tarda el GPIO2 frente a la trama, detección de blancos estáticos. Todo eso es B0/B1/B2 y sigue pendiente.

## Guion de banco (pendiente de ejecutar)

H2 ejecuta y H1 registra. Sin datos personales; sin multímetro, el TX se mide con el ADC como indica el [plan de firmware](plan-firmware.md#conexión-eléctrica). **No energizar** hasta confirmar esquema, niveles 3,3 V/5 V, masa y pines del módulo exacto (criterio 1 del issue). Anotar sensor, lote/firmware, perfil, montaje y versión del código (`git rev-parse --short HEAD`).

| Paso | Qué hacer | Qué registrar | Decide |
| --- | --- | --- | --- |
| B0 | Módulo a 3,3 V, USB. Cargar un sketch mínimo que vuelque la UART cruda (hex y hora). | Responde `Done`, no reinicia en 30 min, consumo. | Si pasar a 5 V. |
| B1a | Volcar 10 min crudos desde el encendido. | Bytes exactos de cada respuesta (con y sin eco), tiempo encendido→primera trama, frecuencia, tramas con otra forma. | Si el parser acepta el formato real; si hay que ajustar `Done`/eco. |
| B1b | Ejecutar la secuencia con `Interprete` y registrar `contadores()` y la hora de cada `salida_enviada`/`Done`. | Latencia de cada orden (incluido `saveCfg`), tiempo `sensorStart`→primera trama válida. | `respuesta_max_ms`, estabilización real (≥ 5 s). |
| B1c | Desconectar y reconectar el cable de la UART; cortar y restaurar la alimentación del módulo; llamar `reiniciar()`. | Hora hasta salud `2`, hasta salud `0`; ver que no aparece un resultado viejo. | Recuperación y reinicio. |
| B1d | Inyectar corrupción (apagar TX en medio de una trama, ruido). | Salud `3`/`2`, contadores. | Parcial/corrupta con tráfico real. |
| B2 | Persona entra y sale de la ventana sobre marcas en el piso, con el GPIO2 leído aparte y registrado, **fuera** del intérprete. | Retardo del GPIO2 y de la trama por evento; si el pin cambia antes. | Conflicto de 1 Hz del §7. Sin esta medición el GPIO2 sigue provisional. |
| Estático | Blanco estático y móvil con distancia de referencia (criterio 4 del issue). | Secuencia anonimizada. | Si el radar no detecta estáticos, la meta queda sin aprobar. |

Registro CSV propuesto (una fila por evento, **vacío hasta que haya banco**; no inventar valores): `fecha_hora,paso,evento,hora_ms,bytes_hex,salud,edad_ms,contador_validas,contador_invalidas,nota`. Los datos de banco y las marcas de tiempo van a un documento nuevo, no a este.

## Estado de los criterios del issue

| Criterio | Estado |
| --- | --- |
| Confirmar esquema, niveles, masa, pines, fuente | Pendiente (hardware). |
| Registrar sensor/firmware/perfil, calibración, campo de visión | Pendiente (banco). El parser solo declara presencia. |
| Parser distingue parcial/corrupta/larga/no admitida, timeout, desconexión, ausencia de blanco y fallo; reinicio y recuperación sin datos antiguos | **Hecho en software**, con pruebas sintéticas. Falta ensayarlo con la UART real. |
| Secuencia anonimizada y blancos estático y móvil | Pendiente (banco). |
| USB y consumo; batería y carcasa después | Pendiente (banco). |

No se puede cerrar el issue con este cambio.
