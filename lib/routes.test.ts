import assert from "node:assert/strict"
import test from "node:test"
import snapshot from "../data/transmilenio.json" with { type: "json" }
import {
  datosExpreso,
  datosSinVerificar,
  datosTransbordoVerificado,
  datosVerificadosDirecto,
} from "./fixtures-sinteticas"
import { findPlaces, findRouteByCode, hasVerifiedServedStops, planTrip, routesAlongBoth, routesThrough, searchRoutes } from "./routes"
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

test("buscar una estación ya no devuelve todas las rutas", () => {
  const all = data.routes.length
  for (const query of ["Portal Norte", "Calle 72", "Ricaurte"]) {
    const found = searchRoutes(query, data)
    assert.ok(found.length > 0, query)
    assert.ok(found.length < all, `${query}: ${found.length} de ${all}`)
  }
})

test("sin paradas verificadas, el catálogo real no arma ningún viaje", () => {
  // El snapshot actual no tiene paradas atendidas verificadas, así que el
  // planificador no debe convertir la cercanía geométrica en un abordaje.
  assert.ok(data.routes.every((r) => r.servedStops.length === 0))
  const [usme] = findPlaces("Portal Usme", data)
  const [molinos] = findPlaces("Molinos", data)
  const plans = planTrip({ origin: usme, destination: molinos }, data)
  assert.equal(plans.length, 0, "no debe planear abordajes inferidos por geometría")
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
  const fx = datosTransbordoVerificado()
  const [alfa] = findPlaces("Alfa", fx)
  const [eco] = findPlaces("Eco", fx)
  const plans = planTrip({ origin: alfa, destination: eco }, fx)
  assert.ok(plans.length > 0)
  const legs = plans[0]
  assert.equal(legs.length, 2, "P1 no llega a Eco; hace falta transbordar a Q1")
  assert.equal(legs[0].alight, legs[1].board, "el transbordo ocurre en una estación servida por ambos")
  assert.equal(legs[1].alight, "Eco")
})

test("hasVerifiedServedStops distingue datos sin verificar", () => {
  assert.equal(hasVerifiedServedStops(datosVerificadosDirecto().routes[0]), true)
  assert.equal(hasVerifiedServedStops(datosSinVerificar().routes[0]), false)
  assert.ok(data.routes.every((r) => hasVerifiedServedStops(r) === false), "el catálogo real aún no tiene paradas verificadas")
})

test("routesThrough informa recorrido, no paradas atendidas", () => {
  // Incluso sin paradas verificadas, routesThrough devuelve rutas cuyo trazado
  // pasa por el lugar: es información de recorrido, no de abordaje.
  const [ricaurte] = findPlaces("Ricaurte", data)
  const pasan = routesThrough(ricaurte, data)
  assert.ok(pasan.length > 0)
})
