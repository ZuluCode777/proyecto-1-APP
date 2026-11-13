import XCTest
@testable import TransMiVoz

/// Contrato de `POST /api/planificador`: decodificación estricta, coherencia de cada estado y rechazo de lo que no
/// es del contrato. Los fixtures son inventados (`FixturesPlanificador`); `lib/ea25-planificador.test.ts` comprueba
/// que cumplen los esquemas del servidor.
final class RespuestaPlanificadorTests: XCTestCase {
    private let norte = "Estación Ejemplo Norte"
    private let centro = "Estación Ejemplo Centro"
    private let sur = "Estación Ejemplo Sur"

    private func esperarRechazo<Respuesta: RespuestaPlanificador>(
        _ tipo: Respuesta.Type, _ json: String, _ motivo: String, file: StaticString = #filePath, line: UInt = #line
    ) {
        do {
            let _: Respuesta = try decodificarPlanificador(json)
            XCTFail("se esperaba rechazo: \(motivo)", file: file, line: line)
        } catch {
            XCTAssertEqual(error as? ErrorConsulta, .respuestaIncompatible, motivo, file: file, line: line)
        }
    }

    // MARK: Decodificación

    func testBusquedaSeDecodificaConSuProcedencia() throws {
        let r: ResultadoBusquedaRutas = try decodificarPlanificador(FixturesPlanificador.buscar)
        XCTAssertEqual(r.rutas.map(\.codigo), ["Z99", "Z98"])
        XCTAssertEqual(r.rutas[0].desde, norte)
        XCTAssertEqual(r.total, 2)
        XCTAssertFalse(r.catalogo.antiguo)
    }

    func testBusquedaTruncadaConservaElTotalYLaAntiguedad() throws {
        let r: ResultadoBusquedaRutas = try decodificarPlanificador(FixturesPlanificador.buscarTruncada)
        XCTAssertEqual(r.rutas.count, 2)
        XCTAssertEqual(r.total, 63)
        XCTAssertTrue(r.catalogo.antiguo)
        let vacia: ResultadoBusquedaRutas = try decodificarPlanificador(FixturesPlanificador.buscarVacia)
        XCTAssertTrue(vacia.rutas.isEmpty)
    }

    func testDetalleTraeLosEstadosDelServidorYSusCoordenadas() throws {
        let d: DetalleRuta = try decodificarPlanificador(FixturesPlanificador.detalle)
        XCTAssertEqual(d.sentido, .confirmado)
        XCTAssertEqual(d.calendario, .opera)
        XCTAssertEqual(d.estaciones.map(\.nombre), [norte, centro, sur])
        XCTAssertTrue(d.estaciones.allSatisfy(\.paradaVerificada))
        XCTAssertEqual(d.estaciones[0].coordenada, Coordenada(latitud: 4.7, longitud: -74.08))
        XCTAssertEqual(d.trazado.count, 3)
        XCTAssertEqual(d.horario.entreSemana, "5:00 a. m. - 11:00 p. m.")
        XCTAssertEqual(d.horario.festivo, "")
    }

    func testDetalleSinVerificarYUnaEstacionSinCoordenada() throws {
        let d: DetalleRuta = try decodificarPlanificador(FixturesPlanificador.detalleSinVerificar)
        XCTAssertEqual(d.sentido, .sinConfirmar)
        XCTAssertEqual(d.calendario, .sinVerificar)
        XCTAssertTrue(d.estaciones.allSatisfy { !$0.paradaVerificada })
        XCTAssertNil(d.estaciones[1].coordenada, "una coordenada nula se conserva como ausente, no se inventa")
    }

    func testLugaresSeDecodifican() throws {
        let l: ListaLugares = try decodificarPlanificador(FixturesPlanificador.lugares)
        XCTAssertEqual(l.lugares, [centro, norte, sur])
    }

    func testCadaEstadoDelViajeSeDecodificaConSusDatos() throws {
        let operativo: PlanViaje = try decodificarPlanificador(FixturesPlanificador.viajeOperativo)
        XCTAssertEqual(operativo.resultado, .operativo)
        XCTAssertEqual(operativo.tramos.count, 1)
        XCTAssertEqual(operativo.tramos[0].abordaje.nombre, norte)
        XCTAssertEqual(operativo.tramos[0].descenso.coordenada, Coordenada(latitud: 4.6, longitud: -74.09))
        XCTAssertTrue(operativo.tramos[0].conteoVerificado)

        let transbordo: PlanViaje = try decodificarPlanificador(FixturesPlanificador.viajeTransbordo)
        XCTAssertEqual(transbordo.tramos.map(\.codigoRuta), ["Z99", "Z98"])
        XCTAssertEqual(transbordo.tramos[0].descenso.nombre, transbordo.tramos[1].abordaje.nombre)

        let candidato: PlanViaje = try decodificarPlanificador(FixturesPlanificador.viajeCandidato)
        XCTAssertEqual(candidato.resultado, .candidato)
        XCTAssertFalse(candidato.tramos[0].conteoVerificado)

        let recorrido: PlanViaje = try decodificarPlanificador(FixturesPlanificador.viajeRecorrido)
        XCTAssertEqual(recorrido.resultado, .recorrido)
        XCTAssertTrue(recorrido.tramos.isEmpty)
        XCTAssertEqual(recorrido.rutasPorElTrazado.map(\.codigo), ["Z98"])

        let sinRecorrido: PlanViaje = try decodificarPlanificador(FixturesPlanificador.viajeSinRecorrido)
        XCTAssertEqual(sinRecorrido.resultado, .sinRecorrido)
        let mismo: PlanViaje = try decodificarPlanificador(FixturesPlanificador.viajeMismoLugar)
        XCTAssertEqual(mismo.resultado, .mismoLugar)
    }

    // MARK: Rechazos

    func testLoQueNoEsDelContratoSeRechazaComoIncompatible() {
        esperarRechazo(DetalleRuta.self, FixturesPlanificador.detalleLatitudInvalida, "latitud fuera de rango")
        esperarRechazo(DetalleRuta.self, FixturesPlanificador.detalleSentidoDesconocido, "sentido desconocido")
        esperarRechazo(DetalleRuta.self, FixturesPlanificador.detalleSinCatalogo, "sin procedencia")
        esperarRechazo(DetalleRuta.self, FixturesPlanificador.detalleProcedenciaVacia, "procedencia vacía")
        esperarRechazo(ResultadoBusquedaRutas.self, FixturesPlanificador.buscarTotalMenorQueRutas, "total menor que las rutas")
        esperarRechazo(ResultadoBusquedaRutas.self, FixturesPlanificador.buscarRutaSinCodigo, "ruta sin código")
        esperarRechazo(ListaLugares.self, FixturesPlanificador.lugaresRepetidos, "lugares repetidos")
        esperarRechazo(PlanViaje.self, FixturesPlanificador.viajeResultadoDesconocido, "resultado desconocido")
        esperarRechazo(PlanViaje.self, "no es json", "no es JSON")
    }

    func testUnEstadoDelViajeSoloVieneConLosDatosQueLeCorresponden() {
        esperarRechazo(PlanViaje.self, FixturesPlanificador.viajeOperativoSinTramos, "operativo sin tramos")
        esperarRechazo(PlanViaje.self, FixturesPlanificador.viajeRecorridoSinRutas, "recorrido sin rutas")
        esperarRechazo(PlanViaje.self, FixturesPlanificador.viajeMismoLugarConTramos, "mismo lugar con tramos")
        esperarRechazo(PlanViaje.self, FixturesPlanificador.viajeConTresTramos, "más de un transbordo")
        esperarRechazo(PlanViaje.self, FixturesPlanificador.viajeEstacionesNegativas, "estaciones negativas")
    }

    func testLasCoordenadasSeValidanAlDecodificar() {
        func decodificar(_ lat: String, _ lng: String) -> Coordenada? {
            try? JSONDecoder().decode(Coordenada.self, from: Data(#"{"lat":\#(lat),"lng":\#(lng)}"#.utf8))
        }
        XCTAssertNotNil(decodificar("4.6", "-74.08"))
        XCTAssertNotNil(decodificar("-90", "180"))
        XCTAssertNil(decodificar("90.1", "0"))
        XCTAssertNil(decodificar("0", "-180.5"))
    }

    // MARK: Mapa y listado del mismo tramo

    func testElMapaDelViajeDibujaLasMismasParadasYTramosQueElListado() throws {
        let plan: PlanViaje = try decodificarPlanificador(FixturesPlanificador.viajeTransbordo)
        let mapa = ElementosMapa.de(tramos: plan.tramos)

        // El listado nombra abordaje del primer tramo y el descenso de cada uno; el mapa marca esas mismas paradas.
        let nombresDelListado = [plan.tramos[0].abordaje.nombre] + plan.tramos.map(\.descenso.nombre)
        XCTAssertEqual(nombresDelListado, [norte, centro, sur])
        XCTAssertEqual(mapa.marcas.map(\.titulo), nombresDelListado)
        XCTAssertEqual(mapa.lineas, plan.tramos.map(\.trazado), "una línea por tramo, la misma que el servidor entregó")
        for tramo in plan.tramos {
            XCTAssertTrue(TextoRutas.filasTramo(tramo, resultado: .operativo).contains("Abordaje: \(tramo.abordaje.nombre)"))
        }
        XCTAssertFalse(mapa.estaVacio)
    }

    func testElMapaDeUnaRutaMarcaSoloLasEstacionesConCoordenadaYElListadoLasNombraTodas() throws {
        let detalle: DetalleRuta = try decodificarPlanificador(FixturesPlanificador.detalleSinVerificar)
        let mapa = ElementosMapa.de(detalle: detalle)
        XCTAssertEqual(detalle.estaciones.count, 3)
        XCTAssertEqual(mapa.marcas.map(\.titulo), [norte, sur], "la estación sin coordenada no se dibuja ni se sustituye")
        XCTAssertEqual(mapa.lineas, [detalle.trazado])
    }

    func testSinCoordenadasElMapaQuedaVacio() {
        XCTAssertTrue(ElementosMapa.de(tramos: []).estaVacio)
        let sinPunto = TramoPlan(
            codigoRuta: "Z99", abordaje: ParadaViaje(nombre: norte, coordenada: nil),
            descenso: ParadaViaje(nombre: sur, coordenada: nil), estacionesRecorridas: 3, conteoVerificado: false, trazado: [])
        XCTAssertTrue(ElementosMapa.de(tramos: [sinPunto]).estaVacio)
        XCTAssertEqual(ElementosMapa.de(tramos: [sinPunto]).coordenadas, [])
    }

    func testElEncuadreCubreLosPuntosConMargenYTamanoMinimo() throws {
        XCTAssertNil(EncuadreMapa.ajustar([]))

        let uno = try XCTUnwrap(EncuadreMapa.ajustar([Coordenada(latitud: 4.6, longitud: -74.08)]))
        XCTAssertEqual(uno.latitudCentro, 4.6, accuracy: 1e-9)
        XCTAssertEqual(uno.deltaLatitud, EncuadreMapa.deltaMinimo, accuracy: 1e-9)
        XCTAssertEqual(uno.deltaLongitud, EncuadreMapa.deltaMinimo, accuracy: 1e-9)

        let dos = try XCTUnwrap(EncuadreMapa.ajustar([
            Coordenada(latitud: 4.60, longitud: -74.10), Coordenada(latitud: 4.70, longitud: -74.00),
        ]))
        XCTAssertEqual(dos.latitudCentro, 4.65, accuracy: 1e-9)
        XCTAssertEqual(dos.longitudCentro, -74.05, accuracy: 1e-9)
        XCTAssertEqual(dos.deltaLatitud, 0.10 * EncuadreMapa.margen, accuracy: 1e-9)
        XCTAssertEqual(dos.deltaLongitud, 0.10 * EncuadreMapa.margen, accuracy: 1e-9)
    }
}
