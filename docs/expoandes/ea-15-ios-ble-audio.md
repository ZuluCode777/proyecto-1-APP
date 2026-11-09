# EA-15: accesorio real y avisos por auriculares en el iPhone (software)

Estado al **9 de noviembre de 2026**. Issue: [#41](https://github.com/ZuluCode777/proyecto-1-APP/issues/41). Este documento describe el **software** que prepara EA-15 (`ios/TransMiVoz/Accesorio/`). **No hay prueba física**: nadie ha conectado un iPhone a una placa, oído un aviso por auriculares ni medido latencia. Que compile y pase en CI **no prueba** el enlace, la seguridad, el audio real ni el comportamiento del sistema. EA-15 **sigue abierta**; los criterios que exigen hardware están en la [lista de banco](#lista-de-banco-pendiente).

Manda el [contrato BLE v1.0](contrato-ble.md): no cambia (ni bytes, ni versión, ni política por defecto, ni vectores). El firmware y su seguridad son [EA-12](ea-12-ble.md).

## Lo primero: los avisos del sensor están bloqueados

Core Bluetooth **no expone el nivel de seguridad del enlace**. El contrato (§6) manda que el transporte afirme `NivelEnlace.desconocido` hasta que haya evidencia con la placa y el iPhone, y que la sesión no se active. Aquí:

- `TransporteCoreBluetooth.nivelEnlace` es siempre `.desconocido`. No hay ajuste, bandera ni preferencia que lo cambie, ni se deduce del nombre, del UUID, de la elección de la persona, de una lectura que funcione ni de las propiedades de la característica.
- `SesionAccesorioModelo` crea la sesión con `.exigirAutenticado` fijo. En cuanto el accesorio conecta, `SesionProximidad.conectar` la rechaza (`rechazada(enlaceNoAutenticado)`); la app cierra el enlace y **no lee Información ni se suscribe**.
- La pantalla lo dice («Bloqueado: enlace no verificado», aviso fijo en la cabecera) y la voz dice «Avisos bloqueados». Ninguna medida se muestra ni se dice; tampoco «sin detección».
- Efecto buscado y a la vez límite: **con esta versión no se puede ver un objetivo real en el iPhone.** El camino completo (Información, referencia, notificaciones, avisos hablados) existe y se prueba solo con un doble de prueba (`TransporteFalso`) que declara `cifradoAutenticado`. Ese doble vive en las pruebas, no en la app.
- Cómo se levantará el bloqueo: con una decisión explícita posterior y evidencia de banco (tabla de [contrato §10](contrato-ble.md#10-pendiente-y-puertas)), cambiando `nivelEnlace` en un solo sitio. No se hace aquí. Mientras tanto la app, por diseño, tampoco puede provocar el emparejamiento de iOS (que se dispara al leer una característica protegida), así que la evidencia de seguridad se reúne con una herramienta de banco (p. ej. nRF Connect), no con esta app.

## Capas

| Capa | Archivo | Dueño de |
| --- | --- | --- |
| Transporte | `TransporteCoreBluetooth` | Escaneo filtrado por el UUID del servicio, conexión al periférico elegido, descubrimiento de servicio y características, lectura y notificación. Un solo periférico vigente; ignora callbacks de otro. Solo bytes. |
| Clasificación | `ClasificadorValores` | Core Bluetooth entrega lectura y notificación por el mismo callback. Reparte cada valor y descarta respuestas de lecturas ya superadas. |
| Sesión | `SesionAccesorioModelo` | Máquina de pasos, tokens de conexión, tiempo límite, recalibración, ciclo de vida. Delega toda validación en `SesionProximidad` (paquete `ContratoBLE`); no repite lógica del contrato. |
| Voz | `ControlVoz` (política) y `SintetizadorSistema` (AVSpeechSynthesizer + AVAudioSession) | Ruta, interrupciones, cola de uno. El iPhone es el dueño del audio; el ESP32 solo manda datos. |
| Texto | `TextoAccesorio` | Estado visible, título, icono y locución de cada estado. |
| Pantalla | `SesionAccesorioVista` | Elegir, iniciar, detener, reconectar, estado. |

Funciona sin red, backend, GPS ni micrófono.

## Sincronización y por qué difiere en un punto del orden del contrato

Orden de la sesión: Información → notificaciones **apagadas** y confirmadas → lectura fresca de referencia (`t0`/`t1` con el reloj monotónico) → notificaciones encendidas.

El contrato (§5.1) lista la suscripción **antes** de la lectura de referencia. Core Bluetooth entrega la respuesta de una lectura y cada notificación por `didUpdateValueFor`, sin marca que las distinga. Con la suscripción activa, una notificación emitida antes de pedir la lectura podría tomarse por la referencia; entonces la cota de antigüedad (`(t − t0) − delta`) **subestimaría** la demora BLE. Por eso la referencia se pide con las notificaciones apagadas, y el mismo procedimiento se usa para la recalibración (cada 30 s), la vuelta al primer plano y el reinicio del accesorio. No cambia ningún byte ni ninguna regla del contrato: la sesión recibe las mismas llamadas (`registrarInformacion`, `registrarReferencia`, `recibirNotificacion`). **Por confirmar en banco:** que `setNotifyValue(false)` produzca `didUpdateNotificationStateFor` (si no, la sesión falla por tiempo con «el accesorio no respondió a tiempo» en vez de continuar sin referencia) y cuánto dura el hueco de notificaciones en cada recalibración.

## Qué se descarta

- **Token por conexión.** Cada conexión (inicio, reconexión, cambio de accesorio, vuelta del Bluetooth) lleva un token nuevo. Todo evento con otro token se descarta en la sesión; el transporte además ignora callbacks de un periférico que ya no es el vigente.
- **Detener, cambiar de accesorio, fallo, rechazo o desconexión** suben el token, cancelan el temporizador y cortan la voz: no queda tarea ni aviso pendiente.
- **Lecturas.** Solo cuenta la respuesta a la última lectura pedida; las anteriores llegan tarde y se descartan. No se pide lectura con notificaciones activas.
- **Referencia.** Más de 200 ms entre `t0` y `t1`, repetida, anterior o con reloj hacia atrás: se pide otra (hasta 3) y luego falla. Un identificador de arranque distinto relee la Información. Todo esto lo decide `SesionProximidad`.
- **Silencio.** Pasos con respuesta pendiente más de 5 s fallan («no respondió a tiempo»). Una conexión pendiente no caduca: queda en «Conectando».
- **Desconexión inesperada:** estado «Desconectado», sesión nueva e intento de reconexión automático. Un fallo de conexión **no** se reintenta solo; hay que usar Reconectar.

## Estados visibles y hablados

Conectado, calibrando, sin detección, fallo y desconectado tienen título, icono, descripción y locución distintos (no dependen del color). Además: sin accesorio, detenido, Bluetooth no disponible (apagado, sin permiso, restringido, no soportado), conectando, enlace no verificado, accesorio rechazado, presencia, objeto, sin datos y radar no disponible. «Sin detección» nunca se dice como «camino libre». La distancia hablada se redondea a medio metro y el lado a tres sectores (izquierda, al frente, derecha): la exactitud del radar no está certificada.

## Audio

- **Solo por auriculares.** Se habla únicamente si **todas** las salidas de la ruta son auriculares con cable o Bluetooth, consultado en cada locución. Altavoz, receptor y cualquier otra salida silencian; el estado queda en pantalla («Audio: sin auriculares…»). Límite: el sistema no distingue unos auriculares Bluetooth de un altavoz Bluetooth; USB, AirPlay y coche cuentan como no privados.
- **Cola de uno.** Cada locución corta la anterior; nada se acumula.
- **Cortes.** Cualquier cambio de ruta, pérdida de auriculares, interrupción (llamada, Siri…) o reinicio de los servicios de medios corta la voz y descarta lo pendiente. Al volver los auriculares o terminar la interrupción no se reproduce nada pendiente: se dice solo el estado de ese momento.
- Sesión de audio: categoría `playback`, modo `voicePrompt`, baja el volumen de lo demás mientras habla y se libera al terminar. Si no se puede configurar o activar, no se habla.
- Los avisos hablados no usan VoiceOver ni la pantalla; con VoiceOver activo, las locuciones de la app se suman a su lectura. La pantalla no emite anuncios de VoiceOver por cada cambio.

## Primer plano, bloqueo y segundo plano

No se declara ningún modo de segundo plano (`UIBackgroundModes`) ni se promete funcionamiento fuera de primer plano; una prueba lo comprueba. Con la escena inactiva, bloqueada o en segundo plano la sesión se **suspende**: corta la voz, deja de procesar tramas y para el temporizador y la búsqueda. Al volver a activa: si la sincronización estaba completa, `reanudar()` del contrato invalida el estado y se pide una referencia nueva (la secuencia se conserva); si estaba a medias o el enlace se perdió, se reconecta de cero. **Consecuencia honesta:** bloquear la pantalla con el iPhone en el bolsillo detiene los avisos. Las pausas cortas de `inactive` (centro de control, avisos del sistema) hacen lo mismo.

## Permisos

El gestor de Bluetooth se crea al primer uso (buscar o iniciar), no al abrir la app, para que el aviso del sistema salga cuando la persona lo pide. Texto del permiso: `NSBluetoothAlwaysUsageDescription` (en el proyecto). Estados con mensaje propio: apagado, sin permiso (con botón «Abrir Ajustes»), restringido, no soportado. Si se apaga el Bluetooth con la sesión en marcha, se invalida todo y, al volver, se reconecta.

## Pruebas

En `ios/TransMiVozTests/` (XCTest, deterministas: transporte, voz, ruta y reloj falsos):

- `SesionAccesorioModeloTests`: flujo completo con las tramas de `contratos/ble/sesiones.txt` (los mismos bytes de Swift y C++); orden de llamadas al transporte; bloqueo con cada nivel de enlace que no es autenticado (sin leer ni suscribir); eventos de una conexión anterior; detener y cambiar de accesorio; notificaciones antes de la referencia; referencia de 200 y 201 ms y tope de 3; reinicio del accesorio; recalibración; latido; tiempo límite; desconexión y reconexión sin avisos históricos; Bluetooth apagado y sin permiso; escena inactiva, vuelta y enlace caído durante la suspensión; sin auriculares, interrupción.
- `AudioYTextoAccesorioTests`: política de ruta, cola de uno, corte por cambio de ruta e interrupción, clasificador de valores de Core Bluetooth, textos, y que el proyecto no declare modos de segundo plano y sí el texto del permiso.

**No cubren:** `TransporteCoreBluetooth`, `SintetizadorSistema` y `MonitorAudioSistema` (necesitan Core Bluetooth y el audio reales; solo pasan por la compilación de CI), ni la pantalla (no hay prueba de interfaz ni auditoría de accesibilidad de `SesionAccesorioVista`: las pruebas de interfaz siguen usando la sesión **simulada**, rotulada, que sigue disponible solo con `-PRUEBAS_UI_SIMULADAS`). Estas pruebas son de lógica, no de hardware.

## Lista de banco pendiente

Con la placa de [EA-12](ea-12-ble.md), un iPhone con firma (EA-09), auriculares con cable y Bluetooth. Registrar commit, iOS, modelo y resultado de cada punto.

1. **Seguridad.** Con una herramienta de banco, repetir el guion de seguridad de EA-12 y decidir con evidencia qué puede afirmar `nivelEnlace`. Hasta entonces comprobar que la app, conectada a la placa, muestra «Bloqueado: enlace no verificado», no lee Información y no dice ninguna medida.
2. **Permisos y Bluetooth.** Primer uso con permiso denegado (mensaje y «Abrir Ajustes»), permiso concedido, Bluetooth apagado, apagarlo y encenderlo con la sesión en marcha.
3. **Búsqueda y elección.** Lista de accesorios cercanos, elegir uno, cambiar a otro con la sesión en marcha, dos accesorios a la vez.
4. **Sincronización** (cuando se levante el bloqueo): `setNotifyValue(false)` devuelve el aviso de estado; lectura de referencia ≤ 200 ms en el 95 % de los casos; hueco por recalibración; reinicio de la placa a mitad de sesión.
5. **Audio.** Auriculares con cable y Bluetooth; desconectarlos hablando (debe cortar en seco); altavoz (silencio); llamada entrante y colgar; Siri; alarma; cambiar de auriculares; otra app con audio (baja de volumen y vuelve).
6. **Ciclo de vida.** Bloquear y desbloquear, centro de control, cambiar de app, matar la app, alejar la placa y volver: sin avisos viejos y con estado «Desconectado» o «Calibrando» según el caso.
7. **Accesibilidad real.** VoiceOver, tamaño de texto máximo, Control por voz y botones; que lo dicho por la app y por VoiceOver no se pise.
8. **Latencia** sensor → oído: la mide EA-20; aquí solo se anotan las observaciones.

## Pendiente que este trabajo no cierra

Evidencia de banco de todo lo anterior; qué afirma `cifradoAutenticado` en iOS; prueba de interfaz y auditoría de `SesionAccesorioVista`; reconexión con espera escalonada (hoy es un intento inmediato); si hace falta un modo de segundo plano (exigiría justificar el alcance, la batería y una nueva revisión; hoy no se pide). Este trabajo usa `Refs #41`: **no cierra el issue**.
