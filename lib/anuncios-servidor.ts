import {
  AnunciosRespuestaSchema,
  fechaLegible,
  type Anuncio,
  type AnunciosRespuesta,
  type EfectoAnuncio,
  type FuenteAnuncios,
} from "@/lib/anuncios"
import { normalize } from "@/lib/text"

/**
 * Anuncios operativos de TransMilenio S.A. para `GET /api/anuncios` (EA-26, #52).
 *
 * Fuente: alertas GTFS-realtime (`alerts.pb`) del portal oficial
 * `gtfs.transmilenio.gov.co`. Ver `docs/expoandes/ea-26-anuncios.md` para la
 * investigación, la licencia y lo que NO se pudo confirmar.
 *
 * Nada de esto pasa por el modelo de lenguaje: el mensaje se decodifica, se
 * valida y se filtra con reglas. Un fallo de la fuente solo afecta a este
 * endpoint: nunca lanza hacia quien lo llama.
 */

export const ENTIDAD = "TransMilenio S.A."
export const URL_ALERTAS = "https://gtfs.transmilenio.gov.co/alerts.pb"
const NOMBRE_FUENTE = "Alertas GTFS-realtime de TransMilenio"

/** Espera máxima por la fuente. */
const TIMEOUT_MS = 8_000
/** Tamaño máximo aceptado de la respuesta (la real ronda los 70 KB). */
const MAX_BYTES = 2_000_000
/** Cuánto se reutiliza una consulta, con éxito o con fallo, antes de volver a la fuente (publica cada ~26 s). */
const TTL_MS = 30_000
/** Si la marca de la fuente es más vieja que esto, la fuente está atrasada: confianza baja. */
export const EDAD_MAXIMA_FUENTE_MS = 15 * 60 * 1000
const MAX_TITULO = 120
const MAX_DESCRIPCION = 300
const MAX_RUTAS = 20

// ── Decodificador mínimo de protobuf (solo lo que usan las alertas) ──

type Campo = { num: number; tipo: number; valor: number; bytes: Uint8Array }

/** Recorre los campos de un mensaje protobuf; falla si el mensaje está truncado o es inválido. */
function* campos(b: Uint8Array): Generator<Campo> {
  let p = 0
  const varint = (): number => {
    let r = 0
    for (let i = 0; i < 10; i++) {
      if (p >= b.length) throw new Error("protobuf truncado")
      const x = b[p++]
      r += (x & 0x7f) * 2 ** (7 * i)
      if (x < 0x80) return r
    }
    throw new Error("varint demasiado largo")
  }
  while (p < b.length) {
    const llave = varint()
    const num = Math.floor(llave / 8)
    const tipo = llave % 8
    if (tipo === 0) yield { num, tipo, valor: varint(), bytes: b }
    else if (tipo === 2) {
      const largo = varint()
      if (p + largo > b.length) throw new Error("protobuf truncado")
      yield { num, tipo, valor: largo, bytes: b.subarray(p, p + largo) }
      p += largo
    } else if (tipo === 1 || tipo === 5) {
      const largo = tipo === 1 ? 8 : 4
      if (p + largo > b.length) throw new Error("protobuf truncado")
      p += largo
    } else throw new Error(`tipo de campo protobuf no soportado: ${tipo}`)
  }
}

const texto = (b: Uint8Array) => new TextDecoder("utf-8").decode(b)

/** `TranslatedString`: prefiere la traducción en español y si no la primera. */
function textoTraducido(b: Uint8Array): string {
  let primero: string | null = null
  for (const t of campos(b)) {
    if (t.num !== 1 || t.tipo !== 2) continue
    let cuerpo = ""
    let idioma = ""
    for (const c of campos(t.bytes)) {
      if (c.num === 1 && c.tipo === 2) cuerpo = texto(c.bytes)
      if (c.num === 2 && c.tipo === 2) idioma = texto(c.bytes)
    }
    if (idioma.toLowerCase().startsWith("es")) return cuerpo
    primero ??= cuerpo
  }
  return primero ?? ""
}

export type AlertaCruda = {
  id: string
  eliminada: boolean
  /** Segundos desde la época; `null` si el periodo no acota ese extremo. */
  periodos: { desde: number | null; hasta: number | null }[]
  rutas: string[]
  efecto: number
  titulo: string
  descripcion: string
}
export type AlertasDecodificadas = {
  /** Marca de la propia fuente, en segundos desde la época, o `null` si no la trae. */
  marca: number | null
  alertas: AlertaCruda[]
}

/** Decodifica un `FeedMessage` de GTFS-realtime. Lanza si no es un mensaje válido. */
export function decodificarAlertas(bytes: Uint8Array): AlertasDecodificadas {
  let marca: number | null = null
  const alertas: AlertaCruda[] = []
  for (const f of campos(bytes)) {
    if (f.num === 1 && f.tipo === 2) {
      for (const h of campos(f.bytes)) if (h.num === 3 && h.tipo === 0) marca = h.valor
    } else if (f.num === 2 && f.tipo === 2) {
      const a: AlertaCruda = { id: "", eliminada: false, periodos: [], rutas: [], efecto: 0, titulo: "", descripcion: "" }
      for (const e of campos(f.bytes)) {
        if (e.num === 1 && e.tipo === 2) a.id = texto(e.bytes)
        else if (e.num === 2 && e.tipo === 0) a.eliminada = e.valor !== 0
        else if (e.num === 5 && e.tipo === 2) {
          for (const c of campos(e.bytes)) {
            if (c.num === 1 && c.tipo === 2) {
              const p = { desde: null as number | null, hasta: null as number | null }
              for (const r of campos(c.bytes)) {
                if (r.num === 1 && r.tipo === 0) p.desde = r.valor
                if (r.num === 2 && r.tipo === 0) p.hasta = r.valor
              }
              a.periodos.push(p)
            } else if (c.num === 5 && c.tipo === 2) {
              for (const s of campos(c.bytes)) if (s.num === 2 && s.tipo === 2) a.rutas.push(texto(s.bytes))
            } else if (c.num === 7 && c.tipo === 0) a.efecto = c.valor
            else if (c.num === 10 && c.tipo === 2) a.titulo = textoTraducido(c.bytes)
            else if (c.num === 11 && c.tipo === 2) a.descripcion = textoTraducido(c.bytes)
          }
        }
      }
      alertas.push(a)
    }
  }
  return { marca, alertas }
}

// ── Normalización ──

const EFECTOS: Record<number, EfectoAnuncio> = {
  1: "sin-servicio",
  2: "servicio-reducido",
  3: "demoras",
  4: "desvio",
  5: "servicio-adicional",
  6: "servicio-modificado",
  7: "otro",
  8: "desconocido",
  9: "parada-movida",
  10: "sin-efecto",
  11: "accesibilidad",
}

const ENTIDADES_HTML: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", deg: "°",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", ntilde: "ñ", uuml: "ü",
  Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", Ntilde: "Ñ", Uuml: "Ü",
}

/** La fuente publica entidades HTML (`&iacute;`) en el texto plano: se decodifican y se acota el largo. */
function limpiarTexto(t: string, max: number): string {
  const plano = t
    .replace(/&#(\d+);/g, (m, n) => (Number(n) < 0x110000 ? String.fromCodePoint(Number(n)) : m))
    .replace(/&([A-Za-z]+);/g, (m, n) => ENTIDADES_HTML[n] ?? m)
    .replace(/\s+/g, " ")
    .trim()
  return plano.length > max ? `${plano.slice(0, max - 1).trimEnd()}…` : plano
}

/** Segundos desde la época a ISO 8601, o `null` si no es una fecha representable. */
function iso(segundos: number): string | null {
  const fecha = new Date(segundos * 1000)
  return Number.isNaN(fecha.getTime()) ? null : fecha.toISOString()
}

/**
 * Anuncios VIGENTES de la fuente en `ahoraMs`: descarta los eliminados, los
 * vencidos, los que aún no empiezan, los vacíos y los repetidos (mismo
 * identificador, o mismo texto y vigencia bajo otro identificador). Los más
 * recientes primero.
 */
export function aAnuncios(feed: AlertasDecodificadas, ahoraMs: number): Anuncio[] {
  const ahora = ahoraMs / 1000
  const vistosId = new Set<string>()
  const vistosContenido = new Set<string>()
  const anuncios: Anuncio[] = []
  for (const a of feed.alertas) {
    const id = a.id.trim()
    if (!id || a.eliminada || vistosId.has(id)) continue
    const vigente = a.periodos.find((p) => (p.desde ?? -Infinity) <= ahora && ahora <= (p.hasta ?? Infinity))
    if (!vigente) continue
    const descripcion = limpiarTexto(a.descripcion, MAX_DESCRIPCION)
    const titulo = limpiarTexto(a.titulo, MAX_TITULO) || descripcion
    if (!titulo) continue
    const desde = vigente.desde ?? feed.marca ?? ahora
    const fecha = iso(desde)
    const vigenciaHasta = vigente.hasta === null ? null : iso(vigente.hasta)
    if (!fecha || (vigente.hasta !== null && !vigenciaHasta)) continue
    const clave = `${normalize(titulo)}|${normalize(descripcion)}|${desde}|${vigente.hasta ?? ""}`
    vistosId.add(id)
    if (vistosContenido.has(clave)) continue
    vistosContenido.add(clave)
    anuncios.push({
      origen: "oficial",
      entidad: ENTIDAD,
      identificador: id,
      titulo,
      descripcion,
      fecha,
      vigenciaHasta,
      afectacion: { efecto: EFECTOS[a.efecto] ?? "desconocido", rutas: [...new Set(a.rutas)].slice(0, MAX_RUTAS) },
    })
  }
  return anuncios.sort((x, y) => y.fecha.localeCompare(x.fecha))
}

// ── Servicio con caché y degradación ──

async function obtenerAlertasOficiales(): Promise<Uint8Array> {
  const res = await fetch(URL_ALERTAS, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  if (Number(res.headers.get("content-length") ?? 0) > MAX_BYTES) throw new Error("respuesta demasiado grande")
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (bytes.length > MAX_BYTES) throw new Error("respuesta demasiado grande")
  return bytes
}

type Opciones = {
  /** Devuelve los bytes de `alerts.pb`; inyectable para probar sin red. */
  obtener?: () => Promise<Uint8Array>
  ahora?: () => number
}

/**
 * Crea el servicio. Conserva el ÚLTIMO mensaje válido y su fecha: si la fuente
 * falla o se atrasa, el estado pasa a `degradada` con confianza baja y se siguen
 * mostrando los anuncios que todavía estén vigentes. Sin ningún mensaje válido
 * el estado es `sin-fuente` y la lista, vacía. Nunca lanza.
 */
export function crearServicioAnuncios({ obtener = obtenerAlertasOficiales, ahora = Date.now }: Opciones = {}) {
  let ultimo: { feed: AlertasDecodificadas; consultadoEn: number } | null = null
  let fallo = false
  let intentoEn = -Infinity
  let pendiente: Promise<void> | null = null

  function renovar(): Promise<void> {
    pendiente ??= Promise.resolve()
      .then(obtener)
      .then((bytes) => {
        ultimo = { feed: decodificarAlertas(bytes), consultadoEn: ahora() }
        fallo = false
      })
      .catch((error) => {
        fallo = true
        // Solo el mensaje: el objeto de error de `fetch` puede traer detalles de red.
        console.warn("[anuncios] fuente no disponible:", error instanceof Error ? error.message : "error desconocido")
      })
      .finally(() => {
        intentoEn = ahora()
        pendiente = null
      })
    return pendiente
  }

  function respuesta(): AnunciosRespuesta {
    const base = { entidad: ENTIDAD, nombre: NOMBRE_FUENTE, url: URL_ALERTAS }
    if (!ultimo) {
      const fuente: FuenteAnuncios = {
        ...base,
        estado: "sin-fuente",
        confianza: "ninguna",
        consultadoEn: null,
        publicadoEn: null,
        mensaje: "No hay una fuente oficial de anuncios conectada en este momento. Esto no significa que no haya novedades en el servicio.",
      }
      return { fuente, anuncios: [] }
    }
    const ahoraMs = ahora()
    const anuncios = aAnuncios(ultimo.feed, ahoraMs)
    const consultadoEn = new Date(ultimo.consultadoEn).toISOString()
    const publicadoEn = ultimo.feed.marca === null ? null : new Date(ultimo.feed.marca * 1000).toISOString()
    const atrasada = ahoraMs - (ultimo.feed.marca === null ? ultimo.consultadoEn : ultimo.feed.marca * 1000) > EDAD_MAXIMA_FUENTE_MS
    if (fallo || atrasada) {
      const motivo = fallo ? "No pude actualizar los anuncios de TransMilenio." : "La fuente de anuncios de TransMilenio está atrasada."
      const fuente: FuenteAnuncios = {
        ...base,
        estado: "degradada",
        confianza: "baja",
        consultadoEn,
        publicadoEn,
        mensaje: `${motivo} Muestro lo de la última consulta exitosa, del ${fechaLegible(consultadoEn)}; puede estar desactualizado. Esto no significa que no haya novedades en el servicio.`,
      }
      return { fuente, anuncios }
    }
    const mensaje =
      anuncios.length === 0
        ? "La fuente oficial de TransMilenio no publica anuncios vigentes en este momento. Eso no garantiza que no haya novedades en el servicio."
        : `Hay ${anuncios.length} ${anuncios.length === 1 ? "anuncio vigente publicado" : "anuncios vigentes publicados"} por TransMilenio. Confírmalo con la entidad antes de decidir.`
    return { fuente: { ...base, estado: "activa", confianza: "media", consultadoEn, publicadoEn, mensaje }, anuncios }
  }

  return async function consultar(): Promise<AnunciosRespuesta> {
    if (pendiente || ahora() - intentoEn >= TTL_MS) await renovar()
    return AnunciosRespuestaSchema.parse(respuesta())
  }
}

/** Servicio compartido por el proceso, usado por la ruta. */
export const consultarAnuncios = crearServicioAnuncios()
