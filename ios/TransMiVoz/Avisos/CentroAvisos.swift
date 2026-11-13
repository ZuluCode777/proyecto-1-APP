import ContratoBLE
import Foundation
import Observation

/// Módulo local de avisos del iPhone (EA-20, #46). Todo aviso (pérdida de accesorio, dato vencido, proximidad, red caída,
/// datos viejos, GPS impreciso) pasa por aquí antes de la voz y de la lista. Reglas:
/// - una sola emisión a la vez: la voz es la de `ControlVoz`, dueño único del audio, y aquí solo se le dice con qué
///   prioridad (la severidad del aviso). Un aviso relevante corta a un mensaje de rutina; uno menor no calla a uno mayor;
/// - deduplicación: un aviso igual al vigente de su fuente no se repite ni se vuelve a listar. `repitiendo` la salta (la
///   sesión repite el estado de ahora al volver el audio);
/// - caducidad: los avisos de la consulta y la ubicación son vigentes un tiempo (`TipoAviso.vigenciaMs`); los de la sesión no
///   caducan por tiempo: duran mientras dure su estado y la sesión los cierra con `retirar`. Lo cerrado queda en la lista
///   como «ya no vigente» y no se repite;
/// - sin anunciar sin límite: como mucho `maximoVocesPorVentana` avisos hablados de una clase cada `ventanaRitmoMs`;
/// - la persona puede silenciar la voz de las advertencias. La voz de lo urgente (accesorio, sensor, proximidad) nunca se
///   silencia: no hay otra forma no visual de enterarse. Silenciar no oculta nada: el aviso sigue en la lista.
/// La lista guarda el último aviso de cada clase, así que no crece.
///
/// No usa notificaciones del sistema ni pide su permiso: la app no corre en segundo plano (la sesión se suspende), así que
/// no hay nada que notificar fuera de ella. Un aviso de esta lista no es una notificación remota (push).
@MainActor
@Observable
final class CentroAvisos {
    /// Ritmo máximo de voz por clase de aviso. Propuesta de software, sin medir (banco de EA-20).
    static let ventanaRitmoMs: Milisegundos = 10_000
    static let maximoVocesPorVentana = 6

    /// `.simulado` solo en las pruebas de interfaz: los avisos nacen de entradas simuladas y la lista lo dice.
    let origen: OrigenAviso
    /// El último aviso de cada clase, el más reciente primero.
    private(set) var avisos: [Aviso] = []
    /// La persona silenció la voz de las advertencias. Solo en memoria: al abrir la app de nuevo vuelven a sonar. Lo urgente
    /// no tiene interruptor: nunca se silencia.
    private(set) var advertenciasSilenciadas = false
    /// Lo que pasó con el último «Repetir», para la pantalla.
    private(set) var resultadoRepeticion: String?
    /// Cuántas veces se pidió «Repetir»: la pantalla lleva el foco al resultado aunque el texto sea igual al anterior. Es el
    /// único canal de VoiceOver para ese resultado: no se anuncia además, para que no se lea dos veces.
    private(set) var repeticiones = 0

    @ObservationIgnored private let voz: ControlVoz
    @ObservationIgnored private let reloj: RelojMonotonico
    /// Instantes de las últimas voces de cada clase, para el límite de ritmo.
    @ObservationIgnored private var voces: [TipoAviso: [Milisegundos]] = [:]
    /// Distancia de la última lectura de proximidad que se dijo: una más cercana no la frena el límite de ritmo.
    @ObservationIgnored private var ultimaDistanciaDichaMm: Int?

    init(voz: ControlVoz, reloj: @escaping RelojMonotonico = RelojDelSistema.ahora, origen: OrigenAviso = .propio) {
        self.voz = voz
        self.reloj = reloj
        self.origen = origen
    }

    func vigente(_ aviso: Aviso) -> Bool { aviso.vigente(en: reloj()) }

    /// Silenciar solo existe para las advertencias: lo urgente nunca se silencia.
    func silenciarAdvertencias(_ activo: Bool) { advertenciasSilenciadas = activo }

    /// Emite un aviso: lo lista y decide su voz. `texto` es lo que se lista y la clave para no repetir; `decir` es lo que se
    /// habla ahora si difiere y `textoVoz`, lo que dirá «Repetir» (la sesión les añade la reserva del enlace sin autenticar:
    /// `decir` solo mientras la reserva tenga turno, `textoVoz` siempre). `enlaceSinAutenticar` lo declara la fila.
    /// `distanciaMm`: la medida de una proximidad; una lectura más cercana que la última dicha no la frena el límite de ritmo.
    @discardableResult
    func emitir(
        _ tipo: TipoAviso, _ texto: String, decir: String? = nil, textoVoz: String? = nil,
        enlaceSinAutenticar: Bool = false, distanciaMm: Int? = nil, repitiendo: Bool = false
    ) -> ResultadoEmision {
        let ahora = reloj()
        let caduca = tipo.vigenciaMs.map { ahora + $0 }
        let indice: Int
        if let i = avisos.firstIndex(where: { $0.tipo.fuente == tipo.fuente && $0.vigente(en: ahora) }),
           avisos[i].tipo == tipo, avisos[i].texto == texto, avisos[i].enlaceSinAutenticar == enlaceSinAutenticar {
            // Sigue la misma situación: se renueva la vigencia (si la tiene) y no se repite, salvo que se pida o la voz esté
            // aplazada.
            avisos[i].caducaMs = caduca
            guard repitiendo || avisos[i].pendienteDeVoz else { return .duplicado }
            indice = i
        } else {
            retirar(fuente: tipo.fuente)
            avisos.removeAll { $0.tipo == tipo }
            avisos.insert(
                Aviso(
                    tipo: tipo, texto: texto, textoVoz: textoVoz ?? texto, origen: origen,
                    enlaceSinAutenticar: enlaceSinAutenticar, caducaMs: caduca),
                at: 0)
            indice = 0
        }
        return hablar(en: indice, decir ?? texto, ahora: ahora, forzando: repitiendo, distanciaMm: distanciaMm)
    }

    /// Cierra los avisos vigentes de una fuente: la situación cambió o la fuente se detuvo. Siguen en la lista como anteriores.
    /// Devuelve si cerró alguno: quien emite lo usa para olvidar lo que ya dijo, porque si el mismo aviso vuelve tiene que
    /// emitirse de nuevo y no darse por repetido.
    @discardableResult
    func retirar(fuente: FuenteAviso) -> Bool {
        let ahora = reloj()
        var cerro = false
        for i in avisos.indices where avisos[i].tipo.fuente == fuente && avisos[i].vigente(en: ahora) {
            avisos[i].caducaMs = ahora
            avisos[i].pendienteDeVoz = false
            cerro = true
        }
        return cerro
    }

    /// La persona pide oír de nuevo un aviso vigente, con su reserva del enlace sin autenticar si la lleva. Es una orden
    /// explícita: ignora el silencio de las advertencias y el límite de ritmo, pero no la ruta de audio: sin salida privada
    /// no se dice y se explica por qué. Un aviso cerrado o caducado no se repite.
    func repetir(_ tipo: TipoAviso) {
        guard let aviso = avisos.first(where: { $0.tipo == tipo }) else { return }
        repeticiones += 1
        guard vigente(aviso) else { informar(TextoAvisos.yaNoVigente); return }
        switch voz.anunciar(aviso.textoVoz, prioridad: tipo.severidad) {
        case .hablado:
            resultadoRepeticion = TextoAvisos.repitiendo
        case .silenciado(let motivo):
            informar(TextoAvisos.noSeDijo(motivo))
        }
    }

    /// El estado de la consulta cambió. Solo dos resultados son avisos: sin conexión (red caída) y datos del catálogo
    /// antiguos. Una respuesta al día cierra los avisos de la consulta; los demás errores se muestran en la propia consulta.
    func consultaCambio(_ estado: EstadoConsulta) {
        switch estado {
        case .error(.sinConexion):
            emitir(.redCaida, TextoAvisos.redCaida)
        case .respuesta(let respuesta):
            if respuesta.catalogo?.antiguo == true {
                emitir(.datosViejos, TextoAvisos.datosViejos)
            } else {
                retirar(fuente: .consulta)
            }
        case .inactiva, .enviando, .cancelada, .error:
            break
        }
    }

    // MARK: Internos

    /// El resultado va a la pantalla, que lleva el foco de VoiceOver a ese texto: no se anuncia además (se leería dos veces).
    private func informar(_ texto: String) {
        resultadoRepeticion = texto
    }

    private func hablar(
        en indice: Int, _ texto: String, ahora: Milisegundos, forzando: Bool, distanciaMm: Int?
    ) -> ResultadoEmision {
        let tipo = avisos[indice].tipo
        if tipo.severidad == .advertencia && advertenciasSilenciadas {
            avisos[indice].pendienteDeVoz = false
            return .silenciado(.severidadSilenciada)
        }
        let recientes = (voces[tipo] ?? []).filter { ahora - $0 < Self.ventanaRitmoMs }
        voces[tipo] = recientes
        let masCerca = distanciaMm.map { d in ultimaDistanciaDichaMm.map { d < $0 } ?? false } ?? false
        if !forzando && !masCerca && recientes.count >= Self.maximoVocesPorVentana {
            avisos[indice].pendienteDeVoz = true
            return .limitado
        }
        avisos[indice].pendienteDeVoz = false
        switch voz.anunciar(texto, prioridad: tipo.severidad) {
        case .hablado:
            voces[tipo] = recientes + [ahora]
            if tipo == .proximidad { ultimaDistanciaDichaMm = distanciaMm }
            return .hablado
        case .silenciado(let motivo):
            return .silenciado(motivo)
        }
    }
}
