import AVFoundation
import Foundation
import UIKit

/// Voz y sesión de audio del iPhone. El iPhone es el dueño de `AVSpeechSynthesizer`, de
/// `AVAudioSession` y de la ruta; el accesorio solo manda datos.
///
/// La política (quién puede hablar y cuándo) vive en `ControlVoz`. Aquí solo se habla:
/// - la categoría de audio se configura AQUÍ (al crear el sintetizador y, si cambió, antes de hablar);
///   consultar la ruta solo lee `currentRoute` y no cambia nada, así no provoca avisos de ruta propios;
/// - se activa la sesión justo antes de hablar y se libera cuando termina la última locución viva;
/// - si la sesión de audio no se deja configurar o activar, NO se habla y se devuelve
///   `sesionNoDisponible` (falla cerrado); la ruta se vuelve a comprobar tras activar;
/// - una locución cancelada o reemplazada nunca libera la sesión de la siguiente (`TurnoLocucion`).
@MainActor
final class SintetizadorSistema: NSObject, SalidaVoz, AVSpeechSynthesizerDelegate {
    private let sintetizador = AVSpeechSynthesizer()
    private var turno = TurnoLocucion<AVSpeechUtterance>()

    var hablando: Bool { turno.hablando }
    private(set) var cortadaPorElSistema = false

    override init() {
        super.init()
        sintetizador.delegate = self
        // Sin activar la sesión: no suena ni interrumpe nada. Deja la ruta consultable desde ya.
        try? Self.configurar(AVAudioSession.sharedInstance())
    }

    func hablar(_ texto: String) -> ResultadoHabla {
        if turno.hablando { detener() }
        let sesion = AVAudioSession.sharedInstance()
        do {
            try Self.configurar(sesion)
            try sesion.setActive(true)
        } catch {
            return .sesionNoDisponible
        }
        // Activar puede cambiar la ruta (p. ej. un altavoz Bluetooth que pasa a HFP o vuelve el integrado):
        // se comprueba otra vez antes de que suene nada.
        guard Self.rutaActual() == .privada else {
            Self.liberar()
            return .rutaNoPrivada
        }
        let locucion = AVSpeechUtterance(string: texto)
        locucion.voice = Self.vozEnEspanol()
        locucion.prefersAssistiveTechnologySettings = true
        cortadaPorElSistema = false
        turno.empezar(locucion)
        sintetizador.speak(locucion)
        return .iniciada
    }

    func detener() {
        guard turno.hablando else { return }
        // `didCancel` llega después; la sesión se libera allí, cuando la locución ya no suena y no hay otra
        // más nueva. Si el sistema no tenía nada que cortar no habrá aviso: se libera ya.
        let cancelo = sintetizador.stopSpeaking(at: .immediate)
        if turno.detener(sistemaCancelo: cancelo) { Self.liberar() }
    }

    nonisolated func speechSynthesizer(_ sintetizador: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in self.terminar(utterance) }
    }

    nonisolated func speechSynthesizer(_ sintetizador: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        Task { @MainActor in
            // Si la cortó la app, `detener` ya vació el turno y `actual` es otra o ninguna; si sigue siendo la vigente,
            // la canceló el sistema (Siri, una alarma) sin que la app lo pidiera.
            if self.turno.actual == utterance { self.cortadaPorElSistema = true }
            self.terminar(utterance)
        }
    }

    private func terminar(_ locucion: AVSpeechUtterance) {
        if turno.terminar(locucion) { Self.liberar() }
    }

    // MARK: Sesión de audio y ruta

    /// `.playback` con modo de avisos de voz: baja el volumen de lo demás mientras habla. Solo escribe si
    /// algo difiere, para no provocar avisos de cambio de categoría sin necesidad.
    nonisolated private static func configurar(_ sesion: AVAudioSession) throws {
        if sesion.category == .playback && sesion.mode == .voicePrompt && sesion.categoryOptions.contains(.duckOthers) { return }
        try sesion.setCategory(.playback, mode: .voicePrompt, options: [.duckOthers])
    }

    /// Hay una captura del dictado usando la sesión (`abrirCaptura`…`cerrarCaptura`). Mientras la hay, el aviso tardío de
    /// una locución anterior (`didFinish`/`didCancel` llegan después de cortarla) no libera la sesión: cerraría el micrófono.
    private static var capturaAbierta = false

    /// Sin reintentos: si el sistema no deja liberar (todavía hay audio en curso), la sesión sigue
    /// activa hasta la próxima locución o hasta que el sistema la libere. Con una captura abierta no hace nada.
    private static func liberar() {
        guard !capturaAbierta else { return }
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    nonisolated private static func vozEnEspanol() -> AVSpeechSynthesisVoice? {
        for idioma in ["es-CO", "es-MX", "es-ES"] {
            if let voz = AVSpeechSynthesisVoice(language: idioma) { return voz }
        }
        return nil
    }

    /// Ruta de salida de ahora. Solo lee: no cambia la categoría ni activa nada.
    nonisolated static func rutaActual() -> RutaAudio {
        RutaAudio.clasificar(AVAudioSession.sharedInstance().currentRoute.outputs.map { tipo($0.portType) })
    }

    nonisolated private static func tipo(_ puerto: AVAudioSession.Port) -> TipoSalida {
        switch puerto {
        case .headphones: return .auricularCableado
        case .bluetoothA2DP, .bluetoothHFP, .bluetoothLE: return .bluetooth
        case .builtInSpeaker: return .altavozIntegrado
        case .builtInReceiver: return .receptor
        default: return .otra
        }
    }
}

// MARK: Captura para el dictado (EA-19)

extension SintetizadorSistema {
    /// Sesión de audio del dictado. Sigue siendo esta clase la dueña de `AVAudioSession`: el reconocedor no la toca.
    /// `.playAndRecord` y no `.record`: con `.record` la sesión no tiene salidas, `rutaActual` daría «desconocida» y
    /// `ControlVoz` callaría los avisos del accesorio mientras se dicta. Quien llama (`DictadoModelo.arrancar`) corta antes
    /// la respuesta hablada de la pantalla y no abre si suena un aviso: la captura no se abre con una locución sonando.
    /// `.allowBluetooth` deja usar el micrófono de unos auriculares Bluetooth (perfil de manos libres).
    static func abrirCaptura() throws {
        let sesion = AVAudioSession.sharedInstance()
        try sesion.setCategory(.playAndRecord, mode: .default, options: [.allowBluetooth, .duckOthers])
        try sesion.setActive(true)
        capturaAbierta = true
    }

    /// Suelta el micrófono y deja la sesión como la espera la voz (`.playback`, sin activar): la próxima locución y la
    /// consulta de la ruta no se encuentran con la categoría del dictado.
    static func cerrarCaptura() {
        capturaAbierta = false
        liberar()
        try? configurar(AVAudioSession.sharedInstance())
    }
}

/// Traduce los avisos del sistema (cambio de ruta, interrupción, reinicio de los servicios de
/// medios) a la política de `ControlVoz`. Cualquier duda corta la voz: nunca se reanuda sola.
/// Vive tanto como la app (lo guarda `EntornoApp`), por eso no quita los observadores.
@MainActor
final class MonitorAudioSistema {
    private var observadores: [NSObjectProtocol] = []  // se conservan mientras viva el monitor

    init(control: ControlVoz) {
        let centro = NotificationCenter.default
        observadores.append(centro.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { nota in
            let motivo = (nota.userInfo?[AVAudioSessionRouteChangeReasonKey] as? UInt)
                .flatMap(AVAudioSession.RouteChangeReason.init(rawValue:))
            // El cambio de categoría lo provoca la propia configuración de la app; la ruta se vuelve a
            // comprobar al empezar cada locución y tras activar la sesión. Cortar aquí podría enredarse con ella.
            guard motivo != .categoryChange else { return }
            Task { @MainActor in control.rutaCambio() }
        })
        observadores.append(centro.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { nota in
            let tipo = (nota.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt)
                .flatMap(AVAudioSession.InterruptionType.init(rawValue:))
            // Sin tipo legible se trata como el comienzo de una interrupción.
            Task { @MainActor in control.interrupcion(comenzo: tipo != .ended) }
        })
        observadores.append(centro.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: .main) { _ in
            Task { @MainActor in control.rutaCambio() }
        })
    }
}

extension AvisosAccesibles {
    /// Avisos reales: anuncio de accesibilidad (no mueve el foco) y háptica de advertencia.
    /// Lo urgente usa la prioridad alta pública de UIKit (iOS 17+): un `NSAttributedString` con
    /// `accessibilitySpeechAnnouncementPriority`, según la documentación de `UIAccessibilityPriority`.
    @MainActor static var sistema: AvisosAccesibles {
        AvisosAccesibles(
            anunciar: { texto, prioridad in
                switch prioridad {
                case .rutina:
                    UIAccessibility.post(notification: .announcement, argument: texto)
                case .urgente:
                    let urgente = NSAttributedString(
                        string: texto,
                        attributes: [.accessibilitySpeechAnnouncementPriority: UIAccessibilityPriority.high])
                    UIAccessibility.post(notification: .announcement, argument: urgente)
                }
            },
            vibrar: { UINotificationFeedbackGenerator().notificationOccurred(.warning) },
            voiceOverActivo: { UIAccessibility.isVoiceOverRunning })
    }
}
