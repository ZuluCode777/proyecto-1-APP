import XCTest

/// Lo que devuelve una auditoría completa: los problemas y, si se pidió, lo observado justo antes y justo después del
/// grupo de contraste (la única medición cuyo marco se usa para acreditar nodos limpios).
private struct ResultadoAuditoria {
    var hallazgos: [HallazgoAuditoria] = []
    var antesDelContraste: ObservacionContraste?
    var despuesDelContraste: ObservacionContraste?
}

/// Ejecuta TODOS los grupos de la auditoría nativa (todos los tipos, sin filtros ni exclusiones) y devuelve cada
/// problema COMO VALOR, copiado dentro del manejador: más tarde la jerarquía ya es otra y no se vuelve a leer
/// `problema.element`. El manejador devuelve `true` solo para seguir reuniendo; quien llama decide qué es un fallo.
/// `observar` (opcional) se llama antes y después del grupo de contraste, que va PRIMERO: así lo que se acredita como
/// medido limpio es lo que había en pantalla mientras se medía el contraste, no lo que quede tras los grupos que cambian fuentes.
private func ejecutarAuditoria(_ app: XCUIApplication, _ contexto: String, observar: (() throws -> ObservacionContraste)? = nil) throws -> ResultadoAuditoria {
    var resultado = ResultadoAuditoria()
    // Cuatro grupos que juntos son `.all`. Cada petición nativa tiene un límite de ~25 s y con el texto más grande de la
    // pantalla del accesorio el grupo único «todo salvo Dynamic Type y texto recortado» lo agotó (código 56): el contraste
    // va aparte. Dynamic Type y texto recortado siguen aislados porque cambian fuentes. Un tiempo agotado sigue siendo un fallo.
    let auditorias: [XCUIAccessibilityAuditType] = [
        .contrast, .all.subtracting([.contrast, .dynamicType, .textClipped]), .dynamicType, .textClipped,
    ]
    for tipos in auditorias {
        let esContraste = tipos == .contrast
        if esContraste { resultado.antesDelContraste = try observar?() }
        try XCTContext.runActivity(named: "Auditoría \(contexto): \(tipos)") { _ in
            try app.performAccessibilityAudit(for: tipos) { problema in
                let elemento = problema.element
                resultado.hallazgos.append(HallazgoAuditoria(
                    tipo: "\(problema.auditType)", esContraste: problema.auditType == .contrast,
                    compacta: problema.compactDescription, detallada: problema.detailedDescription,
                    identificador: elemento?.identifier, etiqueta: elemento?.label, marco: elemento?.frame))
                return true
            }
        }
        if esContraste { resultado.despuesDelContraste = try observar?() }
    }
    return resultado
}

/// Auditoría real de accesibilidad de todos los tipos. Reúne TODOS los
/// problemas y los adjunta como texto + captura antes de fallar, para que el resultado
/// diga qué elemento falló (en Xcode, sin handler, solo se ve el primero y sin elemento).
/// No ignora nada: si hay un problema, la prueba falla. Es el comportamiento de siempre; solo las auditorías de la
/// pantalla del accesorio que lo piden usan además `FaseAuditada` (contraste recortado diferido, con remedición obligatoria).
private func auditar(_ app: XCUIApplication, _ contexto: String, testCase: XCTestCase, file: StaticString = #filePath, line: UInt = #line) throws {
    let problemas = try ejecutarAuditoria(app, contexto).hallazgos.map(\.descripcion)
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

/// Fase estable de la pantalla del accesorio (mismo estado y mismas etiquetas) con libro de contraste diferido. Solo la
/// piden las auditorías de desplazamiento de esa pantalla; las demás siguen con `auditar`, que falla en el acto.
/// Con la pila ansiosa, un nodo recortado bajo el área desplazable también llega a la auditoría nativa de contraste.
/// Cada hallazgo lo clasifica `ClasificadorContraste` (ver `LibroContrasteDiferido.swift`): solo el contraste de un nodo
/// único de la zona desplazable, recortado y que cabría entero en la vista se DIFIERE, y esa deuda obliga a medir el
/// mismo nodo entero a la vista, con la auditoría completa, dentro de esta fase. Todo lo demás es fallo. Los fallos se
/// acumulan hasta `cerrar` para que las fases siguientes también se ejecuten en esta pasada; las comprobaciones de
/// geometría (`exponer`, `comprobarEnteros`) siguen siendo estrictas y abortan la prueba. Hay que cerrar CADA fase antes
/// de cambiar de estado: una deuda sin cerrar no se puede saldar con la medición de otro estado.
private final class FaseAuditada {
    private let app: XCUIApplication
    private let caso: XCTestCase
    /// Velocidad nativa de los gestos de las exposiciones de esta fase (`.default` salvo en las de `AccessibilityXXXL`).
    private let velocidad: XCUIGestureVelocity
    private(set) var libro: LibroContraste
    /// Todo lo que la auditoría nativa reportó en esta fase, tal cual.
    private(set) var hallazgos: [HallazgoAuditoria] = []

    init(_ fase: String, app: XCUIApplication, caso: XCTestCase, velocidad: XCUIGestureVelocity = .default) {
        self.app = app
        self.caso = caso
        self.velocidad = velocidad
        libro = LibroContraste(fase: fase)
    }

    /// Zona realmente visible de la instantánea actual: la que dejan las barras y el área desplazable, sin inferir nada más.
    private func observar() throws -> ObservacionContraste {
        let contenido = app.scrollViews.firstMatch.frame
        let zona = try nodos(de: app.scrollViews.firstMatch)
        let aplicacion = try nodos(de: app)
        let vista = VistaAuditada(
            arriba: max(app.navigationBars.firstMatch.frame.maxY, contenido.minY),
            abajo: min(app.tabBars.firstMatch.frame.minY, contenido.maxY))
        return ObservacionContraste(vista: vista, zona: zona, aplicacion: aplicacion)
    }

    /// Una auditoría completa en la posición actual: la clasifica y anota qué nodos midió limpios y enteros a la vista.
    /// La clasificación y el crédito de nodos limpios usan lo observado alrededor del grupo de contraste; si la maquetación
    /// cambió entre las dos observaciones, la fase falla y no se acredita nada de esa auditoría.
    func auditar(_ contexto: String) throws {
        let resultado = try ejecutarAuditoria(app, contexto, observar: observar)
        hallazgos += resultado.hallazgos
        guard let antes = resultado.antesDelContraste, let despues = resultado.despuesDelContraste else {
            XCTFail("La auditoría «\(contexto)» no obtuvo las observaciones del contraste")
            return
        }
        if let motivo = ObservacionContraste.deriva(antes: antes, despues: despues) {
            libro.registrarDeriva(contexto: contexto, motivo: motivo, nodos: despues.zona.count)
            adjuntar("auditoria-\(libro.fase)-\(contexto)-problemas",
                "Deriva de maquetación: \(motivo)\n" + resultado.hallazgos.map(\.descripcion).joined(separator: "\n"))
            return
        }
        let lineas = libro.registrar(
            contexto: contexto, hallazgos: resultado.hallazgos, zona: despues.zona, aplicacion: despues.aplicacion, vista: despues.vista)
        adjuntar("auditoria-\(libro.fase)-\(contexto)-problemas",
            "Zona visible: \(despues.vista.arriba)…\(despues.vista.abajo)\n" + (lineas.isEmpty ? "Sin problemas." : lineas.joined(separator: "\n")))
    }

    /// Nodos de la jerarquía nativa (instantánea) bajo `elemento`, él incluido.
    private func nodos(de elemento: XCUIElement) throws -> [NodoJerarquia] {
        func recorrer(_ nodo: XCUIElementSnapshot) -> [NodoJerarquia] {
            [NodoJerarquia(identificador: nodo.identifier, etiqueta: nodo.label, marco: nodo.frame)]
                + nodo.children.flatMap(recorrer)
        }
        return recorrer(try elemento.snapshot())
    }

    private func adjuntar(_ nombre: String, _ texto: String) {
        let adjunto = XCTAttachment(string: texto)
        adjunto.name = nombre
        adjunto.lifetime = .keepAlways
        caso.add(adjunto)
    }

    /// Un nodo diferido puede estar muy lejos de donde quedó la vista (con el texto más grande, a más de cuatro pasos de
    /// `exponer`). Antes de exponerlo se pasa por nodos únicos con identificador que están en el camino, en el orden de la
    /// maquetación (`PlanRecorrido`), cada tramo dentro del tope de cuatro gestos de `exponer`. `exponer(completo: false)`
    /// deja el comienzo de la escala en cualquier punto de la vista, no en `arriba + 40` como supone el plan: por eso tras
    /// CADA escala se toma una instantánea nueva y se vuelve a planear desde donde quedó la vista de verdad, sin repetir
    /// escalas. No cambia ninguna guarda: el `exponer` final del destino sigue exigiéndolo entero y tocable.
    private func acercar(_ identificador: String, file: StaticString, line: UInt) throws {
        var recorridas: [String] = []
        while true {
            let contenido = app.scrollViews.firstMatch.frame
            let arriba = max(app.navigationBars.firstMatch.frame.maxY, contenido.minY)
            let abajo = min(app.tabBars.firstMatch.frame.minY, contenido.maxY)
            // El alcance lo fija `PlanRecorrido.alcance`: tres pasos de `exponer`, y el cuarto gesto del tope queda para corregir.
            let escalas = PlanRecorrido.escalas(
                destino: identificador, zona: try nodos(de: app.scrollViews.firstMatch), aplicacion: try nodos(de: app),
                arriba: arriba, abajo: abajo, alcance: PlanRecorrido.alcance(arriba: arriba, abajo: abajo), excluir: Set(recorridas))
            guard let siguiente = escalas.first else { break }
            recorridas.append(siguiente)
            exponer(siguiente, en: app, completo: false, velocidad: velocidad, file: file, line: line)
        }
        adjuntar("auditoria-\(libro.fase)-ruta-\(identificador)", recorridas.isEmpty ? "Directo." : recorridas.joined(separator: "\n"))
    }

    /// Remedición obligatoria: cada deuda se lleva entera a la vista (`exponer`) y se vuelve a auditar con todos los grupos.
    /// El trabajo está acotado por los nodos que la fase llegó a tener (cada vuelta salda o da por fallida una deuda); si
    /// quedan deudas, o el objetivo no se deja exponer, la fase falla. Sin reintentos ciegos ni más gestos que `exponer`.
    func cerrarSinFallar(file: StaticString = #filePath, line: UInt = #line) throws {
        var vueltas = 0
        while let clave = libro.pendientes.first {
            guard vueltas < libro.nodosMaximos else {
                for pendiente in libro.pendientes {
                    libro.darPorFallida(pendiente, motivo: "se agotaron las remediciones (una por nodo de la fase: \(libro.nodosMaximos))")
                }
                break
            }
            vueltas += 1
            try acercar(clave.identificador, file: file, line: line)
            exponer(clave.identificador, en: app, velocidad: velocidad, file: file, line: line)
            try auditar("remedicion-\(vueltas)-\(clave.identificador)")
            if libro.pendientes.contains(clave) {
                libro.darPorFallida(clave, motivo: "entero a la vista no quedó medido sin problema")
            }
        }
        adjuntar("auditoria-\(libro.fase)-cobertura", libro.informe())
    }

    /// Cierra la fase y, si hubo algún fallo, lo registra SIN abortar la prueba (las fases siguientes también se ejecutan).
    func cerrar(file: StaticString = #filePath, line: UInt = #line) throws {
        try cerrarSinFallar(file: file, line: line)
        guard !libro.fallos.isEmpty else { return }
        adjuntar("auditoria-\(libro.fase)-jerarquia", app.debugDescription)
        let captura = XCTAttachment(screenshot: app.screenshot())
        captura.name = "auditoria-\(libro.fase)-pantalla"
        captura.lifetime = .keepAlways
        caso.add(captura)
        let previo = caso.continueAfterFailure
        caso.continueAfterFailure = true
        XCTFail("Auditoría de accesibilidad (fase «\(libro.fase)»): \(libro.fallos.count) problema(s):\n" + libro.fallos.joined(separator: "\n"), file: file, line: line)
        caso.continueAfterFailure = previo
    }
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
/// `velocidad` es la velocidad nativa del gesto (`.default` como siempre; la auditoría del accesorio pide `.slow`).
private func arrastrarContenido(_ desplazamiento: CGFloat, en app: XCUIApplication, arriba: CGFloat, abajo: CGFloat, velocidad: XCUIGestureVelocity = .default) {
    let ventana = app.windows.firstMatch.frame
    let inicio = app.windows.firstMatch.coordinate(withNormalizedOffset: .zero)
        .withOffset(CGVector(dx: ventana.width / 2, dy: desplazamiento > 0 ? abajo - 20 : arriba + 20))
    // Mantener el dedo quieto antes de soltar evita añadir inercia al arrastre.
    inicio.press(
        forDuration: 0.1, thenDragTo: inicio.withOffset(CGVector(dx: 0, dy: -desplazamiento)),
        withVelocity: velocidad, thenHoldForDuration: 0.5)
}

/// Adjunta un texto con nombre a la actividad nativa y lo conserva en el `.xcresult`.
private func anotar(_ actividad: XCTActivity, _ nombre: String, _ texto: String) {
    let adjunto = XCTAttachment(string: texto)
    adjunto.name = nombre
    adjunto.lifetime = .keepAlways
    actividad.add(adjunto)
}

private func textoMarco(_ marco: CGRect?) -> String {
    marco.map { "\($0)" } ?? "fuera de la jerarquía visible"
}

/// Busca el elemento y lo centra entre las barras. Máximo cuatro gestos.
/// En la pantalla del accesorio (pilas ansiosas) todo elemento existe siempre y se desplaza por su marco real. La
/// consulta con texto de accesibilidad usa `LazyVStack` (`ContenedorControles`) y allí un objetivo puede no existir
/// aún, así que si no existe se busca desplazando un paso: hacia delante (por defecto, en el orden de lectura) o, con
/// `haciaAtras`, hacia atrás. `haciaAtras` solo cuenta mientras el objetivo no existe; si existe, el desplazamiento sale
/// de su marco, igual en ambos casos. Nunca se da por hecho que un elemento sigue existiendo por haber pasado antes por él.
/// `completo: false` es solo para textos que con `AccessibilityXXXL` miden más que el área visible (un aviso de
/// ~200 caracteres ocupa más de 900 pt): pide que su COMIENZO quede a la vista y tocable por arriba, no entero.
/// Todo lo demás (botones, interruptor, títulos) se sigue exigiendo entero y tocable.
/// `velocidad` se pasa tal cual a cada gesto: solo la remedición de la auditoría del accesorio la baja a `.slow`.
private func exponer(_ identificador: String, en app: XCUIApplication, completo: Bool = true, haciaAtras: Bool = false, velocidad: XCUIGestureVelocity = .default, file: StaticString = #filePath, line: UInt = #line) {
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
    for intento in 1...4 where !visible() {
        // Centrar deja margen a ambos lados para la zona muerta inicial del gesto.
        // Un control de creación diferida (la consulta) aún no existe: no se lee su marco (sería una instantánea fallida),
        // se da un paso en el sentido pedido (el objetivo puede quedar encima o debajo de la vista).
        let desplazamiento: CGFloat
        let existe = objetivo.exists
        let marco: CGRect? = existe ? objetivo.frame : nil
        let ancla: CGFloat?
        if let marco = marco {
            let calculada = completo ? marco.midY - (arriba + abajo) / 2 : marco.minY - (arriba + 40)
            ancla = calculada
            desplazamiento = max(-paso, min(paso, calculada))
        } else {
            ancla = nil
            desplazamiento = haciaAtras ? -paso : paso
        }
        guard velocidad == .slow else {
            arrastrarContenido(desplazamiento, en: app, arriba: arriba, abajo: abajo, velocidad: velocidad)
            continue
        }
        // Por qué: el registro nativo del gesto da sus coordenadas, pero no el marco del objetivo que generó cada solicitud ni
        // dónde quedó después; sin eso un fallo nativo no distingue un objetivo en movimiento, bloqueado o resuelto tarde.
        // Solo se observa (sin esperas, aserciones ni reintentos) y solo en las exposiciones lentas de `AccessibilityXXXL`.
        XCTContext.runActivity(named: "Exposición lenta «\(identificador)», intento \(intento) de 4") { actividad in
            anotar(actividad, "exponer-\(identificador)-\(intento)-antes",
                "objetivo: \(identificador)\nintento: \(intento) de 4\ncompleto: \(completo), haciaAtras: \(haciaAtras)\n"
                + "velocidad nativa: \(velocidad.rawValue)\nvista usada: \(arriba)…\(abajo), paso: \(paso)\n"
                + "existe: \(existe), marco: \(textoMarco(marco))\nancla: \(ancla.map { "\($0)" } ?? "sin marco")\nsolicitud: \(desplazamiento)")
            arrastrarContenido(desplazamiento, en: app, arriba: arriba, abajo: abajo, velocidad: velocidad)
            let existeDespues = objetivo.exists
            anotar(actividad, "exponer-\(identificador)-\(intento)-despues",
                "existe: \(existeDespues), marco: \(textoMarco(existeDespues ? objetivo.frame : nil))")
        }
    }
    let queda = visible()
    if !queda && velocidad == .slow {
        // Antes de que `XCTAssertTrue` aborte: dónde empezó el arrastre y qué nodo y geometría se resolvieron.
        XCTContext.runActivity(named: "Exposición lenta fallida «\(identificador)»") { actividad in
            anotar(actividad, "exponer-\(identificador)-jerarquia", app.scrollViews.firstMatch.debugDescription)
            let captura = XCTAttachment(screenshot: app.screenshot())
            captura.name = "exponer-\(identificador)-pantalla"
            captura.lifetime = .keepAlways
            actividad.add(captura)
        }
    }
    XCTAssertTrue(queda, "«\(identificador)» no queda \(completo ? "entero y tocable" : "con su comienzo a la vista") entre las barras: marco \(objetivo.exists ? "\(objetivo.frame)" : "fuera de la jerarquía visible"), visible \(arriba)…\(abajo)", file: file, line: line)
}

/// Comprueba, sin desplazar, que cada elemento queda entero entre las barras (y tocable si `tocables`). Con `comienzo`
/// basta que su COMIENZO quede a la vista (para textos más altos que el área visible, como en `exponer(completo: false)`).
/// Antes de leer un marco espera, con la espera nativa y su límite de siempre, a que el elemento exista: si no existe,
/// falla con un mensaje claro y no se lee ningún marco. Es la prueba de que lo auditado a continuación se ve de verdad.
private func comprobarEnteros(_ ids: [String], en app: XCUIApplication, tocables: Bool = false, comienzo: Bool = false, file: StaticString = #filePath, line: UInt = #line) {
    let arriba = app.navigationBars.firstMatch.frame.maxY
    let abajo = app.scrollViews.firstMatch.frame.maxY
    for id in ids {
        let objetivo = app.descendants(matching: .any).matching(identifier: id).firstMatch
        guard objetivo.waitForExistence(timeout: 10) else {
            XCTFail("«\(id)» no existe en la vista que se va a auditar", file: file, line: line)
            continue
        }
        let marco = objetivo.frame
        let aVista = comienzo ? marco.minY >= arriba && marco.minY <= abajo - 80 : marco.minY >= arriba && marco.maxY <= abajo
        XCTAssertTrue(aVista,
            "«\(id)» no queda \(comienzo ? "con su comienzo a la vista" : "entero") en la vista auditada: marco \(marco), visible \(arriba)…\(abajo)", file: file, line: line)
        if tocables { XCTAssertTrue(objetivo.isHittable, "«\(id)» no es tocable en la vista auditada", file: file, line: line) }
    }
}

/// Lleva la pantalla del accesorio al final de su contenido y comprueba que los `visibles` quedan enteros entre las barras:
/// es la posición «de abajo». Al final del contenido no queda nada bajo el área desplazable, así que lo recortado en la
/// posición de arriba (contraste diferido) se mide aquí entero y sin recorte.
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
    /// Los dos recorridos que lo usan parten de más abajo (tras los controles o al final): «Buscar» queda encima.
    private func buscarYElegir(conHoja: Bool) {
        exponer("boton-buscar", en: app, haciaAtras: true)
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
        // El botón está a la vista: su cambio de rótulo es la señal. El título del bloqueo queda más abajo: se coloca a
        // la vista antes de esperarlo.
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

        // Detener (el botón queda encima del estado en el que se acaba de leer el enlace).
        exponer("boton-sesion-accesorio", en: app, haciaAtras: true)
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
        // El aviso y «Abrir Ajustes» están arriba, posiblemente fuera de la vista tras buscar: se vuelve allí.
        exponer("aviso-transporte-sintetico", en: app, haciaAtras: true)
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

    /// Con texto normal la auditoría se hace en DOS posiciones por fase estable, cada una con todos los tipos y sin
    /// filtros: arriba (avisos y botones) y al final (estado y audio). Antes de cada una se comprueba que los elementos
    /// clave quedan enteros entre las barras. La pantalla usa pilas ansiosas: lo recortado bajo el área desplazable
    /// también llega a la auditoría de contraste. Ese contraste recortado se DIFIERE en el libro de la fase
    /// (`FaseAuditada`) y se mide de nuevo entero a la vista (la posición de abajo, o una remedición al cerrar); lo
    /// visible o de otro tipo falla. Reposo y bloqueada son dos fases: no se cruzan deudas entre estados distintos.
    func testAuditoriaAccesibilidadSesionAccesorioEnReposoYBloqueada() throws {
        lanzar(["-PRUEBAS_UI_ACCESORIO_PERMISO_CONCEDIDO"])
        XCTAssertTrue(elemento("aviso-transporte-sintetico").waitForExistence(timeout: 10))
        // Reposo, arriba: los dos botones están inhabilitados porque no hay accesorio elegido, y deben pasar el contraste.
        let reposo = FaseAuditada("reposo", app: app, caso: self)
        exponer("aviso-transporte-sintetico", en: app)
        comprobarEnteros(["aviso-seguridad-enlace", "boton-sesion-accesorio", "boton-reconectar"], en: app)
        XCTAssertFalse(elemento("boton-sesion-accesorio").isEnabled)
        XCTAssertFalse(elemento("boton-reconectar").isEnabled)
        try reposo.auditar("accesorio-reposo-arriba")
        exponerAlFinal(visibles: ["estado-accesorio", "estado-audio"], en: app)
        try reposo.auditar("accesorio-reposo-abajo")
        try reposo.cerrar()
        buscarYElegir(conHoja: false)
        iniciarYEsperarBloqueo()
        // Tras iniciar, el título del bloqueo quedó centrado más abajo: el aviso de arriba queda encima.
        let bloqueada = FaseAuditada("bloqueada", app: app, caso: self)
        exponer("aviso-transporte-sintetico", en: app, haciaAtras: true)
        comprobarEnteros(["aviso-seguridad-enlace", "boton-sesion-accesorio", "boton-reconectar"], en: app)
        try bloqueada.auditar("accesorio-bloqueado-arriba")
        exponerAlFinal(visibles: ["estado-accesorio", "estado-audio"], en: app)
        try bloqueada.auditar("accesorio-bloqueado-abajo")
        try bloqueada.cerrar()
    }

    func testAuditoriaAccesibilidadPermisoDenegado() throws {
        lanzar(["-PRUEBAS_UI_ACCESORIO_PERMISO_DENEGADO"])
        exponer("boton-buscar", en: app)
        elemento("boton-buscar").tap()
        let continuar = elemento("boton-permiso-continuar")
        XCTAssertTrue(continuar.waitForExistence(timeout: 10))
        continuar.tap()
        XCTAssertTrue(continuar.waitForNonExistence(timeout: 10), "La hoja del permiso no se cerró")
        // Arriba están el texto del permiso y «Abrir Ajustes»; se vuelve allí antes de comprobarlos.
        let denegado = FaseAuditada("permiso-denegado", app: app, caso: self)
        exponer("aviso-transporte-sintetico", en: app, haciaAtras: true)
        esperarEtiqueta("Sin permiso de Bluetooth. Actívalo en Ajustes, en TransMiVoz.")
        XCTAssertTrue(elemento("boton-abrir-ajustes").waitForExistence(timeout: 10))
        comprobarEnteros(["estado-bluetooth", "boton-abrir-ajustes"], en: app, tocables: true)
        // Sin accesorio elegido los dos botones siguen inhabilitados y también quedan enteros (no hace falta que sean tocables).
        comprobarEnteros(["boton-sesion-accesorio", "boton-reconectar"], en: app)
        for id in ["boton-sesion-accesorio", "boton-reconectar"] {
            XCTAssertFalse(elemento(id).isEnabled, "«\(id)» debe seguir inhabilitado sin accesorio elegido")
        }
        try denegado.auditar("accesorio-permiso-denegado-arriba")
        exponerAlFinal(visibles: ["estado-accesorio", "estado-audio"], en: app)
        try denegado.auditar("accesorio-permiso-denegado-abajo")
        try denegado.cerrar()
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

        // Directo desde arriba, «Buscar» consume los cuatro gestos: se pasa antes por el aviso de seguridad.
        exponer("aviso-seguridad-enlace", en: app, completo: false)
        exponer("boton-buscar", en: app)
        elemento("boton-buscar").tap()
        XCTAssertTrue(elemento("texto-permiso-bluetooth").waitForExistence(timeout: 10), "Falta la explicación previa al permiso")
        XCTAssertTrue(elemento("boton-permiso-continuar").exists)
        try auditar(app, "texto-muy-grande-Accesorio-hoja-permiso", testCase: self)
    }

    /// Recorrido por fases estables, cada una con su libro de contraste diferido (`FaseAuditada`): reposo (avisos,
    /// bloqueo, búsqueda), hallazgo (la lista con «Elegir») y bloqueada (controles, estado, audio, voz). Cada fase se
    /// cierra ANTES de cambiar de estado: lo recortado que queda en deuda se lleva entero a la vista y se vuelve a
    /// auditar con todos los grupos (remedición obligatoria). Lo visible, lo desconocido y todo lo que no es contraste falla.
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

        XCTAssertTrue(elemento("aviso-transporte-sintetico").waitForExistence(timeout: 10))
        // Reposo: el aviso de pruebas queda entero a la vista (lo exige `exponer`) y el del sensor real, al menos su comienzo.
        let reposo = FaseAuditada("reposo-texto-muy-grande", app: app, caso: self, velocidad: .slow)
        exponer("aviso-transporte-sintetico", en: app)
        comprobarEnteros(["aviso-accesorio-real"], en: app, comienzo: true)
        try reposo.auditar("texto-muy-grande-Accesorio-avisos-iniciales")
        for (id, contexto, completo) in [("aviso-seguridad-enlace", "bloqueo", false), ("boton-buscar", "busqueda", true)] {
            exponer(id, en: app, completo: completo)
            try reposo.auditar("texto-muy-grande-Accesorio-\(contexto)")
        }
        try reposo.cerrar()

        // Buscar cambia el estado (aparece la lista): fase nueva. El cierre de la fase pudo mover el desplazamiento: se
        // vuelve a «Buscar» por el mismo ancla de seguridad de antes (directo, «Buscar» consume los cuatro gestos).
        exponer("aviso-seguridad-enlace", en: app, completo: false)
        exponer("boton-buscar", en: app)
        elemento("boton-buscar").tap()
        let elegir = elemento("elegir-SINTETICO-0001")
        XCTAssertTrue(elegir.waitForExistence(timeout: 10))
        let hallazgo = FaseAuditada("hallazgo-texto-muy-grande", app: app, caso: self, velocidad: .slow)
        exponer("elegir-SINTETICO-0001", en: app)
        try hallazgo.auditar("texto-muy-grande-Accesorio-hallazgo")
        try hallazgo.cerrar()
        exponer("elegir-SINTETICO-0001", en: app)
        elegir.tap()

        exponer("boton-sesion-accesorio", en: app)
        let sesion = elemento("boton-sesion-accesorio")
        sesion.tap()
        // El botón está a la vista: su rótulo es la señal. El título del bloqueo queda más abajo: se coloca antes.
        esperar(sesion, "label == %@", "Detener sesión", "La sesión no arrancó")
        exponer("titulo-estado-accesorio", en: app)
        let bloqueado = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", "Bloqueado: enlace no verificado")).firstMatch
        XCTAssertTrue(bloqueado.waitForExistence(timeout: 10), "No apareció el bloqueo")
        // Bloqueada: el título del bloqueo quedó centrado, los controles están encima y el resto, debajo.
        let bloqueada = FaseAuditada("bloqueada-texto-muy-grande", app: app, caso: self, velocidad: .slow)
        for (id, contexto, completo, haciaAtras) in [
            ("boton-sesion-accesorio", "controles", true, true), ("titulo-estado-accesorio", "estado", true, false),
            ("estado-accesorio", "descripcion", false, false), ("estado-audio", "audio", false, false),
            ("interruptor-voz-app", "voz", true, false),
        ] {
            exponer(id, en: app, completo: completo, haciaAtras: haciaAtras)
            try bloqueada.auditar("texto-muy-grande-Accesorio-\(contexto)")
        }
        try bloqueada.cerrar()
    }

    /// Permiso denegado con el texto más grande: el texto del permiso (~546 pt) y «Abrir Ajustes» no caben a la vez
    /// entre las barras, así que se llevan a la vista UNO por UNO, cada uno entero y tocable, y se audita en cada
    /// posición con todos los tipos. Lo que quede recortado en una posición se mide entero en la otra o al cerrar la fase.
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
        // Directo desde arriba, «Buscar» consume los cuatro gestos: se pasa antes por el aviso de seguridad.
        exponer("aviso-seguridad-enlace", en: app, completo: false)
        exponer("boton-buscar", en: app)
        elemento("boton-buscar").tap()
        // La hoja del permiso es la de siempre; su botón se toca con el desplazamiento propio de XCTest.
        let continuar = elemento("boton-permiso-continuar")
        XCTAssertTrue(continuar.waitForExistence(timeout: 10), "Falta la explicación previa al permiso")
        continuar.tap()
        XCTAssertTrue(continuar.waitForNonExistence(timeout: 10), "La hoja del permiso no se cerró")

        let denegado = FaseAuditada("permiso-denegado-texto-muy-grande", app: app, caso: self, velocidad: .slow)
        XCTAssertTrue(elemento("estado-bluetooth").waitForExistence(timeout: 10), "No apareció el texto de permiso denegado")
        XCTAssertEqual(elemento("estado-bluetooth").label, "Sin permiso de Bluetooth. Actívalo en Ajustes, en TransMiVoz.")
        XCTAssertTrue(elemento("boton-abrir-ajustes").waitForExistence(timeout: 10), "Falta «Abrir Ajustes»")
        // Dos posiciones, sin alineaciones a mano: primero el texto del permiso, entero y tocable...
        exponer("estado-bluetooth", en: app)
        comprobarEnteros(["estado-bluetooth"], en: app, tocables: true)
        try denegado.auditar("texto-muy-grande-Accesorio-permiso-denegado-texto")
        // ... y aparte «Abrir Ajustes», entero y tocable.
        exponer("boton-abrir-ajustes", en: app)
        comprobarEnteros(["boton-abrir-ajustes"], en: app, tocables: true)
        try denegado.auditar("texto-muy-grande-Accesorio-permiso-denegado-ajustes")
        try denegado.cerrar()
    }
}

/// Control negativo NATIVO del libro de contraste diferido. La app se lanza con una pantalla de depuración
/// (`-PRUEBAS_UI_CONTRASTE_MALO`, ver `FixtureContrasteMalo`) con un texto de contraste insuficiente A PROPÓSITO y entero a
/// la vista. La prueba solo pasa si ve el rechazo: la auditoría nativa lo reporta y el mismo clasificador y libro lo
/// rechazan por estar entero a la vista, sin diferirlo. No usa `cerrar()` porque ese fallo es el resultado esperado.
final class TransMiVozContrasteNegativoUITests: XCTestCase {
    func testElContrasteInsuficienteVisibleSeReportaYSeRechaza() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments += [
            "-PRUEBAS_UI_SIMULADAS", "-PRUEBAS_UI_CONTRASTE_MALO",
            "-AppleLanguages", "(es)", "-AppleLocale", "es_CO",
            "-UIPreferredContentSizeCategoryName", "UICTContentSizeCategoryL",
        ]
        app.launch()
        addTeardownBlock { app.terminate() }
        let id = "contraste-malo-sintetico"
        XCTAssertTrue(app.descendants(matching: .any).matching(identifier: id).firstMatch.waitForExistence(timeout: 10), "Falta el control negativo")
        comprobarEnteros([id], en: app)

        let fase = FaseAuditada("control-negativo", app: app, caso: self)
        try fase.auditar("control-negativo-visible")
        try fase.cerrarSinFallar()

        XCTAssertTrue(fase.hallazgos.contains { $0.esContraste && $0.identificador == id },
            "La auditoría nativa no reportó el contraste insuficiente del control. Hallazgos: \(fase.hallazgos.map(\.descripcion))")
        XCTAssertTrue(fase.libro.fallos.contains { $0.contains("«\(id)»") && $0.contains("entero a la vista") },
            "El libro no rechazó el contraste visible. Fallos: \(fase.libro.fallos)")
        XCTAssertFalse(fase.libro.diferidos.keys.contains { $0.identificador == id }, "El contraste visible no puede diferirse")
    }
}
