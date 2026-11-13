import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test, { mock } from "node:test"
import { pathToFileURL } from "node:url"
import snapshot from "../data/transmilenio.json" with { type: "json" }
import {
  LIMITE_CONSULTA,
  LIMITE_PLANEAR,
  MAX_CODIGO,
  MAX_CONSULTA,
  MAX_ESTACIONES,
  MAX_LUGAR,
  MAX_LUGARES,
  MAX_PUNTOS_TRAZADO,
  MAX_RUTAS,
  MAXIMO_BYTES_CUERPO,
  PeticionPlanificadorSchema,
  RespuestaBuscarRutasSchema,
  RespuestaDetalleRutaSchema,
  RespuestaLugaresSchema,
  RespuestaViajeSchema,
  resolverPeticion,
  type PeticionPlanificador,
} from "./contrato-planificador"
import { datosExpreso, datosSinVerificar, datosTransbordoVerificado, datosVerificadosDirecto } from "./fixtures-sinteticas"
import { contieneImperativoDeViaje } from "./local-agent"
import { listarLugares, lugarPorNombre } from "./routes"
import { TransmilenioDataSchema } from "./transmilenio"

// EA-25 (#51): contrato estructurado del planificador para el iPhone. Datos sintéticos de
// `fixtures-sinteticas.ts` (nada oficial) y la copia guardada; sin red.

const copia = TransmilenioDataSchema.parse(snapshot)
/** Miércoles 11/11/2026, 10:00 en Bogotá: dentro de las franjas sintéticas (05:00–23:00). */
const ahora = new Date("2026-11-11T10:00:00-05:00")
/** Mismo día, 03:00: antes de la primera salida programada. */
const madrugada = new Date("2026-11-11T03:00:00-05:00")

const resolver = (peticion: PeticionPlanificador, data = copia, instante = ahora) => resolverPeticion(peticion, data, instante)
const planear = (origen: string, destino: string, data = datosVerificadosDirecto(), instante = ahora) =>
  resolver({ operacion: "planear-viaje", origen, destino }, data, instante)

// ── Petición ──

test("la petición se valida de forma estricta: operación conocida, textos recortados y acotados, sin campos de más", () => {
  const ok = (valor: unknown) => PeticionPlanificadorSchema.safeParse(valor).success
  assert.equal(ok({ operacion: "buscar-rutas", consulta: "  B23 " }), true)
  assert.equal(PeticionPlanificadorSchema.parse({ operacion: "buscar-rutas", consulta: "  B23 " }).operacion, "buscar-rutas")
  assert.deepEqual(PeticionPlanificadorSchema.parse({ operacion: "detalle-ruta", codigo: " b23 " }), { operacion: "detalle-ruta", codigo: "b23" })
  assert.equal(ok({ operacion: "listar-lugares" }), true)
  assert.equal(ok({ operacion: "planear-viaje", origen: "Alfa", destino: "Eco" }), true)

  assert.equal(ok({ operacion: "buscar-rutas", consulta: "   " }), false, "vacía tras recortar")
  assert.equal(ok({ operacion: "buscar-rutas", consulta: "a".repeat(MAX_CONSULTA + 1) }), false)
  assert.equal(ok({ operacion: "detalle-ruta", codigo: "a".repeat(MAX_CODIGO + 1) }), false)
  assert.equal(ok({ operacion: "planear-viaje", origen: "Alfa", destino: "e".repeat(MAX_LUGAR + 1) }), false)
  assert.equal(ok({ operacion: "planear-viaje", origen: "Alfa" }), false, "falta el destino")
  assert.equal(ok({ operacion: "planear-viaje", origen: "Alfa", destino: "Eco", message: "de Alfa a Eco" }), false, "no admite frases ni campos extra")
  assert.equal(ok({ operacion: "buscar-rutas", consulta: 5 }), false)
  assert.equal(ok({ operacion: "teletransportar" }), false)
  assert.equal(ok({}), false)
})

test("las cotas de la petición son las que repite el cliente de iPhone", () => {
  const swift = readFileSync(new URL("../ios/TransMiVoz/Red/EntradaPlanificador.swift", import.meta.url), "utf8")
  const valor = (nombre: string) => Number(new RegExp(`static let ${nombre} = ([\\d_]+)`).exec(swift)?.[1].replaceAll("_", ""))
  assert.equal(valor("maximoConsulta"), MAX_CONSULTA)
  assert.equal(valor("maximoCodigo"), MAX_CODIGO)
  assert.equal(valor("maximoLugar"), MAX_LUGAR)
  assert.equal(valor("maximoBytesCuerpo"), MAXIMO_BYTES_CUERPO)
})

test("las cotas de las respuestas del servidor son las que hace cumplir el cliente de iPhone", () => {
  const swift = readFileSync(new URL("../ios/TransMiVoz/Dominio/RespuestaPlanificador.swift", import.meta.url), "utf8")
  const valor = (nombre: string) => Number(new RegExp(`static let ${nombre} = ([\\d_]+)`).exec(swift)?.[1].replaceAll("_", ""))
  assert.equal(valor("maximoRutas"), MAX_RUTAS)
  assert.equal(valor("maximoEstaciones"), MAX_ESTACIONES)
  assert.equal(valor("maximoPuntosTrazado"), MAX_PUNTOS_TRAZADO)
  assert.equal(valor("maximoLugares"), MAX_LUGARES)
})

test("cada ruta del catálogo cabe en las cotas de su respuesta de detalle", () => {
  for (const ruta of copia.routes) {
    const r = resolver({ operacion: "detalle-ruta", codigo: ruta.code })
    assert.equal(r.estado, 200, ruta.code)
    assert.ok(RespuestaDetalleRutaSchema.safeParse(r.cuerpo).success, ruta.code)
  }
})

// ── buscar-rutas ──

test("buscar-rutas: un código devuelve esa ruta, con el contrato y la procedencia del catálogo", () => {
  const r = resolver({ operacion: "buscar-rutas", consulta: "B23" })
  assert.equal(r.estado, 200)
  const cuerpo = RespuestaBuscarRutasSchema.parse(r.cuerpo)
  assert.equal(cuerpo.total, 1)
  const b23 = copia.routes.find((x) => x.code === "B23")!
  assert.deepEqual(cuerpo.rutas, [{ codigo: "B23", desde: b23.from, hacia: b23.to }])
  assert.equal(cuerpo.catalogo.antiguo, true, "la copia guardada es antigua")
})

test("buscar-rutas: una estación devuelve las rutas cuyo recorrido pasa por ella, y sin coincidencias, una lista vacía", () => {
  const conEstacion = RespuestaBuscarRutasSchema.parse(resolver({ operacion: "buscar-rutas", consulta: "Ricaurte" }).cuerpo)
  assert.ok(conEstacion.total > 0)
  assert.equal(conEstacion.rutas.length, Math.min(conEstacion.total, MAX_RUTAS))

  const vacia = RespuestaBuscarRutasSchema.parse(resolver({ operacion: "buscar-rutas", consulta: "zzzz qqqq" }).cuerpo)
  assert.deepEqual(vacia.rutas, [])
  assert.equal(vacia.total, 0)
})

test("buscar-rutas: con más de 50 coincidencias devuelve 50 y dice cuántas hay", () => {
  const modelo = copia.routes[0]
  const muchas = { ...copia, routes: Array.from({ length: 60 }, (_, i) => ({ ...modelo, id: `X${i}`, code: `X${i}` })) }
  const cuerpo = RespuestaBuscarRutasSchema.parse(resolver({ operacion: "buscar-rutas", consulta: modelo.from }, muchas).cuerpo)
  assert.equal(cuerpo.rutas.length, MAX_RUTAS)
  assert.equal(cuerpo.total, 60)
})

// ── detalle-ruta ──

test("detalle-ruta con paradas verificadas: sentido confirmado, calendario de hoy y cada estación marcada con su coordenada", () => {
  const r = resolver({ operacion: "detalle-ruta", codigo: "V1" }, datosVerificadosDirecto())
  const d = RespuestaDetalleRutaSchema.parse(r.cuerpo)
  assert.equal(d.sentido, "confirmado")
  assert.equal(d.calendario, "opera")
  assert.deepEqual(d.estaciones.map((e) => e.nombre), ["Alfa", "Bravo", "Charlie", "Delta", "Eco"])
  assert.ok(d.estaciones.every((e) => e.paradaVerificada && e.coordenada !== null))
  assert.deepEqual(d.estaciones[0].coordenada, { lat: 4.6, lng: -74.08 })
  assert.equal(d.trazado.length, 5)
  assert.equal(d.horario.festivo, "", "un horario no publicado llega vacío")
})

test("detalle-ruta sin paradas verificadas: no marca ninguna parada y no afirma sentido ni operación", () => {
  const d = RespuestaDetalleRutaSchema.parse(resolver({ operacion: "detalle-ruta", codigo: "H0" }, datosSinVerificar()).cuerpo)
  assert.equal(d.sentido, "sin-confirmar")
  assert.equal(d.calendario, "sin-verificar")
  assert.ok(d.estaciones.every((e) => !e.paradaVerificada))
})

test("detalle-ruta: un sentido contradictorio se distingue del sin confirmar", () => {
  const contradictoria = copia.routes.find((x) => x.directionEvidence.agreement === "contradictorio")!
  const d = RespuestaDetalleRutaSchema.parse(resolver({ operacion: "detalle-ruta", codigo: contradictoria.code }).cuerpo)
  assert.equal(d.sentido, "contradictorio")
  assert.ok(d.estaciones.length > 0)
})

test("detalle-ruta: el código se compara sin mayúsculas ni espacios y uno desconocido es 404", () => {
  const minuscula = resolver({ operacion: "detalle-ruta", codigo: "v1" }, datosVerificadosDirecto())
  assert.equal(minuscula.estado, 200)
  const conEspacio = RespuestaDetalleRutaSchema.parse(resolver({ operacion: "detalle-ruta", codigo: "8g" }).cuerpo)
  assert.equal(conEspacio.codigo, "8 G")
  assert.deepEqual(resolver({ operacion: "detalle-ruta", codigo: "NOEXISTE" }), { estado: 404, cuerpo: { error: "no-encontrado" } })
})

test("detalle-ruta: una estación sin coordenada en el catálogo llega con coordenada nula, no inventada", () => {
  const data = datosVerificadosDirecto()
  data.stations = data.stations.filter((s) => s.name !== "Charlie")
  const d = RespuestaDetalleRutaSchema.parse(resolver({ operacion: "detalle-ruta", codigo: "V1" }, data).cuerpo)
  assert.equal(d.estaciones.find((e) => e.nombre === "Charlie")?.coordenada, null)
  assert.equal(d.estaciones.length, 5, "el listado conserva la estación")
})

// ── listar-lugares ──

test("listar-lugares: nombres únicos y ordenados, y cada uno se resuelve de vuelta por su nombre exacto", () => {
  const { lugares } = RespuestaLugaresSchema.parse(resolver({ operacion: "listar-lugares" }).cuerpo)
  assert.ok(lugares.length > 50)
  assert.equal(new Set(lugares).size, lugares.length)
  assert.deepEqual([...lugares].sort((a, b) => a.localeCompare(b, "es")), lugares)
  for (const nombre of lugares) assert.equal(lugarPorNombre(nombre, copia)?.name, nombre, nombre)
  assert.equal(lugares.length, listarLugares(copia).length)
})

test("lugarPorNombre no interpreta frases: «de Alfa a Eco» no es un lugar", () => {
  const data = datosVerificadosDirecto()
  assert.equal(lugarPorNombre("alfa", data)?.name, "Alfa", "mayúsculas y tildes no importan")
  assert.equal(lugarPorNombre("de Alfa a Eco", data), undefined)
  assert.equal(lugarPorNombre("Alfa Bravo", data), undefined)
})

// ── planear-viaje ──

test("planear-viaje operativo: un tramo con abordaje, descenso, conteo verificado y el trazado entre ambas estaciones", () => {
  const r = planear("Alfa", "Eco")
  assert.equal(r.estado, 200)
  const v = RespuestaViajeSchema.parse(r.cuerpo)
  assert.equal(v.resultado, "operativo")
  assert.equal(v.origen, "Alfa")
  assert.equal(v.destino, "Eco")
  assert.deepEqual(v.rutasPorElTrazado, [])
  assert.equal(v.tramos.length, 1)
  const [tramo] = v.tramos
  assert.equal(tramo.codigoRuta, "V1")
  assert.equal(tramo.abordaje.nombre, "Alfa")
  assert.equal(tramo.descenso.nombre, "Eco")
  assert.deepEqual(tramo.abordaje.coordenada, { lat: 4.6, lng: -74.08 })
  assert.deepEqual(tramo.descenso.coordenada, { lat: 4.68, lng: -74.08 })
  assert.equal(tramo.estacionesRecorridas, 4)
  assert.equal(tramo.conteoVerificado, true)
  // El mapa dibuja solo este tramo: del abordaje al descenso.
  assert.deepEqual(tramo.trazado[0], tramo.abordaje.coordenada)
  assert.deepEqual(tramo.trazado.at(-1), tramo.descenso.coordenada)
})

test("planear-viaje con transbordo: dos tramos, y el descenso del primero es el abordaje del segundo", () => {
  const v = RespuestaViajeSchema.parse(planear("Alfa", "Eco", datosTransbordoVerificado()).cuerpo)
  assert.equal(v.resultado, "operativo")
  assert.deepEqual(v.tramos.map((t) => t.codigoRuta), ["P1", "Q1"])
  assert.equal(v.tramos[0].descenso.nombre, v.tramos[1].abordaje.nombre)
})

test("planear-viaje fuera de franja: un servicio candidato que trae solo el código de la ruta", () => {
  const cuerpo = planear("Alfa", "Eco", datosVerificadosDirecto(), madrugada).cuerpo
  const v = RespuestaViajeSchema.parse(cuerpo)
  assert.equal(v.resultado, "candidato")
  assert.deepEqual(v.tramos, [{ codigoRuta: "V1" }])
})

test("regresión: un candidato (operación sin confirmar) no lleva paradas, conteo, trazado ni coordenadas", () => {
  const estaciones = datosTransbordoVerificado().stations.map((e) => e.name)
  // Con transbordo (P1 y Q1) las paradas intermedias y la del cambio serían órdenes de abordaje.
  const cuerpo = planear("Alfa", "Eco", datosTransbordoVerificado(), madrugada).cuerpo as { origen: string; destino: string; tramos: unknown[] }
  assert.equal(RespuestaViajeSchema.parse(cuerpo).resultado, "candidato")
  assert.deepEqual(cuerpo.tramos, [{ codigoRuta: "P1" }, { codigoRuta: "Q1" }])
  // Solo el origen y el destino que la persona eligió pueden nombrar estaciones.
  const resto = JSON.stringify({ ...cuerpo, origen: "", destino: "" })
  for (const nombre of estaciones) assert.equal(resto.includes(nombre), false, `el candidato no nombra «${nombre}»`)
  for (const campo of ["abordaje", "descenso", "trazado", "coordenada", "estacionesRecorridas", "conteoVerificado", "lat", "lng"]) {
    assert.equal(resto.includes(`"${campo}"`), false, `el candidato no trae «${campo}»`)
  }
  // El esquema tampoco admite un tramo candidato con paradas, y un operativo sí las trae.
  const conParadas = { ...cuerpo, tramos: [{ codigoRuta: "P1", abordaje: { nombre: "Alfa", coordenada: null } }] }
  assert.equal(RespuestaViajeSchema.safeParse(conParadas).success, false)
  const operativo = RespuestaViajeSchema.parse(planear("Alfa", "Eco", datosTransbordoVerificado()).cuerpo)
  assert.equal(operativo.resultado, "operativo")
  assert.ok(JSON.stringify(operativo.tramos).includes("Charlie"), "el operativo sí nombra la parada del transbordo")
})

test("planear-viaje sin paradas verificadas: solo el recorrido, con las rutas que pasan cerca de los dos lugares", () => {
  const v = RespuestaViajeSchema.parse(planear("Alfa", "Eco", datosSinVerificar()).cuerpo)
  assert.equal(v.resultado, "recorrido")
  assert.deepEqual(v.tramos, [])
  assert.deepEqual(v.rutasPorElTrazado, [{ codigo: "H0", desde: "Alfa", hacia: "Eco" }])
})

test("planear-viaje con un expreso que no para en Bravo: no ofrece abordar allí, solo el recorrido", () => {
  const v = RespuestaViajeSchema.parse(planear("Alfa", "Bravo", datosExpreso()).cuerpo)
  assert.equal(v.resultado, "recorrido")
  assert.deepEqual(v.tramos, [])
  assert.deepEqual(v.rutasPorElTrazado.map((r) => r.codigo), ["X1"])
})

test("planear-viaje sin ruta que conecte los dos lugares: sin recorrido, sin afirmar que no exista servicio en el cuerpo", () => {
  const base = datosSinVerificar()
  const [ruta] = base.routes
  const data = {
    ...base,
    routes: [
      { ...ruta, id: "P0", code: "P0", stops: ["Alfa", "Bravo"] },
      { ...ruta, id: "Q0", code: "Q0", stops: ["Delta", "Eco"] },
    ],
  }
  const v = RespuestaViajeSchema.parse(planear("Alfa", "Eco", data).cuerpo)
  assert.equal(v.resultado, "sin-recorrido")
  assert.deepEqual(v.rutasPorElTrazado, [])
})

test("planear-viaje con el mismo origen y destino: mismo lugar, sin tramos", () => {
  const v = RespuestaViajeSchema.parse(planear("Alfa", "alfa").cuerpo)
  assert.equal(v.resultado, "mismo-lugar")
  assert.deepEqual(v.tramos, [])
})

test("planear-viaje: un nombre que no es un lugar del catálogo (ni una frase) es 404 y no se interpreta", () => {
  assert.deepEqual(planear("Narnia", "Eco"), { estado: 404, cuerpo: { error: "no-encontrado" } })
  assert.deepEqual(planear("Alfa", "Narnia"), { estado: 404, cuerpo: { error: "no-encontrado" } })
  assert.equal(planear("de Alfa a Eco", "Eco").estado, 404, "la selección no se convierte en frase")
})

test("la respuesta de un viaje operativo no trae texto libre con órdenes de abordaje", () => {
  assert.equal(contieneImperativoDeViaje(JSON.stringify(planear("Alfa", "Eco").cuerpo)), false)
})

// ── Contrato iOS ──

test("contrato iOS: los fixtures de FixturesPlanificador.swift cumplen los esquemas del servidor", () => {
  const swift = readFileSync(new URL("../ios/TransMiVozTests/FixturesPlanificador.swift", import.meta.url), "utf8")
  const fixtures = [...swift.matchAll(/\/\/ FIXTURE-INICIO (\w+)\n\s*static let \1 = #"""\n\s*(.+)\n\s*"""#\n\s*\/\/ FIXTURE-FIN/g)]
  assert.ok(fixtures.length >= 15, `solo se leyeron ${fixtures.length} fixtures`)
  const esquemas = [
    ["peticion", PeticionPlanificadorSchema],
    ["buscar", RespuestaBuscarRutasSchema],
    ["detalle", RespuestaDetalleRutaSchema],
    ["lugares", RespuestaLugaresSchema],
    ["viaje", RespuestaViajeSchema],
  ] as const
  for (const [, nombre, json] of fixtures) {
    const esquema = esquemas.find(([prefijo]) => nombre.startsWith(prefijo))?.[1]
    assert.ok(esquema, `ningún esquema para ${nombre}`)
    assert.equal(esquema.safeParse(JSON.parse(json)).success, true, nombre)
  }
  // Cada operación y cada estado del viaje tiene su fixture: el cliente no decodifica nada que el servidor no pueda emitir.
  const estados = new Set(
    fixtures.filter(([, nombre]) => nombre.startsWith("viaje")).map(([, , json]) => RespuestaViajeSchema.parse(JSON.parse(json)).resultado),
  )
  assert.deepEqual([...estados].sort(), ["candidato", "mismo-lugar", "operativo", "recorrido", "sin-recorrido"])
})

test("contrato iOS: los fixtures inválidos de FixturesPlanificador.swift son los que el servidor tampoco emitiría", () => {
  const swift = readFileSync(new URL("../ios/TransMiVozTests/FixturesPlanificador.swift", import.meta.url), "utf8")
  const invalidos = [...swift.matchAll(/static let (detalle\w+|buscar\w+|lugares\w+|viaje\w+) = #"""\n\s*(.+)\n\s*"""#/g)]
    .filter(([, nombre]) => !swift.includes(`// FIXTURE-INICIO ${nombre}\n`))
  assert.ok(invalidos.length >= 10, `solo se leyeron ${invalidos.length} fixtures inválidos`)
  const respuestas = [RespuestaBuscarRutasSchema, RespuestaDetalleRutaSchema, RespuestaLugaresSchema, RespuestaViajeSchema]
  const rechazadosPorElEsquema = invalidos.filter(([, , json]) => !respuestas.some((e) => e.safeParse(JSON.parse(json)).success))
  // Los que rompen el ESQUEMA (valor desconocido, campo faltante, coordenada fuera de rango) los rechaza también el servidor;
  // los demás (estado con datos que no le corresponden) son reglas de coherencia que solo exige el cliente.
  assert.ok(rechazadosPorElEsquema.length >= 5, `solo ${rechazadosPorElEsquema.length} los rechaza el esquema`)
})

// ── Endpoint ──

const raiz = pathToFileURL(process.cwd() + "/")
let contador = 0

/** Instancia fresca del endpoint con la red externa caída: usa la copia guardada. */
async function conEndpoint() {
  const fetchSimulado = mock.method(globalThis, "fetch", async () => {
    throw new Error("sin red (prueba EA-25): usa la copia")
  })
  const modulo: typeof import("../app/api/planificador/route") = await import(
    new URL(`app/api/planificador/route.ts?caso=${contador++}`, raiz).href
  )
  return { POST: modulo.POST, restaurar: () => fetchSimulado.mock.restore() }
}

const enviar = (cuerpo: string) => new Request("http://local/api/planificador", { method: "POST", body: cuerpo })

test("endpoint: una petición válida responde 200 con el contrato", async () => {
  const e = await conEndpoint()
  try {
    const lugares = await e.POST(enviar(JSON.stringify({ operacion: "listar-lugares" })))
    assert.equal(lugares.status, 200)
    const { lugares: nombres } = RespuestaLugaresSchema.parse(await lugares.json())

    const viaje = await e.POST(enviar(JSON.stringify({ operacion: "planear-viaje", origen: nombres[0], destino: nombres[1] })))
    assert.equal(viaje.status, 200)
    RespuestaViajeSchema.parse(await viaje.json())
  } finally {
    e.restaurar()
  }
})

test("endpoint: planear tiene su propio límite estricto y no agota las demás operaciones", async () => {
  const e = await conEndpoint()
  try {
    const { lugares } = RespuestaLugaresSchema.parse(await (await e.POST(enviar(JSON.stringify({ operacion: "listar-lugares" })))).json())
    const planearViaje = () =>
      e.POST(enviar(JSON.stringify({ operacion: "planear-viaje", origen: lugares[0], destino: lugares[1] })))
    for (let i = 1; i <= LIMITE_PLANEAR; i++) assert.equal((await planearViaje()).status, 200, `petición ${i} dentro del límite`)
    const rechazada = await planearViaje()
    assert.equal(rechazada.status, 429)
    assert.ok(Number(rechazada.headers.get("Retry-After")) >= 1, "incluye Retry-After")
    assert.deepEqual(await rechazada.json(), { error: "demasiadas-peticiones" })
    // Otro cubo: la búsqueda sigue respondiendo.
    assert.equal((await e.POST(enviar(JSON.stringify({ operacion: "buscar-rutas", consulta: "B23" })))).status, 200)
  } finally {
    e.restaurar()
  }
})

test("endpoint: las operaciones baratas tienen un límite mayor, también con 429 y Retry-After", async () => {
  const e = await conEndpoint()
  try {
    const consultar = () => e.POST(enviar(JSON.stringify({ operacion: "buscar-rutas", consulta: "B23" })))
    assert.ok(LIMITE_CONSULTA > LIMITE_PLANEAR)
    for (let i = 1; i <= LIMITE_CONSULTA; i++) assert.equal((await consultar()).status, 200, `petición ${i} dentro del límite`)
    const rechazada = await consultar()
    assert.equal(rechazada.status, 429)
    assert.ok(rechazada.headers.get("Retry-After"))
  } finally {
    e.restaurar()
  }
})

test("endpoint: cuerpo inválido, JSON roto o desbordado y lugar desconocido responden 400, 413 y 404", async () => {
  const e = await conEndpoint()
  try {
    assert.equal((await e.POST(enviar(JSON.stringify({ operacion: "buscar-rutas", consulta: "" })))).status, 400)
    assert.equal((await e.POST(enviar("{no es json"))).status, 400)
    assert.equal((await e.POST(enviar(JSON.stringify({ operacion: "buscar-rutas", consulta: "a".repeat(5_000) })))).status, 413)
    assert.equal((await e.POST(enviar(JSON.stringify({ operacion: "detalle-ruta", codigo: "NOEXISTE" })))).status, 404)
    const respuesta = await e.POST(enviar(JSON.stringify({ operacion: "planear-viaje", origen: "Narnia", destino: "Eco" })))
    assert.equal(respuesta.status, 404)
    assert.deepEqual(await respuesta.json(), { error: "no-encontrado" })
  } finally {
    e.restaurar()
  }
})
