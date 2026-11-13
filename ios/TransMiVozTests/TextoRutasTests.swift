import XCTest
@testable import TransMiVoz

/// Los textos de rutas y viaje: ninguno ordena subir, bajar ni transbordar, y cada estado del servidor se dice con su
/// propio texto (el candidato no usa las palabras del abordaje).
final class TextoRutasTests: XCTestCase {
    private func plan(_ json: String) throws -> PlanViaje { try decodificarPlanificador(json) }

    private func todosLosPlanes() throws -> [PlanViaje] {
        try [
            FixturesPlanificador.viajeOperativo, FixturesPlanificador.viajeTransbordo, FixturesPlanificador.viajeCandidato,
            FixturesPlanificador.viajeCandidatoConTransbordo, FixturesPlanificador.viajeRecorrido, FixturesPlanificador.viajeSinRecorrido, FixturesPlanificador.viajeMismoLugar,
        ].map(plan)
    }

    func testNingunTextoDelViajeOrdenaSubirBajarNiTransbordar() throws {
        var textos: [String] = []
        for plan in try todosLosPlanes() {
            textos.append(TextoRutas.tituloResultado(plan))
            textos += TextoRutas.notasResultado(plan)
            for tramo in plan.tramos { textos += TextoRutas.filasTramo(tramo) }
            textos += plan.codigosCandidatos.map(TextoRutas.rutaCandidata)
        }
        textos.append(TextoRutas.notaTransbordo)
        for sentido in [SentidoRuta.confirmado, .contradictorio, .sinConfirmar] {
            textos += TextoRutas.avisoSentido(sentido, desde: "Ejemplo Norte", hacia: "Ejemplo Sur")
        }
        for calendario in [CalendarioRuta.opera, .noOpera, .sinVerificar] { textos += TextoRutas.frasesCalendario(calendario) }
        textos += TextoRutas.notaEstaciones(conVerificadas: true) + TextoRutas.notaEstaciones(conVerificadas: false)
        textos += [TextoRutas.catalogoAntiguo, TextoRutas.catalogoAntiguoAyuda, TextoRutas.mapaSinCoordenadas, TextoRutas.mapaNecesitaConexion]

        XCTAssertGreaterThan(textos.count, 25)
        for texto in textos {
            XCTAssertFalse(GuardiaContenido.contieneOrdenDeViaje(texto), texto)
        }
    }

    func testElOperativoNombraAbordajeYDescensoYElCandidatoSoloLasRutas() throws {
        let operativo = try plan(FixturesPlanificador.viajeOperativo)
        let filas = TextoRutas.filasTramo(operativo.tramos[0])
        XCTAssertEqual(filas.first, "Abordaje: Estación Ejemplo Norte")
        XCTAssertEqual(filas[1], "Descenso: Estación Ejemplo Sur")

        let candidato = try plan(FixturesPlanificador.viajeCandidato)
        XCTAssertEqual(candidato.codigosCandidatos.map(TextoRutas.rutaCandidata), ["Ruta Z99"])
        XCTAssertEqual(TextoRutas.tituloResultado(candidato), "Servicio candidato de Estación Ejemplo Norte a Estación Ejemplo Sur")
        XCTAssertTrue(TextoRutas.notasResultado(candidato)[0].hasPrefix("Según la programación verificada, esta ruta conecta"))
        XCTAssertTrue(TextoRutas.notasResultado(candidato).contains { $0.contains("no se dan indicaciones de abordaje") })
        let varias = try plan(FixturesPlanificador.viajeCandidatoConTransbordo)
        XCTAssertTrue(TextoRutas.notasResultado(varias)[0].contains("estas rutas conectan"))
    }

    func testElRecorridoDiceQueNoHayParadasConfirmadas() throws {
        let recorrido = try plan(FixturesPlanificador.viajeRecorrido)
        XCTAssertTrue(TextoRutas.notasResultado(recorrido)[0].contains("Todavía no se tiene confirmado dónde para cada servicio"))
        XCTAssertEqual(TextoRutas.tituloResultado(recorrido), "Recorrido sin paradas confirmadas")
    }

    func testElConteoSoloDiceElNumeroSiElServidorLoVerifica() throws {
        let operativo = try plan(FixturesPlanificador.viajeOperativo).tramos[0]
        XCTAssertEqual(TextoRutas.conteo(operativo), "3 estaciones (conteo verificado)")
        let transbordo = try plan(FixturesPlanificador.viajeTransbordo).tramos
        XCTAssertEqual(TextoRutas.conteo(transbordo[1]), "Número de estaciones no verificado")
        XCTAssertEqual(TextoRutas.conteo(TramoPlan(
            codigoRuta: "Z99", abordaje: transbordo[0].abordaje, descenso: transbordo[0].descenso,
            estacionesRecorridas: 1, conteoVerificado: true, trazado: [])), "1 estación (conteo verificado)")
    }

    func testElSentidoSoloSeAfirmaConfirmado() {
        XCTAssertTrue(TextoRutas.avisoSentido(.confirmado, desde: "A", hacia: "B").isEmpty)
        XCTAssertTrue(TextoRutas.avisoSentido(.contradictorio, desde: "A", hacia: "B")[0].contains("no coincide con el orden"))
        XCTAssertTrue(TextoRutas.avisoSentido(.sinConfirmar, desde: "A", hacia: "B")[0].contains("todavía no está confirmado"))
    }

    func testUnCalendarioSinVerificarNoDiceQueNoHayServicio() {
        let frases = TextoRutas.frasesCalendario(.sinVerificar).joined(separator: " ")
        XCTAssertTrue(frases.contains("No confirma si opera ahora"))
        XCTAssertFalse(frases.contains("no tiene servicio"))
        XCTAssertTrue(TextoRutas.frasesCalendario(.noOpera)[0].contains("hoy no tiene servicio programado"))
    }

    func testElHorarioNoPublicadoSeDice() {
        XCTAssertEqual(TextoRutas.filaHorario("Sábados", ""), "Sábados: No publicado")
        XCTAssertEqual(TextoRutas.filaHorario("Sábados", " 6:00 a. m. "), "Sábados: 6:00 a. m.")
    }

    func testElResumenDeLaBusquedaConcuerdaEnNumeroYDiceSiSeCorto() {
        XCTAssertEqual(TextoRutas.resumenBusqueda(mostradas: 1, total: 1), "1 ruta encontrada")
        XCTAssertEqual(TextoRutas.resumenBusqueda(mostradas: 3, total: 3), "3 rutas encontradas")
        XCTAssertEqual(TextoRutas.resumenBusqueda(mostradas: 50, total: 63), "Se muestran 50 de 63 rutas.")
    }
}
