import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import test from "node:test"
import snapshot from "../data/transmilenio.json" with { type: "json" }
import { findPlaces, nearestStations, planTrip } from "./routes"
import {
  AgentReplySchema,
  contieneImperativoDeViaje,
  interpretCommand,
  parseIntent,
  respuestaSinImperativos,
  runIntent,
  type AgentReply,
} from "./local-agent"
import { intencionUsaUbicacion, requiereModelo } from "./seleccion-interprete"
import { ESTACIONES_METRO_L1, FUENTES_METRO, LINEA_1, LINEA_2, TEXTO_HOMONIMO, interpretarMetro } from "./metro"
import { TransmilenioDataSchema } from "./transmilenio"

const data = TransmilenioDataSchema.parse(snapshot)
const responder = (frase: string, now = new Date("2026-11-07T10:00:00-05:00")): AgentReply =>
  interpretCommand(frase, data, { now })
const estacion = (id: string) => ESTACIONES_METRO_L1.find((e) => e.idOficial === id)!

// --- Catálogo -------------------------------------------------------------

test("16 estaciones con claves únicas por sistema y línea, e identificadores oficiales E01–E16", () => {
  assert.equal(ESTACIONES_METRO_L1.length, 16)
  assert.equal(new Set(ESTACIONES_METRO_L1.map((e) => e.clave)).size, 16)
  assert.deepEqual(
    ESTACIONES_METRO_L1.map((e) => e.idOficial),
    Array.from({ length: 16 }, (_, i) => `E${String(i + 1).padStart(2, "0")}`),
  )
  for (const e of ESTACIONES_METRO_L1) {
    assert.match(e.clave, /^metro-bogota:l1:e\d{2}$/)
    assert.equal(e.clave, `metro-bogota:l1:${e.idOficial.toLowerCase()}`)
    assert.ok(e.fuentes.length >= 2 && e.fuentes.every((id) => id in FUENTES_METRO), e.idOficial)
  }
})

test("nombres: E03, E04 y E10 votados; E07 pendiente; E13 Central con su fuente específica", () => {
  assert.deepEqual(
    ["E03", "E04", "E10"].map((id) => [estacion(id).nombre, estacion(id).nombreEstado]),
    [["Ciudad Kennedy", "votado"], ["Timiza", "votado"], ["Santa Isabel", "votado"]],
  )
  assert.equal(estacion("E03").aliasSig, "Carrera 80-03")
  assert.equal(estacion("E07").nombre, null)
  assert.equal(estacion("E07").nombreEstado, "pendiente")
  assert.ok(!JSON.stringify(estacion("E07")).includes('"Avenida 68"'), "«Avenida 68» no es nombre de E07")
  assert.equal(estacion("E13").nombre, "Central")
  assert.ok(estacion("E13").fuentesNombre.includes("F13"))
  assert.ok(estacion("E13").conexion.discrepancia?.includes("2019"))
})

test("ocho conexiones directas previstas, E06/E07 por verificar, ninguna habilitada ni con contraparte inventada", () => {
  const directas = ESTACIONES_METRO_L1.filter((e) => e.conexion.estado === "directa_prevista").map((e) => e.idOficial)
  assert.deepEqual(directas, ["E02", "E09", "E11", "E12", "E13", "E14", "E15", "E16"])
  assert.deepEqual(
    ESTACIONES_METRO_L1.filter((e) => e.conexion.estado === "por_verificar").map((e) => e.idOficial),
    ["E06", "E07"],
  )
  for (const e of ESTACIONES_METRO_L1) {
    assert.equal(e.conexion.habilitadaParaRuteo, false)
    assert.equal(e.conexion.contraparteTm, null)
    assert.equal(e.geometria, null)
    assert.equal(e.accesos, null)
  }
})

test("F18 (dos conexiones por proximidad sin identificar) respalda a E06 y E07, no a las conexiones directas", () => {
  assert.deepEqual(
    ESTACIONES_METRO_L1.filter((e) => e.fuentes.includes("F18")).map((e) => e.idOficial),
    ["E06", "E07"],
  )
  for (const id of ["E06", "E07"]) assert.match(estacion(id).conexion.detalle, /dos conexiones por proximidad sin identificarlas/, id)
})

test("líneas: la 1 en construcción y la 2 en contratación, ninguna con servicio comercial", () => {
  assert.equal(LINEA_1.estado, "en_construccion")
  assert.equal(LINEA_2.estado, "contratacion_precalificacion")
  assert.equal(LINEA_2.estacionesProyectadas, 11)
  assert.equal(LINEA_1.servicioComercial, false)
  assert.equal(LINEA_2.servicioComercial, false)
  assert.ok(ESTACIONES_METRO_L1.every((e) => e.linea === "l1"), "ninguna estación de la Línea 2 en el listado de la Línea 1")
})

// --- Consultas del asistente ----------------------------------------------

test("E3 por número, nombre y alias da la misma ficha: Ciudad Kennedy con su alias técnico", () => {
  for (const frase of ["estación E3 del metro", "metro estación 03", "estación Ciudad Kennedy del metro", "metro carrera 80"]) {
    const respuesta = responder(frase)
    assert.equal(respuesta.action, "none", frase)
    assert.match(respuesta.reply, /Estación E03/, frase)
    assert.match(respuesta.reply, /Ciudad Kennedy, nombre elegido por votación/, frase)
    assert.match(respuesta.reply, /Carrera 80-03/, frase)
  }
})

test("E7 informa nombre pendiente y trata «avenida 68» solo como corredor o alias", () => {
  for (const frase of ["metro estación E7", "estación de la avenida 68 del metro"]) {
    const { reply } = responder(frase)
    assert.match(reply, /Estación E07/)
    assert.match(reply, /nombre público todavía está pendiente/)
    assert.match(reply, /no su nombre/)
    assert.doesNotMatch(reply, /Metro de Bogotá, nombre público anunciado/)
  }
})

test("E13 Central cita su fuente específica y conserva la discrepancia 2019 contra 2026", () => {
  const { reply, steps } = responder("estación Central del metro")
  assert.match(reply, /Estación E13/)
  assert.match(reply, /24 de abril de 2026/)
  assert.match(reply, /Discrepancia sin resolver.*2019/)
  assert.match(reply, /Hoy no hay transbordos habilitados/)
  assert.ok(steps.some((s) => s.label.startsWith("Fuente F13")))
})

test("Calle 72 sin contexto de Metro sigue siendo la estación de TransMilenio; con contexto, la del Metro", () => {
  assert.equal(interpretarMetro("cómo llego a Calle 72"), null)
  assert.deepEqual(parseIntent("cómo llego de Ricaurte a Calle 72", data), { type: "trip", origin: "Ricaurte", destination: "Calle 72" })
  const metro = parseIntent("estación Calle 72 del metro", data)
  assert.deepEqual(metro, { type: "metro", consulta: { tipo: "estacion", clave: "metro-bogota:l1:e16" } })
  assert.match(responder("estación Calle 72 del metro").reply, /otra estación/)
})

test("toda estación del Metro cuyo nombre público también existe en TransMilenio exige la palabra «metro»", () => {
  // Solo nombres públicos: es lo que `findPlaces` de TransMilenio sabe buscar.
  const homonimas = ESTACIONES_METRO_L1.filter((e) => e.nombre && findPlaces(e.nombre, data).length > 0)
  assert.ok(homonimas.length >= 11, `esperaba al menos 11 homónimas y hay ${homonimas.length}`)
  for (const e of homonimas) {
    const nombre = e.nombre!
    for (const sin of [nombre, `estación ${nombre}`, `cómo llego a ${nombre}`]) {
      assert.equal(interpretarMetro(sin), null, sin)
      assert.notEqual(parseIntent(sin, data).type, "metro", sin)
    }
    const con = `estación ${nombre} del metro`
    assert.deepEqual(interpretarMetro(con), { tipo: "estacion", clave: e.clave }, con)
    assert.deepEqual(parseIntent(con, data), { type: "metro", consulta: { tipo: "estacion", clave: e.clave } }, con)
    assert.ok(responder(con).reply.includes(TEXTO_HOMONIMO), con)
  }
})

test("peticiones de viaje reales por Metro, mixtas, tarifa y horario explican indisponibilidad sin abordaje ni navegación", () => {
  const frases = [
    "cómo llego de Calle 45 a Central en metro",
    "quiero ir en metro a Calle 72",
    "de Ricaurte a Calle 72 en metro",
    "viaje en metro y transmilenio de Portal Américas a Central",
    "transbordo entre el metro y TransMilenio en Calle 72",
    "cómo llego a la línea 2 del metro",
    "cuánto cuesta el pasaje del metro",
    "horario del metro Calle 72",
    "cuánto demora el metro",
  ]
  for (const frase of frases) {
    const intent = parseIntent(frase, data)
    assert.equal(intent.type, "metro", frase)
    const respuesta = responder(frase)
    assert.equal(respuesta.action, "none", frase)
    assert.match(respuesta.reply, /sin servicio comercial/, frase)
    assert.ok(respuestaSinImperativos(respuesta), frase)
  }
  assert.match(responder("cómo llego de Calle 45 a Central en metro").reply, /No puedo planear viajes en Metro/)
  assert.match(responder("cuánto cuesta el pasaje del metro").reply, /No tengo tarifa del Metro/)
})

test("Metro no activa servicio al pasar la fecha prevista ni mezcla Línea 2 con la Línea 1", () => {
  const despues = responder("información de la línea 1 del metro", new Date("2028-06-01T10:00:00-05:00"))
  assert.match(despues.reply, /en construcción y sin servicio comercial/)
  assert.match(despues.reply, /marzo de 2028; es una previsión/)
  const linea2 = responder("línea 2 del metro")
  assert.match(linea2.reply, /contratación y precalificación/)
  assert.match(linea2.reply, /11 estaciones/)
  assert.match(linea2.reply, /no tengo una lista de sus estaciones/)
  assert.match(responder("estación 5 de la línea 2 del metro").reply, /Línea 2/)
  assert.doesNotMatch(responder("estación 5 de la línea 2 del metro").reply, /Hospital de Kennedy/)
})

test("listado y estación inexistente solo dicen lo que hay", () => {
  const listado = responder("qué estaciones tiene el metro").reply
  for (const e of ESTACIONES_METRO_L1) assert.ok(listado.includes(e.idOficial), e.idOficial)
  assert.match(listado, /E07, nombre pendiente/)
  assert.match(responder("estación 17 del metro").reply, /16 estaciones, de E01 a E16/)
  assert.match(responder("metro").reply, /Línea 1.*Línea 2/s)
})

test("ninguna respuesta de Metro inventa coordenadas, tarifas, frecuencias o tiempos, ni da órdenes de abordaje", () => {
  const frases = ["metro", "línea 1 del metro", "línea 2 del metro", "qué estaciones tiene el metro", "cómo llego en metro a Calle 72", ...ESTACIONES_METRO_L1.map((e) => `metro estación ${e.numero}`)]
  for (const frase of frases) {
    const { reply, steps } = responder(frase)
    const texto = [reply, ...steps.flatMap((s) => [s.label, s.detail ?? ""])].join(" ")
    assert.ok(!contieneImperativoDeViaje(texto), frase)
    assert.doesNotMatch(reply, /\$|\bpesos\b|\d+\s?(?:minutos|min)\b|\d\.\d{4,}|\bcada \d/i, frase)
  }
})

test("contrato HTTP compatible: acción none, sin usar ubicación ni modelo", () => {
  const respuesta = responder("estación E3 del metro")
  assert.deepEqual(AgentReplySchema.parse(respuesta), respuesta)
  assert.ok(["none", "frequent", "gps", "search", "route", "trip"].includes(respuesta.action))
  const intent = parseIntent("estación E3 del metro", data)
  assert.equal(intencionUsaUbicacion(intent), false)
  assert.equal(requiereModelo(intent), false)
})

// --- TransMilenio intacto -------------------------------------------------

test("el catálogo de TransMilenio y sus consumidores operativos no incluyen Metro", () => {
  assert.ok(!data.stations.some((s) => /metro-bogota|^E\d{2}$/.test(s.id ?? s.name)))
  assert.ok(findPlaces("Central", data).every((p) => !p.stations.some((s) => /metro-bogota/.test(JSON.stringify(s)))))
  const cercanas = nearestStations({ lat: 4.6124, lng: -74.0935 }, data, 5)
  assert.ok(cercanas.length > 0 && cercanas.every((s) => !/metro-bogota/.test(JSON.stringify(s))))
  const [origen] = findPlaces("Ricaurte", data)
  const [destino] = findPlaces("Calle 72", data)
  assert.ok(origen && destino)
  assert.ok(planTrip({ origin: origen, destination: destino }, data, 3, new Date("2026-11-04T10:00:00-05:00")).every((plan) => plan.every((tramo) => !/metro/i.test(tramo.route.code))))
})

test("comportamiento normal de TransMilenio, cancelar y tarifas de buses se conserva", () => {
  assert.equal(parseIntent("quiero ir a Ricaurte", data).type, "trip")
  assert.equal(parseIntent("cancela", data).type, "cancel")
  assert.equal(parseIntent("cuánto cuesta el pasaje", data).type, "unsupported")
  assert.equal(parseIntent("información de la ruta B23", data).type, "route_info")
  assert.equal(parseIntent("cancela el metro", data).type, "cancel")
  assert.match(responder("ayuda").reply, /Metro de Bogotá/)
})

test("«ayuda» o «cómo funciona» dentro de una frase de Metro no cae a la ayuda genérica", () => {
  const linea2 = parseIntent("cómo funciona la línea 2 del metro", data)
  assert.deepEqual(linea2, { type: "metro", consulta: { tipo: "linea", linea: 2 } })
  const reply = responder("cómo funciona la línea 2 del metro")
  assert.match(reply.reply, /contratación y precalificación/)
  assert.match(reply.reply, /11 estaciones/)
  assert.ok(reply.steps.some((s) => s.label.startsWith("Fuente ")))

  for (const frase of ["ayuda para ir de Central a Calle 72 en metro", "ayuda, viaje en metro y transmilenio de Portal Américas a Central"]) {
    assert.equal(parseIntent(frase, data).type, "metro", frase)
    const viaje = responder(frase)
    assert.equal(viaje.action, "none", frase)
    assert.match(viaje.reply, /No puedo planear viajes en Metro/, frase)
  }
  // Sin contexto de Metro, la ayuda genérica y cancelar no cambian.
  assert.equal(parseIntent("ayuda", data).type, "help")
  assert.equal(parseIntent("cómo funciona", data).type, "help")
  assert.equal(parseIntent("cancela el metro", data).type, "cancel")
})

test("número y nombre de estación que no coinciden piden aclarar en vez de elegir uno en silencio", () => {
  const e16 = "metro-bogota:l1:e16"
  const e03 = "metro-bogota:l1:e03"
  const contradictorias: [string, number, string][] = [
    ["estación E3 Calle 72 del metro", 3, e16],
    ["metro estación 3, no Calle 72", 3, e16],
    ["estación E17 Ciudad Kennedy del metro", 17, e03],
  ]
  for (const [frase, numero, clave] of contradictorias) {
    assert.deepEqual(interpretarMetro(frase), { tipo: "estacion_contradictoria", numero, clave }, frase)
    const respuesta = responder(frase)
    assert.equal(respuesta.action, "none", frase)
    assert.match(respuesta.reply, /No coinciden/, frase)
    assert.ok(respuestaSinImperativos(respuesta), frase)
    assert.deepEqual(AgentReplySchema.parse(respuesta), respuesta, frase)
  }
  // Identificadores coherentes, o uno solo, siguen resolviendo la estación.
  assert.deepEqual(interpretarMetro("estación E16 Calle 72 del metro"), { tipo: "estacion", clave: e16 })
  assert.deepEqual(interpretarMetro("metro estación 3 Ciudad Kennedy"), { tipo: "estacion", clave: e03 })
  assert.deepEqual(interpretarMetro("estación Ciudad Kennedy del metro"), { tipo: "estacion", clave: e03 })
  assert.deepEqual(interpretarMetro("estación E17 del metro"), { tipo: "estacion_inexistente", numero: 17 })
  // Una petición de viaje con dos estaciones sigue siendo un rechazo de servicio.
  assert.deepEqual(interpretarMetro("de E3 a Calle 72 en metro"), { tipo: "servicio", tema: "viaje" })
})

test("«kennedy» suelto con contexto de Metro es ambiguo entre E03 y E05 y pide aclarar", () => {
  const ambigua = { tipo: "estacion_ambigua", claves: ["metro-bogota:l1:e03", "metro-bogota:l1:e05"] }
  // También cuando otro nombre o un número ajeno a «kennedy» aparece en la misma frase.
  const frases = ["metro kennedy", "cuándo abre kennedy metro", "metro hospital kennedy", "metro estación kennedy hospital", "metro estación 7 kennedy", "metro timiza kennedy"]
  for (const frase of frases) {
    assert.deepEqual(interpretarMetro(frase), ambigua, frase)
    const respuesta = responder(frase)
    assert.equal(respuesta.action, "none", frase)
    assert.match(respuesta.reply, /E03, Ciudad Kennedy o E05, Hospital de Kennedy/, frase)
    assert.match(respuesta.reply, /No sé cuál quieres/, frase)
    assert.deepEqual(AgentReplySchema.parse(respuesta), respuesta, frase)
  }
  // Nombre completo, o número, resuelven; sin contexto de Metro no es Metro.
  for (const [frase, clave] of [
    ["metro hospital de kennedy", "metro-bogota:l1:e05"],
    ["metro estación 3 kennedy", "metro-bogota:l1:e03"],
    ["metro e5 kennedy", "metro-bogota:l1:e05"],
    ["metro ciudad kennedy", "metro-bogota:l1:e03"],
  ]) {
    assert.deepEqual(interpretarMetro(frase), { tipo: "estacion", clave }, frase)
  }
  // El rechazo de viaje sigue ganando.
  assert.deepEqual(interpretarMetro("quiero ir de Ciudad Kennedy a Timiza en el metro"), { tipo: "servicio", tema: "viaje" })
  assert.equal(interpretarMetro("kennedy"), null)
})

test("preguntas de apertura pasan por la misma prioridad de servicio e identidad de estación", () => {
  const e16 = "metro-bogota:l1:e16"
  const e03 = "metro-bogota:l1:e03"
  // Número y nombre en conflicto, o número inválido: se pide aclarar, nunca se elige uno en silencio.
  assert.deepEqual(interpretarMetro("cuándo abre la estación E3 Calle 72 del metro"), { tipo: "estacion_contradictoria", numero: 3, clave: e16 })
  assert.deepEqual(interpretarMetro("cuándo abre la estación E17 Ciudad Kennedy del metro"), { tipo: "estacion_contradictoria", numero: 17, clave: e03 })
  assert.deepEqual(interpretarMetro("cuándo abre la estación E17 del metro"), { tipo: "estacion_inexistente", numero: 17 })
  // Coherente, solo por nombre o solo por número: la misma estación que sin la pregunta de apertura.
  assert.deepEqual(interpretarMetro("cuándo abre la estación E16 Calle 72 del metro"), { tipo: "estacion", clave: e16 })
  assert.deepEqual(interpretarMetro("cuándo abre la estación Calle 72 del metro"), { tipo: "estacion", clave: e16 })
  assert.deepEqual(interpretarMetro("cuándo abre la estación E3 del metro"), { tipo: "estacion", clave: e03 })
  const ficha = responder("cuándo abre la estación E16 Calle 72 del metro")
  assert.match(ficha.reply, /E16/)
  assert.match(ficha.reply, /previsión|prevista|previsto/i)
  assert.match(ficha.reply, /sin servicio comercial/i)
  // Un viaje futuro en Metro se rechaza como viaje, aunque diga «cuando abra».
  assert.deepEqual(interpretarMetro("cómo llego a Calle 72 en metro cuando abra"), { tipo: "servicio", tema: "viaje" })
  const viaje = responder("cómo llego a Calle 72 en metro cuando abra")
  assert.equal(viaje.action, "none")
  assert.match(viaje.reply, /No puedo planear viajes en Metro/)
  // Sin estación: Línea 1 por defecto; la Línea 2 conserva su propia ficha.
  assert.deepEqual(interpretarMetro("cuándo abre el metro"), { tipo: "linea", linea: 1 })
  assert.deepEqual(interpretarMetro("cuándo abre la línea 2 del metro"), { tipo: "linea", linea: 2 })
  assert.match(responder("cuándo abre la línea 2 del metro").reply, /contratación y precalificación/)
  assert.match(responder("cuándo abre el metro").reply, /marzo de 2028; es una previsión/)
})

// --- Contrato iOS ---------------------------------------------------------

/** Frases de Metro de estas pruebas: estación por nombre y número, líneas, rechazos, aclaraciones. */
const FRASES_METRO = [
  ...ESTACIONES_METRO_L1.map((e) => `metro estación ${e.numero}`),
  ...ESTACIONES_METRO_L1.flatMap((e) => (e.nombre ? [`estación ${e.nombre} del metro`] : [])),
  "estación E3 del metro",
  "metro carrera 80",
  "metro estación E7",
  "estación de la avenida 68 del metro",
  "metro",
  "línea 1 del metro",
  "línea 2 del metro",
  "estación 5 de la línea 2 del metro",
  "qué estaciones tiene el metro",
  "estación 17 del metro",
  "cómo llego de Calle 45 a Central en metro",
  "viaje en metro y transmilenio de Portal Américas a Central",
  "cuánto cuesta el pasaje del metro",
  "horario del metro Calle 72",
  "cuánto demora el metro",
  "estación E3 Calle 72 del metro",
  "estación E17 Ciudad Kennedy del metro",
  "metro kennedy",
  "cuándo abre el metro",
  "cuándo abre la línea 2 del metro",
]

// Límites del decodificador iOS: `RespuestaAgente.maximoCaracteresTexto` y `maximoPasos`.
const IOS_MAXIMO_CARACTERES_TEXTO = 10_000
const IOS_MAXIMO_PASOS = 50

test("contrato iOS: toda respuesta de Metro es action none, con la forma de siempre y dentro de los límites del decodificador", () => {
  for (const frase of FRASES_METRO) {
    // Mismo recorrido que `POST /api/agent`: reglas (`parseIntent`) y luego `runIntent`.
    const intent = parseIntent(frase, data)
    assert.equal(intent.type, "metro", frase)
    const respuesta = runIntent(intent, { data, context: { now: new Date("2026-11-07T10:00:00-05:00") }, engine: "reglas" })
    assert.equal(respuesta.action, "none", frase)
    assert.equal(respuesta.engine, "reglas", frase)
    assert.deepEqual(Object.keys(respuesta).sort(), ["action", "engine", "reply", "steps"], `${frase}: sin campos nuevos`)
    assert.ok(respuesta.reply.trim().length > 0 && respuesta.reply.length <= IOS_MAXIMO_CARACTERES_TEXTO, `${frase}: ${respuesta.reply.length} caracteres`)
    assert.ok(respuesta.steps.length <= IOS_MAXIMO_PASOS, `${frase}: ${respuesta.steps.length} pasos`)
    for (const paso of respuesta.steps) assert.ok(Object.keys(paso).every((k) => k === "label" || k === "detail"), frase)
  }
})

// --- Separación del catálogo ----------------------------------------------

/** Solo estos archivos de producción pueden importar el catálogo: el agente que lo consulta y su listado. */
const IMPORTADORES_PERMITIDOS = ["lib/local-agent.ts", "components/metro-list.tsx"]
const OMITIDOS = ["lib/metro.ts", ...IMPORTADORES_PERMITIDOS]

test("ningún código de producción fuera del agente y del listado importa el catálogo de Metro", () => {
  const raiz = process.cwd()
  // `scripts/` construye `data/transmilenio.json`; `proxy.ts` e `instrumentation.ts` viven en la raíz.
  const archivos = ["lib", "components", "hooks", "app", "scripts"]
    .flatMap((dir) => readdirSync(`${raiz}/${dir}`, { recursive: true, encoding: "utf8" }).map((f) => `${dir}/${f.replaceAll("\\", "/")}`))
    .concat("proxy.ts", "instrumentation.ts")
    .filter((f) => /\.(?:tsx?|mjs)$/.test(f) && !/\.test\.tsx?$/.test(f))
  assert.ok(archivos.length > 30, `el rastreo solo vio ${archivos.length} archivos`)
  for (const permitido of OMITIDOS) assert.ok(archivos.includes(permitido), `falta ${permitido}`)

  const importaMetro = /(?:from|import|require)\s*\(?\s*["'](?:@\/lib\/metro|(?:\.\.?\/)+(?:lib\/)?metro)(?:\.tsx?)?["']/
  const infractores = archivos.filter((f) => !OMITIDOS.includes(f) && importaMetro.test(readFileSync(`${raiz}/${f}`, "utf8")))
  assert.deepEqual(infractores, [], "el catálogo de Metro no debe llegar a GPS, paradas ni planTrip")
  for (const permitido of IMPORTADORES_PERMITIDOS) {
    assert.match(readFileSync(`${raiz}/${permitido}`, "utf8"), importaMetro, `${permitido} deja de importar el catálogo: actualiza la lista`)
  }
})
