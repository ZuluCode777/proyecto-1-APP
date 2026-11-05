/**
 * Límite de peticiones por clave para las rutas de API.
 *
 * ponytail: contador en memoria del proceso. En una sola instancia el límite es
 * local a ese proceso; no es una cuota global ni persistente. Esta app corre
 * como una sola instancia demo, así que alcanza; si algún día hicieran falta
 * varias instancias con cuota compartida, el estado tendría que ir a un almacén
 * externo (p. ej. Redis), SIN cambiar la firma de `rateLimit`. No se añade Redis
 * por defecto (alcance demo, EA-10/#36).
 *
 * EA-10 (#36): además de expirar por ventana, el contador ACOTA su cardinalidad.
 * Antes solo se limpiaban las entradas vencidas cuando el mapa pasaba de un
 * tamaño; un aluvión de claves NUEVAS dentro de la ventana (p. ej. una cabecera
 * de proxy inventada por petición) hacía crecer el mapa sin tope, porque no
 * había nada vencido que limpiar. Ahora, al llegar al tope de claves se rechaza
 * la clave NUEVA con 429 (`motivo: "cardinalidad"`) en vez de crecer, y nunca se
 * desaloja una clave activa: así un rechazo no se puede «reiniciar» desalojando
 * la entrada que lo cuenta.
 */

export type RateLimitOptions = {
  /** Peticiones permitidas dentro de la ventana. */
  limit: number
  /** Duración de la ventana en milisegundos. */
  windowMs: number
  /**
   * Máximo de claves distintas recordadas a la vez. Al alcanzarlo, una clave
   * nueva se rechaza (tras purgar las vencidas) en vez de hacer crecer el mapa.
   */
  maxKeys?: number
  /** Reloj inyectable para poder probar la ventana sin esperar. */
  now?: () => number
}

type Entry = { count: number; reset: number }

/**
 * Resultado de evaluar el límite. `motivo` distingue, en un rechazo, si fue por
 * exceder las peticiones de la propia clave (`"ventana"`) o por llegar al tope
 * de claves distintas (`"cardinalidad"`). Permitido no lleva motivo.
 */
export type ResultadoLimite =
  | { allowed: true; retryAfterSeconds: 0 }
  | { allowed: false; retryAfterSeconds: number; motivo: "ventana" | "cardinalidad" }

/** Tope de claves recordadas a la vez por defecto. */
const MAX_TRACKED_KEYS = 5000

export function createRateLimiter({ limit, windowMs, maxKeys = MAX_TRACKED_KEYS, now = Date.now }: RateLimitOptions) {
  const hits = new Map<string, Entry>()

  /** Elimina las entradas ya vencidas; devuelve el `reset` más próximo restante. */
  function purgarVencidasYProximoReset(time: number): number {
    let proximo = Infinity
    for (const [clave, entry] of hits) {
      if (time > entry.reset) hits.delete(clave)
      else if (entry.reset < proximo) proximo = entry.reset
    }
    return proximo
  }

  return function rateLimit(key: string): ResultadoLimite {
    const time = now()
    const entry = hits.get(key)

    if (!entry || time > entry.reset) {
      // Clave nueva (o con su ventana ya vencida). Si el mapa está lleno, primero
      // se purgan las vencidas: recuperar espacio por expiración es legítimo y no
      // reinicia ninguna cuota activa. Si aun así sigue lleno, se rechaza la clave
      // nueva por cardinalidad SIN desalojar una entrada activa.
      if (!hits.has(key) && hits.size >= maxKeys) {
        const proximo = purgarVencidasYProximoReset(time)
        if (hits.size >= maxKeys) {
          const retryAfterSeconds = Number.isFinite(proximo) ? Math.max(1, Math.ceil((proximo - time) / 1000)) : 1
          return { allowed: false, retryAfterSeconds, motivo: "cardinalidad" }
        }
      }
      hits.set(key, { count: 1, reset: time + windowMs })
      return { allowed: true, retryAfterSeconds: 0 }
    }

    entry.count += 1
    if (entry.count > limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((entry.reset - time) / 1000)),
        motivo: "ventana",
      }
    }
    return { allowed: true, retryAfterSeconds: 0 }
  }
}
