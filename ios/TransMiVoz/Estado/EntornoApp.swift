import Foundation

/// Dependencias de la app, construidas una sola vez al arrancar.
@MainActor
final class EntornoApp {
    let ajustes: AjustesServidorModelo
    let consulta: ConsultaModelo
    /// Anuncios operativos del servidor (EA-26). Independientes de la sesión con el accesorio y de sus avisos.
    let anuncios: AnunciosModelo
    /// Rutas favoritas, guardadas en este iPhone. El detalle de una ruta las agrega y quita.
    let favoritas: FavoritasModelo
    /// Sesión SIMULADA: solo se muestra en las pruebas de interfaz (`modoPruebas`).
    let sesion: SesionLocalModelo
    /// Sesión con el accesorio real por Bluetooth. `nil` solo en las pruebas de interfaz de la sesión simulada;
    /// las del accesorio usan la misma sesión con un transporte sintético rotulado.
    let accesorio: SesionAccesorioModelo?
    /// Avisos locales (EA-20): el de la sesión con el accesorio y los del resultado de la consulta. Es el mismo de la sesión.
    let avisos: CentroAvisos
    /// Mantiene vivos los avisos de ruta e interrupción de audio.
    private let monitorAudio: MonitorAudioSistema?
    /// Lupa de la cámara. En las pruebas de interfaz usa una cámara sintética rotulada.
    let lupa = EntornoApp.crearLupa()
    /// Rutas, detalle y viaje entre dos lugares (EA-25): el cliente del planificador del servidor y las favoritas.
    let serviciosRutas: ServiciosRutas
    /// Modo de visualización (Baja visión o Ceguera total), guardado en este iPhone. En las pruebas de interfaz parte
    /// siempre de Baja visión y no deja nada guardado.
    let modo: ModoAppModelo
    /// `true` solo en las pruebas de interfaz (compilación de depuración).
    let modoPruebas: Bool

    init(
        ajustes: AjustesServidorModelo, consulta: ConsultaModelo, anuncios: AnunciosModelo, favoritas: FavoritasModelo,
        sesion: SesionLocalModelo, avisos: CentroAvisos, accesorio: SesionAccesorioModelo? = nil,
        monitorAudio: MonitorAudioSistema? = nil, modoPruebas: Bool
    ) {
        self.ajustes = ajustes
        self.consulta = consulta
        self.anuncios = anuncios
        self.favoritas = favoritas
        self.sesion = sesion
        self.avisos = avisos
        self.accesorio = accesorio
        self.monitorAudio = monitorAudio
        self.modoPruebas = modoPruebas
        modo = ModoAppModelo(almacen: AlmacenModoUserDefaults(preferencias: Self.preferenciasDelModo(modoPruebas: modoPruebas)))
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

    /// `UserDefaults` normales, o en las pruebas de interfaz una suite que se vacía en cada arranque: ningún modo elegido en una
    /// prueba llega a la siguiente.
    private static func preferenciasDelModo(modoPruebas: Bool) -> UserDefaults {
        guard modoPruebas else { return .standard }
        let nombre = "pruebas-ui.transmivoz.modo"
        let preferencias = UserDefaults(suiteName: nombre) ?? .standard
        preferencias.removePersistentDomain(forName: nombre)
        return preferencias
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
        let avisos = CentroAvisos(voz: voz)
        // La voz del accesorio y la de la consulta son la misma `ControlVoz`: un solo dueño de la sesión de audio y de la cola de uno.
        let dictado = DictadoModelo(reconocedor: ReconocedorSFSpeech(), voz: voz, avisos: .sistema)
        return EntornoApp(
            ajustes: ajustes, consulta: ConsultaModelo(cliente: cliente, dictado: dictado, voz: voz),
            anuncios: AnunciosModelo(cliente: ClienteAnunciosHTTP { await ajustes.configuracion }),
            favoritas: FavoritasModelo(almacen: AlmacenFavoritasUserDefaults()), sesion: SesionLocalModelo(),
            avisos: avisos,
            accesorio: SesionAccesorioModelo(transporte: TransporteCoreBluetooth(), voz: voz, avisos: .sistema, centro: avisos),
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
        // Sin sesión con el accesorio, los avisos de la consulta se listan igual; la voz es de mentira y no sale por altavoz.
        let voz = ControlVoz(salida: SalidaVozSintetica(), consultarRuta: { .noPrivada })
        return EntornoApp(
            ajustes: ajustes, consulta: ConsultaModelo(cliente: ClienteAgenteSimulado(), dictado: dictadoDePruebas(argumentos)),
            anuncios: anunciosDePruebas(argumentos),
            favoritas: favoritasDePruebas(preferencias, argumentos: argumentos),
            sesion: SesionLocalModelo(), avisos: CentroAvisos(voz: voz, origen: .simulado), modoPruebas: true)
    }

    /// Dictado de las pruebas de interfaz: solo con `-PRUEBAS_UI_DICTADO_SINTETICO`, con un reconocedor sintético que la
    /// pantalla rotula (sin micrófono, audio ni reconocimiento real). Sin más argumentos el permiso está por preguntar y el
    /// «sistema» concede. Variantes: `-PRUEBAS_UI_DICTADO_PERMISO_CONCEDIDO` y `-PRUEBAS_UI_DICTADO_PERMISO_DENEGADO`.
    /// `-PRUEBAS_UI_DICTADO_GUION` seguido de las frases que «oye» cada dictado, separadas por `|`.
    private static func dictadoDePruebas(_ argumentos: [String]) -> DictadoModelo? {
        guard argumentos.contains("-PRUEBAS_UI_DICTADO_SINTETICO") else { return nil }
        let permiso: ReconocedorSintetico.Permiso =
            argumentos.contains("-PRUEBAS_UI_DICTADO_PERMISO_CONCEDIDO") ? .concedido
            : argumentos.contains("-PRUEBAS_UI_DICTADO_PERMISO_DENEGADO") ? .porPreguntarYDenegar : .porPreguntar
        var guion = ReconocedorSintetico.guionPorDefecto
        if let clave = argumentos.firstIndex(of: "-PRUEBAS_UI_DICTADO_GUION"), argumentos.indices.contains(clave + 1) {
            guion = argumentos[clave + 1].split(separator: "|").map(String.init)
        }
        return DictadoModelo(reconocedor: ReconocedorSintetico(permiso: permiso, guion: guion))
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
        let avisos = CentroAvisos(voz: voz, origen: .simulado)
        return EntornoApp(
            ajustes: ajustes, consulta: ConsultaModelo(cliente: ClienteAgenteSimulado(), dictado: dictadoDePruebas(argumentos)),
            anuncios: anunciosDePruebas(argumentos),
            favoritas: favoritasDePruebas(preferencias, argumentos: argumentos), sesion: SesionLocalModelo(),
            avisos: avisos,
            accesorio: SesionAccesorioModelo(transporte: TransporteSintetico(permiso: permiso), voz: voz, centro: avisos),
            modoPruebas: true)
    }

    /// Anuncios simulados y rotulados, sin red. Por defecto, la lista; `-PRUEBAS_UI_ANUNCIOS_SIN_FUENTE` deja la fuente sin
    /// conectar y `-PRUEBAS_UI_ANUNCIOS_CAIDA` hace que la primera consulta traiga la lista y las siguientes fallen.
    private static func anunciosDePruebas(_ argumentos: [String]) -> AnunciosModelo {
        let escenario: ClienteAnunciosSimulado.Escenario =
            argumentos.contains("-PRUEBAS_UI_ANUNCIOS_SIN_FUENTE") ? .sinFuente
            : argumentos.contains("-PRUEBAS_UI_ANUNCIOS_CAIDA") ? .caidaTrasExito : .lista
        return AnunciosModelo(cliente: ClienteAnunciosSimulado(escenario: escenario))
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
