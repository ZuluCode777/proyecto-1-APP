import Foundation

/// Textos del dictado, en español. Ninguno promete reconocimiento sin red ni con acento colombiano: dicen lo que el sistema
/// declara y adónde va el audio.
enum TextoDictado {
    static let dictar = "Dictar pregunta"
    static let detener = "Detener dictado"
    static let abrirAjustes = "Abrir Ajustes"
    static let dictadoCortadoPorVoz = "Dictado cancelado: va a sonar un aviso. Vuelve a dictar cuando termine."

    static func dictadoTerminado(_ texto: String) -> String { "Dictado terminado: \(texto)." }

    /// El botón cambia de texto y de icono según el estado, así que el estado no depende del color.
    static func boton(_ estado: EstadoDictado) -> String {
        estado.enCurso ? detener : dictar
    }

    /// Valor de accesibilidad del botón: el estado en palabras.
    static func valor(_ estado: EstadoDictado) -> String {
        switch estado {
        case .inactivo, .sinTexto, .fallo: return "detenido"
        case .pidiendoPermisos: return "esperando permiso"
        case .iniciando: return "iniciando"
        case .escuchando: return "escuchando"
        case .finalizando: return "procesando"
        case .permisoDenegado: return "sin permiso"
        case .permisoRestringido: return "restringido"
        case .noDisponible: return "no disponible"
        }
    }

    static func pista(_ estado: EstadoDictado) -> String {
        switch estado {
        case .escuchando: return "Termina el dictado y deja el texto en el campo de la pregunta."
        case .pidiendoPermisos, .iniciando, .finalizando: return "Cancela el dictado."
        default: return "Dicta la pregunta en lugar de escribirla. También puedes escribirla."
        }
    }

    /// Nombre del español que el sistema ofreció; el identificador no se lee bien en voz alta.
    static func nombreIdioma(_ idioma: String) -> String {
        switch idioma {
        case "es-CO": return "español de Colombia"
        case "es-ES": return "español de España"
        default: return "español"
        }
    }

    /// Adónde va el audio, según lo que el sistema declara. Se muestra con el dictado en reposo, antes de pedir nada.
    static func capacidad(_ capacidad: CapacidadReconocimiento) -> String {
        switch capacidad {
        case .local(let idioma):
            return "Dictado en este iPhone, en \(nombreIdioma(idioma)): el audio no sale de él."
        case .remoto(let idioma):
            return "Dictado con el servicio de Apple, en \(nombreIdioma(idioma)): el audio se envía a Apple."
        case .noDisponible:
            return "El dictado no está disponible ahora. Escribe tu pregunta."
        }
    }

    static func descripcion(_ estado: EstadoDictado, capacidad: CapacidadReconocimiento) -> String {
        switch estado {
        case .inactivo: return self.capacidad(capacidad)
        case .pidiendoPermisos: return "Responde a los avisos de iOS sobre el micrófono y el reconocimiento de voz."
        case .iniciando: return "Preparando el micrófono…"
        case .escuchando: return "Escuchando. Toca «\(detener)» cuando termines."
        case .finalizando: return "Procesando lo que dijiste…"
        case .permisoDenegado: return "Sin permiso de micrófono o de reconocimiento de voz. Escribe tu pregunta."
        case .permisoRestringido: return "El dictado está restringido en este iPhone. Escribe tu pregunta."
        case .noDisponible: return "El dictado no está disponible ahora. Escribe tu pregunta."
        case .sinTexto: return "No se entendió nada. Prueba otra vez o escribe tu pregunta."
        case .fallo: return "El dictado falló. Prueba otra vez o escribe tu pregunta."
        }
    }

    /// Lo que se anuncia por accesibilidad al llegar a un estado. `nil`: basta con lo que queda en pantalla. Nunca se anuncia
    /// «escuchando»: VoiceOver sonaría sobre el micrófono recién abierto y el reconocedor lo tomaría por voz de la persona.
    static func anuncio(_ estado: EstadoDictado) -> String? {
        switch estado {
        case .permisoDenegado, .permisoRestringido, .noDisponible, .sinTexto, .fallo:
            return descripcion(estado, capacidad: .noDisponible)
        case .inactivo, .pidiendoPermisos, .iniciando, .escuchando, .finalizando: return nil
        }
    }
}
