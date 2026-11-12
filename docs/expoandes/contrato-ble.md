# Contrato BLE v1.0 del accesorio de proximidad (EA-04)

Congelado el **6 de noviembre de 2026** para el issue [#30](https://github.com/ZuluCode777/proyecto-1-APP/issues/30). Este es el documento único del contrato: parte de la [propuesta §8 del informe de hardware](investigacion-hardware-ios.md#8-contrato-ble-propuesto-versión-10), la adapta al radar comprado ([SEN0395 en el plan de firmware](plan-firmware.md)) y precisa lo que el informe dejaba abierto. Donde difiere o precisa el informe, la [sección 9](#9-qué-precisa-este-documento-respecto-del-informe) lo dice.

## 0. Qué es este contrato y qué no prueba

- Es un **contrato de bytes y de sesión**. Lo implementan el codificador y emisor de prueba en C++ ([`firmware/`](../../firmware/README.md)) y el decodificador y la validación de sesión en Swift ([`ios/ContratoBLE`](../../ios/ContratoBLE/README.md)). Ambos lados se prueban con los **mismos vectores** de [`contratos/ble/`](../../contratos/ble/).
- Todo vector y el emisor son **sintéticos**. No hay medición de radar, ni trama real del SEN0395, ni enlace BLE, ni Core Bluetooth detrás. Un vector que pasa **no acredita** radar ni enlace físico.
- Las cifras de tiempo (500 ms, 200 ms, 20 ms, 30 s, 100 ms) son **objetivos por medir**, no capacidades. El 20 ms de margen es una hipótesis de ensayo, no precisión de reloj probada.
- **Pendiente, no cerrado por este trabajo:** ensayo B2 (retardo del SEN0395 y conflicto de 1 Hz), enlace cifrado y autenticado real (EA-12), transporte Core Bluetooth (EA-11/EA-12), y la prueba en el iPhone desde el 11/11. La corrida de Swift en macOS de CI **ya pasó** en `97b7e819` ([ejecución](https://github.com/ZuluCode777/proyecto-1-APP/actions/runs/42345095722): 1054 comprobaciones de C++ y 7 pruebas de Swift en macOS; fixtures 22 info / 51 med / 11 emisión / 61 sesión), solo con vectores sintéticos. Ver [sección 10](#10-pendiente-y-puertas).

## 1. Servicio y características

| Elemento | UUID | Operación y longitud |
| --- | --- | --- |
| Servicio de proximidad v1 | `e13a0000-76b8-4fb0-9d2b-8c4f8d8a7e31` | Primario. Se anuncia el UUID para escaneo filtrado. |
| Información | `e13a0001-76b8-4fb0-9d2b-8c4f8d8a7e31` | Lectura, exactamente 20 bytes. Estable durante un arranque. |
| Medición y salud | `e13a0002-76b8-4fb0-9d2b-8c4f8d8a7e31` | Lectura y notificación, exactamente 20 bytes, con CCCD. |

- Enteros multibyte **little-endian**; con signo, complemento a dos. Los campos se serializan uno a uno, nunca como una estructura de C con relleno.
- **No hay comandos, texto libre, JSON, actualización remota ni escritura de umbrales.** Esa es la protección de configuración de v1: no existe superficie de escritura. El accesorio rechaza toda escritura distinta de la suscripción (CCCD). Si luego hacen falta comandos, requieren un contrato propio con confirmación y validación.
- Activar o desactivar la sesión es una acción **local** del cliente; la suscripción decide la recepción. El radar sigue adquiriendo y diagnosticando mientras el accesorio esté encendido.
- Nombre anunciado, UUID y RSSI **no autentican** al dispositivo.

## 2. Información (20 bytes, lectura)

| Desplazamiento | Tipo | Campo | Regla |
| --- | --- | --- | --- |
| 0 | u8 | versión mayor | `1`. |
| 1 | u8 | versión menor | `0`. |
| 2–3 | u16 | capacidades | bit 0 distancia; bit 1 azimut; bit 2 batería; bits 3–15 en cero. Capacidad no certifica exactitud. |
| 4–7 | u32 | identificador de arranque | Aleatorio por arranque y distinto del anterior. No es secreto ni autenticación. |
| 8, 9, 10 | u8 ×3 | firmware mayor, menor, revisión | Se registran en la evidencia de ensayo. |
| 11 | u8 | perfil de salida | `0` desconocido, `1` personas/seguimiento, `2` distancia a reflectores genéricos, `3` nube de puntos. |
| 12–13 | u16 | periodo nominal, ms | `> 0`. Objetivo `100`; no garantiza el intervalo recibido. |
| 14–15 | u16 | caducidad, ms | Exactamente `500` en v1.0. |
| 16–17 | u16 | distancia mínima, mm | Ventana o límite declarado por configuración. |
| 18–19 | u16 | distancia máxima, mm | Mayor que la mínima y ≤ 65534. |

Comprobaciones, **en este orden** (la primera que falla da el código; C++ y Swift lo cumplen igual):

1. longitud ≠ 20 → `longitudIncorrecta`
2. versión ≠ 1.0 → `versionIncompatible`
3. bits reservados de capacidades → `bitsReservados`
4. azimut sin distancia → `capacidadInconsistente`
5. perfil > 3 → `perfilInvalido`
6. periodo = 0 → `periodoInvalido`
7. caducidad ≠ 500 → `caducidadInvalida`
8. máximo ≤ mínimo o máximo > 65534 → `limitesInvalidos`

La Información válida con **perfil `0`** decodifica, pero **la sesión la rechaza** (`perfilDesconocido`): sin perfil no se sabe qué significa la medición.

### 2.1 Adaptación al SEN0395

El SEN0395 entrega presencia dentro de una ventana, sin distancia ni ángulo. Su Información es:

| Campo | Valor | Nota |
| --- | --- | --- |
| capacidades | `0x0000` | Sin distancia, sin azimut. Batería solo si hay estimación calibrada (bit 2). |
| perfil | `1` | Personas. |
| distancia mínima / máxima | ventana configurada en mm, p. ej. `0` / `3000` | **Sin capacidad de distancia, estos dos campos describen la ventana de presencia, no un alcance medido.** El ejemplo `3000` sale de la ventana por defecto del fabricante (`detRangeCfg -1 0 20`), no de un ensayo. |
| periodo / caducidad | `100` / `500` | |

Vector: `info-sen0395` en [`vectores.txt`](../../contratos/ble/vectores.txt).

## 3. Medición y salud (20 bytes, lectura y notificación)

| Desplazamiento | Tipo | Campo | Regla |
| --- | --- | --- | --- |
| 0 | u8 | versión mayor | `1`. La menor sale de Información. |
| 1 | u8 | banderas | Abajo. |
| 2–3 | u16 | secuencia | +1 por cada trama generada, también sin blanco o con fallo; módulo 65536. |
| 4–7 | u32 | identificador de arranque | Debe coincidir con la Información de esta conexión. |
| 8–11 | u32 | instante de emisión, ms | Reloj monotónico del ESP32 desde el arranque, módulo 2³². Una lectura genera el valor al atenderla; no devuelve una trama en caché. |
| 12–13 | u16 | distancia radial, mm | `0xFFFF` desconocida. |
| 14–15 | i16 | azimut, centésimas de grado | `−9000…9000`, negativo a la izquierda; `−32768` desconocido. |
| 16–17 | u16 | edad del resultado de radar, ms | Desde la recepción íntegra y validación de la trama del radar hasta la emisión. Satura en `65535` = desconocida o vencida. No mide la latencia interna del radar. |
| 18 | u8 | batería, % | `0…100` solo con estimación calibrada; `255` desconocida. |
| 19 | u8 | salud | Abajo. |

**Banderas:** bit 0 resultado de radar disponible y vigente · bit 1 blanco seleccionado · bit 2 distancia válida · bit 3 azimut válido · bit 4 batería baja (según umbral validado) · bit 5 simulación · bits 6–7 reservados, cero.

**Salud:** `0` sin fallo conocido · `1` iniciando o calibrando · `2` radar sin datos · `3` trama del radar inválida · `4` fallo declarado por el radar · `5` alimentación insuficiente · `6` montaje o configuración no validado. Otros valores son inválidos.

### 3.1 Coherencia exigida al decodificar

Comprobaciones **en este orden** (la primera que falla da el código):

1. longitud ≠ 20 → `longitudIncorrecta`
2. versión mayor ≠ 1 → `versionIncompatible`
3. bits 6–7 de banderas → `bitsReservados`
4. salud > 6 → `saludInvalida`
5. `banderasIncoherentes` si ocurre cualquiera de estas:
   - bits 1, 2 o 3 sin bit 0;
   - bit 2 sin bit 1; bit 3 sin bit 2;
   - salud ≠ 0 con cualquiera de los bits 0–3;
   - edad `65535` con cualquiera de los bits 0–3;
   - bit 4 con batería `255`.
6. `centinelaInconsistente`: distancia ≠ `0xFFFF` con bit 2 en cero (**`0` con bit 2 en cero es incoherente: nunca vale como «sin obstáculo»**), distancia `0xFFFF` con bit 2 activo, azimut ≠ `−32768` con bit 3 en cero, azimut `−32768` con bit 3 activo.
7. `valorFueraDeRango`: azimut válido fuera de ±9000; batería entre 101 y 254.
8. Contra la Información de la conexión:
   - `capacidadInconsistente`: bit 2 sin capacidad de distancia; bit 3 sin capacidad de azimut; batería conocida o bit 4 sin capacidad de batería;
   - `valorFueraDeRango`: distancia válida `0` o fuera de `[mínima, máxima]`.

El identificador de arranque **no** se compara al decodificar: es decisión de la sesión.

### 3.2 Reglas de codificación (las cumple el emisor)

- **Sin blanco:** bit 0 activo, bits 1–3 en cero, distancia y azimut desconocidos, salud `0`.
- **Presencia (SEN0395):** bits 0 y 1, bits 2–3 en cero, distancia `0xFFFF`, azimut `−32768`.
- **Fallo (salud ≠ 0), resultado vencido (edad > 500) o edad desconocida:** bits 0–3 en cero y medidas desconocidas. Una edad de 501 ms o más **nunca** se publica como vigente; una de 500 ms sí.
- **Simulación:** bit 5 activo. Nunca se presenta como medida física ni activa una sesión de uso real.
- Una distancia fuera de la ventana de Información se degrada a «presencia» (sin distancia válida) en vez de publicarse.
- Se notifica cada 100 ms nominales también sin blanco o con fallo. Una trama repetida del radar **no renueva su edad**.
- Elegir el reflector válido de menor distancia radial, y con empate el de menor azimut, solo aplica a radares con distancia; el SEN0395 no lo usa.

Ejemplo de §8.3 del informe (sintético): `01 0F 2A 00 44 33 22 11 E8 03 00 00 B0 04 48 F4 14 00 FF 00` con la Información `info-radar-completo`. Está en las pruebas de ambos lados.

## 4. Qué significa cada estado para el cliente

La sesión Swift expone `EstadoSesion`. Cada estado tiene una sola lectura posible:

| Estado | Significado | Qué no se puede decir |
| --- | --- | --- |
| `desconectada` | Sin conexión. | |
| `esperandoInformacion` | Enlace aceptado; falta leer y validar Información. | |
| `sincronizando` | Información válida; falta suscribir y la lectura fresca de referencia. | No hay avisos todavía. |
| `rechazada(motivo)` | Contrato o seguridad incumplidos. Terminal hasta nueva conexión. | Nunca «sin obstáculos». |
| `sinDatos(sinRecepcion)` | Más de 500 ms sin trama aceptada. | No se repite la última distancia. |
| `sinDatos(vencido)` | La cota de antigüedad de la trama, o de la última aceptada más el tiempo transcurrido, supera el límite. | |
| `sinDatos(sinResultado)` | Trama sana sin resultado vigente del radar (p. ej. fuente vencida). | |
| `radarNoDisponible(salud)` | Salud ≠ 0 (incluye «iniciando»). | No es «sin blanco». |
| `sinBlanco` | Radar sano y vigente sin detección. | **Nunca «camino libre»**; como mucho «sin detección en este momento». |
| `presencia` | Blanco dentro de la ventana. | Sin distancia ni dirección. |
| `objetivo(distancia, azimut?)` | Blanco con distancia y quizá ángulo. | |

Una sesión de demostración se crea con `modo: .simulada` y solo acepta tramas con el bit 5; una real solo acepta tramas sin él. La mezcla rechaza la sesión (`simulacionNoCoincide`). La interfaz debe rotular `esSimulada`.

## 5. Ciclo de vida

### 5.1 Orden obligatorio

1. Autorización del sistema.
2. Escaneo filtrado por el UUID del servicio.
3. Conexión **solo** al accesorio elegido por la persona (el identificador elegido se pasa a `SesionProximidad(accesorioElegido:)`; otro accesorio → `accesorioNoElegido`).
4. Enlace y política de autenticación ([sección 6](#6-autenticación-y-selección)) → `conectar(accesorio:enlace:)`.
5. Leer Información → `registrarInformacion`. Versión, capacidades o perfil inválidos rechazan de forma accesible; **no se negocia en silencio**.
6. Suscribirse a Medición.
7. Lectura **fresca** de Medición, midiendo `t0` justo antes de pedirla y `t1` al recibir la respuesta (reloj monotónico del iPhone) → `registrarReferencia`.
8. Solo entonces se activa la sesión. Las notificaciones que lleguen antes de la referencia se descartan (`sinReferencia`) y no disparan avisos.

**Aclaración de plataforma (iOS, EA-15). Es una propuesta del trabajo de software de EA-15: el responsable del contrato no la ha revisado ni aprobado.** Core Bluetooth entrega la respuesta de una lectura y cada notificación por el mismo callback (`didUpdateValueFor`), sin marca que diga cuál es cuál. Con la suscripción ya activa, una notificación emitida antes de pedir la lectura podría tomarse por la respuesta y anclar la referencia demasiado atrás: la cota de la [sección 5.2](#52-reloj-de-referencia-y-cota-de-antigüedad) **subestimaría** la demora BLE. Por eso el transporte de iOS, en lugar de los pasos 6 y 7 en ese orden, hace: (a) notificaciones **apagadas y confirmadas** por el sistema (si ya están apagadas, se confirma en local con `isNotifying`), (b) lectura fresca de referencia con `t0`/`t1` (paso 7), (c) notificaciones encendidas (paso 6). Lo que llegue como notificación antes de (c) no activa la sesión (paso 8). La misma secuencia sirve para la recalibración de 30 s, la vuelta del fondo y un identificador de arranque distinto.

- **Qué no cambia:** ningún byte, la política de autenticación por defecto (§6), el límite de 200 ms de la lectura, la cota y los 500 ms de frescura. La sesión recibe las mismas llamadas con los mismos datos.
- **Qué sí cambia:** el orden de los pasos 6 y 7. Mientras el responsable no lo apruebe, es una desviación de plataforma declarada, no una modificación del contrato.
- **Frontera conservadora y evidencia que falta:** apagar primero evita confundir una notificación con la lectura solo si una notificación ya en vuelo llega ANTES de la confirmación de «apagadas» (el enlace ATT es ordenado y Core Bluetooth debería entregar los avisos en ese orden, pero no lo documenta). Si llegara después y con la lectura ya pedida, se tomaría por la respuesta. Tampoco está medido el hueco de notificaciones de cada recalibración (apagar, leer, encender). Lo cierra el paso de banco «apagar, leer y encender cada 30 s» de [EA-12](ea-12-ble.md#guion-de-banco-pendiente-lo-ejecuta-h3-con-h1); no hay prueba con hardware.

**Segunda aclaración de plataforma (iOS, EA-15) — propuesta, pendiente de revisión por el responsable del contrato (H3). No está aprobada y no cambia el contrato.** El paso 4 pide el nivel del enlace *antes* de `conectar(accesorio:enlace:)`, pero Core Bluetooth no lo expone (§6). El transporte de iOS, entre el paso 3 y el 4, hace una **lectura protegida de comprobación** de Información: si el enlace no cumple los permisos GATT de la característica (cifrado y autenticado), el firmware responde «autenticación insuficiente» y iOS empareja por su cuenta (pide la clave a la persona) y repite la lectura. Solo cuando esa lectura termina sin error se llama a `conectar(accesorio:enlace:)`, con el nivel que afirma el transporte, que en iOS es siempre `desconocido` (§6): la lectura sirve para provocar el emparejamiento y para explicar los fallos, no para subir el nivel. El valor de esa lectura se descarta; la Información se lee de nuevo en el paso 5.

- **Qué no cambia:** ningún byte, la política por defecto, el orden de los pasos 5 a 8, la frescura. La sesión del contrato recibe las mismas llamadas.
- **Qué sí cambia:** una lectura más de Información (20 bytes) por conexión, una espera con plazo propio (35 s propuestos, sin medir; la persona puede estar escribiendo la clave) y, ante error, corte o plazo, la sesión **no se abre** y no se reconecta sola (cada intento volvería a pedir la clave).
- **Evidencia que falta:** que iOS pida la clave en esa lectura, qué error entrega al cancelar, con clave incorrecta o con el vínculo borrado en la placa, y si la solicitud deja la escena inactiva. Todo es de banco (ver ea-15-ios-ble-audio.md, «Seguridad del enlace»).

### 5.2 Reloj de referencia y cota de antigüedad

No se resta el reloj del iPhone del reloj del ESP32. Con la referencia `(t0, t1, m_ref)`, para una trama con instante de emisión `m` recibida en `t`:

```text
delta  = (m − m_ref) mod 2³²                (debe ser < 2³¹)
cota   = max(0, (t − t0) − delta) + edad_radar
se acepta como vigente si cota + 20 ms ≤ 500 ms
```

- Se usa la cota **inferior** del desfase (`t0 − m_ref`): así la cota sobrestima la edad y nunca la subestima.
- Si `t1 − t0 > 200 ms` la sesión no se activa (`lecturaReferenciaLenta`) y se reintenta. 200 ms exactos pasan.
- La referencia se repite cada **30 s** (`necesitaReferencia`) y al volver del fondo (`reanudar` invalida el ancla temporal, la cota y el estado, y vuelve a `sincronizando`; **conserva la secuencia**, §5.3).
- `delta ≥ 2³¹` (trama emitida antes de la referencia) se descarta (`emisionAnteriorAReferencia`). Esto cubre también las mediciones previas a la conexión vigente.
- Si el instante de emisión retrocede respecto de la última trama aceptada, se descarta (`relojRetrocede`).
- Las dos reglas anteriores valen **también para una referencia de recalibración**: se comprueban contra la referencia vigente y la última trama aceptada **antes** de reemplazar el ancla o consumir secuencia. Una referencia descartada deja intactos estado, referencia, secuencia y pérdidas. La comparación es módulo 2³², así que cruzar la vuelta del reloj es válido. La primera referencia de una sesión, o la que sigue a `reanudar`, no tiene ancla temporal con la que compararse (sí secuencia: §5.3).
- **La cota sigue corriendo.** Una trama aceptada con cota `c` en el instante de recepción `t` deja de ser vigente en cuanto `c + (ahora − t) + 20 ms > 500 ms`. `evaluar(ahoraMs:)` lo aplica con el reloj monotónico del iPhone y pasa a `sinDatos(vencido)`; con total 500 exacto sigue vigente. Vale igual para `objetivo`, `presencia` y `sinBlanco`.
- El borde está en los vectores: cota 480 pasa, 481 no (`dato-vencido-por-retraso-ble`, `dato-vencido-por-edad-del-radar`).

Esto acota solo la **demora BLE y la edad que declara el accesorio**. No estima la adquisición física dentro del radar, que no publica el instante de captura: esa demora se mide de extremo a extremo en banco (B2). Si no puede acotarse con este sensor, el requisito de latencia queda incumplido.

### 5.3 Secuencia

Una trama nueva se acepta solo si `(secuencia − última) mod 65536` está entre 1 y 32767.

- `0` → `secuenciaRepetida`; mayor que 32767 → `secuenciaAnterior`. Una trama descartada por secuencia o por reloj no cambia el estado ni renueva nada.
- Un salto se acepta y suma a `tramasPerdidas` (`diferencia − 1`).
- La base de secuencia es independiente de la referencia. La primera trama aceptada de una conexión, o tras un identificador de arranque distinto, la fija sin comparar. Desde entonces **toda** trama sigue la regla, incluida la primera referencia posterior a `reanudar`: `reanudar` borra el ancla temporal, no la secuencia.
- Tras `reanudar`, una referencia con la última secuencia (`secuenciaRepetida`) o anterior (`secuenciaAnterior`) se descarta y la sesión sigue en `sincronizando`; con una nueva se establece el ancla, y la vuelta válida 65535 → 0 también. Los saltos durante la suspensión suman a `tramasPerdidas`.
- Solo una conexión nueva (`conectar`, `desconectar`) o un arranque distinto crean una sesión de secuencia nueva y admiten una base nueva.
- Una trama vencida por la cota consume su secuencia y pasa a `sinDatos(vencido)`; reproducirla después es una repetición.
- Valor leído y notificación pueden llegar intercalados: gobiernan reloj y secuencia, no el orden de los callbacks.

### 5.4 Reinicio, reconexión y latido

- **Identificador de arranque distinto** en cualquier trama (incluida la referencia): se invalida referencia, medidas y cola, y se vuelve a `esperandoInformacion`. Hay que releer Información (`arranqueDistinto`).
- **Cada reconexión es una sesión nueva** (`conectar` reinicia todo) y vuelve a suscribir. No se reproducen avisos históricos.
- **Latido de recepción:** con ejecución nativa activa, `evaluar(ahoraMs:)` pasa a `sinDatos(sinRecepcion)` si pasan **más de 500 ms** sin trama aceptada (500 exactos no vencen). Es independiente de la cota: también rige para `radarNoDisponible`, que no lleva resultado. Si hay silencio de más de 500 ms con resultado vigente, el motivo es `sinRecepcion`; si la cota se agota antes, `vencido`. Tras una pérdida nunca se repite la última distancia.
- Como el accesorio notifica cada ~100 ms, la ausencia de notificaciones **es** el latido del enlace. El latido de la **fuente** (UART del radar) es otra cosa: ver [sección 7](#7-sen0395-conflicto-de-1-hz-y-b2).
- Cuánto tarda iOS en permitir ejecutar el módulo tras una suspensión se mide aparte.

### 5.5 Trama inválida

Cualquier trama de Medición que viole la [sección 3.1](#31-coherencia-exigida-al-decodificar) **rechaza la sesión** (`medicionInvalida(código)`), sin reutilizar el estado previo; hay que reconectar. Es una violación del contrato, no un ruido transitorio: el enlace BLE ya protege la integridad, y la v1.0 no interpreta lo desconocido.

## 6. Autenticación y selección

**Política explícita y cerrada ante dudas.** El núcleo recibe del transporte un `NivelEnlace` y una `PoliticaAutenticacion`:

| Nivel afirmado por el transporte | `exigirAutenticado` (predeterminada) | `permitirAsociacionSinMITM` |
| --- | --- | --- |
| `cifradoAutenticado` | acepta; `enlaceAutenticado == true` | acepta; `enlaceAutenticado == true` |
| `cifradoSinAutenticar` | **rechaza** | acepta; `enlaceAutenticado == false` |
| `sinCifrar` | **rechaza** | **rechaza** |
| `desconocido` | **rechaza** | **rechaza** |

- `permitirAsociacionSinMITM` es solo para banco o demostración. La sesión queda marcada como **no autenticada**; la interfaz no debe presentarla como autenticada. Es el límite que el informe §8.5 manda declarar.
- Sin dato (`desconocido`) se rechaza. **Core Bluetooth no expone el nivel de seguridad del enlace**: qué evidencia permite afirmar `cifradoAutenticado` (p. ej. que la lectura de una característica con permiso cifrado y autenticado tenga éxito) es parte de EA-12 y debe probarse con la placa y el iPhone. Hasta entonces, el transporte debe pasar `desconocido`, y la sesión no se activa.
- **Propuesta (EA-15), pendiente de revisión por el responsable del contrato (H3); no aprobada.** El ejemplo de evidencia de la viñeta anterior («que la lectura de una característica con permiso cifrado y autenticado tenga éxito») **no basta para `cifradoAutenticado` en iOS**: un periférico sin protección que anuncie el mismo nombre y UUID y sirva las mismas características responde igual, y iOS nunca empareja con él. La app no ve la diferencia (nombre, UUID y RSSI no autentican, §1; y no se inventa criptografía). Tampoco prueba el cifrado: un periférico sin cifrar la supera, y el contrato rechaza `sinCifrar` con las dos políticas. Propuesta: el transporte de iOS afirma **siempre `desconocido`**, con o sin esa lectura (que solo provoca el emparejamiento y explica fallos), y nunca `cifradoAutenticado` ni `cifradoSinAutenticar`: no hay evidencia al alcance de la app que los respalde. Consecuencia: la sesión no se activa en iOS con ningún accesorio, ni con la placa genuina, con ninguna de las dos políticas. **Decisión abierta (usuario y H3), que esta propuesta no toma:** para mostrar el accesorio real en la feria harían falta dos cambios juntos, que el transporte afirme `cifradoSinAutenticar` tras la lectura (con «cifrado» sin probar frente a un impostor sin cifrar) y que la política pase a `permitirAsociacionSinMITM` (sesión marcada no autenticada y dicho en la interfaz); con ellos un impostor cercano con el mismo nombre y UUID pasaría igual que la placa genuina. Esta propuesta no cambia la política por defecto.
- **El fixture no prueba un enlace autenticado.** Los escenarios `autenticacion-*` prueban la política de la sesión dado un nivel *declarado*; no pueden demostrar emparejamiento, cifrado ni protección frente a intermediario.
- Alta propuesta (EA-12, no implementada aquí): botón físico durante 60 s, clave propia del accesorio, vínculo conservado y borrado físico explícito. No se inventa criptografía y no se publica la clave. Ni cifrado ni número de versión evitan bloqueo de radio, fallo del sensor o identidad falsa durante un alta mal resuelta; esos fallos nunca equivalen a «sin obstáculos».
- No se añade CRC de aplicación: sigue siendo obligatorio validar estructura y semántica.

## 7. SEN0395, conflicto de 1 Hz y B2

El SEN0395 emite `$JYBSS,0, , , *` o `$JYBSS,1, , , *` a **1 Hz** por la UART. La caducidad de v1.0 es 500 ms. Con la UART como única fuente, la edad del resultado supera 500 ms durante cerca de la mitad de cada segundo.

**Lo que este contrato fija, sin depender de B2:**

- **v1.0 se mantiene estricta: caducidad 500 ms.** El cliente rechaza otro valor (`caducidadInvalida`). No se amplía para acomodar al sensor.
- **Nunca se acepta una trama UART vieja como vigente.** El emisor publica «vencido» (bit 0 en cero) cuando `edad_radar > 500`, y el cliente aplica además su propia cota. Vectores: `emision-sen-uart-1hz-vencida` y `med-sen-resultado-vencido-en-origen`. Con solo la UART el iPhone vería `sinDatos(sinResultado)` buena parte del tiempo: es el conflicto real, no un defecto del cliente.
- **Latido de la fuente.** Un pin GPIO2 quieto en bajo no distingue «nadie» de «sensor caído». La trama UART es el latido: sin trama válida en **2,5 s** el firmware publica salud `2` aunque el pin diga otra cosa. (Umbral de diseño, por confirmar en B1/B2.)

**Lo que sigue provisional hasta B2:**

- La **opción 1** del [plan de firmware](plan-firmware.md#consecuencias-para-metas-y-contrato) — leer el pin GPIO2 cada 100 ms y definir `edad_radar` desde el último muestreo del pin, con la UART como latido y para órdenes — se conserva como **provisional**. Solo vale si B2 muestra que el pin cambia antes que la trama. Este trabajo **no tiene mediciones**: no confirma que lo haga.
- Si B2 muestra que el pin no cambia antes, la opción 2 (v1.1 con otra caducidad) tampoco mejora el aviso: solo aceptaría datos más viejos. El requisito de retardo quedaría incumplido con este sensor y se declararía así.
- El retardo `outputLatency` por defecto (2,5 s al detectar) ya incumple por sí solo p95 ≤ 300 ms; el firmware lo baja al mínimo que B2 muestre estable.

Definición de `edad_radar` para el emisor: tiempo desde la **última observación íntegra y validada de la fuente de presencia** hasta la emisión. Con la UART, desde la última trama `$JYBSS` completa; con el GPIO (si B2 lo adopta), desde el último muestreo del pin con latido UART vigente. Una repetición no renueva la edad.

## 8. Fixtures y matriz de cobertura

Archivos en [`contratos/ble/`](../../contratos/ble/), texto plano de líneas con campos separados por espacios, fácil de leer con la biblioteca estándar de C++ y de Swift (sin JSON). Los generó un script de `struct.pack` en Python independiente de ambas implementaciones; las tramas son bytes literales.

| Archivo | Contenido | Quién lo ejecuta |
| --- | --- | --- |
| `vectores.txt` | 22 `info`, 51 `med`, 11 `emision` | C++ codifica, decodifica y regenera; Swift decodifica y comprueba la receta |
| `sesiones.txt` | 61 escenarios de sesión | Swift ejecuta la sesión completa; C++ comprueba cada trama con su decodificador (`decod=`) |

Cada `info`/`med` lleva el resultado esperado: campos decimales (`ok`) o código de error (`error`). Los casos válidos se **recodifican** en C++ y deben dar los mismos bytes.

| Exigencia del issue | Dónde está |
| --- | --- |
| Trama válida / presencia / sin blanco / fallo / simulación | `med-sen-*`, `med-completo-*`, `emision-*`, escenarios `activacion-*`, `fallo-radar-*`, `sesion-simulada-aislada` |
| Longitud incorrecta | `info-longitud-*`, `med-longitud-*` |
| Versión incompatible | `info-version-*`, `med-version-*`, `informacion-invalida-version-*` |
| Valor inválido (bits, rangos, capacidades, centinelas, salud) | `med-bit*`, `med-salud-*`, `med-azimut-*`, `med-bateria-*`, `med-distancia-*`, `medicion-invalida-*` |
| Reinicio | `reinicio-del-accesorio`, `referencia-con-arranque-distinto`, `emision-reinicio-arranque` |
| Salto, repetición, anterior, desorden, vuelta | `repeticion-orden-y-salto`, `vuelta-de-secuencia`, `limite-de-media-vuelta-de-secuencia`, `vuelta-del-reloj-del-accesorio`, `reloj-del-accesorio-retrocede`, `recalibracion-con-reloj-que-retrocede`, `recalibracion-cruza-vuelta-del-reloj` |
| Dato vencido o retrasado | `dato-vencido-por-*`, `cota-vigente-*`, `silencio-largo-con-resultado-vigente`, `caducidad-por-tiempo-de-recepcion`, `emision-sen-uart-1hz-vencida` |
| Reconexión, medición previa a la conexión | `reconexion-crea-sesion-nueva`, `emision-anterior-a-la-referencia`, `reanudar-desde-suspension`, `reanudar-conserva-la-secuencia`, `reanudar-cruza-vuelta-de-secuencia`, `reanudar-y-reconexion-permiten-base-nueva`, `reanudar-y-arranque-distinto-permiten-base-nueva`, `recalibracion-*` |
| Aislamiento de simulación | `simulacion-*`, `sesion-simulada-aislada` |
| Autenticación fail-closed, accesorio elegido | `autenticacion-*`, `accesorio-no-elegido` |

Las pruebas de Swift comprueban además que **cada** código de `ErrorContrato` aparece en algún vector y que los escenarios pasan por los estados principales.

Ejecutar:

```bash
make -C firmware probar                     # C++, necesita g++
swift test --package-path ios/ContratoBLE   # Swift, macOS o Linux con Swift
```

CI: [`.github/workflows/contrato-ble.yml`](../../.github/workflows/contrato-ble.yml) (`firmware` en Linux y `swift` en macOS; este último conserva el registro, los vectores, la huella SHA-256 y el commit como artefacto).

## 9. Qué precisa este documento respecto del informe

Decisiones tomadas al congelar. Ninguna cambia la distribución de bytes de §8.2/§8.3; todas son reglas de validación o de sesión.

1. **Orden fijo de comprobaciones y nombres de error** (secciones 2 y 3.1), idénticos en C++ y Swift.
2. **Distancia válida `0` se rechaza** aunque la ventana empiece en 0 (§8.3 pide no confundir cero con sano).
3. **Perfil `0`** decodifica pero impide activar la sesión; el informe decía «impide avisos de distancia».
4. **Resultado vencido en origen** (`edad > 500`): bit 0 en cero y salud `0` es válida y se muestra como `sinDatos(sinResultado)`.
5. **Trama inválida rechaza la sesión** (sección 5.5).
6. **Tramas descartadas por secuencia o reloj no cambian el estado**; una vencida por la cota sí lo pasa a `sinDatos(vencido)`, y una con otro arranque a `esperandoInformacion`.
7. **`delta ≥ 2³¹`** se trata como emisión anterior a la referencia; la recalibración cada 30 s evita llegar a la media vuelta del reloj (~24,8 días).
8. **Política de autenticación** de tres niveles y sin dato = rechazo (sección 6).
9. **Los vectores viven en `contratos/ble/`**, no en `firmware/vectores/` como proponía el plan de firmware.

## 10. Pendiente y puertas

| Pendiente | Responsable propuesto | Cómo se cierra |
| --- | --- | --- |
| B2: ¿el GPIO2 cambia antes que la trama? ¿retardo real? | H2 / H1 (EA-11) | Medición de banco; decide el conflicto de 1 Hz (sección 7). Hasta entonces la opción 1 es provisional. |
| Trama real del SEN0395 y salud ante desconexión | H2 (B1) | Captura de UART cruda. |
| Enlace cifrado y autenticado real, y qué evidencia lo afirma en iOS | H3 (EA-12) | Prueba con la placa y el iPhone. |
| Propuesta EA-15: lectura protegida de comprobación antes de `conectar(accesorio:enlace:)` (§5.1) y transporte de iOS que afirma siempre `desconocido` (§6) — **pendiente de revisión por el responsable del contrato (H3)** | Responsable del contrato, con H3 (EA-12) y el usuario | Revisar §5.1 y §6; decidir para la feria qué afirma el transporte tras la lectura y si la política pasa a `permitirAsociacionSinMITM` (las dos cosas juntas); ejecutar el procedimiento de banco de ea-15-ios-ble-audio.md («Seguridad del enlace»). Sin revisión sigue siendo una propuesta de software. |
| Orden de la referencia y la suscripción en iOS (aclaración de la [sección 5.1](#51-orden-obligatorio)) | Responsable del contrato, con H3 (EA-12) | Revisar la aclaración propuesta y ejecutar el paso de banco de 30 s de EA-12. Sin revisión y sin evidencia sigue siendo una propuesta de software. |
| Transporte Core Bluetooth que use `SesionProximidad` | A2 (EA-11/EA-12) | Código y prueba en el iPhone desde el 11/11. |
| Apertura manual del proyecto en Xcode (CI del paquete y la app ya verde) | A1 / A2 | El job de CI pasó en `97b7e819` ([ejecución](https://github.com/ZuluCode777/proyecto-1-APP/actions/runs/42345095722): 1054 comprobaciones de C++ + 7 pruebas de Swift en macOS). La integración en la app ya se comprobó en la [ejecución iOS](https://github.com/ZuluCode777/proyecto-1-APP/actions/runs/42345095644); falta abrir el proyecto a mano en Xcode. |
| Pines, cableado y firmware de placa | H3 (EA-12) | `firmware/README.md` una vez recibida la placa. |

Este trabajo **no cierra el issue #30**: deja el contrato congelado y verificable por software; la evidencia física sigue pendiente.
