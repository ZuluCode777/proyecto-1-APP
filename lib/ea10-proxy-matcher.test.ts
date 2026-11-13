import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"

/**
 * Regresión de EA-10 (#36): el `proxy` deja fuera ÚNICAMENTE `/api/agent` exacto
 * (su manejador aplica la misma guardia). Todo lo demás, incluidos los recursos
 * estáticos de Next que antes estaban protegidos, sigue pasando por el `proxy`.
 * El matcher de Next es `/` + un grupo con expresión regular sobre la ruta. Se
 * lee del código fuente porque `proxy.ts` importa `next/server`, que Node no
 * resuelve en estas pruebas, y Next exige que el matcher sea un literal.
 */
const literal = /matcher:\s*\[("(?:[^"\\]|\\.)*")\]/.exec(readFileSync("proxy.ts", "utf8"))?.[1]
assert.ok(literal, "proxy.ts declara config.matcher como literal")
const matcher: string = JSON.parse(literal)
const pasaPorElProxy = (ruta: string) => new RegExp(`^${matcher}$`).test(ruta)

test("solo /api/agent exacto (con o sin barra final) queda fuera del proxy", () => {
  assert.equal(pasaPorElProxy("/api/agent"), false)
  assert.equal(pasaPorElProxy("/api/agent/"), false)
})

test("el resto conserva la protección: UI, otras APIs, variantes de /api/agent y estáticos de Next", () => {
  for (const ruta of [
    "/",
    "/diagnostico",
    "/api/transmilenio",
    "/api/anuncios",
    "/api/planificador",
    "/api/agentx",
    "/api/agent/sub",
    "/_next/static/chunks/app.js",
    "/_next/image",
    "/favicon.ico",
  ]) {
    assert.equal(pasaPorElProxy(ruta), true, ruta)
  }
})
