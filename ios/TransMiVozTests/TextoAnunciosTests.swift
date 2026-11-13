import XCTest
@testable import TransMiVoz

final class TextoAnunciosTests: XCTestCase {
    private func fecha(_ segundos: TimeInterval) -> Date { Date(timeIntervalSince1970: segundos) }

    private func anuncio(
        origen: OrigenAnuncio = .oficial, titulo: String = "Título", descripcion: String = "Descripción",
        fecha: Date? = nil, hasta: Date? = nil, efecto: EfectoAnuncio = .desvio, rutas: [String] = []
    ) -> Anuncio {
        Anuncio(
            origen: origen, entidad: "Entidad Ejemplo", identificador: "A-1", titulo: titulo, descripcion: descripcion,
            fecha: fecha, vigenciaHasta: hasta, afectacion: AfectacionAnuncio(efecto: efecto, rutas: rutas))
    }

    private func fuente(_ estado: EstadoFuente, consultadoEn: Date? = nil, publicadoEn: Date? = nil) -> FuenteAnuncios {
        FuenteAnuncios(
            estado: estado, confianza: .media, entidad: "Entidad Ejemplo S.A.", nombre: "Alertas", url: "https://fuente.ejemplo",
            consultadoEn: consultadoEn, publicadoEn: publicadoEn,
            mensaje: estado == .sinFuente ? "Sin fuente. \(TextoAnuncios.avisoSinGarantia)" : "Primera frase. Segunda frase.")
    }

    // MARK: Fechas

    /// Bogotá es UTC−5 todo el año: las 22:05 UTC son las 17:05, y las 04:59 UTC del día siguiente son las 23:59.
    func testLaFechaVaEnHoraDeBogotaYEn24Horas() {
        XCTAssertEqual(TextoAnuncios.fecha(fecha(1_794_521_100)), "12 de noviembre de 2026, 17:05")
        XCTAssertEqual(TextoAnuncios.fecha(fecha(1_794_545_940)), "12 de noviembre de 2026, 23:59")
        XCTAssertEqual(TextoAnuncios.fecha(fecha(1_794_488_400)), "12 de noviembre de 2026, 08:00")
    }

    func testFechaYVigenciaNuncaInventanUnExtremo() {
        XCTAssertEqual(TextoAnuncios.fechaDeInicio(anuncio()), "Fecha: la fuente no la publica")
        XCTAssertEqual(TextoAnuncios.vigencia(anuncio()), "Sin fecha de fin publicada")
        let completo = anuncio(fecha: fecha(1_794_488_400), hasta: fecha(1_794_521_100))
        XCTAssertEqual(TextoAnuncios.fechaDeInicio(completo), "Fecha: 12 de noviembre de 2026, 08:00")
        XCTAssertEqual(TextoAnuncios.vigencia(completo), "Vigente hasta 12 de noviembre de 2026, 17:05")
    }

    // MARK: Frases

    func testFrasesPartePorPuntoYConservaCadaPunto() {
        XCTAssertEqual(TextoAnuncios.frases("Primera frase. Segunda frase."), ["Primera frase.", "Segunda frase."])
        XCTAssertEqual(TextoAnuncios.frases("Una sola"), ["Una sola"])
        XCTAssertEqual(TextoAnuncios.frases("  Con espacios.   Y más.  "), ["Con espacios.", "Y más."])
        XCTAssertEqual(TextoAnuncios.frases(""), [])
    }

    // MARK: Un anuncio

    func testLaMarcaDistingueElOrigenOficialDelSimulado() {
        let oficial = anuncio()
        XCTAssertEqual(TextoAnuncios.marca(oficial), "Anuncio oficial · Entidad Ejemplo")
        XCTAssertEqual(TextoAnuncios.marcaAccesible(oficial), "Anuncio oficial de Entidad Ejemplo")

        let simulado = anuncio(origen: .simulado)
        XCTAssertEqual(TextoAnuncios.marca(simulado), "Simulado · no es un anuncio del operador")
        XCTAssertEqual(TextoAnuncios.marcaAccesible(simulado), "Anuncio simulado de demostración. No es un anuncio del operador.")
        XCTAssertEqual(
            TextoAnuncios.origenSimulado(simulado),
            "Origen: contenido de demostración publicado por «Entidad Ejemplo», sin ninguna fuente real.")
        XCTAssertFalse(TextoAnuncios.marca(simulado).contains("oficial"))
        XCTAssertFalse(TextoAnuncios.marcaAccesible(simulado).contains("oficial"))
    }

    func testLaDescripcionSoloVaSiDiceAlgoQueElTituloNo() {
        XCTAssertEqual(TextoAnuncios.descripcionUtil(anuncio(titulo: "Cierre", descripcion: "Cierre por obras")), "Cierre por obras")
        XCTAssertNil(TextoAnuncios.descripcionUtil(anuncio(titulo: "Cierre", descripcion: "Cierre")))
        XCTAssertNil(TextoAnuncios.descripcionUtil(anuncio(titulo: "Cierre", descripcion: "")))
    }

    func testServiciosYAfectacion() {
        XCTAssertEqual(TextoAnuncios.afectacion(anuncio(efecto: .sinServicio)), "Afectación: Sin servicio")
        XCTAssertNil(TextoAnuncios.servicios(anuncio(rutas: [])))
        XCTAssertEqual(
            TextoAnuncios.servicios(anuncio(rutas: ["10173", "483A09"])), "Servicios (identificador de la fuente): 10173, 483A09")
        XCTAssertEqual(TextoAnuncios.identificador(anuncio()), "Identificador: A-1")
    }

    func testTodoEfectoTieneEtiquetaPropia() {
        let efectos: [EfectoAnuncio] = [
            .sinServicio, .servicioReducido, .demoras, .desvio, .servicioAdicional, .servicioModificado,
            .otro, .desconocido, .paradaMovida, .sinEfecto, .accesibilidad,
        ]
        let etiquetas = efectos.map(TextoAnuncios.etiqueta)
        XCTAssertEqual(Set(etiquetas).count, efectos.count, "dos efectos no pueden compartir etiqueta")
        XCTAssertFalse(etiquetas.contains(""))
    }

    // MARK: La fuente

    func testLineasDeFuenteConservanLasDosFechas() {
        let completa = fuente(.activa, consultadoEn: fecha(1_794_521_100), publicadoEn: fecha(1_794_488_400))
        XCTAssertEqual(
            TextoAnuncios.lineasDeFuente(completa),
            ["Fuente: Entidad Ejemplo S.A.", "Publicado por la fuente: 12 de noviembre de 2026, 08:00",
             "Última consulta exitosa: 12 de noviembre de 2026, 17:05"])
        // Sin consulta buena no se inventa una fecha.
        XCTAssertEqual(
            TextoAnuncios.lineasDeFuente(fuente(.sinFuente)), ["Fuente: Entidad Ejemplo S.A.", "Última consulta exitosa: ninguna"])
        XCTAssertEqual(TextoAnuncios.lineasDeFuente(nil), [])
    }

    func testLasEtiquetasDeEstadoYConfianzaSeDistinguenPorTexto() {
        let estados = [EstadoFuente.activa, .degradada, .sinFuente].map(TextoAnuncios.etiqueta)
        XCTAssertEqual(Set(estados).count, 3)
        XCTAssertEqual(estados[1], "Fuente con problemas, confianza baja")
        XCTAssertEqual(estados[2], "Sin fuente conectada")
        XCTAssertEqual(
            [ConfianzaFuente.media, .baja, .ninguna].map(TextoAnuncios.etiqueta),
            ["Confianza: media", "Confianza: baja", "Confianza: ninguna"])
    }

    // MARK: Mensajes: nunca «sin incidentes»

    func testSinRespuestaNiFalloDiceQueNoSeHaConsultado() {
        XCTAssertEqual(
            TextoAnuncios.mensaje(respuesta: nil, fallo: nil), [TextoAnuncios.sinConsultar, TextoAnuncios.avisoSinGarantia])
    }

    func testConRespuestaSinFalloMuestraElMensajeDelServidorFraseAFrase() {
        let respuesta = AnunciosRespuesta(fuente: fuente(.activa), anuncios: [])
        XCTAssertEqual(TextoAnuncios.mensaje(respuesta: respuesta, fallo: nil), ["Primera frase.", "Segunda frase."])
    }

    func testFalloConUltimaRespuestaBuenaCitaLaFechaDeLaFuente() {
        let respuesta = AnunciosRespuesta(
            fuente: fuente(.activa, consultadoEn: fecha(1_794_521_100), publicadoEn: fecha(1_794_488_400)), anuncios: [])
        let frases = TextoAnuncios.mensaje(respuesta: respuesta, fallo: .sinConexion)
        XCTAssertEqual(frases, [
            "No pude actualizar los anuncios de TransMilenio.",
            "No hay conexión con el servidor.",
            "Revisa Wi-Fi o datos móviles y pulsa Reintentar.",
            "Muestro lo que la fuente publicó el 12 de noviembre de 2026, 08:00; puede estar desactualizado.",
            TextoAnuncios.avisoSinGarantia,
        ])
    }

    func testFalloSobreUnaRespuestaSinFuenteNoMuestraLaListaConservada() {
        let respuesta = AnunciosRespuesta(fuente: fuente(.sinFuente), anuncios: [])
        let frases = TextoAnuncios.mensaje(respuesta: respuesta, fallo: .sinConexion)
        XCTAssertEqual(frases.first, "No pude consultar los anuncios de TransMilenio.")
        XCTAssertFalse(frases.contains { $0.contains("Muestro") })
    }

    /// Ningún texto de la sección afirma que no haya incidentes, y los que no traen anuncios lo advierten.
    func testNingunEstadoSinAnunciosAfirmaQueNoHayIncidentes() {
        let respuestas: [AnunciosRespuesta?] = [
            nil, AnunciosRespuesta(fuente: fuente(.sinFuente), anuncios: []), AnunciosRespuesta(fuente: fuente(.activa), anuncios: []),
        ]
        let fallos: [ErrorConsulta?] = [nil, .sinConexion, .tiempoAgotado, .noAutorizado, .servidorNoConfigurado, .respuestaIncompatible]
        for respuesta in respuestas {
            for fallo in fallos {
                let frases = TextoAnuncios.mensaje(respuesta: respuesta, fallo: fallo)
                let todo = frases.joined(separator: " ").lowercased()
                XCTAssertFalse(todo.contains("sin incidentes"), "\(String(describing: fallo))")
                XCTAssertFalse(todo.contains("no hay incidentes"), "\(String(describing: fallo))")
                // El mensaje del servidor trae su propia advertencia; los demás la llevan de la app.
                if respuesta?.fuente.estado != .activa || fallo != nil {
                    XCTAssertTrue(frases.contains(TextoAnuncios.avisoSinGarantia), "\(String(describing: respuesta)) \(String(describing: fallo))")
                }
            }
        }
    }

    func testLaRecuperacionNoHablaDeUnaPregunta() {
        let errores: [ErrorConsulta] = [.sinConexion, .tiempoAgotado, .noAutorizado, .servidorNoConfigurado, .errorDelServidor(estado: 500), .respuestaIncompatible, .servicioNoDisponible, .conexionNoSegura, .redireccionNoPermitida, .demasiadasPeticiones(reintentarEnSegundos: 3)]
        for error in errores {
            let texto = TextoAnuncios.recuperacion(error).lowercased()
            XCTAssertFalse(texto.contains("pregunta"), "\(error)")
            XCTAssertFalse(texto.isEmpty, "\(error)")
        }
    }

    // MARK: Anuncio de accesibilidad

    func testElResultadoSeAnunciaConElEstadoYElRecuento() {
        XCTAssertEqual(
            TextoAnuncios.resultado(estado: .activa, cantidad: 2, fallo: false), "Fuente conectada. Hay 2 anuncios vigentes.")
        XCTAssertEqual(
            TextoAnuncios.resultado(estado: .activa, cantidad: 1, fallo: false), "Fuente conectada. Hay 1 anuncio vigente.")
        XCTAssertEqual(
            TextoAnuncios.resultado(estado: .activa, cantidad: 0, fallo: false),
            "Fuente conectada. No hay anuncios vigentes publicados. Esto no significa que no haya novedades en el servicio.")
        XCTAssertEqual(
            TextoAnuncios.resultado(estado: .sinFuente, cantidad: 0, fallo: false),
            "Sin fuente conectada. Esto no significa que no haya novedades en el servicio.")
        XCTAssertEqual(
            TextoAnuncios.resultado(estado: .degradada, cantidad: 2, fallo: true),
            "No pude actualizar los anuncios. Fuente con problemas, confianza baja. Hay 2 anuncios vigentes.")
    }
}
