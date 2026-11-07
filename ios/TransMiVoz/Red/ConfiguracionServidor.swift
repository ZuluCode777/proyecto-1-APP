import Foundation

/// Motivo por el que una dirección de servidor no se acepta.
enum ErrorOrigen: Error, Equatable, Sendable {
    case vacio
    case malFormado
    case noEsHttps
    case traeCredenciales
    case traeRutaOParametros

    var mensaje: String {
        switch self {
        case .vacio: return "Escribe la dirección del servidor."
        case .malFormado: return "La dirección no es válida. Ejemplo: https://servidor.ejemplo"
        case .noEsHttps: return "La dirección debe empezar por https://. La app no usa conexiones sin cifrar."
        case .traeCredenciales: return "No escribas usuario ni clave dentro de la dirección. La clave va en su propio campo."
        case .traeRutaOParametros: return "Escribe solo el origen, sin ruta ni parámetros. Ejemplo: https://servidor.ejemplo"
        }
    }
}

/// Origen HTTPS único del backend: esquema + host (+ puerto). Sin credenciales,
/// ruta, parámetros ni fragmento, para que la clave nunca viaje por la URL ni se
/// envíe a otro origen.
struct OrigenServidor: Equatable, Hashable, Sendable {
    let esquemaYAutoridad: String

    static func analizar(_ texto: String) -> Result<OrigenServidor, ErrorOrigen> {
        let limpio = texto.trimmingCharacters(in: .whitespacesAndNewlines)
        if limpio.isEmpty { return .failure(.vacio) }
        guard let partes = URLComponents(string: limpio), partes.scheme != nil else {
            // Sin esquema («servidor.ejemplo») también se rechaza: se exige https explícito.
            return URLComponents(string: limpio) == nil ? .failure(.malFormado) : .failure(.noEsHttps)
        }
        guard partes.scheme?.lowercased() == "https" else { return .failure(.noEsHttps) }
        guard let host = partes.host, !host.isEmpty else { return .failure(.malFormado) }
        if partes.user != nil || partes.password != nil { return .failure(.traeCredenciales) }
        if partes.query != nil || partes.fragment != nil { return .failure(.traeRutaOParametros) }
        if !(partes.path.isEmpty || partes.path == "/") { return .failure(.traeRutaOParametros) }
        var autoridad = "https://\(host.lowercased())"
        if let puerto = partes.port { autoridad += ":\(puerto)" }
        return .success(OrigenServidor(esquemaYAutoridad: autoridad))
    }

    /// URL de `POST /api/agent`.
    var urlAgente: URL {
        // `esquemaYAutoridad` solo se construye en `analizar`, que ya validó la forma.
        URL(string: esquemaYAutoridad + "/api/agent")!
    }
}

/// Clave de acceso del servidor (HTTP Basic). Su descripción nunca muestra el
/// valor, para que no se filtre a registros ni a mensajes.
struct ClaveAcceso: Sendable, Equatable, CustomStringConvertible, CustomDebugStringConvertible {
    let valor: String

    /// El servidor ignora el usuario y compara solo la clave (`lib/access.ts`).
    static let usuarioFijo = "transmivoz"

    var description: String { "ClaveAcceso(‹oculta›)" }
    var debugDescription: String { description }

    /// Valor de la cabecera `Authorization`. La clave puede contener `:`; el
    /// servidor separa por el primer `:` (RFC 7617).
    var cabeceraBasic: String {
        let credenciales = Data("\(Self.usuarioFijo):\(valor)".utf8)
        return "Basic " + credenciales.base64EncodedString()
    }
}

/// Configuración vigente para hablar con el backend.
struct ConfiguracionServidor: Sendable, Equatable {
    let origen: OrigenServidor
    let clave: ClaveAcceso?
}
