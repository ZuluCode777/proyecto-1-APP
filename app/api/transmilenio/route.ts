import { getTransmilenioData } from "@/lib/transmilenio-data"

/** Estaciones y rutas troncales reales, en vivo o desde la copia guardada. */
export async function GET() {
  return Response.json(await getTransmilenioData())
}
