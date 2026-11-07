import ContratoBLE
import Foundation
import Observation

/// Reloj monotónico del iPhone en milisegundos. NO es la hora de pared: no
/// cambia si la persona ajusta el reloj del teléfono.
typealias RelojMonotonico = @Sendable () -> Milisegundos

enum RelojDelSistema {
    /// `systemUptime` es monotónico y no se ve afectado por cambios de fecha y hora.
    static let ahora: RelojMonotonico = { Milisegundos(ProcessInfo.processInfo.systemUptime * 1000) }
}

/// Sesión local de proximidad SIMULADA. Usa `SesionProximidad` (paquete
/// `ContratoBLE`) con `modo: .simulada` y alimenta el guion de `GuionSimulado`.
/// No usa Core Bluetooth ni representa un enlace físico: el estado se muestra
/// siempre como simulación y nunca como validación de hardware.
///
/// Funciona sin red ni backend.
@MainActor
@Observable
final class SesionLocalModelo {
    private(set) var activa = false
    private(set) var estado: EstadoSesion = .desconectada
    private(set) var tramasPerdidas = 0
    /// Siempre `true` en esta versión: no existe transporte real.
    private(set) var esSimulada = true
    /// Siempre `false` en esta versión: no hay enlace real que autenticar.
    private(set) var enlaceAutenticado = false

    @ObservationIgnored private let reloj: RelojMonotonico
    /// Espera `ms` milisegundos; inyectable para pruebas deterministas.
    @ObservationIgnored private let pausa: @Sendable (Milisegundos) async -> Void
    @ObservationIgnored private var tarea: Task<Void, Never>?
    @ObservationIgnored private var generacion = 0

    init(
        reloj: @escaping RelojMonotonico = RelojDelSistema.ahora,
        pausa: @escaping @Sendable (Milisegundos) async -> Void = { ms in
            try? await Task.sleep(nanoseconds: UInt64(max(0, ms)) * 1_000_000)
        }
    ) {
        self.reloj = reloj
        self.pausa = pausa
    }

    func iniciar() {
        guard !activa else { return }
        generacion += 1
        let miGeneracion = generacion
        activa = true
        estado = .desconectada
        tramasPerdidas = 0
        tarea = Task { await self.ejecutarGuion(generacion: miGeneracion) }
    }

    /// Detiene la sesión y descarta cualquier medida: nada queda «vigente».
    func detener() {
        generacion += 1
        tarea?.cancel()
        tarea = nil
        activa = false
        estado = .desconectada
        tramasPerdidas = 0
    }

    /// Al volver de segundo plano la sesión previa no es confiable: se reinicia.
    func alVolverAPrimerPlano() {
        guard activa else { return }
        detener()
        iniciar()
    }

    /// Solo para pruebas: espera a que termine la tarea vigente.
    func esperarTarea() async { await tarea?.value }

    // MARK: Guion

    private func vigente(_ generacion: Int) -> Bool { generacion == self.generacion && !Task.isCancelled }

    private func publicar(_ sesion: SesionProximidad, generacion: Int) {
        guard vigente(generacion) else { return }
        if estado != sesion.estado { estado = sesion.estado }
        if tramasPerdidas != sesion.tramasPerdidas { tramasPerdidas = sesion.tramasPerdidas }
        esSimulada = sesion.esSimulada
        enlaceAutenticado = sesion.enlaceAutenticado
    }

    private func ejecutarGuion(generacion: Int) async {
        // Sin enlace real no se puede afirmar autenticación: la política permite una
        // asociación sin protección frente a intermediario y el estado lo declara
        // (`enlaceAutenticado == false`). No se simula un enlace autenticado.
        var sesion = SesionProximidad(
            accesorioElegido: GuionSimulado.identificadorAccesorio,
            politica: .permitirAsociacionSinMITM,
            modo: .simulada)
        sesion.conectar(accesorio: GuionSimulado.identificadorAccesorio, enlace: .cifradoSinAutenticar)
        publicar(sesion, generacion: generacion)
        await pausa(100)
        guard vigente(generacion) else { return }

        sesion.registrarInformacion(GuionSimulado.datos(GuionSimulado.informacion))
        publicar(sesion, generacion: generacion)
        await pausa(100)
        guard vigente(generacion) else { return }

        let inicioLectura = reloj()
        let finLectura = reloj()
        sesion.registrarReferencia(
            inicioLecturaMs: inicioLectura, finLecturaMs: finLectura,
            datos: GuionSimulado.datos(GuionSimulado.referencia.trama))
        publicar(sesion, generacion: generacion)

        for paso in GuionSimulado.notificaciones {
            // Cada notificación se emite a su instante absoluto respecto de la
            // referencia, para que la espera no acumule deriva.
            let objetivo = finLectura + Milisegundos(paso.desplazamientoMs)
            await pausa(max(0, objetivo - reloj()))
            guard vigente(generacion) else { return }
            sesion.recibirNotificacion(GuionSimulado.datos(paso.trama), recibidaEnMs: reloj())
            publicar(sesion, generacion: generacion)
        }

        // Se acabaron las tramas simuladas: la sesión debe caducar, no repetir la última medida.
        while vigente(generacion) {
            await pausa(100)
            guard vigente(generacion) else { return }
            sesion.evaluar(ahoraMs: reloj())
            publicar(sesion, generacion: generacion)
        }
    }
}
