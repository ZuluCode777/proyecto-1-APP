# Cómo publicar TransMiVoz en Render Free

Guía para el titular de la cuenta de Render. Publica el backend existente
(Next.js, reglas del asistente por defecto) como demostración HTTPS que no
depende de la máquina con Windows. El modelo de Ollama es opcional: ver
[Activar el modelo](#activar-el-modelo-opcional). La configuración está en
[`render.yaml`](../render.yaml); el estado de las mediciones está en
[`docs/expoandes/ea-14-render-free.md`](expoandes/ea-14-render-free.md) y el
informe del 6 de noviembre de 2026, con sus ajustes reales, en
[`verificaciones/render-2026-11-06-e269a8a/informe.md`](expoandes/verificaciones/render-2026-11-06-e269a8a/informe.md).

Esta guía no despliega nada por sí sola. Ninguno de sus pasos toca la máquina
con Windows ni el origen actual (`desktop-oa6r547.taila37867.ts.net`). Despliega
una revisión que ya incluya esta preparación (por ejemplo HSTS en
`next.config.mjs`) en la rama que el servicio tenga configurada.

## Antes de activar

1. En el panel, abre *Billing* y confirma que el espacio de trabajo es Hobby y
   que todo recurso existente es `free`. Sin medio de pago, agotar las horas
   gratuitas (750 al mes, compartidas) o la salida de datos suspende los
   servicios gratuitos. Con una tarjeta asociada, Render factura el exceso de
   salida de datos y de minutos de compilación: cómputo gratuito no garantiza
   factura cero.
2. Acepta tres límites de Free: duerme tras 15 minutos sin tráfico, despertar
   tarda cerca de un minuto (sin garantía) y el disco es efímero. TransMiVoz no
   escribe archivos. No añadas pings ni cron para evitar el reposo.
3. Elige una clave nueva y fuerte para `APP_PASSWORD`. No reutilices la de
   Windows. Solo existe en el panel de Render; nunca en el repositorio, en un
   chat ni en un comando.

## Elige un camino

Render no adopta un servicio creado a mano cuando creas un Blueprint nuevo. Si
el nombre coincide con un servicio existente, avisa y crea una copia con sufijo
en el nombre. Por eso hay dos caminos y conviene decidir uno antes de tocar nada.

**Camino A. Conservar el servicio manual** (`transmivoz.onrender.com`). Es el
que ya tiene la dirección conocida. No crees un Blueprint: usa `render.yaml`
como lista de comprobación y alinea los ajustes del servicio a mano.

La tabla siguiente es la **configuración recomendada**, alineada con `render.yaml`.
**No es lo que el servicio manual tenía** el 6 de noviembre de 2026, cuando se
inspeccionó y se validó sin cambiar esos ajustes (ver el
[informe](expoandes/verificaciones/render-2026-11-06-e269a8a/informe.md)). Los
ajustes reales ese día eran: Branch `main`, Root Directory vacío, Build Command
`pnpm install --frozen-lockfile && pnpm run build`, Start Command
`pnpm run start`, Auto-Deploy `After CI Checks Pass`, Health Check Path vacío,
`NODE_VERSION=24` (Render lo resolvió a 24.22.2) y solo `APP_PASSWORD` y
`NODE_VERSION` como variables. La recomendada de abajo no se ha aplicado a ese
servicio, y `corepack pnpm` no se ha validado en Render. Antes de cambiar algo,
anota los valores que haya en ese momento: pueden haber cambiado desde esa fecha.

| Ajuste en el panel | Valor recomendado |
| --- | --- |
| Language | Node |
| Instance type | Free |
| Branch | `main` |
| Root Directory | vacío |
| Build Command | `corepack pnpm install --frozen-lockfile && corepack pnpm build` |
| Start Command | `corepack pnpm start -H 0.0.0.0 -p "$PORT"` |
| Auto-Deploy | desactivado |
| Health Check Path | vacío (comprobación TCP) |
| `NODE_VERSION` | `24.22.1` |
| `OLLAMA_MODEL` | vacío; si el panel no admite un valor vacío, elimina la variable (es equivalente) |
| `APP_PASSWORD` | la clave nueva |

Quita también `OLLAMA_BASE_URL` y `OLLAMA_TOKEN` si existen, salvo que vayas a
activar el modelo (ver más abajo). Después del cambio, guarda y haz
*Manual Deploy > Deploy latest commit*.

**Camino B. Servicio nuevo con el Blueprint.** El nombre `transmivoz-expoandes`
de `render.yaml` es distinto del servicio manual a propósito, así no hay
colisión. Su origen será otro (`transmivoz-expoandes.onrender.com`), con otro
`localStorage`.

1. *New > Blueprint*, conecta este repositorio y elige una rama que ya
   contenga `render.yaml`.
2. Lee la lista de cambios. Debe mostrar un solo servicio web `free` y ningún
   aviso de coincidencia con recursos existentes. Si aparece uno, cancela.
3. Escribe `APP_PASSWORD` cuando Render la pida. Solo la pide en la creación;
   al actualizar un Blueprint la ignora, y se cambia a mano en el panel.
4. *Deploy Blueprint*. Con `autoDeployTrigger: "off"` no se despliega nada más
   hasta que lo pidas.

No añadas el mismo servicio a más de un Blueprint. Borrar la definición del
archivo no borra el servicio: se borra a mano en el panel.

## Desplegar y comprobar

1. *Manual Deploy > Deploy latest commit*. Si el servicio se creó con el
   Blueprint, el primer despliegue ya arranca solo.
2. Anota el commit, la región y las versiones de Node y pnpm que muestra el
   registro de compilación. Si `corepack pnpm` falla, no cambies la versión de
   pnpm del repositorio: reporta el error.
3. Con la clave en el entorno (no como argumento), corre las comprobaciones
   desde el portátil. Solo viaja la clave, por HTTPS, a ese origen. Empieza por
   `despertar`: tiene plazo de 120 s y espera el arranque. Los demás modos
   tienen plazo de 20 s por petición y un servicio dormido (cerca de un minuto)
   los haría fallar por el reposo, no por la app. No sigas hasta que dé 200.

   ```bash
   export RENDER_URL=https://transmivoz.onrender.com
   read -rs APP_PASSWORD && export APP_PASSWORD
   node scripts/medir-render.mjs despertar
   node scripts/medir-render.mjs credenciales
   pnpm verificar "$RENDER_URL"
   ```

   `credenciales` comprueba 401 sin clave y con clave errónea en `/`, en GET y
   POST de `/api/agent` y en `/api/transmilenio`; 200 con la correcta en `/` y
   en GET `/api/agent`; 413 con cuerpo grande y motor «reglas». El 200 del
   catálogo con clave lo comprueba `latencia`. `pnpm verificar` abre Chrome
   contra el servicio y responde la petición de clave con `APP_PASSWORD`.
4. Registra los resultados siguiendo la tabla del informe de EA-14. Los modos
   `latencia`, `despertar` y `limite` están descritos en la cabecera de
   `scripts/medir-render.mjs`. El tiempo de `despertar` solo cuenta como
   arranque en frío si el servicio llevaba más de 15 minutos sin tráfico; si
   estaba despierto es una medición en caliente y no se anota como frío. `limite` gasta el cupo compartido de 20
   peticiones por minuto: hazlo aparte y sin público.

## Activar el modelo (opcional)

Por defecto el asistente usa solo las reglas (`OLLAMA_MODEL` vacío). Para que
Render use `qwen2.5:3b` del equipo con Windows (EA-27, #53), el equipo publica
un proxy con token por un túnel saliente; ver
[`docs/expoandes/ollama-tunel-feria.md`](expoandes/ollama-tunel-feria.md). En el
panel de Render, en *Environment* del servicio:

| Variable | Valor |
| --- | --- |
| `OLLAMA_MODEL` | `qwen2.5:3b` |
| `OLLAMA_BASE_URL` | `https://<máquina>.<tailnet>.ts.net:8443`: con el puerto si no es el 443, sin barra final ni ruta |
| `OLLAMA_TOKEN` | el token del proxy, como secreto |

Guarda y despliega (*Manual Deploy > Deploy latest commit*, o reinicia el
servicio). Render puede mostrar los valores de las variables a quien tenga
acceso al servicio (no verificado): da ese acceso solo al equipo.

Reglas del código (`lib/ollama.ts`):

- El token solo existe en el servidor. Ninguna respuesta lo incluye, ni la
  dirección, y los errores de conexión se registran sin ellos.
- Con token, la dirección debe ser `https:` (`http:` solo vale para `127.0.0.1`,
  `::1` y `localhost`). Si no, la app trata Ollama como no configurado: responde
  con reglas y no envía ninguna petición. Una dirección que no se puede
  interpretar cuenta igual.
- Sin token no se envía `Authorization`, como en desarrollo local.

Comprobación, desde el portátil, con la clave en el entorno y sin escribirla en
un argumento (la lee `curl` por la entrada estándar; el usuario es indiferente):

```bash
read -rs APP_PASSWORD && export APP_PASSWORD
printf 'user = "u:%s"\n' "$APP_PASSWORD" | curl -sS --config - https://transmivoz.onrender.com/api/agent
```

Con el modelo activo, `node scripts/medir-render.mjs credenciales` debe FALLAR
en su comprobación de motor, porque exige `reglas`. No es un error de la app:
vuelve a correrlo después de volver a las reglas.

Con el modelo activo y sano responde `{"engine":"ollama","model":"qwen2.5:3b","reachable":true,"hasModel":true}`.
`"engine":"reglas"` significa que `OLLAMA_MODEL` está vacío o que la dirección no
cumple la regla de `https:`. Con `"reachable":false` o `"hasModel":false` el
servicio está configurado, pero el túnel, el proxy o el modelo no responden;
mientras tanto, el asistente responde con reglas. El túnel de prueba cambia de
dirección al reiniciarse: si cambia, actualiza `OLLAMA_BASE_URL`.

Si el panel de Render no admite dejar vacío `OLLAMA_BASE_URL` u `OLLAMA_TOKEN`
al crear el servicio desde el Blueprint (`sync: false` las pide), no lo hemos
comprobado: escribe un valor cualquiera, que no se usa mientras `OLLAMA_MODEL`
siga vacío.

Para volver a las reglas: deja `OLLAMA_MODEL` vacío (o elimina la variable),
borra `OLLAMA_TOKEN` y `OLLAMA_BASE_URL` y despliega de nuevo. Después de la
feria, apaga el túnel y el proxy y descarta el token; ver la guía del equipo.

## Revertir

Ningún paso de esta guía modifica el origen anterior, así que revertir es
dejar de usar el nuevo.

- Para parar el tráfico a Render: en *Settings*, suspende el servicio. El
  origen de Tailscale sigue igual.
- Para volver a una versión anterior del código en Render: en *Deploys*,
  *Rollback* sobre un despliegue exitoso que aún ofrezca esa opción. Hacerlo
  desde el panel desactiva el despliegue automático. El informe de
  investigación indica que Free conserva solo los dos despliegues anteriores;
  confirma en el panel cuáles quedan. Si el actual es el primero, no hay a
  dónde volver y la reversión es suspender.
- Para deshacer el Camino A: devuelve los ajustes a los valores previos que
  anotaste antes de cambiarlos. Anótalos antes de empezar.
- Las preferencias y favoritas se guardan en `localStorage`, que es propio de
  cada origen. Lo guardado en `onrender.com` no existe en el dominio de
  Tailscale y al revés; nada se migra. Conserva el origen anterior y explica a
  quien lo use que son dos instalaciones distintas.
- El 401 o el 503 de esta app no es una caída: sin clave utilizable en
  producción responde 503 a propósito.

## Qué sigue funcionando con el servidor dormido

El código de la página ya cargada, la voz del navegador (`speechSynthesis`) y
el respaldo de reglas en el navegador no necesitan al servidor. Con el
catálogo ya cargado, una pregunta espera 6 s a `/api/agent` y, si no hay
respuesta, la resuelve el mismo intérprete de reglas en el navegador. Desde un
arranque frío no hay catálogo: abrir la app tras el reposo espera cerca de un
minuto. La app no tiene service worker ni modo sin conexión.

Este repositorio no contiene Bluetooth (BLE). Lo que haga un accesorio con el
teléfono se comprueba en las tareas de iPhone y firmware con el dispositivo
real, no aquí.
