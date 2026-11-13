# 6. Justificación de la tecnología

**Criterio:** Justificación de tecnología, 5 puntos.
**Base:** el Proyecto 1 solo nombraba Google Maps, TransmiApp, ChatGPT, Claude y Ollama.
**Qué aporta:** cada decisión con sus alternativas, el criterio y la evidencia.

Algunas decisiones del MVP de septiembre no se compararon en su momento. Donde la justificación se reconstruye después, la tabla lo marca como *retrospectiva*.

## 6.1 Resumen de decisiones

| Decisión | Alternativas | Elección | Criterio y evidencia |
| --- | --- | --- | --- |
| Plataforma web | Sitio estático; app solo móvil | **Next.js con React** | Hace falta un servidor para pedir clave, guardar en caché los datos de TransMilenio y consultar el modelo sin exponerlos al navegador. Un mismo código corre en Windows y en Render. El MVP se generó con v0, que produce Next.js. *Retrospectiva.* |
| App de iPhone | Página web en Safari; React empaquetado con Capacitor; SwiftUI | **SwiftUI**, con el servidor Next existente | Safari no permite usar Bluetooth desde una página web: la solicitud está cerrada como «no se hará» (WebKit, s. f.). Capacitor también necesitaba código Swift para Bluetooth y audio, y además dos compilaciones y un puente entre JavaScript y Swift. Se decidió el 11/11 tras una sesión en un iPhone 12 real ([ADR](../arquitectura-y-experimentos.md)). |
| Datos de transporte | Copiar la web de TransMilenio; TransmiApp | **Datos abiertos de TransMilenio**: servicio ArcGIS, GTFS y alertas GTFS-realtime | Son públicos y no piden clave. El GTFS (licencia CC BY-SA 4.0) permite verificar paradas por sentido y día. La web de TransMilenio no tiene datos estructurados, y copiarla sería frágil ([EA-26](../ea-26-anuncios.md)). |
| Mapas | API de Google Maps | **Leaflet con OpenStreetMap** en la web; **MapKit** en el iPhone | Sin clave ni cuenta de facturación. OpenStreetMap exige atribución y prohíbe la descarga masiva (OSMF, s. f.). Google Maps se usa solo como enlace para caminar, que no pide clave. *Retrospectiva.* |
| Asistente | Solo reglas; modelo local; modelo en la nube | **Reglas primero; modelo local opcional** | Ver la sección 6.2. |
| Alojamiento | Computador del equipo con Tailscale; Render gratuito; plan de pago | **Render gratuito**; antes, el computador con Tailscale | Ver la sección 6.3. |
| Placa del accesorio | Seeed XIAO ESP32-S3, más pequeña y que puede exigir soldar | **ESP32-S3-N16R8** de desarrollo | Tiene Bluetooth de baja energía 5, que el iPhone puede usar con Core Bluetooth, y USB para pruebas en banco. En el primer banco no hacía falta pagar por una placa miniatura. Se cotizó entre COP 35.700 y 45.000 el 2/11 ([compras](../compras-bogota.md)). |
| Sensor | Ver la sección 6.4 | **Radar DFRobot SEN0395** (24 GHz) | Era el que había en Bogotá dentro del plazo. Se compró sabiendo que no mide distancia ni dirección. |
| Enlace accesorio–teléfono | Emparejamiento sin clave («Just Works») | **Bluetooth LE Secure Connections con clave de 6 dígitos** | Un teléfono sin la clave no puede leer el sensor, y el emparejamiento sin clave se rechaza. Comprobado en banco el 12 y el 13/11 ([EA-12](../ea-12-ble.md)). Límite: iOS no le dice a la app qué nivel de seguridad tiene el enlace, así que la app no puede comprobar que el accesorio sea el auténtico y lo dice en pantalla: «Enlace sin autenticar» ([EA-15](../ea-15-ios-ble-audio.md)). |

## 6.2 Asistente: reglas frente a modelo de lenguaje

**Cómo funciona.** El asistente trabaja en dos pasos:
1. Entender la frase. Lo hacen reglas propias o, si está disponible, un modelo local.
2. Resolverla con los datos reales.

El modelo solo clasifica la frase y extrae nombres. Las rutas, estaciones y horarios salen siempre de los datos, y cualquier nombre que devuelva el modelo se valida contra ellos ([README](../../../README.md)).

**La medición.** En [EA-27](../ea-27-evaluacion.md) se usó un corpus fijo de 100 frases en español.

| Motor | Frases entendidas | Latencia |
| --- | ---: | --- |
| Reglas | 89 de 100 | p95 de 0,36 ms, en el mismo proceso |
| App en Render con el modelo `qwen2.5:3b` | 83 de 100, en las tres corridas | p50 entre 596 y 646 ms; p95 entre 1,1 y 1,4 s |

- Frente a las reglas, el modelo arregló 5 frases y dañó 11. La diferencia no es estadísticamente firme (prueba de signos, p ≈ 0,21).
- El modelo dañó casos sensibles. Con él, «¿ya puedo cruzar?» abría el GPS en vez de rechazarse como alerta física, y «detente por favor» dejaba de cancelar.

**Por qué no un modelo en la nube** ([investigación de Render e IA](../investigacion-render-ia.md)):
- Costo y condiciones: los servicios evaluados cobran por uso o tienen cuotas gratuitas limitadas, con condiciones de datos que no se aprobaron.
- Privacidad: con el modelo local, solo la frase y la lista de estaciones salen hacia el computador del equipo, por un túnel con token.
- Tamaño: el modelo pesa 1,9 GB y no cabe en los 512 MB del plan gratuito de Render. Por eso corre en el computador del equipo.

**Conclusión del informe de EA-27:** los datos no sostienen usar el modelo como intérprete principal. Para la feria recomienda usar solo reglas.

> **Por confirmar:** qué motor usa el asistente en la feria. El plan del 11/11 dice que usa el modelo por túnel. EA-27 recomienda solo reglas y deja la decisión al equipo.

## 6.3 Alojamiento

Medición en Render del 6/11, sobre la revisión `e269a8a` ([informe](../verificaciones/render-2026-11-06-e269a8a/informe.md)):

| Medida | Valor |
| --- | --- |
| Costo | USD 0,00 |
| Memoria máxima | 375 MiB de 512 MiB disponibles |
| Arranque tras 16 minutos sin uso | 53,8 s (una sola muestra) |
| Consultas con el servidor despierto | p95 de 121 ms en lectura y 167 ms en consulta |
| Con la fuente de TransMilenio caída | Respondió desde la copia y pasó 9 de 9 pruebas |
| Volver a la versión anterior | 50,7 s |

**Por qué se dejó el computador del equipo.** Para el MVP de septiembre la app se servía desde un computador del equipo con Tailscale. Ese computador también es de uso personal, y el 6/11 la app no respondía allí. Por eso no se tomó como respaldo confiable.

**Por qué no un plan de pago.** Los planes de pago cuestan entre 7 y 85 USD al mes y no se aprobó ese gasto.

## 6.4 Sensor del accesorio

Alternativas estudiadas en la [investigación de hardware](../investigacion-hardware-ios.md) y en [compras](../compras-bogota.md):

| Opción | Qué mide | Por qué no se eligió |
| --- | --- | --- |
| Radar HLK-LD2450 | Personas en movimiento, con distancia y ángulo | En la búsqueda del 2/11 no se encontró a la venta con inventario en Bogotá. |
| Radar Acconeer XM125 | Distancia a un objeto, sin ángulo | Igual que el anterior. |
| Kits de radar de Texas Instruments | Nube de puntos | Igual que el anterior. |
| Sensor óptico VL53L1X | Distancia hasta unos 4 m | Quedó como respaldo para obstáculos quietos. Exigía aprobar un diseño con dos sensores; no consta su compra. |
| RCWL-0516 o HB100 | Solo movimiento | No sirven para obstáculos quietos. |
| Intensidad de señal Bluetooth (RSSI) | Proximidad aproximada a una baliza | No mide distancia a obstáculos. |
| Banda ultraancha (UWB) | Distancia y dirección a otro dispositivo compatible | Exige un accesorio compatible y no detecta obstáculos pasivos. |
| **DFRobot SEN0395** (elegido) | Presencia dentro de una ventana configurable, una vez por segundo. El fabricante declara que detecta personas quietas o en movimiento. | Estaba disponible. **No mide distancia ni dirección**, y el fabricante no declara que detecte objetos quietos que no sean personas (DFRobot, s. f.). |

> **Por confirmar:** el ultrasonido, el LiDAR del iPhone y la cámara no se analizaron en la investigación. O se agrega una línea sobre ellos o se declara como límite del estudio.
