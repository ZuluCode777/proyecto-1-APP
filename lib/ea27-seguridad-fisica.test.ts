import assert from "node:assert/strict"
import test from "node:test"
import snapshot from "../data/transmilenio.json" with { type: "json" }
import { AgentReplySchema, interpretCommand, parseIntent, runIntent, type Intent } from "./local-agent"
import { parseIntentWithOllama } from "./ollama"
import { RESPUESTA_SEGURIDAD_FISICA } from "./seguridad-fisica"
import { elegirIntent, intencionUsaUbicacion, requiereModelo } from "./seleccion-interprete"
import { TransmilenioDataSchema } from "./transmilenio"

/**
 * EA-27 (#53): guardia determinista de seguridad física. Medido con el modelo
 * real, «¿ya puedo cruzar la calle?» y «¿está libre el andén? ¿puedo subir ya?»
 * salían como `gps` con «Voy a abrir el GPS auditivo para guiarte…», que una
 * persona ciega puede oír como luz verde.
 */
const data = TransmilenioDataSchema.parse(snapshot)

const POSITIVAS = [
  "¿ya puedo cruzar la calle?",
  "¿está libre el andén? ¿puedo subir ya?",
  "¿es seguro cruzar?",
  "¿puedo pasar la calle?",
  "¿puedo cruzar ahora?",
  "¿ya cruzo?",
  "¿el semáforo está en verde?",
  "¿ya cambió el semáforo?",
  "¿viene un carro?",
  "¿viene algún bus?",
  "¿hay una moto cerca?",
  "¿está libre el andén?",
  "¿está despejada la puerta?",
  "¿hay espacio?",
  "¿hay espacio en el bus?",
  "¿puedo subir ya?",
  "¿puedo subir?",
  "¿me subo?",
  "¿ya me subo?",
  "¿hay algo adelante?",
  "¿hay escalones enfrente?",
  "¿es seguro avanzar?",
  "¿está libre el camino?",
]

const NEGATIVAS: [string, Intent["type"]][] = [
  ["cómo cruzo a la estación Ricaurte", "trip"],
  ["dónde está el puente para cruzar a la estación", "unknown"],
  ["cuándo llega el B23", "route_info"],
  ["quiero subir al metro en la calle 72", "metro"],
  ["cómo llego de Ricaurte a Calle 72", "trip"],
  ["dónde estoy", "gps"],
  ["horario de la B23", "schedule"],
  ["qué rutas pasan por la calle 72", "trip"],
  ["quiero subir en Ricaurte", "trip"],
  ["cómo funciona la línea 2 del metro", "metro"],
  ["información de la ruta B23", "route_info"],
  ["hola", "greeting"],
  ["cuál es la estación más cercana", "gps"],
]

test("positivas: cada pregunta de permiso físico es seguridad_fisica", () => {
  assert.ok(POSITIVAS.length >= 10)
  for (const frase of POSITIVAS) assert.equal(parseIntent(frase, data).type, "seguridad_fisica", frase)
})

test("negativas: la navegación que solo contiene las palabras conserva su intención", () => {
  assert.ok(NEGATIVAS.length >= 8)
  // Los tipos son los que las reglas daban antes de la guardia: no cambian.
  for (const [frase, tipo] of NEGATIVAS) assert.equal(parseIntent(frase, data).type, tipo, frase)
})

test("la respuesta es fija: sin acción, sin pasos, sin sí ni no ni «camino libre»", () => {
  for (const frase of POSITIVAS) {
    const respuesta = interpretCommand(frase, data)
    assert.equal(respuesta.reply, RESPUESTA_SEGURIDAD_FISICA, frase)
    assert.equal(respuesta.action, "none", frase)
    assert.deepEqual(respuesta.steps, [], frase)
    assert.equal(respuesta.engine, "reglas", frase)
    assert.equal(AgentReplySchema.safeParse(respuesta).success, true, frase)
  }
  const texto = RESPUESTA_SEGURIDAD_FISICA.toLowerCase()
  assert.match(texto, /no puedo saber si es seguro/)
  assert.match(texto, /no veo el tráfico, el semáforo, el andén ni el bus/)
  assert.match(texto, /semáforo sonoro/)
  assert.match(texto, /alguien cerca/)
  assert.match(texto, /personal de transmilenio/)
  assert.doesNotMatch(texto, /camino libre|\bsí\b|guiarte|abro|puedes cruzar|puedes subir|adelante/)
})

test("solo reglas: el modelo nunca se consulta ni puede anular la guardia", () => {
  const reglas = parseIntent("¿ya puedo cruzar la calle?", data)
  assert.equal(requiereModelo(reglas), false)
  assert.equal(intencionUsaUbicacion(reglas), false)
  for (const delModelo of [{ type: "gps" }, { type: "trip", destination: "Ricaurte" }, { type: "unknown" }] satisfies Intent[]) {
    assert.deepEqual(elegirIntent(reglas, delModelo), { intent: reglas, engine: "reglas" })
  }
  assert.deepEqual(runIntent(reglas, { data, engine: "reglas" }).reply, RESPUESTA_SEGURIDAD_FISICA)
})

test("el prompt del modelo excluye la seguridad física de gps y la manda a unknown", async () => {
  const original = globalThis.fetch
  let sistema = ""
  globalThis.fetch = async (_url, init) => {
    const cuerpo = JSON.parse(String(init?.body)) as { messages: { role: string; content: string }[] }
    sistema = cuerpo.messages.find((m) => m.role === "system")?.content ?? ""
    return new Response(JSON.stringify({ message: { content: JSON.stringify({ intent: "unknown", origin: "", destination: "", routeCode: "" }) } }))
  }
  try {
    await parseIntentWithOllama("…", data)
  } finally {
    globalThis.fetch = original
  }
  assert.match(sistema, /- gps: .*No es gps si pregunta si puede cruzar o subir/)
  assert.match(sistema, /- unknown: .*seguridad física/)
})
