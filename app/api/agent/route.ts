import { z } from "zod"
import { parseIntent, plainReply, runIntent, type AgentContext } from "@/lib/local-agent"
import { OLLAMA_MODEL, ollamaConfigured, ollamaStatus, parseIntentWithOllama } from "@/lib/ollama"
import { createRateLimiter } from "@/lib/rate-limit"
import { getTransmilenioData } from "@/lib/transmilenio-data"

export const maxDuration = 30

/** Tamaño máximo del cuerpo de la petición, en caracteres. */
const MAX_BODY_CHARS = 2_000
/** Longitud máxima de la frase que se interpreta. */
const MAX_MESSAGE_CHARS = 300
/** Peticiones por IP y por minuto. */
const RATE_LIMIT = 20
const RATE_WINDOW_MS = 60_000

const rateLimit = createRateLimiter({ limit: RATE_LIMIT, windowMs: RATE_WINDOW_MS })

/**
 * Identifica a quien llama para el límite de peticiones.
 *
 * ponytail: confía en `x-forwarded-for`, que solo es fiable detrás de un proxy
 * que lo reescriba (Tailscale serve lo hace). Si algún día se expone el
 * servidor directamente a internet, leer la IP del socket, porque esta
 * cabecera se puede falsificar.
 */
function clientKey(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")
  if (forwarded) return forwarded.split(",")[0].trim()
  return req.headers.get("x-real-ip") ?? "local"
}

/**
 * Cuerpo de la petición. Una ubicación inválida se descarta sin rechazar la
 * pregunta: la persona igual recibe respuesta, solo que sin usar su posición.
 */
const BodySchema = z.object({
  message: z.string().catch(""),
  position: z
    .object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
    .optional()
    .catch(undefined),
})

const answer = (reply: string, status = 200, headers?: HeadersInit) => Response.json(plainReply(reply), { status, headers })

/** Qué motor interpreta las frases, para la pantalla de diagnóstico. */
export async function GET() {
  if (!ollamaConfigured()) return Response.json({ engine: "reglas" })
  const status = await ollamaStatus()
  return Response.json({ engine: "ollama", model: OLLAMA_MODEL, ...status })
}

export async function POST(req: Request) {
  const { allowed, retryAfterSeconds } = rateLimit(clientKey(req))
  if (!allowed) {
    return answer("Estás haciendo muchas peticiones seguidas. Espera un momento e inténtalo otra vez.", 429, {
      "Retry-After": String(retryAfterSeconds),
    })
  }

  let message = ""
  let position: AgentContext["position"]
  const raw = await req.text()
  if (raw.length > MAX_BODY_CHARS) return answer("Ese mensaje es demasiado largo. Dilo en una frase corta.", 413)
  try {
    const body = BodySchema.safeParse(JSON.parse(raw))
    if (body.success) {
      message = body.data.message.slice(0, MAX_MESSAGE_CHARS)
      position = body.data.position
    }
  } catch {
    // JSON inválido: se maneja como mensaje vacío más abajo.
  }

  if (!message.trim()) return answer("No te escuché bien. Toca la pantalla e inténtalo de nuevo.")

  const data = await getTransmilenioData()
  const context = { position }

  if (ollamaConfigured()) {
    try {
      const intent = await parseIntentWithOllama(message, data)
      if (intent) return Response.json(runIntent(intent, { data, context, engine: "ollama" }))
    } catch (error) {
      console.warn("[agente] Ollama no respondió, uso las reglas:", error)
    }
  }

  return Response.json(runIntent(parseIntent(message, data), { data, context }))
}
