import {
  paradaCoincideConEstacion,
  paradaPrescriptible,
  rutaConParadasVerificadas,
  secuenciaAtendidaValida,
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
 * Parada ATENDIDA prescriptible del lugar en la ruta, o `undefined` si la
 * fuente no confirma que el servicio pare allí con evidencia vigente. Devuelve
 * el REGISTRO que realmente coincidió (no se busca por `order`, que podría
 * estar duplicado o ser ambiguo). Solo cuenta cuando la secuencia es coherente
 * y la parada es prescriptible ahora (fuente, estado y fecha válidos).
 */
const matchServedStop = (
  route: BusRoute,
  place: Place,
  need: "board" | "alight",
  now: Date,
): ServedStop | undefined => {
  if (!secuenciaAtendidaValida(route.servedStops)) return undefined
  for (const stop of route.servedStops) {
    if (!paradaPrescriptible(stop, now)) continue
    if (need === "board" && !stop.canBoard) continue
    if (need === "alight" && !stop.canAlight) continue
    const station = place.stations.find((s) => paradaCoincideConEstacion(stop, s))
    if (station) return stop
  }
  return undefined
}

/**
 * ¿El servicio tiene paradas atendidas verificadas, utilizables ahora? Delega
 * en el validador compartido: secuencia coherente y al menos una parada
 * prescriptible (fuente, estado y fecha válidos). No basta con `status`.
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
  /** Estaciones recorridas entre subir y bajar, sin contar la de subida. */
  stationsRidden: number
}

export type TripPlan = TripLeg[]

/**
 * Transbordo verificado: una estación donde `first` permite descender y
 * `second` permite abordar, con `first` llegando después de subir y antes de
 * que `second` siga hacia el destino. Devuelve el registro de parada de cada
 * servicio (no se asume igualdad de `order` entre servicios distintos), o
 * `undefined` si no hay una conexión respaldada por paradas atendidas vigentes.
 */
function verifiedTransfer(
  first: BusRoute,
  firstBoard: ServedStop,
  second: BusRoute,
  secondAlight: ServedStop,
  now: Date,
): { firstAlight: ServedStop; secondBoard: ServedStop } | undefined {
  for (const stop of first.servedStops) {
    if (!paradaPrescriptible(stop, now) || !stop.canAlight || stop.order <= firstBoard.order) continue
    const match = second.servedStops.find(
      (s) => paradaPrescriptible(s, now) && s.canBoard && s.name === stop.name && s.order < secondAlight.order,
    )
    if (match) return { firstAlight: stop, secondBoard: match }
  }
  return undefined
}

/**
 * Planea un VIAJE OPERATIVO de un lugar a otro usando solo PARADAS ATENDIDAS
 * verificadas y vigentes: primero rutas directas, y si no hay, combinaciones
 * con un transbordo verificado. Devuelve los planes ordenados de menos a más
 * estaciones recorridas.
 *
 * Nunca convierte una estación cercana al trazado en abordaje: si ningún
 * servicio tiene paradas verificadas, devuelve `[]` y el asistente ofrece
 * información de recorrido con incertidumbre en vez de instruir subir o bajar
 * (ver `lib/local-agent.ts`). La validación de fuente, fecha, estado y
 * secuencia vive en `lib/evidencia.ts` para que todos los consumidores decidan
 * igual. `now` permite evaluar la vigencia de la evidencia.
 *
 * ponytail: prueba todos los pares de rutas para el transbordo (124² ≈ 15 000
 * combinaciones), que es instantáneo con los datos troncales. Si algún día se
 * suman las 567 rutas zonales, conviene un índice por estación.
 */
export function planTrip(
  { origin, destination }: { origin: Place; destination: Place },
  data: TransmilenioData,
  limit = 3,
  now: Date = new Date(),
): TripPlan[] {
  const direct: TripPlan[] = []
  for (const route of data.routes) {
    const board = matchServedStop(route, origin, "board", now)
    const alight = matchServedStop(route, destination, "alight", now)
    if (board && alight && alight.order > board.order) {
      direct.push([{ route, board: board.name, alight: alight.name, stationsRidden: alight.order - board.order }])
    }
  }
  if (direct.length > 0) return rank(direct).slice(0, limit)

  const transfers: TripPlan[] = []
  const fromOrigin = data.routes
    .map((route) => ({ route, board: matchServedStop(route, origin, "board", now) }))
    .filter((r): r is { route: BusRoute; board: ServedStop } => r.board !== undefined)
  const toDestination = data.routes
    .map((route) => ({ route, alight: matchServedStop(route, destination, "alight", now) }))
    .filter((r): r is { route: BusRoute; alight: ServedStop } => r.alight !== undefined)

  for (const first of fromOrigin) {
    for (const second of toDestination) {
      if (first.route === second.route) continue
      const transfer = verifiedTransfer(first.route, first.board, second.route, second.alight, now)
      if (!transfer) continue
      transfers.push([
        {
          route: first.route,
          board: first.board.name,
          alight: transfer.firstAlight.name,
          stationsRidden: transfer.firstAlight.order - first.board.order,
        },
        {
          route: second.route,
          board: transfer.secondBoard.name,
          alight: second.alight.name,
          stationsRidden: second.alight.order - transfer.secondBoard.order,
        },
      ])
    }
  }
  return rank(transfers).slice(0, limit)
}

/**
 * Revalida un resumen de viaje (tramos ya serializados) contra el catálogo y
 * la evidencia ACTUAL, antes de que una pantalla dé órdenes de subir/bajar.
 * Comprueba que cada tramo use una ruta existente, con paradas de abordaje y
 * descenso prescriptibles en el sentido correcto. Devuelve `false` si el
 * resumen viene de un esquema viejo, de otro origen de datos o sin evidencia.
 */
export function tripSummaryStillValid(
  legs: { routeCode: string; board: string; alight: string }[],
  data: TransmilenioData,
  now: Date = new Date(),
): boolean {
  if (legs.length === 0) return false
  for (const leg of legs) {
    const route = data.routes.find((r) => r.code === leg.routeCode)
    if (!route) return false
    if (!secuenciaAtendidaValida(route.servedStops)) return false
    const board = route.servedStops.find(
      (s) => s.name === leg.board && s.canBoard && paradaPrescriptible(s, now),
    )
    const alight = route.servedStops.find(
      (s) => s.name === leg.alight && s.canAlight && paradaPrescriptible(s, now),
    )
    if (!board || !alight) return false
    if (alight.order <= board.order) return false
  }
  return true
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
