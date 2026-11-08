import ContratoBLE
import XCTest
@testable import TransMiVoz

/// Reloj falso: la «espera» solo adelanta el reloj, así la sesión corre sin esperar de verdad.
final class RelojFalso: @unchecked Sendable {
    private let candado = NSLock()
    private var ms: Milisegundos = 1_000_000
    var ahora: Milisegundos { candado.lock(); defer { candado.unlock() }; return ms }
    func avanzar(_ delta: Milisegundos) { candado.lock(); ms += delta; candado.unlock() }
}

/// Anota los estados de la sesión desde la pausa inyectada, no desde un bucle de la prueba.
///
/// Es determinista: en `ejecutarGuion`, cada `publicar` va seguido de un `await pausa(...)`
/// antes del siguiente `publicar`, y mientras la tarea está en la pausa el estado no cambia.
/// Por eso anotar al empezar la pausa registra cada estado que la pantalla podía mostrar, sin
/// depender de cuándo le toca el turno a la prueba. Antes la prueba revisaba `estado` en un
/// bucle con `Task.yield()` mientras el guion avanzaba en otra tarea, y podía saltarse un
/// estado que dura un solo paso (en la ejecución 42417859757 se saltó el objetivo a 1500 mm).
@MainActor
final class RegistroEstados {
    weak var modelo: SesionLocalModelo?
    private(set) var vistos: [EstadoSesion] = []
    /// Se cumple una sola vez, al anotar ese estado, y luego queda en `nil`.
    var espera: (estado: EstadoSesion, expectativa: XCTestExpectation)?

    /// Agrega el estado actual si es distinto del último anotado.
    func anotar() {
        guard let estado = modelo?.estado else { return }
        if vistos.last != estado { vistos.append(estado) }
        if let espera, espera.estado == estado {
            espera.expectativa.fulfill()
            self.espera = nil
        }
    }
}

@MainActor
final class SesionLocalModeloTests: XCTestCase {
    private func crear(_ reloj: RelojFalso, registro: RegistroEstados? = nil) -> SesionLocalModelo {
        let modelo = SesionLocalModelo(reloj: { reloj.ahora }, pausa: { ms in
            if let registro { await registro.anotar() }
            reloj.avanzar(ms)
            await Task.yield()
        })
        registro?.modelo = modelo
        return modelo
    }

    private func esperar(_ modelo: SesionLocalModelo, hasta estado: EstadoSesion, file: StaticString = #filePath, line: UInt = #line) async {
        for _ in 0..<5_000 where modelo.estado != estado {
            await Task.yield()
        }
        XCTAssertEqual(modelo.estado, estado, file: file, line: line)
    }

    func testSinIniciarNoHayMedidas() async {
        let modelo = SesionLocalModelo()
        XCTAssertFalse(modelo.activa)
        XCTAssertEqual(modelo.estado, .desconectada)
    }

    func testSiempreSimuladaYSinEnlaceAutenticado() async {
        let modelo = crear(RelojFalso())
        XCTAssertTrue(modelo.esSimulada)
        XCTAssertFalse(modelo.enlaceAutenticado)
        modelo.iniciar()
        await esperar(modelo, hasta: .sinDatos(.vencido))
        XCTAssertTrue(modelo.esSimulada)
        XCTAssertFalse(modelo.enlaceAutenticado, "un guion simulado no demuestra un enlace autenticado")
        modelo.detener()
    }

    func testElGuionRecorreSusEstadosYCaducaSinRepetirLaUltimaMedida() async {
        let registro = RegistroEstados()
        let caducada = expectation(description: "la sesión simulada caduca")
        registro.espera = (.sinDatos(.vencido), caducada)
        let modelo = crear(RelojFalso(), registro: registro)
        modelo.iniciar()
        await fulfillment(of: [caducada], timeout: 10)
        // Se copia antes de `detener`, que cambia el estado a `.desconectada`.
        let vistos = registro.vistos
        modelo.detener()
        XCTAssertTrue(vistos.contains(.sincronizando) || vistos.contains(.esperandoInformacion))
        XCTAssertTrue(vistos.contains(.sinBlanco))
        XCTAssertTrue(vistos.contains(.objetivo(distanciaMm: 1500, azimutCentesimas: -3000)))
        XCTAssertTrue(vistos.contains(.objetivo(distanciaMm: 900, azimutCentesimas: nil)))
        XCTAssertEqual(vistos.last, .sinDatos(.vencido))
        XCTAssertFalse(vistos.contains { if case .rechazada = $0 { return true } else { return false } })
    }

    func testDetenerDescartaTodoYNoDejaMedidaVigente() async {
        let reloj = RelojFalso()
        let modelo = crear(reloj)
        modelo.iniciar()
        await esperar(modelo, hasta: .sinDatos(.vencido))
        modelo.detener()
        XCTAssertFalse(modelo.activa)
        XCTAssertEqual(modelo.estado, .desconectada)
        for _ in 0..<50 { await Task.yield() }
        XCTAssertEqual(modelo.estado, .desconectada, "una tarea cancelada no puede escribir estado")
    }

    func testReiniciarAlVolverDelFondo() async {
        let modelo = crear(RelojFalso())
        modelo.alVolverAPrimerPlano()
        XCTAssertFalse(modelo.activa, "sin sesión activa no se arranca nada")
        modelo.iniciar()
        modelo.alVolverAPrimerPlano()
        XCTAssertTrue(modelo.activa)
        await esperar(modelo, hasta: .sinDatos(.vencido))
        modelo.detener()
    }

    func testTextoDeEstadosNoDiceCaminoLibre() {
        let estados: [EstadoSesion] = [
            .desconectada, .esperandoInformacion, .sincronizando, .rechazada(.simulacionNoCoincide),
            .sinDatos(.sinRecepcion), .sinDatos(.vencido), .sinDatos(.sinResultado),
            .radarNoDisponible(.iniciando), .sinBlanco, .presencia,
            .objetivo(distanciaMm: 1200, azimutCentesimas: -3000), .objetivo(distanciaMm: 900, azimutCentesimas: nil),
        ]
        for estado in estados {
            let texto = TextoEstadoSesion.descripcion(estado).lowercased()
            XCTAssertFalse(texto.isEmpty)
            XCTAssertFalse(texto.contains("camino libre") && !texto.contains("no significa"), texto)
            XCTAssertFalse(texto.contains("sin obstáculos") && !texto.contains("no significa"), texto)
        }
    }
}

/// El guion de demostración debe seguir siendo válido para el decodificador real.
final class GuionSimuladoTests: XCTestCase {
    func testTodasLasTramasDelGuionSonValidasEnModoSimulado() {
        var sesion = SesionProximidad(accesorioElegido: "acc", politica: .permitirAsociacionSinMITM, modo: .simulada)
        XCTAssertEqual(sesion.conectar(accesorio: "acc", enlace: .cifradoSinAutenticar), .aceptado)
        XCTAssertEqual(sesion.registrarInformacion(GuionSimulado.datos(GuionSimulado.informacion)), .aceptado)
        XCTAssertEqual(sesion.registrarReferencia(inicioLecturaMs: 1000, finLecturaMs: 1005, datos: GuionSimulado.datos(GuionSimulado.referencia.trama)), .aceptado)
        for paso in GuionSimulado.notificaciones {
            let resultado = sesion.recibirNotificacion(GuionSimulado.datos(paso.trama), recibidaEnMs: 1005 + Milisegundos(paso.desplazamientoMs))
            XCTAssertEqual(resultado, .aceptado, paso.descripcion)
        }
        XCTAssertEqual(sesion.estado, .sinBlanco)
        XCTAssertEqual(sesion.tramasPerdidas, 0)
        XCTAssertTrue(sesion.esSimulada)
        XCTAssertFalse(sesion.enlaceAutenticado)
    }

    func testUnaSesionRealRechazaElGuionSimulado() {
        var sesion = SesionProximidad(accesorioElegido: "acc", politica: .permitirAsociacionSinMITM, modo: .real)
        sesion.conectar(accesorio: "acc", enlace: .cifradoSinAutenticar)
        sesion.registrarInformacion(GuionSimulado.datos(GuionSimulado.informacion))
        XCTAssertEqual(
            sesion.registrarReferencia(inicioLecturaMs: 1000, finLecturaMs: 1005, datos: GuionSimulado.datos(GuionSimulado.referencia.trama)),
            .rechazado(.simulacionNoCoincide))
    }
}
