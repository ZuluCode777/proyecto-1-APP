import SwiftUI
import UIKit

/// Lupa de la cámara: imagen en vivo ampliada, con filtros de color y congelado. Solo amplía la imagen: no
/// reconoce ni describe nada de lo que aparece en ella, y la imagen no se guarda ni se envía.
///
/// La cámara solo está abierta con la pestaña a la vista y la escena activa: al salir o al pasar a segundo plano
/// el modelo la suelta. `avisoSintetico` rotula la cámara sintética de las pruebas de interfaz.
struct LupaVista: View {
    let modelo: LupaModelo
    var avisoSintetico = false

    @Environment(\.scenePhase) private var faseEscena
    @Environment(\.openURL) private var abrirURL

    var body: some View {
        NavigationStack {
            ScrollView {
                // Pila ansiosa, como en el resto de pantallas: todos los elementos existen siempre, con su marco real.
                VStack(alignment: .leading, spacing: 16) {
                    if avisoSintetico {
                        Label(TextoLupa.fuenteSintetica, systemImage: "testtube.2")
                            .font(.footnote)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier("aviso-camara-sintetica")
                    }
                    contenido
                }
                .padding(16)
            }
            .navigationTitle("Lupa")
            .navigationBarTitleDisplayMode(.inline)
            .bordeInferiorLegible()
        }
        .onAppear {
            modelo.escenaActiva(faseEscena == .active)
            modelo.pantallaVisible(true)
        }
        .onDisappear { modelo.pantallaVisible(false) }
        .onChange(of: faseEscena) { _, nueva in modelo.escenaActiva(nueva == .active) }
    }

    @ViewBuilder private var contenido: some View {
        switch modelo.estado {
        case .iniciando, .activa:
            visor
            if modelo.estado == .activa {
                seccionFiltros
                seccionAumento
                botonCongelar
            }
        case .permisoPorPedir:
            seccionExplicacionPermiso
        case .permisoDenegado, .permisoRestringido:
            mensaje
            Button("Abrir Ajustes") {
                if let url = URL(string: UIApplication.openSettingsURLString) { abrirURL(url) }
            }
            .buttonStyle(.bordered)
            .controlSize(.large)
            .frame(minHeight: 44)
            .accessibilityIdentifier("boton-abrir-ajustes-camara")
        case .error:
            mensaje
            Button("Reintentar") { modelo.reintentar() }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .frame(minHeight: 44)
                .accessibilityIdentifier("boton-reintentar-camara")
        case .enPausa, .sinCamara, .pidiendoPermiso:
            mensaje
        }
    }

    private var mensaje: some View {
        Text(TextoLupa.descripcion(modelo.estado))
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityIdentifier("estado-lupa")
    }

    // MARK: Permiso

    /// Un `Text` por párrafo, con la misma fuente, para que con el texto más grande cada uno quepa a la vista.
    private var seccionExplicacionPermiso: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(Array(TextoLupa.parrafosPermiso.enumerated()), id: \.offset) { posicion, parrafo in
                Text(parrafo)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier(posicion == 0 ? "texto-permiso-camara" : "texto-permiso-camara-\(posicion)")
            }
            Button("Continuar") { modelo.continuarTrasExplicacion() }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
                .frame(minHeight: 44)
                .accessibilityIdentifier("boton-permiso-camara-continuar")
            Text(TextoLupa.permisoAlternativa)
                .font(.footnote)
                .foregroundStyle(.textoSecundario)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: Imagen

    private var visor: some View {
        VisorCamara(capa: modelo.capa)
            .frame(maxWidth: .infinity)
            .frame(height: 320)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay {
                if modelo.estado == .iniciando {
                    Text(TextoLupa.descripcion(.iniciando))
                        .font(.headline)
                        .foregroundStyle(.white)
                        .multilineTextAlignment(.center)
                        .padding(12)
                }
            }
            .overlay(alignment: .topLeading) {
                // Con texto y símbolo, no solo con un cambio de la imagen.
                if modelo.congelada {
                    Label("Congelada", systemImage: "pause.fill")
                        .font(.headline)
                        .foregroundStyle(.white)
                        .padding(8)
                        .background(.black, in: Capsule())
                        .padding(8)
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(TextoLupa.visor)
            .accessibilityValue(valorVisor)
            .accessibilityIdentifier("visor-lupa")
    }

    private var valorVisor: String {
        guard modelo.estado == .activa else { return TextoLupa.descripcion(.iniciando) }
        return modelo.congelada ? TextoLupa.imagenCongelada : TextoLupa.imagenEnVivo
    }

    // MARK: Controles

    private var seccionFiltros: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Modo de color")
                .font(.headline)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("encabezado-filtros-lupa")
            ForEach(FiltroLupa.allCases) { filtro in
                let elegido = filtro == modelo.filtro
                // La elección se ve por la marca y por el relleno, no solo por el color.
                Button { modelo.fijarFiltro(filtro) } label: {
                    Label(filtro.nombre, systemImage: elegido ? "checkmark.circle.fill" : "circle")
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .accion(prominente: elegido, disponible: true)
                .controlSize(.large)
                .frame(minHeight: 44)
                .accessibilityAddTraits(elegido ? .isSelected : [])
                .accessibilityIdentifier("filtro-\(filtro.rawValue)")
            }
        }
    }

    private var seccionAumento: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Acercar la imagen")
                .font(.headline)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("encabezado-aumento-lupa")
            if modelo.puedeAcercar {
                Slider(
                    value: Binding(get: { modelo.aumento }, set: { modelo.fijarAumento($0) }),
                    in: modelo.aumentoMinimo...modelo.aumentoMaximo,
                    step: LupaModelo.pasoAumento)
                    .frame(minHeight: 44)
                    .accessibilityLabel("Acercar la imagen")
                    .accessibilityValue(TextoLupa.aumento(modelo.aumento))
                    .accessibilityIdentifier("control-aumento")
            }
            // El valor ya lo dice el control; el texto es solo para quien ve la pantalla.
            Text(modelo.puedeAcercar ? TextoLupa.aumento(modelo.aumento) : "Esta cámara no acerca más.")
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityHidden(modelo.puedeAcercar)
                .accessibilityIdentifier("valor-aumento")
        }
    }

    private var botonCongelar: some View {
        Button { modelo.alternarCongelada() } label: {
            Label(modelo.congelada ? "Reanudar" : "Congelar imagen", systemImage: modelo.congelada ? "play.fill" : "pause.fill")
                .frame(maxWidth: .infinity)
        }
        .accion(prominente: true, disponible: true)
        .controlSize(.large)
        .frame(minHeight: 44)
        .accessibilityIdentifier("boton-congelar")
    }
}

/// Aloja la capa donde la cámara pinta la imagen. La cámara es dueña de la capa; la vista solo la coloca.
private struct VisorCamara: UIViewRepresentable {
    let capa: CALayer

    func makeUIView(context: Context) -> VistaDeCapa { VistaDeCapa(capa: capa) }
    func updateUIView(_ vista: VistaDeCapa, context: Context) {}
}

private final class VistaDeCapa: UIView {
    private let capa: CALayer

    init(capa: CALayer) {
        self.capa = capa
        super.init(frame: .zero)
        layer.addSublayer(capa)
    }

    @available(*, unavailable) required init?(coder: NSCoder) { fatalError("No se crea desde un storyboard") }

    override func layoutSubviews() {
        super.layoutSubviews()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        capa.frame = bounds
        CATransaction.commit()
    }
}
