import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { AnunciosRespuestaSchema } from "./anuncios"

// EA-26 (#52): el cliente de iPhone decodifica `GET /api/anuncios`. Sus fixtures deben cumplir el esquema real.

test("contrato iOS: los fixtures de FixturesAnuncios.swift cumplen AnunciosRespuestaSchema", () => {
  const swift = readFileSync(new URL("../ios/TransMiVozTests/FixturesAnuncios.swift", import.meta.url), "utf8")
  const fixtures = [...swift.matchAll(/\/\/ FIXTURE-INICIO (\w+)\n\s*static let \1 = #"""\n\s*(.+)\n\s*"""#\n\s*\/\/ FIXTURE-FIN/g)]
  assert.deepEqual(fixtures.map(([, nombre]) => nombre), ["activa", "sinFuente", "degradada"])
  for (const [, nombre, json] of fixtures) {
    assert.equal(AnunciosRespuestaSchema.safeParse(JSON.parse(json)).success, true, nombre)
  }
})
