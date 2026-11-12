import Foundation

/// Dependencias de la app, construidas una sola vez al arrancar.
@MainActor
final class EntornoApp {
    let ajustes: AjustesServidorModelo
    let consulta: ConsultaModelo
    /// Rutas favoritas, guardadas en este iPhone. La pantalla de rutas las agregará con `agregar`.
    let favoritas: FavoritasModelo
    /// Sesión SIMULADA: solo se muestra en las pruebas de interfaz (`modoPruebas`).
    let sesion: SesionLocalModelo
    /// Sesión con el accesorio real por Bluetooth. `nil` solo en las pruebas de interfaz de la sesión simulada;
    /// las del accesorio usan la misma sesión con un transporte sintético rotulado.
    let accesorio: SesionAccesorioModelo?
    /// Mantiene vivos los avisos de ruta e interrupción de audio.
    private let monitorAudio: MonitorAudioSistema?
    /// `true` solo en las pruebas de interfaz (compilación de depuración).
    let modoPruebas: Bool

    init(
        ajustes: AjustesServidorModelo, consulta: ConsultaModelo, favoritas: FavoritasModelo, sesion: SesionLocalModelo,
        accesorio: SesionAccesorioModelo? = nil, monitorAudio: MonitorAudioSistema? = nil, modoPruebas: Bool
    ) {
        self.ajustes = ajustes
        self.consulta = consulta
        self.favoritas = favoritas
        self.sesion = sesion
        self.accesorio = accesorio
        self.monitorAudio = monitorAudio
        self.modoPruebas = modoPruebas
    }

    static func crear() -> EntornoApp {
        #if DEBUG
        let argumentos = ProcessInfo.processInfo.arguments
        if argumentos.contains("-PRUEBAS_UI_SIMULADAS") {
            return crearParaPruebasUI(argumentos: argumentos)
        }
        if argumentos.contains("-PRUEBAS_UI_ACCESORIO_SINTETICO") {
            return crearParaPruebasUIAccesorio(argumentos: argumentos)
        }
        #endif
        let ajustes = AjustesServidorModelo(almacen: AlmacenClaveLlavero())
        let cliente = ClienteAgenteHTTP { await ajustes.configuracion }
        let voz = ControlVoz(salida: SintetizadorSistema(), consultarRuta: SintetizadorSistema.rutaActual)
        return EntornoApp(
            ajustes: ajustes, consulta: ConsultaModelo(cliente: cliente),
            favoritas: FavoritasModelo(almacen: AlmacenFavoritasUserDefaults()), sesion: SesionLocalModelo(),
            accesorio: SesionAccesorioModelo(transporte: TransporteCoreBluetooth(), voz: voz, avisos: .sistema),
            monitorAudio: MonitorAudioSistema(control: voz), modoPruebas: false)
    }

    #if DEBUG
    /// Sin red, sin Llavero y sin preferencias persistentes: cada ejecución parte limpia.
    private static func crearParaPruebasUI(argumentos: [String]) -> EntornoApp {
        let nombre = "pruebas-ui.transmivoz"
        let preferencias = UserDefaults(suiteName: nombre) ?? .standard
        preferencias.removePersistentDomain(forName: nombre)
        let ajustes = AjustesServidorModelo(almacen: AlmacenClaveEnMemoria(), preferencias: preferencias)
        return EntornoApp(
            ajustes: ajustes, consulta: ConsultaModelo(cliente: ClienteAgenteSimulado()),
            favoritas: favoritasDePruebas(preferencias, argumentos: argumentos),
            sesion: SesionLocalModelo(), modoPruebas: true)
    }

    /// Pantalla de producción del accesorio (`SesionAccesorioVista`) con un transporte sintético rotulado:
    /// sin Bluetooth, audio ni red, y con el bloqueo por enlace no verificado intacto. Variantes:
    /// `-PRUEBAS_UI_ACCESORIO_PERMISO_CONCEDIDO` (sin hoja previa) y `-PRUEBAS_UI_ACCESORIO_PERMISO_DENEGADO`.
    private static func crearParaPruebasUIAccesorio(argumentos: [String]) -> EntornoApp {
        let permiso: TransporteSintetico.Permiso =
            argumentos.contains("-PRUEBAS_UI_ACCESORIO_PERMISO_CONCEDIDO") ? .concedido
            : argumentos.contains("-PRUEBAS_UI_ACCESORIO_PERMISO_DENEGADO") ? .porPreguntarYDenegar : .porPreguntar
        let nombre = "pruebas-ui.transmivoz"
        let preferencias = UserDefaults(suiteName: nombre) ?? .standard
        preferencias.removePersistentDomain(forName: nombre)
        let ajustes = AjustesServidorModelo(almacen: AlmacenClaveEnMemoria(), preferencias: preferencias)
        let voz = ControlVoz(salida: SalidaVozSintetica(), consultarRuta: { .noPrivada })
        return EntornoApp(
            ajustes: ajustes, consulta: ConsultaModelo(cliente: ClienteAgenteSimulado()),
            favoritas: favoritasDePruebas(preferencias, argumentos: argumentos), sesion: SesionLocalModelo(),
            accesorio: SesionAccesorioModelo(transporte: TransporteSintetico(permiso: permiso), voz: voz),
            modoPruebas: true)
    }

    /// Favoritas en la suite limpia de las pruebas. Con `-PRUEBAS_UI_FAVORITAS_SEMILLA` parten con dos rutas inventadas
    /// (Z99 y Z98) para recorrer la lista y «Quitar»; sin él parten vacías.
    private static func favoritasDePruebas(_ preferencias: UserDefaults, argumentos: [String]) -> FavoritasModelo {
        let modelo = FavoritasModelo(almacen: AlmacenFavoritasUserDefaults(preferencias: preferencias))
        if argumentos.contains("-PRUEBAS_UI_FAVORITAS_SEMILLA") {
            modelo.agregar("Z99")
            modelo.agregar("Z98")
        }
        return modelo
    }
    #endif
}
