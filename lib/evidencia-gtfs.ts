import { paradaCoincideConEstacion } from "@/lib/evidencia"
import type { DirectionEvidence, ServedStop, Station, VerifiedCalendar } from "@/lib/transmilenio"

/**
 * Evidencia CORROBORADA del GTFS oficial de TransMilenio para el issue #31.
 *
 * Fuente primaria: feed GTFS diario de TransMilenio S.A.
 *   https://gtfs.transmilenio.gov.co/manifest.json (generado 2026-11-03T04:19:59-05:00)
 *   https://gtfs.transmilenio.gov.co/GTFS.zip, 119 934 110 bytes,
 *   SHA-256 2e916be87f4341edcc894fc2185875e63df1e6f6b8f8ecabbf81a5310bd87f43.
 * Licencia: el catálogo distrital declara CC-BY-SA-4.0 para su conjunto GTFS
 * (metadatos 2022/2023); el portal nuevo, su manifest y el ZIP diario no
 * repiten ese aviso. No se inventa una licencia específica del endpoint ni se
 * toma la ausencia de aviso por prohibición. Atribución: TransMilenio S.A.
 *
 * Qué se transcribe (extraído por streaming de `stop_times.txt`, 573 MB; el ZIP
 * crudo no se versiona):
 * - `calendar.txt`/`calendar_dates.txt` completos para los `service_id` que usan
 *   8 G y 8 T: 1 (lunes a viernes), 2 (sábado) y 4 (domingo/festivo), vigentes
 *   2026-01-01..2026-12-31 (igual que `feed_info.txt`). Zona `America/Bogota`
 *   (`agency.txt`). Las 19 excepciones por servicio se transcriben enteras: el
 *   servicio 1 y el 2 se retiran y el 4 se agrega en cada fecha de la lista.
 * - El patrón de paradas COMPLETO (27 paradas, `stop_sequence` 1..27) con más
 *   viajes: 565/567 viajes de 13307 (8 G) y 564/599 de 13308 (8 T). `order` es
 *   `stop_sequence - 1`. Cada parada trae la primera y la última salida
 *   programadas por `service_id`, medidas solo sobre los viajes de ese patrón.
 *   Calle 53 (`parent_station` 90012) no existe en la capa de estaciones del
 *   catálogo y queda fuera: no se inventa una estación.
 * - 8 T tiene variantes que omiten Calle 187 (7 viajes) y otras salen de
 *   mitad de ruta; por eso su `conteoExacto` es falso. 8 G solo tiene una
 *   variante que es un tramo contiguo del patrón completo (2 viajes).
 *
 * Límite honesto: son horarios PROGRAMADOS del 2026-11-03. No hay tiempo real,
 * ni se comprobó la operación física. La evidencia caduca según
 * `MAX_EVIDENCIA_DIAS` (lib/evidencia.ts) y debe regenerarse del GTFS vigente.
 */

export const GTFS_FUENTE =
  "GTFS oficial TransMilenio S.A. (gtfs.transmilenio.gov.co/GTFS.zip), publicado 2026-11-03, SHA-256 2e916be8…bd87f43"
export const GTFS_FECHA = "2026-11-03"

/** Fechas con excepción en `calendar_dates.txt` (festivos): 19 por servicio. */
const FECHAS_EXCEPCION = [
  "2026-01-01",
  "2026-01-12",
  "2026-03-23",
  "2026-04-02",
  "2026-04-03",
  "2026-05-01",
  "2026-05-18",
  "2026-06-08",
  "2026-06-15",
  "2026-06-29",
  "2026-07-13",
  "2026-07-20",
  "2026-08-07",
  "2026-08-17",
  "2026-10-12",
  "2026-11-02",
  "2026-11-16",
  "2026-12-08",
  "2026-12-25"
]

const CALENDARIO_GTFS: VerifiedCalendar = {
  servicios: [
    { serviceId: "1", weekdays: [1, 2, 3, 4, 5], addedDates: [], removedDates: FECHAS_EXCEPCION },
    { serviceId: "2", weekdays: [6], addedDates: [], removedDates: FECHAS_EXCEPCION },
    { serviceId: "4", weekdays: [0], addedDates: FECHAS_EXCEPCION, removedDates: [] },
  ],
  startDate: "2026-01-01",
  endDate: "2026-12-31",
  timezone: "America/Bogota",
  source: GTFS_FUENTE,
  date: GTFS_FECHA,
}

type Franja = [primera: string, ultima: string]
/** orden, nodo (`parent_station`), nombre en el catálogo, franjas de los servicios 1, 2 y 4. */
type FilaParada = [orden: number, nodo: string, nombre: string, lunesAViernes: Franja, sabado: Franja, domingo: Franja]

/** 8 G (route_id 13307, shape 13307), Terminal → Guatoque - Veraguas. */
const PARADAS_8G: FilaParada[] = [
  [0, "2502", "Terminal", ["04:30:00", "23:00:00"], ["04:30:00", "23:00:00"], ["04:30:00", "22:00:00"]],
  [1, "2001", "Calle 187", ["04:32:08", "23:02:24"], ["04:31:56", "23:01:48"], ["04:31:46", "22:01:54"]],
  [2, "2000", "Portal Norte – Unicervantes", ["04:35:16", "23:05:56"], ["04:34:46", "23:04:27"], ["04:34:23", "22:04:43"]],
  [3, "2101", "Toberin - Foundever", ["04:37:47", "23:08:47"], ["04:37:03", "23:06:35"], ["04:36:29", "22:06:58"]],
  [4, "2102", "Calle 161", ["04:39:38", "23:10:52"], ["04:38:43", "23:08:09"], ["04:38:01", "22:08:37"]],
  [5, "2103", "Mazurén", ["04:42:16", "23:13:51"], ["04:41:07", "23:10:24"], ["04:40:13", "22:11:00"]],
  [6, "2104", "Calle 146", ["04:44:00", "23:15:49"], ["04:42:41", "23:11:52"], ["04:41:40", "22:12:33"]],
  [7, "2105", "Calle 142", ["04:45:30", "23:17:30"], ["04:44:03", "23:13:08"], ["04:42:55", "22:13:53"]],
  [8, "2200", "Alcalá – Colegio S. Tomás Dominicos", ["04:48:16", "23:20:37"], ["04:46:32", "23:15:28"], ["04:45:12", "22:16:21"]],
  [9, "2201", "Prado", ["04:50:30", "23:23:08"], ["04:48:34", "23:17:21"], ["04:47:04", "22:18:21"]],
  [10, "2202", "Calle 127", ["04:54:27", "23:27:37"], ["04:52:09", "23:20:42"], ["04:50:22", "22:21:54"]],
  [11, "2204", "Pepe Sierra Universidad UTEL", ["04:56:58", "23:30:27"], ["04:54:26", "23:22:50"], ["04:52:27", "22:24:09"]],
  [12, "2205", "Calle 106 - Maletas Explora", ["04:58:28", "23:32:08"], ["04:55:47", "23:24:06"], ["04:53:42", "22:25:29"]],
  [13, "2300", "Calle 100 - Marketmedios", ["05:02:18", "23:36:28"], ["04:59:16", "23:27:21"], ["04:56:54", "22:28:55"]],
  [14, "2302", "Virrey", ["05:05:20", "23:39:53"], ["05:02:00", "23:29:55"], ["04:59:25", "22:31:38"]],
  [15, "2303", "Calle 85", ["05:06:57", "23:41:42"], ["05:03:28", "23:31:17"], ["05:00:46", "22:33:05"]],
  [16, "2304", "Héroes - Colmena Seguros", ["05:08:18", "23:43:14"], ["05:04:42", "23:32:26"], ["05:01:54", "22:34:18"]],
  [17, "9122", "Calle 72 - Areandina", ["05:12:47", "23:48:18"], ["05:08:45", "23:36:13"], ["05:05:37", "22:38:18"]],
  [18, "9121", "Temporal Flores – Areandina", ["05:14:30", "23:50:14"], ["05:10:19", "23:37:41"], ["05:07:03", "22:39:51"]],
  [19, "9119", "Temporal Calle 57", ["05:17:11", "23:53:16"], ["05:12:45", "23:39:57"], ["05:09:18", "22:42:15"]],
  [21, "9116", "Temporal AV. 39", ["05:24:26", "24:01:27"], ["05:19:18", "23:46:05"], ["05:15:19", "22:48:44"]],
  [22, "9114", "Calle 26 - Atrio", ["05:28:33", "24:06:06"], ["05:23:03", "23:49:35"], ["05:18:46", "22:52:26"]],
  [23, "9113", "Temporal Calle 22", ["05:31:35", "24:09:32"], ["05:25:48", "23:52:09"], ["05:21:17", "22:55:09"]],
  [24, "9110", "Temporal AV. Jiménez - Inter Eléctricas", ["05:35:34", "24:14:01"], ["05:29:24", "23:55:31"], ["05:24:36", "22:58:43"]],
  [25, "7200", "Tygua - San José", ["05:39:11", "24:18:07"], ["05:32:41", "23:58:35"], ["05:27:37", "23:01:57"]],
  [26, "7201", "Guatoque - Veraguas", ["05:41:45", "24:21:00"], ["05:35:00", "24:00:45"], ["05:29:45", "23:04:15"]],
]

/** 8 T (route_id 13308, shape 13308), Guatoque - Veraguas → Terminal. */
const PARADAS_8T: FilaParada[] = [
  [0, "7201", "Guatoque - Veraguas", ["04:30:00", "23:35:00"], ["04:30:00", "23:35:00"], ["04:30:00", "22:35:00"]],
  [1, "7200", "Tygua - San José", ["04:32:32", "23:37:28"], ["04:32:30", "23:37:26"], ["04:32:26", "22:37:14"]],
  [2, "9110", "Temporal AV. Jiménez - Inter Eléctricas", ["04:35:38", "23:40:29"], ["04:35:34", "23:40:25"], ["04:35:25", "22:39:59"]],
  [3, "9113", "Temporal Calle 22", ["04:39:41", "23:44:26"], ["04:39:35", "23:44:19"], ["04:39:19", "22:43:35"]],
  [4, "9114", "Calle 26 - Atrio", ["04:42:11", "23:46:52"], ["04:42:03", "23:46:44"], ["04:41:44", "22:45:48"]],
  [5, "9116", "Temporal AV. 39", ["04:46:11", "23:50:45"], ["04:46:00", "23:50:34"], ["04:45:34", "22:49:20"]],
  [7, "9119", "Temporal Calle 57", ["04:52:17", "23:56:42"], ["04:52:02", "23:56:26"], ["04:51:26", "22:54:44"]],
  [8, "9121", "Temporal Flores – Areandina", ["04:55:17", "23:59:37"], ["04:55:00", "23:59:19"], ["04:54:19", "22:57:24"]],
  [9, "9122", "Calle 72 - Areandina", ["04:57:17", "24:01:33"], ["04:56:58", "24:01:14"], ["04:56:14", "22:59:09"]],
  [10, "2304", "Héroes - Colmena Seguros", ["05:00:51", "24:05:01"], ["05:00:29", "24:04:40"], ["04:59:40", "23:02:19"]],
  [11, "2303", "Calle 85", ["05:01:51", "24:06:00"], ["05:01:29", "24:05:38"], ["05:00:38", "23:03:12"]],
  [12, "2302", "Virrey", ["05:03:22", "24:07:29"], ["05:02:59", "24:07:06"], ["05:02:06", "23:04:33"]],
  [13, "2300", "Calle 100 - Marketmedios", ["05:06:18", "24:10:19"], ["05:05:53", "24:09:54"], ["05:04:54", "23:07:08"]],
  [14, "2205", "Calle 106 - Maletas Explora", ["05:08:59", "24:12:57"], ["05:08:32", "24:12:30"], ["05:07:30", "23:09:31"]],
  [15, "2204", "Pepe Sierra Universidad UTEL", ["05:11:08", "24:15:02"], ["05:10:40", "24:14:34"], ["05:09:34", "23:11:26"]],
  [16, "2202", "Calle 127", ["05:13:25", "24:17:15"], ["05:12:55", "24:16:45"], ["05:11:45", "23:13:26"]],
  [17, "2201", "Prado", ["05:16:47", "24:20:32"], ["05:16:15", "24:20:00"], ["05:15:00", "23:16:25"]],
  [18, "2200", "Alcalá – Colegio S. Tomás Dominicos", ["05:19:06", "24:22:47"], ["05:18:32", "24:22:13"], ["05:17:13", "23:18:28"]],
  [19, "2105", "Calle 142", ["05:20:51", "24:24:29"], ["05:20:16", "24:23:54"], ["05:18:54", "23:20:01"]],
  [20, "2104", "Calle 146", ["05:22:29", "24:26:05"], ["05:21:53", "24:25:29"], ["05:20:29", "23:21:29"]],
  [21, "2103", "Mazurén", ["05:23:33", "24:27:07"], ["05:22:56", "24:26:31"], ["05:21:31", "23:22:25"]],
  [22, "2102", "Calle 161", ["05:26:01", "24:29:31"], ["05:25:22", "24:28:52"], ["05:23:52", "23:24:36"]],
  [23, "2101", "Toberin - Foundever", ["05:27:34", "24:31:02"], ["05:26:55", "24:30:23"], ["05:25:23", "23:25:59"]],
  [24, "2000", "Portal Norte – Unicervantes", ["05:30:54", "24:34:17"], ["05:30:13", "24:33:35"], ["05:28:35", "23:28:56"]],
  [25, "2001", "Calle 187", ["05:33:34", "24:36:52"], ["05:32:50", "24:36:08"], ["05:31:08", "23:31:17"]],
  [26, "2502", "Terminal", ["05:35:30", "24:38:45"], ["05:34:45", "24:38:00"], ["05:33:00", "23:33:00"]],
]

const paradasServidas = (filas: FilaParada[], conteoExacto: boolean): ServedStop[] =>
  filas.map(([order, nodeId, name, ...franjas], i) => ({
    name,
    order,
    // GTFS no trae pickup_type ni drop_off_type: toda parada intermedia es regular.
    canBoard: i < filas.length - 1,
    canAlight: i > 0,
    source: GTFS_FUENTE,
    date: GTFS_FECHA,
    status: "operativa",
    nodeId,
    franjas: franjas.map(([primera, ultima], k) => ({ serviceId: ["1", "2", "4"][k], primera, ultima })),
    conteoExacto,
  }))

/**
 * Corrección y evidencia por servicio, indexada por el código tal como aparece
 * en el catálogo (`BusRoute.code`). Solo incluye los servicios corroborados.
 *
 * - `from`/`to`/`label`: corregidos desde GTFS cuando GIS los traía invertidos.
 *   Se preserva la geometría (`path`) y la lista de estaciones cercanas al
 *   trazado (`stops`); NO se invierten.
 * - `servedStops`: paradas del patrón completo, de origen a destino.
 * - `directionEvidence.verified`: true, porque la unión GIS↔GTFS por `route_id`
 *   confirma el sentido real.
 */
export type CorreccionServicio = {
  from: string
  to: string
  label: string
  directionEvidence: DirectionEvidence
  servedStops: ServedStop[]
  verifiedCalendar: VerifiedCalendar
}

export const CORRECCIONES_GTFS: Record<string, CorreccionServicio> = {
  // GIS traía orig/dest invertidos para 13307; la geometría ya avanza Terminal → Guatoque.
  "8 G": {
    from: "Terminal",
    to: "Guatoque - Veraguas",
    label: "Terminal hacia Guatoque - Veraguas",
    directionEvidence: {
      agreement: "consistente",
      verified: true,
      note: "GTFS route_id 13307: patrón completo Terminal (nodo 2502) → Guatoque - Veraguas (nodo 7201). GIS tenía orig/dest invertidos; corregidos. Geometría preservada.",
    },
    servedStops: paradasServidas(PARADAS_8G, true),
    verifiedCalendar: CALENDARIO_GTFS,
  },
  // GIS traía orig/dest invertidos para 13308; la geometría ya avanza Guatoque → Terminal.
  "8 T": {
    from: "Guatoque - Veraguas",
    to: "Terminal",
    label: "Guatoque - Veraguas hacia Terminal",
    directionEvidence: {
      agreement: "consistente",
      verified: true,
      note: "GTFS route_id 13308: patrón completo Guatoque - Veraguas (nodo 7201) → Terminal (nodo 2502). GIS tenía orig/dest invertidos; corregidos. Geometría preservada.",
    },
    servedStops: paradasServidas(PARADAS_8T, false),
    verifiedCalendar: CALENDARIO_GTFS,
  },
}

/**
 * Nodos donde el GTFS verifica que H72 (route_id 13476) NO se detiene, pese a
 * que su recorrido pase cerca. Evidencia independiente del aviso histórico de
 * 2018: ninguno de sus dos patrones (557 y 16 viajes) contiene el nodo 2202
 * (Calle 127). El principal va Toberín (2101) → Portal Usme (90004).
 *
 * No se agregan paradas positivas para H72: no se transcribió su secuencia.
 * `aplicarEvidenciaGtfs` solo se asegura de que Calle 127 no figure como
 * parada atendida de H72 aunque otra fuente la sume.
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
 * lleguen a la app en ambos casos.
 *
 * Solo se aplica si la geometría del servicio coincide con el sentido GTFS
 * (primera y última estación cercana al trazado): si la capa GIS cambió o
 * invirtió el trazado, la evidencia transcrita ya no describe ese registro y el
 * servicio queda como está, sin prescribir. Las paradas solo se fijan si su
 * estación existe en el catálogo con el mismo nodo. PRESERVA la geometría
 * (`stops`, `path`) y no toca el resto de servicios. Es idempotente.
 */
export function aplicarEvidenciaGtfs<T extends RutaCorregible>(routes: T[], estaciones: Station[]): T[] {
  for (const route of routes) {
    if (route.code === H72_NO_PARA_EN.code) {
      const prohibidas = new Set(
        estaciones.filter((e) => H72_NO_PARA_EN.nodos.some((n) => Number(n) === Number(e.id))).map((e) => e.name),
      )
      route.servedStops = route.servedStops.filter((p) => !prohibidas.has(p.name))
      continue
    }
    const correccion = CORRECCIONES_GTFS[route.code]
    if (!correccion) continue
    if (route.stops[0] !== correccion.from || route.stops[route.stops.length - 1] !== correccion.to) continue
    route.from = correccion.from
    route.to = correccion.to
    route.label = correccion.label
    route.directionEvidence = { ...correccion.directionEvidence }
    route.verifiedCalendar = structuredClone(correccion.verifiedCalendar)
    route.servedStops = correccion.servedStops
      .filter((p) => estaciones.some((e) => paradaCoincideConEstacion(p, e)))
      .map((p) => structuredClone(p))
  }
  return routes
}
