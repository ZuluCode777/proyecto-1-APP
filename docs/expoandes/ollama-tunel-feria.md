# Ollama del equipo para Render: proxy con token y túnel (EA-27, #53)

Guía para quien tiene el equipo con Windows (RTX 3080) y la corre en PowerShell.
Deja que el servicio de Render (`https://transmivoz.onrender.com`) use
`qwen2.5:3b` del equipo durante la feria, sin pagar alojamiento. El lado de
Render está en [`docs/RENDER.md`](../RENDER.md#activar-el-modelo-opcional).

Decisión de A1 del 10/11/2026 (comentario del issue #53): Ollama sigue
escuchando solo en `127.0.0.1`; delante va un proxy local que exige un token y
solo deja pasar `POST /api/chat` y `GET /api/tags`; el acceso público llega por
un túnel saliente, sin abrir puertos en el router; el token vive solo en las
variables de entorno de Render y, cifrado, en el equipo.

```
Render ──https──> túnel ──> Caddy 127.0.0.1:11436 ──> TransMiVoz Ollama 127.0.0.1:11435
                            (token + 2 rutas)
```

**Estado (10/11/2026):** montado así en el equipo y comprobado desde internet y
desde Render. Lo que se ejecutó y lo que no está en
[Comprobado y sin comprobar](#comprobado-y-sin-comprobar).

## Reglas

- El Ollama de esta app es la tarea **TransMiVoz Ollama**, en `127.0.0.1:11435`
  (ver `scripts/ollama-transmivoz.ps1`). **Nunca** uses ni publiques el puerto
  `11434`, el Ollama de uso personal.
- El token no se escribe en el repositorio, en un archivo en claro, en un chat
  ni como argumento de un comando (los argumentos se ven en la lista de
  procesos). Vive cifrado en `D:\transmivoz-tunel\token.dpapi` y, en claro,
  solo en el entorno del proceso de Caddy y en el panel de Render.
- **No hagas capturas de pantalla del panel de Render con el valor a la
  vista.** Mientras editas una variable, Render la muestra en claro. Una
  captura con el token es un token filtrado (paso 8.8).
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

Debe listar `qwen2.5:3b`. Si no responde, arranca la tarea con
`Start-ScheduledTask -TaskName 'TransMiVoz Ollama'` o reinstala las tareas con
`scripts\instalar-servicios-transmivoz.ps1` (ver `AGENTS.md`). No sigas hasta
que responda.

## 2. Generar el token y guardarlo cifrado

Un token aleatorio de 256 bits en hexadecimal (64 caracteres). Funciona en
Windows PowerShell 5.1. No se imprime ni pasa por el portapapeles: se guarda
cifrado con DPAPI, de modo que solo este usuario de Windows, en este equipo,
puede descifrarlo. Así sobrevive a un reinicio sin estar en claro en el disco.

```powershell
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$dirTunel = 'D:\transmivoz-tunel'
$archivoToken = Join-Path $dirTunel 'token.dpapi'
New-Item -ItemType Directory -Path $dirTunel -Force | Out-Null
if (Test-Path -LiteralPath $archivoToken) { throw 'token.dpapi ya existe; para cambiarlo, sigue el paso 8.' }
$bytesToken = New-Object byte[] 32
$generador = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$generador.GetBytes($bytesToken)
$generador.Dispose()
$textoToken = -join ($bytesToken | ForEach-Object { $_.ToString('x2') })
$cifrado = [System.Security.Cryptography.ProtectedData]::Protect([System.Text.Encoding]::ASCII.GetBytes($textoToken), $null, 'CurrentUser')
[System.IO.File]::WriteAllBytes($archivoToken, $cifrado)
Remove-Variable bytesToken, generador, textoToken, cifrado
# Solo este usuario puede leer el archivo.
icacls $archivoToken /inheritance:r /grant:r "$($env:USERNAME):(F)" | Out-Null
```

## 3. Ponerlo en Render sin imprimirlo

Crea `D:\transmivoz-tunel\copiar-token.ps1`. Descifra el token y lo deja en el
portapapeles, sin mostrarlo:

```powershell
# Copia el token de Caddy (EA-27, #53) al portapapeles para pegarlo en Render
# (OLLAMA_TOKEN). No lo imprime. Después de pegarlo: Win+V, "Borrar todo".
Add-Type -AssemblyName System.Security
$cifrado = [System.IO.File]::ReadAllBytes('D:\transmivoz-tunel\token.dpapi')
$bytesToken = [System.Security.Cryptography.ProtectedData]::Unprotect($cifrado, $null, 'CurrentUser')
Set-Clipboard -Value ([System.Text.Encoding]::ASCII.GetString($bytesToken))
Remove-Variable cifrado, bytesToken
'Token copiado. Pégalo en Render y luego borra el historial con Win+V.'
```

1. Ejecútalo:
   `powershell -NoProfile -ExecutionPolicy Bypass -File D:\transmivoz-tunel\copiar-token.ps1`
2. En el panel de Render, servicio *transmivoz*, pestaña *Environment*, sección
   *Environment Variables*, añade (o edita) `OLLAMA_TOKEN` y pega el
   portapapeles (Ctrl+V). No lo escribas a mano ni lo pegues en un chat.
3. Vacía el portapapeles con `Set-Clipboard -Value ' '` y borra su historial
   (Win+V, *Borrar todo*).
4. No guardes aún: faltan `OLLAMA_BASE_URL` y `OLLAMA_MODEL` (paso 6).

**El portapapeles guarda copias.** Windows puede conservar el token en el
historial del portapapeles y sincronizarlo con otros equipos. En
*Configuración > Sistema > Portapapeles*, comprueba que *Sincronizar entre
dispositivos* está desactivado. Si estaba activado, el token pudo salir de este
equipo: cámbialo (paso 8) y actualiza Render.

El panel de Render muestra el valor en claro mientras se edita, a cualquiera
con acceso al servicio: da ese acceso solo al equipo.

## 4. Caddy como proxy con token

Caddy escucha solo en `127.0.0.1:11436`. Deja pasar `POST /api/chat` y
`GET /api/tags` cuando la petición lleva exactamente
`Authorization: Bearer <token>`; todo lo demás recibe 403. Antes de pasar la
petición a Ollama reescribe la cabecera `Host` a la dirección de bucle local,
para que Ollama reciba el `Host` que espera (el ejemplo oficial de nginx de las
preguntas frecuentes de Ollama hace lo mismo con
`proxy_set_header Host localhost:11434;`).

Descarga `caddy_<versión>_windows_amd64.zip` y `caddy_<versión>_checksums.txt`
desde la página de versiones de Caddy
(<https://github.com/caddyserver/caddy/releases>), comprueba que el SHA-512 del
zip (`Get-FileHash -Algorithm SHA512`) es el de la lista y deja `caddy.exe` en
`D:\transmivoz-tunel`. Es la vía manual de la documentación oficial de
instalación (<https://caddyserver.com/docs/install>). Probado con la v2.11.9.

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
`%AppData%\Caddy`. Con esta configuración en marcha, `%AppData%\Caddy\autosave.json`
no existe (comprobado el 10/11/2026).

Crea `D:\transmivoz-tunel\iniciar-caddy.ps1`. Descifra el token, lo pone en el
entorno de este proceso y arranca Caddy, que lo hereda. La comprobación impide
arrancar con el token vacío, que dejaría una regla `Bearer ` sin secreto.

```powershell
# Arranca Caddy para EA-27 (#53): proxy con token delante de TransMiVoz Ollama.
# Lo lanza la tarea programada "TransMiVoz Caddy" al iniciar sesión.
# El token está cifrado con DPAPI en token.dpapi: solo este usuario, en este
# equipo, puede descifrarlo. Vive en claro solo en el entorno de este proceso
# y de Caddy; no se imprime ni se pasa como argumento.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security

$dirTunel = 'D:\transmivoz-tunel'
$cifrado = [System.IO.File]::ReadAllBytes((Join-Path $dirTunel 'token.dpapi'))
$bytesToken = [System.Security.Cryptography.ProtectedData]::Unprotect($cifrado, $null, 'CurrentUser')
$env:TRANSMIVOZ_OLLAMA_TOKEN = [System.Text.Encoding]::ASCII.GetString($bytesToken)
Remove-Variable cifrado, bytesToken
# Un token vacío dejaría la regla `Bearer ` sin secreto.
if ($env:TRANSMIVOZ_OLLAMA_TOKEN -cnotmatch '^[0-9a-f]{64}$') { throw 'Token ausente o mal formado.' }

Set-Location $dirTunel
& (Join-Path $dirTunel 'caddy.exe') run --config (Join-Path $dirTunel 'Caddyfile') --adapter caddyfile
```

Regístralo como tarea programada, con los mismos ajustes que **TransMiVoz
Ollama** (arranca al iniciar sesión, sin límite de tiempo), y arráncala:

```powershell
$usuarioActual = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$accionCaddy = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "D:\transmivoz-tunel\iniciar-caddy.ps1"'
$disparador = New-ScheduledTaskTrigger -AtLogOn -User $usuarioActual
$ajustes = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$principal = New-ScheduledTaskPrincipal -UserId $usuarioActual -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'TransMiVoz Caddy' -Action $accionCaddy -Trigger $disparador -Settings $ajustes -Principal $principal -Description 'EA-27 (#53): proxy con token delante de TransMiVoz Ollama (127.0.0.1:11436 -> 11435).' | Out-Null
Start-ScheduledTask -TaskName 'TransMiVoz Caddy'
```

Comprobación local. `curl.exe`, no `curl`: en PowerShell `curl` es otro
comando. El token pasa por la entrada estándar, no por argumentos.

```powershell
Add-Type -AssemblyName System.Security
$textoToken = [System.Text.Encoding]::ASCII.GetString([System.Security.Cryptography.ProtectedData]::Unprotect([System.IO.File]::ReadAllBytes('D:\transmivoz-tunel\token.dpapi'), $null, 'CurrentUser'))
# Sin token: 403
curl.exe -sS -o NUL -w "%{http_code}`n" http://127.0.0.1:11436/api/tags
# Con token: 200
"header = `"Authorization: Bearer $textoToken`"" | curl.exe -sS --config - -o NUL -w "%{http_code}`n" http://127.0.0.1:11436/api/tags
Remove-Variable textoToken
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
   Funnel. Desde un equipo de la tailnet con Linux o macOS se puede forzar la
   dirección pública con `curl --resolve <máquina>.<tailnet>.ts.net:8443:<IP pública>`,
   donde la IP sale de `dig +short @1.1.1.1 <máquina>.<tailnet>.ts.net`. Esos
   dos comandos son de Bash: en PowerShell, `curl` es otro comando y no hay
   `dig`.

Según la documentación de Tailscale, Funnel solo escucha en los puertos 443,
8443 y 10000, requiere MagicDNS y HTTPS activados en la tailnet y el atributo
`funnel` en la política (ya está en uso para la app), y tiene un límite de
ancho de banda que no se puede configurar. Sintaxis de la documentación:
`tailscale funnel [flags] <target>`, con `--bg` (queda activo tras reiniciar
hasta que se apague), `--https=<puerto>` y un número de puerto como destino.

En Windows, el comando del punto 2 añadió la ruta 8443 y dejó intacta la 443
(comprobado el 10/11/2026). Al publicarla, Tailscale indica cómo apagarla:
`tailscale funnel --https=8443 off`. Ese apagado **no se ha ejecutado**.
Comprueba el resultado con `tailscale funnel status` cada vez.

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

En el panel de Render, *Environment* del servicio, sección *Environment
Variables*:

| Variable | Valor |
| --- | --- |
| `OLLAMA_MODEL` | `qwen2.5:3b` |
| `OLLAMA_BASE_URL` | `https://<máquina>.<tailnet>.ts.net:8443` (o la del túnel rápido; paso 5) |
| `OLLAMA_TOKEN` | ya puesto en el paso 3 |

Guarda con *Save, rebuild, and deploy*: el 10/11/2026 esa opción desplegó el
último commit de `main`. La app solo usa el token si la dirección es `https`;
con una dirección `http` que no sea de este equipo ignora Ollama y responde con
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

Desde PowerShell, el mismo patrón que en el paso 4: descifra el token en una
variable propia, usa `curl.exe`, pasa
`"header = `"Authorization: Bearer $textoToken`""` por la tubería a
`curl.exe --config -` y borra la variable al terminar.

Resultado esperado: 403, 403 y 200 con `qwen2.5:3b` en la lista. Si el punto 3
da 403, el token no coincide con el que leyó Caddy al arrancar: reinicia la
tarea **TransMiVoz Caddy**. Si da 502, Caddy no llega a Ollama (paso 1).

## 8. Después de la feria: apagar y cambiar el token

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
   3000. No ejecutado todavía. Con el túnel rápido, detén `cloudflared` con
   Ctrl+C en su ventana: muere con el proceso.
3. Quita la tarea, para que Caddy no vuelva a arrancar. Esto no detiene el
   proceso que ya corre:

   ```powershell
   Unregister-ScheduledTask -TaskName 'TransMiVoz Caddy' -Confirm:$false
   ```

4. Detén el proceso de Caddy. El que escucha en el 11436 es el que lanzó la
   tarea: toma su PID de ahí, comprueba que es `caddy` y detén solo ese
   proceso:

   ```powershell
   $pidCaddy = (Get-NetTCPConnection -LocalPort 11436 -State Listen -ErrorAction Stop | Select-Object -First 1).OwningProcess
   if ((Get-Process -Id $pidCaddy).ProcessName -ne 'caddy') { throw 'El puerto 11436 no es de Caddy; no detengo nada.' }
   Stop-Process -Id $pidCaddy
   ```

   No detengas `ollama` ni la tarea **TransMiVoz Ollama**: la app local la usa.
   Los puntos 3 y 4 no se han ejecutado todavía.
5. Borra el token cifrado. Sin ese archivo, el token ya no se puede recuperar
   en el equipo:

   ```powershell
   Remove-Item -LiteralPath 'D:\transmivoz-tunel\token.dpapi'
   ```

6. Borra la copia de la configuración que Caddy pudo guardar con el token
   dentro, si existe:

   ```powershell
   $copiaCaddy = Join-Path $env:APPDATA 'Caddy\autosave.json'
   if (Test-Path -LiteralPath $copiaCaddy) { Remove-Item -LiteralPath $copiaCaddy }
   ```

   Con `persist_config off` no debería existir. Si existe, el token ya estuvo en
   disco: no lo reutilices.
7. Limpia el portapapeles: Win+V, *Borrar todo*, y confirma que *Sincronizar
   entre dispositivos* sigue desactivado.
8. Si el token pudo verse en un chat, un registro o una captura, trátalo como
   filtrado y cámbialo.

**Cambiar el token sin apagar nada:** borra `token.dpapi` (punto 5) y repite el
paso 2. Reinicia Caddy sin quitar la tarea: detén su proceso como en el punto 4
(solo ese bloque), espera a que el puerto 11436 quede libre y arranca la tarea:

```powershell
for ($intento = 0; $intento -lt 30 -and (Get-NetTCPConnection -LocalPort 11436 -State Listen -ErrorAction SilentlyContinue); $intento++) { Start-Sleep -Seconds 1 }
Start-ScheduledTask -TaskName 'TransMiVoz Caddy'
```

Copia el token nuevo a Render (paso 3) y despliega. Hasta desplegar, Render
recibe 403 y responde con reglas. Un token nunca se reutiliza.

## Límites

- El equipo debe estar encendido **y con la sesión de Windows iniciada**
  durante toda la feria: **TransMiVoz Ollama** y **TransMiVoz Caddy** arrancan
  al iniciar sesión, y el token solo se descifra con ese usuario.
- Con el modelo cargado, toda pregunta se consulta al modelo (decisión de A1 del
  10/11/2026); solo responden las reglas cuando no hay modelo cargado. Las
  consultas del Metro y los viajes sin destino las resuelven siempre las
  reglas, y un «no entiendo» del modelo no anula lo que las reglas entienden.
  La consulta espera hasta 4,5 s (`TIMEOUT_MS` en `lib/ollama.ts`), 1,5 s menos
  que los 6 s que espera la web. Si el equipo está apagado, el túnel caído o el
  modelo tarda más, responden las reglas, el modelo se da por no cargado y se
  lanza su precarga. Lo mismo pasa si el túnel responde 200 con algo que no es
  de Ollama, como la página de un proxy: no cuenta como modelo cargado.
- Cargar el modelo en memoria tarda más que esa espera. Mientras el servidor
  lo da por no cargado (al arrancar, hasta que termina la precarga, o tras un
  fallo), las reglas responden al instante y cada pregunta lanza la precarga
  (solo una a la vez); cuando termina, las siguientes ya van al modelo.
- El servidor no sabe que Ollama sacó el modelo de la memoria (tras 24 h sin
  uso, o al reiniciar Ollama o el equipo) hasta la consulta siguiente. Esa
  pregunta puede esperar los 4,5 s antes de la respuesta de reglas. Para
  evitarlo, abre `/diagnostico` antes de abrir el puesto: `GET /api/agent`
  también precarga el modelo, igual que el arranque del servidor.
- Mientras está cargado, el modelo ocupa unos 2 GB de memoria de la tarjeta
  gráfica (lectura de `ollama ps` en «Comprobado»), hasta 24 h después de la
  última pregunta.
- El token da acceso a `POST /api/chat` con **cualquier modelo** de ese Ollama,
  incluidos los de la nube de ollama.com si la cuenta los tiene: Caddy filtra
  rutas, no modelos.
- Con Funnel en el 8443 la dirección no cambia; una de túnel rápido nueva
  obliga a editar `OLLAMA_BASE_URL` y redesplegar Render a mano.
- Caddy compara la cabecera con el token como texto; no es una comparación de
  tiempo constante. Con un token de 256 bits no es un riesgo práctico.

## Comprobado y sin comprobar

Ejecutado el 10/11/2026 en el equipo con Windows (Windows PowerShell 5.1, Caddy
v2.11.9) y contra el servicio de Render:

- Pasos 1, 2, 4, 5 y 6 de esta guía. Del paso 3 no se ejecutó
  `copiar-token.ps1`: el token llegó al panel de Render por otra vía, sin
  imprimirse.
- Desde internet, por la dirección del 8443: 403 sin token, 403 en
  `POST /api/pull` con token, 200 en `GET /api/tags` y en `POST /api/chat` con
  token. La ruta 443 de la app siguió igual.
- Desde Render: `GET /api/agent` devolvió `engine: "ollama"`,
  `reachable: true`, `hasModel: true`.
- Veinte preguntas a `POST /api/agent` de Render, cuando las reglas iban
  primero: las reglas resolvieron doce y el modelo se consultó en ocho. De 8
  consultas medidas desde Render, una agotó los 2 s; las otras tardaron entre
  0,8 y 2,5 s en total. Por eso la espera es ahora de 4,5 s.
- Con el modelo sacado de la memoria a propósito (`keep_alive: 0`), tres
  preguntas seguidas cayeron en reglas y el modelo siguió sin cargarse: agotar
  la espera aborta la carga. Por eso un fallo del modelo lanza ahora la
  precarga.
- Las dos mediciones, repetidas el 11/11/2026 con «el modelo primero»
  desplegado en Render (`8fa09c5`). De las mismas veinte preguntas, el modelo
  respondió 17 y las reglas 3. Ninguna agotó la espera: las tres de reglas
  tardaron menos de 1 s, y las del modelo, entre 0,6 y 1,4 s en total, salvo la
  primera tras despertar el servidor, que tardó 3,9 s. Con el modelo sacado de
  la memoria (`keep_alive: 0`), la primera pregunta lo cargó y la respondió el
  modelo en 3,1 s; las dos siguientes, en 1,1 s.
- En local, con el servidor compilado (`next start`) y un Ollama simulado: una
  sola precarga al arrancar, y la primera pregunta ya la responde el modelo.
- `ollama ps` mostró 2,01 GB para qwen2.5:3b con contexto 4096 el 10/11/2026.
- Con Caddy parado, la dirección del 8443 respondió 502 en centésimas de
  segundo (medido desde un equipo de la tailnet el 11/11/2026). El caso del
  equipo apagado sigue sin medir.
- Con Caddy en marcha, `%AppData%\Caddy\autosave.json` no existe.
- *Save, rebuild, and deploy* desplegó el último commit de `main`.
- Render muestra el valor de una variable en claro mientras se edita (visto en
  el panel el 10/11/2026).
- Comparación fuera de línea, el 10/11/2026, de las reglas con el modelo real
  en 36 frases, con la política de «el modelo primero». El modelo responde 25:
  en 21 da lo mismo que las reglas y en 4 algo distinto. Otras 7 son consultas
  del Metro que las reglas reconocen y no se consultan. En las 4 restantes el
  modelo no entiende y responden las reglas. De las 4 respuestas distintas, 2
  son peores («cómo llego desde Narnia a Ricaurte» cambia el origen desconocido
  por Nariño; «¿hay algo que me deje en las aguas?» da gps en vez de un viaje a
  Las Aguas) y 2 mejores («llévame al portal de Suba» da Portal Suba; «cuándo
  llega el bus» da tiempo real). Sin la excepción del Metro, 2 de esas 7
  consultas se habrían respondido mal. La inferencia del modelo tarda
  0,15–0,2 s en la red local; los 0,8–2,5 s vistos desde Render son sobre todo
  red.

Sin comprobar:

- La precarga tras un fallo, en Render: en la medición del 11/11/2026 ninguna
  consulta falló, así que no llegó a usarse.
- Que la primera pregunta tras arrancar el servidor vaya al modelo sin abrir
  antes `/diagnostico`: en Render se midió después de un `GET /api/agent`, que
  también precarga. Solo está comprobado en local.
- Qué tarda en fallar la consulta con el equipo apagado. Si el túnel no
  responde enseguida, la primera pregunta tras el apagado esperaría los 4,5 s
  antes de la respuesta de reglas; después el modelo se da por no cargado y las
  reglas responden al instante, mientras cada precarga espera hasta 60 s en
  segundo plano.
- El apagado (paso 8) y el cambio de token.
- `cloudflared`: contrastado con su documentación, no ejecutado.
