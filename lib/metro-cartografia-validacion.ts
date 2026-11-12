/**
 * Tipos y validación de la cartografía del Metro (EA-24, #50). Sin datos ni
 * dependencias: lo usan el módulo que carga la geometría versionada y el que la
 * importa de la fuente.
 */

/** Par en el orden de GeoJSON y del servicio: primero longitud, después latitud. */
export type Posicion = [longitud: number, latitud: number]

export type HuellaEstacionMetro = {
  /** Identificador oficial, E01–E16. */
  id: string
  /** Nombre tal como lo publica la fuente. */
  nombreFuente: string
  /** Anillo cerrado del polígono de infraestructura. */
  huella: Posicion[]
}

export type CartografiaMetro = { trazado: Posicion[]; huellas: HuellaEstacionMetro[] }

/**
 * Bogotá urbana en WGS84. Un par fuera de esta caja no es [longitud, latitud]
 * de la ciudad: ejes invertidos, metros del sistema local o Web Mercator. La
 * caja mide decenas de kilómetros, así que NO detecta un error de datum de
 * cientos de metros: eso lo acota el control vial de `ea24-cartografia.test.ts`.
 */
const BOGOTA = { lonMin: -74.25, lonMax: -73.99, latMin: 4.45, latMax: 4.85 }
const IDS = Array.from({ length: 16 }, (_, i) => `E${String(i + 1).padStart(2, "0")}`)

export function exigir(condicion: unknown, mensaje: string): asserts condicion {
  if (!condicion) throw new Error(`Cartografía del Metro rechazada: ${mensaje}`)
}

/** Devuelve el par si es [longitud, latitud] dentro de Bogotá; si no, lo rechaza. */
export function posicion(par: unknown, donde: string): Posicion {
  exigir(Array.isArray(par) && Number.isFinite(par[0]) && Number.isFinite(par[1]), `${donde}: par de coordenadas inválido`)
  const [lon, lat] = par as number[]
  exigir(
    lon >= BOGOTA.lonMin && lon <= BOGOTA.lonMax && lat >= BOGOTA.latMin && lat <= BOGOTA.latMax,
    `${donde}: [${lon}, ${lat}] no es [longitud, latitud] dentro de Bogotá; ¿ejes invertidos o coordenadas en metros?`,
  )
  return [lon, lat]
}

// Plano local en metros: basta para tolerancias de un metro en los 25 km de la línea.
export type XY = [number, number]
const M_LAT = 110_574
const M_LON = 111_320 * Math.cos((4.63 * Math.PI) / 180)
export const aMetros = ([lon, lat]: Posicion): XY => [lon * M_LON, lat * M_LAT]

export function distanciaASegmento(p: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)))
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
}

/** Positivo si `c` queda a la izquierda de la recta de `a` a `b`. */
export const giro = (a: XY, b: XY, c: XY) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

/** Abscisa en metros del primer punto donde la línea cruza el anillo, o `null` si no lo cruza. */
function abscisaDeCruce(linea: XY[], anillo: XY[]): number | null {
  let recorrido = 0
  for (let i = 1; i < linea.length; i++) {
    const [a, b] = [linea[i - 1], linea[i]]
    const largo = Math.hypot(b[0] - a[0], b[1] - a[1])
    let primero: number | null = null
    for (let k = 1; k < anillo.length; k++) {
      const [c, d] = [anillo[k - 1], anillo[k]]
      const [ga, gb] = [giro(c, d, a), giro(c, d, b)]
      if (ga * gb < 0 && giro(a, b, c) * giro(a, b, d) < 0) primero = Math.min(primero ?? 1, ga / (ga - gb))
    }
    if (primero !== null) return recorrido + primero * largo
    recorrido += largo
  }
  return null
}

/**
 * Orden de ejes, rangos y cobertura: todo dentro de Bogotá, un trazado del largo
 * de la Línea 1 y las 16 huellas E01–E16 sobre él, en orden. Una estación de otra
 * línea, desplazada o con los ejes invertidos no lo cumple.
 */
export function validarCartografiaMetro({ trazado, huellas }: CartografiaMetro): void {
  exigir(trazado.length >= 2, "el trazado no tiene geometría")
  trazado.forEach((p) => posicion(p, "trazado"))
  const linea = trazado.map(aMetros)
  const km = linea.slice(1).reduce((suma, p, i) => suma + Math.hypot(p[0] - linea[i][0], p[1] - linea[i][1]), 0) / 1000
  exigir(km > 23 && km < 25, `el trazado mide ${km.toFixed(1)} km y la Línea 1 mide unos 24`)

  exigir(huellas.map((h) => h.id).join() === IDS.join(), `se esperaban las 16 huellas E01–E16, una vez cada una, y llegaron ${huellas.map((h) => h.id).join(", ") || "ninguna"}`)
  let anterior = -1
  for (const { id, huella } of huellas) {
    exigir(huella.length >= 4 && huella[0].join() === huella.at(-1)!.join(), `${id}: la huella no es un anillo cerrado`)
    huella.forEach((p) => posicion(p, id))
    const abscisa = abscisaDeCruce(linea, huella.map(aMetros))
    exigir(abscisa !== null && abscisa > anterior, `${id}: el trazado no pasa por su huella después de la estación anterior`)
    anterior = abscisa
  }
}
