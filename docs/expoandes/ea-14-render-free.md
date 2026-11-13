# EA-14 (#40): Render Free, preparación y validación en vivo del 2026-11-06

Este documento junta dos cosas con alcance distinto:

- **Preparación (histórico).** Rama `ea-14-render-free`, desde `origin/main`
  66cdd87 (con EA-06, EA-08 y EA-10 fusionados). Entregó `render.yaml`, la guía
  [`docs/RENDER.md`](../RENDER.md), el script de medición y HSTS. Las secciones
  «Qué se entrega», «Decisiones y su fuente», «HSTS» y «Prueba local» describen
  ese trabajo y esas pruebas locales; no miden Render. Cuando se escribieron, no
  se había tocado ningún servicio de Render.
- **Validación en vivo (6 de noviembre de 2026).** Mediciones reales sobre el
  servicio manual existente, `https://transmivoz.onrender.com` (Free, Virginia),
  con la revisión `main` en `e269a8a6656b488ffe032c999e1d5160a5876c7c`. No es el
  `main` actual del repositorio. Informe y evidencia sanitizada:
  [`verificaciones/render-2026-11-06-e269a8a/informe.md`](verificaciones/render-2026-11-06-e269a8a/informe.md).

## Estado actual

De los 13 criterios de #40, **6 están marcados «Medido»** y **7 «Parcial»**;
ninguno queda sin evidencia. «Medido» es una observación registrada del
comportamiento que dice la fila, no la aceptación completa del criterio de #40
(por ejemplo, HSTS no registra cuántas cabeceras llegaron). Los criterios
parciales y los límites de abajo siguen abiertos, así que **#36 y #40 no se
cierran con este trabajo**.

Qué quedó fijado el 2026-11-06:

- El servicio se validó tal como estaba: Node 24 (`NODE_VERSION=24`, resuelto a
  24.22.2), pnpm 12.3.4, build `pnpm install --frozen-lockfile && pnpm run build`,
  inicio `pnpm run start`, auto-deploy `After CI Checks Pass`. **No coincide con
  `render.yaml`** (Node 24.22.1, `corepack pnpm`, despliegue manual). El Blueprint
  no se importó, no se creó otro servicio y **`corepack pnpm` no se validó en
  Render**.
- Las pruebas de proxy, memoria y la serie con tráfico paralelo usaron una
  revisión temporal de diagnóstico (`f32c92b`, rama no fusionada): el código de
  diagnóstico no forma parte de `main` ni de este PR.
- La prueba de fuente caída (filas 10 y 11) usó un despliegue temporal de
  diagnóstico con el comando de inicio alterado. **El SHA exacto de ese despliegue
  no se registró**: no se afirma que fuera `main` ni que fuera `f32c92b`.
- Todo lo medido de memoria, reposo y proxy es de una sola corrida (por red, en el caso del proxy). Las lecturas
  de memoria son puntuales, no una carga sostenida de feria.
- Chrome usó dispositivos simulados. No hay validación con iPhone, BLE, audio
  ni VoiceOver reales. La máquina con Windows (`dfbd388`) tiene sus tareas en
  `Ready`, pero el puerto 3000 no respondía: no queda acreditada como respaldo
  operativo.
- Al terminar, Render volvió por rollback al artefacto original de `main`: solo
  quedan `APP_PASSWORD` y `NODE_VERSION`, la ruta de sonda da 404 y las ramas
  de diagnóstico no se fusionaron.

## Qué se entrega

| Archivo | Para qué |
| --- | --- |
| `render.yaml` | Un web Node `free`, despliegue manual, Node 24.22.1, `pnpm install --frozen-lockfile`, `next build`, `next start -H 0.0.0.0 -p "$PORT"`, `OLLAMA_MODEL` vacío, `APP_PASSWORD`, `OLLAMA_BASE_URL` y `OLLAMA_TOKEN` con `sync: false` (las dos últimas, de EA-27, solo cuentan si se activa el modelo). Sin disco, base de datos, worker, cron, Docker ni ruta de salud HTTP (comprobación TCP por omisión). |
| `docs/RENDER.md` | Cómo activar, adoptar o crear el servicio sin duplicarlo, desplegar, comprobar y revertir. |
| `scripts/medir-render.mjs` | Mediciones en vivo por HTTPS: credenciales (`/`, `/api/agent` GET y POST, `/api/transmilenio`), latencia, primera petición tras reposo, 429. La clave solo sale del entorno. |
| `next.config.mjs` | `Strict-Transport-Security: max-age=15552000` en todas las rutas. |
| `lib/ea14-render.test.ts`, `lib/ea14-medir-render.test.ts` | Guardas de `render.yaml` y HSTS; lógica del script de medición con respuestas simuladas. |

### Decisiones y su fuente

Histórico de la preparación, no de la validación en vivo. Consultadas el 2026-11-06 en la documentación oficial de Render (`render.com/docs`).

- **Node.** `NODE_VERSION` tiene la máxima precedencia y los servicios creados
  antes del 2026-10-21 tienen otro valor por defecto, así que se fija la versión
  exacta `24.22.1` (el valor por defecto actual de Render) y el mismo major que la
  integración continua (24). No se añadió `.node-version` ni `engines`: el repo no
  tenía fijación y la variable basta.
- **pnpm.** `corepack pnpm` toma la versión de `packageManager` (12.3.4). Con
  Node 24, Corepack viene incluido. Se comprobó localmente (ver más abajo). En Render no se validó: el servicio
  manual compiló con `pnpm` directo, sin `corepack pnpm`.
- **Salud.** Se omite `healthCheckPath`: `/` y la API devuelven 401 con clave, y
  Render exige 2xx o 3xx. La comprobación TCP por defecto se mantiene. Una ruta
  HTTP de salud con excepción de autenticación sería trabajo aparte.
- **Sin `repo`, `branch`, `region` ni `domains`.** Render usa el repositorio que
  contiene el archivo y su rama por defecto. La región por defecto afecta la
  latencia; se anota con cada medición.
- **Nombre `transmivoz-expoandes`.** La documentación de Render dice que, al crear
  un Blueprint, un nombre coincidente con un recurso existente produce copias con
  sufijo, y que añadir un recurso existente a un Blueprint ya creado se hace
  incluyendo su configuración completa. No hay una vía documentada que adopte el
  servicio manual desde un Blueprint nuevo; por eso `docs/RENDER.md` ofrece dos
  caminos y no promete adopción.
- **`autoDeployTrigger: "off"` entre comillas.** Un lector YAML 1.1 convierte `off`
  sin comillas en el booleano `false` y el esquema oficial lo rechaza. Entre comillas
  es válido para cualquier lector.
- **`OLLAMA_MODEL` vacío.** Reusa el camino que ya existe: `lib/ollama.ts` lee
  `process.env.OLLAMA_MODEL ?? ""`, y con cadena vacía `ollamaConfigured()` es falso
  y `GET /api/agent` responde `{"engine":"reglas"}`. Variable ausente da el mismo
  resultado. No hay un interruptor nuevo.
- **Entorno de ejecución.** `NODE_ENV=production` lo pone Render solo en
  ejecución, no en la compilación, así que `pnpm install` instala las dependencias
  de desarrollo que `next build` necesita (Tailwind, TypeScript). En producción,
  sin `APP_PASSWORD` utilizable la app responde 503 (EA-10).

### Validación de la sintaxis

`render.yaml` se validó contra el esquema JSON oficial de Render
(`https://render.com/schema/render.yaml.json`, obtenido el 2026-11-06) con un
validador JSON Schema 2020-12: 0 errores. El 2026-11-10 se volvió a validar con
el esquema descargado ese día, después de añadir `OLLAMA_BASE_URL` y `OLLAMA_TOKEN`
(EA-27): 0 errores, y `plan: gratis` sigue fallando. Se usó el `ajv` 8.20 que ya
está en `node_modules` como dependencia transitiva, sin añadir ninguna dependencia
al proyecto; ignora el formato `uri` del esquema. Controles negativos: `plan: gratis` y un
`autoDeployTrigger` inválido fallan. Esto valida la forma, no que Render acepte el
despliegue: eso solo lo confirma la pantalla de creación del Blueprint o un
despliegue real.

### HSTS

Faltaba la cabecera en la app. Se añade `Strict-Transport-Security:
max-age=15552000` (180 días) sin `includeSubDomains` ni `preload`: afecta solo al
host de la respuesta y no compromete otros subdominios ni la lista del navegador.
El navegador ignora HSTS en respuestas HTTP, así que `localhost` y las pruebas
locales no cambian; la máquina con Windows se sirve por HTTPS (Funnel) y la recibe
igual. No se confía en ninguna cabecera reenviada para decidirla.

Medido con `next start` real (loopback, clave de prueba, no Render): aparece en el
401 de `/`, en el 200 de `/`, en el 401 de `/api/transmilenio` y `/api/agent`, en
`GET` y `POST /api/agent` con clave y en un `.js` de `/_next/static`. No aparece en la
redirección 308 de `/api/agent/` (Next la resuelve antes del manejador de
cabeceras); no hace falta, porque es una redirección relativa al mismo origen. El
estado y las cabeceras de autenticación no cambian.

Para retirarla, hay que servir `max-age=0` por HTTPS: los navegadores que la
recibieron la recuerdan hasta 180 días. En vivo se observó el valor
`max-age=15552000` en Render (ver la fila 12 de la tabla); los archivos no
registran cuántas cabeceras HSTS llegan, así que un posible duplicado no está
descartado.

## Prueba local (histórica; portátil Linux, Node 26.13.0, sin Render)

Son las pruebas de la preparación, anteriores a la validación en vivo. El portátil usa Node 26.13.0; la integración continua y Render usan Node 24. Nada
de esto es una medición de Render.

- `pnpm exec tsc --noEmit`: salida 0.
- `pnpm test`: 371 de 371 correctas (350 existentes + 21 nuevas).
- `pnpm build`: salida 0.
- `pnpm verificar` contra `next start` propio con clave de prueba: 9 de 9
  correctas en Chrome (permisos simulados; no acredita accesibilidad ni sensores).
- `scripts/verificar-ea10-http.mjs`: salida 0 (413 con cuerpo chunked, 401 en todas
  las rutas, redirecciones 308 sin fuga).
- `corepack pnpm start -H 127.0.0.1 -p "$PORT"`: `corepack pnpm --version` da
  12.3.4 y el servidor responde 401 sin clave y 200 con ella.
- `scripts/medir-render.mjs`: en la primera versión, sus cuatro modos se
  ejecutaron contra un servidor HTTPS falso con certificado autofirmado, solo para
  comprobar el cliente. La revisión posterior (matriz de 401 completa, modos
  heredados de `Object`, orden de `despertar`) se prueba solo con las pruebas
  unitarias. Nada de esto dice algo del servicio real. La prueba de que
  `crearPeticion` no sigue redirecciones usa HTTP de loopback dentro de la
  prueba; el script de línea de comandos sigue exigiendo HTTPS.
- La prueba PowerShell del instalador no se corrió: el portátil no tiene `pwsh`.
  El archivo no cambió y la integración continua la ejecuta.

Mutaciones de las guardas nuevas, cada una hace fallar su prueba: `off` sin
comillas, `plan: starter`, `APP_PASSWORD` con valor, `--no-frozen-lockfile`,
`NODE_VERSION` sin versión exacta y `includeSubDomains` en HSTS.
En `scripts/medir-render.mjs`, cada mutación hace fallar su prueba: despacho de
modos con `MODOS[modo]` (acepta `toString`), quitar los casos 401 de la API,
devolver verdadero ante un 429 sin `Retry-After` y `redirect: "follow"`.

## Criterios de #40 frente a la evidencia en vivo

Mediciones del 2026-11-06 sobre `https://transmivoz.onrender.com`, revisión `main`
`e269a8a` salvo donde se indica (ver «Estado actual»; la fuente caída no se
atribuye a `main`). **Medido** significa que hay una observación registrada del
comportamiento que dice la fila; no implica que el criterio completo de #40 quede
aceptado. **Parcial**, que se midió solo una parte, con el límite de la última
columna. Nada de esto es una garantía de cuotas
ni de tiempos futuros. Todas las rutas son relativas a la carpeta
[`verificaciones/render-2026-11-06-e269a8a/`](verificaciones/render-2026-11-06-e269a8a/).

| # | Criterio de #40 | Estado | Qué se midió y límite |
| --- | --- | --- | --- |
| 1 | Cuenta, cuota y costo cero antes de activar | Medido | Hobby, un servicio Free, sin tarjeta, USD 0,00 pendientes. Al cierre: 1,95 de 750 horas y 3 de 500 minutos de pipeline. Transcrito a mano del panel. [`estado-final.json`](verificaciones/render-2026-11-06-e269a8a/estado-final.json), [`observaciones-dashboard.json`](verificaciones/render-2026-11-06-e269a8a/observaciones-dashboard.json) |
| 2 | Build y arranque con Node 24, pnpm 12.3.4 y lockfile congelado | Parcial | Registros reales: instalación congelada, Node 24.22.2, pnpm 12.3.4, Next 16.3.3, puerto 10000, Live. Con la configuración original (`pnpm`). **No validado:** Node 24.22.1 del Blueprint y `corepack pnpm`. [`estado-final.json`](verificaciones/render-2026-11-06-e269a8a/estado-final.json) |
| 3 | Matriz de credenciales y motor «reglas» | Medido | 401 sin clave y con clave errónea en `/`, `/api/agent` GET y POST y `/api/transmilenio`; 200 con la correcta; 413 con 5000 bytes; motor `reglas`. Repetido tras el rollback. Chrome 9 de 9 con dispositivos simulados. [`credenciales.txt`](verificaciones/render-2026-11-06-e269a8a/credenciales.txt), [`credenciales-final.txt`](verificaciones/render-2026-11-06-e269a8a/credenciales-final.txt), [`diagnostico.txt`](verificaciones/render-2026-11-06-e269a8a/diagnostico.txt), [`diagnostico-final.txt`](verificaciones/render-2026-11-06-e269a8a/diagnostico-final.txt) |
| 4 | Salud TCP | Medido | Los despliegues y el rollback pasan a *Live* con `healthCheckPath` vacío. [`configuracion-previa.json`](verificaciones/render-2026-11-06-e269a8a/configuracion-previa.json), [`recuperacion-final.json`](verificaciones/render-2026-11-06-e269a8a/recuperacion-final.json) |
| 5 | Cadena de proxy y resistencia a suplantación | Medido | Dos redes, siete casos por red, en la revisión de sonda `f32c92b`. El cliente real queda tercero desde la derecha en `x-forwarded-for` en los casos aceptados; las entradas inyectadas quedan a la izquierda; `x-real-ip` llega ausente; escribir `cf-connecting-ip` da 403. Es el ingreso de Render de esa fecha. `claveCliente()` no cambió: siguen siendo 20 POST por minuto compartidos. [`proxy-seudonimizado.json`](verificaciones/render-2026-11-06-e269a8a/proxy-seudonimizado.json) |
| 6 | RAM pico y errores frente a 512 MB y 400 MB propuestos | Parcial | Cgroup v2 raíz con límite real de 536.870.912 bytes y pico de 393.547.776 (393,55 MB; 375,32 MiB), bajo 400 MB. RSS máximo del proceso Node: 134.189.056 bytes, cifra aparte. Dos lecturas puntuales en la revisión de sonda; el pico ya estaba en la primera. **No hay** carga sostenida, renovación del catálogo medida ni métricas del panel. [`memoria-inicial.json`](verificaciones/render-2026-11-06-e269a8a/memoria-inicial.json), [`memoria-tras-carga.json`](verificaciones/render-2026-11-06-e269a8a/memoria-tras-carga.json) |
| 7 | p50 y p95 en caliente, separados de la red y de ArcGIS | Medido | Catálogo inicial 2976 ms (incluye ArcGIS). 30 GET: p50 105 ms, p95 121 ms. 30 POST: p50 108 ms, p95 167 ms. Serie aparte con tráfico paralelo de sonda: GET 114/124 ms, POST 160/529 ms, máximo 2058 ms, sin fallos. No es una carga de feria ni un SLA. [`latencia.txt`](verificaciones/render-2026-11-06-e269a8a/latencia.txt), [`carga-con-sonda.txt`](verificaciones/render-2026-11-06-e269a8a/carga-con-sonda.txt) |
| 8 | Primer arranque tras reposo | Parcial | Una muestra: 960,022 s sin tráfico de la validación, 200 en 53.761 ms; Render registra un proceso nuevo a las 19:50:52 UTC. Tráfico de terceros no controlado; **no se repitió**, como pedía el criterio. [`despertar-reposo.txt`](verificaciones/render-2026-11-06-e269a8a/despertar-reposo.txt), [`reposo-corroborado.json`](verificaciones/render-2026-11-06-e269a8a/reposo-corroborado.json) |
| 9 | 429 y que un reinicio reinicie el contador | Parcial | 429 en la petición 21 con `Retry-After`, antes y después del rollback. **No se probó** que un reinicio reinicie el contador: las ventanas vencieron entre reemplazos de instancia y el botón *Restart* no se ejercitó. [`limite.txt`](verificaciones/render-2026-11-06-e269a8a/limite.txt), [`limite-despues-rollback.txt`](verificaciones/render-2026-11-06-e269a8a/limite-despues-rollback.txt) |
| 10 | Fuente caída y copia fechada | Parcial | Despliegue temporal de diagnóstico, SHA exacto no registrado, comando de inicio alterado (no se afirma `main`). Rechazo de conexión simulado en Render (proxy HTTPS local cerrado solo en el inicio de Next): `snapshot` del 2026-09-24T15:16:41.502Z con 153 estaciones y 124 rutas, aviso veraz del asistente y Chrome 9 de 9. **No cubre** una caída natural de ArcGIS, timeouts ni errores 5xx. [`fuente-caida-controlada.json`](verificaciones/render-2026-11-06-e269a8a/fuente-caida-controlada.json), [`diagnostico-fuente-caida.txt`](verificaciones/render-2026-11-06-e269a8a/diagnostico-fuente-caida.txt) |
| 11 | Reinicio conserva la copia | Parcial | En el despliegue temporal de diagnóstico (SHA no registrado), el reemplazo de instancia conservó la copia versionada y, tras el rollback, el catálogo volvió a `live` (153 estaciones, 124 rutas). **No se probó** el botón *Restart* ni la suspensión por separado. [`fuente-caida-controlada.json`](verificaciones/render-2026-11-06-e269a8a/fuente-caida-controlada.json), [`recuperacion-final.json`](verificaciones/render-2026-11-06-e269a8a/recuperacion-final.json) |
| 12 | HSTS en Render | Medido | `strict-transport-security: max-age=15552000` observado en `/`, en la API, en un JS estático y tras el rollback; redirecciones 308 al mismo origen sin cookies. Los archivos guardan el valor, no el número de cabeceras. [`cabeceras-y-sonda.json`](verificaciones/render-2026-11-06-e269a8a/cabeceras-y-sonda.json), [`redirecciones-y-estaticos.json`](verificaciones/render-2026-11-06-e269a8a/redirecciones-y-estaticos.json), [`recuperacion-final.json`](verificaciones/render-2026-11-06-e269a8a/recuperacion-final.json) |
| 13 | Reversión | Parcial | *Rollback* real al artefacto original (50,7 s): comando, política y variables originales restaurados, sonda 404, datos en vivo. **No se probó** suspender el servicio, y el origen de Tailscale no se confirmó (el puerto 3000 de Windows no respondía). [`estado-final.json`](verificaciones/render-2026-11-06-e269a8a/estado-final.json), [`recuperacion-final.json`](verificaciones/render-2026-11-06-e269a8a/recuperacion-final.json) |

Falta, además, todo lo que ningún servidor puede acreditar: validación con iPhone,
BLE, audio y VoiceOver reales, y operación física con el backend dormido. Eso
corresponde a las tareas de iPhone y firmware.

La fila 10 y parte de la 11 también se cubren localmente, con simulaciones, en
`lib/transmilenio-data.test.ts`: catálogo en vivo, caída con copia fechada,
conservación del último dato bueno y reintento. Eso no es una medición de Render;
la medición de Render son las filas de arriba.

### Límites que conviene tener presentes

- **Cuota compartida.** `claveCliente()` no cambió y devuelve una sola clave, así
  que los POST por minuto de `/api/agent` son para todas las personas a la vez.
  Eran 20 en la medición de arriba; desde EA-28 (#75) son 45 (cálculo en
  [`ea-10-recursos-autenticacion.md`](ea-10-recursos-autenticacion.md)).
  Con un público de feria es un tope de capacidad, no un límite por persona. La
  fila 5 ya midió la cadena de proxy de Render, pero usar esa medición para una
  identidad por cliente es otro cambio, con revisión y validación de la cabecera
  y del entorno. El contador es de una instancia; que se reinicie con *Restart*
  no está probado (fila 9).
- **Voz y Bluetooth.** El reconocimiento de voz de Chrome y la síntesis dependen
  del navegador, no de este servidor. Este repositorio no tiene BLE; no se añadió
  ninguno. La comprobación con accesorio y teléfono reales con el servidor
  dormido corresponde a las tareas de iPhone y firmware.
- **Sin SLA.** Render documenta que Free no es para producción, que reinicia y que
  puede suspender por tráfico saliente inusual (sin cifra pública).
- **Despliegue.** El servicio real tiene auto-deploy `After CI Checks Pass`; el
  Blueprint (`render.yaml`) pide despliegue manual. Son políticas distintas y esta
  validación no cambió ninguna.
