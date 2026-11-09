import Foundation
import Observation

/// Tipo de salida de audio, ya traducido del sistema (`AVAudioSession.Port`).
enum TipoSalida: Equatable {
    case auricularCableado
    case bluetooth
    case altavozIntegrado
    case receptor
    case otra
}

/// Si el audio saldría por un sitio que escucha solo la persona.
enum RutaAudio: Equatable {
    case privada
    case noPrivada
    /// Sin dato: se trata como no privada.
    case desconocida

    /// Privada solo si TODAS las salidas son auriculares con cable o Bluetooth.
    /// Un altavoz Bluetooth se ve igual que unos auriculares Bluetooth: el
    /// sistema no los distingue (límite documentado en ea-15-ios-ble-audio.md).
    static func clasificar(_ salidas: [TipoSalida]) -> RutaAudio {
        guard !salidas.isEmpty else { return .desconocida }
        return salidas.allSatisfy { $0 == .auricularCableado || $0 == .bluetooth } ? .privada : .noPrivada
    }
}

/// Voz del iPhone (AVSpeechSynthesizer). La implementa `SintetizadorSistema`.
@MainActor
protocol SalidaVoz: AnyObject {
    func hablar(_ texto: String)
    /// Corta lo que suene y descarta lo pendiente.
    func detener()
}

enum MotivoSilencio: Equatable {
    case rutaNoPrivada
    case interrumpido
}

/// Política de audio. El iPhone es el dueño de la voz y de la ruta; el accesorio
/// solo manda datos. Reglas:
/// - la cola es de UNO: cada locución corta la anterior, nada se acumula;
/// - se habla solo si la ruta es privada AHORA (se consulta en cada locución) y no hay
///   interrupción (llamada, Siri...);
/// - cambio de ruta, pérdida de auriculares o interrupción cortan y descartan lo que suene;
/// - nada se reproduce después: al recuperar el audio solo se avisa a la sesión
///   (`alRecuperarse`) para que diga el estado ACTUAL, no el que quedó pendiente.
@MainActor
@Observable
final class ControlVoz {
    enum Resultado: Equatable {
        case hablado
        case silenciado(MotivoSilencio)
    }

    private(set) var ruta: RutaAudio = .desconocida
    private(set) var interrumpido = false
    /// Se llama cuando vuelve a ser posible hablar (auriculares de nuevo o fin de la interrupción).
    @ObservationIgnored var alRecuperarse: (@MainActor () -> Void)?

    @ObservationIgnored private let salida: SalidaVoz
    @ObservationIgnored private let consultarRuta: () -> RutaAudio

    init(salida: SalidaVoz, consultarRuta: @escaping () -> RutaAudio) {
        self.salida = salida
        self.consultarRuta = consultarRuta
        ruta = consultarRuta()
    }

    @discardableResult
    func anunciar(_ texto: String) -> Resultado {
        ruta = consultarRuta()
        salida.detener()
        if interrumpido { return .silenciado(.interrumpido) }
        guard ruta == .privada else { return .silenciado(.rutaNoPrivada) }
        salida.hablar(texto)
        return .hablado
    }

    func descartarTodo() {
        salida.detener()
    }

    /// El sistema avisó de un cambio de ruta (auriculares conectados o perdidos, otro destino).
    func rutaCambio() {
        let antes = ruta
        salida.detener()
        ruta = consultarRuta()
        if ruta == .privada && antes != .privada && !interrumpido { alRecuperarse?() }
    }

    func interrupcion(comenzo: Bool) {
        salida.detener()
        interrumpido = comenzo
        if !comenzo { ruta = consultarRuta(); if ruta == .privada { alRecuperarse?() } }
    }
}
