import XCTest

/// Auditoría real de accesibilidad de los tipos pedidos. Reúne TODOS los
/// problemas y los adjunta como texto + captura antes de fallar, para que el resultado
/// diga qué elemento falló (en Xcode, sin handler, solo se ve el primero y sin elemento).
/// No ignora nada: si hay un problema, la prueba falla.
private func auditar(_ app: XCUIApplication, _ contexto: String, tipos: XCUIAccessibilityAuditType = .all, testCase: XCTestCase, file: StaticString = #filePath, line: UInt = #line) throws {
    var problemas: [String] = []
    try app.performAccessibilityAudit(for: tipos) { problema in
        let elemento = problema.element
        problemas.append("[\(problema.auditType)] \(problema.compactDescription) | \(problema.detailedDescription) | "
            + "id=«\(elemento?.identifier ?? "?")» etiqueta=«\(elemento?.label ?? "?")» marco=\(elemento.map { "\($0.frame)" } ?? "?")")
        return true  // solo para seguir reuniendo; abajo se falla con todos
    }
    guard !problemas.isEmpty else { return }
    let texto = XCTAttachment(string: problemas.joined(separator: "\n"))
    texto.name = "auditoria-\(contexto)-problemas"
    texto.lifetime = .keepAlways
    testCase.add(texto)
    let captura = XCTAttachment(screenshot: app.screenshot())
    captura.name = "auditoria-\(contexto)-pantalla"
    captura.lifetime = .keepAlways
    testCase.add(captura)
    XCTFail("Auditoría de accesibilidad (\(contexto)): \(problemas.count) problema(s):\n" + problemas.joined(separator: "\n"), file: file, line: line)
}

/// Espera, con la espera nativa de XCTest, a que un predicado sobre el elemento se cumpla.
private func esperar(_ elemento: XCUIElement, _ predicado: String, _ valor: Any, _ mensaje: String, file: StaticString = #filePath, line: UInt = #line) {
    let espera = XCTNSPredicateExpectation(predicate: NSPredicate(format: predicado, argumentArray: [valor]), object: elemento)
    XCTAssertEqual(XCTWaiter().wait(for: [espera], timeout: 10), .completed, mensaje, file: file, line: line)
}

/// Toca el campo (fuera de su barra interna), espera foco de teclado real, escribe y espera a que el campo muestre el texto completo.
/// `typeText` vuelve antes de que el teclado entregue todas las teclas (en CI llegó solo «e» de «error429»
/// y se envió esa «e»); sin esta espera, la prueba enviaba un texto distinto del pedido.
private func escribir(_ texto: String, en campo: XCUIElement, file: StaticString = #filePath, line: UInt = #line) {
    esperar(campo, "isHittable == %@", true, "El campo no es tocable", file: file, line: line)
    // Un TextField vertical lleva una barra de desplazamiento horizontal dentro de su marco: el toque
    // por defecto (centro/esquina) cayó sobre ella (y 312,7…323,7 en un campo de y 304,7…326,7) y no
    // abrió el teclado. Se toca el tramo editable, arriba, dentro del propio marco del campo.
    campo.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2)).tap()
    esperar(campo, "hasKeyboardFocus == %@", true, "El campo no recibió el foco del teclado", file: file, line: line)
    campo.typeText(texto)
    esperar(campo, "value == %@", texto, "El campo no muestra el texto escrito «\(texto)»", file: file, line: line)
}

/// Desliza con gesto real hasta que `objetivo` quede entero y tocable entre la barra de navegación y la
/// barra de pestañas, que en iOS 26 flotan sobre el contenido. Pasos acotados, no reintentos.
private func exponer(_ objetivo: XCUIElement, en app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
    let ventana = app.windows.firstMatch.frame
    let arriba = app.navigationBars.firstMatch.frame.maxY
    let abajo = app.tabBars.firstMatch.frame.minY
    let paso = abajo - arriba - 40
    func visible() -> Bool {
        let marco = objetivo.frame
        return marco.minY >= arriba && marco.maxY <= abajo && objetivo.isHittable
    }
    for _ in 0..<4 where !visible() {
        // Centrar deja margen a ambos lados para la zona muerta inicial del gesto.
        let desplazamiento = max(-paso, min(paso, objetivo.frame.midY - (arriba + abajo) / 2))
        // Arrastrar el contenido, lejos del indicador de desplazamiento del borde derecho.
        let inicio = app.windows.firstMatch.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: ventana.width / 2, dy: desplazamiento > 0 ? abajo - 20 : arriba + 20))
        // Mantener el dedo quieto antes de soltar evita añadir inercia al arrastre.
        inicio.press(
            forDuration: 0.1, thenDragTo: inicio.withOffset(CGVector(dx: 0, dy: -desplazamiento)),
            withVelocity: .default, thenHoldForDuration: 0.5)
    }
    XCTAssertTrue(visible(), "«\(objetivo.identifier)» no queda entero y tocable entre las barras: marco \(objetivo.frame), visible \(arriba)…\(abajo)", file: file, line: line)
}

/// Recorridos de interfaz en el Simulator, SIN red ni servidor: la app se lanza
/// con `-PRUEBAS_UI_SIMULADAS` (solo existe en compilaciones de depuración) y
/// responde con un cliente simulado. Demuestran el comportamiento de la
/// interfaz; no prueban VoiceOver real, Bluetooth, audio ni el backend real.
final class TransMiVozUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
        app = XCUIApplication()
        // Tamaño de texto normal explícito: la categoría no depende de lo que dejó otra prueba en el Simulator.
        app.launchArguments += [
            "-PRUEBAS_UI_SIMULADAS", "-AppleLanguages", "(es)", "-AppleLocale", "es_CO",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryL",
        ]
        app.launch()
        // Ciclo de vida acotado: cada prueba cierra su app y la siguiente arranca limpia.
        addTeardownBlock { [app] in app?.terminate() }
    }

    // MARK: Ayudas

    /// Cualquier tipo de elemento con ese identificador (un TextField vertical puede salir como `textView`).
    private func elemento(_ identificador: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identificador).firstMatch
    }

    private func abrirPestana(_ nombre: String) {
        let pestana = app.tabBars.buttons[nombre]
        XCTAssertTrue(pestana.waitForExistence(timeout: 10), "No existe la pestaña \(nombre)")
        pestana.tap()
    }

    private func preguntar(_ texto: String) {
        abrirPestana("Consulta")
        let campo = elemento("campo-pregunta")
        XCTAssertTrue(campo.waitForExistence(timeout: 10))
        escribir(texto, en: campo)
        elemento("boton-enviar").tap()
        // Enviar cierra el teclado: si no, tapa el resultado y la barra de pestañas.
        XCTAssertTrue(app.keyboards.firstMatch.waitForNonExistence(timeout: 5), "El teclado debe cerrarse al enviar")
    }

    private func esperarTexto(_ etiqueta: String, timeout: TimeInterval = 10, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(app.staticTexts[etiqueta].waitForExistence(timeout: timeout), "No apareció «\(etiqueta)»", file: file, line: line)
    }

    // MARK: Sesión local (sin servidor)

    func testSesionLocalFuncionaSinServidorYSeDeclaraSimulada() throws {
        abrirPestana("Sesión")
        XCTAssertTrue(elemento("aviso-simulada").waitForExistence(timeout: 10), "la sesión debe declararse simulada")
        XCTAssertTrue(app.staticTexts["Origen de los datos: simulación"].exists)
        XCTAssertTrue(app.staticTexts["Enlace autenticado: no (no hay enlace real)"].exists)

        let boton = elemento("boton-sesion")
        XCTAssertEqual(boton.label, "Iniciar sesión simulada")
        boton.tap()
        XCTAssertEqual(boton.label, "Detener sesión")

        // El guion termina y la sesión caduca: no queda una medida vigente.
        let caducada = app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH %@", "Sin datos")).firstMatch
        XCTAssertTrue(caducada.waitForExistence(timeout: 15), "la sesión simulada debe caducar al acabar las tramas")

        boton.tap()
        XCTAssertEqual(boton.label, "Iniciar sesión simulada")
        XCTAssertTrue(app.staticTexts["Sesión detenida. No se está midiendo nada."].waitForExistence(timeout: 5))
    }

    // MARK: Consulta

    func testConsultaMuestraLaRespuestaSimulada() throws {
        preguntar("hola")
        esperarTexto("[SIMULADO] Respuesta de prueba para: hola")
        XCTAssertTrue(app.staticTexts["Interpretada con: reglas"].exists)
    }

    func testEntradaVaciaMuestraError() throws {
        abrirPestana("Consulta")
        elemento("boton-enviar").tap()
        esperarTexto("Escribe una pregunta antes de enviar.")
    }

    func testError401() throws {
        preguntar("error401")
        esperarTexto("El servidor rechazó la clave (401).")
        XCTAssertFalse(elemento("boton-reintentar").exists, "un 401 no se arregla reintentando igual")
    }

    func testError429OfreceReintentar() throws {
        preguntar("error429")
        esperarTexto("Demasiadas peticiones seguidas (429). Espera 3 s antes de reintentar.")
        XCTAssertTrue(elemento("boton-reintentar").exists)
    }

    func testSinConexionOfreceReintentarYLaSesionSigueDisponible() throws {
        preguntar("sinred")
        esperarTexto("No hay conexión con el servidor.")
        XCTAssertTrue(elemento("boton-reintentar").exists)
        abrirPestana("Sesión")
        XCTAssertTrue(elemento("boton-sesion").waitForExistence(timeout: 10), "la pestaña Sesión no se abrió")
        XCTAssertTrue(elemento("boton-sesion").isHittable)
    }

    func testCancelarUnaConsultaLenta() throws {
        preguntar("lento")
        let cancelar = elemento("boton-cancelar")
        XCTAssertTrue(cancelar.waitForExistence(timeout: 10))
        cancelar.tap()
        esperarTexto("Consulta cancelada")
        XCTAssertFalse(app.staticTexts["[SIMULADO] Respuesta lenta que no debería verse."].exists)
    }

    func testSalirDeLaPestanaCancelaUnaConsultaLenta() throws {
        preguntar("lento")
        XCTAssertTrue(elemento("boton-cancelar").waitForExistence(timeout: 10))
        abrirPestana("Sesión")
        abrirPestana("Consulta")
        // Al volver, la consulta ya no sigue en curso: quedó cancelada al salir.
        esperarTexto("Consulta cancelada")
        XCTAssertFalse(elemento("boton-cancelar").exists)
        XCTAssertFalse(app.staticTexts["[SIMULADO] Respuesta lenta que no debería verse."].exists)
    }

    func testOrdenDeAbordajeEnRespuestaNoViajeSeSustituyePorAviso() throws {
        preguntar("orden")
        XCTAssertTrue(elemento("texto-respuesta").waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "no te doy indicaciones de abordaje")).firstMatch.exists)
        XCTAssertFalse(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "Toma la H72")).firstMatch.exists)
        XCTAssertFalse(app.staticTexts.containing(NSPredicate(format: "label CONTAINS %@", "Sube en Calle 127")).firstMatch.exists)
    }

    func testViajeNoMuestraOrdenesDeAbordaje() throws {
        preguntar("viaje")
        XCTAssertTrue(elemento("aviso-viaje").waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts["[SIMULADO] Texto de viaje que la app no debe mostrar."].exists)
    }

    // MARK: Servidor

    func testServidorRechazaHttpYAceptaHttps() throws {
        abrirPestana("Servidor")
        let origen = elemento("campo-origen")
        XCTAssertTrue(origen.waitForExistence(timeout: 10))
        escribir("http://servidor.ejemplo", en: origen)
        elemento("boton-aplicar").tap()
        XCTAssertTrue(app.staticTexts["La dirección debe empezar por https://. La app no usa conexiones sin cifrar."].waitForExistence(timeout: 5))
    }

    // MARK: Auditoría automática de accesibilidad (falla el test si hay problemas)

    func testAuditoriaAccesibilidadSesion() throws {
        abrirPestana("Sesión")
        XCTAssertTrue(elemento("boton-sesion").waitForExistence(timeout: 10))
        try auditar(app, "sesion", testCase: self)
    }

    func testAuditoriaAccesibilidadConsultaConRespuesta() throws {
        preguntar("hola")
        esperarTexto("[SIMULADO] Respuesta de prueba para: hola")
        try auditar(app, "consulta-respuesta", testCase: self)
    }

    func testAuditoriaAccesibilidadConsultaConError() throws {
        preguntar("error429")
        esperarTexto("Demasiadas peticiones seguidas (429). Espera 3 s antes de reintentar.")
        try auditar(app, "consulta-error", testCase: self)
    }

    func testAuditoriaAccesibilidadServidor() throws {
        abrirPestana("Servidor")
        XCTAssertTrue(elemento("campo-origen").waitForExistence(timeout: 10))
        try auditar(app, "servidor", testCase: self)
    }
}

/// Mismo recorrido con el texto más grande de Dynamic Type de accesibilidad.
final class TransMiVozTextoGrandeUITests: XCTestCase {
    func testAuditoriaConTextoMuyGrande() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments += [
            "-PRUEBAS_UI_SIMULADAS", "-AppleLanguages", "(es)", "-AppleLocale", "es_CO",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL",
        ]
        app.launch()
        addTeardownBlock { app.terminate() }
        for nombre in ["Sesión", "Consulta"] {
            let pestana = app.tabBars.buttons[nombre]
            XCTAssertTrue(pestana.waitForExistence(timeout: 10))
            pestana.tap()
            // Las demás auditorías también cambian el tamaño y el desplazamiento: contraste
            // se mide por separado, con el contenido expuesto. Las dos fases cubren .all.
            try auditar(app, "texto-muy-grande-\(nombre)-sin-contraste", tipos: .all.subtracting(.contrast), testCase: self)
            if nombre == "Consulta" {
                // La introducción mide ~500 pt: se audita entera y a la vista, y luego el campo con sus botones.
                for (id, contexto) in [("introduccion-consulta", "introduccion"), ("boton-enviar", "campo")] {
                    exponer(app.descendants(matching: .any).matching(identifier: id).firstMatch, en: app)
                    try auditar(app, "texto-muy-grande-Consulta-\(contexto)", tipos: .contrast, testCase: self)
                }
            } else {
                try auditar(app, "texto-muy-grande-\(nombre)", tipos: .contrast, testCase: self)
            }
        }
    }
}
