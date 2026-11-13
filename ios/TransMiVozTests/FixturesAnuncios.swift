import Foundation
@testable import TransMiVoz

/// Respuestas JSON de `GET /api/anuncios` con VALORES INVENTADOS («Entidad Ejemplo», rutas «R1» y «R2»). No vienen del
/// servidor real ni de ninguna ejecución: reproducen la FORMA de `AnunciosRespuestaSchema` (`lib/anuncios.ts`) para probar
/// el decodificador y el cliente sin red. Son simulaciones de contrato, no evidencia de que el backend real responda así.
enum FixturesAnuncios {
    // FIXTURE-INICIO activa
    static let activa = #"""
    {"fuente":{"estado":"activa","confianza":"media","entidad":"Entidad Ejemplo","nombre":"Alertas de ejemplo","url":"https://fuente.ejemplo/alertas","consultadoEn":"2026-11-12T15:00:00.000Z","publicadoEn":"2026-11-12T14:59:30.000Z","mensaje":"Hay 2 anuncios vigentes publicados por Entidad Ejemplo. Confírmalo con la entidad antes de decidir."},"anuncios":[{"origen":"oficial","entidad":"Entidad Ejemplo","identificador":"A-1","titulo":"Desvío de ejemplo","descripcion":"Texto de ejemplo.","fecha":"2026-11-12T13:00:00.000Z","vigenciaHasta":"2026-11-12T23:00:00.000Z","afectacion":{"efecto":"desvio","rutas":["R1","R2"]}},{"origen":"oficial","entidad":"Entidad Ejemplo","identificador":"A-2","titulo":"Cierre de ejemplo","descripcion":"Cierre de ejemplo","fecha":null,"vigenciaHasta":null,"afectacion":{"efecto":"sin-servicio","rutas":[]}}]}
    """#
    // FIXTURE-FIN

    // FIXTURE-INICIO sinFuente
    static let sinFuente = #"""
    {"fuente":{"estado":"sin-fuente","confianza":"ninguna","entidad":"Entidad Ejemplo","nombre":"Alertas de ejemplo","url":"https://fuente.ejemplo/alertas","consultadoEn":null,"publicadoEn":null,"mensaje":"No hay una fuente oficial de anuncios conectada en este momento. Esto no significa que no haya novedades en el servicio."},"anuncios":[]}
    """#
    // FIXTURE-FIN

    // FIXTURE-INICIO degradada
    static let degradada = #"""
    {"fuente":{"estado":"degradada","confianza":"baja","entidad":"Entidad Ejemplo","nombre":"Alertas de ejemplo","url":"https://fuente.ejemplo/alertas","consultadoEn":"2026-11-12T14:00:00.000Z","publicadoEn":"2026-11-12T13:59:00.000Z","mensaje":"No pude actualizar los anuncios de TransMilenio. Muestro lo que la fuente publicó el 12 de noviembre de 2026, 08:59; puede estar desactualizado. Esto no significa que no haya novedades en el servicio."},"anuncios":[{"origen":"oficial","entidad":"Entidad Ejemplo","identificador":"A-1","titulo":"Desvío de ejemplo","descripcion":"Texto de ejemplo.","fecha":"2026-11-12T13:00:00.000Z","vigenciaHasta":null,"afectacion":{"efecto":"desvio","rutas":["R1"]}}]}
    """#
    // FIXTURE-FIN

    /// Cambia un trozo del JSON base y falla si el trozo no estaba: una variante que no cambia nada probaría lo contrario.
    static func variante(_ base: String, cambiar buscado: String, por nuevo: String) -> String {
        precondition(base.contains(buscado), "el fixture no contiene «\(buscado)»")
        return base.replacingOccurrences(of: buscado, with: nuevo)
    }

    static func datos(_ json: String) -> Data { Data(json.utf8) }
}
