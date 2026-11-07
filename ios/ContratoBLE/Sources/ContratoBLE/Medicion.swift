import Foundation

public struct BanderasMedicion: OptionSet, Equatable {
    public let rawValue: UInt8
    public init(rawValue: UInt8) { self.rawValue = rawValue }
    public static let resultadoDisponible = BanderasMedicion(rawValue: 1 << 0)
    public static let blancoSeleccionado = BanderasMedicion(rawValue: 1 << 1)
    public static let distanciaValida = BanderasMedicion(rawValue: 1 << 2)
    public static let azimutValido = BanderasMedicion(rawValue: 1 << 3)
    public static let bateriaBaja = BanderasMedicion(rawValue: 1 << 4)
    public static let simulacion = BanderasMedicion(rawValue: 1 << 5)
    static let reservadas: UInt8 = 0xC0
}

public enum SaludRadar: UInt8, Equatable {
    case sinFallo = 0
    case iniciando = 1
    case radarSinDatos = 2
    case tramaRadarInvalida = 3
    case falloDeclarado = 4
    case alimentacionInsuficiente = 5
    case montajeNoValidado = 6
}

/// Característica Medición y salud (20 bytes). Los valores se conservan tal
/// como viajan: los centinelas (`0xFFFF`, `-32768`, `255`) no se traducen.
public struct Medicion: Equatable {
    public let versionMayor: UInt8
    public let banderas: BanderasMedicion
    public let secuencia: UInt16
    public let idArranque: UInt32
    /// Reloj monotónico del accesorio, ms desde el arranque, módulo 2³².
    public let instanteEmisionMs: UInt32
    public let distanciaMm: UInt16
    public let azimutCentesimas: Int16
    /// Antigüedad del resultado del radar al emitir; `0xFFFF` desconocida o vencida.
    public let edadResultadoMs: UInt16
    public let bateriaPorcentaje: UInt8
    public let salud: SaludRadar

    /// Lanza `ErrorContrato`. Incluye las comprobaciones contra la Información
    /// (capacidades y límites). No compara el identificador de arranque: eso
    /// lo decide la sesión.
    public static func decodificar(_ datos: Data, informacion: InformacionAccesorio) throws -> Medicion {
        try decodificarResultado(datos, informacion: informacion).get()
    }

    static func decodificarResultado(_ datos: Data, informacion: InformacionAccesorio)
        -> Result<Medicion, ErrorContrato>
    {
        guard datos.count == ConstantesContrato.longitudTrama else { return .failure(.longitudIncorrecta) }
        let i = datos.startIndex
        guard datos[i] == ConstantesContrato.versionMayor else { return .failure(.versionIncompatible) }
        let crudas = datos[i + 1]
        guard crudas & BanderasMedicion.reservadas == 0 else { return .failure(.bitsReservados) }
        guard let salud = SaludRadar(rawValue: datos[i + 19]) else { return .failure(.saludInvalida) }
        let banderas = BanderasMedicion(rawValue: crudas)
        let distancia = datos.leerU16(12)
        let azimut = Int16(bitPattern: datos.leerU16(14))
        let edad = datos.leerU16(16)
        let bateria = datos[i + 18]

        let resultado = banderas.contains(.resultadoDisponible)
        let blanco = banderas.contains(.blancoSeleccionado)
        let distanciaOk = banderas.contains(.distanciaValida)
        let azimutOk = banderas.contains(.azimutValido)
        let baja = banderas.contains(.bateriaBaja)
        let algunaMedida = resultado || blanco || distanciaOk || azimutOk
        let ca = ConstantesContrato.self

        if !resultado && (blanco || distanciaOk || azimutOk) { return .failure(.banderasIncoherentes) }
        if distanciaOk && !blanco { return .failure(.banderasIncoherentes) }
        if azimutOk && !distanciaOk { return .failure(.banderasIncoherentes) }
        if salud != .sinFallo && algunaMedida { return .failure(.banderasIncoherentes) }
        if edad == ca.edadDesconocida && algunaMedida { return .failure(.banderasIncoherentes) }
        if bateria == ca.bateriaDesconocida && baja { return .failure(.banderasIncoherentes) }

        if !distanciaOk && distancia != ca.distanciaDesconocida { return .failure(.centinelaInconsistente) }
        if distanciaOk && distancia == ca.distanciaDesconocida { return .failure(.centinelaInconsistente) }
        if !azimutOk && azimut != ca.azimutDesconocido { return .failure(.centinelaInconsistente) }
        if azimutOk && azimut == ca.azimutDesconocido { return .failure(.centinelaInconsistente) }

        if azimutOk && (azimut < -9000 || azimut > 9000) { return .failure(.valorFueraDeRango) }
        if bateria != ca.bateriaDesconocida && bateria > 100 { return .failure(.valorFueraDeRango) }

        let caps = informacion.capacidades
        if distanciaOk && !caps.contains(.distancia) { return .failure(.capacidadInconsistente) }
        if azimutOk && !caps.contains(.azimut) { return .failure(.capacidadInconsistente) }
        if (bateria != ca.bateriaDesconocida || baja) && !caps.contains(.bateria) {
            return .failure(.capacidadInconsistente)
        }
        if distanciaOk && (distancia == 0 || distancia < informacion.distanciaMinimaMm
            || distancia > informacion.distanciaMaximaMm)
        {
            return .failure(.valorFueraDeRango)
        }
        return .success(Medicion(
            versionMayor: datos[i], banderas: banderas, secuencia: datos.leerU16(2),
            idArranque: datos.leerU32(4), instanteEmisionMs: datos.leerU32(8),
            distanciaMm: distancia, azimutCentesimas: azimut, edadResultadoMs: edad,
            bateriaPorcentaje: bateria, salud: salud))
    }
}
