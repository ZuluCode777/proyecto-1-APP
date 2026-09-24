import assert from "node:assert/strict"
import test from "node:test"
import snapshot from "../data/transmilenio.json" with { type: "json" }
import { findPlaces, findRouteByCode, planTrip, searchRoutes } from "./routes"
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

test("un viaje directo respeta el sentido de la ruta", () => {
  const [usme] = findPlaces("Portal Usme", data)
  const [molinos] = findPlaces("Molinos", data)
  const ida = planTrip({ origin: usme, destination: molinos }, data)
  assert.ok(ida.length > 0)
  for (const plan of ida) {
    const leg = plan[0]
    assert.ok(leg.route.stops.indexOf(leg.board) < leg.route.stops.indexOf(leg.alight))
  }
})

test("encuentra un transbordo cuando no hay ruta directa", () => {
  const [origin] = findPlaces("Portal Usme", data)
  const [destination] = findPlaces("Portal Suba", data)
  const plans = planTrip({ origin, destination }, data)
  assert.ok(plans.length > 0)
  const legs = plans[0]
  if (legs.length === 2) assert.equal(legs[0].alight, legs[1].board)
})
