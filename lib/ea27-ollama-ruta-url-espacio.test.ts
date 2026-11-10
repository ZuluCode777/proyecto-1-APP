import assert from "node:assert/strict"
import test from "node:test"
import { TOKEN, conRuta } from "./ea27-prueba-ollama"

/**
 * EA-27 (#53): una dirección con un espacio al final se interpreta bien en la
 * comprobación de seguridad (la URL lo recorta) pero `fetch` recibe
 * `https://tunel-secreto.example /api/chat` y falla con
 * `Failed to parse URL from <la dirección>`. Ese mensaje no puede llegar al
 * registro ni a la respuesta.
 */
test("una dirección con espacio al final no se registra ni se devuelve, y la app responde con reglas", async () => {
  await conRuta(
    { OLLAMA_MODEL: "qwen2.5:3b", OLLAMA_BASE_URL: "https://tunel-secreto.example ", OLLAMA_TOKEN: TOKEN },
    { real: true },
    async ({ GET, preguntar, registros }) => {
      const get = await (await GET(new Request("http://localhost/api/agent"))).text()
      const post = await preguntar("quiero ir al planeta marte")
      const cuerpo = await post.text()
      assert.equal(post.status, 200)
      assert.equal(JSON.parse(cuerpo).engine, "reglas")
      assert.ok(registros.length > 0, "el fallo del modelo se registra")
      for (const texto of [...registros, cuerpo, get]) {
        assert.ok(!texto.includes("tunel-secreto"), "ni la dirección")
        assert.ok(!texto.includes(TOKEN), "ni el token")
      }
    },
  )
})
