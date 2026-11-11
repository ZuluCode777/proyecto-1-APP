import assert from "node:assert/strict"
import test, { mock } from "node:test"
import { pathToFileURL } from "node:url"
import { AnunciosRespuestaSchema } from "./anuncios"
import { aAnuncios, crearServicioAnuncios, decodificarAlertas, EDAD_MAXIMA_FUENTE_MS } from "./anuncios-servidor"

/**
 * EA-26 (#52): anuncios operativos. Las alertas se arman con un codificador
 * protobuf mínimo (el formato real de `alerts.pb`), sin red ni modelo.
 */

// ── Codificador protobuf de pruebas ──
const varint = (n: number): number[] => {
  const out: number[] = []
  while (n >= 0x80) {
    out.push((n % 0x80) | 0x80)
    n = Math.floor(n / 0x80)
  }
  return [...out, n]
}
const llave = (num: number, tipo: number) => varint(num * 8 + tipo)
const num = (n: number, v: number) => [...llave(n, 0), ...varint(v)]
const ld = (n: number, bytes: number[] | Uint8Array) => [...llave(n, 2), ...varint(bytes.length), ...bytes]
const str = (n: number, s: string) => ld(n, new TextEncoder().encode(s))
const traducido = (n: number, s: string, idioma = "es") => ld(n, ld(1, [...str(1, s), ...str(2, idioma)]))

type Prueba = { id: string; desde?: number; hasta?: number; titulo?: string; desc?: string; efecto?: number; ruta?: string; eliminada?: boolean }
const alerta = (a: Prueba) =>
  ld(
    2,
    [
      ...str(1, a.id),
      ...(a.eliminada ? num(2, 1) : []),
      ...ld(
        5,
        [
          ...ld(1, [...(a.desde === undefined ? [] : num(1, a.desde)), ...(a.hasta === undefined ? [] : num(2, a.hasta))]),
          ...ld(5, str(2, a.ruta ?? "10173")),
          ...ld(5, ld(5, [0x35, 0x31, 0x39, 0x35, 0x31])), // parada con campo de relleno: se ignora
          ...num(7, a.efecto ?? 4),
          ...(a.titulo === undefined ? [] : traducido(10, a.titulo)),
          ...(a.desc === undefined ? [] : traducido(11, a.desc)),
        ],
      ),
    ],
  )
const mensaje = (marca: number | null, alertas: Prueba[]) =>
  new Uint8Array([...ld(1, [...str(1, "2.0"), ...(marca === null ? [] : num(3, marca))]), ...alertas.flatMap(alerta)])

const AHORA = Date.UTC(2026, 10, 11, 17, 0, 0)
const s = (ms: number) => Math.floor(ms / 1000)
const reloj = (inicio = AHORA) => {
  const r = { t: inicio, ahora: () => r.t }
  return r
}
const vigente = (id: string, extra: Partial<Prueba> = {}): Prueba => ({
  id,
  desde: s(AHORA) - 600,
  hasta: s(AHORA) + 600,
  titulo: `Obra ${id}`,
  desc: `Desvío ${id}`,
  ...extra,
})

test("decodifica el mensaje: marca, identificador, vigencia, ruta, efecto y textos", () => {
  const feed = decodificarAlertas(mensaje(s(AHORA), [vigente("a1", { ruta: "13307", efecto: 1 })]))
  assert.equal(feed.marca, s(AHORA))
  assert.equal(feed.alertas.length, 1)
  assert.deepEqual(feed.alertas[0], {
    id: "a1",
    eliminada: false,
    periodos: [{ desde: s(AHORA) - 600, hasta: s(AHORA) + 600 }],
    rutas: ["13307"],
    efecto: 1,
    titulo: "Obra a1",
    descripcion: "Desvío a1",
  })
})

test("un mensaje truncado o con basura no se decodifica", () => {
  const bueno = mensaje(s(AHORA), [vigente("a1")])
  assert.throws(() => decodificarAlertas(bueno.subarray(0, bueno.length - 3)))
  assert.throws(() => decodificarAlertas(new Uint8Array([0xff, 0xff, 0xff])))
})

test("la forma de la respuesta cumple el contrato y cada anuncio trae entidad, identificador, fecha, vigencia y afectación", async () => {
  const servicio = crearServicioAnuncios({ obtener: async () => mensaje(s(AHORA), [vigente("a1", { desc: "Cierre &iacute; &#241;" })]), ahora: () => AHORA })
  const r = await servicio()
  AnunciosRespuestaSchema.parse(r)
  assert.equal(r.fuente.estado, "activa")
  assert.equal(r.fuente.confianza, "media")
  assert.equal(r.fuente.publicadoEn, new Date(AHORA).toISOString())
  assert.deepEqual(r.anuncios, [
    {
      origen: "oficial",
      entidad: "TransMilenio S.A.",
      identificador: "a1",
      titulo: "Obra a1",
      descripcion: "Cierre í ñ",
      fecha: new Date(AHORA - 600_000).toISOString(),
      vigenciaHasta: new Date(AHORA + 600_000).toISOString(),
      afectacion: { efecto: "desvio", rutas: ["10173"] },
    },
  ])
})

test("sin fuente: si nunca respondió, el estado es sin-fuente y NO dice que no hay incidentes", async () => {
  const aviso = mock.method(console, "warn", () => {})
  try {
    const r = await crearServicioAnuncios({ obtener: async () => { throw new Error("sin red") }, ahora: () => AHORA })()
    AnunciosRespuestaSchema.parse(r)
    assert.equal(r.fuente.estado, "sin-fuente")
    assert.equal(r.fuente.confianza, "ninguna")
    assert.equal(r.fuente.consultadoEn, null)
    assert.deepEqual(r.anuncios, [])
    assert.match(r.fuente.mensaje, /no significa que no haya novedades/)
  } finally {
    aviso.mock.restore()
  }
})

test("con la fuente al día y sin anuncios vigentes, el mensaje no garantiza ausencia de novedades", async () => {
  const r = await crearServicioAnuncios({ obtener: async () => mensaje(s(AHORA), []), ahora: () => AHORA })()
  assert.equal(r.fuente.estado, "activa")
  assert.deepEqual(r.anuncios, [])
  assert.match(r.fuente.mensaje, /no garantiza que no haya novedades/)
})

test("vencidos, futuros, eliminados y vacíos se descartan", () => {
  const feed = decodificarAlertas(
    mensaje(s(AHORA), [
      vigente("ok"),
      vigente("vencido", { desde: s(AHORA) - 7200, hasta: s(AHORA) - 1 }),
      vigente("futuro", { desde: s(AHORA) + 60, hasta: s(AHORA) + 600 }),
      vigente("borrado", { eliminada: true }),
      vigente("vacio", { titulo: "  ", desc: "" }),
      vigente("sin-fin", { hasta: undefined }),
    ]),
  )
  assert.deepEqual(aAnuncios(feed, AHORA).map((a) => a.identificador).sort(), ["ok", "sin-fin"])
})

test("duplicados: mismo identificador o mismo contenido bajo otro identificador cuentan una vez", () => {
  const feed = decodificarAlertas(
    mensaje(s(AHORA), [
      vigente("a1"),
      vigente("a1"),
      vigente("a2", { titulo: "Obra a1", desc: "Desvío a1" }),
      vigente("a3", { titulo: "OBRA  A1 ", desc: "desvio a1" }),
      vigente("a4", { titulo: "Otra obra" }),
      vigente("a5"),
      vigente("a5", { titulo: "Mismo identificador, otro texto" }),
    ]),
  )
  assert.deepEqual(aAnuncios(feed, AHORA).map((a) => a.identificador).sort(), ["a1", "a4", "a5"])
  assert.equal(aAnuncios(feed, AHORA).find((a) => a.identificador === "a5")?.titulo, "Obra a5")
})

test("fallo de la fuente tras un éxito: conserva la fecha, baja la confianza y descarta lo que venció", async () => {
  const aviso = mock.method(console, "warn", () => {})
  try {
    const r0 = reloj()
    let falla = false
    const servicio = crearServicioAnuncios({
      obtener: async () => {
        if (falla) throw new Error("HTTP 500")
        return mensaje(s(AHORA), [vigente("largo", { hasta: s(AHORA) + 3600 }), vigente("corto", { hasta: s(AHORA) + 100 })])
      },
      ahora: r0.ahora,
    })
    const ok = await servicio()
    assert.equal(ok.fuente.estado, "activa")
    assert.equal(ok.anuncios.length, 2)

    falla = true
    r0.t += 200_000 // pasó el TTL y venció "corto"
    const caida = await servicio()
    AnunciosRespuestaSchema.parse(caida)
    assert.equal(caida.fuente.estado, "degradada")
    assert.equal(caida.fuente.confianza, "baja")
    assert.equal(caida.fuente.consultadoEn, new Date(AHORA).toISOString())
    assert.deepEqual(caida.anuncios.map((a) => a.identificador), ["largo"])
    assert.match(caida.fuente.mensaje, /no significa que no haya novedades/)

    falla = false
    r0.t += 60_000
    assert.equal((await servicio()).fuente.estado, "activa")
  } finally {
    aviso.mock.restore()
  }
})

test("una fuente atrasada (marca vieja) baja la confianza aunque responda", async () => {
  const marcaVieja = s(AHORA - EDAD_MAXIMA_FUENTE_MS - 60_000)
  const r = await crearServicioAnuncios({ obtener: async () => mensaje(marcaVieja, [vigente("a1")]), ahora: () => AHORA })()
  assert.equal(r.fuente.estado, "degradada")
  assert.equal(r.fuente.confianza, "baja")
})

test("un mensaje inválido cuenta como fallo y no rompe el servicio", async () => {
  const aviso = mock.method(console, "warn", () => {})
  try {
    const r = await crearServicioAnuncios({ obtener: async () => new Uint8Array([0x0a, 0x7f, 0x01]), ahora: () => AHORA })()
    assert.equal(r.fuente.estado, "sin-fuente")
  } finally {
    aviso.mock.restore()
  }
})

test("dentro del TTL no vuelve a consultar la fuente y varias peticiones comparten una consulta", async () => {
  const r0 = reloj()
  let llamadas = 0
  const servicio = crearServicioAnuncios({ obtener: async () => (llamadas++, mensaje(s(AHORA), [])), ahora: r0.ahora })
  await Promise.all([servicio(), servicio(), servicio()])
  r0.t += 10_000
  await servicio()
  assert.equal(llamadas, 1)
  r0.t += 40_000
  await servicio()
  assert.equal(llamadas, 2)
})

test("GET /api/anuncios devuelve la forma validada con 200 y sin caché, aun con la fuente caída", async () => {
  const aviso = mock.method(console, "warn", () => {})
  const red = mock.method(globalThis, "fetch", async () => new Response("no", { status: 503 }))
  try {
    const { GET } = await import(new URL("app/api/anuncios/route.ts", pathToFileURL(process.cwd() + "/")).href)
    const res: Response = await GET()
    assert.equal(res.status, 200)
    assert.equal(res.headers.get("cache-control"), "no-store")
    const cuerpo = AnunciosRespuestaSchema.parse(await res.json())
    assert.equal(cuerpo.fuente.estado, "sin-fuente")
    assert.equal(red.mock.callCount(), 1)
    assert.equal(String(red.mock.calls[0].arguments[0]), "https://gtfs.transmilenio.gov.co/alerts.pb")
  } finally {
    red.mock.restore()
    aviso.mock.restore()
  }
})
