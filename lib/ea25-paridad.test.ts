import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test, { mock } from "node:test"
import { pathToFileURL } from "node:url"
import snapshot from "../data/transmilenio.json" with { type: "json" }
import {
  LIMITE_CONSULTA,
  MAXIMO_BYTES_CUERPO,
  MAX_ALTERNATIVAS,
  MAX_EDAD_LECTURA_MS,
  MAX_PRECISION_M,
  PeticionPlanificadorSchema,
  RespuestaEstacionesCercanasSchema,
  RespuestaMetroSchema,
  RespuestaViajeSchema,
  resolverPeticion,
  type PeticionPlanificador,
} from "./contrato-planificador"
import { MAX_PUNTOS_HUELLA, MAX_PUNTOS_TRAZADO_METRO, MAX_TEXTO_METRO, RESPUESTA_METRO } from "./contrato-metro"
import { ESTACIONES_SINTETICAS, datosExpreso, datosTransbordoVerificado, datosVerificadosDirecto } from "./fixtures-sinteticas"
import { bearingDegrees, cardinal, distanceMeters, relativeDirection, spokenDistance } from "./geo"
import { interpretCommand } from "./local-agent"
import * as metro from "./metro"
import * as cartografia from "./metro-cartografia"
import { compilar, nodos, texto } from "./metro-prueba-ui"
import { MAX_ESTACIONES_CERCANAS, MAX_PLANES_VIAJE, alternativasDelViaje, listarLugares, lugarPorNombre, nearestStations, planTrip } from "./routes"
import { TransmilenioDataSchema, type TransmilenioData } from "./transmilenio"
import { EDAD_MAXIMA_POSICION_MS } from "./ubicacion"

// EA-25 (#51), paridad con la web: alternativas del viaje, Metro de la Línea 1 y estaciones cercanas. Datos
// sintéticos de `fixtures-sinteticas.ts` y la copia guardada; sin red.

const copia = TransmilenioDataSchema.parse(snapshot)
/** Miércoles 11/11/2026, 10:00 en Bogotá: dentro de las franjas sintéticas (05:00–23:00). */
const ahora = new Date("2026-11-11T10:00:00-05:00")
/** Mismo día, 03:00: antes de la primera salida programada. */
const madrugada = new Date("2026-11-11T03:00:00-05:00")

const resolver = (peticion: PeticionPlanificador, data: TransmilenioData = copia, instante = ahora) => resolverPeticion(peticion, data, instante)
const planear = (origen: string, destino: string, data = datosVerificadosDirecto(), instante = ahora) =>
  resolver({ operacion: "planear-viaje", origen, destino }, data, instante)

// ── Petición ──

const ok = (valor: unknown) => PeticionPlanificadorSchema.safeParse(valor).success
const cerca = { operacion: "estaciones-cercanas", lat: 4.61, lng: -74.08 }

test("metro-linea-1 no lleva más campos y estaciones-cercanas valida rangos, tipos y campos de más", () => {
  assert.equal(ok({ operacion: "metro-linea-1" }), true)
  assert.equal(ok({ operacion: "metro-linea-1", linea: 2 }), false, "sin campos de más")

  assert.equal(ok(cerca), true)
  assert.equal(ok({ ...cerca, precision: 12.5, edadMs: 800, rumbo: { grados: 90, calidad: 10, edadMs: 300 } }), true)
  assert.equal(ok({ ...cerca, rumbo: { grados: 90, edadMs: 300 } }), true, "la calidad del rumbo es opcional")

  // Los extremos de los rangos son válidos y un paso más allá, no.
  for (const [lat, lng] of [[90, 180], [-90, -180], [0, 0]]) assert.equal(ok({ ...cerca, lat, lng }), true, `${lat}, ${lng}`)
  for (const [lat, lng] of [[90.0001, 0], [-90.0001, 0], [0, 180.0001], [0, -180.0001], [1e9, 0]]) assert.equal(ok({ ...cerca, lat, lng }), false, `${lat}, ${lng}`)

  assert.equal(ok({ operacion: "estaciones-cercanas", lat: 4.61 }), false, "falta la longitud")
  assert.equal(ok({ operacion: "estaciones-cercanas", lng: -74.08 }), false, "falta la latitud")
  assert.equal(ok({ ...cerca, lat: "4.61" }), false, "la coordenada es un número, no un texto")
  assert.equal(ok({ ...cerca, lat: null }), false)
  assert.equal(ok({ ...cerca, message: "dónde estoy" }), false, "no admite campos de más")

  assert.equal(ok({ ...cerca, precision: -1 }), false)
  assert.equal(ok({ ...cerca, precision: 0 }), true)
  assert.equal(ok({ ...cerca, precision: MAX_PRECISION_M }), true)
  assert.equal(ok({ ...cerca, precision: MAX_PRECISION_M + 1 }), false)
  assert.equal(ok({ ...cerca, edadMs: -1 }), false)
  assert.equal(ok({ ...cerca, edadMs: 1.5 }), false, "milisegundos enteros")
  assert.equal(ok({ ...cerca, edadMs: MAX_EDAD_LECTURA_MS + 1 }), false)

  assert.equal(ok({ ...cerca, rumbo: { grados: 361, edadMs: 0 } }), false)
  assert.equal(ok({ ...cerca, rumbo: { grados: -1, edadMs: 0 } }), false)
  assert.equal(ok({ ...cerca, rumbo: { grados: 90 } }), false, "sin la edad del rumbo no se sabe si es actual")
  assert.equal(ok({ ...cerca, rumbo: { grados: 90, edadMs: 0, referencia: "relativa" } }), false, "el rumbo es siempre respecto al norte")
  assert.equal(ok({ ...cerca, rumbo: { grados: 90, calidad: 400, edadMs: 0 } }), false)
})

test("la petición más grande que admite estaciones-cercanas cabe en el cuerpo máximo", () => {
  const mayor = {
    operacion: "estaciones-cercanas",
    lat: -89.123456789012,
    lng: -179.123456789012,
    precision: MAX_PRECISION_M - 0.123456789,
    edadMs: MAX_EDAD_LECTURA_MS,
    rumbo: { grados: 359.123456789, calidad: 359.123456789, edadMs: MAX_EDAD_LECTURA_MS },
  }
  assert.equal(ok(mayor), true)
  assert.ok(Buffer.byteLength(JSON.stringify(mayor)) < MAXIMO_BYTES_CUERPO / 2)
})

// ── Alternativas del viaje ──

/** V1 (4 estaciones, todas las paradas), V2 y V3 iguales, y el expreso X1 (2 estaciones: gana el orden). */
function datosConAlternativas(): TransmilenioData {
  const base = datosVerificadosDirecto()
  const [v1] = base.routes
  const copiaDe = (code: string) => ({ ...structuredClone(v1), id: code, code })
  return { ...base, routes: [v1, copiaDe("V2"), copiaDe("V3"), datosExpreso().routes[0]] }
}

const cuerpoViaje = (r: ReturnType<typeof resolver>) => RespuestaViajeSchema.parse(r.cuerpo)
/** Lo que la web dice tras «También te sirven», o `null` si no lo dice. */
const alternativasDeLaWeb = (data: TransmilenioData, instante = ahora) => {
  const respuesta = interpretCommand("de Alfa a Eco", data, { now: instante })
  assert.equal(respuesta.action, "trip", respuesta.reply)
  return /También te sirven ([^.]+)\./.exec(respuesta.reply)?.[1] ?? null
}

test("alternativas: planear-viaje trae las mismas rutas directas que la web dice con «También te sirven», en el mismo orden", () => {
  const data = datosConAlternativas()
  const v = cuerpoViaje(planear("Alfa", "Eco", data))
  assert.equal(v.resultado, "operativo")
  assert.deepEqual(v.tramos.map((t) => t.codigoRuta), ["X1"], "el mejor plan es el de menos estaciones")
  assert.deepEqual(v.alternativas, [{ codigoRuta: "V1" }, { codigoRuta: "V2" }])
  assert.equal(alternativasDeLaWeb(data), "V1 y V2")
  // La web y el contrato salen de la misma función.
  const planes = planTrip({ origin: lugarPorNombre("Alfa", data)!, destination: lugarPorNombre("Eco", data)! }, data, MAX_PLANES_VIAJE, ahora)
  assert.deepEqual(alternativasDelViaje(planes), ["V1", "V2"])
})

test("alternativas: acotadas a los planes pedidos menos el mejor, y el esquema no admite más", () => {
  assert.equal(MAX_ALTERNATIVAS, 2)
  const data = datosConAlternativas() // cuatro rutas directas: V3 no cabe
  const cuerpo = planear("Alfa", "Eco", data).cuerpo as { alternativas: { codigoRuta: string }[] }
  assert.equal(cuerpo.alternativas.length, MAX_ALTERNATIVAS)
  assert.ok(!cuerpo.alternativas.some((a) => a.codigoRuta === "V3"))
  const tres = { ...cuerpo, alternativas: [{ codigoRuta: "A" }, { codigoRuta: "B" }, { codigoRuta: "C" }] }
  assert.equal(RespuestaViajeSchema.safeParse(tres).success, false)
  assert.equal(RespuestaViajeSchema.safeParse({ ...cuerpo, alternativas: [] }).success, false, "ausente, nunca una lista vacía")
  assert.equal(RespuestaViajeSchema.safeParse({ ...cuerpo, alternativas: [{ codigoRuta: "V1", abordaje: { nombre: "Alfa" } }] }).success, false, "solo el código")
})

test("alternativas: el mejor plan no cambia por pedir más planes, y un cliente que no las conoce decodifica lo mismo que antes", () => {
  const data = datosConAlternativas()
  const [origen, destino] = [lugarPorNombre("Alfa", data)!, lugarPorNombre("Eco", data)!]
  const [soloUno] = planTrip({ origin: origen, destination: destino }, data, 1, ahora)
  const [mejor] = planTrip({ origin: origen, destination: destino }, data, MAX_PLANES_VIAJE, ahora)
  assert.deepEqual(mejor, soloUno)

  const { alternativas, ...comoAntes } = planear("Alfa", "Eco", data).cuerpo as Record<string, unknown>
  assert.ok(alternativas)
  assert.deepEqual(Object.keys(comoAntes).sort(), ["catalogo", "destino", "origen", "resultado", "rutasPorElTrazado", "tramos"])
  assert.equal(RespuestaViajeSchema.safeParse(comoAntes).success, true)
})

test("alternativas: con una sola ruta, un transbordo o un servicio candidato no hay campo, y el cuerpo es el de siempre", () => {
  const unaSola = planear("Alfa", "Eco").cuerpo as Record<string, unknown>
  assert.deepEqual(Object.keys(unaSola).sort(), ["catalogo", "destino", "origen", "resultado", "rutasPorElTrazado", "tramos"])
  assert.equal("alternativas" in unaSola, false)

  // Con un transbordo la web no ofrece otras opciones, aunque haya otros planes con transbordo.
  const base = datosTransbordoVerificado()
  const clon = (code: string, de: string) => ({ ...structuredClone(base.routes.find((r) => r.code === de)!), id: code, code })
  const conTransbordo = { ...base, routes: [...base.routes, clon("P2", "P1"), clon("Q2", "Q1")] }
  const planes = planTrip({ origin: lugarPorNombre("Alfa", conTransbordo)!, destination: lugarPorNombre("Eco", conTransbordo)! }, conTransbordo, MAX_PLANES_VIAJE, ahora)
  assert.equal(planes.length, MAX_PLANES_VIAJE, "hay otros planes que se podrían ofrecer")
  assert.ok(planes.every((plan) => plan.length === 2))
  assert.equal(cuerpoViaje(planear("Alfa", "Eco", conTransbordo)).tramos.length, 2)
  assert.equal("alternativas" in (planear("Alfa", "Eco", conTransbordo).cuerpo as object), false)
  assert.equal(alternativasDeLaWeb(conTransbordo), null)

  // Un candidato (operación sin confirmar) solo lleva el código del mejor servicio: la web tampoco da alternativas.
  const candidato = planear("Alfa", "Eco", datosConAlternativas(), madrugada).cuerpo as Record<string, unknown>
  assert.equal(candidato.resultado, "candidato")
  assert.equal("alternativas" in candidato, false)
})

test("alternativas: el cliente de iPhone decodifica por claves conocidas y no rechaza las que no conoce", () => {
  const swift = readFileSync(new URL("../ios/TransMiVoz/Dominio/RespuestaPlanificador.swift", import.meta.url), "utf8")
  // Un `Decodable` ignora las claves de más, salvo que el decodificador las enumere y las rechace.
  assert.doesNotMatch(swift, /allKeys|unknownKeys|JSONSerialization/)
  assert.match(swift, /private enum Claves: String, CodingKey/)
  const cliente = readFileSync(new URL("../ios/TransMiVoz/Red/ClientePlanificador.swift", import.meta.url), "utf8")
  assert.doesNotMatch(cliente, /allKeys|unknownKeys|JSONSerialization/)
})

// ── Metro, Línea 1 ──

const metroResuelto = () => {
  const r = resolver({ operacion: "metro-linea-1" })
  assert.equal(r.estado, 200)
  return RespuestaMetroSchema.parse(r.cuerpo)
}

test("metro-linea-1: las 16 estaciones E01–E16 con su estado, y la Línea 1 en construcción y sin servicio", () => {
  const m = metroResuelto()
  assert.equal(m.estaciones.length, 16)
  assert.deepEqual(m.estaciones.map((e) => e.id), Array.from({ length: 16 }, (_, i) => `E${String(i + 1).padStart(2, "0")}`))
  assert.deepEqual(m.estaciones.map((e) => e.numero), Array.from({ length: 16 }, (_, i) => i + 1))
  for (const [i, e] of metro.ESTACIONES_METRO_L1.entries()) {
    assert.equal(m.estaciones[i].nombre, e.nombre)
    assert.equal(m.estaciones[i].nombreMostrado, metro.nombreEstacion(e))
    assert.equal(m.estaciones[i].nombreEstado, e.nombreEstado)
    assert.equal(m.estaciones[i].corredor, e.corredor)
  }
  const e07 = m.estaciones[6]
  assert.equal(e07.nombre, null, "E07 todavía no tiene nombre público")
  assert.equal(e07.nombreMostrado, "nombre pendiente")

  assert.equal(m.linea.subtitulo, "Línea 1 · en construcción · sin servicio")
  assert.equal(m.linea.servicioComercial, false)
  assert.equal(m.linea.estado, metro.LINEA_1.estadoTexto)
  assert.match(m.linea2.titulo, /^Línea 2 · en contratación · 11 estaciones proyectadas$/)
  assert.match(m.linea2.texto, /no tengo una lista de sus estaciones/, "la Línea 2 no trae estaciones ni geometría")
  assert.equal(m.corte.hablada, metro.METRO_CORTE_HABLADO)
})

test("metro-linea-1: huellas y trazado son los de la cartografía verificada, en {lat, lng}, sin invertir ejes", () => {
  const m = metroResuelto()
  const { CARTOGRAFIA_METRO } = cartografia
  assert.deepEqual(m.mapa.trazado, CARTOGRAFIA_METRO.trazado.map(([lon, lat]) => ({ lat, lng: lon })))
  assert.equal(m.mapa.trazado.length, 157, "el trazado simplificado, no los 8.494 vértices de la fuente")
  for (const [i, { id, huella }] of CARTOGRAFIA_METRO.huellas.entries()) {
    assert.equal(m.estaciones[i].id, id)
    assert.deepEqual(m.estaciones[i].huella, huella.map(([lon, lat]) => ({ lat, lng: lon })), id)
    assert.deepEqual(m.estaciones[i].huella[0], m.estaciones[i].huella.at(-1), `${id}: anillo cerrado`)
  }
  for (const p of [...m.mapa.trazado, ...m.estaciones.flatMap((e) => e.huella)]) {
    assert.ok(p.lat > 4.4 && p.lat < 4.9 && p.lng < -73.9 && p.lng > -74.3, `lat/lng de Bogotá: ${p.lat}, ${p.lng}`)
  }
})

test("metro-linea-1 (EA-24): una huella no es una entrada: sin punto por estación, sin accesos y sin ruteo", () => {
  const m = metroResuelto()
  for (const e of m.estaciones) {
    assert.deepEqual(
      Object.keys(e).sort(),
      ["avisoUbicacion", "conexion", "corredor", "descripcionNombre", "enElMapa", "etiquetaHuella", "fuentes", "huella", "id", "nombre", "nombreEstado", "nombreMostrado", "nombreTecnico", "numero"],
    )
    // La única geometría de una estación es su huella (polígono): ningún centroide ni punto aparte.
    const { huella, ...resto } = e
    assert.ok(huella.length >= 4)
    assert.doesNotMatch(JSON.stringify(resto), /"(?:lat|lng|coordenada|centroide|punto|acceso|accesos|entrada|entradas)"/i)
    assert.match(e.etiquetaHuella, /huella ilustrativa del proyecto; no es una entrada$/)
    assert.equal(e.enElMapa, "En el mapa: huella ilustrativa del proyecto; no es una entrada.")
    assert.match(e.avisoUbicacion, /No tengo ubicación exacta ni accesos validados/)
    assert.match(e.conexion, /Hoy no hay transbordos habilitados\.$/)
  }
  const todo = JSON.stringify(m)
  assert.doesNotMatch(todo, /"(?:centroide|habilitadaParaRuteo|contraparteTm|accesos?|entradas?)"/i)
  assert.doesNotMatch(m.mapa.aviso, /accesos publicados/)
  assert.match(m.mapa.aviso, /Una huella no es una entrada ni indica transbordos/)
})

test("metro-linea-1 (EA-24): rótulo, aviso y atribución con licencia, fecha y cambios viajan con el mapa", () => {
  const { mapa } = metroResuelto()
  assert.equal(mapa.rotulo, cartografia.ROTULO_MAPA_METRO)
  assert.match(mapa.rotulo, /proyecto futuro, sin servicio/)
  assert.equal(mapa.atribucion, cartografia.ATRIBUCION_MAPA_METRO)
  assert.equal(mapa.atribucionCorta, cartografia.ATRIBUCION_MAPA_METRO_CORTA)
  for (const dato of ["Empresa Metro de Bogotá", "CC BY 4.0", "18-04-2022", "12-11-2026", "simplificado"]) assert.ok(mapa.atribucion.includes(dato), `${dato} en «${mapa.atribucion}»`)
  assert.equal(mapa.licencia, "CC BY 4.0")
  assert.equal(mapa.fechaDato, "2022-04-18")
  assert.equal(mapa.consultado, cartografia.PROCEDENCIA_MAPA_METRO.consultado)
  assert.equal(mapa.licenciaUrl, "https://creativecommons.org/licenses/by/4.0/")
  assert.deepEqual(mapa.cambios, cartografia.PROCEDENCIA_MAPA_METRO.cambios)
  assert.equal(metroResuelto().atribucion, metro.ATRIBUCION_METRO)
  assert.deepEqual(metroResuelto().fuentes.map((f) => f.url), Object.values(metro.FUENTES_METRO).map((f) => f.url))
})

/** Lo que `MetroList` dibuja, con los mismos dobles que las pruebas de EA-13 y EA-24. */
function pantallaMetro() {
  const { MetroList } = compilar("components/metro-list.tsx", {
    "@/lib/metro": metro,
    "@/lib/metro-cartografia": cartografia,
    react: { useEffect: (f: () => void) => void f() },
    "@/hooks/use-speech": { useSpeech: () => ({ speak() {}, cancel() {} }), esUltimaLocucion: () => false },
  })
  return MetroList({ onBack() {} })
}

test("metro-linea-1 dice lo mismo que la pantalla del Metro de la web: encabezado, nota, atribución, estaciones, Línea 2 y fuentes", () => {
  const m = metroResuelto()
  const arbol = pantallaMetro()

  const [encabezado] = nodos(arbol, (n) => n.props?.subtitle !== undefined)
  assert.equal(encabezado.props.subtitle, m.linea.subtitulo)
  const [nota] = nodos(arbol, (n) => n.props?.role === "note")
  assert.equal(texto(nota), m.textoEstado)
  const [mapaWeb] = nodos(arbol, (n) => n.props?.overlay !== undefined)
  const capa = mapaWeb.props.overlay as { label: string; attribution: string; polygons: { label: string }[] }
  assert.equal(capa.label, m.mapa.rotulo)
  assert.equal(capa.attribution, m.mapa.atribucionCorta)
  assert.deepEqual(capa.polygons.map((p) => p.label), m.estaciones.map((e) => e.etiquetaHuella))
  const visible = texto(arbol)
  assert.ok(visible.includes(m.mapa.atribucion), "la atribución completa va bajo el mapa")
  assert.ok(visible.includes(m.atribucion))

  const fichas = nodos(arbol, (n) => n.type === "details")
  assert.equal(fichas.length, 17, "16 estaciones y la Línea 2")
  for (const [i, e] of m.estaciones.entries()) {
    const ficha = texto(fichas[i])
    assert.ok(ficha.includes(`${e.id} · ${e.nombreMostrado}`), e.id)
    assert.ok(ficha.includes(e.corredor), e.id)
    for (const parrafo of [e.descripcionNombre, e.nombreTecnico, e.conexion, e.avisoUbicacion, e.enElMapa, `Fuentes: ${e.fuentes.join(", ")}`]) {
      assert.ok(ficha.includes(parrafo), `${e.id}: «${parrafo}»`)
    }
  }
  assert.ok(texto(fichas[16]).includes(m.linea2.titulo) && texto(fichas[16]).includes(m.linea2.texto))
  for (const f of m.fuentes) assert.ok(visible.includes(f.texto), f.id)
})

test("metro-linea-1: el esquema es estricto y acotado: ningún punto por estación, ni servicio comercial, ni una estación de menos", () => {
  const m = metroResuelto()
  const clon = () => structuredClone(m) as Record<string, any>
  const con = (cambio: (c: Record<string, any>) => void) => {
    const c = clon()
    cambio(c)
    return RespuestaMetroSchema.safeParse(c).success
  }
  assert.equal(con(() => {}), true)
  assert.equal(con((c) => (c.estaciones[0].centroide = { lat: 4.6, lng: -74.1 })), false, "un centroide no pasa")
  assert.equal(con((c) => (c.estaciones[0].lat = 4.6)), false)
  assert.equal(con((c) => (c.estaciones[0].accesos = [])), false)
  assert.equal(con((c) => (c.linea.servicioComercial = true)), false)
  assert.equal(con((c) => c.estaciones.pop()), false, "15 estaciones")
  assert.equal(con((c) => (c.estaciones[0].huella = c.estaciones[0].huella.slice(0, 3))), false, "una huella es un anillo")
  assert.equal(con((c) => (c.estaciones[0].huella[0].lat = 91)), false)
  assert.equal(con((c) => (c.mapa.trazado = Array.from({ length: MAX_PUNTOS_TRAZADO_METRO + 1 }, () => ({ lat: 4.6, lng: -74.1 })))), false)
  assert.equal(con((c) => (c.estaciones[0].huella = Array.from({ length: MAX_PUNTOS_HUELLA + 1 }, () => ({ lat: 4.6, lng: -74.1 })))), false)
  assert.equal(con((c) => (c.textoEstado = "x".repeat(MAX_TEXTO_METRO + 1))), false)
  assert.equal(con((c) => (c.mapa.fechaDato = "18/04/2022")), false)
  // El dato real cabe holgado en sus cotas.
  assert.ok(m.mapa.trazado.length < MAX_PUNTOS_TRAZADO_METRO / 2)
  assert.ok(Math.max(...m.estaciones.map((e) => e.huella.length)) < MAX_PUNTOS_HUELLA)
  const textos = JSON.stringify(m).match(/"[^"]{300,}"/g) ?? []
  for (const t of textos) assert.ok(t.length - 2 <= MAX_TEXTO_METRO)
})

test("metro-linea-1 no depende de la hora ni del catálogo de TransMilenio, y planear no lo importa", () => {
  assert.deepEqual(resolver({ operacion: "metro-linea-1" }, copia, ahora), resolver({ operacion: "metro-linea-1" }, datosVerificadosDirecto(), new Date("2028-06-01T10:00:00-05:00")))
  assert.equal(resolver({ operacion: "metro-linea-1" }).cuerpo, RESPUESTA_METRO)
  // Las estaciones cercanas son las de TransMilenio: ninguna del Metro (EA-13).
  const cercanasAlMetro = cercanas({ lat: 4.6124, lng: -74.0935 }, copia)
  assert.ok(cercanasAlMetro.estaciones.length > 0 && cercanasAlMetro.estaciones.every((e) => !/metro/i.test(e.nombre)))
})

// ── Estaciones cercanas ──

/** Red sintética A–E: de sur a norte, a unos 2,2 km una de otra. Alfa 4,60; Bravo 4,62; Charlie 4,64; Delta 4,66; Eco 4,68. */
const red = datosVerificadosDirecto()
const [alfa, bravo] = ESTACIONES_SINTETICAS
/** Entre Alfa y Bravo, más cerca de Bravo (unos 1.000 m) que de Alfa (unos 1.220 m), en su misma longitud. */
const persona = { lat: 4.611, lng: -74.08 }
const distanciaA = (estacion: { lat: number; lng: number }) => distanceMeters(persona, estacion)
// Lo esperado de la dirección se calcula con `geo.ts`, no con la función del contrato.
const hacia = (estacion: { lat: number; lng: number }) => bearingDegrees(persona, estacion)
const cercanas = (peticion: Record<string, unknown>, data: TransmilenioData = red, instante = ahora) => {
  const r = resolver({ operacion: "estaciones-cercanas", ...peticion } as PeticionPlanificador, data, instante)
  assert.equal(r.estado, 200)
  return RespuestaEstacionesCercanasSchema.parse(r.cuerpo)
}
const soloCercanas = (r: ReturnType<typeof cercanas>) => {
  assert.equal(r.resultado, "cercanas")
  return r.estaciones
}

test("estaciones-cercanas: las mismas estaciones, orden y distancias que la web (nearestStations), acotadas a 4", () => {
  // Entre Alfa y Bravo, más cerca de Bravo.
  const estaciones = soloCercanas(cercanas(persona))
  const esperadas = nearestStations(persona, red, MAX_ESTACIONES_CERCANAS)
  assert.equal(MAX_ESTACIONES_CERCANAS, 4)
  assert.equal(red.stations.length, 5, "hay cinco estaciones y se devuelven cuatro")
  assert.deepEqual(estaciones.map((e) => e.nombre), esperadas.map((e) => e.name))
  assert.deepEqual(estaciones.map((e) => e.nombre), ["Bravo", "Alfa", "Charlie", "Delta"])
  for (const [i, e] of estaciones.entries()) {
    assert.equal(e.distanciaMetros, Math.round(esperadas[i].distance))
    assert.equal(e.distanciaHablada, spokenDistance(esperadas[i].distance))
    assert.deepEqual(e.coordenada, { lat: esperadas[i].lat, lng: esperadas[i].lng })
  }
  assert.deepEqual([...estaciones].sort((a, b) => a.distanciaMetros - b.distanciaMetros), estaciones, "de más cerca a más lejos")
})

test("estaciones-cercanas: cada estación de la copia guardada como posición devuelve una respuesta que cumple el esquema", () => {
  for (const estacion of copia.stations) {
    const estaciones = soloCercanas(cercanas({ lat: estacion.lat, lng: estacion.lng, precision: 15 }, copia))
    assert.equal(estaciones.length, MAX_ESTACIONES_CERCANAS, estacion.name)
    assert.equal(estaciones[0].distanciaMetros, 0, `parado en ${estacion.name}, la más cercana está a 0 m`)
  }
})

test("estaciones-cercanas sin estaciones en el catálogo: lista vacía, como la web", () => {
  assert.deepEqual(cercanas(persona, { ...red, stations: [] }), { resultado: "cercanas", estaciones: [], catalogo: cercanas(persona).catalogo })
})

test("estaciones-cercanas sin precisión: solo referencia cardinal estimada, nunca un giro", () => {
  const [primera, segunda] = soloCercanas(cercanas(persona))
  assert.equal(primera.nombre, "Bravo")
  assert.equal(primera.orientacion.modo, "cardinal-precision")
  assert.equal(primera.orientacion.cardinal, cardinal(hacia(bravo)))
  assert.equal(primera.orientacion.cardinal, "al norte")
  assert.equal(primera.orientacion.relativa, null)
  assert.equal(
    primera.orientacion.indicacion,
    `Bravo está a ${spokenDistance(distanciaA(bravo))} al norte (orientación aproximada respecto al norte; tu ubicación es imprecisa o sin precisión conocida, así que no te doy un giro).`,
  )
  assert.equal(segunda.nombre, "Alfa")
  assert.equal(segunda.orientacion.cardinal, "al sur")
  // Con rumbo pero sin precisión tampoco hay giro.
  const conRumbo = soloCercanas(cercanas({ ...persona, rumbo: { grados: 90, calidad: 5, edadMs: 100 } }))
  assert.equal(conRumbo[0].orientacion.modo, "cardinal-precision")
})

test("estaciones-cercanas con buena precisión pero sin brújula fiable: cardinal, con su límite", () => {
  const sinBrujula = [
    {},
    { rumbo: { grados: 90, edadMs: 100 } }, // sin calidad conocida
    { rumbo: { grados: 90, calidad: -1, edadMs: 100 } }, // calibración desconocida
    { rumbo: { grados: 90, calidad: 40, edadMs: 100 } }, // calidad insuficiente (más de 25°)
    { rumbo: { grados: 90, calidad: 10, edadMs: 2_001 } }, // medido hace más de 2 s
  ]
  for (const extra of sinBrujula) {
    const [primera] = soloCercanas(cercanas({ ...persona, precision: 10, ...extra }))
    assert.equal(primera.orientacion.modo, "cardinal-brujula", JSON.stringify(extra))
    assert.equal(primera.orientacion.relativa, null)
    assert.equal(primera.orientacion.cardinal, "al norte")
    assert.equal(
      primera.orientacion.indicacion,
      `Bravo está a ${spokenDistance(distanciaA(bravo))} al norte (orientación aproximada respecto al norte; sin brújula fiable no sé hacia dónde miras).`,
    )
  }
})

test("estaciones-cercanas con buena precisión y rumbo fiable: el giro relativo, como la web", () => {
  // Mirando al este (90°): Bravo, al norte, queda a la izquierda; Alfa, al sur, a la derecha.
  const estaciones = soloCercanas(cercanas({ ...persona, precision: 10, rumbo: { grados: 90, calidad: 10, edadMs: 2_000 } }))
  const [primera, segunda] = estaciones
  assert.equal(primera.orientacion.modo, "relativa")
  assert.equal(primera.orientacion.relativa, relativeDirection(90, hacia(bravo)))
  assert.equal(primera.orientacion.relativa, "a tu izquierda")
  assert.equal(primera.orientacion.indicacion, `Bravo está a ${spokenDistance(distanciaA(bravo))} a tu izquierda.`)
  assert.equal(segunda.orientacion.relativa, relativeDirection(90, hacia(alfa)))
  assert.equal(segunda.orientacion.relativa, "a tu derecha")
  // La lista conserva la referencia cardinal aunque haya giro.
  assert.equal(primera.orientacion.cardinal, "al norte")
  // De frente cuando mira al norte.
  assert.equal(soloCercanas(cercanas({ ...persona, precision: 10, rumbo: { grados: 0, calidad: 10, edadMs: 0 } }))[0].orientacion.relativa, "de frente")
})

test("estaciones-cercanas con la estación dentro del margen de error: sin dirección alguna", () => {
  // Parado sobre Alfa con 200 m de precisión: Alfa cae dentro del margen y las demás no.
  const estaciones = soloCercanas(cercanas({ lat: alfa.lat, lng: alfa.lng, precision: 200, rumbo: { grados: 90, calidad: 5, edadMs: 0 } }))
  const [primera, ...resto] = estaciones
  assert.equal(primera.nombre, "Alfa")
  assert.equal(primera.distanciaMetros, 0)
  assert.equal(primera.orientacion.modo, "sin-direccion")
  assert.equal(primera.orientacion.cardinal, null)
  assert.equal(primera.orientacion.relativa, null)
  assert.equal(
    primera.orientacion.indicacion,
    "Alfa está a 0 metros según tu ubicación estimada, pero esa ubicación tiene un margen de error de unos 200 metros, así que no puedo decirte hacia dónde queda. Espera una lectura más precisa o acércate.",
  )
  // Con 200 m de precisión (más de 50 m) las demás solo dan cardinal, nunca un giro.
  assert.ok(resto.every((e) => e.orientacion.modo === "cardinal-precision" && e.orientacion.cardinal === "al norte"))
})

test("estaciones-cercanas con la lectura vencida: ubicacion-vencida, sin estaciones, como la web", () => {
  assert.equal(EDAD_MAXIMA_POSICION_MS, 60_000)
  const vigente = cercanas({ ...persona, edadMs: EDAD_MAXIMA_POSICION_MS })
  assert.equal(vigente.resultado, "cercanas", "justo en el límite todavía vale")
  const vencida = cercanas({ ...persona, edadMs: EDAD_MAXIMA_POSICION_MS + 1 })
  assert.deepEqual(vencida, { resultado: "ubicacion-vencida", estaciones: [], catalogo: vigente.catalogo })
  assert.equal(cercanas(persona).resultado, "cercanas", "sin edad, recién capturada")
})

test("estaciones-cercanas (privacidad): la respuesta no devuelve la coordenada, la precisión ni el rumbo recibidos", () => {
  const peticion = { lat: 4.123456789, lng: -74.987654321, precision: 37.123, edadMs: 4_321, rumbo: { grados: 123.456, calidad: 7.89, edadMs: 987 } }
  const r = cercanas(peticion)
  assert.deepEqual(Object.keys(r).sort(), ["catalogo", "estaciones", "resultado"])
  const salida = JSON.stringify(r)
  for (const dato of ["4.123456789", "-74.987654321", "37.123", "123.456", "7.89"]) assert.equal(salida.includes(dato), false, `la respuesta repite «${dato}»`)
  // Las cifras de las estaciones son las del catálogo: ninguna lleva la coordenada de la persona.
  assert.equal(r.resultado === "cercanas" && r.estaciones.every((e) => e.coordenada.lat !== peticion.lat), true)
})

// ── Endpoint ──

const raiz = pathToFileURL(process.cwd() + "/")
let contador = 0

/** Instancia fresca del endpoint con la red externa caída y las llamadas a `fetch` y a `console` anotadas. */
async function conEndpoint() {
  const fetchSimulado = mock.method(globalThis, "fetch", async () => {
    throw new Error("sin red (prueba EA-25): usa la copia")
  })
  const escrito: string[] = []
  const consolas = (["log", "info", "warn", "error", "debug"] as const).map((nivel) =>
    mock.method(console, nivel, (...args: unknown[]) => void escrito.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "))),
  )
  const modulo: typeof import("../app/api/planificador/route") = await import(
    new URL(`app/api/planificador/route.ts?caso=${contador++}`, raiz).href
  )
  return {
    POST: modulo.POST,
    escrito,
    llamadasAFetch: () => fetchSimulado.mock.calls.map((c) => JSON.stringify(c.arguments)).join("\n"),
    restaurar: () => {
      fetchSimulado.mock.restore()
      for (const c of consolas) c.mock.restore()
    },
  }
}

const enviar = (cuerpo: unknown) =>
  new Request("http://local/api/planificador", { method: "POST", body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo) })

test("endpoint: metro-linea-1 responde 200 con el contrato, sin cargar el catálogo de TransMilenio", async () => {
  const e = await conEndpoint()
  try {
    const respuesta = await e.POST(enviar({ operacion: "metro-linea-1" }))
    assert.equal(respuesta.status, 200)
    assert.deepEqual(await respuesta.json(), JSON.parse(JSON.stringify(RESPUESTA_METRO)))
    assert.equal(e.llamadasAFetch(), "", "no consultó el catálogo de TransMilenio")
  } finally {
    e.restaurar()
  }
})

test("endpoint: estaciones-cercanas responde 200 con el contrato", async () => {
  const e = await conEndpoint()
  try {
    const respuesta = await e.POST(enviar({ ...cerca, lat: 4.6124, lng: -74.0935, precision: 12 }))
    assert.equal(respuesta.status, 200)
    const cuerpo = RespuestaEstacionesCercanasSchema.parse(await respuesta.json())
    assert.equal(cuerpo.resultado, "cercanas")
    assert.equal(cuerpo.resultado === "cercanas" && cuerpo.estaciones.length, MAX_ESTACIONES_CERCANAS)
  } finally {
    e.restaurar()
  }
})

test("endpoint: una petición inválida de las nuevas operaciones responde 400 sin repetir lo recibido", async () => {
  const e = await conEndpoint()
  try {
    const malas = [
      { operacion: "estaciones-cercanas", lat: 91.123456, lng: -74.5 },
      { operacion: "estaciones-cercanas", lat: 4.5 },
      { operacion: "estaciones-cercanas", lat: "4.5", lng: -74.5 },
      { operacion: "estaciones-cercanas", lat: 4.5, lng: -74.5, rumbo: { grados: 400, edadMs: 0 } },
      { operacion: "estaciones-cercanas", lat: 4.5, lng: -74.5, nombre: "Ricaurte" },
      { operacion: "metro-linea-1", extra: true },
    ]
    for (const mala of malas) {
      const respuesta = await e.POST(enviar(mala))
      assert.equal(respuesta.status, 400, JSON.stringify(mala))
      assert.deepEqual(await respuesta.json(), { error: "peticion-invalida" })
    }
    assert.equal((await e.POST(enviar("{"))).status, 400)
    assert.equal((await e.POST(enviar({ operacion: "estaciones-cercanas", lat: 4.5, lng: -74.5, relleno: "x".repeat(MAXIMO_BYTES_CUERPO) }))).status, 413)
  } finally {
    e.restaurar()
  }
})

test("endpoint (privacidad): la coordenada no sale por fetch ni por ningún registro, y el código no escribe registros", async () => {
  const e = await conEndpoint()
  try {
    const peticion = { operacion: "estaciones-cercanas", lat: 4.123456789, lng: -74.987654321, precision: 37.123, rumbo: { grados: 123.456, calidad: 7.89, edadMs: 987 } }
    assert.equal((await e.POST(enviar(peticion))).status, 200)
    assert.equal((await e.POST(enviar({ ...peticion, lat: 95.123456789 }))).status, 400)
    const visto = `${e.escrito.join("\n")}\n${e.llamadasAFetch()}`
    for (const dato of ["4.123456789", "-74.987654321", "37.123", "123.456", "95.123456789"]) assert.equal(visto.includes(dato), false, `«${dato}» salió del manejador`)
  } finally {
    e.restaurar()
  }
  for (const archivo of ["../app/api/planificador/route.ts", "./contrato-planificador.ts", "./contrato-metro.ts", "./ubicacion.ts"]) {
    assert.doesNotMatch(readFileSync(new URL(archivo, import.meta.url), "utf8"), /console\./, `${archivo} no escribe registros`)
  }
})

test("endpoint: metro-linea-1 y estaciones-cercanas comparten el cubo de las consultas baratas y no tocan el de planear", async () => {
  const e = await conEndpoint()
  try {
    for (let i = 0; i < LIMITE_CONSULTA; i++) {
      const cuerpo = i % 2 === 0 ? { operacion: "metro-linea-1" } : { ...cerca, lat: 4.6124, lng: -74.0935 }
      assert.equal((await e.POST(enviar(cuerpo))).status, 200, `petición ${i + 1}`)
    }
    for (const cuerpo of [{ operacion: "metro-linea-1" }, { ...cerca, lat: 4.6124, lng: -74.0935 }, { operacion: "buscar-rutas", consulta: "B23" }]) {
      const rechazada = await e.POST(enviar(cuerpo))
      assert.equal(rechazada.status, 429, JSON.stringify(cuerpo))
      assert.ok(Number(rechazada.headers.get("Retry-After")) >= 1)
      assert.deepEqual(await rechazada.json(), { error: "demasiadas-peticiones" })
    }
    // Planear tiene su propio cubo, intacto.
    const [origen, destino] = listarLugares(copia)
    assert.equal((await e.POST(enviar({ operacion: "planear-viaje", origen: origen.name, destino: destino.name }))).status, 200)
  } finally {
    e.restaurar()
  }
})
