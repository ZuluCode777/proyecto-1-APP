import ContratoBLE
import ContratoBLEVectores
import XCTest

/// Ejecuta los mismos vectores que `make -C firmware probar`.
final class VectoresTests: XCTestCase {
    func testVectoresCanonicos() throws {
        let resumen = try ejecutarVectores()
        XCTAssertTrue(resumen.fallos.isEmpty, "\n" + resumen.fallos.joined(separator: "\n"))
        XCTAssertGreaterThan(resumen.casos, 300, "los vectores deberían tener cientos de comprobaciones")
    }

    func testLosVectoresCubrenCadaCodigoDeError() throws {
        let resumen = try ejecutarVectores()
        let sinCubrir = Set(ErrorContrato.allCases).subtracting(resumen.erroresCubiertos)
        XCTAssertTrue(sinCubrir.isEmpty, "sin vector: \(sinCubrir.map(\.rawValue).sorted())")
    }

    func testLosEscenariosCubrenLosEstadosPrincipales() throws {
        let resumen = try ejecutarVectores()
        for etiqueta in ["sinBlanco", "presencia", "sinDatos:sinRecepcion", "sinDatos:vencido",
                         "sinDatos:sinResultado", "radarNoDisponible:2", "objetivo:1200:-3000",
                         "objetivo:1500:-", "esperandoInformacion", "sincronizando", "desconectada",
                         "rechazada:enlaceNoAutenticado", "rechazada:simulacionNoCoincide"] {
            XCTAssertTrue(resumen.estadosCubiertos.contains(etiqueta), "sin escenario para \(etiqueta)")
        }
    }
}
