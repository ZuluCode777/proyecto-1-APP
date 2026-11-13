import XCTest

// Recorridos de DEMOSTRACIÓN para grabar el Simulator. No son pruebas: no auditan ni cubren casos, solo manejan la app
// a ritmo de persona y anotan qué se hace y qué aparece en pantalla, para los subtítulos del video.
//
// No forma parte de la suite del repositorio: `demo/ios/grabar.sh` copia este archivo a `ios/TransMiVozUITests/` en el
// runner, justo antes de compilar (el grupo sincronizado del proyecto lo incluye solo), y graba cada recorrido con
// `xcrun simctl io … recordVideo`.
//
// Variables (el script las pasa con el prefijo TEST_RUNNER_):
//   DEMO_EVENTOS  archivo donde se anotan los subtítulos (una línea JSON por evento, con la hora de reloj)
//   DEMO_ORIGEN   origen HTTPS del backend Next.js arrancado en el runner (por defecto https://localhost:8443)
//   DEMO_CLAVE    clave de ese backend (APP_PASSWORD)
//   DEMO_CATEGORIA_TEXTO  tamaño de letra de la app (por defecto, el 2.º tamaño de accesibilidad); el script pone el
//                 mismo en todo el Simulator, junto con el contraste aumentado, como lo tendría una persona con baja visión

private let entorno = ProcessInfo.processInfo.environment
private let origenServidor = entorno["DEMO_ORIGEN"] ?? "https://localhost:8443"
private let claveServidor = entorno["DEMO_CLAVE"] ?? ""
private let categoriaTexto = entorno["DEMO_CATEGORIA_TEXTO"] ?? "UICTContentSizeCategoryAccessibilityL"

final class DemoVideosUITests: XCTestCase {
    private var app: XCUIApplication!

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    // MARK: Subtítulos

    /// Una línea por evento: `{"epoch": …, "tipo": …, "texto": …}`. También va al registro de xcodebuild, por si el
    /// archivo no se puede escribir desde el Simulator.
    private func anotar(_ tipo: String, _ texto: String = "") {
        let evento: [String: Any] = ["epoch": Date().timeIntervalSince1970, "tipo": tipo, "texto": texto]
        guard let datos = try? JSONSerialization.data(withJSONObject: evento),
              let linea = String(data: datos, encoding: .utf8) else { return }
        print("DEMO_EVENTO \(linea)")
        guard let ruta = entorno["DEMO_EVENTOS"], !ruta.isEmpty else { return }
        let url = URL(fileURLWithPath: ruta)
        if !FileManager.default.fileExists(atPath: ruta) {
            FileManager.default.createFile(atPath: ruta, contents: nil)
        }
        if let archivo = try? FileHandle(forWritingTo: url) {
            archivo.seekToEndOfFile()
            archivo.write(Data((linea + "\n").utf8))
            try? archivo.close()
        }
    }

    private func accion(_ texto: String) { anotar("accion", texto) }
    private func nota(_ texto: String) { anotar("nota", texto) }
    private func pantalla(_ texto: String) { anotar("pantalla", texto) }

    private func pausa(_ segundos: TimeInterval) { Thread.sleep(forTimeInterval: segundos) }

    // MARK: Ayudas

    private func lanzar(_ argumentos: [String], titulo: String) {
        anotar("titulo", titulo)
        app = XCUIApplication()
        app.launchArguments += argumentos + [
            "-AppleLanguages", "(es)", "-AppleLocale", "es_CO", "-UIPreferredContentSizeCategoryName", categoriaTexto,
        ]
        app.launch()
        addTeardownBlock { [app] in app?.terminate() }
        XCTAssertTrue(app.tabBars.firstMatch.waitForExistence(timeout: 30), "La app no mostró sus pestañas")
        pausa(1.2)
        anotar("inicio")
    }

    private func terminar() {
        pausa(2.0)
        anotar("fin")
    }

    private func elemento(_ identificador: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identificador).firstMatch
    }

    private func etiquetado(_ texto: String) -> XCUIElement {
        app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", texto)).firstMatch
    }

    private func esperar(_ elemento: XCUIElement, _ predicado: String, _ valor: Any, _ mensaje: String, timeout: TimeInterval = 15) {
        let espera = XCTNSPredicateExpectation(predicate: NSPredicate(format: predicado, argumentArray: [valor]), object: elemento)
        XCTAssertEqual(XCTWaiter().wait(for: [espera], timeout: timeout), .completed, mensaje)
    }

    private func tocar(_ el: XCUIElement, _ descripcion: String) {
        XCTAssertTrue(el.waitForExistence(timeout: 15), "No apareció: \(descripcion)")
        accion(descripcion)
        pausa(0.7)
        el.tap()
        pausa(0.8)
    }

    private func abrirPestana(_ nombre: String, esperarSeleccion: Bool = true) {
        let pestana = app.tabBars.buttons[nombre]
        XCTAssertTrue(pestana.waitForExistence(timeout: 15), "No existe la pestaña \(nombre)")
        if pestana.isSelected { return }
        tocar(pestana, "Toca la pestaña «\(nombre)»")
        if esperarSeleccion { esperar(pestana, "isSelected == %@", true, "No se seleccionó la pestaña \(nombre)") }
    }

    /// Toca el campo (fuera de su barra interna, como las pruebas de interfaz), escribe y espera a ver el texto completo.
    private func escribir(_ texto: String, en campo: XCUIElement, descripcion: String? = nil, comprobar: Bool = true) {
        XCTAssertTrue(campo.waitForExistence(timeout: 15), "No apareció el campo")
        esperar(campo, "isHittable == %@", true, "El campo no es tocable")
        accion(descripcion ?? "Escribe: «\(texto)»")
        // La consulta conserva la pregunta anterior: se toca al final del campo y se borra antes de escribir.
        let previo = (campo.value as? String) ?? ""
        let hayTexto = comprobar && !previo.isEmpty && previo != campo.placeholderValue
        campo.coordinate(withNormalizedOffset: CGVector(dx: hayTexto ? 0.96 : 0.5, dy: 0.2)).tap()
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 10), "El teclado no apareció")
        if hayTexto {
            campo.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: previo.count + 3))
            pausa(0.4)
        }
        campo.typeText(texto)
        if comprobar { esperar(campo, "value == %@", texto, "El campo no muestra «\(texto)»") }
        pausa(0.6)
    }

    /// Con letra grande, lo que va debajo del campo (Enviar, el siguiente campo) queda bajo el teclado: se cierra
    /// arrastrando hacia abajo a través del teclado (las pantallas usan `scrollDismissesKeyboard(.interactively)`).
    private func cerrarTeclado() {
        let teclado = app.keyboards.firstMatch
        guard teclado.exists else { return }
        let ventana = app.windows.firstMatch
        let desde = ventana.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.32))
        let hasta = ventana.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.97))
        desde.press(forDuration: 0.1, thenDragTo: hasta, withVelocity: .slow, thenHoldForDuration: 0.2)
        _ = teclado.waitForNonExistence(timeout: 4)
        pausa(0.4)
    }

    /// Arrastra el contenido `desplazamiento` puntos (positivo: hacia abajo de la pantalla), sin inercia.
    private func arrastrar(_ desplazamiento: CGFloat) {
        let ventana = app.windows.firstMatch.frame
        let contenido = app.scrollViews.firstMatch.frame
        let arriba = max(app.navigationBars.firstMatch.frame.maxY, contenido.minY)
        let abajo = min(app.tabBars.firstMatch.frame.minY, contenido.maxY)
        let inicio = app.windows.firstMatch.coordinate(withNormalizedOffset: .zero)
            .withOffset(CGVector(dx: ventana.width / 2, dy: desplazamiento > 0 ? abajo - 30 : arriba + 30))
        inicio.press(forDuration: 0.1, thenDragTo: inicio.withOffset(CGVector(dx: 0, dy: -desplazamiento)),
                     withVelocity: .slow, thenHoldForDuration: 0.4)
        pausa(0.5)
    }

    /// Desplaza hasta que el elemento quede entero entre la barra de navegación y la de pestañas. Con `comienzo`,
    /// basta que su comienzo quede arriba a la vista: un texto largo con letra grande mide más que la pantalla.
    private func mostrar(_ identificador: String, haciaAtras: Bool = false, comienzo: Bool = false) {
        let objetivo = elemento(identificador)
        for _ in 0..<6 {
            let contenido = app.scrollViews.firstMatch.frame
            let arriba = max(app.navigationBars.firstMatch.frame.maxY, contenido.minY)
            let abajo = min(app.tabBars.firstMatch.frame.minY, contenido.maxY)
            let paso = abajo - arriba - 60
            if objetivo.exists {
                let marco = objetivo.frame
                if comienzo {
                    if marco.minY >= arriba, marco.minY <= arriba + 200 { return }
                } else if marco.minY >= arriba, marco.maxY <= abajo, objetivo.isHittable {
                    return
                }
                let deseado = comienzo ? marco.minY - (arriba + 40) : marco.midY - (arriba + abajo) / 2
                if abs(deseado) < 20 { return }
                arrastrar(max(-paso, min(paso, deseado)))
            } else {
                arrastrar(haciaAtras ? -paso : paso)
            }
        }
    }

    // MARK: Consulta con el backend real

    /// Si el servidor no está configurado (primera vez en este Simulator), lo configura en Ajustes, a la vista.
    private func asegurarServidor() {
        abrirPestana("Ajustes")
        let resumen = elemento("resumen-ajustes")
        XCTAssertTrue(resumen.waitForExistence(timeout: 15))
        if resumen.label.contains(origenServidor.replacingOccurrences(of: "https://", with: "")), resumen.label.contains("con clave") {
            pantalla(resumen.label)
            pausa(2.0)
            return
        }
        nota("La app pide un servidor HTTPS. Aquí es el backend de este repositorio, arrancado en el mismo Mac.")
        mostrar("campo-origen")
        escribir(origenServidor, en: elemento("campo-origen"), descripcion: "Escribe la dirección del servidor")
        cerrarTeclado()
        mostrar("campo-clave")
        escribir(claveServidor, en: elemento("campo-clave"), descripcion: "Escribe la clave de acceso", comprobar: false)
        app.typeText("\n")
        if !app.keyboards.firstMatch.waitForNonExistence(timeout: 4) { cerrarTeclado() }
        let recordar = elemento("interruptor-recordar")
        mostrar("interruptor-recordar")
        accion("Activa «Recordar la clave en el Llavero»")
        pausa(0.6)
        // Con letra grande el interruptor puede ir debajo de su texto: se toca el control de dentro si lo hay.
        let control = recordar.switches.firstMatch
        if control.exists { control.tap() } else { recordar.coordinate(withNormalizedOffset: CGVector(dx: 0.93, dy: 0.5)).tap() }
        pausa(0.8)
        mostrar("boton-aplicar")
        tocar(elemento("boton-aplicar"), "Toca «Aplicar»")
        let mensaje = elemento("mensaje-ajustes")
        XCTAssertTrue(mensaje.waitForExistence(timeout: 10), "No apareció el mensaje de Ajustes")
        mostrar("resumen-ajustes", haciaAtras: true)
        pantalla(mensaje.label)
        pausa(3.0)
    }

    /// Escribe la pregunta, la envía y anota lo que responde el servidor.
    private func preguntar(_ texto: String) {
        abrirPestana("Consulta")
        let campo = elemento("campo-pregunta")
        mostrar("campo-pregunta")
        escribir(texto, en: campo)
        cerrarTeclado()
        mostrar("boton-enviar")
        tocar(elemento("boton-enviar"), "Toca «Enviar»")
        _ = app.keyboards.firstMatch.waitForNonExistence(timeout: 5)
        let respuesta = elemento("texto-respuesta")
        let viaje = elemento("aviso-viaje")
        let error = elemento("mensaje-error")
        let limite = Date().addingTimeInterval(25)
        while Date() < limite, !respuesta.exists, !viaje.exists, !error.exists { pausa(0.3) }
        // Una respuesta anterior puede seguir en pantalla un instante: se espera a que acabe «Consultando…».
        _ = elemento("progreso-consulta").waitForNonExistence(timeout: 20)
        pausa(0.5)
        if error.exists {
            pantalla("No se pudo completar: \(error.label)")
        } else if viaje.exists {
            pantalla(viaje.label)
        } else if respuesta.exists {
            var partes = [respuesta.label]
            let limiteAccion = elemento("limite-accion")
            if limiteAccion.exists { partes.append(limiteAccion.label) }
            pantalla(partes.joined(separator: " "))
        }
        XCTAssertTrue(respuesta.exists || viaje.exists || error.exists, "No llegó ninguna respuesta a «\(texto)»")
        // El resultado va encima del campo: se sube a su comienzo y se recorre, que con letra grande mide varias pantallas.
        mostrar(viaje.exists ? "aviso-viaje" : (error.exists ? "mensaje-error" : "texto-respuesta"), haciaAtras: true, comienzo: true)
        pausa(3.5)
        arrastrar(380)
        pausa(2.5)
        arrastrar(380)
        pausa(2.5)
    }

    // MARK: Recorridos

    func testDemo01ConsultaServidorReal() throws {
        lanzar([], titulo: "Consulta: rutas, horarios y viajes con el servidor real")
        nota("App de depuración sin modos de prueba: las respuestas vienen del backend Next.js con datos reales.")
        pausa(2.5)
        asegurarServidor()
        preguntar("recorrido de la B23")
        preguntar("horario de la H54")
        nota("Sin paradas verificadas, el servidor no da órdenes de abordaje.")
        preguntar("quiero ir de Ricaurte a Calle 72")
        terminar()
    }

    func testDemo02MetroFuturo() throws {
        lanzar([], titulo: "Consulta: escenario Metro (futuro)")
        asegurarServidor()
        abrirPestana("Consulta")
        let escenario = elemento("boton-escenario")
        tocar(escenario, "Toca «Metro (futuro)»")
        esperar(escenario, "value == %@", "activado", "No se activó el escenario Metro")
        pantalla(elemento("introduccion-consulta").label)
        pausa(3.0)
        preguntar("estaciones")
        preguntar("Puente Aranda")
        tocar(escenario, "Toca «Metro (futuro)» para volver al transporte de hoy")
        esperar(escenario, "value == %@", "desactivado", "No se desactivó el escenario Metro")
        pantalla(elemento("introduccion-consulta").label)
        terminar()
    }

    func testDemo03SesionConAccesorio() throws {
        lanzar(["-PRUEBAS_UI_ACCESORIO_SINTETICO"], titulo: "Sesión con el accesorio (transporte sintético)")
        abrirPestana("Sesión")
        nota("El Simulator no tiene Bluetooth: la pantalla real del accesorio se maneja con un transporte sintético rotulado.")
        let aviso = elemento("aviso-transporte-sintetico")
        XCTAssertTrue(aviso.waitForExistence(timeout: 15))
        pantalla(aviso.label)
        pausa(4.0)
        arrastrar(300)
        pausa(2.0)
        mostrar("boton-buscar", haciaAtras: true)
        tocar(elemento("boton-buscar"), "Toca «Buscar accesorios»")
        let continuar = elemento("boton-permiso-continuar")
        if continuar.waitForExistence(timeout: 8) {
            if elemento("texto-permiso-bluetooth").exists { pantalla(elemento("texto-permiso-bluetooth").label) }
            pausa(3.5)
            tocar(continuar, "Toca «Continuar»")
            _ = continuar.waitForNonExistence(timeout: 10)
        }
        let elegir = elemento("elegir-SINTETICO-0001")
        XCTAssertTrue(elegir.waitForExistence(timeout: 15), "No apareció el accesorio sintético")
        mostrar("elegir-SINTETICO-0001")
        tocar(elegir, "Elige «Accesorio sintético (0001)»")
        mostrar("boton-sesion-accesorio")
        let boton = elemento("boton-sesion-accesorio")
        tocar(boton, "Toca «Iniciar sesión»")
        esperar(boton, "label == %@", "Detener sesión", "La sesión no arrancó")
        mostrar("titulo-estado-accesorio")
        XCTAssertTrue(etiquetado("Bloqueado: enlace no verificado").waitForExistence(timeout: 15))
        let estado = ["titulo-estado-accesorio", "estado-accesorio", "estado-accesorio-1", "estado-accesorio-2"]
            .map { elemento($0) }.filter { $0.exists }.map { $0.label }
        pantalla(estado.joined(separator: " "))
        nota("Con el transporte sintético el enlace no se verifica, así que la app bloquea los avisos y no usa ninguna medida.")
        pausa(6.0)
        arrastrar(300)
        pausa(2.5)
        mostrar("boton-sesion-accesorio", haciaAtras: true)
        tocar(boton, "Toca «Detener sesión»")
        XCTAssertTrue(etiquetado("Detenido").waitForExistence(timeout: 15))
        pantalla("Detenido")
        pausa(2.0)
        mostrar("boton-reconectar")
        tocar(elemento("boton-reconectar"), "Toca «Reconectar»")
        XCTAssertTrue(etiquetado("Bloqueado: enlace no verificado").waitForExistence(timeout: 15))
        pantalla("Bloqueado: enlace no verificado")
        pausa(3.0)
        terminar()
    }

    func testDemo04Lupa() throws {
        lanzar(["-PRUEBAS_UI_SIMULADAS"], titulo: "Lupa: permiso, aumento, filtros y congelar")
        nota("El Simulator no tiene cámara: la lupa usa una imagen sintética rotulada y los filtros no la cambian.")
        let pestana = app.tabBars.buttons["Lupa"]
        tocar(pestana, "Toca la pestaña «Lupa»")
        let explicacion = elemento("texto-permiso-camara")
        if explicacion.waitForExistence(timeout: 10) {
            pantalla(explicacion.label)
            pausa(4.0)
            tocar(elemento("boton-permiso-camara-continuar"), "Toca «Continuar»")
            _ = elemento("boton-permiso-camara-continuar").waitForNonExistence(timeout: 10)
        }
        let visor = elemento("visor-lupa")
        XCTAssertTrue(visor.waitForExistence(timeout: 15))
        esperar(visor, "value == %@", "Imagen en vivo", "La lupa no quedó activa")
        if elemento("aviso-camara-sintetica").exists { pantalla(elemento("aviso-camara-sintetica").label) }
        pausa(3.0)
        mostrar("control-aumento")
        let aumento = elemento("control-aumento")
        accion("Sube el aumento")
        for posicion in [0.3, 0.6, 1.0] {
            aumento.adjust(toNormalizedSliderPosition: posicion)
            pausa(1.2)
        }
        if let valor = aumento.value as? String { pantalla("Aumento: \(valor)") }
        pausa(1.5)
        mostrar("filtro-invertir")
        for (id, nombre) in [("filtro-fluorescente", "Fluorescente"), ("filtro-blancoYNegro", "Blanco y negro"),
                             ("filtro-invertir", "Invertir"), ("filtro-contraste", "Alto contraste")] {
            let filtro = elemento(id)
            if filtro.exists {
                tocar(filtro, "Toca el filtro «\(nombre)»")
                pausa(1.2)
            }
        }
        mostrar("boton-congelar")
        let congelar = elemento("boton-congelar")
        tocar(congelar, "Toca «Congelar imagen»")
        esperar(congelar, "label == %@", "Reanudar", "No se congeló la imagen")
        pantalla(visor.value as? String ?? "Imagen congelada")
        pausa(2.5)
        tocar(congelar, "Toca «Reanudar»")
        esperar(congelar, "label == %@", "Congelar imagen", "No se reanudó la imagen")
        pausa(2.0)
        terminar()
    }

    func testDemo05Ajustes() throws {
        lanzar([], titulo: "Ajustes: servidor, preferencias, favoritas y ayuda")
        asegurarServidor()
        for seccion in ["Preferencias", "Favoritas", "Ayuda"] {
            tocar(elemento("menu-mas-ajustes"), "Toca «Más ajustes»")
            tocar(etiquetado(seccion), "Elige «\(seccion)»")
            pausa(1.5)
            switch seccion {
            case "Favoritas":
                let vacio = elemento("favoritas-vacio")
                if vacio.waitForExistence(timeout: 5) { pantalla(vacio.label) }
            case "Ayuda":
                if elemento("ayuda-titulo-0").waitForExistence(timeout: 5) { pantalla(elemento("ayuda-titulo-0").label) }
                pausa(2.0)
                arrastrar(350)
                pausa(2.0)
                arrastrar(350)
            default:
                nota("La voz propia de los avisos del accesorio; es el mismo interruptor de la pestaña Sesión.")
            }
            pausa(3.5)
            let atras = app.navigationBars.buttons.element(boundBy: 0)
            tocar(atras, "Vuelve a Ajustes")
            pausa(1.0)
        }
        terminar()
    }
}
