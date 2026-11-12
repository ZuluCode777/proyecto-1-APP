import Foundation
import Observation

/// Dónde se guardan los códigos de las rutas favoritas. En producción es `UserDefaults`;
/// las pruebas usan un doble en memoria.
protocol AlmacenFavoritas: Sendable {
    /// Los códigos guardados, o `nil` si no hay nada o lo guardado no es una lista de textos
    /// (igual que `readSavedFavorites` en la web).
    func leer() -> [String]?
    func guardar(_ codigos: [String])
}

struct AlmacenFavoritasUserDefaults: AlmacenFavoritas {
    static let claveGuardado = "rutasFavoritas"

    private let preferencias: UserDefaults

    init(preferencias: UserDefaults = .standard) {
        self.preferencias = preferencias
    }

    func leer() -> [String]? { preferencias.stringArray(forKey: Self.claveGuardado) }
    func guardar(_ codigos: [String]) { preferencias.set(codigos, forKey: Self.claveGuardado) }
}

/// Rutas favoritas, por código (por ejemplo «B23»), en el orden en que se guardaron. Se guardan solo en este
/// iPhone. La pantalla de rutas usará `agregar`, `quitar` y `contiene`; nada más se expone.
@MainActor
@Observable
final class FavoritasModelo {
    private(set) var codigos: [String]

    @ObservationIgnored private let almacen: AlmacenFavoritas

    init(almacen: AlmacenFavoritas) {
        self.almacen = almacen
        var vistos = Set<String>()
        codigos = (almacen.leer() ?? []).compactMap(Self.normalizar).filter { vistos.insert($0).inserted }
    }

    /// Sin espacios en los extremos y en mayúsculas; `nil` si queda vacío.
    static func normalizar(_ codigo: String) -> String? {
        let limpio = codigo.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        return limpio.isEmpty ? nil : limpio
    }

    func contiene(_ codigo: String) -> Bool {
        guard let codigo = Self.normalizar(codigo) else { return false }
        return codigos.contains(codigo)
    }

    /// `true` si la ruta se agregó; `false` si el código está vacío o la ruta ya era favorita.
    @discardableResult
    func agregar(_ codigo: String) -> Bool {
        guard let codigo = Self.normalizar(codigo), !codigos.contains(codigo) else { return false }
        codigos.append(codigo)
        almacen.guardar(codigos)
        return true
    }

    /// `true` si la ruta se quitó; `false` si no era favorita.
    @discardableResult
    func quitar(_ codigo: String) -> Bool {
        guard let codigo = Self.normalizar(codigo), let posicion = codigos.firstIndex(of: codigo) else { return false }
        codigos.remove(at: posicion)
        almacen.guardar(codigos)
        return true
    }
}
