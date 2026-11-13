import datos from "@/data/metro-cartografia.json" with { type: "json" }
import { validarCartografiaMetro, type CartografiaMetro, type Posicion } from "@/lib/metro-cartografia-validacion"

/**
 * Cartografía ilustrativa de la Línea 1 del Metro de Bogotá (EA-24, #50).
 *
 * Solo contiene lo que superó la verificación de sistema de coordenadas y
 * licencia: el trazado y la huella de las 16 estaciones, tal como los publica la
 * Empresa Metro de Bogotá en el servicio de Catastro, pedidos en EPSG:4326. Los
 * accesos peatonales y la Línea 2 quedan ausentes. La evidencia y sus límites
 * están en `docs/expoandes/ea-24-cartografia-metro.md`.
 *
 * Es un módulo aparte del catálogo (`lib/metro.ts`) y de TransMilenio: no
 * importa ninguno de los dos y solo lo usan el listado del Metro y su contrato
 * HTTP para el iPhone (`lib/contrato-metro.ts`, EA-25). Una huella es
 * infraestructura de un proyecto futuro: no es una entrada, una parada ni un
 * transbordo. La importación desde la fuente vive en
 * `lib/metro-cartografia-fuente.ts` y no llega al navegador.
 */

export type { CartografiaMetro, HuellaEstacionMetro, Posicion } from "@/lib/metro-cartografia-validacion"

type Entidad = { properties: { tipo: string; id?: string; nombreFuente: string }; geometry: { coordinates: unknown } }
const guardadas = datos.features as Entidad[]

export const PROCEDENCIA_MAPA_METRO = datos.procedencia

export const CARTOGRAFIA_METRO: CartografiaMetro = {
  trazado: (guardadas.find((e) => e.properties.tipo === "trazado")?.geometry.coordinates ?? []) as Posicion[],
  huellas: guardadas
    .filter((e) => e.properties.tipo === "huella_estacion")
    .map((e) => ({ id: String(e.properties.id), nombreFuente: e.properties.nombreFuente, huella: (e.geometry.coordinates as Posicion[][])[0] ?? [] })),
}
// El archivo se lee con conversiones de tipo sin comprobar: se valida una vez al
// cargar. Un archivo dañado detiene la compilación y no llega a publicarse.
validarCartografiaMetro(CARTOGRAFIA_METRO)

/** Leaflet espera [latitud, longitud]; la cartografía guarda [longitud, latitud]. */
export const aLeaflet = (puntos: Posicion[]) => puntos.map(([lon, lat]): [number, number] => [lat, lon])

// ---------------------------------------------------------------------------
// Texto compartido por la pantalla y la voz.
// ---------------------------------------------------------------------------

const dma = (iso: string) => iso.split("-").reverse().join("-")
const { entidad, publicador, licencia, fechaDato, consultado, cambios } = PROCEDENCIA_MAPA_METRO

/** Rótulo que el mapa muestra siempre, en su marco. */
export const ROTULO_MAPA_METRO = "Metro Línea 1 · proyecto futuro, sin servicio"

/** Lo que dicen el texto y la voz sobre el mapa. */
export const TEXTO_MAPA_METRO = `El mapa es una ilustración de un proyecto futuro, sin servicio: muestra el trazado de la Línea 1 y la huella prevista de cada estación según el diseño publicado en ${fechaDato.slice(0, 4)}. Una huella no es una entrada ni indica transbordos.`

/** Lo que acompaña a cada huella en el mapa y a cada estación en el listado. */
export const TEXTO_HUELLA_METRO = "huella ilustrativa del proyecto; no es una entrada"

/** Atribución, licencia, fecha y cambios: visible junto al mapa. */
export const ATRIBUCION_MAPA_METRO = `Trazado y huellas de estación: ${entidad}, ${publicador}, licencia ${licencia}. Dato del ${dma(fechaDato)}, consultado el ${dma(consultado)}. Cambios: ${cambios.join("; ")}.`

/** Forma corta, para el control de atribución del propio mapa. */
export const ATRIBUCION_MAPA_METRO_CORTA = `Metro: EMB, ${licencia}, dato de ${fechaDato.slice(0, 4)}, trazado simplificado`
