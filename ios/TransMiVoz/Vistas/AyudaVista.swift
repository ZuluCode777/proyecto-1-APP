import SwiftUI

/// Ayuda estática: cómo usar la app y sus límites. El texto está en `TextoAyuda` y dice lo que la app hace hoy.
struct AyudaVista: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ForEach(Array(TextoAyuda.secciones.enumerated()), id: \.offset) { posicion, seccion in
                    VStack(alignment: .leading, spacing: 8) {
                        Text(seccion.titulo)
                            .font(.headline)
                            .accessibilityAddTraits(.isHeader)
                            .accessibilityIdentifier("ayuda-titulo-\(posicion)")
                        ForEach(Array(seccion.parrafos.enumerated()), id: \.offset) { _, parrafo in
                            Text(parrafo).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }
            .padding(16)
        }
        .navigationTitle("Ayuda")
        .navigationBarTitleDisplayMode(.inline)
        .bordeInferiorLegible()
    }
}
