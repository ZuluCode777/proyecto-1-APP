import Foundation

/// Motor que interpretó la frase en el servidor (`engine` en el contrato HTTP).
enum MotorAgente: String, Decodable, Equatable, Sendable {
    case reglas
    case ollama
}

/// Paso de razonamiento que el servidor deja registrado (`steps[]`).
struct PasoAgente: Decodable, Equatable, Sendable {
    let etiqueta: String
    let detalle: String?

    enum CodingKeys: String, CodingKey {
        case etiqueta = "label"
        case detalle = "detail"
    }
}

/// Tramo de un viaje tal como lo serializa el servidor (`TripLegSummarySchema`).
struct TramoViaje: Decodable, Equatable, Sendable {
    let codigoRuta: String
    let estacionAbordaje: String
    let estacionDescenso: String
    let estacionesRecorridas: Int
    /// Solo si es `true` puede decirse el número exacto de estaciones.
    let conteoVerificado: Bool

    enum CodingKeys: String, CodingKey {
        case codigoRuta = "routeCode"
        case estacionAbordaje = "board"
        case estacionDescenso = "alight"
        case estacionesRecorridas = "stationsRidden"
        case conteoVerificado
    }

    init(from decoder: Decoder) throws {
        let contenedor = try decoder.container(keyedBy: CodingKeys.self)
        codigoRuta = try contenedor.decode(String.self, forKey: .codigoRuta)
        estacionAbordaje = try contenedor.decode(String.self, forKey: .estacionAbordaje)
        estacionDescenso = try contenedor.decode(String.self, forKey: .estacionDescenso)
        estacionesRecorridas = try contenedor.decode(Int.self, forKey: .estacionesRecorridas)
        // El esquema del servidor da `false` por defecto cuando falta.
        conteoVerificado = try contenedor.decodeIfPresent(Bool.self, forKey: .conteoVerificado) ?? false
        guard estacionesRecorridas >= 0 else {
            throw DecodingError.dataCorruptedError(
                forKey: .estacionesRecorridas, in: contenedor,
                debugDescription: "estacionesRecorridas negativo")
        }
    }

    init(codigoRuta: String, estacionAbordaje: String, estacionDescenso: String, estacionesRecorridas: Int, conteoVerificado: Bool) {
        self.codigoRuta = codigoRuta
        self.estacionAbordaje = estacionAbordaje
        self.estacionDescenso = estacionDescenso
        self.estacionesRecorridas = estacionesRecorridas
        self.conteoVerificado = conteoVerificado
    }
}

/// Acción de la respuesta (`action`). Cada caso trae solo los datos de su variante.
enum AccionAgente: Equatable, Sendable {
    case ninguna
    case frecuentes
    case gps
    case busqueda(estacion: String)
    case ruta(codigo: String)
    case viaje([TramoViaje])
}

/// Procedencia del catálogo de una respuesta con datos (`catalogo` en el contrato). La frase y la
/// antigüedad las decide el servidor: la app no calcula fechas ni vigencias.
struct ProcedenciaCatalogo: Decodable, Equatable, Sendable {
    /// Frase del servidor con la fuente y la fecha de los datos.
    let procedencia: String
    /// El servidor respondió con la copia guardada o con datos en vivo ya vencidos.
    let antiguo: Bool
}

/// Aclaración pendiente de una respuesta (`aclaracion` en el contrato, EA-19): el origen que la persona dijo y al que falta
/// el destino. El servidor no guarda nada entre turnos; la app lo conserva y lo reenvía con la pregunta siguiente.
private struct AclaracionAgente: Decodable {
    let origen: String
}

/// Respuesta de `POST /api/agent` (`AgentReplySchema` de `lib/local-agent.ts`).
///
/// El decodificador es estricto en la frontera: una acción desconocida, un
/// campo faltante o un texto vacío o desmedido se rechazan como incompatibles
/// en lugar de mostrarse a medias. La app NO interpreta ni recalcula nada de
/// transporte: solo presenta lo que el servidor decidió.
struct RespuestaAgente: Decodable, Equatable, Sendable {
    /// Cotas defensivas del cliente; el servidor no emite respuestas de este tamaño.
    static let maximoCaracteresTexto = 10_000
    static let maximoPasos = 50
    static let maximoTramos = 20
    static let maximoCaracteresProcedencia = 500
    static let maximoCaracteresOrigen = EntradaConsulta.maximoCaracteres

    let texto: String
    let pasos: [PasoAgente]
    let motor: MotorAgente
    let accion: AccionAgente
    /// Solo en respuestas con datos del catálogo; un servidor anterior a EA-17 no la envía.
    let catalogo: ProcedenciaCatalogo?
    /// Origen que falta completar con un destino (`aclaracion.origen`); `nil` en toda otra respuesta.
    let origenPendiente: String?

    enum CodingKeys: String, CodingKey {
        case texto = "reply"
        case pasos = "steps"
        case motor = "engine"
        case accion = "action"
        case estacion = "station"
        case codigoRuta = "routeCode"
        case viaje = "trip"
        case catalogo
        case aclaracion
    }

    init(
        texto: String, pasos: [PasoAgente] = [], motor: MotorAgente = .reglas, accion: AccionAgente = .ninguna,
        catalogo: ProcedenciaCatalogo? = nil, origenPendiente: String? = nil
    ) {
        self.texto = texto
        self.pasos = pasos
        self.motor = motor
        self.accion = accion
        self.catalogo = catalogo
        self.origenPendiente = origenPendiente
    }

    init(from decoder: Decoder) throws {
        let contenedor = try decoder.container(keyedBy: CodingKeys.self)
        let texto = try contenedor.decode(String.self, forKey: .texto)
        guard !texto.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              texto.count <= Self.maximoCaracteresTexto else {
            throw DecodingError.dataCorruptedError(
                forKey: .texto, in: contenedor, debugDescription: "texto vacío o demasiado largo")
        }
        let pasos = try contenedor.decode([PasoAgente].self, forKey: .pasos)
        guard pasos.count <= Self.maximoPasos else {
            throw DecodingError.dataCorruptedError(
                forKey: .pasos, in: contenedor, debugDescription: "demasiados pasos")
        }
        self.texto = texto
        self.pasos = pasos
        self.motor = try contenedor.decode(MotorAgente.self, forKey: .motor)

        let catalogo = try contenedor.decodeIfPresent(ProcedenciaCatalogo.self, forKey: .catalogo)
        if let catalogo {
            guard !catalogo.procedencia.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  catalogo.procedencia.count <= Self.maximoCaracteresProcedencia else {
                throw DecodingError.dataCorruptedError(
                    forKey: .catalogo, in: contenedor, debugDescription: "procedencia vacía o demasiado larga")
            }
        }
        self.catalogo = catalogo

        let aclaracion = try contenedor.decodeIfPresent(AclaracionAgente.self, forKey: .aclaracion)
        if let aclaracion {
            guard !aclaracion.origen.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  aclaracion.origen.utf16.count <= Self.maximoCaracteresOrigen else {
                throw DecodingError.dataCorruptedError(
                    forKey: .aclaracion, in: contenedor, debugDescription: "origen vacío o demasiado largo")
            }
        }
        origenPendiente = aclaracion?.origen

        let nombreAccion = try contenedor.decode(String.self, forKey: .accion)
        switch nombreAccion {
        case "none": accion = .ninguna
        case "frequent": accion = .frecuentes
        case "gps": accion = .gps
        case "search": accion = .busqueda(estacion: try contenedor.decode(String.self, forKey: .estacion))
        case "route": accion = .ruta(codigo: try contenedor.decode(String.self, forKey: .codigoRuta))
        case "trip":
            let tramos = try contenedor.decode([TramoViaje].self, forKey: .viaje)
            guard tramos.count <= Self.maximoTramos else {
                throw DecodingError.dataCorruptedError(
                    forKey: .viaje, in: contenedor, debugDescription: "demasiados tramos")
            }
            accion = .viaje(tramos)
        default:
            throw DecodingError.dataCorruptedError(
                forKey: .accion, in: contenedor, debugDescription: "acción desconocida")
        }
    }

    /// Decodifica el cuerpo de una respuesta 200; cualquier desajuste es `respuestaIncompatible`.
    static func decodificar(_ datos: Data) throws -> RespuestaAgente {
        do {
            return try JSONDecoder().decode(RespuestaAgente.self, from: datos)
        } catch {
            throw ErrorConsulta.respuestaIncompatible
        }
    }
}
