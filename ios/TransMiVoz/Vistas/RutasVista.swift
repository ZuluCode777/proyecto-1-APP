import SwiftUI

/// Buscar rutas por código o estación (el mismo `searchRoutes` que la web, en el servidor) y abrir su detalle. Desde
/// aquí también se llega a planear un viaje entre dos lugares elegidos. No usa la ubicación.
struct RutasVista: View {
    let servicios: ServiciosRutas
    @State private var modelo: BusquedaRutasModelo
    /// Con una consulta inicial (viene de una respuesta de estación) busca al abrirse.
    private let buscaAlAbrir: Bool

    @AccessibilityFocusState private var foco: ZonaFocoRutas?
    @FocusState private var campoEnfocado: Bool

    init(servicios: ServiciosRutas, consultaInicial: String? = nil) {
        self.servicios = servicios
        self.buscaAlAbrir = consultaInicial != nil
        _modelo = State(initialValue: BusquedaRutasModelo(cliente: servicios.cliente, consultaInicial: consultaInicial))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                NavigationLink {
                    ViajeVista(servicios: servicios)
                } label: {
                    Label(TextoRutas.enlaceViaje, systemImage: "arrow.triangle.turn.up.right.diamond")
                        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                }
                .buttonStyle(.bordered)
                .controlSize(.large)
                .accessibilityHint(TextoRutas.pistaEnlaceViaje)
                .accessibilityIdentifier("enlace-viaje")

                Text(TextoRutas.introduccionBusqueda).accessibilityIdentifier("introduccion-rutas")
                Text(TextoRutas.sinUbicacion).font(.footnote).foregroundStyle(.textoSecundario)

                TextField(TextoRutas.etiquetaCampo, text: $modelo.texto)
                    .textFieldStyle(.roundedBorder)
                    .frame(minHeight: 44)
                    .focused($campoEnfocado)
                    .submitLabel(.search)
                    .onSubmit { buscar() }
                    .accessibilityLabel(TextoRutas.etiquetaCampo)
                    .accessibilityHint(TextoRutas.pistaCampo)
                    .accessibilityIdentifier("campo-busqueda-rutas")

                if let aviso = modelo.avisoEntrada {
                    Text(aviso).accessibilityIdentifier("aviso-entrada-rutas")
                }

                Button(TextoRutas.botonBuscar) { buscar() }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .frame(minHeight: 44)
                    .disabled(modelo.estado == .cargando)
                    .accessibilityIdentifier("boton-buscar-rutas")

                resultado
            }
            .padding(16)
        }
        .scrollDismissesKeyboard(.interactively)
        .navigationTitle(TextoRutas.titulo)
        .navigationBarTitleDisplayMode(.inline)
        .bordeInferiorLegible()
        .task {
            if buscaAlAbrir, modelo.estado == .inactivo { buscar() }
        }
        .onChange(of: modelo.estado) { _, nuevo in anunciar(nuevo) }
    }

    @ViewBuilder private var resultado: some View {
        switch modelo.estado {
        case .inactivo:
            EmptyView()
        case .cargando:
            ProgressView(TextoRutas.consultando).accessibilityIdentifier("progreso-busqueda-rutas")
        case .fallo(let error):
            ErrorRutasVista(error: error, foco: $foco, alReintentar: { campoEnfocado = false; modelo.reintentar() })
        case .listo(let encontradas):
            resultados(encontradas)
        }
    }

    @ViewBuilder private func resultados(_ encontradas: ResultadoBusquedaRutas) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(encontradas.rutas.isEmpty
                 ? TextoRutas.sinResultados(modelo.ultimaConsulta ?? "")
                 : TextoRutas.resumenBusqueda(mostradas: encontradas.rutas.count, total: encontradas.total))
                .font(.headline)
                .accessibilityAddTraits(.isHeader)
                .accessibilityFocused($foco, equals: .resultado)
                .accessibilityIdentifier("resumen-busqueda-rutas")
            if encontradas.rutas.isEmpty {
                Text(TextoRutas.sinResultadosAyuda).accessibilityIdentifier("ayuda-sin-resultados")
            } else if encontradas.total > encontradas.rutas.count {
                Text(TextoRutas.acotarBusqueda)
            }
        }
        ForEach(Array(encontradas.rutas.enumerated()), id: \.offset) { _, ruta in
            NavigationLink {
                DetalleRutaVista(servicios: servicios, codigo: ruta.codigo)
            } label: {
                VStack(alignment: .leading, spacing: 4) {
                    Text(TextoRutas.tituloDetalle(ruta.codigo)).font(.headline)
                    Text(TextoRutas.trayecto(ruta.desde, ruta.hacia))
                }
                .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                .padding(12)
                .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Color.textoSecundario, lineWidth: 1))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .combine)
            .accessibilityLabel(TextoRutas.etiquetaRuta(ruta))
            .accessibilityHint("Abre el detalle y el mapa de la ruta.")
            .accessibilityIdentifier("ruta-\(ruta.codigo)")
        }
        CatalogoVista(catalogo: encontradas.catalogo, alVolverAConsultar: { modelo.reintentar() })
    }

    /// Cierra el teclado antes de buscar: si no, tapa el resultado y la barra de pestañas.
    private func buscar() {
        campoEnfocado = false
        modelo.buscar()
    }

    /// Un anuncio por cambio de estado; el foco pasa al resultado una sola vez.
    private func anunciar(_ estado: EstadoCarga<ResultadoBusquedaRutas>) {
        let texto: String
        switch estado {
        case .inactivo: return
        case .cargando: texto = TextoRutas.consultando
        case .listo(let encontradas):
            texto = encontradas.rutas.isEmpty
                ? TextoRutas.sinResultados(modelo.ultimaConsulta ?? "")
                : TextoRutas.resumenBusqueda(mostradas: encontradas.rutas.count, total: encontradas.total)
        case .fallo(let error): texto = "\(error.mensaje) \(error.recuperacion)"
        }
        AccessibilityNotification.Announcement(texto).post()
        if estado != .cargando { foco = .resultado }
    }
}
