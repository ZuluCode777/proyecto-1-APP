# Investigación de hardware e iOS para la segunda entrega de ExpoAndes

Fecha de investigación y consulta: **2026-11-02**, zona America/Bogota. Repositorio: `ZuluCode777/proyecto-1-APP`, carpeta `visionaria`. Base local examinada: `0abca8cbd7dbf95c01ae0fbccdc67804174a13c9`.

Alcance: auditoría documental y del código local, alternativas de arquitectura, propuesta de protocolo y trabajo ordenado. Actualización del usuario recibida el 2026-11-02: ExpoAndes será el **17 de noviembre de 2026, dentro de 15 días**; equipo de cinco integrantes, dos de aplicación y tres de ESP32; **ningún hardware comprado**; compras exclusivamente en Bogotá o con entrega local. **Mac/Xcode confirmado**. Hay un iPhone reciente, pero modelo e iOS exactos siguen pendientes. El usuario requiere los tres objetivos: proximidad de obstáculos, personas/objetivos móviles y posicionamiento interior en estación/edificio. Estos datos provienen del usuario; no de fichas técnicas. **No se ejecutaron pruebas de hardware, iPhone, audio, batería ni usuarios.** No se implementaron cambios de producto ni se crearon issues en GitHub. Las tareas de este informe son propuestas. No se accedió al equipo Windows.

## 1. Dictamen y límites de la evidencia

Es viable investigar un prototipo formado por **radar externo → ESP32 → BLE → iPhone → aviso local**. El ESP32 puede adquirir resultados y comunicarlos; su radio de 2,4 GHz no contiene el frente de radar de 24/60 GHz de los dispositivos estudiados. Un programa no agrega ese hardware. Las especificaciones no demuestran que el conjunto sirva como ayuda de movilidad segura. [E1](https://documentation.espressif.com/esp32_s3_datasheet_en.pdf), [R1](https://h.hlktech.com/download/HLK-LD2450-24G/1/HLK%20LD2450%201T2R%E8%BF%90%E5%8A%A8%E7%9B%AE%E6%A0%87%E6%A3%80%E6%B5%8B%E8%BF%BD%E8%B8%AA%E6%A8%A1%E7%BB%84%E8%AF%B4%E6%98%8E%E4%B9%A6%20V1.02%20.pdf), [R5](https://www.ti.com/lit/ds/symlink/iwrl6432.pdf).

Decisiones propuestas, sujetas a experimentos:

1. Conservar tres objetivos con pruebas separadas: **obstáculos**, **personas/objetivos móviles** y **posicionamiento interior**. Precisar magnitudes y condiciones de cada uno antes de comprar; aprobar uno no aprueba los otros.
2. Usar BLE GATT para datos. El iPhone conserva la conexión con sus auriculares y genera el audio. No enviar audio por el ESP32 en la primera integración.
3. Evaluar primero reutilización de interfaz mediante Capacitor, con procesamiento de proximidad y audio nativos. Compararla con una aplicación SwiftUI mínima que consume el backend Next existente. Ninguna depende del servidor para avisar proximidad.
4. Comprar una unidad de evaluación únicamente después de cerrar modelo exacto, alimentación, SDK, entrega y presupuesto. No comprar un sensor de presencia esperando que después se convierta por software en detector universal de obstáculos.
5. Limitar la entrega a un **prototipo experimental de avisos relativos en condiciones declaradas**. No afirmar localización absoluta, prevención de accidentes, detección de todo obstáculo ni sustitución del bastón o perro guía.

Clasificación usada:

| Etiqueta | Significado |
| --- | --- |
| Hecho, confianza alta | Código leído o especificación primaria abierta; válido dentro de su alcance y versión. |
| Inferencia, confianza media | Consecuencia razonada de esas fuentes; falta comprobarla en el montaje real. |
| Propuesta, sin validación experimental | Decisión, contrato o umbral recomendado aquí; no describe una función existente ni un resultado medido. |
| Pendiente | Evidencia insuficiente para decidir. No se convierte en promesa del producto. |

La fecha ya está confirmada; la rúbrica académica no se examinó en este informe. Este documento no certifica cumplimiento académico completo. La investigación prioriza integración física/iPhone solicitada, no una auditoría integral de seguridad o accesibilidad del repositorio.

### 1.1 Entrega viable en 15 días: banco primero, tres puertas independientes

Recomendación: preparar una demostración de mesa alimentada por USB, sensor sujeto a soporte y blancos con posiciones medidas. El iPhone reproduce avisos locales en primer plano. Una estación simulada en espacio autorizado permite probar zonas interiores sin intervenir una estación operativa. La prioridad de banco reduce variables de movimiento y batería; **los tres objetivos permanecen en alcance**, cada uno con resultado aprobado, fallido o pendiente.

| Objetivo requerido | Prueba mínima diferenciada | Puerta de fallo |
| --- | --- | --- |
| Obstáculos | Medir al menos un reflector estático no humano, con distancia real registrada y clases/materiales declarados. Añadir dirección solo si sensor y ensayo la sostienen. | Un módulo que solo informa presencia o sigue personas no cierra este objetivo. Si blanco estático no se detecta, declarar fallo; no cambiar su nombre a persona/obstáculo para darlo por resuelto. |
| Personas cercanas/objetivos móviles | Persona real se desplaza por posiciones y sectores marcados; verificar distancia, dirección disponible, pérdidas y falsas detecciones. | Un punto móvil no acredita reconocimiento semántico de cualquier persona. LD2450 solo es candidato para el alcance que su manual y banco sostengan. |
| Posicionamiento interior | Identificar zona conocida de estación simulada con referencias fijas, o medir posición relativa a una referencia UWB compatible; indicar zona/posición desconocida al perder referencia. | Radar corporal y RSSI de su enlace con iPhone no identifican estación, piso ni coordenadas del edificio. UWB sin geometría suficiente tampoco entrega posición de mapa. |

Candidata técnica de radar para ambos primeros objetivos: un kit que entregue distancias/nube de puntos con perfil genérico, si existe préstamo o entrega local verificable y se consigue salida útil en banco. LD2450 puede sostener rama de personas, pero no se compra como solución demostrada de obstáculos estáticos. XM125 puede sostener distancia genérica sin dirección; su disponibilidad/adaptación tampoco se presume. Si no llega hardware adecuado, simulación identificada sirve para ensayar interfaz/protocolo, pero deja fallida o pendiente la prueba física correspondiente.

Distribución sugerida del equipo humano: aplicación 1 se ocupa de BLE/audio/sesión iOS; aplicación 2 de estados accesibles, transporte y posicionamiento interior; hardware 1 de electricidad y radar, hardware 2 de parser/firmware BLE y hardware 3 de referencias interiores y registro de ensayos. No implica que existan tres placas ni crea delegaciones de agentes.

No iniciar reescritura completa, batería propia o pruebas en vía pública para alcanzar fecha. Mac/Xcode ya no es bloqueo de disponibilidad; aún hay que demostrar compilación firmada, instalación y capacidades del iPhone real. El agente principal coordina calendario, proveedores y creación de issues; este informe aporta puertas técnicas y no duplica cotizaciones.

## 2. Sistema actual: recorrido e invariantes que deben preservarse

Las rutas siguientes son relativas a la raíz del repositorio. Las líneas corresponden a la base examinada.

| Evidencia local | Comportamiento observado | Consecuencia para integración |
| --- | --- | --- |
| `package.json:18`, `app/page.tsx:1`, `components/transmivoz-app.tsx:40` | Next 16.3.3, React 19; interfaz cliente con modos de baja visión y ceguera total. No aparecen Capacitor ni proyecto Swift entre dependencias/archivos examinados. | Hay interfaz reutilizable; no existe integración iOS/BLE que pueda darse por hecha. |
| `hooks/use-speech.ts:42`, `hooks/use-speech.ts:70` | Síntesis con `speechSynthesis`; reconocimiento mediante `SpeechRecognition`/`webkitSpeechRecognition`, `es-CO`, por interacción. | Disponibilidad y comportamiento dependen del navegador. Esto no configura `AVAudioSession`. |
| `components/total-agent.tsx:55`, `app/api/agent/route.ts:54` | Texto y ubicación opcional viajan a `POST /api/agent`; servidor valida entrada, limita peticiones y usa Ollama opcional o reglas. | Backend sirve consultas de transporte; no es propietario del ciclo de proximidad. |
| `components/total-agent.tsx:72`, `hooks/use-transmilenio.ts:9` | Si falla el servidor y los datos ya están cargados, intérprete local resuelve consultas. La carga inicial usa `/api/transmilenio`. | Ese respaldo no demuestra arranque completo sin red. No se encontró un trabajador de servicio o paquete nativo que lo garantice. |
| `lib/transmilenio-data.ts:1`, `app/api/transmilenio/route.ts:4` | Copia JSON y caché del lado servidor sostienen datos de transporte. | Una exportación de interfaz no transporta automáticamente esas funciones de servidor al teléfono. |
| `proxy.ts:8`, `lib/access.ts:10` | HTTP Basic protege solicitudes cuando existe configuración de clave. | Cliente iOS debe resolver autenticación por HTTPS sin incrustar credenciales en archivos, URL ni registros. No se inspeccionaron valores secretos. |
| `components/total-agent.tsx:17`, `hooks/use-speech.ts:45` | Respuesta del asistente tiene pausas deliberadas; `speak` puede cancelar voz anterior. | Reutilizar esa secuencia para alertas impondría demoras y competencia de audio. Hace falta un propietario único de prioridades. |

Recorrido actual: interacción → reconocimiento web o texto → API del agente → datos reales y reglas/modelo opcional → respuesta validada → voz y navegación. El respaldo local comienza después de disponer de los datos. La documentación presenta la app como MVP accesible de transporte; el historial leído de voz/agente corresponde a correcciones de septiembre de 2026. No hay evidencia consultada que justifique añadir proximidad al modelo de lenguaje.

Invariantes de la ampliación propuesta:

- La alerta de proximidad no espera HTTP, Ollama, geolocalización, mapa ni reconocimiento de voz.
- El transporte público sigue usando datos y validaciones existentes; coordenadas del radar no se mezclan con latitud/longitud.
- Ausencia de blanco, pérdida de conexión, lectura vencida, montaje inválido y fallo del radar son estados diferentes.
- Avisos de dirección se refieren al sensor montado. Solo equivalen a izquierda/derecha de la persona si orientación y fijación se comprobaron.
- Audio, reconexión, caducidad y procesamiento BLE tienen un único propietario nativo. React o SwiftUI reciben estado semántico; no coordinan bytes, temporizadores y rutas de audio por separado.

Se leyeron `AGENTS.md` y skills locales `architect`, `prototype`, `codebase-design`, junto con `how`, `why` y referencias de diseño. Se aplicaron trazado, comparación de dos estructuras e interfaces pequeñas. Por alcance explícito de investigación individual no se ejecutaron sus flujos de delegación, implementación, ramas o publicación de prototipos. Se usaron también `research`, lectura crítica y revisión de prosa. PDF pertinentes se descargaron y convirtieron con MarkItDown en carpeta temporal; documentación Apple se leyó en su versión Markdown cuando el buscador solo devolvía envoltura JavaScript.

## 3. ESP32: variante, BLE y audio clásico

**No se ha comprado hardware y aún no hay placa de trabajo identificada.** Antes de elegir firmware hay que registrar serigrafía del módulo, revisión de placa, referencia de compra y resultado de identificación del chip. “ESP32” en un anuncio comercial no basta.

| Chip o referencia concreta | BLE | Bluetooth clásico BR/EDR | Consecuencia |
| --- | --- | --- | --- |
| ESP32 original, por ejemplo módulo ESP32-WROOM-32E | Sí; familia dual de Bluetooth 4.2 | Sí | Puede reutilizarse para GATT; A2DP requiere pila/perfil correspondientes. |
| ESP32-S2 | No | No | No permite el enlace BLE propuesto sin otro controlador. |
| ESP32-C3 | Sí; Bluetooth 5 LE | No | Apto como controlador BLE; no sirve para A2DP clásico. |
| ESP32-S3, incluido módulo ESP32-S3-WROOM-1 | Sí; Bluetooth 5 LE | No | Primera candidata si se necesita comprar placa; UART y USB adecuados para banco. |
| ESP32-C6 | Sí; documentación distingue soporte LE 5.0 y certificación LE 5.3 | No | Apto para GATT; certificación 5.3 no implica todas las funciones opcionales. |

Fuentes: comparativa oficial [E2](https://docs.espressif.com/projects/esp-idf/en/v5.0/esp32s3/hw-reference/chip-series-comparison.html), descripción de pilas [E3](https://docs.espressif.com/projects/esp-idf/en/v5.3/esp32/api-guides/bluetooth.html), ficha S3 [E1](https://documentation.espressif.com/esp32_s3_datasheet_en.pdf), documentación C3 [E9](https://docs.espressif.com/projects/esp-idf/en/v5.3/esp32c3/api-guides/bluetooth.html) y documentación específica C6 [E4](https://docs.espressif.com/projects/esp-idf/en/v5.2/esp32c6/api-guides/bluetooth.html). Confianza alta en diferencias de familias; identificación de equipo propio pendiente.

Referencia de evaluación propuesta: **ESP32-S3-DevKitC-1 con módulo ESP32-S3-WROOM-1**, fijando sufijo de memoria y revisión en cotización. La referencia documentada `ESP32-S3-DevKitC-1-N8R8` incorpora `ESP32-S3-WROOM-1-N8R8`; no se presupone inventario vigente ni se necesita esa cantidad de memoria para enviar mediciones. Versiones/documentación de la placa cambian referencias disponibles: exigir coincidencia entre placa entregada y esquema. Si se consigue prestado un ESP32 original funcional, evaluarlo antes de comprar S3. [E5](https://docs.espressif.com/projects/esp-idf/en/v5.0/esp32s3/hw-reference/esp32s3/user-guide-devkitc-1.html), [E6](https://documentation.espressif.com/esp-dev-kits/en/latest/esp32s3/esp32-s3-devkitc-1/user_guide_v1.1.html).

El S3 integra radio de 2,4 GHz y periféricos digitales; el radar externo integra generación/recepción RF, antenas y procesamiento específico. Ni RSSI de BLE ni Wi-Fi convierten al S3 en radar milimétrico. Medir señal entre dispositivos tampoco localiza objetos pasivos del entorno. **Inferencia de arquitectura, confianza alta**, apoyada en bloques físicos [E1](https://documentation.espressif.com/esp32_s3_datasheet_en.pdf) y [R5](https://www.ti.com/lit/ds/symlink/iwrl6432.pdf).

Espressif publica un perfil A2DP y ejemplos de fuente, receptor y coexistencia A2DP/GATT para ESP32 original. Que ese camino exista no demuestra compatibilidad con cualquier auricular ni audio simultáneo con el teléfono. S3/C3/C6 no adquieren A2DP clásico instalando otra biblioteca. [E7](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/bluetooth/esp_a2dp.html).

## 4. Radares reales: qué mide cada alternativa

Presencia significa que un algoritmo encontró evidencia de ocupación o movimiento. Distancia es separación radial respecto al sensor. Azimut es dirección relativa dentro de su campo de visión. Coordenadas locales requieren ejes y montaje conocidos. Ninguna de esas salidas entrega por sí sola posición absoluta del usuario, identidad del objeto, mapa navegable o trayectoria segura.

| Alternativa evaluable | Especificación primaria y salida | Limitación decisiva | Encaje propuesto |
| --- | --- | --- | --- |
| Hi-Link **HLK-LD2450** | Radar FMCW de 24–24,25 GHz; hasta tres objetivos, distancia declarada de 6 m, azimut ±60°, refresco 10 Hz; UART por defecto 256000, 8N1. Manual describe posiciones y velocidad de objetivos móviles. | Aplicación descrita: seguimiento de personas en interiores con instalación fija. No demuestra paredes, postes, objetos inmóviles, huecos ni uso corporal en marcha. | Integración económica en complejidad para demostrar seguimiento de personas y sectores. No aprobarlo como detector general de obstáculos. [R1](https://h.hlktech.com/download/HLK-LD2450-24G/1/HLK%20LD2450%201T2R%E8%BF%90%E5%8A%A8%E7%9B%AE%E6%A0%87%E6%A3%80%E6%B5%8B%E8%BF%BD%E8%B8%AA%E6%A8%A1%E7%BB%84%E8%AF%B4%E6%98%8E%E4%B9%A6%20V1.02%20.pdf) |
| Acconeer **XM125/A121**, con placa de evaluación o adaptación regulada | A121 de 60 GHz por radar coherente pulsado; XM125 incorpora MCU. Firmware de distancia ofrece picos de distancia e intensidad por registros I²C, con estados de calibración/error. | Detector de distancia de un sensor no entrega azimut. Varios picos no son varios objetos identificados. Alcance y consumo dependen de perfil, reflectividad, tasa y calibración. | Candidata para distancia a reflectores genéricos sin prometer izquierda/derecha. Comprar placa, no módulo LGA suelto sin alimentación y adaptación. [R2](https://developer.acconeer.com/download/xm125-datasheet/), [R3](https://developer.acconeer.com/download/xm125-i2c-distance-detector-user-guide/), [R4](https://developer.acconeer.com/download/a121-distance-detector-user-guide-5/) |
| TI **IWRL6432BOOST** | Evaluación de radar FMCW 57–64 GHz, 2 TX/3 RX. Placa declara campo de visión de 120° en azimut y 80° en elevación; acceso a nube de puntos. Demo del SDK documenta coordenadas, velocidad radial y datos de calidad. | Campo de visión no es resolución ni precisión angular. Firmware/perfil y disposición de antenas determinan salida útil; no basta comprar el chip. | Primera candidata de banco si distancia y dirección de reflectores genéricos son requisito obligatorio y se dispone del tiempo/SDK. [R5](https://www.ti.com/lit/ds/symlink/iwrl6432.pdf), [R6](https://www.ti.com/tool/IWRL6432BOOST), [R8](https://software-dl.ti.com/ra-processors/esd/MMWAVE-L-SDK/05_05_00_02/exports/api_guide_xwrL64xx/MMWAVE_DEMO.html) |
| TI **IWR6843ISK** | Evaluación 60–64 GHz con 3 TX/4 RX, nube de puntos; placa declara 120° de azimut y 30° de elevación. El chip incorpora DSP y aceleración. | Mayor capacidad no prueba cobertura de peligros. Hay que confirmar revisión de placa, firmware, energía e interfaces realmente expuestas. | Alternativa si laboratorio ya dispone del kit o SDK; no justificar compra solo por número de antenas. [R7](https://www.ti.com/tool/IWR6843ISK), [R9](https://www.ti.com/lit/ds/symlink/iwr6843.pdf) |

Confianza alta en especificaciones citadas; confianza media en encaje; desempeño del conjunto pendiente. Los alcances publicitados no son distancias garantizadas para todos los materiales. La documentación de LD2450 contiene una discrepancia editorial: portada dice V1.01, URL e historial incluyen revisión 1.02 del 2025-10-15. Antes de fijar parser hay que conservar manual/protocolo exactos del firmware recibido.

El filtrado pensado para personas puede suprimir reflectores estáticos. Acconeer explica umbrales basados en entorno registrado; TI permite distintas cadenas y salidas. Configurar o calibrar frente a una pared puede alterar su detección. **Inferencia, confianza media:** no reutilizar un perfil de presencia/seguimiento como evidencia de detección de obstáculos; comparar perfiles con y sin supresión de fondo cuando el SDK concreto lo permita. [R4](https://developer.acconeer.com/download/a121-distance-detector-user-guide-5/), [R8](https://software-dl.ti.com/ra-processors/esd/MMWAVE-L-SDK/05_05_00_02/exports/api_guide_xwrL64xx/MMWAVE_DEMO.html).

Una persona que camina mueve el sistema de referencia: suelo, cuerpo, ropa y paredes cambian su velocidad aparente. Un radar fijado al pecho cubre otra región que uno en bastón o gafas. Azimut sin elevación no diferencia un obstáculo bajo de uno a la altura de la cabeza. Huecos y escaleras descendentes requieren evidencia específica de geometría/sensado; no inferirlos de una ausencia de eco. No se investigó aquí una solución completa de fusión sensorial o localización.

### 4.1 Posicionamiento interior: referencias fijas, no coordenadas globales del radar

Dos opciones acotadas; ambas son líneas de investigación adicionales al radar:

| Opción | Qué se puede demostrar | Qué falta y qué no promete |
| --- | --- | --- |
| Balizas BLE fijas, por ejemplo iBeacon, asociadas a zonas conocidas | Avisar cercanía a una zona como entrada, vestíbulo o plataforma simulada. Apple ofrece proximidad relativa; advierte que el resultado no es distancia precisa y que RSSI no debe usarse como sustituto de ella. | Hace falta desplegar/identificar referencias y registrar zona/planta/plano. RSSI fluctúa con cuerpo, orientación y entorno; no fundamenta centímetros, lado de puerta ni trayectoria segura. Usar histéresis y estado desconocido entre zonas. [A16](https://developer.apple.com/documentation/corelocation/determining-the-proximity-to-an-ibeacon-device). |
| UWB con dispositivos/accesorios compatibles y referencias de posición conocida | Nearby Interaction proporciona distancia y, cuando dispositivo/situación lo permiten, dirección hacia otro dispositivo compatible. Una referencia puede demostrar distancia/dirección relativa. | Coordenadas del plano requieren geometría suficiente de referencias, posiciones conocidas y calibración de ejes/orientación. No asumir soporte por decir “último iPhone”, ni compatibilidad de un módulo UWB genérico. Verificar `NISession.deviceCapabilities`, protocolo de accesorio y estados sin distancia/dirección. [A17](https://developer.apple.com/documentation/nearbyinteraction), [A18](https://developer.apple.com/documentation/nearbyinteraction/initiating-and-maintaining-a-session). |

Recomendación para 15 días: probar primero **zonas BLE de una estación simulada**, si las balizas necesarias se consiguen localmente o prestadas; mantener UWB como alternativa de referencia precisa sujeta a hardware compatible y prueba real. Esto no elimina objetivo interior: distingue identificación de zona de posición métrica. Si requisito académico exige coordenadas continuas o navegación en estación real, la prueba de zonas no basta y esa puerta permanece pendiente.

En ambas arquitecturas iOS, un módulo nativo de posicionamiento interior concentra Core Location o Nearby Interaction, permisos, referencias, caducidad y estado de zona. Proximidad de obstáculos conserva módulo y contrato BLE propios. No añadir latitud/longitud, nombre de estación ni RSSI de balizas al paquete de radar v1.0. Mapa local de baliza/ancla a zona debe estar disponible sin red para esa demo; sin referencia, anunciar desconocido. Balizas por anuncio no adquieren identidad autenticada por usar UUID conocido.

Confianza alta en capacidades/limitaciones de las interfaces Apple; media en viabilidad de zonas para montaje aún no ensayado. Ranging de balizas tiene requisitos de autorización Core Location distintos del permiso BLE; Nearby Interaction requiere autorización y compatibilidad. La primera prueba será en primer plano, sin extender garantías de fondo de una función a otra. [A16](https://developer.apple.com/documentation/corelocation/determining-the-proximity-to-an-ibeacon-device), [A18](https://developer.apple.com/documentation/nearbyinteraction/initiating-and-maintaining-a-session).

Una estación simulada debe rotularse como tal. **Instalar balizas/anclas o hacer pruebas con participantes en una estación real requiere autorización del operador y del espacio**, además de condiciones de acompañamiento. No se ha obtenido ese permiso ni se ha establecido geometría o cobertura de una estación real; no anunciar posicionamiento interior desplegado en TransMilenio.

## 5. iPhone: acceso, suspensión y audio

### 5.1 Safari y Core Bluetooth

Safari/WebKit no ofrece soporte nativo general de Web Bluetooth sobre el cual basar esta integración. La solicitud oficial permanece `WONTFIX`; instalar una PWA no agrega Core Bluetooth. Navegadores o extensiones con puente nativo son otro producto y no constituyen soporte de Safari. Debe verificarse el iPhone/iOS de exposición; no se ejecutó detección de `navigator.bluetooth`. [A1](https://bugs.webkit.org/show_bug.cgi?id=101034), consulta 2026-11-02; confianza alta en decisión de WebKit, pendiente comprobación física de versión destino.

La app nativa puede actuar como central y el ESP32 como periférico GATT, usando `CBCentralManager` y `CBPeripheral`. Debe declarar `NSBluetoothAlwaysUsageDescription` y manejar permiso denegado, Bluetooth apagado, enlace perdido y cambios de estado. Evitar la frase antigua “Core Bluetooth solo soporta BLE”: Apple también documenta comunicación con dispositivos BR/EDR y un ejemplo desde iOS 13; eso no equivale a acceso serial SPP arbitrario ni a control de audio A2DP. El contrato recomendado sigue siendo **BLE GATT**. [A2](https://developer.apple.com/documentation/corebluetooth), [A3](https://developer.apple.com/documentation/corebluetooth/using-core-bluetooth-classic).

### 5.2 Segundo plano

`UIBackgroundModes = bluetooth-central` permite despertar para determinados eventos BLE, con escaneo diferente y recursos limitados. No garantiza ejecución permanente, frecuencia fija de avisos ni supervivencia a terminación del proceso. Restauración requiere configuración y eventos pendientes. [A4](https://developer.apple.com/library/archive/documentation/NetworkingInternetWeb/Conceptual/CoreBluetooth_concepts/CoreBluetoothBackgroundProcessingForIOSApps/PerformingTasksWhileYourAppIsInTheBackground.html).

La documentación actual agrega dos matices que deben probarse por versión:

- Desde iOS 26, una Live Activity iniciada antes de pasar al fondo puede conservar ciertos privilegios de Core Bluetooth, incluidos casos de escaneo; esto no promete entrega temporal ilimitada de audio. [A2](https://developer.apple.com/documentation/corebluetooth).
- TN3115 fue actualizada el 2025-09-15: relanzamiento depende del estado de app/dispositivo y de solicitudes pendientes. Las filas señaladas por su nota 5 introducen condiciones con AccessorySetupKit desde iOS 26, incluidos casos relacionados con cierre forzado. No afirmar que cerrar la app siempre la restaura ni que nunca puede restaurarla en toda versión. Tras reinicio puede requerirse primer desbloqueo. [A5](https://developer.apple.com/documentation/technotes/tn3115-bluetooth-state-restoration-app-relaunch-rules).

Propuesta: primera demostración con sesión iniciada conscientemente y alcance de primer plano declarado. Pantalla bloqueada y segundo plano tienen puerta de aceptación propia. Si se exige aviso continuo aun con proceso suspendido o terminado, un único iPhone no proporciona esa garantía documental: estudiar aviso independiente en accesorio y alimentación, fuera de la primera implementación. Un temporizador de caducidad dentro de una app suspendida tampoco garantiza avisar en 500 ms.

### 5.3 Voz, micrófono, sesión y auriculares

Separar **síntesis**, **reconocimiento** y **alerta corta**. Propuesta: sonido local precargado o vibración como señal inmediata; frase breve como explicación opcional. `AVSpeechSynthesizer` genera voz y gestiona cola; no conviene acumular frases cuando el obstáculo ya cambió. La síntesis no necesita micrófono. [A6](https://developer.apple.com/documentation/avfaudio/avspeechsynthesizer).

Para reconocimiento con `SFSpeechRecognizer`, comprobar soporte local en el dispositivo/idioma y exigir `requiresOnDeviceRecognition = true` solamente si `supportsOnDeviceRecognition` lo permite. Si no hay soporte, deshabilitar dictado sin red o solicitar aceptación explícita del procesamiento remoto; no bajar silenciosamente a red. `es-CO` en un identificador no demuestra disponibilidad local. Declarar y solicitar permisos de reconocimiento y micrófono al usar esas funciones. Denegarlos no debe bloquear recepción BLE ni avisos. [A7](https://developer.apple.com/documentation/speech/sfspeechrecognizer/supportsondevicerecognition), [A8](https://developer.apple.com/documentation/speech/sfspeechrecognitionrequest/requiresondevicerecognition), [A9](https://developer.apple.com/documentation/speech/asking-permission-to-use-speech-recognition), [A10](https://developer.apple.com/documentation/bundleresources/information-property-list/nsmicrophoneusagedescription).

Propuesta de política de audio nativo:

- Un módulo concentra `AVAudioSession`, cola de alertas, voz, interrupciones y ruta activa. No permitir que cada pantalla o plugin cambie categoría por su cuenta.
- Sin grabación, evaluar categoría `.playback`. Para capturar comandos, evaluar `.playAndRecord`, terminar captura cuando corresponda y recuperar sesión de avisos. Comprobar coexistencia con VoiceOver.
- A2DP es salida de audio; no proporciona entrada de micrófono. Con `.playAndRecord`, `allowBluetoothA2DP` habilita esa salida. Si también se habilita la opción HFP en equipo compatible con ambos perfiles, el sistema puede preferir manos libres. No prometer entrada por micrófono del auricular y salida A2DP simultánea en cualquier equipo. [A11](https://developer.apple.com/documentation/avfaudio/avaudiosession/categoryoptions-swift.struct/allowbluetootha2dp), [A12](https://developer.apple.com/documentation/avfaudio/avaudiosession/categoryoptions-swift.struct/allowbluetoothhfp).
- Observar ruta e interrupciones, verificar salida real tras conexión/desconexión, llamada y Siri; descartar mensajes vencidos. No cambiar a altavoz público silenciosamente al perder auriculares. Avisar por estado accesible y háptica si está disponible, y pedir elección de ruta. [A13](https://developer.apple.com/documentation/avfaudio/responding-to-audio-route-changes), [A14](https://developer.apple.com/documentation/avfaudio/handling-audio-interruptions).
- Audio de fondo requiere categoría y capacidad apropiadas, además de comportamiento real de la app. No usar reproducción de silencio como supuesto permiso para correr indefinidamente. [A15](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/MediaPlaybackGuide/Contents/Resources/en.lproj/ConfiguringAudioSettings/ConfiguringAudioSettings.html).

**iPhone como propietario de auriculares:** conserva en un sistema voz de transporte, alertas, llamadas y accesibilidad; el accesorio solo envía datos. **ESP32 como fuente A2DP:** exige ESP32 original y audio/codec/pila propios; crea otra fuente que compite por auriculares, según soporte de multipunto y perfiles del modelo. No hay evidencia de mezcla simultánea garantizada. Recomendación de arquitectura, confianza media: elegir primera topología y medir latencia acústica real, no solo llegada del paquete BLE.

## 6. Dos arquitecturas de iPhone con estructuras distintas

### A. Interfaz React/Next empaquetada con Capacitor y módulo nativo

Recorrido propuesto: radar → ESP32 → Core Bluetooth en plugin/módulo Swift → validación/caducidad/priorización/audio nativos → estado resumido para React. Consultas de rutas salen por HTTPS al Next existente. El JavaScript no participa en la decisión urgente ni tiene que estar activo para cada aviso.

`@capacitor-community/bluetooth-le` declara soporte iOS y BLE, con permisos y modo de fondo. Es candidato mantenido por comunidad, no plugin oficial de Apple ni prueba de restauración completa. Antes de adoptarlo, fijar versión compatible de Capacitor/plugin y revisar si su implementación permite mantener el ciclo en Swift sin depender de callbacks JavaScript. [S1](https://github.com/capacitor-community/bluetooth-le).

Reutilizar Next no consiste en copiar servidor Node al teléfono. Cliente empaquetado necesita archivos locales; `/api/agent` y `/api/transmilenio` deben ir al backend por URL explícita. Exportación estática no soporta manejadores que dependen de `Request` ni proxy dinámico. Por ello hay que resolver un paquete de interfaz separado del servidor y no romper su compilación actual. `server.url` de Capacitor se documenta para recarga en desarrollo, no como configuración de producción. Cargar todo remotamente tampoco demuestra arranque sin red. [S2](https://nextjs.org/docs/app/guides/static-exports), [S3](https://capacitorjs.com/docs/config).

Interfaz externa propuesta del módulo de proximidad: iniciar sesión elegida por usuario, detenerla y observar estado. El módulo oculta escaneo, autorización, bytes, reconexión, caducidad y audio. React muestra estados como `sinPermiso`, `conectando`, `activo`, `sinDatos`, `audioInterrumpido`; no recibe objetos de Core Bluetooth ni decide campos de trama. La voz de transporte también debe pasar por arbitraje nativo para no competir con `speechSynthesis`.

Ventaja: mayor reutilización de pantallas, estilos y lógica TypeScript existentes. Coste: compilación de cliente empaquetado, cruce JavaScript/Swift, compatibilidad de plugins y pruebas de VoiceOver en WKWebView. No crear una cadena de wrappers que exponga el mismo protocolo en pantallas, hooks y plugins.

### B. Cliente SwiftUI nativo y backend Next existente

Recorrido propuesto: radar → ESP32 → módulo Swift de proximidad/Core Bluetooth → audio nativo y estado para SwiftUI. Un cliente HTTP separado consulta los mismos endpoints de transporte; no se ejecuta Next en iPhone.

El módulo de proximidad tiene la misma responsabilidad completa que en A, pero no existe puente JavaScript. SwiftUI solo consume estado y acciones de sesión. El cliente de transporte valida respuestas equivalentes a `AgentReplySchema` y mantiene errores/autenticación. Reutilización ocurre en backend, datos y contrato HTTP; JSX, hooks y Leaflet no se reutilizan directamente.

Ventaja: BLE, ciclo de vida, audio y accesibilidad nativa quedan en una única plataforma. Coste: nueva interfaz, navegación y decodificación Swift, más mantenimiento de dos clientes. Para una segunda entrega puede ser una pantalla nativa de sesión y consulta, sin reescribir mapa/lupa/todas las pantallas existentes. No prometer paridad que no se haya presupuestado.

### Selección propuesta

Empezar por **A como candidata de reutilización**, con experimento limitado a demostrar arranque local, aviso nativo con JavaScript suspendido y convivencia de audio. Pasar a **B** si el empaquetado de interfaz exige distorsionar el backend o si mantener BLE/audio en Swift termina duplicado entre varios plugins. Esta puerta decide antes de desarrollar pantallas de proximidad; no es una selección de producto ya aprobada.

Ambas requieren Mac compatible con Xcode, firma y un iPhone real. Capacitor v8 documenta iOS 15 o posterior y Xcode 26 o posterior; fijar versiones compatibles en la prueba, sin asumir que cualquier Mac o iPhone sirve. Mac/Xcode están confirmados por el usuario; falta registrar versiones, modelo/iOS de iPhone y demostrar firma e instalación para exposición. Ninguna garantiza segundo plano por ser “nativa”. [S4](https://capacitorjs.com/docs/ios).

## 7. Ciclo local sin red, privacidad y estados

Propuesta de primera sesión: sensor con montaje documentado, salida a 10 Hz si el perfil lo permite, procesamiento en ESP32, notificación GATT y señal local en iPhone. Periodo y perfiles se fijan tras medir, no a partir del nombre comercial. Objetivo inicial de banco: latencia física a sonido **p95 ≤ 300 ms y máximo ≤ 500 ms**, con alcance y auriculares declarados. Son criterios por verificar, no capacidades certificadas.

Cada aviso exige dato válido y vigente. Para banco, umbrales iniciales: entrar en aviso a distancia ≤ 1500 mm; salir después de dos lecturas válidas consecutivas ≥ 1800 mm. No esperar segunda lectura para entrar. Dar señal corta al entrar y como máximo dos señales por segundo mientras persista; reemplazar explicación hablada anterior en vez de encolarla. Estos números solo definen un experimento; no establecen distancia segura ni tiempo humano suficiente de reacción.

Si hay ángulo válido, usar sectores respecto al sensor: izquierda < −15°, centro entre −15° y +15° inclusive, derecha > +15°. Sin ángulo no anunciar “al frente”: informar proximidad sin dirección. Sin blanco anunciar, cuando se solicite, “sin detección en este momento”; nunca “camino libre”. Las mediciones del perfil de personas deben identificarse como tales.

Procesamiento y sonidos de proximidad deben arrancar sin Wi-Fi, datos móviles, backend, GPS ni permiso de micrófono. “Sin red” se ensaya con Bluetooth encendido, por ejemplo desactivando por separado Wi-Fi/datos; modo avión puede apagar Bluetooth y necesita comprobar su estado.

Privacidad propuesta: no enviar radar, audio de ambiente, identificadores persistentes ni trayectorias al backend para avisar. Retener muestras en memoria; exportación diagnóstica solo voluntaria, sin voz/GPS por defecto, con borrado y plazo declarado. Peticiones de transporte sí pueden contener texto y ubicación opcional, como hoy: comunicar esa diferencia. Guardar credenciales del cliente nativo en almacenamiento seguro del sistema y no en recursos web. Cifrar/autenticar BLE; nombre de anuncio y UUID no son identidad confiable.

La interfaz debe distinguir sesión desactivada, emparejamiento, conexión, sensor disponible sin detección, objetivo medido, datos vencidos, fallo de radar, batería desconocida/baja y audio no disponible. Si el sistema operativo impide ejecutar el módulo, no hay garantía de que este pueda notificar su propia ausencia. Esa limitación permanece visible en alcance y demostración.

## 8. Contrato BLE propuesto, versión 1.0

**Diseño nuevo para revisión; no está implementado.** Un periférico ESP32, un central iPhone enlazado y un sensor. Paquetes de 20 bytes; caben en notificación ATT de MTU 23 sin negociar MTU grande. Enteros multibyte en orden de bytes de menor a mayor peso; enteros con signo en complemento a dos. Serializar campos explícitamente, sin enviar estructuras C con relleno. El protocolo UART/I²C del radar se adapta dentro de firmware; no se copia como si fuera este contrato.

### 8.1 Servicio y características

| Elemento | UUID propuesto | Operación y longitud |
| --- | --- | --- |
| Servicio de proximidad v1 | `e13a0000-76b8-4fb0-9d2b-8c4f8d8a7e31` | Servicio primario; anunciar UUID para escaneo filtrado. |
| Información | `e13a0001-76b8-4fb0-9d2b-8c4f8d8a7e31` | Lectura, exactamente 20 bytes. Estable durante un arranque. |
| Medición y salud | `e13a0002-76b8-4fb0-9d2b-8c4f8d8a7e31` | Lectura y notificación, exactamente 20 bytes; descriptor de suscripción CCCD. |

No hay comandos de configuración, texto libre, JSON, actualización remota ni escritura de umbrales en v1. Activar/desactivar sesión es acción local del cliente; suscripción decide recepción. Radar mantiene adquisición/diagnóstico mientras accesorio esté encendido. Escrituras distintas de suscripción se rechazan; si luego hacen falta comandos, requieren contrato propio con confirmación y validación.

### 8.2 Información, 20 bytes

| Desplazamiento | Tipo | Campo | Regla |
| --- | --- | --- | --- |
| 0 | u8 | versión mayor | `1`. |
| 1 | u8 | versión menor | `0`. |
| 2–3 | u16 | capacidades | bit 0 distancia; bit 1 azimut; bit 2 porcentaje de batería; demás bits cero. Capacidad no certifica exactitud. |
| 4–7 | u32 | identificador de arranque | Aleatorio al arrancar, diferente del previo; no es secreto ni autenticación. |
| 8 | u8 | versión mayor de firmware | Número publicado en evidencia de ensayo. |
| 9 | u8 | versión menor de firmware | Ídem. |
| 10 | u8 | revisión de firmware | Ídem. |
| 11 | u8 | perfil de salida | `0` desconocido, `1` personas/seguimiento, `2` distancia a reflectores genéricos, `3` nube de puntos. Perfil 0 impide activar avisos de distancia. |
| 12–13 | u16 | periodo nominal, ms | Objetivo inicial `100`; no es garantía del intervalo recibido. Debe ser mayor que cero. |
| 14–15 | u16 | caducidad, ms | `500` para v1.0; cliente rechaza otro valor en esta versión. |
| 16–17 | u16 | distancia mínima de perfil, mm | Límite declarado por configuración; requiere evidencia de ensayo. |
| 18–19 | u16 | distancia máxima de perfil, mm | Mayor que mínimo, ≤ 65534; no usar alcance comercial como alcance validado. |

Capacidad de azimut exige capacidad de distancia. Perfil 2 de XM125 no declara azimut. Límites y firmware quedan registrados por accesorio ensayado; cambiar perfil/calibración de montaje exige reiniciar sesión y volver a leer información. Número de versión y perfil no sustituyen autenticación del accesorio.

### 8.3 Medición y salud, 20 bytes

| Desplazamiento | Tipo | Campo | Regla |
| --- | --- | --- | --- |
| 0 | u8 | versión mayor | `1`; versión menor se obtiene de Información. |
| 1 | u8 | banderas | Definidas abajo. |
| 2–3 | u16 | secuencia | Incrementa con cada trama generada, incluidas lecturas; vuelve a cero módulo 65536. |
| 4–7 | u32 | identificador de arranque | Debe coincidir con Información de esta conexión. |
| 8–11 | u32 | instante de emisión, ms | Reloj monotónico del ESP32 desde arranque, módulo 2³²; lectura genera valor al atenderla, no devuelve caché vieja. |
| 12–13 | u16 | distancia radial, mm | `0xFFFF` desconocida. No confundir con distancia horizontal o longitudinal. |
| 14–15 | i16 | azimut, centésimas de grado | `−9000…9000`; negativo izquierda, positivo derecha; `−32768` desconocido. La cuantización no promete precisión de 0,01°. |
| 16–17 | u16 | edad del resultado de radar, ms | Tiempo desde recepción íntegra y validación de la trama radar hasta emisión; saturar en `65535`, que significa desconocida/vencida. No mide latencia interna del radar. |
| 18 | u8 | batería, % | `0…100` solo con estimación calibrada; `255` desconocida. No convertir voltaje a porcentaje sin caracterización. |
| 19 | u8 | salud | `0` sin fallo conocido; `1` iniciando/calibrando; `2` radar sin datos; `3` trama radar inválida; `4` fallo declarado por radar; `5` alimentación insuficiente; `6` montaje/configuración no validado. Otros valores inválidos en v1.0. |

Banderas: bit 0 resultado radar disponible; bit 1 blanco seleccionado; bit 2 distancia válida; bit 3 azimut válido; bit 4 batería baja según umbral validado del montaje; bit 5 simulación; bits 6–7 reservados, cero. Batería desconocida no permite inferir que queda autonomía suficiente.

Invariantes de codificación y selección:

- Distancia válida exige bits 0 y 1, salud 0 y valor dentro de límites de Información. Azimut válido exige distancia válida y capacidad de azimut. Si su bandera es cero, campo usa centinela.
- Sin blanco: bits 1–3 en cero, distancia/ángulo desconocidos. Con fallo o edad desconocida/vencida: bits 0–3 en cero y medidas desconocidas. Batería desconocida obliga bit 4 en cero; campo 18 es `255` si no existe capacidad correspondiente.
- Simulación nunca se anuncia como medida física y no activa sesión de uso real. Identificarla en voz/interfaz de demostración.
- Elegir reflector válido de menor distancia radial dentro del perfil/FoV ensayado; ante empate elegir azimut numérico menor, si existe. No afirmar que es obstáculo más peligroso ni que se han medido todos. Sin identidad persistente ni seguimiento en v1.
- Normalizar ejes: +Y hacia fuera de cara frontal del sensor; +X hacia derecha de quien lleva sensor correctamente montado. Para salida cartesiana, adaptar signos del fabricante y obtener azimut con `atan2(X,Y)`. Distancia usa norma de coordenadas disponibles; si no hay Z no inventar altura. Sensor sin ángulo mantiene centinela.
- Generar notificación nominal cada 100 ms, incluso sin blanco o en fallo, con salud/edad actualizadas. Una trama repetida del radar no renueva su edad. Falta de contador/tiempo en sensor limita identificación de duplicados: documentar y ensayar parser real.

Ejemplo sintético de lectura, sin representar ensayo: versión 1, banderas `0x0F`, secuencia 42, arranque `0x11223344`, emisión 1000 ms, distancia 1200 mm, azimut −3000, edad 20 ms, batería desconocida, salud 0:

```text
01 0F 2A 00 44 33 22 11 E8 03 00 00 B0 04 48 F4 14 00 FF 00
```

### 8.4 Conexión, antigüedad y compatibilidad

Orden obligatorio: autorización del sistema → escaneo filtrado → conexión al accesorio elegido → enlace autenticado → leer Información → validar versión/capacidades/perfil → suscribir → lectura fresca de Medición para referencia temporal → activar sesión. Notificaciones llegadas antes de establecer referencia no disparan avisos.

No restar directamente reloj de iPhone y reloj de ESP32. Propuesta conservadora: medir en reloj monotónico de iPhone inicio `t0` y fin `t1` de lectura fresca; trama contiene instante ESP32 `m_ref`. Desfase queda acotado entre `t0 − m_ref` y `t1 − m_ref`. Para trama posterior con emisión `m`, recibida en `t`, estimar cota superior de edad como `max(0, t − (t0 − m_ref) − m) + edad_radar`. Si lectura tarda más de 200 ms, no activar sesión y reintentar. Recalibrar referencia cada 30 s y al volver del fondo; reservar 20 ms de margen por deriva/implementación y rechazar cuando cota más margen sea > 500 ms. El margen es una hipótesis a ensayar, no precisión de reloj probada. Extender contadores modulares o reiniciar referencia antes de ambigüedad de media vuelta del reloj.

Esto limita tramas BLE retenidas; **no estima adquisición física dentro de un radar que no publica tiempo de captura**. Medir esa demora de extremo a extremo en banco. Si no puede acotarse con el sensor elegido, el requisito de latencia permanece incumplido.

Aceptar secuencia nueva solo si diferencia módulo 65536 está entre 1 y 32767; repetida o anterior se descarta. Cambio de arranque invalida referencia, medidas y cola, y obliga a releer Información. Cada reconexión crea sesión nueva y vuelve a suscribir; no reproducir avisos históricos. Valor leído y notificación pueden llegar intercalados: reloj/secuencia gobiernan, no orden de callbacks.

Con ejecución nativa activa, pasar a `sinDatos` si pasan 500 ms sin resultado vigente; emitir una indicación de fallo, no repetir última distancia. Al reanudar desde suspensión, invalidar inmediatamente estado previo y sincronizar antes de volver a anunciar medidas. Medir separadamente cuánto tarda sistema operativo en permitir esa ejecución.

V1.0 acepta solo mayor 1/menor 0, longitudes exactas, campos/rangos/bits/perfiles conocidos; rechaza incompatibilidad de forma accesible. Añadir significado o estructura requiere versión nueva y revisión de compatibilidad; cambiar distribución incompatible requiere servicio mayor nuevo. No negociar silenciosamente una versión desconocida.

### 8.5 Confianza del enlace

Propuesta: lecturas, suscripción y notificaciones disponibles solo tras enlace cifrado y autenticado; un central autorizado. Alta inicial abierta por botón físico durante 60 s y emparejamiento con clave propia del accesorio mediante interacción accesible; conservar vínculo y permitir borrado físico explícito. No usar nombre, RSSI o UUID como autorización ni publicar la clave. El mecanismo de asociación autenticada y su accesibilidad deben probarse en placa/iPhone elegidos; si solo se logra asociación sin protección frente a intermediario, declarar ese límite y no presentarlo como autenticado. Espressif distingue permisos GATT cifrados y autenticados. [E8](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/bluetooth/esp_gatt_defs.html).

No se necesita CRC de aplicación adicional para este diseño GATT; sigue siendo obligatorio validar estructura y semántica. Cifrado no evita bloqueo de radio, fallo del sensor ni identidad falsa durante un alta mal resuelta. Esos fallos nunca equivalen a “sin obstáculos”.

## 9. Alimentación, consumo y puerta de compra

Hechos eléctricos y límites:

- ESP32-S3 usa dominio de alimentación nominal de 3,3 V; ficha recomienda 3,0–3,6 V para pines principales y fuente de al menos 500 mA en configuración de fuente única. Esa capacidad no es consumo continuo medido. La placa de desarrollo añade regulador, puertos y opciones de alimentación que deben respetarse; un pin GPIO no se alimenta con 5 V porque la placa acepte USB. [E1](https://documentation.espressif.com/esp32_s3_datasheet_en.pdf), [E6](https://documentation.espressif.com/esp-dev-kits/en/latest/esp32s3/esp32-s3-devkitc-1/user_guide_v1.1.html).
- LD2450 requiere 5 V, fuente capaz de más de 200 mA; manual declara corriente media de 120 mA. Su indicación de salida IO a 3,3 V menciona PA9 y firmware concreto: **no tomarla como prueba suficiente del nivel eléctrico de UART**. Confirmar TX/RX en documento de interfaz de revisión recibida y medir antes de conectar al ESP32. [R1](https://h.hlktech.com/download/HLK-LD2450-24G/1/HLK%20LD2450%201T2R%E8%BF%90%E5%8A%A8%E7%9B%AE%E6%A0%87%E6%A3%80%E6%B5%8B%E8%BF%BD%E8%B8%AA%E6%A8%A1%E7%BB%84%E8%AF%B4%E6%98%8E%E4%B9%A6%20V1.02%20.pdf).
- XM125 desnudo necesita riel analógico/digital de 1,8 V, además de VIN e IO apropiados; no es entrada directa de 5 V. Placa de evaluación/adaptación puede resolverlo, pero debe verificarse su esquema y referencia concreta. [R2](https://developer.acconeer.com/download/xm125-datasheet/).
- Kits TI incorporan gestión de energía y alimentación USB. Rieles del chip y tolerancia de pines no equivalen a conectores del kit: confirmar esquema, puentes y UART lógica, no conectar ESP32 a niveles RS-232 ni a un puerto USB como si fuera UART. [R6](https://www.ti.com/tool/IWRL6432BOOST), [R7](https://www.ti.com/tool/IWR6843ISK).

Propuesta inicial: fuente USB regulada para banco, masa común, cables cortos, radar alimentado desde riel adecuado y no desde GPIO. Medir picos al iniciar radio/radar, caída de riel, temperatura y reinicios. Mantener Wi-Fi apagado si no se necesita, sin dormir el radar de forma que incumpla cadencia. No extrapolar cifras de sueño profundo a un sensor activo a 10 Hz.

Para wearable, usar solución de batería protegida, carga y regulación con referencias verificadas; no añadir celda suelta sin protección. La carcasa, sujeción y material frente a antena forman parte de ensayo. Coste y autonomía se miden sobre conjunto, no solo chip.

Lista técnica de materiales; cotizaciones y disponibilidad en Bogotá/entrega local las consolida el agente principal en su informe de compras, sin ampliarlas aquí:

| Elemento | Cantidad inicial | Criterio de selección |
| --- | --- | --- |
| Placa ESP32 identificada | 1; préstamo si cumple | Referencia/revisión, USB de datos, pines libres, BLE confirmado. |
| Radar y placa de evaluación/adaptación | 1 alternativa | Firmware documentado que entregue magnitudes del requisito. No comprar cuatro por defecto. |
| Alimentación regulada | 1 conjunto | Rieles/corrientes verificados; margen para picos y medición. |
| Interconexión y conversión de nivel | Según esquema | Conector exacto, masa, tensión UART/I²C; adaptación solo donde corresponda. |
| Carcasa y sujeción | 1 | Orientación repetible, sin apantallar antena, sin cantos o cables expuestos. |
| Batería/cargador/regulación protegidos | Solo tras banco | Autonomía requerida y protección verificadas. |
| Instrumentos | Prestados si existen | Multímetro, fuente limitada, analizador lógico y medición de corriente/energía. |
| iPhone, auriculares y acceso a Mac/Xcode | Equipo existente o préstamo | Modelo, iOS, perfiles/ruta de audio, firma e instalación comprobables. |

**Puerta de compra:** aprobar requisito físico, referencia exacta, documentación/firmware descargables, tensiones y niveles, al menos una cotización de Bogotá o con entrega local confirmada antes del 2026-11-17, dejando tiempo para banco, coste total con impuestos/envío/adaptación, instrumentos y ruta de devolución/préstamo. Comparar préstamo de kit TI con compra de módulo. Este informe no verifica precios, inventarios ni disponibilidad local; esos datos los investiga el agente principal. La clasificación regulatoria colombiana del montaje permanece pendiente; no se inventa total en COP ni se deduce autorización local de sellos FCC/CE.

Autonomía preliminar se calcula con energía: `horas ≈ Wh utilizables × eficiencia de conversión / W medios del montaje`. No dividir mAh de una celda por corriente medida a otro voltaje. Completar con descarga real, picos, margen de apagado y consumo del iPhone. Requisito provisional para exposición: 2 h de sesión, sin apagados, más reserva de energía del 20 % verificada; confirmar duración exigida antes de diseñar batería.

## 10. Experimentos necesarios y criterios de aceptación

**Todos pendientes.** Para demo de banco de estos 15 días, comenzar B1 y una matriz reducida de B2: distancias 1/2/3 m y azimuts −30/0/+30° con 30 repeticiones por condición para cada clase que se pretenda demostrar. Ensayar por separado reflector estático y persona móvil; no asumir resultados compartidos. I1–I3 comprueban objetivo interior. Batería propia, sensor portado y H2 son puertas adicionales antes de afirmar movilidad o autonomía portátil; alimentación USB de mesa no las satisface ni las necesita para una demostración rotulada de banco. Umbrales siguientes son propuestas de selección para el prototipo. Pasarlos no demuestra eficacia ni seguridad de movilidad. Registrar equipo, revisiones, configuración, firmware, montaje, fecha, procedimiento, datos crudos y fallos; no reportar solo promedios globales.

| ID | Experimento y evidencia que debe producir | Aprueba / falla |
| --- | --- | --- |
| B1 | Identificar chip/placa/radar; revisar esquema y medir rieles/UART antes de conectar; observar arranque con fuente limitada. | Aprueba si referencias coinciden, todos los rieles/IO quedan dentro de límites documentados y hay 30 min activos sin reinicio/caída. Falla con referencia dudosa o nivel no verificado. |
| B2 | Radar fijo: objetos blandos/duros de tamaño declarado, persona móvil/inmóvil, pared, vidrio, madera/plástico y poste; distancias 0,5/1/1,5/2/3 m, ángulos 0/±30/±60° dentro de FoV; 30 repeticiones por condición declarada. Conservar ceros y falsos blancos. | Para cada clase/condición que se quiera prometer: ≥ 95 % de detecciones; error absoluto p95 de distancia ≤ 0,25 m. Si hay ángulo, error p95 ≤ 15° y ≥ 95 % de sectores correctos fuera de fronteras ±15° con margen de 5°. Condiciones fallidas se excluyen y se informa por qué. No promediar materiales para ocultar fallos. |
| B3 | Mover montaje en carro/soporte y después portarlo con supervisión: giro, balanceo, ropa, mochila, suelo, multitrayectoria, personas cruzándose y versión final de carcasa. Ensayar entorno sin blancos del requisito. | Mantiene B2 en dominio declarado y produce ≤ 1 aviso falso por minuto durante 30 min por entorno. Si seguimiento de personas pierde objetos estáticos, falla para requisito de obstáculos aunque siga personas correctamente. |
| B4 | Parser y contrato: vectores conocidos, distancia/ángulo ausente, longitudes erróneas, reservado no cero, versión desconocida, duplicados, reinicio, desorden, simulación y vueltas de contadores. | Rechazo del 100 % de entradas inválidas del conjunto publicado; cero alerta física desde simulación o trama vencida; reconexión no repite historial. Verificar tamaños/orden de bytes en ambos extremos. |
| B5 | Latencia de extremo a extremo: cambio físico repetible observado por referencia independiente y micrófono capturando inicio de sonido del auricular; al menos 100 eventos por combinación iPhone/auricular y perfil. Medir también llegada BLE para localizar demora. | p95 ≤ 300 ms y máximo ≤ 500 ms por combinación dentro del dominio declarado. No aprobar usando solamente marca de tiempo BLE o del programa. Si señal de disparo no es repetible, experimento no concluye. |
| B6 | Apagar Wi-Fi/datos y backend, conservar BLE; arrancar desde app cerrada sin red, sin permisos de GPS/micrófono; ejecutar 100 eventos. | Avisos y estado de sensor funcionan sin peticiones HTTP para ese ciclo. Rutas/mapa pueden quedar explícitamente sin conexión. Si interfaz remota impide arrancar, falla arquitectura A para este alcance. |
| B7 | Sesión de 60 min: primer plano, bloqueo, otra app, ahorro de energía, Bluetooth desde Ajustes/Centro de control, salida de alcance y regreso, terminación por usuario y reinicio. Registrar versión de iOS y uso o no de AccessorySetupKit/Live Activity. | Para prometer estado concreto, cumple B5 y no anuncia medidas retenidas. En ejecución activa, dato vencido cambia estado en ≤ 500 ms más demora del mecanismo de aviso medida por separado. Con fondo/terminación no cubiertos, alcance queda limitado; fallo no se encubre como conexión saludable. Restaurar sesión exige datos nuevos. |
| B8 | Auriculares reales: salida A2DP, captura de comando, HFP cuando corresponda, desconexión, VoiceOver, Siri, llamada, volumen bajo/cero y retorno; 20 transiciones por caso. | Cero frase vieja tras retorno; estado refleja ruta/interrupción; no emite información privada inesperada por altavoz. Recupera avisos comprobados o declara audio no disponible. Latencia en cada ruta debe cumplir B5 si se promete. |
| B9 | Energía: 2 h en perfil definitivo, medición de W/Wh y picos, temperatura de carcasa, batería próxima a corte e iPhone con audio/BLE activos. | Sin caída de riel/reinicio; advertencia de batería caracterizada antes de pérdida de servicio; duración/reserva acordadas y límites térmicos del montaje documentados. Porcentaje no calibrado permanece desconocido. |
| B10 | Dos teléfonos y accesorio ajeno: emparejamiento, intento de acceso sin vínculo, pérdida de vínculo, borrado/reasociación y anuncio con mismo nombre/UUID. Ensayar alta con VoiceOver. | Solo central autorizado recibe datos protegidos; identidad no depende del nombre; alta/borrado accesibles. Si asociación autenticada no puede demostrarse, falla requisito de enlace autenticado y se documenta antes de uso con personas. |
| I1 | Referencias de estación simulada: registrar plano, zona/planta y balizas; recorrer tres zonas con 10 visitas por zona, distintas orientaciones y ocupación. Ensayo de cercanía, no conversión de RSSI a metros. | Meta propuesta ≥ 90 % de zonas correctas dentro de zonas marcadas y cero zona retenida tras perder referencia durante 5 s con app activa; transiciones ambiguas indican desconocido. Si no cumple, falla demostración de zonas, aunque radar funcione. |
| I2 | Si se elige UWB: confirmar capacidades del iPhone, accesorio compatible y enlace; medir referencias en 10 posiciones conocidas, con línea de vista y oclusiones. Separar distancia a una referencia de posición en plano. | Distancia relativa: error p95 ≤ 0,30 m en dominio declarado; posición métrica solo si geometría/calibración permiten contrastar coordenadas y error p95 ≤ 1 m. Son metas nuevas, no exactitud Apple garantizada. Sin geometría o compatibilidad, puerta métrica falla; no inventar coordenadas. |
| I3 | Plano/referencias sin red, permiso de ubicación/Nearby Interaction denegado, baliza/ancla apagada o movida y dos referencias en conflicto. | Estados accesibles distintos de proximidad de obstáculos; pérdida de localización nunca significa camino libre. Estación real solo entra a ensayo con autorización del operador; sin ella se limita a estación simulada. |
| H1 | Evaluación formativa con personas ciegas y de baja visión, inicialmente sentadas/de pie: comprender sectores, ausencia de blanco, fallo, batería y pérdida de auricular; emparejar/iniciar/detener con VoiceOver sin ayuda visual. Propuesta: 5 participantes diversos, 10 situaciones guionadas por persona. | Meta provisional ≥ 90 % de interpretación correcta y cero interpretación de fallo/sin detección como “es seguro avanzar”. Si alguien incurre en esa confusión crítica, revisar mensajes y repetir antes de marcha. Muestra formativa no demuestra eficacia poblacional. |
| H2 | Solo tras B1–B10 y H1 pertinentes: recorrido corto interior controlado, obstáculos blandos, acompañante entrenado y especialista de orientación y movilidad; ayudas habituales conservadas, consentimiento accesible y derecho a detenerse. | Registrar avisos omitidos, sobresaltos, carga auditiva, interferencia con sonidos ambientales y orientación de montaje. Detener ante contacto inesperado, confusión de peligro, malestar o fallo. No ensayar tráfico, andenes, escaleras reales ni huecos peligrosos. Veredicto restringido a comprensión/usabilidad observada. |

Medir detección estática y portabilidad no puede sustituirse por simulación BLE. Probar software con personas videntes vendadas tampoco reemplaza participación de usuarios ciegos. Si no hay tiempo, acceso a equipos o condiciones para H2, entregar evidencia de banco y declarar evaluación de movilidad pendiente.

## 11. Issues propuestos, en orden de dependencia

Identificadores `EA-*` son referencias de este documento, **no números ni registros creados en GitHub**. P0 bloquea elección o validez de demostración; P1 integra y verifica; P2 consolida evidencia. Cada tarea debe cerrarse con evidencia adjunta y límites, no con “funciona”.

| Orden / prioridad | Título y resultado concreto | Depende de | Criterio de cierre |
| --- | --- | --- | --- |
| EA-01 / P0 | Fijar alcance físico y condiciones de segunda entrega | Ninguna | Fecha 2026-11-17, tres objetivos obligatorios, condiciones de rúbrica, clases de blancos, montaje, modelo/iOS, fondo y duración precisados; sustituir expresiones “localiza”/“seguro” por magnitudes comprobables. |
| EA-02 / P0 | Inventariar hardware y cerrar viabilidad eléctrica, herramientas y compra | EA-01 | Chip y placas exactos, Mac/Xcode confirmado y prueba de instalación iPhone, esquema y niveles revisados, compra Bogotá/entrega local o préstamo con plazo y coste; B1 diseñado antes de compra y ejecutado tras recibir. |
| EA-03 / P0 | Comprobar sensor/perfil local con obstáculos y blancos móviles por separado | EA-02 | B2 y B3 con datos por condición; elegir una alternativa o declarar requisito inviable para entrega. Persona detectada no cierra obstáculo estático. |
| EA-04 / P0 | Resolver arquitectura iOS con prueba mínima desechable | EA-01 y equipo iOS de EA-02 | Comparar A/B según sección 6; probar arranque sin red, callback/audio nativo sin JavaScript y ruta de auricular. Registrar decisión y coste de interfaz; sin reescribir producto completo para decidir. |
| EA-05 / P1 | Fijar BLE 1.0 y adaptación del radar elegido | EA-03, EA-04 | Revisar sección 8, vectores compartidos, perfil y firmware exactos; B4 y B10; invariantes y versión rechazable comprobados. |
| EA-06 / P1 | Construir sesión local con estados y alertas accesibles | EA-05 | Caducidad, desconexión y datos nuevos gobiernan audio; B5/B6; sin HTTP/modelo para proximidad. Voz de transporte entra al mismo arbitraje. |
| EA-07 / P1 | Caracterizar fondo y auriculares en iPhone real | EA-06 | B7/B8; matriz por versión/estado/ruta con casos aprobados y fallidos. Limitar alcance si no sostiene avisos bloqueado. |
| EA-08 / P1 | Verificar alimentación y montaje; autonomía si se propone versión portátil | EA-03 y EA-06 | Banco USB con rieles, temperatura y continuidad documentados; carcasa/sujeción repetibles. B9 completo antes de afirmar autonomía portátil; batería inexistente o no calibrada se informa como desconocida. |
| EA-09 / P1 | Probar posicionamiento interior con referencias conocidas | EA-01, EA-02 y EA-04 | Elegir zonas BLE o UWB compatible; plano de estación simulada, permisos y I1–I3; distinguir zona, posición relativa y coordenadas métricas. Sin autorización no se instala ni prueba en estación real. |
| EA-10 / P1 | Evaluar comprensión y usabilidad con usuarios | EA-07, EA-08, EA-09 y pruebas de banco pertinentes aprobadas | H1; H2 únicamente cuando proceda. Consentimiento, registro anonimizado, fallos y rediseños necesarios; sin conclusión clínica ni de seguridad. |
| EA-11 / P2 | Preparar evidencia reproducible y guion de ExpoAndes | EA-01…EA-10 según alcance final | Referencias, BOM, versiones, contrato, resultados reales, vídeo opcional autorizado y limitaciones. Demostración sin red y guion de fallo; distinguir simulación de hardware en vivo. |

No abrir tareas de nube para radar, inteligencia artificial para proximidad, A2DP desde ESP32 o reescritura total antes de resolver estas dependencias. No son necesarias para probar la pregunta actual.

## 12. Incertidumbres que siguen abiertas

- Fecha conocida: 2026-11-17; equipo humano conocido: dos de app y tres de ESP32; Mac/Xcode confirmado. Ningún hardware comprado. Presupuesto, referencias, compra Bogotá/entrega local y fecha efectiva de recepción se resuelven con informe de compras del agente principal.
- Especificaciones de fabricantes no acreditan sensibilidad al blanco real, error angular, resistencia al movimiento, autonomía ni seguridad del conjunto. Esos resultados dependen de B1–B10.
- Hay iPhone reciente sin modelo/iOS exactos; Mac/Xcode disponibles, con versiones e instalación firmada aún por verificar. No están fijados iOS mínimo, Capacitor/plugin, auricular ni disponibilidad local de voz `es-CO`. Estado de fondo, micrófono y ruta debe medirse en combinación real.
- Sufijos/inventario de placas y versión de manual LD2450 requieren reconciliación en compra. UART y medición de tiempo interno del radar no se dan por verificados.
- Renovación de referencias temporales y margen de deriva BLE son propuesta sin ensayo; si no acotan edad correctamente, hay que revisarlos antes de declarar latencia.
- Usuarios participantes, especialista de movilidad, condiciones de consentimiento y espacio controlado no están confirmados. Sin evaluación física no procede afirmar utilidad de movilidad.
- Infraestructura de balizas/anclas, plano de edificio, compatibilidad UWB, permisos Core Location/Nearby Interaction y autorización de estación real no están comprobados. Radar no cierra objetivo de posicionamiento interior por sí solo.
- Homologación, uso del espectro y requisitos colombianos del montaje completo quedan fuera de evidencia reunida; deben resolverse antes de cualquier distribución o uso que los exija.

## 13. Fuentes primarias y procedencia

Todas consultadas el **2026-11-02**. `s. f.` significa que la página abierta no indica una fecha de publicación/revisión verificable; no se sustituyó por fecha de rastreo, copyright o primera disponibilidad de una API. Versiones de SDK no son resultados de ensayos. Se abrieron documentos completos o sus secciones pertinentes; no se usaron solo fragmentos de buscador como prueba. No se usaron fichas de distribuidores para especificaciones.

| ID | Documento y autor/editor | Publicación o revisión comprobada | Uso y confianza |
| --- | --- | --- | --- |
| E1 | Espressif, [ESP32-S3 Series Datasheet](https://documentation.espressif.com/esp32_s3_datasheet_en.pdf) | v2.2, 2026-03-05, historial del PDF | Radio, periféricos y alimentación; alta. |
| E2 | Espressif, [Chip Series Comparison, ESP-IDF v5.0](https://docs.espressif.com/projects/esp-idf/en/v5.0/esp32s3/hw-reference/chip-series-comparison.html) | s. f.; versión documental 5.0 | Diferencias ESP32/S2/C3/S3; alta, limitada a esas familias. |
| E3 | Espressif, [Bluetooth Overview, ESP32, ESP-IDF v5.3](https://docs.espressif.com/projects/esp-idf/en/v5.3/esp32/api-guides/bluetooth.html) | s. f.; versión 5.3 | ESP32 dual y pilas; alta. |
| E4 | Espressif, [Bluetooth Overview, ESP32-C6, ESP-IDF v5.2](https://docs.espressif.com/projects/esp-idf/en/v5.2/esp32c6/api-guides/bluetooth.html) | s. f.; versión 5.2 | LE y ausencia de clásico en C6; alta. |
| E5 | Espressif, [ESP32-S3-DevKitC-1 v1.1, guía ESP-IDF v5.0](https://docs.espressif.com/projects/esp-idf/en/v5.0/esp32s3/hw-reference/esp32s3/user-guide-devkitc-1.html) | s. f.; placa 1.1, documentación 5.0 | Referencia N8R8 histórica documentada; no inventario. |
| E6 | Espressif, [ESP32-S3-DevKitC-1, guía actual de placa 1.1](https://documentation.espressif.com/esp-dev-kits/en/latest/esp32s3/esp32-s3-devkitc-1/user_guide_v1.1.html) | s. f.; versión móvil `latest` | Alimentación, pines y revisiones; alta; fijar esquema en compra. |
| E7 | Espressif, [Bluetooth A2DP API](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/bluetooth/esp_a2dp.html) | s. f.; página `stable` consultada | Perfil y ejemplos ESP32; alta, no compatibilidad de auriculares. |
| E8 | Espressif, [GATT Defines](https://docs.espressif.com/projects/esp-idf/en/stable/esp32/api-reference/bluetooth/esp_gatt_defs.html) | s. f.; `stable` | Permisos/atributos del enlace; alta sobre interfaz, implementación pendiente. |
| E9 | Espressif, [Bluetooth Overview, ESP32-C3, ESP-IDF v5.3](https://docs.espressif.com/projects/esp-idf/en/v5.3/esp32c3/api-guides/bluetooth.html) | s. f.; versión 5.3 | LE 5.0 y ausencia de clásico en C3; alta. |
| R1 | Shenzhen Hi-Link, [Manual HLK-LD2450](https://h.hlktech.com/download/HLK-LD2450-24G/1/HLK%20LD2450%201T2R%E8%BF%90%E5%8A%A8%E7%9B%AE%E6%A0%87%E6%A3%80%E6%B5%8B%E8%BF%BD%E8%B8%AA%E6%A8%A1%E7%BB%84%E8%AF%B4%E6%98%8E%E4%B9%A6%20V1.02%20.pdf) | 2025-10-15; historial 1.02, portada 1.01 | Personas móviles, UART, energía, FoV; alta en datos explícitos; versión editorial discordante. |
| R2 | Acconeer, [Entry+ Module XM125 Datasheet](https://developer.acconeer.com/download/xm125-datasheet/) | v1.2, 2023-10-04 en PDF; portal lista 2024-02-17 | RF y rieles; alta; fecha de documento distinta de publicación en portal. |
| R3 | Acconeer, [XM125 I²C Distance Detector User Guide](https://developer.acconeer.com/download/xm125-i2c-distance-detector-user-guide/) | a121-v1.13.0, 2026-03-26 en PDF; portal 2026-03-27 | Picos, registros, errores y calibración; alta. |
| R4 | Acconeer, [A121 Distance Detector User Guide](https://developer.acconeer.com/download/a121-distance-detector-user-guide-5/) | a121-v1.13.0, 2026-03-26 | Umbrales, calibración y dependencia del perfil; alta. |
| R5 | Texas Instruments, [IWRL6432 Datasheet](https://www.ti.com/lit/ds/symlink/iwrl6432.pdf) | SWRS298B; publicada 2022-12, revisada 2025-03 | Arquitectura RF y procesamiento; alta, no alcance para cualquier blanco. |
| R6 | Texas Instruments, [IWRL6432BOOST](https://www.ti.com/tool/IWRL6432BOOST) | s. f.; página de evaluación | Antenas, FoV, energía USB y herramientas; alta. |
| R7 | Texas Instruments, [IWR6843ISK](https://www.ti.com/tool/IWR6843ISK) | s. f.; página de evaluación | Antenas/FoV y nube de puntos; alta. |
| R8 | Texas Instruments, [xWRL6432 Mmwave Demo](https://software-dl.ti.com/ra-processors/esd/MMWAVE-L-SDK/05_05_00_02/exports/api_guide_xwrL64xx/MMWAVE_DEMO.html) | s. f.; SDK de ruta 05.05.00.02, cabecera 05.05.00.00 | Cadena de procesamiento y salidas; alta para esa demo, no para firmware desconocido. |
| R9 | Texas Instruments, [IWR6843/IWR6443 Datasheet](https://www.ti.com/lit/ds/symlink/iwr6843.pdf) | SWRS219F; publicada 2018-10, revisada 2025-04 | DSP/arquitectura; alta. Categoría de seguridad del chip no certifica aplicación. |
| A1 | WebKit, [Web Bluetooth API, solicitud 101034](https://bugs.webkit.org/show_bug.cgi?id=101034) | 2012-11-02; última modificación mostrada 2025-12-29 | Estado `WONTFIX`; alta en registro, versión iPhone pendiente. |
| A2 | Apple, [Core Bluetooth](https://developer.apple.com/documentation/corebluetooth) | s. f.; describe cambios desde iOS 26 | Central/periférico, permiso, matiz Live Activity; alta documental. |
| A3 | Apple, [Using Core Bluetooth Classic](https://developer.apple.com/documentation/corebluetooth/using-core-bluetooth-classic) | Asociado a WWDC 2019, sesión 901; muestra iOS 13/Xcode 11 | Evitar afirmar exclusividad BLE del framework; alta. |
| A4 | Apple, [Core Bluetooth Background Processing for iOS Apps](https://developer.apple.com/library/archive/documentation/NetworkingInternetWeb/Conceptual/CoreBluetooth_concepts/CoreBluetoothBackgroundProcessingForIOSApps/PerformingTasksWhileYourAppIsInTheBackground.html) | Guía archivada; s. f. de esta sección | Modos y restricciones generales; alta, complementar con documentación actual. |
| A5 | Apple, [TN3115: Bluetooth State Restoration app relaunch rules](https://developer.apple.com/documentation/technotes/tn3115-bluetooth-state-restoration-app-relaunch-rules) | Revisada 2025-09-15; antecedente QA1962 de 2017-09-08 | Restauración y condiciones iOS 26/AccessorySetupKit; alta. |
| A6 | Apple, [AVSpeechSynthesizer](https://developer.apple.com/documentation/avfaudio/avspeechsynthesizer) | s. f. | Cola/síntesis/ruta; alta sobre funciones, latencia pendiente. |
| A7 | Apple, [supportsOnDeviceRecognition](https://developer.apple.com/documentation/speech/sfspeechrecognizer/supportsondevicerecognition) | s. f.; disponible desde iOS 13 | Comprobar reconocimiento local; alta. |
| A8 | Apple, [requiresOnDeviceRecognition](https://developer.apple.com/documentation/speech/sfspeechrecognitionrequest/requiresondevicerecognition) | s. f.; disponible desde iOS 13 | Evitar envío a red cuando existe soporte; alta. |
| A9 | Apple, [Asking Permission to Use Speech Recognition](https://developer.apple.com/documentation/speech/asking-permission-to-use-speech-recognition) | s. f. | Permiso de reconocimiento incluso con opción local; alta. |
| A10 | Apple, [NSMicrophoneUsageDescription](https://developer.apple.com/documentation/bundleresources/information-property-list/nsmicrophoneusagedescription) | s. f. | Declaración de acceso a micrófono; alta. |
| A11 | Apple, [allowBluetoothA2DP](https://developer.apple.com/documentation/avfaudio/avaudiosession/categoryoptions-swift.struct/allowbluetootha2dp) | s. f.; disponible desde iOS 10 | Salida y prioridad frente a HFP; alta. |
| A12 | Apple, [allowBluetoothHFP](https://developer.apple.com/documentation/avfaudio/avaudiosession/categoryoptions-swift.struct/allowbluetoothhfp) | s. f.; documentación actual | Entrada manos libres; alta; nombre compatible con SDK debe fijarse. |
| A13 | Apple, [Responding to audio route changes](https://developer.apple.com/documentation/avfaudio/responding-to-audio-route-changes) | s. f. | Cambios de ruta y privacidad al quitar auriculares; alta. |
| A14 | Apple, [Handling audio interruptions](https://developer.apple.com/documentation/avfaudio/handling-audio-interruptions) | s. f. | Interrupciones; usar interfaz compatible con iOS objetivo, no asumir APIs de versiones posteriores. |
| A15 | Apple, [Configuring Audio Settings for iOS and tvOS](https://developer.apple.com/library/archive/documentation/AudioVideo/Conceptual/MediaPlaybackGuide/Contents/Resources/en.lproj/ConfiguringAudioSettings/ConfiguringAudioSettings.html) | Revisada 2018-01-16 | Categoría y capacidad de audio de fondo; alta como base archivada. |
| A16 | Apple, [Determining the proximity to an iBeacon device](https://developer.apple.com/documentation/corelocation/determining-the-proximity-to-an-ibeacon-device) | s. f.; consulta 2026-11-02 | Zonas/proximidad, límites de RSSI y autorización Core Location; alta documental. |
| A17 | Apple, [Nearby Interaction](https://developer.apple.com/documentation/nearbyinteraction) | s. f.; documentación móvil, consulta 2026-11-02 | Distancia/dirección relativas y accesorios UWB compatibles; alta, sin garantía de coordenadas de edificio. |
| A18 | Apple, [Initiating and maintaining a session](https://developer.apple.com/documentation/nearbyinteraction/initiating-and-maintaining-a-session) | s. f.; consulta 2026-11-02 | Capacidades en ejecución, permiso y pérdida de medida/dirección; alta. |
| S1 | Mantenedores Capacitor Community, [bluetooth-le](https://github.com/capacitor-community/bluetooth-le) | s. f.; rama predeterminada consultada, versión a fijar | Existencia de plugin BLE iOS y configuración; no certifica continuidad en fondo. |
| S2 | Vercel/Next.js, [Static exports](https://nextjs.org/docs/app/guides/static-exports) | Actualizada 2026-08-09, según página | Límites del empaquetado estático; alta. |
| S3 | Equipo Capacitor, [Capacitor Configuration](https://capacitorjs.com/docs/config) | s. f.; documentación actual | `webDir`, esquema local y limitación de `server.url`; alta. |
| S4 | Equipo Capacitor, [iOS Getting Started](https://capacitorjs.com/docs/ios) | s. f.; versión v8 | WKWebView, Xcode 26 o posterior e iOS 15 o posterior; alta para esa versión. |

Revisión de este documento: se comprobó por cálculo el tamaño de ambos formatos BLE (20 bytes), la decodificación del vector sintético, cierre de bloques Markdown y presencia de las once tareas. Esta comprobación documental no ejecuta firmware, aplicación ni pruebas físicas. No se corrieron compilación o pruebas del producto porque solo se añadió este informe.

La evidencia externa respalda interfaces y capacidades documentadas; recomendaciones de compra, umbrales, protocolo e issues son elaboración de este informe. Falta evidencia experimental para convertirlos en comportamiento demostrado.
