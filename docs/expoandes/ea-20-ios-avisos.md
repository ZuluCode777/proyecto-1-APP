# EA-20: avisos locales del iPhone con prioridad, deduplicación, caducidad y control de audio (software)

Estado al **12 de noviembre de 2026**. Issue: [#46](https://github.com/ZuluCode777/proyecto-1-APP/issues/46). Describe el **software** de `ios/TransMiVoz/Avisos/` y la pestaña Avisos. **No hay prueba física**: nadie ha oído estos avisos por auriculares, con VoiceOver, en una llamada ni con la pantalla bloqueada. Que compile y pase en CI no prueba nada de eso. Los criterios que lo exigen están en la [lista de banco](#lista-de-banco-pendiente).

## Qué hay

Un módulo local, `CentroAvisos`, por el que pasa todo aviso antes de la voz y de la lista. La voz sigue siendo de `ControlVoz` (`PoliticaAudio.swift`) y `SintetizadorSistema` (`AudioSistema.swift`): no hay un segundo dueño del audio.

| Clase (`TipoAviso`) | Severidad | Quién la produce hoy | Texto |
| --- | --- | --- | --- |
| Pérdida del accesorio | Urgente | `SesionAccesorioModelo`: desconectado, fallo, rechazado, enlace bloqueado, Bluetooth no disponible | El de `TextoAccesorio.locucion` |
| Dato vencido | Urgente | `SesionAccesorioModelo`: sin datos del sensor, radar no disponible | El de `TextoAccesorio.locucion` |
| Proximidad | Urgente | `SesionAccesorioModelo`: objeto, presencia | El de `TextoAccesorio.locucion` |
| Red caída | Advertencia | Resultado de la consulta `sinConexion`, observado desde `RaizVista` (`CentroAvisos.consultaCambio`) | `TextoAvisos.redCaida` |
| Datos viejos | Advertencia | Respuesta con `catalogo.antiguo` (EA-17), mismo puente | `TextoAvisos.datosViejos` |
| GPS impreciso | Advertencia | **Nadie todavía**: la app no usa ubicación (no hay CoreLocation ni permiso). La clase y su texto existen para quien integre la ubicación (#51) con `centro.emitir(.gpsImpreciso, TextoAvisos.gpsImpreciso)` (prueba `testElGpsImpreciosoSeEmiteComoAdvertenciaDeLaUbicacionConSuTexto`). El texto dice solo el hecho: «Tu ubicación es imprecisa.» | `TextoAvisos.gpsImpreciso` |

Los estados de rutina de la sesión (conectando, comprobando el enlace, calibrando, sin detección) no son avisos: siguen diciéndose, pero con prioridad de rutina.

## Reglas

- **Una emisión activa, con prioridad.** `ControlVoz.anunciar(_:prioridad:)` recibe `PrioridadVoz` (`rutina`, `advertencia`, `urgente`). Una locución de más prioridad corta a una de menos que suene; una de menos prioridad **no** corta ni calla a una de más que todavía suena (queda en pantalla y en la lista); con la misma, la nueva reemplaza a la anterior (la cola sigue siendo de uno). Sin `prioridad` el valor es `rutina`: el comportamiento de antes.
- **Un mensaje de rutina que cede se reintenta.** La sesión no gasta nada al ceder y el siguiente latido (100 ms) dice el estado de ese momento, sin los intermedios.
- **Deduplicación.** Un aviso igual (clase y texto) al vigente de su fuente no se repite ni se lista de nuevo; solo renueva su vigencia (si la tiene). La sesión repite el estado de ahora al volver el audio con `repitiendo: true`.
- **Caducidad.** Los avisos de la **sesión** (pérdida del accesorio, dato vencido, proximidad) **no caducan por tiempo**: siguen vigentes mientras dure su estado y `SesionAccesorioModelo` los cierra con `CentroAvisos.retirar` cuando el estado deja de ser un aviso (rutina, sin locución, detener o suspender). Un temporizador los daría por vencidos con el objeto todavía delante o el accesorio todavía perdido; si dejan de llegar tramas, la propia sesión baja a «sin datos» y eso cierra la proximidad. Los de la **consulta** y la **ubicación** son resultados puntuales y sí envejecen (`TipoAviso.vigenciaMs`: 10 s el GPS, 120 s la red caída y los datos viejos; propuestas de software, sin medir). Además, un aviso nuevo de una fuente **cierra** los vigentes de la misma. Lo cerrado o caducado queda en la lista como «Ya no vigente», no se repite y su botón «Repetir» desaparece.
- **Enlace sin autenticar (EA-15).** El aviso de la sesión guarda aparte lo que se dice (`Aviso.textoVoz`: el texto con «Enlace sin autenticar.» en los estados que llevan la reserva) y lo que se lista (`Aviso.texto`). «Repetir» dice siempre `textoVoz`, aunque la voz de ahora ya no añadiera la reserva (tope `maximoReservas`). Mientras el enlace no es autenticado, la fila declara en una oración «Enlace sin autenticar: un aparato ajeno podría hacerse pasar por el accesorio.» (`TextoAvisos.enlaceSinAutenticar`, identificador `aviso-<clase>-enlace`).
- **Sin anunciar sin límite.** Como mucho 6 avisos hablados de una clase cada 10 s (`maximoVocesPorVentana`, `ventanaRitmoMs`; propuesta, sin medir). El aviso aplazado consta en la lista con el texto de ahora y la sesión lo reintenta en el siguiente latido. **Excepción:** una lectura de proximidad más cercana que la última que se dijo no espera (`distanciaMm`): acercarse es lo que más importa oír. La excepción es solo para lecturas más cercanas; las iguales o más lejanas siguen limitadas.
- **Silenciar: solo las advertencias.** Hay un único interruptor, «Silenciar avisos de advertencia», que apaga la voz de la red caída, los datos viejos y el GPS impreciso; el aviso sigue en la lista. **La voz de lo urgente (accesorio, sensor, proximidad) no se puede silenciar:** no hay otra forma no visual de enterarse y un interruptor olvidado dejaría a la persona sin aviso. Solo en memoria: al abrir la app vuelven a sonar. «Repetir» es una orden explícita: ignora el silencio y el ritmo, pero no la ruta de audio.
- **El resultado de «Repetir» tiene un solo canal.** La pantalla lo muestra y lleva el foco de VoiceOver a ese texto; el módulo no lo anuncia además (se leería dos veces).
- **La lista guarda el último aviso de cada clase**, así que no crece.

## Cómo debe hablar la consulta (#45)

La respuesta hablada de la consulta no existe hoy. Cuando #45 la agregue debe pasar por `ControlVoz.anunciar(texto, prioridad: .rutina)` (el valor por defecto), nunca por un sintetizador propio. Con eso: un aviso la corta, y ella no corta ni calla un aviso que suena (devuelve `.silenciado(.cedeAUnAviso)`: #45 puede reintentar con `debeCeder(prioridad:)` o dejar el texto en pantalla). Si #45 habla un error de red, el aviso `redCaida` ya lo dice: habrá una sola voz, la del aviso.

## Cómo se monta #52 (anuncios oficiales)

`AvisosVista` deja una sección «Anuncios oficiales» con una fila fija: «No hay ninguna fuente de anuncios oficiales conectada en la app» y «No se puede saber si hay incidentes». #52 reemplaza esas dos frases (`TextoAvisos.sinFuenteOficial`, identificadores `anuncios-oficiales-sin-fuente*`) por su sección cuando haya fuente. Los avisos propios (`OrigenAviso.propio`) y el escenario simulado (`OrigenAviso.simulado`) tienen sus propias secciones y nunca se mezclan con un anuncio oficial. La lista jamás dice que no hay incidentes.

## Notificaciones del sistema y segundo plano

- **No se pide el permiso de notificaciones.** Ningún comportamiento de este PR lo necesita: la app no declara `UIBackgroundModes` y la sesión se suspende con la escena inactiva, bloqueada o en segundo plano, así que no hay nada que notificar fuera de ella. Un aviso de la lista **no** es una notificación del sistema ni un push remoto (#52 decidió no usar APNs).
- **Las notificaciones locales del sistema no se integran ni en #46 ni en #52: ambos son solo avisos dentro de la app.** Por eso la frase de `docs/expoandes/ea-26-anuncios.md` («notificaciones locales del sistema … quedan fuera de este PR», que dejaba el permiso para un PR de iPhone) ya no es la declaración de quién es dueño de ellas: nadie las integra hoy. Quien las quiera después tendrá que justificar un comportamiento que las necesite (la app no corre en segundo plano) y pedir el permiso entonces.
- **Alcance en segundo plano: ninguno.** Los avisos se producen y se dicen solo con la app en primer plano y activa. Con el iPhone bloqueado o la app en segundo plano la sesión se detiene, corta la voz y cierra sus avisos; al volver se sincroniza de nuevo y dice el estado de ahora. Lo prueba (en simulación) `InfoPlistAccesorioTests` y `AvisosSesionTests`; el comportamiento real con la pantalla bloqueada está **pendiente** en un iPhone.

## Sin red, sin servidor, sin modelo

Los avisos físicos (accesorio, dato vencido, proximidad) y los controles de sesión no dependen de la red, del servidor ni del modelo. La red caída es un aviso más y no detiene nada (prueba `testLaRedCaidaNoImpideAvisosFisicos`).

## Pruebas

Todas en simulación (voz, ruta, transporte y reloj falsos); ninguna es de un iPhone.

| Qué | Dónde |
| --- | --- |
| Prioridad en la voz: corta rutina, no calla un aviso, misma prioridad reemplaza | `PrioridadVozTests` |
| Clases, severidad, deduplicación y ráfaga repetida, caducidad y renovación (consulta y ubicación), sesión sin caducidad por tiempo, cierre por fuente, interrupción, ritmo y aplazado, lectura más cercana sin espera, silencio solo de advertencias, «Repetir» con la reserva del enlace, red caída, datos viejos, GPS impreciso, origen simulado, texto sin «no hay incidentes» | `CentroAvisosTests` |
| Pérdida del accesorio durante la habla, rutina que no calla un aviso, lo urgente suena con las advertencias silenciadas, un aviso de la sesión no caduca mientras dura su estado y se cierra al acabar, la reserva del enlace sin autenticar en la fila y en «Repetir», suspensión | `AvisosSesionTests` |
| Pestaña: cinco pestañas, fila sin fuente oficial, red caída y datos viejos en la lista, «Repetir» explica por qué no se dijo, auditoría de accesibilidad (texto normal y `AccessibilityXXXL`) | `TransMiVozAvisosUITests`, `TransMiVozAvisosTextoGrandeUITests` |

Un cambio de comportamiento: antes, un mensaje de rutina cortaba un aviso que sonaba (p. ej. «Calibrando» cortaba «Accesorio desconectado.»). Ahora cede. `testDesconexionReconectaConSesionNuevaSinAvisosHistoricos` termina la locución antes de reconectar, como ocurre en la práctica.

## Lista de banco pendiente

Nada de esto lo prueba la CI; se hace con iPhone, auriculares y VoiceOver reales el 13–14/11.

1. Altavoz frente a auriculares con cable y Bluetooth: ningún aviso sale por el altavoz; «Repetir» sin salida privada explica por qué no se dijo.
2. VoiceOver activo: la voz propia empieza apagada; el orden de lectura de la lista; foco al resultado de «Repetir» (único canal, sin lectura doble); el interruptor anuncia su valor; la fila con enlace sin autenticar se lee con su nota.
3. Llamada entrante y colgar durante un aviso; Siri; alarma.
4. Pantalla bloqueada y app en segundo plano con auriculares puestos: la sesión se detiene y no suena nada; al volver, estado de ahora.
5. Cambio de salida (quitar los auriculares hablando): corta en seco y vibra (EA-15), y el aviso de pérdida del accesorio se oye sin voz duplicada.
6. Ensayo auditivo sin voz duplicada con VoiceOver y voz propia.
7. Ritmo: una ráfaga real de cambios de distancia no ametralla; el límite de 6 cada 10 s y la vigencia son propuestas.

## Límites

- La ventana asíncrona del sintetizador (`didFinish` llega después) puede hacer que un mensaje menor ceda una vez de más justo tras un aviso; documentada en `ControlVoz.debeCeder`.
- Las vigencias (consulta y ubicación), el ritmo y la lista de un aviso por clase son propuestas de software sin medir. Los avisos de la sesión no tienen vigencia: dependen de que la sesión cierre su estado (probado en simulación; con un accesorio real, pendiente).
- Código repetido a propósito (se deja así): varios `switch` sobre `TipoAviso` (severidad, fuente, vigencia, título); el nombre `avisos` se usa en `CentroAvisos` (la lista) y en `AvisosAccesibles` (VoiceOver) con sentidos distintos; un mensaje de rutina anunciado por VoiceOver y luego dicho por la voz propia solo ocurre con VoiceOver y voz propia activos a la vez.
- La clase «GPS impreciso» no tiene productor mientras la app no use ubicación.
- La pantalla Ayuda aún dice «tres partes»: no se tocó aquí.
