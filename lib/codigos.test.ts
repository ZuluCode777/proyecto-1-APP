import assert from "node:assert/strict"
import test from "node:test"
import snapshot from "../data/transmilenio.json" with { type: "json" }
import { findRouteByCode, searchRoutes } from "./routes"
import { TransmilenioDataSchema } from "./transmilenio"

/**
 * Regresión del issue #32: TODOS los códigos publicados del catálogo pasan por
 * búsqueda y resolución, incluidos los 16 con la forma número-letra (8 G, 1 P…),
 * sin perder el token de un solo carácter. Reglas y modelo comparten la misma
 * resolución (`findRouteByCode`), así que basta fijar el helper y `searchRoutes`.
 */
const data = TransmilenioDataSchema.parse(snapshot)

/** Los 16 códigos número-letra publicados; su letra es un token de un carácter. */
const NUMERO_LETRA = ["1 P", "1 U", "2 M", "2 P", "3 C", "3 P", "4 H", "4 P", "5 C", "5 P", "6 C", "6 P", "7 E", "7 P", "8 G", "8 T"]

test("el catálogo publicado tiene 124 rutas y los 16 códigos número-letra", () => {
  // No es una regla de validez del catálogo (puede cambiar), sino la fijación
  // de su CONTENIDO publicado actual, como pide el issue.
  assert.equal(data.routes.length, 124)
  for (const code of NUMERO_LETRA) {
    assert.ok(data.routes.some((r) => r.code === code), `falta ${code} en la copia`)
  }
})

test("barrido: findRouteByCode resuelve los 124 códigos exactos a sí mismos", () => {
  const fallan: string[] = []
  for (const r of data.routes) {
    const hit = findRouteByCode(r.code, data)
    if (hit?.code !== r.code) fallan.push(`${r.code} → ${hit?.code ?? "(nada)"}`)
  }
  assert.deepEqual(fallan, [], `códigos que no resuelven a sí mismos: ${fallan.join(", ")}`)
})

test("barrido: searchRoutes encuentra cada código como primer resultado", () => {
  const fallan: string[] = []
  for (const r of data.routes) {
    const primero = searchRoutes(r.code, data)[0]
    if (primero?.code !== r.code) fallan.push(`${r.code} → ${primero?.code ?? "(nada)"}`)
  }
  assert.deepEqual(fallan, [], `códigos que no se encuentran: ${fallan.join(", ")}`)
})

test("los códigos número-letra se reconocen dentro de una frase, con y sin espacio", () => {
  for (const code of NUMERO_LETRA) {
    const [num, letra] = code.split(" ")
    // Con espacio ("la 8 G"), pegado ("la 8G") y en minúsculas: misma resolución.
    for (const forma of [`información de la ${num} ${letra}`, `la ${num}${letra}`, `ruta ${num} ${letra.toLowerCase()}`]) {
      assert.equal(findRouteByCode(forma, data)?.code, code, `${forma} debería resolver a ${code}`)
    }
  }
})

test("no se pierde el token de un carácter: la letra sola distingue códigos del mismo número", () => {
  // 1 P y 1 U comparten el número; solo la letra (un carácter) los separa.
  assert.equal(findRouteByCode("la 1 P", data)?.code, "1 P")
  assert.equal(findRouteByCode("la 1 U", data)?.code, "1 U")
  assert.notEqual(findRouteByCode("la 1 P", data)?.code, findRouteByCode("la 1 U", data)?.code)
})

test("también resuelve sufijos de varias letras (MP85, B12GS, M86CV, D81CV)", () => {
  for (const code of ["MP85", "B12GS", "M86CV", "D81CV", "K86CV", "F23B", "J23B"]) {
    assert.equal(findRouteByCode(`la ${code}`, data)?.code, code)
  }
})
