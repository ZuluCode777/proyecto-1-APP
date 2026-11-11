import SwiftUI

/// Tres pestañas: sesión local (sin red), consulta de transporte y servidor. La sesión es la del
/// accesorio real; solo las pruebas de interfaz muestran la simulada.
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
            LupaVista(modelo: entorno.lupa, avisoSintetico: entorno.modoPruebas)
                .tabItem { Label("Lupa", systemImage: "magnifyingglass") }
            AjustesServidorVista(modelo: entorno.ajustes, avisoModoPruebas: entorno.modoPruebas)
                .tabItem { Label("Servidor", systemImage: "server.rack") }
        }
        // Solo en primer plano y activa: inactiva (bloqueo, centro de control) o en segundo plano se suspende.
        .onChange(of: faseEscena) { _, nueva in entorno.accesorio?.escenaActiva(nueva == .active) }
    }
}
