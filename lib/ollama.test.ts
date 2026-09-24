import assert from "node:assert/strict"
import test from "node:test"
import snapshot from "../data/transmilenio.json" with { type: "json" }
import { parseIntentWithOllama } from "./ollama"
import { TransmilenioDataSchema } from "./transmilenio"

const data = TransmilenioDataSchema.parse(snapshot)

/** Simula la respuesta de Ollama con el JSON que "devolvería" el modelo. */
function withModelOutput(content: unknown, run: () => Promise<void>) {
  return async () => {
    const original = globalThis.fetch
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }))
    try {
      await run()
    } finally {
      globalThis.fetch = original
    }
  }
}

const extraction = (fields: Record<string, string>) => ({ intent: "trip", origin: "", destination: "", routeCode: "", ...fields })

test(
  "traduce la salida del modelo a una intención con nombres de los datos",
  withModelOutput(extraction({ origin: "ricaurte", destination: "universidad nacional" }), async () => {
    assert.deepEqual(await parseIntentWithOllama("…", data), {
      type: "trip",
      origin: "Ricaurte",
      destination: "Universidad Nacional",
    })
  }),
)

test(
  "si el modelo nombra un origen que no existe, vuelve a las reglas",
  withModelOutput(extraction({ origin: "Narnia", destination: "Ricaurte" }), async () => {
    assert.equal(await parseIntentWithOllama("…", data), null)
  }),
)

test(
  "si el modelo inventa una ruta, vuelve a las reglas",
  withModelOutput(extraction({ intent: "schedule", routeCode: "Z999" }), async () => {
    assert.equal(await parseIntentWithOllama("…", data), null)
  }),
)

test(
  "si el modelo no devuelve JSON, vuelve a las reglas",
  withModelOutput("no es json", async () => {
    assert.equal(await parseIntentWithOllama("…", data), null)
  }),
)
