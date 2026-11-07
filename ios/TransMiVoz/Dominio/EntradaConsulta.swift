import Foundation

/// Validación del texto en la frontera, ANTES de enviarlo. El servidor recorta en
/// silencio a 300 y rechaza cuerpos de más de 4.000 bytes; el cliente no depende
/// de ese recorte: rechaza lo que no cabe y lo dice.
enum EntradaConsulta {
    /// `MAX_MESSAGE_CHARS` de `app/api/agent/route.ts`. El servidor cuenta
    /// unidades UTF-16 (`String.slice`), igual que `utf16.count`.
    static let maximoCaracteres = 300
    /// `MAXIMO_BYTES_CUERPO` de `app/api/agent/route.ts`.
    static let maximoBytesCuerpo = 4_000

    static func validar(_ texto: String) -> Result<String, ErrorConsulta> {
        let limpio = texto.trimmingCharacters(in: .whitespacesAndNewlines)
        if limpio.isEmpty { return .failure(.entradaInvalida(.vacia)) }
        if limpio.utf16.count > maximoCaracteres {
            return .failure(.entradaInvalida(.demasiadoLarga(maximo: maximoCaracteres)))
        }
        return .success(limpio)
    }
}

/// Cuerpo JSON de `POST /api/agent`. Solo `message`: esta primera versión no
/// envía ubicación (`position` es opcional en el contrato).
struct CuerpoPeticionAgente: Encodable, Equatable {
    let message: String
}
