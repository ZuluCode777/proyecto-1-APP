import assert from "node:assert/strict"
import test from "node:test"
import {
  calendarioOperaEnFecha,
  fechaCivilEnZona,
  fechaEvidenciaVigente,
  paradaPrescriptible,
  rutaConParadasVerificadas,
  secuenciaAtendidaValida,
} from "./evidencia"
import { datosConCalendario, datosVerificadosDirecto, FUENTE_PRUEBA } from "./fixtures-sinteticas"
import type { ServedStop } from "./transmilenio"

const AHORA = new Date("2026-11-04T10:00:00-05:00")

const parada = (over: Partial<ServedStop> = {}): ServedStop => ({
  name: "Alfa",
  order: 0,
  canBoard: true,
  canAlight: true,
  source: FUENTE_PRUEBA,
  date: "2026-11-04",
  status: "operativa",
  ...over,
})

test("fechaEvidenciaVigente rechaza vacío, inválida, futura y vencida", () => {
  assert.equal(fechaEvidenciaVigente("", AHORA), false)
  assert.equal(fechaEvidenciaVigente("no-es-fecha", AHORA), false)
  assert.equal(fechaEvidenciaVigente("2999-01-01", AHORA), false, "futura")
  assert.equal(fechaEvidenciaVigente("1900-01-01", AHORA), false, "vencida")
  assert.equal(fechaEvidenciaVigente("2026-11-03", AHORA), true)
})

test("paradaPrescriptible exige fuente, estado operativo y fecha vigente", () => {
  assert.equal(paradaPrescriptible(parada(), AHORA), true)
  assert.equal(paradaPrescriptible(parada({ source: "" }), AHORA), false, "fuente vacía")
  assert.equal(paradaPrescriptible(parada({ status: "sin-verificar" }), AHORA), false)
  assert.equal(paradaPrescriptible(parada({ status: "suspendida" }), AHORA), false)
  assert.equal(paradaPrescriptible(parada({ date: "" }), AHORA), false)
  assert.equal(paradaPrescriptible(parada({ date: "2999-01-01" }), AHORA), false)
  assert.equal(paradaPrescriptible(parada({ date: "1900-01-01" }), AHORA), false)
})

test("secuenciaAtendidaValida rechaza órdenes duplicados o secuencia de una parada", () => {
  assert.equal(secuenciaAtendidaValida([parada({ order: 0 }), parada({ name: "Bravo", order: 1 })]), true)
  assert.equal(
    secuenciaAtendidaValida([parada({ order: 0 }), parada({ name: "Bravo", order: 0 })]),
    false,
    "órdenes duplicados",
  )
  assert.equal(secuenciaAtendidaValida([parada({ order: 0 })]), false, "una sola parada")
})

test("rutaConParadasVerificadas combina secuencia válida y parada prescriptible", () => {
  assert.equal(rutaConParadasVerificadas(datosVerificadosDirecto().routes[0], AHORA), true)

  // Evidencia basura: fuente vacía y fechas inválidas no habilitan.
  for (const date of ["", "no-es-fecha", "1900-01-01", "2999-01-01"]) {
    const fx = datosVerificadosDirecto()
    fx.routes[0].servedStops = fx.routes[0].servedStops.map((s) => ({ ...s, source: "", date }))
    assert.equal(rutaConParadasVerificadas(fx.routes[0], AHORA), false, `date=${date}`)
  }

  // Órdenes duplicados hacen abstener aunque la fecha sea válida.
  const dup = datosVerificadosDirecto()
  dup.routes[0].servedStops[1].order = 0
  assert.equal(rutaConParadasVerificadas(dup.routes[0], AHORA), false)
})

test("calendarioOperaEnFecha aplica ventana, día de semana y excepciones en Bogotá", () => {
  const cal = datosConCalendario().routes[0].verifiedCalendar!
  // 2026-11-04 es miércoles: opera.
  assert.equal(calendarioOperaEnFecha(cal, new Date("2026-11-04T10:00:00-05:00")), true)
  // 2026-11-08 es domingo: no opera (solo L-V).
  assert.equal(calendarioOperaEnFecha(cal, new Date("2026-11-08T10:00:00-05:00")), false)
  // 2026-11-02 está en removedDates: no opera aunque sea lunes.
  assert.equal(calendarioOperaEnFecha(cal, new Date("2026-11-02T10:00:00-05:00")), false)
  // Fuera de ventana de vigencia.
  assert.equal(calendarioOperaEnFecha(cal, new Date("2027-01-05T10:00:00-05:00")), false)
  // Sin calendario, nunca afirma operación.
  assert.equal(calendarioOperaEnFecha(undefined, AHORA), false)
})

test("fechaCivilEnZona respeta la zona de Bogotá en el borde de día", () => {
  // 2026-11-05T02:00Z es 2026-11-04 21:00 en Bogotá (UTC-5).
  assert.equal(fechaCivilEnZona(new Date("2026-11-05T02:00:00Z"), "America/Bogota"), "2026-11-04")
})
