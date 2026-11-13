import SwiftUI
import UIKit

/// Un color de la paleta: valor claro y oscuro (sRGB, 0xRRGGBB). Sigue la apariencia del sistema.
private func token(_ claro: UInt32, _ oscuro: UInt32) -> Color {
    Color(uiColor: UIColor { rasgos in
        UIColor(hex: rasgos.userInterfaceStyle == .dark ? oscuro : claro)
    })
}

private extension UIColor {
    convenience init(hex: UInt32) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
    }
}

/// Paleta de la web (`app/globals.css`), con los mismos nombres en camelCase: `--brand-soft` es `Paleta.brandSoft`.
///
/// - Claro es `:root` (pantalla blanca, cabecera y tarjetas lima, un neón por botón, contornos negros).
/// - Oscuro es `.fluor`, el «Alto contraste» de la web (negro con neón). En la web lo elige la persona con un interruptor;
///   en el iPhone sigue la apariencia del sistema.
/// - Los valores `oklch` de la web se pasaron a sRGB con la reducción de croma de CSS Color 4; los que salían de la gama
///   van marcados «recortado». Con esos valores se comprobaron los contrastes que declara la web (17,9:1 negro sobre lima,
///   7,5:1 sobre el rojo de emergencia, 7,2:1 blanco sobre el rojo oscuro). `PaletaTests` los vuelve a medir.
/// - Un token que `.fluor` no sobrescribe vale lo mismo en claro y en oscuro, como en la web.
///
/// Uso: `.background(Paleta.card)`, `.foregroundStyle(Paleta.foreground)`, `.strokeBorder(Paleta.border, lineWidth: Tema.borde)`.
/// No uses `Paleta.primary` ni `Paleta.secondary` esperando el color del sistema: son los de la web.
enum Paleta {
    // MARK: Superficies y letra

    /// `--background`: claro #ffffff · oscuro oklch(0 0 0)
    static let background = token(0xFFFFFF, 0x000000)

    /// `--foreground`: claro #000000 · oscuro oklch(0.94 0.22 108) (recortado)
    static let foreground = token(0x000000, 0xFBF400)

    /// `--card`: claro #ccff00 · oscuro oklch(0.06 0 0)
    static let card = token(0xCCFF00, 0x010101)

    /// `--card-foreground`: claro #000000 · oscuro oklch(0.94 0.22 108) (recortado)
    static let cardForeground = token(0x000000, 0xFBF400)

    /// `--popover`: claro oklch(1 0 0) · oscuro igual (`.fluor` no lo cambia)
    static let popover = token(0xFFFFFF, 0xFFFFFF)

    /// `--popover-foreground`: claro oklch(0.145 0 0) · oscuro igual (`.fluor` no lo cambia)
    static let popoverForeground = token(0x0A0A0A, 0x0A0A0A)

    /// `--muted`: claro #f2f2f2 · oscuro oklch(0.1 0 0)
    static let muted = token(0xF2F2F2, 0x030303)

    /// `--muted-foreground`: claro #000000 · oscuro oklch(0.87 0.2 118)
    static let mutedForeground = token(0x000000, 0xCAE412)

    // MARK: Cabecera, marca y botones del menú

    /// `--bar`: claro #ccff00 · oscuro oklch(0.06 0 0)
    static let bar = token(0xCCFF00, 0x010101)

    /// `--brand`: claro #ff6eff · oscuro oklch(0.85 0.25 145)
    static let brand = token(0xFF6EFF, 0x36F555)

    /// `--brand-foreground`: claro #000000 · oscuro oklch(0 0 0)
    static let brandForeground = token(0x000000, 0x000000)

    /// `--brand-soft`: claro #ffffff · oscuro oklch(0.16 0.09 145) (recortado)
    static let brandSoft = token(0xFFFFFF, 0x001400)

    /// `--brand-ink`: claro #000000 · oscuro oklch(0.85 0.25 145)
    static let brandInk = token(0x000000, 0x36F555)

    /// `--fill-switch`: claro #00ffff · oscuro oklch(0.06 0 0)
    static let fillSwitch = token(0x00FFFF, 0x010101)

    /// `--fill-agent`: claro #ff6eff · oscuro oklch(0.06 0 0)
    static let fillAgent = token(0xFF6EFF, 0x010101)

    /// `--fill-routes`: claro #ffff00 · oscuro oklch(0.06 0 0)
    static let fillRoutes = token(0xFFFF00, 0x010101)

    /// `--fill-map`: claro #d07bff · oscuro oklch(0.06 0 0)
    static let fillMap = token(0xD07BFF, 0x010101)

    /// `--fill-lens`: claro #39ff14 · oscuro oklch(0.06 0 0)
    static let fillLens = token(0x39FF14, 0x010101)

    // MARK: Emergencia y estados

    /// `--sos`: claro #ff6b5a · oscuro oklch(0.48 0.2 27) (recortado)
    static let sos = token(0xFF6B5A, 0xB3000D)

    /// `--sos-foreground`: claro #000000 · oscuro oklch(1 0 0)
    static let sosForeground = token(0x000000, 0xFFFFFF)

    /// `--sos-border`: claro #000000 · oscuro oklch(0.48 0.2 27) (recortado)
    static let sosBorder = token(0x000000, 0xB3000D)

    /// `--ok`: claro oklch(0.42 0.12 150) (recortado) · oscuro oklch(0.85 0.25 145)
    static let ok = token(0x005E26, 0x36F555)

    /// `--fail`: claro oklch(0.46 0.19 27) (recortado) · oscuro oklch(0.75 0.2 25) (recortado)
    static let fail = token(0xA9000D, 0xFF7B74)

    /// `--destructive`: claro oklch(0.577 0.245 27.325) (recortado) · oscuro igual (`.fluor` no lo cambia)
    static let destructive = token(0xE7000B, 0xE7000B)

    // MARK: Contornos y foco

    /// `--border`: claro #000000 · oscuro oklch(0.94 0.22 108) (recortado)
    static let border = token(0x000000, 0xFBF400)

    /// `--input`: claro #000000 · oscuro oklch(0.94 0.22 108) (recortado)
    static let input = token(0x000000, 0xFBF400)

    /// `--ring`: claro #000000 · oscuro oklch(0.9 0.24 130)
    static let ring = token(0x000000, 0xA7FB0F)

    // MARK: Sin uso en el shell (se portan por completitud)

    /// `--primary`: claro oklch(0.205 0 0) · oscuro igual (`.fluor` no lo cambia)
    static let primary = token(0x171717, 0x171717)

    /// `--primary-foreground`: claro oklch(0.985 0 0) · oscuro igual (`.fluor` no lo cambia)
    static let primaryForeground = token(0xFAFAFA, 0xFAFAFA)

    /// `--secondary`: claro oklch(0.97 0 0) · oscuro igual (`.fluor` no lo cambia)
    static let secondary = token(0xF5F5F5, 0xF5F5F5)

    /// `--secondary-foreground`: claro oklch(0.205 0 0) · oscuro igual (`.fluor` no lo cambia)
    static let secondaryForeground = token(0x171717, 0x171717)

    /// `--accent`: claro #f2f2f2 · oscuro igual (`.fluor` no lo cambia)
    static let accent = token(0xF2F2F2, 0xF2F2F2)

    /// `--accent-foreground`: claro #000000 · oscuro igual (`.fluor` no lo cambia)
    static let accentForeground = token(0x000000, 0x000000)

    /// `--chart-1`: claro oklch(0.87 0 0) · oscuro igual (`.fluor` no lo cambia)
    static let chart1 = token(0xD4D4D4, 0xD4D4D4)

    /// `--chart-2`: claro oklch(0.556 0 0) · oscuro igual (`.fluor` no lo cambia)
    static let chart2 = token(0x737373, 0x737373)

    /// `--chart-3`: claro oklch(0.439 0 0) · oscuro igual (`.fluor` no lo cambia)
    static let chart3 = token(0x525252, 0x525252)

    /// `--chart-4`: claro oklch(0.371 0 0) · oscuro igual (`.fluor` no lo cambia)
    static let chart4 = token(0x404040, 0x404040)

    /// `--chart-5`: claro oklch(0.269 0 0) · oscuro igual (`.fluor` no lo cambia)
    static let chart5 = token(0x262626, 0x262626)

    /// `--sidebar`: claro oklch(0.985 0 0) · oscuro igual (`.fluor` no lo cambia)
    static let sidebar = token(0xFAFAFA, 0xFAFAFA)

    /// `--sidebar-foreground`: claro oklch(0.145 0 0) · oscuro igual (`.fluor` no lo cambia)
    static let sidebarForeground = token(0x0A0A0A, 0x0A0A0A)

    /// `--sidebar-primary`: claro oklch(0.205 0 0) · oscuro igual (`.fluor` no lo cambia)
    static let sidebarPrimary = token(0x171717, 0x171717)

    /// `--sidebar-primary-foreground`: claro oklch(0.985 0 0) · oscuro igual (`.fluor` no lo cambia)
    static let sidebarPrimaryForeground = token(0xFAFAFA, 0xFAFAFA)

    /// `--sidebar-accent`: claro oklch(0.97 0 0) · oscuro igual (`.fluor` no lo cambia)
    static let sidebarAccent = token(0xF5F5F5, 0xF5F5F5)

    /// `--sidebar-accent-foreground`: claro oklch(0.205 0 0) · oscuro igual (`.fluor` no lo cambia)
    static let sidebarAccentForeground = token(0x171717, 0x171717)

    /// `--sidebar-border`: claro oklch(0.922 0 0) · oscuro igual (`.fluor` no lo cambia)
    static let sidebarBorder = token(0xE5E5E5, 0xE5E5E5)

    /// `--sidebar-ring`: claro oklch(0.708 0 0) · oscuro igual (`.fluor` no lo cambia)
    static let sidebarRing = token(0xA1A1A1, 0xA1A1A1)
}

/// Medidas de la web: radios de `--radius` (0,625 rem = 10 pt) y contornos de 3 y 5 px.
enum Tema {
    /// `--radius` (`rounded-lg`).
    static let radio: CGFloat = 10
    /// `rounded-xl`: `--radius` × 1,4.
    static let radioXL: CGFloat = 14
    /// `rounded-2xl`: `--radius` × 1,8. Tarjetas, botones y baldosas.
    static let radio2XL: CGFloat = 18
    /// `rounded-3xl`: `--radius` × 2,2.
    static let radio3XL: CGFloat = 22
    /// `border-3`: el contorno de casi todo.
    static let borde: CGFloat = 3
    /// `border-5`: el contorno de Emergencia.
    static let bordeEmergencia: CGFloat = 5
    /// Lado mínimo de un objetivo táctil.
    static let objetivoMinimo: CGFloat = 44
}
