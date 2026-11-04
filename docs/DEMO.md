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

1. **Asistente** → escribe o di "información de la B23". Se ven los pasos que
   sigue, dice el recorrido y el horario, y abre el detalle de la ruta.
2. **Asistente** → "cómo llego de Ricaurte a Calle 72". Con el catálogo actual
   (sin paradas verificadas, EA-05) NO prescribe un plan: responde con una
   abstención honesta —«Todavía no tengo confirmado dónde para cada servicio
   entre Ricaurte y Calle 72…»— y ofrece el recorrido de las rutas que pasan
   cerca. Lo mismo con "cómo llego de Portal Norte a Portal Usme".
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

Salidas REALES del código actual, con las reglas locales (sin Ollama) sobre la
copia guardada del catálogo (`data/transmilenio.json`, consultada el
2026-09-24). Con el catálogo en vivo, cifras como «29 rutas» o «47 rutas» pueden
variar. Tras EA-05, un viaje solo da indicaciones de abordaje si la fuente
confirma las paradas; el catálogo de hoy no las tiene, así que los «cómo llego»
responden con una ABSTENCIÓN honesta (acción de búsqueda que abre el recorrido),
no con un plan prescriptivo. Ejecutadas una por una el 2026-11-04:

| Frase | Resultado real actual |
| --- | --- |
| "información de la B23" | Recorrido: va de Portal El Dorado hacia Alcalá, ~32 estaciones y horario publicado |
| "¿a qué hora pasa la H54?" | Horario publicado (entre semana, sábados, festivos); avisa que no es calendario verificado |
| "me gustaría saber qué buses paran en Héroes" | Lista 29 rutas por el recorrido; pide origen para un viaje |
| "quiero ir a Ricaurte" | Lista 47 rutas que pasan por Ricaurte; pide desde dónde sales |
| "quiero ver las rutas que tengo guardadas" | Abre rutas frecuentes |
| "hola" / "¿qué puedes hacer?" | Saludo y ayuda |
| "¿cuánto cuesta el pasaje?" | Dice que no tiene tarifas |
| "cómo llego de Ricaurte a Calle 72" | Abstención: «Todavía no tengo confirmado dónde para cada servicio entre Ricaurte y Calle 72…»; ofrece el recorrido de las rutas que conectan |
| "cómo llego de Portal Norte a Portal Usme" | Abstención análoga; sin un plan de abordaje mientras falten paradas verificadas |

Las reglas interpretan PRIMERO; todas estas frases las resuelven las reglas, así
que en la lista de pasos sale "Motor: reglas". Eso es lo normal y no significa
que Ollama fallara: el modelo solo se consulta cuando las reglas no reconocen la
frase.

**Ninguna frase de esta demo pasa por el modelo** (todas las entienden las
reglas). Una frase que las reglas NO entienden, p. ej. «explícame la teoría de la
relatividad por favor», hoy da «No te entendí…» con las reglas; con Ollama activo
iría al modelo, pero **ese resultado con un Ollama real no se ha medido** en esta
tarea. "Motor: Ollama" en la lista de pasos solo aparece en ese caso. Para
confirmar que Ollama está sano, usa `/diagnostico`: la prueba del asistente
comprueba su salud (alcanzable y con el modelo) con `GET /api/agent`, no
clasificando una frase, así que no da falsos fallos.

Una estación sola ("quiero ir a Ricaurte") sin ubicación lista las rutas que
pasan por ahí y pide el origen. Con la ubicación activada, usa la estación más
cercana como origen.

## Si la red del campus bloquea Tailscale

La app ya está publicada con Tailscale Funnel, así que cualquier navegador la
abre sin Tailscale en la misma dirección. Pide la clave de `APP_PASSWORD`; el
usuario puede ser cualquiera. Ver
[SELF-HOSTING.md](SELF-HOSTING.md#publicarla-en-internet-con-funnel).

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
