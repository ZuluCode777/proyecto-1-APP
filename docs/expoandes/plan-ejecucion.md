# Plan de ejecución de ExpoAndes: 17 de noviembre de 2026

Estado: **revisión e investigación terminadas; trabajo de producto planificado, sin implementar**. El [índice #26](https://github.com/ZuluCode777/proyecto-1-APP/issues/26) y sus **27 issues de trabajo** son la coordinación vigente; se comprobaron **39 bloqueadores nativos** y 27 relaciones de sub-issue. `EA-01`…`EA-27` son identificadores de orden, no números de GitHub; se conservan en los títulos aunque GitHub asigne otros números.

## Decisiones y restricciones confirmadas

El equipo tiene cinco personas: **A1/A2 en aplicación, H1/H2/H3 en hardware**. El equipo no tiene Mac ni Xcode hasta el miércoles 11 de noviembre de 2026 (confirmado el 5 de noviembre). iPhone indicado entre 16 y 18, modelo y versiones por confirmar. Nicolás y Jacobo llevan aplicación; María Paula, Antonia y Esteban, hardware. Nicolás realiza compras con presupuesto informado de COP 150.000–200.000 y Jacobo opera Kiro. El reparto de especialidades y la dedicación sin horas cuantificadas constan en [acta de EA-01](acta-alcance-capacidad.md). El 6/11 el equipo confirmó la compra de una placa ESP32-S3-N16R8 y un radar DFRobot SEN0395; el [plan de firmware](plan-firmware.md) registra qué mide ese radar, cómo se desarrolla y prueba el firmware, y su calendario. El 17 de noviembre es fecha de feria, no fecha inferida del documento académico. Experiencia Swift y acceso de distribución siguen pendientes; no se asumen jornadas completas ni dispositivos adicionales.

Las metas físicas son **G1: obstáculos estáticos, G2: objetivos móviles y G3: zonas interiores**. Enlace BLE, estados, validez de datos y audio por auriculares del iPhone son condiciones compartidas. Dirección/posición métrica solo se prometen cuando hardware y ensayos concretos las acrediten. «Sin detección» nunca significa «camino libre».

## Sin Mac hasta el 11 de noviembre

**Necesitan Mac** (Xcode, compilar e instalar la app, BLE entre accesorio e iPhone): EA-09 #35, EA-15 #41, EA-17 #43, EA-19 #45, EA-20 #46, EA-25 #51 y el lado iPhone de EA-18 #44, EA-21 #47 y EA-22 #48.

**Siguen sin Mac:** las sesiones con usuarios de EA-02 #28 (iPhone con Safari y cualquier computador en la misma Wi-Fi), el carril de backend de A1 (EA-10 #36, EA-13 #39, EA-14 #40), los carriles de hardware (EA-03 #29, EA-04 #30, EA-11 #37, EA-12 #38, EA-16 #42 y el lado hardware de EA-18 #44) y EA-23 #49.

**CI de macOS, responsable A1.** El repositorio es público, así que los runners de macOS alojados por GitHub, con Xcode y el Simulator de iOS, son gratuitos. A1 abre un issue y un PR para un job que compile el proyecto SwiftUI y ejecute en el Simulator las pruebas unitarias y la auditoría automática de accesibilidad en cada PR. Así el código SwiftUI se escribe y compila antes del 11 de noviembre. El Mac solo hace falta para el iPhone real (instalación, BLE, VoiceOver, audio). El Simulator no demuestra VoiceOver, BLE ni audio real.

**Ventanas solapadas.** Entre el 11 y el 16 de noviembre, las ventanas de las tareas iPhone que dependen unas de otras se solapan a propósito, en la cadena EA-15, EA-17, EA-19, EA-20. El código de una tarea se prepara y se compila en CI antes de que cierre su bloqueador. Su integración y sus pruebas en el iPhone real esperan a que ese bloqueador esté cerrado.

**BLE sin iPhone.** Hasta el 11 de noviembre, hardware prueba el contrato de EA-04 desde el portátil o un teléfono Android (por ejemplo `bluetoothctl` o nRF Connect).

**Plan de respaldo y fecha de corte.** El 11 de noviembre EA-09 decide. Si la primera sesión SwiftUI en el iPhone real no pasa ese día, la feria usa la web existente en Safari del iPhone para consulta de transporte y conversación, y el accesorio se muestra sin el iPhone (Safari en iOS no tiene Web Bluetooth). A2 registra la decisión en EA-09.

## Qué demostró la revisión

La web Next/React tiene catálogo TransMilenio, mapas Leaflet/OSM, viaje candidato directo/transbordo, asistente por reglas/Ollama, voz, GPS, lupa, favoritas, ayuda y diagnóstico. No hay proyecto iOS, integración ESP32, OCR, feed de anuncios ni garantías de arranque offline. La [auditoría](auditoria-codigo.md) distingue implementado, parcial y ausente, con dieciséis hallazgos.

Los primeros problemas por resolver son semánticos y de control: cercanía al trazado usada como parada de abordaje; sentido contradictorio; llegada con GPS impreciso; rumbo relativo tratado como norte; coordenada retenida; voz/respuestas después de cancelar; permisos y procesamiento poco explícitos. También fallan dieciséis códigos del catálogo, aclaraciones entre turnos, datos vacíos y recuperación/antigüedad.

La coordinación observó **36 pruebas aprobadas, tipos, build y 9/9 diagnósticos simulados** en el mismo commit que continúa local/remoto; CI de ese commit también está verde. Se reutiliza esa prueba vigente; no se finge una nueva ejecución. Los checks no certifican paradas, VoiceOver, radar, auriculares, reconocimiento real ni movilidad en calle. [Evidencia y límites](corroboracion.md).

## Arquitectura y alcance por fecha

Recomendación condicionada: **núcleo SwiftUI local**, con BLE/audio/estado y consulta textual accesible, más backend Next existente y web conservada. Comparación con Capacitor y costes de extracción/adaptación en [arquitectura](arquitectura-y-experimentos.md). No hay arena disponible; se hizo comparación manual sustentada en código, no una ejecución ficticia de esa skill.

Para feria se priorizan seguridad de datos, consulta iPhone usable, conversación/control, Metro explícitamente futuro, avisos de sesión y tres pruebas físicas con veredictos independientes. **El alcance completo solicitado sigue en backlog**: rediseño y paridad iPhone de rutas/mapas/lupa/ajustes, cartografía Metro validada, anuncios operativos remotos y evaluación de modelo. No se garantiza toda esa migración en quince días. EA-24…EA-27 no son bloqueadores de feria; EA-23 termina después del evento porque documenta lo sucedido.

Render Free es candidato para Next SSR y reglas; el modelo Ollama documentado no encaja junto a Next en 512 MB. Dormir a los quince minutos, despertar cercano a un minuto, cuotas y disco efímero impiden promesa de asistencia siempre disponible. Se prepara despliegue reproducible y se mide en cuenta real antes de usarlo. La revisión actual no creó servicio ni habilitó costos. [Investigación y configuración propuesta](investigacion-render-ia.md).

Metro se integra en la misma experiencia como catálogo/escenario futuro, separado de viajes reales: Línea 1 en construcción, Línea 2 en contratación/precalificación. Las dieciséis estaciones están documentadas; coordenadas de estaciones no se fabrican y las conexiones futuras no habilitan transbordos actuales. Fechas de apertura siguen siendo previsiones. [Fuentes y tabla de estaciones](investigacion-metro.md).

Radar requiere módulo externo. Presencia humana y seguimiento de personas no demuestran obstáculos estáticos. No se confirmó kit apto en inventario local; [compra](compras-bogota.md) conserva candidatos, no compromisos. Interior usa referencias conocidas; BLE por RSSI demuestra, como máximo bajo ensayo, zonas; UWB requiere compatibilidad y geometría. [Puertas y umbrales propuestos](puertas-hardware.md).

## Capacidad y regla de recorte

Una revisión del borrador estimó **13,5–15,5 días-persona de app**, antes de reducir el corte móvil a consulta textual mínima, más **2,5–3 días de calendario** reservados para integración/ensayo. Sigue siendo estimación de trabajo concentrado, no capacidad demostrada. Dos integrantes disponibles a jornada completa tendrían como techo convencional veinte días-persona en diez días hábiles del 3 al 16, antes de clases, festivos, coordinación y trabajo documental; no se usa ese techo como promesa.

EA-01 debe convertir disponibilidad en horas. Si solo hay cuatro horas diarias por persona, ese techo baja aproximadamente a diez días-persona: el núcleo propuesto puede no caber. Congelar decisiones pronto y reducir pantallas antes que omitir cancelación, validación, accesibilidad, calibración o pruebas físicas. El trabajo que depende del Mac ahora cabe en 11–16 nov, así que la regla de recorte se aplica primero a EA-19, EA-20 y EA-25, nunca a cancelación, validación, accesibilidad, calibración ni pruebas físicas. Kiro ayuda a producir PR, pero no agrega personas que operen Xcode, compren componentes o midan radar.

Las pruebas de hardware dependen de suministro, no de repartir más agentes. Objetivo: referencia apta en banco **4/11**, primera evidencia estática/móvil **6/11**, matriz inicial **9/11**, conjunto físico congelado **12/11**, dictamen **15/11**, ensayo/instalación **16/11**. Sin hardware apto se marca puerta pendiente/no validada y se continúa lo independiente; recibir cualquier radar antes de feria no demuestra meta cumplida. La integración final no acepta una puerta fallida como aprobada.

## Orden, paralelismo y responsables

La numeración da un orden topológico de inicio: cada bloqueador aparece antes. **No significa esperar a terminar todas las filas anteriores**. Puede empezar cualquier tarea cuyos bloqueadores estén resueltos, con persona disponible y sin conflicto de archivos/contratos.

| Orden | Resultado | Responsable | Bloqueada por | Ventana |
| --- | --- | --- | --- | --- |
| [EA-01 / #27](https://github.com/ZuluCode777/proyecto-1-APP/issues/27) / P0 | Cerrar criterios de ExpoAndes, entrega previa y capacidad del equipo | Equipo; A1 coordina | Ninguna | Inicio: 3 nov |
| [EA-02 / #28](https://github.com/ZuluCode777/proyecto-1-APP/issues/28) / P1 | Prototipar rediseño accesible de los flujos principales del iPhone | A2; validación con usuarios | Ninguna | 3–4 nov |
| [EA-03 / #29](https://github.com/ZuluCode777/proyecto-1-APP/issues/29) / P0 | Elegir y cotizar ESP32, radar y referencias interiores con entrega en Bogotá | H1; H2 revisa sensor | Ninguna | Decisión 3 nov; recepción/banco 4 nov |
| [EA-04 / #30](https://github.com/ZuluCode777/proyecto-1-APP/issues/30) / P0 | Fijar contrato BLE y muestras compartidas entre firmware e iPhone | H3; A2 revisa consumidor | Ninguna | 3–4 nov |
| [EA-05 / #31](https://github.com/ZuluCode777/proyecto-1-APP/issues/31) / P0 | Impedir abordajes inferidos y reconciliar paradas, sentido y vigencia | A1; Kiro puede preparar PR | Ninguna | 3–5 nov |
| [EA-06 / #32](https://github.com/ZuluCode777/proyecto-1-APP/issues/32) / P0 | Consultar todos los códigos y recuperar catálogo vacío, viejo o desconectado | A1; apta para Kiro | Ninguna | 4–6 nov |
| [EA-07 / #33](https://github.com/ZuluCode777/proyecto-1-APP/issues/33) / P0 | Orientar con precisión y antigüedad explícitas y liberar sensores al salir | A2 o Kiro; A1 revisa contrato | Ninguna | 4–6 nov |
| [EA-08 / #34](https://github.com/ZuluCode777/proyecto-1-APP/issues/34) / P0 | Responder con reglas primero y cancelar captura, consultas y voz tardías | A1; apta para Kiro con revisión | Ninguna | 5–7 nov |
| [EA-09 / #35](https://github.com/ZuluCode777/proyecto-1-APP/issues/35) / P0 | Probar primera sesión iPhone y decidir alcance SwiftUI con backend existente | A2; H3 ayuda con BLE | EA-04 | 11 nov, llega el Mac; cerrar puerta el 11 |
| [EA-10 / #36](https://github.com/ZuluCode777/proyecto-1-APP/issues/36) / P0 | Acotar recursos y verificar autenticación antes de exposición en Render | A1; apta para Kiro | Ninguna | 5–7 nov |
| [EA-11 / #37](https://github.com/ZuluCode777/proyecto-1-APP/issues/37) / P0 | Leer radar real por UART/I²C y medir calidad y fallos en banco USB | H2; H1 registra pruebas | EA-03 | 4–6 nov, condicionado a suministro |
| [EA-12 / #38](https://github.com/ZuluCode777/proyecto-1-APP/issues/38) / P0 | Transmitir mediciones y salud reales por BLE con reconexión | H3; H2 integra radar | EA-04, EA-11 | 5–8 nov |
| [EA-13 / #39](https://github.com/ZuluCode777/proyecto-1-APP/issues/39) / P1 | Consultar 16 estaciones Metro y conexiones futuras sin contaminar viajes reales | A1; apta para Kiro | EA-05 | 6–9 nov |
| [EA-14 / #40](https://github.com/ZuluCode777/proyecto-1-APP/issues/40) / P1 | Preparar Render Free y medir despliegue de demostración con reglas | A1; titular de cuenta ejecuta publicación | EA-06, EA-08, EA-10 | 7–10 nov |
| [EA-15 / #41](https://github.com/ZuluCode777/proyecto-1-APP/issues/41) / P0 | Conectar accesorio real al iPhone y oír avisos por auriculares | A2 y H3 | EA-09, EA-12 | 11–13 nov |
| [EA-16 / #42](https://github.com/ZuluCode777/proyecto-1-APP/issues/42) / P0 | Validar obstáculos estáticos y móviles sin confundir ausencia con vía libre | H2; H1 observa y mide | EA-11 | 6–10 nov |
| [EA-17 / #43](https://github.com/ZuluCode777/proyecto-1-APP/issues/43) / P1 | Consultar transporte y Metro en iPhone con interfaz accesible rediseñada | A2; A1 mantiene contrato HTTP | EA-02, EA-05, EA-06, EA-09, EA-13 | Código desde 6 nov, compilado en CI de macOS; iPhone real 11–14 nov |
| [EA-18 / #44](https://github.com/ZuluCode777/proyecto-1-APP/issues/44) / P0 | Identificar zonas interiores con referencias fijas y confianza explícita | H1; H3 y A2 revisan recepción | EA-03, EA-09 | 7–11 nov; recepción en iPhone desde 11 nov |
| [EA-19 / #45](https://github.com/ZuluCode777/proyecto-1-APP/issues/45) / P1 | Completar conversación por voz y texto en iPhone con aclaración y permisos | A2; A1 contrato del asistente | EA-08, EA-17 | 12–14 nov |
| [EA-20 / #46](https://github.com/ZuluCode777/proyecto-1-APP/issues/46) / P1 | Unificar avisos locales, GPS y radar con prioridades y control de audio | A2; H3 aporta estados reales | EA-07, EA-15, EA-19 | 13–14 nov |
| [EA-21 / #47](https://github.com/ZuluCode777/proyecto-1-APP/issues/47) / P0 | Validar producto integrado con iPhone, hardware y usuarios en entorno controlado | Equipo completo; A1 integra, H1 registra | EA-14, EA-15, EA-16, EA-17, EA-18, EA-19, EA-20 | 14–15 nov |
| [EA-22 / #48](https://github.com/ZuluCode777/proyecto-1-APP/issues/48) / P0 | Firmar versión de feria y ensayar demostración y respaldo del 17 de noviembre | A2 y H1; equipo ensaya | EA-21 | 16 nov; feria 17 nov |
| [EA-23 / #49](https://github.com/ZuluCode777/proyecto-1-APP/issues/49) / P1 | Cerrar documento final, experiencia de feria, CANVAS y Post Mortem | Equipo; H1 coordina evidencia | EA-22 | Preparar desde 3 nov; cerrar después 17 nov |
| [EA-24 / #50](https://github.com/ZuluCode777/proyecto-1-APP/issues/50) / P2 | Mostrar cartografía Metro solo con CRS y licencia verificados | A1; apta para Kiro | EA-13, EA-17 | Reserva o después de feria |
| [EA-25 / #51](https://github.com/ZuluCode777/proyecto-1-APP/issues/51) / P2 | Completar rediseño y paridad iPhone de rutas, mapas, lupa y ajustes | A2; A1 contrato de viaje | EA-17 | Después de núcleo de feria |
| [EA-26 / #52](https://github.com/ZuluCode777/proyecto-1-APP/issues/52) / P2 | Conectar anuncios operativos verificados y decidir notificaciones remotas | A1 y A2 | EA-20, EA-14 | Después de avisos locales; sin compromiso 17 nov |
| [EA-27 / #53](https://github.com/ZuluCode777/proyecto-1-APP/issues/53) / P2 | Evaluar mejora de IA con corpus español y presupuesto aprobado | A1; revisión humana de privacidad/costos | EA-19, EA-14 | Después de base gratuita medida |

Frontera inicial: EA-01, EA-02, EA-03, EA-04, EA-05, EA-06, EA-07, EA-08 y EA-10. Nueve tareas sin bloqueos no equivalen a nueve desarrolladores disponibles.

| Carril | Secuencia orientativa y coordinación |
| --- | --- |
| A1, backend | EA-05 → EA-06/EA-08 → EA-10/EA-13 → EA-14, más el job de CI de macOS (issue nuevo) esta semana. Kiro puede preparar PR acotados; normalizador, endpoint y planificador requieren merges serializados. |
| A2, iPhone/UX | Hasta el 11 nov: sesiones de EA-02, revisión de consumidor de EA-04 y código SwiftUI compilado en CI. Desde el 11 nov: preparar en paralelo y integrar en el iPhone en el orden EA-09 → EA-15 → EA-17 → EA-19 → EA-20. EA-07 puede prepararse como PR independiente. |
| H1, suministro/interior | EA-03 inmediata; preparar escenario EA-18 mientras H2/H3 trabajan. Reserva apoyo para registro de EA-16 y evidencia académica. |
| H2, radar | EA-11 → EA-16, con versiones/perfiles y blancos medidos; no ocupar a la vez mismo banco en pruebas de enlace. Ensayos B0–B6 del SEN0395 en [plan de firmware](plan-firmware.md). |
| H3, firmware/enlace | EA-04 → EA-12 → EA-15 con A2; apoyar EA-18 en ventana acordada. Estructura, pruebas y job de CI del firmware en [plan de firmware](plan-firmware.md). Congelar contrato antes de implementaciones incompatibles. Hasta el 11 nov, pruebas BLE desde portátil o Android. |
| Equipo | Preparar pruebas/documento desde inicio; ejecutar EA-21 en candidato integrado, EA-22 para feria y EA-23 después del evento. |

Sin propiedad exclusiva de archivos no hay paralelismo de merge seguro. Una única placa/iPhone se reserva por ventanas; no se cuenta con cinco juegos de hardware. Dependencia técnica se expresa con arista de GitHub; disponibilidad de persona, banco o archivo se coordina en carriles, sin crear bloqueadores artificiales.

## Cómo usar issues con Kiro

Cada issue incluye resultado observable, prioridad, responsable propuesto, estimación, bloqueadores, coordinación, aceptación y evidencia. `ready-for-agent` significa tarea de código especificada; **no significa que sus bloqueadores estén cerrados**. `ready-for-human` identifica compra, decisiones, Xcode o pruebas físicas. Nombres A1/A2/H1/H2/H3 no son asignaciones ficticias a usuarios de GitHub.

Elegir una tarea de la frontera, comprobar bloqueadores nativos/cuerpo, revisar PR abiertos y reclamarla. Un solo integrante dispara Kiro para evitar ejecuciones duplicadas. Esta publicación no aplica su etiqueta disparadora ni envía comentario de activación. Usar instrucciones existentes de `AGENTS.md`, PR en español y checks exigidos; no dar secretos de producción ni acceso al Windows para trabajar en UI/reglas. [Disparadores oficiales de Kiro](https://kiro.dev/docs/web/github/).

No reemplazar resultados con «compila»: para cambios Next, tipos, unitarias, build y verificación, conservando prueba PowerShell del instalador en CI; para iOS y firmware, build/pruebas propias y evidencia física exigida. No modificar CI para ocultar fallos ni afirmar que permisos simulados prueban voz real.

## Cierre de entrega y evidencia

La revisión inicial terminó al publicar investigación y un backlog comprobado en GitHub. Implementación, compras, despliegue, pruebas con usuarios y firma siguen siendo tareas futuras, no acciones realizadas por esta revisión. El 3/11 el equipo aportó enunciado ExpoAndes, entrega previa y evaluaciones: EA-01 ya los leyó y reconcilió en [la matriz académica](lectura-rubrica.md). No hace falta acceso a Outlook para esa tarea.

Rúbrica local: doce criterios, 110 puntos. Reutilizar mapas, entrevistas, wireframes, backlog y reflexión previa; corregir citas, comparación de apps, problema, alternativas y viabilidad según evaluación. EA-22 incluye afiche, stand y preparación oral de todos los integrantes; EA-23 añade resultados actuales, CANVAS y experiencia/reflexión de feria después de ocurrir. Fecha/hora y formato del informe no constan en los PDF y siguen pendientes de confirmar. [Lectura académica actualizada](lectura-rubrica.md). No se publican originales, calificaciones ni material personal de entrevistas.
