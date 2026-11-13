import CoreText
import SwiftUI

/// Plus Jakarta Sans, la letra de la web (`app/layout.tsx`, `next/font/google`). Cuatro pesos estáticos en
/// `TransMiVoz/Fuentes/` con su licencia (SIL OFL 1.1, `OFL.txt`): los que usa la web, regular, semibold, bold y extrabold.
///
/// Se registran dos veces a propósito: `UIAppFonts` (`Info-TransMiVoz.plist`) y, como respaldo, `Tipografia.registrar()` al
/// arrancar. Registrar dos veces es inofensivo, y así la letra no depende de cómo Xcode copie las fuentes al paquete. Si
/// ninguna de las dos funciona, `Font.custom` cae en la letra del sistema: la app sigue legible, solo cambia la forma.
///
/// Todos los estilos escalan con Dynamic Type (`Font.custom(_:size:relativeTo:)`), también con el texto más grande.
enum Tipografia {
    /// Pesos de la web: `font-normal`, `font-semibold`, `font-bold` y `font-extrabold`.
    enum Peso: String, CaseIterable {
        case regular = "PlusJakartaSans-Regular"
        case semibold = "PlusJakartaSans-SemiBold"
        case bold = "PlusJakartaSans-Bold"
        case extrabold = "PlusJakartaSans-ExtraBold"
    }

    /// Tamaños de Tailwind en puntos (`text-sm` 14, `text-base` 16, `text-lg` 18, `text-xl` 20, `text-2xl` 24,
    /// `text-3xl` 30), cada uno ligado al estilo de Dynamic Type más parecido para que escale igual.
    enum Tamano {
        case sm, base, lg, xl, xl2, xl3

        var puntos: CGFloat {
            switch self {
            case .sm: return 14
            case .base: return 16
            case .lg: return 18
            case .xl: return 20
            case .xl2: return 24
            case .xl3: return 30
            }
        }

        var estilo: Font.TextStyle {
            switch self {
            case .sm: return .footnote
            case .base: return .callout
            case .lg: return .body
            case .xl: return .title3
            case .xl2: return .title2
            case .xl3: return .title
            }
        }
    }

    /// Nombres de los archivos de fuente del paquete (sin extensión), para el respaldo de `registrar()`.
    static let archivos = Peso.allCases.map(\.rawValue)

    /// Registra las fuentes del paquete en el proceso. Se llama una vez al arrancar, antes de la primera vista.
    static func registrar() {
        for archivo in archivos {
            guard let url = Bundle.main.url(forResource: archivo, withExtension: "ttf")
                ?? Bundle.main.url(forResource: archivo, withExtension: "ttf", subdirectory: "Fuentes")
            else { continue }
            // Ya registrada por `UIAppFonts` devuelve `false`: no es un fallo.
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
    }
}

extension Font {
    /// Letra de la web con Dynamic Type: `.font(.jakarta(.bold, .lg))` es `font-bold text-lg`.
    static func jakarta(_ peso: Tipografia.Peso = .regular, _ tamano: Tipografia.Tamano = .base) -> Font {
        .custom(peso.rawValue, size: tamano.puntos, relativeTo: tamano.estilo)
    }
}
