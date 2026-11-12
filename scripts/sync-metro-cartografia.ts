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
 *                                             fuente, sin escribir; sale con 1 si difieren
 */
import { readFileSync, writeFileSync } from "node:fs"
import {
  FUENTES_CARTOGRAFIA,
  construirArchivo,
  diferenciasConFuente,
  serializarArchivo,
  urlConsulta,
  urlFicha,
  type ArchivoCartografia,
  type Descarga,
  type FuenteCartografia,
} from "@/lib/metro-cartografia-fuente"

const ARCHIVO = new URL("../data/metro-cartografia.json", import.meta.url)

async function descargar(url: string): Promise<string> {
  const respuesta = await fetch(url)
  if (!respuesta.ok) throw new Error(`${url} respondió ${respuesta.status}`)
  return respuesta.text()
}

const consultar = async (fuente: FuenteCartografia): Promise<Descarga> => ({
  ficha: JSON.parse(await descargar(urlFicha(fuente))),
  cuerpo: await descargar(urlConsulta(fuente)),
})

const [trazado, estaciones] = await Promise.all([consultar(FUENTES_CARTOGRAFIA.trazado), consultar(FUENTES_CARTOGRAFIA.estaciones)])
const archivo = construirArchivo(trazado, estaciones, new Date().toLocaleDateString("sv-SE", { timeZone: "America/Bogota" }))
const resumen = `trazado de ${archivo.procedencia.trazado.vertices} vértices y ${archivo.procedencia.estaciones.entidades} huellas, dato del ${archivo.procedencia.fechaDato}`

if (process.argv.includes("--check")) {
  const guardado = JSON.parse(readFileSync(ARCHIVO, "utf8")) as ArchivoCartografia
  const diferencias = diferenciasConFuente(guardado, archivo)
  if (diferencias.length) {
    console.error(`El archivo guardado ya no coincide con la fuente:\n- ${diferencias.join("\n- ")}`)
    process.exit(1)
  }
  console.log(`El archivo guardado coincide con la fuente: ${resumen}. Consultado el ${guardado.procedencia.consultado}; no se escribió nada.`)
} else {
  writeFileSync(ARCHIVO, serializarArchivo(archivo))
  console.log(`Guardados: ${resumen}.`)
}
