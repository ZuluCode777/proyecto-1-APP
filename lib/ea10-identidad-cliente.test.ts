import assert from "node:assert/strict"
import test from "node:test"
import { CLAVE_SIN_VERIFICAR, claveCliente } from "./identidad-cliente"

/**
 * Regresión de EA-10 (#36), criterio 4: la identidad del cliente NO se deriva de
 * `x-forwarded-for`/`x-real-ip` mientras no haya un proxy verificado (pendiente
 * de EA-14/#40). Toda petición comparte una clave acotada, de modo que inventar
 * cabeceras por petición no otorga cuota propia ni infla la cardinalidad.
 */

test("la clave del cliente es siempre la clave acotada común (sin confiar en cabeceras)", () => {
  assert.equal(claveCliente(), CLAVE_SIN_VERIFICAR)
  // Llamadas repetidas devuelven la MISMA clave: no hay cardinalidad por cliente.
  assert.equal(claveCliente(), claveCliente())
})
