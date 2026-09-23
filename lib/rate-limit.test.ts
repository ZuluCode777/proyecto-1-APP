import assert from "node:assert/strict"
import test from "node:test"
import { createRateLimiter } from "./rate-limit"

test("allows requests up to the limit and blocks the next one", () => {
  const rateLimit = createRateLimiter({ limit: 3, windowMs: 60_000, now: () => 0 })

  assert.equal(rateLimit("1.1.1.1").allowed, true)
  assert.equal(rateLimit("1.1.1.1").allowed, true)
  assert.equal(rateLimit("1.1.1.1").allowed, true)

  const blocked = rateLimit("1.1.1.1")
  assert.equal(blocked.allowed, false)
  assert.equal(blocked.retryAfterSeconds, 60)
})

test("counts each key separately", () => {
  const rateLimit = createRateLimiter({ limit: 1, windowMs: 60_000, now: () => 0 })

  assert.equal(rateLimit("1.1.1.1").allowed, true)
  assert.equal(rateLimit("2.2.2.2").allowed, true)
  assert.equal(rateLimit("1.1.1.1").allowed, false)
})

test("starts a fresh window once the old one expires", () => {
  let clock = 0
  const rateLimit = createRateLimiter({ limit: 1, windowMs: 1_000, now: () => clock })

  assert.equal(rateLimit("1.1.1.1").allowed, true)
  assert.equal(rateLimit("1.1.1.1").allowed, false)

  clock = 1_001
  assert.equal(rateLimit("1.1.1.1").allowed, true)
})
