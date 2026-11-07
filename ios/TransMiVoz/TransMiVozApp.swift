import SwiftUI

@main
struct TransMiVozApp: App {
    @State private var entorno = EntornoApp.crear()

    var body: some Scene {
        WindowGroup {
            RaizVista(entorno: entorno)
        }
    }
}
