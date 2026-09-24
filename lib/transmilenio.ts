import { z } from "zod"
import { distanceToPath, type LatLng } from "@/lib/geo"
import { normalize } from "@/lib/text"

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

export const StationSchema = z.object({
  id: z.string(),
  name: z.string(),
  lat: z.number(),
  lng: z.number(),
})
export type Station = z.infer<typeof StationSchema>

export const BusRouteSchema = z.object({
  id: z.string(),
  /** Código del servicio, por ejemplo "B23". */
  code: z.string(),
  label: z.string(),
  from: z.string(),
  to: z.string(),
  /** Nombres de las estaciones por las que pasa, en orden de recorrido. */
  stops: z.array(z.string()),
  /** Recorrido como pares [lat, lng], simplificado para dibujarlo. */
  path: z.array(z.tuple([z.number(), z.number()])),
  schedule: z.object({
    weekday: z.string(),
    saturday: z.string(),
    holiday: z.string(),
  }),
})
export type BusRoute = z.infer<typeof BusRouteSchema>

export const TransmilenioDataSchema = z.object({
  stations: z.array(StationSchema),
  routes: z.array(BusRouteSchema),
  /** Fecha ISO de la consulta al servicio. */
  fetchedAt: z.string(),
  /** "live" si viene del servicio en esta ejecución, "snapshot" si es la copia guardada. */
  source: z.enum(["live", "snapshot"]),
})
export type TransmilenioData = z.infer<typeof TransmilenioDataSchema>

/** Respuesta de una consulta a una capa de ArcGIS, con lo que la app usa. */
const ArcgisFeatureSetSchema = z.object({
  features: z
    .array(
      z.object({
        attributes: z.record(z.string(), z.unknown()),
        geometry: z
          .object({
            x: z.number().optional(),
            y: z.number().optional(),
            // Cada punto es [lng, lat], a veces con altura o medida al final.
            paths: z.array(z.array(z.array(z.number()).min(2))).optional(),
          })
          .nullish(),
      }),
    )
    .optional(),
  error: z.object({ message: z.string().optional() }).optional(),
})
type ArcgisFeatureSet = z.infer<typeof ArcgisFeatureSetSchema>

/** Quita espacios duros y espacios repetidos que trae el servicio. */
const clean = (value: unknown): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim() : ""

/** Largo desde el que un origen o destino puede venir cortado a mitad de palabra. */
const CUT_NAME_MIN_LENGTH = 20

/**
 * El servicio corta el origen y el destino de las rutas a unos 24 caracteres
 * y cambia las mayúsculas ("Portal Sur - Jfk Coop. F"). Devuelve el nombre
 * completo de la estación que empieza igual, o el original si no hay una
 * sola. Si varias coinciden, gana la que se llama exactamente igual y luego
 * la que está en el recorrido.
 */
export function fullStationName(raw: string, stations: Station[], stops: string[]): string {
  const key = normalize(raw)
  if (!key) return raw
  const compact = key.replace(/ /g, "")
  const cut = raw.length >= CUT_NAME_MIN_LENGTH
  const matches = stations.filter((s) => {
    const name = normalize(s.name)
    if (name === key || name.startsWith(`${key} `)) return true
    // Cortado a mitad de palabra: "Colegio S. To" → "Colegio S. Tomás…".
    return cut && name.replace(/ /g, "").startsWith(compact)
  })
  const exact = matches.filter((s) => normalize(s.name) === key)
  if (exact.length === 1) return exact[0].name
  const onRoute = matches.filter((s) => stops.includes(s.name))
  const pick = onRoute.length === 1 ? onRoute : matches
  return pick.length === 1 ? pick[0].name : raw
}

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

    const from = fullStationName(clean(f.attributes.orig_ruta), stations, stops)
    const to = fullStationName(clean(f.attributes.dest_ruta), stations, stops)
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
  const parsed = ArcgisFeatureSetSchema.safeParse(await response.json())
  if (!parsed.success) throw new Error(`ArcGIS capa ${layer}: respuesta con otra forma (${parsed.error.issues[0]?.message})`)
  if (parsed.data.error) throw new Error(`ArcGIS capa ${layer}: ${parsed.data.error.message ?? "error"}`)
  return parsed.data
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
