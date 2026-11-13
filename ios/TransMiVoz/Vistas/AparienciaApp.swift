import SwiftUI
import UIKit

/// Aspecto de las barras del sistema, con la paleta de la web: la barra de navegación y la de pestañas son la cabecera lima
/// (`bar`) con la letra y los íconos negros (`foreground`) y un filo del color del contorno (`border`). En oscuro siguen las
/// fichas de `.fluor`: barra casi negra con neón.
///
/// Solo cambia colores, no letras: las barras del sistema escalan su texto con Dynamic Type por su cuenta y una letra propia
/// en ellas lo estropearía. La tinta de los botones de cada pantalla (`tint`) la pone la propia pantalla (ver `InicioVista`).
enum AparienciaApp {
    /// Se llama una vez, al arrancar, antes de crear la primera vista.
    @MainActor static func aplicar() {
        let tinta = UIColor(Paleta.foreground)

        let navegacion = UINavigationBarAppearance()
        navegacion.configureWithOpaqueBackground()
        navegacion.backgroundColor = UIColor(Paleta.bar)
        navegacion.shadowColor = UIColor(Paleta.border)
        navegacion.titleTextAttributes = [.foregroundColor: tinta]
        navegacion.largeTitleTextAttributes = [.foregroundColor: tinta]
        let barraNavegacion = UINavigationBar.appearance()
        barraNavegacion.standardAppearance = navegacion
        barraNavegacion.scrollEdgeAppearance = navegacion
        barraNavegacion.compactAppearance = navegacion
        barraNavegacion.compactScrollEdgeAppearance = navegacion
        barraNavegacion.tintColor = tinta

        let pestanas = UITabBarAppearance()
        pestanas.configureWithOpaqueBackground()
        pestanas.backgroundColor = UIColor(Paleta.bar)
        pestanas.shadowColor = UIColor(Paleta.border)
        // La pestaña activa se distingue por su ícono relleno y por su texto, no solo por el color: las dos llevan la misma tinta.
        for disposicion in [pestanas.stackedLayoutAppearance, pestanas.inlineLayoutAppearance, pestanas.compactInlineLayoutAppearance] {
            for estado in [disposicion.normal, disposicion.selected] {
                estado.iconColor = tinta
                estado.titleTextAttributes = [.foregroundColor: tinta]
            }
        }
        let barraPestanas = UITabBar.appearance()
        barraPestanas.standardAppearance = pestanas
        barraPestanas.scrollEdgeAppearance = pestanas
        barraPestanas.tintColor = tinta
        barraPestanas.unselectedItemTintColor = tinta
    }
}
