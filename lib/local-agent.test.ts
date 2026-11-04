import assert from "node:assert/strict"
import test from "node:test"
import snapshot from "../data/transmilenio.json" with { type: "json" }
import { datosExpreso, datosTransbordoVerificado, datosVerificadosDirecto } from "./fixtures-sinteticas"
import { interpretCommand, parseIntent, plainReply, respuestaPrescriptivaValida, runIntent } from "./local-agent"
import { TransmilenioDataSchema } from "./transmilenio"

const data = TransmilenioDataSchema.parse(snapshot)

test("entiende frases habituales", () => {
  const cases: [string, string][] = [
    ["hola, buenos días", "greeting"],
    ["¿qué puedes hacer?", "help"],
    ["cancela", "cancel"],
    ["mis rutas de siempre", "frequent"],
    ["¿dónde estoy?", "gps"],
    ["información de la ruta B23", "route_info"],
    ["¿a qué hora pasa la H54?", "schedule"],
    ["¿cuánto cuesta el pasaje?", "unsupported"],
    ["quiero ir a Ricaurte", "trip"],
    ["cómo llego de Ricaurte a Calle 72", "trip"],
    ["blablá", "unknown"],
  ]
  for (const [phrase, expected] of cases) {
    assert.equal(parseIntent(phrase, data).type, expected, phrase)
  }
})

test("un saludo no se confunde con una búsqueda fallida", () => {
  const reply = interpretCommand("hola, buenos días", data)
  assert.equal(reply.action, "none")
  assert.match(reply.reply, /^¡Hola!/)
})

test("toma origen y destino en el orden en que se dicen", () => {
  assert.deepEqual(parseIntent("de Ricaurte a Calle 72", data), {
    type: "trip",
    origin: "Ricaurte",
    destination: "Calle 72",
  })
})

const NOW = new Date("2026-11-04T10:00:00-05:00")
const resolver = (text: string, d = data, ctx = {}) => runIntent(parseIntent(text, d), { data: d, context: { now: NOW, ...ctx } })

test("con paradas verificadas y en franja, planea un viaje directo y deja los pasos", () => {
  const fx = datosVerificadosDirecto()
  const reply = resolver("cómo llego de Alfa a Eco", fx)
  assert.ok(reply.action === "trip")
  assert.equal(reply.trip.length, 1)
  assert.match(reply.reply, /^Toma la V1 en Alfa y bájate en Eco, después de 4 estaciones\./)
  assert.match(reply.reply, /ahora hay servicio programado; no es tiempo real/)
  assert.ok(reply.steps.length >= 3, "debe registrar los pasos")
  assert.equal(respuestaPrescriptivaValida(reply, fx, NOW), true)
})

test("sin conteo garantizado por la fuente no dice cuántas estaciones son", () => {
  const fx = datosVerificadosDirecto()
  fx.routes[0].servedStops.forEach((s) => (s.conteoExacto = false))
  const reply = resolver("cómo llego de Alfa a Eco", fx)
  assert.ok(reply.action === "trip")
  assert.equal(reply.trip[0].conteoVerificado, false)
  assert.match(reply.reply, /^Toma la V1 en Alfa y bájate en Eco\./)
  assert.doesNotMatch(reply.reply, /estaciones|estación/)
})

test("8 G a las 10:00 da la indicación con el conteo garantizado y 8 T sin conteo", () => {
  const g = resolver("cómo llego de Terminal a Guatoque")
  assert.ok(g.action === "trip")
  assert.match(g.reply, /^Toma la 8 G en Terminal y bájate en Guatoque - Veraguas, después de 26 estaciones\./)
  const t = resolver("cómo llego de Guatoque a Terminal")
  assert.ok(t.action === "trip")
  assert.match(t.reply, /^Toma la 8 T en Guatoque - Veraguas y bájate en Terminal\./)
  assert.doesNotMatch(t.reply, /\d+ estaciones/)
})

test("fuera de franja presenta un candidato sin indicaciones de abordaje", () => {
  // 2026-11-04 02:00 en Bogotá: la primera salida de Terminal es a las 04:30.
  const reply = resolver("cómo llego de Terminal a Guatoque", data, { now: new Date("2026-11-04T02:00:00-05:00") })
  assert.equal(reply.action, "search", "no abre un plan de viaje")
  assert.match(reply.reply, /8 G conecta Terminal con Guatoque/)
  assert.match(reply.reply, /no puedo confirmar que esté en servicio/)
  assert.doesNotMatch(reply.reply, /Toma|bájate|sube|hoy opera|tiene servicio programado/i)
})

test("con la evidencia vencida o el calendario fuera de vigencia se abstiene sin afirmar que no hay servicio", () => {
  const reply = resolver("cómo llego de Terminal a Guatoque", data, { now: new Date("2027-01-05T10:00:00-05:00") })
  assert.notEqual(reply.action, "trip")
  assert.match(reply.reply, /no puedo decirte con certeza dónde subir o bajar/)
  assert.doesNotMatch(reply.reply, /Toma|bájate|no hay servicio|no opera/i)
})

test("sin sentido confirmado no hay viaje aunque las paradas existan", () => {
  const fx = datosVerificadosDirecto()
  fx.routes[0].directionEvidence = { agreement: "contradictorio", verified: false, note: "x" }
  const reply = resolver("cómo llego de Alfa a Eco", fx)
  assert.notEqual(reply.action, "trip")
  assert.doesNotMatch(reply.reply, /Toma|bájate/)
})

test("respuestaPrescriptivaValida revalida una respuesta de viaje antes de hablarla", () => {
  const fx = datosVerificadosDirecto()
  const reply = resolver("cómo llego de Alfa a Eco", fx)
  assert.ok(reply.action === "trip")
  assert.equal(respuestaPrescriptivaValida(reply, fx, NOW), true)
  // Un viaje inventado, de otra acción o ya fuera de franja no pasa.
  const falso = { ...reply, trip: [{ routeCode: "V1", board: "Alfa", alight: "Narnia", stationsRidden: 1, conteoVerificado: false }] }
  assert.equal(respuestaPrescriptivaValida(falso, fx, NOW), false)
  assert.equal(respuestaPrescriptivaValida(reply, fx, new Date("2026-11-04T03:00:00-05:00")), false)
  assert.equal(respuestaPrescriptivaValida(plainReply("hola"), fx, NOW), true, "una respuesta sin viaje no prescribe abordaje")
})

test("el horario de la 8 G usa el calendario real: opera, no opera o sin verificar", () => {
  const en = (iso: string) => resolver("¿a qué hora pasa la 8 G?", data, { now: new Date(iso) })
  assert.match(en("2026-11-07T10:00:00-05:00").reply, /hoy tiene servicio programado; no es tiempo real/)
  assert.match(en("2027-01-05T10:00:00-05:00").reply, /No tengo un calendario vigente verificado/)
  assert.doesNotMatch(en("2027-01-05T10:00:00-05:00").reply, /no tiene servicio programado/, "vencido no es «sin servicio»")
})

test("un transbordo verificado sí abre un plan de dos tramos", () => {
  const fx = datosTransbordoVerificado()
  const reply = resolver("cómo llego de Alfa a Eco", fx)
  assert.ok(reply.action === "trip")
  assert.equal(reply.trip.length, 2)
  assert.equal(reply.trip[0].alight, reply.trip[1].board)
  assert.equal(respuestaPrescriptivaValida(reply, fx, NOW), true)
})

test("el horario de una ruta sin calendario no se afirma como operación", () => {
  const route = data.routes.find((r) => r.code === "H54")!
  const reply = resolver("¿a qué hora pasa la H54?")
  assert.equal(reply.action, "route")
  assert.match(reply.reply, /Horario publicado/)
  assert.match(reply.reply, /no un calendario verificado/)
  assert.ok(reply.reply.includes(route.schedule.weekday))
  // No debe afirmar categóricamente que "opera".
  assert.doesNotMatch(reply.reply, /^La H54 opera/)
})

test("con datos reales sin paradas verificadas, no instruye abordar y ofrece recorrido", () => {
  const reply = interpretCommand("cómo llego de Portal Usme a Molinos", data)
  // No debe abrir un plan de viaje (subir/bajar) con datos solo geométricos.
  assert.notEqual(reply.action, "trip")
  assert.match(reply.reply, /no puedo decirte con certeza dónde subir o bajar/)
  // No afirma que no exista servicio.
  assert.doesNotMatch(reply.reply, /ninguna ruta/i)
})

test("un expreso no recomienda abordar donde solo pasa, pero ofrece el recorrido", () => {
  const fx = datosExpreso()
  const reply = interpretCommand("cómo llego de Bravo a Delta", fx, { now: NOW })
  assert.notEqual(reply.action, "trip", "Bravo y Delta no son paradas del expreso")
  assert.match(reply.reply, /dónde subir o bajar/)
})

test("sin origen ni ubicación, informa el recorrido del destino con incertidumbre", () => {
  const reply = interpretCommand("quiero ir a Ricaurte", data)
  assert.ok(reply.action === "search")
  assert.equal(reply.station, "Ricaurte")
  assert.match(reply.reply, /recorrido de .* pasan? por Ricaurte/)
  assert.match(reply.reply, /No tengo confirmado dónde para/)
})

test("con ubicación y sin paradas verificadas, no inventa un abordaje", () => {
  // Frente a la estación Portal Usme, pero el catálogo real no tiene paradas verificadas.
  const position = { lat: data.stations.find((s) => s.name === "Portal Usme")!.lat, lng: data.stations.find((s) => s.name === "Portal Usme")!.lng }
  const reply = interpretCommand("llévame a Molinos", data, { position })
  assert.notEqual(reply.action, "trip")
  assert.ok(reply.steps.some((s) => s.label === "Usé tu ubicación"))
  assert.match(reply.reply, /dónde subir o bajar/)
})

test("responde el horario real de una ruta", () => {
  const route = data.routes.find((r) => r.code === "H54")!
  const reply = interpretCommand("¿a qué hora pasa la H54?", data)
  assert.equal(reply.action, "route")
  assert.ok(reply.reply.includes(route.schedule.weekday))
})

test("no inventa estaciones", () => {
  const reply = interpretCommand("quiero ir a Narnia", data)
  assert.equal(reply.action, "none")
})

test("el origen es la estación que sigue a «desde», aunque se diga al final", () => {
  assert.deepEqual(parseIntent("necesito llegar a la Universidad Nacional saliendo desde Ricaurte", data), {
    type: "trip",
    origin: "Ricaurte",
    destination: "Universidad Nacional",
  })
  assert.deepEqual(parseIntent("voy para Calle 72 desde Ricaurte", data), {
    type: "trip",
    origin: "Ricaurte",
    destination: "Calle 72",
  })
})

test("si solo dice de dónde sale, pregunta a dónde va", () => {
  const reply = interpretCommand("salgo desde Ricaurte", data)
  assert.equal(reply.action, "none")
  assert.match(reply.reply, /sales de Ricaurte/)
})

test("«la estación de X» no convierte a X en el origen", () => {
  assert.deepEqual(parseIntent("quiero ir a la estación de Ricaurte", data), { type: "trip", destination: "Ricaurte" })
  assert.equal(parseIntent("llévame al portal de Suba", data).type, "trip")
})

test("«desde» gana aunque el destino se diga primero con «de»", () => {
  assert.deepEqual(parseIntent("cómo llego a la estación de Calle 72 desde Ricaurte", data), {
    type: "trip",
    origin: "Ricaurte",
    destination: "Calle 72",
  })
})

test("con la ubicación en el destino, dice que ya llegó en vez de dar una vuelta", () => {
  const ricaurte = data.stations.find((s) => s.name === "Ricaurte - CL 13")!
  const reply = interpretCommand("quiero ir a Ricaurte", data, { position: { lat: ricaurte.lat, lng: ricaurte.lng } })
  assert.equal(reply.action, "none")
  assert.match(reply.reply, /^Ya estás en Ricaurte/)
})
