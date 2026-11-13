import {
  estadoOperacionEnParada,
  paradaCoincideConEstacion,
  paradaPrescriptible,
  rutaConParadasVerificadas,
  secuenciaAtendidaValida,
  sentidoConfirmado,
} from "@/lib/evidencia"
import { distanceMeters, type LatLng } from "@/lib/geo"
import { contentWords, normalize } from "@/lib/text"
import type { BusRoute, ServedStop, Station, TransmilenioData } from "@/lib/transmilenio"

export type { BusRoute, ServedStop, Station, TransmilenioData }

export type StationWithDistance = Station & { distance: number }

/**
 * Un lugar al que la gente se refiere con un solo nombre, aunque TransMilenio
 * lo publique como varias estaciones. "Ricaurte" son "Ricaurte - CL 13" y
 * "Ricaurte - NQS"; una ruta sirve si pasa por cualquiera de las dos.
 */
export type Place = {
  name: string
  stations: Station[]
}

type Index = {
  keys: { key: string; place: Place }[]
  /** Lugar agrupado por nombre corto: "ricaurte" → las dos estaciones Ricaurte. */
  groups: Map<string, Place>
  byCode: Map<string, BusRoute>
}

const indexes = new WeakMap<TransmilenioData, Index>()

/** Nombre corto de una estación: lo que va antes del guion, sin "Temporal". */
export function shortName(name: string): string {
  return name.split(/\s[-–]\s/)[0].replace(/^Temporal\s+/i, "").trim()
}

/** Claves genéricas que, solas, no identifican una estación. */
const GENERIC_KEYS = new Set(["temporal", "portal", "calle", "avenida", "carrera"])

function buildIndex(data: TransmilenioData): Index {
  const places = new Map<string, Place>()
  const keys = new Map<string, Place>()

  for (const station of data.stations) {
    const short = shortName(station.name)
    const shortKey = normalize(short)
    const place = places.get(shortKey) ?? { name: short, stations: [] }
    place.stations.push(station)
    places.set(shortKey, place)

    // El nombre completo apunta solo a esta estación; el corto, al grupo.
    const fullKey = normalize(station.name)
    if (fullKey !== shortKey && !keys.has(fullKey)) keys.set(fullKey, { name: station.name, stations: [station] })
    if (!GENERIC_KEYS.has(shortKey) && !keys.has(shortKey)) keys.set(shortKey, place)
  }

  const byCode = new Map(data.routes.map((r) => [normalize(r.code).replace(/\s/g, ""), r]))
  return { keys: [...keys].map(([key, place]) => ({ key, place })), groups: places, byCode }
}

function getIndex(data: TransmilenioData): Index {
  let index = indexes.get(data)
  if (!index) {
    index = buildIndex(data)
    indexes.set(data, index)
  }
  return index
}

/**
 * Estaciones mencionadas en un texto, en el orden en que aparecen.
 * Gana la coincidencia más larga: "Suba Calle 100" es una estación, no
 * "Suba" más "Calle 100".
 */
export function findPlaces(text: string, data: TransmilenioData): Place[] {
  return findPlaceMentions(text, data).map((m) => m.place)
}

export type PlaceMention = {
  place: Place
  /** Palabras normalizadas que van justo antes de la mención. */
  before: string
  /** Todo el texto normalizado que precede a la mención (para leer un origen no catalogado). */
  prefix: string
  /** Todo el texto normalizado que sigue a la mención (para leer «…a X desde Y»). */
  suffix: string
}

/** Como `findPlaces`, pero con las palabras que preceden a cada mención. */
export function findPlaceMentions(text: string, data: TransmilenioData): PlaceMention[] {
  const t = ` ${normalize(text)} `
  const found: { start: number; end: number; place: Place }[] = []

  const candidates = getIndex(data).keys
    .map(({ key, place }) => ({ key, place, start: t.indexOf(` ${key} `) }))
    .filter((c) => c.start >= 0)
    .sort((a, b) => b.key.length - a.key.length)

  for (const c of candidates) {
    const end = c.start + c.key.length + 1
    const overlaps = found.some((f) => c.start < f.end && f.start < end)
    const duplicate = found.some((f) => f.place === c.place)
    if (!overlaps && !duplicate) found.push({ start: c.start, end, place: c.place })
  }

  return found
    .sort((a, b) => a.start - b.start)
    .map((f) => ({
      place: f.place,
      before: t.slice(Math.max(0, f.start - 30), f.start).trim(),
      prefix: t.slice(0, f.start).trim(),
      suffix: t.slice(f.end).trim(),
    }))
}

/**
 * Ruta cuyo código aparece en el texto: "la B23", "ruta h 54", "K86". También
 * reconoce códigos con el número primero y una letra, como "8 G" / "8 T", para
 * poder consultar los dos servicios cuya dirección se reconcilió con GTFS en el
 * issue #31. No pretende resolver los 16 códigos del issue #32; es el soporte
 * mínimo para los servicios ya corroborados, que se resuelven contra el índice
 * del catálogo (sin asumir un formato fijo).
 */
export function findRouteByCode(text: string, data: TransmilenioData): BusRoute | undefined {
  const byCode = getIndex(data).byCode
  const t = normalize(text)
  // Forma habitual: 1-2 letras, número, 0-2 letras ("b23", "h54", "k86").
  for (const match of t.matchAll(/\b([a-z]{1,2})\s?(\d{1,2})([a-z]{0,2})\b/g)) {
    const route = byCode.get(`${match[1]}${match[2]}${match[3]}`)
    if (route) return route
  }
  // Forma número-letra ("8 g", "8 t"): se busca en el índice del catálogo.
  for (const match of t.matchAll(/\b(\d{1,2})\s?([a-z])\b/g)) {
    const route = byCode.get(`${match[1]}${match[2]}`)
    if (route) return route
  }
  return undefined
}

/**
 * Índice de una estación del lugar dentro de las estaciones CERCANAS AL
 * TRAZADO de la ruta. Que esté en el trazado no prueba que el servicio pare;
 * sirve para saber qué rutas pasan cerca, no para planear un abordaje.
 */
const passesThroughAt = (route: BusRoute, place: Place): number =>
  route.stops.findIndex((stop) => place.stations.some((s) => s.name === stop))

/**
 * Rutas cuyo RECORRIDO pasa por un lugar (por cercanía al trazado). No implica
 * que el servicio se detenga allí; para eso hacen falta paradas verificadas.
 * Se conserva el nombre `routesThrough` por compatibilidad con los llamadores.
 */
export function routesThrough(place: Place, data: TransmilenioData): BusRoute[] {
  return data.routes.filter((route) => passesThroughAt(route, place) >= 0)
}

/** ¿El lugar aparece en el recorrido (trazado) de la ruta? */
export function passesThrough(route: BusRoute, place: Place): boolean {
  return passesThroughAt(route, place) >= 0
}

/**
 * Servicio que puede sustentar un plan: secuencia de paradas coherente y sentido
 * confirmado. Sin sentido confirmado el orden de las paradas no dice hacia
 * dónde va el bus, así que no se planea.
 */
const rutaPlaneable = (route: BusRoute): boolean => secuenciaAtendidaValida(route.servedStops) && sentidoConfirmado(route)

/**
 * ¿Se puede abordar aquí? Parada prescriptible que permite abordar y, si
 * `conOperacion`, con la hora actual dentro de su franja programada. Sin
 * `conOperacion` solo se comprueba la evidencia de la parada (candidatos que
 * todavía no se pueden presentar como operativos).
 */
const abordable = (route: BusRoute, stop: ServedStop, now: Date, conOperacion: boolean): boolean =>
  stop.canBoard &&
  paradaPrescriptible(stop, now) &&
  (!conOperacion || estadoOperacionEnParada(route.verifiedCalendar, stop, now) === "en-franja")

const descendible = (stop: ServedStop, now: Date): boolean => stop.canAlight && paradaPrescriptible(stop, now)

/** Dos registros de parada son la misma estación: mismo nombre y, si ambos traen nodo, el mismo. */
const mismaEstacion = (a: ServedStop, b: ServedStop): boolean =>
  a.name === b.name && (a.nodeId === undefined || b.nodeId === undefined || Number(a.nodeId) === Number(b.nodeId))

/** Qué papel cumple la parada buscada: dónde se sube o dónde se baja. */
type RolParada = "abordaje" | "descenso"

/**
 * Parada ATENDIDA del lugar en la ruta, o `undefined` si la fuente no confirma
 * que el servicio pare allí. Devuelve el REGISTRO que realmente coincidió (no se
 * busca por `order`, que podría estar duplicado o ser ambiguo).
 */
const paradaAtendidaDelLugar = ({
  ruta,
  lugar,
  rol,
  ahora,
  conOperacion,
}: {
  ruta: BusRoute
  lugar: Place
  rol: RolParada
  ahora: Date
  conOperacion: boolean
}): ServedStop | undefined => {
  if (!rutaPlaneable(ruta)) return undefined
  for (const stop of ruta.servedStops) {
    if (rol === "abordaje" ? !abordable(ruta, stop, ahora, conOperacion) : !descendible(stop, ahora)) continue
    if (lugar.stations.some((s) => paradaCoincideConEstacion(stop, s))) return stop
  }
  return undefined
}

/**
 * ¿El servicio tiene paradas atendidas verificadas, utilizables ahora? Delega
 * en el validador compartido: sentido confirmado, secuencia coherente y al
 * menos una parada prescriptible. Para marcar paradas una por una usar
 * `paradasPrescriptibles`.
 */
export function hasVerifiedServedStops(route: BusRoute, now: Date = new Date()): boolean {
  return rutaConParadasVerificadas(route, now)
}

/**
 * Rutas cuyo recorrido pasa por ambos lugares, para ofrecer INFORMACIÓN DE
 * RECORRIDO con incertidumbre cuando no hay paradas verificadas. No es un plan
 * de viaje: no afirma que se pueda subir o bajar, solo que el trazado conecta
 * los dos lugares. Ordenadas por cuántas estaciones del trazado median.
 */
export function routesAlongBoth(origin: Place, destination: Place, data: TransmilenioData, limit = 3): BusRoute[] {
  return data.routes
    .map((route) => ({ route, a: passesThroughAt(route, origin), b: passesThroughAt(route, destination) }))
    .filter((r) => r.a >= 0 && r.b >= 0)
    .sort((x, y) => Math.abs(x.a - x.b) - Math.abs(y.a - y.b))
    .slice(0, limit)
    .map((r) => r.route)
}

/**
 * Búsqueda de rutas para la pantalla de búsqueda. En orden de prioridad:
 * un código de ruta exacto, las rutas que pasan por una estación mencionada,
 * y por último las rutas cuyo origen o destino contienen todas las palabras.
 */
export function searchRoutes(query: string, data: TransmilenioData): BusRoute[] {
  if (!normalize(query)) return []

  const byCode = findRouteByCode(query, data)
  if (byCode) return [byCode]

  const [place] = findPlaces(query, data)
  if (place) return routesThrough(place, data)

  const words = contentWords(query)
  if (words.length === 0) return []
  return data.routes.filter((route) => {
    const haystack = normalize(`${route.code} ${route.from} ${route.to}`)
    return words.every((word) => haystack.includes(word))
  })
}

export type TripLeg = {
  route: BusRoute
  board: string
  alight: string
  /**
   * Diferencia de posición entre subir y bajar. Campo heredado: solo es un
   * número de estaciones real cuando `conteoVerificado` es `true`.
   */
  stationsRidden: number
  /**
   * `true` solo si la fuente garantiza ese número en todos los viajes
   * programados que unen ambas paradas. Si es `false`, voz y pantalla deben
   * omitir la cantidad exacta de estaciones.
   */
  conteoVerificado: boolean
}

export type TripPlan = TripLeg[]

const tramo = (route: BusRoute, board: ServedStop, alight: ServedStop): TripLeg => ({
  route,
  board: board.name,
  alight: alight.name,
  stationsRidden: alight.order - board.order,
  conteoVerificado: board.conteoExacto === true && alight.conteoExacto === true,
})

/**
 * Transbordo verificado: una estación donde el primer servicio permite
 * descender y el segundo permite abordar, con el primero llegando después de
 * subir y antes de que el segundo siga hacia el destino. Devuelve el registro
 * de parada de cada servicio (no se asume igualdad de `order` entre servicios
 * distintos), o `undefined` si no hay una conexión respaldada por paradas
 * atendidas vigentes y confirmada contra el catálogo (misma estación y nodo).
 */
function transbordoVerificado({
  primeraRuta,
  abordajePrimera,
  segundaRuta,
  descensoSegunda,
  ahora,
  conOperacion,
  estaciones,
}: {
  primeraRuta: BusRoute
  abordajePrimera: ServedStop
  segundaRuta: BusRoute
  descensoSegunda: ServedStop
  ahora: Date
  conOperacion: boolean
  estaciones: Station[]
}): { descensoPrimera: ServedStop; abordajeSegunda: ServedStop } | undefined {
  for (const stop of primeraRuta.servedStops) {
    if (!descendible(stop, ahora) || stop.order <= abordajePrimera.order) continue
    const match = segundaRuta.servedStops.find(
      (s) =>
        abordable(segundaRuta, s, ahora, conOperacion) &&
        mismaEstacion(s, stop) &&
        s.order < descensoSegunda.order &&
        estaciones.some((e) => paradaCoincideConEstacion(stop, e) && paradaCoincideConEstacion(s, e)),
    )
    if (match) return { descensoPrimera: stop, abordajeSegunda: match }
  }
  return undefined
}

function buscarPlanes(
  { origin, destination }: { origin: Place; destination: Place },
  data: TransmilenioData,
  limit: number,
  now: Date,
  conOperacion: boolean,
): TripPlan[] {
  const direct: TripPlan[] = []
  for (const route of data.routes) {
    const board = paradaAtendidaDelLugar({ ruta: route, lugar: origin, rol: "abordaje", ahora: now, conOperacion })
    const alight = paradaAtendidaDelLugar({ ruta: route, lugar: destination, rol: "descenso", ahora: now, conOperacion })
    if (board && alight && alight.order > board.order) direct.push([tramo(route, board, alight)])
  }
  if (direct.length > 0) return rank(direct).slice(0, limit)

  const transfers: TripPlan[] = []
  const fromOrigin = data.routes
    .map((route) => ({ route, board: paradaAtendidaDelLugar({ ruta: route, lugar: origin, rol: "abordaje", ahora: now, conOperacion }) }))
    .filter((r): r is { route: BusRoute; board: ServedStop } => r.board !== undefined)
  const toDestination = data.routes
    .map((route) => ({ route, alight: paradaAtendidaDelLugar({ ruta: route, lugar: destination, rol: "descenso", ahora: now, conOperacion }) }))
    .filter((r): r is { route: BusRoute; alight: ServedStop } => r.alight !== undefined)

  for (const first of fromOrigin) {
    for (const second of toDestination) {
      if (first.route === second.route) continue
      const transfer = transbordoVerificado({
        primeraRuta: first.route,
        abordajePrimera: first.board,
        segundaRuta: second.route,
        descensoSegunda: second.alight,
        ahora: now,
        conOperacion,
        estaciones: data.stations,
      })
      if (!transfer) continue
      transfers.push([
        tramo(first.route, first.board, transfer.descensoPrimera),
        tramo(second.route, transfer.abordajeSegunda, second.alight),
      ])
    }
  }
  return rank(transfers).slice(0, limit)
}

/** Planes que se piden a la vez: el primero es el mejor y los demás, sus alternativas. */
export const MAX_PLANES_VIAJE = 3

/**
 * Códigos de las ALTERNATIVAS de un viaje operativo, las que la web dice con «También te sirven…»
 * (`lib/local-agent.ts`): las demás rutas directas, de menos a más estaciones. Si el mejor plan lleva un
 * transbordo no hay alternativas: ningún otro plan se ofrece como opción.
 */
export function alternativasDelViaje(planes: TripPlan[]): string[] {
  const [mejor, ...otros] = planes
  return mejor?.length === 1 ? otros.map((plan) => plan[0].route.code) : []
}

/**
 * Planea un VIAJE OPERATIVO de un lugar a otro usando solo PARADAS ATENDIDAS
 * verificadas y vigentes, con sentido confirmado y con la hora actual dentro de
 * la franja programada de la parada de abordaje (calendario de Bogotá,
 * excepciones y madrugada incluidas): primero rutas directas, y si no hay,
 * combinaciones con un transbordo verificado. Devuelve los planes ordenados de
 * menos a más estaciones recorridas.
 *
 * Es la única puerta para dar órdenes de subir/bajar. Nunca convierte una
 * estación cercana al trazado en abordaje: si ningún servicio cumple, devuelve
 * `[]` y el asistente ofrece información con incertidumbre (ver
 * `planTripCandidato` y `lib/local-agent.ts`). La validación vive en
 * `lib/evidencia.ts` para que todos los consumidores decidan igual. No hay
 * tiempo real: estar en franja no implica que salga un bus ya.
 *
 * ponytail: prueba todos los pares de rutas para el transbordo (124² ≈ 15 000
 * combinaciones), que es instantáneo con los datos troncales. Si algún día se
 * suman las 567 rutas zonales, conviene un índice por estación.
 */
export function planTrip(
  places: { origin: Place; destination: Place },
  data: TransmilenioData,
  limit = MAX_PLANES_VIAJE,
  now: Date = new Date(),
): TripPlan[] {
  return buscarPlanes(places, data, limit, now, true)
}

/**
 * Como `planTrip` pero sin exigir que el servicio esté en franja ahora: viajes
 * con paradas y sentido verificados cuya operación actual NO está confirmada
 * (fuera de franja, hoy sin servicio o calendario sin verificar). Sirven para
 * informar un CANDIDATO, nunca para dar órdenes de subir o bajar.
 */
export function planTripCandidato(
  places: { origin: Place; destination: Place },
  data: TransmilenioData,
  limit = 3,
  now: Date = new Date(),
): TripPlan[] {
  return buscarPlanes(places, data, limit, now, false)
}

/** Tramo serializado de un resumen de viaje, como llega a una pantalla. */
export type TripLegRef = { routeCode: string; board: string; alight: string; stationsRidden?: number; conteoVerificado?: boolean }

/**
 * Revalida un resumen de viaje (tramos ya serializados) contra el catálogo y
 * la evidencia ACTUAL, antes de que una pantalla —o la voz— dé órdenes de
 * subir/bajar. Aplica las mismas reglas que `planTrip`: máximo un transbordo,
 * cada tramo con ruta existente, sentido confirmado, paradas prescriptibles
 * del catálogo en el orden correcto y abordaje dentro de la franja programada;
 * si hay transbordo, la misma estación de bajada y de subida en rutas
 * distintas. Un conteo declarado debe ser el que la fuente garantiza. Devuelve
 * `false` ante un esquema viejo, otro origen de datos o falta de evidencia.
 */
export function tripSummaryStillValid(legs: TripLegRef[], data: TransmilenioData, now: Date = new Date()): boolean {
  if (!Array.isArray(legs) || legs.length < 1 || legs.length > 2) return false
  const paradas: { board: ServedStop; alight: ServedStop }[] = []
  for (const leg of legs) {
    const route = data.routes.find((r) => r.code === leg.routeCode)
    if (!route || !rutaPlaneable(route)) return false
    const board = route.servedStops.find(
      (s) => s.name === leg.board && abordable(route, s, now, true) && data.stations.some((e) => paradaCoincideConEstacion(s, e)),
    )
    const alight = route.servedStops.find(
      (s) => s.name === leg.alight && descendible(s, now) && data.stations.some((e) => paradaCoincideConEstacion(s, e)),
    )
    if (!board || !alight || alight.order <= board.order) return false
    const real = tramo(route, board, alight)
    if (leg.stationsRidden !== undefined && leg.stationsRidden !== real.stationsRidden) return false
    if (leg.conteoVerificado === true && !real.conteoVerificado) return false
    paradas.push({ board, alight })
  }
  if (legs.length === 2) {
    if (legs[0].routeCode === legs[1].routeCode) return false
    if (!mismaEstacion(paradas[0].alight, paradas[1].board)) return false
  }
  return true
}

const totalStations = (plan: TripPlan) => plan.reduce((sum, leg) => sum + leg.stationsRidden, 0)

function rank(plans: TripPlan[]): TripPlan[] {
  return plans.sort((a, b) => a.length - b.length || totalStations(a) - totalStations(b))
}

/** Estaciones cercanas que lista el GPS auditivo. */
export const MAX_ESTACIONES_CERCANAS = 4

/** Estaciones ordenadas por cercanía a una coordenada. */
export function nearestStations(from: LatLng, data: TransmilenioData, limit = MAX_ESTACIONES_CERCANAS): StationWithDistance[] {
  return data.stations
    .map((station) => ({ ...station, distance: distanceMeters(from, station) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
}

/**
 * Lugares del catálogo ordenados por nombre, para elegir origen y destino de una
 * lista (EA-25, #51) en vez de escribirlos en una frase.
 */
export function listarLugares(data: TransmilenioData): Place[] {
  return [...getIndex(data).groups.values()].sort((a, b) => a.name.localeCompare(b.name, "es"))
}

/**
 * Lugar por su NOMBRE EXACTO, el que devuelve `listarLugares`. No interpreta
 * frases: «de Ricaurte a Calle 72» no es un lugar. Devuelve el mismo objeto del
 * índice, que es el que compara `samePlace`.
 */
export function lugarPorNombre(nombre: string, data: TransmilenioData): Place | undefined {
  return getIndex(data).groups.get(normalize(nombre))
}

/**
 * Lugar al que pertenece una estación, agrupado por nombre corto: la estación
 * "Ricaurte - CL 13" pertenece al lugar "Ricaurte", igual que "Ricaurte - NQS".
 */
export function placeOf(station: Station, data: TransmilenioData): Place {
  return getIndex(data).groups.get(normalize(shortName(station.name))) ?? { name: station.name, stations: [station] }
}

/** Dos lugares son el mismo si comparten alguna estación. */
export function samePlace(a: Place, b: Place): boolean {
  return a.stations.some((s) => b.stations.includes(s))
}

/** Rutas sugeridas mientras la persona no ha guardado ninguna. */
export const DEFAULT_FAVORITES = ["B23", "H54", "M83"]
