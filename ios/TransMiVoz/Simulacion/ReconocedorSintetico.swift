#if DEBUG
import Foundation

/// Reconocedor SINTÉTICO, solo en compilaciones de depuración y solo para las pruebas de interfaz
/// (`-PRUEBAS_UI_DICTADO_SINTETICO`). Permite recorrer la MISMA pantalla y el MISMO modelo del dictado en el Simulator,
/// sin micrófono, sin sesión de audio y sin reconocimiento real. Al terminar cada dictado «oye» la frase siguiente de un
/// guion fijo; no reconoce nada de lo que suene. La pantalla lo rotula. No prueba el micrófono, el reconocimiento del
/// español, la privacidad del servicio ni el audio con auriculares.
@MainActor
final class ReconocedorSintetico: ReconocedorVoz {
    enum Permiso {
        /// Aún no preguntado; al pedirlo el «sistema» concede.
        case porPreguntar
        /// Aún no preguntado; al pedirlo el «sistema» deniega.
        case porPreguntarYDenegar
        /// Ya concedido: el primer toque empieza a dictar.
        case concedido
    }

    /// Lo que «oye» cada dictado, en orden, si la prueba no fija otro guion: un origen sin destino y, después, el destino
    /// que lo completa. Al acabar vuelve a empezar.
    static let guionPorDefecto = ["salgo desde Ricaurte", "Calle 72"]

    var receptor: (@MainActor (EventoDictado, Int) -> Void)?
    private(set) var permiso: PermisoVoz
    /// Declara el servicio de Apple, la capacidad más cautelosa; la pantalla aclara que es una simulación.
    let capacidad = CapacidadReconocimiento.remoto(idioma: "es-CO")
    var rotuloPruebas: String? { "Modo de pruebas: dictado sintético, sin micrófono real." }

    private let denegar: Bool
    private let guion: [String]
    private var token = tokenSinCaptura
    private var dictados = 0

    init(permiso: Permiso, guion: [String] = ReconocedorSintetico.guionPorDefecto) {
        self.permiso = permiso == .concedido ? .concedido : .porPreguntar
        denegar = permiso == .porPreguntarYDenegar
        self.guion = guion.isEmpty ? Self.guionPorDefecto : guion
    }

    func pedirPermisos() {
        Task { @MainActor [weak self] in
            guard let self else { return }
            permiso = denegar ? .denegado : .concedido
            receptor?(.permisosRespondidos, tokenSinCaptura)
        }
    }

    /// Como el reconocedor real, responde después y no en la propia llamada.
    func iniciar(token nuevo: Int) {
        token = nuevo
        Task { @MainActor [weak self] in
            guard let self, token == nuevo else { return }
            receptor?(.escuchando, nuevo)
        }
    }

    func detener() {
        let vigente = token
        let frase = guion[dictados % guion.count]
        dictados += 1
        Task { @MainActor [weak self] in
            guard let self, token == vigente, vigente != tokenSinCaptura else { return }
            token = tokenSinCaptura
            receptor?(.terminado(frase), vigente)
        }
    }

    func cancelar() {
        token = tokenSinCaptura
    }
}
#endif
