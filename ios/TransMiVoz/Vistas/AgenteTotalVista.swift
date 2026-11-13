import SwiftUI

/// Inicio del modo «Ceguera total» (web: `components/total-agent.tsx`): la web muestra aquí al asistente de voz a pantalla
/// completa, sin las baldosas. `InicioVista` lo pone en lugar de las baldosas cuando el modo es `.total`. Ese es el gancho
/// del Inicio de voz.
///
/// PROVISIONAL: pantalla mínima de la base visual. La tarea del Inicio de voz reemplaza este archivo entero; la línea
/// provisional (`textoProvisional`) no debe llegar a `main`.
struct AgenteTotalVista: View {
    /// Única línea provisional de esta pantalla.
    static let textoProvisional = "Ceguera total: el Inicio de voz está en construcción."

    var body: some View {
        ScrollView {
            Text(Self.textoProvisional)
                .font(.jakarta(.bold, .lg))
                .tarjetaWeb()
                .accessibilityIdentifier("provisional-agente-total")
                .padding(16)
        }
        .bordeInferiorLegible()
    }
}
