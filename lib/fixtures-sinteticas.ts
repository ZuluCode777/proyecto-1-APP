import type { BusRoute, Station, TransmilenioData } from "@/lib/transmilenio"

/**
 * FIXTURES SINTÉTICAS para pruebas de regresión del issue #31.
 *
 * ESTOS DATOS NO SON UN CATÁLOGO OFICIAL. Son estaciones y servicios
 * inventados, con paradas atendidas verificadas por una «fuente de prueba»,
 * para ejercitar el planificador con evidencia válida sin depender de que
 * exista una matriz oficial de paradas. No deben copiarse a `data/` ni
 * presentarse como información real de TransMilenio.
 *
 * El nombre de la fuente deja claro su carácter: `fuente-de-prueba`.
 */
export const FUENTE_PRUEBA = "fuente-de-prueba (fixture sintética, no oficial)"
const FECHA_PRUEBA = "2026-11-04"

const estacion = (id: string, name: string, lat: number, lng: number): Station => ({ id, name, lat, lng })

/** Red lineal de prueba: A — B — C — D — E, de sur a norte. */
export const ESTACIONES_SINTETICAS: Station[] = [
  estacion("s-a", "Alfa", 4.60, -74.08),
  estacion("s-b", "Bravo", 4.62, -74.08),
  estacion("s-c", "Charlie", 4.64, -74.08),
  estacion("s-d", "Delta", 4.66, -74.08),
  estacion("s-e", "Eco", 4.68, -74.08),
]

const PATH: [number, number][] = ESTACIONES_SINTETICAS.map((s) => [s.lat, s.lng])

const HORARIO = { weekday: "5:00 a. m. - 11:00 p. m.", saturday: "6:00 a. m. - 10:00 p. m.", holiday: "" }

/**
 * Servicio normal con paradas atendidas verificadas y operativas en todas sus
 * estaciones, de Alfa a Eco.
 */
const SERVICIO_VERIFICADO: BusRoute = {
  id: "V1",
  code: "V1",
  label: "Alfa hacia Eco",
  from: "Alfa",
  to: "Eco",
  stops: ["Alfa", "Bravo", "Charlie", "Delta", "Eco"],
  servedStops: ["Alfa", "Bravo", "Charlie", "Delta", "Eco"].map((name, order) => ({
    name,
    order,
    canBoard: true,
    canAlight: true,
    source: FUENTE_PRUEBA,
    date: FECHA_PRUEBA,
    status: "operativa" as const,
  })),
  directionEvidence: { agreement: "consistente", verified: true, note: "Sentido confirmado por fixture de prueba." },
  path: PATH,
  schedule: HORARIO,
}

/**
 * EXPRESO que PASA SIN PARAR por Bravo y Delta: su recorrido las toca, pero sus
 * paradas atendidas son solo Alfa, Charlie y Eco. Sirve para comprobar que el
 * planificador no ofrece abordar en una estación por la que el bus solo pasa.
 */
const SERVICIO_EXPRESO: BusRoute = {
  id: "X1",
  code: "X1",
  label: "Alfa hacia Eco (expreso)",
  from: "Alfa",
  to: "Eco",
  stops: ["Alfa", "Bravo", "Charlie", "Delta", "Eco"],
  servedStops: [
    { name: "Alfa", order: 0, canBoard: true, canAlight: true, source: FUENTE_PRUEBA, date: FECHA_PRUEBA, status: "operativa" as const },
    { name: "Charlie", order: 1, canBoard: true, canAlight: true, source: FUENTE_PRUEBA, date: FECHA_PRUEBA, status: "operativa" as const },
    { name: "Eco", order: 2, canBoard: true, canAlight: true, source: FUENTE_PRUEBA, date: FECHA_PRUEBA, status: "operativa" as const },
  ],
  directionEvidence: { agreement: "consistente", verified: true, note: "Expreso de prueba." },
  path: PATH,
  schedule: HORARIO,
}

/**
 * Servicio con paradas cercanas al trazado pero SIN paradas verificadas
 * (`servedStops` vacío): reproduce el estado real del catálogo actual, donde la
 * geometría no debe convertirse en abordaje.
 */
const SERVICIO_SIN_VERIFICAR: BusRoute = {
  id: "H0",
  code: "H0",
  label: "Alfa hacia Eco (sin verificar)",
  from: "Alfa",
  to: "Eco",
  stops: ["Alfa", "Bravo", "Charlie", "Delta", "Eco"],
  servedStops: [],
  directionEvidence: { agreement: "indeterminado", verified: false, note: "Sin fuente de paradas." },
  path: PATH,
  schedule: HORARIO,
}

/** Datos sintéticos con un único servicio verificado directo (Alfa→Eco). */
export function datosVerificadosDirecto(): TransmilenioData {
  return {
    stations: ESTACIONES_SINTETICAS,
    routes: [SERVICIO_VERIFICADO],
    fetchedAt: FECHA_PRUEBA + "T00:00:00Z",
    source: "snapshot",
  }
}

/** Datos sintéticos con el expreso que pasa sin parar por Bravo y Delta. */
export function datosExpreso(): TransmilenioData {
  return {
    stations: ESTACIONES_SINTETICAS,
    routes: [SERVICIO_EXPRESO],
    fetchedAt: FECHA_PRUEBA + "T00:00:00Z",
    source: "snapshot",
  }
}

/** Datos sintéticos sin paradas verificadas (estado del catálogo real hoy). */
export function datosSinVerificar(): TransmilenioData {
  return {
    stations: ESTACIONES_SINTETICAS,
    routes: [SERVICIO_SIN_VERIFICAR],
    fetchedAt: FECHA_PRUEBA + "T00:00:00Z",
    source: "snapshot",
  }
}

/**
 * Dos servicios que comparten la estación Charlie como transbordo verificado:
 * P1 va Alfa→Charlie (y sigue a un ramal R1/R2) y Q1 va Charlie→Eco. Permite
 * comprobar un transbordo con evidencia válida sin ruta directa.
 */
export function datosTransbordoVerificado(): TransmilenioData {
  const ramalP: BusRoute = {
    id: "P1",
    code: "P1",
    label: "Alfa hacia Delta",
    from: "Alfa",
    to: "Delta",
    stops: ["Alfa", "Bravo", "Charlie", "Delta"],
    servedStops: [
      { name: "Alfa", order: 0, canBoard: true, canAlight: true, source: FUENTE_PRUEBA, date: FECHA_PRUEBA, status: "operativa" as const },
      { name: "Bravo", order: 1, canBoard: true, canAlight: true, source: FUENTE_PRUEBA, date: FECHA_PRUEBA, status: "operativa" as const },
      { name: "Charlie", order: 2, canBoard: true, canAlight: true, source: FUENTE_PRUEBA, date: FECHA_PRUEBA, status: "operativa" as const },
      { name: "Delta", order: 3, canBoard: true, canAlight: true, source: FUENTE_PRUEBA, date: FECHA_PRUEBA, status: "operativa" as const },
    ],
    directionEvidence: { agreement: "consistente", verified: true, note: "Ramal P de prueba." },
    path: PATH.slice(0, 4),
    schedule: HORARIO,
  }
  const ramalQ: BusRoute = {
    id: "Q1",
    code: "Q1",
    label: "Charlie hacia Eco",
    from: "Charlie",
    to: "Eco",
    stops: ["Charlie", "Delta", "Eco"],
    servedStops: [
      { name: "Charlie", order: 0, canBoard: true, canAlight: true, source: FUENTE_PRUEBA, date: FECHA_PRUEBA, status: "operativa" as const },
      { name: "Delta", order: 1, canBoard: true, canAlight: true, source: FUENTE_PRUEBA, date: FECHA_PRUEBA, status: "operativa" as const },
      { name: "Eco", order: 2, canBoard: true, canAlight: true, source: FUENTE_PRUEBA, date: FECHA_PRUEBA, status: "operativa" as const },
    ],
    directionEvidence: { agreement: "consistente", verified: true, note: "Ramal Q de prueba." },
    path: PATH.slice(2),
    schedule: HORARIO,
  }
  return {
    stations: ESTACIONES_SINTETICAS,
    routes: [ramalP, ramalQ],
    fetchedAt: FECHA_PRUEBA + "T00:00:00Z",
    source: "snapshot",
  }
}
