import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Cliente de los anuncios operativos. El servidor Next decide qué es vigente; la app solo los pide y los valida.
protocol ClienteAnuncios: Sendable {
    func consultar() async throws -> AnunciosRespuesta
}

/// `GET /api/anuncios` con el mismo origen HTTPS, la misma clave HTTP Basic y las mismas reglas que `ClienteAgenteHTTP`:
/// sin redirecciones, sin caché ni reintentos automáticos y con plazo total.
struct ClienteAnunciosHTTP: ClienteAnuncios {
    /// El servidor espera hasta 8 s a la fuente (`lib/anuncios-servidor.ts`); el resto es margen de red.
    static let esperaMaximaPorDefecto: TimeInterval = 12
    static let maximoBytesRespuesta = 1_000_000

    private let sesion: URLSession
    private let configuracion: @Sendable () async -> ConfiguracionServidor?
    private let esperaMaxima: TimeInterval

    init(
        sesion: URLSession = ClienteAgenteHTTP.sesionPrivada(),
        esperaMaxima: TimeInterval = ClienteAnunciosHTTP.esperaMaximaPorDefecto,
        configuracion: @escaping @Sendable () async -> ConfiguracionServidor?
    ) {
        self.sesion = sesion
        self.esperaMaxima = esperaMaxima
        self.configuracion = configuracion
    }

    func consultar() async throws -> AnunciosRespuesta {
        guard let configuracion = await configuracion(), let url = configuracion.origen.urlAnuncios else {
            throw ErrorConsulta.servidorNoConfigurado
        }
        var peticion = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: esperaMaxima)
        peticion.httpMethod = "GET"
        peticion.setValue("application/json", forHTTPHeaderField: "Accept")
        if let clave = configuracion.clave {
            peticion.setValue(clave.cabeceraBasic, forHTTPHeaderField: "Authorization")
        }
        let solicitud = peticion

        let datos: Data
        let respuesta: URLResponse
        do {
            (datos, respuesta) = try await conPlazo(esperaMaxima) {
                do {
                    return try await sesion.data(for: solicitud, delegate: SinRedirecciones())
                } catch let error as URLError {
                    throw ClienteAgenteHTTP.clasificar(error)
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
    static func interpretar(estado: Int, cabeceras: HTTPURLResponse?, datos: Data) throws -> AnunciosRespuesta {
        switch estado {
        case 200:
            guard datos.count <= maximoBytesRespuesta else { throw ErrorConsulta.respuestaIncompatible }
            return try AnunciosRespuesta.decodificar(datos)
        case 300...399: throw ErrorConsulta.redireccionNoPermitida
        case 401: throw ErrorConsulta.noAutorizado
        case 429:
            throw ErrorConsulta.demasiadasPeticiones(
                reintentarEnSegundos: ClienteAgenteHTTP.segundosDeReintento(cabeceras?.value(forHTTPHeaderField: "Retry-After")))
        case 503: throw ErrorConsulta.servicioNoDisponible
        default: throw ErrorConsulta.errorDelServidor(estado: estado)
        }
    }
}
