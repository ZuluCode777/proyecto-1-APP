import assert from "node:assert/strict"
import http from "node:http"
import type { AddressInfo } from "node:net"
import test from "node:test"
import { crearPeticion, medir, percentil, validarBase } from "../scripts/medir-render.mjs"

/**
 * EA-14 (#40): lógica de `scripts/medir-render.mjs` con una petición simulada.
 * No toca la red ni Render; prueba que el script juzga bien las respuestas, que
 * solo acepta HTTPS y que nunca imprime la clave ni la cabecera Authorization.
 */
const CLAVE = "clave-secreta-de-prueba"
const BASIC = "Basic " + Buffer.from("u:" + CLAVE).toString("base64")

type Solicitud = { metodo?: string; ruta: string; autorizacion?: string; cuerpo?: string; plazo?: number }
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

test("credenciales: servidor correcto → 0 y los POST sin clave buena no gastan cupo", async () => {
  const bien = captura()
  const vistas: Solicitud[] = []
  const correcto = servidor()
  const peticion = async (s: Solicitud) => (vistas.push(s), correcto(s))
  assert.equal(await medir({ modo: "credenciales", base: "x", clave: CLAVE, peticion, salida: bien.salida }), 0)
  const posts = vistas.filter((s) => s.metodo === "POST")
  assert.equal(posts.filter((s) => s.autorizacion === BASIC).length, 1, "solo el POST de 413 va con la clave buena")
  assert.equal(posts.filter((s) => s.autorizacion !== BASIC).length, 2, "POST sin clave y con clave errónea")
})

/** Cada par ruta/método/credencial de la matriz: si un despliegue lo deja pasar, el script debe fallar y nombrarlo. */
const MATRIZ_401 = [
  ["GET", "/", "sin credencial"],
  ["GET", "/", "con clave errónea"],
  ["GET", "/api/agent", "sin credencial"],
  ["GET", "/api/agent", "con clave errónea"],
  ["POST", "/api/agent", "sin credencial"],
  ["POST", "/api/agent", "con clave errónea"],
  ["GET", "/api/transmilenio", "sin credencial"],
  ["GET", "/api/transmilenio", "con clave errónea"],
] as const

/** Servidor correcto salvo donde `abre` dice que responde 200 a una petición que debería ser 401. */
const conFuga = (abre: (s: Solicitud) => boolean) => {
  const correcto = servidor()
  return async (s: Solicitud) => (abre(s) ? respuesta(200, JSON.stringify({ engine: "reglas" })) : correcto(s))
}
const sinBuena = (s: Solicitud) => s.autorizacion !== BASIC

test("credenciales: cada ruta y método de la matriz que acepte «sin clave» o «clave errónea» hace fallar", async () => {
  for (const [metodo, ruta, cred] of MATRIZ_401) {
    const { lineas, salida } = captura()
    const abre = (s: Solicitud) => (s.metodo ?? "GET") === metodo && s.ruta === ruta && (cred === "sin credencial" ? !s.autorizacion : !!s.autorizacion && sinBuena(s))
    assert.equal(await medir({ modo: "credenciales", base: "x", clave: CLAVE, peticion: conFuga(abre), salida }), 1, `${metodo} ${ruta} ${cred}`)
    assert.ok(lineas.some((l) => l.startsWith("FALLO") && l.includes(`${metodo} ${ruta} ${cred}`)), `${metodo} ${ruta} ${cred}: debe nombrar el caso`)
  }
})

test("credenciales: una API abierta (todo /api/* sin clave buena) falla aunque «/» esté protegida", async () => {
  for (const modo of ["sin-credencial", "clave-errónea"]) {
    const { salida } = captura()
    const abre = (s: Solicitud) => s.ruta.startsWith("/api/") && sinBuena(s) && (modo === "sin-credencial" ? !s.autorizacion : !!s.autorizacion)
    assert.equal(await medir({ modo: "credenciales", base: "x", clave: CLAVE, peticion: conFuga(abre), salida }), 1, modo)
  }
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
  assert.ok(bien.lineas.some((l) => l.startsWith("OK") && l.includes("429 en la petición 21") && l.includes("Retry-After 42")))
  const sin = captura()
  assert.equal(await medir({ modo: "limite", base: "x", clave: CLAVE, peticion: servidor({ corteLimite: 999 }), salida: sin.salida }), 1)
  assert.ok(sin.lineas.some((l) => l.includes("25 peticiones seguidas sin ningún 429")))
})

test("limite: un 429 sin Retry-After falla (un solo servidor con estado que sí llega al 429)", async () => {
  const sinCabecera = captura()
  const unico = servidor()
  const peticion = async (s: Solicitud) => {
    const r = await unico(s)
    return r.estado === 429 ? respuesta(429) : r
  }
  assert.equal(await medir({ modo: "limite", base: "x", clave: CLAVE, peticion, salida: sinCabecera.salida }), 1)
  assert.ok(sinCabecera.lineas.some((l) => l.startsWith("FALLO") && l.includes("429 en la petición 21") && l.includes("Retry-After ausente")), "debe haber llegado al 429")
  assert.ok(!sinCabecera.lineas.some((l) => l.includes("sin ningún 429")), "no es el caso de «nunca hubo 429»")
})

test("despertar: informa el tiempo del primer 200 y falla si no responde 200", async () => {
  const bien = captura()
  const correcto = servidor()
  const plazos: (number | undefined)[] = []
  const peticion = async (s: Solicitud) => (plazos.push(s.plazo), correcto(s))
  assert.equal(await medir({ modo: "despertar", base: "x", clave: CLAVE, peticion, salida: bien.salida }), 0)
  assert.deepEqual(plazos, [120_000], "una sola petición con plazo de 120 s (arranque en frío), no el de 20 s")
  assert.ok(bien.lineas.some((l) => l.includes("Primera petición") && l.includes("más de 15 min sin tráfico") && l.includes("HTTP 200")))
  assert.ok(!bien.lineas.some((l) => l.startsWith("Arranque en frío")), "no afirma «frío» sin saber cuánto reposó")
  const mal = captura()
  assert.equal(await medir({ modo: "despertar", base: "x", clave: CLAVE, peticion: async () => respuesta(503), salida: mal.salida }), 1)
})

test("sin clave, con modo desconocido o con error de red: falla sin lanzar ni filtrar la clave", async () => {
  for (const [modo, clave] of [["credenciales", ""], ["credenciales", "   "], ["nada", CLAVE], [undefined, CLAVE]] as const) {
    const { salida } = captura()
    assert.equal(await medir({ modo: modo as string, base: "x", clave, peticion: servidor(), salida }), 1)
  }
  const { lineas, salida } = captura()
  const caida = async () => {
    throw new Error("fetch failed")
  }
  assert.equal(await medir({ modo: "credenciales", base: "x", clave: CLAVE, peticion: caida, salida }), 1)
  assert.ok(lineas.some((l) => l.includes("fetch failed")))
})

test("modos heredados de Object (toString, constructor, __proto__…) son desconocidos: salida 1 y ninguna petición", async () => {
  for (const modo of ["toString", "constructor", "hasOwnProperty", "valueOf", "__proto__"]) {
    const { lineas, salida } = captura()
    let peticiones = 0
    const peticion = async () => {
      peticiones++
      throw new Error("no debe haber peticiones")
    }
    assert.equal(await medir({ modo, base: "https://example.invalid", clave: "clave-prueba", peticion, salida }), 1, modo)
    assert.equal(peticiones, 0, modo)
    assert.ok(lineas.some((l) => l.includes("modo desconocido")), modo)
  }
})

test("crearPeticion no sigue redirecciones: devuelve el 308 y no visita el destino (ni mismo ni otro origen)", async () => {
  const visitas: { origen: string; url: string; autorizacion?: string }[] = []
  const escucha = (origen: string, manejador: http.RequestListener) => {
    const servidor = http.createServer((req, res) => {
      visitas.push({ origen, url: req.url ?? "", autorizacion: req.headers.authorization })
      manejador(req, res)
    })
    return new Promise<http.Server>((resolver) => servidor.listen(0, "127.0.0.1", () => resolver(servidor)))
  }
  const puerto = (s: http.Server) => (s.address() as AddressInfo).port
  const otro = await escucha("otro", (_req, res) => res.end("destino"))
  const origen = await escucha("origen", (req, res) => {
    // Como una mala configuración (o un atacante) que mande la clave a otro sitio.
    res.statusCode = 308
    res.setHeader("location", req.url === "/externa" ? `http://127.0.0.1:${puerto(otro)}/robo` : "/interna")
    res.end()
  })
  try {
    const peticion = crearPeticion({ base: `http://127.0.0.1:${puerto(origen)}` })
    for (const ruta of ["/externa", "/interna-origen"]) {
      const r = await peticion({ ruta, autorizacion: BASIC, cuerpo: undefined })
      assert.equal(r.estado, 308, ruta)
    }
    assert.deepEqual(visitas.map((v) => `${v.origen} ${v.url}`), ["origen /externa", "origen /interna-origen"], "ni /robo ni /interna recibieron visita")
    assert.ok(visitas.every((v) => v.origen === "origen"), "el otro origen no vio nada")
  } finally {
    for (const s of [origen, otro]) {
      s.closeAllConnections()
      s.close()
    }
  }
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
