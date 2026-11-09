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
///   de la referencia (§5.1); aquí va después porque Core Bluetooth entrega lecturas y
///   notificaciones por el mismo callback y una notificación anterior se tomaría por la
///   referencia (ver `ClasificadorValores`). La misma secuencia sirve para recalibrar (30 s)
///   y para volver al primer plano.
/// - Con la escena inactiva, bloqueada o en segundo plano no se habla ni se procesa nada. Al
///   volver se invalida el estado y se resincroniza (`reanudar` del contrato). No se promete
///   funcionamiento en segundo plano.
/// - Funciona sin red, sin backend, sin GPS y sin micrófono.
@MainActor
@Observable
final class SesionAccesorioModelo {
    /// Una respuesta que tarde más que esto se trata como fallo, no como espera eterna.
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

    private(set) var disponibilidad: DisponibilidadBluetooth = .desconocida
    private(set) var encontrados: [AccesorioDetectado] = []
    private(set) var buscando = false
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
    @ObservationIgnored private let reloj: RelojMonotonico
    @ObservationIgnored private let pausa: @Sendable (Milisegundos) async -> Void
    @ObservationIgnored private var sesion: SesionProximidad?
    @ObservationIgnored private var conexion = 0
    @ObservationIgnored private var paso: Paso = .ninguno
    @ObservationIgnored private var inicioPasoMs: Milisegundos = 0
    @ObservationIgnored private var intentosReferencia = 0
    @ObservationIgnored private var ultimaLocucion: Locucion?
    @ObservationIgnored private var temporizador: Task<Void, Never>?

    init(
        transporte: TransporteAccesorio,
        voz: ControlVoz,
        reloj: @escaping RelojMonotonico = RelojDelSistema.ahora,
        pausa: @escaping @Sendable (Milisegundos) async -> Void = { ms in
            try? await Task.sleep(nanoseconds: UInt64(max(0, ms)) * 1_000_000)
        }
    ) {
        self.transporte = transporte
        self.voz = voz
        self.reloj = reloj
        self.pausa = pausa
        transporte.receptor = { [weak self] evento, token in self?.recibir(evento, token: token) }
        voz.alRecuperarse = { [weak self] in self?.reanunciar() }
    }

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

    func buscar() {
        guard !buscando else { return }
        encontrados = []
        buscando = true
        transporte.buscar()
    }

    func dejarDeBuscar() {
        guard buscando else { return }
        buscando = false
        transporte.dejarDeBuscar()
    }

    /// La elección es explícita. Cambiar de accesorio detiene antes la sesión vigente.
    func elegir(_ accesorio: AccesorioDetectado) {
        if activa { detener() }
        elegido = accesorio
        dejarDeBuscar()
    }

    func iniciar() {
        guard elegido != nil, !activa else { return }
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
    }

    func reconectar() {
        guard elegido != nil else { return }
        detener()
        iniciar()
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
            temporizador?.cancel()
            temporizador = nil
            dejarDeBuscar()
        } else {
            guard suspendida else { return }
            suspendida = false
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
        case .leyendoInformacion, .apagandoNotificaciones, .leyendoReferencia, .encendiendoNotificaciones:
            if ahora - inicioPasoMs > Self.plazoPasoMs { fallar(.tiempoAgotado) }
        case .suscrito:
            if sesion?.necesitaReferencia(ahoraMs: ahora) == true { empezarReferencia() }
        case .ninguno, .conectando:
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
            if buscando && !encontrados.contains(where: { $0.id == accesorio.id }) { encontrados.append(accesorio) }
        default:
            guard activa, token == conexion else { return }
            procesarDeConexion(evento)
        }
        publicar()
    }

    private func procesarDisponibilidad(_ d: DisponibilidadBluetooth) {
        disponibilidad = d
        guard d == .disponible else {
            encontrados = []
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
        if buscando { transporte.buscar() }
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

    private func publicar() {
        if let sesion {
            if estadoSesion != sesion.estado { estadoSesion = sesion.estado }
            if tramasPerdidas != sesion.tramasPerdidas { tramasPerdidas = sesion.tramasPerdidas }
            if enlaceAutenticado != sesion.enlaceAutenticado { enlaceAutenticado = sesion.enlaceAutenticado }
        }
        anunciar()
    }

    private func anunciar() {
        guard activa, !suspendida, let locucion = TextoAccesorio.locucion(estado),
              locucion != ultimaLocucion else { return }
        ultimaLocucion = locucion
        voz.anunciar(locucion.texto)
    }

    /// Vuelve el audio (auriculares de nuevo, fin de una llamada): se dice el estado de AHORA.
    private func reanunciar() {
        ultimaLocucion = nil
        anunciar()
    }
}
