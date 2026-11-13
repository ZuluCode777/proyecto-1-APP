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
///
/// Solo `analizar` crea valores: valida host y puerto ya decodificados y
/// construye con `URLComponents` el texto del origen y la URL del endpoint, así
/// que `urlAgente` siempre existe y apunta al host y puerto validados.
struct OrigenServidor: Equatable, Hashable, Sendable {
    let esquemaYAutoridad: String
    /// URL de `POST /api/agent`.
    let urlAgente: URL

    private static let rutaAgente = "/api/agent"
    private static let rutaAnuncios = "/api/anuncios"

    /// URL de `GET /api/anuncios`: el mismo origen ya validado (host, puerto y esquema) con otra ruta.
    var urlAnuncios: URL? {
        guard var partes = URLComponents(url: urlAgente, resolvingAgainstBaseURL: false) else { return nil }
        partes.path = Self.rutaAnuncios
        return partes.url
    }

    /// URL de `POST /api/planificador`: el mismo origen validado que `urlAgente`, con otro endpoint.
    var urlPlanificador: URL {
        urlAgente.deletingLastPathComponent().appendingPathComponent("planificador")
    }

    private init(esquemaYAutoridad: String, urlAgente: URL) {
        self.esquemaYAutoridad = esquemaYAutoridad
        self.urlAgente = urlAgente
    }

    static func analizar(_ texto: String) -> Result<OrigenServidor, ErrorOrigen> {
        let limpio = texto.trimmingCharacters(in: .whitespacesAndNewlines)
        if limpio.isEmpty { return .failure(.vacio) }
        guard let partes = URLComponents(string: limpio), partes.scheme != nil else {
            // Sin esquema («servidor.ejemplo») también se rechaza: se exige https explícito.
            return URLComponents(string: limpio) == nil ? .failure(.malFormado) : .failure(.noEsHttps)
        }
        guard partes.scheme?.lowercased() == "https" else { return .failure(.noEsHttps) }
        guard let hostLeido = partes.host, !hostLeido.isEmpty else { return .failure(.malFormado) }
        if partes.user != nil || partes.password != nil { return .failure(.traeCredenciales) }
        if partes.query != nil || partes.fragment != nil { return .failure(.traeRutaOParametros) }
        if !(partes.path.isEmpty || partes.path == "/") { return .failure(.traeRutaOParametros) }
        // `host` llega decodificado (`%40` → `@`): se valida ese valor, no el texto escrito.
        let host = sinCorchetes(hostLeido).lowercased()
        guard hostValido(host), case .success(let puerto) = puerto(de: partes),
              let (autoridad, endpoint) = construir(host: host, puerto: puerto)
        else { return .failure(.malFormado) }
        return .success(OrigenServidor(esquemaYAutoridad: autoridad, urlAgente: endpoint))
    }

    private static func sinCorchetes(_ host: String) -> String {
        host.hasPrefix("[") && host.hasSuffix("]") ? String(host.dropFirst().dropLast()) : host
    }

    /// Nombre (letras, dígitos, `-`, `.`, `_`; Unicode permitido) o IPv6 literal.
    /// Todo lo demás —`@ : / ? # % [ ]`, espacios, control— se rechaza.
    private static func hostValido(_ host: String) -> Bool {
        if host.contains(":") {
            var destino = in6_addr()
            return inet_pton(AF_INET6, host, &destino) == 1
        }
        let extras = CharacterSet(charactersIn: "-._")
        return !host.isEmpty && host.unicodeScalars.allSatisfy {
            CharacterSet.alphanumerics.contains($0) || extras.contains($0)
        }
    }

    /// Puerto explícito válido (1–65535) o `nil` si no hay. Falla si el texto del
    /// puerto no es numérico o `URLComponents` lo descartó (p. ej. desbordado).
    private static func puerto(de partes: URLComponents) -> Result<Int?, ErrorOrigen> {
        guard let rango = partes.rangeOfPort, let cadena = partes.string, !cadena[rango].isEmpty else {
            return partes.port == nil ? .success(nil) : .failure(.malFormado)
        }
        guard let numero = Int(cadena[rango]), cadena[rango].allSatisfy({ $0.isASCII && $0.isNumber }),
              (1...65535).contains(numero), partes.port == numero
        else { return .failure(.malFormado) }
        return .success(numero)
    }

    /// Construye con los setters nativos y comprueba el resultado. Un IPv6 se
    /// prueba con y sin corchetes porque `URLComponents` varía entre versiones.
    private static func construir(host: String, puerto: Int?) -> (autoridad: String, endpoint: URL)? {
        for candidato in host.contains(":") ? ["[\(host)]", host] : [host] {
            var c = URLComponents()
            c.scheme = "https"
            c.host = candidato
            c.port = puerto
            guard let autoridad = c.string else { continue }
            c.path = rutaAgente
            if let url = c.url, estructuraValida(url, host: host, puerto: puerto) { return (autoridad, url) }
        }
        return nil
    }

    /// El endpoint no lleva credenciales, parámetros ni fragmento y conserva host y puerto.
    private static func estructuraValida(_ url: URL, host: String, puerto: Int?) -> Bool {
        guard let c = URLComponents(url: url, resolvingAgainstBaseURL: false),
              let hostFinal = c.host.map(sinCorchetes)?.lowercased(), !hostFinal.isEmpty
        else { return false }
        let basico = c.scheme == "https" && c.port == puerto && c.path == rutaAgente
            && c.user == nil && c.password == nil && c.query == nil && c.fragment == nil
        guard basico else { return false }
        // Un host Unicode puede salir en punycode; uno ASCII debe coincidir exactamente.
        guard host.allSatisfy(\.isASCII) else { return true }
        let literal = host.contains(":") ? "[\(host)]" : host
        return hostFinal == host && url.absoluteString == "https://\(literal)\(puerto.map { ":\($0)" } ?? "")\(rutaAgente)"
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
