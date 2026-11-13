import assert from "node:assert/strict"
import test from "node:test"
import snapshot from "../data/transmilenio.json" with { type: "json" }
import { AgentReplySchema, parseIntent, runIntent } from "./local-agent"
import { conOrigenPendiente, requiereModelo } from "./seleccion-interprete"
import { TransmilenioDataSchema } from "./transmilenio"

// EA-19 (#45): aclaración entre turnos. El servidor no guarda historial: el origen pendiente
// viaja en la respuesta (`aclaracion`) y vuelve en la petición siguiente (`pendiente`).

const datos = TransmilenioDataSchema.parse(snapshot)
const ahora = new Date("2026-11-11T10:00:00-05:00")

function responder(frase: string, origenPendiente?: string) {
  const intent = conOrigenPendiente(parseIntent(frase, datos), origenPendiente)
  return { intent, respuesta: runIntent(intent, { data: datos, context: { now: ahora } }) }
}

test("«Salgo desde Ricaurte» pide el destino y deja el origen en la aclaración", () => {
  const { respuesta } = responder("Salgo desde Ricaurte")
  assert.equal(respuesta.action, "none")
  assert.deepEqual(respuesta.aclaracion, { origen: "Ricaurte" })
  assert.deepEqual(AgentReplySchema.parse(respuesta), respuesta)
})

test("«Calle 72» con el origen pendiente es el viaje desde Ricaurte, no una búsqueda sin origen", () => {
  const solo = responder("Calle 72")
  assert.equal(solo.intent.type, "trip")
  assert.equal(solo.respuesta.action, "search", "sin pendiente solo lista rutas que pasan por la estación")

  const { intent, respuesta } = responder("Calle 72", "Ricaurte")
  assert.deepEqual(intent, { type: "trip", origin: "Ricaurte", destination: "Calle 72" })
  assert.match(respuesta.reply, /entre Ricaurte y Calle 72/)
  assert.equal(respuesta.reply.includes("dime desde dónde sales"), false)
  assert.equal("aclaracion" in respuesta, false, "un viaje completo ya no deja nada pendiente")
})

test("el origen pendiente no sustituye uno que la persona dijo ahora", () => {
  const { intent } = responder("de Portal Norte a Calle 72", "Ricaurte")
  assert.equal(intent.type, "trip")
  assert.equal(intent.type === "trip" && intent.origin, "Portal Norte")
})

test("el origen pendiente ignora otras intenciones", () => {
  for (const frase of ["cancela", "ayuda", "información de la ruta B23", "hola"]) {
    assert.deepEqual(conOrigenPendiente(parseIntent(frase, datos), "Ricaurte"), parseIntent(frase, datos), frase)
  }
})

test("un origen explícito pendiente nunca pasa a ser el GPS", () => {
  const posicion = { lat: 4.65, lng: -74.1, precision: 10, hora: ahora.getTime() }
  const intent = conOrigenPendiente(parseIntent("Calle 72", datos), "Ricaurte")
  const { reply } = runIntent(intent, { data: datos, context: { position: posicion, now: ahora } })
  assert.equal(reply.includes("tu ubicación como origen"), false)
})

test("un origen pendiente fuera del catálogo se pide aclarar, no se reemplaza", () => {
  const { respuesta } = responder("Calle 72", "Narnia")
  assert.equal(respuesta.action, "none")
  assert.match(respuesta.reply, /No encontré la estación de origen Narnia/)
})

test("con origen pendiente, un viaje sin origen lo resuelven las reglas y no se consulta al modelo", () => {
  const calle72 = parseIntent("Calle 72", datos)
  assert.equal(calle72.type, "trip")
  assert.equal(requiereModelo(calle72), true, "sin pendiente el modelo sigue consultándose")
  assert.equal(requiereModelo(calle72, "Ricaurte"), false)
  // Un origen dicho ahora y cualquier otra intención no cambian: siguen la política de siempre.
  assert.equal(requiereModelo(parseIntent("de Portal Norte a Calle 72", datos), "Ricaurte"), true)
  assert.equal(requiereModelo(parseIntent("información de la ruta B23", datos), "Ricaurte"), true)
})
