import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import test from "node:test"
import vm from "node:vm"
import * as jsx from "react/jsx-runtime"
import ts from "typescript"
import { distanceMeters } from "./geo"
import * as metro from "./metro"
import * as cartografia from "./metro-cartografia"
import { CARTOGRAFIA_METRO, PROCEDENCIA_MAPA_METRO, fechaDeFichaConLicencia, importarCartografiaMetro, validarCartografiaMetro, type Posicion } from "./metro-cartografia"

/**
 * EA-24 (#50): la cartografía del Metro solo entra con sistema de coordenadas y
 * licencia verificados. Los puntos de control son datos oficiales consultados el
 * 11-11-2026; la evidencia completa está en `docs/expoandes/ea-24-cartografia-metro.md`.
 */

const raiz = process.cwd()
const metros = (a: Posicion, b: Posicion) => distanceMeters({ lng: a[0], lat: a[1] }, { lng: b[0], lat: b[1] })

// --- Geometría versionada ---------------------------------------------------

test("geometría versionada: pares [longitud, latitud], dentro de Bogotá y con la cobertura de la Línea 1", () => {
  validarCartografiaMetro(CARTOGRAFIA_METRO)
  const { trazado, huellas } = CARTOGRAFIA_METRO
  for (const [lon, lat] of [...trazado, ...huellas.flatMap((h) => h.huella)]) {
    assert.ok(lon > -74.2 && lon < -74.05, `longitud ${lon}`)
    assert.ok(lat > 4.59 && lat < 4.67, `latitud ${lat}`)
  }
  // Cobertura: del extremo occidental en Bosa al norte de la calle 72.
  assert.ok(trazado[0][0] < -74.19 && trazado.at(-1)![1] > 4.66)
  const km = trazado.slice(1).reduce((suma, p, i) => suma + metros(trazado[i], p), 0) / 1000
  assert.ok(km > 23.5 && km < 24.5, `${km.toFixed(2)} km`)
})

test("las 16 huellas son las 16 estaciones del catálogo, por número", () => {
  assert.deepEqual(CARTOGRAFIA_METRO.huellas.map((h) => h.id), metro.ESTACIONES_METRO_L1.map((e) => e.idOficial))
  for (const [i, h] of CARTOGRAFIA_METRO.huellas.entries()) assert.match(h.nombreFuente, new RegExp(`^Estación ${i + 1}\\b`), h.id)
})

test("el archivo conserva fuente, consulta, fecha, sistema de coordenadas, licencia y cambios", () => {
  const p = PROCEDENCIA_MAPA_METRO
  assert.equal(p.licencia, "CC BY 4.0")
  assert.equal(p.licenciaUrl, "https://creativecommons.org/licenses/by/4.0/")
  assert.match(p.entidad, /Empresa Metro de Bogotá/)
  assert.match(p.fechaDato, /^\d{4}-\d{2}-\d{2}$/)
  assert.match(p.consultado, /^\d{4}-\d{2}-\d{2}$/)
  assert.ok(p.crs.includes("EPSG:4326") && p.crs.includes("[longitud, latitud]"))
  for (const fuente of [p.trazado, p.estaciones]) {
    assert.ok(fuente.consulta.startsWith("https://serviciosgis.catastrobogota.gov.co/") && fuente.consulta.includes("outSR=4326"), fuente.consulta)
    assert.match(fuente.consulta, /where=LINEAS?='Primera'/, "la Línea 1 se elige por atributo")
    assert.ok(fuente.catalogo.startsWith("https://datosabiertos.bogota.gov.co/dataset/"))
    assert.match(fuente.sha256, /^[0-9a-f]{64}$/)
  }
  assert.ok(p.cambios.some((c) => c.includes("simplificado")) && p.cambios.some((c) => c.includes("redondeadas")))
  // La atribución visible dice lo mismo que el archivo.
  for (const dato of [p.entidad, p.licencia, "18-04-2022", p.consultado.split("-").reverse().join("-"), ...p.cambios]) {
    assert.ok(cartografia.ATRIBUCION_MAPA_METRO.includes(dato), dato)
  }
})

// --- Transformación del sistema local, probada con puntos de control ---------

/**
 * Transverse Mercator inversa (serie de Krüger) con la definición de
 * `ESTACIONES.prj`: `PCS_CartMAGBOG`. Es la cuadrícula urbana de Bogotá
 * (EPSG:6247, datum MAGNA-SIRGAS) escrita sobre el elipsoide GRS80 con el semieje
 * agrandado 2550 m, que es la altura del plano de proyección.
 */
function localAGeografica(este: number, norte: number, semieje = 6378137 + 2550): Posicion {
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

/**
 * Puntos geodésicos oficiales: código, este y norte en el sistema local, longitud
 * y latitud MAGNA-SIRGAS. Fuente: IDECA, Mapa de Referencia, capa «Punto
 * Geodésico» (Empresa de Acueducto y Catastro), CC BY 4.0,
 * https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/Mapa_Referencia/Mapa_Referencia/MapServer/5
 */
const CONTROL_GEODESICO: [string, number, number, number, number][] = [
  ["L05-026-Z5", 86504.465, 101899.738, -74.19911527, 4.61340012],
  ["L13-014-Z5", 90225.868, 101975.978, -74.16559083, 4.61409098],
  ["L07-011-Z3", 92596.354, 107645.42, -74.14423598, 4.66534007],
  ["L13-009-Z4", 94272.788, 101375.427, -74.12913402, 4.60866234],
  ["L07-005-Z3", 96164.456, 104014.833, -74.11209179, 4.6325206],
  ["L01-032-Z3", 98651.972, 99506.848, -74.08968551, 4.59176927],
  ["L12-001-Z3", 100920.292, 99727.943, -74.06925163, 4.59376597],
  ["L11-005-Z2", 102714.559, 106897.411, -74.05307985, 4.65857225],
]

test("puntos de control geodésicos: la definición del .prj reproduce la posición oficial al centímetro", () => {
  for (const [codigo, este, norte, lon, lat] of CONTROL_GEODESICO) {
    const error = metros(localAGeografica(este, norte), [lon, lat])
    assert.ok(error < 0.02, `${codigo}: ${error.toFixed(4)} m`)
  }
})

test("puntos de control geodésicos: ignorar el plano de 2550 m se nota, así que la prueba distingue la definición", () => {
  const errores = CONTROL_GEODESICO.map(([, este, norte, lon, lat]) => metros(localAGeografica(este, norte, 6378137), [lon, lat]))
  assert.ok(Math.max(...errores) > 4, `máximo ${Math.max(...errores).toFixed(2)} m`)
})

/**
 * Primer vértice de cada estación en el GeoJSON oficial del sistema local
 * (`estaciones.geojson`, SHA-256 48ed2ef6…, sin miembro `crs`): este, norte.
 */
const VERTICES_LOCALES: [string, number, number][] = [
  ["E01", 88863.0811999999, 104966.32809999958],
  ["E02", 89482.40880000032, 103797.84600000083],
  ["E03", 90144.90799999982, 102819.80550000072],
  ["E04", 90726.80960000027, 102152.9682],
  ["E05", 91706.78340000007, 102325.66929999925],
  ["E06", 92922.23429999966, 102478.9626000002],
  ["E07", 94306.62719999999, 101410.98350000009],
  ["E08", 95207.53029999975, 100675.29770000093],
  ["E09", 96243.64910000004, 100078.60280000046],
  ["E10", 97774.0876000002, 99816.61889999919],
  ["E11", 98911.9430999998, 99732.90890000015],
  ["E12", 99707.21719999984, 100787.56389999948],
  ["E13", 100439.27749999985, 101971.60909999907],
  ["E14", 101083.97790000029, 103904.2706000004],
  ["E15", 101418.17169999983, 105884.71220000088],
  ["E16", 101757.48060000036, 107039.69969999976],
]

test("el archivo oficial del sistema local, transformado, cae sobre la geometría versionada", () => {
  // 0,15 m: el redondeo a 6 decimales mueve cada vértice hasta 8 cm.
  for (const [id, este, norte] of VERTICES_LOCALES) {
    const huella = CARTOGRAFIA_METRO.huellas.find((h) => h.id === id)!.huella
    const error = metros(localAGeografica(este, norte), huella[0])
    assert.ok(error < 0.15, `${id}: ${error.toFixed(3)} m`)
  }
  // Extremos de `trazado_plmb.geojson` (SHA-256 1b71a51d…).
  const { trazado } = CARTOGRAFIA_METRO
  assert.ok(metros(localAGeografica(87118.59229999967, 105675.71829999983), trazado[0]) < 0.15)
  assert.ok(metros(localAGeografica(101895.72829999961, 107871.5558000002), trazado.at(-1)!) < 0.15)
})

test("las coordenadas del sistema local no pasan por WGS84", () => {
  const [, este, norte] = VERTICES_LOCALES[1]
  assert.throws(() => validarCartografiaMetro({ ...CARTOGRAFIA_METRO, trazado: [[este, norte], [este + 10, norte]] }), /no es \[longitud, latitud\]/)
})

// --- Control independiente de posición ---------------------------------------

type XY = [number, number]
const xy = ([lon, lat]: Posicion): XY => [lon * 111_320 * Math.cos((4.63 * Math.PI) / 180), lat * 110_574]
const giro = (a: XY, b: XY, c: XY) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
function dPuntoSegmento(p: XY, a: XY, b: XY) {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]]
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)))
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)
}
/** Distancia en metros de un anillo a un segmento; 0 si se tocan o el segmento empieza dentro. */
function dAnilloSegmento(anillo: Posicion[], desde: Posicion, hasta: Posicion): number {
  const [r, a, b] = [anillo.map(xy), xy(desde), xy(hasta)]
  let dentro = false
  let minima = Infinity
  for (let k = 1; k < r.length; k++) {
    const [c, d] = [r[k - 1], r[k]]
    if (c[1] > a[1] !== d[1] > a[1] && a[0] < ((d[0] - c[0]) * (a[1] - c[1])) / (d[1] - c[1]) + c[0]) dentro = !dentro
    if (giro(a, b, c) * giro(a, b, d) < 0 && giro(c, d, a) * giro(c, d, b) < 0) return 0
    minima = Math.min(minima, dPuntoSegmento(c, a, b), dPuntoSegmento(d, a, b), dPuntoSegmento(a, c, d), dPuntoSegmento(b, c, d))
  }
  return dentro ? 0 : minima
}

/**
 * Tramo que el Distrito publicó para cada estación (Portal Bogotá, 20-10-2020,
 * fuente F5): corredor y vías que lo delimitan. Cada fila es el segmento del eje
 * oficial de esa vía más cercano a la huella: estación, vía, si es el corredor,
 * y sus dos extremos [longitud, latitud]. Fuente independiente de la EMB: IDECA,
 * Mapa de Referencia, capa «Malla Vial» (Catastro, IDU y Movilidad), CC BY 4.0,
 * https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/Mapa_Referencia/Mapa_Referencia/MapServer/13
 */
const CONTROL_VIAL: [string, string, boolean, number, number, number, number][] = [
  ["E01", "Av. Ciudad de Villavicencio", true, -74.176981, 4.640465, -74.177103, 4.640699],
  ["E01", "KR 94", false, -74.177493, 4.641502, -74.177518, 4.641488],
  ["E01", "KR 93", false, -74.176813, 4.640232, -74.176848, 4.640213],
  ["E02", "Av. Ciudad de Villavicencio", true, -74.171841, 4.630697, -74.171902, 4.630801],
  ["E02", "KR 86B", false, -74.170515, 4.629861, -74.170521, 4.629803],
  ["E02", "KR 86G", false, -74.171897, 4.630804, -74.171902, 4.630801],
  ["E03", "Av. Ciudad de Villavicencio", true, -74.166746, 4.62216, -74.166645, 4.622056],
  ["E03", "KR 80D", false, -74.166367, 4.621883, -74.166395, 4.621871],
  ["E03", "KR 80G", false, -74.166907, 4.622426, -74.16695, 4.622399],
  ["E04", "Av. Primero de Mayo", true, -74.159776, 4.615789, -74.159785, 4.615788],
  ["E04", "CL 42 S", false, -74.159794, 4.615849, -74.159812, 4.615937],
  ["E04", "CL 42C S", false, -74.1614, 4.615643, -74.161406, 4.615677],
  ["E05", "Av. Primero de Mayo", true, -74.151494, 4.617231, -74.151635, 4.617206],
  ["E05", "CL 40 S", false, -74.152303, 4.617032, -74.15231, 4.617083],
  ["E05", "CL 39 S", false, -74.150989, 4.617256, -74.151019, 4.617314],
  ["E06", "Av. Primero de Mayo", true, -74.140965, 4.618916, -74.141346, 4.618991],
  ["E06", "Av. Boyacá", false, -74.139741, 4.618327, -74.139853, 4.617958],
  ["E06", "KR 72C", false, -74.141836, 4.619267, -74.141803, 4.619312],
  ["E07", "Av. Primero de Mayo", true, -74.127787, 4.608157, -74.12814, 4.60851],
  ["E07", "AK 68", false, -74.128514, 4.608895, -74.12858, 4.608835],
  ["E07", "KR 52C", false, -74.127633, 4.607768, -74.12766, 4.607741],
  ["E08", "Av. Primero de Mayo", true, -74.121813, 4.603079, -74.12196, 4.603135],
  ["E08", "AK 50", false, -74.12125, 4.603113, -74.121343, 4.603059],
  ["E09", "Av. Ciudad de Quito (NQS)", true, -74.11058, 4.597345, -74.110841, 4.597224],
  ["E09", "DG 16 S", false, -74.110664, 4.597515, -74.110541, 4.597637],
  ["E09", "CL 17ABIS S", false, -74.111492, 4.597112, -74.111515, 4.597157],
  ["E10", "CL 1 (Av. de la Hortúa)", true, -74.095946, 4.593934, -74.096543, 4.594122],
  ["E10", "KR 24", false, -74.096546, 4.594123, -74.096561, 4.594077],
  ["E10", "KR 24C", false, -74.097919, 4.594548, -74.097933, 4.594505],
  ["E11", "Av. Caracas", true, -74.087286, 4.593854, -74.087272, 4.59387],
  ["E11", "CL 2", false, -74.087209, 4.593794, -74.087266, 4.593789],
  ["E11", "CL 3", false, -74.086538, 4.594444, -74.08657, 4.594455],
  ["E12", "Av. Caracas", true, -74.080516, 4.602837, -74.080509, 4.602847],
  ["E12", "CL 11", false, -74.080901, 4.601968, -74.080927, 4.601985],
  ["E12", "CL 13", false, -74.079818, 4.603479, -74.079839, 4.603497],
  ["E13", "Av. Caracas", true, -74.073869, 4.613483, -74.073866, 4.613494],
  ["E13", "CL 24A", false, -74.073936, 4.612893, -74.073961, 4.612912],
  ["E13", "CL 26", false, -74.073475, 4.614815, -74.073348, 4.61496],
  ["E14", "Av. Caracas", true, -74.068195, 4.629975, -74.068137, 4.630296],
  ["E14", "CL 42", false, -74.06799, 4.630015, -74.068018, 4.630021],
  ["E14", "CL 44", false, -74.067701, 4.631622, -74.067727, 4.631629],
  ["E15", "Av. Caracas", true, -74.064801, 4.648467, -74.064782, 4.648572],
  ["E15", "CL 61", false, -74.064761, 4.648094, -74.064798, 4.648101],
  ["E15", "CL 63", false, -74.064777, 4.649597, -74.064812, 4.649593],
  ["E16", "Av. Caracas", true, -74.061928, 4.659514, -74.061809, 4.660233],
  ["E16", "CL 72", false, -74.062009, 4.659579, -74.062493, 4.659908],
  ["E16", "CL 74", false, -74.060418, 4.661076, -74.061356, 4.661694],
]

test("puntos de control viales: cada huella está en el corredor y el tramo que publicó el Distrito", () => {
  // Medido el 11-11-2026: corredor a 30 m o menos, vías del tramo a 107 m o menos.
  // Un error de datum o de origen desplaza la geometría cientos de metros.
  assert.deepEqual([...new Set(CONTROL_VIAL.map(([id]) => id))], CARTOGRAFIA_METRO.huellas.map((h) => h.id), "hay control para las 16")
  for (const [id, via, corredor, lon1, lat1, lon2, lat2] of CONTROL_VIAL) {
    const huella = CARTOGRAFIA_METRO.huellas.find((h) => h.id === id)!.huella
    const d = dAnilloSegmento(huella, [lon1, lat1], [lon2, lat2])
    assert.ok(d <= (corredor ? 35 : 110), `${id} a ${d.toFixed(0)} m de ${via}`)
  }
})

// --- Importación ------------------------------------------------------------

type Entidad = { attributes: Record<string, unknown>; geometry: { paths?: number[][][]; rings?: number[][][] } }
const respuesta = (features: Entidad[], extra: object = {}) => ({ spatialReference: { wkid: 4326, latestWkid: 4326 }, features, ...extra })
const trazadoRest = (linea = "Primera", paths: number[][][] = [CARTOGRAFIA_METRO.trazado]): Entidad => ({ attributes: { LINEA: linea }, geometry: { paths } })
const estacionesRest = (): Entidad[] =>
  CARTOGRAFIA_METRO.huellas.map((h) => ({ attributes: { NUMERO: h.id.slice(1), NOMBRE: h.nombreFuente, LINEAS: "Primera" }, geometry: { rings: [h.huella] } }))
const importar = (trazado: unknown = respuesta([trazadoRest()]), estaciones: unknown = respuesta(estacionesRest())) => importarCartografiaMetro(trazado, estaciones)

test("la importación acepta las respuestas REST de la Línea 1 en 4326", () => {
  const importada = importar()
  assert.deepEqual(importada.huellas, CARTOGRAFIA_METRO.huellas)
  assert.deepEqual([importada.trazado[0], importada.trazado.at(-1)], [CARTOGRAFIA_METRO.trazado[0], CARTOGRAFIA_METRO.trazado.at(-1)])
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

test("la licencia se comprueba en la ficha del catálogo y debe cubrir la capa consultada", () => {
  const capa = "https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/movilidad/metrobogota/MapServer/1"
  const ficha = (cambios: object = {}) => ({ result: { license_id: "CC-BY-4.0", inf_citation_date: "2022-04-18", resources: [{ url: capa }], ...cambios } })
  assert.equal(fechaDeFichaConLicencia(ficha(), capa), "2022-04-18")
  assert.throws(() => fechaDeFichaConLicencia(ficha({ license_id: "CC-BY-NC-4.0" }), capa), /no CC BY 4.0/)
  assert.throws(() => fechaDeFichaConLicencia(ficha({ resources: [{ url: capa.replace(/1$/, "6") }] }), capa), /no enumera la capa/)
  assert.throws(() => fechaDeFichaConLicencia(ficha({ inf_citation_date: undefined }), capa), /fecha del dato/)
  assert.throws(() => fechaDeFichaConLicencia({ success: false }, capa), /no CC BY 4.0/)
})

// --- Separación ---------------------------------------------------------------

test("la cartografía solo llega al listado del Metro; los mapas operativos no la dibujan", () => {
  const archivos = ["lib", "components", "hooks", "app", "scripts"]
    .flatMap((dir) => readdirSync(`${raiz}/${dir}`, { recursive: true, encoding: "utf8" }).map((f) => `${dir}/${f.replaceAll("\\", "/")}`))
    .filter((f) => /\.(?:tsx?|mjs)$/.test(f) && !/\.test\.tsx?$/.test(f))
  const leer = (f: string) => readFileSync(`${raiz}/${f}`, "utf8")
  assert.deepEqual(
    archivos.filter((f) => /["'](?:@\/lib\/|\.\.?\/(?:lib\/)?)metro-cartografia["']/.test(leer(f))),
    ["components/metro-list.tsx", "scripts/sync-metro-cartografia.ts"],
  )
  assert.deepEqual(archivos.filter((f) => /\boverlay=\{/.test(leer(f))), ["components/metro-list.tsx"], "ni el GPS, ni la ruta, ni el viaje pasan una capa ilustrativa")
  // El módulo no depende del catálogo ni de TransMilenio: no hay cercanía que calcular.
  assert.deepEqual([...leer("lib/metro-cartografia.ts").matchAll(/^import .* from "(.+?)"/gm)].map((m) => m[1]), ["@/data/metro-cartografia.json"])
})

// --- Mapa: rótulo, atribución y huellas ---------------------------------------

type Elemento = { type: unknown; props: Record<string, unknown> }
type Capa = { lines: [number, number][][]; polygons: { ring: [number, number][]; label: string }[]; label: string; attribution: string }

function compilar(archivo: string, dobles: Record<string, unknown>, contexto: object = {}) {
  const salida = ts.transpileModule(readFileSync(`${raiz}/${archivo}`, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const require = (nombre: string) => {
    if (nombre === "react/jsx-runtime") return jsx
    if (nombre === "@/lib/metro") return metro
    if (nombre === "@/lib/metro-cartografia") return cartografia
    if (nombre in dobles) return dobles[nombre]
    if (nombre === "lucide-react" || nombre.startsWith("@/components/")) return new Proxy({}, { get: (_o, n) => function Componente() { void n } })
    throw new Error(`Import no previsto: ${nombre}`)
  }
  const modulo = { exports: {} as Record<string, (props: object) => Elemento> }
  vm.runInNewContext(`(function(require,module,exports){${salida}\n})`, contexto)(require, modulo, modulo.exports)
  return modulo.exports
}
function nodos(el: unknown, pred: (n: Elemento) => boolean): Elemento[] {
  if (!el || typeof el !== "object") return []
  if (Array.isArray(el)) return el.flatMap((n) => nodos(n, pred))
  const e = el as Elemento
  return [...(pred(e) ? [e] : []), ...nodos(e.props?.children, pred)]
}
function texto(el: unknown): string {
  if (Array.isArray(el)) return el.map(texto).join("")
  if (typeof el === "string" || typeof el === "number") return String(el)
  return el && typeof el === "object" ? texto((el as Elemento).props?.children) : ""
}

test("MetroList: el mapa va rotulado como proyecto futuro en el mapa, en el texto y en la voz, con su atribución", () => {
  const voz: string[] = []
  const { MetroList } = compilar("components/metro-list.tsx", {
    react: { useEffect: (f: () => void) => void f() },
    "@/hooks/use-speech": { useSpeech: () => ({ speak: (t: string) => voz.push(t), cancel() {} }), esUltimaLocucion: () => false },
  })
  const arbol = MetroList({ onBack() {} })
  const visible = texto(arbol)

  const [mapa, ...otros] = nodos(arbol, (n) => n.props?.overlay !== undefined)
  assert.equal(otros.length, 0, "un solo mapa")
  const capa = mapa.props.overlay as Capa
  for (const rotulo of [capa.label, String(mapa.props.label)]) assert.match(rotulo, /proyecto futuro, sin servicio/)
  assert.ok(capa.attribution.includes("CC BY 4.0") && capa.attribution.includes("EMB") && capa.attribution.includes("2022"), capa.attribution)

  // Texto y voz dicen lo mismo; la atribución completa queda visible junto al mapa.
  assert.ok(visible.includes(cartografia.TEXTO_MAPA_METRO) && voz[0].includes(cartografia.TEXTO_MAPA_METRO))
  assert.match(cartografia.TEXTO_MAPA_METRO, /proyecto futuro, sin servicio.*no es una entrada ni indica transbordos/)
  assert.ok(visible.includes(cartografia.ATRIBUCION_MAPA_METRO))
  assert.ok(Object.values(metro.FUENTES_METRO).some((f) => f.url === PROCEDENCIA_MAPA_METRO.trazado.catalogo), "la ficha del trazado está entre las fuentes enlazadas")

  // Leaflet recibe [latitud, longitud]: el orden se invierte en un solo lugar.
  assert.equal(capa.lines.length, 1)
  assert.deepEqual([...capa.lines[0][0]], [CARTOGRAFIA_METRO.trazado[0][1], CARTOGRAFIA_METRO.trazado[0][0]])
  for (const [lat, lon] of [...capa.lines[0], ...capa.polygons.flatMap((p) => p.ring)]) assert.ok(lat > 4 && lat < 5 && lon < -74 && lon > -75, `[${lat}, ${lon}]`)

  // Huellas, no accesos: 16 polígonos con su número, su nombre del catálogo y el aviso.
  assert.equal(capa.polygons.length, 16)
  for (const [i, e] of metro.ESTACIONES_METRO_L1.entries()) {
    assert.equal(capa.polygons[i].label, `${e.idOficial} · ${metro.nombreEstacion(e)}: huella ilustrativa del proyecto; no es una entrada`)
  }
  assert.ok(!("markers" in mapa.props) && !("lines" in mapa.props), "sin marcadores de estación ni rutas en servicio")
  assert.equal(nodos(arbol, (n) => n.type === "details").length, 16 + 1, "el listado sigue completo")
})

/** Leaflet falso: anota lo que se dibuja. */
function leafletFalso() {
  type Dibujo = { tipo: string; opciones: Record<string, unknown>; rotulo?: unknown; rotuloOpciones?: Record<string, unknown> }
  const dibujos: Dibujo[] = []
  const capa = (tipo: string) => (_puntos: unknown, opciones: Record<string, unknown> = {}) => {
    const dibujo: Dibujo = { tipo, opciones }
    dibujos.push(dibujo)
    const yo = { bindTooltip: (rotulo: unknown, o?: Record<string, unknown>) => ((dibujo.rotulo = rotulo), (dibujo.rotuloOpciones = o), yo), addTo: () => yo }
    return yo
  }
  const mapa = { setView: () => mapa, fitBounds: () => mapa, remove() {} }
  const grupo = { addTo: () => grupo, clearLayers() {} }
  return { dibujos, L: { map: () => mapa, tileLayer: () => grupo, layerGroup: () => grupo, polyline: capa("polyline"), polygon: capa("polygon"), circleMarker: capa("circleMarker") } }
}

async function dibujar(props: object) {
  const { dibujos, L } = leafletFalso()
  let refs = 0
  const { TransitMap } = compilar(
    "components/transit-map.tsx",
    // La primera referencia es el contenedor: React la llenaría al montar.
    { "leaflet/dist/leaflet.css": {}, leaflet: L, react: { useRef: (v: unknown) => ({ current: refs++ === 0 ? {} : v }), useEffect: (f: () => void) => void f() } },
    { getComputedStyle: () => ({ getPropertyValue: () => "" }) },
  )
  TransitMap({ label: "Mapa", ...props })
  await new Promise((listo) => setImmediate(listo))
  return dibujos
}

test("TransitMap: la capa ilustrativa lleva rótulo permanente, atribución y un trazo distinto al de una ruta", async () => {
  const overlay: Capa = { label: "Proyecto futuro", attribution: "Fuente, CC BY 4.0", lines: [[[4.6, -74.1], [4.61, -74.09]]], polygons: [{ ring: [[4.6, -74.1], [4.6, -74.09], [4.61, -74.09], [4.6, -74.1]], label: "E01: huella" }] }
  const ruta = [[4.6, -74.1], [4.62, -74.08]]
  const dibujos = await dibujar({ overlay, lines: [{ path: ruta }, { path: ruta, secondary: true }] })

  const [proyecto, principal, secundaria] = dibujos.filter((d) => d.tipo === "polyline")
  assert.equal(proyecto.rotulo, overlay.label)
  assert.equal(proyecto.rotuloOpciones?.permanent, true, "el rótulo no depende de pasar el cursor")
  assert.equal(proyecto.opciones.attribution, overlay.attribution)
  assert.ok(proyecto.opciones.dashArray && proyecto.opciones.dashArray !== secundaria.opciones.dashArray && principal.opciones.dashArray === undefined)
  assert.ok(Number(proyecto.opciones.weight) < Number(principal.opciones.weight))
  assert.ok(principal.opciones.attribution === undefined && principal.rotulo === undefined, "las rutas en servicio no heredan el rótulo")

  const [huella] = dibujos.filter((d) => d.tipo === "polygon")
  assert.equal(huella.rotulo, "E01: huella")
  assert.equal(dibujos.filter((d) => d.tipo === "circleMarker").length, 0, "una huella no se dibuja como marcador de estación")
})

test("TransitMap: sin capa ilustrativa dibuja lo mismo que antes", async () => {
  const dibujos = await dibujar({ lines: [{ path: [[4.6, -74.1], [4.62, -74.08]] }], markers: [{ lat: 4.6, lng: -74.1, label: "Estación", kind: "station" }] })
  assert.deepEqual(dibujos.map((d) => d.tipo), ["polyline", "circleMarker"])
})
