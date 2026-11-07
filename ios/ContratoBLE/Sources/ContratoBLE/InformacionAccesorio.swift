import Foundation

public struct Capacidades: OptionSet, Equatable {
    public let rawValue: UInt16
    public init(rawValue: UInt16) { self.rawValue = rawValue }
    /// Mide distancia radial. No certifica exactitud.
    public static let distancia = Capacidades(rawValue: 1 << 0)
    public static let azimut = Capacidades(rawValue: 1 << 1)
    public static let bateria = Capacidades(rawValue: 1 << 2)
    static let validas: UInt16 = 0b111
}

public enum PerfilSalida: UInt8, Equatable {
    case desconocido = 0
    case personas = 1
    case distanciaReflectores = 2
    case nubeDePuntos = 3
}

/// Característica Información (20 bytes). Con capacidad de distancia ausente,
/// los límites describen la ventana de presencia (SEN0395), no un alcance medido.
public struct InformacionAccesorio: Equatable {
    public let versionMayor: UInt8
    public let versionMenor: UInt8
    public let capacidades: Capacidades
    public let idArranque: UInt32
    public let firmwareMayor: UInt8
    public let firmwareMenor: UInt8
    public let firmwareRevision: UInt8
    public let perfil: PerfilSalida
    public let periodoNominalMs: UInt16
    public let caducidadMs: UInt16
    public let distanciaMinimaMm: UInt16
    public let distanciaMaximaMm: UInt16

    /// Lanza `ErrorContrato` si la trama no cumple v1.0.
    public static func decodificar(_ datos: Data) throws -> InformacionAccesorio {
        try decodificarResultado(datos).get()
    }

    static func decodificarResultado(_ datos: Data) -> Result<InformacionAccesorio, ErrorContrato> {
        guard datos.count == ConstantesContrato.longitudTrama else { return .failure(.longitudIncorrecta) }
        guard datos[datos.startIndex] == ConstantesContrato.versionMayor,
              datos[datos.startIndex + 1] == ConstantesContrato.versionMenor
        else { return .failure(.versionIncompatible) }
        let caps = datos.leerU16(2)
        guard caps & ~Capacidades.validas == 0 else { return .failure(.bitsReservados) }
        let capacidades = Capacidades(rawValue: caps)
        if capacidades.contains(.azimut) && !capacidades.contains(.distancia) {
            return .failure(.capacidadInconsistente)
        }
        guard let perfil = PerfilSalida(rawValue: datos[datos.startIndex + 11]) else {
            return .failure(.perfilInvalido)
        }
        let periodo = datos.leerU16(12)
        guard periodo > 0 else { return .failure(.periodoInvalido) }
        let caducidad = datos.leerU16(14)
        guard caducidad == ConstantesContrato.caducidadMs else { return .failure(.caducidadInvalida) }
        let minimo = datos.leerU16(16)
        let maximo = datos.leerU16(18)
        guard maximo > minimo, maximo <= 65534 else { return .failure(.limitesInvalidos) }
        return .success(InformacionAccesorio(
            versionMayor: datos[datos.startIndex],
            versionMenor: datos[datos.startIndex + 1],
            capacidades: capacidades,
            idArranque: datos.leerU32(4),
            firmwareMayor: datos[datos.startIndex + 8],
            firmwareMenor: datos[datos.startIndex + 9],
            firmwareRevision: datos[datos.startIndex + 10],
            perfil: perfil,
            periodoNominalMs: periodo,
            caducidadMs: caducidad,
            distanciaMinimaMm: minimo,
            distanciaMaximaMm: maximo))
    }
}
