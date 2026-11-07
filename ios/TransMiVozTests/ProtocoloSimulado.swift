import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Qué hace la «red» simulada ante una petición.
enum ComportamientoRed {
    case responder(estado: Int, cabeceras: [String: String], cuerpo: Data)
    case fallar(URLError.Code)
    /// No responde nunca (para probar plazo y cancelación).
    case colgar
}

/// `URLProtocol` que intercepta TODA la red de la sesión de pruebas: nada sale
/// del proceso, así que las pruebas no necesitan servidor ni secretos.
final class ProtocoloSimulado: URLProtocol {
    private static let candado = NSLock()
    private static var _manejador: ((URLRequest) -> ComportamientoRed)?
    private static var _peticiones: [URLRequest] = []

    static var manejador: ((URLRequest) -> ComportamientoRed)? {
        get { candado.lock(); defer { candado.unlock() }; return _manejador }
        set { candado.lock(); _manejador = newValue; candado.unlock() }
    }

    /// Peticiones recibidas, con el cuerpo ya leído en `httpBody`.
    static var peticiones: [URLRequest] {
        candado.lock(); defer { candado.unlock() }; return _peticiones
    }

    static func reiniciar() {
        candado.lock(); _manejador = nil; _peticiones = []; candado.unlock()
    }

    static func sesion() -> URLSession {
        let configuracion = URLSessionConfiguration.ephemeral
        configuracion.protocolClasses = [ProtocoloSimulado.self]
        return URLSession(configuration: configuracion)
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        var copia = request
        if copia.httpBody == nil, let flujo = request.httpBodyStream {
            flujo.open()
            var datos = Data()
            var buffer = [UInt8](repeating: 0, count: 1024)
            while flujo.hasBytesAvailable {
                let n = flujo.read(&buffer, maxLength: buffer.count)
                if n <= 0 { break }
                datos.append(buffer, count: n)
            }
            flujo.close()
            copia.httpBody = datos
        }
        Self.candado.lock()
        Self._peticiones.append(copia)
        let manejador = Self._manejador
        Self.candado.unlock()

        switch manejador?(copia) ?? .fallar(.notConnectedToInternet) {
        case .responder(let estado, let cabeceras, let cuerpo):
            let respuesta = HTTPURLResponse(url: request.url!, statusCode: estado, httpVersion: "HTTP/1.1", headerFields: cabeceras)!
            client?.urlProtocol(self, didReceive: respuesta, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: cuerpo)
            client?.urlProtocolDidFinishLoading(self)
        case .fallar(let codigo):
            client?.urlProtocol(self, didFailWithError: URLError(codigo))
        case .colgar:
            break
        }
    }

    override func stopLoading() {}
}
