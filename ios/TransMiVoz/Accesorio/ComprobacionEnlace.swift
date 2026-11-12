import ContratoBLE
import CoreBluetooth
import Foundation

/// La lectura protegida de comprobación (Información) y lo que la app puede decir de ella. Es el ÚNICO sitio donde
/// cambia `nivelEnlace`: `TransporteCoreBluetooth` solo devuelve lo que diga `nivel(vigente:)`. Traduce los avisos de
/// Core Bluetooth al evento que ve la sesión. No toca Core Bluetooth (solo tokens, `Data?` y motivos ya calculados),
/// así que las pruebas la recorren entera.
///
/// Para qué sirve la lectura: el firmware genuino pone a la característica los permisos GATT «cifrado y autenticado»
/// (`READ_ENC` y `READ_AUTHEN`, con clave de 16 bytes). Si el enlace no los cumple, responde «autenticación
/// insuficiente» y iOS empareja por su cuenta (pide la clave a la persona) antes de repetirla. Es lo único que la app
/// puede hacer para provocar el emparejamiento, y sus errores explican la recuperación.
///
/// Qué afirma, y qué NO prueba. La lectura terminada sin error, en la conexión vigente, permite afirmar como mucho
/// `.cifradoSinAutenticar`: NUNCA `.cifradoAutenticado`. Core Bluetooth no expone el nivel de seguridad del enlace, y a
/// la app le llega lo mismo de un impostor que anuncie el mismo nombre y UUID y sirva la característica sin protección:
/// la lectura termina bien y iOS nunca empareja. Ni el cifrado ni la autenticación quedan probados frente a ese
/// impostor. Ese riesgo lo aceptó A1 el 12/11/2026 solo para la feria, junto con la política `permitirAsociacionSinMITM`
/// (contrato-ble.md §6 y §10): la sesión queda marcada NO autenticada y la interfaz lo dice. Ver
/// ea-15-ios-ble-audio.md («Seguridad del enlace»).
///
/// Falla cerrado: sin comprobación, con error, con otra conexión, sin conexión o tras `reiniciar` el nivel es
/// `.desconocido`. El resultado va atado al token de la conexión en la que se obtuvo y no se guarda en ningún sitio:
/// no pasa a otra conexión ni a otro periférico, y no hay ajuste, bandera ni preferencia que lo sustituya.
struct ComprobacionEnlace {
    private var pedidaEn: Int?
    private var superadaEn: Int?

    /// Nivel que la comprobación permite afirmar para la conexión `vigente` (nil: no hay conexión viva).
    func nivel(vigente: Int?) -> NivelEnlace {
        guard let vigente, superadaEn == vigente else { return .desconocido }
        return .cifradoSinAutenticar
    }

    /// Se pide la lectura de comprobación en la conexión `token`. Lo afirmado antes deja de valer.
    mutating func pedir(token: Int) {
        superadaEn = nil
        pedidaEn = token
    }

    /// Llegó el valor (nil si hubo error) o el error de la característica protegida. Devuelve nil si no había una
    /// comprobación pedida (el valor es de otra lectura). `.lecturaProtegidaSuperada` solo sin error y en la misma
    /// conexión en la que se pidió; cualquier otra cosa es un fallo.
    mutating func eventoDeLectura(valor: Data?, motivoEnlace: MotivoFalla?, vigente: Int?) -> EventoTransporte? {
        guard let pedida = pedidaEn else { return nil }
        pedidaEn = nil
        guard valor != nil, pedida == vigente else { return .fallo(motivoEnlace ?? .enlaceSeguroFallido) }
        superadaEn = pedida
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
