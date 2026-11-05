import assert from "node:assert/strict"
import test from "node:test"
import {
  CALIDAD_MAXIMA_RUMBO_GRADOS,
  DISTANCIA_LLEGADA_M,
  EDAD_MAXIMA_POSICION_MS,
  EDAD_MAXIMA_RUMBO_MS,
  PRECISION_MAXIMA_LLEGADA_M,
  decisionLlegada,
  esFresca,
  horaDeEvento,
  modoOrientacion,
  leerPosicionNavegador,
  ubicacionVigente,
  validarRumbo,
  type LecturaUbicacion,
} from "./ubicacion"

/**
 * Pruebas de la política compartida de ubicación (EA-07, #33, ronda 2). Añaden
 * los contraejemplos de los revisores: hora ausente/futura/NaN no es fresca, no
 * se fabrica timestamp, y la calidad de brújula (iOS) descalifica un giro.
 */

const AHORA = 1_000_000_000_000

test("el margen de reloj admite un adelanto de 2 s y rechaza cualquier adelanto mayor", () => {
  for (const adelanto of [2_000, 2_001]) {
    const hora = AHORA + adelanto
    const admitido = adelanto === 2_000
    assert.equal(esFresca({ hora }, AHORA), admitido)
    assert.equal(leerPosicionNavegador({ coords: { latitude: 4.6, longitude: -74, accuracy: 10 }, timestamp: hora }, AHORA)?.hora, admitido ? hora : null)
    assert.equal(horaDeEvento(hora, AHORA), admitido ? hora : null)
    assert.equal(validarRumbo({ grados: 90, referencia: "absoluta", calidad: 5, hora }, AHORA).fiable, admitido)
  }
})

// ── leerPosicionNavegador: NO fabrica hora ni acepta futuro ──

test("leerPosicionNavegador normaliza una posición válida con precisión y hora", () => {
  const lectura = leerPosicionNavegador(
    { coords: { latitude: 4.6, longitude: -74.08, accuracy: 12 }, timestamp: AHORA },
    AHORA,
  )
  assert.deepEqual(lectura, { lat: 4.6, lng: -74.08, precision: 12, hora: AHORA })
})

test("leerPosicionNavegador deja hora null cuando falta timestamp (no la inventa)", () => {
  const lectura = leerPosicionNavegador({ coords: { latitude: 4.6, longitude: -74.08, accuracy: 5 } }, AHORA)
  assert.equal(lectura?.hora, null)
})

test("leerPosicionNavegador deja hora null para timestamp futuro o no finito", () => {
  assert.equal(leerPosicionNavegador({ coords: { latitude: 4.6, longitude: -74 }, timestamp: AHORA + 10 * 60_000 }, AHORA)?.hora, null)
  assert.equal(leerPosicionNavegador({ coords: { latitude: 4.6, longitude: -74 }, timestamp: NaN }, AHORA)?.hora, null)
  assert.equal(leerPosicionNavegador({ coords: { latitude: 4.6, longitude: -74 }, timestamp: Infinity }, AHORA)?.hora, null)
})

test("leerPosicionNavegador conserva la hora REAL de captura válida", () => {
  const captura = AHORA - 5_000
  assert.equal(leerPosicionNavegador({ coords: { latitude: 4.6, longitude: -74 }, timestamp: captura }, AHORA)?.hora, captura)
})

test("leerPosicionNavegador deja precision en null sin accuracy o negativa", () => {
  assert.equal(leerPosicionNavegador({ coords: { latitude: 4.6, longitude: -74 }, timestamp: AHORA }, AHORA)?.precision, null)
  assert.equal(leerPosicionNavegador({ coords: { latitude: 4.6, longitude: -74, accuracy: -1 }, timestamp: AHORA }, AHORA)?.precision, null)
})

test("leerPosicionNavegador rechaza coordenadas no finitas o fuera de rango", () => {
  assert.equal(leerPosicionNavegador({ coords: { latitude: NaN, longitude: -74 } }, AHORA), null)
  assert.equal(leerPosicionNavegador({ coords: { latitude: 4.6, longitude: Infinity } }, AHORA), null)
  assert.equal(leerPosicionNavegador({ coords: { latitude: 95, longitude: -74 } }, AHORA), null)
  assert.equal(leerPosicionNavegador(null, AHORA), null)
})

// ── Frescura: hora null/futura/vieja NO es fresca ──

test("esFresca acepta dentro del límite y rechaza una lectura vieja", () => {
  assert.equal(esFresca({ hora: AHORA }, AHORA + EDAD_MAXIMA_POSICION_MS), true)
  assert.equal(esFresca({ hora: AHORA }, AHORA + EDAD_MAXIMA_POSICION_MS + 1), false)
})

test("esFresca rechaza hora null (sin evidencia de actualidad)", () => {
  assert.equal(esFresca({ hora: null }, AHORA), false)
})

test("esFresca rechaza una hora futura lejana y NaN/Infinity", () => {
  assert.equal(esFresca({ hora: AHORA + 365 * 24 * 60 * 60_000 }, AHORA), false)
  assert.equal(esFresca({ hora: NaN }, AHORA), false)
  assert.equal(esFresca({ hora: Infinity }, AHORA), false)
})

test("ubicacionVigente descarta vencida, sin hora y futura; conserva fresca", () => {
  const vieja: LecturaUbicacion = { lat: 4.6, lng: -74, precision: 10, hora: AHORA }
  assert.equal(ubicacionVigente(vieja, AHORA + EDAD_MAXIMA_POSICION_MS + 1), undefined)
  assert.equal(ubicacionVigente({ lat: 4.6, lng: -74, precision: 10, hora: null }, AHORA), undefined)
  assert.equal(ubicacionVigente({ lat: 4.6, lng: -74, precision: 10, hora: AHORA + 10 * 60_000 }, AHORA), undefined)
  assert.equal(ubicacionVigente(vieja, AHORA + 1_000), vieja)
})

// ── Proximidad que EXIGE precisión ──

test("decisionLlegada: 20 m con precisión 200 m NUNCA confirma", () => {
  const d = decisionLlegada({ precision: 200 }, 20)
  assert.equal(d.llego, false)
  assert.equal(d.motivo, "precision-insuficiente")
})

test("decisionLlegada: cerca y con buena precisión sí confirma", () => {
  assert.equal(decisionLlegada({ precision: 15 }, 20).llego, true)
})

test("decisionLlegada: lejos, sin precisión, en el borde", () => {
  assert.equal(decisionLlegada({ precision: 5 }, DISTANCIA_LLEGADA_M + 1).motivo, "lejos")
  assert.equal(decisionLlegada({ precision: null }, 10).motivo, "sin-precision")
  assert.equal(decisionLlegada(null, 0).motivo, "sin-posicion")
  assert.equal(decisionLlegada({ precision: PRECISION_MAXIMA_LLEGADA_M }, DISTANCIA_LLEGADA_M).llego, true)
})

// ── Rumbo: referencia, calidad, frescura, hora válida ──

test("validarRumbo: relativo (alpha) no es fiable", () => {
  const r = validarRumbo({ grados: 90, referencia: "relativa", calidad: null, hora: AHORA }, AHORA)
  assert.equal(r.fiable === false && r.motivo, "relativo")
})

test("validarRumbo: absoluto, con buena calidad y fresco es fiable", () => {
  const r = validarRumbo({ grados: 123, referencia: "absoluta", calidad: 5, hora: AHORA }, AHORA)
  assert.equal(r.fiable === true && r.grados, 123)
})

test("validarRumbo: absoluto SIN calidad conocida (null) NO es fiable: no se inventa calibración", () => {
  const r = validarRumbo({ grados: 90, referencia: "absoluta", calidad: null, hora: AHORA }, AHORA)
  assert.equal(r.fiable, false)
  assert.equal(r.fiable === false && r.motivo, "sin-calidad")
})

test("validarRumbo: calidad no finita descalifica; 0 y el umbral exacto son fiables", () => {
  assert.equal(validarRumbo({ grados: 10, referencia: "absoluta", calidad: NaN, hora: AHORA }, AHORA).fiable, false)
  assert.equal(validarRumbo({ grados: 10, referencia: "absoluta", calidad: Infinity, hora: AHORA }, AHORA).fiable, false)
  assert.equal(validarRumbo({ grados: 10, referencia: "absoluta", calidad: 0, hora: AHORA }, AHORA).fiable, true)
  assert.equal(validarRumbo({ grados: 10, referencia: "absoluta", calidad: CALIDAD_MAXIMA_RUMBO_GRADOS, hora: AHORA }, AHORA).fiable, true)
})

test("validarRumbo: calidad negativa (iOS webkitCompassAccuracy -1) descalifica", () => {
  const r = validarRumbo({ grados: 0, referencia: "absoluta", calidad: -1, hora: AHORA }, AHORA)
  assert.equal(r.fiable === false && r.motivo, "calidad-insuficiente")
})

test("validarRumbo: calidad peor que el umbral descalifica", () => {
  const r = validarRumbo({ grados: 0, referencia: "absoluta", calidad: CALIDAD_MAXIMA_RUMBO_GRADOS + 1, hora: AHORA }, AHORA)
  assert.equal(r.fiable === false && r.motivo, "calidad-insuficiente")
})

test("validarRumbo: absoluto VENCIDO (+2001 ms) no es fiable", () => {
  const r = validarRumbo({ grados: 10, referencia: "absoluta", calidad: 5, hora: AHORA }, AHORA + EDAD_MAXIMA_RUMBO_MS + 1)
  assert.equal(r.fiable === false && r.motivo, "vencido")
})

test("validarRumbo: hora futura o no finita no es fiable", () => {
  assert.equal(validarRumbo({ grados: 10, referencia: "absoluta", calidad: 5, hora: AHORA + 60_000 }, AHORA).fiable, false)
  assert.equal(validarRumbo({ grados: 10, referencia: "absoluta", calidad: 5, hora: NaN }, AHORA).fiable, false)
})

test("validarRumbo: sin dato numérico y fuera de rango", () => {
  assert.equal(validarRumbo({ grados: null, referencia: "absoluta", calidad: 5, hora: AHORA }, AHORA).fiable, false)
  assert.equal(validarRumbo(null, AHORA).fiable, false)
  const r = validarRumbo({ grados: 400, referencia: "absoluta", calidad: 5, hora: AHORA }, AHORA)
  assert.equal(r.fiable === false && r.motivo, "fuera-de-rango")
})

// ── Modo de orientación: precisión + rumbo ──

const RUMBO_OK = { fiable: true, grados: 0 } as const
const RUMBO_MAL = { fiable: false, motivo: "sin-calidad" } as const

test("modoOrientacion: 20 m con precisión 200 m cae dentro del margen de error: sin dirección", () => {
  assert.equal(modoOrientacion({ precision: 200 }, 20, RUMBO_OK), "sin-direccion")
  assert.equal(modoOrientacion({ precision: 20 }, 20, RUMBO_OK), "sin-direccion")
})

test("modoOrientacion: precisión desconocida o mayor que el umbral solo permite cardinal", () => {
  assert.equal(modoOrientacion({ precision: null }, 20, RUMBO_OK), "cardinal-precision")
  assert.equal(modoOrientacion({ precision: PRECISION_MAXIMA_LLEGADA_M + 1 }, 500, RUMBO_OK), "cardinal-precision")
})

test("modoOrientacion: relativa solo con precisión suficiente Y rumbo fiable", () => {
  assert.equal(modoOrientacion({ precision: 10 }, 300, RUMBO_OK), "relativa")
  assert.equal(modoOrientacion({ precision: 10 }, 300, RUMBO_MAL), "cardinal-brujula")
})

test("horaDeEvento: relativo se convierte por el reloj monotónico; epoch se respeta; lo no verificable da null", () => {
  const ahora = 1_800_000_000_000
  // Relativo: capturado hace 10 s según el reloj monotónico.
  assert.equal(horaDeEvento(90_000, ahora, 100_000), ahora - 10_000)
  // Epoch en ms.
  assert.equal(horaDeEvento(ahora - 3_000, ahora, 100_000), ahora - 3_000)
  // No verificable: ausente, no finito, <= 0, texto, sin reloj, futuro.
  for (const marca of [undefined, null, Number.NaN, Infinity, 0, -1, "1"]) {
    assert.equal(horaDeEvento(marca, ahora, 100_000), null, String(marca))
  }
  assert.equal(horaDeEvento(90_000, ahora, null), null, "relativo sin reloj monotónico")
  assert.equal(horaDeEvento(90_000, ahora, Number.NaN), null)
  assert.equal(horaDeEvento(130_000, ahora, 100_000), null, "relativo futuro")
  assert.equal(horaDeEvento(ahora + 60_000, ahora, 100_000), null, "epoch futuro")
})

test("validarRumbo: hora null (no verificable) no es fiable", () => {
  const r = validarRumbo({ grados: 10, referencia: "absoluta", calidad: 5, hora: null }, 1_000_000)
  assert.deepEqual(r, { fiable: false, motivo: "sin-hora" })
})
