import SwiftUI

@main
struct TransMiVozApp: App {
    @State private var entorno = EntornoApp.crear()

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
