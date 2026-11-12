import { consultarAnuncios } from "@/lib/anuncios-servidor"

/**
 * Anuncios operativos oficiales de TransMilenio con el estado de la fuente
 * (EA-26, #52). El `proxy` ya exige la clave de la app, como en las demás
 * rutas. Nunca falla por la fuente: sin ella responde `sin-fuente` con 200.
 * No pasa por el modelo de lenguaje.
 */
export async function GET() {
  return Response.json(await consultarAnuncios(), { headers: { "Cache-Control": "no-store" } })
}
