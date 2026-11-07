import SwiftUI

/// Origen HTTPS y clave del backend. La sesión local no depende de nada de esta pantalla.
struct AjustesServidorVista: View {
    @Bindable var modelo: AjustesServidorModelo
    let avisoModoPruebas: Bool

    var body: some View {
        NavigationStack {
            Form {
                if avisoModoPruebas {
                    Section { AvisoModoPruebas() }
                }
                Section {
                    TextField("Dirección del servidor", text: $modelo.origenTexto)
                        .keyboardType(.URL)
                        .textContentType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .frame(minHeight: 44)
                        .accessibilityIdentifier("campo-origen")
                    SecureField("Clave de acceso (opcional)", text: $modelo.claveTexto)
                        .textContentType(.password)
                        .frame(minHeight: 44)
                        .accessibilityIdentifier("campo-clave")
                    Toggle("Recordar la clave en el Llavero", isOn: $modelo.recordarClave)
                        .frame(minHeight: 44)
                        .accessibilityIdentifier("interruptor-recordar")
                } header: {
                    Text("Servidor de transporte")
                } footer: {
                    Text("Solo se aceptan direcciones https://. La clave se envía únicamente a este servidor. Si no activas el Llavero, la clave se olvida al cerrar la app.")
                }

                Section {
                    Button("Aplicar") { modelo.aplicar() }
                        .frame(minHeight: 44)
                        .accessibilityIdentifier("boton-aplicar")
                    Button("Olvidar clave", role: .destructive) { modelo.olvidarClave() }
                        .frame(minHeight: 44)
                        .accessibilityIdentifier("boton-olvidar")
                }

                Section("Estado") {
                    Text(modelo.resumen).accessibilityIdentifier("resumen-ajustes")
                    if let mensaje = modelo.mensaje {
                        Label(mensaje.texto, systemImage: mensaje.esError ? "exclamationmark.triangle" : "checkmark.circle")
                            .accessibilityIdentifier("mensaje-ajustes")
                    }
                }
            }
            .navigationTitle("Servidor")
            .navigationBarTitleDisplayMode(.inline)
            .onChange(of: modelo.mensaje) { _, nuevo in
                if let nuevo { AccessibilityNotification.Announcement(nuevo.texto).post() }
            }
        }
    }
}
