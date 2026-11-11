import assert from "node:assert/strict"
import test from "node:test"
import { pathToFileURL } from "node:url"
import snapshot from "../data/transmilenio.json" with { type: "json" }
import { consultarAgente } from "./consulta-agente"
import { interpretCommand, parseIntent, plainReply, runIntent, type Intent } from "./local-agent"
import { elegirIntent, intencionConocida, intencionUsaUbicacion, requiereModelo } from "./seleccion-interprete"
import { TransmilenioDataSchema } from "./transmilenio"

const raiz = pathToFileURL(process.cwd() + "/")
let contadorCaso = 0

/**
 * Carga una instancia FRESCA del endpoint (caché de módulo reiniciada por una
 * query distinta, como en `transmilenio-data.test.ts`). Así cada caso tiene su
 * propio contador de peticiones y queda aislado sin un export de reinicio solo
 * para pruebas ni cabeceras de proxy fabricadas.
 */
async function cargarEndpointFresco(): Promise<{ POST: (req: Request) => Promise<Response> }> {
  return import(new URL(`app/api/agent/route.ts?caso=${contadorCaso++}`, raiz).href)
}

/**
 * Regresión del issue #34 (EA-08): espera máxima de cliente, ubicación opcional
 * y que un `unknown` del modelo no anule una regla. Ejercita el ENDPOINT REAL
 * (`POST /api/agent`) con Ollama simulado por `fetch`, y la lógica pura de
 * `consultarAgente`/`elegirIntent`. La cancelación de la interfaz se prueba en
 * `ea08-cancelacion-ui.test.ts`.
 *
 * Actualización (EA-27, #53): la política «las reglas primero» de EA-08 (hallazgo
 * 15) se reemplazó por «el modelo primero cuando está cargado». Los casos de
 * este archivo ponen el modelo como cargado a propósito; la política completa
 * (modelo no cargado, excepciones del Metro) se prueba en
 * `ea27-modelo-primero.test.ts`.
 */

const data = TransmilenioDataSchema.parse(snapshot)

// ── AC1: endpoint real — con el modelo cargado se le consulta, y su unknown no anula una regla ──

/**
 * Importa el `POST` real del endpoint con `OLLAMA_MODEL` configurado y un
 * `fetch` que simula el `/api/chat` de Ollama. Devuelve un contador de llamadas
 * al modelo y la función para preguntar. Cualquier otra red (ArcGIS) cae, de
 * modo que el endpoint usa la copia guardada. Restaura `fetch`/env al terminar.
 * Deja el modelo como cargado con una precarga correcta: `lib/ollama.ts`
 * (importado sin query por el endpoint) guarda ese estado para todo el proceso.
 */
async function conEndpoint(modoModelo: "unknown" | "colgado" | "gps" | "trip-destino") {
  const fetchOriginal = globalThis.fetch
  const modeloPrevio = process.env.OLLAMA_MODEL
  process.env.OLLAMA_MODEL = "modelo-de-prueba"
  let llamadasChat = 0
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url)
    if (u.includes("/api/chat")) {
      // La precarga (sin mensajes) que sigue a un fallo del modelo no es una consulta.
      if (JSON.parse(String(init?.body)).messages.length === 0) return new Response("{}")
      llamadasChat++
      if (modoModelo === "colgado") {
        // Nunca responde: el presupuesto del modelo (TIMEOUT_MS) lo abortará y
        // el endpoint responderá con reglas.
        return new Promise<Response>((_res, rej) =>
          init?.signal?.addEventListener("abort", () => rej(new DOMException("timeout", "TimeoutError")), { once: true }),
        )
      }
      const contenido =
        modoModelo === "gps"
          ? { intent: "gps", origin: "", destination: "", routeCode: "" }
          : modoModelo === "trip-destino"
            ? { intent: "trip", origin: "", destination: "Ricaurte", routeCode: "" }
            : { intent: "unknown", origin: "", destination: "", routeCode: "" }
      return new Response(JSON.stringify({ message: { content: JSON.stringify(contenido) } }))
    }
    throw new Error("sin red (ArcGIS simulado): usa la copia")
  }) as typeof fetch

  // EA-10 (#36): la identidad para el límite ya NO sale de `x-forwarded-for` (la
  // política conservadora no confía en esa cabecera sin un proxy verificado;
  // todas las peticiones comparten la clave acotada `sin-verificar`). Antes cada
  // llamada fabricaba una IP distinta para no compartir cuota entre pruebas; eso
  // simulaba identidades que el servidor no debe creer. Ahora cada caso carga una
  // instancia fresca del endpoint (contador propio), sin inventar cabeceras.
  const { POST } = await cargarEndpointFresco()
  const ollama = await import("./ollama")
  for (let intento = 0; intento < 3 && !ollama.modeloListo(); intento++) await ollama.warmUpOllama()
  assert.equal(ollama.modeloListo(), true, "el caso parte con el modelo cargado")
  const preguntar = async (message: string, position?: { lat: number; lng: number }) => {
    const res = await POST(
      new Request("http://localhost/api/agent", {
        method: "POST",
        body: JSON.stringify({ message, position }),
      }),
    )
    return res.json()
  }
  const restaurar = () => {
    globalThis.fetch = fetchOriginal
    if (modeloPrevio === undefined) delete process.env.OLLAMA_MODEL
    else process.env.OLLAMA_MODEL = modeloPrevio
  }
  return { preguntar, llamadas: () => llamadasChat, restaurar }
}

test("AC1 (endpoint real): con el modelo cargado se le consulta también un comando conocido, y su unknown no lo anula", async () => {
  const e = await conEndpoint("unknown")
  try {
    const json = await e.preguntar("información de la B23")
    assert.equal(e.llamadas(), 1, "EA-27: con el modelo cargado, toda pregunta se consulta")
    assert.equal(json.action, "route")
    assert.equal(json.engine, "reglas")
  } finally {
    e.restaurar()
  }
})

test("AC1 (endpoint real): un unknown del modelo no anula una regla conocida", async () => {
  // La frase la entienden las reglas; el modelo se consulta (EA-27) y responde
  // unknown, y esa respuesta no puede anular la intención de las reglas.
  const e = await conEndpoint("unknown")
  try {
    const json = await e.preguntar("cómo llego de Terminal a Guatoque - Veraguas")
    assert.equal(e.llamadas(), 1)
    assert.ok(json.action === "trip" || json.action === "search")
    assert.equal(json.engine, "reglas")
  } finally {
    e.restaurar()
  }
})

test("AC2 (endpoint real): frase desconocida con modelo colgado responde con reglas dentro del presupuesto", async () => {
  // El modelo se consulta (reglas no entienden) pero se cuelga; el presupuesto
  // del servidor lo aborta y responde con reglas. Tolera el plazo real (4,5 s).
  const e = await conEndpoint("colgado")
  try {
    const t0 = performance.now()
    const json = await e.preguntar("explícame la teoría de la relatividad por favor")
    const ms = performance.now() - t0
    assert.equal(e.llamadas(), 1, "las reglas no entendían: sí se consultó el modelo")
    assert.equal(json.engine, "reglas")
    assert.match(json.reply, /No te entendí/)
    assert.ok(ms < 5_500, `el presupuesto del modelo debe liberar antes que la espera del cliente (6 s); tardó ${Math.round(ms)} ms`)
  } finally {
    e.restaurar()
  }
})

// ── AC1: política de selección pura ──

test("AC1: un comando conocido por reglas SÍ se consulta al modelo (EA-27); solo el Metro y el viaje sin destino no", () => {
  const intent = parseIntent("información de la B23", data)
  assert.equal(intent.type, "route_info")
  assert.equal(requiereModelo(intent), true)
  assert.equal(requiereModelo(parseIntent("estación E3 del metro", data)), false)
})

test("AC1: una frase que las reglas no entienden sí requiere el modelo", () => {
  const intent = parseIntent("explícame la teoría de la relatividad por favor", data)
  assert.equal(intent.type, "unknown")
  assert.equal(requiereModelo(intent), true)
})

test("AC1: un unknown del modelo no elimina la intención conocida de reglas", () => {
  const reglas: Intent = { type: "route_info", routeCode: "B23" }
  const elegido = elegirIntent(reglas, { type: "unknown" })
  assert.deepEqual(elegido.intent, reglas)
  assert.equal(elegido.engine, "reglas")
})

test("AC1: si las reglas no entienden pero el modelo sí, se usa el modelo", () => {
  const modelo: Intent = { type: "trip", destination: "Ricaurte" }
  const elegido = elegirIntent({ type: "unknown" }, modelo)
  assert.deepEqual(elegido.intent, modelo)
  assert.equal(elegido.engine, "ollama")
})

test("AC1: si ninguno entiende, se conserva la respuesta de desconocimiento de reglas", () => {
  const elegido = elegirIntent({ type: "unknown" }, { type: "unknown" })
  assert.equal(elegido.intent.type, "unknown")
  assert.equal(elegido.engine, "reglas")
  const reply = runIntent(elegido.intent, { data, engine: elegido.engine })
  assert.equal(reply.action, "none")
  assert.match(reply.reply, /No te entendí/)
})

test("AC1: el modelo nulo (falló/invalidó) cae a reglas; intencionConocida(null) es falso", () => {
  const reglas = parseIntent("hola", data)
  assert.equal(reglas.type, "greeting")
  assert.equal(elegirIntent(reglas, null).engine, "reglas")
  assert.equal(intencionConocida(null), false)
})

// ── AC4: la ubicación solo la usan las intenciones que la necesitan ──

test("AC4: solo el GPS y un viaje sin origen usan la ubicación", () => {
  assert.equal(intencionUsaUbicacion({ type: "greeting" }), false)
  assert.equal(intencionUsaUbicacion({ type: "help" }), false)
  assert.equal(intencionUsaUbicacion({ type: "schedule", routeCode: "B23" }), false)
  assert.equal(intencionUsaUbicacion({ type: "route_info", routeCode: "B23" }), false)
  assert.equal(intencionUsaUbicacion({ type: "unknown" }), false)
  assert.equal(intencionUsaUbicacion({ type: "gps" }), true)
  assert.equal(intencionUsaUbicacion({ type: "trip", destination: "Calle 72" }), true)
  assert.equal(intencionUsaUbicacion({ type: "trip", origin: "Ricaurte", destination: "Calle 72" }), false)
})

// ── Decisión B (endpoint real): el modelo resuelve gps/trip SIN coordenada ──
// (el cliente ya no adjunta la posición en caché para frases `unknown`).

test("B (endpoint real): el modelo resuelve un GPS sin coordenada → el endpoint no inventa estación", async () => {
  const e = await conEndpoint("gps")
  try {
    // Frase que las REGLAS no entienden (así SÍ se consulta el modelo). El cliente
    // no envía posición para `unknown` (decisión B/AC4); el modelo la clasifica
    // `gps` y, sin coordenada, el GPS se abre pero no nombra la estación cercana.
    const sinPos = await e.preguntar("en qué lugar me encuentro parado ahora")
    assert.equal(e.llamadas(), 1, "las reglas no entendían: sí se consultó el modelo")
    assert.equal(sinPos.action, "gps")
    assert.doesNotMatch(sinPos.reply, /La estación más cercana es/)
  } finally {
    e.restaurar()
  }
})

test("B (endpoint real): el modelo resuelve un viaje sin origen → el endpoint pide el origen", async () => {
  const e = await conEndpoint("trip-destino")
  try {
    // Frase que las REGLAS no entienden, así se ejercita el camino del modelo.
    // El modelo la clasifica como viaje a Ricaurte (sin origen); sin coordenada,
    // se resuelve por «dime desde dónde sales», no con la ubicación.
    const sinPos = await e.preguntar("necesito ir a algún lado ahora mismo")
    assert.equal(e.llamadas(), 1, "las reglas no entendían: sí se consultó el modelo")
    assert.ok(sinPos.action === "search" || sinPos.action === "none")
    assert.doesNotMatch(sinPos.reply, /Estás a .* de /)
  } finally {
    e.restaurar()
  }
})

// ── AC2/AC3: espera máxima de cliente, respaldo local y cancelación ──

/** `fetch` simulado que nunca resuelve hasta que se aborta su señal. */
function fetchColgado(): typeof fetch {
  return ((_url: string, init?: RequestInit) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("abortado", "AbortError")), { once: true })
    })) as unknown as typeof fetch
}

const RELOJ = () => new Date("2026-11-04T10:00:00-05:00")

test("AC2: si el servidor no responde dentro del plazo, resuelve localmente con los datos cargados", async () => {
  const control = new AbortController()
  const reply = await consultarAgente({
    message: "cómo llego a Ricaurte",
    data,
    signal: control.signal,
    implementacionFetch: fetchColgado(),
    esperaMaximaMs: 20,
    now: RELOJ,
  })
  const esperado = interpretCommand("cómo llego a Ricaurte", data, { now: RELOJ() })
  assert.equal(reply.action, esperado.action)
  assert.equal(reply.reply, esperado.reply)
})

test("AC2: sin catálogo cargado y sin servidor, da un aviso recuperable dentro del plazo", async () => {
  const control = new AbortController()
  const reply = await consultarAgente({
    message: "cómo llego a Ricaurte",
    data: null,
    signal: control.signal,
    implementacionFetch: fetchColgado(),
    esperaMaximaMs: 20,
  })
  assert.equal(reply.action, "none")
  assert.match(reply.reply, /todavía no hay datos cargados/i)
})

test("AC3: cancelar (abort) durante la espera NO produce respuesta: lanza AbortError", async () => {
  const control = new AbortController()
  const promesa = consultarAgente({
    message: "cómo llego a Ricaurte",
    data,
    signal: control.signal,
    implementacionFetch: fetchColgado(),
    esperaMaximaMs: 10_000,
  })
  control.abort()
  await assert.rejects(promesa, (e: unknown) => e instanceof DOMException && e.name === "AbortError")
})

test("AC3: una señal ya abortada antes de empezar no consulta ni responde", async () => {
  const control = new AbortController()
  control.abort()
  await assert.rejects(
    consultarAgente({ message: "hola", data, signal: control.signal, implementacionFetch: fetchColgado() }),
    (e: unknown) => e instanceof DOMException && e.name === "AbortError",
  )
})

test("AC2: un error HTTP del servidor (500) cae al respaldo local, no lanza", async () => {
  const control = new AbortController()
  const fetch500 = (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch
  const reply = await consultarAgente({
    message: "información de la B23",
    data,
    signal: control.signal,
    implementacionFetch: fetch500,
    now: RELOJ,
  })
  assert.equal(reply.action, "route")
  assert.equal(reply.routeCode, "B23")
})

test("AC2: un 429 o 413 se respeta como respuesta del servidor (no se trata como fallo)", async () => {
  const control = new AbortController()
  const cuerpo = JSON.stringify(plainReply("Estás haciendo muchas peticiones seguidas."))
  const fetch429 = (async () => new Response(cuerpo, { status: 429 })) as unknown as typeof fetch
  const reply = await consultarAgente({ message: "hola", data, signal: control.signal, implementacionFetch: fetch429 })
  assert.match(reply.reply, /muchas peticiones/)
})

test("AC2: un JSON inválido del servidor cae al respaldo local en vez de romper", async () => {
  const control = new AbortController()
  const fetchBasura = (async () => new Response(JSON.stringify({ cualquier: "cosa" }))) as unknown as typeof fetch
  const reply = await consultarAgente({
    message: "información de la B23",
    data,
    signal: control.signal,
    implementacionFetch: fetchBasura,
    now: RELOJ,
  })
  assert.equal(reply.action, "route")
  assert.equal(reply.routeCode, "B23")
})
