import QuartzCore
import XCTest
@testable import TransMiVoz

/// Doble de la cámara: anota las llamadas y deja que la prueba emita eventos con cualquier token y conteste al
/// aviso de permiso cuando quiera.
@MainActor
final class CamaraFalsa: CamaraLupa {
    var receptor: (@MainActor (EventoCamara, Int) -> Void)?
    let capa = CALayer()
    var hayCamara = true
    private(set) var permiso: PermisoCamara
    private(set) var llamadas: [String] = []
    /// Token de la última captura pedida.
    private(set) var tokenVigente = 0

    init(permiso: PermisoCamara) { self.permiso = permiso }

    func pedirPermiso() { llamadas.append("pedirPermiso") }
    func iniciar(token: Int) { llamadas.append("iniciar"); tokenVigente = token }
    func detener() { llamadas.append("detener") }
    func fijarAumento(_ factor: Double) { llamadas.append("aumento:\(factor)") }
    func fijarFiltro(_ filtro: FiltroLupa) { llamadas.append("filtro:\(filtro.rawValue)") }
    func congelar(_ congelada: Bool) { llamadas.append("congelar:\(congelada)") }

    func emitir(_ evento: EventoCamara, token: Int? = nil) { receptor?(evento, token ?? tokenVigente) }
    /// La persona contestó al aviso de permiso del sistema.
    func responder(_ nuevo: PermisoCamara) {
        permiso = nuevo
        receptor?(.permisoRespondido, tokenSinCaptura)
    }

    func veces(_ llamada: String) -> Int { llamadas.filter { $0 == llamada }.count }
}

/// Lupa con cámara y avisos falsos. Parte con la pantalla fuera de vista y la escena inactiva.
@MainActor
struct BancoLupa {
    let modelo: LupaModelo
    let camara: CamaraFalsa
    let avisos = AvisosFalsos()

    init(permiso: PermisoCamara = .concedido, hayCamara: Bool = true) {
        camara = CamaraFalsa(permiso: permiso)
        camara.hayCamara = hayCamara
        modelo = LupaModelo(camara: camara, avisos: avisos.avisos)
    }

    /// La pestaña a la vista con la escena activa.
    func mostrar() {
        modelo.escenaActiva(true)
        modelo.pantallaVisible(true)
    }

    /// Muestra la lupa y contesta como un dispositivo cuyo aumento va de 1 a `maximo`.
    func abrir(maximo: Double = 8) {
        mostrar()
        camara.emitir(.lista(aumentoMinimo: 1, aumentoMaximo: maximo))
    }
}
