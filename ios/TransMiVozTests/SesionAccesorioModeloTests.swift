import ContratoBLE
import XCTest
@testable import TransMiVoz

/// Sesión con el accesorio real, con transporte y voz falsos. Las tramas salen de los escenarios
/// compartidos de `contratos/ble/sesiones.txt`; aquí solo se prueba qué hace la app con ellas
/// (orden de llamadas, descarte de lo tardío, voz, ciclo de vida), no el contrato.
/// El camino «enlace autenticado» solo existe con el doble: el transporte real no puede
/// afirmarlo (contrato §6).
@MainActor
final class SesionAccesorioModeloTests: XCTestCase {
    private func objetivo() throws -> EscenarioBLE { try .cargar("objetivo-distancia-y-azimut") }

    // MARK: Camino completo

    func testFlujoCompletoLlamaAlTransporteEnOrdenYDiceCadaEstado() throws {
        let banco = BancoAccesorio()
        defer { banco.cerrar() }
        let escenario = try objetivo()
        banco.iniciar()
        XCTAssertEqual(banco.modelo.estado, .conectando)
        banco.sincronizar(escenario)

        XCTAssertEqual(banco.transporte.llamadas, [
            "conectar:acc-1", "comprobarEnlace", "leerInformacion", "notificaciones:false", "leerMedicion", "notificaciones:true",
        ], "orden: comprobación del enlace, Información, notificaciones apagadas, lectura fresca, notificaciones")
        XCTAssertEqual(banco.modelo.estado, .sinDeteccion)
        XCTAssertTrue(banco.modelo.enlaceAutenticado)

        banco.entregar(escenario.entregas[0])
        XCTAssertEqual(banco.modelo.estado, .objetivo(distanciaMm: 1200, azimutCentesimas: -3000))
        banco.entregar(escenario.entregas[1])
        XCTAssertEqual(banco.modelo.estado, .objetivo(distanciaMm: 1500, azimutCentesimas: nil))
        banco.entregar(escenario.entregas[2])
        XCTAssertEqual(banco.modelo.estado, .presencia)

        XCTAssertEqual(banco.salida.dicho, [
            "Conectando con el accesorio.",
            "Accesorio conectado. Calibrando. Aún sin avisos.",
            "Sin detección en este momento.",
            "Objeto a 1 metro, a la izquierda.",
            "Objeto a 1,5 metros.",
            "Presencia detectada.",
        ])
    }

    // MARK: Seguridad: producción no puede afirmar el enlace

    func testSinNivelDeEnlaceAfirmadoLaSesionSeBloqueaYNoSeLeeNiSeSuscribeNada() throws {
        for nivel in [NivelEnlace.desconocido, .sinCifrar, .cifradoSinAutenticar] {
            let banco = BancoAccesorio(nivel: nivel)
            defer { banco.cerrar() }
            banco.iniciar()
            banco.transporte.emitir(.conectado(id: banco.accesorio.id))

            XCTAssertEqual(banco.modelo.estado, .enlaceNoVerificado, "\(nivel)")
            XCTAssertEqual(banco.modelo.estadoSesion, .rechazada(.enlaceNoAutenticado))
            XCTAssertFalse(banco.modelo.enlaceAutenticado)
            XCTAssertEqual(banco.transporte.veces("leerInformacion"), 0, "la sesión no lee Información de un enlace sin verificar")
            XCTAssertEqual(banco.transporte.veces("notificaciones:true"), 0)
            XCTAssertGreaterThanOrEqual(banco.transporte.veces("desconectar"), 1)

            // Aunque llegaran datos con el token viejo o con el vigente, ninguno cuenta.
            let escenario = try objetivo()
            banco.transporte.emitir(.informacion(escenario.informaciones[0]))
            banco.transporte.emitir(.notificacionMedicion(escenario.entregas[0].datos))
            XCTAssertEqual(banco.modelo.estado, .enlaceNoVerificado)
            XCTAssertEqual(banco.salida.dicho.last, "Avisos bloqueados. No se puede verificar la seguridad del enlace.")
            XCTAssertFalse(banco.salida.dicho.contains { $0.hasPrefix("Objeto") || $0.hasPrefix("Presencia") || $0.hasPrefix("Sin detección") })
        }
    }

    func testElTransporteRealAfirmaSiempreDesconocido() {
        // Core Bluetooth no expone el nivel del enlace y a la app le llega lo mismo de un impostor sin protección: el
        // transporte REAL afirma `.desconocido` al crearlo y también tras pedir la lectura de comprobación (ver
        // `EvidenciaEnlace`). Se prueba con el transporte de producción (su creación es perezosa: no crea el gestor ni
        // pide permiso), no con el doble. Si alguien lo cambia para afirmar otro nivel, esta prueba falla.
        let real = TransporteCoreBluetooth()
        XCTAssertEqual(real.nivelEnlace, .desconocido)
        // Sin conexión vigente, pedir la comprobación no hace nada ni afirma nada.
        real.comprobarEnlace(token: 1)
        XCTAssertEqual(real.nivelEnlace, .desconocido)
        let voz = ControlVoz(salida: SalidaVozFalsa(), consultarRuta: { .privada })
        let modelo = SesionAccesorioModelo(transporte: real, voz: voz)
        XCTAssertFalse(modelo.enlaceVerificable)
        XCTAssertEqual(modelo.nivelAfirmado, .desconocido)
        XCTAssertEqual(modelo.estado, .sinAccesorio)
        XCTAssertFalse(modelo.buscando, "crear la sesión no toca Core Bluetooth")
    }

    // MARK: Lo tardío y lo viejo se descarta

    func testEventosDeUnaConexionAnteriorSeDescartan() throws {
        let banco = BancoAccesorio()
        defer { banco.cerrar() }
        banco.iniciar()
        let viejo = banco.transporte.tokenVigente
        banco.modelo.reconectar()
        XCTAssertNotEqual(banco.transporte.tokenVigente, viejo)

        banco.transporte.emitir(.conectado(id: banco.accesorio.id), token: viejo)
        XCTAssertEqual(banco.modelo.estado, .conectando)
        XCTAssertEqual(banco.transporte.veces("leerInformacion"), 0)
    }

    func testDetenerDescartaLoQueLlegueDespues() throws {
        let banco = BancoAccesorio()
        defer { banco.cerrar() }
        let escenario = try objetivo()
        banco.iniciar()
        banco.sincronizar(escenario)
        banco.modelo.detener()
        let dicho = banco.salida.dicho

        banco.entregar(escenario.entregas[0])
        banco.transporte.emitir(.desconectado)
        XCTAssertFalse(banco.modelo.activa)
        XCTAssertEqual(banco.modelo.estado, .detenido)
        XCTAssertEqual(banco.modelo.estadoSesion, .desconectada)
        XCTAssertEqual(banco.salida.dicho, dicho, "nada nuevo se dice tras detener")
        XCTAssertEqual(banco.salida.llamadas.last, "detener")
    }

    func testCambiarDeAccesorioDetieneLaSesionAnteriorYNoArrastraNada() throws {
        let banco = BancoAccesorio()
        defer { banco.cerrar() }
        let escenario = try objetivo()
        banco.iniciar()
        banco.sincronizar(escenario)
        banco.entregar(escenario.entregas[0])
        let tokenViejo = banco.transporte.tokenVigente

        banco.modelo.elegir(AccesorioDetectado(id: "acc-2", nombre: nil))
        XCTAssertFalse(banco.modelo.activa)
        XCTAssertEqual(banco.modelo.elegido?.id, "acc-2")
        XCTAssertEqual(banco.modelo.estado, .detenido)

        banco.transporte.emitir(.notificacionMedicion(escenario.entregas[1].datos), token: tokenViejo)
        XCTAssertEqual(banco.modelo.estado, .detenido)
        XCTAssertFalse(banco.salida.dicho.contains("Objeto a 1,5 metros."))
    }

    func testNotificacionesAntesDeLaReferenciaNoCuentan() throws {
        let banco = BancoAccesorio()
        defer { banco.cerrar() }
        let escenario = try objetivo()
        banco.iniciar()
        banco.transporte.emitir(.conectado(id: banco.accesorio.id))
        banco.transporte.emitir(.informacion(escenario.informaciones[0]))
        // Todavía sin referencia: una notificación no activa la sesión ni dispara avisos.
        banco.transporte.emitir(.notificacionMedicion(escenario.entregas[0].datos))
        XCTAssertEqual(banco.modelo.estado, .calibrando)
        XCTAssertFalse(banco.salida.dicho.contains { $0.hasPrefix("Objeto") })
    }

    // MARK: Referencia fresca (≤ 200 ms) y reintentos

    func testReferenciaDeExactamente200msPasa() throws {
        let banco = BancoAccesorio()
        defer { banco.cerrar() }
        let escenario = try objetivo()
        banco.iniciar()
        banco.transporte.emitir(.conectado(id: banco.accesorio.id))
        banco.transporte.emitir(.informacion(escenario.informaciones[0]))
        banco.reloj.fijar(2000)
        banco.transporte.emitir(.notificacionesFijadas(false))
        banco.reloj.fijar(2200)
        banco.transporte.emitir(.respuestaMedicion(escenario.referencias[0].datos))
        XCTAssertEqual(banco.modelo.estado, .sinDeteccion)
        XCTAssertEqual(banco.transporte.llamadas.last, "notificaciones:true")
    }

    func testReferenciaLentaSePideOtraYTrasTresIntentosFalla() throws {
        let banco = BancoAccesorio()
        defer { banco.cerrar() }
        let escenario = try objetivo()
        banco.iniciar()
        banco.transporte.emitir(.conectado(id: banco.accesorio.id))
        banco.transporte.emitir(.informacion(escenario.informaciones[0]))
        banco.reloj.fijar(2000)
        banco.transporte.emitir(.notificacionesFijadas(false))

        banco.reloj.fijar(2201)
        banco.transporte.emitir(.respuestaMedicion(escenario.referencias[0].datos))
        XCTAssertEqual(banco.modelo.estado, .calibrando, "201 ms no activa la sesión")
        XCTAssertEqual(banco.transporte.veces("leerMedicion"), 2)

        banco.reloj.fijar(2500)
        banco.transporte.emitir(.respuestaMedicion(escenario.referencias[0].datos))
        XCTAssertEqual(banco.transporte.veces("leerMedicion"), 3)
        banco.reloj.fijar(2800)
        banco.transporte.emitir(.respuestaMedicion(escenario.referencias[0].datos))
        XCTAssertEqual(banco.modelo.estado, .falla(.referenciaNoValida))
        XCTAssertEqual(banco.transporte.veces("notificaciones:true"), 0)
        XCTAssertEqual(banco.salida.dicho.last, "Fallo del accesorio. Sin avisos.")
    }

    /// Una notificación que ya venía en camino cuando se apagaron las notificaciones no puede convertirse en
    /// la referencia fresca: mientras se espera la lectura, solo cuenta la respuesta a ella.
    func testUnaNotificacionRezagadaDuranteLaLecturaNoEsLaReferencia() throws {
        let banco = BancoAccesorio()
        defer { banco.cerrar() }
        let escenario = try objetivo()
        banco.iniciar()
        banco.transporte.emitir(.conectado(id: banco.accesorio.id))
        banco.transporte.emitir(.informacion(escenario.informaciones[0]))
        banco.reloj.fijar(escenario.referencias[0].inicio)
        banco.transporte.emitir(.notificacionesFijadas(false))

        banco.transporte.emitir(.notificacionMedicion(escenario.entregas[0].datos))
        XCTAssertEqual(banco.modelo.estado, .calibrando, "sin referencia no hay sesión")
        XCTAssertEqual(banco.transporte.veces("notificaciones:true"), 0)

        banco.reloj.fijar(escenario.referencias[0].fin)
        banco.transporte.emitir(.respuestaMedicion(escenario.referencias[0].datos))
        XCTAssertEqual(banco.modelo.estado, .sinDeteccion, "la respuesta a la lectura sí es la referencia")
    }

    func testRespuestaTardiaDeUnaLecturaNoSeTomaPorLaReferencia() throws {
        let banco = BancoAccesorio()
        defer { banco.cerrar() }
        let escenario = try objetivo()
        banco.iniciar()
        banco.transporte.emitir(.conectado(id: banco.accesorio.id))
        banco.transporte.emitir(.informacion(escenario.informaciones[0]))
        // Una respuesta de medición sin lectura pedida (paso distinto) no hace nada.
        banco.transporte.emitir(.respuestaMedicion(escenario.referencias[0].datos))
        XCTAssertEqual(banco.modelo.estado, .calibrando)
        XCTAssertEqual(banco.transporte.veces("leerMedicion"), 0)
    }

    // MARK: Reinicio del accesorio, recalibración y latido

    func testOtroIdentificadorDeArranqueRelleeLaInformacionYVuelveASincronizar() throws {
        let banco = BancoAccesorio()
        defer { banco.cerrar() }
        let escenario = try EscenarioBLE.cargar("reinicio-del-accesorio")
        banco.iniciar()
        banco.sincronizar(escenario)
        banco.entregar(escenario.entregas[0])
        banco.entregar(escenario.entregas[1])  // otro arranque
        XCTAssertEqual(banco.modelo.estadoSesion, .esperandoInformacion)
        XCTAssertEqual(banco.transporte.veces("leerInformacion"), 2)

        banco.transporte.emitir(.informacion(escenario.informaciones[1]))
        banco.reloj.fijar(2000)
        banco.transporte.emitir(.notificacionesFijadas(false))
        banco.reloj.fijar(2030)
        banco.transporte.emitir(.respuestaMedicion(escenario.referencias[1].datos))
        XCTAssertEqual(banco.modelo.estado, .sinDeteccion)
    }

    func testLaReferenciaSeRepiteCadaTreintaSegundos() throws {
        let banco = BancoAccesorio()
        defer { banco.cerrar() }
        let escenario = try objetivo()
        banco.iniciar()
        banco.sincronizar(escenario)
        banco.entregar(escenario.entregas[0])
        banco.reloj.fijar(escenario.referencias[0].fin + 30_001)
        banco.modelo.evaluar()
        XCTAssertEqual(banco.transporte.llamadas.last, "notificaciones:false")
    }

    func testSinTramasPasaASinDatosYNoRepiteLaUltimaMedida() throws {
        let banco = BancoAccesorio()
        defer { banco.cerrar() }
        let escenario = try objetivo()
        banco.iniciar()
        banco.sincronizar(escenario)
        banco.entregar(escenario.entregas[0])
        banco.reloj.fijar(escenario.entregas[0].instante + 501)
        banco.modelo.evaluar()
        XCTAssertEqual(banco.modelo.estado, .sinDatos(.sinRecepcion))
        XCTAssertEqual(banco.salida.dicho.last, "Sin datos del sensor.")
    }

    func testUnPasoSinRespuestaFallaPorTiempo() {
        let banco = BancoAccesorio()
        defer { banco.cerrar() }
        banco.iniciar()
        banco.transporte.emitir(.conectado(id: banco.accesorio.id))
        banco.reloj.avanzar(SesionAccesorioModelo.plazoPasoMs + 1)
        banco.modelo.evaluar()
        XCTAssertEqual(banco.modelo.estado, .falla(.tiempoAgotado))
        XCTAssertGreaterThanOrEqual(banco.transporte.veces("desconectar"), 1)
    }

    /// El transporte solo emite `.conectado` cuando también terminó de descubrir el servicio y sus dos
    /// características, así que este plazo cubre la conexión Y el descubrimiento.
    func testUnaConexionPendienteCaducaPorTiempoYSePuedeReconectar() {
        let banco = BancoAccesorio()
        defer { banco.cerrar() }
        banco.iniciar()
        let viejo = banco.transporte.tokenVigente

        banco.reloj.avanzar(SesionAccesorioModelo.plazoPasoMs)
        banco.modelo.evaluar()
        XCTAssertEqual(banco.modelo.estado, .conectando, "justo en el plazo todavía espera")
        banco.reloj.avanzar(1)
        banco.modelo.evaluar()
        XCTAssertEqual(banco.modelo.estado, .falla(.tiempoAgotado))
        XCTAssertGreaterThanOrEqual(banco.transporte.veces("desconectar"), 1, "se cancela la conexión pendiente")
        XCTAssertEqual(banco.salida.dicho.last, "Fallo del accesorio. Sin avisos.")

        // Una conexión tardía de la que ya se rindió no resucita nada.
        banco.transporte.emitir(.conectado(id: banco.accesorio.id), token: viejo)
        XCTAssertEqual(banco.modelo.estado, .falla(.tiempoAgotado))
        XCTAssertEqual(banco.transporte.veces("leerInformacion"), 0)

        banco.modelo.reconectar()
        XCTAssertEqual(banco.modelo.estado, .conectando)
        XCTAssertNotEqual(banco.transporte.tokenVigente, viejo)
        banco.reloj.avanzar(SesionAccesorioModelo.plazoPasoMs + 1)
        banco.modelo.evaluar()
        XCTAssertEqual(banco.modelo.estado, .falla(.tiempoAgotado), "el plazo vuelve a contar en cada intento")
    }

    func testElPlazoNoCuentaMientrasSeEsperaElPermisoOElBluetooth() {
        let banco = BancoAccesorio()
        defer { banco.cerrar() }
        banco.transporte.emitir(.disponibilidad(.apagado), token: tokenSinConexion)
        banco.iniciar()
        banco.reloj.avanzar(60_000)
        banco.modelo.evaluar()
        XCTAssertEqual(banco.modelo.estado, .bluetoothNoDisponible(.apagado), "se dice que falta el Bluetooth, no que el accesorio no respondió")
        banco.transporte.emitir(.disponibilidad(.disponible), token: tokenSinConexion)
        banco.reloj.avanzar(SesionAccesorioModelo.plazoPasoMs)
        banco.modelo.evaluar()
        XCTAssertEqual(banco.modelo.estado, .conectando, "el plazo empieza al volver el Bluetooth")
    }

    // MARK: Desconexión y reconexión

    func testDesconexionReconectaConSesionNuevaSinAvisosHistoricos() throws {
        let banco = BancoAccesorio()
        defer { banco.cerrar() }
        let escenario = try objetivo()
        banco.iniciar()
        banco.sincronizar(escenario)
        banco.entregar(escenario.entregas[0])
        let tokenViejo = banco.transporte.tokenVigente

        banco.transporte.emitir(.desconectado)
        XCTAssertEqual(banco.modelo.estado, .desconectado)
        XCTAssertEqual(banco.salida.dicho.last, "Accesorio desconectado.")
        XCTAssertEqual(banco.modelo.estadoSesion, .desconectada, "ninguna medida sobrevive a la desconexión")
        XCTAssertEqual(banco.transporte.veces("conectar:acc-1"), 2, "reconecta sola")
        XCTAssertNotEqual(banco.transporte.tokenVigente, tokenViejo)

        let dicho = banco.salida.dicho
        banco.transporte.emitir(.notificacionMedicion(escenario.entregas[1].datos), token: tokenViejo)
        XCTAssertEqual(banco.modelo.estado, .desconectado)
        XCTAssertEqual(banco.salida.dicho, dicho, "lo del enlace anterior no se dice")

        banco.sincronizar(escenario)
        XCTAssertEqual(banco.modelo.estado, .sinDeteccion)
        XCTAssertEqual(Array(banco.salida.dicho.suffix(2)), ["Accesorio conectado. Calibrando. Aún sin avisos.", "Sin detección en este momento."])
    }

    func testElFalloDeConexionNoReintentaSolo() {
        let banco = BancoAccesorio()
        defer { banco.cerrar() }
        banco.iniciar()
        banco.transporte.emitir(.fallo(.conexionFallida))
        XCTAssertEqual(banco.modelo.estado, .falla(.conexionFallida))
        XCTAssertEqual(banco.transporte.veces("conectar:acc-1"), 1)
        banco.modelo.reconectar()
        XCTAssertEqual(banco.transporte.veces("conectar:acc-1"), 2)
        XCTAssertEqual(banco.modelo.estado, .conectando)
    }

    // MARK: Bluetooth y permisos

    func testBluetoothApagadoSeDiceYAlVolverReconecta() throws {
        let banco = BancoAccesorio()
        defer { banco.cerrar() }
        let escenario = try objetivo()
        banco.iniciar()
        banco.sincronizar(escenario)
        let tokenViejo = banco.transporte.tokenVigente

        banco.transporte.emitir(.disponibilidad(.apagado), token: tokenSinConexion)
        XCTAssertEqual(banco.modelo.estado, .bluetoothNoDisponible(.apagado))
        XCTAssertEqual(banco.salida.dicho.last, "Bluetooth no disponible. Sin avisos.")
        banco.transporte.emitir(.notificacionMedicion(escenario.entregas[0].datos), token: tokenViejo)
        XCTAssertEqual(banco.modelo.estado, .bluetoothNoDisponible(.apagado))

        banco.transporte.emitir(.disponibilidad(.disponible), token: tokenSinConexion)
        XCTAssertEqual(banco.transporte.veces("conectar:acc-1"), 2)
        XCTAssertEqual(banco.modelo.estado, .conectando)
    }

    func testSinPermisoSeDiceYNoSeConecta() {
        let banco = BancoAccesorio()
        defer { banco.cerrar() }
        banco.transporte.emitir(.disponibilidad(.sinPermiso), token: tokenSinConexion)
        banco.iniciar()
        XCTAssertEqual(banco.modelo.estado, .bluetoothNoDisponible(.sinPermiso))
        banco.transporte.emitir(.conectado(id: banco.accesorio.id))
        XCTAssertEqual(banco.modelo.estadoSesion, .desconectada)
    }

    // MARK: Elección explícita y búsqueda

    func testSinAccesorioElegidoNoSePuedeIniciar() {
        let banco = BancoAccesorio()
        defer { banco.cerrar() }
        XCTAssertEqual(banco.modelo.estado, .sinAccesorio)
        banco.modelo.iniciar()
        XCTAssertFalse(banco.modelo.activa)
        XCTAssertEqual(banco.transporte.veces("conectar:acc-1"), 0)
    }

    func testLaBusquedaListaSinRepetirYElegirLaDetiene() {
        let banco = BancoAccesorio()
        defer { banco.cerrar() }
        banco.modelo.buscar()
        banco.transporte.emitir(.encontrado(banco.accesorio), token: tokenSinConexion)
        banco.transporte.emitir(.encontrado(banco.accesorio), token: tokenSinConexion)
        XCTAssertEqual(banco.modelo.encontrados, [banco.accesorio])
        XCTAssertNil(banco.modelo.elegido, "encontrar no es elegir")
        banco.modelo.elegir(banco.accesorio)
        XCTAssertFalse(banco.modelo.buscando)
        XCTAssertEqual(banco.modelo.estado, .detenido)
        XCTAssertEqual(banco.transporte.veces("conectar:acc-1"), 0, "elegir no conecta: iniciar es explícito")
    }

    // MARK: Primer plano, bloqueo y segundo plano

    func testEscenaInactivaCallaYAlVolverResincroniza() throws {
        let banco = BancoAccesorio()
        defer { banco.cerrar() }
        let escenario = try EscenarioBLE.cargar("reanudar-desde-suspension")
        banco.iniciar()
        banco.sincronizar(escenario)
        banco.entregar(escenario.entregas[0])
        let dicho = banco.salida.dicho
        let cortes = banco.salida.cortes

        banco.modelo.escenaActiva(false)
        XCTAssertTrue(banco.modelo.suspendida)
        XCTAssertGreaterThan(banco.salida.cortes, cortes, "se corta lo que suene")
        banco.entregar(escenario.entregas[1])
        XCTAssertEqual(banco.salida.dicho, dicho, "suspendida no se dice nada, aunque lleguen tramas")

        banco.modelo.escenaActiva(true)
        XCTAssertFalse(banco.modelo.suspendida)
        XCTAssertEqual(banco.modelo.estado, .calibrando, "el estado previo se invalida")
        XCTAssertEqual(banco.transporte.llamadas.last, "notificaciones:false")
        XCTAssertEqual(banco.salida.dicho.last, "Accesorio conectado. Calibrando. Aún sin avisos.")

        // Referencia fresca posterior: la secuencia se conserva (contrato §5.3).
        let referencia = escenario.referencias[1]
        banco.reloj.fijar(referencia.inicio)
        banco.transporte.emitir(.notificacionesFijadas(false))
        banco.reloj.fijar(referencia.fin)
        banco.transporte.emitir(.respuestaMedicion(referencia.datos))
        banco.transporte.emitir(.notificacionesFijadas(true))
        XCTAssertEqual(banco.modelo.estado, .sinDeteccion)
    }

    func testEnlaceCaidoDuranteLaSuspensionSeReconectaDeCero() throws {
        let banco = BancoAccesorio()
        defer { banco.cerrar() }
        let escenario = try objetivo()
        banco.iniciar()
        banco.sincronizar(escenario)
        banco.modelo.escenaActiva(false)
        banco.transporte.emitir(.desconectado)
        banco.modelo.escenaActiva(true)
        XCTAssertEqual(banco.transporte.veces("conectar:acc-1"), 2)
        XCTAssertEqual(banco.modelo.estado, .conectando)
    }

    func testSincronizacionAMediasDuranteLaSuspensionSeReiniciaDeCero() {
        let banco = BancoAccesorio()
        defer { banco.cerrar() }
        banco.iniciar()
        banco.transporte.emitir(.conectado(id: banco.accesorio.id))
        banco.modelo.escenaActiva(false)
        banco.modelo.escenaActiva(true)
        XCTAssertEqual(banco.transporte.veces("conectar:acc-1"), 2)
    }

    // MARK: Audio

    func testSinAuricularesNoSeHablaPeroElEstadoSigueVisible() throws {
        let banco = BancoAccesorio(ruta: .noPrivada)
        defer { banco.cerrar() }
        let escenario = try objetivo()
        banco.iniciar()
        banco.sincronizar(escenario)
        banco.entregar(escenario.entregas[1])
        XCTAssertEqual(banco.modelo.estado, .objetivo(distanciaMm: 1500, azimutCentesimas: nil))
        XCTAssertTrue(banco.salida.dicho.isEmpty, "por el altavoz no se dice nada")

        // Al ponerse los auriculares se dice solo el estado de ahora, no el historial.
        banco.ruta.valor = .privada
        banco.modelo.voz.rutaCambio()
        XCTAssertEqual(banco.salida.dicho, ["Objeto a 1,5 metros."])
    }

    func testUnaInterrupcionCortaYAlTerminarSoloSeDiceElEstadoActual() throws {
        let banco = BancoAccesorio()
        defer { banco.cerrar() }
        let escenario = try objetivo()
        banco.iniciar()
        banco.sincronizar(escenario)
        banco.entregar(escenario.entregas[0])
        banco.modelo.voz.interrupcion(comenzo: true)
        banco.entregar(escenario.entregas[1])
        XCTAssertEqual(banco.salida.dicho.last, "Objeto a 1 metro, a la izquierda.", "durante la llamada no se dice la nueva medida")
        banco.modelo.voz.interrupcion(comenzo: false)
        XCTAssertEqual(banco.salida.dicho.last, "Objeto a 1,5 metros.")
    }

}
