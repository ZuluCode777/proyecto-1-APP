import XCTest
@testable import TransMiVoz

/// Búsqueda, detalle y viaje: una sola petición vigente, entrada validada antes de enviar y la selección que llega al
/// cliente tal cual se eligió. El cliente de prueba no respeta la cancelación: modela un servidor que contesta tarde.
@MainActor
final class RutasModelosTests: XCTestCase {
    private let norte = "Estación Ejemplo Norte"
    private let sur = "Estación Ejemplo Sur"

    private func dejarCorrer() async { try? await Task.sleep(nanoseconds: 100_000_000) }

    private func busqueda() throws -> ResultadoBusquedaRutas { try decodificarPlanificador(FixturesPlanificador.buscar) }
    private func otraBusqueda() throws -> ResultadoBusquedaRutas { try decodificarPlanificador(FixturesPlanificador.buscarVacia) }

    // MARK: Búsqueda

    func testBuscarRecortaElTextoYMuestraElResultado() async throws {
        let cliente = ClientePlanificadorFalso()
        let modelo = BusquedaRutasModelo(cliente: cliente)
        modelo.texto = "  Z99 "
        modelo.buscar()
        XCTAssertEqual(modelo.estado, .cargando)
        await cliente.busquedas.esperar(1)
        XCTAssertEqual(cliente.busquedas.argumentos, ["Z99"])
        cliente.busquedas.responder(.success(try busqueda()))
        await dejarCorrer()
        XCTAssertEqual(modelo.estado, .listo(try busqueda()))
        XCTAssertEqual(modelo.ultimaConsulta, "Z99")
        XCTAssertNil(modelo.avisoEntrada)
    }

    func testUnTextoVacioODemasiadoLargoNoLlamaAlClienteYDiceQueHacer() async {
        let cliente = ClientePlanificadorFalso()
        let modelo = BusquedaRutasModelo(cliente: cliente)
        modelo.texto = "   "
        modelo.buscar()
        XCTAssertEqual(modelo.avisoEntrada, TextoRutas.entradaInvalida(.vacia))
        XCTAssertEqual(modelo.estado, .inactivo)

        modelo.texto = String(repeating: "a", count: EntradaPlanificador.maximoConsulta + 1)
        modelo.buscar()
        XCTAssertEqual(modelo.avisoEntrada, TextoRutas.entradaInvalida(.demasiadoLarga(maximo: EntradaPlanificador.maximoConsulta)))
        await dejarCorrer()
        XCTAssertTrue(cliente.busquedas.argumentos.isEmpty)
    }

    func testLaRespuestaTardiaDeUnaBusquedaReemplazadaSeDescarta() async throws {
        let cliente = ClientePlanificadorFalso()
        let modelo = BusquedaRutasModelo(cliente: cliente)
        modelo.texto = "uno"
        modelo.buscar()
        await cliente.busquedas.esperar(1)
        modelo.texto = "dos"
        modelo.buscar()
        await cliente.busquedas.esperar(2)

        cliente.busquedas.responder(.success(try otraBusqueda()), indice: 1)
        await dejarCorrer()
        cliente.busquedas.responder(.success(try busqueda()), indice: 0) // la primera llega DESPUÉS
        await dejarCorrer()
        XCTAssertEqual(modelo.estado, .listo(try otraBusqueda()), "gana la última búsqueda, no la última respuesta")
        XCTAssertEqual(modelo.ultimaConsulta, "dos")
    }

    func testUnErrorSeMuestraYReintentarRepiteLaMismaBusqueda() async throws {
        let cliente = ClientePlanificadorFalso()
        let modelo = BusquedaRutasModelo(cliente: cliente)
        modelo.texto = "Z99"
        modelo.buscar()
        await cliente.busquedas.esperar(1)
        cliente.busquedas.responder(.failure(ErrorConsulta.sinConexion))
        await dejarCorrer()
        XCTAssertEqual(modelo.estado, .fallo(.sinConexion))

        modelo.texto = "otra cosa"
        modelo.reintentar()
        await cliente.busquedas.esperar(2)
        XCTAssertEqual(cliente.busquedas.argumentos, ["Z99", "Z99"], "reintenta con el texto de la búsqueda enviada")
        XCTAssertEqual(modelo.texto, "Z99")
    }

    func testUnaConsultaInicialLlenaElCampo() {
        let modelo = BusquedaRutasModelo(cliente: ClientePlanificadorFalso(), consultaInicial: "Ricaurte")
        XCTAssertEqual(modelo.texto, "Ricaurte")
        XCTAssertEqual(modelo.estado, .inactivo)
    }

    // MARK: Detalle

    func testElDetalleSeCargaUnaVezYUnErrorDeCatalogoNoOfreceReintento() async throws {
        let cliente = ClientePlanificadorFalso()
        let modelo = DetalleRutaModelo(codigo: "Z99", cliente: cliente)
        modelo.cargarSiHaceFalta()
        modelo.cargarSiHaceFalta() // dos apariciones seguidas no repiten la petición
        await cliente.detalles.esperar(1)
        XCTAssertEqual(cliente.detalles.argumentos, ["Z99"])
        let detalle: DetalleRuta = try decodificarPlanificador(FixturesPlanificador.detalle)
        cliente.detalles.responder(.success(detalle))
        await dejarCorrer()
        XCTAssertEqual(modelo.estado, .listo(detalle))

        modelo.cargarSiHaceFalta() // al volver de otra pantalla conserva lo que ya tiene
        await dejarCorrer()
        XCTAssertEqual(cliente.detalles.argumentos.count, 1)

        let otro = DetalleRutaModelo(codigo: "NOEXISTE", cliente: cliente)
        otro.cargar()
        await cliente.detalles.esperar(2)
        cliente.detalles.responder(.failure(ErrorConsulta.noEncontrado), indice: 1)
        await dejarCorrer()
        XCTAssertEqual(otro.estado, .fallo(.noEncontrado))
    }

    // MARK: Viaje

    private func lugares() throws -> ListaLugares { try decodificarPlanificador(FixturesPlanificador.lugares) }

    func testElViajeNoSePuedePlanearHastaElegirOrigenYDestino() async throws {
        let cliente = ClientePlanificadorFalso()
        let modelo = ViajeModelo(cliente: cliente)
        modelo.cargarLugaresSiHaceFalta()
        await cliente.lugares.esperar(1)
        cliente.lugares.responder(.success(try lugares()))
        await dejarCorrer()
        XCTAssertEqual(modelo.lugares, .listo(try lugares()))

        XCTAssertFalse(modelo.puedePlanear)
        modelo.elegirOrigen(norte)
        XCTAssertFalse(modelo.puedePlanear)
        modelo.planear() // sin destino no hace nada
        await dejarCorrer()
        XCTAssertTrue(cliente.viajes.argumentos.isEmpty)

        modelo.elegirDestino(sur)
        XCTAssertTrue(modelo.puedePlanear)
    }

    func testElClienteRecibeLosDosLugaresElegidosTalCualYNoUnaFrase() async throws {
        let cliente = ClientePlanificadorFalso()
        let modelo = ViajeModelo(cliente: cliente)
        modelo.elegirOrigen(norte)
        modelo.elegirDestino(sur)
        modelo.planear()
        XCTAssertEqual(modelo.plan, .cargando)
        XCTAssertFalse(modelo.puedePlanear, "mientras planea no se envía otra petición")
        modelo.planear()
        await cliente.viajes.esperar(1)
        XCTAssertEqual(cliente.viajes.argumentos, ["\(norte)|\(sur)"], "una sola petición, con origen y destino separados")

        let viaje: PlanViaje = try decodificarPlanificador(FixturesPlanificador.viajeOperativo)
        cliente.viajes.responder(.success(viaje))
        await dejarCorrer()
        XCTAssertEqual(modelo.plan, .listo(viaje))
    }

    func testCambiarLaSeleccionDescartaElViajeYSuRespuestaTardia() async throws {
        let cliente = ClientePlanificadorFalso()
        let modelo = ViajeModelo(cliente: cliente)
        modelo.elegirOrigen(norte)
        modelo.elegirDestino(sur)
        modelo.planear()
        await cliente.viajes.esperar(1)

        modelo.elegirDestino("Estación Ejemplo Centro") // lo planeado ya no corresponde
        XCTAssertEqual(modelo.plan, .inactivo)
        cliente.viajes.responder(.success(try decodificarPlanificador(FixturesPlanificador.viajeOperativo)))
        await dejarCorrer()
        XCTAssertEqual(modelo.plan, .inactivo, "la respuesta del viaje anterior no pisa la selección nueva")

        modelo.planear()
        await cliente.viajes.esperar(2)
        XCTAssertEqual(cliente.viajes.argumentos.last, "\(norte)|Estación Ejemplo Centro")
    }

    func testUnLugarQueYaNoEstaEnElCatalogoSeDiceSinOfrecerReintento() async {
        let cliente = ClientePlanificadorFalso()
        let modelo = ViajeModelo(cliente: cliente)
        modelo.elegirOrigen(norte)
        modelo.elegirDestino(sur)
        modelo.planear()
        await cliente.viajes.esperar(1)
        cliente.viajes.responder(.failure(ErrorConsulta.noEncontrado))
        await dejarCorrer()
        XCTAssertEqual(modelo.plan, .fallo(.noEncontrado))
        XCTAssertFalse(ErrorConsulta.noEncontrado.admiteReintento)
    }

    func testLosLugaresQueFallanSePuedenVolverACargar() async throws {
        let cliente = ClientePlanificadorFalso()
        let modelo = ViajeModelo(cliente: cliente)
        modelo.cargarLugaresSiHaceFalta()
        await cliente.lugares.esperar(1)
        cliente.lugares.responder(.failure(ErrorConsulta.tiempoAgotado))
        await dejarCorrer()
        XCTAssertEqual(modelo.lugares, .fallo(.tiempoAgotado))

        modelo.cargarLugares()
        await cliente.lugares.esperar(2)
        cliente.lugares.responder(.success(try lugares()), indice: 1)
        await dejarCorrer()
        XCTAssertEqual(modelo.lugares, .listo(try lugares()))
    }
}
