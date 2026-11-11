#if DEBUG
import Foundation

/// Cliente SIMULADO para las pruebas de interfaz: no hace ninguna petición de
/// red ni usa credenciales. Solo existe en compilaciones de depuración, activado
/// con el argumento de lanzamiento `-PRUEBAS_UI_SIMULADAS`. Las palabras clave
/// provocan cada caso que la interfaz debe mostrar.
struct ClienteAgenteSimulado: ClienteAgente {
    private let intentos = IntentosSimulados()

    func consultar(texto: String) async throws -> RespuestaAgente {
        let limpio = try EntradaConsulta.validar(texto).get()
        // Escenario Metro: la pregunta llega con su contexto delante (`EscenarioConsulta.prefijo`).
        if limpio.lowercased().hasPrefix("metro:") {
            return RespuestaAgente(texto: "[SIMULADO] Metro de Bogotá, Línea 1: en construcción y sin servicio comercial.")
        }
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
                    estacionDescenso: "Estación Ejemplo Sur", estacionesRecorridas: 3, conteoVerificado: false)]),
                catalogo: ProcedenciaCatalogo(procedencia: "[SIMULADO] Datos consultados hoy.", antiguo: false))
        case "frio":
            // Como el servidor arrancando: el primer intento agota el plazo y el reintento responde.
            if intentos.esPrimero("frio") { throw ErrorConsulta.tiempoAgotado }
            return RespuestaAgente(texto: "[SIMULADO] Respuesta tras reintentar.")
        case "antiguo":
            // Primero con la copia guardada; al volver a consultar, con datos recientes.
            let antiguo = intentos.esPrimero("antiguo")
            let procedencia = antiguo ? "[SIMULADO] Datos de una copia guardada." : "[SIMULADO] Datos consultados hoy."
            return RespuestaAgente(
                texto: "[SIMULADO] La ruta Z99 es de prueba. \(procedencia)", accion: .ruta(codigo: "Z99"),
                catalogo: ProcedenciaCatalogo(procedencia: procedencia, antiguo: antiguo))
        case "gps":
            return RespuestaAgente(texto: "[SIMULADO] Voy a abrir el GPS auditivo.", accion: .gps)
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

/// Cuenta los intentos de cada palabra clave: el primero falla o trae datos antiguos; los siguientes, no.
private final class IntentosSimulados: @unchecked Sendable {
    private let candado = NSLock()
    private var cuenta: [String: Int] = [:]

    /// `true` solo la primera vez que se pregunta por esa palabra.
    func esPrimero(_ palabra: String) -> Bool {
        candado.lock()
        defer { candado.unlock() }
        cuenta[palabra, default: 0] += 1
        return cuenta[palabra] == 1
    }
}
#endif
