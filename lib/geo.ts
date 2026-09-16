export type LatLng = { lat: number; lng: number }

const toRad = (deg: number) => (deg * Math.PI) / 180
const toDeg = (rad: number) => (rad * 180) / Math.PI

/** Distancia en metros entre dos coordenadas (fórmula de Haversine). */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const R = 6371000
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Rumbo inicial en grados (0 = norte, 90 = este) desde `a` hacia `b`. */
export function bearingDegrees(a: LatLng, b: LatLng): number {
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const dLng = toRad(b.lng - a.lng)
  const y = Math.sin(dLng) * Math.cos(lat2)
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng)
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

const CARDINALS = [
  "al norte",
  "al noreste",
  "al este",
  "al sureste",
  "al sur",
  "al suroeste",
  "al oeste",
  "al noroeste",
]

/** Punto cardinal en español (8 direcciones) para un rumbo dado. */
export function cardinal(bearing: number): string {
  const index = Math.round(bearing / 45) % 8
  return CARDINALS[index]
}

/**
 * Instrucción relativa según hacia dónde mira la persona (heading) y el
 * rumbo al destino. Devuelve frases como "de frente" o "a tu derecha".
 */
export function relativeDirection(heading: number, bearing: number): string {
  const diff = (bearing - heading + 360) % 360
  if (diff < 23 || diff >= 337) return "de frente"
  if (diff < 68) return "hacia adelante a tu derecha"
  if (diff < 113) return "a tu derecha"
  if (diff < 158) return "hacia atrás a tu derecha"
  if (diff < 203) return "detrás de ti, date la vuelta"
  if (diff < 248) return "hacia atrás a tu izquierda"
  if (diff < 293) return "a tu izquierda"
  return "hacia adelante a tu izquierda"
}

/** Formatea una distancia en metros a un texto hablado natural. */
export function spokenDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters / 5) * 5} metros`
  const km = meters / 1000
  return `${km.toFixed(1).replace(".", ",")} kilómetros`
}
