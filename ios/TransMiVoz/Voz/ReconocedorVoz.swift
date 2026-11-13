import Foundation

/// Permisos del dictado, ya traducidos del sistema. Son dos avisos distintos (reconocimiento de voz y micrófono); aquí
/// se resumen en el peor de los dos.
enum PermisoVoz: Equatable, Sendable {
    /// Al menos uno de los dos no se ha preguntado y ninguno está negado.
    case porPreguntar
    case concedido
    case denegado
    case restringido
}

/// Lo que el iPhone declara poder hacer con el español, consultado al sistema (`SFSpeechRecognizer`) y no supuesto.
/// Que lo declare no prueba que el reconocimiento sea bueno con acento colombiano: eso es prueba en dispositivo.
enum CapacidadReconocimiento: Equatable, Sendable {
    /// El sistema declara reconocimiento sin red (`supportsOnDeviceRecognition`): el audio no sale del iPhone.
    case local(idioma: String)
    /// El idioma existe pero el reconocimiento va al servicio de Apple: el audio sale del iPhone.
    case remoto(idioma: String)
    /// Sin reconocedor para el español, o el sistema lo declara no disponible ahora (sin red en uno remoto, restricción).
    case noDisponible
}

/// Por qué falló una captura que ya estaba en marcha o no pudo arrancar.
enum MotivoFalloDictado: Equatable, Sendable {
    /// El reconocedor no está disponible o el servicio cortó el reconocimiento.
    case sinServicio
    /// La sesión de audio o el micrófono no se pudieron abrir.
    case audio
}

/// Lo que el reconocedor le cuenta al dictado.
enum EventoDictado: Equatable, Sendable {
    /// La persona respondió a los avisos de permiso del sistema. La respuesta se lee de `permiso`.
    case permisosRespondidos
    /// La captura arrancó.
    case escuchando
    /// Texto reconocido hasta ahora; sustituye al parcial anterior.
    case parcial(String)
    /// La captura terminó. Vacío si no se entendió nada (ruido, silencio).
    case terminado(String)
    case fallo(MotivoFalloDictado)
}

/// Frontera con el reconocimiento de voz (`SFSpeechRecognizer` + `AVAudioEngine`). Todas las llamadas y todos los
/// eventos ocurren en el hilo principal.
///
/// - Cada evento de una captura lleva el `token` con el que el dictado la pidió; el dictado descarta los de cualquier otro
///   (un resultado tardío de una captura que la persona ya canceló).
/// - La sesión de audio NO se configura aquí: la abre y la cierra `SintetizadorSistema` (`abrirCaptura` y `cerrarCaptura`),
///   el único dueño de `AVAudioSession`.
/// - `detener` cierra el micrófono y deja que llegue el texto final; `cancelar` lo descarta todo y no entrega nada más.
@MainActor
protocol ReconocedorVoz: AnyObject {
    var receptor: (@MainActor (EventoDictado, Int) -> Void)? { get set }
    /// Consultarlo no provoca los avisos de permiso del sistema.
    var permiso: PermisoVoz { get }
    /// Consulta de verdad al sistema, cada vez: la disponibilidad y el soporte local pueden cambiar.
    var capacidad: CapacidadReconocimiento { get }
    /// Provoca los avisos del sistema. Al responder la persona llega `permisosRespondidos` con `tokenSinCaptura`.
    func pedirPermisos()
    /// Abre la sesión de audio y el micrófono. Responde con `escuchando` o `fallo` y este `token`.
    func iniciar(token: Int)
    /// La persona terminó de hablar: cierra el micrófono y espera el texto final (`terminado`).
    func detener()
    /// Cierra micrófono y reconocimiento y suelta la sesión de audio. Nada de lo que llegue después se entrega.
    func cancelar()
    /// Solo el reconocedor sintético de las pruebas de interfaz lo rotula; el real no.
    var rotuloPruebas: String? { get }
}

extension ReconocedorVoz {
    var rotuloPruebas: String? { nil }
}
