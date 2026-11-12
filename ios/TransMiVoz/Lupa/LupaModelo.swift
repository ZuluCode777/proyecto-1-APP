import Foundation
import Observation
import QuartzCore

/// Estado de la lupa que ve la persona.
enum EstadoLupa: Equatable, CaseIterable {
    /// Sin captura: la pestaña no está a la vista o la app no está activa.
    case enPausa
    case sinCamara
    /// El sistema aún no ha preguntado por el permiso: una hoja lo explica antes.
    case permisoPorPedir
    /// La persona tocó «Ahora no» en esa hoja: no se pidió nada al sistema.
    case permisoPospuesto
    /// El aviso de permiso del sistema está en pantalla.
    case pidiendoPermiso
    case permisoDenegado
    case permisoRestringido
    case iniciando
    case activa
    case error
}

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
/// - El permiso se explica en una hoja ANTES del aviso del sistema: `continuarTrasExplicacion` lo provoca y
///   `posponerPermiso` («Ahora no») no pide nada; `retomarPermiso` vuelve a explicarlo.
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
    /// La persona dijo «Ahora no» a la explicación del permiso.
    private var pospuesta = false
    /// Aumento de la imagen fija al congelar: congelada no se puede alejar por debajo de él.
    private var aumentoAlCongelar = 1.0

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
        case .porPreguntar: return pospuesta ? .permisoPospuesto : .permisoPorPedir
        case .denegado: return .permisoDenegado
        case .restringido: return .permisoRestringido
        case .concedido: break
        }
        if fallo { return .error }
        return abierta ? .activa : .iniciando
    }

    /// Aumento más bajo que admite el control ahora. Congelada, la imagen fija ya viene con el aumento que tenía al
    /// congelar y la cámara no guarda el encuadre completo: no se puede alejar por debajo de él.
    var aumentoPiso: Double { congelada ? aumentoAlCongelar : aumentoMinimo }

    /// Hay margen para acercar más.
    var puedeAcercar: Bool { aumentoMaximo > aumentoPiso }

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

    /// «Ahora no» en la explicación del permiso: no se pide nada al sistema y el resto de la app sigue igual.
    func posponerPermiso() {
        guard estado == .permisoPorPedir else { return }
        pospuesta = true
        avisarSiCambio()
    }

    /// «Activar la lupa» tras un «Ahora no»: vuelve a explicar el permiso.
    func retomarPermiso() {
        guard estado == .permisoPospuesto else { return }
        pospuesta = false
        avisarSiCambio()
    }

    func reintentar() {
        guard fallo else { return }
        fallo = false
        sincronizar()
    }

    /// Fuera del rango del dispositivo (o por debajo del piso, con la imagen congelada) se ajusta al extremo más cercano.
    func fijarAumento(_ valor: Double) {
        aumento = min(max(valor, aumentoPiso), aumentoMaximo)
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
        if !congelada { aumentoAlCongelar = aumento }
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
