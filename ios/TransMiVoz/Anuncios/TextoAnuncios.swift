import Foundation

/// Textos de la sección de anuncios para mostrar y anunciar, en español. Equivalen a `lib/anuncios-texto.ts` de la web;
/// el servidor ya entrega su `mensaje`. Ninguna frase afirma que no haya incidentes: sin fuente, con la fuente caída o
/// sin anuncios vigentes dicen que la app no puede saberlo.
enum TextoAnuncios {
    /// Misma redacción que `AVISO_SIN_GARANTIA` del servidor.
    static let avisoSinGarantia = "Esto no significa que no haya novedades en el servicio."
    static let consultando = "Consultando los anuncios de TransMilenio."
    static let sinConsultar = "Todavía no se han consultado los anuncios."
    static let independencia = "Los anuncios son independientes de la sesión: si fallan, la sesión del accesorio y sus avisos siguen igual."
    static let marcaSimulado = "Simulado · no es un anuncio del operador"
    static let marcaSimuladoAccesible = "Anuncio simulado de demostración. No es un anuncio del operador."

    static func etiqueta(_ estado: EstadoFuente) -> String {
        switch estado {
        case .activa: return "Fuente conectada"
        case .degradada: return "Fuente con problemas, confianza baja"
        case .sinFuente: return "Sin fuente conectada"
        }
    }

    static func etiqueta(_ confianza: ConfianzaFuente) -> String {
        switch confianza {
        case .media: return "Confianza: media"
        case .baja: return "Confianza: baja"
        case .ninguna: return "Confianza: ninguna"
        }
    }

    static func etiqueta(_ efecto: EfectoAnuncio) -> String {
        switch efecto {
        case .sinServicio: return "Sin servicio"
        case .servicioReducido: return "Servicio reducido"
        case .demoras: return "Demoras"
        case .desvio: return "Desvío"
        case .servicioAdicional: return "Servicio adicional"
        case .servicioModificado: return "Servicio modificado"
        case .otro: return "Otro efecto"
        case .desconocido: return "Efecto no informado"
        case .paradaMovida: return "Parada trasladada"
        case .sinEfecto: return "Sin efecto en el servicio"
        case .accesibilidad: return "Problema de accesibilidad"
        }
    }

    /// Fecha legible en la hora de Bogotá (UTC−5 todo el año, sin horario de verano) y en 24 horas, como la web.
    static func fecha(_ fecha: Date) -> String {
        let formato = DateFormatter()
        formato.locale = Locale(identifier: "es_CO")
        formato.timeZone = TimeZone(secondsFromGMT: -5 * 3600)
        formato.dateFormat = "d 'de' MMMM 'de' yyyy, HH:mm"
        return formato.string(from: fecha)
    }

    /// Parte un texto en frases de a una por línea: con el texto más grande, un párrafo largo no cabe entero en la pantalla.
    static func frases(_ texto: String) -> [String] {
        var partes = texto.components(separatedBy: ". ")
        for indice in partes.indices.dropLast() { partes[indice] += "." }
        return partes.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
    }

    /// Qué hacer ante cada fallo. Dos casos tienen redacción propia porque la de la consulta habla de «tu pregunta».
    static func recuperacion(_ error: ErrorConsulta) -> String {
        switch error {
        case .tiempoAgotado: return "El servidor puede estar arrancando. Espera unos segundos y pulsa Reintentar."
        case .sinConexion: return "Revisa Wi-Fi o datos móviles y pulsa Reintentar."
        default: return error.recuperacion
        }
    }

    /// Lo que dice la tarjeta de la fuente, una frase por elemento. Con un fallo propio manda el fallo: el `mensaje` que el
    /// servidor dio en la última respuesta buena (por ejemplo «hay 2 anuncios vigentes») ya no se puede afirmar.
    static func mensaje(respuesta: AnunciosRespuesta?, fallo: ErrorConsulta?) -> [String] {
        guard let fallo else {
            guard let respuesta else { return [sinConsultar, avisoSinGarantia] }
            return frases(respuesta.fuente.mensaje)
        }
        let causa = [fallo.mensaje, recuperacion(fallo)]
        guard let fuente = respuesta?.fuente, fuente.estado != .sinFuente else {
            return ["No pude consultar los anuncios de TransMilenio."] + causa + [avisoSinGarantia]
        }
        let conservado = fuente.publicadoEn.map { "Muestro lo que la fuente publicó el \(Self.fecha($0)); puede estar desactualizado." }
            ?? "Muestro lo último que recibí; puede estar desactualizado."
        return ["No pude actualizar los anuncios de TransMilenio."] + causa + [conservado, avisoSinGarantia]
    }

    /// Quién es la fuente y las dos fechas que conserva. Sin consulta buena lo dice, no inventa una fecha.
    static func lineasDeFuente(_ fuente: FuenteAnuncios?) -> [String] {
        guard let fuente else { return [] }
        var lineas = ["Fuente: \(fuente.entidad)"]
        if let publicado = fuente.publicadoEn { lineas.append("Publicado por la fuente: \(fecha(publicado))") }
        lineas.append("Última consulta exitosa: \(fuente.consultadoEn.map(fecha) ?? "ninguna")")
        return lineas
    }

    // MARK: Un anuncio

    /// Dice quién lo publica y que no hay fuente real detrás.
    static func origenSimulado(_ anuncio: Anuncio) -> String {
        "Origen: contenido de demostración publicado por «\(anuncio.entidad)», sin ninguna fuente real."
    }

    static func marca(_ anuncio: Anuncio) -> String {
        anuncio.origen == .simulado ? marcaSimulado : "Anuncio oficial · \(anuncio.entidad)"
    }

    static func marcaAccesible(_ anuncio: Anuncio) -> String {
        anuncio.origen == .simulado ? marcaSimuladoAccesible : "Anuncio oficial de \(anuncio.entidad)"
    }

    /// La descripción solo vale si dice algo que el título no dice (misma regla que `descripcionUtil` de la web).
    static func descripcionUtil(_ anuncio: Anuncio) -> String? {
        anuncio.descripcion.isEmpty || anuncio.descripcion == anuncio.titulo ? nil : anuncio.descripcion
    }

    static func afectacion(_ anuncio: Anuncio) -> String { "Afectación: \(etiqueta(anuncio.afectacion.efecto))" }

    /// `nil` si la fuente no nombra servicios.
    static func servicios(_ anuncio: Anuncio) -> String? {
        anuncio.afectacion.rutas.isEmpty
            ? nil : "Servicios (identificador de la fuente): \(anuncio.afectacion.rutas.joined(separator: ", "))"
    }

    static func fechaDeInicio(_ anuncio: Anuncio) -> String {
        anuncio.fecha.map { "Fecha: \(fecha($0))" } ?? "Fecha: la fuente no la publica"
    }

    static func vigencia(_ anuncio: Anuncio) -> String {
        anuncio.vigenciaHasta.map { "Vigente hasta \(fecha($0))" } ?? "Sin fecha de fin publicada"
    }

    static func identificador(_ anuncio: Anuncio) -> String { "Identificador: \(anuncio.identificador)" }

    // MARK: Anuncio de accesibilidad

    /// Lo que se anuncia cuando termina una consulta: si falló, el estado de la fuente y cuántos anuncios hay.
    static func resultado(estado: EstadoFuente, cantidad: Int, fallo: Bool) -> String {
        let base = (fallo ? "No pude actualizar los anuncios. " : "") + "\(etiqueta(estado))."
        if estado == .sinFuente { return "\(base) \(avisoSinGarantia)" }
        switch cantidad {
        case 0: return "\(base) No hay anuncios vigentes publicados. \(avisoSinGarantia)"
        case 1: return "\(base) Hay 1 anuncio vigente."
        default: return "\(base) Hay \(cantidad) anuncios vigentes."
        }
    }
}
