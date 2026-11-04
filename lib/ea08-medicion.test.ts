import assert from "node:assert/strict"
import os from "node:os"
import test from "node:test"
import snapshot from "../data/transmilenio.json" with { type: "json" }
import { parseIntent, runIntent, type Intent } from "./local-agent"
import { TransmilenioDataSchema } from "./transmilenio"

/**
 * Medición por etapa del asistente LOCAL con datos ya cargados, para el issue
 * #34 (EA-08), criterio 5. Fija un CORPUS ESPAÑOL representativo y mide, por
 * etapa, la latencia de la ruta determinista (sin red, sin modelo, sin voz):
 *
 * - interpretación: `parseIntent` (frase → intención por reglas);
 * - herramientas/plan + respuesta: `runIntent`, QUE SE MIDEN JUNTAS (incluye
 *   consultar el catálogo, planear y construir el texto; no se separan porque
 *   `runIntent` las hace en una sola pasada).
 *
 * NO cubre `sanear`/validación de esquema del cliente ni el manejador del
 * endpoint: es la latencia del núcleo local, que es lo que domina la respuesta
 * con datos cargados. Objetivo propuesto por la auditoría (no medición previa de
 * hardware): p95 ≤ 500 ms para texto local. La confirmación audible ≤ 1 s y el
 * arranque frío de Render se miden aparte, no aquí. No hay logs de audio, frases
 * completas de personas reales ni posición precisa: el corpus es sintético.
 *
 * El `assert` usa un umbral HOLGADO (500 ms frente a decenas de ms observados,
 * margen de ~10×): comprueba que no haya una regresión de orden de magnitud sin
 * volverse frágil en una máquina de integración continua cargada. Los p50/p95
 * impresos dependen de la máquina (se registra CPU/RAM) y no son un contrato.
 */

const data = TransmilenioDataSchema.parse(snapshot)

/** Corpus español escrito a mano: saludos, ayuda, rutas, horarios, GPS y viajes. */
const CORPUS: string[] = [
  "hola",
  "buenos días",
  "gracias",
  "¿qué puedes hacer?",
  "ayuda",
  "información de la B23",
  "información de la 8 G",
  "qué horario tiene la H54",
  "a qué hora opera la C15",
  "dónde estoy",
  "estación más cercana",
  "cómo llego a Ricaurte",
  "cómo llego de Ricaurte a Calle 72",
  "quiero ir a la Universidad Nacional",
  "salgo desde Portal Norte",
  "llévame de Portal Sur a Portal Norte",
  "cuánto cuesta el pasaje",
  "a qué hora llega el bus",
  "cuéntame un chiste",
  "rutas frecuentes",
]

const AHORA = new Date("2026-11-04T10:00:00-05:00")

/** Percentil (interpolación lineal) de una lista de milisegundos. */
function percentil(valores: number[], p: number): number {
  const orden = [...valores].sort((a, b) => a - b)
  if (orden.length === 0) return 0
  const rango = (p / 100) * (orden.length - 1)
  const bajo = Math.floor(rango)
  const alto = Math.ceil(rango)
  if (bajo === alto) return orden[bajo]
  return orden[bajo] + (orden[alto] - orden[bajo]) * (rango - bajo)
}

/**
 * Mide una etapa `veces` por entrada del corpus y devuelve p50/p95/máx en ms.
 * `casos` ya está preparado fuera del cronómetro: la zona cronometrada solo
 * ejecuta `fn`, sin búsquedas de índice ni otra preparación.
 */
function medirEtapa<T>(nombre: string, casos: T[], fn: (caso: T) => void, veces = 15) {
  const muestras: number[] = []
  for (const caso of casos) fn(caso) // calentamiento (no medido)
  for (let i = 0; i < veces; i++) {
    for (const caso of casos) {
      const t0 = performance.now()
      fn(caso)
      muestras.push(performance.now() - t0)
    }
  }
  const p50 = percentil(muestras, 50)
  const p95 = percentil(muestras, 95)
  const max = Math.max(...muestras)
  console.log(`[EA-08 medición] ${nombre}: n=${muestras.length}  p50=${p50.toFixed(3)} ms  p95=${p95.toFixed(3)} ms  máx=${max.toFixed(3)} ms`)
  return { p50, p95, max }
}

const OBJETIVO_P95_MS = 500

test("AC5: medición por etapa del texto local con datos cargados (corpus español)", () => {
  const cpu = os.cpus()[0]?.model ?? "CPU desconocida"
  const ramGB = (os.totalmem() / 1024 ** 3).toFixed(1)
  console.log(`[EA-08 medición] máquina: ${os.platform()} ${os.arch()}, ${cpu}, ${os.cpus().length} hilos, ${ramGB} GB RAM, Node ${process.version}, corpus=${CORPUS.length} frases`)

  // Casos preparados fuera del cronómetro: frases y sus intenciones.
  const frases = CORPUS
  const intenciones: Intent[] = CORPUS.map((frase) => parseIntent(frase, data))

  const interpretacion = medirEtapa("interpretación (parseIntent)", frases, (frase) => {
    parseIntent(frase, data)
  })
  const herramientas = medirEtapa("herramientas + respuesta (runIntent, medidas juntas)", intenciones, (intent) => {
    runIntent(intent, { data, context: { now: AHORA } })
  })
  const completo = medirEtapa("texto local completo (parseIntent + runIntent)", frases, (frase) => {
    runIntent(parseIntent(frase, data), { data, context: { now: AHORA } })
  })

  assert.ok(
    completo.p95 <= OBJETIVO_P95_MS,
    `p95 del texto local (${completo.p95.toFixed(1)} ms) supera el objetivo de ${OBJETIVO_P95_MS} ms`,
  )
  assert.ok(interpretacion.p95 <= OBJETIVO_P95_MS)
  assert.ok(herramientas.p95 <= OBJETIVO_P95_MS)
})
