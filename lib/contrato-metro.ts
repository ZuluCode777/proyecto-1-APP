import { z } from "zod"
import {
  ATRIBUCION_METRO,
  ESTACIONES_METRO_L1,
  FUENTES_METRO,
  LINEA_1,
  LINEA_2,
  METRO_CORTE,
  METRO_CORTE_HABLADO,
  TEXTO_HOMONIMO,
  TEXTO_LIMITES,
  TEXTO_LINEA_1,
  TEXTO_LINEA_2,
  describirConexion,
  describirNombre,
  nombreEstacion,
} from "@/lib/metro"
import {
  ATRIBUCION_MAPA_METRO,
  ATRIBUCION_MAPA_METRO_CORTA,
  CARTOGRAFIA_METRO,
  PROCEDENCIA_MAPA_METRO,
  ROTULO_MAPA_METRO,
  TEXTO_HUELLA_METRO,
  TEXTO_MAPA_METRO,
  type Posicion,
} from "@/lib/metro-cartografia"

/**
 * Contrato de la operación `metro-linea-1` de `POST /api/planificador` (EA-25, #51, sobre EA-13 y EA-24): lo que
 * muestran la pantalla «Metro de Bogotá» de la web (`components/metro-list.tsx`) y su capa del mapa, para el iPhone.
 *
 * Es el catálogo EDUCATIVO de un proyecto futuro, sin servicio: no usa rutas, GPS ni planificador de TransMilenio, no
 * lleva `catalogo` de TransMilenio y no depende de él (por eso el manejador ni siquiera lo carga). Cada texto es el que
 * la web escribe, tal cual; `lib/ea25-metro-contrato.test.ts` lo compara con lo que dibuja `MetroList`. Reglas de
 * EA-24 que este contrato conserva y el esquema hace cumplir (`strictObject`: un campo de más no pasa):
 *
 * - Una huella es un POLÍGONO ilustrativo del diseño de 2022. No hay punto por estación (un centroide parecería una
 *   entrada o una parada), ni accesos, ni Línea 2 en el mapa, ni ninguna conexión con el planificador.
 * - El rótulo, el aviso y la atribución con licencia y fecha viajan con la geometría y deben verse junto al mapa.
 * - `servicioComercial` es siempre `false`.
 */

/** Cotas de la respuesta: el cliente de iPhone puede rechazar lo que las pase y una prueba comprueba que el dato real cabe. */
export const MAX_PUNTOS_TRAZADO_METRO = 500
export const MAX_PUNTOS_HUELLA = 100
export const MAX_TEXTO_METRO = 1_500
const ESTACIONES = 16
const MAX_FUENTES = 30

const Texto = z.string().min(1).max(MAX_TEXTO_METRO)
/** Punto del mapa. Las coordenadas de la fuente son [longitud, latitud]; aquí van como en el resto del contrato. */
const Punto = z.strictObject({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) })

const EstacionMetroSchema = z.strictObject({
  numero: z.number().int().min(1).max(ESTACIONES),
  /** Identificador oficial del archivo de estaciones, E01–E16. */
  id: z.string().regex(/^E\d{2}$/),
  /** `null` si el nombre público está pendiente (E07). */
  nombre: Texto.nullable(),
  /** El nombre tal como lo dice la web: «nombre pendiente» si no hay. */
  nombreMostrado: Texto,
  nombreEstado: z.enum(["votado", "anunciado", "pendiente"]),
  corredor: Texto,
  descripcionNombre: Texto,
  nombreTecnico: Texto,
  /** Conexión FUTURA con TransMilenio como previsión; nunca habilita un transbordo. */
  conexion: Texto,
  avisoUbicacion: Texto,
  enElMapa: Texto,
  /** Lo que dice la huella al tocarla en el mapa: número, nombre y «no es una entrada». */
  etiquetaHuella: Texto,
  /** Ids de `fuentes` que respaldan la estación, sin repetir. */
  fuentes: z.array(z.string()).max(MAX_FUENTES),
  /** Anillo cerrado del polígono ilustrativo. No es un acceso, una parada ni un transbordo. */
  huella: z.array(Punto).min(4).max(MAX_PUNTOS_HUELLA),
})

export const RespuestaMetroSchema = z.strictObject({
  linea: z.strictObject({
    nombre: Texto,
    /** Encabezado de la pantalla: «Línea 1 · en construcción · sin servicio». */
    subtitulo: Texto,
    estado: Texto,
    horizonte: Texto,
    servicioComercial: z.literal(false),
  }),
  /** Nota de estado de la pantalla; la web la dice también en voz al entrar. */
  textoEstado: Texto,
  mapa: z.strictObject({
    /** Rótulo fijo del marco del mapa, siempre visible. */
    rotulo: Texto,
    aviso: Texto,
    /** Atribución completa con licencia, fecha y cambios, bajo el mapa. */
    atribucion: Texto,
    /** Forma corta para el control de atribución del propio mapa. */
    atribucionCorta: Texto,
    entidad: Texto,
    publicador: Texto,
    licencia: Texto,
    licenciaUrl: Texto,
    /** Fecha del dato (diseño de 2022) y de la consulta, ISO `AAAA-MM-DD`. */
    fechaDato: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    consultado: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    cambios: z.array(Texto).max(10),
    /** Trazado SIMPLIFICADO de la Línea 1; una ilustración, no una ruta. */
    trazado: z.array(Punto).min(2).max(MAX_PUNTOS_TRAZADO_METRO),
  }),
  estaciones: z.array(EstacionMetroSchema).length(ESTACIONES),
  linea2: z.strictObject({ titulo: Texto, texto: Texto }),
  /** Fecha de corte del catálogo, ISO y hablada. */
  corte: z.strictObject({ fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), hablada: Texto }),
  /** Atribución de los identificadores y nombres técnicos reutilizados. */
  atribucion: Texto,
  fuentes: z
    .array(z.strictObject({ id: Texto, entidad: Texto, titulo: Texto, fecha: Texto, url: Texto, texto: Texto }))
    .max(MAX_FUENTES),
})
export type RespuestaMetro = z.infer<typeof RespuestaMetroSchema>

const punto = ([longitud, latitud]: Posicion) => ({ lat: latitud, lng: longitud })

function construirRespuesta(): RespuestaMetro {
  const { entidad, publicador, licencia, licenciaUrl, fechaDato, consultado, cambios } = PROCEDENCIA_MAPA_METRO
  const huellas = new Map(CARTOGRAFIA_METRO.huellas.map(({ id, huella }) => [id, huella]))
  return {
    linea: {
      nombre: LINEA_1.nombre,
      // Es el literal del encabezado de `MetroList`; la prueba de paridad lo compara con la pantalla.
      subtitulo: "Línea 1 · en construcción · sin servicio",
      estado: LINEA_1.estadoTexto,
      horizonte: LINEA_1.horizonte,
      servicioComercial: LINEA_1.servicioComercial,
    },
    textoEstado: `${TEXTO_LINEA_1} ${TEXTO_LIMITES} ${TEXTO_MAPA_METRO} Datos al ${METRO_CORTE_HABLADO}.`,
    mapa: {
      rotulo: ROTULO_MAPA_METRO,
      aviso: TEXTO_MAPA_METRO,
      atribucion: ATRIBUCION_MAPA_METRO,
      atribucionCorta: ATRIBUCION_MAPA_METRO_CORTA,
      entidad,
      publicador,
      licencia,
      licenciaUrl,
      fechaDato,
      consultado,
      cambios,
      trazado: CARTOGRAFIA_METRO.trazado.map(punto),
    },
    estaciones: ESTACIONES_METRO_L1.map((estacion) => {
      const huella = huellas.get(estacion.idOficial)
      if (!huella) throw new Error(`La estación ${estacion.idOficial} no tiene huella en la cartografía del Metro.`)
      return {
        numero: estacion.numero,
        id: estacion.idOficial,
        nombre: estacion.nombre,
        nombreMostrado: nombreEstacion(estacion),
        nombreEstado: estacion.nombreEstado,
        corredor: estacion.corredor,
        descripcionNombre: describirNombre(estacion),
        nombreTecnico: `Nombre técnico de referencia: ${estacion.aliasSig} (archivo de 2022).`,
        conexion: describirConexion(estacion),
        avisoUbicacion: `No tengo ubicación exacta ni accesos validados. ${TEXTO_HOMONIMO}`,
        enElMapa: `En el mapa: ${TEXTO_HUELLA_METRO}.`,
        etiquetaHuella: `${estacion.idOficial} · ${nombreEstacion(estacion)}: ${TEXTO_HUELLA_METRO}`,
        fuentes: estacion.fuentes.filter((id, i, ids) => ids.indexOf(id) === i),
        huella: huella.map(punto),
      }
    }),
    linea2: {
      titulo: `Línea 2 · en contratación · ${LINEA_2.estacionesProyectadas} estaciones proyectadas`,
      texto: TEXTO_LINEA_2,
    },
    corte: { fecha: METRO_CORTE, hablada: METRO_CORTE_HABLADO },
    atribucion: ATRIBUCION_METRO,
    fuentes: Object.values(FUENTES_METRO).map((f) => ({
      id: f.id,
      entidad: f.entidad,
      titulo: f.titulo,
      fecha: f.fecha,
      url: f.url,
      texto: `${f.id} · ${f.entidad}: ${f.titulo} (${f.fecha})`,
    })),
  }
}

/** El catálogo no cambia entre peticiones: se arma una vez y se valida al cargar, como la cartografía. */
export const RESPUESTA_METRO: RespuestaMetro = RespuestaMetroSchema.parse(construirRespuesta())
