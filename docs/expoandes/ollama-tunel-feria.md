# Ollama del equipo para Render: proxy con token y túnel (EA-27, #53)

Guía para quien tiene el equipo con Windows (RTX 3080) y la corre en PowerShell.
Deja que el servicio de Render (`https://transmivoz.onrender.com`) use
`qwen2.5:3b` del equipo durante la feria, sin pagar alojamiento. El lado de
Render está en [`docs/RENDER.md`](../RENDER.md#activar-el-modelo-opcional).

Decisión de A1 del 10/11/2026 (comentario del issue #53): Ollama sigue
escuchando solo en `127.0.0.1`; delante va un proxy local que exige un token y
solo deja pasar `POST /api/chat` y `GET /api/tags`; el acceso público llega por
un túnel saliente, sin abrir puertos en el router; el token vive solo en las
variables de entorno de Render y del equipo.

```
Render ──https──> túnel ──> Caddy 127.0.0.1:11436 ──> TransMiVoz Ollama 127.0.0.1:11435
                            (token + 2 rutas)
```

## Reglas

- El Ollama de esta app es la tarea **TransMiVoz Ollama**, en `127.0.0.1:11435`
  (ver `scripts/ollama-transmivoz.ps1`). **Nunca** uses ni publiques el puerto
  `11434`, el Ollama de uso personal.
- El token no se escribe en el repositorio, en un archivo de configuración, en
  un chat ni como argumento de un comando (los argumentos se ven en la lista de
  procesos). Vive en una variable de entorno de la sesión de PowerShell.
- Carpeta de trabajo en `D:`, fuera del repositorio: `D:\transmivoz-tunel`.
- Para detener algo, usa el PID del proceso que tú lanzaste. No detengas
  procesos por nombre.
- No asignes variables automáticas de PowerShell (`$HOME`, `$PID`, `$ARGS`,
  `$HOST`, `$ERROR`, `$MATCHES`, `$PROFILE`, `$PWD`, `$INPUT`). Esta guía usa
  nombres propios.

## 1. Comprobar que Ollama responde

```powershell
curl.exe -sS http://127.0.0.1:11435/api/tags
```

Debe listar `qwen2.5:3b`. Si no responde, reinicia las tareas con
`scripts\instalar-servicios-transmivoz.ps1` (ver `AGENTS.md`). No sigas hasta
que responda.

## 2. Generar el token

Un token aleatorio de 256 bits en hexadecimal (64 caracteres). Funciona en
Windows PowerShell 5.1 y en PowerShell 7. No se imprime: queda en la variable de
entorno de esta sesión y en el portapapeles.

```powershell
$bytesToken = New-Object byte[] 32
$generador = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$generador.GetBytes($bytesToken)
$generador.Dispose()
$env:TRANSMIVOZ_OLLAMA_TOKEN = -join ($bytesToken | ForEach-Object { $_.ToString('x2') })
Remove-Variable bytesToken, generador
Set-Clipboard -Value $env:TRANSMIVOZ_OLLAMA_TOKEN
```

La variable `TRANSMIVOZ_OLLAMA_TOKEN` solo existe en esta ventana. Abre Caddy
desde esta misma ventana (paso 4), o repite este paso con otro token en cada
sesión nueva y actualiza Render.

**El portapapeles guarda copias.** Windows puede conservar el token en el
historial del portapapeles y sincronizarlo con otros equipos. Después de pegarlo
en Render (paso 3):

1. Abre el historial con Win+V y pulsa *Borrar todo*.
2. En *Configuración > Sistema > Portapapeles*, comprueba que *Sincronizar entre
   dispositivos* está desactivado. Si estaba activado, el token pudo salir de
   este equipo: genera uno nuevo y actualiza Render.

## 3. Ponerlo en Render sin imprimirlo

1. En el panel de Render, servicio *transmivoz*, pestaña *Environment*, añade
   (o edita) `OLLAMA_TOKEN` y pega el portapapeles (Ctrl+V). No lo escribas a
   mano ni lo pegues en un chat.
2. Vacía el portapapeles con `Set-Clipboard -Value ' '` y borra su historial
   (Win+V, *Borrar todo*); ver el aviso del paso 2.
3. No guardes aún: falta `OLLAMA_BASE_URL` (paso 6) y `OLLAMA_MODEL`. El panel
   de Render puede mostrar los valores de las variables a quien tenga acceso al
   servicio (no verificado); dalo solo al equipo.

## 4. Caddy como proxy con token

Caddy escucha solo en `127.0.0.1:11436`. Deja pasar `POST /api/chat` y
`GET /api/tags` cuando la petición lleva exactamente
`Authorization: Bearer <token>`; todo lo demás recibe 403. Antes de pasar la
petición a Ollama reescribe la cabecera `Host` a la dirección de bucle local,
para que Ollama reciba el `Host` que espera (el ejemplo oficial de nginx de las
preguntas frecuentes de Ollama hace lo mismo con
`proxy_set_header Host localhost:11434;`).

Descarga el binario de Windows de 64 bits (el nombre exacto del archivo no está
verificado) desde la página de versiones de Caddy
(<https://github.com/caddyserver/caddy/releases>) y deja `caddy.exe` en
`D:\transmivoz-tunel`. Es la vía manual de la documentación oficial de
instalación (<https://caddyserver.com/docs/install>).

Crea `D:\transmivoz-tunel\Caddyfile`. No contiene el token: lo lee de la
variable de entorno al arrancar.

```caddyfile
{
	# Sin API de administración: no hay nada que configurar en caliente.
	admin off
	# Sin esto, Caddy guarda la configuración ya resuelta, con el token dentro,
	# en su carpeta de configuración (autosave.json); `admin off` no lo evita.
	persist_config off
}

# Reenvía a TransMiVoz Ollama con el Host que ese servidor espera.
(ollama) {
	reverse_proxy 127.0.0.1:11435 {
		header_up Host 127.0.0.1:11435
	}
}

# Sin nombre de host: acepta el Host que envíe el túnel. Con http:// no hay
# HTTPS automático (el cifrado lo pone el túnel).
http://:11436 {
	bind 127.0.0.1

	@chat {
		method POST
		path /api/chat
		header Authorization "Bearer {$TRANSMIVOZ_OLLAMA_TOKEN}"
	}
	@tags {
		method GET
		path /api/tags
		header Authorization "Bearer {$TRANSMIVOZ_OLLAMA_TOKEN}"
	}

	handle @chat {
		import ollama
	}
	handle @tags {
		import ollama
	}
	# Todo lo demás (otras rutas, otros métodos, sin token o con token errónea).
	handle {
		respond 403
	}
}
```

No añadas la directiva `log`: no hace falta y evita dejar cabeceras en disco.

`persist_config off` es una opción global documentada de Caddy («By default, the
config is persisted»). La carpeta de configuración de Caddy en Windows es
`%AppData%\Caddy`; que el archivo se llame `autosave.json` no aparece en la
documentación consultada. Ni `persist_config off` ni el borrado de ese archivo
(paso 8) se ejecutaron en Windows: no verificado.

Valida y arranca, en la ventana donde está la variable del paso 2. La
comprobación impide arrancar con el token vacío, que dejaría una regla
`Bearer ` sin secreto.

```powershell
Set-Location D:\transmivoz-tunel
if (-not $env:TRANSMIVOZ_OLLAMA_TOKEN) { throw 'Falta TRANSMIVOZ_OLLAMA_TOKEN (paso 2).' }
.\caddy.exe validate --config .\Caddyfile --adapter caddyfile
.\caddy.exe run --config .\Caddyfile --adapter caddyfile
```

Déjala abierta; Ctrl+C la detiene.

Comprobación local, en otra ventana de PowerShell (con la variable del paso 2
cargada en esa ventana; si no, repite el paso 2 y actualiza Render). `curl.exe`,
no `curl`: en PowerShell `curl` es otro comando.

```powershell
# Sin token: 403
curl.exe -sS -o NUL -w "%{http_code}`n" http://127.0.0.1:11436/api/tags
# Con token: 200. El token pasa por la entrada estándar, no por argumentos.
"header = `"Authorization: Bearer $env:TRANSMIVOZ_OLLAMA_TOKEN`"" | curl.exe -sS --config - -o NUL -w "%{http_code}`n" http://127.0.0.1:11436/api/tags
```

## 5. Túnel

### Para la feria: Tailscale Funnel en el puerto 8443

La app ya está publicada con Tailscale Funnel en el puerto 443 hacia el 3000
(ver [`SELF-HOSTING.md`](../SELF-HOSTING.md#publicarla-en-internet-con-funnel) y
[`DEMO.md`](../DEMO.md)). Ese acceso **no se toca**: Ollama se publica en otro
puerto público de Funnel, el 8443, que apunta a Caddy (11436) y no al 3000. La
dirección es estable mientras la tailnet no cambie.

1. Antes de nada, anota el estado actual y confirma que está la ruta 443 hacia
   el 3000:

   ```powershell
   tailscale funnel status
   ```

2. Publica Caddy en el 8443. **Lleva siempre `--https=8443`**: sin esa opción,
   Funnel usaría el 443 y sustituiría la ruta de la app.

   ```powershell
   tailscale funnel --bg --https=8443 11436
   tailscale funnel status
   ```

   `status` debe mostrar las dos rutas: la 443 hacia el 3000, como antes, y la
   8443 hacia el 11436. Si la 443 cambió, apaga la ruta 8443 (paso 8.2), avisa
   y no sigas. Para devolver la app a la 443 vale el mismo comando de
   `SELF-HOSTING.md`: `tailscale funnel --bg 3000`.
3. La dirección para Render es
   `https://<máquina>.<tailnet>.ts.net:8443`, con el puerto y sin barra final.
   Compruébala desde fuera de la tailnet (un celular con datos móviles), como
   dice `SELF-HOSTING.md`: desde un equipo de la tailnet el nombre no pasa por
   Funnel.

Según la documentación de Tailscale, Funnel solo escucha en los puertos 443,
8443 y 10000, requiere MagicDNS y HTTPS activados en la tailnet y el atributo
`funnel` en la política (ya está en uso para la app), y tiene un límite de
ancho de banda que no se puede configurar. Sintaxis de la documentación:
`tailscale funnel [flags] <target>`, con `--bg` (queda activo tras reiniciar
hasta que se apague), `--https=<puerto>` y un número de puerto como destino.
Para apagar una sola ruta se repite el comando con `off` al final. Que estos
comandos funcionen en Windows con la ruta 443 existente intacta, y el comando
exacto de apagado del 8443 (`tailscale funnel --https=8443 off`, deducido de
la documentación), **no está verificado**. Comprueba el resultado con
`tailscale funnel status` cada vez.

**Nunca uses `tailscale funnel reset` ni `tailscale serve reset`**: borran toda
la configuración de Funnel y Serve, incluida la ruta 443 de la app.

### Para probar rápido: `cloudflared` con túnel rápido

Sirve si Funnel no está disponible o para una prueba corta. Descarga
`cloudflared-windows-amd64.exe` desde
<https://github.com/cloudflare/cloudflared/releases/latest>, renómbralo a
`cloudflared.exe` y déjalo en `D:\transmivoz-tunel`. En otra ventana:

```powershell
Set-Location D:\transmivoz-tunel
.\cloudflared.exe tunnel --url http://127.0.0.1:11436
```

Imprime una dirección `https://<palabras>.trycloudflare.com`. Esa es la
`OLLAMA_BASE_URL`, sin barra final.

Límites, según la documentación de Cloudflare:

- La dirección **cambia cada vez que reinicias el túnel**. Hay que actualizar
  `OLLAMA_BASE_URL` en Render y redesplegar.
- Los túneles rápidos **no tienen garantía de disponibilidad** y son "para
  pruebas y desarrollo". Admiten hasta 200 peticiones simultáneas y no admiten
  eventos enviados por el servidor (SSE); esta app no usa SSE.
- `cloudflared` en Windows no se actualiza solo.

## 6. Configurar Render

En el panel de Render, *Environment* del servicio:

| Variable | Valor |
| --- | --- |
| `OLLAMA_MODEL` | `qwen2.5:3b` |
| `OLLAMA_BASE_URL` | `https://<máquina>.<tailnet>.ts.net:8443` (o la del túnel rápido; paso 5) |
| `OLLAMA_TOKEN` | ya puesto en el paso 3 |

Guarda y despliega. La app solo usa el token si la dirección es `https`; con
una dirección `http` que no sea de este equipo ignora Ollama y responde con
reglas. Cómo comprobarlo desde Render: sección «Activar el modelo» de
`docs/RENDER.md` (`GET /api/agent` debe mostrar `engine: "ollama"`,
`reachable: true`, `hasModel: true`).

## 7. Comprobaciones desde cualquier equipo

Sustituye `<túnel>` por la dirección pública. El token se pasa a `curl` por un
archivo de configuración leído de la entrada estándar (`--config -`), nunca como
argumento. En bash (Linux o macOS):

```bash
URL=https://<túnel>
read -rs TOKEN

# 1. Sin token: debe dar 403.
curl -sS -o /dev/null -w '%{http_code}\n' "$URL/api/tags"

# 2. POST /api/pull con token: debe dar 403 (ruta no permitida).
printf 'header = "Authorization: Bearer %s"\n' "$TOKEN" |
  curl -sS --config - -o /dev/null -w '%{http_code}\n' -d '{"model":"qwen2.5:3b"}' "$URL/api/pull"

# 3. GET /api/tags con token: debe dar 200 y listar qwen2.5:3b.
printf 'header = "Authorization: Bearer %s"\n' "$TOKEN" | curl -sS --config - "$URL/api/tags"

unset TOKEN
```

Desde PowerShell, el mismo patrón que en el paso 4: carga la variable de
entorno, usa `curl.exe` y pasa
`"header = `"Authorization: Bearer $env:TRANSMIVOZ_OLLAMA_TOKEN`""` por la
tubería a `curl.exe --config -`.

Resultado esperado: 403, 403 y 200 con `qwen2.5:3b` en la lista. Si el punto 3
da 403, el token no coincide con el del Caddyfile (la variable se leyó al
arrancar Caddy). Si da 502, Caddy no llega a Ollama (paso 1). Si da 403 de
Ollama por el `Host`, no verificado: Ollama debería aceptar `127.0.0.1`; si no,
prueba `header_up Host localhost:11435` en el snippet `ollama`.

## 8. Después de la feria: apagar y rotar

1. En Render, deja `OLLAMA_MODEL` vacío y borra `OLLAMA_TOKEN` y
   `OLLAMA_BASE_URL`; despliega. El asistente vuelve a las reglas.
2. Apaga la ruta pública. **Solo la del 8443**; la 443 de la app se queda:

   ```powershell
   tailscale funnel --https=8443 off
   tailscale funnel status
   ```

   Si `status` todavía lista el 8443, repite el apagado con todas las opciones
   originales: `tailscale funnel --bg --https=8443 11436 off`.

   `status` ya no debe listar el 8443 y debe seguir mostrando la 443 hacia el
   3000. No verificado en Windows. Con el túnel rápido, detén `cloudflared` con
   Ctrl+C en su ventana: muere con el proceso.
3. Detén Caddy con Ctrl+C en su ventana. Si la ventana se cerró y el proceso
   quedó vivo, el que escucha en el 11436 es el que lanzaste tú: toma su PID de
   ahí, comprueba que es `caddy` y detén solo ese proceso:

   ```powershell
   $pidCaddy = (Get-NetTCPConnection -LocalPort 11436 -State Listen -ErrorAction Stop | Select-Object -First 1).OwningProcess
   if ((Get-Process -Id $pidCaddy).ProcessName -ne 'caddy') { throw 'El puerto 11436 no es de Caddy; no detengo nada.' }
   Stop-Process -Id $pidCaddy
   ```

   No detengas `ollama` ni la tarea **TransMiVoz Ollama**: la app local la usa.
4. Borra la copia de la configuración que Caddy pudo guardar con el token
   dentro, si existe (no verificado en Windows):

   ```powershell
   $copiaCaddy = Join-Path $env:APPDATA 'Caddy\autosave.json'
   if (Test-Path -LiteralPath $copiaCaddy) { Remove-Item -LiteralPath $copiaCaddy }
   ```

   Con `persist_config off` no debería existir. Si existe, el token ya estuvo en
   disco: no lo reutilices.
5. Revoca el token: `Remove-Item Env:TRANSMIVOZ_OLLAMA_TOKEN`. Para usar la
   guía otra vez se genera uno nuevo (paso 2); nunca se reutiliza.
6. Limpia el portapapeles: Win+V, *Borrar todo*, y confirma que *Sincronizar
   entre dispositivos* sigue desactivado.
7. Si el token pudo verse en un chat, un registro o una captura, trátalo como
   filtrado: aplica los pasos 1 a 6 de inmediato.

## Límites

- El equipo debe estar encendido, con **TransMiVoz Ollama**, Caddy y el túnel
  en marcha, durante toda la feria.
- Si el equipo está apagado, el túnel caído o el modelo tarda más de 2 s en
  responder, el asistente de Render responde con reglas, como hoy. La
  precarga y el tiempo de espera están en `lib/ollama.ts`.
- La primera petición tras cargar el modelo puede tardar más de 2 s y caer en
  reglas; `GET /api/agent` lo precarga.
- Con Funnel en el 8443 la dirección no cambia; una de túnel rápido nueva
  obliga a editar `OLLAMA_BASE_URL` y redesplegar Render a mano.
- Caddy compara la cabecera con el token como texto; no es una comparación de
  tiempo constante. Con un token de 256 bits no es un riesgo práctico.
- Sin verificar en una ejecución real de este proyecto: los comandos de Caddy,
  `cloudflared` y Tailscale de esta guía se contrastaron con su documentación
  oficial, pero no se ejecutaron en el equipo con Windows.
