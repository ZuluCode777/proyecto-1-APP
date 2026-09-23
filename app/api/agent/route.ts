import { generateObject } from "ai"
import { z } from "zod"
import { DEMO_DATA_NOTICE, routes, stations } from "@/lib/routes"
import { interpretCommand } from "@/lib/local-agent"
import { createRateLimiter } from "@/lib/rate-limit"

export const maxDuration = 30

/** Tamaño máximo del cuerpo de la petición, en caracteres. */
const MAX_BODY_CHARS = 2_000
/** Longitud máxima del mensaje que se envía al modelo. */
const MAX_MESSAGE_CHARS = 300
/** Peticiones por IP y por minuto. */
const RATE_LIMIT = 20
const RATE_WINDOW_MS = 60_000

const rateLimit = createRateLimiter({ limit: RATE_LIMIT, windowMs: RATE_WINDOW_MS })

/**
 * Identifica a quien llama para el límite de peticiones.
 *
 * ponytail: confía en `x-forwarded-for`, que solo es fiable detrás de un proxy
 * que lo reescriba (Vercel lo hace). Si algún día se expone el servidor
 * directamente a internet, poner un proxy inverso delante o leer la IP del
 * socket, porque esta cabecera se puede falsificar.
 */
function clientKey(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")
  if (forwarded) return forwarded.split(",")[0].trim()
  return req.headers.get("x-real-ip") ?? "anon"
}

/** Añade el aviso de datos de demostración cuando la respuesta habla de rutas. */
function withDemoNotice(reply: string, action: string): string {
  if (action !== "search" && action !== "frequent") return reply
  if (reply.includes("demostración")) return reply
  return `${reply} ${DEMO_DATA_NOTICE}`
}

const schema = z.object({
  reply: z
    .string()
    .describe(
      "Respuesta hablada, breve y clara, en español de Colombia. Se lee en voz alta a una persona ciega.",
    ),
  action: z
    .enum(["search", "frequent", "gps", "none"])
    .describe("La acción que la app debe ejecutar."),
  query: z
    .string()
    .describe('Estación o ruta a buscar cuando action es "search". En otros casos, cadena vacía.'),
})

const catalog = routes
  .map((r) => `${r.code}: ${r.from} hacia ${r.to}. Paradas: ${r.stops.join(", ")}.`)
  .join("\n")

const stationNames = stations.map((s) => s.name).join(", ")

const system = `Eres el asistente de voz de TransMiVoz, una app del sistema TransMilenio de Bogotá pensada para personas ciegas.
Respondes SIEMPRE en español de Colombia, con frases cortas, cálidas y fáciles de escuchar, porque tu respuesta se lee en voz alta.

Rutas disponibles:
${catalog}

Estaciones conocidas: ${stationNames}.

Cómo decidir la acción:
- Si la persona quiere ir a una estación o busca rutas (por ejemplo "quiero ir a Portal Norte", "rutas hacia la Calle 72"), usa action="search", pon en "query" el nombre de la estación mencionada y en "reply" resume en voz las rutas del catálogo que sirven, con su código.
- Si pide "mis rutas frecuentes" o "las rutas de siempre", usa action="frequent".
- Si quiere caminar, saber dónde está, la estación más cercana o menciona GPS o ubicación, usa action="gps" y en "reply" dile que vas a abrir el GPS auditivo.
- Si es un saludo, un agradecimiento o una pregunta general, usa action="none" y responde con amabilidad, recordándole que puede pedirte rutas o el GPS.

Reglas: nunca inventes rutas o estaciones que no estén en las listas. Los datos de rutas son de demostración, no oficiales: no los presentes como información confirmada de TransMilenio. Si no encuentras una ruta para lo que pide, dilo con claridad y sugiere una estación conocida.`

export async function POST(req: Request) {
  const { allowed, retryAfterSeconds } = rateLimit(clientKey(req))
  if (!allowed) {
    return Response.json(
      {
        reply: "Estás haciendo muchas peticiones seguidas. Espera un momento e inténtalo otra vez.",
        action: "none",
        query: "",
      },
      { status: 429, headers: { "Retry-After": String(retryAfterSeconds) } },
    )
  }

  let message = ""
  try {
    const raw = await req.text()
    if (raw.length > MAX_BODY_CHARS) {
      return Response.json(
        {
          reply: "Ese mensaje es demasiado largo. Dilo en una frase corta.",
          action: "none",
          query: "",
        },
        { status: 413 },
      )
    }
    const body = JSON.parse(raw) as { message?: unknown }
    if (typeof body.message === "string") message = body.message.slice(0, MAX_MESSAGE_CHARS)
  } catch {
    // Cuerpo inválido: se maneja como mensaje vacío más abajo.
  }

  if (!message.trim()) {
    return Response.json({
      reply: "No te escuché bien. Toca la pantalla e inténtalo de nuevo.",
      action: "none",
      query: "",
    })
  }

  try {
    const { object } = await generateObject({
      model: "google/gemini-3.5-flash",
      schema,
      system,
      prompt: message,
    })
    return Response.json({ ...object, reply: withDemoNotice(object.reply, object.action) })
  } catch (error) {
    console.log("[v0] agent route error, using local interpreter:", error)
    // Respaldo sin nube: interpreta el comando con reglas locales para que el
    // modo asistente siga funcionando aunque el modelo no esté disponible.
    return Response.json(interpretCommand(message), { status: 200 })
  }
}
