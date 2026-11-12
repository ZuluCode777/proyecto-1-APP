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
    @AccessibilityFocusState private var foco: ZonaFocoLupa?

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
            // La explicación del permiso va en una hoja propia, justo antes del aviso del sistema (EA-02 §8).
            .sheet(isPresented: Binding(
                get: { modelo.estado == .permisoPorPedir },
                set: { if !$0 { modelo.posponerPermiso() } })
            ) {
                HojaPermisoCamara(
                    continuar: { modelo.continuarTrasExplicacion() },
                    ahoraNo: { modelo.posponerPermiso() })
            }
        }
        .onAppear {
            modelo.escenaActiva(faseEscena == .active)
            modelo.pantallaVisible(true)
        }
        .onDisappear { modelo.pantallaVisible(false) }
        .onChange(of: faseEscena) { _, nueva in modelo.escenaActiva(nueva == .active) }
        .onChange(of: modelo.estado) { anterior, nuevo in moverFoco(de: anterior, a: nuevo) }
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
        case .permisoPorPedir, .permisoPospuesto:
            mensaje
            if modelo.estado == .permisoPospuesto {
                Button(TextoLupa.activarLupa) { modelo.retomarPermiso() }
                    .botonDeLupa(prominente: true)
                    .accessibilityIdentifier("boton-activar-lupa")
            }
        case .permisoDenegado, .permisoRestringido:
            mensaje
            Button("Abrir Ajustes") {
                if let url = URL(string: UIApplication.openSettingsURLString) { abrirURL(url) }
            }
            .botonDeLupa(prominente: false)
            .accessibilityIdentifier("boton-abrir-ajustes-camara")
        case .error:
            mensaje
            Button("Reintentar") { modelo.reintentar() }
                .botonDeLupa(prominente: true)
                .accessibilityIdentifier("boton-reintentar-camara")
        case .enPausa, .sinCamara, .pidiendoPermiso:
            mensaje
        }
    }

    private var mensaje: some View {
        Text(TextoLupa.descripcion(modelo.estado))
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityFocused($foco, equals: .mensaje)
            .accessibilityIdentifier("estado-lupa")
    }

    /// Si el botón que se acaba de tocar desaparece («Continuar», «Reintentar») o un estado llega sin que la persona lo
    /// pida (la cámara falla), el foco de VoiceOver va a lo que lo sustituye y no queda sin destino (EA-02 §1 y §7).
    /// Con la pestaña recién abierta no se mueve: eso lo decide la propia navegación.
    private func moverFoco(de anterior: EstadoLupa, a nuevo: EstadoLupa) {
        switch nuevo {
        case .iniciando where anterior == .pidiendoPermiso || anterior == .error:
            foco = .visor
        case .permisoDenegado, .permisoRestringido, .permisoPospuesto, .error:
            if anterior != .enPausa { foco = .mensaje }
        default:
            break
        }
    }

    // MARK: Imagen

    private var visor: some View {
        VisorCamara(capa: modelo.capa)
            .frame(maxWidth: .infinity)
            // Proporción y no alto fijo: la imagen no depende del tamaño del texto (EA-02 §2).
            .aspectRatio(4.0 / 3.0, contentMode: .fit)
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
            // La imagen de la cámara no se invierte con «Invertir colores» (EA-02 §6); tampoco lo que la rotula.
            .accessibilityIgnoresInvertColors(true)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(TextoLupa.visor)
            .accessibilityValue(valorVisor)
            .accessibilityFocused($foco, equals: .visor)
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
                .botonDeLupa(prominente: elegido)
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
                    in: modelo.aumentoPiso...modelo.aumentoMaximo,
                    step: LupaModelo.pasoAumento)
                    .frame(minHeight: 44)
                    .accessibilityLabel("Acercar la imagen")
                    .accessibilityValue(TextoLupa.aumento(modelo.aumento))
                    .accessibilityHint(modelo.congelada ? TextoLupa.acercarCongelada : "")
                    .accessibilityIdentifier("control-aumento")
            }
            // El valor ya lo dice el control; el texto es solo para quien ve la pantalla.
            Text(modelo.puedeAcercar ? TextoLupa.aumento(modelo.aumento) : TextoLupa.sinMasAumento)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityHidden(modelo.puedeAcercar)
                .accessibilityIdentifier("valor-aumento")
            if modelo.congelada && modelo.puedeAcercar {
                // Para quien ve la pantalla: VoiceOver ya lo lee como pista del control.
                Text(TextoLupa.acercarCongelada)
                    .font(.footnote)
                    .foregroundStyle(.textoSecundario)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityHidden(true)
            }
        }
    }

    private var botonCongelar: some View {
        Button { modelo.alternarCongelada() } label: {
            Label(modelo.congelada ? "Reanudar" : "Congelar imagen", systemImage: modelo.congelada ? "play.fill" : "pause.fill")
                .frame(maxWidth: .infinity)
        }
        .botonDeLupa(prominente: true)
        .accessibilityIdentifier("boton-congelar")
    }
}

/// A dónde va el foco de VoiceOver cuando cambia el estado de la lupa.
private enum ZonaFocoLupa: Hashable {
    case visor
    case mensaje
}

/// Explicación del permiso de la cámara ANTES del aviso del sistema (EA-02 §8), con una salida sin permiso.
private struct HojaPermisoCamara: View {
    let continuar: () -> Void
    let ahoraNo: () -> Void

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    // Un `Text` por párrafo, con la misma fuente, para que con el texto más grande cada uno quepa a la vista.
                    ForEach(Array(TextoLupa.parrafosPermiso.enumerated()), id: \.offset) { posicion, parrafo in
                        Text(parrafo)
                            .fixedSize(horizontal: false, vertical: true)
                            .accessibilityIdentifier(posicion == 0 ? "texto-permiso-camara" : "texto-permiso-camara-\(posicion)")
                    }
                    Button("Continuar", action: continuar)
                        .botonDeLupa(prominente: true)
                        .accessibilityIdentifier("boton-permiso-camara-continuar")
                    Button("Ahora no", action: ahoraNo)
                        .botonDeLupa(prominente: false)
                        .accessibilityIdentifier("boton-permiso-camara-ahora-no")
                    Text(TextoLupa.permisoAlternativa)
                        .font(.footnote)
                        .foregroundStyle(.textoSecundario)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(16)
            }
            .navigationTitle(TextoLupa.tituloPermiso)
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}

private extension View {
    /// Botón de la lupa: del estilo de la casa (`accion`), grande y de al menos 44 pt de alto.
    func botonDeLupa(prominente: Bool) -> some View {
        accion(prominente: prominente, disponible: true)
            .controlSize(.large)
            .frame(minHeight: 44)
    }
}

/// Aloja la capa donde la cámara pinta la imagen. La cámara es dueña de la capa; la vista solo la coloca.
private struct VisorCamara: UIViewRepresentable {
    let capa: CALayer

    func makeUIView(context: Context) -> VistaDeCapa { VistaDeCapa(capa: capa) }
    func updateUIView(_ vista: VistaDeCapa, context: Context) {}
}

final class VistaDeCapa: UIView {
    private let capa: CALayer

    init(capa: CALayer) {
        self.capa = capa
        super.init(frame: .zero)
        layer.addSublayer(capa)
        // La imagen de la cámara no se invierte con «Invertir colores» (EA-02 §6).
        accessibilityIgnoresInvertColors = true
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
