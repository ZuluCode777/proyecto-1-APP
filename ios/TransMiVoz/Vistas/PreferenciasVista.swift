import SwiftUI

/// Preferencias con efecto en la app hoy: la voz propia de los avisos del accesorio. Es el MISMO estado que el
/// interruptor de la pestaña Sesión (`SesionAccesorioModelo.fijarVozPropia`), no una copia. El resto (texto,
/// contraste, VoiceOver) lo decide iOS; aquí solo se explica.
struct PreferenciasVista: View {
    /// `nil` solo en las pruebas de interfaz de la sesión simulada.
    let accesorio: SesionAccesorioModelo?

    /// Solo para que la pantalla se redibuje si la persona enciende o apaga VoiceOver con la app abierta;
    /// la política sigue en el modelo (`vozPropiaActiva`).
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOverActivo

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                voz
                sistema
            }
            .padding(16)
        }
        .navigationTitle("Preferencias")
        .navigationBarTitleDisplayMode(.inline)
        .bordeInferiorLegible()
    }

    private func vozPropiaActiva(_ accesorio: SesionAccesorioModelo) -> Bool {
        _ = voiceOverActivo
        return accesorio.vozPropiaActiva
    }

    private var voz: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(TextoPreferencias.tituloVoz)
                .font(.headline)
                .accessibilityAddTraits(.isHeader)
            if let accesorio {
                Toggle(isOn: Binding(
                    get: { vozPropiaActiva(accesorio) },
                    set: { accesorio.fijarVozPropia($0) })) {
                        Text("Avisos hablados por la app")
                            .accessibilityIdentifier("etiqueta-interruptor-voz-preferencias")
                    }
                    .frame(minHeight: 44)
                    .accessibilityIdentifier("interruptor-voz-preferencias")
                Text(TextoPreferencias.notaVoz)
                    .font(.footnote)
                    .foregroundStyle(.textoSecundario)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("nota-voz-preferencias")
            } else {
                Text(TextoPreferencias.sinAccesorio)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("sin-voz-preferencias")
            }
        }
    }

    private var sistema: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(TextoPreferencias.tituloSistema)
                .font(.headline)
                .accessibilityAddTraits(.isHeader)
            Text(TextoPreferencias.notaSistema)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("nota-sistema-preferencias")
        }
    }
}
