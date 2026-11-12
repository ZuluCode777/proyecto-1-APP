import XCTest
@testable import TransMiVoz

final class TextoAyudaTests: XCTestCase {
    private func textoDeAyuda(_ titulo: String) -> String {
        TextoAyuda.secciones.first { $0.titulo == titulo }?.parrafos.joined(separator: " ") ?? ""
    }

    func testAyudaDiceQueElMetroEsUnProyectoFuturoSinServicio() {
        let metro = textoDeAyuda("Metro de Bogotá")
        XCTAssertTrue(metro.contains("proyecto futuro"))
        XCTAssertTrue(metro.contains("no presta servicio"))
    }

    func testAyudaReutilizaElAvisoDeSeguridadDelAccesorio() {
        let accesorio = textoDeAyuda("Accesorio de proximidad")
        XCTAssertTrue(accesorio.contains("Esta versión todavía no puede verificar que el enlace sea cifrado y autenticado (falta la prueba con la placa). Por eso bloquea las medidas y los avisos del sensor."))
        XCTAssertTrue(accesorio.contains("No se usa ninguna medida. Esto no es una detección ni significa camino libre."))
        // Las dos frases siguen siendo las del bloqueo de la pantalla de Sesión.
        XCTAssertEqual(Array(TextoAccesorio.parrafos(.enlaceNoVerificado).suffix(2)), [TextoAccesorio.sinMedidaPorEnlace, TextoAccesorio.noEsDeteccionNiCaminoLibre])
        XCTAssertTrue(accesorio.contains("no distingue unos auriculares de un altavoz Bluetooth"))
        XCTAssertTrue(accesorio.contains("no reemplaza el bastón ni el perro guía"))
    }

    func testAyudaSoloDiceCaminoLibreParaNegarlo() {
        var resto = TextoAyuda.secciones.flatMap(\.parrafos).joined(separator: " ")[...]
        while let rango = resto.range(of: "camino libre") {
            XCTAssertTrue(resto[..<rango.lowerBound].hasSuffix("ni significa "), "«camino libre» sin negación en: \(resto)")
            resto = resto[rango.upperBound...]
        }
    }

    func testAyudaAdvierteQueHoyElAccesorioNoDaAvisos() {
        let uso = textoDeAyuda("Cómo usarla")
        XCTAssertTrue(uso.contains("bloquea las medidas y los avisos del sensor"))
        XCTAssertTrue(uso.contains("no puede verificar el enlace"))
        XCTAssertFalse(uso.contains("para oír los avisos"))
    }

    func testAyudaDiceDondeEstanLasSeccionesDeAjustes() {
        XCTAssertTrue(textoDeAyuda("Cómo usarla").contains("«Más ajustes»"))
    }

    func testAyudaOfreceLosTresNumerosDeEmergenciaComoEnlaces() {
        let llamadas = TextoAyuda.secciones.flatMap(\.llamadas)
        XCTAssertEqual(llamadas.map(\.numero), ["123", "156", "195"])
        XCTAssertEqual(llamadas.map(\.url.absoluteString), ["tel:123", "tel:156", "tel:195"])
    }

    func testAyudaNoTieneSeccionesNiParrafosVacios() {
        XCTAssertFalse(TextoAyuda.secciones.isEmpty)
        for seccion in TextoAyuda.secciones {
            XCTAssertFalse(seccion.titulo.isEmpty)
            XCTAssertFalse(seccion.parrafos.isEmpty)
            XCTAssertFalse(seccion.parrafos.contains { $0.isEmpty })
        }
    }
}
