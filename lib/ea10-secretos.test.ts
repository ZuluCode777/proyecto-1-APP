import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import test from "node:test"

/**
 * Regresión de EA-10 (#36), criterio 1: el secreto solo vive en el entorno, nunca
 * en el repositorio. `next start` carga `.env`, `.env.production` y `.env.local`,
 * así que ninguno de ellos puede versionarse por accidente; solo `.env.example`
 * (sin valores reales) sí. `--no-index` juzga la ruta por las reglas de
 * `.gitignore` y no por si el archivo ya está rastreado.
 */

/** Código de salida de `git check-ignore`: 0 = ignorada, 1 = no ignorada. */
function codigoCheckIgnore(ruta: string): number {
  const r = spawnSync("git", ["check-ignore", "--no-index", "-q", ruta], { stdio: "ignore" })
  assert.equal(r.error, undefined, `no se pudo ejecutar git: ${r.error?.message}`)
  assert.ok(r.status !== null, "git terminó sin código de salida")
  return r.status
}

test("los archivos de entorno con secretos están ignorados por git", () => {
  for (const ruta of [".env", ".env.production", ".env.development", ".env.local", ".env.production.local", ".env-staging.local"]) {
    assert.equal(codigoCheckIgnore(ruta), 0, `${ruta} debe estar ignorado`)
  }
})

test(".env.example (sin secretos) NO está ignorado: se versiona", () => {
  assert.equal(codigoCheckIgnore(".env.example"), 1)
})
