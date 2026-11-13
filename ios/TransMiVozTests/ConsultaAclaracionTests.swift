import XCTest
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
@testable import TransMiVoz

/// Aclaración entre turnos (EA-19): «Salgo desde Ricaurte» deja el origen pendiente en el iPhone y «Calle 72» lo lleva de
/// vuelta. La regla que entiende la frase es del servidor (`lib/ea19-aclaracion.test.ts`); aquí solo se prueba qué conserva,
/// envía y borra la app. Sin historial remoto: el origen vive en memoria y en la petición.
@MainActor
final class ConsultaAclaracionTests: XCTestCase {
    private let aclaracion = RespuestaAgente(
        texto: "Entendí que sales de Ricaurte. ¿A qué estación quieres ir?", origenPendiente: "Ricaurte")
    private let viaje = RespuestaAgente(texto: "Respuesta del viaje")

    private func dejarCorrer() async { try? await Task.sleep(nanoseconds: 100_000_000) }

    /// Primer turno hecho: «Salgo desde Ricaurte» respondido con la aclaración.
    private func conOrigenPendiente(_ cliente: ClienteControlable) async -> ConsultaModelo {
        let modelo = ConsultaModelo(cliente: cliente)
        modelo.texto = "Salgo desde Ricaurte"
        modelo.enviar()
        await cliente.esperarConsultas(1)
        cliente.responder(.success(aclaracion))
        await dejarCorrer()
        return modelo
    }

    private func enviarCalle72(_ modelo: ConsultaModelo, _ cliente: ClienteControlable, consulta: Int) async {
        modelo.texto = "Calle 72"
        modelo.enviar()
        await cliente.esperarConsultas(consulta)
    }

    func testSalgoDesdeRicaurteYLuegoCalle72ConservaElOrigenPendiente() async {
        let cliente = ClienteControlable()
        let modelo = await conOrigenPendiente(cliente)
        XCTAssertEqual(modelo.origenPendiente, "Ricaurte")
        XCTAssertEqual(modelo.estado, .respuesta(aclaracion))

        await enviarCalle72(modelo, cliente, consulta: 2)
        XCTAssertEqual(cliente.textosRecibidos, ["Salgo desde Ricaurte", "Calle 72"])
        XCTAssertEqual(cliente.origenesRecibidos, [nil, "Ricaurte"], "el segundo turno lleva el origen del primero")
        cliente.responder(.success(viaje), indice: 1)
        await dejarCorrer()
        XCTAssertEqual(modelo.estado, .respuesta(viaje))
        XCTAssertNil(modelo.origenPendiente, "un viaje completo no deja nada pendiente")
    }

    func testSinAclaracionLaPreguntaNoLlevaOrigen() async {
        let cliente = ClienteControlable()
        let modelo = ConsultaModelo(cliente: cliente)
        await enviarCalle72(modelo, cliente, consulta: 1)
        XCTAssertEqual(cliente.origenesRecibidos, [nil])
        cliente.responder(.success(viaje))
    }

    func testCancelarBorraLaAclaracionYUnaRespuestaTardiaNoLaRevive() async {
        let cliente = ClienteControlable()
        let modelo = await conOrigenPendiente(cliente)
        await enviarCalle72(modelo, cliente, consulta: 2)

        modelo.cancelar()
        XCTAssertNil(modelo.origenPendiente, "cancelar borra la aclaración")
        XCTAssertEqual(modelo.estado, .cancelada)
        cliente.responder(.success(aclaracion), indice: 1)  // llega DESPUÉS de cancelar
        await dejarCorrer()
        XCTAssertNil(modelo.origenPendiente, "una respuesta tardía no deja una aclaración")
        XCTAssertEqual(modelo.estado, .cancelada)

        await enviarCalle72(modelo, cliente, consulta: 3)
        XCTAssertNil(cliente.origenesRecibidos[2], "después de cancelar, «Calle 72» ya no lleva el origen")
        cliente.responder(.success(viaje), indice: 2)
    }

    func testLaRespuestaTardiaDelPrimerTurnoCanceladoNoDejaAclaracion() async {
        let cliente = ClienteControlable()
        let modelo = ConsultaModelo(cliente: cliente)
        modelo.texto = "Salgo desde Ricaurte"
        modelo.enviar()
        await cliente.esperarConsultas(1)
        modelo.cancelar()
        cliente.responder(.success(aclaracion))
        await dejarCorrer()
        XCTAssertNil(modelo.origenPendiente)
    }

    func testUnErrorConservaLaAclaracionYReintentarReenviaElOrigen() async {
        let cliente = ClienteControlable()
        let modelo = await conOrigenPendiente(cliente)
        await enviarCalle72(modelo, cliente, consulta: 2)
        cliente.responder(.failure(ErrorConsulta.sinConexion), indice: 1)
        await dejarCorrer()
        XCTAssertEqual(modelo.estado, .error(.sinConexion))
        XCTAssertEqual(modelo.origenPendiente, "Ricaurte", "un error de red no pierde lo que la persona ya dijo")

        modelo.reintentar()
        await cliente.esperarConsultas(3)
        XCTAssertEqual(cliente.textosRecibidos.last, "Calle 72")
        XCTAssertEqual(cliente.origenesRecibidos, [nil, "Ricaurte", "Ricaurte"])
        cliente.responder(.success(viaje), indice: 2)
    }

    func testReintentarTrasCancelarRepiteLoQueSeEnvio() async {
        let cliente = ClienteControlable()
        let modelo = await conOrigenPendiente(cliente)
        await enviarCalle72(modelo, cliente, consulta: 2)
        modelo.cancelar()
        modelo.reintentar()  // acción explícita: repite la pregunta tal como salió, con su origen
        await cliente.esperarConsultas(3)
        XCTAssertEqual(cliente.origenesRecibidos, [nil, "Ricaurte", "Ricaurte"])
        cliente.responder(.success(viaje), indice: 1)
        cliente.responder(.success(viaje), indice: 2)
    }

    func testReintentarDiceConQueOrigenSeReenvia() async {
        let cliente = ClienteControlable()
        let modelo = await conOrigenPendiente(cliente)
        XCTAssertEqual(modelo.etiquetaDeRepetir("Reintentar"), "Reintentar", "el primer turno salió sin origen")
        await enviarCalle72(modelo, cliente, consulta: 2)
        XCTAssertEqual(modelo.etiquetaDeRepetir("Reintentar"), "Reintentar con origen Ricaurte")
        XCTAssertEqual(modelo.etiquetaDeRepetir("Volver a consultar"), "Volver a consultar con origen Ricaurte")
        modelo.cancelar()
        XCTAssertNil(modelo.origenPendiente)
        XCTAssertEqual(modelo.etiquetaDeRepetir("Reintentar"), "Reintentar con origen Ricaurte", "repite lo que salió, con su origen")
    }

    func testUnaRespuestaNuevaSustituyeLaAclaracion() async {
        let cliente = ClienteControlable()
        let modelo = await conOrigenPendiente(cliente)
        modelo.texto = "Salgo desde Portal Norte"
        modelo.enviar()
        await cliente.esperarConsultas(2)
        cliente.responder(.success(RespuestaAgente(texto: "Entendí que sales de Portal Norte.", origenPendiente: "Portal Norte")), indice: 1)
        await dejarCorrer()
        XCTAssertEqual(modelo.origenPendiente, "Portal Norte")
    }

    func testEnElEscenarioMetroLaAclaracionNoViaja() async {
        let cliente = ClienteControlable()
        let modelo = await conOrigenPendiente(cliente)
        modelo.escenario = .metroFuturo
        await enviarCalle72(modelo, cliente, consulta: 2)
        XCTAssertEqual(cliente.textosRecibidos[1], "Metro: Calle 72")
        XCTAssertNil(cliente.origenesRecibidos[1])
        cliente.responder(.success(viaje), indice: 1)
    }

    func testOlvidarOrigenBorraLaAclaracion() async {
        let cliente = ClienteControlable()
        let modelo = await conOrigenPendiente(cliente)
        modelo.olvidarOrigenPendiente()
        XCTAssertNil(modelo.origenPendiente)
        await enviarCalle72(modelo, cliente, consulta: 2)
        XCTAssertNil(cliente.origenesRecibidos[1])
        cliente.responder(.success(viaje), indice: 1)
    }

    func testSalirConservaLaAclaracionQuietaPeroCancelaLaEnCurso() async {
        let cliente = ClienteControlable()
        let modelo = await conOrigenPendiente(cliente)
        modelo.salir()
        XCTAssertEqual(modelo.origenPendiente, "Ricaurte", "salir sin nada en curso no borra lo que la pantalla muestra")

        await enviarCalle72(modelo, cliente, consulta: 2)
        modelo.salir()
        XCTAssertEqual(modelo.estado, .cancelada)
        XCTAssertNil(modelo.origenPendiente, "salir con una consulta en curso la cancela y con ella la aclaración")
        cliente.responder(.success(viaje), indice: 1)
        await dejarCorrer()
        XCTAssertEqual(modelo.estado, .cancelada)
    }
}

/// Contrato: la aclaración en la respuesta (`aclaracion.origen`) y el origen pendiente en la petición (`pendiente.origen`).
final class AclaracionContratoTests: XCTestCase {
    private let origen = try! OrigenServidor.analizar("https://servidor.ejemplo").get()

    override func setUp() {
        super.setUp()
        ProtocoloSimulado.reiniciar()
    }

    override func tearDown() {
        ProtocoloSimulado.reiniciar()
        super.tearDown()
    }

    func testDecodificaLaAclaracionDeOrigen() throws {
        let respuesta = try RespuestaAgente.decodificar(FixturesHTTP.datos(FixturesHTTP.aclaracionDeOrigen))
        XCTAssertEqual(respuesta.origenPendiente, "Estación Ejemplo Norte")
        XCTAssertEqual(respuesta.accion, .ninguna)
    }

    func testUnaRespuestaSinAclaracionNoDejaOrigenPendiente() throws {
        XCTAssertNil(try RespuestaAgente.decodificar(FixturesHTTP.datos(FixturesHTTP.ninguna)).origenPendiente)
    }

    func testRechazaUnaAclaracionSinOrigenOConOrigenVacio() {
        for json in [FixturesHTTP.aclaracionSinOrigen, FixturesHTTP.aclaracionOrigenVacio] {
            XCTAssertThrowsError(try RespuestaAgente.decodificar(FixturesHTTP.datos(json)), json) {
                XCTAssertEqual($0 as? ErrorConsulta, .respuestaIncompatible)
            }
        }
    }

    func testLaGuardiaDeContenidoNoConservaLaAclaracionDeUnaRespuestaConOrden() {
        let conOrden = RespuestaAgente(texto: "Toma la H72 en Calle 127 y bájate en Portal Usme.", origenPendiente: "Ricaurte")
        let segura = conOrden.saneada()
        XCTAssertEqual(segura.texto, GuardiaContenido.avisoNoConfirmable)
        XCTAssertNil(segura.origenPendiente)
    }

    func testElCuerpoLlevaElOrigenPendienteSoloCuandoHay() throws {
        let con = try JSONSerialization.jsonObject(
            with: JSONEncoder().encode(CuerpoPeticionAgente(message: "Calle 72", origenPendiente: "Ricaurte"))) as? [String: Any]
        XCTAssertEqual(con?["message"] as? String, "Calle 72")
        XCTAssertEqual(con?["pendiente"] as? [String: String], ["origen": "Ricaurte"])
        let sin = try JSONEncoder().encode(CuerpoPeticionAgente(message: "Calle 72"))
        XCTAssertEqual(String(decoding: sin, as: UTF8.self), #"{"message":"Calle 72"}"#)
    }

    func testElClienteHTTPEnviaElOrigenPendiente() async throws {
        ProtocoloSimulado.manejador = { _ in
            .responder(estado: 200, cabeceras: [:], cuerpo: FixturesHTTP.datos(FixturesHTTP.ninguna))
        }
        let origen = self.origen
        let cliente = ClienteAgenteHTTP(sesion: ProtocoloSimulado.sesion()) {
            ConfiguracionServidor(origen: origen, clave: ClaveAcceso(valor: "clave-inventada-de-prueba"))
        }
        _ = try await cliente.consultar(texto: " Calle 72 ", origenPendiente: "Ricaurte")
        let cuerpo = try XCTUnwrap(ProtocoloSimulado.peticiones.first?.httpBody)
        let json = try JSONSerialization.jsonObject(with: cuerpo) as? [String: Any]
        XCTAssertEqual(json?["message"] as? String, "Calle 72")
        XCTAssertEqual(json?["pendiente"] as? [String: String], ["origen": "Ricaurte"])
    }
}
