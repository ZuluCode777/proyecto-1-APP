import CoreBluetooth
import Foundation

/// La lectura protegida de comprobación (Información) y lo que la app puede decir de ella. Traduce los avisos de
/// Core Bluetooth al evento que ve la sesión. No toca Core Bluetooth (solo tokens, `Data?` y motivos ya calculados),
/// así que las pruebas la recorren entera.
///
/// Para qué sirve la lectura: el firmware genuino pone a la característica los permisos GATT «cifrado y autenticado»
/// (`READ_ENC` y `READ_AUTHEN`, con clave de 16 bytes). Si el enlace no los cumple, responde «autenticación
/// insuficiente» y iOS empareja por su cuenta (pide la clave a la persona) antes de repetirla. Es lo único que la app
/// puede hacer para provocar el emparejamiento, y sus errores explican la recuperación.
///
/// Qué NO prueba, y por eso NO sube ningún nivel. Core Bluetooth no expone el nivel de seguridad del enlace, y a la app
/// le llega lo mismo de un impostor que anuncie el mismo nombre y UUID y sirva la característica sin protección: la
/// lectura termina bien y iOS nunca empareja. Ni el cifrado ni la autenticación quedan probados, así que
/// `TransporteCoreBluetooth.nivelEnlace` es siempre `.desconocido`, con o sin esta lectura. Qué debería afirmar el
/// transporte tras ella, y con qué política, es una decisión del usuario y de H3 (contrato-ble.md §6, propuesta
/// pendiente de revisión); aquí no se toma. Ver ea-15-ios-ble-audio.md («Seguridad del enlace»).
///
/// Falla cerrado: la comprobación solo cuenta sin error y en la conexión en la que se pidió. No se guarda nada: el
/// resultado no pasa a otra conexión ni a otro periférico.
struct ComprobacionEnlace {
    private var pedidaEn: Int?

    /// Se pide la lectura de comprobación en la conexión `token`.
    mutating func pedir(token: Int) {
        pedidaEn = token
    }

    /// Llegó el valor (nil si hubo error) o el error de la característica protegida. Devuelve nil si no había una
    /// comprobación pedida (el valor es de otra lectura). `.lecturaProtegidaSuperada` solo sin error y en la misma
    /// conexión en la que se pidió; cualquier otra cosa es un fallo.
    mutating func eventoDeLectura(valor: Data?, motivoEnlace: MotivoFalla?, vigente: Int?) -> EventoTransporte? {
        guard let pedida = pedidaEn else { return nil }
        pedidaEn = nil
        guard valor != nil, pedida == vigente else { return .fallo(motivoEnlace ?? .enlaceSeguroFallido) }
        return .lecturaProtegidaSuperada
    }

    mutating func reiniciar() {
        self = ComprobacionEnlace()
    }

    /// Evento que ve la sesión cuando termina la conexión vigente. Un error del enlace seguro (p. ej. el accesorio
    /// borró el vínculo) es un fallo con su recuperación, no un corte que se reintenta solo; sin él, el fallo de
    /// conexión o el corte de siempre.
    static func eventoDeCorte(motivoEnlace: MotivoFalla?, fallaAlConectar: Bool) -> EventoTransporte {
        if let motivoEnlace { return .fallo(motivoEnlace) }
        return fallaAlConectar ? .fallo(.conexionFallida) : .desconectado
    }

    /// Errores de Core Bluetooth que dicen que el enlace seguro no existe o no se completó. Sirven para explicar
    /// la recuperación; ninguno sube el nivel. Qué código entrega iOS en cada caso está sin medir (banco).
    static func motivo(de error: Error?) -> MotivoFalla? {
        guard let error = error as NSError? else { return nil }
        switch (error.domain, error.code) {
        case (CBErrorDomain, CBError.Code.peerRemovedPairingInformation.rawValue):
            return .vinculoBorradoEnAccesorio
        case (CBErrorDomain, CBError.Code.encryptionTimedOut.rawValue),
             (CBATTErrorDomain, CBATTError.Code.insufficientAuthentication.rawValue),
             (CBATTErrorDomain, CBATTError.Code.insufficientAuthorization.rawValue),
             (CBATTErrorDomain, CBATTError.Code.insufficientEncryptionKeySize.rawValue),
             (CBATTErrorDomain, CBATTError.Code.insufficientEncryption.rawValue):
            return .enlaceSeguroFallido
        default:
            return nil
        }
    }
}

/// Lo único que el transporte conserva de un `Error?` de Core Bluetooth.
struct ResultadoSistema: Equatable {
    let huboError: Bool
    /// El motivo del enlace seguro, si el error es de ese tipo (`ComprobacionEnlace.motivo(de:)`).
    let motivoEnlace: MotivoFalla?

    init(error: Error?) {
        huboError = error != nil
        motivoEnlace = ComprobacionEnlace.motivo(de: error)
    }

    /// El motivo del enlace seguro si lo hay; si no, el que corresponde a la operación que falló.
    func motivo(o respaldo: MotivoFalla) -> MotivoFalla { motivoEnlace ?? respaldo }
}
