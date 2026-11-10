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

    // MARK: Contraste visible pegado a la barra: siempre falla

    private func anonimo(_ marco: CGRect) -> NodoJerarquia { nodo("", "", marco) }

    private let claveDetener = ClaveNodo(identificador: "boton-sesion-accesorio", etiqueta: "Detener sesión")
    /// Como el hallazgo nativo del CI: botón a 1 pt bajo la barra de navegación (barra hasta 116), dentro de la zona visible.
    private let botonPegadoALaBarra = CGRect(x: 16, y: 117, width: 154.7, height: 50.3)

    func testElContrasteDeUnBotonVisiblePegadoALaBarraFallaSinDiferirse() {
        esFallo(
            clasificar(contraste("boton-sesion-accesorio", "Detener sesión", marco: botonPegadoALaBarra)),
            "entero a la vista")
    }

    func testUnaMedicionLimpiaAnteriorNoCubreUnFalloVisibleDeLaMismaFase() {
        var libro = LibroContraste(fase: "bloqueada")
        // Arriba: el mismo botón, entero a la vista, sin problema de contraste (queda como medido limpio).
        let arriba = nodo("boton-sesion-accesorio", "Detener sesión", CGRect(x: 16, y: 300, width: 154.7, height: 50.3))
        libro.registrar(contexto: "arriba", hallazgos: [], zona: [arriba], aplicacion: [arriba], vista: vista)
        XCTAssertTrue(libro.limpios.contains(claveDetener))
        XCTAssertTrue(libro.fallos.isEmpty)
        // Abajo: el mismo botón, en otra posición, con un hallazgo de contraste nativo y marco 117…167 dentro de 116…775.
        let abajo = nodo("boton-sesion-accesorio", "Detener sesión", botonPegadoALaBarra)
        libro.registrar(
            contexto: "abajo", hallazgos: [contraste("boton-sesion-accesorio", "Detener sesión", marco: botonPegadoALaBarra)],
            zona: [abajo], aplicacion: [abajo], vista: vista)
        XCTAssertEqual(libro.fallos.count, 1, "la fase falla: el contraste visible no se compensa con la medición limpia anterior")
        XCTAssertTrue(libro.diferidos.isEmpty)
        XCTAssertTrue(libro.pendientes.isEmpty, "no hay deuda que una medición posterior pueda saldar")
        XCTAssertTrue(libro.resueltosConFallo.contains(claveDetener))
    }

    func testUnNodoDentroDeLaZonaVisibleNuncaSeDifiereAunqueHayaAnonimosPegadosAlBorde() {
        // Los nodos anónimos del área (por ejemplo, un efecto de borde) no cambian la zona visible: manda la geometría real.
        let zona = [anonimo(CGRect(x: 0, y: 0, width: 402, height: 775)), anonimo(CGRect(x: 0, y: 0, width: 402, height: 170.8)),
                    nodo("boton-sesion-accesorio", "Detener sesión", botonPegadoALaBarra)]
        var libro = LibroContraste(fase: "bloqueada")
        libro.registrar(
            contexto: "abajo", hallazgos: [contraste("boton-sesion-accesorio", "Detener sesión", marco: botonPegadoALaBarra)],
            zona: zona, aplicacion: zona, vista: vista)
        XCTAssertEqual(libro.fallos.count, 1)
        XCTAssertTrue(libro.diferidos.isEmpty)
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

    // MARK: Recorrido con la vista real que dejó cada escala

    /// Marcos reales (370 pt de ancho, `AccessibilityXXXL`) de la jerarquía nativa de `795dcb9`: `y` y alto de cada nodo único.
    private let pantallaReal: [(String, CGFloat, CGFloat)] = [
        ("aviso-transporte-sintetico", -208.0, 520.7), ("aviso-accesorio-real", 328.7, 986.7), ("aviso-seguridad-enlace", 1331.3, 869.3),
        ("estado-bluetooth", 2216.7, 311.3), ("boton-abrir-ajustes", 2536.0, 77.3), ("encabezado-accesorio", 2629.3, 63.3),
        ("accesorio-elegido", 2700.7, 125.3), ("boton-buscar", 2834.0, 139.3), ("nota-identificador-accesorio", 2981.3, 260.7),
        ("boton-sesion-accesorio", 3258.0, 87.3), ("boton-reconectar", 3353.3, 87.3), ("encabezado-estado-accesorio", 3456.7, 125.3),
        ("estado-accesorio", 3728.7, 435.3), ("origen-datos-accesorio", 4172.0, 249.3), ("enlace-accesorio", 4429.3, 187.3),
        ("tramas-perdidas-accesorio", 4624.7, 125.3), ("estado-audio", 4758.0, 621.3), ("interruptor-voz-app", 5395.3, 187.3),
    ]

    /// La misma pantalla desplazada para que `id` tenga su comienzo en `y`.
    private func pantalla(comienzoDe id: String, en y: CGFloat) -> [NodoJerarquia] {
        let desvio = y - pantallaReal.first { $0.0 == id }!.1
        return pantallaReal.map { nodo($0.0, "e", CGRect(x: 16, y: $0.1 + desvio, width: 370, height: $0.2)) }
    }

    func testLaPantallaRealDelAccesorioSeRecorreConUnaSolaEscalaPorInstantanea() {
        let inicial = pantallaReal.map { nodo($0.0, "e", CGRect(x: 16, y: $0.1, width: 370, height: $0.2)) }
        let plan = PlanRecorrido.escalas(destino: "estado-accesorio", zona: inicial, aplicacion: inicial, arriba: 116, abajo: 775, alcance: 1238)
        XCTAssertEqual(plan, ["aviso-seguridad-enlace", "boton-abrir-ajustes"])
    }

    func testSiLaEscalaQuedoMasAbajoDeLoQueSuponeElPlanElPlanViejoNoAlcanzaYElNuevoSi() {
        // `exponer(completo: false)` dejó «aviso-seguridad-enlace» con su comienzo en y 300, no en 156 (116 + 40).
        let real = pantalla(comienzoDe: "aviso-seguridad-enlace", en: 300)
        func tramo(_ id: String) -> CGFloat { real.first { $0.identificador == id }!.marco.minY - 156 }
        XCTAssertGreaterThan(tramo("boton-abrir-ajustes"), 1238, "la segunda escala del plan viejo ya no cabe en el alcance desde donde quedó la vista")
        let nuevo = PlanRecorrido.escalas(
            destino: "estado-accesorio", zona: real, aplicacion: real, arriba: 116, abajo: 775, alcance: 1238, excluir: ["aviso-seguridad-enlace"])
        XCTAssertEqual(nuevo.first, "estado-bluetooth")
        XCTAssertGreaterThan(tramo(nuevo[0]), 0)
        XCTAssertLessThanOrEqual(tramo(nuevo[0]), 1238, "la escala nueva sí cabe en el alcance desde donde quedó la vista")
    }

    func testUnDestinoAlAlcanceDesdeDondeQuedoLaVistaYaNoNecesitaEscalas() throws {
        let real = pantalla(comienzoDe: "estado-accesorio", en: 600)
        let destino = try XCTUnwrap(real.first { $0.identificador == "estado-accesorio" })
        let alcance: CGFloat = 1238
        XCTAssertLessThanOrEqual(abs(destino.marco.midY - (vista.arriba + vista.abajo) / 2), alcance,
            "el destino debe estar al alcance para comprobar que no necesita escalas")
        XCTAssertEqual(
            PlanRecorrido.escalas(destino: "estado-accesorio", zona: real, aplicacion: real, arriba: 116, abajo: 775, alcance: alcance, excluir: ["aviso-seguridad-enlace"]),
            [])
    }

    func testLasEscalasExcluidasNoSeRepiten() {
        let real = pantalla(comienzoDe: "aviso-seguridad-enlace", en: 156)
        let sin = PlanRecorrido.escalas(destino: "interruptor-voz-app", zona: real, aplicacion: real, arriba: 116, abajo: 775, alcance: 1238, excluir: ["boton-abrir-ajustes"])
        XCTAssertFalse(sin.contains("boton-abrir-ajustes"))
        XCTAssertFalse(sin.contains("interruptor-voz-app"))
    }

    // MARK: Destino con identificador compartido por icono y texto

    /// Marcos reales de la jerarquía nativa de `20dc3dc` (`AccessibilityXXXL`): el `Label` del título del bloqueo da un icono
    /// (`Image` «Advertencia», 57,3 × 52) y un texto (`StaticText`, 359,3 × 195,7) con el MISMO identificador. El icono va
    /// primero y su comienzo queda 7 pt más abajo que el del texto. Aquí el icono está justo al alcance y el texto no.
    func testUnIdentificadorCompartidoPlaneaHaciaElNodoDeLaEtiquetaPedida() throws {
        let titulo = "titulo-estado-accesorio", texto = "Bloqueado: enlace no verificado"
        let escena = [
            nodo("boton-sesion-accesorio", "Detener sesión", CGRect(x: 16, y: 1856.5, width: 250.3, height: 155.3)),
            nodo("boton-reconectar", "Reconectar", CGRect(x: 16, y: 2019.8, width: 317, height: 93.3)),
            nodo("encabezado-estado-accesorio", "Estado del accesorio", CGRect(x: 16, y: 2129.2, width: 258.3, height: 125.3)),
            nodo(titulo, "Advertencia", CGRect(x: 21.3, y: 2269.5, width: 57.3, height: 52)),
            nodo(titulo, texto, CGRect(x: 21.3, y: 2262.5, width: 359.3, height: 195.7)),
        ]
        let alcance = PlanRecorrido.alcance(arriba: 116, abajo: 775)
        let centro: CGFloat = (116 + 775) / 2
        let icono = try XCTUnwrap(escena.first { $0.etiqueta == "Advertencia" })
        let nodoTexto = try XCTUnwrap(escena.first { $0.etiqueta == texto })
        XCTAssertLessThanOrEqual(icono.marco.midY - centro, alcance, "el icono está al alcance")
        XCTAssertGreaterThan(nodoTexto.marco.midY - centro, alcance, "el texto, no")

        // Sin etiqueta el destino es el primero con ese identificador, el icono, y el plan da el destino por alcanzado.
        XCTAssertEqual(
            PlanRecorrido.escalas(destino: titulo, zona: escena, aplicacion: escena, arriba: 116, abajo: 775, alcance: alcance), [])
        // Con la etiqueta el destino es el texto: hace falta una escala y desde ella el texto queda al alcance.
        let plan = PlanRecorrido.escalas(destino: titulo, etiqueta: texto, zona: escena, aplicacion: escena, arriba: 116, abajo: 775, alcance: alcance)
        XCTAssertEqual(plan, ["boton-sesion-accesorio"])
        let tramo = try XCTUnwrap(escena.first { $0.identificador == plan[0] }).marco.minY - (116 + 40)
        XCTAssertLessThanOrEqual(tramo, alcance)
        XCTAssertLessThanOrEqual(nodoTexto.marco.midY - centro - tramo, alcance)
    }

    // MARK: Recorrido del reposo real cuando la primera escala ya está a la vista

    /// Nodos con identificador de la jerarquía nativa adjunta al fallo de `8734600` (reposo, `AccessibilityXXXL`): `y` y alto.
    /// Esa jerarquía es de DESPUÉS de los cuatro gestos fallidos hacia «boton-reconectar» (4 × 609 pt): `reposoReal` le suma
    /// esos 2436 pt para volver a la instantánea que vio el plan. «titulo-estado-accesorio» sale dos veces, como en la real.
    private let reposoTrasElFallo: [(String, CGFloat, CGFloat)] = [
        ("aviso-transporte-sintetico", -2573.0, 520.7), ("aviso-accesorio-real", -2036.3, 986.7), ("aviso-seguridad-enlace", -1033.7, 869.3),
        ("estado-bluetooth", -148.3, 187.3), ("encabezado-accesorio", 55.0, 63.3), ("accesorio-elegido", 126.3, 125.3),
        ("boton-buscar", 259.7, 139.3), ("nota-identificador-accesorio", 407.0, 260.7), ("boton-sesion-accesorio", 683.7, 87.3),
        ("boton-reconectar", 779.0, 87.3), ("encabezado-estado-accesorio", 882.3, 125.3), ("titulo-estado-accesorio", 1020.7, 56.0),
        ("titulo-estado-accesorio", 1015.7, 130.7), ("estado-accesorio", 1154.3, 435.3), ("origen-datos-accesorio", 1597.7, 249.3),
        ("enlace-accesorio", 1855.0, 187.3), ("tramas-perdidas-accesorio", 2050.3, 125.3), ("estado-audio", 2183.7, 621.3),
        ("interruptor-voz-app", 2821.0, 187.3), ("etiqueta-interruptor-voz-app", 2821.0, 187.3), ("nota-voz-app", 3016.3, 572.7),
        ("aviso-sin-red", 3605.0, 208.7),
    ]

    private var reposoReal: [NodoJerarquia] {
        reposoTrasElFallo.map { nodo($0.0, "e", CGRect(x: 16, y: $0.1 + 2436, width: 370, height: $0.2)) }
    }

    /// Réplica pura de `exponer` (`TransMiVozUITests.swift`) sobre una instantánea: mismo paso, mismo tope de cuatro gestos,
    /// misma solicitud y misma condición de parada, salvo `isHittable` y el final del contenido, que solo existen en el
    /// simulador. Cada gesto mueve 10 pt menos de lo pedido, como en la corrida nativa (619 pedidos y 609 movidos; 566,3 y
    /// 556,3). Devuelve la instantánea desplazada y el marco del objetivo antes de cada gesto.
    private func exponerSimulado(_ id: String, en inicial: [NodoJerarquia], completo: Bool) -> (nodos: [NodoJerarquia], antes: [CGRect], queda: Bool) {
        let paso = vista.abajo - vista.arriba - 40
        var nodos = inicial
        var antes: [CGRect] = []
        func marco() -> CGRect { nodos.first { $0.identificador == id }!.marco }
        func visible() -> Bool {
            marco().minY >= vista.arriba && (completo ? marco().maxY <= vista.abajo : marco().minY <= vista.abajo - 80)
        }
        for _ in 1...4 where !visible() {
            antes.append(marco())
            let pedido = max(-paso, min(paso, completo ? marco().midY - (vista.arriba + vista.abajo) / 2 : marco().minY - (vista.arriba + 40)))
            let movido = pedido - max(-10, min(10, pedido))
            nodos = nodos.map { nodo($0.identificador, $0.etiqueta, $0.marco.offsetBy(dx: 0, dy: -movido)) }
        }
        return (nodos, antes, visible())
    }

    /// Réplica pura de `FaseAuditada.acercar` seguido del `exponer` final: se planea con la instantánea de cada momento, se
    /// recorre solo la primera escala (`completo: false`) y no se repite ninguna. `antes` y `final` son marcos del destino.
    private func recorrer(hasta destino: String, desde inicial: [NodoJerarquia], alcance: CGFloat) -> (escalas: [String], gestosDeEscalas: Int, antes: [CGRect], final: CGRect, queda: Bool) {
        var nodos = inicial
        var escalas: [String] = []
        var gestos = 0
        while let siguiente = PlanRecorrido.escalas(
            destino: destino, zona: nodos, aplicacion: nodos, arriba: vista.arriba, abajo: vista.abajo, alcance: alcance, excluir: Set(escalas)).first {
            escalas.append(siguiente)
            let escala = exponerSimulado(siguiente, en: nodos, completo: false)
            XCTAssertTrue(escala.queda, "la escala «\(siguiente)» no quedó con su comienzo a la vista en cuatro gestos")
            gestos += escala.antes.count
            nodos = escala.nodos
        }
        let ultimo = exponerSimulado(destino, en: nodos, completo: true)
        return (escalas, gestos, ultimo.antes, ultimo.nodos.first { $0.identificador == destino }!.marco, ultimo.queda)
    }

    func testElReposoRealLlegaAReconectarAunqueLaPrimeraEscalaYaEsteALaVista() throws {
        let inicial = reposoReal
        let paso = vista.abajo - vista.arriba - 40
        let destino = try XCTUnwrap(inicial.first { $0.identificador == "boton-reconectar" })
        XCTAssertGreaterThan(destino.marco.midY - (vista.arriba + vista.abajo) / 2, 4 * paso, "sin escalas, los cuatro gestos del `exponer` final no llegan")

        // Con dos pasos de alcance (el de `8734600`) la réplica da los marcos de la corrida nativa: la única escala al alcance
        // ya tenía su comienzo a la vista y no movió nada, la siguiente caía 8,3 pt fuera y el destino se quedó en y 779.
        let viejo = recorrer(hasta: "boton-reconectar", desde: inicial, alcance: 2 * paso)
        XCTAssertEqual(viejo.escalas, ["aviso-accesorio-real"])
        XCTAssertEqual(viejo.gestosDeEscalas, 0)
        XCTAssertEqual(viejo.antes.map(\.minY), [3215, 2606, 1997, 1388])
        XCTAssertEqual(viejo.final.minY, 779)
        XCTAssertFalse(viejo.queda)

        // Con el alcance que usa `acercar`, la escala es el aviso siguiente y el destino queda entero entre las barras.
        let nuevo = recorrer(hasta: "boton-reconectar", desde: inicial, alcance: PlanRecorrido.alcance(arriba: vista.arriba, abajo: vista.abajo))
        XCTAssertEqual(nuevo.escalas, ["aviso-seguridad-enlace"])
        XCTAssertTrue(nuevo.queda, "«boton-reconectar» quedó en \(nuevo.final)")
        XCTAssertGreaterThanOrEqual(nuevo.final.minY, vista.arriba)
        XCTAssertLessThanOrEqual(nuevo.final.maxY, vista.abajo)
        XCTAssertLessThanOrEqual(nuevo.antes.count, 3, "sobra un gesto del tope para corregir")
    }

    /// Las demás deudas del cierre salen de esa misma posición: cada nodo único que cabe en la vista tiene que alcanzarse.
    func testDesdeEsaInstantaneaDelReposoSeAlcanzaCadaNodoUnicoQueCabeEnLaVista() {
        let inicial = reposoReal
        let alcance = PlanRecorrido.alcance(arriba: vista.arriba, abajo: vista.abajo)
        let unicos = Dictionary(grouping: inicial, by: \.identificador).filter { $0.value.count == 1 }
        for destino in inicial where unicos[destino.identificador] != nil && vista.cabe(destino.marco) {
            let recorrido = recorrer(hasta: destino.identificador, desde: inicial, alcance: alcance)
            XCTAssertTrue(recorrido.queda, "«\(destino.identificador)» quedó en \(recorrido.final) tras las escalas \(recorrido.escalas)")
        }
    }
}
