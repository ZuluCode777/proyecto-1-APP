import Foundation

/// Cotas de la entrada del planificador (`POST /api/planificador`). Son las de `lib/contrato-planificador.ts`: la
/// prueba `lib/ea25-planificador.test.ts` lee este archivo y las compara. El servidor cuenta unidades UTF-16
/// (`String.length`), igual que `utf16.count`.
enum EntradaPlanificador {
    static let maximoConsulta = 80
    static let maximoCodigo = 12
    static let maximoLugar = 80
    static let maximoBytesCuerpo = 1_000
}

/// Petición al planificador. La selección de origen y destino viaja como DATOS (nombres exactos de la lista de
/// lugares del servidor), nunca como una frase que el servidor deba interpretar.
enum PeticionPlanificador: Equatable, Sendable {
    case buscarRutas(consulta: String)
    case detalleRuta(codigo: String)
    case listarLugares
    case planearViaje(origen: String, destino: String)

    /// La petición con los textos recortados, o `.peticionRechazada` si alguno queda vacío o pasa la cota: no se
    /// envía lo que el servidor rechazaría con 400. La pantalla da sus propios mensajes antes de llegar aquí.
    func validada() -> Result<PeticionPlanificador, ErrorConsulta> {
        func limpiar(_ texto: String, maximo: Int) -> String? {
            let limpio = texto.trimmingCharacters(in: .whitespacesAndNewlines)
            return limpio.isEmpty || limpio.utf16.count > maximo ? nil : limpio
        }
        switch self {
        case .buscarRutas(let consulta):
            guard let consulta = limpiar(consulta, maximo: EntradaPlanificador.maximoConsulta) else {
                return .failure(.peticionRechazada)
            }
            return .success(.buscarRutas(consulta: consulta))
        case .detalleRuta(let codigo):
            guard let codigo = limpiar(codigo, maximo: EntradaPlanificador.maximoCodigo) else {
                return .failure(.peticionRechazada)
            }
            return .success(.detalleRuta(codigo: codigo))
        case .listarLugares:
            return .success(self)
        case .planearViaje(let origen, let destino):
            guard let origen = limpiar(origen, maximo: EntradaPlanificador.maximoLugar),
                  let destino = limpiar(destino, maximo: EntradaPlanificador.maximoLugar) else {
                return .failure(.peticionRechazada)
            }
            return .success(.planearViaje(origen: origen, destino: destino))
        }
    }
}

extension PeticionPlanificador: Encodable {
    private enum Claves: String, CodingKey {
        case operacion, consulta, codigo, origen, destino
    }

    func encode(to encoder: Encoder) throws {
        var contenedor = encoder.container(keyedBy: Claves.self)
        switch self {
        case .buscarRutas(let consulta):
            try contenedor.encode("buscar-rutas", forKey: .operacion)
            try contenedor.encode(consulta, forKey: .consulta)
        case .detalleRuta(let codigo):
            try contenedor.encode("detalle-ruta", forKey: .operacion)
            try contenedor.encode(codigo, forKey: .codigo)
        case .listarLugares:
            try contenedor.encode("listar-lugares", forKey: .operacion)
        case .planearViaje(let origen, let destino):
            try contenedor.encode("planear-viaje", forKey: .operacion)
            try contenedor.encode(origen, forKey: .origen)
            try contenedor.encode(destino, forKey: .destino)
        }
    }
}
