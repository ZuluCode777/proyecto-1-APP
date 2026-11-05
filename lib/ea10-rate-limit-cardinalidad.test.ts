import assert from "node:assert/strict"
import test from "node:test"
import { createRateLimiter } from "./rate-limit"

/**
 * Regresión de EA-10 (#36), criterio 3: el contador acota su CARDINALIDAD además
 * de expirar por ventana. Muchas claves nuevas dentro de la ventana no crecen
 * sin límite; el exceso se rechaza con 429 y `Retry-After`. El desalojo solo
 * ocurre por expiración (recuperación legítima), nunca sobre una clave activa,
 * así que un rechazo no se puede «reiniciar» desalojando su entrada.
 */

test("al llegar al tope de claves, una clave NUEVA se rechaza por cardinalidad (no crece sin límite)", () => {
  const rateLimit = createRateLimiter({ limit: 100, windowMs: 60_000, maximoClaves: 3, now: () => 0 })
  assert.equal(rateLimit("a").allowed, true)
  assert.equal(rateLimit("b").allowed, true)
  assert.equal(rateLimit("c").allowed, true)

  const d = rateLimit("d")
  assert.equal(d.allowed, false)
  assert.equal(d.allowed === false && d.motivo, "cardinalidad")
  assert.ok(d.retryAfterSeconds >= 1, "lleva Retry-After")
})

test("una clave YA conocida sigue contando aunque el mapa esté lleno (no la bloquea la cardinalidad)", () => {
  const rateLimit = createRateLimiter({ limit: 2, windowMs: 60_000, maximoClaves: 2, now: () => 0 })
  assert.equal(rateLimit("a").allowed, true)
  assert.equal(rateLimit("b").allowed, true) // mapa lleno
  // «a» ya está en el mapa: su segunda petición cuenta normalmente.
  assert.equal(rateLimit("a").allowed, true)
  // Y su tercera excede el límite de su ventana (motivo "ventana", no cardinalidad).
  const r = rateLimit("a")
  assert.equal(r.allowed, false)
  assert.equal(r.allowed === false && r.motivo, "ventana")
})

test("el desalojo solo libera claves VENCIDAS; al vencer la ventana entra una clave nueva", () => {
  let reloj = 0
  const rateLimit = createRateLimiter({ limit: 100, windowMs: 1_000, maximoClaves: 2, now: () => reloj })
  assert.equal(rateLimit("a").allowed, true)
  assert.equal(rateLimit("b").allowed, true)
  assert.equal(rateLimit("c").allowed, false, "mapa lleno con claves frescas: se rechaza") // cardinalidad

  // Vencen las ventanas de a y b; ahora hay espacio por EXPIRACIÓN (legítimo).
  reloj = 1_001
  assert.equal(rateLimit("c").allowed, true, "al vencer a/b, c entra")
})

test("una clave bloqueada por su ventana NO reinicia su cuota por desalojo: sigue bloqueada hasta vencer", () => {
  let reloj = 0
  // maximoClaves alto para que la cardinalidad no intervenga: se prueba solo la ventana.
  const rateLimit = createRateLimiter({ limit: 1, windowMs: 10_000, maximoClaves: 1000, now: () => reloj })
  assert.equal(rateLimit("a").allowed, true)
  assert.equal(rateLimit("a").allowed, false, "excede su ventana")

  // Aunque lleguen muchas claves nuevas, «a» no se desaloja (su ventana sigue viva)
  // y por tanto su cuota no se reinicia: sigue rechazada dentro de la ventana.
  for (let i = 0; i < 50; i++) rateLimit(`otra-${i}`)
  reloj = 5_000
  assert.equal(rateLimit("a").allowed, false, "sigue bloqueada: la cuota no se reinició")

  // Solo al vencer la ventana se recupera.
  reloj = 10_001
  assert.equal(rateLimit("a").allowed, true)
})

test("aluvión de claves nuevas dentro de la ventana NO crece sin límite (se rechaza el exceso)", () => {
  const rateLimit = createRateLimiter({ limit: 100, windowMs: 60_000, maximoClaves: 10, now: () => 0 })
  let permitidas = 0
  let rechazadas = 0
  for (let i = 0; i < 1000; i++) {
    if (rateLimit(`clave-${i}`).allowed) permitidas++
    else rechazadas++
  }
  assert.equal(permitidas, 10, "solo caben maximoClaves claves distintas en la ventana")
  assert.equal(rechazadas, 990, "el resto se rechaza por cardinalidad")
})
