import XCTest
@testable import TransMiVoz

final class TextoFavoritasTests: XCTestCase {
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
}
