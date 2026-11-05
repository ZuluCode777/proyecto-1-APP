/**
 * Lectura del cuerpo de una petición por STREAM con un límite real en bytes,
 * para EA-10 (#36).
 *
 * El manejador leía el cuerpo con `await req.text()`, que acumula TODO el cuerpo
 * en memoria antes de medir su tamaño, y luego comparaba `.length` (unidades de
 * código UTF-16, no bytes). Un cuerpo enorme se cargaba entero igual, y la cota
 * no era de bytes. Aquí:
 *
 * - Se lee el `ReadableStream` nativo por trozos (`getReader`), contando los
 *   BYTES que llegan. Si se superan `maxBytes`, se corta de inmediato.
 * - No se confía en `Content-Length`: la cota se aplica sobre los bytes REALES
 *   leídos, así una cabecera ausente o mentirosa no evade el límite.
 * - El texto se decodifica con `TextDecoder` sobre los bytes acumulados, de modo
 *   que un carácter UTF-8 multibyte partido entre dos trozos se arma bien.
 * - Un error o una cancelación de la lectura se reportan como resultado
 *   (`error`), no como excepción: el manejador responde 400 sin provocar 500 ni
 *   dejar el stream abierto.
 *
 * Es una función pura sobre el `ReadableStream`, sin dependencias de Next ni del
 * DOM, para poder probar trozos, UTF-8 partido, desbordes y fallos de lectura
 * con streams sintéticos.
 */

/**
 * Resultado de leer el cuerpo, como unión discriminada por `kind` para que el
 * manejador no pueda confundir un cuerpo válido con uno desbordado o fallido.
 *
 * - `ok`: el cuerpo cabe en la cota; `texto` es el cuerpo decodificado (UTF-8).
 * - `excedido`: se superó `maxBytes`; corresponde responder 413.
 * - `error`: la lectura falló o se canceló; corresponde responder 400.
 */
export type LecturaCuerpo =
  | { kind: "ok"; texto: string }
  | { kind: "excedido" }
  | { kind: "error" }

/**
 * Libera el lector sin BLOQUEAR la respuesta. No se espera `cancel()`: sobre un
 * cuerpo clonado/tee'd (p. ej. `ReadableStream.tee()`), `cancel()` de una rama
 * espera a que la otra también se cancele, y esa espera podría dejar el 413 o el
 * 400 pendientes para siempre. Por eso se dispara la cancelación y se ignora su
 * resultado, y se suelta el candado del lector para no retener el stream.
 */
function liberarLector(lector: ReadableStreamDefaultReader<Uint8Array>): void {
  lector.cancel().catch(() => {})
  try {
    lector.releaseLock()
  } catch {
    // El candado puede estar ya liberado por la cancelación; no es un fallo.
  }
}

/**
 * Lee `cuerpo` acumulando como máximo `maxBytes` bytes. Si `cuerpo` es `null`
 * (petición sin cuerpo) devuelve texto vacío. Nunca lanza: los fallos se
 * devuelven como `{ kind: "error" }` tras disparar la liberación del stream.
 */
export async function leerCuerpoLimitado({
  cuerpo,
  maxBytes,
}: {
  cuerpo: ReadableStream<Uint8Array> | null
  maxBytes: number
}): Promise<LecturaCuerpo> {
  if (!cuerpo) return { kind: "ok", texto: "" }

  const lector = cuerpo.getReader()
  const trozos: Uint8Array[] = []
  let bytes = 0

  try {
    for (;;) {
      const { done, value } = await lector.read()
      if (done) break
      if (!value) continue
      bytes += value.byteLength
      if (bytes > maxBytes) {
        // Desborde: se corta antes de acumular más y se libera el stream sin
        // esperar la cancelación, para no dejar el 413 pendiente.
        liberarLector(lector)
        return { kind: "excedido" }
      }
      trozos.push(value)
    }
  } catch {
    // Error o cancelación de la lectura: se libera el stream y se reporta sin
    // lanzar, para que el manejador responda 400 y no 500.
    liberarLector(lector)
    return { kind: "error" }
  }

  // Decodifica UTF-8 sobre los bytes completos: un carácter multibyte partido
  // entre trozos se arma correctamente al concatenar antes de decodificar.
  const total = new Uint8Array(bytes)
  let desplazamiento = 0
  for (const trozo of trozos) {
    total.set(trozo, desplazamiento)
    desplazamiento += trozo.byteLength
  }
  try {
    const texto = new TextDecoder("utf-8", { fatal: false }).decode(total)
    return { kind: "ok", texto }
  } catch {
    return { kind: "error" }
  }
}
