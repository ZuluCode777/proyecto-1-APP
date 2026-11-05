import assert from "node:assert/strict"
import test from "node:test"
import { setTimeout as esperar } from "node:timers/promises"
import { leerCuerpoLimitado } from "./cuerpo-peticion"

/**
 * Regresión de EA-10 (#36), criterio 2: el cuerpo se lee por stream con una cota
 * REAL en bytes antes de acumularlo completo. Cubre contenido fragmentado,
 * UTF-8 multibyte partido entre trozos, ausencia/engaño de Content-Length y
 * cancelación/error de lectura, sin lanzar (no 500) y sin dejar pendiente el
 * 413/400 cuando el cuerpo está clonado (`tee`).
 */

const codificar = (texto: string) => new TextEncoder().encode(texto)

/** Stream que entrega `trozos` en orden; `Content-Length` no interviene aquí. */
function streamDe(trozos: Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0
  return new ReadableStream<Uint8Array>({
    pull(controlador) {
      if (i < trozos.length) controlador.enqueue(trozos[i++])
      else controlador.close()
    },
  })
}

/** Corre una promesa con un plazo: si no resuelve, el caso falla (no cuelga). */
async function conPlazo<T>(promesa: Promise<T>, ms: number, mensaje: string): Promise<T> {
  const centinela = Symbol("plazo")
  const resultado = await Promise.race([promesa, esperar(ms, centinela)])
  assert.notEqual(resultado, centinela, mensaje)
  return resultado as T
}

test("cuerpo nulo (sin body) devuelve texto vacío", async () => {
  const r = await leerCuerpoLimitado({ cuerpo: null, maximoBytes: 100 })
  assert.deepEqual(r, { kind: "ok", texto: "" })
})

test("cuerpo dentro de la cota se arma desde varios trozos", async () => {
  const r = await leerCuerpoLimitado({ cuerpo: streamDe([codificar("hola "), codificar("mundo")]), maximoBytes: 100 })
  assert.equal(r.kind, "ok")
  assert.equal(r.kind === "ok" && r.texto, "hola mundo")
})

test("UTF-8 multibyte partido entre dos trozos se decodifica bien", async () => {
  // «ñ» son dos bytes (0xC3 0xB1); se parten entre trozos.
  const bytes = codificar("niño")
  const corte = bytes.indexOf(0xc3) + 1 // justo en medio de la «ñ»
  const r = await leerCuerpoLimitado({ cuerpo: streamDe([bytes.slice(0, corte), bytes.slice(corte)]), maximoBytes: 100 })
  assert.equal(r.kind, "ok")
  assert.equal(r.kind === "ok" && r.texto, "niño")
})

test("desborde: se supera la cota de BYTES y se corta (413), aunque haya más por leer", async () => {
  let trozosLeidos = 0
  const stream = new ReadableStream<Uint8Array>({
    pull(controlador) {
      trozosLeidos++
      controlador.enqueue(codificar("0123456789")) // 10 bytes por trozo, infinito
    },
    cancel() {},
  })
  const r = await leerCuerpoLimitado({ cuerpo: stream, maximoBytes: 25 })
  assert.equal(r.kind, "excedido")
  // No se leyó indefinidamente: con cota de 25 bastan ~3 trozos para cortar.
  assert.ok(trozosLeidos <= 4, `se cortó pronto (${trozosLeidos} trozos)`)
})

test("la cota es de BYTES, no de caracteres: un multibyte largo puede exceder con pocos caracteres", async () => {
  // 10 emojis = 40 bytes (4 bytes cada uno) pero 20 unidades UTF-16 / 10 code points.
  const texto = "😀".repeat(10)
  assert.ok(texto.length < 40, "en caracteres UTF-16 es menor que en bytes")
  const r = await leerCuerpoLimitado({ cuerpo: streamDe([codificar(texto)]), maximoBytes: 30 })
  assert.equal(r.kind, "excedido")
})

test("no se confía en Content-Length: la cota se aplica a los bytes REALES leídos", async () => {
  // El stream entrega más bytes de los que una cabecera mentirosa declararía;
  // `leerCuerpoLimitado` no mira cabeceras, solo los bytes que llegan.
  const r = await leerCuerpoLimitado({ cuerpo: streamDe([codificar("x".repeat(50))]), maximoBytes: 10 })
  assert.equal(r.kind, "excedido")
})

test("error de lectura se reporta como error (400), no lanza ni se queda colgado", async () => {
  const stream = new ReadableStream<Uint8Array>({
    pull() {
      throw new Error("fallo de lectura")
    },
  })
  const r = await leerCuerpoLimitado({ cuerpo: stream, maximoBytes: 100 })
  assert.equal(r.kind, "error")
})

test("cancelación del stream (error asíncrono) se reporta como error, no lanza", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controlador) {
      controlador.enqueue(codificar("parcial"))
      controlador.error(new Error("abortado"))
    },
  })
  const r = await leerCuerpoLimitado({ cuerpo: stream, maximoBytes: 100 })
  assert.equal(r.kind, "error")
})

test("desborde en una rama de tee() con la OTRA rama pendiente NO deja el 413 colgado", async () => {
  // Reproduce el hallazgo P1 #1: con `ReadableStream.tee()` (como el clon de
  // cuerpo de Next) `cancel()` de una rama espera a que la otra también se
  // cancele. Si `leerCuerpoLimitado` esperara `cancel()`, el 413 quedaría
  // pendiente porque la segunda rama nunca se consume. La segunda rama se deja
  // abierta a propósito; el plazo verifica que el resultado resuelve igual.
  const fuente = new ReadableStream<Uint8Array>({
    pull(controlador) {
      controlador.enqueue(codificar("0123456789"))
    },
  })
  const [rama1, _rama2] = fuente.tee()
  const r = await conPlazo(leerCuerpoLimitado({ cuerpo: rama1, maximoBytes: 25 }), 1_000, "el 413 no debe quedar pendiente por el tee")
  assert.equal(r.kind, "excedido")
})
