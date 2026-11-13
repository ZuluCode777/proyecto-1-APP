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
    /// Auriculares USB-C, AirPlay y coche cuentan como no privados.
    static func clasificar(_ salidas: [TipoSalida]) -> RutaAudio {
        guard !salidas.isEmpty else { return .desconocida }
        return salidas.allSatisfy { $0 == .auricularCableado || $0 == .bluetooth } ? .privada : .noPrivada
    }
}

/// Qué pasó al intentar hablar.
enum ResultadoHabla: Equatable {
    case iniciada
    /// El sistema no dejó configurar o activar la sesión de audio. No se habló.
    case sesionNoDisponible
    /// Al activar la sesión la ruta ya no era privada. No se habló.
    case rutaNoPrivada
}

/// Voz del iPhone (AVSpeechSynthesizer). La implementa `SintetizadorSistema`.
@MainActor
protocol SalidaVoz: AnyObject {
    /// Hay una locución sonando o por sonar.
    var hablando: Bool { get }
    func hablar(_ texto: String) -> ResultadoHabla
    /// Corta lo que suene y descarta lo pendiente.
    func detener()
    /// El sistema cortó la última locución sin que la app lo pidiera (Siri, una alarma: `didCancel` sin `detener`).
    var cortadaPorElSistema: Bool { get }
}

extension SalidaVoz {
    /// Las salidas que no pueden saberlo (la sintética) no la cortan nunca.
    var cortadaPorElSistema: Bool { false }
}

enum MotivoSilencio: Equatable {
    case rutaNoPrivada
    case interrumpido
    /// La sesión de audio no se pudo activar (llamada en curso, otra app, error del sistema).
    case audioNoDisponible
    /// La persona apagó la voz de la app, o VoiceOver está activo y no la encendió.
    case vozApagada
}

/// Quién es dueño de la locución vigente. Sin AVFoundation, para poder probarlo.
///
/// `AVSpeechSynthesizer` avisa del final de cada locución (`didFinish`/`didCancel`) más tarde y en otro
/// orden que las llamadas de la app. Por eso la sesión de audio se libera solo cuando termina la última
/// locución viva: al cancelar, el aviso de la cancelada libera si no hay otra más nueva; nunca libera
/// cuando suena una más nueva.
struct TurnoLocucion<ID: Hashable> {
    private(set) var actual: ID?
    private var cancelandose: ID?

    var hablando: Bool { actual != nil }

    mutating func empezar(_ id: ID) { actual = id }

    /// `sistemaCancelo`: el sistema aceptó cortar y avisará con `didCancel`. Devuelve verdadero si la
    /// sesión de audio se debe liberar YA (no habrá aviso que lo haga).
    mutating func detener(sistemaCancelo: Bool) -> Bool {
        guard let anterior = actual else { return false }
        actual = nil
        if sistemaCancelo {
            cancelandose = anterior
            return false
        }
        return true
    }

    /// `didFinish` o `didCancel` de `id`. Devuelve verdadero si se debe liberar la sesión de audio.
    mutating func terminar(_ id: ID) -> Bool {
        if id == actual {
            actual = nil
            return true
        }
        if id == cancelandose {
            cancelandose = nil
            return actual == nil
        }
        return false
    }
}

/// Política de audio. El iPhone es el dueño de la voz y de la ruta; el accesorio
/// solo manda datos. Reglas:
/// - la cola es de UNO: cada locución corta la anterior, nada se acumula;
/// - se habla solo si la voz de la app está permitida, la ruta es privada AHORA (se consulta en cada
///   locución y otra vez tras activar la sesión de audio) y no hay interrupción (llamada, Siri...);
/// - si el sistema no deja activar la sesión de audio, NO se habla y queda `audioNoDisponible`;
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
    /// El sistema rechazó la última activación de la sesión de audio.
    private(set) var audioNoDisponible = false
    /// La app cortó la última locución empezada antes de terminar (la siguiente, un cambio de ruta, una interrupción o
    /// un descarte). Se limpia al empezar otra locución. Los cortes del sistema que la app no pidió constan en
    /// `salida.cortadaPorElSistema`.
    @ObservationIgnored private(set) var ultimaLocucionCortada = false
    /// La última locución empezada sonó entera: nadie la cortó (ni la app ni el sistema) y ya no suena. La sesión lo usa
    /// para saber si una frase que debe oírse entera, como la reserva de un enlace sin autenticar, se oyó de verdad. Se
    /// pregunta ANTES de empezar otra locución, que la cortaría. Ventana conocida: `SintetizadorSistema` anota el fin
    /// (`didFinish`) de forma asíncrona, así que una locución que acaba de terminar puede seguir contando como «sonando» y
    /// la reserva se repite una vez de más; la sesión limita las repeticiones (`maximoReservas`) y no es peor que callar.
    var ultimaSeOyoEntera: Bool { !ultimaLocucionCortada && !salida.hablando && !salida.cortadaPorElSistema }
    /// Cuántas locuciones empezaron. Quien habla por esta vía (la consulta) lo anota para cortar solo la suya: si después
    /// habló otro (un aviso del accesorio), la suya ya la cortó la cola de uno y no hay nada que cortar.
    @ObservationIgnored private(set) var locuciones = 0
    /// Se llama justo antes de que empiece una locución. El dictado suelta el micrófono aquí: nada suena sobre una captura
    /// abierta, y un aviso no espera a que la persona termine de dictar.
    @ObservationIgnored var alHablar: (@MainActor () -> Void)?
    /// Se llama cuando vuelve a ser posible hablar (auriculares de nuevo, fin de la interrupción, o un
    /// corte con la ruta privada intacta que dejó una locución a medias).
    @ObservationIgnored var alRecuperarse: (@MainActor () -> Void)?
    /// Se llama cuando se pierde una ruta que era privada (para el aviso accesible y la háptica).
    @ObservationIgnored var alPerderRuta: (@MainActor () -> Void)?
    /// Hay una locución sonando o por sonar, de quien sea. Solo lectura: quien no es dueño de la que suena (la consulta ante
    /// un aviso del accesorio) la compara con `locuciones` y no la corta. La prioridad de los avisos físicos sobre la lectura
    /// de transporte está en arquitectura-y-experimentos.md, «Política de voz».
    var hablando: Bool { salida.hablando }
    /// Si la voz propia está permitida (la sesión la fija: depende de VoiceOver y de la elección de la persona).
    @ObservationIgnored var permitida: @MainActor () -> Bool = { true }

    @ObservationIgnored private let salida: SalidaVoz
    @ObservationIgnored private let consultarRuta: () -> RutaAudio

    init(salida: SalidaVoz, consultarRuta: @escaping () -> RutaAudio) {
        self.salida = salida
        self.consultarRuta = consultarRuta
        ruta = consultarRuta()
    }

    /// Corta lo que suene y anota si algo quedó a medias.
    private func cortar() {
        if salida.hablando { ultimaLocucionCortada = true }
        salida.detener()
    }

    @discardableResult
    func anunciar(_ texto: String) -> Resultado {
        ruta = consultarRuta()
        cortar()
        if interrumpido { return .silenciado(.interrumpido) }
        guard permitida() else { return .silenciado(.vozApagada) }
        guard ruta == .privada else { return .silenciado(.rutaNoPrivada) }
        alHablar?()
        switch salida.hablar(texto) {
        case .iniciada:
            audioNoDisponible = false
            ultimaLocucionCortada = false
            locuciones += 1
            return .hablado
        case .sesionNoDisponible:
            audioNoDisponible = true
            return .silenciado(.audioNoDisponible)
        case .rutaNoPrivada:
            audioNoDisponible = false
            ruta = consultarRuta()
            return .silenciado(.rutaNoPrivada)
        }
    }

    func descartarTodo() {
        cortar()
    }

    /// El sistema avisó de un cambio de ruta (auriculares conectados o perdidos, otro destino).
    func rutaCambio() {
        let antes = ruta
        let cortada = salida.hablando
        cortar()
        audioNoDisponible = false
        ruta = consultarRuta()
        if antes == .privada && ruta != .privada { alPerderRuta?() }
        guard ruta == .privada, !interrumpido else { return }
        // Con la ruta privada intacta (otros auriculares, cambio de configuración) el corte dejó la
        // locución a medias: se dice el estado de ahora. Sin nada sonando no hay nada que repetir.
        if antes != .privada || cortada { alRecuperarse?() }
    }

    func interrupcion(comenzo: Bool) {
        cortar()
        interrumpido = comenzo
        if !comenzo {
            audioNoDisponible = false
            ruta = consultarRuta()
            if ruta == .privada { alRecuperarse?() }
        }
    }

    /// La escena volvió a primer plano. iOS no siempre entrega el fin de una interrupción (llamada o
    /// segundo plano en medio), así que la bandera no se cree: se limpia y se vuelve a mirar la ruta.
    /// Si la interrupción sigue, la activación de la sesión de audio falla al hablar y queda
    /// `audioNoDisponible` (se falla cerrado). No avisa a la sesión: la propia vuelta a primer plano
    /// ya dice el estado de ahora.
    func escenaVolvio() {
        interrumpido = false
        audioNoDisponible = false
        ruta = consultarRuta()
    }
}
