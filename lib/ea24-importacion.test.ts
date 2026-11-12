import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"
import { CARTOGRAFIA_METRO } from "./metro-cartografia"
import {
  FUENTES_CARTOGRAFIA,
  FuenteInaccesible,
  construirArchivo,
  descargarTexto,
  diferenciasConFuente,
  fechaDeFichaConLicencia,
  importarCartografiaMetro,
  serializarArchivo,
  simplificar,
  sincronizar,
  urlConsulta,
  urlFicha,
  type Descarga,
} from "./metro-cartografia-fuente"
import type { Posicion } from "./metro-cartografia-validacion"

/**
 * EA-24 (#50): la importación desde la fuente rechaza otro sistema de
 * coordenadas y las mezclas, y el archivo que arma lleva la procedencia que
 * corresponde a lo descargado. Las respuestas de prueba se arman con la
 * geometría versionada; no hay red.
 */

type Entidad = { attributes: Record<string, unknown>; geometry: { paths?: number[][][]; rings?: number[][][] } }
const respuesta = (features: Entidad[], extra: object = {}) => ({ spatialReference: { wkid: 4326, latestWkid: 4326 }, features, ...extra })
const trazadoRest = (linea = "Primera", paths: number[][][] = [CARTOGRAFIA_METRO.trazado]): Entidad => ({ attributes: { LINEA: linea, NOMBRE: "EJE PRINCIPAL" }, geometry: { paths } })
const estacionesRest = (): Entidad[] =>
  CARTOGRAFIA_METRO.huellas.map((h) => ({ attributes: { NUMERO: h.id.slice(1), NOMBRE: h.nombreFuente, LINEAS: "Primera" }, geometry: { rings: [h.huella] } }))
const importar = (trazado: unknown = respuesta([trazadoRest()]), estaciones: unknown = respuesta(estacionesRest())) => importarCartografiaMetro(trazado, estaciones)

// --- Respuestas REST ----------------------------------------------------------

test("la importación acepta las respuestas REST de la Línea 1 en 4326", () => {
  const importada = importar()
  assert.deepEqual(importada.huellas, CARTOGRAFIA_METRO.huellas)
  assert.deepEqual([importada.trazado[0], importada.trazado.at(-1)], [CARTOGRAFIA_METRO.trazado[0], CARTOGRAFIA_METRO.trazado.at(-1)])
  assert.equal(importada.verticesTrazadoFuente, CARTOGRAFIA_METRO.trazado.length)
})

test("la importación rechaza otro sistema de coordenadas", () => {
  const webMercator = { spatialReference: { wkid: 102100, latestWkid: 3857 } }
  assert.throws(() => importar(respuesta([trazadoRest()], webMercator)), /trazado: se pidió EPSG:4326/)
  assert.throws(() => importar(undefined, respuesta(estacionesRest(), webMercator)), /estaciones: se pidió EPSG:4326/)
  // Metros del sistema local o de Web Mercator declarados como 4326.
  assert.throws(() => importar(respuesta([trazadoRest("Primera", [[[87118.59, 105675.72], [101895.73, 107871.56]]])])), /no es \[longitud, latitud\]/)
  assert.throws(() => importar(respuesta([trazadoRest("Primera", [[[-8259192.1, 511731.3], [-8244083.9, 529966.7]]])])), /no es \[longitud, latitud\]/)
})

test("la importación rechaza los ejes invertidos", () => {
  const invertido = (puntos: number[][]) => puntos.map(([lon, lat]) => [lat, lon])
  assert.throws(() => importar(respuesta([trazadoRest("Primera", [invertido(CARTOGRAFIA_METRO.trazado)])])), /¿ejes invertidos/)
  const estaciones = estacionesRest()
  estaciones[4].geometry.rings = [invertido(estaciones[4].geometry.rings![0])]
  assert.throws(() => importar(undefined, respuesta(estaciones)), /estación 05: .*¿ejes invertidos/)
})

test("la importación rechaza la mezcla con la Línea 2 y las respuestas incompletas", () => {
  assert.throws(() => importar(respuesta([trazadoRest(), trazadoRest("Segunda")])), /solo la Línea 1 .* llegó Primera, Segunda/)
  assert.throws(() => importar(respuesta([trazadoRest("Segunda")])), /solo la Línea 1 .* llegó Segunda/)
  assert.throws(() => importar(respuesta([])), /llegó nada/)
  assert.throws(() => importar(respuesta([trazadoRest()], { exceededTransferLimit: true })), /truncada/)
  assert.throws(() => importar({ error: { code: 400, message: "Unable to complete operation." } }), /no devolvió entidades/)

  const deLaSegunda = estacionesRest()
  deLaSegunda[2].attributes.LINEAS = "Segunda"
  assert.throws(() => importar(undefined, respuesta(deLaSegunda)), /no de la Línea 1/)
  assert.throws(() => importar(undefined, respuesta(estacionesRest().slice(1))), /se esperaban las 16 huellas/)
  const repetida = estacionesRest()
  repetida[5].attributes.NUMERO = "05"
  assert.throws(() => importar(undefined, respuesta(repetida)), /se esperaban las 16 huellas/)
})

test("la importación rechaza una huella fuera del trazado o con el número de otra estación", () => {
  const desplazada = estacionesRest()
  desplazada[8].geometry.rings = [desplazada[8].geometry.rings![0].map(([lon, lat]) => [lon, lat + 0.003])]
  assert.throws(() => importar(undefined, respuesta(desplazada)), /E09: el trazado no pasa por su huella/)

  const cruzadas = estacionesRest()
  ;[cruzadas[2].geometry, cruzadas[12].geometry] = [cruzadas[12].geometry, cruzadas[2].geometry]
  assert.throws(() => importar(undefined, respuesta(cruzadas)), /el trazado no pasa por su huella después de la estación anterior/)
})

test("simplificar conserva los extremos y quita solo lo que se aparta menos que la tolerancia", () => {
  // 0.00001° de latitud son 1,1 m: el segundo punto se aparta 1,1 m de la recta y el tercero, 0,3 m.
  const linea: Posicion[] = [[-74.1, 4.6], [-74.099, 4.60001], [-74.098, 4.600003], [-74.097, 4.6]]
  assert.deepEqual(simplificar(linea, 1), [linea[0], linea[1], linea[3]])
  assert.deepEqual(simplificar(linea, 2), [linea[0], linea[3]])
})

// --- Licencia -------------------------------------------------------------------

const ficha = (capa: string, cambios: object = {}) => ({ result: { license_id: "CC-BY-4.0", inf_citation_date: "2022-04-18", resources: [{ url: capa }], ...cambios } })

test("la licencia se comprueba en la ficha del catálogo y debe cubrir la capa consultada", () => {
  const { capa } = FUENTES_CARTOGRAFIA.trazado
  assert.equal(fechaDeFichaConLicencia(ficha(capa), capa), "2022-04-18")
  assert.throws(() => fechaDeFichaConLicencia(ficha(capa, { license_id: "CC-BY-NC-4.0" }), capa), /no CC BY 4.0/)
  assert.throws(() => fechaDeFichaConLicencia(ficha(capa.replace(/1$/, "6")), capa), /no enumera la capa/)
  assert.throws(() => fechaDeFichaConLicencia(ficha(capa, { inf_citation_date: undefined }), capa), /fecha del dato/)
  assert.throws(() => fechaDeFichaConLicencia({ success: false }, capa), /no CC BY 4.0/)
})

// --- Archivo versionado y modo --check -------------------------------------------

const descarga = (capa: "trazado" | "estaciones", cuerpo: object, cambiosFicha: object = {}): Descarga => ({
  cuerpo: JSON.stringify(cuerpo),
  ficha: ficha(FUENTES_CARTOGRAFIA[capa].capa, cambiosFicha),
})
/** El trazado versionado con un punto intermedio en cada tramo: la fuente trae más vértices de los que quedan. */
const trazadoDenso = CARTOGRAFIA_METRO.trazado.flatMap((p, i, linea) => (i ? [[(linea[i - 1][0] + p[0]) / 2, (linea[i - 1][1] + p[1]) / 2], p] : [p]))
const descargas = () => [descarga("trazado", respuesta([trazadoRest("Primera", [trazadoDenso])])), descarga("estaciones", respuesta(estacionesRest()))] as const
const armar = (consultado = "2026-11-12") => construirArchivo(...descargas(), consultado)

test("el archivo que arma el script anota el hash, la consulta exacta, la fecha y los conteos de lo descargado", () => {
  const [trazado, estaciones] = descargas()
  const { procedencia, features } = armar()
  assert.equal(procedencia.trazado.sha256, createHash("sha256").update(trazado.cuerpo).digest("hex"))
  assert.equal(procedencia.estaciones.sha256, createHash("sha256").update(estaciones.cuerpo).digest("hex"))
  assert.equal(procedencia.trazado.consulta, urlConsulta(FUENTES_CARTOGRAFIA.trazado))
  assert.equal(new URL(procedencia.estaciones.consulta).searchParams.get("where"), "LINEAS='Primera'")
  assert.equal(procedencia.fechaDato, "2022-04-18")
  assert.equal(procedencia.consultado, "2026-11-12")

  const [linea, ...poligonos] = features
  const vertices = (linea.geometry as { coordinates: unknown[] }).coordinates.length
  assert.ok(vertices < trazadoDenso.length, "la simplificación quitó los puntos intermedios")
  assert.deepEqual(procedencia.trazado, { ...procedencia.trazado, verticesFuente: trazadoDenso.length, vertices })
  assert.ok(procedencia.cambios[0].includes(`de ${trazadoDenso.length} a ${vertices} vértices`), procedencia.cambios[0])
  assert.equal(poligonos.length, 16)
  assert.equal(procedencia.estaciones.entidades, 16)
})

test("el archivo no se arma si la licencia o las fechas de las fichas no cuadran", () => {
  const [trazado, estaciones] = descargas()
  assert.throws(() => construirArchivo(descarga("trazado", respuesta([trazadoRest()]), { license_id: "CC-BY-NC-4.0" }), estaciones, "2026-11-12"), /no CC BY 4.0/)
  assert.throws(() => construirArchivo(trazado, descarga("estaciones", respuesta(estacionesRest()), { inf_citation_date: "2024-01-19" }), "2026-11-12"), /fechas de dato distintas/)
})

test("el archivo se escribe con una entidad por línea y se lee igual", () => {
  const archivo = armar()
  const escrito = serializarArchivo(archivo)
  assert.deepEqual(JSON.parse(escrito), JSON.parse(JSON.stringify(archivo)))
  assert.equal(escrito.split("\n").filter((l) => l.startsWith('    {"type":"Feature"')).length, 17)
  assert.ok(escrito.endsWith("\n  ]\n}\n"))
})

test("--check: sin cambios no hay diferencias, y la fecha de consulta no cuenta", () => {
  assert.deepEqual(diferenciasConFuente(armar("2026-11-11"), armar("2026-12-01")), [])
})

test("--check: detecta que la fuente cambió, y que el archivo guardado se retocó a mano", () => {
  const guardado = armar()

  const movida = estacionesRest()
  movida[0].geometry.rings = [movida[0].geometry.rings![0].map(([lon, lat]) => [lon + 0.000002, lat])]
  const hoy = construirArchivo(descargas()[0], descarga("estaciones", respuesta(movida)), "2026-11-12")
  const cambios = diferenciasConFuente(guardado, hoy)
  assert.ok(cambios.some((d) => /^estaciones: la respuesta de la fuente cambió \(SHA-256/.test(d)), cambios.join(" | "))
  assert.ok(!cambios.some((d) => d.startsWith("trazado:")), "el trazado no cambió")

  const retocado = structuredClone(guardado)
  retocado.procedencia.cambios[0] = "trazado simplificado con tolerancia de 1 m (de 8494 a 999 vértices)"
  assert.deepEqual(diferenciasConFuente(retocado, guardado), ["la geometría o la procedencia guardadas no son las que salen hoy de la fuente"])

  const otraConsulta = structuredClone(guardado)
  otraConsulta.procedencia.trazado.consulta = otraConsulta.procedencia.trazado.consulta.replace("LINEA%3D%27Primera%27", "1%3D1")
  assert.ok(diferenciasConFuente(otraConsulta, guardado).includes("trazado: la consulta guardada no es la que se hace hoy"))
})

// --- El script: argumentos y códigos de salida -----------------------------------

/** Una fuente de mentira: responde cada URL con lo descargado, y anota lo que se le pide. */
function fuenteFalsa(cambios: Record<string, string | Error> = {}) {
  const [trazado, estaciones] = descargas()
  const cuerpos: Record<string, string | Error> = {
    [urlFicha(FUENTES_CARTOGRAFIA.trazado)]: JSON.stringify(trazado.ficha),
    [urlConsulta(FUENTES_CARTOGRAFIA.trazado)]: trazado.cuerpo,
    [urlFicha(FUENTES_CARTOGRAFIA.estaciones)]: JSON.stringify(estaciones.ficha),
    [urlConsulta(FUENTES_CARTOGRAFIA.estaciones)]: estaciones.cuerpo,
    ...cambios,
  }
  const pedidas: string[] = []
  const descargar = async (url: string) => {
    pedidas.push(url)
    const cuerpo = cuerpos[url]
    if (cuerpo instanceof Error) throw cuerpo
    return cuerpo
  }
  return { descargar, pedidas }
}
const correr = (argumentos: string[], fuente = fuenteFalsa(), guardado = () => serializarArchivo(armar("2026-11-11"))) =>
  sincronizar(argumentos, { descargar: fuente.descargar, guardado, hoy: "2026-11-12" })

test("script: un argumento desconocido no consulta ni escribe, y sale con 2", async () => {
  for (const argumentos of [["--chek"], ["--check", "--forzar"], ["check"], [""]]) {
    const fuente = fuenteFalsa()
    const resultado = await correr(argumentos, fuente)
    assert.equal(resultado.codigo, 2, argumentos.join(" "))
    assert.equal(resultado.escribir, undefined, "un `--check` mal escrito no puede reescribir el archivo")
    assert.deepEqual(fuente.pedidas, [])
    assert.match(resultado.mensaje, /^Argumento desconocido: .*Uso: pnpm sync:metro-cartografia \[--check\]$/)
  }
})

test("script: sin argumentos escribe el archivo; con --check nunca escribe", async () => {
  const escrito = await correr([])
  assert.equal(escrito.codigo, 0)
  assert.equal(escrito.escribir, serializarArchivo(armar("2026-11-12")))

  const igual = await correr(["--check"])
  assert.deepEqual([igual.codigo, igual.escribir], [0, undefined])
  assert.match(igual.mensaje, /coincide con la fuente.*Consultado el 2026-11-11; no se escribió nada/)

  const distinto = await correr(["--check"], fuenteFalsa(), () => serializarArchivo(armar()).replace("de 313 a", "de 999 a"))
  assert.deepEqual([distinto.codigo, distinto.escribir], [1, undefined])
  assert.match(distinto.mensaje, /^El archivo guardado ya no coincide con la fuente:\n- /)
})

test("script: si la fuente no responde sale con 2 y un mensaje claro, distinto de «difiere»", async () => {
  const caida = new FuenteInaccesible("https://ejemplo.invalid: fetch failed")
  for (const argumentos of [[], ["--check"]]) {
    const resultado = await correr(argumentos, fuenteFalsa({ [urlConsulta(FUENTES_CARTOGRAFIA.trazado)]: caida }))
    assert.deepEqual([resultado.codigo, resultado.escribir], [2, undefined])
    assert.equal(resultado.mensaje, "No se pudo consultar la fuente: https://ejemplo.invalid: fetch failed. No se comprobó ni se escribió nada.")
  }
  // Una página de error en lugar de JSON tampoco es «difiere».
  const html = await correr(["--check"], fuenteFalsa({ [urlFicha(FUENTES_CARTOGRAFIA.estaciones)]: "<html>503</html>" }))
  assert.equal(html.codigo, 2)
  assert.match(html.mensaje, /la respuesta no es JSON/)
  // Ni un archivo guardado ilegible.
  const roto = await correr(["--check"], fuenteFalsa(), () => "{")
  assert.equal(roto.codigo, 2)
  assert.match(roto.mensaje, /^No se pudo leer el archivo guardado: /)
})

test("script: una fuente que ya no supera la verificación sale con 1 y no escribe", async () => {
  const sinLicencia = JSON.stringify(ficha(FUENTES_CARTOGRAFIA.trazado.capa, { license_id: "CC-BY-NC-4.0" }))
  const conLinea2 = JSON.stringify(respuesta([trazadoRest(), trazadoRest("Segunda")]))
  for (const [url, cuerpo, motivo] of [
    [urlFicha(FUENTES_CARTOGRAFIA.trazado), sinLicencia, /no CC BY 4.0/],
    [urlConsulta(FUENTES_CARTOGRAFIA.trazado), conLinea2, /solo la Línea 1/],
  ] as const) {
    for (const argumentos of [[], ["--check"]]) {
      const resultado = await correr(argumentos, fuenteFalsa({ [url]: cuerpo }))
      assert.deepEqual([resultado.codigo, resultado.escribir], [1, undefined])
      assert.match(resultado.mensaje, /^La fuente ya no supera la verificación\. /)
      assert.match(resultado.mensaje, motivo)
    }
  }
})

test("script: un defecto del propio código no se disfraza de fuente caída", async () => {
  await assert.rejects(correr([], fuenteFalsa({ [urlConsulta(FUENTES_CARTOGRAFIA.trazado)]: new TypeError("defecto") })), /defecto/)
})

test("descargarTexto: un fallo de red o un estado de error son FuenteInaccesible, con la URL", async () => {
  const pedir = (respuesta: () => Promise<Response>) => descargarTexto("https://ejemplo.invalid/x", respuesta as typeof fetch)
  assert.equal(await pedir(async () => new Response("hola")), "hola")
  await assert.rejects(pedir(async () => new Response("", { status: 503 })), (e) => e instanceof FuenteInaccesible && e.message === "https://ejemplo.invalid/x: respondió 503")
  await assert.rejects(pedir(async () => Promise.reject(new TypeError("fetch failed"))), (e) => e instanceof FuenteInaccesible && e.message === "https://ejemplo.invalid/x: fetch failed")
})
