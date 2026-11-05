import assert from "node:assert/strict"
import test from "node:test"
import { estaAutorizado } from "./access"
import { conEntorno } from "./ea10-entorno-pruebas"
import { claveUtilizable, decidirAcceso, decidirAccesoDeEntorno, respuestaDeDecision } from "./autenticacion"

/**
 * Regresión de EA-10 (#36), criterio 1: la autenticación HTTP Basic no deja la
 * app abierta en producción por una `APP_PASSWORD` ausente, vacía o solo con
 * espacios, y conserva el desarrollo local sin secreto y los checks existentes
 * de `estaAutorizado`. El secreto no se recorta para comparar: una clave válida
 * con espacios reales no se altera.
 */

const credencialesBasic = (credenciales: string) => `Basic ${Buffer.from(credenciales).toString("base64")}`

test("claveUtilizable: ausente, vacía o solo espacios NO es utilizable", () => {
  assert.equal(claveUtilizable(undefined), false)
  assert.equal(claveUtilizable(""), false)
  assert.equal(claveUtilizable("   "), false)
  assert.equal(claveUtilizable("\t\n "), false)
})

test("claveUtilizable: un valor con contenido real sí es utilizable (incluso con espacios alrededor)", () => {
  assert.equal(claveUtilizable("secreta"), true)
  assert.equal(claveUtilizable("  con-espacios  "), true)
})

test("producción sin clave utilizable FALLA CERRADO (no abre la app)", () => {
  for (const clave of [undefined, "", "   "]) {
    const d = decidirAcceso({ autorizacion: null, clave, entorno: "produccion" })
    assert.equal(d.kind, "cerrado-sin-clave", `clave=${JSON.stringify(clave)}`)
  }
})

test("desarrollo sin clave utilizable PERMITE (desarrollo local e integración continua)", () => {
  for (const clave of [undefined, "", "   "]) {
    const d = decidirAcceso({ autorizacion: null, clave, entorno: "desarrollo" })
    assert.equal(d.kind, "permitido", `clave=${JSON.stringify(clave)}`)
  }
})

test("con clave utilizable: 401 sin credencial o con credencial incorrecta, en ambos entornos", () => {
  for (const entorno of ["produccion", "desarrollo"] as const) {
    assert.equal(decidirAcceso({ autorizacion: null, clave: "secreta", entorno }).kind, "clave-requerida")
    assert.equal(
      decidirAcceso({ autorizacion: credencialesBasic("equipo:mala"), clave: "secreta", entorno }).kind,
      "clave-requerida",
    )
  }
})

test("con clave utilizable: la credencial correcta permite el acceso", () => {
  assert.equal(
    decidirAcceso({ autorizacion: credencialesBasic("equipo:secreta"), clave: "secreta", entorno: "produccion" }).kind,
    "permitido",
  )
})

test("una clave válida con espacios reales no se altera: se compara tal cual", () => {
  const clave = "  con-espacios  "
  // El valor es utilizable (tiene contenido) y debe compararse verbatim.
  assert.equal(claveUtilizable(clave), true)
  assert.equal(decidirAcceso({ autorizacion: credencialesBasic(`u:${clave}`), clave, entorno: "produccion" }).kind, "permitido")
  // Una credencial recortada NO coincide (no se trata el espacio como vacío en la clave válida).
  assert.equal(
    decidirAcceso({ autorizacion: credencialesBasic("u:con-espacios"), clave, entorno: "produccion" }).kind,
    "clave-requerida",
  )
  // Coherencia con el verificador criptográfico de `access.ts`.
  assert.equal(estaAutorizado(credencialesBasic(`u:${clave}`), clave), true)
})

test("respuestaDeDecision: 401 con reto Basic y 503 sin reto; cuerpos sin revelar el secreto", () => {
  const r401 = respuestaDeDecision({ kind: "clave-requerida" })
  assert.equal(r401.estado, 401)
  assert.match(r401.cabeceras?.["WWW-Authenticate"] ?? "", /Basic/)
  const r503 = respuestaDeDecision({ kind: "cerrado-sin-clave" })
  assert.equal(r503.estado, 503)
  assert.equal(r503.cabeceras, undefined)
  // Ningún cuerpo menciona la clave ni si estaba configurada.
  assert.doesNotMatch(r401.cuerpo + r503.cuerpo, /APP_PASSWORD|secreta|clave=/)
})

test("decidirAccesoDeEntorno lee NODE_ENV y APP_PASSWORD reales (misma guardia que el proxy)", async () => {
  const decidir = (autorizacion: string | null) => decidirAccesoDeEntorno({ autorizacion }).kind
  await conEntorno({ nodeEnv: "production", clave: undefined }, () => {
    assert.equal(decidir(null), "cerrado-sin-clave")
  })
  await conEntorno({ nodeEnv: "production", clave: "   " }, () => {
    assert.equal(decidir(null), "cerrado-sin-clave", "whitespace = sin clave")
  })
  await conEntorno({ nodeEnv: "production", clave: "secreta" }, () => {
    assert.equal(decidir(null), "clave-requerida")
    assert.equal(decidir(credencialesBasic("u:secreta")), "permitido")
  })
  await conEntorno({ nodeEnv: "development", clave: undefined }, () => {
    assert.equal(decidir(null), "permitido", "desarrollo sin clave permite")
  })
})

test("conEntorno restaura NODE_ENV y APP_PASSWORD aunque el cuerpo falle", async () => {
  const nodeEnvPrevio = process.env.NODE_ENV
  const clavePrevia = process.env.APP_PASSWORD
  await assert.rejects(
    conEntorno({ nodeEnv: "production", clave: "temporal" }, () => {
      assert.equal(process.env.APP_PASSWORD, "temporal")
      throw new Error("fallo del cuerpo")
    }),
    /fallo del cuerpo/,
  )
  assert.equal(process.env.NODE_ENV, nodeEnvPrevio)
  assert.equal(process.env.APP_PASSWORD, clavePrevia)
})
