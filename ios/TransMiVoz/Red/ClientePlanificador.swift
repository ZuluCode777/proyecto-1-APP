import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Cliente del planificador compartido (`POST /api/planificador`). Toda la planificación vive en el backend Next:
/// la app envía datos estructurados (un código, un nombre de lugar elegido de la lista) y valida lo que vuelve.
protocol ClientePlanificador: Sendable {
    func buscarRutas(consulta: String) async throws -> ResultadoBusquedaRutas
    func detalleRuta(codigo: String) async throws -> DetalleRuta
    func listarLugares() async throws -> ListaLugares
    func planearViaje(origen: String, destino: String) async throws -> PlanViaje
}

/// `POST /api/planificador` con HTTP Basic sobre HTTPS, sin reintentos automáticos. Reutiliza la sesión privada,
/// el rechazo de redirecciones, el plazo total y la clasificación de errores de `ClienteAgenteHTTP`.
struct ClientePlanificadorHTTP: ClientePlanificador {
    static let maximoBytesRespuesta = ClienteAgenteHTTP.maximoBytesRespuesta

    private let sesion: URLSession
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

    func buscarRutas(consulta: String) async throws -> ResultadoBusquedaRutas {
        try await enviar(.buscarRutas(consulta: consulta))
    }

    func detalleRuta(codigo: String) async throws -> DetalleRuta {
        try await enviar(.detalleRuta(codigo: codigo))
    }

    func listarLugares() async throws -> ListaLugares {
        try await enviar(.listarLugares)
    }

    func planearViaje(origen: String, destino: String) async throws -> PlanViaje {
        try await enviar(.planearViaje(origen: origen, destino: destino))
    }

    private func enviar<Respuesta: RespuestaPlanificador>(_ pedida: PeticionPlanificador) async throws -> Respuesta {
        let peticion = try pedida.validada().get()
        guard let configuracion = await configuracion() else { throw ErrorConsulta.servidorNoConfigurado }

        var solicitud = URLRequest(
            url: configuracion.origen.urlPlanificador,
            cachePolicy: .reloadIgnoringLocalCacheData,
            timeoutInterval: esperaMaxima)
        solicitud.httpMethod = "POST"
        solicitud.setValue("application/json", forHTTPHeaderField: "Content-Type")
        solicitud.setValue("application/json", forHTTPHeaderField: "Accept")
        if let clave = configuracion.clave {
            solicitud.setValue(clave.cabeceraBasic, forHTTPHeaderField: "Authorization")
        }
        let codificador = JSONEncoder()
        codificador.outputFormatting = [.sortedKeys]
        let cuerpo = try codificador.encode(peticion)
        guard cuerpo.count <= EntradaPlanificador.maximoBytesCuerpo else { throw ErrorConsulta.peticionRechazada }
        solicitud.httpBody = cuerpo
        let enviada = solicitud

        let datos: Data
        let respuesta: URLResponse
        do {
            (datos, respuesta) = try await conPlazo(esperaMaxima) {
                do {
                    return try await sesion.data(for: enviada, delegate: SinRedirecciones())
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
    static func interpretar<Respuesta: RespuestaPlanificador>(
        estado: Int, cabeceras: HTTPURLResponse?, datos: Data
    ) throws -> Respuesta {
        switch estado {
        case 200:
            guard datos.count <= maximoBytesRespuesta,
                  let respuesta = try? JSONDecoder().decode(Respuesta.self, from: datos),
                  respuesta.esValida else { throw ErrorConsulta.respuestaIncompatible }
            return respuesta
        case 404 where esCuerpoNoEncontrado(datos):
            throw ErrorConsulta.noEncontrado
        default:
            // Un 404 sin el cuerpo del planificador es un servidor que todavía no tiene el endpoint: falla del servidor.
            throw ClienteAgenteHTTP.errorDeEstado(estado, cabeceras: cabeceras)
        }
    }

    /// El 404 del planificador trae `{"error":"no-encontrado"}`: la ruta o el lugar pedidos no están en el catálogo.
    private static func esCuerpoNoEncontrado(_ datos: Data) -> Bool {
        struct CuerpoError: Decodable { let error: String }
        return (try? JSONDecoder().decode(CuerpoError.self, from: datos))?.error == "no-encontrado"
    }
}
