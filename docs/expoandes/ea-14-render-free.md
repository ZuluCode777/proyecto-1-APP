# EA-14 (#40): Render Free preparado, mediciones en vivo pendientes

Rama `ea-14-render-free`, desde `origin/main` 66cdd87 (con EA-06, EA-08 y EA-10
fusionados). El issue #36 sigue abierto solo por la evidencia del proxy real, que
este trabajo también necesita. No se desplegó, no se cambió ningún servicio de
Render, no se accedió a Windows, a la API de Render ni a ninguna clave. No se
añadieron dependencias ni se tocaron el lockfile, los workflows, el instalador ni
la prueba PowerShell.

Hay configuración reproducible, una guía para el titular de la cuenta
([`docs/RENDER.md`](../RENDER.md)) y una herramienta de medición. **Ningún
criterio de rendimiento está cerrado:** todo lo que dependa de Render real
figura como pendiente y ninguna prueba local se presenta como medición de Render.

## Qué se entrega

| Archivo | Para qué |
| --- | --- |
| `render.yaml` | Un web Node `free`, despliegue manual, Node 24.22.1, `pnpm install --frozen-lockfile`, `next build`, `next start -H 0.0.0.0 -p "$PORT"`, `OLLAMA_MODEL` vacío, `APP_PASSWORD` con `sync: false`. Sin disco, base de datos, worker, cron, Docker ni ruta de salud HTTP (comprobación TCP por omisión). |
| `docs/RENDER.md` | Cómo activar, adoptar o crear el servicio sin duplicarlo, desplegar, comprobar y revertir. |
| `scripts/medir-render.mjs` | Mediciones en vivo por HTTPS: credenciales, latencia, arranque en frío, 429. La clave solo sale del entorno. |
| `next.config.mjs` | `Strict-Transport-Security: max-age=15552000` en todas las rutas. |
| `lib/ea14-render.test.ts`, `lib/ea14-medir-render.test.ts` | Guardas de `render.yaml` y HSTS; lógica del script de medición con respuestas simuladas. |

### Decisiones y su fuente

Consultadas el 2026-11-06 en la documentación oficial de Render (`render.com/docs`).

- **Node.** `NODE_VERSION` tiene la máxima precedencia y los servicios creados
  antes del 2026-10-21 tienen otro valor por defecto, así que se fija la versión
  exacta `24.22.1` (el valor por defecto actual de Render) y el mismo major que la
  integración continua (24). No se añadió `.node-version` ni `engines`: el repo no
  tenía fijación y la variable basta.
- **pnpm.** `corepack pnpm` toma la versión de `packageManager` (12.3.4). Con
  Node 24, Corepack viene incluido. Se comprobó localmente (ver más abajo); en Render
  queda pendiente de confirmar en el primer registro de compilación.
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
validador JSON Schema 2020-12: 0 errores. Controles negativos: `plan: gratis` y un
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
recibieron la recuerdan hasta 180 días. Pendiente en vivo: ver si Render ya añade
su propia cabecera (duplicado o valor distinto).

## Prueba local (portátil Linux, Node 26.13.0, sin Render)

El portátil usa Node 26.13.0; la integración continua y Render usan Node 24. Nada
de esto es una medición de Render.

- `pnpm exec tsc --noEmit`: salida 0.
- `pnpm test`: 366 de 366 correctas (350 existentes + 16 nuevas).
- `pnpm build`: salida 0.
- `pnpm verificar` contra `next start` propio con clave de prueba: 9 de 9
  correctas en Chrome (permisos simulados; no acredita accesibilidad ni sensores).
- `scripts/verificar-ea10-http.mjs`: salida 0 (413 con cuerpo chunked, 401 en todas
  las rutas, redirecciones 308 sin fuga).
- `corepack pnpm start -H 127.0.0.1 -p "$PORT"`: `corepack pnpm --version` da
  12.3.4 y el servidor responde 401 sin clave y 200 con ella.
- `scripts/medir-render.mjs`: sus cuatro modos se ejecutaron contra un servidor
  HTTPS falso con certificado autofirmado, solo para comprobar el cliente (HTTPS
  obligatorio, sin seguir redirecciones, sin clave en la salida). No dicen nada
  del servicio real.
- La prueba PowerShell del instalador no se corrió: el portátil no tiene `pwsh`.
  El archivo no cambió y la integración continua la ejecuta.

Mutaciones de las guardas nuevas, cada una hace fallar su prueba: `off` sin
comillas, `plan: starter`, `APP_PASSWORD` con valor, `--no-frozen-lockfile`,
`NODE_VERSION` sin versión exacta y `includeSubDomains` en HSTS.

## Pendiente en vivo (titular de la cuenta)

Cada fila se cierra solo con una medición en el servicio real, anotando fecha,
commit, región y versiones efectivas de Node y pnpm. No guardes en el registro la
clave, la cabecera `Authorization` ni direcciones IP de personas.

| # | Criterio de #40 | Cómo medirlo | Estado |
| --- | --- | --- | --- |
| 1 | Cuenta, cuota y costo cero antes de activar | *Billing* y *Included usage*: plan Hobby, ningún recurso de pago, medio de pago o no | Pendiente |
| 2 | Build y arranque con Node 24, pnpm 12.3.4 y lockfile congelado | Registro de compilación; `corepack pnpm` funciona; escucha en `$PORT` | Pendiente |
| 3 | Matriz de credenciales y motor «reglas» | `node scripts/medir-render.mjs credenciales` y `pnpm verificar "$RENDER_URL"` | Pendiente |
| 4 | Salud TCP | El despliegue pasa a *Live* sin `healthCheckPath` y sigue sano | Pendiente |
| 5 | Cadena de proxy y resistencia a suplantación | Requiere ver las cabeceras que llegan al servidor, lo que esta rama no incluye: hace falta una sonda temporal aparte (no se fusiona). Medir saltos de confianza, si un cliente puede inyectar saltos en `x-forwarded-for` y quién escribe `x-real-ip` (matriz de EA-10) | Pendiente |
| 6 | RAM pico y errores frente a 512 MB y 400 MB propuestos | *Metrics > Memory* durante arranque, 30 peticiones en caliente, renovación del catálogo y la prueba 429. Un build exitoso no demuestra que quepa | Pendiente |
| 7 | p50 y p95 en caliente, separados de la red y de ArcGIS | `node scripts/medir-render.mjs latencia 30`: informa el catálogo aparte, `GET /api/agent` (red y Render, sin datos) y `POST /api/agent` (reglas, catálogo en caché) | Pendiente |
| 8 | Primer arranque tras reposo | Tras más de 15 min sin tráfico, `node scripts/medir-render.mjs despertar`; repetir varias veces. Sin pings | Pendiente |
| 9 | 429 y que un reinicio reinicie el contador | `node scripts/medir-render.mjs limite` en ensayo aparte; luego *Restart* y repetir un POST | Pendiente |
| 10 | Fuente caída y copia fechada | Solo con una caída real de ArcGIS: `source: "snapshot"` y fecha visible en `/api/transmilenio`. La dirección de ArcGIS está fija en el código, así que no se puede provocar desde Render sin cambiarlo | Pendiente |
| 11 | Reinicio conserva la copia | Tras *Restart*, `/api/transmilenio` responde con catálogo (en vivo o copia fechada) | Pendiente |
| 12 | HSTS en Render | `curl -sI "$RENDER_URL/"` (sin credenciales) y buscar `strict-transport-security`: una sola, con el valor esperado | Pendiente |
| 13 | Reversión | Suspender, y *Rollback* si hay un despliegue anterior; confirmar que el origen de Tailscale no cambió | Pendiente |

La fila 10 y parte de la 11 se cubren localmente, con simulaciones, en
`lib/transmilenio-data.test.ts`: catálogo en vivo, caída con copia fechada,
conservación del último dato bueno y reintento. Eso no es una medición de Render.

### Límites que conviene tener presentes

- **Cuota compartida.** `claveCliente()` devuelve una sola clave mientras no se
  mida el proxy (fila 5), así que los 20 POST por minuto de `/api/agent` son para
  todas las personas a la vez. Con un público de feria es un tope de capacidad,
  no un límite por persona. No se inventa una política de proxy confiable antes de
  tener esa medición. El contador es de una instancia y se pierde al reiniciar.
- **Voz y Bluetooth.** El reconocimiento de voz de Chrome y la síntesis dependen
  del navegador, no de este servidor. Este repositorio no tiene BLE; no se añadió
  ninguno. La comprobación con accesorio y teléfono reales con el servidor
  dormido corresponde a las tareas de iPhone y firmware.
- **Sin SLA.** Render documenta que Free no es para producción, que reinicia y que
  puede suspender por tráfico saliente inusual (sin cifra pública).
- **Un deploy a la vez.** Los despliegues son manuales. Un cambio en `main` no
  actualiza Render hasta que el titular lo pida.
