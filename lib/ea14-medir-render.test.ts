import assert from "node:assert/strict"
import test from "node:test"
import { medir, percentil, validarBase } from "../scripts/medir-render.mjs"

/**
 * EA-14 (#40): lógica de `scripts/medir-render.mjs` con una petición simulada.
 * No toca la red ni Render; prueba que el script juzga bien las respuestas, que
 * solo acepta HTTPS y que nunca imprime la clave ni la cabecera Authorization.
 */
const CLAVE = "clave-secreta-de-prueba"
const BASIC = "Basic " + Buffer.from("u:" + CLAVE).toString("base64")

type Solicitud = { metodo?: string; ruta: string; autorizacion?: string; cuerpo?: string }
type Respuesta = { estado: number; ms: number; retryAfter: string | null; texto: string }
const respuesta = (estado: number, texto = "", retryAfter: string | null = null): Respuesta => ({ estado, ms: 100, retryAfter, texto })

/** Servidor simulado correcto: 401 sin clave buena, 413 con cuerpo grande, 429 desde la POST número `corteLimite`. */
function servidor({ corteLimite = 21, motor = "reglas" } = {}) {
  let posts = 0
  return async (s: Solicitud): Promise<Respuesta> => {
    if (s.autorizacion !== BASIC) return respuesta(401)
    if (s.ruta === "/api/transmilenio") return respuesta(200, JSON.stringify({ source: "live", fetchedAt: "2026-11-06T00:00:00Z" }))
    if (s.metodo === "POST") {
      if (++posts >= corteLimite) return respuesta(429, "", "42")
      return respuesta(s.cuerpo && s.cuerpo.length > 4000 ? 413 : 200)
    }
    return respuesta(200, JSON.stringify({ engine: motor }))
  }
}

function captura() {
  const lineas: string[] = []
  return { lineas, salida: { log: (m: string) => lineas.push(m), error: (m: string) => lineas.push(m) } as Pick<Console, "log" | "error"> }
}

test("validarBase solo acepta un origen https sin credenciales, ruta ni consulta", () => {
  assert.equal(validarBase("https://transmivoz.onrender.com"), "https://transmivoz.onrender.com")
  assert.equal(validarBase("https://transmivoz.onrender.com/"), "https://transmivoz.onrender.com")
  for (const mala of [undefined, "", "transmivoz", "http://transmivoz.onrender.com", "https://u:p@transmivoz.onrender.com", "https://transmivoz.onrender.com/api", "https://transmivoz.onrender.com/?a=1"]) {
    assert.throws(() => validarBase(mala), mala)
  }
})

test("percentil usa el rango más cercano y no altera la entrada", () => {
  const datos = [50, 10, 40, 20, 30]
  assert.equal(percentil(datos, 50), 30)
  assert.equal(percentil(datos, 95), 50)
  assert.equal(percentil([7], 95), 7)
  assert.deepEqual(datos, [50, 10, 40, 20, 30])
})

test("credenciales: servidor correcto → 0; sin 401 en una ruta → falla y lo dice", async () => {
  const bien = captura()
  assert.equal(await medir({ modo: "credenciales", base: "x", clave: CLAVE, peticion: servidor(), salida: bien.salida }), 0)
  const abierto = captura()
  const peticion = async (s: Solicitud) => (s.ruta === "/" && !s.autorizacion ? respuesta(200) : servidor()(s))
  assert.equal(await medir({ modo: "credenciales", base: "x", clave: CLAVE, peticion, salida: abierto.salida }), 1)
  assert.ok(abierto.lineas.some((l) => l.startsWith("FALLO") && l.includes("GET / sin credencial")))
})

test("credenciales: un motor distinto de «reglas» falla (Ollama no debe estar activo)", async () => {
  const { salida } = captura()
  assert.equal(await medir({ modo: "credenciales", base: "x", clave: CLAVE, peticion: servidor({ motor: "ollama" }), salida }), 1)
})

test("latencia: resume p50/p95 por serie, marca el origen del catálogo y espacia los POST", async () => {
  const { lineas, salida } = captura()
  const esperas: number[] = []
  const codigo = await medir({ modo: "latencia", n: 3, base: "x", clave: CLAVE, peticion: servidor(), esperar: async (m: number) => void esperas.push(m), salida })
  assert.equal(codigo, 0)
  assert.ok(lineas.some((l) => l.includes("origen live")))
  assert.equal(lineas.filter((l) => l.includes("p50 100 ms · p95 100 ms")).length, 2)
  assert.deepEqual(esperas, [3200, 3200], "n-1 pausas: unos 18 POST por minuto, bajo el límite de 20")
})

test("latencia: un 429 o un 5xx en la serie hace fallar la medición", async () => {
  const { salida } = captura()
  const codigo = await medir({ modo: "latencia", n: 2, base: "x", clave: CLAVE, peticion: servidor({ corteLimite: 2 }), esperar: async () => {}, salida })
  assert.equal(codigo, 1)
})

test("limite: exige un 429 con Retry-After; sin 429 o sin cabecera falla", async () => {
  const bien = captura()
  assert.equal(await medir({ modo: "limite", base: "x", clave: CLAVE, peticion: servidor(), salida: bien.salida }), 0)
  assert.ok(bien.lineas.some((l) => l.includes("429 en la petición 21") && l.includes("Retry-After 42")))
  const sin = captura()
  assert.equal(await medir({ modo: "limite", base: "x", clave: CLAVE, peticion: servidor({ corteLimite: 999 }), salida: sin.salida }), 1)
  const sinCabecera = captura()
  const peticion = async (s: Solicitud) => ((await servidor()(s)).estado === 429 ? respuesta(429) : servidor()(s))
  assert.equal(await medir({ modo: "limite", base: "x", clave: CLAVE, peticion, salida: sinCabecera.salida }), 1)
})

test("despertar: informa el tiempo del primer 200 y falla si no responde 200", async () => {
  const bien = captura()
  assert.equal(await medir({ modo: "despertar", base: "x", clave: CLAVE, peticion: servidor(), salida: bien.salida }), 0)
  assert.ok(bien.lineas.some((l) => l.includes("Arranque en frío: HTTP 200")))
  const mal = captura()
  assert.equal(await medir({ modo: "despertar", base: "x", clave: CLAVE, peticion: async () => respuesta(503), salida: mal.salida }), 1)
})

test("sin clave, con modo desconocido o con error de red: falla sin lanzar ni filtrar la clave", async () => {
  for (const [modo, clave] of [["credenciales", ""], ["credenciales", "   "], ["nada", CLAVE]] as const) {
    const { salida } = captura()
    assert.equal(await medir({ modo, base: "x", clave, peticion: servidor(), salida }), 1)
  }
  const { lineas, salida } = captura()
  const caida = async () => {
    throw new Error("fetch failed")
  }
  assert.equal(await medir({ modo: "credenciales", base: "x", clave: CLAVE, peticion: caida, salida }), 1)
  assert.ok(lineas.some((l) => l.includes("fetch failed")))
})

test("ninguna salida contiene la clave ni la cabecera Authorization", async () => {
  const { lineas, salida } = captura()
  const peticion = servidor()
  for (const modo of ["credenciales", "latencia", "despertar", "limite"]) {
    await medir({ modo, n: 2, base: "x", clave: CLAVE, peticion, esperar: async () => {}, salida })
  }
  const todo = lineas.join("\n")
  assert.ok(!todo.includes(CLAVE) && !todo.includes(BASIC) && !/authorization/i.test(todo))
})
