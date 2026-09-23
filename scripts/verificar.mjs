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
 */
import { spawn } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "")
const PORT = 9333
const RICAURTE = { latitude: 4.6124, longitude: -74.0935, accuracy: 20 }

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
  // Espera a que Chrome abra el puerto de depuración.
  let target
  for (let i = 0; i < 50 && !target; i++) {
    try {
      const pages = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      target = pages.find((p) => p.type === "page")
    } catch {
      await sleep(200)
    }
  }
  if (!target) throw new Error("Chrome no respondió en el puerto de depuración.")

  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
  })
  let nextId = 1
  const waiting = new Map()
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && waiting.has(msg.id)) {
      waiting.get(msg.id)(msg)
      waiting.delete(msg.id)
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

  await send("Browser.grantPermissions", {
    origin: new URL(BASE).origin,
    permissions: ["geolocation", "audioCapture", "videoCapture"],
  }).catch(() => undefined)
  await send("Emulation.setGeolocationOverride", RICAURTE)
  await send("Page.enable")
  await send("Page.navigate", { url: `${BASE}/diagnostico` })

  for (let i = 0; i < 50; i++) {
    if (await evaluate(`!!document.querySelector("[data-ready]")`)) break
    await sleep(200)
  }
  await evaluate(`[...document.querySelectorAll("button")].find(b => b.innerText.trim() === "Probar todo").click()`)

  // Espera a que ninguna prueba siga pendiente.
  let rows = []
  for (let i = 0; i < 120; i++) {
    await sleep(500)
    rows = await evaluate(`[...document.querySelectorAll("li")].map(li => ({
      title: li.querySelector("h2").innerText,
      detail: li.querySelector("p.mt-1")?.innerText ?? "",
      state: li.querySelector("svg.text-green-700") ? "ok" : li.querySelector("svg.text-emergency") ? "fail" : "pending",
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
