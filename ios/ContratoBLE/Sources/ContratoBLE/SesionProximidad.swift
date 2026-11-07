import Foundation

/// Milisegundos de un reloj MONOTÓNICO del iPhone (no el reloj de pared).
/// La sesión nunca resta ese reloj del reloj del ESP32 sin pasar por la referencia.
public typealias Milisegundos = Int64

/// Nivel de seguridad del enlace que AFIRMA el transporte (Core Bluetooth).
/// Un fixture o una prueba de lógica no demuestra ningún enlace físico: la
/// evidencia real (EA-12) decide qué nivel puede afirmar el transporte.
public enum NivelEnlace: String, Equatable {
    case desconocido
    case sinCifrar
    case cifradoSinAutenticar
    case cifradoAutenticado
}

public enum PoliticaAutenticacion: Equatable {
    /// Por defecto y cerrada ante dudas: solo `cifradoAutenticado`.
    case exigirAutenticado
    /// Banco/demo: acepta asociación cifrada sin protección frente a intermediario.
    /// La sesión queda marcada como NO autenticada (`enlaceAutenticado == false`).
    case permitirAsociacionSinMITM
}

public enum ModoSesion: Equatable {
    case real
    case simulada
}

public enum MotivoRechazo: Equatable {
    case accesorioNoElegido
    case enlaceNoAutenticado
    case informacionInvalida(ErrorContrato)
    case perfilDesconocido
    case medicionInvalida(ErrorContrato)
    case simulacionNoCoincide

    public var etiqueta: String {
        switch self {
        case .accesorioNoElegido: return "accesorioNoElegido"
        case .enlaceNoAutenticado: return "enlaceNoAutenticado"
        case .informacionInvalida(let e): return "informacionInvalida:\(e.rawValue)"
        case .perfilDesconocido: return "perfilDesconocido"
        case .medicionInvalida(let e): return "medicionInvalida:\(e.rawValue)"
        case .simulacionNoCoincide: return "simulacionNoCoincide"
        }
    }
}

public enum MotivoDescarte: String, Equatable {
    case estadoIncorrecto
    case sesionNoActiva
    case sinReferencia
    case lecturaReferenciaLenta
    case lecturaReferenciaInvalida
    case arranqueDistinto
    case secuenciaRepetida
    case secuenciaAnterior
    case emisionAnteriorAReferencia
    case relojRetrocede
    case vencida
}

public enum MotivoSinDatos: String, Equatable {
    /// Pasaron más de 500 ms sin trama aceptada.
    case sinRecepcion
    /// La cota de antigüedad superó el límite.
    case vencido
    /// Trama sana sin resultado de radar vigente.
    case sinResultado
}

public enum EstadoSesion: Equatable {
    case desconectada
    case esperandoInformacion
    /// Información válida; falta suscribir y la lectura fresca de referencia.
    case sincronizando
    /// Terminal hasta `conectar` o `desconectar`. Nunca equivale a "sin obstáculos".
    case rechazada(MotivoRechazo)
    case sinDatos(MotivoSinDatos)
    /// Salud distinta de 0 (incluye iniciando); no es "sin blanco".
    case radarNoDisponible(SaludRadar)
    /// Radar sano y sin detección. Nunca decir "camino libre".
    case sinBlanco
    /// Blanco dentro de la ventana, sin distancia ni azimut (SEN0395).
    case presencia
    case objetivo(distanciaMm: Int, azimutCentesimas: Int?)

    public var etiqueta: String {
        switch self {
        case .desconectada: return "desconectada"
        case .esperandoInformacion: return "esperandoInformacion"
        case .sincronizando: return "sincronizando"
        case .rechazada(let m): return "rechazada:\(m.etiqueta)"
        case .sinDatos(let m): return "sinDatos:\(m.rawValue)"
        case .radarNoDisponible(let s): return "radarNoDisponible:\(s.rawValue)"
        case .sinBlanco: return "sinBlanco"
        case .presencia: return "presencia"
        case .objetivo(let d, let a): return "objetivo:\(d):\(a.map(String.init) ?? "-")"
        }
    }
}

public enum ResultadoEvento: Equatable {
    case aceptado
    case descartado(MotivoDescarte)
    case rechazado(MotivoRechazo)

    public var etiqueta: String {
        switch self {
        case .aceptado: return "aceptado"
        case .descartado(let m): return "descartado:\(m.rawValue)"
        case .rechazado(let m): return "rechazado:\(m.etiqueta)"
        }
    }
}

/// Núcleo de la sesión del iPhone con un accesorio. Sin Core Bluetooth, sin
/// temporizadores y sin reloj propio: el transporte entrega eventos con el
/// tiempo monotónico del iPhone.
///
/// Orden del transporte (§8.4): autorización del sistema → escaneo filtrado →
/// conexión al accesorio elegido → `conectar` → lectura de Información →
/// `registrarInformacion` → suscripción → lectura fresca de Medición medida con
/// `t0`/`t1` → `registrarReferencia` → notificaciones con `recibirNotificacion`.
/// Repetir la referencia cuando `necesitaReferencia` sea verdadero y al volver
/// del fondo (`reanudar`). Llamar `evaluar` periódicamente (al menos cada 100 ms
/// con ejecución nativa activa).
///
/// Una trama que viola el contrato rechaza la sesión (terminal): la v1.0 no
/// negocia ni interpreta lo desconocido.
public struct SesionProximidad {
    public let accesorioElegido: String
    public let politica: PoliticaAutenticacion
    public let modo: ModoSesion

    public private(set) var estado: EstadoSesion = .desconectada
    public private(set) var informacion: InformacionAccesorio?
    public private(set) var nivelEnlace: NivelEnlace = .desconocido
    /// Tramas que el accesorio generó y nunca llegaron (saltos de secuencia).
    public private(set) var tramasPerdidas = 0
    /// Última cota superior de antigüedad (sin margen), en ms; nil si la edad era desconocida.
    public private(set) var ultimaCotaEdadMs: Int?

    private var autenticado = false
    private var referencia: Referencia?
    private var ultimaSecuencia: UInt16 = 0
    /// Falso hasta la primera trama aceptada de la conexión y del arranque vigentes.
    /// Es independiente de la referencia: `reanudar` invalida el ancla temporal, no
    /// la secuencia, así que una trama ya vista no puede volver como primera referencia.
    private var haySecuenciaBase = false
    private var ultimoDeltaMs: UInt32 = 0
    private var instanteUltimaTramaAceptada: Milisegundos = 0
    /// Cota de antigüedad (sin margen) de la última trama con resultado vigente, medida
    /// en `instanteUltimaTramaAceptada`; nil si esa trama no traía resultado.
    private var cotaResultadoVigenteMs: Int?

    private struct Referencia {
        let inicioMs: Milisegundos
        let finMs: Milisegundos
        let emisionMs: UInt32
    }

    public init(
        accesorioElegido: String,
        politica: PoliticaAutenticacion = .exigirAutenticado,
        modo: ModoSesion = .real
    ) {
        self.accesorioElegido = accesorioElegido
        self.politica = politica
        self.modo = modo
    }

    /// Solo `cifradoAutenticado` cuenta como autenticado.
    public var enlaceAutenticado: Bool { autenticado }
    /// Verdadero si la sesión es de demostración con tramas simuladas.
    public var esSimulada: Bool { modo == .simulada }

    // MARK: Eventos del transporte

    /// Nueva conexión: descarta todo lo anterior (sesión nueva).
    @discardableResult
    public mutating func conectar(accesorio: String, enlace: NivelEnlace) -> ResultadoEvento {
        reiniciarConexion()
        nivelEnlace = enlace
        guard accesorio == accesorioElegido else { return rechazar(.accesorioNoElegido) }
        switch enlace {
        case .cifradoAutenticado:
            autenticado = true
        case .cifradoSinAutenticar:
            guard politica == .permitirAsociacionSinMITM else { return rechazar(.enlaceNoAutenticado) }
        case .sinCifrar, .desconocido:
            return rechazar(.enlaceNoAutenticado)
        }
        estado = .esperandoInformacion
        return .aceptado
    }

    @discardableResult
    public mutating func registrarInformacion(_ datos: Data) -> ResultadoEvento {
        guard estado == .esperandoInformacion else { return .descartado(.estadoIncorrecto) }
        switch InformacionAccesorio.decodificarResultado(datos) {
        case .failure(let e):
            return rechazar(.informacionInvalida(e))
        case .success(let info):
            guard info.perfil != .desconocido else { return rechazar(.perfilDesconocido) }
            informacion = info
            estado = .sincronizando
            return .aceptado
        }
    }

    /// `inicioLecturaMs` y `finLecturaMs`: reloj del iPhone justo antes de pedir
    /// la lectura fresca de Medición y al recibir su respuesta.
    @discardableResult
    public mutating func registrarReferencia(
        inicioLecturaMs: Milisegundos, finLecturaMs: Milisegundos, datos: Data
    ) -> ResultadoEvento {
        guard estado == .sincronizando || enSesion, let info = informacion else {
            return .descartado(.estadoIncorrecto)
        }
        guard finLecturaMs >= inicioLecturaMs else { return .descartado(.lecturaReferenciaInvalida) }
        guard finLecturaMs - inicioLecturaMs <= ConstantesContrato.lecturaReferenciaMaximaMs else {
            return .descartado(.lecturaReferenciaLenta)
        }
        switch Medicion.decodificarResultado(datos, informacion: info) {
        case .failure(let e):
            return rechazar(.medicionInvalida(e))
        case .success(let medicion):
            return aceptar(medicion, info: info, recibidaEnMs: finLecturaMs,
                           nuevaReferencia: (inicioLecturaMs, finLecturaMs))
        }
    }

    @discardableResult
    public mutating func recibirNotificacion(_ datos: Data, recibidaEnMs: Milisegundos) -> ResultadoEvento {
        if estado == .sincronizando { return .descartado(.sinReferencia) }
        guard enSesion, let info = informacion else { return .descartado(.sesionNoActiva) }
        switch Medicion.decodificarResultado(datos, informacion: info) {
        case .failure(let e):
            return rechazar(.medicionInvalida(e))
        case .success(let medicion):
            return aceptar(medicion, info: info, recibidaEnMs: recibidaEnMs, nuevaReferencia: nil)
        }
    }

    /// Detección de antigüedad por tiempo de recepción: más de 500 ms sin trama
    /// aceptada pasa a `sinDatos(sinRecepcion)`. Además, un resultado vigente caduca
    /// cuando su cota aceptada más el tiempo transcurrido desde su recepción más el
    /// margen supera el límite (`sinDatos(vencido)`). No se repite la última distancia.
    public mutating func evaluar(ahoraMs: Milisegundos) {
        guard let info = informacion else { return }
        switch estado {
        case .sinBlanco, .presencia, .objetivo, .radarNoDisponible:
            let limite = Milisegundos(info.caducidadMs)
            let transcurrido = max(0, ahoraMs - instanteUltimaTramaAceptada)
            if transcurrido > limite {
                estado = .sinDatos(.sinRecepcion)
            } else if let cota = cotaResultadoVigenteMs,
                      Milisegundos(cota) + transcurrido + Milisegundos(ConstantesContrato.margenMs) > limite {
                estado = .sinDatos(.vencido)
            }
        default:
            break
        }
    }

    /// Verdadero si hace falta una lectura fresca de referencia: sincronizando,
    /// o referencia con más de 30 s.
    public func necesitaReferencia(ahoraMs: Milisegundos) -> Bool {
        if estado == .sincronizando { return true }
        guard enSesion, let ref = referencia else { return false }
        return ahoraMs - ref.finMs > ConstantesContrato.recalibracionMs
    }

    /// Al volver del fondo o de una suspensión: invalida el estado previo y
    /// vuelve a sincronizar antes de anunciar medidas. Conserva la secuencia: la
    /// primera referencia posterior no puede repetir ni retroceder la última trama aceptada.
    public mutating func reanudar() {
        guard enSesion else { return }
        referencia = nil
        ultimoDeltaMs = 0
        ultimaCotaEdadMs = nil
        cotaResultadoVigenteMs = nil
        estado = .sincronizando
    }

    public mutating func desconectar() {
        reiniciarConexion()
    }

    // MARK: Internos

    private var enSesion: Bool {
        switch estado {
        case .sinBlanco, .presencia, .objetivo, .radarNoDisponible, .sinDatos: return true
        default: return false
        }
    }

    private mutating func rechazar(_ motivo: MotivoRechazo) -> ResultadoEvento {
        estado = .rechazada(motivo)
        return .rechazado(motivo)
    }

    private mutating func reiniciarConexion() {
        estado = .desconectada
        informacion = nil
        nivelEnlace = .desconocido
        autenticado = false
        referencia = nil
        tramasPerdidas = 0
        ultimaCotaEdadMs = nil
        ultimaSecuencia = 0
        haySecuenciaBase = false
        ultimoDeltaMs = 0
        instanteUltimaTramaAceptada = 0
        cotaResultadoVigenteMs = nil
    }

    private mutating func aceptar(
        _ m: Medicion, info: InformacionAccesorio, recibidaEnMs t: Milisegundos,
        nuevaReferencia: (inicio: Milisegundos, fin: Milisegundos)?
    ) -> ResultadoEvento {
        if m.idArranque != info.idArranque {
            // Reinicio del accesorio: se invalida todo y se relee Información.
            informacion = nil
            referencia = nil
            haySecuenciaBase = false
            ultimaCotaEdadMs = nil
            cotaResultadoVigenteMs = nil
            estado = .esperandoInformacion
            return .descartado(.arranqueDistinto)
        }
        if m.banderas.contains(.simulacion) != (modo == .simulada) {
            return rechazar(.simulacionNoCoincide)
        }

        var delta: UInt32 = 0
        var perdidas = 0
        if haySecuenciaBase {
            // Notificación, recalibración o primera referencia tras `reanudar`: la
            // secuencia debe avanzar (módulo 65536). Solo la primera trama de la
            // conexión o del arranque fija la base sin comparar.
            let d = m.secuencia &- ultimaSecuencia
            if d == 0 { return .descartado(.secuenciaRepetida) }
            if d > 32767 { return .descartado(.secuenciaAnterior) }
            perdidas = Int(d) - 1
        }
        if let ref = referencia {
            // Reloj del accesorio, también en una recalibración: no puede ser anterior a
            // la referencia vigente ni a la última trama aceptada. Se valida antes de
            // reemplazar el ancla o consumir secuencia.
            let desdeReferencia = m.instanteEmisionMs &- ref.emisionMs
            if desdeReferencia >= 0x8000_0000 { return .descartado(.emisionAnteriorAReferencia) }
            if desdeReferencia < ultimoDeltaMs { return .descartado(.relojRetrocede) }
            // La referencia nueva es su propia ancla: delta 0.
            if nuevaReferencia == nil { delta = desdeReferencia }
        }
        if let nueva = nuevaReferencia {
            referencia = Referencia(inicioMs: nueva.inicio, finMs: nueva.fin, emisionMs: m.instanteEmisionMs)
        }
        tramasPerdidas += perdidas
        ultimaSecuencia = m.secuencia
        haySecuenciaBase = true
        ultimoDeltaMs = delta

        guard let ref = referencia else { return .descartado(.sinReferencia) }
        // Cota superior de la antigüedad (§8.4): se usa la cota inferior del desfase,
        // t0 - m_ref, así que sobreestima en vez de subestimar.
        let enBLE = max(0, (t - ref.inicioMs) - Milisegundos(delta))
        let edad = m.edadResultadoMs
        ultimaCotaEdadMs = edad == ConstantesContrato.edadDesconocida ? nil : Int(enBLE) + Int(edad)

        if m.banderas.contains(.resultadoDisponible) {
            let cota = Int(enBLE) + Int(edad)
            if cota + ConstantesContrato.margenMs > Int(info.caducidadMs) {
                estado = .sinDatos(.vencido)
                return .descartado(.vencida)
            }
            instanteUltimaTramaAceptada = t
            cotaResultadoVigenteMs = cota
            if m.banderas.contains(.azimutValido) {
                estado = .objetivo(distanciaMm: Int(m.distanciaMm), azimutCentesimas: Int(m.azimutCentesimas))
            } else if m.banderas.contains(.distanciaValida) {
                estado = .objetivo(distanciaMm: Int(m.distanciaMm), azimutCentesimas: nil)
            } else if m.banderas.contains(.blancoSeleccionado) {
                estado = .presencia
            } else {
                estado = .sinBlanco
            }
            return .aceptado
        }
        instanteUltimaTramaAceptada = t
        cotaResultadoVigenteMs = nil
        estado = m.salud == .sinFallo ? .sinDatos(.sinResultado) : .radarNoDisponible(m.salud)
        return .aceptado
    }
}
