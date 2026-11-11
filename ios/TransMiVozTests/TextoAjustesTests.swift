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

    func testAyudaRepiteElAvisoDeSeguridadDelAccesorioSinPrometerCaminoLibre() {
        let accesorio = textoDeAyuda("Accesorio de proximidad")
        for parrafo in TextoAccesorio.parrafosAvisoEnlace { XCTAssertTrue(accesorio.contains(parrafo)) }
        XCTAssertTrue(accesorio.contains("ni significa camino libre"))
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
