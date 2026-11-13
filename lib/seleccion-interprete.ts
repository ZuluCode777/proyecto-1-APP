import type { Intent } from "@/lib/local-agent"

/**
 * Política de selección de intérprete. Es pura (sin red ni efectos) para poder
 * probarla con un modelo simulado.
 *
 * Actualización (EA-27, #53), decisión de A1 del 10/11/2026: con el modelo
 * cargado, TODA pregunta se consulta al modelo; solo responden las reglas
 * cuando no hay modelo cargado (ver `modeloListo` en `lib/ollama.ts`). Esto
 * reemplaza la política de EA-08 (hallazgo 15), «las reglas primero», con dos
 * excepciones de seguridad:
 *
 * - `metro` y `trip_missing_destination` los resuelven siempre las reglas y
 *   no se consulta al modelo: las intenciones del modelo (`MODEL_INTENTS`) no
 *   pueden expresarlas. Una consulta del Metro nunca debe ser viaje, GPS ni
 *   abordaje (invariante de EA-13); medido contra el modelo real, «quiero ir
 *   en metro a la calle 72» salía como viaje y «cómo funciona la línea 2 del
 *   metro» como la ruta «2 M».
 * - `seguridad_fisica` («¿ya puedo cruzar?», «¿está libre el andén?») también la
 *   resuelven siempre las reglas: la regla del equipo es que el modelo nunca
 *   decide si es seguro cruzar ni abordar. Medido contra el modelo real, esas
 *   dos frases salían como `gps` y la respuesta («te guío a la estación») sonaba
 *   a luz verde para una persona ciega.
 * - Se mantiene la protección de EA-08: un `unknown` del modelo (o una salida
 *   que no valida contra los datos) no anula la intención de las reglas, p. ej.
 *   «información de la B23».
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
 * ¿Esta intención de reglas es de las que el modelo no puede expresar? Se
 * responden siempre con reglas y no se consulta al modelo.
 */
function soloReglas(intentDeReglas: Intent): boolean {
  return (
    intentDeReglas.type === "metro" ||
    intentDeReglas.type === "trip_missing_destination" ||
    intentDeReglas.type === "seguridad_fisica"
  )
}

/**
 * ¿Hay que consultar al modelo para esta frase (cuando está cargado)? Siempre,
 * salvo que las reglas hayan reconocido una intención que solo ellas expresan.
 */
export function requiereModelo(intentDeReglas: Intent): boolean {
  return !soloReglas(intentDeReglas)
}

export type SeleccionInterprete = {
  intent: Intent
  /** Qué intérprete resolvió la frase, para el motor mostrado y la telemetría. */
  engine: "reglas" | "ollama"
}

/**
 * Decide la intención final a partir de la de reglas (siempre disponible) y la
 * del modelo (opcional; `null` si no se consultó, no respondió, falló o no
 * validó).
 *
 * - Las reglas reconocen `metro`, `trip_missing_destination` o `seguridad_fisica`: reglas.
 * - El modelo reconoce la frase (no es `null` ni `unknown`): modelo.
 * - Si no: la intención de reglas, aunque sea `unknown`.
 */
export function elegirIntent(intentDeReglas: Intent, intentDelModelo: Intent | null): SeleccionInterprete {
  if (soloReglas(intentDeReglas)) return { intent: intentDeReglas, engine: "reglas" }
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

/**
 * Aclaración entre turnos (EA-19, #45). «Salgo desde Ricaurte» deja el origen
 * pendiente en el cliente (`aclaracion` de la respuesta); la pregunta siguiente
 * («Calle 72») lo trae de vuelta como `pendiente`. Solo completa un viaje que
 * llega SIN origen: un origen que la persona dijo ahora no se sustituye, y
 * cualquier otra intención (cancelar, ayuda, una ruta) ignora el pendiente. Como
 * el viaje ya trae origen, `runIntent` no usa el GPS. El servidor no guarda
 * historial: el pendiente viaja en la petición y se descarta al responder.
 */
export function conOrigenPendiente(intent: Intent, origenPendiente: string | undefined): Intent {
  if (origenPendiente && intent.type === "trip" && intent.origin === undefined) return { ...intent, origin: origenPendiente }
  return intent
}
