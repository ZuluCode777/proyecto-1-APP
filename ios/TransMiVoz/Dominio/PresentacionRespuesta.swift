import Foundation

extension AccionAgente {
    /// Límite de esta app ante la acción: la web abre una pantalla que el iPhone todavía no tiene. La app
    /// no navega sola; lo dice y deja el texto del servidor. `nil` si la acción no abre nada o si el iPhone
    /// tiene la misma pantalla (la ruta ofrece su detalle con el mapa, EA-25).
    var limite: String? {
        switch self {
        case .ninguna:
            return nil
        case .frecuentes:
            return "Esta app todavía no tiene la pantalla de rutas frecuentes: no se abre ninguna lista. Puedes preguntar por una ruta con su código."
        case .gps:
            return "Esta app no usa tu ubicación ni tiene GPS auditivo: no se abre ninguna guía. Para un viaje, escribe desde qué estación sales y a cuál vas."
        case .busqueda:
            return "Esta app no tiene una pantalla propia de la estación."
        case .ruta:
            return nil
        case .viaje:
            return "Esta app no da órdenes de abordaje. El servidor devolvió un recorrido; se muestra solo como información, sin verificar paradas ni sentido."
        }
    }
}

extension RespuestaAgente {
    /// Fecha y procedencia del catálogo cuando el texto que se muestra no las trae: el de un viaje no
    /// se muestra y el aviso seguro de la guardia sustituye al del servidor.
    var procedenciaAparte: String? {
        guard let catalogo else { return nil }
        if case .viaje = accion { return catalogo.procedencia }
        return texto.contains(catalogo.procedencia) ? nil : catalogo.procedencia
    }
}
