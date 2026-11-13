import Foundation
import Observation

/// Estado visible de la consulta de transporte.
enum EstadoConsulta: Equatable, Sendable {
    case inactiva
    case enviando
    case respuesta(RespuestaAgente)
    case error(ErrorConsulta)
    case cancelada
}

/// Consulta textual al backend: una sola petición vigente a la vez.
///
/// Invariante (arquitectura §7 «Consulta vigente»): una respuesta de una
/// consulta cancelada o reemplazada NO cambia el
/// estado. Se garantiza con una generación: solo el resultado de la última
/// generación vigente se aplica, aunque el cliente ignore la cancelación.
@MainActor
@Observable
final class ConsultaModelo {
    var texto = ""
    /// Escenario de la PRÓXIMA consulta; el del resultado en pantalla es `escenarioEnviado`.
    var escenario: EscenarioConsulta = .transporte
    private(set) var estado: EstadoConsulta = .inactiva
    /// Texto de la última consulta enviada, para «Reintentar».
    private(set) var ultimoTextoEnviado: String?
    /// Escenario de la última consulta enviada: rotula su resultado y lo conserva «Reintentar».
    private(set) var escenarioEnviado: EscenarioConsulta = .transporte

    @ObservationIgnored private let cliente: ClienteAgente
    @ObservationIgnored private var tarea: Task<Void, Never>?
    @ObservationIgnored private var generacion = 0

    init(cliente: ClienteAgente) {
        self.cliente = cliente
    }

    var estaEnviando: Bool { estado == .enviando }

    func enviar() {
        switch EntradaConsulta.validar(texto, maximo: escenario.maximoCaracteres) {
        case .failure(let error):
            // Una entrada inválida invalida también la consulta anterior: si no,
            // su respuesta tardía pisaría este error (el campo sigue activo y
            // `estaEnviando` dejó de ser verdadero, así que «Cancelar» ya no existe).
            invalidarConsultaEnCurso()
            estado = .error(error)
        case .success(let limpio):
            iniciar(con: limpio)
        }
    }

    func reintentar() {
        guard let anterior = ultimoTextoEnviado else { return }
        texto = anterior
        escenario = escenarioEnviado
        enviar()
    }

    /// Cancela la consulta en curso. No hay efectos tardíos aunque el servidor responda después.
    /// También la usa la pantalla al dejar de verse (arquitectura §7).
    func cancelar() {
        guard estaEnviando else { return }
        invalidarConsultaEnCurso()
        estado = .cancelada
    }

    /// Descarta la generación vigente: su resultado, si llega, no se aplica.
    private func invalidarConsultaEnCurso() {
        generacion += 1
        tarea?.cancel()
        tarea = nil
    }

    private func iniciar(con limpio: String) {
        generacion += 1
        let miGeneracion = generacion
        tarea?.cancel()
        ultimoTextoEnviado = limpio
        let enviado = escenario
        escenarioEnviado = enviado
        estado = .enviando
        tarea = Task { [cliente] in
            let resultado: EstadoConsulta
            do {
                // Antes de publicarla, se retiran las órdenes de abordaje sin verificar.
                let respuesta = try await cliente.consultar(texto: enviado.prefijo + limpio).saneada()
                // En el escenario Metro el servidor solo informa (acción `none`): una ruta, una estación
                // o un viaje de TransMilenio no se presentan como Metro.
                guard enviado == .transporte || respuesta.accion == .ninguna else {
                    throw ErrorConsulta.respuestaIncompatible
                }
                resultado = .respuesta(respuesta)
            } catch let error as ErrorConsulta {
                resultado = .error(error)
            } catch is CancellationError {
                resultado = .error(.cancelada)
            } catch {
                resultado = .error(.sinConexion)
            }
            // Respuesta tardía de una consulta cancelada o reemplazada: se descarta.
            guard miGeneracion == self.generacion, !Task.isCancelled else { return }
            self.tarea = nil
            self.estado = resultado == .error(.cancelada) ? .cancelada : resultado
        }
    }
}
