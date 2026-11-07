import XCTest
@testable import TransMiVoz

final class EntradaConsultaTests: XCTestCase {
    func testRecortaEspaciosYAcepta() {
        XCTAssertEqual(EntradaConsulta.validar("  horario B23 \n"), .success("horario B23"))
    }

    func testVaciaOSoloEspaciosSeRechaza() {
        XCTAssertEqual(EntradaConsulta.validar(""), .failure(.entradaInvalida(.vacia)))
        XCTAssertEqual(EntradaConsulta.validar(" \n\t "), .failure(.entradaInvalida(.vacia)))
    }

    func testLimiteExactoDe300SeAceptaYUnoMasSeRechazaSinRecortar() {
        let exacto = String(repeating: "a", count: 300)
        XCTAssertEqual(EntradaConsulta.validar(exacto), .success(exacto))
        XCTAssertEqual(
            EntradaConsulta.validar(exacto + "a"),
            .failure(.entradaInvalida(.demasiadoLarga(maximo: 300))))
    }

    func testElLimiteCuentaUnidadesUTF16ComoElServidor() {
        // Cada emoji ocupa 2 unidades UTF-16: 151 emojis = 302 > 300.
        let emojis = String(repeating: "🚌", count: 151)
        XCTAssertEqual(EntradaConsulta.validar(emojis), .failure(.entradaInvalida(.demasiadoLarga(maximo: 300))))
        XCTAssertEqual(EntradaConsulta.validar(String(repeating: "🚌", count: 150)), .success(String(repeating: "🚌", count: 150)))
    }

    func testCuerpoMaximoCabeEnElLimiteDeBytesDelServidor() throws {
        let peor = String(repeating: "\u{0001}", count: 300) // se escapa como \u0001 (6 bytes)
        let cuerpo = try JSONEncoder().encode(CuerpoPeticionAgente(message: peor))
        XCTAssertLessThanOrEqual(cuerpo.count, EntradaConsulta.maximoBytesCuerpo)
    }

    func testCuerpoSoloLlevaMessage() throws {
        let cuerpo = try JSONEncoder().encode(CuerpoPeticionAgente(message: "hola"))
        XCTAssertEqual(String(decoding: cuerpo, as: UTF8.self), #"{"message":"hola"}"#)
    }
}

final class OrigenServidorTests: XCTestCase {
    private func origen(_ texto: String) -> OrigenServidor? { try? OrigenServidor.analizar(texto).get() }

    func testAceptaHttpsYNormaliza() {
        XCTAssertEqual(origen("https://Servidor.Ejemplo")?.esquemaYAutoridad, "https://servidor.ejemplo")
        XCTAssertEqual(origen(" https://servidor.ejemplo/ ")?.esquemaYAutoridad, "https://servidor.ejemplo")
        XCTAssertEqual(origen("https://servidor.ejemplo:8443")?.esquemaYAutoridad, "https://servidor.ejemplo:8443")
    }

    func testUrlDelAgente() {
        XCTAssertEqual(origen("https://servidor.ejemplo")?.urlAgente.absoluteString, "https://servidor.ejemplo/api/agent")
    }

    func testRechazos() {
        let casos: [(String, ErrorOrigen)] = [
            ("", .vacio), ("   ", .vacio),
            ("http://servidor.ejemplo", .noEsHttps),
            ("servidor.ejemplo", .noEsHttps),
            ("ftp://servidor.ejemplo", .noEsHttps),
            ("https://", .malFormado),
            ("https://usuario:clave@servidor.ejemplo", .traeCredenciales),
            ("https://usuario@servidor.ejemplo", .traeCredenciales),
            ("https://servidor.ejemplo/api", .traeRutaOParametros),
            ("https://servidor.ejemplo/?a=1", .traeRutaOParametros),
            ("https://servidor.ejemplo/#x", .traeRutaOParametros),
        ]
        for (texto, esperado) in casos {
            XCTAssertEqual(OrigenServidor.analizar(texto).fallo, esperado, texto)
        }
    }

    func testCabeceraBasicYDescripcionOculta() {
        let clave = ClaveAcceso(valor: "clave:con:dos-puntos")
        // base64("transmivoz:clave:con:dos-puntos")
        XCTAssertEqual(clave.cabeceraBasic, "Basic " + Data("transmivoz:clave:con:dos-puntos".utf8).base64EncodedString())
        XCTAssertFalse("\(clave)".contains("dos-puntos"))
        XCTAssertFalse(String(reflecting: clave).contains("dos-puntos"))
    }
}

private extension Result {
    var fallo: Failure? { if case .failure(let e) = self { return e } else { return nil } }
}
