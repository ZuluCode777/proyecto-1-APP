import { z } from "zod"
import { RESPUESTA_METRO } from "@/lib/contrato-metro"
import { estadoCalendarioEnFecha, paradasPrescriptibles, sentidoConfirmado } from "@/lib/evidencia"
import { pathBetween, spokenDistance } from "@/lib/geo"
import {
  MAX_ESTACIONES_CERCANAS,
  MAX_PLANES_VIAJE,
  alternativasDelViaje,
  listarLugares,
  lugarPorNombre,
  nearestStations,
  planTrip,
  planTripCandidato,
  routesAlongBoth,
  samePlace,
  searchRoutes,
  type BusRoute,
  type TransmilenioData,
  type TripLeg,
} from "@/lib/routes"
import { normalize } from "@/lib/text"
import { catalogoAntiguo, procedenciaCatalogo } from "@/lib/transmilenio"
import { cardinalHacia, orientarHacia, ubicacionVigente, type LecturaRumbo, type LecturaUbicacion } from "@/lib/ubicacion"

export { RespuestaMetroSchema } from "@/lib/contrato-metro"

/**
 * Contrato de `POST /api/planificador` (EA-25, #51): buscar rutas, ver el detalle
 * de una ruta, listar lugares, planear un viaje entre dos lugares ELEGIDOS, y la
 * paridad con la web: el Metro de la Línea 1 (`metro-linea-1`, `lib/contrato-metro.ts`)
 * y las estaciones cercanas a una coordenada (`estaciones-cercanas`).
 *
 * Es la entrada ESTRUCTURADA del planificador compartido para el cliente de
 * iPhone: el origen y el destino llegan como nombres exactos de `listar-lugares`,
 * nunca como una frase que haya que interpretar, y el servidor decide todo con
 * las mismas funciones que usa la web (`searchRoutes`, `planTrip`,
 * `planTripCandidato`, `routesAlongBoth`, `paradasPrescriptibles`). El cliente
 * no recalcula nada: pinta los estados que el servidor devuelve. Las respuestas
 * llevan las coordenadas que el catálogo tiene y nada más; sin coordenada, el
 * campo es `null` y el mapa no inventa un punto.
 */

/** Cotas de la petición: el cliente de iPhone las repite (`EntradaPlanificador.swift`) y una prueba las compara. */
export const MAX_CONSULTA = 80
export const MAX_CODIGO = 12
export const MAX_LUGAR = 80
/** Cuerpo máximo de la petición, en bytes. */
export const MAXIMO_BYTES_CUERPO = 1_000
/** Rutas que devuelve una búsqueda; `total` dice cuántas había. */
export const MAX_RUTAS = 50
/** Cotas de las respuestas: el cliente de iPhone rechaza lo que las pase (`RespuestaPlanificador.swift`) y una prueba las compara. */
export const MAX_ESTACIONES = 200
export const MAX_PUNTOS_TRAZADO = 1_000
export const MAX_LUGARES = 500
/** Alternativas de un viaje operativo: los planes que se piden menos el mejor. */
export const MAX_ALTERNATIVAS = MAX_PLANES_VIAJE - 1
/** Cotas de la petición `estaciones-cercanas`: radio de precisión y edad de las lecturas, en metros y milisegundos. */
export const MAX_PRECISION_M = 100_000
export const MAX_EDAD_LECTURA_MS = 600_000

/**
 * Peticiones por minuto, con clave propia de cada tipo (no comparten cuota con `/api/agent`). `claveCliente()` es hoy una
 * sola clave para todos, así que son un techo GLOBAL. Planear recorre pares de rutas (`planTrip`, `planTripCandidato`,
 * `routesAlongBoth`): unos 60 ms de CPU síncrona por petición (45,6 de promedio y 70,3 de pico medidos en la revisión),
 * que detienen el bucle de eventos compartido con `/api/agent` y la web; las otras tres operaciones cuestan menos de 1 ms.
 * 30 planes por minuto son unos 1,8 s de CPU por minuto (~3 % del bucle) y dejan margen a varias personas que planean a
 * la vez en la feria.
 */
export const LIMITE_PLANEAR = 30
export const LIMITE_CONSULTA = 60
export const VENTANA_LIMITE_MS = 60_000

export const PeticionPlanificadorSchema = z.discriminatedUnion("operacion", [
  z.strictObject({ operacion: z.literal("buscar-rutas"), consulta: z.string().trim().min(1).max(MAX_CONSULTA) }),
  z.strictObject({ operacion: z.literal("detalle-ruta"), codigo: z.string().trim().min(1).max(MAX_CODIGO) }),
  z.strictObject({ operacion: z.literal("listar-lugares") }),
  z.strictObject({
    operacion: z.literal("planear-viaje"),
    origen: z.string().trim().min(1).max(MAX_LUGAR),
    destino: z.string().trim().min(1).max(MAX_LUGAR),
  }),
  z.strictObject({ operacion: z.literal("metro-linea-1") }),
  /**
   * La lectura de posición del dispositivo: solo `lat` y `lng` son obligatorios. Sin `precision` (metros, el radio de
   * confianza) la respuesta es solo cardinal y nunca un giro; sin `edadMs` (cuánto hace que se capturó) la lectura se
   * toma como recién capturada. `rumbo` es el de la brújula respecto al norte, sin él nunca hay un giro: `calidad` es la
   * cota de error en grados (negativa o ausente, no fiable) y `edadMs` cuánto hace que se midió.
   */
  z.strictObject({
    operacion: z.literal("estaciones-cercanas"),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    precision: z.number().min(0).max(MAX_PRECISION_M).optional(),
    edadMs: z.number().int().min(0).max(MAX_EDAD_LECTURA_MS).optional(),
    rumbo: z
      .strictObject({
        grados: z.number().min(0).max(360),
        calidad: z.number().min(-1).max(360).optional(),
        edadMs: z.number().int().min(0).max(MAX_EDAD_LECTURA_MS),
      })
      .optional(),
  }),
])
export type PeticionPlanificador = z.infer<typeof PeticionPlanificadorSchema>

const CoordenadaSchema = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })
type Coordenada = z.infer<typeof CoordenadaSchema>

/** Fuente y antigüedad del catálogo con que se respondió, como en `AgentReply.catalogo`. */
const CatalogoSchema = z.object({ procedencia: z.string(), antiguo: z.boolean() })
const ResumenRutaSchema = z.object({ codigo: z.string(), desde: z.string(), hacia: z.string() })
const ParadaSchema = z.object({ nombre: z.string(), coordenada: CoordenadaSchema.nullable() })

export const RespuestaBuscarRutasSchema = z.object({
  rutas: z.array(ResumenRutaSchema).max(MAX_RUTAS),
  total: z.number().int().nonnegative(),
  catalogo: CatalogoSchema,
})

export const RespuestaDetalleRutaSchema = z.object({
  codigo: z.string(),
  etiqueta: z.string(),
  desde: z.string(),
  hacia: z.string(),
  /** `confirmado` solo con una fuente vigente (`sentidoConfirmado`); si no, el cliente no afirma el sentido. */
  sentido: z.enum(["confirmado", "contradictorio", "sin-confirmar"]),
  /** Estado del calendario verificado de HOY (`estadoCalendarioEnFecha`); «sin-verificar» no es «sin servicio». */
  calendario: z.enum(["opera", "no-opera", "sin-verificar"]),
  /** Horario publicado por TransMilenio; vacío si no lo publica. No es un calendario verificado. */
  horario: z.object({ entreSemana: z.string(), sabado: z.string(), festivo: z.string() }),
  /** Estaciones CERCANAS AL TRAZADO, en orden. `paradaVerificada` solo si el validador compartido la acepta. */
  estaciones: z
    .array(z.object({ nombre: z.string(), coordenada: CoordenadaSchema.nullable(), paradaVerificada: z.boolean() }))
    .max(MAX_ESTACIONES),
  trazado: z.array(CoordenadaSchema).max(MAX_PUNTOS_TRAZADO),
  catalogo: CatalogoSchema,
})

export const RespuestaLugaresSchema = z.object({ lugares: z.array(z.string()).max(MAX_LUGARES), catalogo: CatalogoSchema })

const TramoSchema = z.object({
  codigoRuta: z.string(),
  abordaje: ParadaSchema,
  descenso: ParadaSchema,
  estacionesRecorridas: z.number().int().nonnegative(),
  /** Solo si es `true` puede decirse el número exacto de estaciones. */
  conteoVerificado: z.boolean(),
  /** Tramo del trazado entre abordaje y descenso; vacío si falta la coordenada de alguno. */
  trazado: z.array(CoordenadaSchema).max(MAX_PUNTOS_TRAZADO),
})

/**
 * Tramo de un servicio CANDIDATO: solo el código de la ruta. Sin paradas, sin conteo y sin trazado, porque con la
 * operación sin confirmar eso serían órdenes de subir o bajar (`tripCandidatoReply` en `lib/local-agent.ts` y
 * `planTripCandidato` en `lib/routes.ts` no las dan). `strictObject`: una parada de más no pasa el esquema.
 */
const TramoCandidatoSchema = z.strictObject({ codigoRuta: z.string() })

/**
 * Otra ruta directa que también sirve al viaje: solo el código, como la web («También te sirven…»), porque la
 * otra ruta puede abordarse en otra estación del mismo lugar y su parada no se garantiza aquí.
 */
const AlternativaSchema = z.strictObject({ codigoRuta: z.string() })

const BaseViaje = { origen: z.string(), destino: z.string(), catalogo: CatalogoSchema }
const SinRutas = z.array(ResumenRutaSchema).max(0)

/**
 * `operativo`: paradas y sentido verificados y la hora actual dentro de la franja (`planTrip`); trae tramos completos.
 * `candidato`: paradas y sentido verificados, operación sin confirmar ahora (`planTripCandidato`); trae SOLO los códigos
 * de las rutas, sin paradas ni mapa.
 * `recorrido`: sin paradas verificadas; rutas cuyo trazado pasa cerca de los dos lugares (`routesAlongBoth`).
 * `sin-recorrido`: ninguna ruta del trazado conecta los dos lugares. `mismo-lugar`: origen y destino coinciden.
 * Solo `recorrido` trae `rutasPorElTrazado`; los demás estados las traen vacías.
 *
 * `alternativas` es OPCIONAL y solo existe en un `operativo` directo (un tramo) cuando hay otras rutas directas: las
 * mismas que la web dice con «También te sirven…», de menos a más estaciones. Ausente en el resto. Un cliente que no
 * la conoce decodifica la respuesta igual que antes.
 */
export const RespuestaViajeSchema = z.discriminatedUnion("resultado", [
  z.object({
    ...BaseViaje,
    resultado: z.literal("operativo"),
    tramos: z.array(TramoSchema).min(1).max(2),
    rutasPorElTrazado: SinRutas,
    alternativas: z.array(AlternativaSchema).min(1).max(MAX_ALTERNATIVAS).optional(),
  }),
  z.object({ ...BaseViaje, resultado: z.literal("candidato"), tramos: z.array(TramoCandidatoSchema).min(1).max(2), rutasPorElTrazado: SinRutas }),
  z.object({ ...BaseViaje, resultado: z.literal("recorrido"), tramos: z.tuple([]), rutasPorElTrazado: z.array(ResumenRutaSchema).min(1).max(MAX_RUTAS) }),
  z.object({ ...BaseViaje, resultado: z.literal("sin-recorrido"), tramos: z.tuple([]), rutasPorElTrazado: SinRutas }),
  z.object({ ...BaseViaje, resultado: z.literal("mismo-lugar"), tramos: z.tuple([]), rutasPorElTrazado: SinRutas }),
])

const ModoOrientacionSchema = z.enum(["relativa", "cardinal-brujula", "cardinal-precision", "sin-direccion"])

const EstacionCercanaSchema = z.object({
  nombre: z.string(),
  coordenada: CoordenadaSchema,
  distanciaMetros: z.number().int().nonnegative(),
  /** La distancia como la dice el GPS auditivo de la web («300 metros», «1,2 kilómetros»). */
  distanciaHablada: z.string(),
  orientacion: z.object({
    modo: ModoOrientacionSchema,
    /** Referencia cardinal estimada («al noreste»); `null` si la estación cae dentro del margen de error de la lectura. */
    cardinal: z.string().nullable(),
    /** Giro respecto a hacia dónde mira la persona; solo con el modo `relativa`. */
    relativa: z.string().nullable(),
    /** La frase que la web dice al orientar hacia la estación. */
    indicacion: z.string(),
  }),
})

/**
 * `cercanas`: hasta 4 estaciones de TransMilenio, de más cerca a más lejos. `ubicacion-vencida`: la lectura tiene más
 * de 60 s (`EDAD_MAXIMA_POSICION_MS`) y no se usa, como en la web: sin estaciones. La respuesta no repite la
 * coordenada, la precisión ni el rumbo recibidos.
 */
export const RespuestaEstacionesCercanasSchema = z.discriminatedUnion("resultado", [
  z.object({ resultado: z.literal("cercanas"), estaciones: z.array(EstacionCercanaSchema).max(MAX_ESTACIONES_CERCANAS), catalogo: CatalogoSchema }),
  z.object({ resultado: z.literal("ubicacion-vencida"), estaciones: z.tuple([]), catalogo: CatalogoSchema }),
])

export type Resolucion =
  | { estado: 200; cuerpo: unknown }
  | { estado: 404; cuerpo: { error: "no-encontrado" } }

const NO_ENCONTRADO: Resolucion = { estado: 404, cuerpo: { error: "no-encontrado" } }

/** El Metro es un catálogo aparte (EA-13): su respuesta no depende del de TransMilenio ni de la hora. */
export const RESOLUCION_METRO: Resolucion = { estado: 200, cuerpo: RESPUESTA_METRO }

const resumen = (route: BusRoute) => ({ codigo: route.code, desde: route.from, hacia: route.to })

/** Código de ruta comparable: sin espacios ni mayúsculas, como el índice de `lib/routes.ts`. */
const claveCodigo = (codigo: string) => normalize(codigo).replace(/\s/g, "")

function coordenadaDeEstacion(nombre: string, data: TransmilenioData): Coordenada | null {
  const estacion = data.stations.find((s) => s.name === nombre)
  return estacion ? { lat: estacion.lat, lng: estacion.lng } : null
}

const coordenadas = (path: [number, number][]): Coordenada[] => path.map(([lat, lng]) => ({ lat, lng }))

function tramoDeViaje(leg: TripLeg, data: TransmilenioData) {
  const abordaje = data.stations.find((s) => s.name === leg.board)
  const descenso = data.stations.find((s) => s.name === leg.alight)
  return {
    codigoRuta: leg.route.code,
    abordaje: { nombre: leg.board, coordenada: coordenadaDeEstacion(leg.board, data) },
    descenso: { nombre: leg.alight, coordenada: coordenadaDeEstacion(leg.alight, data) },
    estacionesRecorridas: leg.stationsRidden,
    conteoVerificado: leg.conteoVerificado,
    trazado: abordaje && descenso ? coordenadas(pathBetween(leg.route.path, abordaje, descenso)) : [],
  }
}

/**
 * Resuelve una petición ya validada contra el catálogo y la hora dados. Función
 * pura (sin red ni reloj propio) para probar cada estado con datos sintéticos.
 */
export function resolverPeticion(peticion: PeticionPlanificador, data: TransmilenioData, ahora: Date): Resolucion {
  const catalogo = { procedencia: procedenciaCatalogo(data), antiguo: catalogoAntiguo(data, ahora) }

  switch (peticion.operacion) {
    case "buscar-rutas": {
      const encontradas = searchRoutes(peticion.consulta, data)
      return { estado: 200, cuerpo: { rutas: encontradas.slice(0, MAX_RUTAS).map(resumen), total: encontradas.length, catalogo } }
    }

    case "detalle-ruta": {
      const clave = claveCodigo(peticion.codigo)
      const ruta = data.routes.find((r) => claveCodigo(r.code) === clave)
      if (!ruta) return NO_ENCONTRADO
      const verificadas = new Set(paradasPrescriptibles(ruta, ahora).map((s) => s.name))
      return {
        estado: 200,
        cuerpo: {
          codigo: ruta.code,
          etiqueta: ruta.label,
          desde: ruta.from,
          hacia: ruta.to,
          sentido: sentidoConfirmado(ruta)
            ? "confirmado"
            : ruta.directionEvidence.agreement === "contradictorio"
              ? "contradictorio"
              : "sin-confirmar",
          calendario: estadoCalendarioEnFecha(ruta.verifiedCalendar, ahora),
          horario: { entreSemana: ruta.schedule.weekday, sabado: ruta.schedule.saturday, festivo: ruta.schedule.holiday },
          estaciones: ruta.stops.map((nombre) => ({
            nombre,
            coordenada: coordenadaDeEstacion(nombre, data),
            paradaVerificada: verificadas.has(nombre),
          })),
          trazado: coordenadas(ruta.path),
          catalogo,
        },
      }
    }

    case "listar-lugares":
      return { estado: 200, cuerpo: { lugares: listarLugares(data).map((lugar) => lugar.name), catalogo } }

    case "planear-viaje": {
      const origen = lugarPorNombre(peticion.origen, data)
      const destino = lugarPorNombre(peticion.destino, data)
      if (!origen || !destino) return NO_ENCONTRADO
      const base = { origen: origen.name, destino: destino.name, catalogo }
      const sinTramos = { tramos: [], rutasPorElTrazado: [] }

      if (samePlace(origen, destino)) return { estado: 200, cuerpo: { ...base, resultado: "mismo-lugar", ...sinTramos } }

      // Mismo orden que el asistente: viaje operativo, candidato sin operación confirmada, y por último el recorrido.
      // Los mismos planes que pide la web: el primero es el viaje y los demás, sus alternativas.
      const planes = planTrip({ origin: origen, destination: destino }, data, MAX_PLANES_VIAJE, ahora)
      const [operativo] = planes
      if (operativo) {
        const alternativas = alternativasDelViaje(planes).map((codigoRuta) => ({ codigoRuta }))
        return {
          estado: 200,
          cuerpo: {
            ...base,
            resultado: "operativo",
            tramos: operativo.map((l) => tramoDeViaje(l, data)),
            rutasPorElTrazado: [],
            ...(alternativas.length > 0 ? { alternativas } : {}),
          },
        }
      }
      const [candidato] = planTripCandidato({ origin: origen, destination: destino }, data, 1, ahora)
      if (candidato) {
        // Solo los códigos: con la operación sin confirmar, las paradas, el conteo y el trazado serían órdenes de abordaje.
        return { estado: 200, cuerpo: { ...base, resultado: "candidato", tramos: candidato.map((l) => ({ codigoRuta: l.route.code })), rutasPorElTrazado: [] } }
      }
      const porElTrazado = routesAlongBoth(origen, destino, data).map(resumen)
      return {
        estado: 200,
        cuerpo: { ...base, resultado: porElTrazado.length > 0 ? "recorrido" : "sin-recorrido", tramos: [], rutasPorElTrazado: porElTrazado },
      }
    }

    case "metro-linea-1":
      return RESOLUCION_METRO

    case "estaciones-cercanas": {
      // La coordenada solo vive en esta función: se usa para ordenar y orientar y no se guarda, se registra ni se devuelve.
      const instante = ahora.getTime()
      const lectura: LecturaUbicacion = { lat: peticion.lat, lng: peticion.lng, precision: peticion.precision ?? null, hora: instante - (peticion.edadMs ?? 0) }
      // Como la web: una lectura de más de 60 s no se usa.
      if (!ubicacionVigente(lectura, instante)) return { estado: 200, cuerpo: { resultado: "ubicacion-vencida", estaciones: [], catalogo } }
      // La brújula del iPhone mide respecto al norte, nunca relativa a un arranque arbitrario.
      const rumbo: LecturaRumbo | null = peticion.rumbo
        ? { grados: peticion.rumbo.grados, referencia: "absoluta", calidad: peticion.rumbo.calidad ?? null, hora: instante - peticion.rumbo.edadMs }
        : null
      const estaciones = nearestStations(lectura, data, MAX_ESTACIONES_CERCANAS).map((estacion) => ({
        nombre: estacion.name,
        coordenada: { lat: estacion.lat, lng: estacion.lng },
        distanciaMetros: Math.round(estacion.distance),
        distanciaHablada: spokenDistance(estacion.distance),
        orientacion: { ...orientarHacia(estacion, lectura, rumbo, instante), cardinal: cardinalHacia(lectura, estacion) },
      }))
      return { estado: 200, cuerpo: { resultado: "cercanas", estaciones, catalogo } }
    }
  }
}
