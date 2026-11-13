import XCTest
@testable import TransMiVoz

/// Decodificación de `GET /api/anuncios`. Los fixtures son simulaciones de contrato (`FixturesAnuncios`), no respuestas del servidor real.
final class AnunciosRespuestaTests: XCTestCase {
    private func fecha(_ iso: String) throws -> Date {
        let formato = ISO8601DateFormatter()
        formato.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return try XCTUnwrap(formato.date(from: iso))
    }

    private func esperarIncompatible(_ json: String, _ mensaje: String, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertThrowsError(try AnunciosRespuesta.decodificar(FixturesAnuncios.datos(json)), mensaje, file: file, line: line) { error in
            XCTAssertEqual(error as? ErrorConsulta, .respuestaIncompatible, mensaje, file: file, line: line)
        }
    }

    func testActivaConservaEntidadIdentificadorFechaVigenciaYAfectacion() throws {
        let respuesta = try AnunciosRespuesta.decodificar(FixturesAnuncios.datos(FixturesAnuncios.activa))
        XCTAssertEqual(respuesta.fuente.estado, .activa)
        XCTAssertEqual(respuesta.fuente.confianza, .media)
        XCTAssertEqual(respuesta.fuente.consultadoEn, try fecha("2026-11-12T15:00:00.000Z"))
        XCTAssertEqual(respuesta.fuente.publicadoEn, try fecha("2026-11-12T14:59:30.000Z"))
        XCTAssertEqual(respuesta.anuncios.map(\.identificador), ["A-1", "A-2"])

        let primero = respuesta.anuncios[0]
        XCTAssertEqual(primero.origen, .oficial)
        XCTAssertEqual(primero.entidad, "Entidad Ejemplo")
        XCTAssertEqual(primero.titulo, "Desvío de ejemplo")
        XCTAssertEqual(primero.fecha, try fecha("2026-11-12T13:00:00.000Z"))
        XCTAssertEqual(primero.vigenciaHasta, try fecha("2026-11-12T23:00:00.000Z"))
        XCTAssertEqual(primero.afectacion, AfectacionAnuncio(efecto: .desvio, rutas: ["R1", "R2"]))
    }

    /// La fuente puede no publicar la fecha: queda `nil`, no se inventa.
    func testFechasNulasQuedanNulas() throws {
        let segundo = try AnunciosRespuesta.decodificar(FixturesAnuncios.datos(FixturesAnuncios.activa)).anuncios[1]
        XCTAssertNil(segundo.fecha)
        XCTAssertNil(segundo.vigenciaHasta)
        XCTAssertEqual(segundo.afectacion.efecto, .sinServicio)
        XCTAssertEqual(segundo.afectacion.rutas, [])
    }

    func testAceptaFechasSinFraccionDeSegundo() throws {
        let json = FixturesAnuncios.variante(FixturesAnuncios.activa, cambiar: "2026-11-12T13:00:00.000Z", por: "2026-11-12T13:00:00Z")
        let primero = try AnunciosRespuesta.decodificar(FixturesAnuncios.datos(json)).anuncios[0]
        XCTAssertEqual(primero.fecha, try fecha("2026-11-12T13:00:00.000Z"))
    }

    func testSinFuenteNoTraeFechasNiAnuncios() throws {
        let respuesta = try AnunciosRespuesta.decodificar(FixturesAnuncios.datos(FixturesAnuncios.sinFuente))
        XCTAssertEqual(respuesta.fuente.estado, .sinFuente)
        XCTAssertEqual(respuesta.fuente.confianza, .ninguna)
        XCTAssertNil(respuesta.fuente.consultadoEn)
        XCTAssertNil(respuesta.fuente.publicadoEn)
        XCTAssertTrue(respuesta.anuncios.isEmpty)
    }

    func testDegradadaConservaLasFechasDeLaUltimaConsultaBuena() throws {
        let respuesta = try AnunciosRespuesta.decodificar(FixturesAnuncios.datos(FixturesAnuncios.degradada))
        XCTAssertEqual(respuesta.fuente.estado, .degradada)
        XCTAssertEqual(respuesta.fuente.confianza, .baja)
        XCTAssertEqual(respuesta.fuente.consultadoEn, try fecha("2026-11-12T14:00:00.000Z"))
        XCTAssertEqual(respuesta.fuente.publicadoEn, try fecha("2026-11-12T13:59:00.000Z"))
        XCTAssertEqual(respuesta.anuncios.count, 1)
    }

    func testCadaEfectoDelContratoSeDecodifica() throws {
        let codigos = [
            "sin-servicio", "servicio-reducido", "demoras", "desvio", "servicio-adicional", "servicio-modificado",
            "otro", "desconocido", "parada-movida", "sin-efecto", "accesibilidad",
        ]
        for codigo in codigos {
            let json = FixturesAnuncios.variante(FixturesAnuncios.activa, cambiar: #""efecto":"desvio""#, por: #""efecto":"\#(codigo)""#)
            let efecto = try AnunciosRespuesta.decodificar(FixturesAnuncios.datos(json)).anuncios[0].afectacion.efecto
            XCTAssertEqual(efecto.rawValue, codigo)
        }
    }

    /// El contrato prevé contenido de demostración con su propio origen; la app lo distingue del oficial.
    func testElOrigenSimuladoSeDecodificaComoSimulado() throws {
        let json = FixturesAnuncios.variante(FixturesAnuncios.activa, cambiar: #""origen":"oficial""#, por: #""origen":"simulado""#)
        let anuncios = try AnunciosRespuesta.decodificar(FixturesAnuncios.datos(json)).anuncios
        XCTAssertEqual(anuncios.map(\.origen), [.simulado, .simulado])
    }

    func testValoresFueraDelContratoSonIncompatibles() {
        let base = FixturesAnuncios.activa
        let casos: [(String, String)] = [
            (FixturesAnuncios.variante(base, cambiar: #""estado":"activa""#, por: #""estado":"inventado""#), "estado desconocido"),
            (FixturesAnuncios.variante(base, cambiar: #""confianza":"media""#, por: #""confianza":"alta""#), "confianza desconocida"),
            (FixturesAnuncios.variante(base, cambiar: #""efecto":"desvio""#, por: #""efecto":"teletransporte""#), "efecto desconocido"),
            (FixturesAnuncios.variante(base, cambiar: #""origen":"oficial""#, por: #""origen":"inventado""#), "origen desconocido"),
            (FixturesAnuncios.variante(base, cambiar: "2026-11-12T13:00:00.000Z", por: "ayer por la tarde"), "fecha que no es ISO 8601"),
            (FixturesAnuncios.variante(base, cambiar: #""identificador":"A-1","#, por: ""), "anuncio sin identificador"),
            (FixturesAnuncios.variante(base, cambiar: #""afectacion":{"efecto":"desvio","rutas":["R1","R2"]}"#, por: #""afectacion":null"#), "afectación nula"),
            (FixturesAnuncios.variante(base, cambiar: #""mensaje":"Hay 2"#, por: #""mensajes":"Hay 2"#), "fuente sin mensaje"),
            (FixturesAnuncios.variante(FixturesAnuncios.sinFuente, cambiar: "No hay una fuente oficial de anuncios conectada en este momento. Esto no significa que no haya novedades en el servicio.", por: "  "), "mensaje en blanco"),
            (#"["no","soy","objeto"]"#, "no es un objeto"),
            ("", "cuerpo vacío"),
            ("no es json", "no es JSON"),
        ]
        for (json, mensaje) in casos {
            esperarIncompatible(json, mensaje)
        }
    }
}
