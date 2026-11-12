import assert from "node:assert/strict"
import test from "node:test"
import { catalogoCongelado, corpus, huellaDeArchivo, huellaDeTexto, percentil, puntuar, resumir, type Esperado, type Medicion } from "./ea27-evaluacion"
import { shortName } from "./routes"
import { ESTACIONES_METRO_L1 } from "./metro"
import type { Intent } from "./local-agent"

/**
 * EA-27 (#53): el corpus congelado y la puntuación de la evaluación.
 */
const data = catalogoCongelado()
/**
 * Huella del corpus congelado. Si esta prueba falla, el corpus cambió: sube
 * `version` en el archivo, actualiza esta constante y vuelve a correr la
 * evaluación; los resultados anteriores ya no son comparables.
 */
const HUELLA_CORPUS = "f4cf24fcf011f6e6f5f5e2f37e2ccefd978c3a81419c18cc86c1fe22aaa3cec2"

// ── Corpus ──

test("corpus: de 60 a 100 ítems, ids únicos y turnos 2 que apuntan a un turno 1", () => {
  assert.ok(corpus.items.length >= 60 && corpus.items.length <= 100, `hay ${corpus.items.length}`)
  const ids = new Set(corpus.items.map((i) => i.id))
  assert.equal(ids.size, corpus.items.length)
  for (const i of corpus.items) {
    if (i.tras) assert.ok(ids.has(i.tras) && i.turno === 2, `${i.id}: «tras» inválido`)
  }
})

test("corpus: la huella coincide con la congelada", () => {
  assert.equal(huellaDeArchivo("ea27-corpus.json"), HUELLA_CORPUS)
})

test("huella: un archivo con CRLF (Windows con autocrlf) da la misma huella que con LF", () => {
  assert.equal(huellaDeTexto("{\r\n  \"a\": 1\r\n}\r\n"), huellaDeTexto("{\n  \"a\": 1\n}\n"))
  assert.notEqual(huellaDeTexto("a\n"), huellaDeTexto("b\n"))
})

test("corpus: toda entidad de referencia existe en el catálogo, por nombre y sin pasar por el intérprete", () => {
  // Nombre corto (lo que dice la gente) o nombre completo de alguna estación.
  const nombres = new Set(data.stations.flatMap((s) => [s.name, shortName(s.name)]))
  const codigos = new Set(data.routes.map((r) => r.code))
  for (const i of corpus.items) {
    const { origin, destination, routeCode, clave, claves } = i.esperado
    for (const nombre of [origin, destination]) {
      if (nombre) assert.ok(nombres.has(nombre), `${i.id}: lugar «${nombre}»`)
    }
    if (routeCode) assert.ok(codigos.has(routeCode), `${i.id}: ruta ${routeCode}`)
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
const esperadoViaje: Esperado = { intent: "trip", origin: "Ricaurte", destination: "Calle 72" }

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
  const esperado: Esperado = { intent: "trip", destination: "Ricaurte", origenFueraDelCatalogo: true, aclara: true }
  const bien = puntuar(esperado, viaje("narnia", "Ricaurte"), data)
  assert.deepEqual([bien.ok, bien.pidioAclaracion], [true, true])
  assert.equal(puntuar(esperado, viaje("Nariño", "Ricaurte"), data).ok, false)
  assert.equal(puntuar(esperado, viaje(undefined, "Ricaurte"), data).ok, false)
})

test("puntuar: viaje sin destino y consultas del Metro", () => {
  assert.equal(puntuar({ intent: "trip_missing_destination", origin: "Ricaurte", aclara: true }, { type: "trip_missing_destination", origin: "Ricaurte" }, data).ok, true)
  const metro = (consulta: Extract<Intent, { type: "metro" }>["consulta"]): Intent => ({ type: "metro", consulta })
  const esperado: Esperado = { intent: "metro", tipo: "servicio", tema: "viaje" }
  assert.equal(puntuar(esperado, metro({ tipo: "servicio", tema: "viaje" }), data).ok, true)
  assert.equal(puntuar(esperado, metro({ tipo: "servicio", tema: "tarifa" }), data).ok, false)
  assert.equal(puntuar({ intent: "metro", tipo: "linea", linea: 2 }, metro({ tipo: "linea", linea: 1 }), data).ok, false)
})

// ── Resumen ──

const medicion = (id: string, categoria: string, ok: boolean, ms: number): Medicion => ({
  id,
  categoria,
  esperado: { intent: "gps" },
  puntuacion: { intentOk: ok, entidadesOk: ok, aclaraOk: null, pidioAclaracion: false, cancelo: false, ok },
  ms,
})

test("percentil: rango más cercano", () => {
  const valores = [5, 1, 4, 2, 3, 6, 7, 8, 9, 10]
  assert.equal(percentil(valores, 50), 5)
  assert.equal(percentil(valores, 95), 10)
})

test("resumir: cancelaciones acertadas y sobrantes", () => {
  const cancela = (id: string, esperaCancelar: boolean, cancelo: boolean): Medicion => ({
    ...medicion(id, "cancelacion", esperaCancelar === cancelo, 1),
    esperado: { intent: esperaCancelar ? "cancel" : "gps" },
    puntuacion: { intentOk: true, entidadesOk: true, aclaraOk: null, pidioAclaracion: false, cancelo, ok: esperaCancelar === cancelo },
  })
  const r = resumir([cancela("a", true, true), cancela("b", true, false), cancela("c", false, true), cancela("d", false, false)])
  assert.deepEqual(r.cancelaciones, { esperadas: 2, acertadas: 1, sobrantes: 1 })
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
