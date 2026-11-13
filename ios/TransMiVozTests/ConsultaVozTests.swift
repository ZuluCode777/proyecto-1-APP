import XCTest
@testable import TransMiVoz

/// La consulta con voz (EA-19): la respuesta a una pregunta dictada se lee por la misma `ControlVoz` que los avisos del
/// accesorio, y cancelar o salir invalida captura, solicitud y habla. Reconocedor y salida de voz son dobles: no prueban el
/// micrófono, la síntesis, los auriculares ni VoiceOver.
@MainActor
final class ConsultaVozTests: XCTestCase {
    @MainActor private struct Banco {
        let cliente = ClienteControlable()
        let salida = SalidaVozFalsa()
        let voz: ControlVoz
        let reconocedor = ReconocedorFalso()
        let dictado: DictadoModelo
        let modelo: ConsultaModelo
        let avisos = AvisosFalsos()

        init(ruta: RutaAudio = .privada) {
            voz = ControlVoz(salida: salida, consultarRuta: { ruta })
            dictado = DictadoModelo(reconocedor: reconocedor, voz: voz, avisos: avisos.avisos)
            modelo = ConsultaModelo(cliente: cliente, dictado: dictado, voz: voz)
        }

        /// La persona dicta una frase y la termina: el texto queda en el campo.
        func dictar(_ frase: String) {
            dictado.alternar()
            reconocedor.emitir(.escuchando)
            dictado.alternar()
            reconocedor.emitir(.terminado(frase))
        }
    }

    private let respuesta = RespuestaAgente(texto: "Respuesta de prueba")

    private func dejarCorrer() async { try? await Task.sleep(nanoseconds: 100_000_000) }

    /// Dicta «hola», envía y responde: queda la respuesta leída en voz alta (con ruta privada).
    private func conRespuestaHablada(_ banco: Banco) async {
        banco.dictar("hola")
        banco.modelo.enviar()
        await banco.cliente.esperarConsultas(1)
        banco.cliente.responder(.success(respuesta))
        await dejarCorrer()
    }

    // MARK: La respuesta hablada

    func testUnaPreguntaDictadaSeContestaTambienEnVozAlta() async {
        let banco = Banco()
        banco.dictar("hola")
        XCTAssertEqual(banco.modelo.texto, "hola")
        banco.modelo.enviar()
        await banco.cliente.esperarConsultas(1)
        banco.cliente.responder(.success(respuesta))
        await dejarCorrer()
        XCTAssertEqual(banco.modelo.estado, .respuesta(respuesta))
        XCTAssertEqual(banco.salida.dicho, ["Respuesta de prueba"])
    }

    func testUnaPreguntaEscritaNoSeLee() async {
        let banco = Banco()
        banco.modelo.texto = "hola"
        banco.modelo.enviar()
        await banco.cliente.esperarConsultas(1)
        banco.cliente.responder(.success(respuesta))
        await dejarCorrer()
        XCTAssertEqual(banco.modelo.estado, .respuesta(respuesta))
        XCTAssertTrue(banco.salida.dicho.isEmpty)
    }

    func testUnaPreguntaDictadaYLuegoEditadaNoSeLee() async {
        let banco = Banco()
        banco.dictar("hola")
        banco.modelo.editarTexto("hola de nuevo")
        banco.modelo.enviar()
        await banco.cliente.esperarConsultas(1)
        banco.cliente.responder(.success(respuesta))
        await dejarCorrer()
        XCTAssertTrue(banco.salida.dicho.isEmpty)
    }

    func testUnaPreguntaDictadaEditadaYRestauradaTampocoSeLee() async {
        let banco = Banco()
        banco.dictar("hola")
        banco.modelo.editarTexto("hola de nuevo")
        banco.modelo.editarTexto("hola")  // el campo vuelve a decir lo dictado, pero la persona lo tocó
        banco.modelo.enviar()
        await banco.cliente.esperarConsultas(1)
        banco.cliente.responder(.success(respuesta))
        await dejarCorrer()
        XCTAssertTrue(banco.salida.dicho.isEmpty)
    }

    func testEnviarOlvidaLoDictadoYElMismoTextoEnviadoOtraVezNoSeLee() async {
        let banco = Banco()
        await conRespuestaHablada(banco)
        XCTAssertEqual(banco.salida.dicho, ["Respuesta de prueba"])
        XCTAssertNil(banco.dictado.ultimoDictado)
        banco.modelo.enviar()  // «hola» sigue en el campo, pero ya no es una pregunta recién dictada
        await banco.cliente.esperarConsultas(2)
        banco.cliente.responder(.success(respuesta), indice: 1)
        await dejarCorrer()
        XCTAssertEqual(banco.salida.dicho, ["Respuesta de prueba"], "no se vuelve a leer")
    }

    func testReintentarNoLeeUnaPreguntaQueNoSeDicto() async {
        let banco = Banco()
        banco.modelo.texto = "primera"
        banco.modelo.enviar()
        await banco.cliente.esperarConsultas(1)
        banco.cliente.responder(.failure(ErrorConsulta.sinConexion))
        await dejarCorrer()
        banco.dictar("otra cosa")  // queda dictada en el campo, sin enviar
        banco.modelo.reintentar()  // repite «primera», que se escribió
        await banco.cliente.esperarConsultas(2)
        XCTAssertEqual(banco.cliente.textosRecibidos.last, "primera")
        banco.cliente.responder(.success(respuesta), indice: 1)
        await dejarCorrer()
        XCTAssertTrue(banco.salida.dicho.isEmpty)
    }

    // MARK: Lo que se lee lleva el límite de la acción

    func testLaRespuestaHabladaLlevaElLimiteDeCadaAccion() {
        let acciones: [(AccionAgente, String)] = [
            (.gps, "Voy a abrir el GPS auditivo."), (.frecuentes, "Abro tus rutas frecuentes."),
            (.busqueda(estacion: "Ricaurte"), "Busco la estación Ricaurte."), (.ruta(codigo: "B23"), "Abro la ruta B23."),
        ]
        for (accion, texto) in acciones {
            let hablado = RespuestaAgente(texto: texto, accion: accion).textoHablado
            XCTAssertEqual(hablado, "\(texto) \(accion.limite ?? "")", "\(accion)")
        }
        XCTAssertEqual(RespuestaAgente(texto: "Sin acción.", accion: .ninguna).textoHablado, "Sin acción.", "sin límite no se agrega nada")
    }

    func testUnaRespuestaGpsDictadaSeLeeConSuLimite() async {
        let banco = Banco()
        banco.dictar("hola")
        banco.modelo.enviar()
        await banco.cliente.esperarConsultas(1)
        banco.cliente.responder(.success(RespuestaAgente(texto: "Voy a abrir el GPS auditivo.", accion: .gps)))
        await dejarCorrer()
        let dicho = banco.salida.dicho.joined(separator: " ")
        XCTAssertTrue(dicho.contains("Voy a abrir el GPS auditivo."), dicho)
        XCTAssertTrue(dicho.contains(AccionAgente.gps.limite ?? "?"), "lo que se oye no promete lo que la app no hace: \(dicho)")
    }

    func testSinAuricularesLaRespuestaSeMuestraPeroNoSuena() async {
        let banco = Banco(ruta: .noPrivada)
        await conRespuestaHablada(banco)
        XCTAssertEqual(banco.modelo.estado, .respuesta(respuesta))
        XCTAssertTrue(banco.salida.dicho.isEmpty, "la voz de la app solo habla por una ruta privada")
    }

    func testLaRespuestaDeUnViajeLeeElAvisoDeLaAppYNoElTextoDelServidor() async {
        let banco = Banco()
        banco.dictar("hola")
        banco.modelo.enviar()
        await banco.cliente.esperarConsultas(1)
        let tramo = TramoViaje(
            codigoRuta: "Z99", estacionAbordaje: "Estación Ejemplo Norte", estacionDescenso: "Estación Ejemplo Sur",
            estacionesRecorridas: 3, conteoVerificado: false)
        banco.cliente.responder(.success(RespuestaAgente(texto: "Toma la Z99 en Estación Ejemplo Norte.", accion: .viaje([tramo]))))
        await dejarCorrer()
        let dicho = banco.salida.dicho.joined(separator: " ")
        XCTAssertTrue(dicho.contains("no da órdenes de abordaje"), dicho)
        XCTAssertFalse(dicho.contains("Toma la"), dicho)
    }

    func testEnElEscenarioMetroLaVozDiceQueEsInfraestructuraFutura() async {
        let banco = Banco()
        banco.dictar("hola")
        banco.modelo.escenario = .metroFuturo
        banco.modelo.enviar()
        await banco.cliente.esperarConsultas(1)
        banco.cliente.responder(.success(respuesta))
        await dejarCorrer()
        XCTAssertEqual(banco.salida.dicho, ["Escenario Metro: infraestructura futura, sin servicio comercial. Respuesta de prueba"])
    }

    func testTextoHabladoNoRepiteLaProcedenciaQueElTextoYaTrae() {
        let procedencia = ProcedenciaCatalogo(procedencia: "Datos de prueba.", antiguo: false)
        XCTAssertEqual(
            RespuestaAgente(texto: "La ruta Z99 es de prueba. Datos de prueba.", catalogo: procedencia).textoHablado,
            "La ruta Z99 es de prueba. Datos de prueba.")
        XCTAssertEqual(
            RespuestaAgente(texto: "La ruta Z99 es de prueba.", catalogo: procedencia).textoHablado,
            "La ruta Z99 es de prueba. Datos de prueba.")
        let antiguo = ProcedenciaCatalogo(procedencia: "Datos de prueba.", antiguo: true)
        XCTAssertTrue(RespuestaAgente(texto: "Z99. Datos de prueba.", catalogo: antiguo).textoHablado.hasSuffix("son antiguos."))
    }

    // MARK: Captura y voz no se realimentan

    func testNoSeHablaConLaCapturaAbierta() async {
        let banco = Banco()
        banco.dictar("hola")
        banco.modelo.enviar()
        await banco.cliente.esperarConsultas(1)
        banco.dictado.alternar()  // la persona empieza a dictar otra pregunta antes de que llegue la respuesta
        banco.reconocedor.emitir(.escuchando)
        XCTAssertEqual(banco.dictado.estado, .escuchando)
        banco.cliente.responder(.success(respuesta))
        await dejarCorrer()
        XCTAssertEqual(banco.modelo.estado, .respuesta(respuesta), "la respuesta se muestra")
        XCTAssertTrue(banco.salida.dicho.isEmpty, "pero no suena sobre el micrófono abierto")
        XCTAssertEqual(banco.dictado.estado, .escuchando, "y la captura sigue")
    }

    func testEmpezarADictarCortaLaRespuestaQueSuena() async {
        let banco = Banco()
        await conRespuestaHablada(banco)
        XCTAssertTrue(banco.salida.hablando)
        banco.dictado.alternar()
        XCTAssertFalse(banco.salida.hablando, "no se captura con la respuesta sonando")
        XCTAssertEqual(banco.dictado.estado, .iniciando)
    }

    func testEmpezarADictarNoCortaUnAvisoQueSuena() async {
        let banco = Banco()
        await conRespuestaHablada(banco)
        XCTAssertEqual(banco.voz.anunciar("aviso de proximidad"), .hablado)  // la cola de uno cortó la respuesta
        let cortes = banco.salida.cortes
        banco.dictado.alternar()
        XCTAssertEqual(banco.dictado.estado, .vozOcupada, "el micrófono no se abre sobre un aviso")
        XCTAssertEqual(banco.reconocedor.veces("iniciar"), 0)
        XCTAssertTrue(banco.salida.hablando, "el aviso sigue sonando")
        XCTAssertEqual(banco.salida.cortes, cortes)
        XCTAssertEqual(banco.salida.dicho, ["Respuesta de prueba", "aviso de proximidad"])
    }

    func testTrasLosPermisosUnaRespuestaPropiaSonandoSeCortaAntesDelMicrofono() async {
        let banco = Banco()
        await conRespuestaHablada(banco)
        banco.reconocedor.permiso = .porPreguntar  // un permiso que se revocó entre tanto
        banco.dictado.alternar()
        XCTAssertEqual(banco.dictado.estado, .pidiendoPermisos)
        XCTAssertTrue(banco.salida.hablando, "mientras esperan los avisos del sistema la respuesta sigue sonando")
        var hablandoAlAbrirElMicrofono: Bool?
        banco.reconocedor.alIniciar = { hablandoAlAbrirElMicrofono = banco.salida.hablando }
        banco.reconocedor.responderPermisos(.concedido)
        XCTAssertEqual(banco.dictado.estado, .iniciando)
        XCTAssertEqual(hablandoAlAbrirElMicrofono, false)
    }

    func testTrasLosPermisosUnAvisoSonandoImpideAbrirElMicrofono() async {
        let banco = Banco()
        banco.reconocedor.permiso = .porPreguntar
        banco.dictado.alternar()
        XCTAssertEqual(banco.voz.anunciar("aviso de proximidad"), .hablado)
        let cortes = banco.salida.cortes
        banco.reconocedor.responderPermisos(.concedido)
        XCTAssertEqual(banco.dictado.estado, .vozOcupada)
        XCTAssertEqual(banco.reconocedor.veces("iniciar"), 0)
        XCTAssertTrue(banco.salida.hablando)
        XCTAssertEqual(banco.salida.cortes, cortes)
    }

    func testUnAvisoSonandoNoSeCortaPorLaRespuestaDeLaConsulta() async {
        let banco = Banco()
        banco.dictar("hola")
        banco.modelo.enviar()
        await banco.cliente.esperarConsultas(1)
        XCTAssertEqual(banco.voz.anunciar("aviso de proximidad"), .hablado)
        let cortes = banco.salida.cortes
        banco.cliente.responder(.success(respuesta))
        await dejarCorrer()
        XCTAssertEqual(banco.modelo.estado, .respuesta(respuesta), "la pantalla sí muestra la respuesta")
        XCTAssertEqual(banco.salida.dicho, ["aviso de proximidad"], "pero no se lee encima del aviso")
        XCTAssertTrue(banco.salida.hablando, "el aviso sigue sonando")
        XCTAssertEqual(banco.salida.cortes, cortes)
    }

    func testLaRespuestaSeLeeCuandoElAvisoYaTermino() async {
        let banco = Banco()
        banco.dictar("hola")
        banco.modelo.enviar()
        await banco.cliente.esperarConsultas(1)
        XCTAssertEqual(banco.voz.anunciar("aviso de proximidad"), .hablado)
        banco.salida.terminarSola()
        banco.cliente.responder(.success(respuesta))
        await dejarCorrer()
        XCTAssertEqual(banco.salida.dicho, ["aviso de proximidad", "Respuesta de prueba"])
    }

    // MARK: Enviar con el micrófono abierto

    func testEnviarConElMicrofonoAbiertoTerminaLaCapturaYConservaElTextoParcial() async {
        let banco = Banco()
        banco.dictado.alternar()
        banco.reconocedor.emitir(.escuchando)
        banco.reconocedor.emitir(.parcial("salgo desde Ricaurte"))
        XCTAssertEqual(banco.modelo.texto, "salgo desde Ricaurte")

        banco.modelo.enviar()
        XCTAssertEqual(banco.reconocedor.veces("cancelar"), 1, "«Enviar» suelta el micrófono")
        XCTAssertEqual(banco.dictado.estado, .inactivo)
        await banco.cliente.esperarConsultas(1)
        XCTAssertEqual(banco.cliente.textosRecibidos, ["salgo desde Ricaurte"], "se envía lo que había en el campo")

        banco.reconocedor.emitir(.terminado("algo que llega tarde"))
        banco.reconocedor.emitir(.parcial("y esto también"))
        XCTAssertEqual(banco.modelo.texto, "salgo desde Ricaurte", "lo tardío no pisa el campo")
        banco.cliente.responder(.success(respuesta))
        await dejarCorrer()
        XCTAssertTrue(banco.salida.dicho.isEmpty, "un texto parcial nunca fue «una pregunta dictada y revisada»")
    }

    func testEnviarEsperandoLosPermisosCancelaElDictado() async {
        let banco = Banco()
        banco.reconocedor.permiso = .porPreguntar
        banco.dictado.alternar()
        banco.modelo.texto = "escrita a mano"
        banco.modelo.enviar()
        XCTAssertEqual(banco.dictado.estado, .inactivo)
        banco.reconocedor.responderPermisos(.concedido)  // llega tarde
        XCTAssertEqual(banco.reconocedor.veces("iniciar"), 0, "no se abre el micrófono después de enviar")
        await banco.cliente.esperarConsultas(1)
        banco.cliente.responder(.success(respuesta))
    }

    // MARK: Cancelar y salir

    func testSalirCortaLaRespuestaHablada() async {
        let banco = Banco()
        await conRespuestaHablada(banco)
        XCTAssertTrue(banco.salida.hablando)
        banco.modelo.salir()
        XCTAssertFalse(banco.salida.hablando)
    }

    func testSalirNoCortaUnAvisoDelAccesorioQueSonoDespues() async {
        let banco = Banco()
        await conRespuestaHablada(banco)
        XCTAssertEqual(banco.voz.anunciar("aviso del accesorio"), .hablado)  // la cola de uno corta la respuesta
        let cortes = banco.salida.cortes
        banco.modelo.salir()
        XCTAssertTrue(banco.salida.hablando, "lo que suena es del accesorio y no se corta")
        XCTAssertEqual(banco.salida.cortes, cortes)
        XCTAssertEqual(banco.salida.dicho, ["Respuesta de prueba", "aviso del accesorio"])
    }

    func testUnaPreguntaNuevaCortaLaRespuestaAnterior() async {
        let banco = Banco()
        await conRespuestaHablada(banco)
        banco.modelo.texto = "otra pregunta"
        banco.modelo.enviar()
        XCTAssertFalse(banco.salida.hablando)
        await banco.cliente.esperarConsultas(2)
        banco.cliente.responder(.success(respuesta), indice: 1)
    }

    func testCancelarInvalidaElDictadoLaSolicitudYLaVoz() async {
        let banco = Banco()
        banco.dictar("hola")
        banco.modelo.enviar()
        await banco.cliente.esperarConsultas(1)
        banco.dictado.alternar()
        banco.reconocedor.emitir(.escuchando)
        XCTAssertEqual(banco.dictado.estado, .escuchando)

        banco.modelo.cancelar()
        XCTAssertEqual(banco.dictado.estado, .inactivo, "cancelar invalida la captura")
        XCTAssertEqual(banco.modelo.estado, .cancelada, "y la solicitud")
        banco.reconocedor.emitir(.terminado("tarde"))
        XCTAssertEqual(banco.modelo.texto, "hola", "lo que el reconocedor entrega tarde no se escribe")
        banco.cliente.responder(.success(respuesta))
        await dejarCorrer()
        XCTAssertEqual(banco.modelo.estado, .cancelada)
        XCTAssertTrue(banco.salida.dicho.isEmpty, "y una respuesta tardía no se lee")
    }

    func testSalirConUnaCapturaAbiertaLaInvalida() {
        let banco = Banco()
        banco.dictado.alternar()
        banco.reconocedor.emitir(.escuchando)
        banco.modelo.salir()
        XCTAssertEqual(banco.dictado.estado, .inactivo)
        XCTAssertEqual(banco.reconocedor.veces("cancelar"), 1)
    }
}
