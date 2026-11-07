import Foundation

/// Dependencias de la app, construidas una sola vez al arrancar.
@MainActor
final class EntornoApp {
    let ajustes: AjustesServidorModelo
    let consulta: ConsultaModelo
    let sesion: SesionLocalModelo
    /// `true` solo en las pruebas de interfaz (compilación de depuración).
    let modoPruebas: Bool

    init(ajustes: AjustesServidorModelo, consulta: ConsultaModelo, sesion: SesionLocalModelo, modoPruebas: Bool) {
        self.ajustes = ajustes
        self.consulta = consulta
        self.sesion = sesion
        self.modoPruebas = modoPruebas
    }

    static func crear() -> EntornoApp {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-PRUEBAS_UI_SIMULADAS") {
            return crearParaPruebasUI()
        }
        #endif
        let ajustes = AjustesServidorModelo(almacen: AlmacenClaveLlavero())
        let cliente = ClienteAgenteHTTP { await ajustes.configuracion }
        return EntornoApp(ajustes: ajustes, consulta: ConsultaModelo(cliente: cliente), sesion: SesionLocalModelo(), modoPruebas: false)
    }

    #if DEBUG
    /// Sin red, sin Llavero y sin preferencias persistentes: cada ejecución parte limpia.
    private static func crearParaPruebasUI() -> EntornoApp {
        let nombre = "pruebas-ui.transmivoz"
        let preferencias = UserDefaults(suiteName: nombre) ?? .standard
        preferencias.removePersistentDomain(forName: nombre)
        let ajustes = AjustesServidorModelo(almacen: AlmacenClaveEnMemoria(), preferencias: preferencias)
        return EntornoApp(
            ajustes: ajustes, consulta: ConsultaModelo(cliente: ClienteAgenteSimulado()),
            sesion: SesionLocalModelo(), modoPruebas: true)
    }
    #endif
}
