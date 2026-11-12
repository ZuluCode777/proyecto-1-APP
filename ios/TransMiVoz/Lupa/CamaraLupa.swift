import QuartzCore

/// Permiso de cámara, ya traducido del sistema.
enum PermisoCamara: Equatable {
    /// El sistema todavía no ha preguntado a la persona.
    case porPreguntar
    case concedido
    case denegado
    case restringido
}

/// Lo que la cámara le cuenta a la lupa.
enum EventoCamara: Equatable, Sendable {
    /// La persona respondió al aviso de permiso del sistema. La respuesta se lee de `permiso`.
    case permisoRespondido
    /// La captura arrancó. Aumento que admite el dispositivo abierto.
    case lista(aumentoMinimo: Double, aumentoMaximo: Double)
    /// La cámara no se pudo abrir, o el sistema cortó una captura que estaba en marcha.
    case fallo
}

/// Token del evento que no pertenece a una captura (`permisoRespondido`).
let tokenSinCaptura = 0

/// Frontera con la cámara (AVFoundation). Todas las llamadas y todos los eventos ocurren en el hilo
/// principal; el trabajo de la sesión de captura va por dentro, fuera de él.
///
/// - Cada evento de una captura lleva el `token` con el que la lupa la pidió; la lupa descarta los de
///   cualquier otro token (una cámara que termina de abrir cuando la persona ya salió).
/// - `detener` cierra también una apertura en curso: al terminar no queda abierta la sesión ni el
///   dispositivo, y se olvidan la imagen y el congelado. El filtro y el aumento los vuelve a fijar la lupa.
/// - La imagen solo se pinta en `capa`: no se guarda ni se envía.
@MainActor
protocol CamaraLupa: AnyObject {
    var receptor: (@MainActor (EventoCamara, Int) -> Void)? { get set }
    /// Capa donde la cámara pinta la imagen ya filtrada. La pantalla solo la aloja.
    var capa: CALayer { get }
    /// Consultarlo no pide permiso ni abre nada. En el Simulator no hay cámara.
    var hayCamara: Bool { get }
    /// Consultarlo no provoca el aviso de permiso del sistema.
    var permiso: PermisoCamara { get }
    /// Provoca el aviso de permiso del sistema. Al responder la persona llega `permisoRespondido`.
    func pedirPermiso()
    /// Abre la cámara y arranca la captura. Responde con `lista` o `fallo` y este `token`.
    func iniciar(token: Int)
    func detener()
    func fijarAumento(_ factor: Double)
    func fijarFiltro(_ filtro: FiltroLupa)
    /// Con la imagen congelada se deja de pintar lo que llega; el aumento posterior amplía la imagen fija.
    func congelar(_ congelada: Bool)
}
