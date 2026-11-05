import { NextResponse, type NextRequest } from "next/server"
import { decidirAcceso, type EntornoAcceso } from "@/lib/autenticacion"

/**
 * Pide la clave de la app con HTTP Basic en toda petición. Protege la app cuando
 * se publica con Tailscale Funnel o un proxy equivalente.
 *
 * EA-10 (#36): con secreto configurado, responde 401 sin credencial o con
 * credencial incorrecta y deja pasar la correcta. Sin secreto utilizable
 * (ausente, vacío o solo espacios) la app NO queda abierta en producción: se
 * falla cerrado con 503 y no se sirve. En desarrollo se conserva el acceso sin
 * clave. El secreto solo vive en el entorno; aquí no se registra ni se incluye
 * en las respuestas.
 */
export function proxy(solicitud: NextRequest) {
  const entorno: EntornoAcceso = process.env.NODE_ENV === "production" ? "produccion" : "desarrollo"
  const decision = decidirAcceso({
    autorizacion: solicitud.headers.get("authorization"),
    clave: process.env.APP_PASSWORD,
    entorno,
  })

  switch (decision.kind) {
    case "permitido":
      return NextResponse.next()
    case "clave-requerida":
      return new NextResponse("Hace falta la clave de TransMiVoz.", {
        status: 401,
        headers: { "WWW-Authenticate": 'Basic realm="TransMiVoz", charset="UTF-8"' },
      })
    case "cerrado-sin-clave":
      // Producción sin secreto utilizable: no se expone la app sin clave.
      return new NextResponse("TransMiVoz no está disponible: falta configurar la clave de acceso.", {
        status: 503,
      })
    default: {
      const _exhaustivo: never = decision
      return _exhaustivo
    }
  }
}
