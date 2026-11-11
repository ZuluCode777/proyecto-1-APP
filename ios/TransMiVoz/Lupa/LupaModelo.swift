import Foundation
import Observation
import QuartzCore

/// Lupa de la cámara: aumento, filtro y congelado de la imagen en vivo. No reconoce ni describe nada de lo que
/// aparece en la imagen, no la guarda y no la envía.
///
/// - La cámara se captura solo con la pestaña a la vista Y la escena activa. Al salir de la pestaña, pasar a
///   segundo plano o quedar la escena inactiva se suelta la sesión y el dispositivo (`CamaraLupa.detener`),
///   una sola vez por captura.
/// - Si la persona sale antes de contestar al aviso de permiso del sistema, la respuesta tardía no arranca nada:
///   la captura empieza cuando la pantalla vuelve a estar a la vista.
/// - Cada captura lleva un token; lo que llegue de una captura ya soltada (una cámara que termina de abrir
///   cuando la persona ya salió) se descarta.
/// - El permiso se explica en pantalla ANTES del aviso del sistema: `continuarTrasExplicacion` lo provoca.
@MainActor
@Observable
final class LupaModelo {
    /// Aumento más alto que ofrece la lupa aunque el dispositivo admita más: con la cámara en la mano, más allá
    /// la imagen tiembla demasiado para leer y el control deja de poder ajustarse a pasos. Decisión de producto
    /// sin medir con la persona usuaria.
    static let aumentoMaximoOfrecido = 10.0
    /// Paso del control de aumento (un toque de «ajustar» de VoiceOver).
    static let pasoAumento = 0.5

    private(set) var aumento = 1.0
    private(set) var aumentoMinimo = 1.0
    private(set) var aumentoMaximo = 1.0
    /// Como en la lupa web, siempre hay un filtro elegido; el de partida es «Alto contraste».
    private(set) var filtro: FiltroLupa = .contraste
    private(set) var congelada = false

    private var permiso: PermisoCamara = .porPreguntar
    private var visible = false
    private var enPrimerPlano = false
    /// El aviso de permiso del sistema está en pantalla.
    private var pidiendo = false
    private var fallo = false
    private var abierta = false

    @ObservationIgnored private let camara: CamaraLupa
    @ObservationIgnored private let avisos: AvisosAccesibles
    /// Hay una captura pedida a la cámara y no soltada.
    @ObservationIgnored private var capturaPedida = false
    @ObservationIgnored private var token = 0
    @ObservationIgnored private var ultimoEstado: EstadoLupa?

    init(camara: CamaraLupa, avisos: AvisosAccesibles = AvisosAccesibles()) {
        self.camara = camara
        self.avisos = avisos
        permiso = camara.permiso
        camara.receptor = { [weak self] evento, token in self?.recibir(evento, token: token) }
    }

    /// Capa donde la cámara pinta la imagen. La pantalla solo la aloja.
    var capa: CALayer { camara.capa }

    var estado: EstadoLupa {
        if pidiendo { return .pidiendoPermiso }
        guard visible && enPrimerPlano else { return .enPausa }
        guard camara.hayCamara else { return .sinCamara }
        switch permiso {
        case .porPreguntar: return .permisoPorPedir
        case .denegado: return .permisoDenegado
        case .restringido: return .permisoRestringido
        case .concedido: break
        }
        if fallo { return .error }
        return abierta ? .activa : .iniciando
    }

    /// El dispositivo ofrece más de un aumento.
    var puedeAcercar: Bool { aumentoMaximo > aumentoMinimo }

    // MARK: Ciclo de vida

    /// La pestaña entró o salió de la pantalla.
    func pantallaVisible(_ visible: Bool) {
        self.visible = visible
        sincronizar()
    }

    /// Escena activa o no (inactiva, bloqueada o en segundo plano).
    func escenaActiva(_ activa: Bool) {
        enPrimerPlano = activa
        sincronizar()
    }

    // MARK: Acciones de la persona

    /// «Continuar» en la explicación del permiso: provoca el aviso de permiso del sistema.
    func continuarTrasExplicacion() {
        guard !pidiendo, estado == .permisoPorPedir else { return }
        pidiendo = true
        camara.pedirPermiso()
        avisarSiCambio()
    }

    func reintentar() {
        guard fallo else { return }
        fallo = false
        sincronizar()
    }

    /// Fuera del rango del dispositivo se ajusta al extremo más cercano.
    func fijarAumento(_ valor: Double) {
        aumento = min(max(valor, aumentoMinimo), aumentoMaximo)
        if abierta { camara.fijarAumento(aumento) }
    }

    func fijarFiltro(_ nuevo: FiltroLupa) {
        guard nuevo != filtro else { return }
        filtro = nuevo
        guard abierta else { return }
        camara.fijarFiltro(nuevo)
        avisos.anunciar("Filtro: \(nuevo.nombre).", .rutina)
    }

    func alternarCongelada() {
        guard abierta else { return }
        congelada.toggle()
        camara.congelar(congelada)
        avisos.anunciar(congelada ? TextoLupa.imagenCongelada + "." : TextoLupa.imagenEnVivo + ".", .rutina)
    }

    // MARK: Cámara

    private func recibir(_ evento: EventoCamara, token tokenEvento: Int) {
        switch evento {
        case .permisoRespondido:
            pidiendo = false
            sincronizar()
        case .lista(let minimo, let maximo):
            guard vigente(tokenEvento) else { return }
            abierta = true
            aumentoMinimo = minimo
            aumentoMaximo = max(minimo, min(maximo, Self.aumentoMaximoOfrecido))
            aumento = min(max(aumento, aumentoMinimo), aumentoMaximo)
            congelada = false
            camara.fijarFiltro(filtro)
            camara.fijarAumento(aumento)
            camara.congelar(false)
            avisarSiCambio()
        case .fallo:
            guard vigente(tokenEvento) else { return }
            fallo = true
            soltarCaptura()
            avisarSiCambio()
        }
    }

    /// El evento es de la captura en curso y no de una ya soltada.
    private func vigente(_ tokenEvento: Int) -> Bool { capturaPedida && tokenEvento == token }

    /// Lleva la captura a lo que toca: abierta solo con la pantalla a la vista, la escena activa, cámara y permiso.
    private func sincronizar() {
        permiso = camara.permiso
        if !(visible && enPrimerPlano) { fallo = false }
        if visible && enPrimerPlano && camara.hayCamara && permiso == .concedido && !fallo {
            if !capturaPedida { empezarCaptura() }
        } else {
            soltarCaptura()
        }
        avisarSiCambio()
    }

    private func empezarCaptura() {
        token += 1
        capturaPedida = true
        abierta = false
        camara.iniciar(token: token)
    }

    /// Suelta la sesión y el dispositivo. Sin captura pedida no hace nada: `detener` se llama una vez por captura.
    private func soltarCaptura() {
        guard capturaPedida else { return }
        capturaPedida = false
        abierta = false
        congelada = false
        camara.detener()
    }

    private func avisarSiCambio() {
        let actual = estado
        guard actual != ultimoEstado else { return }
        ultimoEstado = actual
        if let texto = TextoLupa.anuncio(actual) {
            avisos.anunciar(texto, actual == .error ? .urgente : .rutina)
        }
    }
}
