# Guion de la presentación — viernes 2026-09-25

Cómo mostrar TransMiVoz desde el portátil, con la app servida desde la máquina
con Windows. La preparación está en el issue #5; la configuración general, en
[SELF-HOSTING.md](SELF-HOSTING.md).

## Las máquinas

| Papel | Nombre en Tailscale | IP en Tailscale |
| --- | --- | --- |
| Servidor (Windows) | `desktop-oa6r547` | `100.66.19.15` |
| Cliente (portátil Fedora) | `fedora` | `100.124.210.13` |

Tailnet: `taila37867.ts.net`

**Dirección de la demo:** `https://desktop-oa6r547.taila37867.ts.net`

## Antes de salir de casa

1. Certificados HTTPS activados en la tailnet (issue #4). Sin ellos no hay
   HTTPS, y sin HTTPS se bloquean el micrófono, la cámara y el GPS.
2. La máquina con Windows no se suspende. Configuración → Sistema →
   Energía → suspender **Nunca** mientras esté enchufada.
3. El respaldo en el portátil está compilado y probado (ver abajo).
4. Las tareas **TransMiVoz App** y **TransMiVoz Ollama** existen en la máquina
   con Windows (Programador de tareas).
5. `pnpm sync:transmilenio` corrido hace poco, para que la copia de los datos
   esté al día si el servicio de TransMilenio falla ese día.

## El día de la presentación

En la máquina con Windows, la app y su Ollama ya arrancan solos al iniciar
sesión (tareas **TransMiVoz App** y **TransMiVoz Ollama**). Solo hace falta
traer la última versión y reiniciarlas:

```powershell
cd D:\visionaria
git pull
pnpm install
pnpm build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\instalar-servicios-transmivoz.ps1
tailscale serve --bg 3000
tailscale serve status
```

En el portátil:

1. Comprueba el camino: `tailscale ping desktop-oa6r547` debe responder `pong`.
2. Abre **Chrome** (no Firefox) en `https://desktop-oa6r547.taila37867.ts.net/diagnostico`.
3. Pulsa **Probar todo** y acepta micrófono, cámara y ubicación. Deben salir
   las nueve pruebas en verde.
4. Vuelve a la app.

Firefox no tiene `SpeechRecognition`, así que los modos de voz no harían nada.

## Qué mostrar

La pantalla de diagnóstico es la prueba de que todo funciona. Después, en este
orden:

1. **Asistente** → escribe o di "cómo llego de Ricaurte a Calle 72". Se ven los
   pasos que sigue, dice la respuesta y abre el plan de viaje en el mapa.
2. **Asistente** → "cómo llego de Portal Norte a Portal Usme". No hay ruta
   directa: propone un transbordo y dibuja los dos buses.
3. **Asistente** → "¿a qué hora pasa la H54?". Lee el horario real.
4. **Rutas** → busca "A52" → abre el detalle: recorrido en el mapa, 25
   estaciones y horarios. Toca **Guardar** y muéstrala en **Rutas frecuentes**.
   No uses la B23, la H54 ni la M83: ya vienen guardadas, y tocar el botón
   las quitaría.
5. **Mapa y GPS** → activa la ubicación → estaciones más cercanas en el mapa →
   **Guíame por voz**.
6. **Lupa** → cámara con zoom y filtros de contraste.
7. **Menú** → **Ceguera total** → toca la pantalla y habla.
8. **Alto contraste** en el inicio del modo baja visión.

## Frases que funcionan bien

Medidas con los datos reales:

| Frase | Resultado |
| --- | --- |
| "cómo llego de Ricaurte a Calle 72" | Directa: A52, 13 estaciones; también A60 y A61 |
| "cómo llego de Portal Usme a Molinos" | Directa: B72, 2 estaciones |
| "de Calle 100 a Museo del Oro" | Directa: J70, 15 estaciones |
| "cómo llego de Portal Norte a Portal Usme" | Transbordo: 8 G hasta Toberín y luego H72 |
| "información de la B23" | Recorrido: 32 estaciones y horario |
| "¿a qué hora pasa la H54?" | Horario entre semana, sábados y festivos |
| "hola" / "¿qué puedes hacer?" | Saludo y ayuda |
| "¿cuánto cuesta el pasaje?" | Dice que no tiene tarifas |

Con Ollama activo (`/diagnostico` dice "Motor: Ollama") también entiende frases
libres. Medidas en la máquina con Windows con `qwen2.5:3b`, unos 200 ms cada
una:

| Frase | Resultado |
| --- | --- |
| "necesito llegar a la Universidad Nacional saliendo desde Ricaurte" | Directa: 4 H, 4 estaciones |
| "oye, ¿me podrías decir hasta qué hora funciona la B23?" | Horario de la B23 |
| "estoy saliendo del Portal Suba y voy para el Portal Sur" | Directa: G30, 35 estaciones |
| "me gustaría saber qué buses paran en Héroes" | 29 rutas |
| "quiero ver las rutas que tengo guardadas" | Rutas frecuentes |

En la lista de pasos, "Motor: Ollama" muestra que respondió el modelo. Si sale
"Motor: reglas", el modelo no respondió a tiempo y contestaron las reglas.

Una estación sola ("quiero ir a Ricaurte") sin ubicación lista las rutas que
pasan por ahí y pide el origen. Con la ubicación activada, usa la estación más
cercana como origen.

## Si la red del campus bloquea Tailscale

En la máquina con Windows:

```powershell
tailscale funnel --bg 3000
```

Publica la app en una dirección HTTPS pública que cualquier navegador puede
abrir sin Tailscale. Necesita los mismos certificados. La app no tiene
autenticación, así que apágalo apenas termine:

```powershell
tailscale funnel --https=443 off
```

## Si nada llega a la máquina con Windows

Corre la app en el portátil, desde la carpeta del repositorio. Sin red de por
medio, salvo el mapa base.

```bash
cd ~/"Documents/Intro Ing. Sistemas/Proyecto 1/visionaria"
pnpm install
pnpm build
pnpm start
```

Chrome → `http://localhost:3000`. `localhost` es un contexto seguro, así que
funcionan todos los permisos. Si no hay internet, la app usa la copia guardada
de los datos de TransMilenio; el mapa base no carga, pero todo lo demás sí.

Esto solo sirve si ya estaba compilado. Hazlo una vez antes del viernes para
que el día sea un solo `pnpm start`.

## Bueno saberlo

- **Latencia de unos 120 ms** cuando Tailscale pasa por un relé DERP. En la
  misma red suele conectar directo y va más rápido.
- **Las estaciones de una ruta son las que quedan sobre su recorrido.** Un
  expreso no para en todas; la pantalla de la ruta lo dice.
- **No hay tiempos de llegada.** TransMilenio no publica la posición de los
  buses; la app da horarios.
