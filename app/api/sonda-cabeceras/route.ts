import { metricasDeMemoria } from "@/lib/ea14-sonda-metricas"

/**
 * SONDA TEMPORAL de EA-14 (#40), criterio 4 de EA-10 (#36): expone las cabeceras
 * de proxy que llegan a la app para medir la cadena real de `X-Forwarded-For`
 * (Cloudflare → Render → app). Solo existe en la rama `ea-14-sonda-ram`.
 *
 * - Detrás de la bandera `SONDA_CABECERAS=1`: sin ella responde 404 vacío, como
 *   si la ruta no existiera.
 * - La autenticación HTTP Basic la aplica `proxy.ts` (esta ruta no está excluida).
 * - Además devuelve cifras numéricas de memoria (proceso y cgroup) de
 *   `lib/ea14-sonda-metricas.ts` para el límite de 512 MB, sin telemetría de pago.
 * - No registra nada (las IP son datos personales) ni tiene otros efectos.
 * - NUNCA se fusiona a `main`. Borrar la rama tras medir.
 */

const CABECERAS_CRUDAS = {
  xRealIp: "x-real-ip",
  cfConnectingIp: "cf-connecting-ip",
  trueClientIp: "true-client-ip",
  xForwardedProto: "x-forwarded-proto",
  xForwardedHost: "x-forwarded-host",
  forwarded: "forwarded",
  via: "via",
  cfConnectingIpv6: "cf-connecting-ipv6",
  xEnvoyExternalAddress: "x-envoy-external-address",
  rndrId: "rndr-id",
} as const

export async function GET(solicitud: Request) {
  if (process.env.SONDA_CABECERAS !== "1") return new Response(null, { status: 404 })

  const { headers } = solicitud
  const nombres: string[] = []
  headers.forEach((_valor, nombre) => nombres.push(nombre))

  const crudas = Object.fromEntries(
    Object.entries(CABECERAS_CRUDAS).map(([clave, nombre]) => [clave, headers.get(nombre)]),
  )

  return Response.json(
    {
      xForwardedFor: headers.get("x-forwarded-for")?.split(",").map((salto) => salto.trim()) ?? null,
      ...crudas,
      // Solo nombres: nunca valores (incluye `authorization` y `cookie`).
      cabecerasPresentes: nombres.sort(),
      ...metricasDeMemoria(),
    },
    { headers: { "Cache-Control": "no-store" } },
  )
}
