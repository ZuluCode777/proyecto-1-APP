import assert from "node:assert/strict"
import test from "node:test"
import { TOKEN, URL_TUNEL, conRuta, esConsulta } from "./ea27-prueba-ollama"

/**
 * EA-19 (#45) sobre el `POST` real de `/api/agent` con el modelo cargado: el origen pendiente de la petición
 * (`pendiente.origen`) completa «Calle 72» como viaje desde Ricaurte y el modelo, que no ve el pendiente, no se consulta.
 * Sin pendiente, la misma frase sigue yendo al modelo (política de EA-27).
 */
const ENTORNO = { OLLAMA_MODEL: "qwen2.5:3b", OLLAMA_BASE_URL: URL_TUNEL, OLLAMA_TOKEN: TOKEN }
// Lo que contestaría el modelo a «Calle 72»: una ruta que la persona no pidió.
const MODELO_DISTRAIDO = { intent: "route_info", origin: "", destination: "", routeCode: "B23" }

test("modelo listo: «Calle 72» con pendiente Ricaurte es el viaje de las reglas, sin consultar al modelo", async () => {
  await conRuta(ENTORNO, { contenido: MODELO_DISTRAIDO }, async ({ POST, llamadas, fijarModelo }) => {
    await fijarModelo(true)
    const peticion = (cuerpo: object) => POST(new Request("http://localhost/api/agent", { method: "POST", body: JSON.stringify(cuerpo) }))

    const conPendiente = await (await peticion({ message: "Calle 72", pendiente: { origen: "Ricaurte" } })).json()
    assert.equal(llamadas.filter(esConsulta).length, 0, "el modelo no se consulta")
    assert.equal(conPendiente.engine, "reglas")
    assert.match(conPendiente.reply, /entre Ricaurte y Calle 72/)
    assert.equal("aclaracion" in conPendiente, false)

    const sinPendiente = await (await peticion({ message: "Calle 72" })).json()
    assert.equal(llamadas.filter(esConsulta).length, 1, "sin pendiente la frase sí va al modelo")
    assert.equal(sinPendiente.engine, "ollama")
  })
})
