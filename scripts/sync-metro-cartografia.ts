/**
 * Guarda en `data/metro-cartografia.json` el trazado y las huellas de estación de
 * la Línea 1 del Metro, con su procedencia (EA-24, #50).
 *
 * Solo hace consultas GET públicas a Catastro/IDECA y a Datos Abiertos Bogotá.
 * Si la licencia, el sistema de coordenadas o la línea no son los verificados,
 * falla y no escribe nada.
 *
 * Uso: pnpm sync:metro-cartografia
 */
import { createHash } from "node:crypto"
import { writeFileSync } from "node:fs"
import { TOLERANCIA_M, fechaDeFichaConLicencia, importarCartografiaMetro } from "@/lib/metro-cartografia"

const SERVICIO = "https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/movilidad/metrobogota/MapServer"
const CATALOGO = "https://datosabiertos.bogota.gov.co"

const fuentes = {
  trazado: {
    ficha: "trazado-primera-linea-del-metro-de-bogota",
    capa: `${SERVICIO}/1`,
    // La Línea 1 se elige por atributo: el nombre de la capa no basta.
    consulta: "where=LINEA='Primera'&outFields=OBJECTID,NOMBRE,LINEA&outSR=4326&f=json",
  },
  estaciones: {
    ficha: "estaciones-de-la-primera-linea-del-metro-de-bogota",
    capa: `${SERVICIO}/0`,
    consulta: "where=LINEAS='Primera'&outFields=OBJECTID,NUMERO,NOMBRE,NOMALTE,TIPO,LINEAS,ESTADO&outSR=4326&f=json",
  },
}

async function descargar(url: string): Promise<string> {
  const respuesta = await fetch(url)
  if (!respuesta.ok) throw new Error(`${url} respondió ${respuesta.status}`)
  return respuesta.text()
}

async function consultar({ ficha, capa, consulta }: (typeof fuentes)["trazado"]) {
  const url = `${capa}/query?${consulta}`
  const fechaDato = fechaDeFichaConLicencia(JSON.parse(await descargar(`${CATALOGO}/api/3/action/package_show?id=${ficha}`)), capa)
  const cuerpo = await descargar(`${capa}/query?${new URLSearchParams(consulta)}`)
  return {
    respuesta: JSON.parse(cuerpo),
    fechaDato,
    procedencia: { catalogo: `${CATALOGO}/dataset/${ficha}`, consulta: url, sha256: createHash("sha256").update(cuerpo).digest("hex") },
  }
}

const [trazado, estaciones] = await Promise.all([consultar(fuentes.trazado), consultar(fuentes.estaciones)])
if (trazado.fechaDato !== estaciones.fechaDato) throw new Error(`Las fichas declaran fechas de dato distintas: ${trazado.fechaDato} y ${estaciones.fechaDato}`)

const cartografia = importarCartografiaMetro(trazado.respuesta, estaciones.respuesta)
const verticesFuente = trazado.respuesta.features[0].geometry.paths[0].length

const entidad = (tipo: string, propiedades: object, geometry: object) => ({ type: "Feature", properties: { tipo, linea: "Primera", ...propiedades }, geometry })
const archivo = {
  type: "FeatureCollection",
  procedencia: {
    entidad: "Empresa Metro de Bogotá S.A. (EMB)",
    publicador: "Datos Abiertos Bogotá / IDECA",
    licencia: "CC BY 4.0",
    licenciaUrl: "https://creativecommons.org/licenses/by/4.0/",
    fechaDato: trazado.fechaDato,
    consultado: new Date().toLocaleDateString("sv-SE", { timeZone: "America/Bogota" }),
    crs: "EPSG:4326, pedido al servicio con outSR=4326; pares [longitud, latitud]",
    cambios: [
      `trazado simplificado con tolerancia de ${TOLERANCIA_M} m (de ${verticesFuente} a ${cartografia.trazado.length} vértices)`,
      "coordenadas redondeadas a 6 decimales",
    ],
    trazado: trazado.procedencia,
    estaciones: estaciones.procedencia,
  },
  features: [
    entidad("trazado", { nombreFuente: trazado.respuesta.features[0].attributes.NOMBRE }, { type: "LineString", coordinates: cartografia.trazado }),
    ...cartografia.huellas.map((h) => entidad("huella_estacion", { id: h.id, nombreFuente: h.nombreFuente }, { type: "Polygon", coordinates: [h.huella] })),
  ],
}

// Una entidad por línea: el archivo queda legible en un diff sin ocupar miles de líneas.
const lineas = archivo.features.map((f) => `    ${JSON.stringify(f)}`).join(",\n")
const cabecera = JSON.stringify({ type: archivo.type, procedencia: archivo.procedencia }, null, 2).slice(0, -2)
writeFileSync(new URL("../data/metro-cartografia.json", import.meta.url), `${cabecera},\n  "features": [\n${lineas}\n  ]\n}\n`)
console.log(`Guardados el trazado (${cartografia.trazado.length} vértices) y ${cartografia.huellas.length} huellas. Dato del ${trazado.fechaDato}.`)
