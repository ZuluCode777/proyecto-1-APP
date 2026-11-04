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
  routesAlongBoth,
  routesThrough,
  searchRoutes,
  tripSummaryStillValid,
} from "./routes"
import { TransmilenioDataSchema } from "./transmilenio"

const data = TransmilenioDataSchema.parse(snapshot)

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
  const plans = planTrip({ origin: usme, destination: molinos }, data)
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
  const plans = planTrip({ origin: c127, destination: usme }, data, 124)
  assert.equal(plans.length, 0, "ningún plan debe hacer abordar en Calle 127")
})

test("8 G con evidencia GTFS sí planea Terminal → Guatoque", () => {
  const [terminal] = findPlaces("Terminal", data)
  const [guatoque] = findPlaces("Guatoque", data)
  const now = new Date("2026-11-04T10:00:00-05:00")
  const plans = planTrip({ origin: terminal, destination: guatoque }, data, 3, now)
  assert.ok(plans.length > 0, "debe haber un plan con la evidencia verificada")
  const leg = plans.find((p) => p.length === 1 && p[0].route.code === "8 G")?.[0]
  assert.ok(leg, "8 G debe ofrecer un viaje directo Terminal → Guatoque")
  assert.equal(leg!.board, "Terminal")
  assert.equal(leg!.alight, "Guatoque - Veraguas")
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
  const plans = planTrip({ origin: alfa, destination: eco }, fx)
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
  const plans = planTrip({ origin: bravo, destination: delta }, fx)
  assert.equal(plans.length, 0, "Bravo y Delta no son paradas atendidas del expreso")

  // Pero Alfa → Charlie sí es un viaje válido en el mismo expreso.
  const [alfa] = findPlaces("Alfa", fx)
  const [charlie] = findPlaces("Charlie", fx)
  const validos = planTrip({ origin: alfa, destination: charlie }, fx)
  assert.equal(validos.length, 1)
  assert.equal(validos[0][0].board, "Alfa")
  assert.equal(validos[0][0].alight, "Charlie")
})

test("un transbordo solo se arma con paradas verificadas en ambos servicios", () => {
  const now = new Date("2026-11-04T10:00:00-05:00")
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
  const now = new Date("2026-11-04T10:00:00-05:00")
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
  const plans = planTrip({ origin: findPlaces("Alfa", data)[0], destination: findPlaces("Eco", data)[0] }, data)
  assert.equal(plans.length, 0)
})

test("tripSummaryStillValid revalida contra la evidencia actual", () => {
  const now = new Date("2026-11-04T10:00:00-05:00")
  const fx = datosVerificadosDirecto()
  // Resumen válido contra la evidencia.
  assert.equal(
    tripSummaryStillValid([{ routeCode: "V1", board: "Alfa", alight: "Eco" }], fx, now),
    true,
  )
  // Resumen con una parada que no está verificada para abordar.
  assert.equal(
    tripSummaryStillValid([{ routeCode: "V1", board: "Inexistente", alight: "Eco" }], fx, now),
    false,
  )
  // Resumen de un esquema viejo (ruta sin servedStops): se rechaza.
  const sin = datosSinVerificar()
  assert.equal(
    tripSummaryStillValid([{ routeCode: "H0", board: "Alfa", alight: "Eco" }], sin, now),
    false,
  )
})

test("hasVerifiedServedStops distingue datos sin verificar", () => {
  const now = new Date("2026-11-04T10:00:00-05:00")
  assert.equal(hasVerifiedServedStops(datosVerificadosDirecto().routes[0], now), true)
  assert.equal(hasVerifiedServedStops(datosSinVerificar().routes[0], now), false)
  // En el catálogo real solo los servicios reconciliados (8 G, 8 T) tienen
  // paradas verificadas; el resto no.
  const con = data.routes.filter((r) => hasVerifiedServedStops(r, now)).map((r) => r.code)
  assert.deepEqual(con.sort(), ["8 G", "8 T"])
})

test("routesThrough informa recorrido, no paradas atendidas", () => {
  // Incluso sin paradas verificadas, routesThrough devuelve rutas cuyo trazado
  // pasa por el lugar: es información de recorrido, no de abordaje.
  const [ricaurte] = findPlaces("Ricaurte", data)
  const pasan = routesThrough(ricaurte, data)
  assert.ok(pasan.length > 0)
})
