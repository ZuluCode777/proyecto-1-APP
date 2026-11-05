import { NextResponse, type NextRequest } from "next/server"
import { decidirAccesoDeEntorno, respuestaDeDecision } from "@/lib/autenticacion"

/**
 * Pide la clave de la app con HTTP Basic. Protege la app cuando se publica con
 * Tailscale Funnel o un proxy equivalente.
 *
 * EA-10 (#36): con secreto configurado responde 401 sin credencial o con
 * credencial incorrecta y deja pasar la correcta; sin secreto utilizable
 * (ausente, vacío o solo espacios) la app NO queda abierta en producción (503).
 *
 * `/api/agent` se EXCLUYE de este `proxy` (ver `config.matcher`): en Next 16 el
 * `proxy` hace que el servidor clone y almacene en memoria el cuerpo de la
 * petición para poder leerlo dos veces, esperando a terminar la carga antes del
 * manejador; eso vaciaría la cota de bytes por stream de `/api/agent`. Para que
 * la cota actúe sobre el cuerpo real, esa ruta no pasa por aquí y aplica la
 * MISMA guardia de acceso dentro de su manejador (`decidirAccesoDeEntorno`), así
 * la protección de toda la app sigue siendo equivalente.
 */
export function proxy(solicitud: NextRequest) {
  const decision = decidirAccesoDeEntorno({ autorizacion: solicitud.headers.get("authorization") })
  if (decision.kind === "permitido") return NextResponse.next()

  const { estado, cuerpo, cabeceras } = respuestaDeDecision(decision)
  return new NextResponse(cuerpo, { status: estado, headers: cabeceras })
}

/**
 * Rutas que pasan por el `proxy`: TODAS salvo EXACTAMENTE `/api/agent` (con o sin
 * barra final) y los recursos estáticos internos de Next. La exclusión se ancla
 * a esa ruta exacta —no a un prefijo— para no abrir un hueco: variantes como
 * `/api/agentx` o `/api/agent/sub` SÍ pasan por el `proxy`. `/api/agent` se
 * excluye para que su cuerpo no se clone; su manejador aplica la misma guardia.
 */
export const config = {
  matcher: ["/((?!api/agent(?:/)?(?:\\?.*)?$|_next/static|_next/image|favicon.ico).*)"],
}
