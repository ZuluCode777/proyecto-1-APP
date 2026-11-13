import XCTest
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
@testable import TransMiVoz

/// Cliente de anuncios contra la «red» simulada (`ProtocoloSimulado`): nada sale del proceso ni usa un servidor real.
final class ClienteAnunciosHTTPTests: XCTestCase {
    private let origen = try! OrigenServidor.analizar("https://servidor.ejemplo").get()
    private let claveInventada = ClaveAcceso(valor: "clave-inventada-de-prueba")

    override func setUp() {
        super.setUp()
        ProtocoloSimulado.reiniciar()
    }

    override func tearDown() {
        ProtocoloSimulado.reiniciar()
        super.tearDown()
    }

    private func cliente(esperaMaxima: TimeInterval = 5, configurado: Bool = true) -> ClienteAnunciosHTTP {
        let configuracion: ConfiguracionServidor? = configurado ? ConfiguracionServidor(origen: origen, clave: claveInventada) : nil
        return ClienteAnunciosHTTP(sesion: ProtocoloSimulado.sesion(), esperaMaxima: esperaMaxima) { configuracion }
    }

    private func responder(_ estado: Int, _ json: String = "", cabeceras: [String: String] = [:]) {
        ProtocoloSimulado.manejador = { _ in .responder(estado: estado, cabeceras: cabeceras, cuerpo: Data(json.utf8)) }
    }

    private func esperarError(_ esperado: ErrorConsulta, cliente: ClienteAnunciosHTTP? = nil, file: StaticString = #filePath, line: UInt = #line) async {
        do {
            _ = try await (cliente ?? self.cliente()).consultar()
            XCTFail("se esperaba \(esperado)", file: file, line: line)
        } catch {
            XCTAssertEqual(error as? ErrorConsulta, esperado, file: file, line: line)
        }
    }

    func testRespuesta200SeDecodifica() async throws {
        responder(200, FixturesAnuncios.activa)
        let respuesta = try await cliente().consultar()
        XCTAssertEqual(respuesta.fuente.estado, .activa)
        XCTAssertEqual(respuesta.anuncios.map(\.identificador), ["A-1", "A-2"])
    }

    func testPeticionEsGetBasicSinCuerpoNiParametros() async throws {
        responder(200, FixturesAnuncios.activa)
        _ = try await cliente().consultar()
        let peticion = try XCTUnwrap(ProtocoloSimulado.peticiones.first)
        XCTAssertEqual(peticion.httpMethod, "GET")
        XCTAssertEqual(peticion.url?.absoluteString, "https://servidor.ejemplo/api/anuncios")
        XCTAssertEqual(peticion.value(forHTTPHeaderField: "Authorization"), claveInventada.cabeceraBasic)
        XCTAssertEqual(peticion.value(forHTTPHeaderField: "Accept"), "application/json")
        XCTAssertNil(peticion.httpBody)
        // La clave nunca viaja por la URL.
        XCTAssertFalse(peticion.url?.absoluteString.contains("clave-inventada") ?? true)
        XCTAssertNil(peticion.url?.query)
    }

    /// La petición real va al host y puerto validados, sin credenciales en la URL.
    func testPeticionConservaHostYPuertoValidados() async throws {
        responder(200, FixturesAnuncios.activa)
        let origenConPuerto = try OrigenServidor.analizar("https://Servidor.Ejemplo:8443").get()
        let cliente = ClienteAnunciosHTTP(sesion: ProtocoloSimulado.sesion()) {
            ConfiguracionServidor(origen: origenConPuerto, clave: self.claveInventada)
        }
        _ = try await cliente.consultar()
        let url = try XCTUnwrap(ProtocoloSimulado.peticiones.first?.url)
        XCTAssertEqual(url.absoluteString, "https://servidor.ejemplo:8443/api/anuncios")
        let partes = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false))
        XCTAssertEqual(partes.host, "servidor.ejemplo")
        XCTAssertEqual(partes.port, 8443)
        XCTAssertNil(partes.user)
        XCTAssertNil(partes.password)
    }

    func testSinClaveNoEnviaAuthorization() async throws {
        responder(200, FixturesAnuncios.activa)
        let sinClave = ClienteAnunciosHTTP(sesion: ProtocoloSimulado.sesion()) { ConfiguracionServidor(origen: self.origen, clave: nil) }
        _ = try await sinClave.consultar()
        XCTAssertNil(ProtocoloSimulado.peticiones.first?.value(forHTTPHeaderField: "Authorization"))
    }

    func testSinServidorConfiguradoNoTocaLaRed() async {
        await esperarError(.servidorNoConfigurado, cliente: cliente(configurado: false))
        XCTAssertTrue(ProtocoloSimulado.peticiones.isEmpty)
    }

    func testError401() async {
        // El servidor real envía WWW-Authenticate. swift-corelibs-foundation (Linux)
        // se cuelga con ese desafío simulado, así que solo se incluye en Apple.
        #if os(Linux)
        let cabeceras: [String: String] = [:]
        #else
        let cabeceras = ["WWW-Authenticate": #"Basic realm="TransMiVoz", charset="UTF-8""#]
        #endif
        responder(401, "Hace falta la clave de TransMiVoz.", cabeceras: cabeceras)
        await esperarError(.noAutorizado)
    }

    func testError429ConYSinRetryAfter() async {
        responder(429, "x", cabeceras: ["Retry-After": "42"])
        await esperarError(.demasiadasPeticiones(reintentarEnSegundos: 42))
        responder(429, "x")
        await esperarError(.demasiadasPeticiones(reintentarEnSegundos: nil))
    }

    func testOtrosEstados() async {
        for (estado, esperado): (Int, ErrorConsulta) in [
            (503, .servicioNoDisponible), (500, .errorDelServidor(estado: 500)), (404, .errorDelServidor(estado: 404)),
            (302, .redireccionNoPermitida),
        ] {
            responder(estado, "x")
            await esperarError(esperado)
        }
    }

    func testRespuestaIncompatible() async {
        for json in ["no es json", "", FixturesHTTP.ninguna, FixturesHTTP.noEsObjeto] {
            responder(200, json)
            await esperarError(.respuestaIncompatible)
        }
    }

    func testRespuestaDemasiadoGrandeSeRechaza() async {
        responder(200, String(repeating: " ", count: ClienteAnunciosHTTP.maximoBytesRespuesta + 1))
        await esperarError(.respuestaIncompatible)
    }

    func testSinConexion() async {
        for codigo in [URLError.Code.notConnectedToInternet, .networkConnectionLost, .cannotFindHost, .cannotConnectToHost] {
            ProtocoloSimulado.manejador = { _ in .fallar(codigo) }
            await esperarError(.sinConexion)
        }
    }

    func testFallosDeTLS() async {
        ProtocoloSimulado.manejador = { _ in .fallar(.serverCertificateUntrusted) }
        await esperarError(.conexionNoSegura)
    }

    func testTiempoAgotadoPorPlazoTotal() async {
        ProtocoloSimulado.manejador = { _ in .colgar }
        await esperarError(.tiempoAgotado, cliente: cliente(esperaMaxima: 0.3))
    }

    func testCancelacionDeLaTareaLanzaCancelada() async {
        ProtocoloSimulado.manejador = { _ in .colgar }
        let cliente = self.cliente(esperaMaxima: 30)
        let tarea = Task { try await cliente.consultar() }
        try? await Task.sleep(nanoseconds: 200_000_000)
        tarea.cancel()
        do {
            _ = try await tarea.value
            XCTFail("se esperaba cancelación")
        } catch {
            XCTAssertEqual(error as? ErrorConsulta, .cancelada)
        }
    }
}
