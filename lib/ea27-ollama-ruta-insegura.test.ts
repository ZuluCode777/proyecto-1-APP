import assert from "node:assert/strict"
import test from "node:test"
import { TOKEN, conRuta } from "./ea27-prueba-ollama"

/**
 * EA-27 (#53): con token, una dirección insegura (aquí, con usuario y clave)
 * deja a Ollama como no configurado: `GET /api/agent` informa el motor de
 * reglas, el `POST` responde con reglas y no sale ninguna petición a Ollama.
 * Nada de la dirección ni de su clave llega a la respuesta ni al registro.
 */
test("dirección con usuario y clave más token: motor de reglas, sin peticiones y sin filtraciones", async () => {
  await conRuta(
    { OLLAMA_MODEL: "qwen2.5:3b", OLLAMA_BASE_URL: "https://usuario:clave-secreta@tunel-secreto.example", OLLAMA_TOKEN: TOKEN },
    {},
    async ({ GET, preguntar, llamadas, registros }) => {
      const get = await (await GET(new Request("http://localhost/api/agent"))).text()
      assert.deepEqual(JSON.parse(get), { engine: "reglas" })

      const post = await preguntar("quiero ir al planeta marte")
      const cuerpo = await post.text()
      assert.equal(post.status, 200)
      assert.equal(JSON.parse(cuerpo).engine, "reglas")
      assert.deepEqual(llamadas, [], "no se contacta a Ollama")
      for (const texto of [...registros, cuerpo, get]) {
        assert.ok(!/clave-secreta|tunel-secreto/.test(texto), "ni la dirección ni su clave")
        assert.ok(!texto.includes(TOKEN), "ni el token")
      }
    },
  )
})
