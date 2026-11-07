import ContratoBLE
import SwiftUI

/// Pantalla de la sesión local de proximidad SIMULADA. Funciona sin red ni servidor.
struct SesionVista: View {
    let modelo: SesionLocalModelo
    let avisoModoPruebas: Bool

    @Environment(\.scenePhase) private var faseEscena

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if avisoModoPruebas { AvisoModoPruebas() }

                    Label("SESIÓN SIMULADA. Las tramas las genera la app: no hay accesorio, radar ni Bluetooth conectados. No valida ningún hardware.", systemImage: "waveform.badge.exclamationmark")
                        .font(.headline)
                        .accessibilityIdentifier("aviso-simulada")

                    Button(modelo.activa ? "Detener sesión" : "Iniciar sesión simulada") {
                        if modelo.activa { modelo.detener() } else { modelo.iniciar() }
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .frame(minHeight: 44)
                    .accessibilityIdentifier("boton-sesion")

                    VStack(alignment: .leading, spacing: 8) {
                        Text("Estado del sensor")
                            .font(.headline)
                            .accessibilityAddTraits(.isHeader)
                        Text(TextoEstadoSesion.descripcion(modelo.estado))
                            .accessibilityIdentifier("estado-sesion")
                        Text("Origen de los datos: \(modelo.esSimulada ? "simulación" : "accesorio real")")
                            .accessibilityIdentifier("origen-datos")
                        Text("Enlace autenticado: \(modelo.enlaceAutenticado ? "sí" : "no (no hay enlace real)")")
                        Text("Tramas perdidas: \(modelo.tramasPerdidas)")
                    }
                    .accessibilityElement(children: .contain)

                    Text("Esta pantalla no necesita internet ni el servidor de transporte.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
                .padding(16)
            }
            .navigationTitle("Sesión")
            .navigationBarTitleDisplayMode(.inline)
            .onChange(of: modelo.estado) { _, nuevo in
                if modelo.activa { AccessibilityNotification.Announcement(TextoEstadoSesion.descripcion(nuevo)).post() }
            }
            .onChange(of: faseEscena) { _, nueva in
                if nueva == .active { modelo.alVolverAPrimerPlano() }
            }
        }
    }
}
