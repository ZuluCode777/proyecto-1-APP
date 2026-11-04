import snapshot from "@/data/transmilenio.json" with { type: "json" }
import { aplicarEvidenciaGtfs } from "@/lib/evidencia-gtfs"
import { fetchTransmilenio, TransmilenioDataSchema, type TransmilenioData } from "@/lib/transmilenio"

/**
 * Datos de TransMilenio para las rutas del servidor.
 *
 * Mantiene el ÚLTIMO catálogo válido (en vivo o la copia) y nunca lo reemplaza
 * por una respuesta vacía, parcial o caída:
 *
 * - Consulta el servicio en vivo y, si responde con un catálogo íntegro, lo
 *   guarda `LIVE_TTL_MS`.
 * - Al expirar, intenta renovar; si la renovación falla, CONSERVA el catálogo
 *   que ya tenía (su `source`/`fetchedAt` siguen siendo los del dato bueno) y
 *   reintenta en `RETRY_MS`, sin degradar a la copia.
 * - Solo recurre a la copia de `data/transmilenio.json` cuando aún no hay
 *   ningún catálogo en memoria y el servicio no responde, para que la app
 *   arranque aunque la red de TransMilenio esté caída.
 *
 * `fetchTransmilenio` ya rechaza una respuesta en vivo vacía, recortada,
 * incompleta en identificadores/geometría o con referencias inválidas, así que
 * lo que llega aquí como éxito es un catálogo usable.
 */
const LIVE_TTL_MS = 6 * 60 * 60 * 1000
const RETRY_MS = 5 * 60 * 1000

/** Catálogo vigente y hasta cuándo se considera fresco. */
let cache: { data: TransmilenioData; expires: number } | null = null
/** Consulta en vivo en curso, compartida para no lanzar varias a la vez. */
let pending: Promise<TransmilenioData> | null = null

/** La copia guardada, validada y con la evidencia GTFS aplicada. */
function copiaGuardada(): TransmilenioData {
  const data = TransmilenioDataSchema.parse(snapshot)
  // Asegura la evidencia GTFS corroborada también si la copia no se migró.
  aplicarEvidenciaGtfs(data.routes, data.stations)
  return data
}

/**
 * Lanza —una sola vez a la vez— una consulta en vivo. Si tiene éxito, actualiza
 * el catálogo vigente. Si falla, NO toca el catálogo vigente: se registra y se
 * deja que quien llama siga con el último dato bueno (o con la copia si no hay
 * ninguno). El reintento queda acotado por `RETRY_MS` vía la marca de `expires`.
 */
function renovarEnVivo(): Promise<TransmilenioData> {
  pending ??= fetchTransmilenio()
    .then((data) => {
      cache = { data, expires: Date.now() + LIVE_TTL_MS }
      return data
    })
    .catch((error) => {
      console.warn("[transmilenio] servicio no disponible:", error)
      if (cache) {
        // Hay un catálogo bueno: se conserva y solo se aplaza el próximo intento.
        cache.expires = Date.now() + RETRY_MS
        return cache.data
      }
      // Arranque sin ningún catálogo y sin servicio: se usa la copia guardada,
      // con un reintento pronto para pasar a datos en vivo en cuanto respondan.
      const data = copiaGuardada()
      cache = { data, expires: Date.now() + RETRY_MS }
      return data
    })
    .finally(() => {
      pending = null
    })
  return pending
}

/**
 * Catálogo de TransMilenio para el servidor. Si el catálogo vigente sigue
 * fresco, lo devuelve. Si expiró pero aún es válido, lo devuelve DE INMEDIATO y
 * dispara una renovación en segundo plano (stale-while-revalidate): la petición
 * no espera por el servicio upstream y el dato bueno sobrevive a una caída. Solo
 * se espera la consulta en vivo cuando todavía no hay ningún catálogo en memoria.
 */
export async function getTransmilenioData(): Promise<TransmilenioData> {
  if (cache && cache.expires > Date.now()) return cache.data
  if (cache) {
    // Expirado pero válido: renueva en segundo plano y responde con lo que hay.
    // Se aplaza el próximo intento para no disparar una renovación por petición
    // mientras una ya está en curso o acaba de aplazarse.
    cache.expires = Date.now() + RETRY_MS
    void renovarEnVivo()
    return cache.data
  }
  return renovarEnVivo()
}
