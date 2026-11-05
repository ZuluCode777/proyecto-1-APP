import assert from "node:assert/strict"
import http from "node:http"
import type { AddressInfo } from "node:net"
import test from "node:test"
import { verificar } from "../scripts/verificar-ea10-http.mjs"

/**
 * Regresión de EA-10 (#36) sobre el CICLO DE VIDA de `scripts/verificar-ea10-http.mjs`.
 * Dos revisiones demostraron que el script antiguo salía con 0 aunque su hijo
 * `next start` fallara por `EADDRINUSE`, porque aceptaba la respuesta de otro
 * servidor ya instalado en el puerto. Aquí el «servidor» es un proceso Node
 * mínimo (no Next) que simula cada situación, y se comprueba que el verificador:
 * falla sin clave o con el puerto ocupado SIN lanzar nada ni tocar al ocupante,
 * falla si su hijo muere o no responde, acota cada petición con plazo, y al
 * terminar deja muerto su PID aunque ignore SIGTERM. Con un servidor correcto,
 * da 0 (el caso de referencia que evita un falso rojo).
 */

const CLAVE = "clave-de-prueba"

/**
 * Código del servidor falso que ejecuta `node -e`. Argumentos: puerto, clave, modo.
 * - `ok`: se comporta como la app (401 sin credencial, 200 con la correcta; 413 al
 *   pasar de la cota en `POST /api/agent`).
 * - `muere-en-post`: como `ok`, pero termina el proceso al llegar el POST.
 * - `calla-en-get`: acepta la conexión y nunca responde a `GET`.
 * - `calla-en-post`: como `ok`, pero nunca responde al POST.
 * - `ignora-sigterm`: no escucha ni dice «Ready»; ignora SIGTERM.
 * - `falla-pronto`: sale con error sin escuchar.
 */
const SERVIDOR_FALSO = `
const http = require("node:http")
const [puerto, clave, modo] = process.argv.slice(1)
const esperada = "Basic " + Buffer.from("u:" + clave).toString("base64")
if (modo === "falla-pronto") setTimeout(() => process.exit(1), 150)
else if (modo === "ignora-sigterm") { process.on("SIGTERM", () => {}); setInterval(() => {}, 1000) }
else {
  http.createServer((req, res) => {
    if (modo === "calla-en-get" && req.method === "GET") return
    if (req.method === "POST" && req.headers.authorization === esperada) {
      if (modo === "muere-en-post") process.exit(3)
      if (modo === "calla-en-post") return
      let bytes = 0
      req.on("data", (d) => { bytes += d.length; if (bytes > 4000 && !res.headersSent) { res.statusCode = 413; res.end("grande") } })
      return
    }
    res.statusCode = req.headers.authorization === esperada ? 200 : 401
    res.end("x")
  }).listen(Number(puerto), "127.0.0.1", () => console.log("Ready in 1ms"))
}
`

/** Puerto libre de loopback. */
async function puertoDisponible(): Promise<number> {
  const servidor = http.createServer()
  await new Promise<void>((r) => servidor.listen(0, "127.0.0.1", r))
  const { port } = servidor.address() as AddressInfo
  await new Promise<void>((r) => servidor.close(() => r()))
  return port
}

function estaVivo(pid: number | undefined): boolean {
  if (pid === undefined) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** Ejecuta el verificador contra el servidor falso en el modo dado, capturando mensajes. */
async function ejecutar(modo: string, extra: Partial<Parameters<typeof verificar>[0]> = {}) {
  const puerto = extra.puerto ?? (await puertoDisponible())
  const errores: string[] = []
  const resultado = await verificar({
    clave: CLAVE,
    puerto,
    args: ["-e", SERVIDOR_FALSO, String(puerto), CLAVE, modo],
    rutaEstatica: "/_next/static/chunks/existente.js",
    plazoArranqueMs: 3_000,
    plazoPeticionMs: 1_000,
    graciaMs: 300,
    salida: { log: () => {}, error: (m: string) => void errores.push(m) },
    ...extra,
  })
  return { ...resultado, errores: errores.join("\n") }
}

test("servidor correcto: devuelve 0 y no deja su proceso vivo", async () => {
  const r = await ejecutar("ok")
  assert.equal(r.codigo, 0, r.errores)
  assert.ok(r.pidHijo !== undefined)
  assert.equal(estaVivo(r.pidHijo), false, "el PID lanzado salió de verdad")
})

test("sin clave utilizable falla antes de lanzar nada", async () => {
  for (const clave of [undefined, "", "   "]) {
    const r = await ejecutar("ok", { clave })
    assert.equal(r.codigo, 1, `clave=${JSON.stringify(clave)}`)
    assert.equal(r.pidHijo, undefined, "no se lanzó ningún proceso")
    assert.match(r.errores, /APP_PASSWORD/)
  }
})

test("puerto ocupado: falla sin lanzar nada y sin tocar al ocupante (que sigue vivo)", async () => {
  let peticionesAlOcupante = 0
  const ocupante = http.createServer((req, res) => {
    peticionesAlOcupante++
    res.statusCode = req.method === "POST" ? 413 : 401 // lo que un falso verde necesitaría
    res.end()
  })
  await new Promise<void>((r) => ocupante.listen(0, "127.0.0.1", r))
  const { port } = ocupante.address() as AddressInfo
  try {
    const r = await ejecutar("ok", { puerto: port })
    assert.equal(r.codigo, 1)
    assert.equal(r.pidHijo, undefined, "no se lanzó ningún proceso")
    assert.match(r.errores, /ocupado/)
    assert.equal(peticionesAlOcupante, 0, "no se le envió ninguna petición")
    assert.equal(ocupante.listening, true, "el ocupante sigue escuchando")
  } finally {
    await new Promise<void>((r) => ocupante.close(() => r()))
  }
})

test("el hijo falla por puerto ocupado DESPUÉS de la sonda: otro servidor responde 401/413 y aun así falla", async () => {
  const ocupante = http.createServer((req, res) => {
    res.statusCode = req.method === "POST" ? 413 : 401
    res.end()
  })
  await new Promise<void>((r) => ocupante.listen(0, "127.0.0.1", r))
  const { port } = ocupante.address() as AddressInfo
  try {
    // La sonda se simula libre para reproducir la carrera entre sonda y arranque.
    const r = await ejecutar("falla-pronto", { puerto: port, comprobarPuerto: async () => true })
    assert.equal(r.codigo, 1, "no acepta las respuestas del servidor ajeno")
    assert.match(r.errores, /terminó antes de tiempo/)
    assert.equal(estaVivo(r.pidHijo), false)
  } finally {
    await new Promise<void>((r) => ocupante.close(() => r()))
  }
})

test("el hijo muere durante la prueba: falla y no queda vivo", async () => {
  const r = await ejecutar("muere-en-post")
  // El mensaje depende de qué llegue antes, el socket cortado o la salida; basta el fallo.
  assert.equal(r.codigo, 1)
  assert.equal(estaVivo(r.pidHijo), false)
})

test("hijo que no responde a GET: falla por plazo de arranque, acotado, sin dejar el hijo vivo", async () => {
  const inicio = Date.now()
  const r = await ejecutar("calla-en-get", { plazoArranqueMs: 800, plazoPeticionMs: 300 })
  assert.equal(r.codigo, 1)
  assert.ok(Date.now() - inicio < 4_000, "la petición colgada no alarga la espera sin límite")
  assert.equal(estaVivo(r.pidHijo), false)
})

test("hijo que no responde al POST chunked: falla por plazo de la petición", async () => {
  const inicio = Date.now()
  const r = await ejecutar("calla-en-post", { plazoPeticionMs: 400 })
  assert.equal(r.codigo, 1)
  assert.match(r.errores, /sin respuesta a POST/)
  assert.ok(Date.now() - inicio < 4_000)
  assert.equal(estaVivo(r.pidHijo), false)
})

test("sin recurso estático existente que comprobar: falla (no da por buena la ausencia)", async () => {
  const r = await ejecutar("ok", { rutaEstatica: undefined })
  assert.equal(r.codigo, 1)
  assert.match(r.errores, /estático/)
})

test("hijo que ignora SIGTERM: se escala a SIGKILL sobre su PID y se espera su salida", async () => {
  const r = await ejecutar("ignora-sigterm", { plazoArranqueMs: 300 })
  assert.equal(r.codigo, 1)
  assert.equal(estaVivo(r.pidHijo), false, "SIGKILL lo terminó y se esperó la salida")
})
