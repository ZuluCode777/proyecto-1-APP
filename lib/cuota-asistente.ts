/**
 * Cuota compartida de `POST /api/agent` para la feria (EA-28, #75).
 *
 * `claveCliente()` devuelve una sola clave para todos, así que este número es el
 * tope de TODOS los teléfonos a la vez, no de cada uno. El cálculo cabe en una
 * fórmula y la explica `docs/expoandes/ea-10-recursos-autenticacion.md`
 * («Cuota del asistente en la feria»):
 *
 *   límite = ceil(TELEFONOS_FERIA × (60 / SEGUNDOS_POR_TURNO) × MARGEN)
 *
 * Para cambiar el límite basta con corregir `TELEFONOS_FERIA`.
 */

/** Teléfonos que consultan al asistente a la vez: 3 en total, cifra confirmada por el responsable (criterio 1 de #75). */
export const TELEFONOS_FERIA = 3

/**
 * Segundos que dura como mínimo un turno de una persona en un teléfono: dictar una
 * frase corta, revisar y tocar «Enviar». Sale del cliente, no de una medición de
 * ritmo: la app iPhone tiene una sola consulta en vuelo (`Enviar` queda inactivo
 * mientras espera), un plazo de 12 s, ningún reintento automático y no envía sola
 * lo dictado; la web tiene una sola en vuelo (`busyRef`) y un plazo de 6 s. Un
 * «Reintentar» o una aclaración de origen son turnos como los demás, así que no
 * suben este ritmo: tras un plazo vencido el reintento llega a los 12 s, como
 * pronto. 6 s son 10 consultas por minuto por teléfono.
 */
export const SEGUNDOS_POR_TURNO = 6

/** Holgura sobre el pico: pruebas del equipo, `/diagnostico` (4 POST por pasada) y más teléfonos de los previstos. */
export const MARGEN = 1.5

export const LIMITE_ASISTENTE = Math.ceil(TELEFONOS_FERIA * (60 / SEGUNDOS_POR_TURNO) * MARGEN)
export const VENTANA_ASISTENTE_MS = 60_000
