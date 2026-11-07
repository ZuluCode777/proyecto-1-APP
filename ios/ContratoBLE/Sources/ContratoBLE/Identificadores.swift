import Foundation

/// UUID del servicio y las características del contrato BLE v1.0.
/// Ni el UUID ni el nombre anunciado autentican al accesorio.
public enum IdentificadoresBLE {
    public static let servicio = "E13A0000-76B8-4FB0-9D2B-8C4F8D8A7E31"
    /// Lectura, exactamente 20 bytes, estable durante un arranque.
    public static let caracteristicaInformacion = "E13A0001-76B8-4FB0-9D2B-8C4F8D8A7E31"
    /// Lectura y notificación, exactamente 20 bytes.
    public static let caracteristicaMedicion = "E13A0002-76B8-4FB0-9D2B-8C4F8D8A7E31"
}

/// Constantes de la versión 1.0.
public enum ConstantesContrato {
    public static let longitudTrama = 20
    public static let versionMayor: UInt8 = 1
    public static let versionMenor: UInt8 = 0
    /// Caducidad única aceptada en v1.0, en ms.
    public static let caducidadMs: UInt16 = 500
    /// Margen por deriva e implementación, en ms. Hipótesis por ensayar.
    public static let margenMs = 20
    /// Una lectura de referencia más lenta que esto no activa la sesión.
    public static let lecturaReferenciaMaximaMs: Int64 = 200
    /// Cada cuánto se repite la lectura de referencia.
    public static let recalibracionMs: Int64 = 30_000
    public static let distanciaDesconocida: UInt16 = 0xFFFF
    public static let azimutDesconocido: Int16 = -32768
    public static let edadDesconocida: UInt16 = 0xFFFF
    public static let bateriaDesconocida: UInt8 = 255
}
