import type { BusRoute, ServedStop, ServicioCalendario, Station, VerifiedCalendar } from "@/lib/transmilenio"

/**
 * Validación COMPARTIDA de evidencia de paradas, sentido y calendario.
 *
 * Es el único responsable de decidir si una parada atendida puede usarse para
 * una instrucción de abordaje/descenso/transbordo, y si un servicio está dentro
 * de su horario programado ahora. Lo usan el planificador (`lib/routes.ts`), el
 * asistente (`lib/local-agent.ts`), la revalidación de TripView, el detalle de
 * ruta y el diagnóstico, para que ninguno confíe en datos que otro ya rechazó.
 *
 * Principio: ante evidencia vacía, malformada, futura, vencida, con sentido sin
 * confirmar o secuencia ambigua, se ABSTIENE (no prescribe). "Desconocido" y
 * "vencido" nunca equivalen a "no hay servicio": solo un calendario verificado
 * y vigente puede decir que hoy no hay servicio. Nunca se usa
 * `servedStops ?? stops` ni se confía en `source === "live"` como verificación.
 */

/**
 * Antigüedad máxima de la evidencia, en días. TransMilenio publica el GTFS a
 * diario y el catálogo distrital declara actualización mensual; una copia más
 * vieja que un ciclo mensual puede haber perdido cambios de rutas, paradas o
 * excepciones de calendario, así que se pide regenerarla en vez de seguir
 * prescribiendo con ella. El calendario además tiene su propia vigencia
 * (`startDate`..`endDate`) declarada por la fuente.
 */
export const MAX_EVIDENCIA_DIAS = 31

/** Zona horaria del sistema de transporte. */
export const ZONA_BOGOTA = "America/Bogota"

const DIA_MS = 24 * 60 * 60 * 1000

/** AAAA-MM-DD estricto. */
const SOLO_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/
/** ISO con hora y zona explícita (Z o ±hh:mm); sin zona la hora es ambigua. */
const FECHA_HORA = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/
/** Hora GTFS HH:MM:SS; puede pasar de 24 en viajes que cruzan la medianoche. */
const HORA_GTFS = /^(\d{1,2}):([0-5]\d):([0-5]\d)$/

/** ¿Año/mes/día forman una fecha real del calendario (sin normalizar 30-feb)? */
function fechaReal(anio: number, mes: number, dia: number): boolean {
  const d = new Date(Date.UTC(anio, mes - 1, dia))
  return d.getUTCFullYear() === anio && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia
}

/** ¿Es una fecha AAAA-MM-DD real? */
export function esFechaIso(fecha: unknown): fecha is string {
  if (typeof fecha !== "string") return false
  const m = SOLO_FECHA.exec(fecha)
  return m !== null && fechaReal(Number(m[1]), Number(m[2]), Number(m[3]))
}

/** ¿Es una zona horaria IANA que el entorno reconoce? */
export function zonaValida(zona: unknown): zona is string {
  if (typeof zona !== "string" || zona.trim() === "") return false
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: zona })
    return true
  } catch {
    return false
  }
}

/**
 * Fecha civil (AAAA-MM-DD) y segundos desde la medianoche local de un instante
 * en una zona. No cae a UTC si la zona es inválida: lanza, y los validadores
 * comprueban la zona antes (`zonaValida`).
 */
export function instanteLocal(instante: Date, zona: string = ZONA_BOGOTA): { fecha: string; segundos: number } {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: zona,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instante)
  const v = (tipo: string) => partes.find((p) => p.type === tipo)!.value
  return {
    fecha: `${v("year")}-${v("month")}-${v("day")}`,
    segundos: Number(v("hour")) * 3600 + Number(v("minute")) * 60 + Number(v("second")),
  }
}

/** Fecha civil (AAAA-MM-DD) en una zona horaria. */
export function fechaCivilEnZona(instante: Date, zona: string = ZONA_BOGOTA): string {
  return instanteLocal(instante, zona).fecha
}

/** Día de la semana (0 = domingo … 6 = sábado) de una fecha AAAA-MM-DD real. */
export function diaSemanaDeFecha(fecha: string): number | null {
  if (!esFechaIso(fecha)) return null
  // Mediodía UTC evita que el desfase de zona cambie el día.
  return new Date(`${fecha}T12:00:00Z`).getUTCDay()
}

const diaAnterior = (fecha: string): string => new Date(Date.parse(`${fecha}T12:00:00Z`) - DIA_MS).toISOString().slice(0, 10)

/**
 * ¿La fecha de la evidencia es utilizable ahora? Debe ser ISO real —AAAA-MM-DD
 * (fecha civil de Bogotá) o con hora y zona explícita—, no estar en el futuro y
 * no superar `maxDias`. Sin tolerancia hacia el futuro y sin normalizar fechas
 * imposibles ("2026-02-30" se rechaza).
 */
export function fechaEvidenciaVigente(fecha: unknown, ahora: Date, maxDias = MAX_EVIDENCIA_DIAS): boolean {
  if (typeof fecha !== "string" || !(ahora instanceof Date) || Number.isNaN(ahora.getTime())) return false
  if (esFechaIso(fecha)) {
    const hoy = fechaCivilEnZona(ahora, ZONA_BOGOTA)
    if (fecha > hoy) return false
    return (Date.parse(`${hoy}T00:00:00Z`) - Date.parse(`${fecha}T00:00:00Z`)) / DIA_MS <= maxDias
  }
  const m = FECHA_HORA.exec(fecha)
  if (!m || !fechaReal(Number(m[1]), Number(m[2]), Number(m[3]))) return false
  const t = Date.parse(fecha)
  if (Number.isNaN(t) || t > ahora.getTime()) return false
  return ahora.getTime() - t <= maxDias * DIA_MS
}

/**
 * ¿La secuencia de paradas atendidas es coherente para planear? Exige al menos
 * dos paradas, `order` enteros no negativos y SIN duplicados. Órdenes ambiguos
 * o repetidos hacen abstener. Los huecos son válidos: `order` es la posición en
 * el patrón de origen y puede faltar una parada que el catálogo no tiene.
 */
export function secuenciaAtendidaValida(servedStops: ServedStop[]): boolean {
  if (!Array.isArray(servedStops) || servedStops.length < 2) return false
  const orders = servedStops.map((s) => s?.order)
  if (orders.some((o) => !Number.isInteger(o) || o < 0)) return false
  return new Set(orders).size === orders.length
}

/**
 * ¿El sentido del servicio está confirmado y es consistente? Un sentido
 * `contradictorio`, `indeterminado` o sin verificar impide prescribir: las
 * paradas ordenadas de origen a destino solo valen si el sentido es el real.
 */
export function sentidoConfirmado(route: BusRoute): boolean {
  const ev = route.directionEvidence
  return ev?.verified === true && ev.agreement === "consistente"
}

/**
 * ¿Una parada atendida puede sustentar una instrucción (subir/bajar) ahora?
 * Exige fuente no vacía, estado operativo y fecha de evidencia vigente.
 */
export function paradaPrescriptible(stop: ServedStop, ahora: Date): boolean {
  if (typeof stop.source !== "string" || stop.source.trim() === "") return false
  if (stop.status !== "operativa") return false
  return fechaEvidenciaVigente(stop.date, ahora)
}

/** Dígitos de un identificador de nodo (`02502` y `2502` son el mismo nodo). */
const mismoNodo = (a: string, b: string): boolean => /^\d+$/.test(a) && /^\d+$/.test(b) && Number(a) === Number(b)

/**
 * ¿La parada atendida corresponde de verdad a una estación? Compara por nombre
 * y, si la parada declara `nodeId` (GTFS `parent_station` = ArcGIS `cod_nodo`),
 * exige que coincida numéricamente con el `num_est` de la estación, que sale de
 * la misma capa. Un nodo declarado que no coincide o es ilegible rechaza.
 */
export function paradaCoincideConEstacion(stop: ServedStop, station: Station): boolean {
  if (stop.name !== station.name) return false
  return stop.nodeId === undefined || mismoNodo(stop.nodeId, station.id)
}

/**
 * Paradas atendidas que sí pueden sustentar una instrucción ahora, una por una:
 * sentido confirmado, secuencia coherente y cada parada prescriptible. Es lo
 * que debe usar cualquier pantalla que marque estaciones como verificadas.
 */
export function paradasPrescriptibles(route: BusRoute, ahora: Date): ServedStop[] {
  if (!sentidoConfirmado(route) || !secuenciaAtendidaValida(route.servedStops)) return []
  return route.servedStops.filter((s) => paradaPrescriptible(s, ahora))
}

/** ¿El servicio tiene sentido confirmado, secuencia válida y alguna parada prescriptible? */
export function rutaConParadasVerificadas(route: BusRoute, ahora: Date): boolean {
  return paradasPrescriptibles(route, ahora).length > 0
}

/** Servicio de calendario con todos sus campos bien formados. */
function servicioBienFormado(s: ServicioCalendario): boolean {
  return (
    typeof s?.serviceId === "string" &&
    s.serviceId !== "" &&
    Array.isArray(s.weekdays) &&
    s.weekdays.every((d) => Number.isInteger(d) && d >= 0 && d <= 6) &&
    Array.isArray(s.addedDates) &&
    s.addedDates.every(esFechaIso) &&
    Array.isArray(s.removedDates) &&
    s.removedDates.every(esFechaIso)
  )
}

/**
 * ¿El calendario puede usarse? Exige fuente, fecha de evidencia vigente, zona
 * horaria IANA reconocida, ventana de vigencia real y ordenada, y al menos un
 * servicio bien formado. Cualquier campo malformado lo invalida entero: no se
 * adivina una zona ni se ignoran excepciones ilegibles.
 */
function calendarioUsable(cal: VerifiedCalendar | undefined, ahora: Date): cal is VerifiedCalendar {
  return (
    cal !== undefined &&
    cal !== null &&
    typeof cal.source === "string" &&
    cal.source.trim() !== "" &&
    fechaEvidenciaVigente(cal.date, ahora) &&
    zonaValida(cal.timezone) &&
    esFechaIso(cal.startDate) &&
    esFechaIso(cal.endDate) &&
    cal.startDate <= cal.endDate &&
    Array.isArray(cal.servicios) &&
    cal.servicios.length > 0 &&
    cal.servicios.every(servicioBienFormado)
  )
}

/** Servicios del calendario que operan en una fecha: las excepciones ganan al patrón semanal. */
function serviciosActivos(cal: VerifiedCalendar, fecha: string): ServicioCalendario[] {
  if (fecha < cal.startDate || fecha > cal.endDate) return []
  const dia = diaSemanaDeFecha(fecha)
  return cal.servicios.filter((s) => {
    if (s.removedDates.includes(fecha)) return false
    return s.addedDates.includes(fecha) || (dia !== null && s.weekdays.includes(dia))
  })
}

/**
 * Qué dice el calendario verificado sobre HOY (fecha civil en su zona):
 * - `opera`: algún servicio del calendario tiene servicio programado hoy.
 * - `no-opera`: el calendario vigente dice que hoy ninguno tiene servicio.
 * - `sin-verificar`: calendario ausente, malformado, vencido, futuro o fuera de
 *   su ventana de vigencia. NO significa que no haya servicio.
 */
export type EstadoCalendario = "opera" | "no-opera" | "sin-verificar"

export function estadoCalendarioEnFecha(cal: VerifiedCalendar | undefined, ahora: Date): EstadoCalendario {
  if (!calendarioUsable(cal, ahora)) return "sin-verificar"
  const { fecha } = instanteLocal(ahora, cal.timezone)
  if (fecha < cal.startDate || fecha > cal.endDate) return "sin-verificar"
  return serviciosActivos(cal, fecha).length > 0 ? "opera" : "no-opera"
}

/** ¿El calendario verificado indica servicio programado hoy? (Solo el día, no la hora.) */
export function calendarioOperaEnFecha(cal: VerifiedCalendar | undefined, ahora: Date): boolean {
  return estadoCalendarioEnFecha(cal, ahora) === "opera"
}

/**
 * Estado de la operación PROGRAMADA en una parada, ahora:
 * - `en-franja`: hay servicio programado hoy y la hora cae entre la primera y la
 *   última salida verificadas de esa parada. Es horario programado, no tiempo
 *   real: no implica que un bus salga ya.
 * - `fuera-de-franja`: hay servicio hoy, pero la hora queda fuera de la franja.
 * - `sin-servicio-hoy`: el calendario vigente dice que hoy no hay servicio.
 * - `sin-verificar`: falta o es inválido el calendario, la franja de la parada
 *   o la vigencia. Nada se afirma.
 */
export type EstadoOperacion = "en-franja" | "fuera-de-franja" | "sin-servicio-hoy" | "sin-verificar"

const segundosGtfs = (hora: string): number | null => {
  const m = typeof hora === "string" ? HORA_GTFS.exec(hora) : null
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null
}

export function estadoOperacionEnParada(cal: VerifiedCalendar | undefined, parada: ServedStop, ahora: Date): EstadoOperacion {
  if (!calendarioUsable(cal, ahora)) return "sin-verificar"
  const { fecha, segundos } = instanteLocal(ahora, cal.timezone)
  if (fecha < cal.startDate || fecha > cal.endDate) return "sin-verificar"

  // Horas GTFS >= 24:00 pertenecen al día de servicio anterior: de madrugada se
  // evalúa también el servicio de ayer con la hora desplazada 24 h.
  const ayer = diaAnterior(fecha)
  const candidatos = [
    { servicios: serviciosActivos(cal, fecha), desplazamiento: 0 },
    { servicios: serviciosActivos(cal, ayer), desplazamiento: 86_400 },
  ]
  let faltaFranja = false
  for (const { servicios, desplazamiento } of candidatos) {
    for (const servicio of servicios) {
      const franja = (parada.franjas ?? []).find((f) => f?.serviceId === servicio.serviceId)
      const primera = franja ? segundosGtfs(franja.primera) : null
      const ultima = franja ? segundosGtfs(franja.ultima) : null
      if (primera === null || ultima === null || primera > ultima) {
        // Solo el servicio de hoy puede dejar la respuesta sin verificar; el de
        // ayer únicamente aporta la cola de madrugada.
        if (desplazamiento === 0) faltaFranja = true
        continue
      }
      if (segundos + desplazamiento >= primera && segundos + desplazamiento <= ultima) return "en-franja"
    }
  }
  if (faltaFranja) return "sin-verificar"
  return candidatos[0].servicios.length > 0 ? "fuera-de-franja" : "sin-servicio-hoy"
}
