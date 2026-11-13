import XCTest
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
@testable import TransMiVoz

/// Cliente del planificador con la red SIMULADA (`ProtocoloSimulado`): nada sale del proceso. Comprueba que la
/// selección viaja como datos estructurados (nunca como una frase), la autenticación, y cada estado HTTP.
final class ClientePlanificadorHTTPTests: XCTestCase {
    private let origen = try! OrigenServidor.analizar("https://servidor.ejemplo").get()
    private let claveInventada = ClaveAcceso(valor: "clave-inventada-de-prueba")
    private let norte = "Estación Ejemplo Norte"
    private let sur = "Estación Ejemplo Sur"

    override func setUp() {
        super.setUp()
        ProtocoloSimulado.reiniciar()
    }

    override func tearDown() {
        ProtocoloSimulado.reiniciar()
        super.tearDown()
    }

    private func cliente(esperaMaxima: TimeInterval = 5, configurado: Bool = true) -> ClientePlanificadorHTTP {
        let configuracion: ConfiguracionServidor? = configurado ? ConfiguracionServidor(origen: origen, clave: claveInventada) : nil
        return ClientePlanificadorHTTP(sesion: ProtocoloSimulado.sesion(), esperaMaxima: esperaMaxima) { configuracion }
    }

    private func responder(_ estado: Int, _ json: String = "", cabeceras: [String: String] = [:]) {
        ProtocoloSimulado.manejador = { _ in .responder(estado: estado, cabeceras: cabeceras, cuerpo: Data(json.utf8)) }
    }

    /// El cuerpo de la última petición como objeto JSON, para compararlo sin depender del orden de las claves.
    private func cuerpoEnviado(file: StaticString = #filePath, line: UInt = #line) throws -> NSDictionary {
        let datos = try XCTUnwrap(ProtocoloSimulado.peticiones.last?.httpBody, file: file, line: line)
        return try XCTUnwrap(try JSONSerialization.jsonObject(with: datos) as? NSDictionary, file: file, line: line)
    }

    private func objeto(_ json: String) throws -> NSDictionary {
        try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(json.utf8)) as? NSDictionary)
    }

    private func esperarError<R>(
        _ esperado: ErrorConsulta, file: StaticString = #filePath, line: UInt = #line,
        _ operacion: () async throws -> R
    ) async {
        do {
            _ = try await operacion()
            XCTFail("se esperaba \(esperado)", file: file, line: line)
        } catch {
            XCTAssertEqual(error as? ErrorConsulta, esperado, file: file, line: line)
        }
    }

    // MARK: Peticiones estructuradas

    func testBuscarRutasEnviaPostConBasicYSoloDatosEstructurados() async throws {
        responder(200, FixturesPlanificador.buscar)
        let r = try await cliente().buscarRutas(consulta: "  Z99 ")
        XCTAssertEqual(r.rutas.count, 2)

        let peticion = try XCTUnwrap(ProtocoloSimulado.peticiones.first)
        XCTAssertEqual(peticion.httpMethod, "POST")
        XCTAssertEqual(peticion.url?.absoluteString, "https://servidor.ejemplo/api/planificador")
        XCTAssertEqual(peticion.value(forHTTPHeaderField: "Content-Type"), "application/json")
        XCTAssertEqual(peticion.value(forHTTPHeaderField: "Authorization"), claveInventada.cabeceraBasic)
        XCTAssertNil(peticion.url?.query)
        XCTAssertFalse(peticion.url?.absoluteString.contains("clave-inventada") ?? true)
        XCTAssertEqual(try cuerpoEnviado(), try objeto(FixturesPlanificador.peticionBuscar), "consulta recortada")
    }

    func testDetalleYLugaresEnvianSuOperacion() async throws {
        responder(200, FixturesPlanificador.detalle)
        _ = try await cliente().detalleRuta(codigo: " Z99")
        XCTAssertEqual(try cuerpoEnviado(), try objeto(FixturesPlanificador.peticionDetalle))

        responder(200, FixturesPlanificador.lugares)
        _ = try await cliente().listarLugares()
        XCTAssertEqual(try cuerpoEnviado(), try objeto(FixturesPlanificador.peticionLugares))
    }

    /// La selección llega al servidor como los dos nombres elegidos, cada uno en su campo: ni una frase ni un campo `message`.
    func testPlanearViajeEnviaOrigenYDestinoComoDatosNoComoFrase() async throws {
        responder(200, FixturesPlanificador.viajeOperativo)
        let plan = try await cliente().planearViaje(origen: norte, destino: sur)
        XCTAssertEqual(plan.resultado, .operativo)

        let cuerpo = try cuerpoEnviado()
        XCTAssertEqual(cuerpo, try objeto(FixturesPlanificador.peticionViaje))
        XCTAssertEqual(cuerpo["origen"] as? String, norte)
        XCTAssertEqual(cuerpo["destino"] as? String, sur)
        XCTAssertNil(cuerpo["message"], "no se arma ninguna frase para que el servidor la interprete")
        XCTAssertEqual(Set(cuerpo.allKeys.compactMap { $0 as? String }), ["operacion", "origen", "destino"])
        XCTAssertEqual(ProtocoloSimulado.peticiones.last?.url?.absoluteString, "https://servidor.ejemplo/api/planificador")
    }

    func testSinClaveNoEnviaAuthorization() async throws {
        responder(200, FixturesPlanificador.lugares)
        let sinClave = ClientePlanificadorHTTP(sesion: ProtocoloSimulado.sesion()) {
            ConfiguracionServidor(origen: self.origen, clave: nil)
        }
        _ = try await sinClave.listarLugares()
        XCTAssertNil(ProtocoloSimulado.peticiones.first?.value(forHTTPHeaderField: "Authorization"))
    }

    func testEntradaInvalidaYSinServidorNoTocanLaRed() async {
        await esperarError(.peticionRechazada) { try await self.cliente().buscarRutas(consulta: "   ") }
        await esperarError(.peticionRechazada) {
            try await self.cliente().buscarRutas(consulta: String(repeating: "a", count: EntradaPlanificador.maximoConsulta + 1))
        }
        await esperarError(.peticionRechazada) { try await self.cliente().detalleRuta(codigo: "") }
        await esperarError(.peticionRechazada) { try await self.cliente().planearViaje(origen: "", destino: self.sur) }
        await esperarError(.servidorNoConfigurado) { try await self.cliente(configurado: false).listarLugares() }
        XCTAssertTrue(ProtocoloSimulado.peticiones.isEmpty)
    }

    // MARK: Estados HTTP

    func testUnLugarOUnaRutaQueNoEstanEnElCatalogoDanNoEncontrado() async {
        responder(404, #"{"error":"no-encontrado"}"#)
        await esperarError(.noEncontrado) { try await self.cliente().detalleRuta(codigo: "NOEXISTE") }
        await esperarError(.noEncontrado) { try await self.cliente().planearViaje(origen: self.norte, destino: self.sur) }
        XCTAssertFalse(ErrorConsulta.noEncontrado.admiteReintento)
    }

    /// Un servidor sin el endpoint (no se ha desplegado) responde un 404 que no es del planificador: es una falla del servidor.
    func testUn404SinElCuerpoDelPlanificadorEsUnaFallaDelServidor() async {
        for cuerpo in ["<html>404 This page could not be found</html>", "", #"{"error":"otra-cosa"}"#] {
            responder(404, cuerpo)
            await esperarError(.errorDelServidor(estado: 404)) { try await self.cliente().listarLugares() }
        }
    }

    func testOtrosEstadosSeClasificanComoLaConsulta() async {
        for (estado, esperado): (Int, ErrorConsulta) in [
            (400, .peticionRechazada), (401, .noAutorizado), (413, .mensajeRechazadoPorLargo), (503, .servicioNoDisponible),
            (500, .errorDelServidor(estado: 500)), (302, .redireccionNoPermitida),
        ] {
            responder(estado, "x")
            await esperarError(esperado) { try await self.cliente().listarLugares() }
        }
        responder(429, "x", cabeceras: ["Retry-After": "7"])
        await esperarError(.demasiadasPeticiones(reintentarEnSegundos: 7)) { try await self.cliente().listarLugares() }
    }

    func testRespuestaIncompatibleSeRechaza() async {
        for json in ["no es json", "", FixturesPlanificador.detalleLatitudInvalida, FixturesPlanificador.viajeOperativoSinTramos] {
            responder(200, json)
            await esperarError(.respuestaIncompatible) { try await self.cliente().planearViaje(origen: self.norte, destino: self.sur) }
        }
        responder(200, String(repeating: " ", count: ClientePlanificadorHTTP.maximoBytesRespuesta + 1))
        await esperarError(.respuestaIncompatible) { try await self.cliente().listarLugares() }
    }

    func testSinConexionYPlazoAgotado() async {
        ProtocoloSimulado.manejador = { _ in .fallar(.notConnectedToInternet) }
        await esperarError(.sinConexion) { try await self.cliente().listarLugares() }
        ProtocoloSimulado.manejador = { _ in .colgar }
        await esperarError(.tiempoAgotado) { try await self.cliente(esperaMaxima: 0.3).listarLugares() }
    }

    func testCancelarLaTareaLanzaCancelada() async {
        ProtocoloSimulado.manejador = { _ in .colgar }
        let cliente = self.cliente(esperaMaxima: 30)
        let tarea = Task { try await cliente.listarLugares() }
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

/// La entrada del planificador y la URL de su endpoint.
final class EntradaPlanificadorTests: XCTestCase {
    private func codificada(_ peticion: PeticionPlanificador) throws -> NSDictionary {
        let datos = try JSONEncoder().encode(peticion)
        return try XCTUnwrap(try JSONSerialization.jsonObject(with: datos) as? NSDictionary)
    }

    func testCadaPeticionSeCodificaConLasClavesDelContrato() throws {
        XCTAssertEqual(try codificada(.buscarRutas(consulta: "Z99")), ["operacion": "buscar-rutas", "consulta": "Z99"])
        XCTAssertEqual(try codificada(.detalleRuta(codigo: "Z99")), ["operacion": "detalle-ruta", "codigo": "Z99"])
        XCTAssertEqual(try codificada(.listarLugares), ["operacion": "listar-lugares"])
        XCTAssertEqual(
            try codificada(.planearViaje(origen: "A", destino: "B")),
            ["operacion": "planear-viaje", "origen": "A", "destino": "B"])
    }

    func testLaValidacionRecortaYRechazaLoQueElServidorRechazaria() {
        XCTAssertEqual(try? PeticionPlanificador.buscarRutas(consulta: "  B23 ").validada().get(), .buscarRutas(consulta: "B23"))
        XCTAssertNotNil(try? PeticionPlanificador.buscarRutas(consulta: String(repeating: "a", count: 80)).validada().get())
        XCTAssertNil(try? PeticionPlanificador.buscarRutas(consulta: String(repeating: "a", count: 81)).validada().get())
        XCTAssertNil(try? PeticionPlanificador.buscarRutas(consulta: " \n ").validada().get())
        XCTAssertNil(try? PeticionPlanificador.detalleRuta(codigo: String(repeating: "A", count: 13)).validada().get())
        XCTAssertNil(try? PeticionPlanificador.planearViaje(origen: "A", destino: " ").validada().get())
        XCTAssertNotNil(try? PeticionPlanificador.listarLugares.validada().get())
    }

    func testLaUrlDelPlanificadorConservaHostYPuertoValidados() throws {
        let simple = try OrigenServidor.analizar("https://servidor.ejemplo").get()
        XCTAssertEqual(simple.urlPlanificador.absoluteString, "https://servidor.ejemplo/api/planificador")
        let conPuerto = try OrigenServidor.analizar("https://Servidor.Ejemplo:8443").get()
        XCTAssertEqual(conPuerto.urlPlanificador.absoluteString, "https://servidor.ejemplo:8443/api/planificador")
        XCTAssertNil(URLComponents(url: conPuerto.urlPlanificador, resolvingAgainstBaseURL: false)?.user)
    }
}
