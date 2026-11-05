/**
 * Identidad del cliente para el límite de peticiones, con una política
 * CONSERVADORA sobre las cabeceras de proxy, para EA-10 (#36).
 *
 * El código anterior confiaba en el PRIMER valor de `x-forwarded-for` (o en
 * `x-real-ip`) como identidad. Esas cabeceras las puede escribir cualquiera que
 * llegue al servidor; solo son fiables detrás de un proxy que las REESCRIBA de
 * forma conocida y verificada. Confiar en un valor arbitrario permite suplantar
 * la IP de otra persona (gastarle su cuota) e inflar la cardinalidad del
 * contador inventando un valor distinto por petición.
 *
 * Mientras no se haya VERIFICADO el proxy real (Render, pendiente de EA-14/#40),
 * no se confía en ninguna cabecera reenviada: toda petición comparte UNA sola
 * clave acotada (`CLAVE_SIN_VERIFICAR`). Así nadie obtiene cuota propia
 * inventando cabeceras y la cota es conservadora. La matriz/cadena a medir antes
 * de confiar en un proxy está en `docs/expoandes/ea-10-recursos-autenticacion.md`;
 * NO se añade aquí una rama de «proxy confiable» configurable hasta tener esa
 * medición, para no etiquetar una cadena sin validar como IP confiable.
 */

/** Clave única y acotada para toda identidad no verificada. */
export const CLAVE_SIN_VERIFICAR = "sin-verificar"

/**
 * Clave para el límite de peticiones del cliente. Mientras no haya un proxy de
 * confianza VERIFICADO (EA-14/#40), devuelve siempre la clave acotada común: no
 * se deriva identidad de `x-forwarded-for`/`x-real-ip`, porque un valor sin
 * validar no es una IP de confianza.
 */
export function claveCliente(): string {
  return CLAVE_SIN_VERIFICAR
}
