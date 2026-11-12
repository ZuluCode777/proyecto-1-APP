import { z } from "zod"

/**
 * Contrato de `GET /api/anuncios` (EA-26, #52), compartido por el servidor, la
 * web y, más adelante, un cliente nativo. Solo describe la forma; la consulta a
 * la fuente vive en `lib/anuncios-servidor.ts` y los textos para mostrar o leer,
 * en `lib/anuncios-texto.ts`.
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
