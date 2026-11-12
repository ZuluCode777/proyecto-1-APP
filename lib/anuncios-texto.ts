import { type Anuncio, type EfectoAnuncio, type FuenteAnuncios, type AnunciosRespuesta } from "@/lib/anuncios"

/**
 * Textos de `GET /api/anuncios` para mostrar y leer en voz alta (EA-26, #52):
 * los comparten el servidor (que arma el `mensaje` de la fuente) y la web. El
 * contrato de datos vive en `lib/anuncios.ts`; aquí solo hay palabras.
 */

/**
 * La garantía de seguridad del módulo, con UNA sola redacción: que la fuente no
 * diga nada (no hay fuente, está caída o no se pudo consultar) no significa que
 * el servicio esté sin novedades.
 */
export const AVISO_SIN_GARANTIA = "Esto no significa que no haya novedades en el servicio."

export const ETIQUETA_EFECTO: Record<EfectoAnuncio, string> = {
  "sin-servicio": "Sin servicio",
  "servicio-reducido": "Servicio reducido",
  demoras: "Demoras",
  desvio: "Desvío",
  "servicio-adicional": "Servicio adicional",
  "servicio-modificado": "Servicio modificado",
  otro: "Otro efecto",
  desconocido: "Efecto no informado",
  "parada-movida": "Parada trasladada",
  "sin-efecto": "Sin efecto en el servicio",
  accesibilidad: "Problema de accesibilidad",
}

export const ETIQUETA_ESTADO: Record<FuenteAnuncios["estado"], string> = {
  activa: "Fuente conectada",
  degradada: "Fuente con problemas · confianza baja",
  "sin-fuente": "Sin fuente conectada",
}

/**
 * Fecha legible en la hora de Bogotá, en 24 horas: «p. m.» terminaría en «p. m..»
 * al cerrar la frase, y la voz lo lee peor que «17:05».
 */
export function fechaLegible(iso: string): string {
  const fecha = new Date(iso)
  if (Number.isNaN(fecha.getTime())) return "fecha desconocida"
  return fecha.toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "long", timeStyle: "short", hourCycle: "h23" })
}

/** Vigencia del anuncio, sin punto final (quien la usa cierra la frase). Nunca inventa un extremo que la fuente no publica. */
export function vigenciaTexto({ fecha, vigenciaHasta }: Pick<Anuncio, "fecha" | "vigenciaHasta">): string {
  if (fecha && vigenciaHasta) return `Vigente desde ${fechaLegible(fecha)}, hasta ${fechaLegible(vigenciaHasta)}`
  if (fecha) return `Vigente desde ${fechaLegible(fecha)}, sin fecha de fin`
  if (vigenciaHasta) return `La fuente no publica el inicio; rige hasta ${fechaLegible(vigenciaHasta)}`
  return "La fuente no publica ni el inicio ni el fin"
}

/** Quién publica y cuándo: la fuente, su marca y la última consulta buena. `null` si nunca hubo una consulta buena. */
export function lineaFuente({ entidad, publicadoEn, consultadoEn }: FuenteAnuncios): string | null {
  if (!consultadoEn) return null
  // «S.A.» ya trae su punto: la entidad va seguida de coma para no leer «S.A..».
  const publicado = publicadoEn ? `, publicado por la fuente el ${fechaLegible(publicadoEn)}` : ""
  return `Fuente: ${entidad}${publicado}; última consulta exitosa: ${fechaLegible(consultadoEn)}.`
}

/** Cuántos anuncios se leen en voz alta; el resto queda en la lista de la pantalla. */
const MAX_HABLADOS = 5
/** En la fuente real el título es un código de lugar y el sentido está en la descripción, así que se lee un trozo. */
const MAX_DESCRIPCION_HABLADA = 100

/**
 * Acorta `t` a `max` caracteres CONTANDO puntos de código (no unidades UTF-16: un
 * emoji no se parte en dos mitades sueltas) y, si el corte cae a media palabra,
 * vuelve al último espacio. Una palabra más larga que `max` se corta en seco.
 * Lo que se quita se marca con «…».
 */
export function acortar(texto: string, max: number): string {
  const puntos = Array.from(texto)
  if (puntos.length <= max) return texto
  const corte = puntos.slice(0, max - 1)
  const espacio = corte.lastIndexOf(" ")
  const aMediaPalabra = !/\s/.test(puntos[max - 1])
  return `${(aMediaPalabra && espacio > 0 ? corte.slice(0, espacio) : corte).join("").trimEnd()}…`
}

/**
 * Cierra una frase con UN punto aunque el texto de la fuente ya termine en punto
 * («PADRONES.»), en «…» (texto acortado) o en espacios. Tras «?» o «!» no añade
 * punto: «¿Hay cierre?.» sonaría mal. Un texto que es solo puntuación («…», «...»)
 * no dice nada: devuelve cadena vacía en vez de un punto suelto.
 */
function cerrar(texto: string): string {
  const base = texto.replace(/[.…\s]+$/, "")
  if (!/[\p{L}\p{N}]/u.test(base)) return ""
  return /[?!]$/.test(base) ? base : `${base}.`
}

/** La descripción solo vale si dice algo que el título no dice; la pantalla y la voz usan la misma regla. */
export const descripcionUtil = ({ titulo, descripcion }: Pick<Anuncio, "titulo" | "descripcion">): string | null =>
  descripcion && descripcion !== titulo ? descripcion : null

/**
 * Lo que dice la voz al abrir el panel: el mensaje de la fuente, quién la publica
 * y cuándo, y por cada anuncio su entidad, título, descripción, afectación y
 * vigencia. En modo solo voz es la única vía a su contenido, así que no se
 * reduce al recuento. Los identificadores de ruta de la fuente no se leen: no
 * dicen nada al oído.
 */
export function textoHablado({ fuente, anuncios }: AnunciosRespuesta): string {
  const partes = [fuente.mensaje]
  const origen = lineaFuente(fuente)
  if (origen) partes.push(origen)
  for (const a of anuncios.slice(0, MAX_HABLADOS)) {
    const util = descripcionUtil(a)
    const descripcion = util ? cerrar(acortar(util, MAX_DESCRIPCION_HABLADA)) : ""
    partes.push(
      [`Anuncio oficial de ${a.entidad}:`, cerrar(a.titulo), descripcion, `${ETIQUETA_EFECTO[a.afectacion.efecto]}.`, `${vigenciaTexto(a)}.`]
        .filter(Boolean)
        .join(" "),
    )
  }
  if (anuncios.length > MAX_HABLADOS) partes.push(`Los otros ${anuncios.length - MAX_HABLADOS} están en la lista de la pantalla.`)
  return partes.join(" ")
}
