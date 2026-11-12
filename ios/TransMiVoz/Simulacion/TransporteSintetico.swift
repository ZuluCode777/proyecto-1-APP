#if DEBUG
import ContratoBLE
import Foundation

/// Transporte SINTÉTICO, solo en compilaciones de depuración y solo para las pruebas de interfaz
/// (`-PRUEBAS_UI_ACCESORIO_SINTETICO`). Permite que la MISMA pantalla de producción (`SesionAccesorioVista`)
/// y la MISMA sesión (`SesionAccesorioModelo`) se recorran de forma determinista en el Simulator: sin
/// Bluetooth, radio, audio ni red.
///
/// Honestidad: la pantalla lo rotula («Modo de pruebas: transporte sintético») y este transporte afirma SIEMPRE
/// `.desconocido` (el de producción afirma `.cifradoSinAutenticar` tras la lectura protegida de comprobación), así
/// que la sesión se bloquea por enlace no verificado. No ofrece ningún camino que entregue medidas ni lecturas: solo
/// hallazgo de un accesorio de mentira, conexión y los estados de permiso.
@MainActor
final class TransporteSintetico: TransporteAccesorio {
    enum Permiso {
        /// Aún no preguntado; al primer uso el «sistema» concede.
        case porPreguntar
        /// Aún no preguntado; al primer uso el «sistema» deniega.
        case porPreguntarYDenegar
        /// Ya concedido: no hay explicación previa.
        case concedido
    }

    static let accesorio = AccesorioDetectado(id: "SINTETICO-0001", nombre: "Accesorio sintético")

    var receptor: (@MainActor (EventoTransporte, Int) -> Void)?
    var nivelEnlace: NivelEnlace { .desconocido }
    private(set) var permisoPorPreguntar: Bool
    private let denegar: Bool
    private var disponibilidad: DisponibilidadBluetooth = .desconocida
    private var gestorCreado = false

    init(permiso: Permiso) {
        permisoPorPreguntar = permiso != .concedido
        denegar = permiso == .porPreguntarYDenegar
    }

    func buscar() {
        despertar()
        guard disponibilidad == .disponible else { return }
        despues { $0.receptor?(.encontrado(Self.accesorio), tokenSinConexion) }
    }

    func dejarDeBuscar() {}

    func conectar(id: String, token: Int) {
        despertar()
        guard disponibilidad == .disponible else { return }
        despues { $0.receptor?(.conectado(id: id), token) }
    }

    /// Sin accesorio no hay nada que proteger: la «lectura» termina al instante para que la sesión llegue a su bloqueo
    /// de siempre. No afirma nada: `nivelEnlace` sigue siendo `.desconocido`, y la política la rechaza (contrato §6).
    func comprobarEnlace(token: Int) {
        despues { $0.receptor?(.lecturaProtegidaSuperada, token) }
    }

    func leerInformacion(token: Int) {}
    func fijarNotificaciones(_ activas: Bool, token: Int) {}
    func leerMedicion(token: Int) {}
    func desconectar() {}

    /// Como el gestor real: el primer uso lo crea (con el aviso de permiso si faltaba) y el estado llega después.
    private func despertar() {
        guard !gestorCreado else { return }
        gestorCreado = true
        permisoPorPreguntar = false
        disponibilidad = denegar ? .sinPermiso : .disponible
        let resultado = disponibilidad
        despues { $0.receptor?(.disponibilidad(resultado), tokenSinConexion) }
    }

    /// Un salto al siguiente turno del hilo principal, como un callback real. No espera tiempo.
    private func despues(_ accion: @escaping @MainActor (TransporteSintetico) -> Void) {
        Task { @MainActor [weak self] in
            if let self { accion(self) }
        }
    }
}

/// Voz de mentira de las pruebas de interfaz: no toca `AVAudioSession` ni sintetiza. Con ruta no privada
/// (`ControlVoz` no llega a pedirle hablar) la pantalla muestra «sin auriculares».
@MainActor
final class SalidaVozSintetica: SalidaVoz {
    var hablando: Bool { false }
    func hablar(_ texto: String) -> ResultadoHabla { .rutaNoPrivada }
    func detener() {}
}
#endif
