import ContratoBLE
import Foundation
import XCTest

final class ContratoTests: XCTestCase {
    private func datos(_ hex: String) -> Data {
        var d = Data()
        var i = hex.startIndex
        while i < hex.endIndex {
            let j = hex.index(i, offsetBy: 2)
            d.append(UInt8(hex[i..<j], radix: 16)!)
            i = j
        }
        return d
    }

    func testIdentificadoresDelContrato() {
        XCTAssertEqual(IdentificadoresBLE.servicio, "E13A0000-76B8-4FB0-9D2B-8C4F8D8A7E31")
        XCTAssertNotNil(UUID(uuidString: IdentificadoresBLE.caracteristicaInformacion))
        XCTAssertNotNil(UUID(uuidString: IdentificadoresBLE.caracteristicaMedicion))
    }

    func testEjemploSinteticoDelInforme() throws {
        // §8.3 de investigacion-hardware-ios.md.
        let info = try InformacionAccesorio.decodificar(
            datos("0100070088776655000102026400f40164007017"))
        let m = try Medicion.decodificar(datos("010f2a0044332211e8030000b00448f41400ff00"), informacion: info)
        XCTAssertEqual(m.secuencia, 42)
        XCTAssertEqual(m.idArranque, 0x1122_3344)
        XCTAssertEqual(m.instanteEmisionMs, 1000)
        XCTAssertEqual(m.distanciaMm, 1200)
        XCTAssertEqual(m.azimutCentesimas, -3000)
        XCTAssertEqual(m.edadResultadoMs, 20)
        XCTAssertEqual(m.bateriaPorcentaje, 255)
    }

    func testDecodificarFuncionaConSubsecuenciaDeData() throws {
        // Una Data recortada no empieza en el índice 0.
        let grande = Data([0xAA, 0xBB]) + datos("0100000044332211000100016400f4010000b80b")
        let recortada = grande.suffix(from: 2)
        XCTAssertNotEqual(recortada.startIndex, 0)
        XCTAssertEqual(try InformacionAccesorio.decodificar(recortada).idArranque, 0x1122_3344)
    }

    func testSesionMinimaSinHardware() {
        var s = SesionProximidad(accesorioElegido: "a")
        XCTAssertEqual(s.estado, .desconectada)
        // Fail-closed: sin nivel de enlace afirmado no hay sesión.
        XCTAssertEqual(s.conectar(accesorio: "a", enlace: .desconocido), .rechazado(.enlaceNoAutenticado))
        XCTAssertFalse(s.enlaceAutenticado)
        XCTAssertEqual(s.conectar(accesorio: "a", enlace: .cifradoAutenticado), .aceptado)
        XCTAssertTrue(s.enlaceAutenticado)
    }
}
