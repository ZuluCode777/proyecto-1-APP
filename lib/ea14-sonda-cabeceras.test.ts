import assert from "node:assert/strict"
import test from "node:test"
import { GET } from "../app/api/sonda-cabeceras/route"

/**
 * Regresión de la sonda TEMPORAL de EA-14 (#40): sin la bandera
 * `SONDA_CABECERAS=1` la ruta responde 404 vacío; con ella devuelve las
 * cabeceras de proxy y nunca los valores de `authorization` ni `cookie`.
 */

async function conBandera(valor: string | undefined, cuerpo: () => Promise<void>) {
  const previo = process.env.SONDA_CABECERAS
  if (valor === undefined) delete process.env.SONDA_CABECERAS
  else process.env.SONDA_CABECERAS = valor
  try {
    await cuerpo()
  } finally {
    if (previo === undefined) delete process.env.SONDA_CABECERAS
    else process.env.SONDA_CABECERAS = previo
  }
}

const peticion = (cabeceras?: Record<string, string>) =>
  new Request("http://local/api/sonda-cabeceras", { headers: cabeceras })

test("bandera ausente → 404 con cuerpo vacío", async () => {
  await conBandera(undefined, async () => {
    const res = await GET(peticion({ "x-forwarded-for": "1.2.3.4" }))
    assert.equal(res.status, 404)
    assert.equal(await res.text(), "")
  })
})

test('bandera "0" → 404 con cuerpo vacío', async () => {
  await conBandera("0", async () => {
    const res = await GET(peticion())
    assert.equal(res.status, 404)
    assert.equal(await res.text(), "")
  })
})

test('bandera "1" → 200, x-forwarded-for dividido y recortado, ausentes en null, sin caché', async () => {
  await conBandera("1", async () => {
    const res = await GET(peticion({ "x-forwarded-for": "1.2.3.4, 5.6.7.8", "cf-connecting-ip": "9.9.9.9" }))
    assert.equal(res.status, 200)
    assert.equal(res.headers.get("cache-control"), "no-store")
    const cuerpo = await res.json()
    assert.deepEqual(cuerpo.xForwardedFor, ["1.2.3.4", "5.6.7.8"])
    assert.equal(cuerpo.cfConnectingIp, "9.9.9.9")
    for (const clave of ["xRealIp", "trueClientIp", "xForwardedProto", "xForwardedHost", "forwarded", "via", "cfConnectingIpv6", "xEnvoyExternalAddress", "rndrId"]) {
      assert.equal(cuerpo[clave], null, clave)
    }
    assert.deepEqual(cuerpo.cabecerasPresentes, ["cf-connecting-ip", "x-forwarded-for"])
  })
})

test('bandera "1" sin x-forwarded-for → xForwardedFor null', async () => {
  await conBandera("1", async () => {
    const cuerpo = await (await GET(peticion())).json()
    assert.equal(cuerpo.xForwardedFor, null)
  })
})

test("authorization y cookie: solo sus nombres aparecen, nunca sus valores", async () => {
  await conBandera("1", async () => {
    const res = await GET(peticion({ authorization: "Basic c2VjcmV0bw==", cookie: "sesion=valor-secreto" }))
    const texto = await res.text()
    assert.ok(!texto.includes("c2VjcmV0bw=="))
    assert.ok(!texto.includes("valor-secreto"))
    assert.deepEqual(JSON.parse(texto).cabecerasPresentes, ["authorization", "cookie"])
  })
})

test('bandera "1" añade proceso y cgroup numéricos; sin bandera no hay datos', async () => {
  await conBandera("1", async () => {
    const cuerpo = await (await GET(peticion())).json()
    assert.equal(cuerpo.proceso.node, process.versions.node)
    assert.ok(cuerpo.proceso.rssBytes > 0)
    assert.ok("cgroup" in cuerpo)
  })
  await conBandera(undefined, async () => {
    assert.equal(await (await GET(peticion())).text(), "")
  })
})
