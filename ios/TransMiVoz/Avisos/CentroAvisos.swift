import ContratoBLE
import Foundation
import Observation

/// Módulo local de avisos del iPhone (EA-20, #46). Todo aviso (pérdida de accesorio, dato vencido, proximidad, red caída,
/// datos viejos, GPS impreciso) pasa por aquí antes de la voz y de la lista. Reglas:
/// - una sola emisión a la vez: la voz es la de `ControlVoz`, dueño único del audio, y aquí solo se le dice con qué
///   prioridad (la severidad del aviso). Un aviso relevante corta a un mensaje de rutina; uno menor no calla a uno mayor;
/// - deduplicación: un aviso igual al vigente de su fuente no se repite ni se vuelve a listar. `repitiendo` la salta (la
///   sesión repite el estado de ahora al volver el audio);
/// - caducidad: cada aviso es vigente un tiempo (`TipoAviso.vigenciaMs`) o hasta que su fuente lo cierra. Lo caducado queda
///   en la lista como «ya no vigente» y no se repite;
/// - sin anunciar sin límite: como mucho `maximoVocesPorVentana` avisos hablados de una clase cada `ventanaRitmoMs`;
/// - la persona puede silenciar la voz de una severidad. Silenciar no oculta nada: el aviso sigue en la lista.
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
    /// Severidades cuya voz silenció la persona. Solo en memoria: al abrir la app de nuevo vuelven a sonar.
    private(set) var silenciadas: Set<PrioridadVoz> = []
    /// Lo que pasó con el último «Repetir», para la pantalla.
    private(set) var resultadoRepeticion: String?
    /// Cuántas veces se pidió «Repetir»: la pantalla lleva el foco al resultado aunque el texto sea igual al anterior.
    private(set) var repeticiones = 0

    @ObservationIgnored private let voz: ControlVoz
    @ObservationIgnored private let accesibles: AvisosAccesibles
    @ObservationIgnored private let reloj: RelojMonotonico
    /// Instantes de las últimas voces de cada clase, para el límite de ritmo.
    @ObservationIgnored private var voces: [TipoAviso: [Milisegundos]] = [:]

    init(
        voz: ControlVoz, avisos accesibles: AvisosAccesibles = AvisosAccesibles(),
        reloj: @escaping RelojMonotonico = RelojDelSistema.ahora, origen: OrigenAviso = .propio
    ) {
        self.voz = voz
        self.accesibles = accesibles
        self.reloj = reloj
        self.origen = origen
    }

    func vigente(_ aviso: Aviso) -> Bool { aviso.vigente(en: reloj()) }

    func silenciada(_ severidad: PrioridadVoz) -> Bool { silenciadas.contains(severidad) }

    func silenciar(_ severidad: PrioridadVoz, _ activo: Bool) {
        if activo { silenciadas.insert(severidad) } else { silenciadas.remove(severidad) }
    }

    /// Emite un aviso: lo lista y decide su voz. `texto` es lo que se lista y la clave para no repetir; `decir` es lo que se
    /// habla si difiere (la sesión le añade la reserva del enlace sin autenticar).
    @discardableResult
    func emitir(_ tipo: TipoAviso, _ texto: String, decir: String? = nil, repitiendo: Bool = false) -> ResultadoEmision {
        let ahora = reloj()
        let indice: Int
        if let i = avisos.firstIndex(where: { $0.tipo.fuente == tipo.fuente && $0.vigente(en: ahora) }),
           avisos[i].tipo == tipo, avisos[i].texto == texto {
            // Sigue la misma situación: se renueva la vigencia y no se repite, salvo que se pida o la voz esté aplazada.
            avisos[i].caducaMs = ahora + tipo.vigenciaMs
            guard repitiendo || avisos[i].pendienteDeVoz else { return .duplicado }
            indice = i
        } else {
            retirar(fuente: tipo.fuente)
            avisos.removeAll { $0.tipo == tipo }
            avisos.insert(Aviso(tipo: tipo, texto: texto, origen: origen, caducaMs: ahora + tipo.vigenciaMs), at: 0)
            indice = 0
        }
        return hablar(en: indice, decir ?? texto, ahora: ahora, forzando: repitiendo)
    }

    /// Cierra los avisos vigentes de una fuente: la situación cambió o la fuente se detuvo. Siguen en la lista como anteriores.
    func retirar(fuente: FuenteAviso) {
        let ahora = reloj()
        for i in avisos.indices where avisos[i].tipo.fuente == fuente && avisos[i].vigente(en: ahora) {
            avisos[i].caducaMs = ahora
            avisos[i].pendienteDeVoz = false
        }
    }

    /// La persona pide oír de nuevo un aviso vigente. Es una orden explícita: ignora el silencio por severidad y el límite de
    /// ritmo, pero no la ruta de audio: sin salida privada no se dice y se explica por qué. Un aviso caducado no se repite.
    func repetir(_ tipo: TipoAviso) {
        guard let aviso = avisos.first(where: { $0.tipo == tipo }) else { return }
        repeticiones += 1
        guard vigente(aviso) else { informar(TextoAvisos.yaNoVigente); return }
        switch voz.anunciar(aviso.texto, prioridad: tipo.severidad) {
        case .hablado:
            // Ya suena: un anuncio de accesibilidad encima lo taparía.
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

    private func informar(_ texto: String) {
        resultadoRepeticion = texto
        accesibles.anunciar(texto, .rutina)
    }

    private func hablar(en indice: Int, _ texto: String, ahora: Milisegundos, forzando: Bool) -> ResultadoEmision {
        let tipo = avisos[indice].tipo
        if silenciadas.contains(tipo.severidad) {
            avisos[indice].pendienteDeVoz = false
            return .silenciado(.severidadSilenciada)
        }
        let recientes = (voces[tipo] ?? []).filter { ahora - $0 < Self.ventanaRitmoMs }
        voces[tipo] = recientes
        if !forzando && recientes.count >= Self.maximoVocesPorVentana {
            avisos[indice].pendienteDeVoz = true
            return .limitado
        }
        avisos[indice].pendienteDeVoz = false
        switch voz.anunciar(texto, prioridad: tipo.severidad) {
        case .hablado:
            voces[tipo] = recientes + [ahora]
            return .hablado
        case .silenciado(let motivo):
            return .silenciado(motivo)
        }
    }
}
