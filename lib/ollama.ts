import { z } from "zod"
import type { Intent } from "@/lib/local-agent"
import { findPlaces, findRouteByCode, shortName, type TransmilenioData } from "@/lib/routes"

/**
 * Interpretación de frases con un modelo local de Ollama.
 *
 * Se activa con `OLLAMA_MODEL` (probado con `qwen2.5:3b`). El modelo solo
 * clasifica la frase y extrae nombres; la respuesta la arma `runIntent` con
 * los datos reales. Cualquier salida del modelo se valida contra los datos:
 * una estación o una ruta que no existe se descarta y se vuelve a las reglas.
 */
export const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434"
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? ""

/**
 * Tiempo máximo de espera por el modelo. Ya cargado, qwen2.5:3b responde en
 * unos 150 ms en una RTX 3080; si tarda más, es que se está cargando, y el
 * asistente responde con las reglas en vez de dejar a la persona esperando.
 */
const TIMEOUT_MS = 8_000
/** Cuánto tiempo mantiene Ollama el modelo en memoria sin uso. */
const KEEP_ALIVE = "1h"

/**
 * Intenciones que el modelo puede devolver. El esquema y el prompt salen de
 * esta lista y de `MODEL_INTENT_HELP`, que TypeScript obliga a mantener completa.
 */
const MODEL_INTENTS = [
  "greeting",
  "help",
  "cancel",
  "gps",
  "frequent",
  "route_info",
  "schedule",
  "trip",
  "fares",
  "realtime",
  "unknown",
] as const

/** Descripción de cada intención en el prompt. */
const MODEL_INTENT_HELP: Record<(typeof MODEL_INTENTS)[number], string> = {
  greeting: "saludo o agradecimiento.",
  help: "pregunta qué puede hacer el asistente.",
  cancel: "quiere cancelar.",
  gps: "quiere saber dónde está o la estación más cercana.",
  frequent: "pide sus rutas frecuentes o guardadas.",
  route_info: "pregunta por una ruta concreta (pon su código en routeCode).",
  schedule: "pregunta el horario de una ruta (pon su código en routeCode).",
  trip: "quiere ir a una estación. destination es obligatorio; origin solo si lo dice.",
  fares: "pregunta por tarifas o pasajes.",
  realtime: "pregunta cuándo llega un bus.",
  unknown: "cualquier otra cosa.",
}

const Extraction = z.object({
  intent: z.enum(MODEL_INTENTS),
  origin: z.string(),
  destination: z.string(),
  routeCode: z.string(),
})

/** Respuesta de `GET /api/tags`: los modelos descargados. */
const TagsSchema = z.object({ models: z.array(z.object({ name: z.string() })) })
/** Respuesta de `POST /api/chat` sin streaming. */
const ChatResponseSchema = z.object({ message: z.object({ content: z.string() }) })

const system = (data: TransmilenioData) => `Clasificas frases de personas que usan TransMilenio en Bogotá.
Devuelve solo JSON con: intent, origin, destination, routeCode. Usa "" en los campos que no apliquen.

Intenciones:
${MODEL_INTENTS.map((name) => `- ${name}: ${MODEL_INTENT_HELP[name]}`).join("\n")}

Estaciones: ${[...new Set(data.stations.map((s) => shortName(s.name)))].join(", ")}.
Códigos de ruta: ${data.routes.map((r) => r.code).join(", ")}.`

/** Configuración visible en `/diagnostico`. */
export function ollamaConfigured(): boolean {
  return OLLAMA_MODEL.length > 0
}

/**
 * Carga el modelo en memoria sin generar nada. La primera carga tarda varios
 * segundos; hacerla antes evita que la primera pregunta real caiga en las
 * reglas por tiempo de espera.
 */
export function warmUpOllama(): Promise<void> {
  return fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: OLLAMA_MODEL, messages: [], keep_alive: KEEP_ALIVE }),
    signal: AbortSignal.timeout(60_000),
  }).then(
    () => undefined,
    () => undefined,
  )
}

/** Comprueba que Ollama responde y que el modelo está descargado, y lo precarga. */
export async function ollamaStatus(): Promise<{ reachable: boolean; hasModel: boolean }> {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { signal: AbortSignal.timeout(3_000) })
    if (!response.ok) return { reachable: false, hasModel: false }
    const tags = TagsSchema.safeParse(await response.json())
    const names = tags.success ? tags.data.models.map((m) => m.name) : []
    const hasModel = names.some((n) => n === OLLAMA_MODEL || n.startsWith(`${OLLAMA_MODEL}:`))
    if (hasModel) void warmUpOllama()
    return { reachable: true, hasModel }
  } catch {
    return { reachable: false, hasModel: false }
  }
}

/**
 * Pide al modelo la intención de una frase. Devuelve `null` si el modelo no
 * responde o si lo que devuelve no cuadra con los datos, para que quien llama
 * use las reglas.
 */
export async function parseIntentWithOllama(text: string, data: TransmilenioData): Promise<Intent | null> {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      format: z.toJSONSchema(Extraction),
      options: { temperature: 0 },
      keep_alive: KEEP_ALIVE,
      messages: [
        { role: "system", content: system(data) },
        { role: "user", content: text },
      ],
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`Ollama: HTTP ${response.status}`)

  const chat = ChatResponseSchema.safeParse(await response.json())
  if (!chat.success) return null
  let content: unknown
  try {
    content = JSON.parse(chat.data.message.content)
  } catch {
    return null
  }
  const parsed = Extraction.safeParse(content)
  if (!parsed.success) return null
  const { intent, origin, destination, routeCode } = parsed.data

  const place = (name: string) => (name ? findPlaces(name, data)[0]?.name : undefined)
  const route = routeCode ? findRouteByCode(routeCode, data)?.code : undefined

  switch (intent) {
    case "route_info":
    case "schedule":
      return route ? { type: intent, routeCode: route } : null
    case "trip": {
      const to = place(destination)
      const from = place(origin)
      // Un origen que el modelo nombró y no existe no se ignora: se vuelve a las reglas.
      if (!to || (origin && !from)) return null
      return { type: "trip", origin: from, destination: to }
    }
    case "fares":
      return { type: "unsupported", topic: "tarifas" }
    case "realtime":
      return { type: "unsupported", topic: "tiempo_real" }
    default:
      return { type: intent }
  }
}
