import snapshot from "@/data/transmilenio.json"
import { fetchTransmilenio, TransmilenioDataSchema, type TransmilenioData } from "@/lib/transmilenio"

/**
 * Datos de TransMilenio para las rutas del servidor.
 *
 * Consulta el servicio en vivo y guarda la respuesta 6 horas. Si el servicio
 * falla, usa la copia de `data/transmilenio.json` y vuelve a intentar en 5
 * minutos, para que la app siga funcionando sin la red de TransMilenio.
 */
const LIVE_TTL_MS = 6 * 60 * 60 * 1000
const RETRY_MS = 5 * 60 * 1000

let cache: { data: TransmilenioData; expires: number } | null = null
let pending: Promise<TransmilenioData> | null = null

export async function getTransmilenioData(): Promise<TransmilenioData> {
  if (cache && cache.expires > Date.now()) return cache.data
  pending ??= fetchTransmilenio()
    .then((data) => {
      cache = { data, expires: Date.now() + LIVE_TTL_MS }
      return data
    })
    .catch((error) => {
      console.warn("[transmilenio] servicio no disponible, uso la copia guardada:", error)
      const data = TransmilenioDataSchema.parse(snapshot)
      cache = { data, expires: Date.now() + RETRY_MS }
      return data
    })
    .finally(() => {
      pending = null
    })
  return pending
}
