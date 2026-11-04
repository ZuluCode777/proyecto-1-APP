import assert from "node:assert/strict"
import test from "node:test"
import snapshot from "../data/transmilenio.json" with { type: "json" }
import {
  calendarioOperaEnFecha,
  estadoCalendarioEnFecha,
  estadoOperacionEnParada,
  fechaCivilEnZona,
  fechaEvidenciaVigente,
  paradaCoincideConEstacion,
  paradaPrescriptible,
  paradasPrescriptibles,
  rutaConParadasVerificadas,
  secuenciaAtendidaValida,
  sentidoConfirmado,
} from "./evidencia"
import { calendarioSintetico, datosVerificadosDirecto, FUENTE_PRUEBA } from "./fixtures-sinteticas"
import { TransmilenioDataSchema, type ServedStop } from "./transmilenio"

const AHORA = new Date("2026-11-04T10:00:00-05:00")
const real = TransmilenioDataSchema.parse(snapshot)
const ochoG = real.routes.find((r) => r.code === "8 G")!
const ochoT = real.routes.find((r) => r.code === "8 T")!
const calReal = ochoG.verifiedCalendar!
const terminalG = ochoG.servedStops.find((s) => s.name === "Terminal")!
// Calendario real con la fecha de evidencia movida, para ejercitar festivos de
// antes o después de la fecha en que se extrajo (la política rechazaría los demás).
const calReal01 = { ...calReal, date: "2026-11-01" }
const calReal12 = { ...calReal, date: "2026-12-01" }
const calle100T = ochoT.servedStops.find((s) => s.name === "Calle 100 - Marketmedios")!

const parada = (over: Partial<ServedStop> = {}): ServedStop => ({
  name: "Alfa",
  order: 0,
  canBoard: true,
  canAlight: true,
  source: FUENTE_PRUEBA,
  date: "2026-11-04",
  status: "operativa",
  franjas: [],
  conteoExacto: false,
  ...over,
})

test("fechaEvidenciaVigente rechaza vacío, inválida, imposible, futura y vencida", () => {
  assert.equal(fechaEvidenciaVigente("", AHORA), false)
  assert.equal(fechaEvidenciaVigente("no-es-fecha", AHORA), false)
  assert.equal(fechaEvidenciaVigente("2026-02-30", AHORA), false, "fecha imposible que Date.parse normalizaría")
  assert.equal(fechaEvidenciaVigente("2999-01-01", AHORA), false, "futura")
  assert.equal(fechaEvidenciaVigente("1900-01-01", AHORA), false, "vencida")
  assert.equal(fechaEvidenciaVigente("2026-11-03", AHORA), true)
  assert.equal(fechaEvidenciaVigente(undefined, AHORA), false)
  assert.equal(fechaEvidenciaVigente("2026-11-03", new Date("x")), false, "ahora inválido")
})

test("fechaEvidenciaVigente no acepta un timestamp futuro ni uno sin zona", () => {
  const ahora = new Date("2026-11-04T12:00:00Z")
  assert.equal(fechaEvidenciaVigente("2026-11-04T18:00:00Z", ahora), false, "6 h en el futuro")
  assert.equal(fechaEvidenciaVigente("2026-11-04T11:59:59Z", ahora), true)
  assert.equal(fechaEvidenciaVigente("2026-11-04T10:00:00", ahora), false, "sin zona la hora es ambigua")
  assert.equal(fechaEvidenciaVigente("2026-02-30T10:00:00Z", ahora), false)
})

test("fechaEvidenciaVigente usa el día de Bogotá y un máximo de 31 días", () => {
  // 2026-11-04T04:59:59Z son las 23:59:59 del 3 de noviembre en Bogotá.
  assert.equal(fechaEvidenciaVigente("2026-11-04", new Date("2026-11-04T04:59:59Z")), false)
  assert.equal(fechaEvidenciaVigente("2026-11-04", new Date("2026-11-04T05:00:00Z")), true)
  assert.equal(fechaEvidenciaVigente("2026-10-04", AHORA), true, "31 días")
  assert.equal(fechaEvidenciaVigente("2026-10-03", AHORA), false, "32 días")
})

test("paradaPrescriptible exige fuente, estado operativo y fecha vigente", () => {
  assert.equal(paradaPrescriptible(parada(), AHORA), true)
  assert.equal(paradaPrescriptible(parada({ source: "" }), AHORA), false, "fuente vacía")
  assert.equal(paradaPrescriptible(parada({ status: "sin-verificar" }), AHORA), false)
  assert.equal(paradaPrescriptible(parada({ status: "suspendida" }), AHORA), false)
  for (const date of ["", "2026-02-30", "2999-01-01", "1900-01-01", "2026-11-05T00:00:00Z"]) {
    assert.equal(paradaPrescriptible(parada({ date }), AHORA), false, `date=${date}`)
  }
})

test("secuenciaAtendidaValida rechaza órdenes duplicados o secuencia de una parada", () => {
  assert.equal(secuenciaAtendidaValida([parada({ order: 0 }), parada({ name: "Bravo", order: 1 })]), true)
  assert.equal(secuenciaAtendidaValida([parada({ order: 0 }), parada({ name: "Bravo", order: 5 })]), true, "huecos válidos")
  assert.equal(secuenciaAtendidaValida([parada({ order: 0 }), parada({ name: "Bravo", order: 0 })]), false)
  assert.equal(secuenciaAtendidaValida([parada({ order: 0 })]), false, "una sola parada")
  assert.equal(secuenciaAtendidaValida([parada({ order: 0 }), parada({ order: -1 })]), false)
})

test("paradaCoincideConEstacion compara el nodo numéricamente y rechaza el que contradice", () => {
  const terminal = real.stations.find((s) => s.name === "Terminal")!
  assert.equal(paradaCoincideConEstacion(parada({ name: "Terminal", nodeId: "2502" }), terminal), true, "02502 = 2502")
  assert.equal(paradaCoincideConEstacion(parada({ name: "Terminal", nodeId: "7201" }), terminal), false)
  assert.equal(paradaCoincideConEstacion(parada({ name: "Terminal", nodeId: "abc" }), terminal), false)
  assert.equal(paradaCoincideConEstacion(parada({ name: "Terminal" }), terminal), true, "sin nodo declarado, solo el nombre")
})

test("sentidoConfirmado exige verificado y consistente", () => {
  const ruta = datosVerificadosDirecto().routes[0]
  assert.equal(sentidoConfirmado(ruta), true)
  assert.equal(sentidoConfirmado({ ...ruta, directionEvidence: { ...ruta.directionEvidence, agreement: "contradictorio" } }), false)
  assert.equal(sentidoConfirmado({ ...ruta, directionEvidence: { ...ruta.directionEvidence, agreement: "indeterminado" } }), false)
  assert.equal(sentidoConfirmado({ ...ruta, directionEvidence: { ...ruta.directionEvidence, verified: false } }), false)
})

test("rutaConParadasVerificadas y paradasPrescriptibles evalúan cada parada", () => {
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

  // Una sola parada válida NO marca las demás como verificadas.
  const mixta = datosVerificadosDirecto()
  mixta.routes[0].servedStops[3].date = "1900-01-01"
  mixta.routes[0].servedStops[4].status = "suspendida"
  assert.deepEqual(
    paradasPrescriptibles(mixta.routes[0], AHORA).map((s) => s.name),
    ["Alfa", "Bravo", "Charlie"],
  )

  mixta.routes[0].servedStops[1].canBoard = false
  mixta.routes[0].servedStops[1].canAlight = false
  assert.deepEqual(paradasPrescriptibles(mixta.routes[0], AHORA).map((s) => s.name), ["Alfa", "Charlie"], "sin permiso de subir ni bajar no se marca como parada utilizable")

  // Sin sentido confirmado no hay paradas prescriptibles.
  const sentido = datosVerificadosDirecto()
  sentido.routes[0].directionEvidence = { agreement: "contradictorio", verified: false, note: "x" }
  assert.deepEqual(paradasPrescriptibles(sentido.routes[0], AHORA), [])
})

test("el calendario GTFS real de 8 G/8 T trae los tres servicios y los 19 festivos", () => {
  assert.deepEqual(
    calReal.servicios.map((s) => [s.serviceId, s.weekdays]),
    [["1", [1, 2, 3, 4, 5]], ["2", [6]], ["4", [0]]],
  )
  const [lv, sab, dom] = calReal.servicios
  assert.equal(lv.removedDates.length, 19)
  assert.deepEqual(lv.removedDates, sab.removedDates)
  assert.deepEqual(dom.addedDates, lv.removedDates)
  assert.ok(dom.addedDates.includes("2026-11-02") && dom.addedDates.includes("2026-11-16"))
  assert.deepEqual(ochoT.verifiedCalendar, calReal)
})

test("estadoCalendarioEnFecha: sábado, domingo, festivos y día normal operan con su servicio", () => {
  for (const fecha of ["2026-11-04", "2026-11-07", "2026-11-08", "2026-11-16"]) {
    assert.equal(estadoCalendarioEnFecha(calReal, new Date(`${fecha}T10:00:00-05:00`)), "opera", fecha)
  }
  for (const fecha of ["2026-11-02", "2026-12-25"]) {
    const cal = fecha === "2026-11-02" ? calReal01 : calReal12
    assert.equal(estadoCalendarioEnFecha(cal, new Date(`${fecha}T10:00:00-05:00`)), "opera", fecha)
  }
  assert.equal(estadoCalendarioEnFecha(calReal, new Date("2026-11-02T10:00:00-05:00")), "sin-verificar", "evidencia posterior al día")
  assert.equal(calendarioOperaEnFecha(calReal, new Date("2026-11-07T10:00:00-05:00")), true)
})

test("estadoCalendarioEnFecha: fuera de vigencia o malformado es sin-verificar, no «sin servicio»", () => {
  const ene = new Date("2027-01-05T10:00:00-05:00")
  assert.equal(estadoCalendarioEnFecha(calReal, ene), "sin-verificar", "después de endDate")
  assert.equal(estadoCalendarioEnFecha(undefined, AHORA), "sin-verificar")
  assert.equal(calendarioOperaEnFecha(calReal, ene), false)

  const malos: Record<string, (c: ReturnType<typeof calendarioSintetico>) => void> = {
    "fuente vacía": (c) => (c.source = ""),
    "zona inexistente": (c) => (c.timezone = "no-existe"),
    "zona vacía": (c) => (c.timezone = ""),
    "evidencia futura": (c) => (c.date = "2999-01-01"),
    "evidencia vencida": (c) => (c.date = "1900-01-01"),
    "inicio imposible": (c) => (c.startDate = "2026-02-30"),
    "fin anterior al inicio": (c) => (c.endDate = "2025-12-31"),
    "sin servicios": (c) => (c.servicios = []),
    "excepción ilegible": (c) => c.servicios[0].removedDates.push("no-fecha"),
    "día de semana inválido": (c) => c.servicios[0].weekdays.push(9),
  }
  for (const [caso, rompe] of Object.entries(malos)) {
    const cal = calendarioSintetico()
    rompe(cal)
    assert.equal(estadoCalendarioEnFecha(cal, AHORA), "sin-verificar", caso)
    assert.equal(calendarioOperaEnFecha(cal, AHORA), false, caso)
  }
  // Un calendario sano del fixture sí opera un día hábil, y dice «no-opera» un día sin servicio.
  assert.equal(estadoCalendarioEnFecha(calendarioSintetico(), AHORA), "opera")
  const sinDomingo = calendarioSintetico()
  sinDomingo.servicios = sinDomingo.servicios.filter((s) => s.serviceId !== "D")
  assert.equal(estadoCalendarioEnFecha(sinDomingo, new Date("2026-11-08T10:00:00-05:00")), "no-opera")
})

test("estadoOperacionEnParada: franja de Terminal en día hábil, con bordes", () => {
  const en = (iso: string) => estadoOperacionEnParada(calReal, terminalG, new Date(iso))
  assert.equal(en("2026-11-04T02:00:00-05:00"), "fuera-de-franja", "madrugada antes del primer bus")
  assert.equal(en("2026-11-04T04:29:59-05:00"), "fuera-de-franja")
  assert.equal(en("2026-11-04T04:30:00-05:00"), "en-franja")
  assert.equal(en("2026-11-04T23:00:00-05:00"), "en-franja")
  assert.equal(en("2026-11-04T23:00:01-05:00"), "fuera-de-franja", "después del último")
  // Borde UTC 05:00 = medianoche en Bogotá.
  assert.equal(en("2026-11-04T05:00:00Z"), "fuera-de-franja")
  assert.equal(en("2026-11-04T04:59:59Z"), "fuera-de-franja")
  // Sábado 23:00 aún cubierto; domingo termina a las 22:00.
  assert.equal(en("2026-11-07T23:00:00-05:00"), "en-franja")
  assert.equal(en("2026-11-08T22:00:00-05:00"), "en-franja")
  assert.equal(en("2026-11-08T22:00:01-05:00"), "fuera-de-franja")
})

test("estadoOperacionEnParada: festivo retirado y agregado usa el servicio de domingo", () => {
  // Lunes 2 de noviembre es festivo: se retira el servicio 1 y se agrega el 4.
  const en = (iso: string) => estadoOperacionEnParada(calReal01, terminalG, new Date(iso))
  assert.equal(en("2026-11-02T10:00:00-05:00"), "en-franja")
  assert.equal(en("2026-11-02T22:30:00-05:00"), "fuera-de-franja", "el lunes normal llegaría a las 23:00; el festivo, a las 22:00")
  assert.equal(en("2026-11-16T22:30:00-05:00"), "fuera-de-franja")
  assert.equal(en("2026-11-03T22:30:00-05:00"), "en-franja", "martes normal")
})

test("estadoOperacionEnParada: la cola de madrugada pertenece al día de servicio anterior", () => {
  const en = (iso: string) => estadoOperacionEnParada(calReal, calle100T, new Date(iso))
  // El jueves 5, 00:10 todavía es el servicio del miércoles (última salida 24:10:19).
  assert.equal(en("2026-11-05T00:10:00-05:00"), "en-franja")
  assert.equal(en("2026-11-05T00:11:00-05:00"), "fuera-de-franja")
  assert.equal(en("2026-11-04T05:00:00Z"), "en-franja", "00:00 del miércoles: aún corre el servicio del martes")
  // Domingo: la cola del sábado (24:09:54) no la hereda el festivo/domingo que termina antes.
  assert.equal(en("2026-11-08T00:05:00-05:00"), "en-franja", "cola del sábado")
  assert.equal(en("2026-11-09T00:05:00-05:00"), "fuera-de-franja", "el domingo termina a las 23:07")
})

test("estadoOperacionEnParada: sin franja, calendario vencido o ausente no afirma nada", () => {
  const sinFranja = { ...terminalG, franjas: [] }
  assert.equal(estadoOperacionEnParada(calReal, sinFranja, AHORA), "sin-verificar")
  assert.equal(estadoOperacionEnParada(calReal, { ...terminalG, franjas: [{ serviceId: "1", primera: "tarde", ultima: "23:00:00" }] }, AHORA), "sin-verificar")
  assert.equal(estadoOperacionEnParada(undefined, terminalG, AHORA), "sin-verificar")
  assert.equal(estadoOperacionEnParada(calReal, terminalG, new Date("2027-01-05T10:00:00-05:00")), "sin-verificar")
  const sinDomingo = calendarioSintetico()
  sinDomingo.servicios = sinDomingo.servicios.filter((s) => s.serviceId !== "D")
  assert.equal(
    estadoOperacionEnParada(sinDomingo, datosVerificadosDirecto().routes[0].servedStops[0], new Date("2026-11-08T10:00:00-05:00")),
    "sin-servicio-hoy",
  )
})

test("fechaCivilEnZona respeta la zona de Bogotá en el borde de día", () => {
  // 2026-11-05T02:00Z es 2026-11-04 21:00 en Bogotá (UTC-5).
  assert.equal(fechaCivilEnZona(new Date("2026-11-05T02:00:00Z"), "America/Bogota"), "2026-11-04")
  assert.throws(() => fechaCivilEnZona(AHORA, "no-existe"), "una zona inválida no cae a UTC")
})
