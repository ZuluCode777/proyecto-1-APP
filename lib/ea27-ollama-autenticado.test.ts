import assert from "node:assert/strict"
import test from "node:test"
import snapshot from "../data/transmilenio.json" with { type: "json" }
import { TOKEN, URL_TUNEL, conOllama, conRuta, esConsulta, esPrecarga } from "./ea27-prueba-ollama"
import { TransmilenioDataSchema } from "./transmilenio"

/**
 * EA-27 (#53): Ollama detrás de un proxy con token. Casos de la copia fresca
 * del módulo y un caso de ruta con dirección https y fallo del modelo. Los
 * demás casos de ruta están en `ea27-ollama-ruta-*.test.ts`, uno por entorno
 * (ver `ea27-prueba-ollama.ts`).
 */
const data = TransmilenioDataSchema.parse(snapshot)
const base = { OLLAMA_MODEL: "qwen2.5:3b", OLLAMA_BASE_URL: URL_TUNEL }
const bearer = `Bearer ${TOKEN}`

test("con token, las tres llamadas a Ollama envían Authorization: Bearer y redirect error", async () => {
  await conOllama({ ...base, OLLAMA_TOKEN: TOKEN }, async (ollama, llamadas) => {
    await ollama.warmUpOllama()
    assert.equal(llamadas.length, 1)
    assert.ok(llamadas[0].url.endsWith("/api/chat"))
    assert.equal(llamadas[0].autorizacion, bearer)
    assert.equal(llamadas[0].redirect, "error")

    llamadas.length = 0
    assert.deepEqual(await ollama.ollamaStatus(), { reachable: true, hasModel: true })
    // `ollamaStatus` lanza el `warmUpOllama` sin esperarlo, pero su `fetch` se llama de forma síncrona.
    assert.deepEqual(llamadas.map((l) => l.url.split("/api/")[1]).sort(), ["chat", "tags"])
    assert.ok(llamadas.every((l) => l.autorizacion === bearer && l.redirect === "error"))

    llamadas.length = 0
    assert.deepEqual(await ollama.parseIntentWithOllama("dónde estoy", data), { type: "gps" })
    assert.equal(llamadas.length, 1)
    assert.equal(llamadas[0].autorizacion, bearer)
    assert.equal(llamadas[0].redirect, "error")
  })
})

test("se conservan los plazos (60 s, 3 s, 4,5 s) y el keep_alive de 24 h", async () => {
  await conOllama({ ...base, OLLAMA_TOKEN: TOKEN }, async (ollama, llamadas) => {
    await ollama.warmUpOllama()
    assert.equal(llamadas[0].plazoMs, 60_000)
    assert.equal(llamadas[0].cuerpo?.keep_alive, "24h")

    llamadas.length = 0
    await ollama.ollamaStatus()
    const tags = llamadas.find((l) => l.url.endsWith("/api/tags"))
    assert.equal(tags?.plazoMs, 3_000)

    llamadas.length = 0
    await ollama.parseIntentWithOllama("dónde estoy", data)
    // Cabe en la espera de los clientes: 6 s en la web, 12 s en la app de iPhone.
    assert.equal(llamadas[0].plazoMs, 4_500)
    assert.equal(llamadas[0].cuerpo?.keep_alive, "24h")
  })
})

test("solo hay una precarga a la vez", async () => {
  await conOllama({ ...base, OLLAMA_TOKEN: TOKEN }, async (ollama, llamadas) => {
    const primera = ollama.warmUpOllama()
    const segunda = ollama.warmUpOllama()
    assert.equal(primera, segunda, "la segunda reutiliza la que está en curso")
    await primera
    assert.equal(llamadas.filter(esPrecarga).length, 1)

    await ollama.warmUpOllama()
    assert.equal(llamadas.filter(esPrecarga).length, 2, "terminada la anterior, se puede precargar de nuevo")
  })
})

for (const [nombre, token] of [["ausente", undefined], ["vacío", ""], ["solo espacios", "  "]] as const) {
  test(`token ${nombre}: no se envía Authorization y el uso local no cambia`, async () => {
    await conOllama({ OLLAMA_MODEL: "qwen2.5:3b", OLLAMA_BASE_URL: "http://127.0.0.1:11435", OLLAMA_TOKEN: token }, async (ollama, llamadas) => {
      assert.equal(ollama.ollamaConfigured(), true)
      await ollama.warmUpOllama()
      await ollama.ollamaStatus()
      await ollama.parseIntentWithOllama("dónde estoy", data)
      assert.equal(llamadas.length, 4)
      assert.ok(llamadas.every((l) => l.autorizacion === null))
    })
  })
}

test("sin token, una dirección http no local sigue configurada (sin cambios)", async () => {
  await conOllama({ OLLAMA_MODEL: "qwen2.5:3b", OLLAMA_BASE_URL: "http://192.168.1.50:11435" }, async (ollama) => {
    assert.equal(ollama.ollamaConfigured(), true)
  })
})

for (const direccion of [
  "http://tunel-secreto.example",
  "http://192.168.1.50:11435",
  "http://localhost.tunel-secreto.example",
  "http://127.0.0.1.tunel-secreto.example",
  "no es una dirección",
  "ftp://127.0.0.1",
  // Con usuario o clave en la dirección: la clave iría en cada mensaje de error.
  "https://usuario:clave-secreta@tunel-secreto.example",
  "https://:clave-secreta@tunel-secreto.example",
  "http://usuario@127.0.0.1:11435",
  // Parecen locales y no lo son.
  "http://127.0.0.1@evil.example",
  "http://localhost.",
  "http://0.0.0.0",
  "http://[::ffff:127.0.0.1]",
]) {
  test(`con token, ${direccion} no es segura: sin Ollama y sin enviar nada`, async () => {
    await conOllama({ OLLAMA_MODEL: "qwen2.5:3b", OLLAMA_BASE_URL: direccion, OLLAMA_TOKEN: TOKEN }, async (ollama, llamadas) => {
      assert.equal(ollama.ollamaConfigured(), false)
      await ollama.warmUpOllama()
      assert.deepEqual(await ollama.ollamaStatus(), { reachable: false, hasModel: false })
      await assert.rejects(ollama.parseIntentWithOllama("dónde estoy", data), (error: Error) => {
        assert.ok(!error.message.includes(TOKEN) && !error.message.includes("clave-secreta") && !error.message.includes("tunel-secreto"))
        return true
      })
      assert.deepEqual(llamadas, [], "no sale ninguna petición")
    })
  })
}

for (const direccion of [
  "http://127.0.0.1:11435",
  "http://localhost:11435",
  "http://[::1]:11435",
  // Se normalizan a las formas locales de arriba.
  "HTTP://LOCALHOST",
  "http://[0:0:0:0:0:0:0:1]",
  URL_TUNEL,
]) {
  test(`con token, ${direccion} es segura y envía el token`, async () => {
    await conOllama({ OLLAMA_MODEL: "qwen2.5:3b", OLLAMA_BASE_URL: direccion, OLLAMA_TOKEN: TOKEN }, async (ollama, llamadas) => {
      assert.equal(ollama.ollamaConfigured(), true)
      await ollama.parseIntentWithOllama("dónde estoy", data)
      assert.equal(llamadas[0].autorizacion, bearer)
    })
  })
}

test("GET /api/agent no expone el token ni la dirección, y un fallo del modelo no los registra y responde con reglas", async () => {
  await conRuta({ ...base, OLLAMA_TOKEN: TOKEN }, { chatFalla: true }, async ({ GET, preguntar, registros, llamadas, fijarModelo }) => {
    const respuesta = await GET(new Request("http://localhost/api/agent"))
    const texto = await respuesta.text()
    assert.deepEqual(JSON.parse(texto), { engine: "ollama", model: "qwen2.5:3b", reachable: true, hasModel: true })
    assert.ok(!texto.includes(TOKEN) && !texto.includes("tunel-secreto"))

    // Con el modelo cargado se le consulta, y la consulta falla como la real:
    // la dirección viaja en `cause`.
    await fijarModelo(true)
    const post = await preguntar("quiero ir al planeta marte")
    assert.equal(llamadas.filter(esConsulta).length, 1, "se consultó al modelo")
    // Sin esto, un modelo sin cargar no se cargaría nunca: cada pregunta agota
    // la espera y aborta la carga.
    assert.equal(llamadas.filter(esPrecarga).length, 1, "tras el fallo se precarga el modelo")
    const cuerpo = await post.text()
    assert.equal(post.status, 200)
    assert.equal(JSON.parse(cuerpo).engine, "reglas", "el respaldo de reglas sigue funcionando")
    assert.ok(registros.length > 0, "el fallo del modelo se registra")
    assert.ok(![...registros, cuerpo].some((t) => t.includes(TOKEN) || t.includes("tunel-secreto")))
  })
})
