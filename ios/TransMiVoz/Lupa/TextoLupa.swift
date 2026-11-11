import Foundation

/// Estado de la lupa que ve la persona.
enum EstadoLupa: Equatable, CaseIterable {
    /// Sin captura: la pestaña no está a la vista o la app no está activa.
    case enPausa
    case sinCamara
    /// El sistema aún no ha preguntado por el permiso: la pantalla lo explica antes.
    case permisoPorPedir
    /// El aviso de permiso del sistema está en pantalla.
    case pidiendoPermiso
    case permisoDenegado
    case permisoRestringido
    case iniciando
    case activa
    case error
}

/// Textos de la lupa, en español. La lupa solo amplía la imagen de la cámara: ningún texto dice otra cosa.
enum TextoLupa {
    static let visor = "Imagen ampliada de la cámara. VoiceOver no describe lo que aparece en ella."
    static let fuenteSintetica = "Modo de pruebas: imagen sintética, sin cámara real."
    static let imagenEnVivo = "Imagen en vivo"
    static let imagenCongelada = "Imagen congelada"

    /// Explicación previa al aviso de permiso del sistema. Un párrafo por frase: con el texto más grande cada uno cabe a la vista.
    static let parrafosPermiso = [
        "TransMiVoz usa la cámara solo para mostrarte la imagen ampliada en vivo.",
        "La imagen no se guarda ni se envía.",
        "Al tocar «Continuar», iOS te pedirá permiso.",
    ]
    static let permisoAlternativa = "Si prefieres no darlo, el resto de la app sigue funcionando. Puedes cambiarlo después en Ajustes, en TransMiVoz."

    static func descripcion(_ estado: EstadoLupa) -> String {
        switch estado {
        case .enPausa: return "Lupa en pausa. La cámara está apagada."
        case .sinCamara: return "Este dispositivo no tiene cámara disponible."
        case .permisoPorPedir: return parrafosPermiso.joined(separator: " ")
        case .pidiendoPermiso: return "Responde al aviso de iOS sobre la cámara."
        case .permisoDenegado: return "Sin permiso de cámara. Actívalo en Ajustes, en TransMiVoz."
        case .permisoRestringido: return "El uso de la cámara está restringido en este iPhone."
        case .iniciando: return "Abriendo cámara…"
        case .activa: return imagenEnVivo
        case .error: return "No se pudo abrir la cámara. Toca «Reintentar»."
        }
    }

    /// Lo que se anuncia por accesibilidad al llegar a un estado. `nil`: basta con lo que queda en pantalla.
    static func anuncio(_ estado: EstadoLupa) -> String? {
        switch estado {
        case .activa: return "Lupa lista. \(imagenEnVivo)."
        case .sinCamara, .permisoDenegado, .permisoRestringido, .error: return descripcion(estado)
        case .enPausa, .permisoPorPedir, .pidiendoPermiso, .iniciando: return nil
        }
    }

    /// «1,5»: como mucho un decimal y coma decimal, sin depender de la región del iPhone.
    static func numero(_ factor: Double) -> String {
        factor.formatted(.number.precision(.fractionLength(0...1)).locale(Locale(identifier: "es_CO")))
    }

    /// Valor de accesibilidad del aumento: «1 aumento», «1,5 aumentos».
    static func aumento(_ factor: Double) -> String {
        let cifra = numero(factor)
        return cifra == "1" ? "1 aumento" : "\(cifra) aumentos"
    }
}
