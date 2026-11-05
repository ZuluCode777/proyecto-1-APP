import { z } from "zod"
import { decidirAccesoDeEntorno, respuestaDeDecision } from "@/lib/autenticacion"
import { leerCuerpoLimitado } from "@/lib/cuerpo-peticion"
import { claveCliente } from "@/lib/identidad-cliente"
import { parseIntent, plainReply, runIntent, type AgentContext, type Intent } from "@/lib/local-agent"
import { OLLAMA_MODEL, ollamaConfigured, ollamaStatus, parseIntentWithOllama } from "@/lib/ollama"
import { createRateLimiter } from "@/lib/rate-limit"
import { elegirIntent, requiereModelo } from "@/lib/seleccion-interprete"
import { getTransmilenioData } from "@/lib/transmilenio-data"

export const maxDuration = 30

/**
 * Tamaño máximo del cuerpo de la petición, EN BYTES. EA-10 (#36): es una cota de
 * bytes aplicada al leer el stream, no de caracteres contados tras acumular todo
 * el cuerpo. Es independiente del límite de la frase (`MAX_MESSAGE_CHARS`): el
 * cuerpo se acota antes de interpretar nada.
 */
const MAX_BODY_BYTES = 4_000
/** Longitud máxima de la frase que se interpreta. */
const MAX_MESSAGE_CHARS = 300
/** Peticiones por clave y por minuto. */
const RATE_LIMIT = 20
const RATE_WINDOW_MS = 60_000

const rateLimit = createRateLimiter({ limit: RATE_LIMIT, windowMs: RATE_WINDOW_MS })

/**
 * Guardia de acceso HTTP Basic de la ruta. `/api/agent` se excluye del `proxy`
 * (para que Next no clone su cuerpo y la cota por stream actúe sobre el cuerpo
 * real), así que GET y POST aplican aquí la MISMA decisión que el `proxy`
 * (`decidirAccesoDeEntorno`): 401 sin credencial o incorrecta, 503 en producción
 * sin clave utilizable, y continúa si está permitido. Devuelve la respuesta de
 * denegación, o `null` si se permite. No es una respuesta del agente: su cuerpo
 * es texto plano, igual que el del `proxy` (no `AgentReply`).
 */
function guardarAcceso(req: Request): Response | null {
  const decision = decidirAccesoDeEntorno({ autorizacion: req.headers.get("authorization") })
  if (decision.kind === "permitido") return null
  const { estado, cuerpo, cabeceras } = respuestaDeDecision(decision)
  return new Response(cuerpo, { status: estado, headers: cabeceras })
}

/**
 * Cuerpo de la petición. Una ubicación inválida se descarta sin rechazar la
 * pregunta: la persona igual recibe respuesta, solo que sin usar su posición.
 *
 * EA-07 (#33): la posición puede traer metadatos OPCIONALES de precisión y hora
 * (`LecturaUbicacion` del cliente). Se validan de forma compatible: si faltan o
 * no cuadran, se ignoran (no rompen la petición), pero si la lectura viene con
 * `hora` y está VENCIDA, el servidor la descarta y responde sin usarla, como si
 * no se hubiera enviado (no se reutiliza una coordenada vieja).
 */
const BodySchema = z.object({
  message: z.string().catch(""),
  position: z
    .object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      precision: z.number().min(0).nullish(),
      hora: z.number().nonnegative().optional(),
    })
    .optional()
    .catch(undefined),
})

const answer = (reply: string, status = 200, headers?: HeadersInit) => Response.json(plainReply(reply), { status, headers })

/** Qué motor interpreta las frases, para la pantalla de diagnóstico. */
export async function GET(req: Request) {
  const denegado = guardarAcceso(req)
  if (denegado) return denegado
  if (!ollamaConfigured()) return Response.json({ engine: "reglas" })
  const status = await ollamaStatus()
  return Response.json({ engine: "ollama", model: OLLAMA_MODEL, ...status })
}

export async function POST(req: Request) {
  const denegado = guardarAcceso(req)
  if (denegado) return denegado

  const { allowed, retryAfterSeconds } = rateLimit(claveCliente())
  if (!allowed) {
    return answer("Estás haciendo muchas peticiones seguidas. Espera un momento e inténtalo otra vez.", 429, {
      "Retry-After": String(retryAfterSeconds),
    })
  }

  let message = ""
  let lectura: AgentContext["position"]
  // EA-10 (#36): se lee el cuerpo por stream con cota de bytes ANTES de acumular
  // todo. Un cuerpo por encima del límite corta la lectura y responde 413; un
  // error o cancelación de la lectura responde 400 sin provocar 500 ni dejar el
  // stream abierto. La cota es de bytes y es independiente del límite de la frase.
  const cuerpo = await leerCuerpoLimitado({ cuerpo: req.body, maxBytes: MAX_BODY_BYTES })
  if (cuerpo.kind === "excedido") return answer("Ese mensaje es demasiado largo. Dilo en una frase corta.", 413)
  if (cuerpo.kind === "error") return answer("No pude leer tu mensaje. Inténtalo de nuevo.", 400)
  const raw = cuerpo.texto
  try {
    const body = BodySchema.safeParse(JSON.parse(raw))
    if (body.success) {
      message = body.data.message.slice(0, MAX_MESSAGE_CHARS)
      const recibida = body.data.position
      // EA-07 (#33): se conserva la lectura COMPLETA (precisión + hora) para el
      // contexto; NO se reduce a lat/lng ni se revalida aquí. La vigencia se
      // comprueba al RESOLVER (en `resolverIntent`, con `now`), después de las
      // esperas de catálogo y Ollama. Una petición heredada sin `hora` llega con
      // `hora: null`: no es evidencia fresca, así que no se usará como posición.
      // Metadatos inválidos (p. ej. `hora` no finita) hacen que el esquema
      // descarte toda la posición (`.catch`), de forma conservadora: nunca se
      // trata una lectura de calidad/fecha desconocida como fresca.
      if (recibida) {
        lectura = { lat: recibida.lat, lng: recibida.lng, precision: recibida.precision ?? null, hora: recibida.hora ?? null }
      }
    }
  } catch {
    // JSON inválido: se maneja como mensaje vacío más abajo.
  }

  if (!message.trim()) return answer("No te escuché bien. Toca la pantalla e inténtalo de nuevo.")

  const data = await getTransmilenioData()

  // Hallazgo 15 (EA-08): las REGLAS interpretan primero. Si reconocen la frase,
  // se usan y no se consulta el modelo: responde más rápido y un `unknown` del
  // modelo no puede anular una intención conocida. El modelo solo se consulta
  // cuando las reglas no entienden, con un presupuesto corto y respaldo
  // inmediato a la respuesta de desconocimiento de reglas. Siempre una sola
  // acción validada por pregunta.
  const intentDeReglas = parseIntent(message, data)
  let intentDelModelo: Intent | null = null
  if (ollamaConfigured() && requiereModelo(intentDeReglas)) {
    try {
      intentDelModelo = await parseIntentWithOllama(message, data)
    } catch (error) {
      console.warn("[agente] Ollama no respondió, uso las reglas:", error)
    }
  }

  const { intent, engine } = elegirIntent(intentDeReglas, intentDelModelo)
  // `now` se fija AQUÍ, tras las esperas de catálogo y Ollama: `resolverIntent`
  // revalida con él la frescura de la lectura antes de resolver el efecto, así
  // una lectura que era fresca al llegar pero envejeció durante las esperas ya
  // no se usa (EA-07, #33).
  const context: AgentContext = { position: lectura, now: new Date() }
  return Response.json(runIntent(intent, { data, context, engine }))
}
