import SwiftUI
import UIKit
import XCTest
@testable import TransMiVoz

/// La paleta de la web (`app/globals.css`) pasada a Swift conserva los contrastes que la web declara, en claro y en oscuro
/// (`.fluor`). Mide con los mismos valores que pinta la app.
@MainActor
final class PaletaTests: XCTestCase {
    private struct Par {
        let nombre: String
        let letra: Color
        let fondo: Color
    }

    /// Letra sobre fondo tal como se combinan en la web. Todas piden al menos 7:1 (AAA), que es lo que declara el CSS
    /// (17,9:1 sobre el lima, al menos 7,9:1 sobre cada neón, 7,5:1 sobre el rojo de Emergencia, 7,2:1 el blanco sobre
    /// el rojo oscuro).
    private var pares: [Par] {
        [
            Par(nombre: "foreground/background", letra: Paleta.foreground, fondo: Paleta.background),
            Par(nombre: "foreground/bar", letra: Paleta.foreground, fondo: Paleta.bar),
            Par(nombre: "cardForeground/card", letra: Paleta.cardForeground, fondo: Paleta.card),
            Par(nombre: "foreground/fillSwitch", letra: Paleta.foreground, fondo: Paleta.fillSwitch),
            Par(nombre: "foreground/fillAgent", letra: Paleta.foreground, fondo: Paleta.fillAgent),
            Par(nombre: "foreground/fillRoutes", letra: Paleta.foreground, fondo: Paleta.fillRoutes),
            Par(nombre: "foreground/fillMap", letra: Paleta.foreground, fondo: Paleta.fillMap),
            Par(nombre: "foreground/fillLens", letra: Paleta.foreground, fondo: Paleta.fillLens),
            Par(nombre: "foreground/brandSoft", letra: Paleta.foreground, fondo: Paleta.brandSoft),
            Par(nombre: "brandForeground/brand", letra: Paleta.brandForeground, fondo: Paleta.brand),
            Par(nombre: "brandInk/brandSoft", letra: Paleta.brandInk, fondo: Paleta.brandSoft),
            Par(nombre: "sosForeground/sos", letra: Paleta.sosForeground, fondo: Paleta.sos),
            Par(nombre: "mutedForeground/muted", letra: Paleta.mutedForeground, fondo: Paleta.muted),
            Par(nombre: "ok/background", letra: Paleta.ok, fondo: Paleta.background),
            Par(nombre: "fail/background", letra: Paleta.fail, fondo: Paleta.background),
        ]
    }

    func testLosParesDeLetraYFondoCumplenSieteAUnoEnClaroYEnOscuro() {
        for estilo in [UIUserInterfaceStyle.light, .dark] {
            for par in pares {
                let relacion = contraste(par.letra, par.fondo, estilo)
                XCTAssertGreaterThanOrEqual(relacion, 7, "\(par.nombre) en \(estilo == .dark ? "oscuro" : "claro"): \(relacion):1")
            }
        }
    }

    /// Los contornos y el foco se ven contra el fondo (3:1, no texto): negro sobre blanco y neón sobre negro.
    func testElContornoYElFocoSeVenContraElFondo() {
        for estilo in [UIUserInterfaceStyle.light, .dark] {
            for token in [Paleta.border, Paleta.ring] {
                XCTAssertGreaterThanOrEqual(contraste(token, Paleta.background, estilo), 3)
            }
        }
    }

    /// El claro es `:root` y el oscuro es `.fluor`: la cabecera lima se vuelve casi negra y la letra, neón.
    func testClaroYOscuroSonLosValoresDeLaWeb() {
        XCTAssertEqual(hex(Paleta.bar, .light), 0xCCFF00)
        XCTAssertEqual(hex(Paleta.fillAgent, .light), 0xFF6EFF)
        XCTAssertEqual(hex(Paleta.sos, .light), 0xFF6B5A)
        XCTAssertEqual(hex(Paleta.background, .light), 0xFFFFFF)
        XCTAssertEqual(hex(Paleta.bar, .dark), 0x010101)
        XCTAssertEqual(hex(Paleta.foreground, .dark), 0xFBF400)
        XCTAssertEqual(hex(Paleta.sos, .dark), 0xB3000D)
        XCTAssertEqual(hex(Paleta.background, .dark), 0x000000)
    }

    // MARK: Ayudas

    private func resuelto(_ color: Color, _ estilo: UIUserInterfaceStyle) -> UIColor {
        UIColor(color).resolvedColor(with: UITraitCollection(userInterfaceStyle: estilo))
    }

    private func componentes(_ color: Color, _ estilo: UIUserInterfaceStyle) -> [Double] {
        var rojo: CGFloat = 0, verde: CGFloat = 0, azul: CGFloat = 0, alfa: CGFloat = 0
        XCTAssertTrue(resuelto(color, estilo).getRed(&rojo, green: &verde, blue: &azul, alpha: &alfa))
        XCTAssertEqual(alfa, 1)
        return [Double(rojo), Double(verde), Double(azul)]
    }

    private func hex(_ color: Color, _ estilo: UIUserInterfaceStyle) -> Int {
        let canales = componentes(color, estilo).map { Int(($0 * 255).rounded()) }
        return (canales[0] << 16) | (canales[1] << 8) | canales[2]
    }

    /// Luminancia relativa sRGB (WCAG).
    private func luminancia(_ color: Color, _ estilo: UIUserInterfaceStyle) -> Double {
        let canales = componentes(color, estilo).map { valor -> Double in
            valor <= 0.04045 ? valor / 12.92 : pow((valor + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * canales[0] + 0.7152 * canales[1] + 0.0722 * canales[2]
    }

    private func contraste(_ a: Color, _ b: Color, _ estilo: UIUserInterfaceStyle) -> Double {
        let la = luminancia(a, estilo), lb = luminancia(b, estilo)
        return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)
    }
}
