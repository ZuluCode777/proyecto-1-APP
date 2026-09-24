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
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\instalar-ollama-transmivoz.ps1
```

`instalar-ollama-transmivoz.ps1` crea la tarea programada **TransMiVoz Ollama**,
que arranca `scripts\ollama-transmivoz.ps1` al iniciar sesión, y la arranca en
ese momento. No necesita permisos de administrador. Termina diciendo
"Ollama de TransMiVoz escuchando en 127.0.0.1:11435".

Después, en `D:\visionaria\.env.local`:

```
OLLAMA_MODEL=qwen2.5:3b
OLLAMA_BASE_URL=http://127.0.0.1:11435
```

y vuelve a compilar y arrancar:

```powershell
pnpm build
pnpm start
```

`/diagnostico` muestra "Motor: Ollama (qwen2.5:3b)" cuando el modelo contestó
de verdad. Si Ollama está configurado pero no respondió, lo dice.

Cargar el modelo en la GPU tarda unos segundos. El servidor lo precarga al
arrancar y al abrir `/diagnostico`, y Ollama lo mantiene una hora en memoria.
Si aun así tarda más de 8 s, o se cae, el asistente responde con las reglas;
la persona nunca se queda esperando.

Las dos instancias escuchan solo en `127.0.0.1`. Como la app corre en la misma
máquina, no hace falta abrir esos puertos a la red.

Para quitar la instancia propia:

```powershell
Unregister-ScheduledTask -TaskName "TransMiVoz Ollama" -Confirm:$false
```

## Abrir la app desde otro dispositivo

`next start` escucha en `0.0.0.0` por defecto, así que
`http://<ip-de-la-red>:3000` sirve la página a otro equipo de la misma red.
**Pero la app no funciona así.** HTTP simple sobre una IP de la red no es un
contexto seguro, y el navegador bloquea el micrófono, la cámara y la
ubicación. Queda la página sin ninguna función.

Usa Tailscale. Sirve la app por HTTPS con un certificado válido en un nombre
`ts.net`, que sí es un contexto seguro:

```powershell
# la app solo en loopback, para no exponerla en la red local
pnpm exec next start -H 127.0.0.1 -p 3000

# en otra terminal, publicarla en la tailnet por HTTPS
tailscale serve --bg 3000
tailscale serve status
```

La app queda en `https://<máquina>.<tailnet>.ts.net`, accesible desde
cualquier dispositivo conectado a la misma tailnet, con los permisos
funcionando.

Hace falta tener **MagicDNS** y **HTTPS Certificates** activados en la consola
de administración de Tailscale, en DNS. Sin eso no hay certificado.

Para publicarla en internet y no solo en la tailnet, cambia `serve` por
`funnel`:

```powershell
tailscale funnel --bg 3000
```

Hazlo solo para una demostración y apágalo después con
`tailscale funnel --https=443 off`. La app no tiene autenticación.

## Que siga corriendo

`pnpm start` se detiene al cerrar la terminal. Para que sobreviva al cierre de
sesión y a los reinicios, usa el Programador de tareas, sin instalar nada:

1. Programador de tareas → **Crear tarea** (no "tarea básica").
2. General → **Ejecutar tanto si el usuario inició sesión como si no**.
3. Desencadenadores → Nuevo → **Al iniciar el sistema**.
4. Acciones → Nueva → Iniciar un programa:
   - Programa: `C:\Program Files\nodejs\node.exe`
   - Argumentos: `node_modules\next\dist\bin\next start -H 127.0.0.1 -p 3000`
   - Iniciar en: `D:\visionaria`
5. Configuración → desmarca **Detener la tarea si se ejecuta durante más de**.

Apunta la tarea directamente a `node.exe` y no a pnpm, para que no haya un
intérprete de comandos entre el programador y el servidor.

`tailscale serve --bg` ya persiste entre reinicios, no necesita su propia
tarea.

## Después de traer cambios

```powershell
cd D:\visionaria
git pull
pnpm install
pnpm build
```

Luego reinicia la tarea (Programador de tareas → clic derecho → Finalizar, y
luego Ejecutar). El servidor sigue sirviendo la versión anterior hasta que se
reinicia.
