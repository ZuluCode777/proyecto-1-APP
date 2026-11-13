import SwiftUI

/// Pantallas que el Inicio abre dentro de su propia pila de navegación (la pestaña sigue siendo Inicio y el botón «atrás»
/// vuelve a él). «Asistente» no está aquí: abre la pestaña Consulta.
enum DestinoInicio: Hashable {
    case rutas, lupa, gps, metro, emergencia
}

/// Inicio de la app: lo que la web llama `PartialHome`, con la cabecera y las seis baldosas. Es la primera pestaña y la de
/// partida. Según el modo (`EntornoApp.modo`), las baldosas de Baja visión o, para Ceguera total, `AgenteTotalVista`.
///
/// Dónde enchufar una pantalla nueva: una pantalla de una baldosa se arma con `EncabezadoPantalla` y se cablea en
/// `pantalla(_:)` de abajo; si no cabe en un destino de esta pila (otra pestaña), se cambia `pestana` como hace el Asistente.
struct InicioVista: View {
    let entorno: EntornoApp
    /// Pestaña elegida de `RaizVista`: el Asistente y la campana de avisos la cambian.
    @Binding var pestana: PestanaRaiz
    let abrirMenuModo: () -> Void

    @State private var camino: [DestinoInicio] = []

    var body: some View {
        NavigationStack(path: $camino) {
            contenido
                // El título solo da nombre al botón «atrás» de las pantallas que se abren desde aquí: la barra muestra
                // el nombre de la app con su ficha (`EncabezadoApp`).
                .navigationTitle(TextoInicio.nombreApp)
                .navigationBarTitleDisplayMode(.inline)
                .toolbar { EncabezadoApp(alAbrirMenu: abrirMenuModo, alAbrirAvisos: { pestana = .avisos }) }
                .tint(Paleta.foreground)
                .navigationDestination(for: DestinoInicio.self) { destino in pantalla(destino) }
        }
        // La cámara de la lupa solo está abierta con la pantalla a la vista. `onDisappear` de la lupa ya la suelta al cambiar
        // de pestaña; esto lo repite desde aquí por si el sistema no avisa a una pantalla empujada, y la reabre al volver.
        .onChange(of: pestana) { _, nueva in
            guard camino.last == .lupa else { return }
            entorno.lupa.pantallaVisible(nueva == .inicio)
        }
    }

    // MARK: Contenido según el modo

    @ViewBuilder private var contenido: some View {
        switch entorno.modo.modo {
        case .parcial: baldosas
        // GANCHO del Inicio de voz: la tarea de Ceguera total reemplaza `AgenteTotalVista`.
        case .total: AgenteTotalVista()
        }
    }

    private var baldosas: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text(TextoInicio.pregunta)
                    .font(.jakarta(.extrabold, .xl2))
                    .foregroundStyle(Paleta.foreground)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Paleta.bar, in: RoundedRectangle(cornerRadius: Tema.radio2XL))
                    .overlay(RoundedRectangle(cornerRadius: Tema.radio2XL).strokeBorder(Paleta.border, lineWidth: Tema.borde))
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityIdentifier("inicio-titulo")
                ForEach(OpcionInicio.allCases) { opcion in
                    BaldosaWeb(
                        titulo: opcion.titulo, pista: opcion.pista, simbolo: opcion.simbolo,
                        relleno: opcion.relleno, tinta: opcion.tinta,
                        colorBorde: opcion.colorBorde, anchoBorde: opcion.anchoBorde,
                        identificador: opcion.identificador
                    ) { abrir(opcion) }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 12)
            .padding(.bottom, 16)
        }
        .bordeInferiorLegible()
    }

    // MARK: Navegación

    private func abrir(_ opcion: OpcionInicio) {
        switch opcion {
        case .asistente: pestana = .consulta
        case .rutas: camino.append(.rutas)
        case .gps: camino.append(.gps)
        case .metro: camino.append(.metro)
        case .lupa: camino.append(.lupa)
        case .emergencia: camino.append(.emergencia)
        }
    }

    @ViewBuilder private func pantalla(_ destino: DestinoInicio) -> some View {
        switch destino {
        case .rutas: RutasVista(servicios: entorno.serviciosRutas)
        case .lupa: LupaVista(modelo: entorno.lupa, avisoSintetico: entorno.modoPruebas)
        case .gps: GpsAuditivoVista()
        case .metro: MetroVista()
        case .emergencia: EmergenciaVista()
        }
    }
}

/// Lo que solo la vista sabe de cada opción: ícono, colores y contorno. Los textos están en `OpcionInicio` (`TextoInicio`).
extension OpcionInicio {
    /// SF Symbol más cercano al ícono de lucide de la web.
    var simbolo: String {
        switch self {
        case .asistente: return "bubble.left.and.text.bubble.right"
        case .rutas: return "bus"
        case .gps: return "map"
        case .metro: return "tram"
        case .lupa: return "text.viewfinder"
        case .emergencia: return "phone.fill"
        }
    }

    /// Un color distinto por baldosa, sin repetir el de la cabecera (`fill-*` de la web).
    var relleno: Color {
        switch self {
        case .asistente: return Paleta.fillAgent
        case .rutas: return Paleta.fillRoutes
        case .gps: return Paleta.fillMap
        case .metro: return Paleta.brandSoft
        case .lupa: return Paleta.fillLens
        case .emergencia: return Paleta.sos
        }
    }

    var tinta: Color { self == .emergencia ? Paleta.sosForeground : Paleta.foreground }
    var colorBorde: Color { self == .emergencia ? Paleta.sosBorder : Paleta.border }
    /// Emergencia lleva el contorno más grueso.
    var anchoBorde: CGFloat { self == .emergencia ? Tema.bordeEmergencia : Tema.borde }
}
