import assert from "node:assert/strict"
import test from "node:test"
import { interpretCommand, runIntent } from "./local-agent"
import { nearestStations, planTrip, searchRoutes, type TransmilenioData } from "./routes"
import { datosVerificadosDirecto } from "./fixtures-sinteticas"
import type { LecturaUbicacion } from "./ubicacion"

/**
 * Regresión del issue #32: GPS y viajes se recuperan de un catálogo con CERO
 * estaciones sin lanzar excepción, y la procedencia (fuente/fecha) llega al
 * texto del asistente.
 */

/** Catálogo válido en forma pero sin estaciones ni rutas (recuperable, no roto). */
function catalogoVacio(source: TransmilenioData["source"] = "snapshot"): TransmilenioData {
  return { stations: [], routes: [], fetchedAt: "2026-11-04T10:00:00-05:00", source }
}

/** Lectura de ubicación FRESCA respecto a un instante dado (hora = ese instante). */
const lecturaEn = (lat: number, lng: number, now: Date, precision = 20): LecturaUbicacion => ({ lat, lng, precision, hora: now.getTime() })
const AHORA_FIJO = new Date("2026-11-04T10:00:00-05:00")
const POSICION = lecturaEn(4.65, -74.1, AHORA_FIJO)

test("nearestStations y planTrip no lanzan con cero estaciones", () => {
  const vacio = catalogoVacio()
  assert.deepEqual(nearestStations(POSICION, vacio, 4), [])
  assert.deepEqual(searchRoutes("B23", vacio), [])
  // planTrip necesita lugares; con cero estaciones no hay lugares, pero la
  // función tampoco debe lanzar al recorrer rutas vacías.
  assert.deepEqual(planTrip({ origin: { name: "x", stations: [] }, destination: { name: "y", stations: [] } }, vacio), [])
})

test("el asistente responde al GPS sin estaciones sin lanzar", () => {
  const vacio = catalogoVacio()
  const reply = runIntent({ type: "gps" }, { data: vacio, context: { position: POSICION, now: AHORA_FIJO } })
  assert.equal(reply.action, "gps", "abre el GPS para reintentar")
  assert.match(reply.reply, /Todavía no tengo las estaciones/)
})

test("«donde estoy» por lenguaje natural con catálogo vacío no lanza", () => {
  // Reproducción de corroboración: interpretCommand con catálogo vacío y posición
  // debía arrojar «Cannot read properties of undefined (reading name)».
  const vacio = catalogoVacio()
  const reply = interpretCommand("donde estoy", vacio, { position: POSICION, now: AHORA_FIJO })
  assert.equal(reply.action, "gps")
  assert.match(reply.reply, /Todavía no tengo las estaciones/)
})

test("el asistente responde a un viaje sin estaciones sin lanzar", () => {
  const vacio = catalogoVacio()
  // Rama trip directa con ubicación y sin estaciones: no debe lanzar al intentar
  // usar la ubicación como origen ni al no encontrar el destino.
  const porIntent = runIntent(
    { type: "trip", destination: "Calle 72" },
    { data: vacio, context: { position: POSICION, now: new Date("2026-11-04T10:00:00-05:00") } },
  )
  assert.equal(porIntent.action, "none")
  assert.match(porIntent.reply, /No encontré la estación/)

  // Y por lenguaje natural: sin estaciones no hay menciones, así que responde de
  // forma recuperable (sin excepción), aunque el texto sea el de "no te entendí".
  const porTexto = interpretCommand("cómo llego de Ricaurte a Calle 72", vacio, { position: POSICION })
  assert.equal(porTexto.action, "none")
})

test("la procedencia en vivo llega al texto de una respuesta con datos", () => {
  const fx: TransmilenioData = { ...datosVerificadosDirecto(), source: "live", fetchedAt: "2026-11-04T10:00:00-05:00" }
  const reply = interpretCommand("cómo llego de Alfa a Eco", fx, { now: new Date("2026-11-04T10:00:00-05:00") })
  assert.ok(reply.action === "trip")
  assert.match(reply.reply, /Datos de TransMilenio consultados el/)
})

test("la procedencia de la copia guardada se anuncia como tal", () => {
  // Las fixtures vienen con source "snapshot".
  const fx = datosVerificadosDirecto()
  const reply = interpretCommand("cómo llego de Alfa a Eco", fx, { now: new Date("2026-11-04T10:00:00-05:00") })
  assert.ok(reply.action === "trip")
  assert.match(reply.reply, /copia guardada de TransMilenio/)
  assert.match(reply.reply, /sin conexión al servicio en vivo/)
})

test("un saludo no lleva procedencia (no presenta datos del catálogo)", () => {
  const fx = datosVerificadosDirecto()
  const reply = interpretCommand("hola", fx)
  assert.equal(reply.action, "none")
  assert.doesNotMatch(reply.reply, /copia guardada|Datos de TransMilenio/)
})

test("la info de ruta lleva procedencia", () => {
  const fx: TransmilenioData = { ...datosVerificadosDirecto(), source: "live", fetchedAt: "2026-11-04T10:00:00-05:00" }
  const reply = runIntent({ type: "route_info", routeCode: "V1" }, { data: fx })
  assert.equal(reply.action, "route")
  assert.match(reply.reply, /Datos de TransMilenio consultados el/)
})


test("el GPS con estación concreta cita procedencia; abrir el GPS a secas no", () => {
  const fx: TransmilenioData = { ...datosVerificadosDirecto(), source: "live", fetchedAt: "2026-11-04T10:00:00-05:00" }
  // Alfa está en 4.60,-74.08; una posición cercana da estación más cercana.
  const conEstacion = runIntent({ type: "gps" }, { data: fx, context: { position: lecturaEn(4.601, -74.08, AHORA_FIJO), now: AHORA_FIJO } })
  assert.equal(conEstacion.action, "gps")
  assert.match(conEstacion.reply, /La estación más cercana es/)
  assert.match(conEstacion.reply, /Datos de TransMilenio consultados el/)

  // Sin posición solo se abre el GPS: no se precisa fecha del catálogo.
  const soloAbrir = runIntent({ type: "gps" }, { data: fx })
  assert.doesNotMatch(soloAbrir.reply, /consultados el|copia guardada/)
})
