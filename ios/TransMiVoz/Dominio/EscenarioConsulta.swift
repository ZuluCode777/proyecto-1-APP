import Foundation

/// Escenario de una consulta. El Metro de Bogotá es un escenario FUTURO, aparte del transporte que
/// opera hoy: el servidor solo informa del proyecto (acción `none`) y nunca planea un viaje en Metro.
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
}
