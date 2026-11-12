import { createHash } from "node:crypto"
import {
  CartografiaRechazada,
  aMetros,
  distanciaASegmento,
  exigir,
  posicion,
  validarCartografiaMetro,
  type CartografiaMetro,
  type Posicion,
} from "@/lib/metro-cartografia-validacion"

/**
 * Importación de la cartografía del Metro desde sus fuentes oficiales (EA-24,
 * #50). Solo lo usan `scripts/sync-metro-cartografia.ts`,
 * `scripts/analisis-metro-cartografia.ts` y las pruebas: no llega al navegador.
 */

const SERVICIO = "https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/movilidad/metrobogota/MapServer"
export const CATALOGO_DATOS_ABIERTOS = "https://datosabiertos.bogota.gov.co"

export type FuenteCartografia = { ficha: string; capa: string; parametros: Record<string, string> }

/** La Línea 1 se elige por atributo: el nombre de la capa no basta. */
export const FUENTES_CARTOGRAFIA = {
  trazado: {
    ficha: "trazado-primera-linea-del-metro-de-bogota",
    capa: `${SERVICIO}/1`,
    parametros: { where: "LINEA='Primera'", outFields: "OBJECTID,NOMBRE,LINEA", outSR: "4326", f: "json" },
  },
  estaciones: {
    ficha: "estaciones-de-la-primera-linea-del-metro-de-bogota",
    capa: `${SERVICIO}/0`,
    parametros: { where: "LINEAS='Primera'", outFields: "OBJECTID,NUMERO,NOMBRE,NOMALTE,TIPO,LINEAS,ESTADO", outSR: "4326", f: "json" },
  },
} satisfies Record<string, FuenteCartografia>

/** La URL exacta que se pide; es la misma que queda en la procedencia. */
export const urlConsulta = ({ capa, parametros }: FuenteCartografia) => `${capa}/query?${new URLSearchParams(parametros)}`
export const urlFicha = ({ ficha }: FuenteCartografia) => `${CATALOGO_DATOS_ABIERTOS}/api/3/action/package_show?id=${ficha}`

/** Tolerancia de la simplificación del trazado, en metros. */
export const TOLERANCIA_M = 1
const DECIMALES = 6
const redondear = ([lon, lat]: Posicion): Posicion => [Number(lon.toFixed(DECIMALES)), Number(lat.toFixed(DECIMALES))]

/** Douglas-Peucker: quita los vértices que se apartan menos de `tolerancia` metros de la línea que queda. */
export function simplificar(linea: Posicion[], tolerancia: number): Posicion[] {
  const p = linea.map(aMetros)
  const conservar = new Set([0, linea.length - 1])
  const pila: [number, number][] = [[0, linea.length - 1]]
  while (pila.length) {
    const [i, j] = pila.pop()!
    let lejos = -1
    let maxima = tolerancia
    for (let k = i + 1; k < j; k++) {
      const d = distanciaASegmento(p[k], p[i], p[j])
      if (d > maxima) [maxima, lejos] = [d, k]
    }
    if (lejos > 0) {
      conservar.add(lejos)
      pila.push([i, lejos], [lejos, j])
    }
  }
  return linea.filter((_, k) => conservar.has(k))
}

type RespuestaArcgis = {
  error?: unknown
  spatialReference?: { wkid?: number }
  exceededTransferLimit?: boolean
  features?: { attributes?: Record<string, unknown>; geometry?: { paths?: unknown[][]; rings?: unknown[][] } }[]
}

function entidades(respuesta: unknown, capa: string) {
  const r = (respuesta ?? {}) as RespuestaArcgis
  exigir(!r.error && Array.isArray(r.features), `${capa}: el servicio no devolvió entidades`)
  exigir(r.spatialReference?.wkid === 4326, `${capa}: se pidió EPSG:4326 y la respuesta declara wkid ${r.spatialReference?.wkid}`)
  exigir(!r.exceededTransferLimit, `${capa}: la respuesta llegó truncada`)
  return r.features
}

/** La cartografía importada y lo que hace falta para anotar los cambios hechos a la fuente. */
export type CartografiaImportada = CartografiaMetro & { nombreTrazado: string; verticesTrazadoFuente: number }

/**
 * Convierte las respuestas REST del trazado y de las estaciones (`f=json`,
 * `outSR=4326`) en la cartografía versionada. Rechaza lo que no sea EPSG:4326,
 * cualquier entidad que no sea de la Línea 1 (la capa llamada «primera línea»
 * llegó a devolver también la segunda) y la geometría fuera de Bogotá.
 */
export function importarCartografiaMetro(respuestaTrazado: unknown, respuestaEstaciones: unknown): CartografiaImportada {
  const lineas = entidades(respuestaTrazado, "trazado")
  const nombres = lineas.map((f) => String(f.attributes?.LINEA))
  exigir(lineas.length === 1 && nombres[0] === "Primera", `trazado: se esperaba solo la Línea 1 («Primera») y llegó ${nombres.join(", ") || "nada"}`)
  const tramos = lineas[0].geometry?.paths ?? []
  exigir(tramos.length === 1, `trazado: se esperaba una trayectoria y llegaron ${tramos.length}`)
  const trazado = simplificar(tramos[0].map((p) => posicion(p, "trazado")), TOLERANCIA_M).map(redondear)

  const huellas = entidades(respuestaEstaciones, "estaciones")
    .map((f) => {
      const a = f.attributes ?? {}
      exigir(a.LINEAS === "Primera", `estaciones: «${a.NOMBRE}» es de la línea «${a.LINEAS}», no de la Línea 1`)
      const anillos = f.geometry?.rings ?? []
      exigir(anillos.length === 1, `estación ${a.NUMERO}: se esperaba un anillo y llegaron ${anillos.length}`)
      return { id: `E${a.NUMERO}`, nombreFuente: String(a.NOMBRE), huella: anillos[0].map((p) => redondear(posicion(p, `estación ${a.NUMERO}`))) }
    })
    .sort((x, y) => x.id.localeCompare(y.id))

  validarCartografiaMetro({ trazado, huellas })
  return { trazado, huellas, nombreTrazado: String(lineas[0].attributes?.NOMBRE), verticesTrazadoFuente: tramos[0].length }
}

/**
 * Comprueba en la ficha de Datos Abiertos (`package_show`) que la licencia es
 * CC BY 4.0 y que cubre la capa REST consultada. Devuelve la fecha del dato.
 */
export function fechaDeFichaConLicencia(ficha: unknown, urlCapa: string): string {
  const r = ((ficha ?? {}) as { result?: { license_id?: string; inf_citation_date?: string; resources?: { url?: string }[] } }).result
  exigir(r?.license_id === "CC-BY-4.0", `la ficha de ${urlCapa} declara la licencia «${r?.license_id}», no CC BY 4.0`)
  exigir(r.resources?.some((recurso) => recurso.url === urlCapa), `la ficha con licencia no enumera la capa ${urlCapa}`)
  exigir(/^\d{4}-\d{2}-\d{2}$/.test(r.inf_citation_date ?? ""), `la ficha de ${urlCapa} no trae la fecha del dato`)
  return r.inf_citation_date!
}

// ---------------------------------------------------------------------------
// Archivo versionado: geometría y procedencia.
// ---------------------------------------------------------------------------

/** Lo que se descarga de una fuente: el cuerpo de la consulta REST y su ficha del catálogo. */
export type Descarga = { cuerpo: string; ficha: unknown }

const sha256 = (texto: string) => createHash("sha256").update(texto).digest("hex")
const entidad = (tipo: string, propiedades: object, geometry: object) => ({ type: "Feature", properties: { tipo, linea: "Primera", ...propiedades }, geometry })

/**
 * Arma `data/metro-cartografia.json` a partir de lo descargado. Los cambios
 * hechos a la fuente y los conteos salen de la propia importación, no de un
 * texto escrito a mano.
 */
export function construirArchivo(trazado: Descarga, estaciones: Descarga, consultado: string) {
  const fechaDato = fechaDeFichaConLicencia(trazado.ficha, FUENTES_CARTOGRAFIA.trazado.capa)
  const fechaEstaciones = fechaDeFichaConLicencia(estaciones.ficha, FUENTES_CARTOGRAFIA.estaciones.capa)
  exigir(fechaDato === fechaEstaciones, `las fichas declaran fechas de dato distintas: ${fechaDato} y ${fechaEstaciones}`)
  const c = importarCartografiaMetro(JSON.parse(trazado.cuerpo), JSON.parse(estaciones.cuerpo))
  const procedencia = (fuente: FuenteCartografia, cuerpo: string) => ({
    catalogo: `${CATALOGO_DATOS_ABIERTOS}/dataset/${fuente.ficha}`,
    consulta: urlConsulta(fuente),
    sha256: sha256(cuerpo),
  })
  return {
    type: "FeatureCollection",
    procedencia: {
      entidad: "Empresa Metro de Bogotá S.A. (EMB)",
      publicador: "Datos Abiertos Bogotá / IDECA",
      licencia: "CC BY 4.0",
      licenciaUrl: "https://creativecommons.org/licenses/by/4.0/",
      fechaDato,
      consultado,
      crs: "EPSG:4326, pedido al servicio con outSR=4326; pares [longitud, latitud]",
      cambios: [
        `trazado simplificado con tolerancia de ${TOLERANCIA_M} m (de ${c.verticesTrazadoFuente} a ${c.trazado.length} vértices)`,
        `coordenadas redondeadas a ${DECIMALES} decimales`,
      ],
      trazado: { ...procedencia(FUENTES_CARTOGRAFIA.trazado, trazado.cuerpo), verticesFuente: c.verticesTrazadoFuente, vertices: c.trazado.length },
      estaciones: { ...procedencia(FUENTES_CARTOGRAFIA.estaciones, estaciones.cuerpo), entidades: c.huellas.length, vertices: c.huellas.reduce((n, h) => n + h.huella.length, 0) },
    },
    features: [
      entidad("trazado", { nombreFuente: c.nombreTrazado }, { type: "LineString", coordinates: c.trazado }),
      ...c.huellas.map((h) => entidad("huella_estacion", { id: h.id, nombreFuente: h.nombreFuente }, { type: "Polygon", coordinates: [h.huella] })),
    ],
  }
}

export type ArchivoCartografia = ReturnType<typeof construirArchivo>

/** Una entidad por línea: el archivo queda legible en un diff sin ocupar miles de líneas. */
export function serializarArchivo(archivo: ArchivoCartografia): string {
  const lineas = archivo.features.map((f) => `    ${JSON.stringify(f)}`).join(",\n")
  const texto = `${JSON.stringify({ ...archivo, features: [] }, null, 2).replace('"features": []', () => `"features": [\n${lineas}\n  ]`)}\n`
  exigir(JSON.stringify(JSON.parse(texto)) === JSON.stringify(archivo), "el archivo escrito no coincide con el que se armó")
  return texto
}

/**
 * Qué cambió entre el archivo guardado y el que saldría hoy de la fuente. La
 * fecha de consulta no cuenta. Vacío si el archivo guardado sigue siendo fiel.
 */
export function diferenciasConFuente(guardado: ArchivoCartografia, actual: ArchivoCartografia): string[] {
  const diferencias: string[] = []
  for (const capa of ["trazado", "estaciones"] as const) {
    const [antes, ahora] = [guardado.procedencia[capa], actual.procedencia[capa]]
    if (antes.sha256 !== ahora.sha256) diferencias.push(`${capa}: la respuesta de la fuente cambió (SHA-256 ${antes.sha256} guardado, ${ahora.sha256} hoy)`)
    if (antes.consulta !== ahora.consulta) diferencias.push(`${capa}: la consulta guardada no es la que se hace hoy`)
  }
  const sinFecha = (a: ArchivoCartografia) => JSON.stringify({ ...a, procedencia: { ...a.procedencia, consultado: "" } })
  if (sinFecha(guardado) !== sinFecha(actual)) diferencias.push("la geometría o la procedencia guardadas no son las que salen hoy de la fuente")
  return diferencias
}

// ---------------------------------------------------------------------------
// Consulta de la fuente y lo que hace `pnpm sync:metro-cartografia`.
// ---------------------------------------------------------------------------

/** La fuente no respondió o respondió algo ilegible: no se pudo comprobar nada. */
export class FuenteInaccesible extends Error {}

/** GET de texto. Un fallo de red o un estado HTTP de error son `FuenteInaccesible`, sin traza. */
export async function descargarTexto(url: string, pedir: typeof fetch = fetch): Promise<string> {
  try {
    const respuesta = await pedir(url)
    if (!respuesta.ok) throw new Error(`respondió ${respuesta.status}`)
    return await respuesta.text()
  } catch (error) {
    throw new FuenteInaccesible(`${url}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** Lee JSON de una fuente. Un cuerpo que no es JSON también es `FuenteInaccesible`. */
export function leerJsonDeFuente(texto: string, url: string): unknown {
  try {
    return JSON.parse(texto)
  } catch {
    throw new FuenteInaccesible(`${url}: la respuesta no es JSON`)
  }
}

/**
 * Códigos de salida de los scripts: 0, todo coincide; 1, la fuente difiere o ya no
 * supera la verificación; 2, no se pudo comprobar (argumento desconocido, fuente
 * inaccesible o archivo guardado ilegible).
 */
export type ResultadoSync = { codigo: 0 | 1 | 2; mensaje: string; escribir?: string }

const USO = "Uso: pnpm sync:metro-cartografia [--check]"

/**
 * Lo que hace `pnpm sync:metro-cartografia`, sin tocar la red ni el disco por su
 * cuenta: `descargar` trae cada URL, `guardado` lee el archivo actual y el
 * resultado dice qué escribir. Solo hay `escribir` cuando no se pidió `--check` y
 * la fuente superó la verificación.
 */
export async function sincronizar(
  argumentos: string[],
  entorno: { descargar: (url: string) => Promise<string>; guardado: () => string; hoy: string },
): Promise<ResultadoSync> {
  // Un argumento mal escrito, como `--chek`, no debe terminar reescribiendo el archivo.
  const desconocidos = argumentos.filter((a) => a !== "--check")
  if (desconocidos.length) return { codigo: 2, mensaje: `Argumento desconocido: ${desconocidos.join(" ")}. No se consultó ni se escribió nada. ${USO}` }

  try {
    const consultar = async (fuente: FuenteCartografia): Promise<Descarga> => ({
      ficha: leerJsonDeFuente(await entorno.descargar(urlFicha(fuente)), urlFicha(fuente)),
      cuerpo: await entorno.descargar(urlConsulta(fuente)),
    })
    const [trazado, estaciones] = await Promise.all([consultar(FUENTES_CARTOGRAFIA.trazado), consultar(FUENTES_CARTOGRAFIA.estaciones)])
    leerJsonDeFuente(trazado.cuerpo, urlConsulta(FUENTES_CARTOGRAFIA.trazado))
    leerJsonDeFuente(estaciones.cuerpo, urlConsulta(FUENTES_CARTOGRAFIA.estaciones))
    const archivo = construirArchivo(trazado, estaciones, entorno.hoy)
    const resumen = `trazado de ${archivo.procedencia.trazado.vertices} vértices y ${archivo.procedencia.estaciones.entidades} huellas, dato del ${archivo.procedencia.fechaDato}`
    if (!argumentos.includes("--check")) return { codigo: 0, mensaje: `Guardados: ${resumen}.`, escribir: serializarArchivo(archivo) }

    let guardado: ArchivoCartografia
    try {
      guardado = JSON.parse(entorno.guardado())
    } catch (error) {
      return { codigo: 2, mensaje: `No se pudo leer el archivo guardado: ${error instanceof Error ? error.message : String(error)}. No se comprobó nada.` }
    }
    const diferencias = diferenciasConFuente(guardado, archivo)
    if (diferencias.length) return { codigo: 1, mensaje: `El archivo guardado ya no coincide con la fuente:\n- ${diferencias.join("\n- ")}` }
    return { codigo: 0, mensaje: `El archivo guardado coincide con la fuente: ${resumen}. Consultado el ${guardado.procedencia.consultado}; no se escribió nada.` }
  } catch (error) {
    if (error instanceof FuenteInaccesible) return { codigo: 2, mensaje: `No se pudo consultar la fuente: ${error.message}. No se comprobó ni se escribió nada.` }
    if (error instanceof CartografiaRechazada) return { codigo: 1, mensaje: `La fuente ya no supera la verificación. ${error.message}. No se escribió nada.` }
    throw error
  }
}

// ---------------------------------------------------------------------------
// Sistema local de los archivos descargables.
// ---------------------------------------------------------------------------

/**
 * Transverse Mercator inversa (serie de Krüger) con la definición de
 * `ESTACIONES.prj`: `PCS_CartMAGBOG`. Es la cuadrícula urbana de Bogotá
 * (EPSG:6247, datum MAGNA-SIRGAS) escrita sobre el elipsoide GRS80 con el semieje
 * agrandado 2550 m, que es la altura del plano de proyección.
 *
 * La app no la usa para dibujar: la geometría versionada llega ya en EPSG:4326
 * del servicio. Sirve para comprobar, con puntos de control, que los archivos
 * del sistema local y esa respuesta son la misma geometría.
 */
export function localAGeografica(este: number, norte: number, semieje = 6378137 + 2550): Posicion {
  const f = 1 / 298.257222101
  const n = f / (2 - f)
  const A = (semieje / (1 + n)) * (1 + n ** 2 / 4 + n ** 4 / 64)
  const alfa = [n / 2 - (2 * n ** 2) / 3 + (5 * n ** 3) / 16, (13 * n ** 2) / 48 - (3 * n ** 3) / 5, (61 * n ** 3) / 240]
  const beta = [n / 2 - (2 * n ** 2) / 3 + (37 * n ** 3) / 96, n ** 2 / 48 + n ** 3 / 15, (17 * n ** 3) / 480]
  const delta = [2 * n - (2 * n ** 2) / 3 - 2 * n ** 3, (7 * n ** 2) / 3 - (8 * n ** 3) / 5, (56 * n ** 3) / 15]
  const e = Math.sqrt(f * (2 - f))
  const rad = Math.PI / 180
  const [lat0, lon0, falsoEste, falsoNorte] = [4.6804861111111 * rad, -74.14659166666667 * rad, 92334.879, 109320.965]
  const serie = (coeficientes: number[], termino: (k: number) => number) => coeficientes.reduce((suma, c, j) => suma + c * termino(2 * (j + 1)), 0)
  // Arco de meridiano hasta la latitud de origen.
  const xi0 = Math.atan(Math.sinh(Math.atanh(Math.sin(lat0)) - e * Math.atanh(e * Math.sin(lat0))))
  const xi = (norte - falsoNorte) / A + xi0 + serie(alfa, (k) => Math.sin(k * xi0))
  const eta = (este - falsoEste) / A
  const xiP = xi - serie(beta, (k) => Math.sin(k * xi) * Math.cosh(k * eta))
  const etaP = eta - serie(beta, (k) => Math.cos(k * xi) * Math.sinh(k * eta))
  const chi = Math.asin(Math.sin(xiP) / Math.cosh(etaP))
  return [(lon0 + Math.atan2(Math.sinh(etaP), Math.cos(xiP))) / rad, (chi + serie(delta, (k) => Math.sin(k * chi))) / rad]
}
