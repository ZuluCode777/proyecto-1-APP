import ContratoBLE
import XCTest
@testable import TransMiVoz

/// Prioridad de la voz (`ControlVoz`, EA-20): un aviso relevante corta a un mensaje de rutina; uno menor no corta ni calla a
/// uno mayor que suena. Con voz y ruta falsas: simulación, no audio real.
@MainActor
final class PrioridadVozTests: XCTestCase {
    private func crear() -> (ControlVoz, SalidaVozFalsa) {
        let salida = SalidaVozFalsa()
        return (ControlVoz(salida: salida, consultarRuta: { .privada }), salida)
    }

    func testLaPrioridadSeOrdenaDeRutinaAUrgente() {
        XCTAssertLessThan(PrioridadVoz.rutina, .advertencia)
        XCTAssertLessThan(PrioridadVoz.advertencia, .urgente)
    }

    func testUnAvisoRelevanteCortaUnaLocucionDeRutina() {
        let (control, salida) = crear()
        XCTAssertEqual(control.anunciar("Respuesta de la consulta"), .hablado)
        XCTAssertEqual(control.anunciar("Objeto a 1 metro.", prioridad: .urgente), .hablado)
        XCTAssertEqual(salida.dicho, ["Respuesta de la consulta", "Objeto a 1 metro."])
        XCTAssertEqual(salida.cortadas, ["Respuesta de la consulta"])
    }

    func testUnMensajeMenorNoCortaNiCallaUnAvisoQueSuena() {
        let (control, salida) = crear()
        control.anunciar("Objeto a 1 metro.", prioridad: .urgente)
        let cortes = salida.cortes
        XCTAssertTrue(control.debeCeder(prioridad: .advertencia))
        XCTAssertEqual(control.anunciar("Respuesta de la consulta"), .silenciado(.cedeAUnAviso))
        XCTAssertEqual(control.anunciar("Red caída.", prioridad: .advertencia), .silenciado(.cedeAUnAviso))
        XCTAssertEqual(salida.dicho, ["Objeto a 1 metro."])
        XCTAssertTrue(salida.cortadas.isEmpty, "lo que suena no se cortó")
        XCTAssertEqual(salida.cortes, cortes, "ni se intentó cortar")
        XCTAssertTrue(salida.hablando)
        XCTAssertFalse(control.ultimaLocucionCortada)
    }

    func testConLaMismaPrioridadLaNuevaReemplazaYTerminadoElAvisoHablaLoMenor() {
        let (control, salida) = crear()
        control.anunciar("a", prioridad: .urgente)
        XCTAssertEqual(control.anunciar("b", prioridad: .urgente), .hablado)
        XCTAssertEqual(salida.cortadas, ["a"], "la cola sigue siendo de uno")

        salida.terminarSola()
        XCTAssertFalse(control.debeCeder(prioridad: .rutina), "ya no suena nada")
        XCTAssertEqual(control.anunciar("c"), .hablado)
        XCTAssertEqual(salida.dicho, ["a", "b", "c"])
    }

    func testLaRutinaSigueReemplazandoALaRutinaComoAntes() {
        let (control, salida) = crear()
        control.anunciar("a")
        XCTAssertEqual(control.anunciar("b"), .hablado)
        XCTAssertEqual(salida.cortadas, ["a"])
    }
}

/// Banco del módulo de avisos: voz, ruta y reloj falsos (simulación).
@MainActor
private struct BancoCentro {
    let salida = SalidaVozFalsa()
    let ruta = RutaFalsa(.privada)
    let reloj = RelojFalso()
    let voz: ControlVoz
    let centro: CentroAvisos

    init(origen: OrigenAviso = .propio) {
        let rutaCapturada = ruta
        voz = ControlVoz(salida: salida, consultarRuta: { rutaCapturada.valor })
        let relojCapturado = reloj
        centro = CentroAvisos(voz: voz, reloj: { relojCapturado.ahora }, origen: origen)
    }

    func vigentes() -> Set<TipoAviso> {
        Set(centro.avisos.filter { centro.vigente($0) }.map(\.tipo))
    }
}

/// Prioridad, deduplicación, caducidad, ritmo y silencio de los avisos locales (EA-20, #46). Todo con reloj falso.
@MainActor
final class CentroAvisosTests: XCTestCase {
    // MARK: Clases de aviso

    func testCadaEstadoDelAccesorioSabeSiEsAvisoORutina() {
        XCTAssertEqual(TipoAviso.de(.objetivo(distanciaMm: 1200, azimutCentesimas: nil)), .proximidad)
        XCTAssertEqual(TipoAviso.de(.presencia), .proximidad)
        XCTAssertEqual(TipoAviso.de(.sinDatos(.vencido)), .datoVencido)
        XCTAssertEqual(TipoAviso.de(.radarNoDisponible(.iniciando)), .datoVencido)
        for estado in [EstadoAccesorio.desconectado, .falla(.errorDeLectura), .rechazado(.enlaceNoAutenticado), .enlaceNoVerificado, .bluetoothNoDisponible(.apagado)] {
            XCTAssertEqual(TipoAviso.de(estado), .accesorioPerdido, "\(estado)")
        }
        for estado in [EstadoAccesorio.sinAccesorio, .detenido, .conectando, .comprobandoEnlace, .conectado, .calibrando, .sinDeteccion] {
            XCTAssertNil(TipoAviso.de(estado), "\(estado) es rutina, no un aviso")
        }
    }

    func testLoFisicoEsUrgenteYLoDelServidorOLaUbicacionEsAdvertencia() {
        for tipo in [TipoAviso.accesorioPerdido, .datoVencido, .proximidad] {
            XCTAssertEqual(tipo.severidad, .urgente, "\(tipo)")
            XCTAssertEqual(tipo.fuente, .sesion)
        }
        for tipo in [TipoAviso.gpsImpreciso, .datosViejos, .redCaida] {
            XCTAssertEqual(tipo.severidad, .advertencia, "\(tipo)")
        }
        XCTAssertEqual(TipoAviso.allCases.count, 6)
        XCTAssertTrue(TipoAviso.allCases.allSatisfy { ($0.vigenciaMs ?? 1) > 0 })
    }

    func testLosAvisosDeLaSesionNoCaducanPorTiempoYLosDeLaConsultaYLaUbicacionSi() {
        for tipo in TipoAviso.allCases {
            if tipo.fuente == .sesion {
                XCTAssertNil(tipo.vigenciaMs, "\(tipo): dura mientras dure su estado y lo cierra la sesión")
            } else {
                XCTAssertNotNil(tipo.vigenciaMs, "\(tipo): es un resultado puntual y envejece")
            }
        }
    }

    // MARK: Deduplicación y caducidad

    func testUnAvisoSeListaYSeDiceConSuTextoEquivalente() {
        let b = BancoCentro()
        XCTAssertEqual(b.centro.emitir(.redCaida, TextoAvisos.redCaida), .hablado)
        XCTAssertEqual(b.salida.dicho, [TextoAvisos.redCaida])
        XCTAssertEqual(b.centro.avisos.map(\.tipo), [.redCaida])
        XCTAssertEqual(b.centro.avisos[0].texto, TextoAvisos.redCaida)
        XCTAssertEqual(b.centro.avisos[0].origen, .propio)
    }

    func testUnAvisoIgualAlVigenteNoSeRepiteNiSeVuelveAListarAunqueLlegueEnRafaga() {
        let b = BancoCentro()
        XCTAssertEqual(b.centro.emitir(.redCaida, TextoAvisos.redCaida), .hablado)
        for _ in 0..<5 {
            XCTAssertEqual(b.centro.emitir(.redCaida, TextoAvisos.redCaida), .duplicado)
        }
        XCTAssertEqual(b.salida.dicho, [TextoAvisos.redCaida], "ráfaga repetida: una sola vez")
        XCTAssertEqual(b.centro.avisos.count, 1)

        // Pedirlo salta la deduplicación (la sesión repite el estado de ahora al volver el audio), sin duplicar la lista.
        XCTAssertEqual(b.centro.emitir(.redCaida, TextoAvisos.redCaida, repitiendo: true), .hablado)
        XCTAssertEqual(b.salida.dicho.count, 2)
        XCTAssertEqual(b.centro.avisos.count, 1)
    }

    func testUnTextoDistintoDeLaMismaClaseReemplazaAlAnteriorYSeDice() {
        let b = BancoCentro()
        b.centro.emitir(.proximidad, "Objeto a 1 metro.")
        XCTAssertEqual(b.centro.emitir(.proximidad, "Objeto a 2 metros."), .hablado)
        XCTAssertEqual(b.centro.avisos.map(\.texto), ["Objeto a 2 metros."], "la lista guarda el último de cada clase")
        // Volver al texto de antes tras otro distinto vuelve a decirse: lo último que se oyó fue otra cosa.
        XCTAssertEqual(b.centro.emitir(.proximidad, "Objeto a 1 metro."), .hablado)
    }

    func testUnAvisoCaducaSeRenuevaMientrasSigueYAlReaparecerVuelveADecirse() throws {
        let b = BancoCentro()
        let vigencia = try XCTUnwrap(TipoAviso.redCaida.vigenciaMs)
        b.centro.emitir(.redCaida, TextoAvisos.redCaida)
        b.reloj.avanzar(vigencia - 1)
        XCTAssertTrue(b.centro.vigente(b.centro.avisos[0]))
        XCTAssertEqual(b.centro.emitir(.redCaida, TextoAvisos.redCaida), .duplicado, "sigue la misma situación")

        b.reloj.avanzar(vigencia - 1)
        XCTAssertTrue(b.centro.vigente(b.centro.avisos[0]), "se renovó: dura más que la vigencia original")
        b.reloj.avanzar(2)
        XCTAssertFalse(b.centro.vigente(b.centro.avisos[0]))
        XCTAssertEqual(b.centro.avisos.count, 1, "caducado no es borrado: queda como anterior")

        XCTAssertEqual(b.centro.emitir(.redCaida, TextoAvisos.redCaida), .hablado, "caducó: si reaparece, es nuevo")
        XCTAssertTrue(b.centro.vigente(b.centro.avisos[0]))
        XCTAssertEqual(b.centro.avisos.count, 1)
    }

    func testUnAvisoDeLaSesionSigueVigenteAunqueNadieLoRenueveHastaQueSuFuenteLoCierra() {
        let b = BancoCentro()
        b.centro.emitir(.proximidad, "Objeto a 1 metro.")
        b.centro.emitir(.redCaida, TextoAvisos.redCaida)
        b.reloj.avanzar(3_600_000)  // una hora: muy por encima de cualquier vigencia
        XCTAssertEqual(b.vigentes(), [.proximidad], "la sesión no volvió a emitir: el objeto sigue delante y la red caída venció")
        XCTAssertEqual(b.centro.emitir(.proximidad, "Objeto a 1 metro."), .duplicado)
        XCTAssertEqual(b.salida.dicho, ["Objeto a 1 metro."], "seguir vigente no lo vuelve a decir (la red caída cedió al urgente)")

        b.centro.retirar(fuente: .sesion)
        XCTAssertEqual(b.vigentes(), [], "al acabar su estado la sesión lo cierra")
    }

    func testUnAvisoNuevoCierraElVigenteDeSuFuenteYNoElDeOtra() {
        let b = BancoCentro()
        b.centro.emitir(.redCaida, TextoAvisos.redCaida)
        b.centro.emitir(.proximidad, "Objeto a 1 metro.")
        b.centro.emitir(.datoVencido, "Sin datos del sensor.")
        XCTAssertEqual(b.vigentes(), [.redCaida, .datoVencido], "el dato vencido cierra la proximidad; la red es de otra fuente")

        b.centro.retirar(fuente: .sesion)
        XCTAssertEqual(b.vigentes(), [.redCaida])
        XCTAssertEqual(b.centro.avisos.count, 3, "lo cerrado queda en la lista como anterior")
    }

    // MARK: Prioridad e interrupción

    func testUnAvisoRelevanteInterrumpeLaRutinaYUnoMenorNoCallaAUnoMayor() {
        let b = BancoCentro()
        b.voz.anunciar("Respuesta de la consulta")  // rutina, sonando
        XCTAssertEqual(b.centro.emitir(.redCaida, TextoAvisos.redCaida), .hablado)
        XCTAssertEqual(b.salida.cortadas, ["Respuesta de la consulta"], "el aviso corta la rutina")

        XCTAssertEqual(b.centro.emitir(.proximidad, "Objeto a 1 metro."), .hablado)
        XCTAssertEqual(b.salida.cortadas.last, TextoAvisos.redCaida, "el urgente corta a la advertencia")

        XCTAssertEqual(b.centro.emitir(.datosViejos, TextoAvisos.datosViejos), .silenciado(.cedeAUnAviso))
        XCTAssertEqual(b.salida.dicho.last, "Objeto a 1 metro.")
        XCTAssertEqual(b.salida.cortadas.last, TextoAvisos.redCaida, "el urgente que suena no se cortó")
        XCTAssertTrue(b.centro.avisos.contains { $0.tipo == .datosViejos }, "lo que no se dijo consta en la lista")
    }

    func testSinSalidaPrivadaElAvisoConstaEnLaListaAunqueNoSeDiga() {
        let b = BancoCentro()
        b.ruta.valor = .noPrivada
        XCTAssertEqual(b.centro.emitir(.proximidad, "Objeto a 1 metro."), .silenciado(.rutaNoPrivada))
        XCTAssertTrue(b.salida.dicho.isEmpty)
        XCTAssertEqual(b.centro.avisos.map(\.tipo), [.proximidad])
    }

    // MARK: Sin anunciar sin límite

    func testNoSeAnunciaSinLimiteYLoAplazadoSeDiceAlAbrirseLaVentana() {
        let b = BancoCentro()
        for n in 1...CentroAvisos.maximoVocesPorVentana {
            XCTAssertEqual(b.centro.emitir(.proximidad, "Objeto a \(n) metros."), .hablado)
            b.reloj.avanzar(100)
        }
        let siguiente = "Objeto a 99 metros."
        XCTAssertEqual(b.centro.emitir(.proximidad, siguiente), .limitado)
        XCTAssertEqual(b.centro.emitir(.proximidad, siguiente), .limitado, "reintentar antes de tiempo sigue aplazado")
        XCTAssertEqual(b.salida.dicho.count, CentroAvisos.maximoVocesPorVentana)
        XCTAssertEqual(b.centro.avisos.count, 1)
        XCTAssertEqual(b.centro.avisos[0].texto, siguiente, "la lista tiene lo de ahora aunque la voz se aplazó")

        // La voz más vieja sale de la ventana: el reintento (sin una entrada nueva en la lista) ya se dice.
        b.reloj.avanzar(CentroAvisos.ventanaRitmoMs - 600)
        XCTAssertEqual(b.centro.emitir(.proximidad, siguiente), .hablado)
        XCTAssertEqual(b.salida.dicho.last, siguiente)
        XCTAssertEqual(b.centro.avisos.count, 1)
        XCTAssertEqual(b.centro.emitir(.proximidad, siguiente), .duplicado, "ya dicho: no se repite")
    }

    func testUnaLecturaMasCercanaQueLaUltimaDichaNoLaFrenaElLimite() {
        let b = BancoCentro()
        for n in 1...CentroAvisos.maximoVocesPorVentana {
            XCTAssertEqual(b.centro.emitir(.proximidad, "Objeto a \(n) metros.", distanciaMm: n * 1000), .hablado)
            b.reloj.avanzar(100)
        }
        // Se agotó el cupo; la última dicha fue a 6 m.
        XCTAssertEqual(b.centro.emitir(.proximidad, "Objeto a 7 metros.", distanciaMm: 7000), .limitado, "más lejos: espera")
        XCTAssertEqual(b.centro.emitir(.proximidad, "Objeto a 5 metros.", distanciaMm: 5000), .hablado, "más cerca: se dice ya")
        XCTAssertEqual(b.salida.dicho.last, "Objeto a 5 metros.")
        XCTAssertEqual(b.centro.emitir(.proximidad, "Objeto a 5,5 metros.", distanciaMm: 5500), .limitado, "más lejos que la última dicha")
        XCTAssertEqual(b.centro.emitir(.proximidad, "Presencia detectada."), .limitado, "sin medida no hay excepción")
        XCTAssertEqual(b.centro.avisos[0].texto, "Presencia detectada.", "la lista tiene lo de ahora")
    }

    func testElLimiteEsPorClaseYPedirloLoSalta() {
        let b = BancoCentro()
        for n in 1...CentroAvisos.maximoVocesPorVentana { b.centro.emitir(.proximidad, "Objeto a \(n) metros.") }
        XCTAssertEqual(b.centro.emitir(.proximidad, "Objeto a 99 metros."), .limitado)
        XCTAssertEqual(b.centro.emitir(.datoVencido, "Sin datos del sensor."), .hablado, "otra clase tiene su propio cupo")
        XCTAssertEqual(b.centro.emitir(.proximidad, "Objeto a 99 metros.", repitiendo: true), .hablado)
    }

    // MARK: Silenciar según severidad y repetir

    func testSilenciarLasAdvertenciasNoLasOcultaDeLaListaYNuncaCallaLoUrgente() {
        let b = BancoCentro()
        b.centro.silenciarAdvertencias(true)
        XCTAssertTrue(b.centro.advertenciasSilenciadas)
        for tipo in [TipoAviso.redCaida, .datosViejos, .gpsImpreciso] {
            XCTAssertEqual(b.centro.emitir(tipo, "texto de \(tipo)"), .silenciado(.severidadSilenciada), "\(tipo)")
        }
        XCTAssertTrue(b.salida.dicho.isEmpty)
        XCTAssertEqual(Set(b.centro.avisos.map(\.tipo)), [.redCaida, .datosViejos, .gpsImpreciso], "siguen en la lista")

        // Con las advertencias silenciadas, todo lo urgente suena: no hay forma de silenciarlo.
        let urgentes: [(TipoAviso, String)] = [
            (.proximidad, "Objeto a 1 metro."), (.datoVencido, "Sin datos del sensor."), (.accesorioPerdido, "Accesorio desconectado."),
        ]
        for (tipo, texto) in urgentes {
            XCTAssertEqual(b.centro.emitir(tipo, texto), .hablado, "\(tipo)")
            XCTAssertEqual(b.salida.dicho.last, texto)
        }

        b.centro.silenciarAdvertencias(false)
        XCTAssertFalse(b.centro.advertenciasSilenciadas)
        XCTAssertEqual(b.centro.emitir(.redCaida, "otro texto"), .silenciado(.cedeAUnAviso), "ya no está silenciada; ahora cede al urgente que suena")
    }

    func testRepetirDiceElTextoConLaReservaDelEnlaceSinAutenticarYLaFilaLaDeclara() {
        let b = BancoCentro()
        let conReserva = "Objeto a 1 metro. \(TextoAccesorio.reservaEnlace)"
        b.centro.emitir(.proximidad, "Objeto a 1 metro.", textoVoz: conReserva, enlaceSinAutenticar: true)
        XCTAssertEqual(b.salida.dicho, ["Objeto a 1 metro."], "la voz de ahora no llevaba la reserva (ya se oyó entera)")
        let aviso = b.centro.avisos[0]
        XCTAssertEqual(aviso.texto, "Objeto a 1 metro.", "la lista muestra la medida")
        XCTAssertTrue(aviso.enlaceSinAutenticar, "y la fila declara el enlace")

        b.centro.repetir(.proximidad)
        XCTAssertEqual(b.salida.dicho.last, conReserva, "repetir dice lo mismo con la reserva")

        // Un aviso sin reserva (consulta, enlace autenticado) se repite tal cual y no declara nada.
        b.salida.terminarSola()
        b.centro.emitir(.redCaida, TextoAvisos.redCaida)
        XCTAssertFalse(b.centro.avisos[0].enlaceSinAutenticar)
        b.centro.repetir(.redCaida)
        XCTAssertEqual(b.salida.dicho.last, TextoAvisos.redCaida)
    }

    func testRepetirDiceElAvisoVigenteAunSilenciadoYExplicaPorQueNoSeDijo() throws {
        let b = BancoCentro()
        b.centro.silenciarAdvertencias(true)
        b.centro.emitir(.redCaida, TextoAvisos.redCaida)
        XCTAssertTrue(b.salida.dicho.isEmpty)

        b.centro.repetir(.redCaida)
        XCTAssertEqual(b.salida.dicho, [TextoAvisos.redCaida], "repetir es una orden: ignora el silencio")
        XCTAssertEqual(b.centro.resultadoRepeticion, TextoAvisos.repitiendo)
        XCTAssertEqual(b.centro.repeticiones, 1)

        b.ruta.valor = .noPrivada
        b.centro.repetir(.redCaida)
        XCTAssertEqual(b.salida.dicho.count, 1, "sin salida privada no se dice")
        XCTAssertEqual(b.centro.resultadoRepeticion, TextoAvisos.noSeDijo(.rutaNoPrivada), "el motivo va a la pantalla, que lleva el foco")
        XCTAssertEqual(b.centro.repeticiones, 2)

        b.ruta.valor = .privada
        b.reloj.avanzar(try XCTUnwrap(TipoAviso.redCaida.vigenciaMs) + 1)
        b.centro.repetir(.redCaida)
        XCTAssertEqual(b.salida.dicho.count, 1, "un aviso caducado no se repite como si fuera actual")
        XCTAssertEqual(b.centro.resultadoRepeticion, TextoAvisos.yaNoVigente)
    }

    func testCadaMotivoDeSilencioTieneSuTextoPropio() {
        let motivos: [MotivoSilencio] = [.rutaNoPrivada, .interrumpido, .audioNoDisponible, .vozApagada, .cedeAUnAviso, .severidadSilenciada]
        XCTAssertEqual(Set(motivos.map(TextoAvisos.noSeDijo)).count, motivos.count)
    }

    // MARK: Consulta: red caída y datos viejos

    func testSinConexionEsRedCaidaYUnaRespuestaAlDiaLaCierra() {
        let b = BancoCentro()
        b.centro.consultaCambio(.error(.sinConexion))
        XCTAssertEqual(b.centro.avisos.map(\.tipo), [.redCaida])
        XCTAssertEqual(b.salida.dicho, [TextoAvisos.redCaida])

        b.centro.consultaCambio(.error(.tiempoAgotado))
        b.centro.consultaCambio(.enviando)
        b.centro.consultaCambio(.cancelada)
        XCTAssertEqual(b.vigentes(), [.redCaida], "otros resultados no la tocan")

        b.centro.consultaCambio(.respuesta(RespuestaAgente(texto: "Respuesta de prueba.")))
        XCTAssertEqual(b.vigentes(), [], "una respuesta al día cierra el aviso")
    }

    func testUnaRafagaDeErroresSinConexionSeAnunciaUnaVez() {
        let b = BancoCentro()
        for _ in 0..<5 {
            b.centro.consultaCambio(.enviando)
            b.centro.consultaCambio(.error(.sinConexion))
        }
        XCTAssertEqual(b.salida.dicho, [TextoAvisos.redCaida])
        XCTAssertEqual(b.centro.avisos.count, 1)
    }

    func testLosDatosDelCatalogoAntiguosSonUnAvisoYLosRecientesNo() {
        let b = BancoCentro()
        let antiguo = RespuestaAgente(texto: "Ruta Z99.", catalogo: ProcedenciaCatalogo(procedencia: "Copia guardada de prueba.", antiguo: true))
        b.centro.consultaCambio(.respuesta(antiguo))
        XCTAssertEqual(b.centro.avisos.map(\.tipo), [.datosViejos])
        XCTAssertEqual(b.salida.dicho, [TextoAvisos.datosViejos])

        let reciente = RespuestaAgente(texto: "Ruta Z99.", catalogo: ProcedenciaCatalogo(procedencia: "Datos de hoy de prueba.", antiguo: false))
        b.centro.consultaCambio(.respuesta(reciente))
        XCTAssertEqual(b.vigentes(), [])
    }

    func testElGpsImpreciosoSeEmiteComoAdvertenciaDeLaUbicacionConSuTexto() {
        let b = BancoCentro()
        XCTAssertEqual(b.centro.emitir(.gpsImpreciso, TextoAvisos.gpsImpreciso), .hablado)
        XCTAssertEqual(b.salida.dicho, [TextoAvisos.gpsImpreciso])
        XCTAssertEqual(b.centro.avisos.map(\.tipo), [.gpsImpreciso])
        XCTAssertEqual(b.centro.avisos[0].tipo.severidad, .advertencia)
        XCTAssertEqual(TextoAvisos.gpsImpreciso, "Tu ubicación es imprecisa.", "solo el hecho: la app no promete un comportamiento")

        // Es un resultado puntual de la ubicación: envejece y no toca los avisos de otras fuentes.
        b.centro.emitir(.proximidad, "Objeto a 1 metro.")
        b.reloj.avanzar(10_001)
        XCTAssertEqual(b.vigentes(), [.proximidad])
    }

    func testLaRedCaidaNoImpideAvisosFisicos() {
        let b = BancoCentro()
        b.centro.consultaCambio(.error(.sinConexion))
        XCTAssertEqual(b.centro.emitir(.proximidad, "Objeto a 1 metro."), .hablado, "los avisos del sensor no dependen de la red")
        XCTAssertEqual(b.vigentes(), [.redCaida, .proximidad])
    }

    // MARK: Origen y textos

    func testUnAvisoSimuladoSeRotulaComoSimuladoYNuncaComoPropio() {
        let b = BancoCentro(origen: .simulado)
        b.centro.emitir(.redCaida, TextoAvisos.redCaida)
        let aviso = b.centro.avisos[0]
        XCTAssertEqual(aviso.origen, .simulado)
        let detalle = TextoAvisos.detalle(aviso, vigente: true)
        XCTAssertEqual(detalle, "Advertencia · Escenario simulado · Vigente")
        XCTAssertFalse(detalle.contains("Aviso propio"))
        XCTAssertEqual(TextoAvisos.detalle(aviso, vigente: false), "Advertencia · Escenario simulado · Ya no vigente")
    }

    func testSinFuenteConectadaLaListaNuncaDiceQueNoHayIncidentes() {
        let sinFuente = TextoAvisos.sinFuenteOficial.joined(separator: " ")
        XCTAssertTrue(sinFuente.contains("No hay ninguna fuente de anuncios oficiales conectada"))
        XCTAssertTrue(sinFuente.contains("no se puede saber"))
        for texto in TextoAvisos.sinFuenteOficial + TextoAvisos.sinAvisosPropios {
            let minusculas = texto.lowercased()
            XCTAssertFalse(minusculas.contains("no hay incidentes") || minusculas.contains("sin incidentes"), texto)
        }
        XCTAssertTrue(TextoAvisos.sinAvisosPropios.joined(separator: " ").contains("ni significa que no haya incidentes"))
        XCTAssertTrue(TextoAvisos.sinAvisosPropios.joined(separator: " ").contains("no es un anuncio oficial"))
    }

    func testCadaFraseDeLaPantallaEsUnaSolaOracion() {
        let frases = TextoAvisos.sinFuenteOficial + TextoAvisos.sinAvisosPropios + TextoAvisos.escenarioSimulado
            + TextoAvisos.notaSilencio + [TextoAvisos.avisoModoPruebas, TextoAvisos.yaNoVigente]
        for frase in frases {
            XCTAssertEqual(frase.filter { $0 == "." }.count, 1, "una oración por Text: \(frase)")
            XCTAssertTrue(frase.hasSuffix("."), frase)
        }
    }

    func testLaFilaDeUnAvisoConEnlaceSinAutenticarLoDeclaraEnUnaOracion() {
        let nota = TextoAvisos.enlaceSinAutenticar
        XCTAssertTrue(nota.hasPrefix("Enlace sin autenticar"), nota)
        XCTAssertEqual(nota.filter { $0 == "." }.count, 1, "una oración por Text: \(nota)")
        XCTAssertTrue(nota.hasSuffix("."), nota)
    }
}

/// El módulo de avisos integrado con la sesión del accesorio (transporte y voz falsos: simulación, no hardware).
@MainActor
final class AvisosSesionTests: XCTestCase {
    private let objeto = "Objeto a 1 metro, a la izquierda."

    private func conObjeto(_ banco: BancoAccesorio) throws -> EscenarioBLE {
        let escenario = try EscenarioBLE.cargar("objetivo-distancia-y-azimut")
        banco.iniciar()
        banco.sincronizar(escenario)
        banco.entregar(escenario.entregas[0])
        return escenario
    }

    func testLaProximidadSeListaComoAvisoUrgenteConElTextoDeLaVoz() throws {
        let banco = BancoAccesorio()
        defer { banco.cerrar() }
        _ = try conObjeto(banco)
        let aviso = try XCTUnwrap(banco.modelo.centro.avisos.first)
        XCTAssertEqual(aviso.tipo, .proximidad)
        XCTAssertEqual(aviso.texto, objeto)
        XCTAssertEqual(banco.salida.dicho.last, objeto, "lo que se lista es lo que se dijo")
        XCTAssertEqual(aviso.tipo.severidad, .urgente)
        XCTAssertNil(aviso.caducaMs, "sin temporizador: dura mientras dure el objeto delante")
        XCTAssertFalse(aviso.enlaceSinAutenticar, "enlace autenticado: la fila no declara nada")
        XCTAssertEqual(aviso.textoVoz, objeto)
    }

    func testConEnlaceSinAutenticarLaFilaLoDeclaraYRepetirDiceLaReserva() throws {
        let banco = BancoAccesorio(nivel: .cifradoSinAutenticar)
        defer { banco.cerrar() }
        _ = try conObjeto(banco)
        let centro = banco.modelo.centro
        let aviso = try XCTUnwrap(centro.avisos.first)
        XCTAssertEqual(aviso.texto, objeto, "la lista muestra la medida")
        XCTAssertTrue(aviso.enlaceSinAutenticar, "la fila declara que el enlace no es autenticado")
        XCTAssertEqual(aviso.textoVoz, "\(objeto) \(TextoAccesorio.reservaEnlace)")

        centro.repetir(.proximidad)
        XCTAssertEqual(banco.salida.dicho.last, "\(objeto) \(TextoAccesorio.reservaEnlace)", "repetir no pierde la reserva")
        XCTAssertEqual(centro.resultadoRepeticion, TextoAvisos.repitiendo)
    }

    func testUnAvisoDeLaSesionNoCaducaMientrasDuraSuEstadoYSeCierraAlAcabar() throws {
        let banco = BancoAccesorio()
        defer { banco.cerrar() }
        banco.transporte.emitir(.disponibilidad(.apagado), token: tokenSinConexion)
        banco.iniciar()
        let estado = EstadoAccesorio.bluetoothNoDisponible(.apagado)
        XCTAssertEqual(banco.modelo.estado, estado)
        let centro = banco.modelo.centro
        XCTAssertEqual(centro.avisos.first?.tipo, .accesorioPerdido)
        let dicho = banco.salida.dicho

        banco.reloj.avanzar(600_000)  // diez minutos: muy por encima de cualquier vigencia
        banco.modelo.evaluar()
        XCTAssertEqual(banco.modelo.estado, estado, "el estado no cambió")
        XCTAssertTrue(centro.vigente(try XCTUnwrap(centro.avisos.first)), "sigue siendo verdad: sigue vigente y con «Repetir»")
        XCTAssertEqual(banco.salida.dicho, dicho, "y no se repite solo")

        banco.transporte.emitir(.disponibilidad(.disponible), token: tokenSinConexion)
        banco.modelo.evaluar()
        XCTAssertEqual(banco.modelo.estado, .conectando)
        XCTAssertFalse(centro.vigente(try XCTUnwrap(centro.avisos.first)), "acabó su estado: la sesión lo cierra")
    }

    func testUnObjetoQueDejaDeLlegarCierraLaProximidadYAbreElDatoVencido() throws {
        let banco = BancoAccesorio()
        defer { banco.cerrar() }
        let escenario = try conObjeto(banco)
        banco.reloj.fijar(escenario.entregas[0].instante + 501)
        banco.modelo.evaluar()
        XCTAssertEqual(banco.modelo.estado, .sinDatos(.sinRecepcion))
        let centro = banco.modelo.centro
        let vigentes = centro.avisos.filter { centro.vigente($0) }.map(\.tipo)
        XCTAssertEqual(vigentes, [.datoVencido], "la proximidad cerró y queda el dato vencido")
    }

    func testPerderElAccesorioHablandoCortaLaMedidaYDiceElAvisoUrgente() throws {
        let banco = BancoAccesorio()
        defer { banco.cerrar() }
        _ = try conObjeto(banco)
        XCTAssertTrue(banco.salida.hablando)

        banco.transporte.emitir(.desconectado)
        XCTAssertEqual(banco.salida.cortadas.last, objeto, "la medida que sonaba ya no vale: se corta")
        XCTAssertEqual(banco.salida.dicho.last, "Accesorio desconectado.")
        let centro = banco.modelo.centro
        XCTAssertEqual(centro.avisos.first?.tipo, .accesorioPerdido)
        let proximidad = try XCTUnwrap(centro.avisos.first { $0.tipo == .proximidad })
        XCTAssertFalse(centro.vigente(proximidad), "la medida quedó como aviso anterior")
        XCTAssertTrue(centro.vigente(try XCTUnwrap(centro.avisos.first)))
    }

    func testUnMensajeDeRutinaNoCallaElAvisoYSeDiceElEstadoDeAhoraAlTerminar() throws {
        let banco = BancoAccesorio()
        defer { banco.cerrar() }
        let escenario = try conObjeto(banco)
        banco.transporte.emitir(.desconectado)
        XCTAssertEqual(banco.salida.dicho.last, "Accesorio desconectado.")
        let cortes = banco.salida.cortadas

        // El accesorio vuelve mientras «desconectado» todavía suena: calibrando y sin detección son rutina.
        banco.sincronizar(escenario)
        XCTAssertEqual(banco.modelo.estado, .sinDeteccion)
        XCTAssertEqual(banco.salida.dicho.last, "Accesorio desconectado.", "la rutina no corta el aviso que suena")
        XCTAssertEqual(banco.salida.cortadas, cortes)

        // Al terminar, el próximo latido dice el estado de ahora (no el «calibrando» que quedó atrás).
        banco.salida.terminarSola()
        banco.modelo.evaluar()
        XCTAssertEqual(banco.salida.dicho.last, "Sin detección en este momento.")
        XCTAssertEqual(banco.salida.dicho.filter { $0 == "Accesorio conectado. Calibrando. Aún sin avisos." }.count, 1,
                       "solo la de la primera conexión")
        let centro = banco.modelo.centro
        XCTAssertFalse(centro.vigente(try XCTUnwrap(centro.avisos.first { $0.tipo == .accesorioPerdido })), "la rutina cierra el aviso")
    }

    func testSilenciarLasAdvertenciasNoCallaLaVozUrgenteDeLaSesion() throws {
        let banco = BancoAccesorio()
        defer { banco.cerrar() }
        banco.modelo.centro.silenciarAdvertencias(true)
        _ = try conObjeto(banco)
        XCTAssertEqual(banco.salida.dicho.last, objeto, "lo urgente suena aunque las advertencias estén silenciadas")

        banco.transporte.emitir(.desconectado)
        XCTAssertEqual(banco.salida.dicho.last, "Accesorio desconectado.", "perder el accesorio también")
    }

    func testSuspenderLaSesionCierraSusAvisos() throws {
        let banco = BancoAccesorio()
        defer { banco.cerrar() }
        _ = try conObjeto(banco)
        let centro = banco.modelo.centro
        XCTAssertTrue(centro.vigente(try XCTUnwrap(centro.avisos.first)))
        banco.modelo.escenaActiva(false)
        XCTAssertFalse(centro.vigente(try XCTUnwrap(centro.avisos.first)), "sin sesión no hay aviso vigente")
    }
}
