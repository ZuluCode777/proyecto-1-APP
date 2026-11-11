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
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    // Un solo botón, arriba del todo y antes del aviso de pruebas. La auditoría con el texto más grande
                    // centra la introducción y luego «Enviar»: así lo que queda a la vista en esas posiciones no cambia.
                    // Tampoco crece al pasar al Metro, para que «Enviar» siga por encima del teclado.
                    BotonEscenario(modelo: modelo)

                    if avisoModoPruebas { AvisoModoPruebas() }

                    Text(resumenServidor)
                        .font(.footnote)
                        .foregroundStyle(.textoSecundario)
                        .accessibilityIdentifier("resumen-servidor")

                    // El resultado va antes del campo: con texto grande queda arriba, a la vista,
                    // y no se desliza bajo la barra de pestañas (que tapa y desdibuja lo que pasa por debajo).
                    ResultadoConsultaVista(modelo: modelo, foco: $foco, alReintentar: reintentar)

                    Text(esMetro
                        ? "Escenario futuro: el Metro de Bogotá aún no presta servicio. Pregunta por una estación o una línea; el texto se envía al servidor."
                        : "Escribe una pregunta de transporte. El texto se envía al servidor configurado; no se envía tu ubicación.")
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
                            .accessibilityLabel(esMetro ? "Pregunta sobre el Metro, escenario futuro" : "Pregunta de transporte")
                            .accessibilityHint(pistaCampo)
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
            .navigationTitle("Consulta")
            .navigationBarTitleDisplayMode(.inline)
            .scrollDismissesKeyboard(.interactively)
            .bordeInferiorLegible()
            .onChange(of: modelo.estado) { _, nuevo in
                anunciar(nuevo)
            }
            .onChange(of: modelo.escenario) { _, nuevo in
                let texto: String = nuevo == .metroFuturo
                    ? "Escenario Metro: futuro, sin servicio. Las respuestas son información del proyecto, no un viaje."
                    : "Escenario de transporte de hoy."
                AccessibilityNotification.Announcement(texto).post()
            }
        }
        // `TabView` conserva el modelo al cambiar de pestaña: una consulta lenta no
        // debe terminar fuera de pantalla (arquitectura §7). Solo cancela la vigente.
        .onDisappear { modelo.cancelar() }
    }

    private var esMetro: Bool { modelo.escenario == .metroFuturo }

    /// Sin permiso de ubicación que pedir ni denegar: el origen de un viaje se escribe en la pregunta.
    private var pistaCampo: String {
        let maximo = "Máximo \(modelo.escenario.maximoCaracteres) caracteres."
        return esMetro ? maximo : maximo + " Para un viaje, escribe también desde dónde sales: la app no usa tu ubicación."
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
            if modelo.escenarioEnviado == .metroFuturo { partes.append("Metro de Bogotá: escenario futuro, sin servicio.") }
            if respuesta.catalogo?.antiguo == true { partes.append("Los datos de TransMilenio son antiguos.") }
            texto = partes.joined(separator: " ")
        case .error(let error): texto = "\(error.mensaje) \(error.recuperacion)"
        case .cancelada: texto = "Consulta cancelada."
        }
        AccessibilityNotification.Announcement(texto).post()
        if estado != .enviando { foco = .resultado }
    }
}

/// Cambia de escenario. El Metro va aparte del transporte de hoy y siempre rotulado como futuro, en pantalla
/// y para VoiceOver. Es el mismo botón con otro rótulo, así el foco no se pierde al cambiar.
private struct BotonEscenario: View {
    let modelo: ConsultaModelo

    var body: some View {
        let esMetro = modelo.escenario == .metroFuturo
        Button(esMetro ? "Volver a transporte de hoy" : "Preguntar por el Metro (futuro)") {
            modelo.escenario = esMetro ? .transporte : .metroFuturo
        }
        .buttonStyle(.bordered)
        .controlSize(.large)
        .frame(minHeight: 44)
        .accessibilityValue(esMetro ? "Escenario actual: Metro, futuro y sin servicio" : "Escenario actual: transporte de hoy")
        .accessibilityHint(esMetro ? "" : "El Metro de Bogotá todavía no presta servicio. Cambia la consulta a información del proyecto.")
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
                respuesta: respuesta, esMetro: modelo.escenarioEnviado == .metroFuturo, foco: foco,
                alReintentar: alReintentar)
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
    /// La pregunta se hizo en el escenario del Metro: el resultado se rotula como futuro.
    let esMetro: Bool
    var foco: AccessibilityFocusState<ZonaFocoConsulta?>.Binding
    let alReintentar: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(esMetro ? "Metro de Bogotá: escenario futuro" : "Respuesta", systemImage: esMetro ? "tram.fill" : "text.bubble")
                .font(.headline)
                .accessibilityAddTraits(.isHeader)
                .accessibilityFocused(foco, equals: .resultado)

            if esMetro {
                Text("Información de un proyecto que todavía no presta servicio. No es un viaje ni una ruta en servicio.")
                    .accessibilityIdentifier("aviso-metro-futuro")
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
