import SwiftUI

/// Cinco pestañas: sesión local (sin red), consulta de transporte, avisos locales, lupa de la cámara y ajustes. La
/// sesión es la del accesorio real; solo las pruebas de interfaz muestran la simulada.
struct RaizVista: View {
    let entorno: EntornoApp

    @Environment(\.scenePhase) private var faseEscena

    var body: some View {
        TabView {
            if let accesorio = entorno.accesorio {
                SesionAccesorioVista(modelo: accesorio, avisoSintetico: entorno.modoPruebas)
                    .tabItem { Label("Sesión", systemImage: "dot.radiowaves.left.and.right") }
            } else {
                SesionVista(modelo: entorno.sesion, avisoModoPruebas: entorno.modoPruebas)
                    .tabItem { Label("Sesión", systemImage: "dot.radiowaves.left.and.right") }
            }
            ConsultaVista(
                modelo: entorno.consulta,
                resumenServidor: entorno.modoPruebas ? "Modo de pruebas: sin servidor." : entorno.ajustes.resumen,
                avisoModoPruebas: entorno.modoPruebas)
                .tabItem { Label("Consulta", systemImage: "bubble.left.and.text.bubble.right") }
            AvisosVista(centro: entorno.avisos)
                .tabItem { Label("Avisos", systemImage: "bell") }
            LupaVista(modelo: entorno.lupa, avisoSintetico: entorno.modoPruebas)
                .tabItem { Label("Lupa", systemImage: "magnifyingglass") }
            AjustesVista(entorno: entorno)
                .tabItem { Label("Ajustes", systemImage: "gearshape") }
        }
        // Solo en primer plano y activa: inactiva (bloqueo, centro de control) o en segundo plano se suspende.
        .onChange(of: faseEscena) { _, nueva in entorno.accesorio?.escenaActiva(nueva == .active) }
        // Red caída y datos viejos nacen del resultado de la consulta; la consulta no sabe de avisos.
        .onChange(of: entorno.consulta.estado) { _, nuevo in entorno.avisos.consultaCambio(nuevo) }
    }
}
