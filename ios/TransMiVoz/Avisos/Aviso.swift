import ContratoBLE
import Foundation

/// Quién produce un aviso. Un aviso nuevo de una fuente cierra los vigentes de la misma: la situación ya es otra.
enum FuenteAviso: Equatable, Sendable {
    /// La sesión con el accesorio (`SesionAccesorioModelo`).
    case sesion
    /// El resultado de una consulta al servidor (`ConsultaModelo`).
    case consulta
    /// La ubicación. Hoy la app no la usa: la fuente existe para quien la integre (#51).
    case ubicacion
}

/// Las seis clases de aviso local de EA-20 (#46). Cada clase fija su severidad, su fuente y cuánto dura vigente.
enum TipoAviso: String, Equatable, CaseIterable, Sendable {
    /// El accesorio no entrega avisos: se desconectó, falló, fue rechazado, el enlace no es verificable o falta el Bluetooth.
    case accesorioPerdido = "accesorio-perdido"
    /// El sensor dejó de entregar datos vigentes (sin datos o radar no disponible). No es «sin detección».
    case datoVencido = "dato-vencido"
    case gpsImpreciso = "gps-impreciso"
    /// El servidor respondió con datos de TransMilenio antiguos.
    case datosViejos = "datos-viejos"
    case redCaida = "red-caida"
    /// Un objeto o una presencia delante del sensor.
    case proximidad = "proximidad"

    /// Lo físico (accesorio y sensor) es urgente; la calidad de lo que dice el servidor o la ubicación, una advertencia.
    var severidad: PrioridadVoz {
        switch self {
        case .accesorioPerdido, .datoVencido, .proximidad: return .urgente
        case .gpsImpreciso, .datosViejos, .redCaida: return .advertencia
        }
    }

    var fuente: FuenteAviso {
        switch self {
        case .accesorioPerdido, .datoVencido, .proximidad: return .sesion
        case .datosViejos, .redCaida: return .consulta
        case .gpsImpreciso: return .ubicacion
        }
    }

    /// Cuánto dura vigente un aviso si nadie lo cierra antes, o `nil` si no caduca por tiempo. Los de la sesión no caducan: siguen
    /// vigentes mientras dure su estado y la sesión los cierra con `CentroAvisos.retirar` cuando acaba (un temporizador los daría
    /// por vencidos con el objeto todavía delante o el accesorio todavía perdido; la sesión ya baja a «sin datos» sola si dejan de
    /// llegar tramas). Los de la consulta y la ubicación son resultados puntuales y sí envejecen. Propuestas de software, sin medir.
    var vigenciaMs: Milisegundos? {
        switch self {
        case .accesorioPerdido, .datoVencido, .proximidad: return nil
        case .gpsImpreciso: return 10_000
        case .datosViejos, .redCaida: return 120_000
        }
    }

    /// La clase de aviso de un estado del accesorio, o `nil` si el estado no es un aviso (conectando, calibrando, sin
    /// detección...: mensajes de rutina). Sin `default`: un estado nuevo obliga a decidir aquí qué clase es.
    static func de(_ estado: EstadoAccesorio) -> TipoAviso? {
        switch estado {
        case .objetivo, .presencia: return .proximidad
        case .sinDatos, .radarNoDisponible: return .datoVencido
        case .desconectado, .falla, .rechazado, .enlaceNoVerificado, .bluetoothNoDisponible: return .accesorioPerdido
        case .sinAccesorio, .detenido, .conectando, .comprobandoEnlace, .conectado, .calibrando, .sinDeteccion: return nil
        }
    }
}

/// De dónde viene lo que muestra la lista. El anuncio oficial del operador es un tercer origen que traerá #52 en su propia
/// sección: nunca se mezcla con estos.
enum OrigenAviso: Equatable, Sendable {
    /// Lo produce la app con el accesorio o con una consulta reales.
    case propio
    /// Viene de una entrada simulada (pruebas de interfaz): ningún aviso así se presenta como real.
    case simulado
}

/// El último aviso de una clase.
struct Aviso: Identifiable, Equatable {
    var id: TipoAviso { tipo }
    let tipo: TipoAviso
    /// Texto equivalente de lo que se lee en la lista. Es también la clave para no repetir.
    let texto: String
    /// Lo que se dice al repetirlo: `texto` más la reserva «Enlace sin autenticar.» si el enlace con el accesorio no es autenticado.
    let textoVoz: String
    let origen: OrigenAviso
    /// Aviso de la sesión emitido con el enlace sin autenticar: la lista lo declara en su fila.
    let enlaceSinAutenticar: Bool
    /// Desde este instante (reloj monotónico) ya no está vigente. `nil`: no caduca por tiempo y lo cierra su fuente.
    var caducaMs: Milisegundos?
    /// La voz se aplazó por el límite de ritmo: el productor lo reintentará con el estado de entonces.
    var pendienteDeVoz = false

    func vigente(en ahora: Milisegundos) -> Bool { caducaMs.map { ahora < $0 } ?? true }
}

/// Qué pasó al emitir un aviso.
enum ResultadoEmision: Equatable {
    case hablado
    /// No se dijo en voz alta; el aviso consta en la lista.
    case silenciado(MotivoSilencio)
    /// Igual al aviso vigente de su fuente: ni se repite ni se vuelve a listar.
    case duplicado
    /// Demasiados avisos de esa clase en poco tiempo: no se dijo ahora. Consta en la lista y quien lo emite puede reintentar.
    case limitado
}
