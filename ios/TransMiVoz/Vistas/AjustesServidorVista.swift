import SwiftUI

/// Origen HTTPS y clave del backend. La sesión local no depende de nada de esta pantalla.
///
/// Es un `ScrollView` y no un `Form`: las filas de un `Form` se reciclan y fijan la tipografía de
/// encabezados y pies, y con texto grande la auditoría de accesibilidad los marcaba como parcialmente
/// sin soporte de Dynamic Type. El estado va primero para que quede a la vista y no bajo la barra de pestañas.
struct AjustesServidorVista: View {
    @Bindable var modelo: AjustesServidorModelo
    let avisoModoPruebas: Bool

    private enum Campo: Hashable { case origen, clave }
    @FocusState private var campoEnfocado: Campo?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if avisoModoPruebas { AvisoModoPruebas() }

                    estado
                    campos
                    acciones
                }
                .padding(16)
            }
            .navigationTitle("Servidor")
            .navigationBarTitleDisplayMode(.inline)
            .scrollDismissesKeyboard(.interactively)
            .bordeInferiorLegible()
            .onChange(of: modelo.mensaje) { _, nuevo in
                if let nuevo { AccessibilityNotification.Announcement(nuevo.texto).post() }
            }
        }
    }

    private var estado: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Estado")
                .font(.headline)
                .accessibilityAddTraits(.isHeader)
            Text(modelo.resumen).accessibilityIdentifier("resumen-ajustes")
            if let mensaje = modelo.mensaje {
                Label(mensaje.texto, systemImage: mensaje.esError ? "exclamationmark.triangle" : "checkmark.circle")
                    .accessibilityIdentifier("mensaje-ajustes")
            }
        }
    }

    /// Etiqueta visible que ajusta líneas; el campo lleva su propia etiqueta de accesibilidad
    /// y un marcador corto, que no se recorta con texto grande.
    private var campos: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Servidor de transporte")
                .font(.headline)
                .accessibilityAddTraits(.isHeader)

            etiqueta("Dirección del servidor")
            TextField("https://", text: $modelo.origenTexto, axis: .vertical)
                .lineLimit(1...3)
                .textFieldStyle(.roundedBorder)
                .keyboardType(.URL)
                .textContentType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.done)
                .focused($campoEnfocado, equals: .origen)
                .frame(minHeight: 44)
                .accessibilityLabel("Dirección del servidor")
                .accessibilityIdentifier("campo-origen")

            etiqueta("Clave de acceso (opcional)")
            SecureField("Clave", text: $modelo.claveTexto)
                .textFieldStyle(.roundedBorder)
                .textContentType(.password)
                .submitLabel(.done)
                .focused($campoEnfocado, equals: .clave)
                .frame(minHeight: 44)
                .accessibilityLabel("Clave de acceso (opcional)")
                .accessibilityIdentifier("campo-clave")

            Toggle("Recordar la clave en el Llavero", isOn: $modelo.recordarClave)
                .frame(minHeight: 44)
                .accessibilityIdentifier("interruptor-recordar")

            Text("Solo se aceptan direcciones https://. La clave se envía únicamente a este servidor. Si no activas el Llavero, la clave se olvida al cerrar la app.")
                .font(.footnote)
                .foregroundStyle(.textoSecundario)
        }
    }

    private func etiqueta(_ texto: String) -> some View {
        Text(texto)
            .font(.subheadline.bold())
            .accessibilityHidden(true)
    }

    private var acciones: some View {
        // Siempre en vertical: `ViewThatFits` cambiaba de rama (y de nodos de accesibilidad) al escalar
        // la fuente, y la auditoría marcaba los dos botones como Dynamic Type parcialmente sin soporte.
        VStack(alignment: .leading, spacing: 12) { botonAplicar; botonOlvidar }
    }

    private var botonAplicar: some View {
        Button("Aplicar") {
            campoEnfocado = nil
            modelo.aplicar()
        }
        .font(.body)
        .buttonStyle(.borderedProminent)
        .controlSize(.large)
        .frame(minHeight: 44)
        .accessibilityIdentifier("boton-aplicar")
    }

    private var botonOlvidar: some View {
        Button(role: .destructive) {
            campoEnfocado = nil
            modelo.olvidarClave()
        } label: {
            Text("Olvidar clave").foregroundStyle(Color(uiColor: .systemBackground))
        }
        .font(.body)
        .buttonStyle(.borderedProminent)
        .controlSize(.large)
        .tint(.rojoAccesible)
        .frame(minHeight: 44)
        .accessibilityIdentifier("boton-olvidar")
    }
}
