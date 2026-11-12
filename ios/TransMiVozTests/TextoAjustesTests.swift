import XCTest
@testable import TransMiVoz

final class TextoAjustesTests: XCTestCase {
    func testResumenDeFavoritasConcuerdaEnNumero() {
        XCTAssertEqual(TextoFavoritas.resumen(1), "1 ruta favorita")
        XCTAssertEqual(TextoFavoritas.resumen(3), "3 rutas favoritas")
    }

    func testAnuncioAlQuitarDiceLaRutaYCuantasQuedan() {
        XCTAssertEqual(TextoFavoritas.quitada("B23", quedan: 0), "Quité la ruta B23 de tus favoritas. No quedan rutas favoritas.")
        XCTAssertEqual(TextoFavoritas.quitada("B23", quedan: 1), "Quité la ruta B23 de tus favoritas. Queda 1 ruta favorita.")
        XCTAssertEqual(TextoFavoritas.quitada("B23", quedan: 2), "Quité la ruta B23 de tus favoritas. Quedan 2 rutas favoritas.")
    }

    func testElEstadoVacioDiceComoSeAgregan() {
        XCTAssertTrue(TextoFavoritas.comoSeAgregan.contains("Guardar"))
    }

    private func textoDeAyuda(_ titulo: String) -> String {
        TextoAyuda.secciones.first { $0.titulo == titulo }?.parrafos.joined(separator: " ") ?? ""
    }

    func testAyudaDiceQueElMetroEsUnProyectoFuturoSinServicio() {
        let metro = textoDeAyuda("Metro de Bogotá")
        XCTAssertTrue(metro.contains("proyecto futuro"))
        XCTAssertTrue(metro.contains("no presta servicio"))
    }

    func testAyudaReutilizaElAvisoDeSeguridadDelAccesorio() throws {
        let accesorio = textoDeAyuda("Accesorio de proximidad")
        XCTAssertTrue(accesorio.contains(TextoAccesorio.parrafosAvisoEnlace.joined(separator: " ")))
        let frase = try XCTUnwrap(TextoAccesorio.parrafos(.enlaceNoVerificado).last)
        XCTAssertTrue(accesorio.contains(frase))
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

    func testAyudaAdviertaQueHoyElAccesorioNoDaAvisos() {
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
        XCTAssertEqual(llamadas.compactMap(\.url?.absoluteString), ["tel:123", "tel:156", "tel:195"])
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
