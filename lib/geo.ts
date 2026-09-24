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

/**
 * Distancia en metros desde un punto hasta un recorrido (polilínea), y la
 * posición a lo largo del recorrido donde queda más cerca. `along` es el
 * índice del tramo más cercano más la fracción recorrida dentro de él, así que
 * sirve para ordenar puntos según el sentido del recorrido.
 *
 * Usa una proyección equirectangular local: a escala de una ciudad el error es
 * de centímetros, y evita trigonometría por cada tramo.
 */
export function distanceToPath(point: LatLng, path: LatLng[]): { distance: number; along: number } {
  if (path.length === 0) return { distance: Infinity, along: 0 }
  const R = 6371000
  const k = Math.cos(toRad(point.lat))
  const project = (p: LatLng) => ({ x: toRad(p.lng) * k * R, y: toRad(p.lat) * R })
  const p = project(point)

  if (path.length === 1) {
    const a = project(path[0])
    return { distance: Math.hypot(p.x - a.x, p.y - a.y), along: 0 }
  }

  let best = { distance: Infinity, along: 0 }
  for (let i = 0; i < path.length - 1; i++) {
    const a = project(path[i])
    const b = project(path[i + 1])
    const dx = b.x - a.x
    const dy = b.y - a.y
    const lengthSq = dx * dx + dy * dy
    const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq))
    const distance = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
    if (distance < best.distance) best = { distance, along: i + t }
  }
  return best
}

/**
 * Tramo de una línea entre dos puntos cercanos a ella, por ejemplo entre la
 * estación donde se sube y la estación donde se baja. La línea va como
 * [lat, lng], igual que en los datos de las rutas.
 */
export function pathBetween(path: [number, number][], from: LatLng, to: LatLng): [number, number][] {
  // ponytail: toma el punto de la línea más cercano a cada estación; en una ruta que pasa dos veces por la misma estación podría elegir la otra pasada.
  const line = path.map(([lat, lng]) => ({ lat, lng }))
  const a = distanceToPath(from, line).along
  const b = distanceToPath(to, line).along
  const start = Math.floor(Math.min(a, b))
  const end = Math.ceil(Math.max(a, b))
  // Las dos en el mismo tramo de la línea: al menos ese tramo.
  return path.slice(start, Math.max(end, start + 1) + 1)
}
