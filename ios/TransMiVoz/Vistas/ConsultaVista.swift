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
    @FocusState private var campoEnfocado: Bool
    /// Se fija al crear la vista y no cambia si el usuario cambia el tamaño de texto con la app abierta.
    @State private var creacionDiferida = UIApplication.shared.preferredContentSizeCategory.isAccessibilityCategory

    var body: some View {
        NavigationStack {
            // El selector va en una fila fija sobre el área desplazable, no dentro del contenido ni en la barra de navegación:
            // dentro del contenido cambia hasta dónde se desplaza la pantalla con el texto más grande (la auditoría deja de ver
            // lo mismo), y la barra limita el control a 36 pt y no escala con Dynamic Type.
            VStack(spacing: 0) {
                BotonEscenario(modelo: modelo)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)

                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        if avisoModoPruebas { AvisoModoPruebas() }

                        Text(resumenServidor)
                            .font(.footnote)
                            .foregroundStyle(.textoSecundario)
                            .accessibilityIdentifier("resumen-servidor")

                        // El resultado va antes del campo: con texto grande queda arriba, a la vista,
                        // y no se desliza bajo la barra de pestañas (que tapa y desdibuja lo que pasa por debajo).
                        ResultadoConsultaVista(modelo: modelo, foco: $foco, alReintentar: reintentar)

                        Text(modelo.escenario.introduccion)
                            .font(.body)
                            .accessibilityIdentifier("introduccion-consulta")

                        // Solo con tamaños de accesibilidad los controles se crean al desplazarse: con texto muy grande
                        // quedan bajo la barra de pestañas y la auditoría los evaluaría sin que se vean. Con tamaños normales
                        // la pila diferida hizo fallar la auditoría de Dynamic Type en el contador y en «Enviar».
                        // El resultado queda fuera para mantener su destino de foco.
                        ContenedorControles(diferido: creacionDiferida) {
                            TextField("Pregunta", text: $modelo.texto, axis: .vertical)
                                .lineLimit(1...5)
                                .textFieldStyle(.roundedBorder)
                                .frame(minHeight: 44)
                                .focused($campoEnfocado)
                                .submitLabel(.send)
                                .onSubmit { enviar() }
                                .accessibilityLabel(modelo.escenario.etiquetaCampo)
                                .accessibilityHint(modelo.escenario.pistaCampo)
                                .accessibilityIdentifier("campo-pregunta")

                            Text("\(modelo.texto.utf16.count) de \(modelo.escenario.maximoCaracteres) caracteres")
                                .font(.footnote)
                                .foregroundStyle(.textoSecundario)
                                .accessibilityIdentifier("contador-caracteres")

                            HStack(spacing: 12) {
                                Button("Enviar") { enviar() }
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
                        }
                    }
                    .padding(16)
                }
                .scrollDismissesKeyboard(.interactively)
                .bordeInferiorLegible()
            }
            .navigationTitle("Consulta")
            .navigationBarTitleDisplayMode(.inline)
            .onChange(of: modelo.estado) { _, nuevo in
                anunciar(nuevo)
            }
        }
        // `TabView` conserva el modelo al cambiar de pestaña: una consulta lenta no
        // debe terminar fuera de pantalla (arquitectura §7). Solo cancela la vigente.
        .onDisappear { modelo.cancelar() }
    }

    /// Cierra el teclado antes de enviar: si no, tapa el resultado y la barra de pestañas.
    private func enviar() {
        campoEnfocado = false
        modelo.enviar()
    }

    private func reintentar() {
        campoEnfocado = false
        modelo.reintentar()
    }

    /// Un anuncio por cambio de estado; el foco pasa al resultado una sola vez.
    private func anunciar(_ estado: EstadoConsulta) {
        let texto: String
        switch estado {
        case .inactiva: return
        case .enviando: texto = "Consultando al servidor."
        case .respuesta(let respuesta):
            var partes = ["Respuesta recibida."]
            if let escenario = modelo.escenarioEnviado.anuncioResultado { partes.append(escenario) }
            if respuesta.catalogo?.antiguo == true { partes.append("Los datos de TransMilenio son antiguos.") }
            texto = partes.joined(separator: " ")
        case .error(let error): texto = "\(error.mensaje) \(error.recuperacion)"
        case .cancelada: texto = "Consulta cancelada."
        }
        AccessibilityNotification.Announcement(texto).post()
        if estado != .enviando { foco = .resultado }
    }
}

/// Selector del escenario Metro, que va aparte del transporte de hoy. Es un interruptor: su texto visible no cambia
/// («Metro (futuro)», lo dice también en voz) y su estado va en el valor de accesibilidad y en la introducción de la
/// pantalla. El anuncio sale solo de aquí: un reintento que restablece el escenario no pisa «Consultando al servidor».
/// El texto escala con Dynamic Type; usa un estilo menor que el cuerpo para que, con el texto más grande, la fila fija
/// deje al área desplazable alto para la introducción entera.
private struct BotonEscenario: View {
    let modelo: ConsultaModelo

    var body: some View {
        Button {
            let nuevo: EscenarioConsulta = modelo.escenario == .metroFuturo ? .transporte : .metroFuturo
            modelo.escenario = nuevo
            AccessibilityNotification.Announcement(nuevo.anuncioAlElegir).post()
        } label: {
            // El área táctil va dentro de la etiqueta: fuera del botón no ampliaría lo que recibe el toque.
            Text("Metro (futuro)")
                .font(.subheadline)
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.bordered)
        .accessibilityValue(modelo.escenario.valorSelector)
        .accessibilityHint(modelo.escenario.pistaSelector)
        .accessibilityIdentifier("boton-escenario")
    }
}

/// Pila de los controles de la consulta: diferida o inmediata, con la misma disposición.
private struct ContenedorControles<Contenido: View>: View {
    let diferido: Bool
    @ViewBuilder let contenido: Contenido

    var body: some View {
        if diferido {
            LazyVStack(alignment: .leading, spacing: 16) { contenido }
        } else {
            VStack(alignment: .leading, spacing: 16) { contenido }
        }
    }
}

private struct ResultadoConsultaVista: View {
    let modelo: ConsultaModelo
    var foco: AccessibilityFocusState<ZonaFocoConsulta?>.Binding
    let alReintentar: () -> Void

    var body: some View {
        switch modelo.estado {
        case .inactiva:
            EmptyView()
        case .enviando:
            ProgressView("Consultando al servidor…")
                .accessibilityIdentifier("progreso-consulta")
        case .respuesta(let respuesta):
            RespuestaVista(
                respuesta: respuesta, escenario: modelo.escenarioEnviado, foco: foco, alReintentar: alReintentar)
        case .error(let error):
            VStack(alignment: .leading, spacing: 8) {
                Label("No se pudo completar", systemImage: "exclamationmark.triangle")
                    .font(.headline)
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityFocused(foco, equals: .resultado)
                Text(error.mensaje).accessibilityIdentifier("mensaje-error")
                Text(error.recuperacion).foregroundStyle(.textoSecundario)
                if error.admiteReintento && modelo.ultimoTextoEnviado != nil {
                    Button("Reintentar") { alReintentar() }
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
                    Button("Reintentar") { alReintentar() }
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
    /// Escenario en que se hizo la pregunta: rotula el resultado.
    let escenario: EscenarioConsulta
    var foco: AccessibilityFocusState<ZonaFocoConsulta?>.Binding
    let alReintentar: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(escenario.tituloResultado, systemImage: escenario == .metroFuturo ? "tram.fill" : "text.bubble")
                .font(.headline)
                .accessibilityAddTraits(.isHeader)
                .accessibilityFocused(foco, equals: .resultado)

            if let aviso = escenario.avisoResultado {
                Text(aviso).accessibilityIdentifier("aviso-metro-futuro")
            }

            if case .viaje(let tramos) = respuesta.accion {
                // El texto del servidor puede traer órdenes de abordaje sin verificar
                // paradas ni vigencia: esta versión no lo presenta (ver README).
                Text(respuesta.accion.limite ?? "")
                    .accessibilityIdentifier("aviso-viaje")
                ForEach(Array(tramos.enumerated()), id: \.offset) { _, tramo in
                    Text(descripcion(tramo))
                }
            } else {
                Text(respuesta.texto).accessibilityIdentifier("texto-respuesta")
                detalleAccion
            }

            if let procedencia = respuesta.procedenciaAparte {
                Text(procedencia).accessibilityIdentifier("procedencia-catalogo")
            }
            if respuesta.catalogo?.antiguo == true { avisoCatalogoAntiguo }

            if !respuesta.pasos.isEmpty && !esViaje {
                Text("Pasos del servidor").font(.subheadline.bold())
                ForEach(Array(respuesta.pasos.enumerated()), id: \.offset) { _, paso in
                    Text(paso.detalle.map { "\(paso.etiqueta): \($0)" } ?? paso.etiqueta)
                        .font(.footnote)
                }
            }
            Text("Interpretada con: \(respuesta.motor.rawValue)")
                .font(.footnote)
                .foregroundStyle(.textoSecundario)
        }
    }

    private var esViaje: Bool {
        if case .viaje = respuesta.accion { return true }
        return false
    }

    /// Dato de la acción y límite de esta app: la web abriría una pantalla que aquí no existe.
    @ViewBuilder private var detalleAccion: some View {
        switch respuesta.accion {
        case .busqueda(let estacion): Text("Estación: \(estacion)")
        case .ruta(let codigo): Text("Ruta: \(codigo)")
        case .ninguna, .frecuentes, .gps, .viaje: EmptyView()
        }
        if let limite = respuesta.accion.limite {
            Text(limite)
                .foregroundStyle(.textoSecundario)
                .accessibilityIdentifier("limite-accion")
        }
    }

    /// El servidor respondió con la copia guardada o con datos vencidos: se dice y se ofrece volver a consultar.
    private var avisoCatalogoAntiguo: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Datos antiguos", systemImage: "clock.arrow.circlepath")
                .font(.subheadline.bold())
            Text("El servidor respondió con datos de TransMilenio que no están actualizados: una copia guardada o una consulta vencida. Vuelve a consultar en unos minutos.")
                .accessibilityIdentifier("aviso-catalogo-antiguo")
            Button("Volver a consultar") { alReintentar() }
                .buttonStyle(.bordered)
                .controlSize(.large)
                .frame(minHeight: 44)
                .accessibilityIdentifier("boton-volver-a-consultar")
        }
    }

    private func descripcion(_ tramo: TramoViaje) -> String {
        let conteo = tramo.conteoVerificado
            ? "\(tramo.estacionesRecorridas) estaciones (conteo verificado)"
            : "número de estaciones no verificado"
        return "Ruta \(tramo.codigoRuta): de \(tramo.estacionAbordaje) a \(tramo.estacionDescenso), \(conteo)."
    }
}
