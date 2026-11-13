# 3. Planteamiento de requerimientos

**Criterio:** Planteamiento de requerimientos, 10 puntos.
**Base:** el Proyecto 1 no tenía esta sección; solo tarjetas de backlog.
**Qué aporta:** requisitos verificables, cada uno ligado a un hallazgo de la sección 1 o a otra fuente declarada, con la forma de comprobarlo y su estado al 13/11/2026.

En la columna «Estado», *implementado* significa que hay código y pruebas automáticas. *Probado en dispositivo* significa que se usó en un teléfono o una placa reales. Ningún requisito está probado todavía con usuarios: esa validación es EA-21, planeada para el 14 y 15 de noviembre.

## 3.1 Requisitos funcionales

| ID | Requisito | Origen | Cómo se comprueba | Estado al 13/11 |
| --- | --- | --- | --- | --- |
| RF-01 | La persona pregunta en español, por voz o por texto, cómo llegar entre dos estaciones, y recibe la respuesta en voz alta y en pantalla. | 7 de 8 piden voz. «No saber qué ruta tomar». | Corpus de 100 frases de [EA-27](../ea-27-evaluacion.md). Prueba del asistente en `/diagnostico`. | Web: implementado; las reglas entienden 89 de 100 frases. iPhone: implementado; el dictado no se ha probado en un iPhone real. |
| RF-02 | La app solo dice qué bus tomar cuando la parada está verificada para ese sentido y ese día. Si no, lo dice y muestra las estaciones cercanas al trazado solo como referencia. | Información veraz (sección 2). | Pruebas unitarias de [EA-05](../nota-ea05-paradas-sentido.md). | Implementado. Hoy solo los servicios 8 G y 8 T tienen paradas verificadas; esa evidencia vence el 4/12/2026. |
| RF-03 | Consultar una ruta por código o por estación: recorrido, sentido, estaciones y horario. | «No saber qué ruta tomar». | Pruebas de [EA-06](../ea-06-catalogo-recuperable.md), incluidos los 16 códigos con letra como «8 G». | Implementado en web e iPhone. |
| RF-04 | Orientar hacia la estación más cercana con distancia y rumbo hablados, y avisar cuando la ubicación es imprecisa o vieja. | Llegar a la estación (sección 2). | Pruebas de [EA-07](../ea-07-gps-precision.md) con umbrales: posición de máximo 60 s, precisión de 50 m, llegada a 30 m. | Web: implementado. La app de iPhone no usa la ubicación. La calidad del GPS en la calle no se ha medido. |
| RF-05 | Modo de baja visión con alto contraste y controles grandes. | 2 de 8 piden colores fluorescentes. Mapas 3 y 4. | Web: contraste de al menos 7:1 en el tema claro. iPhone: auditoría automática de accesibilidad con texto normal y con el tamaño de texto más grande. | Implementado. |
| RF-06 | Uso completo sin ver la pantalla. | 3 de 8 tienen discapacidad visual total. | Web: modo en que toda la pantalla es un botón que escucha y responde. iPhone: recorrido con VoiceOver. | Web: implementado. iPhone: VoiceOver probado en el iPhone 12 el 11/11 en la consulta (foco en la respuesta y en el error); falta en las demás pantallas. |
| RF-07 | Ampliar letreros con la cámara: zoom, filtros de contraste y congelar la imagen. | «Letreros y rutas que no alcanza a distinguir» (mapa 3). | Pruebas con cámara simulada. Prueba de cámara en `/diagnostico`. | Implementado en web (hasta 3×) e iPhone (hasta 10×). Los filtros no están calibrados. |
| RF-08 | Llamar a emergencias (123, 156 y 195) desde la pantalla principal. | 5 de 8 han sufrido caídas. Inseguridad. | Revisión de la pantalla de emergencia. | Implementado en la web. |
| RF-09 | Avisar por los auriculares cuando el accesorio detecta presencia cercana, y distinguir «sin detección», «dato vencido», «fallo del sensor», «desconectado» y «audio no disponible». Nunca decir «camino libre». | 5 de 8 han sufrido caídas. Obstáculos y andenes en mal estado. | Contrato Bluetooth y pruebas del firmware. Bancos del 12 y 13/11. Ensayos con blancos a distancias medidas (G1 y G2, ver [puertas de hardware](../puertas-hardware.md)). | Firmware y app implementados. La app y el accesorio no se han probado juntos. G1 y G2 sin validar. |
| RF-10 | Mostrar los anuncios oficiales del operador con fuente, fecha y vigencia, sin decir nunca «sin incidentes». | «No hay anuncios de voz confiables» (mapa 3). | Pruebas de [EA-26](../ea-26-anuncios.md). | Implementado en web e iPhone. Ningún anuncio se ha contrastado con la operación real. |
| RF-11 | Cancelar o silenciar en cualquier momento lo que la app está diciendo, y no hablar después de salir de una pantalla. | Hallazgos 6 y 7 de la [auditoría de código](../auditoria-codigo.md). | Pruebas de [EA-08](../ea-08-reglas-cancelacion.md). | Implementado. |
| RF-12 | Consultar las estaciones de la Línea 1 del Metro como escenario futuro, sin mezclarlas con viajes reales. | Decisión del equipo; no sale de las entrevistas. | Pruebas de [EA-13](../ea-13-catalogo-metro.md) y dos pruebas del Metro en `/diagnostico`. | Implementado: 16 estaciones de la Línea 1. |

## 3.2 Requisitos no funcionales

| ID | Requisito | Cómo se comprueba | Estado al 13/11 |
| --- | --- | --- | --- |
| RNF-01 | Toda la app habla y escribe en español de Colombia (`es-CO`). | Revisión y pruebas de textos. | Implementado. El dictado del iPhone usa es-CO y, si no existe, es-ES. |
| RNF-02 | La app responde, o avisa que no pudo, dentro de un plazo fijo: 6 s en la web y 12 s en el iPhone. | Pruebas de plazos. Medición en Render. | Implementado. Medido en Render con el modelo: p95 entre 1,1 y 1,4 s ([EA-27](../ea-27-evaluacion.md)). Si el servicio estaba dormido, el primer arranque tardó 53,8 s en la única muestra medida. |
| RNF-03 | Si el servicio de TransMilenio falla, la app sigue respondiendo con una copia de los datos. | Fuente caída simulada en Render. | Medido: la app respondió desde la copia (153 estaciones y 124 rutas) y pasó 9 de 9 pruebas del diagnóstico ([informe de Render](../verificaciones/render-2026-11-06-e269a8a/informe.md)). |
| RNF-04 | Privacidad: sin cuentas de usuario; la ubicación solo sale del teléfono si la pregunta la necesita; la imagen de la lupa no se guarda ni se envía. | Revisión de código y avisos en pantalla. | Implementado. El reconocimiento de voz del navegador o de Apple puede enviar el audio fuera del teléfono, y la app lo avisa antes de escuchar. |
| RNF-05 | Seguridad: la app pide clave; limita las consultas a 45 por minuto entre todos los teléfonos; el accesorio solo acepta un teléfono emparejado con clave de 6 dígitos y enlace cifrado. | Pruebas automáticas. Banco del 13/11. | Implementado. En el banco del 13/11 los 7 controles de seguridad del accesorio cumplieron ([informe](../verificaciones/banco-2026-11-13/informe.md)). |
| RNF-06 | Accesibilidad verificable: controles de al menos 44 × 44 puntos y contraste mínimo de 4,5:1 en el iPhone. | Auditoría automática de accesibilidad en la integración continua de iOS. | Implementado y comprobado en el simulador. Falta VoiceOver en todas las pantallas en un iPhone real. |
| RNF-07 | Costo: alojamiento gratuito y hardware dentro del presupuesto de COP 150.000–200.000. | Panel de Render. Facturas. | Render: USD 0,00 medido el 6/11. Hardware: ver la marca debajo. |

> **Por confirmar:** el precio real pagado por la placa y el radar, y dónde se compraron. Las cotizaciones del 2/11 sumaban más que el tope si todo se compraba en la misma tienda ([compras](../compras-bogota.md)).
