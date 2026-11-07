import XCTest
@testable import TransMiVoz

final class RespuestaAgenteTests: XCTestCase {
    private func decodificar(_ json: String) throws -> RespuestaAgente {
        try RespuestaAgente.decodificar(FixturesHTTP.datos(json))
    }

    func testAccionNinguna() throws {
        let r = try decodificar(FixturesHTTP.ninguna)
        XCTAssertEqual(r.accion, .ninguna)
        XCTAssertEqual(r.motor, .reglas)
        XCTAssertEqual(r.texto, "Hola, soy TransMiVoz de prueba.")
        XCTAssertTrue(r.pasos.isEmpty)
    }

    func testAccionBusquedaConPasos() throws {
        let r = try decodificar(FixturesHTTP.busqueda)
        XCTAssertEqual(r.accion, .busqueda(estacion: "Estación Ejemplo Norte"))
        XCTAssertEqual(r.motor, .ollama)
        XCTAssertEqual(r.pasos, [PasoAgente(etiqueta: "Busqué la estación", detalle: "Ejemplo Norte"), PasoAgente(etiqueta: "Listo", detalle: nil)])
    }

    func testAccionRuta() throws {
        XCTAssertEqual(try decodificar(FixturesHTTP.ruta).accion, .ruta(codigo: "Z99"))
    }

    func testViajeConteoNoVerificadoPorDefecto() throws {
        guard case .viaje(let tramos) = try decodificar(FixturesHTTP.viaje).accion else { return XCTFail("se esperaba viaje") }
        XCTAssertEqual(tramos, [TramoViaje(codigoRuta: "Z99", estacionAbordaje: "Estación Ejemplo Norte", estacionDescenso: "Estación Ejemplo Sur", estacionesRecorridas: 3, conteoVerificado: false)])
    }

    func testViajeConteoVerificado() throws {
        guard case .viaje(let tramos) = try decodificar(FixturesHTTP.viajeVerificado).accion else { return XCTFail("se esperaba viaje") }
        XCTAssertTrue(tramos[0].conteoVerificado)
    }

    func testFixture429TieneLaMismaFormaQueUnaRespuestaNormal() throws {
        XCTAssertEqual(try decodificar(FixturesHTTP.limite429).accion, .ninguna)
    }

    func testRespuestasFueraDelContratoSeRechazan() {
        let invalidas = [
            FixturesHTTP.accionDesconocida, FixturesHTTP.sinMotor, FixturesHTTP.motorDesconocido,
            FixturesHTTP.textoVacio, FixturesHTTP.busquedaSinEstacion, FixturesHTTP.rutaSinCodigo,
            FixturesHTTP.viajeSinTramos, FixturesHTTP.tramoNegativo, FixturesHTTP.noEsObjeto, "", "no es json",
        ]
        for json in invalidas {
            XCTAssertThrowsError(try decodificar(json), json) { error in
                XCTAssertEqual(error as? ErrorConsulta, .respuestaIncompatible, json)
            }
        }
    }

    func testTextoDesmedidoSeRechaza() {
        let largo = String(repeating: "a", count: RespuestaAgente.maximoCaracteresTexto + 1)
        let json = #"{"reply":"\#(largo)","action":"none","steps":[],"engine":"reglas"}"#
        XCTAssertThrowsError(try decodificar(json))
    }
}
