import assert from "node:assert/strict"
import test from "node:test"
import snapshot from "../data/transmilenio.json" with { type: "json" }
import {
  datosExpreso,
  datosSinVerificar,
  datosTransbordoVerificado,
  datosVerificadosDirecto,
} from "./fixtures-sinteticas"
import {
  findPlaces,
  findRouteByCode,
  hasVerifiedServedStops,
  planTrip,
  planTripCandidato,
  routesAlongBoth,
  routesThrough,
  searchRoutes,
  tripSummaryStillValid,
} from "./routes"
import { TransmilenioDataSchema } from "./transmilenio"

const data = TransmilenioDataSchema.parse(snapshot)
const AHORA = new Date("2026-11-04T10:00:00-05:00")

test("los datos reales traen estaciones y rutas", () => {
  assert.ok(data.stations.length >= 100)
  assert.ok(data.routes.length >= 100)
  assert.ok(data.routes.every((r) => r.path.length > 1))
})

test("agrupa las estaciones que comparten nombre", () => {
  const [ricaurte] = findPlaces("Ricaurte", data)
  assert.equal(ricaurte.name, "Ricaurte")
  assert.equal(ricaurte.stations.length, 2)
})

test("la coincidencia más larga gana", () => {
  const places = findPlaces("Suba Calle 100", data)
  assert.equal(places.length, 1)
  assert.equal(places[0].stations[0].name, "Suba - Calle 100")
})

test("reconoce códigos de ruta dichos de varias formas", () => {
  assert.equal(findRouteByCode("la B23", data)?.code, "B23")
  assert.equal(findRouteByCode("ruta h 54", data)?.code, "H54")
})

test("reconoce los códigos número-letra reconciliados 8 G y 8 T", () => {
  // Soporte mínimo para los dos servicios cuya dirección se reconcilió (#31),
  // sin resolver todo el issue #32.
  assert.equal(findRouteByCode("información de la 8 G", data)?.code, "8 G")
  assert.equal(findRouteByCode("la 8 T", data)?.code, "8 T")
  assert.equal(searchRoutes("8 G", data)[0]?.code, "8 G")
  assert.equal(searchRoutes("8 T", data)[0]?.code, "8 T")
})

test("buscar una estación ya no devuelve todas las rutas", () => {
  const all = data.routes.length
  for (const query of ["Portal Norte", "Calle 72", "Ricaurte"]) {
    const found = searchRoutes(query, data)
    assert.ok(found.length > 0, query)
    assert.ok(found.length < all, `${query}: ${found.length} de ${all}`)
  }
})

test("sin paradas verificadas de un servicio, no se arma un viaje por geometría", () => {
  // Portal Usme → Molinos no tiene paradas verificadas en el catálogo: el
  // planificador no debe convertir la cercanía geométrica en un abordaje.
  const [usme] = findPlaces("Portal Usme", data)
  const [molinos] = findPlaces("Molinos", data)
  const plans = planTrip({ origin: usme, destination: molinos }, data, 3, AHORA)
  assert.equal(plans.length, 0, "no debe planear abordajes inferidos por geometría")
})

test("H72 no ofrece abordar en Calle 127 aunque su recorrido pase por ahí", () => {
  // Evidencia GTFS: H72 no atiende el nodo 2202 (Calle 127).
  const [c127] = findPlaces("Calle 127", data)
  const [usme] = findPlaces("Portal Usme", data)
  const h72 = data.routes.find((r) => r.code === "H72")
  assert.ok(h72, "el catálogo debe tener H72")
  assert.ok(h72!.stops.includes("Calle 127"), "su recorrido sí pasa cerca de Calle 127")
  assert.equal(h72!.servedStops.length, 0, "pero no tiene paradas verificadas")
  const plans = planTrip({ origin: c127, destination: usme }, data, 124, AHORA)
  assert.equal(plans.length, 0, "ningún plan debe hacer abordar en Calle 127")
})

test("8 G con evidencia GTFS sí planea Terminal → Guatoque dentro de la franja", () => {
  const [terminal] = findPlaces("Terminal", data)
  const [guatoque] = findPlaces("Guatoque", data)
  const plans = planTrip({ origin: terminal, destination: guatoque }, data, 3, AHORA)
  const leg = plans.find((p) => p.length === 1 && p[0].route.code === "8 G")?.[0]
  assert.ok(leg, "8 G debe ofrecer un viaje directo Terminal → Guatoque")
  assert.equal(leg!.board, "Terminal")
  assert.equal(leg!.alight, "Guatoque - Veraguas")
  assert.equal(leg!.stationsRidden, 26)
  assert.equal(leg!.conteoVerificado, true, "8 G: todos los viajes que unen ambas paradas las separan 26")
})

test("8 T Guatoque → Terminal se planea pero no garantiza el número de estaciones", () => {
  // Seis viajes de 8 T omiten Calle 187: 26 o 25 paradas según el viaje.
  const [guatoque] = findPlaces("Guatoque", data)
  const [terminal] = findPlaces("Terminal", data)
  const leg = planTrip({ origin: guatoque, destination: terminal }, data, 3, AHORA).find((p) => p[0].route.code === "8 T")?.[0]
  assert.ok(leg)
  assert.equal(leg!.conteoVerificado, false)
})

test("8 T no prescribe Calle 187 sin distinguir los viajes que la omiten", () => {
  const t = data.routes.find((r) => r.code === "8 T")!
  const soloT = { ...data, routes: [t] }
  const [guatoque] = findPlaces("Guatoque", soloT)
  const [c187] = findPlaces("Calle 187", soloT)
  const [terminal] = findPlaces("Terminal", soloT)
  // El siguiente viaje desde Guatoque (10:07:30) omite Calle 187 en el GTFS.
  for (const places of [{ origin: guatoque, destination: c187 }, { origin: c187, destination: terminal }]) {
    assert.deepEqual(planTrip(places, soloT, 3, AHORA), [])
    assert.deepEqual(planTripCandidato(places, soloT, 3, AHORA), [])
  }
  assert.equal(tripSummaryStillValid([{ routeCode: "8 T", board: "Guatoque - Veraguas", alight: "Calle 187" }], soloT, AHORA), false)
  const g = data.routes.find((r) => r.code === "8 G")!
  assert.ok(planTrip({ origin: terminal, destination: c187 }, { ...data, routes: [g] }, 3, AHORA).length)
})

test("un transbordo exige una estación del catálogo que coincida con ambos nodos", () => {
  const ausente = datosTransbordoVerificado()
  ausente.stations = ausente.stations.filter((s) => !["Charlie", "Delta"].includes(s.name))
  const lugares = { origin: findPlaces("Alfa", ausente)[0], destination: findPlaces("Eco", ausente)[0] }
  assert.deepEqual(planTrip(lugares, ausente, 3, AHORA), [])

  const nodoInvalido = datosTransbordoVerificado()
  for (const route of nodoInvalido.routes) {
    for (const stop of route.servedStops.filter((s) => ["Charlie", "Delta"].includes(s.name))) stop.nodeId = "9999"
  }
  assert.deepEqual(planTrip(lugares, nodoInvalido, 3, AHORA), [])
})

test("fuera de franja, sin calendario vigente o fuera de la vigencia no se prescribe 8 G", () => {
  const [terminal] = findPlaces("Terminal", data)
  const [guatoque] = findPlaces("Guatoque", data)
  const plan = (iso: string) => planTrip({ origin: terminal, destination: guatoque }, data, 3, new Date(iso))
  const candidato = (iso: string) => planTripCandidato({ origin: terminal, destination: guatoque }, data, 3, new Date(iso))

  // 2026-11-04 02:00 en Bogotá: la primera salida de Terminal es a las 04:30.
  assert.deepEqual(plan("2026-11-04T02:00:00-05:00"), [])
  assert.ok(candidato("2026-11-04T02:00:00-05:00").length > 0, "pero sí hay candidato con paradas verificadas")
  assert.ok(plan("2026-11-04T04:30:00-05:00").length > 0)
  assert.deepEqual(plan("2026-11-04T23:00:01-05:00"), [])
  assert.deepEqual(plan("2026-11-04T05:00:00Z"), [], "medianoche en Bogotá")
  // Después de fin de vigencia del feed (y con evidencia de hace más de 31 días): se abstiene.
  assert.deepEqual(plan("2027-01-05T10:00:00-05:00"), [])
  assert.deepEqual(candidato("2027-01-05T10:00:00-05:00"), [], "ni siquiera como candidato")
  // Evidencia de «mañana» no existe hoy.
  assert.deepEqual(plan("2026-11-02T10:00:00-05:00"), [])
})

test("un festivo usa el servicio de domingo y un sábado el suyo", () => {
  const [terminal] = findPlaces("Terminal", data)
  const [guatoque] = findPlaces("Guatoque", data)
  const plan = (iso: string) => planTrip({ origin: terminal, destination: guatoque }, data, 3, new Date(iso))
  assert.ok(plan("2026-11-07T22:30:00-05:00").length > 0, "sábado hasta las 23:00")
  assert.deepEqual(plan("2026-11-08T22:30:00-05:00"), [], "domingo termina a las 22:00")
  assert.ok(plan("2026-11-16T21:00:00-05:00").length > 0, "festivo: servicio 4")
  assert.deepEqual(plan("2026-11-16T22:30:00-05:00"), [], "festivo: ya terminó, aunque un lunes normal seguiría")
})

test("sin sentido confirmado no se planea ni se revalida", () => {
  const legs = [{ routeCode: "V1", board: "Alfa", alight: "Eco" }]
  const base = datosVerificadosDirecto()
  assert.equal(tripSummaryStillValid(legs, base, AHORA), true)
  assert.equal(planTrip({ origin: findPlaces("Alfa", base)[0], destination: findPlaces("Eco", base)[0] }, base, 3, AHORA).length, 1)

  for (const evidencia of [
    { agreement: "contradictorio" as const, verified: false, note: "x" },
    { agreement: "contradictorio" as const, verified: true, note: "x" },
    { agreement: "indeterminado" as const, verified: false, note: "x" },
    { agreement: "consistente" as const, verified: false, note: "x" },
  ]) {
    const fx = datosVerificadosDirecto()
    fx.routes[0].directionEvidence = evidencia
    const plans = planTrip({ origin: findPlaces("Alfa", fx)[0], destination: findPlaces("Eco", fx)[0] }, fx, 3, AHORA)
    assert.equal(plans.length, 0, JSON.stringify(evidencia))
    assert.equal(planTripCandidato({ origin: findPlaces("Alfa", fx)[0], destination: findPlaces("Eco", fx)[0] }, fx, 3, AHORA).length, 0)
    assert.equal(tripSummaryStillValid(legs, fx, AHORA), false, JSON.stringify(evidencia))
  }
})

test("ofrece recorrido (con incertidumbre) aunque no haya paradas verificadas", () => {
  // La geometría sí conecta Portal Usme y Molinos: se puede informar el
  // recorrido, sin afirmar dónde se para.
  const [usme] = findPlaces("Portal Usme", data)
  const [molinos] = findPlaces("Molinos", data)
  const along = routesAlongBoth(usme, molinos, data)
  assert.ok(along.length > 0, "debe haber al menos un recorrido que conecte ambos lugares")
})

test("con paradas verificadas, planea un viaje directo con sentido", () => {
  const fx = datosVerificadosDirecto()
  const [alfa] = findPlaces("Alfa", fx)
  const [eco] = findPlaces("Eco", fx)
  const plans = planTrip({ origin: alfa, destination: eco }, fx, 3, AHORA)
  assert.equal(plans.length, 1)
  const leg = plans[0][0]
  assert.equal(leg.board, "Alfa")
  assert.equal(leg.alight, "Eco")
  assert.equal(leg.stationsRidden, 4)
})

test("un expreso no ofrece abordar donde solo pasa", () => {
  // X1 pasa por Bravo y Delta pero solo atiende Alfa, Charlie y Eco.
  const fx = datosExpreso()
  const [bravo] = findPlaces("Bravo", fx)
  const [delta] = findPlaces("Delta", fx)
  const plans = planTrip({ origin: bravo, destination: delta }, fx, 3, AHORA)
  assert.equal(plans.length, 0, "Bravo y Delta no son paradas atendidas del expreso")

  // Pero Alfa → Charlie sí es un viaje válido en el mismo expreso.
  const [alfa] = findPlaces("Alfa", fx)
  const [charlie] = findPlaces("Charlie", fx)
  const validos = planTrip({ origin: alfa, destination: charlie }, fx, 3, AHORA)
  assert.equal(validos.length, 1)
  assert.equal(validos[0][0].board, "Alfa")
  assert.equal(validos[0][0].alight, "Charlie")
})

test("un transbordo solo se arma con paradas verificadas en ambos servicios", () => {
  const now = AHORA
  const fx = datosTransbordoVerificado()
  const [alfa] = findPlaces("Alfa", fx)
  const [eco] = findPlaces("Eco", fx)
  const plans = planTrip({ origin: alfa, destination: eco }, fx, 3, now)
  assert.ok(plans.length > 0)
  const legs = plans[0]
  assert.equal(legs.length, 2, "P1 no llega a Eco; hace falta transbordar a Q1")
  assert.equal(legs[0].alight, legs[1].board, "el transbordo ocurre en una estación servida por ambos")
  assert.equal(legs[1].alight, "Eco")

  // Si se quita la evidencia de uno de los dos servicios, el transbordo
  // desaparece: no se completa con el que sí tiene paradas.
  const sinQ = datosTransbordoVerificado()
  const q1 = sinQ.routes.find((r) => r.code === "Q1")!
  q1.servedStops = q1.servedStops.map((s) => ({ ...s, source: "", date: "" }))
  const plansSinQ = planTrip({ origin: findPlaces("Alfa", sinQ)[0], destination: findPlaces("Eco", sinQ)[0] }, sinQ, 3, now)
  assert.equal(plansSinQ.length, 0, "sin evidencia en Q1 no hay transbordo válido")
})

test("evidencia vencida o futura no habilita un viaje", () => {
  const now = AHORA
  for (const date of ["1900-01-01", "2999-01-01", "", "no-es-fecha"]) {
    const fx = datosVerificadosDirecto()
    fx.routes[0].servedStops = fx.routes[0].servedStops.map((s) => ({ ...s, date }))
    const plans = planTrip({ origin: findPlaces("Alfa", fx)[0], destination: findPlaces("Eco", fx)[0] }, fx, 3, now)
    assert.equal(plans.length, 0, `date=${date}`)
  }
})

test("datos heredados sin servedStops no arman viaje y no rompen el esquema", () => {
  // Un servicio legado sin los campos nuevos: el esquema aplica el default [].
  const legado = {
    stations: datosSinVerificar().stations,
    routes: [
      {
        id: "L1",
        code: "L1",
        label: "Alfa hacia Eco",
        from: "Alfa",
        to: "Eco",
        stops: ["Alfa", "Bravo", "Eco"],
        path: [[4.6, -74.08] as [number, number], [4.68, -74.08] as [number, number]],
        schedule: { weekday: "", saturday: "", holiday: "" },
      },
    ],
    fetchedAt: "2026-11-04T00:00:00Z",
    source: "snapshot" as const,
  }
  const data = TransmilenioDataSchema.parse(legado)
  assert.deepEqual(data.routes[0].servedStops, [])
  const plans = planTrip({ origin: findPlaces("Alfa", data)[0], destination: findPlaces("Eco", data)[0] }, data, 3, AHORA)
  assert.equal(plans.length, 0)
})

test("tripSummaryStillValid revalida contra la evidencia actual", () => {
  const fx = datosVerificadosDirecto()
  const v1 = (board: string, alight: string) => [{ routeCode: "V1", board, alight }]
  assert.equal(tripSummaryStillValid(v1("Alfa", "Eco"), fx, AHORA), true)
  assert.equal(tripSummaryStillValid(v1("Inexistente", "Eco"), fx, AHORA), false, "parada que no está verificada")
  assert.equal(tripSummaryStillValid(v1("Eco", "Alfa"), fx, AHORA), false, "sentido contrario")
  assert.equal(tripSummaryStillValid([], fx, AHORA), false)
  assert.equal(tripSummaryStillValid([{ routeCode: "NO", board: "Alfa", alight: "Eco" }], fx, AHORA), false)
  // Fuera de franja o con la evidencia vencida, el resumen deja de valer.
  assert.equal(tripSummaryStillValid(v1("Alfa", "Eco"), fx, new Date("2026-11-04T03:00:00-05:00")), false)
  assert.equal(tripSummaryStillValid(v1("Alfa", "Eco"), fx, new Date("2027-01-05T10:00:00-05:00")), false)
  // Un esquema viejo (ruta sin servedStops) se rechaza.
  assert.equal(tripSummaryStillValid([{ routeCode: "H0", board: "Alfa", alight: "Eco" }], datosSinVerificar(), AHORA), false)
  // Una parada que no es una estación del catálogo se rechaza.
  const sinEstacion = datosVerificadosDirecto()
  sinEstacion.stations = sinEstacion.stations.filter((s) => s.name !== "Eco")
  assert.equal(tripSummaryStillValid(v1("Alfa", "Eco"), sinEstacion, AHORA), false)
  // El conteo declarado debe ser el que la fuente garantiza.
  assert.equal(tripSummaryStillValid([{ ...v1("Alfa", "Eco")[0], stationsRidden: 4, conteoVerificado: true }], fx, AHORA), true)
  assert.equal(tripSummaryStillValid([{ ...v1("Alfa", "Eco")[0], stationsRidden: 3 }], fx, AHORA), false)
  const sinConteo = datosVerificadosDirecto()
  sinConteo.routes[0].servedStops.forEach((s) => (s.conteoExacto = false))
  assert.equal(tripSummaryStillValid([{ ...v1("Alfa", "Eco")[0], conteoVerificado: true }], sinConteo, AHORA), false)
})

test("tripSummaryStillValid valida el viaje completo: transbordo conectado, máximo uno, rutas distintas", () => {
  const fx = datosTransbordoVerificado()
  const p = (board: string, alight: string) => ({ routeCode: "P1", board, alight })
  const q = (board: string, alight: string) => ({ routeCode: "Q1", board, alight })
  assert.equal(tripSummaryStillValid([p("Alfa", "Charlie"), q("Charlie", "Eco")], fx, AHORA), true, "transbordo en Charlie")
  // Dos tramos sin conexión: cada uno válido por separado, pero no forman un viaje.
  assert.equal(tripSummaryStillValid([p("Alfa", "Bravo"), q("Delta", "Eco")], fx, AHORA), false)
  assert.equal(tripSummaryStillValid([p("Alfa", "Charlie"), q("Delta", "Eco")], fx, AHORA), false, "bajar y subir en estaciones distintas")
  assert.equal(tripSummaryStillValid([q("Charlie", "Eco"), p("Alfa", "Charlie")], fx, AHORA), false, "orden inverso")
  assert.equal(tripSummaryStillValid([p("Alfa", "Bravo"), p("Bravo", "Charlie")], fx, AHORA), false, "misma ruta dos veces")
  assert.equal(tripSummaryStillValid([p("Alfa", "Bravo"), p("Bravo", "Charlie"), q("Charlie", "Eco")], fx, AHORA), false, "dos transbordos")
  // Con otros nombres: V1 Alfa→Bravo y V1 Delta→Eco (dos tramos de la misma ruta) no es un viaje.
  const v = datosVerificadosDirecto()
  assert.equal(
    tripSummaryStillValid([{ routeCode: "V1", board: "Alfa", alight: "Bravo" }, { routeCode: "V1", board: "Delta", alight: "Eco" }], v, AHORA),
    false,
  )
  // La segunda ruta fuera de su franja también invalida el viaje.
  const tarde = datosTransbordoVerificado()
  tarde.routes[1].verifiedCalendar = undefined
  assert.equal(tripSummaryStillValid([p("Alfa", "Charlie"), q("Charlie", "Eco")], tarde, AHORA), false)
})

test("un nodo declarado que no coincide con la estación impide el viaje", () => {
  const fx = datosVerificadosDirecto()
  // ids sintéticos no numéricos: un nodo declarado no puede comprobarse y se rechaza.
  fx.routes[0].servedStops[0].nodeId = "2502"
  assert.equal(planTrip({ origin: findPlaces("Alfa", fx)[0], destination: findPlaces("Eco", fx)[0] }, fx, 3, AHORA).length, 0)
  assert.equal(tripSummaryStillValid([{ routeCode: "V1", board: "Alfa", alight: "Eco" }], fx, AHORA), false)
})

test("hasVerifiedServedStops distingue datos sin verificar", () => {
  const now = AHORA
  assert.equal(hasVerifiedServedStops(datosVerificadosDirecto().routes[0], now), true)
  assert.equal(hasVerifiedServedStops(datosSinVerificar().routes[0], now), false)
  // En el catálogo real solo los servicios reconciliados (8 G, 8 T) tienen
  // paradas verificadas; el resto no.
  const con = data.routes.filter((r) => hasVerifiedServedStops(r, now)).map((r) => r.code)
  assert.deepEqual(con.sort(), ["8 G", "8 T"])
  // Pasado el máximo de antigüedad de la evidencia, ninguno.
  assert.deepEqual(data.routes.filter((r) => hasVerifiedServedStops(r, new Date("2027-01-05T10:00:00-05:00"))), [])
})

test("routesThrough informa recorrido, no paradas atendidas", () => {
  // Incluso sin paradas verificadas, routesThrough devuelve rutas cuyo trazado
  // pasa por el lugar: es información de recorrido, no de abordaje.
  const [ricaurte] = findPlaces("Ricaurte", data)
  const pasan = routesThrough(ricaurte, data)
  assert.ok(pasan.length > 0)
})
