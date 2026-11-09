import XCTest

/// Auditoría real de accesibilidad de todos los tipos. Reúne TODOS los
/// problemas y los adjunta como texto + captura antes de fallar, para que el resultado
/// diga qué elemento falló (en Xcode, sin handler, solo se ve el primero y sin elemento).
/// No ignora nada: si hay un problema, la prueba falla.
private func auditar(_ app: XCUIApplication, _ contexto: String, testCase: XCTestCase, file: StaticString = #filePath, line: UInt = #line) throws {
    var problemas: [String] = []
    // Separar las pruebas que cambian fuentes evita mezclar geometrías y acota cada petición nativa.
    let auditorias: [XCUIAccessibilityAuditType] = [
        .all.subtracting([.dynamicType, .textClipped]), .dynamicType, .textClipped,
    ]
    for tipos in auditorias {
        try XCTContext.runActivity(named: "Auditoría \(contexto): \(tipos)") { _ in
            try app.performAccessibilityAudit(for: tipos) { problema in
                let elemento = problema.element
                problemas.append("[\(problema.auditType)] \(problema.compactDescription) | \(problema.detailedDescription) | "
                    + "id=«\(elemento?.identifier ?? "?")» etiqueta=«\(elemento?.label ?? "?")» marco=\(elemento.map { "\($0.frame)" } ?? "?")")
                return true  // solo para seguir reuniendo; abajo se falla con todos
            }
        }
    }
    guard !problemas.isEmpty else { return }
    let texto = XCTAttachment(string: problemas.joined(separator: "\n") + "\n\nJerarquía de accesibilidad:\n" + app.debugDescription)
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
private func escribir(_ texto: String, en campo: XCUIElement, app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
    esperar(campo, "isHittable == %@", true, "El campo no es tocable", file: file, line: line)
    // Un TextField vertical lleva una barra de desplazamiento horizontal dentro de su marco: el toque
    // por defecto (centro/esquina) cayó sobre ella (y 312,7…323,7 en un campo de y 304,7…326,7) y no
    // abrió el teclado. Se toca el tramo editable, arriba, dentro del propio marco del campo.
    campo.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.2)).tap()
    XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10), "El teclado no apareció", file: file, line: line)
    // typeText exige foco real en el campo; no se depende del atributo privado hasKeyboardFocus.
    campo.typeText(texto)
    esperar(campo, "value == %@", texto, "El campo no muestra el texto escrito «\(texto)»", file: file, line: line)
}

/// Arrastra el contenido `desplazamiento` puntos (positivo = hacia delante), lejos del indicador del borde derecho.
private func arrastrarContenido(_ desplazamiento: CGFloat, en app: XCUIApplication, arriba: CGFloat, abajo: CGFloat) {
    let ventana = app.windows.firstMatch.frame
    let inicio = app.windows.firstMatch.coordinate(withNormalizedOffset: .zero)
        .withOffset(CGVector(dx: ventana.width / 2, dy: desplazamiento > 0 ? abajo - 20 : arriba + 20))
    // Mantener el dedo quieto antes de soltar evita añadir inercia al arrastre.
    inicio.press(
        forDuration: 0.1, thenDragTo: inicio.withOffset(CGVector(dx: 0, dy: -desplazamiento)),
        withVelocity: .default, thenHoldForDuration: 0.5)
}

/// Busca hacia delante en el orden de lectura y centra el elemento entre las barras.
/// Con tamaños de accesibilidad los controles de creación diferida pueden no existir hasta desplazarse. Máximo cuatro gestos.
/// `completo: false` es solo para textos que con `AccessibilityXXXL` miden más que el área visible (un aviso de
/// ~200 caracteres ocupa más de 900 pt): pide que su COMIENZO quede a la vista y tocable por arriba, no entero.
/// Todo lo demás (botones, interruptor, títulos) se sigue exigiendo entero y tocable.
private func exponer(_ identificador: String, en app: XCUIApplication, completo: Bool = true, file: StaticString = #filePath, line: UInt = #line) {
    let objetivo = app.descendants(matching: .any).matching(identifier: identificador).firstMatch
    let contenido = app.scrollViews.firstMatch.frame
    let limiteBarra = app.tabBars.firstMatch.frame.minY
    XCTAssertLessThanOrEqual(contenido.maxY, limiteBarra,
        "El área de desplazamiento invade la barra de pestañas: marco \(contenido), barra desde \(limiteBarra)", file: file, line: line)
    let arriba = max(app.navigationBars.firstMatch.frame.maxY, contenido.minY)
    let abajo = min(limiteBarra, contenido.maxY)
    let paso = abajo - arriba - 40
    func visible() -> Bool {
        guard objetivo.exists else { return false }
        let marco = objetivo.frame
        if !completo { return marco.minY >= arriba && marco.minY <= abajo - 80 }
        return marco.minY >= arriba && marco.maxY <= abajo && objetivo.isHittable
    }
    for _ in 0..<4 where !visible() {
        // Centrar deja margen a ambos lados para la zona muerta inicial del gesto.
        // Un control de creación diferida aún no existe: no se lee su marco (sería una instantánea fallida), se avanza un paso.
        let desplazamiento: CGFloat
        if objetivo.exists {
            let ancla = completo ? objetivo.frame.midY - (arriba + abajo) / 2 : objetivo.frame.minY - (arriba + 40)
            desplazamiento = max(-paso, min(paso, ancla))
        } else {
            desplazamiento = paso
        }
        arrastrarContenido(desplazamiento, en: app, arriba: arriba, abajo: abajo)
    }
    XCTAssertTrue(visible(), "«\(identificador)» no queda \(completo ? "entero y tocable" : "con su comienzo a la vista") entre las barras: marco \(objetivo.exists ? "\(objetivo.frame)" : "fuera de la jerarquía visible"), visible \(arriba)…\(abajo)", file: file, line: line)
}

/// Comprueba, sin desplazar, que cada elemento YA creado queda entero entre las barras (y tocable si `tocables`).
/// La pantalla del accesorio crea sus elementos al acercarse a la vista: solo se lee el marco de uno que existe,
/// y el que no existe falla con un mensaje claro. Es la prueba de que lo auditado a continuación se ve de verdad.
private func comprobarEnteros(_ ids: [String], en app: XCUIApplication, tocables: Bool = false, file: StaticString = #filePath, line: UInt = #line) {
    let arriba = app.navigationBars.firstMatch.frame.maxY
    let abajo = app.scrollViews.firstMatch.frame.maxY
    for id in ids {
        let objetivo = app.descendants(matching: .any).matching(identifier: id).firstMatch
        XCTAssertTrue(objetivo.exists, "«\(id)» no existe en la vista que se va a auditar", file: file, line: line)
        let marco = objetivo.frame
        XCTAssertTrue(marco.minY >= arriba && marco.maxY <= abajo,
            "«\(id)» no queda entero en la vista auditada: marco \(marco), visible \(arriba)…\(abajo)", file: file, line: line)
        if tocables { XCTAssertTrue(objetivo.isHittable, "«\(id)» no es tocable en la vista auditada", file: file, line: line) }
    }
}

/// Lleva la pantalla del accesorio al final de su contenido y comprueba que los `visibles` quedan enteros entre las barras.
/// Con la creación diferida de la pantalla, lo que queda bajo el área desplazable (entre su borde y la barra de
/// pestañas) no llega a existir, y al final del contenido no queda nada debajo: es la auditoría «de abajo».
private func exponerAlFinal(visibles: [String], en app: XCUIApplication, file: StaticString = #filePath, line: UInt = #line) {
    exponer("aviso-sin-red", en: app, file: file, line: line)
    comprobarEnteros(visibles, en: app, file: file, line: line)
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
        esperar(pestana, "isSelected == %@", true, "No se seleccionó la pestaña \(nombre)")
    }

    private func preguntar(_ texto: String) {
        abrirPestana("Consulta")
        let campo = elemento("campo-pregunta")
        XCTAssertTrue(campo.waitForExistence(timeout: 10))
        escribir(texto, en: campo, app: app)
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
        escribir("http://servidor.ejemplo", en: origen, app: app)
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
            esperar(pestana, "isSelected == %@", true, "No se seleccionó la pestaña \(nombre)")
            if nombre == "Consulta" {
                // La introducción mide ~500 pt: se audita entera y a la vista, y luego el campo con sus botones.
                for (id, contexto) in [("introduccion-consulta", "introduccion"), ("boton-enviar", "campo")] {
                    exponer(id, en: app)
                    if id == "boton-enviar" {
                        let contador = app.staticTexts["contador-caracteres"]
                        XCTAssertTrue(contador.isHittable, "El contador debe estar visible para auditarlo")
                        XCTAssertGreaterThanOrEqual(contador.frame.minY, app.navigationBars.firstMatch.frame.maxY)
                        XCTAssertLessThanOrEqual(contador.frame.maxY, app.scrollViews.firstMatch.frame.maxY)
                    }
                    try auditar(app, "texto-muy-grande-Consulta-\(contexto)", testCase: self)
                }
            } else {
                try auditar(app, "texto-muy-grande-\(nombre)", testCase: self)
            }
        }
    }
}

/// La pantalla REAL del accesorio (`SesionAccesorioVista`, la misma vista y la misma sesión que en producción)
/// recorrida con un transporte SINTÉTICO que la pantalla rotula (`-PRUEBAS_UI_ACCESORIO_SINTETICO`, solo en
/// depuración): sin Bluetooth, radio, audio ni red. El bloqueo por enlace no verificado sigue intacto. Demuestra
/// la interfaz (elegir, iniciar, detener, reconectar, permiso); no prueba Bluetooth, audio ni VoiceOver reales.
final class TransMiVozAccesorioUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    private func lanzar(_ extra: [String] = [], categoria: String = "UICTContentSizeCategoryL") {
        app = XCUIApplication()
        app.launchArguments += ["-PRUEBAS_UI_ACCESORIO_SINTETICO"] + extra + [
            "-AppleLanguages", "(es)", "-AppleLocale", "es_CO", "-UIPreferredContentSizeCategoryName", categoria,
        ]
        app.launch()
        // Ciclo de vida acotado: cada prueba cierra su app y la siguiente arranca limpia.
        addTeardownBlock { [app] in app?.terminate() }
    }

    private func elemento(_ identificador: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identificador).firstMatch
    }

    /// Cualquier elemento cuya etiqueta sea exactamente ese texto (un `Label` de SwiftUI no siempre sale como `staticText`).
    private func etiquetado(_ texto: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", texto)).firstMatch
    }

    private func esperarEtiqueta(_ texto: String, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(etiquetado(texto).waitForExistence(timeout: 10), "No apareció «\(texto)»", file: file, line: line)
    }

    private func abrirPestana(_ nombre: String) {
        let pestana = app.tabBars.buttons[nombre]
        XCTAssertTrue(pestana.waitForExistence(timeout: 10), "No existe la pestaña \(nombre)")
        pestana.tap()
        esperar(pestana, "isSelected == %@", true, "No se seleccionó la pestaña \(nombre)")
    }

    /// Buscar, aceptar la explicación del permiso si sale, y elegir el accesorio sintético.
    private func buscarYElegir(conHoja: Bool) {
        exponer("boton-buscar", en: app)
        elemento("boton-buscar").tap()
        if conHoja {
            let continuar = elemento("boton-permiso-continuar")
            XCTAssertTrue(continuar.waitForExistence(timeout: 10), "Falta la explicación previa al permiso de Bluetooth")
            continuar.tap()
            XCTAssertTrue(continuar.waitForNonExistence(timeout: 10), "La hoja del permiso no se cerró")
        }
        let elegir = elemento("elegir-SINTETICO-0001")
        XCTAssertTrue(elegir.waitForExistence(timeout: 10), "No apareció el accesorio sintético")
        exponer("elegir-SINTETICO-0001", en: app)
        elegir.tap()
        esperarEtiqueta("Accesorio elegido: Accesorio sintético (0001)")
        esperar(elegir, "isSelected == %@", true, "El accesorio elegido debe exponer el rasgo «seleccionado»")
    }

    private func iniciarYEsperarBloqueo() {
        exponer("boton-sesion-accesorio", en: app)
        let boton = elemento("boton-sesion-accesorio")
        XCTAssertTrue(boton.isEnabled)
        XCTAssertEqual(boton.label, "Iniciar sesión")
        boton.tap()
        // El botón está a la vista: su cambio de rótulo es la señal. El título del bloqueo puede quedar aún sin crear
        // (creación diferida): se coloca a la vista antes de esperarlo.
        esperar(boton, "label == %@", "Detener sesión", "La sesión no arrancó")
        exponer("titulo-estado-accesorio", en: app)
        esperarEtiqueta("Bloqueado: enlace no verificado")
    }

    // MARK: Recorrido

    func testElegirIniciarBloqueadoDetenerYReconectar() throws {
        lanzar()
        XCTAssertTrue(elemento("aviso-transporte-sintetico").waitForExistence(timeout: 10), "el transporte sintético debe declararse")
        XCTAssertTrue(elemento("aviso-seguridad-enlace").exists, "el bloqueo por enlace no verificado sigue activo")
        exponer("boton-sesion-accesorio", en: app)
        XCTAssertFalse(elemento("boton-sesion-accesorio").isEnabled, "sin accesorio elegido no se puede iniciar")

        buscarYElegir(conHoja: true)
        iniciarYEsperarBloqueo()
        exponer("enlace-accesorio", en: app)
        XCTAssertTrue(etiquetado("Enlace autenticado: no verificado").exists)
        XCTAssertFalse(app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH %@", "Objeto")).firstMatch.exists, "bloqueado: ninguna medida")

        // Detener.
        exponer("boton-sesion-accesorio", en: app)
        let boton = elemento("boton-sesion-accesorio")
        boton.tap()
        esperarEtiqueta("Detenido")
        XCTAssertEqual(boton.label, "Iniciar sesión")

        // Reconectar: nueva conexión, mismo bloqueo.
        exponer("boton-reconectar", en: app)
        elemento("boton-reconectar").tap()
        esperarEtiqueta("Bloqueado: enlace no verificado")
        XCTAssertEqual(boton.label, "Detener sesión")
    }

    func testAhoraNoEnLaExplicacionDelPermisoNoPideNadaAlSistema() throws {
        lanzar()
        exponer("boton-buscar", en: app)
        elemento("boton-buscar").tap()
        let ahoraNo = elemento("boton-permiso-ahora-no")
        XCTAssertTrue(ahoraNo.waitForExistence(timeout: 10))
        ahoraNo.tap()
        XCTAssertTrue(ahoraNo.waitForNonExistence(timeout: 10))
        XCTAssertTrue(etiquetado("Bluetooth: sin consultar todavía.").exists, "no se pidió nada al sistema")
        XCTAssertFalse(elemento("buscando-accesorios").exists)
        XCTAssertFalse(elemento("busqueda-pendiente").exists)
        XCTAssertEqual(elemento("boton-buscar").label, "Buscar accesorios")
    }

    func testPermisoDenegadoDaAyudaYElRestoDeLaAppSigueFuncionando() throws {
        lanzar(["-PRUEBAS_UI_ACCESORIO_PERMISO_DENEGADO"])
        exponer("boton-buscar", en: app)
        elemento("boton-buscar").tap()
        let continuar = elemento("boton-permiso-continuar")
        XCTAssertTrue(continuar.waitForExistence(timeout: 10))
        continuar.tap()
        XCTAssertTrue(continuar.waitForNonExistence(timeout: 10), "La hoja del permiso no se cerró")
        // El aviso y «Abrir Ajustes» están arriba, fuera de la vista tras buscar: se vuelve allí para que existan.
        exponer("aviso-transporte-sintetico", en: app)
        esperarEtiqueta("Sin permiso de Bluetooth. Actívalo en Ajustes, en TransMiVoz.")
        XCTAssertTrue(elemento("boton-abrir-ajustes").waitForExistence(timeout: 10), "debe ofrecer cómo activarlo")
        XCTAssertFalse(elemento("buscando-accesorios").exists, "con el permiso denegado nunca se presenta como buscando")
        XCTAssertFalse(elemento("busqueda-pendiente").exists)
        XCTAssertEqual(elemento("boton-buscar").label, "Buscar accesorios")
        // Denegar nunca bloquea el resto de la app.
        abrirPestana("Consulta")
        XCTAssertTrue(elemento("campo-pregunta").waitForExistence(timeout: 10))
    }

    // MARK: Auditoría de accesibilidad de la pantalla real

    /// Con texto normal la auditoría se hace en DOS posiciones, cada una con todos los tipos y sin filtros: arriba
    /// (avisos, permiso y los botones) y al final (estado y audio). Entre una y otra se comprueba que lo auditado
    /// queda entero entre las barras. La pantalla crea sus elementos al acercarse, así que lo recortado bajo el
    /// área desplazable no existe y no se audita sin verse.
    func testAuditoriaAccesibilidadSesionAccesorioEnReposoYBloqueada() throws {
        lanzar(["-PRUEBAS_UI_ACCESORIO_PERMISO_CONCEDIDO"])
        XCTAssertTrue(elemento("aviso-transporte-sintetico").waitForExistence(timeout: 10))
        // Reposo, arriba: los dos botones están inhabilitados porque no hay accesorio elegido, y deben pasar el contraste.
        exponer("aviso-transporte-sintetico", en: app)
        comprobarEnteros(["aviso-seguridad-enlace", "boton-sesion-accesorio", "boton-reconectar"], en: app)
        XCTAssertFalse(elemento("boton-sesion-accesorio").isEnabled)
        XCTAssertFalse(elemento("boton-reconectar").isEnabled)
        try auditar(app, "accesorio-reposo-arriba", testCase: self)
        exponerAlFinal(visibles: ["estado-accesorio", "estado-audio"], en: app)
        try auditar(app, "accesorio-reposo-abajo", testCase: self)
        buscarYElegir(conHoja: false)
        iniciarYEsperarBloqueo()
        exponer("aviso-transporte-sintetico", en: app)
        try auditar(app, "accesorio-bloqueado-arriba", testCase: self)
        exponerAlFinal(visibles: ["estado-accesorio", "estado-audio"], en: app)
        try auditar(app, "accesorio-bloqueado-abajo", testCase: self)
    }

    func testAuditoriaAccesibilidadPermisoDenegado() throws {
        lanzar(["-PRUEBAS_UI_ACCESORIO_PERMISO_DENEGADO"])
        exponer("boton-buscar", en: app)
        elemento("boton-buscar").tap()
        let continuar = elemento("boton-permiso-continuar")
        XCTAssertTrue(continuar.waitForExistence(timeout: 10))
        continuar.tap()
        XCTAssertTrue(continuar.waitForNonExistence(timeout: 10), "La hoja del permiso no se cerró")
        // Arriba están el texto del permiso y «Abrir Ajustes»; se vuelve allí antes de esperarlos (creación diferida).
        exponer("aviso-transporte-sintetico", en: app)
        esperarEtiqueta("Sin permiso de Bluetooth. Actívalo en Ajustes, en TransMiVoz.")
        XCTAssertTrue(elemento("boton-abrir-ajustes").waitForExistence(timeout: 10))
        comprobarEnteros(["estado-bluetooth", "boton-abrir-ajustes"], en: app, tocables: true)
        try auditar(app, "accesorio-permiso-denegado-arriba", testCase: self)
        // Sin accesorio elegido los dos botones siguen inhabilitados (se colocan a la vista antes de leerlos).
        exponer("titulo-estado-accesorio", en: app)
        for id in ["boton-sesion-accesorio", "boton-reconectar"] {
            XCTAssertTrue(elemento(id).exists, "«\(id)» debe existir")
            XCTAssertFalse(elemento(id).isEnabled)
        }
        exponerAlFinal(visibles: ["estado-accesorio", "estado-audio"], en: app)
        try auditar(app, "accesorio-permiso-denegado-abajo", testCase: self)
    }

    func testAuditoriaAccesibilidadHojaDelPermisoDeBluetooth() throws {
        lanzar()
        exponer("boton-buscar", en: app)
        elemento("boton-buscar").tap()
        XCTAssertTrue(elemento("boton-permiso-continuar").waitForExistence(timeout: 10))
        try auditar(app, "accesorio-hoja-permiso", testCase: self)
    }
}

/// La pantalla real del accesorio con el texto más grande de Dynamic Type de accesibilidad, sección por sección.
final class TransMiVozAccesorioTextoGrandeUITests: XCTestCase {
    /// La hoja de explicación del permiso (la que sale antes del aviso del sistema) con el texto más grande.
    func testAuditoriaHojaDelPermisoConTextoMuyGrande() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments += [
            "-PRUEBAS_UI_ACCESORIO_SINTETICO",
            "-AppleLanguages", "(es)", "-AppleLocale", "es_CO",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL",
        ]
        app.launch()
        addTeardownBlock { app.terminate() }
        func elemento(_ id: String) -> XCUIElement { app.descendants(matching: .any).matching(identifier: id).firstMatch }

        exponer("boton-buscar", en: app)
        elemento("boton-buscar").tap()
        XCTAssertTrue(elemento("texto-permiso-bluetooth").waitForExistence(timeout: 10), "Falta la explicación previa al permiso")
        XCTAssertTrue(elemento("boton-permiso-continuar").exists)
        try auditar(app, "texto-muy-grande-Accesorio-hoja-permiso", testCase: self)
    }

    func testAuditoriaConTextoMuyGrande() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments += [
            "-PRUEBAS_UI_ACCESORIO_SINTETICO", "-PRUEBAS_UI_ACCESORIO_PERMISO_CONCEDIDO",
            "-AppleLanguages", "(es)", "-AppleLocale", "es_CO",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL",
        ]
        app.launch()
        addTeardownBlock { app.terminate() }
        func elemento(_ id: String) -> XCUIElement { app.descendants(matching: .any).matching(identifier: id).firstMatch }

        // La pantalla crea sus elementos al acercarse: se espera el primer aviso visible y se coloca después lo lejano.
        XCTAssertTrue(elemento("aviso-transporte-sintetico").waitForExistence(timeout: 10))
        exponer("aviso-transporte-sintetico", en: app)
        XCTAssertTrue(elemento("aviso-accesorio-real").waitForExistence(timeout: 10), "el aviso del sensor real debe empezar a la vista")
        try auditar(app, "texto-muy-grande-Accesorio-avisos-iniciales", testCase: self)
        for (id, contexto, completo) in [("aviso-seguridad-enlace", "bloqueo", false), ("boton-buscar", "busqueda", true)] {
            exponer(id, en: app, completo: completo)
            try auditar(app, "texto-muy-grande-Accesorio-\(contexto)", testCase: self)
        }

        elemento("boton-buscar").tap()
        let elegir = elemento("elegir-SINTETICO-0001")
        XCTAssertTrue(elegir.waitForExistence(timeout: 10))
        exponer("elegir-SINTETICO-0001", en: app)
        try auditar(app, "texto-muy-grande-Accesorio-hallazgo", testCase: self)
        elegir.tap()

        exponer("boton-sesion-accesorio", en: app)
        let sesion = elemento("boton-sesion-accesorio")
        sesion.tap()
        // El botón está a la vista: su rótulo es la señal. El título del bloqueo puede no existir aún: se coloca antes.
        esperar(sesion, "label == %@", "Detener sesión", "La sesión no arrancó")
        exponer("titulo-estado-accesorio", en: app)
        let bloqueado = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Bloqueado: enlace no verificado")).firstMatch
        XCTAssertTrue(bloqueado.waitForExistence(timeout: 10), "No apareció el bloqueo")
        for (id, contexto, completo) in [
            ("boton-sesion-accesorio", "controles", true), ("titulo-estado-accesorio", "estado", true),
            ("estado-accesorio", "descripcion", false), ("estado-audio", "audio", false),
            ("interruptor-voz-app", "voz", true),
        ] {
            exponer(id, en: app, completo: completo)
            try auditar(app, "texto-muy-grande-Accesorio-\(contexto)", testCase: self)
        }
    }

    /// Permiso denegado con el texto más grande: el texto del permiso y «Abrir Ajustes» se llevan a la vista de verdad
    /// (enteros y tocables entre las barras) y solo entonces se audita, con todos los tipos y sin filtros.
    func testAuditoriaPermisoDenegadoConTextoMuyGrande() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments += [
            "-PRUEBAS_UI_ACCESORIO_SINTETICO", "-PRUEBAS_UI_ACCESORIO_PERMISO_DENEGADO",
            "-AppleLanguages", "(es)", "-AppleLocale", "es_CO",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryAccessibilityXXXL",
        ]
        app.launch()
        addTeardownBlock { app.terminate() }
        func elemento(_ id: String) -> XCUIElement { app.descendants(matching: .any).matching(identifier: id).firstMatch }

        XCTAssertTrue(elemento("aviso-transporte-sintetico").waitForExistence(timeout: 10))
        exponer("boton-buscar", en: app)
        elemento("boton-buscar").tap()
        // La hoja del permiso es la de siempre; su botón se toca con el desplazamiento propio de XCTest.
        let continuar = elemento("boton-permiso-continuar")
        XCTAssertTrue(continuar.waitForExistence(timeout: 10), "Falta la explicación previa al permiso")
        continuar.tap()
        XCTAssertTrue(continuar.waitForNonExistence(timeout: 10), "La hoja del permiso no se cerró")

        // El texto ya existe (se pasó por él al buscar); «Abrir Ajustes» se crea al acercarse a la vista. Centrar el
        // texto sacaría el botón de la vista (a este tamaño miden ~380 y ~160 pt): se sube el texto al borde superior.
        exponer("estado-bluetooth", en: app)
        let arriba = app.navigationBars.firstMatch.frame.maxY
        arrastrarContenido(elemento("estado-bluetooth").frame.minY - (arriba + 40), en: app,
            arriba: arriba, abajo: app.scrollViews.firstMatch.frame.maxY)
        let denegado = app.descendants(matching: .any).matching(NSPredicate(
            format: "label == %@", "Sin permiso de Bluetooth. Actívalo en Ajustes, en TransMiVoz.")).firstMatch
        XCTAssertTrue(denegado.waitForExistence(timeout: 10), "No apareció el texto de permiso denegado")
        XCTAssertTrue(elemento("boton-abrir-ajustes").waitForExistence(timeout: 10), "Falta «Abrir Ajustes»")
        comprobarEnteros(["estado-bluetooth", "boton-abrir-ajustes"], en: app, tocables: true)
        try auditar(app, "texto-muy-grande-Accesorio-permiso-denegado", testCase: self)
    }
}
