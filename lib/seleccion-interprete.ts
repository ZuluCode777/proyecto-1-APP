import type { Intent } from "@/lib/local-agent"

/**
 * Política de selección de intérprete para el issue #34 (EA-08), hallazgo 15 de
 * la auditoría: las REGLAS resuelven primero; el modelo solo interviene cuando
 * las reglas no entienden la frase.
 *
 * Antes, el endpoint corría el modelo primero y ejecutaba directamente lo que
 * devolviera, de modo que un `unknown` del modelo anulaba una intención que las
 * reglas sí reconocían (p. ej. «información de la B23»). Esta función centraliza
 * la decisión, sin red ni efectos, para poder probarla con un modelo simulado.
 *
 * Invariantes que conserva:
 * - Una sola acción por pregunta: devuelve UNA `Intent` y quién la interpretó.
 * - La validación de entidades del modelo sigue en `parseIntentWithOllama`
 *   (nombres y códigos contra el catálogo); aquí solo se decide cuál usar.
 * - Si ninguno entiende, se conserva la respuesta de desconocimiento de reglas.
 */

/** Una intención "conocida" es cualquiera distinta de `unknown`. */
export function intencionConocida(intent: Intent | null | undefined): intent is Intent {
  return intent != null && intent.type !== "unknown"
}

/**
 * ¿Hace falta consultar el modelo para esta frase? Solo cuando las reglas no la
 * entendieron. Si las reglas ya resolvieron un comando conocido, no se llama al
 * modelo: responde más rápido y no puede desviar la intención.
 */
export function requiereModelo(intentDeReglas: Intent): boolean {
  return !intencionConocida(intentDeReglas)
}

export type SeleccionInterprete = {
  intent: Intent
  /** Qué intérprete resolvió la frase, para el motor mostrado y la telemetría. */
  engine: "reglas" | "ollama"
}

/**
 * Decide la intención final a partir de la de reglas (siempre disponible) y la
 * del modelo (opcional; `null` si no respondió, falló o no validó).
 *
 * - Reglas conocen la frase: se usan reglas, aunque el modelo hubiera corrido.
 * - Reglas no la conocen pero el modelo sí: se usa el modelo.
 * - Ninguno la conoce: se usa la intención de reglas (respuesta de desconocido).
 */
export function elegirIntent(intentDeReglas: Intent, intentDelModelo: Intent | null): SeleccionInterprete {
  if (intencionConocida(intentDeReglas)) return { intent: intentDeReglas, engine: "reglas" }
  if (intencionConocida(intentDelModelo)) return { intent: intentDelModelo, engine: "ollama" }
  return { intent: intentDeReglas, engine: "reglas" }
}

/**
 * ¿Esta intención puede usar la ubicación de la persona? Solo el GPS y un viaje
 * SIN origen explícito la aprovechan como origen. Hallazgo 8 (EA-08): no se debe
 * adjuntar la coordenada a un saludo, una ayuda, el horario de una ruta ni a un
 * viaje que ya dice su origen. Se evalúa sobre la intención de REGLAS en el
 * cliente, que no necesita red para saberlo.
 */
export function intencionUsaUbicacion(intent: Intent): boolean {
  if (intent.type === "gps") return true
  if (intent.type === "trip") return intent.origin === undefined
  return false
}
