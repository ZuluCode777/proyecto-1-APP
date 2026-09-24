# Correr TransMiVoz en Windows

La app es un servidor Next.js normal, sin nada específico de Vercel, así que
una máquina con Windows puede alojarla sin cambiar código. Esta es la
configuración que usamos.

## Qué se necesita

- **Node 24**, de nodejs.org. Comprueba con `node --version`.
- **pnpm**, que viene con Node a través de corepack: `corepack enable`
- **Git**
- **Chrome**, para usar la app y para `pnpm verificar`.
- **Tailscale**, si la app se va a abrir desde otro dispositivo.
- **Ollama**, opcional, para que el asistente use un modelo local.

## Primera vez

Proyectos y compilaciones van en `D:`, que tiene más espacio que `C:`.

```powershell
cd D:\
git clone https://github.com/zulucode-design/proyecto-1-APP visionaria
cd D:\visionaria
corepack enable
pnpm install
pnpm build
pnpm start
```

Abre `http://localhost:3000`.

`http://localhost` es un contexto seguro, así que el micrófono, la cámara, la
ubicación y la brújula funcionan en Chrome de escritorio.

Para comprobar que todo responde:

```powershell
pnpm verificar
```

Abre Chrome sin ventana, corre las nueve pruebas de `/diagnostico` e imprime
el resultado. Si no encuentra Chrome, indica la ruta:

```powershell
$env:CHROME_PATH = "C:\Program Files\Google\Chrome\Application\chrome.exe"
pnpm verificar
```

## Conectar Ollama

Con Ollama, el asistente usa un modelo local para entender frases libres, como
"necesito llegar a la Universidad Nacional saliendo desde Ricaurte" o "¿hasta
qué hora funciona la B23?".

Probado en la máquina con Windows (RTX 3080) el 2026-09-23 con `qwen2.5:3b`:
responde en unos 200 ms por pregunta y maneja bien el español y el formato
JSON que pide la app.

### Un Ollama propio para TransMiVoz

La app usa su propia instancia de Ollama en el puerto **11435**, separada del
Ollama de uso personal (puerto 11434). Así la app no depende de que el otro
esté abierto, y lo que se haga con el otro no afecta a la app. Las dos
instancias comparten la carpeta de modelos, así que no se descarga nada dos
veces.

```powershell
cd D:\visionaria
ollama pull qwen2.5:3b
```

En `D:\visionaria\.env.local`:

```
OLLAMA_MODEL=qwen2.5:3b
OLLAMA_BASE_URL=http://127.0.0.1:11435
```

Después vuelve a compilar (`pnpm build`). La instancia en el 11435 la arranca
la tarea programada de la sección [Que siga corriendo](#que-siga-corriendo).

`/diagnostico` muestra "Motor: Ollama (qwen2.5:3b)" cuando el modelo contestó
de verdad. Si Ollama está configurado pero no respondió, lo dice.

Cargar el modelo en la GPU tarda unos segundos. El servidor lo precarga al
arrancar y al abrir `/diagnostico`, y Ollama lo mantiene una hora en memoria.
Si aun así tarda más de 8 s, o se cae, el asistente responde con las reglas;
la persona nunca se queda esperando.

Las dos instancias escuchan solo en `127.0.0.1`. Como la app corre en la misma
máquina, no hace falta abrir esos puertos a la red.

## Abrir la app desde otro dispositivo

`next start` escucha en `0.0.0.0` por defecto, así que
`http://<ip-de-la-red>:3000` sirve la página a otro equipo de la misma red.
**Pero la app no funciona así.** HTTP simple sobre una IP de la red no es un
contexto seguro, y el navegador bloquea el micrófono, la cámara y la
ubicación. Queda la página sin ninguna función.

Usa Tailscale. Sirve la app por HTTPS con un certificado válido en un nombre
`ts.net`, que sí es un contexto seguro:

```powershell
# la tarea TransMiVoz App ya sirve la app solo en loopback (127.0.0.1:3000),
# así que no queda expuesta en la red local; esto la publica en la tailnet
tailscale serve --bg 3000
tailscale serve status
```

La app queda en `https://<máquina>.<tailnet>.ts.net`, accesible desde
cualquier dispositivo conectado a la misma tailnet, con los permisos
funcionando.

Hace falta tener **MagicDNS** y **HTTPS Certificates** activados en la consola
de administración de Tailscale, en DNS. Sin eso no hay certificado.

### Publicarla en internet con Funnel

Para que la abra alguien que no está en la tailnet, por ejemplo el resto del
grupo, se usa Funnel. **Antes, pon una clave**: sin ella, cualquiera con el
enlace abre la app y usa la GPU de la máquina con el asistente.

En `D:\visionaria\.env.local`:

```
APP_PASSWORD=una-clave-larga-y-aleatoria
```

Con la clave, la app la pide en toda petición (páginas, API y archivos) con el
diálogo de usuario y contraseña del navegador. El usuario puede ser cualquiera;
solo cuenta la clave. El navegador la recuerda hasta que se cierra.

La clave se lee al arrancar, así que después de cambiarla reinicia las tareas
con el instalador de [Que siga corriendo](#que-siga-corriendo). Luego:

```powershell
tailscale funnel --bg 3000
tailscale funnel status
```

La dirección es la misma, `https://<máquina>.<tailnet>.ts.net`, ahora abierta a
internet. Funnel tiene que estar permitido en la política de la tailnet
(atributo `funnel`); si no, el comando da el enlace para activarlo. Si la app
arranca sin clave, lo advierte en su salida.

La comprobación tiene que hacerse **desde fuera de la tailnet**, por ejemplo
desde un celular con datos móviles o un equipo sin Tailscale. Desde un equipo
de la tailnet, el nombre `ts.net` lleva a la dirección interna y la petición
no pasa por Funnel.

- Sin clave, la app responde 401 y el navegador pide usuario y clave:
  `curl -I https://<máquina>.<tailnet>.ts.net`
- Con clave, pasan las nueve pruebas. La clave se escribe sin mostrarla, para
  que no quede en el historial de la consola:

  ```bash
  read -rs APP_PASSWORD && export APP_PASSWORD
  pnpm verificar https://<máquina>.<tailnet>.ts.net
  ```

Para volver a dejarla solo en la tailnet: `tailscale funnel --https=443 off` y
de nuevo `tailscale serve --bg 3000`.

## Que siga corriendo

`pnpm start` se detiene al cerrar la terminal. Para que la app y su Ollama
arranquen solos al iniciar sesión, hay un instalador que crea dos tareas
programadas, sin permisos de administrador:

```powershell
cd D:\visionaria
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\instalar-servicios-transmivoz.ps1
```

- **TransMiVoz Ollama**: el Ollama propio en `127.0.0.1:11435`
  (`scripts\ollama-transmivoz.ps1`).
- **TransMiVoz App**: `next start` en `127.0.0.1:3000`, desde `D:\visionaria`.

Termina diciendo que las dos escuchan. Las tareas se reinician solas si se
caen, y el instalador se puede volver a correr: reemplaza las tareas y las
reinicia. Necesita que la app ya esté compilada.

Ollama carga cada modelo en un proceso hijo (en la versión 0.34,
`llama-server.exe`). Si esos procesos siguen vivos después de que Ollama
termina, ocupan la memoria de la GPU. Por eso, cuando el Ollama propio termina,
su tarea detiene también esos procesos, y el instalador hace lo mismo al
reiniciarlo. Solo se tocan los de ese Ollama, nunca los del Ollama de uso
personal. Si alguno no se pudo detener, el aviso queda en
`.ollama-transmivoz.log`.

`tailscale serve --bg` ya persiste entre reinicios, no necesita su propia
tarea.

Para quitar las tareas:

```powershell
Unregister-ScheduledTask -TaskName "TransMiVoz App" -Confirm:$false
Unregister-ScheduledTask -TaskName "TransMiVoz Ollama" -Confirm:$false
```

## Después de traer cambios

```powershell
cd D:\visionaria
git pull
pnpm install
pnpm build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\instalar-servicios-transmivoz.ps1
```

El instalador reinicia las dos tareas, así que la app sirve la versión nueva.
Sin eso, el servidor sigue sirviendo la compilación anterior.
