import MapKit
import SwiftUI

/// Mapa de un recorrido o de un viaje (MapKit). Es una ayuda visual: todo lo que dice está también en el listado de
/// la pantalla, que se lee primero. Solo dibuja las coordenadas que el servidor entregó, no pide ubicación ni muestra
/// la de la persona, y no se confía en el color ni en el ancho de la línea para distinguir tramos (el listado los numera).
/// Sin conexión MapKit no baja las calles: queda el trazado sobre un fondo vacío y la nota que lo dice.
/// No se mueve ni se acerca (`interactionModes: []`): es una ayuda visual, y así no atrapa el desplazamiento de la
/// pantalla con una mano.
struct MapaRecorridoVista: View {
    let elementos: ElementosMapa
    let etiqueta: String
    /// En las pruebas de interfaz el mapa no se dibuja: la auditoría de accesibilidad no distingue el contenido de
    /// MapKit y un Simulator sin red no baja calles. La pantalla lo dice y el listado sigue completo.
    let modoPruebas: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if elementos.estaVacio {
                Text(TextoRutas.mapaSinCoordenadas)
                    .foregroundStyle(.textoSecundario)
                    .accessibilityIdentifier("mapa-sin-coordenadas")
            } else if modoPruebas {
                Text(TextoRutas.mapaModoPruebas)
                    .foregroundStyle(.textoSecundario)
                    .accessibilityIdentifier("mapa-recorrido")
            } else {
                mapa
                Text(TextoRutas.mapaNecesitaConexion)
                    .font(.footnote)
                    .foregroundStyle(.textoSecundario)
            }
        }
    }

    @ViewBuilder private var mapa: some View {
        if let encuadre = EncuadreMapa.ajustar(elementos.coordenadas) {
            Map(initialPosition: .region(region(encuadre)), interactionModes: []) {
                ForEach(Array(elementos.lineas.enumerated()), id: \.offset) { indice, linea in
                    MapPolyline(coordinates: linea.map(punto))
                        .stroke(indice == 0 ? Color.blue : Color.indigo, lineWidth: indice == 0 ? 6 : 4)
                }
                ForEach(elementos.marcas) { marca in
                    Marker(marca.titulo, coordinate: punto(marca.coordenada))
                }
            }
            .frame(height: 280)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            // Una sola pieza para VoiceOver: sus marcas y calles no añaden nada al listado, que ya está leído.
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(etiqueta)
            .accessibilityIdentifier("mapa-recorrido")
        }
    }

    private func punto(_ coordenada: Coordenada) -> CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: coordenada.latitud, longitude: coordenada.longitud)
    }

    private func region(_ encuadre: EncuadreMapa) -> MKCoordinateRegion {
        MKCoordinateRegion(
            center: CLLocationCoordinate2D(latitude: encuadre.latitudCentro, longitude: encuadre.longitudCentro),
            span: MKCoordinateSpan(latitudeDelta: encuadre.deltaLatitud, longitudeDelta: encuadre.deltaLongitud))
    }
}
