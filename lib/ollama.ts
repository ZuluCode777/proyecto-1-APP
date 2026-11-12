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
 *
 * EA-27 (#53), decisión de A1 del 10/11/2026: con el modelo cargado, responde
 * primero (salvo las dos intenciones que solo las reglas expresan; ver
 * `lib/seleccion-interprete.ts`). Sin el modelo cargado responden las reglas al
 * instante y se lanza su precarga. Si está cargado lo dice `modeloListo`.
 */
export const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434"
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? ""
/**
 * Token secreto (EA-27, #53) para un Ollama detrás de un proxy con
 * autenticación, p. ej. el del equipo publicado por un túnel. Solo del servidor:
 * no se exporta, no se registra y no se devuelve en ninguna respuesta. Vacío o
 * ausente, no se envía `Authorization` y el uso local no cambia.
 */
const OLLAMA_TOKEN = (process.env.OLLAMA_TOKEN ?? "").trim()
/** Direcciones de este mismo equipo, donde `http` no expone el token a la red. */
const HOSTS_LOCALES = new Set(["127.0.0.1", "[::1]", "localhost"])

/**
 * Tiempo máximo de espera por el modelo ya cargado; al agotarse, responden las
 * reglas (ver `lib/seleccion-interprete.ts`).
 *
 * EA-27 (#53), decisión de A1 del 10/11/2026: con el modelo en marcha, ninguna
 * pregunta debe caer en las reglas por esta espera. De 8 consultas medidas
 * desde Render contra el Ollama del equipo por el túnel, una agotó los 2 s del
 * presupuesto anterior (EA-08); las otras tardaron entre 0,8 y 2,5 s en total.
 * Los 4,5 s dejan 1,5 s de margen bajo la espera de la web (6 s,
 * `ESPERA_MAXIMA_CLIENTE_MS`) y caben en los 12 s de la app de iPhone.
 */
const TIMEOUT_MS = 4_500
/**
 * Cuánto tiempo mantiene Ollama el modelo en memoria sin uso. Cargarlo tarda
 * más que `TIMEOUT_MS`: un día cubre la jornada sin recargas a mitad.
 */
const KEEP_ALIVE = "24h"

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
  gps: "quiere saber dónde está o la estación más cercana. No es gps si pregunta si puede cruzar o subir, o si el camino, el semáforo o el andén están libres.",
  frequent: "pide sus rutas frecuentes o guardadas.",
  route_info: "pregunta por una ruta concreta (pon su código en routeCode).",
  schedule: "pregunta el horario de una ruta (pon su código en routeCode).",
  trip: "quiere ir a una estación. destination es obligatorio; origin solo si lo dice.",
  fares: "pregunta por tarifas o pasajes.",
  realtime: "pregunta cuándo llega un bus.",
  unknown: "cualquier otra cosa, incluida toda pregunta de seguridad física (si puede cruzar, subir, o si el camino, el semáforo o el andén están libres).",
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

/**
 * Frontera de confianza: con token, la dirección debe ser `https:` o de este
 * mismo equipo, para que el token nunca viaje en claro por una red. Una
 * dirección que no se puede interpretar tampoco es segura.
 */
function destinoSeguro(): boolean {
  if (!OLLAMA_TOKEN) return true
  try {
    const { protocol, hostname, username, password } = new URL(OLLAMA_BASE_URL)
    // Una dirección con usuario o clave (`https://u:c@host`) llevaría esa clave en cada mensaje de error.
    if (username || password) return false
    return protocol === "https:" || (protocol === "http:" && HOSTS_LOCALES.has(hostname))
  } catch {
    return false
  }
}

/** Configuración visible en `/diagnostico`. */
export function ollamaConfigured(): boolean {
  return OLLAMA_MODEL.length > 0 && destinoSeguro()
}

/**
 * Único punto por el que este módulo habla con Ollama: añade el token cuando
 * hay uno y no envía nada si el destino no es seguro. `redirect: "error"`
 * porque ni Ollama ni el proxy redirigen nunca. Los errores de `fetch` y de
 * `Headers` pueden traer el token, la dirección o su clave en el mensaje o en
 * `cause`, y quien llama los registra: aquí se reemplazan por uno que solo
 * lleva el nombre del error.
 */
async function fetchOllama(ruta: string, init: RequestInit & { headers?: Record<string, string> }): Promise<Response> {
  if (!destinoSeguro()) throw new Error("Ollama: la dirección no es segura para enviar el token")
  try {
    const headers = OLLAMA_TOKEN ? { ...init.headers, Authorization: `Bearer ${OLLAMA_TOKEN}` } : init.headers
    return await fetch(`${OLLAMA_BASE_URL}${ruta}`, { ...init, headers, redirect: "error" })
  } catch (e) {
    throw new Error(`Ollama: ${e instanceof Error ? e.name : "fallo"}`)
  }
}

type EstadoOllama = {
  /** Precarga en curso, para no lanzar otra mientras tanto. */
  precarga: Promise<void> | null
  /**
   * ¿Respondió Ollama a la última precarga o consulta? Empieza en falso. Lo
   * deja en verdadero una respuesta HTTP correcta, recibida entera y con la
   * forma de las de Ollama (`ChatResponseSchema`), aunque lo que diga el
   * modelo no sirva. Lo dejan en falso un error de red, un plazo agotado, un
   * estado HTTP de error, un cuerpo que no llega entero y un 200 con otra cosa
   * (la página de un proxy, por ejemplo).
   */
  cargado: boolean
}
/**
 * El estado vive en `globalThis` y no en variables del módulo: Next compila
 * una copia de este archivo para `instrumentation.ts` y otra para la ruta, y
 * con variables del módulo la precarga del arranque no contaba para la primera
 * pregunta.
 */
const almacen = globalThis as typeof globalThis & { __transmivozOllama?: EstadoOllama }
const estado = (almacen.__transmivozOllama ??= { precarga: null, cargado: false })

/**
 * ¿Se puede consultar el modelo ahora? Ollama está configurado (con una
 * dirección segura) y la última precarga o consulta respondió bien. Si no,
 * responden las reglas sin esperar.
 */
export function modeloListo(): boolean {
  return ollamaConfigured() && estado.cargado
}

/**
 * Carga el modelo en memoria sin generar nada. La primera carga tarda varios
 * segundos; hacerla antes evita que la primera pregunta real caiga en las
 * reglas por tiempo de espera. Solo hay una precarga a la vez.
 */
export function warmUpOllama(): Promise<void> {
  estado.precarga ??= fetchOllama("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: OLLAMA_MODEL, messages: [], keep_alive: KEEP_ALIVE }),
    signal: AbortSignal.timeout(60_000),
  })
    .then(async (response) => {
      // Solo cuenta si llega entera y es de Ollama: un 200 con otra cosa no es el modelo.
      const cuerpo: unknown = await response.json()
      return response.ok && ChatResponseSchema.safeParse(cuerpo).success
    })
    .then(
      (ok) => {
        estado.cargado = ok
      },
      () => {
        estado.cargado = false
      },
    )
    .finally(() => {
      estado.precarga = null
    })
  return estado.precarga
}

/** Comprueba que Ollama responde y que el modelo está descargado, y lo precarga. */
export async function ollamaStatus(): Promise<{ reachable: boolean; hasModel: boolean }> {
  try {
    const response = await fetchOllama("/api/tags", { signal: AbortSignal.timeout(3_000) })
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
 * Pide al modelo la intención de una frase. Devuelve `null` si lo que dice el
 * modelo no cuadra con los datos, y falla si Ollama no responde o responde algo
 * que no es suyo; en los dos casos quien llama usa las reglas.
 */
export async function parseIntentWithOllama(text: string, data: TransmilenioData): Promise<Intent | null> {
  let contenido: string
  try {
    const response = await fetchOllama("/api/chat", {
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
    if (!chat.success) throw new Error("Ollama: la respuesta no es de Ollama")
    contenido = chat.data.message.content
  } catch (error) {
    // También si el cuerpo no llega entero: el plazo puede vencer mientras se lee.
    estado.cargado = false
    throw error
  }
  estado.cargado = true

  let content: unknown
  try {
    content = JSON.parse(contenido)
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
