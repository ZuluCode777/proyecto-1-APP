import Foundation
import Observation

/// Estado visible de la consulta de transporte.
enum EstadoConsulta: Equatable, Sendable {
    case inactiva
    case enviando
    case respuesta(RespuestaAgente)
    case error(ErrorConsulta)
    case cancelada
}

/// Consulta textual al backend: una sola petición vigente a la vez.
///
/// Invariante (arquitectura §7 «Consulta vigente»): una respuesta de una
/// consulta cancelada o reemplazada NO cambia el
/// estado. Se garantiza con una generación: solo el resultado de la última
/// generación vigente se aplica, aunque el cliente ignore la cancelación.
///
/// Conversación con aclaración (EA-19): si la respuesta pide completar un viaje («Salgo desde Ricaurte» → «¿A qué
/// estación quieres ir?»), el origen queda en `origenPendiente` y viaja con la pregunta siguiente. Vive solo en este
/// iPhone y en memoria: el servidor no guarda historial. Cancelar la consulta en curso lo borra; una respuesta que no
/// pide nada más lo sustituye. La pregunta se puede dictar (`dictado`): el texto va al campo, la persona revisa y
/// envía, y una pregunta dictada y sin editar se contesta también en voz alta, por la misma vía que los avisos del
/// accesorio. Esa lectura nunca corta un aviso que ya suena (la lectura de transporte cede ante la proximidad): en ese
/// caso la respuesta solo se muestra. Enviar con el micrófono abierto termina la captura; el texto parcial se queda.
@MainActor
@Observable
final class ConsultaModelo {
    var texto = ""
    /// Escenario de la PRÓXIMA consulta; el del resultado en pantalla es `escenarioEnviado`.
    var escenario: EscenarioConsulta = .transporte
    private(set) var estado: EstadoConsulta = .inactiva
    /// Texto de la última consulta enviada, para «Reintentar».
    private(set) var ultimoTextoEnviado: String?
    /// Escenario de la última consulta enviada: rotula su resultado y lo conserva «Reintentar».
    private(set) var escenarioEnviado: EscenarioConsulta = .transporte
    /// Origen que la persona dijo y al que falta el destino. Se envía con la próxima consulta de transporte.
    private(set) var origenPendiente: String?
    /// Dictado de la pregunta; `nil` si esta pantalla no lo ofrece.
    let dictado: DictadoModelo?

    @ObservationIgnored private let cliente: ClienteAgente
    @ObservationIgnored private let voz: ControlVoz?
    @ObservationIgnored private var tarea: Task<Void, Never>?
    @ObservationIgnored private var generacion = 0
    /// Origen pendiente con que salió la última consulta: «Reintentar» repite lo enviado, también si entre tanto se canceló.
    /// Es observable: el rótulo del botón dice qué origen se reenvía.
    private(set) var origenEnviado: String?
    /// `ControlVoz.locuciones` al empezar la última respuesta hablada de esta pantalla; `nil` si no hay ninguna que cortar.
    @ObservationIgnored private var locucionPropia: Int?

    init(cliente: ClienteAgente, dictado: DictadoModelo? = nil, voz: ControlVoz? = nil) {
        self.cliente = cliente
        self.dictado = dictado
        self.voz = voz
        dictado?.alTexto = { [weak self] texto in self?.texto = texto }
        dictado?.cortarVozPropia = { [weak self] in self?.detenerHabla() }
    }

    var estaEnviando: Bool { estado == .enviando }

    /// La persona cambió el campo (teclado o corrección de lo dictado): ya no es «lo dictado», así que no se lee en voz alta.
    /// El dictado escribe por `alTexto`, no por aquí.
    func editarTexto(_ nuevo: String) {
        guard nuevo != texto else { return }
        texto = nuevo
        dictado?.olvidarUltimoDictado()
    }

    /// Rótulo de un botón que repite la última consulta: dice el origen pendiente que va a reenviar.
    func etiquetaDeRepetir(_ accion: String) -> String {
        origenEnviado.map { "\(accion) con origen \($0)" } ?? accion
    }

    func enviar() {
        // «Enviar» con el micrófono abierto (o esperando los permisos): la captura termina aquí. El texto parcial se queda en
        // el campo como texto escrito y nada que llegue después lo pisa.
        if dictado?.estado.enCurso == true { dictado?.cancelar() }
        switch EntradaConsulta.validar(texto, maximo: escenario.maximoCaracteres) {
        case .failure(let error):
            // Una entrada inválida invalida también la consulta anterior: si no,
            // su respuesta tardía pisaría este error (el campo sigue activo y
            // `estaEnviando` dejó de ser verdadero, así que «Cancelar» ya no existe).
            invalidarConsultaEnCurso()
            estado = .error(error)
        case .success(let limpio):
            iniciar(con: limpio)
        }
    }

    func reintentar() {
        guard let anterior = ultimoTextoEnviado else { return }
        dictado?.olvidarUltimoDictado()  // repite lo enviado, no una dictada nueva que esté en el campo
        texto = anterior
        escenario = escenarioEnviado
        origenPendiente = origenEnviado
        enviar()
    }

    /// Cancela la consulta en curso y, con ella, la aclaración pendiente y el dictado. No hay efectos tardíos aunque el
    /// servidor responda después.
    func cancelar() {
        dictado?.cancelar()
        guard estaEnviando else { return }
        invalidarConsultaEnCurso()
        origenPendiente = nil
        estado = .cancelada
    }

    /// La pantalla dejó de verse (arquitectura §7): invalida la captura, la consulta en curso y la voz de la respuesta.
    /// Una aclaración pendiente que no estaba en curso se conserva y la pantalla la muestra al volver.
    func salir() {
        cancelar()
        detenerHabla()
    }

    /// «Olvidar origen»: la persona descarta la aclaración pendiente.
    func olvidarOrigenPendiente() {
        origenPendiente = nil
    }

    /// Descarta la generación vigente: su resultado, si llega, no se aplica. También corta la respuesta que sonara.
    private func invalidarConsultaEnCurso() {
        generacion += 1
        tarea?.cancel()
        tarea = nil
        detenerHabla()
    }

    /// Corta la respuesta hablada de esta pantalla, y solo esa: si después habló otro (un aviso del accesorio), la cola de
    /// uno ya la cortó y lo que suena no es nuestro.
    private func detenerHabla() {
        guard let voz, let propia = locucionPropia else { return }
        locucionPropia = nil
        if voz.locuciones == propia { voz.descartarTodo() }
    }

    /// Suena una locución que no es la respuesta de esta pantalla (un aviso del accesorio): no se corta ni se tapa.
    private var suenaAlgoAjeno: Bool {
        guard let voz, voz.hablando else { return false }
        return locucionPropia != voz.locuciones
    }

    /// Lee la respuesta por la voz de la app. Con la captura abierta no se habla (la voz sonaría sobre el micrófono), y con un
    /// aviso sonando tampoco (`ControlVoz.anunciar` lo cortaría): la pantalla ya muestra la respuesta.
    private func hablar(_ respuesta: RespuestaAgente, escenario: EscenarioConsulta) {
        guard let voz, dictado?.capturando != true, !suenaAlgoAjeno else { return }
        let partes = [escenario.anuncioResultado, respuesta.textoHablado].compactMap { $0 }
        if voz.anunciar(partes.joined(separator: " ")) == .hablado { locucionPropia = voz.locuciones }
    }

    private func iniciar(con limpio: String) {
        generacion += 1
        let miGeneracion = generacion
        tarea?.cancel()
        detenerHabla()
        ultimoTextoEnviado = limpio
        let enviado = escenario
        escenarioEnviado = enviado
        // La aclaración solo completa un viaje de transporte: en el escenario Metro no viaja.
        let pendiente = enviado == .transporte ? origenPendiente : nil
        origenEnviado = pendiente
        // Solo una pregunta dictada y sin editar se lee en voz alta; lo enviado ya no es «lo dictado» para la siguiente.
        let dictada = dictado?.ultimoDictado != nil
        dictado?.olvidarUltimoDictado()
        estado = .enviando
        tarea = Task { [cliente] in
            let resultado: EstadoConsulta
            do {
                // Antes de publicarla, se retiran las órdenes de abordaje sin verificar.
                let respuesta = try await cliente.consultar(texto: enviado.prefijo + limpio, origenPendiente: pendiente).saneada()
                // En el escenario Metro el servidor solo informa (acción `none`): una ruta, una estación
                // o un viaje de TransMilenio no se presentan como Metro.
                guard enviado == .transporte || respuesta.accion == .ninguna else {
                    throw ErrorConsulta.respuestaIncompatible
                }
                resultado = .respuesta(respuesta)
            } catch let error as ErrorConsulta {
                resultado = .error(error)
            } catch is CancellationError {
                resultado = .error(.cancelada)
            } catch {
                resultado = .error(.sinConexion)
            }
            // Respuesta tardía de una consulta cancelada o reemplazada: se descarta.
            guard miGeneracion == self.generacion, !Task.isCancelled else { return }
            self.tarea = nil
            self.estado = resultado == .error(.cancelada) ? .cancelada : resultado
            // Un error conserva la aclaración (hay «Reintentar»); una respuesta la sustituye por la que traiga.
            if case .respuesta(let respuesta) = resultado {
                self.origenPendiente = respuesta.origenPendiente
                if dictada { self.hablar(respuesta, escenario: enviado) }
            }
        }
    }
}
