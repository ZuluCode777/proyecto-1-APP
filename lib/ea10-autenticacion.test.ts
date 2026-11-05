import assert from "node:assert/strict"
import test from "node:test"
import { estaAutorizado } from "./access"
import { claveUtilizable, decidirAcceso, decidirAccesoDeEntorno, respuestaDeDecision } from "./autenticacion"

/**
 * Regresión de EA-10 (#36), criterio 1: la autenticación HTTP Basic no deja la
 * app abierta en producción por una `APP_PASSWORD` ausente, vacía o solo con
 * espacios, y conserva el desarrollo local sin secreto y los checks existentes
 * de `estaAutorizado`. El secreto no se recorta para comparar: una clave válida
 * con espacios reales no se altera.
 */

const credencialesBasic = (credenciales: string) => `Basic ${Buffer.from(credenciales).toString("base64")}`

/** Fija o borra una variable de entorno en pruebas (NODE_ENV es de solo lectura en los tipos). */
function fijarEnv(nombre: string, valor: string | undefined): void {
  const entorno = process.env as Record<string, string | undefined>
  if (valor === undefined) delete entorno[nombre]
  else entorno[nombre] = valor
}

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

test("decidirAccesoDeEntorno lee NODE_ENV y APP_PASSWORD reales (misma guardia que el proxy)", () => {
  const envPrevio = process.env.NODE_ENV
  const clavePrevia = process.env.APP_PASSWORD
  try {
    fijarEnv("NODE_ENV", "production")
    fijarEnv("APP_PASSWORD", undefined)
    assert.equal(decidirAccesoDeEntorno({ autorizacion: null }).kind, "cerrado-sin-clave")
    fijarEnv("APP_PASSWORD", "   ")
    assert.equal(decidirAccesoDeEntorno({ autorizacion: null }).kind, "cerrado-sin-clave", "whitespace = sin clave")
    fijarEnv("APP_PASSWORD", "secreta")
    assert.equal(decidirAccesoDeEntorno({ autorizacion: null }).kind, "clave-requerida")
    assert.equal(decidirAccesoDeEntorno({ autorizacion: credencialesBasic("u:secreta") }).kind, "permitido")
    fijarEnv("NODE_ENV", "development")
    fijarEnv("APP_PASSWORD", undefined)
    assert.equal(decidirAccesoDeEntorno({ autorizacion: null }).kind, "permitido", "desarrollo sin clave permite")
  } finally {
    fijarEnv("NODE_ENV", envPrevio)
    fijarEnv("APP_PASSWORD", clavePrevia)
  }
})
