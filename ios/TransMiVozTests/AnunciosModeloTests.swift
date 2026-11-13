import XCTest
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
@testable import TransMiVoz

/// Cliente cuyas respuestas controla la prueba, una por consulta.
final class ClienteAnunciosControlable: ClienteAnuncios, @unchecked Sendable {
    private let candado = NSLock()
    private var pendientes: [CheckedContinuation<AnunciosRespuesta, Error>] = []

    var consultas: Int { candado.lock(); defer { candado.unlock() }; return pendientes.count }

    func consultar() async throws -> AnunciosRespuesta {
        try await withCheckedThrowingContinuation { continuacion in
            candado.lock()
            pendientes.append(continuacion)
            candado.unlock()
        }
    }

    /// Responde la consulta número `indice` (0 = la primera enviada).
    func responder(_ resultado: Result<AnunciosRespuesta, Error>, indice: Int) {
        candado.lock()
        let continuacion = pendientes[indice]
        candado.unlock()
        continuacion.resume(with: resultado)
    }

    func esperarConsultas(_ cantidad: Int) async {
        for _ in 0..<500 where consultas < cantidad {
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
    }
}

/// Reloj de pared falso: la prueba decide qué hora es.
final class RelojDeParedFalso: @unchecked Sendable {
    private let candado = NSLock()
    private var instante: Date

    init(_ instante: Date) { self.instante = instante }

    var ahora: Date { candado.lock(); defer { candado.unlock() }; return instante }
    func avanzar(_ segundos: TimeInterval) { candado.lock(); instante = instante.addingTimeInterval(segundos); candado.unlock() }
}

@MainActor
final class AnunciosModeloTests: XCTestCase {
    /// «Ahora» de las pruebas: 12/11/2026 10:00 en Bogotá.
    private let inicio = Date(timeIntervalSince1970: 1_794_495_600)
    private let hora: TimeInterval = 3_600

    private var cliente = ClienteAnunciosControlable()
    private var reloj = RelojDeParedFalso(Date(timeIntervalSince1970: 1_794_495_600))
    private var modelo: AnunciosModelo!

    override func setUp() async throws {
        try await super.setUp()
        cliente = ClienteAnunciosControlable()
        reloj = RelojDeParedFalso(inicio)
        modelo = AnunciosModelo(cliente: cliente, ahora: { [reloj] in reloj.ahora })
    }

    private func anuncio(_ id: String, origen: OrigenAnuncio = .oficial, hasta: TimeInterval? = nil) -> Anuncio {
        Anuncio(
            origen: origen, entidad: "Entidad Ejemplo", identificador: id, titulo: "Título \(id)", descripcion: "Descripción \(id)",
            fecha: inicio.addingTimeInterval(-hora), vigenciaHasta: hasta.map { inicio.addingTimeInterval($0) },
            afectacion: AfectacionAnuncio(efecto: .desvio, rutas: ["R1"]))
    }

    private func respuesta(
        _ estado: EstadoFuente = .activa, _ confianza: ConfianzaFuente = .media, anuncios: [Anuncio]
    ) -> AnunciosRespuesta {
        AnunciosRespuesta(
            fuente: FuenteAnuncios(
                estado: estado, confianza: confianza, entidad: "Entidad Ejemplo", nombre: "Alertas de ejemplo",
                url: "https://fuente.ejemplo/alertas",
                consultadoEn: estado == .sinFuente ? nil : inicio, publicadoEn: estado == .sinFuente ? nil : inicio.addingTimeInterval(-30),
                mensaje: "Mensaje del servidor. \(TextoAnuncios.avisoSinGarantia)"),
            anuncios: anuncios)
    }

    /// Una consulta completa: el cliente la recibe y la prueba decide cómo termina.
    private func actualizar(con resultado: Result<AnunciosRespuesta, Error>) async {
        let previas = cliente.consultas
        let tarea = Task { await modelo.actualizar() }
        await cliente.esperarConsultas(previas + 1)
        cliente.responder(resultado, indice: previas)
        await tarea.value
    }

    func testSinConsultarEsSinFuenteYNuncaSinIncidentes() {
        XCTAssertEqual(modelo.estadoFuente, .sinFuente)
        XCTAssertEqual(modelo.confianza, .ninguna)
        XCTAssertTrue(modelo.anuncios.isEmpty)
        XCTAssertNil(modelo.respuesta)
        XCTAssertNil(modelo.fallo)
        XCTAssertTrue(TextoAnuncios.mensaje(respuesta: modelo.respuesta, fallo: modelo.fallo).contains(TextoAnuncios.avisoSinGarantia))
    }

    func testRespuestaActivaMuestraSusAnuncios() async {
        await actualizar(con: .success(respuesta(anuncios: [anuncio("A-1"), anuncio("A-2", hasta: hora)])))
        XCTAssertEqual(modelo.estadoFuente, .activa)
        XCTAssertEqual(modelo.confianza, .media)
        XCTAssertEqual(modelo.anuncios.map(\.identificador), ["A-1", "A-2"])
        XCTAssertNil(modelo.fallo)
        XCTAssertFalse(modelo.consultando)
    }

    func testLosVencidosNoSeMuestran() async {
        await actualizar(con: .success(respuesta(anuncios: [
            anuncio("vencido", hasta: -60), anuncio("justo-ahora", hasta: 0), anuncio("vigente", hasta: 60), anuncio("sin-fin"),
        ])))
        XCTAssertEqual(modelo.anuncios.map(\.identificador), ["vigente", "sin-fin"])
    }

    func testLosRepetidosSeMuestranUnaSolaVez() async {
        await actualizar(con: .success(respuesta(anuncios: [
            anuncio("A-1"), anuncio("A-2"), anuncio("A-1"), anuncio("A-1", origen: .simulado),
        ])))
        // Mismo identificador y mismo origen: uno. Mismo identificador con otro origen: es otro anuncio.
        XCTAssertEqual(modelo.anuncios.map(\.id), ["oficial:A-1", "oficial:A-2", "simulado:A-1"])
    }

    func testConservaElOrdenDelServidor() async {
        await actualizar(con: .success(respuesta(anuncios: [anuncio("C"), anuncio("A"), anuncio("B")])))
        XCTAssertEqual(modelo.anuncios.map(\.identificador), ["C", "A", "B"])
    }

    func testSinFuenteDelServidorNoMuestraAnunciosAunqueLlegaran() async {
        await actualizar(con: .success(respuesta(.sinFuente, .ninguna, anuncios: [anuncio("A-1")])))
        XCTAssertEqual(modelo.estadoFuente, .sinFuente)
        XCTAssertEqual(modelo.confianza, .ninguna)
        XCTAssertTrue(modelo.anuncios.isEmpty)
    }

    func testFuenteDegradadaDelServidorSeRespeta() async {
        await actualizar(con: .success(respuesta(.degradada, .baja, anuncios: [anuncio("A-1")])))
        XCTAssertEqual(modelo.estadoFuente, .degradada)
        XCTAssertEqual(modelo.confianza, .baja)
        XCTAssertEqual(modelo.anuncios.count, 1)
        XCTAssertNil(modelo.fallo)
    }

    /// Fallo de la consulta tras un éxito: conserva la última respuesta y su fecha, baja la confianza y no dice «sin novedades».
    func testFalloConservaLaUltimaRespuestaYBajaLaConfianza() async {
        let buena = respuesta(anuncios: [anuncio("A-1"), anuncio("A-2")])
        await actualizar(con: .success(buena))
        await actualizar(con: .failure(ErrorConsulta.sinConexion))

        XCTAssertEqual(modelo.respuesta, buena, "la última respuesta buena sigue ahí, con sus fechas")
        XCTAssertEqual(modelo.respuesta?.fuente.consultadoEn, inicio)
        XCTAssertEqual(modelo.fallo, .sinConexion)
        XCTAssertEqual(modelo.estadoFuente, .degradada)
        XCTAssertEqual(modelo.confianza, .baja)
        XCTAssertEqual(modelo.anuncios.map(\.identificador), ["A-1", "A-2"])

        let frases = TextoAnuncios.mensaje(respuesta: modelo.respuesta, fallo: modelo.fallo)
        XCTAssertEqual(frases.first, "No pude actualizar los anuncios de TransMilenio.")
        XCTAssertTrue(frases.contains(TextoAnuncios.avisoSinGarantia))
        XCTAssertTrue(frases.contains { $0.contains("Muestro lo que la fuente publicó el 12 de noviembre de 2026, 09:59") })
        XCTAssertFalse(frases.contains { $0.contains("Mensaje del servidor") }, "el mensaje viejo del servidor ya no se afirma")
    }

    func testFalloSinRespuestaPreviaEsSinFuenteYNoEsSinIncidentes() async {
        await actualizar(con: .failure(ErrorConsulta.noAutorizado))
        XCTAssertNil(modelo.respuesta)
        XCTAssertEqual(modelo.fallo, .noAutorizado)
        XCTAssertEqual(modelo.estadoFuente, .sinFuente)
        XCTAssertEqual(modelo.confianza, .ninguna)
        XCTAssertTrue(modelo.anuncios.isEmpty)
        let frases = TextoAnuncios.mensaje(respuesta: modelo.respuesta, fallo: modelo.fallo)
        XCTAssertEqual(frases.first, "No pude consultar los anuncios de TransMilenio.")
        XCTAssertTrue(frases.contains(TextoAnuncios.avisoSinGarantia))
    }

    /// Lo conservado envejece: pasada su vigencia, el anuncio sale aunque la respuesta siga guardada.
    func testElAnuncioConservadoSeVenceConElReloj() async {
        await actualizar(con: .success(respuesta(anuncios: [anuncio("corto", hasta: hora), anuncio("largo", hasta: 5 * hora)])))
        await actualizar(con: .failure(ErrorConsulta.tiempoAgotado))
        XCTAssertEqual(modelo.anuncios.map(\.identificador), ["corto", "largo"])
        reloj.avanzar(2 * hora)
        XCTAssertEqual(modelo.anuncios.map(\.identificador), ["largo"])
        XCTAssertNotNil(modelo.respuesta)
    }

    func testUnaConsultaBuenaTrasUnFalloRecuperaLaConfianza() async {
        await actualizar(con: .success(respuesta(anuncios: [anuncio("A-1")])))
        await actualizar(con: .failure(ErrorConsulta.sinConexion))
        XCTAssertEqual(modelo.estadoFuente, .degradada)
        await actualizar(con: .success(respuesta(anuncios: [anuncio("A-9")])))
        XCTAssertNil(modelo.fallo)
        XCTAssertEqual(modelo.estadoFuente, .activa)
        XCTAssertEqual(modelo.confianza, .media)
        XCTAssertEqual(modelo.anuncios.map(\.identificador), ["A-9"])
    }

    func testSoloUnaConsultaALaVez() async {
        let primera = Task { await modelo.actualizar() }
        await cliente.esperarConsultas(1)
        XCTAssertTrue(modelo.consultando)
        let segunda = Task { await modelo.actualizar() } // mientras la primera sigue pendiente: no pide nada
        try? await Task.sleep(nanoseconds: 100_000_000)
        XCTAssertEqual(cliente.consultas, 1)
        for indice in 0..<cliente.consultas { cliente.responder(.success(respuesta(anuncios: [])), indice: indice) }
        await primera.value
        await segunda.value
        XCTAssertFalse(modelo.consultando)
        XCTAssertEqual(modelo.estadoFuente, .activa)
    }

    /// Salir de la pestaña cancela la consulta; eso no es un fallo de la fuente y no baja la confianza.
    func testCancelarNoCuentaComoFallo() async {
        await actualizar(con: .success(respuesta(anuncios: [anuncio("A-1")])))
        await actualizar(con: .failure(ErrorConsulta.cancelada))
        XCTAssertNil(modelo.fallo)
        XCTAssertEqual(modelo.estadoFuente, .activa)
        await actualizar(con: .failure(CancellationError()))
        XCTAssertNil(modelo.fallo)
        XCTAssertEqual(modelo.anuncios.count, 1)
    }

    func testUnErrorDesconocidoSeTrataComoSinConexion() async {
        await actualizar(con: .failure(URLError(.badServerResponse)))
        XCTAssertEqual(modelo.fallo, .sinConexion)
    }
}
