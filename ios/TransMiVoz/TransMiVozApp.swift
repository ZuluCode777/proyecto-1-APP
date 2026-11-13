import SwiftUI

@main
struct TransMiVozApp: App {
    @State private var entorno = EntornoApp.crear()

    init() {
        // La letra y el color de las barras tienen que existir antes de la primera vista.
        Tipografia.registrar()
        AparienciaApp.aplicar()
    }

    var body: some Scene {
        WindowGroup {
            #if DEBUG
            if ProcessInfo.processInfo.arguments.contains("-PRUEBAS_UI_CONTRASTE_MALO") {
                FixtureContrasteMalo()
            } else {
                RaizVista(entorno: entorno).environment(\.serviciosRutas, entorno.serviciosRutas)
            }
            #else
            RaizVista(entorno: entorno).environment(\.serviciosRutas, entorno.serviciosRutas)
            #endif
        }
    }
}
