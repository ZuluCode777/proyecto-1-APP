import Foundation
import Observation

/// Estado de una petición al planificador.
enum EstadoCarga<Valor: Equatable & Sendable>: Equatable, Sendable {
    case inactivo
    case cargando
    case listo(Valor)
    case fallo(ErrorConsulta)
}

/// Una sola petición vigente a la vez: solo el resultado de la ÚLTIMA llamada llega a `alTerminar`. Una respuesta
/// de una petición reemplazada o invalidada se descarta aunque el cliente ignore la cancelación (misma garantía
/// que `ConsultaModelo`).
@MainActor
final class EjecutorUnico {
    private var tarea: Task<Void, Never>?
    private var generacion = 0

    func ejecutar<Valor: Sendable>(
        _ operacion: @escaping @Sendable () async throws -> Valor,
        alTerminar: @escaping (Result<Valor, ErrorConsulta>) -> Void
    ) {
        generacion += 1
        let miGeneracion = generacion
        tarea?.cancel()
        tarea = Task {
            let resultado: Result<Valor, ErrorConsulta>
            do {
                resultado = .success(try await operacion())
            } catch let error as ErrorConsulta {
                resultado = .failure(error)
            } catch is CancellationError {
                resultado = .failure(.cancelada)
            } catch {
                resultado = .failure(.sinConexion)
            }
            guard miGeneracion == self.generacion, !Task.isCancelled else { return }
            self.tarea = nil
            alTerminar(resultado)
        }
    }

    /// Descarta la petición en curso: su resultado, si llega, no se aplica.
    func invalidar() {
        generacion += 1
        tarea?.cancel()
        tarea = nil
    }
}

private extension EstadoCarga {
    init(_ resultado: Result<Valor, ErrorConsulta>) {
        switch resultado {
        case .success(let valor): self = .listo(valor)
        case .failure(let error): self = .fallo(error)
        }
    }
}

/// Lo que el iPhone necesita para las pantallas de rutas: el cliente del planificador, las favoritas y si corre en
/// las pruebas de interfaz (donde el mapa no se dibuja).
struct ServiciosRutas {
    let cliente: ClientePlanificador
    let favoritas: FavoritasModelo
    let modoPruebas: Bool
}

/// Búsqueda de rutas por código o estación.
@MainActor
@Observable
final class BusquedaRutasModelo {
    var texto: String
    private(set) var estado: EstadoCarga<ResultadoBusquedaRutas> = .inactivo
    /// Por qué no se envió el texto (vacío o demasiado largo); `nil` si se envió.
    private(set) var avisoEntrada: String?
    /// Texto de la última búsqueda enviada, para decir «no encontré rutas para…» y para «Reintentar».
    private(set) var ultimaConsulta: String?

    @ObservationIgnored private let cliente: ClientePlanificador
    @ObservationIgnored private let ejecutor = EjecutorUnico()

    init(cliente: ClientePlanificador, consultaInicial: String? = nil) {
        self.cliente = cliente
        texto = consultaInicial ?? ""
    }

    func buscar() {
        let limpia = texto.trimmingCharacters(in: .whitespacesAndNewlines)
        if limpia.isEmpty || limpia.utf16.count > EntradaPlanificador.maximoConsulta {
            ejecutor.invalidar()
            avisoEntrada = TextoRutas.entradaInvalida(
                limpia.isEmpty ? .vacia : .demasiadoLarga(maximo: EntradaPlanificador.maximoConsulta))
            estado = .inactivo
            return
        }
        avisoEntrada = nil
        ultimaConsulta = limpia
        estado = .cargando
        ejecutor.ejecutar({ [cliente] in try await cliente.buscarRutas(consulta: limpia) }) { [self] resultado in
            estado = EstadoCarga(resultado)
        }
    }

    func reintentar() {
        guard let anterior = ultimaConsulta else { return }
        texto = anterior
        buscar()
    }
}

/// Detalle de una ruta con su recorrido.
@MainActor
@Observable
final class DetalleRutaModelo {
    let codigo: String
    private(set) var estado: EstadoCarga<DetalleRuta> = .inactivo

    @ObservationIgnored private let cliente: ClientePlanificador
    @ObservationIgnored private let ejecutor = EjecutorUnico()

    init(codigo: String, cliente: ClientePlanificador) {
        self.codigo = codigo
        self.cliente = cliente
    }

    func cargar() {
        estado = .cargando
        ejecutor.ejecutar({ [cliente, codigo] in try await cliente.detalleRuta(codigo: codigo) }) { [self] resultado in
            estado = EstadoCarga(resultado)
        }
    }

    /// Carga la primera vez que la pantalla aparece; al volver de otra pantalla conserva lo que ya tiene.
    func cargarSiHaceFalta() {
        if case .inactivo = estado { cargar() }
    }
}

/// Selección estructurada de origen y destino: los dos salen de la lista de lugares del servidor y viajan como datos.
@MainActor
@Observable
final class ViajeModelo {
    private(set) var lugares: EstadoCarga<ListaLugares> = .inactivo
    private(set) var plan: EstadoCarga<PlanViaje> = .inactivo
    private(set) var origen: String?
    private(set) var destino: String?

    @ObservationIgnored private let cliente: ClientePlanificador
    @ObservationIgnored private let ejecutorLugares = EjecutorUnico()
    @ObservationIgnored private let ejecutorPlan = EjecutorUnico()

    init(cliente: ClientePlanificador) {
        self.cliente = cliente
    }

    var puedePlanear: Bool { origen != nil && destino != nil && plan != .cargando }

    func cargarLugares() {
        lugares = .cargando
        ejecutorLugares.ejecutar({ [cliente] in try await cliente.listarLugares() }) { [self] resultado in
            lugares = EstadoCarga(resultado)
        }
    }

    func cargarLugaresSiHaceFalta() {
        if case .inactivo = lugares { cargarLugares() }
    }

    /// Cambiar el origen o el destino descarta el viaje anterior: ya no corresponde a lo elegido.
    func elegirOrigen(_ lugar: String) {
        ejecutorPlan.invalidar()
        origen = lugar
        plan = .inactivo
    }

    func elegirDestino(_ lugar: String) {
        ejecutorPlan.invalidar()
        destino = lugar
        plan = .inactivo
    }

    func planear() {
        guard let origen, let destino, plan != .cargando else { return }
        plan = .cargando
        ejecutorPlan.ejecutar({ [cliente] in try await cliente.planearViaje(origen: origen, destino: destino) }) { [self] resultado in
            plan = EstadoCarga(resultado)
        }
    }
}
