import XCTest
@testable import TransMiVoz

/// El dueño de la conexión nativa que usa `TransporteCoreBluetooth` (`CicloConexionNativa`), sin fabricar
/// objetos de Core Bluetooth: la regla que importa (el aviso de cierre de una conexión vieja no es el corte
/// de la nueva) vive aquí y es la que ejecuta el transporte real.
final class CicloConexionNativaTests: XCTestCase {
    func testReconectarAlMismoPerifericoEsperaElAvisoDeCierreDeLaAnterior() {
        var ciclo = CicloConexionNativa()
        XCTAssertEqual(ciclo.pedir(id: "A", token: 1), [.abrir(id: "A")])
        XCTAssertTrue(ciclo.vale("A"))

        // Detener: el cierre nativo es asíncrono, el periférico sigue activo.
        XCTAssertEqual(ciclo.cerrar(nativoActivo: true), [.cerrar(id: "A")])
        XCTAssertNil(ciclo.token)
        XCTAssertFalse(ciclo.vale("A"), "nada de la conexión cerrada cuenta")

        // Reconectar al MISMO periférico antes del aviso: no se abre, espera.
        XCTAssertEqual(ciclo.pedir(id: "A", token: 2), [])
        XCTAssertNil(ciclo.token, "la conexión nueva todavía no existe")
        XCTAssertTrue(ciclo.atiende(token: 2), "pero la petición sigue en curso (idempotente)")

        // Llega el aviso de la vieja: se consume y recién entonces se abre la nueva, con SU token.
        XCTAssertEqual(ciclo.terminal("A"), .abrir(id: "A", token: 2))
        XCTAssertEqual(ciclo.token, 2)
        XCTAssertTrue(ciclo.vale("A"))

        // Un corte posterior sí es de la conexión nueva y lleva el token 2, nunca el 1.
        XCTAssertEqual(ciclo.terminal("A"), .avisar(token: 2))
        XCTAssertFalse(ciclo.vale("A"))
    }

    func testElAvisoTardioDeLaConexionViejaNoSeReenviaNiTomaElTokenNuevo() {
        var ciclo = CicloConexionNativa()
        _ = ciclo.pedir(id: "A", token: 1)
        _ = ciclo.cerrar(nativoActivo: true)
        // Sin reconexión pedida, el aviso de cierre es solo eso: no hay a quién avisar.
        XCTAssertEqual(ciclo.terminal("A"), .ignorar)
        XCTAssertNil(ciclo.token)
        // Y una conexión pedida después ya no espera nada.
        XCTAssertEqual(ciclo.pedir(id: "A", token: 3), [.abrir(id: "A")])
        XCTAssertEqual(ciclo.token, 3)
    }

    func testCancelarUnaConexionPendienteSigueElMismoCamino() {
        // Una conexión solo «pendiente» (el sistema aún no conectó) también avisa del cierre al cancelarla:
        // el nativo no está en `.disconnected`, así que se espera ese aviso y no se queda esperando para siempre
        // sin que nadie lo vigile (lo vigila el plazo de la sesión, probado en el modelo).
        var ciclo = CicloConexionNativa()
        _ = ciclo.pedir(id: "A", token: 1)
        XCTAssertEqual(ciclo.cerrar(nativoActivo: true), [.cerrar(id: "A")])
        XCTAssertEqual(ciclo.pedir(id: "A", token: 2), [])
        // Si la persona se rinde antes del aviso, la petición en espera se olvida.
        XCTAssertEqual(ciclo.cerrar(nativoActivo: false), [])
        XCTAssertFalse(ciclo.atiende(token: 2))
        XCTAssertEqual(ciclo.terminal("A"), .ignorar, "el aviso de la primera llega y ya no abre nada")
        XCTAssertNil(ciclo.token)
    }

    func testPerifericoYaDesconectadoSeReabreEnSeguida() {
        var ciclo = CicloConexionNativa()
        _ = ciclo.pedir(id: "A", token: 1)
        XCTAssertEqual(ciclo.cerrar(nativoActivo: false), [], "no hay cierre nativo que esperar")
        XCTAssertEqual(ciclo.pedir(id: "A", token: 2), [.abrir(id: "A")])
    }

    func testUnCorteDeLaSistemaSeAvisaConSuTokenYLaReconexionNoEspera() {
        var ciclo = CicloConexionNativa()
        _ = ciclo.pedir(id: "A", token: 1)
        XCTAssertEqual(ciclo.terminal("A"), .avisar(token: 1))
        XCTAssertNil(ciclo.token, "terminada: ya no vale")
        XCTAssertEqual(ciclo.cerrar(nativoActivo: false), [])
        XCTAssertEqual(ciclo.pedir(id: "A", token: 2), [.abrir(id: "A")])
    }

    func testOtroPerifericoNoEsperaElCierreDelPrimero() {
        var ciclo = CicloConexionNativa()
        _ = ciclo.pedir(id: "A", token: 1)
        _ = ciclo.cerrar(nativoActivo: true)
        XCTAssertEqual(ciclo.pedir(id: "B", token: 2), [.abrir(id: "B")])
        XCTAssertEqual(ciclo.terminal("A"), .ignorar, "el cierre de A no toca a B")
        XCTAssertEqual(ciclo.token, 2)
        XCTAssertTrue(ciclo.vale("B"))
        XCTAssertFalse(ciclo.vale("A"))
    }

    func testBluetoothApagadoOlvidaTodoYNadaEspera() {
        var ciclo = CicloConexionNativa()
        _ = ciclo.pedir(id: "A", token: 1)
        _ = ciclo.cerrar(nativoActivo: true)
        _ = ciclo.pedir(id: "A", token: 2)
        ciclo.reiniciar()
        XCTAssertNil(ciclo.token)
        XCTAssertEqual(ciclo.pedir(id: "A", token: 3), [.abrir(id: "A")], "tras el reinicio no queda cierre pendiente")
    }

    func testPedirLaMismaConexionOtraVezEsIdempotente() {
        var ciclo = CicloConexionNativa()
        _ = ciclo.pedir(id: "A", token: 1)
        XCTAssertTrue(ciclo.atiende(token: 1))
        XCTAssertFalse(ciclo.atiende(token: 2))
    }
}

/// Notificaciones: apagar una suscripción que no existe no debe depender de un aviso que no llega, y
/// nada anterior a la confirmación puede tomarse por la lectura fresca de referencia.
final class NotificacionesLocalesTests: XCTestCase {
    func testApagarLoQueNuncaSeSuscribioSeConfirmaLocalmente() {
        var c = ClasificadorValores()
        XCTAssertEqual(c.pedirNotificaciones(false, activasEnSistema: false), .yaEstaba)
        XCTAssertFalse(c.notificando)
        XCTAssertTrue(c.pedirLectura(), "confirmadas apagadas: ya se puede leer la referencia")
    }

    func testLoLocalSigueAlSistemaNoALoSupuesto() {
        var c = ClasificadorValores()
        c.confirmarNotificaciones(true)  // la sesión suponía «encendidas»
        XCTAssertEqual(c.pedirNotificaciones(false, activasEnSistema: false), .yaEstaba)
        XCTAssertFalse(c.notificando, "se corrige con lo que declara el sistema")
    }

    func testApagarUnaSuscripcionRealEsperaSuConfirmacionAntesDeLeer() {
        var c = ClasificadorValores()
        XCTAssertEqual(c.pedirNotificaciones(true, activasEnSistema: false), .pedir)
        c.confirmarNotificaciones(true)
        XCTAssertEqual(c.pedirNotificaciones(false, activasEnSistema: true), .pedir)
        XCTAssertFalse(c.pedirLectura(), "hasta la confirmación sigue habiendo notificaciones: no se lee")
        c.confirmarNotificaciones(false)
        XCTAssertTrue(c.pedirLectura())
    }

    func testUnaNotificacionRezagadaDespuesDeApagarYAntesDeLeerSeDescarta() {
        var c = ClasificadorValores()
        c.confirmarNotificaciones(true)
        c.confirmarNotificaciones(false)
        XCTAssertEqual(c.recibirValor(conError: false), .descartar, "no hay lectura pedida: no puede ser la referencia")
        XCTAssertTrue(c.pedirLectura())
        XCTAssertEqual(c.recibirValor(conError: false), .respuestaLectura)
    }
}
