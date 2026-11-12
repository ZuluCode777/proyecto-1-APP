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
                        ForEach(seccion.llamadas, id: \.numero) { llamada in
                            if let url = llamada.url {
                                // Subrayado: el enlace no se distingue solo por el color.
                                Link(destination: url) {
                                    Text("Llamar al \(llamada.numero): \(llamada.nombre)")
                                        .underline()
                                        .multilineTextAlignment(.leading)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                                .frame(minHeight: 44, alignment: .leading)
                                .accessibilityIdentifier("ayuda-llamar-\(llamada.numero)")
                            }
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
