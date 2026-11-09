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

    func testUnDestinoAlAlcanceDesdeDondeQuedoLaVistaYaNoNecesitaEscalas() {
        let real = pantalla(comienzoDe: "aviso-seguridad-enlace", en: 600)
        XCTAssertEqual(
            PlanRecorrido.escalas(destino: "estado-accesorio", zona: real, aplicacion: real, arriba: 116, abajo: 775, alcance: 1238, excluir: ["aviso-seguridad-enlace"]),
            [])
    }

    func testLasEscalasExcluidasNoSeRepiten() {
        let real = pantalla(comienzoDe: "aviso-seguridad-enlace", en: 156)
        let sin = PlanRecorrido.escalas(destino: "interruptor-voz-app", zona: real, aplicacion: real, arriba: 116, abajo: 775, alcance: 1238, excluir: ["boton-abrir-ajustes"])
        XCTAssertFalse(sin.contains("boton-abrir-ajustes"))
        XCTAssertFalse(sin.contains("interruptor-voz-app"))
    }

    // MARK: Cuánto pedir en cada gesto

    func testSinSobreimpulsoConocidoSePideLaDistanciaExactaAcotada() {
        XCTAssertEqual(Desplazamiento.pedido(ancla: 357.2, paso: 619, sobreimpulso: 0), 357.2)
        XCTAssertEqual(Desplazamiento.pedido(ancla: 1100, paso: 619, sobreimpulso: 0), 619)
        XCTAssertEqual(Desplazamiento.pedido(ancla: -1100, paso: 619, sobreimpulso: 0), -619)
        XCTAssertEqual(Desplazamiento.pedido(ancla: -152.8, paso: 619, sobreimpulso: 0), -152.8)
    }

    func testElSobreimpulsoConocidoSeDescuentaEnElSentidoDelGesto() {
        XCTAssertEqual(Desplazamiento.pedido(ancla: 357.2, paso: 619, sobreimpulso: 131.3), 225.9, accuracy: 0.001)
        XCTAssertEqual(Desplazamiento.pedido(ancla: -357.2, paso: 619, sobreimpulso: 131.3), -225.9, accuracy: 0.001)
        XCTAssertEqual(Desplazamiento.pedido(ancla: 1100, paso: 619, sobreimpulso: 131.3), 619, "nunca más que el tope de un gesto")
    }

    func testUnaCorreccionMenorQueElSobreimpulsoSigueSiendoUnGestoQueDesplaza() {
        // Pedir 0 sería un toque sin arrastre sobre lo que haya bajo el dedo: se pide como mínimo un gesto que ya desplaza.
        XCTAssertEqual(Desplazamiento.pedido(ancla: 150, paso: 619, sobreimpulso: 165), Desplazamiento.minimo)
        XCTAssertEqual(Desplazamiento.pedido(ancla: -150, paso: 619, sobreimpulso: 165), -Desplazamiento.minimo)
    }

    func testElSobreimpulsoSeMideConLosMarcosRealesAntesYDespuesDelGesto() {
        // Registro nativo de `795dcb9`: tras pedir 357,2 el objetivo pasó de ancla +357,2 a -152,8 (se movió 510).
        XCTAssertEqual(Desplazamiento.sobreimpulso(pedido: 357.2, antes: 1000, despues: 490, paso: 619), 152.8, accuracy: 0.001)
        // Pidió -152,8 (contenido hacia atrás) y el marco bajó 315,3: pasó 162,5 de largo hacia atrás.
        XCTAssertEqual(Desplazamiento.sobreimpulso(pedido: -152.8, antes: 490, despues: 805.3, paso: 619), 162.5, accuracy: 0.001)
    }

    func testSiElContenidoSeMovioMenosDeLoPedidoNoHayNadaQueDescontar() {
        // Llegó al tope del contenido, o se movió en sentido contrario: nunca negativo.
        XCTAssertEqual(Desplazamiento.sobreimpulso(pedido: 357.2, antes: 1000, despues: 800, paso: 619), 0)
        XCTAssertEqual(Desplazamiento.sobreimpulso(pedido: 357.2, antes: 1000, despues: 1100, paso: 619), 0)
    }

    func testUnaMedicionAnomalaNoAnulaElGestoSiguiente() {
        XCTAssertEqual(Desplazamiento.sobreimpulso(pedido: 100, antes: 5000, despues: 0, paso: 619), 619)
        XCTAssertEqual(Desplazamiento.sobreimpulso(pedido: 0, antes: 10, despues: 0, paso: 619), 0)
        XCTAssertEqual(Desplazamiento.sobreimpulso(pedido: 100, antes: .nan, despues: 0, paso: 619), 0)
        XCTAssertEqual(Desplazamiento.sobreimpulso(pedido: 100, antes: 1, despues: .infinity, paso: 619), 0)
    }
}
