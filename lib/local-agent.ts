import { z } from "zod"
import { spokenDistance, type LatLng } from "@/lib/geo"
import {
  findPlaceMentions,
  findPlaces,
  findRouteByCode,
  nearestStations,
  placeOf,
  planTrip,
  routesThrough,
  samePlace,
  type Place,
  type TransmilenioData,
  type TripPlan,
} from "@/lib/routes"
import { normalize } from "@/lib/text"

/**
 * Asistente de TransMiVoz en dos pasos:
 *
 * 1. `parseIntent` entiende qué pide la persona. Por reglas, o con un modelo
 *    local (ver `lib/ollama.ts`), que devuelve la misma `Intent`.
 * 2. `runIntent` lo resuelve con herramientas que consultan los datos reales
 *    de TransMilenio, y deja registro de cada paso en `steps`.
 *
 * El modelo solo interpreta la frase. Las rutas, estaciones y horarios salen
 * siempre de los datos, así que el asistente no puede inventar una ruta.
 */

export type Intent =
  | { type: "greeting" }
  | { type: "help" }
  | { type: "cancel" }
  | { type: "gps" }
  | { type: "frequent" }
  | { type: "route_info"; routeCode: string }
  | { type: "schedule"; routeCode: string }
  | { type: "trip"; origin?: string; destination: string }
  | { type: "trip_missing_destination"; origin: string }
  | { type: "unsupported"; topic: "tarifas" | "tiempo_real" }
  | { type: "unknown" }

const AgentStepSchema = z.object({
  label: z.string(),
  detail: z.string().optional(),
})
export type AgentStep = z.infer<typeof AgentStepSchema>

/** Tramo de un viaje, en forma serializable para enviarlo al navegador. */
const TripLegSummarySchema = z.object({
  routeCode: z.string(),
  board: z.string(),
  alight: z.string(),
  stationsRidden: z.number(),
})
export type TripLegSummary = z.infer<typeof TripLegSummarySchema>

const ReplyBaseSchema = z.object({
  reply: z.string(),
  steps: z.array(AgentStepSchema),
  engine: z.enum(["reglas", "ollama"]),
})

/**
 * Respuesta del asistente. Cada acción trae solo los datos que necesita la
 * pantalla que abre: una búsqueda trae la estación, una ruta su código y un
 * viaje sus tramos. El navegador la valida con este mismo esquema.
 */
export const AgentReplySchema = z.discriminatedUnion("action", [
  ReplyBaseSchema.extend({ action: z.enum(["none", "frequent", "gps"]) }),
  ReplyBaseSchema.extend({ action: z.literal("search"), station: z.string() }),
  ReplyBaseSchema.extend({ action: z.literal("route"), routeCode: z.string() }),
  ReplyBaseSchema.extend({ action: z.literal("trip"), trip: z.array(TripLegSummarySchema) }),
])
export type AgentReply = z.infer<typeof AgentReplySchema>
export type AgentEngine = AgentReply["engine"]

export type AgentAction = AgentReply["action"]

export type AgentContext = {
  /** Ubicación de la persona, si dio permiso. */
  position?: LatLng
}

/** Respuesta sin acción ni pasos, para avisos como "no te escuché". */
export function plainReply(reply: string, engine: AgentEngine = "reglas"): AgentReply {
  return { reply, action: "none", steps: [], engine }
}

/** La frase contiene alguna de estas expresiones como palabras completas. */
const hasPhrase = (text: string, phrases: string[]) => phrases.some((p) => ` ${text} `.includes(` ${p} `))

const CANCEL = ["cancela", "cancelar", "olvidalo", "detente", "no gracias", "dejalo"]
const HELP = ["ayuda", "que puedes hacer", "como funciona", "que sabes hacer", "que haces"]
const FARE = ["tarifa", "tarifas", "pasaje", "cuanto cuesta", "cuanto vale", "precio", "recarga", "recargar"]
const REALTIME = ["cuanto se demora", "cuanto falta", "tiempo real", "a que hora llega", "donde viene"]
const SCHEDULE = ["horario", "horarios", "a que hora", "hora", "abre", "cierra", "opera", "funciona"]
const FREQUENT = ["frecuente", "frecuentes", "de siempre", "favorita", "favoritas", "guardadas"]
const GPS = ["gps", "ubicacion", "donde estoy", "cerca", "cercana", "cercanas", "caminar", "caminando", "a pie"]
const GREETING = ["hola", "buenos dias", "buenas tardes", "buenas noches", "buenas", "gracias", "muchas gracias"]

/**
 * Qué papel le da a una estación lo que se dijo justo antes de nombrarla.
 *
 * "desde X" siempre es el origen. "de X" también lo es, pero solo en la forma
 * "de X a Y": "la estación de X" no dice nada del papel de X. Por eso primero
 * se quitan del final los artículos y "estación", "parada" o "portal", con su
 * "de", y después se mira la palabra que queda.
 */
type Role = "origin" | "weak-origin" | "destination" | "none"

const TRAILING_FILLER = /\s(?:la|el|los|las|estacion|estaciones|parada|portal)(?:\s(?:de|del))?$/
const STRONG_ORIGIN = /(?:^|\s)(?:desde|saliendo de|salgo de|parto de|estoy en)$/
const WEAK_ORIGIN = /(?:^|\s)(?:de|del)$/
const DESTINATION = /(?:^|\s)(?:a|al|hacia|hasta|para|llegar a|ir a|voy a|voy para)$/

function roleOf(before: string): Role {
  let rest = ` ${before}`
  while (TRAILING_FILLER.test(rest)) rest = rest.replace(TRAILING_FILLER, "")
  if (STRONG_ORIGIN.test(rest)) return "origin"
  if (DESTINATION.test(rest)) return "destination"
  if (WEAK_ORIGIN.test(rest)) return "weak-origin"
  return "none"
}

/** Interpreta una frase por reglas. */
export function parseIntent(text: string, data: TransmilenioData): Intent {
  const t = normalize(text)
  if (!t) return { type: "unknown" }

  if (hasPhrase(t, CANCEL)) return { type: "cancel" }
  if (hasPhrase(t, HELP)) return { type: "help" }
  if (hasPhrase(t, FARE)) return { type: "unsupported", topic: "tarifas" }

  const route = findRouteByCode(text, data)
  if (route) {
    if (hasPhrase(t, REALTIME)) return { type: "unsupported", topic: "tiempo_real" }
    return hasPhrase(t, SCHEDULE) ? { type: "schedule", routeCode: route.code } : { type: "route_info", routeCode: route.code }
  }
  if (hasPhrase(t, REALTIME)) return { type: "unsupported", topic: "tiempo_real" }

  if (hasPhrase(t, FREQUENT)) return { type: "frequent" }

  const mentions = findPlaceMentions(text, data).map((m) => ({ name: m.place.name, role: roleOf(m.before) }))
  if (mentions.length >= 2) {
    const hasDestination = mentions.some((m) => m.role === "destination")
    const origin =
      mentions.find((m) => m.role === "origin") ??
      (hasDestination ? mentions.find((m) => m.role !== "destination") : undefined) ??
      mentions[0]
    const others = mentions.filter((m) => m !== origin)
    const destination = others.find((m) => m.role === "destination") ?? others[others.length - 1]
    return { type: "trip", origin: origin.name, destination: destination.name }
  }
  if (mentions.length === 1) {
    const [only] = mentions
    // "salgo desde Ricaurte" sin destino: se entiende el origen, falta el destino.
    if (only.role === "origin") return { type: "trip_missing_destination", origin: only.name }
    return { type: "trip", destination: only.name }
  }

  if (hasPhrase(t, GPS)) return { type: "gps" }
  if (hasPhrase(t, GREETING)) return { type: "greeting" }
  return { type: "unknown" }
}

/** Lee una lista de códigos: "B23, H54 y M83", y cuántas más quedan. */
function listCodes(codes: string[], max = 3): string {
  const shown = codes.slice(0, max)
  const rest = codes.length - shown.length
  const items = rest > 0 ? [...shown, `${rest} más`] : shown
  return items.length > 1 ? `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}` : items[0] ?? ""
}

/** Quita el punto final de un horario como "10:00 p. m." para no duplicarlo. */
const bare = (value: string) => value.replace(/\.\s*$/, "")

function describePlan(plan: TripPlan): string {
  if (plan.length === 1) {
    const [leg] = plan
    return `Toma la ${leg.route.code} en ${leg.board} y bájate en ${leg.alight}, después de ${leg.stationsRidden} ${leg.stationsRidden === 1 ? "estación" : "estaciones"}.`
  }
  const [first, second] = plan
  return `No hay una ruta directa. Toma la ${first.route.code} en ${first.board} hasta ${first.alight}, y ahí cambia a la ${second.route.code} hasta ${second.alight}.`
}

const summarize = (plan: TripPlan): TripLegSummary[] =>
  plan.map((leg) => ({ routeCode: leg.route.code, board: leg.board, alight: leg.alight, stationsRidden: leg.stationsRidden }))

const resolvePlace = (name: string, data: TransmilenioData): Place | undefined => findPlaces(name, data)[0]

/** Resuelve una intención con los datos reales y devuelve la respuesta hablada. */
export function runIntent(
  intent: Intent,
  { data, context = {}, engine = "reglas" }: { data: TransmilenioData; context?: AgentContext; engine?: AgentEngine },
): AgentReply {
  const steps: AgentStep[] = []
  /** Respuesta que no abre ninguna pantalla con datos. */
  const say = (reply: string, action: "none" | "frequent" | "gps" = "none"): AgentReply => ({ reply, action, steps, engine })

  switch (intent.type) {
    case "greeting":
      return say("¡Hola! Soy el asistente de TransMiVoz. Pídeme cómo llegar a una estación, información de una ruta como la B23, o dónde estás.")

    case "help":
      return say(
        "Puedo decirte cómo llegar de una estación a otra, qué rutas pasan por una estación, el recorrido y el horario de una ruta, y la estación más cercana a ti. Por ejemplo: cómo llego de Ricaurte a Calle 72.",
      )

    case "cancel":
      return say("Listo, cancelado.")

    case "unsupported":
      return say(
        intent.topic === "tarifas"
          ? "Todavía no tengo información de tarifas. Puedo ayudarte con rutas, estaciones y horarios."
          : "Todavía no tengo la ubicación de los buses en tiempo real. Puedo decirte el horario de la ruta y por dónde pasa.",
      )

    case "frequent":
      steps.push({ label: "Abrí tus rutas frecuentes" })
      return say("Estas son tus rutas frecuentes.", "frequent")

    case "gps": {
      if (context.position) {
        const [nearest] = nearestStations(context.position, data, 1)
        steps.push({ label: "Usé tu ubicación", detail: `La estación más cercana es ${nearest.name}` })
        return say(
          `La estación más cercana es ${nearest.name}, a ${spokenDistance(nearest.distance)}. Abro el GPS auditivo para guiarte.`,
          "gps",
        )
      }
      return say("Voy a abrir el GPS auditivo para guiarte a la estación más cercana.", "gps")
    }

    case "route_info":
    case "schedule": {
      const route = data.routes.find((r) => r.code === intent.routeCode)
      if (!route) return say(`No encontré la ruta ${intent.routeCode}.`)
      steps.push({ label: `Busqué la ruta ${route.code}`, detail: route.label })

      const weekday = bare(route.schedule.weekday) || "sin horario publicado"
      if (intent.type === "schedule") {
        const saturday = route.schedule.saturday ? ` Sábados: ${bare(route.schedule.saturday)}.` : ""
        const holiday = route.schedule.holiday ? ` Festivos: ${bare(route.schedule.holiday)}.` : ""
        return { reply: `La ${route.code} opera entre semana de ${weekday}.${saturday}${holiday}`, action: "route", routeCode: route.code, steps, engine }
      }
      steps.push({ label: "Revisé su recorrido", detail: `${route.stops.length} estaciones` })
      const sample = route.stops.slice(1, 4).join(", ")
      return {
        reply: `La ${route.code} va de ${route.from} hacia ${route.to}. Pasa por ${route.stops.length} estaciones, entre ellas ${sample}. Entre semana opera de ${weekday}.`,
        action: "route",
        routeCode: route.code,
        steps,
        engine,
      }
    }

    case "trip": {
      const destination = resolvePlace(intent.destination, data)
      if (!destination) return say(`No encontré la estación ${intent.destination}. Prueba con otro nombre, por ejemplo Ricaurte o Calle 72.`)
      steps.push({ label: `Busqué la estación de destino`, detail: destination.name })

      let origin = intent.origin ? resolvePlace(intent.origin, data) : undefined
      if (intent.origin && origin) {
        steps.push({ label: "Busqué la estación de origen", detail: origin.name })
      } else if (!origin && context.position) {
        const [nearest] = nearestStations(context.position, data, 1)
        origin = placeOf(nearest, data)
        steps.push({ label: "Usé tu ubicación", detail: `Estás a ${spokenDistance(nearest.distance)} de ${nearest.name}` })
      }

      if (!origin) {
        const routes = routesThrough(destination, data)
        steps.push({ label: "Busqué las rutas que pasan por ahí", detail: `${routes.length} rutas` })
        if (routes.length === 0) return say(`Ninguna ruta troncal pasa por ${destination.name}.`)
        return {
          reply: `${routes.length} ${routes.length === 1 ? "ruta pasa" : "rutas pasan"} por ${destination.name}: ${listCodes(routes.map((r) => r.code))}. Si me dices desde dónde sales, o activas tu ubicación, te digo cuál tomar.`,
          action: "search",
          station: destination.name,
          steps,
          engine,
        }
      }

      if (samePlace(origin, destination)) return say(`Ya estás en ${destination.name}.`)

      const plans = planTrip({ origin, destination }, data)
      steps.push({
        label: `Revisé las ${data.routes.length} rutas troncales`,
        detail:
          plans.length === 0
            ? "Sin combinación con uno o dos buses"
            : plans[0].length === 1
              ? `${plans.length} ${plans.length === 1 ? "ruta directa" : "rutas directas"}`
              : "Con un transbordo",
      })
      if (plans.length === 0) {
        return say(`No encontré cómo ir de ${origin.name} a ${destination.name} con uno o dos buses troncales.`)
      }
      const [best, ...others] = plans
      steps.push({ label: "Elegí la opción con menos estaciones", detail: best.map((l) => l.route.code).join(" + ") })
      const alternatives =
        best.length === 1 && others.length > 0 ? ` También te sirven ${listCodes(others.map((p) => p[0].route.code))}.` : ""
      return { reply: `${describePlan(best)}${alternatives}`, action: "trip", trip: summarize(best), steps, engine }
    }

    case "trip_missing_destination":
      return say(`Entendí que sales de ${intent.origin}. ¿A qué estación quieres ir?`)

    case "unknown":
      return say("No te entendí. Puedes decir, por ejemplo: cómo llego a Ricaurte, o información de la ruta B23.")
  }
}

/** Interpreta y resuelve una frase por reglas, sin red ni modelo. */
export function interpretCommand(text: string, data: TransmilenioData, context: AgentContext = {}): AgentReply {
  return runIntent(parseIntent(text, data), { data, context })
}
