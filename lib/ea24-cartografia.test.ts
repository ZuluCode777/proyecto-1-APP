import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { distanceMeters } from "./geo"
import * as metro from "./metro"
import { ATRIBUCION_MAPA_METRO, CARTOGRAFIA_METRO, PROCEDENCIA_MAPA_METRO } from "./metro-cartografia"
import { FUENTES_CARTOGRAFIA, TOLERANCIA_M, localAGeografica, serializarArchivo, urlConsulta } from "./metro-cartografia-fuente"
import * as validacion from "./metro-cartografia-validacion"
import { aMetros, distanciaASegmento, giro, validarCartografiaMetro, type Posicion } from "./metro-cartografia-validacion"
import { compilar } from "./metro-prueba-ui"

/**
 * EA-24 (#50): la geometría versionada del Metro, su procedencia y sus puntos de
 * control. Corre sin red, con copias de datos oficiales del 11-11-2026.
 *
 * Qué prueba cada control, y qué no:
 * - Los puntos geodésicos y los vértices del sistema local prueban la
 *   TRANSFORMACIÓN: que la definición del `.prj` es la correcta y que el archivo
 *   local y la respuesta en 4326 son la misma geometría. No prueban la posición:
 *   los dos archivos salen del mismo dato de la EMB, y la conversión a 4326 la
 *   hace el servidor de Catastro, no este código.
 * - El control vial es el único independiente de la EMB y acota la POSICIÓN a
 *   escala de cuadra: unos 30 m transversal al corredor y hasta unos 100 m a lo
 *   largo. Lo independiente son sus datos, no su cálculo: mide con `giro`,
 *   `distanciaASegmento` y `aMetros`, las mismas funciones del validador, así
 *   que un error en ellas pasaría las dos comprobaciones.
 * `pnpm analisis:metro-cartografia` repite el análisis completo contra las fuentes.
 */

const metros = (a: Posicion, b: Posicion) => distanceMeters({ lng: a[0], lat: a[1] }, { lng: b[0], lat: b[1] })
const { trazado, huellas } = CARTOGRAFIA_METRO

// --- Geometría versionada ---------------------------------------------------

test("geometría versionada: pares [longitud, latitud], dentro de Bogotá y con la cobertura de la Línea 1", () => {
  validarCartografiaMetro(CARTOGRAFIA_METRO)
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
  assert.deepEqual(huellas.map((h) => h.id), metro.ESTACIONES_METRO_L1.map((e) => e.idOficial))
  for (const [i, h] of huellas.entries()) assert.match(h.nombreFuente, new RegExp(`^Estación ${i + 1}\\b`), h.id)
})

test("la geometría se valida al cargar el módulo: un archivo dañado no llega a la pantalla", () => {
  const guardado = JSON.parse(readFileSync(`${process.cwd()}/data/metro-cartografia.json`, "utf8"))
  const cargar = (datos: object) => compilar("lib/metro-cartografia.ts", { "@/data/metro-cartografia.json": { default: datos }, "@/lib/metro-cartografia-validacion": validacion })
  assert.equal((cargar(guardado) as unknown as { CARTOGRAFIA_METRO: { huellas: unknown[] } }).CARTOGRAFIA_METRO.huellas.length, 16)

  const invertido = structuredClone(guardado)
  invertido.features[0].geometry.coordinates = invertido.features[0].geometry.coordinates.map(([lon, lat]: number[]) => [lat, lon])
  assert.throws(() => cargar(invertido), /trazado: .*¿ejes invertidos/)
  assert.throws(() => cargar({ ...guardado, features: guardado.features.slice(0, 5) }), /se esperaban las 16 huellas/)
  assert.throws(() => cargar({ ...guardado, features: [] }), /el trazado no tiene geometría/)
})

// --- Procedencia --------------------------------------------------------------

test("el archivo conserva fuente, consulta exacta, fecha, sistema de coordenadas y licencia", () => {
  const p = PROCEDENCIA_MAPA_METRO
  assert.equal(p.licencia, "CC BY 4.0")
  assert.equal(p.licenciaUrl, "https://creativecommons.org/licenses/by/4.0/")
  assert.match(p.entidad, /Empresa Metro de Bogotá/)
  assert.match(p.fechaDato, /^\d{4}-\d{2}-\d{2}$/)
  assert.match(p.consultado, /^\d{4}-\d{2}-\d{2}$/)
  assert.ok(p.fechaDato <= p.consultado, "el dato no puede ser posterior a su consulta")
  assert.ok(p.crs.includes("EPSG:4326") && p.crs.includes("[longitud, latitud]"))
  for (const capa of ["trazado", "estaciones"] as const) {
    const fuente = p[capa]
    // La URL guardada es, byte a byte, la que pide el script.
    assert.equal(fuente.consulta, urlConsulta(FUENTES_CARTOGRAFIA[capa]))
    const consulta = new URL(fuente.consulta)
    assert.equal(consulta.hostname, "serviciosgis.catastrobogota.gov.co")
    assert.equal(consulta.searchParams.get("outSR"), "4326")
    assert.match(consulta.searchParams.get("where") ?? "", /^LINEAS?='Primera'$/, "la Línea 1 se elige por atributo")
    assert.ok(fuente.catalogo.startsWith("https://datosabiertos.bogota.gov.co/dataset/"))
    assert.match(fuente.sha256, /^[0-9a-f]{64}$/)
  }
  // La atribución visible dice lo mismo que el archivo.
  for (const dato of [p.entidad, p.licencia, "18-04-2022", p.consultado.split("-").reverse().join("-"), ...p.cambios]) {
    assert.ok(ATRIBUCION_MAPA_METRO.includes(dato), dato)
  }
})

test("los cambios anotados son los que tiene la geometría: conteos, tolerancia y decimales", () => {
  const p = PROCEDENCIA_MAPA_METRO
  assert.equal(p.trazado.vertices, trazado.length)
  assert.ok(p.trazado.verticesFuente > trazado.length, "simplificar quita vértices")
  assert.equal(p.estaciones.entidades, huellas.length)
  assert.equal(p.estaciones.vertices, huellas.reduce((n, h) => n + h.huella.length, 0), "las huellas conservan todos sus vértices")
  assert.deepEqual(p.cambios, [
    `trazado simplificado con tolerancia de ${TOLERANCIA_M} m (de ${p.trazado.verticesFuente} a ${trazado.length} vértices)`,
    "coordenadas redondeadas a 6 decimales",
  ])
  for (const v of [...trazado, ...huellas.flatMap((h) => h.huella)].flat()) assert.equal(v, Number(v.toFixed(6)), `${v} tiene más de 6 decimales`)
})

test("el archivo está escrito como lo escribe el script, sin retoques a mano", () => {
  const guardado = readFileSync(`${process.cwd()}/data/metro-cartografia.json`, "utf8")
  assert.equal(guardado, serializarArchivo(JSON.parse(guardado)))
})

// --- Transformación del sistema local, probada con puntos de control ---------

/**
 * Muestra de 8 de los 363 puntos geodésicos oficiales: código, este y norte en el
 * sistema local, longitud y latitud MAGNA-SIRGAS. Son los de la Empresa de
 * Acueducto dentro de la caja del trazado, ordenados por longitud y tomados a
 * intervalos iguales. Los 363 se repiten con `pnpm analisis:metro-cartografia`.
 * Fuente: IDECA, Mapa de Referencia, capa «Punto Geodésico», CC BY 4.0,
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

test("puntos de control geodésicos: la definición del .prj reproduce la muestra oficial a 2 cm o menos", () => {
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
    const error = metros(localAGeografica(este, norte), huellas.find((h) => h.id === id)!.huella[0])
    assert.ok(error < 0.15, `${id}: ${error.toFixed(3)} m`)
  }
  // Extremos de `trazado_plmb.geojson` (SHA-256 1b71a51d…).
  assert.ok(metros(localAGeografica(87118.59229999967, 105675.71829999983), trazado[0]) < 0.15)
  assert.ok(metros(localAGeografica(101895.72829999961, 107871.5558000002), trazado.at(-1)!) < 0.15)
})

test("las coordenadas del sistema local no pasan por WGS84", () => {
  const [, este, norte] = VERTICES_LOCALES[1]
  assert.throws(() => validarCartografiaMetro({ ...CARTOGRAFIA_METRO, trazado: [[este, norte], [este + 10, norte]] }), /no es \[longitud, latitud\]/)
})

// --- Control independiente de posición ---------------------------------------

/** Distancia en metros de un anillo a un segmento; 0 si se tocan o el segmento empieza dentro. */
function dAnilloSegmento(anillo: Posicion[], desde: Posicion, hasta: Posicion): number {
  const [r, a, b] = [anillo.map(aMetros), aMetros(desde), aMetros(hasta)]
  let dentro = false
  let minima = Infinity
  for (let k = 1; k < r.length; k++) {
    const [c, d] = [r[k - 1], r[k]]
    if (c[1] > a[1] !== d[1] > a[1] && a[0] < ((d[0] - c[0]) * (a[1] - c[1])) / (d[1] - c[1]) + c[0]) dentro = !dentro
    if (giro(a, b, c) * giro(a, b, d) < 0 && giro(c, d, a) * giro(c, d, b) < 0) return 0
    minima = Math.min(minima, distanciaASegmento(c, a, b), distanciaASegmento(d, a, b), distanciaASegmento(a, c, d), distanciaASegmento(b, c, d))
  }
  return dentro ? 0 : minima
}

/**
 * Tramo que el Distrito publicó para cada estación (Portal Bogotá, 20-10-2020,
 * fuente F5): corredor y vías que lo delimitan. Cada fila es el segmento del eje
 * oficial de esa vía más cercano a la huella, copiado el 11-11-2026: estación,
 * vía, si es el corredor, y sus dos extremos [longitud, latitud]. Fuente
 * independiente de la EMB: IDECA, Mapa de Referencia, capa «Malla Vial»
 * (Catastro, IDU y Movilidad), CC BY 4.0,
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

test("control vial, el único independiente: cada huella está en el corredor y el tramo que publicó el Distrito, a escala de cuadra", () => {
  assert.deepEqual([...new Set(CONTROL_VIAL.map(([id]) => id))], huellas.map((h) => h.id), "hay control para las 16")
  const distancias = CONTROL_VIAL.map(([id, via, corredor, lon1, lat1, lon2, lat2]) => ({
    id,
    via,
    corredor,
    m: dAnilloSegmento(huellas.find((h) => h.id === id)!.huella, [lon1, lat1], [lon2, lat2]),
  }))
  const peor = (lista: typeof distancias) => lista.reduce((a, b) => (b.m > a.m ? b : a))
  const [corredor, tramo] = [peor(distancias.filter((d) => d.corredor)), peor(distancias.filter((d) => !d.corredor))]
  // Los números que cita el documento: corredor a 30 m o menos, vías del tramo a 107 m o menos.
  // Son descriptivos: se pusieron mirando el dato, no salen de una tolerancia de diseño.
  // Un error de datum corre la geometría cientos de metros y los rompe.
  assert.ok(corredor.m < 31, `${corredor.id} a ${corredor.m.toFixed(1)} m de ${corredor.via}`)
  assert.ok(tramo.m < 108, `${tramo.id} a ${tramo.m.toFixed(1)} m de ${tramo.via}`)
})
