import SwiftUI

/// «Mapa y GPS» (web: `components/auditory-gps.tsx`). Se abre desde la baldosa «Mapa y GPS» de Inicio.
///
/// PROVISIONAL: pantalla mínima de la base visual. La tarea de esta función reemplaza este archivo entero; la línea
/// provisional (`textoProvisional`) no debe llegar a `main`: la rama de integración se fusiona solo con todas las
/// pantallas reales. Conserva el título de navegación «Mapa y GPS» (las pruebas de Inicio abren la pantalla por él).
struct GpsAuditivoVista: View {
    /// Única línea provisional de esta pantalla.
    static let textoProvisional = "Mapa y GPS: pantalla en construcción."

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                EncabezadoPantalla(
                    titulo: "Mapa y GPS", subtitulo: "Te oriento por voz hacia la estación más cercana", simbolo: "map")
                Text(Self.textoProvisional)
                    .font(.jakarta())
                    .foregroundStyle(Paleta.foreground)
                    .accessibilityIdentifier("provisional-gps")
            }
            .padding(16)
        }
        .navigationTitle("Mapa y GPS")
        .navigationBarTitleDisplayMode(.inline)
        .bordeInferiorLegible()
    }
}
