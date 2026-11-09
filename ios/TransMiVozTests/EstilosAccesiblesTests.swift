import SwiftUI
import UIKit
import XCTest
@testable import TransMiVoz

@MainActor
final class EstilosAccesiblesTests: XCTestCase {
    func testLasAccionesCumplenElContrasteDeSieteAUno() throws {
        let colores = [UIColor(Color.rojoAccesible), try XCTUnwrap(UIColor(named: "AccentColor"))]
        for estilo in [UIUserInterfaceStyle.light, .dark] {
            for contraste in [UIAccessibilityContrast.normal, .high] {
                let rasgos = UITraitCollection {
                    $0.userInterfaceStyle = estilo
                    $0.accessibilityContrast = contraste
                }
                let fondo = luminancia(.systemBackground, rasgos: rasgos)
                for color in colores {
                    let tinta = luminancia(color, rasgos: rasgos)
                    let relacion = (max(tinta, fondo) + 0.05) / (min(tinta, fondo) + 0.05)
                    XCTAssertGreaterThanOrEqual(relacion, 7, "Contraste insuficiente con \(rasgos)")
                }
            }
        }
    }

    /// Una acción no disponible sigue siendo legible: texto y borde sobre su fondo, ≥ 4,5:1 en claro, oscuro y contraste alto.
    func testLaAccionInhabilitadaCumpleElContrasteDeCuatroYMedioAUno() {
        for estilo in [UIUserInterfaceStyle.light, .dark] {
            for contraste in [UIAccessibilityContrast.normal, .high] {
                let rasgos = UITraitCollection {
                    $0.userInterfaceStyle = estilo
                    $0.accessibilityContrast = contraste
                }
                let tinta = luminancia(UIColor(Color.textoAccionInhabilitada), rasgos: rasgos)
                let fondo = luminancia(UIColor(Color.fondoAccionInhabilitada), rasgos: rasgos)
                let relacion = (max(tinta, fondo) + 0.05) / (min(tinta, fondo) + 0.05)
                XCTAssertGreaterThanOrEqual(relacion, 4.5, "Contraste insuficiente con \(rasgos)")
            }
        }
    }

    // Luminancia relativa sRGB: verifica el objetivo 7:1 de EA-02, además de la auditoría visual.
    private func luminancia(_ color: UIColor, rasgos: UITraitCollection) -> Double {
        var rojo: CGFloat = 0, verde: CGFloat = 0, azul: CGFloat = 0, alfa: CGFloat = 0
        XCTAssertTrue(color.resolvedColor(with: rasgos).getRed(&rojo, green: &verde, blue: &azul, alpha: &alfa))
        XCTAssertEqual(alfa, 1)
        let canales = [rojo, verde, azul].map { componente -> Double in
            let valor = Double(componente)
            return valor <= 0.04045 ? valor / 12.92 : pow((valor + 0.055) / 1.055, 2.4)
        }
        return canales[0] * 0.2126 + canales[1] * 0.7152 + canales[2] * 0.0722
    }
}
