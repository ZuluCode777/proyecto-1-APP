import XCTest
@testable import TransMiVoz

/// Almacén que siempre falla, para probar el aviso cuando el Llavero no responde.
private struct AlmacenQueFalla: AlmacenClave {
    func leer(origen: OrigenServidor) throws -> ClaveAcceso? { nil }
    func guardar(_ clave: ClaveAcceso, origen: OrigenServidor) throws { throw ErrorAlmacenClave(codigo: -1) }
    func borrar(origen: OrigenServidor) throws { throw ErrorAlmacenClave(codigo: -1) }
}

/// Almacén con una clave ya guardada cuyo BORRADO falla mientras `borradoRoto` sea
/// verdadero: modela un Llavero que lee bien pero no deja borrar.
private final class AlmacenConBorradoRoto: AlmacenClave, @unchecked Sendable {
    private let candado = NSLock()
    private var claves: [OrigenServidor: ClaveAcceso] = [:]
    private var roto = true

    init(guardada: ClaveAcceso, origen: OrigenServidor) { claves[origen] = guardada }

    var borradoRoto: Bool {
        get { candado.lock(); defer { candado.unlock() }; return roto }
        set { candado.lock(); roto = newValue; candado.unlock() }
    }

    func leer(origen: OrigenServidor) throws -> ClaveAcceso? { candado.lock(); defer { candado.unlock() }; return claves[origen] }
    func guardar(_ clave: ClaveAcceso, origen: OrigenServidor) throws { candado.lock(); claves[origen] = clave; candado.unlock() }
    func borrar(origen: OrigenServidor) throws {
        candado.lock(); defer { candado.unlock() }
        if roto { throw ErrorAlmacenClave(codigo: -2) }
        claves[origen] = nil
    }
}

@MainActor
final class AjustesServidorModeloTests: XCTestCase {
    private var preferencias: UserDefaults!
    private var nombreSuite = ""

    override func setUp() async throws {
        nombreSuite = "pruebas.transmivoz.\(UUID().uuidString)"
        preferencias = UserDefaults(suiteName: nombreSuite)
    }

    override func tearDown() async throws {
        preferencias.removePersistentDomain(forName: nombreSuite)
    }

    private let origenA = try! OrigenServidor.analizar("https://a.ejemplo").get()
    private let origenB = try! OrigenServidor.analizar("https://b.ejemplo").get()

    func testSinNadaGuardadoNoHayServidor() async throws {
        let modelo = AjustesServidorModelo(almacen: AlmacenClaveEnMemoria(), preferencias: preferencias)
        XCTAssertFalse(modelo.tieneServidor)
        XCTAssertNil(modelo.configuracion)
    }

    func testOrigenInvalidoNoCambiaLaConfiguracion() async throws {
        let modelo = AjustesServidorModelo(almacen: AlmacenClaveEnMemoria(), preferencias: preferencias)
        modelo.origenTexto = "http://a.ejemplo"
        modelo.aplicar()
        XCTAssertFalse(modelo.tieneServidor)
        XCTAssertEqual(modelo.mensaje?.esError, true)
        XCTAssertEqual(modelo.mensaje?.texto, ErrorOrigen.noEsHttps.mensaje)
    }

    func testClaveSoloEnMemoriaNoSeGuardaEnElAlmacen() async throws {
        let almacen = AlmacenClaveEnMemoria()
        let modelo = AjustesServidorModelo(almacen: almacen, preferencias: preferencias)
        modelo.origenTexto = "https://a.ejemplo"
        modelo.claveTexto = "clave-inventada"
        modelo.recordarClave = false
        modelo.aplicar()
        XCTAssertEqual(modelo.configuracion?.clave, ClaveAcceso(valor: "clave-inventada"))
        XCTAssertNil(try almacen.leer(origen: origenA))
        XCTAssertEqual(modelo.claveTexto, "", "el campo se limpia al aplicar")
        XCTAssertFalse(modelo.mensaje?.texto.contains("clave-inventada") ?? true)
    }

    func testRecordarClaveLaGuardaYSeRecuperaAlReabrir() async throws {
        let almacen = AlmacenClaveEnMemoria()
        let modelo = AjustesServidorModelo(almacen: almacen, preferencias: preferencias)
        modelo.origenTexto = "https://a.ejemplo"
        modelo.claveTexto = "clave-inventada"
        modelo.recordarClave = true
        modelo.aplicar()
        XCTAssertEqual(try almacen.leer(origen: origenA), ClaveAcceso(valor: "clave-inventada"))

        let reabierto = AjustesServidorModelo(almacen: almacen, preferencias: preferencias)
        XCTAssertEqual(reabierto.configuracion?.origen, origenA)
        XCTAssertEqual(reabierto.configuracion?.clave, ClaveAcceso(valor: "clave-inventada"))
        XCTAssertTrue(reabierto.recordarClave)
        XCTAssertEqual(reabierto.claveTexto, "", "la clave no se rellena en el campo")
    }

    func testLaClaveNoSeOfreceAOtroOrigen() async throws {
        let almacen = AlmacenClaveEnMemoria()
        let modelo = AjustesServidorModelo(almacen: almacen, preferencias: preferencias)
        modelo.origenTexto = "https://a.ejemplo"
        modelo.claveTexto = "clave-inventada"
        modelo.recordarClave = true
        modelo.aplicar()
        modelo.origenTexto = "https://b.ejemplo"
        modelo.aplicar()
        XCTAssertEqual(modelo.configuracion?.origen, origenB)
        XCTAssertNil(modelo.configuracion?.clave, "la clave de A no se envía a B")
    }

    func testOlvidarClaveLaBorra() async throws {
        let almacen = AlmacenClaveEnMemoria()
        let modelo = AjustesServidorModelo(almacen: almacen, preferencias: preferencias)
        modelo.origenTexto = "https://a.ejemplo"
        modelo.claveTexto = "clave-inventada"
        modelo.recordarClave = true
        modelo.aplicar()
        modelo.olvidarClave()
        XCTAssertNil(try almacen.leer(origen: origenA))
        XCTAssertNil(modelo.configuracion?.clave)
        XCTAssertFalse(modelo.recordarClave)
    }

    func testLlaveroCaidoAvisaYUsaLaClaveSoloEnMemoria() async throws {
        let modelo = AjustesServidorModelo(almacen: AlmacenQueFalla(), preferencias: preferencias)
        modelo.origenTexto = "https://a.ejemplo"
        modelo.claveTexto = "clave-inventada"
        modelo.recordarClave = true
        modelo.aplicar()
        XCTAssertEqual(modelo.mensaje?.esError, true)
        XCTAssertEqual(modelo.configuracion?.clave, ClaveAcceso(valor: "clave-inventada"))
        XCTAssertFalse(modelo.recordarClave)
    }
}

@MainActor
final class AjustesServidorBorradoFallidoTests: XCTestCase {
    private var preferencias: UserDefaults!
    private var nombreSuite = ""
    private let origen = try! OrigenServidor.analizar("https://a.ejemplo").get()
    private let guardada = ClaveAcceso(valor: "clave-guardada-inventada")

    override func setUp() async throws {
        nombreSuite = "pruebas.transmivoz.\(UUID().uuidString)"
        preferencias = UserDefaults(suiteName: nombreSuite)
        preferencias.set(origen.esquemaYAutoridad, forKey: AjustesServidorModelo.claveOrigenGuardado)
    }

    override func tearDown() async throws {
        preferencias.removePersistentDomain(forName: nombreSuite)
    }

    /// Regresión: antes decía «la clave solo vale hasta cerrar la app» y apagaba el
    /// interruptor mientras la clave seguía guardada y volvía al reabrir.
    func testBorradoFallidoNoAfirmaQueLaClaveEsTransitoriaYSeRecargaAlReabrir() async throws {
        let almacen = AlmacenConBorradoRoto(guardada: guardada, origen: origen)
        let modelo = AjustesServidorModelo(almacen: almacen, preferencias: preferencias)
        XCTAssertTrue(modelo.recordarClave, "la clave guardada se carga al abrir")

        modelo.recordarClave = false
        modelo.aplicar()

        XCTAssertEqual(modelo.mensaje?.esError, true, "el fallo debe verse")
        let texto = try XCTUnwrap(modelo.mensaje?.texto)
        XCTAssertFalse(texto.contains("hasta cerrar"), "no es verdad que la clave sea transitoria: \(texto)")
        XCTAssertTrue(texto.contains("seguirá guardada"), texto)
        XCTAssertTrue(texto.contains("reintentar"), texto)
        XCTAssertFalse(texto.contains(guardada.valor))
        XCTAssertEqual(try almacen.leer(origen: origen), guardada, "el almacén conserva la clave")

        // «Reabrir la app»: nuevo modelo con los mismos almacén y preferencias.
        let reabierto = AjustesServidorModelo(almacen: almacen, preferencias: preferencias)
        XCTAssertEqual(reabierto.configuracion?.clave, guardada)
        XCTAssertTrue(reabierto.recordarClave)
    }

    func testBorradoFallidoSePuedeReintentarYLuegoNoVuelve() async throws {
        let almacen = AlmacenConBorradoRoto(guardada: guardada, origen: origen)
        let modelo = AjustesServidorModelo(almacen: almacen, preferencias: preferencias)
        modelo.recordarClave = false
        modelo.aplicar()
        XCTAssertEqual(modelo.mensaje?.esError, true)
        XCTAssertFalse(modelo.recordarClave, "el interruptor queda apagado: aplicar de nuevo reintenta")

        almacen.borradoRoto = false
        modelo.aplicar() // reintento
        XCTAssertEqual(modelo.mensaje?.esError, false)
        XCTAssertNil(try almacen.leer(origen: origen))

        let reabierto = AjustesServidorModelo(almacen: almacen, preferencias: preferencias)
        XCTAssertNil(reabierto.configuracion?.clave)
        XCTAssertFalse(reabierto.recordarClave)
    }

    func testOlvidarClaveConBorradoFallidoNoDiceQueLaOlvido() async throws {
        let almacen = AlmacenConBorradoRoto(guardada: guardada, origen: origen)
        let modelo = AjustesServidorModelo(almacen: almacen, preferencias: preferencias)
        modelo.olvidarClave()
        XCTAssertEqual(modelo.mensaje?.esError, true)
        XCTAssertEqual(modelo.configuracion?.clave, guardada, "no se anuncia un olvido que no ocurrió")
        XCTAssertTrue(modelo.recordarClave)
    }

    func testBorradoFallidoNoTocaLaClaveDeOtroOrigen() async throws {
        let almacen = AlmacenConBorradoRoto(guardada: guardada, origen: origen)
        let modelo = AjustesServidorModelo(almacen: almacen, preferencias: preferencias)
        modelo.origenTexto = "https://b.ejemplo"
        modelo.recordarClave = false
        modelo.aplicar()
        XCTAssertNil(modelo.configuracion?.clave, "la clave de A no pasa a B")
    }
}

#if canImport(Security)
/// Prueba contra el Llavero REAL del Simulator/dispositivo (servicio propio de pruebas).
final class AlmacenClaveLlaveroTests: XCTestCase {
    func testIdaYVueltaYBorrado() throws {
        let almacen = AlmacenClaveLlavero(servicio: "co.transmivoz.pruebas.\(UUID().uuidString)")
        let origen = try OrigenServidor.analizar("https://llavero.ejemplo").get()
        defer { try? almacen.borrar(origen: origen) }
        XCTAssertNil(try almacen.leer(origen: origen))
        try almacen.guardar(ClaveAcceso(valor: "uno"), origen: origen)
        XCTAssertEqual(try almacen.leer(origen: origen), ClaveAcceso(valor: "uno"))
        try almacen.guardar(ClaveAcceso(valor: "dos"), origen: origen)
        XCTAssertEqual(try almacen.leer(origen: origen), ClaveAcceso(valor: "dos"))
        try almacen.borrar(origen: origen)
        XCTAssertNil(try almacen.leer(origen: origen))
    }
}
#endif
