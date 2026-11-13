/**
 * Proxy HTTPS mínimo delante de `next start`, solo para grabar el iPhone en el
 * runner: la app del iPhone exige un origen `https://` y el Simulator confía en
 * el certificado porque `demo/ios/servidor.sh` instala su autoridad con
 * `xcrun simctl keychain … add-root-cert`.
 *
 * Escucha en localhost (IPv4 e IPv6) y reenvía cada petición, con sus
 * cabeceras y su cuerpo, a 127.0.0.1:<destino>. No sigue redirecciones ni toca
 * la autenticación: la clave la comprueba la app Next.js como siempre.
 *
 * Variables: DEMO_CERT, DEMO_LLAVE (PEM), DEMO_PUERTO (8443), DEMO_DESTINO_PUERTO (3000).
 */
import { request } from "node:http"
import { createServer } from "node:https"
import { readFileSync } from "node:fs"

const PUERTO = Number(process.env.DEMO_PUERTO ?? 8443)
const DESTINO = Number(process.env.DEMO_DESTINO_PUERTO ?? 3000)
const opciones = { cert: readFileSync(process.env.DEMO_CERT), key: readFileSync(process.env.DEMO_LLAVE) }

function reenviar(entrada, salida) {
  const peticion = request(
    { host: "127.0.0.1", port: DESTINO, method: entrada.method, path: entrada.url, headers: entrada.headers },
    (respuesta) => {
      salida.writeHead(respuesta.statusCode ?? 502, respuesta.headers)
      respuesta.pipe(salida)
    },
  )
  peticion.on("error", (error) => {
    console.error(`[proxy] ${entrada.method} ${entrada.url}: ${error.message}`)
    if (!salida.headersSent) salida.writeHead(502, { "content-type": "text/plain; charset=utf-8" })
    salida.end("El backend no responde.")
  })
  entrada.pipe(peticion)
}

for (const host of ["127.0.0.1", "::1"]) {
  createServer(opciones, (entrada, salida) => {
    console.log(`[proxy] ${new Date().toISOString()} ${entrada.method} ${entrada.url}`)
    reenviar(entrada, salida)
  })
    .on("error", (error) => console.error(`[proxy] ${host}: ${error.message}`))
    .listen(PUERTO, host, () => console.log(`[proxy] https://${host.includes(":") ? `[${host}]` : host}:${PUERTO} → 127.0.0.1:${DESTINO}`))
}
