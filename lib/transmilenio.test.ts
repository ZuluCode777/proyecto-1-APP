import assert from "node:assert/strict"
import test from "node:test"
import snapshot from "../data/transmilenio.json" with { type: "json" }
import { aplicarEvidenciaGtfs, CORRECCIONES_GTFS, H72_NO_PARA_EN } from "./evidencia-gtfs"
import { distanceToPath, pathBetween } from "./geo"
import { fullStationName, normalizeTransmilenio, reconciliarSentido, TransmilenioDataSchema } from "./transmilenio"

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

test("no deduce paradas atendidas: servedStops queda vacío", () => {
  const data = normalizeTransmilenio(stationsRaw, routesRaw, "2026-09-23T00:00:00Z", "live")
  assert.deepEqual(data.routes[0].servedStops, [], "la geometría no se convierte en paradas verificadas")
})

test("reconciliarSentido detecta el sentido consistente, el contradictorio y el indeterminado", () => {
  const consistente = reconciliarSentido("Alfa", "Eco", ["Alfa", "Bravo", "Eco"])
  assert.equal(consistente.agreement, "consistente")
  assert.equal(consistente.verified, false, "coincidir con la geometría no equivale a fuente oficial")

  const contradictorio = reconciliarSentido("Alfa", "Eco", ["Eco", "Bravo", "Alfa"])
  assert.equal(contradictorio.agreement, "contradictorio")
  assert.equal(contradictorio.verified, false)

  const indeterminado = reconciliarSentido("Alfa", "Eco", ["Bravo", "Charlie"])
  assert.equal(indeterminado.agreement, "indeterminado")
})

test("8 G y 8 T quedan reconciliados desde GTFS: sentido corregido, geometría preservada", () => {
  const data = TransmilenioDataSchema.parse(snapshot)
  const g = data.routes.find((r) => r.code === "8 G")
  const t = data.routes.find((r) => r.code === "8 T")
  assert.ok(g && t, "el catálogo real debe tener 8 G y 8 T")

  // El sentido se corrigió con evidencia GTFS y quedó verificado.
  assert.equal(g!.directionEvidence.agreement, "consistente")
  assert.equal(g!.directionEvidence.verified, true)
  assert.equal(g!.from, "Terminal")
  assert.equal(g!.to, "Guatoque - Veraguas")
  assert.equal(t!.from, "Guatoque - Veraguas")
  assert.equal(t!.to, "Terminal")

  // La geometría (stops) NO se invirtió: conserva su orden original.
  assert.equal(g!.stops[0], "Terminal")
  assert.equal(g!.stops[g!.stops.length - 1], "Guatoque - Veraguas")
  assert.equal(t!.stops[0], "Guatoque - Veraguas")
  assert.equal(t!.stops[t!.stops.length - 1], "Terminal")

  // Paradas atendidas del patrón completo, con nodo, franjas y calendario.
  assert.equal(g!.servedStops.length, 26, "27 paradas GTFS menos Calle 53, que no existe en el catálogo")
  assert.equal(t!.servedStops.length, 26)
  assert.ok(g!.verifiedCalendar, "8 G debe tener calendario verificado")
  assert.equal(g!.servedStops[0].name, "Terminal")
  assert.equal(g!.servedStops[0].canBoard, true)
  assert.equal(g!.servedStops[0].nodeId, "2502")
  assert.deepEqual(g!.servedStops[0].franjas, [
    { serviceId: "1", primera: "04:30:00", ultima: "23:00:00" },
    { serviceId: "2", primera: "04:30:00", ultima: "23:00:00" },
    { serviceId: "4", primera: "04:30:00", ultima: "22:00:00" },
  ])
  assert.equal(g!.servedStops.at(-1)!.order, 26)
  assert.equal(g!.servedStops.some((s) => s.name.includes("53")), false, "no se inventa Calle 53")
  assert.equal(g!.servedStops.every((s) => s.conteoExacto), true)
  assert.equal(t!.servedStops.some((s) => s.conteoExacto), false, "8 T tiene variantes que omiten Calle 187")
})

// Respuesta ArcGIS construida con el catálogo guardado, con la etiqueta de sentido
// INVERTIDA como la entrega el GIS para 13307 y 13308.
function arcgisDesdeCatalogo(codigos: string[], invertirTrazado = false) {
  const data = TransmilenioDataSchema.parse(snapshot)
  const stationsRaw = {
    features: data.stations.map((s) => ({ attributes: { num_est: s.id, nom_est: s.name }, geometry: { x: s.lng, y: s.lat } })),
  }
  const routesRaw = {
    features: data.routes
      .filter((r) => codigos.includes(r.code))
      .map((r) => {
        const pts = r.path.map(([lat, lng]) => [lng, lat])
        return {
          attributes: { cod_ruta: r.code, orig_ruta: r.to, dest_ruta: r.from, hor_habil: "", hor_sab: "", hor_fest: "" },
          geometry: { paths: [invertirTrazado ? pts.reverse() : pts] },
        }
      }),
  }
  return { stationsRaw, routesRaw }
}

test("la consulta en VIVO aplica la misma evidencia GTFS que la copia (8 G, 8 T) y no toca H72", () => {
  const { stationsRaw, routesRaw } = arcgisDesdeCatalogo(["8 G", "8 T", "H72"])
  const vivo = normalizeTransmilenio(stationsRaw, routesRaw, "2026-11-04T00:00:00Z", "live")
  const guardado = TransmilenioDataSchema.parse(snapshot)
  for (const code of ["8 G", "8 T"]) {
    const v = vivo.routes.find((r) => r.code === code)!
    const c = guardado.routes.find((r) => r.code === code)!
    assert.equal(v.from, c.from, code)
    assert.equal(v.to, c.to, code)
    assert.equal(v.directionEvidence.verified, true, code)
    assert.deepEqual(v.servedStops, c.servedStops, code)
    assert.deepEqual(v.verifiedCalendar, c.verifiedCalendar, code)
    assert.deepEqual(v.path, c.path, "la geometría no se invierte")
  }
  const h72 = vivo.routes.find((r) => r.code === "H72")!
  assert.deepEqual(h72.servedStops, [])
  assert.equal(h72.directionEvidence.verified, false)
})

test("si el trazado ya no coincide con el sentido GTFS, no se aplica la evidencia", () => {
  // Un GIS que invierta o cambie la geometría deja el servicio sin prescribir.
  const { stationsRaw, routesRaw } = arcgisDesdeCatalogo(["8 G"], true)
  const [g] = normalizeTransmilenio(stationsRaw, routesRaw, "2026-11-04T00:00:00Z", "live").routes
  assert.deepEqual(g.servedStops, [])
  assert.equal(g.verifiedCalendar, undefined)
  assert.equal(g.directionEvidence.verified, false)
})

test("un trazado invertido invalida la evidencia que ya traía la copia", () => {
  const data = TransmilenioDataSchema.parse(snapshot)
  const g = data.routes.find((r) => r.code === "8 G")!
  assert.equal(g.directionEvidence.verified, true)
  assert.ok(g.servedStops.length > 0)
  g.stops.reverse()
  g.path.reverse()
  const geometria = structuredClone({ path: g.path, stops: g.stops })
  aplicarEvidenciaGtfs(data.routes, data.stations)
  assert.equal(g.directionEvidence.verified, false)
  assert.deepEqual(g.servedStops, [])
  assert.equal(g.verifiedCalendar, undefined)
  assert.deepEqual({ path: g.path, stops: g.stops }, geometria)
})

test("una copia anterior sin la evidencia se corrige al cargarla y es idempotente", () => {
  const actual = TransmilenioDataSchema.parse(snapshot)
  const legado = TransmilenioDataSchema.parse({
    ...snapshot,
    routes: actual.routes.map((r) =>
      CORRECCIONES_GTFS[r.code]
        ? {
            ...r,
            from: r.to,
            to: r.from,
            label: `${r.to} hacia ${r.from}`,
            servedStops: undefined,
            directionEvidence: undefined,
            // Calendario del esquema anterior: sin `servicios`, nunca habilita nada.
            verifiedCalendar: { weekdays: [1, 2, 3, 4, 5], startDate: "2026-01-01", endDate: "2026-12-31", addedDates: [], removedDates: [], timezone: "America/Bogota", source: "x", date: "2026-11-03" },
          }
        : r,
    ),
  })
  assert.deepEqual(legado.routes.find((r) => r.code === "8 G")!.verifiedCalendar!.servicios, [])
  assert.equal(legado.routes.find((r) => r.code === "8 G")!.servedStops.length, 0)

  aplicarEvidenciaGtfs(legado.routes, legado.stations)
  assert.deepEqual(legado.routes.filter((r) => CORRECCIONES_GTFS[r.code]), actual.routes.filter((r) => CORRECCIONES_GTFS[r.code]))
  const antes = structuredClone(legado.routes)
  aplicarEvidenciaGtfs(legado.routes, legado.stations)
  assert.deepEqual(legado.routes, antes)
})

test("H72 nunca atiende Calle 127, aunque otra fuente la sume", () => {
  const data = TransmilenioDataSchema.parse(snapshot)
  const h72 = data.routes.find((r) => r.code === H72_NO_PARA_EN.code)!
  assert.ok(h72.stops.includes("Calle 127"), "su trazado sí pasa cerca")
  const c127 = data.stations.find((s) => s.name === "Calle 127")!
  h72.servedStops = [
    { ...CORRECCIONES_GTFS["8 G"].servedStops.find((p) => p.name === "Calle 127")! },
    { ...CORRECCIONES_GTFS["8 G"].servedStops[0] },
  ]
  aplicarEvidenciaGtfs(data.routes, data.stations)
  assert.equal(h72.servedStops.some((p) => p.name === c127.name), false)
  assert.equal(h72.servedStops.length, 1)
})

test("el normalizador conserva los ids de geometría y trazado de 8 G y 8 T", () => {
  const { stationsRaw, routesRaw } = arcgisDesdeCatalogo(["8 G", "8 T"])
  const vivo = normalizeTransmilenio(stationsRaw, routesRaw, "2026-11-04T00:00:00Z", "live")
  const guardado = TransmilenioDataSchema.parse(snapshot)
  for (const r of vivo.routes) {
    const c = guardado.routes.find((x) => x.code === r.code)!
    assert.equal(r.id, c.id)
    assert.deepEqual(r.stops, c.stops, "estaciones cercanas al trazado, en su orden original")
  }
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

  const bibliotecas = [
    { id: "6", name: "Biblioteca", lat: 0, lng: 0 },
    { id: "7", name: "Biblioteca Tintal", lat: 0, lng: 0 },
  ]
  assert.equal(fullStationName("Biblioteca", bibliotecas, ["Biblioteca Tintal"]), "Biblioteca", "gana el nombre exacto")
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
  assert.deepEqual(pathBetween(path, board, { lat: 4.635, lng: -74.1 }), path.slice(1, 3), "en el mismo tramo")
})
