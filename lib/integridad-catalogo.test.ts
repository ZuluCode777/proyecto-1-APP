import assert from "node:assert/strict"
import test from "node:test"
import snapshot from "../data/transmilenio.json" with { type: "json" }
import {
  motivoCatalogoNoUsable,
  motivoRespuestaArcgisIncompleta,
  normalizeTransmilenio,
  procedenciaCatalogo,
  TransmilenioDataSchema,
  type TransmilenioData,
} from "./transmilenio"

/**
 * Regresión del issue #32: integridad del catálogo en el límite y procedencia.
 * `motivoCatalogoNoUsable` es la guardia que impide que una respuesta vacía,
 * parcial o con referencias inválidas reemplace al último catálogo válido.
 */

const copia = TransmilenioDataSchema.parse(snapshot) as TransmilenioData

test("el catálogo publicado es íntegro", () => {
  assert.equal(motivoCatalogoNoUsable(copia), null)
})

test("un catálogo sin estaciones o sin rutas no es usable", () => {
  assert.match(motivoCatalogoNoUsable({ ...copia, stations: [] }) ?? "", /no trae estaciones/)
  assert.match(motivoCatalogoNoUsable({ ...copia, routes: [] }) ?? "", /no trae rutas/)
})

test("una ruta sin recorrido dibujable no es usable", () => {
  const roto: TransmilenioData = {
    ...copia,
    routes: [{ ...copia.routes[0], path: [[4.6, -74.1]] }],
  }
  assert.match(motivoCatalogoNoUsable(roto) ?? "", /no trae un recorrido dibujable/)
})

test("una ruta que referencia una estación inexistente no es usable", () => {
  const roto: TransmilenioData = {
    ...copia,
    routes: [{ ...copia.routes[0], stops: ["Estación Fantasma"], path: copia.routes[0].path }],
    stations: copia.stations,
  }
  assert.match(motivoCatalogoNoUsable(roto) ?? "", /estación inexistente/)
})

// Respuestas ArcGIS mínimas con la forma real del servicio.
const stationsRaw = {
  features: [
    { attributes: { num_est: "1", nom_est: "Norte" }, geometry: { x: -74.05, y: 4.7 } },
    { attributes: { num_est: "2", nom_est: "Centro" }, geometry: { x: -74.05, y: 4.65 } },
  ],
}
const routesRaw = {
  features: [
    {
      attributes: { cod_ruta: "X1", orig_ruta: "Centro", dest_ruta: "Norte", hor_habil: "" },
      geometry: { paths: [[[-74.05, 4.64], [-74.05, 4.71]]] },
    },
  ],
}

test("una respuesta ArcGIS vacía de estaciones produce un catálogo no usable", () => {
  const data = normalizeTransmilenio({ features: [] }, routesRaw, "2026-11-04T00:00:00Z", "live")
  assert.equal(data.stations.length, 0)
  assert.match(motivoCatalogoNoUsable(data) ?? "", /no trae estaciones/)
})

test("una respuesta ArcGIS sin rutas produce un catálogo no usable", () => {
  const data = normalizeTransmilenio(stationsRaw, { features: [] }, "2026-11-04T00:00:00Z", "live")
  assert.ok(data.stations.length > 0)
  assert.match(motivoCatalogoNoUsable(data) ?? "", /no trae rutas/)
})

test("una respuesta ArcGIS mínima pero coherente SÍ es usable (no se asume 124)", () => {
  // Fixtures sintéticas legítimas: dos estaciones y una ruta deben pasar.
  const data = normalizeTransmilenio(stationsRaw, routesRaw, "2026-11-04T00:00:00Z", "live")
  assert.equal(motivoCatalogoNoUsable(data), null)
  assert.equal(data.routes.length, 1)
})

test("la procedencia distingue el servicio en vivo de la copia guardada", () => {
  const vivo = procedenciaCatalogo({ source: "live", fetchedAt: "2026-11-04T10:00:00-05:00" })
  const guardado = procedenciaCatalogo({ source: "snapshot", fetchedAt: "2026-09-24T10:00:00-05:00" })
  assert.match(vivo, /Datos de TransMilenio consultados el/)
  assert.doesNotMatch(vivo, /copia guardada/)
  assert.match(guardado, /copia guardada de TransMilenio/)
  assert.match(guardado, /sin conexión al servicio en vivo/)
})

test("la procedencia tolera una fecha inválida sin romper", () => {
  assert.match(procedenciaCatalogo({ source: "live", fetchedAt: "no-es-fecha" }), /fecha desconocida/)
})


test("una parada atendida que referencia una estación inexistente no es usable", () => {
  const roto = structuredClone(copia)
  roto.routes.find((r) => r.servedStops.length)!.servedStops[0].name = "INEXISTENTE"
  assert.match(motivoCatalogoNoUsable(roto) ?? "", /atiende una estación inexistente/)
})

test("una parada atendida sin procedencia (fuente o fecha) no es usable", () => {
  for (const campo of ["source", "date"] as const) {
    const roto = structuredClone(copia)
    roto.routes.find((r) => r.servedStops.length)!.servedStops[0][campo] = ""
    assert.match(motivoCatalogoNoUsable(roto) ?? "", /sin procedencia/)
  }
})

test("un nodeId numérico que no coincide con el id de la estación no es usable", () => {
  const roto = structuredClone(copia)
  const parada = roto.routes.find((r) => r.servedStops.length)!.servedStops[0]
  parada.nodeId = "99999999"
  assert.match(motivoCatalogoNoUsable(roto) ?? "", /nodo .* no coincide/)
})

test("la identidad del nodo rechaza valores ilegibles y conserva ceros iniciales", () => {
  for (const nodo of ["ilegible", "", "-2502", "2.502e3"]) {
    const roto = structuredClone(copia)
    roto.routes.find((r) => r.servedStops.length)!.servedStops[0].nodeId = nodo
    assert.match(motivoCatalogoNoUsable(roto) ?? "", /nodo .* no coincide/)
  }
  const valido = structuredClone(copia)
  const parada = valido.routes.find((r) => r.servedStops.length)!.servedStops[0]
  parada.nodeId = `0${parada.nodeId}`
  assert.equal(motivoCatalogoNoUsable(valido), null)
})

test("un catálogo o una parada sin fecha válida no reemplazan datos buenos", () => {
  assert.match(motivoCatalogoNoUsable({ ...copia, fetchedAt: "sin-fecha" }) ?? "", /fecha de consulta válida/)
  const roto = structuredClone(copia)
  roto.routes.find((r) => r.servedStops.length)!.servedStops[0].date = "sin-fecha"
  assert.match(motivoCatalogoNoUsable(roto) ?? "", /sin procedencia válida/)
})

test("nombres de estación duplicados con ids distintos son legítimos (no invalidan)", () => {
  // La copia real tiene un nombre de estación duplicado con id distinto.
  const porNombre = new Map<string, Set<string>>()
  for (const s of copia.stations) (porNombre.get(s.name) ?? porNombre.set(s.name, new Set()).get(s.name)!).add(s.id)
  const duplicados = [...porNombre.values()].filter((ids) => ids.size > 1)
  assert.ok(duplicados.length > 0, "el fixture real debe tener al menos un nombre duplicado")
  assert.equal(motivoCatalogoNoUsable(copia), null, "los duplicados legítimos no invalidan el catálogo")
})

// Respuestas crudas ArcGIS: validación de claves solicitadas y geometría.
const estacionesOk = {
  features: [
    { attributes: { num_est: "1", nom_est: "Norte" }, geometry: { x: -74.05, y: 4.7 } },
    { attributes: { num_est: "2", nom_est: "Centro" }, geometry: { x: -74.05, y: 4.65 } },
  ],
}
const rutaCruda = (code: string) => ({
  attributes: { cod_ruta: code, orig_ruta: "Centro", dest_ruta: "Norte", hor_habil: "" },
  geometry: { paths: [[[-74.05, 4.64], [-74.05, 4.71]]] },
})

test("respuesta cruda completa pasa la validación de integridad", () => {
  assert.equal(motivoRespuestaArcgisIncompleta(estacionesOk, { features: [rutaCruda("X1")] }), null)
})

test("una ruta cruda sin cod_ruta (clave solicitada ausente) se rechaza", () => {
  const rutas = { features: [rutaCruda("X1"), { attributes: { orig_ruta: "Centro", dest_ruta: "Norte" }, geometry: { paths: [[[-74, 4.6], [-74, 4.7]]] } }] }
  assert.match(motivoRespuestaArcgisIncompleta(estacionesOk, rutas) ?? "", /sin el atributo solicitado cod_ruta/)
})

test("una ruta cruda con cod_ruta pero sin geometría se rechaza", () => {
  const rutas = { features: [rutaCruda("X1"), { attributes: { cod_ruta: "X2" } }] }
  assert.match(motivoRespuestaArcgisIncompleta(estacionesOk, rutas) ?? "", /sin geometría de recorrido/)
})

test("identificadores nulos o vacíos no se descartan como si la respuesta estuviera completa", () => {
  for (const valor of [null, "", "   "]) {
    for (const campo of ["num_est", "nom_est"]) {
      const estaciones = structuredClone(estacionesOk)
      Object.assign(estaciones.features[0].attributes, { [campo]: valor })
      assert.notEqual(motivoRespuestaArcgisIncompleta(estaciones, { features: [rutaCruda("X1")] }), null)
    }
    const ruta = rutaCruda("X1")
    Object.assign(ruta.attributes, { cod_ruta: valor })
    assert.notEqual(motivoRespuestaArcgisIncompleta(estacionesOk, { features: [ruta] }), null)
  }
})

test("una estación cruda sin atributos solicitados o sin punto se rechaza", () => {
  const sinAttr = { features: [{ attributes: { num_est: "1" }, geometry: { x: -74, y: 4.6 } }] }
  assert.match(motivoRespuestaArcgisIncompleta(sinAttr, { features: [rutaCruda("X1")] }) ?? "", /num_est\/nom_est/)
  const sinPunto = { features: [{ attributes: { num_est: "1", nom_est: "Norte" }, geometry: null }] }
  assert.match(motivoRespuestaArcgisIncompleta(sinPunto, { features: [rutaCruda("X1")] }) ?? "", /sin punto de geometría/)
})

test("un horario null y un código duplicado NO se rechazan (incompletitud legítima)", () => {
  // hor_habil ausente es nullable legítimo; un código duplicado se deduplica en
  // el normalizador, no se rechaza en la frontera cruda.
  const rutas = {
    features: [
      { attributes: { cod_ruta: "X1", orig_ruta: "Centro", dest_ruta: "Norte" }, geometry: { paths: [[[-74.05, 4.64], [-74.05, 4.71]]] } },
      rutaCruda("X1"),
    ],
  }
  assert.equal(motivoRespuestaArcgisIncompleta(estacionesOk, rutas), null, "clave presente aunque el valor falte, y duplicado permitido")
  const normal = normalizeTransmilenio(estacionesOk, rutas, "2026-11-04T00:00:00Z", "live")
  assert.equal(normal.routes.length, 1, "el código duplicado se deduplica a una ruta")
  assert.equal(motivoCatalogoNoUsable(normal), null)
})
