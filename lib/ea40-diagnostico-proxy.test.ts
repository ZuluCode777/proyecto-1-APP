import assert from "node:assert/strict"
import test from "node:test"
import { conEntorno } from "./ea10-entorno-pruebas"
import { GET } from "../app/api/diagnostico-proxy/route"

/**
 * Sonda temporal de #40 (`GET /api/diagnostico-proxy`): exige la clave de la app
 * y devuelve exactamente las siete cabeceras del proxy, tal como llegan (`null`
 * si faltan), sin ninguna otra. Se quita tras medir la cadena del proxy de Render.
 */

const CLAVES = ["cf-connecting-ip", "forwarded", "true-client-ip", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-real-ip"]
const basic = (credenciales: string) => `Basic ${Buffer.from(credenciales).toString("base64")}`
const peticion = (headers: Record<string, string>) => new Request("http://local/api/diagnostico-proxy", { headers })

test("sin credencial o con una incorrecta responde 401 y no revela cabeceras", async () => {
  await conEntorno({ nodeEnv: "production", clave: "secreta" }, async () => {
    for (const autorizacion of [undefined, basic("u:otra")]) {
      const res = await GET(peticion({ "x-forwarded-for": "203.0.113.7", ...(autorizacion ? { authorization: autorizacion } : {}) }))
      assert.equal(res.status, 401, `autorización ${autorizacion ?? "ausente"}`)
      assert.ok(!(await res.text()).includes("203.0.113.7"))
    }
  })
})

test("con la clave devuelve exactamente las siete cabeceras como llegan y null las que faltan", async () => {
  await conEntorno({ nodeEnv: "production", clave: "secreta" }, async () => {
    const res = await GET(
      peticion({
        authorization: basic("u:secreta"),
        "x-forwarded-for": "198.51.100.9, 203.0.113.7",
        forwarded: "for=203.0.113.7;proto=https",
        "x-forwarded-proto": "https",
        "x-forwarded-host": "app.example",
        cookie: "sesion=no-debe-salir",
        "x-otra": "tampoco",
      }),
    )
    assert.equal(res.status, 200)
    const texto = await res.text()
    const cuerpo = JSON.parse(texto)
    assert.deepEqual(Object.keys(cuerpo).sort(), CLAVES)
    assert.deepEqual(cuerpo, {
      "x-forwarded-for": "198.51.100.9, 203.0.113.7",
      "x-real-ip": null,
      "cf-connecting-ip": null,
      "true-client-ip": null,
      forwarded: "for=203.0.113.7;proto=https",
      "x-forwarded-proto": "https",
      "x-forwarded-host": "app.example",
    })
    for (const ajeno of ["no-debe-salir", "tampoco", "secreta", basic("u:secreta")]) assert.ok(!texto.includes(ajeno), `no filtra «${ajeno}»`)
  })
})

test("producción sin clave utilizable responde 503: la sonda no queda abierta", async () => {
  await conEntorno({ nodeEnv: "production", clave: undefined }, async () => {
    assert.equal((await GET(peticion({}))).status, 503)
  })
})
