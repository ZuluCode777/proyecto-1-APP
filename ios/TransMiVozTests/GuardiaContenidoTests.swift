import XCTest
@testable import TransMiVoz

/// Casos sintéticos de la guardia de contenido. Repiten los de
/// `lib/local-agent.test.ts` («contieneImperativoDeViaje distingue órdenes de
/// frases de incertidumbre» y «regresión diagnóstico…») para que la app y la web
/// decidan igual; si esa política cambia, cambian ambos juegos de casos.
final class GuardiaContenidoTests: XCTestCase {
    static let ordenes = [
        "Toma la H72 en Calle 127 y bájate en Portal Usme.",
        "Sube en Calle 127",
        "Bájate en Portal Usme",
        "cambia a la Q1 hasta Eco",
        // Variantes de mayúsculas, tildes, puntuación y espacios.
        "BÁJATE EN Portal Usme",
        "SUBE EN Calle 127",
        "toma  la H72,   en Calle 127",
        "Toma\u{00A0}la\u{00A0}H72\nen Calle 127",
        "Cambia en Portal Usme",
        "Primero: toma la H72. Después, en Calle 127 baja.",
    ]

    /// Abstenciones y neutros que mencionan subir/bajar/abordaje sin ordenar nada.
    static let neutros = [
        "no puedo decirte con certeza dónde subir o bajar",
        "no te doy indicaciones de abordaje",
        "las rutas B72 y H72 pasan cerca de los dos lugares",
        "No puedo decirte con certeza dónde subir o bajar; confirma con TransMilenio.",
        "Busqué recorridos que conectan ambos lugares",
        "Ese servicio abordaje no está confirmado.",
        "Esta app no da órdenes de abordaje.",
        "Hola, soy TransMiVoz de prueba.",
    ]

    func testDetectaOrdenesDeViaje() {
        for texto in Self.ordenes {
            XCTAssertTrue(GuardiaContenido.contieneOrdenDeViaje(texto), texto)
        }
    }

    func testNoMarcaFrasesNeutrasQueMencionanAbordaje() {
        for texto in Self.neutros {
            XCTAssertFalse(GuardiaContenido.contieneOrdenDeViaje(texto), texto)
        }
    }

    func testElAvisoSeguroNoContieneOrdenes() {
        XCTAssertFalse(GuardiaContenido.contieneOrdenDeViaje(GuardiaContenido.avisoNoConfirmable))
    }

    func testBordeDePalabraComoJavaScript() {
        // `\b` ASCII: una letra pegada delante o detrás no es una orden...
        XCTAssertFalse(GuardiaContenido.contieneOrdenDeViaje("resube en la mañana"))
        XCTAssertFalse(GuardiaContenido.contieneOrdenDeViaje("cambiara en tiempo"))
        // ...pero una letra no ASCII pegada SÍ separa palabras en JavaScript.
        XCTAssertTrue(GuardiaContenido.contieneOrdenDeViaje("ж sube en Calle 127"))
        XCTAssertTrue(GuardiaContenido.contieneOrdenDeViaje("жsube en Calle 127"))
    }

    // MARK: Respuestas completas (texto + pasos), como `respuestaSinImperativos`

    private func busqueda(_ texto: String, pasos: [PasoAgente] = []) -> RespuestaAgente {
        RespuestaAgente(texto: texto, pasos: pasos, motor: .reglas, accion: .busqueda(estacion: "Portal Usme"))
    }

    func testAbstencionConOrdenEnElTextoSeRechaza() {
        let r = busqueda("Toma la H72 en Calle 127 y bájate en Portal Usme.")
        XCTAssertFalse(GuardiaContenido.esSegura(r))
        XCTAssertEqual(r.saneada(), RespuestaAgente(texto: GuardiaContenido.avisoNoConfirmable, motor: .reglas))
    }

    func testTextoNeutroConOrdenEnUnPasoSeRechazaYSeOmitenLosPasos() {
        let r = busqueda("Esto es solo recorrido.", pasos: [PasoAgente(etiqueta: "Sube en Calle 127", detalle: "Bájate en Portal Usme")])
        XCTAssertFalse(GuardiaContenido.esSegura(r))
        let saneada = r.saneada()
        XCTAssertEqual(saneada.texto, GuardiaContenido.avisoNoConfirmable)
        XCTAssertTrue(saneada.pasos.isEmpty)
        XCTAssertEqual(saneada.accion, .ninguna)
    }

    func testOrdenSoloEnElDetalleDeUnPasoSeRechaza() {
        let r = busqueda("Recorrido informativo.", pasos: [PasoAgente(etiqueta: "Listo", detalle: "cambia a la Q1")])
        XCTAssertFalse(GuardiaContenido.esSegura(r))
    }

    func testAbstencionSeguraPasaIntacta() {
        let r = busqueda(
            "No puedo decirte con certeza dónde subir o bajar; confirma con TransMilenio.",
            pasos: [PasoAgente(etiqueta: "Busqué recorridos que conectan ambos lugares", detalle: nil)])
        XCTAssertTrue(GuardiaContenido.esSegura(r))
        XCTAssertEqual(r.saneada(), r)
    }

    func testRespuestasNeutrasDeCadaAccionPasanIntactas() {
        for accion: AccionAgente in [.ninguna, .frecuentes, .gps, .busqueda(estacion: "Estación Ejemplo Norte"), .ruta(codigo: "Z99")] {
            let r = RespuestaAgente(texto: "Esta app no da órdenes de abordaje.", accion: accion)
            XCTAssertEqual(r.saneada(), r)
        }
    }

    func testUnViajeSePresentaComoInformacionYNoSeToca() {
        let tramo = TramoViaje(codigoRuta: "Z99", estacionAbordaje: "A", estacionDescenso: "B", estacionesRecorridas: 3, conteoVerificado: false)
        // Su texto y pasos no se muestran (la vista solo pinta los tramos), así que no se alteran.
        let r = RespuestaAgente(texto: "Toma la Z99 en A", pasos: [PasoAgente(etiqueta: "Sube en A", detalle: nil)], accion: .viaje([tramo]))
        XCTAssertEqual(r.saneada(), r)
    }
}
