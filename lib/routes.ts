import { distanceMeters, type LatLng } from "@/lib/geo"

/**
 * Aviso que se lee en voz alta cada vez que la app entrega rutas.
 * Los códigos, paradas y coordenadas de este archivo son datos de
 * demostración: no provienen de una fuente oficial de TransMilenio.
 * Debe sonar siempre que se anuncien rutas, porque la persona usuaria
 * no puede ver ninguna etiqueta en pantalla.
 */
export const DEMO_DATA_NOTICE =
  "Aviso: estas rutas son datos de demostración, no información oficial de TransMilenio. Confirma con TransMilenio antes de viajar."

export type BusRoute = {
  id: string
  code: string
  label: string
  from: string
  to: string
  stops: string[]
  frequent: boolean
}

export type Station = {
  id: string
  name: string
  lat: number
  lng: number
}

/** DATOS DE DEMOSTRACIÓN: estaciones y portales con coordenadas aproximadas, sin fuente oficial. */
export const stations: Station[] = [
  { id: "portal-norte", name: "Portal Norte", lat: 4.75658, lng: -74.04555 },
  { id: "calle-100", name: "Calle 100", lat: 4.68624, lng: -74.05093 },
  { id: "heroes", name: "Héroes", lat: 4.66931, lng: -74.06405 },
  { id: "calle-72", name: "Calle 72", lat: 4.65803, lng: -74.06203 },
  { id: "calle-45", name: "Calle 45", lat: 4.63305, lng: -74.06803 },
  { id: "marly", name: "Marly", lat: 4.63201, lng: -74.06552 },
  { id: "av-jimenez", name: "Av. Jiménez", lat: 4.60152, lng: -74.07231 },
  { id: "ricaurte", name: "Ricaurte", lat: 4.61192, lng: -74.09381 },
  { id: "banderas", name: "Banderas", lat: 4.62801, lng: -74.14403 },
  { id: "portal-80", name: "Portal 80", lat: 4.71083, lng: -74.11281 },
  { id: "portal-suba", name: "Portal Suba", lat: 4.74692, lng: -74.09383 },
  { id: "portal-sur", name: "Portal Sur", lat: 4.59623, lng: -74.14361 },
  { id: "portal-usme", name: "Portal Usme", lat: 4.49381, lng: -74.12492 },
  { id: "portal-americas", name: "Portal Américas", lat: 4.62999, lng: -74.17801 },
  { id: "portal-dorado", name: "Portal El Dorado", lat: 4.67521, lng: -74.11782 },
  { id: "portal-tunal", name: "Portal Tunal", lat: 4.57201, lng: -74.13102 },
  { id: "portal-20-julio", name: "Portal 20 de Julio", lat: 4.57172, lng: -74.09683 },
  { id: "tercer-milenio", name: "Tercer Milenio", lat: 4.59712, lng: -74.08213 },
  { id: "restrepo", name: "Restrepo", lat: 4.57912, lng: -74.09903 },
]

export type StationWithDistance = Station & { distance: number }

/** Estaciones ordenadas por cercanía a una coordenada. */
export function nearestStations(from: LatLng, limit = 4): StationWithDistance[] {
  return stations
    .map((station) => ({
      ...station,
      distance: distanceMeters(from, { lat: station.lat, lng: station.lng }),
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit)
}

/** DATOS DE DEMOSTRACIÓN: códigos y paradas inventados, no corresponden a rutas reales. */
export const routes: BusRoute[] = [
  {
    id: "b12",
    code: "B12",
    label: "Portal Norte hacia Av. Jiménez",
    from: "Portal Norte",
    to: "Av. Jiménez",
    stops: ["Calle 100", "Héroes", "Calle 72", "Calle 45", "Marly"],
    frequent: true,
  },
  {
    id: "k43",
    code: "K43",
    label: "Portal 80 hacia Portal Sur",
    from: "Portal 80",
    to: "Portal Sur",
    stops: ["Av. Rojas", "Ricaurte", "Tercer Milenio", "Santa Isabel"],
    frequent: true,
  },
  {
    id: "f19",
    code: "F19",
    label: "Portal Suba hacia Portal Tunal",
    from: "Portal Suba",
    to: "Portal Tunal",
    stops: ["Suba Calle 100", "La Campiña", "Puente Aranda", "Restrepo"],
    frequent: false,
  },
  {
    id: "h13",
    code: "H13",
    label: "Portal Usme hacia Portal Norte",
    from: "Portal Usme",
    to: "Portal Norte",
    stops: ["Molinos", "Calle 40 Sur", "Av. Jiménez", "Calle 100"],
    frequent: true,
  },
  {
    id: "d21",
    code: "D21",
    label: "Portal Américas hacia Calle 100",
    from: "Portal Américas",
    to: "Calle 100",
    stops: ["Banderas", "Ricaurte", "Calle 26", "Calle 76"],
    frequent: false,
  },
  {
    id: "g12",
    code: "G12",
    label: "Portal Dorado hacia Portal 20 de Julio",
    from: "Portal Dorado",
    to: "Portal 20 de Julio",
    stops: ["Modelia", "Av. Jiménez", "Hospital", "Country Sur"],
    frequent: false,
  },
  {
    id: "j24",
    code: "J24",
    label: "Portal Tunal hacia Calle 72",
    from: "Portal Tunal",
    to: "Calle 72",
    stops: ["Parque", "Santa Isabel", "Calle 45", "Calle 63"],
    frequent: false,
  },
  {
    id: "c15",
    code: "C15",
    label: "Portal Sur hacia Portal Suba",
    from: "Portal Sur",
    to: "Portal Suba",
    stops: ["Perdomo", "Ricaurte", "Av. Rojas", "Suba"],
    frequent: false,
  },
]

const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()

export function searchRoutes(query: string): BusRoute[] {
  const q = normalize(query)
  if (!q) return routes
  return routes.filter((route) => {
    const haystack = normalize(
      [route.code, route.label, route.from, route.to, ...route.stops].join(" "),
    )
    return q.split(/\s+/).some((word) => word.length > 1 && haystack.includes(word))
  })
}

export function frequentRoutes(): BusRoute[] {
  return routes.filter((route) => route.frequent)
}
