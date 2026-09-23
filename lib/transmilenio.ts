import { distanceToPath, type LatLng } from "@/lib/geo"

/**
 * Datos reales de TransMilenio desde el servicio ArcGIS público de la
 * Subgerencia de Planificación. No pide clave de API.
 *
 * - Capa 2: estaciones troncales (153).
 * - Capa 15: servicios. `comp_sitp = 1` son los de TransMilenio troncal y
 *   `est_ruta = 1` los que están en operación.
 *
 * El servicio no publica qué estaciones atiende cada ruta. Se deducen por
 * geometría: una estación pertenece al recorrido si queda a menos de
 * `STATION_MATCH_METERS` de la línea de la ruta. Eso da las estaciones por las
 * que pasa el bus, no necesariamente las que para: un servicio expreso pasa
 * por estaciones donde no se detiene.
 */
export const ARCGIS_BASE =
  "https://gis.transmilenio.gov.co/arcgis/rest/services/ConsultaSubgerenciaPlanificacionSITP/Consulta_Planificacion_SITP/FeatureServer"

/** Distancia máxima entre una estación y la línea de la ruta para contarla. */
export const STATION_MATCH_METERS = 60

export type Station = {
  id: string
  name: string
  lat: number
  lng: number
}

export type BusRoute = {
  id: string
  /** Código del servicio, por ejemplo "B23". */
  code: string
  label: string
  from: string
  to: string
  /** Nombres de las estaciones por las que pasa, en orden de recorrido. */
  stops: string[]
  /** Recorrido como pares [lat, lng], simplificado para dibujarlo. */
  path: [number, number][]
  schedule: {
    weekday: string
    saturday: string
    holiday: string
  }
}

export type TransmilenioData = {
  stations: Station[]
  routes: BusRoute[]
  /** Fecha ISO de la consulta al servicio. */
  fetchedAt: string
  /** "live" si viene del servicio en esta ejecución, "snapshot" si es la copia guardada. */
  source: "live" | "snapshot"
}

type ArcgisFeatureSet = {
  features?: {
    attributes: Record<string, unknown>
    geometry?: { x?: number; y?: number; paths?: number[][][] }
  }[]
  error?: { message?: string }
}

/** Quita espacios duros y espacios repetidos que trae el servicio. */
const clean = (value: unknown): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim() : ""

/** Convierte las respuestas crudas de ArcGIS en los datos que usa la app. */
export function normalizeTransmilenio(
  stationsRaw: ArcgisFeatureSet,
  routesRaw: ArcgisFeatureSet,
  fetchedAt: string,
  source: TransmilenioData["source"],
): TransmilenioData {
  const stations: Station[] = (stationsRaw.features ?? [])
    .map((f) => ({
      id: clean(f.attributes.num_est),
      name: clean(f.attributes.nom_est),
      lat: f.geometry?.y ?? NaN,
      lng: f.geometry?.x ?? NaN,
    }))
    .filter((s) => s.id && s.name && Number.isFinite(s.lat) && Number.isFinite(s.lng))
    .sort((a, b) => a.name.localeCompare(b.name, "es"))

  const routes: BusRoute[] = []
  const seen = new Set<string>()
  for (const f of routesRaw.features ?? []) {
    const code = clean(f.attributes.cod_ruta)
    const paths = f.geometry?.paths ?? []
    if (!code || seen.has(code) || paths.length === 0) continue
    seen.add(code)

    // ArcGIS entrega [lng, lat]; la app trabaja en [lat, lng].
    const path = paths.flat().map(([lng, lat]) => [lat, lng] as [number, number])
    const line: LatLng[] = path.map(([lat, lng]) => ({ lat, lng }))

    const stops = stations
      .map((s) => ({ s, ...distanceToPath(s, line) }))
      .filter((m) => m.distance <= STATION_MATCH_METERS)
      .sort((a, b) => a.along - b.along)
      .map((m) => m.s.name)

    const from = clean(f.attributes.orig_ruta)
    const to = clean(f.attributes.dest_ruta)
    routes.push({
      id: code,
      code,
      label: `${from} hacia ${to}`,
      from,
      to,
      stops,
      path,
      schedule: {
        weekday: clean(f.attributes.hor_habil),
        saturday: clean(f.attributes.hor_sab),
        holiday: clean(f.attributes.hor_fest),
      },
    })
  }
  routes.sort((a, b) => a.code.localeCompare(b.code, "es", { numeric: true }))

  return { stations, routes, fetchedAt, source }
}

async function queryLayer(layer: number, params: Record<string, string>): Promise<ArcgisFeatureSet> {
  const url = new URL(`${ARCGIS_BASE}/${layer}/query`)
  const query = { outSR: "4326", f: "json", returnGeometry: "true", ...params }
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)

  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) })
  if (!response.ok) throw new Error(`ArcGIS capa ${layer}: HTTP ${response.status}`)
  const body = (await response.json()) as ArcgisFeatureSet
  if (body.error) throw new Error(`ArcGIS capa ${layer}: ${body.error.message ?? "error"}`)
  return body
}

/** Consulta el servicio de TransMilenio en vivo. */
export async function fetchTransmilenio(): Promise<TransmilenioData> {
  const [stationsRaw, routesRaw] = await Promise.all([
    queryLayer(2, { where: "1=1", outFields: "num_est,nom_est" }),
    queryLayer(15, {
      where: "comp_sitp=1 AND est_ruta=1",
      outFields: "cod_ruta,orig_ruta,dest_ruta,hor_habil,hor_sab,hor_fest",
      // Simplifica la línea a ~20 m: suficiente para dibujar y para ubicar estaciones.
      maxAllowableOffset: "0.0002",
      geometryPrecision: "5",
    }),
  ])
  return normalizeTransmilenio(stationsRaw, routesRaw, new Date().toISOString(), "live")
}
