import SwiftUI

/// «Metro de Bogotá» (web: `components/metro-list.tsx`). Se abre desde la baldosa «Metro de Bogotá» de Inicio.
///
/// PROVISIONAL: pantalla mínima de la base visual. La tarea de esta función reemplaza este archivo entero; la línea
/// provisional (`textoProvisional`) no debe llegar a `main`: la rama de integración se fusiona solo con todas las
/// pantallas reales. Conserva el título de navegación «Metro de Bogotá» (las pruebas de Inicio abren la pantalla por él).
struct MetroVista: View {
    /// Única línea provisional de esta pantalla.
    static let textoProvisional = "Metro de Bogotá: pantalla en construcción."

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                EncabezadoPantalla(
                    titulo: "Metro de Bogotá", subtitulo: "Línea 1 · en construcción · sin servicio", simbolo: "tram")
                Text(Self.textoProvisional)
                    .font(.jakarta())
                    .foregroundStyle(Paleta.foreground)
                    .accessibilityIdentifier("provisional-metro")
            }
            .padding(16)
        }
        .navigationTitle("Metro de Bogotá")
        .navigationBarTitleDisplayMode(.inline)
        .bordeInferiorLegible()
    }
}
