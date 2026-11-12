import Foundation

/// Textos de la pantalla Favoritas. El estado vacío dice lo que la app hace HOY: al llegar la pantalla de rutas, se actualiza aquí.
enum TextoFavoritas {
    static let vacio = "Aún no tienes rutas favoritas."
    static let comoSeAgregan = "Las rutas se guardan desde el detalle de cada ruta, con el botón «Guardar». En el iPhone esa pantalla todavía no está disponible, así que por ahora esta lista seguirá vacía."
    static let dondeSeGuardan = "Las favoritas se guardan solo en este iPhone: no se envían al servidor ni se comparten con la web."

    static func resumen(_ cantidad: Int) -> String {
        cantidad == 1 ? "1 ruta favorita" : "\(cantidad) rutas favoritas"
    }

    static func etiquetaQuitar(_ codigo: String) -> String { "Quitar la ruta \(codigo) de favoritas" }

    /// Anuncio de accesibilidad tras quitar una ruta (el foco se pierde con la fila).
    static func quitada(_ codigo: String, quedan: Int) -> String {
        let resto: String
        switch quedan {
        case 0: resto = "No quedan rutas favoritas."
        case 1: resto = "Queda 1 ruta favorita."
        default: resto = "Quedan \(quedan) rutas favoritas."
        }
        return "Quité la ruta \(codigo) de tus favoritas. \(resto)"
    }
}
