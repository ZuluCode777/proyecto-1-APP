import SwiftUI

/// Zona de foco de VoiceOver: al terminar una consulta, el foco pasa al resultado.
enum ZonaFocoConsulta: Hashable { case resultado }

/// Pantalla de consulta textual al backend. La app no interpreta nada de
/// transporte: muestra lo que el servidor responde y los errores con su recuperación.
struct ConsultaVista: View {
    @Bindable var modelo: ConsultaModelo
    let resumenServidor: String
    let avisoModoPruebas: Bool

    @AccessibilityFocusState private var foco: ZonaFocoConsulta?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if avisoModoPruebas { AvisoModoPruebas() }

                    Text(resumenServidor)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("resumen-servidor")

                    Text("Escribe una pregunta de transporte. El texto se envía al servidor configurado; no se envía tu ubicación.")
                        .font(.body)

                    TextField("Pregunta", text: $modelo.texto, axis: .vertical)
                        .lineLimit(1...5)
                        .textFieldStyle(.roundedBorder)
                        .frame(minHeight: 44)
                        .submitLabel(.send)
                        .onSubmit { modelo.enviar() }
                        .accessibilityLabel("Pregunta de transporte")
                        .accessibilityHint("Máximo \(EntradaConsulta.maximoCaracteres) caracteres.")
                        .accessibilityIdentifier("campo-pregunta")

                    Text("\(modelo.texto.utf16.count) de \(EntradaConsulta.maximoCaracteres) caracteres")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("contador-caracteres")

                    HStack(spacing: 12) {
                        Button("Enviar") { modelo.enviar() }
                            .buttonStyle(.borderedProminent)
                            .controlSize(.large)
                            .frame(minHeight: 44)
                            .disabled(modelo.estaEnviando)
                            .accessibilityIdentifier("boton-enviar")
                        if modelo.estaEnviando {
                            Button("Cancelar") { modelo.cancelar() }
                                .buttonStyle(.bordered)
                                .controlSize(.large)
                                .frame(minHeight: 44)
                                .accessibilityIdentifier("boton-cancelar")
                        }
                    }

                    ResultadoConsultaVista(modelo: modelo, foco: $foco)
                }
                .padding(16)
            }
            .navigationTitle("Consulta")
            .navigationBarTitleDisplayMode(.inline)
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: modelo.estado) { _, nuevo in
                anunciar(nuevo)
            }
        }
        // `TabView` conserva el modelo al cambiar de pestaña: una consulta lenta no
        // debe terminar fuera de pantalla (arquitectura §7). Solo cancela la vigente.
        .onDisappear { modelo.cancelar() }
    }

    /// Un anuncio por cambio de estado; el foco pasa al resultado una sola vez.
    private func anunciar(_ estado: EstadoConsulta) {
        let texto: String
        switch estado {
        case .inactiva: return
        case .enviando: texto = "Consultando al servidor."
        case .respuesta: texto = "Respuesta recibida."
        case .error(let error): texto = "\(error.mensaje) \(error.recuperacion)"
        case .cancelada: texto = "Consulta cancelada."
        }
        AccessibilityNotification.Announcement(texto).post()
        if estado != .enviando { foco = .resultado }
    }
}

private struct ResultadoConsultaVista: View {
    let modelo: ConsultaModelo
    var foco: AccessibilityFocusState<ZonaFocoConsulta?>.Binding

    var body: some View {
        switch modelo.estado {
        case .inactiva:
            EmptyView()
        case .enviando:
            ProgressView("Consultando al servidor…")
                .accessibilityIdentifier("progreso-consulta")
        case .respuesta(let respuesta):
            RespuestaVista(respuesta: respuesta, foco: foco)
        case .error(let error):
            VStack(alignment: .leading, spacing: 8) {
                Label("No se pudo completar", systemImage: "exclamationmark.triangle")
                    .font(.headline)
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityFocused(foco, equals: .resultado)
                Text(error.mensaje).accessibilityIdentifier("mensaje-error")
                Text(error.recuperacion).foregroundStyle(.secondary)
                if error.admiteReintento && modelo.ultimoTextoEnviado != nil {
                    Button("Reintentar") { modelo.reintentar() }
                        .buttonStyle(.bordered)
                        .controlSize(.large)
                        .frame(minHeight: 44)
                        .accessibilityIdentifier("boton-reintentar")
                }
            }
        case .cancelada:
            VStack(alignment: .leading, spacing: 8) {
                Label("Consulta cancelada", systemImage: "xmark.circle")
                    .font(.headline)
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityFocused(foco, equals: .resultado)
                Text("No se mostrará ninguna respuesta de esa pregunta.")
                if modelo.ultimoTextoEnviado != nil {
                    Button("Reintentar") { modelo.reintentar() }
                        .buttonStyle(.bordered)
                        .controlSize(.large)
                        .frame(minHeight: 44)
                        .accessibilityIdentifier("boton-reintentar")
                }
            }
        }
    }
}

private struct RespuestaVista: View {
    let respuesta: RespuestaAgente
    var foco: AccessibilityFocusState<ZonaFocoConsulta?>.Binding

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Respuesta", systemImage: "text.bubble")
                .font(.headline)
                .accessibilityAddTraits(.isHeader)
                .accessibilityFocused(foco, equals: .resultado)

            if case .viaje(let tramos) = respuesta.accion {
                // El texto del servidor puede traer órdenes de abordaje sin verificar
                // paradas ni vigencia: esta versión no lo presenta (ver README).
                Text("Esta app no da órdenes de abordaje. El servidor devolvió un recorrido; se muestra solo como información, sin verificar paradas ni sentido.")
                    .accessibilityIdentifier("aviso-viaje")
                ForEach(Array(tramos.enumerated()), id: \.offset) { _, tramo in
                    Text(descripcion(tramo))
                }
            } else {
                Text(respuesta.texto).accessibilityIdentifier("texto-respuesta")
                detalleAccion
            }

            if !respuesta.pasos.isEmpty && !esViaje {
                Text("Pasos del servidor").font(.subheadline.bold())
                ForEach(Array(respuesta.pasos.enumerated()), id: \.offset) { _, paso in
                    Text(paso.detalle.map { "\(paso.etiqueta): \($0)" } ?? paso.etiqueta)
                        .font(.footnote)
                }
            }
            Text("Interpretada con: \(respuesta.motor.rawValue)")
                .font(.footnote)
                .foregroundStyle(.secondary)
        }
        .accessibilityIdentifier("bloque-respuesta")
    }

    private var esViaje: Bool {
        if case .viaje = respuesta.accion { return true }
        return false
    }

    @ViewBuilder private var detalleAccion: some View {
        switch respuesta.accion {
        case .busqueda(let estacion): Text("Estación: \(estacion)")
        case .ruta(let codigo): Text("Ruta: \(codigo)")
        case .gps: Text("El servidor sugiere usar la ubicación. Esta versión no la implementa.").foregroundStyle(.secondary)
        case .frecuentes: Text("El servidor sugiere los favoritos. Esta versión no los implementa.").foregroundStyle(.secondary)
        case .ninguna, .viaje: EmptyView()
        }
    }

    private func descripcion(_ tramo: TramoViaje) -> String {
        let conteo = tramo.conteoVerificado
            ? "\(tramo.estacionesRecorridas) estaciones (conteo verificado)"
            : "número de estaciones no verificado"
        return "Ruta \(tramo.codigoRuta): de \(tramo.estacionAbordaje) a \(tramo.estacionDescenso), \(conteo)."
    }
}
