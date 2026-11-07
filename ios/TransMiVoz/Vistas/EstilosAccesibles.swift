import SwiftUI

extension ShapeStyle where Self == Color {
    /// Texto secundario con contraste suficiente (≥ 4,5:1) en claro y oscuro.
    /// `.secondary` del sistema (~3,3:1 en claro) no pasa la auditoría de contraste
    /// en texto pequeño. Parte de `label`, que el sistema adapta al modo, sin blanco ni negro fijos.
    static var textoSecundario: Color { Color(uiColor: .label).opacity(0.7) }
}

private struct BordeInferiorLegible: ViewModifier {
    func body(content: Content) -> some View {
        #if compiler(>=6.2)
        if #available(iOS 26, *) {
            // La barra de pestañas flota sobre el contenido: con texto muy grande una frase
            // queda a medias bajo el vidrio y el contraste medido falla. El borde duro
            // da a ese tramo un fondo opaco en vez de dejar ver el texto borroso.
            content.scrollEdgeEffectStyle(.hard, for: .bottom)
        } else {
            content
        }
        #else
        content
        #endif
    }
}

extension View {
    /// Contenido que se desplaza bajo la barra de pestañas sin quedar ilegible.
    func bordeInferiorLegible() -> some View { modifier(BordeInferiorLegible()) }
}
