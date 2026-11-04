import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { mensajeMotor } from "./estado-motor"

/**
 * Regresión del issue #34 (EA-08, decisión C): el estado del motor en el
 * diagnóstico se basa en la SALUD de `GET /api/agent` (reachable + hasModel), no
 * en el `engine` de una respuesta `POST`. Un modelo SANO nunca debe producir un
 * aviso de fallo («no respondió» o «no interpretó a tiempo»); un modelo caído o
 * sin su modelo SÍ debe avisarse.
 */

const DET = "plan verificado 8 G"

test("C: solo reglas configuradas → «Motor: reglas locales», sin aviso de Ollama", () => {
  const msg = mensajeMotor({ engine: "reglas" }, DET)
  assert.match(msg, /Motor: reglas locales/)
  assert.doesNotMatch(msg, /Ollama/)
})

test("C: Ollama sano (reachable + hasModel) NO afirma fallo ni «no interpretó a tiempo»", () => {
  const msg = mensajeMotor({ engine: "ollama", model: "qwen2.5:3b", reachable: true, hasModel: true }, DET)
  assert.match(msg, /alcanzable y con el modelo listo/)
  assert.doesNotMatch(msg, /no interpretó/)
  assert.doesNotMatch(msg, /no respondió/)
  assert.match(msg, /qwen2\.5:3b/)
})

test("C: Ollama inalcanzable SÍ se avisa", () => {
  const msg = mensajeMotor({ engine: "ollama", model: "qwen2.5:3b", reachable: false, hasModel: false }, DET)
  assert.match(msg, /no responde/)
})

test("C: Ollama alcanzable pero sin el modelo SÍ se avisa", () => {
  const msg = mensajeMotor({ engine: "ollama", model: "qwen2.5:3b", reachable: true, hasModel: false }, DET)
  assert.match(msg, /le falta el modelo/)
})

test("C (cableado): components/diagnostics.tsx importa y usa mensajeMotor (no un literal inline)", () => {
  // Protege la decisión C a nivel de cableado: si la prueba del asistente
  // volviera a construir el mensaje a mano (p. ej. `return "Motor: ..."`), el
  // diagnóstico podría dar de nuevo avisos falsos.
  //
  // Es una comprobación de la FUENTE, no de comportamiento: la lista `CHECKS` de
  // `diagnostics.tsx` no se exporta, y la prueba del asistente (`run`) hace
  // `fetch` a `/api/agent` y `/api/transmilenio`, usa `withTimeout`, `Image`,
  // `getUserMedia` y `SpeechSynthesisUtterance`, por lo que renderizarla y
  // ejercitarla en el arnés `vm` exigiría dobles de casi todo el navegador, sin
  // dependencias nuevas no es viable. El uso de `mensajeMotor` (función pura ya
  // probada arriba) sí se comprueba sobre el código.
  const fuente = readFileSync(`${process.cwd()}/components/diagnostics.tsx`, "utf8")
  assert.match(fuente, /import \{ AgentInfoSchema, mensajeMotor \} from "@\/lib\/estado-motor"/)
  assert.match(fuente, /return mensajeMotor\(info, detalleVerificado\)/)
})
