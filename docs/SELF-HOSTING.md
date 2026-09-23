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

```powershell
git clone https://github.com/zulucode-design/visionaria
cd visionaria
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

Con Ollama en la misma máquina, el asistente puede usar un modelo local para
entender frases que las reglas no cubren.

```powershell
ollama pull llama3.2
copy .env.example .env.local
```

Edita `.env.local` y pon `OLLAMA_MODEL=llama3.2`. Después vuelve a compilar y
arrancar:

```powershell
pnpm build
pnpm start
```

`/diagnostico` muestra qué motor está usando el asistente y si Ollama responde.
Si Ollama se cae, el asistente sigue funcionando con las reglas.

Ollama escucha por defecto solo en `127.0.0.1:11434`. Como la app corre en la
misma máquina, no hace falta abrir ese puerto a la red.

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
   - Iniciar en: la carpeta del repositorio, por ejemplo `C:\Users\tu-usuario\visionaria`
5. Configuración → desmarca **Detener la tarea si se ejecuta durante más de**.

Apunta la tarea directamente a `node.exe` y no a pnpm, para que no haya un
intérprete de comandos entre el programador y el servidor.

`tailscale serve --bg` ya persiste entre reinicios, no necesita su propia
tarea.

## Después de traer cambios

```powershell
git pull
pnpm install
pnpm build
```

Luego reinicia la tarea (Programador de tareas → clic derecho → Finalizar, y
luego Ejecutar). El servidor sigue sirviendo la versión anterior hasta que se
reinicia.
