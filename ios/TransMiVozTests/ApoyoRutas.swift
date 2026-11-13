import XCTest
@testable import TransMiVoz

/// Respuestas que controla la prueba. NO respeta la cancelación a propósito: modela un servidor que responde tarde
/// después de que la persona cambió la búsqueda o la selección.
final class RespuestasControlables<Valor: Sendable>: @unchecked Sendable {
    private let candado = NSLock()
    private var pendientes: [CheckedContinuation<Valor, Error>] = []
    private var recibidos: [String] = []

    /// Lo que pidió cada llamada, en orden.
    var argumentos: [String] { candado.lock(); defer { candado.unlock() }; return recibidos }

    func recibir(_ argumento: String) async throws -> Valor {
        try await withCheckedThrowingContinuation { continuacion in
            candado.lock()
            pendientes.append(continuacion)
            recibidos.append(argumento)
            candado.unlock()
        }
    }

    /// Responde la llamada número `indice` (0 = la primera).
    func responder(_ resultado: Result<Valor, Error>, indice: Int = 0) {
        candado.lock()
        let continuacion = pendientes[indice]
        candado.unlock()
        continuacion.resume(with: resultado)
    }

    func esperar(_ cantidad: Int) async {
        for _ in 0..<500 where argumentos.count < cantidad {
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
    }
}

/// Planificador cuyas respuestas controla la prueba.
final class ClientePlanificadorFalso: ClientePlanificador, @unchecked Sendable {
    let busquedas = RespuestasControlables<ResultadoBusquedaRutas>()
    let detalles = RespuestasControlables<DetalleRuta>()
    let lugares = RespuestasControlables<ListaLugares>()
    let viajes = RespuestasControlables<PlanViaje>()

    func buscarRutas(consulta: String) async throws -> ResultadoBusquedaRutas { try await busquedas.recibir(consulta) }
    func detalleRuta(codigo: String) async throws -> DetalleRuta { try await detalles.recibir(codigo) }
    func listarLugares() async throws -> ListaLugares { try await lugares.recibir("") }
    func planearViaje(origen: String, destino: String) async throws -> PlanViaje {
        try await viajes.recibir("\(origen)|\(destino)")
    }
}

/// Decodifica un fixture con el mismo camino que el cliente HTTP (decodificación estricta y validación).
func decodificarPlanificador<Respuesta: RespuestaPlanificador>(_ json: String, estado: Int = 200) throws -> Respuesta {
    try ClientePlanificadorHTTP.interpretar(estado: estado, cabeceras: nil, datos: FixturesPlanificador.datos(json))
}
