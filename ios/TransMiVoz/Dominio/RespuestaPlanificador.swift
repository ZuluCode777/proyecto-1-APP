import Foundation

/// Respuestas de `POST /api/planificador` (`lib/contrato-planificador.ts`). Igual que `RespuestaAgente`, el
/// decodificador es estricto en la frontera: un valor desconocido, un campo faltante o una coordenada fuera de
/// rango se rechazan como incompatibles. La app NO planea ni interpreta nada: pinta el estado que el servidor
/// decidió (`resultado`, `sentido`, `calendario`, `paradaVerificada`) y solo dibuja las coordenadas que trae.
protocol RespuestaPlanificador: Decodable, Sendable {
    /// Coherencia que el decodificador no comprueba (cotas, textos vacíos, estado con sus datos).
    var esValida: Bool { get }
}

private extension String {
    var tieneTexto: Bool { !trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
}

/// Punto del mapa (`{lat, lng}`). Solo existe con latitud y longitud finitas y dentro de rango.
struct Coordenada: Decodable, Equatable, Sendable {
    let latitud: Double
    let longitud: Double

    enum CodingKeys: String, CodingKey {
        case latitud = "lat"
        case longitud = "lng"
    }

    init(latitud: Double, longitud: Double) {
        self.latitud = latitud
        self.longitud = longitud
    }

    init(from decoder: Decoder) throws {
        let contenedor = try decoder.container(keyedBy: CodingKeys.self)
        let latitud = try contenedor.decode(Double.self, forKey: .latitud)
        let longitud = try contenedor.decode(Double.self, forKey: .longitud)
        guard latitud.isFinite, longitud.isFinite, (-90.0...90.0).contains(latitud), (-180.0...180.0).contains(longitud) else {
            throw DecodingError.dataCorruptedError(
                forKey: .latitud, in: contenedor, debugDescription: "coordenada fuera de rango")
        }
        self.latitud = latitud
        self.longitud = longitud
    }
}

extension ProcedenciaCatalogo {
    /// La frase de procedencia no viene vacía ni desmedida (misma regla que `RespuestaAgente`).
    var esValida: Bool {
        procedencia.tieneTexto && procedencia.count <= RespuestaAgente.maximoCaracteresProcedencia
    }
}

// MARK: Buscar rutas

struct ResumenRuta: Decodable, Equatable, Sendable {
    let codigo: String
    let desde: String
    let hacia: String

    var esValido: Bool { codigo.tieneTexto && desde.tieneTexto && hacia.tieneTexto }
}

struct ResultadoBusquedaRutas: RespuestaPlanificador, Equatable {
    /// `MAX_RUTAS` del servidor.
    static let maximoRutas = 50

    let rutas: [ResumenRuta]
    /// Cuántas rutas coincidían; puede ser mayor que `rutas.count`.
    let total: Int
    let catalogo: ProcedenciaCatalogo

    var esValida: Bool {
        rutas.count <= Self.maximoRutas && total >= rutas.count && rutas.allSatisfy(\.esValido) && catalogo.esValida
    }
}

// MARK: Detalle de una ruta

/// `confirmado` solo con una fuente vigente. Con otro valor la app no afirma el sentido.
enum SentidoRuta: String, Decodable, Equatable, Sendable {
    case confirmado
    case contradictorio
    case sinConfirmar = "sin-confirmar"
}

/// Calendario verificado de hoy. `sinVerificar` no significa «sin servicio».
enum CalendarioRuta: String, Decodable, Equatable, Sendable {
    case opera
    case noOpera = "no-opera"
    case sinVerificar = "sin-verificar"
}

/// Horario publicado por TransMilenio; vacío si no lo publica. No es un calendario verificado.
struct HorarioRuta: Decodable, Equatable, Sendable {
    let entreSemana: String
    let sabado: String
    let festivo: String
}

struct EstacionRuta: Decodable, Equatable, Sendable {
    let nombre: String
    /// `nil` si el catálogo no tiene la coordenada: el listado la nombra y el mapa no la dibuja.
    let coordenada: Coordenada?
    /// Solo si el validador del servidor la acepta como parada donde se puede subir o bajar.
    let paradaVerificada: Bool
}

struct DetalleRuta: RespuestaPlanificador, Equatable {
    static let maximoEstaciones = 200
    static let maximoPuntosTrazado = 1_000

    let codigo: String
    let etiqueta: String
    let desde: String
    let hacia: String
    let sentido: SentidoRuta
    let calendario: CalendarioRuta
    let horario: HorarioRuta
    /// Estaciones CERCANAS AL TRAZADO, en orden; no son paradas confirmadas salvo `paradaVerificada`.
    let estaciones: [EstacionRuta]
    let trazado: [Coordenada]
    let catalogo: ProcedenciaCatalogo

    var esValida: Bool {
        codigo.tieneTexto && desde.tieneTexto && hacia.tieneTexto
            && estaciones.count <= Self.maximoEstaciones && estaciones.allSatisfy { $0.nombre.tieneTexto }
            && trazado.count <= Self.maximoPuntosTrazado && catalogo.esValida
    }
}

// MARK: Lugares

struct ListaLugares: RespuestaPlanificador, Equatable {
    static let maximoLugares = 500

    let lugares: [String]
    let catalogo: ProcedenciaCatalogo

    var esValida: Bool {
        lugares.count <= Self.maximoLugares && lugares.allSatisfy(\.tieneTexto)
            && Set(lugares).count == lugares.count && catalogo.esValida
    }
}

// MARK: Viaje entre dos lugares

struct ParadaViaje: Decodable, Equatable, Sendable {
    let nombre: String
    let coordenada: Coordenada?
}

struct TramoPlan: Decodable, Equatable, Sendable {
    let codigoRuta: String
    let abordaje: ParadaViaje
    let descenso: ParadaViaje
    let estacionesRecorridas: Int
    /// Solo si es `true` puede decirse el número exacto de estaciones.
    let conteoVerificado: Bool
    /// Tramo del trazado entre abordaje y descenso; vacío si falta la coordenada de alguno.
    let trazado: [Coordenada]

    var esValido: Bool {
        codigoRuta.tieneTexto && abordaje.nombre.tieneTexto && descenso.nombre.tieneTexto
            && estacionesRecorridas >= 0 && trazado.count <= DetalleRuta.maximoPuntosTrazado
    }
}

/// Estado del viaje según el servidor. Solo `operativo` trae tramos completos; `candidato` trae solo los códigos de
/// las rutas; solo `recorrido` trae rutas por el trazado.
enum ResultadoViaje: String, Decodable, Equatable, Sendable {
    case operativo
    case candidato
    case recorrido
    case sinRecorrido = "sin-recorrido"
    case mismoLugar = "mismo-lugar"
}

/// Tramo de un servicio candidato en el contrato: solo el código. Cualquier otro campo que mande un servidor (paradas,
/// conteo, trazado) no se decodifica: con la operación sin confirmar serían órdenes de abordaje y la app no los usa.
private struct TramoCandidato: Decodable {
    let codigoRuta: String
}

struct PlanViaje: Equatable, Sendable {
    /// Un viaje tiene como mucho un transbordo.
    static let maximoTramos = 2

    let origen: String
    let destino: String
    let resultado: ResultadoViaje
    /// Tramos completos, con paradas, conteo y trazado: solo en un viaje `operativo`.
    let tramos: [TramoPlan]
    /// Códigos de las rutas de un servicio `candidato`. Sin paradas ni mapa: la operación no está confirmada.
    let codigosCandidatos: [String]
    let rutasPorElTrazado: [ResumenRuta]
    let catalogo: ProcedenciaCatalogo

    init(
        origen: String, destino: String, resultado: ResultadoViaje, tramos: [TramoPlan] = [],
        codigosCandidatos: [String] = [], rutasPorElTrazado: [ResumenRuta] = [], catalogo: ProcedenciaCatalogo
    ) {
        self.origen = origen
        self.destino = destino
        self.resultado = resultado
        self.tramos = tramos
        self.codigosCandidatos = codigosCandidatos
        self.rutasPorElTrazado = rutasPorElTrazado
        self.catalogo = catalogo
    }

    var esValida: Bool {
        guard origen.tieneTexto, destino.tieneTexto, catalogo.esValida, tramos.count <= Self.maximoTramos,
              codigosCandidatos.count <= Self.maximoTramos, codigosCandidatos.allSatisfy(\.tieneTexto),
              rutasPorElTrazado.count <= ResultadoBusquedaRutas.maximoRutas,
              tramos.allSatisfy(\.esValido), rutasPorElTrazado.allSatisfy(\.esValido) else { return false }
        switch resultado {
        case .operativo: return !tramos.isEmpty && codigosCandidatos.isEmpty && rutasPorElTrazado.isEmpty
        case .candidato: return !codigosCandidatos.isEmpty && tramos.isEmpty && rutasPorElTrazado.isEmpty
        case .recorrido: return tramos.isEmpty && codigosCandidatos.isEmpty && !rutasPorElTrazado.isEmpty
        case .sinRecorrido, .mismoLugar: return tramos.isEmpty && codigosCandidatos.isEmpty && rutasPorElTrazado.isEmpty
        }
    }
}

extension PlanViaje: RespuestaPlanificador {
    private enum Claves: String, CodingKey {
        case origen, destino, resultado, tramos, rutasPorElTrazado, catalogo
    }

    init(from decoder: Decoder) throws {
        let contenedor = try decoder.container(keyedBy: Claves.self)
        origen = try contenedor.decode(String.self, forKey: .origen)
        destino = try contenedor.decode(String.self, forKey: .destino)
        resultado = try contenedor.decode(ResultadoViaje.self, forKey: .resultado)
        if resultado == .candidato {
            tramos = []
            codigosCandidatos = try contenedor.decode([TramoCandidato].self, forKey: .tramos).map(\.codigoRuta)
        } else {
            tramos = try contenedor.decode([TramoPlan].self, forKey: .tramos)
            codigosCandidatos = []
        }
        rutasPorElTrazado = try contenedor.decode([ResumenRuta].self, forKey: .rutasPorElTrazado)
        catalogo = try contenedor.decode(ProcedenciaCatalogo.self, forKey: .catalogo)
    }
}
