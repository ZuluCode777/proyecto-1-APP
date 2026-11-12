import { puntuar, type Esperado, type Item, type Medicion } from "./ea27-evaluacion"
import { runIntent, type Intent } from "./local-agent"
import type { TransmilenioData } from "./routes"

/**
 * Evaluación de EA-27 (#53) contra la app desplegada: `POST /api/agent`. La
 * respuesta no trae la intención, solo `reply`, `action`, `steps`, `engine` y los
 * datos de la acción. Aquí se reconstruye la intención que la produjo, sin red,
 * para poder puntuarla con las mismas reglas que a los otros motores. Lo que no
 * se puede reconstruir se cuenta como fallo y se lista.
 */

/** Consulta del Metro de una intención. Se saca del tipo y no de `./metro`: solo el agente puede importar el catálogo. */
type ConsultaMetro = Extract<Intent, { type: "metro" }>["consulta"]

/** Respuesta de `POST /api/agent` (`AgentReply`), solo lo que se lee. */
export type RespuestaAgente = {
  reply: string
  action: string
  engine: string
  steps: { label: string; detail?: string }[]
  station?: string
  routeCode?: string
}

const ETIQUETA_DESTINO = "Busqué la estación de destino"
const ETIQUETA_ORIGEN = "Busqué la estación de origen"
const ETIQUETA_METRO = "Consulté el catálogo del Metro de Bogotá"
/** Consulta que nunca coincide con una de la referencia. */
const METRO_DISTINTO: ConsultaMetro = { tipo: "estacion_inexistente", numero: 0 }

/** Las respuestas de texto fijo, para reconocerlas por igualdad exacta con lo que da `runIntent`. */
const FIJAS: Intent[] = [
  { type: "greeting" },
  { type: "help" },
  { type: "cancel" },
  { type: "unsupported", topic: "tarifas" },
  { type: "unsupported", topic: "tiempo_real" },
  { type: "unknown" },
]

/** La consulta del Metro que describe la referencia, para comparar su texto con el recibido. */
function consultaEsperada(e: Esperado): ConsultaMetro {
  switch (e.tipo) {
    case "estacion":
      return e.clave ? { tipo: "estacion", clave: e.clave } : METRO_DISTINTO
    case "estacion_ambigua":
      return e.claves ? { tipo: "estacion_ambigua", claves: e.claves } : METRO_DISTINTO
    case "linea":
      return e.linea === 1 || e.linea === 2 ? { tipo: "linea", linea: e.linea } : METRO_DISTINTO
    case "servicio":
      return e.tema === "viaje" || e.tema === "tarifa" || e.tema === "horario" || e.tema === "tiempo_real"
        ? { tipo: "servicio", tema: e.tema }
        : METRO_DISTINTO
    case "listado":
      return { tipo: "listado" }
    case "general":
      return { tipo: "general" }
    default:
      return METRO_DISTINTO
  }
}

/**
 * Intención que produjo una respuesta, o `null` si no se reconoce.
 *
 * - Texto fijo (saludo, ayuda, cancelar, tarifas, tiempo real, «No te entendí»):
 *   igualdad exacta con lo que da `runIntent`.
 * - Metro: el texto debe ser el de la consulta que describe la referencia. Es la
 *   única comparación que mira la referencia; si no coincide, se devuelve una
 *   consulta distinta.
 * - Viaje: los pasos dicen el destino y el origen que resolvió la app («Busqué la
 *   estación de destino»); si el origen o el destino no existen, están en el texto.
 * - Ruta: `action: "route"`; es información si el texto empieza «La X va de», si no, horario.
 */
export function observarRespuesta(r: RespuestaAgente, esperado: Esperado, data: TransmilenioData): Intent | null {
  for (const intent of FIJAS) if (runIntent(intent, { data }).reply === r.reply) return intent

  if (r.steps.some((s) => s.label === ETIQUETA_METRO)) {
    const consulta = consultaEsperada(esperado)
    const coincide = esperado.intent === "metro" && runIntent({ type: "metro", consulta }, { data }).reply === r.reply
    return { type: "metro", consulta: coincide ? consulta : METRO_DISTINTO }
  }

  const sinDestino = /^Entendí que sales de (.+)\. ¿A qué estación quieres ir\?$/.exec(r.reply)
  if (sinDestino) return { type: "trip_missing_destination", origin: sinDestino[1] }

  const destino = r.steps.find((s) => s.label === ETIQUETA_DESTINO)?.detail
  if (destino) {
    const origen =
      r.steps.find((s) => s.label === ETIQUETA_ORIGEN)?.detail ?? /^No encontré la estación de origen (.+?)\. Dime otro nombre/.exec(r.reply)?.[1]
    return { type: "trip", origin: origen, destination: destino }
  }
  const noEncontrada = /^No encontré la estación (.+?)\. Prueba con otro nombre/.exec(r.reply)
  if (noEncontrada) return { type: "trip", destination: noEncontrada[1] }

  if (r.action === "route" && r.routeCode) {
    return { type: r.reply.startsWith(`La ${r.routeCode} va de`) ? "route_info" : "schedule", routeCode: r.routeCode }
  }
  if (r.action === "frequent") return { type: "frequent" }
  if (r.action === "gps") return { type: "gps" }
  return null
}

// ── Ritmo y reintentos ──

/** Espacio mínimo entre peticiones: 3,5 s son 17 por minuto, bajo el límite de 20 de la ruta. */
export const ESPERA_ENTRE_PETICIONES_MS = 3_500
/** Espera por defecto tras un 429 sin `Retry-After`. */
const ESPERA_429_MS = 20_000
const MAX_REINTENTOS_429 = 5
/** Cada cuántas frases se vuelve a comprobar que el modelo sigue alcanzable. */
const COMPROBAR_CADA = 20

export type ResultadoPeticion = { estado: number; retryAfter: string | null; cuerpo: unknown; ms: number }
export type Peticion = (frase: string) => Promise<ResultadoPeticion>

export type MedicionRender = Medicion & { engine?: string; accion?: string; observado?: Intent | null; estado?: number; reintentos429: number }

const esRespuesta = (c: unknown): c is RespuestaAgente =>
  typeof c === "object" && c !== null && typeof (c as RespuestaAgente).reply === "string" && Array.isArray((c as RespuestaAgente).steps)

/** Espera de un `Retry-After` en segundos; si no es un número válido, la de por defecto. */
export function esperaTras429(retryAfter: string | null): number {
  const s = Number(retryAfter)
  return retryAfter && Number.isFinite(s) && s > 0 ? Math.min(s, 120) * 1000 : ESPERA_429_MS
}

/**
 * Recorre el corpus de uno en uno, con `ESPERA_ENTRE_PETICIONES_MS` entre
 * peticiones y espera creciente tras un 429. `motorListo` se comprueba cada
 * `COMPROBAR_CADA` frases; si el modelo deja de estar alcanzable, lanza y la
 * corrida se detiene sin puntuar lo que falta. `ms` es el de la petición que
 * respondió, sin las esperas.
 */
export async function recorrerCorpus(opciones: {
  items: Item[]
  data: TransmilenioData
  peticion: Peticion
  dormir: (ms: number) => Promise<void>
  motorListo: () => Promise<boolean>
}): Promise<MedicionRender[]> {
  const { items, data, peticion, dormir, motorListo } = opciones
  const mediciones: MedicionRender[] = []
  for (const [i, item] of items.entries()) {
    if (i > 0) await dormir(ESPERA_ENTRE_PETICIONES_MS)
    if (i % COMPROBAR_CADA === 0 && !(await motorListo())) throw new Error(`El modelo dejó de estar alcanzable antes de la frase ${i + 1} (${item.id}).`)

    let reintentos429 = 0
    let r = await peticion(item.frase)
    while (r.estado === 429 && reintentos429 < MAX_REINTENTOS_429) {
      reintentos429++
      await dormir(esperaTras429(r.retryAfter) * reintentos429)
      r = await peticion(item.frase)
    }

    const base = { id: item.id, categoria: item.categoria, esperado: item.esperado, ms: r.ms, estado: r.estado, reintentos429 }
    if (r.estado !== 200 || !esRespuesta(r.cuerpo)) {
      mediciones.push({ ...base, puntuacion: null, error: r.estado === 0 ? "sin respuesta (red o plazo)" : `HTTP ${r.estado}${r.estado === 200 ? ": cuerpo inesperado" : ""}` })
      continue
    }
    const observado = observarRespuesta(r.cuerpo, item.esperado, data)
    mediciones.push({
      ...base,
      engine: r.cuerpo.engine,
      accion: r.cuerpo.action,
      observado,
      puntuacion: observado ? puntuar(item.esperado, observado, data) : null,
      error: observado ? undefined : "respuesta no interpretable",
    })
  }
  return mediciones
}
