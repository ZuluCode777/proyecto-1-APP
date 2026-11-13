import XCTest
@testable import TransMiVoz

/// Dictado con un reconocedor falso: permisos, capacidad, ruido, fallos, cancelación y exclusión entre captura y voz.
/// Nada de esto prueba el micrófono, el reconocimiento del español ni la convivencia acústica con auriculares.
@MainActor
final class DictadoModeloTests: XCTestCase {
    private var reconocedor: ReconocedorFalso!
    private var avisos: AvisosFalsos!
    private var campo: CampoFalso!

    /// Cada prueba arma lo suyo: nada se comparte entre pruebas.
    private func armar(permiso: PermisoVoz = .concedido, voz: ControlVoz? = nil) -> DictadoModelo {
        avisos = AvisosFalsos()
        campo = CampoFalso()
        reconocedor = ReconocedorFalso(permiso: permiso)
        let dictado = DictadoModelo(reconocedor: reconocedor, voz: voz, avisos: avisos.avisos)
        campo.conectar(a: dictado)
        return dictado
    }

    /// Pasa de reposo a «escuchando».
    private func empezarAEscuchar(_ dictado: DictadoModelo) {
        dictado.alternar()
        reconocedor.emitir(.escuchando)
        XCTAssertEqual(dictado.estado, .escuchando)
    }

    // MARK: Permisos

    func testPermisoPorPreguntarSePideAlTocarYEmpiezaAlConcederse() {
        let dictado = armar(permiso: .porPreguntar)
        XCTAssertEqual(dictado.estado, .inactivo)
        XCTAssertEqual(reconocedor.llamadas, [], "no se pide nada hasta que la persona toca el botón")
        dictado.alternar()
        XCTAssertEqual(dictado.estado, .pidiendoPermisos)
        XCTAssertEqual(reconocedor.llamadas, ["pedirPermisos"])
        reconocedor.responderPermisos(.concedido)
        XCTAssertEqual(dictado.estado, .iniciando)
        XCTAssertEqual(reconocedor.veces("iniciar"), 1)
        reconocedor.emitir(.escuchando)
        XCTAssertEqual(dictado.estado, .escuchando)
    }

    func testPermisoDenegadoNoAbreElMicrofonoYLoDice() {
        let dictado = armar(permiso: .denegado)
        dictado.alternar()
        XCTAssertEqual(dictado.estado, .permisoDenegado)
        XCTAssertEqual(reconocedor.llamadas, [], "con el permiso negado no se pide ni se captura nada")
        XCTAssertEqual(avisos.anuncios, [TextoDictado.descripcion(.permisoDenegado, capacidad: .noDisponible)])
        XCTAssertEqual(avisos.prioridades, [.urgente])
        XCTAssertTrue(campo.escrito.isEmpty)
    }

    func testPermisoNegadoEnElAvisoDelSistemaSeDiceYNoCaptura() {
        let dictado = armar(permiso: .porPreguntar)
        dictado.alternar()
        reconocedor.responderPermisos(.denegado)
        XCTAssertEqual(dictado.estado, .permisoDenegado)
        XCTAssertEqual(reconocedor.veces("iniciar"), 0)
    }

    func testPermisoRestringido() {
        let dictado = armar(permiso: .restringido)
        dictado.alternar()
        XCTAssertEqual(dictado.estado, .permisoRestringido)
        XCTAssertEqual(reconocedor.veces("iniciar"), 0)
    }

    func testTocarOtraVezConElPermisoNegadoVuelveAAnunciar() {
        let dictado = armar(permiso: .denegado)
        dictado.alternar()
        dictado.alternar()
        XCTAssertEqual(avisos.anuncios.count, 2, "cada intento dice por qué no hay dictado")
    }

    func testCancelarMientrasSeEsperanLosPermisosDescartaLaRespuestaTardia() {
        let dictado = armar(permiso: .porPreguntar)
        dictado.alternar()
        dictado.alternar()  // la persona cancela con el aviso del sistema en pantalla
        XCTAssertEqual(dictado.estado, .inactivo)
        reconocedor.responderPermisos(.concedido)  // llega tarde
        XCTAssertEqual(dictado.estado, .inactivo)
        XCTAssertEqual(reconocedor.veces("iniciar"), 0, "una respuesta tardía no abre el micrófono")
    }

    // MARK: Capacidad

    func testSinReconocedorDeEspanolNoCapturaYLoDice() {
        let dictado = armar()
        reconocedor.capacidad = .noDisponible
        dictado.alternar()
        XCTAssertEqual(dictado.estado, .noDisponible)
        XCTAssertEqual(reconocedor.veces("iniciar"), 0)
    }

    func testLaCapacidadSeVuelveAPreguntarAlSistema() {
        let dictado = armar()
        XCTAssertEqual(dictado.capacidad, .remoto(idioma: "es-CO"))
        reconocedor.capacidad = .local(idioma: "es-CO")
        dictado.actualizarCapacidad()
        XCTAssertEqual(dictado.capacidad, .local(idioma: "es-CO"))
        empezarAEscuchar(dictado)
        reconocedor.capacidad = .noDisponible
        dictado.actualizarCapacidad()
        XCTAssertEqual(dictado.capacidad, .local(idioma: "es-CO"), "con una captura abierta no se cambia lo que se dijo al empezar")
    }

    func testElTextoDiceAdondeVaElAudioSinPrometerOfflineColombiano() {
        let remoto = TextoDictado.capacidad(.remoto(idioma: "es-CO"))
        XCTAssertTrue(remoto.contains("el audio se envía a Apple"), remoto)
        let local = TextoDictado.capacidad(.local(idioma: "es-ES"))
        XCTAssertTrue(local.contains("español de España"), "debe decir el español que el sistema ofreció: \(local)")
        XCTAssertFalse(local.contains("Colombia"))
        let localColombia = TextoDictado.capacidad(.local(idioma: "es-CO"))
        XCTAssertTrue(localColombia.hasPrefix("Según tu iPhone"), "lo local lo declara el sistema, no la app: \(localColombia)")
        XCTAssertTrue(localColombia.contains("no saldría"), "es lo que el sistema declara, no una garantía: \(localColombia)")
        for texto in [remoto, local, localColombia, TextoDictado.capacidad(.noDisponible)] {
            XCTAssertFalse(texto.lowercased().contains("sin conexión"), "no se promete funcionamiento sin red: \(texto)")
        }
    }

    func testLaPistaDelBotonLlevaAdondeVaElAudio() {
        for capacidad in [CapacidadReconocimiento.local(idioma: "es-CO"), .remoto(idioma: "es-CO"), .noDisponible] {
            XCTAssertTrue(
                TextoDictado.pista(.inactivo, capacidad: capacidad).contains(TextoDictado.capacidad(capacidad)),
                "VoiceOver llega al botón antes que a la línea de abajo")
        }
        XCTAssertFalse(TextoDictado.pista(.escuchando, capacidad: .remoto(idioma: "es-CO")).contains("Apple"), "escuchando solo dice cómo terminar")
    }

    // MARK: Dictado

    func testElDictadoEntregaElTextoYAnunciaElResultadoConElMicrofonoCerrado() {
        let dictado = armar()
        empezarAEscuchar(dictado)
        XCTAssertEqual(avisos.vibraciones, 1, "al empezar solo vibra")
        XCTAssertFalse(avisos.anuncios.contains { $0.hasPrefix("Escuchando") }, "VoiceOver no suena sobre el micrófono abierto")
        reconocedor.emitir(.parcial("salgo desde"))
        dictado.alternar()  // «Detener dictado»
        XCTAssertEqual(dictado.estado, .finalizando)
        XCTAssertEqual(reconocedor.veces("detener"), 1)
        reconocedor.emitir(.terminado(" salgo desde Ricaurte "))
        XCTAssertEqual(campo.escrito, ["salgo desde", "salgo desde Ricaurte"])
        XCTAssertEqual(dictado.ultimoDictado, "salgo desde Ricaurte")
        XCTAssertEqual(dictado.estado, .inactivo)
        XCTAssertEqual(avisos.anuncios, ["Dictado terminado: salgo desde Ricaurte."])
    }

    func testRuidoSinTextoSeDiceYNoEscribeNada() {
        let dictado = armar()
        empezarAEscuchar(dictado)
        reconocedor.emitir(.terminado("   "))
        XCTAssertEqual(dictado.estado, .sinTexto)
        XCTAssertTrue(campo.escrito.isEmpty)
        XCTAssertNil(dictado.ultimoDictado)
        XCTAssertEqual(avisos.anuncios, [TextoDictado.descripcion(.sinTexto, capacidad: .noDisponible)])
    }

    func testFalloDelServicioSeDiceYSueltaLaCaptura() {
        let dictado = armar()
        empezarAEscuchar(dictado)
        reconocedor.emitir(.fallo(.sinServicio))
        XCTAssertEqual(dictado.estado, .fallo)
        XCTAssertEqual(reconocedor.veces("cancelar"), 1, "el micrófono y la sesión de audio se sueltan")
        XCTAssertTrue(campo.escrito.isEmpty)
    }

    func testFalloAlAbrirElMicrofono() {
        let dictado = armar()
        dictado.alternar()
        reconocedor.emitir(.fallo(.audio))
        XCTAssertEqual(dictado.estado, .fallo)
    }

    func testDespuesDeUnFalloSePuedeDictarOtraVez() {
        let dictado = armar()
        empezarAEscuchar(dictado)
        reconocedor.emitir(.fallo(.sinServicio))
        empezarAEscuchar(dictado)
        reconocedor.emitir(.terminado("hola"))
        XCTAssertEqual(campo.escrito, ["hola"])
    }

    // MARK: Cancelación

    func testCancelarInvalidaLaCapturaYDescartaLoTardio() {
        let dictado = armar()
        empezarAEscuchar(dictado)
        dictado.cancelar()
        XCTAssertEqual(dictado.estado, .inactivo)
        XCTAssertEqual(reconocedor.veces("cancelar"), 1)
        reconocedor.emitir(.parcial("tarde"), token: reconocedor.tokenVigente)
        reconocedor.emitir(.terminado("tarde"), token: reconocedor.tokenVigente)
        XCTAssertEqual(dictado.estado, .inactivo)
        XCTAssertTrue(campo.escrito.isEmpty, "nada de lo que llega tras cancelar se escribe")
        XCTAssertNil(dictado.ultimoDictado)
    }

    func testElResultadoDeUnaCapturaAnteriorNoEntraEnLaNueva() {
        let dictado = armar()
        empezarAEscuchar(dictado)
        let anterior = reconocedor.tokenVigente
        dictado.cancelar()
        empezarAEscuchar(dictado)
        XCTAssertNotEqual(anterior, reconocedor.tokenVigente)
        reconocedor.emitir(.parcial("viejo"), token: anterior)
        reconocedor.emitir(.parcial("nuevo"))
        XCTAssertEqual(campo.escrito, ["nuevo"])
    }

    func testTocarMientrasProcesaCancela() {
        let dictado = armar()
        empezarAEscuchar(dictado)
        dictado.alternar()
        XCTAssertEqual(dictado.estado, .finalizando)
        dictado.alternar()
        XCTAssertEqual(dictado.estado, .inactivo, "un servicio que no responde no deja el botón atascado")
    }

    // MARK: Captura y voz no se realimentan

    func testEmpezarACapturarCortaLaRespuestaPropiaAntesDeAbrirElMicrofono() {
        let salida = SalidaVozFalsa()
        let voz = ControlVoz(salida: salida, consultarRuta: { .privada })
        XCTAssertEqual(voz.anunciar("respuesta en curso"), .hablado)
        XCTAssertTrue(salida.hablando)
        let dictado = armar(voz: voz)
        dictado.cortarVozPropia = { voz.descartarTodo() }  // la consulta la cortaría solo si la locución es suya
        var hablandoAlAbrirElMicrofono: Bool?
        reconocedor.alIniciar = { hablandoAlAbrirElMicrofono = salida.hablando }
        dictado.alternar()
        XCTAssertEqual(reconocedor.veces("iniciar"), 1)
        XCTAssertEqual(hablandoAlAbrirElMicrofono, false, "la captura no se abre con una locución sonando")
    }

    func testConUnAvisoSonandoElMicrofonoNoSeAbreNiSeCortaElAviso() {
        let salida = SalidaVozFalsa()
        let voz = ControlVoz(salida: salida, consultarRuta: { .privada })
        XCTAssertEqual(voz.anunciar("aviso de proximidad"), .hablado)
        let cortes = salida.cortes
        let dictado = armar(voz: voz)  // sin `cortarVozPropia`: lo que suene es ajeno
        dictado.alternar()
        XCTAssertEqual(dictado.estado, .vozOcupada)
        XCTAssertEqual(reconocedor.llamadas, [], "ni se abre el micrófono ni se pide nada")
        XCTAssertTrue(salida.hablando, "el aviso sigue sonando")
        XCTAssertEqual(salida.cortes, cortes, "y nadie lo cortó")
        XCTAssertEqual(avisos.anuncios, [TextoDictado.descripcion(.vozOcupada, capacidad: .noDisponible)])
        XCTAssertTrue(TextoDictado.descripcion(.vozOcupada, capacidad: .noDisponible).contains("aviso"))
        XCTAssertEqual(avisos.prioridades, [.urgente])

        salida.terminarSola()  // el aviso termina: la persona vuelve a tocar y ahora sí empieza
        dictado.alternar()
        XCTAssertEqual(dictado.estado, .iniciando)
        XCTAssertEqual(reconocedor.veces("iniciar"), 1)
    }

    func testTrasLosAvisosDePermisoUnaLocucionPropiaSeCortaYUnAvisoImpideAbrirElMicrofono() {
        let salida = SalidaVozFalsa()
        let voz = ControlVoz(salida: salida, consultarRuta: { .privada })
        let dictado = armar(permiso: .porPreguntar, voz: voz)
        dictado.cortarVozPropia = { voz.descartarTodo() }
        dictado.alternar()  // los avisos del sistema están en pantalla y, mientras, suena algo
        XCTAssertEqual(voz.anunciar("respuesta propia"), .hablado)
        var hablandoAlAbrirElMicrofono: Bool?
        reconocedor.alIniciar = { hablandoAlAbrirElMicrofono = salida.hablando }
        reconocedor.responderPermisos(.concedido)
        XCTAssertEqual(dictado.estado, .iniciando)
        XCTAssertEqual(hablandoAlAbrirElMicrofono, false, "también por este camino se corta lo propio antes del micrófono")

        // Mismo camino con un aviso ajeno: la `ControlVoz` es de la prueba, no de la consulta.
        let ajeno = armar(permiso: .porPreguntar, voz: voz)
        ajeno.alternar()
        XCTAssertEqual(voz.anunciar("aviso de proximidad"), .hablado)
        let cortes = salida.cortes
        reconocedor.responderPermisos(.concedido)
        XCTAssertEqual(ajeno.estado, .vozOcupada)
        XCTAssertEqual(reconocedor.veces("iniciar"), 0)
        XCTAssertTrue(salida.hablando)
        XCTAssertEqual(salida.cortes, cortes)
    }

    func testOtraCapturaBorraLoUltimoDictado() {
        let dictado = armar()
        empezarAEscuchar(dictado)
        reconocedor.emitir(.terminado("hola"))
        XCTAssertEqual(dictado.ultimoDictado, "hola")
        dictado.alternar()
        XCTAssertNil(dictado.ultimoDictado, "el texto parcial de la nueva captura no cuenta como «lo dictado»")
    }

    func testUnaLocucionConLaCapturaAbiertaLaCancelaYLaVozSuena() {
        let salida = SalidaVozFalsa()
        let voz = ControlVoz(salida: salida, consultarRuta: { .privada })
        let dictado = armar(voz: voz)
        empezarAEscuchar(dictado)
        XCTAssertEqual(voz.anunciar("aviso del accesorio"), .hablado)
        XCTAssertEqual(dictado.estado, .inactivo, "nada suena sobre un micrófono abierto")
        XCTAssertEqual(reconocedor.veces("cancelar"), 1)
        XCTAssertEqual(salida.dicho, ["aviso del accesorio"], "el aviso no se retrasa ni se pierde")
        XCTAssertEqual(avisos.anuncios, [TextoDictado.dictadoCortadoPorVoz])
        XCTAssertEqual(avisos.prioridades, [.urgente])
    }

    func testUnaLocucionSilenciadaNoCancelaElDictado() {
        let salida = SalidaVozFalsa()
        let voz = ControlVoz(salida: salida, consultarRuta: { .noPrivada })  // sin auriculares: la voz calla
        let dictado = armar(voz: voz)
        empezarAEscuchar(dictado)
        XCTAssertEqual(voz.anunciar("aviso"), .silenciado(.rutaNoPrivada))
        XCTAssertEqual(dictado.estado, .escuchando)
    }

    func testSinCapturaLaVozNoTocaAlDictado() {
        let voz = ControlVoz(salida: SalidaVozFalsa(), consultarRuta: { .privada })
        let dictado = armar(voz: voz)
        XCTAssertEqual(voz.anunciar("aviso"), .hablado)
        XCTAssertEqual(dictado.estado, .inactivo)
        XCTAssertEqual(reconocedor.llamadas, [])
        XCTAssertEqual(avisos.anuncios, [])
    }
}

/// Los textos que iOS muestra al pedir los permisos están en el Info.plist de la app, en español.
final class InfoPlistDictadoTests: XCTestCase {
    func testLosPermisosDeMicrofonoYReconocimientoDeVozTienenTextoEnEspanol() {
        let info = Bundle(for: DictadoModelo.self).infoDictionary ?? [:]
        let microfono = info["NSMicrophoneUsageDescription"] as? String ?? ""
        let reconocimiento = info["NSSpeechRecognitionUsageDescription"] as? String ?? ""
        XCTAssertTrue(microfono.contains("micrófono"), "falta el texto del permiso del micrófono: \(microfono)")
        XCTAssertTrue(reconocimiento.contains("Apple"), "el texto debe decir que el audio puede ir a Apple: \(reconocimiento)")
    }
}
