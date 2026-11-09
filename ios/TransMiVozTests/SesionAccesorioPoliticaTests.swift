import ContratoBLE
import XCTest
@testable import TransMiVoz

/// Permiso, búsqueda, avisos accesibles, VoiceOver y recuperación del audio de la sesión con el accesorio.
/// Transporte, voz, ruta, reloj y avisos son dobles; las tramas salen de `contratos/ble/sesiones.txt`.
@MainActor
final class SesionAccesorioPoliticaTests: XCTestCase {
    private func objetivo() throws -> EscenarioBLE { try .cargar("objetivo-distancia-y-azimut") }

    // MARK: Permiso de Bluetooth: se explica antes del aviso del sistema

    func testElPermisoSeExplicaAntesDeBuscarYAhoraNoNoPideNada() {
        let banco = BancoAccesorio()
        defer { banco.cerrar() }
        banco.transporte.permisoPorPreguntar = true

        banco.modelo.buscar()
        XCTAssertEqual(banco.modelo.explicacionPermiso, .buscar)
        XCTAssertEqual(banco.transporte.veces("buscar"), 0, "el aviso del sistema no sale todavía")
        XCTAssertFalse(banco.modelo.busquedaPedida)

        banco.modelo.cancelarExplicacion()
        XCTAssertNil(banco.modelo.explicacionPermiso)
        XCTAssertEqual(banco.transporte.veces("buscar"), 0, "«Ahora no» no pide nada al sistema")

        banco.modelo.buscar()
        banco.modelo.continuarTrasExplicacion()
        XCTAssertNil(banco.modelo.explicacionPermiso)
        XCTAssertEqual(banco.transporte.veces("buscar"), 1)
        XCTAssertTrue(banco.modelo.buscando)
    }

    func testIniciarTambienExplicaElPermisoAntesDeConectar() {
        let banco = BancoAccesorio()
        defer { banco.cerrar() }
        banco.transporte.permisoPorPreguntar = true
        banco.modelo.elegir(banco.accesorio)

        banco.modelo.iniciar()
        XCTAssertEqual(banco.modelo.explicacionPermiso, .iniciar)
        XCTAssertFalse(banco.modelo.activa)
        XCTAssertEqual(banco.transporte.veces("conectar:acc-1"), 0)

        banco.modelo.continuarTrasExplicacion()
        XCTAssertTrue(banco.modelo.activa)
        XCTAssertEqual(banco.transporte.veces("conectar:acc-1"), 1)
    }

    func testCrearLaSesionNoTocaElTransporte() {
        let banco = BancoAccesorio()
        defer { banco.cerrar() }
        XCTAssertEqual(banco.transporte.llamadas, [], "ni buscar ni conectar al arrancar la app: sin aviso de permiso")
    }

    // MARK: Búsqueda: la intención sobrevive al aviso del sistema

    /// El primer uso: el gestor se crea (despierta el transporte), el sistema muestra su aviso y deja la
    /// escena inactiva, la persona acepta y el Bluetooth queda disponible. Dos órdenes posibles de llegada.
    func testLaBusquedaSobreviveAlAvisoDeSistemaQueDejaLaEscenaInactiva() {
        for disponibleAntesDeVolver in [true, false] {
            let banco = BancoAccesorio()
            defer { banco.cerrar() }
            banco.transporte.emitir(.disponibilidad(.desconocida), token: tokenSinConexion)
            banco.transporte.permisoPorPreguntar = true

            banco.modelo.buscar()
            banco.modelo.continuarTrasExplicacion()
            XCTAssertTrue(banco.modelo.busquedaPedida)
            XCTAssertFalse(banco.modelo.buscando, "Bluetooth sin confirmar: no se presenta como buscando")
            XCTAssertEqual(banco.transporte.llamadas, ["buscar"], "solo despierta el transporte")

            banco.modelo.escenaActiva(false)  // aparece el aviso del sistema
            XCTAssertTrue(banco.modelo.busquedaPedida, "inactiva no es «dejar de buscar»")
            XCTAssertEqual(banco.transporte.veces("dejarDeBuscar"), 0)

            if disponibleAntesDeVolver {
                banco.transporte.emitir(.disponibilidad(.disponible), token: tokenSinConexion)
                XCTAssertEqual(banco.transporte.veces("buscar"), 1, "con la escena inactiva no se escanea")
                banco.modelo.escenaActiva(true)
            } else {
                banco.modelo.escenaActiva(true)
                XCTAssertEqual(banco.transporte.veces("buscar"), 2, "activa pero sin Bluetooth confirmado: solo despierta")
                banco.transporte.emitir(.disponibilidad(.disponible), token: tokenSinConexion)
            }
            XCTAssertTrue(banco.modelo.buscando)
            XCTAssertEqual(banco.transporte.llamadas.last, "buscar")
            banco.transporte.emitir(.encontrado(banco.accesorio), token: tokenSinConexion)
            XCTAssertEqual(banco.modelo.encontrados, [banco.accesorio])
            XCTAssertEqual(banco.transporte.veces("dejarDeBuscar"), 0)
        }
    }

    func testNuncaSePresentaBuscandoConElBluetoothApagadoOSinPermiso() {
        let banco = BancoAccesorio()
        defer { banco.cerrar() }
        banco.transporte.emitir(.disponibilidad(.apagado), token: tokenSinConexion)
        banco.modelo.buscar()
        XCTAssertTrue(banco.modelo.busquedaPedida)
        XCTAssertFalse(banco.modelo.buscando)
        XCTAssertEqual(banco.transporte.veces("dejarDeBuscar"), 0, "no había escaneo que parar")

        banco.transporte.emitir(.disponibilidad(.disponible), token: tokenSinConexion)
        XCTAssertTrue(banco.modelo.buscando, "apagado vuelve: la búsqueda pedida sigue")
        banco.transporte.emitir(.encontrado(banco.accesorio), token: tokenSinConexion)
        XCTAssertEqual(banco.modelo.encontrados.count, 1)

        banco.transporte.emitir(.disponibilidad(.apagado), token: tokenSinConexion)
        XCTAssertFalse(banco.modelo.buscando)
        XCTAssertEqual(banco.modelo.encontrados, [], "sin Bluetooth no se ofrecen accesorios")
        banco.transporte.emitir(.disponibilidad(.disponible), token: tokenSinConexion)
        XCTAssertEqual(banco.transporte.veces("buscar"), 2, "escaneo nuevo al volver")

        banco.transporte.emitir(.disponibilidad(.sinPermiso), token: tokenSinConexion)
        XCTAssertFalse(banco.modelo.buscando)
        XCTAssertFalse(banco.modelo.busquedaPedida, "sin permiso no vuelve solo: la intención se cierra")
    }

    func testSuspenderParaElEscaneoYAlVolverElListadoEmpiezaDeCero() {
        let banco = BancoAccesorio()
        defer { banco.cerrar() }
        banco.modelo.buscar()
        banco.transporte.emitir(.encontrado(banco.accesorio), token: tokenSinConexion)

        banco.modelo.escenaActiva(false)
        XCTAssertEqual(banco.transporte.veces("dejarDeBuscar"), 1)
        XCTAssertTrue(banco.modelo.busquedaPedida)
        XCTAssertFalse(banco.modelo.buscando)
        banco.transporte.emitir(.encontrado(AccesorioDetectado(id: "acc-9", nombre: nil)), token: tokenSinConexion)
        XCTAssertEqual(banco.modelo.encontrados, [banco.accesorio], "suspendida no se agrega nada")

        banco.modelo.escenaActiva(true)
        XCTAssertEqual(banco.transporte.veces("buscar"), 2)
        XCTAssertEqual(banco.modelo.encontrados, [], "escaneo nuevo, lista nueva")
    }

    func testDejarDeBuscarPideParoUnaVezYElegirTambienCierraLaIntencion() {
        let banco = BancoAccesorio()
        defer { banco.cerrar() }
        banco.modelo.buscar()
        banco.modelo.dejarDeBuscar()
        banco.modelo.dejarDeBuscar()
        XCTAssertEqual(banco.transporte.veces("dejarDeBuscar"), 1)
        banco.modelo.buscar()
        banco.modelo.elegir(banco.accesorio)
        XCTAssertFalse(banco.modelo.busquedaPedida)
        XCTAssertEqual(banco.transporte.veces("dejarDeBuscar"), 2)
    }

    // MARK: Avisos accesibles (sin mover el foco) y VoiceOver

    func testConVoiceOverLosEstadosQueNoSonMedidasSeAnuncianUnaVez() throws {
        let banco = BancoAccesorio(nivel: .desconocido, voiceOver: true)
        defer { banco.cerrar() }
        banco.iniciar()
        banco.transporte.emitir(.conectado(id: banco.accesorio.id))
        let bloqueo = "Avisos bloqueados: no se puede verificar la seguridad del enlace. Esto no es una detección."
        XCTAssertEqual(banco.avisos.deEstado, [bloqueo])
        banco.modelo.evaluar()
        banco.modelo.evaluar()
        XCTAssertEqual(banco.avisos.deEstado, [bloqueo], "el latido no repite el anuncio")
        XCTAssertTrue(banco.salida.dicho.isEmpty, "con VoiceOver la voz propia empieza apagada: no hablan dos")
        XCTAssertFalse(banco.modelo.vozPropiaActiva)
    }

    func testFalloYDesconexionSeAnuncianYLaMedidaNuncaSale() throws {
        let banco = BancoAccesorio(voiceOver: true)
        defer { banco.cerrar() }
        let escenario = try objetivo()
        banco.iniciar()
        banco.sincronizar(escenario)
        banco.entregar(escenario.entregas[0])
        banco.entregar(escenario.entregas[1])
        XCTAssertEqual(banco.avisos.deEstado, [], "objeto, presencia y sin detección no pasan por VoiceOver")
        XCTAssertTrue(banco.salida.dicho.isEmpty)

        banco.transporte.emitir(.desconectado)
        banco.transporte.emitir(.fallo(.conexionFallida))
        XCTAssertEqual(banco.avisos.deEstado, [
            "Accesorio desconectado. Se intenta reconectar.",
            "No se pudo conectar con el accesorio. Sin avisos. Usa Reconectar. \(TextoAccesorio.recuperacionRepetida)",
        ])
        XCTAssertFalse(banco.avisos.deEstado.contains { $0.contains("Objeto") || $0.contains("Presencia") || $0.contains("Sin detección") })
    }

    func testElBloqueoPorEnlaceNoVerificadoEsUrgenteYElegirEsDeRutina() throws {
        let banco = BancoAccesorio(nivel: .desconocido, voiceOver: true)
        defer { banco.cerrar() }
        let eleccion = "Accesorio elegido: Visionaria (cc-1)."
        // Confirmación de lo que la persona hizo (elegir): rutina.
        banco.iniciar()
        XCTAssertEqual(banco.avisos.anuncios(.rutina), [eleccion])
        XCTAssertEqual(banco.avisos.anuncios(.urgente), [])

        // Enlace sin verificar: el bloqueo es urgente.
        banco.transporte.emitir(.conectado(id: banco.accesorio.id))
        XCTAssertEqual(banco.modelo.estado, .enlaceNoVerificado)
        XCTAssertEqual(banco.avisos.anuncios(.urgente).count, 1, "bloqueo")
        XCTAssertEqual(banco.avisos.anuncios(.urgente), banco.avisos.deEstado)
        XCTAssertEqual(banco.avisos.anuncios(.rutina), [eleccion], "lo urgente no se mezcla con la rutina")

        // Tras el rechazo la conexión queda cerrada: el aviso tardío de esa conexión no anuncia nada más.
        banco.transporte.emitir(.desconectado)
        banco.transporte.emitir(.fallo(.conexionFallida))
        XCTAssertEqual(banco.modelo.estado, .enlaceNoVerificado)
        XCTAssertEqual(banco.avisos.anuncios(.urgente).count, 1, "los avisos de la conexión vieja se descartan")
        XCTAssertEqual(banco.avisos.anuncios(.rutina), [eleccion])
    }

    func testLaDesconexionYElFalloSonUrgentesYElegirSigueSiendoDeRutina() throws {
        let banco = BancoAccesorio(voiceOver: true)
        defer { banco.cerrar() }
        let escenario = try objetivo()
        banco.iniciar()
        banco.sincronizar(escenario)
        XCTAssertEqual(banco.avisos.anuncios(.rutina), ["Accesorio elegido: Visionaria (cc-1)."])
        XCTAssertEqual(banco.avisos.anuncios(.urgente), [])

        // Desconexión y, en la conexión nueva que se reintenta, el fallo: urgentes.
        banco.transporte.emitir(.desconectado)
        banco.transporte.emitir(.fallo(.conexionFallida))
        XCTAssertEqual(banco.avisos.anuncios(.urgente), banco.avisos.deEstado)
        XCTAssertEqual(banco.avisos.anuncios(.urgente).count, 2, "desconexión y fallo")
        XCTAssertEqual(banco.avisos.anuncios(.rutina).count, 1, "lo urgente no se mezcla con la rutina")
    }

    func testPerderLaSalidaPrivadaYElAudioNoDisponibleSonUrgentes() throws {
        let eleccion = "Accesorio elegido: Visionaria (cc-1)."
        let banco = BancoAccesorio()
        defer { banco.cerrar() }
        let escenario = try objetivo()
        banco.iniciar()
        banco.sincronizar(escenario)
        banco.ruta.valor = .noPrivada
        banco.modelo.voz.rutaCambio()
        XCTAssertEqual(banco.avisos.anuncios(.urgente), [TextoAccesorio.audioSinAuriculares])
        XCTAssertEqual(banco.avisos.anuncios(.rutina), [eleccion], "solo la confirmación de elegir es de rutina")

        let otro = BancoAccesorio()
        defer { otro.cerrar() }
        otro.salida.resultado = .sesionNoDisponible
        otro.iniciar()
        XCTAssertEqual(otro.avisos.anuncios(.urgente), [TextoAccesorio.audioNoDisponibleAviso])
        XCTAssertEqual(otro.avisos.anuncios(.rutina), [eleccion], "solo la confirmación de elegir es de rutina")
    }

    func testNingunaMedidaSalePorElCaminoPublicoConNingunaPrioridad() throws {
        let banco = BancoAccesorio(voiceOver: true)
        defer { banco.cerrar() }
        let escenario = try objetivo()
        banco.iniciar()
        banco.sincronizar(escenario)
        // Antes de las medidas: solo la confirmación de elegir (rutina) y ningún aviso urgente.
        let anunciosAntes = banco.avisos.anuncios
        XCTAssertEqual(anunciosAntes, ["Accesorio elegido: Visionaria (cc-1)."])
        XCTAssertEqual(banco.avisos.anuncios(.rutina), anunciosAntes)
        XCTAssertEqual(banco.avisos.anuncios(.urgente), [])
        XCTAssertEqual(banco.modelo.estado, .sinDeteccion)

        banco.entregar(escenario.entregas[0])
        XCTAssertEqual(banco.modelo.estado, .objetivo(distanciaMm: 1200, azimutCentesimas: -3000), "la medida sí llegó al modelo")
        banco.entregar(escenario.entregas[1])
        banco.entregar(escenario.entregas[2])
        XCTAssertEqual(banco.modelo.estado, .presencia)
        XCTAssertEqual(banco.avisos.anuncios, anunciosAntes, "objeto, presencia y sin detección no se anuncian, ni urgentes ni de rutina")
        XCTAssertEqual(banco.avisos.anuncios(.urgente), [])
        XCTAssertEqual(banco.avisos.anuncios(.rutina), anunciosAntes)
        XCTAssertTrue(banco.salida.dicho.isEmpty)
    }

    func testElSensorNoSeAnunciaPorVoiceOverNiConLaVozPropiaApagada() throws {
        let banco = BancoAccesorio(ruta: .noPrivada, voiceOver: false)
        defer { banco.cerrar() }
        let escenario = try objetivo()
        banco.iniciar()
        banco.sincronizar(escenario)
        banco.entregar(escenario.entregas[0])
        banco.entregar(escenario.entregas[1])
        // Ruta pública: ni voz ni anuncio con medidas; solo pantalla.
        XCTAssertTrue(banco.salida.dicho.isEmpty)
        XCTAssertEqual(banco.avisos.deEstado, [])
    }

    func testConVoiceOverLaVozPropiaSePuedeEncenderYEntoncesNoSeRepiteElBloqueo() throws {
        let banco = BancoAccesorio(nivel: .desconocido, voiceOver: true)
        defer { banco.cerrar() }
        banco.modelo.fijarVozPropia(true)
        XCTAssertTrue(banco.modelo.vozPropiaActiva)
        banco.iniciar()
        banco.transporte.emitir(.conectado(id: banco.accesorio.id))
        XCTAssertEqual(banco.salida.dicho.last, "Avisos bloqueados. No se puede verificar la seguridad del enlace.")
        XCTAssertEqual(banco.avisos.deEstado, [], "la voz propia ya lo dijo: VoiceOver no lo repite")
    }

    func testEncenderLaVozPropiaDiceElEstadoDeAhora() throws {
        let banco = BancoAccesorio(voiceOver: true)
        defer { banco.cerrar() }
        let escenario = try objetivo()
        banco.iniciar()
        banco.sincronizar(escenario)
        banco.entregar(escenario.entregas[0])
        XCTAssertTrue(banco.salida.dicho.isEmpty)
        banco.modelo.fijarVozPropia(true)
        XCTAssertEqual(banco.salida.dicho, ["Objeto a 1 metro, a la izquierda."])
        banco.modelo.fijarVozPropia(false)
        XCTAssertEqual(banco.salida.llamadas.last, "detener")
    }

    func testSinVoiceOverLaVozPropiaEmpiezaEncendida() {
        let banco = BancoAccesorio(voiceOver: false)
        defer { banco.cerrar() }
        XCTAssertTrue(banco.modelo.vozPropiaActiva)
    }

    func testElCambioDeAccesorioSeConfirma() throws {
        let banco = BancoAccesorio(voiceOver: true)
        defer { banco.cerrar() }
        banco.modelo.elegir(banco.accesorio)
        XCTAssertEqual(banco.avisos.anuncios.last, "Accesorio elegido: Visionaria (cc-1).")
        banco.modelo.iniciar()
        banco.modelo.elegir(AccesorioDetectado(id: "acc-2", nombre: "Otro"))
        XCTAssertEqual(banco.avisos.anuncios.last, "Accesorio elegido: Otro (cc-2). La sesión anterior se detuvo.")
    }

    func testPerderLaSalidaPrivadaVibraYAvisaSoloConLaSesionActiva() throws {
        let banco = BancoAccesorio()
        defer { banco.cerrar() }
        banco.ruta.valor = .noPrivada
        banco.modelo.voz.rutaCambio()
        XCTAssertEqual(banco.avisos.vibraciones, 0, "sin sesión no hay nada que avisar")

        banco.ruta.valor = .privada
        banco.modelo.voz.rutaCambio()
        let escenario = try objetivo()
        banco.iniciar()
        banco.sincronizar(escenario)
        banco.ruta.valor = .noPrivada
        banco.modelo.voz.rutaCambio()
        XCTAssertEqual(banco.avisos.vibraciones, 1)
        XCTAssertEqual(banco.avisos.deEstado.last, TextoAccesorio.audioSinAuriculares)
    }

    // MARK: Audio no disponible: se falla cerrado y se dice

    func testSiElSistemaNoDejaActivarElAudioNoSeDiceHabladoYSeAvisa() throws {
        let banco = BancoAccesorio()
        defer { banco.cerrar() }
        banco.salida.resultado = .sesionNoDisponible
        banco.iniciar()
        XCTAssertTrue(banco.salida.dicho.isEmpty)
        XCTAssertTrue(banco.salida.llamadas.contains("intento:Conectando con el accesorio."))
        XCTAssertTrue(banco.modelo.voz.audioNoDisponible)
        XCTAssertEqual(banco.avisos.deEstado, [TextoAccesorio.audioNoDisponibleAviso], "la voz no pudo: el aviso va por accesibilidad")
        let texto = TextoAccesorio.audio(ruta: .privada, interrumpido: false, audioNoDisponible: true)
        XCTAssertTrue(texto.hasPrefix("Audio no disponible"))
        XCTAssertNotEqual(texto, TextoAccesorio.audio(ruta: .privada, interrumpido: false))
        banco.modelo.evaluar()
        XCTAssertEqual(banco.avisos.deEstado.count, 1, "sin reintento ni anuncio repetido en cada latido")
        XCTAssertEqual(banco.salida.llamadas.filter { $0.hasPrefix("intento:") }.count, 1, "\(banco.salida.llamadas)")

        // Cuando el sistema vuelve a dejar, el siguiente cambio de escena dice el estado de ahora.
        banco.salida.resultado = .iniciada
        banco.modelo.escenaActiva(false)
        banco.modelo.escenaActiva(true)
        XCTAssertFalse(banco.modelo.voz.audioNoDisponible)
        XCTAssertEqual(banco.salida.dicho.last, "Conectando con el accesorio.")
    }

    // MARK: Audio recuperado: nunca se dice una medida vencida

    func testFinDeInterrupcionTrasVencerLaMedidaNoRepiteElObjetoViejo() throws {
        let banco = BancoAccesorio()
        defer { banco.cerrar() }
        let escenario = try objetivo()
        banco.iniciar()
        banco.sincronizar(escenario)
        banco.entregar(escenario.entregas[0])
        XCTAssertEqual(banco.salida.dicho.last, "Objeto a 1 metro, a la izquierda.")

        banco.modelo.voz.interrupcion(comenzo: true)
        banco.reloj.avanzar(600)  // vence la medida; el latido de 100 ms todavía no corrió
        banco.modelo.voz.interrupcion(comenzo: false)
        XCTAssertEqual(banco.salida.dicho.last, "Sin datos del sensor.")
        XCTAssertEqual(banco.modelo.estado, .sinDatos(.sinRecepcion))
        XCTAssertEqual(banco.salida.dicho.filter { $0.hasPrefix("Objeto") }.count, 1)
    }

    func testRecuperarLosAuricularesTrasVencerLaMedidaNoRepiteLaPresencia() throws {
        let banco = BancoAccesorio()
        defer { banco.cerrar() }
        let escenario = try objetivo()
        banco.iniciar()
        banco.sincronizar(escenario)
        for entrega in escenario.entregas { banco.entregar(entrega) }
        XCTAssertEqual(banco.salida.dicho.last, "Presencia detectada.")

        banco.ruta.valor = .noPrivada
        banco.modelo.voz.rutaCambio()
        banco.reloj.avanzar(600)
        banco.ruta.valor = .privada
        banco.modelo.voz.rutaCambio()
        XCTAssertEqual(banco.salida.dicho.last, "Sin datos del sensor.")
        XCTAssertEqual(banco.salida.dicho.filter { $0 == "Presencia detectada." }.count, 1)
    }

    func testCambioDeRutaPrivadaACortaLaLocucionYDiceElEstadoDeAhora() throws {
        let banco = BancoAccesorio()
        defer { banco.cerrar() }
        let escenario = try objetivo()
        banco.iniciar()
        banco.sincronizar(escenario)
        banco.entregar(escenario.entregas[0])
        // Otros auriculares: la ruta sigue privada pero el sistema cortó lo que sonaba.
        banco.modelo.voz.rutaCambio()
        XCTAssertEqual(Array(banco.salida.dicho.suffix(2)), ["Objeto a 1 metro, a la izquierda.", "Objeto a 1 metro, a la izquierda."])

        // Sin nada sonando no hay nada que repetir.
        banco.salida.terminarSola()
        let antes = banco.salida.dicho.count
        banco.modelo.voz.rutaCambio()
        XCTAssertEqual(banco.salida.dicho.count, antes)
    }

    // MARK: Interrupción que no avisa su final

    func testSinFinDeInterrupcionLaVueltaAPrimerPlanoLimpiaLaBanderaYDiceElEstadoDeAhora() throws {
        let banco = BancoAccesorio()
        defer { banco.cerrar() }
        let escenario = try objetivo()
        banco.iniciar()
        banco.sincronizar(escenario)
        banco.entregar(escenario.entregas[0])
        banco.modelo.voz.interrupcion(comenzo: true)  // iOS no entrega nunca el .ended
        XCTAssertTrue(banco.modelo.voz.interrumpido)

        banco.modelo.escenaActiva(false)
        banco.modelo.escenaActiva(true)
        XCTAssertFalse(banco.modelo.voz.interrumpido)
        XCTAssertEqual(banco.salida.dicho.last, "Accesorio conectado. Calibrando. Aún sin avisos.", "estado de ahora, no el viejo")
    }

    func testSiLaInterrupcionSigueDeVerdadLaActivacionFallaYSeFallaCerrado() throws {
        let banco = BancoAccesorio()
        defer { banco.cerrar() }
        let escenario = try objetivo()
        banco.iniciar()
        banco.sincronizar(escenario)
        banco.entregar(escenario.entregas[0])
        let dicho = banco.salida.dicho
        banco.modelo.voz.interrupcion(comenzo: true)

        banco.salida.resultado = .sesionNoDisponible  // la llamada sigue: el sistema no activa el audio
        banco.modelo.escenaActiva(false)
        banco.modelo.escenaActiva(true)
        XCTAssertEqual(banco.salida.dicho, dicho, "no se habla")
        XCTAssertTrue(banco.modelo.voz.audioNoDisponible)
        XCTAssertFalse(banco.modelo.voz.interrumpido, "la bandera no se cree, pero la activación falló cerrada")
    }
}
