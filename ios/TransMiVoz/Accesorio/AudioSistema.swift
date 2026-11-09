import AVFoundation
import Foundation

/// Voz y sesión de audio del iPhone. El iPhone es el dueño de `AVSpeechSynthesizer`, de
/// `AVAudioSession` y de la ruta; el accesorio solo manda datos.
///
/// La política (quién puede hablar y cuándo) vive en `ControlVoz`. Aquí solo se habla:
/// - se activa la sesión justo antes de hablar y se libera al terminar o al cortar;
/// - si la sesión de audio no se deja configurar o activar, NO se habla (falla cerrado);
/// - una locución cancelada o reemplazada nunca activa ni libera la sesión de la siguiente.
@MainActor
final class SintetizadorSistema: NSObject, SalidaVoz, AVSpeechSynthesizerDelegate {
    private let sintetizador = AVSpeechSynthesizer()
    private var actual: AVSpeechUtterance?

    override init() {
        super.init()
        sintetizador.delegate = self
    }

    func hablar(_ texto: String) {
        let sesion = AVAudioSession.sharedInstance()
        do {
            try Self.configurar(sesion)
            try sesion.setActive(true)
        } catch {
            return
        }
        let locucion = AVSpeechUtterance(string: texto)
        locucion.voice = Self.vozEnEspanol()
        locucion.prefersAssistiveTechnologySettings = true
        actual = locucion
        sintetizador.speak(locucion)
    }

    func detener() {
        let habiaVoz = actual != nil
        actual = nil
        sintetizador.stopSpeaking(at: .immediate)
        if habiaVoz { Self.liberar() }
    }

    nonisolated func speechSynthesizer(_ sintetizador: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in self.terminar(utterance) }
    }

    nonisolated func speechSynthesizer(_ sintetizador: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        Task { @MainActor in self.terminar(utterance) }
    }

    private func terminar(_ locucion: AVSpeechUtterance) {
        // Una locución vieja (ya reemplazada o cortada) no toca la sesión de la vigente.
        guard locucion === actual else { return }
        actual = nil
        Self.liberar()
    }

    // MARK: Sesión de audio y ruta

    /// `.playback` con modo de avisos de voz: baja el volumen de lo demás mientras habla.
    nonisolated private static func configurar(_ sesion: AVAudioSession) throws {
        try sesion.setCategory(.playback, mode: .voicePrompt, options: [.duckOthers])
    }

    nonisolated private static func liberar() {
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    nonisolated private static func vozEnEspanol() -> AVSpeechSynthesisVoice? {
        for idioma in ["es-CO", "es-MX", "es-ES"] {
            if let voz = AVSpeechSynthesisVoice(language: idioma) { return voz }
        }
        return nil
    }

    /// Ruta de salida de ahora. Se consulta en cada locución, no se guarda.
    nonisolated static func rutaActual() -> RutaAudio {
        let sesion = AVAudioSession.sharedInstance()
        // Con la categoría de reproducción puesta, la ruta es la que se usaría para hablar.
        try? configurar(sesion)
        return RutaAudio.clasificar(sesion.currentRoute.outputs.map { tipo($0.portType) })
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

/// Traduce los avisos del sistema (cambio de ruta, interrupción, reinicio de los servicios de
/// medios) a la política de `ControlVoz`. Cualquier duda corta la voz: nunca se reanuda sola.
/// Vive tanto como la app (lo guarda `EntornoApp`), por eso no quita los observadores.
@MainActor
final class MonitorAudioSistema {
    private var observadores: [NSObjectProtocol] = []  // se conservan mientras viva el monitor

    init(control: ControlVoz) {
        let centro = NotificationCenter.default
        observadores.append(centro.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { _ in
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
