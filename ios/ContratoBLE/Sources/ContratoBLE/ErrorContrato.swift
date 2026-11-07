import Foundation

/// Motivo por el que una trama incumple el contrato. El nombre (`rawValue`)
/// coincide con los códigos de contratos/ble/ y con el C++ del firmware.
/// El orden de las comprobaciones también es el mismo en ambos extremos.
public enum ErrorContrato: String, Error, CaseIterable, Equatable {
    case longitudIncorrecta
    case versionIncompatible
    case bitsReservados
    case capacidadInconsistente
    case perfilInvalido
    case periodoInvalido
    case caducidadInvalida
    case limitesInvalidos
    case saludInvalida
    case banderasIncoherentes
    case centinelaInconsistente
    case valorFueraDeRango
}

extension Data {
    func leerU16(_ i: Int) -> UInt16 {
        UInt16(self[startIndex + i]) | (UInt16(self[startIndex + i + 1]) << 8)
    }

    func leerU32(_ i: Int) -> UInt32 {
        UInt32(leerU16(i)) | (UInt32(leerU16(i + 2)) << 16)
    }
}
