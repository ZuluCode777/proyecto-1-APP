import Foundation

/// Dependencias de la app, construidas una sola vez al arrancar.
@MainActor
final class EntornoApp {
    let ajustes: AjustesServidorModelo
    let consulta: ConsultaModelo
    /// Rutas favoritas, guardadas en este iPhone. El detalle de una ruta las agrega y quita.
    let favoritas: FavoritasModelo
    /// Sesión SIMULADA: solo se muestra en las pruebas de interfaz (`modoPruebas`).
    let sesion: SesionLocalModelo
    /// Sesión con el accesorio real por Bluetooth. `nil` solo en las pruebas de interfaz de la sesión simulada;
    /// las del accesorio usan la misma sesión con un transporte sintético rotulado.
    let accesorio: SesionAccesorioModelo?
    /// Mantiene vivos los avisos de ruta e interrupción de audio.
    private let monitorAudio: MonitorAudioSistema?
    /// Lupa de la cámara. En las pruebas de interfaz usa una cámara sintética rotulada.
    let lupa = EntornoApp.crearLupa()
    /// Rutas, detalle y viaje entre dos lugares (EA-25): el cliente del planificador del servidor y las favoritas.
    let serviciosRutas: ServiciosRutas
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
        #if DEBUG
        // En las pruebas de interfaz el planificador es el simulado, rotulado, sin red.
        let planificador: ClientePlanificador
        if modoPruebas {
            planificador = ClientePlanificadorSimulado()
        } else {
            planificador = ClientePlanificadorHTTP { await ajustes.configuracion }
        }
        #else
        let planificador: ClientePlanificador = ClientePlanificadorHTTP { await ajustes.configuracion }
        #endif
        serviciosRutas = ServiciosRutas(cliente: planificador, favoritas: favoritas, modoPruebas: modoPruebas)
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

    /// Lupa de producción: cámara real y avisos del sistema. En depuración, con los argumentos de las pruebas de interfaz,
    /// usa la cámara sintética (sin cámara real ni aviso de permiso del sistema).
    private static func crearLupa() -> LupaModelo {
        #if DEBUG
        let argumentos = ProcessInfo.processInfo.arguments
        if argumentos.contains("-PRUEBAS_UI_SIMULADAS") || argumentos.contains("-PRUEBAS_UI_ACCESORIO_SINTETICO") {
            return LupaModelo(camara: camaraSinteticaParaPruebasUI(argumentos))
        }
        #endif
        return LupaModelo(camara: CamaraLupaAVFoundation(), avisos: .sistema)
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

    /// Cámara de la lupa en las pruebas de interfaz: sin cámara real ni aviso de permiso del sistema. Sin más
    /// argumentos, el permiso está por preguntar y el «sistema» concede. Variantes: `-PRUEBAS_UI_LUPA_PERMISO_CONCEDIDO`
    /// (sin explicación previa), `-PRUEBAS_UI_LUPA_PERMISO_DENEGADO` y `-PRUEBAS_UI_LUPA_SIN_CAMARA`.
    private static func camaraSinteticaParaPruebasUI(_ argumentos: [String]) -> CamaraSintetica {
        let permiso: CamaraSintetica.Permiso =
            argumentos.contains("-PRUEBAS_UI_LUPA_PERMISO_CONCEDIDO") ? .concedido
            : argumentos.contains("-PRUEBAS_UI_LUPA_PERMISO_DENEGADO") ? .porPreguntarYDenegar : .porPreguntar
        return CamaraSintetica(permiso: permiso, hayCamara: !argumentos.contains("-PRUEBAS_UI_LUPA_SIN_CAMARA"))
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
