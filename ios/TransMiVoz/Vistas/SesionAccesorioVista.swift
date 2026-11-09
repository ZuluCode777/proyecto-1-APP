import ContratoBLE
import SwiftUI

/// Pantalla de la sesión con el accesorio REAL por Bluetooth. Funciona sin red ni servidor.
/// El accesorio se elige a mano; iniciar, detener y reconectar son botones aparte.
struct SesionAccesorioVista: View {
    let modelo: SesionAccesorioModelo

    @Environment(\.openURL) private var abrirURL

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Label("Sensor real por Bluetooth. Los avisos hablados solo salen por auriculares. Con la pantalla bloqueada o la app en segundo plano la sesión se detiene; al volver se sincroniza de nuevo.", systemImage: "dot.radiowaves.left.and.right")
                        .font(.subheadline)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("aviso-accesorio-real")

                    if !modelo.enlaceVerificable {
                        Label("Esta versión todavía no puede verificar que el enlace sea cifrado y autenticado (falta la prueba con la placa). Por eso bloquea las medidas y los avisos del sensor.", systemImage: "lock.trianglebadge.exclamationmark")
                            .font(.headline)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier("aviso-seguridad-enlace")
                    }

                    seccionBluetooth
                    seccionAccesorio
                    seccionControles
                    seccionEstado

                    Text("Esta pantalla no necesita internet ni el servidor de transporte.")
                        .font(.footnote)
                        .foregroundStyle(.textoSecundario)
                }
                .padding(16)
            }
            .navigationTitle("Sesión")
            .navigationBarTitleDisplayMode(.inline)
            .bordeInferiorLegible()
        }
    }

    private var seccionBluetooth: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(TextoAccesorio.bluetooth(modelo.disponibilidad))
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("estado-bluetooth")
            if modelo.disponibilidad == .sinPermiso || modelo.disponibilidad == .restringido {
                Button("Abrir Ajustes") {
                    if let url = URL(string: UIApplication.openSettingsURLString) { abrirURL(url) }
                }
                .buttonStyle(.bordered)
                .frame(minHeight: 44)
                .accessibilityIdentifier("boton-abrir-ajustes")
            }
        }
    }

    private var seccionAccesorio: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Accesorio")
                .font(.headline)
                .accessibilityAddTraits(.isHeader)
            Text("Accesorio elegido: \(modelo.elegido?.etiqueta ?? "ninguno")")
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("accesorio-elegido")
            Button(modelo.buscando ? "Dejar de buscar" : "Buscar accesorios") {
                if modelo.buscando { modelo.dejarDeBuscar() } else { modelo.buscar() }
            }
            .buttonStyle(.bordered)
            .frame(minHeight: 44)
            .accessibilityIdentifier("boton-buscar")

            if modelo.buscando && modelo.encontrados.isEmpty {
                Text("Buscando accesorios cercanos…")
                    .accessibilityIdentifier("buscando-accesorios")
            }
            ForEach(modelo.encontrados) { accesorio in
                Button("Elegir \(accesorio.etiqueta)") { modelo.elegir(accesorio) }
                    .buttonStyle(.bordered)
                    .frame(minHeight: 44)
            }
            Text("El nombre y el identificador no prueban que el accesorio sea el tuyo.")
                .font(.footnote)
                .foregroundStyle(.textoSecundario)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var seccionControles: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button(modelo.activa ? "Detener sesión" : "Iniciar sesión") {
                if modelo.activa { modelo.detener() } else { modelo.iniciar() }
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .frame(minHeight: 44)
            .disabled(modelo.elegido == nil)
            .accessibilityIdentifier("boton-sesion-accesorio")

            Button("Reconectar") { modelo.reconectar() }
                .buttonStyle(.bordered)
                .controlSize(.large)
                .frame(minHeight: 44)
                .disabled(modelo.elegido == nil)
                .accessibilityIdentifier("boton-reconectar")
        }
    }

    private var seccionEstado: some View {
        let estado = modelo.estado
        return VStack(alignment: .leading, spacing: 8) {
            Text("Estado del accesorio")
                .font(.headline)
                .accessibilityAddTraits(.isHeader)
            Label(TextoAccesorio.titulo(estado), systemImage: TextoAccesorio.icono(estado))
                .font(.title3.weight(.semibold))
                .accessibilityIdentifier("titulo-estado-accesorio")
            Text(TextoAccesorio.descripcion(estado))
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("estado-accesorio")
            Text("Origen de los datos: accesorio real por Bluetooth")
            Text("Enlace autenticado: \(modelo.enlaceAutenticado ? "sí" : "no verificado")")
                .accessibilityIdentifier("enlace-accesorio")
            Text("Tramas perdidas: \(modelo.tramasPerdidas)")
            Text(TextoAccesorio.audio(ruta: modelo.voz.ruta, interrumpido: modelo.voz.interrumpido))
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("estado-audio")
        }
        .accessibilityElement(children: .contain)
    }
}
