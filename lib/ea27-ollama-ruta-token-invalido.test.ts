import assert from "node:assert/strict"
import test from "node:test"
import { URL_TUNEL, conRuta } from "./ea27-prueba-ollama"

/**
 * EA-27 (#53): un token con un salto de línea interno es una cabecera
 * inválida. El `fetch` verdadero lo rechaza con un mensaje que cita el valor
 * completo (`Headers.append: "Bearer ..." is an invalid header value`). Ni ese
 * mensaje ni la respuesta pueden llegar al registro.
 */
const TOKEN_CON_SALTO = "parte-uno-secreta\nparte-dos-secreta"

test("un token con salto de línea interno no se registra ni se devuelve, y la app responde con reglas", async () => {
  await conRuta({ OLLAMA_MODEL: "qwen2.5:3b", OLLAMA_BASE_URL: URL_TUNEL, OLLAMA_TOKEN: TOKEN_CON_SALTO }, { real: true }, async ({ GET, preguntar, registros }) => {
    const get = await (await GET(new Request("http://localhost/api/agent"))).text()
    const post = await preguntar("quiero ir al planeta marte")
    const cuerpo = await post.text()
    assert.equal(post.status, 200)
    assert.equal(JSON.parse(cuerpo).engine, "reglas")
    assert.ok(registros.length > 0, "el fallo del modelo se registra")
    for (const texto of [...registros, cuerpo, get]) {
      assert.ok(!/parte-(uno|dos)-secreta/.test(texto), "ni el token ni un trozo de él")
      assert.ok(!texto.includes("tunel-secreto"), "ni la dirección")
    }
  })
})
