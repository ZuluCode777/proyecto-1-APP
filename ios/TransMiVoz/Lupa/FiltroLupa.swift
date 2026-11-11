import CoreImage

/// Filtros de la lupa: los mismos cuatro de la lupa web (`components/vision-assist.tsx`).
enum FiltroLupa: String, CaseIterable, Identifiable, Sendable {
    case contraste
    case fluorescente
    case blancoYNegro
    case invertir

    var id: String { rawValue }

    var nombre: String {
        switch self {
        case .contraste: return "Alto contraste"
        case .fluorescente: return "Fluorescente"
        case .blancoYNegro: return "Blanco y negro"
        case .invertir: return "Invertir"
        }
    }

    /// Equivalente aproximado en Core Image del filtro CSS de la web. El brillo de CSS multiplica y el de
    /// `CIColorControls` suma: los valores son una traducción a ojo, sin calibrar con la cámara real.
    private var ajuste: (saturacion: Double, brillo: Double, contraste: Double, invertido: Bool) {
        switch self {
        case .contraste: return (1.3, 0.06, 1.9, false)
        case .fluorescente: return (3.2, 0.075, 1.6, false)
        case .blancoYNegro: return (0, 0.05, 2.4, false)
        case .invertir: return (1, 0.025, 1.5, true)
        }
    }

    func aplicar(a imagen: CIImage) -> CIImage {
        let ajuste = self.ajuste
        let base = ajuste.invertido ? imagen.applyingFilter("CIColorInvert") : imagen
        return base.applyingFilter("CIColorControls", parameters: [
            kCIInputSaturationKey: ajuste.saturacion,
            kCIInputBrightnessKey: ajuste.brillo,
            kCIInputContrastKey: ajuste.contraste,
        ])
    }

    /// El centro de la imagen ampliado `escala` veces. Con `escala` ≤ 1 devuelve la imagen entera.
    static func recorte(_ imagen: CIImage, escala: Double) -> CIImage {
        guard escala > 1 else { return imagen }
        let marco = imagen.extent
        let ancho = marco.width / CGFloat(escala)
        let alto = marco.height / CGFloat(escala)
        return imagen.cropped(to: CGRect(x: marco.midX - ancho / 2, y: marco.midY - alto / 2, width: ancho, height: alto))
    }
}
