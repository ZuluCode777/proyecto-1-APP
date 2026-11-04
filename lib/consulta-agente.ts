import { AgentReplySchema, interpretCommand, plainReply, type AgentReply } from "@/lib/local-agent"
import type { LatLng } from "@/lib/geo"
import type { TransmilenioData } from "@/lib/routes"

/**
 * Consulta al asistente desde el navegador con ESPERA MÁXIMA y respaldo local,
 * para el issue #34 (EA-08), hallazgo 7 de la auditoría.
 *
 * Antes el cliente esperaba el `fetch` sin plazo propio: si el servidor no
 * respondía ni fallaba, la pregunta quedaba colgada y `busyRef` bloqueado. Ahora:
 *
 * - La petición se aborta a los `esperaMaximaMs` o cuando quien llama lo pide
 *   (salir, cancelar o una pregunta nueva) a través de `signal`.
 * - Si el servidor no responde a tiempo, falla o devuelve algo inválido, y ya
 *   hay catálogo cargado, el MISMO intérprete de reglas resuelve en el navegador
 *   con esos datos. Es respaldo con datos ya cargados, no disponibilidad sin red
 *   desde un arranque frío.
 * - Sin catálogo cargado se devuelve un aviso recuperable dentro del plazo.
 *
 * Es lógica pura con dependencias inyectables (`implementacionFetch`, `now`)
 * para probar la espera máxima y el respaldo con un reloj y un proveedor
 * simulados, sin navegador. No toca el DOM ni habla: quien llama decide los
 * efectos tras comprobar vigencia.
 */

/** Espera máxima del cliente por `/api/agent`, en milisegundos. */
export const ESPERA_MAXIMA_CLIENTE_MS = 6_000

export type ConsultaAgenteOpciones = {
  message: string
  /** Solo se adjunta si la frase puede usar la ubicación (ver `intencionUsaUbicacion`). */
  position?: LatLng
  /** Catálogo ya cargado para el respaldo local; `null` si aún no hay. */
  data: TransmilenioData | null
  /** Señal externa para abortar (salir, cancelar o pregunta nueva). */
  signal: AbortSignal
  /** `fetch` real o simulado (para pruebas). */
  implementacionFetch?: typeof fetch
  /** Reloj inyectable para el respaldo local (`now` en el intérprete). */
  now?: () => Date
  /** Espera máxima antes de abortar y usar el respaldo. */
  esperaMaximaMs?: number
}

/** Mensaje recuperable cuando no hay servidor ni catálogo para responder. */
const SIN_RESPALDO = "No tengo conexión con el servidor y todavía no hay datos cargados. Inténtalo de nuevo."

/**
 * Resuelve una consulta: red con espera máxima, o respaldo local con los datos
 * cargados. Nunca lanza por tiempo de espera, red caída ni JSON inválido: esos
 * casos caen al respaldo. Si `signal` ya estaba abortada (p. ej. la persona
 * salió), se refleja re-lanzando `AbortError` para que quien llama no muestre
 * nada.
 */
export async function consultarAgente({
  message,
  position,
  data,
  signal,
  implementacionFetch = fetch,
  now = () => new Date(),
  esperaMaximaMs = ESPERA_MAXIMA_CLIENTE_MS,
}: ConsultaAgenteOpciones): Promise<AgentReply> {
  if (signal.aborted) throw new DOMException("Cancelado antes de empezar", "AbortError")

  const respaldoLocal = (): AgentReply =>
    data ? interpretCommand(message, data, { position, now: now() }) : plainReply(SIN_RESPALDO)

  // La espera máxima del cliente se combina con la señal externa mediante un
  // único `AbortController` propio, que se aborta por el temporizador o por la
  // señal externa, lo que llegue primero. No se usa `AbortSignal.any` para poder
  // distinguir después "cancelado por el usuario" de "venció el plazo".
  const temporizador = new AbortController()
  const idTemporizador = setTimeout(() => temporizador.abort(), esperaMaximaMs)
  const alCancelar = () => temporizador.abort()
  signal.addEventListener("abort", alCancelar, { once: true })

  try {
    const res = await implementacionFetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, position }),
      signal: temporizador.signal,
    })
    if (!res.ok && res.status !== 429 && res.status !== 413) throw new Error(`HTTP ${res.status}`)
    const json = await res.json()
    const parsed = AgentReplySchema.safeParse(json)
    if (!parsed.success) return respaldoLocal()
    return parsed.data
  } catch {
    // Si quien llamó abortó (salir/cancelar/pregunta nueva), propaga el aborto:
    // no se debe mostrar ni hablar una respuesta tardía.
    if (signal.aborted) throw new DOMException("Cancelado por el usuario", "AbortError")
    // Venció el plazo o falló la red: respaldo local con los datos cargados.
    return respaldoLocal()
  } finally {
    clearTimeout(idTemporizador)
    signal.removeEventListener("abort", alCancelar)
  }
}
