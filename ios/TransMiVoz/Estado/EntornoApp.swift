import Foundation

/// Dependencias de la app, construidas una sola vez al arrancar.
@MainActor
final class EntornoApp {
    let ajustes: AjustesServidorModelo
    let consulta: ConsultaModelo
    /// Sesión SIMULADA: solo se muestra en las pruebas de interfaz (`modoPruebas`).
    let sesion: SesionLocalModelo
    /// Sesión con el accesorio real por Bluetooth. `nil` en las pruebas de interfaz.
    let accesorio: SesionAccesorioModelo?
    /// Mantiene vivos los avisos de ruta e interrupción de audio.
    private let monitorAudio: MonitorAudioSistema?
    /// `true` solo en las pruebas de interfaz (compilación de depuración).
    let modoPruebas: Bool

    init(
        ajustes: AjustesServidorModelo, consulta: ConsultaModelo, sesion: SesionLocalModelo,
        accesorio: SesionAccesorioModelo? = nil, monitorAudio: MonitorAudioSistema? = nil, modoPruebas: Bool
    ) {
        self.ajustes = ajustes
        self.consulta = consulta
        self.sesion = sesion
        self.accesorio = accesorio
        self.monitorAudio = monitorAudio
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
        let voz = ControlVoz(salida: SintetizadorSistema(), consultarRuta: SintetizadorSistema.rutaActual)
        return EntornoApp(
            ajustes: ajustes, consulta: ConsultaModelo(cliente: cliente), sesion: SesionLocalModelo(),
            accesorio: SesionAccesorioModelo(transporte: TransporteCoreBluetooth(), voz: voz),
            monitorAudio: MonitorAudioSistema(control: voz), modoPruebas: false)
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
