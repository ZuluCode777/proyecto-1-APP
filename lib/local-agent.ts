import { z } from "zod"
import { spokenDistance, type LatLng } from "@/lib/geo"
import { decisionLlegada, ubicacionVigente, type LecturaUbicacion } from "@/lib/ubicacion"
import { estadoCalendarioEnFecha } from "@/lib/evidencia"
import {
  findPlaceMentions,
  findPlaces,
  findRouteByCode,
  nearestStations,
  placeOf,
  planTrip,
  planTripCandidato,
  tripSummaryStillValid,
  routesAlongBoth,
  routesThrough,
  samePlace,
  type BusRoute,
  type Place,
  type TransmilenioData,
  type TripPlan,
} from "@/lib/routes"
import { interpretarMetro, responderMetro, type ConsultaMetro } from "@/lib/metro"
import { RESPUESTA_SEGURIDAD_FISICA, esPreguntaSeguridadFisica } from "@/lib/seguridad-fisica"
import { normalize } from "@/lib/text"
import { catalogoAntiguo, procedenciaCatalogo } from "@/lib/transmilenio"

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
  /** Consulta informativa del Metro futuro (EA-13): nunca viaje, GPS ni abordaje. */
  | { type: "metro"; consulta: ConsultaMetro }
  /** Pregunta de permiso físico («¿ya puedo cruzar?»): solo explica el límite, sin acción. */
  | { type: "seguridad_fisica" }
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
  /** Solo si es `true` puede decirse el número exacto de estaciones. */
  conteoVerificado: z.boolean().default(false),
})
export type TripLegSummary = z.infer<typeof TripLegSummarySchema>

const ReplyBaseSchema = z.object({
  reply: z.string(),
  steps: z.array(AgentStepSchema),
  engine: z.enum(["reglas", "ollama"]),
  /**
   * Procedencia del catálogo de una respuesta con datos (EA-17, #43): la misma
   * frase que cierra `reply` y si el catálogo es antiguo. La usa el cliente de
   * iPhone, que no muestra el texto de un viaje y no tiene catálogo propio.
   * Opcional: solo la llevan las acciones con datos.
   */
  catalogo: z.object({ procedencia: z.string(), antiguo: z.boolean() }).optional(),
  /**
   * Aclaración pendiente (EA-19, #45): la persona dijo de dónde sale y falta el
   * destino. El servidor no guarda nada entre turnos; el cliente de iPhone
   * conserva este origen y lo reenvía como `pendiente` con la pregunta siguiente
   * (ver `conOrigenPendiente`). Opcional: solo la lleva esa respuesta.
   */
  aclaracion: z.object({ origen: z.string() }).optional(),
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

/**
 * Guardia que debe pasar una respuesta ANTES de hablarla, subtitularla o abrir
 * una pantalla: una respuesta de viaje se revalida contra el catálogo y la
 * evidencia actuales (mismas reglas que `planTrip`); las demás acciones no dan
 * órdenes de abordaje. Si devuelve `false`, no se prescribe nada.
 */
export function respuestaPrescriptivaValida(reply: AgentReply, data: TransmilenioData, now: Date = new Date()): boolean {
  return reply.action !== "trip" || tripSummaryStillValid(reply.trip, data, now)
}

/**
 * ¿Un texto contiene una ORDEN de abordaje/descenso/transbordo? Detecta las
 * formas imperativas que solo deben aparecer en un plan verificado («Toma la X
 * en Y», «sube en», «bájate en», «cambia a/en»). No marca frases de
 * incertidumbre como «no puedo decirte dónde subir o bajar» ni «no te doy
 * indicaciones de abordaje», que mencionan esas palabras sin ordenar nada.
 */
export function contieneImperativoDeViaje(texto: string): boolean {
  const t = normalize(texto)
  return /\btoma la\b[^.]*\ben\b/.test(t) || /\bsube en\b/.test(t) || /\bbajate en\b/.test(t) || /\bcambia (a|en)\b/.test(t)
}

/**
 * ¿El texto y los pasos de una respuesta están LIBRES de órdenes de abordaje?
 * Decisión compartida por la voz (`TotalAgent.sanear`) y el diagnóstico
 * (`respuestaSeguraParaMostrar`), para que una abstención con «Toma la H72 en
 * Calle 127…» —en el texto o en un paso— se rechace igual en ambos. No depende
 * del catálogo: solo mira el contenido mostrable.
 */
export function respuestaSinImperativos(reply: AgentReply): boolean {
  if (contieneImperativoDeViaje(reply.reply)) return false
  return !reply.steps.some((s) => contieneImperativoDeViaje(s.label) || (s.detail ? contieneImperativoDeViaje(s.detail) : false))
}

/**
 * Guardia de CONTENIDO que debe cumplir una respuesta REAL del asistente antes
 * de mostrarse, hablarse o navegar. Frontera común con `TotalAgent` (que luego
 * reconstruye el texto de un viaje desde el resumen validado):
 *
 * - Un viaje (`trip`) es seguro solo si su resumen revalida contra el catálogo
 *   y el reloj actuales (paradas, sentido y franja). El texto mostrado se
 *   reconstruye, así que lo que importa es que el resumen sea prescriptible.
 * - Cualquier otra acción es insegura si su TEXTO o sus PASOS contienen órdenes
 *   de abordaje: una abstención con «Toma la H72 en Calle 127…» —en el texto o
 *   en un paso— es insegura aunque `action` sea `search`.
 *
 * Detecta tanto un viaje forjado/vencido como una abstención con instrucciones.
 */
export function respuestaSeguraParaMostrar(reply: AgentReply, data: TransmilenioData, now: Date = new Date()): boolean {
  if (reply.action === "trip") return tripSummaryStillValid(reply.trip, data, now)
  return respuestaSinImperativos(reply)
}

export type AgentContext = {
  /**
   * Ubicación de la persona, si dio permiso, CON precisión y hora de captura.
   * Solo se usa como origen aproximado cuando la frase no trae origen explícito,
   * y nunca confirma presencia física: la estación más cercana por GPS es una
   * referencia, no el lugar donde está la persona. Se revalida su frescura aquí
   * (EA-07, #33): una lectura vencida no se usa.
   */
  position?: LecturaUbicacion
  /** Instante actual, para evaluar vigencia de evidencia y calendario. */
  now?: Date
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

/**
 * Origen DECLARADO que no está en el catálogo (EA-07, #33). Se lee la cláusula
 * de origen con las mismas formas de `STRONG_ORIGIN`/`WEAK_ORIGIN`, antes o
 * después del destino:
 *
 * - fuerte (`desde`, `saliendo de`, `salgo de`, `parto de`, `estoy en`): X llega
 *   hasta la primera palabra que cierra la cláusula (`CORTE_ORIGEN`: conectores
 *   de destino, «y», «quiero»…), así «desde aquí para llegar a» deja «aquí».
 * - débil (`de`/`del`): solo en la forma «de X a|al|hacia|hasta|para Y», con X sin
 *   palabras de corte, para no tomar «la hora de salida para llegar a…».
 */
const ORIGEN_FUERTE = /(?:^|\s)(?:desde|saliendo de|salgo de|parto de|estoy en)\s+(.+)$/
const ORIGEN_DEBIL = /(?:^|\s)(?:de|del)\s+((?:\S+\s+){0,5}\S+)\s+(?:a|al|hacia|hasta|para)$/
const CORTE_ORIGEN = /\s(?:y|e|pero|luego|quiero|quisiera|necesito|voy|para|a|al|hacia|hasta|ir|llegar|como|cual|que)(?:\s|$)/
const RELLENO_INICIAL = /^(?:(?:la|el|los|las|estacion|parada|portal)\s+)+(?:de(?:l)?\s+)?/
/** Referencias genuinas a la ubicación actual: no son un origen que aclarar. */
const UBICACION_ACTUAL = /^(?:aqui|aca|ahi|aqui mismo|donde (?:estoy|me encuentro)|mi (?:ubicacion|posicion)(?: actual)?|(?:el )?gps)$/

function sinRellenoFinal(texto: string): string {
  let resto = ` ${texto}`
  while (TRAILING_FILLER.test(resto)) resto = resto.replace(TRAILING_FILLER, "")
  return resto.trim()
}

/** Limpia la cláusula `resto`; `undefined` si queda vacía o es la ubicación actual. */
function origenDeclarado(resto: string, exigirSinCorte = false): string | undefined {
  const texto = ` ${resto}`
  const recorte = texto.split(CORTE_ORIGEN)[0]
  if (exigirSinCorte && recorte !== texto) return undefined
  const origen = `${recorte.trim()} `.replace(RELLENO_INICIAL, "").trim()
  return origen && !UBICACION_ACTUAL.test(origen) ? origen : undefined
}

/**
 * Origen que la persona dijo y NO es una estación del catálogo, para el caso de
 * UNA sola mención (el destino). Mira antes y después del destino.
 */
function origenNoCatalogado(antes: string, despues: string): string | undefined {
  const fuerteAntes = ORIGEN_FUERTE.exec(antes)
  if (fuerteAntes) return origenDeclarado(fuerteAntes[1])
  const debil = ORIGEN_DEBIL.exec(sinRellenoFinal(antes))
  if (debil) return origenDeclarado(debil[1], true)
  const fuerteDespues = ORIGEN_FUERTE.exec(despues)
  return fuerteDespues ? origenDeclarado(fuerteDespues[1]) : undefined
}

function roleOf(before: string): Role {
  const rest = sinRellenoFinal(before)
  if (STRONG_ORIGIN.test(rest)) return "origin"
  if (DESTINATION.test(rest)) return "destination"
  if (WEAK_ORIGIN.test(rest)) return "weak-origin"
  return "none"
}

/** Interpreta una frase por reglas. */
export function parseIntent(text: string, data: TransmilenioData): Intent {
  const t = normalize(text)
  if (!t) return { type: "unknown" }

  // Alerta física (EA-27, #53): va primero, antes que el Metro, los viajes y el
  // GPS. El modelo nunca decide si es seguro cruzar ni abordar.
  if (esPreguntaSeguridadFisica(text)) return { type: "seguridad_fisica" }
  if (hasPhrase(t, CANCEL)) return { type: "cancel" }
  // El Metro se decide ANTES que la ayuda, tarifas, rutas, lugares y GPS: con
  // contexto explícito de Metro, una petición de viaje, tarifa u horario no puede
  // caer a los buses ni a la navegación de TransMilenio, y «ayuda» o «cómo
  // funciona» dentro de una frase de Metro no la convierte en la ayuda genérica.
  // «Cancela el metro» ya salió arriba (EA-13, #39).
  const metro = interpretarMetro(text)
  if (metro) return { type: "metro", consulta: metro }
  if (hasPhrase(t, HELP)) return { type: "help" }
  if (hasPhrase(t, FARE)) return { type: "unsupported", topic: "tarifas" }

  const route = findRouteByCode(text, data)
  if (route) {
    if (hasPhrase(t, REALTIME)) return { type: "unsupported", topic: "tiempo_real" }
    return hasPhrase(t, SCHEDULE) ? { type: "schedule", routeCode: route.code } : { type: "route_info", routeCode: route.code }
  }
  if (hasPhrase(t, REALTIME)) return { type: "unsupported", topic: "tiempo_real" }

  if (hasPhrase(t, FREQUENT)) return { type: "frequent" }

  const mentions = findPlaceMentions(text, data).map((m) => ({ name: m.place.name, role: roleOf(m.before), prefix: m.prefix, suffix: m.suffix }))
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
    // El índice deduplica lugares: «de Ricaurte a Ricaurte» conserva una mención.
    if (only.role === "origin" || only.role === "weak-origin") {
      const destino = /^(?:a|al|hacia|hasta|para)\s+(.+)$/.exec(only.suffix)?.[1]
      if (destino) return { type: "trip", origin: only.name, destination: resolvePlace(destino, data)?.name ?? destino }
    }
    // "salgo desde Ricaurte" sin destino: se entiende el origen, falta el destino.
    if (only.role === "origin") return { type: "trip_missing_destination", origin: only.name }
    // "desde/de Narnia a Ricaurte", "estoy en Narnia y quiero ir a Ricaurte",
    // "ir a Ricaurte desde Narnia": el origen explícito no está en el catálogo. Se
    // conserva para que `runIntent` pida aclararlo en vez de reemplazarlo por el
    // GPS, y para no pedir ni adjuntar la ubicación (EA-07, #33).
    const desconocido = origenNoCatalogado(only.prefix, only.suffix)
    if (desconocido) return { type: "trip", origin: desconocido, destination: only.name }
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

/**
 * Frase sobre la operación de un servicio HOY. Solo afirma servicio o falta de
 * servicio cuando el calendario verificado y vigente lo dice; si no, advierte
 * que no está verificado (desconocido no es "sin servicio"). Es del día, no de
 * la hora, y nunca afirma salida inmediata.
 */
function operacionHoy(route: BusRoute, now: Date = new Date()): string {
  switch (estadoCalendarioEnFecha(route.verifiedCalendar, now)) {
    case "opera":
      return "Según su calendario verificado, hoy tiene servicio programado; no es tiempo real, confirma el horario antes de salir."
    case "no-opera":
      return "Según su calendario verificado, hoy no tiene servicio programado."
    case "sin-verificar":
      return "No tengo un calendario vigente verificado para confirmar si opera hoy."
  }
}

const AVISO_PLAN =
  " Según el calendario y las franjas programadas que tengo verificadas, ahora hay servicio programado; no es tiempo real, confirma el horario antes de salir."

const summarize = (plan: TripPlan): TripLegSummary[] =>
  plan.map((leg) => ({
    routeCode: leg.route.code,
    board: leg.board,
    alight: leg.alight,
    stationsRidden: leg.stationsRidden,
    conteoVerificado: leg.conteoVerificado,
  }))

/**
 * Único formateador de la indicación de un viaje a partir del RESUMEN tipado
 * (`TripLegSummary[]`). Lo comparten `describePlan` y `textoViajeDesdeResumen`
 * para no duplicar el texto de viaje directo/transbordo ni la omisión del
 * conteo no garantizado. No incluye el aviso de operación ni las alternativas:
 * esos los añade quien llama. Mantiene la semántica exacta previa.
 */
function formatearViajeDesdeResumen(trip: TripLegSummary[]): string {
  if (trip.length === 1) {
    const [leg] = trip
    // Sin conteo garantizado por la fuente no se dice cuántas estaciones son.
    const conteo = leg.conteoVerificado
      ? `, después de ${leg.stationsRidden} ${leg.stationsRidden === 1 ? "estación" : "estaciones"}`
      : ""
    return `Toma la ${leg.routeCode} en ${leg.board} y bájate en ${leg.alight}${conteo}.`
  }
  const [first, second] = trip
  return `No hay una ruta directa. Toma la ${first.routeCode} en ${first.board} hasta ${first.alight}, y ahí cambia a la ${second.routeCode} hasta ${second.alight}.`
}

/** Indicación de un plan (modelo interno), con el aviso de operación programada. */
function describePlan(plan: TripPlan): string {
  return `${formatearViajeDesdeResumen(summarize(plan))}${AVISO_PLAN}`
}

/**
 * Reconstruye el texto y los pasos PRESCRIPTIVOS de un viaje a partir del
 * resumen serializado, revalidándolo antes contra el catálogo y el reloj
 * actuales (mismas reglas que `planTrip`). No confía en ningún texto libre que
 * venga con el resumen: arma la prosa con el mismo formateador responsable, y
 * omite el conteo exacto cuando la fuente no lo garantiza.
 *
 * Devuelve `null` si el resumen ya no es prescriptible (esquema viejo, otro
 * origen de datos, fuera de franja, sin evidencia vigente). Quien lo llame debe
 * entonces dar una respuesta segura, sin instrucciones.
 */
export function textoViajeDesdeResumen(
  trip: TripLegSummary[],
  data: TransmilenioData,
  now: Date = new Date(),
): { reply: string; steps: AgentStep[] } | null {
  if (!tripSummaryStillValid(trip, data, now)) return null
  const steps: AgentStep[] = [
    { label: "Verifiqué las paradas y el sentido con los datos actuales", detail: trip.map((l) => l.routeCode).join(" + ") },
  ]
  // La procedencia del catálogo también acompaña al texto reconstruido para la
  // voz, que no pasa por `runIntent.conProcedencia`.
  return { reply: `${formatearViajeDesdeResumen(trip)}${AVISO_PLAN} ${procedenciaCatalogo(data)}`, steps }
}

const resolvePlace = (name: string, data: TransmilenioData): Place | undefined => findPlaces(name, data)[0]

/**
 * Respuesta cuando las paradas y el sentido están verificados pero la operación
 * actual no se puede confirmar (fuera de franja, hoy sin servicio, calendario
 * vencido o ausente). Presenta el servicio como candidato, sin instruir subir,
 * bajar ni transbordar, y sin afirmar que no exista servicio.
 */
function tripCandidatoReply({
  plan,
  origin,
  destination,
  steps,
  engine,
}: {
  plan: TripPlan
  origin: Place
  destination: Place
  steps: AgentStep[]
  engine: AgentEngine
}): AgentReply {
  const codes = plan.map((leg) => leg.route.code)
  steps.push({ label: "Encontré un servicio candidato", detail: `${codes.join(" + ")}, sin operación confirmada ahora` })
  return {
    reply: `Según la programación que tengo verificada, ${codes.length === 1 ? "la ruta" : "las rutas"} ${listCodes(codes)} ${codes.length === 1 ? "conecta" : "conectan"} ${origin.name} con ${destination.name}, pero ahora no puedo confirmar que ${codes.length === 1 ? "esté" : "estén"} en servicio, así que no te doy indicaciones de abordaje. Confirma el horario con TransMilenio.`,
    action: "search",
    station: destination.name,
    steps,
    engine,
  }
}

/**
 * Respuesta cuando no hay paradas verificadas para armar un viaje operativo.
 * Ofrece INFORMACIÓN DE RECORRIDO con incertidumbre: nombra las rutas cuyo
 * trazado conecta origen y destino, sin instruir subir, bajar ni transbordar,
 * y sin afirmar que no exista ningún servicio. Abre la lista de rutas del
 * destino para que la persona explore el recorrido.
 */
function tripUncertainReply({
  origin,
  destination,
  data,
  steps,
  engine,
}: {
  origin: Place
  destination: Place
  data: TransmilenioData
  steps: AgentStep[]
  engine: AgentEngine
}): AgentReply {
  const along: BusRoute[] = routesAlongBoth(origin, destination, data)
  steps.push({
    label: "Busqué recorridos que conectan ambos lugares",
    detail: along.length > 0 ? `${along.length} ${along.length === 1 ? "ruta" : "rutas"} por el trazado` : "Sin recorrido directo en el trazado",
  })
  const base = `Todavía no tengo confirmado dónde para cada servicio entre ${origin.name} y ${destination.name}, así que no puedo decirte con certeza dónde subir o bajar.`
  if (along.length > 0) {
    return {
      reply: `${base} Por el recorrido, ${along.length === 1 ? "la ruta" : "las rutas"} ${listCodes(along.map((r) => r.code))} ${along.length === 1 ? "pasa" : "pasan"} cerca de los dos lugares; conviene confirmar las paradas con TransMilenio.`,
      action: "search",
      station: destination.name,
      steps,
      engine,
    }
  }
  return {
    reply: `${base} No tengo un recorrido troncal que conecte los dos lugares; puede existir un servicio que no tengo registrado, conviene confirmarlo con TransMilenio.`,
    action: "search",
    station: destination.name,
    steps,
    engine,
  }
}

/**
 * Acciones cuya respuesta presenta datos del catálogo y por eso debe citar su
 * procedencia (fuente y fecha). Un saludo, la ayuda o abrir el GPS no muestran
 * datos del catálogo, así que no la llevan.
 */
const ACCIONES_CON_DATOS: ReadonlySet<AgentAction> = new Set<AgentAction>(["route", "trip", "search"])

/**
 * Añade la procedencia del catálogo (fuente y fecha) al final del texto de una
 * respuesta que presenta datos, para que el texto Y la voz digan de dónde salen
 * los datos, y la deja también en `catalogo`, con su antigüedad, para el cliente
 * que no muestra ese texto. No la añade dos veces si ya está, ni a respuestas sin datos. La voz
 * de un VIAJE reconstruye su texto desde el resumen (`textoViajeDesdeResumen`),
 * que añade la procedencia por su cuenta; aquí se cubre el resto de acciones y
 * el texto inicial del viaje.
 */
function conProcedencia(reply: AgentReply, data: TransmilenioData, now: Date): AgentReply {
  if (!ACCIONES_CON_DATOS.has(reply.action)) return reply
  const aviso = procedenciaCatalogo(data)
  const catalogo = { procedencia: aviso, antiguo: catalogoAntiguo(data, now) }
  return { ...reply, reply: reply.reply.includes(aviso) ? reply.reply : `${reply.reply} ${aviso}`, catalogo }
}

/**
 * Resuelve una intención con los datos reales y devuelve la respuesta hablada,
 * citando la procedencia del catálogo en las respuestas que presentan datos.
 */
export function runIntent(
  intent: Intent,
  opciones: { data: TransmilenioData; context?: AgentContext; engine?: AgentEngine },
): AgentReply {
  return conProcedencia(resolverIntent(intent, opciones), opciones.data, opciones.context?.now ?? new Date())
}

/** Núcleo de resolución, sin añadir la procedencia (la añade `runIntent`). */
function resolverIntent(
  intent: Intent,
  { data, context = {}, engine = "reglas" }: { data: TransmilenioData; context?: AgentContext; engine?: AgentEngine },
): AgentReply {
  const steps: AgentStep[] = []
  /** Respuesta que no abre ninguna pantalla con datos. */
  const say = (reply: string, action: "none" | "frequent" | "gps" = "none"): AgentReply => ({ reply, action, steps, engine })

  // EA-07 (#33): la posición solo se usa si es evidencia VIGENTE (hora de
  // captura válida y reciente). Una lectura vencida, futura o sin hora se
  // descarta aquí, justo antes de resolver el efecto, no solo al recibirla.
  const posicionVigente = ubicacionVigente(context.position, (context.now ?? new Date()).getTime())

  switch (intent.type) {
    case "greeting":
      return say("¡Hola! Soy el asistente de TransMiVoz. Pídeme cómo llegar a una estación, información de una ruta como la B23, o dónde estás.")

    case "help":
      return say(
        "Puedo decirte cómo llegar de una estación a otra, qué rutas pasan por una estación, el recorrido y el horario de una ruta, y la estación más cercana a ti. También explico el Metro de Bogotá, que está en construcción y aún no tiene servicio: pregunta por el Metro o por una de sus estaciones. Por ejemplo: cómo llego de Ricaurte a Calle 72.",
      )

    case "cancel":
      return say("Listo, cancelado.")

    case "unsupported":
      return say(
        intent.topic === "tarifas"
          ? "Todavía no tengo información de tarifas. Puedo ayudarte con rutas, estaciones y horarios."
          : "Todavía no tengo la ubicación de los buses en tiempo real. Puedo decirte el horario de la ruta y por dónde pasa.",
      )

    case "metro": {
      // Solo informa (acción `none`): sin pantalla de viaje, GPS ni búsqueda de buses.
      const metro = responderMetro(intent.consulta)
      steps.push(...metro.steps)
      return say(metro.reply)
    }

    case "seguridad_fisica":
      // Sin acción ni pasos: no abre pantallas, no dice sí ni no.
      return say(RESPUESTA_SEGURIDAD_FISICA)

    case "frequent":
      steps.push({ label: "Abrí tus rutas frecuentes" })
      return say("Estas son tus rutas frecuentes.", "frequent")

    case "gps": {
      if (posicionVigente) {
        const [nearest] = nearestStations(posicionVigente, data, 1)
        if (!nearest) {
          // Catálogo sin estaciones (vacío o aún no cargado): no se inventa una
          // estación cercana; se abre el GPS igual para reintentar.
          steps.push({ label: "No tengo estaciones cargadas para ubicar la más cercana" })
          return say("Todavía no tengo las estaciones de TransMilenio para decirte la más cercana. Abro el GPS para reintentar.", "gps")
        }
        steps.push({ label: "Usé tu ubicación", detail: `La estación más cercana es ${nearest.name}` })
        return say(
          `La estación más cercana es ${nearest.name}, a ${spokenDistance(nearest.distance)}. Abro el GPS auditivo para guiarte. ${procedenciaCatalogo(data)}`,
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

      const weekday = bare(route.schedule.weekday)
      // El texto del horario NO es un calendario verificado: se cita como
      // horario publicado, sin afirmar operación ni salida inmediata.
      const horarioPublicado = weekday ? `Horario publicado entre semana: ${weekday}.` : "No tengo horario publicado entre semana."
      if (intent.type === "schedule") {
        const saturday = route.schedule.saturday ? ` Sábados: ${bare(route.schedule.saturday)}.` : ""
        const holiday = route.schedule.holiday ? ` Festivos: ${bare(route.schedule.holiday)}.` : ""
        const aviso = route.verifiedCalendar
          ? ` ${operacionHoy(route, context.now)}`
          : " Es el horario publicado, no un calendario verificado; confirma con TransMilenio antes de salir."
        return { reply: `${horarioPublicado}${saturday}${holiday}${aviso}`, action: "route", routeCode: route.code, steps, engine }
      }
      steps.push({ label: "Revisé su recorrido", detail: `${route.stops.length} estaciones cercanas al trazado` })
      const sample = route.stops.slice(1, 4).join(", ")
      return {
        reply: `La ${route.code} va de ${route.from} hacia ${route.to}. Su recorrido pasa cerca de ${route.stops.length} estaciones, entre ellas ${sample}. ${horarioPublicado} No tengo confirmado en cuáles para; para un viaje, dime origen y destino.`,
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
      /** ¿El origen se infirió del GPS (no lo dijo la persona)? */
      let origenPorGps = false
      if (intent.origin && origin) {
        steps.push({ label: "Busqué la estación de origen", detail: origin.name })
      } else if (intent.origin && !origin) {
        // Origen EXPLÍCITO que no se encontró: NO se reemplaza en silencio por el
        // GPS. Se pide aclararlo (la persona dijo de dónde sale; respetarlo).
        return say(
          `No encontré la estación de origen ${intent.origin}. Dime otro nombre, por ejemplo Ricaurte o Calle 72, o pídeme la ruta sin origen y uso tu ubicación.`,
        )
      } else if (!origin && posicionVigente) {
        const [nearest] = nearestStations(posicionVigente, data, 1)
        // Sin estaciones en el catálogo no se puede usar la ubicación como origen.
        if (nearest) {
          origin = placeOf(nearest, data)
          origenPorGps = true
          steps.push({ label: "Usé tu ubicación como origen aproximado", detail: `La estación más cercana es ${nearest.name}, a ${spokenDistance(nearest.distance)}` })
        }
      }

      if (!origin) {
        const routes = routesThrough(destination, data)
        steps.push({ label: "Busqué las rutas cuyo recorrido pasa por ahí", detail: `${routes.length} rutas` })
        if (routes.length === 0) {
          // El trazado no llega a la estación; no se afirma que ningún servicio exista.
          return {
            reply: `No tengo el recorrido de ninguna ruta troncal pasando por ${destination.name}. Puede que la sirva un servicio que no tengo registrado; conviene confirmarlo con TransMilenio.`,
            action: "search",
            station: destination.name,
            steps,
            engine,
          }
        }
        return {
          reply: `El recorrido de ${routes.length === 1 ? "una ruta troncal pasa" : `${routes.length} rutas troncales pasan`} por ${destination.name}: ${listCodes(routes.map((r) => r.code))}. No tengo confirmado dónde para cada servicio; dime desde dónde sales para mostrarte el recorrido.`,
          action: "search",
          station: destination.name,
          steps,
          engine,
        }
      }

      if (samePlace(origin, destination)) {
        if (!origenPorGps) {
          // Origen EXPLÍCITO igual al destino: coinciden, sin afirmar presencia.
          return say(`El origen y el destino que me diste coinciden: ambos son ${destination.name}.`)
        }
        // Origen inferido del GPS: la estación más cercana es el destino. Eso
        // estima CERCANÍA, no confirma que la persona esté en la estación ni que
        // haya llegado. Se expresa como proximidad estimada, con su límite, y se
        // ofrece guiar a pie en vez de dar un viaje de cero tramos.
        const [cercana] = nearestStations(posicionVigente!, data, 1)
        const prox = decisionLlegada(posicionVigente!, cercana?.distance ?? Infinity)
        const detalle = prox.llego
          ? `estás a unos ${spokenDistance(cercana.distance)} del punto de ${destination.name}`
          : `${destination.name} es la estación más cercana a tu ubicación estimada`
        return say(
          `Según tu ubicación, ${detalle}, pero es una estimación y el punto es una referencia aproximada, no un acceso verificado. Si quieres, abro el GPS para una orientación directa aproximada hacia ${destination.name}; no es una ruta peatonal validada.`,
          "gps",
        )
      }

      const now = context.now ?? new Date()
      const plans = planTrip({ origin, destination }, data, 3, now)
      steps.push({
        label: `Revisé las ${data.routes.length} rutas troncales`,
        detail:
          plans.length === 0
            ? "Sin viaje operativo confirmado ahora"
            : plans[0].length === 1
              ? `${plans.length} ${plans.length === 1 ? "ruta directa" : "rutas directas"}`
              : "Con un transbordo verificado",
      })
      if (plans.length === 0) {
        // Sin plan operativo no se instruye subir/bajar. Con paradas verificadas
        // pero operación sin confirmar se informa un candidato; si no, el
        // recorrido con incertidumbre. Nunca se afirma que no exista servicio.
        const [candidato] = planTripCandidato({ origin, destination }, data, 1, now)
        if (candidato) return tripCandidatoReply({ plan: candidato, origin, destination, steps, engine })
        return tripUncertainReply({ origin, destination, data, steps, engine })
      }
      const [best, ...others] = plans
      steps.push({ label: "Elegí la opción con menos estaciones", detail: best.map((l) => l.route.code).join(" + ") })
      const alternatives =
        best.length === 1 && others.length > 0 ? ` También te sirven ${listCodes(others.map((p) => p[0].route.code))}.` : ""
      return { reply: `${describePlan(best)}${alternatives}`, action: "trip", trip: summarize(best), steps, engine }
    }

    case "trip_missing_destination":
      return { ...say(`Entendí que sales de ${intent.origin}. ¿A qué estación quieres ir?`), aclaracion: { origen: intent.origin } }

    case "unknown":
      return say("No te entendí. Puedes decir, por ejemplo: cómo llego a Ricaurte, o información de la ruta B23.")
  }
}

/** Interpreta y resuelve una frase por reglas, sin red ni modelo. */
export function interpretCommand(text: string, data: TransmilenioData, context: AgentContext = {}): AgentReply {
  return runIntent(parseIntent(text, data), { data, context })
}
