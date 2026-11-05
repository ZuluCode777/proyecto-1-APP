/**
 * Verificación HTTP local de EA-10 (#36), hallazgo P1 del límite de ingreso.
 *
 * Arranca el servidor de PRODUCCIÓN de Next (`next start`, solo en 127.0.0.1) y
 * comprueba, contra ese proceso y no contra otro:
 *
 * - `POST /api/agent` con cuerpo FRAGMENTADO (`Transfer-Encoding: chunked`) que
 *   supera la cota de bytes, SIN terminar de enviarlo, recibe **413** antes de
 *   que el cliente acabe la carga: `/api/agent` está excluido del `proxy` (Next
 *   no almacena su cuerpo) y la cota actúa sobre el cuerpo real.
 * - Sin credencial, la API excluida del `proxy`, otra API, la UI y un recurso
 *   estático existente de Next dan 401; con la clave correcta, 200.
 * - Redirecciones sin fuga de credenciales: `GET /api/agent/` sin credencial da
 *   308 (la barra final la resuelve Next ANTES del `proxy` y de la guardia) con
 *   `Location: /api/agent` relativo y sin `Set-Cookie`; `GET //evil.com/` da 308
 *   a `/evil.com/`, no a un destino con host. No se siguen redirecciones.
 *
 * No es parte de `pnpm test` (necesita `pnpm build` previo). Uso, desde
 * `visionaria/`, con la clave OBLIGATORIA (el script fuerza `NODE_ENV=production`,
 * donde sin clave la app responde 503 por diseño):
 *
 *   APP_PASSWORD=… node scripts/verificar-ea10-http.mjs
 *   PUERTO_EA10=3300 APP_PASSWORD=… node scripts/verificar-ea10-http.mjs
 *
 * Termina con código 0 solo si TODO se cumple; 1 en cualquier otro caso.
 *
 * Seguridad del ciclo de vida: no arranca si el puerto está ocupado; da por
 * válido el servidor solo si el proceso que lanzó este script imprime su señal
 * de listo y sigue vivo durante toda la prueba; y al terminar detiene
 * únicamente ese PID (SIGTERM, y SIGKILL si no sale a tiempo), nunca por nombre.
 */
import { spawn } from "node:child_process"
import { readdirSync } from "node:fs"
import http from "node:http"
import net from "node:net"
import { pathToFileURL } from "node:url"

const COTA_BYTES = 4000

/**
 * @typedef {object} OpcionesVerificacion
 * @property {string | undefined} clave Clave de la app; hace falta una utilizable.
 * @property {number} puerto Puerto de loopback.
 * @property {string} [comando] Ejecutable del servidor (por defecto, Node).
 * @property {string[]} [args] Argumentos del servidor (por defecto, `next start`).
 * @property {string} [rutaEstatica] Recurso estático existente que debe pedir clave.
 * @property {number} [plazoArranqueMs] Plazo para que el servidor propio esté listo.
 * @property {number} [plazoPeticionMs] Plazo de CADA petición HTTP.
 * @property {number} [graciaMs] Espera tras SIGTERM antes de SIGKILL.
 * @property {RegExp} [senalListo] Línea del servidor que indica que ya escucha.
 * @property {() => Promise<boolean>} [comprobarPuerto] Sustituible solo en pruebas.
 * @property {Pick<Console, "log" | "error">} [salida] Destino de los mensajes.
 */

/** ¿Se puede escuchar en 127.0.0.1:puerto? (falso si está ocupado) */
export function puertoLibre(puerto) {
  return new Promise((resolve) => {
    const sonda = net.createServer()
    sonda.once("error", () => resolve(false))
    sonda.listen(puerto, "127.0.0.1", () => sonda.close(() => resolve(true)))
  })
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms))

/** Cabecera Basic con un usuario cualquiera. */
const basic = (clave) => "Basic " + Buffer.from("u:" + clave).toString("base64")

/**
 * Lanza el servidor y expone su estado real: `salio` (ya terminó), `caido`
 * (promesa que RECHAZA si termina o falla antes de que lo detengamos nosotros),
 * `terminado` (resuelve al salir de verdad) y `listo` (imprimió su señal).
 */
function lanzarServidor({ comando, args, env, senalListo }) {
  const proceso = spawn(comando, args, { env, stdio: ["ignore", "pipe", "pipe"] })
  const hijo = { proceso, salio: false, listo: false, log: "", detenidoPorNosotros: false }
  let rechazarCaido
  hijo.caido = new Promise((_, rechazar) => (rechazarCaido = rechazar))
  hijo.caido.catch(() => {}) // se consume vía carrera; evita rechazo sin manejar
  hijo.terminado = new Promise((resolver) => {
    const alSalir = (causa) => {
      hijo.salio = true
      resolver()
      if (!hijo.detenidoPorNosotros) rechazarCaido(new Error(`el servidor lanzado terminó antes de tiempo (${causa})`))
    }
    proceso.once("exit", (codigo, senal) => alSalir(`código ${codigo}, señal ${senal}`))
    proceso.once("error", (e) => alSalir(`error al lanzar: ${e.message}`))
  })
  const alDato = (d) => {
    hijo.log = (hijo.log + d).slice(-2000)
    if (senalListo.test(hijo.log)) hijo.listo = true
  }
  proceso.stdout.on("data", alDato)
  proceso.stderr.on("data", alDato)
  return hijo
}

/** Detiene SOLO el PID lanzado y espera su salida real; SIGKILL si no sale en la gracia. */
async function detenerServidor(hijo, graciaMs) {
  hijo.detenidoPorNosotros = true
  if (hijo.salio || hijo.proceso.pid === undefined) return
  hijo.proceso.kill("SIGTERM")
  let plazo
  const salio = await Promise.race([
    hijo.terminado.then(() => true),
    new Promise((r) => (plazo = setTimeout(() => r(false), graciaMs))),
  ])
  clearTimeout(plazo)
  if (salio) return
  hijo.proceso.kill("SIGKILL")
  await hijo.terminado
}

/** Petición simple con plazo TOTAL y cancelable; devuelve estado, `location` y `set-cookie`. Sin seguir redirecciones. */
function consulta({ puerto, metodo = "GET", ruta, autorizacion, plazoMs, senal }) {
  return new Promise((resolver, rechazar) => {
    const plazo = setTimeout(() => req.destroy(new Error(`sin respuesta a ${metodo} ${ruta} en ${plazoMs} ms`)), plazoMs)
    const req = http.request(
      { host: "127.0.0.1", port: puerto, path: ruta, method: metodo, agent: false, signal: senal, headers: autorizacion ? { authorization: autorizacion } : {} },
      (res) => {
        res.resume()
        clearTimeout(plazo)
        resolver({ estado: res.statusCode, location: res.headers.location, setCookie: res.headers["set-cookie"] })
      },
    )
    req.on("error", (e) => {
      clearTimeout(plazo)
      rechazar(e)
    })
    if (metodo === "POST") req.write(JSON.stringify({ message: "hola" }))
    req.end()
  })
}

/**
 * POST con cuerpo chunked que NO se termina de enviar. Resuelve con la respuesta
 * (se espera 413) o, si tras mucho más que la cota no hubo respuesta, con
 * `status: 0`. Rechaza si no hay respuesta en `plazoMs`. Siempre limpia su
 * temporizador y su socket.
 */
function postChunkedSinTerminar({ puerto, autorizacion, plazoMs, senal }) {
  return new Promise((resolver, rechazar) => {
    let bytesEnviados = 0
    let trozos = 0
    const terminar = (accion) => {
      clearInterval(temporizador)
      clearTimeout(plazo)
      req.destroy()
      accion()
    }
    const req = http.request(
      {
        host: "127.0.0.1",
        port: puerto,
        path: "/api/agent",
        method: "POST",
        agent: false,
        signal: senal,
        headers: { "content-type": "application/json", "transfer-encoding": "chunked", authorization: autorizacion },
      },
      (res) => {
        res.on("error", () => {}) // destruir el socket tras responder aborta el cuerpo de la respuesta
        res.resume()
        terminar(() => resolver({ status: res.statusCode, bytesEnviados }))
      },
    )
    req.on("error", (e) => terminar(() => rechazar(e)))
    const plazo = setTimeout(() => req.destroy(new Error(`sin respuesta a POST /api/agent en ${plazoMs} ms`)), plazoMs)

    // Empieza un JSON válido y manda relleno en trozos pequeños, con pausas, sin cerrar el cuerpo.
    req.write('{"message":"')
    bytesEnviados += 12
    const temporizador = setInterval(() => {
      if (++trozos > 40) return terminar(() => resolver({ status: 0, bytesEnviados }))
      req.write("a".repeat(500))
      bytesEnviados += 500
    }, 50)
  })
}

/** Espera la señal de listo del PROPIO servidor y una respuesta con la clave correcta. */
async function esperarServidor({ hijo, puerto, autorizacion, plazoArranqueMs, plazoPeticionMs, senal }) {
  const limite = Date.now() + plazoArranqueMs
  while (!senal.aborted) {
    if (Date.now() > limite) throw new Error(`el servidor no quedó listo en ${plazoArranqueMs} ms`)
    if (hijo.listo) {
      try {
        if ((await consulta({ puerto, ruta: "/", autorizacion, plazoMs: plazoPeticionMs, senal })).estado === 200) return
      } catch {
        // aún no atiende: se reintenta hasta el límite
      }
    }
    await dormir(100)
  }
}

/** Exige que `obtenido` sea `esperado`; deja constancia del fallo y lo devuelve. */
function exigir(salida, descripcion, obtenido, esperado, formato = String) {
  if (obtenido === esperado) return true
  salida.error(`FALLO: ${descripcion}: se esperaba ${formato(esperado)}; fue ${formato(obtenido)}.`)
  return false
}

// Un `Set-Cookie` o un `user:clave@` filtrados no deben acabar en la consola ni en los registros de CI.
const formatoCookie = (v) => (v === undefined ? "ausente" : "<presente>")
const formatoLocation = (v) => String(v).replace(/\/\/[^/@\s]*@/, "//<redactado>@")

/** @param {OpcionesVerificacion} opciones */
export async function verificar({
  clave,
  puerto,
  comando = process.execPath,
  args = ["node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", String(puerto)],
  rutaEstatica,
  plazoArranqueMs = 60_000,
  plazoPeticionMs = 5_000,
  graciaMs = 5_000,
  senalListo = /Ready in|Local:/,
  comprobarPuerto = () => puertoLibre(puerto),
  salida = console,
}) {
  if (!clave?.trim()) {
    salida.error("FALLO: hace falta APP_PASSWORD con contenido (la verificación corre en producción, donde sin clave la app responde 503).")
    return { codigo: 1 }
  }
  if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65535) {
    salida.error(`FALLO: puerto inválido: ${puerto}.`)
    return { codigo: 1 }
  }
  if (!(await comprobarPuerto())) {
    salida.error(`FALLO: el puerto ${puerto} de 127.0.0.1 está ocupado; no se toca el proceso que lo usa. Libéralo o define PUERTO_EA10.`)
    return { codigo: 1 }
  }

  const autorizacion = basic(clave)
  const hijo = lanzarServidor({ comando, args, env: { ...process.env, NODE_ENV: "production", APP_PASSWORD: clave }, senalListo })
  const cancelar = new AbortController()
  const base = { puerto, plazoMs: plazoPeticionMs, senal: cancelar.signal }
  let codigo = 1
  try {
    // La carrera con `hijo.caido` aborta la prueba en cuanto el servidor propio muere.
    codigo = await Promise.race([
      hijo.caido,
      (async () => {
        await esperarServidor({ hijo, puerto, autorizacion, plazoArranqueMs, plazoPeticionMs, senal: cancelar.signal })
        let ok = true

        // 1) 413 por cuerpo chunked que supera la cota, sin terminar de enviarlo.
        const chunked = await postChunkedSinTerminar({ puerto, autorizacion, plazoMs: plazoPeticionMs, senal: cancelar.signal })
        salida.log(`Chunked sin terminar → HTTP ${chunked.status} tras ~${chunked.bytesEnviados} bytes (cota ${COTA_BYTES}).`)
        ok = exigir(salida, "POST chunked sin terminar", chunked.status, 413) && ok

        // 2) Sin credencial todo pide clave; con la correcta, el recurso estático existente se sirve.
        const rutasProtegidas = [
          ["GET", "/api/agent"],
          ["POST", "/api/agent"],
          ["GET", "/api/transmilenio"],
          ["GET", "/"],
          ["GET", rutaEstatica],
        ]
        for (const [metodo, ruta] of rutasProtegidas) {
          if (!ruta) {
            salida.error("FALLO: no hay un recurso estático existente de Next que comprobar (¿falta `pnpm build`?).")
            ok = false
            continue
          }
          ok = exigir(salida, `${metodo} ${ruta} sin credencial`, (await consulta({ ...base, metodo, ruta })).estado, 401) && ok
        }
        if (rutaEstatica) {
          ok = exigir(salida, `GET ${rutaEstatica} con clave`, (await consulta({ ...base, ruta: rutaEstatica, autorizacion })).estado, 200) && ok
        }

        // 3) Redirecciones sin fuga: la barra final se resuelve antes de la guardia, con `Location`
        // relativo, sin `Set-Cookie` y sin host (ni `//evil.com/`, que sería un salto a otro origen).
        const barra = await consulta({ ...base, ruta: "/api/agent/" })
        ok = exigir(salida, "GET /api/agent/ sin credencial", barra.estado, 308) && ok
        ok = exigir(salida, "GET /api/agent/ sin credencial: Location", barra.location, "/api/agent", formatoLocation) && ok
        ok = exigir(salida, "GET /api/agent/ sin credencial: Set-Cookie", barra.setCookie, undefined, formatoCookie) && ok
        // Ruta cruda: `http.request` con `path` no la normaliza, así que llega `//evil.com/` tal cual.
        const doble = await consulta({ ...base, ruta: "//evil.com/" })
        ok = exigir(salida, "GET //evil.com/ sin credencial", doble.estado, 308) && ok
        ok = exigir(salida, "GET //evil.com/ sin credencial: Location", doble.location, "/evil.com/", formatoLocation) && ok
        ok = exigir(salida, "GET //evil.com/ sin credencial: Set-Cookie", doble.setCookie, undefined, formatoCookie) && ok
        return ok ? 0 : 1
      })(),
    ])
    if (hijo.salio) throw new Error("el servidor lanzado terminó durante la prueba")
  } catch (e) {
    salida.error(`FALLO: ${e.message}\nLog del servidor:\n${hijo.log}`)
    codigo = 1
  } finally {
    cancelar.abort()
    await detenerServidor(hijo, graciaMs)
  }
  if (codigo === 0) salida.log("OK: 413 sin completar el envío, 401 sin credencial en todas las rutas y redirecciones 308 sin fuga.")
  return { codigo, pidHijo: hijo.proceso.pid }
}

/** Primer `.js` de `.next/static/chunks`, o `undefined` si no hay compilación. */
function recursoEstaticoExistente() {
  try {
    const archivo = readdirSync(".next/static/chunks").find((nombre) => nombre.endsWith(".js"))
    return archivo && `/_next/static/chunks/${archivo}`
  } catch {
    return undefined
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { codigo } = await verificar({
    clave: process.env.APP_PASSWORD,
    puerto: Number(process.env.PUERTO_EA10 ?? 3218),
    rutaEstatica: recursoEstaticoExistente(),
  })
  process.exit(codigo)
}
