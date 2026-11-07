import ContratoBLE
import Foundation

/// Texto en español de cada estado de la sesión. Mantiene separadas las ideas
/// que el contrato distingue: «sin detección», «sin datos», «fallo» y
/// «proximidad». Nunca dice «camino libre» ni «sin obstáculos».
enum TextoEstadoSesion {
    static func descripcion(_ estado: EstadoSesion) -> String {
        switch estado {
        case .desconectada:
            return "Sesión detenida. No se está midiendo nada."
        case .esperandoInformacion:
            return "Conectando con el accesorio simulado."
        case .sincronizando:
            return "Sincronizando con el accesorio simulado. Aún no hay medidas."
        case .rechazada(let motivo):
            return "Sesión rechazada (\(motivo.etiqueta)). No hay datos utilizables y esto no es una detección."
        case .sinDatos(.sinRecepcion):
            return "Sin datos recientes: no llega ninguna trama válida. No se repite la última medida."
        case .sinDatos(.vencido):
            return "Sin datos vigentes: la última medida llegó demasiado vieja para usarse."
        case .sinDatos(.sinResultado):
            return "El radar simulado todavía no entrega resultado."
        case .radarNoDisponible(let salud):
            return "Radar no disponible (salud: \(salud)). Esto no significa que no haya obstáculos."
        case .sinBlanco:
            return "Sin detección dentro de la ventana de medida. Esto no significa camino libre."
        case .presencia:
            return "Presencia detectada, sin distancia ni dirección."
        case .objetivo(let distanciaMm, let azimutCentesimas):
            let metros = (Double(distanciaMm) / 1000).formatted(.number.precision(.fractionLength(2)))
            if let azimutCentesimas {
                // Contrato BLE 1.0: el azimut es relativo al eje del sensor; negativo a la izquierda.
                let grados = (Double(abs(azimutCentesimas)) / 100).formatted(.number.precision(.fractionLength(1)))
                let lado = azimutCentesimas < 0 ? "a la izquierda" : (azimutCentesimas > 0 ? "a la derecha" : "sobre el eje")
                return "Objetivo a \(metros) m del sensor, \(grados) grados \(lado) del eje del sensor."
            }
            return "Objetivo a \(metros) m del sensor, sin dirección."
        }
    }
}
