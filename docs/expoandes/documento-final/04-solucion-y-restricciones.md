# 4. Planteamiento de solución y restricciones

**Criterio:** Planteamiento de solución y restricciones, 5 puntos.
**Base:** Proyecto 1, página 8, donde la solución aparecía dentro de la declaración del problema.
**Qué cambia:** la solución tiene sección propia, se relaciona con cada dificultad del problema y declara lo que no hace. Incluye la app de iPhone y el accesorio, que no existían en el Proyecto 1.

## 4.1 La solución

**TransMiVoz** es un sistema de consulta y orientación para personas con discapacidad visual que usan TransMilenio. Tiene cuatro partes.

1. **Aplicación web.** Funciona en el navegador Chrome de cualquier teléfono o computador. Ofrece:
   - un asistente que responde por voz preguntas como «¿cómo llego de Ricaurte a Calle 72?»;
   - rutas con recorrido y horarios;
   - un mapa;
   - un GPS auditivo hacia la estación más cercana;
   - una lupa con la cámara;
   - llamadas de emergencia;
   - el Metro como escenario futuro;
   - anuncios del operador.

   Tiene dos modos: baja visión (alto contraste y botones grandes) y ceguera total (toda la pantalla es un botón que escucha y responde).
2. **App de iPhone.** Escrita en SwiftUI, con cinco pestañas: Sesión, Consulta, Avisos, Lupa y Ajustes.
   - Hace las mismas consultas por voz o texto.
   - Muestra rutas, viajes y el mapa.
   - Muestra avisos locales y anuncios del operador.
   - Se conecta al accesorio por Bluetooth y habla solo por los auriculares.
3. **Accesorio.** Una placa ESP32-S3 con un radar DFRobot SEN0395. Detecta presencia a menos de 30 cm y envía cada medición al iPhone por Bluetooth, con enlace cifrado.
4. **Servidor.**
   - Reúne los datos abiertos de TransMilenio.
   - Aplica las reglas que entienden las preguntas.
   - Puede consultar un modelo de lenguaje que corre en un computador del equipo.
   - Está publicado en Render. La web y el iPhone lo usan.

| Dificultad (sección 2) | Qué parte la atiende y cómo |
| --- | --- |
| Llegar a la estación | GPS auditivo de la web: distancia y rumbo hablados hacia la estación más cercana, con aviso cuando la ubicación es imprecisa. |
| Elegir el bus y saber dónde bajarse | Asistente y planificador: qué servicio tomar, dónde bajarse y cuántas estaciones son, solo con paradas verificadas. |
| Información accesible y confiable | Voz en todas las pantallas, modos de baja visión y ceguera total, lupa para letreros, anuncios oficiales con fuente y vigencia. |
| Moverse sin caerse | Accesorio que avisa por los auriculares cuando hay algo muy cerca. Llamadas de emergencia en la web. |

## 4.2 Restricciones

| Restricción | Por qué | Qué significa para la persona |
| --- | --- | --- |
| Solo rutas troncales de TransMilenio: 153 estaciones y 124 rutas. | Son las que publica el servicio de datos abiertos que usa la app. | No sirve para rutas zonales del SITP, aunque el problema las incluye. |
| Solo da la orden «toma este bus» con paradas verificadas. Hoy solo 8 G y 8 T las tienen. | Una estación cercana al trazado no es una parada: un expreso pasa sin parar. El planificador se abstiene antes que dar una orden falsa. | Para casi todas las rutas la app muestra el recorrido como referencia, sin decir dónde abordar. |
| Sin llegadas de buses en tiempo real. | La app no tiene una fuente abierta de posiciones de buses que pueda usar. La TransMiApp oficial sí muestra la ubicación de los buses. | Da horarios, no cuánto falta para que llegue el bus. |
| Los avisos del accesorio son de presencia, no de distancia. El radar no entrega distancia ni dirección, y el fabricante no declara que detecte objetos quietos que no sean personas. | Es lo que mide el SEN0395, el radar que se consiguió a tiempo en Bogotá ([plan de firmware](../plan-firmware.md)). | «Sin detección» no significa camino libre. El accesorio no reemplaza el bastón. |
| La ubicación dentro de las estaciones quedó fuera del alcance. | Habría exigido instalar balizas en una estación o en una maqueta. El 10/11 el equipo decidió no hacerlo ([EA-18](https://github.com/ZuluCode777/proyecto-1-APP/issues/44)). | La app no guía hasta el vagón ni la puerta correcta. |
| El Metro es un escenario educativo. | La Línea 1 está en construcción y no tiene servicio comercial ([investigación del Metro](../investigacion-metro.md)). | Muestra estaciones y fechas previstas, nunca un viaje en Metro. |
| La voz de la web exige Chrome. | Firefox no tiene reconocimiento de voz. | En otros navegadores solo funciona el texto. |
| El servidor gratuito se duerme tras 15 minutos sin uso. | Es la condición del plan gratuito de Render. | La primera consulta después de una pausa puede tardar cerca de un minuto (53,8 s en la medición del 6/11). |
| El modelo de lenguaje depende de un computador del equipo encendido. | El modelo pesa 1,9 GB y el plan gratuito tiene 512 MB. | Si el computador está apagado, responden solo las reglas. |
| La app de iPhone se firma con una cuenta personal de Apple. | El equipo no está inscrito en el programa de desarrolladores de pago. | Cada instalación caduca a los siete días: la del 13/11 vence el 20/11. No se puede publicar en el App Store. |
| La app de iPhone no funciona en segundo plano. | El proyecto no declara el modo de segundo plano de iOS. | Hay que tener la app abierta para recibir los avisos del accesorio. |
| Presupuesto de hardware de COP 150.000–200.000. | Lo fijó el equipo ([acta](../acta-alcance-capacidad.md)). | Un solo accesorio, sin batería propia documentada. |

## 4.3 Cambios frente a la propuesta del Proyecto 1

| Propuesta del Proyecto 1 | Qué se hizo | Por qué |
| --- | --- | --- |
| Usar millimeter wave para ubicarse dentro de las estaciones | No se hizo. El radar se usa para avisar de presencia cercana. | Un radar que lleva la persona no sabe dónde está ella: mide lo que tiene delante. Ubicarla exige referencias fijas instaladas en la estación ([investigación de hardware](../investigacion-hardware-ios.md)). La evaluación del Proyecto 1 pidió analizar esta viabilidad. |
| Integrar Google Maps | La web usa Leaflet con OpenStreetMap y el iPhone usa MapKit. Google Maps queda como enlace para caminar. | No exigen una cuenta de facturación (sección 6). |
| Integrar TransmiApp | No se integró. Se usan los datos abiertos de TransMilenio. | No encontramos una interfaz pública de TransmiApp para terceros. |
| Usar ChatGPT, Claude u Ollama | Reglas propias y, como opción, un modelo pequeño que corre en un computador del equipo. | Costo cero, sin enviar las preguntas a terceros. Las reglas entendieron más frases que el modelo (sección 6). |
| Visión aumentada con colores fluorescentes | Lupa con zoom, cuatro filtros de contraste y congelar imagen. No reconoce texto ni objetos. | Es lo que se pudo construir y probar a tiempo. |
| Transmilenio y SITP | Solo troncales de TransMilenio. | Fuente de datos disponible (sección 4.2). |
| — | **Nuevo:** app nativa de iPhone. | Safari no puede usar Bluetooth desde una página web, y el accesorio lo necesita. |
| — | **Nuevo:** accesorio con radar. | Responde a las caídas y obstáculos de las entrevistas. |
| — | **Nuevo:** Metro como escenario futuro. | Decisión del equipo. |

> **Por confirmar:** si la decisión de no integrar TransmiApp se tomó por falta de una interfaz pública o por otra razón.
