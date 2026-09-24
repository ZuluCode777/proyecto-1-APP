import { createHash, timingSafeEqual } from "node:crypto"

const sha256 = (texto: string) => createHash("sha256").update(texto).digest()

/**
 * Comprueba la cabecera `Authorization` de HTTP Basic contra la clave de la
 * app. El usuario no importa, solo la clave. Sin clave configurada, deja
 * pasar todo: así corren el desarrollo local y la integración continua.
 */
export function estaAutorizado(autorizacion: string | null, clave: string | undefined): boolean {
  if (!clave) return true
  // El esquema no distingue mayúsculas (RFC 7617).
  if (!autorizacion || !/^basic /i.test(autorizacion)) return false
  const credenciales = Buffer.from(autorizacion.slice("Basic ".length), "base64").toString("utf8")
  const separador = credenciales.indexOf(":")
  if (separador === -1) return false
  // Se comparan los hashes: miden lo mismo, así que el tiempo no revela la clave.
  return timingSafeEqual(sha256(credenciales.slice(separador + 1)), sha256(clave))
}
