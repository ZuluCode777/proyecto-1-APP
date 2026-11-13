import Foundation

/// Marca del mapa: una estación con su coordenada. El título es el mismo nombre que dice el listado.
struct MarcaMapa: Equatable, Identifiable {
    let id: String
    let titulo: String
    let coordenada: Coordenada
}

/// Lo que dibuja el mapa, derivado de los MISMOS datos que el listado (el detalle de la ruta o los tramos del viaje).
/// Solo incluye las coordenadas que el servidor entregó: una estación o un tramo sin ellas queda en el listado y no
/// se dibuja ni se sustituye por otro punto.
struct ElementosMapa: Equatable {
    /// Una línea por tramo (un solo trazado en el detalle de una ruta).
    let lineas: [[Coordenada]]
    let marcas: [MarcaMapa]

    var estaVacio: Bool { lineas.allSatisfy(\.isEmpty) && marcas.isEmpty }

    /// Todas las coordenadas dibujadas, para encuadrar el mapa.
    var coordenadas: [Coordenada] { lineas.flatMap { $0 } + marcas.map(\.coordenada) }

    /// Recorrido de una ruta: su trazado y cada estación del listado que tenga coordenada.
    static func de(detalle: DetalleRuta) -> ElementosMapa {
        ElementosMapa(
            lineas: detalle.trazado.isEmpty ? [] : [detalle.trazado],
            marcas: detalle.estaciones.enumerated().compactMap { indice, estacion in
                estacion.coordenada.map { MarcaMapa(id: "estacion-\(indice)", titulo: estacion.nombre, coordenada: $0) }
            })
    }

    /// Viaje: el trazado de cada tramo, y el abordaje del primero y el descenso de cada uno (así el transbordo
    /// aparece una vez), en el mismo orden en que el listado nombra esas paradas.
    static func de(tramos: [TramoPlan]) -> ElementosMapa {
        guard let primero = tramos.first else { return ElementosMapa(lineas: [], marcas: []) }
        let paradas = [primero.abordaje] + tramos.map(\.descenso)
        return ElementosMapa(
            lineas: tramos.map(\.trazado).filter { !$0.isEmpty },
            marcas: paradas.enumerated().compactMap { indice, parada in
                parada.coordenada.map { MarcaMapa(id: "parada-\(indice)", titulo: parada.nombre, coordenada: $0) }
            })
    }
}

/// Región que encuadra un conjunto de coordenadas, con un margen y un tamaño mínimo (una sola estación no
/// debe quedar a escala de ciudad entera ni de manzana).
struct EncuadreMapa: Equatable {
    static let margen = 1.4
    /// Unos 550 m de latitud.
    static let deltaMinimo = 0.005

    let latitudCentro: Double
    let longitudCentro: Double
    let deltaLatitud: Double
    let deltaLongitud: Double

    /// `nil` sin coordenadas.
    static func ajustar(_ coordenadas: [Coordenada]) -> EncuadreMapa? {
        guard let primera = coordenadas.first else { return nil }
        var latitudes = primera.latitud...primera.latitud
        var longitudes = primera.longitud...primera.longitud
        for coordenada in coordenadas {
            latitudes = min(latitudes.lowerBound, coordenada.latitud)...max(latitudes.upperBound, coordenada.latitud)
            longitudes = min(longitudes.lowerBound, coordenada.longitud)...max(longitudes.upperBound, coordenada.longitud)
        }
        return EncuadreMapa(
            latitudCentro: (latitudes.lowerBound + latitudes.upperBound) / 2,
            longitudCentro: (longitudes.lowerBound + longitudes.upperBound) / 2,
            deltaLatitud: max((latitudes.upperBound - latitudes.lowerBound) * margen, deltaMinimo),
            deltaLongitud: max((longitudes.upperBound - longitudes.lowerBound) * margen, deltaMinimo))
    }
}
