import {
  AnunciosRespuestaSchema,
  type Anuncio,
  type AnunciosRespuesta,
  type EfectoAnuncio,
  type FuenteAnuncios,
} from "@/lib/anuncios"
import { acortar, AVISO_SIN_GARANTIA, fechaLegible } from "@/lib/anuncios-texto"
import { leerBytesLimitado } from "@/lib/cuerpo-peticion"
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
/**
 * Tamaño máximo aceptado de la respuesta, en bytes REALES leídos (ya
 * descomprimidos). La real pesaba ~70 KB y llegó a ~128 KB en un día. Si se
 * supera, la consulta cuenta como FALLO (el estado pasa a `degradada` o, sin
 * ninguna consulta buena, a `sin-fuente`): nunca se trunca ni se usa a medias.
 */
export const MAX_BYTES = 2_000_000
/** La marca de la fuente no puede ser anterior a esto (2020-01-01, en segundos)... */
const MARCA_MINIMA_S = 1_577_836_800
/** ...ni adelantarse al reloj del servidor más de esto (una marca en milisegundos queda muy fuera). */
const MARGEN_FUTURO_MS = 60 * 60 * 1000
/** Cuánto se reutiliza una consulta, con éxito o con fallo, antes de volver a la fuente (publica cada ~26 s). */
const TTL_MS = 30_000
/** Si la marca de la fuente es más vieja que esto, la fuente está atrasada: confianza baja. */
export const EDAD_MAXIMA_FUENTE_MS = 15 * 60 * 1000
/**
 * Sin una consulta buena —o con la marca de la fuente sin avanzar— en este tiempo
 * se vuelve a `sin-fuente`: un anuncio sin fecha de fin no puede quedar en
 * pantalla para siempre con la fuente caída o congelada.
 */
export const MAX_SIN_CONSULTA_MS = 24 * 60 * 60 * 1000
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

/** Números de campo de `gtfs-realtime.proto` que se leen; los demás se ignoran. */
const CAMPO = {
  mensajeCabecera: 1,
  mensajeEntidad: 2,
  cabeceraMarca: 3,
  entidadId: 1,
  entidadEliminada: 2,
  entidadAlerta: 5,
  alertaPeriodo: 1,
  alertaAfectado: 5,
  alertaEfecto: 7,
  alertaTitulo: 10,
  alertaDescripcion: 11,
  periodoInicio: 1,
  periodoFin: 2,
  afectadoRuta: 2,
  traducciones: 1,
  traduccionTexto: 1,
  traduccionIdioma: 2,
} as const

const texto = (b: Uint8Array) => new TextDecoder("utf-8").decode(b)

/** `TranslatedString`: prefiere la traducción en español CON texto y si no la primera con texto. */
function textoTraducido(b: Uint8Array): string {
  let primero: string | null = null
  for (const t of campos(b)) {
    if (t.num !== CAMPO.traducciones || t.tipo !== 2) continue
    let cuerpo = ""
    let idioma = ""
    for (const c of campos(t.bytes)) {
      if (c.num === CAMPO.traduccionTexto && c.tipo === 2) cuerpo = texto(c.bytes)
      if (c.num === CAMPO.traduccionIdioma && c.tipo === 2) idioma = texto(c.bytes)
    }
    if (!cuerpo.trim()) continue
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
  /** Marca de la propia fuente, en segundos desde la época. Siempre válida: sin ella el mensaje se rechaza. */
  marca: number
  alertas: AlertaCruda[]
}

/**
 * Decodifica un `FeedMessage` de GTFS-realtime. Lanza si no es un mensaje válido:
 * truncado, sin cabecera, sin marca de tiempo o con una marca fuera de rango. Un
 * cuerpo vacío (p. ej. una página de mantenimiento con 200) NO es un feed.
 */
export function decodificarAlertas(bytes: Uint8Array, ahoraMs = Date.now()): AlertasDecodificadas {
  let marca: number | null = null
  const alertas: AlertaCruda[] = []
  for (const f of campos(bytes)) {
    if (f.num === CAMPO.mensajeCabecera && f.tipo === 2) {
      for (const h of campos(f.bytes)) if (h.num === CAMPO.cabeceraMarca && h.tipo === 0) marca = h.valor
    } else if (f.num === CAMPO.mensajeEntidad && f.tipo === 2) {
      const a: AlertaCruda = { id: "", eliminada: false, periodos: [], rutas: [], efecto: 0, titulo: "", descripcion: "" }
      for (const e of campos(f.bytes)) {
        if (e.num === CAMPO.entidadId && e.tipo === 2) a.id = texto(e.bytes)
        else if (e.num === CAMPO.entidadEliminada && e.tipo === 0) a.eliminada = e.valor !== 0
        else if (e.num === CAMPO.entidadAlerta && e.tipo === 2) {
          for (const c of campos(e.bytes)) {
            if (c.num === CAMPO.alertaPeriodo && c.tipo === 2) {
              const p = { desde: null as number | null, hasta: null as number | null }
              for (const r of campos(c.bytes)) {
                if (r.num === CAMPO.periodoInicio && r.tipo === 0) p.desde = r.valor
                if (r.num === CAMPO.periodoFin && r.tipo === 0) p.hasta = r.valor
              }
              a.periodos.push(p)
            } else if (c.num === CAMPO.alertaAfectado && c.tipo === 2) {
              for (const s of campos(c.bytes)) if (s.num === CAMPO.afectadoRuta && s.tipo === 2) a.rutas.push(texto(s.bytes))
            } else if (c.num === CAMPO.alertaEfecto && c.tipo === 0) a.efecto = c.valor
            else if (c.num === CAMPO.alertaTitulo && c.tipo === 2) a.titulo = textoTraducido(c.bytes)
            else if (c.num === CAMPO.alertaDescripcion && c.tipo === 2) a.descripcion = textoTraducido(c.bytes)
          }
        }
      }
      alertas.push(a)
    }
  }
  if (marca === null) throw new Error("mensaje sin cabecera o sin marca de tiempo")
  if (marca < MARCA_MINIMA_S || marca * 1000 > ahoraMs + MARGEN_FUTURO_MS) throw new Error("marca de tiempo fuera de rango")
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

/**
 * Qué tanto afecta el efecto al viaje, de mayor a menor: sin servicio, luego
 * servicio reducido, desvío o problema de accesibilidad (la audiencia de la app
 * lo necesita ya), luego demoras, y el resto. Ordena la lista antes que la fecha.
 */
const PRIORIDAD_EFECTO: Partial<Record<EfectoAnuncio, number>> = {
  "sin-servicio": 0,
  "servicio-reducido": 1,
  desvio: 1,
  accesibilidad: 1,
  demoras: 2,
}
const PRIORIDAD_RESTO = 3

const ENTIDADES_HTML: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", deg: "°",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", ntilde: "ñ", uuml: "ü",
  Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", Ntilde: "Ñ", Uuml: "Ü",
}

/** La fuente publica entidades HTML (`&iacute;`) en el texto plano: se decodifican y se acota el largo. */
function limpiarTexto(texto: string, max: number): string {
  const plano = texto
    .replace(/&#(\d+);/g, (m, n) => (Number(n) < 0x110000 ? String.fromCodePoint(Number(n)) : m))
    .replace(/&([A-Za-z]+);/g, (m, n) => ENTIDADES_HTML[n] ?? m)
    .replace(/\s+/g, " ")
    .trim()
  return acortar(plano, max)
}

/** Segundos desde la época a ISO 8601, o `null` si no es una fecha representable. */
function iso(segundos: number): string | null {
  const fecha = new Date(segundos * 1000)
  return Number.isNaN(fecha.getTime()) ? null : fecha.toISOString()
}

/**
 * Anuncios VIGENTES de la fuente en `ahoraMs`: descarta los eliminados, los
 * vencidos, los que aún no empiezan, los vacíos y los repetidos (mismo
 * identificador, o mismo texto y vigencia bajo otro identificador). Primero los
 * de efecto más grave y, a igual gravedad, los más recientes. Una alerta sin `active_period` rige mientras esté en el
 * feed (GTFS-realtime), con `fecha` y `vigenciaHasta` nulas: nunca se inventa
 * una fecha que la fuente no publica.
 */
export function aAnuncios(feed: AlertasDecodificadas, ahoraMs: number): Anuncio[] {
  const ahora = ahoraMs / 1000
  const vistosId = new Set<string>()
  const vistosContenido = new Set<string>()
  const anuncios: Anuncio[] = []
  for (const a of feed.alertas) {
    const id = a.id.trim()
    if (!id || a.eliminada || vistosId.has(id)) continue
    const vigente =
      a.periodos.length === 0
        ? { desde: null, hasta: null }
        : a.periodos.find((p) => (p.desde ?? -Infinity) <= ahora && ahora <= (p.hasta ?? Infinity))
    if (!vigente) continue
    const descripcion = limpiarTexto(a.descripcion, MAX_DESCRIPCION)
    // Sin título, la descripción lo hace, pero con el tope del título.
    const titulo = limpiarTexto(a.titulo, MAX_TITULO) || limpiarTexto(a.descripcion, MAX_TITULO)
    if (!titulo) continue
    const fecha = vigente.desde === null ? null : iso(vigente.desde)
    const vigenciaHasta = vigente.hasta === null ? null : iso(vigente.hasta)
    if ((vigente.desde !== null && !fecha) || (vigente.hasta !== null && !vigenciaHasta)) continue
    const clave = `${normalize(titulo)}|${normalize(descripcion)}|${vigente.desde ?? ""}|${vigente.hasta ?? ""}`
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
  const prioridad = (a: Anuncio) => PRIORIDAD_EFECTO[a.afectacion.efecto] ?? PRIORIDAD_RESTO
  return anuncios.sort((x, y) => prioridad(x) - prioridad(y) || (y.fecha ?? "").localeCompare(x.fecha ?? ""))
}

// ── Servicio con caché y degradación ──

async function obtenerAlertasOficiales(): Promise<Uint8Array> {
  const res = await fetch(URL_ALERTAS, { signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  // Por stream y sin confiar en `Content-Length` (ausente, mentiroso o de un cuerpo comprimido), como EA-10.
  const lectura = await leerBytesLimitado({ cuerpo: res.body, maximoBytes: MAX_BYTES })
  if (lectura.kind === "excedido") throw new Error("respuesta demasiado grande")
  if (lectura.kind === "error") throw new Error("no se pudo leer la respuesta")
  return lectura.bytes
}

function sinFuente(): AnunciosRespuesta {
  return {
    fuente: {
      entidad: ENTIDAD,
      nombre: NOMBRE_FUENTE,
      url: URL_ALERTAS,
      estado: "sin-fuente",
      confianza: "ninguna",
      consultadoEn: null,
      publicadoEn: null,
      mensaje: `No hay una fuente oficial de anuncios conectada en este momento. ${AVISO_SIN_GARANTIA}`,
    },
    anuncios: [],
  }
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
  let avisadoTamano = false

  function renovar(): Promise<void> {
    pendiente ??= Promise.resolve()
      .then(obtener)
      .then((bytes) => {
        if (!avisadoTamano && bytes.length > MAX_BYTES / 2) {
          // La fuente acumula alertas vencidas y crece: avisar antes de que pase la cota y la fuente quede en `sin-fuente`.
          avisadoTamano = true
          console.warn(`[anuncios] la respuesta ocupa ${bytes.length} de ${MAX_BYTES} bytes (más de la mitad de la cota): hay que subirla`)
        }
        ultimo = { feed: decodificarAlertas(bytes, ahora()), consultadoEn: ahora() }
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
    const ahoraMs = ahora()
    // Cuenta desde la última consulta buena Y desde la marca de la fuente: si responde 200 con la marca congelada, la consulta se renueva pero los datos no.
    if (!ultimo || ahoraMs - ultimo.consultadoEn > MAX_SIN_CONSULTA_MS || ahoraMs - ultimo.feed.marca * 1000 > MAX_SIN_CONSULTA_MS) return sinFuente()
    const anuncios = aAnuncios(ultimo.feed, ahoraMs)
    const consultadoEn = new Date(ultimo.consultadoEn).toISOString()
    const publicadoEn = new Date(ultimo.feed.marca * 1000).toISOString() // válida: `decodificarAlertas` la comprueba
    const atrasada = ahoraMs - ultimo.feed.marca * 1000 > EDAD_MAXIMA_FUENTE_MS
    if (fallo || atrasada) {
      const motivo = fallo ? "No pude actualizar los anuncios de TransMilenio." : "La fuente de anuncios de TransMilenio está atrasada."
      const fuente: FuenteAnuncios = {
        ...base,
        estado: "degradada",
        confianza: "baja",
        consultadoEn,
        publicadoEn,
        mensaje: `${motivo} Muestro lo que la fuente publicó el ${fechaLegible(publicadoEn)}; puede estar desactualizado. ${AVISO_SIN_GARANTIA}`,
      }
      return { fuente, anuncios }
    }
    const mensaje =
      anuncios.length === 0
        ? `La fuente oficial de TransMilenio no publica anuncios vigentes en este momento. ${AVISO_SIN_GARANTIA}`
        : `Hay ${anuncios.length} ${anuncios.length === 1 ? "anuncio vigente publicado" : "anuncios vigentes publicados"} por TransMilenio. Confírmalo con la entidad antes de decidir.`
    // Nunca «alta»: ningún anuncio se ha contrastado con la operación real y la licencia del recurso no está declarada.
    return { fuente: { ...base, estado: "activa", confianza: "media", consultadoEn, publicadoEn, mensaje }, anuncios }
  }

  return async function consultar(): Promise<AnunciosRespuesta> {
    if (pendiente || ahora() - intentoEn >= TTL_MS) await renovar()
    try {
      return AnunciosRespuestaSchema.parse(respuesta())
    } catch (error) {
      // Defensa: un fallo imprevisto armando la respuesta no debe dar 500 en la ruta.
      console.warn("[anuncios] no pude armar la respuesta:", error instanceof Error ? error.message : "error desconocido")
      return sinFuente()
    }
  }
}

/** Servicio compartido por el proceso, usado por la ruta. */
export const consultarAnuncios = crearServicioAnuncios()
