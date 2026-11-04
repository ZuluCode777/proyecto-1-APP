import type { DirectionEvidence, ServedStop, VerifiedCalendar } from "@/lib/transmilenio"

/**
 * Evidencia CORROBORADA del GTFS oficial de TransMilenio para el issue #31.
 *
 * Fuente primaria: feed GTFS diario de TransMilenio S.A.
 *   https://gtfs.transmilenio.gov.co/manifest.json
 *   GTFS.zip generado 2026-11-03T04:19:59-05:00, 119 934 110 bytes,
 *   SHA256 2e916be87f4341edcc894fc2185875e63df1e6f6b8f8ecabbf81a5310bd87f43.
 * Licencia declarada en el catálogo institucional (metadatos 2022/2023):
 *   CC-BY-SA-4.0. El ZIP diario no repite la licencia; se documenta el alcance
 *   sin inventar una licencia específica ni equiparar ausencia de aviso con
 *   prohibición. Atribución: TransMilenio S.A.
 *
 * El coordinador descargó y verificó manifest, hash, routes/trips/stop_times,
 * calendarios y la unión GIS↔GTFS por `route_id`. Aquí se transcribe solo lo
 * CORROBORADO para los servicios en alcance de #31. No se incluye el ZIP crudo
 * (120 MB); `stop_times` (573 MB) se procesa en origen por streaming.
 *
 * Límite honesto: de los patrones completos (27 paradas en 8 G/8 T) el
 * coordinador entregó los EXTREMOS verificados y los nodos (`parent_station` =
 * `cod_nodo`), no la secuencia intermedia paso a paso. Por eso aquí se afirman
 * como paradas atendidas únicamente los extremos del patrón dominante
 * (abordaje en origen, descenso en destino); las intermedias quedan como
 * recorrido, en abstención segura, hasta transcribir la secuencia completa.
 */

export const GTFS_FUENTE =
  "GTFS oficial TransMilenio S.A. (gtfs.transmilenio.gov.co), ZIP 2026-11-03, verificado por coordinación"
export const GTFS_FECHA = "2026-11-03"

/**
 * Calendario verificado de los servicios troncales en alcance. Según el feed:
 * feed_info y calendar declaran vigencia 2026-01-01..2026-12-31; service_id 1
 * = lunes a viernes, 2 = sábado, 4 = domingo; agency_timezone America/Bogota.
 * calendar_dates agrega/retira fechas (p. ej. 2026-11-02 y 2026-11-16); aquí se
 * registran las dos excepciones corroboradas. No se infiere festivo del texto.
 */
const CALENDARIO_LV: VerifiedCalendar = {
  weekdays: [1, 2, 3, 4, 5], // lunes a viernes (service_id 1)
  startDate: "2026-01-01",
  endDate: "2026-12-31",
  // Excepción tipo 1 (agrega): 2026-11-16 declarado como día con servicio L-V.
  addedDates: ["2026-11-16"],
  // Excepción tipo 2 (retira): 2026-11-02 declarado sin este servicio.
  removedDates: ["2026-11-02"],
  timezone: "America/Bogota",
  source: GTFS_FUENTE,
  date: GTFS_FECHA,
}

const extremo = (name: string, order: number, nodeId: string, canBoard: boolean, canAlight: boolean): ServedStop => ({
  name,
  order,
  canBoard,
  canAlight,
  source: GTFS_FUENTE,
  date: GTFS_FECHA,
  status: "operativa",
  nodeId,
})

/**
 * Corrección y evidencia por servicio, indexada por el código tal como aparece
 * en el catálogo (`BusRoute.code`). Solo incluye los servicios corroborados.
 *
 * - `from`/`to`/`label`: corregidos desde GTFS cuando GIS los traía invertidos.
 *   Se preserva la geometría (`path`) y la lista de estaciones cercanas al
 *   trazado (`stops`); NO se invierten.
 * - `servedStops`: extremos verificados del patrón dominante (ver nota arriba).
 *   Los nombres deben existir en `Station.name`; el que aporte la migración.
 * - `directionEvidence.verified`: true, porque la unión GIS↔GTFS confirma el
 *   sentido real.
 */
export type CorreccionServicio = {
  from: string
  to: string
  label: string
  directionEvidence: DirectionEvidence
  servedStops: ServedStop[]
  verifiedCalendar: VerifiedCalendar
}

/**
 * 8 G (GIS route_id 13307 = GTFS 13307): patrón dominante (565/567 viajes, 27
 * paradas) va Terminal (nodo 2502) → Guatoque - Veraguas (nodo 7201). GIS traía
 * orig/dest invertidos. La secuencia de `stops` del catálogo ya empieza en
 * Terminal y termina en Guatoque, es decir coincide con el sentido real.
 */
const OCHO_G: CorreccionServicio = {
  from: "Terminal",
  to: "Guatoque - Veraguas",
  label: "Terminal hacia Guatoque - Veraguas",
  directionEvidence: {
    agreement: "consistente",
    verified: true,
    note: "GTFS route_id 13307: patrón dominante Terminal (nodo 2502) → Guatoque - Veraguas (nodo 7201). GIS tenía orig/dest invertidos; corregidos. Geometría preservada.",
  },
  servedStops: [
    extremo("Terminal", 0, "2502", true, false),
    extremo("Guatoque - Veraguas", 26, "7201", false, true),
  ],
  verifiedCalendar: CALENDARIO_LV,
}

/**
 * 8 T (GIS route_id 13308 = GTFS 13308): patrón dominante (564/599 viajes, 27
 * paradas) va Guatoque - Veraguas (nodo 7201) → Terminal (nodo 2502). GIS traía
 * orig/dest invertidos. La secuencia de `stops` del catálogo empieza en
 * Guatoque y termina en Terminal, coincidiendo con el sentido real.
 */
const OCHO_T: CorreccionServicio = {
  from: "Guatoque - Veraguas",
  to: "Terminal",
  label: "Guatoque - Veraguas hacia Terminal",
  directionEvidence: {
    agreement: "consistente",
    verified: true,
    note: "GTFS route_id 13308: patrón dominante Guatoque - Veraguas (nodo 7201) → Terminal (nodo 2502). GIS tenía orig/dest invertidos; corregidos. Geometría preservada.",
  },
  servedStops: [
    extremo("Guatoque - Veraguas", 0, "7201", true, false),
    extremo("Terminal", 26, "2502", false, true),
  ],
  verifiedCalendar: CALENDARIO_LV,
}

/**
 * Correcciones por código de servicio. Solo 8 G y 8 T: son los servicios cuya
 * dirección el coordinador corroboró contra el GTFS. H72 se trata aparte
 * (`H72_NO_PARA_EN`), porque la evidencia es que NO atiende ciertos nodos, no
 * una corrección de sentido.
 */
export const CORRECCIONES_GTFS: Record<string, CorreccionServicio> = {
  "8 G": OCHO_G,
  "8 T": OCHO_T,
}

/**
 * Nodos donde el GTFS verifica que H72 (route_id 13476) NO se detiene, pese a
 * que su recorrido pase cerca. Evidencia independiente del aviso histórico de
 * 2018: ninguno de los patrones de H72 contiene el nodo 2202 (Calle 127). El
 * patrón principal (557/573 viajes, 15 paradas) va Toberín (nodo 2101) → Portal
 * Usme (nodo 90004).
 *
 * No se agregan `servedStops` positivos para H72 porque no se transcribió su
 * secuencia completa; basta con impedir que la cercanía a Calle 127 se use como
 * abordaje. Como `servedStops` queda vacío, el planificador ya se abstiene.
 */
export const H72_NO_PARA_EN: { code: string; nodos: string[]; nota: string } = {
  code: "H72",
  nodos: ["2202"], // Calle 127
  nota: "GTFS route_id 13476: ningún patrón incluye el nodo 2202 (Calle 127). Toberín (2101) → Portal Usme (90004) en el patrón principal.",
}

/** Forma mínima de un servicio para aplicarle las correcciones. */
type RutaCorregible = {
  code: string
  from: string
  to: string
  label: string
  stops: string[]
  servedStops: ServedStop[]
  directionEvidence: DirectionEvidence
  verifiedCalendar?: VerifiedCalendar
}

/**
 * Aplica la evidencia GTFS corroborada a las rutas, venga de la consulta en
 * vivo o de la copia guardada, para que la corrección de 8 G/8 T y sus paradas
 * verificadas lleguen a la app en ambos casos. Las paradas verificadas solo se
 * fijan si sus estaciones existen en el catálogo (no se inventan). PRESERVA la
 * geometría (`stops`) y no toca el resto de servicios.
 *
 * Es idempotente: puede ejecutarse sobre datos ya corregidos sin cambiarlos.
 */
export function aplicarEvidenciaGtfs<T extends RutaCorregible>(routes: T[], nombresEstacion: Set<string>): T[] {
  for (const route of routes) {
    const correccion = CORRECCIONES_GTFS[route.code]
    if (!correccion) continue
    const paradasValidas = correccion.servedStops.every((p) => nombresEstacion.has(p.name))
    route.from = correccion.from
    route.to = correccion.to
    route.label = correccion.label
    route.directionEvidence = correccion.directionEvidence
    route.verifiedCalendar = correccion.verifiedCalendar
    // Solo se fijan paradas verificadas si todas existen en el catálogo.
    route.servedStops = paradasValidas ? correccion.servedStops.map((p) => ({ ...p })) : []
  }
  return routes
}
