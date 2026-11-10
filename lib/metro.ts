import { normalize } from "@/lib/text"

/**
 * Catálogo educativo del Metro de Bogotá (EA-13, #39).
 *
 * Es un contrato INDEPENDIENTE del de TransMilenio: no comparte tipos ni
 * arreglos con `TransmilenioData` y ningún consumidor operativo (`findPlaces`,
 * `nearestStations`, `planTrip`, GPS, paradas de buses) lo importa. Una estación
 * del Metro y una de TransMilenio con el mismo nombre son estaciones distintas.
 *
 * Los datos se transcriben de `docs/expoandes/investigacion-metro.md`, con corte
 * del 2 de noviembre de 2026 (revisión de código 0abca8c). No son una
 * investigación nueva: la vigencia la fija `METRO_CORTE`. Lo desconocido
 * (geometría, accesos, tarifas, frecuencias, tiempos, contraparte de
 * TransMilenio) queda ausente (`null`) y no se completa con aproximaciones.
 */

/** Fecha de corte de las fuentes (ISO) y su forma hablada. */
export const METRO_CORTE = "2026-11-02"
export const METRO_CORTE_HABLADO = "2 de noviembre de 2026"

export type FuenteMetro = { id: string; entidad: string; titulo: string; url: string; fecha: string }

/** Fuentes citadas por el catálogo (ver el registro F1–F22 del informe). Todas consultadas el 2-11-2026. */
export const FUENTES_METRO: Record<string, FuenteMetro> = {
  F1: {
    id: "F1",
    entidad: "Portal Bogotá / EMB",
    titulo: "Balance de rendición de cuentas de la Línea 1",
    url: "https://bogota.gov.co/mi-ciudad/movilidad/2026-10/solo-nos-falta-el-1627-para-subirnos-en-linea-1-del-metro-de-bogota",
    fecha: "28-10-2026 (corte 30-09-2026)",
  },
  F2: {
    id: "F2",
    entidad: "Portal Bogotá / EMB",
    titulo: "Tres solicitudes de precalificación de la Línea 2",
    url: "https://bogota.gov.co/mi-ciudad/movilidad/solicitud-precalificacion-construccion-de-linea-2-del-metro-de-bogota",
    fecha: "07-09-2026",
  },
  F3: {
    id: "F3",
    entidad: "Portal Bogotá / Alcaldía y EMB",
    titulo: "Licitación de la Línea 2 declarada desierta",
    url: "https://bogota.gov.co/mi-ciudad/movilidad/licitacion-publica-internacional-linea-2-de-metro-bogota-febrero-2026",
    fecha: "20-01-2026",
  },
  F4: {
    id: "F4",
    entidad: "Portal Bogotá / Alcaldía",
    titulo: "Metro, cables y nuevas vías",
    url: "https://bogota.gov.co/mi-ciudad/movilidad/2026-10/metro-cables-y-nuevas-vias-para-futuro-de-bogota-y-cundinamarca-2026",
    fecha: "24-09-2026",
  },
  F5: {
    id: "F5",
    entidad: "Portal Bogotá",
    titulo: "Ubicación de estaciones E1–E16",
    url: "https://bogota.gov.co/mi-ciudad/movilidad/estaciones-del-metro-de-bogota",
    fecha: "20-10-2020",
  },
  F6: {
    id: "F6",
    entidad: "Portal Bogotá / EMB",
    titulo: "Nombres elegidos tras votación",
    url: "https://bogota.gov.co/mi-ciudad/movilidad/asi-se-nombraron-tres-estaciones-metro-de-bogota-tras-votacion",
    fecha: "24-06-2026",
  },
  F7: {
    id: "F7",
    entidad: "Portal Bogotá / EMB",
    titulo: "Integración de la estación 2 con el Portal Américas y lista de ocho conexiones directas",
    url: "https://bogota.gov.co/mi-ciudad/movilidad/integracion-estacion-2-del-metro-de-bogota-con-el-portal-americas",
    fecha: "15-07-2026",
  },
  F8: {
    id: "F8",
    entidad: "Datos Abiertos Bogotá / EMB",
    titulo: "Catálogo de estaciones de la primera línea (licencia CC BY 4.0)",
    url: "https://datosabiertos.bogota.gov.co/dataset/estaciones-de-la-primera-linea-del-metro-de-bogota",
    fecha: "dato 18-04-2022; metadato 16-06-2026",
  },
  F10: {
    id: "F10",
    entidad: "Datos Abiertos Bogotá / EMB",
    titulo: "Archivo de estaciones (identificadores E01–E16 y nombres SIG)",
    url: "https://datosabiertos.bogota.gov.co/dataset/f8979f34-66f1-4278-9a16-1312eaddf3a8/resource/17e5e67a-4c29-4337-bb3b-30c631ddf09d/download/estaciones.geojson",
    fecha: "archivo 05-05-2022",
  },
  F13: {
    id: "F13",
    entidad: "Portal Bogotá / EMB",
    titulo: "Estación 13-Central",
    url: "https://bogota.gov.co/en/node/296475",
    fecha: "24-04-2026",
  },
  F14: {
    id: "F14",
    entidad: "EMB",
    titulo: "Plano de la estación 6",
    url: "https://bogota.gov.co/mi-ciudad/movilidad/ubicacion-de-las-estaciones-de-la-linea-1-del-metro-de-bogota",
    fecha: "página 26-10-2024",
  },
  F15: {
    id: "F15",
    entidad: "EMB",
    titulo: "Plano de la estación 7",
    url: "https://bogota.gov.co/mi-ciudad/movilidad/ubicacion-de-las-estaciones-de-la-linea-1-del-metro-de-bogota",
    fecha: "página 26-10-2024",
  },
  F16: {
    id: "F16",
    entidad: "Secretaría Distrital de Planeación",
    titulo: "DTS del Plan Parcial Estación Central, página impresa 154",
    url: "https://www.sdp.gov.co/sites/default/files/00_dts_ec_20.02.2019.pdf",
    fecha: "febrero de 2019",
  },
  F18: {
    id: "F18",
    entidad: "Portal Bogotá / EMB",
    titulo: "Línea 1 contará con 16 estaciones",
    url: "https://bogota.gov.co/mi-ciudad/movilidad/linea-1-del-metro-de-bogota-contara-con-16-estaciones",
    fecha: "06-03-2026",
  },
  F22: {
    id: "F22",
    entidad: "Creative Commons",
    titulo: "Licencia Attribution 4.0",
    url: "https://creativecommons.org/licenses/by/4.0/",
    fecha: "versión 4.0",
  },
}

/** Atribución de los datos abiertos reutilizados (licencia CC BY 4.0, F8/F10/F22). */
export const ATRIBUCION_METRO =
  "Identificadores y nombres técnicos: Empresa Metro de Bogotá (EMB), Datos Abiertos Bogotá, licencia CC BY 4.0. Se transcribieron sin modificar su geometría, que no se usa."

export type EstadoConexionMetro = "directa_prevista" | "por_verificar" | "no_acreditada"

/**
 * Conexión FUTURA con TransMilenio. Es una descripción con su evidencia, nunca
 * una arista de ruteo: `habilitadaParaRuteo` es siempre `false` y la contraparte
 * de TransMilenio es siempre `null` mientras no exista una correspondencia
 * validada.
 */
export type ConexionMetro = {
  estado: EstadoConexionMetro
  detalle: string
  /** Discrepancia entre fuentes que se conserva sin resolver. */
  discrepancia?: string
  fuentes: string[]
  contraparteTm: null
  habilitadaParaRuteo: false
}

export type EstacionMetro = {
  /** Clave interna propuesta, con prefijo de sistema y línea. No es un código oficial. */
  clave: string
  sistema: "metro-bogota"
  linea: "l1"
  numero: number
  /** Identificador técnico oficial del archivo de estaciones: E01–E16. */
  idOficial: string
  /** Nombre público anunciado; `null` si todavía está pendiente (E07). */
  nombre: string | null
  nombreEstado: "votado" | "anunciado" | "pendiente"
  /** Fuentes del nombre público. */
  fuentesNombre: string[]
  /** Nombre técnico de referencia del archivo SIG de 2022: alias documental, no un nuevo ID. */
  aliasSig: string
  /** Corredor y tramo vial publicados; no es la dirección de un acceso peatonal. */
  corredor: string
  conexion: ConexionMetro
  /** Geometría y accesos: ausentes hasta validar CRS, transformación y fuente. */
  geometria: null
  accesos: null
  fuentes: string[]
}

const sinConexion: ConexionMetro = {
  estado: "no_acreditada",
  detalle: "No encontré evidencia de una conexión con TransMilenio; eso no prueba que nunca vaya a existir.",
  fuentes: [],
  contraparteTm: null,
  habilitadaParaRuteo: false,
}

const directa = (detalle: string, extra: Partial<ConexionMetro> = {}): ConexionMetro => ({
  estado: "directa_prevista",
  detalle,
  fuentes: ["F7"],
  contraparteTm: null,
  habilitadaParaRuteo: false,
  ...extra,
})

const estacion = (
  numero: number,
  nombre: string | null,
  nombreEstado: EstacionMetro["nombreEstado"],
  fuentesNombre: string[],
  aliasSig: string,
  corredor: string,
  conexion: ConexionMetro,
): EstacionMetro => {
  const idOficial = `E${String(numero).padStart(2, "0")}`
  return {
    clave: `metro-bogota:l1:${idOficial.toLowerCase()}`,
    sistema: "metro-bogota",
    linea: "l1",
    numero,
    idOficial,
    nombre,
    nombreEstado,
    fuentesNombre,
    aliasSig,
    corredor,
    conexion,
    geometria: null,
    accesos: null,
    fuentes: ["F5", "F10", ...fuentesNombre, ...conexion.fuentes],
  }
}

/** Las 16 estaciones de la Línea 1, E01–E16. */
export const ESTACIONES_METRO_L1: readonly EstacionMetro[] = [
  estacion(1, "Gibraltar", "anunciado", ["F6"], "Cra 96-01", "Villavicencio; carreras 94–93", sinConexion),
  estacion(
    2,
    "Portal Américas",
    "anunciado",
    ["F6"],
    "Portal de las Américas-02",
    "Villavicencio; carreras 86B–86G",
    directa("La fuente la describe como una integración mediante edificios, escaleras y ascensores."),
  ),
  estacion(3, "Ciudad Kennedy", "votado", ["F6"], "Carrera 80-03", "Villavicencio; carreras 80D–80G", sinConexion),
  estacion(4, "Timiza", "votado", ["F6"], "Calle 42 Sur-04", "Primero de Mayo; calles 42 sur–42C sur", sinConexion),
  estacion(5, "Hospital de Kennedy", "anunciado", ["F6"], "Kennedy-05", "Primero de Mayo; calles 40 sur–39 sur", sinConexion),
  estacion(6, "Avenida Boyacá", "anunciado", ["F6"], "Av Boyaca-06", "Primero de Mayo; avenida Boyacá–carrera 72C", {
    estado: "por_verificar",
    detalle:
      "Un plano muestra una futura troncal de TransMilenio junto a esta estación; la modalidad de la conexión y su disponibilidad están pendientes. Una comunicación de marzo de 2026 habla de dos conexiones por proximidad sin identificarlas; no se deduce que sean estas.",
    fuentes: ["F14", "F18"],
    contraparteTm: null,
    habilitadaParaRuteo: false,
  }),
  estacion(7, null, "pendiente", ["F6"], "Av 68-07", "Primero de Mayo; avenida 68–carrera 52C", {
    estado: "por_verificar",
    detalle:
      "Hay una integración futura acreditada y un plano muestra una futura estación de la troncal de la avenida 68; el nombre y la modalidad final están pendientes. Una comunicación de marzo de 2026 habla de dos conexiones por proximidad sin identificarlas; no se deduce que sean estas.",
    fuentes: ["F6", "F15", "F18"],
    contraparteTm: null,
    habilitadaParaRuteo: false,
  }),
  estacion(8, "Puente Aranda", "anunciado", ["F6"], "Cra 50-08", "Primero de Mayo; glorieta de la carrera 50", sinConexion),
  estacion(
    9,
    "SENA",
    "anunciado",
    ["F6"],
    "NQS-09",
    "NQS; diagonal 16 sur–calle 17A bis sur",
    directa("La fuente la enumera como conexión directa sobre la NQS; no se validó la estación de TransMilenio correspondiente."),
  ),
  estacion(10, "Santa Isabel", "votado", ["F6"], "Nariño-10", "Calle 1; carreras 24–24C", sinConexion),
  estacion(11, "Hospital (HOMI)", "anunciado", ["F6"], "Calle 1ra-11", "Caracas; calles 2–3", directa("La fuente la enumera como conexión directa con «Hospital».")),
  estacion(12, "Avenida Jiménez", "anunciado", ["F6"], "Calle 10-12", "Caracas; calles 11–13", directa("La fuente la enumera como conexión directa con «Avenida Jiménez».")),
  estacion(
    13,
    "Central",
    "anunciado",
    ["F13"],
    "Calle 26-13",
    "Caracas; calles 24A–26",
    directa("La publicación de julio de 2026 la incluye entre las conexiones directas; la contraparte y el recorrido final no están validados.", {
      discrepancia:
        "un documento de Planeación de febrero de 2019 la describía por proximidad, no directa. La publicación de 2026 es más reciente, pero eso no reemplaza una certificación técnica.",
      fuentes: ["F7", "F16"],
    }),
  ),
  estacion(14, "Calle 45", "anunciado", ["F6"], "Calle 45-14", "Caracas; calles 42–44", directa("La fuente la enumera como conexión directa con «Calle 45».")),
  estacion(15, "Calle 63", "anunciado", ["F6"], "Calle 63-15", "Caracas; calles 61–63", directa("La fuente la enumera como conexión directa con «Calle 63».")),
  estacion(16, "Calle 72", "anunciado", ["F6"], "Calle 72-16", "Caracas; calles 72–74", directa("La fuente la enumera como conexión directa con «Calle 72».")),
]

export type LineaMetro = {
  clave: string
  nombre: string
  estado: "en_construccion" | "contratacion_precalificacion"
  estadoTexto: string
  /** Siempre `false`: ninguna fecha, nombre o porcentaje de obra lo cambia solo. */
  servicioComercial: false
  /** Previsión de fechas: nunca activa servicio automáticamente. */
  horizonte: string
  fuentes: string[]
}

export const LINEA_1: LineaMetro = {
  clave: "metro-bogota:l1",
  nombre: "Línea 1",
  estado: "en_construccion",
  estadoTexto: "en construcción y sin servicio comercial",
  servicioComercial: false,
  horizonte: "Operación comercial prevista para marzo de 2028; es una previsión y puede cambiar.",
  fuentes: ["F1", "F4"],
}

export const LINEA_2: LineaMetro & { estacionesProyectadas: 11; detalle: string } = {
  clave: "metro-bogota:l2",
  nombre: "Línea 2",
  estado: "contratacion_precalificacion",
  estadoTexto: "en contratación y precalificación, sin servicio comercial",
  servicioComercial: false,
  horizonte:
    "Adjudicación objetivo en el primer trimestre de 2027 y operación proyectada en 2035; son previsiones sujetas a cambios.",
  estacionesProyectadas: 11,
  detalle:
    "Se proyecta entre la calle 72 y Fontanar del Río, con 15,5 kilómetros y 11 estaciones, diez subterráneas y una elevada. Su numeración no tiene relación con la E01–E16 de la Línea 1.",
  fuentes: ["F2", "F3", "F4"],
}

// ---------------------------------------------------------------------------
// Texto compartido por la pantalla y el asistente (texto y voz dicen lo mismo).
// ---------------------------------------------------------------------------

/** Aviso de homónimos; igual en la ficha del asistente y en el listado. */
export const TEXTO_HOMONIMO = "Una estación de TransMilenio con el mismo nombre es otra estación."

export const TEXTO_FUENTE = `Fuentes: Portal Bogotá y Empresa Metro de Bogotá, con datos al ${METRO_CORTE_HABLADO}.`

/** Estado de la Línea 1 con su previsión; igual en pantalla y en voz. */
export const TEXTO_LINEA_1 = `Metro de Bogotá, Línea 1: ${LINEA_1.estadoTexto}. Tendrá 16 estaciones, de E01 a E16. ${LINEA_1.horizonte}`

export const TEXTO_LINEA_2 = `Metro de Bogotá, Línea 2: ${LINEA_2.estadoTexto}. ${LINEA_2.detalle} ${LINEA_2.horizonte} Es solo una ficha de contexto: no tengo una lista de sus estaciones.`

/** Límites que siempre acompañan al catálogo. */
export const TEXTO_LIMITES =
  "Esto es solo consulta: no planeo viajes en Metro, no lo combino con rutas de TransMilenio y no tengo ubicación exacta, accesos, tarifas, frecuencias ni tiempos."

export const nombreEstacion = (e: EstacionMetro) => e.nombre ?? "nombre pendiente"

/** Nombre y su estado, por ejemplo «Ciudad Kennedy, nombre elegido por votación…». */
export function describirNombre(e: EstacionMetro): string {
  switch (e.nombreEstado) {
    case "votado":
      return `${e.nombre}, nombre elegido por votación y anunciado el 24 de junio de 2026.`
    case "pendiente":
      return "Su nombre público todavía está pendiente de definición (comunicación de junio de 2026). «Avenida 68» es solo el corredor y una referencia histórica del archivo técnico, no su nombre."
    default:
      return e.idOficial === "E13"
        ? "Central, nombre confirmado en una publicación distrital del 24 de abril de 2026."
        : `${e.nombre}, nombre público anunciado.`
  }
}

/** Conexión futura con TransMilenio, siempre como previsión y sin habilitar transbordos. */
export function describirConexion(e: EstacionMetro): string {
  const { conexion } = e
  const base =
    conexion.estado === "directa_prevista"
      ? `Conexión futura prevista con TransMilenio, descrita como directa en una publicación del 15 de julio de 2026. ${conexion.detalle}`
      : conexion.detalle
  const discrepancia = conexion.discrepancia ? ` Discrepancia sin resolver: ${conexion.discrepancia}` : ""
  return `${base}${discrepancia} Hoy no hay transbordos habilitados.`
}

/** Ficha completa de una estación, para la voz y el texto del asistente. */
export function describirEstacion(e: EstacionMetro): string {
  return [
    `Estación ${e.idOficial} de la Línea 1 del Metro de Bogotá.`,
    describirNombre(e),
    `Nombre técnico de referencia: ${e.aliasSig}, del archivo de 2022.`,
    `Corredor y tramo publicado: ${e.corredor}.`,
    `La Línea 1 está ${LINEA_1.estadoTexto}; la apertura prevista para marzo de 2028 es solo una previsión.`,
    describirConexion(e),
    `No tengo ubicación exacta ni accesos de esta estación. ${TEXTO_HOMONIMO}`,
    TEXTO_FUENTE,
  ].join(" ")
}

export function describirListado(): string {
  const lista = ESTACIONES_METRO_L1.map((e) => `${e.idOficial}, ${nombreEstacion(e)}`).join("; ")
  return `Estaciones de la Línea 1, ${LINEA_1.estadoTexto}: ${lista}. La numeración E01 a E16 es la referencia oficial. ${TEXTO_FUENTE}`
}

const SERVICIO_NO_DISPONIBLE: Record<TemaServicioMetro, string> = {
  viaje: "No puedo planear viajes en Metro ni combinarlo con TransMilenio: no hay trenes en servicio comercial y no hay transbordos habilitados.",
  tarifa: "No tengo tarifa del Metro: no hay servicio comercial ni una tarifa publicada en mis fuentes.",
  horario: "No tengo horarios ni frecuencias del Metro: todavía no presta servicio comercial.",
  tiempo_real: "No hay trenes en servicio comercial, así que no tengo tiempo real ni calculo esperas o tiempos de viaje del Metro.",
}

export function describirServicio(tema: TemaServicioMetro): string {
  return `${SERVICIO_NO_DISPONIBLE[tema]} La Línea 1 está ${LINEA_1.estadoTexto} y la Línea 2, ${LINEA_2.estadoTexto}. Puedes preguntarme por una estación del Metro o por una ruta de TransMilenio. ${TEXTO_FUENTE}`
}

// ---------------------------------------------------------------------------
// Interpretación de frases: SOLO con contexto explícito de Metro.
// ---------------------------------------------------------------------------

export type TemaServicioMetro = "viaje" | "tarifa" | "horario" | "tiempo_real"

export type ConsultaMetro =
  | { tipo: "estacion"; clave: string }
  | { tipo: "estacion_inexistente"; numero: number }
  /** El número y el nombre dichos apuntan a estaciones distintas (o el número no existe). */
  | { tipo: "estacion_contradictoria"; numero: number; clave: string }
  /** Un nombre suelto que coincide con varias estaciones: se pide aclarar, no se elige. */
  | { tipo: "estacion_ambigua"; claves: string[] }
  | { tipo: "linea"; linea: 1 | 2 }
  | { tipo: "listado" }
  | { tipo: "general" }
  | { tipo: "servicio"; tema: TemaServicioMetro }

const frase = (t: string, opciones: string[]) => opciones.some((p) => ` ${t} `.includes(` ${p} `))

const CONTEXTO_METRO = /\b(?:metro|plmb)\b|\blinea (?:1|uno|2|dos)\b|\b(?:primera|segunda) linea\b/
const LINEA_DOS = /\blinea (?:2|dos)\b|\bsegunda linea\b/
const LINEA_UNO = /\blinea (?:1|uno)\b|\bprimera linea\b/
const NUMERO_ESTACION = /\b(?:e ?|estacion (?:numero )?|numero )0?(\d{1,3})\b/

const TARIFA = ["tarifa", "tarifas", "pasaje", "cuanto cuesta", "cuanto vale", "precio", "costo", "recarga", "tarjeta"]
const TIEMPO_REAL = ["tiempo real", "en vivo", "cuanto falta", "cuanto se demora", "cuanto demora", "cuanto tarda", "frecuencia", "cada cuanto", "cuando pasa", "donde viene"]
const HORARIO = ["horario", "horarios", "a que hora pasa", "a que hora sale", "primer tren", "ultimo tren", "hasta que hora"]
const VIAJE = [
  "como llego", "como llegar", "llegar", "ir", "voy a", "viajar", "viaje", "desde", "hacia", "hasta", "ruta", "rutas",
  "transbordo", "transbordos", "transbordar", "trayecto", "tomar", "tomo", "llevame", "combinar", "combinacion", "trasbordo",
]
const APERTURA = ["abre", "abra", "abren", "abrir", "abrira", "inaugura", "inauguracion", "apertura", "estara listo", "cuando empieza", "cuando funciona"]
/** «de X a Y»: origen y destino sin verbo de viaje. */
const DE_A_DESTINO = /\bde\b.+\b(?:a|al|hacia)\b/
const LISTADO = ["estaciones", "lista", "listado", "cuales son", "todas"]

/** Palabra suelta que está en varios nombres públicos («kennedy») → estaciones candidatas. */
const PALABRAS_AMBIGUAS = new Map<string, EstacionMetro[]>()

/** Clave de búsqueda → estación, para nombres públicos y alias del archivo SIG. */
const CLAVES_ESTACION = (() => {
  const nombresPublicos = ESTACIONES_METRO_L1.flatMap((e) => (e.nombre ? [normalize(e.nombre)] : []))
  const claves = new Map<string, EstacionMetro>()
  const agregar = (clave: string, e: EstacionMetro) => {
    if (clave && !claves.has(clave)) claves.set(clave, e)
  }
  for (const e of ESTACIONES_METRO_L1) {
    if (e.nombre) agregar(normalize(e.nombre), e)
    agregar(normalize(e.aliasSig), e)
    // Alias sin el sufijo numérico («Calle 72-16» → «calle 72»). Una palabra suelta
    // contenida en otro nombre público («Kennedy») es ambigua y se descarta.
    const corto = normalize(e.aliasSig.replace(/-\d{2}$/, ""))
    const ambigua = !corto.includes(" ") && nombresPublicos.some((n) => n !== corto && n.split(" ").includes(corto))
    if (!ambigua) agregar(corto, e)
    else PALABRAS_AMBIGUAS.set(corto, ESTACIONES_METRO_L1.filter((x) => x.nombre && normalize(x.nombre).split(" ").includes(corto)))
  }
  // «Hospital» solo, sin «de Kennedy», es el HOMI (E11).
  agregar("hospital", ESTACIONES_METRO_L1[10])
  agregar("homi", ESTACIONES_METRO_L1[10])
  return [...claves].sort((a, b) => b[0].length - a[0].length)
})()

/** Estaciones mencionadas por nombre o alias, sin solaparse: gana la coincidencia más larga. */
function estacionesNombradas(t: string): { estacion: EstacionMetro; inicio: number }[] {
  const texto = ` ${t} `
  const halladas: { estacion: EstacionMetro; inicio: number; fin: number }[] = []
  for (const [clave, estacion] of CLAVES_ESTACION) {
    const inicio = texto.indexOf(` ${clave} `)
    if (inicio < 0) continue
    const fin = inicio + clave.length + 1
    const solapa = halladas.some((h) => inicio < h.fin && h.inicio < fin)
    if (!solapa && !halladas.some((h) => h.estacion === estacion)) halladas.push({ estacion, inicio, fin })
  }
  return halladas.sort((a, b) => a.inicio - b.inicio)
}

/**
 * Interpreta una frase como consulta del Metro. Devuelve `null` si la frase no
 * trae contexto EXPLÍCITO de Metro («metro», «línea 1/2», «PLMB»): un nombre
 * suelto como «Calle 72» sigue siendo la estación de TransMilenio. Con contexto,
 * toda petición de viaje, tarifa, horario o tiempo real se resuelve aquí y nunca
 * cae a los buses ni a la navegación.
 */
export function interpretarMetro(texto: string): ConsultaMetro | null {
  const t = normalize(texto)
  if (!CONTEXTO_METRO.test(t)) return null

  const nombradas = estacionesNombradas(t)
  const numero = NUMERO_ESTACION.exec(t)

  if (LINEA_DOS.test(t) && !LINEA_UNO.test(t)) {
    // «Estación 5 de la línea 2» no es la E05 de la Línea 1.
    return frase(t, [...TARIFA, ...TIEMPO_REAL, ...HORARIO, ...VIAJE]) || DE_A_DESTINO.test(t)
      ? { tipo: "servicio", tema: temaServicio(t) }
      : { tipo: "linea", linea: 2 }
  }

  if (frase(t, TARIFA)) return { tipo: "servicio", tema: "tarifa" }
  if (frase(t, TIEMPO_REAL)) return { tipo: "servicio", tema: "tiempo_real" }
  if (frase(t, HORARIO)) return { tipo: "servicio", tema: "horario" }
  if (frase(t, VIAJE) || DE_A_DESTINO.test(t) || nombradas.length >= 2) return { tipo: "servicio", tema: "viaje" }

  if (nombradas.length === 1) {
    const { estacion } = nombradas[0]
    // Un número que no coincide con el nombre no se descarta en silencio: se pide aclarar.
    if (numero && Number(numero[1]) !== estacion.numero) return { tipo: "estacion_contradictoria", numero: Number(numero[1]), clave: estacion.clave }
    return { tipo: "estacion", clave: estacion.clave }
  }
  if (numero) {
    const n = Number(numero[1])
    const encontrada = ESTACIONES_METRO_L1.find((e) => e.numero === n)
    return encontrada ? { tipo: "estacion", clave: encontrada.clave } : { tipo: "estacion_inexistente", numero: n }
  }

  for (const [palabra, candidatas] of PALABRAS_AMBIGUAS) {
    if (` ${t} `.includes(` ${palabra} `)) return { tipo: "estacion_ambigua", claves: candidatas.map((e) => e.clave) }
  }

  // «¿Cuándo abre?» sin estación: pregunta por la previsión de la Línea 1, no por un servicio.
  // Va después de servicio e identidad de estación para no saltarse sus validaciones.
  if (frase(t, APERTURA)) return { tipo: "linea", linea: 1 }
  if (frase(t, LISTADO)) return { tipo: "listado" }
  if (LINEA_UNO.test(t)) return { tipo: "linea", linea: 1 }
  return { tipo: "general" }
}

function temaServicio(t: string): TemaServicioMetro {
  if (frase(t, TARIFA)) return "tarifa"
  if (frase(t, TIEMPO_REAL)) return "tiempo_real"
  if (frase(t, HORARIO)) return "horario"
  return "viaje"
}

export type RespuestaMetro = { reply: string; steps: { label: string; detail?: string }[] }

const pasosFuentes = (ids: string[]) =>
  [...new Set(ids)].map((id) => {
    const f = FUENTES_METRO[id]
    return { label: `Fuente ${f.id}: ${f.entidad}, ${f.fecha}`, detail: `${f.titulo}. ${f.url}` }
  })

/** Respuesta hablada y pasos para una consulta de Metro. Nunca depende de la fecha actual. */
export function responderMetro(consulta: ConsultaMetro): RespuestaMetro {
  const base = { label: "Consulté el catálogo del Metro de Bogotá", detail: "Información de consulta; no es parte de las rutas ni del GPS de TransMilenio" }
  switch (consulta.tipo) {
    case "estacion": {
      const e = ESTACIONES_METRO_L1.find((x) => x.clave === consulta.clave)!
      return { reply: describirEstacion(e), steps: [base, ...pasosFuentes([...e.fuentes, ...LINEA_1.fuentes])] }
    }
    case "estacion_inexistente":
      return {
        reply: `La Línea 1 del Metro tiene 16 estaciones, de E01 a E16; no tengo una estación ${consulta.numero} en el catálogo. La Línea 2 no tiene lista de estaciones. ${TEXTO_FUENTE}`,
        steps: [base],
      }
    case "estacion_contradictoria": {
      const e = ESTACIONES_METRO_L1.find((x) => x.clave === consulta.clave)!
      return {
        reply: `Mencionaste la estación ${consulta.numero} y también ${e.nombre ?? e.aliasSig}, que es la ${e.idOficial}. No coinciden y no sé cuál quieres. Pregunta por una sola: por número, de E01 a E16, o por nombre. ${TEXTO_FUENTE}`,
        steps: [base],
      }
    }
    case "estacion_ambigua": {
      const candidatas = ESTACIONES_METRO_L1.filter((x) => consulta.claves.includes(x.clave)).map((x) => `${x.idOficial}, ${nombreEstacion(x)}`)
      return {
        reply: `Ese nombre puede ser más de una estación del Metro: ${candidatas.join(" o ")}. No sé cuál quieres. Pregunta por una sola: por número, de E01 a E16, o por el nombre completo. ${TEXTO_FUENTE}`,
        steps: [base],
      }
    }
    case "listado":
      return { reply: describirListado(), steps: [base, ...pasosFuentes(["F5", "F10", "F6", "F13"])] }
    case "servicio":
      return { reply: describirServicio(consulta.tema), steps: [base, ...pasosFuentes([...LINEA_1.fuentes, ...LINEA_2.fuentes])] }
    case "linea":
      if (consulta.linea === 2) return { reply: `${TEXTO_LINEA_2} ${TEXTO_LIMITES} ${TEXTO_FUENTE}`, steps: [base, ...pasosFuentes(LINEA_2.fuentes)] }
      return {
        reply: `${TEXTO_LINEA_1} El balance publicado el 28 de octubre de 2026 reporta un avance general de 83,73 por ciento, medido al 30 de septiembre. ${TEXTO_LIMITES} ${TEXTO_FUENTE}`,
        steps: [base, ...pasosFuentes(LINEA_1.fuentes)],
      }
    case "general":
      return {
        reply: `${TEXTO_LINEA_1} ${TEXTO_LINEA_2} ${TEXTO_LIMITES} ${TEXTO_FUENTE}`,
        steps: [base, ...pasosFuentes([...LINEA_1.fuentes, ...LINEA_2.fuentes])],
      }
  }
}
