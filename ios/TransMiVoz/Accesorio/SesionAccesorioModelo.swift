import ContratoBLE
import Foundation
import Observation

enum FaseConexion: Equatable {
    case detenida
    case conectando
    case conectada
    /// Se perdió el enlace con la sesión en marcha; se intenta reconectar.
    case perdida
    case falla(MotivoFalla)
}

/// Sesión con el accesorio REAL (Core Bluetooth). Une tres dueños que no se mezclan:
/// - el transporte (`TransporteAccesorio`) solo mueve bytes;
/// - el contrato (`SesionProximidad`, paquete `ContratoBLE`) decide qué trama vale;
/// - la voz (`ControlVoz`) decide si se puede hablar.
///
/// Reglas de esta capa:
/// - Política de autenticación fija y cerrada (`.exigirAutenticado`). No hay ajuste, bandera ni
///   preferencia que la cambie. Con el transporte de producción (`.desconocido`) la sesión
///   queda rechazada en cuanto conecta y no se lee ni se suscribe nada (contrato §6).
/// - Cada conexión lleva un `token` nuevo. Todo evento con otro token se descarta: devoluciones
///   tardías de un periférico anterior, de una sesión detenida o de una reconexión.
/// - Orden de sincronización: Información → notificaciones apagadas y confirmadas → lectura
///   fresca de referencia → notificaciones encendidas. El contrato lista la suscripción antes
///   de la referencia (§5.1, pasos 6 y 7); aquí va al revés, como aclaración de plataforma: Core
///   Bluetooth entrega lecturas y notificaciones por el mismo callback (`didUpdateValueFor`), sin
///   marca que las distinga, y una notificación anterior se tomaría por la referencia (ver
///   `ClasificadorValores`). Es una aclaración propuesta que el responsable del contrato aún no ha
///   revisado; no cambia bytes, política por defecto ni frescura. La misma secuencia sirve para
///   recalibrar (30 s) y para volver al primer plano. Ver contrato-ble.md §5.1.
/// - Plazos: la conexión (incluido el descubrimiento de servicio y características, que el transporte
///   cierra con `.conectado`) y cada paso de la sincronización vencen a los `plazoPasoMs`, contados
///   con el reloj monotónico inyectado. Vencer falla con «no respondió a tiempo»; no hay espera eterna.
///   Esperar la respuesta del permiso o a que el Bluetooth esté disponible no cuenta como conexión.
/// - Búsqueda: la INTENCIÓN de buscar (`busquedaPedida`) es de la persona y sobrevive a lo transitorio
///   (aviso de permiso del sistema que deja la escena inactiva, Bluetooth apagado); el escaneo real
///   (`buscando`) existe solo con la intención, la escena activa y el Bluetooth disponible.
/// - Con la escena inactiva, bloqueada o en segundo plano no se habla ni se procesa nada. Al
///   volver se invalida el estado y se resincroniza (`reanudar` del contrato). No se promete
///   funcionamiento en segundo plano.
/// - Funciona sin red, sin backend, sin GPS y sin micrófono.
@MainActor
@Observable
final class SesionAccesorioModelo {
    /// Una respuesta que tarde más que esto se trata como fallo, no como espera eterna. Vale también
    /// para conectar y descubrir el servicio. Es una propuesta de software, sin medir (banco de EA-12).
    static let plazoPasoMs: Milisegundos = 5_000
    static let intentosMaximosReferencia = 3

    private enum Paso: Equatable {
        case ninguno
        case conectando
        case leyendoInformacion
        case apagandoNotificaciones
        case leyendoReferencia(inicioMs: Milisegundos)
        case encendiendoNotificaciones
        case suscrito
    }

    /// Lo que la persona pidió y la app debe explicar ANTES del aviso de permiso del sistema.
    enum AccionConPermiso: Equatable {
        case buscar
        case iniciar
    }

    private(set) var disponibilidad: DisponibilidadBluetooth = .desconocida
    private(set) var encontrados: [AccesorioDetectado] = []
    /// La persona pidió buscar y no ha parado. Puede estar pendiente (permiso, Bluetooth, escena).
    private(set) var busquedaPedida = false
    private(set) var explicacionPermiso: AccionConPermiso?
    /// Elección explícita de la voz propia; `nil` = por defecto (apagada con VoiceOver activo).
    private(set) var eleccionVozPropia: Bool?
    private(set) var elegido: AccesorioDetectado?
    private(set) var activa = false
    private(set) var suspendida = false
    private(set) var fase: FaseConexion = .detenida
    private(set) var estadoSesion: EstadoSesion = .desconectada
    private(set) var tramasPerdidas = 0
    private(set) var enlaceAutenticado = false
    private(set) var nivelAfirmado: NivelEnlace = .desconocido

    let voz: ControlVoz

    @ObservationIgnored private let transporte: TransporteAccesorio
    @ObservationIgnored private let avisos: AvisosAccesibles
    @ObservationIgnored private let reloj: RelojMonotonico
    @ObservationIgnored private let pausa: @Sendable (Milisegundos) async -> Void
    @ObservationIgnored private var sesion: SesionProximidad?
    @ObservationIgnored private var conexion = 0
    @ObservationIgnored private var paso: Paso = .ninguno
    @ObservationIgnored private var inicioPasoMs: Milisegundos = 0
    @ObservationIgnored private var intentosReferencia = 0
    @ObservationIgnored private var ultimaLocucion: Locucion?
    @ObservationIgnored private var temporizador: Task<Void, Never>?
    @ObservationIgnored private var escaneando = false
    @ObservationIgnored private var ultimoAvisoEstado: String?
    @ObservationIgnored private var avisadoAudioNoDisponible = false

    init(
        transporte: TransporteAccesorio,
        voz: ControlVoz,
        avisos: AvisosAccesibles = AvisosAccesibles(),
        reloj: @escaping RelojMonotonico = RelojDelSistema.ahora,
        pausa: @escaping @Sendable (Milisegundos) async -> Void = { ms in
            try? await Task.sleep(nanoseconds: UInt64(max(0, ms)) * 1_000_000)
        }
    ) {
        self.transporte = transporte
        self.voz = voz
        self.avisos = avisos
        self.reloj = reloj
        self.pausa = pausa
        transporte.receptor = { [weak self] evento, token in self?.recibir(evento, token: token) }
        voz.alRecuperarse = { [weak self] in self?.reanunciar() }
        voz.alPerderRuta = { [weak self] in self?.rutaPerdida() }
        voz.permitida = { [weak self] in self?.vozPropiaActiva ?? false }
    }

    /// Escaneo real: con la intención de buscar, la escena activa y el Bluetooth disponible. Nunca se
    /// presenta «buscando» con el Bluetooth apagado o sin permiso.
    var buscando: Bool { busquedaPedida && !suspendida && disponibilidad == .disponible }

    /// Con VoiceOver activo la voz propia empieza apagada para no hablar dos veces (EA-02 §5, X2). La
    /// persona puede encenderla. Sin VoiceOver empieza encendida.
    var vozPropiaActiva: Bool { eleccionVozPropia ?? !avisos.voiceOverActivo() }

    /// Falso mientras el transporte no pueda afirmar un nivel de seguridad del enlace.
    var enlaceVerificable: Bool { transporte.nivelEnlace != .desconocido }

    var estado: EstadoAccesorio {
        guard activa else { return elegido == nil ? .sinAccesorio : .detenido }
        if disponibilidad != .disponible && disponibilidad != .desconocida {
            return .bluetoothNoDisponible(disponibilidad)
        }
        switch fase {
        case .detenida, .conectando: return .conectando
        case .perdida: return .desconectado
        case .falla(let motivo): return .falla(motivo)
        case .conectada:
            switch estadoSesion {
            case .desconectada: return .conectando
            case .esperandoInformacion: return .conectado
            case .sincronizando: return .calibrando
            case .rechazada(.enlaceNoAutenticado): return .enlaceNoVerificado
            case .rechazada(let motivo): return .rechazado(motivo)
            case .sinDatos(let motivo): return .sinDatos(motivo)
            case .radarNoDisponible(let salud): return .radarNoDisponible(salud)
            case .sinBlanco, .presencia, .objetivo:
                // Defensa extra: ninguna medida cuenta sin un enlace afirmado como autenticado.
                guard enlaceAutenticado, nivelAfirmado == .cifradoAutenticado else { return .enlaceNoVerificado }
                switch estadoSesion {
                case .presencia: return .presencia
                case .objetivo(let distanciaMm, let azimut):
                    return .objetivo(distanciaMm: distanciaMm, azimutCentesimas: azimut)
                default: return .sinDeteccion
                }
            }
        }
    }

    // MARK: Acciones de la persona

    /// Pide buscar. Si el sistema aún no ha preguntado por el permiso, primero se explica (hoja propia,
    /// EA-02 §8) y el aviso del sistema solo sale al continuar.
    func buscar() {
        guard !busquedaPedida else { return }
        if transporte.permisoPorPreguntar { explicacionPermiso = .buscar; return }
        empezarBusqueda()
    }

    private func empezarBusqueda() {
        busquedaPedida = true
        sincronizarEscaneo()
    }

    func dejarDeBuscar() {
        guard busquedaPedida else { return }
        busquedaPedida = false
        sincronizarEscaneo()
    }

    /// La persona aceptó la explicación: ahora sí se hace lo pedido (y aparece el aviso del sistema).
    func continuarTrasExplicacion() {
        guard let accion = explicacionPermiso else { return }
        explicacionPermiso = nil
        // Directo, sin volver a mirar el permiso: el sistema no lo da por preguntado hasta que la persona responde.
        switch accion {
        case .buscar: if !busquedaPedida { empezarBusqueda() }
        case .iniciar: if elegido != nil, !activa { arrancarSesion() }
        }
    }

    /// «Ahora no»: no se pide nada al sistema y el resto de la app sigue igual.
    func cancelarExplicacion() {
        explicacionPermiso = nil
    }

    /// La elección es explícita. Cambiar de accesorio detiene antes la sesión vigente.
    func elegir(_ accesorio: AccesorioDetectado) {
        let habiaSesion = activa
        if activa { detener() }
        elegido = accesorio
        dejarDeBuscar()
        avisoAccesible("Accesorio elegido: \(accesorio.etiqueta).\(habiaSesion ? " La sesión anterior se detuvo." : "")")
    }

    func iniciar() {
        guard elegido != nil, !activa else { return }
        if transporte.permisoPorPreguntar { explicacionPermiso = .iniciar; return }
        arrancarSesion()
    }

    private func arrancarSesion() {
        dejarDeBuscar()
        activa = true
        arrancarConexion(fase: .conectando)
        iniciarTemporizador()
        publicar()
    }

    /// Detiene todo y descarta cualquier medida, aviso o respuesta tardía.
    func detener() {
        conexion += 1
        transporte.desconectar()
        temporizador?.cancel()
        temporizador = nil
        voz.descartarTodo()
        activa = false
        paso = .ninguno
        sesion = nil
        fase = .detenida
        estadoSesion = .desconectada
        tramasPerdidas = 0
        enlaceAutenticado = false
        nivelAfirmado = .desconocido
        ultimaLocucion = nil
        ultimoAvisoEstado = nil
        avisadoAudioNoDisponible = false
    }

    func reconectar() {
        guard elegido != nil else { return }
        detener()
        iniciar()
    }

    /// Elección de la voz propia de la app. Al encenderla se dice el estado de ahora.
    func fijarVozPropia(_ activa: Bool) {
        eleccionVozPropia = activa
        if activa { reanunciar() } else { voz.descartarTodo() }
    }

    /// Escena activa o no (inactiva, bloqueada o en segundo plano). Sin entitlement de
    /// segundo plano la app no recibe nada fuera de primer plano: se suspende y, al
    /// volver, se invalida el estado y se resincroniza.
    func escenaActiva(_ enPrimerPlano: Bool) {
        if !enPrimerPlano {
            guard !suspendida else { return }
            suspendida = true
            voz.descartarTodo()
            ultimaLocucion = nil
            ultimoAvisoEstado = nil
            temporizador?.cancel()
            temporizador = nil
            // Solo se para el escaneo: la intención de buscar se conserva (el aviso de permiso del
            // sistema deja la escena inactiva y no es una orden de la persona de dejar de buscar).
            sincronizarEscaneo()
        } else {
            guard suspendida else { return }
            suspendida = false
            // iOS puede no entregar el fin de una interrupción: se vuelve a mirar el audio de cero.
            voz.escenaVolvio()
            sincronizarEscaneo()
            guard activa else { return }
            if paso == .suscrito {
                sesion?.reanudar()
                empezarReferencia()
            } else {
                // Sincronización a medias o enlace perdido durante la suspensión: de cero.
                conexion += 1
                transporte.desconectar()
                arrancarConexion(fase: .conectando)
            }
            iniciarTemporizador()
            publicar()
        }
    }

    /// Latido periódico (cada 100 ms mientras la sesión corre).
    func evaluar() {
        guard activa, !suspendida else { return }
        let ahora = reloj()
        sesion?.evaluar(ahoraMs: ahora)
        switch paso {
        case .conectando, .leyendoInformacion, .apagandoNotificaciones, .leyendoReferencia, .encendiendoNotificaciones:
            if ahora - inicioPasoMs > Self.plazoPasoMs { fallar(.tiempoAgotado) }
        case .suscrito:
            if sesion?.necesitaReferencia(ahoraMs: ahora) == true { empezarReferencia() }
        case .ninguno:
            break
        }
        publicar()
    }

    // MARK: Eventos del transporte

    func recibir(_ evento: EventoTransporte, token: Int) {
        switch evento {
        case .disponibilidad(let d):
            procesarDisponibilidad(d)
        case .encontrado(let accesorio):
            if buscando && !encontrados.contains(where: { $0.id == accesorio.id }) {
                encontrados.append(accesorio)
                avisoAccesible("Accesorio encontrado: \(accesorio.etiqueta).")
            }
        default:
            guard activa, token == conexion else { return }
            procesarDeConexion(evento)
        }
        publicar()
    }

    private func procesarDisponibilidad(_ d: DisponibilidadBluetooth) {
        disponibilidad = d
        guard d == .disponible else {
            escaneando = false  // el sistema detuvo el escaneo
            encontrados = []
            // Sin permiso, restringido o sin soporte no vuelve solo: la intención se cierra. Apagado sí vuelve.
            if d == .sinPermiso || d == .restringido || d == .noSoportado { busquedaPedida = false }
            if activa {
                // El sistema cortó todas las conexiones: lo que llegue de la anterior ya no vale.
                conexion += 1
                paso = .ninguno
                sesion = sesion.map { SesionProximidad(accesorioElegido: $0.accesorioElegido, politica: .exigirAutenticado, modo: .real) }
                estadoSesion = .desconectada
                voz.descartarTodo()
            }
            return
        }
        sincronizarEscaneo()
        if activa, !suspendida, paso == .ninguno { arrancarConexion(fase: .conectando) }
    }

    private func procesarDeConexion(_ evento: EventoTransporte) {
        if suspendida {
            if case .desconectado = evento { paso = .ninguno }
            return
        }
        switch evento {
        case .conectado(let id):
            guard paso == .conectando else { return }
            nivelAfirmado = transporte.nivelEnlace
            let resultado = sesion?.conectar(accesorio: id, enlace: nivelAfirmado)
            fase = .conectada
            if case .rechazado? = resultado { cerrarPorRechazo(); return }
            esperar(.leyendoInformacion)
            transporte.leerInformacion(token: conexion)
        case .informacion(let datos):
            guard paso == .leyendoInformacion else { return }
            if case .rechazado? = sesion?.registrarInformacion(datos) { cerrarPorRechazo(); return }
            intentosReferencia = 0
            empezarReferencia()
        case .notificacionesFijadas(let activas):
            if !activas, paso == .apagandoNotificaciones {
                esperar(.leyendoReferencia(inicioMs: reloj()))
                transporte.leerMedicion(token: conexion)
            } else if activas, paso == .encendiendoNotificaciones {
                paso = .suscrito
            }
        case .respuestaMedicion(let datos):
            guard case .leyendoReferencia(let inicio) = paso, sesion != nil else { return }
            let resultado = sesion?.registrarReferencia(inicioLecturaMs: inicio, finLecturaMs: reloj(), datos: datos)
            tras(referencia: resultado)
        case .notificacionMedicion(let datos):
            guard paso == .suscrito else { return }
            switch sesion?.recibirNotificacion(datos, recibidaEnMs: reloj()) {
            case .rechazado?: cerrarPorRechazo()
            case .descartado(.arranqueDistinto)?:
                // El accesorio se reinició: se invalida todo y se relee la Información.
                esperar(.leyendoInformacion)
                transporte.leerInformacion(token: conexion)
            default: break
            }
        case .desconectado:
            perderEnlace()
        case .fallo(let motivo):
            fallar(motivo)
        case .disponibilidad, .encontrado:
            break
        }
    }

    private func tras(referencia resultado: ResultadoEvento?) {
        switch resultado {
        case .rechazado?:
            cerrarPorRechazo()
        case .aceptado?:
            intentosReferencia = 0
            encenderNotificaciones()
        case .descartado(.arranqueDistinto)?:
            esperar(.leyendoInformacion)
            transporte.leerInformacion(token: conexion)
        case .descartado(.vencida)?:
            // La referencia sí quedó como ancla; la sesión está en «sin datos vigentes».
            encenderNotificaciones()
        default:
            // Lectura lenta (> 200 ms), repetida, anterior...: se pide otra fresca, con tope.
            intentosReferencia += 1
            if intentosReferencia >= Self.intentosMaximosReferencia {
                fallar(.referenciaNoValida)
            } else {
                esperar(.leyendoReferencia(inicioMs: reloj()))
                transporte.leerMedicion(token: conexion)
            }
        }
    }

    // MARK: Internos

    private func esperar(_ nuevo: Paso) {
        paso = nuevo
        inicioPasoMs = reloj()
    }

    private func empezarReferencia() {
        esperar(.apagandoNotificaciones)
        transporte.fijarNotificaciones(false, token: conexion)
    }

    private func encenderNotificaciones() {
        esperar(.encendiendoNotificaciones)
        transporte.fijarNotificaciones(true, token: conexion)
    }

    /// Conexión nueva (sesión nueva del contrato): ningún dato anterior sobrevive.
    private func arrancarConexion(fase nueva: FaseConexion) {
        guard let elegido else { return }
        conexion += 1
        sesion = SesionProximidad(accesorioElegido: elegido.id, politica: .exigirAutenticado, modo: .real)
        estadoSesion = .desconectada
        tramasPerdidas = 0
        enlaceAutenticado = false
        nivelAfirmado = .desconocido
        intentosReferencia = 0
        fase = nueva
        paso = disponibilidad == .disponible ? .conectando : .ninguno
        inicioPasoMs = reloj()
        // Con el Bluetooth sin confirmar el transporte solo crea su gestor; al estar
        // disponible `procesarDisponibilidad` vuelve a arrancar.
        transporte.conectar(id: elegido.id, token: conexion)
    }

    /// Una trama o un accesorio que incumplen el contrato cierran la sesión: no se reutiliza nada.
    private func cerrarPorRechazo() {
        conexion += 1
        paso = .ninguno
        transporte.desconectar()
        voz.descartarTodo()
    }

    private func fallar(_ motivo: MotivoFalla) {
        conexion += 1
        paso = .ninguno
        transporte.desconectar()
        sesion?.desconectar()
        voz.descartarTodo()
        fase = .falla(motivo)
    }

    private func perderEnlace() {
        guard paso != .ninguno else { return }
        voz.descartarTodo()
        arrancarConexion(fase: .perdida)
    }

    private func iniciarTemporizador() {
        temporizador?.cancel()
        temporizador = Task { [weak self] in
            while let modelo = self, !Task.isCancelled {
                await modelo.pausa(100)
                guard !Task.isCancelled else { return }
                modelo.evaluar()
            }
        }
    }

    /// Copia lo que dice la sesión del contrato a lo que ve la pantalla.
    private func sincronizarDesdeSesion() {
        guard let sesion else { return }
        if estadoSesion != sesion.estado { estadoSesion = sesion.estado }
        if tramasPerdidas != sesion.tramasPerdidas { tramasPerdidas = sesion.tramasPerdidas }
        if enlaceAutenticado != sesion.enlaceAutenticado { enlaceAutenticado = sesion.enlaceAutenticado }
    }

    private func publicar() {
        sincronizarDesdeSesion()
        avisarEnPantalla(vozHablo: anunciar())
    }

    /// Verdadero si la voz propia dijo algo ahora.
    @discardableResult
    private func anunciar() -> Bool {
        guard activa, !suspendida, let locucion = TextoAccesorio.locucion(estado),
              locucion != ultimaLocucion else { return false }
        ultimaLocucion = locucion
        return voz.anunciar(locucion.texto) == .hablado
    }

    /// Vuelve el audio (auriculares de nuevo, fin de una llamada, corte que dejó una locución a medias):
    /// se dice el estado de AHORA. El estado guardado puede haber caducado antes del próximo latido
    /// (`evaluar` corre cada 100 ms), así que primero se revalida con el reloj de ahora: nunca se
    /// vuelve a decir un objeto o una presencia vencidos.
    private func reanunciar() {
        guard activa, !suspendida else { return }
        sesion?.evaluar(ahoraMs: reloj())
        sincronizarDesdeSesion()
        ultimaLocucion = nil
        avisarEnPantalla(vozHablo: anunciar())
    }

    /// Se perdió una ruta privada: aviso accesible y háptica (la voz ya no puede avisar por el altavoz).
    private func rutaPerdida() {
        guard activa, !suspendida else { return }
        avisos.vibrar()
        avisoAccesible(TextoAccesorio.audioSinAuriculares, .urgente)
    }

    // MARK: Avisos accesibles (sin mover el foco)

    /// Anuncios de estado que NO son medidas: bloqueo, fallo, desconexión, Bluetooth, audio no disponible.
    /// Ninguna medida ni alerta del sensor sale por aquí: por VoiceOver el sonido puede ir al altavoz
    /// y esas alertas solo se dicen por la ruta privada de la voz propia (ver `TextoAccesorio.anuncioAccesible`).
    /// Si la voz propia acaba de decir ese estado no se repite por VoiceOver (no hablan dos veces).
    private func avisarEnPantalla(vozHablo: Bool) {
        guard activa, !suspendida else { return }
        let texto = TextoAccesorio.anuncioAccesible(estado)
        if texto != ultimoAvisoEstado {
            ultimoAvisoEstado = texto
            if let texto, !vozHablo { avisos.anunciar(texto, .urgente) }
        }
        // Con el audio no disponible la voz no puede avisar: el aviso va siempre por accesibilidad.
        if voz.audioNoDisponible != avisadoAudioNoDisponible {
            avisadoAudioNoDisponible = voz.audioNoDisponible
            if voz.audioNoDisponible { avisos.anunciar(TextoAccesorio.audioNoDisponibleAviso, .urgente) }
        }
    }

    private func avisoAccesible(_ texto: String, _ prioridad: PrioridadAviso = .rutina) {
        avisos.anunciar(texto, prioridad)
    }

    // MARK: Escaneo

    /// Lleva el escaneo real a lo que toca según la intención, la escena y el Bluetooth. Con el
    /// Bluetooth sin consultar solo se despierta el transporte (crea el gestor y, con él, el aviso de
    /// permiso del sistema); el escaneo empieza cuando llegue `.disponible`.
    private func sincronizarEscaneo() {
        if busquedaPedida && !suspendida && disponibilidad == .desconocida { transporte.buscar() }
        let debe = buscando
        guard debe != escaneando else { return }
        escaneando = debe
        if debe {
            encontrados = []  // escaneo nuevo, lista nueva: no se ofrece lo que ya no se ve
            transporte.buscar()
        } else {
            transporte.dejarDeBuscar()
        }
    }
}

/// Prioridad de un anuncio de accesibilidad (EA-02 §5). `urgente`: bloqueo, rechazo, fallo, desconexión,
/// pérdida de auriculares o audio no disponible; interrumpe lo que VoiceOver esté diciendo. `rutina`:
/// confirmaciones de lo que la persona acaba de hacer (elegir, hallar); prioridad normal del sistema.
/// Ninguna medida del sensor se anuncia por aquí, con ninguna prioridad.
enum PrioridadAviso: Equatable {
    case rutina
    case urgente
}

/// Avisos del sistema para la persona. En producción son los reales (`AvisosAccesibles.sistema`); en
/// pruebas son dobles que anotan.
struct AvisosAccesibles {
    /// Anuncio de accesibilidad (VoiceOver). No mueve el foco.
    var anunciar: @MainActor (String, PrioridadAviso) -> Void = { _, _ in }
    var vibrar: @MainActor () -> Void = {}
    var voiceOverActivo: @MainActor () -> Bool = { false }
}
