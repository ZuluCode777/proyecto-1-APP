import SwiftUI

/// Aviso fijo cuando la app corre con respuestas simuladas (solo pruebas de interfaz).
struct AvisoModoPruebas: View {
    var body: some View {
        Label("Modo de pruebas: las respuestas son simuladas y no vienen de ningún servidor.", systemImage: "testtube.2")
            .font(.footnote)
            .accessibilityIdentifier("aviso-modo-pruebas")
    }
}
