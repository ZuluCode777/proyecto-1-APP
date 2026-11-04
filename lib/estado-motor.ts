import { z } from "zod"

/**
 * Mensaje del estado del motor del asistente para la pantalla de diagnóstico,
 * issue #34 (EA-08, decisión C). Se basa en la SALUD declarada por
 * `GET /api/agent` (`engine`, `reachable`, `hasModel`), no en el `engine` de una
 * respuesta `POST`: con reglas-primero una frase conocida nunca llega al modelo
 * y un modelo sano que clasifica «unknown» una frase fuera de tema daría
 * `engine: reglas`, así que inferir el estado del modelo de una respuesta POST
 * produce avisos falsos («no respondió» o «no interpretó a tiempo»). Un modelo
 * caído o sin su modelo SÍ se reporta como aviso.
 *
 * Es una función pura para poder probarla sin la pantalla ni la red.
 */

/** Respuesta de `GET /api/agent`: qué motor está configurado y su salud. */
export const AgentInfoSchema = z.object({
  engine: z.enum(["reglas", "ollama"]),
  model: z.string().optional(),
  reachable: z.boolean().optional(),
  hasModel: z.boolean().optional(),
})
export type EstadoMotor = z.infer<typeof AgentInfoSchema>

export function mensajeMotor(info: EstadoMotor, detalleVerificado: string): string {
  if (info.engine !== "ollama") {
    return `Motor: reglas locales. Incertidumbre validada; ${detalleVerificado}; payload forjado rechazado.`
  }
  const modelo = `Ollama (${info.model ?? "modelo local"})`
  if (!info.reachable || !info.hasModel) {
    return `Motor: ${modelo} configurado, pero ${info.reachable ? "le falta el modelo" : "no responde"}; mientras tanto las frases conocidas las resuelven las reglas.`
  }
  return `Motor: ${modelo}, alcanzable y con el modelo listo. Las frases conocidas las resuelven las reglas; las que no entienden van al modelo. Incertidumbre validada; ${detalleVerificado}; payload forjado rechazado.`
}
