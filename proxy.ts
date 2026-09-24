import { NextResponse, type NextRequest } from "next/server"
import { estaAutorizado } from "@/lib/access"

/**
 * Pide la clave de la app con HTTP Basic en toda petición si `APP_PASSWORD`
 * está configurada. Protege la app cuando se publica con Tailscale Funnel.
 */
export function proxy(solicitud: NextRequest) {
  if (estaAutorizado(solicitud.headers.get("authorization"), process.env.APP_PASSWORD)) {
    return NextResponse.next()
  }
  return new NextResponse("Hace falta la clave de TransMiVoz.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="TransMiVoz", charset="UTF-8"' },
  })
}
