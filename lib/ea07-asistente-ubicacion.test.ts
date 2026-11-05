import assert from "node:assert/strict"
import test from "node:test"
import snapshot from "../data/transmilenio.json" with { type: "json" }
import { consultarAgente } from "./consulta-agente"
import { interpretCommand, plainReply, runIntent } from "./local-agent"
import { TransmilenioDataSchema } from "./transmilenio"
import { EDAD_MAXIMA_POSICION_MS, type LecturaUbicacion } from "./ubicacion"

/**
 * Regresiones del issue #33 (EA-07, ronda 2) en los CAMINOS REALES del
 * asistente, no solo en el helper: resolución por reglas (`runIntent` /
 * `interpretCommand`), respaldo del cliente (`consultarAgente`) y el endpoint
 * POST real (`app/api/agent/route.ts`). Contraejemplos de los revisores:
 *
 * - H1: llegada falsa («Ya estás en X») por GPS cercano al destino.
 * - H2: posición que era fresca al empezar pero vence durante la espera.
 */

const datos = TransmilenioDataSchema.parse(snapshot)
const ricaurte = datos.stations.find((s) => s.name === "Ricaurte - CL 13")!
const lectura = (lat: number, lng: number, precision: number, hora: number): LecturaUbicacion => ({ lat, lng, precision, hora })
const asentar = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0)) }
/** `fetch` que no responde pero RESPETA la señal (como el navegador): al abortar, rechaza. */
const fetchQueRespetaAborto = ((_url: string, init?: { signal?: AbortSignal }) =>
  new Promise((_resolve, reject) => {
    const s = init?.signal
    if (s?.aborted) return reject(new DOMException("abort", "AbortError"))
    s?.addEventListener("abort", () => reject(new DOMException("abort", "AbortError")), { once: true })
  })) as unknown as typeof fetch

// ── H1: GPS cercano al destino NO afirma presencia ──

test("H1 (runIntent): 'quiero ir a Ricaurte' con GPS a 20 m y precisión 200 m NO dice 'Ya estás en'", () => {
  const now = new Date()
  const reply = interpretCommand("quiero ir a Ricaurte", datos, {
    position: lectura(ricaurte.lat + 20 / 111_195, ricaurte.lng, 200, now.getTime()),
    now,
  })
  assert.doesNotMatch(reply.reply, /Ya estás en/)
  assert.match(reply.reply, /estimaci[oó]n|referencia aproximada|no un acceso verificado/)
})

test("H1 (runIntent): origen explícito desconocido no se reemplaza por GPS", () => {
  const now = new Date()
  const reply = runIntent(
    { type: "trip", origin: "LugarInexistente", destination: "Ricaurte" },
    { data: datos, context: { position: lectura(ricaurte.lat, ricaurte.lng, 10, now.getTime()), now } },
  )
  assert.match(reply.reply, /origen/)
  assert.ok(!reply.steps.some((s) => /ubicaci[oó]n/.test(s.label)))
})

// ── H2: vigencia revalidada al RESOLVER, no solo al recibir ──

test("H2 (runIntent): una lectura fresca al capturar pero vieja al resolver NO se usa", () => {
  const captura = Date.now()
  const resolucion = new Date(captura + EDAD_MAXIMA_POSICION_MS + 1_000) // venció durante la espera
  const reply = runIntent(
    { type: "gps" },
    { data: datos, context: { position: lectura(ricaurte.lat, ricaurte.lng, 10, captura), now: resolucion } },
  )
  // Sin posición vigente, el GPS se abre a secas (no cita la estación más cercana).
  assert.doesNotMatch(reply.reply, /La estación más cercana es/)
})

test("H2 (consultarAgente fallback): lectura de 59 s + 2 s de espera de red vence al resolver", async () => {
  const captura = Date.now() - (EDAD_MAXIMA_POSICION_MS - 1_000) // 59 s de antigüedad al empezar
  const control = new AbortController()
  // `fetch` que nunca responde: fuerza el respaldo local tras la espera máxima.
  const reply = await consultarAgente({
    message: "dónde estoy",
    position: lectura(ricaurte.lat, ricaurte.lng, 10, captura),
    data: datos,
    signal: control.signal,
    implementacionFetch: fetchQueRespetaAborto,
    // Al resolver el respaldo, han pasado > 60 s desde la captura.
    now: () => new Date(captura + EDAD_MAXIMA_POSICION_MS + 2_000),
    esperaMaximaMs: 5,
  })
  await asentar()
  assert.doesNotMatch(reply.reply, /La estación más cercana es/, "no usa la lectura vencida en el respaldo")
})

test("H2 (consultarAgente fallback): lectura fresca al resolver SÍ se usa", async () => {
  const captura = Date.now()
  const control = new AbortController()
  const reply = await consultarAgente({
    message: "dónde estoy",
    position: lectura(ricaurte.lat, ricaurte.lng, 10, captura),
    data: datos,
    signal: control.signal,
    implementacionFetch: fetchQueRespetaAborto,
    now: () => new Date(captura + 1_000),
    esperaMaximaMs: 5,
  })
  await asentar()
  assert.match(reply.reply, /La estación más cercana es/)
})

test("el éxito HTTP usa la respuesta espacial solo mientras la captura siga vigente al recibirla", async () => {
  for (const demora of [500, 2_000]) {
    let ahora = 1_800_000_000_000
    const position = lectura(ricaurte.lat, ricaurte.lng, 10, ahora - EDAD_MAXIMA_POSICION_MS + 1_000)
    const respuestaServidor = interpretCommand("dónde estoy", datos, { position, now: new Date(ahora) })
    assert.match(respuestaServidor.reply, /La estación más cercana es/)
    const reply = await consultarAgente({
      message: "dónde estoy", position, data: datos,
      signal: new AbortController().signal,
      now: () => new Date(ahora),
      implementacionFetch: async () => {
        ahora += demora
        return Response.json(respuestaServidor)
      },
    })
    if (demora === 500) assert.deepEqual(reply, respuestaServidor, "la lectura aún vigente conserva la respuesta")
    else assert.doesNotMatch(reply.reply, /La estación más cercana es/, "una respuesta que vence en tránsito no se usa para orientar")
  }
})

test("vencer la ubicación durante HTTP no oculta límites 429 ni rechazos 413", async () => {
  for (const status of [429, 413]) {
    let ahora = 1_800_000_000_000
    const respuesta = plainReply("Petición rechazada por el servidor.")
    const reply = await consultarAgente({
      message: "dónde estoy",
      position: lectura(ricaurte.lat, ricaurte.lng, 10, ahora - EDAD_MAXIMA_POSICION_MS + 1_000),
      data: datos, signal: new AbortController().signal,
      now: () => new Date(ahora),
      implementacionFetch: async () => {
        ahora += 2_000
        return Response.json(respuesta, { status })
      },
    })
    assert.deepEqual(reply, respuesta, `HTTP ${status}`)
  }
})

// ── POST real: red simulada caída → catálogo de la copia; sin network real ──

test("POST real: 'quiero ir a Ricaurte' con GPS cercano NO responde 'Ya estás en'", async () => {
  const { POST, __reiniciarLimitePeticiones } = await import("../app/api/agent/route")
  // EA-10 (#36): identidad acotada compartida (`sin-verificar`). Se reinicia el
  // contador para aislar este caso del resto, sin fabricar cabeceras de proxy.
  __reiniciarLimitePeticiones()
  const fetchOriginal = globalThis.fetch
  // Fuerza que el servidor use la copia guardada (sin red real a TransMilenio).
  globalThis.fetch = (async () => { throw new Error("sin red (prueba)") }) as unknown as typeof fetch
  try {
    const body = JSON.stringify({
      message: "quiero ir a Ricaurte",
      position: { lat: ricaurte.lat + 20 / 111_195, lng: ricaurte.lng, precision: 200, hora: Date.now() },
    })
    const res = await POST(new Request("http://local/api/agent", { method: "POST", body }))
    const json = (await res.json()) as { reply: string }
    assert.doesNotMatch(json.reply, /Ya estás en/)
  } finally {
    globalThis.fetch = fetchOriginal
  }
})

test("POST real: forma HEREDADA (solo lat/lng, sin hora) no se trata como evidencia fresca", async () => {
  const { POST, __reiniciarLimitePeticiones } = await import("../app/api/agent/route")
  // EA-10 (#36): identidad acotada compartida (`sin-verificar`). Se reinicia el
  // contador para aislar este caso del resto, sin fabricar cabeceras de proxy.
  __reiniciarLimitePeticiones()
  const fetchOriginal = globalThis.fetch
  globalThis.fetch = (async () => { throw new Error("sin red (prueba)") }) as unknown as typeof fetch
  try {
    const body = JSON.stringify({ message: "dónde estoy", position: { lat: ricaurte.lat, lng: ricaurte.lng } })
    const res = await POST(new Request("http://local/api/agent", { method: "POST", body }))
    const json = (await res.json()) as { reply: string }
    // Sin hora no hay evidencia de frescura: no cita la estación más cercana.
    assert.doesNotMatch(json.reply, /La estación más cercana es/)
  } finally {
    globalThis.fetch = fetchOriginal
  }
})

test("POST real: metadatos inválidos (hora no finita) descartan la posición, no rompen la petición", async () => {
  const { POST, __reiniciarLimitePeticiones } = await import("../app/api/agent/route")
  // EA-10 (#36): identidad acotada compartida (`sin-verificar`). Se reinicia el
  // contador para aislar este caso del resto, sin fabricar cabeceras de proxy.
  __reiniciarLimitePeticiones()
  const fetchOriginal = globalThis.fetch
  globalThis.fetch = (async () => { throw new Error("sin red (prueba)") }) as unknown as typeof fetch
  try {
    const body = JSON.stringify({ message: "dónde estoy", position: { lat: ricaurte.lat, lng: ricaurte.lng, hora: "no-numero" } })
    const res = await POST(new Request("http://local/api/agent", { method: "POST", body }))
    const json = (await res.json()) as { reply: string }
    assert.ok(typeof json.reply === "string" && json.reply.length > 0, "responde igual")
    assert.doesNotMatch(json.reply, /La estación más cercana es/)
  } finally {
    globalThis.fetch = fetchOriginal
  }
})

test("POST real: «desde Narnia a Ricaurte» pide aclarar el origen aunque llegue una posición vigente", async () => {
  const { POST, __reiniciarLimitePeticiones } = await import("../app/api/agent/route")
  // EA-10 (#36): identidad acotada compartida (`sin-verificar`). Se reinicia el
  // contador para aislar este caso del resto, sin fabricar cabeceras de proxy.
  __reiniciarLimitePeticiones()
  const fetchOriginal = globalThis.fetch
  globalThis.fetch = (async () => { throw new Error("sin red (prueba)") }) as unknown as typeof fetch
  try {
    const body = JSON.stringify({
      message: "cómo llego desde Narnia a Ricaurte",
      position: { lat: ricaurte.lat, lng: ricaurte.lng, precision: 10, hora: Date.now() },
    })
    const res = await POST(new Request("http://local/api/agent", { method: "POST", body }))
    const json = (await res.json()) as { reply: string; steps: Array<{ label: string }> }
    assert.match(json.reply, /No encontré la estación de origen narnia/)
    assert.ok(!json.steps.some((s) => /ubicaci[oó]n/i.test(s.label)))
  } finally {
    globalThis.fetch = fetchOriginal
  }
})

// ── Frontera de envío: ningún caller reenvía una coordenada no vigente ──

/** Consulta con un `fetch` que captura el cuerpo (y respeta la señal) y devuelve lo enviado como `position`. */
async function posicionEnviada(position: LecturaUbicacion | undefined, ahora: number): Promise<unknown> {
  let cuerpo: { position?: unknown } = {}
  const implementacionFetch = (async (_url: string, init?: RequestInit) => {
    cuerpo = JSON.parse(String(init?.body))
    return new Response(JSON.stringify({ reply: "ok", action: "none", steps: [], engine: "reglas" }))
  }) as unknown as typeof fetch
  await consultarAgente({
    message: "dónde estoy",
    position,
    data: datos,
    signal: new AbortController().signal,
    implementacionFetch,
    now: () => new Date(ahora),
    esperaMaximaMs: 50,
  })
  return cuerpo.position
}

test("consultarAgente NO envía una posición vencida, sin hora o futura; una fresca sí", async () => {
  const ahora = 1_800_000_000_000
  const en = (hora: number | null) => ({ lat: ricaurte.lat, lng: ricaurte.lng, precision: 10, hora })
  assert.equal(await posicionEnviada(en(ahora - EDAD_MAXIMA_POSICION_MS - 1), ahora), undefined, "vencida")
  assert.equal(await posicionEnviada(en(null), ahora), undefined, "sin hora")
  assert.equal(await posicionEnviada(en(ahora + 60_000), ahora), undefined, "futura")
  assert.deepEqual(await posicionEnviada(en(ahora - 1_000), ahora), en(ahora - 1_000), "fresca")
  assert.deepEqual(await posicionEnviada(en(ahora + 2_000), ahora), en(ahora + 2_000), "adelanto dentro del margen de reloj")
  assert.equal(await posicionEnviada(en(ahora + 2_001), ahora), undefined, "adelanto fuera del margen de reloj")
  assert.equal(await posicionEnviada(undefined, ahora), undefined)
})

test("POST real: «estoy en Narnia y quiero ir a Ricaurte» y «a Ricaurte desde Narnia» piden aclarar aunque llegue una posición vigente", async () => {
  const { POST, __reiniciarLimitePeticiones } = await import("../app/api/agent/route")
  // EA-10 (#36): identidad acotada compartida (`sin-verificar`). Se reinicia el
  // contador para aislar este caso del resto, sin fabricar cabeceras de proxy.
  __reiniciarLimitePeticiones()
  const fetchOriginal = globalThis.fetch
  globalThis.fetch = (async () => { throw new Error("sin red (prueba)") }) as unknown as typeof fetch
  try {
    for (const message of ["estoy en Narnia y quiero ir a Ricaurte", "quiero ir a Ricaurte desde Narnia", "cómo llego de Narnia a Ricaurte"]) {
      const body = JSON.stringify({ message, position: { lat: ricaurte.lat, lng: ricaurte.lng, precision: 10, hora: Date.now() } })
      const res = await POST(new Request("http://local/api/agent", { method: "POST", body }))
      const json = (await res.json()) as { reply: string; steps: Array<{ label: string }> }
      assert.match(json.reply, /No encontré la estación de origen narnia/, message)
      assert.ok(!json.steps.some((s) => /ubicaci[oó]n/i.test(s.label)), message)
    }
  } finally {
    globalThis.fetch = fetchOriginal
  }
})
