#if DEBUG
import SwiftUI

/// Control negativo de la auditoría de contraste, solo en compilaciones de depuración y solo con
/// `-PRUEBAS_UI_CONTRASTE_MALO` (junto con `-PRUEBAS_UI_SIMULADAS`, que evita Bluetooth y red). Muestra A PROPÓSITO un
/// texto pequeño con contraste insuficiente (gris muy claro sobre blanco, ~1,5:1), entero a la vista, para que una prueba
/// de interfaz compruebe que la auditoría nativa lo reporta y que el libro de contraste diferido lo rechaza.
/// No es una pantalla de la app: no ofrece ninguna función, no toca el accesorio ni su bloqueo por enlace no verificado.
struct FixtureContrasteMalo: View {
    var body: some View {
        TabView {
            NavigationStack {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        Text("Texto de prueba con contraste insuficiente a propósito.")
                            .font(.footnote)
                            .foregroundStyle(Color(white: 0.85))
                            .padding(8)
                            .background(Color.white)
                            .accessibilityIdentifier("contraste-malo-sintetico")
                        // Relleno para que el área sea desplazable, como la de las pantallas reales.
                        Color.clear.frame(height: 1200)
                    }
                    .padding(16)
                }
                .navigationTitle("Contraste")
                .navigationBarTitleDisplayMode(.inline)
                .bordeInferiorLegible()
            }
            .tabItem { Label("Contraste", systemImage: "eye") }
        }
    }
}
#endif
