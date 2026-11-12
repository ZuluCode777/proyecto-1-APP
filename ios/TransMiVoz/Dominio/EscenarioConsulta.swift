import Foundation

/// Escenario de una consulta. El escenario Metro (`CONTEXT.md`) es una representación educativa de infraestructura
/// FUTURA, aparte del transporte que opera hoy: el servidor solo informa del proyecto (acción `none`) y nunca planea
/// un viaje en Metro. Aquí viven los textos de cada escenario para que la pantalla, el anuncio y las pruebas digan lo mismo.
enum EscenarioConsulta: Equatable, Sendable {
    case transporte
    case metroFuturo

    /// Contexto que la pregunta lleva delante. El servidor solo trata una frase como Metro si lo nombra
    /// (`interpretarMetro` en `lib/metro.ts`): así «Calle 72» en este escenario no es la de TransMilenio.
    /// `lib/ea17-procedencia.test.ts` lee este valor y comprueba que el servidor lo entiende.
    var prefijo: String {
        switch self {
        case .transporte: return ""
        case .metroFuturo: return "Metro: "
        }
    }

    /// Lo que cabe escribir: el prefijo cuenta en el límite del servidor.
    var maximoCaracteres: Int { EntradaConsulta.maximoCaracteres - prefijo.utf16.count }

    // MARK: Textos

    /// Párrafo sobre el campo. En Metro no pasa de las líneas del de transporte: con el texto más grande la pantalla
    /// lo exige entero a la vista.
    var introduccion: String {
        switch self {
        case .transporte:
            return "Escribe una pregunta de transporte. El texto se envía al servidor configurado; no se envía tu ubicación."
        case .metroFuturo:
            return "Escenario Metro educativo: infraestructura futura, sin servicio comercial. El texto se envía al servidor."
        }
    }

    var etiquetaCampo: String {
        switch self {
        case .transporte: return "Pregunta de transporte"
        case .metroFuturo: return "Pregunta sobre el escenario Metro, educativo y futuro"
        }
    }

    /// Sin permiso de ubicación que pedir ni denegar: el origen de un viaje se escribe en la pregunta.
    var pistaCampo: String {
        let maximo = "Máximo \(maximoCaracteres) caracteres."
        switch self {
        case .transporte: return maximo + " Para un viaje, escribe también desde dónde sales: la app no usa tu ubicación."
        case .metroFuturo: return maximo
        }
    }

    /// Estado del selector para VoiceOver: el texto visible del botón no cambia.
    var valorSelector: String {
        switch self {
        case .transporte: return "desactivado"
        case .metroFuturo: return "activado"
        }
    }

    var pistaSelector: String {
        switch self {
        case .transporte: return "Representación educativa de infraestructura futura, sin servicio comercial. Cambia la consulta a ese escenario."
        case .metroFuturo: return "Vuelve a la consulta de transporte de hoy."
        }
    }

    /// Anuncio al elegir el escenario, solo desde el botón (un reintento que lo restablece no anuncia nada).
    var anuncioAlElegir: String {
        switch self {
        case .transporte: return "Escenario de transporte de hoy."
        case .metroFuturo: return "Escenario Metro educativo: infraestructura futura, sin servicio comercial. Las respuestas no son un viaje."
        }
    }

    /// Encabezado del resultado de una pregunta hecha en este escenario.
    var tituloResultado: String {
        switch self {
        case .transporte: return "Respuesta"
        case .metroFuturo: return "Escenario Metro: infraestructura futura"
        }
    }

    /// Aviso fijo del resultado; `nil` en transporte.
    var avisoResultado: String? {
        switch self {
        case .transporte: return nil
        case .metroFuturo: return "Representación educativa de infraestructura futura, sin servicio comercial. No es un viaje ni una ruta disponible."
        }
    }

    /// Frase que se suma al anuncio de una respuesta; `nil` en transporte.
    var anuncioResultado: String? {
        switch self {
        case .transporte: return nil
        case .metroFuturo: return "Escenario Metro: infraestructura futura, sin servicio comercial."
        }
    }
}
