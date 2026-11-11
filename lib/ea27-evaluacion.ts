import { z } from "zod"
import corpusJson from "../data/ea27-corpus.json" with { type: "json" }
import snapshot from "../data/transmilenio.json" with { type: "json" }
import { aplicarEvidenciaGtfs } from "./evidencia-gtfs"
import type { Intent } from "./local-agent"
import { findPlaces, type TransmilenioData } from "./routes"
import { TransmilenioDataSchema } from "./transmilenio"

/**
 * Puntuación de la evaluación de EA-27 (#53). Pura: sin red ni modelo, para
 * probarla. El corredor está en `scripts/evaluar-ea27.ts`.
 *
 * Mide comprensión (intención y entidades contra la referencia del corpus), no
 * fluidez: nunca mira el texto de la respuesta.
 */

const EsperadoSchema = z.object({
  intent: z.string(),
  origin: z.string().optional(),
  destination: z.string().optional(),
  routeCode: z.string().optional(),
  /** `unsupported`: «tarifas» o «tiempo_real». */
  topic: z.string().optional(),
  /** `metro`: tipo de consulta y sus datos. */
  tipo: z.string().optional(),
  tema: z.string().optional(),
  linea: z.number().optional(),
  clave: z.string().optional(),
  claves: z.array(z.string()).optional(),
  /** El origen que dijo la persona no es una estación del catálogo. */
  origenFueraDelCatalogo: z.boolean().optional(),
  /** El asistente debe pedir un dato en vez de actuar. */
  aclara: z.boolean().optional(),
})
export type Esperado = z.infer<typeof EsperadoSchema>

const ItemSchema = z.object({
  id: z.string(),
  categoria: z.string(),
  frase: z.string(),
  esperado: EsperadoSchema,
  /** Segundo turno de una aclaración: el asistente no guarda la conversación. */
  turno: z.number().optional(),
  tras: z.string().optional(),
  nota: z.string().optional(),
  falloConocido: z.string().optional(),
})
export type Item = z.infer<typeof ItemSchema>

const CorpusSchema = z.object({ version: z.number(), congelado: z.string(), descripcion: z.string(), items: z.array(ItemSchema) })
export const corpus = CorpusSchema.parse(corpusJson)

/** El catálogo congelado de `data/transmilenio.json`, igual que lo carga la app sin red. */
export function catalogoCongelado(): TransmilenioData {
  const data = TransmilenioDataSchema.parse(snapshot)
  aplicarEvidenciaGtfs(data.routes, data.stations)
  return data
}

const lugar = (nombre: string | undefined, data: TransmilenioData) => (nombre ? findPlaces(nombre, data)[0]?.name : undefined)

/** ¿Pide el asistente un dato en vez de actuar? (`runIntent` responde con una pregunta.) */
export function pideAclaracion(intent: Intent, data: TransmilenioData): boolean {
  if (intent.type === "trip_missing_destination") return true
  return intent.type === "trip" && !!intent.origin && !lugar(intent.origin, data) && !!lugar(intent.destination, data)
}

export type Puntuacion = { intentOk: boolean; entidadesOk: boolean; aclaraOk: boolean | null; ok: boolean; pidioAclaracion: boolean }

function entidadesOk(esperado: Esperado, intent: Intent, data: TransmilenioData): boolean {
  switch (intent.type) {
    case "trip": {
      if (lugar(intent.destination, data) !== esperado.destination) return false
      if (esperado.origenFueraDelCatalogo) return !!intent.origin && !lugar(intent.origin, data)
      // Sin origen en la referencia, un origen inventado cuenta como error.
      return esperado.origin ? lugar(intent.origin, data) === esperado.origin : intent.origin === undefined
    }
    case "trip_missing_destination":
      return lugar(intent.origin, data) === esperado.origin
    case "route_info":
    case "schedule":
      return intent.routeCode === esperado.routeCode
    case "unsupported":
      return intent.topic === esperado.topic
    case "metro": {
      const c = intent.consulta
      return (
        c.tipo === esperado.tipo &&
        (esperado.tema === undefined || (c.tipo === "servicio" && c.tema === esperado.tema)) &&
        (esperado.linea === undefined || (c.tipo === "linea" && c.linea === esperado.linea)) &&
        (esperado.clave === undefined || ("clave" in c && c.clave === esperado.clave)) &&
        (esperado.claves === undefined || (c.tipo === "estacion_ambigua" && [...c.claves].sort().join() === [...esperado.claves].sort().join()))
      )
    }
    default:
      return true
  }
}

/** Compara lo que interpretó un motor con la referencia del ítem. */
export function puntuar(esperado: Esperado, intent: Intent, data: TransmilenioData): Puntuacion {
  const intentOk = intent.type === esperado.intent
  const entidades = intentOk && entidadesOk(esperado, intent, data)
  const pidioAclaracion = pideAclaracion(intent, data)
  const aclaraOk = esperado.aclara ? pidioAclaracion : null
  return { intentOk, entidadesOk: entidades, aclaraOk, pidioAclaracion, ok: entidades && aclaraOk !== false }
}

/** Percentil por rango más cercano. `valores` no puede estar vacío. */
export function percentil(valores: number[], p: number): number {
  const ordenados = [...valores].sort((a, b) => a - b)
  return ordenados[Math.min(ordenados.length - 1, Math.ceil((p / 100) * ordenados.length) - 1)]
}

export type Medicion = { id: string; categoria: string; esperado: Esperado; puntuacion: Puntuacion | null; ms: number; error?: string }

const redondear = (n: number) => Math.round(n * 1000) / 1000

/** Resumen de un motor: exactitud por categoría, aclaraciones, errores y latencia. */
export function resumir(mediciones: Medicion[]) {
  const porCategoria: Record<string, { n: number; ok: number; exactitud: number }> = {}
  for (const m of mediciones) {
    const c = (porCategoria[m.categoria] ??= { n: 0, ok: 0, exactitud: 0 })
    c.n++
    if (m.puntuacion?.ok) c.ok++
  }
  for (const c of Object.values(porCategoria)) c.exactitud = redondear(c.ok / c.n)

  const ok = mediciones.filter((m) => m.puntuacion?.ok).length
  const esperadas = mediciones.filter((m) => m.esperado.aclara)
  const ms = mediciones.map((m) => m.ms)
  return {
    n: mediciones.length,
    ok,
    exactitud: redondear(ok / mediciones.length),
    porCategoria,
    aclaraciones: {
      esperadas: esperadas.length,
      acertadas: esperadas.filter((m) => m.puntuacion?.aclaraOk).length,
      // Pidió un dato donde la referencia no lo pide.
      sobrantes: mediciones.filter((m) => !m.esperado.aclara && m.puntuacion?.pidioAclaracion).length,
    },
    errores: mediciones.filter((m) => m.error).map((m) => ({ id: m.id, error: m.error })),
    latenciaMs: { p50: redondear(percentil(ms, 50)), p95: redondear(percentil(ms, 95)), max: redondear(Math.max(...ms)) },
  }
}
