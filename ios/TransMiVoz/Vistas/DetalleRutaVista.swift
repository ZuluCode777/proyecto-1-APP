import SwiftUI

/// Zona de foco de VoiceOver de las pantallas de rutas: al terminar una carga, el foco pasa al resultado o al error.
enum ZonaFocoRutas: Hashable { case resultado }

/// Detalle de una ruta: sentido, horario, estaciones y mapa del MISMO recorrido. El servidor decide cada estado
/// (`sentido`, `calendario`, `paradaVerificada`); aquí solo se dicen. Lo esencial está en el listado, no en el mapa.
struct DetalleRutaVista: View {
    let servicios: ServiciosRutas
    @State private var modelo: DetalleRutaModelo
    @AccessibilityFocusState private var foco: ZonaFocoRutas?

    init(servicios: ServiciosRutas, codigo: String) {
        self.servicios = servicios
        _modelo = State(initialValue: DetalleRutaModelo(codigo: codigo, cliente: servicios.cliente))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                switch modelo.estado {
                case .inactivo:
                    EmptyView()
                case .cargando:
                    ProgressView(TextoRutas.cargandoDetalle)
                        .accessibilityIdentifier("progreso-detalle-ruta")
                case .fallo(let error):
                    ErrorRutasVista(error: error, foco: $foco, alReintentar: { modelo.cargar() })
                case .listo(let detalle):
                    contenido(detalle)
                }
            }
            .padding(16)
        }
        .navigationTitle(TextoRutas.tituloDetalle(modelo.codigo))
        .navigationBarTitleDisplayMode(.inline)
        .bordeInferiorLegible()
        .task { modelo.cargarSiHaceFalta() }
        .onChange(of: modelo.estado) { _, nuevo in
            switch nuevo {
            case .listo:
                AccessibilityNotification.Announcement("Ruta cargada.").post()
                foco = .resultado
            case .fallo(let error):
                AccessibilityNotification.Announcement("\(error.mensaje) \(error.recuperacion)").post()
                foco = .resultado
            case .inactivo, .cargando:
                break
            }
        }
    }

    @ViewBuilder private func contenido(_ detalle: DetalleRuta) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(TextoRutas.tituloDetalle(detalle.codigo))
                .font(.title2.bold())
                .accessibilityAddTraits(.isHeader)
                .accessibilityFocused($foco, equals: .resultado)
                .accessibilityIdentifier("detalle-ruta-titulo")
            Text(TextoRutas.trayecto(detalle.desde, detalle.hacia))
                .accessibilityIdentifier("detalle-ruta-trayecto")
            if !detalle.etiqueta.isEmpty && detalle.etiqueta != detalle.codigo {
                Text(detalle.etiqueta).foregroundStyle(.textoSecundario)
            }
        }

        ForEach(Array(TextoRutas.avisoSentido(detalle.sentido, desde: detalle.desde, hacia: detalle.hacia).enumerated()), id: \.offset) { _, frase in
            Text(frase).accessibilityIdentifier("aviso-sentido")
        }

        CatalogoVista(catalogo: detalle.catalogo, alVolverAConsultar: { modelo.cargar() })

        BotonFavorita(codigo: detalle.codigo, favoritas: servicios.favoritas)

        MapaRecorridoVista(
            elementos: .de(detalle: detalle), etiqueta: TextoRutas.etiquetaMapaRuta(detalle.codigo),
            modoPruebas: servicios.modoPruebas)

        VStack(alignment: .leading, spacing: 8) {
            Text(TextoRutas.tituloHorario).font(.title3.bold()).accessibilityAddTraits(.isHeader)
            ForEach(Array(TextoRutas.frasesCalendario(detalle.calendario).enumerated()), id: \.offset) { _, frase in
                Text(frase).foregroundStyle(.textoSecundario).accessibilityIdentifier("frase-calendario")
            }
            Text(TextoRutas.filaHorario("Lunes a viernes", detalle.horario.entreSemana))
            Text(TextoRutas.filaHorario("Sábados", detalle.horario.sabado))
            Text(TextoRutas.filaHorario("Festivos", detalle.horario.festivo))
        }

        let hayVerificadas = detalle.estaciones.contains(where: \.paradaVerificada)
        VStack(alignment: .leading, spacing: 8) {
            Text(TextoRutas.tituloEstaciones(detalle.estaciones.count))
                .font(.title3.bold())
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("titulo-estaciones")
            ForEach(Array(TextoRutas.notaEstaciones(conVerificadas: hayVerificadas).enumerated()), id: \.offset) { _, frase in
                Text(frase).foregroundStyle(.textoSecundario)
            }
            LazyVStack(alignment: .leading, spacing: 8) {
                ForEach(Array(detalle.estaciones.enumerated()), id: \.offset) { indice, estacion in
                    VStack(alignment: .leading, spacing: 2) {
                        Text(TextoRutas.filaEstacion(indice + 1, estacion.nombre))
                        if estacion.paradaVerificada {
                            Text(TextoRutas.paradaVerificada).font(.footnote.bold())
                        }
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityIdentifier("estacion-\(indice + 1)")
                }
            }
        }
    }
}

/// Guardar o quitar la ruta de las favoritas del iPhone (las mismas de Ajustes ▸ Favoritas). El cambio se anuncia.
private struct BotonFavorita: View {
    let codigo: String
    let favoritas: FavoritasModelo

    var body: some View {
        let guardada = favoritas.contiene(codigo)
        Button {
            if guardada {
                favoritas.quitar(codigo)
                AccessibilityNotification.Announcement(
                    TextoFavoritas.quitada(codigo, quedan: favoritas.codigos.count)).post()
            } else {
                favoritas.agregar(codigo)
                AccessibilityNotification.Announcement(
                    TextoRutas.guardada(codigo, total: favoritas.codigos.count)).post()
            }
        } label: {
            Label(guardada ? TextoRutas.quitar : TextoRutas.guardar, systemImage: guardada ? "heart.fill" : "heart")
                .frame(minHeight: 44)
        }
        .buttonStyle(.bordered)
        .controlSize(.large)
        .accessibilityLabel(guardada ? TextoRutas.etiquetaQuitar(codigo) : TextoRutas.etiquetaGuardar(codigo))
        .accessibilityIdentifier("boton-favorita")
    }
}

/// Procedencia del catálogo y, si el servidor la marca antigua, el aviso con «Volver a consultar».
struct CatalogoVista: View {
    let catalogo: ProcedenciaCatalogo
    let alVolverAConsultar: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(catalogo.procedencia)
                .font(.footnote)
                .foregroundStyle(.textoSecundario)
                .accessibilityIdentifier("procedencia-catalogo")
            if catalogo.antiguo {
                Label("Datos antiguos", systemImage: "clock.arrow.circlepath").font(.subheadline.bold())
                Text(TextoRutas.catalogoAntiguo).accessibilityIdentifier("aviso-catalogo-antiguo")
                Text(TextoRutas.catalogoAntiguoAyuda)
                Button(TextoRutas.volverAConsultar) { alVolverAConsultar() }
                    .buttonStyle(.bordered)
                    .controlSize(.large)
                    .frame(minHeight: 44)
                    .accessibilityIdentifier("boton-volver-a-consultar-rutas")
            }
        }
    }
}

/// Error de una petición del planificador, con su recuperación y, si tiene sentido, «Reintentar».
struct ErrorRutasVista: View {
    let error: ErrorConsulta
    var foco: AccessibilityFocusState<ZonaFocoRutas?>.Binding
    let alReintentar: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("No se pudo completar", systemImage: "exclamationmark.triangle")
                .font(.headline)
                .accessibilityAddTraits(.isHeader)
                .accessibilityFocused(foco, equals: .resultado)
            Text(error.mensaje).accessibilityIdentifier("mensaje-error-rutas")
            Text(error.recuperacion).foregroundStyle(.textoSecundario)
            if error.admiteReintento {
                Button("Reintentar") { alReintentar() }
                    .buttonStyle(.bordered)
                    .controlSize(.large)
                    .frame(minHeight: 44)
                    .accessibilityIdentifier("boton-reintentar-rutas")
            }
        }
    }
}
