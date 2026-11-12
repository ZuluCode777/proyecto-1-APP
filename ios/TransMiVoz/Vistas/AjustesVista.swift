import SwiftUI

/// Pestaña Ajustes. El servidor es la primera sección y va directo en la pantalla (mismos identificadores que
/// cuando la pestaña se llamaba Servidor). Preferencias, Favoritas y Ayuda están en el menú «Más ajustes» de la barra:
/// debajo del formulario del servidor, con texto grande, sus filas quedarían cortadas por la barra de pestañas.
struct AjustesVista: View {
    let entorno: EntornoApp

    private enum Seccion: Hashable { case preferencias, favoritas, ayuda }

    @State private var seccion: Seccion?

    var body: some View {
        NavigationStack {
            AjustesServidorVista(modelo: entorno.ajustes, avisoModoPruebas: entorno.modoPruebas)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) {
                        Menu {
                            Button { seccion = .preferencias } label: { Label("Preferencias", systemImage: "slider.horizontal.3") }
                                .accessibilityIdentifier("ajustes-preferencias")
                            Button { seccion = .favoritas } label: { Label("Favoritas", systemImage: "heart") }
                                .accessibilityIdentifier("ajustes-favoritas")
                            Button { seccion = .ayuda } label: { Label("Ayuda", systemImage: "questionmark.circle") }
                                .accessibilityIdentifier("ajustes-ayuda")
                        } label: {
                            Label("Más ajustes", systemImage: "ellipsis.circle")
                        }
                        .accessibilityHint("Preferencias, Favoritas y Ayuda")
                        .accessibilityIdentifier("menu-mas-ajustes")
                    }
                }
                .navigationDestination(item: $seccion) { seccion in
                    switch seccion {
                    case .preferencias: PreferenciasVista(accesorio: entorno.accesorio)
                    case .favoritas: FavoritasVista(modelo: entorno.favoritas)
                    case .ayuda: AyudaVista()
                    }
                }
        }
    }
}
