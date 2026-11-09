import ContratoBLE
import XCTest
@testable import TransMiVoz

@MainActor
final class ControlVozTests: XCTestCase {
    private func crear(_ ruta: RutaAudio) -> (ControlVoz, SalidaVozFalsa, RutaFalsa) {
        let salida = SalidaVozFalsa()
        let rutaFalsa = RutaFalsa(ruta)
        return (ControlVoz(salida: salida, consultarRuta: { rutaFalsa.valor }), salida, rutaFalsa)
    }

    func testClasificaLaRutaDeAudio() {
        XCTAssertEqual(RutaAudio.clasificar([.auricularCableado]), .privada)
        XCTAssertEqual(RutaAudio.clasificar([.bluetooth]), .privada)
        XCTAssertEqual(RutaAudio.clasificar([.altavozIntegrado]), .noPrivada)
        XCTAssertEqual(RutaAudio.clasificar([.receptor]), .noPrivada)
        XCTAssertEqual(RutaAudio.clasificar([.otra]), .noPrivada)
        XCTAssertEqual(RutaAudio.clasificar([.bluetooth, .altavozIntegrado]), .noPrivada, "una sola salida pública basta")
        XCTAssertEqual(RutaAudio.clasificar([]), .desconocida)
    }

    func testSoloSeHablaPorRutaPrivada() {
        for ruta in [RutaAudio.noPrivada, .desconocida] {
            let (control, salida, _) = crear(ruta)
            XCTAssertEqual(control.anunciar("hola"), .silenciado(.rutaNoPrivada))
            XCTAssertTrue(salida.dicho.isEmpty, "\(ruta)")
        }
        let (control, salida, _) = crear(.privada)
        XCTAssertEqual(control.anunciar("hola"), .hablado)
        XCTAssertEqual(salida.dicho, ["hola"])
    }

    func testLaRutaSeConsultaEnCadaLocucion() {
        let (control, salida, ruta) = crear(.privada)
        ruta.valor = .noPrivada  // se perdieron los auriculares sin que llegara aviso
        XCTAssertEqual(control.anunciar("a"), .silenciado(.rutaNoPrivada))
        XCTAssertTrue(salida.dicho.isEmpty)
    }

    func testLaColaEsDeUnoCadaLocucionCortaLaAnterior() {
        let (control, salida, _) = crear(.privada)
        control.anunciar("a")
        control.anunciar("b")
        XCTAssertEqual(salida.llamadas, ["detener", "hablar:a", "detener", "hablar:b"])
    }

    func testUnaLocucionSilenciadaTambienCortaLaVieja() {
        let (control, salida, ruta) = crear(.privada)
        control.anunciar("a")
        ruta.valor = .noPrivada
        control.anunciar("b")
        XCTAssertEqual(salida.llamadas.last, "detener")
        XCTAssertEqual(salida.dicho, ["a"])
    }

    func testCambioDeRutaCortaYSoloAvisaAlRecuperarLosAuriculares() {
        let (control, salida, ruta) = crear(.privada)
        var avisos = 0
        control.alRecuperarse = { avisos += 1 }
        control.anunciar("a")

        ruta.valor = .noPrivada  // se desconectan los auriculares
        control.rutaCambio()
        XCTAssertEqual(salida.llamadas.last, "detener")
        XCTAssertEqual(control.ruta, .noPrivada)
        XCTAssertEqual(avisos, 0)

        ruta.valor = .privada
        control.rutaCambio()
        XCTAssertEqual(avisos, 1)
        XCTAssertEqual(salida.dicho, ["a"], "no se reproduce lo que quedó pendiente")
    }

    func testInterrupcionCortaSilenciaYAlTerminarAvisa() {
        let (control, salida, _) = crear(.privada)
        var avisos = 0
        control.alRecuperarse = { avisos += 1 }
        control.anunciar("a")
        control.interrupcion(comenzo: true)
        XCTAssertTrue(control.interrumpido)
        XCTAssertEqual(salida.llamadas.last, "detener")
        XCTAssertEqual(control.anunciar("b"), .silenciado(.interrumpido))
        XCTAssertEqual(salida.dicho, ["a"])

        control.interrupcion(comenzo: false)
        XCTAssertFalse(control.interrumpido)
        XCTAssertEqual(avisos, 1)
        XCTAssertEqual(control.anunciar("c"), .hablado)
    }

    func testSiElSistemaNoDejaActivarLaSesionNoSeAfirmaQueSeHablo() {
        let (control, salida, _) = crear(.privada)
        salida.resultado = .sesionNoDisponible
        XCTAssertEqual(control.anunciar("a"), .silenciado(.audioNoDisponible))
        XCTAssertTrue(control.audioNoDisponible)
        XCTAssertTrue(salida.dicho.isEmpty)

        salida.resultado = .iniciada
        XCTAssertEqual(control.anunciar("b"), .hablado)
        XCTAssertFalse(control.audioNoDisponible)
    }

    func testSiAlActivarLaRutaYaNoEsPrivadaSeSilenciaSinMarcarAudioNoDisponible() {
        let salida = SalidaVozFalsa()
        salida.resultado = .rutaNoPrivada  // el sintetizador comprobó la ruta tras activar y ya no era privada
        var consultas = 0
        // Crear, y la consulta previa a hablar: privada. La que sigue al aviso del sintetizador: ya no.
        let control = ControlVoz(salida: salida, consultarRuta: { consultas += 1; return consultas <= 2 ? .privada : .noPrivada })
        XCTAssertEqual(control.anunciar("a"), .silenciado(.rutaNoPrivada))
        XCTAssertTrue(salida.llamadas.contains("intento:a"), "sí intentó hablar: la ruta cambió al activar")
        XCTAssertFalse(control.audioNoDisponible)
        XCTAssertEqual(control.ruta, .noPrivada)
        XCTAssertTrue(salida.dicho.isEmpty)
    }

    func testVozPropiaApagadaNoHablaPeroLaRutaSigueConsultada() {
        let (control, salida, _) = crear(.privada)
        control.permitida = { false }
        XCTAssertEqual(control.anunciar("a"), .silenciado(.vozApagada))
        XCTAssertTrue(salida.dicho.isEmpty)
    }

    func testCortarPorRutaConLaRutaPrivadaIntactaAvisaSoloSiHabiaLocucion() {
        let (control, salida, _) = crear(.privada)
        var avisos = 0
        control.alRecuperarse = { avisos += 1 }
        control.rutaCambio()
        XCTAssertEqual(avisos, 0, "nada sonaba: nada que repetir")
        control.anunciar("a")
        control.rutaCambio()
        XCTAssertEqual(avisos, 1, "sonaba y el sistema la cortó: se dice el estado de ahora")
        salida.terminarSola()
        control.rutaCambio()
        XCTAssertEqual(avisos, 1)
    }

    func testPerderLaRutaPrivadaAvisaUnaVez() {
        let (control, _, ruta) = crear(.privada)
        var perdidas = 0
        control.alPerderRuta = { perdidas += 1 }
        ruta.valor = .noPrivada
        control.rutaCambio()
        control.rutaCambio()
        XCTAssertEqual(perdidas, 1)
    }

    func testLaVueltaAPrimerPlanoLimpiaUnaInterrupcionSinFinSinAvisarALaSesion() {
        let (control, _, _) = crear(.privada)
        var avisos = 0
        control.alRecuperarse = { avisos += 1 }
        control.interrupcion(comenzo: true)
        control.escenaVolvio()
        XCTAssertFalse(control.interrumpido)
        XCTAssertEqual(avisos, 0, "la propia vuelta a primer plano ya dice el estado")
        XCTAssertEqual(control.anunciar("a"), .hablado)
    }

    func testFinDeInterrupcionSinAuricularesNoAvisa() {
        let (control, _, ruta) = crear(.noPrivada)
        var avisos = 0
        control.alRecuperarse = { avisos += 1 }
        ruta.valor = .noPrivada
        control.interrupcion(comenzo: true)
        control.interrupcion(comenzo: false)
        XCTAssertEqual(avisos, 0)
    }
}

/// Quién libera la sesión de audio al cortar o terminar locuciones (el sistema avisa tarde y en otro orden).
final class TurnoLocucionTests: XCTestCase {
    func testCortarYLlegarElAvisoDeLaCanceladaLiberaSiNoHayOtraMasNueva() {
        var turno = TurnoLocucion<Int>()
        turno.empezar(1)
        XCTAssertFalse(turno.detener(sistemaCancelo: true), "todavía no: la locución se está cancelando")
        XCTAssertFalse(turno.hablando)
        XCTAssertTrue(turno.terminar(1), "didCancel sin otra locución: ahora sí se libera")
    }

    func testElAvisoDeLaCanceladaNuncaLiberaLaSesionDeUnaMasNueva() {
        var turno = TurnoLocucion<Int>()
        turno.empezar(1)
        _ = turno.detener(sistemaCancelo: true)
        turno.empezar(2)
        XCTAssertFalse(turno.terminar(1), "la sesión es de la locución 2")
        XCTAssertTrue(turno.hablando)
        XCTAssertTrue(turno.terminar(2))
    }

    func testSiElSistemaNoTeniaNadaQueCortarSeLiberaYa() {
        var turno = TurnoLocucion<Int>()
        turno.empezar(1)
        XCTAssertTrue(turno.detener(sistemaCancelo: false))
        XCTAssertFalse(turno.terminar(1), "un aviso sin dueño no libera")
    }

    func testAvisosDeLocucionesDesconocidasYDetenerEnVacioNoHacenNada() {
        var turno = TurnoLocucion<Int>()
        XCTAssertFalse(turno.detener(sistemaCancelo: true))
        XCTAssertFalse(turno.terminar(9))
        turno.empezar(1)
        XCTAssertFalse(turno.terminar(9))
        XCTAssertTrue(turno.terminar(1), "didFinish de la vigente libera")
        XCTAssertFalse(turno.hablando)
    }

    func testCortarDosVecesSeguidasSoloEsperaElAvisoDeLaUltimaCancelada() {
        var turno = TurnoLocucion<Int>()
        turno.empezar(1)
        _ = turno.detener(sistemaCancelo: true)
        turno.empezar(2)
        _ = turno.detener(sistemaCancelo: true)
        XCTAssertFalse(turno.terminar(1), "la 1 ya quedó atrás")
        XCTAssertTrue(turno.terminar(2))
    }
}

final class ClasificadorValoresTests: XCTestCase {
    func testSinNotificacionesLaRespuestaEsLaLectura() {
        var c = ClasificadorValores()
        XCTAssertTrue(c.pedirLectura())
        XCTAssertEqual(c.recibirValor(conError: false), .respuestaLectura)
    }

    func testNoSePideLecturaConNotificacionesActivas() {
        var c = ClasificadorValores()
        c.confirmarNotificaciones(true)
        XCTAssertFalse(c.pedirLectura(), "no habría forma de distinguir la respuesta")
        XCTAssertEqual(c.recibirValor(conError: false), .notificacion)
    }

    func testValoresSinLecturaNiNotificacionesConfirmadasSeDescartan() {
        var c = ClasificadorValores()
        XCTAssertEqual(c.recibirValor(conError: false), .descartar)
        c.confirmarNotificaciones(true)
        c.confirmarNotificaciones(false)
        XCTAssertEqual(c.recibirValor(conError: false), .descartar, "tras apagarlas nada llega como notificación")
    }

    func testSoloCuentaLaRespuestaALaUltimaLecturaPedida() {
        var c = ClasificadorValores()
        XCTAssertTrue(c.pedirLectura())
        XCTAssertTrue(c.pedirLectura())
        XCTAssertEqual(c.recibirValor(conError: false), .descartar, "respuesta tardía de la primera")
        XCTAssertEqual(c.recibirValor(conError: false), .respuestaLectura)
        XCTAssertEqual(c.recibirValor(conError: false), .descartar)
    }

    func testErroresDeLectura() {
        var c = ClasificadorValores()
        XCTAssertTrue(c.pedirLectura())
        XCTAssertEqual(c.recibirValor(conError: true), .falloLectura)
        XCTAssertTrue(c.pedirLectura())
        XCTAssertTrue(c.pedirLectura())
        XCTAssertEqual(c.recibirValor(conError: true), .descartar, "el error de una lectura ya superada no falla la sesión")
        c.confirmarNotificaciones(true)
        XCTAssertEqual(c.recibirValor(conError: false), .respuestaLectura, "pendiente de la última: gana la lectura")
        XCTAssertEqual(c.recibirValor(conError: true), .descartar, "error de notificación")
    }

    func testReiniciarOlvidaTodo() {
        var c = ClasificadorValores()
        XCTAssertTrue(c.pedirLectura())
        c.confirmarNotificaciones(true)
        c.reiniciar()
        XCTAssertFalse(c.notificando)
        XCTAssertEqual(c.recibirValor(conError: false), .descartar)
    }
}

final class TextoAccesorioTests: XCTestCase {
    private let todos: [EstadoAccesorio] = [
        .sinAccesorio, .detenido, .bluetoothNoDisponible(.apagado), .bluetoothNoDisponible(.sinPermiso),
        .bluetoothNoDisponible(.restringido), .bluetoothNoDisponible(.noSoportado), .conectando, .conectado,
        .calibrando, .enlaceNoVerificado, .rechazado(.enlaceNoAutenticado), .falla(.tiempoAgotado),
        .falla(.conexionFallida), .falla(.servicioNoEncontrado), .falla(.errorDeLectura),
        .falla(.errorDeSuscripcion), .falla(.referenciaNoValida), .desconectado, .sinDeteccion, .presencia,
        .objetivo(distanciaMm: 1200, azimutCentesimas: -3000), .objetivo(distanciaMm: 900, azimutCentesimas: nil),
        .sinDatos(.sinRecepcion), .sinDatos(.vencido), .sinDatos(.sinResultado), .radarNoDisponible(.iniciando),
    ]

    func testNingunTextoDiceCaminoLibreSinNegarlo() {
        for estado in todos {
            for texto in [TextoAccesorio.descripcion(estado), TextoAccesorio.locucion(estado)?.texto ?? ""] {
                let minusculas = texto.lowercased()
                XCTAssertFalse(minusculas.contains("camino libre") && !minusculas.contains("ni significa") && !minusculas.contains("no significa"), texto)
                XCTAssertFalse(minusculas.contains("sin obstáculos"), texto)
                XCTAssertFalse(minusculas.contains("simulad"), "el accesorio es real: \(texto)")
            }
            XCTAssertFalse(TextoAccesorio.descripcion(estado).isEmpty)
            XCTAssertFalse(TextoAccesorio.titulo(estado).isEmpty)
        }
    }

    func testLosCincoEstadosPedidosSeDistinguenEnPantallaYEnVoz() {
        let cinco: [EstadoAccesorio] = [.calibrando, .sinDeteccion, .falla(.tiempoAgotado), .desconectado, .objetivo(distanciaMm: 1000, azimutCentesimas: nil)]
        XCTAssertEqual(Set(cinco.map(TextoAccesorio.titulo)).count, cinco.count)
        XCTAssertEqual(Set(cinco.map(TextoAccesorio.descripcion)).count, cinco.count)
        XCTAssertEqual(Set(cinco.compactMap { TextoAccesorio.locucion($0)?.texto }).count, cinco.count)
        XCTAssertNotNil(TextoAccesorio.locucion(.calibrando), "«conectado» se dice dentro de «calibrando»")
    }

    func testCadaMotivoDeBluetoothTieneSuMensaje() {
        let mensajes = [DisponibilidadBluetooth.apagado, .sinPermiso, .restringido, .noSoportado, .disponible, .desconocida].map(TextoAccesorio.bluetooth)
        XCTAssertEqual(Set(mensajes).count, mensajes.count)
    }

    func testLaDistanciaHabladaSeRedondeaAMedioMetro() {
        XCTAssertEqual(TextoAccesorio.distanciaHablada(100), "menos de medio metro")
        XCTAssertEqual(TextoAccesorio.distanciaHablada(250), "0,5 metros")
        XCTAssertEqual(TextoAccesorio.distanciaHablada(740), "0,5 metros")
        XCTAssertEqual(TextoAccesorio.distanciaHablada(750), "1 metro")
        XCTAssertEqual(TextoAccesorio.distanciaHablada(1200), "1 metro")
        XCTAssertEqual(TextoAccesorio.distanciaHablada(1500), "1,5 metros")
        XCTAssertEqual(TextoAccesorio.distanciaHablada(2000), "2 metros")
    }

    func testElLadoSeDiceEnTresSectores() {
        XCTAssertEqual(TextoAccesorio.locucion(.objetivo(distanciaMm: 2000, azimutCentesimas: -499))?.texto, "Objeto a 2 metros, al frente.")
        XCTAssertEqual(TextoAccesorio.locucion(.objetivo(distanciaMm: 2000, azimutCentesimas: -500))?.texto, "Objeto a 2 metros, a la izquierda.")
        XCTAssertEqual(TextoAccesorio.locucion(.objetivo(distanciaMm: 2000, azimutCentesimas: 500))?.texto, "Objeto a 2 metros, a la derecha.")
        XCTAssertEqual(TextoAccesorio.locucion(.objetivo(distanciaMm: 2000, azimutCentesimas: nil))?.texto, "Objeto a 2 metros.")
    }

    func testSoloLosEstadosQueNoSonMedidasSeAnuncianPorAccesibilidad() {
        let anunciables: [EstadoAccesorio] = [
            .enlaceNoVerificado, .rechazado(.enlaceNoAutenticado), .falla(.tiempoAgotado), .desconectado,
            .bluetoothNoDisponible(.apagado), .bluetoothNoDisponible(.sinPermiso),
        ]
        for estado in anunciables { XCTAssertNotNil(TextoAccesorio.anuncioAccesible(estado), "\(estado)") }
        let sensor: [EstadoAccesorio] = [
            .sinDeteccion, .presencia, .objetivo(distanciaMm: 1000, azimutCentesimas: nil), .sinDatos(.vencido),
            .radarNoDisponible(.iniciando), .conectando, .calibrando, .conectado, .detenido, .sinAccesorio,
        ]
        for estado in sensor { XCTAssertNil(TextoAccesorio.anuncioAccesible(estado), "\(estado)") }
        XCTAssertEqual(Set(anunciables.compactMap(TextoAccesorio.anuncioAccesible)).count, anunciables.count, "cada estado anunciable tiene su texto")
    }

    func testElTextoDeAudioDistingueCadaSituacionYNoLlamaAuricularesATodoLoPrivado() {
        let textos = [
            TextoAccesorio.audio(ruta: .privada, interrumpido: false),
            TextoAccesorio.audio(ruta: .noPrivada, interrumpido: false),
            TextoAccesorio.audio(ruta: .desconocida, interrumpido: false),
            TextoAccesorio.audio(ruta: .privada, interrumpido: true),
            TextoAccesorio.audio(ruta: .privada, interrumpido: false, audioNoDisponible: true),
            TextoAccesorio.audio(ruta: .privada, interrumpido: false, vozPropia: false),
        ]
        XCTAssertEqual(Set(textos).count, textos.count)
        XCTAssertTrue(textos[0].contains("no distingue"), "un altavoz Bluetooth se ve igual que unos auriculares")
        XCTAssertFalse(textos[0].hasPrefix("Audio: auriculares"))
    }

    func testElEstadoQueNoMideNadaNoTieneAvisoDeSensor() {
        for estado in [EstadoAccesorio.enlaceNoVerificado, .calibrando, .conectando, .desconectado, .falla(.errorDeLectura), .rechazado(.enlaceNoAutenticado)] {
            let texto = TextoAccesorio.locucion(estado)?.texto ?? ""
            XCTAssertFalse(texto.hasPrefix("Objeto") || texto.hasPrefix("Presencia") || texto.hasPrefix("Sin detección"), texto)
        }
    }
}

/// La app no promete segundo plano: sin modos de fondo y con el permiso de Bluetooth explicado.
final class InfoPlistAccesorioTests: XCTestCase {
    func testSinModosDeSegundoPlanoYConTextoDePermisoDeBluetooth() {
        let info = Bundle(for: SesionAccesorioModelo.self).infoDictionary ?? [:]
        XCTAssertNil(info["UIBackgroundModes"], "ningún modo de segundo plano sin un alcance justificado")
        let texto = info["NSBluetoothAlwaysUsageDescription"] as? String
        XCTAssertFalse((texto ?? "").isEmpty, "falta el texto del permiso de Bluetooth")
    }
}
