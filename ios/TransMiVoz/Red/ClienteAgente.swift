import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Cliente del asistente de transporte. Toda la planificación vive en el
/// backend Next; la app solo envía el texto y valida la respuesta.
protocol ClienteAgente: Sendable {
    /// `origenPendiente`: el origen que la persona dijo en el turno anterior (aclaración, EA-19); el servidor no guarda historial.
    func consultar(texto: String, origenPendiente: String?) async throws -> RespuestaAgente
}

extension ClienteAgente {
    func consultar(texto: String) async throws -> RespuestaAgente {
        try await consultar(texto: texto, origenPendiente: nil)
    }
}

/// Rechaza toda redirección: `Authorization` no debe viajar a otro origen. También la usa `ClienteAnunciosHTTP`.
final class SinRedirecciones: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }

    /// Un 401 con `WWW-Authenticate` no abre diálogos ni reintenta con otras
    /// credenciales: la respuesta 401 llega tal cual y se muestra como error.
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        completionHandler(.performDefaultHandling, nil)
    }
}

/// `POST /api/agent` con HTTP Basic sobre HTTPS, sin reintentos automáticos.
struct ClienteAgenteHTTP: ClienteAgente {
    /// Propuesta de `arquitectura-y-experimentos.md` (12 s); criterio de UX, no latencia medida.
    static let esperaMaximaPorDefecto: TimeInterval = 12
    static let maximoBytesRespuesta = 1_000_000

    private let sesion: URLSession

    /// Sesión sin caché, cookies ni credenciales persistentes: la clave solo
    /// viaja en la cabecera que arma este cliente.
    static func sesionPrivada() -> URLSession {
        let configuracion = URLSessionConfiguration.ephemeral
        configuracion.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuracion.urlCache = nil
        configuracion.httpCookieStorage = nil
        configuracion.httpShouldSetCookies = false
        configuracion.urlCredentialStorage = nil
        return URLSession(configuration: configuracion)
    }
    private let configuracion: @Sendable () async -> ConfiguracionServidor?
    private let esperaMaxima: TimeInterval

    init(
        sesion: URLSession = ClienteAgenteHTTP.sesionPrivada(),
        esperaMaxima: TimeInterval = ClienteAgenteHTTP.esperaMaximaPorDefecto,
        configuracion: @escaping @Sendable () async -> ConfiguracionServidor?
    ) {
        self.sesion = sesion
        self.esperaMaxima = esperaMaxima
        self.configuracion = configuracion
    }

    func consultar(texto: String, origenPendiente: String?) async throws -> RespuestaAgente {
        let limpio = try EntradaConsulta.validar(texto).get()
        guard let configuracion = await configuracion() else { throw ErrorConsulta.servidorNoConfigurado }

        var peticion = URLRequest(
            url: configuracion.origen.urlAgente,
            cachePolicy: .reloadIgnoringLocalCacheData,
            timeoutInterval: esperaMaxima)
        peticion.httpMethod = "POST"
        peticion.setValue("application/json", forHTTPHeaderField: "Content-Type")
        peticion.setValue("application/json", forHTTPHeaderField: "Accept")
        if let clave = configuracion.clave {
            peticion.setValue(clave.cabeceraBasic, forHTTPHeaderField: "Authorization")
        }
        let cuerpo = try JSONEncoder().encode(CuerpoPeticionAgente(message: limpio, origenPendiente: origenPendiente))
        guard cuerpo.count <= EntradaConsulta.maximoBytesCuerpo else {
            throw ErrorConsulta.entradaInvalida(.demasiadoLarga(maximo: EntradaConsulta.maximoCaracteres))
        }
        peticion.httpBody = cuerpo
        let solicitud = peticion

        let datos: Data
        let respuesta: URLResponse
        do {
            (datos, respuesta) = try await conPlazo(esperaMaxima) {
                do {
                    return try await sesion.data(for: solicitud, delegate: SinRedirecciones())
                } catch let error as URLError {
                    throw Self.clasificar(error)
                }
            }
        } catch is CancellationError {
            throw ErrorConsulta.cancelada
        }
        // Cancelada durante la espera: nada de lo recibido se usa.
        try Task.checkCancellation()
        guard let http = respuesta as? HTTPURLResponse else { throw ErrorConsulta.respuestaIncompatible }
        return try Self.interpretar(estado: http.statusCode, cabeceras: http, datos: datos)
    }

    /// Traduce estado HTTP + cuerpo a respuesta o error. Función pura, probada sin red.
    static func interpretar(estado: Int, cabeceras: HTTPURLResponse?, datos: Data) throws -> RespuestaAgente {
        switch estado {
        case 200:
            guard datos.count <= maximoBytesRespuesta else { throw ErrorConsulta.respuestaIncompatible }
            return try RespuestaAgente.decodificar(datos)
        case 300...399: throw ErrorConsulta.redireccionNoPermitida
        case 400: throw ErrorConsulta.peticionRechazada
        case 401: throw ErrorConsulta.noAutorizado
        case 413: throw ErrorConsulta.mensajeRechazadoPorLargo
        case 429:
            throw ErrorConsulta.demasiadasPeticiones(
                reintentarEnSegundos: segundosDeReintento(cabeceras?.value(forHTTPHeaderField: "Retry-After")))
        case 503: throw ErrorConsulta.servicioNoDisponible
        default: throw ErrorConsulta.errorDelServidor(estado: estado)
        }
    }

    /// `Retry-After` en segundos enteros; la forma de fecha HTTP se ignora.
    static func segundosDeReintento(_ valor: String?) -> Int? {
        guard let valor, let segundos = Int(valor.trimmingCharacters(in: .whitespaces)), segundos >= 0 else { return nil }
        return min(segundos, 3_600)
    }

    static func clasificar(_ error: URLError) -> ErrorConsulta {
        switch error.code {
        case .cancelled: return .cancelada
        case .timedOut: return .tiempoAgotado
        case .secureConnectionFailed, .serverCertificateUntrusted, .serverCertificateHasBadDate,
             .serverCertificateHasUnknownRoot, .serverCertificateNotYetValid, .clientCertificateRejected,
             .appTransportSecurityRequiresSecureConnection:
            return .conexionNoSegura
        default: return .sinConexion
        }
    }
}

/// Ejecuta `operacion` con un plazo total. Al vencer cancela la operación y lanza `tiempoAgotado`.
func conPlazo<T: Sendable>(_ segundos: TimeInterval, _ operacion: @escaping @Sendable () async throws -> T) async throws -> T {
    try await withThrowingTaskGroup(of: T.self) { grupo in
        grupo.addTask { try await operacion() }
        grupo.addTask {
            try await Task.sleep(nanoseconds: UInt64(segundos * 1_000_000_000))
            throw ErrorConsulta.tiempoAgotado
        }
        defer { grupo.cancelAll() }
        // El primero en terminar gana; el otro se cancela.
        guard let primero = try await grupo.next() else { throw ErrorConsulta.tiempoAgotado }
        return primero
    }
}
