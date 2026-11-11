import Foundation

/// Core Bluetooth entrega la respuesta de una lectura y cada notificación por el
/// MISMO callback (`didUpdateValueFor`). Si una notificación emitida antes de
/// pedir la lectura se tomara por la respuesta, la referencia temporal quedaría
/// anclada demasiado atrás y la cota de antigüedad subestimaría la demora.
///
/// Por eso la lectura de referencia solo se pide con las notificaciones apagadas
/// y confirmadas, y este clasificador reparte cada valor:
/// - mientras hay lecturas pedidas, los valores son sus respuestas (llegan en orden);
///   solo la respuesta a la ÚLTIMA pedida cuenta, las anteriores son tardías;
/// - sin lecturas pendientes, un valor es notificación solo si están confirmadas.
struct ClasificadorValores {
    enum Clase: Equatable {
        case respuestaLectura
        case falloLectura
        case notificacion
        case descartar
    }

    private var pendientes: [Int] = []
    private var ultimaPedida = 0
    private(set) var notificando = false

    /// Falso (y no registra nada) si las notificaciones están activas: no habría
    /// manera de distinguir la respuesta.
    mutating func pedirLectura() -> Bool {
        guard !notificando else { return false }
        ultimaPedida += 1
        pendientes.append(ultimaPedida)
        return true
    }

    mutating func confirmarNotificaciones(_ activas: Bool) {
        notificando = activas
    }

    enum PasoNotificacion: Equatable {
        /// El sistema ya está en ese estado: no habrá aviso de cambio, se confirma aquí.
        case yaEstaba
        /// Hay que pedirlo al sistema y esperar su aviso.
        case pedir
    }

    /// `setNotifyValue` con el estado que la característica ya tiene (p. ej. apagar una suscripción que
    /// nunca se hizo) no tiene por qué producir `didUpdateNotificationStateFor`: la sesión esperaría un
    /// aviso que no llega y fallaría por tiempo. En ese caso se confirma localmente, con el estado que el
    /// propio sistema declara (`isNotifying`), nunca con el que la sesión supone.
    mutating func pedirNotificaciones(_ activas: Bool, activasEnSistema: Bool) -> PasoNotificacion {
        guard activas == activasEnSistema else { return .pedir }
        notificando = activas
        return .yaEstaba
    }

    mutating func recibirValor(conError: Bool) -> Clase {
        if !pendientes.isEmpty {
            let id = pendientes.removeFirst()
            guard id == ultimaPedida else { return .descartar }
            return conError ? .falloLectura : .respuestaLectura
        }
        return notificando && !conError ? .notificacion : .descartar
    }

    mutating func reiniciar() {
        self = ClasificadorValores()
    }
}
