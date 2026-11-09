import XCTest

/// Pruebas puras del clasificador y del libro de contraste diferido: no lanzan la aplicación ni usan XCUITest.
/// Vista de ejemplo como la real en un iPhone: barra de navegación hasta 116 y barra de pestañas desde 775.
final class ClasificadorContrasteTests: XCTestCase {
    private let vista = VistaAuditada(arriba: 116, abajo: 775)

    private func contraste(
        _ id: String? = "estado-accesorio", _ etiqueta: String? = "Ningún accesorio elegido.", marco: CGRect? = nil,
        tipo: String = "contrast", esContraste: Bool = true
    ) -> HallazgoAuditoria {
        HallazgoAuditoria(
            tipo: tipo, esContraste: esContraste, compacta: "Contrast failed", detallada: "Contrast failed for SwiftUI.AccessibilityNode",
            identificador: id, etiqueta: etiqueta, marco: marco ?? CGRect(x: 16, y: 300, width: 300, height: 40))
    }

    private func nodo(_ id: String, _ etiqueta: String, _ marco: CGRect) -> NodoJerarquia {
        NodoJerarquia(identificador: id, etiqueta: etiqueta, marco: marco)
    }

    private func clasificar(_ hallazgo: HallazgoAuditoria, unico: Bool = true) -> Veredicto {
        ClasificadorContraste.clasificar(hallazgo, vista: vista, unico: unico)
    }

    private func esFallo(_ veredicto: Veredicto, _ fragmento: String, file: StaticString = #filePath, line: UInt = #line) {
        guard case .fallo(let motivo) = veredicto else { return XCTFail("Debía fallar y fue \(veredicto)", file: file, line: line) }
        XCTAssertTrue(motivo.contains(fragmento), "Motivo inesperado: \(motivo)", file: file, line: line)
    }

    // MARK: Clasificador

    func testContrasteInsuficienteDeUnNodoEnteroAVistaFalla() {
        esFallo(clasificar(contraste()), "entero a la vista")
    }

    func testNodoQueSobresaleUnPuntoAunCuentaComoEnteroAVista() {
        esFallo(clasificar(contraste(marco: CGRect(x: 16, y: 735.5, width: 300, height: 40))), "entero a la vista")
    }

    func testNodoRecortadoQueCabeEnLaVistaSeDifiere() {
        let marco = CGRect(x: 16, y: 765.79, width: 339, height: 42.33)
        XCTAssertEqual(clasificar(contraste(marco: marco)), .diferido(ClaveNodo(identificador: "estado-accesorio", etiqueta: "Ningún accesorio elegido.")))
    }

    func testNodoRecortadoPorArribaYNodoTotalmenteFueraTambienSeDifieren() {
        XCTAssertNotNil(diferida(clasificar(contraste(marco: CGRect(x: 16, y: 100, width: 300, height: 40)))))
        XCTAssertNotNil(diferida(clasificar(contraste(marco: CGRect(x: 16, y: 800, width: 300, height: 40)))))
    }

    func testNodoRecortadoMasAltoQueLaVistaFalla() {
        esFallo(clasificar(contraste(marco: CGRect(x: 16, y: 755.67, width: 258, height: 700))), "más alto que la vista")
    }

    func testElementoNuloFalla() {
        esFallo(clasificar(contraste(nil, nil, marco: CGRect(x: 0, y: 900, width: 10, height: 10))), "desconocido")
    }

    func testElementoSinIdentificadorFalla() {
        esFallo(clasificar(contraste("", "Estado del accesorio", marco: CGRect(x: 16, y: 765, width: 258, height: 40))), "sin identificador")
    }

    func testHallazgoQueNoEsDeContrasteNuncaSeDifiereAunqueEsteRecortado() {
        let recortado = CGRect(x: 16, y: 765.79, width: 339, height: 42.33)
        esFallo(clasificar(contraste(marco: recortado, tipo: "textClipped", esContraste: false)), "no es de contraste")
    }

    func testNodoFueraDeLaZonaDesplazableOAmbiguoFalla() {
        esFallo(clasificar(contraste(marco: CGRect(x: 16, y: 765.79, width: 339, height: 42.33)), unico: false), "descendiente único")
    }

    func testMarcosVaciosONoFinitosNoSeDifieren() {
        for marco in [CGRect(x: 16, y: 800, width: 0, height: 40), CGRect(x: 16, y: 800, width: 300, height: 0),
                      CGRect(x: CGFloat.nan, y: 800, width: 300, height: 40), CGRect(x: 16, y: 800, width: CGFloat.infinity, height: 40)] {
            esFallo(clasificar(contraste(marco: marco)), "marco")
        }
        let sinMarco = HallazgoAuditoria(
            tipo: "contrast", esContraste: true, compacta: "", detallada: "", identificador: "a", etiqueta: "b", marco: nil)
        esFallo(clasificar(sinMarco), "marco")
    }

    private func diferida(_ veredicto: Veredicto) -> ClaveNodo? {
        if case .diferido(let clave) = veredicto { return clave }
        return nil
    }

    // MARK: Libro

    private let recortado = CGRect(x: 16, y: 765.79, width: 339, height: 42.33)
    private let entero = CGRect(x: 16, y: 600, width: 339, height: 42.33)

    func testDeudaSinMedicionLimpiaQuedaPendiente() {
        var libro = LibroContraste(fase: "reposo")
        libro.registrar(
            contexto: "arriba", hallazgos: [contraste(marco: recortado)],
            zona: [nodo("estado-accesorio", "Ningún accesorio elegido.", recortado)],
            aplicacion: [nodo("estado-accesorio", "Ningún accesorio elegido.", recortado)], vista: vista)
        XCTAssertEqual(libro.pendientes.map(\.identificador), ["estado-accesorio"])
        XCTAssertTrue(libro.fallos.isEmpty)
        XCTAssertTrue(libro.informe().contains("SIN SALDAR"))
    }

    func testMedicionLimpiaDelMismoNodoEnteroASaldaLaDeuda() {
        var libro = LibroContraste(fase: "reposo")
        let zonaArriba = [nodo("estado-accesorio", "Ningún accesorio elegido.", recortado)]
        libro.registrar(contexto: "arriba", hallazgos: [contraste(marco: recortado)], zona: zonaArriba, aplicacion: zonaArriba, vista: vista)
        let zonaAbajo = [nodo("estado-accesorio", "Ningún accesorio elegido.", entero)]
        libro.registrar(contexto: "abajo", hallazgos: [], zona: zonaAbajo, aplicacion: zonaAbajo, vista: vista)
        XCTAssertTrue(libro.pendientes.isEmpty)
        XCTAssertTrue(libro.fallos.isEmpty)
        XCTAssertTrue(libro.informe().contains("saldado"))
    }

    func testNodoEnteroQueSigueFallandoNoSaldaNadaYSeRegistraComoFallo() {
        var libro = LibroContraste(fase: "reposo")
        let zonaArriba = [nodo("estado-accesorio", "Ningún accesorio elegido.", recortado)]
        libro.registrar(contexto: "arriba", hallazgos: [contraste(marco: recortado)], zona: zonaArriba, aplicacion: zonaArriba, vista: vista)
        let zonaAbajo = [nodo("estado-accesorio", "Ningún accesorio elegido.", entero)]
        libro.registrar(contexto: "abajo", hallazgos: [contraste(marco: entero)], zona: zonaAbajo, aplicacion: zonaAbajo, vista: vista)
        XCTAssertEqual(libro.fallos.count, 1)
        XCTAssertFalse(libro.limpios.contains(ClaveNodo(identificador: "estado-accesorio", etiqueta: "Ningún accesorio elegido.")))
    }

    func testOtraEtiquetaOtroEstadoNoSaldaLaDeuda() {
        var libro = LibroContraste(fase: "reposo")
        let zonaArriba = [nodo("estado-accesorio", "Ningún accesorio elegido.", recortado)]
        libro.registrar(contexto: "arriba", hallazgos: [contraste(marco: recortado)], zona: zonaArriba, aplicacion: zonaArriba, vista: vista)
        let zonaOtra = [nodo("estado-accesorio", "Bloqueado: enlace no verificado", entero)]
        libro.registrar(contexto: "abajo", hallazgos: [], zona: zonaOtra, aplicacion: zonaOtra, vista: vista)
        XCTAssertEqual(libro.pendientes.count, 1)
    }

    func testMedicionLimpiaAnteriorEnLaMismaFaseTambienSalda() {
        var libro = LibroContraste(fase: "reposo")
        let zonaEntera = [nodo("estado-accesorio", "Ningún accesorio elegido.", entero)]
        libro.registrar(contexto: "primero", hallazgos: [], zona: zonaEntera, aplicacion: zonaEntera, vista: vista)
        let zonaArriba = [nodo("estado-accesorio", "Ningún accesorio elegido.", recortado)]
        libro.registrar(contexto: "luego", hallazgos: [contraste(marco: recortado)], zona: zonaArriba, aplicacion: zonaArriba, vista: vista)
        XCTAssertTrue(libro.pendientes.isEmpty)
    }

    func testUnNodoRecortadoNoCuentaComoMedidoLimpio() {
        var libro = LibroContraste(fase: "reposo")
        let zonaArriba = [nodo("estado-accesorio", "Ningún accesorio elegido.", recortado)]
        libro.registrar(contexto: "arriba", hallazgos: [], zona: zonaArriba, aplicacion: zonaArriba, vista: vista)
        XCTAssertTrue(libro.limpios.isEmpty)
    }

    func testNodoDuplicadoEnLaAplicacionNoSePuedeIdentificarNiSaldarNiDiferir() {
        var libro = LibroContraste(fase: "reposo")
        let duplicado = nodo("estado-accesorio", "Ningún accesorio elegido.", recortado)
        libro.registrar(contexto: "arriba", hallazgos: [contraste(marco: recortado)], zona: [duplicado], aplicacion: [duplicado, duplicado], vista: vista)
        XCTAssertTrue(libro.diferidos.isEmpty)
        XCTAssertEqual(libro.fallos.count, 1)
    }

    func testDarPorFalladaUnaDeudaLaSacaDePendientesPeroDejaElFallo() {
        var libro = LibroContraste(fase: "reposo")
        let zonaArriba = [nodo("estado-accesorio", "Ningún accesorio elegido.", recortado)]
        libro.registrar(contexto: "arriba", hallazgos: [contraste(marco: recortado)], zona: zonaArriba, aplicacion: zonaArriba, vista: vista)
        libro.darPorFallida(libro.pendientes[0], motivo: "no se midió")
        XCTAssertTrue(libro.pendientes.isEmpty)
        XCTAssertEqual(libro.fallos.count, 1)
    }

    func testFallosDeOtrosTiposSeAcumulanSinDiferirse() {
        var libro = LibroContraste(fase: "reposo")
        let zona = [nodo("estado-accesorio", "Ningún accesorio elegido.", recortado)]
        libro.registrar(
            contexto: "arriba", hallazgos: [contraste(marco: recortado, tipo: "dynamicType", esContraste: false)],
            zona: zona, aplicacion: zona, vista: vista)
        XCTAssertTrue(libro.diferidos.isEmpty)
        XCTAssertEqual(libro.fallos.count, 1)
    }
}
