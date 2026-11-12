/**
 * Guarda en `data/metro-cartografia.json` el trazado y las huellas de estación de
 * la Línea 1 del Metro, con su procedencia (EA-24, #50).
 *
 * Solo hace consultas GET públicas a Catastro/IDECA y a Datos Abiertos Bogotá.
 * Si la licencia, el sistema de coordenadas o la línea no son los verificados,
 * falla y no escribe nada.
 *
 * Uso: pnpm sync:metro-cartografia            descarga y escribe el archivo
 *      pnpm sync:metro-cartografia --check    compara el archivo guardado con la
 *                                             fuente, sin escribir
 *
 * Sale con 0 si todo coincide, con 1 si la fuente difiere o ya no supera la
 * verificación, y con 2 si no se pudo comprobar: argumento desconocido, fuente
 * inaccesible o archivo guardado ilegible.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { descargarTexto, sincronizar } from "@/lib/metro-cartografia-fuente"

const ARCHIVO = new URL("../data/metro-cartografia.json", import.meta.url)

const { codigo, mensaje, escribir } = await sincronizar(process.argv.slice(2), {
  descargar: descargarTexto,
  guardado: () => readFileSync(ARCHIVO, "utf8"),
  hoy: new Date().toLocaleDateString("sv-SE", { timeZone: "America/Bogota" }),
})
if (escribir) writeFileSync(ARCHIVO, escribir)
if (codigo) console.error(mensaje)
else console.log(mensaje)
process.exit(codigo)
