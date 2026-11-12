import assert from "node:assert/strict"
import test, { mock } from "node:test"
import { pathToFileURL } from "node:url"
import { AnunciosRespuestaSchema } from "./anuncios"
import { AVISO_SIN_GARANTIA, ETIQUETA_ESTADO, fechaLegible, lineaFuente, textoHablado, vigenciaTexto } from "./anuncios-texto"
import { aAnuncios, crearServicioAnuncios, decodificarAlertas, EDAD_MAXIMA_FUENTE_MS, MAX_BYTES, MAX_SIN_CONSULTA_MS } from "./anuncios-servidor"

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

type Periodo = { desde?: number; hasta?: number }
type Prueba = {
  id: string
  desde?: number
  hasta?: number
  /** Sustituye a `desde`/`hasta`: varios periodos, o ninguno con `[]`. */
  periodos?: Periodo[]
  titulo?: string
  /** Sustituye a `titulo`: traducciones `[texto, idioma]` en ese orden. */
  traducciones?: [string, string][]
  desc?: string
  efecto?: number
  ruta?: string
  eliminada?: boolean
}
const periodo = (p: Periodo) => ld(1, [...(p.desde === undefined ? [] : num(1, p.desde)), ...(p.hasta === undefined ? [] : num(2, p.hasta))])
const alerta = (a: Prueba) =>
  ld(
    2,
    [
      ...str(1, a.id),
      ...(a.eliminada ? num(2, 1) : []),
      ...ld(
        5,
        [
          ...(a.periodos ?? [{ desde: a.desde, hasta: a.hasta }]).flatMap(periodo),
          ...ld(5, str(2, a.ruta ?? "10173")),
          ...ld(5, ld(5, [0x35, 0x31, 0x39, 0x35, 0x31])), // campo de relleno: se ignora
          ...num(7, a.efecto ?? 4),
          ...(a.traducciones ? ld(10, a.traducciones.flatMap(([t, i]) => ld(1, [...str(1, t), ...str(2, i)]))) : a.titulo === undefined ? [] : traducido(10, a.titulo)),
          ...(a.desc === undefined ? [] : traducido(11, a.desc)),
        ],
      ),
    ],
  )
const mensaje = (marca: number | null, alertas: Prueba[]) =>
  new Uint8Array([...(marca === null ? [] : ld(1, [...str(1, "2.0"), ...num(3, marca)])), ...alertas.flatMap(alerta)])

const AHORA = Date.UTC(2026, 10, 11, 17, 0, 0)
const s = (ms: number) => Math.floor(ms / 1000)
const decodificar = (bytes: Uint8Array) => decodificarAlertas(bytes, AHORA)
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
  const feed = decodificar(mensaje(s(AHORA), [vigente("a1", { ruta: "13307", efecto: 1 })]))
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
  assert.throws(() => decodificar(bueno.subarray(0, bueno.length - 3)))
  assert.throws(() => decodificar(new Uint8Array([0xff, 0xff, 0xff])))
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
  assert.ok(r.fuente.mensaje.endsWith(AVISO_SIN_GARANTIA))
})

test("vencidos, futuros, eliminados y vacíos se descartan", () => {
  const feed = decodificar(
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
  const feed = decodificar(
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

// ── Revisión de #81: cuerpos que no son un feed, marca de tiempo, vigencias y textos ──

const silencio = () => mock.method(console, "warn", () => {})

test("un cuerpo vacío, sin cabecera o con cabecera sin marca NO es un feed", () => {
  assert.throws(() => decodificar(new Uint8Array()), /sin cabecera/)
  assert.throws(() => decodificar(mensaje(null, [vigente("a1")])), /sin cabecera/)
  assert.throws(() => decodificar(new Uint8Array(ld(1, str(1, "2.0")))), /sin cabecera|marca/)
})

test("un 200 vacío no se muestra como fuente conectada: sin-fuente al inicio, degradada si ya hubo una buena", async () => {
  const aviso = silencio()
  try {
    assert.equal((await crearServicioAnuncios({ obtener: async () => new Uint8Array(), ahora: () => AHORA })()).fuente.estado, "sin-fuente")

    const r0 = reloj()
    let vacio = false
    const servicio = crearServicioAnuncios({ obtener: async () => (vacio ? new Uint8Array() : mensaje(s(AHORA), [vigente("a1")])), ahora: r0.ahora })
    assert.equal((await servicio()).fuente.estado, "activa")
    vacio = true
    r0.t += 60_000
    const r = await servicio()
    assert.equal(r.fuente.estado, "degradada")
    assert.equal(r.fuente.confianza, "baja")
    assert.equal(r.anuncios.length, 1)
  } finally {
    aviso.mock.restore()
  }
})

test("una marca absurda, en milisegundos, anterior a 2020 o adelantada se rechaza; una con poco desfase se acepta", async () => {
  for (const marca of [1e14, AHORA, 1_000_000_000, s(AHORA) + 2 * 3600]) {
    assert.throws(() => decodificar(mensaje(marca, [])), /fuera de rango/, String(marca))
  }
  assert.equal(decodificar(mensaje(s(AHORA) + 600, [])).marca, s(AHORA) + 600)

  const aviso = silencio()
  try {
    // Antes lanzaba RangeError al formatear `publicadoEn` y la ruta daba 500.
    const r = await crearServicioAnuncios({ obtener: async () => mensaje(1e14, [vigente("a1")]), ahora: () => AHORA })()
    AnunciosRespuestaSchema.parse(r)
    assert.equal(r.fuente.estado, "sin-fuente")
    assert.deepEqual(r.anuncios, [])
  } finally {
    aviso.mock.restore()
  }
})

test("varios periodos: rige el que contiene el momento; sin periodo rige mientras esté en el feed, sin inventar fecha", () => {
  const feed = decodificar(
    mensaje(s(AHORA), [
      vigente("dos", { periodos: [{ desde: s(AHORA) - 9000, hasta: s(AHORA) - 8000 }, { desde: s(AHORA) - 60, hasta: s(AHORA) + 60 }] }),
      vigente("ninguno-vigente", { periodos: [{ desde: s(AHORA) - 9000, hasta: s(AHORA) - 8000 }, { desde: s(AHORA) + 5000, hasta: s(AHORA) + 6000 }] }),
      vigente("sin-inicio", { periodos: [{ hasta: s(AHORA) + 60 }], titulo: "Sin inicio" }),
      vigente("sin-periodo", { periodos: [], titulo: "Sin periodo" }),
    ]),
  )
  const a = aAnuncios(feed, AHORA)
  assert.deepEqual(a.map((x) => x.identificador), ["dos", "sin-inicio", "sin-periodo"]) // los de fecha nula, al final
  assert.equal(a[0].fecha, new Date(AHORA - 60_000).toISOString())
  assert.equal(a[0].vigenciaHasta, new Date(AHORA + 60_000).toISOString())
  assert.equal(a[1].fecha, null)
  assert.equal(a[1].vigenciaHasta, new Date(AHORA + 60_000).toISOString())
  assert.equal(a[2].fecha, null)
  assert.equal(a[2].vigenciaHasta, null)
  AnunciosRespuestaSchema.parse({ fuente: { estado: "activa", confianza: "media", entidad: "x", nombre: "x", url: "x", consultadoEn: null, publicadoEn: null, mensaje: "x" }, anuncios: a })
})

test("idioma: prefiere el español aunque no sea el primero; sin español usa el primero", () => {
  const feed = decodificar(
    mensaje(s(AHORA), [
      vigente("a1", { traducciones: [["Hello", "en"], ["Hola", "es-CO"]] }),
      vigente("a2", { traducciones: [["Bonjour", "fr"], ["Hello", "en"]], desc: "otra descripción" }),
    ]),
  )
  assert.deepEqual(aAnuncios(feed, AHORA).map((x) => x.titulo).sort(), ["Bonjour", "Hola"])
})

test("los textos largos se acotan y terminan en puntos suspensivos", () => {
  const [a] = aAnuncios(decodificar(mensaje(s(AHORA), [vigente("a1", { titulo: "T".repeat(500), desc: "D".repeat(900) })])), AHORA)
  assert.equal(a.titulo.length, 120)
  assert.equal(a.descripcion.length, 300)
  assert.ok(a.titulo.endsWith("…") && a.descripcion.endsWith("…"))
})

test("un feed grande (600 alertas, como el real que creció) se decodifica entero", () => {
  const alertas = Array.from({ length: 600 }, (_, i) => vigente(`n${i}`, { titulo: `Obra ${i}`, desc: `Desvío ${i}` }))
  assert.equal(aAnuncios(decodificar(mensaje(s(AHORA), alertas)), AHORA).length, 600)
})

test("la espera máxima de la fuente se aplica: una consulta abortada es fallo y el servicio sigue respondiendo", async () => {
  const aviso = silencio()
  const espera = mock.method(AbortSignal, "timeout", () => AbortSignal.abort(new DOMException("tiempo agotado", "TimeoutError")))
  const red = mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
    if (init?.signal?.aborted) throw init.signal.reason
    return new Response(mensaje(s(AHORA), []))
  })
  try {
    const r = await crearServicioAnuncios({ ahora: () => AHORA })()
    assert.equal(espera.mock.callCount(), 1)
    assert.equal(r.fuente.estado, "sin-fuente")
  } finally {
    red.mock.restore()
    espera.mock.restore()
    aviso.mock.restore()
  }
})

test("una respuesta que pasa de MAX_BYTES sin Content-Length es fallo, se corta la lectura y se conserva lo anterior", async () => {
  const aviso = silencio()
  let cancelado = false
  let leidos = 0
  const enorme = () =>
    new Response(
      new ReadableStream<Uint8Array>({
        pull(c) {
          leidos += 1
          c.enqueue(new Uint8Array(1_000_000))
        },
        cancel() {
          cancelado = true
        },
      }),
    )
  let excede = false
  const red = mock.method(globalThis, "fetch", async () => (excede ? enorme() : new Response(mensaje(s(AHORA), [vigente("a1")]))))
  try {
    const r0 = reloj()
    const servicio = crearServicioAnuncios({ ahora: r0.ahora })
    assert.equal((await servicio()).fuente.estado, "activa")
    excede = true
    r0.t += 60_000
    const r = await servicio()
    assert.equal(r.fuente.estado, "degradada", "no se trunca ni se usa a medias")
    assert.equal(r.anuncios.length, 1)
    assert.equal(r.fuente.publicadoEn, new Date(AHORA).toISOString())
    assert.equal(cancelado, true)
    assert.ok(leidos <= Math.ceil(MAX_BYTES / 1_000_000) + 2, `leyó ${leidos} trozos`)
  } finally {
    red.mock.restore()
    aviso.mock.restore()
  }
})

test("el mensaje de fuente degradada cita cuándo PUBLICÓ la fuente, no cuándo se consultó", async () => {
  const marcaVieja = s(AHORA - EDAD_MAXIMA_FUENTE_MS - 3_600_000)
  const r = await crearServicioAnuncios({ obtener: async () => mensaje(marcaVieja, []), ahora: () => AHORA })()
  assert.equal(r.fuente.publicadoEn, new Date(marcaVieja * 1000).toISOString())
  assert.match(r.fuente.mensaje, /la fuente publicó el/)
})

test("lo que se dice en voz alta: fuente y su hora, y de cada anuncio entidad, título, descripción recortada, afectación y vigencia; con tope y aviso del resto", () => {
  const feed = decodificar(
    mensaje(s(AHORA), Array.from({ length: 7 }, (_, i) => vigente(`v${i}`, { titulo: i === 2 ? "Cierre 2." : `Cierre ${i}`, desc: i === 1 ? "D".repeat(300) : `descripción ${i}`, ...(i === 0 ? { hasta: undefined } : {}) }))),
  )
  const anuncios = aAnuncios(feed, AHORA)
  const publicado = new Date(AHORA).toISOString()
  const fuente = { estado: "activa", confianza: "media", entidad: "TransMilenio S.A.", nombre: "n", url: "u", consultadoEn: publicado, publicadoEn: publicado, mensaje: "Hay 7 anuncios vigentes." } as const
  const dicho = textoHablado({ fuente, anuncios })
  assert.ok(dicho.startsWith("Hay 7 anuncios vigentes."))
  assert.ok(dicho.includes(`publicado por la fuente el ${fechaLegible(publicado)}`), "la hora de la fuente se dice")
  for (const a of anuncios.slice(0, 5)) {
    assert.ok(dicho.includes(`Anuncio oficial de TransMilenio S.A.: ${a.titulo.replace(/\.$/, "")}.`), a.titulo)
    assert.ok(dicho.includes(a.descripcion.slice(0, 20)), "la descripción se dice")
  }
  assert.ok(!dicho.includes(anuncios[5].titulo))
  assert.ok(!dicho.includes("D".repeat(101)), "la descripción se recorta a ~100 caracteres")
  assert.ok(dicho.includes("D".repeat(99) + "…"))
  assert.ok(!dicho.includes("10173"), "los identificadores de ruta de la fuente no se leen")
  assert.match(dicho, /Desvío\./)
  assert.match(dicho, /sin fecha de fin\./)
  assert.match(dicho, /Vigente desde .*, hasta /)
  assert.match(dicho, /Los otros 2 están en la lista de la pantalla\./)
  assert.doesNotMatch(dicho, /\.\.(?!\.)/, "ninguna frase termina en punto doble («p. m..»)")
  assert.equal(textoHablado({ fuente: { ...fuente, estado: "sin-fuente", consultadoEn: null, publicadoEn: null, mensaje: "Sin fuente." }, anuncios: [] }), "Sin fuente.")
})

test("la vigencia nunca inventa un extremo y la fecha no lleva «p. m.»", () => {
  const desde = new Date(AHORA).toISOString()
  const hasta = new Date(AHORA + 3600_000).toISOString()
  assert.match(vigenciaTexto({ fecha: desde, vigenciaHasta: hasta }), /^Vigente desde .+, hasta .+$/)
  assert.match(vigenciaTexto({ fecha: desde, vigenciaHasta: null }), /, sin fecha de fin$/)
  assert.match(vigenciaTexto({ fecha: null, vigenciaHasta: hasta }), /^La fuente no publica el inicio; rige hasta /)
  assert.equal(vigenciaTexto({ fecha: null, vigenciaHasta: null }), "La fuente no publica ni el inicio ni el fin")
  assert.doesNotMatch(fechaLegible(new Date(Date.UTC(2026, 10, 11, 22, 5)).toISOString()), /p\. ?m|a\. ?m/i)
  assert.match(fechaLegible(new Date(Date.UTC(2026, 10, 11, 22, 5)).toISOString()), /17:05/)
})

test("la línea de la fuente dice quién, cuándo publicó y la última consulta; sin consulta buena no hay línea", () => {
  const iso = new Date(AHORA).toISOString()
  const base = { estado: "activa", confianza: "media", entidad: "TransMilenio S.A.", nombre: "n", url: "u", mensaje: "m" } as const
  const l = lineaFuente({ ...base, consultadoEn: iso, publicadoEn: iso })
  assert.match(l ?? "", /^Fuente: TransMilenio S\.A\., publicado por la fuente el .+; última consulta exitosa: .+\.$/)
  assert.doesNotMatch(lineaFuente({ ...base, consultadoEn: iso, publicadoEn: null }) ?? "", /publicado por la fuente/i)
  assert.equal(lineaFuente({ ...base, consultadoEn: null, publicadoEn: null }), null)
})

test("cada estado de la fuente tiene su rótulo, y «sin-fuente» no suena a «sin incidentes»", () => {
  assert.deepEqual(Object.keys(ETIQUETA_ESTADO).sort(), ["activa", "degradada", "sin-fuente"])
  for (const t of Object.values(ETIQUETA_ESTADO)) assert.doesNotMatch(t, /sin incidentes|sin novedades|todo normal/i)
})

test("todos los mensajes sin garantía usan la MISMA frase de seguridad", async () => {
  const aviso = silencio()
  try {
    const sin = await crearServicioAnuncios({ obtener: async () => { throw new Error("x") }, ahora: () => AHORA })()
    const vacia = await crearServicioAnuncios({ obtener: async () => mensaje(s(AHORA), []), ahora: () => AHORA })()
    const vieja = await crearServicioAnuncios({ obtener: async () => mensaje(s(AHORA - EDAD_MAXIMA_FUENTE_MS - 60_000), []), ahora: () => AHORA })()
    for (const r of [sin, vacia, vieja]) assert.ok(r.fuente.mensaje.endsWith(AVISO_SIN_GARANTIA), r.fuente.mensaje)
  } finally {
    aviso.mock.restore()
  }
})

// ── Revisión de #81, ronda 2: gravedad, caducidad sin consulta, tamaño y textos vacíos ──

test("el orden es por gravedad del efecto y, a igual gravedad, por fecha: sin servicio > reducido/desvío/accesibilidad > demoras > resto", () => {
  const t = (min: number) => ({ desde: s(AHORA) - min * 60, hasta: s(AHORA) + 3600 })
  const feed = decodificar(
    mensaje(s(AHORA), [
      vigente("otro-nuevo", { efecto: 7, ...t(1), titulo: "otro nuevo" }),
      vigente("demora-nueva", { efecto: 3, ...t(2), titulo: "demora nueva" }),
      vigente("desvio-viejo", { efecto: 4, ...t(50), titulo: "desvío viejo" }),
      vigente("desvio-nuevo", { efecto: 4, ...t(5), titulo: "desvío nuevo" }),
      vigente("sin-servicio-viejo", { efecto: 1, ...t(300), titulo: "sin servicio viejo" }),
      vigente("accesibilidad", { efecto: 11, ...t(10), titulo: "accesibilidad" }),
      vigente("reducido", { efecto: 2, ...t(20), titulo: "reducido" }),
    ]),
  )
  assert.deepEqual(aAnuncios(feed, AHORA).map((a) => a.identificador), [
    "sin-servicio-viejo",
    "desvio-nuevo",
    "accesibilidad",
    "reducido",
    "desvio-viejo",
    "demora-nueva",
    "otro-nuevo",
  ])
})

test("con la fuente caída más de 24 h un anuncio sin fecha de fin deja de mostrarse: vuelve a sin-fuente", async () => {
  const aviso = silencio()
  try {
    const r0 = reloj()
    let falla = false
    const servicio = crearServicioAnuncios({
      obtener: async () => {
        if (falla) throw new Error("HTTP 500")
        return mensaje(s(AHORA), [vigente("sin-fin", { hasta: undefined })])
      },
      ahora: r0.ahora,
    })
    assert.equal((await servicio()).anuncios.length, 1)
    falla = true
    r0.t += MAX_SIN_CONSULTA_MS - 60_000
    const antes = await servicio()
    assert.equal(antes.fuente.estado, "degradada")
    assert.equal(antes.anuncios.length, 1)
    r0.t += 120_000
    const despues = await servicio()
    assert.equal(despues.fuente.estado, "sin-fuente")
    assert.equal(despues.fuente.confianza, "ninguna")
    assert.deepEqual(despues.anuncios, [])
  } finally {
    aviso.mock.restore()
  }
})

test("una respuesta de más de la mitad de la cota avisa en el registro, una sola vez", async () => {
  const aviso = silencio()
  const relleno = new Uint8Array(MAX_BYTES / 2 + 1000)
  const grande = new Uint8Array([...mensaje(s(AHORA), [vigente("a1")]), ...ld(99, relleno)]) // campo desconocido: se ignora
  const r0 = reloj()
  try {
    const servicio = crearServicioAnuncios({ obtener: async () => grande, ahora: r0.ahora })
    assert.equal((await servicio()).fuente.estado, "activa", "por debajo de la cota sigue funcionando")
    r0.t += 60_000
    await servicio()
    const avisos = aviso.mock.calls.filter((c) => String(c.arguments[0]).includes("mitad de la cota"))
    assert.equal(avisos.length, 1)
  } finally {
    aviso.mock.restore()
  }
  const sinAviso = silencio()
  try {
    await crearServicioAnuncios({ obtener: async () => mensaje(s(AHORA), [vigente("a1")]), ahora: () => AHORA })()
    assert.equal(sinAviso.mock.calls.length, 0, "una respuesta normal no avisa")
  } finally {
    sinAviso.mock.restore()
  }
})

test("un texto en español vacío cae a la primera traducción con texto", () => {
  const feed = decodificar(
    mensaje(s(AHORA), [
      vigente("a1", { traducciones: [["", "es"], ["Hello", "en"]], desc: "d1" }),
      vigente("a2", { traducciones: [["  ", "es-CO"], ["Hola", "es"]], desc: "d2" }),
    ]),
  )
  assert.deepEqual(aAnuncios(feed, AHORA).map((a) => a.titulo).sort(), ["Hello", "Hola"])
})
