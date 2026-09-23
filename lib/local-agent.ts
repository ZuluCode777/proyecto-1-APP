import { spokenDistance, type LatLng } from "@/lib/geo"
import {
  findPlaces,
  findRouteByCode,
  nearestStations,
  placeOf,
  planTrip,
  routesThrough,
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
  | { type: "unsupported"; topic: "tarifas" | "tiempo_real" }
  | { type: "unknown" }

export type AgentAction = "search" | "frequent" | "gps" | "route" | "trip" | "none"

export type AgentStep = {
  label: string
  detail?: string
}

/** Tramo de un viaje, en forma serializable para enviarlo al navegador. */
export type TripLegSummary = {
  routeCode: string
  board: string
  alight: string
  stationsRidden: number
}

export type AgentReply = {
  reply: string
  action: AgentAction
  /** Búsqueda (nombre de estación) o código de ruta, según la acción. */
  query: string
  steps: AgentStep[]
  /** Solo cuando `action` es "trip". */
  trip?: TripLegSummary[]
  engine: "reglas" | "ollama"
}

export type AgentContext = {
  /** Ubicación de la persona, si dio permiso. */
  position?: LatLng
}

const has = (text: string, words: string[]) => words.some((w) => ` ${text} `.includes(` ${w} `))

const CANCEL = ["cancela", "cancelar", "olvidalo", "detente", "no gracias", "dejalo"]
const HELP = ["ayuda", "que puedes hacer", "como funciona", "que sabes hacer", "que haces"]
const FARE = ["tarifa", "tarifas", "pasaje", "cuanto cuesta", "cuanto vale", "precio", "recarga", "recargar"]
const REALTIME = ["cuanto se demora", "cuanto falta", "tiempo real", "a que hora llega", "donde viene"]
const SCHEDULE = ["horario", "horarios", "a que hora", "hora", "abre", "cierra", "opera", "funciona"]
const FREQUENT = ["frecuente", "frecuentes", "de siempre", "favorita", "favoritas", "guardadas"]
const GPS = ["gps", "ubicacion", "donde estoy", "cerca", "cercana", "cercanas", "caminar", "caminando", "a pie"]
const GREETING = ["hola", "buenos dias", "buenas tardes", "buenas noches", "buenas", "gracias", "muchas gracias"]

/** Interpreta una frase por reglas. */
export function parseIntent(text: string, data: TransmilenioData): Intent {
  const t = normalize(text)
  if (!t) return { type: "unknown" }

  if (has(t, CANCEL)) return { type: "cancel" }
  if (has(t, HELP)) return { type: "help" }
  if (has(t, FARE)) return { type: "unsupported", topic: "tarifas" }

  const route = findRouteByCode(text, data)
  if (route) {
    if (has(t, REALTIME)) return { type: "unsupported", topic: "tiempo_real" }
    return has(t, SCHEDULE) ? { type: "schedule", routeCode: route.code } : { type: "route_info", routeCode: route.code }
  }
  if (has(t, REALTIME)) return { type: "unsupported", topic: "tiempo_real" }

  if (has(t, FREQUENT)) return { type: "frequent" }

  const places = findPlaces(text, data)
  if (places.length >= 2) {
    return { type: "trip", origin: places[0].name, destination: places[places.length - 1].name }
  }
  if (places.length === 1) return { type: "trip", destination: places[0].name }

  if (has(t, GPS)) return { type: "gps" }
  if (has(t, GREETING)) return { type: "greeting" }
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
  data: TransmilenioData,
  context: AgentContext = {},
  engine: AgentReply["engine"] = "reglas",
): AgentReply {
  const steps: AgentStep[] = []
  const done = (reply: string, action: AgentAction = "none", query = "", trip?: TripLegSummary[]): AgentReply => ({
    reply,
    action,
    query,
    steps,
    trip,
    engine,
  })

  switch (intent.type) {
    case "greeting":
      return done("¡Hola! Soy el asistente de TransMiVoz. Pídeme cómo llegar a una estación, información de una ruta como la B23, o dónde estás.")

    case "help":
      return done(
        "Puedo decirte cómo llegar de una estación a otra, qué rutas pasan por una estación, el recorrido y el horario de una ruta, y la estación más cercana a ti. Por ejemplo: cómo llego de Ricaurte a Calle 72.",
      )

    case "cancel":
      return done("Listo, cancelado.")

    case "unsupported":
      return done(
        intent.topic === "tarifas"
          ? "Todavía no tengo información de tarifas. Puedo ayudarte con rutas, estaciones y horarios."
          : "Todavía no tengo la ubicación de los buses en tiempo real. Puedo decirte el horario de la ruta y por dónde pasa.",
      )

    case "frequent":
      steps.push({ label: "Abrí tus rutas frecuentes" })
      return done("Estas son tus rutas frecuentes.", "frequent")

    case "gps": {
      if (context.position) {
        const [nearest] = nearestStations(context.position, data, 1)
        steps.push({ label: "Usé tu ubicación", detail: `La estación más cercana es ${nearest.name}` })
        return done(
          `La estación más cercana es ${nearest.name}, a ${spokenDistance(nearest.distance)}. Abro el GPS auditivo para guiarte.`,
          "gps",
        )
      }
      return done("Voy a abrir el GPS auditivo para guiarte a la estación más cercana.", "gps")
    }

    case "route_info":
    case "schedule": {
      const route = data.routes.find((r) => r.code === intent.routeCode)
      if (!route) return done(`No encontré la ruta ${intent.routeCode}.`)
      steps.push({ label: `Busqué la ruta ${route.code}`, detail: route.label })

      const weekday = bare(route.schedule.weekday) || "sin horario publicado"
      if (intent.type === "schedule") {
        const saturday = route.schedule.saturday ? ` Sábados: ${bare(route.schedule.saturday)}.` : ""
        const holiday = route.schedule.holiday ? ` Festivos: ${bare(route.schedule.holiday)}.` : ""
        return done(`La ${route.code} opera entre semana de ${weekday}.${saturday}${holiday}`, "route", route.code)
      }
      steps.push({ label: "Revisé su recorrido", detail: `${route.stops.length} estaciones` })
      const sample = route.stops.slice(1, 4).join(", ")
      return done(
        `La ${route.code} va de ${route.from} hacia ${route.to}. Pasa por ${route.stops.length} estaciones, entre ellas ${sample}. Entre semana opera de ${weekday}.`,
        "route",
        route.code,
      )
    }

    case "trip": {
      const destination = resolvePlace(intent.destination, data)
      if (!destination) return done(`No encontré la estación ${intent.destination}. Prueba con otro nombre, por ejemplo Ricaurte o Calle 72.`)
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
        if (routes.length === 0) return done(`Ninguna ruta troncal pasa por ${destination.name}.`)
        return done(
          `${routes.length} ${routes.length === 1 ? "ruta pasa" : "rutas pasan"} por ${destination.name}: ${listCodes(routes.map((r) => r.code))}. Si me dices desde dónde sales, o activas tu ubicación, te digo cuál tomar.`,
          "search",
          destination.name,
        )
      }

      if (origin === destination) return done(`Ya estás en ${destination.name}.`)

      const plans = planTrip(origin, destination, data)
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
        return done(`No encontré cómo ir de ${origin.name} a ${destination.name} con uno o dos buses troncales.`)
      }
      const [best, ...others] = plans
      steps.push({ label: "Elegí la opción con menos estaciones", detail: best.map((l) => l.route.code).join(" + ") })
      const alternatives =
        best.length === 1 && others.length > 0 ? ` También te sirven ${listCodes(others.map((p) => p[0].route.code))}.` : ""
      return done(`${describePlan(best)}${alternatives}`, "trip", `${origin.name} → ${destination.name}`, summarize(best))
    }

    case "unknown":
      return done("No te entendí. Puedes decir, por ejemplo: cómo llego a Ricaurte, o información de la ruta B23.")
  }
}

/** Interpreta y resuelve una frase por reglas, sin red ni modelo. */
export function interpretCommand(text: string, data: TransmilenioData, context: AgentContext = {}): AgentReply {
  if (!text.trim()) {
    return runIntent({ type: "unknown" }, data, context)
  }
  return runIntent(parseIntent(text, data), data, context)
}
