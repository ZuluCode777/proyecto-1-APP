import SwiftUI

/// «Emergencia» (web: `components/assistance.tsx`). Se abre desde la baldosa «Emergencia» de Inicio.
///
/// PROVISIONAL: pantalla mínima de la base visual. La tarea de esta función reemplaza este archivo entero; la línea
/// provisional (`textoProvisional`) no debe llegar a `main`: la rama de integración se fusiona solo con todas las
/// pantallas reales. Conserva el título de navegación «Emergencia» (las pruebas de Inicio abren la pantalla por él).
struct EmergenciaVista: View {
    /// Única línea provisional de esta pantalla.
    static let textoProvisional = "Emergencia: pantalla en construcción."

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                EncabezadoPantalla(titulo: "Emergencia", subtitulo: "Llamadas de ayuda", simbolo: "exclamationmark.shield")
                Text(Self.textoProvisional)
                    .font(.jakarta())
                    .foregroundStyle(Paleta.foreground)
                    .accessibilityIdentifier("provisional-emergencia")
            }
            .padding(16)
        }
        .navigationTitle("Emergencia")
        .navigationBarTitleDisplayMode(.inline)
        .bordeInferiorLegible()
    }
}
