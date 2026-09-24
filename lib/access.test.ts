import assert from "node:assert/strict"
import test from "node:test"
import { isAuthorized } from "./access"

const basic = (credentials: string) => `Basic ${Buffer.from(credentials).toString("base64")}`

test("sin clave configurada deja pasar todo", () => {
  assert.equal(isAuthorized(null, undefined), true)
  assert.equal(isAuthorized(null, ""), true)
})

test("con clave, solo pasa la clave correcta", () => {
  assert.equal(isAuthorized(basic("equipo:secreta"), "secreta"), true)
  assert.equal(isAuthorized(basic("otro:secreta"), "secreta"), true)
  assert.equal(isAuthorized(basic("equipo:mala"), "secreta"), false)
  assert.equal(isAuthorized(basic("equipo:"), "secreta"), false)
  assert.equal(isAuthorized(basic("secreta"), "secreta"), false)
  assert.equal(isAuthorized(null, "secreta"), false)
  assert.equal(isAuthorized("Bearer secreta", "secreta"), false)
})

test("la clave puede tener dos puntos y tildes", () => {
  assert.equal(isAuthorized(basic("equipo:a:b:ñ"), "a:b:ñ"), true)
})
