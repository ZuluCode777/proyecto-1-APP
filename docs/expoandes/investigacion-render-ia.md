# Investigación y auditoría: Render, asistente y preparación de la segunda entrega

**Fecha de investigación y consulta:** 2026-11-02, zona America/Bogota.

**Repositorio:** [ZuluCode777/proyecto-1-APP](https://github.com/ZuluCode777/proyecto-1-APP).

**Revisión local examinada:** [`0abca8cbd7dbf95c01ae0fbccdc67804174a13c9`](https://github.com/ZuluCode777/proyecto-1-APP/tree/0abca8cbd7dbf95c01ae0fbccdc67804174a13c9), último commit fechado 2026-09-24.

## 1. Alcance y criterio de evidencia

Investigación documental y auditoría estática del servidor Next.js, asistente, Ollama, ubicación, anuncios, autenticación, límites, configuración y CI. Este informe propone trabajo ordenado; no implementa funciones, despliega servicios, instala integraciones ni crea issues. No se accedió al equipo Windows ni a archivos de secretos. El material preexistente de `docs/logos/` queda fuera del alcance.

Se abrieron fuentes primarias completas o sus secciones pertinentes; los resultados de búsqueda sirvieron para encontrarlas. La página de precios de Render omitía tablas en la extracción web: se consultó también su HTML oficial y se convirtió a Markdown con MarkItDown, fuera del repositorio. Los dos PDF académicos locales se convirtieron y leyeron del mismo modo. No se ejecutaron compilación, pruebas de producto ni mediciones remotas: las verificaciones siguientes son propuestas, no resultados obtenidos.

**Confianza alta:** afirmación explícita en documentación oficial o comportamiento directamente trazable en código. **Confianza media:** inferencia arquitectónica consistente, pendiente de prueba en entorno objetivo. **Pendiente:** dato que exige cuenta, configuración, medición o validación con usuarios. Ninguna cifra de latencia propuesta constituye un resultado medido.

El enunciado académico local (`EnunciadoProyectoInicial-202610.pdf`, fuera del repositorio), apartados «Prototipar» y «Pruebas y Validación», pide MVP y evidencia de validación. La rúbrica local (`Rubrica de calificacion Entrega Documento Final.pdf`, fuera del repositorio), páginas 2–4, evalúa requisitos, restricciones, tecnología, diseño y ejecución. No contienen una especificación técnica inequívoca llamada «segunda entrega» que obligue a usar Render, IA generativa o notificaciones. Su correspondencia exacta con esta entrega debe confirmarse con el equipo. El enunciado no muestra fecha editorial; la rúbrica muestra una captura del 2026-10-21, que no prueba fecha de publicación. Consulta de ambos: 2026-11-02; sin URL pública verificable.

## 2. Dictamen

La base de costo monetario cero más defendible reutiliza **reglas y herramientas deterministas existentes**, sin modelo remoto ni Ollama en Render. Un servicio web Node gratuito puede ejecutar Next.js con lógica de servidor [R3]; su capacidad real con esta aplicación aún debe medirse. No usar exportación estática: perdería las API y la protección del servidor.

El modelo documentado, `qwen2.5:3b`, tiene 3,09 mil millones de parámetros y un artefacto Q4_K_M de **1,9 GB** [O1]. Render gratuito ofrece **512 MB y 0,1 CPU** [R2]. La relación aproximada de tamaños es `1900 / 512 ≈ 3,7`, antes de Node, contexto y memoria de ejecución. El tamaño del archivo no es una medición de RAM mínima; sí demuestra un desajuste de capacidad importante. Ollama explica que contexto y paralelismo aumentan memoria [O2]. **Conclusión de viabilidad, confianza alta:** no planear alojar el modelo actual junto con Next en esta instancia gratis. No se afirma que todo modelo o toda inferencia CPU sean imposibles.

El riesgo principal del MVP no es escoger otro modelo: el planificador transforma proximidad al trazado en lugares para subir, bajar y transbordar sin confirmar que el servicio se detenga allí. El GPS también anuncia llegada sin incorporar precisión ni antigüedad de la medición. Resolver ambos antes de presentar instrucciones como guía confiable.

## 3. Arquitectura y hallazgos locales

Las rutas y líneas siguientes corresponden a la revisión indicada arriba. Los enlaces relativos abren el archivo auditado; los números permiten localizar la evidencia.

| ID | Hecho comprobado y consecuencia | Evidencia local | Confianza y límite |
| --- | --- | --- | --- |
| C1 | Next `16.3.3`, React 19, `pnpm@12.3.4`; compilación `next build`, ejecución `next start`. No hay exportación estática ni configuración exclusiva de Vercel. | [package.json](../../package.json), líneas 5–22; [next.config.mjs](../../next.config.mjs), líneas 1–8; [app/page.tsx](../../app/page.tsx). | Alta sobre configuración; compatibilidad y memoria en Render pendientes. |
| C2 | Flujo actual: validación → datos → Ollama si está configurado → reglas como respaldo → `runIntent` → respuesta validada en cliente. La separación entre interpretación y resolución ya existe. | [API del agente](../../app/api/agent/route.ts), líneas 37–90; [motor local](../../lib/local-agent.ts), líneas 30–87 y 193–318; [cliente](../../components/total-agent.tsx), líneas 63–78. | Alta. No crear otro orquestador genérico para repetir este flujo. |
| C3 | Ollama recibe frase y catálogo de estaciones/rutas; no recibe coordenadas en su prompt actual. Se valida JSON con Zod y se resuelven nombres contra el catálogo, aunque acertar un nombre existente no prueba interpretar bien la frase. | [Ollama](../../lib/ollama.ts), función `system` y líneas 115–171. | Alta. Primera coincidencia de `findPlaces` puede esconder ambigüedad. |
| C4 | Modelo puede demorar 8 s antes de usar reglas. Datos ArcGIS pueden tardar hasta 20 s por consulta, ejecutadas en paralelo. Cliente espera `fetch` sin plazo propio y luego añade 450 ms por paso y 2,5 s antes de navegar. | [Ollama](../../lib/ollama.ts), línea 21; [consulta](../../lib/transmilenio.ts), líneas 172–197; [cliente](../../components/total-agent.tsx), líneas 17–20 y 65–95. | Alta sobre esperas; suma nominal de datos y modelo cercana a 28 s, no garantía de duración total. |
| C5 | `lastAskRef` impide navegación vieja al final, pero no impide antes mostrar pasos o hablar tras desmontaje; tampoco aborta petición en curso. `busyRef` bloquea nuevas preguntas mientras espera. | [cliente](../../components/total-agent.tsx), líneas 81–105, 144–161. | Alta por inspección; reproducción temporal pendiente. |
| C6 | Datos se guardan 6 h en memoria; fallos usan JSON incluido y reintentan tras 5 min. `pending` agrupa consultas concurrentes. La copia tiene 153 estaciones, 124 rutas y fecha `2026-09-24T15:16:41.502Z`; ocupa 174.778 bytes. | [caché](../../lib/transmilenio-data.ts), líneas 11–33; [copia](../../data/transmilenio.json). | Alta. Al reiniciar se pierde caché, no la copia versionada. La respuesta «live» no significa posición de buses en tiempo real. |
| C7 | `stops` se deduce por distancia ≤60 m al trazado. `planTrip` usa esa lista para embarque/transbordo; respuesta dice «Toma» y «bájate». Advertencia en detalle de ruta no acompaña necesariamente esa instrucción. | [normalización](../../lib/transmilenio.ts), líneas 13–17 y 144–148; [planificador](../../lib/routes.ts), líneas 163–203; [respuesta](../../lib/local-agent.ts), líneas 178–184; [viaje](../../components/trip-view.tsx), líneas 71–79. | Alta sobre inferencia y uso. No se verificó cada parada ni se afirma que todos los planes sean erróneos. |
| C8 | Asistente conserva primera ubicación durante toda su vida montada y descarta `accuracy`/`timestamp`. GPS usa ubicación continua, también descarta esos datos y anuncia llegada a ≤30 m. Oyentes de orientación no se retiran en limpieza; se limpia el último `watchPosition`. | [cliente](../../components/total-agent.tsx), líneas 41–52; [GPS](../../components/auditory-gps.tsx), líneas 31–128. | Alta. No hay evidencia de validación de cruces, aceras, obstáculos o entradas accesibles. |
| C9 | Botón de notificaciones siempre dice «No tienes notificaciones nuevas». No consulta avisos. Cada llamada habitual a `speak` cancela voz anterior; no hay prioridad entre respuesta, llegada y aviso. | [aplicación](../../components/transmivoz-app.tsx), línea 165; [voz](../../hooks/use-speech.ts), líneas 42–61. | Alta. No presentar ausencia de fuente como ausencia de incidentes. |
| C10 | `APP_PASSWORD` activa Basic en toda petición, incluido diagnóstico y cualquier comprobación HTTP de salud. Vacía permite todo. Comparación usa hashes y `timingSafeEqual`. | [proxy](../../proxy.ts), líneas 8–17; [acceso](../../lib/access.ts), líneas 11–21; [.env.example](../../.env.example), líneas 17–20; [arranque](../../instrumentation.ts). | Alta. Clave compartida no equivale a cuentas, roles o cuotas individuales. |
| C11 | Solo `POST /api/agent` usa límite de 20/min por IP. Se toma primer elemento de `x-forwarded-for`. Estado se reinicia con proceso; 5.000 claves es umbral de limpieza, no máximo estricto si todas siguen vigentes. `req.text()` carga cuerpo completo antes de comprobar 2.000 caracteres; mensaje se trunca a 300. | [API](../../app/api/agent/route.ts), líneas 14–30 y 54–70; [limitador](../../lib/rate-limit.ts), líneas 22–49; [API de datos](../../app/api/transmilenio/route.ts). | Alta. No demostrar protección global, límite de bytes ni presupuesto con este contador. |
| C12 | CI instala con lockfile congelado y Node 24; corre tipos, unitarias, prueba PowerShell del instalador, build y diagnóstico en Chrome con Basic. Diagnóstico de reconocimiento solo comprueba existencia de API; ubicación, cámara y micrófono se simulan en verificación automatizada. | [CI](../../.github/workflows/ci.yml), líneas 15–56; [diagnóstico](../../components/diagnostics.tsx), líneas 113–152; [verificador](../../scripts/verificar.mjs), líneas 25–59. | Alta sobre cobertura declarada; no se comprobó estado actual de GitHub Actions ni reconocimiento real. |

**Invariantes que deben conservarse:** `runIntent` resuelve sobre datos; salida del modelo no ejecuta código, abre destinos arbitrarios ni confirma hechos de transporte; entradas y respuestas cruzan esquemas; errores permiten reglas; origen explícito prevalece sobre ubicación; tarifas y llegadas en tiempo real no se inventan. La lista de estaciones existentes limita invenciones, pero no valida paradas, horarios vigentes ni interpretación correcta.

## 4. Render gratuito: condiciones verificadas

Importes en USD, antes de impuestos. Plan del espacio de trabajo y cómputo del servicio son conceptos separados [R1, R2].

| Aspecto | Condición y decisión para este proyecto | Fuente |
| --- | --- | --- |
| Cómputo | `free`: 512 MB, 0,1 CPU, $0/mes. Comparadores de pago: `0.5c-512mb`, 0,5 CPU/512 MB, $7/mes; `1c-2g`, 1 CPU/2 GB, $25/mes; `2c-4g`, 2 CPU/4 GB, $85/mes. Ninguno se contrata aquí. | R1, R2 |
| Reposo y arranque | Tras 15 min sin tráfico entrante HTTP ni mensajes WebSocket, duerme; solicitud siguiente o nueva conexión lo despierta en aproximadamente un minuto. No es SLA. | R4 |
| Horas | 750 horas gratuitas por espacio de trabajo y mes calendario, compartidas; dormido no consume. Agotarlas suspende servicios gratuitos hasta mes siguiente. | R4 |
| Archivos y operación | Archivos escritos se pierden al desplegar, reiniciar o dormir; sin disco persistente, escalado horizontal, SSH ni trabajos puntuales en plan gratuito. Copia versionada sí vuelve con despliegue. | R4 |
| Salida y compilación | Hobby: 5 GB/mes y 500 min/mes. Exceso: $0,15/GB y $5/1.000 min. Sin medio de pago, agotar salida suspende servicios gratuitos; agotar minutos impide nuevas compilaciones. El límite de gasto de compilación no cubre todo consumo. | R1, R4, R5 |
| Compilar frente a ejecutar | Compilación Starter separada: 2 CPU/8 GB. Límite de disco 16 GB; build 120 min; predespliegue 30 min. Build exitoso no demuestra ejecución dentro de 512 MB. | R5 |
| Procesos de fondo y cron | Workers son otro servicio continuo y no tienen plan `free`. Cron tiene mínimo $1/mes por servicio, cobro proporcional y ejecución máxima 12 h. Temporizador dentro del web gratuito no sustituye scheduler durable. | R2, R6, R7 |
| WebSockets | Admitidos por mismo puerto HTTP público; `wss` en internet. Sin duración máxima fija ni cupo fijo de conexiones, pero sí recursos limitados y cortes por reinicio. Mensajes salientes consumen ancho de banda. No hacen falta para eventos locales actuales. | R8 |
| Node y puerto | Fijar Node 24, alineado con CI. Render documenta `24.22.1` como predeterminado desde 2026-10-21. Escuchar en `0.0.0.0` y `$PORT`, normalmente 10000. TLS termina en Render. | R9, R10 |
| Raíz del repositorio | `visionaria` es raíz Git local: `package.json` y lockfile están allí. Root Directory vacío para este repositorio; no escribir `visionaria` por su nombre de carpeta local. En monorepo real, `rootDir` cambia raíz y archivos externos dejan de estar disponibles. | C1; R11 |
| Salud | TCP predeterminado; HTTP opcional debe devolver 2xx/3xx en ≤5 s. Despliegue sin salud se cancela tras 15 min; servicio activo pierde tráfico tras 15 s fallando y se reinicia tras 60 s. HTTP `/` daría 401 con clave. | R12; C10 |

La documentación desaconseja Free para producción y permite reinicios. Existe además un umbral de tráfico saliente iniciado por el servicio que puede suspenderlo, sin cifra pública [R4]. Con estas restricciones, Render sirve para demostración; no sustenta promesa de asistencia siempre disponible. No añadir pings artificiales para evitar reposo. Una apertura manual previa a exposición puede preparar demo, pero no elimina limitación.

### Configuración propuesta, no aplicada

Para futura implementación basta un servicio web Node. No requiere Docker, base de datos, Redis, cron, servidor WebSocket ni cambiar Next. Antes de publicar, resolver controles de E2-03 y aprobar exposición.

```yaml
# Propuesta de render.yaml para la raíz Git; no es un archivo aplicado.
services:
  - type: web
    name: transmivoz-expoandes
    runtime: node
    plan: free
    repo: https://github.com/ZuluCode777/proyecto-1-APP
    branch: main
    autoDeployTrigger: off
    buildCommand: corepack pnpm install --frozen-lockfile && corepack pnpm build
    startCommand: corepack pnpm start -H 0.0.0.0 -p "$PORT"
    envVars:
      - key: NODE_VERSION
        value: "24.22.1"
      - key: OLLAMA_MODEL
        value: ""
      - key: APP_PASSWORD
        sync: false
```

`corepack pnpm` debe resolver la versión ya fijada por `packageManager`; comprobar disponibilidad en build y ejecución antes de aprobar configuración [R17]. No introducir otra versión o actualizar dependencias para adaptar el hosting. `sync: false` exige ingresar secreto en Render: no genera ni garantiza clave fuerte; el responsable debe configurarla y verificar rechazo sin credenciales. No reutilizar secretos del equipo actual. `OLLAMA_BASE_URL` no hace falta con modelo vacío; `127.0.0.1` en Render sería Render, nunca el equipo Windows.

Se omite `healthCheckPath`: TCP funciona con autenticación actual. Si se requiere salud HTTP, crear después una ruta mínima específica, sin consultas ArcGIS/modelo, con excepción de autenticación limitada a esa ruta y pruebas de que todo lo demás sigue protegido. No usar `/api/agent` como salud: puede consultar/precargar Ollama. Sintaxis y despliegues manuales: [R13]. La propuesta no ha sido validada por Render.

**Control de costo cero:** espacio Hobby, un web `free`, ningún recurso pagado, ninguna API de inferencia, sin medio de pago si la cuenta lo permite y suspensión aceptada al alcanzar cuotas. Confirmar consumos compartidos del espacio. Si hay tarjeta asociada, no prometer factura cero solo porque cómputo sea gratuito.

### Validación y reversión propuestas

1. Registrar commit, Node y pnpm efectivos. CI debe pasar `pnpm exec tsc --noEmit`, `pnpm test`, `pnpm build`, `pnpm verificar` y prueba PowerShell ya existente. Comprobar lockfile sin cambios. Build en Linux debe poder descargar fuente usada por `next/font/google` o reportar fallo.
2. En futuro despliegue autorizado: sin clave, `/` y API responden 401; clave incorrecta también; credenciales correctas permiten diagnóstico. Clave y cabecera nunca se registran ni incluyen en comandos compartidos.
3. Con `OLLAMA_MODEL` vacío, `GET /api/agent` indica reglas y ninguna prueba intenta contactar Ollama o proveedor. Frases conocidas producen mismos resultados que referencia local.
4. Medir arranque tras >15 min inactivo y luego 30 solicitudes calientes con concurrencia representativa de demo, distribuidas entre ventanas para respetar 20/min por IP; comprobar 429 en ensayo separado. Registrar memoria máxima, errores, p50/p95 y fuente de datos. Objetivo propuesto de memoria: ≤400 MB en ejecución; margen de ingeniería, no cuota oficial ni resultado.
5. Simular ArcGIS caído: respuesta usa copia con fecha visible. Reiniciar: copia sigue; caché y contador pueden reiniciarse. Medir espera máxima actual antes de aceptar demo; E2-04 aborda esa demora.
6. Comprobar permisos, teclado, lector de pantalla y voz en dispositivos reales. Ejecutar `pnpm verificar` desde entorno autorizado con Chrome; sus permisos simulados no prueban accesibilidad real ni reconocimiento correcto.
7. Reversión: desactivar nuevo servicio o volver al artefacto anterior disponible; Free conserva solo dos despliegues previos para rollback [R4]. No borrar código, JSON, preferencias ni instalación existente. Cambio de origen a `onrender.com` no transporta `localStorage`: favoritas y preferencias no se migran automáticamente. Conservar origen anterior y explicar diferencia; cualquier exportación futura sería trabajo separado.

No considerar `maxDuration = 30` un plazo efectivo demostrado en Render: Next lo describe como configuración dependiente de plataforma [N1]. Límites de espera y cancelación deben existir en llamadas concretas.

## 5. Asistente de baja latencia y avisos con evidencia

### Base gratuita y transición reversible

**Actual:** navegador escribe/habla → API → ArcGIS/caché → modelo opcional primero → herramientas → pasos animados → voz/navegación. **Propuesto:** controles de seguridad y cancelación locales → reglas para comandos reconocidos → herramientas sobre datos disponibles → modelo opcional solo ante intención no resuelta → validación semántica → mismas herramientas. No enviar resultado parcial del modelo a voz ni ejecutar dos acciones por una pregunta.

Reutilizar `Intent`, `AgentReplySchema`, `parseIntent`, `runIntent`, funciones geográficas y `useSpeech`. No crear un framework de agentes, cola remota o interfaz para proveedores imaginados. Desactivar Ollama por configuración ya mantiene API y esquemas actuales. Si luego se añade otro motor, actualizar de forma aditiva el enum `engine` en servidor, cliente y diagnóstico: clientes viejos solo aceptan `reglas|ollama`. Antes de habilitarlo, desplegar lectores compatibles; durante transición mantener modelo apagado. Para revertir, apagar proveedor primero y conservar lectores amplios hasta drenar sesiones. No etiquetar motor remoto como Ollama para esquivar validación.

La ruta determinista debería funcionar en navegador con datos ya cargados, incluso si servidor duerme. Hoy ese respaldo solo llega cuando `fetch` falla; no equivale a respuesta inmediata. Para datos de primera carga, evaluar servir copia disponible antes de esperar actualización, conservando `source` y `fetchedAt`; no ocultar antigüedad ni reemplazar silenciosamente una copia reciente por otra vieja. Sin página ni datos cargados no existe garantía offline. Voz actual tampoco es íntegramente local: `SpeechRecognition` puede enviar audio a servicio del navegador [V1]; código no activa reconocimiento local. Mantener entrada por texto y controles explícitos. Tiles del mapa necesitan red.

**Objetivos propuestos para medir:** respuesta local a comando conocido con datos cargados, p95 ≤500 ms hasta texto útil; primera confirmación audible ≤1 s cuando voz esté lista; modelo opcional con presupuesto máximo de espera de 2 s y respaldo inmediato al vencer. Medir por separado reconocimiento, datos, interpretación, herramientas, síntesis y navegación. Los objetivos no incluyen minuto de arranque frío ni son promesa para hardware no probado. Retirar pausas artificiales del camino crítico. En Ollama conservar telemetría agregada de `load_duration`, `prompt_eval_duration`, `eval_duration` y `total_duration`, expresadas originalmente en nanosegundos [O4]; no registrar audio, frases completas ni coordenadas precisas.

### Orquestación local de ubicación, anuncios y direcciones

| Evento o intención | Dueño y resultado permitido | Restricción y prueba necesaria |
| --- | --- | --- |
| Ubicación nueva | GPS del navegador conserva coordenadas, precisión y hora; herramientas calculan distancia y rumbo. | W3C define precisión como radio en metros y expone hora [V2]. Rechazar datos viejos o insuficientes; pedir origen manual. Alta precisión solicitada no garantiza calidad. |
| Orientación o llegada | Cálculo local; anunciar proximidad con incertidumbre, separado de confirmar entrada a estación. | Umbrales iniciales a ensayar: dato ≤15 s, precisión ≤20 m y dos muestras coherentes antes de anunciar proximidad a 30 m. Son parámetros de prueba, no garantía de seguridad. Sin rumbo terrestre confiable usar punto cardinal; no convertir `alpha` relativo en norte confirmado. |
| Aviso de operación | Solo fuente verificada con identificador, fecha, vigencia y afectación, o contenido editorial del equipo claramente identificado. | Modelo no crea incidentes. Sin fuente: «No hay fuente de avisos operativos conectada». Una muestra debe anunciarse como simulación. |
| Aviso propio de sesión | Eventos reales: permiso denegado, GPS impreciso, datos antiguos, conexión caída, destino próximo. Lista en memoria con deduplicación, lectura y silencio. | Distinguir avisos del sistema de novedades del transporte. No hace falta push ni almacenamiento externo para este alcance. |
| Anuncio hablado | Extender dueño existente de voz con prioridad y una sola emisión activa. Cancelar invalida petición, pasos y navegación pendientes. | Mensaje urgente debe poder interrumpir respuesta rutinaria; cambios rutinarios no deben borrar advertencia. Desmontar retira timers, GPS y oyentes. |
| «Cómo llegar» | Planificar solo sobre paradas confirmadas; orientación geométrica se describe como aproximación. Enlace a Google Maps desde acción explícita. | Ya existe URL `api=1` y `travelmode=walking`; Maps URLs no requiere clave [V3]. No es integración de Directions API ni prueba de accesibilidad del itinerario. |

El bucle de seguridad queda en dispositivo y funciones deterministas; no espera inferencia ni servidor para cancelar o avisar que GPS dejó de ser confiable. No ordenar cruzar, declarar andén libre, detectar bus o confirmar embarque sin sensores/datos y validación que hoy no existen. Los anuncios no sustituyen ayudas de movilidad ni acompañamiento. El navegador limita ejecución en pestañas ocultas [V4]; no prometer avisos con pantalla bloqueada, app cerrada o sesión suspendida. Validar uso acompañado, sin exponer participantes a instrucciones no comprobadas.

### Modelo externo: opcional y sujeto a autorización concreta

No hay API externa ni proveedor aprobado en código. Mantenerlo así en base gratuita. Ollama Cloud no es sustitución transparente: precio de suscripción inicial $0 significa pago por tokens; además documentación actual dice que nube no soporta salidas estructuradas, usadas por esta app [O3, O5]. No cambiar solo `OLLAMA_BASE_URL` ni exponer Ollama del equipo personal.

Como referencia de alternativas, Gemini distingue modelos con nivel gratuito limitado y modelos solo de pago; condiciones de datos difieren entre niveles [G1]. Sus cuotas son por proyecto, no por clave, y no garantizan capacidad [G3]. Salida estructurada tampoco demuestra exactitud semántica [G4]. Esta comparación no selecciona proveedor, modelo, SDK ni migración de API. No se propone migración a productos OpenAI.

Antes de habilitar cualquier proveedor, ticket separado debe contener autorización de proveedor/modelo exacto, datos enviados, presupuesto máximo y responsable; precios vigentes y elegibilidad comprobados en cuenta real; secreto solo en servidor; límite de entrada/salida y de concurrencia; cuota total previa a cada llamada; sin reintentos ilimitados ni cambio automático a otro proveedor. No enviar ubicación exacta, audio ni historial si basta frase mínima y catálogo reducido.

Un contador de proceso no puede imponer gasto acumulado entre reinicios. Usar control externo de gasto verificable o contador persistente con reserva atómica antes de llamar; si ello obliga a pagar o complica desproporcionadamente MVP, dejar proveedor apagado. Agotar cuota, no poder comprobar presupuesto, 429, caída o vencimiento deben resolver con reglas. Gemini documenta topes por proyecto experimentales con retraso aproximado de 10 min y posibles excedentes [G2]; no tratarlos como garantía de gasto máximo exacto. Tampoco correo de alerta equivale a corte. Si no se puede asegurar techo aprobado, no habilitar facturación.

## 6. Kiro: acceso real, riesgos y contrato mínimo

Kiro Web requiere plan Pro, Pro+, Pro Max o Power; no suponer gratuidad por tener GitHub [K1]. Integración oficial instala **Kiro Agent GitHub App** en repositorios seleccionados. Usuario necesita acceso de escritura. Etiqueta `kiro` o comentario `/kiro` pueden iniciar trabajo; después crea rama, commits y PR. Permisos documentados incluyen escritura en contenido, issues, PR, Actions, checks y workflows; administración es de lectura. Limitar instalación al repositorio y revisar permisos antes de autorizarla. Propietario puede revocar acceso; varios usuarios pueden iniciar tareas duplicadas [K2].

Modo autónomo puede planear, delegar internamente, verificar y abrir PR; no garantiza corrección. Kiro Web declara no fusionar automáticamente [K1, K3]. Rama protegida, comprobaciones requeridas y revisión humana siguen siendo controles del proyecto. Este informe no instaló ni ejecutó Kiro.

Kiro soporta `AGENTS.md` [K4]. Reutilizar instrucciones existentes en español y las verificaciones de CI; no copiar otra colección de reglas. Sandbox incluye Chrome, pero hay que comprobar Node 24, pnpm fijado y PowerShell para reproducir todas las comprobaciones [K5, K7]. Acceso a internet puede restringirse por dominios [K6]. Autorizar solo registries y fuentes necesarias; comprobar descarga de tipografía durante build y tiles/datos durante diagnóstico. No dar credenciales de despliegue, red privada o equipo Windows para modificar UI o reglas.

Riesgos que revisión debe comprobar: inyección de instrucciones en issues o documentos externos, dependencia maliciosa, cambios a CI para aparentar éxito, exfiltración por red, ampliación del alcance y PR paralelos sobre mismos archivos. Son amenazas del flujo, no incidentes observados. Pedir resultado reproducible con simulaciones de proveedor; nunca dar secretos de producción para «hacer pasar» pruebas.

**Contrato mínimo por ticket, listo para redactar después en español:**

- Problema reproducible, usuario afectado, referencia C1–C12 y fuente oficial cuando aplique.
- Comportamiento antes/después, alcance permitido, exclusiones y dependencias.
- Criterios observables, casos de fallo, accesibilidad, privacidad y presupuesto cuando corresponda.
- Pruebas específicas que fallen antes y pasen después; cuatro comandos de `AGENTS.md` y comprobación PowerShell existente. PR debe informar comandos, resultado, commit y límites de lo simulado.
- Invariantes, compatibilidad de `Intent`/`AgentReply`, migración aditiva si cambia contrato y reversión sin borrar datos.
- Entrega como PR revisable; no fusionar, publicar, crear recursos pagados ni acceder a Windows. Ninguna modificación de workflows o dependencias fuera del objetivo autorizado.
- Condición de parada: alcance satisfecho y verificaciones requeridas aprobadas. Si falta entorno o decisión material, documentar bloqueo exacto; no inventar prueba exitosa.

Estas pruebas son exigencias del repositorio y del ticket propuesto; no afirmación de que Kiro ejecute automáticamente esa batería.

## 7. Borradores de issues ordenados

Identificadores **locales de planificación**, no números de GitHub. P0 bloquea publicación como guía confiable; P1 prepara demostración; P2 es opcional. Cada futura issue debe incorporar contrato anterior. Ninguna fue creada.

| Orden / ID | Prioridad, evidencia y alcance | Aceptación y prueba mínima | Dependencia y reversión |
| --- | --- | --- | --- |
| 1. E2-01: Separar trazado y paradas confirmadas | P0, C7. Dueños: normalización, planificador y respuesta. Registrar procedencia de paradas; usar conjunto verificado para planes. Si falta, conservar consulta de trazado y abstenerse de indicar embarque/transbordo. | Caso de expreso pasa cerca de estación donde no para: nunca decir «sube» allí. Caso con paradas verificadas mantiene viaje directo y transbordo. Si no hay fuente, incertidumbre visual y hablada, sin itinerario prescriptivo. | Sin dependencia. Cambio aditivo de datos; lectores antiguos compatibles antes de habilitar nuevos datos. Revertir capacidad de planificación, conservando mapa y evidencia. |
| 2. E2-02: Ubicación confiable y limpieza del GPS | P0, C8; V2. Guardar precisión/hora, renovar contexto, degradar orientación y llegada; retirar todos los observadores. | Pruebas con ubicación vieja, ±100 m de precisión, permiso denegado y `alpha` relativo: ninguna llegada ni giro seguro inventados. Dos muestras válidas producen proximidad una vez. Montar/desmontar no acumula oyentes. | Puede avanzar tras definir invariantes de E2-01. Mantener campos nuevos opcionales; dato viejo pasa a origen manual. No revertir a afirmar llegada con GPS inválido. |
| 3. E2-03: Controles de publicación y recursos | P0 para exposición, C10–C11; R14. Conservar Basic, verificar cabeceras del proxy, limitar tamaño antes de acumular cuerpo y acotar mapa de claves. | Sin clave de petición/correcta/incorrecta: 401/éxito/401 con secreto configurado. Probar cadena XFF aportada por cliente a través de Render antes de confiar en primer elemento. Cuerpos fragmentados excesivos se cortan por bytes; cuota devuelve 429 y `Retry-After`; muchas claves no crecen sin límite. | Antes de E2-05. No sustituir IP por socket del proxy ni añadir Redis por defecto. Reversión segura: suspender exposición. Presupuesto remoto queda fuera hasta E2-09. |
| 4. E2-04: Reglas primero y cancelación efectiva | P1, C2–C6. Reutilizar motor local y esquema, acotar esperas de datos/red/modelo y quitar pausas del camino crítico. | Comandos conocidos no llaman modelo; datos cargados + servidor sin respuesta producen resultado local dentro del objetivo. Cancelar o salir impide voz, pasos y navegación tardíos. Modelo inválido/tardío conserva reglas; medir p95 por etapa. | E2-01 para planes, E2-02 para contexto. Mantener API y acción única. Reversión: reglas sin proveedor y sin animaciones demoradas. |
| 5. E2-05: Configuración Render reproducible, sin publicación automática | P1, C1, C10, C12; R1–R13, R17. Materializar configuración propuesta y guía de comprobación; despliegue requiere encargo posterior. | Validar sintaxis, raíz, Node/pnpm, puerto, modelo vacío y salud TCP. CI verde. Cuando exista autorización de despliegue, comprobar memoria, reinicio, frío, cuotas y autenticación; registrar evidencia sin secretos. | E2-03 y aceptación de reposo/cuotas; E2-04 para experiencia tolerable. Sin dependencia de Windows. Revertir nuevo servicio o configuración, conservar copia y origen anterior. |
| 6. E2-06: Avisos de sesión y anuncios coordinados | P1, C9; V4. Extender aplicación y voz existentes con avisos reales de sesión, deduplicación, prioridad, lectura y silencio. Estado explícito de fuente operativa no conectada. | GPS deficiente interrumpe mensaje rutinario; repetición del mismo evento no duplica voz. Cancelar limpia sesión. Botón deja de afirmar ausencia de incidentes sin fuente. Prueba teclado/lector y texto equivalente. | E2-02, E2-04. Sin push, cron, servidor WebSocket ni feed operativo inventado. Estado en memoria; reversión oculta lista y conserva avisos esenciales. |
| 7. E2-07: Evidencia de segunda entrega y pruebas de fallo | P1, C12 y rúbrica. Extender pruebas de comportamiento y documentar demostración, límites y trazabilidad requisito → evidencia. | CI existente completa; casos E2-01–06 cubiertos. Probar dispositivo real, permisos rechazados, ubicación inexacta, fuente caída y voz no soportada. Reconocimiento real con frases conocidas y ruido, acompañado y seguro; distinguir simulación de validación humana. | Cierre después de E2-01–06. Guardar resultados anonimizados y commit; corregir afirmaciones del diagnóstico que excedan prueba real. No añadir plataforma de pruebas por defecto. |
| 8. E2-08: Preparar delegación acotada en Kiro | P2, K1–K7. Solo tras autorización de cuenta/permisos; limitar repositorio, red, rama y ticket. | Cuenta elegible comprobada; permisos revisados; rama protegida y checks requeridos verificados. Ensayo con ticket pequeño, PR y evidencia de pruebas, sin despliegue ni secretos. Si no hay plan elegible, desarrollo manual sigue disponible. | Es prerrequisito si se decide delegar cualquiera de las issues, aunque figure después de necesidades de producto. Revocar App/conexión y cerrar rama/PR si se abandona. |
| 9. E2-09: Evaluar modelo de intención externo | P2, O3–O5, G1–G4. Solo con proveedor, modelo, tratamiento de datos y presupuesto aprobados. Comparar contra reglas y mantener mismas herramientas. | Corpus español fijado antes de evaluar; medir mejora de intención, latencia, costo y errores semánticos. 429, cuota agotada, timeout y reinicio del servicio no habilitan gasto fuera del techo. Sin autorización o ventaja medible, ticket termina con decisión de no integrar. | E2-03, E2-04, E2-07. Lectores compatibles con nuevo `engine` antes de habilitar. Revertir apagando proveedor; ninguna función básica depende de él. |

## 8. Fuentes, fechas e incertidumbres

Todos los enlaces siguientes se abrieron el **2026-11-02**. «s. f.» significa que no se identificó fecha editorial explícita; no se sustituyó por fecha de rastreo ni por copyright. Publicador es responsable del producto o estándar, salvo MDN, documentación mantenida por comunidad de plataforma. Las condiciones son foto de consulta y deben revisarse antes de contratar o desplegar.

| ID | Fuente y publicador | Publicación o actualización visible | Evidencia y confianza |
| --- | --- | --- | --- |
| R1 | [Precios — Render](https://render.com/pricing) | s. f.; HTML oficial consultado y convertido | Precios, 5 GB y 500 min. Alta; confirmar cuenta y región al contratar. |
| R2 | [Planes de cómputo — Render](https://render.com/docs/compute-plans) | s. f.; documenta nuevos identificadores desde agosto de 2026 | CPU/RAM y ausencia de worker/cron `free`. Alta. |
| R3 | [Desplegar Next.js — Render](https://render.com/docs/deploy-nextjs-app) | s. f. | Web Node para lógica de servidor; estático solo para exportación. Alta. |
| R4 | [Despliegue gratuito — Render](https://render.com/docs/free) | s. f. | Reposo, horas, disco efímero, cuotas, restricciones y rollback. Alta. |
| R5 | [Compilación — Render](https://render.com/docs/build-pipeline) | s. f. | Recursos separados, límites y gasto de compilación. Alta. |
| R6 | [Cron — Render](https://render.com/docs/cronjobs) | s. f. | Mínimo mensual, duración y semántica de ejecución. Alta. |
| R7 | [Workers — Render](https://render.com/docs/background-workers) | s. f. | Proceso continuo separado del servidor HTTP. Alta. |
| R8 | [WebSockets — Render](https://render.com/docs/websocket) | s. f. | Puerto, duración, reconexión y salida facturable. Alta. |
| R9 | [Versión de Node — Render](https://render.com/docs/node-version) | s. f.; tabla efectiva desde 2026-10-21 | Versión predeterminada y formas de fijarla. Alta. |
| R10 | [Servicios web — Render](https://render.com/docs/web-services) | s. f. | Puerto, dirección de escucha y TLS. Alta. |
| R11 | [Monorepos — Render](https://render.com/docs/monorepo-support) | s. f. | Alcance de raíz y comandos. Alta. |
| R12 | [Salud — Render](https://render.com/docs/health-checks) | s. f. | TCP/HTTP, tiempos y fallos. Alta. |
| R13 | [Referencia de Blueprint — Render](https://render.com/docs/blueprint-spec) | s. f. | `runtime`, `plan`, `autoDeployTrigger`, variables y salud. Alta sobre sintaxis documentada; propuesta sin validar. |
| R14 | [Protección y responsabilidad ante DDoS — Render](https://render.com/articles/how-render-handles-ddos-attacks) | 2026-04-01 | Uso de XFF y límites de protección de aplicación. Alta; no demuestra cómo se sanea una cadena arbitraria en esta cuenta. |
| R17 | [Versiones reproducibles — Render](https://render.com/articles/pinning-nodejs-python-ruby-versions) | s. f. | `packageManager`, Corepack y lockfile. Alta como pauta; disponibilidad concreta pendiente. |
| N1 | [Configuración de segmentos — Next.js/Vercel](https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config) | Actualizada 2026-10-01 | `maxDuration` depende de plataforma. Alta; no confirma ejecución de este proyecto. |
| O1 | [Ficha `qwen2.5:3b` — Ollama](https://ollama.com/library/qwen2.5:3b) | Ficha sin fecha editorial exacta; licencia indica 2024-09-19 | 1,9 GB, 3,09B, Q4_K_M. Alta; descarga no equivale a RAM medida. |
| O2 | [Preguntas frecuentes — Ollama](https://docs.ollama.com/faq) | s. f. | Precarga, `keep_alive`, memoria, cola y paralelismo. Alta. |
| O3 | [Salidas estructuradas — Ollama](https://docs.ollama.com/capabilities/structured-outputs) | s. f. | Esquema local; nube actualmente no soportada. Alta, condición temporal. |
| O4 | [Métricas de uso — Ollama](https://docs.ollama.com/api/usage) | s. f. | Duraciones y tokens; tiempos en nanosegundos. Alta. |
| O5 | [Precios — Ollama](https://ollama.com/pricing) | s. f. | Sin suscripción no significa inferencia cloud gratuita. Alta. |
| G1 | [Precios — Google Gemini API](https://ai.google.dev/gemini-api/docs/pricing) | Actualizada 2026-10-30 UTC | Gratuidad limitada por modelo y condiciones de datos. Alta. |
| G2 | [Facturación — Google Gemini API](https://ai.google.dev/gemini-api/docs/billing) | Actualizada 2026-09-28 UTC | Planes y topes con latencia/excedentes. Alta; situación de cuenta desconocida. |
| G3 | [Límites — Google Gemini API](https://ai.google.dev/gemini-api/docs/rate-limits) | No se verificó fecha editorial | Cuotas por proyecto y capacidad no garantizada. Alta. |
| G4 | [Salidas estructuradas — Google Gemini API](https://ai.google.dev/gemini-api/docs/structured-output) | No se verificó fecha editorial | Validación semántica sigue a cargo de aplicación. Alta. |
| K1 | [Kiro Web — AWS/Kiro](https://kiro.dev/docs/web/) | Actualizada 2026-10-23 | Planes admitidos y revisión antes de rama predeterminada. Alta. |
| K2 | [GitHub — AWS/Kiro](https://kiro.dev/docs/web/github/) | Actualizada 2026-10-21 | Instalación, disparadores, permisos, PR y revocación. Alta. |
| K3 | [Modo autónomo — AWS/Kiro](https://kiro.dev/docs/web/autonomous-mode/) | Actualizada 2026-10-02 | Planificación, ejecución y PR; no garantía de pruebas del proyecto. Alta. |
| K4 | [Instrucciones persistentes — AWS/Kiro](https://kiro.dev/docs/steering/) | Actualizada 2026-10-21 | Compatibilidad con `AGENTS.md`. Alta. |
| K5 | [Sandbox — AWS/Kiro](https://kiro.dev/docs/web/sandbox/) | Actualizada 2026-10-21 | Aislamiento y Chrome incluido. Alta. |
| K6 | [Acceso a internet — AWS/Kiro](https://kiro.dev/docs/web/sandbox/internet-access/) | Actualizada 2026-10-02 | Niveles y lista de dominios permitidos. Alta. |
| K7 | [Configuración del entorno — AWS/Kiro](https://kiro.dev/docs/web/sandbox/environment-configuration/) | Actualizada 2026-10-21 | Detección del proyecto y configuración de entorno. Alta; no prueba herramientas instaladas en sesión futura. |
| V1 | [SpeechRecognition — MDN](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition) | Modificada 2026-08-19 | Soporte limitado y reconocimiento potencialmente remoto. Alta para API, comportamiento concreto pendiente. |
| V2 | [Geolocalización — W3C](https://www.w3.org/TR/2026/CRD-geolocation-20261030/) | Borrador de recomendación candidata, 2026-10-30 | Precisión, fecha y permisos. Alta sobre interfaces descritas; borrador no es recomendación final. |
| V3 | [Maps URLs — Google Maps Platform](https://developers.google.com/maps/documentation/urls/get-started) | Actualizada 2026-10-30 UTC | Enlaces de direcciones sin clave. Alta; no certifica accesibilidad peatonal. |
| V4 | [Visibilidad de página — MDN](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API) | Modificada 2025-12-30 | Limitaciones de ejecución en segundo plano. Alta; comportamiento depende de navegador/SO. |

**Incertidumbres pendientes que cambian decisiones:**

- Fecha, alcance y criterio docente exactos de segunda entrega; los PDF locales no sustituyen confirmación del equipo.
- Memoria, arranque, latencia y concurrencia reales de esta aplicación en Render Free; compatibilidad efectiva de Node/pnpm fijados y disponibilidad de compilación. No se ha desplegado.
- Saneamiento exacto de XFF en recorrido real del servicio y controles de cuota del espacio de trabajo. No asumir cabecera confiable por nombre.
- Fuente con secuencia confirmada de paradas por servicio, vigencia y permisos de reutilización. El servicio ArcGIS usado por código no demuestra ausencia global de otras fuentes de TransMilenio ni de información en tiempo real.
- Calidad de GPS, rumbo, síntesis y reconocimiento en dispositivos de participantes; funcionamiento con pantalla bloqueada y ruido. Pruebas simuladas no resuelven esto.
- Fuente oficial de avisos operativos y frecuencia de actualización. Ninguna conectada en código examinado; no afirmar que no existan fuentes externas.
- Cuenta elegible y aceptación de permisos/costos de Kiro; proveedor/modelo externo y techo de gasto todavía no seleccionados ni autorizados.
- Configuración efectiva de Ollama en Windows no inspeccionada por alcance; `qwen2.5:3b` es el modelo documentado en el repositorio, no una comprobación del proceso remoto actual.

**Punto de cierre de esta investigación:** un informe con evidencia, configuración propuesta y borradores ordenados. Implementación, creación de issues, activación de Kiro, facturación y despliegue quedan para encargos posteriores explícitos.
