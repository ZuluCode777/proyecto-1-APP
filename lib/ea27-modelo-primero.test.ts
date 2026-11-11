import assert from "node:assert/strict"
import test from "node:test"
import snapshot from "../data/transmilenio.json" with { type: "json" }
import {
  TOKEN,
  URL_TUNEL,
  conOllama,
  conRuta,
  copiaDeOllama,
  esConsulta,
  esPrecarga,
  esperarPrecarga,
  type Llamada,
  type OpcionesFetch,
} from "./ea27-prueba-ollama"
import { parseIntent, runIntent, type Intent } from "./local-agent"
import { elegirIntent, requiereModelo } from "./seleccion-interprete"
import { TransmilenioDataSchema } from "./transmilenio"

/**
 * EA-27 (#53), decisión de A1 del 10/11/2026: con el modelo cargado, toda
 * pregunta se consulta al modelo; solo responden las reglas cuando no hay
 * modelo cargado. Excepciones: `metro` y `trip_missing_destination` siempre
 * con reglas, y un `unknown` del modelo no anula la intención de las reglas.
 *
 * Las salidas del modelo simulado son las que devolvió el modelo real
 * (qwen2.5:3b) en la comparación del 10/11/2026 con 36 frases.
 */
const data = TransmilenioDataSchema.parse(snapshot)
const ENTORNO = { OLLAMA_MODEL: "qwen2.5:3b", OLLAMA_BASE_URL: URL_TUNEL, OLLAMA_TOKEN: TOKEN }

const modelo = (intent: string, campos: Record<string, string> = {}) => ({ intent, origin: "", destination: "", routeCode: "", ...campos })
type OpcionesCambio = Pick<OpcionesFetch, "contenido" | "estadoChat">
const consultas = (llamadas: Llamada[]) => llamadas.filter(esConsulta).length
const precargas = (llamadas: Llamada[]) => llamadas.filter(esPrecarga).length
/** Una promesa que deja la precarga simulada en curso hasta llamar a `soltar`. */
function precargaEnCurso() {
  let soltar = () => {}
  const espera = new Promise<void>((resolver) => (soltar = resolver))
  return { espera, soltar }
}

const FRASE_METRO_VIAJE = "quiero ir en metro a la calle 72"
const FRASE_METRO_LINEA = "cómo funciona la línea 2 del metro"
const FRASE_SIN_DESTINO = "salgo desde Ricaurte"

// ── Política pura ──

test("requiereModelo: solo metro y trip_missing_destination se quedan con las reglas", () => {
  const metro = parseIntent(FRASE_METRO_VIAJE, data)
  const sinDestino = parseIntent(FRASE_SIN_DESTINO, data)
  assert.equal(metro.type, "metro")
  assert.equal(sinDestino.type, "trip_missing_destination")
  assert.equal(requiereModelo(metro), false)
  assert.equal(requiereModelo(sinDestino), false)
  for (const intent of [
    { type: "greeting" },
    { type: "help" },
    { type: "cancel" },
    { type: "gps" },
    { type: "frequent" },
    { type: "route_info", routeCode: "B23" },
    { type: "schedule", routeCode: "B23" },
    { type: "trip", destination: "Ricaurte" },
    { type: "unsupported", topic: "tarifas" },
    { type: "unknown" },
  ] satisfies Intent[]) {
    assert.equal(requiereModelo(intent), true, intent.type)
  }
})

test("elegirIntent: una intención conocida del modelo gana a la conocida de las reglas", () => {
  const reglas: Intent = { type: "route_info", routeCode: "B23" }
  const delModelo: Intent = { type: "schedule", routeCode: "B23" }
  assert.deepEqual(elegirIntent(reglas, delModelo), { intent: delModelo, engine: "ollama" })
})

test("elegirIntent: metro y trip_missing_destination son siempre de las reglas, diga lo que diga el modelo", () => {
  for (const [frase, delModelo] of [
    [FRASE_METRO_VIAJE, { type: "trip", destination: "Calle 72" }],
    [FRASE_METRO_LINEA, { type: "route_info", routeCode: "2 M" }],
    [FRASE_SIN_DESTINO, { type: "trip", origin: "Ricaurte", destination: "Las Aguas" }],
  ] satisfies [string, Intent][]) {
    const reglas = parseIntent(frase, data)
    assert.deepEqual(elegirIntent(reglas, delModelo), { intent: reglas, engine: "reglas" }, frase)
  }
})

test("elegirIntent: «cómo funciona» (modelo unknown) se queda con la ayuda de las reglas", () => {
  const reglas = parseIntent("cómo funciona", data)
  assert.equal(reglas.type, "help")
  assert.deepEqual(elegirIntent(reglas, { type: "unknown" }), { intent: reglas, engine: "reglas" })
  assert.deepEqual(elegirIntent(reglas, null), { intent: reglas, engine: "reglas" })
})

test("elegirIntent: «cuándo llega el bus» (reglas unknown) lo responde el modelo", () => {
  const reglas = parseIntent("cuándo llega el bus", data)
  assert.equal(reglas.type, "unknown")
  const delModelo: Intent = { type: "unsupported", topic: "tiempo_real" }
  assert.deepEqual(elegirIntent(reglas, delModelo), { intent: delModelo, engine: "ollama" })
})

// ── Estado «modelo cargado» de lib/ollama.ts ──

test("modeloListo: empieza en falso aunque Ollama esté configurado, y una precarga correcta lo activa", async () => {
  await conOllama(ENTORNO, async (ollama) => {
    assert.equal(ollama.ollamaConfigured(), true)
    assert.equal(ollama.modeloListo(), false)
    await ollama.warmUpOllama()
    assert.equal(ollama.modeloListo(), true)
  })
})

test("modeloListo: una precarga que falla (red o estado HTTP de error) lo desactiva", async () => {
  await conOllama(ENTORNO, async (ollama, _llamadas, opciones) => {
    await ollama.warmUpOllama()
    assert.equal(ollama.modeloListo(), true)

    opciones.precargaFalla = true
    await ollama.warmUpOllama()
    assert.equal(ollama.modeloListo(), false, "error de red")

    opciones.precargaFalla = false
    await ollama.warmUpOllama()
    assert.equal(ollama.modeloListo(), true)

    opciones.estadoChat = 503
    await ollama.warmUpOllama()
    assert.equal(ollama.modeloListo(), false, "estado HTTP de error")
  })
})

test("modeloListo: una consulta correcta lo activa, aunque lo que diga el modelo no sirva", async () => {
  await conOllama(ENTORNO, async (ollama, _llamadas, opciones) => {
    assert.equal(ollama.modeloListo(), false)
    assert.deepEqual(await ollama.parseIntentWithOllama("hola", data), { type: "gps" })
    assert.equal(ollama.modeloListo(), true)

    for (const contenido of ["no es json", modelo("route_info", { routeCode: "Z999" }), { otra: "cosa" }]) {
      opciones.contenido = contenido
      assert.equal(await ollama.parseIntentWithOllama("hola", data), null)
      assert.equal(ollama.modeloListo(), true, JSON.stringify(contenido))
    }
  })
})

test("modeloListo: un 200 que no es de Ollama lo desactiva, en la consulta y en la precarga", async () => {
  await conOllama(ENTORNO, async (ollama, _llamadas, opciones) => {
    const ajenos: [string, Pick<OpcionesFetch, "cuerpo" | "cuerpoCrudo">][] = [
      ["la página de un proxy", { cuerpoCrudo: "<html><body>Entrar</body></html>" }],
      ["JSON sin message", { cuerpo: { sin: "mensaje" } }],
    ]
    for (const [nombre, ajeno] of ajenos) {
      for (const paso of ["consulta", "precarga"]) {
        Object.assign(opciones, { cuerpo: undefined, cuerpoCrudo: undefined })
        await ollama.warmUpOllama()
        assert.equal(ollama.modeloListo(), true, "parte con el modelo cargado")

        Object.assign(opciones, ajeno)
        if (paso === "consulta") await assert.rejects(ollama.parseIntentWithOllama("hola", data))
        else await ollama.warmUpOllama()
        assert.equal(ollama.modeloListo(), false, `${paso}: ${nombre}`)
      }
    }
  })
})

test("modeloListo: una consulta que falla (error de red o estado HTTP de error) lo desactiva", async () => {
  await conOllama(ENTORNO, async (ollama, _llamadas, opciones) => {
    await ollama.warmUpOllama()
    assert.equal(ollama.modeloListo(), true)

    opciones.chatFalla = true
    await assert.rejects(ollama.parseIntentWithOllama("hola", data))
    assert.equal(ollama.modeloListo(), false, "error de red")

    opciones.chatFalla = false
    await ollama.warmUpOllama()
    assert.equal(ollama.modeloListo(), true)

    opciones.estadoChat = 500
    await assert.rejects(ollama.parseIntentWithOllama("hola", data), /HTTP 500/)
    assert.equal(ollama.modeloListo(), false, "estado HTTP de error")
  })
})

test("modeloListo: una respuesta que no llega entera lo desactiva, en la consulta y en la precarga", async () => {
  await conOllama(ENTORNO, async (ollama, _llamadas, opciones) => {
    await ollama.warmUpOllama()
    assert.equal(ollama.modeloListo(), true)

    opciones.cuerpoFalla = true
    await assert.rejects(ollama.parseIntentWithOllama("hola", data))
    assert.equal(ollama.modeloListo(), false, "consulta")

    opciones.cuerpoFalla = false
    await ollama.warmUpOllama()
    assert.equal(ollama.modeloListo(), true)

    opciones.cuerpoFalla = true
    await ollama.warmUpOllama()
    assert.equal(ollama.modeloListo(), false, "precarga")
  })
})

test("modeloListo: lo comparten las copias del módulo, como la del arranque y la de la ruta en el servidor compilado", async () => {
  await conOllama(ENTORNO, async (arranque, llamadas, opciones) => {
    const ruta = await copiaDeOllama()
    assert.equal(ruta.modeloListo(), false)
    await arranque.warmUpOllama()
    assert.equal(ruta.modeloListo(), true, "la precarga del arranque cuenta para la ruta")

    // Una precarga en curso en una copia también lo está para la otra.
    const { espera, soltar } = precargaEnCurso()
    opciones.precargaEspera = espera
    llamadas.length = 0
    const enCurso = arranque.warmUpOllama()
    const repetida = ruta.warmUpOllama()
    soltar()
    await Promise.all([enCurso, repetida])
    assert.equal(precargas(llamadas), 1)
  })
})

test("modeloListo: sin Ollama configurado o con una dirección insegura es falso aunque haya respondido", async () => {
  await conOllama({ ...ENTORNO, OLLAMA_MODEL: "" }, async (ollama) => {
    await ollama.warmUpOllama()
    assert.equal(ollama.modeloListo(), false, "sin modelo")
  })
  await conOllama({ ...ENTORNO, OLLAMA_BASE_URL: "http://tunel-secreto.example" }, async (ollama) => {
    await ollama.warmUpOllama()
    assert.equal(ollama.modeloListo(), false, "http con token")
  })
})

// ── Endpoint real ──

test("modelo listo: una frase que las reglas entienden también se consulta, y la intención del modelo se usa", async () => {
  await conRuta(ENTORNO, { contenido: modelo("schedule", { routeCode: "B23" }) }, async ({ preguntar, llamadas, fijarModelo }) => {
    await fijarModelo(true)
    const reglas = parseIntent("información de la B23", data)
    assert.equal(reglas.type, "route_info")

    const json = await (await preguntar("información de la B23")).json()
    assert.equal(consultas(llamadas), 1)
    assert.equal(json.engine, "ollama")
    const delModelo = runIntent({ type: "schedule", routeCode: "B23" }, { data, engine: "ollama" })
    assert.equal(json.reply, delModelo.reply)
    assert.notEqual(json.reply, runIntent(reglas, { data, engine: "reglas" }).reply, "la prueba distingue modelo de reglas")
  })
})

test("modelo listo: un unknown, una salida inválida o un estado HTTP de error no anulan la intención de las reglas", async () => {
  await conRuta(ENTORNO, {}, async ({ preguntar, llamadas, fijarModelo, ollama, opciones }) => {
    const esperada = runIntent(parseIntent("información de la B23", data), { data, engine: "reglas" })
    const casos: [string, OpcionesCambio][] = [
      ["unknown", { contenido: modelo("unknown") }],
      ["ruta que no existe", { contenido: modelo("route_info", { routeCode: "Z999" }) }],
      ["texto que no es JSON", { contenido: "no es json" }],
      ["estado HTTP 500", { estadoChat: 500 }],
    ]
    for (const [nombre, cambios] of casos) {
      Object.assign(opciones, { contenido: undefined, estadoChat: undefined })
      await fijarModelo(true)
      Object.assign(opciones, cambios)
      const json = await (await preguntar("información de la B23")).json()
      assert.equal(consultas(llamadas), 1, nombre)
      assert.equal(json.engine, "reglas", nombre)
      assert.equal(json.reply, esperada.reply, nombre)
      // Un estado HTTP de error deja el modelo sin cargar; lo demás no.
      assert.equal(ollama.modeloListo(), nombre !== "estado HTTP 500", nombre)
    }
  })
})

test("modelo listo: «cómo funciona» (modelo unknown) responde la ayuda de las reglas; «cuándo llega el bus» (reglas unknown) responde el modelo", async () => {
  await conRuta(ENTORNO, {}, async ({ preguntar, llamadas, fijarModelo, opciones }) => {
    await fijarModelo(true)
    opciones.contenido = modelo("unknown")
    const ayuda = await (await preguntar("cómo funciona")).json()
    assert.equal(consultas(llamadas), 1, "se consultó al modelo")
    assert.equal(ayuda.engine, "reglas")
    assert.equal(ayuda.reply, runIntent({ type: "help" }, { data, engine: "reglas" }).reply)

    opciones.contenido = modelo("realtime")
    const bus = await (await preguntar("cuándo llega el bus")).json()
    assert.equal(consultas(llamadas), 2)
    assert.equal(bus.engine, "ollama")
    assert.equal(bus.reply, runIntent({ type: "unsupported", topic: "tiempo_real" }, { data, engine: "ollama" }).reply)
  })
})

test("modelo listo: metro y trip_missing_destination no consultan al modelo, aunque respondería otra cosa", async () => {
  await conRuta(ENTORNO, {}, async ({ preguntar, llamadas, fijarModelo, opciones }) => {
    await fijarModelo(true)
    const casos: [string, unknown][] = [
      [FRASE_METRO_VIAJE, modelo("trip", { destination: "Calle 72" })],
      [FRASE_METRO_LINEA, modelo("route_info", { routeCode: "2 M" })],
      [FRASE_SIN_DESTINO, modelo("trip", { origin: "Ricaurte", destination: "Las Aguas" })],
    ]
    for (const [frase, delModelo] of casos) {
      opciones.contenido = delModelo
      const reglas = runIntent(parseIntent(frase, data), { data, engine: "reglas" })
      const json = await (await preguntar(frase)).json()
      assert.equal(consultas(llamadas), 0, frase)
      assert.equal(json.engine, "reglas", frase)
      assert.equal(json.action, reglas.action, frase)
      assert.equal(json.reply, reglas.reply, frase)
    }
  })
})

test("modelo no cargado: no se consulta, responden las reglas y se lanza una precarga", async () => {
  await conRuta(ENTORNO, {}, async ({ preguntar, llamadas, fijarModelo, ollama }) => {
    await fijarModelo(false)
    assert.equal(ollama.modeloListo(), false)
    for (const frase of ["información de la B23", "cuándo llega el bus", FRASE_METRO_VIAJE, "explícame la teoría de la relatividad por favor"]) {
      llamadas.length = 0
      const json = await (await preguntar(frase)).json()
      assert.equal(consultas(llamadas), 0, frase)
      assert.equal(precargas(llamadas), 1, `${frase}: una precarga`)
      assert.equal(json.engine, "reglas", frase)
      assert.equal(json.reply, runIntent(parseIntent(frase, data), { data, engine: "reglas" }).reply, frase)
      // Deja terminar la precarga fallida antes de la frase siguiente.
      await new Promise((resolver) => setImmediate(resolver))
    }
  })
})

test("modelo no cargado: la respuesta no espera a la precarga, y mientras dura no se lanza otra", async () => {
  await conRuta(ENTORNO, {}, async ({ preguntar, llamadas, fijarModelo, ollama, opciones }) => {
    await fijarModelo(false)
    opciones.precargaFalla = false
    const { espera, soltar } = precargaEnCurso()
    opciones.precargaEspera = espera
    try {
      // Si la ruta esperara la precarga, estas preguntas no terminarían.
      for (const frase of ["información de la B23", "cuándo llega el bus"]) {
        const respuesta = await Promise.race([
          preguntar(frase),
          new Promise<never>((_resolver, rechazar) => setTimeout(() => rechazar(new Error(`«${frase}» esperó a la precarga`)), 1_000).unref()),
        ])
        const json = await respuesta.json()
        assert.equal(json.engine, "reglas", frase)
      }
      assert.equal(consultas(llamadas), 0)
      assert.equal(precargas(llamadas), 1, "una sola precarga para las dos preguntas")
      assert.equal(ollama.modeloListo(), false, "sin cargar mientras la precarga no termina")
    } finally {
      soltar()
      opciones.precargaEspera = undefined
    }

    await ollama.warmUpOllama()
    assert.equal(ollama.modeloListo(), true)
    const json = await (await preguntar("información de la B23")).json()
    assert.equal(json.engine, "ollama", "con la precarga terminada, responde el modelo")
  })
})

test("un 200 que no es de Ollama: tras la primera consulta responden las reglas sin volver a consultar", async () => {
  await conRuta(ENTORNO, {}, async ({ preguntar, llamadas, fijarModelo, ollama, opciones }) => {
    const ajenos: [string, Pick<OpcionesFetch, "cuerpo" | "cuerpoCrudo">][] = [
      ["la página de un proxy", { cuerpoCrudo: "<html><body>Entrar</body></html>" }],
      ["JSON sin message", { cuerpo: { sin: "mensaje" } }],
    ]
    for (const [nombre, ajeno] of ajenos) {
      Object.assign(opciones, { cuerpo: undefined, cuerpoCrudo: undefined })
      await fijarModelo(true)
      Object.assign(opciones, ajeno)
      for (let pregunta = 1; pregunta <= 3; pregunta++) {
        const json = await (await preguntar("información de la B23")).json()
        assert.equal(json.engine, "reglas", `${nombre}, pregunta ${pregunta}`)
        // Solo la precarga que lanzó la pregunta: la prueba no lanza ninguna.
        await esperarPrecarga()
      }
      assert.equal(consultas(llamadas), 1, `${nombre}: solo la primera pregunta consulta al modelo`)
      assert.equal(ollama.modeloListo(), false, nombre)
    }
  })
})

test("tras un fallo de la consulta no se vuelve a consultar hasta que una precarga salga bien", async () => {
  await conRuta(ENTORNO, {}, async ({ preguntar, llamadas, fijarModelo, ollama, opciones }) => {
    await fijarModelo(true)
    opciones.contenido = modelo("schedule", { routeCode: "B23" })
    const reglas = runIntent(parseIntent("información de la B23", data), { data, engine: "reglas" })

    // La consulta falla: responden las reglas y se lanza la precarga, que también falla.
    opciones.chatFalla = true
    opciones.precargaFalla = true
    const fallida = await (await preguntar("información de la B23")).json()
    assert.equal(consultas(llamadas), 1, "se intentó la consulta")
    assert.equal(precargas(llamadas), 1, "se lanzó la precarga")
    assert.equal(fallida.engine, "reglas")
    assert.equal(fallida.reply, reglas.reply)
    await ollama.warmUpOllama()
    assert.equal(ollama.modeloListo(), false)

    // Aunque la consulta ya funcionaría, no se intenta mientras no haya una precarga correcta.
    opciones.chatFalla = false
    llamadas.length = 0
    const siguiente = await (await preguntar("información de la B23")).json()
    assert.equal(consultas(llamadas), 0, "sin consulta hasta que cargue")
    assert.equal(precargas(llamadas), 1, "vuelve a intentar la precarga")
    assert.equal(siguiente.engine, "reglas")

    // Una precarga correcta devuelve el modelo.
    await fijarModelo(true)
    const recuperada = await (await preguntar("información de la B23")).json()
    assert.equal(consultas(llamadas), 1, "vuelve a consultar al modelo")
    assert.equal(recuperada.engine, "ollama")
  })
})
