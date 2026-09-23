/**
 * Límite de peticiones por IP para las rutas de API.
 *
 * ponytail: contador en memoria del proceso. En Vercel cada instancia
 * serverless lleva su propio contador, así que el límite real es por
 * instancia, no global. Si hace falta un límite global, mover el estado a
 * Vercel KV o Upstash sin cambiar la firma de `rateLimit`.
 */

export type RateLimitOptions = {
  /** Peticiones permitidas dentro de la ventana. */
  limit: number
  /** Duración de la ventana en milisegundos. */
  windowMs: number
  /** Reloj inyectable para poder probar la ventana sin esperar. */
  now?: () => number
}

type Entry = { count: number; reset: number }

/** Máximo de IPs recordadas antes de limpiar las entradas vencidas. */
const MAX_TRACKED_KEYS = 5000

export function createRateLimiter({ limit, windowMs, now = Date.now }: RateLimitOptions) {
  const hits = new Map<string, Entry>()

  return function rateLimit(key: string): { allowed: boolean; retryAfterSeconds: number } {
    const time = now()

    if (hits.size > MAX_TRACKED_KEYS) {
      for (const [k, entry] of hits) {
        if (time > entry.reset) hits.delete(k)
      }
    }

    const entry = hits.get(key)
    if (!entry || time > entry.reset) {
      hits.set(key, { count: 1, reset: time + windowMs })
      return { allowed: true, retryAfterSeconds: 0 }
    }

    entry.count += 1
    if (entry.count > limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((entry.reset - time) / 1000)),
      }
    }
    return { allowed: true, retryAfterSeconds: 0 }
  }
}
