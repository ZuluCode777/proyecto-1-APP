import ContratoBLE
import SwiftUI

/// Pantalla de la sesión con el accesorio REAL por Bluetooth. Funciona sin red ni servidor.
/// El accesorio se elige a mano; iniciar, detener y reconectar son botones aparte.
/// Es la misma vista en producción y en las pruebas de interfaz; en estas, `avisoSintetico` rotula que el
/// transporte es sintético (sin Bluetooth, radio ni audio) y el bloqueo por enlace no verificado sigue igual.
struct SesionAccesorioVista: View {
    let modelo: SesionAccesorioModelo
    var avisoSintetico = false

    @Environment(\.openURL) private var abrirURL
    /// Solo para que la pantalla se redibuje cuando la persona enciende o apaga VoiceOver con la app abierta.
    /// La política sigue en el modelo, que consulta VoiceOver en cada uso (`vozPropiaActiva`).
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOverActivo

    /// `modelo.vozPropiaActiva`, leído junto al entorno para que el interruptor y el texto de audio se refresquen.
    private var vozPropiaActiva: Bool {
        _ = voiceOverActivo
        return modelo.vozPropiaActiva
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                // Pila ansiosa (no diferida), también dentro de cada sección: todos los elementos existen siempre, con su
                // marco real. Con `LazyVStack` la prueba nativa de Dynamic Type falló en muchos textos visibles. Lo recortado
                // bajo el área desplazable lo cubren las pruebas de interfaz con su libro de contraste diferido.
                VStack(alignment: .leading, spacing: 16) {
                    if avisoSintetico {
                        Label("Modo de pruebas: transporte sintético. No hay Bluetooth, radio, audio ni accesorio reales; el enlace sigue sin verificarse.", systemImage: "testtube.2")
                            .font(.footnote)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier("aviso-transporte-sintetico")
                    }

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
                    seccionVoz

                    Text("Esta pantalla no necesita internet ni el servidor de transporte.")
                        .font(.footnote)
                        .foregroundStyle(.textoSecundario)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("aviso-sin-red")
                }
                .padding(16)
            }
            .navigationTitle("Sesión")
            .navigationBarTitleDisplayMode(.inline)
            .bordeInferiorLegible()
            .sheet(isPresented: Binding(
                get: { modelo.explicacionPermiso != nil },
                set: { if !$0 { modelo.cancelarExplicacion() } })
            ) {
                HojaPermisoBluetooth(
                    continuar: { modelo.continuarTrasExplicacion() },
                    ahoraNo: { modelo.cancelarExplicacion() })
            }
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
                .accessibilityIdentifier("encabezado-accesorio")
            Text("Accesorio elegido: \(modelo.elegido?.etiqueta ?? "ninguno")")
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("accesorio-elegido")
            Button(modelo.busquedaPedida ? "Dejar de buscar" : "Buscar accesorios") {
                if modelo.busquedaPedida { modelo.dejarDeBuscar() } else { modelo.buscar() }
            }
            .buttonStyle(.bordered)
            .frame(minHeight: 44)
            .accessibilityIdentifier("boton-buscar")

            // «Buscando» solo con escaneo real; con la búsqueda pedida pero sin poder escanear se dice por qué.
            if modelo.buscando && modelo.encontrados.isEmpty {
                Text("Buscando accesorios cercanos…")
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("buscando-accesorios")
            } else if modelo.busquedaPedida && !modelo.buscando {
                Text(TextoAccesorio.busquedaPendiente)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("busqueda-pendiente")
            }
            ForEach(modelo.encontrados) { accesorio in
                Button("Elegir \(accesorio.etiqueta)") { modelo.elegir(accesorio) }
                    .buttonStyle(.bordered)
                    .frame(minHeight: 44)
                    .accessibilityAddTraits(modelo.elegido?.id == accesorio.id ? .isSelected : [])
                    .accessibilityIdentifier("elegir-\(accesorio.id)")
            }
            Text("El nombre y el identificador no prueban que el accesorio sea el tuyo.")
                .font(.footnote)
                .foregroundStyle(.textoSecundario)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("nota-identificador-accesorio")
        }
    }

    private var seccionControles: some View {
        VStack(alignment: .leading, spacing: 8) {
            Button(modelo.activa ? "Detener sesión" : "Iniciar sesión") {
                if modelo.activa { modelo.detener() } else { modelo.iniciar() }
            }
            .accion(prominente: true, disponible: modelo.elegido != nil)
            .controlSize(.large)
            .frame(minHeight: 44)
            .accessibilityHint(modelo.elegido == nil ? "Primero elige un accesorio" : "")
            .accessibilityIdentifier("boton-sesion-accesorio")

            Button("Reconectar") { modelo.reconectar() }
                .accion(prominente: false, disponible: modelo.elegido != nil)
                .controlSize(.large)
                .frame(minHeight: 44)
                .accessibilityHint(modelo.elegido == nil ? "Primero elige un accesorio" : "")
                .accessibilityIdentifier("boton-reconectar")
        }
    }

    private var seccionEstado: some View {
        let estado = modelo.estado
        return VStack(alignment: .leading, spacing: 8) {
            Text("Estado del accesorio")
                .font(.headline)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("encabezado-estado-accesorio")
            Label(TextoAccesorio.titulo(estado), systemImage: TextoAccesorio.icono(estado))
                .font(.title3.weight(.semibold))
                .accessibilityIdentifier("titulo-estado-accesorio")
            Text(TextoAccesorio.descripcion(estado))
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("estado-accesorio")
            Text("Origen de los datos: accesorio real por Bluetooth")
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("origen-datos-accesorio")
            Text("Enlace autenticado: \(modelo.enlaceAutenticado ? "sí" : "no verificado")")
                .accessibilityIdentifier("enlace-accesorio")
            Text("Tramas perdidas: \(modelo.tramasPerdidas)")
                .accessibilityIdentifier("tramas-perdidas-accesorio")
            Text(TextoAccesorio.audio(
                ruta: modelo.voz.ruta, interrumpido: modelo.voz.interrumpido,
                audioNoDisponible: modelo.voz.audioNoDisponible, vozPropia: vozPropiaActiva))
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("estado-audio")
        }
        .accessibilityElement(children: .contain)
    }

    private var seccionVoz: some View {
        VStack(alignment: .leading, spacing: 8) {
            Toggle("Avisos hablados por la app", isOn: Binding(
                get: { vozPropiaActiva },
                set: { modelo.fijarVozPropia($0) }))
                .frame(minHeight: 44)
                .accessibilityIdentifier("interruptor-voz-app")
            Text("Con VoiceOver activo empieza apagada para no hablar dos veces. Los avisos del sensor nunca se leen con VoiceOver: solo salen por auriculares y quedan en pantalla.")
                .font(.footnote)
                .foregroundStyle(.textoSecundario)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("nota-voz-app")
        }
    }
}

/// Explicación del permiso de Bluetooth ANTES del aviso del sistema (EA-02 §8), con una salida sin permiso.
struct HojaPermisoBluetooth: View {
    let continuar: () -> Void
    let ahoraNo: () -> Void

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text(TextoAccesorio.permisoBluetoothExplicacion)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("texto-permiso-bluetooth")
                    Button("Continuar", action: continuar)
                        .buttonStyle(.borderedProminent)
                        .controlSize(.large)
                        .frame(minHeight: 44)
                        .accessibilityIdentifier("boton-permiso-continuar")
                    Button("Ahora no", action: ahoraNo)
                        .buttonStyle(.bordered)
                        .controlSize(.large)
                        .frame(minHeight: 44)
                        .accessibilityIdentifier("boton-permiso-ahora-no")
                    Text(TextoAccesorio.permisoBluetoothAlternativa)
                        .font(.footnote)
                        .foregroundStyle(.textoSecundario)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(16)
            }
            .navigationTitle(TextoAccesorio.permisoBluetoothTitulo)
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}
