import assert from "node:assert/strict"
import test, { mock } from "node:test"
import { pathToFileURL } from "node:url"
import { conEntorno } from "./ea10-entorno-pruebas"
import { AgentReplySchema } from "./local-agent"

/**
 * Regresión de EA-10 (#36) sobre el endpoint real `/api/agent`:
 *
 * - El cuerpo por stream (413 por bytes, 400 por error de lectura) y el límite de
 *   peticiones (429 + Retry-After) conservan el contrato público `AgentReply`.
 * - La guardia HTTP Basic de la ruta (criterio 1 + hallazgo del límite de
 *   ingreso): como `/api/agent` se excluye del `proxy` para que Next no clone su
 *   cuerpo, GET y POST aplican la MISMA guardia. Se prueban clave ausente, vacía,
 *   solo espacios y presente, con credencial incorrecta y correcta, en
 *   producción y desarrollo, para no abrir un hueco de autenticación.
 *
 * La red a TransMilenio se simula caída para usar la copia guardada.
 */

const raiz = pathToFileURL(process.cwd() + "/")
let contadorCaso = 0

/**
 * Carga una instancia FRESCA del endpoint (query distinta reinicia la caché de
 * módulo, como en `transmilenio-data.test.ts`), con la red externa simulada
 * caída. Cada caso tiene su propio contador de peticiones, sin un export de
 * reinicio solo para pruebas.
 */
async function conEndpoint() {
  const fetchSimulado = mock.method(globalThis, "fetch", async () => {
    throw new Error("sin red (prueba EA-10): usa la copia")
  })
  const modulo: typeof import("../app/api/agent/route") = await import(
    new URL(`app/api/agent/route.ts?caso=${contadorCaso++}`, raiz).href
  )
  return { GET: modulo.GET, POST: modulo.POST, restaurar: () => fetchSimulado.mock.restore() }
}

const credencialesBasic = (credenciales: string) => `Basic ${Buffer.from(credenciales).toString("base64")}`

const peticion = (metodo: "GET" | "POST", autorizacion?: string) =>
  new Request("http://local/api/agent", {
    method: metodo,
    body: metodo === "POST" ? JSON.stringify({ message: "información de la B23" }) : undefined,
    headers: autorizacion ? { authorization: autorizacion } : undefined,
  })

// ── Cuerpo por stream y límite de peticiones (contrato AgentReply) ──

test("cuerpo por encima de la cota de bytes → 413, con contrato AgentReply", async () => {
  const e = await conEndpoint()
  try {
    const body = JSON.stringify({ message: "a".repeat(20_000) })
    const res = await e.POST(new Request("http://local/api/agent", { method: "POST", body }))
    assert.equal(res.status, 413)
    assert.ok(AgentReplySchema.safeParse(await res.json()).success, "mantiene el contrato AgentReply")
  } finally {
    e.restaurar()
  }
})

test("error de lectura del cuerpo → 400, sin 500, con contrato AgentReply", async () => {
  const e = await conEndpoint()
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
    const res = await e.POST(req)
    assert.equal(res.status, 400)
    assert.ok(AgentReplySchema.safeParse(await res.json()).success)
  } finally {
    e.restaurar()
  }
})

test("un cuerpo válido dentro de la cota responde 200 con contrato AgentReply", async () => {
  const e = await conEndpoint()
  try {
    const res = await e.POST(peticion("POST"))
    assert.equal(res.status, 200)
    assert.ok(AgentReplySchema.safeParse(await res.json()).success)
  } finally {
    e.restaurar()
  }
})

test("exceso de peticiones → 429 con Retry-After y contrato AgentReply (identidad acotada compartida)", async () => {
  const e = await conEndpoint()
  try {
    // Sin proxy verificado, todas las peticiones comparten la clave acotada. El
    // límite del endpoint es 20/min; la 21ª debe rechazarse.
    let ultima: Response | undefined
    for (let i = 0; i < 21; i++) {
      ultima = await e.POST(new Request("http://local/api/agent", { method: "POST", body: JSON.stringify({ message: "hola" }) }))
    }
    assert.ok(ultima)
    assert.equal(ultima.status, 429)
    assert.ok(ultima.headers.get("Retry-After"), "incluye Retry-After")
    assert.ok(AgentReplySchema.safeParse(await ultima.json()).success)
  } finally {
    e.restaurar()
  }
})

// ── Guardia HTTP Basic de la ruta (API protegida igual que la UI del proxy) ──

test("producción sin clave utilizable → 503 en GET y POST (no abre la API)", async () => {
  for (const clave of [undefined, "", "   "]) {
    await conEntorno({ nodeEnv: "production", clave }, async () => {
      const e = await conEndpoint()
      try {
        const g = await e.GET(peticion("GET"))
        const p = await e.POST(peticion("POST"))
        assert.equal(g.status, 503, `GET clave=${JSON.stringify(clave)}`)
        assert.equal(p.status, 503, `POST clave=${JSON.stringify(clave)}`)
      } finally {
        e.restaurar()
      }
    })
  }
})

test("con clave: 401 sin credencial o con credencial incorrecta, en GET y POST", async () => {
  await conEntorno({ nodeEnv: "production", clave: "secreta" }, async () => {
    const e = await conEndpoint()
    try {
      assert.equal((await e.GET(peticion("GET"))).status, 401)
      assert.equal((await e.POST(peticion("POST"))).status, 401)
      assert.equal((await e.GET(peticion("GET", credencialesBasic("u:mala")))).status, 401)
      assert.equal((await e.POST(peticion("POST", credencialesBasic("u:mala")))).status, 401)
      // El 401 lleva el reto Basic y NO es una respuesta de agente (texto plano).
      const reto = await e.GET(peticion("GET"))
      assert.match(reto.headers.get("WWW-Authenticate") ?? "", /Basic/)
    } finally {
      e.restaurar()
    }
  })
})

test("con clave: la credencial correcta deja pasar GET y POST (contrato AgentReply en POST)", async () => {
  await conEntorno({ nodeEnv: "production", clave: "secreta" }, async () => {
    const e = await conEndpoint()
    try {
      const g = await e.GET(peticion("GET", credencialesBasic("u:secreta")))
      const p = await e.POST(peticion("POST", credencialesBasic("u:secreta")))
      assert.equal(g.status, 200)
      assert.equal(p.status, 200)
      assert.ok(AgentReplySchema.safeParse(await p.json()).success)
    } finally {
      e.restaurar()
    }
  })
})

test("desarrollo sin clave deja pasar GET y POST (desarrollo local e integración continua)", async () => {
  await conEntorno({ nodeEnv: undefined, clave: undefined }, async () => {
    const e = await conEndpoint()
    try {
      assert.equal((await e.GET(peticion("GET"))).status, 200)
      assert.equal((await e.POST(peticion("POST"))).status, 200)
    } finally {
      e.restaurar()
    }
  })
})
