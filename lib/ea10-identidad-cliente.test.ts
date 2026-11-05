import assert from "node:assert/strict"
import test from "node:test"
import { CLAVE_SIN_VERIFICAR, claveLimite, resolverIdentidad } from "./identidad-cliente"

/**
 * Regresión de EA-10 (#36), criterio 4: la identidad del cliente NO confía
 * arbitrariamente en el primer `x-forwarded-for`/`x-real-ip`. Sin un proxy de
 * confianza comprobado (por defecto), toda identidad es `sin-verificar` y
 * comparte una clave acotada, de modo que inventar cabeceras por petición no
 * otorga cuota propia ni infla la cardinalidad. La verificación del proxy real
 * de Render queda pendiente de EA-14/#40; estos tests son SINTÉTICOS y no
 * certifican el proxy.
 */

test("por defecto NO se confía en x-forwarded-for ni en x-real-ip: identidad sin verificar", () => {
  const i1 = resolverIdentidad({ forwardedFor: "1.2.3.4", realIp: "9.9.9.9" })
  assert.equal(i1.kind, "sin-verificar")
  const i2 = resolverIdentidad({ forwardedFor: "1.2.3.4, 5.6.7.8", realIp: null })
  assert.equal(i2.kind, "sin-verificar")
  const i3 = resolverIdentidad({ forwardedFor: null, realIp: null })
  assert.equal(i3.kind, "sin-verificar")
})

test("cabeceras inventadas distintas por petición comparten UNA clave acotada", () => {
  const claves = new Set<string>()
  for (let i = 0; i < 100; i++) {
    const id = resolverIdentidad({ forwardedFor: `10.0.0.${i}`, realIp: null })
    claves.add(claveLimite(id))
  }
  assert.equal(claves.size, 1, "todas colapsan a la misma clave")
  assert.ok(claves.has(CLAVE_SIN_VERIFICAR))
})

test("con un proxy de confianza declarado, se toma el salto correcto desde la DERECHA (no el primero)", () => {
  // Un proxy de confianza que añade 1 salto: la IP del cliente es el ÚLTIMO valor.
  const id = resolverIdentidad({ forwardedFor: "cliente, proxyA, proxyConfiable", realIp: null }, { saltosConfiables: 1 })
  assert.equal(id.kind, "confiable")
  assert.equal(id.kind === "confiable" && id.ip, "proxyConfiable")
})

test("con 2 saltos de confianza, se cuenta dos posiciones desde la derecha", () => {
  const id = resolverIdentidad({ forwardedFor: "cliente-real, intermedio, salto1, salto2", realIp: null }, { saltosConfiables: 2 })
  assert.equal(id.kind, "confiable")
  assert.equal(id.kind === "confiable" && id.ip, "salto1")
})

test("si la cadena no tiene suficientes saltos para la topología declarada, se degrada a sin verificar", () => {
  const id = resolverIdentidad({ forwardedFor: "unico", realIp: null }, { saltosConfiables: 2 })
  assert.equal(id.kind, "sin-verificar")
  const vacia = resolverIdentidad({ forwardedFor: "", realIp: null }, { saltosConfiables: 1 })
  assert.equal(vacia.kind, "sin-verificar")
})

test("claveLimite: una identidad confiable usa su IP; una sin verificar usa la clave acotada", () => {
  assert.equal(claveLimite({ kind: "confiable", ip: "1.2.3.4" }), "1.2.3.4")
  assert.equal(claveLimite({ kind: "sin-verificar" }), CLAVE_SIN_VERIFICAR)
})
