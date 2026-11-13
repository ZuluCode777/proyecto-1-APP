import Foundation

/// Las seis opciones del Inicio de baja visión, en el orden y con los textos de `components/partial-home.tsx`.
/// Emergencia va siempre al final. Los íconos, los colores y lo que abre cada una están en `InicioVista`.
enum OpcionInicio: String, CaseIterable, Identifiable, Sendable {
    case asistente, rutas, gps, metro, lupa, emergencia

    var id: String { rawValue }

    var titulo: String {
        switch self {
        case .asistente: return "Asistente"
        case .rutas: return "Rutas"
        case .gps: return "Mapa y GPS"
        case .metro: return "Metro de Bogotá"
        case .lupa: return "Lupa"
        case .emergencia: return "Emergencia"
        }
    }

    var pista: String {
        switch self {
        case .asistente: return "Pregunta cómo llegar"
        case .rutas: return "Buscar y frecuentes"
        case .gps: return "Estaciones cercanas"
        case .metro: return "En construcción, sin servicio"
        case .lupa: return "Ampliar letreros"
        case .emergencia: return "Llamar al 123"
        }
    }

    /// Identificador de accesibilidad de la baldosa en las pruebas de interfaz.
    var identificador: String { "inicio-\(rawValue)" }
}

enum TextoInicio {
    /// Título de la banda de Inicio (`<h2>` de la web).
    static let pregunta = "¿Qué necesitas?"
    static let nombreApp = "TransMiVoz"
    /// Etiquetas de los dos botones de la cabecera (`aria-label` de `components/app-header.tsx`).
    static let abrirMenu = "Abrir menú de accesibilidad"
    static let abrirAvisos = "Avisos y anuncios"
    static let tituloMenuModo = "Modo de visualización"
    static let cerrarMenuModo = "Cerrar menú"
    static let modoActivo = "Modo activo"
}
