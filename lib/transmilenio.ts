import { z } from "zod"
import { aplicarEvidenciaGtfs } from "@/lib/evidencia-gtfs"
import { paradaCoincideConEstacion } from "@/lib/evidencia"
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
 * o bajar, en qué sentido— viven aparte en `BusRoute.servedStops`, con su
 * sentido, calendario y franjas, y solo se llenan con evidencia de una fuente
 * vigente. Sin esa evidencia `servedStops` queda vacío y el planificador no
 * convierte la cercanía geométrica en una instrucción de abordaje (ver
 * `lib/routes.ts`).
 *
 * La capa 15 del ArcGIS no expone la secuencia de paradas por servicio y
 * sentido, pero TransMilenio SÍ publica un GTFS oficial diario
 * (`https://gtfs.transmilenio.gov.co/`, licencia CC-BY-SA-4.0 declarada por el
 * catálogo CKAN; atribución TransMilenio S.A.). De ese GTFS sale la evidencia
 * corroborada de paradas atendidas, sentido y calendario que `lib/evidencia-gtfs.ts`
 * aplica sobre los servicios ya verificados (8 G y 8 T), tanto a la consulta en
 * vivo como a la copia. Ampliar a más servicios es aditivo sobre `servedStops`.
 */
export const ARCGIS_BASE =
  "https://gis.transmilenio.gov.co/arcgis/rest/services/ConsultaSubgerenciaPlanificacionSITP/Consulta_Planificacion_SITP/FeatureServer"

/** Distancia máxima entre una estación y la línea de la ruta para contarla. */
export const STATION_MATCH_METERS = 60

/**
 * Espera máxima por cada capa de ArcGIS. Acota la petición upstream: pasado
 * este tiempo la consulta en vivo falla y quien llama conserva el último
 * catálogo válido (cache o copia) en vez de quedarse colgado. Las dos capas se
 * consultan en paralelo, así que es también el techo aproximado de la consulta.
 */
export const LAYER_TIMEOUT_MS = 15_000

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
/**
 * Franja horaria PROGRAMADA de una parada para un servicio del calendario
 * (GTFS `stop_times`): primera y última salida en esa parada, en horas GTFS
 * `HH:MM:SS` (pueden pasar de las 24:00 en servicios que cruzan la medianoche).
 * Es horario programado, no tiempo real ni garantía de que pase un bus.
 */
export const FranjaServicioSchema = z.object({
  /** `service_id` del calendario al que pertenece la franja. */
  serviceId: z.string(),
  primera: z.string(),
  ultima: z.string(),
})
export type FranjaServicio = z.infer<typeof FranjaServicioSchema>

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
  /**
   * Nodo oficial de la estación (GTFS `parent_station` / ArcGIS `cod_nodo`).
   * Opcional; cuando está, se exige que coincida con el de la estación para no
   * confundir dos registros con el mismo nombre. No se rellena por proximidad.
   */
  nodeId: z.string().optional(),
  /**
   * Franjas programadas de la parada por `serviceId`. Sin la franja del
   * servicio que opera hoy no se afirma operación ahora (ver
   * `estadoOperacionEnParada` en `lib/evidencia.ts`).
   */
  franjas: z.array(FranjaServicioSchema).default([]),
  /**
   * `true` solo si la diferencia de `order` entre dos paradas del servicio es
   * el número exacto de paradas en TODOS los viajes programados que las unen.
   * Con variantes de patrón que omiten paradas es `false` y no debe decirse un
   * número exacto de estaciones.
   */
  conteoExacto: z.boolean().default(false),
})
export type ServedStop = z.infer<typeof ServedStopSchema>

/**
 * Servicio de un calendario GTFS (`calendar.txt` + `calendar_dates.txt`): días
 * de la semana base y excepciones. Un mismo servicio de transporte puede usar
 * varios (entre semana, sábado, domingo/festivo).
 */
export const ServicioCalendarioSchema = z.object({
  serviceId: z.string(),
  /** Días de la semana que opera, 0 = domingo … 6 = sábado. */
  weekdays: z.array(z.number().int().min(0).max(6)).default([]),
  /** Fechas AAAA-MM-DD que agregan servicio (excepción tipo 1). */
  addedDates: z.array(z.string()).default([]),
  /** Fechas AAAA-MM-DD que retiran servicio (excepción tipo 2). */
  removedDates: z.array(z.string()).default([]),
})
export type ServicioCalendario = z.infer<typeof ServicioCalendarioSchema>

/**
 * Calendario VERIFICADO de un servicio, tomado de una fuente con vigencia
 * (GTFS `calendar` / `calendar_dates`). Sin esto, no se puede afirmar salida
 * inmediata ni disponibilidad actual; el horario textual no lo reemplaza.
 * Una copia anterior (con `weekdays` en la raíz) se lee con `servicios`
 * vacío: no habilita nada hasta regenerarla.
 */
export const VerifiedCalendarSchema = z.object({
  /** Servicios del calendario y sus excepciones. */
  servicios: z.array(ServicioCalendarioSchema).default([]),
  /** Inicio de vigencia, AAAA-MM-DD (GTFS `start_date`). */
  startDate: z.string(),
  /** Fin de vigencia, AAAA-MM-DD (GTFS `end_date`). */
  endDate: z.string(),
  /** Zona horaria de la agencia (GTFS `agency_timezone`). */
  timezone: z.string(),
  /** Fuente del calendario. */
  source: z.string(),
  /** Fecha ISO de la evidencia del calendario. */
  date: z.string(),
})
export type VerifiedCalendar = z.infer<typeof VerifiedCalendarSchema>

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
  /**
   * Calendario verificado del servicio, si una fuente con vigencia lo respalda.
   * Ausente mientras no haya calendario; sin él no se afirma operación actual.
   */
  verifiedCalendar: VerifiedCalendarSchema.optional(),
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
  /**
   * ArcGIS lo pone en `true` cuando recortó el resultado por superar el tope de
   * registros. Una capa recortada entrega un catálogo PARCIAL (faltan rutas o
   * estaciones), que no debe reemplazar al último catálogo válido.
   */
  exceededTransferLimit: z.boolean().optional(),
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
export function reconciliarSentido(from: string, to: string, stops: string[]): DirectionEvidence {
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
      directionEvidence: reconciliarSentido(from, to, stops),
      path,
      schedule: {
        weekday: clean(f.attributes.hor_habil),
        saturday: clean(f.attributes.hor_sab),
        holiday: clean(f.attributes.hor_fest),
      },
    })
  }
  routes.sort((a, b) => a.code.localeCompare(b.code, "es", { numeric: true }))

  // Aplica la evidencia GTFS corroborada (8 G/8 T: sentido, paradas y
  // calendario) tanto a la consulta en vivo como a la copia, para que la
  // corrección no dependa de qué origen de datos respondió.
  aplicarEvidenciaGtfs(routes, stations)

  return { stations, routes, fetchedAt, source }
}

async function queryLayer(layer: number, params: Record<string, string>): Promise<ArcgisFeatureSet> {
  const url = new URL(`${ARCGIS_BASE}/${layer}/query`)
  const query = { outSR: "4326", f: "json", returnGeometry: "true", ...params }
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)

  const response = await fetch(url, { signal: AbortSignal.timeout(LAYER_TIMEOUT_MS) })
  if (!response.ok) throw new Error(`ArcGIS capa ${layer}: HTTP ${response.status}`)
  const parsed = ArcgisFeatureSetSchema.safeParse(await response.json())
  if (!parsed.success) throw new Error(`ArcGIS capa ${layer}: respuesta con otra forma (${parsed.error.issues[0]?.message})`)
  if (parsed.data.error) throw new Error(`ArcGIS capa ${layer}: ${parsed.data.error.message ?? "error"}`)
  // Una capa recortada por el tope de registros devuelve un catálogo PARCIAL:
  // se trata como fallo para no reemplazar el último catálogo válido.
  if (parsed.data.exceededTransferLimit) throw new Error(`ArcGIS capa ${layer}: respuesta recortada (exceededTransferLimit)`)
  // Sin el arreglo `features` (no un arreglo vacío legítimo) la respuesta vino
  // incompleta; también se trata como fallo.
  if (parsed.data.features === undefined) throw new Error(`ArcGIS capa ${layer}: respuesta sin el arreglo de registros`)
  return parsed.data
}

/**
 * Comprueba que un catálogo ya normalizado es USABLE antes de adoptarlo:
 *
 * - Tiene estaciones y rutas.
 * - Cada ruta trae un recorrido dibujable (`path` con 2 o más puntos).
 * - Sus estaciones cercanas al trazado (`stops`) existen en el catálogo.
 * - Sus paradas atendidas (`servedStops`) corresponden a estaciones existentes
 *   según la misma identidad que usa el planificador y tienen procedencia válida.
 *
 * No fija un número exacto de estaciones ni rutas (el catálogo real cambia y las
 * fixtures sintéticas son legítimamente pequeñas), ni invalida nombres de
 * estación duplicados legítimos ni etiquetas `from`/`to` de extremo que no son
 * nombres exactos de estación (se comparan contra `stops`/`servedStops`, no
 * contra `from`/`to`). Solo exige que el resultado no esté vacío ni roto en sus
 * referencias. Devuelve el motivo del primer problema, o `null` si está íntegro.
 */
export function motivoCatalogoNoUsable(data: TransmilenioData): string | null {
  if (!Number.isFinite(Date.parse(data.fetchedAt))) return "el catálogo no trae una fecha de consulta válida"
  if (data.stations.length === 0) return "el catálogo no trae estaciones"
  if (data.routes.length === 0) return "el catálogo no trae rutas"
  if (data.stations.some((s) => !s.id.trim() || !s.name.trim())) return "el catálogo trae una estación sin identificador o nombre"
  const nombres = new Set(data.stations.map((s) => s.name))
  for (const route of data.routes) {
    if (!route.id.trim() || !route.code.trim()) return "el catálogo trae una ruta sin identificador o código"
    if (route.path.length < 2) return `la ruta ${route.code} no trae un recorrido dibujable`
    // `stops` se deduce de las estaciones del propio catálogo; una referencia
    // a una estación ausente delata un resultado incoherente o recombinado.
    const colgada = route.stops.find((name) => !nombres.has(name))
    if (colgada !== undefined) return `la ruta ${route.code} referencia una estación inexistente «${colgada}»`
    for (const parada of route.servedStops) {
      if (!nombres.has(parada.name)) return `la ruta ${route.code} atiende una estación inexistente «${parada.name}»`
      if (!parada.source.trim() || !Number.isFinite(Date.parse(parada.date))) {
        return `la ruta ${route.code} tiene una parada sin procedencia válida en «${parada.name}»`
      }
      if (!data.stations.some((estacion) => paradaCoincideConEstacion(parada, estacion))) {
        return `la ruta ${route.code} atiende «${parada.name}» con un nodo ${parada.nodeId} que no coincide con el catálogo`
      }
    }
  }
  return null
}

/**
 * Detecta una respuesta cruda de ArcGIS MUTILADA: un registro que debería
 * representarse pero perdió una clave SOLICITADA (identificador) o la geometría
 * requerida. No confunde esto con lo que el normalizador descarta a propósito:
 *
 * - Horarios y etiquetas pueden ser nulos; los identificadores y nombres que
 *   necesita el normalizador deben tener contenido para no perder registros.
 * - Una estación sin `num_est`/`nom_est` o sin punto, o una ruta sin `cod_ruta`
 *   o sin `paths`, es un registro incompleto que no debe aceptarse en silencio
 *   como éxito parcial (findings #6 y servidor).
 *
 * Devuelve el motivo del primer registro mutilado, o `null` si la respuesta
 * cruda está completa en identificadores y geometría. NO valida cantidades
 * fijas ni rechaza horarios nulos, códigos o nombres duplicados.
 */
export function motivoRespuestaArcgisIncompleta(
  stationsRaw: ArcgisFeatureSet,
  routesRaw: ArcgisFeatureSet,
): string | null {
  const estaciones = stationsRaw.features ?? []
  for (let i = 0; i < estaciones.length; i++) {
    const f = estaciones[i]
    if (!clean(f.attributes.num_est) || !clean(f.attributes.nom_est)) {
      return `una estación (registro ${i + 1}) llegó sin los atributos solicitados num_est/nom_est`
    }
    if (f.geometry == null || typeof f.geometry.x !== "number" || typeof f.geometry.y !== "number") {
      return `una estación (registro ${i + 1}) llegó sin punto de geometría`
    }
  }
  const rutas = routesRaw.features ?? []
  for (let i = 0; i < rutas.length; i++) {
    const f = rutas[i]
    if (!clean(f.attributes.cod_ruta)) {
      return `una ruta (registro ${i + 1}) llegó sin el atributo solicitado cod_ruta`
    }
    // Una ruta con identificador pero sin recorrido no es representable: su
    // pérdida de geometría mutila el catálogo (no es un descarte intencional).
    const paths = f.geometry?.paths
    if (!Array.isArray(paths) || paths.length === 0) {
      return `una ruta (registro ${i + 1}) llegó sin geometría de recorrido`
    }
  }
  return null
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
  // Rechazo de respuesta cruda mutilada ANTES de normalizar: un registro que
  // perdió identificador o geometría no debe colarse como catálogo parcial.
  const incompleta = motivoRespuestaArcgisIncompleta(stationsRaw, routesRaw)
  if (incompleta) throw new Error(`ArcGIS: respuesta cruda incompleta (${incompleta})`)
  const data = normalizeTransmilenio(stationsRaw, routesRaw, new Date().toISOString(), "live")
  // Integridad semántica: una respuesta en vivo vacía, parcial o con referencias
  // inválidas se rechaza aquí para que quien llama conserve el último catálogo
  // válido en lugar de adoptar datos rotos.
  const motivo = motivoCatalogoNoUsable(data)
  if (motivo) throw new Error(`ArcGIS: catálogo en vivo no usable (${motivo})`)
  return data
}

/**
 * Procedencia del catálogo en una frase corta, en `es-CO`, para que el texto,
 * la voz y el plan de viaje digan de dónde salen los datos y de cuándo son.
 * Es un AVISO DE PROCEDENCIA generado por la app sobre el catálogo (fuente: el
 * servicio en vivo o la copia guardada, y fecha de consulta); NO es un anuncio
 * del operador ni promete tiempo real ni vigencia.
 *
 * Un `source` "snapshot" es la copia local de respaldo: se dice explícitamente
 * para no hacerla pasar por una consulta recién hecha.
 */
export function procedenciaCatalogo(data: Pick<TransmilenioData, "source" | "fetchedAt">): string {
  const fecha = new Date(data.fetchedAt)
  const cuando = Number.isNaN(fecha.getTime()) ? "fecha desconocida" : fecha.toLocaleDateString("es-CO")
  return data.source === "live"
    ? `Datos de TransMilenio consultados el ${cuando}.`
    : `Datos de una copia guardada de TransMilenio del ${cuando} (sin conexión al servicio en vivo).`
}
