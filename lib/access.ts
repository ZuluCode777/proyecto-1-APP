import { createHash, timingSafeEqual } from "node:crypto"

const sha256 = (text: string) => createHash("sha256").update(text).digest()

/**
 * Comprueba la cabecera `Authorization` de HTTP Basic contra la clave de la
 * app. El usuario no importa, solo la clave. Sin clave configurada, deja
 * pasar todo: así corren el desarrollo local y la integración continua.
 */
export function isAuthorized(authorization: string | null, password: string | undefined): boolean {
  if (!password) return true
  if (!authorization?.startsWith("Basic ")) return false
  const credentials = Buffer.from(authorization.slice("Basic ".length), "base64").toString("utf8")
  const colon = credentials.indexOf(":")
  if (colon === -1) return false
  // Se comparan los hashes: miden lo mismo, así que el tiempo no revela la clave.
  return timingSafeEqual(sha256(credentials.slice(colon + 1)), sha256(password))
}
