import XCTest
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
@testable import TransMiVoz

final class ClienteAgenteHTTPTests: XCTestCase {
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

    private func cliente(clave: ClaveAcceso? = nil, esperaMaxima: TimeInterval = 5, configurado: Bool = true) -> ClienteAgenteHTTP {
        let configuracion: ConfiguracionServidor? = configurado ? ConfiguracionServidor(origen: origen, clave: clave ?? claveInventada) : nil
        return ClienteAgenteHTTP(sesion: ProtocoloSimulado.sesion(), esperaMaxima: esperaMaxima) { configuracion }
    }

    private func responder(_ estado: Int, _ json: String = "", cabeceras: [String: String] = [:]) {
        ProtocoloSimulado.manejador = { _ in .responder(estado: estado, cabeceras: cabeceras, cuerpo: Data(json.utf8)) }
    }

    private func esperarError(_ esperado: ErrorConsulta, _ texto: String = "hola", cliente: ClienteAgenteHTTP? = nil, file: StaticString = #filePath, line: UInt = #line) async {
        do {
            _ = try await (cliente ?? self.cliente()).consultar(texto: texto)
            XCTFail("se esperaba \(esperado)", file: file, line: line)
        } catch {
            XCTAssertEqual(error as? ErrorConsulta, esperado, file: file, line: line)
        }
    }

    func testRespuesta200SeDecodifica() async throws {
        responder(200, FixturesHTTP.busqueda)
        let r = try await cliente().consultar(texto: "  buscar ejemplo norte ")
        XCTAssertEqual(r.accion, .busqueda(estacion: "Estación Ejemplo Norte"))
    }

    func testPeticionLlevaBasicPostYSoloMessage() async throws {
        responder(200, FixturesHTTP.ninguna)
        _ = try await cliente().consultar(texto: " hola ")
        let peticion = try XCTUnwrap(ProtocoloSimulado.peticiones.first)
        XCTAssertEqual(peticion.httpMethod, "POST")
        XCTAssertEqual(peticion.url?.absoluteString, "https://servidor.ejemplo/api/agent")
        XCTAssertEqual(peticion.value(forHTTPHeaderField: "Content-Type"), "application/json")
        XCTAssertEqual(peticion.value(forHTTPHeaderField: "Authorization"), claveInventada.cabeceraBasic)
        XCTAssertEqual(String(decoding: peticion.httpBody ?? Data(), as: UTF8.self), #"{"message":"hola"}"#)
        // La clave nunca viaja por la URL.
        XCTAssertFalse(peticion.url?.absoluteString.contains("clave-inventada") ?? true)
        XCTAssertNil(peticion.url?.query)
    }

    func testSinClaveNoEnviaAuthorization() async throws {
        responder(200, FixturesHTTP.ninguna)
        let sinClave = ClienteAgenteHTTP(sesion: ProtocoloSimulado.sesion()) { ConfiguracionServidor(origen: self.origen, clave: nil) }
        _ = try await sinClave.consultar(texto: "hola")
        XCTAssertNil(ProtocoloSimulado.peticiones.first?.value(forHTTPHeaderField: "Authorization"))
    }

    func testEntradaInvalidaNoTocaLaRed() async {
        await esperarError(.entradaInvalida(.vacia), "   ")
        await esperarError(.entradaInvalida(.demasiadoLarga(maximo: 300)), String(repeating: "a", count: 301))
        XCTAssertTrue(ProtocoloSimulado.peticiones.isEmpty)
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

    func testError429ConRetryAfter() async {
        responder(429, FixturesHTTP.limite429, cabeceras: ["Retry-After": "42"])
        await esperarError(.demasiadasPeticiones(reintentarEnSegundos: 42))
    }

    func testError429SinRetryAfterOConFechaHttp() async {
        responder(429, FixturesHTTP.limite429)
        await esperarError(.demasiadasPeticiones(reintentarEnSegundos: nil))
        responder(429, FixturesHTTP.limite429, cabeceras: ["Retry-After": "Wed, 21 Oct 2026 07:28:00 GMT"])
        await esperarError(.demasiadasPeticiones(reintentarEnSegundos: nil))
    }

    func testRetryAfterDesmedidoSeAcota() {
        XCTAssertEqual(ClienteAgenteHTTP.segundosDeReintento("999999"), 3_600)
        XCTAssertNil(ClienteAgenteHTTP.segundosDeReintento("-5"))
        XCTAssertNil(ClienteAgenteHTTP.segundosDeReintento(nil))
    }

    func testOtrosEstados() async {
        for (estado, esperado): (Int, ErrorConsulta) in [
            (400, .peticionRechazada), (413, .mensajeRechazadoPorLargo), (503, .servicioNoDisponible),
            (500, .errorDelServidor(estado: 500)), (502, .errorDelServidor(estado: 502)), (404, .errorDelServidor(estado: 404)),
            (302, .redireccionNoPermitida),
        ] {
            responder(estado, "x")
            await esperarError(esperado)
        }
    }

    func testRespuestaIncompatible() async {
        for json in [FixturesHTTP.accionDesconocida, "no es json", "", FixturesHTTP.noEsObjeto] {
            responder(200, json)
            await esperarError(.respuestaIncompatible)
        }
    }

    func testRespuestaDemasiadoGrandeSeRechaza() async {
        responder(200, String(repeating: " ", count: ClienteAgenteHTTP.maximoBytesRespuesta + 1))
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
        let tarea = Task { try await cliente.consultar(texto: "hola") }
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
