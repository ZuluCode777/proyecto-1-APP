import assert from "node:assert/strict"
import test from "node:test"
import snapshot from "../data/transmilenio.json" with { type: "json" }
import { interpretCommand, parseIntent } from "./local-agent"
import type { TransmilenioData } from "./transmilenio"

const data = snapshot as TransmilenioData

test("entiende frases habituales", () => {
  const cases: [string, string][] = [
    ["hola, buenos días", "greeting"],
    ["¿qué puedes hacer?", "help"],
    ["cancela", "cancel"],
    ["mis rutas de siempre", "frequent"],
    ["¿dónde estoy?", "gps"],
    ["información de la ruta B23", "route_info"],
    ["¿a qué hora pasa la H54?", "schedule"],
    ["¿cuánto cuesta el pasaje?", "unsupported"],
    ["quiero ir a Ricaurte", "trip"],
    ["cómo llego de Ricaurte a Calle 72", "trip"],
    ["blablá", "unknown"],
  ]
  for (const [phrase, expected] of cases) {
    assert.equal(parseIntent(phrase, data).type, expected, phrase)
  }
})

test("un saludo no se confunde con una búsqueda fallida", () => {
  const reply = interpretCommand("hola, buenos días", data)
  assert.equal(reply.action, "none")
  assert.match(reply.reply, /^¡Hola!/)
})

test("toma origen y destino en el orden en que se dicen", () => {
  assert.deepEqual(parseIntent("de Ricaurte a Calle 72", data), {
    type: "trip",
    origin: "Ricaurte",
    destination: "Calle 72",
  })
})

test("planea un viaje directo con datos reales y deja los pasos", () => {
  const reply = interpretCommand("cómo llego de Portal Usme a Molinos", data)
  assert.equal(reply.action, "trip")
  assert.equal(reply.trip?.length, 1)
  assert.match(reply.reply, /^Toma la \S+ en Portal Usme y bájate en Molinos/)
  assert.ok(reply.steps.length >= 3, "debe registrar los pasos")
})

test("sin origen ni ubicación, lista las rutas que pasan por el destino", () => {
  const reply = interpretCommand("quiero ir a Ricaurte", data)
  assert.equal(reply.action, "search")
  assert.equal(reply.query, "Ricaurte")
  assert.match(reply.reply, /rutas pasan por Ricaurte/)
})

test("con ubicación, usa la estación más cercana como origen", () => {
  // Frente a la estación Portal Usme.
  const position = { lat: data.stations.find((s) => s.name === "Portal Usme")!.lat, lng: data.stations.find((s) => s.name === "Portal Usme")!.lng }
  const reply = interpretCommand("llévame a Molinos", data, { position })
  assert.equal(reply.action, "trip")
  assert.ok(reply.steps.some((s) => s.label === "Usé tu ubicación"))
})

test("responde el horario real de una ruta", () => {
  const route = data.routes.find((r) => r.code === "H54")!
  const reply = interpretCommand("¿a qué hora pasa la H54?", data)
  assert.equal(reply.action, "route")
  assert.ok(reply.reply.includes(route.schedule.weekday))
})

test("no inventa estaciones", () => {
  const reply = interpretCommand("quiero ir a Narnia", data)
  assert.equal(reply.action, "none")
})
