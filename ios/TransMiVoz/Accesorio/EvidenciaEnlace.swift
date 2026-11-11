import ContratoBLE
import CoreBluetooth
import Foundation

/// Qué puede AFIRMAR el transporte de producción sobre la seguridad del enlace, y con qué evidencia. Es el ÚNICO sitio
/// donde cambia `nivelEnlace`: `TransporteCoreBluetooth` solo devuelve lo que diga esta estructura. No toca Core
/// Bluetooth (solo tokens de conexión), así que las pruebas la recorren entera.
///
/// La evidencia es una sola: la lectura protegida de comprobación (Información) de ESTA conexión terminó sin error.
/// El firmware genuino solo atiende esa lectura con el enlace cifrado, autenticado y vinculado; si falta, responde
/// «autenticación insuficiente» y iOS empareja por su cuenta (pide la clave) antes de repetirla.
///
/// Qué NO prueba. Core Bluetooth no expone el nivel de seguridad del enlace ni si existe un vínculo, y a la app le
/// llega lo mismo de un impostor que anuncie el mismo nombre y UUID y sirva la característica sin protección: la
/// lectura termina bien y iOS nunca empareja. Por eso el techo es `.cifradoSinAutenticar` y NUNCA
/// `.cifradoAutenticado`: la política fija (`.exigirAutenticado`) sigue rechazando la sesión. Ni siquiera el cifrado
/// queda probado frente a ese impostor; el nivel solo dice «respondió la lectura protegida, sin autenticar».
/// Ver ea-15-ios-ble-audio.md («Seguridad del enlace») y contrato-ble.md §6 (propuesta pendiente de H3).
///
/// Falla cerrado: sin comprobación, con error, con otra conexión o tras `reiniciar` el nivel es `.desconocido`. La
/// evidencia va atada al token de la conexión en la que se obtuvo y no se guarda en ningún sitio: no pasa a otra
/// conexión ni a otro periférico, y no hay ajuste, bandera ni preferencia que la sustituya.
struct EvidenciaEnlace {
    enum Resultado: Equatable {
        case superada
        case fallida
    }

    private var pedidaEn: Int?
    private var superadaEn: Int?

    /// Nivel que la evidencia permite afirmar para la conexión `vigente` (nil: no hay conexión viva).
    func nivel(vigente: Int?) -> NivelEnlace {
        guard let vigente, superadaEn == vigente else { return .desconocido }
        return .cifradoSinAutenticar
    }

    /// Se pide la lectura protegida de comprobación en la conexión `token`. Lo afirmado antes deja de valer.
    mutating func pedir(token: Int) {
        superadaEn = nil
        pedidaEn = token
    }

    /// Llegó un valor o un error de la característica protegida. Devuelve nil si no había comprobación pedida (el
    /// valor es de otra lectura). Solo cuenta sin error y en la misma conexión en la que se pidió.
    mutating func resolver(conError: Bool, vigente: Int?) -> Resultado? {
        guard let pedida = pedidaEn else { return nil }
        pedidaEn = nil
        guard !conError, pedida == vigente else { return .fallida }
        superadaEn = pedida
        return .superada
    }

    mutating func reiniciar() {
        self = EvidenciaEnlace()
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
