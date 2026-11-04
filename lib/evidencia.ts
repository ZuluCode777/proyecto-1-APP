import type { BusRoute, Station, ServedStop, VerifiedCalendar } from "@/lib/transmilenio"

/**
 * Validación COMPARTIDA de evidencia de paradas, sentido y calendario.
 *
 * Es el único responsable de decidir si una parada atendida puede usarse para
 * una instrucción de abordaje/descenso/transbordo, y si un servicio puede
 * recomendarse como operativo ahora. Lo usan el planificador (`lib/routes.ts`),
 * el asistente (`lib/local-agent.ts`), la revalidación de TripView y el
 * diagnóstico. Centralizarlo evita que un consumidor confíe en datos que otro
 * ya rechazó.
 *
 * Principio: ante evidencia vacía, inválida, futura, vencida, con sentido
 * desconocido o secuencia ambigua, se ABSTIENE (no prescribe). Nunca se usa
 * `servedStops ?? stops` ni se confía en `source === "live"` como verificación.
 */

/** Antigüedad máxima de la evidencia de una parada, en días. */
export const MAX_EVIDENCIA_DIAS = 400

/** Zona horaria del sistema de transporte. */
export const ZONA_BOGOTA = "America/Bogota"

/** AAAA-MM-DD estricto. */
const SOLO_FECHA = /^\d{4}-\d{2}-\d{2}$/

/**
 * Fecha civil (AAAA-MM-DD) en una zona horaria, para comparar calendarios sin
 * depender de la zona del servidor. Usa `Intl` con `en-CA`, que entrega
 * AAAA-MM-DD.
 */
export function fechaCivilEnZona(instante: Date, zona: string = ZONA_BOGOTA): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: zona,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(instante)
  } catch {
    // Zona inválida: cae a UTC, que al menos es determinista.
    return instante.toISOString().slice(0, 10)
  }
}

/** Día de la semana (0 = domingo … 6 = sábado) de una fecha AAAA-MM-DD. */
export function diaSemanaDeFecha(fecha: string): number | null {
  if (!SOLO_FECHA.test(fecha)) return null
  // Mediodía UTC evita que el desfase de zona cambie el día.
  const d = new Date(`${fecha}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return null
  return d.getUTCDay()
}

/**
 * ¿La fecha de la evidencia es utilizable ahora? Debe venir, ser una fecha
 * real, no estar en el futuro y no superar `MAX_EVIDENCIA_DIAS`. Acepta tanto
 * AAAA-MM-DD como ISO con hora.
 */
export function fechaEvidenciaVigente(fecha: string, ahora: Date, maxDias = MAX_EVIDENCIA_DIAS): boolean {
  if (typeof fecha !== "string" || fecha.trim() === "") return false
  const t = Date.parse(fecha)
  if (Number.isNaN(t)) return false
  const diffMs = ahora.getTime() - t
  // Futuro: no es evidencia de hoy. Se tolera un margen de un día por zona horaria.
  if (diffMs < -24 * 60 * 60 * 1000) return false
  const diffDias = diffMs / (24 * 60 * 60 * 1000)
  if (diffDias > maxDias) return false
  return true
}

/**
 * ¿La secuencia de paradas atendidas es coherente para planear? Exige al menos
 * dos paradas, `order` enteros no negativos, SIN duplicados y en orden estricto
 * creciente al ordenarlas. Órdenes ambiguos o repetidos hacen abstener.
 */
export function secuenciaAtendidaValida(servedStops: ServedStop[]): boolean {
  if (servedStops.length < 2) return false
  const orders = servedStops.map((s) => s.order)
  if (orders.some((o) => !Number.isInteger(o) || o < 0)) return false
  const unicos = new Set(orders)
  if (unicos.size !== orders.length) return false
  return true
}

/**
 * ¿Una parada atendida puede sustentar una instrucción (subir/bajar) ahora?
 * Exige fuente no vacía, estado operativo, fecha vigente y —si la estación
 * trae nodo o la parada trae `nodeId`— que coincidan. No rellena nodos por
 * proximidad.
 */
export function paradaPrescriptible(stop: ServedStop, ahora: Date): boolean {
  if (typeof stop.source !== "string" || stop.source.trim() === "") return false
  if (stop.status !== "operativa") return false
  if (!fechaEvidenciaVigente(stop.date, ahora)) return false
  return true
}

/**
 * ¿La parada atendida corresponde de verdad a una estación del lugar? Compara
 * por nombre y, si la parada declara `nodeId`, exige que no contradiga el nodo
 * de la estación (cuando la estación lo exponga vía `Station`).
 */
export function paradaCoincideConEstacion(stop: ServedStop, station: Station): boolean {
  return stop.name === station.name
}

/**
 * ¿El servicio tiene al menos una parada prescriptible y una secuencia válida?
 * Base para que el planificador considere la ruta.
 */
export function rutaConParadasVerificadas(route: BusRoute, ahora: Date): boolean {
  if (!secuenciaAtendidaValida(route.servedStops)) return false
  return route.servedStops.some((s) => paradaPrescriptible(s, ahora))
}

/**
 * ¿El calendario verificado indica que el servicio opera en la fecha dada
 * (zona America/Bogota)? Aplica ventana de vigencia, día de la semana y
 * excepciones (fechas agregadas/retiradas). Sin calendario, devuelve `false`:
 * no se afirma operación.
 */
export function calendarioOperaEnFecha(cal: VerifiedCalendar | undefined, ahora: Date): boolean {
  if (!cal) return false
  if (!fechaEvidenciaVigente(cal.date, ahora)) return false
  const hoy = fechaCivilEnZona(ahora, cal.timezone || ZONA_BOGOTA)
  if (!SOLO_FECHA.test(cal.startDate) || !SOLO_FECHA.test(cal.endDate)) return false
  if (hoy < cal.startDate || hoy > cal.endDate) return false
  // Excepciones explícitas ganan sobre el patrón semanal.
  if (cal.removedDates.includes(hoy)) return false
  if (cal.addedDates.includes(hoy)) return true
  const dia = diaSemanaDeFecha(hoy)
  if (dia === null) return false
  return cal.weekdays.includes(dia)
}

/**
 * Resultado de evaluar si un servicio se puede recomendar como VIAJE OPERATIVO
 * ahora: paradas verificadas y, cuando hay calendario, que opere hoy.
 */
export type EstadoOperativo = {
  /** Paradas verificadas y secuencia coherente. */
  paradasVerificadas: boolean
  /** Hay calendario verificado y dice que opera hoy. */
  operaHoy: boolean
  /** Hay calendario verificado (aunque no opere hoy). */
  tieneCalendario: boolean
}

export function estadoOperativo(route: BusRoute, ahora: Date): EstadoOperativo {
  return {
    paradasVerificadas: rutaConParadasVerificadas(route, ahora),
    operaHoy: calendarioOperaEnFecha(route.verifiedCalendar, ahora),
    tieneCalendario: Boolean(route.verifiedCalendar),
  }
}
