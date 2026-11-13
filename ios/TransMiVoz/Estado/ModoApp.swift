import Foundation
import Observation

/// Modo de visualización de la app, igual que `Mode` de la web (`components/transmivoz-app.tsx`). Hoy solo decide qué
/// Inicio se muestra; el Inicio de voz de «Ceguera total» lo construye otra tarea (`AgenteTotalVista`).
enum ModoApp: String, CaseIterable, Identifiable, Sendable {
    /// Baja visión. En la web se llama `parcial`: el valor guardado es el mismo.
    case parcial
    /// Ceguera total: sin mirar la pantalla, solo voz.
    case total

    var id: String { rawValue }

    /// Textos de `components/mode-menu.tsx` y del anuncio de `changeMode`.
    var titulo: String {
        switch self {
        case .parcial: return "Baja visión"
        case .total: return "Ceguera total"
        }
    }

    var descripcion: String {
        switch self {
        case .parcial: return "Para personas con visión parcial. Texto e íconos grandes: buscar rutas, frecuentes y asistencia."
        case .total: return "Para personas totalmente ciegas. Sin mirar la pantalla: solo voz y escaneo guiados por audio."
        }
    }

    /// Lo que se anuncia al elegirlo (la web lo dice en voz alta; aquí lo anuncia VoiceOver).
    var anuncio: String {
        switch self {
        case .parcial: return "Modo baja visión activado."
        case .total: return "Modo ceguera total activado."
        }
    }
}

/// Dónde se guarda el modo elegido. En producción es `UserDefaults`; las pruebas usan un doble en memoria.
protocol AlmacenModo: Sendable {
    /// El valor guardado, o `nil` si no hay nada.
    func leer() -> String?
    func guardar(_ valor: String)
}

/// Misma clave que la web (`localStorage`): `transmivoz-mode` guarda `parcial` o `total`.
struct AlmacenModoUserDefaults: AlmacenModo {
    static let clave = "transmivoz-mode"

    private let preferencias: UserDefaults

    init(preferencias: UserDefaults = .standard) {
        self.preferencias = preferencias
    }

    func leer() -> String? { preferencias.string(forKey: Self.clave) }
    func guardar(_ valor: String) { preferencias.set(valor, forKey: Self.clave) }
}

/// El modo elegido, persistido. Cualquier valor guardado que no sea `parcial` ni `total` se ignora y se parte de
/// baja visión, como hace la web al leer `localStorage`.
@MainActor
@Observable
final class ModoAppModelo {
    private(set) var modo: ModoApp

    @ObservationIgnored private let almacen: AlmacenModo

    init(almacen: AlmacenModo) {
        self.almacen = almacen
        modo = almacen.leer().flatMap(ModoApp.init(rawValue:)) ?? .parcial
    }

    /// Cambia el modo y lo guarda. `false` si ya era ese: no escribe.
    @discardableResult
    func elegir(_ nuevo: ModoApp) -> Bool {
        guard nuevo != modo else { return false }
        modo = nuevo
        almacen.guardar(nuevo.rawValue)
        return true
    }
}
