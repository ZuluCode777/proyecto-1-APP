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
}

extension View {
    /// El margen exterior evita que ScrollView extienda su marco bajo la barra de pestañas.
    func bordeInferiorLegible() -> some View { padding(.bottom) }
}
