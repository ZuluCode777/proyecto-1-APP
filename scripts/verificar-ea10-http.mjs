/**
 * Verificación HTTP local de EA-10 (#36), hallazgo P1 del límite de ingreso.
 *
 * Arranca el servidor de PRODUCCIÓN de Next (`next start`) en un puerto libre y
 * envía a `POST /api/agent` un cuerpo FRAGMENTADO con `Transfer-Encoding:
 * chunked` que supera la cota de bytes, SIN terminar de enviarlo. Comprueba que
 * el servidor responde **413** antes de que el cliente acabe la carga: la prueba
 * del contrato de que `/api/agent` está excluido del clon del `proxy` (Next no
 * almacena su cuerpo hasta `finalize`) y la cota por stream actúa sobre el
 * cuerpo real.
 *
 * No es parte de `pnpm test` (necesita un servidor vivo). Uso:
 *   APP_PASSWORD=… node scripts/verificar-ea10-http.mjs   # con clave
 *   node scripts/verificar-ea10-http.mjs                  # sin clave (dev)
 *
 * Termina con código 0 si el 413 llega sin completar el envío; 1 si no.
 */
import { spawn } from "node:child_process"
import http from "node:http"

const PUERTO = Number(process.env.PUERTO_EA10 ?? 3218)
const CLAVE = process.env.APP_PASSWORD
const ARRANQUE_MAX_MS = 60_000

/** Cabecera Basic si hay clave (usuario cualquiera). */
const autorizacion = CLAVE ? "Basic " + Buffer.from("u:" + CLAVE).toString("base64") : undefined

const servidor = spawn("node", ["node_modules/next/dist/bin/next", "start", "-p", String(PUERTO)], {
  cwd: process.cwd(),
  env: { ...process.env, NODE_ENV: "production" },
  stdio: ["ignore", "pipe", "pipe"],
})
let log = ""
servidor.stdout.on("data", (d) => (log += d))
servidor.stderr.on("data", (d) => (log += d))

const dormir = (ms) => new Promise((r) => setTimeout(r, ms))

/** Espera a que el puerto responda (cualquier código HTTP sirve). */
async function esperarServidor() {
  const limite = Date.now() + ARRANQUE_MAX_MS
  while (Date.now() < limite) {
    const vivo = await new Promise((resolve) => {
      const req = http.request({ host: "127.0.0.1", port: PUERTO, path: "/", method: "GET", headers: autorizacion ? { authorization: autorizacion } : {} }, (res) => {
        res.resume()
        resolve(true)
      })
      req.on("error", () => resolve(false))
      req.end()
    })
    if (vivo) return true
    await dormir(500)
  }
  return false
}

/**
 * Envía un POST con cuerpo chunked que NO se termina de enviar. Resuelve cuando
 * llega la respuesta (esperamos 413) o cuando el cliente ya mandó mucho más que
 * la cota sin recibir respuesta (fallo). Devuelve { status, bytesEnviados }.
 */
function postChunkedSinTerminar() {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: PUERTO,
        path: "/api/agent",
        method: "POST",
        headers: {
          "content-type": "application/json",
          "transfer-encoding": "chunked",
          ...(autorizacion ? { authorization: autorizacion } : {}),
        },
      },
      (res) => {
        res.resume()
        resolve({ status: res.statusCode, bytesEnviados })
      },
    )
    req.on("error", reject)

    // Empieza un JSON válido y va mandando relleno en trozos pequeños, con pausas,
    // sin cerrar el cuerpo. Supera de sobra la cota (4000 bytes).
    let bytesEnviados = 0
    req.write('{"message":"')
    bytesEnviados += 12
    let trozos = 0
    const temporizador = setInterval(() => {
      const trozo = "a".repeat(500)
      req.write(trozo)
      bytesEnviados += trozo.length
      trozos++
      // Si tras muy por encima de la cota aún no hubo respuesta, abortamos: fallo.
      if (trozos > 40) {
        clearInterval(temporizador)
        req.destroy()
        resolve({ status: 0, bytesEnviados })
      }
    }, 50)

    // Cuando llegue la respuesta, dejamos de enviar.
    req.on("response", () => clearInterval(temporizador))
  })
}

/** GET/POST/HEAD simple a una ruta SIN credenciales; devuelve el código. */
function sinCredencial(metodo, ruta) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port: PUERTO, path: ruta, method: metodo }, (res) => {
      res.resume()
      resolve(res.statusCode)
    })
    req.on("error", reject)
    if (metodo === "POST") req.write(JSON.stringify({ message: "hola" }))
    req.end()
  })
}

async function principal() {
  const arrancó = await esperarServidor()
  if (!arrancó) {
    console.error("No arrancó el servidor en el plazo. Log:\n" + log.slice(-1000))
    return 1
  }

  let ok = true

  // 1) Con clave configurada: sin credencial, la API excluida del proxy y la UI
  //    protegida por el proxy deben pedir clave (401). No hay hueco por la exclusión.
  if (CLAVE) {
    const apiGet = await sinCredencial("GET", "/api/agent")
    const apiPost = await sinCredencial("POST", "/api/agent")
    const ui = await sinCredencial("GET", "/")
    const variante = await sinCredencial("GET", "/api/transmilenio")
    console.log(`Sin credencial → /api/agent GET:${apiGet} POST:${apiPost}, / :${ui}, /api/transmilenio:${variante}`)
    for (const [nombre, codigo] of [["api GET", apiGet], ["api POST", apiPost], ["UI", ui], ["otra API", variante]]) {
      if (codigo !== 401) {
        console.error(`FALLO: ${nombre} sin credencial debería ser 401; fue ${codigo}.`)
        ok = false
      }
    }
  }

  // 2) 413 por cuerpo chunked que supera la cota, sin terminar de enviarlo.
  const { status, bytesEnviados } = await postChunkedSinTerminar()
  console.log(`Chunked sin terminar → HTTP ${status} tras ~${bytesEnviados} bytes (cota 4000).`)
  if (status !== 413) {
    console.error(`FALLO: se esperaba 413; se obtuvo ${status}.`)
    ok = false
  } else {
    console.log("OK: 413 llegó sin completar el envío del cuerpo.")
  }

  return ok ? 0 : 1
}

let codigo = 1
try {
  codigo = await principal()
} catch (e) {
  console.error("Error en la verificación:", e)
  codigo = 1
} finally {
  servidor.kill("SIGTERM")
  await dormir(300)
  if (!servidor.killed) servidor.kill("SIGKILL")
}
process.exit(codigo)
