import assert from "node:assert/strict"
import test from "node:test"
import { estaAutorizado } from "./access"

const credencialesBasic = (credenciales: string) => `Basic ${Buffer.from(credenciales).toString("base64")}`

test("sin clave configurada deja pasar todo", () => {
  assert.equal(estaAutorizado(null, undefined), true)
  assert.equal(estaAutorizado(null, ""), true)
})

test("con clave, solo pasa la clave correcta", () => {
  assert.equal(estaAutorizado(credencialesBasic("equipo:secreta"), "secreta"), true)
  assert.equal(estaAutorizado(credencialesBasic("otro:secreta"), "secreta"), true)
  assert.equal(estaAutorizado(credencialesBasic("equipo:mala"), "secreta"), false)
  assert.equal(estaAutorizado(credencialesBasic("equipo:"), "secreta"), false)
  assert.equal(estaAutorizado(credencialesBasic("secreta"), "secreta"), false)
  assert.equal(estaAutorizado(null, "secreta"), false)
  assert.equal(estaAutorizado("Bearer secreta", "secreta"), false)
})

test("el esquema no distingue mayúsculas", () => {
  assert.equal(estaAutorizado(credencialesBasic("equipo:secreta").replace("Basic", "basic"), "secreta"), true)
})

test("la clave puede tener dos puntos y tildes", () => {
  assert.equal(estaAutorizado(credencialesBasic("equipo:a:b:ñ"), "a:b:ñ"), true)
})
