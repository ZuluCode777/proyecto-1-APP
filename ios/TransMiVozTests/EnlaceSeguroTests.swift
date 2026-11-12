import ContratoBLE
import CoreBluetooth
import XCTest
@testable import TransMiVoz

/// La traducción de la lectura protegida de comprobación (`EvidenciaEnlace`). Es una estructura pura: no toca Core
/// Bluetooth ni ningún accesorio. Lo que sí tocaría un accesorio de verdad (que iOS pida la clave, qué código de error
/// entrega al cancelar) sigue pendiente de banco; aquí solo se prueba la traducción.
@MainActor
final class EvidenciaEnlaceTests: XCTestCase {
    private let valor = Data([1, 2, 3])

    func testLecturaTerminadaSinErrorEnLaMismaConexionEsLecturaSuperada() {
        var e = EvidenciaEnlace()
        e.pedir(token: 3)
        XCTAssertEqual(e.eventoDeLectura(valor: valor, motivoEnlace: nil, vigente: 3), .lecturaProtegidaSuperada)
    }

    func testSinValorEsFalloYNoSeEntregaComoSuperada() {
        var e = EvidenciaEnlace()
        e.pedir(token: 3)
        XCTAssertEqual(e.eventoDeLectura(valor: nil, motivoEnlace: nil, vigente: 3), .fallo(.enlaceSeguroFallido))
    }

    func testElMotivoDelSistemaSeConservaEnElFallo() {
        var e = EvidenciaEnlace()
        e.pedir(token: 3)
        XCTAssertEqual(
            e.eventoDeLectura(valor: nil, motivoEnlace: .vinculoBorradoEnAccesorio, vigente: 3),
            .fallo(.vinculoBorradoEnAccesorio))
    }

    func testSiLaConexionCambioMientrasTantoFallaAunqueHayaValor() {
        var e = EvidenciaEnlace()
        e.pedir(token: 3)
        XCTAssertEqual(e.eventoDeLectura(valor: valor, motivoEnlace: nil, vigente: 4), .fallo(.enlaceSeguroFallido))
    }

    func testSinConexionVigenteFalla() {
        var e = EvidenciaEnlace()
        e.pedir(token: 3)
        XCTAssertEqual(e.eventoDeLectura(valor: valor, motivoEnlace: nil, vigente: nil), .fallo(.enlaceSeguroFallido))
    }

    func testUnValorSinComprobacionPedidaNoEsDeLaComprobacionNiSeResuelveDosVeces() {
        var e = EvidenciaEnlace()
        XCTAssertNil(e.eventoDeLectura(valor: valor, motivoEnlace: nil, vigente: 3), "el valor es de otra lectura")
        e.pedir(token: 3)
        XCTAssertEqual(e.eventoDeLectura(valor: valor, motivoEnlace: nil, vigente: 3), .lecturaProtegidaSuperada)
        XCTAssertNil(e.eventoDeLectura(valor: valor, motivoEnlace: nil, vigente: 3), "una comprobación se resuelve una sola vez")
    }

    func testReiniciarOlvidaLaComprobacionPedida() {
        var e = EvidenciaEnlace()
        e.pedir(token: 3)
        e.reiniciar()
        XCTAssertNil(e.eventoDeLectura(valor: valor, motivoEnlace: nil, vigente: 3), "tras reiniciar no hay comprobación pedida")
    }

    func testNingunaTraduccionAfirmaUnNivelDeEnlace() {
        // El evento no lleva nivel: la comprobación superada no afirma cifrado ni autenticación.
        for pedida in [1, 2] {
            for vigente in [nil, 1, 2] as [Int?] {
                for conValor in [false, true] {
                    var e = EvidenciaEnlace()
                    e.pedir(token: pedida)
                    let evento = e.eventoDeLectura(valor: conValor ? valor : nil, motivoEnlace: nil, vigente: vigente)
                    XCTAssertTrue(evento == .lecturaProtegidaSuperada || evento == .fallo(.enlaceSeguroFallido), "\(String(describing: evento))")
                }
            }
        }
    }

    func testUnErrorDeEnlaceSeguroAlCortarseLaConexionEsUnFalloConSuRecuperacion() {
        XCTAssertEqual(
            EvidenciaEnlace.eventoDeCorte(motivoEnlace: .vinculoBorradoEnAccesorio, fallaAlConectar: false),
            .fallo(.vinculoBorradoEnAccesorio), "didDisconnect con peerRemovedPairingInformation")
        XCTAssertEqual(
            EvidenciaEnlace.eventoDeCorte(motivoEnlace: .enlaceSeguroFallido, fallaAlConectar: true),
            .fallo(.enlaceSeguroFallido), "didFailToConnect con un error del enlace seguro")
    }

    func testSinErrorDeEnlaceElCorteSigueSiendoElDeSiempre() {
        XCTAssertEqual(EvidenciaEnlace.eventoDeCorte(motivoEnlace: nil, fallaAlConectar: false), .desconectado)
        XCTAssertEqual(EvidenciaEnlace.eventoDeCorte(motivoEnlace: nil, fallaAlConectar: true), .fallo(.conexionFallida))
    }

    func testLosErroresDeEnlaceSeguroSeExplicanPeroNoSubenNivel() {
        func error(_ dominio: String, _ codigo: Int) -> Error { NSError(domain: dominio, code: codigo) }
        XCTAssertEqual(
            EvidenciaEnlace.motivo(de: error(CBErrorDomain, CBError.Code.peerRemovedPairingInformation.rawValue)),
            .vinculoBorradoEnAccesorio)
        XCTAssertEqual(
            EvidenciaEnlace.motivo(de: error(CBErrorDomain, CBError.Code.encryptionTimedOut.rawValue)),
            .enlaceSeguroFallido)
        for codigo in [
            CBATTError.Code.insufficientAuthentication, .insufficientAuthorization,
            .insufficientEncryption, .insufficientEncryptionKeySize,
        ] {
            XCTAssertEqual(EvidenciaEnlace.motivo(de: error(CBATTErrorDomain, codigo.rawValue)), .enlaceSeguroFallido, "\(codigo)")
        }
        XCTAssertNil(EvidenciaEnlace.motivo(de: error(CBErrorDomain, CBError.Code.connectionTimeout.rawValue)), "otro error: no es del enlace seguro")
        XCTAssertNil(EvidenciaEnlace.motivo(de: error("OtroDominio", CBError.Code.peerRemovedPairingInformation.rawValue)))
        XCTAssertNil(EvidenciaEnlace.motivo(de: nil))
    }
}

/// El paso de comprobación del enlace en la sesión, con el transporte y la voz falsos (simulados). Cada ruta que debe
/// quedar bloqueada y la única que avanza. Qué hace iOS de verdad con la solicitud de clave, cancelada o no, se mide con
/// la placa (ea-15-ios-ble-audio.md, «Seguridad del enlace»).
@MainActor
final class ComprobacionEnlaceSesionTests: XCTestCase {
    /// Sesión iniciada y conectada, con la lectura protegida de comprobación pedida y SIN responder.
    private func bancoEnComprobacion(nivel: NivelEnlace) -> BancoAccesorio {
        let banco = BancoAccesorio(nivel: nivel)
        banco.transporte.respondeComprobacion = false
        banco.iniciar()
        banco.transporte.emitir(.conectado(id: banco.accesorio.id))
        return banco
    }

    func testConectarPideLaComprobacionYNoAbreLaSesionNiLeeNada() {
        let banco = bancoEnComprobacion(nivel: .cifradoAutenticado)
        defer { banco.cerrar() }
        XCTAssertEqual(banco.modelo.estado, .comprobandoEnlace)
        XCTAssertEqual(banco.transporte.veces("comprobarEnlace"), 1)
        XCTAssertEqual(banco.transporte.veces("leerInformacion"), 0)
        XCTAssertEqual(banco.modelo.estadoSesion, .desconectada, "la sesión del contrato aún no se abrió")
        XCTAssertEqual(banco.modelo.nivelAfirmado, .desconocido, "mientras se comprueba no se afirma ningún nivel")
        XCTAssertFalse(banco.modelo.enlaceAutenticado)
    }

    func testSuperadaLaComprobacionConEnlaceAutenticadoLaSesionSigueAdelante() {
        let banco = bancoEnComprobacion(nivel: .cifradoAutenticado)
        defer { banco.cerrar() }
        banco.transporte.emitir(.lecturaProtegidaSuperada)
        XCTAssertEqual(banco.modelo.nivelAfirmado, .cifradoAutenticado)
        XCTAssertEqual(banco.modelo.estadoSesion, .esperandoInformacion)
        XCTAssertEqual(banco.modelo.estado, .conectado)
        XCTAssertEqual(banco.transporte.veces("leerInformacion"), 1)
    }

    func testSuperadaLaComprobacionSinNivelAutenticadoLaPoliticaFijaLaRechaza() {
        // El transporte real afirma siempre `.desconocido`; estos otros niveles solo los declara el doble. La política fija
        // acepta únicamente el autenticado.
        for nivel in [NivelEnlace.desconocido, .sinCifrar, .cifradoSinAutenticar] {
            let banco = bancoEnComprobacion(nivel: nivel)
            defer { banco.cerrar() }
            banco.transporte.emitir(.lecturaProtegidaSuperada)

            XCTAssertEqual(banco.modelo.estado, .enlaceNoVerificado, "\(nivel)")
            XCTAssertEqual(banco.modelo.estadoSesion, .rechazada(.enlaceNoAutenticado), "\(nivel)")
            XCTAssertFalse(banco.modelo.enlaceAutenticado)
            XCTAssertEqual(banco.transporte.veces("leerInformacion"), 0, "no se lee nada de un enlace sin autenticar")
            XCTAssertEqual(banco.transporte.veces("notificaciones:true"), 0)
            XCTAssertGreaterThanOrEqual(banco.transporte.veces("desconectar"), 1)
        }
    }

    func testEmparejamientoCanceladoOFallidoBloqueaYNoSeAbreLaSesion() {
        for motivo in [MotivoFalla.enlaceSeguroFallido, .vinculoBorradoEnAccesorio] {
            let banco = bancoEnComprobacion(nivel: .cifradoAutenticado)
            defer { banco.cerrar() }
            banco.transporte.emitir(.fallo(motivo))

            XCTAssertEqual(banco.modelo.estado, .falla(motivo))
            XCTAssertEqual(banco.modelo.estadoSesion, .desconectada)
            XCTAssertEqual(banco.modelo.nivelAfirmado, .desconocido)
            XCTAssertFalse(banco.modelo.enlaceAutenticado)
            XCTAssertEqual(banco.transporte.veces("leerInformacion"), 0)

            // Una respuesta tardía de esa misma conexión ya no vale: no resucita la sesión.
            banco.transporte.emitir(.lecturaProtegidaSuperada)
            XCTAssertEqual(banco.modelo.estado, .falla(motivo))
            XCTAssertEqual(banco.transporte.veces("leerInformacion"), 0)
        }
    }

    func testUnCorteDuranteLaComprobacionFallaSinReconectarSolo() {
        let banco = bancoEnComprobacion(nivel: .cifradoAutenticado)
        defer { banco.cerrar() }
        banco.transporte.emitir(.desconectado)

        XCTAssertEqual(banco.modelo.estado, .falla(.enlaceSeguroFallido))
        XCTAssertEqual(banco.transporte.veces("conectar:acc-1"), 1, "cada reintento volvería a pedir la clave: lo decide la persona")
        XCTAssertEqual(banco.transporte.veces("leerInformacion"), 0)
    }

    func testLaComprobacionTienePlazoPropioMasLargoQueElDeLosPasos() {
        let banco = bancoEnComprobacion(nivel: .cifradoAutenticado)
        defer { banco.cerrar() }
        XCTAssertGreaterThan(SesionAccesorioModelo.plazoEmparejamientoMs, SesionAccesorioModelo.plazoPasoMs)

        // La persona puede estar escribiendo la clave: el plazo corto de los pasos no la corta.
        banco.reloj.avanzar(SesionAccesorioModelo.plazoPasoMs + 1)
        banco.modelo.evaluar()
        XCTAssertEqual(banco.modelo.estado, .comprobandoEnlace)

        // Justo en el plazo (35 000 ms desde que empezó la comprobación) todavía espera.
        banco.reloj.avanzar(SesionAccesorioModelo.plazoEmparejamientoMs - SesionAccesorioModelo.plazoPasoMs - 1)
        banco.modelo.evaluar()
        XCTAssertEqual(banco.modelo.estado, .comprobandoEnlace, "en 35 000 ms exactos todavía espera")

        // Pero tampoco hay espera eterna: un milisegundo más y falla cerrado.
        banco.reloj.avanzar(1)
        banco.modelo.evaluar()
        XCTAssertEqual(banco.modelo.estado, .falla(.enlaceSeguroFallido))
        XCTAssertEqual(banco.modelo.nivelAfirmado, .desconocido)
        XCTAssertEqual(banco.transporte.veces("leerInformacion"), 0)
    }

    func testLaRespuestaDeUnaConexionAnteriorNoCuenta() {
        let banco = bancoEnComprobacion(nivel: .cifradoAutenticado)
        defer { banco.cerrar() }
        let viejo = banco.transporte.tokenVigente
        banco.modelo.reconectar()
        XCTAssertNotEqual(banco.transporte.tokenVigente, viejo)

        banco.transporte.emitir(.lecturaProtegidaSuperada, token: viejo)
        XCTAssertEqual(banco.modelo.estado, .conectando)
        XCTAssertEqual(banco.modelo.estadoSesion, .desconectada)
        XCTAssertEqual(banco.transporte.veces("leerInformacion"), 0)
    }

    func testUnaRespuestaFueraDeLaComprobacionNoAbreLaSesion() {
        let banco = BancoAccesorio(nivel: .cifradoAutenticado)
        defer { banco.cerrar() }
        banco.iniciar()
        banco.transporte.emitir(.lecturaProtegidaSuperada)
        XCTAssertEqual(banco.modelo.estado, .conectando, "aún no conectó: no hay nada que comprobar")
        XCTAssertEqual(banco.modelo.estadoSesion, .desconectada)
        XCTAssertEqual(banco.transporte.veces("leerInformacion"), 0)
    }

    func testLoAfirmadoNoPasaAUnaConexionNueva() {
        let banco = bancoEnComprobacion(nivel: .cifradoSinAutenticar)
        defer { banco.cerrar() }
        banco.transporte.emitir(.lecturaProtegidaSuperada)
        XCTAssertEqual(banco.modelo.nivelAfirmado, .cifradoSinAutenticar)

        banco.modelo.reconectar()
        XCTAssertEqual(banco.modelo.nivelAfirmado, .desconocido, "la nueva conexión parte de cero")
        XCTAssertEqual(banco.modelo.estado, .conectando)
    }

    // MARK: Escena inactiva durante el emparejamiento (la solicitud de iOS puede dejarla inactiva: pendiente de banco)

    func testUnFalloDelEnlaceSeguroSeConservaAlVolverAPrimerPlano() {
        for motivo in [MotivoFalla.enlaceSeguroFallido, .vinculoBorradoEnAccesorio] {
            let banco = bancoEnComprobacion(nivel: .cifradoAutenticado)
            defer { banco.cerrar() }
            banco.transporte.emitir(.fallo(motivo))
            banco.modelo.escenaActiva(false)
            banco.modelo.escenaActiva(true)

            XCTAssertEqual(banco.modelo.estado, .falla(motivo), "no se reemplaza por «Conectando»")
            XCTAssertEqual(banco.transporte.veces("conectar:acc-1"), 1, "no se reconecta")
            XCTAssertEqual(banco.transporte.veces("comprobarEnlace"), 1, "no se vuelve a pedir la clave")
        }
    }

    func testUnFalloQueLlegaConLaEscenaInactivaSeConservaAlVolver() {
        // Cancelar la solicitud de iOS: el fallo o el corte llegan con la escena inactiva.
        for evento in [EventoTransporte.fallo(.enlaceSeguroFallido), .desconectado] {
            let banco = bancoEnComprobacion(nivel: .cifradoAutenticado)
            defer { banco.cerrar() }
            banco.modelo.escenaActiva(false)
            banco.transporte.emitir(evento)
            banco.modelo.escenaActiva(true)

            XCTAssertEqual(banco.modelo.estado, .falla(.enlaceSeguroFallido), "\(evento)")
            XCTAssertEqual(banco.transporte.veces("conectar:acc-1"), 1, "\(evento): no se reconecta")
            XCTAssertEqual(banco.transporte.veces("comprobarEnlace"), 1, "\(evento): no se vuelve a pedir la clave")
            XCTAssertEqual(banco.transporte.veces("leerInformacion"), 0)
        }
    }

    func testVolverAPrimerPlanoDuranteLaComprobacionNoLaReiniciaYElFalloTardioLaCierra() {
        // La escena vuelve antes que el fallo de la solicitud cancelada: tampoco se reconecta.
        let banco = bancoEnComprobacion(nivel: .cifradoAutenticado)
        defer { banco.cerrar() }
        banco.modelo.escenaActiva(false)
        banco.modelo.escenaActiva(true)
        XCTAssertEqual(banco.modelo.estado, .comprobandoEnlace)
        XCTAssertEqual(banco.transporte.veces("conectar:acc-1"), 1)
        XCTAssertEqual(banco.transporte.veces("comprobarEnlace"), 1)

        banco.transporte.emitir(.fallo(.enlaceSeguroFallido))
        XCTAssertEqual(banco.modelo.estado, .falla(.enlaceSeguroFallido))
        XCTAssertEqual(banco.transporte.veces("conectar:acc-1"), 1)
    }

    func testElResultadoDeLaComprobacionConLaEscenaInactivaNoSePierde() {
        let banco = bancoEnComprobacion(nivel: .cifradoSinAutenticar)
        defer { banco.cerrar() }
        banco.modelo.escenaActiva(false)
        banco.transporte.emitir(.lecturaProtegidaSuperada)

        XCTAssertEqual(banco.modelo.estadoSesion, .rechazada(.enlaceNoAutenticado), "se procesó, no se quedó esperando")
        XCTAssertEqual(banco.transporte.veces("leerInformacion"), 0)
    }

    func testReconectarTrasUnFalloDelEnlaceSeguroPideLaComprobacionDeNuevo() {
        let banco = bancoEnComprobacion(nivel: .cifradoAutenticado)
        defer { banco.cerrar() }
        banco.transporte.emitir(.fallo(.enlaceSeguroFallido))
        banco.modelo.reconectar()
        banco.transporte.emitir(.conectado(id: banco.accesorio.id))

        XCTAssertEqual(banco.modelo.estado, .comprobandoEnlace)
        XCTAssertEqual(banco.transporte.veces("comprobarEnlace"), 2, "solo la persona decide reintentar")
    }

    func testElAvisoFijoSigueVisibleSalvoConEnlaceAutenticado() {
        for nivel in [NivelEnlace.desconocido, .sinCifrar, .cifradoSinAutenticar] {
            let banco = BancoAccesorio(nivel: nivel)
            defer { banco.cerrar() }
            XCTAssertFalse(banco.modelo.enlaceVerificable, "\(nivel)")
        }
        let banco = BancoAccesorio(nivel: .cifradoAutenticado)
        defer { banco.cerrar() }
        XCTAssertTrue(banco.modelo.enlaceVerificable, "solo el doble puede afirmarlo")
    }
}
