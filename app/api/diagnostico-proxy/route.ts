import { decidirAccesoDeEntorno, respuestaDeDecision } from "@/lib/autenticacion"

// shortcut: sonda temporal de #40, quitar tras medir la cadena del proxy de Render

/** Únicas cabeceras que devuelve la sonda, tal como llegan: la cadena del proxy que se mide en #40. */
const CABECERAS_DEL_PROXY = [
  "x-forwarded-for",
  "x-real-ip",
  "cf-connecting-ip",
  "true-client-ip",
  "forwarded",
  "x-forwarded-proto",
  "x-forwarded-host",
] as const

/**
 * Devuelve en JSON solo esas cabeceras de la petición (`null` si falta). No lee
 * el cuerpo, ni el entorno, ni escribe nada. El `proxy` ya exige la clave HTTP
 * Basic como en las demás rutas; aquí se repite la misma guardia porque la
 * respuesta revela la dirección del cliente y debe poder probarse sin el `proxy`.
 */
export async function GET(req: Request) {
  const decision = decidirAccesoDeEntorno({ autorizacion: req.headers.get("authorization") })
  if (decision.kind !== "permitido") {
    const { estado, cuerpo, cabeceras } = respuestaDeDecision(decision)
    return new Response(cuerpo, { status: estado, headers: cabeceras })
  }
  const recibidas = Object.fromEntries(CABECERAS_DEL_PROXY.map((nombre) => [nombre, req.headers.get(nombre)]))
  return Response.json(recibidas, { headers: { "Cache-Control": "no-store" } })
}
