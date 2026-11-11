import SwiftUI

/// Rutas favoritas: lista con «Quitar» y un estado vacío que explica cómo se agregan. Agregar se hace desde la
/// pantalla de rutas (`FavoritasModelo.agregar`).
struct FavoritasVista: View {
    let modelo: FavoritasModelo

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if modelo.codigos.isEmpty {
                    vacio
                } else {
                    lista
                }
                Text(TextoFavoritas.dondeSeGuardan)
                    .font(.footnote)
                    .foregroundStyle(.textoSecundario)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("nota-favoritas")
            }
            .padding(16)
        }
        .navigationTitle("Favoritas")
        .navigationBarTitleDisplayMode(.inline)
        .bordeInferiorLegible()
    }

    private var vacio: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(TextoFavoritas.vacio)
                .font(.headline)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("favoritas-vacio")
            Text(TextoFavoritas.comoSeAgregan)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("favoritas-como-agregar")
        }
    }

    private var lista: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(TextoFavoritas.resumen(modelo.codigos.count))
                .font(.headline)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("favoritas-resumen")
            // Siempre en vertical: con texto grande el código y el botón no caben en una fila.
            ForEach(modelo.codigos, id: \.self) { codigo in
                VStack(alignment: .leading, spacing: 8) {
                    Text("Ruta \(codigo)")
                        .font(.title3.bold())
                        .accessibilityIdentifier("favorita-\(codigo)")
                    Button(role: .destructive) {
                        quitar(codigo)
                    } label: {
                        Text("Quitar").foregroundStyle(Color(uiColor: .systemBackground))
                    }
                    .font(.body)
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .tint(.rojoAccesible)
                    .frame(minHeight: 44)
                    .accessibilityLabel(TextoFavoritas.etiquetaQuitar(codigo))
                    .accessibilityIdentifier("quitar-favorita-\(codigo)")
                }
            }
        }
    }

    private func quitar(_ codigo: String) {
        guard modelo.quitar(codigo) else { return }
        AccessibilityNotification.Announcement(
            TextoFavoritas.quitada(codigo, quedan: modelo.codigos.count)).post()
    }
}
