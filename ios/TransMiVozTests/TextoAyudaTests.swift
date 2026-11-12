import XCTest
@testable import TransMiVoz

final class TextoAyudaTests: XCTestCase {
    private func textoDeAyuda(_ titulo: String) -> String {
        TextoAyuda.secciones.first { $0.titulo == titulo }?.parrafos.joined(separator: " ") ?? ""
    }

    func testAyudaDiceQueElMetroEsUnProyectoFuturoSinServicio() {
        let metro = textoDeAyuda("Metro de Bogotá")
        XCTAssertTrue(metro.contains("proyecto futuro"))
        XCTAssertTrue(metro.contains("no presta servicio"))
    }

    func testAyudaReutilizaElAvisoDeSeguridadDelAccesorio() {
        let accesorio = textoDeAyuda("Accesorio de proximidad")
        XCTAssertTrue(accesorio.hasPrefix(TextoAccesorio.parrafosAvisoEnlace.joined(separator: " ")), "la Ayuda abre con el aviso fijo de la pantalla")
        XCTAssertTrue(accesorio.contains("añade «Enlace sin autenticar.» después de cada medida"))
        XCTAssertTrue(accesorio.contains("y antes de «Calibrando» y «Sin detección»"))
        XCTAssertFalse(accesorio.contains("al empezar cada conexión"), "la reserva también sigue a las medidas")
        XCTAssertFalse(accesorio.contains("bloquea las medidas"), "con la política de demostración la Ayuda no dice que el accesorio bloquea las medidas")
        XCTAssertTrue(accesorio.contains("Si el enlace no se puede comprobar, la app lo bloquea. No se usa ninguna medida. Esto no es una detección ni significa camino libre."))
        // Las dos frases siguen siendo las del bloqueo de la pantalla de Sesión.
        XCTAssertEqual(Array(TextoAccesorio.parrafos(.enlaceNoVerificado).suffix(2)), [TextoAccesorio.sinMedidaPorEnlace, TextoAccesorio.noEsDeteccionNiCaminoLibre])
        XCTAssertTrue(accesorio.contains("no distingue unos auriculares de un altavoz Bluetooth"))
        XCTAssertTrue(accesorio.contains("no reemplaza el bastón ni el perro guía"))
    }

    func testAyudaSoloDiceCaminoLibreParaNegarlo() {
        var resto = TextoAyuda.secciones.flatMap(\.parrafos).joined(separator: " ")[...]
        while let rango = resto.range(of: "camino libre") {
            XCTAssertTrue(resto[..<rango.lowerBound].hasSuffix("ni significa ") || resto[..<rango.lowerBound].hasSuffix("no significa "), "«camino libre» sin negación en: \(resto)")
            resto = resto[rango.upperBound...]
        }
    }

    func testAyudaDiceQueLosAvisosDelSensorVanConLaReservaDelEnlace() {
        let uso = textoDeAyuda("Cómo usarla")
        XCTAssertTrue(uso.contains("se ven y se dicen con una reserva"))
        XCTAssertTrue(uso.contains("el enlace con el accesorio no está autenticado"))
        XCTAssertFalse(uso.contains("bloquea las medidas"))
        XCTAssertFalse(uso.contains("para oír los avisos"))
    }

    @MainActor
    func testAyudaYPreferenciasDicenElTopeRealDeLaReserva() {
        let tope = "como mucho \(SesionAccesorioModelo.maximoReservas) veces por conexión"
        XCTAssertTrue(textoDeAyuda("Accesorio de proximidad").contains(tope))
        XCTAssertTrue(TextoPreferencias.notaVoz.contains(tope))
    }

    func testPreferenciasDiceLoMismoQueLaAyudaSobreLaReserva() {
        XCTAssertTrue(TextoPreferencias.notaVoz.contains("«Enlace sin autenticar.» después de cada medida y antes de «Calibrando» y «Sin detección»"))
        XCTAssertFalse(TextoPreferencias.notaVoz.contains("al empezar cada conexión"))
        XCTAssertTrue(TextoPreferencias.notaVoz.contains("sin detección no significa camino libre"))
        XCTAssertFalse(TextoPreferencias.notaVoz.contains("bloqueado"), "ya no dice que hoy no hay avisos del sensor")
    }

    func testAyudaDiceDondeEstanLasSeccionesDeAjustes() {
        XCTAssertTrue(textoDeAyuda("Cómo usarla").contains("«Más ajustes»"))
    }

    func testAyudaOfreceLosTresNumerosDeEmergenciaComoEnlaces() {
        let llamadas = TextoAyuda.secciones.flatMap(\.llamadas)
        XCTAssertEqual(llamadas.map(\.numero), ["123", "156", "195"])
        XCTAssertEqual(llamadas.map(\.url.absoluteString), ["tel:123", "tel:156", "tel:195"])
    }

    func testAyudaNoTieneSeccionesNiParrafosVacios() {
        XCTAssertFalse(TextoAyuda.secciones.isEmpty)
        for seccion in TextoAyuda.secciones {
            XCTAssertFalse(seccion.titulo.isEmpty)
            XCTAssertFalse(seccion.parrafos.isEmpty)
            XCTAssertFalse(seccion.parrafos.contains { $0.isEmpty })
        }
    }
}
