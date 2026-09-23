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
  byCode: Map<string, BusRoute>
}

const indexes = new WeakMap<TransmilenioData, Index>()

/** Nombre corto de una estación: lo que va antes del guion, sin "Temporal". */
function shortName(name: string): string {
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
  return { keys: [...keys].map(([key, place]) => ({ key, place })), byCode }
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

const stopsAt = (route: BusRoute, place: Place): number =>
  route.stops.findIndex((stop) => place.stations.some((s) => s.name === stop))

/** Rutas que pasan por un lugar. */
export function routesThrough(place: Place, data: TransmilenioData): BusRoute[] {
  return data.routes.filter((route) => stopsAt(route, place) >= 0)
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
 * Planea un viaje de un lugar a otro: primero rutas directas, y si no hay,
 * combinaciones con un transbordo. Devuelve los planes ordenados de menos a
 * más estaciones recorridas.
 *
 * ponytail: prueba todos los pares de rutas para el transbordo (124² ≈ 15 000
 * combinaciones), que es instantáneo con los datos troncales. Si algún día se
 * suman las 567 rutas zonales, conviene un índice por estación.
 */
export function planTrip(origin: Place, destination: Place, data: TransmilenioData, limit = 3): TripPlan[] {
  const direct: TripPlan[] = []
  for (const route of data.routes) {
    const board = stopsAt(route, origin)
    const alight = stopsAt(route, destination)
    if (board >= 0 && alight > board) {
      direct.push([{ route, board: route.stops[board], alight: route.stops[alight], stationsRidden: alight - board }])
    }
  }
  if (direct.length > 0) return rank(direct).slice(0, limit)

  const transfers: TripPlan[] = []
  const fromOrigin = data.routes
    .map((route) => ({ route, board: stopsAt(route, origin) }))
    .filter((r) => r.board >= 0)
  const toDestination = data.routes
    .map((route) => ({ route, alight: stopsAt(route, destination) }))
    .filter((r) => r.alight >= 0)

  for (const first of fromOrigin) {
    for (const second of toDestination) {
      if (first.route === second.route) continue
      // Primera estación compartida después de subir y antes de bajar.
      for (let i = first.board + 1; i < first.route.stops.length; i++) {
        const transfer = first.route.stops[i]
        const j = second.route.stops.indexOf(transfer)
        if (j >= 0 && j < second.alight) {
          transfers.push([
            { route: first.route, board: first.route.stops[first.board], alight: transfer, stationsRidden: i - first.board },
            { route: second.route, board: transfer, alight: second.route.stops[second.alight], stationsRidden: second.alight - j },
          ])
          break
        }
      }
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

/** Lugar que contiene una estación dada. */
export function placeOf(station: Station, data: TransmilenioData): Place {
  return findPlaces(station.name, data)[0] ?? { name: shortName(station.name), stations: [station] }
}

/** Rutas sugeridas mientras la persona no ha guardado ninguna. */
export const DEFAULT_FAVORITES = ["B23", "H54", "M83"]
