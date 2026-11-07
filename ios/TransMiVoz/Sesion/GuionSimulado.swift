import Foundation

/// Guion de DEMOSTRACIÓN para la sesión local: tramas BLE 1.0 inventadas por
/// esta app, con la bandera de simulación activa. No salen de ningún radar ni
/// de ningún accesorio, y no son los vectores de `contratos/ble/` (esos solo
/// los usan las pruebas). Sirven para mostrar cada estado de la sesión sin
/// hardware y sin red.
///
/// Accesorio inventado: perfil `distanciaReflectores`, capacidades 7, caducidad
/// 500 ms, identificador de arranque 0x55667788, ventana de 100 a 6000 mm.
enum GuionSimulado {
    static let identificadorAccesorio = "accesorio-simulado"

    /// Característica Información (20 bytes) en hexadecimal.
    static let informacion = "0100070088776655000102026400f40164007017"

    struct Paso: Equatable {
        let descripcion: String
        /// Característica Medición (20 bytes) en hexadecimal.
        let trama: String
        /// Milisegundos desde la lectura de referencia en que se entrega la trama.
        let desplazamientoMs: Int
    }

    /// Lectura fresca de referencia (se registra con `registrarReferencia`).
    static let referencia = Paso(descripcion: "referencia sin blanco", trama: "012101008877665588130000ffff00801400ff00", desplazamientoMs: 0)

    /// Notificaciones posteriores, una cada 100 ms.
    static let notificaciones: [Paso] = [
        Paso(descripcion: "sin blanco", trama: "0121020088776655ec130000ffff00801400ff00", desplazamientoMs: 100),
        Paso(descripcion: "sin blanco", trama: "012103008877665550140000ffff00801400ff00", desplazamientoMs: 200),
        Paso(descripcion: "objetivo a 1500 mm", trama: "012f040088776655b4140000dc0548f41400ff00", desplazamientoMs: 300),
        Paso(descripcion: "objetivo a 1200 mm", trama: "012f05008877665518150000b00448f41400ff00", desplazamientoMs: 400),
        Paso(descripcion: "objetivo a 900 mm", trama: "012f0600887766557c1500008403dc051400ff00", desplazamientoMs: 500),
        Paso(descripcion: "objetivo a 900 mm sin dirección", trama: "0127070088776655e0150000840300801400ff00", desplazamientoMs: 600),
        Paso(descripcion: "sin blanco", trama: "012108008877665544160000ffff00801400ff00", desplazamientoMs: 700),
    ]

    static func datos(_ hexadecimal: String) -> Data {
        var datos = Data()
        var indice = hexadecimal.startIndex
        while indice < hexadecimal.endIndex {
            let siguiente = hexadecimal.index(indice, offsetBy: 2)
            datos.append(UInt8(hexadecimal[indice..<siguiente], radix: 16)!)
            indice = siguiente
        }
        return datos
    }
}
