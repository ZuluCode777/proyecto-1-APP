# Validación en vivo de Render: EA-14

Fecha: 6 de noviembre de 2026. Servicio: https://transmivoz.onrender.com
(Render Free, región Virginia). Revisión medida: `main` en
`e269a8a6656b488ffe032c999e1d5160a5876c7c`. Es la revisión que estaba
desplegada ese día, no el `main` actual del repositorio.

Esta es una medición puntual de un día, con una sola corrida de cada prueba salvo
donde se indica lo contrario. Casi todas las comprobaciones del backend dieron el
resultado esperado, pero varias son parciales y se marcan como tales en la tabla.
Al terminar, Render quedó de nuevo en `main` en `e269a8a`, con catálogo en vivo y
sin sonda accesible. La última verificación en Chrome dio 9 de 9.

Este informe registra la configuración real del servicio manual existente. No se
importó el Blueprint ni se creó otro servicio. No se modificó Windows, no se
fusionaron las ramas de sonda y no se borraron archivos del proyecto.

Todas las evidencias están en esta misma carpeta. Los enlaces de abajo abren cada
archivo sin salir de GitHub.

## Revisiones que intervinieron

- **`main` en `e269a8a`, sin cambios:** acceso, tamaño de cuerpo, latencia en
  caliente, HSTS, redirecciones, 429, reposo y diagnóstico de Chrome.
- **Revisión de sonda temporal `f32c92b`:** matriz de proxy, lecturas de memoria
  y la serie de carga con tráfico paralelo. Salió de una rama temporal de
  diagnóstico (`ea-14-sonda-ram`) que no se fusionó; su código no está en este
  repositorio. Por eso las cifras de memoria y de proxy describen esa revisión,
  no `main` sin cambios.
- **`main` con el comando de inicio alterado:** el ensayo de fuente caída (ver
  más abajo). El código y la compilación fueron los de `main`.
- **Rollback final:** vuelta al artefacto original de `main`, que es el estado
  restaurado.

## Estado restaurado

- Servicio Node Free en Virginia, workspace Hobby, sin tarjeta registrada y con
  USD 0,00 de cargos pendientes.
- Rama `main`; inicio `pnpm run start`; build
  `pnpm install --frozen-lockfile && pnpm run build`; directorio raíz y health
  check HTTP vacíos. La comprobación de salud es TCP.
- Auto-deploy `After CI Checks Pass`, igual que antes.
- Solo las variables originales `APP_PASSWORD` y `NODE_VERSION`. Se retiró
  `SONDA_CABECERAS`. El proxy de fallo existió solo en el comando de inicio y ese
  comando se restauró.
- Rollback real al artefacto original (`dep-dbn3epifngtc73avllkg`), completado en
  50,7 s.
- Se conserva el mismo origen. No se escribieron, borraron ni migraron favoritas
  o preferencias.

Detalle: [`estado-final.json`](estado-final.json),
[`configuracion-previa.json`](configuracion-previa.json) y
[`observaciones-dashboard.json`](observaciones-dashboard.json). Las cifras del
panel de Render están transcritas a mano en esos archivos; no son una
exportación del panel.

El servicio manual tiene `NODE_VERSION=24`, que Render resolvió a Node 24.22.2, y
pnpm 12.3.4. El Blueprint versionado (`render.yaml`) fija Node 24.22.1, comandos
con `corepack pnpm` y despliegue manual. Esas diferencias quedan registradas; no
se cambió la configuración original para hacerla coincidir con el archivo. El
Blueprint no se importó, y **los comandos con `corepack pnpm` no se validaron en
Render**: el servicio compiló y arrancó con `pnpm`.

## Comprobaciones

Resultado: **Medido** es una prueba con evidencia en esta carpeta; **Parcial**
cubre solo una parte del criterio, con el límite indicado.

| Criterio | Resultado | Evidencia y límite |
| --- | --- | --- |
| Cuenta y costo | Medido | Hobby, un servicio Free, sin tarjeta, USD 0,00 pendientes. Uso al cierre: 1,95 de 750 horas y 3 de 500 minutos de pipeline. Observación de esta fecha, no garantía de cuotas futuras. [`estado-final.json`](estado-final.json), [`observaciones-dashboard.json`](observaciones-dashboard.json). |
| Build y arranque | Parcial | Registros reales: instalación congelada, pnpm 12.3.4, Node 24.22.2 y Next 16.3.3; el servidor escucha en el puerto 10000 y Render lo marca Live. Se usó la configuración original (`pnpm`), no la del Blueprint: Node 24.22.1 y `corepack pnpm` no se probaron. [`estado-final.json`](estado-final.json), [`observaciones-dashboard.json`](observaciones-dashboard.json). |
| Acceso y tamaño | Medido | 401 sin clave o con clave incorrecta en `/`, GET y POST de `/api/agent`, y `/api/transmilenio`; 200 con la clave correcta; cuerpo de 5000 bytes devuelve 413; motor `reglas`. Antes de la sonda: [`credenciales.txt`](credenciales.txt). Después del rollback: [`credenciales-final.txt`](credenciales-final.txt). |
| Salud | Medido | Los despliegues y el rollback pasan a Live con health check HTTP vacío (TCP). La API responde después de reemplazar la instancia. [`configuracion-previa.json`](configuracion-previa.json), [`recuperacion-final.json`](recuperacion-final.json). |
| Cadena de proxy | Medido | Dos redes distintas y siete casos por red, en la revisión de sonda `f32c92b`. Interpretación en la sección «Proxy e identidad». [`proxy-seudonimizado.json`](proxy-seudonimizado.json). |
| Memoria | Parcial | Cgroup v2 raíz con límite real de 536.870.912 bytes. Pico de 393.547.776 bytes, por debajo del objetivo propuesto de 400.000.000. Son dos lecturas puntuales en la revisión de sonda, no una serie sostenida ni una carga de feria. [`memoria-inicial.json`](memoria-inicial.json), [`memoria-tras-carga.json`](memoria-tras-carga.json). |
| Latencia caliente | Medido | 30 GET y 30 POST sin respuestas fallidas, sobre `main`. Una segunda serie con tráfico paralelo se hizo con la sonda. Valores y condiciones en «Latencia y memoria». [`latencia.txt`](latencia.txt), [`carga-con-sonda.txt`](carga-con-sonda.txt). |
| Reposo | Parcial | Una sola medición: tras 960,022 s sin solicitudes de esta validación, la primera respuesta tarda 53.761 ms y devuelve 200. Render confirma un proceso nuevo a las 19:50:52 UTC, listo a las 19:51:16. No se repitió y el tráfico de terceros no se controló. [`despertar-reposo.txt`](despertar-reposo.txt), [`reposo-corroborado.json`](reposo-corroborado.json). |
| Límite y recuperación | Parcial | Petición 21: 429, con `Retry-After` de 58 s al inicio y 56 s después del rollback. Tras dejar vencer la ventana, vuelven a pasar autenticación, 413 y diagnóstico. No se verificó el reinicio inmediato del contador porque las ventanas vencieron durante los reemplazos de instancia, y el botón Restart no se ejercitó. [`limite.txt`](limite.txt), [`limite-despues-rollback.txt`](limite-despues-rollback.txt), [`credenciales-final.txt`](credenciales-final.txt), [`diagnostico-final.txt`](diagnostico-final.txt). |
| Fuente caída | Parcial | Rechazo de conexión simulado dentro de Render: el catálogo devuelve `snapshot` fechado el 24/9/2026 y el asistente avisa que usa una copia sin conexión. El navegador pasa 9 de 9 en ese estado. No es una caída natural de ArcGIS ni cubre timeouts o errores 5xx. [`fuente-caida-controlada.json`](fuente-caida-controlada.json), [`diagnostico-fuente-caida.txt`](diagnostico-fuente-caida.txt). |
| Reinicio y catálogo | Parcial | El reemplazo de instancia inicia sin caché y conserva la copia versionada. Después del rollback se obtiene catálogo `live`: 153 estaciones y 124 rutas, consultado a las 20:26:47 UTC. Es reemplazo de instancia por despliegue; el botón Restart y la suspensión no se probaron por separado. [`fuente-caida-controlada.json`](fuente-caida-controlada.json), [`recuperacion-final.json`](recuperacion-final.json). |
| HSTS y redirecciones | Medido | HSTS `max-age=15552000` observado en Render y desde Windows. Las redirecciones 308 permanecen en el mismo origen y no añaden cookies. Un JS estático pide clave. Los archivos registran el valor, no cuántas cabeceras HSTS llegaron. [`cabeceras-y-sonda.json`](cabeceras-y-sonda.json), [`redirecciones-y-estaticos.json`](redirecciones-y-estaticos.json), [`recuperacion-final.json`](recuperacion-final.json). |
| Reversión | Parcial | Rollback real a `e269a8a`; comando y política originales restaurados, variables temporales retiradas, sonda autenticada 404 y datos en vivo recuperados. No se probó suspender el servicio ni se confirmó el origen de Tailscale (Windows no respondía). [`estado-final.json`](estado-final.json), [`recuperacion-final.json`](recuperacion-final.json). |

## Latencia y memoria

En `main`, la consulta inicial del catálogo tarda 2976 ms e incluye ArcGIS. Con
el catálogo cargado, 30 GET tienen p50 105 ms y p95 121 ms. Los 30 POST tienen
p50 108 ms y p95 167 ms. Ver [`latencia.txt`](latencia.txt).

La serie con la sonda tuvo consultas de proxy en paralelo desde dos máquinas. Los
30 GET tienen p50 114 ms y p95 124 ms. Los 30 POST tienen p50 160 ms y p95 529 ms;
el máximo es 2058 ms. No hubo fallos HTTP. No se fijó una concurrencia de feria ni
se promete ese tiempo como SLA. Ver [`carga-con-sonda.txt`](carga-con-sonda.txt).

El pico de cgroup es 393,55 MB decimales, o 375,32 MiB, frente a un límite de
512 MiB. Incluye procesos y caché de páginas, no solo el heap de Node. El máximo
RSS observado del proceso Node fue 134.189.056 bytes, una cifra distinta.

Solo hay dos lecturas: la primera, con la instancia de la sonda recién arrancada
(121 s de actividad), ya mostraba el pico de 393.547.776 bytes; la segunda, después
de la serie de carga, mostró el mismo pico. Por tanto el pico ocurrió antes de la
serie de carga y esa carga no lo superó. No hay lectura durante la renovación del
catálogo ni con carga sostenida. No se usó telemetría de pago ni las métricas
del panel. Ver [`memoria-inicial.json`](memoria-inicial.json) y
[`memoria-tras-carga.json`](memoria-tras-carga.json).

El arranque tras reposo se midió una vez. El tráfico de terceros no se controló; el
nuevo arranque del registro de Render corrobora que esa petición despertó una
instancia. Ver [`despertar-reposo.txt`](despertar-reposo.txt) y
[`reposo-corroborado.json`](reposo-corroborado.json). Con una sola muestra no hay
distribución de arranques en frío.

## Proxy e identidad

Se usó `/cdn-cgi/trace` del mismo origen como referencia de cada cliente. Las
referencias de laptop y Windows eran distintas. No se guardaron sus IP. Ver
[`proxy-seudonimizado.json`](proxy-seudonimizado.json).

- Sin inyección, X-Forwarded-For contiene cliente y dos valores de
  infraestructura.
- Al añadir una o dos IP falsas, esas entradas quedan a la izquierda. El cliente
  real sigue tercero desde la derecha en los casos aceptados.
- X-Real-IP llega ausente incluso cuando el cliente lo escribe.
- CF-Connecting-IP y True-Client-IP coinciden con la referencia del cliente en los
  casos aceptados. Una petición que intenta escribir CF-Connecting-IP devuelve 403
  antes de obtener la sonda, en ambas redes.

Son observaciones de este ingreso de Render y de esta fecha. No prueban que otra
topología o un acceso alternativo tenga la misma cadena. `claveCliente()` no
cambió: todas las personas siguen compartiendo 20 POST por minuto. Aplicar una
identidad por cliente requiere otro cambio revisado, con validación de la cabecera
y del entorno.

## Fallo controlado y recuperación

La prueba usó un proxy HTTPS local cerrado solo en el comando de inicio de Next.
Render registró `ECONNREFUSED 127.0.0.1:9`; después el backend entregó
`source=snapshot`, fecha `2026-09-24T15:16:41.502Z`, 153 estaciones y 124 rutas.
La respuesta de 8 G avisó que usaba una copia guardada. Esto prueba el respaldo
ante rechazo de conexión, no ante toda clase de timeout, 5xx o caída natural. Ver
[`fuente-caida-controlada.json`](fuente-caida-controlada.json) y
[`diagnostico-fuente-caida.txt`](diagnostico-fuente-caida.txt).

El primer intento aplicó el bloqueo también al lanzador pnpm. Falló antes de
arrancar Next porque pnpm intentó descargar su versión desde registry.npmjs.org
(`ERR_PNPM_META_FETCH_FAIL`). Render conservó la instancia anterior. Se corrigió el
alcance del ensayo invocando el binario Next instalado directamente; el build
mantuvo su red normal. No se probó el arranque del comando original con el registro
npm caído. Ver [`observaciones-dashboard.json`](observaciones-dashboard.json).

El rollback usó el artefacto original, recuperó el catálogo en vivo y quitó la
ruta de sonda. El reinicio se comprobó mediante reemplazo real de instancia; no se
ejecutó por separado el botón Restart ni se suspendió el servicio. Ver
[`recuperacion-final.json`](recuperacion-final.json).

## Límites y Windows

- Chrome usó cámara, micrófono y ubicación simulados. Sus 9 de 9 no acreditan
  VoiceOver, iPhone, auriculares, reconocimiento de voz real, BLE ni operación
  física con el backend dormido.
- Windows sigue en `dfbd388`. Las tareas TransMiVoz App y TransMiVoz Ollama
  muestran `Ready`; la app local en el puerto 3000 no responde. No se reiniciaron
  ni modificaron. Ese equipo no queda acreditado como respaldo operativo.
- Las ramas `ea-14-sonda-ram` y `ea-14-sonda-cabeceras` permanecen sin fusionar.
  Sus archivos solo sirvieron al ensayo temporal y no se incluyen aquí.
- No se registraron claves, valores Authorization, IP crudas ni rutas de cgroup con
  identificadores. Las coordenadas del diagnóstico son la ubicación simulada de
  Ricaurte.
- Este informe no cierra #36 ni #40. Documenta lo medido en el backend y los
  límites que debe conservar el equipo; los criterios parciales o sin verificar
  siguen abiertos.

## Archivos de evidencia

- [`estado-final.json`](estado-final.json) y [`configuracion-previa.json`](configuracion-previa.json): configuración restaurada y previa, y observación de Windows.
- [`observaciones-dashboard.json`](observaciones-dashboard.json): cuenta, despliegue inicial, corroboración de reposo e intento fallido de pnpm.
- [`credenciales.txt`](credenciales.txt) y [`despertar.txt`](despertar.txt): primera pasada de acceso y primera petición (475 ms, instancia despierta).
- [`diagnostico.txt`](diagnostico.txt): Chrome 9 de 9 antes de la sonda.
- [`latencia.txt`](latencia.txt) y [`carga-con-sonda.txt`](carga-con-sonda.txt): series de GET y POST.
- [`cabeceras-y-sonda.json`](cabeceras-y-sonda.json) y [`redirecciones-y-estaticos.json`](redirecciones-y-estaticos.json): HSTS, redirecciones y estáticos.
- [`proxy-seudonimizado.json`](proxy-seudonimizado.json): matriz de dos redes sin IP crudas.
- [`memoria-inicial.json`](memoria-inicial.json) y [`memoria-tras-carga.json`](memoria-tras-carga.json): proceso y cgroup.
- [`limite.txt`](limite.txt) y [`limite-despues-rollback.txt`](limite-despues-rollback.txt): 429.
- [`despertar-reposo.txt`](despertar-reposo.txt) y [`reposo-corroborado.json`](reposo-corroborado.json): arranque tras reposo.
- [`fuente-caida-controlada.json`](fuente-caida-controlada.json) y [`diagnostico-fuente-caida.txt`](diagnostico-fuente-caida.txt): fuente caída simulada.
- [`recuperacion-final.json`](recuperacion-final.json), [`credenciales-final.txt`](credenciales-final.txt) y [`diagnostico-final.txt`](diagnostico-final.txt): cierre después del rollback.
