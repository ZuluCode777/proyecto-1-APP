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

    // MARK: Zona medible (efecto de borde de iOS 26)

    private func anonimo(_ marco: CGRect) -> NodoJerarquia { nodo("", "", marco) }
    /// Como la jerarquía nativa del CI: área desplazable de 0 a 775, contenedor a su tamaño y bajo él el efecto de borde de 170,8.
    private var areaConBorde: [NodoJerarquia] {
        [anonimo(CGRect(x: 0, y: 0, width: 402, height: 775)),
         anonimo(CGRect(x: 0, y: -249, width: 402, height: 1184.7)),
         anonimo(CGRect(x: 0, y: 0, width: 402, height: 775)),
         anonimo(CGRect(x: 0, y: 0, width: 402, height: 170.8)),
         anonimo(CGRect(x: 0, y: 0, width: 402, height: 94.3)),
         anonimo(CGRect(x: 369, y: 116, width: 30, height: 659)),
         nodo("boton-sesion-accesorio", "Detener sesión", CGRect(x: 16, y: 117, width: 154.7, height: 50.3))]
    }

    func testLaZonaMedibleExcluyeLaBandaDelEfectoDeBorde() {
        let medible = VistaAuditada.medible(arriba: 116, abajo: 775, zona: areaConBorde)
        XCTAssertEqual(medible, VistaAuditada(arriba: 170.8, abajo: 775))
    }

    func testSinBandaLaZonaMedibleEsLaDeSiempreYNuncaSeAmplia() {
        XCTAssertEqual(VistaAuditada.medible(arriba: 116, abajo: 775, zona: Array(areaConBorde.prefix(2))), vista)
        XCTAssertEqual(VistaAuditada.medible(arriba: 116, abajo: 775, zona: []), vista)
        // Un nodo anónimo más bajo que la barra no la amplía hacia arriba.
        let corto = [areaConBorde[0], anonimo(CGRect(x: 0, y: 0, width: 402, height: 60))]
        XCTAssertEqual(VistaAuditada.medible(arriba: 116, abajo: 775, zona: corto), vista)
    }

    func testNodosConIdentificadorOEnOtroSitioNoFormanLaBanda() {
        let zona = [areaConBorde[0],
                    nodo("estado", "", CGRect(x: 0, y: 0, width: 402, height: 300)),
                    anonimo(CGRect(x: 0, y: 300, width: 402, height: 300)),
                    anonimo(CGRect(x: 0, y: 0, width: 200, height: 300))]
        XCTAssertEqual(VistaAuditada.medible(arriba: 116, abajo: 775, zona: zona), vista)
    }

    func testElBotonPegadoALaBarraFallaSinBandaYSeDifiereConBandaYSeSaldaCentrado() {
        let marco = CGRect(x: 16, y: 117, width: 154.7, height: 50.3)
        let enBanda = VistaAuditada.medible(arriba: 116, abajo: 775, zona: areaConBorde)
        esFallo(ClasificadorContraste.clasificar(contraste("boton-sesion-accesorio", "Detener sesión", marco: marco), vista: vista, unico: true), "entero a la vista")
        let veredicto = ClasificadorContraste.clasificar(contraste("boton-sesion-accesorio", "Detener sesión", marco: marco), vista: enBanda, unico: true)
        XCTAssertEqual(veredicto, .diferido(ClaveNodo(identificador: "boton-sesion-accesorio", etiqueta: "Detener sesión")))
        var libro = LibroContraste(fase: "bloqueada")
        let zonaBanda = [nodo("boton-sesion-accesorio", "Detener sesión", marco)]
        libro.registrar(contexto: "abajo", hallazgos: [contraste("boton-sesion-accesorio", "Detener sesión", marco: marco)], zona: zonaBanda, aplicacion: zonaBanda, vista: enBanda)
        XCTAssertEqual(libro.pendientes.count, 1)
        // Centrado sigue sin saldarse si el contraste sigue fallando: la banda no oculta un fallo real.
        let centrado = CGRect(x: 16, y: 420, width: 154.7, height: 50.3)
        let zonaCentro = [nodo("boton-sesion-accesorio", "Detener sesión", centrado)]
        libro.registrar(contexto: "remedicion", hallazgos: [contraste("boton-sesion-accesorio", "Detener sesión", marco: centrado)], zona: zonaCentro, aplicacion: zonaCentro, vista: enBanda)
        XCTAssertEqual(libro.fallos.count, 1)
        XCTAssertTrue(libro.pendientes.isEmpty)
        XCTAssertFalse(libro.limpios.contains(ClaveNodo(identificador: "boton-sesion-accesorio", etiqueta: "Detener sesión")))
    }

    func testUnNodoEnLaBandaNoSeAcreditaLimpio() {
        var libro = LibroContraste(fase: "bloqueada")
        let enBanda = VistaAuditada.medible(arriba: 116, abajo: 775, zona: areaConBorde)
        let zona = [nodo("boton-sesion-accesorio", "Detener sesión", CGRect(x: 16, y: 117, width: 154.7, height: 50.3))]
        libro.registrar(contexto: "abajo", hallazgos: [], zona: zona, aplicacion: zona, vista: enBanda)
        XCTAssertTrue(libro.limpios.isEmpty)
    }

    // MARK: Deriva de la maquetación durante la medición

    private func observacion(_ marcos: [CGRect], vista: VistaAuditada? = nil, indicador: Bool = false) -> ObservacionContraste {
        var zona = [anonimo(CGRect(x: 0, y: 0, width: 402, height: 775))]
        zona += marcos.enumerated().map { nodo("nodo-\($0.offset)", "Etiqueta", $0.element) }
        if indicador { zona.append(anonimo(CGRect(x: 369, y: 116, width: 30, height: 659))) }
        return ObservacionContraste(vista: vista ?? self.vista, zona: zona, aplicacion: zona)
    }

    func testObservacionesIgualesNoTienenDeriva() {
        let marcos = [CGRect(x: 16, y: 300, width: 300, height: 40)]
        XCTAssertNil(ObservacionContraste.deriva(antes: observacion(marcos), despues: observacion(marcos)))
    }

    func testUnIndicadorDeDesplazamientoQueApareceNoEsDeriva() {
        let marcos = [CGRect(x: 16, y: 300, width: 300, height: 40)]
        XCTAssertNil(ObservacionContraste.deriva(antes: observacion(marcos), despues: observacion(marcos, indicador: true)))
    }

    func testUnNodoMovidoMasQueLaDerivaMaximaEsDeriva() {
        let antes = observacion([CGRect(x: 16, y: 300, width: 300, height: 40)])
        XCTAssertNil(ObservacionContraste.deriva(antes: antes, despues: observacion([CGRect(x: 16, y: 300.4, width: 300, height: 40)])))
        XCTAssertNotNil(ObservacionContraste.deriva(antes: antes, despues: observacion([CGRect(x: 16, y: 301, width: 300, height: 40)])))
        XCTAssertNotNil(ObservacionContraste.deriva(antes: antes, despues: observacion([CGRect(x: 16, y: 300, width: 300, height: 52)])))
    }

    func testNodoQueApareceODesapareceOCambiaLaZonaVisibleEsDeriva() {
        let marcos = [CGRect(x: 16, y: 300, width: 300, height: 40)]
        XCTAssertNotNil(ObservacionContraste.deriva(antes: observacion(marcos), despues: observacion([])))
        XCTAssertNotNil(ObservacionContraste.deriva(antes: observacion(marcos), despues: observacion(marcos, vista: VistaAuditada(arriba: 170.8, abajo: 775))))
        XCTAssertNotNil(ObservacionContraste.deriva(antes: observacion(marcos), despues: observacion(marcos, vista: VistaAuditada(arriba: 116, abajo: .nan))))
    }

    func testLaDerivaFallaLaFaseSinClasificarNiAcreditarNada() {
        var libro = LibroContraste(fase: "reposo")
        libro.registrarDeriva(contexto: "arriba", motivo: "se movió", nodos: 12)
        XCTAssertEqual(libro.fallos.count, 1)
        XCTAssertTrue(libro.limpios.isEmpty)
        XCTAssertTrue(libro.diferidos.isEmpty)
        XCTAssertEqual(libro.nodosMaximos, 12)
    }

    // MARK: Plan de escalas hacia un nodo lejano

    /// Nodos en columna, uno cada 100 pt desde `y = 150` (como una pantalla larga con el texto más grande).
    private func columna(_ cantidad: Int, duplicado: Int? = nil) -> [NodoJerarquia] {
        var nodos = [anonimo(CGRect(x: 0, y: 0, width: 402, height: 775))]
        for i in 0..<cantidad { nodos.append(nodo("n\(i)", "e", CGRect(x: 16, y: 150 + CGFloat(i) * 100, width: 300, height: 40))) }
        if let duplicado { nodos.append(nodo("n\(duplicado)", "otra", CGRect(x: 16, y: 150 + CGFloat(duplicado) * 100, width: 10, height: 10))) }
        return nodos
    }

    private func escalas(_ destino: String, _ zona: [NodoJerarquia], aplicacion: [NodoJerarquia]? = nil, alcance: CGFloat = 1200) -> [String] {
        PlanRecorrido.escalas(destino: destino, zona: zona, aplicacion: aplicacion ?? zona, arriba: 116, abajo: 775, alcance: alcance)
    }

    func testUnDestinoCercanoNoNecesitaEscalas() {
        XCTAssertEqual(escalas("n5", columna(30)), [])
    }

    func testUnDestinoLejanoSeAlcanzaPorEscalasCadaUnaDentroDelAlcanceYHaciaElDestino() {
        let zona = columna(40)
        let plan = escalas("n39", zona)
        XCTAssertFalse(plan.isEmpty)
        let ancla: CGFloat = 116 + 40
        var desplazado: CGFloat = 0
        for id in plan {
            let y = zona.first { $0.identificador == id }!.marco.minY - ancla
            XCTAssertGreaterThan(y, desplazado, "cada escala avanza hacia el destino")
            XCTAssertLessThanOrEqual(y - desplazado, 1200, "cada tramo cabe en el alcance")
            desplazado = y
        }
        let meta = zona.first { $0.identificador == "n39" }!.marco.midY
        XCTAssertLessThanOrEqual(meta - (116 + 775) / 2 - desplazado, 1200, "el último tramo hasta el destino también")
    }

    func testHaciaArribaTambienEscalonaSinRepetirNodos() {
        // Vista ya desplazada: el destino queda muy por encima (y negativa).
        var zona = [anonimo(CGRect(x: 0, y: 0, width: 402, height: 775))]
        for i in 0..<40 { zona.append(nodo("n\(i)", "e", CGRect(x: 16, y: -3500 + CGFloat(i) * 100, width: 300, height: 40))) }
        let plan = escalas("n0", zona)
        XCTAssertFalse(plan.isEmpty)
        XCTAssertEqual(Set(plan).count, plan.count)
        XCTAssertFalse(plan.contains("n0"))
    }

    func testNodosAmbiguosOSinIdentificadorNoSirvenDeEscala() {
        let zona = columna(40, duplicado: 20)
        XCTAssertFalse(escalas("n39", zona).contains("n20"))
        XCTAssertFalse(escalas("n39", zona).contains(""))
    }

    func testSinRutaOSinDestinoNoInventaEscalas() {
        XCTAssertEqual(escalas("no-existe", columna(40)), [])
        // Dos nodos separados por más que el alcance: no hay escala posible y el exponer final fallará estricto.
        let separados = [anonimo(CGRect(x: 0, y: 0, width: 402, height: 775)),
                         nodo("a", "e", CGRect(x: 0, y: 150, width: 10, height: 10)), nodo("b", "e", CGRect(x: 0, y: 5000, width: 10, height: 10))]
        XCTAssertEqual(escalas("b", separados), [])
    }
}
