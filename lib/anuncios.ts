import { z } from "zod"

/**
 * Contrato de `GET /api/anuncios` (EA-26, #52), compartido por el servidor, la
 * web y, más adelante, un cliente nativo. Solo describe la forma; la consulta a
 * la fuente vive en `lib/anuncios-servidor.ts`.
 *
 * Reglas del contrato:
 *
 * - `fuente.estado` dice qué tan conectada está la fuente oficial. `sin-fuente`
 *   NO significa «sin incidentes»: significa que no hay nada que decir. Ni
 *   siquiera `activa` con la lista vacía garantiza que no haya novedades, por
 *   eso `fuente.mensaje` ya trae la frase que se puede mostrar y leer tal cual.
 * - Un anuncio solo existe si lo publicó una entidad identificable (`origen:
 *   "oficial"`). El modelo de lenguaje no participa en nada de esto.
 * - Si un día se añade contenido editorial o de demostración, debe llevar su
 *   propio `origen` y la marca «simulado»; hoy no hay ninguno, por eso `origen`
 *   solo admite `oficial`.
 */

/** Efecto del anuncio sobre el servicio (`Alert.effect` de GTFS-realtime). */
export const EfectoAnuncioSchema = z.enum([
  "sin-servicio",
  "servicio-reducido",
  "demoras",
  "desvio",
  "servicio-adicional",
  "servicio-modificado",
  "otro",
  "desconocido",
  "parada-movida",
  "sin-efecto",
  "accesibilidad",
])
export type EfectoAnuncio = z.infer<typeof EfectoAnuncioSchema>

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

export const AnuncioSchema = z.object({
  origen: z.literal("oficial"),
  /** Entidad que lo publica. */
  entidad: z.string(),
  /** Identificador dentro de la fuente (`FeedEntity.id`). */
  identificador: z.string(),
  titulo: z.string(),
  descripcion: z.string(),
  /** Inicio de la vigencia (ISO 8601), o `null` si la fuente no lo publica: nunca se inventa. */
  fecha: z.string().nullable(),
  /** Fin de la vigencia (ISO 8601), o `null` si la fuente no la acota. */
  vigenciaHasta: z.string().nullable(),
  afectacion: z.object({
    efecto: EfectoAnuncioSchema,
    /** `route_id` de GTFS afectados; son identificadores de la fuente, no códigos comerciales. */
    rutas: z.array(z.string()),
  }),
})
export type Anuncio = z.infer<typeof AnuncioSchema>

export const FuenteAnunciosSchema = z.object({
  estado: z.enum(["sin-fuente", "activa", "degradada"]),
  /** `media` con la fuente al día; `baja` si falló o está atrasada; `ninguna` sin fuente. */
  confianza: z.enum(["media", "baja", "ninguna"]),
  entidad: z.string(),
  nombre: z.string(),
  url: z.string(),
  /** Última consulta que SÍ funcionó (ISO 8601), o `null` si nunca funcionó. */
  consultadoEn: z.string().nullable(),
  /** Marca de tiempo que la propia fuente puso a su última publicación (ISO 8601). */
  publicadoEn: z.string().nullable(),
  /** Frase lista para mostrar y leer en voz alta. */
  mensaje: z.string(),
})
export type FuenteAnuncios = z.infer<typeof FuenteAnunciosSchema>

export const AnunciosRespuestaSchema = z.object({
  fuente: FuenteAnunciosSchema,
  anuncios: z.array(AnuncioSchema),
})
export type AnunciosRespuesta = z.infer<typeof AnunciosRespuestaSchema>

export const ETIQUETA_ESTADO: Record<FuenteAnuncios["estado"], string> = {
  activa: "Fuente conectada",
  degradada: "Fuente con problemas · confianza baja",
  "sin-fuente": "Sin fuente conectada",
}

/** Cuántos anuncios se leen en voz alta; el resto queda en la lista de la pantalla. */
const MAX_HABLADOS = 5

/**
 * Lo que dice la voz al abrir el panel: el estado de la fuente y un resumen por
 * anuncio (título, afectación y hasta cuándo rige). En modo solo voz es la única
 * vía a su contenido, así que no se reduce al recuento.
 */
export function textoHablado({ fuente, anuncios }: AnunciosRespuesta): string {
  const partes = [fuente.mensaje]
  for (const a of anuncios.slice(0, MAX_HABLADOS)) {
    const hasta = a.vigenciaHasta ? `Rige hasta ${fechaLegible(a.vigenciaHasta)}` : "Sin fecha de fin"
    partes.push(`${a.titulo}. ${ETIQUETA_EFECTO[a.afectacion.efecto]}. ${hasta}.`)
  }
  if (anuncios.length > MAX_HABLADOS) partes.push(`Los otros ${anuncios.length - MAX_HABLADOS} están en la lista de la pantalla.`)
  return partes.join(" ")
}

/** Fecha legible en la hora de Bogotá, para textos que se muestran o se leen. */
export function fechaLegible(iso: string): string {
  const fecha = new Date(iso)
  if (Number.isNaN(fecha.getTime())) return "fecha desconocida"
  return fecha.toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "medium", timeStyle: "short" })
}
