import { bearingDegrees, cardinal, relativeDirection, spokenDistance, type LatLng } from "@/lib/geo"

/**
 * Política PEQUEÑA y COMPARTIDA de ubicación para el issue #33 (EA-07): decide
 * cuándo una lectura del navegador es usable, cuándo está vencida, cuándo una
 * cercanía puede anunciarse como «llegada» y cuándo un rumbo de brújula es
 * fiable. La usan por igual el GPS auditivo (`components/auditory-gps.tsx`) y la
 * ruta de ubicación del asistente (`components/total-agent.tsx` →
 * `lib/consulta-agente.ts` → `app/api/agent/route.ts`) para no divergir.
 *
 * No es una plataforma de ubicación ni una abstracción de hardware: son
 * funciones PURAS con el instante inyectable (`ahora`), sin DOM y sin
 * temporizadores. Así se prueban con un reloj simulado.
 *
 * Principio: una lectura solo es evidencia vigente si su HORA DE CAPTURA es un
 * tiempo real, finito, reciente y con adelanto máximo de 2 s respecto al reloj
 * que valida. No se fabrica una hora cuando el navegador no la da ni se acepta
 * un adelanto mayor: sin hora fiable, no hay evidencia de actualidad.
 *
 * ⚠️ UMBRALES COMO HIPÓTESIS. Los valores de edad y precisión de abajo son
 * puntos de partida razonables para la web en un teléfono, NO garantías físicas
 * ni medidas con un iPhone real. Deben ajustarse con medición en dispositivo.
 */

/**
 * Edad máxima de una lectura de posición para considerarla fresca, en
 * milisegundos. Más vieja que esto no se reutiliza ni se envía: se pide una
 * nueva o se abstiene. Hipótesis, no garantía.
 */
export const EDAD_MAXIMA_POSICION_MS = 60_000

/**
 * Radio de precisión (en metros, no 1σ: es la cota de confianza del navegador)
 * a partir del cual una lectura es demasiado imprecisa para afirmar llegada.
 * Hipótesis, no garantía física.
 */
export const PRECISION_MAXIMA_LLEGADA_M = 50

/**
 * Distancia (m) al centroide por debajo de la cual se considera proximidad al
 * punto, siempre que la precisión la respalde. El centroide del catálogo es una
 * referencia aproximada, no un acceso peatonal verificado. Hipótesis.
 */
export const DISTANCIA_LLEGADA_M = 30

/** Edad máxima (ms) de una lectura de rumbo para anunciar un giro. Hipótesis. */
export const EDAD_MAXIMA_RUMBO_MS = 2_000

/**
 * Lectura de posición con los metadatos que importan para la seguridad: además
 * de la coordenada, el radio de precisión y la hora de captura.
 *
 * - `precision`: radio de confianza en metros (`GeolocationCoordinates.accuracy`);
 *   `null` si el navegador no lo entrega o no es finito.
 * - `hora`: epoch ms de la captura (`GeolocationPosition.timestamp`); `null` si el
 *   navegador no la entrega o no es un tiempo válido. NO se inventa.
 */
export type LecturaUbicacion = LatLng & {
  precision: number | null
  hora: number | null
}

/** Forma mínima de `GeolocationCoordinates` que necesitamos del navegador. */
type CoordenadasNavegador = {
  latitude: number
  longitude: number
  accuracy?: number | null
}

/** Forma mínima de `GeolocationPosition` que necesitamos del navegador. */
type PosicionNavegador = {
  coords: CoordenadasNavegador
  timestamp?: number | null
}

/** ¿`n` es un número finito y real (no NaN, no Infinity)? */
const esFinito = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n)

/**
 * ¿`hora` es un instante de captura VÁLIDO respecto a `ahora`? Debe ser finito,
 * no negativo y no adelantarse más de 2 s respecto al reloj que valida.
 * El margen para desfases de reloj es una hipótesis que requiere medición.
 */
const HORA_MARGEN_FUTURO_MS = 2_000
function horaValida(hora: number | null | undefined, ahora: number): hora is number {
  if (!esFinito(hora)) return false
  if (hora < 0) return false
  if (hora > ahora + HORA_MARGEN_FUTURO_MS) return false
  return true
}

/**
 * Valida y normaliza una `GeolocationPosition` del navegador a `LecturaUbicacion`.
 * Devuelve `null` si lat/lng no son finitas o están fuera de rango.
 *
 * - `accuracy` no finita o negativa → `precision: null` (las decisiones que
 *   exigen precisión se abstienen).
 * - `timestamp` ausente, no finito o adelantado más de 2 s → `hora: null`. NO se sustituye por
 *   `ahora`: una posición sin hora fiable no es evidencia de que sea actual.
 *   Conserva la hora REAL de captura cuando es válida.
 */
export function leerPosicionNavegador(
  posicion: PosicionNavegador | null | undefined,
  ahora: number = Date.now(),
): LecturaUbicacion | null {
  if (!posicion || typeof posicion !== "object") return null
  const { coords } = posicion
  if (!coords || typeof coords !== "object") return null
  const { latitude, longitude, accuracy } = coords
  if (!esFinito(latitude) || !esFinito(longitude)) return null
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null
  const precision = esFinito(accuracy) && accuracy >= 0 ? accuracy : null
  const hora = horaValida(posicion.timestamp, ahora) ? posicion.timestamp : null
  return { lat: latitude, lng: longitude, precision, hora }
}

/**
 * ¿La lectura es evidencia vigente respecto a `ahora`? Exige una hora de captura
 * VÁLIDA (finita, no negativa y dentro del margen de reloj) y reciente (no más vieja que el
 * límite). Sin hora válida no es fresca: no hay prueba de que sea actual.
 */
export function esFresca(
  lectura: Pick<LecturaUbicacion, "hora">,
  ahora: number = Date.now(),
  edadMaximaMs: number = EDAD_MAXIMA_POSICION_MS,
): boolean {
  if (!horaValida(lectura.hora, ahora)) return false
  return ahora - lectura.hora <= edadMaximaMs
}

/**
 * Devuelve la lectura SOLO si es fresca; si está vencida, sin hora o fuera del margen,
 * devuelve `undefined`. Base de «no reutilizar ni enviar coordenadas vencidas».
 */
export function ubicacionVigente(
  lectura: LecturaUbicacion | null | undefined,
  ahora: number = Date.now(),
  edadMaximaMs: number = EDAD_MAXIMA_POSICION_MS,
): LecturaUbicacion | undefined {
  if (!lectura) return undefined
  return esFresca(lectura, ahora, edadMaximaMs) ? lectura : undefined
}

/** Resultado de evaluar si se puede anunciar proximidad fiable a un punto. */
export type DecisionLlegada = {
  /** `true` solo si la distancia Y la precisión respaldan la proximidad. */
  llego: boolean
  /** Por qué no se puede afirmar, para dar un aviso honesto. */
  motivo?: "lejos" | "sin-precision" | "precision-insuficiente" | "sin-posicion"
}

/**
 * Decide si hay PROXIMIDAD fiable al punto objetivo. Exige estar a menos de
 * `distanciaLlegadaM` del centroide Y que la precisión lo respalde (`precision`
 * finita y ≤ `precisionMaximaM`). Caso de la especificación: 20 m con precisión
 * 200 m → `precision-insuficiente`, nunca proximidad confirmada.
 *
 * El centroide es una referencia APROXIMADA, no un acceso peatonal. Esta función
 * responde «¿estoy cerca del punto, con medición fiable?», no «¿llegué a un
 * acceso accesible?». Quien la use redacta el aviso sin prometer acceso.
 */
export function decisionLlegada(
  posicion: Pick<LecturaUbicacion, "precision"> | null | undefined,
  distanciaM: number,
  precisionMaximaM: number = PRECISION_MAXIMA_LLEGADA_M,
  distanciaLlegadaM: number = DISTANCIA_LLEGADA_M,
): DecisionLlegada {
  if (!posicion) return { llego: false, motivo: "sin-posicion" }
  if (distanciaM > distanciaLlegadaM) return { llego: false, motivo: "lejos" }
  if (!esFinito(posicion.precision)) return { llego: false, motivo: "sin-precision" }
  if (posicion.precision > precisionMaximaM) return { llego: false, motivo: "precision-insuficiente" }
  return { llego: true }
}

/**
 * Referencia del rumbo de orientación del dispositivo:
 *
 * - `absoluta`: medido respecto al norte (p. ej. `webkitCompassHeading` de iOS,
 *   o `deviceorientation` con `absolute === true`). Único que permite «gira a tu
 *   derecha».
 * - `relativa`: `alpha` sin referencia absoluta. Mide respecto a una orientación
 *   arbitraria del arranque, NO al norte: no sirve para decir hacia dónde girar.
 */
export type ReferenciaRumbo = "absoluta" | "relativa"

/**
 * Lectura cruda de orientación. Quien lee el evento del navegador la arma y, al
 * PRODUCIR una dirección, la valida con `validarRumbo` (no al recibirla).
 *
 * - `grados`: 0..360 (0 = norte), o `null` si el evento no trae valor usable.
 * - `calidad`: cota de error en grados si la plataforma la da
 *   (`webkitCompassAccuracy` de iOS); `null` si no la ofrece. Un valor negativo
 *   indica calibración desconocida/insuficiente y NO permite afirmar un giro.
 * - `hora`: epoch ms de la captura del EVENTO (ver `horaDeEvento`), o `null` si
 *   no se pudo verificar: sin hora verificable no hay giro, solo cardinal.
 */
export type LecturaRumbo = {
  grados: number | null
  referencia: ReferenciaRumbo
  calidad: number | null
  hora: number | null
}

/**
 * Cota de error (grados) por encima de la cual un rumbo, aun absoluto, no se
 * considera fiable para un giro. Hipótesis, no garantía. Sin calidad conocida
 * (`null`, negativa o no finita) el rumbo NO se afirma fiable: no se inventa
 * calibración.
 */
export const CALIDAD_MAXIMA_RUMBO_GRADOS = 25

/**
 * Pasa el `timeStamp` de un EVENTO del navegador al reloj epoch de esta política
 * (`ahora`, como `Date.now()`), para medir la edad desde la CAPTURA y no desde
 * que el componente lo recibió. Los navegadores lo dan como `DOMHighResTimeStamp`
 * relativo al origen del documento (mismo reloj que `performance.now()`), y
 * algunas plataformas antiguas como epoch en ms:
 *
 * - `>= 1e12` (≈ año 2001 en epoch; ningún reloj monotónico llega a 31 años): se
 *   toma como epoch.
 * - Menor: es relativo; la hora es `ahora - (relojMonotonico - marca)`, con
 *   `relojMonotonico` = `performance.now()` en el mismo instante. Sin ese reloj
 *   no se puede convertir.
 *
 * Devuelve `null` si la marca falta, no es finita, es `<= 0`, o la hora resultante
 * supera el margen de reloj. NO se sustituye por `ahora`: un evento sin fecha
 * verificable no es una captura fresca.
 */
export function horaDeEvento(
  marca: unknown,
  ahora: number = Date.now(),
  relojMonotonico: number | null = null,
): number | null {
  if (!esFinito(marca) || marca <= 0) return null
  let hora: number
  if (marca >= 1e12) hora = marca
  else if (esFinito(relojMonotonico)) hora = ahora - (relojMonotonico - marca)
  else return null
  return horaValida(hora, ahora) ? hora : null
}

/** Resultado de validar un rumbo para uso en instrucciones de giro. */
export type RumboFiable =
  | { fiable: true; grados: number }
  | {
      fiable: false
      motivo: "sin-dato" | "relativo" | "sin-hora" | "vencido" | "fuera-de-rango" | "sin-calidad" | "calidad-insuficiente"
    }

/**
 * Valida un rumbo ANTES de usarlo para un giro relativo. Es fiable solo si:
 *
 * - Hay valor numérico finito en 0..360.
 * - La referencia es ABSOLUTA (el `alpha` relativo no es el norte).
 * - La CALIDAD es CONOCIDA: finita, no negativa y ≤ `calidadMaximaGrados`. Sin
 *   calidad (`null`: la plataforma no la ofrece) no hay evidencia de calibración
 *   y no se afirma un giro; una calidad negativa, no finita o insuficiente
 *   también descalifica.
 * - La captura es fresca y su HORA es válida (finita y dentro del margen); sin hora
 *   verificable (`null`) no hay prueba de que el rumbo sea actual.
 *
 * Se valida la lectura COMPLETA en el momento de producir la dirección: un rumbo
 * guardado hace 3 s ya no es fiable aunque lo fuera al recibirlo. Cuando no es
 * fiable, quien llama cae a una referencia CARDINAL/textual con su límite.
 */
export function validarRumbo(
  lectura: LecturaRumbo | null | undefined,
  ahora: number = Date.now(),
  edadMaximaMs: number = EDAD_MAXIMA_RUMBO_MS,
  calidadMaximaGrados: number = CALIDAD_MAXIMA_RUMBO_GRADOS,
): RumboFiable {
  if (!lectura || !esFinito(lectura.grados)) return { fiable: false, motivo: "sin-dato" }
  if (lectura.referencia !== "absoluta") return { fiable: false, motivo: "relativo" }
  const g = lectura.grados as number
  if (g < 0 || g > 360) return { fiable: false, motivo: "fuera-de-rango" }
  // Calidad: sin valor conocido no hay evidencia de calibración (cae a cardinal).
  if (lectura.calidad == null) return { fiable: false, motivo: "sin-calidad" }
  if (!esFinito(lectura.calidad) || lectura.calidad < 0 || lectura.calidad > calidadMaximaGrados) {
    return { fiable: false, motivo: "calidad-insuficiente" }
  }
  if (!horaValida(lectura.hora, ahora)) return { fiable: false, motivo: "sin-hora" }
  if (ahora - lectura.hora > edadMaximaMs) return { fiable: false, motivo: "vencido" }
  return { fiable: true, grados: ((g % 360) + 360) % 360 }
}

/**
 * Cómo se puede orientar hacia un punto con esta lectura de posición y rumbo:
 *
 * - `relativa`: precisión suficiente Y rumbo fiable → «a tu derecha».
 * - `cardinal-brujula`: precisión suficiente pero sin rumbo fiable → cardinal.
 * - `cardinal-precision`: precisión desconocida o mayor que
 *   `precisionMaximaM` → solo cardinal estimado, nunca un giro.
 * - `sin-direccion`: el punto está dentro del radio de incertidumbre de la
 *   ubicación (`distanciaM <= precision`); ni el norte es creíble.
 */
export type ModoOrientacion = "relativa" | "cardinal-brujula" | "cardinal-precision" | "sin-direccion"

export function modoOrientacion(
  lectura: Pick<LecturaUbicacion, "precision">,
  distanciaM: number,
  rumbo: RumboFiable,
  precisionMaximaM: number = PRECISION_MAXIMA_LLEGADA_M,
): ModoOrientacion {
  const p = lectura.precision
  if (esFinito(p) && distanciaM <= p) return "sin-direccion"
  if (!esFinito(p) || p > precisionMaximaM) return "cardinal-precision"
  return rumbo.fiable ? "relativa" : "cardinal-brujula"
}

/** Punto al que se orienta: nombre, coordenada y distancia en metros desde la lectura de posición. */
export type PuntoDeOrientacion = LatLng & { name: string; distance: number }

/**
 * Referencia CARDINAL estimada hacia un punto («al noreste»), la que la lista del GPS auditivo pone junto a cada
 * estación. `null` si el punto cae dentro del margen de error de la lectura: ni el norte es creíble. No depende del
 * rumbo del dispositivo.
 */
export function cardinalHacia(lectura: Pick<LecturaUbicacion, "precision"> & LatLng, punto: PuntoDeOrientacion): string | null {
  return modoOrientacion(lectura, punto.distance, { fiable: false, motivo: "sin-dato" }) === "sin-direccion"
    ? null
    : cardinal(bearingDegrees(lectura, punto))
}

export type Orientacion = {
  modo: ModoOrientacion
  /** Giro respecto a hacia dónde mira la persona («a tu derecha»); solo con el modo `relativa`. */
  relativa: string | null
  /** Frase que el GPS auditivo dice al orientar hacia el punto. */
  indicacion: string
}

/**
 * Indicación de ORIENTACIÓN hacia un punto. Todo se valida AQUÍ, al producir la dirección, con la lectura completa
 * de posición (con su precisión) y de rumbo: solo con precisión suficiente Y rumbo fiable hay un giro relativo. Con
 * precisión desconocida o insuficiente, o brújula no fiable, se da una referencia CARDINAL estimada con su límite;
 * si el punto cae dentro del margen de error de la ubicación no se da dirección alguna. Es orientación, no un
 * itinerario peatonal accesible. La usan por igual el GPS auditivo de la web y `POST /api/planificador`.
 */
export function orientarHacia(
  punto: PuntoDeOrientacion,
  lectura: LecturaUbicacion,
  lecturaRumbo: LecturaRumbo | null | undefined,
  ahora: number = Date.now(),
): Orientacion {
  const distancia = punto.distance
  const bearing = bearingDegrees(lectura, punto)
  const rumbo = validarRumbo(lecturaRumbo, ahora)
  const modo = modoOrientacion(lectura, distancia, rumbo)
  const base = `${punto.name} está a ${spokenDistance(distancia)}`
  switch (modo) {
    case "sin-direccion":
      return {
        modo,
        relativa: null,
        indicacion: `${base} según tu ubicación estimada, pero esa ubicación tiene un margen de error de unos ${spokenDistance(lectura.precision ?? 0)}, así que no puedo decirte hacia dónde queda. Espera una lectura más precisa o acércate.`,
      }
    case "cardinal-precision":
      return {
        modo,
        relativa: null,
        indicacion: `${base} ${cardinal(bearing)} (orientación aproximada respecto al norte; tu ubicación es imprecisa o sin precisión conocida, así que no te doy un giro).`,
      }
    case "cardinal-brujula":
      return {
        modo,
        relativa: null,
        indicacion: `${base} ${cardinal(bearing)} (orientación aproximada respecto al norte; sin brújula fiable no sé hacia dónde miras).`,
      }
    case "relativa": {
      const giro = relativeDirection(rumbo.fiable ? rumbo.grados : 0, bearing)
      return { modo, relativa: giro, indicacion: `${base} ${giro}.` }
    }
  }
}
