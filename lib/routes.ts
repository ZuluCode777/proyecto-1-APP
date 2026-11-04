import { distanceMeters, type LatLng } from "@/lib/geo"
import { contentWords, normalize } from "@/lib/text"
import type { BusRoute, Station, TransmilenioData } from "@/lib/transmilenio"

export type { BusRoute, Station, TransmilenioData }

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
    .map((f) => ({ place: f.place, before: t.slice(Math.max(0, f.start - 30), f.start).trim() }))
}

/** Ruta cuyo código aparece en el texto: "la B23", "ruta h 54", "K86". */
export function findRouteByCode(text: string, data: TransmilenioData): BusRoute | undefined {
  const byCode = getIndex(data).byCode
  const t = normalize(text)
  for (const match of t.matchAll(/\b([a-z]{1,2})\s?(\d{1,2})([a-z]{0,2})\b/g)) {
    const route = byCode.get(`${match[1]}${match[2]}${match[3]}`)
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
 * Posición de una parada ATENDIDA verificada del lugar en la secuencia del
 * servicio, o -1 si la fuente no confirma que el servicio pare allí. Solo
 * cuenta cuando la parada está operativa; una parada suspendida o sin verificar
 * no habilita el abordaje.
 */
const servedStopAt = (
  route: BusRoute,
  place: Place,
  need: "board" | "alight",
): number => {
  for (const stop of route.servedStops) {
    if (stop.status !== "operativa") continue
    if (need === "board" && !stop.canBoard) continue
    if (need === "alight" && !stop.canAlight) continue
    if (place.stations.some((s) => s.name === stop.name)) return stop.order
  }
  return -1
}

/** Nombre de la parada atendida de un lugar en la ruta, o `undefined`. */
const servedStopName = (route: BusRoute, place: Place, need: "board" | "alight"): string | undefined => {
  const order = servedStopAt(route, place, need)
  if (order < 0) return undefined
  return route.servedStops.find((s) => s.order === order)?.name
}

/** ¿El servicio tiene al menos una parada atendida verificada y operativa? */
export function hasVerifiedServedStops(route: BusRoute): boolean {
  return route.servedStops.some((s) => s.status === "operativa")
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
  /** Estaciones recorridas entre subir y bajar, sin contar la de subida. */
  stationsRidden: number
}

export type TripPlan = TripLeg[]

/**
 * Transbordo verificado: una estación donde `first` permite descender y
 * `second` permite abordar, con `first` llegando antes de que `second` siga
 * hacia el destino. Devuelve el nombre de la estación y las posiciones, o
 * `undefined` si no hay una conexión respaldada por paradas atendidas.
 */
function verifiedTransfer(
  first: BusRoute,
  firstBoardOrder: number,
  second: BusRoute,
  secondAlightOrder: number,
): { name: string; firstOrder: number; secondOrder: number } | undefined {
  for (const stop of first.servedStops) {
    if (stop.status !== "operativa" || !stop.canAlight || stop.order <= firstBoardOrder) continue
    const match = second.servedStops.find(
      (s) => s.status === "operativa" && s.canBoard && s.name === stop.name && s.order < secondAlightOrder,
    )
    if (match) return { name: stop.name, firstOrder: stop.order, secondOrder: match.order }
  }
  return undefined
}

/**
 * Planea un VIAJE OPERATIVO de un lugar a otro usando solo PARADAS ATENDIDAS
 * verificadas: primero rutas directas, y si no hay, combinaciones con un
 * transbordo verificado. Devuelve los planes ordenados de menos a más
 * estaciones recorridas.
 *
 * Nunca convierte una estación cercana al trazado en abordaje: si ningún
 * servicio tiene paradas verificadas (hoy, sin fuente oficial de paradas),
 * devuelve `[]` y el asistente ofrece información de recorrido con
 * incertidumbre en vez de instruir subir o bajar (ver `lib/local-agent.ts`).
 *
 * ponytail: prueba todos los pares de rutas para el transbordo (124² ≈ 15 000
 * combinaciones), que es instantáneo con los datos troncales. Si algún día se
 * suman las 567 rutas zonales, conviene un índice por estación.
 */
export function planTrip(
  { origin, destination }: { origin: Place; destination: Place },
  data: TransmilenioData,
  limit = 3,
): TripPlan[] {
  const direct: TripPlan[] = []
  for (const route of data.routes) {
    const board = servedStopAt(route, origin, "board")
    const alight = servedStopAt(route, destination, "alight")
    if (board >= 0 && alight > board) {
      const boardName = servedStopName(route, origin, "board")!
      const alightName = servedStopName(route, destination, "alight")!
      direct.push([{ route, board: boardName, alight: alightName, stationsRidden: alight - board }])
    }
  }
  if (direct.length > 0) return rank(direct).slice(0, limit)

  const transfers: TripPlan[] = []
  const fromOrigin = data.routes
    .map((route) => ({ route, board: servedStopAt(route, origin, "board") }))
    .filter((r) => r.board >= 0)
  const toDestination = data.routes
    .map((route) => ({ route, alight: servedStopAt(route, destination, "alight") }))
    .filter((r) => r.alight >= 0)

  for (const first of fromOrigin) {
    for (const second of toDestination) {
      if (first.route === second.route) continue
      const transfer = verifiedTransfer(first.route, first.board, second.route, second.alight)
      if (!transfer) continue
      const boardName = servedStopName(first.route, origin, "board")!
      const alightName = servedStopName(second.route, destination, "alight")!
      transfers.push([
        { route: first.route, board: boardName, alight: transfer.name, stationsRidden: transfer.firstOrder - first.board },
        { route: second.route, board: transfer.name, alight: alightName, stationsRidden: second.alight - transfer.secondOrder },
      ])
    }
  }
  return rank(transfers).slice(0, limit)
}

const totalStations = (plan: TripPlan) => plan.reduce((sum, leg) => sum + leg.stationsRidden, 0)

function rank(plans: TripPlan[]): TripPlan[] {
  return plans.sort((a, b) => a.length - b.length || totalStations(a) - totalStations(b))
}

/** Estaciones ordenadas por cercanía a una coordenada. */
export function nearestStations(from: LatLng, data: TransmilenioData, limit = 4): StationWithDistance[] {
  return data.stations
    .map((station) => ({ ...station, distance: distanceMeters(from, station) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
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
