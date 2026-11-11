import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import snapshot from "../data/transmilenio.json" with { type: "json" }
import { AgentReplySchema, interpretCommand, parseIntent } from "./local-agent"
import { catalogoAntiguo, procedenciaCatalogo, TransmilenioDataSchema, VIGENCIA_CATALOGO_VIVO_MS } from "./transmilenio"

// EA-17 (#43): procedencia del catálogo en la respuesta, para el cliente de iPhone.

const copia = TransmilenioDataSchema.parse(snapshot)
const ahora = new Date("2026-11-11T10:00:00-05:00")
const enVivo = { ...copia, source: "live" as const, fetchedAt: "2026-11-11T09:00:00-05:00" }

test("catalogoAntiguo: la copia guardada, un dato en vivo vencido y una fecha inválida son antiguos", () => {
  const consultado = Date.parse(enVivo.fetchedAt)
  assert.equal(catalogoAntiguo(enVivo, ahora), false)
  assert.equal(catalogoAntiguo(enVivo, new Date(consultado + VIGENCIA_CATALOGO_VIVO_MS)), false)
  assert.equal(catalogoAntiguo(enVivo, new Date(consultado + VIGENCIA_CATALOGO_VIVO_MS + 1)), true)
  assert.equal(catalogoAntiguo({ source: "snapshot", fetchedAt: enVivo.fetchedAt }, ahora), true)
  assert.equal(catalogoAntiguo({ source: "live", fetchedAt: "no-es-fecha" }, ahora), true)
})

test("una respuesta con datos lleva la procedencia del catálogo y si es antiguo", () => {
  const reciente = interpretCommand("información de la ruta B23", enVivo, { now: ahora })
  assert.equal(reciente.action, "route")
  assert.deepEqual(reciente.catalogo, { procedencia: procedenciaCatalogo(enVivo), antiguo: false })
  assert.ok(reciente.reply.endsWith(procedenciaCatalogo(enVivo)), "el texto conserva la misma frase")
  assert.deepEqual(AgentReplySchema.parse(reciente), reciente)

  const guardada = interpretCommand("información de la ruta B23", copia, { now: ahora })
  assert.deepEqual(guardada.catalogo, { procedencia: procedenciaCatalogo(copia), antiguo: true })

  const vencida = interpretCommand("información de la ruta B23", enVivo, { now: new Date("2026-11-12T10:00:00-05:00") })
  assert.equal(vencida.catalogo?.antiguo, true)
})

test("una respuesta sin datos del catálogo no lleva procedencia", () => {
  for (const frase of ["hola", "metro", "ayuda", "dónde estoy"]) {
    assert.equal("catalogo" in interpretCommand(frase, copia, { now: ahora }), false, frase)
  }
})

test("contrato iOS: los fixtures válidos de FixturesHTTP.swift cumplen AgentReplySchema", () => {
  const swift = readFileSync(new URL("../ios/TransMiVozTests/FixturesHTTP.swift", import.meta.url), "utf8")
  const fixtures = [...swift.matchAll(/\/\/ FIXTURE-INICIO (\w+)\n\s*static let \1 = #"""\n\s*(.+)\n\s*"""#\n\s*\/\/ FIXTURE-FIN/g)]
  assert.ok(fixtures.length >= 6, `solo se leyeron ${fixtures.length} fixtures`)
  for (const [, nombre, json] of fixtures) {
    assert.equal(AgentReplySchema.safeParse(JSON.parse(json)).success, true, nombre)
  }
})

test("contrato iOS: el prefijo del escenario Metro hace que el servidor trate la frase como Metro", () => {
  const swift = readFileSync(new URL("../ios/TransMiVoz/Dominio/EscenarioConsulta.swift", import.meta.url), "utf8")
  const prefijo = /case \.metroFuturo: return "([^"]+)"/.exec(swift)?.[1]
  assert.equal(prefijo, "Metro: ")
  for (const frase of ["Calle 72", "estaciones", "Ricaurte", "de Ricaurte a Calle 72", "cuánto cuesta"]) {
    assert.equal(parseIntent(`${prefijo}${frase}`, copia).type, "metro", frase)
    const respuesta = interpretCommand(`${prefijo}${frase}`, copia, { now: ahora })
    assert.equal(respuesta.action, "none", frase)
    assert.equal("catalogo" in respuesta, false, frase)
  }
})
