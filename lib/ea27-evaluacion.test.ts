import assert from "node:assert/strict"
import test from "node:test"
import { catalogoCongelado, corpus, percentil, puntuar, resumir, type Medicion } from "./ea27-evaluacion"
import { findPlaces, findRouteByCode } from "./routes"
import { ESTACIONES_METRO_L1 } from "./metro"
import type { Intent } from "./local-agent"

/**
 * EA-27 (#53): el corpus congelado y la puntuación de la evaluación.
 */
const data = catalogoCongelado()
const INTENCIONES = ["greeting", "help", "cancel", "gps", "frequent", "route_info", "schedule", "trip", "trip_missing_destination", "unsupported", "metro", "unknown"]

// ── Corpus ──

test("corpus: de 60 a 100 ítems, ids únicos y turnos 2 que apuntan a un turno 1", () => {
  assert.ok(corpus.items.length >= 60 && corpus.items.length <= 100, `hay ${corpus.items.length}`)
  const ids = new Set(corpus.items.map((i) => i.id))
  assert.equal(ids.size, corpus.items.length)
  for (const i of corpus.items) {
    assert.ok(INTENCIONES.includes(i.esperado.intent), `${i.id}: intención ${i.esperado.intent}`)
    if (i.tras) assert.ok(ids.has(i.tras) && i.turno === 2, `${i.id}: «tras» inválido`)
  }
})

test("corpus: toda entidad de referencia existe en el catálogo", () => {
  for (const i of corpus.items) {
    const { origin, destination, routeCode, clave, claves } = i.esperado
    for (const nombre of [origin, destination]) {
      if (nombre) assert.equal(findPlaces(nombre, data)[0]?.name, nombre, `${i.id}: lugar «${nombre}»`)
    }
    if (routeCode) assert.equal(findRouteByCode(routeCode, data)?.code, routeCode, `${i.id}: ruta ${routeCode}`)
    for (const c of [clave, ...(claves ?? [])]) {
      if (c) assert.ok(ESTACIONES_METRO_L1.some((e) => e.clave === c), `${i.id}: estación del Metro ${c}`)
    }
  }
})

test("corpus: cubre las categorías pedidas y marca los fallos citados en #53", () => {
  const categorias = new Set(corpus.items.map((i) => i.categoria))
  for (const c of ["rutas", "gps", "ambiguo", "horarios", "metro", "avisos", "aclaracion", "cancelacion", "fuera_de_dominio"]) assert.ok(categorias.has(c), c)
  const frases = corpus.items.filter((i) => i.falloConocido).map((i) => i.frase)
  for (const f of [
    "oye, ¿qué buses me sirven para moverme hacia el norte de la ciudad?",
    "¿hay algo que me deje en las aguas?",
    "mi destino es el portal eldorado, salgo del museo nacional",
  ]) {
    assert.ok(frases.includes(f), f)
  }
})

// ── Puntuación ──

const viaje = (origin: string | undefined, destination: string): Intent => ({ type: "trip", origin, destination })
const esperadoViaje = { intent: "trip", origin: "Ricaurte", destination: "Calle 72" }

test("puntuar: viaje acertado, con origen y destino invertidos, con origen inventado y sin origen", () => {
  assert.equal(puntuar(esperadoViaje, viaje("Ricaurte", "Calle 72"), data).ok, true)
  assert.equal(puntuar(esperadoViaje, viaje("Calle 72", "Ricaurte"), data).ok, false)
  assert.equal(puntuar(esperadoViaje, viaje(undefined, "Calle 72"), data).ok, false)
  assert.equal(puntuar(esperadoViaje, viaje("Ricaurte", "Portal Norte"), data).ok, false)
  assert.equal(puntuar({ intent: "trip", destination: "Calle 72" }, viaje(undefined, "Calle 72"), data).ok, true)
  // Un origen que el modelo inventó cuando la persona no dijo ninguno.
  assert.equal(puntuar({ intent: "trip", destination: "Calle 72" }, viaje("Ricaurte", "Calle 72"), data).ok, false)
})

test("puntuar: la intención correcta con otra entidad no cuenta", () => {
  const p = puntuar({ intent: "schedule", routeCode: "B23" }, { type: "schedule", routeCode: "H54" }, data)
  assert.deepEqual([p.intentOk, p.entidadesOk, p.ok], [true, false, false])
  assert.equal(puntuar({ intent: "unsupported", topic: "tarifas" }, { type: "unsupported", topic: "tiempo_real" }, data).ok, false)
  assert.equal(puntuar({ intent: "unknown" }, { type: "trip", destination: "Portal Norte" }, data).ok, false)
})

test("puntuar: origen fuera del catálogo exige conservarlo, no cambiarlo por una estación", () => {
  const esperado = { intent: "trip", destination: "Ricaurte", origenFueraDelCatalogo: true, aclara: true }
  const bien = puntuar(esperado, viaje("narnia", "Ricaurte"), data)
  assert.deepEqual([bien.ok, bien.pidioAclaracion], [true, true])
  assert.equal(puntuar(esperado, viaje("Nariño", "Ricaurte"), data).ok, false)
  assert.equal(puntuar(esperado, viaje(undefined, "Ricaurte"), data).ok, false)
})

test("puntuar: viaje sin destino y consultas del Metro", () => {
  assert.equal(puntuar({ intent: "trip_missing_destination", origin: "Ricaurte", aclara: true }, { type: "trip_missing_destination", origin: "Ricaurte" }, data).ok, true)
  const metro = (consulta: Extract<Intent, { type: "metro" }>["consulta"]): Intent => ({ type: "metro", consulta })
  const esperado = { intent: "metro", tipo: "servicio", tema: "viaje" }
  assert.equal(puntuar(esperado, metro({ tipo: "servicio", tema: "viaje" }), data).ok, true)
  assert.equal(puntuar(esperado, metro({ tipo: "servicio", tema: "tarifa" }), data).ok, false)
  assert.equal(puntuar({ intent: "metro", tipo: "linea", linea: 2 }, metro({ tipo: "linea", linea: 1 }), data).ok, false)
})

// ── Resumen ──

const medicion = (id: string, categoria: string, ok: boolean, ms: number): Medicion => ({
  id,
  categoria,
  esperado: { intent: "gps" },
  puntuacion: { intentOk: ok, entidadesOk: ok, aclaraOk: null, pidioAclaracion: false, ok },
  ms,
})

test("percentil: rango más cercano", () => {
  const valores = [5, 1, 4, 2, 3, 6, 7, 8, 9, 10]
  assert.equal(percentil(valores, 50), 5)
  assert.equal(percentil(valores, 95), 10)
})

test("resumir: exactitud por categoría, errores y latencia", () => {
  const r = resumir([
    medicion("a", "gps", true, 1),
    medicion("b", "gps", false, 2),
    medicion("c", "rutas", true, 3),
    { ...medicion("d", "rutas", false, 4), puntuacion: null, error: "Ollama: HTTP 500" },
  ])
  assert.equal(r.exactitud, 0.5)
  assert.deepEqual(r.porCategoria.gps, { n: 2, ok: 1, exactitud: 0.5 })
  assert.deepEqual(r.porCategoria.rutas, { n: 2, ok: 1, exactitud: 0.5 })
  assert.deepEqual(r.errores, [{ id: "d", error: "Ollama: HTTP 500" }])
  assert.deepEqual(r.latenciaMs, { p50: 2, p95: 4, max: 4 })
})
