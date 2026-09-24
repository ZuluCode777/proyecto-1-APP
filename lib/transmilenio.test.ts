import assert from "node:assert/strict"
import test from "node:test"
import { distanceToPath, pathBetween } from "./geo"
import { fullStationName, normalizeTransmilenio } from "./transmilenio"

// Respuesta mínima con la misma forma que devuelve el servicio ArcGIS.
const stationsRaw = {
  features: [
    { attributes: { num_est: "1", nom_est: "Norte" }, geometry: { x: -74.05, y: 4.7 } },
    { attributes: { num_est: "2", nom_est: "Centro" }, geometry: { x: -74.05, y: 4.65 } },
    { attributes: { num_est: "3", nom_est: "Lejana" }, geometry: { x: -74.2, y: 4.65 } },
  ],
}
const routesRaw = {
  features: [
    {
      attributes: { cod_ruta: "X1", orig_ruta: "Centro", dest_ruta: "Norte", hor_habil: "5:00 a. m. -  10:00 p. m." },
      // De sur a norte: [lng, lat].
      geometry: { paths: [[[-74.05, 4.64], [-74.05, 4.71]]] },
    },
    { attributes: { cod_ruta: "SIN-LINEA" }, geometry: { paths: [] } },
  ],
}

test("convierte la respuesta de ArcGIS en estaciones y rutas", () => {
  const data = normalizeTransmilenio(stationsRaw, routesRaw, "2026-09-23T00:00:00Z", "live")
  assert.equal(data.stations.length, 3)
  assert.equal(data.routes.length, 1, "descarta rutas sin recorrido")

  const [route] = data.routes
  assert.equal(route.code, "X1")
  assert.equal(route.label, "Centro hacia Norte")
  assert.deepEqual(route.path[0], [4.64, -74.05], "pasa de [lng, lat] a [lat, lng]")
  assert.equal(route.schedule.weekday, "5:00 a. m. - 10:00 p. m.", "limpia espacios duros y dobles")
})

test("deduce las estaciones del recorrido en orden y descarta las lejanas", () => {
  const data = normalizeTransmilenio(stationsRaw, routesRaw, "2026-09-23T00:00:00Z", "live")
  assert.deepEqual(data.routes[0].stops, ["Centro", "Norte"])
})

test("mide la distancia de un punto a una línea", () => {
  const line = [
    { lat: 4.6, lng: -74.1 },
    { lat: 4.7, lng: -74.1 },
  ]
  const onLine = distanceToPath({ lat: 4.65, lng: -74.1 }, line)
  assert.ok(onLine.distance < 1)
  assert.ok(Math.abs(onLine.along - 0.5) < 0.01)

  // 0,001° de longitud en Bogotá son unos 111 m.
  const beside = distanceToPath({ lat: 4.65, lng: -74.099 }, line)
  assert.ok(beside.distance > 100 && beside.distance < 120)
})

test("completa el origen y el destino que el servicio entrega cortados", () => {
  const stations = [
    { id: "1", name: "Portal El Dorado – C.C. Nuestro Bogotá", lat: 0, lng: 0 },
    { id: "2", name: "Alcalá – Colegio S. Tomás Dominicos", lat: 0, lng: 0 },
    { id: "3", name: "Calle 100 - Marketmedios", lat: 0, lng: 0 },
    { id: "4", name: "Calle 106", lat: 0, lng: 0 },
    { id: "5", name: "Portal 20 de Julio", lat: 0, lng: 0 },
  ]
  assert.equal(fullStationName("Portal ElDorado – C.C.", stations, []), "Portal El Dorado – C.C. Nuestro Bogotá")
  assert.equal(fullStationName("Alcalá – Colegio S. To", stations, []), "Alcalá – Colegio S. Tomás Dominicos", "cortado a mitad de palabra")
  assert.equal(fullStationName("Portal 20 De Julio", stations, []), "Portal 20 de Julio", "solo cambian las mayúsculas")
  assert.equal(fullStationName("Calle 100", stations, []), "Calle 100 - Marketmedios")
  assert.equal(fullStationName("Calle 10", stations, []), "Calle 10", "un nombre corto no se completa a mitad de palabra")
  assert.equal(fullStationName("Calle 22", stations, []), "Calle 22", "sin coincidencia queda igual")
})

test("recorta la línea al tramo entre dos estaciones", () => {
  const path: [number, number][] = [
    [4.6, -74.1],
    [4.62, -74.1],
    [4.64, -74.1],
    [4.66, -74.1],
    [4.68, -74.1],
  ]
  const board = { lat: 4.63, lng: -74.1 }
  const alight = { lat: 4.655, lng: -74.1 }
  assert.deepEqual(pathBetween(path, board, alight), path.slice(1, 4))
  assert.deepEqual(pathBetween(path, alight, board), path.slice(1, 4), "igual en el otro sentido")
})
