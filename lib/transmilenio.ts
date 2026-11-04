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
 * `STATION_MATCH_METERS` de la línea de la ruta. Eso da las ESTACIONES
 * CERCANAS AL TRAZADO por las que pasa el bus, no las paradas que atiende: un
 * servicio expreso pasa cerca de estaciones donde no se detiene.
 *
 * Por eso `BusRoute.stops` (estaciones cercanas al trazado) sirve solo para
 * dibujar e ilustrar el recorrido. Las PARADAS ATENDIDAS —dónde se puede subir
 * o bajar, en qué sentido— viven aparte en `BusRoute.servedStops`, y solo se
 * llenan con evidencia de una fuente vigente. Mientras no haya esa evidencia,
 * `servedStops` queda vacío y el planificador no convierte la cercanía
 * geométrica en una instrucción de abordaje (ver `lib/routes.ts`).
 *
 * Capa 15 del servicio ArcGIS no expone un campo ni una relación con la
 * secuencia de paradas atendidas por servicio y sentido; el directorio
 * `GTFS_dinamicos` del operador responde con `services: []`. Un directorio
 * vacío no demuestra que la matriz oficial no exista: solo que no se consiguió
 * aquí una fuente descargable con licencia y vigencia comprobables. Integrar
 * esa matriz, cuando se valide, es un cambio aditivo sobre `servedStops`.
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

/**
 * Estado operativo de una parada atendida según la fuente que la respalda.
 * `operativa` solo cuando la fuente confirma que hoy se puede usar; los demás
 * estados obligan a comunicar incertidumbre en vez de instruir el abordaje.
 */
export const ServedStopStatusSchema = z.enum(["operativa", "suspendida", "sin-verificar"])
export type ServedStopStatus = z.infer<typeof ServedStopStatusSchema>

/**
 * Parada ATENDIDA por un servicio en un sentido: punto donde una fuente
 * vigente confirma que se permite subir o bajar. Es distinta de una estación
 * cercana al trazado (`BusRoute.stops`), que solo dice que el bus pasa cerca.
 *
 * `order` ubica la parada en la secuencia del servicio para poder planear un
 * viaje con sentido. `source`, `date` y `status` dejan registrada la
 * procedencia, la vigencia y el estado operativo, de modo que un dato viejo o
 * sin respaldo no se confunda con una confirmación actual.
 */
export const ServedStopSchema = z.object({
  /** Nombre de la estación, igual que en `Station.name`. */
  name: z.string(),
  /** Posición en la secuencia atendida, de origen a destino. */
  order: z.number().int().nonnegative(),
  /** Si la fuente confirma que el servicio permite abordar aquí. */
  canBoard: z.boolean(),
  /** Si la fuente confirma que el servicio permite descender aquí. */
  canAlight: z.boolean(),
  /** Entidad o documento que respalda la parada (fuente). */
  source: z.string(),
  /** Fecha ISO de la evidencia que respalda la parada. */
  date: z.string(),
  /** Estado operativo según la fuente. */
  status: ServedStopStatusSchema,
})
export type ServedStop = z.infer<typeof ServedStopSchema>

/**
 * Cómo se reconcilió el sentido del servicio (`from`/`to`) con el orden de las
 * estaciones cercanas al trazado (`stops`).
 *
 * - `consistente`: la etiqueta y la secuencia coinciden.
 * - `contradictorio`: `from`/`to` y la secuencia apuntan a sentidos opuestos
 *   (caso de 8 G y 8 T). No se invierte la geometría; se marca para que los
 *   consumidores no afirmen un sentido que la fuente no confirma.
 * - `indeterminado`: no hay datos suficientes para comparar.
 */
export const DirectionAgreementSchema = z.enum(["consistente", "contradictorio", "indeterminado"])
export type DirectionAgreement = z.infer<typeof DirectionAgreementSchema>

export const DirectionEvidenceSchema = z.object({
  /** Resultado de comparar la etiqueta de sentido con la secuencia geométrica. */
  agreement: DirectionAgreementSchema,
  /** Si una fuente vigente confirmó el sentido declarado en `from`/`to`. */
  verified: z.boolean(),
  /** Nota corta con la evidencia usada y sus límites. */
  note: z.string(),
})
export type DirectionEvidence = z.infer<typeof DirectionEvidenceSchema>

export const BusRouteSchema = z.object({
  id: z.string(),
  /** Código del servicio, por ejemplo "B23". */
  code: z.string(),
  label: z.string(),
  from: z.string(),
  to: z.string(),
  /**
   * Estaciones CERCANAS AL TRAZADO por las que pasa el bus, en orden de
   * recorrido. Sirven para dibujar e ilustrar el recorrido; que una estación
   * esté en esta lista NO demuestra que el servicio se detenga allí.
   */
  stops: z.array(z.string()),
  /**
   * Paradas ATENDIDAS verificadas con fuente, fecha, sentido y estado. Vacío
   * mientras no haya una fuente vigente que confirme dónde para el servicio.
   * El planificador solo puede recomendar abordaje/descenso/transbordo con
   * estas paradas, no con las estaciones cercanas al trazado. Campo aditivo.
   */
  servedStops: z.array(ServedStopSchema).default([]),
  /** Reconciliación del sentido declarado con la secuencia geométrica. */
  directionEvidence: DirectionEvidenceSchema.default({
    agreement: "indeterminado",
    verified: false,
    note: "Sentido no reconciliado con una fuente vigente.",
  }),
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

/**
 * Compara el sentido declarado (`from`/`to`) con el orden de las estaciones
 * cercanas al trazado, para no afirmar un sentido que la fuente no confirma.
 *
 * El servicio ArcGIS trae `orig_ruta`/`dest_ruta` por un lado y la geometría
 * por otro, sin garantizar que coincidan: en 8 G y 8 T la etiqueta y la
 * secuencia apuntan a sentidos opuestos. Aquí solo se detecta y se registra la
 * contradicción; NO se invierte la geometría ni se inventa una dirección. La
 * decisión de cuál atributo es el correcto exige una fuente oficial vigente,
 * que no se tiene, así que `verified` queda en falso.
 */
export function reconcileDirection(from: string, to: string, stops: string[]): DirectionEvidence {
  if (stops.length < 2 || !from || !to) {
    return {
      agreement: "indeterminado",
      verified: false,
      note: "Faltan estaciones o etiqueta para comparar el sentido.",
    }
  }
  const first = stops[0]
  const last = stops[stops.length - 1]
  const startsAtOrigin = first === from
  const endsAtDestination = last === to
  // El sentido inverso: la secuencia empieza en el destino y termina en el origen.
  const reversed = first === to && last === from

  if (startsAtOrigin && endsAtDestination) {
    return {
      agreement: "consistente",
      verified: false,
      note: "La secuencia de estaciones coincide con el sentido declarado; falta confirmarlo con una fuente oficial vigente.",
    }
  }
  if (reversed) {
    return {
      agreement: "contradictorio",
      verified: false,
      note: `La secuencia empieza en «${first}» y termina en «${last}», al revés del sentido declarado «${from}» hacia «${to}». No se invierte la geometría; se requiere fuente oficial vigente para resolver cuál es correcto.`,
    }
  }
  return {
    agreement: "indeterminado",
    verified: false,
    note: `Los extremos de la secuencia («${first}» … «${last}») no coinciden exactamente con el sentido declarado «${from}» hacia «${to}».`,
  }
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
      // No hay fuente vigente de paradas atendidas; queda vacío a propósito.
      servedStops: [],
      directionEvidence: reconcileDirection(from, to, stops),
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
