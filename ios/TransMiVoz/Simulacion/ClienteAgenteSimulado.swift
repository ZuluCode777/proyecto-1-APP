#if DEBUG
import Foundation

/// Cliente SIMULADO para las pruebas de interfaz: no hace ninguna petición de
/// red ni usa credenciales. Solo existe en compilaciones de depuración, activado
/// con el argumento de lanzamiento `-PRUEBAS_UI_SIMULADAS`. Las palabras clave
/// provocan cada caso que la interfaz debe mostrar.
struct ClienteAgenteSimulado: ClienteAgente {
    func consultar(texto: String) async throws -> RespuestaAgente {
        let limpio = try EntradaConsulta.validar(texto).get()
        switch limpio.lowercased() {
        case "error401": throw ErrorConsulta.noAutorizado
        case "error429": throw ErrorConsulta.demasiadasPeticiones(reintentarEnSegundos: 3)
        case "sinred": throw ErrorConsulta.sinConexion
        case "lento":
            // Respeta la cancelación: `Task.sleep` lanza al cancelar.
            try await Task.sleep(nanoseconds: 60_000_000_000)
            return RespuestaAgente(texto: "[SIMULADO] Respuesta lenta que no debería verse.")
        case "viaje":
            return RespuestaAgente(
                texto: "[SIMULADO] Texto de viaje que la app no debe mostrar.",
                accion: .viaje([TramoViaje(
                    codigoRuta: "Z99", estacionAbordaje: "Estación Ejemplo Norte",
                    estacionDescenso: "Estación Ejemplo Sur", estacionesRecorridas: 3, conteoVerificado: false)]))
        case "orden":
            // Contenido que el servidor NO debería mandar: la app lo sustituye por un aviso.
            return RespuestaAgente(
                texto: "[SIMULADO] Toma la H72 en Calle 127 y bájate en Portal Usme.",
                pasos: [PasoAgente(etiqueta: "[SIMULADO] Sube en Calle 127", detalle: nil)],
                accion: .busqueda(estacion: "Portal Usme"))
        default:
            return RespuestaAgente(
                texto: "[SIMULADO] Respuesta de prueba para: \(limpio)",
                pasos: [PasoAgente(etiqueta: "Paso simulado", detalle: "sin servidor")])
        }
    }
}
#endif
