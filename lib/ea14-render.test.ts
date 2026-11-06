import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import nextConfig from "../next.config.mjs"

/**
 * EA-14 (#40): guardas de la configuración de Render y de HSTS. No prueban
 * Render: el esquema oficial valida la sintaxis (ver docs/expoandes/ea-14-render-free.md)
 * y solo un despliegue real prueba el comportamiento. Aquí se evita que un
 * cambio accidental del archivo reintroduzca algo que EA-14 excluye (costo,
 * despliegue automático, Ollama, secretos versionados).
 *
 * `render.yaml` se lee como texto sin comentarios: el proyecto no incluye un
 * analizador de YAML y no se añade una dependencia solo para esta prueba.
 */
const yaml = readFileSync("render.yaml", "utf8")
  .split("\n")
  .map((linea) => linea.replace(/(^|\s)#.*$/, ""))
  .filter((linea) => linea.trim())
  .join("\n")

/** Valor de una clave del archivo (primera aparición, sin comillas). */
const valor = (clave: string) => new RegExp(`^\\s*(?:- )?${clave}:\\s*(.*)$`, "m").exec(yaml)?.[1].replace(/^"(.*)"$/, "$1")

/** Valor de la variable de entorno `clave`, o `undefined` si no está declarada. */
const variable = (clave: string) =>
  new RegExp(`- key: ${clave}\\n((?:\\s+(?!- key:)\\S.*\\n?)*)`).exec(yaml + "\n")?.[1]

test("render.yaml declara un único servicio web Node gratuito y sin recursos de pago", () => {
  assert.equal(yaml.match(/^\s*- type:/gm)?.length, 1)
  assert.equal(valor("type"), "web")
  assert.equal(valor("runtime"), "node")
  assert.equal(valor("plan"), "free")
  for (const prohibido of ["disk:", "databases:", "numInstances:", "scaling:", "healthCheckPath:", "domains:", "docker", "type: worker", "type: cron", "type: pserv"]) {
    assert.ok(!yaml.includes(prohibido), `no debe contener ${prohibido}`)
  }
})

test("el despliegue es manual: autoDeployTrigger va entre comillas porque YAML 1.1 lee off como falso", () => {
  assert.match(yaml, /^\s*autoDeployTrigger: "off"$/m)
})

test("instala congelado con el pnpm de packageManager, compila y escucha en 0.0.0.0:$PORT", () => {
  const paquete = JSON.parse(readFileSync("package.json", "utf8")) as { packageManager: string }
  assert.match(paquete.packageManager, /^pnpm@\d+\.\d+\.\d+$/)
  assert.equal(valor("buildCommand"), "corepack pnpm install --frozen-lockfile && corepack pnpm build")
  assert.equal(valor("startCommand"), 'corepack pnpm start -H 0.0.0.0 -p "$PORT"')
})

test("Node queda fijado a una versión exacta del mismo major que la integración continua", () => {
  const exacta = /value: "(\d+)\.\d+\.\d+"/.exec(variable("NODE_VERSION") ?? "")?.[1]
  const ci = /node-version:\s*(\d+)/.exec(readFileSync(".github/workflows/ci.yml", "utf8"))?.[1]
  assert.ok(exacta, "NODE_VERSION con versión exacta")
  assert.equal(exacta, ci)
})

test("Ollama queda desactivado y la clave nunca se versiona", () => {
  assert.match(variable("OLLAMA_MODEL") ?? "", /value: ""/)
  const clave = variable("APP_PASSWORD") ?? ""
  assert.match(clave, /sync: false/)
  assert.ok(!/value:/.test(clave), "APP_PASSWORD no lleva valor")
  assert.ok(!yaml.includes("OLLAMA_BASE_URL"), "sin modelo, la dirección de Ollama no hace falta")
})

test("HSTS: cabecera en todas las rutas, solo para el propio host", async () => {
  const reglas = await nextConfig.headers?.()
  assert.equal(reglas?.length, 1)
  assert.equal(reglas[0].source, "/:path*")
  assert.equal(reglas[0].headers.length, 1)
  const { key, value } = reglas[0].headers[0]
  assert.equal(key, "Strict-Transport-Security")
  assert.match(value, /^max-age=[1-9]\d*$/, "solo max-age; sin includeSubDomains ni preload")
})
