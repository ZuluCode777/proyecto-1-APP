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

/// Banco del módulo de avisos: voz, ruta, reloj y avisos accesibles falsos (simulación).
@MainActor
private struct BancoCentro {
    let salida = SalidaVozFalsa()
    let ruta = RutaFalsa(.privada)
    let reloj = RelojFalso()
    let accesibles = AvisosFalsos()
    let voz: ControlVoz
    let centro: CentroAvisos

    init(origen: OrigenAviso = .propio) {
        let rutaCapturada = ruta
        voz = ControlVoz(salida: salida, consultarRuta: { rutaCapturada.valor })
        let relojCapturado = reloj
        centro = CentroAvisos(voz: voz, avisos: accesibles.avisos, reloj: { relojCapturado.ahora }, origen: origen)
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
        XCTAssertTrue(TipoAviso.allCases.allSatisfy { $0.vigenciaMs > 0 })
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

    func testUnAvisoCaducaSeRenuevaMientrasSigueYAlReaparecerVuelveADecirse() {
        let b = BancoCentro()
        let vigencia = TipoAviso.redCaida.vigenciaMs
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

    func testElLimiteEsPorClaseYPedirloLoSalta() {
        let b = BancoCentro()
        for n in 1...CentroAvisos.maximoVocesPorVentana { b.centro.emitir(.proximidad, "Objeto a \(n) metros.") }
        XCTAssertEqual(b.centro.emitir(.proximidad, "Objeto a 99 metros."), .limitado)
        XCTAssertEqual(b.centro.emitir(.datoVencido, "Sin datos del sensor."), .hablado, "otra clase tiene su propio cupo")
        XCTAssertEqual(b.centro.emitir(.proximidad, "Objeto a 99 metros.", repitiendo: true), .hablado)
    }

    // MARK: Silenciar según severidad y repetir

    func testSilenciarLaVozDeUnaSeveridadNoLaOcultaDeLaListaNiCallaLasOtras() {
        let b = BancoCentro()
        b.centro.silenciar(.advertencia, true)
        XCTAssertTrue(b.centro.silenciada(.advertencia))
        XCTAssertEqual(b.centro.emitir(.redCaida, TextoAvisos.redCaida), .silenciado(.severidadSilenciada))
        XCTAssertTrue(b.salida.dicho.isEmpty)
        XCTAssertEqual(b.centro.avisos.map(\.tipo), [.redCaida])
        XCTAssertEqual(b.centro.emitir(.proximidad, "Objeto a 1 metro."), .hablado, "lo urgente sigue sonando")

        b.centro.silenciar(.advertencia, false)
        XCTAssertFalse(b.centro.silenciada(.advertencia))
        XCTAssertEqual(b.centro.emitir(.datosViejos, TextoAvisos.datosViejos), .silenciado(.cedeAUnAviso), "suena el urgente")
    }

    func testRepetirDiceElAvisoVigenteAunSilenciadoYExplicaPorQueNoSeDijo() {
        let b = BancoCentro()
        b.centro.silenciar(.advertencia, true)
        b.centro.emitir(.redCaida, TextoAvisos.redCaida)
        XCTAssertTrue(b.salida.dicho.isEmpty)

        b.centro.repetir(.redCaida)
        XCTAssertEqual(b.salida.dicho, [TextoAvisos.redCaida], "repetir es una orden: ignora el silencio")
        XCTAssertEqual(b.centro.resultadoRepeticion, TextoAvisos.repitiendo)
        XCTAssertTrue(b.accesibles.anuncios.isEmpty, "ya suena: no se anuncia encima")
        XCTAssertEqual(b.centro.repeticiones, 1)

        b.ruta.valor = .noPrivada
        b.centro.repetir(.redCaida)
        XCTAssertEqual(b.salida.dicho.count, 1, "sin salida privada no se dice")
        XCTAssertEqual(b.centro.resultadoRepeticion, TextoAvisos.noSeDijo(.rutaNoPrivada))
        XCTAssertEqual(b.accesibles.anuncios, [TextoAvisos.noSeDijo(.rutaNoPrivada)], "se anuncia el motivo")
        XCTAssertEqual(b.centro.repeticiones, 2)

        b.ruta.valor = .privada
        b.reloj.avanzar(TipoAviso.redCaida.vigenciaMs + 1)
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

    func testSilenciarLaVozUrgenteNoOcultaElAvisoYAlEncenderlaSeDiceElEstadoDeAhora() throws {
        let banco = BancoAccesorio()
        defer { banco.cerrar() }
        banco.modelo.centro.silenciar(.urgente, true)
        _ = try conObjeto(banco)
        XCTAssertFalse(banco.salida.dicho.contains(objeto), "silenciado: no suena")
        XCTAssertEqual(banco.modelo.centro.avisos.first?.texto, objeto, "pero consta en la lista")

        banco.modelo.centro.silenciar(.urgente, false)
        banco.modelo.fijarVozPropia(true)  // `reanunciar`: el estado de ahora
        XCTAssertEqual(banco.salida.dicho.last, objeto)
        XCTAssertEqual(banco.modelo.centro.avisos.count, 1, "repetir el estado no duplica la lista")
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
