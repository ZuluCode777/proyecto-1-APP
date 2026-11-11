import datos from "@/data/metro-cartografia.json" with { type: "json" }

/**
 * Cartografía ilustrativa de la Línea 1 del Metro de Bogotá (EA-24, #50).
 *
 * Solo contiene lo que superó la verificación de sistema de coordenadas y
 * licencia: el trazado y la huella de las 16 estaciones, tal como los publica la
 * Empresa Metro de Bogotá en el servicio de Catastro, pedidos en EPSG:4326. Los
 * accesos peatonales y la Línea 2 quedan ausentes. La evidencia está en
 * `docs/expoandes/ea-24-cartografia-metro.md`.
 *
 * Es un módulo aparte del catálogo (`lib/metro.ts`) y de TransMilenio: no
 * importa ninguno de los dos y solo lo usan el listado del Metro y el script que
 * regenera `data/metro-cartografia.json`. Una huella es infraestructura de un
 * proyecto futuro: no es una entrada, una parada ni un transbordo.
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
 * de la ciudad: ejes invertidos, metros del sistema local o Web Mercator.
 */
const BOGOTA = { lonMin: -74.25, lonMax: -73.99, latMin: 4.45, latMax: 4.85 }
const IDS = Array.from({ length: 16 }, (_, i) => `E${String(i + 1).padStart(2, "0")}`)
/** Tolerancia de la simplificación del trazado, en metros. */
export const TOLERANCIA_M = 1
const DECIMALES = 6

function exigir(condicion: unknown, mensaje: string): asserts condicion {
  if (!condicion) throw new Error(`Cartografía del Metro rechazada: ${mensaje}`)
}

function posicion(par: unknown, donde: string): Posicion {
  exigir(Array.isArray(par) && Number.isFinite(par[0]) && Number.isFinite(par[1]), `${donde}: par de coordenadas inválido`)
  const [lon, lat] = par as number[]
  exigir(
    lon >= BOGOTA.lonMin && lon <= BOGOTA.lonMax && lat >= BOGOTA.latMin && lat <= BOGOTA.latMax,
    `${donde}: [${lon}, ${lat}] no es [longitud, latitud] dentro de Bogotá; ¿ejes invertidos o coordenadas en metros?`,
  )
  return [lon, lat]
}

const redondear = ([lon, lat]: Posicion): Posicion => [Number(lon.toFixed(DECIMALES)), Number(lat.toFixed(DECIMALES))]

// Plano local en metros: basta para tolerancias de un metro en los 25 km de la línea.
type XY = [number, number]
const M_LAT = 110_574
const M_LON = 111_320 * Math.cos((4.63 * Math.PI) / 180)
const aMetros = ([lon, lat]: Posicion): XY => [lon * M_LON, lat * M_LAT]

function distanciaASegmento(p: XY, a: XY, b: XY): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)))
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
}

/** Douglas-Peucker: quita los vértices que se apartan menos de `tolerancia` metros de la línea que queda. */
export function simplificar(linea: Posicion[], tolerancia: number): Posicion[] {
  const p = linea.map(aMetros)
  const conservar = new Set([0, linea.length - 1])
  const pila: [number, number][] = [[0, linea.length - 1]]
  while (pila.length) {
    const [i, j] = pila.pop()!
    let lejos = -1
    let maxima = tolerancia
    for (let k = i + 1; k < j; k++) {
      const d = distanciaASegmento(p[k], p[i], p[j])
      if (d > maxima) [maxima, lejos] = [d, k]
    }
    if (lejos > 0) {
      conservar.add(lejos)
      pila.push([i, lejos], [lejos, j])
    }
  }
  return linea.filter((_, k) => conservar.has(k))
}

const giro = (a: XY, b: XY, c: XY) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])

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

type RespuestaArcgis = {
  error?: unknown
  spatialReference?: { wkid?: number }
  exceededTransferLimit?: boolean
  features?: { attributes?: Record<string, unknown>; geometry?: { paths?: unknown[][]; rings?: unknown[][] } }[]
}

function entidades(respuesta: unknown, capa: string) {
  const r = (respuesta ?? {}) as RespuestaArcgis
  exigir(!r.error && Array.isArray(r.features), `${capa}: el servicio no devolvió entidades`)
  exigir(r.spatialReference?.wkid === 4326, `${capa}: se pidió EPSG:4326 y la respuesta declara wkid ${r.spatialReference?.wkid}`)
  exigir(!r.exceededTransferLimit, `${capa}: la respuesta llegó truncada`)
  return r.features
}

/**
 * Convierte las respuestas REST del trazado y de las estaciones (`f=json`,
 * `outSR=4326`) en la cartografía versionada. Rechaza lo que no sea EPSG:4326,
 * cualquier entidad que no sea de la Línea 1 (la capa llamada «primera línea»
 * llegó a devolver también la segunda) y la geometría fuera de Bogotá.
 */
export function importarCartografiaMetro(respuestaTrazado: unknown, respuestaEstaciones: unknown): CartografiaMetro {
  const lineas = entidades(respuestaTrazado, "trazado")
  const nombres = lineas.map((f) => String(f.attributes?.LINEA))
  exigir(lineas.length === 1 && nombres[0] === "Primera", `trazado: se esperaba solo la Línea 1 («Primera») y llegó ${nombres.join(", ") || "nada"}`)
  const tramos = lineas[0].geometry?.paths ?? []
  exigir(tramos.length === 1, `trazado: se esperaba una trayectoria y llegaron ${tramos.length}`)
  const trazado = simplificar(tramos[0].map((p) => posicion(p, "trazado")), TOLERANCIA_M).map(redondear)

  const huellas = entidades(respuestaEstaciones, "estaciones")
    .map((f) => {
      const a = f.attributes ?? {}
      exigir(a.LINEAS === "Primera", `estaciones: «${a.NOMBRE}» es de la línea «${a.LINEAS}», no de la Línea 1`)
      const anillos = f.geometry?.rings ?? []
      exigir(anillos.length === 1, `estación ${a.NUMERO}: se esperaba un anillo y llegaron ${anillos.length}`)
      return { id: `E${a.NUMERO}`, nombreFuente: String(a.NOMBRE), huella: anillos[0].map((p) => redondear(posicion(p, `estación ${a.NUMERO}`))) }
    })
    .sort((x, y) => x.id.localeCompare(y.id))

  const cartografia = { trazado, huellas }
  validarCartografiaMetro(cartografia)
  return cartografia
}

/**
 * Comprueba en la ficha de Datos Abiertos (`package_show`) que la licencia es
 * CC BY 4.0 y que cubre la capa REST consultada. Devuelve la fecha del dato.
 */
export function fechaDeFichaConLicencia(ficha: unknown, urlCapa: string): string {
  const r = ((ficha ?? {}) as { result?: { license_id?: string; inf_citation_date?: string; resources?: { url?: string }[] } }).result
  exigir(r?.license_id === "CC-BY-4.0", `la ficha de ${urlCapa} declara la licencia «${r?.license_id}», no CC BY 4.0`)
  exigir(r.resources?.some((recurso) => recurso.url === urlCapa), `la ficha con licencia no enumera la capa ${urlCapa}`)
  exigir(/^\d{4}-\d{2}-\d{2}$/.test(r.inf_citation_date ?? ""), `la ficha de ${urlCapa} no trae la fecha del dato`)
  return r.inf_citation_date!
}

// ---------------------------------------------------------------------------
// Geometría versionada y texto compartido por la pantalla y la voz.
// ---------------------------------------------------------------------------

type Entidad = { properties: { tipo: string; id?: string; nombreFuente: string }; geometry: { coordinates: unknown } }
const guardadas = datos.features as Entidad[]

export const PROCEDENCIA_MAPA_METRO = datos.procedencia

export const CARTOGRAFIA_METRO: CartografiaMetro = {
  trazado: guardadas.find((e) => e.properties.tipo === "trazado")!.geometry.coordinates as Posicion[],
  huellas: guardadas
    .filter((e) => e.properties.tipo === "huella_estacion")
    .map((e) => ({ id: e.properties.id!, nombreFuente: e.properties.nombreFuente, huella: (e.geometry.coordinates as Posicion[][])[0] })),
}

const dma = (iso: string) => iso.split("-").reverse().join("-")
const { entidad, publicador, licencia, fechaDato, consultado, cambios } = PROCEDENCIA_MAPA_METRO

/** Rótulo que el mapa muestra siempre sobre el trazado. */
export const ROTULO_MAPA_METRO = "Metro Línea 1 · proyecto futuro, sin servicio"

/** Lo que dicen el texto y la voz sobre el mapa. */
export const TEXTO_MAPA_METRO = `El mapa es una ilustración de un proyecto futuro, sin servicio: muestra el trazado de la Línea 1 y la huella prevista de cada estación según el diseño publicado en ${fechaDato.slice(0, 4)}. Una huella no es una entrada ni indica transbordos.`

/** Lo que acompaña a cada huella en el mapa. */
export const TEXTO_HUELLA_METRO = "huella ilustrativa del proyecto; no es una entrada"

/** Atribución, licencia, fecha y cambios: visible junto al mapa. */
export const ATRIBUCION_MAPA_METRO = `Trazado y huellas de estación: ${entidad}, ${publicador}, licencia ${licencia}. Dato del ${dma(fechaDato)}, consultado el ${dma(consultado)}. Cambios: ${cambios.join("; ")}.`

/** Forma corta, para el control de atribución del propio mapa. */
export const ATRIBUCION_MAPA_METRO_CORTA = `Metro: EMB, ${publicador}, ${licencia}, dato de ${fechaDato.slice(0, 4)}`
