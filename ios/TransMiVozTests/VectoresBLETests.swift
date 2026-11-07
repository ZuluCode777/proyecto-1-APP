import ContratoBLE
import ContratoBLEVectores
import XCTest

/// Ejecuta los vectores COMPARTIDOS de `contratos/ble/` (los mismos que usa el
/// firmware en C++) contra el decodificador y la sesión de `ContratoBLE`. Son
/// vectores SINTÉTICOS: demuestran que Swift y C++ interpretan igual el
/// contrato, no que exista un accesorio ni un enlace físico.
final class VectoresBLETests: XCTestCase {
    /// `<repositorio>/contratos/ble`, deducido de la ubicación de este archivo
    /// (`<repositorio>/ios/TransMiVozTests/VectoresBLETests.swift`). Se puede
    /// forzar con la variable `CONTRATOS_BLE_DIR`.
    private func directorioVectores(archivo: String = #filePath) -> URL {
        if let forzado = ProcessInfo.processInfo.environment["CONTRATOS_BLE_DIR"], !forzado.isEmpty {
            return URL(fileURLWithPath: forzado, isDirectory: true)
        }
        var url = URL(fileURLWithPath: archivo)
        for _ in 0..<3 { url.deleteLastPathComponent() }
        return url.appendingPathComponent("contratos").appendingPathComponent("ble", isDirectory: true)
    }

    func testVectoresCompartidosCoincidenConElDecodificador() throws {
        let directorio = directorioVectores()
        for archivo in ["vectores.txt", "sesiones.txt"] {
            XCTAssertTrue(
                FileManager.default.fileExists(atPath: directorio.appendingPathComponent(archivo).path),
                "Falta \(archivo) en \(directorio.path): sin vectores la prueba NO puede pasar.")
        }
        let resumen = try ejecutarVectores(directorio: directorio)
        XCTAssertTrue(resumen.fallos.isEmpty, "Vectores incumplidos:\n" + resumen.fallos.joined(separator: "\n"))

        // Una ejecución vacía no es una ejecución verde: cada caso del archivo cuenta al menos una comprobación.
        let texto = try String(contentsOf: directorio.appendingPathComponent("vectores.txt"), encoding: .utf8)
        let casosEnArchivo = texto.split(separator: "\n").filter {
            $0.hasPrefix("info ") || $0.hasPrefix("med ") || $0.hasPrefix("emision ")
        }.count
        XCTAssertGreaterThan(casosEnArchivo, 0)
        XCTAssertGreaterThanOrEqual(resumen.casos, casosEnArchivo)
        XCTAssertFalse(resumen.estadosCubiertos.isEmpty, "los escenarios de sesión no comprobaron ningún estado")
        XCTAssertFalse(resumen.erroresCubiertos.isEmpty, "los vectores no cubrieron ningún error del contrato")
    }

    func testSinVectoresLaEjecucionFalla() {
        let inexistente = FileManager.default.temporaryDirectory.appendingPathComponent("no-existe-\(UUID().uuidString)")
        XCTAssertThrowsError(try ejecutarVectores(directorio: inexistente))
    }
}
