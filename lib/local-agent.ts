import { searchRoutes, stations } from "@/lib/routes"

export type AgentAction = "search" | "frequent" | "gps" | "none"

export type AgentReply = {
  reply: string
  action: AgentAction
  query: string
}

const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()

const GPS_WORDS = [
  "gps",
  "ubicacion",
  "donde estoy",
  "cerca",
  "cercana",
  "cercanas",
  "caminar",
  "caminando",
  "estacion mas cercana",
  "llevame",
  "guiame",
  "a pie",
]

const FREQUENT_WORDS = ["frecuente", "frecuentes", "siempre", "favorita", "favoritas", "de siempre"]

/**
 * Interpreta un comando de voz sin depender de la nube.
 * Sirve como respaldo del agente de IA para que el modo asistente
 * siga funcionando aunque no haya conexión o el modelo no esté disponible.
 */
export function interpretCommand(text: string): AgentReply {
  const raw = text.trim()
  const t = normalize(raw)

  if (!t) {
    return {
      reply: "No te escuché bien. Toca la pantalla e inténtalo de nuevo.",
      action: "none",
      query: "",
    }
  }

  if (GPS_WORDS.some((w) => t.includes(w))) {
    return {
      reply: "Voy a abrir el GPS auditivo para guiarte a la estación más cercana.",
      action: "gps",
      query: "",
    }
  }

  if (FREQUENT_WORDS.some((w) => t.includes(w))) {
    return {
      reply: "Estas son tus rutas frecuentes.",
      action: "frequent",
      query: "",
    }
  }

  // Detecta si mencionó una estación conocida para afinar la búsqueda.
  const matchedStation = stations.find((s) => t.includes(normalize(s.name)))
  const query = matchedStation ? matchedStation.name : raw
  const found = searchRoutes(query)

  if (found.length === 0) {
    return {
      reply: `No encontré rutas para ${query}. Prueba con una estación como Portal Norte, Calle 72 o Ricaurte.`,
      action: "none",
      query: "",
    }
  }

  const codes = found.map((r) => r.code).join(", ")
  const count = found.length
  return {
    reply: `Encontré ${count} ${count === 1 ? "ruta" : "rutas"} para ${query}: ${codes}. Te muestro los detalles.`,
    action: "search",
    query,
  }
}
