import assert from "node:assert/strict"
import test from "node:test"
import { AgentReplySchema } from "./local-agent"

/**
 * Regresión de EA-10 (#36) sobre el endpoint real `POST /api/agent`: el límite
 * de bytes del cuerpo (413), el error de lectura (400) y el límite de peticiones
 * (429 + Retry-After) conservan el contrato público `AgentReply` y no provocan
 * 500 ni bloqueo. La red a TransMilenio se simula caída para usar la copia.
 */

/** Importa el `POST` real con la red externa simulada caída (usa la copia). */
async function conEndpoint() {
  const fetchOriginal = globalThis.fetch
  globalThis.fetch = (async () => {
    throw new Error("sin red (prueba EA-10): usa la copia")
  }) as unknown as typeof fetch
  const { POST, __reiniciarLimitePeticiones } = await import("../app/api/agent/route")
  __reiniciarLimitePeticiones()
  const restaurar = () => {
    globalThis.fetch = fetchOriginal
  }
  return { POST, restaurar }
}

test("cuerpo por encima de la cota de bytes → 413, con contrato AgentReply", async () => {
  const { POST, restaurar } = await conEndpoint()
  try {
    // Un mensaje de muchos miles de bytes supera MAX_BODY_BYTES (4000).
    const body = JSON.stringify({ message: "a".repeat(20_000) })
    const res = await POST(new Request("http://local/api/agent", { method: "POST", body }))
    assert.equal(res.status, 413)
    const json = await res.json()
    assert.ok(AgentReplySchema.safeParse(json).success, "mantiene el contrato AgentReply")
  } finally {
    restaurar()
  }
})

test("error de lectura del cuerpo → 400, sin 500, con contrato AgentReply", async () => {
  const { POST, restaurar } = await conEndpoint()
  try {
    const cuerpoQueFalla = new ReadableStream<Uint8Array>({
      pull() {
        throw new Error("fallo de lectura")
      },
    })
    const req = new Request("http://local/api/agent", {
      method: "POST",
      body: cuerpoQueFalla,
      // @ts-expect-error duplex es necesario para enviar un stream como cuerpo en Node.
      duplex: "half",
    })
    const res = await POST(req)
    assert.equal(res.status, 400)
    const json = await res.json()
    assert.ok(AgentReplySchema.safeParse(json).success)
  } finally {
    restaurar()
  }
})

test("un cuerpo válido dentro de la cota responde 200 con contrato AgentReply", async () => {
  const { POST, restaurar } = await conEndpoint()
  try {
    const body = JSON.stringify({ message: "información de la B23" })
    const res = await POST(new Request("http://local/api/agent", { method: "POST", body }))
    assert.equal(res.status, 200)
    const json = await res.json()
    assert.ok(AgentReplySchema.safeParse(json).success)
  } finally {
    restaurar()
  }
})

test("exceso de peticiones → 429 con Retry-After y contrato AgentReply (identidad acotada compartida)", async () => {
  const { POST, restaurar } = await conEndpoint()
  try {
    // Sin proxy de confianza, todas las peticiones comparten la clave acotada.
    // El límite del endpoint es 20/min; la 21ª debe rechazarse.
    let ultima: Response | undefined
    for (let i = 0; i < 21; i++) {
      ultima = await POST(new Request("http://local/api/agent", { method: "POST", body: JSON.stringify({ message: "hola" }) }))
    }
    assert.ok(ultima)
    assert.equal(ultima.status, 429)
    assert.ok(ultima.headers.get("Retry-After"), "incluye Retry-After")
    const json = await ultima.json()
    assert.ok(AgentReplySchema.safeParse(json).success)
  } finally {
    restaurar()
  }
})
