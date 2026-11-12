/**
 * Repite el análisis de puntos de control de la cartografía del Metro (EA-24,
 * #50) contra las fuentes oficiales y muestra los números que cita
 * `docs/expoandes/ea-24-cartografia-metro.md`.
 *
 * Las entradas van fijadas por SHA-256. Solo hace consultas GET públicas y no
 * escribe nada.
 *
 * Sale con 0 si las entradas no cambiaron y los resultados respaldan el
 * documento, con 1 si una fuente cambió o un resultado ya no lo respalda, y con
 * 2 si no se pudo comprobar porque una fuente no respondió.
 *
 * Uso: pnpm analisis:metro-cartografia
 */
import { createHash } from "node:crypto"
import { distanceMeters } from "@/lib/geo"
import { PROCEDENCIA_MAPA_METRO } from "@/lib/metro-cartografia"
import { CATALOGO_DATOS_ABIERTOS, FuenteInaccesible, descargarTexto, leerJsonDeFuente, localAGeografica } from "@/lib/metro-cartografia-fuente"
import type { Posicion } from "@/lib/metro-cartografia-validacion"

const MAPA_REFERENCIA = "https://serviciosgis.catastrobogota.gov.co/arcgis/rest/services/Mapa_Referencia/Mapa_Referencia/MapServer"

/** Entradas del análisis, con el SHA-256 que tenían el 11 y el 12 de noviembre de 2026. */
const ENTRADAS = {
  // 363 puntos con coordenada local y geográfica MAGNA-SIRGAS (IDECA, capa «Punto Geodésico»).
  geodesicos: {
    url: `${MAPA_REFERENCIA}/5/query?${new URLSearchParams({ where: "1=1", outFields: "*", outSR: "4326", f: "json" })}`,
    sha256: "b68b7a7c6f0e7f7fcc2364f8ddcd895833e443f550b1fbd3796b45e78de8997e",
  },
  // Archivos descargables en el sistema local `PCS_CartMAGBOG`, sin miembro `crs`.
  estacionesLocal: {
    url: `${CATALOGO_DATOS_ABIERTOS}/dataset/f8979f34-66f1-4278-9a16-1312eaddf3a8/resource/17e5e67a-4c29-4337-bb3b-30c631ddf09d/download/estaciones.geojson`,
    sha256: "48ed2ef68b7f199ddc4cd8a9a4854ad5093db19c48f6eab925e4cfe4411d21fa",
  },
  trazadoLocal: {
    url: `${CATALOGO_DATOS_ABIERTOS}/dataset/27b26604-2334-4591-8106-6c5f67b410c7/resource/b6005d7d-b1f1-4a1a-ba43-dc6f70d16957/download/trazado_plmb.geojson`,
    sha256: "1b71a51d3a5ad9f105efd17f68bd61e6d013631087f9a719541a7079a7432d50",
  },
  // Las dos respuestas REST en 4326 de las que sale el archivo versionado.
  estacionesRest: { url: PROCEDENCIA_MAPA_METRO.estaciones.consulta, sha256: PROCEDENCIA_MAPA_METRO.estaciones.sha256 },
  trazadoRest: { url: PROCEDENCIA_MAPA_METRO.trazado.consulta, sha256: PROCEDENCIA_MAPA_METRO.trazado.sha256 },
}

const fallas: string[] = []
const afirmar = (condicion: boolean, mensaje: string) => void (condicion || fallas.push(mensaje))
const metros = (a: Posicion, b: Posicion) => distanceMeters({ lng: a[0], lat: a[1] }, { lng: b[0], lat: b[1] })
const mm = (m: number) => `${(m * 1000).toFixed(1)} mm`

// Las cinco entradas son colecciones de entidades, en GeoJSON o en JSON de ArcGIS.
type Coleccion = { features: { attributes: unknown; properties: unknown; geometry: unknown }[] }

async function descargar(nombre: keyof typeof ENTRADAS): Promise<Coleccion> {
  const { url, sha256 } = ENTRADAS[nombre]
  const cuerpo = await descargarTexto(url)
  const hash = createHash("sha256").update(cuerpo).digest("hex")
  afirmar(hash === sha256, `${nombre}: la fuente cambió desde el análisis (SHA-256 ${hash}); los números de abajo ya no son los del documento`)
  const json = leerJsonDeFuente(cuerpo, url) as Partial<Coleccion> | null
  if (!Array.isArray(json?.features)) throw new FuenteInaccesible(`${url}: la respuesta no trae entidades`)
  return json as Coleccion
}

// Sin traza: que una fuente no responda no es un defecto del script.
const entradas = await Promise.all((Object.keys(ENTRADAS) as (keyof typeof ENTRADAS)[]).map(descargar)).catch((error: unknown) => {
  if (!(error instanceof FuenteInaccesible)) throw error
  console.error(`No se pudo consultar la fuente: ${error.message}. No se comprobó nada.`)
  process.exit(2)
})
const [geodesicos, estacionesLocal, trazadoLocal, estacionesRest, trazadoRest] = entradas

// --- 1. Puntos geodésicos: ¿la definición del .prj reproduce la posición oficial? ---

type PuntoGeodesico = { PGECODIGO: string; PGEFUENTE: string | null; PGECESTE: number | null; PGECNORTE: number | null; PGELONGITU: number | null; PGELATITUD: number | null }
const puntos = geodesicos.features
  .map((f) => f.attributes as PuntoGeodesico)
  .filter((p) => [p.PGECESTE, p.PGECNORTE, p.PGELONGITU, p.PGELATITUD].every((v) => typeof v === "number"))

function errores(semieje?: number) {
  return puntos
    .map((p) => ({ codigo: p.PGECODIGO, fuente: p.PGEFUENTE ?? "", m: metros(localAGeografica(p.PGECESTE!, p.PGECNORTE!, semieje), [p.PGELONGITU!, p.PGELATITUD!]) }))
    .sort((a, b) => a.m - b.m)
}
const conPlano = errores()
const sinPlano = errores(6378137)
const percentil = (lista: { m: number }[], q: number) => lista[Math.floor((lista.length - 1) * q)].m
const atipicos = conPlano.filter((e) => e.m > 1)
const peorSinAtipicos = conPlano[conPlano.length - 1 - atipicos.length]
// La mayoría son de la Empresa de Acueducto; los demás, del Servicio Geológico, tienen menos decimales.
const acueducto = conPlano.filter((e) => e.fuente.includes("Acueducto"))

console.log(`Puntos geodésicos con coordenada local y geográfica: ${puntos.length}`)
console.log(`  Definición del .prj (semieje 6380687): mediana ${mm(percentil(conPlano, 0.5))}, p90 ${mm(percentil(conPlano, 0.9))}, peor ${peorSinAtipicos.m.toFixed(2)} m (${peorSinAtipicos.codigo}) en ${conPlano.length - atipicos.length} de ${conPlano.length}`)
console.log(`  Puntos de la Empresa de Acueducto: ${acueducto.length}, peor ${mm(acueducto.at(-1)?.m ?? NaN)}`)
console.log(`  Atípicos a más de 1 m: ${atipicos.map((e) => `${e.codigo} ${e.m.toFixed(0)} m`).join(", ") || "ninguno"}`)
console.log(`  GRS80 sin el plano de 2550 m: mediana ${percentil(sinPlano, 0.5).toFixed(2)} m, p90 ${percentil(sinPlano, 0.9).toFixed(2)} m`)
afirmar(puntos.length === 363, `se esperaban 363 puntos geodésicos y hay ${puntos.length}`)
afirmar(percentil(conPlano, 0.5) < 0.005, "la mediana con la definición del .prj ya no baja de 5 mm")
afirmar(percentil(conPlano, 0.9) < 0.01, "el percentil 90 con la definición del .prj ya no baja de 1 cm")
afirmar(acueducto.length === 317 && acueducto.at(-1)!.m < 0.02, "los puntos de la Empresa de Acueducto ya no son 317 a 2 cm o menos")
afirmar(atipicos.length === 1 && atipicos[0].codigo === "BVRI", "el único atípico ya no es BVRI")
afirmar(peorSinAtipicos.m < 0.5, "el peor punto sin atípicos ya no baja de 0,5 m")
afirmar(percentil(sinPlano, 0.5) > 3, "ignorar el plano de 2550 m ya no se distingue")

// --- 2. ¿El archivo del sistema local, transformado, es la respuesta REST en 4326? ---

type Par = number[]
function comparar(nombre: string, local: Par[], rest: Par[], esperados: number) {
  afirmar(local.length === esperados && rest.length === esperados, `${nombre}: se esperaban ${esperados} vértices y hay ${local.length} locales y ${rest.length} en 4326`)
  const maxima = Math.max(...local.map((v, i) => metros(localAGeografica(v[0], v[1]), [rest[i][0], rest[i][1]])))
  console.log(`${nombre}: ${local.length} vértices, diferencia máxima ${mm(maxima)}`)
  afirmar(maxima < 0.001, `${nombre}: la diferencia máxima ya no baja de 1 mm`)
}

type EntidadLocal = { properties: { NUMERO: string }; geometry: { coordinates: Par[][][] } }
type EntidadRest = { attributes: { NUMERO: string }; geometry: { rings: Par[][]; paths: Par[][] } }
const porNumero = <T>(lista: T[], numero: (e: T) => string) => [...lista].sort((a, b) => numero(a).localeCompare(numero(b)))
comparar(
  "Estaciones, GeoJSON local transformado contra REST",
  porNumero(estacionesLocal.features as EntidadLocal[], (e) => e.properties.NUMERO).flatMap((e) => e.geometry.coordinates.flat(2)),
  porNumero(estacionesRest.features as EntidadRest[], (e) => e.attributes.NUMERO).flatMap((e) => e.geometry.rings.flat()),
  PROCEDENCIA_MAPA_METRO.estaciones.vertices,
)
comparar(
  "Trazado, GeoJSON local transformado contra REST",
  ((trazadoLocal.features[0]?.geometry as { coordinates: Par[][] } | undefined)?.coordinates ?? []).flat(),
  ((trazadoRest.features as EntidadRest[])[0]?.geometry.paths ?? []).flat(),
  PROCEDENCIA_MAPA_METRO.trazado.verticesFuente,
)

if (fallas.length) {
  console.error(`\nEl análisis ya no respalda el documento:\n- ${fallas.join("\n- ")}`)
  process.exit(1)
}
console.log("\nEntradas sin cambios y resultados dentro de lo que afirma el documento.")
