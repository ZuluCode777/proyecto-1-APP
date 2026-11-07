import SwiftUI

/// Tres pestañas: sesión local (sin red), consulta de transporte y servidor.
struct RaizVista: View {
    let entorno: EntornoApp

    var body: some View {
        TabView {
            SesionVista(modelo: entorno.sesion, avisoModoPruebas: entorno.modoPruebas)
                .tabItem { Label("Sesión", systemImage: "dot.radiowaves.left.and.right") }
            ConsultaVista(
                modelo: entorno.consulta,
                resumenServidor: entorno.modoPruebas ? "Modo de pruebas: sin servidor." : entorno.ajustes.resumen,
                avisoModoPruebas: entorno.modoPruebas)
                .tabItem { Label("Consulta", systemImage: "bubble.left.and.text.bubble.right") }
            AjustesServidorVista(modelo: entorno.ajustes, avisoModoPruebas: entorno.modoPruebas)
                .tabItem { Label("Servidor", systemImage: "server.rack") }
        }
    }
}
