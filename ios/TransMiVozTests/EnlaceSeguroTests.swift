import ContratoBLE
import CoreBluetooth
import XCTest
@testable import TransMiVoz

/// La regla que decide qué nivel de enlace puede afirmar el transporte real (`EvidenciaEnlace`). Es una estructura pura:
/// no toca Core Bluetooth ni ningún accesorio. Lo que sí tocaría un accesorio de verdad (que iOS pida la clave, qué
/// código de error entrega al cancelar) sigue pendiente de banco; aquí solo se prueba la regla.
final class EvidenciaEnlaceTests: XCTestCase {
    private typealias R = EvidenciaEnlace.Resultado

    func testSinComprobacionElNivelEsDesconocido() {
        let e = EvidenciaEnlace()
        XCTAssertEqual(e.nivel(vigente: nil), .desconocido)
        XCTAssertEqual(e.nivel(vigente: 1), .desconocido)
    }

    func testPedidaPeroSinTerminarNoAfirmaNada() {
        var e = EvidenciaEnlace()
        e.pedir(token: 3)
        XCTAssertEqual(e.nivel(vigente: 3), .desconocido)
    }

    func testLecturaTerminadaSinErrorEnLaMismaConexionAfirmaComoMuchoCifradoSinAutenticar() {
        var e = EvidenciaEnlace()
        e.pedir(token: 3)
        XCTAssertEqual(e.resolver(conError: false, vigente: 3), R.superada)
        XCTAssertEqual(e.nivel(vigente: 3), .cifradoSinAutenticar)
        XCTAssertNotEqual(e.nivel(vigente: 3), .cifradoAutenticado, "un impostor sin protección también supera esta lectura")
    }

    func testConErrorFallaCerrado() {
        var e = EvidenciaEnlace()
        e.pedir(token: 3)
        XCTAssertEqual(e.resolver(conError: true, vigente: 3), R.fallida)
        XCTAssertEqual(e.nivel(vigente: 3), .desconocido)
    }

    func testSiLaConexionCambioMientrasTantoNoVale() {
        var e = EvidenciaEnlace()
        e.pedir(token: 3)
        XCTAssertEqual(e.resolver(conError: false, vigente: 4), R.fallida)
        XCTAssertEqual(e.nivel(vigente: 4), .desconocido)
        XCTAssertEqual(e.nivel(vigente: 3), .desconocido)
    }

    func testSinConexionVigenteNoVale() {
        var e = EvidenciaEnlace()
        e.pedir(token: 3)
        XCTAssertEqual(e.resolver(conError: false, vigente: nil), R.fallida)
        XCTAssertEqual(e.nivel(vigente: nil), .desconocido)
    }

    func testLoAfirmadoNoPasaAOtraConexion() {
        var e = EvidenciaEnlace()
        e.pedir(token: 3)
        _ = e.resolver(conError: false, vigente: 3)
        XCTAssertEqual(e.nivel(vigente: 4), .desconocido, "otra conexión (u otro periférico) parte de cero")
        XCTAssertEqual(e.nivel(vigente: nil), .desconocido)
    }

    func testPedirDeNuevoOlvidaLoAfirmado() {
        var e = EvidenciaEnlace()
        e.pedir(token: 3)
        _ = e.resolver(conError: false, vigente: 3)
        e.pedir(token: 3)
        XCTAssertEqual(e.nivel(vigente: 3), .desconocido, "mientras se repite la comprobación no se afirma nada")
    }

    func testReiniciarOlvidaTodo() {
        var e = EvidenciaEnlace()
        e.pedir(token: 3)
        _ = e.resolver(conError: false, vigente: 3)
        e.reiniciar()
        XCTAssertEqual(e.nivel(vigente: 3), .desconocido)
        XCTAssertNil(e.resolver(conError: false, vigente: 3), "tras reiniciar no hay comprobación pedida")
    }

    func testUnValorSinComprobacionPedidaNoCuentaNiSeResuelveDosVeces() {
        var e = EvidenciaEnlace()
        XCTAssertNil(e.resolver(conError: false, vigente: 3), "el valor es de otra lectura")
        XCTAssertEqual(e.nivel(vigente: 3), .desconocido)
        e.pedir(token: 3)
        XCTAssertEqual(e.resolver(conError: false, vigente: 3), R.superada)
        XCTAssertNil(e.resolver(conError: false, vigente: 3), "una comprobación se resuelve una sola vez")
    }

    func testNingunaCombinacionLlegaACifradoAutenticado() {
        for pedida in [1, 2] {
            for vigente in [nil, 1, 2] as [Int?] {
                for error in [false, true] {
                    var e = EvidenciaEnlace()
                    e.pedir(token: pedida)
                    _ = e.resolver(conError: error, vigente: vigente)
                    for consulta in [nil, 1, 2, 3] as [Int?] {
                        XCTAssertNotEqual(e.nivel(vigente: consulta), .cifradoAutenticado)
                    }
                }
            }
        }
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
        // `.cifradoSinAutenticar` es lo más que afirma el transporte real tras la lectura: no basta.
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

        // Pero tampoco hay espera eterna: vencido su plazo falla cerrado.
        banco.reloj.avanzar(SesionAccesorioModelo.plazoEmparejamientoMs)
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

    func testLaEscenaInactivaDuranteLaComprobacionReiniciaLaConexion() {
        // Si el aviso de emparejamiento de iOS deja la escena inactiva, lo que llegue entonces se ignora y al volver
        // se parte de cero (regla de toda sincronización a medias). Cómo se comporta iOS es pendiente de banco.
        let banco = bancoEnComprobacion(nivel: .cifradoAutenticado)
        defer { banco.cerrar() }
        banco.modelo.escenaActiva(false)
        banco.transporte.emitir(.lecturaProtegidaSuperada)
        XCTAssertEqual(banco.transporte.veces("leerInformacion"), 0)

        banco.modelo.escenaActiva(true)
        XCTAssertEqual(banco.modelo.estado, .conectando)
        XCTAssertEqual(banco.transporte.veces("conectar:acc-1"), 2)
        XCTAssertEqual(banco.modelo.nivelAfirmado, .desconocido)

        banco.transporte.emitir(.conectado(id: banco.accesorio.id))
        XCTAssertEqual(banco.modelo.estado, .comprobandoEnlace)
        XCTAssertEqual(banco.transporte.veces("comprobarEnlace"), 2, "se vuelve a comprobar en la conexión nueva")
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
