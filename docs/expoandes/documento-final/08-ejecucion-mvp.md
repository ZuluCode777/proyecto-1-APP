# 8. Ejecución del MVP

**Criterio:** Ejecución del MVP, 15 puntos. La rúbrica pide imágenes y un reporte de qué se logró respecto del plan.
**Base:** en el Proyecto 1 esta fase era una línea («MVP adjuntado en la tarea») y una página de capturas.
**Qué aporta:** lo planeado frente a lo logrado en las dos entregas, la evidencia de pruebas y lo que falta.

## 8.1 Primera entrega: MVP del 25 de septiembre

| Propuesta del Proyecto 1 (p. 8) | Qué se construyó para el 25/09 | Qué se descubrió después |
| --- | --- | --- |
| Ayuda auditiva para ubicar estaciones | GPS auditivo: estación troncal más cercana, indicaciones habladas según hacia dónde mira la persona, aviso al llegar | La auditoría del 2/11 encontró que anunciaba la llegada sin mirar la precisión del GPS y tomaba el rumbo del teléfono como si fuera el norte. Se corrigió en EA-07. |
| Plan de rutas y paraderos | Asistente que planea viajes directos o con un transbordo. Rutas con recorrido, estaciones y horario | La auditoría encontró que trataba cualquier estación a menos de 60 m del trazado como parada, aunque el bus no pare allí. Se corrigió en EA-05. |
| Visión aumentada con la cámara | Lupa con zoom hasta 3×, cuatro filtros de contraste y congelar imagen | — |
| IA para entender preguntas | Reglas propias y, opcionalmente, un modelo local de Ollama | Más adelante, EA-27 midió que las reglas entienden más frases que el modelo. |
| Ubicación dentro de las estaciones con millimeter wave | No se construyó | Salió del alcance el 10/11 (sección 4.3). |
| Publicar el producto | Servido desde un computador del equipo por Tailscale, con clave | En noviembre se publicó en Render. |
| Pruebas de usabilidad con usuarios reales (en el backlog del Proyecto 1) | No se hicieron | Siguen pendientes (8.5). |

El 23 y 24/09, antes de la entrega, se cerraron 12 issues de errores y mejoras. Entre ellos:
- el plan dibujaba la ruta completa en vez del tramo;
- el asistente ignoraba la pregunta escrita mientras escuchaba;
- los nombres de origen y destino salían cortados;
- se aplicó el esquema de color «cabecera lima».

## 8.2 Segunda entrega: tareas y estado al 13 de noviembre

«Código en main» quiere decir que el cambio está fusionado, con sus pruebas automáticas en verde. No quiere decir que se probó en un dispositivo real.

| Tarea | Resultado buscado | Estado al 13/11 |
| --- | --- | --- |
| EA-01 | Criterios de ExpoAndes y capacidad del equipo | Cerrada |
| EA-02 | Prototipo accesible del iPhone | Cerrada. Sin sesiones con usuarios |
| EA-03 | Elegir y comprar el hardware | Cerrada. ESP32-S3 y SEN0395 comprados el 6/11 |
| EA-04 | Contrato Bluetooth entre firmware e iPhone | Contrato v1.0 congelado el 6/11 |
| EA-05 | No dar órdenes de abordaje sin parada verificada | Cerrada |
| EA-06 | Catálogo recuperable y los 16 códigos con letra | Cerrada |
| EA-07 | GPS con precisión y antigüedad explícitas | Cerrada |
| EA-08 | Reglas primero y cancelación de voz y consultas | Cerrada |
| EA-09 | Primera sesión en un iPhone real; decidir SwiftUI | Cerrada. SwiftUI aceptado el 11/11 |
| EA-10 | Clave obligatoria y límites de recursos | Cerrada |
| EA-11 | Leer el radar real y medir su calidad | Lectura por UART funcionando en la placa. Faltan blancos a distancias medidas y el consumo |
| EA-12 | Enviar mediciones por Bluetooth con reconexión | Probado en banco con nRF Connect el 12 y el 13/11 |
| EA-13 | Metro como escenario futuro | Cerrada |
| EA-14 | Publicar en Render y medir | Publicado y medido el 6/11 |
| EA-15 | Accesorio real en el iPhone, avisos por auriculares | Código en main. **La app y el accesorio no se han probado juntos** |
| EA-16 | Validar obstáculos quietos y en movimiento | Sin ensayos con blancos a distancias medidas |
| EA-17 | Consulta de transporte y Metro en el iPhone | Código en main |
| EA-18 | Zonas interiores | Cerrada como no planificada el 10/11 |
| EA-19 | Conversación por voz y texto en el iPhone | Código en main desde el 13/11 |
| EA-20 | Avisos locales en el iPhone | Código en main desde el 13/11 |
| EA-21 | Validación integrada con usuarios | Planeada para el 14 y 15/11 |
| EA-22 | Versión de feria y ensayo | Planeado para el 16/11 |
| EA-23 | Documento final | Este borrador |
| EA-24 | Mapa del Metro | Mapa ilustrativo en main |
| EA-25 | Rutas, mapa, lupa y ajustes en el iPhone | Código en main |
| EA-26 | Anuncios del operador | Código en main, en web e iPhone |
| EA-27 | Evaluar el modelo de lenguaje | Informe en main: reglas 89/100, modelo 83/100 |
| EA-28 | Cuota del asistente para la feria | 45 consultas por minuto, en main desde el 13/11 |

El código del iPhone se congeló el 13/11 a las 15:00. Después solo llegan a la feria cambios del servidor y de la web desplegados en Render.

## 8.3 Evidencia de pruebas

| Qué se probó | Resultado | Fuente |
| --- | --- | --- |
| Pruebas unitarias de la web y del servidor | 586 casos en 52 archivos (conteo aproximado del 13/11) | `lib/*.test.ts` |
| Diagnóstico en el navegador | 9 pruebas en vivo: contexto seguro, datos, asistente, mapa, voz, reconocimiento, micrófono, cámara y ubicación. Corre en Chrome en cada cambio, con cámara, micrófono y ubicación simulados | `/diagnostico`, `pnpm verificar` |
| Integración continua de iOS | Exige al menos 50 pruebas sin fallos ni omisiones. Una ejecución registrada pasó 82 pruebas unitarias y 16 de interfaz. Una corrida local en un Mac pasó 263 pruebas | [CI de iOS](../ios-ci.md), [EA-15](../ea-15-ios-ble-audio.md) |
| Primera sesión en un iPhone 12 real (11/11) | 17 de 18 pruebas correctas: instalación, permiso de Bluetooth, consulta con clave contra Render, error de clave, cancelar, modo avión y recuperación, Llavero, VoiceOver en la consulta. El fallo («Reconectar» no se veía entero) se corrigió y se repitió | [Decisión de EA-09](https://github.com/ZuluCode777/proyecto-1-APP/issues/35) |
| Pruebas automáticas del firmware | 1.054 + 626 + 21.228 + 585 + 1.019.837 comprobaciones, con un radar simulado | [firmware/README.md](../../../firmware/README.md) |
| Banco del accesorio (12/11) | Funcionaron la lectura del radar real, el envío por Bluetooth y el rechazo de conexiones sin clave. Aparecieron 13 hallazgos; por ejemplo, la dirección Bluetooth cambiaba en cada arranque y el radar no volvía a arrancar después de un fallo | [Resultados del 12/11](../verificaciones/banco-2026-11-12/resultados.md) |
| Banco del accesorio (13/11, con las correcciones) | 7 de 7 controles de seguridad cumplen. Se recupera solo tras desconectar el radar 20 s y tras cortarle la alimentación. 42 minutos sin reinicios del radar con 10 mediciones por segundo. 7 de 10 arranques limpios | [Informe del 13/11](../verificaciones/banco-2026-11-13/informe.md) |
| Asistente con corpus fijo | Reglas: 89 de 100 frases. Modelo en Render: 83 de 100, en tres corridas | [EA-27](../ea-27-evaluacion.md) |
| Servidor en Render | USD 0. Memoria máxima de 375 MiB de 512. Arranque en frío de 53,8 s. p95 de 167 ms por consulta en caliente | [Informe de Render](../verificaciones/render-2026-11-06-e269a8a/informe.md) |

## 8.4 Lo que no se logró o falta probar

- **Pruebas con usuarios.** Hasta el 13/11 no se ha hecho ninguna sesión con personas con discapacidad visual, ni con el prototipo ni con la app. Es la mayor deuda del proyecto. La sección 8.5 reserva el espacio para EA-21.
- **App y accesorio juntos.** Los bancos usaron nRF Connect, una app de pruebas. Nadie ha conectado la app de TransMiVoz a la placa, oído un aviso por auriculares ni medido el tiempo entre la detección y el sonido.
- **G1 y G2.** No hay ensayos con blancos a 1, 2 y 3 m. Con la ventana de 30 cm del radar, esas distancias quedan fuera de lo que reporta. Solo se observó presencia con una mano a unos 15 cm.
- **El radar se reinicia solo** unas cinco veces en los primeros minutos después de cada arranque. Luego se estabiliza. La causa no se ha determinado; una hipótesis es la alimentación a 3,3 V, por debajo de la ficha técnica.
- **Consumo y batería.** No se midieron; el equipo no tiene multímetro.
- **Caja.** La tapa impresa deja unos 3 mm de plástico macizo sobre las antenas del radar. El informe del 13/11 lo registra como error de diseño.
- **iPhone en dispositivo real.** Falta probar con el teléfono real el dictado, VoiceOver en todas las pantallas, los auriculares, los avisos y el mapa sin red.
- **Ubicación interior.** Fuera del alcance (sección 4.3).

## 8.5 Validación integrada (EA-21)

> **Pendiente:** se llena con los resultados del 14 y 15/11. Separar siempre lo hecho con usuarios, lo hecho por el equipo y lo simulado.

**Tareas propuestas para cada participante:**

| ID | Tarea | Dispositivo |
| --- | --- | --- |
| T1 | Preguntar por voz cómo llegar entre dos estaciones | iPhone y web |
| T2 | Consultar el horario de una ruta | iPhone o web |
| T3 | Encontrar la estación más cercana con el GPS auditivo | Web |
| T4 | Leer un letrero impreso con la lupa | iPhone o web |
| T5 | Recibir un aviso del accesorio por auriculares | iPhone y accesorio |
| T6 | Cancelar una respuesta mientras la app habla | iPhone o web |

**Registro por participante** (seudónimo, sin datos personales):

| Participante | Tipo de discapacidad visual | Tarea | ¿La completó? | Ayuda que necesitó | Tiempo | Comentario |
| --- | --- | --- | --- | --- | --- | --- |
| | | | | | | |

**Ensayos físicos G1 y G2** (criterios en [puertas de hardware](../puertas-hardware.md)):

| Meta | Montaje | Presentaciones | Detecciones | Resultado |
| --- | --- | --- | --- | --- |
| G1, obstáculos quietos | | | | |
| G2, objetivos en movimiento | | | | |

**Ajustes hechos después de las pruebas:** por llenar.

## 8.6 Capturas

> **Pendiente:** van en la versión en Word (lista en la sección 7.7). Conviene rehacer las seis capturas del Proyecto 1 con la versión actual y agregar las del iPhone y una foto del accesorio.
