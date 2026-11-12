import XCTest
@testable import TransMiVoz

/// Cliente cuyas respuestas controla la prueba. NO respeta la cancelación a
/// propósito: modela un servidor que responde tarde después de que la persona canceló.
final class ClienteControlable: ClienteAgente, @unchecked Sendable {
    private let candado = NSLock()
    private var pendientes: [CheckedContinuation<RespuestaAgente, Error>] = []
    private var textos: [String] = []

    var textosRecibidos: [String] { candado.lock(); defer { candado.unlock() }; return textos }

    func consultar(texto: String) async throws -> RespuestaAgente {
        try await withCheckedThrowingContinuation { continuacion in
            candado.lock()
            pendientes.append(continuacion)
            textos.append(texto)
            candado.unlock()
        }
    }

    /// Responde la consulta número `indice` (0 = la primera enviada).
    func responder(_ resultado: Result<RespuestaAgente, Error>, indice: Int = 0) {
        candado.lock()
        let continuacion = pendientes[indice]
        candado.unlock()
        continuacion.resume(with: resultado)
    }

    func esperarConsultas(_ cantidad: Int) async {
        for _ in 0..<500 where textosRecibidos.count < cantidad {
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
    }
}

@MainActor
final class ConsultaModeloTests: XCTestCase {
    private let respuesta = RespuestaAgente(texto: "Respuesta de prueba")

    private func dejarCorrer() async { try? await Task.sleep(nanoseconds: 100_000_000) }

    func testFlujoFeliz() async {
        let cliente = ClienteControlable()
        let modelo = ConsultaModelo(cliente: cliente)
        modelo.texto = "  horario Z99 "
        modelo.enviar()
        XCTAssertEqual(modelo.estado, .enviando)
        await cliente.esperarConsultas(1)
        XCTAssertEqual(cliente.textosRecibidos, ["horario Z99"])
        cliente.responder(.success(respuesta))
        await dejarCorrer()
        XCTAssertEqual(modelo.estado, .respuesta(respuesta))
    }

    func testEntradaVaciaNoLlamaAlCliente() async {
        let cliente = ClienteControlable()
        let modelo = ConsultaModelo(cliente: cliente)
        modelo.texto = "   "
        modelo.enviar()
        XCTAssertEqual(modelo.estado, .error(.entradaInvalida(.vacia)))
        await dejarCorrer()
        XCTAssertTrue(cliente.textosRecibidos.isEmpty)
    }

    func testRespuestaTardiaDeConsultaCanceladaSeDescarta() async {
        let cliente = ClienteControlable()
        let modelo = ConsultaModelo(cliente: cliente)
        modelo.texto = "horario Z99"
        modelo.enviar()
        await cliente.esperarConsultas(1)
        modelo.cancelar()
        XCTAssertEqual(modelo.estado, .cancelada)
        cliente.responder(.success(respuesta)) // llega DESPUÉS de cancelar
        await dejarCorrer()
        XCTAssertEqual(modelo.estado, .cancelada, "una respuesta tardía no debe aparecer")
    }

    func testErrorTardioDeConsultaCanceladaSeDescarta() async {
        let cliente = ClienteControlable()
        let modelo = ConsultaModelo(cliente: cliente)
        modelo.texto = "horario Z99"
        modelo.enviar()
        await cliente.esperarConsultas(1)
        modelo.cancelar()
        cliente.responder(.failure(ErrorConsulta.noAutorizado))
        await dejarCorrer()
        XCTAssertEqual(modelo.estado, .cancelada)
    }

    func testRespuestaDeConsultaReemplazadaSeDescarta() async {
        let cliente = ClienteControlable()
        let modelo = ConsultaModelo(cliente: cliente)
        modelo.texto = "primera"
        modelo.enviar()
        await cliente.esperarConsultas(1)
        modelo.texto = "segunda"
        modelo.enviar()
        await cliente.esperarConsultas(2)
        let vieja = RespuestaAgente(texto: "vieja")
        let nueva = RespuestaAgente(texto: "nueva")
        cliente.responder(.success(nueva), indice: 1)
        await dejarCorrer()
        cliente.responder(.success(vieja), indice: 0) // la primera llega al final
        await dejarCorrer()
        XCTAssertEqual(modelo.estado, .respuesta(nueva))
    }

    /// Regresión: con una consulta pendiente el campo sigue activo (`.onSubmit`);
    /// enviar vacío o demasiado largo no debe dejar que la respuesta vieja pise el error.
    func testEntradaInvalidaConConsultaPendienteInvalidaLaVieja() async {
        let casos: [(String, EstadoConsulta)] = [
            ("   ", .error(.entradaInvalida(.vacia))),
            (String(repeating: "a", count: EntradaConsulta.maximoCaracteres + 1),
             .error(.entradaInvalida(.demasiadoLarga(maximo: EntradaConsulta.maximoCaracteres)))),
        ]
        for (invalido, esperado) in casos {
            let cliente = ClienteControlable()
            let modelo = ConsultaModelo(cliente: cliente)
            modelo.texto = "horario Z99"
            modelo.enviar()
            await cliente.esperarConsultas(1)
            XCTAssertTrue(modelo.estaEnviando)

            modelo.texto = invalido
            modelo.enviar()
            XCTAssertEqual(modelo.estado, esperado)

            cliente.responder(.success(respuesta)) // la vieja llega DESPUÉS del error de validación
            await dejarCorrer()
            XCTAssertEqual(modelo.estado, esperado, "la respuesta vieja no debe reemplazar el error de validación")
            XCTAssertEqual(cliente.textosRecibidos, ["horario Z99"], "una entrada inválida no hace otra petición")
        }
    }

    func testErrorTardioDeConsultaPendienteTampocoPisaLaValidacion() async {
        let cliente = ClienteControlable()
        let modelo = ConsultaModelo(cliente: cliente)
        modelo.texto = "horario Z99"
        modelo.enviar()
        await cliente.esperarConsultas(1)
        modelo.texto = ""
        modelo.enviar()
        cliente.responder(.failure(ErrorConsulta.sinConexion))
        await dejarCorrer()
        XCTAssertEqual(modelo.estado, .error(.entradaInvalida(.vacia)))
    }

    /// Salir de la pantalla llama a `cancelar()`; una consulta nueva posterior no
    /// la afecta la respuesta tardía de la anterior.
    func testCancelarAlSalirYVolverAEnviarSoloAplicaLaNueva() async {
        let cliente = ClienteControlable()
        let modelo = ConsultaModelo(cliente: cliente)
        modelo.texto = "primera"
        modelo.enviar()
        await cliente.esperarConsultas(1)
        modelo.cancelar() // la vista dejó de verse
        XCTAssertEqual(modelo.estado, .cancelada)
        modelo.cancelar() // un segundo disappear no hace nada
        XCTAssertEqual(modelo.estado, .cancelada)

        modelo.texto = "segunda"
        modelo.enviar()
        await cliente.esperarConsultas(2)
        let nueva = RespuestaAgente(texto: "nueva")
        cliente.responder(.success(RespuestaAgente(texto: "vieja")), indice: 0)
        await dejarCorrer()
        XCTAssertEqual(modelo.estado, .enviando, "la respuesta vieja no completa la nueva consulta")
        cliente.responder(.success(nueva), indice: 1)
        await dejarCorrer()
        XCTAssertEqual(modelo.estado, .respuesta(nueva))
    }

    func testRespuestaConOrdenDeAbordajeSeSustituyePorAvisoSeguro() async {
        let cliente = ClienteControlable()
        let modelo = ConsultaModelo(cliente: cliente)
        modelo.texto = "cómo llego"
        modelo.enviar()
        await cliente.esperarConsultas(1)
        cliente.responder(.success(RespuestaAgente(
            texto: "Toma la H72 en Calle 127 y bájate en Portal Usme.",
            pasos: [PasoAgente(etiqueta: "Sube en Calle 127", detalle: nil)],
            accion: .busqueda(estacion: "Portal Usme"))))
        await dejarCorrer()
        XCTAssertEqual(modelo.estado, .respuesta(RespuestaAgente(texto: GuardiaContenido.avisoNoConfirmable)))
    }

    func testErroresDelClienteSeMuestranSinOcultarSuCausa() async {
        let casos: [ErrorConsulta] = [.sinConexion, .noAutorizado, .demasiadasPeticiones(reintentarEnSegundos: 7), .tiempoAgotado]
        for esperado in casos {
            let cliente = ClienteControlable()
            let modelo = ConsultaModelo(cliente: cliente)
            modelo.texto = "horario"
            modelo.enviar()
            await cliente.esperarConsultas(1)
            cliente.responder(.failure(esperado))
            await dejarCorrer()
            XCTAssertEqual(modelo.estado, .error(esperado))
        }
    }

    func testReintentarReenviaElMismoTextoLimpio() async {
        let cliente = ClienteControlable()
        let modelo = ConsultaModelo(cliente: cliente)
        modelo.texto = " horario "
        modelo.enviar()
        await cliente.esperarConsultas(1)
        cliente.responder(.failure(ErrorConsulta.sinConexion))
        await dejarCorrer()
        modelo.texto = "otra cosa sin enviar"
        modelo.reintentar()
        await cliente.esperarConsultas(2)
        XCTAssertEqual(cliente.textosRecibidos, ["horario", "horario"])
        XCTAssertEqual(modelo.estado, .enviando)
    }

    // MARK: EA-17: plazo vencido y escenario del Metro

    /// Servidor arrancando (simulado): el plazo vence, la pregunta se conserva y el reintento explícito responde.
    func testPlazoVencidoConservaLaPreguntaYElReintentoResponde() async {
        let cliente = ClienteControlable()
        let modelo = ConsultaModelo(cliente: cliente)
        modelo.texto = "horario Z99"
        modelo.enviar()
        await cliente.esperarConsultas(1)
        cliente.responder(.failure(ErrorConsulta.tiempoAgotado))
        await dejarCorrer()
        XCTAssertEqual(modelo.estado, .error(.tiempoAgotado))
        XCTAssertTrue(ErrorConsulta.tiempoAgotado.admiteReintento)
        XCTAssertEqual(modelo.texto, "horario Z99", "la pregunta sigue en el campo")
        XCTAssertEqual(cliente.textosRecibidos, ["horario Z99"], "sin reintentos automáticos")

        modelo.reintentar()
        await cliente.esperarConsultas(2)
        XCTAssertEqual(cliente.textosRecibidos, ["horario Z99", "horario Z99"])
        cliente.responder(.success(respuesta), indice: 1)
        await dejarCorrer()
        XCTAssertEqual(modelo.estado, .respuesta(respuesta))
    }

    func testEscenarioMetroAnteponeSuContextoYRotulaElResultado() async {
        let cliente = ClienteControlable()
        let modelo = ConsultaModelo(cliente: cliente)
        XCTAssertEqual(modelo.escenarioEnviado, .transporte)
        modelo.escenario = .metroFuturo
        modelo.texto = " estaciones "
        modelo.enviar()
        await cliente.esperarConsultas(1)
        XCTAssertEqual(cliente.textosRecibidos, ["Metro: estaciones"])
        XCTAssertEqual(modelo.escenarioEnviado, .metroFuturo)
        XCTAssertEqual(modelo.ultimoTextoEnviado, "estaciones", "el contexto no se mezcla con lo que escribió la persona")
        cliente.responder(.success(respuesta))
        await dejarCorrer()
        XCTAssertEqual(modelo.estado, .respuesta(respuesta))
    }

    /// El resultado y el reintento son del escenario en que se preguntó, no del elegido después.
    func testReintentarConservaElEscenarioDeLaPregunta() async {
        let cliente = ClienteControlable()
        let modelo = ConsultaModelo(cliente: cliente)
        modelo.escenario = .metroFuturo
        modelo.texto = "línea 1"
        modelo.enviar()
        await cliente.esperarConsultas(1)
        cliente.responder(.failure(ErrorConsulta.sinConexion))
        await dejarCorrer()
        modelo.escenario = .transporte
        XCTAssertEqual(modelo.escenarioEnviado, .metroFuturo)

        modelo.reintentar()
        await cliente.esperarConsultas(2)
        XCTAssertEqual(cliente.textosRecibidos, ["Metro: línea 1", "Metro: línea 1"])
        XCTAssertEqual(modelo.escenario, .metroFuturo)
        cliente.responder(.success(respuesta), indice: 1)
    }

    /// Nunca se presenta como Metro una ruta, una estación o un viaje de TransMilenio.
    func testEscenarioMetroRechazaUnaAccionDeTransporte() async {
        let tramo = TramoViaje(codigoRuta: "Z99", estacionAbordaje: "A", estacionDescenso: "B", estacionesRecorridas: 3, conteoVerificado: true)
        for accion: AccionAgente in [.viaje([tramo]), .ruta(codigo: "Z99"), .busqueda(estacion: "A"), .gps, .frecuentes] {
            let cliente = ClienteControlable()
            let modelo = ConsultaModelo(cliente: cliente)
            modelo.escenario = .metroFuturo
            modelo.texto = "calle 72"
            modelo.enviar()
            await cliente.esperarConsultas(1)
            cliente.responder(.success(RespuestaAgente(texto: "Respuesta de transporte", accion: accion)))
            await dejarCorrer()
            XCTAssertEqual(modelo.estado, .error(.respuestaIncompatible), "\(accion)")
        }
    }

    func testEscenarioMetroDescuentaSuContextoDelMaximo() async {
        let cliente = ClienteControlable()
        let modelo = ConsultaModelo(cliente: cliente)
        modelo.escenario = .metroFuturo
        let maximo = EscenarioConsulta.metroFuturo.maximoCaracteres
        XCTAssertEqual(maximo, 293)
        XCTAssertEqual(EscenarioConsulta.transporte.maximoCaracteres, EntradaConsulta.maximoCaracteres)

        modelo.texto = String(repeating: "a", count: maximo + 1)
        modelo.enviar()
        XCTAssertEqual(modelo.estado, .error(.entradaInvalida(.demasiadoLarga(maximo: maximo))))

        modelo.texto = String(repeating: "a", count: maximo)
        modelo.enviar()
        await cliente.esperarConsultas(1)
        XCTAssertEqual(cliente.textosRecibidos.first?.utf16.count, EntradaConsulta.maximoCaracteres, "con su contexto, cabe justo en el límite del servidor")
        cliente.responder(.success(respuesta))
    }

    /// Vocabulario de `CONTEXT.md`: el Metro es un escenario educativo de infraestructura futura, sin servicio, y nunca
    /// una «línea», un viaje operativo ni una ruta disponible.
    func testLosTextosDelEscenarioMetroDicenEducativoFuturoYSinServicio() {
        let metro = EscenarioConsulta.metroFuturo
        let aviso = metro.avisoResultado ?? ""
        let textos = [
            metro.introduccion, metro.etiquetaCampo, metro.pistaSelector, metro.anuncioAlElegir, metro.tituloResultado,
            aviso, metro.anuncioResultado ?? "",
        ]
        for texto in textos {
            XCTAssertFalse(texto.lowercased().contains("línea"), texto)
            XCTAssertFalse(texto.lowercased().contains("linea"), texto)
        }
        for texto in [metro.introduccion, metro.anuncioAlElegir] {
            XCTAssertTrue(texto.contains("educativo"), texto)
            XCTAssertTrue(texto.contains("futura"), texto)
            XCTAssertTrue(texto.contains("sin servicio comercial"), texto)
        }
        XCTAssertTrue(aviso.contains("educativa") && aviso.contains("sin servicio comercial"), aviso)
        XCTAssertNotNil(metro.anuncioResultado)
        XCTAssertNil(EscenarioConsulta.transporte.avisoResultado)
        XCTAssertNil(EscenarioConsulta.transporte.anuncioResultado)
        XCTAssertEqual(EscenarioConsulta.transporte.valorSelector, "desactivado")
        XCTAssertEqual(metro.valorSelector, "activado")
    }

    func testCancelarSinConsultaEnCursoNoHaceNada() async {
        let modelo = ConsultaModelo(cliente: ClienteControlable())
        modelo.cancelar()
        XCTAssertEqual(modelo.estado, .inactiva)
    }

    func testMensajesYRecuperacionNoVaciosParaTodoError() async {
        let todos: [ErrorConsulta] = [
            .entradaInvalida(.vacia), .entradaInvalida(.demasiadoLarga(maximo: 300)), .servidorNoConfigurado,
            .noAutorizado, .servicioNoDisponible, .demasiadasPeticiones(reintentarEnSegundos: nil),
            .demasiadasPeticiones(reintentarEnSegundos: 5), .mensajeRechazadoPorLargo, .peticionRechazada,
            .sinConexion, .tiempoAgotado, .conexionNoSegura, .redireccionNoPermitida,
            .errorDelServidor(estado: 500), .respuestaIncompatible, .cancelada,
        ]
        for error in todos {
            XCTAssertFalse(error.mensaje.isEmpty)
            XCTAssertFalse(error.recuperacion.isEmpty)
        }
        XCTAssertTrue(ErrorConsulta.sinConexion.admiteReintento)
        XCTAssertFalse(ErrorConsulta.noAutorizado.admiteReintento)
    }
}
