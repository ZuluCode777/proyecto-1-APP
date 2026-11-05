/**
 * Identidad del cliente para el límite de peticiones, con una política
 * CONSERVADORA y explícita sobre las cabeceras de proxy, para EA-10 (#36).
 *
 * El código anterior confiaba en el PRIMER valor de `x-forwarded-for` (o en
 * `x-real-ip`) como identidad. Esas cabeceras las puede escribir cualquiera que
 * llegue al servidor; solo son fiables detrás de un proxy que las REESCRIBA de
 * forma conocida. Confiar en el primer valor arbitrario permite:
 *
 * - suplantar la IP de otra persona (y gastarle su cuota), y
 * - inflar la cardinalidad del contador inventando un valor distinto por
 *   petición (muchas claves nuevas; ver `lib/rate-limit.ts`).
 *
 * Política (hasta verificar el proxy real de Render, EA-14/#40):
 *
 * - Por defecto NO se confía en ninguna cabecera reenviada: la identidad es
 *   `sin-verificar` y todas esas peticiones comparten UNA sola clave acotada
 *   (`CLAVE_SIN_VERIFICAR`). Así, sin proxy de confianza comprobado, nadie
 *   obtiene cuota propia inventando cabeceras, y la cota es conservadora.
 * - Si algún día se declara un proxy de confianza (número de saltos que añade a
 *   `x-forwarded-for`), se toma la IP del cliente contando ESE número de saltos
 *   desde la DERECHA de la cadena (el salto que escribió el proxy de confianza),
 *   nunca el primer valor arbitrario de la izquierda.
 *
 * Esta decisión es pura y con la configuración inyectable para poder probar la
 * matriz de cadenas sin desplegar. NO afirma que Render reescriba ninguna
 * cabecera: eso queda pendiente de medición real en EA-14/#40 antes de confiar
 * en ella. Hasta entonces, el comportamiento acotado de `sin-verificar` es el
 * seguro por defecto.
 */

/** Clave única y acotada para toda identidad no verificada. */
export const CLAVE_SIN_VERIFICAR = "sin-verificar"

/**
 * Configuración del proxy de confianza. `saltosConfiables` es el número de
 * proxies que se sabe (por medición, no por suposición) que anteponen su salto
 * a `x-forwarded-for`. `0` (por defecto) significa que NO hay proxy de confianza
 * comprobado y nunca se confía en las cabeceras reenviadas.
 */
export type ConfigProxy = {
  saltosConfiables: number
}

export const CONFIG_PROXY_POR_DEFECTO: ConfigProxy = { saltosConfiables: 0 }

/**
 * Identidad resuelta, como unión discriminada por `kind`:
 *
 * - `confiable`: hay un proxy de confianza comprobado y se extrajo la IP del
 *   cliente de la cadena; `ip` es esa IP.
 * - `sin-verificar`: no hay identidad validada; se usa la clave acotada común.
 */
export type IdentidadCliente =
  | { kind: "confiable"; ip: string }
  | { kind: "sin-verificar" }

/** Cabeceras relevantes para resolver la identidad. */
export type CabecerasIdentidad = {
  forwardedFor: string | null
  realIp: string | null
}

/**
 * Resuelve la identidad del cliente según la política conservadora.
 *
 * Con `saltosConfiables <= 0` (por defecto) nunca se confía en cabeceras
 * reenviadas: identidad `sin-verificar`. Con `saltosConfiables >= 1` se toma la
 * IP que está `saltosConfiables` posiciones desde el FINAL de `x-forwarded-for`
 * (el salto que, según la medición, escribió el proxy de confianza). Si la
 * cadena no tiene suficientes saltos para cubrir los proxies de confianza, la
 * cabecera no es coherente con la topología declarada y se degrada a
 * `sin-verificar` (conservador), en vez de aceptar un valor arbitrario.
 */
export function resolverIdentidad(
  cabeceras: CabecerasIdentidad,
  config: ConfigProxy = CONFIG_PROXY_POR_DEFECTO,
): IdentidadCliente {
  if (config.saltosConfiables <= 0) return { kind: "sin-verificar" }

  const cadena = (cabeceras.forwardedFor ?? "")
    .split(",")
    .map((parte) => parte.trim())
    .filter((parte) => parte !== "")

  // Se necesitan al menos tantos saltos como proxies de confianza; el índice
  // cuenta desde la derecha (el salto más cercano al servidor es el último).
  if (cadena.length < config.saltosConfiables) return { kind: "sin-verificar" }
  const ip = cadena[cadena.length - config.saltosConfiables]
  if (!ip) return { kind: "sin-verificar" }
  return { kind: "confiable", ip }
}

/**
 * Clave para el límite de peticiones a partir de la identidad. Una identidad no
 * verificada colapsa a una sola clave acotada; una verificada usa su IP.
 */
export function claveLimite(identidad: IdentidadCliente): string {
  return identidad.kind === "confiable" ? identidad.ip : CLAVE_SIN_VERIFICAR
}
