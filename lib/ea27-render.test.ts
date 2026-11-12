import assert from "node:assert/strict"
import test from "node:test"
import { catalogoCongelado, corpus, type Esperado, type Item } from "./ea27-evaluacion"
import { esperaTras429, observarRespuesta, recorrerCorpus, type Peticion, type RespuestaAgente } from "./ea27-render"
import { runIntent, type Intent } from "./local-agent"

/**
 * EA-27 (#53): la evaluación contra la app desplegada. Ninguna prueba usa la
 * red: las respuestas salen de `runIntent`, igual que las del servidor, y la
 * petición y la espera son simuladas.
 */
const data = catalogoCongelado()
const respuesta = (intent: Intent): RespuestaAgente => runIntent(intent, { data }) as RespuestaAgente
const observar = (intent: Intent, esperado: Esperado = { intent: intent.type }) => observarRespuesta(respuesta(intent), esperado, data)

test("observarRespuesta: texto fijo, por igualdad con lo que da runIntent", () => {
  for (const intent of [{ type: "greeting" }, { type: "help" }, { type: "cancel" }, { type: "unknown" }, { type: "unsupported", topic: "tarifas" }, { type: "unsupported", topic: "tiempo_real" }] as Intent[]) {
    assert.deepEqual(observar(intent), intent)
  }
})

test("observarRespuesta: viaje con origen, solo destino, origen que no existe y destino que no existe", () => {
  assert.deepEqual(observar({ type: "trip", origin: "Ricaurte", destination: "Calle 72" }), { type: "trip", origin: "Ricaurte", destination: "Calle 72" })
  assert.deepEqual(observar({ type: "trip", destination: "Calle 72" }), { type: "trip", origin: undefined, destination: "Calle 72" })
  assert.deepEqual(observar({ type: "trip", origin: "narnia", destination: "Ricaurte" }), { type: "trip", origin: "narnia", destination: "Ricaurte" })
  assert.deepEqual(observar({ type: "trip", destination: "Atlantida" }), { type: "trip", destination: "Atlantida" })
  assert.deepEqual(observar({ type: "trip_missing_destination", origin: "Ricaurte" }), { type: "trip_missing_destination", origin: "Ricaurte" })
})

test("observarRespuesta: ruta, horario, frecuentes y GPS", () => {
  assert.deepEqual(observar({ type: "route_info", routeCode: "B23" }), { type: "route_info", routeCode: "B23" })
  assert.deepEqual(observar({ type: "schedule", routeCode: "B23" }), { type: "schedule", routeCode: "B23" })
  assert.deepEqual(observar({ type: "frequent" }), { type: "frequent" })
  assert.deepEqual(observar({ type: "gps" }), { type: "gps" })
})

test("observarRespuesta: el Metro solo coincide si el texto es el de la consulta de la referencia", () => {
  const esperado: Esperado = { intent: "metro", tipo: "linea", linea: 2 }
  const igual = observar({ type: "metro", consulta: { tipo: "linea", linea: 2 } }, esperado)
  assert.deepEqual(igual, { type: "metro", consulta: { tipo: "linea", linea: 2 } })
  const otra = observar({ type: "metro", consulta: { tipo: "linea", linea: 1 } }, esperado)
  assert.notDeepEqual(otra, igual)
  // Si la referencia no es del Metro, una respuesta del Metro nunca coincide.
  assert.notDeepEqual(observar({ type: "metro", consulta: { tipo: "listado" } }, { intent: "trip", destination: "Calle 72" }), { type: "metro", consulta: { tipo: "listado" } })
})

test("observarRespuesta: lo que no reconoce da null", () => {
  assert.equal(observarRespuesta({ reply: "Otra cosa", action: "none", engine: "reglas", steps: [] }, { intent: "unknown" }, data), null)
})

// ── Ritmo ──

// En este orden, que es el de las respuestas simuladas.
const ITEMS: Item[] = ["cancelacion-01", "conversacion-01", "gps-01"].map((id) => corpus.items.find((i) => i.id === id)!)
const ok = (intent: Intent, engine = "ollama") => ({ ...respuesta(intent), engine })
const respuestaHttp = (cuerpo: unknown, estado = 200, retryAfter: string | null = null) => ({ estado, retryAfter, cuerpo, ms: 7 })

function simulacion(respuestas: ReturnType<typeof respuestaHttp>[], motor = [true]) {
  const esperas: number[] = []
  const frases: string[] = []
  let comprobaciones = 0
  const peticion: Peticion = async (frase) => {
    frases.push(frase)
    return respuestas.shift()!
  }
  const opciones = {
    items: ITEMS,
    data,
    peticion,
    dormir: async (ms: number) => void esperas.push(ms),
    motorListo: async () => motor[Math.min(comprobaciones++, motor.length - 1)],
  }
  return { opciones, esperas, frases }
}

test("recorrerCorpus: espera 3,5 s entre peticiones, puntúa y guarda motor y ms", async () => {
  const { opciones, esperas } = simulacion([respuestaHttp(ok({ type: "cancel" })), respuestaHttp(ok({ type: "greeting" }, "reglas")), respuestaHttp(ok({ type: "unknown" }))])
  const m = await recorrerCorpus(opciones)
  assert.deepEqual(esperas, [3_500, 3_500])
  assert.deepEqual(m.map((x) => [x.id, x.engine, x.puntuacion?.ok, x.ms]), [
    ["cancelacion-01", "ollama", true, 7],
    ["conversacion-01", "reglas", true, 7],
    ["gps-01", "ollama", false, 7],
  ])
})

test("recorrerCorpus: un 429 espera el Retry-After (creciente), repite la misma frase y cuenta el reintento", async () => {
  const { opciones, esperas, frases } = simulacion([
    respuestaHttp(null, 429, "5"),
    respuestaHttp(null, 429, "5"),
    respuestaHttp(ok({ type: "cancel" })),
    respuestaHttp(ok({ type: "greeting" })),
    respuestaHttp(ok({ type: "gps" })),
  ])
  const m = await recorrerCorpus(opciones)
  assert.deepEqual(frases.slice(0, 3), [ITEMS[0].frase, ITEMS[0].frase, ITEMS[0].frase])
  assert.deepEqual(esperas.slice(0, 2), [5_000, 10_000])
  assert.equal(m[0].reintentos429, 2)
  assert.equal(m[0].puntuacion?.ok, true)
})

test("recorrerCorpus: un Retry-After de 1 s no baja del espaciado de 3,5 s entre peticiones", async () => {
  assert.equal(esperaTras429("1"), 3_500)
  const { opciones, esperas } = simulacion([respuestaHttp(null, 429, "1"), respuestaHttp(null, 429, "1"), respuestaHttp(ok({ type: "cancel" })), respuestaHttp(ok({ type: "greeting" })), respuestaHttp(ok({ type: "gps" }))])
  await recorrerCorpus(opciones)
  assert.deepEqual(esperas.slice(0, 2), [3_500, 7_000])
})

test("recorrerCorpus: un 429 sin Retry-After usa la espera por defecto; si no cede, falla sin puntuar", async () => {
  assert.equal(esperaTras429(null), 20_000)
  assert.equal(esperaTras429("abc"), 20_000)
  assert.equal(esperaTras429("5"), 5_000)
  // Un tope de 120 s, aunque el servidor pida más.
  assert.equal(esperaTras429("999"), 120_000)
  const { opciones } = simulacion(Array.from({ length: 20 }, () => respuestaHttp(null, 429)))
  const m = await recorrerCorpus(opciones)
  assert.equal(m[0].puntuacion, null)
  assert.equal(m[0].error, "HTTP 429")
})

test("recorrerCorpus: error de servidor, sin respuesta y cuerpo ajeno quedan como errores sin puntuar", async () => {
  const { opciones } = simulacion([respuestaHttp(null, 502), respuestaHttp(null, 0), respuestaHttp({ otra: "cosa" }, 200)])
  const m = await recorrerCorpus(opciones)
  assert.deepEqual(m.map((x) => [x.puntuacion, x.error]), [
    [null, "HTTP 502"],
    [null, "sin respuesta (red o plazo)"],
    [null, "HTTP 200: cuerpo inesperado"],
  ])
})

test("recorrerCorpus: se detiene si el modelo deja de estar alcanzable", async () => {
  const { opciones, frases } = simulacion([], [false])
  await assert.rejects(recorrerCorpus(opciones), /dejó de estar alcanzable/)
  assert.equal(frases.length, 0)
})
