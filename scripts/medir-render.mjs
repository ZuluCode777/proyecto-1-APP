/**
 * Mediciones en vivo de EA-14 (#40) contra un despliegue HTTPS real (Render).
 * Complementa `verificar-ea10-http.mjs` (que arranca un servidor LOCAL) y
 * `pnpm verificar` (Chrome); no reemplaza ninguno.
 *
 * La clave se lee SOLO de `APP_PASSWORD`, nunca de un argumento (no queda en el
 * historial ni en `ps`). Solo envía credenciales a ese origen HTTPS, no sigue
 * redirecciones y no imprime la clave, la cabecera `Authorization` ni cuerpos
 * de respuesta.
 *
 *   RENDER_URL=https://transmivoz.onrender.com APP_PASSWORD=… node scripts/medir-render.mjs <modo>
 *
 * Modos:
 *   credenciales  401 sin credencial y con clave errónea en `/`, GET y POST
 *                 /api/agent y GET /api/transmilenio; 200 con la correcta en `/` y
 *                 GET /api/agent; 413 por cuerpo grande y motor «reglas». El 200 del
 *                 catálogo con clave lo exige `latencia`, que ya lo pide. Solo el
 *                 POST de 413 gasta 1 del cupo del minuto (el 401 no gasta).
 *   latencia [n]  Catálogo (marca si vino «live» o «snapshot») y, ya en caliente,
 *                 n lecturas de GET /api/agent (red + Render, sin datos) y n de
 *                 POST /api/agent (reglas + catálogo en caché), espaciadas para
 *                 mantenerse muy por debajo del límite por minuto de la ruta
 *                 (unos 18 POST por minuto). Por defecto n = 30 (unos 100 s).
 *   despertar     Una sola petición con plazo de 120 s. Es arranque en frío solo si
 *                 el servicio llevaba más de 15 min sin tráfico; si no, es una
 *                 medición en caliente y no se registra como frío. No envíes
 *                 tráfico artificial para dormirlo ni para evitarlo.
 *   limite        Hasta `TOPE_LIMITE` POST seguidos hasta recibir 429; informa en cuál
 *                 llegó (límite + 1). Gasta el cupo COMPARTIDO de la instancia:
 *                 hazlo en un ensayo aparte, sin público.
 *
 * Corre `despertar` primero y espera su 200: los demás modos tienen plazo de 20 s
 * por petición y un arranque en frío (cerca de 60 s, sin garantía) los haría
 * fallar por el reposo, no por la app.
 *
 * Código de salida 0 solo si todo lo comprobado se cumple. Mide tiempos, no los
 * juzga: p50/p95 y memoria se comparan a mano con el objetivo del informe.
 */
import { pathToFileURL } from "node:url"

const FRASE = "¿dónde estoy?"
/** Espacio entre POST: unos 18 por minuto, muy por debajo del límite de la ruta (`lib/cuota-asistente.ts`). */
const ESPERA_POST_MS = 3_200
/** POST seguidos que `limite` intenta como máximo: debe superar el límite de la ruta (`LIMITE_ASISTENTE`). */
const TOPE_LIMITE = 150

/** Origen HTTPS sin credenciales, ruta ni consulta; si no, lanza. */
export function validarBase(texto) {
  let url
  try {
    url = new URL(texto ?? "")
  } catch {
    throw new Error("RENDER_URL debe ser una URL https válida.")
  }
  if (url.protocol !== "https:") throw new Error("RENDER_URL debe usar https: no se envían credenciales por HTTP.")
  if (url.username || url.password) throw new Error("RENDER_URL no debe llevar usuario ni clave.")
  if ((url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) throw new Error("RENDER_URL debe ser solo el origen, sin ruta ni consulta.")
  return url.origin
}

/** Percentil por rango más cercano sobre una copia ordenada. `valores` no puede estar vacío. */
export function percentil(valores, p) {
  const ordenados = [...valores].sort((a, b) => a - b)
  return ordenados[Math.min(ordenados.length - 1, Math.ceil((p / 100) * ordenados.length) - 1)]
}

const basic = (clave) => "Basic " + Buffer.from("u:" + clave).toString("base64")
const dormir = (ms) => new Promise((r) => setTimeout(r, ms))
const ms = (n) => `${Math.round(n)} ms`

/** Petición real: sin seguir redirecciones, con plazo, midiendo hasta leer el cuerpo. */
export function crearPeticion({ base, plazoMs = 20_000 }) {
  return async ({ metodo = "GET", ruta, autorizacion, cuerpo, plazo = plazoMs }) => {
    const inicio = performance.now()
    const res = await fetch(base + ruta, {
      method: metodo,
      redirect: "manual",
      signal: AbortSignal.timeout(plazo),
      headers: { ...(autorizacion && { authorization: autorizacion }), ...(cuerpo !== undefined && { "content-type": "application/json" }) },
      body: cuerpo,
    })
    const texto = await res.text()
    return { estado: res.status, ms: performance.now() - inicio, retryAfter: res.headers.get("retry-after"), texto }
  }
}

const post = (autorizacion, mensaje = FRASE) => ({ metodo: "POST", ruta: "/api/agent", autorizacion, cuerpo: JSON.stringify({ message: mensaje }) })

/** Intenta leer un campo de un JSON; `undefined` si no es JSON. */
function campo(texto, nombre) {
  try {
    return JSON.parse(texto)[nombre]
  } catch {
    return undefined
  }
}

async function credenciales({ peticion, clave, salida }) {
  const buena = basic(clave)
  const mala = basic("clave-incorrecta-ea14")
  // `/api/agent` no pasa por el proxy: su propia guardia debe comprobarse aparte, en GET y en POST.
  const casos = [
    ["GET / sin credencial", { ruta: "/" }, 401],
    ["GET / con clave errónea", { ruta: "/", autorizacion: mala }, 401],
    ["GET /api/agent sin credencial", { ruta: "/api/agent" }, 401],
    ["GET /api/agent con clave errónea", { ruta: "/api/agent", autorizacion: mala }, 401],
    ["POST /api/agent sin credencial", post(undefined), 401],
    ["POST /api/agent con clave errónea", post(mala), 401],
    ["GET /api/transmilenio sin credencial", { ruta: "/api/transmilenio" }, 401],
    ["GET /api/transmilenio con clave errónea", { ruta: "/api/transmilenio", autorizacion: mala }, 401],
    ["GET / con la clave correcta", { ruta: "/", autorizacion: buena }, 200],
    ["POST /api/agent con cuerpo de 5000 bytes", post(buena, "a".repeat(5000)), 413],
  ]
  let ok = true
  for (const [descripcion, solicitud, esperado] of casos) {
    const r = await peticion(solicitud)
    const bien = r.estado === esperado
    ok &&= bien
    salida.log(`${bien ? "OK   " : "FALLO"} ${descripcion}: HTTP ${r.estado} (esperado ${esperado}), ${ms(r.ms)}`)
  }
  const motor = await peticion({ ruta: "/api/agent", autorizacion: buena })
  const reglas = motor.estado === 200 && campo(motor.texto, "engine") === "reglas"
  ok &&= reglas
  salida.log(`${reglas ? "OK   " : "FALLO"} GET /api/agent: HTTP ${motor.estado}, motor ${campo(motor.texto, "engine") ?? "desconocido"} (esperado reglas)`)
  return ok
}

function resumen(nombre, muestras, salida) {
  const buenas = muestras.filter((m) => m.estado === 200)
  const estados = Object.entries(Object.groupBy(muestras, (m) => m.estado)).map(([e, l]) => `${e}×${l.length}`).join(" ")
  if (!buenas.length) return salida.error(`FALLO ${nombre}: ninguna respuesta 200 (${estados}).`)
  const t = buenas.map((m) => m.ms)
  salida.log(`${nombre}: n=${muestras.length} estados ${estados} · p50 ${ms(percentil(t, 50))} · p95 ${ms(percentil(t, 95))} · mín ${ms(Math.min(...t))} · máx ${ms(Math.max(...t))}`)
}

async function latencia({ peticion, clave, n, salida, esperar }) {
  const buena = basic(clave)
  const catalogo = await peticion({ ruta: "/api/transmilenio", autorizacion: buena })
  salida.log(`Catálogo (puede incluir ArcGIS): HTTP ${catalogo.estado}, origen ${campo(catalogo.texto, "source") ?? "desconocido"}, fecha ${campo(catalogo.texto, "fetchedAt") ?? "desconocida"}, ${ms(catalogo.ms)}`)
  const lecturas = []
  for (let i = 0; i < n; i++) lecturas.push(await peticion({ ruta: "/api/agent", autorizacion: buena }))
  resumen("GET /api/agent (red + Render, sin datos)", lecturas, salida)
  const preguntas = []
  for (let i = 0; i < n; i++) {
    if (i) await esperar(ESPERA_POST_MS)
    preguntas.push(await peticion(post(buena)))
  }
  resumen("POST /api/agent (reglas + catálogo en caché)", preguntas, salida)
  return catalogo.estado === 200 && [...lecturas, ...preguntas].every((m) => m.estado === 200)
}

async function despertar({ peticion, clave, salida }) {
  const r = await peticion({ ruta: "/api/agent", autorizacion: basic(clave), plazo: 120_000 })
  salida.log(`Primera petición (arranque en frío solo si hubo más de 15 min sin tráfico): HTTP ${r.estado}, ${ms(r.ms)}, motor ${campo(r.texto, "engine") ?? "desconocido"}.`)
  return r.estado === 200
}

async function limite({ peticion, clave, salida }) {
  const buena = basic(clave)
  for (let i = 1; i <= TOPE_LIMITE; i++) {
    const r = await peticion(post(buena))
    if (r.estado === 429) {
      const conCabecera = r.retryAfter !== null
      salida.log(`${conCabecera ? "OK   " : "FALLO"} 429 en la petición ${i}, Retry-After ${r.retryAfter ?? "ausente"}.`)
      return conCabecera
    }
    if (r.estado !== 200) {
      salida.error(`FALLO petición ${i}: HTTP ${r.estado}.`)
      return false
    }
  }
  salida.error(`FALLO: ${TOPE_LIMITE} peticiones seguidas sin ningún 429.`)
  return false
}

const MODOS = { credenciales, latencia, despertar, limite }

/**
 * @typedef {object} OpcionesMedir
 * @property {string} modo Uno de los modos de arriba.
 * @property {string} base Origen HTTPS (ya validado con `validarBase`).
 * @property {string | undefined} clave Clave de la app.
 * @property {number} [n] Lecturas por serie en el modo `latencia`.
 * @property {(solicitud: any) => Promise<any>} [peticion] Sustituible solo en pruebas.
 * @property {(ms: number) => Promise<void>} [esperar] Sustituible solo en pruebas.
 * @property {Pick<Console, "log" | "error">} [salida] Destino de los mensajes.
 */

/**
 * Ejecuta un modo y devuelve el código de salida.
 * @param {OpcionesMedir} opciones
 */
export async function medir({ modo, base, clave, n = 30, peticion = crearPeticion({ base }), esperar = dormir, salida = console }) {
  if (!Object.hasOwn(MODOS, modo)) {
    salida.error(`FALLO: modo desconocido. Usa: ${Object.keys(MODOS).join(", ")}.`)
    return 1
  }
  if (!clave?.trim()) {
    salida.error("FALLO: define APP_PASSWORD en el entorno (no se acepta por argumento).")
    return 1
  }
  try {
    return (await MODOS[modo]({ peticion, clave, n, salida, esperar })) ? 0 : 1
  } catch (e) {
    salida.error(`FALLO: ${e instanceof Error ? e.message : "error de red"}`)
    return 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let base
  try {
    base = validarBase(process.env.RENDER_URL)
  } catch (e) {
    console.error(`FALLO: ${e.message}`)
    process.exit(1)
  }
  const n = Number(process.argv[3] ?? 30)
  if (!Number.isInteger(n) || n < 1) {
    console.error("FALLO: n debe ser un entero positivo.")
    process.exit(1)
  }
  process.exit(await medir({ modo: process.argv[2], base, clave: process.env.APP_PASSWORD, n }))
}
