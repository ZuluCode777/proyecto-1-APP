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

    // MARK: EA-17: acciones, procedencia del catálogo y límites

    func testSeReconocenLasSeisAccionesDelContrato() throws {
        let casos: [(String, AccionAgente)] = [
            ("\"action\":\"none\"", .ninguna),
            ("\"action\":\"frequent\"", .frecuentes),
            ("\"action\":\"gps\"", .gps),
            ("\"action\":\"search\",\"station\":\"A\"", .busqueda(estacion: "A")),
            ("\"action\":\"route\",\"routeCode\":\"Z99\"", .ruta(codigo: "Z99")),
            ("\"action\":\"trip\",\"trip\":[]", .viaje([])),
        ]
        for (campos, esperada) in casos {
            let json = "{\"reply\":\"x\",\"steps\":[],\"engine\":\"reglas\"," + campos + "}"
            XCTAssertEqual(try decodificar(json).accion, esperada, json)
        }
    }

    /// Una respuesta de Metro es `none` con texto y pasos: se decodifica sin campos propios.
    func testRespuestaDeMetroEsAccionNinguna() throws {
        let r = try decodificar(FixturesHTTP.metro)
        XCTAssertEqual(r.accion, .ninguna)
        XCTAssertNil(r.catalogo)
        XCTAssertEqual(r.pasos.count, 1)
    }

    func testSinCatalogoLaRespuestaSigueSiendoValida() throws {
        XCTAssertNil(try decodificar(FixturesHTTP.ruta).catalogo)
    }

    func testCatalogoSeDecodificaConSuAntiguedad() throws {
        XCTAssertEqual(
            try decodificar(FixturesHTTP.rutaCopiaGuardada).catalogo,
            ProcedenciaCatalogo(procedencia: "Datos de una copia guardada de prueba.", antiguo: true))
        XCTAssertEqual(
            try decodificar(FixturesHTTP.viajeConProcedencia).catalogo,
            ProcedenciaCatalogo(procedencia: "Datos de prueba consultados el 1/1/2026.", antiguo: false))
    }

    func testCatalogoMalFormadoSeRechaza() {
        for json in [FixturesHTTP.catalogoSinAntiguedad, FixturesHTTP.catalogoProcedenciaVacia] {
            XCTAssertThrowsError(try decodificar(json), json) { error in
                XCTAssertEqual(error as? ErrorConsulta, .respuestaIncompatible, json)
            }
        }
    }

    /// Fecha y procedencia se conservan aunque el texto del servidor no se muestre.
    func testProcedenciaAparteSoloCuandoElTextoMostradoNoLaTrae() {
        let catalogo = ProcedenciaCatalogo(procedencia: "Datos de prueba del 1/1/2026.", antiguo: false)
        let ruta = RespuestaAgente(texto: "La ruta Z99 es de prueba. Datos de prueba del 1/1/2026.", accion: .ruta(codigo: "Z99"), catalogo: catalogo)
        XCTAssertNil(ruta.procedenciaAparte, "el texto de una ruta ya la trae: no se repite")

        let viaje = RespuestaAgente(texto: "Toma la Z99 en A. Datos de prueba del 1/1/2026.", accion: .viaje([]), catalogo: catalogo)
        XCTAssertEqual(viaje.procedenciaAparte, catalogo.procedencia, "el texto de un viaje no se muestra")

        let sustituida = RespuestaAgente(
            texto: "Toma la Z99 en A. Datos de prueba del 1/1/2026.", accion: .busqueda(estacion: "A"), catalogo: catalogo).saneada()
        XCTAssertEqual(sustituida.texto, GuardiaContenido.avisoNoConfirmable)
        XCTAssertEqual(sustituida.catalogo, catalogo, "el aviso seguro conserva la procedencia")
        XCTAssertEqual(sustituida.procedenciaAparte, catalogo.procedencia)

        XCTAssertNil(RespuestaAgente(texto: "Hola").procedenciaAparte)
    }

    func testCadaAccionQueLaWebAbreDeclaraSuLimiteSinOrdenarNada() {
        XCTAssertNil(AccionAgente.ninguna.limite)
        let conPantalla: [AccionAgente] = [.frecuentes, .gps, .busqueda(estacion: "A"), .ruta(codigo: "Z99"), .viaje([])]
        for accion in conPantalla {
            let limite = accion.limite ?? ""
            XCTAssertTrue(limite.hasPrefix("Esta app"), "\(accion)")
            XCTAssertFalse(GuardiaContenido.contieneOrdenDeViaje(limite), "\(accion)")
        }
        // Sin ubicación, el origen se escribe.
        XCTAssertTrue(AccionAgente.gps.limite?.contains("desde qué estación sales") ?? false)
    }

    func testTextoDesmedidoSeRechaza() {
        let largo = String(repeating: "a", count: RespuestaAgente.maximoCaracteresTexto + 1)
        let json = #"{"reply":"\#(largo)","action":"none","steps":[],"engine":"reglas"}"#
        XCTAssertThrowsError(try decodificar(json))
    }
}
