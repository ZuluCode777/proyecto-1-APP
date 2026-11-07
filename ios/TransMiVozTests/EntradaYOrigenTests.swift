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

    /// Un delimitador codificado en el host (`%40`, `%3a`, `%2F`…) se decodifica al
    /// leer `host`; si se reinterpolara, cambiaría el destino real de la petición.
    func testRechazaDelimitadoresCodificadosEnElHost() {
        let casos = [
            "https://bueno.ejemplo%40otro.ejemplo",
            "https://bueno.ejemplo%40otro.ejemplo:8443",
            "https://foo%3abar.com", "https://foo%3Abar.com",
            "https://servidor.ejemplo%2fruta", "https://servidor.ejemplo%2Fruta",
            "https://servidor.ejemplo%3fa=1", "https://servidor.ejemplo%3Fa=1",
            "https://servidor.ejemplo%23x", "https://servidor.ejemplo%23",
            "https://servidor%2eejemplo%00",
            "https://[::1%25en0]", "https://[no:es:ipv6]", "https://[::1]%40otro.ejemplo",
        ]
        for texto in casos {
            XCTAssertEqual(OrigenServidor.analizar(texto).fallo, .malFormado, texto)
        }
    }

    func testRechazaPuertosInvalidosOQueDesaparecerian() {
        let casos = [
            "https://servidor.ejemplo:0", "https://servidor.ejemplo:65536",
            "https://servidor.ejemplo:99999999999999999999",
            "https://servidor.ejemplo:-1", "https://servidor.ejemplo:+443",
            "https://servidor.ejemplo:abc", "https://servidor.ejemplo:44a",
        ]
        for texto in casos {
            XCTAssertEqual(OrigenServidor.analizar(texto).fallo, .malFormado, texto)
        }
    }

    /// El endpoint conserva host y puerto validados y no lleva credenciales,
    /// parámetros ni fragmento, y el texto guardado se vuelve a analizar igual.
    func testOrigenesValidosGeneranElEndpointEsperado() throws {
        let casos: [(texto: String, hosts: [String], puerto: Int?)] = [
            ("https://Servidor.Ejemplo", ["servidor.ejemplo"], nil),
            ("https://servidor.ejemplo:1", ["servidor.ejemplo"], 1),
            ("https://Servidor.Ejemplo:8443/", ["servidor.ejemplo"], 8443),
            ("https://servidor.ejemplo:65535", ["servidor.ejemplo"], 65535),
            ("https://203.0.113.7:8443", ["203.0.113.7"], 8443),
            ("https://[::1]", ["::1"], nil),
            ("https://[2001:DB8::1]:8443", ["2001:db8::1"], 8443),
            // Según la versión de Foundation, el host Unicode se conserva o se pasa a punycode.
            ("https://bücher.ejemplo:8443", ["bücher.ejemplo", "xn--bcher-kva.ejemplo"], 8443),
        ]
        for caso in casos {
            let origen = try XCTUnwrap(origen(caso.texto), caso.texto)
            let url = origen.urlAgente
            let partes = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false), caso.texto)
            let host = (partes.host ?? "").trimmingCharacters(in: CharacterSet(charactersIn: "[]")).lowercased()
            XCTAssertEqual(partes.scheme, "https", caso.texto)
            XCTAssertTrue(caso.hosts.contains(host), "\(caso.texto) → \(host)")
            XCTAssertEqual(partes.port, caso.puerto, caso.texto)
            XCTAssertEqual(partes.path, "/api/agent", caso.texto)
            XCTAssertNil(partes.user, caso.texto)
            XCTAssertNil(partes.password, caso.texto)
            XCTAssertNil(partes.query, caso.texto)
            XCTAssertNil(partes.fragment, caso.texto)
            XCTAssertEqual(OrigenServidor.analizar(origen.esquemaYAutoridad).successValue, origen, caso.texto)
        }
    }

    func testNormalizaMayusculasParaAislarElOrigen() {
        XCTAssertEqual(origen("https://Servidor.Ejemplo:8443"), origen("https://servidor.ejemplo:8443/"))
        XCTAssertNotEqual(origen("https://servidor.ejemplo:8443"), origen("https://servidor.ejemplo"))
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
    var successValue: Success? { if case .success(let v) = self { return v } else { return nil } }
}
