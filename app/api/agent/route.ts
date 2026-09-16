import { generateObject } from "ai"
import { z } from "zod"
import { routes, stations } from "@/lib/routes"
import { interpretCommand } from "@/lib/local-agent"

export const maxDuration = 30

const schema = z.object({
  reply: z
    .string()
    .describe(
      "Respuesta hablada, breve y clara, en español de Colombia. Se lee en voz alta a una persona ciega.",
    ),
  action: z
    .enum(["search", "frequent", "gps", "none"])
    .describe("La acción que la app debe ejecutar."),
  query: z
    .string()
    .describe('Estación o ruta a buscar cuando action es "search". En otros casos, cadena vacía.'),
})

const catalog = routes
  .map((r) => `${r.code}: ${r.from} hacia ${r.to}. Paradas: ${r.stops.join(", ")}.`)
  .join("\n")

const stationNames = stations.map((s) => s.name).join(", ")

const system = `Eres el asistente de voz de TransMiVoz, una app del sistema TransMilenio de Bogotá pensada para personas ciegas.
Respondes SIEMPRE en español de Colombia, con frases cortas, cálidas y fáciles de escuchar, porque tu respuesta se lee en voz alta.

Rutas disponibles:
${catalog}

Estaciones conocidas: ${stationNames}.

Cómo decidir la acción:
- Si la persona quiere ir a una estación o busca rutas (por ejemplo "quiero ir a Portal Norte", "rutas hacia la Calle 72"), usa action="search", pon en "query" el nombre de la estación mencionada y en "reply" resume en voz las rutas del catálogo que sirven, con su código.
- Si pide "mis rutas frecuentes" o "las rutas de siempre", usa action="frequent".
- Si quiere caminar, saber dónde está, la estación más cercana o menciona GPS o ubicación, usa action="gps" y en "reply" dile que vas a abrir el GPS auditivo.
- Si es un saludo, un agradecimiento o una pregunta general, usa action="none" y responde con amabilidad, recordándole que puede pedirte rutas o el GPS.

Reglas: nunca inventes rutas o estaciones que no estén en las listas. Si no encuentras una ruta para lo que pide, dilo con claridad y sugiere una estación conocida.`

export async function POST(req: Request) {
  let message = ""
  try {
    const body = (await req.json()) as { message?: string }
    message = body.message ?? ""
  } catch {
    // Cuerpo inválido: se maneja como mensaje vacío más abajo.
  }

  if (!message.trim()) {
    return Response.json({
      reply: "No te escuché bien. Toca la pantalla e inténtalo de nuevo.",
      action: "none",
      query: "",
    })
  }

  try {
    const { object } = await generateObject({
      model: "google/gemini-3.5-flash",
      schema,
      system,
      prompt: message,
    })
    return Response.json(object)
  } catch (error) {
    console.log("[v0] agent route error, using local interpreter:", error)
    // Respaldo sin nube: interpreta el comando con reglas locales para que el
    // modo asistente siga funcionando aunque el modelo no esté disponible.
    return Response.json(interpretCommand(message), { status: 200 })
  }
}
