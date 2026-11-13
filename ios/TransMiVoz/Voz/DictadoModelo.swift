import Foundation
import Observation

/// Estado del dictado que ve la persona.
enum EstadoDictado: Equatable, CaseIterable {
    case inactivo
    /// Los avisos de permiso del sistema están en pantalla.
    case pidiendoPermisos
    /// Se pidió la captura y el micrófono aún no responde.
    case iniciando
    case escuchando
    /// La persona terminó de hablar; falta el texto final.
    case finalizando
    case permisoDenegado
    case permisoRestringido
    /// No hay reconocedor de español disponible ahora.
    case noDisponible
    /// La captura terminó sin entender nada (ruido, silencio).
    case sinTexto
    /// El servicio o el audio fallaron.
    case fallo

    /// Hay una captura pedida y no soltada.
    var capturando: Bool { self == .iniciando || self == .escuchando || self == .finalizando }
    /// El botón del dictado ofrece detenerlo: hay captura, o se espera a la persona en los avisos de permiso.
    var enCurso: Bool { capturando || self == .pidiendoPermisos }
}

/// Dictado de la pregunta: `SFSpeechRecognizer` detrás de `ReconocedorVoz`. Solo escribe texto en el campo de la
/// consulta (`alTexto`); la persona lo revisa y pulsa «Enviar». El texto escrito a mano es siempre la alternativa: ningún
/// estado del dictado bloquea el campo.
///
/// - Permisos: se piden al tocar «Dictar pregunta», no antes. Negados o restringidos, el dictado lo dice y no hace nada más.
/// - Capacidad: se consulta al sistema al mostrar la pantalla y al empezar (`ReconocedorVoz.capacidad`); la pantalla dice
///   si el audio se reconoce en el iPhone o se envía a Apple, y en qué español.
/// - Audio: antes de capturar se corta la voz (`ControlVoz.descartarTodo`), y si una locución va a empezar con la captura
///   abierta, el dictado se cancela (`ControlVoz.alHablar`): nada suena sobre un micrófono abierto, y un aviso del accesorio
///   no espera a que la persona termine de hablar. La sesión de audio es de `SintetizadorSistema`.
/// - Cada captura lleva un token; lo que llegue de una captura cancelada se descarta.
@MainActor
@Observable
final class DictadoModelo {
    private(set) var estado: EstadoDictado = .inactivo
    private(set) var capacidad: CapacidadReconocimiento
    /// Último texto que el dictado entregó completo. La consulta lo compara con lo que se envía: solo una pregunta
    /// dictada y sin cambios se contesta también en voz alta.
    private(set) var ultimoDictado: String?

    /// Texto reconocido (parcial o final) para el campo de la consulta.
    @ObservationIgnored var alTexto: (@MainActor (String) -> Void)?

    @ObservationIgnored private let reconocedor: ReconocedorVoz
    @ObservationIgnored private let voz: ControlVoz?
    @ObservationIgnored private let avisos: AvisosAccesibles
    @ObservationIgnored private var token = 0
    @ObservationIgnored private var ultimoEstado: EstadoDictado = .inactivo

    init(reconocedor: ReconocedorVoz, voz: ControlVoz? = nil, avisos: AvisosAccesibles = AvisosAccesibles()) {
        self.reconocedor = reconocedor
        self.voz = voz
        self.avisos = avisos
        capacidad = reconocedor.capacidad
        reconocedor.receptor = { [weak self] evento, token in self?.recibir(evento, token: token) }
        voz?.alHablar = { [weak self] in self?.vozVaAHablar() }
    }

    var capturando: Bool { estado.capturando }
    /// Rótulo de un reconocedor de pruebas; `nil` con el real.
    var rotuloPruebas: String? { reconocedor.rotuloPruebas }

    /// La pantalla se muestra: la capacidad se vuelve a preguntar al sistema (puede haber cambiado) si no hay captura.
    func actualizarCapacidad() {
        guard !capturando else { return }
        capacidad = reconocedor.capacidad
    }

    // MARK: Acciones de la persona

    /// El botón del dictado: empieza, termina o cancela según el estado.
    func alternar() {
        switch estado {
        case .escuchando: terminar()
        case .pidiendoPermisos, .iniciando, .finalizando: cancelar()
        default: empezar()
        }
    }

    /// Invalida la captura y los permisos pendientes: nada de lo que llegue después se entrega. Lo que ya está en el
    /// campo de la consulta se queda ahí, como texto escrito.
    func cancelar() {
        token += 1
        reconocedor.cancelar()
        cambiar(a: .inactivo)
    }

    // MARK: Internos

    private func empezar() {
        ultimoEstado = .inactivo  // cada intento vuelve a anunciar su resultado, también un permiso que sigue negado
        // Antes de abrir el micrófono se corta lo que suene (una respuesta hablada, un aviso): no se realimentan.
        voz?.descartarTodo()
        switch reconocedor.permiso {
        case .denegado: cambiar(a: .permisoDenegado)
        case .restringido: cambiar(a: .permisoRestringido)
        case .porPreguntar:
            cambiar(a: .pidiendoPermisos)
            reconocedor.pedirPermisos()
        case .concedido: arrancar()
        }
    }

    private func arrancar() {
        capacidad = reconocedor.capacidad
        guard capacidad != .noDisponible else { cambiar(a: .noDisponible); return }
        token += 1
        cambiar(a: .iniciando)
        reconocedor.iniciar(token: token)
    }

    /// «Detener dictado»: se cierra el micrófono y se espera el texto final.
    private func terminar() {
        cambiar(a: .finalizando)
        reconocedor.detener()
    }

    private func recibir(_ evento: EventoDictado, token tokenEvento: Int) {
        if evento == .permisosRespondidos {
            guard estado == .pidiendoPermisos else { return }  // la persona canceló mientras tanto
            switch reconocedor.permiso {
            case .concedido: arrancar()
            case .denegado, .porPreguntar: cambiar(a: .permisoDenegado)
            case .restringido: cambiar(a: .permisoRestringido)
            }
            return
        }
        guard capturando, tokenEvento == token else { return }
        switch evento {
        case .permisosRespondidos:
            break
        case .escuchando:
            if estado == .iniciando { cambiar(a: .escuchando) }
        case .parcial(let texto):
            alTexto?(texto)
        case .terminado(let texto):
            let limpio = texto.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !limpio.isEmpty else { cambiar(a: .sinTexto); return }
            ultimoDictado = limpio
            alTexto?(limpio)
            cambiar(a: .inactivo)
            avisos.anunciar(TextoDictado.dictadoTerminado(limpio), .rutina)
        case .fallo:
            reconocedor.cancelar()
            cambiar(a: .fallo)
        }
    }

    /// Una locución va a empezar (la respuesta hablada o un aviso del accesorio): el micrófono se suelta antes.
    private func vozVaAHablar() {
        guard capturando else { return }
        cancelar()
        avisos.anunciar(TextoDictado.dictadoCortadoPorVoz, .urgente)
    }

    private func cambiar(a nuevo: EstadoDictado) {
        estado = nuevo
        guard nuevo != ultimoEstado else { return }
        ultimoEstado = nuevo
        // Con el micrófono abierto no se habla: VoiceOver sonaría sobre la captura y entraría como texto. Al empezar a
        // escuchar solo vibra; el resto de estados se anuncia con el micrófono ya cerrado.
        if nuevo == .escuchando { avisos.vibrar() }
        if let texto = TextoDictado.anuncio(nuevo) { avisos.anunciar(texto, nuevo.esProblema ? .urgente : .rutina) }
    }
}

extension EstadoDictado {
    /// El dictado no pudo seguir: se avisa con prioridad y el foco va al mensaje.
    var esProblema: Bool {
        switch self {
        case .permisoDenegado, .permisoRestringido, .noDisponible, .sinTexto, .fallo: return true
        default: return false
        }
    }
}
