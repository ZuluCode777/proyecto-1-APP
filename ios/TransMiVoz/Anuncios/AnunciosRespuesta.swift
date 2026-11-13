import Foundation

/// Contrato de `GET /api/anuncios` (`lib/anuncios.ts`, EA-26 / #52). La app solo decodifica y muestra: la
/// vigencia, la deduplicación y el orden por gravedad las decide el servidor. Un valor fuera del contrato (estado,
/// confianza, efecto u origen desconocidos, fecha que no es ISO 8601) hace que toda la respuesta sea incompatible,
/// igual que `RespuestaAgente`: es mejor decir «no pude leerlo» que mostrar a medias un aviso de servicio.

/// Quién publica el anuncio. El servidor hoy solo emite `oficial`; `simulado` es el contenido de demostración
/// (el contrato exige que lleve su propio origen y la marca «simulado»).
enum OrigenAnuncio: String, Decodable, Equatable, Sendable {
    case oficial
    case simulado
}

/// Efecto sobre el servicio (`Alert.effect` de GTFS-realtime), con los códigos estables del contrato.
enum EfectoAnuncio: String, Decodable, Equatable, Sendable {
    case sinServicio = "sin-servicio"
    case servicioReducido = "servicio-reducido"
    case demoras
    case desvio
    case servicioAdicional = "servicio-adicional"
    case servicioModificado = "servicio-modificado"
    case otro
    case desconocido
    case paradaMovida = "parada-movida"
    case sinEfecto = "sin-efecto"
    case accesibilidad
}

struct AfectacionAnuncio: Decodable, Equatable, Sendable {
    let efecto: EfectoAnuncio
    /// `route_id` de GTFS: identificadores de la fuente, no códigos comerciales de ruta.
    let rutas: [String]
}

struct Anuncio: Decodable, Equatable, Sendable, Identifiable {
    let origen: OrigenAnuncio
    let entidad: String
    /// Identificador dentro de la fuente (`FeedEntity.id`).
    let identificador: String
    let titulo: String
    let descripcion: String
    /// Inicio de la vigencia. `nil` si la fuente no lo publica: nunca se inventa.
    let fecha: Date?
    /// Fin de la vigencia. `nil` si la fuente no la acota.
    let vigenciaHasta: Date?
    let afectacion: AfectacionAnuncio

    /// Único por origen e identificador: lo usa la lista para no repetir filas.
    var id: String { "\(origen.rawValue):\(identificador)" }
}

/// Qué tan conectada está la fuente. `sinFuente` NO significa «sin incidentes»: significa que no hay nada que decir.
enum EstadoFuente: String, Decodable, Equatable, Sendable {
    case sinFuente = "sin-fuente"
    case activa
    case degradada
}

enum ConfianzaFuente: String, Decodable, Equatable, Sendable {
    case ninguna
    case baja
    case media
}

struct FuenteAnuncios: Decodable, Equatable, Sendable {
    let estado: EstadoFuente
    let confianza: ConfianzaFuente
    let entidad: String
    let nombre: String
    let url: String
    /// Última consulta del servidor a la fuente que SÍ funcionó. `nil` si nunca funcionó.
    let consultadoEn: Date?
    /// Marca de tiempo que la propia fuente puso a su última publicación.
    let publicadoEn: Date?
    /// Frase lista para mostrar y leer; ya incluye que la ausencia de anuncios no garantiza que no haya novedades.
    let mensaje: String
}

struct AnunciosRespuesta: Decodable, Equatable, Sendable {
    let fuente: FuenteAnuncios
    let anuncios: [Anuncio]

    /// Decodifica el cuerpo de una respuesta 200; cualquier desajuste es `respuestaIncompatible`.
    static func decodificar(_ datos: Data) throws -> AnunciosRespuesta {
        let decodificador = JSONDecoder()
        decodificador.dateDecodingStrategy = .custom { decodificador in
            let contenedor = try decodificador.singleValueContainer()
            guard let fecha = leerFechaISO(try contenedor.decode(String.self)) else {
                throw DecodingError.dataCorruptedError(in: contenedor, debugDescription: "fecha que no es ISO 8601")
            }
            return fecha
        }
        guard let respuesta = try? decodificador.decode(AnunciosRespuesta.self, from: datos),
              !respuesta.fuente.mensaje.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else { throw ErrorConsulta.respuestaIncompatible }
        return respuesta
    }

    /// El servidor emite `toISOString()` (con milisegundos y `Z`); también se acepta sin fracción.
    private static func leerFechaISO(_ texto: String) -> Date? {
        let formato = ISO8601DateFormatter()
        formato.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let fecha = formato.date(from: texto) { return fecha }
        formato.formatOptions = [.withInternetDateTime]
        return formato.date(from: texto)
    }
}
