import XCTest
@testable import TransMiVoz

/// Almacén en memoria que cuenta las escrituras, para comprobar qué se guarda y cuándo.
/// `@unchecked Sendable`: las pruebas lo usan solo desde el actor principal.
private final class AlmacenFavoritasFalso: AlmacenFavoritas, @unchecked Sendable {
    var guardado: [String]?
    private(set) var escrituras = 0

    init(guardado: [String]? = nil) { self.guardado = guardado }

    func leer() -> [String]? { guardado }
    func guardar(_ codigos: [String]) {
        guardado = codigos
        escrituras += 1
    }
}

@MainActor
final class FavoritasModeloTests: XCTestCase {
    func testSinNadaGuardadoEmpiezaVacia() {
        let modelo = FavoritasModelo(almacen: AlmacenFavoritasFalso())
        XCTAssertEqual(modelo.codigos, [])
    }

    func testAgregarNormalizaGuardaYNoDuplica() {
        let almacen = AlmacenFavoritasFalso()
        let modelo = FavoritasModelo(almacen: almacen)
        XCTAssertTrue(modelo.agregar(" b23 "))
        XCTAssertFalse(modelo.agregar("B23"))
        XCTAssertEqual(modelo.codigos, ["B23"])
        XCTAssertEqual(almacen.guardado, ["B23"])
        XCTAssertEqual(almacen.escrituras, 1)
    }

    func testAgregarConservaElOrden() {
        let modelo = FavoritasModelo(almacen: AlmacenFavoritasFalso())
        modelo.agregar("M83")
        modelo.agregar("B23")
        XCTAssertEqual(modelo.codigos, ["M83", "B23"])
    }

    func testAgregarCodigoVacioNoHaceNada() {
        let almacen = AlmacenFavoritasFalso()
        let modelo = FavoritasModelo(almacen: almacen)
        XCTAssertFalse(modelo.agregar("   "))
        XCTAssertEqual(modelo.codigos, [])
        XCTAssertEqual(almacen.escrituras, 0)
    }

    func testQuitarSacaLaRutaYLoGuarda() {
        let almacen = AlmacenFavoritasFalso(guardado: ["B23", "H54"])
        let modelo = FavoritasModelo(almacen: almacen)
        XCTAssertTrue(modelo.quitar("b23"))
        XCTAssertEqual(modelo.codigos, ["H54"])
        XCTAssertEqual(almacen.guardado, ["H54"])
        XCTAssertFalse(modelo.contiene("B23"))
    }

    func testQuitarUnaRutaQueNoEstaNoEscribe() {
        let almacen = AlmacenFavoritasFalso(guardado: ["B23"])
        let modelo = FavoritasModelo(almacen: almacen)
        XCTAssertFalse(modelo.quitar("H54"))
        XCTAssertEqual(modelo.codigos, ["B23"])
        XCTAssertEqual(almacen.escrituras, 0)
    }

    func testContieneIgnoraMayusculasYEspacios() {
        let modelo = FavoritasModelo(almacen: AlmacenFavoritasFalso(guardado: ["B23"]))
        XCTAssertTrue(modelo.contiene(" b23"))
        XCTAssertFalse(modelo.contiene("H54"))
        XCTAssertFalse(modelo.contiene(""))
    }

    func testAlCargarNormalizaYQuitaVaciosYRepetidos() {
        let modelo = FavoritasModelo(almacen: AlmacenFavoritasFalso(guardado: ["b23", " H54 ", "B23", "", "H54"]))
        XCTAssertEqual(modelo.codigos, ["B23", "H54"])
    }

    func testUserDefaultsConservaLasFavoritasEntreModelos() {
        let nombre = "pruebas.transmivoz.\(UUID().uuidString)"
        let preferencias = UserDefaults(suiteName: nombre)!
        defer { preferencias.removePersistentDomain(forName: nombre) }

        let primero = FavoritasModelo(almacen: AlmacenFavoritasUserDefaults(preferencias: preferencias))
        primero.agregar("B23")
        primero.agregar("H54")
        primero.quitar("B23")

        let segundo = FavoritasModelo(almacen: AlmacenFavoritasUserDefaults(preferencias: preferencias))
        XCTAssertEqual(segundo.codigos, ["H54"])
    }

    func testUnValorGuardadoQueNoEsUnaListaDeTextosSeIgnora() {
        let nombre = "pruebas.transmivoz.\(UUID().uuidString)"
        let preferencias = UserDefaults(suiteName: nombre)!
        defer { preferencias.removePersistentDomain(forName: nombre) }

        preferencias.set("no es una lista", forKey: AlmacenFavoritasUserDefaults.claveGuardado)
        XCTAssertEqual(FavoritasModelo(almacen: AlmacenFavoritasUserDefaults(preferencias: preferencias)).codigos, [])
        preferencias.set([1, 2], forKey: AlmacenFavoritasUserDefaults.claveGuardado)
        XCTAssertEqual(FavoritasModelo(almacen: AlmacenFavoritasUserDefaults(preferencias: preferencias)).codigos, [])
    }
}
