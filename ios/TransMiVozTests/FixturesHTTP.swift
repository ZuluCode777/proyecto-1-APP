import Foundation

/// Respuestas JSON de `POST /api/agent` con VALORES INVENTADOS (estación «Ejemplo
/// Norte», ruta «Z99»). No vienen de un servidor real ni de ninguna ejecución:
/// reproducen la FORMA de `AgentReplySchema` (`lib/local-agent.ts`) para probar
/// el cliente sin red ni secretos. Son simulaciones de contrato, no evidencia de
/// que el backend real responda así.
enum FixturesHTTP {
    // FIXTURE-INICIO ninguna
    static let ninguna = #"""
    {"reply":"Hola, soy TransMiVoz de prueba.","action":"none","steps":[],"engine":"reglas"}
    """#
    // FIXTURE-FIN

    // FIXTURE-INICIO busqueda
    static let busqueda = #"""
    {"reply":"Encontré la estación Ejemplo Norte.","action":"search","station":"Estación Ejemplo Norte","steps":[{"label":"Busqué la estación","detail":"Ejemplo Norte"},{"label":"Listo"}],"engine":"ollama"}
    """#
    // FIXTURE-FIN

    // FIXTURE-INICIO ruta
    static let ruta = #"""
    {"reply":"La ruta Z99 es de prueba.","action":"route","routeCode":"Z99","steps":[],"engine":"reglas"}
    """#
    // FIXTURE-FIN

    // FIXTURE-INICIO viaje
    static let viaje = #"""
    {"reply":"Texto de viaje de prueba.","action":"trip","trip":[{"routeCode":"Z99","board":"Estación Ejemplo Norte","alight":"Estación Ejemplo Sur","stationsRidden":3}],"steps":[],"engine":"reglas"}
    """#
    // FIXTURE-FIN

    // FIXTURE-INICIO viajeVerificado
    static let viajeVerificado = #"""
    {"reply":"Texto de viaje de prueba.","action":"trip","trip":[{"routeCode":"Z99","board":"Estación Ejemplo Norte","alight":"Estación Ejemplo Sur","stationsRidden":3,"conteoVerificado":true}],"steps":[],"engine":"reglas"}
    """#
    // FIXTURE-FIN

    // FIXTURE-INICIO limite429
    static let limite429 = #"""
    {"reply":"Estás haciendo muchas peticiones seguidas. Espera un momento e inténtalo otra vez.","action":"none","steps":[],"engine":"reglas"}
    """#
    // FIXTURE-FIN

    // Respuestas que el cliente debe RECHAZAR (no son del contrato).
    static let accionDesconocida = #"{"reply":"x","action":"teleport","steps":[],"engine":"reglas"}"#
    static let sinMotor = #"{"reply":"x","action":"none","steps":[]}"#
    static let motorDesconocido = #"{"reply":"x","action":"none","steps":[],"engine":"gpt"}"#
    static let textoVacio = #"{"reply":"   ","action":"none","steps":[],"engine":"reglas"}"#
    static let busquedaSinEstacion = #"{"reply":"x","action":"search","steps":[],"engine":"reglas"}"#
    static let rutaSinCodigo = #"{"reply":"x","action":"route","steps":[],"engine":"reglas"}"#
    static let viajeSinTramos = #"{"reply":"x","action":"trip","steps":[],"engine":"reglas"}"#
    static let tramoNegativo = #"{"reply":"x","action":"trip","trip":[{"routeCode":"Z99","board":"A","alight":"B","stationsRidden":-1}],"steps":[],"engine":"reglas"}"#
    static let noEsObjeto = #"["no","soy","objeto"]"#

    static func datos(_ json: String) -> Data { Data(json.utf8) }
}
