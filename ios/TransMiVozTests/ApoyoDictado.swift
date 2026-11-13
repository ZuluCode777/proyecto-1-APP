import Foundation
import XCTest
@testable import TransMiVoz

/// Doble del reconocedor (simulado, no es `SFSpeechRecognizer`): anota las llamadas y deja que la prueba emita eventos con
/// cualquier token. No prueba el micrófono ni el reconocimiento del español.
@MainActor
final class ReconocedorFalso: ReconocedorVoz {
    var receptor: (@MainActor (EventoDictado, Int) -> Void)?
    var permiso: PermisoVoz
    var capacidad: CapacidadReconocimiento = .remoto(idioma: "es-CO")
    private(set) var llamadas: [String] = []
    private(set) var tokenVigente = 0
    /// Se ejecuta dentro de `iniciar`, antes de que "arranque" el micrófono: la prueba mira ahí qué más estaba pasando.
    var alIniciar: (@MainActor () -> Void)?

    init(permiso: PermisoVoz = .concedido) { self.permiso = permiso }

    func pedirPermisos() { llamadas.append("pedirPermisos") }
    func iniciar(token: Int) { llamadas.append("iniciar"); tokenVigente = token; alIniciar?() }
    func detener() { llamadas.append("detener") }
    func cancelar() { llamadas.append("cancelar") }

    func emitir(_ evento: EventoDictado, token: Int? = nil) { receptor?(evento, token ?? tokenVigente) }
    /// La persona respondió a los avisos del sistema con este permiso.
    func responderPermisos(_ nuevo: PermisoVoz) {
        permiso = nuevo
        receptor?(.permisosRespondidos, tokenSinCaptura)
    }
    func veces(_ llamada: String) -> Int { llamadas.filter { $0 == llamada }.count }
}

/// Lo que el dictado escribió en el campo de la consulta, en orden.
@MainActor
final class CampoFalso {
    private(set) var escrito: [String] = []
    func conectar(a dictado: DictadoModelo) { dictado.alTexto = { [self] texto in escrito.append(texto) } }
}
