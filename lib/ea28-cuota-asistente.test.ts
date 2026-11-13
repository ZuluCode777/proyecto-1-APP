import assert from "node:assert/strict"
import test from "node:test"
import { LIMITE_ASISTENTE, MARGEN, SEGUNDOS_POR_TURNO, TELEFONOS_FERIA, VENTANA_ASISTENTE_MS } from "./cuota-asistente"
import { claveCliente } from "./identidad-cliente"
import { createRateLimiter } from "./rate-limit"

/**
 * EA-28 (#75): la cuota compartida del asistente alcanza para todos los teléfonos
 * de la feria al ritmo máximo a la vez, con margen, y el exceso sigue siendo 429.
 * Usa el limitador real con un reloj inyectado, sin esperar un minuto.
 */

const picoPorTelefono = 60 / SEGUNDOS_POR_TURNO
const picoTotal = TELEFONOS_FERIA * picoPorTelefono

test("el límite sale de la fórmula y deja margen sobre el pico total de la feria", () => {
  assert.equal(LIMITE_ASISTENTE, Math.ceil(picoTotal * MARGEN))
  assert.ok(LIMITE_ASISTENTE >= picoTotal * MARGEN, "no se queda por debajo del margen")
  assert.ok(LIMITE_ASISTENTE > picoTotal, "supera el pico total")
  assert.ok(LIMITE_ASISTENTE > 20, "supera el límite de 20 con que la cuota se agotaba con tres teléfonos")
})

test("todos los teléfonos al ritmo máximo en el mismo minuto no reciben 429; el siguiente al límite sí, con Retry-After", () => {
  let ahora = 0
  const limite = createRateLimiter({ limit: LIMITE_ASISTENTE, windowMs: VENTANA_ASISTENTE_MS, now: () => ahora })
  const clave = claveCliente()

  // Cada teléfono manda su pico repartido en el minuto; todos comparten la clave.
  for (let turno = 0; turno < picoPorTelefono; turno++) {
    for (let telefono = 0; telefono < TELEFONOS_FERIA; telefono++) {
      ahora = Math.floor((turno * 60_000) / picoPorTelefono) + telefono
      assert.equal(limite(clave).allowed, true, `teléfono ${telefono + 1}, turno ${turno + 1}`)
    }
  }

  // El resto del margen se agota sin 429 y la petición número límite + 1 se rechaza.
  ahora = 59_000
  for (let i = picoTotal + 1; i <= LIMITE_ASISTENTE; i++) assert.equal(limite(clave).allowed, true, `petición ${i}`)
  const exceso = limite(clave)
  assert.equal(exceso.allowed, false)
  assert.ok(exceso.retryAfterSeconds >= 1 && exceso.retryAfterSeconds <= 60, "Retry-After dentro de la ventana")
  assert.equal("motivo" in exceso && exceso.motivo, "ventana", "el rechazo es por exceso de la clave, no por cardinalidad")

  // Pasada la ventana la cuota vuelve entera.
  ahora = VENTANA_ASISTENTE_MS + 1_000
  assert.equal(limite(clave).allowed, true)
})
