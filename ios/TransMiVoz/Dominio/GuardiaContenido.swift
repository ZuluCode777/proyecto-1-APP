import Foundation

/// Guardia de contenido de las respuestas del servidor, equivalente a la
/// política compartida del backend (`contieneImperativoDeViaje` y
/// `respuestaSinImperativos` en `lib/local-agent.ts`; la web la usa en
/// `components/total-agent.tsx`). El servidor sigue siendo la autoridad: aquí
/// solo se evita MOSTRAR órdenes de abordaje que el cliente no puede verificar
/// (paradas, sentido ni vigencia). No planifica ningún viaje.
///
/// Atención: las expresiones y la normalización deben mantenerse iguales a las
/// de TypeScript. Los casos de `GuardiaContenidoTests` repiten los de
/// `lib/local-agent.test.ts` («contieneImperativoDeViaje distingue órdenes…»
/// y «regresión diagnóstico…»).
enum GuardiaContenido {
    /// Mismo aviso seguro que la web (`VIAJE_NO_CONFIRMABLE`).
    static let avisoNoConfirmable =
        "No puedo confirmar las paradas y el horario de ese viaje con los datos actuales, así que no te doy indicaciones de abordaje. Confirma la ruta con TransMilenio."

    /// Equivale a `normalize` de `lib/text.ts` en lo que importa para detectar
    /// órdenes: minúsculas, sin tildes, puntuación como espacio y espacios
    /// colapsados. (Las abreviaturas de direcciones que expande la versión web
    /// no pueden crear ni quitar ninguna de las cuatro frases buscadas.)
    static func normalizar(_ texto: String) -> String {
        let sinTildes = String(String.UnicodeScalarView(
            texto.lowercased().decomposedStringWithCanonicalMapping.unicodeScalars
                .filter { !(0x0300...0x036F).contains($0.value) }))
        let sinPuntuacion = sinTildes.replacingOccurrences(
            of: "[.,;:¿?¡!()\"'«»–—\\-_/]", with: " ", options: .regularExpression)
        // `\s` de JavaScript, escrito explícito para no depender de la definición de ICU.
        let colapsado = sinPuntuacion.replacingOccurrences(
            of: "[\\t\\n\\u000B\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]+",
            with: " ", options: .regularExpression)
        return colapsado.trimmingCharacters(in: CharacterSet(charactersIn: " "))
    }

    // `\b` de JavaScript solo conoce [A-Za-z0-9_]; ICU también cuenta letras no ASCII.
    private static let ini = "(?<![A-Za-z0-9_])"
    private static let fin = "(?![A-Za-z0-9_])"

    /// ¿El texto ORDENA subir, bajar o transbordar («Toma la X en Y», «sube en»,
    /// «bájate en», «cambia a/en»)? No marca frases de incertidumbre como «no
    /// puedo decirte dónde subir o bajar» ni «no te doy indicaciones de abordaje».
    static func contieneOrdenDeViaje(_ texto: String) -> Bool {
        let t = normalizar(texto)
        let patrones = [
            "\(ini)toma la\(fin)[^.]*\(ini)en\(fin)",
            "\(ini)sube en\(fin)",
            "\(ini)bajate en\(fin)",
            "\(ini)cambia (a|en)\(fin)",
        ]
        return patrones.contains { t.range(of: $0, options: .regularExpression) != nil }
    }

    /// ¿Texto y pasos están libres de órdenes de abordaje?
    static func esSegura(_ respuesta: RespuestaAgente) -> Bool {
        if contieneOrdenDeViaje(respuesta.texto) { return false }
        return !respuesta.pasos.contains { paso in
            contieneOrdenDeViaje(paso.etiqueta) || (paso.detalle.map(contieneOrdenDeViaje) ?? false)
        }
    }
}

extension RespuestaAgente {
    /// Lo que la app puede mostrar. Un viaje (`trip`) se presenta solo como
    /// información (su texto y pasos no se muestran), así que pasa tal cual. Una
    /// respuesta de otra acción con órdenes de abordaje en el texto o en algún
    /// paso se sustituye por el aviso seguro, sin pasos ni datos de la acción;
    /// la procedencia del catálogo se conserva.
    func saneada() -> RespuestaAgente {
        if case .viaje = accion { return self }
        guard !GuardiaContenido.esSegura(self) else { return self }
        return RespuestaAgente(
            texto: GuardiaContenido.avisoNoConfirmable, pasos: [], motor: motor, accion: .ninguna, catalogo: catalogo)
    }
}
