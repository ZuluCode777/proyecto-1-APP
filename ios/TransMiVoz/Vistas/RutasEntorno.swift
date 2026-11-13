import SwiftUI

private struct ClaveServiciosRutas: EnvironmentKey {
    static let defaultValue: ServiciosRutas? = nil
}

extension EnvironmentValues {
    /// Servicios de las pantallas de rutas. `TransMiVozApp` los fija para toda la app; sin ellos la consulta no
    /// ofrece el acceso a rutas. Va por el entorno para no cambiar los inicializadores de las pantallas existentes.
    var serviciosRutas: ServiciosRutas? {
        get { self[ClaveServiciosRutas.self] }
        set { self[ClaveServiciosRutas.self] = newValue }
    }
}
