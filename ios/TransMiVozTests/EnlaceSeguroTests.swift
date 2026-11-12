import ContratoBLE
import CoreBluetooth
import XCTest
@testable import TransMiVoz

/// La traducción de la lectura protegida de comprobación (`ComprobacionEnlace`). Es una estructura pura: no toca Core
/// Bluetooth ni ningún accesorio. Lo que sí tocaría un accesorio de verdad (que iOS pida la clave, qué código de error
/// entrega al cancelar) sigue pendiente de banco; aquí solo se prueba la traducción.
@MainActor
final class ComprobacionEnlaceTests: XCTestCase {
    private let valor = Data([1, 2, 3])

    func testLecturaTerminadaSinErrorEnLaMismaConexionEsLecturaSuperada() {
        var e = ComprobacionEnlace()
        e.pedir(token: 3)
        XCTAssertEqual(e.eventoDeLectura(valor: valor, motivoEnlace: nil, vigente: 3), .lecturaProtegidaSuperada)
    }

    func testSinValorEsFalloYNoSeEntregaComoSuperada() {
        var e = ComprobacionEnlace()
        e.pedir(token: 3)
        XCTAssertEqual(e.eventoDeLectura(valor: nil, motivoEnlace: nil, vigente: 3), .fallo(.enlaceSeguroFallido))
    }

    func testElMotivoDelSistemaSeConservaEnElFallo() {
        var e = ComprobacionEnlace()
        e.pedir(token: 3)
        XCTAssertEqual(
            e.eventoDeLectura(valor: nil, motivoEnlace: .vinculoBorradoEnAccesorio, vigente: 3),
            .fallo(.vinculoBorradoEnAccesorio))
    }

    func testSiLaConexionCambioMientrasTantoFallaAunqueHayaValor() {
        var e = ComprobacionEnlace()
        e.pedir(token: 3)
        XCTAssertEqual(e.eventoDeLectura(valor: valor, motivoEnlace: nil, vigente: 4), .fallo(.enlaceSeguroFallido))
    }

    func testSinConexionVigenteFalla() {
        var e = ComprobacionEnlace()
        e.pedir(token: 3)
        XCTAssertEqual(e.eventoDeLectura(valor: valor, motivoEnlace: nil, vigente: nil), .fallo(.enlaceSeguroFallido))
    }

    func testUnValorSinComprobacionPedidaNoEsDeLaComprobacionNiSeResuelveDosVeces() {
        var e = ComprobacionEnlace()
        XCTAssertNil(e.eventoDeLectura(valor: valor, motivoEnlace: nil, vigente: 3), "el valor es de otra lectura")
        e.pedir(token: 3)
        XCTAssertEqual(e.eventoDeLectura(valor: valor, motivoEnlace: nil, vigente: 3), .lecturaProtegidaSuperada)
        XCTAssertNil(e.eventoDeLectura(valor: valor, motivoEnlace: nil, vigente: 3), "una comprobación se resuelve una sola vez")
    }

    func testReiniciarOlvidaLaComprobacionPedida() {
        var e = ComprobacionEnlace()
        e.pedir(token: 3)
        e.reiniciar()
        XCTAssertNil(e.eventoDeLectura(valor: valor, motivoEnlace: nil, vigente: 3), "tras reiniciar no hay comprobación pedida")
    }

    // MARK: Nivel que permite afirmar la comprobación (la regla de `TransporteCoreBluetooth.nivelEnlace`)

    func testSinComprobacionElNivelEsDesconocido() {
        let e = ComprobacionEnlace()
        XCTAssertEqual(e.nivel(vigente: nil), .desconocido)
        XCTAssertEqual(e.nivel(vigente: 1), .desconocido)
    }

    func testPedidaPeroSinTerminarNoAfirmaNada() {
        var e = ComprobacionEnlace()
        e.pedir(token: 3)
        XCTAssertEqual(e.nivel(vigente: 3), .desconocido)
    }

    func testLecturaTerminadaSinErrorEnLaConexionVigenteAfirmaSoloCifradoSinAutenticar() {
        var e = ComprobacionEnlace()
        e.pedir(token: 3)
        XCTAssertEqual(e.eventoDeLectura(valor: valor, motivoEnlace: nil, vigente: 3), .lecturaProtegidaSuperada)
        XCTAssertEqual(e.nivel(vigente: 3), .cifradoSinAutenticar)
        XCTAssertNotEqual(e.nivel(vigente: 3), .cifradoAutenticado, "un impostor sin protección también supera esta lectura")
    }

    func testCualquierFalloDejaElNivelEnDesconocido() {
        var sinValor = ComprobacionEnlace()
        sinValor.pedir(token: 3)
        _ = sinValor.eventoDeLectura(valor: nil, motivoEnlace: nil, vigente: 3)
        XCTAssertEqual(sinValor.nivel(vigente: 3), .desconocido, "lectura sin valor o con error")

        var conMotivo = ComprobacionEnlace()
        conMotivo.pedir(token: 3)
        _ = conMotivo.eventoDeLectura(valor: nil, motivoEnlace: .vinculoBorradoEnAccesorio, vigente: 3)
        XCTAssertEqual(conMotivo.nivel(vigente: 3), .desconocido)

        var otraConexion = ComprobacionEnlace()
        otraConexion.pedir(token: 3)
        _ = otraConexion.eventoDeLectura(valor: valor, motivoEnlace: nil, vigente: 4)
        XCTAssertEqual(otraConexion.nivel(vigente: 4), .desconocido)
        XCTAssertEqual(otraConexion.nivel(vigente: 3), .desconocido)

        var sinConexion = ComprobacionEnlace()
        sinConexion.pedir(token: 3)
        _ = sinConexion.eventoDeLectura(valor: valor, motivoEnlace: nil, vigente: nil)
        XCTAssertEqual(sinConexion.nivel(vigente: nil), .desconocido)
    }

    func testCambiarDeConexionDesconectarOReiniciarOlvidaElNivel() {
        var e = ComprobacionEnlace()
        e.pedir(token: 3)
        _ = e.eventoDeLectura(valor: valor, motivoEnlace: nil, vigente: 3)
        XCTAssertEqual(e.nivel(vigente: 4), .desconocido, "otra conexión u otro periférico parte de cero")
        XCTAssertEqual(e.nivel(vigente: nil), .desconocido, "sin conexión vigente tras desconectar")

        e.pedir(token: 3)
        XCTAssertEqual(e.nivel(vigente: 3), .desconocido, "mientras se repite la comprobación no se afirma nada")

        _ = e.eventoDeLectura(valor: valor, motivoEnlace: nil, vigente: 3)
        e.reiniciar()
        XCTAssertEqual(e.nivel(vigente: 3), .desconocido)
    }

    func testNingunaCombinacionLlegaACifradoAutenticadoNiASinCifrar() {
        for pedida in [1, 2] {
            for vigente in [nil, 1, 2] as [Int?] {
                for conValor in [false, true] {
                    var e = ComprobacionEnlace()
                    e.pedir(token: pedida)
                    _ = e.eventoDeLectura(valor: conValor ? valor : nil, motivoEnlace: nil, vigente: vigente)
                    for consulta in [nil, 1, 2, 3] as [Int?] {
                        let nivel = e.nivel(vigente: consulta)
                        XCTAssertTrue(nivel == .desconocido || nivel == .cifradoSinAutenticar, "\(nivel)")
                    }
                }
            }
        }
    }

    func testUnErrorDeEnlaceSeguroAlCortarseLaConexionEsUnFalloConSuRecuperacion() {
        XCTAssertEqual(
            ComprobacionEnlace.eventoDeCorte(motivoEnlace: .vinculoBorradoEnAccesorio, fallaAlConectar: false),
            .fallo(.vinculoBorradoEnAccesorio), "didDisconnect con peerRemovedPairingInformation")
        XCTAssertEqual(
            ComprobacionEnlace.eventoDeCorte(motivoEnlace: .enlaceSeguroFallido, fallaAlConectar: true),
            .fallo(.enlaceSeguroFallido), "didFailToConnect con un error del enlace seguro")
    }

    func testSinErrorDeEnlaceElCorteSigueSiendoElDeSiempre() {
        XCTAssertEqual(ComprobacionEnlace.eventoDeCorte(motivoEnlace: nil, fallaAlConectar: false), .desconectado)
        XCTAssertEqual(ComprobacionEnlace.eventoDeCorte(motivoEnlace: nil, fallaAlConectar: true), .fallo(.conexionFallida))
    }

    func testLosErroresDeEnlaceSeguroSeExplicanPeroNoSubenNivel() {
        func error(_ dominio: String, _ codigo: Int) -> Error { NSError(domain: dominio, code: codigo) }
        XCTAssertEqual(
            ComprobacionEnlace.motivo(de: error(CBErrorDomain, CBError.Code.peerRemovedPairingInformation.rawValue)),
            .vinculoBorradoEnAccesorio)
        XCTAssertEqual(
            ComprobacionEnlace.motivo(de: error(CBErrorDomain, CBError.Code.encryptionTimedOut.rawValue)),
            .enlaceSeguroFallido)
        for codigo in [
            CBATTError.Code.insufficientAuthentication, .insufficientAuthorization,
            .insufficientEncryption, .insufficientEncryptionKeySize,
        ] {
            XCTAssertEqual(ComprobacionEnlace.motivo(de: error(CBATTErrorDomain, codigo.rawValue)), .enlaceSeguroFallido, "\(codigo)")
        }
        XCTAssertNil(ComprobacionEnlace.motivo(de: error(CBErrorDomain, CBError.Code.connectionTimeout.rawValue)), "otro error: no es del enlace seguro")
        XCTAssertNil(ComprobacionEnlace.motivo(de: error("OtroDominio", CBError.Code.peerRemovedPairingInformation.rawValue)))
        XCTAssertNil(ComprobacionEnlace.motivo(de: nil))
    }

    func testResultadoSistemaConservaSoloSiHuboErrorYSuMotivoDeEnlace() {
        let sin = ResultadoSistema(error: nil)
        XCTAssertFalse(sin.huboError)
        XCTAssertNil(sin.motivoEnlace)
        XCTAssertEqual(sin.motivo(respaldo: .errorDeLectura), .errorDeLectura, "sin error el respaldo es el de la operación")

        let ajeno = ResultadoSistema(error: NSError(domain: "OtroDominio", code: 1))
        XCTAssertTrue(ajeno.huboError)
        XCTAssertNil(ajeno.motivoEnlace)
        XCTAssertEqual(ajeno.motivo(respaldo: .errorDeSuscripcion), .errorDeSuscripcion)

        let borrado = ResultadoSistema(error: NSError(domain: CBErrorDomain, code: CBError.Code.peerRemovedPairingInformation.rawValue))
        XCTAssertTrue(borrado.huboError)
        XCTAssertEqual(borrado.motivoEnlace, .vinculoBorradoEnAccesorio)
        XCTAssertEqual(borrado.motivo(respaldo: .errorDeLectura), .vinculoBorradoEnAccesorio, "el motivo del enlace gana al de la operación")
    }
}

/// El paso de comprobación del enlace en la sesión, con el transporte y la voz falsos (simulados) y la política de
/// demostración (A1, 12/11/2026): cada ruta que debe quedar bloqueada y las que avanzan (enlace sin autenticar, que es lo
/// que afirma el transporte real tras la lectura, y autenticado, que solo declara el doble). Qué hace iOS de verdad con
/// la solicitud de clave, cancelada o no, se mide con la placa (ea-15-ios-ble-audio.md, «Seguridad del enlace»).
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

    func testSuperadaLaComprobacionConEnlaceSinAutenticarLaPoliticaDeDemostracionAcepta() {
        // Lo que afirma el transporte real tras la lectura: la política de demostración (contrato §6, A1 12/11/2026) la
        // acepta, y la sesión queda marcada NO autenticada.
        let banco = bancoEnComprobacion(nivel: .cifradoSinAutenticar)
        defer { banco.cerrar() }
        banco.transporte.emitir(.lecturaProtegidaSuperada)

        XCTAssertEqual(banco.modelo.nivelAfirmado, .cifradoSinAutenticar)
        XCTAssertEqual(banco.modelo.estadoSesion, .esperandoInformacion)
        XCTAssertFalse(banco.modelo.enlaceAutenticado, "nunca se presenta como autenticada")
        XCTAssertEqual(banco.modelo.estado, .conectado)
        XCTAssertEqual(banco.transporte.veces("leerInformacion"), 1)
    }

    func testSuperadaLaComprobacionSinCifradoLaPoliticaRechaza() {
        // `.desconocido` y `.sinCifrar` se rechazan con las dos políticas. El transporte real nunca afirma `.sinCifrar`
        // (no puede saberlo); aquí lo declara el doble.
        for nivel in [NivelEnlace.desconocido, .sinCifrar] {
            let banco = bancoEnComprobacion(nivel: nivel)
            defer { banco.cerrar() }
            banco.transporte.emitir(.lecturaProtegidaSuperada)

            XCTAssertEqual(banco.modelo.estado, .enlaceNoVerificado, "\(nivel)")
            XCTAssertEqual(banco.modelo.estadoSesion, .rechazada(.enlaceNoAutenticado), "\(nivel)")
            XCTAssertFalse(banco.modelo.enlaceAutenticado)
            XCTAssertEqual(banco.transporte.veces("leerInformacion"), 0, "no se lee nada de un enlace sin cifrar o sin dato")
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
        let rechazado = bancoEnComprobacion(nivel: .desconocido)
        defer { rechazado.cerrar() }
        rechazado.modelo.escenaActiva(false)
        rechazado.transporte.emitir(.lecturaProtegidaSuperada)
        XCTAssertEqual(rechazado.modelo.estadoSesion, .rechazada(.enlaceNoAutenticado), "se procesó, no se quedó esperando")
        XCTAssertEqual(rechazado.transporte.veces("leerInformacion"), 0)

        let aceptado = bancoEnComprobacion(nivel: .cifradoSinAutenticar)
        defer { aceptado.cerrar() }
        aceptado.modelo.escenaActiva(false)
        aceptado.transporte.emitir(.lecturaProtegidaSuperada)
        XCTAssertEqual(aceptado.modelo.estadoSesion, .esperandoInformacion, "se procesó, no se quedó esperando")
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

    func testUnaConexionFallidaDuranteLaComprobacionEsUnFalloDelEnlaceSeguro() {
        // Con la escena suspendida o no: un `didFailToConnect` en este paso no debe dejar que el regreso reinicie la conexión.
        for suspendida in [true, false] {
            let banco = bancoEnComprobacion(nivel: .cifradoAutenticado)
            defer { banco.cerrar() }
            if suspendida { banco.modelo.escenaActiva(false) }
            banco.transporte.emitir(.fallo(.conexionFallida))
            if suspendida { banco.modelo.escenaActiva(true) }

            XCTAssertEqual(banco.modelo.estado, .falla(.enlaceSeguroFallido), "suspendida: \(suspendida)")
            XCTAssertEqual(banco.transporte.veces("conectar:acc-1"), 1, "suspendida: \(suspendida)")
            XCTAssertEqual(banco.transporte.veces("comprobarEnlace"), 1, "suspendida: \(suspendida)")
        }
    }

    func testUnaConexionFallidaFueraDeLaComprobacionConservaSuMotivo() {
        let banco = BancoAccesorio(nivel: .cifradoAutenticado)
        defer { banco.cerrar() }
        banco.iniciar()
        banco.transporte.emitir(.fallo(.conexionFallida))
        XCTAssertEqual(banco.modelo.estado, .falla(.conexionFallida))
    }

    func testTrasUnRechazoLaVueltaAPrimerPlanoNoReconectaNiVuelveALeer() {
        // Rechazo terminal (contrato §4): sin vínculo, una lectura protegida más podría volver a pedir la clave.
        let banco = bancoEnComprobacion(nivel: .desconocido)
        defer { banco.cerrar() }
        banco.transporte.emitir(.lecturaProtegidaSuperada)
        XCTAssertEqual(banco.modelo.estado, .enlaceNoVerificado)

        banco.modelo.escenaActiva(false)
        banco.modelo.escenaActiva(true)
        XCTAssertEqual(banco.modelo.estado, .enlaceNoVerificado, "el bloqueo sigue en pantalla")
        XCTAssertEqual(banco.transporte.veces("conectar:acc-1"), 1, "no se reconecta solo")
        XCTAssertEqual(banco.transporte.veces("comprobarEnlace"), 1, "no se vuelve a leer la característica protegida")

        // Reconectar sigue disponible: es la persona quien decide reintentar.
        banco.modelo.reconectar()
        banco.transporte.emitir(.conectado(id: banco.accesorio.id))
        XCTAssertEqual(banco.transporte.veces("comprobarEnlace"), 2)
    }

    func testElPlazoDeLaComprobacionCuentaDesdeLaVueltaAPrimerPlano() {
        // El latido no corre con la escena suspendida: sin reiniciar el plazo, al volver fallaría de golpe aunque la
        // persona siga en la solicitud de iOS.
        let banco = bancoEnComprobacion(nivel: .cifradoAutenticado)
        defer { banco.cerrar() }
        banco.modelo.escenaActiva(false)
        banco.reloj.avanzar(SesionAccesorioModelo.plazoEmparejamientoMs + 5_000)
        banco.modelo.escenaActiva(true)
        banco.modelo.evaluar()
        XCTAssertEqual(banco.modelo.estado, .comprobandoEnlace, "no falla por el tiempo que estuvo suspendida")

        banco.reloj.avanzar(SesionAccesorioModelo.plazoEmparejamientoMs)
        banco.modelo.evaluar()
        XCTAssertEqual(banco.modelo.estado, .comprobandoEnlace, "en 35 000 ms desde la vuelta todavía espera")
        banco.reloj.avanzar(1)
        banco.modelo.evaluar()
        XCTAssertEqual(banco.modelo.estado, .falla(.enlaceSeguroFallido))
    }

    // MARK: Política de demostración: medidas solo tras la comprobación y siempre declaradas sin autenticar

    func testConEnlaceSinAutenticarLaSesionCompletaAceptaMedidasYNuncaLasDaPorAutenticadas() throws {
        let banco = BancoAccesorio(nivel: .cifradoSinAutenticar)
        defer { banco.cerrar() }
        let escenario = try EscenarioBLE.cargar("objetivo-distancia-y-azimut")
        banco.iniciar()
        banco.sincronizar(escenario)

        XCTAssertEqual(Array(banco.transporte.llamadas.prefix(3)), ["conectar:acc-1", "comprobarEnlace", "leerInformacion"])
        XCTAssertEqual(banco.modelo.nivelAfirmado, .cifradoSinAutenticar)
        XCTAssertFalse(banco.modelo.enlaceAutenticado, "la sesión consta NO autenticada")
        XCTAssertFalse(banco.modelo.enlaceVerificable, "el aviso fijo de la pantalla sigue visible")
        XCTAssertEqual(banco.modelo.estado, .sinDeteccion)

        banco.entregar(escenario.entregas[0])
        XCTAssertEqual(banco.modelo.estado, .objetivo(distanciaMm: 1200, azimutCentesimas: -3000))
        XCTAssertFalse(banco.modelo.enlaceAutenticado)
        XCTAssertTrue(banco.salida.dicho.contains("\(TextoAccesorio.reservaEnlace) Accesorio conectado. Calibrando. Aún sin avisos."),
                      "al conectar se declara el límite en voz alta")
        XCTAssertFalse(banco.salida.dicho.contains { $0.lowercased().contains("enlace autenticado") }, "nunca se dice autenticado")
    }

    // MARK: La reserva hablada «Enlace sin autenticar.» se oye entera (cada locución corta la anterior)

    func testLaReservaSeRepiteHastaOirseEnteraAunqueCalibrandoSeCorte() throws {
        let banco = BancoAccesorio(nivel: .cifradoSinAutenticar)
        defer { banco.cerrar() }
        let escenario = try EscenarioBLE.cargar("objetivo-distancia-y-azimut")
        let reserva = TextoAccesorio.reservaEnlace
        banco.iniciar()
        banco.sincronizar(escenario)  // «calibrando» dura un instante: la locución siguiente la corta

        XCTAssertEqual(banco.salida.cortadas.last, "\(reserva) Accesorio conectado. Calibrando. Aún sin avisos.", "calibrando se cortó")
        XCTAssertEqual(banco.salida.dicho.last, "\(reserva) Sin detección en este momento.", "la reserva pasa a la siguiente")
        banco.salida.terminarSola()
        XCTAssertEqual(banco.salida.completas.last, "\(reserva) Sin detección en este momento.", "esta sí se oyó entera")

        banco.entregar(escenario.entregas[0])
        XCTAssertEqual(banco.salida.dicho.last, "Objeto a 1 metro, a la izquierda.", "ya se oyó entera: no se repite")
    }

    func testSiLaReservaDeCalibrandoSeOyeEnteraNoSeRepite() throws {
        let banco = BancoAccesorio(nivel: .cifradoSinAutenticar)
        defer { banco.cerrar() }
        let escenario = try EscenarioBLE.cargar("objetivo-distancia-y-azimut")
        let referencia = escenario.referencias[0]
        banco.iniciar()
        banco.transporte.emitir(.conectado(id: banco.accesorio.id))
        banco.transporte.emitir(.informacion(escenario.informaciones[0]))
        XCTAssertEqual(banco.salida.dicho.last, "\(TextoAccesorio.reservaEnlace) Accesorio conectado. Calibrando. Aún sin avisos.")
        banco.salida.terminarSola()  // terminó antes de la siguiente

        banco.reloj.fijar(referencia.inicio)
        banco.transporte.emitir(.notificacionesFijadas(false))
        banco.reloj.fijar(referencia.fin)
        banco.transporte.emitir(.respuestaMedicion(referencia.datos))
        banco.transporte.emitir(.notificacionesFijadas(true))
        XCTAssertEqual(banco.salida.dicho.last, "Sin detección en este momento.")
        XCTAssertTrue(banco.salida.cortadas.allSatisfy { !$0.contains(TextoAccesorio.reservaEnlace) }, "nada de la reserva quedó a medias")
    }

    func testCadaVezQueSeRepiteElEstadoDeAhoraLlevaLaReserva() throws {
        let banco = BancoAccesorio(nivel: .cifradoSinAutenticar)
        defer { banco.cerrar() }
        let escenario = try EscenarioBLE.cargar("objetivo-distancia-y-azimut")
        let esperado = "\(TextoAccesorio.reservaEnlace) Objeto a 1 metro, a la izquierda."
        banco.iniciar()
        banco.sincronizar(escenario)
        banco.salida.terminarSola()
        banco.entregar(escenario.entregas[0])
        banco.salida.terminarSola()

        banco.modelo.fijarVozPropia(true)  // `reanunciar`: se dice el estado de ahora
        XCTAssertEqual(banco.salida.dicho.last, esperado)
        banco.salida.terminarSola()
        banco.modelo.fijarVozPropia(true)
        XCTAssertEqual(banco.salida.dicho.last, esperado, "aunque ya se hubiera oído entera, cada repetición la lleva")
    }

    func testConEnlaceAutenticadoNuncaSeAntepoleLaReserva() throws {
        let banco = BancoAccesorio(nivel: .cifradoAutenticado)
        defer { banco.cerrar() }
        let escenario = try EscenarioBLE.cargar("objetivo-distancia-y-azimut")
        banco.iniciar()
        banco.sincronizar(escenario)
        banco.entregar(escenario.entregas[0])
        banco.modelo.fijarVozPropia(true)
        XCTAssertFalse(banco.salida.dicho.contains { $0.contains(TextoAccesorio.reservaEnlace) })
    }

    func testLaReservaNoVaAntesDeAceptarElAccesorio() {
        let banco = bancoEnComprobacion(nivel: .cifradoSinAutenticar)
        defer { banco.cerrar() }
        XCTAssertEqual(banco.salida.dicho, [
            "Conectando con el accesorio.",
            "Comprobando el enlace seguro. Si iOS pide un código de 6 dígitos, escríbelo.",
        ])
    }

    func testConVoiceOverElLimiteDelEnlaceSeAnunciaUnaVezYLaMedidaNoSale() throws {
        let banco = BancoAccesorio(nivel: .cifradoSinAutenticar, voiceOver: true)
        defer { banco.cerrar() }
        let escenario = try EscenarioBLE.cargar("objetivo-distancia-y-azimut")
        banco.iniciar()
        banco.sincronizar(escenario)
        banco.entregar(escenario.entregas[0])
        banco.modelo.evaluar()

        let aviso = try XCTUnwrap(TextoAccesorio.anuncioAccesible(.calibrando, enlaceAutenticado: false))
        XCTAssertEqual(banco.avisos.deEstado, [aviso], "una vez, y la medida no pasa por VoiceOver")
        XCTAssertTrue(aviso.contains("sin autenticar"), aviso)
        XCTAssertTrue(banco.salida.dicho.isEmpty, "con VoiceOver la voz propia empieza apagada")
    }

    func testUnaMedidaAntesDeLaComprobacionSeDescartaAunqueElNivelSeaAceptable() throws {
        let banco = bancoEnComprobacion(nivel: .cifradoSinAutenticar)
        defer { banco.cerrar() }
        let escenario = try EscenarioBLE.cargar("objetivo-distancia-y-azimut")
        banco.transporte.emitir(.informacion(escenario.informaciones[0]))
        banco.transporte.emitir(.respuestaMedicion(escenario.referencias[0].datos))
        banco.transporte.emitir(.notificacionMedicion(escenario.entregas[0].datos))

        XCTAssertEqual(banco.modelo.estado, .comprobandoEnlace)
        XCTAssertEqual(banco.modelo.estadoSesion, .desconectada)
        XCTAssertEqual(banco.transporte.veces("leerMedicion"), 0)
        XCTAssertEqual(banco.transporte.veces("notificaciones:false"), 0)
        XCTAssertFalse(banco.salida.dicho.contains { $0.hasPrefix("Objeto") || $0.hasPrefix("Presencia") || $0.hasPrefix("Sin detección") })
    }

    func testUnaMedidaConEnlaceSinCifrarNoSeAceptaNiSeLeeNada() throws {
        let banco = BancoAccesorio(nivel: .sinCifrar)
        defer { banco.cerrar() }
        let escenario = try EscenarioBLE.cargar("objetivo-distancia-y-azimut")
        banco.iniciar()
        banco.transporte.emitir(.conectado(id: banco.accesorio.id))
        banco.transporte.emitir(.informacion(escenario.informaciones[0]))
        banco.transporte.emitir(.notificacionMedicion(escenario.entregas[0].datos))

        XCTAssertEqual(banco.modelo.estado, .enlaceNoVerificado)
        XCTAssertEqual(banco.transporte.veces("leerInformacion"), 0)
        XCTAssertEqual(banco.transporte.veces("notificaciones:true"), 0)
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
