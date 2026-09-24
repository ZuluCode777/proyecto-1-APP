/**
 * Verificación de extremo a extremo: abre Chrome sin ventana, entra a
 * /diagnostico, pulsa "Probar todo" e imprime el resultado de cada prueba.
 *
 * Chrome recibe una cámara y un micrófono simulados y una ubicación fija
 * (estación Ricaurte), así que las pruebas de permisos corren sin intervención.
 * Termina con código 1 si alguna prueba falla.
 *
 * Uso:
 *   pnpm verificar                          # contra http://localhost:3000
 *   pnpm verificar https://mi-maquina.ts.net
 *   CHROME_PATH=/ruta/a/chrome pnpm verificar
 *   APP_PASSWORD=la-clave pnpm verificar https://mi-maquina.ts.net
 *
 * Con `APP_PASSWORD`, responde a la petición de clave de la app. La clave solo
 * se envía al origen que se verifica, no a los mapas ni a otros dominios.
 */
import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "")
const ORIGIN = new URL(BASE).origin
const PORT = 9333
/** Espera máxima a que Chrome abra el puerto de depuración y liste la pestaña. */
const CHROME_WAIT_MS = 30_000
const RICAURTE = { latitude: 4.6124, longitude: -74.0935, accuracy: 20 }
const PASSWORD = process.env.APP_PASSWORD

const CANDIDATES = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
]
const chromePath = CANDIDATES.find((p) => p && existsSync(p))
if (!chromePath) {
  console.error("No encontré Chrome. Indica la ruta con CHROME_PATH.")
  process.exit(2)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const profile = mkdtempSync(join(tmpdir(), "transmivoz-verificar-"))
const chrome = spawn(
  chromePath,
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--use-fake-ui-for-media-stream",
    "--use-fake-device-for-media-stream",
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ],
  { stdio: "ignore" },
)

async function main() {
  // En la integración continua el primer arranque de Chrome a veces tarda más
  // de 10 s. Se espera en cada intento, también cuando el puerto responde
  // pero la pestaña aún no aparece.
  let target
  const deadline = Date.now() + CHROME_WAIT_MS
  while (!target && Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`, { signal: AbortSignal.timeout(2000) })
      target = (await res.json()).find((p) => p.type === "page")
    } catch {
      // Puerto cerrado, sin respuesta o con una respuesta aún inválida.
    }
    if (!target) await sleep(200)
  }
  if (!target) throw new Error("Chrome no abrió una pestaña en el puerto de depuración.")

  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
  let nextId = 1
  const waiting = new Map()
  // Peticiones a las que ya se dio la clave. Si la app la vuelve a pedir, la
  // clave es incorrecta: se cancela en vez de repetirla sin fin.
  const answered = new Set()
  let passwordRejected = false
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && waiting.has(msg.id)) {
      waiting.get(msg.id)(msg)
      waiting.delete(msg.id)
    }
    // Con Fetch activo, Chrome detiene cada petición al origen hasta que se
    // continúa, y pregunta qué hacer cuando la app pide la clave.
    const requestId = msg.params?.requestId
    if (msg.method === "Fetch.requestPaused") send("Fetch.continueRequest", { requestId }).catch(() => undefined)
    if (msg.method === "Fetch.authRequired") {
      const retry = answered.has(requestId)
      answered.add(requestId)
      if (retry) passwordRejected = true
      send("Fetch.continueWithAuth", {
        requestId,
        authChallengeResponse: retry
          ? { response: "CancelAuth" }
          : { response: "ProvideCredentials", username: "verificar", password: PASSWORD },
      }).catch(() => undefined)
    }
  }
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++
      waiting.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)))
      ws.send(JSON.stringify({ id, method, params }))
    })
  const evaluate = async (expression) =>
    (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value

  if (PASSWORD) {
    await send("Fetch.enable", { handleAuthRequests: true, patterns: [{ urlPattern: `${ORIGIN}/*` }] })
  }
  await send("Browser.grantPermissions", {
    origin: ORIGIN,
    permissions: ["geolocation", "audioCapture", "videoCapture"],
  }).catch(() => undefined)
  await send("Emulation.setGeolocationOverride", RICAURTE)
  await send("Page.enable")
  await send("Page.navigate", { url: `${BASE}/diagnostico` })

  for (let i = 0; i < 50; i++) {
    if (passwordRejected || (await evaluate(`!!document.querySelector("[data-ready]")`))) break
    await sleep(200)
  }
  if (passwordRejected) throw new Error("La app rechazó la clave de APP_PASSWORD.")
  await evaluate(`[...document.querySelectorAll("button")].find(b => b.innerText.trim() === "Probar todo").click()`)

  // Espera a que ninguna prueba siga pendiente.
  let rows = []
  for (let i = 0; i < 120; i++) {
    await sleep(500)
    rows = await evaluate(`[...document.querySelectorAll("li")].map(li => ({
      title: li.querySelector("h2").innerText,
      detail: li.querySelector("p.mt-1")?.innerText ?? "",
      state: li.dataset.state === "ok" || li.dataset.state === "fail" ? li.dataset.state : "pending",
    }))`)
    if (rows.length && rows.every((r) => r.state !== "pending")) break
  }

  console.log(`\nVerificación de TransMiVoz en ${BASE}\n`)
  for (const r of rows) {
    const mark = r.state === "ok" ? "✔" : r.state === "fail" ? "✖" : "…"
    console.log(`${mark} ${r.title}\n    ${r.detail.replace(/^(Correcto|Falló):\s*/, "") || "(sin resultado)"}`)
  }
  const ok = rows.filter((r) => r.state === "ok").length
  console.log(`\n${ok} de ${rows.length} pruebas correctas.`)
  ws.close()
  return ok === rows.length && rows.length > 0
}

main()
  .then((passed) => finish(passed ? 0 : 1))
  .catch((error) => {
    console.error(error)
    finish(2)
  })

function finish(code) {
  chrome.once("exit", () => {
    rmSync(profile, { recursive: true, force: true, maxRetries: 5 })
    process.exit(code)
  })
  chrome.kill()
}
