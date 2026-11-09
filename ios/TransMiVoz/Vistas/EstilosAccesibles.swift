import SwiftUI

extension ShapeStyle where Self == Color {
    /// Texto secundario con contraste suficiente (≥ 4,5:1) en claro y oscuro.
    /// `.secondary` del sistema (~3,3:1 en claro) no pasa la auditoría de contraste
    /// en texto pequeño. Parte de `label`, que el sistema adapta al modo, sin blanco ni negro fijos.
    static var textoSecundario: Color { Color(uiColor: .label).opacity(0.7) }

    /// Rojo para acciones destructivas con contraste ≥ 7:1. El rojo del sistema
    /// (#FF383C) da ~3,6:1 sobre blanco y la auditoría lo marca "casi aprobado".
    static var rojoAccesible: Color {
        Color(uiColor: UIColor { rasgos in
            rasgos.userInterfaceStyle == .dark
                ? UIColor(red: 1, green: 0.42, blue: 0.38, alpha: 1)
                : UIColor(red: 0.70, green: 0, blue: 0.09, alpha: 1)
        })
    }

    /// Texto y borde de una acción no disponible, con contraste ≥ 4,5:1 sobre `fondoAccionInhabilitada`.
    /// El aspecto atenuado del sistema (~1,6:1) hace fallar la auditoría de contraste.
    static var textoAccionInhabilitada: Color {
        Color(uiColor: UIColor { rasgos in
            let alto = rasgos.accessibilityContrast == .high
            return rasgos.userInterfaceStyle == .dark
                ? UIColor(white: alto ? 0.92 : 0.78, alpha: 1)
                : UIColor(white: alto ? 0.12 : 0.28, alpha: 1)
        })
    }

    /// Fondo opaco de una acción no disponible (opaco para poder medir su contraste).
    static var fondoAccionInhabilitada: Color { Color(uiColor: .secondarySystemBackground) }
}

/// Botón no disponible: sin relleno de color y con borde discontinuo, así se distingue de uno disponible
/// por forma y no solo por tono (también con contraste alto). El estado «deshabilitado» lo da `.disabled`.
struct EstiloAccionInhabilitada: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(Color.textoAccionInhabilitada)
            .multilineTextAlignment(.center)
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            .background(Color.fondoAccionInhabilitada, in: Capsule())
            .overlay(Capsule().strokeBorder(Color.textoAccionInhabilitada, style: StrokeStyle(lineWidth: 1.5, dash: [5, 3])))
    }
}

extension View {
    /// El margen exterior evita que ScrollView extienda su marco bajo la barra de pestañas.
    func bordeInferiorLegible() -> some View { padding(.bottom) }

    /// Estilo del sistema (relleno o contorno) si la acción está disponible; si no, `EstiloAccionInhabilitada`
    /// y `.disabled`. Estilo y bloqueo salen del mismo valor para que no se desacoplen.
    @ViewBuilder func accion(prominente: Bool, disponible: Bool) -> some View {
        if !disponible {
            buttonStyle(EstiloAccionInhabilitada()).disabled(true)
        } else if prominente {
            buttonStyle(.borderedProminent)
        } else {
            buttonStyle(.bordered)
        }
    }
}

/// Pila de contenido: diferida o inmediata, con la misma disposición. Solo con tamaños de accesibilidad se
/// difiere la creación (el contenido que queda bajo el área desplazable existiría sin verse y la auditoría de
/// contraste lo evaluaría); con tamaños normales la pila diferida rompió la auditoría de Dynamic Type.
struct ContenedorControles<Contenido: View>: View {
    let diferido: Bool
    var espaciado: CGFloat = 16
    @ViewBuilder let contenido: Contenido

    var body: some View {
        if diferido {
            LazyVStack(alignment: .leading, spacing: espaciado) { contenido }
        } else {
            VStack(alignment: .leading, spacing: espaciado) { contenido }
        }
    }
}
