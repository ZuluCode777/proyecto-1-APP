import Foundation
#if canImport(Security)
import Security
#endif

/// Dónde se guarda la clave del servidor. Se asocia al ORIGEN: la clave de un
/// servidor no se ofrece a otro.
protocol AlmacenClave: Sendable {
    func leer(origen: OrigenServidor) throws -> ClaveAcceso?
    func guardar(_ clave: ClaveAcceso, origen: OrigenServidor) throws
    func borrar(origen: OrigenServidor) throws
}

struct ErrorAlmacenClave: Error, Equatable, Sendable {
    let codigo: Int32
}

/// Almacén en memoria, para pruebas y para ejecuciones que no recuerdan la clave.
final class AlmacenClaveEnMemoria: AlmacenClave, @unchecked Sendable {
    private let candado = NSLock()
    private var claves: [OrigenServidor: ClaveAcceso] = [:]

    func leer(origen: OrigenServidor) throws -> ClaveAcceso? {
        candado.lock(); defer { candado.unlock() }
        return claves[origen]
    }

    func guardar(_ clave: ClaveAcceso, origen: OrigenServidor) throws {
        candado.lock(); defer { candado.unlock() }
        claves[origen] = clave
    }

    func borrar(origen: OrigenServidor) throws {
        candado.lock(); defer { candado.unlock() }
        claves[origen] = nil
    }
}

#if canImport(Security)
/// Llavero de iOS: contraseña genérica, solo con el dispositivo desbloqueado y
/// sin pasar a copias de seguridad ni a otros dispositivos.
struct AlmacenClaveLlavero: AlmacenClave {
    private let servicio: String

    init(servicio: String = "co.transmivoz.app.clave-servidor") {
        self.servicio = servicio
    }

    private func consulta(_ origen: OrigenServidor) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: servicio,
            kSecAttrAccount as String: origen.esquemaYAutoridad,
        ]
    }

    func leer(origen: OrigenServidor) throws -> ClaveAcceso? {
        var consulta = consulta(origen)
        consulta[kSecReturnData as String] = true
        consulta[kSecMatchLimit as String] = kSecMatchLimitOne
        var resultado: CFTypeRef?
        let estado = SecItemCopyMatching(consulta as CFDictionary, &resultado)
        if estado == errSecItemNotFound { return nil }
        guard estado == errSecSuccess else { throw ErrorAlmacenClave(codigo: estado) }
        guard let datos = resultado as? Data, let valor = String(data: datos, encoding: .utf8) else { return nil }
        return ClaveAcceso(valor: valor)
    }

    func guardar(_ clave: ClaveAcceso, origen: OrigenServidor) throws {
        let datos = Data(clave.valor.utf8)
        let existente = SecItemUpdate(
            consulta(origen) as CFDictionary,
            [kSecValueData as String: datos] as CFDictionary)
        if existente == errSecSuccess { return }
        guard existente == errSecItemNotFound else { throw ErrorAlmacenClave(codigo: existente) }
        var nuevo = consulta(origen)
        nuevo[kSecValueData as String] = datos
        nuevo[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let estado = SecItemAdd(nuevo as CFDictionary, nil)
        guard estado == errSecSuccess else { throw ErrorAlmacenClave(codigo: estado) }
    }

    func borrar(origen: OrigenServidor) throws {
        let estado = SecItemDelete(consulta(origen) as CFDictionary)
        guard estado == errSecSuccess || estado == errSecItemNotFound else { throw ErrorAlmacenClave(codigo: estado) }
    }
}
#endif
