import Foundation
import Observation

/// Anuncios operativos del servidor (EA-26, #52). Guarda la última respuesta buena y, si una consulta posterior falla,
/// la conserva con su fecha y baja la confianza: nunca la sustituye por «sin novedades». Es independiente de la
/// sesión con el accesorio y de sus avisos: un fallo aquí no toca ninguno de los dos.
@MainActor
@Observable
final class AnunciosModelo {
    /// Última respuesta buena del servidor. `nil` si todavía no hubo ninguna.
    private(set) var respuesta: AnunciosRespuesta?
    /// Por qué falló la última consulta. `nil` si funcionó o si todavía no se hizo ninguna.
    private(set) var fallo: ErrorConsulta?
    private(set) var consultando = false

    @ObservationIgnored private let cliente: ClienteAnuncios
    @ObservationIgnored private let ahora: @Sendable () -> Date

    init(cliente: ClienteAnuncios, ahora: @escaping @Sendable () -> Date = { Date() }) {
        self.cliente = cliente
        self.ahora = ahora
    }

    /// Estado de la fuente que ve la persona. Sin ninguna respuesta es `sinFuente`; con una consulta fallida nunca
    /// es mejor que `degradada`, aunque la última respuesta dijera `activa`.
    var estadoFuente: EstadoFuente {
        guard let estado = respuesta?.fuente.estado, estado != .sinFuente else { return .sinFuente }
        return fallo == nil ? estado : .degradada
    }

    var confianza: ConfianzaFuente {
        switch estadoFuente {
        case .sinFuente: return .ninguna
        case .degradada: return .baja
        case .activa: return respuesta?.fuente.confianza ?? .ninguna
        }
    }

    /// Los anuncios que se pueden mostrar ahora, en el orden del servidor (que ya los ordena por gravedad).
    /// El servidor ya descarta vencidos y repetidos; aquí se repite solo lo mínimo, porque la lista conservada tras
    /// un fallo envejece sin que el servidor pueda quitar lo vencido, y la lista de la pantalla necesita ids únicos.
    var anuncios: [Anuncio] {
        guard let respuesta, estadoFuente != .sinFuente else { return [] }
        let instante = ahora()
        var vistos = Set<String>()
        return respuesta.anuncios.filter { anuncio in
            if let fin = anuncio.vigenciaHasta, fin <= instante { return false }
            return vistos.insert(anuncio.id).inserted
        }
    }

    /// Pide los anuncios. Una sola consulta a la vez; sin reintentos automáticos. Cancelarla (la pantalla dejó de
    /// verse) no cuenta como fallo: la respuesta y la confianza quedan como estaban.
    func actualizar() async {
        guard !consultando else { return }
        consultando = true
        defer { consultando = false }
        do {
            respuesta = try await cliente.consultar()
            fallo = nil
        } catch let error as ErrorConsulta {
            if error != .cancelada { fallo = error }
        } catch is CancellationError {
            // Cancelada sin llegar al cliente: igual que `.cancelada`.
        } catch {
            fallo = .sinConexion
        }
    }
}
