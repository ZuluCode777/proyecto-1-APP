import { z } from "zod"
import { estadoCalendarioEnFecha, paradasPrescriptibles, sentidoConfirmado } from "@/lib/evidencia"
import { pathBetween } from "@/lib/geo"
import {
  listarLugares,
  lugarPorNombre,
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

/**
 * Contrato de `POST /api/planificador` (EA-25, #51): buscar rutas, ver el detalle
 * de una ruta, listar lugares y planear un viaje entre dos lugares ELEGIDOS.
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

export const PeticionPlanificadorSchema = z.discriminatedUnion("operacion", [
  z.strictObject({ operacion: z.literal("buscar-rutas"), consulta: z.string().trim().min(1).max(MAX_CONSULTA) }),
  z.strictObject({ operacion: z.literal("detalle-ruta"), codigo: z.string().trim().min(1).max(MAX_CODIGO) }),
  z.strictObject({ operacion: z.literal("listar-lugares") }),
  z.strictObject({
    operacion: z.literal("planear-viaje"),
    origen: z.string().trim().min(1).max(MAX_LUGAR),
    destino: z.string().trim().min(1).max(MAX_LUGAR),
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
  estaciones: z.array(z.object({ nombre: z.string(), coordenada: CoordenadaSchema.nullable(), paradaVerificada: z.boolean() })),
  trazado: z.array(CoordenadaSchema),
  catalogo: CatalogoSchema,
})

export const RespuestaLugaresSchema = z.object({ lugares: z.array(z.string()), catalogo: CatalogoSchema })

const TramoSchema = z.object({
  codigoRuta: z.string(),
  abordaje: ParadaSchema,
  descenso: ParadaSchema,
  estacionesRecorridas: z.number().int().nonnegative(),
  /** Solo si es `true` puede decirse el número exacto de estaciones. */
  conteoVerificado: z.boolean(),
  /** Tramo del trazado entre abordaje y descenso; vacío si falta la coordenada de alguno. */
  trazado: z.array(CoordenadaSchema),
})

/**
 * `operativo`: paradas y sentido verificados y la hora actual dentro de la franja (`planTrip`).
 * `candidato`: paradas y sentido verificados, operación sin confirmar ahora (`planTripCandidato`).
 * `recorrido`: sin paradas verificadas; rutas cuyo trazado pasa cerca de los dos lugares (`routesAlongBoth`).
 * `sin-recorrido`: ninguna ruta del trazado conecta los dos lugares. `mismo-lugar`: origen y destino coinciden.
 * Solo `operativo` y `candidato` traen tramos; solo `recorrido` trae `rutasPorElTrazado`.
 */
export const RespuestaViajeSchema = z.object({
  origen: z.string(),
  destino: z.string(),
  resultado: z.enum(["operativo", "candidato", "recorrido", "sin-recorrido", "mismo-lugar"]),
  tramos: z.array(TramoSchema).max(2),
  rutasPorElTrazado: z.array(ResumenRutaSchema),
  catalogo: CatalogoSchema,
})

export type Resolucion =
  | { estado: 200; cuerpo: unknown }
  | { estado: 404; cuerpo: { error: "no-encontrado" } }

const NO_ENCONTRADO: Resolucion = { estado: 404, cuerpo: { error: "no-encontrado" } }

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
      const [operativo] = planTrip({ origin: origen, destination: destino }, data, 1, ahora)
      if (operativo) {
        return { estado: 200, cuerpo: { ...base, resultado: "operativo", tramos: operativo.map((l) => tramoDeViaje(l, data)), rutasPorElTrazado: [] } }
      }
      const [candidato] = planTripCandidato({ origin: origen, destination: destino }, data, 1, ahora)
      if (candidato) {
        return { estado: 200, cuerpo: { ...base, resultado: "candidato", tramos: candidato.map((l) => tramoDeViaje(l, data)), rutasPorElTrazado: [] } }
      }
      const porElTrazado = routesAlongBoth(origen, destino, data).map(resumen)
      return {
        estado: 200,
        cuerpo: { ...base, resultado: porElTrazado.length > 0 ? "recorrido" : "sin-recorrido", tramos: [], rutasPorElTrazado: porElTrazado },
      }
    }
  }
}
